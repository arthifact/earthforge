use serde::{Deserialize, Serialize};
#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RockHistory {
    pub max_burial: f64,
    pub max_effective_depth: f64,
    pub bulk_porosity: Option<f64>,
}
pub fn effective_depth(d: f64, pressure: Option<f64>) -> f64 {
    let d = d.max(0.0);
    match pressure {
        Some(p) if d > p => p + 0.25 * (d - p),
        _ => d,
    }
}
pub fn porosity(f: f64, d: f64, carbonate: bool) -> f64 {
    if carbonate {
        0.70 * crate::math::exp(-d / 1410.0)
    } else {
        f * (0.49 * crate::math::exp(-d / 3700.0))
            + (1.0 - f) * (0.63 * crate::math::exp(-d / 1960.0))
    }
}
pub fn velocity(
    f: f64,
    d: f64,
    carbonate: bool,
    pressure: Option<f64>,
    history: Option<RockHistory>,
) -> f64 {
    let old = history.unwrap_or_default();
    let de = effective_depth(d, pressure);
    let burial = old.max_burial.max(d.max(0.0));
    let loading = old.max_effective_depth.max(de);
    let phi = old
        .bulk_porosity
        .unwrap_or_else(|| porosity(f, loading, carbonate));
    let t = ((burial - 1500.0) / 1000.0).clamp(0.0, 1.0);
    let cement = t * t * (3.0 - 2.0 * t);
    let (k, mu, rho) = if carbonate {
        (70.8e9, 30.3e9, 2710.0)
    } else {
        let q = f + 0.4 * (1.0 - f);
        let hill = |a: f64, b: f64| 0.5 * (q * a + (1.0 - q) * b + 1.0 / (q / a + (1.0 - q) / b));
        (
            hill(37.0e9, 21.0e9),
            hill(44.0e9, 7.0e9),
            q * 2650.0 + (1.0 - q) * 2580.0,
        )
    };
    let brine_k: f64 = 2.4e9;
    let brine_rho: f64 = 1030.0;
    let vf: f64 = (brine_k / brine_rho).sqrt();
    let vm = ((k + 4.0 / 3.0 * mu) / rho).sqrt();
    let rhob = phi * brine_rho + (1.0 - phi) * rho;
    let rhg_at = |p: f64| (1.0 - p).powi(2) * vm + p * vf;
    let wood_at =
        |p: f64| (1.0 / (p / brine_k + (1.0 - p) / k) / (p * brine_rho + (1.0 - p) * rho)).sqrt();
    let rhg = if phi <= 0.37 {
        rhg_at(phi)
    } else if phi >= 0.47 {
        wood_at(phi)
    } else {
        1.0 / ((0.47 - phi) / 0.1 / rhg_at(0.37) + (phi - 0.37) / 0.1 / wood_at(0.47))
    };
    if carbonate {
        return rhg.clamp(1500.0, 5600.0);
    }
    let phic = 0.40 * f + 0.65 * (1.0 - f);
    let nu = (3.0 * k - 2.0 * mu) / (2.0 * (3.0 * k + mu));
    let p = ((1950.0 - brine_rho) * 9.81 * de).max(1e4);
    let a = 8.6 * 8.6 * (1.0 - phic).powi(2) * mu * mu * p
        / (std::f64::consts::PI.powi(2) * (1.0 - nu).powi(2));
    let khm = crate::math::cbrt(a / 18.0);
    let muhm = (5.0 - 4.0 * nu) / (10.0 - 5.0 * nu) * crate::math::cbrt(1.5 * a);
    let (kd, mud) = if phi <= phic {
        let r = phi / phic;
        let z = muhm / 6.0 * (9.0 * khm + 8.0 * muhm) / (khm + 2.0 * muhm);
        (
            1.0 / (r / (khm + 4.0 / 3.0 * muhm) + (1.0 - r) / (k + 4.0 / 3.0 * muhm))
                - 4.0 / 3.0 * muhm,
            1.0 / (r / (muhm + z) + (1.0 - r) / (mu + z)) - z,
        )
    } else {
        let s = (1.0 - (phi - phic) / 0.15).max(0.0);
        (khm * s, muhm * s)
    };
    let ksat = kd + (1.0 - kd / k).powi(2) / (phi / brine_k + (1.0 - phi) / k - kd / (k * k));
    let soft = ((ksat + 4.0 / 3.0 * mud) / rhob).sqrt();
    ((1.0 - cement) * soft + cement * soft.max(rhg)).clamp(1500.0, 5600.0)
}
