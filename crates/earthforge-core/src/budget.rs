use crate::material::{Bed, Column, Layer};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
pub const SIDES: [&str; 4] = ["left", "right", "top", "bottom"];
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Inventory {
    pub total: f64,
    pub sand: f64,
    pub shale: f64,
    pub carbonate: f64,
    pub by_bed: Vec<f64>,
    pub by_bed_components: Components,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Components {
    pub sand: Vec<f64>,
    pub shale: Vec<f64>,
    pub carbonate: Vec<f64>,
}
fn add_vec(to: &mut Vec<f64>, from: &[f64], scale: f64) {
    to.resize(to.len().max(from.len()), 0.0);
    for (i, v) in from.iter().enumerate() {
        to[i] += scale * v;
    }
}
impl Inventory {
    pub fn add(&mut self, from: &Self, s: f64) {
        self.total += s * from.total;
        self.sand += s * from.sand;
        self.shale += s * from.shale;
        self.carbonate += s * from.carbonate;
        add_vec(&mut self.by_bed, &from.by_bed, s);
        add_vec(
            &mut self.by_bed_components.sand,
            &from.by_bed_components.sand,
            s,
        );
        add_vec(
            &mut self.by_bed_components.shale,
            &from.by_bed_components.shale,
            s,
        );
        add_vec(
            &mut self.by_bed_components.carbonate,
            &from.by_bed_components.carbonate,
            s,
        );
    }
    pub fn parcel(&mut self, p: &Layer, carbonate: bool, area: f64) {
        if p.bed < 0 {
            return;
        }
        let id = p.bed as usize;
        let volume = p.solid * area;
        self.total += volume;
        self.by_bed.resize(self.by_bed.len().max(id + 1), 0.0);
        self.by_bed[id] += volume;
        let sand = if carbonate { 0.0 } else { volume * p.fraction };
        let shale = if carbonate {
            0.0
        } else {
            volume * (1.0 - p.fraction)
        };
        let carb = if carbonate { volume } else { 0.0 };
        self.sand += sand;
        self.shale += shale;
        self.carbonate += carb;
        for (to, v) in [
            (&mut self.by_bed_components.sand, sand),
            (&mut self.by_bed_components.shale, shale),
            (&mut self.by_bed_components.carbonate, carb),
        ] {
            to.resize(to.len().max(id + 1), 0.0);
            to[id] += v;
        }
    }
    pub fn column(&mut self, c: &Column, beds: &[Bed], area: f64) {
        for p in c {
            if p.bed >= 0 {
                self.parcel(p, beds[p.bed as usize].carbonate, area)
            }
        }
    }
    pub fn values(&self) -> Vec<f64> {
        let mut a = vec![self.total, self.sand, self.shale, self.carbonate];
        a.extend(&self.by_bed);
        a.extend(&self.by_bed_components.sand);
        a.extend(&self.by_bed_components.shale);
        a.extend(&self.by_bed_components.carbonate);
        a
    }
    pub fn absolute(&self) -> Self {
        let mut a = self.clone();
        a.total = a.total.abs();
        a.sand = a.sand.abs();
        a.shale = a.shale.abs();
        a.carbonate = a.carbonate.abs();
        for v in [
            &mut a.by_bed,
            &mut a.by_bed_components.sand,
            &mut a.by_bed_components.shale,
            &mut a.by_bed_components.carbonate,
        ] {
            for x in v {
                x.clone_from(&x.abs())
            }
        }
        a
    }
}
pub fn inventory(columns: &[Column], beds: &[Bed], area: f64) -> Inventory {
    let mut a = Inventory::default();
    for c in columns {
        a.column(c, beds, area)
    }
    a
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Flux {
    pub deposited: Inventory,
    pub eroded: Inventory,
    pub repair_added: Inventory,
    pub inflow: BTreeMap<String, Inventory>,
    pub outflow: BTreeMap<String, Inventory>,
}
impl Default for Flux {
    fn default() -> Self {
        Self {
            deposited: Inventory::default(),
            eroded: Inventory::default(),
            repair_added: Inventory::default(),
            inflow: SIDES
                .iter()
                .map(|s| (s.to_string(), Inventory::default()))
                .collect(),
            outflow: SIDES
                .iter()
                .map(|s| (s.to_string(), Inventory::default()))
                .collect(),
        }
    }
}
impl Flux {
    pub fn add(&mut self, f: &Self) {
        self.deposited.add(&f.deposited, 1.0);
        self.eroded.add(&f.eroded, 1.0);
        self.repair_added.add(&f.repair_added, 1.0);
        for side in SIDES {
            self.inflow.get_mut(side).unwrap().add(&f.inflow[side], 1.0);
            self.outflow
                .get_mut(side)
                .unwrap()
                .add(&f.outflow[side], 1.0);
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub surfaces: Vec<f64>,
    pub step: usize,
    pub process: String,
    pub fault: Option<usize>,
    pub before: Inventory,
    pub after: Inventory,
    pub flux: Flux,
    pub residual: Inventory,
    pub closed: bool,
    pub worst_normalized_residual: f64,
}
fn assessed(before: &Inventory, after: &Inventory, flux: &Flux) -> (Inventory, bool, f64) {
    let mut expected = before.clone();
    expected.add(&flux.deposited, 1.0);
    expected.add(&flux.eroded, -1.0);
    for side in SIDES {
        expected.add(&flux.inflow[side], 1.0);
        expected.add(&flux.outflow[side], -1.0);
    }
    let mut residual = after.clone();
    residual.add(&expected, -1.0);
    let mut closed = true;
    let mut worst: f64 = 0.0;
    let check = |b: f64, a: f64, e: f64, r: f64, closed: &mut bool, worst: &mut f64| {
        let scale = b.abs().max(a.abs()).max(e.abs());
        *closed &= r.is_finite() && r.abs() <= 1e-6 + 1e-10 * scale;
        *worst = worst.max(r.abs() / scale.max(1.0));
    };
    for (b, a, e, r) in [
        (before.total, after.total, expected.total, residual.total),
        (before.sand, after.sand, expected.sand, residual.sand),
        (before.shale, after.shale, expected.shale, residual.shale),
        (
            before.carbonate,
            after.carbonate,
            expected.carbonate,
            residual.carbonate,
        ),
    ] {
        check(b, a, e, r, &mut closed, &mut worst)
    }
    for (b, a, e, r) in [
        (
            &before.by_bed,
            &after.by_bed,
            &expected.by_bed,
            &residual.by_bed,
        ),
        (
            &before.by_bed_components.sand,
            &after.by_bed_components.sand,
            &expected.by_bed_components.sand,
            &residual.by_bed_components.sand,
        ),
        (
            &before.by_bed_components.shale,
            &after.by_bed_components.shale,
            &expected.by_bed_components.shale,
            &residual.by_bed_components.shale,
        ),
        (
            &before.by_bed_components.carbonate,
            &after.by_bed_components.carbonate,
            &expected.by_bed_components.carbonate,
            &residual.by_bed_components.carbonate,
        ),
    ] {
        for (i, r) in r.iter().enumerate() {
            check(
                *b.get(i).unwrap_or(&0.0),
                *a.get(i).unwrap_or(&0.0),
                *e.get(i).unwrap_or(&0.0),
                *r,
                &mut closed,
                &mut worst,
            )
        }
    }
    (residual, closed, worst)
}
impl Entry {
    pub fn new(
        step: usize,
        process: &str,
        fault: Option<usize>,
        before: Inventory,
        after: Inventory,
        flux: Flux,
    ) -> Self {
        let (residual, closed, worst_normalized_residual) = assessed(&before, &after, &flux);
        Self {
            surfaces: vec![],
            step,
            process: process.into(),
            fault,
            before,
            after,
            flux,
            residual,
            closed,
            worst_normalized_residual,
        }
    }
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessSummary {
    pub events: usize,
    pub failed: usize,
    pub signed_residual: Inventory,
    pub absolute_residual: Inventory,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub events: usize,
    pub failed_events: usize,
    pub closed: bool,
    pub initial: Inventory,
    pub r#final: Inventory,
    pub flux: Flux,
    pub residual: Inventory,
    pub absolute_event_residual: Inventory,
    pub max_event_residual: f64,
    pub max_normalized_event_residual: f64,
    pub by_process: BTreeMap<String, ProcessSummary>,
}
pub fn summarize(entries: &[Entry], initial: &Inventory, final_state: &Inventory) -> Summary {
    let mut flux = Flux::default();
    let mut absolute_event_residual = Inventory::default();
    let mut by_process: BTreeMap<String, ProcessSummary> = BTreeMap::new();
    let mut failed_events = 0;
    let mut max_event_residual: f64 = 0.0;
    let mut max_normalized_event_residual: f64 = 0.0;
    for e in entries {
        flux.add(&e.flux);
        let absolute = e.residual.absolute();
        absolute_event_residual.add(&absolute, 1.0);
        let p = by_process.entry(e.process.clone()).or_default();
        p.events += 1;
        p.failed += usize::from(!e.closed);
        p.signed_residual.add(&e.residual, 1.0);
        p.absolute_residual.add(&absolute, 1.0);
        failed_events += usize::from(!e.closed);
        for x in absolute.values() {
            max_event_residual = max_event_residual.max(x)
        }
        max_normalized_event_residual =
            max_normalized_event_residual.max(e.worst_normalized_residual);
    }
    let (residual, closed, _) = assessed(initial, final_state, &flux);
    Summary {
        events: entries.len(),
        failed_events,
        closed: failed_events == 0 && closed,
        initial: initial.clone(),
        r#final: final_state.clone(),
        flux,
        residual,
        absolute_event_residual,
        max_event_residual,
        max_normalized_event_residual,
        by_process,
    }
}
pub fn outside(i: i32, k: i32, nx: usize, nz: usize) -> Option<&'static str> {
    if i < 0 {
        Some("left")
    } else if i >= nx as i32 {
        Some("right")
    } else if k < 0 {
        Some("top")
    } else if k >= nz as i32 {
        Some("bottom")
    } else {
        None
    }
}
