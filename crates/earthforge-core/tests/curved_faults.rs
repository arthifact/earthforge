use earthforge_core::{
    history3d::{
        curved::DipCurve,
        model::{HistoryEvent as E, HistoryModel, HistorySpec, SpatialField as F, StrikeBend},
        preset::{self, HistoryOptions},
    },
    material::{Bed, Layer},
    polyhedron::Aabb,
    space::{PlanarFault, WorldPoint as P},
};
fn p(x: f64, y: f64, z: f64) -> P {
    P { x, y, z }
}
fn fault() -> PlanarFault {
    PlanarFault {
        point: p(430., 470., 440.),
        normal: p(0.6, 0., 0.8),
        slip: p(-80., 40., 60.),
    }
}
fn bend() -> StrikeBend {
    StrikeBend {
        amplitude: 170.,
        wavelength: 1100.,
        phase: 0.4,
    }
}
fn curve() -> DipCurve {
    DipCurve {
        strength: 0.7,
        length: 300.,
    }
}
fn spec(events: Vec<E>) -> HistorySpec {
    HistorySpec {
        bounds: Aabb {
            min: p(0., 0., 0.),
            max: p(1000., 1000., 1600.),
        },
        initial_surface: F::constant(200.),
        initial_layers: (0..3)
            .map(|i| {
                let mut l = Layer::empty(i, 150. + 50. * i as f64);
                l.fraction = 0.2 + 0.25 * i as f64;
                l.solid = l.height * 0.6;
                l.burial = 1300.;
                l.loading = 1000.;
                l
            })
            .collect(),
        beds: (0..3)
            .map(|unit| Bed {
                unit,
                phase: "independent curved fixture".into(),
                a: 0.4,
                b: 0.,
                c: 0.,
                d: 100.,
                carbonate: unit == 2,
            })
            .collect(),
        events,
        material_step: 10.,
        stages: vec![],
    }
}
// Independent point-space algebra: deliberately does not use engine shears,
// DipCurve::offset, profile splicing, or fault inverse helpers.
fn wave(b: StrikeBend, y: f64) -> f64 {
    b.amplitude * (std::f64::consts::TAU * y / b.wavelength + b.phase).sin()
}
fn height(f: PlanarFault, c: DipCurve, x: f64, y: f64) -> f64 {
    let h = (f.normal.x * f.normal.x + f.normal.y * f.normal.y).sqrt();
    let s = -((x - f.point.x) * f.normal.x + (y - f.point.y) * f.normal.y) / h;
    -(h / f.normal.z) * c.strength * ((s * s + c.length * c.length).sqrt() - c.length)
}
fn inverse(q: P, f: PlanarFault, b: StrikeBend, c: DipCurve) -> P {
    let x = q.x - wave(b, q.y);
    let z = q.z - height(f, c, x, q.y);
    if (x - f.point.x) * f.normal.x + (q.y - f.point.y) * f.normal.y + (z - f.point.z) * f.normal.z
        < 0.
    {
        let y = q.y - f.slip.y;
        let sx = x - f.slip.x;
        p(sx + wave(b, y), y, z - f.slip.z + height(f, c, sx, y))
    } else {
        q
    }
}
fn forward_branch(q: P, f: PlanarFault, b: StrikeBend, c: DipCurve) -> P {
    let x = q.x - wave(b, q.y);
    let y = q.y + f.slip.y;
    p(
        x + f.slip.x + wave(b, y),
        y,
        q.z - height(f, c, x, q.y) + f.slip.z + height(f, c, x + f.slip.x, y),
    )
}
#[test]
fn intersecting_curved_faults_match_independent_occupancy_and_carried_memory() {
    let f = fault();
    let b = bend();
    let c = curve();
    let f2 = PlanarFault {
        point: p(710., 480., 660.),
        normal: p(0.48, 0.36, 0.8),
        slip: p(64., 48., -60.),
    };
    let b2 = StrikeBend { phase: 1.7, ..b };
    let m = HistoryModel::compile(spec(vec![
        E::ListricFault {
            fault: f,
            bend: Some(b),
            curve: c,
        },
        E::ListricFault {
            fault: f2,
            bend: Some(b2),
            curve: c,
        },
    ]))
    .unwrap();
    let mut e = m.evaluator();
    for i in 0..4001 {
        let q = p(
            ((i * 137) % 1001) as f64 + 0.013,
            ((i * 277) % 1001) as f64 + 0.017,
            ((i * 97) % 1401) as f64 + 0.019,
        );
        let src = inverse(inverse(q, f2, b2, c), f, b, c);
        let expected = if src.z < 200. {
            -1
        } else if src.z < 350. {
            0
        } else if src.z < 550. {
            1
        } else if src.z < 800. {
            2
        } else {
            -2
        };
        let profile = e.evaluate(2, q.x, q.y).unwrap();
        let l = profile.sample(q.z).unwrap();
        assert_eq!(l.bed, expected, "{q:?} -> {src:?}");
        if expected >= 0 {
            assert!((l.solid / l.height - 0.6).abs() < 1e-12);
            assert_eq!(l.fraction, 0.2 + 0.25 * expected as f64);
            assert!(l.burial >= 1300.);
            assert!(l.loading >= 1000.);
            assert!((l.offset_z - (q.z - src.z)).abs() < 1e-8);
        }
    }
}
#[test]
fn moving_map_is_invertible_volume_preserving_and_tangent_to_curved_surface() {
    let f = fault();
    let b = bend();
    let c = curve();
    for i in 0..501 {
        let q = p((i * 73 % 1000) as f64, (i * 127 % 1000) as f64, -1000.);
        let r = forward_branch(q, f, b, c);
        let back = inverse(r, f, b, c);
        for err in [back.x - q.x, back.y - q.y, back.z - q.z] {
            assert!(err.abs() < 1e-8);
        }
        let h = 0.01;
        let a = forward_branch(p(q.x + h, q.y, q.z), f, b, c);
        let v = forward_branch(p(q.x, q.y + h, q.z), f, b, c);
        let d = forward_branch(p(q.x, q.y, q.z + h), f, b, c);
        let det = ((a.x - r.x) * ((v.y - r.y) * (d.z - r.z) - (v.z - r.z) * (d.y - r.y))
            - (a.y - r.y) * ((v.x - r.x) * (d.z - r.z) - (v.z - r.z) * (d.x - r.x))
            + (a.z - r.z) * ((v.x - r.x) * (d.y - r.y) - (v.y - r.y) * (d.x - r.x)))
            / h.powi(3);
        assert!((det - 1.).abs() < 1e-7, "{det}");
    }
    for x in [0., 200., 400., 800.] {
        let y = 350.;
        let xr = x - wave(b, y);
        let z = f.point.z
            - ((xr - f.point.x) * f.normal.x + (y - f.point.y) * f.normal.y) / f.normal.z
            + height(f, c, xr, y);
        let q = forward_branch(p(x, y, z), f, b, c);
        let rx = q.x - wave(b, q.y);
        let flat = q.z - height(f, c, rx, q.y);
        assert!(
            ((rx - f.point.x) * f.normal.x
                + (q.y - f.point.y) * f.normal.y
                + (flat - f.point.z) * f.normal.z)
                .abs()
                < 1e-8
        );
    }
}
#[test]
fn zero_curvature_reduces_exactly_and_zero_slip_is_identity() {
    let f = fault();
    let b = bend();
    let a = HistoryModel::compile(spec(vec![E::SweptFault { fault: f, bend: b }])).unwrap();
    let c = HistoryModel::compile(spec(vec![E::ListricFault {
        fault: f,
        bend: Some(b),
        curve: DipCurve {
            strength: 0.,
            ..curve()
        },
    }]))
    .unwrap();
    let base = HistoryModel::compile(spec(vec![])).unwrap();
    let zero = HistoryModel::compile(spec(vec![E::ListricFault {
        fault: PlanarFault {
            slip: P::default(),
            ..f
        },
        bend: Some(b),
        curve: curve(),
    }]))
    .unwrap();
    for i in 0..101 {
        let x = (i * 257 % 1000) as f64;
        let y = (i * 139 % 1000) as f64;
        let pa = a.evaluator().evaluate(1, x, y).unwrap();
        let pc = c.evaluator().evaluate(1, x, y).unwrap();
        assert_eq!(pa.layers, pc.layers);
        assert_eq!(pa.top_terms, pc.top_terms);
        let p0 = base.evaluator().evaluate(0, x, y).unwrap();
        let pz = zero.evaluator().evaluate(1, x, y).unwrap();
        assert_eq!(p0.layers, pz.layers);
        assert_eq!(p0.top_terms, pz.top_terms);
        for z in [10., 201., 400., 701., 1200.] {
            assert_eq!(p0.sample(z).unwrap().bed, pz.sample(z).unwrap().bed);
            let original = p0.sample(z).unwrap();
            let moved = pz.sample(z).unwrap();
            if original.bed < 0 {
                continue;
            }
            // A splice may partition an interval without changing its material.
            assert!((original.solid / original.height - moved.solid / moved.height).abs() < 1e-12);
            assert_eq!(original.fraction, moved.fraction);
            assert_eq!(original.burial, moved.burial);
            assert_eq!(original.loading, moved.loading);
        }
    }
}
#[test]
fn curved_branch_pruning_is_exact_inside_and_outside_regional_bounds() {
    let f = fault();
    let b = bend();
    let m = HistoryModel::compile(spec(vec![
        E::ListricFault {
            fault: f,
            bend: Some(b),
            curve: curve(),
        },
        E::Compact {},
    ]))
    .unwrap();
    let mut a = m.evaluator();
    let mut z = m.evaluator_unpruned();
    for i in 0..151 {
        let x = (i * 257 % 24000) as f64 - 12000.;
        let y = (i * 139 % 24000) as f64 - 12000.;
        let p = a.evaluate(2, x, y).unwrap();
        let q = z.evaluate(2, x, y).unwrap();
        assert_eq!(p.layers, q.layers);
        assert_eq!(p.top_terms, q.top_terms);
    }
}
#[test]
fn curve_flattens_down_dip_and_invalid_geometry_is_rejected() {
    let f = fault();
    let c = curve();
    let slope = |s: f64| 0.75 * (1. - c.strength * s / (s * s + c.length * c.length).sqrt());
    assert!(slope(-1000.) > slope(0.) && slope(0.) > slope(1000.) && slope(1000.) > 0.);
    for c in [
        DipCurve { strength: 1., ..c },
        DipCurve { length: 0., ..c },
        DipCurve {
            strength: f64::NAN,
            ..c
        },
    ] {
        assert!(c.validate(f).is_err());
    }
    assert!(
        c.validate(PlanarFault {
            normal: p(0., 0., 1.),
            slip: p(1., 0., 0.),
            ..f
        })
        .is_err()
    );
}
#[test]
fn versioned_recipe_exposes_curve_dip_and_slip_without_changing_v1_recipes() {
    let o = HistoryOptions {
        geology: "listric-v1".into(),
        steps: 6,
        fault_dip_degrees: Some(60.),
        curve_strength: 0.65,
        fault_slip_scale: 1.2,
        ..Default::default()
    };
    let s = preset::generate(&o).unwrap();
    assert!(s.events.iter().any(|e| matches!(e, E::ListricFault { .. })));
    HistoryModel::compile(s).unwrap();
    assert!(
        preset::generate(&HistoryOptions {
            geology: "detailed".into(),
            curve_strength: 0.2,
            ..Default::default()
        })
        .is_err()
    );
}
