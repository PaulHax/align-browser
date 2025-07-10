# Align Browser

A static web application for visualizing ADM (Alignment for Decision Making) results.

## Installation

```bash
# Install dependencies with uv
uv sync

# Install with development dependencies
uv sync --group dev
```

## Usage

### Building the Site

Generate the static site from your experiments:

```bash
uv run python src/build.py ../experiments
```

After building, serve the site locally:

```bash
# Serve the site on http://localhost:8000
python -m http.server 8000 -d dist
```

Then open http://localhost:8000 in your browser to view the app.

### Expected Directory Structure

The experiments directory should be the root containing pipeline directories (e.g., `pipeline_baseline`, `pipeline_random`), not an individual pipeline directory.

```
experiments/
├── pipeline_baseline/
│   ├── affiliation-0.0/
│   │   ├── .hydra/config.yaml
│   │   ├── input_output.json
│   │   ├── scores.json
│   │   └── timing.json
│   ├── affiliation-0.1/
│   │   └── ...
│   └── ...
├── pipeline_random/
│   └── ...
└── pipeline_other/
    └── ...
```

### Usage Examples

```bash
# Correct - use the root experiments directory
uv run python src/build.py ../experiments

# Incorrect - don't use individual pipeline directories
uv run python src/build.py ../experiments/pipeline_baseline
```

The script will search for:

- Pipeline directories at the root level
- KDMA experiment directories within each pipeline (identified by presence of `input_output.json`)
- Required files: `.hydra/config.yaml`, `input_output.json`

## Development

### Running Tests

```bash
# Run all tests
uv run pytest

# Run specific test files
uv run pytest src/test_parsing.py -v
uv run pytest src/test_build.py -v

# Run with coverage
uv run pytest --cov=src
```

#### Test Configuration

This directory contains test files that can work with both mock data and real experiment data.

The test files are designed to be flexible about where experiment data is located. By default, they look for experiments in the relative path `../experiments`, but this can be customized.

You can set the `TEST_EXPERIMENTS_PATH` environment variable to specify a custom path to your experiments directory:

```bash
# Set custom experiments path
export TEST_EXPERIMENTS_PATH="/path/to/your/experiments"

# Run tests
uv run python test_parsing.py
uv run python test_experiment_parser.py
uv run python test_build.py
```

**Test Behavior:**

- **If experiments directory exists**: Tests will run against real data
- **If experiments directory doesn't exist**: Tests will either skip gracefully or run with mock data only
- **Custom path via environment**: Use `TEST_EXPERIMENTS_PATH` to point to experiments anywhere on your system

**Test Files:**

1. **`test_experiment_parser.py`** - Unit tests for parsing models and functions

   - Runs with mock data by default
   - Has one test that optionally tests with real experiments if available

2. **`test_parsing.py`** - Integration tests with real experiment data

   - Designed specifically for real data testing
   - Skips tests gracefully if experiments directory not found

3. **`test_build.py`** - End-to-end build testing
   - Tests the build script with real experiments
   - Skips if experiments directory not available

### Frontend Testing

For automated frontend testing with Playwright:

```bash
# Install dev dependencies (includes Playwright)
uv sync --group dev

# Install Playwright browsers (one-time setup)
uv run playwright install

# Run frontend tests
uv run pytest src/test_frontend.py -v

# Run frontend tests with visible browser (for debugging)
uv run pytest src/test_frontend.py -v --headed

# Run specific frontend test
uv run pytest src/test_frontend.py::test_page_load -v
```

The frontend tests will:

- Build the static site with test data
- Start a local HTTP server
- Run automated browser tests to verify functionality
- Test UI interactions, data loading, and error handling

### Code Quality

Check linting and formatting:

```bash
# Check code quality (linting and formatting)
uv run ruff check --diff && uv run ruff format --check

# Auto-fix linting issues and format code
uv run ruff check --fix && uv run ruff format
```
