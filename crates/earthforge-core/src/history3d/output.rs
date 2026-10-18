use super::{
    model::{EvalStats, HistoryModel, HistorySpec},
    preset::{self, HistoryOptions},
    profile::Profile,
};
use crate::{
    material::{BASEMENT, Layer, WATER},
    physics::{self, RockHistory},
    space::{GridGeometry, WorldPoint as P},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{collections::HashMap, sync::Arc};
fn nx() -> usize {
    121
}
fn nz() -> usize {
    121
}
fn basement_velocity() -> f64 {
    5200.0
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaneRequest {
    pub axis: String,
    pub position: f64,
    pub nu: usize,
    pub nv: usize,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HorizonQuery {
    pub x: f64,
    pub y: f64,
    pub bed: Option<usize>,
    pub unit: Option<usize>,
}
/// A window indexes the original grid, so tiling preserves the exact rounded
/// coordinates of a monolithic query. Re-basing a tile origin would not.
#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct GridWindow {
    pub start: [usize; 3],
    pub count: [usize; 3],
}
impl GridWindow {
    fn validate(self, grid: GridGeometry) -> Result<Self, String> {
        for (axis, size) in [grid.nx, grid.ny, grid.nz].into_iter().enumerate() {
            if self.count[axis] == 0
                || self.start[axis]
                    .checked_add(self.count[axis])
                    .is_none_or(|end| end > size)
            {
                return Err("Grid window outside parent grid".into());
            }
        }
        Ok(self)
    }
    fn points(self) -> usize {
        self.count.into_iter().product()
    }
}
#[derive(Clone, Debug, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Query {
    pub stage: Option<usize>,
    pub nx: usize,
    pub nz: usize,
    pub sections_y: Option<Vec<f64>>,
    pub z_max: Option<f64>,
    pub grid: Option<GridGeometry>,
    pub grid_window: Option<GridWindow>,
    pub include_material: bool,
    pub include_state: bool,
    pub planes: Vec<PlaneRequest>,
    pub rays: Vec<[f64; 2]>,
    pub points: Vec<P>,
    pub horizons: Vec<HorizonQuery>,
    pub include_profiles: bool,
    pub basement_velocity: f64,
    pub inventory_cells: Option<[usize; 2]>,
}
impl Default for Query {
    fn default() -> Self {
        Self {
            stage: None,
            nx: nx(),
            nz: nz(),
            sections_y: None,
            z_max: None,
            grid: None,
            grid_window: None,
            include_material: false,
            include_state: false,
            planes: vec![],
            rays: vec![],
            points: vec![],
            horizons: vec![],
            include_profiles: false,
            basement_velocity: basement_velocity(),
            inventory_cells: None,
        }
    }
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    #[serde(default)]
    pub options: HistoryOptions,
    pub model: Option<HistorySpec>,
    #[serde(default)]
    pub query: Query,
    #[serde(default)]
    pub include_model: bool,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Slice {
    y: f64,
    x0: f64,
    x1: f64,
    z0: f64,
    z1: f64,
    nx: usize,
    nz: usize,
    velocity: Vec<f64>,
    beds: Vec<i32>,
    lithology: Vec<f64>,
    surface: Vec<f64>,
    basement: Vec<f64>,
}
#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PointSample {
    pub bed: i32,
    pub velocity: f64,
    pub sand_fraction: f64,
    pub grain_fraction: f64,
    pub max_burial: f64,
    pub max_effective_depth: f64,
}
fn sample(
    profile: &Profile,
    z: f64,
    model: &HistoryModel,
    pressure: Option<f64>,
    basement: f64,
) -> Result<PointSample, String> {
    let p = profile.sample(z)?;
    sample_layer(&p, profile.top()?, z, model, pressure, basement)
}
fn sample_layer(
    p: &Layer,
    top: f64,
    z: f64,
    model: &HistoryModel,
    pressure: Option<f64>,
    basement: f64,
) -> Result<PointSample, String> {
    let mut out = PointSample {
        bed: p.bed,
        velocity: if p.bed == WATER { 1500.0 } else { basement },
        sand_fraction: p.fraction,
        grain_fraction: 0.0,
        max_burial: p.burial,
        max_effective_depth: p.loading,
    };
    if p.bed >= 0 {
        out.grain_fraction = p.solid / p.height;
        out.velocity = physics::velocity(
            p.fraction,
            (z - top).max(0.0),
            model.spec.beds[p.bed as usize].carbonate,
            pressure,
            Some(RockHistory {
                max_burial: p.burial,
                max_effective_depth: p.loading,
                bulk_porosity: Some(1.0 - out.grain_fraction),
            }),
        );
    }
    if !out.velocity.is_finite() || out.velocity <= 0.0 {
        return Err("Invalid 3D history velocity".into());
    }
    Ok(out)
}
/// Build rounded display bounds once per ray. Query the exact ownership path
/// near every rounded interface, including collapsed sub-ULP intervals.
struct RaySampler<'a> {
    profile: &'a Profile,
    top: f64,
    intervals: Vec<(f64, f64, &'a Layer)>,
}
impl<'a> RaySampler<'a> {
    fn new(profile: &'a Profile) -> Result<Self, String> {
        Ok(Self {
            profile,
            top: profile.top()?,
            intervals: profile.intervals()?,
        })
    }
    fn sample(
        &self,
        z: f64,
        model: &HistoryModel,
        pressure: Option<f64>,
        basement: f64,
    ) -> Result<PointSample, String> {
        let i = self.intervals.partition_point(|v| v.1 <= z);
        let near = |v: f64| (z - v).abs() <= 16.0 * f64::EPSILON * z.abs().max(v.abs()).max(1.0);
        if near(self.top)
            || self
                .intervals
                .get(i)
                .is_some_and(|v| near(v.0) || near(v.1))
            || i.checked_sub(1)
                .and_then(|j| self.intervals.get(j))
                .is_some_and(|v| near(v.1))
        {
            return sample(self.profile, z, model, pressure, basement);
        }
        if let Some((lo, hi, layer)) = self.intervals.get(i)
            && z >= *lo
            && z < *hi
        {
            return sample_layer(layer, self.top, z, model, pressure, basement);
        }
        sample_layer(
            &Layer::empty(if z < self.top { WATER } else { BASEMENT }, 0.0),
            self.top,
            z,
            model,
            pressure,
            basement,
        )
    }
}
fn key(x: f64, y: f64) -> (u64, u64) {
    (
        if x == 0.0 { 0 } else { x.to_bits() },
        if y == 0.0 { 0 } else { y.to_bits() },
    )
}
fn evaluate_rays(
    model: &HistoryModel,
    n: usize,
    xy: &[[f64; 2]],
) -> Result<(Vec<Arc<Profile>>, EvalStats), String> {
    let chunks = xy.chunks(16).collect::<Vec<_>>();
    let run = |rays: &&[[f64; 2]]| {
        let mut e = model.evaluator();
        let profiles = rays
            .iter()
            .map(|p| e.evaluate(n, p[0], p[1]))
            .collect::<Result<Vec<_>, _>>()?;
        Ok::<_, String>((profiles, e.stats))
    };
    #[cfg(not(target_arch = "wasm32"))]
    let batches = {
        use rayon::prelude::*;
        chunks.par_iter().map(run).collect::<Result<Vec<_>, _>>()?
    };
    #[cfg(target_arch = "wasm32")]
    let batches = chunks.iter().map(run).collect::<Result<Vec<_>, _>>()?;
    let mut profiles = Vec::with_capacity(xy.len());
    let mut stats = EvalStats::default();
    for (p, s) in batches {
        profiles.extend(p);
        stats.add(s);
    }
    Ok((profiles, stats))
}
pub fn request(input: Value) -> Result<Value, String> {
    let r: Request = serde_json::from_value(input).map_err(|e| e.to_string())?;
    let model = HistoryModel::compile(match r.model {
        Some(m) => m,
        None => preset::generate(&r.options)?,
    })?;
    let q = r.query;
    if q.grid.is_none() && q.grid_window.is_some() {
        return Err("A grid window requires a parent grid".into());
    }
    let selection = q
        .grid
        .map(|g| {
            g.validate()?;
            q.grid_window
                .unwrap_or(GridWindow {
                    start: [0; 3],
                    count: [g.nx, g.ny, g.nz],
                })
                .validate(g)
        })
        .transpose()?;
    let b = model.spec.bounds;
    let stage = q.stage.unwrap_or(model.spec.stages.len() - 1);
    let n = *model
        .spec
        .stages
        .get(stage)
        .ok_or("3D replay stage outside history")?;
    let ys = q.sections_y.unwrap_or_else(|| {
        (0..5)
            .map(|i| b.min.y + (b.max.y - b.min.y) * i as f64 / 4.0)
            .collect()
    });
    let z1 = q.z_max.unwrap_or((b.min.z + 3000.0).min(b.max.z));
    if q.nx < 2
        || q.nz < 2
        || q.nx > 1024
        || q.nz > 2048
        || ys.len() > 16
        || !z1.is_finite()
        || z1 <= b.min.z
        || z1 > b.max.z
        || !q.basement_velocity.is_finite()
        || q.basement_velocity < 1500.0
        || q.rays.len() > 4096
        || q.points.len() > 100_000
        || q.horizons.len() > 4096
    {
        return Err("Invalid 3D history sampling request".into());
    }
    let mut xy = Vec::<[f64; 2]>::new();
    let mut indices = HashMap::<(u64, u64), usize>::new();
    let mut add_ray = |x: f64, y: f64| -> Result<usize, String> {
        if !x.is_finite()
            || !y.is_finite()
            || x < b.min.x
            || x > b.max.x
            || y < b.min.y
            || y > b.max.y
        {
            return Err("3D output ray outside requested regional window".into());
        }
        let next = xy.len();
        Ok(*indices.entry(key(x, y)).or_insert_with(|| {
            xy.push([x, y]);
            next
        }))
    };
    let mut slice_rays = vec![];
    for y in &ys {
        let mut ids = Vec::with_capacity(q.nx);
        for i in 0..q.nx {
            ids.push(add_ray(
                b.min.x + (b.max.x - b.min.x) * i as f64 / (q.nx - 1) as f64,
                *y,
            )?);
        }
        slice_rays.push(ids);
    }
    let mut plane_rays = vec![];
    if q.planes.len() > 6 {
        return Err("Too many requested sections".into());
    }
    let mut plane_points = 0usize;
    for plane in &q.planes {
        if !matches!(plane.axis.as_str(), "x" | "y" | "z")
            || !plane.position.is_finite()
            || plane.nu < 2
            || plane.nv < 2
            || plane.nu > 1024
            || plane.nv > 2048
        {
            return Err("Invalid orthogonal section".into());
        }
        let (lo, hi) = match plane.axis.as_str() {
            "x" => (b.min.x, b.max.x),
            "y" => (b.min.y, b.max.y),
            _ => (b.min.z, z1),
        };
        if plane.position < lo || plane.position > hi {
            return Err("Section outside model window".into());
        }
        plane_points += plane.nu * plane.nv;
        if plane_points > 4_000_000 {
            return Err("Section sampling budget exceeded".into());
        }
        let (u0, u1) = if plane.axis == "x" {
            (b.min.y, b.max.y)
        } else {
            (b.min.x, b.max.x)
        };
        let (v0, v1) = if plane.axis == "z" {
            (b.min.y, b.max.y)
        } else {
            (b.min.z, z1)
        };
        let us = (0..plane.nu)
            .map(|i| u0 + (u1 - u0) * i as f64 / (plane.nu - 1) as f64)
            .collect::<Vec<_>>();
        let vs = (0..plane.nv)
            .map(|i| v0 + (v1 - v0) * i as f64 / (plane.nv - 1) as f64)
            .collect::<Vec<_>>();
        let mut ids = vec![];
        for &v in vs.iter().take(if plane.axis == "z" { plane.nv } else { 1 }) {
            for &u in &us {
                let (x, y) = match plane.axis.as_str() {
                    "x" => (plane.position, u),
                    "y" => (u, plane.position),
                    _ => (u, v),
                };
                ids.push(add_ray(x, y)?);
            }
        }
        plane_rays.push((ids, us, vs));
    }
    let mut grid_rays = vec![];
    if let Some(g) = q.grid {
        g.validate()?;
        let window = selection.unwrap();
        if window.points() > 4_000_000 {
            return Err("3D history grid exceeds4million derived points; request a tile".into());
        }
        let end = P {
            x: g.origin.x + (g.nx - 1) as f64 * g.dx,
            y: g.origin.y + (g.ny - 1) as f64 * g.dy,
            z: g.origin.z + (g.nz - 1) as f64 * g.dz,
        };
        if !b.contains(g.origin) || !b.contains(end) {
            return Err("3D derived grid outside regional window".into());
        }
        for j in window.start[1]..window.start[1] + window.count[1] {
            for i in window.start[0]..window.start[0] + window.count[0] {
                grid_rays.push(add_ray(
                    g.origin.x + i as f64 * g.dx,
                    g.origin.y + j as f64 * g.dy,
                )?);
            }
        }
    }
    let mut rays = vec![];
    for p in &q.rays {
        rays.push(add_ray(p[0], p[1])?);
    }
    let mut points = vec![];
    for p in &q.points {
        if !b.contains(*p) {
            return Err("3D query point outside regional window".into());
        }
        points.push(add_ray(p.x, p.y)?);
    }
    let horizon_rays = q
        .horizons
        .iter()
        .map(|h| {
            if h.bed.is_some() == h.unit.is_some()
                || h.bed.is_some_and(|bed| bed >= model.spec.beds.len())
                || h.unit
                    .is_some_and(|unit| !model.spec.beds.iter().any(|bed| bed.unit == unit))
            {
                return Err("Horizon requires one known bed index or depositional unit".into());
            }
            add_ray(h.x, h.y)
        })
        .collect::<Result<Vec<_>, String>>()?;
    if xy.len() > 8192
        || ys.len() * q.nx * q.nz
            + plane_points
            + selection.map_or(0, GridWindow::points)
            + q.points.len()
            + q.horizons.len()
            > 4_000_000
    {
        return Err("3D history projection budget exceeded".into());
    }
    let (profiles, stats) = evaluate_rays(&model, n, &xy)?;
    if profiles.iter().map(|p| p.layers.len()).sum::<usize>() > 2_000_000 {
        return Err("3D returned profile memory budget exceeded".into());
    }
    let samplers = profiles
        .iter()
        .map(|p| RaySampler::new(p))
        .collect::<Result<Vec<_>, _>>()?;
    let mut slices = vec![];
    for (y, ids) in ys.iter().zip(&slice_rays) {
        let mut slice = Slice {
            y: *y,
            x0: b.min.x,
            x1: b.max.x,
            z0: b.min.z,
            z1,
            nx: q.nx,
            nz: q.nz,
            velocity: vec![0.0; q.nx * q.nz],
            beds: vec![WATER; q.nx * q.nz],
            lithology: vec![0.0; q.nx * q.nz],
            surface: vec![],
            basement: vec![],
        };
        for (i, id) in ids.iter().enumerate() {
            let p = &profiles[*id];
            slice.surface.push(p.top()?);
            slice.basement.push(p.basement()?);
            let pressure = model.pressure_at(n, xy[*id][0], xy[*id][1])?;
            for k in 0..q.nz {
                let v = samplers[*id].sample(
                    b.min.z + (z1 - b.min.z) * k as f64 / (q.nz - 1) as f64,
                    &model,
                    pressure,
                    q.basement_velocity,
                )?;
                let at = k * q.nx + i;
                slice.velocity[at] = v.velocity;
                slice.beds[at] = v.bed;
                slice.lithology[at] = if v.bed >= 0 {
                    if model.spec.beds[v.bed as usize].carbonate {
                        -3.0
                    } else {
                        v.sand_fraction
                    }
                } else {
                    v.bed as f64
                };
            }
        }
        slices.push(slice);
    }
    let mut planes = vec![];
    for (plane, (ids, us, vs)) in q.planes.iter().zip(&plane_rays) {
        let mut velocity = Vec::with_capacity(plane.nu * plane.nv);
        let mut beds = Vec::with_capacity(plane.nu * plane.nv);
        let mut lithology = Vec::with_capacity(plane.nu * plane.nv);
        for j in 0..plane.nv {
            for i in 0..plane.nu {
                let id = ids[if plane.axis == "z" {
                    j * plane.nu + i
                } else {
                    i
                }];
                let z = if plane.axis == "z" {
                    plane.position
                } else {
                    vs[j]
                };
                let pressure = model.pressure_at(n, xy[id][0], xy[id][1])?;
                let v = samplers[id].sample(z, &model, pressure, q.basement_velocity)?;
                velocity.push(v.velocity);
                beds.push(v.bed);
                lithology.push(if v.bed < 0 {
                    v.bed as f64
                } else if model.spec.beds[v.bed as usize].carbonate {
                    -3.0
                } else {
                    v.sand_fraction
                });
            }
        }
        planes.push(json!({"axis":plane.axis,"position":plane.position,"nu":plane.nu,"nv":plane.nv,"velocity":velocity,"beds":beds,"lithology":lithology,"zMax":z1,"uCoordinates":us,"vCoordinates":vs}));
    }
    let projection = if let Some(g) = q.grid {
        let window = selection.unwrap();
        let [nx, ny, nz] = window.count;
        let mut velocity = vec![0.0; window.points()];
        let mut beds = vec![WATER; velocity.len()];
        let mut lithology = if q.include_material {
            vec![0.0; velocity.len()]
        } else {
            vec![]
        };
        let mut surface = vec![];
        let mut basement = vec![];
        let mut sand_fraction = vec![];
        let mut grain_fraction = vec![];
        let mut max_burial = vec![];
        let mut max_effective_depth = vec![];
        if q.include_state {
            for values in [
                &mut sand_fraction,
                &mut grain_fraction,
                &mut max_burial,
                &mut max_effective_depth,
            ] {
                values.resize(window.points(), 0.0);
            }
        }
        for (ray, id) in grid_rays.iter().enumerate() {
            let pressure = model.pressure_at(n, xy[*id][0], xy[*id][1])?;
            if q.include_material {
                surface.push(profiles[*id].top()?);
                basement.push(profiles[*id].basement()?);
            }
            for k in 0..nz {
                let v = samplers[*id].sample(
                    g.origin.z + (window.start[2] + k) as f64 * g.dz,
                    &model,
                    pressure,
                    q.basement_velocity,
                )?;
                let at = k * nx * ny + ray;
                velocity[at] = v.velocity;
                beds[at] = v.bed;
                if q.include_state {
                    sand_fraction[at] = v.sand_fraction;
                    grain_fraction[at] = v.grain_fraction;
                    max_burial[at] = v.max_burial;
                    max_effective_depth[at] = v.max_effective_depth;
                }
                if q.include_material {
                    lithology[at] = if v.bed < 0 {
                        v.bed as f64
                    } else if model.spec.beds[v.bed as usize].carbonate {
                        -3.0
                    } else {
                        v.sand_fraction
                    };
                }
            }
        }
        let mut projected = json!({"grid":g,"layout":"Nodal, x fastest then y then z","velocity":velocity,"beds":beds});
        if q.grid_window.is_some() {
            let xs = (window.start[0]..window.start[0] + nx)
                .map(|i| g.origin.x + i as f64 * g.dx)
                .collect::<Vec<_>>();
            let ys = (window.start[1]..window.start[1] + ny)
                .map(|i| g.origin.y + i as f64 * g.dy)
                .collect::<Vec<_>>();
            let zs = (window.start[2]..window.start[2] + nz)
                .map(|i| g.origin.z + i as f64 * g.dz)
                .collect::<Vec<_>>();
            projected["grid"] = json!(GridGeometry {
                nx,
                ny,
                nz,
                origin: P {
                    x: xs[0],
                    y: ys[0],
                    z: zs[0]
                },
                ..g
            });
            projected["samplingGrid"] = json!(g);
            projected["indexWindow"] = json!(window);
            projected["coordinates"] = json!({"x":xs,"y":ys,"z":zs});
        }
        if q.include_material {
            projected["lithology"] = json!(lithology);
            projected["surface"] = json!(surface);
            projected["basement"] = json!(basement);
        }
        if q.include_state {
            projected["sandFraction"] = json!(sand_fraction);
            projected["grainFraction"] = json!(grain_fraction);
            projected["maxBurial"] = json!(max_burial);
            projected["maxEffectiveDepth"] = json!(max_effective_depth);
            projected["stateValidity"] = json!(
                "State fields apply where beds >= 0; water/basement state values are placeholders, not measurements."
            );
        }
        Some(projected)
    } else {
        None
    };
    let point_samples = q
        .points
        .iter()
        .zip(points)
        .map(|(p, id)| {
            sample(
                &profiles[id],
                p.z,
                &model,
                model.pressure_at(n, p.x, p.y)?,
                q.basement_velocity,
            )
        })
        .collect::<Result<Vec<_>, _>>()?;
    if horizon_rays
        .iter()
        .map(|id| profiles[*id].layers.len())
        .sum::<usize>()
        > 2_000_000
    {
        return Err("Horizon contact work budget exceeded".into());
    }
    let horizons = q.horizons.iter().zip(horizon_rays).map(|(h, id)| {
        let mut contacts = Vec::<[f64; 2]>::new();
        let mut previous_matches = false;
        for (lo, hi, layer) in profiles[id].intervals()? {
            let matches = layer.bed >= 0 && (h.bed == Some(layer.bed as usize) || h.unit.is_some_and(|unit| model.spec.beds[layer.bed as usize].unit == unit));
            if matches {
                if previous_matches {
                    contacts.last_mut().unwrap()[1] = hi;
                } else {
                    contacts.push([lo, hi]);
                }
            }
            previous_matches = matches;
        }
        Ok::<_,String>(json!({"x":h.x,"y":h.y,"bed":h.bed,"unit":h.unit,"contacts":contacts,"layout":"All contiguous occurrences, shallowest first; each [top,bottom] in metres, z positive down. Rounded binary64 interfaces."}))
    }).collect::<Result<Vec<_>,_>>()?;
    let ray_output=q.rays.iter().zip(rays).map(|(xy,id)|Ok(json!({"x":xy[0],"y":xy[1],"surface":profiles[id].top()?,"basement":profiles[id].basement()?,"profile":if q.include_profiles{Some(profiles[id].as_ref())}else{None}}))).collect::<Result<Vec<_>,String>>()?;
    let inventory=q.inventory_cells.map(|[nx,ny]|{
        let coarse=super::audit::inventory(&model,stage,nx,ny)?;
        let fine=super::audit::inventory(&model,stage,nx.checked_mul(2).ok_or("Inventory size overflow")?,ny.checked_mul(2).ok_or("Inventory size overflow")?)?;
        Ok::<_,String>(json!({"method":"Cell-midpoint integration of exact material-ray cuts in the displayed open box; no full3D voxelization","cells":[nx,ny],"refinedCells":[2*nx,2*ny],"coarse":coarse,"refined":fine,"grainRefinementDifference":(fine.grain-coarse.grain).abs(),"interpretation":"Refinement difference is an error indicator, not a certified error bound or a closed-domain conservation residual. Regional boundary inflow/outflow may change this inventory."}))
    }).transpose()?;
    let mut output = json!({"engine":"rust-history3d-v1","dimensions":3,"model":"Regional3D prescribed kinematics, supported deposition and erosion, vertical drained compaction and irreversible burial/loading histories. No3D stress-equilibrium or pore-fluid-flow PDE.","boundary":"Analytically specified regional continuation outside the output window; water and basement tails are explicit. A displayed box is an open observation window.","accounting":"Per-ray per-bed local deposition/erosion/compaction constituent budgets; 3D faults use volume-preserving inverse maps. These are not exact closed-box3D inventory measurements.","bounds":b,"options":r.options,"stage":stage,"stages":model.spec.stages,"eventsApplied":n,"eventNames":model.spec.events[..n].iter().map(|e|e.name()).collect::<Vec<_>>(),"beds":model.spec.beds,"slices":slices,"projection":projection,"rays":ray_output,"points":point_samples,"stats":{"uniqueRays":xy.len(),"retainedProfileLayers":profiles.iter().map(|p|p.layers.len()).sum::<usize>(),"authoritativeVoxels":0,"evaluation":stats},"sourceModel":if r.include_model{Some(&model.spec)}else{None}});
    if !planes.is_empty() {
        output["planes"] = json!(planes);
    }
    if !horizons.is_empty() {
        output["horizons"] = json!(horizons);
    }
    output["inventoryQuadrature"] = inventory.unwrap_or(Value::Null);
    Ok(output)
}
