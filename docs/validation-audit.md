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
accidental loss of difficult measurements; the UI reports excluded one-cell
and deep compaction intervals. Numerical tolerances describe discretization
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
   the FORCE wells and Volve listed in the verification log; neither has been
   evaluated here.
2. **Errors and coverage by setting.** Report bias, MAE/RMSE, tails and prediction
   interval coverage by depth and facies on held-out data. Compare against
   simple depth-only baselines. Choose acceptance limits from the intended
   use and measurement uncertainty before inspecting the results. A narrow
   Hamilton median match alone cannot test lateral structure or anomalies.
3. **Conservation and convergence.** Add an independent sediment-solid budget
   with every source, sink and boundary flux. Compare matched physical
   horizons under 40/20/10 m refinement, retaining unresolved features as
   coverage losses rather than silently discarding them. Current 20/10 m
   measurements do not use identical interval populations.
4. **Constitutive assumptions.** Quantify sensitivity to porosity coefficients,
   pressure, cementation and maximum-burial memory. The quarter-rate pressure
   rule and its sharp facies switch, fixed cementation blend, isotropic
   brine-only velocity and 1500–5600 m/s cap are modelling assumptions.
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
