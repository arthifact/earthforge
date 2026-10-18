//! Conservative regional interface envelopes used only to skip empty fault
//! branches. Bounds include all possible inverse-source locations and roundoff
//! guards. Queries whose source reach escapes the bound region use both branches.
use super::model::{HistoryEvent as E, HistorySpec, SpatialField};
pub struct Bounds {
    region: [f64; 4],
    pub envelopes: Vec<[f64; 2]>,
    reach: Vec<[f64; 2]>,
}
fn range(f: &SpatialField, r: [f64; 4]) -> [f64; 2] {
    let mut lo = f64::INFINITY;
    let mut hi = f64::NEG_INFINITY;
    for x in [r[0], r[1]] {
        for y in [r[2], r[3]] {
            let v = f.value + f.slope_x * x + f.slope_y * y;
            lo = lo.min(v);
            hi = hi.max(v);
        }
    }
    let a = f.waves.iter().map(|w| w.amplitude.abs()).sum::<f64>()
        + f.fronts.iter().map(|v| v.amplitude.abs()).sum::<f64>();
    let scale = f.value.abs()
        + f.slope_x.abs() * r[0].abs().max(r[1].abs())
        + f.slope_y.abs() * r[2].abs().max(r[3].abs())
        + a;
    let guard = 1e-9 + 256.0 * f64::EPSILON * scale;
    if !lo.is_finite() || !hi.is_finite() || !guard.is_finite() {
        [f64::NEG_INFINITY, f64::INFINITY]
    } else {
        [lo - a - guard, hi + a + guard]
    }
}
impl Bounds {
    pub fn new(s: &HistorySpec) -> Result<Self, String> {
        let mut reach = vec![[0.0, 0.0]];
        for e in &s.events {
            let mut r = *reach.last().unwrap();
            if let Some((fault, bend, _)) = e.fault_transform() {
                r[0] += fault.slip.x.abs() + bend.map_or(0.0, |b| 2.0 * b.amplitude.abs());
                r[1] += fault.slip.y.abs();
            }
            reach.push(r);
        }
        let total = *reach.last().unwrap();
        let region = [
            s.bounds.min.x - total[0] - 1.0,
            s.bounds.max.x + total[0] + 1.0,
            s.bounds.min.y - total[1] - 1.0,
            s.bounds.max.y + total[1] + 1.0,
        ];
        if region.iter().any(|v| !v.is_finite()) {
            return Ok(Self {
                region,
                envelopes: vec![[f64::NEG_INFINITY, f64::INFINITY]; s.events.len() + 1],
                reach,
            });
        }
        let initial = range(&s.initial_surface, region);
        let height = crate::material::height(&s.initial_layers)?;
        let mut envelopes = vec![[initial[0], initial[1] + height]];
        for e in &s.events {
            let [mut lo, mut hi] = *envelopes.last().unwrap();
            match e {
                E::Subsidence { displacement } => {
                    let r = range(displacement, region);
                    lo += r[0];
                    hi += r[1];
                }
                E::Deposit {
                    thickness,
                    fill_to,
                    max_thickness,
                    ..
                } => {
                    let cap = max_thickness
                        .as_ref()
                        .map(|f| range(f, region)[1].max(0.0))
                        .unwrap_or(f64::INFINITY);
                    lo = match thickness {
                        Some(t) => lo - range(t, region)[1].max(0.0).min(cap),
                        // top' = max(min(top, fill), top - supply). Bound the
                        // TOP directly; using the deepest basement as the top
                        // needlessly expands every subsequent fault branch.
                        None => lo
                            .min(range(fill_to.as_ref().unwrap(), region)[0])
                            .max(lo - cap),
                    };
                }
                E::Fault { fault } | E::SweptFault { fault, .. } => {
                    lo += fault.slip.z.min(0.0);
                    hi += fault.slip.z.max(0.0);
                }
                E::ListricFault { fault, curve, .. } => {
                    let extra = curve.displacement_bound(*fault);
                    lo += (fault.slip.z - extra).min(0.0);
                    hi += (fault.slip.z + extra).max(0.0);
                }
                E::Erosion { surface } => {
                    let r = range(surface, region);
                    lo = lo.max(r[0]);
                    hi = hi.max(r[1]);
                }
                _ => {}
            }
            let guard = 1e-9 + 256.0 * f64::EPSILON * lo.abs().max(hi.abs());
            if !lo.is_finite() || !hi.is_finite() || !guard.is_finite() {
                envelopes.push([f64::NEG_INFINITY, f64::INFINITY]);
            } else {
                envelopes.push([lo - guard, hi + guard]);
            }
        }
        Ok(Self {
            region,
            envelopes,
            reach,
        })
    }
    pub fn valid_for(&self, n: usize, x: f64, y: f64) -> bool {
        let r = self.reach[n];
        x - r[0] >= self.region[0]
            && x + r[0] <= self.region[1]
            && y - r[1] >= self.region[2]
            && y + r[1] <= self.region[3]
    }
}
