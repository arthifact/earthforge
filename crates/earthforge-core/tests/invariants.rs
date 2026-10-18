use earthforge_core::{
    exact::{Scale, binary},
    geometry::Flow,
    material::{self, Bed, Layer},
    physics,
    simulation::{self, Options},
    space::{ColumnIndex, GridGeometry, PlanarFault, WorldPoint},
    transport::{self, Parcel},
    volume::ColumnField,
};
fn bed() -> Bed {
    Bed {
        unit: 0,
        phase: "test".into(),
        a: 0.5,
        b: 0.0,
        c: 0.0,
        d: 1.0,
        carbonate: false,
    }
}
fn rock(height: f64, solid: f64) -> Layer {
    let mut p = Layer::empty(0, height);
    p.solid = solid;
    p.fraction = 0.4;
    p.burial = 50.0;
    p.loading = 30.0;
    p
}
#[test]
fn exact_support_survives_subnormal_and_more_than_1024_bits() {
    let tiny = f64::from_bits(1);
    let s = Scale::new([20.0, tiny]).unwrap();
    let n = s.units(20.0).unwrap() + s.units(tiny).unwrap();
    assert!(n.bits() > 1024);
    let chunks = s.chunks(&n).unwrap();
    assert_eq!(s.sum(chunks).unwrap(), n);
    assert_eq!(s.number(&n).unwrap(), 20.0);
    assert_eq!(binary(tiny).unwrap(), (1, -1074));
}
#[test]
fn exact_projection_rounds_once_with_sticky_bits() {
    for (terms, expected) in [
        (vec![1.0, 2.0f64.powi(-53)], 1.0),
        (
            vec![1.0, 2.0f64.powi(-53), 2.0f64.powi(-107)],
            1.0 + 2.0f64.powi(-52),
        ),
        (
            vec![f64::MIN_POSITIVE, f64::from_bits(1)],
            f64::MIN_POSITIVE + f64::from_bits(1),
        ),
    ] {
        let s = Scale::new(terms.iter().copied()).unwrap();
        assert_eq!(s.number(&s.sum(terms).unwrap()).unwrap(), expected)
    }
}
#[test]
fn json_boundary_preserves_binary64_material_lengths() {
    // These correctly rounded decimal inputs used to shift by one bit in the
    // default JSON parser. Exact material ownership starts at this boundary.
    for text in [
        "1.2907896284013987",
        "0.9094638600945473",
        "3.6976809930056334",
    ] {
        let input = format!("{{\"kind\":\"exact\",\"terms\":[{text}]}}");
        let output: serde_json::Value =
            serde_json::from_slice(&earthforge_core::api::process(input.as_bytes())).unwrap();
        assert_eq!(output["ok"], true);
        let expected: f64 = text.parse().unwrap();
        assert_eq!(
            output["value"]["number"].as_f64().unwrap().to_bits(),
            expected.to_bits()
        );
    }
}
#[test]
fn exact_slices_are_complements_and_retain_thin_material() {
    let c = vec![
        Layer::empty(-1, 10.0),
        rock(20.0, 10.0),
        Layer::empty(-2, 10.0),
    ];
    let cut = [30.0, -2.0f64.powi(-60)];
    let a = material::slice(&c, &[0.0], &cut).unwrap();
    let b = material::slice(&c, &cut, &[40.0]).unwrap();
    let s = material::scale(&[&c, &a, &b], &[]).unwrap();
    assert_eq!(
        material::total(&a, s).unwrap() + material::total(&b, s).unwrap(),
        material::total(&c, s).unwrap()
    );
    assert!(b.iter().any(|p| p.bed == 0 && p.height > 0.0));
}
#[test]
fn compaction_retains_grains_memories_and_physical_offsets() {
    let mut p = rock(20.0, 10.0);
    p.offset_x = 0.25;
    p.offset_y = 0.75;
    p.offset_z = 0.5;
    let c = vec![Layer::empty(-1, 10.0), p.clone(), Layer::empty(-2, 70.0)];
    let (next, _) = material::compact(&c, &[bed()], None).unwrap();
    let q = next.iter().find(|p| p.bed == 0).unwrap();
    assert_eq!(q.solid, p.solid);
    assert!(q.height <= p.height);
    assert!(q.burial >= p.burial && q.loading >= p.loading);
    assert_eq!((q.offset_x, q.offset_y, q.offset_z), (0.25, 0.75, 0.5));
    let s = material::scale(&[&c, &next], &[]).unwrap();
    assert_eq!(
        material::total(&c, s).unwrap(),
        material::total(&next, s).unwrap()
    );
}
#[test]
fn straight_fault_flow_has_known_translation_and_inverse() {
    let f = Flow::new(vec![[-100.0, 100.0], [100.0, 0.0]]).unwrap();
    let p = [20.0, -20.0];
    let s = 30.0;
    let q = f.moved(p, s).unwrap();
    let norm = 200.0f64.hypot(100.0);
    assert!((q[0] - p[0] - s * 200.0 / norm).abs() < 1e-12);
    assert!((q[1] - p[1] + s * 100.0 / norm).abs() < 1e-12);
    let back = f.moved(q, -s).unwrap();
    assert!((back[0] - p[0]).abs() < 1e-12 && (back[1] - p[1]).abs() < 1e-12);
}
#[test]
fn bending_fault_area_integral_matches_independent_dense_quadrature() {
    let f = Flow::new(vec![[-20.0, 20.0], [0.0, 20.0], [20.0, 0.0], [40.0, 0.0]]).unwrap();
    let exact = f.mean_displacement(5.0, 0.0, 8.0, 12.0, 10.0).unwrap();
    let mut sum = [0.0; 2];
    let n = 200;
    for i in 0..n {
        for j in 0..n {
            let p = [
                5.0 + ((i as f64 + 0.5) / n as f64 - 0.5) * 10.0,
                (j as f64 + 0.5) / n as f64 * 8.0,
            ];
            let q = f.moved(p, 12.0).unwrap();
            sum[0] += q[0] - p[0];
            sum[1] += q[1] - p[1];
        }
    }
    for j in 0..2 {
        assert!((sum[j] / (n * n) as f64 - exact[j]).abs() < 2e-4);
    }
}
#[test]
fn exact_capacity_fallback_splits_without_losing_any_source() {
    let p = Parcel {
        source: 0,
        i: 1,
        k: 0,
        height: 1.0,
        weight: 1.0,
        target_i: 1.0,
        target_k: 0.0,
        material_heights: vec![1.0],
    };
    let capacities = [0.5, 0.5, 0.5];
    assert!(transport::assign(3, 1, &[true; 3], std::slice::from_ref(&p), &capacities).is_err());
    let a = transport::capacity_assign(3, 1, &[true; 3], &[p], &capacities).unwrap();
    assert_eq!(a.split_sources, 1);
    assert_eq!(a.shares.iter().map(|q| q.height).sum::<f64>(), 1.0);
    for q in &a.shares {
        assert!(q.height <= capacities[q.destination]);
    }
    let slices = transport::slice_shares(&[vec![rock(1.0, 0.4)]], &a.shares).unwrap();
    assert_eq!(slices.iter().map(|q| q.part.solid).sum::<f64>(), 0.4);
}
#[test]
fn three_dimensional_storage_can_represent_huge_uniform_volume_without_dense_allocation() {
    let g = GridGeometry {
        nx: 1000,
        ny: 1000,
        nz: 1000,
        dx: 10.0,
        dy: 10.0,
        dz: 10.0,
        origin: WorldPoint::default(),
    };
    let field = ColumnField::new(g, vec![Layer::empty(-2, 10000.0)]).unwrap();
    assert_eq!(field.allocated_columns(), 0);
    assert_eq!(field.get(ColumnIndex { x: 999, y: 999 }).unwrap().len(), 1);
    assert!(field.get(ColumnIndex { x: 1000, y: 0 }).is_err());
}
#[test]
fn three_dimensional_slip_moves_along_both_axes_and_books_open_boundary_volume() {
    let g = GridGeometry {
        nx: 3,
        ny: 3,
        nz: 4,
        dx: 10.0,
        dy: 20.0,
        dz: 10.0,
        origin: WorldPoint::default(),
    };
    let bg = vec![Layer::empty(-1, 20.0), Layer::empty(-2, 20.0)];
    let mut field = ColumnField::new(g, bg).unwrap();
    field
        .set(
            ColumnIndex { x: 0, y: 0 },
            vec![
                Layer::empty(-1, 10.0),
                rock(10.0, 5.0),
                Layer::empty(-2, 20.0),
            ],
        )
        .unwrap();
    let before = field.inventory(&[bed()]);
    let fault = PlanarFault {
        point: WorldPoint {
            x: 0.0,
            y: 0.0,
            z: 20.0,
        },
        normal: WorldPoint {
            x: 0.0,
            y: 0.0,
            z: 1.0,
        },
        slip: WorldPoint {
            x: 10.0,
            y: 20.0,
            z: 0.0,
        },
    };
    let out = field.slip_horizontal(fault, &[bed()]).unwrap();
    assert_eq!(out.total, 0.0);
    assert_eq!(field.inventory(&[bed()]).total, before.total);
    let q = field
        .get(ColumnIndex { x: 1, y: 1 })
        .unwrap()
        .iter()
        .find(|p| p.bed == 0)
        .unwrap();
    assert_eq!((q.solid, q.burial, q.loading), (5.0, 50.0, 30.0));
    let mut huge = fault;
    huge.slip = WorldPoint {
        x: 30.0,
        y: 60.0,
        z: 0.0,
    };
    let out = field.slip_horizontal(huge, &[bed()]).unwrap();
    assert_eq!(out.total, before.total);
    assert_eq!(field.inventory(&[bed()]).total, 0.0);
}
#[test]
fn uniform_crossline_reduces_to_same_column_compaction_and_scales_volume() {
    let background = vec![
        Layer::empty(-1, 10.0),
        rock(20.0, 10.0),
        Layer::empty(-2, 70.0),
    ];
    let g = GridGeometry {
        nx: 2,
        ny: 1,
        nz: 10,
        dx: 10.0,
        dy: 1.0,
        dz: 10.0,
        origin: WorldPoint::default(),
    };
    let mut a = ColumnField::new(g, background.clone()).unwrap();
    let mut b = ColumnField::new(GridGeometry { ny: 4, ..g }, background).unwrap();
    a.compact(&[bed()], None).unwrap();
    b.compact(&[bed()], None).unwrap();
    assert_eq!(
        a.get(ColumnIndex { x: 0, y: 0 }).unwrap(),
        b.get(ColumnIndex { x: 0, y: 3 }).unwrap()
    );
    assert_eq!(
        b.inventory(&[bed()]).total,
        4.0 * a.inventory(&[bed()]).total
    );
}
#[test]
fn three_dimensional_prototype_rejects_unsupported_geometry_atomically() {
    let g = GridGeometry {
        nx: 2,
        ny: 2,
        nz: 2,
        dx: 1.0,
        dy: 1.0,
        dz: 1.0,
        origin: WorldPoint::default(),
    };
    let mut f = ColumnField::new(g, vec![Layer::empty(-2, 2.0)]).unwrap();
    let fault = PlanarFault {
        point: WorldPoint::default(),
        normal: WorldPoint {
            x: 0.0,
            y: 0.0,
            z: 1.0,
        },
        slip: WorldPoint {
            x: 0.5,
            y: 0.0,
            z: 0.0,
        },
    };
    assert!(f.slip_horizontal(fault, &[]).is_err());
    assert_eq!(f.allocated_columns(), 0);
}
#[test]
fn pressure_and_burial_memory_are_independent() {
    let f = 0.4;
    let d = 1000.0;
    let fresh = physics::velocity(f, d, false, None, None);
    let exhumed = physics::velocity(
        f,
        d,
        false,
        None,
        Some(physics::RockHistory {
            max_burial: 3000.0,
            max_effective_depth: 3000.0,
            bulk_porosity: None,
        }),
    );
    assert!(exhumed > fresh);
    assert_eq!(physics::effective_depth(2000.0, Some(1000.0)), 1250.0);
}
#[test]
fn full_simulation_preserves_budgets_and_repeats_without_touching_observations() {
    let o = Options {
        seed: 765184.0,
        h: 200.0,
        setting: "extension".into(),
        faults: [0, 0],
        exhumation: 1.0,
        ..Default::default()
    };
    let a = simulation::simulate(o.clone()).unwrap();
    let b = simulation::simulate(o).unwrap();
    assert!(a.section.budget.closed);
    assert_eq!(a.section.checks.trapped, 0);
    assert_eq!(a.columns, b.columns);
    assert_eq!(a.section.now.velocity, b.section.now.velocity);
    assert!(a.history_plan.exhumation.is_some());
    assert!(
        a.columns
            .iter()
            .flatten()
            .any(|p| p.bed >= 0 && p.burial > 50.0)
    );
}

#[test]
fn parallel_column_compaction_is_identical_to_serial_order() {
    let columns: Vec<_> = (0..32)
        .map(|i| {
            vec![
                Layer::empty(-1, 10.0 + i as f64),
                rock(20.0, 10.0),
                Layer::empty(-2, 70.0 - i as f64),
            ]
        })
        .collect();
    let serial = rayon::ThreadPoolBuilder::new()
        .num_threads(1)
        .build()
        .unwrap()
        .install(|| material::compact_many(&columns, &[bed()], None).unwrap());
    let parallel = rayon::ThreadPoolBuilder::new()
        .num_threads(4)
        .build()
        .unwrap()
        .install(|| material::compact_many(&columns, &[bed()], None).unwrap());
    assert_eq!(
        serial.into_iter().map(|p| p.0).collect::<Vec<_>>(),
        parallel.into_iter().map(|p| p.0).collect::<Vec<_>>()
    );
}

#[test]
fn sparse_matching_reaches_independently_enumerated_minimum() {
    fn oracle(parcels: &[Parcel], capacity: &[f64], radius: i32) -> Option<i128> {
        fn visit(
            p: usize,
            parcels: &[Parcel],
            capacity: &[f64],
            radius: i32,
            used: &mut [bool],
            cost: i128,
            best: &mut Option<i128>,
        ) {
            if p == parcels.len() {
                if best.is_none_or(|b| cost < b) {
                    *best = Some(cost)
                }
                return;
            }
            let max_weight = parcels.iter().map(|p| p.weight).fold(0.0, f64::max);
            let q = &parcels[p];
            for n in 0..6 {
                let i = (n % 3) as i32;
                let k = (n / 3) as i32;
                if used[n]
                    || capacity[n] < q.height
                    || (i - q.i).pow(2) + (k - q.k).pow(2) > radius * radius
                {
                    continue;
                }
                let edge = transport::round(
                    q.weight / max_weight
                        * ((i as f64 - q.target_i).powi(2) + (k as f64 - q.target_k).powi(2))
                        / 1e-12,
                ) as i128;
                used[n] = true;
                visit(p + 1, parcels, capacity, radius, used, cost + edge, best);
                used[n] = false;
            }
        }
        let mut best = None;
        visit(0, parcels, capacity, radius, &mut [false; 6], 0, &mut best);
        best
    }
    let mut seed = 19u64;
    let mut draw = || {
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
        (seed >> 32) as usize
    };
    for _ in 0..150 {
        let capacity: Vec<_> = (0..6).map(|_| [0.0, 0.5, 1.0][draw() % 3]).collect();
        let parcels: Vec<_> = (0..(1 + draw() % 4))
            .map(|source| {
                let i = (draw() % 3) as i32;
                let k = (draw() % 2) as i32;
                Parcel {
                    source,
                    i,
                    k,
                    target_i: i as f64,
                    target_k: k as f64,
                    height: [0.5, 1.0][draw() % 2],
                    weight: [1.0, 2.0, 8.0][draw() % 3],
                    material_heights: vec![],
                }
            })
            .collect();
        match transport::assign(3, 2, &[true; 6], &parcels, &capacity) {
            Ok(a) => {
                let max_weight = parcels.iter().map(|p| p.weight).fold(0.0, f64::max);
                let actual: i128 = a
                    .destination
                    .iter()
                    .enumerate()
                    .map(|(p, n)| {
                        let q = &parcels[p];
                        transport::round(
                            q.weight / max_weight * ((n % 3) as f64 - q.target_i).powi(2) / 1e-12
                                + q.weight / max_weight * ((n / 3) as f64 - q.target_k).powi(2)
                                    / 1e-12,
                        ) as i128
                    })
                    .sum();
                assert_eq!(Some(actual), oracle(&parcels, &capacity, a.radius));
            }
            Err(e) => {
                assert!(e.starts_with("Placement:"));
                assert_eq!(oracle(&parcels, &capacity, 3), None);
            }
        }
    }
}
