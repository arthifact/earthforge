//! Deterministic 3D event recipes. Seeds choose parameters, not a rendered volume.
use super::curved::DipCurve;
use super::model::{
    FaciesFront, HistoryEvent as E, HistorySpec, SpatialField as F, StrikeBend, Wave,
};
use crate::{
    material::Bed,
    polyhedron::Aabb,
    space::{PlanarFault, WorldPoint as P},
};
use serde::{Deserialize, Serialize};
fn seed() -> u32 {
    20261014
}
fn steps() -> usize {
    12
}
fn faults() -> usize {
    2
}
fn ten() -> f64 {
    10.0
}
fn yes() -> bool {
    true
}
fn curvature() -> f64 {
    0.7
}
fn curve_length() -> f64 {
    1800.0
}
fn one() -> f64 {
    1.0
}
fn is_curvature(v: &f64) -> bool {
    *v == curvature()
}
fn is_length(v: &f64) -> bool {
    *v == curve_length()
}
fn is_one(v: &f64) -> bool {
    *v == 1.0
}
fn classic(v: &str) -> bool {
    v == "classic"
}
fn setting() -> String {
    "extension".into()
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct HistoryOptions {
    pub seed: u32,
    pub steps: usize,
    pub faults: usize,
    pub setting: String,
    pub compaction: bool,
    pub exhumation: bool,
    pub overpressure: bool,
    pub material_step: f64,
    #[serde(skip_serializing_if = "classic")]
    pub geology: String,
    #[serde(skip_serializing_if = "is_curvature")]
    pub curve_strength: f64,
    #[serde(skip_serializing_if = "is_length")]
    pub curve_length: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fault_dip_degrees: Option<f64>,
    #[serde(skip_serializing_if = "is_one")]
    pub fault_slip_scale: f64,
}
impl Default for HistoryOptions {
    fn default() -> Self {
        Self {
            seed: seed(),
            steps: steps(),
            faults: faults(),
            setting: setting(),
            compaction: yes(),
            exhumation: false,
            overpressure: false,
            material_step: ten(),
            geology: "classic".into(),
            curve_strength: curvature(),
            curve_length: curve_length(),
            fault_dip_degrees: None,
            fault_slip_scale: one(),
        }
    }
}
struct Rng(u32);
impl Rng {
    fn next(&mut self) -> f64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.0 = x;
        x as f64 / 4294967296.0
    }
}
pub fn generate(o: &HistoryOptions) -> Result<HistorySpec, String> {
    if !matches!(o.geology.as_str(), "classic" | "detailed" | "listric-v1") {
        return Err("Unknown geological recipe".into());
    }
    if !(2..=24).contains(&o.steps)
        || o.faults > 4
        || !matches!(o.setting.as_str(), "extension" | "compression")
    {
        return Err("Unsupported 3D history options".into());
    }
    if !o.curve_strength.is_finite()
        || !(0.0..=0.95).contains(&o.curve_strength)
        || !o.curve_length.is_finite()
        || !(100.0..=10000.0).contains(&o.curve_length)
        || !o.fault_slip_scale.is_finite()
        || !(0.25..=2.0).contains(&o.fault_slip_scale)
        || o.fault_dip_degrees
            .is_some_and(|v| !v.is_finite() || !(15.0..=80.0).contains(&v))
    {
        return Err("Invalid listric recipe geometry controls".into());
    }
    if o.geology != "listric-v1"
        && (o.curve_strength != curvature()
            || o.curve_length != curve_length()
            || o.fault_dip_degrees.is_some()
            || o.fault_slip_scale != 1.0)
    {
        return Err("Listric geometry controls require the listric-v1 recipe".into());
    }
    if o.geology == "listric-v1" {
        let mut spec = detailed(o)?;
        for event in &mut spec.events {
            if let E::SweptFault { fault, bend } = event {
                let mut f = *fault;
                if let Some(degrees) = o.fault_dip_degrees {
                    let h = crate::math::hypot(f.normal.x, f.normal.y);
                    let ux = f.normal.x / h;
                    let uy = f.normal.y / h;
                    let amount =
                        crate::math::hypot(crate::math::hypot(f.slip.x, f.slip.y), f.slip.z)
                            * f.slip.z.signum();
                    let angle = degrees.to_radians();
                    let horizontal_normal = crate::math::sin(angle);
                    let vertical_normal = crate::math::sin(std::f64::consts::FRAC_PI_2 - angle);
                    f.normal = P {
                        x: ux * horizontal_normal,
                        y: uy * horizontal_normal,
                        z: vertical_normal,
                    };
                    f.slip = P {
                        x: -amount * vertical_normal * ux,
                        y: -amount * vertical_normal * uy,
                        z: amount * horizontal_normal,
                    };
                }
                f.slip.x *= o.fault_slip_scale;
                f.slip.y *= o.fault_slip_scale;
                f.slip.z *= o.fault_slip_scale;
                *event = E::ListricFault {
                    fault: f,
                    bend: Some(*bend),
                    curve: DipCurve {
                        strength: o.curve_strength,
                        length: o.curve_length,
                    },
                };
            }
        }
        return Ok(spec);
    }
    if o.geology == "detailed" {
        return detailed(o);
    }
    let mut rng = Rng(if o.seed == 0 { 1 } else { o.seed });
    let bounds = Aabb {
        min: P::default(),
        max: P {
            x: 10000.0,
            y: 10000.0,
            z: 6200.0,
        },
    };
    let mut beds = vec![];
    let mut events = vec![];
    let mut stages = vec![0];
    if o.overpressure {
        events.push(E::Pressure {
            top: Some(F::constant(1400.0)),
            compact: o.compaction,
        });
    }
    let mut fault_index = 0;
    for step in 0..o.steps {
        let phase = if step < o.steps / 3 {
            "pre-tectonic"
        } else if step < o.steps * 3 / 4 {
            "syn-tectonic"
        } else {
            "post-tectonic"
        };
        events.push(E::Subsidence {
            displacement: F {
                value: 75.0 + 30.0 * rng.next(),
                slope_x: 0.001 + 0.001 * rng.next(),
                slope_y: 0.0015,
                fronts: vec![],
                waves: vec![Wave {
                    amplitude: 8.0,
                    kx: 0.0004,
                    ky: 0.0007,
                    phase: step as f64 * 0.14,
                }],
            },
        });
        if fault_index < o.faults && step >= (fault_index + 1) * o.steps / (o.faults + 1) {
            let azimuth = -0.6 + 1.2 * rng.next();
            let dip = (25.0 + 15.0 * rng.next()).to_radians();
            let (ca, sa, cd, sd) = (
                crate::math::sin(std::f64::consts::FRAC_PI_2 - azimuth),
                crate::math::sin(azimuth),
                crate::math::sin(std::f64::consts::FRAC_PI_2 - dip),
                crate::math::sin(dip),
            );
            let amount = (250.0 + 250.0 * rng.next())
                * if o.setting == "compression" {
                    -1.0
                } else {
                    1.0
                };
            events.push(E::Fault {
                fault: PlanarFault {
                    point: P {
                        x: 3500.0 + 2500.0 * rng.next(),
                        y: 5000.0,
                        z: 1400.0 + 300.0 * rng.next(),
                    },
                    normal: P {
                        x: cd * ca,
                        y: cd * sa,
                        z: sd,
                    },
                    slip: P {
                        x: -amount * sd * ca,
                        y: -amount * sd * sa,
                        z: amount * cd,
                    },
                },
            });
            fault_index += 1;
        }
        if o.exhumation && step == o.steps * 3 / 4 {
            events.push(E::Erosion {
                surface: F {
                    value: 1150.0,
                    slope_x: 0.008,
                    slope_y: -0.012,
                    fronts: vec![],
                    waves: vec![],
                },
            });
        }
        for sub in 0..3 {
            let bed = beds.len();
            let fraction = 0.18 + 0.64 * rng.next();
            let carbonate = bed % 17 == 13;
            beds.push(Bed {
                unit: step,
                phase: phase.into(),
                a: fraction,
                b: 0.0,
                c: 5000.0,
                d: 1800.0,
                carbonate,
            });
            events.push(E::Deposit {
                bed,
                thickness: Some(F {
                    value: 32.0 + 14.0 * rng.next(),
                    slope_x: 0.0003,
                    slope_y: 0.0004,
                    fronts: vec![],
                    waves: vec![Wave {
                        amplitude: 4.0,
                        kx: 0.0005,
                        ky: 0.0006,
                        phase: step as f64 * 0.3 + sub as f64,
                    }],
                }),
                fill_to: None,
                max_thickness: None,
                fraction: Some(F {
                    value: fraction,
                    waves: vec![Wave {
                        amplitude: 0.08,
                        kx: 0.0004,
                        ky: -0.0005,
                        phase: bed as f64,
                    }],
                    ..Default::default()
                }),
                compact: o.compaction,
            });
        }
        stages.push(events.len());
    }
    Ok(HistorySpec {
        bounds,
        initial_surface: F {
            value: 500.0,
            slope_x: 0.005,
            slope_y: 0.008,
            fronts: vec![],
            waves: vec![],
        },
        initial_layers: vec![],
        beds,
        events,
        material_step: o.material_step,
        stages,
    })
}

/// Detailed recipe v1. Bed packages fill available accommodation under a supply
/// cap, with occasional mud drapes. Each depositional cycle compacts once, as in
/// the existing 2D time-step scheme. Facies fronts migrate in x and vary in y.
fn detailed(o: &HistoryOptions) -> Result<HistorySpec, String> {
    let mut rng = Rng(if o.seed == 0 { 1 } else { o.seed });
    let bounds = Aabb {
        min: P::default(),
        max: P {
            x: 10000.0,
            y: 10000.0,
            z: 6200.0,
        },
    };
    let mut beds = vec![];
    let mut events = vec![];
    let mut stages = vec![0];
    if o.overpressure {
        events.push(E::Pressure {
            top: Some(F {
                value: 1500.0,
                slope_y: 0.015,
                ..Default::default()
            }),
            compact: false,
        });
    }
    let mut faults = vec![];
    for i in 0..o.faults {
        let azimuth = -0.45 + 0.9 * rng.next();
        let dip = (if o.setting == "compression" {
            22.0
        } else {
            38.0
        } + 14.0 * rng.next())
        .to_radians();
        let ca = crate::math::sin(std::f64::consts::FRAC_PI_2 - azimuth);
        let sa = crate::math::sin(azimuth);
        let cd = crate::math::sin(std::f64::consts::FRAC_PI_2 - dip);
        let sd = crate::math::sin(dip);
        let sign = if o.setting == "compression" {
            -1.0
        } else {
            1.0
        };
        let amount = sign * (360.0 + 350.0 * rng.next());
        faults.push((
            PlanarFault {
                point: P {
                    x: 2400.0 + i as f64 * 1900.0 + 700.0 * rng.next(),
                    y: 5000.0,
                    z: 850.0 + 500.0 * rng.next(),
                },
                normal: P {
                    x: cd * ca,
                    y: cd * sa,
                    z: sd,
                },
                slip: P {
                    x: -amount * sd * ca,
                    y: -amount * sd * sa,
                    z: amount * cd,
                },
            },
            StrikeBend {
                amplitude: 300.0 + 650.0 * rng.next(),
                wavelength: 8000.0 + 7000.0 * rng.next(),
                phase: rng.next() * std::f64::consts::TAU,
            },
        ));
    }
    for step in 0..o.steps {
        let phase = if step < o.steps / 3 {
            "pre-tectonic"
        } else if step < o.steps * 3 / 4 {
            "syn-tectonic"
        } else {
            "post-tectonic"
        };
        events.push(E::Subsidence {
            displacement: F {
                value: 115.0 + 35.0 * rng.next(),
                slope_x: 0.0014,
                slope_y: 0.001,
                waves: vec![Wave {
                    amplitude: 22.0,
                    kx: 0.00045,
                    ky: 0.00055,
                    phase: step as f64 * 0.17,
                }],
                ..Default::default()
            },
        });
        // Two increments per fault create growth strata between slip episodes.
        // With four faults this uses the explicit eight-fault evaluation budget.
        for (i, &(mut fault, bend)) in faults.iter().enumerate() {
            let first = ((i + 1) * o.steps / (o.faults + 1)).min(o.steps - 1);
            let second = (first + (o.steps / 6).max(1)).min(o.steps - 1);
            if step == first || step == second {
                let factor = if first == second { 1.0 } else { 0.5 };
                fault.slip.x *= factor;
                fault.slip.y *= factor;
                fault.slip.z *= factor;
                events.push(E::SweptFault { fault, bend });
            }
        }
        let sea = 230.0 + 70.0 * crate::math::sin(step as f64 * 0.67);
        if o.exhumation && step == o.steps * 3 / 4 {
            events.push(E::Erosion {
                surface: F {
                    value: 900.0,
                    slope_x: 0.006,
                    slope_y: -0.012,
                    waves: vec![Wave {
                        amplitude: 90.0,
                        kx: 0.00045,
                        ky: 0.0005,
                        phase: 0.7,
                    }],
                    ..Default::default()
                },
            });
        } else {
            events.push(E::Erosion {
                surface: F::constant(sea - 40.0),
            });
        }
        let count = 3 + (rng.next() * 5.0) as usize;
        let supply = (200.0 + 70.0 * rng.next()) / count as f64;
        for sub in 0..count {
            let id = beds.len();
            let mud = sub == 0;
            let carbonate = !mud && id % 19 == 15;
            beds.push(Bed {
                unit: step,
                phase: phase.into(),
                a: 0.5,
                b: 0.0,
                c: 5000.0,
                d: 1500.0,
                carbonate,
            });
            let front = 1700.0 + step as f64 * 440.0 + sub as f64 * 180.0;
            let fraction = F {
                value: if mud { 0.19 } else { 0.5 },
                fronts: if mud {
                    vec![]
                } else {
                    vec![FaciesFront {
                        amplitude: -0.36,
                        centre: front,
                        width: 1000.0 + 800.0 * rng.next(),
                        skew_y: -0.12,
                    }]
                },
                waves: vec![Wave {
                    amplitude: if mud { 0.045 } else { 0.07 },
                    kx: 0.0007,
                    ky: 0.0008,
                    phase: step as f64 + sub as f64 * 1.4,
                }],
                ..Default::default()
            };
            let cap = F {
                value: supply * (0.8 + 0.4 * rng.next()),
                waves: vec![Wave {
                    amplitude: supply * 0.16,
                    kx: 0.0006,
                    ky: -0.0004,
                    phase: sub as f64,
                }],
                ..Default::default()
            };
            events.push(E::Deposit {
                bed: id,
                thickness: if mud {
                    Some(F {
                        value: 8.0 + 7.0 * rng.next(),
                        waves: vec![Wave {
                            amplitude: 2.0,
                            kx: 0.0005,
                            ky: 0.0006,
                            phase: step as f64,
                        }],
                        ..Default::default()
                    })
                } else {
                    None
                },
                fill_to: if mud {
                    None
                } else {
                    Some(F {
                        value: sea + sub as f64 * 2.0,
                        slope_x: 0.001,
                        slope_y: 0.001,
                        ..Default::default()
                    })
                },
                max_thickness: Some(cap),
                fraction: Some(fraction),
                compact: false,
            });
        }
        if o.compaction {
            events.push(E::Compact {});
        }
        stages.push(events.len());
    }
    Ok(HistorySpec {
        bounds,
        initial_surface: F {
            value: 450.0,
            slope_x: 0.004,
            slope_y: 0.003,
            ..Default::default()
        },
        initial_layers: vec![],
        beds,
        events,
        material_step: o.material_step,
        stages,
    })
}
