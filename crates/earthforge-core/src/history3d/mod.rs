//! Continuous regional 3D histories. Geological events define a material field;
//! vertical rays are exact interval queries of that field, not output voxels.
//! Tangential 3D fault inverse maps query other x/y locations, coupling rays.
//! Compaction is drained, vertical and quasistatic with the existing constitutive
//! laws. This does not solve 3D stress equilibrium or a pore-fluid-flow PDE.
pub mod audit;
mod bounds;
pub mod model;
pub mod output;
pub mod preset;
pub mod profile;
pub use model::{HistoryEvent, HistoryModel, HistorySpec, SpatialField};
