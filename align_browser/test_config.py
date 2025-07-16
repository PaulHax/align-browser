"""Shared configuration for test files."""

import os
from pathlib import Path


def get_experiments_path():
    """Get the path to the experiments directory.

    Returns the path configured via environment variable TEST_EXPERIMENTS_PATH,
    or falls back to the default relative path "../../experiments".

    Returns:
        Path: The path to the experiments directory
    """
    env_path = os.environ.get("TEST_EXPERIMENTS_PATH")
    if env_path:
        return Path(env_path)
    else:
        # Default fallback to relative path (one directory above the root)
        return Path("../../experiments")


def check_experiments_path_exists():
    """Check if the experiments directory exists and return status.

    Returns:
        tuple: (exists: bool, path: Path, message: str)
    """
    experiments_path = get_experiments_path()

    if experiments_path.exists():
        message = f"✅ Experiments directory found at {experiments_path}"
        return (
            True,
            experiments_path,
            message,
        )
    else:
        env_var_set = "TEST_EXPERIMENTS_PATH" in os.environ
        if env_var_set:
            message = f"❌ Experiments directory not found at {experiments_path} (from TEST_EXPERIMENTS_PATH)"
        else:
            message = f"❌ Experiments directory not found at {experiments_path} (default path)"
        return False, experiments_path, message


def get_experiments_path_or_skip():
    """Get experiments path, or return None if it doesn't exist (for skipping tests).

    This function prints a message about the status and returns None if the path
    doesn't exist, which can be used to skip tests gracefully.

    Returns:
        Path or None: The experiments path if it exists, None otherwise
    """
    exists, path, message = check_experiments_path_exists()
    print(message)

    if not exists:
        env_var_set = "TEST_EXPERIMENTS_PATH" in os.environ
        if not env_var_set:
            print(
                "💡 Tip: Set TEST_EXPERIMENTS_PATH environment variable to specify a custom experiments directory"
            )
        return None

    return path


def test_get_experiments_path():
    """Test that get_experiments_path returns a Path object."""
    path = get_experiments_path()
    assert isinstance(path, Path)


def test_check_experiments_path_exists():
    """Test that check_experiments_path_exists returns expected format."""
    exists, path, message = check_experiments_path_exists()
    assert isinstance(exists, bool)
    assert isinstance(path, Path)
    assert isinstance(message, str)
