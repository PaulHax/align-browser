# Align Browser

A static web application for visualizing ADM (Alignment for Decision Making) results.

## Installation

```bash
pip install -e .
```

## Building the Site

Generate the static site from your experiment data:

```bash
python build.py /path/to/data/directory
```

The script will recursively search the data directory for experiment folders containing:
- `.hydra/config.yaml` - Configuration file
- `input_output.json` - Input/output data  
- `scores.json` - Scoring results
- `timing.json` - Timing information

## Running the HTTP Server

After building, serve the generated site:

```bash
python -m http.server 8000 -d dist
```

Then open http://localhost:8000 in your browser.