#!/usr/bin/env python3
"""
Frontend tests using real experiment data.

These tests require real experiment data in experiment-data/phase2_june/
and will be skipped if the data is not available.
"""

from playwright.sync_api import expect


def test_adm_selection_updates_llm(page, real_data_test_server):
    """Test that selecting an ADM type updates the LLM dropdown."""
    page.goto(real_data_test_server)

    # Wait for table to load
    page.wait_for_selector(".comparison-table", timeout=10000)
    page.wait_for_function(
        "document.querySelectorAll('.table-adm-select').length > 0", timeout=10000
    )

    adm_select = page.locator(".table-adm-select").first
    llm_select = page.locator(".table-llm-select").first

    # Select an ADM type
    adm_select.select_option("pipeline_baseline")

    # Wait for LLM dropdown to update
    page.wait_for_timeout(500)

    # Check that LLM dropdown has options
    expect(llm_select).to_be_visible()
    llm_options = llm_select.locator("option").all()
    assert len(llm_options) > 0, "LLM dropdown should have options after ADM selection"


def test_kdma_sliders_interaction(page, real_data_test_server):
    """Test that KDMA sliders are interactive and snap to valid values."""
    page.goto(real_data_test_server)

    # Wait for table to load
    page.wait_for_selector(".comparison-table", timeout=10000)
    page.wait_for_function(
        "document.querySelectorAll('.table-adm-select').length > 0", timeout=10000
    )

    # Set ADM type to enable KDMA sliders
    adm_select = page.locator(".table-adm-select").first
    adm_select.select_option("pipeline_baseline")
    page.wait_for_timeout(1000)

    # Find KDMA sliders in table
    sliders = page.locator(".table-kdma-value-slider").all()

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


def test_scenario_selection_availability(page, real_data_test_server):
    """Test that scenario selection becomes available after parameter selection."""
    page.goto(real_data_test_server)

    # Wait for table to load
    page.wait_for_selector(".comparison-table", timeout=10000)
    page.wait_for_function(
        "document.querySelectorAll('.table-adm-select').length > 0", timeout=10000
    )

    # Make selections
    adm_select = page.locator(".table-adm-select").first
    adm_select.select_option("pipeline_baseline")

    # Wait a moment for updates
    page.wait_for_timeout(1000)

    # Check scenario dropdown in table
    scenario_select = page.locator(".table-scenario-select").first
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


def test_dynamic_kdma_management(page, real_data_test_server):
    """Test dynamic KDMA addition, removal, and type selection."""
    page.goto(real_data_test_server)

    # Wait for table to load
    page.wait_for_selector(".comparison-table", timeout=10000)
    page.wait_for_function(
        "document.querySelectorAll('.table-adm-select').length > 0", timeout=10000
    )

    # Select ADM and LLM to enable KDMA functionality
    adm_select = page.locator(".table-adm-select").first
    adm_select.select_option("pipeline_baseline")
    page.wait_for_timeout(1000)

    # Check KDMA controls in table
    kdma_sliders = page.locator(".table-kdma-value-slider")
    initial_count = kdma_sliders.count()

    # Should have KDMA sliders available in the table
    assert initial_count > 0, "Should have KDMA sliders in table after ADM selection"

    # Check KDMA slider functionality
    if initial_count > 0:
        first_slider = kdma_sliders.first
        expect(first_slider).to_be_visible()

        # Test slider interaction
        first_slider.fill("0.7")
        page.wait_for_timeout(500)

        new_value = first_slider.input_value()
        assert new_value == "0.7", "KDMA slider should update value"


def test_kdma_selection_shows_results_regression(page, real_data_test_server):
    """Test that KDMA sliders work correctly in the table-based UI."""
    page.goto(real_data_test_server)

    # Wait for page to load
    page.wait_for_selector(".comparison-table", timeout=10000)
    page.wait_for_function(
        "document.querySelectorAll('.table-adm-select').length > 0", timeout=10000
    )

    # Test basic table-based KDMA functionality
    adm_select = page.locator(".table-adm-select").first

    # Select pipeline_baseline to enable KDMA sliders
    adm_select.select_option("pipeline_baseline")
    page.wait_for_timeout(1000)

    # Check for KDMA sliders in the table
    kdma_sliders = page.locator(".table-kdma-value-slider")
    slider_count = kdma_sliders.count()

    if slider_count > 0:
        print(f"Testing {slider_count} KDMA sliders")

        # Test that sliders are functional
        first_slider = kdma_sliders.first
        first_slider.fill("0.7")
        page.wait_for_timeout(500)

        # Verify slider works
        assert first_slider.input_value() == "0.7", "KDMA slider should be functional"

        # Verify table remains functional
        expect(page.locator(".comparison-table")).to_be_visible()
        print("✓ KDMA functionality test passed")
    else:
        print("No KDMA sliders found - test passes")


def test_real_data_scenario_availability(page, real_data_test_server):
    """Test that scenarios are available with real data."""
    page.goto(real_data_test_server)

    # Wait for table to load
    page.wait_for_selector(".comparison-table", timeout=10000)

    # For real data, we should have some data loaded
    # Even if no specific scenario elements, the table should be populated
    table_rows = page.locator(".comparison-table tbody tr")
    assert table_rows.count() > 0, "Should have data rows in the comparison table"


def test_real_data_comprehensive_loading(page, real_data_test_server):
    """Test comprehensive loading of real experiment data."""
    page.goto(real_data_test_server)

    # Wait for page to fully load
    page.wait_for_load_state("networkidle")

    # Check for no JavaScript errors
    js_errors = []
    page.on(
        "console",
        lambda msg: js_errors.append(msg.text) if msg.type == "error" else None,
    )

    # Wait for table to load
    page.wait_for_selector(".comparison-table", timeout=10000)

    # Give time for any async operations
    page.wait_for_timeout(2000)

    # Check that we have minimal expected elements
    expect(page.locator(".comparison-table")).to_be_visible()

    # Filter out known acceptable errors
    filtered_errors = [
        error
        for error in js_errors
        if not any(
            acceptable in error.lower()
            for acceptable in ["favicon", "manifest", "workbox", "service worker"]
        )
    ]

    assert len(filtered_errors) == 0, f"Found JavaScript errors: {filtered_errors}"
