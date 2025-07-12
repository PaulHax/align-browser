#!/usr/bin/env python3
"""
Shared pytest fixtures for frontend testing.
"""

import json
import tempfile
import threading
import time
import yaml
import http.server
import socketserver
from pathlib import Path
from contextlib import contextmanager
import pytest
import filelock
from playwright.sync_api import sync_playwright


class FrontendTestServer:
    """HTTP server for serving the built frontend during tests."""

    def __init__(self, dist_dir="dist", port=0):
        self.dist_dir = Path(dist_dir)
        self.port = port
        self.actual_port = None
        self.base_url = None
        self.server = None
        self.server_thread = None

    @contextmanager
    def run(self):
        """Context manager for running the test server."""

        class QuietHandler(http.server.SimpleHTTPRequestHandler):
            def log_message(self, format, *args):
                pass  # Suppress logging

        original_cwd = Path.cwd()

        try:
            # Change to dist directory
            if self.dist_dir.exists():
                import os

                os.chdir(self.dist_dir)

            # Start server in background thread
            class ReusableTCPServer(socketserver.TCPServer):
                allow_reuse_address = True

            with ReusableTCPServer(("", self.port), QuietHandler) as httpd:
                self.server = httpd
                self.actual_port = httpd.server_address[1]
                self.base_url = f"http://localhost:{self.actual_port}"

                self.server_thread = threading.Thread(
                    target=httpd.serve_forever, daemon=True
                )
                self.server_thread.start()

                # Wait for server to be ready
                time.sleep(0.1)  # Reduced from 0.5

                yield self.base_url

        finally:
            # Restore original directory
            import os

            os.chdir(original_cwd)

            if self.server:
                self.server.shutdown()


class TestDataGenerator:
    """Generate minimal test data for frontend development."""

    @staticmethod
    def create_test_experiments():
        """Create test experiment data."""
        temp_dir = Path(tempfile.mkdtemp())
        experiments_root = temp_dir / "experiments"

        # Create realistic test experiments that match manifest structure
        test_configs = [
            # pipeline_baseline with Mistral (supports multiple KDMAs)
            {
                "adm_type": "pipeline_baseline",
                "llm": "mistralai/Mistral-7B-Instruct-v0.3",
                "kdmas": [
                    {"kdma": "affiliation", "value": 0.5},
                    {"kdma": "merit", "value": 0.7},
                ],
                "scenario": "test_scenario_1",
            },
            # Single KDMA experiments for test_scenario_1 (to support individual KDMA selection)
            {
                "adm_type": "pipeline_baseline",
                "llm": "mistralai/Mistral-7B-Instruct-v0.3",
                "kdmas": [{"kdma": "personal_safety", "value": 0.8}],
                "scenario": "test_scenario_1",
            },
            # Different scenario experiments
            {
                "adm_type": "pipeline_baseline",
                "llm": "mistralai/Mistral-7B-Instruct-v0.3",
                "kdmas": [{"kdma": "personal_safety", "value": 0.3}],
                "scenario": "test_scenario_2",
            },
            # Add pipeline_random experiments for scenario filtering tests
            {
                "adm_type": "pipeline_random",
                "llm": "no_llm",
                "kdmas": [],
                "scenario": "test_scenario_5",
            },
        ]

        for i, config in enumerate(test_configs):
            # Create pipeline directory structure
            pipeline_dir = experiments_root / config["adm_type"]
            pipeline_dir.mkdir(parents=True, exist_ok=True)

            # Create experiment directory with KDMA values in name
            kdma_parts = [f"{kdma['kdma']}-{kdma['value']}" for kdma in config["kdmas"]]
            exp_name = "_".join(kdma_parts) if kdma_parts else "no_kdma"
            experiment_dir = pipeline_dir / exp_name
            experiment_dir.mkdir(exist_ok=True)

            # Create .hydra directory and config.yaml
            hydra_dir = experiment_dir / ".hydra"
            hydra_dir.mkdir(exist_ok=True)

            # Create hydra config.yaml (this is what the parser expects)
            hydra_config = {
                "name": "test_experiment",
                "adm": {"name": config["adm_type"]},
                "alignment_target": {
                    "id": f"test-{i}",
                    "kdma_values": config["kdmas"],
                },
            }

            # Add LLM config if not no_llm
            if config["llm"] != "no_llm":
                hydra_config["adm"]["structured_inference_engine"] = {
                    "model_name": config["llm"]
                }

            with open(hydra_dir / "config.yaml", "w") as f:
                yaml.dump(hydra_config, f)

            # Create input/output data as array (what the parser expects)
            input_output = [
                {
                    "input": {
                        "scenario_id": config["scenario"],
                        "state": f"Test scenario {config['scenario']} with medical triage situation",
                        "choices": [
                            {
                                "action_id": "action_a",
                                "kdma_association": {
                                    kdma["kdma"]: 0.8 for kdma in config["kdmas"]
                                }
                                if config["kdmas"]
                                else {},
                                "unstructured": f"Take action A in {config['scenario']} - apply treatment",
                            },
                            {
                                "action_id": "action_b",
                                "kdma_association": {
                                    kdma["kdma"]: 0.2 for kdma in config["kdmas"]
                                }
                                if config["kdmas"]
                                else {},
                                "unstructured": f"Take action B in {config['scenario']} - tag and evacuate",
                            },
                        ],
                    },
                    "output": {
                        "choice": "action_a",
                        "justification": f"Test justification for {config['scenario']}: This action aligns with the specified KDMA values.",
                    },
                }
            ]

            with open(experiment_dir / "input_output.json", "w") as f:
                json.dump(input_output, f, indent=2)

            # Create scores file as array (what the parser expects)
            scores = [
                {
                    "test_score": 0.85 + (i * 0.05),
                    "scenario_id": config["scenario"],
                }
            ]

            with open(experiment_dir / "scores.json", "w") as f:
                json.dump(scores, f, indent=2)

            # Create timing file with scenarios structure (what the parser expects)
            timing = {
                "scenarios": [
                    {
                        "scenario_id": config["scenario"],
                        "n_actions_taken": 10 + i,
                        "total_time_s": 1234.5 + (i * 100),
                        "avg_time_s": 123.4 + (i * 10),
                        "max_time_s": 200.0 + (i * 20),
                        "raw_times_s": [100.0 + (i * 5), 150.0 + (i * 7)],
                    }
                ]
            }

            with open(experiment_dir / "timing.json", "w") as f:
                json.dump(timing, f, indent=2)

        return experiments_root


@pytest.fixture(scope="session")
def frontend_with_test_data():
    """Prepare frontend static directory with generated test data."""
    project_root = Path(__file__).parent.parent

    # Use align_browser/static as the base directory (dev mode)
    frontend_dir = project_root / "align_browser" / "static"

    # Use a file lock to prevent parallel test workers from conflicting
    lock_file = project_root / ".test_data.lock"
    lock = filelock.FileLock(lock_file, timeout=30)

    with lock:
        # Check if data already exists (from another worker)
        data_dir = frontend_dir / "data"
        if not data_dir.exists():
            # Generate test experiment directory
            test_experiments_root = TestDataGenerator.create_test_experiments()

            # Use the build system to generate data
            from .build import build_frontend

            build_frontend(
                experiments_root=test_experiments_root,
                output_dir=frontend_dir,
                dev_mode=True,
                build_only=True,
            )

    yield frontend_dir

    # Don't cleanup in parallel mode - let the last worker handle it


@pytest.fixture(scope="session")
def frontend_with_real_data():
    """Prepare frontend static directory with real experiment data."""
    project_root = Path(__file__).parent.parent

    # Use align_browser/static as the base directory (dev mode)
    frontend_dir = project_root / "align_browser" / "static"

    # Check if real experiment data exists
    real_experiments_root = project_root / "experiment-data" / "phase2_june"
    if not real_experiments_root.exists():
        pytest.skip(f"Real experiment data not found at {real_experiments_root}")

    # Use the build system to generate data with real experiments
    from .build import build_frontend

    build_frontend(
        experiments_root=real_experiments_root,
        output_dir=frontend_dir,
        dev_mode=True,
        build_only=True,
    )

    yield frontend_dir

    # Cleanup: remove the data directory we created
    import shutil

    data_dir = frontend_dir / "data"
    if data_dir.exists():
        shutil.rmtree(data_dir)


@pytest.fixture(scope="session")
def test_server(frontend_with_test_data):
    """Provide a running test server with generated test data."""
    server = FrontendTestServer(
        frontend_with_test_data, port=0
    )  # Use any available port
    with server.run() as base_url:
        yield base_url


@pytest.fixture(scope="session")
def real_data_test_server(frontend_with_real_data):
    """Provide a running test server with real experiment data."""
    server = FrontendTestServer(
        frontend_with_real_data, port=0
    )  # Use any available port
    with server.run() as base_url:
        yield base_url


@pytest.fixture(scope="session")
def browser_context():
    """Provide a browser context."""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)  # Use headless mode for speed
        context = browser.new_context()
        yield context
        context.close()
        browser.close()


@pytest.fixture
def page(browser_context):
    """Provide a browser page."""
    page = browser_context.new_page()
    yield page
    page.close()
