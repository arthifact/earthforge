# Verification log: a 2D basin simulator (process-based geology)

2026-10-11. Written before any of it ran. Started inside Seismic Glade (a
WebGPU full-waveform-inversion sandbox) as piece 1 of a plan: a simulator
that builds a section the way an extensional basin forms, and a gallery page
to judge by eye whether it looks like real geology. Later pieces: fit its
parameters to an inverted (pixel) velocity model, then FWI on its
parameters; and the same simulator as the training-data generator of a
learned prior. Each version below was written before it ran; the results
come from the page's verification panel.

## Rules (textbook basin geology, not any test section)

Forward in time, on a grid 2 km wider than the 9.2 x 3 km window on each side
and 4.5 km deep, step by step:

1. Regional subsidence: every column moves down by s(x) = s0 (1 + tilt (x/W -
   1/2)) + a sin(2 pi x / lambda + phase), so the basin deepens unevenly and
   gentle folds grow over time (negative s lifts and exposes highs).
2. Growth faults (syn-rift phase): listric normal faults, z_f(x) = z_d (1 -
   exp(-|x - x_s| tan(theta) / z_d)): steep at the top (theta 55-70 degrees),
   flattening into a detachment at z_d (2.5-5 km); most dip basinward, some
   antithetic; basinward faults start later (younging basinward). Each step an
   active fault slips by a heave increment; its footwall stays, its hanging
   wall moves by vertical shear (Verrall 1981): (x, z) -> (x + h, z + z_f(x +
   h) - z_f(x)), which keeps it on the fault and rolls it over into the fault.
   Faults move with the footwall's subsidence and with the slip of any fault
   whose hanging wall they sit in, and grow upward through new sediment.
3. Erosion: material above wave base (the step's water depth minus 30 m) is
   removed: footwall crests and fold highs are truncated (unconformities).
4. Deposition: each step fills the space down to the step's base level (water
   depth 30-300 m) by a fill fraction (0.7-1, plus a thin drape everywhere),
   so hanging walls collect thicker growth strata. Each unit is split into
   2-6 beds.
5. Phases: 2-4 pre-rift units (flat), 8-16 syn-rift steps (faults active),
   3-8 post-rift steps (faults quiet, sag, progradation: sand-rich near a
   shoreline that moves basinward).

Velocity (rock physics, today):
- Porosity decays with depth below the sea floor (Athy): phi = phi0 exp(-d / L),
  shale phi0 0.62, L 1800 m; sand 0.42, 3000 m; mixed by each bed's sand
  fraction f(x) = a + b tanh((x - c) / d) (lateral facies).
- Velocity from porosity by the critical-porosity model (Nur): v = 1500 + (vm -
  1500) (1 - phi / phic), shale vm 3700, phic 0.65; sand 5200, 0.45.
- Rare carbonate units (phi0 0.35, L 1500 m, phic 0.40, vm 6200).
- Overpressure (in 35% of sections): below a depth of 1.5-2.5 km under the sea
  floor, shale-rich beds keep a quarter of the compaction they would gain
  (disequilibrium compaction), so velocity can decrease with depth.
- Basement 4800-5500 m/s; water 1500 m/s; everything within 1500-5600 m/s
  (the range of the FWI window it was built for).

Not included now: mechanical compaction of thickness (beds keep their
deposited thickness; only velocity compacts), salt, channels, thrusts and
compression, inclined (non-vertical) shear.

## Checks, on the page

- No trapped water: no water cell below the sea floor in its column (the
  count is shown; any found is filled from the cell above and counted).
- Velocity within 1500-5600 m/s; the number of beds, faults and steps shown.
- Same seed, same section (deterministic).

## Literature check of version 1 (2026-10-11, before any change)

Each rule against published values (web searches of 2026-10-11; where only a
secondary source or memory backs a value it says so):

| Rule in version 1 | Literature | Verdict |
|---|---|---|
| Normal fault dip at the top 55-70 degrees | Anderson-Byerlee optimum 60-65 degrees; most seismogenic normal faults 30-60 (Olive and Behn 2014); British coal-measure faults nearer 70 (Walsh and Watterson); Gulf of Suez 30-40 | plausible, narrow: widen to 45-70 |
| Listric faults onto a detachment | standard for growth faults; not every normal fault is listric (Grasemann et al. 2004) | fine for this basin type |
| Hanging wall by vertical shear (Verrall) | inclined (antithetic) shear judged most realistic for listric faults (Dula 1991; Xiao and Suppe 1992); vertical shear is an end-member; shear-angle conventions differ between papers | simplification; inclined shear to add |
| Basinward faults start later | Thorsen 1963: basinward migration of growth-fault activity (Gulf Coast) | supported |
| Slip per step random around a constant | Thorsen 1963: rate rises to a maximum, then falls to cessation | wrong shape: make it rise and fall |
| Post-rift subsidence x 0.85 per step | McKenzie 1978: thermal time constant 62.8 Myr (exponential decay) | wrong unless a step is ~10 Myr: give steps a duration and decay with 62.8 Myr |
| Sand phi0 0.42, L 3.0 km | Sclater and Christie 1980 sandstone phi0 0.49, c 0.27 /km (L 3.7 km; via Baldwin and Butler 1985) | change to 0.49, 3.7 km |
| Shale phi0 0.62, L 1.8 km | commonly quoted Sclater and Christie shale 0.63, 0.51 /km (L 1.96 km; from memory, not confirmed); Baldwin and Butler prefer a power law for shale | change to 0.63, 1.96 km; confirm in the paper |
| Velocity linear in porosity to phic (my "critical porosity" form) | Nur's critical-porosity model is linear in the moduli, not in velocity; Raymer-Hunt-Gardner (1980): v = (1 - phi)^2 vm + phi vf below 37%, Wood's suspension above 47%, interpolated between (Marion 1990: suspensions follow Wood down to ~45%) | wrong form: change to RHG + Wood |

Not checkable from the rules alone, so measured on simulated sections (the
page's verification panel): the expansion index across growth faults
(hanging-wall over footwall thickness; Thorsen 1963; examples 1.0-1.5, e.g.
a classic Gulf Coast fault at 1.45); throw increasing with depth (the classic
growth-fault form); slip, sedimentation and subsidence rates (mature rift
faults 0.03-0.2 mm/yr, young fast rifts 1-7; syn-rift sedimentation below 0.05
in starved North Sea hanging walls, 0.03-0.3 in depocentres, ~1 mm/yr on a
fed margin like the Gulf of Lion); velocity with depth below the sea floor
against Hamilton's marine-sediment fits (1979 turbidites: v = 1.511 + 1.304 D -
0.741 D^2 + 0.257 D^3 km/s, D in km, to ~1 km; 1985 DSDP terrigenous: v =
1.510 + 1.019 h); and the physics of the kinematics (vertical shear preserves
area: each hanging-wall column keeps its rock).

Ways to check realism beyond this: real sonic logs (the FORCE 2020 set: 118
Norwegian wells, LAS about 170 MB, NOLD 2.0 licence) for velocity with depth;
and a blind comparison by a geologist (simulated and real sections mixed).

## Version 2 (2026-10-11): changed after the literature check

Changed: fault dips 45-70 degrees; each fault's heave per step follows a rise
and fall (a half sine over its active steps, +-20%); steps last 0.5-2 Myr
(drawn per section) and post-rift subsidence decays as exp(-t / 62.8 Myr);
porosity from Sclater and Christie's sand (0.49, 3.7 km) and shale (0.63,
1.96 km) curves mixed by sand fraction (chalk 0.70, 1.41 km for carbonates,
the commonly quoted pair, not confirmed); velocity from porosity by
Raymer-Hunt-Gardner below 37%, Wood above 47%, slowness interpolated between
(the interpolation's exact form is not confirmed from the 1980 paper), with
quartz (K 37, mu 44 GPa), clay (21, 7) Hill-averaged, calcite (70.8, 30.3),
brine (2.4 GPa, 1030 kg/m^3). Each slip now checks that every hanging-wall
column keeps its rock.

Not changed yet: vertical shear (inclined shear is the documented better
model); no compaction of bed thickness; no salt, channels or compression.

The page's verification panel simulates 20-100 sections and measures:
velocity with depth below the sea floor (10/50/90%) against Hamilton 1979
and 1985; the expansion index of units deposited before and during each
fault's activity; how many faults' throw grows with depth; fault dips between
the sea floor and 1 km below it on the final traces; slip, sedimentation and
subsidence rates; the rock kept by each slip, trapped water, determinism.
Inputs taken from the literature are listed as such, not as checks.

## Version 2 checked (the page's panel, 40 sections from seed 8178)

| Check | Simulated: median (10-90%) | Literature | Verdict |
|---|---|---|---|
| Velocity 0.5 km below sea floor | 1600 m/s | Hamilton 1979: 2010; 1985: 2019 | 20% slow |
| Velocity 1 km below sea floor | 2240 m/s | 2331; 2529 | 4% slow |
| Expansion index, during activity | 1.33 (0.93-2.33) | above 1; examples 1.0-1.5 | consistent |
| Expansion index, before activity | 1.00 (0.50-1.18) | about 1 | consistent (wide spread: measurement) |
| Throw grows with depth | 71 of 126 faults | classic growth faults | often not (see below) |
| Dip, sea floor to 1 km | 58 (48-68) degrees | 30-70 | consistent |
| Slip rate | 0.084 (0.025-0.208) mm/yr | 0.03-0.2 mature rifts | consistent |
| Sedimentation rate | 0.216 (0.057-0.523) mm/yr | 0.03-0.3 depocentres, ~1 fed margins | consistent |
| Subsidence rate | 0.120 (0.072-0.287) mm/yr | 0.01-1 | consistent |
| Rock kept per slip | 0.65% worst | 0 (area-preserving) | grid rounding only |
| Trapped water; determinism | 1 cell in 40 sections; yes | 0; yes | rounding at a scarp |

Reading: (1) The shallow velocity is too low because Wood's suspension
equation, used above 37-47% porosity, has no grain frame; sediments a few
hundred metres down already carry effective stress. (2) "Throw" was measured
as the vertical offset of unit tops in columns 250 m from the fault; on a
listric fault the vertical part of the slip shrinks where the fault
flattens, so older, deeper units can show less vertical throw although they
are displaced more. The check should compare displacement at the fault
cutoffs. (3) One trapped cell is nearest-cell rounding at a fault scarp.

## Version 3 (2026-10-11): pressure-dependent rock physics, displacement check

Written after the version 2 check and before it ran:
- Clastic velocity from the soft-sand model (Dvorkin and Nur 1996): a
  Hertz-Mindlin grain pack at critical porosity under effective pressure P =
  (1950 - 1030) x 9.81 x depth (hydrostatic pore pressure; the overpressure
  zone uses its effective depth, so it has less effective stress), coordination
  number 8.6, joined to the mineral point by the modified Hashin-Shtrikman
  lower bound; above critical porosity the frame stiffness falls linearly to
  zero over 0.15 porosity (a heuristic; it then equals Wood); Gassmann for the
  brine. Critical porosity 0.40 for sand, 0.65 for shale, mixed. With depth
  the rock cements: between 1.5 and 2.5 km below the sea floor the velocity
  blends smoothly into Raymer-Hunt-Gardner (consolidated rock); quartz
  cementation starting near 2-2.5 km (70-100 C) is the usual picture
  (Bjorlykke, Walderhaug; from memory, not checked).
- Shale is 60% clay minerals and 40% quartz silt, not pure clay (average
  shale is roughly 60% clay; Yaalon 1962, from memory).
- Carbonates keep Raymer-Hunt-Gardner on calcite.
- Displacement check: for each fault and unit, the cutoffs where the unit
  meets the fault on each side; displacement is the distance between them;
  it should grow for older units.
- A trapped-water count of a few cells per batch is reported as rounding.

Expected before running: velocity 0.5 km below the sea floor up from 1600 to
about 1800-1950 m/s; at 3 km, sands near 3.5-4 km/s and shales near 3 km/s.

## Version 3 checked (40 sections from seed 1)

| Check | Simulated | Literature | Verdict |
|---|---|---|---|
| Velocity 0.5 km below sea floor | 1940 m/s | Hamilton 1979: 2010 | -3% (predicted 1800-1950: met) |
| Velocity 1 km below sea floor | 2200 m/s | 2331 (1985: 2529) | -6% |
| Expansion index during / before activity | 1.36 (0.89-2.50) / 1.00 (0.47-1.20) | >1, examples 1.0-1.5 / about 1 | consistent |
| Displacement (cutoff chord) grows for older units | 79 of 126 faults | classic growth faults | often not |
| Dip; slip; sedimentation; subsidence | 59 (47-67) deg; 0.070; 0.197; 0.110 mm/yr | 30-70; 0.03-0.2; 0.03-1; 0.01-1 | consistent |
| Rock kept per slip; trapped cells; determinism | 0.94%; 14 in 40 sections; yes | 0; 0; yes | rounding |

The 10-90% band widens at 1.3-2 km (fast carbonate units) and its low edge
drops near 2.5 km (overpressured shale): both intended.

Why the chord check still fails, before changing it: under vertical shear
every hanging-wall point moves by the same heave and stays on the fault, so
on a listric fault the cutoff of a deeper unit moves along a flatter part,
and the same heave gives a shorter chord. The conserved quantity is the
heave, not the chord; the chord check was the wrong measure for this
kinematics, not a failure of it. Rather than replace the failing row, the
page now shows three: the chord (kept, with that reason); heave grows for
older units (an implementation check: true by the kinematics up to
measurement, so it should be near all faults); and throw grows with depth
within the units deposited while the fault slipped (the literature's
growth-fault form, a real test). Written before they ran.

### The three offset checks (same 40 sections, seed 1)

| Check | Result | Verdict (rule fixed before the run) |
|---|---|---|
| Chord between cutoffs grows for older units | 79 of 126 | often not, as explained |
| Heave grows for older units (implementation) | 112 of 126 (89%) | below the 90% set: unexplained |
| Throw grows with depth within growth units (literature) | 107 of 124 (86%) | consistent with growth faults |

The heave check fails by its own rule (89% against 90%). Before guessing,
the page now sorts the faults that fail it into: crossed by another fault in
the window; top within 1 km of a window side; antithetic (dipping west);
other. If "other" is near zero the failures are fault interaction or edges
(expected for heave measured between two cutoffs); if not, the kinematics or
the cutoff search has a bug to find.

Breakdown (same 40 sections): 7 crossed, 2 at an edge, 1 antithetic, 4
other: 4 unexplained, so by the rule above, look for a bug. Found in the
measurement before guessing further:
- The cutoff search walked each trace from index 0, which is the top end
  only for faults dipping east; for west-dipping faults it started at the
  deep end and found the wrong cutoff (a measurement bug). Fixed: it walks
  from the top end.
- "Crossed" only looked inside the 9.2 x 3 km window, while units are measured
  over the whole simulated grid (2 km margins, 4.5 km deep), where faults also
  cross (below 3 km, near their detachments). Fixed: crossings anywhere in the
  simulated grid.
- Footwall crests erode at low sea level, so a unit's top cutoff there can sit
  below its true top, while its base is intact. Each failing fault is now also
  measured at the units' base cutoffs; a fault that passes there is listed as
  "eroded tops". The heave row itself still uses the top cutoffs, as written
  before the run.

Rerun (same 40 sections): heave grows for 107 of 126; failures 16 crossed, 0
at an edge, 0 eroded tops, 0 antithetic, 3 other: still above the 2 allowed.
Expansion index before activity moved from 1.00 to 0.90 (0.43-1.10): the
walk fix changed the west-dipping faults' cutoffs.

A third flaw in the measurement: the cell "60 m into a side" was taken
horizontally, which on the flat, deep part of a listric fault can land below
the fault (in the footwall) instead of above it. Fixed: the side cells are
taken along the fault's normal. To stop testing the measurement by the
measurement, a test with a known answer is added before the next run: one
fault, no low sea level (no erosion) and no folds, 12 seeds; for every unit
the heave between its cutoffs must equal the heave applied to the fault after
the unit was deposited (the fault's slips are known exactly). Rule: every
unit within 40 m (two cells). Pass: the kinematics are right and the field
failures are fault interaction. Fail: a bug in the kinematics.

Rerun with the normal-direction sides and the known-answer test: heave grows
for 121 of 126 (3 crossed, 2 other: within the rule); throw within growth
units 114 of 123; but **the known-answer test fails: 57 of 141 units within
40 m, worst 187 m.** Two causes found, one in each place:
- The simulator: every slip moved the hanging wall by a whole number of
  cells (the source column was rounded), dropping the fraction of the heave;
  over 10-15 slips a fault's real heave drifts from the recorded one. A real
  kinematics error. Fixed as the subsidence already was: the remainder is
  carried to the fault's next slip, and the heave recorded is the heave
  applied.
- The measurement: a cutoff found by stepping 60 m into a side is off by
  about 60 m / tan(angle between bed and fault), hundreds of metres where beds
  meet the flattening fault at a low angle. Fixed: cutoffs from column scans
  (hanging wall: the first column, from the fault's top side outward, holding
  the unit above the fault; footwall: where the unit's top stops being intact
  below the fault), good to a cell at any angle. Heave, throw and the chord
  use these; the expansion-index columns are placed from them as before. The
  "eroded tops" category is dropped with the old cutoff search.
Rule unchanged: every unit within 40 m.

Rerun with the carried remainder and column-scan cutoffs: known-answer test
82 of 109 within 40 m, worst 300 m (fails); expansion index before activity
0.67 (0.20-1.00), off; heave grows for 95 of 126 (15 crossed, 16 other);
throw within growth units 81 of 121. Worse, and one explanation fits all of
it: rock from the footwall smeared into the hanging wall along the fault.
Each hanging-wall cell takes its source depth rounded to the nearest cell,
and next to the fault that can be the first cell below the fault at the
source column, which is footwall; so at every slip a one-cell sliver of
footwall units is dragged up along the fault into the hanging wall. The
column scans read that sliver as the unit's hanging-wall cutoff (errors up to
the whole heave), and columns placed from it fall where the unit is cut,
thinner (expansion index below 1). The old 60 m sampling skipped over the
sliver. The "rock kept per slip" row (0.94%, about one cell per column of a
hanging wall about a hundred cells deep) was its trace. Fix in the
simulator, before the next run: a hanging-wall cell never takes rock from at
or below the fault at its source column (it takes the last cell above it).
The measurement is left as it is, so the known-answer test shows whether
this was the cause. Expected: the test passes, the expansion index before
activity returns near 1, and the rock-kept row drops.

Rerun with the sliver fix: known-answer test 132 of 146 within 40 m (90%,
up from 75%) but worst 1520 m; expansion index before activity 0.85
(0.29-1.08), still off; rock kept per slip still 0.96% (it did not drop, as
predicted); heave grows for 95 of 126 (18 crossed, 13 other). The sliver fix
helped the test but the prediction about the rock-kept row failed, so the
sliver was not the whole story, and a 1520 m error is a gross failure of the
cutoff search on some unit, not rounding. Guessing from summary numbers has
now gone four rounds; the next step is to look at the failing units
themselves (seed, fault, unit, expected and measured cutoffs).

### Debugging in the terminal (debugging only; the record comes from the page)

On the 12 known-answer seeds, printing each failing unit and maps of the
grid around its cutoffs:
1. Single stray footwall cells sat just above the fault. The fault was a free
   polyline whose points were not on grid columns; uneven subsidence moved
   neighbouring points by different whole cells, so the trace drifted against
   the rock by up to a cell and cells switched sides between slips (also the
   source of the smear and of the ~1% rock-kept error). **Fixed in the
   simulator:** each fault is held as one depth per grid column, so rock and
   fault move by the same cells.
2. That rewrite had a bug of its own: the loop extending a fault upward each
   step stepped from its already-moved top, skipping columns; the holes in the
   trace became "gap" columns at the next slip and were emptied down to the
   fault (1 km deep holes, filled by thick single beds: vertical stripes).
   **Fixed.**
3. Units whose hanging-wall cutoff lies below the grid (4.7-6 km; the grid
   ends at 4.5 km) cannot be measured: **excluded** (cutoffs within 300 m of
   the grid's bottom). Low-angle cutoffs were off by about 3 cells: **cutoffs
   now extend each horizon into the fault** from its last intact columns.
4. Result: 5 of 128 units over 40 m (worst 60 m, mean 13.9 m) on the 20 m grid;
   **0 of 140 over 40 m (worst 20, mean 6.0) on a 10 m grid.** [Correction
   written after the version 4 run: these counts were mis-copied from the
   terminal; the run printed 118 of 123 within 40 m (5 over, worst 60 m, mean
   13.8 m) and 131 of 131 (worst 20 m, mean 5.8 m). The conclusion stands.] The error
   halves with the cell: grid rounding, not a kinematics bug. By the rule
   written before (every unit within 40 m on the 20 m grid) the test still
   fails at 20 m; the page now also runs it on 10 m and shows both.

The field checks, run once in the terminal to see that nothing else broke
(40 sections, seed 1): velocity 1940 / 2200 m/s at 0.5 / 1 km; expansion index
1.27 (0.83-2.20) during, 0.95 (0.43-1.09) before; heave grows for 109 of 126
(11 crossed, 6 other), unchanged in kind on a 10 m grid (112 of 126; 9
crossed, 5 other), so not rounding; throw within growth units 103 of 122;
dips 55 (46-63); rock kept 0.93%; no trapped water; deterministic. All 4
"other" faults printed were nested: each is a younger fault whose top lies in
the hanging wall of an older active fault, so the older fault's slip shears
it and its units, and its older units' cutoffs sit near its flat base where
bed and fault meet almost parallel. The page now counts "nested" separately;
**this category was added after looking at the failures.** Whether nesting
upsets the kinematics or only the measurement is open: a known-answer test
with two nested faults would settle it.

## Version 4 (2026-10-11): any setting, compaction, burial memory

Why: the simulator is meant to say what is real geology in an inversion, so it
must not know only one kind of basin (a prior that knows only growth faults
would "correct" a thrust or salt away). The goal: it should work for
any geology. Most of the simulator does not depend on the setting (deposition,
burial, compaction, rock physics, overpressure); only the deformation does.
So version 4 adds a second deformation module and the two missing pieces that
apply to every setting. Written before any of it ran (a crash-only smoke run
of 32 sections was made in the terminal: no exceptions, no NaN, at most 165 ms
a section; no check was run).

Changes:
1. Compaction of bed thickness, every setting. Each cell keeps its solid
   grains (deposited as h (1 - phi) at its depth). Each step, up every
   column, a cell holding solid s at porosity phi (Sclater and Christie, at its
   depth below the sea floor) fills s / (1 - phi) of its height; the shortfall
   is summed and each time it reaches a whole cell, one cell is removed (its
   solid joins a neighbour of the same bed) and the column above moves down a
   cell. This is the decompaction (backstripping) equation run forward. Cells
   are never added, so uplift and erosion do not undo compaction. Faults move
   down with the cells removed below them, so compaction flattens them (Xiao
   and Suppe 1989: a growth fault starting at 67 degrees flattens to 38 by 5 km,
   23 degrees of it from compaction; in pure shale up to 19 degrees in the first
   500 m). Compaction makes room, so more sediment is deposited: differential
   compaction drapes beds over sand-rich and footwall highs.
2. Velocity at each rock's deepest burial so far, not its present depth:
   porosity is not regained on uplift. Rock exhumed on a footwall crest or
   carried up a thrust stays fast; this is the basis of exhumation estimates
   from sonic logs (Japsen; Hillis 1995). Porosity and the effective pressure
   both use the deepest burial (a simplification: on unloading the frame
   relaxes a little).
3. Compression setting (thin-skinned fold-and-thrust belt). 4-8 flat
   pre-thrust units (a passive margin), then 6-12 syn-thrust steps, then 2-5
   post-thrust steps. Transport east or west (drawn). 1-3 thrusts, ramps at
   least 2 km apart, active one at a time from the hinterland toward the
   foreland (in sequence), each slipping 0.6-2.4 km over its steps (rate rising
   and falling). A thrust: a basal detachment at 60-92% of the sediment
   thickness, a ramp dipping 18-32 degrees (Andersonian thrusts near 30), then an
   upper flat (a higher detachment at 30-55% of the way up: a blind thrust and
   a fault-bend fold) or the sea floor (an emergent thrust whose sheet rides
   over the foreland), half each. Hanging walls move by fault-parallel flow
   (the kinematic algorithm of the structural-restoration software: each
   point keeps its distance to the fault and moves parallel to the fault
   segment under it; I take the dip domains as bounded by the bisectors of the
   bends, as I understand the published algorithm, not confirmed from a
   paper). On the bisectors the distance to both segments is equal, so flow
   lines are the fault's parallel curves and moving everything the same
   distance along them keeps area (a balanced section). Each dip domain moves
   by whole cells with its rounding carried to the next slip (else the rock
   drifts off the flow lines by a fraction of a cell every step). Older
   thrusts in a younger one's hanging wall are carried (piggyback). Rock
   enters at the hinterland edge as the edge column continued; rock pushed
   above sea level is lost. Foreland subsidence deepens toward the hinterland
   (0 tilt in the tests). Growth strata fill to the base level, so they thin
   onto the anticlines; crests above wave base erode.
4. Setting "any" (the default): each seed draws extension or compression
   (half each) from its own random stream.

Known-answer tests (rules fixed now, before running):
- Normal-fault heave (unchanged test, now with compaction off so it tests
  the kinematics alone). The code it tests is unchanged apart from a
  refactor of how other faults are carried, so **the result should be
  identical to the last one**: 20 m worst 60 m with 5 of 128 units over 40 m;
  10 m 0 of 140. Any difference means the refactor changed something.
  [Those counts were mis-copied, see the correction above: the last run was
  118 of 123 and 131 of 131.]
- Compaction (6 seeds, no faults, no erosion, no overpressure): (a) every bed
  holds the solid it was deposited with (relative difference below 1e-8;
  bookkeeping); (b) each bed in every tenth column has the thickness the
  decompaction equation gives for its solid at its depth (the integral of 1 -
  phi over the bed equals its solid), within one cell (20 m) for at least 95%
  of the beds, mean error within 5 m. Expected: both pass; the cell removal
  keeps every bed boundary within one cell of its target by construction.
- Thrust (12 seeds, one thrust, no erosion, uniform subsidence, no
  compaction), on 20 m and 10 m grids: (a) with uniform subsidence the fault
  keeps its shape in a frame that moves down with the subsidence, and
  fault-parallel flow along fixed flow lines composes (slips s1 then s2 equal
  one slip s1 + s2), so every hanging-wall cell can be traced back to the grid
  at the end of the pre-thrust phase; cells of pre-thrust beds (2 cells from a
  bed boundary and from the fault; dropped where the rock would have been
  above sea level) must hold the bed traced back: at least 99% on each grid.
  (b) Backlimb dip: beds carried from the lower flat onto the ramp dip as the
  ramp (classical fault-bend folding, Suppe 1983; fault-parallel flow keeps
  the angle between bed and fault): each pre-thrust unit's top over the ramp,
  fitted over at least 10 columns, within 2 degrees of the ramp's dip for at
  least 90% of units. The pre-thrust beds follow the sloping base level (up
  to 0.9 degrees), so errors up to about 1 degree are expected. (c) Rock kept by
  each thrust slip (hanging-wall rock before, plus what entered at the edge,
  minus what left above sea level or at the far edge): below 2%.
  Expected: all pass on both grids; if (a) fails at 20 m and passes at 10 m,
  rounding; if it fails on both, a bug in the kinematics.

Field rows expected to move, predicted now (40 sections, setting "any", so
about half extension):
- Velocity 0.5 and 1 km below the sea floor: the porosity-depth law is
  unchanged; burial memory makes eroded crests and thrust sheets faster:
  within a few percent of version 3 (1940 and 2200 m/s), slightly higher.
- Expansion index during activity: hanging-wall units are deeper than their
  footwall equivalents, so more compacted: a little below version 3's 1.27
  (about 1.15-1.3).
- Normal-fault dip from the sea floor to 1 km: compaction flattens buried
  segments: below version 3's 55 degrees median by a few degrees (about 45-55).
- Heave grows for older units: compaction is vertical and keeps heave: about
  the same share as before (109 of 126), on about half as many faults.
- Velocity inversions and total thrust slip: for the record, no rule.

Still not included: salt (next: bodies placed by shape, sediments draped and
minibasins), inclined shear on normal faults, out-of-sequence thrusts,
backthrusts, fault-propagation folds (trishear), inversion (extension then
compression in one section), channels.

### Version 4 checked (40 sections from seed 1: 21 extension, 19 compression)

| Check | Result | Rule or prediction (written before) | Verdict |
|---|---|---|---|
| Normal-fault heave, known answer, 20 m | 118 of 123 within 40 m, worst 60, mean 13.8 m | identical to the last run (118 of 123) | identical: the refactor changed nothing |
| the same, 10 m | 131 of 131, worst 20, mean 5.8 m | identical (131 of 131) | identical |
| Compaction: solid kept in each bed | 4e-14 relative, 475 beds | below 1e-8 | passes |
| Compaction: bed thickness against the decompaction equation | 13238 of 14019 (94.4%) within one cell; mean +1.1 m; worst 72 m | 95% within a cell, mean within 5 m | **fails** (94.4% against 95%) |
| Thrust against the flow applied at once, 20 m | 100.00% of 13183 cells | 99% | passes |
| the same, 10 m | 100.00% of 250892 cells | 99% | passes |
| Backlimb dip minus ramp dip | +0.1 deg (-1.1 to +1.6); 49 of 54 within 2 deg | 90% within 2 deg; errors up to ~1 deg expected | passes (91%) |
| Rock kept per thrust slip, known-answer runs | 1.22% worst | below 2% | passes |
| Rock kept per slip, all field sections | 3.58% worst | below 2% | **fails** |
| Velocity 0.5 / 1 km below the sea floor | 1960 / 2200 m/s (-2% / -6% against Hamilton 1979) | within a few % of 1940 / 2200, slightly higher | as predicted |
| Expansion index during / before activity | 1.07 (0.67-1.70) / 0.92 (0.56-1.13) | during about 1.15-1.3 | **prediction missed** (lower); still above 1 |
| Heave grows for older units | 52 of 64 (81%); failing: 7 crossed, 4 nested, 1 other | about the same share as before (87%) | about the same (the 90% rule fails, as before) |
| Throw grows within growth units | 49 of 61 | | mostly |
| Normal-fault dip, sea floor to 1 km | 47 (37-59) deg | 45-55 (from 55: compaction flattens) | as predicted |
| Slip, sedimentation, subsidence rates | 0.068, 0.238, 0.107 mm/yr | within the literature ranges | consistent |
| Trapped water cells; determinism | 75 in 40 sections (0 in version 3); yes | | rounding by its rule (at most 5 a section), but new |
| Thrust slip per section | 2.7 (1.2-4.7) km | for the record | |
| Velocity inversions | extension 0.91, compression 0.76 of columns | for the record | the measure is flawed (below) |

Reading, before any change:
- Thrust kinematics are exact on both grids and the backlimb dips as the
  ramp: fault-parallel flow is implemented as specified.
- Compaction keeps every bed's solid exactly, but 5.6% of bed thicknesses are
  more than a cell off, up to 72 m. Hypothesis: a bed one cell thick can never
  lose its cell (so beds do not vanish), so beds thinner than a cell stay a
  full cell thick and their excess is taken from the next bed that can lose
  one; runs of thin beds pass several cells of error to one neighbour. If so,
  the failing beds sit next to one-cell beds, and the error shrinks on a 10 m
  grid. Not yet tested.
- Rock kept per slip fails only in the field sections, not in the
  known-answer runs (no compaction, uniform subsidence). Not known yet which
  kind of fault gives the 3.58%. Hypothesis: compaction moves a thrust's
  depth column by column, so between its bends the fault is no longer the
  straight segment its flow lines are built from; hanging-wall cells near
  the fault then take footwall-clamped or skipped rock. The 75 trapped
  cells may be the same thing.
- Expansion index: lower than predicted. Possible reason, after the fact:
  compaction makes room everywhere, so every unit is thicker and the same
  fault-driven extra thickness is a smaller ratio, and hanging-wall units,
  being deeper, are more compacted. Not tested.
- The inversion measure counts any drop of 300 m/s below faster rock, so
  ordinary sand-shale alternation counts; it should use velocity smoothed
  over a few hundred metres. A flaw in the measure, not in the simulator.

### Debugging version 4 in the terminal (agreed; the record comes from the page)

Rock kept per slip (3.58% in the field sections):
1. A log of every slip's rock change showed it was thrusts only (normal faults
   at most 1.23%), and it did not go away with compaction off: the hypothesis
   that compaction bends the thrust was wrong.
2. Next hypothesis: the stored fault strays from the straight polyline its
   flow lines are built from (an emergent thrust's flat followed the bumpy
   sea floor). It strayed by only 1-3 cells, and the error did not follow the
   size of the strays. Straightening each thrust onto its polyline before it
   slips, and making an emergent thrust's flat a straight line at or just
   below the sea floor ahead (the sheet scrapes the top sediments off the
   bumps), cut the trapped water from 65 to 27 cells but left the rock error
   as it was: not the main cause. Both changes were kept (the flow is only
   defined above the polyline).
3. Mapping one bad slip cell by cell (which source cells no target took, and
   which several took): about 280 duplicates in the row next to the fault
   along the flats. In the field sections the flats tilt slightly (uneven
   subsidence); each dip domain moved by whole cells, and its vertical move,
   rounded on its own, pushed the row next to a gently sloping flat into it in
   some columns and off it in others. The known-answer runs have level flats,
   so they could not see it. Fix: within a domain, the hanging wall moves a
   whole number of columns (the fraction carried to the next slip) and each
   cell keeps its number of rows above the domain's fault segment.
4. The first version of that fix counted rows above the stored fault under
   each column, which broke the thrust known-answer test (96.2% at 20 m,
   94.6% at 10 m, against 100% before): the cells off were more than 40 rows
   above the fault next to a bend, where the leaning bisector puts a cell in
   one domain while the fault under its column belongs to the other segment.
   Counting rows above the domain's own segment line (extended) fixed it.
5. Result (terminal): the thrust known-answer test back to 100.00% on both
   grids; rock per thrust slip 0.38% worst in the tests and 0.50% in the 40
   field sections; normal faults unchanged.

Trapped water: with the duplicates gone, water pockets under rock appeared at
emergent thrust fronts (151 cells): overhangs, which the exact flow makes
where the front rolls forward over a lower sea floor (the duplicated rock had
been filling them). Added a physical step after the slips: water below rock
in a column closes as the rock above drops into it, faults above moving down
with it (as in compaction). It is counted on the page (31 cells in the 19
compression sections, 10 in the 21 extension ones, the latter rounding at
scarps); none is left trapped.

Compaction thickness (94.4% within a cell at 20 m): at 20 m, 55% of all beds
are one cell thick (the grid cannot resolve them). The failing beds are just
over a cell off (+21 to +22 m), and are not more often next to a one-cell bed
than the passing ones (53% against 57%): the hypothesis that one-cell beds pass
their excess to a neighbour is not supported. On a 10 m grid 99.85% of beds
are within 20 m (mean error 0.3 m): the error is the grid's rounding. The rule
at 20 m still fails; the page now also runs the test on a 10 m grid with the
same 20 m tolerance, as for the heave test.

Changed after seeing the results (for the record only, no rule): the velocity
inversion measure now uses velocity averaged over 200 m of depth, so ordinary
sand-shale alternation is not counted.

Expected on the page now (the known-answer rows were seen in the terminal):
heave unchanged (118 of 123; 131 of 131); thrust 100.00% on both grids;
backlimb 49 of 54 within 2 degrees; compaction 20 m 13238 of 14019 (fails),
10 m 25964 of 26002 (passes); rock per slip below 2% for both kinds; no
trapped water. Compression field rows change a little (thrust geometry).

### Page rewrite (2026-10-11): one change that touches the numbers

The page now simulates in web workers. To make a section's history cheap,
velocity comes from a table per section (per overpressure top): clastics by
sand fraction every 0.02 and burial every 10 m to 6 km, carbonate by burial,
interpolated linearly. It is within a few m/s of the rock-physics formula, so
the velocity rows of the checks can move by a few m/s; nothing else changes.

### Numerical repairs after the reported failures (2026-10-12)

The report was reproduced with seed **765183**, 20 sections, setting **any**,
1–2 normal faults, 1–3 thrusts, compaction on, overpressure 0.35 and carbonate
0.1. The known-answer rows matched exactly; the field batch had 12 measured
normal faults and a growth expansion-index median of 1.00. The following
changes were made **after** investigating that failure. No pass thresholds,
porosity coefficients, fault-slip distributions or sedimentation parameters
were changed.

1. **Normal-fault remapping.** Rounding the difference between two fault
   depths can skip or duplicate the lowest hanging-wall row. Repeating slips
   accumulates this error. Normal slips now preserve a cell's integer row
   offset above the fault, using the difference between the two fault row
   boundaries. Carried faults use the same displacement. This fixes all five
   failed 20 m heave measurements. Finer-grid convergence alone had not ruled
   out a remapping bug; the earlier interpretation as only rounding was too
   strong.
2. **Compaction.** Accumulating shortfall across beds and merging solid into
   individual neighbours allowed impossible cell contents: one 20 m cell in
   known-answer seed 910003 held 61.48 m of solid; the reported field batch
   reached 115.05 m. Each contiguous bed now compacts from its own solid
   content and the compacted overburden above it. A midpoint porosity solve
   sets its target thickness, rounded to cells and capped at its existing
   thickness, so unloading does not expand it. Solid is redistributed within
   that bed, with no cell allowed more grains than its own height. The column
   stays anchored at its base; fault boundaries and burial memory move with
   the retained rock. The verification still uses its separate, exact
   integrated decompaction equation, not the simulator's midpoint solve.
3. **Expansion-index measurement.** A column 250 m beyond the *top* cutoff
   can still intersect the lower part of the unit at the fault. Measuring
   that fragment underestimates hanging-wall thickness. The measurement now
   walks to the nearest complete interval, with one cell of fault clearance,
   on each side. It does not search for the thickest interval. Missing,
   repeated, bottom-clipped or separately fault-cut intervals are not used
   for expansion, while their independent cutoff measurements remain.
   The page reports the number of complete pairs. Analytic fixtures with
   known thickness ratios of 1, 1.5 and 2 verify both fault directions and
   ensure the search does not invent growth in equal-thickness units.

Results from the same TypeScript simulator and checks used by the worker,
run in Node (not read from the browser):

| Check | Before | After |
|---|---|---|
| Normal heave, 20 m | 118/123 within 40 m; worst 60 m | **123/123**; worst 40 m, mean 10.7 m |
| Normal heave, 10 m | 131/131; worst 20 m | **131/131**; worst 18.4 m, mean 5.2 m |
| Compaction thickness, 20 m | 13238/14019 within 20 m; worst 71.7 m | **15786/15786**; worst 17.6 m, signed mean +2.1 m |
| Compaction thickness, 10 m | 25964/26002 within 20 m; worst 31.8 m | **27097/27097**; worst 7.7 m, signed mean +0.5 m |
| Solid kept per bed | worst relative error 1.40e-13 | **1.33e-13** |
| Growth EI, seed 765183 batch | 1.00 (0.67–1.50) | **1.17 (1.00–1.75)**, 99 complete pairs |
| Pre-fault EI, same batch | 1.00 (0.71–1.10) | **1.00**, 31 complete pairs |
| Thrust known answers | 100% agreement on both grids; 49/54 backlimb dips within 2° | unchanged |

Compaction sample counts increase because the corrected geometry leaves
more beds resolved by at least two cells; the sampling rule is unchanged.
All pass/fail rows pass for the reported 20-section batch. Its maximum slip
area error is 0.53%, no trapped water remains, and cell solid content stays
at or below 20 m.

The historical benchmark (40 sections from seed 1, default settings including
2–4 normal faults) was also rerun before and after the changes. All rows now
pass: growth EI 1.25, pre-fault EI 1.00, heave increasing with age for 63/65
faults (previously 52/64), worst slip area error 0.74%, no trapped water,
deterministic. This does not imply that every seed range must pass every
statistical literature check.

`npm test` covers the reported batch and both grid resolutions, explicit
cell-volume bounds, determinism including solid and burial arrays, erosion,
overpressure and carbonate settings, both tectonic settings, analytic
expansion ratios, and unavailable/crossed sampling intervals. `npm run build`
and `git diff --check` pass. The simulator changes alter the geometry generated
by existing seeds. A 20-section run in Node had median simulation time about
223 ms per section; the old approximate 0.1 s UI timing is no longer claimed.

The unchanged exponential porosity model and irreversible-compaction
assumption are also described in the authors' [Strata manual, section 4.7](https://www.jsg.utexas.edu/flemings/files/Strata_Manual1.pdf).

### Scientific test audit (2026-10-12)

The subsequent [audit](validation-audit.md) separates numerical verification
from field validation and records the limitations of each check. It added
independent analytical thrust and constitutive-law fixtures, corruption tests,
sample-coverage reporting, physical-state bounds and fuller repeatability.
Controlled benchmarks now have fixed options independent of the page settings.

Two additional measurement/implementation issues were repaired:

- Velocity comparison rows used the 550/1050 m histogram bins while claiming
  500/1000 m. They now explicitly interpolate neighboring bin medians.
- Velocity-table interpolation crossed the pressure law's sand-fraction
  threshold, producing a 529.10 m/s error in the new direct-formula sweep.
  That interval and out-of-table depths now use direct evaluation. The full
  sweep passes its pre-repair 5 m/s tolerance.

The compaction rule is strengthened from absolute signed mean ≤5 m to mean
absolute error ≤5 m, retaining 95% within 20 m. The measured MAE is **4.873 m**
at 20 m and **2.431 m** at 10 m. All 15786/27097 measured intervals respectively
remain within 20 m. Excluded one-cell intervals are now visible: 14623 at
20 m and 5226 at 10 m; each resolution also excludes 293 deep intervals.
These exclusions limit the accuracy claim to resolved intervals.

The user's new **seed 190496, 20 sections, 1–2 normal faults** batch was rerun:
no failed rows, no invalid cells or velocities, no trapped water, and both
represented settings repeat exactly. The largest area error over 226 slips
is **0.387%**. Corrected velocity comparison estimates are **1920 m/s** at
0.5 km and **2190 m/s** at 1 km, rather than 1940/2220 from the deeper bins.

A separate 16-case option sweep, seeds 20261020–20261035, covers extension
and compression, 20/10 m, compaction off/on and the zero/maximum pressure and
carbonate settings. Across **5,961,256 cells**, there are no invalid states
or displayed velocities, no trapped water, and worst slip area error is
**0.360%**. This sweep is retained in the automated suite. These are internal
consistency and plausibility results; independent field validation is pending.

## Sources (searched 2026-10-11)

- Soft-sand model equations (as implemented): https://rockphypy.readthedocs.io/en/stable/getting_started/07_Soft_Stiff_Cemented_sand_models.html , https://code.agilescientific.com/bruges/_modules/bruges/rockphysics/rockphysicsmodels.html

- Sandstone porosity (Sclater and Christie via Baldwin and Butler 1985): https://archives.datapages.com/data/bulletns/1984-85/data/pg/0069/0004/0600/0622.htm
- Porosity-depth form (goSPL docs): https://gospl.readthedocs.io/en/stable/tech_guide/strat.html
- Hamilton velocity-depth fits: https://labs.sonicfield.org/library/sound-velocity-as-a-function-of-depth-in-marine-sediments , https://earthref.org/ERR/43893/
- Thorsen 1963 (expansion index, basinward migration): https://archives.datapages.com/data/gcags/data/013/013001/0103.htm ; a Gulf Coast example (EI 1.45): https://biotech.law.lsu.edu/blog/MBSD_2021_DraftEIS_Comments.pdf ; a critique of the index: https://www.sysydz.net/en/article/doi/10.11781/sysydz198903250
- Inclined vs vertical shear: https://crewes.org/Documents/ResearchReports/2013/CRR201302.pdf , https://www.frontiersin.org/journals/earth-science/articles/10.3389/feart.2023.1266454/full , https://geol00.geol.uniovi.es/TDG/Volumen25/TG25-05.PDF
- Normal-fault dips: https://en.wikipedia.org/wiki/Anderson%27s_theory_of_faulting , https://darchive.mblwhoilibrary.org/entities/publication/13cfb9f5-1750-55b7-9bea-c0c938f2420a/full , https://www.fault-analysis-group.ucd.ie/Publications/80DipsFaults.html
- Thermal subsidence (62.8 Myr): https://pages.uoregon.edu/rdorsey/BasinAnalysis/AngevineEtal1990/Chapt%204%20Thermal%20Subsidence.pdf , https://edisciplinas.usp.br/pluginfile.php/4959420/mod_resource/content/1/McKenzie1978.pdf
- Rates: https://www.fault-analysis-group.ucd.ie/Lectures/01synsed.html , https://experts.azregents.edu/en/publications/increasing-fault-slip-rates-within-the-corinth-rift-greece-a-rapi/ , https://archimer.ifremer.fr/doc/00718/83045
- Raymer-Hunt-Gardner and Wood: https://pangea.stanford.edu/~jack/GP170/Reading%231.pdf , https://dialnet.unirioja.es/descarga/articulo/4811216.pdf
- Compaction flattens growth faults (Xiao and Suppe 1989, AAPG Bulletin 73): https://archives.datapages.com/data/bulletns/1988-89/data/pg/0073/0006/0750/0777.htm
- Fault-bend folding, backlimb dip equal to the ramp's in the classical case (Suppe 1983, Am. J. Sci. 283; via the shear fault-bend folding papers): https://archives.datapages.com/data/specpubs/memoir82/CHAPTER16/CHAPTER16.HTM , https://courses.eas.ualberta.ca/eas421/lecturepages/thrustfoldkinematics.html
- Fault-parallel flow in use (no bisector rule confirmed): https://meetingorganizer.copernicus.org/EGU2017/EGU2017-7400.pdf?pdf , https://meetings.copernicus.org/www.cosis.net/abstracts/EGU06/07339/EGU06-J-07339.pdf
- Velocity records maximum burial (Japsen; burial anomaly): https://data.geus.dk/pure-pdf/27839_GEUS-R_2009_8_opt.pdf , https://www.earthdoc.org/content/journals/gpr/55/2
- Real well logs: FORCE 2020 https://zenodo.org/records/4351156 ; Volve https://www.equinor.com/en/energy/volve-data-sharing

## How it is judged

By eye: does a batch of sections look like real extensional
basins (growth faults with thickening hanging walls, rollovers, unconformities
on highs, compaction trends, lateral facies)? Marmousi is shown beside the gallery
for comparison only (when its file is present); the rules above were written
from basin geology before looking at it for this.


## Material composition and pressure/burial repair (2026-10-12)

Transported composition and separate present pressure/irreversible loading/burial
memory are implemented. See [the repair report](material-state-development.md) for
the assumptions, tests and unchanged primary FORCE development result. All 19
JavaScript and 13 Python tests pass without relaxing numerical tolerances. The
24 held-out wells remain unscored; their log arrays were neither read nor changed.


## Full sediment budget and 40/20/10 m refinement (2026-10-12)

See [the numerical study](sediment-conservation-convergence.md). Independent
full-domain inventories and explicit deposition, erosion and all boundary flows
are recorded per operation, step, bed and grain constituent. No flux is inferred
from a residual and no grains are renormalized. The frozen 12-case, three-grid
study produces 4,494 events: all 21 extension runs close, while 135 thrust events
in all 15 compression runs fail the roundoff-only criterion. The old 2% area rule
is unchanged and cannot override this new failure. The app shows both diagnostics.

Matched refinement uses one common cohort of 1,417 unit/location triples, with
all 2,820 candidates retained in a coverage ledger. RMS interval-velocity changes
are 91.92 m/s (40→20) and 36.99 m/s (20→10); 421 triples do not contract. The 10 m
run is not truth, and no universal convergence or field-accuracy claim is made.

All 35 JavaScript and 13 synthetic Python tests pass, along with type checking
and the production build. Tests explicitly require current thrust failures to
be reported. The numerical-study command saves its results and exits 1 when
conservation fails; software tests passing does not imply physical closure.
Physical output and all replay frames match the pre-instrumentation simulator
exactly on both settings at all three grids. No physical parameter was retuned.
No development or holdout observational arrays were read or changed.


## Conservative thrust transport (2026-10-12)

The [thrust repair](conservative-thrust-transport.md) assigns every retained rock
parcel once, preserving grain volume, bed composition and burial/loading maxima.
Continuous position offsets prevent repeated raster placement from accumulating
false motion. Compaction conserves the lateral grain moment, and placement
vacancies are distinguished from physical overhang collapse. Allocation tries a
two-cell stencil first, reports a bounded third-cell retry when necessary, and
fails explicitly if that cannot fit all parcels. The extreme-case sweep exercises
the wider search; the frozen numerical study never needs it.

All 50 JavaScript and 13 synthetic Python tests pass, as do type checking and the
production build. The original 99% thrust consistency and backlimb-dip tolerances
remain unchanged and pass. Independent transport fixtures check grain/constituent
closure, exact continuous paths, boundaries, footwall preservation, history and
composition, repeated small steps, optimal local assignment and explicit failure.

The same 12 histories at 40/20/10 m now give 36/36 closed runs and zero failed
operation budgets (formerly 135 failing thrust events). All 4,494 events close,
with a largest event/bed/component residual of 7.55e-6 m² under the original
roundoff tolerance. All 21 extension budget and comparison outputs are unchanged.

The new interval cohort contains 1,381 of 2,820 opportunities; 411 velocity
triples do not contract. Pooled velocity differences are 84.96 and 36.98 m/s.
On the 1,370 triples shared by both revisions, fine-grid RMS velocity difference
is effectively unchanged, 36.79 to 36.81 m/s. Conservation is repaired; no claim
of uniform convergence or field accuracy is made. Original results are retained,
and the new summaries and complete ledgers record the final source/plan hashes.
No observational development or holdout arrays were read or changed.


## Local grid-convergence diagnosis (2026-10-12)

The [diagnostic study](grid-convergence-diagnosis.md) adds an optional synchronous
operation observer, independent continuous compaction roots, exact velocity
state-substitution diagnostics, and synthetic operation traces. No production
physics or metric rule changes. The 36 standard runs reproduce all earlier
samples and coverage exactly and close all 4,494 budget events. Whole-column
process increments reproduce final inventories, including vanished units.

Six new diagnostic tests pass. The full JavaScript run passed 55 tests; its only
failure was an unchanged synthetic exporter helper omitted from the isolated
workspace. After restoring that helper and its benchmark metadata (no log data),
the remaining test passed in a targeted rerun. Thus all 56 current tests have
passed, including the original geometry gates, physical extremes and worker
transfer. Type checking and the production build pass. The initial full run and
successful targeted rerun are retained in the task verification record. Python
importer tests were not rerun because neither that code nor its data path changed.

The independent bracketed compaction solution yields the same rounded cell count
as production in every sampled bed-run event. Continuous solutions below one
cell occur in 52.10%, 23.72% and 10.15% of the sampled compaction events at 40,
20 and 10 m. The largest matched interval lookup discrepancy is 1.52 m/s.
Disabling compaction in the two no-fault controls reduces shared-cohort fine-grid
velocity RMS from 57.32 to 11.24 m/s and 35.06 to 8.61 m/s. That intervention
changes physics and is only a mechanism probe. The original convergence scores,
coverage rules and thresholds are unchanged; 411 velocity triples still do not
contract. The next repair is a subcell representation of bed volume and material,
with grain and pore-volume consistency checked together. No observational
arrays, development scores, holdout logs or split files were read or changed.


## Continuous thin-bed preservation (2026-10-12)

The [thin-bed repair](thin-bed-preservation.md) replaces the one-cell minimum
with ordered continuous material columns. Deposition, compaction, erosion,
subsidence, normal shear and budgets preserve real layer thickness and grains;
thrust parcels carry every mixed-cell component. Velocity uses actual pore
volume, present stress and retained memory, with harmonic projection to cells.

The broad regression initially exposed raster assumptions in normal-fault
shear and cutoff measurement. Both now operate on continuous interfaces.
Independent planar fixtures recover thin-horizon displacement at 40/20/10 m
in either direction. All 72 final JavaScript tests pass, including 16 new tests,
physical extremes, repeatability, replay, worker transfer and the original
geometry gates. The full run uses a 12 GiB Node heap allowance after the
default-memory run spent prolonged time near its limit. Type checking and the production build pass. The 24 normal
controls retain 122 coarse and 130 fine horizons, with worst heave errors
19.31 and 7.24 m under the unchanged 40 m rule. No tolerance was relaxed.

The same 12 histories at 40/20/10 m close all 36 runs and all 4,494 event
budgets. The largest event/bed/component residual is 1.23e-6 m² within the
original inventory-scaled tolerance; no sediment is added by repair. All
prescribed-history and plan fingerprints match the previous revision.

True subcell interfaces replace dominant-pixel interval measurements while
retaining the two-cell eligibility and other exclusion rules. Coverage is
1,301 of 2,820 opportunities (previously 1,381). On the 1,205 triples shared
by both revisions, fine-grid RMS velocity differences fall from 35.20 to
4.40 m/s and thickness differences from 24.31 to 4.22 m. On 144 common profiles,
vertical travel-time RMS falls from 12.86 to 0.85 ms. Shared samples above
50 m/s fall from 141 to zero. Strict noncontracting/new-change classifications
remain (363, including 242 below 1 m/s); uniform convergence is not claimed.
The whole new cohort has a maximum fine-grid velocity difference of 76.09 m/s.

Tests check layer composition instead of aggregate pixel labels and continuous
compaction invariance instead of requiring output-grid resampling to improve
an already continuous answer. The positive-erosion case checks a genuinely
uplifted history against its independently reconstructed wave base. Historical
whole-cell diagnosis/ablation runners fail early on mismatched source revisions.
Saved earlier results remain intact. Final source hashes, ledgers and verification
records are stored alongside the report. Runtime/memory costs and remaining
cell-based thrust/boundary approximations are explicit limitations.

No observational arrays or split files were read or changed. The unchanged
synthetic exporter helper and its benchmark metadata were used by the existing
regression. Python importer tests were not rerun because that code and data
path were unchanged. The holdout remains untouched.

## Normal-fault grid sensitivity (2026-10-12)

The [fault geometry repair](fault-grid-sensitivity.md) preserves prescribed normal
fault origins and fractional growth tips. All 77 tests, the build and all 4,494
budgets across the unchanged 36-run study pass. On 197 shared fault samples,
20-to-10 m RMS differences change from 10.089
to 5.479 m. Changes to bed metrics are smaller
and not uniformly improving. All no-fault and compression controls reproduce
the baseline. A broader thrust-bend prototype was rejected for coupled numerical
regressions. Existing tolerances, physical histories and holdout remain unchanged.


## Thrust coupling repair (2026-10-12)

The [thrust coupling diagnosis](thrust-coupling-repair.md) separates artificial
allocation-gap displacement from physical deformation and retains separate
passive fault branches. All 93 tests, the build and 4,494 event budgets pass.
The rejected prototype's 101.223 m fine-grid fault-depth jump at coupled A,
x=4,400 m falls to 1.996 m. Relative to the accepted baseline, shared fault-depth
RMS improves, but travel-time RMS changes from 0.823 to 0.840 ms and thickness
differences worsen. No uniform convergence or field accuracy is claimed. All
21 no-fault/extension runs are unchanged; holdout and development arrays remain
untouched. The report includes unchanged gates, coverage and both comparison baselines.


## Travel-time and thickness repair (2026-10-12)

The [travel-time and thickness repair](travel-thickness-repair.md) preserves
parcel displacement during compaction and moves only the hanging-wall portion
of cells cut by a thrust. On 1,277 shared intervals, fine-grid thickness RMS
changes from 4.265 to 3.877 m; on 144 profiles, travel-time RMS changes from
0.840 to 0.567 ms. All three coupled compression cases improve on both measures.
Quiet thrust B still worsens, and coarse thickness/fault-depth regressions
remain documented. The same 36 runs close all 4,494 budgets, with zero repair-added
sediment. Eligibility changes from 1,311 to 1,299, with all status transitions
retained. All 103 tests pass. Type checking and the build pass. Existing
physical gates and all 21 no-fault/extension ledgers and samples are unchanged.
No observational arrays or split files were read or changed; holdout untouched.


## Isolated thrust B repair (2026-10-13)

The [isolated thrust B repair](thrust-b-repair.md) weights placement cost by
occupied rock volume, resolving the equal-cost treatment of thin and full packets.
Its fine thickness RMS changes from 2.156 to 0.459 m and fine travel RMS from
0.198 to 0.131 ms on shared samples. Recovery against the earlier pre-cut version
is incomplete; coupled and isolated-A tradeoffs remain documented. The same 36 runs
close all 4,494 event budgets, with zero repair-added grains. All 21 no-fault/extension
runs reproduce the baseline. All 108 tests pass. Type checking and the build pass.
Eligibility rules, history, physical gates and tolerances are unchanged. No observational
arrays or split files were read or modified; holdout untouched.


## 2026-10-13 — constituent thrust flow and coupled comparison

The [constituent thrust-motion correction](coupled-travel-repair.md) integrates each material constituent across fault bends and uses exact quantized matching. 117 distinct tests are verified across the initial full run and the successful targeted rerun; all 36 conservation runs close. Shared 20–10 m travel RMS changes from 0.613 to 0.514 ms; 40–20 m changes from 1.371 to 1.554 ms. Coupled A’s original upstream accommodation defect is largely recovered, but local and coarse-grid regressions remain. The report retains every regression and eligibility change. Holdout untouched.


## 2026-10-14 — benchmark reproduction and coefficient calibration

The [calibration report](force2020-calibration.md) records the rerun of the
FORCE development comparison from the original downloads (all five checksums
match; importer counts and frozen split reproduced; 309.477 m/s MAE identical)
and a pre-registered refit of the velocity law's global coefficients with
leave-one-parent-well-out cross-validation. All four sets fit better in sample
and predict worse out of sample (best 324.4 m/s). Fold coefficients are unstable,
with the sand e-folding depth at its bound in most folds. No set is adopted.
Per-well offsets dominate and cluster by quadrant. 7 new calibration tests and
the 13 Python tests pass. Source coefficients, windows, screens and holdout unchanged.


## 2026-10-14 — burial-state context

The [context report](force2020-burial-context.md) records the attachment of
NPD group, formation and location to the comparison windows (4 Python tests)
and a pre-registered fit of one burial-state offset per unit using the unchanged
`rockVelocity` (6 JavaScript tests, including both offset signs against direct
calls and recovery of known offsets). Leave-one-well-out MAE: untuned 309.5,
quadrant 266.4, group 273.1, quadrant plus group 268.4 m/s; leave-one-quadrant-out
for the group model 279.0 m/s. Selection interval [−95.2, +4.5] m/s includes
zero; nothing recorded. Source, coefficients, windows and holdout unchanged.


## 2026-10-14 — exhumation

[Exhumation](exhumation.md) adds an optional uplift-and-erosion episode after
the tectonic phase (2–4 steps, 300–1500 m, tilted), drawn from a separate random
stream so that the default reproduces earlier seeds exactly. Rock lifted above
sea level is booked as erosion; budgets close in both settings; parcels retain
burial and loading maxima and are faster than fresh rock at the same depth.
Four new tests; type checking passes. A profile of one default section (33 s)
attributes the time to column bookkeeping, recorded as a separate item.


## 2026-10-14 — simulation speed

[Simulation speed](simulation-speed.md) halves the time of a default section
(30.2 to 13.7 s extension, 44.5 to 21.5 s compression, 43.8 to 17.7 s exhumed)
with bit-identical results: digests over grids, every column parcel, every ledger
residual, the window velocity and the step log are unchanged for all three.
Changes: exponent-only scale search and array-free per-parcel exact sums,
parcels built without `delete`, one fewer copy per compacted parcel, cached edge
costs and an allocation-free heap in both transport solvers, a Number fast path
for the conservative solver that falls back to BigInt beyond 2^51, and an inlined
porosity law. The compaction bisection is untouched. Type checking passes.
The full suite, run file by file: 222 tests pass across 28 files; the basin file
takes 44 min, fault geometry 5 min, thrust coupling 4 min, strata 2.5 min,
numerics 2 min, the rest seconds. A first bit-length rewrite failed three
exact-length and length-rounding edge cases at 1024 bits and above (Number
overflow); values near that size are now reduced by 1000 bits first, the
affected files pass, and the three digests were reconfirmed afterwards.
