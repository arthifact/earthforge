import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const root = fileURLToPath(new URL('..', import.meta.url));
const bundle = await build({ stdin: { contents: 'export * from "./src/basin"; export * from "./src/strata"; export * from "./src/sedimentBudget";', resolveDir: root }, bundle: true, platform: 'node', format: 'esm', write: false });
const api = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].contents).toString('base64'));
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
// A thin rectangle starts wholly above the lower flat. Fault-parallel flow
// preserves its positive normal distance, including through both bends.
// The hanging-wall region is nonconvex at the ramp-to-upper-flat bend: its
// material centroid need not lie inside that region. A translated rectangle
// around that centroid must not be used to infer a new material side.
for (const h of [40, 20, 10]) test(`material remains mobile on the same thrust across its upper bend at ${h} m`, () => {
  const nx = 2400 / h + 1, nz = 1200 / h, i = 280 / h;
  const P = [[-3000,700],[-1600,700],[-1400,500],[400,500]];
  const depth = x => x <= -1600 ? 700 : x >= -1400 ? 500 : 700 - (x + 1600);
  const columns = Array.from({ length: nx }, (_,j) => {
    const d = depth(-2000 + j*h); return [api.emptyLayer(-1,d),api.emptyLayer(-2,1200-d)];
  });
  const bed = {...api.emptyLayer(0,2),solid:1,fraction:.37,burial:80,loading:60};
  columns[i] = [api.emptyLayer(-1,698),bed,api.emptyLayer(-2,500)];
  const state = {...api.rasterize(columns,nz,h),columns,nx,nz,h,beds:[{carbonate:false}]};
  const first = api.remapThrust(state,P,120+200*Math.SQRT2,[0,0,0],true);
  const firstColumns = api.columnsFromRaster(first,nx,nz,h);
  const afterFirst = {...state,...first,columns:firstColumns};
  assert.ok(api.assessBudget(api.inventoryOf(state),api.inventoryOf(afterFirst),first.flux).closed);
  const before = structuredClone(afterFirst);
  const second = api.remapThrust(afterFirst,P,h,first.carry,true);
  const carried = second.transfers.filter(t=>t.source.bed===0 && !t.incoming);
  near(carried.reduce((s,t)=>s+t.source.solid,0),1);
  assert.deepEqual(afterFirst,before);
  for (const t of carried) for (const key of ['solid','fraction','burial','loading']) assert.equal(t.moved[key],t.source[key]);
  const result = {...afterFirst,...second,columns:api.columnsFromRaster(second,nx,nz,h)};
  assert.ok(api.assessBudget(api.inventoryOf(afterFirst),api.inventoryOf(result),second.flux).closed);
  const inventory = api.inventoryOf(result);
  near(inventory.total,h);
  // After another full width of slip the true source lies wholly on the
  // upper flat. Independent straight-segment geometry gives these means.
  let area = 0, momentX = 0, momentZ = 0;
  result.columns.forEach((column,j) => {
    let top = 0;
    for (const p of column) {
      if (p.bed === 0) {
        area += p.height;
        momentX += p.height * (-2000+j*h+p.offsetX);
        momentZ += p.height * (top+p.offsetZ+p.height/2);
      }
      top += p.height;
    }
  });
  near(area,2);
  near(momentX/area,-1400+h);
  near(momentZ/area,499);
});
