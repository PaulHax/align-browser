## Project Commands

- Add and run auto-fix command before commits to ensure code quality and consistency
- Use the uv created .venv when trying to run python code or python tests

## Testing

- **Run all tests**: `uv run pytest -v`
- **Frontend tests only**: `uv run pytest src/test_frontend.py -v`
- Pytest automatically handles the build process via the `built_frontend` fixture
- No need to manually run build.py - pytest manages the full build and test cycle
- Tests include comprehensive browser automation with Playwright
- The `built_frontend` fixture generates test data and builds the frontend before running tests
- Tests verify UI loading, dropdowns, scenario selection (both base and specific), results display, console errors, and responsive layout

## Build Script Usage

- You can test the build.py script on a real experiment folder one level up in the folder tree. Example: `uv run python src/build.py ../experiments`