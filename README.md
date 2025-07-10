# Align Browser

A static web application for visualizing [align-system](https://github.com/ITM-Kitware/align-system) experiment results.

## Installation

```bash
# Install the CLI tool for local use
uv pip install -e .
```

## Usage

Generate deployable sites from experiment data:

```bash
# Creates complete site in ./align-browser-site/
uv run align-browser ../experiments

# Creates complete site in custom directory  
uv run align-browser ../experiments --output-dir ./my-site

# Build and serve on custom port
uv run align-browser ../experiments --port 3000

# Build and serve on all network interfaces
uv run align-browser ../experiments --host 0.0.0.0

# Build only without serving
uv run align-browser ../experiments --build-only
```

### CLI Tool Usage

Once published to PyPI:

```bash
# No installation needed - downloads and runs automatically
uvx align-browser ../experiments
# Creates site in ./align-browser-site/

# Or specify custom directory
uvx align-browser ../experiments --output-dir ./demo-site
```

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

### Build details

```bash
# Correct - use the root experiments directory
uv run python align_browser/build.py ../experiments

# Incorrect - don't use individual pipeline directories
uv run python align_browser/build.py ../experiments/pipeline_baseline
```

The script will search for:

- Pipeline directories at the root level
- KDMA experiment directories within each pipeline (identified by presence of `input_output.json`)
- Required files: `.hydra/config.yaml`, `input_output.json`

## Development

### Development Mode (Edit and Refresh)

For active development of the HTML/CSS/JavaScript:

```bash
# Development mode: edit files in dist/ directory directly
uv run python align_browser/build.py ../experiments --dev
# OR: uv run align-browser ../experiments --dev

# Edit dist/index.html, dist/app.js, dist/style.css
# Refresh browser to see changes immediately
```

This mode:
- Serves from `dist/` directory
- Generates data in `dist/data/`
- Edit static files directly and refresh browser
- Perfect for development workflow

### Code Quality

Check linting and formatting:

```bash
# Check code quality (linting and formatting)
uv run ruff check --diff && uv run ruff format --check

# Auto-fix linting issues and format code
uv run ruff check --fix && uv run ruff format
```

### Installation

```bash
# Install with development dependencies
uv sync --group dev
```

### Running Tests

```bash
# Run all tests
uv run pytest

# Run specific test files
uv run pytest align_browser/test_parsing.py -v
uv run pytest align_browser/test_build.py -v

# Run with coverage
uv run pytest --cov=align_browser
```

##### Tests

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

### Frontend Testing

For automated frontend testing with Playwright:

```bash
# Install dev dependencies (includes Playwright)
uv sync --group dev

# Install Playwright browsers (one-time setup)
uv run playwright install

# Run frontend tests
uv run pytest align_browser/test_frontend.py -v

# Run frontend tests with visible browser (for debugging)
uv run pytest align_browser/test_frontend.py -v --headed

# Run specific frontend test
uv run pytest align_browser/test_frontend.py::test_page_load -v
```

The frontend tests will:

- Start a local HTTP server
- Run automated browser tests to verify functionality
- Test UI interactions, data loading, and error handling
