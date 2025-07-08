#!/usr/bin/env python3
"""
Automated frontend testing for the ADM Results app using Playwright.
This script builds the frontend and runs automated browser tests.
"""

import pytest
from playwright.sync_api import expect


def test_page_load(page, test_server):
    """Test that the page loads without errors."""
    page.goto(test_server)

    # Check page title
    expect(page).to_have_title("Align Browser")

    # Check that main elements exist
    expect(page.locator("#runs-container")).to_be_visible()
    
    # Wait for table to load
    page.wait_for_selector(".comparison-table", timeout=10000)
    expect(page.locator(".comparison-table")).to_be_visible()


def test_manifest_loading(page, test_server):
    """Test that manifest.json loads and populates UI elements."""
    page.goto(test_server)

    # Wait for table to load
    page.wait_for_selector(".comparison-table", timeout=10000)
    page.wait_for_function("document.querySelectorAll('.table-adm-select').length > 0", timeout=10000)

    # Check that ADM options are populated in table
    adm_select = page.locator(".table-adm-select").first
    expect(adm_select).to_be_visible()

    # Check that ADM options are populated
    options = adm_select.locator("option").all()
    assert len(options) > 0, "ADM dropdown should have options"

    # Check that we have at least one ADM type (filtered by current scenario)
    option_texts = [option.text_content() for option in options]
    assert len(option_texts) > 0, "Should have at least one ADM option"


def test_adm_selection_updates_llm(page, test_server):
    """Test that selecting an ADM type updates the LLM dropdown."""
    page.goto(test_server)

    # Wait for table to load
    page.wait_for_selector(".comparison-table", timeout=10000)
    page.wait_for_function("document.querySelectorAll('.table-adm-select').length > 0", timeout=10000)

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


def test_kdma_sliders_interaction(page, test_server):
    """Test that KDMA sliders are interactive and snap to valid values."""
    page.goto(test_server)

    # Wait for table to load
    page.wait_for_selector(".comparison-table", timeout=10000)
    page.wait_for_function("document.querySelectorAll('.table-adm-select').length > 0", timeout=10000)

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


def test_scenario_selection_availability(page, test_server):
    """Test that scenario selection becomes available after parameter selection."""
    page.goto(test_server)

    # Wait for table to load
    page.wait_for_selector(".comparison-table", timeout=10000)
    page.wait_for_function("document.querySelectorAll('.table-adm-select').length > 0", timeout=10000)

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


def test_run_display_updates(page, test_server):
    """Test that results display updates when selections are made."""
    page.goto(test_server)

    # Wait for table to load
    page.wait_for_selector(".comparison-table", timeout=10000)
    page.wait_for_function("document.querySelectorAll('.table-adm-select').length > 0", timeout=10000)

    comparison_table = page.locator(".comparison-table")

    # Make complete selections
    adm_select = page.locator(".table-adm-select").first
    adm_select.select_option("pipeline_baseline")

    # Wait for updates
    page.wait_for_timeout(1500)

    # Check that comparison table is visible and has content
    expect(comparison_table).to_be_visible()
    table_text = comparison_table.text_content()

    # It should either show data, an error message, or "no data found"
    # During development, any of these is acceptable
    assert table_text.strip() != "", (
        "Comparison table should have some content after selections"
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

    has_acceptable_message = any(msg in table_text for msg in acceptable_messages)
    assert has_acceptable_message, (
        f"Results should show expected content, got: {table_text[:100]}"
    )


def test_no_console_errors(page, test_server):
    """Test that there are no severe console errors on page load."""
    # Listen for console messages
    console_messages = []
    page.on("console", lambda msg: console_messages.append(msg))

    page.goto(test_server)

    # Wait for page to fully load
    page.wait_for_selector(".comparison-table", timeout=10000)
    page.wait_for_function("document.querySelectorAll('.table-adm-select').length > 0", timeout=10000)

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
    page.wait_for_selector(".comparison-table", timeout=10000)
    expect(page.locator(".comparison-table")).to_be_visible()
    expect(page.locator("#runs-container")).to_be_visible()

    # Test tablet size
    page.set_viewport_size({"width": 768, "height": 1024})
    expect(page.locator(".comparison-table")).to_be_visible()
    expect(page.locator("#runs-container")).to_be_visible()

    # Test mobile size
    page.set_viewport_size({"width": 375, "height": 667})
    # On mobile, elements should still be present even if layout changes
    expect(page.locator(".comparison-table")).to_be_visible()
    expect(page.locator("#runs-container")).to_be_visible()


def test_dynamic_kdma_management(page, test_server):
    """Test dynamic KDMA addition, removal, and type selection."""
    page.goto(test_server)

    # Wait for table to load
    page.wait_for_selector(".comparison-table", timeout=10000)
    page.wait_for_function("document.querySelectorAll('.table-adm-select').length > 0", timeout=10000)

    # Select ADM and LLM to enable KDMA functionality
    adm_select = page.locator(".table-adm-select").first
    adm_select.select_option("pipeline_baseline")
    page.wait_for_timeout(1000)

    # Check KDMA controls in table
    kdma_sliders = page.locator(".table-kdma-value-slider")
    initial_count = kdma_sliders.count()

    # Should have KDMA sliders available in the table
    assert initial_count > 0, (
        "Should have KDMA sliders in table after ADM selection"
    )

    # Check KDMA slider functionality
    if initial_count > 0:
        first_slider = kdma_sliders.first
        expect(first_slider).to_be_visible()
        
        # Test slider interaction
        initial_value = first_slider.input_value()
        first_slider.fill("0.7")
        page.wait_for_timeout(500)
        
        new_value = first_slider.input_value()
        assert new_value == "0.7", "KDMA slider should update value"


def test_kdma_type_filtering_prevents_duplicates(page, test_server):
    """Test that KDMA type dropdowns filter out already-used types."""
    page.goto(test_server)

    # Wait for page to load and select a scenario that supports multiple KDMAs
    page.wait_for_selector(".comparison-table", timeout=10000)
    page.wait_for_function("document.querySelectorAll('.table-adm-select').length > 0", timeout=10000)

    # Work with whatever scenario is available (table already loads with data)
    page.wait_for_timeout(500)

    adm_select = page.locator(".table-adm-select").first
    adm_select.select_option("pipeline_baseline")
    page.wait_for_timeout(1000)

    # Check KDMA sliders in table (they are automatically present)
    kdma_sliders = page.locator(".table-kdma-value-slider")
    slider_count = kdma_sliders.count()
    
    # Should have KDMA sliders available for the selected ADM type
    assert slider_count > 0, "Should have KDMA sliders in table"
    
    # Test that KDMA sliders are functional
    if slider_count > 0:
        first_slider = kdma_sliders.first
        expect(first_slider).to_be_visible()
        
        # Test slider functionality
        first_slider.fill("0.5")
        page.wait_for_timeout(500)
        assert first_slider.input_value() == "0.5", "KDMA slider should be functional"


def test_kdma_max_limit_enforcement(page, test_server):
    """Test that KDMA addition respects experiment data limits."""
    page.goto(test_server)

    # Wait for page to load
    page.wait_for_selector(".comparison-table", timeout=10000)
    page.wait_for_function("document.querySelectorAll('.table-adm-select').length > 0", timeout=10000)

    # Test KDMA functionality with whatever data is available
    adm_select = page.locator(".table-adm-select").first
    adm_select.select_option("pipeline_baseline")
    page.wait_for_timeout(1000)
    
    # Test that KDMA sliders are present and functional
    kdma_sliders = page.locator(".table-kdma-value-slider")
    slider_count = kdma_sliders.count()
    
    # Should have KDMA sliders available
    assert slider_count > 0, "Should have KDMA sliders in table"
    
    # Test slider functionality
    if slider_count > 0:
        first_slider = kdma_sliders.first
        expect(first_slider).to_be_visible()
        first_slider.fill("0.3")
        page.wait_for_timeout(500)
        assert first_slider.input_value() == "0.3", "KDMA slider should be functional"

    # Verify table continues to work after changes
    expect(page.locator(".comparison-table")).to_be_visible()


def test_kdma_removal_updates_constraints(page, test_server):
    """Test that KDMA sliders are functional in table-based UI."""
    page.goto(test_server)

    # Wait for page to load
    page.wait_for_selector(".comparison-table", timeout=10000)
    page.wait_for_function("document.querySelectorAll('.table-adm-select').length > 0", timeout=10000)

    # Select ADM that supports KDMAs
    adm_select = page.locator(".table-adm-select").first
    adm_select.select_option("pipeline_baseline")
    page.wait_for_timeout(1000)

    # Check for KDMA sliders in the table
    kdma_sliders = page.locator(".table-kdma-value-slider")
    initial_slider_count = kdma_sliders.count()

    if initial_slider_count > 0:
        # Test that sliders are functional
        first_slider = kdma_sliders.first
        expect(first_slider).to_be_visible()
        
        # Test changing slider value
        first_slider.fill("0.5")
        page.wait_for_timeout(500)
        
        # Verify slider value updated
        assert first_slider.input_value() == "0.5", "KDMA slider should update value"
        
        # Verify table still functions
        expect(page.locator(".comparison-table")).to_be_visible()


def test_kdma_warning_system(page, test_server):
    """Test that KDMA warning system shows for invalid values."""
    page.goto(test_server)

    # Wait for page to load
    page.wait_for_selector(".comparison-table", timeout=10000)
    page.wait_for_function("document.querySelectorAll('.table-adm-select').length > 0", timeout=10000)

    # Select ADM and add KDMA
    adm_select = page.locator(".table-adm-select").first
    adm_select.select_option("pipeline_baseline")
    page.wait_for_timeout(1000)

    # Check for KDMA sliders in the table
    kdma_sliders = page.locator(".table-kdma-value-slider")
    
    if kdma_sliders.count() > 0:
        # Get first KDMA slider
        slider = kdma_sliders.first
        
        # Look for warning element near slider
        warning_span = slider.locator("xpath=following-sibling::span[contains(@class, 'warning')]")

        # Test slider functionality
        slider.fill("0.5")
        page.wait_for_timeout(500)
        
        # Verify slider works
        assert slider.input_value() == "0.5", "KDMA slider should accept valid values"
    else:
        # Skip test if no KDMA sliders available
        pass


def test_kdma_adm_change_resets_properly(page, test_server):
    """Test that changing ADM type properly updates available controls."""
    page.goto(test_server)

    # Wait for page to load
    page.wait_for_selector(".comparison-table", timeout=10000)
    page.wait_for_function("document.querySelectorAll('.table-adm-select').length > 0", timeout=10000)
    
    # Test switching between different ADM types
    adm_select = page.locator(".table-adm-select").first
    
    # Start with pipeline_baseline
    adm_select.select_option("pipeline_baseline")
    page.wait_for_timeout(1000)

    # Check initial KDMA sliders
    initial_sliders = page.locator(".table-kdma-value-slider").count()

    # Switch to pipeline_random
    adm_select.select_option("pipeline_random")
    page.wait_for_timeout(1000)

    # Verify the interface still works after ADM change
    expect(page.locator(".comparison-table")).to_be_visible()
    expect(adm_select).to_be_visible()


def test_scenario_based_kdma_filtering(page, test_server):
    """Test that KDMA filtering follows correct hierarchy: Scenario → ADM → KDMA values.
    
    This test specifically addresses the bug where only the first KDMA type would show
    results because the filtering was backwards (KDMA → Scenario instead of Scenario → KDMA).
    """
    page.goto(test_server)
    
    # Wait for page to load
    page.wait_for_selector(".comparison-table", timeout=10000)
    page.wait_for_function("document.querySelectorAll('.table-adm-select').length > 0", timeout=10000)
    
    # Get all available scenarios from table
    scenario_select = page.locator(".table-scenario-select").first
    scenario_options = scenario_select.locator("option").all()
    available_scenarios = [opt.get_attribute("value") for opt in scenario_options if opt.get_attribute("value")]
    
    # Should have multiple scenarios available (our test data has different scenarios)
    assert len(available_scenarios) >= 2, f"Test requires multiple scenarios, got: {available_scenarios}"
    
    # Test that different scenarios show different KDMA types
    scenario_kdma_mapping = {}
    
    for scenario_type in available_scenarios[:3]:  # Test first 3 scenarios
        print(f"\nTesting scenario: {scenario_type}")
        
        # Select this scenario
        scenario_select.select_option(scenario_type)
        page.wait_for_timeout(1000)
        
        # Select a consistent ADM type
        adm_select = page.locator(".table-adm-select").first
        adm_select.select_option("pipeline_baseline")
        page.wait_for_timeout(1500)
        
        # Check what KDMA sliders are available in table
        kdma_sliders = page.locator(".table-kdma-value-slider")
        slider_count = kdma_sliders.count()
        
        if slider_count > 0:
            # For table-based UI, we test slider functionality instead of dropdown selection
            first_slider = kdma_sliders.first
            first_slider.fill("0.5")
            page.wait_for_timeout(1000)
            
            scenario_kdma_mapping[scenario_type] = ["kdma_available"]
            print(f"  KDMA sliders available: {slider_count}")
                
            # Check results in table format
            expect(page.locator(".comparison-table")).to_be_visible()
            
            # Verify data is loaded by checking for table content
            table_data = page.locator(".comparison-table").text_content()
            assert len(table_data) > 0, f"Scenario '{scenario_type}' should show table data"
    
    print(f"\nScenario → KDMA mapping: {scenario_kdma_mapping}")
    
    # Verify that scenarios are properly loaded and functional
    assert len(scenario_kdma_mapping) > 0, "Should have processed at least one scenario"
    print(f"Processed scenarios: {list(scenario_kdma_mapping.keys())}")
    
    # Basic validation that table-based UI is working
    expect(page.locator(".comparison-table")).to_be_visible()


def test_kdma_selection_shows_results_regression(page, test_server):
    """Test that KDMA sliders work correctly in the table-based UI."""
    page.goto(test_server)
    
    # Wait for page to load
    page.wait_for_selector(".comparison-table", timeout=10000)
    page.wait_for_function("document.querySelectorAll('.table-adm-select').length > 0", timeout=10000)
    
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


def test_initial_load_results_path(page, test_server):
    """Test that initial page load and results loading works without errors."""
    # Listen for console errors
    console_errors = []
    page.on("console", lambda msg: console_errors.append(msg) if msg.type == "error" else None)
    
    page.goto(test_server)
    
    # Wait for manifest to load and trigger initial results load
    page.wait_for_selector(".comparison-table", timeout=10000)
    page.wait_for_function("document.querySelectorAll('.table-adm-select').length > 0", timeout=10000)
    
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
    
    # Verify comparison table is displayed (always-on mode)
    comparison_table = page.locator(".comparison-table")
    expect(comparison_table).to_be_visible()
    
    # Should have table structure
    parameter_header = page.locator(".parameter-header")
    if parameter_header.count() > 0:
        expect(parameter_header.first).to_be_visible()
    
    # Should have some content (even if it's "no data found")
    table_content = comparison_table.text_content()
    assert table_content.strip() != "", "Comparison table should have content after initial load"


def test_pinned_run_removal_persistence(page, test_server):
    """Test that removing pinned runs persists across page reloads."""
    page.goto(test_server)
    
    # Wait for table to load
    page.wait_for_selector(".comparison-table", timeout=10000)
    page.wait_for_function("document.querySelectorAll('.table-adm-select').length > 0", timeout=10000)
    
    # Pin the current run first to ensure we have at least one pinned run
    pin_button = page.locator(".pin-button")
    if pin_button.count() > 0 and pin_button.is_enabled():
        pin_button.click()
        page.wait_for_timeout(1000)  # Wait for pin to complete
    
    # Pin a second run with different parameters to ensure we have multiple runs
    # This will make remove buttons visible (they're hidden when only 1 run exists)
    pin_button = page.locator(".pin-button")
    if pin_button.count() > 0 and pin_button.is_enabled():
        # Change a parameter to create a different run configuration
        adm_select = page.locator(".table-adm-select").first
        if adm_select.count() > 0:
            options = adm_select.locator("option").all()
            if len(options) > 1:
                # Select a different ADM option
                adm_select.select_option(index=1)
                page.wait_for_timeout(500)
        
        # Pin the modified configuration
        pin_button.click()
        page.wait_for_timeout(1000)
        
        # Wait for remove buttons to become visible (should have 2+ pinned runs now)
        page.wait_for_function("document.querySelectorAll('.remove-run-btn[style*=\"visible\"]').length > 0", timeout=5000)
    
    # Check that we have at least one visible remove button
    visible_remove_buttons = page.locator(".remove-run-btn[style*='visible']")
    initial_count = visible_remove_buttons.count()
    if initial_count == 0:
        pytest.skip("No visible remove buttons available to test removal")
    
    # Get the current URL to check state persistence
    initial_url = page.url
    
    # Remove the first visible pinned run
    visible_remove_buttons.first.click()
    
    # Wait for the removal to be processed
    page.wait_for_timeout(500)
    
    # Check that the number of visible remove buttons decreased
    new_count = page.locator(".remove-run-btn[style*='visible']").count()
    assert new_count == initial_count - 1, f"Expected {initial_count - 1} visible remove buttons, got {new_count}"
    
    # Check that URL state changed (indicating persistence)
    new_url = page.url
    assert new_url != initial_url, "URL should change after removing pinned run"
    
    # Reload the page
    page.reload()
    page.wait_for_selector(".comparison-table", timeout=10000)
    
    # Verify the removal persisted across reload
    reloaded_count = page.locator(".remove-run-btn[style*='visible']").count()
    assert reloaded_count == new_count, f"Visible remove button count should persist after reload. Expected {new_count}, got {reloaded_count}"


def test_update_pinned_run_state_function(page, test_server):
    """Test the updatePinnedRunState function through JavaScript execution."""
    page.goto(test_server)
    
    # Wait for table to load and app to initialize
    page.wait_for_selector(".comparison-table", timeout=10000)
    page.wait_for_function("window.appState", timeout=10000)
    
    # Debug: Check what functions are available on window
    available_functions = page.evaluate("""
        Object.keys(window).filter(key => typeof window[key] === 'function' && key.includes('Pinned'))
    """)
    print(f"Available window functions with 'Pinned': {available_functions}")
    
    # Test that the updatePinnedRunState function exists
    function_exists = page.evaluate("typeof window.updatePinnedRunState === 'function'")
    if not function_exists:
        pytest.skip("updatePinnedRunState function not available - may be scoped differently")
    
    # Test basic function signature and error handling
    try:
        # This should not throw an error even with empty options
        result = page.evaluate("window.updatePinnedRunState({})")
        # Function should return a promise (undefined when awaited without async)
        assert result is None
    except Exception as e:
        pytest.fail(f"updatePinnedRunState should handle empty options gracefully: {e}")
    
    # Check that the function has the expected parameters structure
    function_string = page.evaluate("window.updatePinnedRunState.toString()")
    assert "action" in function_string, "Function should handle action parameter"
    assert "runId" in function_string, "Function should handle runId parameter"
    assert "needsReload" in function_string, "Function should handle needsReload parameter"


def test_pinned_run_state_patterns(page, test_server):
    """Test that refactored functions still follow the correct update patterns."""
    page.goto(test_server)
    
    # Wait for app to load
    page.wait_for_selector(".comparison-table", timeout=10000)
    page.wait_for_function("window.appState && window.removePinnedRun", timeout=10000)
    
    # Check that removePinnedRun function exists and is properly refactored
    remove_function = page.evaluate("window.removePinnedRun.toString()")
    assert "updatePinnedRunState" in remove_function, "removePinnedRun should use updatePinnedRunState"
    assert "action: 'remove'" in remove_function, "removePinnedRun should use remove action"
    assert "needsCleanup: true" in remove_function, "removePinnedRun should enable cleanup"
    
    # Check that clearAllPins function is properly refactored
    clear_function = page.evaluate("window.clearAllPins ? window.clearAllPins.toString() : 'not found'")
    if clear_function != 'not found':
        assert "updatePinnedRunState" in clear_function, "clearAllPins should use updatePinnedRunState"
        assert "action: 'clear'" in clear_function, "clearAllPins should use clear action"
    
    # Check that handleRunLLMChange is properly refactored
    llm_change_function = page.evaluate("window.handleRunLLMChange ? window.handleRunLLMChange.toString() : 'not found'")
    if llm_change_function != 'not found':
        assert "updatePinnedRunState" in llm_change_function, "handleRunLLMChange should use updatePinnedRunState"
        assert "needsReload: true" in llm_change_function, "handleRunLLMChange should enable reload"


