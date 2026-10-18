import { spawnSync } from 'node:child_process';
import { mkdirSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
const native = process.argv.includes('--native');
const targetRoot = resolve(process.env.CARGO_TARGET_DIR ?? 'target');
const args = ['build', '--locked', '--release', '-p', 'earthforge-core', ...(native ? [] : ['--target', 'wasm32-unknown-unknown', '--lib'])];
function build(env = process.env, features = []) {
 const result = spawnSync('cargo', [...args, ...features], { stdio: 'inherit', env });
 if (result.error) throw result.error;
 if (result.status !== 0) process.exit(result.status ?? 1);
}
build();
if (!native) {
 mkdirSync('public/rust', {recursive:true});
 copyFileSync(resolve(targetRoot, 'wasm32-unknown-unknown/release/earthforge_core.wasm'), 'public/rust/earthforge_core.wasm');
 const simdRoot = resolve(targetRoot, 'simd');
 const simdFlags = `${process.env.RUSTFLAGS ?? ''} -C target-feature=+simd128`.trim();
 build({...process.env, CARGO_TARGET_DIR:simdRoot, RUSTFLAGS:simdFlags});
 copyFileSync(resolve(simdRoot, 'wasm32-unknown-unknown/release/earthforge_core.wasm'), 'public/rust/earthforge_core_simd.wasm');
 const deterministicRoot = resolve(targetRoot, 'deterministic');
 build({...process.env, CARGO_TARGET_DIR:deterministicRoot}, ['--features', 'deterministic-math']);
 copyFileSync(resolve(deterministicRoot, 'wasm32-unknown-unknown/release/earthforge_core.wasm'), 'public/rust/earthforge_core_deterministic.wasm');
 const deterministicSimdRoot = resolve(deterministicRoot, 'simd');
 build({...process.env, CARGO_TARGET_DIR:deterministicSimdRoot, RUSTFLAGS:simdFlags}, ['--features', 'deterministic-math']);
 copyFileSync(resolve(deterministicSimdRoot, 'wasm32-unknown-unknown/release/earthforge_core.wasm'), 'public/rust/earthforge_core_deterministic_simd.wasm');
}
