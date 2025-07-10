"""Parser for experiment directory structures using Pydantic models."""

from pathlib import Path
from typing import Dict, List, Any
from align_browser.experiment_models import ExperimentData, GlobalManifest


def parse_experiments_directory(experiments_root: Path) -> List[ExperimentData]:
    """
    Parse the experiments directory structure and return a list of ExperimentData.

    Args:
        experiments_root: Path to the root experiments directory

    Returns:
        List of successfully parsed ExperimentData objects
    """
    experiments = []

    for pipeline_dir in experiments_root.iterdir():
        if not pipeline_dir.is_dir():
            continue

        for experiment_dir in pipeline_dir.glob("*"):
            if not experiment_dir.is_dir():
                continue

            # Check if directory has all required files
            if not ExperimentData.has_required_files(experiment_dir):
                continue

            try:
                # Load experiment data using Pydantic models
                experiment = ExperimentData.from_directory(experiment_dir)
                experiments.append(experiment)

            except Exception as e:
                print(f"Error processing {experiment_dir}: {e}")
                continue

    return experiments


def build_manifest_from_experiments(
    experiments: List[ExperimentData], experiments_root: Path
) -> GlobalManifest:
    """
    Build the global manifest from a list of parsed experiments.

    Args:
        experiments: List of ExperimentData objects
        experiments_root: Path to experiments root (for calculating relative paths)

    Returns:
        GlobalManifest object with experiment data
    """
    manifest = GlobalManifest()
    
    # Add each experiment to the manifest
    for experiment in experiments:
        manifest.add_experiment(experiment, experiments_root)
    
    # Add metadata
    manifest.metadata = {
        "total_experiments": manifest.get_experiment_count(),
        "adm_types": manifest.get_adm_types(),
        "llm_backbones": manifest.get_llm_backbones(),
        "kdma_combinations": manifest.get_kdma_combinations(),
        "generated_at": None  # Will be set in build.py
    }
    
    return manifest


def copy_experiment_files(
    experiments: List[ExperimentData], experiments_root: Path, data_output_dir: Path
):
    """
    Copy experiment files to the output data directory.

    Args:
        experiments: List of ExperimentData objects
        experiments_root: Path to experiments root
        data_output_dir: Path to output data directory
    """
    import shutil

    for experiment in experiments:
        # Determine relative path for copying
        relative_experiment_path = experiment.experiment_path.relative_to(
            experiments_root
        )
        target_experiment_dir = data_output_dir / relative_experiment_path
        target_experiment_dir.mkdir(parents=True, exist_ok=True)

        # Copy relevant files
        shutil.copy(
            experiment.experiment_path / "input_output.json",
            target_experiment_dir / "input_output.json",
        )
        shutil.copy(
            experiment.experiment_path / "scores.json",
            target_experiment_dir / "scores.json",
        )
        shutil.copy(
            experiment.experiment_path / "timing.json",
            target_experiment_dir / "timing.json",
        )
