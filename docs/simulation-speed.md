# Simulation speed — 2026-10-14

**A default 20 m section now simulates in about half the time, with results
identical to the bit.** Three sections were digested before and after over
their grids, every column parcel, every ledger residual, the window velocity
and the step log; all three digests are unchanged.

| Section | Before, s | After, s |
| --- | ---: | ---: |
| Seed 765184, extension | 30.2 | 13.7 |
| Seed 20261014, compression | 44.5 | 21.5 |
| Seed 765184, extension, exhumed | 43.8 | 17.7 |

Node 26 on this machine. The browser uses the same code in web workers.

## What was slow

A profile attributed the time to bookkeeping around the continuous material
columns introduced by the thin-bed repair, not to the physics:

- every exact-length pass expanded each parcel's lengths into a fresh array
  and decomposed each value into a BigInt mantissa and exponent, including the
  scale search that only needs the exponent;
- `withLayerLengths` used `delete` on the new parcel, which turns the object
  into a slow dictionary for every later property access;
- the compaction loop copied each parcel twice;
- the thrust transport solver allocated a tuple per heap push, converted the
  same edge cost to a BigInt on every relaxation, and compared BigInt
  distances on every edge;
- the porosity law allocated a closure per call;
- the grain inventory allocated a temporary per parcel.

## What changed, and why the results cannot change

- **Exact lengths.** The scale exponent is read from the IEEE exponent field
  alone; the full decomposition uses two 32-bit reads and one BigInt
  conversion. Per-parcel sums iterate the stored lengths in the same order
  without expanding them. The bit length of a BigInt is found by comparing
  against cached powers of two instead of rendering a binary string. Every
  function returns the same mantissas, exponents, units, chunks and projections.
- **Parcels.** New parcels are built without `delete`. A compacted parcel that
  carried no expansion is reused instead of copied again; one that did is
  rebuilt exactly as `withLayerLengths(p, [height])` would, whose single chunk
  is the height itself.
- **Transport solver.** Costs and targets are read once per parcel and the
  BigInt of each quantized edge cost is cached. The heap keeps cells and
  distances in two arrays with the same ordering and tie-breaking. A Number
  path runs the identical algorithm on exact integers while every stored value
  stays within 2^51, so sums of three terms are exact; the first value beyond
  that bound raises an internal overflow and the BigInt solver reruns the same
  radius. The capacity fallback solver received the same cost cache and heap.
- **Porosity and inventory.** The same operations in the same order, written
  without the per-call allocation.

A cache of float decompositions keyed by value was tried and removed: it was
slower than recomputing.

## What remains

Half of an extension section is the compaction solve: a 36-step bisection per
parcel per step, each step evaluating two exponentials. That is the fixed
numerical procedure the conservation and convergence studies were run with,
so it was left alone; changing it is a numerical change that needs those
studies rerun. The rest is spread over exact slicing, raster projection and
garbage collection from parcel copies that protect against aliasing.

For batch generation the practical lever is parallelism: sections are
independent, and the page already simulates in a pool of workers.

## Verification

The three-section digest comparison above; type checking; the full suite of
222 tests across 28 files. A first version of the bit-length routine failed
three edge-case tests for values of 1024 bits and more, where converting to a
Number overflows; such values are now reduced by 1000 bits first. The digests
were reconfirmed after that fix.
