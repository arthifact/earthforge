# FORCE 2020 intake — 2026-10-12

Follow-up: [the first development comparison](force2020-development.md) is now
complete. This page preserves the initial intake findings before that comparison.

All five supplied files match the published checksums for
[FORCE 2020 version 1](https://doi.org/10.5281/zenodo.4351156).
The original downloads were read in place and remain unchanged.

The reproducible importer has prepared the logs and frozen a whole-well split.
**No physical parameters have been tuned and no simulator accuracy score has
been computed.** This is the observational-data foundation for that comparison.

## What is available

| Item | Result |
| --- | ---: |
| LAS files / unique wellbores | 118 / 118 |
| Original depth rows | 2,337,639 |
| Positive, finite sonic readings converted to velocity | 1,784,669 |
| Rows with non-missing bulk density | 1,396,517 |
| Rows with a recognized lithology | 1,431,383 |
| Formation / group metadata coverage | 118 / 118 wells |
| Casing metadata coverage | 72 wells |
| Exact SODIR well-name matches with water depth | 116 wells |
| Frozen development / holdout | 94 / 24 wells |

The companion workbook coverage comes from `Sheet1` in
`NPD_Lithostratigraphy_member_formations_all_wells.xlsx` (A1:H1915),
`NPD_Lithostratigraphy_groups_all_wells.xlsx` (A1:H856), and
`NPD_Casing_depth_most_wells.xlsx` (A1:H286). The scoring workbook defines
lithology-classification penalties, so it is not used to score velocity.

There are **901,712 provisional clastic candidate rows across 110 wells**:
708,307 development and 193,405 holdout. These have positive sonic velocity,
high-confidence sandstone/shale/mixed labels, and a provisional vertical depth
of 0–3 km below sea floor. They are not yet a final quality-approved cohort.

## Findings that matter for accuracy

- All 118 files declare DTC in µs/ft and density in g/cm³. Conversion is explicit;
  declared nulls remain missing. There are 9,039 nonpositive sonic values and
  440,265 positive sonic readings without recognized lithology labels. None
  of those unlabelled rows enter the current clastic candidate mask.
- **Depth remains provisional.** LAS `Z_LOC` has no stated unit/datum. Assuming
  it is an elevation relative to mean sea level gives `-Z_LOC - water depth`.
  Against 2,876 companion Z picks, the maximum absolute difference is 0.24 m.
  This supports coordinate consistency, but the picks may share the same
  trajectory source. Independent reference documentation is still required.
- Official [SODIR metadata](https://factpages.sodir.no/en/wellbore/tableview/exploration/all)
  supplies the water depths and RKB references. FORCE names `16/11-1 ST3` and
  `25/2-13 T4` do not match exactly; neither receives an automatic alias mapping.
  Their split memberships stay reserved while that identity check is resolved.
- Ancillary quality data are incomplete: 803,008 candidates have density, but
  only 468,739 have both caliper and bit size. Interpretation confidence alone
  cannot certify sonic measurement quality.
- 434 candidate velocities lie outside the simulator's 1500–5600 m/s cap.
  They are retained. Removing them to make the comparison fit would hide a
  potentially important model limitation or measurement problem.
- The 117 parent-well groups stay intact across partitions. This controls
  sidetrack leakage; it does not prove independence between neighboring wells.
  The released FORCE data do not independently constrain pore pressure, fluid
  saturation or maximum burial, all relevant to the present rock-physics model.

## Deliverables and verification

- [Importer and fixed comparison protocol](../validation/force2020/protocol.md).
- [Frozen well membership](../validation/force2020/split.json).
- [Machine-readable intake summary and source hashes](../validation/force2020/intake-summary.json).
- Local `data/force2020/`: separate development/holdout NPZ files, per-well
  `wells.csv`, full `audit.json`, and the saved SODIR CSV snapshot. The derived
  arrays occupy about 70 MB and are excluded from Git.

Six ingestion regression tests pass: known-value sonic/density conversions,
null/invalid handling, wrong units or malformed rows, depth-reference arithmetic,
no interpolation across gaps, grouped/frozen splits, and preserving observations
outside the model cap. The complete archive import also passes its schema and
depth-index checks, and rerunning preserves the frozen split. These checks verify
the data pipeline; they do not certify geological accuracy.

The next step is to resolve the depth reference and log-quality rules on the
development wells, then compare the unchanged simulator with a simple depth-only
baseline at matched vertical resolution. Holdout error scores remain unexamined
until those choices and the acceptance criteria are fixed.
