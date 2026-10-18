use crate::{exact::Scale, physics};
use num_bigint::{BigInt, BigUint};
use num_traits::Zero;
use serde::{Deserialize, Serialize};
pub const WATER: i32 = -1;
pub const BASEMENT: i32 = -2;
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Layer {
    pub bed: i32,
    pub height: f64,
    pub solid: f64,
    pub fraction: f64,
    pub burial: f64,
    pub loading: f64,
    #[serde(default)]
    pub offset_x: f64,
    #[serde(default)]
    pub offset_y: f64,
    #[serde(default)]
    pub offset_z: f64,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub lengths: Vec<f64>,
}
pub type Column = Vec<Layer>;
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Bed {
    pub unit: usize,
    pub phase: String,
    pub a: f64,
    pub b: f64,
    pub c: f64,
    pub d: f64,
    pub carbonate: bool,
}
impl Bed {
    pub fn fraction(&self, x: f64) -> f64 {
        (self.a + self.b * crate::math::tanh((x - self.c) / self.d)).clamp(0.0, 1.0)
    }
}
impl Layer {
    /// Retain irreversible material memory at a supplied midpoint depth. The
    /// geometry adapter defines depth relative to its own sediment surface.
    pub fn record_loading(&mut self, depth: f64, pressure: Option<f64>) {
        if self.bed >= 0 {
            self.burial = self.burial.max(depth);
            self.loading = self.loading.max(physics::effective_depth(depth, pressure));
        }
    }

    pub fn empty(bed: i32, height: f64) -> Self {
        Self {
            bed,
            height,
            solid: 0.0,
            fraction: 0.0,
            burial: 0.0,
            loading: 0.0,
            offset_x: 0.0,
            offset_y: 0.0,
            offset_z: 0.0,
            lengths: vec![],
        }
    }
    pub fn lengths(&self) -> &[f64] {
        if self.lengths.is_empty() {
            std::slice::from_ref(&self.height)
        } else {
            &self.lengths
        }
    }
    pub fn units(&self, scale: Scale) -> Result<BigUint, String> {
        scale.sum(self.lengths().iter().copied())
    }
    pub fn with_lengths(&self, lengths: Vec<f64>) -> Result<Self, String> {
        self.with_lengths_and_solid(lengths, self.solid)
    }
    fn with_lengths_and_solid(&self, lengths: Vec<f64>, solid: f64) -> Result<Self, String> {
        let scale = Scale::new(lengths.iter().copied())?;
        let units = scale.sum(lengths)?;
        let height = scale.number(&units)?;
        // A single exactly representable extent needs no owned chunk buffer.
        // In particular do not clone the old buffer or retain an empty allocation.
        let lengths = if units.bits().saturating_sub(53) <= units.trailing_zeros().unwrap_or(0) {
            Vec::new()
        } else {
            scale.chunks(&units)?
        };
        if height == 0.0 && solid != 0.0 {
            return Err("Invalid grouped material extent".into());
        }
        Ok(Self {
            bed: self.bed,
            height,
            solid,
            fraction: self.fraction,
            burial: self.burial,
            loading: self.loading,
            offset_x: self.offset_x,
            offset_y: self.offset_y,
            offset_z: self.offset_z,
            lengths,
        })
    }
    pub fn portion(&self, lengths: Vec<f64>) -> Result<Self, String> {
        let mut out = self.with_lengths_and_solid(lengths, 0.0)?;
        out.solid = if out.height > 0.0 {
            self.solid * (out.height / self.height)
        } else {
            0.0
        };
        Ok(out)
    }
}
pub fn scale(columns: &[&Column], extra: &[f64]) -> Result<Scale, String> {
    Scale::new(
        columns
            .iter()
            .flat_map(|c| c.iter().flat_map(|p| p.lengths().iter().copied()))
            .chain(extra.iter().map(|x| x.abs())),
    )
}
pub fn total(column: &Column, s: Scale) -> Result<BigUint, String> {
    let mut n = BigUint::zero();
    for p in column {
        n += p.units(s)?;
    }
    Ok(n)
}
pub fn height(column: &Column) -> Result<f64, String> {
    let s = scale(&[column], &[])?;
    s.number(&total(column, s)?)
}
pub fn surface(column: &Column) -> f64 {
    column
        .iter()
        .take_while(|p| p.bed == WATER)
        .map(|p| p.height)
        .sum()
}
fn same(a: &Layer, b: &Layer) -> bool {
    a.bed == b.bed
        && a.fraction == b.fraction
        && a.burial == b.burial
        && a.loading == b.loading
        && a.offset_x == b.offset_x
        && a.offset_y == b.offset_y
        && a.offset_z == b.offset_z
        && (a.solid / a.height - b.solid / b.height).abs() < 1e-13
}
pub fn append(out: &mut Column, p: Layer) -> Result<(), String> {
    if p.height <= 0.0 {
        return Ok(());
    }
    let mut start = out.len();
    while start > 0 && same(&out[start - 1], &p) {
        start -= 1;
    }
    if start == out.len() {
        out.push(p);
        return Ok(());
    }
    let mut sum: f64 = 0.0;
    let mut correction = 0.0;
    let mut lengths = Vec::new();
    for q in out[start..].iter().chain(std::iter::once(&p)) {
        let next = sum + q.solid;
        correction += if sum.abs() >= q.solid.abs() {
            (sum - next) + q.solid
        } else {
            (q.solid - next) + sum
        };
        sum = next;
        lengths.extend_from_slice(q.lengths());
    }
    let mut q = p.clone();
    q.solid = sum + correction;
    if !q.solid.is_finite() || q.solid < 0.0 {
        return Err("Invalid material aggregate".into());
    }
    let q = q.with_lengths(lengths)?;
    out.truncate(start);
    out.push(q);
    Ok(())
}
pub fn cut(column: &Column, lower: &BigInt, upper: &BigInt, s: Scale) -> Result<Column, String> {
    let mut out = Vec::new();
    let mut start = BigInt::zero();
    let zero = BigInt::zero();
    for p in column {
        let length = BigInt::from(p.units(s)?);
        let end = &start + &length;
        let a = std::cmp::max(std::cmp::max(&start, lower), &zero);
        let b = std::cmp::min(&end, upper);
        if b > a {
            let take = (b - a).to_biguint().unwrap();
            let piece = if BigInt::from(take.clone()) == length {
                p.clone()
            } else {
                p.portion(s.chunks(&take)?)?
            };
            append(&mut out, piece)?;
        }
        start = end;
        if &start >= upper {
            break;
        }
    }
    Ok(out)
}
pub fn slice(column: &Column, lower: &[f64], upper: &[f64]) -> Result<Column, String> {
    let extra: Vec<_> = lower.iter().chain(upper).copied().collect();
    let s = scale(&[column], &extra)?;
    let mut lo = BigInt::zero();
    let mut hi = BigInt::zero();
    for x in lower {
        lo += s.signed(*x)?;
    }
    for x in upper {
        hi += s.signed(*x)?;
    }
    cut(column, &lo, &hi, s)
}
#[derive(Clone, Debug)]
pub struct DepthMap {
    pub old: Vec<f64>,
    pub new: Vec<f64>,
    pub old_heights: Vec<f64>,
    pub new_heights: Vec<f64>,
    pub old_floor: f64,
    pub top: f64,
}

/// Shared material solve for both 2D columns and continuous 3D profiles. Geometry
/// adapters retain their own water/basement boundaries and displacement maps.
/// The work count is diagnostic and does not affect the physical solution.
pub fn compact_layer(
    p: &Layer,
    depth: f64,
    carbonate: bool,
    pressure: Option<f64>,
) -> (Layer, usize) {
    let mut q = p.clone();
    let mut evaluations = 0;
    let mut volume = |t: f64| {
        evaluations += 1;
        p.solid
            / (1.0
                - physics::porosity(
                    p.fraction,
                    p.loading
                        .max(physics::effective_depth(depth + t / 2.0, pressure)),
                    carbonate,
                ))
    };
    let mut lo = p.solid;
    let mut hi = p.height;
    if volume(hi) < hi {
        // Contract a guarded monotone bracket, then replay all 36 ORIGINAL
        // rounded bisection midpoints. Only comparisons strictly outside the
        // bracket are inferred; ambiguous points still evaluate the same law.
        let (mut bound_lo, mut bound_hi) = (lo, hi);
        if (1e-7..=256.0).contains(&p.height) && p.solid > 0.0 {
            let guard = 1e-12 + 128.0 * f64::EPSILON * p.height;
            for _ in 0..4 {
                let lower = (volume(bound_hi) - guard).max(lo);
                let upper = (volume(lower) + guard).min(hi);
                if !lower.is_finite() || !upper.is_finite() || lower > upper {
                    bound_lo = lo;
                    bound_hi = hi;
                    break;
                }
                bound_lo = bound_lo.max(lower);
                bound_hi = bound_hi.min(upper);
                if bound_hi - bound_lo <= 4.0 * guard {
                    break;
                }
            }
            if bound_lo > bound_hi || bound_lo > volume(bound_lo) || bound_hi < volume(bound_hi) {
                bound_lo = lo;
                bound_hi = hi;
            }
        }
        for _ in 0..36 {
            let m = (lo + hi) / 2.0;
            if m < bound_lo || (m <= bound_hi && m < volume(m)) {
                lo = m
            } else {
                hi = m
            }
        }
        q.height = (lo + hi) / 2.0;
    }
    q.record_loading(depth + q.height / 2.0, pressure);
    if q.height != p.height {
        q.lengths.clear();
    }
    (q, evaluations)
}

impl DepthMap {
    pub fn at(&self, z: f64) -> f64 {
        if z < self.old_floor {
            return z + self.top - self.old_floor;
        }
        if self.old.len() < 2 {
            return z;
        }
        let mut lo = 0;
        let mut hi = self.old.len() - 1;
        while lo + 1 < hi {
            let mid = (lo + hi) / 2;
            if self.old[mid] <= z {
                lo = mid
            } else {
                hi = mid
            }
        }
        let j = lo.min(self.old.len() - 2);
        self.top + self.new[j] + (z - self.old[j]) * self.new_heights[j] / self.old_heights[j]
    }
}
pub fn compact(
    column: &Column,
    beds: &[Bed],
    pressure: Option<f64>,
) -> Result<(Column, DepthMap), String> {
    let floor = surface(column);
    let mut next = Vec::with_capacity(column.len());
    let mut old_edges = vec![floor];
    let mut new_edges = vec![0.0];
    let mut depth = 0.0;
    for p in column.iter().filter(|p| p.bed != WATER) {
        let q = if p.bed >= 0 {
            let carbonate = beds
                .get(p.bed as usize)
                .ok_or("Invalid bed index")?
                .carbonate;
            compact_layer(p, depth, carbonate, pressure).0
        } else {
            p.clone()
        };
        depth += q.height;
        old_edges.push(old_edges.last().unwrap() + p.height);
        new_edges.push(depth);
        next.push(q);
    }
    let s = scale(&[column, &next], &[])?;
    let old_total = total(column, s)?;
    let new_total = total(&next, s)?;
    if new_total > old_total {
        return Err("Compacted material exceeds column extent".into());
    }
    let units = old_total - new_total;
    let top = s.number(&units)?;
    let old_heights = column
        .iter()
        .filter(|p| p.bed != WATER)
        .map(|p| p.height)
        .collect();
    let new_heights = next.iter().map(|p| p.height).collect();
    let mut out = Vec::with_capacity(next.len() + 1);
    if !units.is_zero() {
        append(
            &mut out,
            Layer::empty(WATER, 0.0).with_lengths(s.chunks(&units)?)?,
        )?;
    }
    for p in next {
        append(&mut out, p)?;
    }
    Ok((
        out,
        DepthMap {
            old: old_edges,
            new: new_edges,
            old_heights,
            new_heights,
            old_floor: floor,
            top,
        },
    ))
}
pub fn deposit(
    bed: i32,
    terms: &[f64],
    fraction: f64,
    carbonate: bool,
    top_depth: f64,
    pressure: Option<f64>,
) -> Result<Column, String> {
    deposit_with_step(bed, terms, fraction, carbonate, top_depth, pressure, 10.0)
}

/// Shared exact subdivision and depositional state initialization. Material
/// resolution is independent of whether the caller represents 2D or 3D space.
pub fn deposit_with_step(
    bed: i32,
    terms: &[f64],
    fraction: f64,
    carbonate: bool,
    top_depth: f64,
    pressure: Option<f64>,
    material_step: f64,
) -> Result<Column, String> {
    if !material_step.is_finite() || material_step <= 0.0 {
        return Err("Invalid deposition material step".into());
    }
    let s = Scale::new(terms.iter().map(|x| x.abs()))?;
    let units = s.sum(terms.iter().copied())?;
    let thickness = s.number(&units)?;
    let n = (thickness / material_step).ceil() as usize;
    let mut out = Vec::with_capacity(n);
    for j in 0..n {
        let d = top_depth + (j as f64 + 0.5) * (thickness / n as f64);
        let loading = physics::effective_depth(d, pressure);
        let density = 1.0 - physics::porosity(fraction, loading, carbonate);
        let lo = &units * BigUint::from(j) / BigUint::from(n);
        let hi = &units * BigUint::from(j + 1) / BigUint::from(n);
        let mut p = Layer::empty(bed, 0.0).with_lengths(s.chunks(&(hi - lo))?)?;
        p.fraction = fraction;
        p.burial = d;
        p.loading = loading;
        p.solid = p.height * density;
        out.push(p);
    }
    Ok(out)
}
pub struct Packed {
    pub column: Column,
    pub gaps: f64,
    pub water: Vec<(f64, f64)>,
}
impl Packed {
    pub fn map(&self, d: f64) -> f64 {
        d + self
            .water
            .iter()
            .map(|(lo, hi)| (hi - lo.max(d)).max(0.0))
            .sum::<f64>()
    }
}
pub fn pack(column: &Column, numerical: &[(f64, f64)]) -> Result<Packed, String> {
    let s = scale(&[column], &[])?;
    let lengths: Vec<_> = column
        .iter()
        .map(|p| p.units(s))
        .collect::<Result<_, _>>()?;
    let first = column.iter().position(|p| p.bed != WATER);
    let mut z = total(column, s)?;
    let mut gaps = BigUint::zero();
    let mut surface_units = BigUint::zero();
    let mut reversed = Vec::new();
    let mut water = Vec::new();
    let mut displaced = 0.0;
    for j in (0..column.len()).rev() {
        let p = &column[j];
        let lo = &z - &lengths[j];
        if p.bed == WATER {
            if first.is_some_and(|f| j > f) {
                gaps += &lengths[j];
                let a = s.number(&lo)?;
                let b = s.number(&z)?;
                water.push((a, b));
                displaced += numerical
                    .iter()
                    .map(|(l, h)| (b.min(*h) - a.max(*l)).max(0.0))
                    .sum::<f64>();
            } else {
                surface_units += &lengths[j];
            }
        } else {
            let mut q = p.clone();
            q.offset_z -= displaced;
            reversed.push(q);
        }
        z = lo;
    }
    let mut out = Vec::new();
    let all = &surface_units + &gaps;
    if !all.is_zero() {
        append(
            &mut out,
            Layer::empty(WATER, 0.0).with_lengths(s.chunks(&all)?)?,
        )?;
    }
    for p in reversed.into_iter().rev() {
        append(&mut out, p)?;
    }
    Ok(Packed {
        column: out,
        gaps: s.number(&gaps)?,
        water,
    })
}

/// Independent column solves parallelize natively without changing reduction
/// order. Browser builds use the existing pool of independent Wasm workers.
pub fn compact_many(
    columns: &[Column],
    beds: &[Bed],
    pressure: Option<f64>,
) -> Result<Vec<(Column, DepthMap)>, String> {
    #[cfg(not(target_arch = "wasm32"))]
    {
        use rayon::prelude::*;
        columns
            .par_iter()
            .map(|c| compact(c, beds, pressure))
            .collect()
    }
    #[cfg(target_arch = "wasm32")]
    {
        columns.iter().map(|c| compact(c, beds, pressure)).collect()
    }
}
