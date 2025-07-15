"""Parser for experiment directory structures using Pydantic models."""

from pathlib import Path
from typing import List, Dict
from align_browser.experiment_models import ExperimentData, GlobalManifest


def _extract_run_variant(experiment_dir: Path, experiments_root: Path) -> str:
    """Extract run variant from directory structure for distinguishing conflicting experiments."""
    try:
        # Get the relative path from experiments_root
        relative_path = experiment_dir.relative_to(experiments_root)
        path_parts = relative_path.parts

        # Look for meaningful run identifiers in the directory structure
        for part in path_parts:
            # Extract run variant patterns like "_rerun", "_original", "_test", etc.
            if "_rerun" in part:
                return "rerun"
            elif "_original" in part or "original" in part:
                return "original"
            elif "_test" in part:
                return "test"

        # If no special patterns found, use the immediate parent directory name
        # This handles cases like: combined_rerun/dir1/exp vs combined_rerun/dir2/exp
        if len(path_parts) >= 2:
            parent_dir = path_parts[-2]  # Directory containing the experiment
            # Clean up common suffixes and make it more readable
            if parent_dir.endswith("_rerun"):
                return parent_dir[:-6]  # Remove "_rerun" suffix
            return parent_dir

        return ""
    except (ValueError, AttributeError):
        return ""


def parse_experiments_directory(experiments_root: Path) -> List[ExperimentData]:
    """
    Parse the experiments directory structure and return a list of ExperimentData.

    Recursively searches through the directory structure to find all directories
    that contain the required experiment files (input_output.json, scores.json,
    timing.json, and .hydra/config.yaml).

    Args:
        experiments_root: Path to the root experiments directory

    Returns:
        List of successfully parsed ExperimentData objects
    """
    experiments = []

    # Recursively find all directories that have required experiment files
    for experiment_dir in experiments_root.rglob("*"):
        if not experiment_dir.is_dir():
            continue

        # Skip directories containing "OUTDATED" in their path
        if "OUTDATED" in str(experiment_dir).upper():
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

    Detects conflicts (same ADM+LLM+KDMA but different directories) and
    adds run_variant parameter to resolve conflicts.

    Args:
        experiments: List of ExperimentData objects
        experiments_root: Path to experiments root (for calculating relative paths)

    Returns:
        GlobalManifest object with experiment data
    """
    # First pass: detect conflicts by grouping experiments by their base key (without run_variant)
    base_key_groups: Dict[str, List[ExperimentData]] = {}

    for experiment in experiments:
        # Generate base key without run_variant for conflict detection
        original_run_variant = experiment.config.run_variant
        experiment.config.run_variant = None
        base_key = experiment.config.generate_key()
        experiment.config.run_variant = original_run_variant  # Restore original

        if base_key not in base_key_groups:
            base_key_groups[base_key] = []
        base_key_groups[base_key].append(experiment)

    # Second pass: add run_variant for conflicting experiments
    enhanced_experiments = []

    for base_key, group_experiments in base_key_groups.items():
        if len(group_experiments) == 1:
            # No conflict, use original experiment
            enhanced_experiments.append(group_experiments[0])
        else:
            # Conflict detected - add run_variant from directory structure
            for experiment in group_experiments:
                run_variant = _extract_run_variant(
                    experiment.experiment_path, experiments_root
                )
                if run_variant:
                    # Create a copy of the experiment with run_variant
                    enhanced_config = experiment.config.model_copy(deep=True)
                    enhanced_config.run_variant = run_variant

                    enhanced_experiment = ExperimentData(
                        config=enhanced_config,
                        input_output=experiment.input_output,
                        scores=experiment.scores,
                        timing=experiment.timing,
                        experiment_path=experiment.experiment_path,
                    )
                    enhanced_experiments.append(enhanced_experiment)
                else:
                    # Fallback: use original if no run variant available
                    enhanced_experiments.append(experiment)

    # Build manifest with enhanced experiments
    manifest = GlobalManifest()

    for experiment in enhanced_experiments:
        manifest.add_experiment(experiment, experiments_root)

    # Add metadata
    manifest.metadata = {
        "total_experiments": manifest.get_experiment_count(),
        "adm_types": manifest.get_adm_types(),
        "llm_backbones": manifest.get_llm_backbones(),
        "kdma_combinations": manifest.get_kdma_combinations(),
        "generated_at": None,  # Will be set in build.py
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
