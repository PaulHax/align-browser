import shutil
import json
from pathlib import Path
import argparse
from datetime import datetime
from experiment_parser import (
    parse_experiments_directory,
    build_manifest_from_experiments,
    copy_experiment_files,
)


def main():
    parser = argparse.ArgumentParser(
        description="Generate static web app for ADM Results."
    )
    parser.add_argument(
        "experiments",
        type=str,
        help="Path to the root experiments directory (e.g., ../experiments)",
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default="dist",
        help="Output directory for the generated data (default: dist)",
    )
    args = parser.parse_args()

    experiments_root = Path(args.experiments).resolve()

    # Output directory is always relative to current working directory
    output_dir = Path(args.output_dir).resolve()

    # Ensure output directory exists
    output_dir.mkdir(parents=True, exist_ok=True)

    # Create data subdirectory and clean it
    data_output_dir = output_dir / "data"
    if data_output_dir.exists():
        shutil.rmtree(data_output_dir)
    data_output_dir.mkdir(exist_ok=True)

    # Parse experiments and build manifest
    experiments = parse_experiments_directory(experiments_root)
    manifest = build_manifest_from_experiments(experiments, experiments_root)

    # Add generation timestamp
    manifest.metadata["generated_at"] = datetime.now().isoformat()

    # Copy experiment data files
    copy_experiment_files(experiments, experiments_root, data_output_dir)

    # Save manifest in data subdirectory
    with open(data_output_dir / "manifest.json", "w") as f:
        json.dump(manifest.model_dump(), f, indent=2)

    print(f"Data generated in {data_output_dir}")


if __name__ == "__main__":
    main()
