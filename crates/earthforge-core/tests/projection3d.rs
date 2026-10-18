use earthforge_core::{
    material::{Bed, Layer},
    physics::{self, RockHistory},
    polyhedron::Aabb,
    projection3d::{ProjectionRequest, project},
    space::{GridGeometry, PlanarFault, WorldPoint as P},
    volume3d::MaterialVolume,
};
fn point(x: f64, y: f64, z: f64) -> P {
    P { x, y, z }
}
fn volume() -> MaterialVolume {
    let beds = (0..3)
        .map(|unit| Bed {
            unit,
            phase: "test".into(),
            a: 0.4,
            b: 0.0,
            c: 0.0,
            d: 1.0,
            carbonate: unit == 2,
        })
        .collect::<Vec<_>>();
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
    c.burial = 200.0;
    c.loading = 160.0;
    MaterialVolume::from_layers(
        Aabb {
            min: P::default(),
            max: point(100.0, 80.0, 100.0),
        },
        &vec![Layer::empty(-1, 10.0), a, b, c, Layer::empty(-2, 30.0)],
        &beds,
    )
    .unwrap()
}
fn grid() -> GridGeometry {
    GridGeometry {
        nx: 15,
        ny: 16,
        nz: 32,
        dx: 6.7,
        dy: 5.1,
        dz: 3.1,
        origin: point(0.123, 0.317, 0.719),
    }
}
fn request(grid: GridGeometry) -> ProjectionRequest {
    ProjectionRequest {
        grid,
        overpressure: None,
        basement_velocity: 5600.0,
    }
}
#[test]
fn nodal_projection_agrees_with_independent_point_ownership_and_rock_law() {
    let volume = volume();
    let before = serde_json::to_value(volume.inventory()).unwrap();
    let grid = grid();
    let output = project(&volume, request(grid)).unwrap();
    for z in 0..grid.nz {
        for y in 0..grid.ny {
            for x in 0..grid.nx {
                let q = point(
                    grid.origin.x + x as f64 * grid.dx,
                    grid.origin.y + y as f64 * grid.dy,
                    grid.origin.z + z as f64 * grid.dz,
                );
                let n = (z * grid.ny + y) * grid.nx + x;
                let m = volume.contains_material(q);
                assert_eq!(output.beds[n], m.map_or(-1, |m| m.bed));
                let expected = m.map_or(1500.0, |m| {
                    if m.bed == -2 {
                        5600.0
                    } else {
                        physics::velocity(
                            m.sand_fraction,
                            (q.z - 10.0).max(0.0),
                            m.carbonate,
                            None,
                            Some(RockHistory {
                                max_burial: m.max_burial,
                                max_effective_depth: m.max_effective_depth,
                                bulk_porosity: Some(1.0 - m.grain_fraction),
                            }),
                        )
                    }
                });
                assert_eq!(output.velocity[n], expected);
            }
        }
    }
    assert_eq!(before, serde_json::to_value(volume.inventory()).unwrap());
    assert_eq!(output.stats.vertical_rays, grid.nx * grid.ny);
    assert!(output.stats.sampled_candidates < output.stats.points * 3);
}
#[test]
fn inclined_oblique_fault_projection_matches_unoptimized_point_queries() {
    let mut volume = volume();
    let norm = (1.0f64 + 0.16 + 0.64).sqrt();
    volume
        .slip_planar(PlanarFault {
            point: point(50.0, 40.0, 50.0),
            normal: point(1.0 / norm, 0.4 / norm, 0.8 / norm),
            slip: point(8.0, -4.0, -8.0),
        })
        .unwrap();
    let grid = grid();
    let output = project(&volume, request(grid)).unwrap();
    for z in 0..grid.nz {
        for y in 0..grid.ny {
            for x in 0..grid.nx {
                let q = point(
                    grid.origin.x + x as f64 * grid.dx,
                    grid.origin.y + y as f64 * grid.dy,
                    grid.origin.z + z as f64 * grid.dz,
                );
                let n = (z * grid.ny + y) * grid.nx + x;
                assert_eq!(
                    output.beds[n],
                    volume.contains_material(q).map_or(-1, |m| m.bed),
                    "{q:?}"
                );
                assert!((1500.0..=5600.0).contains(&output.velocity[n]));
            }
        }
    }
}
#[test]
fn uniform_crossline_reduces_to_identical_2d_slices_in_world_coordinates() {
    let mut volume = volume();
    let inv = 1.0 / 2.0f64.sqrt();
    volume
        .slip_planar(PlanarFault {
            point: point(50.0, 0.0, 50.0),
            normal: point(inv, 0.0, inv),
            slip: point(10.0, 0.0, -10.0),
        })
        .unwrap();
    let grid = GridGeometry {
        nx: 13,
        ny: 4,
        nz: 25,
        dx: 7.0,
        dy: 20.0,
        dz: 4.0,
        origin: point(1.0, 5.0, 0.5),
    };
    let three = project(&volume, request(grid)).unwrap();
    let two = project(
        &volume,
        request(GridGeometry {
            ny: 1,
            origin: point(1.0, 35.0, 0.5),
            ..grid
        }),
    )
    .unwrap();
    for z in 0..grid.nz {
        for y in 0..grid.ny {
            for x in 0..grid.nx {
                let n = (z * grid.ny + y) * grid.nx + x;
                let m = z * grid.nx + x;
                assert_eq!(three.beds[n], two.beds[m]);
                assert_eq!(three.velocity[n], two.velocity[m]);
            }
        }
    }
}
#[test]
fn shared_interfaces_and_domain_corners_follow_original_support_priority() {
    let volume = volume();
    let grid = GridGeometry {
        nx: 11,
        ny: 9,
        nz: 11,
        dx: 10.0,
        dy: 10.0,
        dz: 10.0,
        origin: P::default(),
    };
    let output = project(&volume, request(grid)).unwrap();
    for z in 0..grid.nz {
        for y in 0..grid.ny {
            for x in 0..grid.nx {
                assert_eq!(
                    output.beds[(z * grid.ny + y) * grid.nx + x],
                    volume
                        .contains_material(point(x as f64 * 10.0, y as f64 * 10.0, z as f64 * 10.0))
                        .map_or(-1, |m| m.bed)
                );
            }
        }
    }
}
#[test]
fn projection_rejects_bad_geometry_without_mutating_material() {
    let volume = volume();
    let before = serde_json::to_value(volume.inventory()).unwrap();
    let mut r = request(grid());
    r.grid.origin.x = -1.0;
    assert!(project(&volume, r).is_err());
    let mut r = request(grid());
    r.grid.nz = usize::MAX;
    assert!(project(&volume, r).is_err());
    let mut r = request(grid());
    r.grid.dx = 0.0;
    assert!(project(&volume, r).is_err());
    let mut r = request(grid());
    r.basement_velocity = f64::NAN;
    assert!(project(&volume, r).is_err());
    let mut r = request(grid());
    r.overpressure = Some(-1.0);
    assert!(project(&volume, r).is_err());
    assert_eq!(before, serde_json::to_value(volume.inventory()).unwrap());
}
