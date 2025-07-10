#!/usr/bin/env python3
"""
Shared pytest fixtures for frontend testing.
"""

import json
import tempfile
import subprocess
import threading
import time
import yaml
import http.server
import socketserver
from pathlib import Path
from contextlib import contextmanager
import pytest
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
                time.sleep(0.5)

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

            # Create input/output data as single object (what Pydantic expects)
            input_output = {
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

            with open(experiment_dir / "input_output.json", "w") as f:
                json.dump(input_output, f, indent=2)

            # Create scores file as single object (what Pydantic expects)
            scores = {
                "test_score": 0.85 + (i * 0.05),
                "scenario_id": config["scenario"],
            }

            with open(experiment_dir / "scores.json", "w") as f:
                json.dump(scores, f, indent=2)

            # Create timing file as single object (what Pydantic expects)
            timing = {
                "probe_time": 1234 + (i * 100),
                "scenario_id": config["scenario"],
            }

            with open(experiment_dir / "timing.json", "w") as f:
                json.dump(timing, f, indent=2)

        return experiments_root


@pytest.fixture(scope="session")
def built_frontend():
    """Use the existing built frontend for all tests."""
    # Use the existing dist directory that's already built
    project_root = Path(__file__).parent.parent
    dist_dir = project_root / "dist"

    # Ensure the dist directory exists and has the required files
    if not dist_dir.exists() or not (dist_dir / "manifest.json").exists():
        # Build the frontend if it doesn't exist
        cmd = ["uv", "run", "align-browser", "../experiments", "--dev", "--build-only"]
        result = subprocess.run(
            cmd, capture_output=True, text=True, cwd=str(project_root)
        )

        if result.returncode != 0:
            pytest.fail(f"Frontend build failed: {result.stderr}")

    yield dist_dir


@pytest.fixture(scope="session")
def test_server(built_frontend):
    """Provide a running test server."""
    server = FrontendTestServer(built_frontend, port=0)  # Use any available port
    with server.run() as base_url:
        yield base_url


@pytest.fixture(scope="session")
def browser_context():
    """Provide a browser context."""
    with sync_playwright() as p:
        browser = p.chromium.launch()
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
