use crate::{
    budget::{Flux, outside},
    geometry::{self, Flow, V},
    material::{self, Bed, Column, Layer, WATER},
    raster::{self, Raster},
    transport::{self, Assignment, Parcel},
};
use num_bigint::{BigInt, BigUint};
use num_traits::Zero;
use serde::Serialize;
use std::collections::BTreeMap;
pub struct NormalResult {
    pub columns: Vec<Column>,
    pub flux: Flux,
    pub area_error: f64,
}
pub fn normal(
    columns: &[Column],
    depth: &[f64],
    cells: i32,
    dir: i32,
    h: f64,
    end: f64,
    beds: &[Bed],
) -> Result<NormalResult, String> {
    let nx = columns.len();
    let mut flux = Flux::default();
    let mut rock_in = 0.0;
    let mut rock_out = 0.0;
    for i in 0..nx {
        if !depth[i].is_finite() {
            continue;
        }
        let dest = i as i32 + dir * cells;
        let target = if dest >= 0 && (dest as usize) < nx {
            depth[dest as usize]
        } else {
            depth[i]
        };
        if !target.is_finite() {
            return Err("Undefined normal destination".into());
        }
        let s = material::scale(&[&columns[i]], &[end, depth[i], target])?;
        let domain = BigInt::from(s.units(end)?);
        let source_depth = s.signed(depth[i])?;
        let hi = BigInt::zero().max(domain.clone().min(source_depth.clone()));
        let mut tally = |side: &str, c: Column| {
            flux.outflow.get_mut(side).unwrap().column(&c, beds, h);
            rock_out += c
                .iter()
                .filter(|p| p.bed != WATER)
                .map(|p| p.height)
                .sum::<f64>();
        };
        if dest < 0 || dest >= nx as i32 {
            tally(
                if dest < 0 { "left" } else { "right" },
                material::cut(&columns[i], &BigInt::zero(), &hi, s)?,
            );
            continue;
        }
        let dz = s.signed(target)? - source_depth;
        tally(
            "top",
            material::cut(
                &columns[i],
                &BigInt::zero(),
                &hi.clone().min(BigInt::zero().max(-&dz)),
                s,
            )?,
        );
        tally(
            "bottom",
            material::cut(&columns[i], &BigInt::zero().max(&domain - &dz), &hi, s)?,
        );
    }
    let mut next = Vec::with_capacity(nx);
    for (i, old) in columns.iter().enumerate() {
        if !depth[i].is_finite() {
            next.push(old.clone());
            continue;
        }
        let source = i as i32 - dir * cells;
        let zs = if source >= 0 && (source as usize) < nx {
            depth[source as usize]
        } else {
            f64::NAN
        };
        let empty = vec![];
        let donor = if zs.is_finite() {
            &columns[source as usize]
        } else {
            &empty
        };
        let mut extra = vec![end, depth[i]];
        if zs.is_finite() {
            extra.push(zs)
        }
        let s = material::scale(&[old, donor], &extra)?;
        let domain = BigInt::from(s.units(end)?);
        let destination_depth = s.signed(depth[i])?;
        let hi = BigInt::zero().max(domain.clone().min(destination_depth.clone()));
        let mut out = vec![];
        let water = |out: &mut Column, n: &BigInt| -> Result<(), String> {
            if n > &BigInt::zero() {
                material::append(
                    out,
                    Layer::empty(WATER, 0.0).with_lengths(s.chunks(&n.to_biguint().unwrap())?)?,
                )?;
            }
            Ok(())
        };
        if !zs.is_finite() {
            water(&mut out, &hi)?
        } else {
            let source_depth = s.signed(zs)?;
            let dz = destination_depth - source_depth.clone();
            water(&mut out, &hi.clone().min(BigInt::zero().max(dz.clone())))?;
            let lower = BigInt::zero().max(-&dz);
            let upper = domain.clone().min(source_depth.clone()).min(&hi - &dz);
            for p in material::cut(donor, &lower, &upper, s)? {
                material::append(&mut out, p)?;
            }
            let incoming =
                BigInt::zero().max(source_depth.min(&hi - &dz) - domain.clone().max(lower));
            if incoming > BigInt::zero() {
                let p = donor
                    .last()
                    .ok_or("Missing normal boundary donor")?
                    .portion(s.chunks(&incoming.to_biguint().unwrap())?)?;
                flux.inflow
                    .get_mut("bottom")
                    .unwrap()
                    .column(&vec![p.clone()], beds, h);
                if p.bed != WATER {
                    rock_in += p.height
                }
                material::append(&mut out, p)?;
            }
        }
        for p in material::cut(old, &hi, &domain, s)? {
            material::append(&mut out, p)?;
        }
        next.push(out);
    }
    let rock = |cs: &[Column]| {
        cs.iter()
            .map(|c| {
                c.iter()
                    .filter(|p| p.bed != WATER)
                    .map(|p| p.height)
                    .sum::<f64>()
            })
            .sum::<f64>()
    };
    let before = rock(columns);
    let after = rock(&next);
    Ok(NormalResult {
        columns: next,
        flux,
        area_error: if before > 0.0 {
            (after - before - rock_in + rock_out).abs() / before
        } else {
            0.0
        },
    })
}
pub struct Subsided {
    pub column: Column,
    pub out_top: Column,
    pub out_bottom: Column,
    pub in_bottom: Column,
}
pub fn subside(
    column: &Column,
    x: f64,
    end: f64,
    displacement: &dyn Fn(f64) -> f64,
) -> Result<Subsided, String> {
    let shift = displacement(x);
    let mut old = column.clone();
    for p in &mut old {
        if p.bed != WATER && p.offset_x != 0.0 {
            p.offset_z += displacement(x + p.offset_x) - shift;
        }
    }
    let mut next = vec![];
    let mut out_top = vec![];
    let mut out_bottom = vec![];
    let mut in_bottom = vec![];
    if shift >= 0.0 {
        let d = shift.min(end);
        out_bottom = material::slice(&old, &[end, -d], &[end])?;
        material::append(&mut next, Layer::empty(WATER, d))?;
        for p in material::slice(&old, &[0.0], &[end, -d])? {
            material::append(&mut next, p)?
        }
    } else {
        let d = (-shift).min(end);
        out_top = material::slice(&old, &[0.0], &[d])?;
        for p in material::slice(&old, &[d], &[end])? {
            material::append(&mut next, p)?
        }
        let donor = old
            .last()
            .ok_or("Empty subsidence column")?
            .portion(vec![d])?;
        in_bottom.push(donor.clone());
        material::append(&mut next, donor)?;
    }
    Ok(Subsided {
        column: next,
        out_top,
        out_bottom,
        in_bottom,
    })
}
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Placement {
    pub parcels: usize,
    pub displaced: usize,
    pub max_offset_cells: f64,
    pub radius: i32,
    pub fallback: bool,
    pub fallback_reason: Option<String>,
    pub split_sources: usize,
    pub sliced_constituents: usize,
    pub max_child_physical_to_cell_center_cells: f64,
    pub max_child_storage_offset_cells: f64,
}
#[derive(Clone)]
struct Packet {
    pub parcel: Parcel,
    pub parts: Column,
    pub offset: V,
    pub incoming: bool,
    pub displacements: Vec<Option<V>>,
}
pub struct ThrustResult {
    pub columns: Vec<Column>,
    pub depth: Vec<f64>,
    pub carry: Vec<f64>,
    pub flow: Flow,
    pub corr: Vec<V>,
    pub flux: Flux,
    pub numerical: BTreeMap<usize, Vec<(f64, f64)>>,
    pub placement: Placement,
    pub area_error: f64,
}
fn local_tops(c: &Column) -> Result<Vec<f64>, String> {
    let s = material::scale(&[c], &[])?;
    let mut preceding = BigUint::zero();
    let mut out = vec![];
    for p in c {
        out.push(s.number(&preceding)?);
        preceding += p.units(s)?;
    }
    Ok(out)
}
fn offsets(c: &Column) -> V {
    let (mut volume, mut x, mut z) = (0.0, 0.0, 0.0);
    for p in c {
        if p.bed != WATER {
            volume += p.height;
            x += p.height * p.offset_x;
            z += p.height * p.offset_z
        }
    }
    if volume > 0.0 {
        [x / volume, z / volume]
    } else {
        [0.0; 2]
    }
}
// Preserve the reference operation boundary during migration.
#[allow(clippy::too_many_arguments)]
pub fn thrust(
    state: &Raster,
    nx: usize,
    nz: usize,
    h: f64,
    beds: &[Bed],
    points: Vec<V>,
    slip: f64,
    carry: &[f64],
) -> Result<ThrustResult, String> {
    let flow = Flow::new(points)?;
    let x = |i: usize| -2000.0 + i as f64 * h;
    let depth: Vec<_> = (0..nx)
        .map(|i| geometry::poly_depth(&flow.p, x(i)))
        .collect();
    let capacity: Vec<_> = (0..nx * nz)
        .map(|n| (depth[n % nx] - (n / nx) as f64 * h).clamp(0.0, h))
        .collect();
    let allowed: Vec<_> = capacity.iter().map(|v| *v > 1e-10).collect();
    let mut next_carry = carry.to_vec();
    next_carry.resize(flow.t.len(), 0.0);
    let moves: Vec<_> = flow
        .t
        .iter()
        .enumerate()
        .map(|(j, t)| {
            let ex = slip * t[0];
            let dx = if slip == 0.0 {
                0.0
            } else {
                transport::round((ex - carry.get(j).copied().unwrap_or(0.0)) / h)
            };
            next_carry[j] = carry.get(j).copied().unwrap_or(0.0) + dx * h - ex;
            dx as i32
        })
        .collect();
    let corr: Vec<_> = flow
        .t
        .iter()
        .enumerate()
        .map(|(j, t)| [slip * t[0] - moves[j] as f64 * h, 0.0])
        .collect();
    let mut flux = Flux::default();
    let mut numerical = BTreeMap::new();
    let mut packets: Vec<Packet> = vec![];
    let mut hw: BTreeMap<usize, Column> = BTreeMap::new();
    let mut fw = BTreeMap::new();
    let rock = |c: &Column| c.iter().any(|p| p.bed != WATER);
    for (n, is_allowed) in allowed.iter().enumerate() {
        if *is_allowed {
            let cell = state.cell(n, h);
            hw.insert(n, material::slice(&cell, &[0.0], &[capacity[n]])?);
            fw.insert(n, material::slice(&cell, &[capacity[n]], &[h])?);
        }
    }
    if slip == 0.0 {
        return Ok(ThrustResult {
            columns: state.columns(nx, nz, h)?,
            depth,
            carry: carry.to_vec(),
            flow,
            corr,
            flux,
            numerical,
            placement: Placement {
                radius: 2,
                ..Default::default()
            },
            area_error: 0.0,
        });
    }
    let mut before = 0;
    let mut inflow = 0;
    let mut lost = 0;
    for (&n, parts) in &hw {
        if !rock(parts) {
            continue;
        }
        before += 1;
        let offset = offsets(parts);
        let i = n % nx;
        let k = n / nx;
        let tops = local_tops(parts)?;
        let (mut volume, mut mean_x, mut mean_z) = (0.0, 0.0, 0.0);
        let mut displacements = vec![];
        for (part, p) in parts.iter().enumerate() {
            if p.bed == WATER {
                displacements.push(None);
                continue;
            }
            let d = flow.mean_displacement(
                x(i) + p.offset_x,
                k as f64 * h + tops[part] + p.offset_z,
                p.height,
                slip,
                h,
            )?;
            volume += p.height;
            mean_x += p.height * (p.offset_x + d[0]);
            mean_z += p.height * (p.offset_z + d[1]);
            displacements.push(Some(d));
        }
        let ti = i as f64 + mean_x / volume / h;
        let tk = k as f64 + mean_z / volume / h;
        let ia = transport::round(ti) as i32;
        let ka = transport::round(tk) as i32;
        if let Some(side) = outside(ia, ka, nx, nz) {
            flux.outflow.get_mut(side).unwrap().column(parts, beds, h);
            lost += 1;
        } else {
            let rock_parts = parts.iter().filter(|p| p.bed != WATER).cloned().collect();
            packets.push(Packet {
                parcel: Parcel {
                    source: n,
                    i: ia,
                    k: ka,
                    target_i: ti,
                    target_k: tk,
                    height: material::height(parts)?,
                    weight: material::height(&rock_parts)? / h,
                    material_heights: parts
                        .iter()
                        .flat_map(|p| p.lengths().iter().copied())
                        .collect(),
                },
                parts: parts.clone(),
                offset,
                incoming: false,
                displacements,
            });
        }
    }
    let top_row = |i: usize| (depth[i] / h).ceil() as i32 - 1;
    let row_of = |j: usize, i: usize| {
        let a = flow.p[j];
        let b = flow.p[j + 1];
        ((a[1] + (b[1] - a[1]) * (x(i) - a[0]) / if b[0] == a[0] { 1.0 } else { b[0] - a[0] }) / h)
            .ceil() as i32
            - 1
    };
    let mut expected = vec![false; nx * nz];
    for &n in hw.keys() {
        let i = n % nx;
        let k = n / nx;
        let p = [x(i), k as f64 * h];
        let j = flow.domain(p);
        let back = flow.moved(p, -slip)?;
        let within = flow.domain(back) == j;
        let raw_i = if within {
            i as i32 - moves[j]
        } else {
            transport::round((back[0] + 2000.0) / h) as i32
        };
        let is = raw_i.clamp(0, nx as i32 - 1) as usize;
        let ks = (if within {
            k as i32 + row_of(j, is) - row_of(j, i)
        } else {
            transport::round(back[1] / h) as i32
        })
        .min(top_row(is));
        if ks < 0 {
            continue;
        }
        let side = outside(raw_i, ks, nx, nz);
        let src = (ks as usize).min(nz - 1) * nx + is;
        let Some(parts) = hw.get(&src) else { continue };
        if !rock(parts) {
            continue;
        }
        expected[n] = true;
        let Some(side) = side else { continue };
        flux.inflow.get_mut(side).unwrap().column(parts, beds, h);
        inflow += 1;
        let dx = -next_carry[j] / h;
        let offset = offsets(parts);
        let rock_parts = parts.iter().filter(|p| p.bed != WATER).cloned().collect();
        packets.push(Packet {
            parcel: Parcel {
                source: src,
                i: i as i32,
                k: k as i32,
                target_i: i as f64 + dx,
                target_k: k as f64 + dx * flow.t[j][1] / flow.t[j][0],
                height: material::height(parts)?,
                weight: material::height(&rock_parts)? / h,
                material_heights: parts
                    .iter()
                    .flat_map(|p| p.lengths().iter().copied())
                    .collect(),
            },
            parts: parts.clone(),
            offset,
            incoming: true,
            displacements: vec![],
        });
    }
    let parcels: Vec<_> = packets.iter().map(|p| p.parcel.clone()).collect();
    let mut assigned: BTreeMap<usize, Column> = BTreeMap::new();
    let mut placement = Placement {
        parcels: parcels.len(),
        ..Default::default()
    };
    match transport::assign(nx, nz, &allowed, &parcels, &capacity) {
        Ok(Assignment {
            destination,
            displaced,
            max_offset_cells,
            radius,
        }) => {
            placement.displaced = displaced;
            placement.max_offset_cells = max_offset_cells;
            placement.radius = radius;
            for (p, &n) in destination.iter().enumerate() {
                let src = &packets[p];
                let dx = (src.parcel.target_i - (n % nx) as f64) * h - src.offset[0];
                let dz = (src.parcel.target_k - (n / nx) as f64) * h - src.offset[1];
                let mut parts = src.parts.clone();
                for (part, q) in parts.iter_mut().enumerate() {
                    if let Some(Some(d)) = src.displacements.get(part) {
                        q.offset_x +=
                            d[0] + ((src.parcel.source % nx) as f64 - (n % nx) as f64) * h;
                        q.offset_z +=
                            d[1] + ((src.parcel.source / nx) as f64 - (n / nx) as f64) * h;
                    } else {
                        q.offset_x += dx;
                        q.offset_z += dz;
                    }
                }
                assigned.insert(n, parts);
            }
        }
        Err(e) if e.starts_with("Placement:") => {
            let split = transport::capacity_assign(nx, nz, &allowed, &parcels, &capacity)?;
            placement.fallback = true;
            placement.fallback_reason = Some(e);
            placement.radius = split.radius;
            placement.max_offset_cells = split.max_offset_cells;
            placement.split_sources = split.split_sources;
            placement.displaced = split
                .shares
                .iter()
                .filter(|q| {
                    q.destination
                        != parcels[q.parcel].k as usize * nx + parcels[q.parcel].i as usize
                })
                .count();
            let parts: Vec<_> = packets.iter().map(|p| p.parts.clone()).collect();
            let slices = transport::slice_shares(&parts, &split.shares)?;
            placement.sliced_constituents = slices.len();
            let mut groups: BTreeMap<usize, Vec<(transport::Slice, Layer, f64)>> = BTreeMap::new();
            for slice in slices {
                let src = &packets[slice.parcel];
                let p = &slice.part;
                let n = slice.destination;
                let displacement = if !src.incoming && p.bed != WATER {
                    Some(flow.mean_displacement(
                        x(src.parcel.source % nx) + p.offset_x,
                        (src.parcel.source / nx) as f64 * h + slice.source_local_top + p.offset_z,
                        p.height,
                        slip,
                        h,
                    )?)
                } else {
                    None
                };
                let dx = (src.parcel.target_i - (n % nx) as f64) * h - src.offset[0];
                let dz = (src.parcel.target_k - (n / nx) as f64) * h - src.offset[1];
                let mut moved = p.clone();
                if let Some(d) = displacement {
                    moved.offset_x +=
                        d[0] + ((src.parcel.source % nx) as f64 - (n % nx) as f64) * h;
                    moved.offset_z +=
                        d[1] + ((src.parcel.source / nx) as f64 - (n / nx) as f64) * h;
                } else {
                    moved.offset_x += dx;
                    moved.offset_z += dz;
                }
                moved.offset_z += slice.source_local_top;
                let center = moved.offset_z + p.height / 2.0;
                groups.entry(n).or_default().push((slice, moved, center));
            }
            for (n, mut group) in groups {
                group.sort_by(|a, b| {
                    a.2.total_cmp(&b.2)
                        .then(a.0.parcel.cmp(&b.0.parcel))
                        .then(a.0.source_local_top.total_cmp(&b.0.source_local_top))
                });
                let parts: Vec<_> = group.iter().map(|q| q.1.clone()).collect();
                let tops = local_tops(&parts)?;
                let mut parts = vec![];
                for (index, (_, mut p, center)) in group.into_iter().enumerate() {
                    p.offset_z -= tops[index];
                    placement.max_child_physical_to_cell_center_cells = placement
                        .max_child_physical_to_cell_center_cells
                        .max((p.offset_x / h).hypot((center - h / 2.0) / h));
                    placement.max_child_storage_offset_cells = placement
                        .max_child_storage_offset_cells
                        .max((p.offset_x / h).hypot(p.offset_z / h));
                    parts.push(p);
                }
                assigned.insert(n, parts);
            }
        }
        Err(e) => return Err(e),
    }
    let mut output = state.clone();
    for &n in hw.keys() {
        let empty = vec![];
        let moved = assigned.get(&n).unwrap_or(&empty);
        let used = material::height(moved)?;
        let mut out = vec![];
        for p in moved {
            material::append(&mut out, p.clone())?
        }
        let scale = material::scale(&[moved], &[capacity[n]])?;
        let used_units = material::total(moved, scale)?;
        let available = scale.units(capacity[n])?;
        if used_units > available {
            return Err("Thrust reconstruction exceeds exact capacity".into());
        }
        let free = available - used_units;
        let gap = scale.number(&free)?;
        if !free.is_zero() {
            material::append(
                &mut out,
                Layer::empty(WATER, 0.0).with_lengths(scale.chunks(&free)?)?,
            )?;
        }
        if gap > 1e-10 && (!moved.is_empty() || expected[n]) {
            numerical.insert(n, vec![(used, capacity[n])]);
        }
        for p in &fw[&n] {
            material::append(&mut out, p.clone())?
        }
        output.subcells.insert(n, out);
    }
    let columns = output.columns(nx, nz, h)?;
    let projected = raster::rasterize(&columns, nz, h)?;
    let columns = projected.columns(nx, nz, h)?;
    let error = if before > 0 {
        (packets.len() as f64 - (before + inflow - lost) as f64).abs() / before as f64
    } else {
        0.0
    };
    Ok(ThrustResult {
        columns,
        depth,
        carry: next_carry,
        flow,
        corr,
        flux,
        numerical,
        placement,
        area_error: error,
    })
}
