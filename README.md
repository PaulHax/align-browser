# Align Browser

A static web application for visualizing [align-system](https://github.com/ITM-Kitware/align-system) experiment results.

## Usage

Generate site from experiment data in align-browser-site directory and serves the website:

```bash
uvx align-browser ./experiment-data
```

Then visit http://localhost:8000/

Change the port, serve on all network interfaces, or just build the site and don't serve.

```bash
# Specify custom output directory
uvx align-browser ./experiment-data --output-dir ./demo-site

# Build and serve on custom port
uvx align-browser ./experiment-data --port 3000

# Build and serve on all network interfaces
uvx align-browser ./experiment-data --host 0.0.0.0

# Build only without serving
uvx align-browser ./experiment-data --build-only
```

### Directory Structure

The build system supports **flexible directory structures** and will recursively search for valid experiment directories at any depth. You can point it to any directory containing experiment data, regardless of how it's organized.

#### Required Files Per Experiment

Each experiment directory must contain:

- `.hydra/config.yaml` - Hydra configuration file
- `input_output.json` - Experiment input/output data
- `timing.json` - Timing information

**Example Structure:**

```
experiments/
├── pipeline_baseline/
│   ├── affiliation-0.0/
│   │   ├── .hydra/config.yaml
│   │   ├── input_output.json
│   │   ├── scores.json          # optional
│   │   └── timing.json
│   └── affiliation-0.1/
│       └── ...
├── deeply/nested/structure/
│   └── experiment_dir/
│       ├── .hydra/config.yaml
│       ├── input_output.json
│       └── timing.json
└── any_organization_works/
    └── ...
```

#### Automatic Filtering

The build system will automatically:

- **Recursively search** through all subdirectories at any depth
- **Skip directories** containing `OUTDATED` in their path (case-insensitive)
- **Only process directories** that contain all required files

### Sharing Results

The browser application stores the current selection state in the URL so you can:

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
uv run align-browser --dev ./experiment-data/phase2_june
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

#### Git Pre-commit Hook (Optional)

**Option 1: Using pre-commit framework (Recommended)**

Install and set up pre-commit hooks using the pre-commit framework:

```bash
# Install pre-commit (if not already installed)
uv add --group dev pre-commit

# Install the git hook scripts
uv run pre-commit install

# (Optional) Run against all files
uv run pre-commit run --all-files
```

This uses the `.pre-commit-config.yaml` file which is tracked in version control, making it easy for all team members to use the same hooks.

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
