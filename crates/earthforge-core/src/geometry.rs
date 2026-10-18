use serde::{Deserialize, Serialize};
pub type V = [f64; 2];
pub type Segment = [V; 2];
pub fn dot(a: V, b: V) -> f64 {
    a[0] * b[0] + a[1] * b[1]
}
fn sub(a: V, b: V) -> V {
    [a[0] - b[0], a[1] - b[1]]
}
fn unit(a: V) -> V {
    let n = crate::math::hypot(a[0], a[1]);
    let n = if n == 0.0 { 1.0 } else { n };
    [a[0] / n, a[1] / n]
}
pub fn lerp(a: V, b: V, t: f64) -> V {
    [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]
}
#[derive(Clone, Debug)]
pub struct Flow {
    pub p: Vec<V>,
    pub t: Vec<V>,
    pub n: Vec<V>,
    pub b: Vec<V>,
    pub m: Vec<V>,
}
impl Flow {
    pub fn new(p: Vec<V>) -> Result<Self, String> {
        if p.len() < 2 || p.iter().flatten().any(|x| !x.is_finite()) {
            return Err("Invalid flow geometry".into());
        }
        let mut t = Vec::new();
        let mut n = Vec::new();
        let mut b = vec![[0.0; 2]];
        let mut m = b.clone();
        for j in 0..p.len() - 1 {
            if p[j] == p[j + 1] {
                return Err("Zero-length flow segment".into());
            }
            let tj = unit(sub(p[j + 1], p[j]));
            t.push(tj);
            n.push(if tj[0] >= 0.0 {
                [tj[1], -tj[0]]
            } else {
                [-tj[1], tj[0]]
            });
        }
        for j in 1..t.len() {
            b.push(unit([n[j - 1][0] + n[j][0], n[j - 1][1] + n[j][1]]));
            m.push(unit([t[j - 1][0] + t[j][0], t[j - 1][1] + t[j][1]]));
        }
        Ok(Self { p, t, n, b, m })
    }
    pub fn domain(&self, p: V) -> usize {
        let mut j = 0;
        for k in 1..self.t.len() {
            if dot(sub(p, self.p[k]), self.m[k]) > 0.0 {
                j = k
            } else {
                break;
            }
        }
        j
    }
    fn start(&self, j: usize, delta: f64) -> f64 {
        if j == 0 {
            f64::NEG_INFINITY
        } else {
            dot(self.b[j], self.t[j]) * delta / dot(self.b[j], self.n[j])
        }
    }
    fn end(&self, j: usize, delta: f64) -> f64 {
        if j == self.t.len() - 1 {
            f64::INFINITY
        } else {
            dot(sub(self.p[j + 1], self.p[j]), self.t[j])
                + dot(self.b[j + 1], self.t[j]) * delta / dot(self.b[j + 1], self.n[j])
        }
    }
    pub fn displacement(&self, p: V, s: f64) -> Result<V, String> {
        let mut j = self.domain(p);
        let q = sub(p, self.p[j]);
        let delta = dot(q, self.n[j]);
        let mut u = dot(q, self.t[j]);
        let mut left = s;
        let mut d = [0.0; 2];
        for _ in 0..=self.t.len() {
            let distance = if left >= 0.0 {
                let e = self.end(j, delta);
                if u + left <= e {
                    left
                } else {
                    (e - u).max(0.0)
                }
            } else {
                let st = self.start(j, delta);
                if u + left >= st {
                    left
                } else {
                    -(u - st).max(0.0)
                }
            };
            d[0] += distance * self.t[j][0];
            d[1] += distance * self.t[j][1];
            left -= distance;
            if left == 0.0 {
                return Ok(d);
            }
            if left > 0.0 {
                j += 1;
                u = self.start(j, delta)
            } else {
                j = j.checked_sub(1).ok_or("Flow left domain")?;
                u = self.end(j, delta)
            }
        }
        Err("Flow crossed too many domains".into())
    }
    pub fn moved(&self, p: V, s: f64) -> Result<V, String> {
        let mut j = self.domain(p);
        let q = sub(p, self.p[j]);
        let delta = dot(q, self.n[j]);
        let mut u = dot(q, self.t[j]);
        let mut left = s;
        for _ in 0..=self.t.len() {
            if left >= 0.0 {
                let e = self.end(j, delta);
                if u + left <= e {
                    u += left;
                    break;
                }
                left -= (e - u).max(0.0);
                j += 1;
                u = self.start(j, delta)
            } else {
                let st = self.start(j, delta);
                if u + left >= st {
                    u += left;
                    break;
                }
                left += (u - st).max(0.0);
                j = j.checked_sub(1).ok_or("Flow left domain")?;
                u = self.end(j, delta)
            }
        }
        Ok([
            self.p[j][0] + self.t[j][0] * u + self.n[j][0] * delta,
            self.p[j][1] + self.t[j][1] * u + self.n[j][1] * delta,
        ])
    }
    pub fn mean_displacement(
        &self,
        x: f64,
        top: f64,
        height: f64,
        s: f64,
        width: f64,
    ) -> Result<V, String> {
        if !(height > 0.0 && width > 0.0)
            || [
                x,
                top,
                height,
                s,
                width,
                top + height,
                x - width / 2.0,
                x + width / 2.0,
            ]
            .iter()
            .any(|x| !x.is_finite())
        {
            return Err("Invalid flow integration extent".into());
        }
        let count = self.t.len();
        if s == 0.0 {
            return Ok([0.0; 2]);
        }
        if count == 1 {
            return Ok([s * self.t[0][0], s * self.t[0][1]]);
        }
        let initial = vec![[-0.5, 0.0], [0.5, 0.0], [0.5, 1.0], [-0.5, 1.0]];
        let center_z = top + height / 2.0;
        let j = self.domain([x, center_z]);
        let target = self.domain(self.moved([x, center_z], s)?);
        let mut simple = true;
        for p in &initial {
            let q = [x + p[0] * width, top + p[1] * height];
            if self.domain(q) != j || self.domain(self.moved(q, s)?) != target {
                simple = false;
                break;
            }
        }
        if simple {
            return if j == target {
                Ok([s * self.t[j][0], s * self.t[j][1]])
            } else {
                self.displacement([x, center_z], s)
            };
        }
        let mut a = vec![0.0; count];
        let mut c = a.clone();
        let mut b = a.clone();
        for j in 1..count {
            let old = dot(self.b[j], self.t[j - 1]) / dot(self.b[j], self.n[j - 1]);
            let new = dot(self.b[j], self.t[j]) / dot(self.b[j], self.n[j]);
            a[j] = a[j - 1] + dot(sub(self.p[j], self.p[j - 1]), self.t[j - 1]);
            c[j] = c[j - 1] + old - new;
            b[j] = new + c[j];
        }
        let mut remaining = initial;
        let mut area = 0.0;
        let mut mean = [0.0; 2];
        for j in 0..count {
            if remaining.is_empty() {
                break;
            }
            let side = |p: V| {
                (x - self.p[j + 1][0]) * self.m[j + 1][0]
                    + (top - self.p[j + 1][1]) * self.m[j + 1][1]
                    + p[0] * width * self.m[j + 1][0]
                    + p[1] * height * self.m[j + 1][1]
            };
            let start = if j == count - 1 {
                remaining.clone()
            } else {
                clip(&remaining, |p| -side(p))
            };
            if j < count - 1 {
                remaining = clip(&remaining, side)
            }
            if start.is_empty() {
                continue;
            }
            let delta0 = (x - self.p[j][0]) * self.n[j][0] + (top - self.p[j][1]) * self.n[j][1];
            let distance0 = (x - self.p[j][0]) * self.t[j][0]
                + (top - self.p[j][1]) * self.t[j][1]
                + a[j]
                + c[j] * delta0
                + s;
            let mut rest = start;
            for k in 0..count {
                if rest.is_empty() {
                    break;
                }
                let crossed = |p: V| {
                    distance0 - a[k + 1] - b[k + 1] * delta0
                        + p[0] * width * (self.t[j][0] + (c[j] - b[k + 1]) * self.n[j][0])
                        + p[1] * height * (self.t[j][1] + (c[j] - b[k + 1]) * self.n[j][1])
                };
                let part = if k == count - 1 {
                    rest.clone()
                } else {
                    clip(&rest, |p| -crossed(p))
                };
                if k < count - 1 {
                    rest = clip(&rest, crossed)
                }
                let (weight, q) = measure(&part);
                if weight <= 0.0 {
                    continue;
                }
                let d = if j == k {
                    [s * self.t[j][0], s * self.t[j][1]]
                } else {
                    self.displacement([x + q[0] * width, top + q[1] * height], s)?
                };
                area += weight;
                mean[0] += weight * d[0];
                mean[1] += weight * d[1];
            }
        }
        if area <= 0.0 {
            return Err("Empty flow integration area".into());
        }
        Ok([mean[0] / area, mean[1] / area])
    }
}
fn clip(poly: &[V], value: impl Fn(V) -> f64) -> Vec<V> {
    if poly.is_empty() {
        return vec![];
    }
    let mut out = Vec::new();
    let mut a = *poly.last().unwrap();
    let mut fa = value(a);
    for &b in poly {
        let fb = value(b);
        if (fa >= 0.0) != (fb >= 0.0) {
            out.push(lerp(a, b, fa / (fa - fb)));
        }
        if fb >= 0.0 {
            out.push(b)
        }
        a = b;
        fa = fb;
    }
    out
}
fn measure(poly: &[V]) -> (f64, V) {
    if poly.len() < 3 {
        return (0.0, [0.0; 2]);
    }
    let o = poly[0];
    let mut area2 = 0.0;
    let mut mx = 0.0;
    let mut mz = 0.0;
    for j in 1..poly.len() - 1 {
        let a = sub(poly[j], o);
        let b = sub(poly[j + 1], o);
        let cross = a[0] * b[1] - a[1] * b[0];
        area2 += cross;
        mx += cross * (a[0] + b[0]);
        mz += cross * (a[1] + b[1]);
    }
    let q = if area2 != 0.0 {
        [o[0] + mx / (3.0 * area2), o[1] + mz / (3.0 * area2)]
    } else {
        o
    };
    (area2.abs() / 2.0, q)
}
pub fn poly_depth(p: &[V], x: f64) -> f64 {
    for q in p.windows(2) {
        let a = q[0];
        let b = q[1];
        let lo = a[0].min(b[0]);
        let hi = a[0].max(b[0]);
        if x >= lo && x <= hi {
            return if hi == lo {
                a[1]
            } else {
                a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0])
            };
        }
    }
    if (x - p[0][0]).abs() < (x - p.last().unwrap()[0]).abs() {
        p[0][1]
    } else {
        p.last().unwrap()[1]
    }
}
pub fn normal_depth(
    nx: usize,
    h: f64,
    origin: f64,
    dir: i32,
    dip: f64,
    detachment: f64,
) -> (usize, Vec<f64>) {
    let q = (origin + 2000.0) / h;
    let top = (if dir > 0 { q.floor() } else { q.ceil() }).clamp(0.0, (nx - 1) as f64) as usize;
    let mut out = vec![f64::NAN; nx];
    let mut i = top as i32;
    while i >= 0 && (i as usize) < nx {
        let d = dir as f64 * (-2000.0 + i as f64 * h - origin);
        out[i as usize] = if d < 0.0 {
            d * crate::math::tan(dip)
        } else {
            -detachment * crate::math::expm1(-d * crate::math::tan(dip) / detachment)
        };
        i += dir;
    }
    (top, out)
}
pub fn sample(x: f64, h: f64, values: &[f64]) -> f64 {
    let q = ((x + 2000.0) / h).clamp(0.0, (values.len() - 1) as f64);
    let i = q.floor() as usize;
    let j = (i + 1).min(values.len() - 1);
    values[i] + (q - i as f64) * (values[j] - values[i])
}
// Preserve the reference operation boundary during migration.
#[allow(clippy::too_many_arguments)]
pub fn thrust_geometry(
    x1: f64,
    transport: i32,
    dip: f64,
    zd: f64,
    zu: f64,
    xs: &[f64],
    floors: &[f64],
    h: f64,
    emergent: bool,
) -> Vec<V> {
    let back = if transport > 0 {
        xs[0]
    } else {
        *xs.last().unwrap()
    };
    let front = if transport > 0 {
        *xs.last().unwrap()
    } else {
        xs[0]
    };
    let ramp = |x: f64| zd - transport as f64 * (x - x1) * crate::math::tan(dip);
    let mut ahead: Vec<_> = xs
        .iter()
        .copied()
        .filter(|x| transport as f64 * (*x - x1) > 0.0)
        .collect();
    ahead.sort_by(|a, b| (transport as f64 * (*a - *b)).total_cmp(&0.0));
    let intersect = |upper: &dyn Fn(f64) -> f64| {
        let mut a = x1;
        let mut da = ramp(a) - upper(a);
        if da <= 0.0 {
            return a;
        }
        for &x in &ahead {
            let d = ramp(x) - upper(x);
            if d <= 0.0 {
                return a + (x - a) * da / (da - d);
            }
            a = x;
            da = d;
        }
        front
    };
    let floor = |x| sample(x, h, floors);
    let (a, za, zf, lower) = if emergent {
        let a = intersect(&floor);
        let za = floor(a);
        let zf = floor(front);
        let chord = |x: f64| za + (zf - za) * (x - a) / if front == a { 1.0 } else { front - a };
        let lower = xs
            .iter()
            .filter(|x| transport as f64 * (**x - a) >= 0.0)
            .fold(0.0f64, |v, x| v.max(floor(*x) - chord(*x)));
        (a, za, zf, lower)
    } else {
        (0.0, 0.0, 0.0, 0.0)
    };
    let upper = |x: f64| {
        if emergent {
            za + (zf - za) * (x - a) / if front == a { 1.0 } else { front - a } + lower
        } else {
            zu
        }
    };
    let x2 = intersect(&upper);
    let z2 = ramp(x2).max(upper(x2));
    let mut out = vec![
        [back, zd],
        [x1, zd],
        [x2, z2],
        [front, ramp(front).max(upper(front))],
    ];
    out.dedup_by(|a, b| a[0] == b[0]);
    out
}
pub fn trace_from_depth(depth: &[f64], h: f64) -> Vec<Segment> {
    depth
        .windows(2)
        .enumerate()
        .filter(|(_, d)| d.iter().all(|x| x.is_finite()))
        .map(|(i, d)| {
            [
                [-2000.0 + i as f64 * h, d[0]],
                [-2000.0 + (i + 1) as f64 * h, d[1]],
            ]
        })
        .collect()
}
pub fn project_trace(segments: &[Segment], nx: usize, h: f64) -> Vec<f64> {
    let mut hits: Vec<Vec<f64>> = vec![vec![]; nx];
    for [a, b] in segments {
        let lo = a[0].min(b[0]);
        let hi = a[0].max(b[0]);
        let first = ((lo + 2000.0 - 1e-8) / h).ceil().max(0.0) as usize;
        let last = (((hi + 2000.0 + 1e-8) / h).floor() as isize).min(nx as isize - 1);
        for (i, hit) in hits
            .iter_mut()
            .enumerate()
            .take((last + 1).max(0) as usize)
            .skip(first)
        {
            let t = if hi - lo < 1e-10 {
                0.5
            } else {
                ((-2000.0 + i as f64 * h - a[0]) / (b[0] - a[0])).clamp(0.0, 1.0)
            };
            let z = a[1] + t * (b[1] - a[1]);
            if !hit.iter().any(|v| (*v - z).abs() < 1e-7) {
                hit.push(z)
            }
        }
    }
    hits.into_iter()
        .map(|a| {
            if a.is_empty() {
                f64::NAN
            } else {
                a.iter().sum::<f64>() / a.len() as f64
            }
        })
        .collect()
}
pub fn transport_trace(segments: &[Segment], flow: &Flow, s: f64) -> Result<Vec<Segment>, String> {
    fn advect(
        a: V,
        b: V,
        level: usize,
        f: &Flow,
        s: f64,
        out: &mut Vec<Segment>,
    ) -> Result<(), String> {
        let c = lerp(a, b, 0.5);
        let ma = f.moved(a, s)?;
        let mb = f.moved(b, s)?;
        let mc = f.moved(c, s)?;
        let error = (mc[0] - (ma[0] + mb[0]) / 2.0).hypot(mc[1] - (ma[1] + mb[1]) / 2.0);
        let region = |p: V| -> Result<_, String> { Ok((f.domain(p), f.domain(f.moved(p, s)?))) };
        if (error < 1e-8 && region(a)? == region(b)? && region(a)? == region(c)?)
            || (b[0] - a[0]).hypot(b[1] - a[1]) < 1e-8
        {
            out.push([ma, mb]);
            return Ok(());
        }
        if level >= 40 {
            return Err("Passive fault bend unresolved".into());
        }
        advect(a, c, level + 1, f, s, out)?;
        advect(c, b, level + 1, f, s, out)
    }
    let mut out = Vec::new();
    for &[a, b] in segments {
        let mut breaks = vec![0.0, 1.0];
        if a[0] != b[0] {
            for p in &flow.p {
                let t = (p[0] - a[0]) / (b[0] - a[0]);
                if t > 0.0 && t < 1.0 {
                    breaks.push(t)
                }
            }
        }
        breaks.sort_by(f64::total_cmp);
        for w in breaks.windows(2) {
            let p = lerp(a, b, w[0]);
            let q = lerp(a, b, w[1]);
            let dp = p[1] - poly_depth(&flow.p, p[0]);
            let dq = q[1] - poly_depth(&flow.p, q[0]);
            let portions = if dp * dq < 0.0 {
                let c = lerp(p, q, dp / (dp - dq));
                vec![[p, c], [c, q]]
            } else {
                vec![[p, q]]
            };
            for [u, v] in portions {
                let m = lerp(u, v, 0.5);
                if m[1] < poly_depth(&flow.p, m[0]) - 1e-9 {
                    advect(u, v, 0, flow, s, &mut out)?
                } else {
                    out.push([u, v])
                }
            }
        }
    }
    Ok(out)
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Fault {
    pub kind: String,
    pub dir: i32,
    #[serde(skip)]
    pub depth: Vec<f64>,
    pub top: usize,
    pub x: Vec<f64>,
    pub z: Vec<f64>,
    pub dip: f64,
    pub detachment: f64,
    pub start: usize,
    pub end: usize,
    pub heave: f64,
    pub heaves: Vec<f64>,
    pub remainder: f64,
    pub trace: Option<Vec<Segment>>,
    #[serde(skip)]
    pub points: Vec<V>,
    pub transport: i32,
    pub emergent: bool,
    pub carry: Vec<f64>,
}
impl Fault {
    pub fn sync(&mut self, h: f64, nx: usize) {
        if let Some(t) = &self.trace {
            self.depth = project_trace(t, nx, h)
        }
        self.x.clear();
        self.z.clear();
        for (i, z) in self.depth.iter().enumerate() {
            if z.is_finite() {
                self.x.push(-2000.0 + i as f64 * h);
                self.z.push(*z)
            }
        }
    }
}
