//! Observation likelihoods over a finite candidate library. Physical queries
//! use the same continuous history evaluator as rendering and native exports.
use crate::history3d::{
    model::{HistoryEvent, HistorySpec, SpatialField},
    output,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::HashSet;
const ASSUMPTIONS: &str = "Independent Gaussian observation/model-discrepancy errors. Horizons use an explicit occurrence or a normalized equal-weight mixture. Missing horizons have zero likelihood. Weights describe this finite library, not calibrated geological uncertainty.";
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Observation {
    pub kind: String,
    #[serde(default)]
    pub id: Option<String>,
    pub x: f64,
    pub y: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub z: Option<f64>,
    pub value: f64,
    pub sigma: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bed: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unit: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub side: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub occurrence: Option<usize>,
}
fn finite(v: f64, lo: f64, hi: f64) -> bool {
    v.is_finite() && v >= lo && v <= hi
}
pub fn validate(rows: &mut [Observation]) -> Result<(), String> {
    if rows.is_empty() || rows.len() > 1024 {
        return Err("Supply 1..1024 observations".into());
    }
    let mut ids = HashSet::new();
    for (i, r) in rows.iter_mut().enumerate() {
        let id = r.id.get_or_insert_with(|| i.to_string());
        if id.is_empty() || !ids.insert(id.clone()) {
            return Err("Observation ids must be unique and nonempty".into());
        }
        if !finite(r.x, -1e12, 1e12)
            || !finite(r.y, -1e12, 1e12)
            || !finite(r.sigma, 1e-9, 1e9)
            || !finite(
                r.value,
                if r.kind == "velocity" { 1e-9 } else { -1e12 },
                1e12,
            )
        {
            return Err(format!(
                "Invalid coordinates, value or uncertainty for observation {id}"
            ));
        }
        let horizon =
            r.bed.is_some() || r.unit.is_some() || r.side.is_some() || r.occurrence.is_some();
        match r.kind.as_str() {
            "velocity" => {
                if !r.z.is_some_and(|z| finite(z, -1e12, 1e12)) || horizon {
                    return Err(
                        "Velocity requires depth and cannot contain horizon selectors".into(),
                    );
                }
            }
            "horizon" => {
                if r.z.is_some()
                    || r.bed.is_some() == r.unit.is_some()
                    || r.bed.or(r.unit).is_none_or(|v| v > 255)
                    || !matches!(r.side.as_deref(), Some("top" | "bottom"))
                    || r.occurrence.is_some_and(|v| v > 4095)
                {
                    return Err("Horizon requires one bed/unit selector, top/bottom and an optional occurrence".into());
                }
            }
            "surface" | "basement" => {
                if r.z.is_some() || horizon {
                    return Err(
                        "Surface/basement observations cannot contain depth or horizon selectors"
                            .into(),
                    );
                }
            }
            _ => return Err(format!("Unknown observation kind {}", r.kind)),
        }
    }
    Ok(())
}
pub fn gaussian(value: f64, prediction: f64, sigma: f64) -> f64 {
    let q = (value - prediction) / sigma;
    -0.5 * q * q - libm::log(sigma) - 0.5 * libm::log(2. * std::f64::consts::PI)
}
fn mixture(values: &[f64]) -> f64 {
    let max = values.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    if !max.is_finite() {
        return f64::NEG_INFINITY;
    }
    max + libm::log(values.iter().map(|v| libm::exp(*v - max)).sum::<f64>())
        - libm::log(values.len() as f64)
}
pub fn score(
    model: &HistorySpec,
    stage: Option<usize>,
    rows: &[Observation],
) -> Result<Value, String> {
    // Invalid source histories must not be hidden by a missing-horizon score.
    crate::history3d::model::HistoryModel::compile(model.clone())?;
    for r in rows {
        for (v, lo, hi) in [
            (r.x, model.bounds.min.x, model.bounds.max.x),
            (r.y, model.bounds.min.y, model.bounds.max.y),
        ]
        .into_iter()
        .chain(r.z.map(|z| (z, model.bounds.min.z, model.bounds.max.z)))
        {
            if v < lo || v > hi {
                return Err(format!(
                    "Observation {} is outside the model coordinate bounds",
                    r.id.as_deref().unwrap_or("?")
                ));
            }
        }
    }
    let mut points = vec![];
    let mut rays = vec![];
    let mut horizons = vec![];
    let mut indices = vec![];
    if model.beds.is_empty() && rows.iter().any(|r| r.kind == "horizon") {
        return Ok(
            json!({"status":"incompatible","logLikelihood":null,"reason":"No sediment beds for a horizon observation","predictions":[]}),
        );
    }
    for r in rows {
        if r.kind == "velocity" {
            indices.push((0, points.len(), true));
            points.push(json!({"x":r.x,"y":r.y,"z":r.z}));
        } else if r.kind == "horizon" {
            let known = r.bed.map_or_else(
                || model.beds.iter().any(|b| Some(b.unit) == r.unit),
                |bed| bed < model.beds.len(),
            );
            indices.push((1, horizons.len(), known));
            let mut q = json!({"x":r.x,"y":r.y});
            if known {
                if let Some(b) = r.bed {
                    q["bed"] = json!(b);
                } else {
                    q["unit"] = json!(r.unit);
                }
            } else {
                q["bed"] = json!(0);
            }
            horizons.push(q);
        } else {
            indices.push((2, rays.len(), true));
            rays.push(json!([r.x, r.y]));
        }
    }
    let raw = output::request(
        json!({"kind":"history3d","model":model,"query":{"stage":stage,"sectionsY":[],"points":points,"rays":rays,"horizons":horizons}}),
    )?;
    let mut predictions = vec![];
    let mut total = 0.;
    for (r, (target, index, known)) in rows.iter().zip(indices) {
        let (prediction, likelihood, interpretation) = if target == 1 {
            let mut depths = if known {
                raw["horizons"][index]["contacts"]
                    .as_array()
                    .ok_or("Missing horizon query result")?
                    .iter()
                    .map(|c| {
                        c[if r.side.as_deref() == Some("top") {
                            0
                        } else {
                            1
                        }]
                        .as_f64()
                        .ok_or("Invalid horizon contact")
                    })
                    .collect::<Result<Vec<_>, _>>()?
            } else {
                vec![]
            };
            if let Some(n) = r.occurrence {
                depths = depths.get(n).copied().into_iter().collect();
            }
            let ll = mixture(
                &depths
                    .iter()
                    .map(|d| gaussian(r.value, *d, r.sigma))
                    .collect::<Vec<_>>(),
            );
            (
                json!(depths),
                ll,
                if let Some(n) = r.occurrence {
                    format!("Occurrence {n}, shallowest first")
                } else {
                    "Equal-weight mixture across all occurrences".into()
                },
            )
        } else {
            let prediction = raw[if target == 0 { "points" } else { "rays" }][index]
                [if target == 0 { "velocity" } else { &r.kind }]
            .as_f64()
            .ok_or("Missing continuous observation prediction")?;
            (
                json!(prediction),
                gaussian(r.value, prediction, r.sigma),
                "Independent Gaussian; sigma supplied by caller".into(),
            )
        };
        total += likelihood;
        predictions.push(json!({"id":r.id,"kind":r.kind,"prediction":prediction,"value":r.value,"sigma":r.sigma,"logLikelihood":if likelihood.is_finite(){Some(likelihood)}else{None},"interpretation":interpretation}));
    }
    Ok(
        json!({"status":if total.is_finite(){"compatible"}else{"incompatible"},"logLikelihood":if total.is_finite(){Some(total)}else{None},"predictions":predictions,"assumptions":ASSUMPTIONS,"stats":raw["stats"]}),
    )
}
pub fn normalize(scores: &[Value], prior: Option<&[f64]>) -> Result<Value, String> {
    if scores.is_empty() {
        return Err("No candidates supplied".into());
    }
    let mut prior = prior.map_or_else(|| vec![1.; scores.len()], Vec::from);
    if prior.len() != scores.len() || prior.iter().any(|p| !p.is_finite() || *p < 0.) {
        return Err("Prior weights must be finite, nonnegative and nonzero".into());
    }
    let max = prior.iter().copied().fold(0., f64::max);
    if max == 0. {
        return Err("Prior weights must be nonzero".into());
    }
    for p in &mut prior {
        *p /= max;
    }
    let sum = prior.iter().sum::<f64>();
    for p in &mut prior {
        *p /= sum;
    }
    let logs = scores
        .iter()
        .zip(&prior)
        .map(|(s, p)| match s["logLikelihood"].as_f64() {
            Some(v) if v.is_finite() && *p > 0. => v + libm::log(*p),
            _ => f64::NEG_INFINITY,
        })
        .collect::<Vec<_>>();
    let max = logs.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    if !max.is_finite() {
        return Ok(
            json!({"status":"no-compatible-candidates","weights":vec![0.;scores.len()],"effectiveSampleSize":0.,"positiveWeightCandidates":0}),
        );
    }
    let mut weights = logs.iter().map(|v| libm::exp(*v - max)).collect::<Vec<_>>();
    let sum = weights.iter().sum::<f64>();
    for w in &mut weights {
        *w /= sum;
    }
    let ess = 1. / weights.iter().map(|w| w * w).sum::<f64>();
    let positive = weights.iter().filter(|v| **v > 0.).count();
    Ok(
        json!({"status":"weighted","weights":weights,"effectiveSampleSize":ess,"positiveWeightCandidates":positive,"interpretation":"Weights over this finite candidate library and stated prior/likelihood only. Small ESS calls for more candidates; it does not establish narrow geological uncertainty or calibrated credible intervals."}),
    )
}
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Candidate {
    pub id: String,
    pub model: HistorySpec,
    #[serde(default)]
    pub stage: Option<usize>,
    #[serde(default)]
    pub parameters: Value,
}
fn scales() -> Vec<f64> {
    vec![1.]
}
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Library {
    #[serde(default = "scales")]
    pub slip_scales: Vec<f64>,
    #[serde(default = "scales")]
    pub subsidence_scales: Vec<f64>,
    #[serde(default)]
    pub curve_strengths: Vec<f64>,
}
fn scale_field(f: &mut SpatialField, k: f64) {
    if k == 1. {
        return;
    }
    f.value *= k;
    f.slope_x *= k;
    f.slope_y *= k;
    for w in &mut f.waves {
        w.amplitude *= k;
    }
    for front in &mut f.fronts {
        front.amplitude *= k;
    }
}
fn check_scales(values: &[f64], lo: f64, hi: f64) -> Result<(), String> {
    if values.is_empty()
        || values.len() > 9
        || values
            .iter()
            .enumerate()
            .any(|(i, v)| !finite(*v, lo, hi) || values[..i].contains(v))
    {
        return Err(
            "Candidate ranges must contain 1..9 distinct values inside supported parameter bounds"
                .into(),
        );
    }
    Ok(())
}
pub fn library(
    base: &HistorySpec,
    stage: Option<usize>,
    l: Library,
) -> Result<Vec<Candidate>, String> {
    check_scales(&l.slip_scales, 0.25, 2.)?;
    check_scales(&l.subsidence_scales, 0.5, 2.)?;
    let curves = if l.curve_strengths.is_empty() {
        vec![None]
    } else {
        check_scales(&l.curve_strengths, 0., 0.95)?;
        if !base
            .events
            .iter()
            .any(|e| matches!(e, HistoryEvent::ListricFault { .. }))
        {
            return Err("Curve-strength search requires listric faults".into());
        }
        l.curve_strengths.iter().map(|v| Some(*v)).collect()
    };
    if l.slip_scales.len() * l.subsidence_scales.len() * curves.len() > 64 {
        return Err("Candidate library exceeds 64 models".into());
    }
    let mut out = vec![];
    for slip in l.slip_scales {
        for subsidence in &l.subsidence_scales {
            for curve in &curves {
                let mut model = base.clone();
                for e in &mut model.events {
                    match e {
                        HistoryEvent::Fault { fault }
                        | HistoryEvent::SweptFault { fault, .. }
                        | HistoryEvent::ListricFault { fault, .. } => {
                            if slip != 1. {
                                fault.slip.x *= slip;
                                fault.slip.y *= slip;
                                fault.slip.z *= slip;
                            }
                        }
                        HistoryEvent::Subsidence { displacement } => {
                            scale_field(displacement, *subsidence)
                        }
                        _ => {}
                    }
                    if let (Some(c), HistoryEvent::ListricFault { curve, .. }) = (curve, e) {
                        curve.strength = *c;
                    }
                }
                out.push(Candidate{id:format!("candidate-{}",out.len()+1),model,stage,parameters:json!({"slipScale":slip,"subsidenceScale":subsidence,"curveStrength":curve})});
            }
        }
    }
    Ok(out)
}
pub fn request(input: Value) -> Result<Value, String> {
    let mut observations: Vec<Observation> =
        serde_json::from_value(input["observations"].clone()).map_err(|e| e.to_string())?;
    validate(&mut observations)?;
    let has_candidates = input.get("candidates").is_some();
    let has_base = input.get("baseModel").is_some();
    if has_candidates == has_base {
        return Err("Choose explicit candidates or a base model and parameter library".into());
    }
    let candidates: Vec<Candidate> = if has_candidates {
        serde_json::from_value(input["candidates"].clone()).map_err(|e| e.to_string())?
    } else {
        let base: HistorySpec =
            serde_json::from_value(input["baseModel"].clone()).map_err(|e| e.to_string())?;
        let ranges: Library =
            serde_json::from_value(input["library"].clone()).map_err(|e| e.to_string())?;
        let stage = input
            .get("stage")
            .filter(|v| !v.is_null())
            .map(|v| {
                v.as_u64()
                    .map(|n| n as usize)
                    .ok_or("Invalid conditioning stage")
            })
            .transpose()?;
        library(&base, stage, ranges)?
    };
    if candidates.is_empty() || candidates.len() > 64 {
        return Err("Supply 1..64 candidate histories".into());
    }
    let mut ids = HashSet::new();
    let mut scores = vec![];
    for c in &candidates {
        if c.id.is_empty() || !ids.insert(&c.id) {
            return Err("Candidate ids must be unique and nonempty".into());
        }
        scores.push(score(&c.model, c.stage, &observations)?);
    }
    let prior: Option<Vec<f64>> = input
        .get("priorWeights")
        .filter(|v| !v.is_null())
        .map(|v| serde_json::from_value(v.clone()).map_err(|e| e.to_string()))
        .transpose()?;
    let mut result = normalize(&scores, prior.as_deref())?;
    let include = input["includeModels"].as_bool().unwrap_or(false);
    result["schema"] = json!("earthforge-conditioning-v2");
    result["observations"] = json!(observations);
    result["scores"] = json!(scores);
    result["assumptions"] = json!(ASSUMPTIONS);
    result["candidates"]=json!(candidates.iter().enumerate().map(|(i,c)|{let mut v=json!({"id":c.id,"stage":c.stage,"parameters":c.parameters,"score":scores[i],"weight":result["weights"][i]});if include{v["model"]=json!(c.model);}v}).collect::<Vec<_>>());
    Ok(result)
}
