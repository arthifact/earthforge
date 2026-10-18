import base64
import copy
import json
import math
import os
import struct
import subprocess
import shutil
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path
from unittest.mock import patch

import numpy as np

from earthforge import Engine, EngineError, EnsemblePlan, Grid, History, Parameters, SCENARIOS, acoustic_shot, condition_histories, load_dataset, load_npz, run_ensemble, weighted_quantile
from earthforge._util import array_sha, atomic_json, digest, job_lock
from earthforge.conditioning import gaussian_log_likelihood, log_mean_exp, normalize_weights, score_history, validate_observations


def analytic_history():
    bed = {"unit": 0, "phase": "independent analytical fixture", "a": .4, "b": 0, "c": 0, "d": 100, "carbonate": False}
    def layer(b, height):
        return {"bed": b, "height": height, "solid": .6*height, "fraction": .4, "burial": 1000, "loading": 800}
    return History({"bounds": {"min": dict(x=0, y=0, z=0), "max": dict(x=1000, y=1000, z=2000)}, "initialSurface": {"value": 100, "slopeX": .1, "slopeY": .2}, "initialLayers": [layer(0, 20), layer(0, 30), layer(1, 75), layer(0, 25)], "beds": [bed, dict(bed, unit=1)], "events": [], "materialStep": 10})


class ResearchTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = Engine()
        cls.history = analytic_history()
        cls.grid = Grid(nx=7, ny=5, nz=31, dx=110.1, dy=140.3, dz=17.1, origin=(13.7, 17.3, 90.1))
        cls.volume = cls.engine.sample(cls.history, cls.grid, max_rays=35)

    def test_coordinate_order_and_material_properties_against_analytic_layers(self):
        v = self.volume; g = self.grid
        for k in range(g.nz):
            for j in range(g.ny):
                for i in range(g.nx):
                    x = g.origin[0]+i*g.dx; y = g.origin[1]+j*g.dy; z = g.origin[2]+k*g.dz
                    depth = z-(100+.1*x+.2*y)
                    expected = -1 if depth < 0 else 0 if depth < 50 else 1 if depth < 125 else 0 if depth < 150 else -2
                    self.assertEqual(v.fields["beds"][k, j, i], expected)
                    if expected >= 0:
                        self.assertAlmostEqual(v.fields["porosity"][k, j, i], .4)
                        self.assertEqual(v.fields["max_burial"][k, j, i], 1000)
                    else:
                        self.assertTrue(np.isnan(v.fields["porosity"][k, j, i]))
                        self.assertEqual(v.fields["velocity"][k, j, i], 1500 if expected == -1 else 5200)

    def test_tiling_does_not_change_any_array_or_content_digest(self):
        tiled = self.engine.sample(self.history, self.grid, max_rays=3, max_nodes=70)
        self.assertEqual(tiled.content_digest(), self.volume.content_digest())
        for name in tiled.fields:
            np.testing.assert_array_equal(tiled.fields[name], self.volume.fields[name])

    def test_tile_export_preserves_exact_global_coordinates(self):
        grid = Grid(9, 3, 4, .1, .1, .1, (.1,.1,100))
        tile = self.engine.sample_tile(self.history, grid, {"start":[2,0,0],"count":[6,3,4]})
        self.assertFalse(np.array_equal(tile.coordinates()["x"], tile.grid.coordinates()["x"]))
        with tempfile.TemporaryDirectory() as t:
            p = tile.save_npz(Path(t)/"tile.npz")
            restored = load_npz(p)
            np.testing.assert_array_equal(restored.coordinates()["x"], grid.coordinates()["x"][2:8])
            with self.assertRaises(ValueError):
                tile.save_vti(Path(t)/"tile.vti")

    def test_dataset_recovers_interruption_before_first_array_allocation(self):
        with tempfile.TemporaryDirectory() as t:
            target = Path(t)/"dataset"
            with patch("earthforge.dataset._open_fields", side_effect=OSError("Intentional allocation interruption")):
                with self.assertRaises(OSError):
                    self.engine.export_dataset(self.history, self.grid, target)
            self.engine.export_dataset(self.history, self.grid, target, resume=True)
            self.assertEqual(load_dataset(target).content_digest(), self.volume.content_digest())

    def test_dataset_provenance_modification_is_detected(self):
        with tempfile.TemporaryDirectory() as t:
            target = Path(t)/"dataset"; self.engine.export_dataset(self.history, self.grid, target)
            p = target/"dataset.json"; r = json.loads(p.read_text()); r["metadata"]["units"]["velocity"] = "km/s"; p.write_text(json.dumps(r))
            with self.assertRaises(ValueError):
                load_dataset(target)
            with self.assertRaises(ValueError):
                self.engine.export_dataset(self.history, self.grid, target, resume=True)

    def test_history_copies_are_independent_and_fingerprints_reject_tampering(self):
        model = self.history.model; model["events"].append({"kind": "compact"})
        self.assertEqual(self.history.model["events"], [])
        record = self.history.to_record(); record["model"]["materialStep"] = 20
        with self.assertRaises(ValueError):
            History.from_record(record)

    def test_three_scenarios_keep_exact_original_source_with_default_parameters(self):
        for name, scenario in SCENARIOS.items():
            raw = self.engine.request({"kind": "history3d", "options": dict(scenario["options"], seed=1001, materialStep=10), "includeModel": True, "query": {"sectionsY": []}})
            self.assertEqual(self.engine.build_history(name).model, raw["sourceModel"])

    def test_scenario_parameters_change_prescribed_inputs_without_mutating_source(self):
        a = self.engine.build_history(seed=1001, steps=6, faults=1)
        b = self.engine.build_history(seed=1001, steps=6, faults=1, parameters=Parameters(slip_scale=1.5, sediment_supply_scale=.7, facies_shift_m=300))
        self.assertEqual(a.model["beds"], b.model["beds"])
        for old, new in zip(a.model["events"], b.model["events"]):
            if old["kind"] == "sweptFault":
                for axis in "xyz":
                    self.assertEqual(new["fault"]["slip"][axis], old["fault"]["slip"][axis]*1.5)
            if old["kind"] == "deposit" and old.get("fraction", {}).get("fronts"):
                self.assertEqual(new["fraction"]["fronts"][0]["centre"], old["fraction"]["fronts"][0]["centre"]+300)
        self.assertEqual(a.model_sha256, digest(a.model))

    def test_npz_standard_numpy_roundtrip_and_no_pickle(self):
        with tempfile.TemporaryDirectory() as t:
            path = self.volume.save_npz(Path(t)/"volume.npz")
            with np.load(path, allow_pickle=False) as z:
                self.assertEqual(z["velocity"].dtype, np.dtype("<f8"))
                self.assertEqual(z["velocity"].shape, self.grid.shape)
                self.assertEqual(z["beds"].dtype, np.dtype("<i4"))
                self.assertEqual(json.loads(str(z["metadata_json"]))["coordinates"].split(';')[0], "metres")
                self.assertFalse(any(z[n].dtype.hasobject for n in z.files))
            self.assertEqual(load_npz(path).content_digest(), self.volume.content_digest())
            old = path.read_bytes()
            with self.assertRaises(FileExistsError):
                self.volume.save_npz(path)
            self.assertEqual(old, path.read_bytes())

    def test_npz_modified_array_is_detected(self):
        with tempfile.TemporaryDirectory() as t:
            p = self.volume.save_npz(Path(t)/"volume.npz")
            with np.load(p, allow_pickle=False) as z:
                arrays = {n: z[n].copy() for n in z.files}
            arrays["velocity"][0, 0, 0] += 1
            np.savez(p, **arrays)
            with self.assertRaises(ValueError):
                load_npz(p)

    def test_vti_independent_xml_and_base64_layout_reader(self):
        with tempfile.TemporaryDirectory() as t:
            p = self.volume.save_vti(Path(t)/"volume.vti")
            root = ET.parse(p).getroot()
            image = root.find("ImageData")
            self.assertEqual(tuple(map(float, image.attrib["Origin"].split())), self.grid.origin)
            for element in root.findall(".//PointData/DataArray"):
                name = element.attrib["Name"]; expected = self.volume.fields[name]
                raw = base64.b64decode(element.text, validate=True)
                self.assertEqual(struct.unpack("<Q", raw[:8])[0], expected.nbytes)
                actual = np.frombuffer(raw[8:], dtype=expected.dtype).reshape(expected.shape)
                np.testing.assert_array_equal(actual, expected)

    def test_vti_external_vtk_reader_if_available(self):
        try:
            from vtkmodules.vtkIOXML import vtkXMLImageDataReader
            from vtkmodules.util.numpy_support import vtk_to_numpy
        except ImportError:
            self.skipTest("Independent VTK reader not installed; XML/base64 test still runs")
        with tempfile.TemporaryDirectory() as t:
            p = self.volume.save_vti(Path(t)/"volume.vti")
            reader = vtkXMLImageDataReader(); reader.SetFileName(str(p)); reader.Update(); data = reader.GetOutput()
            self.assertEqual(reader.GetErrorCode(), 0)
            self.assertEqual(data.GetDimensions(), self.grid.counts)
            self.assertEqual(data.GetOrigin(), self.grid.origin)
            self.assertEqual(data.GetSpacing(), self.grid.spacing)
            for name in ("velocity", "beds", "porosity", "max_burial"):
                a = vtk_to_numpy(data.GetPointData().GetArray(name)).reshape(self.grid.shape)
                np.testing.assert_array_equal(a, self.volume.fields[name])

    def test_interrupted_dataset_resumes_without_repeating_completed_tile(self):
        with tempfile.TemporaryDirectory() as t:
            target = Path(t)/"dataset"
            def interrupt(n, total):
                raise RuntimeError("Intentional interruption after committed tile")
            with self.assertRaises(RuntimeError):
                self.engine.export_dataset(self.history, self.grid, target, max_rays=7, on_progress=interrupt)
            with self.assertRaises(ValueError):
                load_dataset(target)
            calls = []
            original = self.engine.sample_tile
            def count(*args):
                calls.append(args[2]); return original(*args)
            with patch.object(self.engine, "sample_tile", side_effect=count):
                self.engine.export_dataset(self.history, self.grid, target, max_rays=7, resume=True)
            self.assertEqual(len(calls), 4)
            self.assertEqual(load_dataset(target).content_digest(), self.volume.content_digest())
            with patch.object(self.engine, "sample_tile", side_effect=AssertionError("Unexpected solve")):
                self.engine.export_dataset(self.history, self.grid, target, max_rays=7, resume=True)

    def test_resume_rejects_changed_plan_and_modified_completed_arrays(self):
        with tempfile.TemporaryDirectory() as t:
            target = Path(t)/"dataset"; self.engine.export_dataset(self.history, self.grid, target)
            with self.assertRaises(ValueError):
                self.engine.export_dataset(self.history, self.grid, target, resume=True, max_rays=17)
            a = np.load(target/"velocity.npy", mmap_mode="r+", allow_pickle=False); a[0, 0, 0] += 1; a.flush(); del a
            with self.assertRaises(ValueError):
                self.engine.export_dataset(self.history, self.grid, target, resume=True)
            with self.assertRaises(ValueError):
                load_dataset(target)

    def test_lock_is_exclusive_and_released_after_failure(self):
        with tempfile.TemporaryDirectory() as t:
            with job_lock(Path(t)):
                with self.assertRaises(RuntimeError):
                    with job_lock(Path(t)):
                        pass
            with job_lock(Path(t)):
                pass

    def test_model_budget_rejects_before_output_creation(self):
        with tempfile.TemporaryDirectory() as t:
            p = Path(t)/"dataset"
            with self.assertRaises(ValueError):
                self.engine.export_dataset(self.history, self.grid, p, max_bytes=1)
            self.assertFalse(p.exists())

    def test_changed_native_binary_is_detected_before_another_query(self):
        with tempfile.TemporaryDirectory() as t:
            path = Path(t)/self.engine.path.name
            shutil.copy2(self.engine.path,path)
            e = Engine(path)
            with path.open('ab') as f:
                f.write(b'changed')
            with self.assertRaises(EngineError):
                e.request({"kind":"version"})

    def test_horizon_likelihood_is_normalized_mixture_over_all_occurrences(self):
        # At x=y=0, bed 0 is [100,150] and [225,250].
        obs = [{"kind": "horizon", "x": 0, "y": 0, "bed": 0, "side": "top", "value": 160, "sigma": 20}]
        score = score_history(self.engine, self.history, obs)
        self.assertEqual(score["predictions"][0]["prediction"], [100, 225])
        a = math.exp(-.5*((160-100)/20)**2)/(20*math.sqrt(2*math.pi)); b = math.exp(-.5*((160-225)/20)**2)/(20*math.sqrt(2*math.pi))
        self.assertAlmostEqual(score["logLikelihood"], math.log((a+b)/2), places=12)
        obs[0]["occurrence"] = 1
        self.assertAlmostEqual(score_history(self.engine, self.history, obs)["logLikelihood"], math.log(b))
        obs[0]["occurrence"] = 2
        self.assertEqual(score_history(self.engine, self.history, obs)["status"], "incompatible")

    def test_well_velocity_and_surface_constraints_query_continuous_history(self):
        obs = [{"kind": "velocity", "x": 50, "y": 60, "z": 20, "value": 1500, "sigma": 50}, {"kind": "surface", "x": 50, "y": 60, "value": 117, "sigma": 10}]
        r = score_history(self.engine, self.history, obs)
        self.assertEqual([p["prediction"] for p in r["predictions"]], [1500, 117])
        self.assertAlmostEqual(r["logLikelihood"], -math.log(50*10*2*math.pi))

    def test_depositional_unit_selector_and_missing_units(self):
        obs = [{"kind":"horizon","x":0,"y":0,"unit":0,"side":"top","value":100,"sigma":10}]
        self.assertEqual(score_history(self.engine,self.history,obs)["predictions"][0]["prediction"],[100,225])
        obs[0]["unit"] = 99
        self.assertEqual(score_history(self.engine,self.history,obs)["status"],"incompatible")
        obs[0]["bed"] = 0
        with self.assertRaises(ValueError):
            validate_observations(obs)

    def test_analytic_importance_weights_ess_underflow_and_invalid_priors(self):
        r = normalize_weights([{"logLikelihood": 0}, {"logLikelihood": -2}])
        expected = 1/(1+math.exp(-2)); self.assertAlmostEqual(r["weights"][0], expected); self.assertAlmostEqual(r["effectiveSampleSize"], 1/(expected**2+(1-expected)**2))
        r = normalize_weights([{"logLikelihood": -100000}, {"logLikelihood": -100002}]); self.assertAlmostEqual(r["weights"][0], expected)
        self.assertEqual(normalize_weights([{"logLikelihood": None}])["status"], "no-compatible-candidates")
        self.assertEqual(normalize_weights([{"logLikelihood": 0}, {"logLikelihood": 0}], [1e308, 1e308])["weights"], [.5, .5])
        for prior in ([0, 0], [-1, 1], [float('nan'), 1]):
            with self.assertRaises(ValueError):
                normalize_weights([{"logLikelihood": 0}, {"logLikelihood": 0}], prior)
        self.assertEqual(weighted_quantile([1, 2, 3], [0, .8, .2], [0, .5, 1]), [2, 2, 3])

    def test_observation_typos_zero_errors_and_outside_coordinates_rejected(self):
        base = dict(kind="velocity", x=0, y=0, z=0, value=1500, sigma=20)
        for row in [dict(base, sigma=0), dict(base, sigmaa=20), dict(base, value=float('nan'))]:
            with self.assertRaises(ValueError):
                validate_observations([row])
        with self.assertRaises(ValueError):
            score_history(self.engine, self.history, [dict(base, x=1001)])

    def test_curved_recipe_controls_and_parameter_transform_preserve_source(self):
        h = self.engine.build_history("listric-rift-v1", steps=6, faults=1, curve_strength=.65, curve_length_m=2200, fault_dip_degrees=60, fault_slip_scale=1.1)
        faults = [e for e in h.model["events"] if e["kind"] == "listricFault"]
        self.assertEqual(len(faults), 2)
        self.assertEqual(faults[0]["curve"], {"strength": .65, "length": 2200})
        self.assertAlmostEqual(faults[0]["fault"]["normal"]["z"], .5)
        scaled = self.engine.build_history("listric-rift-v1", steps=6, faults=1, curve_strength=.65, curve_length_m=2200, fault_dip_degrees=60, fault_slip_scale=1.1, parameters=Parameters(slip_scale=1.2))
        changed = [e for e in scaled.model["events"] if e["kind"] == "listricFault"]
        for axis in "xyz":
            self.assertEqual(changed[0]["fault"]["slip"][axis], faults[0]["fault"]["slip"][axis]*1.2)
        self.assertEqual(faults[0]["curve"], {"strength": .65, "length": 2200})
        with self.assertRaises(ValueError):
            self.engine.build_history("rift-v1", curve_strength=.5)

    def test_shared_rust_conditioning_matches_python_reference_weights(self):
        histories = []
        for shift in [-20, 0, 35]:
            model = self.history.model
            model["initialSurface"]["value"] += shift
            histories.append(History(model))
        obs = [{"id":"surface", "kind":"surface", "x":50, "y":60, "value":117, "sigma":12}, {"id":"horizon", "kind":"horizon", "x":0, "y":0, "unit":0, "side":"top", "value":160, "sigma":20}]
        result = condition_histories(self.engine, histories, obs, prior_weights=[1, 2, .5])
        reference = []
        for shift in [-20, 0, 35]:
            ll = gaussian_log_likelihood(117, 117+shift, 12) + log_mean_exp([gaussian_log_likelihood(160,100+shift,20),gaussian_log_likelihood(160,225+shift,20)])
            reference.append({"logLikelihood": ll})
        expected = normalize_weights(reference, [1, 2, .5])
        np.testing.assert_allclose(result["weights"], expected["weights"], rtol=1e-12, atol=1e-14)
        self.assertAlmostEqual(result["effectiveSampleSize"], expected["effectiveSampleSize"], places=12)
        for score, ref in zip(result["scores"], reference):
            self.assertAlmostEqual(score["logLikelihood"], ref["logLikelihood"], places=12)

    def test_selected_conditioned_browser_model_reproduces_the_same_history(self):
        base = self.engine.build_history("listric-rift-v1", steps=6, faults=1)
        report = self.engine.request({"kind":"condition", "baseModel":base.model, "stage":4, "library":{"slipScales":[.7,1,1.3],"subsidenceScales":[1]}, "observations":[{"id":"well", "kind":"velocity", "x":3500,"y":4200,"z":1400,"value":3000,"sigma":100}], "includeModels":True})
        candidate = report["candidates"][0]
        browser = {"format":"earthforge-block-v1", "request":{"model":candidate["model"],"query":{"stage":4}},"conditioning":{"schema":"earthforge-browser-conditioning-v1","result":report}}
        restored = History.from_record(browser)
        expected = History(candidate["model"],stage=4)
        self.assertEqual(self.engine.points(restored,[(3500,4200,1400)]),self.engine.points(expected,[(3500,4200,1400)]))
        self.assertEqual(restored.model_sha256,expected.model_sha256)

    def test_finite_prior_draws_repeat_and_stay_in_explicit_ranges(self):
        plan = EnsemblePlan(count=20, priors={"slip_scale": [.7, 1.4], "facies_shift_m": [-100, 200]})
        self.assertEqual(plan.to_record(), plan.to_record())
        seeds = set()
        for c in plan.candidates():
            seeds.add(c["seed"]); self.assertTrue(.7 <= c["parameters"]["slip_scale"] < 1.4); self.assertTrue(-100 <= c["parameters"]["facies_shift_m"] < 200)
        self.assertEqual(len(seeds), 20)
        self.assertEqual(plan.candidates(), EnsemblePlan(count=40, priors=plan.priors).candidates()[:20])
        self.assertNotEqual(sorted(seeds), list(range(plan.seed,plan.seed+plan.count)))
        with self.assertRaises(ValueError):
            EnsemblePlan(priors={"slipp_scale": [1, 2]})

    def test_ensemble_reports_failures_and_resumes_only_failed_members(self):
        plan = EnsemblePlan(count=2, options={"steps": 2, "faults": 0}); g = Grid(nx=3, ny=3, nz=11, dx=1000, dy=1000, dz=100)
        with tempfile.TemporaryDirectory() as t:
            target = Path(t)/"study"
            with patch.object(self.engine, "export_dataset", side_effect=RuntimeError("Intentional job failure")):
                r = run_ensemble(self.engine, plan, g, target)
            self.assertEqual(r["failures"], 2)
            r = run_ensemble(self.engine, plan, g, target, resume=True)
            self.assertEqual(r["state"], "complete"); self.assertEqual(r["weighting"]["weights"], [.5, .5])
            with patch.object(self.engine, "build_history", side_effect=AssertionError("Unexpected regeneration")):
                run_ensemble(self.engine, plan, g, target, resume=True)

    def test_cli_generate_and_browser_history_use_original_grid(self):
        with tempfile.TemporaryDirectory() as t:
            folder = Path(t); view = {"format": "earthforge-block-v1", "request": {"model": self.history.model, "query": {"grid": self.grid.to_dict()}}, "research": {"scenario": "explicit-model", "seed": 5}}
            (folder/"view.json").write_text(json.dumps(view))
            p = subprocess.run([sys.executable, "-m", "earthforge", "--engine", str(self.engine.path), "generate", "--history", str(folder/"view.json"), "--out", str(folder/"volume")], capture_output=True, text=True)
            self.assertEqual(p.returncode, 0, p.stderr)
            self.assertEqual(load_dataset(folder/"volume").content_digest(), self.volume.content_digest())

    def test_paired_acoustic_artifact_preserves_kernel_traces_and_rejects_undersampling(self):
        v = self.engine.sample(self.history, Grid(nx=11, ny=11, nz=11, dx=10, dy=10, dz=10, origin=(100,100,0)))
        shot = acoustic_shot(self.engine, v, source=(150,150,50), receivers=[(160,150,50),(170,150,50)], frequency_hz=10, duration_seconds=.2, sponge_cells=8)
        self.assertEqual(shot.metadata["solver"]["dimensions"], 3)
        self.assertTrue(np.any(shot.traces != 0))
        self.assertEqual(shot.traces.shape[0], 2)
        with tempfile.TemporaryDirectory() as t:
            p = shot.save_npz(Path(t)/"shot.npz")
            with np.load(p, allow_pickle=False) as z:
                np.testing.assert_array_equal(z["traces"], shot.traces)
                np.testing.assert_array_equal(z["velocity"], v.fields["velocity"])
                self.assertEqual(json.loads(str(z["metadata_json"]))["sourceVolumeContentSha256"], v.content_digest())
        with self.assertRaises(EngineError):
            acoustic_shot(self.engine, v, source=(150,150,50), receivers=[(160,150,50)], frequency_hz=100, duration_seconds=.2, sponge_cells=8)


if __name__ == "__main__":
    unittest.main()
