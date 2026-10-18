//! Exact vertical ownership at one world-space ray. The history evaluator couples
//! rays through 3D inverse fault maps; this is not a stack of independent 2D runs.
use crate::{
    exact::Scale,
    material::{self, BASEMENT, Bed, Column, Layer, WATER},
};
use num_bigint::{BigInt, Sign};
use num_traits::Zero;
use serde::Serialize;
use std::collections::BTreeMap;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    /// Exact signed expansion of the first finite interface. The exterior is
    /// water above, basement below; neither tail is arbitrarily truncated.
    pub top_terms: Vec<f64>,
    pub layers: Column,
}
pub fn signed_sum(s: Scale, terms: &[f64]) -> Result<BigInt, String> {
    terms
        .iter()
        .try_fold(BigInt::zero(), |a, x| Ok(a + s.signed(*x)?))
}
fn signed_chunks(s: Scale, n: &BigInt) -> Result<Vec<f64>, String> {
    let sign = if n.sign() == Sign::Minus { -1.0 } else { 1.0 };
    Ok(s.chunks(n.magnitude())?
        .into_iter()
        .map(|x| sign * x)
        .collect())
}
fn signed_number(s: Scale, n: &BigInt) -> Result<f64, String> {
    Ok(s.number(n.magnitude())? * if n.sign() == Sign::Minus { -1.0 } else { 1.0 })
}
impl Profile {
    pub fn new(top: f64, layers: Column) -> Result<Self, String> {
        if !top.is_finite() {
            return Err("Nonfinite 3D profile top".into());
        }
        let mut p = Self {
            top_terms: vec![top],
            layers,
        };
        p.normalize()?;
        Ok(p)
    }
    pub fn scale(&self, extra: &[f64]) -> Result<Scale, String> {
        material::scale(
            &[&self.layers],
            &self
                .top_terms
                .iter()
                .chain(extra)
                .map(|v| v.abs())
                .collect::<Vec<_>>(),
        )
    }
    pub fn top(&self) -> Result<f64, String> {
        let s = self.scale(&[])?;
        signed_number(s, &signed_sum(s, &self.top_terms)?)
    }
    pub fn basement(&self) -> Result<f64, String> {
        let s = self.scale(&[])?;
        signed_number(
            s,
            &(signed_sum(s, &self.top_terms)? + BigInt::from(material::total(&self.layers, s)?)),
        )
    }
    pub fn translated(&mut self, dz: f64) -> Result<(), String> {
        if !dz.is_finite() {
            return Err("Nonfinite 3D subsidence".into());
        }
        self.top_terms.push(dz);
        let s = self.scale(&[])?;
        self.top_terms = signed_chunks(s, &signed_sum(s, &self.top_terms)?)?;
        if !self.top()?.is_finite() {
            return Err("3D vertical translation overflow".into());
        }
        Ok(())
    }
    fn normalize(&mut self) -> Result<(), String> {
        let first = self.layers.iter().take_while(|p| p.bed == WATER).count();
        if first > 0 {
            self.top_terms.extend(
                self.layers[..first]
                    .iter()
                    .flat_map(|p| p.lengths().iter().copied()),
            );
            self.layers.drain(..first);
        }
        while self.layers.last().is_some_and(|p| p.bed == BASEMENT) {
            self.layers.pop();
        }
        let s = self.scale(&[])?;
        self.top_terms = signed_chunks(s, &signed_sum(s, &self.top_terms)?)?;
        Ok(())
    }
    pub fn canonicalize_fault(&mut self) -> Result<(), String> {
        let mut next = Column::with_capacity(self.layers.len());
        for p in std::mem::take(&mut self.layers) {
            material::append(&mut next, p)?;
        }
        self.layers = next;
        self.normalize()
    }
    /// Exact cut, including explicit pieces of the two regional exterior tails.
    pub fn cut(&self, lower: f64, upper: f64) -> Result<Column, String> {
        if !lower.is_finite() || !upper.is_finite() || upper < lower {
            return Err("Invalid 3D ray cut".into());
        }
        let s = self.scale(&[lower, upper])?;
        let lo = s.signed(lower)?;
        let hi = s.signed(upper)?;
        self.cut_units(&lo, &hi, s)
    }
    fn cut_units(&self, lo: &BigInt, hi: &BigInt, s: Scale) -> Result<Column, String> {
        let top = signed_sum(s, &self.top_terms)?;
        let bottom = &top + BigInt::from(material::total(&self.layers, s)?);
        let mut out = Column::new();
        if lo < &top {
            let end = hi.min(&top);
            if end > lo {
                material::append(
                    &mut out,
                    Layer::empty(WATER, 0.0)
                        .with_lengths(s.chunks(&(end - lo).to_biguint().unwrap())?)?,
                )?;
            }
        }
        for p in material::cut(&self.layers, &(lo - &top), &(hi - &top), s)? {
            material::append(&mut out, p)?;
        }
        if hi > &bottom {
            let start = lo.max(&bottom);
            if hi > start {
                material::append(
                    &mut out,
                    Layer::empty(BASEMENT, 0.0)
                        .with_lengths(s.chunks(&(hi - start).to_biguint().unwrap())?)?,
                )?;
            }
        }
        Ok(out)
    }
    pub fn at(&self, z: f64) -> Result<Option<&Layer>, String> {
        let s = self.scale(&[z])?;
        let z = s.signed(z)?;
        let mut edge = signed_sum(s, &self.top_terms)?;
        if z < edge {
            return Ok(None);
        }
        for p in &self.layers {
            edge += BigInt::from(p.units(s)?);
            if z < edge {
                return Ok(Some(p));
            }
        }
        Ok(None)
    }
    pub fn sample(&self, z: f64) -> Result<Layer, String> {
        if let Some(p) = self.at(z)? {
            return Ok(p.clone());
        }
        Ok(Layer::empty(
            if z < self.top()? { WATER } else { BASEMENT },
            0.0,
        ))
    }
    pub fn intervals(&self) -> Result<Vec<(f64, f64, &Layer)>, String> {
        let s = self.scale(&[])?;
        let mut edge = signed_sum(s, &self.top_terms)?;
        let mut out = Vec::with_capacity(self.layers.len());
        for p in &self.layers {
            let lo = signed_number(s, &edge)?;
            edge += BigInt::from(p.units(s)?);
            out.push((lo, signed_number(s, &edge)?, p));
        }
        Ok(out)
    }
    pub fn grains(&self) -> BTreeMap<i32, [f64; 3]> {
        grains(&self.layers)
    }
    /// Join two independently evaluated source rays at an exact world interface.
    pub fn splice(above: &Self, below: &Self, cut: f64) -> Result<Self, String> {
        let extra = above
            .top_terms
            .iter()
            .chain(&below.top_terms)
            .chain(std::iter::once(&cut))
            .map(|v| v.abs())
            .collect::<Vec<_>>();
        let s = material::scale(&[&above.layers, &below.layers], &extra)?;
        let a = signed_sum(s, &above.top_terms)?;
        let b = signed_sum(s, &below.top_terms)?;
        let za = &a + BigInt::from(material::total(&above.layers, s)?);
        let zb = &b + BigInt::from(material::total(&below.layers, s)?);
        let cut = s.signed(cut)?;
        let lo = a.min(b).min(cut.clone());
        let hi = za.max(zb).max(cut.clone());
        let mut layers = above.cut_units(&lo, &cut, s)?;
        for p in below.cut_units(&cut, &hi, s)? {
            material::append(&mut layers, p)?;
        }
        let mut out = Self {
            top_terms: signed_chunks(s, &lo)?,
            layers,
        };
        out.normalize()?;
        Ok(out)
    }
    pub fn erode(&mut self, z: f64) -> Result<Column, String> {
        let s = self.scale(&[z])?;
        let top = signed_sum(s, &self.top_terms)?;
        let z = s.signed(z)?;
        if z <= top {
            return Ok(vec![]);
        }
        let bottom = &top + BigInt::from(material::total(&self.layers, s)?);
        let removed = self.cut_units(&top, &z, s)?;
        self.layers = if z < bottom {
            self.cut_units(&z, &bottom, s)?
        } else {
            vec![]
        };
        self.top_terms = signed_chunks(s, &z)?;
        self.normalize()?;
        Ok(removed)
    }
    pub fn deposit(
        &mut self,
        bed: i32,
        thickness: f64,
        fraction: f64,
        carbonate: bool,
        pressure: Option<f64>,
        dz: f64,
    ) -> Result<Column, String> {
        if thickness <= 0.0 {
            return Ok(vec![]);
        }
        if (thickness / dz).ceil() as usize > 4096 {
            return Err("3D deposition exceeds vertical material budget".into());
        }
        let input =
            material::deposit_with_step(bed, &[thickness], fraction, carbonate, 0.0, pressure, dz)?;
        let mut layers = input.clone();
        layers.append(&mut self.layers);
        self.layers = layers;
        self.top_terms.push(-thickness);
        self.normalize()?;
        Ok(input)
    }
    pub fn record_loading(&mut self, pressure: Option<f64>) {
        let mut depth = 0.0;
        for p in &mut self.layers {
            p.record_loading(depth + p.height / 2.0, pressure);
            depth += p.height;
        }
    }
    pub fn compact(&mut self, beds: &[Bed], pressure: Option<f64>) -> Result<f64, String> {
        self.compact_with_work(beds, pressure).map(|v| v.0)
    }
    pub fn compact_with_work(
        &mut self,
        beds: &[Bed],
        pressure: Option<f64>,
    ) -> Result<(f64, usize), String> {
        // Water inside the finite profile is explicit incompressible fluid. It is
        // neither discarded nor packed away to repair geometry.
        let mut depth = 0.0;
        let mut evaluations = 0;
        let mut next = Vec::with_capacity(self.layers.len());
        for p in &self.layers {
            let q = if p.bed >= 0 {
                let carbonate = beds.get(p.bed as usize).ok_or("Invalid 3D bed")?.carbonate;
                let (q, work) = material::compact_layer(p, depth, carbonate, pressure);
                evaluations += work;
                q
            } else {
                p.clone()
            };
            depth += q.height;
            next.push(q);
        }
        let s = material::scale(&[&self.layers, &next], &[])?;
        let before = material::total(&self.layers, s)?;
        let after = material::total(&next, s)?;
        if after > before {
            return Err("3D compaction expanded material".into());
        }
        let shrink = s.chunks(&(before - after))?;
        let amount = shrink.iter().sum();
        self.top_terms.extend(shrink);
        self.layers = next;
        self.normalize()?;
        Ok((amount, evaluations))
    }
}
pub fn grains(column: &Column) -> BTreeMap<i32, [f64; 3]> {
    let mut sums = BTreeMap::<i32, [f64; 3]>::new();
    for p in column.iter().filter(|p| p.bed >= 0) {
        let a = sums.entry(p.bed).or_default();
        a[0] += p.solid;
        a[1] += p.solid * p.fraction;
        a[2] += p.solid * (1.0 - p.fraction);
    }
    sums
}
