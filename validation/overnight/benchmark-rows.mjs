/** Reuse the frozen-shot harness with independently stored row-slice engines. */
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
const directory=process.env.EARTHFORGE_CANDIDATES??resolve('../engine-candidates');
const variants=[['reduction-native','native'],['row-native','native'],['reduction-scalar','wasm'],['row-scalar','wasm'],['row-simd','wasm']].map(([name,type])=>({name,type,path:directory+'/'+name+(type==='wasm'?'.wasm':'')}));
const run=spawnSync(process.execPath,['validation/overnight/benchmark-kernels.mjs'],{stdio:'inherit',env:{...process.env,EARTHFORGE_BENCHMARK_VARIANTS:JSON.stringify(variants),EARTHFORGE_BENCHMARK_PREFIX:'validation/overnight/row-benchmark'}});
process.exit(run.status??1);
