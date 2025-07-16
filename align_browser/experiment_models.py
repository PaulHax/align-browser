"""Pydantic models for experiment data structures and output formatting."""

import json
import yaml
import re
from pathlib import Path
from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field, ConfigDict


class KDMAValue(BaseModel):
    """Represents a KDMA (Key Decision Making Attributes) value."""

    kdma: str
    value: float
    kdes: Optional[Any] = None


def parse_alignment_target_id(alignment_target_id: str) -> List[KDMAValue]:
    """
    Parse alignment_target_id string to extract KDMA values.

    Examples:
        "ADEPT-June2025-merit-0.0" -> [KDMAValue(kdma="merit", value=0.0)]
        "ADEPT-June2025-affiliation-0.5" -> [KDMAValue(kdma="affiliation", value=0.5)]

    Args:
        alignment_target_id: String like "ADEPT-June2025-merit-0.0"

    Returns:
        List of KDMAValue objects
    """
    if not alignment_target_id:
        return []

    # Pattern: {prefix}-{scenario}-{kdma}-{value}
    pattern = r"^[^-]+-[^-]+-(.+)-(\d+(?:\.\d+)?)$"
    match = re.match(pattern, alignment_target_id)

    if not match:
        return []

    kdma_name = match.group(1)
    value = float(match.group(2))

    return [KDMAValue(kdma=kdma_name, value=value)]


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
    run_variant: Optional[str] = None

    def generate_key(self) -> str:
        """Generate a unique key for this experiment configuration."""
        kdma_parts = [
            f"{kv.kdma}-{kv.value}" for kv in self.alignment_target.kdma_values
        ]
        kdma_string = "_".join(sorted(kdma_parts))
        base_key = f"{self.adm.name}_{self.adm.llm_backbone}_{kdma_string}"

        if self.run_variant:
            return f"{base_key}_{self.run_variant}"
        return base_key


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
    scores: Optional[ScoresFile] = None
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

        # Load scores if available
        scores = None
        scores_path = experiment_dir / "scores.json"
        if scores_path.exists():
            scores = ScoresFile.from_file(scores_path)

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

    @classmethod
    def from_directory_new_format(
        cls,
        experiment_dir: Path,
        alignment_target_id: str,
        filtered_data: List[Dict[str, Any]],
        input_output_file_path: Path = None,
        timing_file_path: Path = None,
    ) -> "ExperimentData":
        """Load experiment data from new format directory for a specific alignment target."""
        # Load config
        config_path = experiment_dir / ".hydra" / "config.yaml"
        with open(config_path) as f:
            config_data = yaml.safe_load(f)

        # Create alignment_target from alignment_target_id
        kdma_values = parse_alignment_target_id(alignment_target_id)
        alignment_target = AlignmentTarget(
            id=alignment_target_id, kdma_values=kdma_values
        )

        # Add alignment_target to config
        config_data["alignment_target"] = alignment_target.model_dump()
        config = ExperimentConfig(**config_data)

        # Create input_output from filtered data
        input_output = InputOutputFile(data=filtered_data)

        # Load scores if available
        scores = None
        scores_path = experiment_dir / "scores.json"
        if scores_path.exists():
            scores = ScoresFile.from_file(scores_path)

        # Use specific timing file if provided, otherwise fall back to default
        timing_path = timing_file_path if timing_file_path else experiment_dir / "timing.json"
        with open(timing_path) as f:
            timing_data = json.load(f)
        timing = TimingData(**timing_data)

        # Store the specific file paths for the manifest
        experiment = cls(
            config=config,
            input_output=input_output,
            scores=scores,
            timing=timing,
            experiment_path=experiment_dir,
        )
        
        # Store the specific file paths as attributes for manifest generation
        experiment._input_output_file_path = input_output_file_path
        experiment._timing_file_path = timing_file_path
        
        return experiment

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
            "timing.json",
            ".hydra/config.yaml",
        ]
        return all((experiment_dir / f).exists() for f in required_files)

    @classmethod
    def is_new_format(cls, experiment_dir: Path) -> bool:
        """Check if directory uses new format (no alignment_target in config)."""
        if not cls.has_required_files(experiment_dir):
            return False

        config_path = experiment_dir / ".hydra" / "config.yaml"
        try:
            with open(config_path) as f:
                config_data = yaml.safe_load(f)
            return "alignment_target" not in config_data
        except Exception:
            return False


# Output Models for Frontend Consumption
class ExperimentSummary(BaseModel):
    """Summary of experiment data for the manifest."""

    input_output: str  # Path to input_output.json
    scores: Optional[str] = None  # Path to scores.json
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
        relative_experiment_path = experiment.experiment_path.relative_to(
            experiments_root
        )

        # Ensure key exists
        if key not in self.experiment_keys:
            self.experiment_keys[key] = ScenarioManifest()

        # Use specific file paths if available (for new format), otherwise default paths
        input_output_filename = "input_output.json"
        timing_filename = "timing.json"
        
        if hasattr(experiment, '_input_output_file_path') and experiment._input_output_file_path:
            input_output_filename = experiment._input_output_file_path.name
        if hasattr(experiment, '_timing_file_path') and experiment._timing_file_path:
            timing_filename = experiment._timing_file_path.name

        # Add all scenarios from the input_output data
        for item in experiment.input_output.data:
            scenario_id = item.input.scenario_id
            scores_path = None
            if experiment.scores is not None:
                scores_path = str(
                    Path("data") / relative_experiment_path / "scores.json"
                )

            self.experiment_keys[key].scenarios[scenario_id] = ExperimentSummary(
                input_output=str(
                    Path("data") / relative_experiment_path / input_output_filename
                ),
                scores=scores_path,
                timing=str(Path("data") / relative_experiment_path / timing_filename),
                config=experiment.config.model_dump(),
            )

    def get_experiment_count(self) -> int:
        """Get total number of experiments in the manifest."""
        return sum(
            len(scenario_manifest.scenarios)
            for scenario_manifest in self.experiment_keys.values()
        )

    def get_adm_types(self) -> List[str]:
        """Get unique ADM types from all experiments."""
        adm_types = set()
        for experiment_key in self.experiment_keys.values():
            for scenario_summary in experiment_key.scenarios.values():
                adm_name = scenario_summary.config.get("adm", {}).get("name", "unknown")
                adm_types.add(adm_name)
        return sorted(list(adm_types))

    def get_llm_backbones(self) -> List[str]:
        """Get unique LLM backbones from all experiments."""
        llm_backbones = set()
        for experiment_key in self.experiment_keys.values():
            for scenario_summary in experiment_key.scenarios.values():
                adm_config = scenario_summary.config.get("adm", {})
                structured_engine = adm_config.get("structured_inference_engine", {})
                model_name = structured_engine.get("model_name", "no_llm")
                llm_backbones.add(model_name)
        return sorted(list(llm_backbones))

    def get_kdma_combinations(self) -> List[str]:
        """Get unique KDMA combinations from all experiments."""
        kdma_combinations = set()
        for experiment_key in self.experiment_keys.values():
            for scenario_summary in experiment_key.scenarios.values():
                alignment_target = scenario_summary.config.get("alignment_target", {})
                kdma_values = alignment_target.get("kdma_values", [])
                kdma_parts = []
                for kv in kdma_values:
                    kdma_parts.append(f"{kv['kdma']}-{kv['value']}")
                if kdma_parts:
                    kdma_string = "_".join(sorted(kdma_parts))
                    kdma_combinations.add(kdma_string)
        return sorted(list(kdma_combinations))


class ChunkedExperimentData(BaseModel):
    """Chunked experiment data optimized for frontend loading."""

    chunk_id: str
    chunk_type: str  # "by_adm", "by_scenario", "by_kdma"
    experiments: List[Dict[str, Any]]
    metadata: Dict[str, Any] = Field(default_factory=dict)

    @classmethod
    def create_adm_chunk(
        cls, adm_type: str, experiments: List[ExperimentData]
    ) -> "ChunkedExperimentData":
        """Create a chunk organized by ADM type."""
        return cls(
            chunk_id=f"adm_{adm_type}",
            chunk_type="by_adm",
            experiments=[exp.model_dump() for exp in experiments],
            metadata={"adm_type": adm_type, "count": len(experiments)},
        )

    @classmethod
    def create_scenario_chunk(
        cls, scenario_id: str, experiments: List[ExperimentData]
    ) -> "ChunkedExperimentData":
        """Create a chunk organized by scenario ID."""
        return cls(
            chunk_id=f"scenario_{scenario_id}",
            chunk_type="by_scenario",
            experiments=[exp.model_dump() for exp in experiments],
            metadata={"scenario_id": scenario_id, "count": len(experiments)},
        )
