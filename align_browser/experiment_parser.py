"""Parser for experiment directory structures using Pydantic models."""

import re
from pathlib import Path
from typing import List, Dict
from align_browser.experiment_models import ExperimentData, GlobalManifest


def _extract_run_variant(
    experiment_dir: Path, experiments_root: Path, all_conflicting_dirs: List[Path]
) -> str:
    """
    Extract run variant from directory structure for distinguishing conflicting experiments.

    Args:
        experiment_dir: Path to the specific experiment directory
        experiments_root: Root path of all experiments
        all_conflicting_dirs: List of all directories that have conflicts (same ADM+LLM+KDMA)

    Returns:
        String representing the run variant, or empty string for default
    """
    try:
        # Get the relative path from experiments_root
        relative_path = experiment_dir.relative_to(experiments_root)
        path_parts = relative_path.parts

        # Skip KDMA configuration directories (contain dashes with numbers)
        # Examples: merit-0.4, affiliation-0.0, personal_safety-0.5
        def is_kdma_dir(dirname):
            return bool(re.match(r"^[a-z_]+-(0\.\d+|1\.0|0)$", dirname))

        # Find the ADM-level directory (first non-KDMA directory)
        adm_dir = None
        for part in path_parts:
            if not is_kdma_dir(part):
                adm_dir = part
                break

        if not adm_dir:
            return ""

        # Extract ADM directories from all conflicting paths
        conflicting_adm_dirs = set()
        for conflict_dir in all_conflicting_dirs:
            try:
                conflict_relative = conflict_dir.relative_to(experiments_root)
                conflict_parts = conflict_relative.parts
                for part in conflict_parts:
                    if not is_kdma_dir(part):
                        conflicting_adm_dirs.add(part)
                        break
            except (ValueError, AttributeError):
                continue

        # If there's only one unique ADM directory, no variant needed
        if len(conflicting_adm_dirs) <= 1:
            return ""

        # Find the common prefix among all conflicting ADM directories
        adm_dir_list = sorted(conflicting_adm_dirs)
        common_prefix = ""

        if len(adm_dir_list) >= 2:
            # Find longest common prefix
            first_dir = adm_dir_list[0]
            for i, char in enumerate(first_dir):
                if all(i < len(d) and d[i] == char for d in adm_dir_list):
                    common_prefix += char
                else:
                    break

            # Remove trailing underscores
            common_prefix = common_prefix.rstrip("_")

        # Extract variant as the unique suffix after common prefix
        if common_prefix and adm_dir.startswith(common_prefix):
            variant = adm_dir[len(common_prefix) :].lstrip("_")
            # Use lexicographically first directory as "default" (empty string)
            if adm_dir == min(adm_dir_list):
                return ""
            return variant if variant else ""

        # Fallback: use the full ADM directory name if no common prefix found
        # Choose the lexicographically first one as default
        if adm_dir == min(conflicting_adm_dirs):
            return ""
        return adm_dir

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
    # First pass: detect TRUE conflicts by grouping experiments by their complete key
    # True conflicts are experiments with identical ADM+LLM+KDMA in different directories
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

    # Second pass: add run_variant only for TRUE conflicts
    enhanced_experiments = []

    for base_key, group_experiments in base_key_groups.items():
        if len(group_experiments) == 1:
            # No conflict, use original experiment
            enhanced_experiments.append(group_experiments[0])
        else:
            # TRUE conflict detected - same ADM+LLM+KDMA in different directories
            # Check if these are actually different KDMA configurations that got the same key
            # This shouldn't happen if KDMA parsing is working correctly
            all_have_same_kdmas = True
            if len(group_experiments) > 1:
                first_kdmas = set(
                    (kv.kdma, kv.value)
                    for kv in group_experiments[0].config.alignment_target.kdma_values
                )
                for exp in group_experiments[1:]:
                    exp_kdmas = set(
                        (kv.kdma, kv.value)
                        for kv in exp.config.alignment_target.kdma_values
                    )
                    if exp_kdmas != first_kdmas:
                        all_have_same_kdmas = False
                        break

            if not all_have_same_kdmas:
                # Different KDMAs but same key - shouldn't happen, just use originals
                enhanced_experiments.extend(group_experiments)
            else:
                # True conflicts - add run_variant from directory structure
                conflicting_dirs = [exp.experiment_path for exp in group_experiments]
                for experiment in group_experiments:
                    run_variant = _extract_run_variant(
                        experiment.experiment_path, experiments_root, conflicting_dirs
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
