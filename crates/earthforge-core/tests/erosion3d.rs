use earthforge_core::{
    api,
    material::{self, Bed, Column, Layer},
    physics::{self, RockHistory},
    polyhedron::{Aabb, dot, sub},
    projection3d::{self, ProjectionRequest},
    space::{GridGeometry, PlanarFault, WorldPoint as P},
    volume3d::{ErosionSurface, MaterialVolume},
};
fn p(x: f64, y: f64, z: f64) -> P {
    P { x, y, z }
}
fn source() -> (Column, Vec<Bed>) {
    let beds = (0..3)
        .map(|unit| Bed {
            unit,
            phase: "erosion oracle".into(),
            a: 0.4,
            b: 0.0,
            c: 0.0,
            d: 1.0,
            carbonate: unit == 2,
        })
        .collect();
    let mut layers = vec![Layer::empty(-1, 10.0)];
    for (bed, height, solid, fraction) in [
        (0, 20.0, 10.0, 0.2),
        (1, 30.0, 18.0, 0.8),
        (2, 10.0, 7.0, 0.0),
    ] {
        let mut layer = Layer::empty(bed, height);
        layer.solid = solid;
        layer.fraction = fraction;
        layer.burial = 3000.0 + bed as f64 * 100.0;
        layer.loading = 2300.0 + bed as f64 * 100.0;
        layers.push(layer);
    }
    layers.push(Layer::empty(-2, 30.0));
    (layers, beds)
}
fn bounds() -> Aabb {
    Aabb {
        min: P::default(),
        max: p(100.0, 80.0, 100.0),
    }
}
fn world() -> MaterialVolume {
    let (c, b) = source();
    MaterialVolume::from_layers(bounds(), &c, &b).unwrap()
}
fn close(a: f64, b: f64) {
    assert!(
        (a - b).abs() <= 1e-7 + 1e-10 * a.abs().max(b.abs()),
        "{a} != {b}"
    )
}
fn surface() -> ErosionSurface {
    ErosionSurface {
        point: p(0.0, 0.0, 20.0),
        slope_x: 0.3,
        slope_y: 0.2,
    }
}
// Independent integral of max(c+a*x+b*y-t,0) over the horizontal rectangle.
// Integrating twice gives a signed sum of cubed corner heights, not clipping.
fn hinge_integral(t: f64) -> f64 {
    let cube = |v: f64| v.max(0.0).powi(3);
    (cube(20.0 + 30.0 + 16.0 - t) - cube(20.0 + 30.0 - t) - cube(20.0 + 16.0 - t) + cube(20.0 - t))
        / (6.0 * 0.3 * 0.2)
}
#[test]
fn oblique_erosion_matches_independent_analytic_constituent_integrals() {
    let mut w = world();
    let result = w.erode_planar(surface()).unwrap();
    assert!(result.closed);
    let mut total = 0.0;
    let mut sand = 0.0;
    let mut shale = 0.0;
    let mut carbonate = 0.0;
    for (bed, z0, z1, fraction, grain) in [
        (0, 10.0, 30.0, 0.2, 0.5),
        (1, 30.0, 60.0, 0.8, 0.6),
        (2, 60.0, 70.0, 0.0, 0.7),
    ] {
        let removed = (hinge_integral(z0) - hinge_integral(z1)) * grain;
        close(
            result.removed.by_bed.get(&bed).map_or(0.0, |v| v.total),
            removed,
        );
        total += removed;
        if bed == 2 {
            carbonate += removed
        } else {
            sand += removed * fraction;
            shale += removed * (1.0 - fraction)
        }
    }
    close(result.removed.bulk, 8000.0 * (20.0 + 15.0 + 8.0 - 10.0));
    close(result.removed.grain, total);
    close(result.removed.sand, sand);
    close(result.removed.shale, shale);
    close(result.removed.carbonate, carbonate);
    for fragment in w.fragments() {
        let old = source()
            .0
            .into_iter()
            .find(|l| l.bed == fragment.material.bed)
            .unwrap();
        assert_eq!(fragment.material.max_burial, old.burial);
        assert_eq!(fragment.material.max_effective_depth, old.loading);
    }
}
#[test]
fn crossline_uniform_erosion_reduces_to_existing_exact_column_slices() {
    let mut w = world();
    w.erode_planar(ErosionSurface {
        slope_y: 0.0,
        ..surface()
    })
    .unwrap();
    let column = source().0;
    for ix in 0..101 {
        let x = 0.125 + ix as f64 * 0.98;
        let depth = 20.0 + 0.3 * x;
        let kept = material::slice(&column, &[depth], &[100.0]).unwrap();
        for iz in 0..113 {
            let z = 0.317 + iz as f64 * 0.88;
            let mut bottom = depth;
            let mut expected = None;
            if z >= depth {
                for layer in &kept {
                    bottom += layer.height;
                    if z < bottom {
                        expected = Some(layer.bed);
                        break;
                    }
                }
            }
            for y in [0.0, 17.3, 40.0, 80.0] {
                assert_eq!(w.contains_material(p(x, y, z)).map(|m| m.bed), expected);
            }
        }
    }
}
fn fault() -> PlanarFault {
    // Unit normal and tangential displacement are exactly perpendicular.
    PlanarFault {
        point: p(50.0, 40.0, 50.0),
        normal: p(0.6, 0.0, 0.8),
        slip: p(8.0, 0.0, -6.0),
    }
}
#[test]
fn ordered_fault_erosion_histories_match_independent_inverse_occupancy() {
    let initial = world();
    let f = fault();
    let s = surface();
    let mut fault_then_erosion = initial.clone();
    assert!(fault_then_erosion.slip_planar(f).unwrap().closed);
    assert!(fault_then_erosion.erode_planar(s).unwrap().closed);
    let mut erosion_then_fault = initial.clone();
    assert!(erosion_then_fault.erode_planar(s).unwrap().closed);
    assert!(erosion_then_fault.slip_planar(f).unwrap().closed);
    let mut differences = 0;
    for ix in 0..19 {
        for iy in 0..13 {
            for iz in 0..23 {
                let point = p(
                    (ix as f64 + 0.271) * 100.0 / 19.0,
                    (iy as f64 + 0.381) * 80.0 / 13.0,
                    (iz as f64 + 0.419) * 100.0 / 23.0,
                );
                let old = if dot(sub(point, f.point), f.normal) < 0.0 {
                    sub(point, f.slip)
                } else {
                    point
                };
                let above = |q: P| q.z < 20.0 + 0.3 * q.x + 0.2 * q.y;
                let expected_a = if above(point) {
                    None
                } else {
                    initial.contains_material(old)
                };
                let expected_b = if above(old) {
                    None
                } else {
                    initial.contains_material(old)
                };
                assert_eq!(fault_then_erosion.contains_material(point), expected_a);
                assert_eq!(erosion_then_fault.contains_material(point), expected_b);
                differences += usize::from(expected_a != expected_b);
            }
        }
    }
    assert!(
        differences > 20,
        "ordered events must retain their noncommuting physical effect"
    );
}
#[test]
fn erosion_is_idempotent_can_remove_all_and_invalid_requests_are_atomic() {
    let mut w = world();
    let s = ErosionSurface {
        point: p(0.0, 0.0, 45.0),
        slope_x: 0.0,
        slope_y: 0.0,
    };
    w.erode_planar(s).unwrap();
    let state = serde_json::to_value(&w).unwrap();
    let again = w.erode_planar(s).unwrap();
    assert_eq!(again.removed.bulk, 0.0);
    assert_eq!(serde_json::to_value(&w).unwrap(), state);
    for bad in [
        ErosionSurface {
            slope_x: f64::NAN,
            ..s
        },
        ErosionSurface {
            point: p(f64::INFINITY, 0.0, 0.0),
            ..s
        },
        ErosionSurface {
            slope_x: f64::MAX,
            ..s
        },
    ] {
        assert!(w.erode_planar(bad).is_err());
        assert_eq!(serde_json::to_value(&w).unwrap(), state);
    }
    let all = w
        .erode_planar(ErosionSurface {
            point: p(0.0, 0.0, 200.0),
            ..s
        })
        .unwrap();
    assert!(all.closed);
    assert!(w.fragments().is_empty());
    close(all.before.grain, all.removed.grain);
    let empty = w.erode_planar(s).unwrap();
    assert!(empty.closed);
    assert_eq!(empty.removed.bulk, 0.0);
}
#[test]
fn eroded_projection_preserves_loading_memory_and_uses_the_new_surface() {
    let mut w = world();
    w.erode_planar(ErosionSurface {
        point: p(0.0, 0.0, 45.0),
        slope_x: 0.0,
        slope_y: 0.0,
    })
    .unwrap();
    let grid = GridGeometry {
        nx: 1,
        ny: 1,
        nz: 3,
        dx: 1.0,
        dy: 1.0,
        dz: 1.0,
        origin: p(32.0, 21.0, 44.5),
    };
    let projected = projection3d::project(
        &w,
        ProjectionRequest {
            grid,
            overpressure: None,
            basement_velocity: 5600.0,
        },
    )
    .unwrap();
    assert_eq!(projected.beds, [-1, 1, 1]);
    assert_eq!(projected.velocity[0], 1500.0);
    let material = w.contains_material(p(32.0, 21.0, 45.5)).unwrap();
    let history = RockHistory {
        max_burial: 3100.0,
        max_effective_depth: 2400.0,
        bulk_porosity: Some(0.4),
    };
    let expected = physics::velocity(material.sand_fraction, 0.5, false, None, Some(history));
    assert_eq!(projected.velocity[1], expected);
    let reset = physics::velocity(
        material.sand_fraction,
        0.5,
        false,
        None,
        Some(RockHistory {
            max_burial: 0.0,
            max_effective_depth: 0.0,
            bulk_porosity: Some(0.4),
        }),
    );
    assert!(
        (expected - reset).abs() > 1.0,
        "erosion must not reset irreversible loading history"
    );
}
#[test]
fn json_api_preserves_event_order_and_rejects_ambiguous_histories() {
    let (column, beds) = source();
    let s = surface();
    let f = fault();
    let request = serde_json::json!({"kind":"volume3d","bounds":bounds(),"column":column,"beds":beds,"events":[{"kind":"fault","fault":f},{"kind":"erosion","surface":s}],"sectionsY":[40.0],"includeGeometry":true});
    let result = api::request(request.clone()).unwrap();
    assert_eq!(result["eventLedgers"][0]["kind"], "fault");
    assert_eq!(result["eventLedgers"][1]["kind"], "erosion");
    assert!(
        result["eventLedgers"]
            .as_array()
            .unwrap()
            .iter()
            .all(|event| event["ledger"]["closed"] == true)
    );
    let mut ambiguous = request.clone();
    ambiguous["faults"] = serde_json::json!([f]);
    assert!(api::request(ambiguous).is_err());
    let mut too_many = request;
    too_many["events"] =
        serde_json::json!(vec![serde_json::json!({"kind":"erosion","surface":s}); 33]);
    assert!(api::request(too_many).is_err());
}
