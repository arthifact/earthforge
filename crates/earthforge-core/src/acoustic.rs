//! Constant-density isotropic acoustic forward modelling, in 2D or 3D.
//!
//! m p_tt - Laplacian(p) + 2 m sigma p_t = q, m = 1 / velocity^2.
//! Fourth-order centred space, second-order centred time, polynomial sponge.
//! Three rotating wavefields are retained; no time-volume array is allocated.
//! Primary equation reference: https://www.devitoproject.org/examples/seismic/tutorials/01_modelling.html
//! This is an independently implemented baseline, not Devito or an elastic/attenuating solver.
use crate::space::{GridGeometry, WorldPoint};
use serde::{Deserialize, Serialize};
fn default_sponge() -> usize {
    32
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShotRequest {
    pub grid: GridGeometry,
    /// x fastest, then y, then z; m/s at grid nodes. ny=1 selects a 2D x/z plane.
    pub velocity: Vec<f64>,
    pub source: WorldPoint,
    pub receivers: Vec<WorldPoint>,
    pub frequency_hz: f64,
    pub duration_seconds: f64,
    #[serde(default)]
    pub dt_seconds: Option<f64>,
    #[serde(default)]
    pub source_delay_seconds: Option<f64>,
    #[serde(default = "default_sponge")]
    pub sponge_cells: usize,
    #[serde(default)]
    pub include_final_field: bool,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Shot {
    pub engine: &'static str,
    pub dimensions: usize,
    pub model: &'static str,
    pub grid: GridGeometry,
    pub source: WorldPoint,
    pub receivers: Vec<WorldPoint>,
    pub frequency_hz: f64,
    pub source_delay_seconds: f64,
    pub dt_seconds: f64,
    pub samples_per_receiver: usize,
    pub data_layout: &'static str,
    pub data: Vec<f64>,
    pub spatial_order: usize,
    pub time_order: usize,
    pub boundary: &'static str,
    pub sponge_cells: usize,
    pub critical_dt_seconds: f64,
    pub points_per_dominant_wavelength: f64,
    pub stats: ShotStats,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub final_field: Option<Vec<f64>>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShotStats {
    pub padded_cells: usize,
    pub stencil_updates: usize,
    /// Logical f64 arrays, not measured process RSS; includes caller velocity.
    pub working_array_bytes: usize,
    pub receiver_peak: f64,
    pub final_field_peak: f64,
}
#[derive(Clone, Copy)]
struct Weight {
    index: usize,
    weight: f64,
}
struct Kernel {
    nx: usize,
    ny: usize,
    nz: usize,
    px: usize,
    py: usize,
    pz: usize,
    pad: usize,
    prev: Vec<f64>,
    current: Vec<f64>,
    next: Vec<f64>,
    wave: Vec<f64>,
    decay: Vec<f64>,
    inverse_spacing_squared: [f64; 3],
}
// Read-only wavefield views let the mutable output remain disjoint. Row slices
// prove every stencil lane is in bounds before the inner update loop.
#[derive(Clone, Copy)]
struct UpdateFields<'a> {
    px: usize,
    py: usize,
    current: &'a [f64],
    prev: &'a [f64],
    wave: &'a [f64],
    decay: &'a [f64],
    inverse: [f64; 3],
}
impl UpdateFields<'_> {
    fn advance_planes<const THREE: bool>(&self, next: &mut [f64], base: usize) -> bool {
        let plane = self.px * self.py;
        let mut nonfinite = false;
        for (z, output) in next.chunks_exact_mut(plane).enumerate() {
            nonfinite |= self.advance_plane::<THREE>(output, base + z * plane);
        }
        nonfinite
    }

    fn advance_plane<const THREE: bool>(&self, next: &mut [f64], base: usize) -> bool {
        let width = self.px;
        let plane = width * self.py;
        let mut nonfinite = false;
        for y in if THREE { 2..self.py - 2 } else { 0..1 } {
            let i = base + y * width;
            let inner = |j: usize| &self.current[j + 2..j + width - 2];
            let row = UpdateRow {
                centre: inner(i),
                prev: &self.prev[i + 2..i + width - 2],
                wave: &self.wave[i + 2..i + width - 2],
                decay: &self.decay[i + 2..i + width - 2],
                x: [
                    &self.current[i + 1..i + width - 3],
                    &self.current[i + 3..i + width - 1],
                    &self.current[i..i + width - 4],
                    &self.current[i + 4..i + width],
                ],
                z: [
                    inner(i - plane),
                    inner(i + plane),
                    inner(i - 2 * plane),
                    inner(i + 2 * plane),
                ],
                y: if THREE {
                    [
                        inner(i - width),
                        inner(i + width),
                        inner(i - 2 * width),
                        inner(i + 2 * width),
                    ]
                } else {
                    [inner(i); 4]
                },
                inverse: self.inverse,
            };
            nonfinite |= row.advance::<THREE>(&mut next[y * width + 2..(y + 1) * width - 2]);
        }
        nonfinite
    }
}
struct UpdateRow<'a> {
    centre: &'a [f64],
    prev: &'a [f64],
    wave: &'a [f64],
    decay: &'a [f64],
    x: [&'a [f64]; 4],
    y: [&'a [f64]; 4],
    z: [&'a [f64]; 4],
    inverse: [f64; 3],
}
impl UpdateRow<'_> {
    #[inline]
    fn advance<const THREE: bool>(&self, next: &mut [f64]) -> bool {
        let n = next.len();
        assert_eq!(self.centre.len(), n);
        assert_eq!(self.prev.len(), n);
        assert_eq!(self.wave.len(), n);
        assert_eq!(self.decay.len(), n);
        for axis in [&self.x, &self.z] {
            for lane in axis {
                assert_eq!(lane.len(), n);
            }
        }
        if THREE {
            for lane in self.y {
                assert_eq!(lane.len(), n);
            }
        }
        // A boolean OR is an exact reduction. Keep the floating-point grouping
        // unchanged, including x+z before y and each centred difference.
        let mut nonfinite = false;
        for (i, out) in next.iter_mut().enumerate() {
            let centre = self.centre[i];
            let derivative = |axis: [&[f64]; 4]| {
                (4.0 / 3.0) * ((axis[0][i] - centre) + (axis[1][i] - centre))
                    - (1.0 / 12.0) * ((axis[2][i] - centre) + (axis[3][i] - centre))
            };
            let mut lap =
                derivative(self.x) * self.inverse[0] + derivative(self.z) * self.inverse[2];
            if THREE {
                lap += derivative(self.y) * self.inverse[1];
            }
            let decay = self.decay[i];
            let value = (1.0 + decay) * centre - decay * self.prev[i] + self.wave[i] * lap;
            nonfinite |= !value.is_finite();
            *out = value;
        }
        nonfinite
    }
}
impl Kernel {
    fn shape(r: &ShotRequest) -> Result<(usize, usize, usize, usize, usize), String> {
        let grid = r.grid;
        let pad = r.sponge_cells + 2;
        let px = grid
            .nx
            .checked_add(2 * pad)
            .ok_or("Acoustic padding overflow")?;
        let py = if grid.ny == 1 {
            1
        } else {
            grid.ny
                .checked_add(2 * pad)
                .ok_or("Acoustic padding overflow")?
        };
        let pz = grid
            .nz
            .checked_add(2 * pad)
            .ok_or("Acoustic padding overflow")?;
        let cells = px
            .checked_mul(py)
            .and_then(|n| n.checked_mul(pz))
            .ok_or("Acoustic grid overflow")?;
        if cells > 8_000_000 {
            return Err("Acoustic prototype exceeds eight million padded cells".into());
        }
        Ok((px, py, pz, pad, cells))
    }
    fn new(r: &ShotRequest, dt: f64, vmax: f64) -> Result<Self, String> {
        let grid = r.grid;
        let (px, py, pz, pad, cells) = Self::shape(r)?;
        let mut wave = vec![0.0; cells];
        let mut decay = vec![0.0; cells];
        let sigma_axis = |i: usize, n: usize, h: f64| {
            if r.sponge_cells == 0 {
                return 0.0;
            }
            let distance = if i < pad {
                pad - i
            } else {
                i.saturating_sub(pad + n - 1)
            };
            let t = (distance as f64 / r.sponge_cells as f64).min(1.0);
            // Quadratic sponge; the target is a design parameter, not a measured reflection claim.
            let sigma_max =
                3.0 * vmax * 4.0 * std::f64::consts::LN_10 / (2.0 * r.sponge_cells as f64 * h);
            sigma_max * t * t
        };
        for z in 0..pz {
            for y in 0..py {
                for x in 0..px {
                    let ix = x.saturating_sub(pad).min(grid.nx - 1);
                    let iy = if grid.ny == 1 {
                        0
                    } else {
                        y.saturating_sub(pad).min(grid.ny - 1)
                    };
                    let iz = z.saturating_sub(pad).min(grid.nz - 1);
                    let velocity = r.velocity[(iz * grid.ny + iy) * grid.nx + ix];
                    let sigma = sigma_axis(x, grid.nx, grid.dx)
                        + sigma_axis(z, grid.nz, grid.dz)
                        + if grid.ny == 1 {
                            0.0
                        } else {
                            sigma_axis(y, grid.ny, grid.dy)
                        };
                    let damp = sigma * dt;
                    let i = (z * py + y) * px + x;
                    wave[i] = velocity * velocity * dt * dt / (1.0 + damp);
                    decay[i] = (1.0 - damp) / (1.0 + damp);
                    if !wave[i].is_finite() || !decay[i].is_finite() {
                        return Err("Nonfinite acoustic coefficients".into());
                    }
                }
            }
        }
        Ok(Self {
            nx: grid.nx,
            ny: grid.ny,
            nz: grid.nz,
            px,
            py,
            pz,
            pad,
            prev: vec![0.0; cells],
            current: vec![0.0; cells],
            next: vec![0.0; cells],
            wave,
            decay,
            inverse_spacing_squared: [
                1.0 / (grid.dx * grid.dx),
                if grid.ny == 1 {
                    0.0
                } else {
                    1.0 / (grid.dy * grid.dy)
                },
                1.0 / (grid.dz * grid.dz),
            ],
        })
    }
    fn weights(&self, grid: GridGeometry, point: WorldPoint) -> Result<Vec<Weight>, String> {
        let positions = [
            (point.x - grid.origin.x) / grid.dx,
            (point.y - grid.origin.y) / grid.dy,
            (point.z - grid.origin.z) / grid.dz,
        ];
        let sizes = [self.nx, self.ny, self.nz];
        for j in 0..3 {
            if !positions[j].is_finite()
                || positions[j] < 0.0
                || positions[j] > (sizes[j] - 1) as f64
            {
                return Err("Acoustic source/receiver lies outside the nodal grid".into());
            }
        }
        let mut base = [0usize; 3];
        let mut fraction = [0.0; 3];
        for j in 0..3 {
            if sizes[j] > 1 {
                base[j] = (positions[j].floor() as usize).min(sizes[j] - 2);
                fraction[j] = positions[j] - base[j] as f64;
            }
        }
        let mut weights = Vec::with_capacity(if self.ny == 1 { 4 } else { 8 });
        for dz in 0..2 {
            for dy in 0..if self.ny == 1 { 1 } else { 2 } {
                for dx in 0..2 {
                    let factors = [
                        if dx == 0 {
                            1.0 - fraction[0]
                        } else {
                            fraction[0]
                        },
                        if self.ny == 1 {
                            1.0
                        } else if dy == 0 {
                            1.0 - fraction[1]
                        } else {
                            fraction[1]
                        },
                        if dz == 0 {
                            1.0 - fraction[2]
                        } else {
                            fraction[2]
                        },
                    ];
                    let weight = factors.iter().product();
                    if weight > 0.0 {
                        let x = base[0] + dx + self.pad;
                        let y = if self.ny == 1 {
                            0
                        } else {
                            base[1] + dy + self.pad
                        };
                        let z = base[2] + dz + self.pad;
                        weights.push(Weight {
                            index: (z * self.py + y) * self.px + x,
                            weight,
                        });
                    }
                }
            }
        }
        Ok(weights)
    }
    fn advance(&mut self, source: &[Weight], amplitude: f64) -> Result<(), String> {
        if self.ny == 1 {
            self.advance_dimension::<false>()?;
        } else {
            self.advance_dimension::<true>()?;
        }
        if !amplitude.is_finite() {
            return Err("Nonfinite acoustic source".into());
        }
        for w in source {
            self.next[w.index] += self.wave[w.index] * amplitude * w.weight;
            if !self.next[w.index].is_finite() {
                return Err("Nonfinite acoustic source injection".into());
            }
        }
        std::mem::swap(&mut self.prev, &mut self.current);
        std::mem::swap(&mut self.current, &mut self.next);
        Ok(())
    }
    fn advance_dimension<const THREE: bool>(&mut self) -> Result<(), String> {
        let plane = self.px * self.py;
        let fields = UpdateFields {
            px: self.px,
            py: self.py,
            current: &self.current,
            prev: &self.prev,
            wave: &self.wave,
            decay: &self.decay,
            inverse: self.inverse_spacing_squared,
        };
        let next = &mut self.next[2 * plane..(self.pz - 2) * plane];
        #[cfg(not(target_arch = "wasm32"))]
        let nonfinite = if THREE && next.len() >= 262_144 && rayon::current_num_threads() > 1 {
            use rayon::prelude::*;
            next.par_chunks_mut(plane)
                .enumerate()
                .map(|(z, output)| fields.advance_plane::<THREE>(output, (z + 2) * plane))
                .reduce(|| false, |a, b| a | b)
        } else {
            fields.advance_planes::<THREE>(next, 2 * plane)
        };
        #[cfg(target_arch = "wasm32")]
        let nonfinite = fields.advance_planes::<THREE>(next, 2 * plane);
        if nonfinite {
            Err("Nonfinite acoustic wavefield".into())
        } else {
            Ok(())
        }
    }
    fn field(&self) -> Vec<f64> {
        let mut result = Vec::with_capacity(self.nx * self.ny * self.nz);
        for z in 0..self.nz {
            for y in 0..self.ny {
                for x in 0..self.nx {
                    result.push(
                        self.current[((z + self.pad) * self.py
                            + if self.ny == 1 { 0 } else { y + self.pad })
                            * self.px
                            + x
                            + self.pad],
                    );
                }
            }
        }
        result
    }
}
pub fn critical_dt(grid: GridGeometry, vmax: f64) -> Result<f64, String> {
    grid.validate()?;
    if !vmax.is_finite() || vmax <= 0.0 {
        return Err("Invalid acoustic velocity".into());
    }
    let inverse = 1.0 / (grid.dx * grid.dx)
        + 1.0 / (grid.dz * grid.dz)
        + if grid.ny == 1 {
            0.0
        } else {
            1.0 / (grid.dy * grid.dy)
        };
    // For the fourth-order Laplacian, |lambda|max <= (16/3)*sum(h^-2).
    // Centred time stepping requires dt^2*vmax^2*|lambda|max <= 4.
    let dt = 3.0f64.sqrt() / (2.0 * vmax * inverse.sqrt());
    if !dt.is_finite() || dt <= 0.0 {
        return Err("Unrepresentable acoustic time step".into());
    }
    Ok(dt)
}
pub fn simulate(r: ShotRequest) -> Result<Shot, String> {
    let grid = r.grid.validate()?;
    let cells = grid
        .nx
        .checked_mul(grid.ny)
        .and_then(|n| n.checked_mul(grid.nz))
        .ok_or("Acoustic grid overflow")?;
    if grid.nx < 5
        || grid.nz < 5
        || (grid.ny != 1 && grid.ny < 5)
        || cells != r.velocity.len()
        || r.velocity.iter().any(|v| !v.is_finite() || *v <= 0.0)
    {
        return Err("Invalid acoustic nodal velocity grid".into());
    }
    if r.receivers.is_empty()
        || r.receivers.len() > 4096
        || r.sponge_cells > 128
        || !r.frequency_hz.is_finite()
        || r.frequency_hz <= 0.0
        || !r.duration_seconds.is_finite()
        || r.duration_seconds <= 0.0
    {
        return Err("Invalid acoustic acquisition".into());
    }
    let vmax = r.velocity.iter().copied().fold(0.0, f64::max);
    let vmin = r.velocity.iter().copied().fold(f64::INFINITY, f64::min);
    let critical = critical_dt(grid, vmax)?;
    let dt = r.dt_seconds.unwrap_or(0.75 * critical);
    let delay = r.source_delay_seconds.unwrap_or(1.5 / r.frequency_hz);
    if !dt.is_finite() || dt <= 0.0 || dt > critical * 0.99 || !delay.is_finite() || delay < 0.0 {
        return Err("Acoustic time step exceeds the CFL bound or source delay is invalid".into());
    }
    let spacing = grid
        .dx
        .max(grid.dz)
        .max(if grid.ny == 1 { 0.0 } else { grid.dy });
    let wavelength = vmin / (r.frequency_hz * spacing);
    if !wavelength.is_finite() || wavelength < 6.0 || r.frequency_hz * dt >= 0.5 {
        return Err("Acoustic source is under-resolved in space or time".into());
    }
    let steps_float = (r.duration_seconds / dt).floor() + 1.0;
    if !(2.0..=100000.0).contains(&steps_float) {
        return Err("Acoustic sample count outside prototype limits".into());
    }
    let steps = steps_float as usize;
    let samples = steps
        .checked_mul(r.receivers.len())
        .filter(|n| *n <= 4_000_000)
        .ok_or("Acoustic trace output exceeds prototype limits")?;
    let (px, py, pz, _, _) = Kernel::shape(&r)?;
    let updated = (px - 4) * (if grid.ny == 1 { 1 } else { py - 4 }) * (pz - 4);
    let work = updated
        .checked_mul(steps - 1)
        .filter(|n| *n <= 800_000_000)
        .ok_or("Acoustic work exceeds prototype limits")?;
    let mut kernel = Kernel::new(&r, dt, vmax)?;
    let source = kernel.weights(grid, r.source)?;
    let receiver_weights = r
        .receivers
        .iter()
        .map(|&point| kernel.weights(grid, point))
        .collect::<Result<Vec<_>, _>>()?;
    let cell_measure = grid.dx * grid.dz * if grid.ny == 1 { 1.0 } else { grid.dy };
    if !cell_measure.is_finite() || cell_measure <= 0.0 {
        return Err("Invalid acoustic source cell measure".into());
    }
    let mut data = vec![0.0; samples];
    let mut receiver_peak = 0.0f64;
    for t in 0..steps {
        for (j, weights) in receiver_weights.iter().enumerate() {
            let value = weights
                .iter()
                .map(|w| kernel.current[w.index] * w.weight)
                .sum::<f64>();
            if !value.is_finite() {
                return Err("Nonfinite acoustic receiver".into());
            }
            data[j * steps + t] = value;
            receiver_peak = receiver_peak.max(value.abs());
        }
        if t + 1 < steps {
            let argument = std::f64::consts::PI * r.frequency_hz * (t as f64 * dt - delay);
            let squared = argument * argument;
            let wavelet = (1.0 - 2.0 * squared) * crate::math::exp(-squared);
            if !wavelet.is_finite() {
                return Err("Invalid acoustic source wavelet".into());
            }
            kernel.advance(&source, wavelet / cell_measure)?;
        }
    }
    let final_peak = kernel.current.iter().map(|x| x.abs()).fold(0.0, f64::max);
    if !final_peak.is_finite() {
        return Err("Nonfinite final acoustic field".into());
    }
    let final_field = r.include_final_field.then(|| kernel.field());
    let working_bytes = (5 * kernel.current.len()
        + r.velocity.len()
        + data.len()
        + final_field.as_ref().map_or(0, Vec::len))
        * std::mem::size_of::<f64>();
    Ok(Shot {
        engine: "rust-acoustic-v1",
        dimensions: if grid.ny == 1 { 2 } else { 3 },
        model: "Constant-density isotropic acoustics; no elasticity, anisotropy or intrinsic attenuation",
        grid,
        source: r.source,
        receivers: r.receivers,
        frequency_hz: r.frequency_hz,
        source_delay_seconds: delay,
        dt_seconds: dt,
        samples_per_receiver: steps,
        data_layout: "receiver-major; data[receiver*samplesPerReceiver+timeIndex], time=timeIndex*dtSeconds",
        data,
        spatial_order: 4,
        time_order: 2,
        boundary: "Quadratic absorbing sponge on every active face, then zero Dirichlet halo; no free surface or PML",
        sponge_cells: r.sponge_cells,
        critical_dt_seconds: critical,
        points_per_dominant_wavelength: wavelength,
        stats: ShotStats {
            padded_cells: kernel.current.len(),
            stencil_updates: work,
            working_array_bytes: working_bytes,
            receiver_peak,
            final_field_peak: final_peak,
        },
        final_field,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn point(x: f64, y: f64, z: f64) -> WorldPoint {
        WorldPoint { x, y, z }
    }
    fn request(nx: usize, ny: usize, nz: usize, h: f64, velocity: f64) -> ShotRequest {
        ShotRequest {
            grid: GridGeometry {
                nx,
                ny,
                nz,
                dx: h,
                dy: h,
                dz: h,
                origin: WorldPoint::default(),
            },
            velocity: vec![velocity; nx * ny * nz],
            source: point(
                (nx / 2) as f64 * h,
                if ny == 1 { 0.0 } else { (ny / 2) as f64 * h },
                (nz / 2) as f64 * h,
            ),
            receivers: vec![point(
                (nx / 2) as f64 * h,
                if ny == 1 { 0.0 } else { (ny / 2) as f64 * h },
                (nz / 2) as f64 * h,
            )],
            frequency_hz: 20.0,
            duration_seconds: 0.4,
            dt_seconds: None,
            source_delay_seconds: None,
            sponge_cells: 0,
            include_final_field: false,
        }
    }
    fn gaussian(z: f64, t: f64, speed: f64) -> f64 {
        (-((z - 400.0 - speed * t) / 80.0).powi(2)).exp()
    }
    fn plane_error(h: f64, three: bool) -> (f64, Vec<f64>) {
        let mut r = request(
            5,
            if three { 5 } else { 1 },
            (1600.0 / h) as usize + 1,
            h,
            1000.0,
        );
        r.frequency_hz = 5.0;
        let dt = 0.001 * (h / 20.0).powi(2);
        let steps = (0.2 / dt).round() as usize;
        let mut k = Kernel::new(&r, dt, 1000.0).unwrap();
        for z in 0..k.pz {
            for y in 0..k.py {
                for x in 0..k.px {
                    let depth = (z as f64 - k.pad as f64) * h;
                    let i = (z * k.py + y) * k.px + x;
                    k.current[i] = gaussian(depth, 0.0, 1000.0);
                    k.prev[i] = gaussian(depth, -dt, 1000.0);
                }
            }
        }
        for step in 0..steps {
            // Exact z-boundaries for the travelling-wave solution. Transverse
            // axes are periodic: their halos copy the numerical interior plane,
            // so an added y dimension cannot feed boundary truncation error back
            // into an otherwise uniform crossline.
            for z in 0..k.pz {
                let transverse =
                    k.current[(z * k.py + if three { k.pad + 2 } else { 0 }) * k.px + k.pad + 2];
                for y in 0..k.py {
                    for x in 0..k.px {
                        if z < 2 || z >= k.pz - 2 {
                            k.current[(z * k.py + y) * k.px + x] =
                                gaussian((z as f64 - k.pad as f64) * h, step as f64 * dt, 1000.0);
                        } else if x < 2 || x >= k.px - 2 || (three && (y < 2 || y >= k.py - 2)) {
                            k.current[(z * k.py + y) * k.px + x] = transverse;
                        }
                    }
                }
            }
            k.advance(&[], 0.0).unwrap();
        }
        let mut error = 0.0;
        let mut result = Vec::new();
        for z in 0..r.grid.nz {
            let value = k.current
                [((z + k.pad) * k.py + if three { k.pad + 2 } else { 0 }) * k.px + k.pad + 2];
            result.push(value);
            error += (value - gaussian(z as f64 * h, steps as f64 * dt, 1000.0)).powi(2);
        }
        ((error / r.grid.nz as f64).sqrt(), result)
    }
    #[test]
    fn travelling_plane_wave_converges_and_uniform_crossline_reduces_exactly() {
        let mut errors = Vec::new();
        for h in [20.0, 10.0, 5.0] {
            let (error, two) = plane_error(h, false);
            let (three_error, three) = plane_error(h, true);
            assert_eq!(two, three, "uniform-y 3D field must reproduce 2D");
            assert_eq!(error, three_error);
            errors.push(error);
        }
        eprintln!("Manufactured plane-wave RMS errors h=20,10,5m: {errors:?}");
        assert!(
            errors[0] / errors[1] > 10.0 && errors[1] / errors[2] > 10.0,
            "Fourth-order convergence with dt proportional to h²: {errors:?}"
        );
    }
    #[test]
    fn planar_interface_has_independent_constant_density_reflection_coefficient() {
        let h = 5.0;
        let dt = 0.0005;
        let mut r = request(5, 1, 481, h, 2000.0);
        for z in 240..481 {
            for x in 0..5 {
                r.velocity[z * 5 + x] = 3000.0;
            }
        }
        let mut k = Kernel::new(&r, dt, 3000.0).unwrap();
        let pulse = |z: f64, t: f64| (-((z - 600.0 - 2000.0 * t) / 80.0).powi(2)).exp();
        for z in 0..k.pz {
            for x in 0..k.px {
                k.current[z * k.px + x] = pulse((z as f64 - k.pad as f64) * h, 0.0);
                k.prev[z * k.px + x] = pulse((z as f64 - k.pad as f64) * h, -dt);
            }
        }
        let receiver = (80 + k.pad) * k.px + k.pad + 2;
        let mut reflected = 0.0f64;
        for step in 0..1600 {
            for z in 0..k.pz {
                let v = k.current[z * k.px + k.pad + 2];
                for x in [0, 1, k.px - 2, k.px - 1] {
                    k.current[z * k.px + x] = v;
                }
            }
            k.advance(&[], 0.0).unwrap();
            let time = (step + 1) as f64 * dt;
            if (0.6..0.8).contains(&time) {
                reflected = reflected.max(k.current[receiver]);
            }
        }
        let expected = (3000.0 - 2000.0) / (3000.0 + 2000.0);
        eprintln!(
            "Normal-incidence pressure reflection: measured {reflected}, analytic {expected}"
        );
        assert!((reflected - expected).abs() < 0.005);
    }
    #[test]
    fn three_dimensional_point_source_arrives_at_analytic_travel_times() {
        let mut r = request(41, 41, 41, 10.0, 2000.0);
        r.source = point(200.0, 200.0, 200.0);
        r.receivers = vec![point(280.0, 200.0, 200.0), point(320.0, 200.0, 200.0)];
        r.dt_seconds = Some(0.001);
        r.duration_seconds = 0.18;
        let shot = simulate(r).unwrap();
        let n = shot.samples_per_receiver;
        for (j, distance) in [80.0, 120.0].iter().enumerate() {
            let expected = shot.source_delay_seconds + distance / 2000.0;
            let (index, _) = shot.data[j * n..(j + 1) * n]
                .iter()
                .enumerate()
                .filter(|(i, _)| ((*i as f64 * shot.dt_seconds) - expected).abs() < 0.025)
                .max_by(|a, b| a.1.abs().total_cmp(&b.1.abs()))
                .unwrap();
            let measured = index as f64 * shot.dt_seconds;
            eprintln!(
                "3D arrival distance {distance}m: measured {measured}s, analytic {expected}s"
            );
            assert!((measured - expected).abs() < 0.006);
        }
        assert!(shot.stats.working_array_bytes < 5_000_000);
    }
    #[test]
    fn heterogeneous_medium_obeys_source_receiver_reciprocity_and_repeats() {
        let mut a = request(81, 1, 81, 10.0, 2000.0);
        a.sponge_cells = 24;
        a.duration_seconds = 0.35;
        for z in 0..81 {
            for x in 0..81 {
                a.velocity[z * 81 + x] = 1600.0 + 6.0 * x as f64 + 2.0 * z as f64;
            }
        }
        a.source = point(250.7, 0.0, 300.2);
        a.receivers = vec![point(500.4, 0.0, 400.6)];
        let mut b = a.clone();
        b.source = a.receivers[0];
        b.receivers = vec![a.source];
        let first = simulate(a.clone()).unwrap();
        let reverse = simulate(b).unwrap();
        let peak = first.data.iter().map(|x| x.abs()).fold(0.0, f64::max);
        let difference = first
            .data
            .iter()
            .zip(&reverse.data)
            .map(|(a, b)| (a - b).abs())
            .fold(0.0, f64::max);
        eprintln!("Reciprocity relative max error: {}", difference / peak);
        assert!(difference / peak < 1e-10);
        assert_eq!(first.data, simulate(a).unwrap().data);
    }
    #[test]
    fn sponge_reduces_boundary_reflections_against_larger_domain_reference() {
        let mut small = request(81, 1, 81, 10.0, 2000.0);
        small.duration_seconds = 1.0;
        small.source = point(400.0, 0.0, 400.0);
        small.receivers = vec![point(450.0, 0.0, 400.0)];
        let wall = simulate(small.clone()).unwrap();
        small.sponge_cells = 40;
        let absorbed = simulate(small).unwrap();
        let mut large = request(281, 1, 281, 10.0, 2000.0);
        large.duration_seconds = 1.0;
        large.source = point(1400.0, 0.0, 1400.0);
        large.receivers = vec![point(1450.0, 0.0, 1400.0)];
        let reference = simulate(large).unwrap();
        let mut wall_error = 0.0;
        let mut absorbed_error = 0.0;
        for i in 0..reference.data.len() {
            if i as f64 * reference.dt_seconds > 0.4 {
                wall_error += (wall.data[i] - reference.data[i]).powi(2);
                absorbed_error += (absorbed.data[i] - reference.data[i]).powi(2);
            }
        }
        let ratio = (absorbed_error / wall_error).sqrt();
        eprintln!("Late boundary-error RMS ratio sponge/wall: {ratio}");
        assert!(
            ratio < 0.05,
            "The sponge remains an approximation, not a PML: {ratio}"
        );
    }
    #[test]
    fn invalid_cfl_acquisition_and_underresolved_frequencies_are_rejected() {
        let valid = request(21, 1, 21, 10.0, 2000.0);
        let mut bad = valid.clone();
        bad.dt_seconds = Some(critical_dt(bad.grid, 2000.0).unwrap());
        assert!(simulate(bad).is_err());
        let mut bad = valid.clone();
        bad.frequency_hz = 100.0;
        assert!(simulate(bad).is_err());
        let mut bad = valid.clone();
        bad.source.y = 1.0;
        assert!(simulate(bad).is_err());
        let mut bad = valid.clone();
        bad.velocity[0] = f64::NAN;
        assert!(simulate(bad).is_err());
        let mut bad = valid.clone();
        bad.receivers.clear();
        assert!(simulate(bad).is_err());
        let mut bad = valid.clone();
        bad.sponge_cells = 129;
        assert!(simulate(bad).is_err());
        let mut bad = valid.clone();
        bad.dt_seconds = Some(1e-30);
        assert!(simulate(bad).is_err());
        let mut bad = valid;
        bad.source_delay_seconds = Some(f64::INFINITY);
        assert!(simulate(bad).is_err());
    }
    #[test]
    fn nonfinite_update_is_rejected_before_rotating_state_in_both_dimensions() {
        for ny in [1, 5] {
            let r = request(7, ny, 7, 10.0, 2000.0);
            let mut kernel = Kernel::new(&r, 0.001, 2000.0).unwrap();
            let index = ((kernel.pad + 6) * kernel.py
                + if ny == 1 { 0 } else { kernel.pad + ny - 1 })
                * kernel.px
                + kernel.pad
                + 6;
            kernel.current[index] = f64::MAX;
            let before = kernel.current.clone();
            let previous = kernel.prev.clone();
            assert_eq!(
                kernel.advance(&[], 0.0).unwrap_err(),
                "Nonfinite acoustic wavefield"
            );
            assert_eq!(
                kernel.current, before,
                "failed update cannot become the current state"
            );
            assert_eq!(
                kernel.prev, previous,
                "failed update cannot replace the prior state"
            );
        }
    }
    #[cfg(not(target_arch = "wasm32"))]
    #[test]
    fn parallel_three_dimensional_updates_match_serial_and_reject_nonfinite_state() {
        let mut r = request(81, 41, 81, 20.0, 2000.0);
        for (i, value) in r.velocity.iter_mut().enumerate() {
            *value += (i % 23) as f64 * 13.0;
        }
        let pools: Vec<_> = [1, 2, 4]
            .into_iter()
            .map(|threads| {
                rayon::ThreadPoolBuilder::new()
                    .num_threads(threads)
                    .build()
                    .unwrap()
            })
            .collect();
        let mut expected = None;
        for pool in pools {
            let mut kernel = Kernel::new(&r, 0.001, 2300.0).unwrap();
            assert!(kernel.current.len() > 262_144);
            let source = kernel.weights(r.grid, r.source).unwrap();
            for i in 0..kernel.current.len() {
                kernel.current[i] = ((i % 127) as f64 - 63.0) * 1e-5;
                kernel.prev[i] = ((i % 109) as f64 - 54.0) * 1e-5;
            }
            pool.install(|| {
                for step in 0..8 {
                    kernel.advance(&source, (step as f64 - 4.0) * 1e-8).unwrap();
                }
            });
            let bits: Vec<_> = kernel.current.iter().map(|v| v.to_bits()).collect();
            if let Some(reference) = &expected {
                assert_eq!(&bits, reference);
            } else {
                expected = Some(bits);
            }
            kernel.current[source[0].index] = f64::MAX;
            let before_current: Vec<_> = kernel.current.iter().map(|v| v.to_bits()).collect();
            let before_prev: Vec<_> = kernel.prev.iter().map(|v| v.to_bits()).collect();
            assert!(pool.install(|| kernel.advance(&source, 0.0)).is_err());
            assert_eq!(
                kernel
                    .current
                    .iter()
                    .map(|v| v.to_bits())
                    .collect::<Vec<_>>(),
                before_current
            );
            assert_eq!(
                kernel.prev.iter().map(|v| v.to_bits()).collect::<Vec<_>>(),
                before_prev
            );
        }
    }
}
