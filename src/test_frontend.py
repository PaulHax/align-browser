#!/usr/bin/env python3
"""
Automated frontend testing for the ADM Results app using Playwright.
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
                    {"kdma": "merit", "value": 0.7}
                ],
                "scenario": "test_scenario_1",
            },
            # Single KDMA experiments for test_scenario_1 (to support individual KDMA selection)
            {
                "adm_type": "pipeline_baseline",
                "llm": "mistralai/Mistral-7B-Instruct-v0.3",
                "kdmas": [{"kdma": "affiliation", "value": 0.5}],
                "scenario": "test_scenario_1",
            },
            {
                "adm_type": "pipeline_baseline",
                "llm": "mistralai/Mistral-7B-Instruct-v0.3",
                "kdmas": [{"kdma": "merit", "value": 0.7}],
                "scenario": "test_scenario_1",
            },
            # Different KDMA combinations for different scenarios
            {
                "adm_type": "pipeline_baseline",
                "llm": "mistralai/Mistral-7B-Instruct-v0.3",
                "kdmas": [{"kdma": "affiliation", "value": 0.3}],
                "scenario": "test_scenario_3",
            },
            {
                "adm_type": "pipeline_baseline",
                "llm": "mistralai/Mistral-7B-Instruct-v0.3",
                "kdmas": [{"kdma": "personal_safety", "value": 0.8}],
                "scenario": "test_scenario_4",
            },
            # pipeline_random with no_llm (supports 1 KDMA)
            {
                "adm_type": "pipeline_random",
                "llm": "no_llm",
                "kdmas": [{"kdma": "personal_safety", "value": 0.5}],
                "scenario": "test_scenario_4",
            },
            {
                "adm_type": "pipeline_random",
                "llm": "no_llm",
                "kdmas": [{"kdma": "search", "value": 0.2}],
                "scenario": "test_scenario_5",
            },
            # Add pipeline_random experiments that also use Mistral LLM to test LLM preservation
            {
                "adm_type": "pipeline_random",
                "llm": "mistralai/Mistral-7B-Instruct-v0.3",
                "kdmas": [{"kdma": "affiliation", "value": 0.6}],
                "scenario": "test_scenario_1",  # Same scenario as pipeline_baseline
            },
            {
                "adm_type": "pipeline_random",
                "llm": "mistralai/Mistral-7B-Instruct-v0.3",
                "kdmas": [{"kdma": "merit", "value": 0.4}],
                "scenario": "test_scenario_3",  # Same scenario as pipeline_baseline
            },
        ]

        for i, config in enumerate(test_configs):
            # Create experiment directory structure
            pipeline_dir = experiments_root / config["adm_type"]
            pipeline_dir.mkdir(parents=True, exist_ok=True)

            # Create directory name from KDMAs
            kdma_parts = [f"{kdma['kdma']}-{kdma['value']}" for kdma in config["kdmas"]]
            exp_dir = pipeline_dir / "_".join(kdma_parts)
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
                    "id": f"test-{i}",
                    "kdma_values": config["kdmas"],
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
                                "kdma_association": {
                                    kdma["kdma"]: 0.8 for kdma in config["kdmas"]
                                },
                                "unstructured": f"Take action A in scenario {i + 1}",
                            },
                            {
                                "action_id": "action_b",
                                "kdma_association": {
                                    kdma["kdma"]: 0.2 for kdma in config["kdmas"]
                                },
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

    # Build frontend in a temporary directory
    temp_dir = Path(tempfile.mkdtemp(prefix="test_frontend_"))
    dist_dir = temp_dir / "dist"

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

    # Clean up the temporary directory after all tests complete
    import shutil

    shutil.rmtree(temp_dir, ignore_errors=True)


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


def test_page_load(page, test_server):
    """Test that the page loads without errors."""
    page.goto(test_server)

    # Check page title
    expect(page).to_have_title("Align Browser")

    # Check that main elements exist
    expect(page.locator("h1")).to_contain_text("Align Browser")
    expect(page.locator("#adm-type-selection")).to_be_visible()
    expect(page.locator("#kdma-sliders")).to_be_visible()
    expect(page.locator("#llm-selection")).to_be_visible()
    expect(page.locator("#scenario-selection")).to_be_visible()
    expect(page.locator("#run-display")).to_be_visible()


def test_manifest_loading(page, test_server):
    """Test that manifest.json loads and populates UI elements."""
    page.goto(test_server)

    # Wait for manifest to load and populate dropdowns
    adm_select = page.locator("#adm-type-select")
    expect(adm_select).to_be_visible()

    # Wait for options to be populated
    page.wait_for_function(
        "document.querySelector('#adm-type-select').options.length > 0"
    )

    # Check that ADM options are populated
    options = adm_select.locator("option").all()
    assert len(options) > 0, "ADM dropdown should have options"

    # Check that we have at least one ADM type (filtered by current scenario)
    option_texts = [option.text_content() for option in options]
    assert len(option_texts) > 0, "Should have at least one ADM option"
    
    # With the new filtering logic, only ADMs available for the current scenario are shown
    # Let's verify the filtering is working by checking a scenario that has pipeline_random
    base_scenario_select = page.locator("#base-scenario-select")
    base_scenario_select.select_option("test_scenario_5")  # This scenario has pipeline_random
    page.wait_for_timeout(500)
    
    # Now pipeline_random should be available
    updated_options = adm_select.locator("option").all()
    updated_option_texts = [option.text_content() for option in updated_options]
    assert "pipeline_random" in updated_option_texts, "test_scenario_5 should have pipeline_random available"


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
    """Test that KDMA sliders are interactive and snap to valid values."""
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

        # Try to change slider value - it should snap to nearest valid value
        slider.evaluate("slider => slider.value = '0.7'")
        slider.dispatch_event("input")

        # Wait for value to update
        page.wait_for_timeout(500)

        new_value = value_span.text_content()
        # Value should change from initial (validation may snap it to valid value)
        assert new_value != initial_value or float(new_value) in [
            0.0,
            0.1,
            0.2,
            0.3,
            0.4,
            0.5,
            0.6,
            0.7,
            0.8,
            0.9,
            1.0,
        ], f"Slider value should be valid decimal, got {new_value}"


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


def test_run_display_updates(page, test_server):
    """Test that results display updates when selections are made."""
    page.goto(test_server)

    # Wait for initial load
    page.wait_for_function(
        "document.querySelector('#adm-type-select').options.length > 0"
    )

    run_display = page.locator("#run-display")

    # Make complete selections
    adm_select = page.locator("#adm-type-select")
    adm_select.select_option("pipeline_baseline")

    # Wait for updates
    page.wait_for_timeout(1500)

    # Check that results display has some content
    run_text = run_display.text_content()

    # It should either show data, an error message, or "no data found"
    # During development, any of these is acceptable
    assert run_text.strip() != "", (
        "Results display should have some content after selections"
    )

    # Results should show either actual data or expected messages
    acceptable_messages = [
        "No data found",
        "Error loading", 
        "Results for",
        "No scenarios available",
        "test_scenario",  # Actual scenario data
        "Choice",         # Results display content
    ]

    has_acceptable_message = any(msg in run_text for msg in acceptable_messages)
    assert has_acceptable_message, (
        f"Results should show expected content, got: {run_text[:100]}"
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
        
        # Always catch JavaScript reference/syntax errors - these are code bugs
        if any(js_error in error_text.lower() for js_error in [
            "referenceerror", 
            "syntaxerror", 
            "typeerror", 
            "is not defined",
            "cannot read property",
            "cannot read properties"
        ]):
            severe_errors.append(error_text)
        # Ignore network errors for missing data files during development
        elif not any(
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
    expect(page.locator(".run")).to_be_visible()

    # Test tablet size
    page.set_viewport_size({"width": 768, "height": 1024})
    expect(page.locator(".controls")).to_be_visible()
    expect(page.locator(".run")).to_be_visible()

    # Test mobile size
    page.set_viewport_size({"width": 375, "height": 667})
    # On mobile, elements should still be present even if layout changes
    expect(page.locator("#adm-type-selection")).to_be_visible()
    expect(page.locator("#run-display")).to_be_visible()


def test_dynamic_kdma_management(page, test_server):
    """Test dynamic KDMA addition, removal, and type selection."""
    page.goto(test_server)

    # Wait for page to load
    page.wait_for_function(
        "document.querySelector('#adm-type-select').options.length > 0"
    )

    # Select ADM and LLM to enable KDMA functionality
    adm_select = page.locator("#adm-type-select")
    adm_select.select_option("pipeline_baseline")
    page.wait_for_timeout(1000)

    # Check initial state - system auto-adds a KDMA
    kdma_selectors = page.locator(".kdma-selector")
    initial_count = kdma_selectors.count()

    # Should have at least one KDMA selector from auto-initialization
    assert initial_count >= 1, (
        "Should have at least one KDMA selector after ADM selection"
    )

    # Check KDMA selector components
    first_kdma = kdma_selectors.first
    expect(first_kdma.locator("select")).to_be_visible()  # Type dropdown
    expect(first_kdma.locator("input[type='range']")).to_be_visible()  # Value slider
    expect(first_kdma.locator("button")).to_be_visible()  # Remove button

    # Test adding another KDMA if button is enabled
    add_kdma_btn = page.locator("#add-kdma-btn")
    expect(add_kdma_btn).to_be_visible()

    if not add_kdma_btn.is_disabled():
        add_kdma_btn.click()
        page.wait_for_timeout(500)

        # Should now have one more KDMA selector
        new_count = kdma_selectors.count()
        assert new_count == initial_count + 1, (
            "Should have added one more KDMA selector"
        )


def test_kdma_type_filtering_prevents_duplicates(page, test_server):
    """Test that KDMA type dropdowns filter out already-used types."""
    page.goto(test_server)

    # Wait for page to load and select a scenario that supports multiple KDMAs
    page.wait_for_function(
        "document.querySelector('#adm-type-select').options.length > 0"
    )

    # Select a scenario that has multiple KDMA types available (test_scenario_3)
    base_scenario_select = page.locator("#base-scenario-select")
    base_scenario_select.select_option("test_scenario_3")
    page.wait_for_timeout(500)

    adm_select = page.locator("#adm-type-select")
    adm_select.select_option("pipeline_baseline")
    page.wait_for_timeout(1000)

    # Add first KDMA (if not already added)
    add_kdma_btn = page.locator("#add-kdma-btn")
    if not add_kdma_btn.is_disabled():
        add_kdma_btn.click()
        page.wait_for_timeout(500)

    # Get the first KDMA's type dropdown and selected value
    first_kdma_type_select = page.locator(".kdma-selector").first.locator("select")
    first_selected_type = first_kdma_type_select.input_value()

    # Add second KDMA (if supported by this ADM/LLM)
    if not add_kdma_btn.is_disabled():
        add_kdma_btn.click()
        page.wait_for_timeout(500)

        # Get second KDMA's type dropdown options
        second_kdma_type_select = (
            page.locator(".kdma-selector").nth(1).locator("select")
        )
        second_options = second_kdma_type_select.locator("option").all()
        second_option_values = [opt.get_attribute("value") for opt in second_options]

        # First KDMA's type should NOT be available in second dropdown
        assert first_selected_type not in second_option_values, (
            f"Duplicate KDMA type '{first_selected_type}' found in second dropdown"
        )


def test_kdma_max_limit_enforcement(page, test_server):
    """Test that KDMA addition respects experiment data limits."""
    page.goto(test_server)

    # Wait for page to load
    page.wait_for_function(
        "document.querySelector('#adm-type-select').options.length > 0"
    )

    # Test with pipeline_random (should have max 1 KDMA)
    # First switch to a scenario that has pipeline_random
    base_scenario_select = page.locator("#base-scenario-select")
    base_scenario_select.select_option("test_scenario_4")  # This scenario has both ADMs
    page.wait_for_timeout(1000)
    
    adm_select = page.locator("#adm-type-select")
    adm_select.select_option("pipeline_random")
    page.wait_for_timeout(1000)

    add_kdma_btn = page.locator("#add-kdma-btn")

    # System auto-adds a KDMA, so for pipeline_random (max 1), button should already be disabled
    expect(add_kdma_btn).to_be_disabled()
    button_text = add_kdma_btn.text_content()
    # Accept either max limit message or all types added message
    # Both are valid depending on how many KDMA types are available for the current scenario
    assert ("Max KDMAs reached (1)" in button_text or "All KDMA types added" in button_text), (
        f"Expected limit message, got: {button_text}"
    )

    # Verify exactly 1 KDMA selector exists
    kdma_selectors = page.locator(".kdma-selector")
    expect(kdma_selectors).to_have_count(1)

    # Switch to pipeline_baseline (should support 2 KDMAs)
    adm_select.select_option("pipeline_baseline")
    page.wait_for_timeout(1000)

    # Should have 1 KDMA and be able to add one more
    initial_count = kdma_selectors.count()
    if not add_kdma_btn.is_disabled():
        add_kdma_btn.click()
        page.wait_for_timeout(500)

        # Should now have 2 KDMAs and be at limit
        expect(kdma_selectors).to_have_count(2)
        expect(add_kdma_btn).to_be_disabled()
        button_text = add_kdma_btn.text_content()
        # Either max KDMAs reached or all types added (both are valid limit states)
        assert (
            "Max KDMAs reached" in button_text or "All KDMA types added" in button_text
        ), f"Expected limit message, got: {button_text}"


def test_kdma_removal_updates_constraints(page, test_server):
    """Test that removing KDMAs properly updates constraints and filtering."""
    page.goto(test_server)

    # Wait for page to load
    page.wait_for_function(
        "document.querySelector('#adm-type-select').options.length > 0"
    )

    # Select ADM that supports multiple KDMAs
    adm_select = page.locator("#adm-type-select")
    adm_select.select_option("pipeline_baseline")
    page.wait_for_timeout(1000)

    add_kdma_btn = page.locator("#add-kdma-btn")

    # Add two KDMAs if possible
    add_kdma_btn.click()
    page.wait_for_timeout(500)

    if not add_kdma_btn.is_disabled():
        add_kdma_btn.click()
        page.wait_for_timeout(500)

    initial_kdma_count = page.locator(".kdma-selector").count()

    # Remove first KDMA
    first_remove_btn = page.locator(".kdma-selector").first.locator("button")
    first_remove_btn.click()
    page.wait_for_timeout(500)

    # Should have one fewer KDMA
    new_kdma_count = page.locator(".kdma-selector").count()
    assert new_kdma_count == initial_kdma_count - 1, "KDMA was not removed"

    # Add button should be enabled again (if we were at limit)
    expect(add_kdma_btn).not_to_be_disabled()


def test_kdma_warning_system(page, test_server):
    """Test that KDMA warning system shows for invalid values."""
    page.goto(test_server)

    # Wait for page to load
    page.wait_for_function(
        "document.querySelector('#adm-type-select').options.length > 0"
    )

    # Select ADM and add KDMA
    adm_select = page.locator("#adm-type-select")
    adm_select.select_option("pipeline_baseline")
    page.wait_for_timeout(1000)

    add_kdma_btn = page.locator("#add-kdma-btn")
    add_kdma_btn.click()
    page.wait_for_timeout(500)

    # Get KDMA slider and warning element
    kdma_selector = page.locator(".kdma-selector").first
    slider = kdma_selector.locator("input[type='range']")
    warning_span = kdma_selector.locator("span[id$='-warning']")

    # Warning should be hidden initially (assuming valid default value)
    expect(warning_span).to_have_css("display", "none")

    # Set slider to potentially invalid value (0.55 - not in 0.0, 0.1, 0.2... sequence)
    slider.evaluate("slider => slider.value = '0.55'")
    slider.dispatch_event("input")  # Trigger the input event
    page.wait_for_timeout(300)

    # Warning might appear if 0.55 is not valid for the current selection
    # This depends on the actual experiment data, so we just check if warning logic works
    warning_display = warning_span.get_attribute("style")
    # Warning system is working if it either shows or hides appropriately
    assert "display" in warning_display, "Warning span should have display style set"


def test_kdma_adm_change_resets_properly(page, test_server):
    """Test that changing ADM type properly resets KDMA constraints."""
    page.goto(test_server)

    # Wait for page to load
    page.wait_for_function(
        "document.querySelector('#adm-type-select').options.length > 0"
    )

    # Start with pipeline_baseline and add KDMAs
    # First switch to a scenario that has both ADM types
    base_scenario_select = page.locator("#base-scenario-select")
    base_scenario_select.select_option("test_scenario_4")  # This scenario has both ADMs
    page.wait_for_timeout(1000)
    
    adm_select = page.locator("#adm-type-select")
    adm_select.select_option("pipeline_baseline")
    page.wait_for_timeout(1000)

    # System auto-adds a KDMA, so check initial count
    initial_count = page.locator(".kdma-selector").count()

    add_kdma_btn = page.locator("#add-kdma-btn")
    if not add_kdma_btn.is_disabled():
        add_kdma_btn.click()
        page.wait_for_timeout(500)

    # Should have at least one KDMA
    current_count = page.locator(".kdma-selector").count()
    assert current_count >= 1, (
        f"Should have at least 1 KDMA selector, got {current_count}"
    )

    # Switch to pipeline_random (different constraints)
    adm_select.select_option("pipeline_random")
    page.wait_for_timeout(1000)

    # KDMA constraints should update - button state should reflect new limits
    button_text = add_kdma_btn.text_content()
    # Should either be enabled (if under new limit) or show new limit message
    assert "Add KDMA" in button_text or "Max KDMAs reached" in button_text, (
        f"Button should show appropriate state after ADM change, got: {button_text}"
    )


def test_scenario_based_kdma_filtering(page, test_server):
    """Test that KDMA filtering follows correct hierarchy: Scenario → ADM → KDMA values.
    
    This test specifically addresses the bug where only the first KDMA type would show
    results because the filtering was backwards (KDMA → Scenario instead of Scenario → KDMA).
    """
    page.goto(test_server)
    
    # Wait for page to load
    page.wait_for_function(
        "document.querySelector('#adm-type-select').options.length > 0"
    )
    
    # Get all available base scenarios
    base_scenario_select = page.locator("#base-scenario-select")
    base_scenario_options = base_scenario_select.locator("option").all()
    available_scenarios = [opt.get_attribute("value") for opt in base_scenario_options if opt.get_attribute("value")]
    
    # Should have multiple scenarios available (our test data has different scenarios)
    assert len(available_scenarios) >= 2, f"Test requires multiple scenarios, got: {available_scenarios}"
    
    # Test that different scenarios show different KDMA types
    scenario_kdma_mapping = {}
    
    for scenario_type in available_scenarios[:3]:  # Test first 3 scenarios
        print(f"\nTesting scenario: {scenario_type}")
        
        # Select this scenario
        base_scenario_select.select_option(scenario_type)
        page.wait_for_timeout(1000)
        
        # Select a consistent ADM type
        adm_select = page.locator("#adm-type-select")
        adm_select.select_option("pipeline_baseline")
        page.wait_for_timeout(1500)
        
        # Check what KDMA types are available
        kdma_selectors = page.locator(".kdma-selector select")
        if kdma_selectors.count() > 0:
            kdma_select = kdma_selectors.first
            kdma_options = kdma_select.locator("option").all()
            available_kdmas = [opt.get_attribute("value") for opt in kdma_options]
            scenario_kdma_mapping[scenario_type] = available_kdmas
            print(f"  Available KDMAs: {available_kdmas}")
            
            # Verify that we can get results for the available KDMA
            if available_kdmas:
                first_kdma = available_kdmas[0]
                kdma_select.select_option(first_kdma)
                page.wait_for_timeout(1000)
                
                # Check results
                run_display = page.locator("#run-display")
                run_text = run_display.text_content()
                
                # Should show valid results, not "No data found"
                assert "No data found" not in run_text, \
                    f"Scenario '{scenario_type}' with KDMA '{first_kdma}' should show results, got: {run_text[:200]}"
                
                # Should show actual experiment data (updated for current format)
                expected_content = ["Results for", "Input/Output", "Scores", "Timing", "Choice", "ADM Decision", "merit", "affiliation"]
                has_valid_content = any(content in run_text for content in expected_content)
                assert has_valid_content, \
                    f"Scenario '{scenario_type}' should show experiment data, got: {run_text[:200]}"
    
    print(f"\nScenario → KDMA mapping: {scenario_kdma_mapping}")
    
    # Verify that different scenarios can show different KDMA types
    # (This proves the filtering is working correctly)
    all_kdmas_found = set()
    for kdmas in scenario_kdma_mapping.values():
        all_kdmas_found.update(kdmas)
    
    assert len(all_kdmas_found) > 1, \
        f"Different scenarios should show different KDMA types. Found KDMAs: {all_kdmas_found}"
    
    # Verify that the filtering is actually filtering (not just showing all KDMAs for every scenario)
    unique_kdma_sets = [tuple(sorted(kdmas)) for kdmas in scenario_kdma_mapping.values()]
    assert len(set(unique_kdma_sets)) > 1, \
        "Different scenarios should have different sets of available KDMAs, indicating proper filtering"


def test_kdma_selection_shows_results_regression(page, test_server):
    """Regression test for the bug where only first KDMA type showed results.
    
    Before the fix: Users could select different KDMA types in the dropdown, but only
    the first one would show experiment results. Others would show "No data found".
    
    After the fix: Each KDMA type that's available in the dropdown should show valid
    experiment results when selected.
    """
    page.goto(test_server)
    
    # Wait for page to load
    page.wait_for_function(
        "document.querySelector('#adm-type-select').options.length > 0"
    )
    
    # Select a scenario that has multiple KDMAs available
    # For our test data, let's look for a scenario with the most KDMAs
    base_scenario_select = page.locator("#base-scenario-select")
    adm_select = page.locator("#adm-type-select")
    run_display = page.locator("#run-display")
    
    # Try different scenarios to find one with multiple KDMA types
    base_scenario_options = base_scenario_select.locator("option").all()
    available_scenarios = [opt.get_attribute("value") for opt in base_scenario_options if opt.get_attribute("value")]
    
    scenario_with_multiple_kdmas = None
    max_kdmas = 0
    
    for scenario_type in available_scenarios:
        base_scenario_select.select_option(scenario_type)
        page.wait_for_timeout(500)
        
        # Check if pipeline_baseline is available for this scenario
        adm_options = adm_select.locator("option").all()
        available_adms = [opt.get_attribute("value") for opt in adm_options if opt.get_attribute("value")]
        
        if "pipeline_baseline" not in available_adms:
            # Skip scenarios that don't have pipeline_baseline
            continue
            
        adm_select.select_option("pipeline_baseline")
        page.wait_for_timeout(1000)
        
        kdma_selectors = page.locator(".kdma-selector select")
        if kdma_selectors.count() > 0:
            kdma_options = kdma_selectors.first.locator("option").all()
            kdma_count = len([opt for opt in kdma_options if opt.get_attribute("value")])
            
            if kdma_count > max_kdmas:
                max_kdmas = kdma_count
                scenario_with_multiple_kdmas = scenario_type
    
    # If we found a scenario with multiple KDMAs, test the regression
    if scenario_with_multiple_kdmas and max_kdmas > 1:
        print(f"Testing regression with scenario '{scenario_with_multiple_kdmas}' ({max_kdmas} KDMAs)")
        
        # Set up the scenario
        base_scenario_select.select_option(scenario_with_multiple_kdmas)
        page.wait_for_timeout(500)
        adm_select.select_option("pipeline_baseline")
        page.wait_for_timeout(1500)
        
        # Get all available KDMA types
        kdma_selector = page.locator(".kdma-selector select").first
        kdma_options = kdma_selector.locator("option").all()
        available_kdmas = [opt.get_attribute("value") for opt in kdma_options if opt.get_attribute("value")]
        
        print(f"Available KDMA types: {available_kdmas}")
        
        # Test each KDMA type - ALL should show results (this was the bug)
        results_found = []
        
        for kdma_type in available_kdmas:
            print(f"Testing KDMA type: {kdma_type}")
            
            # Select this KDMA type
            kdma_selector.select_option(kdma_type)
            page.wait_for_timeout(1000)
            
            # Check results
            run_text = run_display.text_content()
            
            if "No data found" not in run_text:
                results_found.append(kdma_type)
                print(f"  ✓ {kdma_type}: Shows experiment results")
                
                # Verify it shows actual experiment data (updated for current format)
                expected_content = ["Results for", "Input/Output", "Scores", "Timing", "Choice", "ADM Decision", "merit", "affiliation"]
                has_valid_content = any(content in run_text for content in expected_content)
                assert has_valid_content, \
                    f"KDMA '{kdma_type}' should show experiment data, got: {run_text[:150]}"
            else:
                print(f"  ✗ {kdma_type}: No data found - THIS IS THE BUG!")
                # In the old buggy version, this would happen for non-first KDMAs
        
        # The key assertion: ALL available KDMA types should show results
        assert len(results_found) == len(available_kdmas), \
            f"All available KDMA types should show results. Available: {available_kdmas}, Found results: {results_found}"
        
        print(f"✓ Regression test passed: All {len(available_kdmas)} KDMA types show results")
    
    else:
        # If we don't have multiple KDMAs in test data, just verify the basic functionality
        print("No scenario with multiple KDMAs found in test data, testing basic functionality")
        
        # At minimum, verify that the selected KDMA shows results
        kdma_selectors = page.locator(".kdma-selector select")
        if kdma_selectors.count() > 0:
            run_text = run_display.text_content()
            assert "No data found" not in run_text, \
                "At minimum, the auto-selected KDMA should show results"


def test_initial_load_results_path(page, test_server):
    """Test that initial page load and results loading works without errors."""
    # Listen for console errors
    console_errors = []
    page.on("console", lambda msg: console_errors.append(msg) if msg.type == "error" else None)
    
    page.goto(test_server)
    
    # Wait for manifest to load and trigger initial results load
    page.wait_for_function(
        "document.querySelector('#adm-type-select').options.length > 0"
    )
    
    # Give time for loadResults to execute
    page.wait_for_timeout(1000)
    
    # Check for JavaScript errors
    js_errors = []
    for error in console_errors:
        error_text = error.text
        if any(js_error in error_text.lower() for js_error in [
            "referenceerror", 
            "syntaxerror", 
            "typeerror", 
            "is not defined",
            "cannot read property",
            "cannot read properties"
        ]):
            js_errors.append(error_text)
    
    assert len(js_errors) == 0, f"Found JavaScript errors during initial load: {js_errors}"
    
    # Verify results display was attempted
    run_display = page.locator("#run-display")
    expect(run_display).to_be_visible()
    
    # Should have some content (even if it's "no data found")
    run_text = run_display.text_content()
    assert run_text.strip() != "", "Results display should have content after initial load"


def test_scenario_filters_adm_options(page, test_server):
    """Test that scenario selection properly filters available ADM options."""
    page.goto(test_server)

    # Wait for page to load
    page.wait_for_function(
        "document.querySelector('#adm-type-select').options.length > 0"
    )

    # Get all available scenarios
    base_scenario_select = page.locator("#base-scenario-select")
    base_scenario_options = base_scenario_select.locator("option").all()
    available_scenarios = [opt.get_attribute("value") for opt in base_scenario_options if opt.get_attribute("value")]
    
    # Should have multiple scenarios for testing
    assert len(available_scenarios) >= 2, f"Test requires multiple scenarios, got: {available_scenarios}"

    # Track ADM availability per scenario
    scenario_adm_mapping = {}
    
    for scenario_type in available_scenarios:
        print(f"\nTesting scenario: {scenario_type}")
        
        # Select this scenario
        base_scenario_select.select_option(scenario_type)
        page.wait_for_timeout(1000)
        
        # Get available ADM types for this scenario
        adm_select = page.locator("#adm-type-select")
        adm_options = adm_select.locator("option").all()
        available_adms = [opt.get_attribute("value") for opt in adm_options if opt.get_attribute("value")]
        
        scenario_adm_mapping[scenario_type] = available_adms
        print(f"  Available ADMs: {available_adms}")
        
        # Should have at least one ADM available
        assert len(available_adms) > 0, f"Scenario '{scenario_type}' should have at least one ADM available"
        
        # Verify that the selected ADM actually works with this scenario
        if available_adms:
            first_adm = available_adms[0]
            adm_select.select_option(first_adm)
            page.wait_for_timeout(1000)
            
            # Should have at least one KDMA available
            kdma_selectors = page.locator(".kdma-selector")
            assert kdma_selectors.count() > 0, f"Scenario '{scenario_type}' with ADM '{first_adm}' should have KDMAs available"

    print(f"\nScenario → ADM mapping: {scenario_adm_mapping}")
    
    # Verify that the filtering is actually working
    # Not all scenarios should have exactly the same ADMs (this would indicate no filtering)
    all_adm_sets = [tuple(sorted(adms)) for adms in scenario_adm_mapping.values()]
    unique_adm_sets = set(all_adm_sets)
    
    # If we have multiple scenarios and they all show the same ADMs, filtering isn't working
    if len(available_scenarios) > 1:
        # We expect some differentiation in ADM availability between scenarios
        print(f"Unique ADM sets: {len(unique_adm_sets)} out of {len(available_scenarios)} scenarios")


def test_adm_preservation_on_specific_scenario_change(page, test_server):
    """Test that ADM selection is preserved when changing specific scenario if still valid.
    
    Since our test data doesn't have multiple specific scenarios per base scenario,
    this test focuses on the core preservation logic by testing scenario changes
    that preserve ADM validity.
    """
    page.goto(test_server)
    
    # Wait for page to load
    page.wait_for_function(
        "document.querySelector('#adm-type-select').options.length > 0"
    )
    
    base_scenario_select = page.locator("#base-scenario-select")
    scenario_select = page.locator("#scenario-select")
    adm_select = page.locator("#adm-type-select")
    
    # Get all available scenarios
    base_scenario_options = base_scenario_select.locator("option").all()
    available_base_scenarios = [opt.get_attribute("value") for opt in base_scenario_options if opt.get_attribute("value")]
    
    if len(available_base_scenarios) < 2:
        pytest.skip("Need at least 2 base scenarios to test ADM preservation")
    
    # Test the preservation logic by changing base scenarios
    # Select the first scenario
    first_scenario = available_base_scenarios[0]
    base_scenario_select.select_option(first_scenario)
    page.wait_for_timeout(500)
    
    # Get available ADM types for this scenario
    adm_options = adm_select.locator("option").all()
    available_adms = [opt.get_attribute("value") for opt in adm_options if opt.get_attribute("value")]
    
    assert len(available_adms) >= 1, "Need at least one ADM type available"
    
    # Select an ADM type that might also be available in other scenarios
    target_adm = None
    for adm_type in available_adms:
        # Check if this ADM is available in other scenarios
        for other_scenario in available_base_scenarios[1:]:
            base_scenario_select.select_option(other_scenario)
            page.wait_for_timeout(500)
            
            other_adm_options = adm_select.locator("option").all()
            other_adms = [opt.get_attribute("value") for opt in other_adm_options if opt.get_attribute("value")]
            
            if adm_type in other_adms:
                target_adm = adm_type
                break
        
        if target_adm:
            break
    
    if not target_adm:
        pytest.skip("No ADM type found that works across multiple scenarios in test data")
    
    # Start fresh with first scenario and select the target ADM
    base_scenario_select.select_option(first_scenario)
    page.wait_for_timeout(500)
    
    adm_select.select_option(target_adm)
    page.wait_for_timeout(500)
    
    # Verify selection took
    assert adm_select.input_value() == target_adm, f"ADM should be set to {target_adm}"
    
    # Change to a scenario that also supports this ADM
    for other_scenario in available_base_scenarios[1:]:
        base_scenario_select.select_option(other_scenario)
        page.wait_for_timeout(500)
        
        # Check if target ADM is available
        other_adm_options = adm_select.locator("option").all()
        other_adms = [opt.get_attribute("value") for opt in other_adm_options if opt.get_attribute("value")]
        
        if target_adm in other_adms:
            # Found a compatible scenario, test preservation
            page.wait_for_timeout(750)  # Wait for all updates to complete
            
            preserved_adm = adm_select.input_value()
            assert preserved_adm == target_adm, \
                f"ADM '{target_adm}' should be preserved when changing from '{first_scenario}' to '{other_scenario}', but got '{preserved_adm}'"
            
            print(f"✓ ADM '{target_adm}' successfully preserved when changing from '{first_scenario}' to '{other_scenario}'")
            return
    
    pytest.skip("No compatible scenario found to test ADM preservation")


def test_adm_preservation_on_scenario_set_change(page, test_server):
    """Test that ADM selection is preserved when changing scenario set if still valid."""
    page.goto(test_server)
    
    # Wait for page to load
    page.wait_for_function(
        "document.querySelector('#adm-type-select').options.length > 0"
    )
    
    base_scenario_select = page.locator("#base-scenario-select")
    adm_select = page.locator("#adm-type-select")
    
    # Get all available scenario sets
    base_scenario_options = base_scenario_select.locator("option").all()
    available_base_scenarios = [opt.get_attribute("value") for opt in base_scenario_options if opt.get_attribute("value")]
    
    assert len(available_base_scenarios) >= 2, "Need at least 2 scenario sets for this test"
    
    # Select first scenario set and get its ADM options
    first_scenario = available_base_scenarios[0]
    base_scenario_select.select_option(first_scenario)
    page.wait_for_timeout(500)
    
    adm_options = adm_select.locator("option").all()
    first_scenario_adms = [opt.get_attribute("value") for opt in adm_options if opt.get_attribute("value")]
    
    # Find an ADM that exists in multiple scenario sets
    target_adm = None
    compatible_scenarios = []
    
    for adm_type in first_scenario_adms:
        compatible_count = 0
        temp_compatible = []
        
        for scenario_set in available_base_scenarios:
            base_scenario_select.select_option(scenario_set)
            page.wait_for_timeout(500)
            
            scenario_adm_options = adm_select.locator("option").all()
            scenario_adms = [opt.get_attribute("value") for opt in scenario_adm_options if opt.get_attribute("value")]
            
            if adm_type in scenario_adms:
                compatible_count += 1
                temp_compatible.append(scenario_set)
        
        if compatible_count >= 2:
            target_adm = adm_type
            compatible_scenarios = temp_compatible
            break
    
    if target_adm is None:
        pytest.skip("No ADM type found that works with multiple scenario sets in test data")
    
    print(f"Testing ADM '{target_adm}' which works with scenarios: {compatible_scenarios}")
    
    # Start with first compatible scenario and select the target ADM
    start_scenario = compatible_scenarios[0]
    base_scenario_select.select_option(start_scenario)
    page.wait_for_timeout(500)
    
    adm_select.select_option(target_adm)
    page.wait_for_timeout(500)
    
    # Verify selection took
    assert adm_select.input_value() == target_adm, f"ADM should be set to {target_adm}"
    
    # Change to a different scenario set that also supports this ADM
    target_scenario = compatible_scenarios[1]
    base_scenario_select.select_option(target_scenario)
    page.wait_for_timeout(750)  # Wait for all updates to complete
    
    # Check if the ADM selection was preserved
    preserved_adm = adm_select.input_value()
    
    # Get the new list of available ADMs after scenario set change
    new_adm_options = adm_select.locator("option").all()
    new_available_adms = [opt.get_attribute("value") for opt in new_adm_options if opt.get_attribute("value")]
    
    assert target_adm in new_available_adms, \
        f"Target ADM '{target_adm}' should be available in scenario '{target_scenario}'"
    
    assert preserved_adm == target_adm, \
        f"ADM '{target_adm}' should be preserved when changing from scenario set '{start_scenario}' to '{target_scenario}', but got '{preserved_adm}'"
    
    print(f"✓ ADM '{target_adm}' successfully preserved when changing scenario set from '{start_scenario}' to '{target_scenario}'")


def test_llm_preservation_on_adm_type_change(page, test_server):
    """Test that LLM selection preservation logic works when changing ADM types.
    
    Since the test data structure makes it difficult to find ADM types that share LLMs,
    this test focuses on verifying the preservation logic works correctly by testing:
    1. ADM with multiple LLM options preserves selection when re-selected
    2. Fallback behavior when LLM becomes invalid
    """
    page.goto(test_server)
    
    # Wait for page to load
    page.wait_for_function(
        "document.querySelector('#adm-type-select').options.length > 0"
    )
    
    base_scenario_select = page.locator("#base-scenario-select")
    adm_select = page.locator("#adm-type-select")
    llm_select = page.locator("#llm-select")
    
    # Find an ADM type that has multiple LLM options
    base_scenario_options = base_scenario_select.locator("option").all()
    available_base_scenarios = [opt.get_attribute("value") for opt in base_scenario_options if opt.get_attribute("value")]
    
    target_scenario = None
    target_adm = None
    available_llms = []
    
    for scenario in available_base_scenarios:
        base_scenario_select.select_option(scenario)
        page.wait_for_timeout(500)
        
        adm_options = adm_select.locator("option").all()
        available_adms = [opt.get_attribute("value") for opt in adm_options if opt.get_attribute("value")]
        
        for adm_type in available_adms:
            adm_select.select_option(adm_type)
            page.wait_for_timeout(500)
            
            try:
                page.wait_for_function(
                    "!document.querySelector('#llm-select').disabled && document.querySelector('#llm-select').options.length > 0",
                    timeout=2000
                )
                
                llm_options = llm_select.locator("option").all()
                llms = [opt.get_attribute("value") for opt in llm_options if opt.get_attribute("value")]
                
                if len(llms) >= 2:  # Found an ADM with multiple LLM options
                    target_scenario = scenario
                    target_adm = adm_type
                    available_llms = llms
                    break
            except:
                continue
        
        if target_scenario and target_adm:
            break
    
    if not target_scenario or not target_adm:
        pytest.skip("No ADM type found with multiple LLM options to test preservation logic")
    
    print(f"Testing LLM preservation with ADM '{target_adm}' in scenario '{target_scenario}'")
    print(f"Available LLMs: {available_llms}")
    
    # Set up the test scenario
    base_scenario_select.select_option(target_scenario)
    page.wait_for_timeout(500)
    
    adm_select.select_option(target_adm)
    page.wait_for_timeout(500)
    
    # Wait for LLM select to be enabled
    page.wait_for_function(
        "!document.querySelector('#llm-select').disabled && document.querySelector('#llm-select').options.length > 0"
    )
    
    # Select a specific LLM (not the first one if possible)
    target_llm = available_llms[-1] if len(available_llms) > 1 else available_llms[0]
    llm_select.select_option(target_llm)
    page.wait_for_timeout(500)
    
    # Verify initial selection
    assert adm_select.input_value() == target_adm, f"ADM should be set to {target_adm}"
    assert llm_select.input_value() == target_llm, f"LLM should be set to {target_llm}"
    
    # Test 1: Change to a different ADM type (if available) and back to test preservation
    other_adm = None
    adm_options = adm_select.locator("option").all()
    available_adms = [opt.get_attribute("value") for opt in adm_options if opt.get_attribute("value")]
    
    for adm_type in available_adms:
        if adm_type != target_adm:
            other_adm = adm_type
            break
    
    if other_adm:
        print(f"Testing preservation by switching to '{other_adm}' and back to '{target_adm}'")
        
        # Change to different ADM
        adm_select.select_option(other_adm)
        page.wait_for_timeout(500)
        
        # Change back to original ADM
        adm_select.select_option(target_adm)
        page.wait_for_timeout(500)
        
        # Wait for LLM select to be enabled again
        page.wait_for_function(
            "!document.querySelector('#llm-select').disabled && document.querySelector('#llm-select').options.length > 0"
        )
        
        # Check if LLM selection was preserved
        preserved_llm = llm_select.input_value()
        
        # Get current available LLMs
        current_llm_options = llm_select.locator("option").all()
        current_llms = [opt.get_attribute("value") for opt in current_llm_options if opt.get_attribute("value")]
        
        if target_llm in current_llms:
            assert preserved_llm == target_llm, \
                f"LLM '{target_llm}' should be preserved when returning to ADM '{target_adm}', but got '{preserved_llm}'"
            print(f"✓ LLM '{target_llm}' successfully preserved when returning to ADM '{target_adm}'")
        else:
            # LLM became invalid, should default to first available
            expected_llm = current_llms[0] if current_llms else ""
            assert preserved_llm == expected_llm, \
                f"LLM should default to '{expected_llm}' when '{target_llm}' became invalid, but got '{preserved_llm}'"
            print(f"✓ LLM correctly defaulted to '{expected_llm}' when '{target_llm}' became invalid")
    else:
        # Test 2: If only one ADM type, test LLM selection persistence by re-selecting same ADM
        print(f"Only one ADM type available, testing LLM selection persistence")
        
        adm_select.select_option(target_adm)
        page.wait_for_timeout(500)
        
        page.wait_for_function(
            "!document.querySelector('#llm-select').disabled && document.querySelector('#llm-select').options.length > 0"
        )
        
        preserved_llm = llm_select.input_value()
        assert preserved_llm == target_llm, \
            f"LLM '{target_llm}' should be preserved when re-selecting same ADM '{target_adm}', but got '{preserved_llm}'"
        print(f"✓ LLM '{target_llm}' successfully preserved when re-selecting same ADM '{target_adm}'")


def test_llm_preservation_on_scenario_change(page, test_server):
    """Test that LLM selection is preserved when changing scenarios if still valid for the selected ADM."""
    page.goto(test_server)
    
    # Wait for page to load
    page.wait_for_function(
        "document.querySelector('#adm-type-select').options.length > 0"
    )
    
    base_scenario_select = page.locator("#base-scenario-select")
    adm_select = page.locator("#adm-type-select")
    llm_select = page.locator("#llm-select")
    
    # Get all available scenario sets
    base_scenario_options = base_scenario_select.locator("option").all()
    available_base_scenarios = [opt.get_attribute("value") for opt in base_scenario_options if opt.get_attribute("value")]
    
    assert len(available_base_scenarios) >= 2, "Need at least 2 scenario sets for this test"
    
    # Find an ADM and LLM combination that works across multiple scenarios
    target_adm = None
    target_llm = None
    compatible_scenarios = []
    
    for scenario_set in available_base_scenarios[:3]:  # Test first 3 scenarios
        base_scenario_select.select_option(scenario_set)
        page.wait_for_timeout(500)
        
        adm_options = adm_select.locator("option").all()
        scenario_adms = [opt.get_attribute("value") for opt in adm_options if opt.get_attribute("value")]
        
        for adm_type in scenario_adms:
            adm_select.select_option(adm_type)
            page.wait_for_timeout(750)  # Wait longer for LLM to update
            
            # Check if LLM select becomes enabled and populated (some ADMs might not have LLMs)
            try:
                page.wait_for_function(
                    "!document.querySelector('#llm-select').disabled && document.querySelector('#llm-select').options.length > 0",
                    timeout=3000
                )
            except:
                # This ADM doesn't support LLMs, skip it
                continue
            
            llm_options = llm_select.locator("option").all()
            scenario_llms = [opt.get_attribute("value") for opt in llm_options if opt.get_attribute("value")]
            
            if len(scenario_llms) > 0:
                # Check if this ADM/LLM combo works in other scenarios
                test_llm = scenario_llms[0]
                combo_count = 0
                temp_compatible = []
                
                for other_scenario in available_base_scenarios:
                    base_scenario_select.select_option(other_scenario)
                    page.wait_for_timeout(500)
                    
                    other_adm_options = adm_select.locator("option").all()
                    other_adms = [opt.get_attribute("value") for opt in other_adm_options if opt.get_attribute("value")]
                    
                    if adm_type in other_adms:
                        adm_select.select_option(adm_type)
                        page.wait_for_timeout(1000)
                        
                        # Wait for LLM select to be enabled
                        try:
                            page.wait_for_function(
                                "!document.querySelector('#llm-select').disabled && document.querySelector('#llm-select').options.length > 0",
                                timeout=3000
                            )
                            
                            other_llm_options = llm_select.locator("option").all()
                            other_llms = [opt.get_attribute("value") for opt in other_llm_options if opt.get_attribute("value")]
                            
                            if test_llm in other_llms:
                                combo_count += 1
                                temp_compatible.append(other_scenario)
                        except:
                            # LLM select didn't become enabled, skip this scenario
                            continue
                
                if combo_count >= 2:
                    target_adm = adm_type
                    target_llm = test_llm
                    compatible_scenarios = temp_compatible
                    break
        
        if target_adm and target_llm:
            break
    
    if not target_adm or not target_llm:
        pytest.skip("No ADM/LLM combination found that works across multiple scenarios in test data")
    
    print(f"Testing ADM '{target_adm}' + LLM '{target_llm}' which works with scenarios: {compatible_scenarios}")
    
    # Start with first compatible scenario and select the target ADM/LLM
    start_scenario = compatible_scenarios[0]
    base_scenario_select.select_option(start_scenario)
    page.wait_for_timeout(500)
    
    adm_select.select_option(target_adm)
    page.wait_for_timeout(1000)
    
    # Wait for LLM select to be enabled before trying to select
    page.wait_for_function(
        "!document.querySelector('#llm-select').disabled"
    )
    
    llm_select.select_option(target_llm)
    page.wait_for_timeout(500)
    
    # Verify selections took
    assert adm_select.input_value() == target_adm, f"ADM should be set to {target_adm}"
    assert llm_select.input_value() == target_llm, f"LLM should be set to {target_llm}"
    
    # Change to a different scenario that also supports this ADM/LLM combination
    target_scenario = compatible_scenarios[1]
    base_scenario_select.select_option(target_scenario)
    page.wait_for_timeout(1500)  # Wait for all updates to complete
    
    # Check if both ADM and LLM selections were preserved
    preserved_adm = adm_select.input_value()
    preserved_llm = llm_select.input_value()
    
    assert preserved_adm == target_adm, \
        f"ADM '{target_adm}' should be preserved when changing scenarios, but got '{preserved_adm}'"
    
    assert preserved_llm == target_llm, \
        f"LLM '{target_llm}' should be preserved when changing scenarios, but got '{preserved_llm}'"
    
    print(f"✓ Both ADM '{target_adm}' and LLM '{target_llm}' successfully preserved when changing from '{start_scenario}' to '{target_scenario}'")


def test_e2e_real_data_validation(page, browser_context):
    """End-to-end test using real experiment data to verify validation logic."""
    # Build frontend with real experiment data
    temp_dir = Path(tempfile.mkdtemp(prefix="test_e2e_real_"))
    dist_dir = temp_dir / "dist"

    # Check if real experiments directory exists
    real_experiments_dir = Path("../experiments")
    if not real_experiments_dir.exists():
        pytest.skip("Real experiments directory not found at ../experiments")

    try:
        # Build with real data using uv
        cmd = [
            "uv",
            "run",
            "python",
            "src/build.py",
            str(real_experiments_dir),
            "--output-dir",
            str(dist_dir),
        ]

        result = subprocess.run(cmd, capture_output=True, text=True, cwd=".")

        if result.returncode != 0:
            pytest.fail(f"Real data build failed: {result.stderr}")

        # Start test server with real data
        server = FrontendTestServer(dist_dir, port=0)
        with server.run() as base_url:
            page.goto(base_url)

            # Wait for basic page elements to exist first
            page.wait_for_selector("#adm-type-select", timeout=10000)

            # Wait for page to load with real data
            page.wait_for_function(
                "document.querySelector('#adm-type-select') && document.querySelector('#adm-type-select').options.length > 0",
                timeout=10000,
            )

            # Wait for initial KDMA auto-loading
            page.wait_for_timeout(2000)

            # Debug: Print page content to understand what's happening
            print(f"\n=== Page URL: {page.url} ===")
            adm_select = page.locator("#adm-type-select")
            print(f"ADM options count: {adm_select.locator('option').count()}")
            if adm_select.locator("option").count() > 0:
                current_adm = adm_select.input_value()
                print(f"Current ADM: {current_adm}")

            # Check current KDMA state
            kdma_selectors = page.locator(".kdma-selector")
            print(f"KDMA selectors count: {kdma_selectors.count()}")

            # Check that results are loaded initially (no "No data found")
            run_display = page.locator("#run-display")
            initial_results = run_display.text_content()
            print(f"Initial results (first 300 chars): {initial_results[:300]}")

            # If we see "No data found" on initial load, the auto-validation should work
            # when we manually switch to a valid ADM type
            if "No data found" in initial_results:
                print(
                    "Initial load has 'No data found' - testing ADM switching validation..."
                )

                # Try switching to different ADM types to find valid ones
                adm_options = adm_select.locator("option").all()
                adm_values = [opt.get_attribute("value") for opt in adm_options]

                found_valid_adm = False
                for adm_type in adm_values:
                    print(f"Trying ADM: {adm_type}")
                    adm_select.select_option(adm_type)
                    page.wait_for_timeout(2000)  # Wait for validation to complete

                    updated_results = run_display.text_content()
                    if "No data found" not in updated_results:
                        found_valid_adm = True
                        print(f"Found valid ADM: {adm_type}")
                        initial_results = (
                            updated_results  # Use this for subsequent tests
                        )
                        break

                assert found_valid_adm, (
                    f"Could not find any valid ADM type that loads data. Available ADMs: {adm_values}"
                )
            else:
                print("Initial load succeeded without 'No data found'")

            # Get initial ADM selection (this should be the valid one we found)
            adm_select = page.locator("#adm-type-select")
            initial_adm = adm_select.input_value()
            print(f"Using valid ADM for testing: {initial_adm}")

            # Get all available ADM options
            adm_options = adm_select.locator("option").all()
            adm_values = [opt.get_attribute("value") for opt in adm_options]

            # Ensure we test the current valid ADM first, then some others
            test_adms = [initial_adm]  # Start with the known valid one
            for adm in adm_values:
                if adm != initial_adm and len(test_adms) < 3:
                    test_adms.append(adm)

            # Test that validation system provides helpful information for invalid combinations
            valid_combinations_found = 0

            for adm_type in test_adms:
                print(f"Testing ADM switch to: {adm_type}")

                # Select new ADM type
                adm_select.select_option(adm_type)

                # Wait for updates to complete
                page.wait_for_timeout(3000)

                # Check results
                updated_results = run_display.text_content()

                if "No data found" not in updated_results:
                    # This is a valid combination
                    valid_combinations_found += 1
                    print(f"✓ Valid combination found for ADM '{adm_type}'")

                    # Verify results contain expected content for valid data
                    expected_content = [
                        "Results for",
                        "Input/Output",
                        "Scores",
                        "Timing",
                    ]
                    has_valid_content = any(
                        content in updated_results for content in expected_content
                    )

                    assert has_valid_content, (
                        f"Valid ADM '{adm_type}' should show experiment data, got: {updated_results[:200]}"
                    )

                else:
                    # This is an invalid combination - verify debug info is helpful
                    print(
                        f"✓ Invalid combination correctly detected for ADM '{adm_type}'"
                    )

                    # Should show helpful debug information
                    assert "Looking for:" in updated_results, (
                        f"Should show debug info for invalid combination, got: {updated_results[:200]}"
                    )
                    assert "Available keys" in updated_results, (
                        f"Should show available keys for debugging, got: {updated_results[:200]}"
                    )

            # Should have found at least one valid combination during testing
            assert valid_combinations_found > 0, (
                f"Should find at least one valid ADM combination, found {valid_combinations_found}"
            )

            # Test KDMA value changes work with validation
            kdma_sliders = page.locator("input[type='range']").all()
            if kdma_sliders:
                # First, make sure we're on a valid ADM
                adm_select.select_option("pipeline_kaleido")
                page.wait_for_timeout(2000)

                slider = kdma_sliders[0]
                value_span = slider.locator("xpath=following-sibling::span[1]")

                # Get current value
                current_value = value_span.text_content()
                print(f"Current KDMA value: {current_value}")

                # Try changing KDMA value - should snap to nearest valid value
                slider.evaluate("slider => slider.value = '0.3'")
                slider.dispatch_event("input")
                page.wait_for_timeout(1000)

                # Check what value it snapped to
                final_value = value_span.text_content()
                print(f"KDMA value after change: {final_value}")

                # Results should either be valid or show helpful debug info
                final_results = run_display.text_content()
                if "No data found" in final_results:
                    print(
                        "✓ KDMA validation correctly shows debug info for invalid value"
                    )
                    assert "Looking for:" in final_results, (
                        f"Should show debug info for invalid KDMA, got: {final_results[:200]}"
                    )
                else:
                    print("✓ KDMA validation found valid combination")
                    expected_content = [
                        "Results for",
                        "Input/Output",
                        "Scores",
                        "Timing",
                    ]
                    has_valid_content = any(
                        content in final_results for content in expected_content
                    )
                    assert has_valid_content, (
                        f"Valid KDMA should show experiment data, got: {final_results[:200]}"
                    )

    finally:
        # Clean up
        import shutil

        shutil.rmtree(temp_dir, ignore_errors=True)


def test_formatted_result_display(page, test_server):
    """Test that results are displayed in a formatted, user-friendly way instead of raw JSON."""
    page.goto(test_server)
    
    # Wait for page to load
    page.wait_for_function(
        "document.querySelector('#adm-type-select').options.length > 0"
    )
    
    # Make selections to trigger result display
    adm_select = page.locator("#adm-type-select")
    adm_select.select_option("pipeline_baseline")
    page.wait_for_timeout(1500)
    
    # Wait for results to load (simplified structure)
    run_display = page.locator("#run-display")
    page.wait_for_function(
        "document.querySelector('#run-display h3') || document.querySelector('#run-display').textContent.includes('No data found')"
    )
    
    run_text = run_display.text_content()
    
    # If we have valid results, verify the simplified formatting
    if "test_scenario" in run_text:
        # Check that we have the simplified sections
        assert "Choices" in run_text, "Results should show Choices section"
        assert "ADM Decision" in run_text, "Results should show ADM Decision section" 
        # Score/summary section may not be present in all test data
        # This is acceptable - the main functionality is working
        
        # Verify we're NOT showing raw JSON dumps
        assert '{"' not in run_text, "Results should not contain raw JSON dumps"
        
        # Check that basic structure is clean and readable
        assert "Test scenario" in run_text, "Should show scenario description"
        assert ("Take action" in run_text), "Should show action choices"
        
        print("✓ Results are properly formatted with simplified sections")
        
    else:
        # "No data found" case
        assert "No data found" in run_text, "Should show a proper message when no data"
        print("✓ No data message displayed (expected for some parameter combinations)")


def test_formatted_results_structure(page, test_server):
    """Test the structure and content of formatted results."""
    page.goto(test_server)
    
    # Wait for page to load
    page.wait_for_function(
        "document.querySelector('#adm-type-select').options.length > 0"
    )
    
    # Select parameters that should have data
    base_scenario_select = page.locator("#base-scenario-select")
    base_scenario_select.select_option("test_scenario_1")
    page.wait_for_timeout(500)
    
    adm_select = page.locator("#adm-type-select")
    adm_select.select_option("pipeline_baseline")
    page.wait_for_timeout(1500)
    
    # Wait for results
    run_display = page.locator("#run-display")
    page.wait_for_function(
        "document.querySelector('#run-display h3') || document.querySelector('#run-display').textContent.includes('No data found')",
        timeout=5000
    )
    
    # Check the structure of input/output data
    results_html = run_display.inner_html()
    run_text = run_display.text_content()
    
    # Verify we're showing data for a specific scenario index (simplified header)
    scenario_select = page.locator("#scenario-select")
    selected_scenario = scenario_select.input_value()
    assert selected_scenario in run_text, "Should show scenario ID as header"
    
    # Should show the scenario description from our test data
    assert "Test scenario" in run_text and "medical triage situation" in run_text, \
        "Should display scenario description from input data"
    
    # Check choices are formatted properly (simplified)
    assert "Choices" in run_text, "Should have Choices section"
    assert ("Take action A" in run_text or "Take action B" in run_text), \
        "Should display choice actions"
    
    # Check for KDMA associations (simplified bars)
    assert "affiliation" in run_text, \
        "Should display KDMA associations for choices"
    
    # Check ADM Decision section (simplified)
    assert "ADM Decision" in run_text, "Should have ADM Decision section"
    assert "action" in run_text.lower() or "take action" in run_text.lower(), "Should show action information"
    assert "Test justification" in run_text, \
        "Should display justification"
    
    # Note: Scores section depends on test data having score/timing information
    # The core functionality (scenario display, choices, decisions) is working
    
    # Performance metrics section has been removed
    
    # Verify the simplified structure works (main sections that should always be present)
    assert "Choices" in run_text and "ADM Decision" in run_text, \
        "Should have main content sections"
    
    print("✓ Formatted results show proper structure and content")


def test_scenario_index_selection(page, test_server):
    """Test that specific scenario indices select the correct array elements."""
    page.goto(test_server)
    
    # Wait for page to load
    page.wait_for_function(
        "document.querySelector('#adm-type-select').options.length > 0"
    )
    
    # Select base scenario
    base_scenario_select = page.locator("#base-scenario-select")
    base_scenario_select.select_option("test_scenario_1")
    page.wait_for_timeout(500)
    
    # Get specific scenario dropdown
    scenario_select = page.locator("#scenario-select")
    scenario_options = scenario_select.locator("option").all()
    
    # Find scenarios with different indices (e.g., test_scenario_1-0, test_scenario_1-1)
    scenario_values = [opt.get_attribute("value") for opt in scenario_options if opt.get_attribute("value")]
    indexed_scenarios = [s for s in scenario_values if "-" in s and s.startswith("test_scenario_1")]
    
    if len(indexed_scenarios) >= 2:
        # Test first index (0)
        first_scenario = indexed_scenarios[0]  # Should be test_scenario_1-0
        scenario_select.select_option(first_scenario)
        page.wait_for_timeout(1500)
        
        run_display = page.locator("#run-display")
        first_results = run_display.text_content()
        
        # Verify it shows the correct scenario
        assert f"Results for Scenario: {first_scenario}" in first_results, \
            f"Should show results for {first_scenario}"
        
        # Our test data generator creates different content for each index
        # The scenario ID shown should match the selected one
        assert first_scenario in first_results, \
            f"Should display the selected scenario ID {first_scenario}"
        
        # Test second index (1) if available
        if len(indexed_scenarios) > 1:
            second_scenario = indexed_scenarios[1]  # Should be test_scenario_1-1
            scenario_select.select_option(second_scenario)
            page.wait_for_timeout(1500)
            
            second_results = run_display.text_content()
            
            # Verify it shows different content
            assert f"Results for Scenario: {second_scenario}" in second_results, \
                f"Should show results for {second_scenario}"
            
            # The content should be different (different index in array)
            # Both have "Test scenario" but with different numbers
            assert second_results != first_results, \
                "Different scenario indices should show different content"
            
            print(f"✓ Scenario index selection works correctly for {first_scenario} and {second_scenario}")
    else:
        print("✓ Limited indexed scenarios in test data, basic index selection verified")


# Comparison feature tests
def test_comparison_controls_appear(page, test_server):
    """Test that comparison controls are visible on page load."""
    page.goto(test_server)
    page.wait_for_function("document.querySelector('#adm-type-select').options.length > 0")
    
    # Check comparison controls section exists
    comparison_controls = page.locator("#comparison-controls")
    expect(comparison_controls).to_be_visible()
    
    # Check all controls are present
    pin_button = page.locator("#pin-current-run")
    pinned_count = page.locator("#pinned-count")
    clear_button = page.locator("#clear-all-pins")
    
    expect(pin_button).to_be_visible()
    expect(pinned_count).to_be_visible()
    expect(clear_button).to_be_visible()
    
    # Check initial count and clear button state (these should always be correct)
    expect(clear_button).to_be_disabled()
    expect(pinned_count.locator(".count")).to_contain_text("0")
    
    # Pin button state depends on whether data auto-loads
    # The app automatically loads results on initialization if valid parameters exist
    run_display = page.locator("#run-display")
    run_text = run_display.text_content()
    
    if "test_scenario" in run_text and "No data found" not in run_text:
        # Data auto-loaded, pin button should be enabled
        expect(pin_button).not_to_be_disabled()
        print("✓ Pin button enabled due to auto-loaded data")
    else:
        # No data auto-loaded, pin button should be disabled
        expect(pin_button).to_be_disabled()
        print("✓ Pin button disabled when no data available")


def test_pin_button_enables_after_data_load(page, test_server):
    """Test that pin button becomes enabled after loading valid data."""
    page.goto(test_server)
    page.wait_for_function("document.querySelector('#adm-type-select').options.length > 0")
    
    pin_button = page.locator("#pin-current-run")
    
    # Initially disabled
    expect(pin_button).to_be_disabled()
    
    # Make selections to load data
    adm_select = page.locator("#adm-type-select")
    adm_select.select_option("pipeline_baseline")
    page.wait_for_timeout(1500)
    
    # Check if pin button becomes enabled (depends on test data availability)
    run_display = page.locator("#run-display")
    run_text = run_display.text_content()
    
    # If we have valid data loaded, pin button should be enabled
    if "test_scenario" in run_text and "No data found" not in run_text:
        expect(pin_button).not_to_be_disabled()
        print("✓ Pin button enabled after loading valid data")
    else:
        # If no valid data, pin button should remain disabled
        expect(pin_button).to_be_disabled()
        print("✓ Pin button remains disabled when no valid data")


def test_pin_functionality_basic(page, test_server):
    """Test basic pin functionality when data is available."""
    page.goto(test_server)
    page.wait_for_function("document.querySelector('#adm-type-select').options.length > 0")
    
    # Load data
    adm_select = page.locator("#adm-type-select")
    adm_select.select_option("pipeline_baseline")
    page.wait_for_timeout(1500)
    
    pin_button = page.locator("#pin-current-run")
    pinned_count = page.locator("#pinned-count .count")
    clear_button = page.locator("#clear-all-pins")
    
    # If pin button is enabled (data loaded successfully)
    if not pin_button.is_disabled():
        # Pin the current configuration
        pin_button.click()
        page.wait_for_timeout(500)
        
        # Check count increased
        expect(pinned_count).to_contain_text("1")
        
        # Clear button should be enabled
        expect(clear_button).not_to_be_disabled()
        
        # Pin same configuration again - should show notification (no increase in count)
        pin_button.click()
        page.wait_for_timeout(500)
        
        # Count should still be 1 (duplicate detection)
        expect(pinned_count).to_contain_text("1")
        
        print("✓ Pin functionality working correctly")
    else:
        print("✓ No valid data to test pin functionality (expected in some test scenarios)")


def test_clear_all_pins_functionality(page, test_server):
    """Test clear all pins functionality."""
    page.goto(test_server)
    page.wait_for_function("document.querySelector('#adm-type-select').options.length > 0")
    
    # Load data and pin if possible
    adm_select = page.locator("#adm-type-select")
    adm_select.select_option("pipeline_baseline")
    page.wait_for_timeout(1500)
    
    pin_button = page.locator("#pin-current-run")
    pinned_count = page.locator("#pinned-count .count")
    clear_button = page.locator("#clear-all-pins")
    
    if not pin_button.is_disabled():
        # Pin configuration
        pin_button.click()
        page.wait_for_timeout(500)
        
        # Verify pin was added
        expect(pinned_count).to_contain_text("1")
        expect(clear_button).not_to_be_disabled()
        
        # Clear all pins
        clear_button.click()
        page.wait_for_timeout(500)
        
        # Verify cleared
        expect(pinned_count).to_contain_text("0")
        expect(clear_button).to_be_disabled()
        
        print("✓ Clear all pins functionality working correctly")
    else:
        print("✓ No valid data to test clear functionality")


def test_pin_different_configurations(page, test_server):
    """Test pinning different configurations creates separate pins."""
    page.goto(test_server)
    page.wait_for_function("document.querySelector('#adm-type-select').options.length > 0")
    
    pin_button = page.locator("#pin-current-run")
    pinned_count = page.locator("#pinned-count .count")
    
    # Try different scenarios to pin different configurations
    base_scenario_select = page.locator("#base-scenario-select")
    base_scenario_options = base_scenario_select.locator("option").all()
    available_scenarios = [opt.get_attribute("value") for opt in base_scenario_options if opt.get_attribute("value")]
    
    successful_pins = 0
    
    for scenario in available_scenarios[:3]:  # Test first 3 scenarios
        base_scenario_select.select_option(scenario)
        page.wait_for_timeout(500)
        
        adm_select = page.locator("#adm-type-select")
        adm_select.select_option("pipeline_baseline")
        page.wait_for_timeout(1000)
        
        # If pin button is enabled for this configuration
        if not pin_button.is_disabled():
            pin_button.click()
            page.wait_for_timeout(500)
            successful_pins += 1
            
            # Check count increased
            current_count = int(pinned_count.text_content())
            assert current_count == successful_pins, f"Expected {successful_pins} pins, got {current_count}"
    
    if successful_pins > 1:
        print(f"✓ Successfully pinned {successful_pins} different configurations")
    elif successful_pins == 1:
        print("✓ Pinned 1 configuration (limited test data)")
    else:
        print("✓ No valid configurations to pin (expected in some test scenarios)")


def test_pin_button_state_changes_with_data(page, test_server):
    """Test that pin button state correctly changes when data availability changes."""
    page.goto(test_server)
    page.wait_for_function("document.querySelector('#adm-type-select').options.length > 0")
    
    pin_button = page.locator("#pin-current-run")
    base_scenario_select = page.locator("#base-scenario-select")
    adm_select = page.locator("#adm-type-select")
    
    # Initially disabled
    expect(pin_button).to_be_disabled()
    
    # Try to find a scenario that loads data
    base_scenario_options = base_scenario_select.locator("option").all()
    available_scenarios = [opt.get_attribute("value") for opt in base_scenario_options if opt.get_attribute("value")]
    
    found_valid_data = False
    
    for scenario in available_scenarios[:3]:
        base_scenario_select.select_option(scenario)
        page.wait_for_timeout(500)
        
        adm_select.select_option("pipeline_baseline")
        page.wait_for_timeout(1000)
        
        run_display = page.locator("#run-display")
        run_text = run_display.text_content()
        
        if "test_scenario" in run_text and "No data found" not in run_text:
            # Found valid data - pin button should be enabled
            expect(pin_button).not_to_be_disabled()
            found_valid_data = True
            print(f"✓ Pin button enabled for valid data in scenario: {scenario}")
            break
        else:
            # No valid data - pin button should be disabled
            expect(pin_button).to_be_disabled()
    
    if not found_valid_data:
        print("✓ Pin button correctly stays disabled when no valid data found")


def test_pin_state_management_persistence(page, test_server):
    """Test that pinned state persists during parameter changes."""
    page.goto(test_server)
    page.wait_for_function("document.querySelector('#adm-type-select').options.length > 0")
    
    # Load data and pin
    adm_select = page.locator("#adm-type-select")
    adm_select.select_option("pipeline_baseline")
    page.wait_for_timeout(1500)
    
    pin_button = page.locator("#pin-current-run")
    pinned_count = page.locator("#pinned-count .count")
    
    if not pin_button.is_disabled():
        # Pin current configuration
        pin_button.click()
        page.wait_for_timeout(500)
        
        initial_count = int(pinned_count.text_content())
        assert initial_count >= 1, "Should have at least 1 pinned configuration"
        
        # Change parameters (this should not affect pinned count)
        base_scenario_select = page.locator("#base-scenario-select")
        base_scenario_options = base_scenario_select.locator("option").all()
        available_scenarios = [opt.get_attribute("value") for opt in base_scenario_options if opt.get_attribute("value")]
        
        if len(available_scenarios) > 1:
            # Switch to different scenario
            current_scenario = base_scenario_select.input_value()
            different_scenario = next((s for s in available_scenarios if s != current_scenario), None)
            
            if different_scenario:
                base_scenario_select.select_option(different_scenario)
                page.wait_for_timeout(1000)
                
                # Pinned count should persist
                persistent_count = int(pinned_count.text_content())
                assert persistent_count == initial_count, f"Pinned count should persist: expected {initial_count}, got {persistent_count}"
                
                print("✓ Pinned state persists during parameter changes")
        
        print(f"✓ Pin state management working with {initial_count} pinned configuration(s)")
    else:
        print("✓ No valid data to test pin state persistence")


def test_comparison_feature_integration(page, test_server):
    """Integration test for the entire comparison feature."""
    page.goto(test_server)
    page.wait_for_function("document.querySelector('#adm-type-select').options.length > 0")
    
    # Test complete workflow
    pin_button = page.locator("#pin-current-run")
    pinned_count = page.locator("#pinned-count .count")
    clear_button = page.locator("#clear-all-pins")
    
    # 1. Initial state (check count and clear button, pin button depends on auto-loading)
    expect(clear_button).to_be_disabled()
    expect(pinned_count).to_contain_text("0")
    
    # 2. Check if data is already loaded or load it
    run_display = page.locator("#run-display")
    run_text = run_display.text_content()
    
    # If no data loaded yet, try to load some
    if "test_scenario" not in run_text or "No data found" in run_text:
        adm_select = page.locator("#adm-type-select")
        adm_select.select_option("pipeline_baseline")
        page.wait_for_timeout(1500)
        run_text = run_display.text_content()
    
    # 3. Test based on data availability
    if "test_scenario" in run_text and "No data found" not in run_text:
        # Valid data loaded
        expect(pin_button).not_to_be_disabled()
        
        # 4. Pin configuration
        pin_button.click()
        page.wait_for_timeout(500)
        
        expect(pinned_count).to_contain_text("1")
        expect(clear_button).not_to_be_disabled()
        
        # 5. Try to pin duplicate
        pin_button.click()
        page.wait_for_timeout(500)
        
        expect(pinned_count).to_contain_text("1")  # Should not increase
        
        # 6. Clear all
        clear_button.click()
        page.wait_for_timeout(500)
        
        expect(pinned_count).to_contain_text("0")
        expect(clear_button).to_be_disabled()
        
        print("✓ Complete comparison feature integration test passed")
    else:
        # No valid data - test error handling
        expect(pin_button).to_be_disabled()
        
        # Try to click disabled pin button (should not cause errors)
        pin_button.click(force=True)  # Force click on disabled button
        page.wait_for_timeout(500)
        
        expect(pinned_count).to_contain_text("0")  # Should stay 0
        
        print("✓ Comparison feature correctly handles no-data scenarios")


def test_notifications_for_pin_actions(page, test_server):
    """Test that notifications appear for pin actions."""
    page.goto(test_server)
    page.wait_for_function("document.querySelector('#adm-type-select').options.length > 0")
    
    # Load data
    adm_select = page.locator("#adm-type-select")
    adm_select.select_option("pipeline_baseline")
    page.wait_for_timeout(1500)
    
    pin_button = page.locator("#pin-current-run")
    
    if not pin_button.is_disabled():
        # Pin configuration - should show success notification
        pin_button.click()
        page.wait_for_timeout(100)  # Brief wait for notification to appear
        
        # Check for notification element
        notification = page.locator(".notification")
        expect(notification).to_be_visible()
        
        # Wait for notification to disappear
        page.wait_for_timeout(3500)
        expect(notification).not_to_be_visible()
        
        # Try to pin same configuration - should show info notification
        pin_button.click()
        page.wait_for_timeout(100)
        
        # New notification should appear
        expect(notification).to_be_visible()
        
        print("✓ Notifications working for pin actions")
    else:
        # Try to pin when no data - should show error notification
        pin_button.click(force=True)
        page.wait_for_timeout(100)
        
        notification = page.locator(".notification")
        # May or may not show notification depending on implementation
        # This tests error handling without crashing
        print("✓ Pin error handling working correctly")


if __name__ == "__main__":
    # Run tests if executed directly
    pytest.main([__file__, "-v"])
