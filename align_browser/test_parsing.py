"""Simple tests for experiment parsing using real experiment data."""

import sys
from align_browser.experiment_models import ExperimentData
from align_browser.experiment_parser import (
    parse_experiments_directory,
    build_manifest_from_experiments,
)
from align_browser.test_config import get_experiments_path_or_skip


def test_parse_real_experiments():
    """Test parsing the real experiments directory."""
    experiments_root = get_experiments_path_or_skip()

    if not experiments_root:
        print("⏭️ Skipping test - experiments directory not available")
        return

    print(f"🔍 Parsing experiments from {experiments_root.resolve()}")

    experiments = parse_experiments_directory(experiments_root)
    print(f"✅ Successfully parsed {len(experiments)} experiments")

    if experiments:
        # Test the first experiment
        first_exp = experiments[0]
        print(f"📋 First experiment key: {first_exp.key}")
        print(f"📋 First experiment scenario: {first_exp.scenario_id}")
        print(f"📋 First experiment config ADM name: {first_exp.config.adm.name}")
        print(f"📋 First experiment path: {first_exp.experiment_path}")

        # Test key generation
        assert first_exp.key and first_exp.key != "unknown_adm_no_llm_", "Key generation may have issues"
        print("✅ Key generation working correctly")


def test_build_manifest():
    """Test building manifest from real experiments."""
    experiments_root = get_experiments_path_or_skip()

    if not experiments_root:
        print("⏭️ Skipping test - experiments directory not available")
        return

    experiments = parse_experiments_directory(experiments_root)
    manifest = build_manifest_from_experiments(experiments, experiments_root)

    print(
        f"✅ Built manifest with {len(manifest)} unique experiment configurations"
    )

    # Check manifest structure
    for key, value in list(manifest.items())[:3]:  # Show first 3
        scenarios = value.get("scenarios", {})
        print(f"📋 Config '{key}' has {len(scenarios)} scenarios")

    # Verify manifest structure
    assert manifest, "Empty manifest generated"
    
    first_key = list(manifest.keys())[0]
    first_entry = manifest[first_key]

    assert "scenarios" in first_entry, "Manifest missing scenarios key"
    
    first_scenario = list(first_entry["scenarios"].values())[0]
    required_fields = ["input_output", "scores", "timing", "config"]

    assert all(field in first_scenario for field in required_fields), "Manifest missing required fields"
    print("✅ Manifest structure is correct")


def test_experiment_data_loading():
    """Test loading individual experiment data."""
    experiments_root = get_experiments_path_or_skip()

    if not experiments_root:
        print("⏭️ Skipping test - experiments directory not available")
        return

    # Find first valid experiment directory
    experiment_dir = None
    for pipeline_dir in experiments_root.iterdir():
        if not pipeline_dir.is_dir():
            continue
        for exp_dir in pipeline_dir.glob("*"):
            if exp_dir.is_dir() and ExperimentData.has_required_files(exp_dir):
                experiment_dir = exp_dir
                break
        if experiment_dir:
            break

    assert experiment_dir, "No valid experiment directories found"

    print(f"🔍 Testing experiment loading from {experiment_dir}")
    experiment = ExperimentData.from_directory(experiment_dir)

    print(f"✅ Loaded experiment: {experiment.key}")
    print(f"📋 Scenario ID: {experiment.scenario_id}")
    print(f"📋 ADM name: {experiment.config.adm.name}")
    print(f"📋 LLM backbone: {experiment.config.adm.llm_backbone}")
    print(f"📋 Alignment target ID: {experiment.config.alignment_target.id}")
    print(f"📋 KDMA values: {len(experiment.config.alignment_target.kdma_values)}")
    print(f"📋 Input/output data items: {len(experiment.input_output.data)}")
    print(f"📋 Scores data items: {len(experiment.scores.data)}")
    print(f"📋 Timing scenarios: {len(experiment.timing.scenarios)}")


def main():
    """Run all tests."""
    print("🧪 Testing experiment parsing with real data...\n")

    tests = [
        ("Parse real experiments", test_parse_real_experiments),
        ("Build manifest", test_build_manifest),
        ("Load experiment data", test_experiment_data_loading),
    ]

    passed = 0
    failed = 0

    for test_name, test_func in tests:
        print(f"\n🔬 Running test: {test_name}")
        try:
            if test_func():
                print(f"✅ {test_name} PASSED")
                passed += 1
            else:
                print(f"❌ {test_name} FAILED")
                failed += 1
        except Exception as e:
            print(f"❌ {test_name} ERROR: {e}")
            failed += 1

    print("\n📊 Test Results:")
    print(f"✅ Passed: {passed}")
    print(f"❌ Failed: {failed}")
    print(f"📈 Success rate: {passed}/{passed + failed}")

    return failed == 0


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
