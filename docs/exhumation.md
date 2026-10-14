# Exhumation — 2026-10-14

**The simulator can now uplift and erode a section after its tectonic phase and
rebury it, with every bed keeping its maximum compaction and cementation
state.** This is the process the [burial-state context test](force2020-burial-context.md)
identified as missing: Jurassic and Cretaceous units in the FORCE wells behave
as if 400–700 m more deeply buried than today, and quadrants 31 and 35 fit at
about +500 m. Default sections are unchanged; the process is off unless asked.

## What happens

An exhumation episode is drawn per seed with the `exhumation` probability
(0 by default; the page offers never, 1 in 2 and always). It uses its own random
stream, so a probability of 0 reproduces every earlier seed exactly, and the
same seed gets the same episode whenever the option is on.

The episode adds 2–4 uplift steps after the post-rift or post-thrust phase's
own steps, followed by one step of renewed subsidence and deposition, so the
history ends with net exhumation under a thin cover, as on an uplifted margin.
A first version placed the episode at the start of that phase; the remaining
post-tectonic subsidence then reburied one test seed to within 180 m of its old
depth, which is a reburied basin rather than an exhumed one. Each uplift step:

1. **Uplift.** The whole section rises by the episode's share of 300–1500 m,
   tilted by up to ±60% across the section, through the same exact column
   translation that subsidence uses, with faults and thrust branches carried.
   Rock lifted above sea level leaves the column and is booked as erosion, not
   as a top-boundary outflow.
2. **Erosion.** Every uplift step is a lowstand; rock above wave base is eroded
   as in any other step. The result is an unconformity.
3. **Deposition and compaction** continue as usual: a thin drape during the
   episode, then the final step's subsidence and deposition cover the
   unconformity.

Burial memory was already irreversible: each parcel keeps its maximum geometric
burial, which drives the cementation proxy, and its maximum effective loading,
which drives porosity. Compaction never rebounds, and the window velocity uses
the direct formula wherever memory exceeds the present state. Exhumation is
therefore the first process that makes those two memories differ from present
depth across a whole section.

## What is not modelled

- No flexural or isostatic response, no fault reactivation during uplift and
  no inversion; the uplift is a prescribed tilted translation.
- No subaerial drainage, weathering or valley incision; everything above sea
  level is simply removed.
- Elastic porosity rebound on unloading is still not represented.
- The amounts are drawn, not conditioned on a region. A North Sea preset needs
  the holdout test before any amount is called a calibration.

## Verification

Four tests in `tests/exhumation.test.mjs`:

- an absent option and a probability of 0 give the same section as before,
  and the episode is deterministic per seed within its stated ranges;
- in both settings the uplift steps match the episode, erosion is booked during
  them with zero top-face outflow, subsidence and deposition resume afterwards,
  all grain budgets close, no water is trapped, and sediment ends up more than
  200 m shallower than its maximum burial;
- exhumed parcels are faster than fresh rock at their present depth through the
  same `rockVelocity` call the window uses, and window velocities stay in bounds;
- the uplift is tilted the way the episode says and recorded as negative
  subsidence in the physical forcing.

Type checking passes. The FORCE exporter, coefficients, windows and holdout are
untouched.

## Cost

A default 20 m section simulates in about 33 s in Node 26 on this machine; a
profile puts the time in column parcel bookkeeping (`append`, `compactColumn`,
exact-length arithmetic, grain inventories at every ledger entry), not in the
physics. The exhumation steps add a proportional amount. This is a separate
performance item recorded here so it is not mistaken for a cost of this process.
