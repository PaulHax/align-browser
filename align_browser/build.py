import shutil
import json
import http.server
import socket
from pathlib import Path
import argparse
from datetime import datetime

try:
    from importlib.resources import files
except ImportError:
    # Fallback for Python < 3.9
    from importlib_resources import files
from align_browser.experiment_parser import (
    parse_experiments_directory,
    build_manifest_from_experiments,
    copy_experiment_files,
)


def copy_static_assets(output_dir):
    """Copy static assets from package static/ directory to output directory."""
    try:
        # Use importlib.resources for robust package data access
        static_files = files("align_browser.static")

        for filename in ["index.html", "app.js", "state.js", "style.css"]:
            try:
                # Read the file content from the package
                file_content = (static_files / filename).read_bytes()

                # Write to destination
                dst_file = output_dir / filename
                dst_file.write_bytes(file_content)

            except FileNotFoundError:
                pass

    except Exception as e:
        # Fallback to filesystem approach for development
        print(f"Package resource access failed, trying filesystem fallback: {e}")
        script_dir = Path(__file__).parent
        static_dir = script_dir / "static"

        if not static_dir.exists():
            raise FileNotFoundError(f"Static assets directory not found: {static_dir}")

        static_files = ["index.html", "app.js", "state.js", "style.css"]

        for filename in static_files:
            src_file = static_dir / filename
            dst_file = output_dir / filename

            if src_file.exists():
                shutil.copy2(src_file, dst_file)


def build_frontend(
    experiments_root: Path,
    output_dir: Path,
    dev_mode: bool = False,
    build_only: bool = True,
):
    """
    Build frontend with experiment data.

    Args:
        experiments_root: Path to experiments directory
        output_dir: Output directory for the site
        dev_mode: Use development mode (no static asset copying)
        build_only: Only build data, don't start server
    """
    print(f"Processing experiments directory: {experiments_root}")

    # Determine output directory based on mode
    if dev_mode:
        print("Development mode: using provided directory")
    else:
        # Production mode: copy static assets
        print(f"Production mode: creating site in {output_dir}")
        output_dir.mkdir(parents=True, exist_ok=True)
        copy_static_assets(output_dir)

    # Create data subdirectory and clean it
    data_output_dir = output_dir / "data"
    if data_output_dir.exists():
        shutil.rmtree(data_output_dir)
    data_output_dir.mkdir(exist_ok=True)

    # Parse experiments and build manifest
    experiments = parse_experiments_directory(experiments_root)
    manifest = build_manifest_from_experiments(experiments, experiments_root)

    manifest.generated_at = datetime.now().isoformat()

    # Copy experiment data files
    copy_experiment_files(experiments, experiments_root, data_output_dir)

    # Save manifest in data subdirectory
    with open(data_output_dir / "manifest.json", "w") as f:
        json.dump(manifest.model_dump(), f, indent=2)

    print(f"Data generated in {data_output_dir}")

    return output_dir


def main():
    parser = argparse.ArgumentParser(
        description="Generate static web app for ADM Results."
    )
    parser.add_argument(
        "experiments",
        type=str,
        help="Path to the root experiments directory (e.g., ../experiments)",
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default="align-browser-site",
        help="Output directory for the generated site (default: align-browser-site)",
    )
    parser.add_argument(
        "--build-only",
        action="store_true",
        help="Only build data, don't start HTTP server (default: build and serve)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=8000,
        help="Port for HTTP server (default: 8000)",
    )
    parser.add_argument(
        "--host",
        type=str,
        default="localhost",
        help="Host to bind to (default: localhost, use 0.0.0.0 for all interfaces)",
    )
    parser.add_argument(
        "--dev",
        action="store_true",
        help="Development mode: serve from dist/ directory and edit files directly",
    )
    args = parser.parse_args()

    experiments_root = Path(args.experiments).resolve()

    if not experiments_root.exists():
        print(f"Error: Experiments directory does not exist: {experiments_root}")
        exit(1)

    # Determine output directory based on mode
    if args.dev:
        # Development mode: use static/ directory for live editing
        script_dir = Path(__file__).parent
        output_dir = script_dir / "static"

        # Ensure development directory exists
        if not output_dir.exists():
            raise FileNotFoundError(
                f"Development mode requires static/ directory: {output_dir}"
            )

        build_frontend(
            experiments_root, output_dir, dev_mode=True, build_only=args.build_only
        )
    else:
        # Production mode: use specified output directory
        output_dir = Path(args.output_dir).resolve()
        build_frontend(
            experiments_root, output_dir, dev_mode=False, build_only=args.build_only
        )

    # Start HTTP server if not build-only
    if not args.build_only:
        serve_directory(output_dir, args.host, args.port)


def serve_directory(directory, host="localhost", port=8000):
    """Start HTTP server to serve the specified directory."""
    import os

    # Change to the output directory
    original_dir = os.getcwd()
    try:
        os.chdir(directory)

        # Find an available port starting from the requested port
        actual_port = find_available_port(port, host)

        # Create HTTP server
        handler = http.server.SimpleHTTPRequestHandler
        with http.server.HTTPServer((host, actual_port), handler) as httpd:
            # Enable socket reuse to prevent "Address already in use" errors
            httpd.socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            # Display appropriate URL based on host
            if host == "0.0.0.0":
                url = f"http://localhost:{actual_port}"
                print(
                    f"Serving {directory} on all network interfaces at port {actual_port}"
                )
                print(f"Local access: {url}")
                print(f"Network access: http://<your-ip>:{actual_port}")
            else:
                url = f"http://{host}:{actual_port}"
                print(f"Serving {directory} at {url}")

            if actual_port != port:
                print(f"Port {port} was busy, using port {actual_port} instead")

            print("Press Ctrl+C to stop the server")
            try:
                httpd.serve_forever()
            except KeyboardInterrupt:
                print("\nServer stopped")

    finally:
        # Restore original directory
        os.chdir(original_dir)


def find_available_port(start_port=8000, host="localhost"):
    """Find an available port starting from start_port."""
    port = start_port
    bind_host = "" if host == "0.0.0.0" else host

    while port < start_port + 100:  # Try up to 100 ports
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind((bind_host, port))
                return port
        except OSError:
            port += 1

    # If no port found in range, let the system assign one
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind((bind_host, 0))
        return s.getsockname()[1]


if __name__ == "__main__":
    main()
