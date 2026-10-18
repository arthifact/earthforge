use earthforge_core::{
    api,
    history3d::{
        model::{
            FaciesFront, HistoryEvent as E, HistoryModel, HistorySpec, SpatialField as F,
            StrikeBend,
        },
        preset::{self, HistoryOptions},
    },
    material::{Bed, Layer},
    polyhedron::Aabb,
    space::{PlanarFault, WorldPoint as P},
};
use serde_json::json;
fn p(x: f64, y: f64, z: f64) -> P {
    P { x, y, z }
}
fn beds() -> Vec<Bed> {
    (0..3)
        .map(|unit| Bed {
            unit,
            phase: "independent fixture".into(),
            a: 0.4,
            b: 0.0,
            c: 0.0,
            d: 100.0,
            carbonate: unit == 2,
        })
        .collect()
}
fn initial() -> Vec<Layer> {
    (0..3)
        .map(|i| {
            let mut l = Layer::empty(i, 150.0 + 50.0 * i as f64);
            l.fraction = 0.2 + 0.25 * i as f64;
            l.solid = l.height * 0.6;
            l.burial = 1300.0;
            l.loading = 1000.0;
            l
        })
        .collect()
}
fn fault() -> PlanarFault {
    let a = 0.6_f64;
    PlanarFault {
        point: p(400.0, 500.0, 440.0),
        normal: p(a, 0.0, 0.8),
        slip: p(-80.0, 40.0, 60.0),
    }
}
fn bend() -> StrikeBend {
    StrikeBend {
        amplitude: 170.0,
        wavelength: 1100.0,
        phase: 0.4,
    }
}
fn spec(events: Vec<E>) -> HistorySpec {
    HistorySpec {
        bounds: Aabb {
            min: p(0.0, 0.0, 0.0),
            max: p(1000.0, 1000.0, 1500.0),
        },
        initial_surface: F::constant(200.0),
        initial_layers: initial(),
        beds: beds(),
        events,
        material_step: 10.0,
        stages: vec![],
    }
}
fn offset(b: StrikeBend, y: f64) -> f64 {
    b.amplitude * (std::f64::consts::TAU * y / b.wavelength + b.phase).sin()
}
// Independent point-space inverse. Does not call evaluator cuts, profile splices,
// StrikeBend::offset or the engine's fault helper.
fn inverse(q: P, f: PlanarFault, b: StrikeBend) -> P {
    let x = q.x - offset(b, q.y);
    let d = (x - f.point.x) * f.normal.x
        + (q.y - f.point.y) * f.normal.y
        + (q.z - f.point.z) * f.normal.z;
    if d < 0.0 {
        let y = q.y - f.slip.y;
        p(x - f.slip.x + offset(b, y), y, q.z - f.slip.z)
    } else {
        q
    }
}
#[test]
fn swept_fault_compositions_match_independent_xyz_inverse_occupancy() {
    let f = fault();
    let b = bend();
    let mut f2 = f;
    f2.point = p(700.0, 500.0, 650.0);
    f2.slip = p(40.0, -25.0, -30.0);
    let b2 = StrikeBend { phase: 1.7, ..b };
    let model = HistoryModel::compile(spec(vec![
        E::SweptFault { fault: f, bend: b },
        E::SweptFault {
            fault: f2,
            bend: b2,
        },
    ]))
    .unwrap();
    let mut eval = model.evaluator();
    for i in 0..4001 {
        let q = p(
            ((i * 137) % 1001) as f64 + 0.013,
            ((i * 277) % 1001) as f64 + 0.017,
            ((i * 97) % 1401) as f64 + 0.019,
        );
        let source = inverse(inverse(q, f2, b2), f, b);
        let expected = if source.z < 200.0 {
            -1
        } else if source.z < 350.0 {
            0
        } else if source.z < 550.0 {
            1
        } else if source.z < 800.0 {
            2
        } else {
            -2
        };
        let profile = eval.evaluate(2, q.x, q.y).unwrap();
        let actual = profile.sample(q.z).unwrap();
        assert_eq!(actual.bed, expected, "{i}: {q:?} -> {source:?}");
        if expected >= 0 {
            assert_eq!(actual.burial, 1300.0_f64.max(q.z - profile.top().unwrap()));
            assert!((actual.solid / actual.height - 0.6).abs() < 1e-12);
        }
    }
}
#[test]
fn swept_map_is_volume_preserving_and_invertible() {
    let f = fault();
    let b = bend();
    let forward = |q: P| {
        let y = q.y + f.slip.y;
        p(
            q.x - offset(b, q.y) + f.slip.x + offset(b, y),
            y,
            q.z + f.slip.z,
        )
    };
    for i in 0..501 {
        let q = p((i * 73 % 1000) as f64, (i * 127 % 1000) as f64, -1000.0);
        let r = forward(q);
        let back = inverse(r, f, b);
        assert!(
            (back.x - q.x).abs() < 1e-10
                && (back.y - q.y).abs() < 1e-10
                && (back.z - q.z).abs() < 1e-10
        );
        let h = 0.01;
        let a = forward(p(q.x + h, q.y, q.z));
        let c = forward(p(q.x, q.y + h, q.z));
        let d = forward(p(q.x, q.y, q.z + h));
        let det = ((a.x - r.x) * ((c.y - r.y) * (d.z - r.z) - (c.z - r.z) * (d.y - r.y))
            - (a.y - r.y) * ((c.x - r.x) * (d.z - r.z) - (c.z - r.z) * (d.x - r.x))
            + (a.z - r.z) * ((c.x - r.x) * (d.y - r.y) - (c.y - r.y) * (d.x - r.x)))
            / h.powi(3);
        assert!((det - 1.0).abs() < 1e-8, "det={det}");
    }
}
#[test]
fn curved_pruning_and_zero_bend_reduction_preserve_exact_profiles() {
    let f = fault();
    let m = HistoryModel::compile(spec(vec![
        E::SweptFault {
            fault: f,
            bend: bend(),
        },
        E::Compact {},
    ]))
    .unwrap();
    let mut pruned = m.evaluator();
    let mut full = m.evaluator_unpruned();
    for i in 0..101 {
        let (x, y) = (
            (i * 257 % 24000) as f64 - 12000.0,
            (i * 139 % 24000) as f64 - 12000.0,
        );
        let a = pruned.evaluate(2, x, y).unwrap();
        let b = full.evaluate(2, x, y).unwrap();
        assert_eq!(a.layers, b.layers);
        assert_eq!(a.top_terms, b.top_terms);
    }
    let a = HistoryModel::compile(spec(vec![E::Fault { fault: f }])).unwrap();
    let b = HistoryModel::compile(spec(vec![E::SweptFault {
        fault: f,
        bend: StrikeBend {
            amplitude: 0.0,
            ..bend()
        },
    }]))
    .unwrap();
    for y in [0.0, 137.0, 1000.0] {
        let x = 512.0;
        assert_eq!(
            a.evaluator().evaluate(1, x, y).unwrap().layers,
            b.evaluator().evaluate(1, x, y).unwrap().layers
        );
    }
}
#[test]
fn spatial_front_reduces_to_shared_two_dimensional_facies_law() {
    let bed = Bed {
        unit: 0,
        phase: "front".into(),
        a: 0.5,
        b: -0.35,
        c: 4000.0,
        d: 1200.0,
        carbonate: false,
    };
    let f = F {
        value: bed.a,
        fronts: vec![FaciesFront {
            amplitude: bed.b,
            centre: bed.c,
            width: bed.d,
            skew_y: 0.0,
        }],
        ..Default::default()
    };
    for i in 0..101 {
        let x = i as f64 * 100.0;
        assert_eq!(f.at(x, 723.0).unwrap(), bed.fraction(x));
    }
}
#[test]
fn detailed_recipes_close_budgets_and_preserve_point_grid_ownership() {
    for setting in ["extension", "compression"] {
        let o = HistoryOptions {
            seed: 908054,
            steps: 6,
            faults: 2,
            geology: "detailed".into(),
            setting: setting.into(),
            exhumation: true,
            overpressure: true,
            ..Default::default()
        };
        let s = preset::generate(&o).unwrap();
        assert!(s.beds.len() >= 18);
        assert!(s.events.iter().any(|e| matches!(
            e,
            E::Deposit {
                fill_to: Some(_),
                ..
            }
        )));
        assert_eq!(
            s.events
                .iter()
                .filter(|e| matches!(e, E::SweptFault { .. }))
                .count(),
            4
        );
        let mut points = vec![];
        for k in 0..31 {
            for j in 0..5 {
                for i in 0..7 {
                    points.push(p(i as f64 * 1600.0, j as f64 * 2400.0, k as f64 * 100.0));
                }
            }
        }
        let result=api::request(json!({"kind":"history3d","model":s,"query":{"sectionsY":[],"includeMaterial":true,"grid":{"nx":7,"ny":5,"nz":31,"dx":1600,"dy":2400,"dz":100,"origin":{"x":0,"y":0,"z":0}},"points":points}})).unwrap();
        assert!(
            result["stats"]["evaluation"]["maxNormalizedGrainResidual"]
                .as_f64()
                .unwrap()
                <= 1.0
        );
        for (i, q) in result["points"].as_array().unwrap().iter().enumerate() {
            assert_eq!(q["bed"], result["projection"]["beds"][i]);
            assert_eq!(q["velocity"], result["projection"]["velocity"][i]);
        }
        assert!(
            result["projection"]["beds"]
                .as_array()
                .unwrap()
                .iter()
                .any(|v| v.as_i64().unwrap() >= 0)
        );
    }
    for steps in [6, 12, 18, 24] {
        HistoryModel::compile(
            preset::generate(&HistoryOptions {
                steps,
                faults: 4,
                geology: "detailed".into(),
                ..Default::default()
            })
            .unwrap(),
        )
        .unwrap();
    }
}

#[test]
fn orthogonal_sections_match_exact_world_queries_and_enforce_total_work_budget() {
    let model = preset::generate(&HistoryOptions {
        steps: 6,
        faults: 2,
        geology: "detailed".into(),
        ..Default::default()
    })
    .unwrap();
    let planes = ["x", "y", "z"].map(
        |axis| json!({"axis":axis,"position":if axis=="z"{912.345}else{3123.45},"nu":11,"nv":13}),
    );
    let out = api::request(
        json!({"kind":"history3d","model":model,"query":{"sectionsY":[],"planes":planes}}),
    )
    .unwrap();
    let mut points = vec![];
    for plane in out["planes"].as_array().unwrap() {
        for v in plane["vCoordinates"].as_array().unwrap() {
            for u in plane["uCoordinates"].as_array().unwrap() {
                let (u, v, z) = (
                    u.as_f64().unwrap(),
                    v.as_f64().unwrap(),
                    plane["position"].as_f64().unwrap(),
                );
                points.push(match plane["axis"].as_str().unwrap() {
                    "x" => p(z, u, v),
                    "y" => p(u, z, v),
                    _ => p(u, v, z),
                });
            }
        }
    }
    let exact = api::request(
        json!({"kind":"history3d","model":model,"query":{"sectionsY":[],"points":points}}),
    )
    .unwrap();
    for a in 0..3 {
        for i in 0..143 {
            assert_eq!(
                out["planes"][a]["beds"][i],
                exact["points"][a * 143 + i]["bed"]
            );
            assert_eq!(
                out["planes"][a]["velocity"][i],
                exact["points"][a * 143 + i]["velocity"]
            );
        }
    }
    assert!(api::request(json!({"kind":"history3d","query":{"sectionsY":[],"planes":[{"axis":"y","position":20000,"nu":5,"nv":5}]}})).is_err());
    assert!(api::request(json!({"kind":"history3d","query":{"sectionsY":[],"planes":[{"axis":"y","position":5000,"nu":1024,"nv":2048}],"grid":{"nx":65,"ny":65,"nz":481,"dx":156.25,"dy":156.25,"dz":6.25,"origin":{"x":0,"y":0,"z":0}}}})).is_err());
}

#[test]
fn accommodation_bounds_match_unpruned_full_material_histories() {
    for setting in ["extension", "compression"] {
        let model = HistoryModel::compile(
            preset::generate(&HistoryOptions {
                steps: 12,
                faults: 2,
                setting: setting.into(),
                geology: "detailed".into(),
                overpressure: true,
                exhumation: true,
                ..Default::default()
            })
            .unwrap(),
        )
        .unwrap();
        let n = model.spec.events.len();
        let mut pruned = model.evaluator();
        let mut full = model.evaluator_unpruned();
        for i in 0..121 {
            let (x, y) = ((i % 11) as f64 * 1000.0, (i / 11) as f64 * 1000.0);
            let a = pruned.evaluate(n, x, y).unwrap();
            let b = full.evaluate(n, x, y).unwrap();
            assert_eq!(a.layers, b.layers, "{setting} {x} {y}");
            assert_eq!(a.top_terms, b.top_terms);
        }
        assert!(pruned.stats.pruned_fault_branches > 0);
    }
}

#[test]
fn curved_transport_advects_facies_instead_of_resampling_it_at_destination() {
    let f = fault();
    let b = bend();
    let mut s = spec(vec![
        E::Deposit {
            bed: 0,
            thickness: Some(F::constant(200.0)),
            fill_to: None,
            max_thickness: None,
            fraction: Some(F {
                value: 0.5,
                fronts: vec![FaciesFront {
                    amplitude: -0.3,
                    centre: 500.0,
                    width: 200.0,
                    skew_y: 0.1,
                }],
                ..Default::default()
            }),
            compact: false,
        },
        E::SweptFault { fault: f, bend: b },
    ]);
    s.initial_layers.clear();
    s.initial_surface = F::constant(500.0);
    let m = HistoryModel::compile(s).unwrap();
    let mut eval = m.evaluator();
    let mut sediment = 0;
    for i in 0..2001 {
        let q = p(
            ((i * 137) % 1000) as f64 + 0.013,
            ((i * 277) % 1000) as f64 + 0.017,
            250.0 + ((i * 97) % 400) as f64 + 0.019,
        );
        let src = inverse(q, f, b);
        let value = eval.evaluate(2, q.x, q.y).unwrap().sample(q.z).unwrap();
        let expected = if src.z < 300.0 {
            -1
        } else if src.z < 500.0 {
            0
        } else {
            -2
        };
        assert_eq!(value.bed, expected);
        if expected == 0 {
            sediment += 1;
            let fraction = 0.5 - 0.3 * ((src.x + 0.1 * src.y - 500.0) / 200.0).tanh();
            assert!(
                (value.fraction - fraction).abs() < 2e-14,
                "{} {}",
                value.fraction,
                fraction
            );
        }
    }
    assert!(sediment > 500);
}
