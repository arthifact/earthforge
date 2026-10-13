import copy
import json
from pathlib import Path
import unittest
import tempfile

import numpy as np

from compare import aggregate, baseline_loo, caliper_mask, depth_evidence, development_wells, development_log_path, metrics, paired_mae_difference


PLAN = json.loads(Path(__file__).with_name("benchmark-plan.json").read_text())


class ComparisonTests(unittest.TestCase):
    def fixture(self):
        depth = np.arange(.25, 20, .5)
        return {
            "md_m": depth + 125, "z_loc_original": -depth - 100,
            "vp_m_s": np.where(depth < 10, 2000., 4000.),
            "lithology_code": np.full(len(depth), 65000.),
            "lithology_confidence": np.ones(len(depth)),
            "cali_in": np.full(len(depth), 8.5), "bit_size_in": np.full(len(depth), 8.5),
        }

    def test_vertical_support_uses_travel_time_not_arithmetic_velocity(self):
        arrays = self.fixture()
        rows, _ = aggregate(arrays, 100, PLAN, caliper_mask(arrays, 1))
        self.assertEqual(len(rows), 1)
        self.assertAlmostEqual(rows[0]["observed_m_s"], 8000 / 3)
        self.assertAlmostEqual(rows[0]["coverage_m"], 19.5)
        # Adding more near-duplicate samples in the slow half must not give
        # them more weight than their vertical support warrants.
        repeated = {k: np.repeat(v, 2) for k, v in arrays.items()}
        # Exact repeated coordinates have zero interior support; no row-weight average.
        repeated_rows, _ = aggregate(repeated, 100, PLAN, caliper_mask(repeated, 1))
        self.assertAlmostEqual(repeated_rows[0]["observed_m_s"], rows[0]["observed_m_s"])

    def test_missing_and_mixed_windows_never_become_clean_observations(self):
        arrays = self.fixture()
        arrays["vp_m_s"][18:21] = np.nan  # 1.5 m internal gap, despite 90% total support
        rows, counts = aggregate(arrays, 100, PLAN, caliper_mask(arrays, 1))
        self.assertEqual(rows, [])
        self.assertEqual(counts["internal_quality_gap"], 1)
        arrays = self.fixture()
        arrays["lithology_code"][20] = 30000
        rows, counts = aggregate(arrays, 100, PLAN, caliper_mask(arrays, 1))
        self.assertEqual(rows, [])
        self.assertEqual(counts["mixed_or_unlabelled_window"], 1)
        arrays = self.fixture()
        arrays["cali_in"][:] = np.nan
        self.assertFalse(caliper_mask(arrays, 1).any())
        self.assertTrue(caliper_mask(arrays, None).all())

    def test_reference_check_rejects_wrong_datum_and_identity(self):
        info = {"wlbWaterDepth": "100", "wlbKellyBushElevation": "25",
                "wlbFactPageUrl": "https://example.invalid/fixture", "wlbNpdidWellbore": "1"}
        picks = [{"Surface": "NORDLAND GP. Top", "MD": "125", "Z": "-100"}]
        audit = {"pick_z_comparisons": 5, "pick_z_max_abs_error_m": .1}
        self.assertTrue(depth_evidence("test", picks, info, audit, PLAN)["supported"])
        picks[0]["Z"] = "-125"  # RKB-referenced coordinate incorrectly treated as MSL
        self.assertFalse(depth_evidence("test", picks, info, audit, PLAN)["supported"])
        self.assertFalse(depth_evidence("test", picks, {}, audit, PLAN)["supported"])

    def test_baseline_never_uses_held_group_observations(self):
        rows = [{"well": f"{g}-{j}", "group": g, "depth_m": d, "observed_m_s": 1500 + d}
                for g in ("a", "b", "c") for j, d in enumerate((100, 1000, 2000))]
        before = baseline_loo(rows)
        changed = copy.deepcopy(rows)
        for r in changed:
            if r["group"] == "a":
                r["observed_m_s"] += 10000
        after = baseline_loo(changed)
        np.testing.assert_allclose(before[:3], after[:3])
        self.assertTrue(np.any(np.abs(before[3:] - after[3:]) > 1))

    def test_metrics_weight_parents_not_dense_samples_and_fail_on_missing(self):
        rows = [{"well": "a", "group": "a", "observed_m_s": 2000, "prediction": 2010}] * 100
        rows += [{"well": "b", "group": "b", "observed_m_s": 2000, "prediction": 2100}]
        score = metrics(rows, "prediction")
        self.assertEqual(score["bias_m_s"], 55)
        self.assertEqual(score["mae_m_s"], 55)
        self.assertAlmostEqual(score["rmse_m_s"], np.sqrt(5050))
        paired_rows = [r | {"present_hydrostatic": r["prediction"], "baseline_loo": 2000} for r in rows]
        paired = paired_mae_difference(paired_rows, PLAN["bootstrap"])
        self.assertEqual(paired["model_minus_baseline_mae_m_s"], 55)
        self.assertEqual(paired["parent_bootstrap_95_percent_m_s"], [10, 100])
        with self.assertRaises(ValueError):
            metrics([rows[0] | {"prediction": np.nan}], "prediction")

    def test_holdout_membership_cannot_enter_development_loader(self):
        split = {"wells": {"train": {"partition": "development"}, "hidden": {"partition": "holdout"}}}
        self.assertEqual(set(development_wells(split)), {"train"})

    def test_holdout_and_unknown_wells_are_rejected_before_any_log_access(self):
        split = {"wells": {"train": {"partition": "development"}, "hidden": {"partition": "holdout"}}}
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder).resolve()
            # The guard works even with no data directories or files present.
            for well in ("hidden", "unknown"):
                with self.assertRaisesRegex(ValueError, "Only frozen development"):
                    development_log_path(root, split, well)
            self.assertEqual(development_log_path(root, split, "train"), root / "development/train.npz")
            (root / "development").mkdir()
            (root / "development/train.npz").symlink_to(root / "elsewhere.npz")
            with self.assertRaisesRegex(ValueError, "escapes"):
                development_log_path(root, split, "train")


if __name__ == "__main__":
    unittest.main()
