use crate::material::{self, Bed, Column, Layer};
use crate::physics::{self, RockHistory};
use num_bigint::BigUint;
use num_traits::Zero;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Raster {
    pub grid: Vec<i32>,
    pub solid: Vec<f64>,
    pub sand_fraction: Vec<f64>,
    pub burial: Vec<f32>,
    pub effective_burial: Vec<f32>,
    pub offset_x: Vec<f64>,
    pub offset_z: Vec<f64>,
    pub subcells: BTreeMap<usize, Column>,
}
impl Raster {
    pub fn cell(&self, n: usize, h: f64) -> Column {
        self.subcells.get(&n).cloned().unwrap_or_else(|| {
            vec![Layer {
                bed: self.grid[n],
                height: h,
                solid: self.solid[n],
                fraction: self.sand_fraction[n],
                burial: self.burial[n] as f64,
                loading: self.effective_burial[n] as f64,
                offset_x: self.offset_x[n],
                offset_y: 0.0,
                offset_z: self.offset_z[n],
                lengths: vec![],
            }]
        })
    }
    pub fn columns(&self, nx: usize, nz: usize, h: f64) -> Result<Vec<Column>, String> {
        (0..nx)
            .map(|i| {
                let mut c = vec![];
                for k in 0..nz {
                    for p in self.cell(k * nx + i, h) {
                        material::append(&mut c, p)?
                    }
                }
                Ok(c)
            })
            .collect()
    }
}
pub fn rasterize(columns: &[Column], nz: usize, h: f64) -> Result<Raster, String> {
    let nx = columns.len();
    let length = nx * nz;
    let mut r = Raster {
        grid: vec![0; length],
        solid: vec![0.0; length],
        sand_fraction: vec![0.0; length],
        burial: vec![0.0; length],
        effective_burial: vec![0.0; length],
        offset_x: vec![0.0; length],
        offset_z: vec![0.0; length],
        subcells: BTreeMap::new(),
    };
    for (i, input) in columns.iter().enumerate() {
        let mut column = std::borrow::Cow::Borrowed(input);
        let s = material::scale(&[&column], &[h, 1e-6])?;
        let cell = s.units(h)?;
        let domain = &cell * BigUint::from(nz);
        let total = material::total(&column, s)?;
        if total < domain {
            let difference = &domain - total;
            if difference > s.units(1e-6)? {
                return Err(format!(
                    "Column {i} domain shortage exceeds inert roundoff gate"
                ));
            }
            let last = column.last().ok_or("Empty column")?;
            if ![-1, -2].contains(&last.bed) || last.solid != 0.0 {
                return Err("Domain shortage cannot adjust sediment".into());
            }
            let part = last.with_lengths(s.chunks(&difference)?)?;
            material::append(column.to_mut(), part)?;
        }
        let lengths: Vec<_> = column
            .iter()
            .map(|p| p.units(s))
            .collect::<Result<_, _>>()?;
        let mut j = 0;
        let mut consumed = BigUint::zero();
        for k in 0..nz {
            let n = k * nx + i;
            let mut parts = vec![];
            let mut available = cell.clone();
            while !available.is_zero() {
                while j < column.len() && consumed == lengths[j] {
                    j += 1;
                    consumed = BigUint::zero()
                }
                if j >= column.len() {
                    return Err(format!("Column {i} does not fill exact domain"));
                }
                let remaining = &lengths[j] - &consumed;
                let take = remaining.min(available.clone());
                if take.is_zero() {
                    return Err("Nonpositive raster slice".into());
                }
                let p = if take == lengths[j] {
                    column[j].clone()
                } else {
                    column[j].portion(s.chunks(&take)?)?
                };
                material::append(&mut parts, p)?;
                consumed += &take;
                available -= take;
            }
            let mut labels: BTreeMap<i32, f64> = BTreeMap::new();
            let mut f = 0.0;
            let mut b = 0.0;
            let mut e = 0.0;
            let mut volume = 0.0;
            for p in &parts {
                *labels.entry(p.bed).or_default() += p.height;
                r.solid[n] += p.solid;
                f += p.solid * p.fraction;
                b += p.solid * p.burial;
                e += p.solid * p.loading;
                if p.bed != -1 {
                    volume += p.height;
                    r.offset_x[n] += p.height * p.offset_x;
                    r.offset_z[n] += p.height * p.offset_z;
                }
            }
            let has_sediment = labels.keys().any(|id| *id >= 0);
            let mut chosen = None;
            for (&id, &height) in &labels {
                if has_sediment && id < 0 {
                    continue;
                }
                if chosen.is_none_or(|(_, best)| height > best) {
                    chosen = Some((id, height))
                }
            }
            r.grid[n] = chosen.ok_or("Empty raster cell")?.0;
            if r.solid[n] != 0.0 {
                r.sand_fraction[n] = f / r.solid[n];
                r.burial[n] = (b / r.solid[n]) as f32;
                r.effective_burial[n] = (e / r.solid[n]) as f32;
            }
            if volume != 0.0 {
                r.offset_x[n] /= volume;
                r.offset_z[n] /= volume;
            }
            if parts.len() > 1 || parts.iter().any(|p| p.bed >= 0) {
                r.subcells.insert(n, parts);
            }
        }
        let mut outside = vec![];
        if j < column.len() {
            if consumed < lengths[j] {
                material::append(
                    &mut outside,
                    column[j].portion(s.chunks(&(&lengths[j] - consumed))?)?,
                )?;
            }
            for p in &column[j + 1..] {
                material::append(&mut outside, p.clone())?;
            }
        }
        if outside.iter().any(|p| p.bed >= 0) {
            return Err(format!(
                "Full-domain projection would discard sediment from column {i}"
            ));
        }
        if !(outside.is_empty()
            || material::total(&outside, s)? <= s.units(1e-6)?
                && outside
                    .iter()
                    .all(|p| [-1, -2].contains(&p.bed) && p.solid == 0.0))
        {
            return Err(format!("Column {i} extends beyond full domain"));
        }
    }
    Ok(r)
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Window {
    pub velocity: Vec<f32>,
    pub beds: Vec<i32>,
    pub sand_fraction: Vec<f32>,
    pub nx: usize,
    pub nz: usize,
    pub floor: Vec<f64>,
}
pub fn layer_velocity(
    beds: &[Bed],
    pressure: Option<f64>,
    basement: f64,
    p: &Layer,
    top: f64,
    floor: f64,
) -> f64 {
    if p.bed == -1 {
        1500.0
    } else if p.bed == -2 {
        (basement + 0.1 * (top + p.height / 2.0 - floor).max(0.0)).min(5600.0)
    } else {
        physics::velocity(
            p.fraction,
            (top + p.height / 2.0 - floor).max(0.0),
            beds[p.bed as usize].carbonate,
            pressure,
            Some(RockHistory {
                max_burial: p.burial,
                max_effective_depth: p.loading,
                bulk_porosity: Some((1.0 - p.solid / p.height).clamp(0.0, 1.0)),
            }),
        )
    }
}
pub fn window(
    columns: &[Column],
    h: f64,
    beds: &[Bed],
    pressure: Option<f64>,
    basement: f64,
    hw: f64,
) -> Result<Window, String> {
    let nx = (9200.0 / hw).round() as usize + 1;
    let nz = (3000.0 / hw).round() as usize + 1;
    let mut w = Window {
        velocity: vec![0.0; nx * nz],
        beds: vec![0; nx * nz],
        sand_fraction: vec![0.0; nx * nz],
        nx,
        nz,
        floor: vec![0.0; nx],
    };
    for i in 0..nx {
        let c = &columns[(((i as f64 * hw + 2000.0) / h).round() as usize).min(columns.len() - 1)];
        w.floor[i] = material::surface(c);
        let mut j = 0;
        let mut start = 0.0;
        for k in 0..nz {
            let lo = k as f64 * hw;
            let hi = lo + hw;
            let mut labels: BTreeMap<i32, f64> = BTreeMap::new();
            let mut time = 0.0;
            let mut grains = 0.0;
            let mut sand = 0.0;
            let mut used = 0.0;
            let mut jj = j;
            let mut z = start;
            while jj < c.len() && z < hi {
                let p = &c[jj];
                let end = z + p.height;
                let overlap = (end.min(hi) - z.max(lo)).max(0.0);
                if overlap > 0.0 {
                    let v = if p.bed == -2 {
                        (basement + 0.1 * ((z.max(lo) + end.min(hi)) / 2.0 - w.floor[i]).max(0.0))
                            .min(5600.0)
                    } else {
                        layer_velocity(beds, pressure, basement, p, z, w.floor[i])
                    };
                    time += overlap / v;
                    used += overlap;
                    *labels.entry(p.bed).or_default() += overlap;
                    let s = p.solid * overlap / p.height;
                    grains += s;
                    sand += s * p.fraction;
                }
                if end > hi {
                    break;
                }
                z = end;
                jj += 1;
            }
            j = jj;
            start = z;
            let n = k * nx + i;
            if used <= 0.0 {
                return Err("Window outside material domain".into());
            }
            w.velocity[n] = (used / time) as f32;
            w.sand_fraction[n] = if grains != 0.0 {
                (sand / grains) as f32
            } else {
                0.0
            };
            let mut best = (-1, -1.0);
            for (id, height) in labels {
                if height > best.1 {
                    best = (id, height)
                }
            }
            w.beds[n] = best.0;
        }
    }
    Ok(w)
}
