#!/usr/bin/env python3
"""
Shared pytest fixtures for frontend testing.
"""

import threading
import time
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
                time.sleep(0.1)  # Reduced from 0.5

                yield self.base_url

        finally:
            # Restore original directory
            import os

            os.chdir(original_cwd)

            if self.server:
                self.server.shutdown()


@pytest.fixture(scope="session")
def frontend_with_real_data():
    """Prepare frontend build directory with real experiment data."""
    project_root = Path(__file__).parent.parent

    # Use a dedicated test build directory for real data under temp
    temp_dir = project_root / "temp"
    temp_dir.mkdir(exist_ok=True)
    frontend_dir = temp_dir / "test-build-real"
    frontend_dir.mkdir(exist_ok=True)

    # Ensure experiment data is downloaded
    experiment_data_dir = project_root / "experiment-data"
    combined_rerun_dir = experiment_data_dir / "combined_rerun"

    # Download experiments if combined_rerun directory doesn't exist
    if not combined_rerun_dir.exists():
        print("Downloading experiment data for tests...")
        import urllib.request
        import zipfile

        zip_path = experiment_data_dir / "experiments.zip"

        # Create experiment-data directory if it doesn't exist
        experiment_data_dir.mkdir(exist_ok=True)

        # Download the zip file
        url = "https://github.com/PaulHax/align-browser/releases/download/v0.2.1/experiments.zip"
        print(f"Downloading {url}...")

        urllib.request.urlretrieve(url, zip_path)
        print(f"Downloaded to {zip_path}")

        # Extract the zip file
        print(f"Extracting {zip_path}...")
        with zipfile.ZipFile(zip_path, "r") as zip_ref:
            zip_ref.extractall(experiment_data_dir)

        # Delete the zip file after extraction
        zip_path.unlink()
        print(f"Extracted to {experiment_data_dir}")
        print("Experiment data ready for testing!")

    # Use the combined_rerun directory for real experiment data
    real_experiments_root = experiment_data_dir / "combined_rerun"

    if not real_experiments_root.exists() or not any(real_experiments_root.iterdir()):
        pytest.skip(f"Real experiment data not found at {real_experiments_root}")

    # Use the build system to generate data with real experiments
    from .build import build_frontend

    build_frontend(
        experiments_root=real_experiments_root,
        output_dir=frontend_dir,
        dev_mode=False,  # Full build for tests
        build_only=True,
    )

    yield frontend_dir

    # Cleanup test build directory
    import shutil

    if frontend_dir.exists():
        shutil.rmtree(frontend_dir)


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
