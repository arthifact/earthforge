use earthforge_core::api;
use serde_json::{Value, json};

#[test]
fn windows_preserve_global_coordinates_and_all_fields_exactly() {
    let grid = json!({"nx":19,"ny":13,"nz":31,"dx":10000.0/48.0,"dy":10000.0/47.0,"dz":3000.0/63.0,"origin":{"x":13.7,"y":17.3,"z":0.1}});
    let base = json!({"kind":"history3d","options":{"geology":"detailed","steps":6,"faults":2,"seed":1001,"exhumation":true,"overpressure":true},"includeModel":true,"query":{"sectionsY":[],"grid":grid,"includeMaterial":true,"includeState":true}});
    let full = api::request(base.clone()).unwrap();
    for (x, y, z, nx, ny, nz) in [
        (0, 0, 0, 7, 5, 31),
        (7, 5, 9, 9, 7, 17),
        (18, 12, 30, 1, 1, 1),
    ] {
        let mut request = base.clone();
        request["query"]["gridWindow"] = json!({"start":[x,y,z],"count":[nx,ny,nz]});
        let tile = api::request(request).unwrap();
        assert_eq!(tile["sourceModel"], full["sourceModel"]);
        let p = &tile["projection"];
        assert_eq!(p["samplingGrid"], grid);
        for (a, start, count) in [("x", x, nx), ("y", y, ny), ("z", z, nz)] {
            let step = grid[format!("d{a}")].as_f64().unwrap();
            let origin = grid["origin"][a].as_f64().unwrap();
            for i in 0..count {
                assert_eq!(
                    p["coordinates"][a][i].as_f64().unwrap(),
                    origin + (start + i) as f64 * step
                );
            }
        }
        let mut points = vec![];
        for k in 0..nz {
            for j in 0..ny {
                for i in 0..nx {
                    let at = k * nx * ny + j * nx + i;
                    let global = (z + k) * 19 * 13 + (y + j) * 19 + x + i;
                    for field in [
                        "velocity",
                        "beds",
                        "lithology",
                        "sandFraction",
                        "grainFraction",
                        "maxBurial",
                        "maxEffectiveDepth",
                    ] {
                        assert_eq!(
                            p[field][at], full["projection"][field][global],
                            "{field} {global}"
                        );
                    }
                    points.push(json!({"x":p["coordinates"]["x"][i],"y":p["coordinates"]["y"][j],"z":p["coordinates"]["z"][k]}));
                }
            }
        }
        let exact=api::request(json!({"kind":"history3d","model":full["sourceModel"],"query":{"sectionsY":[],"points":points}})).unwrap();
        for i in 0..nx * ny * nz {
            assert_eq!(p["velocity"][i], exact["points"][i]["velocity"]);
            assert_eq!(p["beds"][i], exact["points"][i]["bed"]);
            for field in [
                "sandFraction",
                "grainFraction",
                "maxBurial",
                "maxEffectiveDepth",
            ] {
                assert_eq!(p[field][i], exact["points"][i][field]);
            }
        }
        for j in 0..ny {
            for i in 0..nx {
                for field in ["surface", "basement"] {
                    assert_eq!(
                        p[field][j * nx + i],
                        full["projection"][field][(y + j) * 19 + x + i]
                    );
                }
            }
        }
    }
}

#[test]
fn window_budget_applies_to_selected_nodes_and_checks_parent_extent() {
    let mut r = json!({"kind":"history3d","options":{"steps":2,"faults":0},"query":{"sectionsY":[],"grid":{"nx":1001,"ny":1001,"nz":621,"dx":10,"dy":10,"dz":10,"origin":{"x":0,"y":0,"z":0}},"gridWindow":{"start":[999,900,618],"count":[2,1,3]}}});
    let v = api::request(r.clone()).unwrap();
    assert_eq!(v["projection"]["velocity"].as_array().unwrap().len(), 6);
    assert_eq!(v["stats"]["uniqueRays"], 2);
    for w in [
        json!({"start":[1000,0,0],"count":[2,1,1]}),
        json!({"start":[0,0,0],"count":[0,1,1]}),
        json!({"start":[0,0,0],"count":[1001,1001,621]}),
        json!({"start":[18446744073709551615_u64,0,0],"count":[2,1,1]}),
    ] {
        r["query"]["gridWindow"] = w;
        assert!(api::request(r.clone()).is_err());
    }
    r["query"]["gridWindow"] = json!({"start":[0,0,0],"count":[1,1,1]});
    r["query"]["grid"]["nx"] = json!(1002);
    assert!(api::request(r.clone()).is_err());
    r["query"].as_object_mut().unwrap().remove("grid");
    assert!(api::request(r).is_err());
}

#[test]
fn exact_interface_samples_retain_ownership_in_windows() {
    let z0 = 13.7;
    let dz = 1000.0 / 33.0;
    let top = z0 + 7.0 * dz;
    let model = json!({"bounds":{"min":{"x":0,"y":0,"z":0},"max":{"x":1000,"y":1000,"z":2000}},"initialSurface":{"value":top},"initialLayers":[],"beds":[],"events":[],"materialStep":10});
    let q = json!({"sectionsY":[],"includeMaterial":true,"grid":{"nx":7,"ny":5,"nz":31,"dx":1000.0/13.0,"dy":1000.0/17.0,"dz":dz,"origin":{"x":11.1,"y":12.2,"z":z0}}});
    let full = api::request(json!({"kind":"history3d","model":model,"query":q})).unwrap();
    let mut tile_q = q;
    tile_q["gridWindow"] = json!({"start":[1,2,6],"count":[3,2,3]});
    let tile = api::request(json!({"kind":"history3d","model":model,"query":tile_q})).unwrap();
    assert_eq!(tile["projection"]["coordinates"]["z"][1], json!(top));
    for k in 0..3 {
        for j in 0..2 {
            for i in 0..3 {
                assert_eq!(
                    tile["projection"]["beds"][k * 6 + j * 3 + i],
                    full["projection"]["beds"][(k + 6) * 35 + (j + 2) * 7 + i + 1]
                );
            }
        }
    }
}

#[test]
fn capabilities_describe_actual_regional_history_support() {
    let v: Value = api::request(json!({"kind":"capabilities"})).unwrap();
    assert_eq!(v["schema"], "earthforge-capabilities-v1");
    assert_eq!(v["history3d"]["globallyIndexedGridWindows"], true);
    assert_eq!(
        api::request(json!({"kind":"version"})).unwrap()["fullBasinDimensions"],
        json!([2, 3])
    );
}

#[test]
fn bed_contacts_report_all_occurrences_and_merge_constitutive_subdivisions() {
    let bed = json!({"unit":0,"phase":"independent analytical fixture","a":0.4,"b":0,"c":0,"d":100,"carbonate":false});
    let layer = |bed, height| json!({"bed":bed,"height":height,"solid":height*0.6,"fraction":0.4,"burial":1000,"loading":800});
    let model = json!({"bounds":{"min":{"x":0,"y":0,"z":0},"max":{"x":1000,"y":1000,"z":2000}},"initialSurface":{"value":100},"initialLayers":[layer(0,20.0),layer(0,30.0),layer(1,75.0),layer(0,25.0)],"beds":[bed.clone(),bed],"events":[],"materialStep":10});
    let request = json!({"kind":"history3d","model":model,"query":{"sectionsY":[],"horizons":[{"x":200,"y":300,"bed":0},{"x":200,"y":300,"bed":1}]}});
    let v = api::request(request.clone()).unwrap();
    assert_eq!(
        v["horizons"][0]["contacts"],
        json!([[100.0, 150.0], [225.0, 250.0]])
    );
    assert_eq!(v["horizons"][1]["contacts"], json!([[150.0, 225.0]]));
    assert_eq!(v["stats"]["uniqueRays"], 1);
    let mut invalid = request;
    invalid["query"]["horizons"][0]["bed"] = json!(2);
    assert!(api::request(invalid).is_err());
}

#[test]
fn depositional_unit_contacts_merge_adjacent_beds_and_reject_ambiguous_selectors() {
    let bed = |unit| json!({"unit":unit,"phase":"analytical fixture","a":0.4,"b":0,"c":0,"d":100,"carbonate":false});
    let layer = |bed, height| json!({"bed":bed,"height":height,"solid":height*0.6,"fraction":0.4,"burial":1000,"loading":800});
    let model = json!({"bounds":{"min":{"x":0,"y":0,"z":0},"max":{"x":1000,"y":1000,"z":2000}},"initialSurface":{"value":100},"initialLayers":[layer(0,20.0),layer(1,30.0),layer(2,75.0),layer(0,25.0)],"beds":[bed(0),bed(0),bed(1)],"events":[],"materialStep":10});
    let mut request = json!({"kind":"history3d","model":model,"query":{"sectionsY":[],"horizons":[{"x":200,"y":300,"unit":0}]}});
    assert_eq!(
        api::request(request.clone()).unwrap()["horizons"][0]["contacts"],
        json!([[100.0, 150.0], [225.0, 250.0]])
    );
    request["query"]["horizons"][0]["bed"] = json!(0);
    assert!(api::request(request).is_err());
}
