//! Derived nodal velocity grids from continuous material supports. Geological
//! state is never rasterized back from this output. Vertical ray bounds avoid
//! testing every fragment at every voxel; only intersected spans are sampled.
use crate::{
    material::{BASEMENT, WATER},
    physics::{self, RockHistory},
    polyhedron::{cross, dot, sub},
    space::{GridGeometry, WorldPoint as P},
    volume3d::{Material3d, MaterialVolume},
};
use serde::{Deserialize, Serialize};
fn default_basement() -> f64 {
    5600.0
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectionRequest {
    pub grid: GridGeometry,
    #[serde(default)]
    pub overpressure: Option<f64>,
    #[serde(default = "default_basement")]
    pub basement_velocity: f64,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Projection {
    pub grid: GridGeometry,
    pub layout: &'static str,
    pub sampling: &'static str,
    pub depth_reference: &'static str,
    pub velocity: Vec<f64>,
    pub beds: Vec<i32>,
    pub stats: ProjectionStats,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectionStats {
    pub points: usize,
    pub vertical_rays: usize,
    pub source_fragments: usize,
    pub candidate_spans: usize,
    pub sampled_candidates: usize,
}
struct Support {
    material: Material3d,
    min: P,
    max: P,
    planes: Vec<(P, P)>,
}
impl Support {
    fn contains(&self, p: P) -> bool {
        self.planes
            .iter()
            .all(|&(origin, normal)| dot(normal, sub(p, origin)) <= 0.0)
    }
    fn vertical_span(&self, x: f64, y: f64) -> Result<Option<(f64, f64)>, String> {
        if x < self.min.x || x > self.max.x || y < self.min.y || y > self.max.y {
            return Ok(None);
        }
        let mut lo = self.min.z;
        let mut hi = self.max.z;
        for &(origin, normal) in &self.planes {
            let horizontal = normal.x * (x - origin.x) + normal.y * (y - origin.y);
            if !horizontal.is_finite() {
                return Err("Nonfinite 3D ray arithmetic".into());
            }
            if normal.z == 0.0 {
                if horizontal > 0.0 {
                    return Ok(None);
                }
            } else {
                let intercept = origin.z - horizontal / normal.z;
                // An infinite intercept is a redundant half-space only when it
                // points away from the finite support; otherwise no ray enters.
                if intercept.is_nan() {
                    return Err("Invalid 3D ray intersection".into());
                }
                if normal.z > 0.0 {
                    hi = hi.min(intercept);
                } else {
                    lo = lo.max(intercept);
                }
                if hi < lo {
                    return Ok(None);
                }
            }
        }
        Ok((hi >= lo).then_some((lo, hi)))
    }
}
pub fn project(volume: &MaterialVolume, request: ProjectionRequest) -> Result<Projection, String> {
    let grid = request.grid.validate()?;
    let points = grid
        .nx
        .checked_mul(grid.ny)
        .and_then(|n| n.checked_mul(grid.nz))
        .ok_or("3D projection size overflow")?;
    if points > 4_000_000
        || !request.basement_velocity.is_finite()
        || request.basement_velocity <= 0.0
        || request
            .overpressure
            .is_some_and(|p| !p.is_finite() || p < 0.0)
    {
        return Err("Invalid or oversized 3D projection request".into());
    }
    let bounds = volume.bounds;
    let end = P {
        x: grid.origin.x + (grid.nx - 1) as f64 * grid.dx,
        y: grid.origin.y + (grid.ny - 1) as f64 * grid.dy,
        z: grid.origin.z + (grid.nz - 1) as f64 * grid.dz,
    };
    if !bounds.contains(grid.origin)
        || !bounds.contains(end)
        || [end.x, end.y, end.z].iter().any(|x| !x.is_finite())
    {
        return Err("Derived nodal grid lies outside the 3D material volume".into());
    }
    let mut supports = Vec::with_capacity(volume.fragments().len());
    let mut plane_count = 0usize;
    for fragment in volume.fragments() {
        let vertices = fragment.support.vertices();
        let mut min = P {
            x: f64::INFINITY,
            y: f64::INFINITY,
            z: f64::INFINITY,
        };
        let mut max = P {
            x: f64::NEG_INFINITY,
            y: f64::NEG_INFINITY,
            z: f64::NEG_INFINITY,
        };
        for p in vertices {
            min.x = min.x.min(p.x);
            min.y = min.y.min(p.y);
            min.z = min.z.min(p.z);
            max.x = max.x.max(p.x);
            max.y = max.y.max(p.y);
            max.z = max.z.max(p.z);
        }
        let mut planes = Vec::new();
        for face in fragment.support.faces() {
            let normal = (1..face.len() - 1)
                .map(|i| cross(sub(face[i], face[0]), sub(face[i + 1], face[0])))
                .find(|n| n.x != 0.0 || n.y != 0.0 || n.z != 0.0);
            if let Some(normal) = normal {
                if [normal.x, normal.y, normal.z]
                    .iter()
                    .any(|x| !x.is_finite())
                {
                    return Err("3D projection normal exceeds finite geometry".into());
                }
                planes.push((face[0], normal));
            }
        }
        plane_count += planes.len();
        supports.push(Support {
            material: fragment.material,
            min,
            max,
            planes,
        });
    }
    let rays = grid.nx * grid.ny;
    if rays
        .checked_mul(plane_count)
        .is_none_or(|work| work > 100_000_000)
    {
        return Err(
            "3D projection ray work exceeds prototype limits; request a smaller tile".into(),
        );
    }
    let mut velocity = vec![1500.0; points];
    let mut beds = vec![WATER; points];
    let mut spans = Vec::with_capacity(supports.len());
    let mut candidate_spans = 0;
    let mut sampled_candidates = 0;
    for y in 0..grid.ny {
        for x in 0..grid.nx {
            let wx = grid.origin.x + x as f64 * grid.dx;
            let wy = grid.origin.y + y as f64 * grid.dy;
            spans.clear();
            let mut surface = bounds.max.z;
            for (id, support) in supports.iter().enumerate() {
                if let Some((lo, hi)) = support.vertical_span(wx, wy)? {
                    surface = surface.min(lo);
                    spans.push((id, lo, hi));
                }
            }
            candidate_spans += spans.len();
            // Preserve original support priority on zero-measure shared interfaces.
            for &(id, lo, hi) in &spans {
                let support = &supports[id];
                let m = support.material;
                // Expand by a node at each end, then use the original half-space
                // predicate. Ray division roundoff cannot omit a boundary node.
                let first = (((lo - grid.origin.z) / grid.dz).ceil() - 1.0)
                    .clamp(0.0, grid.nz as f64) as usize;
                let last = (((hi - grid.origin.z) / grid.dz).floor() + 1.0)
                    .clamp(0.0, (grid.nz - 1) as f64) as usize;
                if first >= grid.nz {
                    continue;
                }
                for z in first..=last {
                    let index = (z * grid.ny + y) * grid.nx + x;
                    if beds[index] != WATER {
                        continue;
                    }
                    sampled_candidates += 1;
                    if sampled_candidates > 30_000_000 {
                        return Err("3D projection sampling work exceeds prototype limits; request a smaller tile".into());
                    }
                    let wz = grid.origin.z + z as f64 * grid.dz;
                    if !support.contains(P {
                        x: wx,
                        y: wy,
                        z: wz,
                    }) {
                        continue;
                    }
                    beds[index] = m.bed;
                    velocity[index] = if m.bed == BASEMENT {
                        request.basement_velocity
                    } else {
                        physics::velocity(
                            m.sand_fraction,
                            (wz - surface).max(0.0),
                            m.carbonate,
                            request.overpressure,
                            Some(RockHistory {
                                max_burial: m.max_burial,
                                max_effective_depth: m.max_effective_depth,
                                bulk_porosity: Some(1.0 - m.grain_fraction),
                            }),
                        )
                    };
                    if !velocity[index].is_finite() || velocity[index] <= 0.0 {
                        return Err("Nonfinite projected 3D rock velocity".into());
                    }
                }
            }
        }
    }
    Ok(Projection {
        grid,
        layout: "Nodal, x fastest then y then z: (z*ny+y)*nx+x",
        sampling: "Point samples of closed supports; shared-interface ties follow original fragment order. Derived output, not conserved material state.",
        depth_reference: "Current depth below the shallowest explicit non-water support on the same vertical ray; burial/loading memory and bulk porosity remain attached to material",
        velocity,
        beds,
        stats: ProjectionStats {
            points,
            vertical_rays: rays,
            source_fragments: supports.len(),
            candidate_spans,
            sampled_candidates,
        },
    })
}
