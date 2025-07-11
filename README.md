# Align Browser

A static web application for visualizing [align-system](https://github.com/ITM-Kitware/align-system) experiment results.

## Usage

Generate site from experiment data directory and serve website:

```bash
# No installation needed with uvx
uvx align-browser ../experiments
# Creates site in ./align-browser-site/
```

Then visit http://localhost:8000/

Change the port, serve on all network interfaces, or just build the site and don't serve.

```bash
# Specify custom output directory
uvx align-browser ../experiments --output-dir ./demo-site

# Build and serve on custom port
uvx align-browser ../experiments --port 3000

# Build and serve on all network interfaces
uvx align-browser ../experiments --host 0.0.0.0

# Build only without serving
uvx align-browser ../experiments --build-only
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

The build.py script will search for:

- Pipeline directories at the root level
- KDMA experiment directories within each pipeline (identified by presence of `input_output.json`)
- Required files: `.hydra/config.yaml`, `input_output.json`

### Sharing Results

The browser application stores the current selection state in the URL, making it easy to share specific views:

- **Share a specific scenario**: URLs automatically update when you select different pipelines, KDMAs, or experiments
- **Bookmark results**: Save URLs to return to specific experiment comparisons
- **Collaborate**: Send URLs to colleagues to show exact same view of results

## Development

### Installation

```bash
# Install with development dependencies
uv sync --group dev
```

### Development Mode (Edit and Refresh)

For active development of the HTML/CSS/JavaScript:

```bash
# Development mode: edit files in align-browser-site/ directory directly
uv run align-browser ../experiments --dev
```

Edit align-browser-site/index.html, align-browser-site/app.js, align-browser-site/style.css and refresh browser to see changes immediately.

This mode:

- Serves from `align-browser-site/` directory
- Generates data in `align-browser-site/data/`
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

Tests can work with both mock data and real experiment data, and are designed to be flexible about where experiment data is located. By default, they look for experiments in `../experiments`, but you can customize this with the `TEST_EXPERIMENTS_PATH` environment variable:

```bash
# Set custom experiments path
export TEST_EXPERIMENTS_PATH="/path/to/your/experiments"

# Run specific tests
uv run pytest align_browser/test_parsing.py -v
uv run pytest align_browser/test_experiment_parser.py -v
uv run pytest align_browser/test_build.py -v
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
