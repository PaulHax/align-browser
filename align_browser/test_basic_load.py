#!/usr/bin/env python3
"""
Test basic app loading and check for JavaScript errors.
"""

import pytest
from playwright.sync_api import expect

# Fixtures are automatically imported from conftest.py


def test_app_loads_without_errors(page, real_data_test_server):
    """Test that the app loads without JavaScript errors."""
    # Listen for console errors
    console_errors = []
    page.on(
        "console",
        lambda msg: console_errors.append(msg) if msg.type == "error" else None,
    )

    page.goto(real_data_test_server)

    # Wait a bit for any initialization
    page.wait_for_timeout(2000)

    # Check for JavaScript errors
    js_errors = []
    for error in console_errors:
        error_text = error.text
        js_errors.append(error_text)

    # Print errors for debugging
    if js_errors:
        print("\nJavaScript errors found:")
        for error in js_errors:
            print(f"  - {error}")

    assert len(js_errors) == 0, f"Found JavaScript errors: {js_errors}"

    # Check that runs container exists
    runs_container = page.locator("#runs-container")
    expect(runs_container).to_be_visible()

    # Check if table exists (should exist with our default run)
    comparison_table = page.locator(".comparison-table")
    table_exists = comparison_table.is_visible()
    print(f"\nComparison table visible: {table_exists}")

    # Check if any run headers exist
    run_headers = page.locator(".comparison-table th.run-header")
    header_count = run_headers.count()
    print(f"Run headers found: {header_count}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
