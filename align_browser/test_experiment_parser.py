"""Tests for experiment parsing functionality."""

import json
import yaml
import tempfile
from pathlib import Path
from align_browser.experiment_models import (
    KDMAValue,
    ADMConfig,
    ExperimentConfig,
    InputOutputFile,
    ScoresFile,
    ExperimentData,
    GlobalManifest,
    ScenarioManifest,
    ExperimentSummary,
    ChunkedExperimentData,
)
from align_browser.experiment_parser import (
    parse_experiments_directory,
    build_manifest_from_experiments,
)
from align_browser.test_config import get_experiments_path_or_skip


def create_sample_config_data():
    """Create sample config.yaml data for testing."""
    return {
        "name": "action_based",
        "adm": {
            "name": "pipeline_random",
            "instance": {
                "_target_": "align_system.algorithms.pipeline_adm.PipelineADM",
                "steps": ["step1", "step2"],
            },
            "structured_inference_engine": {"model_name": "llama3.3-70b"},
        },
        "alignment_target": {
            "id": "ADEPT-June2025-affiliation-0.5",
            "kdma_values": [{"kdes": None, "kdma": "affiliation", "value": 0.5}],
        },
    }


def create_sample_input_output_data():
    """Create sample input_output.json data for testing."""
    return [
        {
            "input": {
                "scenario_id": "June2025-AF-train",
                "alignment_target_id": "ADEPT-June2025-affiliation-0.5",
                "full_state": {
                    "unstructured": "Test scenario description",
                    "characters": [],
                },
                "state": "Test scenario",
                "choices": [
                    {
                        "action_id": "treat_patient_a",
                        "action_type": "TREAT_PATIENT",
                        "unstructured": "Treat Patient A",
                    }
                ],
            },
            "output": {
                "choice": "treat_patient_a",
                "justification": "Test justification",
            },
        }
    ]


def create_sample_scores_data():
    """Create sample scores.json data for testing."""
    return [
        {
            "alignment_source": [
                {"scenario_id": "June2025-AF-train", "probes": ["Probe 1", "Probe 2"]}
            ]
        }
    ]


def create_sample_timing_data():
    """Create sample timing.json data for testing."""
    return {
        "scenarios": [
            {
                "n_actions_taken": 92,
                "total_time_s": 0.026,
                "avg_time_s": 0.0003,
                "max_time_s": 0.0005,
                "raw_times_s": [0.0003, 0.0004, 0.0002],
            }
        ]
    }


def test_kdma_value_model():
    """Test KDMAValue model."""
    kdma = KDMAValue(kdma="affiliation", value=0.5)
    assert kdma.kdma == "affiliation"
    assert kdma.value == 0.5
    assert kdma.kdes is None


def test_adm_config_model():
    """Test ADMConfig model."""
    adm = ADMConfig(
        name="test_adm", structured_inference_engine={"model_name": "llama3.3-70b"}
    )
    assert adm.name == "test_adm"
    assert adm.llm_backbone == "llama3.3-70b"


def test_adm_config_no_llm():
    """Test ADMConfig model with no LLM backbone."""
    adm = ADMConfig(name="test_adm")
    assert adm.llm_backbone == "no_llm"


def test_experiment_config_key_generation():
    """Test ExperimentConfig key generation."""
    config_data = create_sample_config_data()
    config = ExperimentConfig(**config_data)

    key = config.generate_key()
    expected_key = "pipeline_random_llama3.3-70b_affiliation-0.5"
    assert key == expected_key


def test_input_output_file_model():
    """Test InputOutputFile model."""
    data = create_sample_input_output_data()

    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
        json.dump(data, f)
        temp_path = Path(f.name)

    try:
        input_output = InputOutputFile.from_file(temp_path)
        assert len(input_output.data) == 1
        assert input_output.first_scenario_id == "June2025-AF-train-0"
        assert input_output.data[0].input.scenario_id == "June2025-AF-train-0"
    finally:
        temp_path.unlink()


def test_scores_file_model():
    """Test ScoresFile model."""
    data = create_sample_scores_data()

    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
        json.dump(data, f)
        temp_path = Path(f.name)

    try:
        scores = ScoresFile.from_file(temp_path)
        assert len(scores.data) == 1
    finally:
        temp_path.unlink()


def test_experiment_data_from_directory():
    """Test loading ExperimentData from a directory."""
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)

        # Create experiment directory structure
        experiment_dir = temp_path / "test_experiment"
        experiment_dir.mkdir()
        hydra_dir = experiment_dir / ".hydra"
        hydra_dir.mkdir()

        # Create config.yaml
        config_data = create_sample_config_data()
        with open(hydra_dir / "config.yaml", "w") as f:
            yaml.dump(config_data, f)

        # Create input_output.json
        input_output_data = create_sample_input_output_data()
        with open(experiment_dir / "input_output.json", "w") as f:
            json.dump(input_output_data, f)

        # Create scores.json
        scores_data = create_sample_scores_data()
        with open(experiment_dir / "scores.json", "w") as f:
            json.dump(scores_data, f)

        # Create timing.json
        timing_data = create_sample_timing_data()
        with open(experiment_dir / "timing.json", "w") as f:
            json.dump(timing_data, f)

        # Test loading
        experiment = ExperimentData.from_directory(experiment_dir)

        assert experiment.key == "pipeline_random_llama3.3-70b_affiliation-0.5"
        assert experiment.scenario_id == "June2025-AF-train-0"
        assert experiment.config.adm.name == "pipeline_random"
        assert len(experiment.input_output.data) == 1
        assert len(experiment.scores.data) == 1
        assert len(experiment.timing.scenarios) == 1


def test_has_required_files():
    """Test checking for required files."""
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)
        experiment_dir = temp_path / "test_experiment"
        experiment_dir.mkdir()

        # Should fail with no files
        assert not ExperimentData.has_required_files(experiment_dir)

        # Create required files one by one
        hydra_dir = experiment_dir / ".hydra"
        hydra_dir.mkdir()
        (hydra_dir / "config.yaml").touch()
        assert not ExperimentData.has_required_files(experiment_dir)

        (experiment_dir / "input_output.json").touch()
        assert not ExperimentData.has_required_files(experiment_dir)

        (experiment_dir / "scores.json").touch()
        assert not ExperimentData.has_required_files(experiment_dir)

        (experiment_dir / "timing.json").touch()
        assert ExperimentData.has_required_files(experiment_dir)


def test_parse_experiments_directory():
    """Test parsing an experiments directory."""
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)

        # Create experiments structure
        experiments_root = temp_path / "experiments"
        experiments_root.mkdir()

        pipeline_dir = experiments_root / "pipeline_test"
        pipeline_dir.mkdir()

        experiment_dir = pipeline_dir / "affiliation-0.5"
        experiment_dir.mkdir()
        hydra_dir = experiment_dir / ".hydra"
        hydra_dir.mkdir()

        # Create required files
        config_data = create_sample_config_data()
        with open(hydra_dir / "config.yaml", "w") as f:
            yaml.dump(config_data, f)

        with open(experiment_dir / "input_output.json", "w") as f:
            json.dump(create_sample_input_output_data(), f)

        with open(experiment_dir / "scores.json", "w") as f:
            json.dump(create_sample_scores_data(), f)

        with open(experiment_dir / "timing.json", "w") as f:
            json.dump(create_sample_timing_data(), f)

        # Test parsing
        experiments = parse_experiments_directory(experiments_root)
        assert len(experiments) == 1
        assert experiments[0].key == "pipeline_random_llama3.3-70b_affiliation-0.5"


def test_build_manifest_from_experiments():
    """Test building manifest from experiments."""
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)
        experiments_root = temp_path / "experiments"
        experiments_root.mkdir()

        # Create a mock experiment in the correct path structure
        pipeline_dir = experiments_root / "test_pipeline"
        pipeline_dir.mkdir()
        experiment_dir = pipeline_dir / "test_experiment"
        experiment_dir.mkdir()

        # Create mock experiment data (simplified)
        from unittest.mock import Mock

        mock_input_item = Mock()
        mock_input_item.input.scenario_id = "test_scenario"
        
        mock_input_output = Mock()
        mock_input_output.data = [mock_input_item]
        
        mock_experiment = Mock()
        mock_experiment.key = "test_key"
        mock_experiment.scenario_id = "test_scenario"
        mock_experiment.experiment_path = experiment_dir
        mock_experiment.input_output = mock_input_output
        mock_experiment.config.model_dump.return_value = {"test": "config"}

        experiments = [mock_experiment]

        manifest = build_manifest_from_experiments(experiments, experiments_root)

        assert "test_key" in manifest.experiment_keys
        assert "scenarios" in manifest.experiment_keys["test_key"].dict()
        assert "test_scenario" in manifest.experiment_keys["test_key"].scenarios
        assert manifest.experiment_keys["test_key"].scenarios["test_scenario"].config == {
            "test": "config"
        }


def test_parse_real_experiments_if_available():
    """Test parsing real experiments directory if available."""
    experiments_root = get_experiments_path_or_skip()

    if not experiments_root:
        print("⏭️ Skipping real experiments test - directory not available")
        return

    experiments = parse_experiments_directory(experiments_root)
    print(f"✅ Successfully parsed {len(experiments)} real experiments")

    if experiments:
        # Test that at least one experiment was parsed correctly
        first_exp = experiments[0]
        assert first_exp.key is not None
        assert first_exp.scenario_id is not None
        assert first_exp.config.adm.name is not None
        print(f"✅ Real experiment validation passed: {first_exp.key}")


def test_experiment_summary_model():
    """Test ExperimentSummary model."""
    summary = ExperimentSummary(
        input_output="data/test/input_output.json",
        scores="data/test/scores.json", 
        timing="data/test/timing.json",
        config={"test": "config"}
    )
    
    assert summary.input_output == "data/test/input_output.json"
    assert summary.scores == "data/test/scores.json"
    assert summary.timing == "data/test/timing.json"
    assert summary.config == {"test": "config"}


def test_scenario_manifest_model():
    """Test ScenarioManifest model."""
    manifest = ScenarioManifest()
    
    # Test adding scenarios
    summary = ExperimentSummary(
        input_output="data/test/input_output.json",
        scores="data/test/scores.json",
        timing="data/test/timing.json", 
        config={"test": "config"}
    )
    
    manifest.scenarios["test_scenario"] = summary
    assert "test_scenario" in manifest.scenarios
    assert manifest.scenarios["test_scenario"] == summary


def test_global_manifest_model():
    """Test GlobalManifest model functionality."""
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)
        experiments_root = temp_path / "experiments"
        experiments_root.mkdir()
        
        # Create a complete experiment structure for testing
        pipeline_dir = experiments_root / "pipeline_test"
        pipeline_dir.mkdir()
        experiment_dir = pipeline_dir / "test_experiment"
        experiment_dir.mkdir()
        hydra_dir = experiment_dir / ".hydra"
        hydra_dir.mkdir()
        
        # Create required files
        config_data = create_sample_config_data()
        with open(hydra_dir / "config.yaml", "w") as f:
            yaml.dump(config_data, f)
            
        with open(experiment_dir / "input_output.json", "w") as f:
            json.dump(create_sample_input_output_data(), f)
            
        with open(experiment_dir / "scores.json", "w") as f:
            json.dump(create_sample_scores_data(), f)
            
        with open(experiment_dir / "timing.json", "w") as f:
            json.dump(create_sample_timing_data(), f)
        
        # Test loading experiment
        experiment = ExperimentData.from_directory(experiment_dir)
        
        # Test GlobalManifest
        manifest = GlobalManifest()
        manifest.add_experiment(experiment, experiments_root)
        
        # Test experiment count
        assert manifest.get_experiment_count() == 1
        
        # Test ADM types extraction
        adm_types = manifest.get_adm_types()
        assert "pipeline_random" in adm_types
        
        # Test LLM backbones extraction
        llm_backbones = manifest.get_llm_backbones()
        assert "llama3.3-70b" in llm_backbones
        
        # Test KDMA combinations extraction  
        kdma_combinations = manifest.get_kdma_combinations()
        assert "affiliation-0.5" in kdma_combinations
        
        # Test experiment key structure
        expected_key = "pipeline_random_llama3.3-70b_affiliation-0.5"
        assert expected_key in manifest.experiment_keys
        assert "June2025-AF-train-0" in manifest.experiment_keys[expected_key].scenarios


def test_chunked_experiment_data_model():
    """Test ChunkedExperimentData model."""
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)
        experiments_root = temp_path / "experiments"
        experiments_root.mkdir()
        
        # Create sample experiment
        pipeline_dir = experiments_root / "pipeline_test"
        pipeline_dir.mkdir()
        experiment_dir = pipeline_dir / "test_experiment"
        experiment_dir.mkdir()
        hydra_dir = experiment_dir / ".hydra"
        hydra_dir.mkdir()
        
        # Create required files
        config_data = create_sample_config_data()
        with open(hydra_dir / "config.yaml", "w") as f:
            yaml.dump(config_data, f)
            
        with open(experiment_dir / "input_output.json", "w") as f:
            json.dump(create_sample_input_output_data(), f)
            
        with open(experiment_dir / "scores.json", "w") as f:
            json.dump(create_sample_scores_data(), f)
            
        with open(experiment_dir / "timing.json", "w") as f:
            json.dump(create_sample_timing_data(), f)
        
        experiment = ExperimentData.from_directory(experiment_dir)
        
        # Test ADM chunk creation
        adm_chunk = ChunkedExperimentData.create_adm_chunk("pipeline_random", [experiment])
        assert adm_chunk.chunk_id == "adm_pipeline_random"
        assert adm_chunk.chunk_type == "by_adm"
        assert len(adm_chunk.experiments) == 1
        assert adm_chunk.metadata["adm_type"] == "pipeline_random"
        assert adm_chunk.metadata["count"] == 1
        
        # Test scenario chunk creation
        scenario_chunk = ChunkedExperimentData.create_scenario_chunk("June2025-AF-train", [experiment])
        assert scenario_chunk.chunk_id == "scenario_June2025-AF-train"
        assert scenario_chunk.chunk_type == "by_scenario"
        assert len(scenario_chunk.experiments) == 1
        assert scenario_chunk.metadata["scenario_id"] == "June2025-AF-train"
        assert scenario_chunk.metadata["count"] == 1


def test_global_manifest_serialization():
    """Test that GlobalManifest can be properly serialized to JSON."""
    manifest = GlobalManifest()
    manifest.metadata = {
        "total_experiments": 0,
        "adm_types": [],
        "llm_backbones": [],
        "kdma_combinations": [],
        "generated_at": "2024-01-01T00:00:00"
    }
    
    # Test serialization
    manifest_dict = manifest.dict()
    json_str = json.dumps(manifest_dict, indent=2)
    
    # Test deserialization
    loaded_dict = json.loads(json_str)
    loaded_manifest = GlobalManifest(**loaded_dict)
    
    assert loaded_manifest.metadata["total_experiments"] == 0
    assert loaded_manifest.metadata["generated_at"] == "2024-01-01T00:00:00"


def test_end_to_end_build_process():
    """Test the complete build process from experiments to output validation."""
    import tempfile
    import os
    import sys
    from pathlib import Path
    
    # Only run this test if we have real experiments available
    experiments_root = get_experiments_path_or_skip()
    if not experiments_root:
        print("⏭️ Skipping end-to-end build test - experiments directory not available")
        return
    
    with tempfile.TemporaryDirectory() as temp_dir:
        output_dir = Path(temp_dir) / "build_output"
        
        # Add src to path for imports
        sys.path.insert(0, '.')
        
        try:
            from build import main
            import json
            
            # Mock sys.argv for build script
            original_argv = sys.argv
            sys.argv = ['build.py', str(experiments_root), '--output-dir', str(output_dir)]
            
            # Run the build process
            main()
            
            # Restore original argv
            sys.argv = original_argv
            
            # Validate the output structure
            assert output_dir.exists(), "Output directory should exist"
            assert (output_dir / "manifest.json").exists(), "Manifest file should exist"
            assert (output_dir / "index.html").exists(), "Index HTML should exist"
            assert (output_dir / "data").exists(), "Data directory should exist"
            assert (output_dir / "css").exists(), "CSS directory should exist"
            assert (output_dir / "js").exists(), "JS directory should exist"
            
            # Load and validate manifest
            with open(output_dir / "manifest.json") as f:
                manifest_data = json.load(f)
            
            # Validate manifest structure using Pydantic
            manifest = GlobalManifest(**manifest_data)
            
            # Basic validation
            assert manifest.get_experiment_count() > 0, "Should have parsed some experiments"
            assert len(manifest.get_adm_types()) > 0, "Should have identified ADM types"
            assert manifest.metadata["generated_at"] is not None, "Should have generation timestamp"
            
            # Validate that experiment files exist
            first_key = list(manifest.experiment_keys.keys())[0]
            first_scenario = list(manifest.experiment_keys[first_key].scenarios.keys())[0]
            experiment_summary = manifest.experiment_keys[first_key].scenarios[first_scenario]
            
            # Check that referenced files actually exist
            input_output_path = output_dir / experiment_summary.input_output
            scores_path = output_dir / experiment_summary.scores
            timing_path = output_dir / experiment_summary.timing
            
            assert input_output_path.exists(), f"Input/output file should exist: {input_output_path}"
            assert scores_path.exists(), f"Scores file should exist: {scores_path}"
            assert timing_path.exists(), f"Timing file should exist: {timing_path}"
            
            # Validate JSON files are valid
            with open(input_output_path) as f:
                input_output_data = json.load(f)
                assert isinstance(input_output_data, list), "Input/output should be a list"
                assert len(input_output_data) > 0, "Input/output should have data"
            
            with open(scores_path) as f:
                scores_data = json.load(f)
                assert isinstance(scores_data, list), "Scores should be a list"
            
            with open(timing_path) as f:
                timing_data = json.load(f)
                assert "scenarios" in timing_data, "Timing should have scenarios"
            
            print(f"✅ End-to-end build test passed with {manifest.get_experiment_count()} experiments")
            print(f"✅ Found {len(manifest.get_adm_types())} ADM types: {', '.join(manifest.get_adm_types()[:3])}...")
            print(f"✅ Found {len(manifest.get_llm_backbones())} LLM backbones: {', '.join(manifest.get_llm_backbones()[:3])}...")
            
        except Exception as e:
            print(f"❌ End-to-end build test failed: {e}")
            raise


def run_all_tests():
    """Run all tests."""
    tests = [
        test_kdma_value_model,
        test_adm_config_model,
        test_adm_config_no_llm,
        test_experiment_config_key_generation,
        test_input_output_file_model,
        test_scores_file_model,
        test_experiment_data_from_directory,
        test_has_required_files,
        test_parse_experiments_directory,
        test_build_manifest_from_experiments,
        test_experiment_summary_model,
        test_scenario_manifest_model,
        test_global_manifest_model,
        test_chunked_experiment_data_model,
        test_global_manifest_serialization,
        test_end_to_end_build_process,
        test_parse_real_experiments_if_available,
    ]

    passed = 0
    failed = 0

    for test in tests:
        try:
            test()
            print(f"✓ {test.__name__}")
            passed += 1
        except Exception as e:
            print(f"✗ {test.__name__}: {e}")
            failed += 1

    print(f"\nResults: {passed} passed, {failed} failed")
    return failed == 0


if __name__ == "__main__":
    success = run_all_tests()
    exit(0 if success else 1)
