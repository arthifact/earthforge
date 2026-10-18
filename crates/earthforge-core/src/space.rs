//! World coordinates are metres (z positive down); storage indices are distinct.
use serde::{Deserialize, Serialize};
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct WorldPoint {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct ColumnIndex {
    pub x: usize,
    pub y: usize,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct GridGeometry {
    pub nx: usize,
    pub ny: usize,
    pub nz: usize,
    pub dx: f64,
    pub dy: f64,
    pub dz: f64,
    pub origin: WorldPoint,
}
impl GridGeometry {
    pub fn validate(self) -> Result<Self, String> {
        if self.nx == 0
            || self.ny == 0
            || self.nz == 0
            || [self.dx, self.dy, self.dz]
                .iter()
                .any(|h| !h.is_finite() || *h <= 0.0)
            || [self.origin.x, self.origin.y, self.origin.z]
                .iter()
                .any(|x| !x.is_finite())
        {
            return Err("Invalid grid geometry".into());
        }
        self.nx
            .checked_mul(self.ny)
            .and_then(|n| n.checked_mul(self.nz))
            .ok_or("Grid size overflow")?;
        Ok(self)
    }
    pub fn column(self, i: ColumnIndex) -> Result<usize, String> {
        if i.x >= self.nx || i.y >= self.ny {
            return Err("Column outside grid".into());
        }
        Ok(i.y * self.nx + i.x)
    }
    pub fn world(self, i: ColumnIndex, z: f64) -> WorldPoint {
        WorldPoint {
            x: self.origin.x + i.x as f64 * self.dx,
            y: self.origin.y + i.y as f64 * self.dy,
            z: self.origin.z + z,
        }
    }
    pub fn column_area(self) -> f64 {
        self.dx * self.dy
    }
}
/// A genuine 3D planar fault; signed distance and slip use the same world frame.
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct PlanarFault {
    pub point: WorldPoint,
    pub normal: WorldPoint,
    pub slip: WorldPoint,
}
impl PlanarFault {
    pub fn validate(self) -> Result<Self, String> {
        let n = self.normal;
        let s = self.slip;
        let norm = (n.x * n.x + n.y * n.y + n.z * n.z).sqrt();
        if [
            self.point.x,
            self.point.y,
            self.point.z,
            n.x,
            n.y,
            n.z,
            s.x,
            s.y,
            s.z,
        ]
        .iter()
        .any(|x| !x.is_finite())
            || (norm - 1.0).abs() > 1e-12
            || (n.x * s.x + n.y * s.y + n.z * s.z).abs()
                > 1e-10 * (1.0 + (s.x * s.x + s.y * s.y + s.z * s.z).sqrt())
        {
            return Err("Invalid planar fault normal or nontangential slip".into());
        }
        Ok(self)
    }
    pub fn signed_distance(self, p: WorldPoint) -> f64 {
        (p.x - self.point.x) * self.normal.x
            + (p.y - self.point.y) * self.normal.y
            + (p.z - self.point.z) * self.normal.z
    }
    pub fn moved(self, p: WorldPoint) -> WorldPoint {
        if self.signed_distance(p) < 0.0 {
            WorldPoint {
                x: p.x + self.slip.x,
                y: p.y + self.slip.y,
                z: p.z + self.slip.z,
            }
        } else {
            p
        }
    }
}
