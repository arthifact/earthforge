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
   **0 of 140 over 40 m (worst 20, mean 6.0) on a 10 m grid.** The error
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
