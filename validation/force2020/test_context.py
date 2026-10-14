import unittest

from context import attach, clean_unit, pick_depths, unit_at, well_parts


class ContextTests(unittest.TestCase):
    def test_pick_depths_use_sea_floor_reference_and_sort(self):
        picks = [{"Surface": "B GP. Top", "Z": "-1100"}, {"Surface": "A GP. Top", "Z": "-100"}, {"Surface": "bad", "Z": ""}]
        self.assertEqual(pick_depths(picks, 100), [(0.0, "A GP. Top"), (1000.0, "B GP. Top")])

    def test_unit_at_midpoint_and_boundary_flag(self):
        tops = [(0.0, "A"), (1000.0, "B"), (2000.0, "C")]
        self.assertEqual(unit_at(tops, 990, 1010), ("B", True))
        self.assertEqual(unit_at(tops, 500, 520), ("A", False))
        self.assertEqual(unit_at(tops, 2500, 2520), ("C", False))
        self.assertEqual(unit_at([(300.0, "A")], 100, 120), (None, False))

    def test_names_and_well_parts(self):
        self.assertEqual(clean_unit("VIKING GP. Top"), "VIKING GP.")
        self.assertEqual(clean_unit(None), "")
        self.assertEqual(well_parts("35/11-10"), ("35", "35/11"))
        self.assertEqual(well_parts("7/1-2 S"), ("7", "7/1"))

    def test_attach_requires_water_depth_and_keeps_original_columns(self):
        rows = [{"well": "1/2-3", "depth_m": "1010", "observed_m_s": "2000"}]
        tables = {"groups": {"1/2-3": [{"Surface": "X GP. Top", "Z": "-50"}, {"Surface": "Y GP. Top", "Z": "-1055"}]},
                  "formations": {"1/2-3": [{"Surface": "F Fm. Top", "Z": "-1015"}]}}
        out = attach(rows, tables, {"1/2-3": {"wlbWaterDepth": "50", "wlbNsDecDeg": "58.1", "wlbEwDecDeg": "2.2"}})
        self.assertEqual(out[0]["group_unit"], "Y GP.")
        self.assertTrue(out[0]["group_top_in_window"])
        self.assertEqual(out[0]["formation_unit"], "F Fm.")
        self.assertEqual((out[0]["quadrant"], out[0]["block"], out[0]["lat"]), ("1", "1/2", 58.1))
        self.assertEqual(out[0]["observed_m_s"], "2000")
        with self.assertRaises(ValueError):
            attach(rows, tables, {})


if __name__ == "__main__":
    unittest.main()
