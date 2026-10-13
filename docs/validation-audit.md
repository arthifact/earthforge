# Scientific test audit — 2026-10-12

Earth Forge currently has evidence for **numerical correctness in controlled
cases and geological plausibility in sampled ensembles**. It has not been
validated as an accurate predictor of any real basin. No finite test suite
can establish accuracy for all seeds, geological settings or intended uses.

The distinction matters: verification tests implementation against its
mathematical specification; empirical validation compares predictions with
the represented system. See [NASA-STD-7009B, sections 4.2.3–4.2.6](https://standards.nasa.gov/sites/default/files/standards/NASA/B/1/NASA-STD-7009B-Final-3-5-2024.pdf).
This audit uses that distinction; it is not a certification against the standard.

## Coverage and limitations

| Test | What it establishes | What it does not establish |
| --- | --- | --- |
| Normal-fault heave at 20 and 10 m | Cutoff displacement agrees with prescribed cumulative heave in isolated, quiet faults; error decreases at finer resolution | Correct stress evolution, rheology, interacting-fault mechanics, or a convergence order for arbitrary sections |
| Solid retained per bed | Controlled compaction conserves deposited solid in beds away from the bottom boundary | A full mass budget through deposition, erosion, faulting and all open boundaries |
| Bed thickness vs integrated porosity law | The discrete compaction algorithm approximates an independently integrated constitutive law | That the chosen porosity law represents every lithology, pressure or burial history |
| Thrust grid back-tracing | Raster remapping agrees with the flow routine it uses | An independent test of that same flow routine, or a complete validation of Suppe fault-bend folding |
| Analytical thrust fixtures | Straight-ramp translation, a flat-to-ramp bend, reverse transport and local area preservation, in both directions at 18°, 25° and 32° | Complete interacting-thrust geometry, uplift/erosion coupling or mechanical equilibrium |
| Expansion fixtures | Whole-unit ratios of 1, 1.5 and 2 are recovered; fault slivers and missing intervals do not become growth measurements | Growth-strata realism across depositional environments; complete-unit sampling still selects a subset of units |
| State bounds and repeatability | Valid bed IDs, finite solid and burial, no overfilled cells, finite bounded displayed velocity, reproducible physical state | Geological validity; velocity bounds themselves are imposed by the model |
| Velocity lookup vs direct formula | The acceleration table preserves the chosen rock-physics formula within 5 m/s on the sweep | Agreement of that formula with laboratory or well measurements |
| Hamilton curves, dips, expansion and rates | Broad screening of simulated distributions against reference examples | An independent, site-matched calibration or statistical goodness-of-fit test |

The controlled benchmark seeds and options are fixed. User settings only
change the field ensemble. Tests retain minimum sample counts to detect
accidental loss of difficult measurements. Continuous compaction checks now include
subcell/one-cell intervals and report deep intervals separately as exclusions. Numerical tolerances describe discretization
error, not a percentage accuracy for real geology.

## Findings and changes

1. **Velocity lookup error.** The pressure model switches at sand fraction
   0.4. Linear interpolation across that switch mixed pressure regimes. An
   independent direct-formula sweep found a **529.10 m/s** discrepancy at
   sand fraction 0.397826, burial 3007 m and pressure top 1805 m. The narrow
   interval now uses direct evaluation. Depths beyond the table's 6 km limit
   also use the formula instead of silently clamping burial. The regression
   sweeps clastics and carbonate, normal and elevated pressure, between table
   nodes and beyond the table. Its 5 m/s tolerance was set before the repair.
2. **Mislabelled comparison depths.** The former 0.5 and 1 km rows indexed
   bins centered at 0.55 and 1.05 km. They now interpolate the neighboring
   median bins and explicitly describe the estimate. Missing bins are not
   bridged, and no extrapolation is made. A known linear profile tests this.
3. **Shared thrust oracle.** Back-tracing uses the simulator's flow routine.
   It is now labelled a consistency test, supplemented by independent
   analytical geometry and area tests. A backlimb dip alone is insufficient
   evidence for the whole Suppe construction.
4. **Cancellation and missing measurements.** Compaction now reports mean
   absolute error (MAE), signed bias and maximum error. The former absolute
   signed-mean threshold of 5 m is strengthened to **MAE ≤5 m**, retaining
   the original requirement that at least 95% of intervals be within 20 m.
   This rule was set before running the added check. Empty measurements
   cannot pass or fail. Deliberately corrupted state and cancelling-error
   fixtures verify that the checks actually reject those problems.
5. **Scope of green results.** Geological rows say “Within guide” or “Review”.
   Rates are explicitly median-only screens: sedimentation is the thickest
   deposit per step, and slip is estimated from the initial normal-fault dip.
   The pooled velocity band is cell-weighted, includes mixed lithologies and
   settings, and is not a confidence interval. Contributor counts are recorded
   per depth bin; the figure shows gaps where no data exist.

The numerical repairs preceding this audit are recorded separately in
[the verification log](verification-log.md). All original numerical tolerances
remain at least as strict. No physical coefficients were tuned to make the
new tests pass.

## Remaining work before a realism claim

1. **Independent observations.** Select a marine clastic basin first. Reserve
   entire wells/areas for validation before tuning; splitting adjacent depth
   samples would leak the same stratigraphy into both sets. Record units,
   depth datum, lithology, pressure, uplift history and measurement quality.
   Compare simulated and measured velocity, density/porosity, layer thickness
   and fault geometry at matched spatial resolution. Candidate datasets are
   the FORCE wells and Volve listed in the verification log. The
   [FORCE intake](force2020-intake.md) now records 118 imported wells, a frozen
   94/24 development/holdout split. A [first conditional velocity comparison](force2020-development.md)
   now scores the unchanged rock-physics function on 442 screened intervals
   from 44 development wells (MAE 0.309 km/s). This is not validation of the
   complete basin generator; the 24 holdout wells remain unscored.
2. **Errors and coverage by setting.** Report bias, MAE/RMSE, tails and prediction
   interval coverage by depth and facies on held-out data. Compare against
   simple depth-only baselines. Choose acceptance limits from the intended
   use and measurement uncertainty before inspecting the results. A narrow
   Hamilton median match alone cannot test lateral structure or anomalies.
3. **Conservation and convergence.** The [conservative thrust repair](conservative-thrust-transport.md)
   removed unaccounted sediment loss. The [thin-bed repair](thin-bed-preservation.md)
   retains 36/36 closed runs and all 4,494 closed operation budgets under the same
   40/20/10 m plan. On 1,205 shared unit/location triples, fine-grid RMS velocity
   differences fall from 35.20 to 4.40 m/s and thickness differences from 24.31
   to 4.22 m. Coverage changes from 1,381 to 1,301 of 2,820 opportunities because
   continuous interfaces and physically thinner beds change eligibility. On the
   shared cohort, 363 velocity triples remain noncontracting/new-change (352
   before); 242 of these now differ by less than 1 m/s. Investigate remaining
   coupled-fault and boundary sensitivity before claiming convergence or using
   the holdout. Existing geometric tolerances are unchanged.
4. **Constitutive assumptions.** Quantify sensitivity to porosity coefficients,
   pressure, cementation and maximum-burial memory. The former sharp facies switch has been removed: a prescribed pressure profile now
   applies across sediment lithologies. Current pressure, maximum effective loading,
   and maximum burial are separate. The quarter-rate effective-loading gradient,
   depth-based cementation proxy, isotropic brine-only velocity and 1500–5600 m/s cap
   remain modelling assumptions. See the [material-state repair](material-state-development.md).
   Chalk coefficients remain unconfirmed in the source code. The exponential,
   irreversible compaction framework is described in the authors' [Strata
   manual, section 4.7](https://www.jsg.utexas.edu/flemings/files/Strata_Manual1.pdf);
   that supports the framework, not these outputs' empirical accuracy.
5. **Source and seismic validation.** Recheck original equations, coefficient
   provenance and applicability domains before treating references as
   acceptance standards. The Hamilton originals were not accessible in this
   audit; their existing coefficients were retained as reference curves.
   Forward-model held-out traveltimes or waveforms once that capability exists.
   Visual resemblance to synthetic benchmarks is not a replacement.

Passing the current tests supports further development of this synthetic
generator. “Super realistic” remains an empirical target, not an established
property of the current release.


## Local convergence diagnosis (2026-10-12)

The [operation-trace study](grid-convergence-diagnosis.md) reproduces every
conservative-thrust sample and all 4,494 closed budgets across the 36 frozen
runs. It identifies unresolved thin-bed representation: the one-cell minimum
can prevent the porosity law's compaction, and the resulting surface position
changes later deposition. Grains remain conserved while raster pore volume and
rock-physics porosity can disagree. The two no-fault controls show much smaller
shared-cohort grid differences when compaction is disabled, a diagnostic
intervention that changes physics and is not a repair.

The optional observer and diagnostic tools have independent known-answer tests.
They do not change simulator output or relax convergence criteria. Of 411
noncontracting velocity triples, 104 have fine-grid changes below 10 m/s and
98 exceed 50 m/s; these bins prioritize work, not establish accuracy thresholds.
Subcell bed volumes, deposition, transport and boundary sensitivity still need
verification. Holdout and development observational arrays remain untouched.


## Thin-bed repair (2026-10-12)

Continuous material columns replace the one-cell minimum. Per-bed grains,
composition, loading and burial memories survive raster projection and both
fault transports. Compaction solves a bracketed midpoint volume equation;
velocity uses that actual pore volume. The independent integrated-law test
also refines material quadrature separately from the 40/20/10 m display grid.
The fixed 10 m maximum material parcel size is a numerical approximation, not
a minimum bed thickness or a claim of geological accuracy.

The comparison plan, seeds, prescribed histories and conservation tolerances
are unchanged. Interval measurements now integrate real subcell interfaces
rather than dominant display labels, retaining the original two-grid-cell
eligibility rule. Saved earlier results remain historical evidence; the old
whole-cell diagnosis and ablation runners refuse mismatched source revisions.
The [repair report](thin-bed-preservation.md) records tests, coverage and the
remaining limitations. No observational arrays or holdout files were accessed.
