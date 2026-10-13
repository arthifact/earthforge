"""Small, independent ingestion fixtures; no downloaded data needed."""
import io
import json
from pathlib import Path
import tempfile
import unittest

import numpy as np

from prepare import (audit_well, freeze_split, interpolate_local, make_split,
                     provisional_depth, read_las, sonic_velocity)


FIXTURE = """~Version
VERS. 2.0 : version
WRAP. NO : wrap
~Well
UWI. 15/9-13 : well
NULL. -999.25 : missing
~Curve
DEPT.m : measured depth
DTC.us/ft : compressional slowness
RHOB.g/cm3 : density
DEPTH_MD._ : duplicated depth
~Ascii
100 100 2.5 100
101 -999.25 -999.25 101
102 200 2 102
"""


class PreparationTests(unittest.TestCase):
    def test_sonic_units_and_missing_values(self):
        _, columns = read_las(io.StringIO(FIXTURE))
        np.testing.assert_allclose(sonic_velocity(columns["DTC"]), [3048, np.nan, 1524], equal_nan=True)
        np.testing.assert_allclose(columns["RHOB"] * 1000, [2500, np.nan, 2000], equal_nan=True)
        self.assertTrue(np.isnan(sonic_velocity(np.array([0, -5, np.inf, np.nan]))).all())

    def test_wrong_units_or_misaligned_rows_fail(self):
        for bad in (
            FIXTURE.replace("DTC.us/ft", "DTC.us/m"),
            FIXTURE.replace("102 200 2 102", "102 200 2"),
            FIXTURE.replace("102 200 2 102", "102 200 2 103"),
            FIXTURE.replace("102 200 2 102", "99 200 2 99"),
            FIXTURE.replace("WRAP. NO", "WRAP. YES"),
        ):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                read_las(io.StringIO(bad))

    def test_subsea_elevation_not_md_and_missing_metadata(self):
        # 500 m below MSL and 100 m water depth is 400 m below sea floor;
        # RKB elevation must not be subtracted a second time from subsea Z.
        np.testing.assert_allclose(provisional_depth(np.array([-500, -50, np.nan]), 100),
                                   [400, -50, np.nan], equal_nan=True)
        for unknown in (None, float("nan"), -999, 0):
            self.assertTrue(np.isnan(provisional_depth(np.array([-500]), unknown)).all())

    def test_no_interpolation_across_missing_or_large_gaps(self):
        md = np.array([0., 1, 2, 3, 10, 11])
        z = np.array([20., 19, np.nan, 17, 10, 9])
        result = interpolate_local(md, z, np.array([-1., .5, 1.5, 2.5, 5, 10, 12]))
        np.testing.assert_allclose(result, [np.nan, 19.5, np.nan, np.nan, np.nan, 10, np.nan], equal_nan=True)

    def test_partition_groups_sidetracks_and_freezes_membership(self):
        wells = ["34/5-1 S", "34/5-1 A", "15/9-13", "25/2-13 T4", "16/11-1 ST3", "31/2-1"]
        split = make_split(wells)
        self.assertEqual(split, make_split(list(reversed(wells))))
        self.assertEqual(split["wells"]["34/5-1 S"], split["wells"]["34/5-1 A"])
        self.assertEqual(sum(v["partition"] == "holdout" for g, v in
                             {v["group"]: v for v in split["wells"].values()}.items()), 1)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "split.json"
            freeze_split(path, split)
            self.assertEqual(freeze_split(path, split), split)
            with self.assertRaises(ValueError):
                freeze_split(path, make_split(wells + ["31/2-2"]))
            self.assertEqual(json.loads(path.read_text()), split)

    def test_candidates_preserve_out_of_model_velocities_and_exclude_unknown_labels(self):
        columns = {
            "DEPT": np.array([200., 201, 202, 203, 204]),
            "DTC": np.array([40., 100, 100, 100, 100]),  # 7620 m/s is not clipped away
            "Z_LOC": np.array([-175., -176, -177, -178, -50]),
            "FORCE_2020_LITHOFACIES_LITHOLOGY": np.array([30000, 65000, np.nan, 70000, 65000]),
            "FORCE_2020_LITHOFACIES_CONFIDENCE": np.array([1., 2, 1, 1, 1]),
        }
        tables = {k: {} for k in ("casing", "formations", "groups")}
        metadata = {"15/9-13": {"wlbWaterDepth": "100", "wlbKellyBushElevation": "25"}}
        result, arrays = audit_well("15/9-13", columns, tables, metadata)
        self.assertEqual(result["candidate_clastic_rows"], 1)
        self.assertEqual(arrays["vp_m_s"][0], 7620)
        self.assertEqual(result["water_column_vp_rows_provisional"], 1)
        self.assertEqual(result["depth_status"], "provisional_Z_MSL_assumption")
        result, _ = audit_well("15/9-13 A", columns, tables, metadata)
        self.assertFalse(result["sodir_exact_match"])
        self.assertEqual(result["candidate_clastic_rows"], 0)


if __name__ == "__main__":
    unittest.main()
