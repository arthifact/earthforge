import copy
import hashlib
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import numpy as np

from analysis import baseline_cv, harmonic, paired_difference, quadrature
from run import aggregate, physics_input, support_segments, verify_snapshot


class FieldAnalysisTests(unittest.TestCase):
    def rows(self):
        return [{"well": f"{area}/1-{i}", "group": f"{area}/1-{i}", "facies_code": code,
                 "depth_m": depth, "observed_m_s": 1600+depth*.5+(700 if code == 30000 else 0)}
                for area in (15, 25, 35) for i in (1, 2) for code in (30000, 65000)
                for depth in (200, 1000, 1800)]

    def test_quadrature_preserves_support_and_never_fills_gap(self):
        points, weights = quadrature([(0, 7.5), (9, 20)])
        self.assertAlmostEqual(sum(weights), 18.5)
        self.assertTrue(all(p < 7.5 or p > 9 for p in points))
        self.assertLessEqual(max(weights), 1)
        self.assertAlmostEqual(harmonic([2000, 4000], [10, 10]), 8000/3)
        for segments in ([], [(1, 1)], [(0, 3), (2, 4)], [(5, 6), (1, 2)]):
            with self.assertRaises(ValueError):
                quadrature(segments)

    def test_facies_controls_recover_known_laws_without_physics_reimplementation(self):
        rows = self.rows()
        for partition in ("parent", "quadrant"):
            for kind in ("facies-linear", "facies-quadratic"):
                predicted, _ = baseline_cv(rows, kind, partition)
                np.testing.assert_allclose(predicted, [r["observed_m_s"] for r in rows], atol=1e-8)

    def test_excluded_well_and_area_outcomes_cannot_affect_own_predictions(self):
        rows = self.rows()
        for partition in ("parent", "quadrant"):
            before, _ = baseline_cv(rows, "facies-quadratic", partition)
            changed = copy.deepcopy(rows)
            selected = [r["group"] == "15/1-1" if partition == "parent" else r["well"].startswith("15/") for r in rows]
            for row, held in zip(changed, selected):
                if held:
                    row["observed_m_s"] += 10000
            after, _ = baseline_cv(changed, "facies-quadratic", partition)
            np.testing.assert_array_equal(np.array(before)[selected], np.array(after)[selected])
            self.assertTrue(np.any(np.abs(np.array(before)[np.logical_not(selected)]-np.array(after)[np.logical_not(selected)]) > 1))

    def test_absent_training_facies_has_explicit_fallback_and_rank_failure_is_visible(self):
        rows = self.rows()
        for row in rows:
            if row["well"].startswith("15/"):
                row["facies_code"] = 999
        predicted, fits = baseline_cv(rows, "facies-linear", "quadrant")
        self.assertTrue(np.isfinite(predicted).all())
        self.assertIn("fallback", next(f for f in fits if f["held"] == "15")["faciesFits"]["999"])
        with self.assertRaisesRegex(ValueError, "Singular"):
            baseline_cv([r | {"depth_m": 1000} for r in rows], "depth", "parent")

    def test_equal_parent_paired_errors_do_not_weight_long_logs_more(self):
        rows = [{"group": "a", "observed_m_s": 2000, "a": 2010, "b": 2000}]*100
        rows += [{"group": "b", "observed_m_s": 2000, "a": 2100, "b": 2000}]
        difference = paired_difference(rows, "a", "b", {"seed": 3, "repeats": 2000})
        self.assertEqual(difference["maeDifferenceMps"], 55)
        self.assertEqual(difference["parentBootstrap95PercentMps"], [10, 100])

    def test_velocity_request_separates_past_burial_from_present_stress(self):
        uplift = physics_input(30000, 1500, "maximum_burial_plus_500m")
        self.assertEqual(uplift["depth"], 1500)
        self.assertEqual(uplift["history"], {"maxBurial": 2000, "maxEffectiveDepth": 2000})
        pressure = physics_input(65000, 2000, "overpressure_below_1500m")
        self.assertEqual(pressure["depth"], 2000)
        self.assertEqual(pressure["pressure"], 1500)
        self.assertNotIn("history", pressure)

    def test_matched_support_reproduces_observation_without_inventing_missing_samples(self):
        depth = np.arange(.25, 20, .5)
        arrays = {"md_m": depth+125, "z_loc_original": -depth-100,
                  "vp_m_s": np.where(depth < 10, 2000., 4000.),
                  "lithology_code": np.full(depth.shape, 65000),
                  "lithology_confidence": np.ones(depth.shape)}
        plan = {"max_adjacent_depth_gap_m": 1, "bin_width_m": 20, "depth_max_m": 20,
                "confidence": 1, "facies": {"65000": {}}, "min_coverage_fraction": .9}
        quality = np.ones(depth.shape, dtype=bool); quality[18] = False
        rows, _ = aggregate(arrays, 100, plan, quality)
        self.assertEqual(len(rows), 1)
        segments = support_segments(arrays, 100, rows[0], plan, quality)
        points, weights = quadrature(segments)
        self.assertAlmostEqual(sum(weights), 19)
        self.assertFalse(any(9 <= p <= 9.5 for p in points))
        with self.assertRaisesRegex(ValueError, "reproduce"):
            support_segments(arrays, 100, rows[0] | {"coverage_m": 20}, plan, quality)

    def test_process_guard_rejects_holdout_symlinks_and_log_writes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root/"development").mkdir(); (root/"holdout").mkdir()
            (root/"development/ok.npz").write_bytes(b"test-only fixture")
            (root/"holdout/reserved.npz").write_bytes(b"test-only fixture")
            (root/"development/escape.npz").symlink_to(root/"holdout/reserved.npz")
            script = '''
from pathlib import Path
import sys
from run import install_log_guard
root=Path(sys.argv[1]); access=install_log_guard(root/'development')
assert (root/'development/ok.npz').read_bytes()==b'test-only fixture'
for name,mode in [('holdout/reserved.npz','rb'),('development/escape.npz','rb'),('development/ok.npz','wb')]:
    try: open(root/name,mode)
    except PermissionError: pass
    else: raise AssertionError(name)
assert access=={'ok.npz'}
'''
            result = subprocess.run([sys.executable, "-c", script, str(root)], cwd=Path(__file__).parent,
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_updated_metadata_and_updated_local_audit_cannot_replace_frozen_snapshot(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/"metadata.csv"
            path.write_bytes(b"frozen public-metadata fixture")
            frozen = hashlib.sha256(path.read_bytes()).hexdigest()
            self.assertEqual(verify_snapshot(path, frozen, frozen), frozen)
            path.write_bytes(b"newer public-metadata fixture")
            updated = hashlib.sha256(path.read_bytes()).hexdigest()
            for declared in (frozen, updated):
                with self.assertRaisesRegex(ValueError, "frozen intake"):
                    verify_snapshot(path, declared, frozen)


if __name__ == "__main__":
    unittest.main()
