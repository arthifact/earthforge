// A simulation worker: runs the simulator off the page's thread, either one section (with its history if asked) or
// the checks, and sends back only the window's arrays (transferred, not copied).

import { BASEMENT, faultLines, simulate, WATER, windowOf, type Basin, type MaterialState, type Fault } from "./basin";
import { verify } from "./basinVerify";
import type { Frame, Reply, Request, Section } from "./protocol";


const post = (reply: Reply, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(reply, transfer);

function frameOf(b: Basin, state: MaterialState, faults: Pick<Fault, "x" | "z" | "trace">[]): Frame {
  const w = windowOf(b, state), litho = new Float32Array(w.nx * w.nz);
  for (let k = 0; k < w.nz; k++) for (let i = 0; i < w.nx; i++) {
    const n = k * w.nx + i, c = w.beds[n];
    litho[n] = c === WATER ? -1 : c === BASEMENT ? -2 : b.beds[c].carbonate ? -3 : w.sandFraction[n];
  }
  return { nx: w.nx, nz: w.nz, velocity: w.velocity, beds: w.beds, litho, faults: faults.flatMap(faultLines) };
}
const buffers = (f: Frame) => [f.velocity.buffer, f.beds.buffer, f.litho.buffer];

self.onmessage = async (event: MessageEvent<Request>) => {
  const r = event.data;
  try {
    if (r.kind === "section") {
      const b = simulate({ ...r.options, record: r.history });
      const section: Section = {
        seed: r.options.seed, setting: b.setting, options: r.options,
        unitOfBed: Int32Array.from(b.beds.map((bed) => bed.unit)),
        faults: b.faults.map((f) => ({ kind: f.kind, dir: f.dir, dip: f.dip, heave: f.heave, emergent: !!f.thrust?.emergent, transport: f.thrust?.transport ?? 1 })),
        log: b.log.map((l) => ({ phase: l.phase, text: l.text })),
        overpressure: b.overpressure, basementVelocity: b.basementVelocity, dt: b.dt,
        exhumation: b.historyPlan.exhumation,
        budget: b.budget.summary,
        checks: { trapped: b.checks.trapped, collapsed: b.checks.collapsed, area: b.checks.area, seconds: b.checks.seconds },
        now: frameOf(b, b, b.faults), history: [],
      };
      if (!r.history) { post({ id: r.id, kind: "section", section }, [...buffers(section.now), section.unitOfBed.buffer]); return; }
      post({ id: r.id, kind: "preview", section }, [...buffers(section.now), section.unitOfBed.buffer]);
      const frames = b.snapshots.map((s) => frameOf(b, s, s.faults));
      post({ id: r.id, kind: "history", frames }, frames.flatMap(buffers));
    } else {
      const result = await verify(r.options, r.first, r.count, (text) => post({ id: r.id, kind: "progress", text }));
      post({ id: r.id, kind: "verify", result });
    }
  } catch (e) {
    post({ id: r.id, kind: "error", message: (e as Error).message });
  }
};
