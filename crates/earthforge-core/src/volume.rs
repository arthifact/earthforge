//! Sparse 3D column field. Uniform regions share a background column; explicit
//! columns are stored only where material differs. No dense 3D raster is kept.
//! This is a storage/operation prototype, not the general 3D basin generator.
use crate::{
    budget::Inventory,
    material::{self, Bed, Column, Layer, WATER},
    space::{ColumnIndex, GridGeometry, PlanarFault, WorldPoint},
};
use std::collections::BTreeMap;
#[derive(Clone, Debug)]
pub struct ColumnField {
    pub geometry: GridGeometry,
    background: Column,
    columns: BTreeMap<usize, Column>,
}
impl ColumnField {
    pub fn new(geometry: GridGeometry, background: Column) -> Result<Self, String> {
        let geometry = geometry.validate()?;
        Self::validate_column(&background, geometry)?;
        Ok(Self {
            geometry,
            background,
            columns: BTreeMap::new(),
        })
    }
    fn validate_column(c: &Column, g: GridGeometry) -> Result<(), String> {
        for p in c {
            if !p.height.is_finite()
                || p.height <= 0.0
                || !p.solid.is_finite()
                || p.solid < 0.0
                || p.solid > p.height
                || ![
                    p.fraction, p.burial, p.loading, p.offset_x, p.offset_y, p.offset_z,
                ]
                .iter()
                .all(|x| x.is_finite())
                || p.fraction < 0.0
                || p.fraction > 1.0
            {
                return Err("Invalid 3D material parcel".into());
            }
        }
        let s = material::scale(&[c], &[g.nz as f64 * g.dz])?;
        if material::total(c, s)? != s.units(g.nz as f64 * g.dz)? {
            return Err("3D column does not fill its exact domain".into());
        }
        Ok(())
    }
    pub fn get(&self, i: ColumnIndex) -> Result<&Column, String> {
        let index = self.geometry.column(i)?;
        Ok(self.columns.get(&index).unwrap_or(&self.background))
    }
    pub fn set(&mut self, i: ColumnIndex, c: Column) -> Result<(), String> {
        let index = self.geometry.column(i)?;
        Self::validate_column(&c, self.geometry)?;
        if c == self.background {
            self.columns.remove(&index);
        } else {
            self.columns.insert(index, c);
        }
        Ok(())
    }
    pub fn allocated_columns(&self) -> usize {
        self.columns.len()
    }
    pub fn inventory(&self, beds: &[Bed]) -> Inventory {
        let mut one = Inventory::default();
        one.column(&self.background, beds, self.geometry.column_area());
        let mut result = Inventory::default();
        result.add(
            &one,
            (self.geometry.nx * self.geometry.ny - self.columns.len()) as f64,
        );
        for c in self.columns.values() {
            result.column(c, beds, self.geometry.column_area())
        }
        result
    }
    pub fn physical_midpoint(&self, i: ColumnIndex, top: f64, p: &Layer) -> WorldPoint {
        let w = self.geometry.world(i, top + p.height / 2.0);
        WorldPoint {
            x: w.x + p.offset_x,
            y: w.y + p.offset_y,
            z: w.z + p.offset_z,
        }
    }
    pub fn compact(&mut self, beds: &[Bed], pressure: Option<f64>) -> Result<(), String> {
        let background = material::compact(&self.background, beds, pressure)?.0;
        let mut next = BTreeMap::new();
        for (&i, c) in &self.columns {
            let compacted = material::compact(c, beds, pressure)?.0;
            if compacted != background {
                next.insert(i, compacted);
            }
        }
        Self::validate_column(&background, self.geometry)?;
        for c in next.values() {
            Self::validate_column(c, self.geometry)?;
        }
        self.background = background;
        self.columns = next;
        Ok(())
    }
    /// Exact prototype: horizontal fault, grid-aligned slip in either horizontal
    /// direction, open boundaries. General inclined/curved fault overlap is rejected.
    /// All writes commit after the whole operation succeeds.
    pub fn slip_horizontal(
        &mut self,
        fault: PlanarFault,
        beds: &[Bed],
    ) -> Result<Inventory, String> {
        let fault = fault.validate()?;
        let g = self.geometry;
        let ix = fault.slip.x / g.dx;
        let iy = fault.slip.y / g.dy;
        if fault.normal.x != 0.0
            || fault.normal.y != 0.0
            || fault.normal.z != 1.0
            || fault.slip.z != 0.0
            || ix.fract() != 0.0
            || iy.fract() != 0.0
        {
            return Err(
                "3D prototype requires horizontal plane and grid-aligned tangential slip".into(),
            );
        }
        let cut = fault.point.z - g.origin.z;
        let end = g.nz as f64 * g.dz;
        if cut < 0.0 || cut > end {
            return Err("Fault outside vertical domain".into());
        }
        let dx = ix as isize;
        let dy = iy as isize;
        if self
            .background
            .iter()
            .chain(self.columns.values().flatten())
            .any(|p| p.offset_z != 0.0)
        {
            return Err("3D prototype does not yet cut vertically offset material".into());
        }
        let mut next = self.clone();
        let mut outflow = Inventory::default();
        for y in 0..g.ny {
            for x in 0..g.nx {
                let index = ColumnIndex { x, y };
                let source = self.get(index)?;
                let tx = (x as isize).saturating_add(dx);
                let ty = (y as isize).saturating_add(dy);
                if tx < 0 || ty < 0 || tx >= g.nx as isize || ty >= g.ny as isize {
                    outflow.column(
                        &material::slice(source, &[0.0], &[cut])?,
                        beds,
                        g.column_area(),
                    );
                }
                let sx = (x as isize).saturating_sub(dx);
                let sy = (y as isize).saturating_sub(dy);
                let mut column = vec![];
                if sx < 0 || sy < 0 || sx >= g.nx as isize || sy >= g.ny as isize {
                    material::append(&mut column, Layer::empty(WATER, cut))?;
                } else {
                    let donor = self.get(ColumnIndex {
                        x: sx as usize,
                        y: sy as usize,
                    })?;
                    for p in material::slice(donor, &[0.0], &[cut])? {
                        material::append(&mut column, p)?;
                    }
                }
                for p in material::slice(source, &[cut], &[end])? {
                    material::append(&mut column, p)?;
                }
                next.set(index, column)?;
            }
        }
        *self = next;
        Ok(outflow)
    }
}
