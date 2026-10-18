import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const run=spawnSync('cargo',['test','--locked','--release','acoustic::tests','--','--nocapture','--test-threads=1'],{encoding:'utf8',maxBuffer:10*1024*1024});
const log=run.stdout+'\n'+run.stderr;
writeFileSync('validation/overnight/acoustic-checks.log',log);
process.stdout.write(log);assert.equal(run.status,0,'Acoustic analytical checks must pass');
const extract=expression=>{const match=log.match(expression);assert.ok(match,`Missing test metric ${expression}`);return Number(match[1]);};
const errors=JSON.parse(log.match(/Manufactured plane-wave RMS errors h=20,10,5m: (\[[^\n]+\])/)[1]);
const arrivals=[...log.matchAll(/3D arrival distance (\S+)m: measured (\S+)s, analytic (\S+)s/g)].map(m=>({distanceM:Number(m[1]),measuredSeconds:Number(m[2]),analyticSeconds:Number(m[3])}));
assert.equal(arrivals.length,2);
const report={command:'cargo test --locked --release acoustic::tests -- --nocapture --test-threads=1',testsPassed:extract(/test result: ok\. (\d+) passed;/),sourceSha256:createHash('sha256').update(readFileSync('crates/earthforge-core/src/acoustic.rs')).digest('hex'),
 planeWave:{spacingM:[20,10,5],rmsError:errors,refinementRatios:[errors[0]/errors[1],errors[1]/errors[2]],timeStepScaling:'dt proportional to h², expected combined fourth-order convergence',crosslineReduction:'2D and uniform-y 3D arrays bit-identical with periodic transverse boundaries'},
 normalIncidenceReflection:{measured:extract(/reflection: measured (\S+),/),analytic:0.2,medium:'constant density, 2000 to 3000 m/s'},
 threeDimensionalArrivals:arrivals,reciprocityRelativeMaxError:extract(/Reciprocity relative max error: (\S+)/),
 spongeLateErrorRmsRatioVsReflectingBoundary:extract(/Late boundary-error RMS ratio sponge\/wall: (\S+)/),
 scope:'Independent analytic and larger-domain synthetic tests of the stated constant-density acoustic PDE. No observational data, field-amplitude calibration, elastic/anisotropic propagation, or claim of equivalence to another research solver.'};
writeFileSync('validation/overnight/acoustic-analytic-validation.json',JSON.stringify(report,null,2)+'\n');
