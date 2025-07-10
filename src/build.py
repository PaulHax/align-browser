import shutil
import json
import http.server
import socket
from pathlib import Path
import argparse
from datetime import datetime
from experiment_parser import (
    parse_experiments_directory,
    build_manifest_from_experiments,
    copy_experiment_files,
)


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
        default="dist",
        help="Output directory for the generated data (default: dist)",
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
    args = parser.parse_args()

    experiments_root = Path(args.experiments).resolve()

    print(f"Processing experiments directory: {experiments_root}")

    # Output directory is always relative to current working directory
    output_dir = Path(args.output_dir).resolve()

    # Ensure output directory exists
    output_dir.mkdir(parents=True, exist_ok=True)

    # Create data subdirectory and clean it
    data_output_dir = output_dir / "data"
    if data_output_dir.exists():
        shutil.rmtree(data_output_dir)
    data_output_dir.mkdir(exist_ok=True)

    # Parse experiments and build manifest
    experiments = parse_experiments_directory(experiments_root)
    manifest = build_manifest_from_experiments(experiments, experiments_root)

    # Add generation timestamp
    manifest.metadata["generated_at"] = datetime.now().isoformat()

    # Copy experiment data files
    copy_experiment_files(experiments, experiments_root, data_output_dir)

    # Save manifest in data subdirectory
    with open(data_output_dir / "manifest.json", "w") as f:
        json.dump(manifest.model_dump(), f, indent=2)

    print(f"Data generated in {data_output_dir}")

    # Start HTTP server unless build-only is specified
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
