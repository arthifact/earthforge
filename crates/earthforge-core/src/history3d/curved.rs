//! Listric geometry through a volume-preserving coordinate conjugacy.
//!
//! Let r = (x - bend(y), y), s = -n_h dot (r - point)/|n_h|,
//! h(s) = -(|n_h|/n_z) c (sqrt(L²+s²)-L). The reference coordinates
//! are H(x,y,z) = (r.x, r.y, z-h(s)). H and its inverse are triangular
//! shears with determinant one. H^-1 (H(p)+slip) therefore has determinant
//! one, preserves fault side under tangential slip, and maps vertical rays
//! to vertical rays. This is kinematics, not a force-balance solution.
use crate::space::PlanarFault;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DipCurve {
    /// Fractional down-dip flattening; zero is exactly the old planar geometry.
    pub strength: f64,
    /// Horizontal transition length in metres in the reference fault frame.
    pub length: f64,
}
impl DipCurve {
    pub fn validate(self, fault: PlanarFault) -> Result<(), String> {
        fault.validate()?;
        let horizontal = crate::math::hypot(fault.normal.x, fault.normal.y);
        if !self.strength.is_finite()
            || !(0.0..=0.95).contains(&self.strength)
            || !self.length.is_finite()
            || !(1.0..=1e7).contains(&self.length)
            || fault.normal.z < 1e-6
            || horizontal < 1e-6
        {
            return Err(
                "Invalid listric curve: need a dipping fault, strength 0..0.95 and length 1..1e7 m"
                    .into(),
            );
        }
        Ok(())
    }
    /// Vertical shear at reference horizontal coordinates (after strike bend).
    pub fn offset(self, fault: PlanarFault, x: f64, y: f64) -> f64 {
        if self.strength == 0.0 {
            return 0.0;
        }
        let n = fault.normal;
        let horizontal = crate::math::hypot(n.x, n.y);
        let s = -((x - fault.point.x) * n.x + (y - fault.point.y) * n.y) / horizontal;
        // Rationalized sqrt(L²+s²)-L avoids cancellation near s=0.
        -(horizontal / n.z)
            * self.strength
            * (s / (crate::math::hypot(self.length, s) + self.length))
            * s
    }
    /// Global Lipschitz bound for the added vertical displacement of one slip.
    pub fn displacement_bound(self, fault: PlanarFault) -> f64 {
        self.strength
            * ((fault.normal.x * fault.slip.x + fault.normal.y * fault.slip.y) / fault.normal.z)
                .abs()
    }
}
