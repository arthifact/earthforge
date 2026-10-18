use super::profile::{Profile, grains};
use crate::{
    material::{self, Bed, Column},
    polyhedron::Aabb,
    space::PlanarFault,
};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::Arc};
fn ten() -> f64 {
    10.0
}
fn yes() -> bool {
    true
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpatialField {
    #[serde(default)]
    pub value: f64,
    #[serde(default)]
    pub slope_x: f64,
    #[serde(default)]
    pub slope_y: f64,
    #[serde(default)]
    pub waves: Vec<Wave>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fronts: Vec<FaciesFront>,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Wave {
    pub amplitude: f64,
    pub kx: f64,
    pub ky: f64,
    #[serde(default)]
    pub phase: f64,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FaciesFront {
    pub amplitude: f64,
    pub centre: f64,
    pub width: f64,
    #[serde(default)]
    pub skew_y: f64,
}
impl SpatialField {
    pub fn constant(value: f64) -> Self {
        Self {
            value,
            ..Default::default()
        }
    }
    pub fn at(&self, x: f64, y: f64) -> Result<f64, String> {
        let mut v = self.value
            + self.slope_x * x
            + self.slope_y * y
            + self
                .waves
                .iter()
                .map(|w| w.amplitude * crate::math::sin(w.kx * x + w.ky * y + w.phase))
                .sum::<f64>();
        if !self.fronts.is_empty() {
            v += self
                .fronts
                .iter()
                .map(|f| f.amplitude * crate::math::tanh((x + f.skew_y * y - f.centre) / f.width))
                .sum::<f64>();
        }
        if !v.is_finite() || v.abs() > 1e9 {
            Err("3D field exceeds finite regional bounds".into())
        } else {
            Ok(v)
        }
    }
    fn validate(&self) -> Result<(), String> {
        if ![self.value, self.slope_x, self.slope_y]
            .iter()
            .all(|v| v.is_finite())
            || self.fronts.len() > 8
            || self.fronts.iter().any(|f| {
                ![f.amplitude, f.centre, f.width, f.skew_y]
                    .iter()
                    .all(|v| v.is_finite())
                    || f.width <= 0.0
            })
            || self.waves.len() > 8
            || self.waves.iter().any(|w| {
                ![w.amplitude, w.kx, w.ky, w.phase]
                    .iter()
                    .all(|v| v.is_finite())
            })
        {
            return Err("Invalid 3D spatial field".into());
        }
        Ok(())
    }
    fn dependence(&self) -> [bool; 2] {
        [
            self.slope_x != 0.0
                || self.waves.iter().any(|w| w.amplitude != 0.0 && w.kx != 0.0)
                || self.fronts.iter().any(|f| f.amplitude != 0.0),
            self.slope_y != 0.0
                || self.waves.iter().any(|w| w.amplitude != 0.0 && w.ky != 0.0)
                || self
                    .fronts
                    .iter()
                    .any(|f| f.amplitude != 0.0 && f.skew_y != 0.0),
        ]
    }
}
/// A shear x' = x - A sin(ky*y + phase). Its Jacobian determinant is one.
/// Conjugating a tangential planar slip by this shear preserves volume and
/// keeps vertical source rays vertical. Curvature is along strike, not in dip.
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StrikeBend {
    pub amplitude: f64,
    pub wavelength: f64,
    #[serde(default)]
    pub phase: f64,
}
impl StrikeBend {
    pub fn offset(self, y: f64) -> f64 {
        self.amplitude * crate::math::sin(std::f64::consts::TAU * y / self.wavelength + self.phase)
    }
    fn validate(self) -> Result<(), String> {
        if ![self.amplitude, self.wavelength, self.phase]
            .iter()
            .all(|v| v.is_finite())
            || self.amplitude.abs() > 5000.0
            || self.wavelength < 1.0
        {
            return Err("Invalid along-strike fault bend".into());
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
// At most 256 events: inline fields cost under 80 KiB and avoid four extra
// allocations per deposition event. Profiles dominate the memory footprint.
#[allow(clippy::large_enum_variant)]
pub enum HistoryEvent {
    Subsidence {
        displacement: SpatialField,
    },
    Deposit {
        bed: usize,
        #[serde(default)]
        thickness: Option<SpatialField>,
        #[serde(default)]
        fill_to: Option<SpatialField>,
        #[serde(default)]
        max_thickness: Option<SpatialField>,
        #[serde(default)]
        fraction: Option<SpatialField>,
        #[serde(default = "yes")]
        compact: bool,
    },
    Erosion {
        surface: SpatialField,
    },
    Fault {
        fault: PlanarFault,
    },
    SweptFault {
        fault: PlanarFault,
        bend: StrikeBend,
    },
    Pressure {
        #[serde(default)]
        top: Option<SpatialField>,
        #[serde(default = "yes")]
        compact: bool,
    },
    Compact {},
}
impl HistoryEvent {
    pub(super) fn fault_transform(&self) -> Option<(PlanarFault, Option<StrikeBend>)> {
        match self {
            Self::Fault { fault } => Some((*fault, None)),
            Self::SweptFault { fault, bend } => Some((*fault, Some(*bend))),
            _ => None,
        }
    }
    fn fields(&self) -> Vec<&SpatialField> {
        match self {
            Self::Subsidence { displacement } => vec![displacement],
            Self::Deposit {
                thickness,
                fill_to,
                max_thickness,
                fraction,
                ..
            } => thickness
                .iter()
                .chain(fill_to)
                .chain(max_thickness)
                .chain(fraction)
                .collect(),
            Self::Erosion { surface } => vec![surface],
            Self::Pressure { top, .. } => top.iter().collect(),
            _ => vec![],
        }
    }
    pub fn name(&self) -> &'static str {
        match self {
            Self::Subsidence { .. } => "subsidence",
            Self::Deposit { .. } => "deposition",
            Self::Erosion { .. } => "erosion",
            Self::Fault { .. } => "fault slip",
            Self::SweptFault { .. } => "curved-strike fault slip",
            Self::Pressure { .. } => "pressure",
            Self::Compact {} => "compaction",
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistorySpec {
    pub bounds: Aabb,
    pub initial_surface: SpatialField,
    #[serde(default)]
    pub initial_layers: Column,
    pub beds: Vec<Bed>,
    pub events: Vec<HistoryEvent>,
    #[serde(default = "ten")]
    pub material_step: f64,
    /// Event counts exposed as coherent replay stages. Empty means every event.
    #[serde(default)]
    pub stages: Vec<usize>,
}
pub struct HistoryModel {
    pub spec: HistorySpec,
    dependence: Vec<[bool; 2]>,
    pressure: Vec<Option<SpatialField>>,
    last_fault: Vec<Option<usize>>,
    bounds: super::bounds::Bounds,
}
impl HistoryModel {
    pub fn compile(mut spec: HistorySpec) -> Result<Self, String> {
        spec.bounds.validate()?;
        spec.initial_surface.validate()?;
        if spec.events.len() > 256
            || spec
                .events
                .iter()
                .filter(|e| e.fault_transform().is_some())
                .count()
                > 8
            || spec.beds.len() > 256
            || spec.initial_layers.len() > 4096
            || !spec.material_step.is_finite()
            || !(0.25..=100.0).contains(&spec.material_step)
        {
            return Err("3D history exceeds model limits".into());
        }
        for b in &spec.beds {
            if ![b.a, b.b, b.c, b.d].iter().all(|x| x.is_finite()) || b.d <= 0.0 {
                return Err("Invalid 3D bed law".into());
            }
        }
        for p in &spec.initial_layers {
            if ![
                p.height, p.solid, p.fraction, p.burial, p.loading, p.offset_x, p.offset_y,
                p.offset_z,
            ]
            .iter()
            .all(|x| x.is_finite())
                || p.height <= 0.0
                || p.solid < 0.0
                || p.solid > p.height
                || !(0.0..=1.0).contains(&p.fraction)
                || p.burial < 0.0
                || p.loading < 0.0
                || p.bed >= spec.beds.len() as i32
                || p.bed < -2
                || (p.bed < 0 && p.solid != 0.0)
            {
                return Err("Invalid initial 3D material".into());
            }
        }
        let initial_scale = material::scale(&[&spec.initial_layers], &[])?;
        for p in &spec.initial_layers {
            if initial_scale.number(&p.units(initial_scale)?)? != p.height {
                return Err("Inconsistent exact initial3D interval".into());
            }
        }
        if spec.stages.is_empty() {
            spec.stages = (0..=spec.events.len()).collect();
        }
        if spec.stages.first() != Some(&0)
            || spec.stages.last() != Some(&spec.events.len())
            || spec.stages.windows(2).any(|v| v[0] >= v[1])
        {
            return Err("3D replay stages must span increasing event prefixes".into());
        }
        let mut dependence = vec![spec.initial_surface.dependence()];
        let mut pressure = vec![None];
        let mut last_fault = vec![None];
        for (i, e) in spec.events.iter().enumerate() {
            let mut dep = *dependence.last().unwrap();
            let mut p = pressure.last().unwrap().clone();
            for f in e.fields() {
                f.validate()?;
                let d = f.dependence();
                dep[0] |= d[0];
                dep[1] |= d[1];
            }
            match e {
                HistoryEvent::Fault { fault } => {
                    fault.validate()?;
                    dep[0] |= fault.normal.x != 0.0;
                    dep[1] |= fault.normal.y != 0.0;
                }
                HistoryEvent::SweptFault { fault, bend } => {
                    fault.validate()?;
                    bend.validate()?;
                    dep[0] |= fault.normal.x != 0.0;
                    dep[1] |= fault.normal.y != 0.0 || bend.amplitude != 0.0;
                }
                HistoryEvent::Deposit {
                    bed,
                    thickness,
                    fill_to,
                    ..
                } => {
                    if *bed >= spec.beds.len() || thickness.is_some() == fill_to.is_some() {
                        return Err(
                            "Choose one deposition thickness or fill surface and a valid bed"
                                .into(),
                        );
                    }
                    dep[0] |= spec.beds[*bed].b != 0.0;
                }
                HistoryEvent::Pressure { top, .. } => p = top.clone(),
                _ => {}
            }
            dependence.push(dep);
            pressure.push(p);
            last_fault.push(if e.fault_transform().is_some() {
                Some(i)
            } else {
                *last_fault.last().unwrap()
            });
        }
        let bounds = super::bounds::Bounds::new(&spec)?;
        Ok(Self {
            spec,
            dependence,
            pressure,
            last_fault,
            bounds,
        })
    }
    pub fn pressure_at(&self, n: usize, x: f64, y: f64) -> Result<Option<f64>, String> {
        let p = self.pressure[n].as_ref().map(|p| p.at(x, y)).transpose()?;
        if p.is_some_and(|v| v < 0.0) {
            return Err("Negative prescribed 3D pressure-top depth".into());
        }
        Ok(p)
    }
    pub fn evaluator(&self) -> Evaluator<'_> {
        Evaluator {
            model: self,
            cache: HashMap::new(),
            cached_layers: 0,
            stats: EvalStats::default(),
            pruning: true,
        }
    }
    pub fn evaluator_unpruned(&self) -> Evaluator<'_> {
        let mut e = self.evaluator();
        e.pruning = false;
        e
    }
}
#[derive(Clone, Copy, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EvalStats {
    pub evaluated_profiles: usize,
    pub cache_hits: usize,
    pub peak_cached_layers: usize,
    pub local_events_checked: usize,
    pub max_normalized_grain_residual: f64,
    pub compaction_layers: usize,
    pub porosity_evaluations: usize,
    pub pruned_fault_branches: usize,
}
impl EvalStats {
    pub fn add(&mut self, b: Self) {
        self.evaluated_profiles += b.evaluated_profiles;
        self.cache_hits += b.cache_hits;
        self.peak_cached_layers = self.peak_cached_layers.max(b.peak_cached_layers);
        self.local_events_checked += b.local_events_checked;
        self.max_normalized_grain_residual = self
            .max_normalized_grain_residual
            .max(b.max_normalized_grain_residual);
        self.compaction_layers += b.compaction_layers;
        self.porosity_evaluations += b.porosity_evaluations;
        self.pruned_fault_branches += b.pruned_fault_branches;
    }
}
pub struct Evaluator<'a> {
    model: &'a HistoryModel,
    cache: HashMap<(usize, u64, u64), Arc<Profile>>,
    cached_layers: usize,
    pub stats: EvalStats,
    pruning: bool,
}
impl Evaluator<'_> {
    pub fn evaluate(&mut self, n: usize, x: f64, y: f64) -> Result<Arc<Profile>, String> {
        if n > self.model.spec.events.len() || ![x, y].iter().all(|v| v.is_finite()) {
            return Err("Invalid 3D history query".into());
        }
        let dep = self.model.dependence[n];
        let key = (
            n,
            if !dep[0] || x == 0.0 { 0 } else { x.to_bits() },
            if !dep[1] || y == 0.0 { 0 } else { y.to_bits() },
        );
        if let Some(p) = self.cache.get(&key) {
            self.stats.cache_hits += 1;
            return Ok(Arc::clone(p));
        }
        self.stats.evaluated_profiles += 1;
        if self.stats.evaluated_profiles > 200_000 {
            return Err("3D ray evaluation budget exceeded".into());
        }
        let (mut profile, start) = if let Some(i) = self.model.last_fault[n] {
            let (fault, bend) = self.model.spec.events[i].fault_transform().unwrap();
            let reference_x = bend.map_or(x, |b| x - b.offset(y));
            let source_y = y - fault.slip.y;
            let source_x = bend.map_or(x - fault.slip.x, |b| {
                reference_x - fault.slip.x + b.offset(source_y)
            });
            let actual_dx = bend.map_or(fault.slip.x, |_| x - source_x);
            let pressure = self.model.pressure_at(i + 1, x, y)?;
            let moving = |e: &mut Self| -> Result<Profile, String> {
                let mut p = (*e.evaluate(i, source_x, source_y)?).clone();
                p.translated(fault.slip.z)?;
                for l in &mut p.layers {
                    l.offset_x += actual_dx;
                    l.offset_y += fault.slip.y;
                    l.offset_z += fault.slip.z;
                }
                Ok(p)
            };
            let mut p = if fault.normal.z == 0.0 {
                if (reference_x - fault.point.x) * fault.normal.x
                    + (y - fault.point.y) * fault.normal.y
                    < 0.0
                {
                    moving(self)?
                } else {
                    (*self.evaluate(i, x, y)?).clone()
                }
            } else {
                let cut = fault.point.z
                    - ((reference_x - fault.point.x) * fault.normal.x
                        + (y - fault.point.y) * fault.normal.y)
                        / fault.normal.z;
                if !cut.is_finite() {
                    return Err("3D fault/ray intersection exceeds finite bounds".into());
                }
                let envelope = self.model.bounds.envelopes[i];
                let below = cut < envelope[0].min(envelope[0] + fault.slip.z);
                let above = cut > envelope[1].max(envelope[1] + fault.slip.z);
                if self.pruning && self.model.bounds.valid_for(i + 1, x, y) && (below || above) {
                    self.stats.pruned_fault_branches += 1;
                    let use_moving = if below {
                        fault.normal.z < 0.0
                    } else {
                        fault.normal.z > 0.0
                    };
                    let mut p = if use_moving {
                        moving(self)?
                    } else {
                        (*self.evaluate(i, x, y)?).clone()
                    };
                    p.canonicalize_fault()?;
                    p
                } else {
                    let a = self.evaluate(i, x, y)?;
                    let b = moving(self)?;
                    if fault.normal.z > 0.0 {
                        Profile::splice(&b, &a, cut)?
                    } else {
                        Profile::splice(&a, &b, cut)?
                    }
                }
            };
            p.record_loading(pressure);
            (p, i + 1)
        } else {
            (
                Profile::new(
                    self.model.spec.initial_surface.at(x, y)?,
                    self.model.spec.initial_layers.clone(),
                )?,
                0,
            )
        };
        for i in start..n {
            let event = &self.model.spec.events[i];
            let pressure = self.model.pressure_at(i + 1, x, y)?;
            let before = profile.grains();
            let mut incoming = Column::new();
            let mut removed = Column::new();
            match event {
                HistoryEvent::Subsidence { displacement } => {
                    profile.translated(displacement.at(x, y)?)?
                }
                HistoryEvent::Deposit {
                    bed,
                    thickness,
                    fill_to,
                    max_thickness,
                    fraction,
                    compact,
                } => {
                    let mut t = match thickness {
                        Some(t) => t.at(x, y)?,
                        None => (profile.top()? - fill_to.as_ref().unwrap().at(x, y)?).max(0.0),
                    };
                    if let Some(max) = max_thickness {
                        t = t.min(max.at(x, y)?.max(0.0));
                    }
                    if t < 0.0 {
                        return Err("Negative 3D deposition thickness".into());
                    }
                    let bed_law = &self.model.spec.beds[*bed];
                    let fraction = fraction
                        .as_ref()
                        .map(|f| f.at(x, y))
                        .transpose()?
                        .unwrap_or_else(|| bed_law.fraction(x));
                    if !(0.0..=1.0).contains(&fraction) {
                        return Err("3D deposited sand fraction outside0..1".into());
                    }
                    incoming = profile.deposit(
                        *bed as i32,
                        t,
                        fraction,
                        bed_law.carbonate,
                        pressure,
                        self.model.spec.material_step,
                    )?;
                    if *compact {
                        self.stats.compaction_layers += profile.layers.len();
                        self.stats.porosity_evaluations += profile
                            .compact_with_work(&self.model.spec.beds, pressure)?
                            .1;
                    } else {
                        profile.record_loading(pressure);
                    }
                }
                HistoryEvent::Erosion { surface } => {
                    removed = profile.erode(surface.at(x, y)?)?;
                    profile.record_loading(pressure);
                }
                HistoryEvent::Pressure { compact, .. } => {
                    if *compact {
                        self.stats.compaction_layers += profile.layers.len();
                        self.stats.porosity_evaluations += profile
                            .compact_with_work(&self.model.spec.beds, pressure)?
                            .1;
                    } else {
                        profile.record_loading(pressure);
                    }
                }
                HistoryEvent::Compact {} => {
                    self.stats.compaction_layers += profile.layers.len();
                    self.stats.porosity_evaluations += profile
                        .compact_with_work(&self.model.spec.beds, pressure)?
                        .1;
                }
                HistoryEvent::Fault { .. } | HistoryEvent::SweptFault { .. } => unreachable!(),
            }
            let after = profile.grains();
            let input = grains(&incoming);
            let output = grains(&removed);
            let mut worst = 0.0f64;
            for bed in before
                .keys()
                .chain(after.keys())
                .chain(input.keys())
                .chain(output.keys())
            {
                let b = before.get(bed).copied().unwrap_or_default();
                let a = after.get(bed).copied().unwrap_or_default();
                let inc = input.get(bed).copied().unwrap_or_default();
                let out = output.get(bed).copied().unwrap_or_default();
                for j in 0..3 {
                    let residual = b[j] + inc[j] - a[j] - out[j];
                    let scale = b[j].abs() + inc[j].abs() + a[j].abs() + out[j].abs();
                    worst = worst.max(residual.abs() / (1e-9 + 1e-11 * scale));
                }
            }
            if worst > 1.0 {
                return Err(format!(
                    "3D local grain closure failed at event {i}: {worst}"
                ));
            }
            self.stats.local_events_checked += 1;
            self.stats.max_normalized_grain_residual =
                self.stats.max_normalized_grain_residual.max(worst);
            if profile.layers.len() > 8192 {
                return Err("3D material layer budget exceeded".into());
            }
        }
        if self.cached_layers + profile.layers.len() > 100_000 {
            self.cache.clear();
            self.cached_layers = 0;
        }
        self.cached_layers += profile.layers.len();
        self.stats.peak_cached_layers = self.stats.peak_cached_layers.max(self.cached_layers);
        let profile = Arc::new(profile);
        self.cache.insert(key, Arc::clone(&profile));
        Ok(profile)
    }
}
