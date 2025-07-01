import shutil
import json
import yaml
from pathlib import Path
import argparse
from jinja2 import Environment, FileSystemLoader


def load_json(filepath):
    with open(filepath, "r") as f:
        return json.load(f)


def load_yaml(filepath):
    with open(filepath, "r") as f:
        return yaml.safe_load(f)


def generate_key(config_item):
    adm_name = "unknown_adm"
    llm_backbone = "no_llm"
    kdma_parts = []

    if not isinstance(config_item, dict):
        print(
            f"DEBUG: generate_key received non-dict config_item: type={type(config_item)}, content={config_item}"
        )
        return f"malformed_config_{type(config_item).__name__}"

    adm_config = config_item.get("adm", {})
    if not isinstance(adm_config, dict):
        print(
            f"DEBUG: adm_config is not a dict: type={type(adm_config)}, content={adm_config}"
        )
        adm_config = {}  # Default to empty dict if not a dict

    adm_name = adm_config.get("name", "unknown_adm")

    # Safely get structured_inference_engine and check its type
    structured_inference_engine = adm_config.get("structured_inference_engine", {})
    if isinstance(structured_inference_engine, dict):
        llm_backbone = structured_inference_engine.get("model_name", "no_llm")
    else:
        print(
            f"DEBUG: structured_inference_engine is not a dict: type={type(structured_inference_engine)}, content={structured_inference_engine}"
        )
        llm_backbone = "no_llm"  # Default if not a dict

    alignment_target_config = config_item.get("alignment_target", {})
    if not isinstance(alignment_target_config, dict):
        print(
            f"DEBUG: alignment_target_config is not a dict: type={type(alignment_target_config)}, content={alignment_target_config}"
        )
        alignment_target_config = {}  # Default to empty dict if not a dict

    kdma_values = alignment_target_config.get("kdma_values", [])
    if isinstance(kdma_values, list):
        for i, kdma_entry in enumerate(kdma_values):
            if not isinstance(kdma_entry, dict):
                print(
                    f"DEBUG: kdma_entry[{i}] is not a dict: type={type(kdma_entry)}, content={kdma_entry}"
                )
                # Skip malformed KDMA entries
                continue
            kdma = kdma_entry.get("kdma", "unknown_kdma")
            value = kdma_entry.get("value", "unknown_value")
            kdma_parts.append(f"{kdma}-{value}")
    else:
        print(
            f"DEBUG: kdma_values is not a list: type={type(kdma_values)}, content={kdma_values}"
        )

    kdma_string = "_".join(sorted(kdma_parts))  # Sort to ensure consistent key order

    return f"{adm_name}_{llm_backbone}_{kdma_string}"


def main():
    parser = argparse.ArgumentParser(
        description="Generate static web app for ADM results visualization."
    )
    parser.add_argument(
        "data_dir",
        type=str,
        help="Path to the root of the experiment data directory (e.g., ../data)",
    )
    args = parser.parse_args()

    script_dir = Path(__file__).parent.resolve()
    data_root = Path(args.data_dir).resolve()
    dist_dir = script_dir / "dist"
    static_dir = script_dir / "static"
    templates_dir = script_dir / "templates"

    # Clean output directory
    if dist_dir.exists():
        shutil.rmtree(dist_dir)
    dist_dir.mkdir(parents=True, exist_ok=True)

    # Copy static assets
    shutil.copytree(static_dir, dist_dir, dirs_exist_ok=True)

    manifest = {}
    data_output_dir = dist_dir / "data"
    data_output_dir.mkdir(exist_ok=True)

    # Data Manifest Generation and Copy Data Files
    for pipeline_dir in data_root.iterdir():
        if not pipeline_dir.is_dir():
            continue
        for experiment_dir in pipeline_dir.glob("*"):
            if not experiment_dir.is_dir():
                continue

            config_path = experiment_dir / ".hydra" / "config.yaml"
            input_output_path = experiment_dir / "input_output.json"
            scores_path = experiment_dir / "scores.json"
            timing_path = experiment_dir / "timing.json"

            if not (
                config_path.exists()
                and input_output_path.exists()
                and scores_path.exists()
                and timing_path.exists()
            ):
                print(f"Skipping incomplete experiment: {experiment_dir}")
                continue

            try:
                loaded_config_data = load_yaml(config_path)
                # If load_yaml returns a single dict, wrap it in a list for consistent processing
                if isinstance(loaded_config_data, dict):
                    configs_to_process = [loaded_config_data]
                elif isinstance(loaded_config_data, list):
                    configs_to_process = loaded_config_data
                else:
                    print(
                        f"Skipping experiment {experiment_dir}: config.yaml loaded as unexpected type {type(loaded_config_data)}. Content: {loaded_config_data}"
                    )
                    continue

            except yaml.YAMLError as exc:
                print(f"Error parsing YAML from {config_path}: {exc}")
                continue

            for (
                config_item
            ) in configs_to_process:  # Iterate over each config if it's a list
                if not isinstance(config_item, dict):
                    print(
                        f"Skipping sub-config in {experiment_dir}: Expected dictionary, got {type(config_item)}. Content: {config_item}"
                    )
                    continue

                try:
                    input_output_data = load_json(input_output_path)
                    scenario_id = input_output_data.get("input", {}).get(
                        "scenario_id", "unknown_scenario"
                    )

                    # Determine relative path for copying
                    relative_experiment_path = experiment_dir.relative_to(data_root)
                    target_experiment_dir = data_output_dir / relative_experiment_path
                    target_experiment_dir.mkdir(parents=True, exist_ok=True)

                    # Copy relevant files
                    shutil.copy(
                        input_output_path, target_experiment_dir / "input_output.json"
                    )
                    shutil.copy(scores_path, target_experiment_dir / "scores.json")
                    shutil.copy(timing_path, target_experiment_dir / "timing.json")
                    # Optionally copy config.yaml if needed client-side, or extract relevant parts
                    # shutil.copy(config_path, target_experiment_dir / "config.yaml")

                    # Generate key for manifest
                    key = generate_key(config_item)  # Pass config_item to generate_key

                    if key not in manifest:
                        manifest[key] = {"scenarios": {}}

                    manifest[key]["scenarios"][scenario_id] = {
                        "input_output": str(
                            Path("data")
                            / relative_experiment_path
                            / "input_output.json"
                        ),
                        "scores": str(
                            Path("data") / relative_experiment_path / "scores.json"
                        ),
                        "timing": str(
                            Path("data") / relative_experiment_path / "timing.json"
                        ),
                        "config": config_item,  # Store full config for now, can optimize later
                    }

                except Exception as e:
                    print(f"Error processing {experiment_dir} with sub-config: {e}")
                    continue

    # Save manifest
    with open(dist_dir / "manifest.json", "w") as f:
        json.dump(manifest, f, indent=2)

    # Template Rendering
    env = Environment(loader=FileSystemLoader(templates_dir))
    template = env.get_template("index.html.j2")
    rendered_html = template.render()

    with open(dist_dir / "index.html", "w") as f:
        f.write(rendered_html)

    print(f"Static site generated in {dist_dir}")


if __name__ == "__main__":
    main()
