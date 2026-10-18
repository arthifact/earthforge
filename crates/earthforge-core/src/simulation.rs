use crate::{
    budget::{self, Entry, Flux, Inventory, Summary},
    deformation,
    geometry::{self, Fault, V},
    material::{self, BASEMENT, Bed, Column, Layer, WATER},
    raster,
};
use num_traits::Zero;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Options {
    pub seed: f64,
    pub h: f64,
    pub setting: String,
    pub faults: [usize; 2],
    pub thrusts: [usize; 2],
    pub overpressure: f64,
    pub carbonate: f64,
    pub exhumation: f64,
    pub compaction: bool,
    pub record: bool,
    pub quiet: bool,
}
impl Default for Options {
    fn default() -> Self {
        Self {
            seed: 1.0,
            h: 20.0,
            setting: "any".into(),
            faults: [2, 4],
            thrusts: [1, 3],
            overpressure: 0.35,
            carbonate: 0.1,
            exhumation: 0.0,
            compaction: true,
            record: false,
            quiet: false,
        }
    }
}
impl Options {
    fn validate(&self) -> Result<(), String> {
        if !self.seed.is_finite()
            || !self.h.is_finite()
            || self.h <= 0.0
            || self.h > 500.0
            || !["any", "extension", "compression"].contains(&self.setting.as_str())
            || self.faults[0] > self.faults[1]
            || self.thrusts[0] > self.thrusts[1]
            || self.faults[1] > 32
            || self.thrusts[1] > 32
            || [self.overpressure, self.carbonate, self.exhumation]
                .iter()
                .any(|p| !p.is_finite() || *p < 0.0 || *p > 1.0)
        {
            return Err("Invalid simulation options".into());
        }
        let cells = ((13200.0 / self.h).round() + 1.0) * ((4500.0 / self.h).round() + 1.0);
        if cells > 10_000_000.0 {
            return Err("Simulation exceeds configured cell limit".into());
        }
        Ok(())
    }
}
#[derive(Clone)]
struct Rng {
    a: u32,
}
impl Rng {
    fn new(seed: f64) -> Self {
        Self {
            a: seed.rem_euclid(4294967296.0) as u32,
        }
    }
    fn next(&mut self) -> f64 {
        self.a = self.a.wrapping_add(0x6d2b79f5);
        let mut t = self.a;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        (t ^ (t >> 14)) as f64 / 4294967296.0
    }
    fn uniform(&mut self, a: f64, b: f64) -> f64 {
        a + (b - a) * self.next()
    }
    fn int(&mut self, a: usize, b: usize) -> usize {
        self.uniform(a as f64, (b + 1) as f64).floor() as usize
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Exhumation {
    pub start: usize,
    pub steps: usize,
    pub amount: f64,
    pub tilt: f64,
}
#[derive(Clone, Debug, Serialize)]
pub struct NormalPlan {
    pub x: f64,
    pub dir: i32,
    pub start: usize,
    pub end: usize,
    pub dip: f64,
    pub detachment: f64,
    pub heaves: Vec<f64>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThrustPlan {
    pub x1: f64,
    pub transport: i32,
    pub start: usize,
    pub end: usize,
    pub dip: f64,
    pub slips: Vec<f64>,
    pub emergent: bool,
    pub zd_frac: f64,
    pub zu_frac: f64,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Forcing {
    pub step: usize,
    pub water_depth: f64,
    pub fill: f64,
    pub drape: f64,
    pub subsidence: Vec<f64>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct History {
    pub dt: f64,
    pub phases: [usize; 3],
    pub water_depth: f64,
    pub basin_slope: f64,
    pub overpressure: Option<f64>,
    pub basement_velocity: f64,
    pub normal_faults: Vec<NormalPlan>,
    pub thrusts: Vec<ThrustPlan>,
    pub beds: Vec<Bed>,
    pub exhumation: Option<Exhumation>,
    pub forcing: Vec<Forcing>,
}
struct Plan {
    rng: Rng,
    setting: String,
    names: [String; 3],
    history: History,
    subs: [[f64; 5]; 3],
    shore: f64,
    advance: f64,
    transport: i32,
}
fn plan(o: &Options) -> Plan {
    let mut rng = Rng::new(o.seed * 2654435761.0 + 12345.0);
    let setting = if o.setting == "any" {
        if Rng::new(o.seed * 7919.0 + 101.0).next() < 0.5 {
            "extension"
        } else {
            "compression"
        }
    } else {
        &o.setting
    }
    .to_string();
    let names = if setting == "extension" {
        ["pre-rift", "syn-rift", "post-rift"]
    } else {
        ["pre-thrust", "syn-thrust", "post-thrust"]
    }
    .map(String::from);
    let wd0 = rng.uniform(30.0, 150.0);
    let dt = rng.uniform(0.5, 2.0);
    let (n_pre, n_syn, mut n_post);
    let mut normal_faults = vec![];
    let mut thrusts = vec![];
    let mut subs = [[0.0; 5]; 3];
    let mut shore = 0.0;
    let mut advance = 0.0;
    let mut transport = 1;
    if setting == "extension" {
        n_pre = rng.int(2, 4);
        n_syn = rng.int(8, 16);
        n_post = rng.int(3, 8);
        let n = rng.int(o.faults[0], o.faults[1]);
        let mut xs = vec![];
        for _ in 0..500 {
            if xs.len() >= n {
                break;
            }
            let x = rng.uniform(0.08 * 9200.0, 0.92 * 9200.0);
            if xs.iter().all(|y: &f64| (y - x).abs() > 900.0) {
                xs.push(x)
            }
        }
        xs.sort_by(f64::total_cmp);
        let count = xs.len();
        for (r, x) in xs.into_iter().enumerate() {
            let start = n_pre
                + ((r as f64 / count.max(1) as f64 * 0.6 * n_syn as f64).floor() as usize
                    + rng.int(0, 1))
                .min(n_syn - 2);
            let end = (start + rng.int(transport::round(0.4 * n_syn as f64) as usize, n_syn))
                .min(n_pre + n_syn - 1);
            let n = end - start + 1;
            let mean = rng.uniform(25.0, 80.0);
            let shape: Vec<_> = (0..n)
                .map(|j| crate::math::sin(std::f64::consts::PI * (j as f64 + 0.5) / n as f64))
                .collect();
            let sum = shape.iter().sum::<f64>();
            let dir = if rng.next() < 0.75 { 1 } else { -1 };
            let dip = rng.uniform(45.0, 70.0) * std::f64::consts::PI / 180.0;
            let detachment = rng.uniform(2500.0, 5000.0);
            let heaves = shape
                .iter()
                .map(|s| mean * n as f64 * s / sum * rng.uniform(0.8, 1.2))
                .collect();
            normal_faults.push(NormalPlan {
                x,
                dir,
                start,
                end,
                dip,
                detachment,
                heaves,
            });
        }
        subs[0] = [
            rng.uniform(150.0, 350.0),
            rng.uniform(-0.3, 0.3),
            0.0,
            1.0,
            0.0,
        ];
        subs[1] = [
            rng.uniform(80.0, 220.0),
            rng.uniform(0.0, 0.8),
            rng.uniform(0.0, 40.0) * if o.quiet { 0.0 } else { 1.0 },
            rng.uniform(3000.0, 9000.0),
            rng.uniform(0.0, 2.0 * std::f64::consts::PI),
        ];
        subs[2] = [
            rng.uniform(60.0, 160.0),
            rng.uniform(0.0, 0.5),
            rng.uniform(0.0, 25.0) * if o.quiet { 0.0 } else { 1.0 },
            rng.uniform(4000.0, 10000.0),
            rng.uniform(0.0, 2.0 * std::f64::consts::PI),
        ];
        shore = rng.uniform(0.1, 0.4) * 9200.0;
        advance = rng.uniform(200.0, 700.0);
    } else {
        transport = if rng.next() < 0.5 { 1 } else { -1 };
        let n_t = rng.int(o.thrusts[0], o.thrusts[1]);
        n_pre = rng.int(4, 8);
        n_syn = rng.int(6.max(2 * n_t), 12.max(2 * n_t));
        n_post = rng.int(2, 5);
        let mut xs = vec![];
        for _ in 0..500 {
            if xs.len() >= n_t {
                break;
            }
            let x = rng.uniform(-0.1 * 9200.0, 0.55 * 9200.0);
            if xs.iter().all(|y: &f64| (y - x).abs() > 2000.0) {
                xs.push(x)
            }
        }
        xs.sort_by(f64::total_cmp);
        let per = n_syn / xs.len().max(1);
        let extra = n_syn - per * xs.len().max(1);
        let mut at = n_pre;
        for (r, xi) in xs.into_iter().enumerate() {
            let n = per + usize::from(r < extra);
            let start = at;
            let end = at + n - 1;
            at += n;
            let total = rng.uniform(600.0, 2400.0);
            let shape: Vec<_> = (0..n)
                .map(|j| crate::math::sin(std::f64::consts::PI * (j as f64 + 0.5) / n as f64))
                .collect();
            let sum = shape.iter().sum::<f64>();
            let dip = rng.uniform(18.0, 32.0) * std::f64::consts::PI / 180.0;
            let slips = shape.iter().map(|s| total * s / sum).collect();
            thrusts.push(ThrustPlan {
                x1: if transport > 0 { xi } else { 9200.0 - xi },
                transport,
                start,
                end,
                dip,
                slips,
                emergent: rng.next() < 0.5,
                zd_frac: rng.uniform(0.6, 0.92),
                zu_frac: rng.uniform(0.3, 0.55),
            });
        }
        subs[0] = [
            rng.uniform(120.0, 300.0),
            if o.quiet { 0.0 } else { rng.uniform(-0.2, 0.2) },
            0.0,
            1.0,
            0.0,
        ];
        subs[1] = [
            rng.uniform(60.0, 200.0),
            if o.quiet { 0.0 } else { rng.uniform(0.0, 0.8) },
            0.0,
            1.0,
            0.0,
        ];
        subs[2] = [
            rng.uniform(30.0, 120.0),
            if o.quiet { 0.0 } else { rng.uniform(0.0, 0.4) },
            0.0,
            1.0,
            0.0,
        ];
    }
    let mut exhumation = None;
    if o.exhumation > 0.0 {
        let mut r = Rng::new(o.seed * 48271.0 + 7.0);
        if r.next() < o.exhumation {
            let steps = r.uniform(2.0, 5.0).floor() as usize;
            let amount = r.uniform(300.0, 1500.0);
            let tilt = r.uniform(0.0, 0.6) * if r.next() < 0.5 { 1.0 } else { -1.0 };
            exhumation = Some(Exhumation {
                start: n_pre + n_syn + n_post,
                steps,
                amount,
                tilt,
            });
            n_post += steps + 1;
        }
    }
    let basin_slope = rng.uniform(0.0, 150.0);
    let basement_velocity = rng.uniform(4800.0, 5500.0);
    let overpressure = if rng.next() < o.overpressure {
        Some(rng.uniform(1500.0, 2500.0))
    } else {
        None
    };
    Plan {
        rng,
        setting,
        names,
        history: History {
            dt,
            phases: [n_pre, n_syn, n_post],
            water_depth: wd0,
            basin_slope,
            overpressure,
            basement_velocity,
            normal_faults,
            thrusts,
            beds: vec![],
            exhumation,
            forcing: vec![],
        },
        subs,
        shore,
        advance,
        transport,
    }
}
use crate::transport;
impl Plan {
    fn displacement(&self, stage: usize, k: usize, x: f64) -> f64 {
        let p = self.subs[stage];
        let xn = x / 9200.0 - 0.5;
        if self.setting == "extension" {
            let s = if stage == 2 {
                p[0] * crate::math::exp(-(k as f64) * self.history.dt / 62.8)
            } else {
                p[0]
            };
            s * (1.0 + p[1] * xn)
                + p[2] * crate::math::sin(2.0 * std::f64::consts::PI * x / p[3] + p[4])
        } else {
            p[0] * (1.0
                + if stage == 0 {
                    p[1] * xn
                } else {
                    -(self.transport as f64) * p[1] * xn
                })
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Line {
    pub x: Vec<f64>,
    pub z: Vec<f64>,
}
fn lines(faults: &[Fault]) -> Vec<Line> {
    faults
        .iter()
        .flat_map(|f| match &f.trace {
            Some(t) => t
                .iter()
                .map(|[a, b]| Line {
                    x: vec![a[0], b[0]],
                    z: vec![a[1], b[1]],
                })
                .collect(),
            None => vec![Line {
                x: f.x.clone(),
                z: f.z.clone(),
            }],
        })
        .collect()
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Frame {
    pub nx: usize,
    pub nz: usize,
    pub velocity: Vec<f32>,
    pub beds: Vec<i32>,
    pub litho: Vec<f32>,
    pub faults: Vec<Line>,
}
fn frame(
    columns: &[Column],
    h: f64,
    beds: &[Bed],
    pressure: Option<f64>,
    basement: f64,
    faults: &[Fault],
) -> Result<Frame, String> {
    let w = raster::window(columns, h, beds, pressure, basement, 20.0)?;
    let litho = w
        .beds
        .iter()
        .enumerate()
        .map(|(n, id)| {
            if *id < 0 {
                *id as f32
            } else if beds[*id as usize].carbonate {
                -3.0
            } else {
                w.sand_fraction[n]
            }
        })
        .collect();
    Ok(Frame {
        nx: w.nx,
        nz: w.nz,
        velocity: w.velocity,
        beds: w.beds,
        litho,
        faults: lines(faults),
    })
}
#[derive(Clone, Debug, Serialize)]
pub struct Log {
    pub step: usize,
    pub phase: String,
    pub text: String,
    pub subsidence: f64,
    pub deposited: f64,
    pub shift: f64,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FaultInfo {
    pub kind: String,
    pub dir: i32,
    pub dip: f64,
    pub heave: f64,
    pub emergent: bool,
    pub transport: i32,
}
#[derive(Clone, Debug, Serialize)]
pub struct Checks {
    pub trapped: usize,
    pub collapsed: f64,
    pub area: f64,
    pub seconds: f64,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Section {
    pub seed: f64,
    pub setting: String,
    pub options: Options,
    pub unit_of_bed: Vec<i32>,
    pub faults: Vec<FaultInfo>,
    pub log: Vec<Log>,
    pub overpressure: Option<f64>,
    pub basement_velocity: f64,
    pub dt: f64,
    pub exhumation: Option<Exhumation>,
    pub budget: Summary,
    pub checks: Checks,
    pub now: Frame,
    pub history: Vec<Frame>,
    pub engine: String,
}
pub struct Simulation {
    pub columns: Vec<Column>,
    pub beds: Vec<Bed>,
    pub faults: Vec<Fault>,
    pub history_plan: History,
    pub entries: Vec<Entry>,
    pub section: Section,
    pub nx: usize,
    pub nz: usize,
    pub pre: Vec<i32>,
    pub deposited: Vec<f64>,
    pub slips: Vec<serde_json::Value>,
    pub transport: Vec<serde_json::Value>,
}
// Preserve the reference operation boundary during migration.
#[allow(clippy::too_many_arguments)]
fn account(
    entries: &mut Vec<Entry>,
    previous: &mut Inventory,
    columns: &[Column],
    beds: &[Bed],
    h: f64,
    step: usize,
    process: &str,
    flux: Flux,
    fault: Option<usize>,
) -> Result<(), String> {
    let after = budget::inventory(columns, beds, h);
    let mut entry = Entry::new(step, process, fault, previous.clone(), after.clone(), flux);
    entry.surfaces = columns.iter().map(material::surface).collect();
    if !entry.closed {
        return Err(format!(
            "Grain budget failed at step {step}, process {process}"
        ));
    }
    entries.push(entry);
    *previous = after;
    Ok(())
}
fn map_markers(faults: &mut [Fault], nx: usize, h: f64, maps: &[Box<dyn Fn(f64) -> f64>]) {
    for f in faults {
        for (i, z) in f.depth.iter_mut().enumerate() {
            if z.is_finite() {
                *z = maps[i](*z)
            }
        }
        let map = |p: &mut V| {
            let q = ((p[0] + 2000.0) / h).clamp(0.0, (nx - 1) as f64);
            let i = q.floor() as usize;
            let j = (i + 1).min(nx - 1);
            let weight = q - i as f64;
            p[1] = (1.0 - weight) * maps[i](p[1]) + weight * maps[j](p[1]);
        };
        for p in &mut f.points {
            map(p)
        }
        if let Some(trace) = &mut f.trace {
            for p in trace.iter_mut().flatten() {
                map(p)
            }
        }
        f.sync(h, nx);
    }
}
fn carry(
    faults: &mut [Fault],
    active: usize,
    depth: &[f64],
    h: f64,
    nx: usize,
    move_point: &dyn Fn(V) -> Result<Option<V>, String>,
    flow: Option<(&geometry::Flow, f64)>,
) -> Result<(), String> {
    let active_kind = faults[active].kind.clone();
    for (index, g) in faults.iter_mut().enumerate() {
        if index == active {
            continue;
        }
        if let Some((flow, s)) = flow
            && g.kind == "thrust"
        {
            let segments = g
                .trace
                .clone()
                .unwrap_or_else(|| geometry::trace_from_depth(&g.depth, h));
            g.trace = Some(geometry::transport_trace(&segments, flow, s)?);
            g.points.clear();
            g.sync(h, nx);
            continue;
        }
        let mut sum = vec![0.0; nx];
        let mut count = vec![0usize; nx];
        let mut moved_any = false;
        for (i, d) in g.depth.iter().enumerate() {
            if !d.is_finite() {
                continue;
            }
            let (mut c, mut nd) = (i as i32, *d);
            if depth[i].is_finite()
                && *d
                    < depth[i]
                        - if active_kind == "thrust" {
                            h / 2.0
                        } else {
                            0.0
                        }
            {
                let Some(p) = move_point([-2000.0 + i as f64 * h, *d])? else {
                    continue;
                };
                c = transport::round((p[0] + 2000.0) / h) as i32;
                nd = p[1];
                moved_any = true;
            }
            if c >= 0 && (c as usize) < nx {
                sum[c as usize] += nd;
                count[c as usize] += 1;
            }
        }
        if !moved_any {
            continue;
        }
        let mut next = vec![f64::NAN; nx];
        let first = count.iter().position(|c| *c > 0);
        let last = count.iter().rposition(|c| *c > 0);
        let (Some(first), Some(last)) = (first, last) else {
            g.depth = next;
            g.sync(h, nx);
            continue;
        };
        for i in 0..nx {
            if count[i] > 0 {
                next[i] = sum[i] / count[i] as f64
            }
        }
        for i in first + 1..last {
            if count[i] == 0 {
                let mut a = i - 1;
                while count[a] == 0 {
                    a -= 1
                }
                let mut b = i + 1;
                while count[b] == 0 {
                    b += 1
                }
                next[i] = next[a] + (next[b] - next[a]) * (i - a) as f64 / (b - a) as f64;
            }
        }
        if g.kind == "normal" {
            if g.dir > 0 {
                for i in last + 1..nx {
                    next[i] = next[last]
                }
                g.top = first;
            } else {
                for i in 0..first {
                    next[i] = next[first]
                }
                g.top = last;
            }
        }
        g.depth = next;
        g.sync(h, nx);
    }
    Ok(())
}
#[allow(clippy::needless_range_loop)]
pub fn simulate(o: Options) -> Result<Simulation, String> {
    o.validate()?;
    #[cfg(not(target_arch = "wasm32"))]
    let started = std::time::Instant::now();
    let mut plan = plan(&o);
    let h = o.h;
    let nx = transport::round(13200.0 / h) as usize + 1;
    let nz = transport::round(4500.0 / h) as usize + 1;
    let end = nz as f64 * h;
    let x = |i: usize| -2000.0 + i as f64 * h;
    let col = |x: f64| transport::round((x + 2000.0) / h).clamp(0.0, (nx - 1) as f64) as usize;
    let mut columns = vec![
        vec![
            Layer::empty(WATER, plan.history.water_depth),
            Layer::empty(BASEMENT, end - plan.history.water_depth)
        ];
        nx
    ];
    let mut faults: Vec<Fault> = vec![];
    let mut beds = vec![];
    let mut log = vec![];
    let mut snapshots = vec![];
    let mut entries = vec![];
    let mut pre = vec![];
    let mut deposited: Vec<f64> = vec![];
    let mut slips = vec![];
    let mut transport_diagnostics = vec![];
    let initial = budget::inventory(&columns, &beds, h);
    let mut previous = initial.clone();
    let mut area_error: f64 = 0.0;
    let mut collapsed = 0.0;
    let total = plan.history.phases.iter().sum::<usize>();
    let pressure = plan.history.overpressure;
    for step in 0..total {
        let stage = if step < plan.history.phases[0] {
            0
        } else if step < plan.history.phases[0] + plan.history.phases[1] {
            1
        } else {
            2
        };
        let phase = plan.names[stage].clone();
        let k0 = step
            - if stage == 0 {
                0
            } else if stage == 1 {
                plan.history.phases[0]
            } else {
                plan.history.phases[0] + plan.history.phases[1]
            };
        let uplift = plan
            .history
            .exhumation
            .clone()
            .filter(|e| step >= e.start && step < e.start + e.steps);
        let k = if plan
            .history
            .exhumation
            .as_ref()
            .is_some_and(|e| step >= e.start + e.steps)
        {
            k0 - plan.history.exhumation.as_ref().unwrap().steps
        } else {
            k0
        };
        let displacement = |x: f64| {
            if let Some(e) = &uplift {
                -e.amount / e.steps as f64 * (1.0 + e.tilt * (x / 9200.0 - 0.5))
            } else {
                plan.displacement(stage, k, x)
            }
        };
        let shifts: Vec<_> = (0..nx).map(|i| displacement(x(i))).collect();
        let mean_subsidence =
            (displacement(0.0) + displacement(4600.0) + displacement(9200.0)) / 3.0;
        let shift = shifts[0] / h;
        let mut flux = Flux::default();
        for i in 0..nx {
            let moved = deformation::subside(&columns[i], x(i), end, &displacement)?;
            if shifts[i] < 0.0 {
                flux.eroded.column(&moved.out_top, &beds, h)
            } else {
                flux.outflow
                    .get_mut("top")
                    .unwrap()
                    .column(&moved.out_top, &beds, h)
            }
            flux.outflow
                .get_mut("bottom")
                .unwrap()
                .column(&moved.out_bottom, &beds, h);
            flux.inflow
                .get_mut("bottom")
                .unwrap()
                .column(&moved.in_bottom, &beds, h);
            columns[i] = moved.column;
        }
        for f in &mut faults {
            for (i, z) in f.depth.iter_mut().enumerate() {
                if z.is_finite() {
                    *z += shifts[i]
                }
            }
            for p in &mut f.points {
                p[1] += displacement(p[0]);
            }
            if let Some(trace) = &mut f.trace {
                for p in trace.iter_mut().flatten() {
                    p[1] += displacement(p[0]);
                }
            }
            f.sync(h, nx);
        }
        account(
            &mut entries,
            &mut previous,
            &columns,
            &beds,
            h,
            step,
            "subsidence",
            flux,
            None,
        )?;
        let mut description = vec![if uplift.is_some() {
            format!(
                "uplifted {:.0}–{:.0} m",
                -displacement(0.0),
                -displacement(9200.0)
            )
        } else {
            format!(
                "subsided {:.0}–{:.0} m",
                displacement(0.0),
                displacement(9200.0)
            )
        }];
        let mut numerical: BTreeMap<usize, Vec<(f64, f64)>> = BTreeMap::new();
        if plan.setting == "extension" {
            for p in &plan.history.normal_faults {
                if p.start == step {
                    let (top, depth) =
                        geometry::normal_depth(nx, h, p.x, p.dir, p.dip, p.detachment);
                    let mut f = Fault {
                        kind: "normal".into(),
                        dir: p.dir,
                        depth,
                        top,
                        x: vec![],
                        z: vec![],
                        dip: p.dip,
                        detachment: p.detachment,
                        start: p.start,
                        end: p.end,
                        heave: 0.0,
                        heaves: vec![],
                        remainder: 0.0,
                        trace: None,
                        points: vec![],
                        transport: 1,
                        emergent: false,
                        carry: vec![],
                    };
                    f.sync(h, nx);
                    faults.push(f);
                }
            }
            for index in 0..faults.len() {
                if step < faults[index].start || step > faults[index].end {
                    continue;
                }
                let f = &mut faults[index];
                let z = f.depth[f.top];
                let old_top = f.top;
                if z > 0.0 {
                    let mut j = 1;
                    loop {
                        let i = old_top as i32 - f.dir * j;
                        if i < 0 || i >= nx as i32 {
                            break;
                        }
                        f.depth[i as usize] = z - j as f64 * h * crate::math::tan(f.dip);
                        f.top = i as usize;
                        if f.depth[i as usize] <= 0.0 {
                            break;
                        }
                        j += 1;
                    }
                }
                f.sync(h, nx);
                let asked = plan.history.normal_faults[index].heaves[step - f.start];
                let carried = f.remainder + asked / h;
                let cells = transport::round(carried) as i32;
                let heave = cells as f64 * h;
                f.remainder = carried - cells as f64;
                let depth = f.depth.clone();
                let dir = f.dir;
                let moved = deformation::normal(&columns, &depth, cells, dir, h, end, &beds)?;
                columns = moved.columns;
                area_error = area_error.max(moved.area_error);
                slips.push(serde_json::json!({"step":step,"fault":index,"kind":"normal","error":moved.area_error}));
                carry(
                    &mut faults,
                    index,
                    &depth,
                    h,
                    nx,
                    &|p| {
                        let i = col(p[0]);
                        let c = i as i32 + dir * cells;
                        let zn = if c >= 0 && c < nx as i32 {
                            depth[c as usize]
                        } else {
                            f64::NAN
                        };
                        Ok(Some([
                            -2000.0 + c as f64 * h,
                            p[1] + if zn.is_finite() { zn - depth[i] } else { 0.0 },
                        ]))
                    },
                    None,
                )?;
                let f = &mut faults[index];
                f.heave += heave;
                f.heaves.push(heave);
                f.sync(h, nx);
                description.push(format!("fault {} slips {:.0} m", index + 1, heave));
                account(
                    &mut entries,
                    &mut previous,
                    &columns,
                    &beds,
                    h,
                    step,
                    "normal-slip",
                    moved.flux,
                    Some(index),
                )?;
            }
        } else {
            for p in &plan.history.thrusts {
                if p.start == step {
                    let x1 = p.x1.clamp(x(1), x(nx - 2));
                    let floors: Vec<_> = columns.iter().map(material::surface).collect();
                    let basement: Vec<_> = columns
                        .iter()
                        .map(|c| {
                            c.iter()
                                .take_while(|p| p.bed != BASEMENT)
                                .map(|p| p.height)
                                .sum()
                        })
                        .collect();
                    let floor = geometry::sample(x1, h, &floors);
                    let basement = geometry::sample(x1, h, &basement);
                    let zd = (floor + p.zd_frac * (basement - floor)).min(4300.0);
                    let zu = floor + p.zu_frac * (zd - floor);
                    let xs: Vec<_> = (0..nx).map(x).collect();
                    let points = geometry::thrust_geometry(
                        x1,
                        p.transport,
                        p.dip,
                        zd,
                        zu,
                        &xs,
                        &floors,
                        h,
                        p.emergent,
                    );
                    let depth = xs
                        .iter()
                        .map(|x| geometry::poly_depth(&points, *x))
                        .collect();
                    let top = col(points[2][0]);
                    let mut f = Fault {
                        kind: "thrust".into(),
                        dir: -p.transport,
                        depth,
                        top,
                        x: vec![],
                        z: vec![],
                        dip: p.dip,
                        detachment: zd,
                        start: p.start,
                        end: p.end,
                        heave: 0.0,
                        heaves: vec![],
                        remainder: 0.0,
                        trace: None,
                        points,
                        transport: p.transport,
                        emergent: p.emergent,
                        carry: vec![0.0; 3],
                    };
                    f.sync(h, nx);
                    faults.push(f);
                }
            }
            for index in 0..faults.len() {
                if step < faults[index].start || step > faults[index].end {
                    continue;
                }
                let f = &faults[index];
                if f.trace.is_some() {
                    return Err("Cut passive thrust cannot reactivate".into());
                }
                let s = plan.history.thrusts[index].slips[step - f.start];
                let state = raster::rasterize(&columns, nz, h)?;
                let moved =
                    deformation::thrust(&state, nx, nz, h, &beds, f.points.clone(), s, &f.carry)?;
                columns = moved.columns;
                area_error = area_error.max(moved.area_error);
                slips.push(serde_json::json!({"step":step,"fault":index,"kind":"thrust","error":moved.area_error}));
                let mut placement =
                    serde_json::to_value(&moved.placement).map_err(|e| e.to_string())?;
                placement["step"] = serde_json::json!(step);
                placement["fault"] = serde_json::json!(index);
                transport_diagnostics.push(placement);
                numerical = moved.numerical;
                faults[index].depth = moved.depth.clone();
                faults[index].carry = moved.carry;
                carry(
                    &mut faults,
                    index,
                    &moved.depth,
                    h,
                    nx,
                    &|p| {
                        let q = moved.flow.moved(p, s)?;
                        let j = moved.flow.domain(q);
                        Ok(Some([q[0] - moved.corr[j][0], q[1] - moved.corr[j][1]]))
                    },
                    Some((&moved.flow, s)),
                )?;
                let f = &mut faults[index];
                f.heave += s;
                f.heaves.push(s);
                f.sync(h, nx);
                description.push(format!("thrust {} slips {:.0} m", index + 1, s));
                account(
                    &mut entries,
                    &mut previous,
                    &columns,
                    &beds,
                    h,
                    step,
                    "thrust-slip",
                    moved.flux,
                    Some(index),
                )?;
            }
        }
        let mut maps: Vec<Box<dyn Fn(f64) -> f64>> = Vec::with_capacity(nx);
        for i in 0..nx {
            let intervals: Vec<_> = numerical
                .iter()
                .filter(|(n, _)| **n % nx == i)
                .flat_map(|(n, ranges)| {
                    ranges
                        .iter()
                        .map(move |(a, b)| ((*n / nx) as f64 * h + a, (*n / nx) as f64 * h + b))
                })
                .collect();
            let result = material::pack(&columns[i], &intervals)?;
            collapsed += result.gaps / h;
            let water = result.water;
            columns[i] = result.column;
            maps.push(Box::new(move |d| {
                let total = d + water
                    .iter()
                    .map(|(lo, hi)| (hi - lo.max(d)).max(0.0))
                    .sum::<f64>();
                total
                    - water
                        .iter()
                        .map(|(lo, hi)| {
                            if *hi > d {
                                let lo = lo.max(d);
                                intervals
                                    .iter()
                                    .map(|(a, b)| (hi.min(*b) - lo.max(*a)).max(0.0))
                                    .sum::<f64>()
                            } else {
                                0.0
                            }
                        })
                        .sum::<f64>()
            }));
        }
        map_markers(&mut faults, nx, h, &maps);
        account(
            &mut entries,
            &mut previous,
            &columns,
            &beds,
            h,
            step,
            "collapse",
            Flux::default(),
            None,
        )?;
        let low_draw = plan.rng.next() < 0.2;
        let lowstand = (low_draw || uplift.is_some()) && !o.quiet;
        let wd = if lowstand {
            plan.rng.uniform(0.0, 40.0)
        } else {
            plan.rng.uniform(30.0, 300.0)
        };
        let wave_base = if o.quiet { 0.0 } else { wd - 30.0 };
        let mut flux = Flux::default();
        if wave_base > 0.0 {
            for c in &mut columns {
                let removed = material::slice(c, &[0.0], &[wave_base])?;
                flux.eroded.column(&removed, &beds, h);
                let mut next = vec![Layer::empty(WATER, wave_base)];
                next.extend(material::slice(c, &[wave_base], &[end])?);
                *c = next;
            }
        }
        account(
            &mut entries,
            &mut previous,
            &columns,
            &beds,
            h,
            step,
            "erosion",
            flux,
            None,
        )?;
        let n_beds = plan.rng.int(2, 6);
        let fill = if stage == 0 {
            1.0
        } else {
            plan.rng.uniform(0.75, 1.0)
        };
        let drape = plan.rng.uniform(5.0, 20.0);
        let first = beds.len();
        let carb = plan.rng.next() < o.carbonate * if stage == 0 { 1.5 } else { 0.6 };
        let a0 = plan.rng.uniform(0.15, 0.6);
        for b in 0..n_beds {
            let alt = if b % 2 == 1 { 1.0 } else { -1.0 }
                * plan.rng.uniform(0.05, if stage == 1 { 0.3 } else { 0.15 });
            let (a, bc, c, d, carbonate) = if plan.setting == "extension" && stage == 2 {
                (
                    0.45 + alt,
                    -0.35,
                    plan.shore + k as f64 * plan.advance,
                    plan.rng.uniform(800.0, 2000.0),
                    carb && b == 0,
                )
            } else {
                (
                    a0 + alt,
                    if stage == 1 {
                        plan.rng.uniform(-0.3, 0.3)
                    } else if stage == 2 {
                        plan.rng.uniform(-0.2, 0.2)
                    } else {
                        0.0
                    },
                    plan.rng.uniform(0.0, 9200.0),
                    plan.rng.uniform(1500.0, 4000.0),
                    carb,
                )
            };
            beds.push(Bed {
                unit: step,
                phase: phase.clone(),
                a,
                b: bc,
                c,
                d,
                carbonate,
            });
            deposited.push(0.0);
        }
        let forcing_subsidence = (0..34)
            .map(|j| {
                let x = -2000.0 + j as f64 * 400.0;
                if let Some(e) = &uplift {
                    -e.amount / e.steps as f64 * (1.0 + e.tilt * (x / 9200.0 - 0.5))
                } else {
                    plan.displacement(stage, k, x)
                }
            })
            .collect();
        plan.history.forcing.push(Forcing {
            step,
            water_depth: wd,
            fill,
            drape,
            subsidence: forcing_subsidence,
        });
        let mut flux = Flux::default();
        let mut thickest: f64 = 0.0;
        for i in 0..nx {
            let z_top = material::surface(&columns[i]);
            let z_base = wd + plan.history.basin_slope * (x(i) / 9200.0);
            let thick = (z_top - z_base).max(0.0) * fill + drape;
            let z_new = z_top - thick;
            if x(i) >= 0.0 && x(i) <= 9200.0 {
                thickest = thickest.max(thick)
            }
            let water: Vec<_> = columns[i]
                .iter()
                .take_while(|p| p.bed == WATER)
                .flat_map(|p| p.lengths().iter().copied())
                .collect();
            let boundaries: Vec<_> = (0..=n_beds)
                .map(|j| (z_new + j as f64 * thick / n_beds as f64).max(0.0))
                .collect();
            let s = crate::exact::Scale::new(water.iter().chain(&boundaries).copied())?;
            let old_top = s.sum(water.iter().copied())?;
            let new_top = s.units(z_new.max(0.0))?.min(old_top.clone());
            let mut cuts: Vec<_> = boundaries
                .iter()
                .map(|z| Ok(s.units(*z)?.max(new_top.clone()).min(old_top.clone())))
                .collect::<Result<_, String>>()?;
            cuts[0] = new_top.clone();
            cuts[n_beds] = old_top;
            let mut next = vec![];
            if !new_top.is_zero() {
                material::append(
                    &mut next,
                    Layer::empty(WATER, 0.0).with_lengths(s.chunks(&new_top)?)?,
                )?;
            }
            for j in 0..n_beds {
                if cuts[j + 1] <= cuts[j] {
                    continue;
                }
                let id = first + j;
                let b = &beds[id];
                let f = if b.carbonate { 0.0 } else { b.fraction(x(i)) };
                let parts = material::deposit(
                    id as i32,
                    &s.chunks(&(&cuts[j + 1] - &cuts[j]))?,
                    f,
                    b.carbonate,
                    s.number(&(&cuts[j] - &new_top))?,
                    pressure,
                )?;
                flux.deposited.column(&parts, &beds, h);
                for p in parts {
                    deposited[id] += p.solid;
                    material::append(&mut next, p)?;
                }
            }
            for p in material::slice(&columns[i], &water, &[end])? {
                material::append(&mut next, p)?
            }
            columns[i] = next;
        }
        account(
            &mut entries,
            &mut previous,
            &columns,
            &beds,
            h,
            step,
            "deposition",
            flux,
            None,
        )?;
        if o.compaction {
            let mut maps: Vec<Box<dyn Fn(f64) -> f64>> = Vec::with_capacity(nx);
            let solved = material::compact_many(&columns, &beds, pressure)?;
            for (c, (next, map)) in columns.iter_mut().zip(solved) {
                *c = next;
                maps.push(Box::new(move |d| map.at(d)));
            }
            map_markers(&mut faults, nx, h, &maps);
            account(
                &mut entries,
                &mut previous,
                &columns,
                &beds,
                h,
                step,
                "compaction",
                Flux::default(),
                None,
            )?;
        }
        for c in &mut columns {
            let mut depth = -material::surface(c);
            for p in c {
                let d = (depth + p.height / 2.0).max(0.0);
                p.record_loading(d, pressure);
                depth += p.height;
            }
        }
        account(
            &mut entries,
            &mut previous,
            &columns,
            &beds,
            h,
            step,
            "burial-memory",
            Flux::default(),
            None,
        )?;
        description.push(format!(
            "up to {:.0} m deposited (unit {}, {} beds)",
            thickest,
            step + 1,
            n_beds
        ));
        log.push(Log {
            step,
            phase,
            text: description.join("; "),
            subsidence: mean_subsidence,
            deposited: thickest,
            shift,
        });
        if step == plan.history.phases[0] - 1 {
            pre = raster::rasterize(&columns, nz, h)?.grid;
        }
        if o.record {
            snapshots.push(frame(
                &columns,
                h,
                &beds,
                pressure,
                plan.history.basement_velocity,
                &faults,
            )?);
        }
    }
    let mut trapped = 0;
    for c in &columns {
        let mut seen = false;
        for p in c {
            if p.bed != WATER {
                seen = true
            } else if seen && p.height > 1e-7 {
                trapped += 1
            }
        }
    }
    raster::rasterize(&columns, nz, h)?;
    account(
        &mut entries,
        &mut previous,
        &columns,
        &beds,
        h,
        total - 1,
        "repair",
        Flux::default(),
        None,
    )?;
    let summary = budget::summarize(&entries, &initial, &previous);
    if !summary.closed {
        return Err("Accumulated grain budget failed".into());
    }
    let now = frame(
        &columns,
        h,
        &beds,
        pressure,
        plan.history.basement_velocity,
        &faults,
    )?;
    let checks = Checks {
        trapped,
        collapsed,
        area: area_error,
        seconds: {
            #[cfg(not(target_arch = "wasm32"))]
            {
                started.elapsed().as_secs_f64()
            }
            #[cfg(target_arch = "wasm32")]
            {
                0.0
            }
        },
    };
    let section = Section {
        seed: o.seed,
        setting: plan.setting,
        options: o,
        unit_of_bed: beds.iter().map(|b| b.unit as i32).collect(),
        faults: faults
            .iter()
            .map(|f| FaultInfo {
                kind: f.kind.clone(),
                dir: f.dir,
                dip: f.dip,
                heave: f.heave,
                emergent: f.emergent,
                transport: f.transport,
            })
            .collect(),
        log,
        overpressure: pressure,
        basement_velocity: plan.history.basement_velocity,
        dt: plan.history.dt,
        exhumation: plan.history.exhumation.clone(),
        budget: summary,
        checks,
        now,
        history: snapshots,
        engine: "rust-v1".into(),
    };
    plan.history.beds = beds.clone();
    Ok(Simulation {
        columns,
        beds,
        faults,
        history_plan: plan.history,
        entries,
        section,
        nx,
        nz,
        pre,
        deposited,
        slips,
        transport: transport_diagnostics,
    })
}
