//! Sparse local matching. Quantized costs/path sums use checked i64 and retry
//! in i128 on overflow; capacity/interval arithmetic uses arbitrary precision.
//! Ties use cell index.
use crate::{
    exact::Scale,
    material::{self, Column},
};
use num_bigint::BigUint;
use num_traits::{PrimInt, Signed, Zero};
use serde::{Deserialize, Serialize};
use std::{
    cmp::Reverse,
    collections::{BTreeMap, BinaryHeap},
};
pub fn round(x: f64) -> f64 {
    let lo = x.floor();
    if x - lo < 0.5 { lo } else { lo + 1.0 }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Parcel {
    pub source: usize,
    pub i: i32,
    pub k: i32,
    pub height: f64,
    pub weight: f64,
    pub target_i: f64,
    pub target_k: f64,
    #[serde(default)]
    pub material_heights: Vec<f64>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Assignment {
    pub destination: Vec<usize>,
    pub displaced: usize,
    pub max_offset_cells: f64,
    pub radius: i32,
}
fn stencil(radius: i32) -> Vec<(i32, i32)> {
    let mut a = vec![];
    for k in -radius..=radius {
        for i in -radius..=radius {
            if i * i + k * k <= radius * radius {
                a.push((i, k))
            }
        }
    }
    a.sort_by_key(|(i, k)| (i * i + k * k, *k, *i));
    a
}
fn validate(
    nx: usize,
    nz: usize,
    allowed: &[bool],
    parcels: &[Parcel],
    capacity: &[f64],
) -> Result<(), String> {
    if nx == 0
        || nz == 0
        || nx.checked_mul(nz) != Some(allowed.len())
        || capacity.len() != allowed.len()
        || capacity.iter().any(|x| !x.is_finite() || *x < 0.0)
    {
        return Err("Invalid transport grid".into());
    }
    for p in parcels {
        if !p.height.is_finite()
            || p.height <= 0.0
            || !p.weight.is_finite()
            || p.weight <= 0.0
            || p.i < 0
            || p.k < 0
            || p.i >= nx as i32
            || p.k >= nz as i32
            || !p.target_i.is_finite()
            || !p.target_k.is_finite()
            || (p.target_i - p.i as f64).abs() > 0.500000001
            || (p.target_k - p.k as f64).abs() > 0.500000001
        {
            return Err("Invalid rounded transport parcel".into());
        }
    }
    Ok(())
}
// A validated local edge costs less than 25e12. Convert through i64 to avoid
// WebAssembly float-to-i128 helpers; path sums use checked i64 or i128 arithmetic.
fn cost(p: &Parcel, i: i32, k: i32, weight: f64) -> i128 {
    round(weight * ((i as f64 - p.target_i).powi(2) + (k as f64 - p.target_k).powi(2)) / 1e-12)
        as i64 as i128
}
struct Search<C: PrimInt + Signed> {
    seen_p: Vec<usize>,
    seen_n: Vec<usize>,
    done_n: Vec<usize>,
    dist_p: Vec<C>,
    dist_n: Vec<C>,
    parent_n: Vec<usize>,
    parent_p: Vec<isize>,
    stamp: usize,
    touched_p: Vec<usize>,
    touched_n: Vec<usize>,
    heap: BinaryHeap<Reverse<(C, usize)>>,
}
impl<C: PrimInt + Signed> Search<C> {
    fn new(p: usize, n: usize) -> Self {
        Self {
            seen_p: vec![0; p],
            seen_n: vec![0; n],
            done_n: vec![0; n],
            dist_p: vec![C::zero(); p],
            dist_n: vec![C::zero(); n],
            parent_n: vec![0; n],
            parent_p: vec![-1; p],
            stamp: 0,
            touched_p: vec![],
            touched_n: vec![],
            heap: BinaryHeap::new(),
        }
    }
    fn start(&mut self, root: usize) {
        self.stamp += 1;
        self.touched_p.clear();
        self.touched_n.clear();
        self.heap.clear();
        self.touched_p.push(root);
        self.seen_p[root] = self.stamp;
        self.dist_p[root] = C::zero();
        self.parent_p[root] = -1;
    }
    // Explicit arrays keep the migration stencil and tie order auditable.
    #[allow(clippy::too_many_arguments)]
    fn relax(
        &mut self,
        p: usize,
        nx: usize,
        nz: usize,
        allowed: &[bool],
        parcels: &[Parcel],
        capacity: &[f64],
        weights: &[f64],
        u: &[C],
        v: &[C],
        offsets: &[(i32, i32)],
        indivisible: bool,
    ) -> Result<(), String> {
        let q = &parcels[p];
        for &(di, dk) in offsets {
            let i = q.i + di;
            let k = q.k + dk;
            if i < 0 || k < 0 || i >= nx as i32 || k >= nz as i32 {
                continue;
            }
            let n = k as usize * nx + i as usize;
            if !allowed[n]
                || self.done_n[n] == self.stamp
                || capacity[n] <= 0.0
                || (indivisible && q.height > capacity[n])
            {
                continue;
            }
            let edge = C::from(cost(q, i, k, weights[p])).ok_or("Transport cost overflow")?;
            let reduced = edge
                .checked_sub(&u[p])
                .and_then(|x| x.checked_sub(&v[n]))
                .ok_or("Transport cost overflow")?;
            if reduced < C::zero() {
                return Err("Invalid transport potential".into());
            }
            let d = self.dist_p[p]
                .checked_add(&reduced)
                .ok_or("Transport distance overflow")?;
            if self.seen_n[n] != self.stamp || d < self.dist_n[n] {
                if self.seen_n[n] != self.stamp {
                    self.seen_n[n] = self.stamp;
                    self.touched_n.push(n)
                }
                self.dist_n[n] = d;
                self.parent_n[n] = p;
                self.heap.push(Reverse((d, n)));
            }
        }
        Ok(())
    }
    fn potentials(&self, u: &mut [C], v: &mut [C], shortest: C) -> Result<(), String> {
        for &p in &self.touched_p {
            u[p] = u[p]
                .checked_add(&(shortest - self.dist_p[p]).max(C::zero()))
                .ok_or("Transport potential overflow")?
        }
        for &n in &self.touched_n {
            v[n] = v[n]
                .checked_sub(&(shortest - self.dist_n[n]).max(C::zero()))
                .ok_or("Transport potential overflow")?
        }
        Ok(())
    }
}
pub fn assign(
    nx: usize,
    nz: usize,
    allowed: &[bool],
    parcels: &[Parcel],
    capacity: &[f64],
) -> Result<Assignment, String> {
    validate(nx, nz, allowed, parcels, capacity)?;
    match solve_checked(nx, nz, allowed, parcels, capacity, 2) {
        Ok(a) => Ok(a),
        Err(e) if e.starts_with("Placement:") => {
            solve_checked(nx, nz, allowed, parcels, capacity, 3)
        }
        Err(e) => Err(e),
    }
}
// Native and Wasm both have efficient signed 64-bit integer operations. Every
// cost, distance and potential remains checked; an overflow restarts this local
// problem with the same algorithm and deterministic tie order in 128 bits.
fn solve_checked(
    nx: usize,
    nz: usize,
    allowed: &[bool],
    parcels: &[Parcel],
    capacity: &[f64],
    radius: i32,
) -> Result<Assignment, String> {
    match solve::<i64>(nx, nz, allowed, parcels, capacity, radius) {
        Err(error) if error.starts_with("Transport ") && error.ends_with(" overflow") => {
            solve::<i128>(nx, nz, allowed, parcels, capacity, radius)
        }
        result => result,
    }
}
fn solve<C: PrimInt + Signed>(
    nx: usize,
    nz: usize,
    allowed: &[bool],
    parcels: &[Parcel],
    capacity: &[f64],
    radius: i32,
) -> Result<Assignment, String> {
    let mut owner = vec![-1isize; allowed.len()];
    let mut destination = vec![-1isize; parcels.len()];
    let mut pending = vec![];
    let max_weight = parcels
        .iter()
        .fold(0.0f64, |m, p| m.max(p.weight))
        .max(f64::MIN_POSITIVE);
    let weights: Vec<_> = parcels.iter().map(|p| p.weight / max_weight).collect();
    let offsets = stencil(radius);
    let mut u = vec![C::zero(); parcels.len()];
    let mut v = vec![C::zero(); allowed.len()];
    for (p, q) in parcels.iter().enumerate() {
        let i = round(q.target_i).clamp(0.0, (nx - 1) as f64) as i32;
        let k = round(q.target_k).clamp(0.0, (nz - 1) as f64) as i32;
        let n = k as usize * nx + i as usize;
        let fits = allowed[n] && q.height <= capacity[n];
        if fits && owner[n] < 0 {
            owner[n] = p as isize;
            destination[p] = n as isize;
        } else if fits
            && cost(q, i, k, weights[p])
                < cost(
                    &parcels[owner[n] as usize],
                    i,
                    k,
                    weights[owner[n] as usize],
                )
        {
            pending.push(owner[n] as usize);
            destination[owner[n] as usize] = -1;
            owner[n] = p as isize;
            destination[p] = n as isize;
        } else {
            pending.push(p)
        }
    }
    for (p, &n) in destination.iter().enumerate() {
        if n >= 0 {
            u[p] = C::from(cost(
                &parcels[p],
                n as i32 % nx as i32,
                n as i32 / nx as i32,
                weights[p],
            ))
            .ok_or("Transport cost overflow")?
        }
    }
    let mut search = Search::new(parcels.len(), allowed.len());
    for root in pending {
        search.start(root);
        search.relax(
            root, nx, nz, allowed, parcels, capacity, &weights, &u, &v, &offsets, true,
        )?;
        let mut found = None;
        while let Some(Reverse((d, n))) = search.heap.pop() {
            if search.done_n[n] == search.stamp || d > search.dist_n[n] {
                continue;
            }
            search.done_n[n] = search.stamp;
            if owner[n] < 0 {
                found = Some((n, d));
                break;
            }
            let p = owner[n] as usize;
            if search.seen_p[p] != search.stamp {
                search.seen_p[p] = search.stamp;
                search.dist_p[p] = d;
                search.touched_p.push(p);
                search.relax(
                    p, nx, nz, allowed, parcels, capacity, &weights, &u, &v, &offsets, true,
                )?
            }
        }
        let (end, shortest) = found.ok_or_else(|| {
            format!("Placement: cannot place parcel {root} within {radius} cells")
        })?;
        search.potentials(&mut u, &mut v, shortest)?;
        let mut n = end as isize;
        while n >= 0 {
            let p = search.parent_n[n as usize];
            let old = destination[p];
            owner[n as usize] = p as isize;
            destination[p] = n;
            n = old;
        }
    }
    let destination: Vec<_> = destination.into_iter().map(|n| n as usize).collect();
    let mut displaced = 0;
    let mut maximum: f64 = 0.0;
    for (p, &n) in destination.iter().enumerate() {
        let q = &parcels[p];
        let d = (n as f64 % nx as f64 - q.i as f64).hypot((n / nx) as f64 - q.k as f64);
        displaced += usize::from(d > 0.0);
        maximum = maximum.max(d)
    }
    Ok(Assignment {
        destination,
        displaced,
        max_offset_cells: maximum,
        radius,
    })
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Share {
    pub parcel: usize,
    pub destination: usize,
    pub height: f64,
    #[serde(default)]
    pub lengths: Vec<f64>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapacityAssignment {
    pub shares: Vec<Share>,
    pub radius: i32,
    pub max_offset_cells: f64,
    pub split_sources: usize,
    pub augmentations: usize,
}
fn flow_get(owners: &[(usize, BigUint)], p: usize) -> BigUint {
    owners
        .iter()
        .find(|(id, _)| *id == p)
        .map(|(_, n)| n.clone())
        .unwrap_or_default()
}
fn flow_set(owners: &mut Vec<(usize, BigUint)>, p: usize, n: BigUint) {
    if let Some(i) = owners.iter().position(|(id, _)| *id == p) {
        if n.is_zero() {
            owners.remove(i);
        } else {
            owners[i].1 = n;
        }
    } else if !n.is_zero() {
        owners.push((p, n))
    }
}
pub fn capacity_assign(
    nx: usize,
    nz: usize,
    allowed: &[bool],
    parcels: &[Parcel],
    capacity: &[f64],
) -> Result<CapacityAssignment, String> {
    validate(nx, nz, allowed, parcels, capacity)?;
    match capacity_solve(nx, nz, allowed, parcels, capacity, 2) {
        Ok(a) => Ok(a),
        Err(e) if e.starts_with("Packing:") => {
            capacity_solve(nx, nz, allowed, parcels, capacity, 3)
        }
        Err(e) => Err(e),
    }
}
#[allow(clippy::needless_range_loop)]
fn capacity_solve(
    nx: usize,
    nz: usize,
    allowed: &[bool],
    parcels: &[Parcel],
    capacity: &[f64],
    radius: i32,
) -> Result<CapacityAssignment, String> {
    let max_weight = parcels
        .iter()
        .fold(0.0f64, |m, p| m.max(p.weight / p.height));
    let logs: Vec<_> = parcels
        .iter()
        .map(|p| p.weight.ln() - p.height.ln())
        .collect();
    let max_log = logs.iter().fold(f64::NEG_INFINITY, |m, p| m.max(*p));
    let weights: Vec<_> = parcels
        .iter()
        .enumerate()
        .map(|(i, p)| {
            if max_weight >= f64::MIN_POSITIVE && max_weight.is_finite() {
                p.weight / p.height / max_weight
            } else {
                (logs[i] - max_log).exp()
            }
        })
        .collect();
    let s = Scale::new(
        parcels
            .iter()
            .flat_map(|p| {
                if p.material_heights.is_empty() {
                    vec![p.height]
                } else {
                    p.material_heights.clone()
                }
            })
            .chain(capacity.iter().copied()),
    )?;
    let source: Vec<_> = parcels
        .iter()
        .map(|p| {
            s.sum(if p.material_heights.is_empty() {
                vec![p.height]
            } else {
                p.material_heights.clone()
            })
        })
        .collect::<Result<_, _>>()?;
    let mut remaining = source.clone();
    let mut free: Vec<_> = capacity
        .iter()
        .enumerate()
        .map(|(n, c)| {
            if allowed[n] {
                s.units(*c)
            } else {
                Ok(BigUint::zero())
            }
        })
        .collect::<Result<_, _>>()?;
    let mut owners: Vec<Vec<(usize, BigUint)>> = vec![vec![]; allowed.len()];
    let mut u = vec![0i128; parcels.len()];
    let mut v = vec![0i128; allowed.len()];
    let mut nearest: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    let offsets = stencil(radius);
    for (p, q) in parcels.iter().enumerate() {
        let i = round(q.target_i).clamp(0.0, (nx - 1) as f64) as usize;
        let k = round(q.target_k).clamp(0.0, (nz - 1) as f64) as usize;
        let n = k * nx + i;
        if allowed[n] && !free[n].is_zero() {
            nearest.entry(n).or_default().push(p)
        }
    }
    for (n, mut group) in nearest {
        group.sort_by_key(|p| {
            (
                cost(&parcels[*p], (n % nx) as i32, (n / nx) as i32, weights[*p]),
                *p,
            )
        });
        for p in group {
            let f = remaining[p].clone().min(free[n].clone());
            if f.is_zero() {
                break;
            }
            flow_set(&mut owners[n], p, f.clone());
            remaining[p] -= &f;
            free[n] -= f;
            u[p] = cost(&parcels[p], (n % nx) as i32, (n / nx) as i32, weights[p]);
        }
    }
    let mut search = Search::new(parcels.len(), allowed.len());
    let mut augmentations = 0;
    for root in 0..parcels.len() {
        while !remaining[root].is_zero() {
            augmentations += 1;
            search.start(root);
            search.relax(
                root, nx, nz, allowed, parcels, capacity, &weights, &u, &v, &offsets, false,
            )?;
            let mut found = None;
            while let Some(Reverse((d, n))) = search.heap.pop() {
                if search.done_n[n] == search.stamp || d > search.dist_n[n] {
                    continue;
                }
                search.done_n[n] = search.stamp;
                if !free[n].is_zero() {
                    found = Some((n, d));
                    break;
                }
                for (p, f) in &owners[n] {
                    if !f.is_zero() && search.seen_p[*p] != search.stamp {
                        if u[*p] + v[n]
                            - cost(&parcels[*p], (n % nx) as i32, (n / nx) as i32, weights[*p])
                            != 0
                        {
                            return Err("Non-tight capacity edge".into());
                        }
                        search.seen_p[*p] = search.stamp;
                        search.dist_p[*p] = d;
                        search.parent_p[*p] = n as isize;
                        search.touched_p.push(*p);
                        search.relax(
                            *p, nx, nz, allowed, parcels, capacity, &weights, &u, &v, &offsets,
                            false,
                        )?
                    }
                }
            }
            let (end, shortest) = found.ok_or_else(|| {
                format!("Packing: cannot place source {root} within {radius} cells")
            })?;
            let mut amount = remaining[root].clone().min(free[end].clone());
            let mut n = end;
            loop {
                let p = search.parent_n[n];
                let old = search.parent_p[p];
                if old < 0 {
                    break;
                }
                amount = amount.min(flow_get(&owners[old as usize], p));
                n = old as usize;
            }
            if amount.is_zero() {
                return Err("Nonpositive flow augmentation".into());
            }
            search.potentials(&mut u, &mut v, shortest)?;
            remaining[root] -= &amount;
            free[end] -= &amount;
            let mut n = end;
            loop {
                let p = search.parent_n[n];
                let old = search.parent_p[p];
                let value = flow_get(&owners[n], p) + &amount;
                flow_set(&mut owners[n], p, value);
                if old < 0 {
                    break;
                }
                let value = flow_get(&owners[old as usize], p) - &amount;
                flow_set(&mut owners[old as usize], p, value);
                n = old as usize;
            }
        }
    }
    let mut shares = vec![];
    let mut counts = vec![0; parcels.len()];
    let mut sums = vec![BigUint::zero(); parcels.len()];
    let mut maximum: f64 = 0.0;
    for (n, group) in owners.iter().enumerate() {
        let mut dest_sum = BigUint::zero();
        for (p, height) in group {
            if height.is_zero() {
                continue;
            }
            shares.push(Share {
                parcel: *p,
                destination: n,
                height: s.number(height)?,
                lengths: s.chunks(height)?,
            });
            sums[*p] += height;
            dest_sum += height;
            counts[*p] += 1;
            maximum = maximum.max(
                ((n % nx) as f64 - parcels[*p].i as f64)
                    .hypot((n / nx) as f64 - parcels[*p].k as f64),
            );
        }
        if dest_sum > s.units(capacity[n])? {
            return Err("Destination capacity balance failure".into());
        }
    }
    if sums != source {
        return Err("Source capacity balance failure".into());
    }
    Ok(CapacityAssignment {
        shares,
        radius,
        max_offset_cells: maximum,
        split_sources: counts.iter().filter(|n| **n > 1).count(),
        augmentations,
    })
}
#[derive(Clone, Debug)]
pub struct Slice {
    pub parcel: usize,
    pub destination: usize,
    pub source_part: usize,
    pub source_local_top: f64,
    pub part: material::Layer,
}
pub fn slice_shares(parts: &[Column], shares: &[Share]) -> Result<Vec<Slice>, String> {
    let mut out = vec![];
    for (parcel, parts) in parts.iter().enumerate() {
        let mut group: Vec<_> = shares.iter().filter(|q| q.parcel == parcel).collect();
        group.sort_by_key(|q| q.destination);
        let extra: Vec<_> = group
            .iter()
            .flat_map(|q| q.lengths.iter().copied())
            .collect();
        let s = material::scale(&[parts], &extra)?;
        let lengths: Vec<_> = parts.iter().map(|p| p.units(s)).collect::<Result<_, _>>()?;
        let total: BigUint = lengths.iter().cloned().sum();
        let shares_total: BigUint = group
            .iter()
            .map(|q| s.sum(q.lengths.iter().copied()))
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .sum();
        if total != shares_total {
            return Err("Capacity slices do not exhaust source".into());
        }
        let mut piece_groups: Vec<Vec<usize>> = vec![vec![]; parts.len()];
        let mut source_part = 0;
        let mut consumed = BigUint::zero();
        let mut preceding = BigUint::zero();
        for share in group {
            let mut remaining = s.sum(share.lengths.iter().copied())?;
            while !remaining.is_zero() {
                let available = &lengths[source_part] - &consumed;
                let take = remaining.clone().min(available);
                if take.is_zero() {
                    return Err("Nonpositive capacity slice".into());
                }
                let mut part = parts[source_part].clone();
                part.solid = 0.0;
                part = part.with_lengths(s.chunks(&take)?)?;
                piece_groups[source_part].push(out.len());
                out.push(Slice {
                    parcel,
                    destination: share.destination,
                    source_part,
                    source_local_top: s.number(&(&preceding + &consumed))?,
                    part,
                });
                consumed += &take;
                remaining -= take;
                if consumed == lengths[source_part] {
                    preceding += &consumed;
                    consumed = BigUint::zero();
                    source_part += 1;
                }
            }
        }
        for (j, pieces) in piece_groups.iter_mut().enumerate() {
            pieces.sort_by(|a, b| out[*a].part.height.total_cmp(&out[*b].part.height));
            let p = &parts[j];
            let mut remaining = p.solid;
            for (k, &index) in pieces.iter().enumerate() {
                let q = &mut out[index].part;
                q.solid = if k + 1 == pieces.len() {
                    remaining
                } else {
                    p.solid * (q.height / p.height)
                };
                if !q.solid.is_finite() || q.solid < 0.0 {
                    return Err("Invalid sliced grain amount".into());
                }
                remaining -= q.solid;
            }
        }
    }
    Ok(out)
}
