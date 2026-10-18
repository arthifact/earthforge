//! Optional Eulerian inventory quadrature. This estimates material inside the
//! visible open window; it is explicitly separate from exact local ray budgets.
use super::model::HistoryModel;
use serde::Serialize;
use std::collections::BTreeMap;
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Inventory {
    pub sediment_bulk: f64,
    pub grain: f64,
    pub sand: f64,
    pub shale: f64,
    pub carbonate: f64,
    pub by_bed: BTreeMap<i32, f64>,
}
impl Inventory {
    fn add(&mut self, p: &Self) {
        self.sediment_bulk += p.sediment_bulk;
        self.grain += p.grain;
        self.sand += p.sand;
        self.shale += p.shale;
        self.carbonate += p.carbonate;
        for (id, v) in &p.by_bed {
            *self.by_bed.entry(*id).or_default() += v;
        }
    }
}
pub fn inventory(
    model: &HistoryModel,
    stage: usize,
    nx: usize,
    ny: usize,
) -> Result<Inventory, String> {
    if nx == 0 || ny == 0 || nx > 256 || ny > 256 {
        return Err("Invalid 3D inventory quadrature size".into());
    }
    let n = *model
        .spec
        .stages
        .get(stage)
        .ok_or("Invalid 3D inventory stage")?;
    let b = model.spec.bounds;
    let dx = (b.max.x - b.min.x) / nx as f64;
    let dy = (b.max.y - b.min.y) / ny as f64;
    let area = dx * dy;
    let rows = (0..ny).collect::<Vec<_>>();
    let run = |y: &usize| -> Result<Inventory, String> {
        let mut e = model.evaluator();
        let mut out = Inventory::default();
        for x in 0..nx {
            let profile = e.evaluate(
                n,
                b.min.x + (x as f64 + 0.5) * dx,
                b.min.y + (*y as f64 + 0.5) * dy,
            )?;
            for p in profile.cut(b.min.z, b.max.z)?.iter().filter(|p| p.bed >= 0) {
                let grain = p.solid * area;
                out.sediment_bulk += p.height * area;
                out.grain += grain;
                *out.by_bed.entry(p.bed).or_default() += grain;
                if model.spec.beds[p.bed as usize].carbonate {
                    out.carbonate += grain;
                } else {
                    out.sand += grain * p.fraction;
                    out.shale += grain * (1.0 - p.fraction);
                }
            }
        }
        Ok(out)
    };
    #[cfg(not(target_arch = "wasm32"))]
    let values = {
        use rayon::prelude::*;
        rows.par_iter().map(run).collect::<Result<Vec<_>, _>>()?
    };
    #[cfg(target_arch = "wasm32")]
    let values = rows.iter().map(run).collect::<Result<Vec<_>, _>>()?;
    let mut out = Inventory::default();
    for p in values {
        out.add(&p);
    }
    Ok(out)
}
