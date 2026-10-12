# Earth Forge

Realistic subsurface velocity models for any place, built from geological
history. Earth Forge simulates how the ground formed, step by step through
time. Velocity comes from rock physics applied to that history, and every
model is checked against published values and against tests with exact
answers.

The aim is a generator anyone can set up for where they are:

- **A geologist** says "this kind of basin, this history, these facts".
- **A seismologist or tomographer** may know no geology at all, only a few
  surface shots.

Either way, unknowns are answered "don't know", and the data you have narrow
the range. For example, models whose simulated first arrivals don't match
your picks are dropped. What comes out is many realistic velocity models,
with lithology and labelled horizons and faults. They also say which kinds
of geology fit your data.

The models serve as a prior for full-waveform inversion (FWI): they help
tell real geology from noise, and the data can always overrule them. They
also serve as training data and as test models.

## Status (2026-10-11)

A browser page with a gallery of seeds, a step-by-step history replay and a
verification panel. The first family of geology is sedimentary basins, in two
tectonic settings, drawn per seed or chosen:

- **Extension:** listric normal growth faults. Basinward faults are younger,
  and each fault's slip rate rises and falls (Thorsen 1963). Hanging walls
  move by vertical shear (Verrall 1981). After rifting, thermal subsidence
  decays with a 62.8 Myr time constant (McKenzie 1978).
- **Compression:** thrusts ramp up from a basal detachment to an upper flat
  or to the sea floor. They form one at a time toward the foreland, with
  older thrusts carried on younger ones. Hanging walls move by fault-parallel
  flow, which makes fault-bend folds (Suppe 1983). The foreland basin deepens
  toward the thrusts.

Both settings share:

- erosion above wave base;
- deposition down to a base level, which makes growth strata;
- lateral facies changes;
- mechanical compaction: beds thin with burial, keep their solid grains, and
  flatten the faults (Sclater and Christie 1980; Xiao and Suppe 1989);
- velocity at each rock's deepest burial, since porosity is not regained on
  uplift (Japsen);
- the soft-sand rock-physics model (Dvorkin and Nur 1996), cementing into
  Raymer-Hunt-Gardner;
- optional overpressure and carbonates.

[docs/verification-log.md](docs/verification-log.md) records every version.
Each one's rules and expected results were written before it ran, followed
by what the checks showed. It includes the failures and the bugs they found.

## Run

```sh
npm install
npm run dev      # http://localhost:5174
npm run check    # type check
```

The page is a single full-screen tool:
- The section fills the window, with distance and depth in km. *Fit* uses a
  vertical exaggeration, shown as VE; *True scale* is 1:1.
- A velocity log sits on the same depth axis, and a readout under the pointer
  gives distance, depth, velocity and lithology.
- A slider replays the history.
- A slim side panel holds the settings and the section's facts.
- How to use, Gallery, Checks and About open as dialogs.
- Keys: R draws a new seed, G opens the gallery, ← → step through the
  history, and Space replays it.

Sections are simulated in a pool of web workers, in parallel and off the
page's thread; a new seed shows in about 0.1 s. The address keeps the seed and
the settings, so a view can be shared.

In **Checks**, *Run* simulates 20-100 sections and compares them
with the literature:

- velocity with depth (Hamilton 1979, 1985);
- growth-fault expansion index;
- fault dips;
- slip, sedimentation and subsidence rates.

It also runs the known-answer tests:

- normal-fault heave;
- thrust kinematics against the same flow applied at once;
- backlimb dip against ramp dip;
- compaction against the decompaction equation;
- rock area conserved by every slip.

Optional comparison: put Marmousi as a 461 x 151 float32 grid (20 m, rows of
depth) at `public/reference/marmousi_truth20.f32`. Reference models are not
redistributed here.

## Roadmap

1. History as a timeline of stages (stretch, salt, sag, squeeze, and so on).
   Today's two settings become presets, and mixed histories such as basin
   inversion come for free.
2. More geology:
   - salt (bodies placed by shape, with sediments draped around them, and
     minibasins);
   - volcanic rock (sills, basalt flows);
   - carbonate platforms;
   - channels and slumps;
   - shallow gas;
   - for land anywhere: a near-surface layer (weathered rock, soil, glacial
     deposits) and crystalline basement with real structure.
3. A scenario panel: presets by geology type, easy facts with "don't know",
   and export of model ensembles.
4. Conditioning on data:
   - first-arrival traveltimes from surface shots, which also give the odds
     of each kind of geology;
   - well logs (velocity, formation tops);
   - interpreted horizons;
   - an existing tomography model.
5. A coverage test for each preset: can it reproduce public models and real
   logs (Marmousi, SEG/EAGE Overthrust and Salt, BP 2004, FORCE 2020 wells)?

Related work: Noddy and the Noddyverse (Jessell et al. 2022) generate
geological models from event histories, mostly hard-rock models with gravity
and magnetics. Earth Forge targets process physics and seismic velocity for
FWI.

## Origin

This started inside Seismic Glade, a WebGPU FWI sandbox. The 9.2 x 3 km
window and the 1500-5600 m/s range come from its 2D FWI lab.
