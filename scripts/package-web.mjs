import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

// Package an already checked static build. This command never deploys it.
const root = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({ options: { out: { type: 'string' }, version: { type: 'string' }, dist: { type: 'string' } } });
const version = values.version ?? JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
if (!values.out || !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?$/.test(version)) {
  throw new Error('Use --version 0.2.0-alpha.1 --out releases/web-alpha.1 after npm run build.');
}
const output = resolve(values.out);
if (existsSync(output)) throw new Error('Choose a new output folder; existing releases are never overwritten.');
const dist = resolve(values.dist ?? join(root, 'dist'));
const wasmNames = ['earthforge_core.wasm', 'earthforge_core_simd.wasm', 'earthforge_core_deterministic.wasm', 'earthforge_core_deterministic_simd.wasm'];
const appFiles = ['index.html', '3d.html', 'classic.html', 'benchmarks/curved-conditioning.json', 'benchmarks/curved-conditioning-verification.json', ...wasmNames.map(name => `rust/${name}`)];
for (const name of readdirSync(join(dist, 'assets')).sort()) {
  if (!/\.(?:js|css)$/.test(name)) throw new Error(`Review the new asset type before packaging: ${name}`);
  appFiles.push(`assets/${name}`);
}
for (const name of appFiles) {
  if (!lstatSync(join(dist, name)).isFile()) throw new Error(`Expected a regular build file: ${name}`);
}
// Do not create output inside the build, source or dependency cache.
for (const directory of [dist, ...['dist', 'src', 'crates', 'python', 'node_modules', 'public'].map(name => join(root, name))]) {
  const path = relative(directory, output);
  if (path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))) {
    throw new Error('Place release output outside source, dist, public and dependency directories.');
  }
}
const metadata = spawnSync('cargo', ['metadata', '--locked', '--offline', '--format-version', '1'], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
if (metadata.error || metadata.status !== 0) throw new Error('Cargo metadata failed; build the locked Rust dependencies first.');
const packages = JSON.parse(metadata.stdout).packages.filter(p => p.name !== 'earthforge-core');
const entries = appFiles.map(name => ({ path: name, source: join(dist, name) }));
entries.push({ path: 'notices/V8.txt', source: join(root, 'crates/earthforge-core/licenses/V8.txt') });
const dependencies = [];
for (const p of packages.sort((a, b) => a.name.localeCompare(b.name))) {
  const folder = dirname(p.manifest_path);
  const names = readdirSync(folder).filter(name => /^(?:LICENSE|LICENCE|COPYING|NOTICE|COPYRIGHT)/i.test(name) && lstatSync(join(folder, name)).isFile()).sort();
  for (const name of names) entries.push({ path: `notices/${p.name}-${p.version}/${name}`, source: join(folder, name) });
  dependencies.push({ name: p.name, version: p.version, license: p.license, noticeFiles: names });
}
// Retain build-tool notices too, including Vite's injected runtime polyfill.
for (const [name, notice] of [['vite', 'LICENSE.md'], ['esbuild', 'LICENSE.md'], ['typescript', 'LICENSE.txt']]) {
  const folder = join(root, 'node_modules', name);
  const p = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8'));
  entries.push({ path: `notices/${name}-${p.version}/${notice}`, source: join(folder, notice) });
  dependencies.push({ name, version: p.version, license: p.license, noticeFiles: [notice], role: 'web-build-tool' });
}
const license = ['LICENSE', 'LICENSE.txt', 'LICENSE.md'].find(name => existsSync(join(root, name)));
const projectLicense = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).license ?? null;
if (projectLicense && !license) throw new Error('The declared project license is missing from the source root.');
if (license) entries.push({ path: license, source: join(root, license) });
// Read all inputs before creating an output, so a missing notice leaves no partial package.
for (const entry of entries) entry.bytes = readFileSync(entry.source);
mkdirSync(output, { recursive: true });
for (const entry of entries) {
  const destination = join(output, entry.path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, entry.bytes);
}
writeFileSync(join(output, 'notices/dependencies.json'), `${JSON.stringify(dependencies, null, 2)}\n`);
writeFileSync(join(output, '.nojekyll'), '');
writeFileSync(join(output, 'README.txt'), `Earth Forge ${version}\n\nServe this folder as static files over HTTPS. index.html opens a 2D section of the shared 3D basin; 3d.html opens the same workspace in 3D. classic.html retains the historical 2D reference. The browser runs the simulation locally using WebAssembly.\n\nThis alpha uses prescribed geological history and is not independently field validated.\n\nProject license: ${license ? `${projectLicense ?? 'see license text'}, included in ${license}` : 'awaiting owner selection; this preview does not assign a license'}. Third-party notices are in notices/.\n`);
const files = {};
function hashFolder(folder) {
  for (const name of readdirSync(folder).sort()) {
    const path = join(folder, name);
    if (lstatSync(path).isDirectory()) hashFolder(path);
    else {
      const bytes = readFileSync(path);
      files[relative(output, path).split(sep).join('/')] = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    }
  }
}
hashFolder(output);
const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
writeFileSync(join(output, 'release-manifest.json'), `${JSON.stringify({ schema: 'earthforge-web-release-v1', version, sourceCommit: git.status === 0 ? git.stdout.trim() : null, projectLicense: license ? projectLicense : null, projectLicenseIncluded: Boolean(license), deploymentPerformed: false, files }, null, 2)}\n`);
console.log(`Packaged ${appFiles.length} app files plus notices in ${output}`);
if (!license) console.log('Project license is pending; this is a local preview artifact.');
