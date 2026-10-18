//! Conservative 3D kinematic prototype. Continuous convex fragments carry bed
//! identity, grain fraction and burial/loading memory through inclined faults.
//! Uniform stratification needs one support per layer, independent of voxel
//! resolution. This is not the complete 3D geological-history generator.
use crate::{
    material::{self, BASEMENT, Bed, Column, Layer, WATER},
    polyhedron::{Aabb, ConvexPolyhedron, Plane},
    space::{PlanarFault, WorldPoint as P},
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Material3d {
    pub bed: i32,
    pub grain_fraction: f64,
    pub sand_fraction: f64,
    pub carbonate: bool,
    pub max_burial: f64,
    pub max_effective_depth: f64,
}
impl Material3d {
    fn from_layer(p: &Layer, beds: &[Bed]) -> Result<Self, String> {
        if ![
            p.height, p.solid, p.fraction, p.burial, p.loading, p.offset_x, p.offset_y, p.offset_z,
        ]
        .iter()
        .all(|x| x.is_finite())
            || p.height <= 0.0
            || p.solid < 0.0
            || p.solid > p.height
            || !(0.0..=1.0).contains(&p.fraction)
            || p.burial < 0.0
            || p.loading < 0.0
            || (p.bed < 0 && p.solid != 0.0)
        {
            return Err("Invalid 3D source material".into());
        }
        if p.offset_x != 0.0 || p.offset_y != 0.0 || p.offset_z != 0.0 {
            return Err("A centroid offset cannot define a 3D support; explicit source geometry is required".into());
        }
        let carbonate = if p.bed >= 0 {
            beds.get(p.bed as usize)
                .ok_or("Invalid 3D bed index")?
                .carbonate
        } else {
            if p.bed != WATER && p.bed != BASEMENT {
                return Err("Invalid 3D background material".into());
            }
            false
        };
        Ok(Self {
            bed: p.bed,
            grain_fraction: if p.bed >= 0 { p.solid / p.height } else { 0.0 },
            sand_fraction: p.fraction,
            carbonate,
            max_burial: p.burial,
            max_effective_depth: p.loading,
        })
    }
}
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Fragment3d {
    pub material: Material3d,
    pub support: ConvexPolyhedron,
}
#[derive(Clone, Copy, Debug, Default, Serialize)]
pub struct BedGrains {
    pub total: f64,
    pub sand: f64,
    pub shale: f64,
    pub carbonate: f64,
}
impl BedGrains {
    fn values(self) -> [f64; 4] {
        [self.total, self.sand, self.shale, self.carbonate]
    }
    fn add(&mut self, q: Self) {
        self.total += q.total;
        self.sand += q.sand;
        self.shale += q.shale;
        self.carbonate += q.carbonate;
    }
}
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VolumeInventory {
    /// Explicit non-water support, including the geometric basement. Implicit
    /// background water is excluded from this tracked-material volume.
    pub bulk: f64,
    pub grain: f64,
    pub sand: f64,
    pub shale: f64,
    pub carbonate: f64,
    pub by_bed: BTreeMap<i32, BedGrains>,
}
impl VolumeInventory {
    fn add_material(&mut self, m: Material3d, volume: f64) {
        self.bulk += volume;
        if m.bed < 0 {
            return;
        }
        let grain = m.grain_fraction * volume;
        let g = if m.carbonate {
            BedGrains {
                total: grain,
                carbonate: grain,
                ..Default::default()
            }
        } else {
            BedGrains {
                total: grain,
                sand: m.sand_fraction * grain,
                shale: (1.0 - m.sand_fraction) * grain,
                carbonate: 0.0,
            }
        };
        self.grain += g.total;
        self.sand += g.sand;
        self.shale += g.shale;
        self.carbonate += g.carbonate;
        self.by_bed.entry(m.bed).or_default().add(g);
    }
    fn add(&mut self, other: &Self) {
        self.bulk += other.bulk;
        self.grain += other.grain;
        self.sand += other.sand;
        self.shale += other.shale;
        self.carbonate += other.carbonate;
        for (id, v) in &other.by_bed {
            self.by_bed.entry(*id).or_default().add(*v);
        }
    }
    fn values(&self) -> [f64; 5] {
        [self.bulk, self.grain, self.sand, self.shale, self.carbonate]
    }
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VolumeLedger {
    pub before: VolumeInventory,
    pub after: VolumeInventory,
    pub outflow: VolumeInventory,
    /// xmin, xmax, ymin, ymax, zmin, zmax. Corner losses are assigned to the
    /// first crossed clipping face in this fixed order, never counted twice.
    pub outflow_by_face: [VolumeInventory; 6],
    pub residual: VolumeInventory,
    pub max_normalized_residual: f64,
    pub closed: bool,
    pub fragments_before: usize,
    pub fragments_after: usize,
}
fn tolerance(scale: f64) -> f64 {
    1e-6 + 1e-10 * scale
}
fn ledger(
    before: VolumeInventory,
    after: VolumeInventory,
    faces: [VolumeInventory; 6],
    n0: usize,
    n1: usize,
) -> VolumeLedger {
    let mut outflow = VolumeInventory::default();
    for f in &faces {
        outflow.add(f);
    }
    let (r, worst) = inventory_residual(&before, &after, &outflow);
    VolumeLedger {
        before,
        after,
        outflow,
        outflow_by_face: faces,
        residual: r,
        max_normalized_residual: worst,
        closed: worst <= 1.0,
        fragments_before: n0,
        fragments_after: n1,
    }
}
fn inventory_residual(
    before: &VolumeInventory,
    after: &VolumeInventory,
    outflow: &VolumeInventory,
) -> (VolumeInventory, f64) {
    let mut r = VolumeInventory::default();
    let mut worst = 0.0f64;
    let (b, a, o) = (before.values(), after.values(), outflow.values());
    let mut values = [0.0; 5];
    for i in 0..5 {
        values[i] = b[i] - a[i] - o[i];
        worst = worst.max(values[i].abs() / tolerance(b[i].abs() + a[i].abs() + o[i].abs()));
    }
    (r.bulk, r.grain, r.sand, r.shale, r.carbonate) =
        (values[0], values[1], values[2], values[3], values[4]);
    for id in before
        .by_bed
        .keys()
        .chain(after.by_bed.keys())
        .chain(outflow.by_bed.keys())
    {
        let (b, a, o) = (
            before.by_bed.get(id).copied().unwrap_or_default().values(),
            after.by_bed.get(id).copied().unwrap_or_default().values(),
            outflow.by_bed.get(id).copied().unwrap_or_default().values(),
        );
        let mut v = [0.0; 4];
        for i in 0..4 {
            v[i] = b[i] - a[i] - o[i];
            worst = worst.max(v[i].abs() / tolerance(b[i].abs() + a[i].abs() + o[i].abs()));
        }
        r.by_bed.insert(
            *id,
            BedGrains {
                total: v[0],
                sand: v[1],
                shale: v[2],
                carbonate: v[3],
            },
        );
    }
    (r, worst)
}
/// A prescribed erosion surface in depth-positive world coordinates:
/// z = point.z + slope_x*(x-point.x) + slope_y*(y-point.y).
/// Material above this graph leaves the domain; no deposition or reworking is implied.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErosionSurface {
    pub point: P,
    #[serde(default)]
    pub slope_x: f64,
    #[serde(default)]
    pub slope_y: f64,
}
impl ErosionSurface {
    fn plane(self) -> Result<Plane, String> {
        Plane {
            point: self.point,
            normal: P {
                x: self.slope_x,
                y: self.slope_y,
                z: -1.0,
            },
        }
        .validate()
    }
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErosionLedger {
    pub surface: ErosionSurface,
    pub before: VolumeInventory,
    pub after: VolumeInventory,
    /// Exported material, not redeposited and not assigned to an exterior box face.
    pub removed: VolumeInventory,
    pub residual: VolumeInventory,
    pub max_normalized_residual: f64,
    pub closed: bool,
    pub fragments_before: usize,
    pub fragments_after: usize,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum VolumeEvent {
    Fault { fault: PlanarFault },
    Erosion { surface: ErosionSurface },
}
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", content = "ledger", rename_all = "camelCase")]
pub enum EventLedger {
    Fault(Box<VolumeLedger>),
    Erosion(Box<ErosionLedger>),
}
#[derive(Clone, Debug, Serialize)]
pub struct SectionParcel3d {
    pub material: Material3d,
    pub polygon: Vec<P>,
}
#[derive(Clone, Debug, Serialize)]
pub struct MaterialVolume {
    pub bounds: Aabb,
    fragments: Vec<Fragment3d>,
    max_fragments: usize,
}
impl MaterialVolume {
    pub fn from_layers(bounds: Aabb, column: &Column, beds: &[Bed]) -> Result<Self, String> {
        let bounds = bounds.validate()?;
        let depth = bounds.max.z - bounds.min.z;
        let exact = material::scale(&[column], &[depth])?;
        if material::total(column, exact)? != exact.units(depth)? {
            return Err("3D source column does not exactly fill its vertical domain".into());
        }
        let mut fragments = vec![];
        let mut top = exact.units(0.0)?;
        for p in column {
            let m = Material3d::from_layer(p, beds)?;
            let bottom = &top + p.units(exact)?;
            if exact.number(&p.units(exact)?)? != p.height {
                return Err("Inconsistent exact source support".into());
            }
            if p.bed != WATER {
                let z0 = bounds.min.z + exact.number(&top)?;
                let z1 = bounds.min.z + exact.number(&bottom)?;
                let support = ConvexPolyhedron::cuboid(Aabb {
                    min: P {
                        z: z0,
                        ..bounds.min
                    },
                    max: P {
                        z: z1,
                        ..bounds.max
                    },
                })?;
                fragments.push(Fragment3d {
                    material: m,
                    support,
                });
            }
            top = bottom;
        }
        let result = Self {
            bounds,
            fragments,
            max_fragments: 100_000,
        };
        // Independent constructor inventory: grain thickness times horizontal area.
        let area = (bounds.max.x - bounds.min.x) * (bounds.max.y - bounds.min.y);
        let mut source = VolumeInventory::default();
        for p in column {
            if p.bed != WATER {
                let m = Material3d::from_layer(p, beds)?;
                source.add_material(m, p.height * area);
            }
        }
        let check = ledger(
            source,
            result.inventory(),
            Default::default(),
            result.fragments.len(),
            result.fragments.len(),
        );
        if !check.closed {
            return Err("3D source geometry cannot represent its grain inventory".into());
        }
        Ok(result)
    }
    pub fn fragments(&self) -> &[Fragment3d] {
        &self.fragments
    }
    pub fn inventory(&self) -> VolumeInventory {
        let mut out = VolumeInventory::default();
        for f in &self.fragments {
            out.add_material(f.material, f.support.volume());
        }
        out
    }
    pub fn contains_material(&self, point: P) -> Option<Material3d> {
        if !self.bounds.contains(point) {
            return None;
        }
        self.fragments
            .iter()
            .find(|f| f.support.contains(point))
            .map(|f| f.material)
    }
    pub fn section_y(&self, y: f64) -> Result<Vec<SectionParcel3d>, String> {
        if !y.is_finite() || y < self.bounds.min.y || y > self.bounds.max.y {
            return Err("Section outside 3D volume".into());
        }
        let plane = Plane {
            point: P { x: 0.0, y, z: 0.0 },
            normal: P {
                x: 0.0,
                y: 1.0,
                z: 0.0,
            },
        };
        let mut out = vec![];
        for fragment in &self.fragments {
            let polygon = fragment.support.section(plane)?;
            if polygon.len() >= 3 {
                out.push(SectionParcel3d {
                    material: fragment.material,
                    polygon,
                });
            }
        }
        Ok(out)
    }
    pub fn apply(&mut self, event: VolumeEvent) -> Result<EventLedger, String> {
        match event {
            VolumeEvent::Fault { fault } => self
                .slip_planar(fault)
                .map(|ledger| EventLedger::Fault(Box::new(ledger))),
            VolumeEvent::Erosion { surface } => self
                .erode_planar(surface)
                .map(|ledger| EventLedger::Erosion(Box::new(ledger))),
        }
    }
    /// Remove material shallower than a prescribed planar erosion surface.
    /// Each retained support keeps its material identity and irreversible memory.
    /// Both sides are clipped independently and balanced before committing state.
    pub fn erode_planar(&mut self, surface: ErosionSurface) -> Result<ErosionLedger, String> {
        let plane = surface.plane()?;
        let before = self.inventory();
        let mut next = Vec::with_capacity(self.fragments.len());
        let mut removed = VolumeInventory::default();
        for fragment in &self.fragments {
            let (retained, exported) = fragment.support.split(plane)?;
            if let Some(support) = exported {
                removed.add_material(fragment.material, support.volume());
            }
            if let Some(support) = retained {
                next.push(Fragment3d {
                    material: fragment.material,
                    support,
                });
            }
        }
        let candidate = Self {
            bounds: self.bounds,
            fragments: next,
            max_fragments: self.max_fragments,
        };
        let after = candidate.inventory();
        let (residual, worst) = inventory_residual(&before, &after, &removed);
        let check = ErosionLedger {
            surface,
            before,
            after,
            removed,
            residual,
            max_normalized_residual: worst,
            closed: worst <= 1.0,
            fragments_before: self.fragments.len(),
            fragments_after: candidate.fragments.len(),
        };
        if !check.closed {
            return Err(format!(
                "3D erosion grain-volume closure failed: normalized residual {worst}"
            ));
        }
        *self = candidate;
        Ok(check)
    }
    /// Move only the negative half-space by a tangential world-space vector.
    /// Supports are split before movement; footwall material is immutable.
    /// Open boundaries discard only the geometrically clipped, separately booked
    /// material. Grain composition and irreversible memories are never averaged.
    pub fn slip_planar(&mut self, fault: PlanarFault) -> Result<VolumeLedger, String> {
        let fault = fault.validate()?;
        let plane = Plane {
            point: fault.point,
            normal: fault.normal,
        };
        let before = self.inventory();
        let mut next = vec![];
        let mut faces: [VolumeInventory; 6] = Default::default();
        for fragment in &self.fragments {
            let (moving, fixed) = fragment.support.split(plane)?;
            if let Some(support) = fixed {
                next.push(Fragment3d {
                    material: fragment.material,
                    support,
                });
            }
            if let Some(support) = moving {
                let mut current = Some(support.translated(fault.slip)?);
                for (i, boundary) in self.bounds.planes().iter().enumerate() {
                    let Some(support) = current else {
                        break;
                    };
                    let volume = support.volume();
                    current = support.clip(*boundary, true)?;
                    let kept = current.as_ref().map_or(0.0, ConvexPolyhedron::volume);
                    let lost = volume - kept;
                    if lost < -tolerance(volume + kept) {
                        return Err("3D boundary clipping increased material volume".into());
                    }
                    // A tiny negative difference remains visible in the final residual; it
                    // cannot become a physically negative boundary flux or a grain repair.
                    faces[i].add_material(fragment.material, lost.max(0.0));
                }
                if let Some(support) = current {
                    next.push(Fragment3d {
                        material: fragment.material,
                        support,
                    });
                }
            }
            if next.len() > self.max_fragments {
                return Err("3D fragment budget exceeded".into());
            }
        }
        let candidate = Self {
            bounds: self.bounds,
            fragments: next,
            max_fragments: self.max_fragments,
        };
        let check = ledger(
            before,
            candidate.inventory(),
            faces,
            self.fragments.len(),
            candidate.fragments.len(),
        );
        if !check.closed {
            return Err(format!(
                "3D grain-volume closure failed: normalized residual {}",
                check.max_normalized_residual
            ));
        }
        *self = candidate;
        Ok(check)
    }
}
