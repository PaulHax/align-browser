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
    # Wait for UI to update after ADM selection
    page.wait_for_load_state("networkidle")

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


def test_kdma_combination_default_value_issue(page, real_data_test_server):
    """Test the KDMA combination issue where adding a second KDMA defaults to 0.5 instead of valid value."""
    page.goto(real_data_test_server)
    
    # Wait for table to load
    page.wait_for_selector(".comparison-table", timeout=10000)
    page.wait_for_function(
        "document.querySelectorAll('.table-adm-select').length > 0", timeout=10000
    )
    
    # Select pipeline_baseline ADM to enable KDMA functionality 
    adm_select = page.locator(".table-adm-select").first
    adm_select.select_option("pipeline_baseline")
    # Wait for UI to update after ADM selection
    page.wait_for_load_state("networkidle")
    
    # Select June2025-AF-train scenario to get multi-KDMA support
    scenario_select = page.locator(".table-scenario-select").first
    
    # Check what scenarios are available
    scenario_options = scenario_select.locator("option").all()
    scenario_values = [opt.get_attribute("value") for opt in scenario_options if opt.get_attribute("value")]
    print(f"Available scenarios: {scenario_values}")
    
    # Find a June2025-AF-train scenario
    june_scenarios = [s for s in scenario_values if "June2025-AF-train" in s]

    scenario_select.select_option(june_scenarios[0])
    # Wait for scenario selection to take effect
    page.wait_for_load_state("networkidle")

    
    # Check initial KDMA sliders - should have affiliation already
    kdma_sliders = page.locator(".table-kdma-value-slider")
    initial_count = kdma_sliders.count()
    
    # Should have at least one KDMA slider initially
    assert initial_count > 0, "Should have initial KDMA slider"
    
    # Look for "Add KDMA" button
    add_kdma_button = page.locator(".add-kdma-btn")
    
    # Click Add KDMA button
    add_kdma_button.click()
    
    # Wait for new KDMA slider to be added by checking for count increase
    page.wait_for_function(
        f"document.querySelectorAll('.table-kdma-value-slider').length > {initial_count}",
        timeout=5000
    )
    
    # Check that a new KDMA slider was added
    updated_kdma_sliders = page.locator(".table-kdma-value-slider")
    updated_count = updated_kdma_sliders.count()
    
    assert updated_count > initial_count, "Should have added a new KDMA slider"
    
    # Check the value of the new slider
    new_sliders = updated_kdma_sliders.all()
    if len(new_sliders) > 1:
        # Get the last slider (newly added)
        new_slider = new_sliders[-1]
        new_value = new_slider.input_value()
        
        # This is the bug: it defaults to 0.5 instead of a valid value
        # For pipeline_baseline with affiliation+merit, valid combinations are only 0.0 and 1.0
        # So 0.5 should not be the default - it should be 0.0 or 1.0
        valid_values = ["0.0", "1.0"]
        
        # This assertion should fail with current code, proving the bug exists
        # Accept both integer and decimal formats
        valid_values = ["0.0", "1.0", "0", "1"]
        assert new_value in valid_values, f"New KDMA slider should default to valid value (0.0 or 1.0), but got {new_value}"
    
    # Also check that the dropdowns don't go blank
    adm_select_value = adm_select.input_value()
    assert adm_select_value != "", "ADM select should not go blank after adding KDMA"
    
    scenario_select_value = scenario_select.input_value()
    assert scenario_select_value != "", "Scenario select should not go blank after adding KDMA"
    assert "June2025-AF-train" in scenario_select_value, "Should still have June2025-AF-train scenario selected"

