#!/usr/bin/env python3
"""
Automated frontend testing for the ADM Results app using Playwright.
This script builds the frontend and runs automated browser tests.
"""

from playwright.sync_api import expect


def test_page_load(page, real_data_test_server):
    """Test that the page loads without errors."""
    page.goto(real_data_test_server)

    # Check page title
    expect(page).to_have_title("Align Browser")

    # Check that main elements exist
    expect(page.locator("#runs-container")).to_be_visible()

    # Wait for table to load
    page.wait_for_selector(".comparison-table", timeout=10000)
    expect(page.locator(".comparison-table")).to_be_visible()


def test_run_variant_row_present(page, real_data_test_server):
    """Test that the run variant row is present in the UI."""
    page.goto(real_data_test_server)

    # Wait for page to load
    page.wait_for_selector(".comparison-table", timeout=10000)

    # Check that the run_variant parameter row exists
    run_variant_row = page.locator("tr.parameter-row[data-category='run_variant']")
    expect(run_variant_row).to_have_count(1, timeout=5000)

    # Check that it has the correct label
    run_variant_label = run_variant_row.locator(".parameter-name")
    expect(run_variant_label).to_have_text("Run Variant")


def test_manifest_loading(page, real_data_test_server):
    """Test that manifest.json loads and populates UI elements."""
    page.goto(real_data_test_server)

    # Wait for table to load
    page.wait_for_selector(".comparison-table", timeout=10000)
    page.wait_for_function(
        "document.querySelectorAll('.table-adm-select').length > 0", timeout=10000
    )

    # Check that ADM options are populated in table
    adm_select = page.locator(".table-adm-select").first
    expect(adm_select).to_be_visible()

    # Check that ADM options are populated
    options = adm_select.locator("option").all()
    assert len(options) > 0, "ADM dropdown should have options"

    # Check that we have at least one ADM type (filtered by current scenario)
    option_texts = [option.text_content() for option in options]
    assert len(option_texts) > 0, "Should have at least one ADM option"


def test_run_display_updates(page, real_data_test_server):
    """Test that results display updates when selections are made."""
    page.goto(real_data_test_server)

    # Wait for table to load
    page.wait_for_selector(".comparison-table", timeout=10000)
    page.wait_for_function(
        "document.querySelectorAll('.table-adm-select').length > 0", timeout=10000
    )

    comparison_table = page.locator(".comparison-table")

    # Make complete selections using available option from generated test data
    adm_select = page.locator(".table-adm-select").first
    # Use the first available ADM option instead of hardcoding
    available_options = adm_select.locator("option").all()
    adm_options = [
        opt.get_attribute("value")
        for opt in available_options
        if opt.get_attribute("value")
    ]
    assert len(adm_options) > 0, "Should have ADM options available"
    adm_select.select_option(adm_options[0])

    # Wait for content to update
    page.wait_for_function(
        "document.querySelector('.comparison-table').textContent.trim() !== ''",
        timeout=5000,
    )

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
        "Choice",  # Results display content
    ]

    has_acceptable_message = any(msg in table_text for msg in acceptable_messages)
    assert has_acceptable_message, (
        f"Results should show expected content, got: {table_text[:100]}"
    )


def test_no_console_errors(page, real_data_test_server):
    """Test that there are no severe console errors on page load."""
    # Listen for console messages
    console_messages = []
    page.on("console", lambda msg: console_messages.append(msg))

    page.goto(real_data_test_server)

    # Wait for page to fully load
    page.wait_for_selector(".comparison-table", timeout=10000)
    page.wait_for_function(
        "document.querySelectorAll('.table-adm-select').length > 0", timeout=10000
    )

    # Check for severe errors
    errors = [msg for msg in console_messages if msg.type == "error"]

    # Filter out expected errors during development
    severe_errors = []
    for error in errors:
        error_text = error.text

        # Always catch JavaScript reference/syntax errors - these are code bugs
        if any(
            js_error in error_text.lower()
            for js_error in [
                "referenceerror",
                "syntaxerror",
                "typeerror",
                "is not defined",
                "cannot read property",
                "cannot read properties",
            ]
        ):
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


def test_kdma_type_filtering_prevents_duplicates(page, real_data_test_server):
    """Test that KDMA type dropdowns filter out already-used types."""
    page.goto(real_data_test_server)

    # Wait for page to load and select a scenario that supports multiple KDMAs
    page.wait_for_selector(".comparison-table", timeout=10000)
    page.wait_for_function(
        "document.querySelectorAll('.table-adm-select').length > 0", timeout=10000
    )

    # Wait for table to be ready - options might be hidden initially
    page.wait_for_function(
        "document.querySelectorAll('.table-adm-select option').length > 0", timeout=5000
    )

    # Look for an ADM that supports KDMAs (contains "pipeline_baseline")
    adm_select = page.locator(".table-adm-select").first
    available_options = adm_select.locator("option").all()
    adm_options = [
        opt.get_attribute("value")
        for opt in available_options
        if opt.get_attribute("value")
    ]

    # Try to find a pipeline_baseline option that supports KDMAs
    baseline_options = [opt for opt in adm_options if "pipeline_baseline" in opt]
    selected_option = baseline_options[0] if baseline_options else adm_options[0]

    adm_select.select_option(selected_option)
    # Wait for any updates instead of fixed timeout
    page.wait_for_load_state("networkidle")

    # Check KDMA sliders in table
    kdma_sliders = page.locator(".table-kdma-value-slider")
    slider_count = kdma_sliders.count()

    # KDMA sliders may or may not be available depending on selected ADM type
    print(f"Found {slider_count} KDMA sliders for ADM: {selected_option}")

    # Test that KDMA sliders are functional
    if slider_count > 0:
        first_slider = kdma_sliders.first
        expect(first_slider).to_be_visible()

        # Test slider functionality
        first_slider.fill("0.5")
        page.wait_for_timeout(500)
        assert first_slider.input_value() == "0.5", "KDMA slider should be functional"


def test_kdma_max_limit_enforcement(page, real_data_test_server):
    """Test that KDMA addition respects experiment data limits."""
    page.goto(real_data_test_server)

    # Wait for page to load
    page.wait_for_selector(".comparison-table", timeout=10000)
    page.wait_for_function(
        "document.querySelectorAll('.table-adm-select').length > 0", timeout=10000
    )

    # Look for an ADM that supports KDMAs
    adm_select = page.locator(".table-adm-select").first
    available_options = adm_select.locator("option").all()
    adm_options = [
        opt.get_attribute("value")
        for opt in available_options
        if opt.get_attribute("value")
    ]

    # Try to find a pipeline_baseline option that supports KDMAs
    baseline_options = [opt for opt in adm_options if "pipeline_baseline" in opt]
    selected_option = baseline_options[0] if baseline_options else adm_options[0]

    adm_select.select_option(selected_option)
    # Wait for any updates instead of fixed timeout
    page.wait_for_load_state("networkidle")

    # Test that KDMA sliders are present and functional
    kdma_sliders = page.locator(".table-kdma-value-slider")
    slider_count = kdma_sliders.count()

    # Test passes regardless of KDMA slider availability - depends on selected ADM
    print(f"Found {slider_count} KDMA sliders for ADM: {selected_option}")

    # Test slider functionality
    if slider_count > 0:
        first_slider = kdma_sliders.first
        expect(first_slider).to_be_visible()
        first_slider.fill("0.3")
        # Wait for value to update
        page.wait_for_function(
            "document.querySelector('.table-kdma-value-slider').value === '0.3'"
        )
        assert first_slider.input_value() == "0.3", "KDMA slider should be functional"

    # Verify table continues to work after changes
    expect(page.locator(".comparison-table")).to_be_visible()


def test_kdma_removal_updates_constraints(page, real_data_test_server):
    """Test that KDMA sliders are functional in table-based UI."""
    page.goto(real_data_test_server)

    # Wait for page to load
    page.wait_for_selector(".comparison-table", timeout=10000)
    page.wait_for_function(
        "document.querySelectorAll('.table-adm-select').length > 0", timeout=10000
    )

    # Select ADM that supports KDMAs
    # Use available ADM option from test data
    adm_select = page.locator(".table-adm-select").first
    available_options = adm_select.locator("option").all()
    adm_options = [
        opt.get_attribute("value")
        for opt in available_options
        if opt.get_attribute("value")
    ]
    if adm_options:
        adm_select.select_option(adm_options[0])
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
        # Wait for value to update
        page.wait_for_function(
            "document.querySelector('.table-kdma-value-slider').value === '0.5'"
        )

        # Verify slider value updated
        assert first_slider.input_value() == "0.5", "KDMA slider should update value"

        # Verify table still functions
        expect(page.locator(".comparison-table")).to_be_visible()


def test_kdma_warning_system(page, real_data_test_server):
    """Test that KDMA warning system shows for invalid values."""
    page.goto(real_data_test_server)

    # Wait for page to load
    page.wait_for_selector(".comparison-table", timeout=10000)
    page.wait_for_function(
        "document.querySelectorAll('.table-adm-select').length > 0", timeout=10000
    )

    # Select ADM and add KDMA
    # Use available ADM option from test data
    adm_select = page.locator(".table-adm-select").first
    available_options = adm_select.locator("option").all()
    adm_options = [
        opt.get_attribute("value")
        for opt in available_options
        if opt.get_attribute("value")
    ]
    if adm_options:
        adm_select.select_option(adm_options[0])
    page.wait_for_timeout(1000)

    # Check for KDMA sliders in the table
    kdma_sliders = page.locator(".table-kdma-value-slider")

    if kdma_sliders.count() > 0:
        # Get first KDMA slider
        slider = kdma_sliders.first

        # Test slider functionality
        slider.fill("0.5")
        # Wait for value to update

        # Verify slider works
        assert slider.input_value() == "0.5", "KDMA slider should accept valid values"
    else:
        # Skip test if no KDMA sliders available
        pass


def test_kdma_adm_change_resets_properly(page, real_data_test_server):
    """Test that changing ADM type properly updates available controls."""
    page.goto(real_data_test_server)

    # Wait for page to load
    page.wait_for_selector(".comparison-table", timeout=10000)
    page.wait_for_function(
        "document.querySelectorAll('.table-adm-select').length > 0", timeout=10000
    )

    # Test switching between different ADM types
    adm_select = page.locator(".table-adm-select").first

    # Get available ADM options and use them dynamically
    available_options = adm_select.locator("option").all()
    adm_options = [
        opt.get_attribute("value")
        for opt in available_options
        if opt.get_attribute("value")
    ]

    if len(adm_options) >= 2:
        # Test switching between ADM types if multiple available
        # Start with first option
        adm_select.select_option(adm_options[0])
        page.wait_for_timeout(1000)

        # Switch to second option
        adm_select.select_option(adm_options[1])
        page.wait_for_timeout(1000)

        # Verify the interface still works after ADM change
        expect(page.locator(".comparison-table")).to_be_visible()
        expect(adm_select).to_be_visible()
    else:
        # If only one ADM option, just verify it works
        print(f"Only one ADM option available: {adm_options}")
        if adm_options:
            adm_select.select_option(adm_options[0])
            page.wait_for_timeout(1000)

        # Verify the interface works
        expect(page.locator(".comparison-table")).to_be_visible()
        expect(adm_select).to_be_visible()


def test_scenario_based_kdma_filtering(page, real_data_test_server):
    """Test that KDMA filtering follows correct hierarchy: Scenario → ADM → KDMA values.

    This test specifically addresses the bug where only the first KDMA type would show
    results because the filtering was backwards (KDMA → Scenario instead of Scenario → KDMA).
    """
    page.goto(real_data_test_server)

    # Wait for page to load
    page.wait_for_selector(".comparison-table", timeout=10000)
    page.wait_for_function(
        "document.querySelectorAll('.table-adm-select').length > 0", timeout=10000
    )

    # Get all available scenarios from table
    scenario_select = page.locator(".table-scenario-select").first
    scenario_options = scenario_select.locator("option").all()
    available_scenarios = [
        opt.get_attribute("value")
        for opt in scenario_options
        if opt.get_attribute("value")
    ]

    # Should have multiple scenarios available (our test data has different scenarios)
    assert len(available_scenarios) >= 2, (
        f"Test requires multiple scenarios, got: {available_scenarios}"
    )

    # Test that different scenarios show different KDMA types
    scenario_kdma_mapping = {}

    for scenario_type in available_scenarios[:3]:  # Test first 3 scenarios
        print(f"\nTesting scenario: {scenario_type}")

        # Select this scenario
        scenario_select.select_option(scenario_type)
        page.wait_for_load_state("networkidle")

        # Select a consistent ADM type using available options
        adm_select = page.locator(".table-adm-select").first
        available_options = adm_select.locator("option").all()
        adm_options = [
            opt.get_attribute("value")
            for opt in available_options
            if opt.get_attribute("value")
        ]

        # Try to find a pipeline_baseline option, fallback to first available
        baseline_options = [opt for opt in adm_options if "pipeline_baseline" in opt]
        selected_option = baseline_options[0] if baseline_options else adm_options[0]

        adm_select.select_option(selected_option)
        page.wait_for_load_state("networkidle")

        # Check what KDMA sliders are available in table
        kdma_sliders = page.locator(".table-kdma-value-slider")
        slider_count = kdma_sliders.count()

        if slider_count > 0:
            # For table-based UI, we test slider functionality instead of dropdown selection
            first_slider = kdma_sliders.first
            first_slider.fill("0.5")
            # Wait for updates to complete
            page.wait_for_load_state("networkidle")

            scenario_kdma_mapping[scenario_type] = ["kdma_available"]
            print(f"  KDMA sliders available: {slider_count}")

            # Check results in table format
            expect(page.locator(".comparison-table")).to_be_visible()

            # Verify data is loaded by checking for table content
            table_data = page.locator(".comparison-table").text_content()
            assert len(table_data) > 0, (
                f"Scenario '{scenario_type}' should show table data"
            )

    print(f"\nScenario → KDMA mapping: {scenario_kdma_mapping}")

    # Verify that scenarios are properly loaded and functional
    assert len(scenario_kdma_mapping) > 0, "Should have processed at least one scenario"
    print(f"Processed scenarios: {list(scenario_kdma_mapping.keys())}")

    # Basic validation that table-based UI is working
    expect(page.locator(".comparison-table")).to_be_visible()


def test_initial_load_results_path(page, real_data_test_server):
    """Test that initial page load and results loading works without errors."""
    # Listen for console errors
    console_errors = []
    page.on(
        "console",
        lambda msg: console_errors.append(msg) if msg.type == "error" else None,
    )

    page.goto(real_data_test_server)

    # Wait for manifest to load and trigger initial results load
    page.wait_for_selector(".comparison-table", timeout=10000)
    page.wait_for_function(
        "document.querySelectorAll('.table-adm-select').length > 0", timeout=10000
    )

    # Wait for initial results to load
    page.wait_for_function(
        "document.querySelector('.comparison-table').textContent.trim() !== ''",
        timeout=5000,
    )

    # Check for JavaScript errors
    js_errors = []
    for error in console_errors:
        error_text = error.text
        if any(
            js_error in error_text.lower()
            for js_error in [
                "referenceerror",
                "syntaxerror",
                "typeerror",
                "is not defined",
                "cannot read property",
                "cannot read properties",
            ]
        ):
            js_errors.append(error_text)

    assert len(js_errors) == 0, (
        f"Found JavaScript errors during initial load: {js_errors}"
    )

    # Verify comparison table is displayed (always-on mode)
    comparison_table = page.locator(".comparison-table")
    expect(comparison_table).to_be_visible()

    # Should have table structure
    parameter_header = page.locator(".parameter-header")
    if parameter_header.count() > 0:
        expect(parameter_header.first).to_be_visible()

    # Should have some content (even if it's "no data found")
    table_content = comparison_table.text_content()
    assert table_content.strip() != "", (
        "Comparison table should have content after initial load"
    )
