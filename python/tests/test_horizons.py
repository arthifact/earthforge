import os
from pathlib import Path
import unittest
import numpy as np
from earthforge import Contact, Engine, fit_horizon_stack, predict_contacts, select_horizon_stack
from earthforge.horizons import fit_field, inside_hull

NAMES=['cover','young','old']
BOUNDS={'min':dict(x=0.,y=0.,z=0.),'max':dict(x=1000.,y=1000.,z=4000.)}

def contacts():
    rows=[]
    for i,(x,y) in enumerate([(0.,0.),(1000.,0.),(0.,1000.),(1000.,1000.)]):
        for j,name in enumerate(NAMES):rows.append(Contact(f'w{i}',f'p{i}',name,x,y,100+500*j+.1*x+.2*y))
    return rows


class HorizonTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.engine=Engine(os.environ.get('EARTHFORGE_ENGINE'))

    def test_known_independent_planes_reach_actual_rust_contacts(self):
        history,audit=fit_horizon_stack(contacts(),NAMES,BOUNDS)
        targets=[Contact('test','test',n,400.,300.,0.) for n in NAMES]
        result=predict_contacts(self.engine,history,targets,NAMES)
        np.testing.assert_allclose([r['prediction'] for r in result],[200.,700.,1200.],atol=1e-9,rtol=0)
        self.assertTrue(all(r['status']=='predicted' for r in result))
        self.assertTrue(all(not e['compact'] for e in history.model['events']))

    def test_fitting_does_not_use_validation_depths(self):
        train=contacts(); h,_=fit_horizon_stack(train,NAMES,BOUNDS)
        a=predict_contacts(self.engine,h,[Contact('test','test','old',400.,300.,1.)],NAMES)
        b=predict_contacts(self.engine,h,[Contact('test','test','old',400.,300.,3999.)],NAMES)
        self.assertEqual(a,b)

    def test_parent_balanced_weights_ignore_duplicate_sidetrack_influence(self):
        rows=[Contact('a','p','h',0.,0.,100.),Contact('b','q','h',0.,0.,200.)]
        first,_=fit_field(rows,'constant')
        second,_=fit_field(rows+[Contact('a2','p','h',0.,0.,100.)],'constant')
        self.assertEqual(first,second);self.assertEqual(first['value'],150.)

    def test_rank_failure_is_explicit_constant_fallback(self):
        rows=[Contact(str(i),str(i),'h',float(i),0.,100.+i) for i in range(4)]
        _,audit=fit_field(rows,'plane');self.assertTrue(audit['rankDeficientPlaneFallback'])

    def test_inverted_stack_is_missing_not_nearest_target_occurrence(self):
        rows=[Contact('a','a','young',0.,0.,900.),Contact('a','a','old',0.,0.,500.)]
        h,_=fit_horizon_stack(rows,['young','old'],BOUNDS,method='constant')
        r=predict_contacts(self.engine,h,[Contact('test','test','young',100.,100.,550.)],['young','old'])
        self.assertIsNone(r[0]['prediction']);self.assertEqual(r[0]['occurrences'],0)

    def test_ambiguous_invalid_outside_contacts_are_rejected(self):
        for rows in [contacts()+[contacts()[0]],[Contact('a','a','bad',0.,0.,100.)],[Contact('a','a','young',1001.,0.,100.)]]:
            with self.assertRaises(ValueError):fit_horizon_stack(rows,NAMES,BOUNDS)
        with self.assertRaises(ValueError):Contact('a','a','h',np.nan,0.,100.)

    def test_hull_boundary_and_degenerate_geometry(self):
        xy=[(0.,0.),(1.,0.),(0.,1.),(1.,1.)]
        self.assertTrue(inside_hull((0.,.5),xy));self.assertTrue(inside_hull((.5,.5),xy))
        self.assertFalse(inside_hull((1.01,.5),xy));self.assertFalse(inside_hull((.5,0.),[(0.,0.),(1.,0.),(2.,0.)]))

    def test_smooth_fit_exports_existing_waves_to_actual_rust(self):
        rows=[]
        for i,(x,y) in enumerate((x,y) for x in np.linspace(0,1000,5) for y in np.linspace(0,1000,5)):
            for j,n in enumerate(NAMES):
                z=100+500*j+.1*x+.2*y+20*np.cos(np.pi*(x-500)/1000)
                rows.append(Contact(str(i),str(i),n,float(x),float(y),float(z)))
        h,_=fit_horizon_stack(rows,NAMES,BOUNDS,method='smooth',smoothing=1e-10)
        test=[Contact('t','t',n,250.,750.,0.) for n in NAMES]
        result=predict_contacts(self.engine,h,test,NAMES)
        np.testing.assert_allclose([r['prediction'] for r in result],[100+500*j+25+150+20/np.sqrt(2) for j in range(3)],atol=.001,rtol=0)
        self.assertEqual(len(h.model['events'][0]['fillTo']['waves']),8)

    def test_nested_groups_keep_sidetracks_together_and_have_no_target_access(self):
        rows=contacts()+[Contact('sidetrack','p0',n,20.,20.,100+500*j+6.) for j,n in enumerate(NAMES)]
        # Two parents per geographic group; min=2 only for this tiny unit case.
        groups={'p0':'a','p1':'a','p2':'b','p3':'b'}
        h,audit=select_horizon_stack(self.engine,rows,NAMES,BOUNDS,groups=groups,candidates=[{'method':'plane'}],min_training_parents=2)
        for fold in audit['selection']['folds']:
            self.assertFalse(set(fold['trainingParents'])&set(fold['testParents']))
            if 'p0' in fold['testParents']:self.assertNotIn('p0',fold['trainingParents'])
        a=predict_contacts(self.engine,h,[Contact('test','test','old',400.,300.,1.)],NAMES)
        b=predict_contacts(self.engine,h,[Contact('test','test','old',400.,300.,3999.)],NAMES)
        self.assertEqual(a,b)

    def test_nested_no_eligible_folds_is_reported(self):
        _,a=select_horizon_stack(self.engine,contacts(),NAMES,BOUNDS,groups={f'p{i}':'same' for i in range(4)})
        self.assertTrue(a['selection']['noEligibleInnerFoldsFallback'])
        self.assertEqual(a['selection']['selected'],{'method':'plane'})


if __name__=='__main__':unittest.main()
