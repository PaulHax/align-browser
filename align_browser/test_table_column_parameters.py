#!/usr/bin/env python3
"""
Test parameter changes within table columns.
Tests parameter interactions with editable controls in pinned run columns,
including the default first column which replaced the sidebar.
"""

import pytest

# Fixtures are automatically imported from conftest.py


def setup_table_with_columns(page, test_server, num_columns=2):
    """Helper to set up table with multiple columns for testing."""
    page.goto(test_server)
    page.wait_for_selector(".comparison-table", timeout=10000)
    page.wait_for_function(
        "document.querySelectorAll('.table-adm-select').length > 0", timeout=10000
    )

    # Make initial selection to enable pinning using table controls
    adm_selects = page.locator(".table-adm-select")
    adm_selects.first.select_option("pipeline_baseline")
    page.wait_for_timeout(1000)

    # Pin current configuration
    pin_button = page.locator("#pin-current-run")
    pin_button.click()
    page.wait_for_timeout(500)

    # Add more columns if requested
    for i in range(1, num_columns):
        # Change a parameter to make it different using table controls
        scenario_selects = page.locator(".table-scenario-select")
        if scenario_selects.count() > 0:
            options = scenario_selects.first.locator("option").all()
            if len(options) > 1:
                scenario_selects.first.select_option(
                    options[i % len(options)].get_attribute("value")
                )
                page.wait_for_timeout(500)

        # Pin again
        pin_button.click()
        page.wait_for_timeout(500)

    return page.locator(".comparison-table")


def test_table_column_scenario_selection(page, test_server):
    """Test that scenario selectors in table columns update properly."""
    table = setup_table_with_columns(page, test_server, 2)

    # Find scenario selectors in the second column (first pinned column)
    # Look for selects in configuration rows
    scenario_selects = page.locator(
        ".comparison-table tbody tr[data-category='base_scenario'] td:nth-child(2) select"
    )

    if scenario_selects.count() > 0:
        # Find the scenario select (usually one of the first)
        scenario_select = None
        for i in range(scenario_selects.count()):
            select = scenario_selects.nth(i)
            # Check if this is a scenario selector by looking at options
            first_option = select.locator("option").first
            if first_option.count() > 0:
                option_text = first_option.text_content()
                if "scenario" in option_text.lower():
                    scenario_select = select
                    break

        if scenario_select:
            # Get current value
            initial_value = scenario_select.input_value()

            # Get available options
            options = scenario_select.locator("option").all()
            available_values = [
                opt.get_attribute("value")
                for opt in options
                if opt.get_attribute("value")
            ]

            # Find a different value
            new_value = None
            for val in available_values:
                if val != initial_value:
                    new_value = val
                    break

            if new_value:
                # Change selection
                scenario_select.select_option(new_value)
                page.wait_for_timeout(1000)

                # Verify it changed
                current_value = scenario_select.input_value()
                assert current_value == new_value, (
                    f"Scenario should have changed to {new_value}"
                )

                # Check that the table still exists after the change (basic validation)
                table = page.locator(".comparison-table")
                assert table.count() > 0, (
                    "Table should still exist after parameter change"
                )


def test_table_column_adm_updates_llm(page, test_server):
    """Test that ADM selector in table column updates available LLM options."""
    table = setup_table_with_columns(page, test_server, 2)

    # Find ADM selector in second column
    adm_selects = page.locator(".comparison-table tbody tr td:nth-child(2) select")

    # Look for ADM selector
    adm_select = None
    for i in range(adm_selects.count()):
        select = adm_selects.nth(i)
        options = select.locator("option").all()
        option_values = [
            opt.get_attribute("value") for opt in options if opt.get_attribute("value")
        ]
        if "pipeline_baseline" in option_values or "pipeline_random" in option_values:
            adm_select = select
            break

    if adm_select:
        # Get initial ADM value
        initial_adm = adm_select.input_value()

        # Find LLM selector (should be after ADM selector)
        llm_select = None
        found_adm = False
        for i in range(adm_selects.count()):
            select = adm_selects.nth(i)
            if select == adm_select:
                found_adm = True
                continue
            if found_adm:
                # Check if this looks like LLM selector
                options = select.locator("option").all()
                if options:
                    first_text = options[0].text_content()
                    if "llm" in first_text.lower() or "mistral" in first_text.lower():
                        llm_select = select
                        break

        if llm_select:
            # Get initial LLM options
            initial_llm_options = llm_select.locator("option").all()
            initial_llm_values = [
                opt.get_attribute("value") for opt in initial_llm_options
            ]

            # Change ADM type
            new_adm = (
                "pipeline_random"
                if initial_adm == "pipeline_baseline"
                else "pipeline_baseline"
            )
            adm_select.select_option(new_adm)
            page.wait_for_timeout(1000)

            # Check LLM options changed
            new_llm_options = llm_select.locator("option").all()
            new_llm_values = [opt.get_attribute("value") for opt in new_llm_options]

            # Options should be different for different ADM types
            assert new_llm_values != initial_llm_values, (
                "LLM options should change when ADM type changes"
            )


def test_table_column_kdma_sliders(page, test_server):
    """Test KDMA sliders in table columns are interactive."""
    table = setup_table_with_columns(page, test_server, 2)

    # Find KDMA sliders in second column
    kdma_sliders = page.locator(
        ".comparison-table tbody tr td:nth-child(2) input[type='range']"
    )

    if kdma_sliders.count() > 0:
        slider = kdma_sliders.first

        # Get associated value display
        value_display = slider.locator("xpath=following-sibling::span[1]")

        # Get initial value
        initial_value = slider.input_value()
        initial_display = value_display.text_content()

        # Change value
        new_value = "0.8" if initial_value != "0.8" else "0.3"
        slider.fill(new_value)
        slider.dispatch_event("input")
        page.wait_for_timeout(500)

        # Verify value changed
        current_value = slider.input_value()
        current_display = value_display.text_content()

        assert current_value == new_value, f"Slider value should be {new_value}"
        assert current_display == new_value, f"Display should show {new_value}"

        # Results should update
        page.wait_for_timeout(1000)


def test_table_column_base_scenario_updates_specific(page, test_server):
    """Test that changing base scenario in column updates specific scenario options."""
    table = setup_table_with_columns(page, test_server, 2)

    # Find selectors in second column
    selects = page.locator(
        ".comparison-table tbody tr[data-category='base_scenario'] td:nth-child(2) select"
    ).all()

    # Identify base and specific scenario selectors
    base_scenario_select = None
    specific_scenario_select = None

    for i, select in enumerate(selects):
        options = select.locator("option").all()
        if options:
            # Check first option text to identify selector type
            first_text = options[0].text_content()
            if "test_scenario" in first_text and "_" in first_text:
                # Full scenario like test_scenario_1
                if not first_text.split("_")[2].isdigit():
                    base_scenario_select = select
                else:
                    specific_scenario_select = select

    if base_scenario_select and specific_scenario_select:
        # Get initial specific scenario options
        initial_options = specific_scenario_select.locator("option").all()
        initial_values = [opt.get_attribute("value") for opt in initial_options]

        # Change base scenario
        base_options = base_scenario_select.locator("option").all()
        if len(base_options) > 1:
            current_base = base_scenario_select.input_value()
            new_base = None
            for opt in base_options:
                val = opt.get_attribute("value")
                if val != current_base:
                    new_base = val
                    break

            if new_base:
                base_scenario_select.select_option(new_base)
                page.wait_for_timeout(1000)

                # Check specific scenario options updated
                new_options = specific_scenario_select.locator("option").all()
                new_values = [opt.get_attribute("value") for opt in new_options]

                # All new options should start with the new base scenario
                for val in new_values:
                    assert val.startswith(new_base + "_"), (
                        f"Specific scenario {val} should start with {new_base}_"
                    )


def test_multiple_columns_independent_controls(page, test_server):
    """Test that controls in different columns work independently."""
    table = setup_table_with_columns(page, test_server, 3)

    # Find sliders in different columns
    col2_sliders = page.locator(
        ".comparison-table tbody tr td:nth-child(2) input[type='range']"
    )
    col3_sliders = page.locator(
        ".comparison-table tbody tr td:nth-child(3) input[type='range']"
    )

    if col2_sliders.count() > 0 and col3_sliders.count() > 0:
        slider2 = col2_sliders.first
        slider3 = col3_sliders.first

        # Set different values
        slider2.fill("0.3")
        slider2.dispatch_event("input")
        page.wait_for_timeout(300)

        slider3.fill("0.7")
        slider3.dispatch_event("input")
        page.wait_for_timeout(300)

        # Verify they have different values
        value2 = slider2.input_value()
        value3 = slider3.input_value()

        assert value2 == "0.3", "Column 2 slider should be 0.3"
        assert value3 == "0.7", "Column 3 slider should be 0.7"
        assert value2 != value3, (
            "Sliders in different columns should maintain independent values"
        )


def test_column_parameter_validation(page, test_server):
    """Test that column parameters validate properly (e.g., LLM options based on ADM)."""
    table = setup_table_with_columns(page, test_server, 2)

    # This test ensures that invalid combinations are prevented
    # For example, if an ADM type doesn't support certain LLMs,
    # those options shouldn't be available

    selects = page.locator(".comparison-table tbody tr td:nth-child(2) select").all()

    # Find ADM and LLM selectors
    adm_select = None
    llm_select = None

    for select in selects:
        options = select.locator("option").all()
        option_values = [
            opt.get_attribute("value") for opt in options if opt.get_attribute("value")
        ]

        if "pipeline_baseline" in option_values or "pipeline_random" in option_values:
            adm_select = select
        elif any(
            "llm" in val.lower() or "mistral" in val.lower() for val in option_values
        ):
            llm_select = select

    if adm_select and llm_select:
        # Set to pipeline_random (which might have limited LLM options)
        adm_select.select_option("pipeline_random")
        page.wait_for_timeout(1000)

        # Check available LLMs
        llm_options = llm_select.locator("option").all()
        llm_values = [
            opt.get_attribute("value")
            for opt in llm_options
            if opt.get_attribute("value")
        ]

        # Verify appropriate options (this depends on test data)
        # At minimum, should have some options
        assert len(llm_values) > 0, "Should have at least one LLM option"

        # For pipeline_random, might include "no_llm"
        if "no_llm" in llm_values:
            # This is expected for pipeline_random
            print("✓ pipeline_random correctly includes no_llm option")


def test_column_add_preserves_data(page, test_server):
    """Test that adding new columns preserves data in existing columns."""
    table = setup_table_with_columns(page, test_server, 2)

    # Get a value from the first pinned column before adding another
    first_col_selects = page.locator(
        ".comparison-table tbody tr td:nth-child(2) select"
    )
    initial_value = None
    if first_col_selects.count() > 0:
        initial_value = first_col_selects.first.input_value()

    # Add another column
    add_button = page.locator("#add-column-btn")
    if add_button.is_visible():
        add_button.click()
        page.wait_for_timeout(1000)

        # Check that first column value is preserved
        if initial_value:
            current_value = first_col_selects.first.input_value()
            assert current_value == initial_value, (
                "Adding column should not change existing column values"
            )


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
