"""Test the build.py script end-to-end."""

import sys
import subprocess
import tempfile
import os
from pathlib import Path
from align_browser.test_config import check_experiments_path_exists


def get_resolved_experiments_path():
    """Get the experiments path resolved to absolute path.

    This is important when tests change working directories.

    Returns:
        tuple: (exists: bool, absolute_path: Path or None, message: str)
    """
    exists, path, message = check_experiments_path_exists()
    if exists:
        return True, path.resolve(), message
    else:
        return False, None, message


def test_build_script():
    """Test that build.py creates the expected output structure."""

    # Get the directory where this test file is located
    test_file_dir = Path(__file__).parent

    # Assume build.py is in the same directory as this test file
    build_script = test_file_dir / "build.py"

    assert build_script.exists(), f"build.py not found at: {build_script}"
    print(f"✅ Found build.py at: {build_script}")

    # Check if experiments directory exists using our config
    exists, experiments_path, message = get_resolved_experiments_path()
    print(message)

    if not exists:
        print("⏭️ Skipping build test - experiments directory not available")
        return

    # Get project root for running the build script
    project_root = test_file_dir.parent

    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)
        print(f"🔍 Using temporary directory: {temp_path}")

        try:
            print(f"🔨 Running build script: {build_script}")
            print(f"📁 Experiments path: {experiments_path}")

            # Use the virtual environment python (relative to the test file location)
            venv_python = test_file_dir / "../../.venv/bin/python"
            assert venv_python.exists(), (
                f"Virtual environment python not found at: {venv_python}"
            )

            # Run build script as module with output directed to temp directory
            result = subprocess.run(
                [
                    str(venv_python),
                    "-m",
                    "align_browser.build",
                    str(experiments_path),
                    "--output-dir",
                    str(temp_path / "dist"),
                ],
                capture_output=True,
                text=True,
                timeout=60,  # 60 second timeout
                cwd=project_root,  # Run from project root for proper imports
            )

            assert result.returncode == 0, (
                f"Build script failed with return code {result.returncode}\nSTDOUT: {result.stdout}\nSTDERR: {result.stderr}"
            )

            print("✅ Build script completed successfully")

            # Check that dist directory was created
            dist_dir = temp_path / "dist"
            assert dist_dir.exists(), "dist directory was not created"

            print("✅ dist directory created")

            # Check basic required items exist
            assert (dist_dir / "index.html").exists(), "index.html not found"
            print("✅ Found: index.html")

            # Check that data directory exists and has some content
            data_dir = dist_dir / "data"
            assert data_dir.exists(), "data directory not found"
            print("✅ Found: data directory")

            # Check that data directory has some experiment subdirectories with JSON files
            json_files_found = 0
            for item in data_dir.rglob("*.json"):
                json_files_found += 1
                if json_files_found >= 5:  # Just need to find a few JSON files
                    break

            assert json_files_found > 0, "No JSON files found in data directory"
            print(f"✅ Found {json_files_found}+ JSON files in data directory")

        except subprocess.TimeoutExpired:
            assert False, "Build script timed out after 60 seconds"
        except Exception as e:
            assert False, f"Error running build script: {e}"


def test_build_output_location():
    """Test that build script creates dist directory in current working directory."""
    # Get the directory where this test file is located
    test_file_dir = Path(__file__).parent
    project_root = test_file_dir.parent

    # Assume build.py is in the same directory as this test file
    build_script = test_file_dir / "build.py"

    # Check if experiments directory exists using our config
    exists, experiments_path, message = get_resolved_experiments_path()
    print(message)

    if not exists:
        print(
            "⏭️ Skipping build output location test - experiments directory not available"
        )
        return

    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)
        print(f"🔍 Using temporary directory as working directory: {temp_path}")

        try:
            # Change to temporary directory - this is our "current working directory"
            original_cwd = os.getcwd()
            os.chdir(temp_path)
            current_working_dir = Path.cwd()

            print(f"📂 Current working directory: {current_working_dir}")
            print(f"🔨 Running build script: {build_script}")
            print(f"📁 Experiments path: {experiments_path}")

            # Use the virtual environment python
            venv_python = test_file_dir / "../../.venv/bin/python"

            result = subprocess.run(
                [str(venv_python), "-m", "align_browser.build", str(experiments_path)],
                capture_output=True,
                text=True,
                timeout=60,
                cwd=project_root,  # Run from project root for proper imports
            )

            assert result.returncode == 0, (
                f"Build script failed with return code {result.returncode}\nSTDOUT: {result.stdout}\nSTDERR: {result.stderr}"
            )

            print("✅ Build script completed successfully")

            # The key test: verify dist directory is in current working directory
            expected_dist_dir = current_working_dir / "dist"
            if not expected_dist_dir.exists():
                available_dirs = [
                    str(item) for item in current_working_dir.iterdir() if item.is_dir()
                ]
                assert False, (
                    f"dist directory not found in current working directory\nExpected: {expected_dist_dir}\nAvailable directories: {available_dirs}"
                )

            print(f"✅ Found dist directory in correct location: {expected_dist_dir}")

            # Verify it's not created elsewhere (like in the script directory)
            script_dist = test_file_dir / "dist"
            assert not script_dist.exists(), (
                f"dist directory incorrectly created in script directory: {script_dist}"
            )

            print("✅ Confirmed dist directory not created in script directory")

            # Basic sanity check - make sure dist has expected content
            assert (expected_dist_dir / "index.html").exists(), (
                "index.html not found in dist directory"
            )
            print("✅ Found expected content (index.html) in dist directory")

        except subprocess.TimeoutExpired:
            assert False, "Build script timed out after 60 seconds"
        except Exception as e:
            assert False, f"Error running build script: {e}"
        finally:
            # Always restore original working directory
            os.chdir(original_cwd)


def main():
    """Run the build tests."""
    print("🧪 Testing build.py script...\n")

    tests = [
        ("Build script functionality", test_build_script),
        ("Build output location", test_build_output_location),
    ]

    passed = 0
    failed = 0

    for test_name, test_func in tests:
        print(f"\n🔬 Running test: {test_name}")
        try:
            if test_func():
                print(f"✅ {test_name} PASSED")
                passed += 1
            else:
                print(f"❌ {test_name} FAILED")
                failed += 1
        except Exception as e:
            print(f"❌ {test_name} ERROR: {e}")
            failed += 1

    print("\n📊 Test Results:")
    print(f"✅ Passed: {passed}")
    print(f"❌ Failed: {failed}")
    print(f"📈 Success rate: {passed}/{passed + failed}")

    return failed == 0


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
