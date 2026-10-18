use earthforge_core::{
    api,
    history3d::{
        model::{HistoryEvent as E, HistoryModel, HistorySpec, SpatialField as F},
        profile::Profile,
    },
    material::{self, BASEMENT, Bed, Layer, WATER},
    physics,
    polyhedron::Aabb,
    space::{PlanarFault, WorldPoint as P},
    volume3d::MaterialVolume,
};
use serde_json::json;
fn point(x: f64, y: f64, z: f64) -> P {
    P { x, y, z }
}
fn beds() -> Vec<Bed> {
    (0..4)
        .map(|unit| Bed {
            unit,
            phase: "independent history fixture".into(),
            a: 0.4,
            b: 0.0,
            c: 0.0,
            d: 1.0,
            carbonate: unit == 2,
        })
        .collect()
}
fn layer(bed: i32, height: f64, solid: f64, fraction: f64) -> Layer {
    let mut p = Layer::empty(bed, height);
    p.solid = solid;
    p.fraction = fraction;
    p.burial = 3000.0;
    p.loading = 2300.0;
    p
}
fn layers() -> Vec<Layer> {
    vec![
        layer(0, 20.0, 10.0, 0.2),
        layer(1, 30.0, 18.0, 0.8),
        layer(2, 10.0, 7.0, 0.0),
    ]
}
fn spec(events: Vec<E>) -> HistorySpec {
    HistorySpec {
        bounds: Aabb {
            min: P::default(),
            max: point(100.0, 80.0, 100.0),
        },
        initial_surface: F::constant(10.0),
        initial_layers: layers(),
        beds: beds(),
        events,
        material_step: 10.0,
        stages: vec![],
    }
}
fn fault() -> PlanarFault {
    PlanarFault {
        point: point(50.0, 40.0, 50.0),
        normal: point(0.48, 0.36, 0.8),
        slip: point(8.0, 6.0, -7.5),
    }
}
fn close(a: f64, b: f64, tol: f64) {
    assert!((a - b).abs() <= tol, "{a} != {b}; error {}", (a - b).abs());
}
#[test]
fn uniform_compaction_reduces_exactly_to_existing_column_law_and_fixes_basement() {
    for pressure in [None, Some(20.0), Some(1400.0)] {
        let initial = material::deposit(0, &[210.0], 0.4, false, 0.0, None).unwrap();
        let mut p = Profile::new(100.0, initial.clone()).unwrap();
        let base = p.basement().unwrap();
        let (reference, map) = material::compact(&initial, &beds(), pressure).unwrap();
        let compacted = reference
            .into_iter()
            .filter(|p| p.bed != WATER)
            .collect::<Vec<_>>();
        p.compact(&beds(), pressure).unwrap();
        assert_eq!(p.layers, compacted);
        close(p.top().unwrap(), 100.0 + map.top, 1e-12);
        close(p.basement().unwrap(), base, 1e-12);
        for (bed, v) in Profile::new(100.0, initial).unwrap().grains() {
            let after = p.grains()[&bed];
            for j in 0..3 {
                close(after[j], v[j], 1e-12);
            }
        }
    }
}
#[test]
fn new_deposition_reduces_to_existing_exact_subdivision_and_solid_law() {
    for (thickness, fraction, carbonate, pressure) in [
        (123.0, 0.2, false, None),
        (0.3, 0.8, false, Some(0.1)),
        (130.0, 0.0, true, None),
    ] {
        let mut p = Profile::new(400.0, vec![]).unwrap();
        let input = p
            .deposit(0, thickness, fraction, carbonate, pressure, 10.0)
            .unwrap();
        assert_eq!(
            input,
            material::deposit(0, &[thickness], fraction, carbonate, 0.0, pressure).unwrap()
        );
        assert_eq!(p.layers, input);
        close(p.basement().unwrap(), 400.0, 1e-12);
    }
}
#[test]
fn exact_cuts_and_regional_tails_preserve_thin_intervals_without_filling_gaps() {
    let tiny = 2.0f64.powi(-45);
    let mut p = layer(0, 1.0 + tiny, 0.4, 0.2);
    p.lengths = vec![1.0, tiny];
    let profile = Profile::new(
        10.0,
        vec![p, Layer::empty(WATER, 0.125), layer(1, 0.5, 0.3, 0.8)],
    )
    .unwrap();
    let cut = profile.cut(11.0, 12.0).unwrap();
    assert_eq!(cut[0].bed, 0);
    assert_eq!(cut[0].height, tiny);
    assert_eq!(cut[1].bed, WATER);
    assert_eq!(cut[1].height, 0.125);
    assert_eq!(cut.last().unwrap().bed, BASEMENT);
    let outside = profile.cut(-10.0, 9.0).unwrap();
    assert_eq!(outside.len(), 1);
    assert_eq!(outside[0].bed, WATER);
    assert_eq!(outside[0].height, 19.0);
    let mut compacted = profile.clone();
    compacted.compact(&beds(), None).unwrap();
    assert!(
        compacted
            .layers
            .iter()
            .any(|p| p.bed == WATER && p.height == 0.125)
    );
}
#[test]
fn oblique_fault_profiles_match_independent_inverse_points_and_polyhedral_reference() {
    let f = fault();
    let model = HistoryModel::compile(spec(vec![E::Fault { fault: f }])).unwrap();
    let mut e = model.evaluator();
    let mut column = vec![Layer::empty(WATER, 10.0)];
    column.extend(layers());
    column.push(Layer::empty(BASEMENT, 30.0));
    let mut volume = MaterialVolume::from_layers(model.spec.bounds, &column, &beds()).unwrap();
    volume.slip_planar(f).unwrap();
    let original = Profile::new(10.0, layers()).unwrap();
    let mut checked = 0;
    for ix in 0..13 {
        for iy in 0..11 {
            let x = 20.31 + ix as f64 * 4.2;
            let y = 15.27 + iy as f64 * 4.3;
            let p = e.evaluate(1, x, y).unwrap();
            for iz in 0..47 {
                let z = 10.193 + iz as f64 * 1.6;
                let q = point(x, y, z);
                let source = if f.signed_distance(q) < 0.0 {
                    point(x - f.slip.x, y - f.slip.y, z - f.slip.z)
                } else {
                    q
                };
                let expected = original.sample(source.z).unwrap();
                let actual = p.sample(z).unwrap();
                assert_eq!(actual.bed, expected.bed);
                assert_eq!(actual.fraction, expected.fraction);
                if source.z >= 0.0 && source.z <= 100.0 {
                    assert_eq!(
                        actual.bed,
                        volume.contains_material(q).map_or(WATER, |m| m.bed)
                    );
                }
                checked += 1;
            }
        }
    }
    assert_eq!(checked, 6721);
}
#[test]
fn composed_fault_inverse_maps_keep_material_and_constituents_in_full_xyz() {
    let a = fault();
    let b = PlanarFault {
        point: point(55.0, 38.0, 48.0),
        normal: point(-0.6, 0.0, 0.8),
        slip: point(4.0, 3.0, 3.0),
    };
    let model =
        HistoryModel::compile(spec(vec![E::Fault { fault: a }, E::Fault { fault: b }])).unwrap();
    let mut e = model.evaluator();
    let original = Profile::new(10.0, layers()).unwrap();
    for ix in 0..19 {
        for iy in 0..13 {
            let x = 11.157 + ix as f64 * 4.1;
            let y = 8.319 + iy as f64 * 4.5;
            let p = e.evaluate(2, x, y).unwrap();
            for iz in 0..41 {
                let z = 0.371 + iz as f64 * 2.2;
                let mut q = point(x, y, z);
                for f in [b, a] {
                    if f.signed_distance(q) < 0.0 {
                        q = point(q.x - f.slip.x, q.y - f.slip.y, q.z - f.slip.z);
                    }
                }
                let expected = original.sample(q.z).unwrap();
                let actual = p.sample(z).unwrap();
                assert_eq!(actual.bed, expected.bed);
                assert_eq!(actual.fraction, expected.fraction);
                if actual.bed >= 0 {
                    close(
                        actual.solid / actual.height,
                        expected.solid / expected.height,
                        2e-13,
                    );
                }
            }
        }
    }
}
#[test]
fn tangent_fault_and_inverse_restore_geometry_without_resetting_memories() {
    let f = fault();
    let inv = PlanarFault {
        slip: point(-f.slip.x, -f.slip.y, -f.slip.z),
        ..f
    };
    let model =
        HistoryModel::compile(spec(vec![E::Fault { fault: f }, E::Fault { fault: inv }])).unwrap();
    let mut e = model.evaluator();
    let original = Profile::new(10.0, layers()).unwrap();
    for i in 0..51 {
        let p = e
            .evaluate(2, 1.137 + i as f64 * 1.91, 0.31 + i as f64 * 1.49)
            .unwrap();
        close(p.top().unwrap(), 10.0, 2e-12);
        close(p.basement().unwrap(), 70.0, 2e-12);
        for (bed, g) in original.grains() {
            for (actual, expected) in p.grains()[&bed].iter().zip(g) {
                close(*actual, expected, 1e-11);
            }
        }
        assert!(
            p.layers
                .iter()
                .filter(|p| p.bed >= 0)
                .all(|p| p.burial >= 3000.0 && p.loading >= 2300.0)
        );
    }
}
#[test]
fn crossline_uniform_model_is_identical_at_every_y_but_oblique_model_varies() {
    let f = PlanarFault {
        normal: point(0.6, 0.0, 0.8),
        slip: point(8.0, 0.0, -6.0),
        ..fault()
    };
    let model = HistoryModel::compile(spec(vec![E::Fault { fault: f }])).unwrap();
    let mut e = model.evaluator();
    for x in [1.37, 30.17, 61.92, 95.31] {
        let first = e.evaluate(1, x, 0.0).unwrap();
        for y in [1.3, 20.0, 49.1, 80.0] {
            let p = e.evaluate(1, x, y).unwrap();
            assert!(std::sync::Arc::ptr_eq(&p, &first));
        }
    }
    assert!(e.stats.cache_hits >= 16);
    let model = HistoryModel::compile(spec(vec![E::Fault { fault: fault() }])).unwrap();
    let mut e = model.evaluator();
    assert_ne!(
        e.evaluate(1, 50.0, 1.0)
            .unwrap()
            .intervals()
            .unwrap()
            .iter()
            .map(|v| (v.0, v.1, v.2.bed))
            .collect::<Vec<_>>(),
        e.evaluate(1, 50.0, 79.0)
            .unwrap()
            .intervals()
            .unwrap()
            .iter()
            .map(|v| (v.0, v.1, v.2.bed))
            .collect::<Vec<_>>()
    );
}
#[test]
fn erosion_reburial_and_pressure_changes_preserve_irreversible_history_spatially() {
    let mut s = spec(vec![
        E::Deposit {
            bed: 3,
            thickness: Some(F {
                value: 40.0,
                slope_y: 1.2,
                ..Default::default()
            }),
            fill_to: None,
            max_thickness: None,
            fraction: None,
            compact: true,
        },
        E::Pressure {
            top: Some(F::constant(10.0)),
            compact: true,
        },
        E::Erosion {
            surface: F::constant(45.0),
        },
        E::Deposit {
            bed: 3,
            thickness: Some(F::constant(5.0)),
            fill_to: None,
            max_thickness: None,
            fraction: None,
            compact: true,
        },
    ]);
    for p in &mut s.initial_layers {
        p.burial = 0.0;
        p.loading = 0.0;
    }
    let model = HistoryModel::compile(s).unwrap();
    let mut e = model.evaluator();
    let a = e.evaluate(1, 20.0, 0.0).unwrap();
    let b = e.evaluate(1, 20.0, 70.0).unwrap();
    let ma = a
        .layers
        .iter()
        .filter(|p| p.bed == 1)
        .map(|p| p.loading)
        .fold(0.0, f64::max);
    let mb = b
        .layers
        .iter()
        .filter(|p| p.bed == 1)
        .map(|p| p.loading)
        .fold(0.0, f64::max);
    assert!(mb > ma + 20.0);
    for y in [0.0, 70.0] {
        let before = e.evaluate(1, 20.0, y).unwrap();
        let after = e.evaluate(4, 20.0, y).unwrap();
        for p in after.layers.iter().filter(|p| p.bed == 1) {
            let source = before.layers.iter().find(|q| q.bed == 1).unwrap();
            assert!(p.loading >= source.loading);
            assert!(p.burial >= source.burial);
            assert!(p.solid / p.height >= source.solid / source.height - 1e-12);
        }
    }
    assert!(e.stats.max_normalized_grain_residual < 1.0);
}
#[test]
fn output_resolution_and_replay_do_not_change_authoritative_material_state() {
    let input = json!({"kind":"history3d","options":{"steps":4,"faults":1},"query":{"nx":3,"nz":3,"sectionsY":[1000,5000],"rays":[[1200,4300]],"includeProfiles":true},"includeModel":true});
    let a = api::request(input.clone()).unwrap();
    let mut fine = input.clone();
    fine["query"]["nx"] = json!(9);
    fine["query"]["nz"] = json!(11);
    let b = api::request(fine).unwrap();
    assert_eq!(a["rays"], b["rays"]);
    let mut explicit = input;
    explicit["model"] = a["sourceModel"].clone();
    explicit["query"]["stage"] = json!(4);
    let c = api::request(explicit).unwrap();
    assert_eq!(a["rays"], c["rays"]);
    assert_eq!(a["slices"], c["slices"]);
    assert_eq!(a["stats"]["authoritativeVoxels"], 0);
}
#[test]
fn regional_continuation_supplies_known_boundary_material_instead_of_water_padding() {
    let f = PlanarFault {
        point: point(50.0, 40.0, 50.0),
        normal: point(1.0, 0.0, 0.0),
        slip: point(0.0, 100.0, 0.0),
    };
    let mut s = spec(vec![E::Fault { fault: f }]);
    s.initial_surface.slope_y = 0.2;
    let model = HistoryModel::compile(s).unwrap();
    let mut e = model.evaluator();
    let p = e.evaluate(1, 10.0, 1.0).unwrap();
    close(p.top().unwrap(), 10.0 + 0.2 * (-99.0), 1e-12);
    assert_eq!(p.layers.iter().filter(|p| p.bed >= 0).count(), 3);
}
#[test]
fn vertical_deposition_refinement_converges_to_independent_porosity_integral() {
    let thickness = 1234.5;
    let f = 0.37;
    let exact = thickness
        - f * 0.49 * 3700.0 * (1.0 - (-thickness / 3700.0_f64).exp())
        - (1.0 - f) * 0.63 * 1960.0 * (1.0 - (-thickness / 1960.0_f64).exp());
    let mut errors = vec![];
    for h in [20.0, 10.0, 5.0] {
        let mut p = Profile::new(2000.0, vec![]).unwrap();
        p.deposit(0, thickness, f, false, None, h).unwrap();
        let actual = p.layers.iter().map(|p| p.solid).sum::<f64>();
        errors.push((actual - exact).abs());
    }
    assert!(errors[1] < errors[0] * 0.27 && errors[2] < errors[1] * 0.27);
    assert!(errors[2] / exact < 1e-6);
}
#[test]
fn api_rejects_invalid_events_limits_and_nonphysical_material() {
    for bad in [
        json!({"kind":"history3d","options":{"faults":9}}),
        json!({"kind":"history3d","options":{"materialStep":0}}),
        json!({"kind":"history3d","query":{"nx":1}}),
        json!({"kind":"history3d","query":{"sectionsY":[20000]}}),
    ] {
        assert!(api::request(bad).is_err());
    }
    let mut s = spec(vec![]);
    s.initial_layers[0].solid = 100.0;
    assert!(HistoryModel::compile(s).is_err());
    let mut s = spec(vec![E::Deposit {
        bed: 0,
        thickness: Some(F::constant(-2.0)),
        fill_to: None,
        max_thickness: None,
        fraction: None,
        compact: true,
    }]);
    s.stages = vec![0, 1];
    let m = HistoryModel::compile(s).unwrap();
    assert!(m.evaluator().evaluate(1, 20.0, 30.0).is_err());
}

#[test]
fn compaction_refines_to_independent_integrated_drained_column_solution() {
    let fraction = 0.37;
    let original_height = 1200.0;
    let grain = original_height * (1.0 - (0.49 * fraction + 0.63 * (1.0 - fraction)));
    let integral = |h: f64| {
        h - fraction * 0.49 * 3700.0 * (1.0 - (-h / 3700.0).exp())
            - (1.0 - fraction) * 0.63 * 1960.0 * (1.0 - (-h / 1960.0).exp())
    };
    let (mut lo, mut hi) = (grain, original_height);
    for _ in 0..80 {
        let mid = (lo + hi) / 2.0;
        if integral(mid) < grain {
            lo = mid
        } else {
            hi = mid
        }
    }
    let reference = (lo + hi) / 2.0;
    let mut errors = vec![];
    for count in [60, 120, 240] {
        let mut layers = vec![];
        for _ in 0..count {
            let mut p = Layer::empty(0, original_height / count as f64);
            p.fraction = fraction;
            p.solid = grain / count as f64;
            layers.push(p);
        }
        let mut profile = Profile::new(100.0, layers).unwrap();
        profile.compact(&beds(), None).unwrap();
        let height = profile.layers.iter().map(|p| p.height).sum::<f64>();
        errors.push((height - reference).abs());
        close(profile.grains()[&0][0], grain, 1e-9);
    }
    assert!(
        errors[1] < errors[0] * 0.27 && errors[2] < errors[1] * 0.27,
        "{errors:?}"
    );
    assert!(errors[2] / reference < 1e-6, "{errors:?}");
}

#[test]
fn shared_compaction_matches_frozen_bisection_bit_for_bit_on20000_columns() {
    // Preserve the pre-unification 36-step solver as an independent oracle. Do
    // not compare two geometry wrappers that now call the same material kernel.
    let reference_layers = |column: &[Layer], pressure| {
        let mut depth = 0.0;
        column
            .iter()
            .map(|p| {
                let carbonate = beds()[p.bed as usize].carbonate;
                let volume = |t: f64| {
                    p.solid
                        / (1.0
                            - physics::porosity(
                                p.fraction,
                                p.loading
                                    .max(physics::effective_depth(depth + t / 2.0, pressure)),
                                carbonate,
                            ))
                };
                let mut q = p.clone();
                let (mut lo, mut hi) = (p.solid, p.height);
                if volume(hi) < hi {
                    for _ in 0..36 {
                        let m = (lo + hi) / 2.0;
                        if m < volume(m) { lo = m } else { hi = m }
                    }
                    q.height = (lo + hi) / 2.0;
                }
                let d = depth + q.height / 2.0;
                q.burial = p.burial.max(d);
                q.loading = p.loading.max(physics::effective_depth(d, pressure));
                if q.height != p.height {
                    q.lengths.clear();
                }
                depth += q.height;
                q
            })
            .collect::<Vec<_>>()
    };
    let mut state = 981237_u32;
    let mut random = || {
        state ^= state << 13;
        state ^= state >> 17;
        state ^= state << 5;
        state as f64 / 4294967296.0
    };
    let mut calls = 0;
    for i in 0..20_000 {
        let count = 1 + i % 7;
        let mut column = vec![];
        for j in 0..count {
            let h = if i % 4 == 0 {
                10.0f64.powf(-6.0 + 11.0 * random())
            } else {
                0.25 + 99.75 * random()
            };
            let mut p = Layer::empty(j % 3, h);
            p.solid = h * (0.3 + 0.65 * random());
            p.fraction = random();
            p.burial = 6000.0 * random();
            p.loading = if i % 3 == 0 { 0.0 } else { 5000.0 * random() };
            column.push(p);
        }
        let pressure = if i % 2 == 0 {
            None
        } else {
            Some(2000.0 * random())
        };
        let reference = reference_layers(&column, pressure);
        let (two_dimensional, _) = material::compact(&column, &beds(), pressure).unwrap();
        let two_dimensional = two_dimensional
            .into_iter()
            .filter(|p| p.bed != WATER)
            .collect::<Vec<_>>();
        assert_eq!(
            two_dimensional, reference,
            "2D column{i}, pressure{pressure:?}"
        );
        let mut p = Profile::new(100.0, column).unwrap();
        calls += p.compact_with_work(&beds(), pressure).unwrap().1;
        assert_eq!(p.layers, reference, "Column{i}, pressure{pressure:?}");
    }
    assert!(calls > 20_000);
}

#[test]
fn derived_grid_ownership_and_velocities_equal_exact_point_queries_at_interfaces() {
    let mut points = vec![];
    for y in [0.0, 40.0, 80.0] {
        for x in [0.0, 25.0, 50.0, 75.0, 100.0] {
            for z in (0..=20).map(|i| i as f64 * 5.0) {
                points.push(point(x, y, z));
            }
        }
    }
    let m = spec(vec![E::Fault { fault: fault() }, E::Compact {}]);
    let out=api::request(json!({"kind":"history3d","model":m,"query":{"sectionsY":[],"points":points,"grid":{"nx":5,"ny":3,"nz":21,"dx":25,"dy":40,"dz":5,"origin":{"x":0,"y":0,"z":0}}}})).unwrap();
    for y in 0..3 {
        for x in 0..5 {
            for z in 0..21 {
                let at = (z * 3 + y) * 5 + x;
                let point = (y * 5 + x) * 21 + z;
                assert_eq!(out["projection"]["beds"][at], out["points"][point]["bed"]);
                assert_eq!(
                    out["projection"]["velocity"][at],
                    out["points"][point]["velocity"]
                );
            }
        }
    }
}

#[test]
fn regional_window_inventory_refines_to_independent_clipped_3d_reference() {
    use earthforge_core::history3d::audit;
    let f = fault();
    let m = HistoryModel::compile(spec(vec![E::Fault { fault: f }])).unwrap();
    let padded = Aabb {
        min: point(-100.0, -100.0, -100.0),
        max: point(200.0, 180.0, 200.0),
    };
    let mut column = vec![Layer::empty(WATER, 110.0)];
    column.extend(layers());
    column.push(Layer::empty(BASEMENT, 130.0));
    let mut reference = MaterialVolume::from_layers(padded, &column, &beds()).unwrap();
    reference.slip_planar(f).unwrap();
    let mut expected = [0.0; 4];
    for p in reference.fragments().iter().filter(|p| p.material.bed >= 0) {
        let mut support = Some(p.support.clone());
        for plane in m.spec.bounds.planes() {
            support = support
                .map(|p| p.clip(plane, true))
                .transpose()
                .unwrap()
                .flatten();
        }
        if let Some(s) = support {
            let grain = s.volume() * p.material.grain_fraction;
            expected[0] += grain;
            if p.material.carbonate {
                expected[3] += grain;
            } else {
                expected[1] += grain * p.material.sand_fraction;
                expected[2] += grain * (1.0 - p.material.sand_fraction);
            }
        }
    }
    let mut errors = vec![];
    for n in [16, 32, 64] {
        let value = audit::inventory(&m, 1, n, n).unwrap();
        let actual = [value.grain, value.sand, value.shale, value.carbonate];
        let error = actual
            .iter()
            .zip(expected)
            .map(|(a, e)| (a - e).abs() / e.abs().max(1.0))
            .fold(0.0, f64::max);
        errors.push(error);
    }
    assert!(errors[2] < errors[0], "{errors:?}");
    assert!(errors[2] < 1e-4, "{errors:?}");
}

#[test]
fn fault_orientation_branches_match_independent_3d_inverse_maps() {
    for f in [
        PlanarFault {
            normal: point(-0.48, -0.36, -0.8),
            ..fault()
        },
        PlanarFault {
            normal: point(1.0, 0.0, 0.0),
            slip: point(0.0, 12.0, -4.0),
            ..fault()
        },
        PlanarFault {
            normal: point(0.0, 0.0, 1.0),
            slip: point(8.0, 6.0, 0.0),
            ..fault()
        },
    ] {
        let mut s = spec(vec![E::Fault { fault: f }]);
        s.initial_surface.slope_x = 0.03;
        s.initial_surface.slope_y = 0.04;
        let m = HistoryModel::compile(s).unwrap();
        let mut e = m.evaluator();
        for ix in 0..7 {
            for iy in 0..5 {
                let x = 0.713 + ix as f64 * 15.0;
                let y = 0.371 + iy as f64 * 17.0;
                let ray = e.evaluate(1, x, y).unwrap();
                for iz in 0..31 {
                    let mut q = point(x, y, 0.197 + iz as f64 * 3.0);
                    if f.signed_distance(q) < 0.0 {
                        q = point(q.x - f.slip.x, q.y - f.slip.y, q.z - f.slip.z);
                    }
                    let source =
                        Profile::new(m.spec.initial_surface.at(q.x, q.y).unwrap(), layers())
                            .unwrap();
                    assert_eq!(
                        ray.sample(0.197 + iz as f64 * 3.0).unwrap().bed,
                        source.sample(q.z).unwrap().bed
                    );
                }
            }
        }
    }
}

#[test]
fn complete_history_derived_volume_runs_through_the_3d_acoustic_solver() {
    let grid = json!({"nx":21,"ny":21,"nz":21,"dx":25,"dy":25,"dz":25,"origin":{"x":4700,"y":4700,"z":200}});
    let history=api::request(json!({"kind":"history3d","options":{"steps":4,"faults":1},"query":{"sectionsY":[],"grid":grid}})).unwrap();
    let shot=api::request(json!({"kind":"acoustic","grid":grid,"velocity":history["projection"]["velocity"],"source":{"x":4950,"y":4950,"z":450},"receivers":[{"x":5000,"y":4950,"z":450}],"frequencyHz":6,"durationSeconds":0.4,"spongeCells":4,"includeFinalField":true})).unwrap();
    assert_eq!(shot["dimensions"], 3);
    assert!(
        shot["data"]
            .as_array()
            .unwrap()
            .iter()
            .all(|v| v.as_f64().unwrap().is_finite())
    );
    assert!(
        shot["data"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v.as_f64().unwrap().abs() > 0.0)
    );
}

#[test]
fn guarded_fault_pruning_matches_unpruned_histories_and_unbounded_regional_queries() {
    let mut total = 0;
    for i in 0..120 {
        let mut s = spec(vec![
            E::Subsidence {
                displacement: F {
                    fronts: vec![],
                    value: 15.0,
                    slope_x: 0.003,
                    slope_y: -0.005,
                    waves: vec![],
                },
            },
            E::Deposit {
                bed: 3,
                thickness: Some(F::constant(10.0)),
                fill_to: None,
                max_thickness: None,
                fraction: None,
                compact: true,
            },
            E::Fault {
                fault: PlanarFault {
                    point: point(50.0, 40.0, -3000.0 + i as f64 * 70.0),
                    ..fault()
                },
            },
            E::Erosion {
                surface: F::constant(5.0),
            },
            E::Compact {},
        ]);
        s.initial_surface.slope_x = 0.04;
        s.initial_surface.slope_y = 0.07;
        let m = HistoryModel::compile(s).unwrap();
        let (mut a, mut b) = (m.evaluator(), m.evaluator_unpruned());
        for (x, y) in [
            (0.17, 0.37),
            (25.3, 33.1),
            (87.7, 79.1),
            (-1000.13, 2300.71),
        ] {
            let pa = a.evaluate(5, x, y).unwrap();
            let pb = b.evaluate(5, x, y).unwrap();
            assert_eq!(pa.top_terms, pb.top_terms, "Case{i}, x{x}, y{y}");
            assert_eq!(pa.layers, pb.layers, "Case{i}, x{x}, y{y}");
        }
        total += a.stats.pruned_fault_branches;
    }
    assert!(total > 100, "Pruning was not exercised");
}
