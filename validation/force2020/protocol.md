# FORCE 2020 observational benchmark — preparation v1

This is a data-preparation protocol, **not a claim of simulator accuracy**.
The importer produces auditable observations and reserves independent wells
before any parameter fitting or model-error calculation. The original files
remain untouched. Large data products stay in the ignored `data/force2020/`
directory; the split, code and intake summary are kept with the project.

**Follow-up:** the [first development comparison](../../docs/force2020-development.md)
now records sea-floor reference checks, explicit quality screens and untuned
rock-physics errors. Its fixed rules are in `benchmark-plan.json`; the original
intake outputs remain provisional and unchanged. No held-out errors were used.

## Sources and scope

- Bormann et al., [FORCE 2020 dataset, version 1](https://doi.org/10.5281/zenodo.4351156),
  LAS archive and four supplied XLSX files. The publisher describes partial
  cleaning/despiking and expert lithology interpretation. That does not establish
  that every sonic sample is an unaltered, high-quality measurement. The source
  attributes the original government logs to the Norwegian open-data licence.
- The [organizers' starter notebook](https://github.com/bolgebrygg/Force-2020-Machine-Learning-competition/blob/master/lithology_competition/data/starter_notebook.ipynb)
  defines the twelve lithology codes and confidence levels (1 high, 2 medium,
  3 low). Confidence concerns the **lithology interpretation**, not sonic quality.
- [SODIR exploration-wellbore metadata](https://factpages.sodir.no/en/wellbore/tableview/exploration/all),
  exported 2026-10-12. Its [attribute definitions](https://factpages.sodir.no/en/wellbore/Attributes)
  define water depth relative to mean sea level, Kelly bushing elevation above
  mean sea level, and measured/true vertical drilling depths relative to RKB.

The first planned comparison is marine clastic **compressional velocity vs
vertical depth below sea floor**, separated by lithology. These logs cannot by
themselves validate fault geometry, depositional history or conservation. The
supplied classification cost matrix is not a velocity-error metric. Formation
and group picks provide context; casing shoes alone do not identify the casing
state when each log was acquired.

## Frozen partition

`split.json` assigns 94 wells to development and 24 to holdout. Numeric parent
names group suffixes/sidetracks together; the official SODIR parent names are
also checked for cross-partition leakage. The paired `34/5-1 A` and `34/5-1 S`
are in the same partition. The lowest SHA256 ranks of a fixed salt plus group
name reserve `ceil(0.2 × 117)` groups, without looking at model outcomes.

The archive checksum is part of the split. Reordered archive members do not
change assignments. A changed dataset or rule raises an error rather than
overwriting the split. This is Earth Forge's split, not the competition split.
Geographic neighbors may still occur in both sets; later claims of regional
generalization need an additional spatial-block holdout.

Import-level quality checks may inspect all wells to establish data validity.
Do not fit coefficients, choose exclusions based on model residuals, choose
acceptance thresholds or select a winning model using the held-out wells.
Use only the development partition for those decisions. Once the final
comparison protocol is frozen, evaluate holdout once and report all exclusions.

## Import and depth reference

1. Require unwrapped LAS 2.0, explicit identities/null values, distinct curve
   names and the declared number of numeric fields in every row.
2. Require a strictly increasing metre depth index. Check `DEPT` and the
   non-missing `DEPTH_MD` values agree within 1 mm. Do not reinterpret measured
   depth as vertical depth in a deviated well.
3. Replace only the declared LAS null sentinel with missing values. Exclude
   nonpositive/nonfinite slowness from velocity conversion, recording the count.
   Require `DTC` in µs/ft and calculate `Vp = 304800 / DTC` in m/s. Require
   `RHOB` in g/cm³ and multiply by 1000 for kg/m³. No imputation or smoothing.
4. Preserve `Z_LOC` exactly. **Its LAS unit is `_`, with no declared datum.**
   Provisionally interpret it as elevation relative to mean sea level and
   calculate `depth_below_seafloor = -Z_LOC - water_depth`. Keep that assumption
   in the output name and status. Do not subtract RKB elevation again from
   a subsea elevation, and do not estimate the sea floor from the first log row.
5. Match SODIR names exactly. No automatic suffix/nearest-well substitution.
   Missing water depth leaves derived depth missing. Keep unmatched wells in
   their frozen partition for later resolution; do not replace them to improve
   scores. The two unresolved FORCE names are `16/11-1 ST3` and `25/2-13 T4`.
6. Cross-check LAS Z against supplied formation/group/casing Z picks at the
   corresponding MD. Interpolation only uses adjacent finite samples separated
   by at most 1 m; no extrapolation or bridging missing coordinates. The close
   match checks ingestion and shared coordinates, **not independent datum
   certification**: the LAS and picks may share their original trajectory.

The prepared `candidate_clastic` mask means positive finite sonic velocity,
finite provisional depth in 0–3000 m, a sandstone/shale/mixed code and confidence
1. It does **not** mean approved log quality or a confirmed depth reference.
Values outside the model's 1500–5600 m/s cap are preserved, so an imposed model
bound cannot remove unfavorable observations. Other facies and confidence
levels remain in the arrays for separate sensitivity analysis.

## Required before an accuracy score

- Resolve the Z datum from the underlying deviation/composite-log documentation
  for the development cohort. Record evidence per well; do not silently promote
  a provisional coordinate to a confirmed depth. The two name aliases need
  documented mapping before using their water depths.
- Define log-quality flags using tool information, caliper/bit-size coverage,
  density correction and original logs. Keep explicit unknown-quality strata
  where ancillary curves are missing; a missing caliper is not a good-hole flag.
  Do not use the lithology confidence as a sonic quality certificate. Investigate
  unlabelled shallow sonic intervals for infill rather than treating them as rock.
- Distinguish present depth from maximum burial, which controls the simulator's
  rock physics. The FORCE labels do not supply sand fraction, pore-fluid state,
  pore pressure or burial history. Test explicit scenarios and report their
  applicability; do not tune these unknowns independently per validation sample.
  Neutron porosity is not a direct lithology-independent porosity observation.
- Freeze aggregation and metrics on development wells: compare a 20 m vertical
  support, preserve coverage and bed-boundary information, and use travel-time
  (slowness) averaging when calculating an effective vertical velocity. Do not
  bridge gaps. The numerical h=10/20 m tests and the observed log sampling are
  different issues. A sonic tool along a deviated well also does not directly
  measure vertical propagation in an anisotropic medium.
- Fit a simple depth-only baseline using development wells, with grouped
  cross-validation. Compare the untouched simulator and later calibrated versions
  using per-well bias, MAE/RMSE, depth/facies breakdowns and coverage counts.
  Weight wells explicitly so dense or long logs do not dominate. Uncertainty
  resampling must resample wells/groups, not adjacent 15 cm measurements.
- Choose acceptance limits from intended use and observation uncertainty before
  inspecting holdout errors. A model-generated spread is not automatically a
  calibrated prediction interval. No accuracy pass/fail threshold is set yet.

## Reproduce

Use Python 3.11+ and the pinned analysis dependencies in `requirements.txt`.
This tooling is separate from the browser app and adds no runtime dependencies
to Earth Forge. Keep the full SODIR CSV snapshot alongside local derived data;
its checksum and synchronization date are recorded in the audit.

```sh
python -m pip install -r validation/force2020/requirements.txt
python -m unittest discover -s validation/force2020 -p 'test_*.py' -v
python validation/force2020/prepare.py \
  --downloads /path/to/original/downloads \
  --sodir data/force2020/sodir-exploration.csv
```

The official CSV export URL is `SODIR_URL` in `prepare.py`. Use the saved snapshot
for exact reproduction: current official exports can change over time.

Outputs:

- `development/*.npz` and `holdout/*.npz`: arrays retaining every original depth
  index; open using `numpy.load(path, allow_pickle=False)`. Missing values are NaN.
- `audit.json`: checksums, units, book coverage, counts and per-well depth checks.
- `wells.csv`: a compact per-well audit, not a simulator score.
- `split.json`: the immutable membership record stored with this protocol.

Original downloads are read-only inputs. The script fails on unit/schema errors
and refuses to change an existing split. The original LAS contains additional
curves not duplicated into the compact NPZ files; retain the archive for later
quality investigations. Neither data preparation nor its tests alter simulator
parameters or the Checks UI.
