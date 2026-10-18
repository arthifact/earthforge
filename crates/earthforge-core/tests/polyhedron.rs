use earthforge_core::{
    polyhedron::{Aabb, ConvexPolyhedron, Plane},
    space::WorldPoint as P,
};
fn cube() -> ConvexPolyhedron {
    ConvexPolyhedron::cuboid(Aabb {
        min: P::default(),
        max: P {
            x: 1.0,
            y: 1.0,
            z: 1.0,
        },
    })
    .unwrap()
}
fn close(a: f64, b: f64) {
    assert!((a - b).abs() < 2e-11, "{a:.17} != {b:.17}");
}
fn p(x: f64, y: f64, z: f64) -> P {
    P { x, y, z }
}
#[test]
fn box_volume_is_translation_invariant_and_faces_point_outward() {
    let b = Aabb {
        min: p(-2e6, 3e6, -1e6),
        max: p(-2e6 + 8.0, 3e6 + 4.0, -1e6 + 2.0),
    };
    let poly = ConvexPolyhedron::cuboid(b).unwrap();
    close(poly.volume(), 64.0);
    close(
        poly.translated(p(123.0, -77.0, 9.0)).unwrap().volume(),
        64.0,
    );
    assert!(poly.contains(p(-2e6 + 1.0, 3e6 + 1.0, -1e6 + 1.0)));
    assert!(!poly.contains(p(-2e6 - 1.0, 3e6 + 1.0, -1e6 + 1.0)));
}
#[test]
fn axis_and_oblique_cuts_have_analytic_volumes() {
    let poly = cube();
    for cut in [0.0, 0.125, 0.5, 0.875, 1.0] {
        let plane = Plane {
            point: p(cut, 0.0, 0.0),
            normal: p(1.0, 0.0, 0.0),
        };
        let (a, b) = poly.split(plane).unwrap();
        close(a.map_or(0.0, |q| q.volume()), cut);
        close(b.map_or(0.0, |q| q.volume()), 1.0 - cut);
    }
    for (cut, expected) in [
        (0.5, 1.0 / 48.0),
        (1.0, 1.0 / 6.0),
        (1.5, 0.5),
        (2.0, 5.0 / 6.0),
        (2.5, 47.0 / 48.0),
    ] {
        let plane = Plane {
            point: p(cut, 0.0, 0.0),
            normal: p(1.0, 1.0, 1.0),
        };
        let (a, b) = poly.split(plane).unwrap();
        close(a.as_ref().map_or(0.0, ConvexPolyhedron::volume), expected);
        close(
            a.map_or(0.0, |q| q.volume()) + b.map_or(0.0, |q| q.volume()),
            1.0,
        );
    }
}
// Inclusion-exclusion of three integrated uniform coordinates; no polyhedral
// clipping or triangulation is used by this independent volume oracle.
fn weighted_box_cdf(a: f64, b: f64, c: f64, t: f64) -> f64 {
    let mut sum = 0.0;
    for mask in 0..8u32 {
        let shift = if mask & 1 != 0 { a } else { 0.0 }
            + if mask & 2 != 0 { b } else { 0.0 }
            + if mask & 4 != 0 { c } else { 0.0 };
        let v = (t - shift).max(0.0).powi(3);
        sum += if mask.count_ones() % 2 == 0 { v } else { -v };
    }
    sum / (6.0 * a * b * c)
}
#[test]
fn three_dimensional_clips_match_independent_integrated_uniform_oracle() {
    let poly = cube();
    let mut state = 718284u32;
    let mut random = || {
        state = state.wrapping_mul(1664525).wrapping_add(1013904223);
        state as f64 / 4294967296.0
    };
    for _ in 0..150 {
        let (a, b, c) = (
            0.25 + 2.0 * random(),
            0.25 + 2.0 * random(),
            0.25 + 2.0 * random(),
        );
        let t = (a + b + c) * random();
        let plane = Plane {
            point: p(t / a, 0.0, 0.0),
            normal: p(a, b, c),
        };
        let (left, right) = poly.split(plane).unwrap();
        let v = left.as_ref().map_or(0.0, ConvexPolyhedron::volume);
        close(v, weighted_box_cdf(a, b, c, t));
        close(v + right.map_or(0.0, |q| q.volume()), 1.0);
    }
}
#[test]
fn sections_preserve_thin_geometry_and_crossline_invariance() {
    let poly = cube();
    for y in [0.0, 0.1, 0.5, 0.9, 1.0] {
        let section = poly
            .section(Plane {
                point: p(0.0, y, 0.0),
                normal: p(0.0, 1.0, 0.0),
            })
            .unwrap();
        assert_eq!(section.len(), 4);
        let area: f64 = section
            .iter()
            .enumerate()
            .map(|(i, a)| {
                let b = section[(i + 1) % section.len()];
                a.x * b.z - b.x * a.z
            })
            .sum::<f64>()
            .abs()
            / 2.0;
        close(area, 1.0);
    }
    let thin = poly
        .clip(
            Plane {
                point: p(1e-9, 0.0, 0.0),
                normal: p(1.0, 0.0, 0.0),
            },
            true,
        )
        .unwrap()
        .unwrap();
    close(thin.volume(), 1e-9);
    assert!(thin.volume() > 0.0);
}
#[test]
fn clipping_is_repeatable_and_invalid_geometry_is_rejected() {
    let plane = Plane {
        point: p(0.25, 0.5, 0.75),
        normal: p(1.0, 2.0, 3.0),
    };
    assert_eq!(
        cube().clip(plane, true).unwrap(),
        cube().clip(plane, true).unwrap()
    );
    assert!(
        cube()
            .clip(
                Plane {
                    point: p(0.0, 0.0, 0.0),
                    normal: P::default()
                },
                true
            )
            .is_err()
    );
    assert!(cube().translated(p(f64::INFINITY, 0.0, 0.0)).is_err());
    assert!(
        ConvexPolyhedron::cuboid(Aabb {
            min: p(1.0, 0.0, 0.0),
            max: p(0.0, 1.0, 1.0)
        })
        .is_err()
    );
}
