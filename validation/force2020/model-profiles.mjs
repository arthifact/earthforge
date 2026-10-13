// Evaluate the actual simulator function; do not duplicate its physics in Python.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const planPath = new URL('./benchmark-plan.json', import.meta.url);
const planText = await readFile(planPath, 'utf8');
const plan = JSON.parse(planText);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const bundle = await build({
  stdin: { contents: 'export {rockVelocity, effectiveDepth} from "./src/basin.ts";', resolveDir: root },
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const { rockVelocity, effectiveDepth } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
const profiles = {};
for (const scenario of plan.scenarios) {
  profiles[scenario] = {};
  for (const [code, facies] of Object.entries(plan.facies)) {
    let fraction = facies.sand_fraction;
    if (scenario === 'less_pure_facies') fraction = fraction === 0 ? 0.2 : 0.8;
    const burial = scenario === 'maximum_burial_plus_500m' ? 500 : scenario === 'maximum_burial_plus_1000m' ? 1000 : 0;
    const pressure = scenario === 'overpressure_below_1500m' ? 1500 : null;
    profiles[scenario][code] = Array.from({length: plan.depth_max_m / plan.bin_width_m}, (_, bin) => {
      let slowness = 0;
      // One-metre midpoint quadrature of slowness over a 20 m vertical cell.
      for (let m = 0; m < plan.bin_width_m; m++) {
        const depth = bin * plan.bin_width_m + m + 0.5;
        // Uplift scenarios retain past compaction/cementation while current stress
        // remains at observed depth. Passing depth + burial as present depth is incorrect.
        const history = { maxBurial: depth + burial, maxEffectiveDepth: effectiveDepth(depth + burial, pressure) };
        slowness += 1 / rockVelocity(fraction, depth, false, pressure, history);
      }
      return plan.bin_width_m / slowness;
    });
  }
}
const output = {
  plan_sha256: hash(planText),
  simulator_source_sha256: hash(await readFile(resolve(root, 'src/basin.ts'))),
  model_revision: 'material-state-v2',
  history_semantics: 'present depth for stress; maximum effective depth for porosity; maximum geometric burial for cementation proxy',
  exporter_sha256: hash(await readFile(fileURLToPath(import.meta.url))),
  units: 'm/s', depth_bin_width_m: plan.bin_width_m, profiles,
};
const destination = process.argv[2] || resolve(root, 'data/force2020/model-profiles.json');
await writeFile(destination, JSON.stringify(output, null, 2) + '\n');
console.log(`Wrote ${plan.scenarios.length} fixed scenarios using rockVelocity with explicit present-depth and burial-history states to ${destination}`);
