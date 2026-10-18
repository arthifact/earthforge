import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('geometry_run',Path(__file__).with_name('run.py'))
run=importlib.util.module_from_spec(spec);spec.loader.exec_module(run)


class ProtocolTests(unittest.TestCase):
    def test_whole_parent_and_block_memberships_never_leak(self):
        rows=[{'parent':'a','block':'1','well':'a1'}, {'parent':'a','block':'1','well':'a2'}, {'parent':'b','block':'1','well':'b'}, {'parent':'c','block':'2','well':'c'}]
        for design in ['parent','block']:
            for _,train,test in run.folds(rows,design):
                self.assertFalse({r['parent'] for r in train}&{r['parent'] for r in test})
                if design=='block':self.assertFalse({r['block'] for r in train}&{r['block'] for r in test})

    def test_failure_coverage_and_penalty_are_visible(self):
        score=run.score([{'parent':'a','error':10.},{'parent':'a','error':None},{'parent':'b','error':-20.}])
        self.assertEqual(score['missing'],1);self.assertEqual(score['maeM'],15.)
        self.assertEqual(score['penalizedMaeM'],2512.5)

    def test_paired_bootstrap_preserves_known_difference(self):
        rows=[]
        for p in ['a','b','c']:
            for method,loss in [('constant',20.),('plane',10.),('adaptive',12.)]:rows.append({'design':'parent','method':method,'parent':p,'error':loss})
        plan={'evaluation':{'bootstrap':{'seed':1,'repeats':100,'percentiles':[2.5,97.5]},'missing_prediction_penalty_m':10000}}
        got=run.bootstrap(rows,plan)['estimates']['parent/adaptive-minus-plane']
        self.assertEqual(got,{'differenceM':2.,'intervalM':[2.,2.]})

    def test_process_guard_rejects_log_arrays_and_archive_before_open(self):
        script=f"import importlib.util; s=importlib.util.spec_from_file_location('r',{str(Path(__file__).with_name('run.py'))!r}); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); m.install_access_guard(); "
        for name in ['reserved.npz','unknown.las','LAS_files_Force_2020_all_wells_train_test_blind_hidden_final.zip']:
            result=subprocess.run([sys.executable,'-c',script+f"open({name!r},'rb')"],capture_output=True,text=True)
            self.assertNotEqual(result.returncode,0);self.assertIn('PermissionError',result.stderr)

    def test_process_guard_rejects_symlink_disguised_as_metadata(self):
        with tempfile.TemporaryDirectory() as t:
            target=Path(t)/'reserved.npz';target.write_bytes(b'not actual field data')
            alias=Path(t)/'metadata.xlsx'
            try:alias.symlink_to(target)
            except OSError:self.skipTest('Symlink creation unavailable')
            script=f"import importlib.util; s=importlib.util.spec_from_file_location('r',{str(Path(__file__).with_name('run.py'))!r}); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); m.install_access_guard(); open({str(alias)!r},'rb')"
            result=subprocess.run([sys.executable,'-c',script],capture_output=True,text=True)
            self.assertNotEqual(result.returncode,0);self.assertIn('PermissionError',result.stderr)

    def test_changed_input_is_rejected_before_workbook_contents_are_used(self):
        with tempfile.TemporaryDirectory() as t:
            p=Path(t)/'fake.xlsx';p.write_bytes(b'not the frozen source')
            plan=json.loads(Path(__file__).with_name('plan.json').read_text())
            with self.assertRaisesRegex(ValueError,'frozen FORCE intake'):run.intake(p,Path(t)/'not-read.csv',plan)

    def test_midrun_input_or_method_edit_is_detected(self):
        with tempfile.TemporaryDirectory() as t:
            p=Path(t)/'method.py';p.write_text('first');frozen={p:run.sha(p)}
            run.assert_unchanged(frozen);p.write_text('edited')
            with self.assertRaisesRegex(ValueError,'changed during geometry study'):run.assert_unchanged(frozen)


if __name__=='__main__':unittest.main()
