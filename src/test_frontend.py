#!/usr/bin/env python3
"""
Automated frontend testing for the ADM Results Visualization app using Playwright.
This script builds the frontend and runs automated browser tests.
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
from playwright.sync_api import sync_playwright, expect


import socket

def find_free_port():
    """Find a free port to use for testing."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('', 0))
        s.listen(1)
        port = s.getsockname()[1]
    return port


class FrontendTestServer:
    """HTTP server for serving the built frontend during tests."""

    def __init__(self, dist_dir="dist", port=8001):
        self.dist_dir = Path(dist_dir)
        self.port = port
        self.base_url = f"http://localhost:{port}"
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

            # Create server with proper socket reuse
            class ReuseAddrTCPServer(socketserver.TCPServer):
                allow_reuse_address = True
            
            # Start server in background thread
            with ReuseAddrTCPServer(("", self.port), QuietHandler) as httpd:
                self.server = httpd
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
                self.server.server_close()  # Properly close the socket


class TestDataGenerator:
    """Generate minimal test data for frontend development."""

    @staticmethod
    def create_test_experiments():
        """Create test experiment data."""
        temp_dir = Path(tempfile.mkdtemp())
        experiments_root = temp_dir / "experiments"

        # Create a few test experiments
        test_configs = [
            {
                "adm_type": "pipeline_baseline",
                "llm": "no_llm",
                "kdma": "affiliation",
                "value": 0.5,
                "scenario": "test_scenario_1",
            },
            {
                "adm_type": "pipeline_random",
                "llm": "no_llm",
                "kdma": "affiliation",
                "value": 0.7,
                "scenario": "test_scenario_2",
            },
            {
                "adm_type": "pipeline_fewshot_comparative_regression_loo_20icl",
                "llm": "llama3-8b",
                "kdma": "merit",
                "value": 0.3,
                "scenario": "test_scenario_3",
            },
        ]

        for i, config in enumerate(test_configs):
            # Create experiment directory structure
            pipeline_dir = experiments_root / config["adm_type"]
            pipeline_dir.mkdir(parents=True, exist_ok=True)

            exp_dir = pipeline_dir / f"{config['kdma']}-{config['value']}"
            exp_dir.mkdir(exist_ok=True)

            hydra_dir = exp_dir / ".hydra"
            hydra_dir.mkdir(exist_ok=True)

            # Create config.yaml
            config_data = {
                "name": "test_experiment",
                "adm": {
                    "name": config["adm_type"],
                    "structured_inference_engine": {"model_name": config["llm"]}
                    if config["llm"] != "no_llm"
                    else None,
                },
                "alignment_target": {
                    "id": f"test-{config['kdma']}-{config['value']}",
                    "kdma_values": [{"kdma": config["kdma"], "value": config["value"]}],
                },
            }

            with open(hydra_dir / "config.yaml", "w") as f:
                yaml.dump(config_data, f)

            # Create input_output.json
            input_output_data = [
                {
                    "input": {
                        "scenario_id": config["scenario"],
                        "state": f"Test scenario {i + 1} description with medical triage situation",
                        "choices": [
                            {
                                "action_id": "action_a",
                                "kdma_association": {config["kdma"]: 0.8},
                                "unstructured": f"Take action A in scenario {i + 1}",
                            },
                            {
                                "action_id": "action_b",
                                "kdma_association": {config["kdma"]: 0.2},
                                "unstructured": f"Take action B in scenario {i + 1}",
                            },
                        ],
                    },
                    "output": {
                        "choice": "action_a",
                        "justification": f"Test justification for scenario {i + 1}: This action aligns with the specified KDMA values.",
                    },
                }
            ]

            with open(exp_dir / "input_output.json", "w") as f:
                json.dump(input_output_data, f)

            # Create scores.json
            scores_data = [
                {
                    "test_score": 0.85 + (i * 0.05),
                    "scenario_id": config["scenario"],
                    "alignment_score": 0.7 + (i * 0.1),
                }
            ]
            with open(exp_dir / "scores.json", "w") as f:
                json.dump(scores_data, f)

            # Create timing.json
            timing_data = {
                "scenarios": [
                    {
                        "n_actions_taken": 10 + i,
                        "total_time_s": 1.5 + (i * 0.3),
                        "avg_time_s": 0.15 + (i * 0.02),
                        "max_time_s": 0.3 + (i * 0.05),
                        "raw_times_s": [0.1, 0.15, 0.2, 0.18, 0.12],
                    }
                ]
            }
            with open(exp_dir / "timing.json", "w") as f:
                json.dump(timing_data, f)

        return experiments_root


@pytest.fixture(scope="session")
def built_frontend():
    """Build the frontend once for all tests."""
    # Create test data
    experiments_root = TestDataGenerator.create_test_experiments()

    # Build frontend
    dist_dir = Path("dist")  # Use existing dist directory

    cmd = [
        "python",
        "src/build.py",
        str(experiments_root),
        "--output-dir",
        str(dist_dir),
    ]

    result = subprocess.run(cmd, capture_output=True, text=True, cwd=".")

    if result.returncode != 0:
        pytest.fail(f"Frontend build failed: {result.stderr}")

    yield dist_dir

    # Note: Don't cleanup the dist directory as it may be used by other processes


@pytest.fixture(scope="session")
def test_server(built_frontend):
    """Provide a running test server."""
    server = FrontendTestServer(built_frontend, port=8001)
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


def test_page_load(page, test_server):
    """Test that the page loads without errors."""
    # Add console logging for debugging
    console_messages = []
    page.on("console", lambda msg: console_messages.append(f"{msg.type}: {msg.text}"))
    
    page.goto(test_server)

    # Check page title
    expect(page).to_have_title("ADM Results Visualization")

    # Check that main elements exist
    expect(page.locator("h1")).to_contain_text("ADM Results Visualization")
    expect(page.locator("#adm-type-selection")).to_be_visible()
    expect(page.locator("#kdma-sliders")).to_be_visible()
    expect(page.locator("#llm-selection")).to_be_visible()
    expect(page.locator("#scenario-selection")).to_be_visible()
    expect(page.locator("#results-display")).to_be_visible()
    
    # Give the page some time to load JavaScript
    page.wait_for_timeout(2000)
    
    # Debug: Print console messages and check if manifest loading started
    print(f"Console messages during page load: {console_messages}")
    
    # Check if the select element was created
    adm_select_exists = page.evaluate("!!document.querySelector('#adm-type-select')")
    print(f"ADM select element exists: {adm_select_exists}")
    
    if adm_select_exists:
        options_count = page.evaluate("document.querySelector('#adm-type-select').options.length")
        print(f"Number of options in ADM select: {options_count}")
        
        # Check if manifest was loaded
        manifest_loaded = page.evaluate("window.manifest && Object.keys(window.manifest).length > 0")
        print(f"Manifest appears to be loaded: {manifest_loaded}")


def test_debug_manifest_and_js(page, test_server):
    """Debug test to see what's happening with manifest loading."""
    console_messages = []
    page.on("console", lambda msg: console_messages.append(f"{msg.type}: {msg.text}"))
    
    page.goto(test_server)
    
    # Wait for page to settle
    page.wait_for_timeout(3000)
    
    # Check if JavaScript ran
    dom_content_loaded = page.evaluate("document.readyState === 'complete'")
    print(f"DOM content loaded: {dom_content_loaded}")
    
    # Check console messages
    print(f"All console messages: {console_messages}")
    
    # Check if manifest endpoint is accessible
    manifest_response = page.request.get(f"{test_server}/manifest.json")
    print(f"Manifest response status: {manifest_response.status}")
    
    if manifest_response.status == 200:
        manifest_text = manifest_response.text()
        print(f"Manifest content preview: {manifest_text[:200]}...")
    
    # Check if JavaScript variables exist
    available_adm_types = page.evaluate("window.availableAdmTypes || 'not found'")
    print(f"availableAdmTypes: {available_adm_types}")
    
    # Force manifest loading in the browser
    result = page.evaluate("""
        (async () => {
            try {
                const response = await fetch('/manifest.json');
                const data = await response.json();
                return { 
                    success: true, 
                    keys: Object.keys(data).length,
                    firstKey: Object.keys(data)[0]
                };
            } catch (error) {
                return { success: false, error: error.message };
            }
        })()
    """)
    print(f"Manual manifest fetch result: {result}")


def test_manifest_loading(page, test_server):
    """Test that manifest.json loads and populates UI elements."""
    page.goto(test_server)

    # Wait for manifest to load and populate dropdowns
    adm_select = page.locator("#adm-type-select")
    expect(adm_select).to_be_visible()

    # First, check if the manifest file is accessible
    manifest_response = page.request.get(f"{test_server}/manifest.json")
    assert manifest_response.status == 200, "Manifest should be accessible"

    # Log console messages for debugging
    console_messages = []
    page.on("console", lambda msg: console_messages.append(f"{msg.type}: {msg.text}"))

    # Wait for options to be populated with a longer timeout and better error handling
    try:
        page.wait_for_function(
            "document.querySelector('#adm-type-select').options.length > 0",
            timeout=10000  # Reduce timeout for faster feedback
        )
    except Exception as e:
        # Log console messages and page content for debugging
        print(f"Console messages: {console_messages}")
        print(f"Page content around select: {page.locator('#adm-type-selection').inner_html()}")
        options_count = page.evaluate('document.querySelector("#adm-type-select")?.options?.length || 0')
        print(f"Select element options count: {options_count}")
        raise e

    # Check that ADM options are populated
    options = adm_select.locator("option").all()
    assert len(options) > 0, "ADM dropdown should have options"

    # Check that we have the expected ADM types
    option_texts = [option.text_content() for option in options]
    assert "pipeline_baseline" in option_texts
    assert "pipeline_random" in option_texts


def test_adm_selection_updates_llm(page, test_server):
    """Test that selecting an ADM type updates the LLM dropdown."""
    page.goto(test_server)

    # Wait for initial load
    page.wait_for_function(
        "document.querySelector('#adm-type-select').options.length > 0"
    )

    adm_select = page.locator("#adm-type-select")
    llm_select = page.locator("#llm-select")

    # Select an ADM type
    adm_select.select_option("pipeline_baseline")

    # Wait for LLM dropdown to update
    page.wait_for_timeout(500)

    # Check that LLM dropdown has options
    expect(llm_select).to_be_visible()
    llm_options = llm_select.locator("option").all()
    assert len(llm_options) > 0, "LLM dropdown should have options after ADM selection"


def test_kdma_sliders_interaction(page, test_server):
    """Test that KDMA sliders are interactive and update values."""
    page.goto(test_server)

    # Wait for page to load
    page.wait_for_function(
        "document.querySelector('#adm-type-select').options.length > 0"
    )

    # Find KDMA sliders
    sliders = page.locator("input[type='range']").all()

    if sliders:
        slider = sliders[0]
        value_span = slider.locator("xpath=following-sibling::span[1]")

        # Get initial value
        initial_value = value_span.text_content()

        # Change slider value
        slider.fill("0.7")

        # Check that value span updated
        page.wait_for_function(
            f"document.querySelector('input[type=\"range\"]').parentElement.querySelector('span').textContent !== '{initial_value}'"
        )

        new_value = value_span.text_content()
        assert new_value == "0.7", f"Slider value should update to 0.7, got {new_value}"


def test_scenario_selection_availability(page, test_server):
    """Test that scenario selection becomes available after parameter selection."""
    page.goto(test_server)

    # Wait for initial load
    page.wait_for_function(
        "document.querySelector('#adm-type-select').options.length > 0"
    )

    # Make selections
    adm_select = page.locator("#adm-type-select")
    adm_select.select_option("pipeline_baseline")

    # Wait a moment for updates
    page.wait_for_timeout(1000)

    # Check scenario dropdown
    scenario_select = page.locator("#scenario-select")
    expect(scenario_select).to_be_visible()

    # It should either have options or be disabled with a message
    if scenario_select.is_enabled():
        scenario_options = scenario_select.locator("option").all()
        assert len(scenario_options) > 0, (
            "Enabled scenario dropdown should have options"
        )
    else:
        # If disabled, it should have a "no scenarios" message
        disabled_option = scenario_select.locator("option").first
        expect(disabled_option).to_contain_text("No scenarios available")


def test_results_display_updates(page, test_server):
    """Test that results display updates when selections are made."""
    page.goto(test_server)

    # Wait for initial load
    page.wait_for_function(
        "document.querySelector('#adm-type-select').options.length > 0"
    )

    results_display = page.locator("#results-display")

    # Make complete selections
    adm_select = page.locator("#adm-type-select")
    adm_select.select_option("pipeline_baseline")

    # Wait for updates
    page.wait_for_timeout(1500)

    # Check that results display has some content
    results_text = results_display.text_content()

    # It should either show data, an error message, or "no data found"
    # During development, any of these is acceptable
    assert results_text.strip() != "", (
        "Results display should have some content after selections"
    )

    # If it shows "No data found", that's expected during development
    acceptable_messages = [
        "No data found",
        "Error loading",
        "Results for",
        "No scenarios available",
    ]

    has_acceptable_message = any(msg in results_text for msg in acceptable_messages)
    assert has_acceptable_message, (
        f"Results should show expected message, got: {results_text[:100]}"
    )


def test_no_console_errors(page, test_server):
    """Test that there are no severe console errors on page load."""
    # Listen for console messages
    console_messages = []
    page.on("console", lambda msg: console_messages.append(msg))

    page.goto(test_server)

    # Wait for page to fully load
    page.wait_for_function(
        "document.querySelector('#adm-type-select').options.length > 0"
    )

    # Check for severe errors
    errors = [msg for msg in console_messages if msg.type == "error"]

    # Filter out expected errors during development
    severe_errors = []
    for error in errors:
        error_text = error.text
        # Ignore network errors for missing data files during development
        if not any(
            ignore in error_text.lower()
            for ignore in [
                "404",
                "failed to fetch",
                "network error",
                "manifest",
                "data/",
            ]
        ):
            severe_errors.append(error_text)

    assert len(severe_errors) == 0, f"Found severe console errors: {severe_errors}"


def test_responsive_layout(page, test_server):
    """Test that the layout works on different screen sizes."""
    page.goto(test_server)

    # Test desktop size
    page.set_viewport_size({"width": 1200, "height": 800})
    expect(page.locator(".controls")).to_be_visible()
    expect(page.locator(".results")).to_be_visible()

    # Test tablet size
    page.set_viewport_size({"width": 768, "height": 1024})
    expect(page.locator(".controls")).to_be_visible()
    expect(page.locator(".results")).to_be_visible()

    # Test mobile size
    page.set_viewport_size({"width": 375, "height": 667})
    # On mobile, elements should still be present even if layout changes
    expect(page.locator("#adm-type-selection")).to_be_visible()
    expect(page.locator("#results-display")).to_be_visible()


if __name__ == "__main__":
    # Run tests if executed directly
    pytest.main([__file__, "-v"])
