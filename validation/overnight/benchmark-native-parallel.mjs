import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
const directory=process.env.EARTHFORGE_CANDIDATES??resolve('../engine-candidates');
while(!existsSync('/Users/torus/Documents/Codex/2026-10-17/wah/outputs/earthforge-original-row-acoustic-parity.json'))await new Promise(resolve=>setTimeout(resolve,1000));
const variants=[{name:'row-native',type:'native',path:directory+'/row-native'},...[1,2,4,8].map(n=>({name:`parallel-native-${n}`,type:'native',path:directory+'/parallel-native',env:{RAYON_NUM_THREADS:String(n)}})),{name:'parallel-native-default',type:'native',path:directory+'/parallel-native'}];
const run=spawnSync(process.execPath,['validation/overnight/benchmark-kernels.mjs'],{stdio:'inherit',env:{...process.env,EARTHFORGE_BENCHMARK_VARIANTS:JSON.stringify(variants),EARTHFORGE_BENCHMARK_PREFIX:'validation/overnight/parallel-benchmark',EARTHFORGE_BENCHMARK_CASES:'layered-3d,faulted-3d'}});
process.exit(run.status??1);
