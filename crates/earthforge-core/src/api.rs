use crate::{
    exact::Scale,
    geometry, material, physics,
    simulation::{self, Options},
};
use serde_json::{Value, json};
pub fn request(input: Value) -> Result<Value, String> {
    match input
        .get("kind")
        .and_then(Value::as_str)
        .unwrap_or("section")
    {
        "capabilities" => Ok(json!({
            "schema":"earthforge-capabilities-v1", "engine":"earthforge-core", "abi":1,
            "version":env!("CARGO_PKG_VERSION"), "geologicalHistoryDimensions":[2,3],
            "acousticDimensions":[2,3], "sourcePrecision":"binary64", "coordinates":"metres, z positive down",
            "history3d":{"recipes":["classic","detailed"],"materialStepIndependentOfSampling":true,
                "globallyIndexedGridWindows":true,"materialStateProjection":true,"maxProjectionPointsPerRequest":4000000,
                "maxUniqueRaysPerRequest":8192,"orthogonalSections":true,"explicitPointQueries":true,"allBedContactOccurrences":true,"depositionalUnitContacts":true},
            "assumptions":["Prescribed regional fault kinematics and pressure", "Vertical drained quasistatic compaction", "Open regional observation window"],
            "notImplemented":["Stress equilibrium", "Pore-fluid-flow evolution", "Field-validated geological accuracy"]
        })),
        "version" => {
            Ok(json!({"engine":"rust-v1","dimensions":[2,3],"fullBasinDimensions":[2,3],"abi":1}))
        }
        "acoustic" => {
            let shot: crate::acoustic::ShotRequest =
                serde_json::from_value(input).map_err(|error| error.to_string())?;
            serde_json::to_value(crate::acoustic::simulate(shot)?)
                .map_err(|error| error.to_string())
        }
        "history3d" => crate::history3d::output::request(input),
        "volume3d" => {
            let bounds: crate::polyhedron::Aabb = serde_json::from_value(input["bounds"].clone())
                .map_err(|error| error.to_string())?;
            let column: material::Column = serde_json::from_value(input["column"].clone())
                .map_err(|error| error.to_string())?;
            let beds: Vec<material::Bed> =
                serde_json::from_value(input["beds"].clone()).map_err(|error| error.to_string())?;
            let faults: Vec<crate::space::PlanarFault> =
                serde_json::from_value(input.get("faults").cloned().unwrap_or(json!([])))
                    .map_err(|error| error.to_string())?;
            let events: Option<Vec<crate::volume3d::VolumeEvent>> = input
                .get("events")
                .map(|value| {
                    serde_json::from_value(value.clone()).map_err(|error| error.to_string())
                })
                .transpose()?;
            if events.is_some() && !faults.is_empty() {
                return Err("Choose either ordered 3D events or legacy faults, not both".into());
            }
            if events.as_ref().is_some_and(|events| events.len() > 32) {
                return Err("3D event sequence exceeds configured limits".into());
            }
            let section_y: Vec<f64> = serde_json::from_value(
                input
                    .get("sectionsY")
                    .cloned()
                    .unwrap_or(json!([(bounds.min.y + bounds.max.y) / 2.0])),
            )
            .map_err(|error| error.to_string())?;
            if column.len() > 4096 || faults.len() > 32 || section_y.len() > 64 {
                return Err("3D prototype request exceeds configured limits".into());
            }
            let mut volume = crate::volume3d::MaterialVolume::from_layers(bounds, &column, &beds)?;
            let initial = volume.inventory();
            let mut ledgers = Vec::with_capacity(faults.len());
            for fault in faults {
                ledgers.push(volume.slip_planar(fault)?);
            }
            let event_ledgers = events
                .map(|events| {
                    events
                        .into_iter()
                        .map(|event| volume.apply(event))
                        .collect::<Result<Vec<_>, _>>()
                })
                .transpose()?;
            let mut sections = Vec::with_capacity(section_y.len());
            for y in section_y {
                sections.push(json!({"y":y,"parcels":volume.section_y(y)?}));
            }
            let projection = input
                .get("projection")
                .map(|value| {
                    let options: crate::projection3d::ProjectionRequest =
                        serde_json::from_value(value.clone()).map_err(|error| error.to_string())?;
                    crate::projection3d::project(&volume, options)
                })
                .transpose()?;
            let fragments = volume.fragments();
            let face_count: usize = fragments.iter().map(|f| f.support.faces().len()).sum();
            let vertex_references: usize = fragments
                .iter()
                .flat_map(|f| f.support.faces())
                .map(Vec::len)
                .sum();
            let mut output = json!({"engine":"rust-volume3d-v1","dimensions":3,"prototype":true,
                "model":"Prescribed planar fault kinematics with continuous material supports; not a full 3D geological-history or stress solver",
                "bounds":bounds,"initialInventory":initial,"inventory":volume.inventory(),"ledgers":ledgers,"sections":sections,"projection":projection,
                "stats":{"authoritativeVoxels":0,"fragments":fragments.len(),"faces":face_count,"vertexReferences":vertex_references},
                "geometry":if input["includeGeometry"].as_bool().unwrap_or(false){Some(fragments)}else{None}});
            if let Some(ledgers) = event_ledgers {
                output["eventLedgers"] =
                    serde_json::to_value(ledgers).map_err(|error| error.to_string())?;
                output["model"] = json!(
                    "Prescribed planar faults and erosion with continuous supports; not a full 3D geological-history or stress solver"
                );
            }
            Ok(output)
        }
        "section" | "basin" => {
            let options: Options =
                serde_json::from_value(input.get("options").cloned().unwrap_or(json!({})))
                    .map_err(|e| e.to_string())?;
            let b = simulation::simulate(options)?;
            if input["kind"] == "basin" {
                return basin_value(b);
            }
            if input
                .get("detail")
                .and_then(Value::as_bool)
                .unwrap_or(false)
            {
                Ok(
                    json!({"section":b.section,"columns":b.columns,"beds":b.beds,"faults":b.faults,"historyPlan":b.history_plan,"entries":b.entries,"nx":b.nx,"nz":b.nz}),
                )
            } else {
                serde_json::to_value(b.section).map_err(|e| e.to_string())
            }
        }
        "physics" => {
            let rows = input["rows"].as_array().ok_or("Expected physics rows")?;
            let mut out = vec![];
            for row in rows {
                let f = row["fraction"].as_f64().ok_or("Expected fraction")?;
                let d = row["depth"].as_f64().ok_or("Expected depth")?;
                let carb = row["carbonate"].as_bool().unwrap_or(false);
                let pressure = row["pressure"].as_f64();
                let history = if row["history"].is_null() {
                    None
                } else {
                    Some(
                        serde_json::from_value(row["history"].clone())
                            .map_err(|e| e.to_string())?,
                    )
                };
                out.push(json!({"porosity":physics::porosity(f,d,carb),"effectiveDepth":physics::effective_depth(d,pressure),"velocity":physics::velocity(f,d,carb,pressure,history)}));
            }
            Ok(json!(out))
        }
        "math" => {
            // Hexadecimal bits also permit testing signed zero, subnormals and
            // nonfinite values without changing them at the JSON boundary.
            let rows = input["rows"].as_array().ok_or("Expected math rows")?;
            let mut out = Vec::with_capacity(rows.len());
            for row in rows {
                let bits =
                    u64::from_str_radix(row["bits"].as_str().ok_or("Expected input bits")?, 16)
                        .map_err(|error| error.to_string())?;
                let x = f64::from_bits(bits);
                let value = match row["function"].as_str().ok_or("Expected math function")? {
                    "exp" => crate::math::exp(x),
                    "expm1" => crate::math::expm1(x),
                    "tanh" => crate::math::tanh(x),
                    "sin" => crate::math::sin(x),
                    "tan" => crate::math::tan(x),
                    "cbrt" => crate::math::cbrt(x),
                    _ => return Err("Unknown math function".into()),
                };
                out.push(format!("{:016x}", value.to_bits()));
            }
            Ok(json!(out))
        }
        "compact" => {
            let columns: Vec<material::Column> =
                serde_json::from_value(input["columns"].clone()).map_err(|e| e.to_string())?;
            let beds: Vec<material::Bed> =
                serde_json::from_value(input["beds"].clone()).map_err(|e| e.to_string())?;
            let mut out = vec![];
            for column in columns {
                out.push(material::compact(&column, &beds, input["pressure"].as_f64())?.0)
            }
            Ok(json!(out))
        }
        "exact" => {
            let terms: Vec<f64> =
                serde_json::from_value(input["terms"].clone()).map_err(|e| e.to_string())?;
            let s = Scale::new(terms.iter().copied())?;
            let units = s.sum(terms)?;
            Ok(
                json!({"exponent":s.exponent,"units":units.to_str_radix(10),"number":s.number(&units)?,"chunks":s.chunks(&units)?}),
            )
        }
        "transport" => {
            let nx = input["nx"].as_u64().ok_or("Expected nx")? as usize;
            let nz = input["nz"].as_u64().ok_or("Expected nz")? as usize;
            let allowed: Vec<bool> =
                serde_json::from_value(input["allowed"].clone()).map_err(|e| e.to_string())?;
            let parcels: Vec<crate::transport::Parcel> =
                serde_json::from_value(input["parcels"].clone()).map_err(|e| e.to_string())?;
            let capacity: Vec<f64> =
                serde_json::from_value(input["capacity"].clone()).map_err(|e| e.to_string())?;
            serde_json::to_value(crate::transport::assign(
                nx, nz, &allowed, &parcels, &capacity,
            )?)
            .map_err(|e| e.to_string())
        }
        "flow" => {
            let p: Vec<geometry::V> =
                serde_json::from_value(input["points"].clone()).map_err(|e| e.to_string())?;
            let f = geometry::Flow::new(p)?;
            let point: geometry::V =
                serde_json::from_value(input["point"].clone()).map_err(|e| e.to_string())?;
            let slip = input["slip"].as_f64().ok_or("Expected slip")?;
            Ok(json!({"point":f.moved(point,slip)?,"displacement":f.displacement(point,slip)?}))
        }
        kind => Err(format!("Unknown engine request: {kind}")),
    }
}
pub fn process(input: &[u8]) -> Vec<u8> {
    let result = serde_json::from_slice(input)
        .map_err(|e| e.to_string())
        .and_then(request);
    let response = match result {
        Ok(value) => json!({"ok":true,"value":value}),
        Err(error) => json!({"ok":false,"error":error}),
    };
    serde_json::to_vec(&response)
        .unwrap_or_else(|_| br#"{"ok":false,"error":"Response encoding failed"}"#.to_vec())
}

fn basin_value(b: simulation::Simulation) -> Result<Value, String> {
    let h = b.section.options.h;
    let raster = crate::raster::rasterize(&b.columns, b.nz, h)?;
    let view = crate::raster::window(
        &b.columns,
        h,
        &b.beds,
        b.section.overpressure,
        b.section.basement_velocity,
        20.0,
    )?;
    let faults:Vec<_>=b.faults.iter().map(|f|{let depth:Vec<_>=f.depth.iter().map(|z|if z.is_finite(){Some(*z)}else{None}).collect();json!({"kind":f.kind,"dir":f.dir,"depth":depth,"top":f.top,"x":f.x,"z":f.z,"dip":f.dip,"detachment":f.detachment,"start":f.start,"end":f.end,"heave":f.heave,"heaves":f.heaves,"remainder":f.remainder,"trace":f.trace,"thrust":if f.kind=="thrust"{Some(json!({"transport":f.transport,"bends":if f.points.len()>2{vec![crate::transport::round((f.points[1][0]+2000.0)/h)as usize,crate::transport::round((f.points[2][0]+2000.0)/h)as usize]}else{vec![0,0]},"points":if f.points.is_empty(){None}else{Some(&f.points)},"emergent":f.emergent,"upper":f.points.get(2).map(|p|p[1]),"carry":f.carry}))}else{None}})}).collect();
    let steps:Vec<_>=(0..b.history_plan.phases.iter().sum()).map(|step|{let entries:Vec<_>=b.entries.iter().filter(|e|e.step==step).cloned().collect();json!({"step":step,"summary":crate::budget::summarize(&entries,&entries[0].before,&entries.last().unwrap().after)})}).collect();
    Ok(
        json!({"columns":b.columns,"grid":raster.grid,"solid":raster.solid,"sandFraction":raster.sand_fraction,"burial":raster.burial,"effectiveBurial":raster.effective_burial,"view":view,"options":b.section.options,"setting":b.section.setting,"nx":b.nx,"nz":b.nz,"h":h,"beds":b.beds,"faults":faults,"log":b.section.log,"snapshots":[],"historyPlan":b.history_plan,"budget":{"entries":b.entries,"summary":b.section.budget,"width":b.nx as f64*h,"depth":b.nz as f64*h,"steps":steps},"deposited":b.deposited,"pre":b.pre,"preSteps":b.history_plan.phases[0],"dt":b.section.dt,"basementVelocity":b.section.basement_velocity,"overpressure":b.section.overpressure,"checks":{"collapsed":b.section.checks.collapsed,"trapped":b.section.checks.trapped,"area":b.section.checks.area,"seconds":b.section.checks.seconds,"steps":b.section.log.len(),"slips":b.slips,"transport":b.transport}}),
    )
}
