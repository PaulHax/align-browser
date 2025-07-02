"""Pydantic models for experiment data structures and output formatting."""

import json
import yaml
from pathlib import Path
from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field, ConfigDict


class KDMAValue(BaseModel):
    """Represents a KDMA (Key Decision Making Attributes) value."""

    kdma: str
    value: float
    kdes: Optional[Any] = None


class AlignmentTarget(BaseModel):
    """Represents an alignment target configuration."""

    id: str = "unknown_target"
    kdma_values: List[KDMAValue] = Field(default_factory=list)


class ADMConfig(BaseModel):
    """Represents ADM (Automated Decision Maker) configuration."""

    name: str = "unknown_adm"
    instance: Optional[Dict[str, Any]] = None
    structured_inference_engine: Optional[Dict[str, Any]] = None

    @property
    def llm_backbone(self) -> str:
        """Extract LLM backbone model name."""
        if self.structured_inference_engine:
            return self.structured_inference_engine.get("model_name", "no_llm")
        return "no_llm"


class ExperimentConfig(BaseModel):
    """Represents the complete experiment configuration from config.yaml."""

    name: str = "unknown"
    adm: ADMConfig = Field(default_factory=ADMConfig)
    alignment_target: AlignmentTarget = Field(default_factory=AlignmentTarget)

    def generate_key(self) -> str:
        """Generate a unique key for this experiment configuration."""
        kdma_parts = [
            f"{kv.kdma}-{kv.value}" for kv in self.alignment_target.kdma_values
        ]
        kdma_string = "_".join(sorted(kdma_parts))
        return f"{self.adm.name}_{self.adm.llm_backbone}_{kdma_string}"


class InputData(BaseModel):
    """Represents input data for an experiment."""

    scenario_id: str = "unknown_scenario"
    alignment_target_id: Optional[str] = None
    full_state: Optional[Dict[str, Any]] = None
    state: Optional[str] = None
    choices: Optional[List[Dict[str, Any]]] = None


class InputOutputItem(BaseModel):
    """Represents a single input/output item from the experiment."""

    input: InputData
    output: Optional[Dict[str, Any]] = None


class ScenarioTiming(BaseModel):
    """Represents timing data for a scenario."""

    n_actions_taken: int
    total_time_s: float
    avg_time_s: float
    max_time_s: float
    raw_times_s: List[float]


class TimingData(BaseModel):
    """Represents timing data from timing.json."""

    scenarios: List[ScenarioTiming]


class InputOutputFile(BaseModel):
    """Wrapper for input_output.json which contains an array of items."""

    data: List[InputOutputItem]

    @classmethod
    def from_file(cls, path: Path) -> "InputOutputFile":
        """Load input_output.json file."""
        with open(path) as f:
            raw_data = json.load(f)
        
        # Process data to append index to duplicate scenario_ids
        processed_data = []
        for i, item in enumerate(raw_data):
            # Create a copy of the item
            item_copy = item.copy()
            # Append index to scenario_id to make it unique
            original_scenario_id = item_copy["input"]["scenario_id"]
            item_copy["input"]["scenario_id"] = f"{original_scenario_id}-{i}"
            processed_data.append(item_copy)
        
        return cls(data=processed_data)

    @property
    def first_scenario_id(self) -> str:
        """Get the scenario ID from the first item."""
        if self.data:
            return self.data[0].input.scenario_id
        return "unknown_scenario"


class ScoresFile(BaseModel):
    """Wrapper for scores.json which contains an array of scoring data."""

    data: List[Dict[str, Any]]

    @classmethod
    def from_file(cls, path: Path) -> "ScoresFile":
        """Load scores.json file."""
        with open(path) as f:
            raw_data = json.load(f)
        return cls(data=raw_data)


class ExperimentData(BaseModel):
    """Complete experiment data loaded from a directory."""

    config: ExperimentConfig
    input_output: InputOutputFile
    scores: ScoresFile
    timing: TimingData
    experiment_path: Path

    model_config = ConfigDict(arbitrary_types_allowed=True)  # Allow Path type

    @classmethod
    def from_directory(cls, experiment_dir: Path) -> "ExperimentData":
        """Load all experiment data from a directory."""
        # Load config
        config_path = experiment_dir / ".hydra" / "config.yaml"
        with open(config_path) as f:
            config_data = yaml.safe_load(f)
        config = ExperimentConfig(**config_data)

        # Load other files
        input_output = InputOutputFile.from_file(experiment_dir / "input_output.json")
        scores = ScoresFile.from_file(experiment_dir / "scores.json")

        with open(experiment_dir / "timing.json") as f:
            timing_data = json.load(f)
        timing = TimingData(**timing_data)

        return cls(
            config=config,
            input_output=input_output,
            scores=scores,
            timing=timing,
            experiment_path=experiment_dir,
        )

    @property
    def key(self) -> str:
        """Get the unique key for this experiment."""
        return self.config.generate_key()

    @property
    def scenario_id(self) -> str:
        """Get the scenario ID for this experiment."""
        return self.input_output.first_scenario_id

    @classmethod
    def has_required_files(cls, experiment_dir: Path) -> bool:
        """Check if directory has all required experiment files."""
        required_files = [
            "input_output.json",
            "scores.json",
            "timing.json",
            ".hydra/config.yaml",
        ]
        return all((experiment_dir / f).exists() for f in required_files)


# Output Models for Frontend Consumption
class ExperimentSummary(BaseModel):
    """Summary of experiment data for the manifest."""
    
    input_output: str  # Path to input_output.json
    scores: str  # Path to scores.json  
    timing: str  # Path to timing.json
    config: Dict[str, Any]  # Full experiment configuration


class ScenarioManifest(BaseModel):
    """Manifest entry for scenarios within an experiment key."""
    
    scenarios: Dict[str, ExperimentSummary] = Field(default_factory=dict)


class GlobalManifest(BaseModel):
    """Top-level manifest for all experiments."""
    
    experiment_keys: Dict[str, ScenarioManifest] = Field(default_factory=dict)
    metadata: Dict[str, Any] = Field(default_factory=dict)
    
    def add_experiment(self, experiment: "ExperimentData", experiments_root: Path):
        """Add an experiment to the manifest."""
        key = experiment.key
        
        # Calculate relative path
        relative_experiment_path = experiment.experiment_path.relative_to(experiments_root)
        
        # Ensure key exists
        if key not in self.experiment_keys:
            self.experiment_keys[key] = ScenarioManifest()
        
        # Add all scenarios from the input_output data
        for item in experiment.input_output.data:
            scenario_id = item.input.scenario_id
            self.experiment_keys[key].scenarios[scenario_id] = ExperimentSummary(
                input_output=str(Path("data") / relative_experiment_path / "input_output.json"),
                scores=str(Path("data") / relative_experiment_path / "scores.json"),
                timing=str(Path("data") / relative_experiment_path / "timing.json"),
                config=experiment.config.model_dump()
            )
    
    def get_experiment_count(self) -> int:
        """Get total number of experiments in the manifest."""
        return sum(len(scenario_manifest.scenarios) for scenario_manifest in self.experiment_keys.values())
    
    def get_adm_types(self) -> List[str]:
        """Get unique ADM types from all experiments."""
        adm_types = set()
        for key in self.experiment_keys.keys():
            # Extract ADM type from key (format: adm_type_llm_kdma)
            parts = key.split('_')
            if len(parts) >= 2:
                # Handle pipeline_* ADM types
                if parts[0] == 'pipeline':
                    adm_types.add(f"{parts[0]}_{parts[1]}")
                else:
                    adm_types.add(parts[0])
        return sorted(list(adm_types))
    
    def get_llm_backbones(self) -> List[str]:
        """Get unique LLM backbones from all experiments."""
        llm_backbones = set()
        for key in self.experiment_keys.keys():
            parts = key.split('_')
            if len(parts) >= 3:
                # Extract LLM backbone (assuming it's after ADM type)
                if parts[0] == 'pipeline':
                    llm_backbones.add(parts[2])
                else:
                    llm_backbones.add(parts[1])
        return sorted(list(llm_backbones))
    
    def get_kdma_combinations(self) -> List[str]:
        """Get unique KDMA combinations from all experiments."""
        kdma_combinations = set()
        for key in self.experiment_keys.keys():
            parts = key.split('_')
            if len(parts) >= 4:
                # KDMA part is everything after ADM and LLM
                if parts[0] == 'pipeline':
                    kdma_part = '_'.join(parts[3:])
                else:
                    kdma_part = '_'.join(parts[2:])
                kdma_combinations.add(kdma_part)
        return sorted(list(kdma_combinations))


class ChunkedExperimentData(BaseModel):
    """Chunked experiment data optimized for frontend loading."""
    
    chunk_id: str
    chunk_type: str  # "by_adm", "by_scenario", "by_kdma"
    experiments: List[Dict[str, Any]]
    metadata: Dict[str, Any] = Field(default_factory=dict)
    
    @classmethod
    def create_adm_chunk(cls, adm_type: str, experiments: List[ExperimentData]) -> "ChunkedExperimentData":
        """Create a chunk organized by ADM type."""
        return cls(
            chunk_id=f"adm_{adm_type}",
            chunk_type="by_adm",
            experiments=[exp.dict() for exp in experiments],
            metadata={"adm_type": adm_type, "count": len(experiments)}
        )
    
    @classmethod  
    def create_scenario_chunk(cls, scenario_id: str, experiments: List[ExperimentData]) -> "ChunkedExperimentData":
        """Create a chunk organized by scenario ID."""
        return cls(
            chunk_id=f"scenario_{scenario_id}",
            chunk_type="by_scenario", 
            experiments=[exp.dict() for exp in experiments],
            metadata={"scenario_id": scenario_id, "count": len(experiments)}
        )
