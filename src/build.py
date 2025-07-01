import shutil
import json
from pathlib import Path
import argparse
from datetime import datetime
from jinja2 import Environment, FileSystemLoader
from experiment_parser import (
    parse_experiments_directory,
    build_manifest_from_experiments,
    copy_experiment_files,
)


def main():
    parser = argparse.ArgumentParser(
        description="Generate static web app for ADM results visualization."
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
        help="Output directory for the generated site (default: dist)",
    )
    args = parser.parse_args()

    script_dir = Path(__file__).parent.resolve()
    experiments_root = Path(args.experiments).resolve()

    # Output directory is always relative to current working directory
    dist_dir = Path(args.output_dir).resolve()

    static_dir = script_dir.parent / "static"  # static is in align-browser root
    templates_dir = (
        script_dir.parent / "templates"
    )  # templates is in align-browser root

    # Clean output directory
    if dist_dir.exists():
        shutil.rmtree(dist_dir)
    dist_dir.mkdir(parents=True, exist_ok=True)

    # Copy static assets
    shutil.copytree(static_dir, dist_dir, dirs_exist_ok=True)

    data_output_dir = dist_dir / "data"
    data_output_dir.mkdir(exist_ok=True)

    # Parse experiments and build manifest
    experiments = parse_experiments_directory(experiments_root)
    manifest = build_manifest_from_experiments(experiments, experiments_root)

    # Add generation timestamp
    manifest.metadata["generated_at"] = datetime.now().isoformat()

    # Copy experiment data files
    copy_experiment_files(experiments, experiments_root, data_output_dir)

    # Save manifest
    with open(dist_dir / "manifest.json", "w") as f:
        json.dump(manifest.model_dump(), f, indent=2)

    # Template Rendering
    env = Environment(loader=FileSystemLoader(templates_dir))
    template = env.get_template("index.html.j2")
    rendered_html = template.render()

    with open(dist_dir / "index.html", "w") as f:
        f.write(rendered_html)

    print(f"Static site generated in {dist_dir}")


if __name__ == "__main__":
    main()
