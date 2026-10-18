use earthforge_core::{
    material::{Bed, Column, Layer},
    polyhedron::{Aabb, cross, dot, scale, sub},
    space::{PlanarFault, WorldPoint as P},
    volume3d::MaterialVolume,
};
fn p(x: f64, y: f64, z: f64) -> P {
    P { x, y, z }
}
fn beds() -> Vec<Bed> {
    (0..3)
        .map(|unit| Bed {
            unit,
            phase: "test".into(),
            a: 0.4,
            b: 0.0,
            c: 0.0,
            d: 1.0,
            carbonate: unit == 2,
        })
        .collect()
}
fn column() -> Column {
    let mut a = Layer::empty(0, 20.0);
    a.solid = 10.0;
    a.fraction = 0.2;
    a.burial = 80.0;
    a.loading = 60.0;
    let mut b = Layer::empty(1, 30.0);
    b.solid = 18.0;
    b.fraction = 0.8;
    b.burial = 150.0;
    b.loading = 100.0;
    let mut c = Layer::empty(2, 10.0);
    c.solid = 7.0;
    c.fraction = 0.0;
    c.burial = 200.0;
    c.loading = 160.0;
    vec![Layer::empty(-1, 10.0), a, b, c, Layer::empty(-2, 30.0)]
}
fn bounds() -> Aabb {
    Aabb {
        min: P::default(),
        max: p(100.0, 80.0, 100.0),
    }
}
fn volume() -> MaterialVolume {
    MaterialVolume::from_layers(bounds(), &column(), &beds()).unwrap()
}
fn unit(n: P) -> P {
    scale(n, 1.0 / dot(n, n).sqrt())
}
fn fault() -> PlanarFault {
    let normal = unit(p(1.0, 0.4, 0.8));
    let tangent = unit(cross(normal, p(0.0, 1.0, 0.0)));
    PlanarFault {
        point: p(50.0, 40.0, 50.0),
        normal,
        slip: scale(tangent, 12.0),
    }
}
fn close(a: f64, b: f64) {
    assert!(
        (a - b).abs() <= 1e-7 + 1e-10 * a.abs().max(b.abs()),
        "{a} != {b}"
    );
}
fn area(points: &[P]) -> f64 {
    points
        .iter()
        .enumerate()
        .map(|(i, a)| {
            let b = points[(i + 1) % points.len()];
            a.x * b.z - b.x * a.z
        })
        .sum::<f64>()
        .abs()
        / 2.0
}
#[test]
fn layered_world_uses_interfaces_instead_of_a_dense_voxel_grid() {
    let world = volume();
    assert_eq!(world.fragments().len(), 4);
    close(world.inventory().grain, (10.0 + 18.0 + 7.0) * 8000.0);
    let large = MaterialVolume::from_layers(
        Aabb {
            min: p(0.0, 0.0, 0.0),
            max: p(10000.0, 10000.0, 100.0),
        },
        &column(),
        &beds(),
    )
    .unwrap();
    assert_eq!(large.fragments().len(), 4);
    close(large.inventory().grain, 35.0 * 1e8);
    assert_eq!(world.inventory().by_bed.len(), 3);
    close(
        world.inventory().sand,
        10.0 * 8000.0 * 0.2 + 18.0 * 8000.0 * 0.8,
    );
    close(world.inventory().carbonate, 7.0 * 8000.0);
}
#[test]
fn inclined_fault_preserves_every_bed_and_constituent_with_open_boundary_flux() {
    let mut world = volume();
    let f = fault();
    let before = world.inventory();
    let result = world.slip_planar(f).unwrap();
    assert!(result.closed);
    assert!(result.outflow.grain > 0.0);
    close(before.grain, result.after.grain + result.outflow.grain);
    close(before.sand, result.after.sand + result.outflow.sand);
    close(before.shale, result.after.shale + result.outflow.shale);
    close(
        before.carbonate,
        result.after.carbonate + result.outflow.carbonate,
    );
    for (id, g) in before.by_bed {
        let a = result.after.by_bed.get(&id).copied().unwrap_or_default();
        let o = result.outflow.by_bed.get(&id).copied().unwrap_or_default();
        close(g.total, a.total + o.total);
        close(g.sand, a.sand + o.sand);
        close(g.shale, a.shale + o.shale);
        close(g.carbonate, a.carbonate + o.carbonate);
    }
    for fragment in world.fragments() {
        let old = column()
            .into_iter()
            .find(|p| p.bed == fragment.material.bed)
            .unwrap();
        assert_eq!(fragment.material.max_burial, old.burial);
        assert_eq!(fragment.material.max_effective_depth, old.loading);
        assert_eq!(fragment.material.sand_fraction, old.fraction);
    }
}
#[test]
fn inverse_kinematics_independently_checks_interior_occupancy_and_stationary_footwall() {
    let initial = volume();
    let mut moved = initial.clone();
    let f = fault();
    moved.slip_planar(f).unwrap();
    let mut seed = 78128u32;
    for _ in 0..4000 {
        let mut random = || {
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            seed as f64 / 4294967296.0
        };
        let q = p(100.0 * random(), 80.0 * random(), 100.0 * random());
        let source = if f.signed_distance(q) < 0.0 {
            sub(q, f.slip)
        } else {
            q
        };
        let expected = initial.contains_material(source);
        let actual = moved.contains_material(q);
        assert_eq!(actual, expected, "point {q:?}; source {source:?}");
    }
}
#[test]
fn crossline_uniform_case_reduces_to_identical_sections() {
    let mut world = volume();
    let normal = unit(p(1.0, 0.0, 1.0));
    let slip = p(10.0, 0.0, -10.0);
    world
        .slip_planar(PlanarFault {
            point: p(50.0, 0.0, 50.0),
            normal,
            slip,
        })
        .unwrap();
    let a = world.section_y(10.0).unwrap();
    let b = world.section_y(70.0).unwrap();
    assert_eq!(a.len(), b.len());
    for (a, b) in a.iter().zip(&b) {
        assert_eq!(a.material, b.material);
        close(area(&a.polygon), area(&b.polygon));
        let mut pa: Vec<_> = a.polygon.iter().map(|p| (p.x, p.z)).collect();
        let mut pb: Vec<_> = b.polygon.iter().map(|p| (p.x, p.z)).collect();
        pa.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.total_cmp(&b.1)));
        pb.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.total_cmp(&b.1)));
        for (a, b) in pa.iter().zip(&pb) {
            close(a.0, b.0);
            close(a.1, b.1);
        }
    }
}
#[test]
fn along_strike_geometry_is_genuinely_three_dimensional() {
    let mut world = volume();
    let normal = unit(p(1.0, 0.5, 1.0));
    let slip = p(7.0, 6.0, -10.0);
    assert!(dot(normal, slip).abs() < 1e-12);
    world
        .slip_planar(PlanarFault {
            point: p(50.0, 40.0, 50.0),
            normal,
            slip,
        })
        .unwrap();
    let a = world.section_y(5.0).unwrap();
    let b = world.section_y(75.0).unwrap();
    let aa: Vec<_> = a
        .iter()
        .map(|p| (p.material.bed, area(&p.polygon)))
        .collect();
    let bb: Vec<_> = b
        .iter()
        .map(|p| (p.material.bed, area(&p.polygon)))
        .collect();
    assert_ne!(aa, bb);
}
#[test]
fn repeated_faults_are_conservative_and_repeatable() {
    let mut a = volume();
    let mut b = a.clone();
    for i in 0..8 {
        let normal = unit(p(1.0, 0.1 + i as f64 * 0.07, 0.8));
        let tangent = unit(cross(normal, p(0.0, 1.0, 0.0)));
        let f = PlanarFault {
            point: p(20.0 + 7.0 * i as f64, 40.0, 50.0),
            normal,
            slip: scale(tangent, if i % 2 == 0 { 2.5 } else { -2.5 }),
        };
        assert!(a.slip_planar(f).unwrap().closed);
        assert!(b.slip_planar(f).unwrap().closed);
        assert_eq!(a.fragments(), b.fragments());
    }
}
#[test]
fn invalid_or_underspecified_geometry_does_not_modify_material() {
    let mut world = volume();
    let before = world.fragments().to_vec();
    let mut bad = fault();
    bad.slip = p(0.0, 0.0, 12.0);
    assert!(world.slip_planar(bad).is_err());
    assert_eq!(world.fragments(), before);
    let mut source = column();
    source[1].offset_y = 0.25;
    assert!(MaterialVolume::from_layers(bounds(), &source, &beds()).is_err());
    assert!(world.section_y(-0.5).is_err());
}

#[test]
fn composed_oblique_faults_match_independent_inverse_maps_without_overlapping_material() {
    let initial = volume();
    let mut moved = initial.clone();
    let definitions = [
        (p(50.0, 40.0, 50.0), p(1.0, 0.4, 0.8), p(8.0, -4.0, -8.0)),
        (p(45.0, 37.0, 42.0), p(-0.3, 1.0, 0.5), p(10.0, -2.0, 10.0)),
        (p(60.0, 42.0, 65.0), p(0.7, -0.2, 1.0), p(-5.0, 5.0, 4.5)),
        (p(32.0, 53.0, 35.0), p(0.2, 0.8, 0.6), p(6.0, -3.0, 2.0)),
    ];
    let faults = definitions.map(|(point, normal, slip)| PlanarFault {
        point,
        normal: unit(normal),
        slip,
    });
    for f in faults {
        assert!(moved.slip_planar(f).unwrap().closed);
    }
    let mut seed = 907129u32;
    for _ in 0..20000 {
        let mut random = || {
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            seed as f64 / 4294967296.0
        };
        let q = p(100.0 * random(), 80.0 * random(), 100.0 * random());
        let mut source = Some(q);
        for f in faults.iter().rev() {
            if let Some(point) = source {
                let previous = if f.signed_distance(point) < 0.0 {
                    sub(point, f.slip)
                } else {
                    point
                };
                source = bounds().contains(previous).then_some(previous);
            }
        }
        let expected = source.and_then(|point| initial.contains_material(point));
        assert_eq!(
            moved.contains_material(q),
            expected,
            "composed inverse at {q:?}"
        );
        let owners = moved
            .fragments()
            .iter()
            .filter(|f| f.support.contains(q))
            .count();
        assert!(
            owners <= 1,
            "positive-volume overlap at {q:?}: {owners} owners"
        );
    }
}
