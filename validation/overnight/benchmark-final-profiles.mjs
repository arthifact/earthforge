/** Final wave profiles; run before other CPU-heavy final verification jobs. */
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
const folder=resolve('../engine-candidates');
const variants=[{name:'final-preview-simd',type:'wasm',path:folder+'/final-preview-simd.wasm'},{name:'final-research-simd',type:'wasm',path:folder+'/final-research-simd.wasm'},{name:'final-native',type:'native',path:folder+'/final-native'}];
const run=spawnSync(process.execPath,['validation/overnight/benchmark-kernels.mjs'],{stdio:'inherit',env:{...process.env,EARTHFORGE_BENCHMARK_VARIANTS:JSON.stringify(variants),EARTHFORGE_BENCHMARK_PREFIX:'validation/overnight/final-profile-benchmark',EARTHFORGE_BENCHMARK_CASES:'layered-3d,faulted-3d'}});
process.exit(run.status??1);
