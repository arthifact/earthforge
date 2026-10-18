use earthforge_core::{api, conditioning};
use serde_json::{Value, json};
fn model() -> Value {
    let b = json!({"unit":0,"phase":"analytic","a":0.4,"b":0.,"c":0.,"d":100.,"carbonate":false});
    let layer = |bed, height| json!({"bed":bed,"height":height,"solid":0.6*height,"fraction":0.4,"burial":1000.,"loading":800.});
    let mut second = b.clone();
    second["unit"] = json!(1);
    json!({"bounds":{"min":{"x":0.,"y":0.,"z":0.},"max":{"x":1000.,"y":1000.,"z":2000.}},"initialSurface":{"value":100.,"slopeX":0.1,"slopeY":0.2},"initialLayers":[layer(0,20.),layer(0,30.),layer(1,75.),layer(0,25.)],"beds":[b,second],"events":[],"materialStep":10.})
}
fn run(obs: Value) -> Value {
    api::request(json!({"kind":"condition","candidates":[{"id":"reference","model":model()}],"observations":obs})).unwrap()
}
#[test]
fn repeated_horizons_use_normalized_mixture_and_explicit_occurrences() {
    let row = json!({"kind":"horizon","x":0.,"y":0.,"bed":0,"side":"top","value":160.,"sigma":20.});
    let r = run(json!([row]));
    assert_eq!(
        r["scores"][0]["predictions"][0]["prediction"],
        json!([100., 225.])
    );
    let a = conditioning::gaussian(160., 100., 20.).exp();
    let b = conditioning::gaussian(160., 225., 20.).exp();
    assert!(
        (r["scores"][0]["logLikelihood"].as_f64().unwrap() - ((a + b) / 2.).ln()).abs() < 1e-12
    );
    let mut explicit = row.clone();
    explicit["occurrence"] = json!(1);
    assert!(
        (run(json!([explicit]))["scores"][0]["logLikelihood"]
            .as_f64()
            .unwrap()
            - b.ln())
        .abs()
            < 1e-12
    );
    explicit["occurrence"] = json!(2);
    assert_eq!(run(json!([explicit]))["status"], "no-compatible-candidates");
}
#[test]
fn continuous_well_surface_and_missing_unit_predictions_are_explicit() {
    let r = run(
        json!([{"kind":"velocity","x":50.,"y":60.,"z":20.,"value":1500.,"sigma":50.},{"kind":"surface","x":50.,"y":60.,"value":117.,"sigma":10.}]),
    );
    assert_eq!(r["scores"][0]["predictions"][0]["prediction"], 1500.);
    assert_eq!(r["scores"][0]["predictions"][1]["prediction"], 117.);
    assert!(
        (r["scores"][0]["logLikelihood"].as_f64().unwrap()
            + (50. * 10. * 2. * std::f64::consts::PI).ln())
        .abs()
            < 1e-12
    );
    let r = run(
        json!([{"kind":"horizon","x":0.,"y":0.,"unit":99,"side":"top","value":100.,"sigma":10.}]),
    );
    assert_eq!(r["weights"], json!([0.]));
    assert_eq!(r["scores"][0]["predictions"][0]["prediction"], json!([]));
}
#[test]
fn invalid_observations_are_rejected_without_silent_exclusions() {
    let base = json!({"kind":"velocity","x":0.,"y":0.,"z":0.,"value":1500.,"sigma":20.});
    for (k, v) in [
        ("sigma", json!(0)),
        ("sigmaa", json!(20)),
        ("x", json!(1001)),
        ("bed", json!(0)),
        ("value", json!(-1)),
    ] {
        let mut row = base.clone();
        row[k] = v;
        assert!(api::request(json!({"kind":"condition","candidates":[{"id":"a","model":model()}],"observations":[row]})).is_err());
    }
    let mut row = base;
    row["id"] = json!("same");
    assert!(api::request(json!({"kind":"condition","candidates":[{"id":"a","model":model()}],"observations":[row.clone(),row]})).is_err());
}
#[test]
fn likelihood_normalization_is_stable_and_respects_priors() {
    let s = [
        json!({"logLikelihood":-100000.}),
        json!({"logLikelihood":-100002.}),
    ];
    let r = conditioning::normalize(&s, None).unwrap();
    let expected = 1. / (1. + (-2.0_f64).exp());
    assert!((r["weights"][0].as_f64().unwrap() - expected).abs() < 1e-12);
    let equal = [json!({"logLikelihood":0.}), json!({"logLikelihood":0.})];
    assert_eq!(
        conditioning::normalize(&equal, Some(&[1e308, 1e308])).unwrap()["weights"],
        json!([0.5, 0.5])
    );
    assert_eq!(
        conditioning::normalize(&equal, Some(&[0., 1.])).unwrap()["weights"],
        json!([0., 1.])
    );
    for p in [[0., 0.], [-1., 1.], [f64::NAN, 1.]] {
        assert!(conditioning::normalize(&equal, Some(&p)).is_err());
    }
}
#[test]
fn bounded_candidate_library_preserves_source_and_exports_exact_selected_models() {
    let source=api::request(json!({"kind":"history3d","options":{"geology":"listric-v1","steps":6,"faults":1,"seed":1001},"includeModel":true,"query":{"sectionsY":[]}})).unwrap()["sourceModel"].clone();
    let request = json!({"kind":"condition","baseModel":source,"stage":4,"library":{"slipScales":[0.7,1.,1.3],"subsidenceScales":[1.],"curveStrengths":[0.4,0.7,0.9]},"includeModels":true,"observations":[{"kind":"surface","x":5000.,"y":5000.,"value":800.,"sigma":100.}]});
    let result = api::request(request.clone()).unwrap();
    assert_eq!(result["candidates"].as_array().unwrap().len(), 9);
    assert_eq!(result["candidates"][4]["model"], source);
    for c in result["candidates"].as_array().unwrap() {
        assert_eq!(c["stage"], 4);
        let solo=api::request(json!({"kind":"condition","candidates":[{"id":"selected","model":c["model"],"stage":4}],"observations":request["observations"]})).unwrap();
        assert_eq!(solo["scores"][0], c["score"]);
    }
    let mut bad = request;
    bad["library"]["slipScales"] = json!([1., 1.]);
    assert!(api::request(bad).is_err());
}
