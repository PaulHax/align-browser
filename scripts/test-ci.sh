#!/bin/bash
set -e

echo "🔍 Running ruff linting..."
uv run ruff check .

echo "📝 Checking ruff formatting..."
uv run ruff format --check .

echo "🧪 Running all tests..."
uv run pytest -v

echo "🚀 Running tests in parallel..."
uv run pytest -n auto --tb=short

echo "✅ All CI checks passed!"