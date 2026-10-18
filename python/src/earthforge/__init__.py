"""Earth Forge research API. Python orchestrates; Rust owns all simulation physics."""
from .engine import Engine, EngineError
from .export import load_npz
from .dataset import load_dataset
from .ensemble import EnsemblePlan, condition_histories, run_ensemble
from .conditioning import weighted_quantile
from .seismic import Shot, acoustic_shot
from .model import CATALOG, SCENARIOS, Grid, History, Parameters, Volume

__version__ = "0.2.0a2"
__all__ = ["Engine", "EngineError", "Grid", "History", "Parameters", "Volume", "CATALOG", "SCENARIOS", "load_npz", "load_dataset", "EnsemblePlan", "run_ensemble", "condition_histories", "weighted_quantile", "Shot", "acoustic_shot"]
