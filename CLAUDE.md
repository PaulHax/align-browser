## Project Commands

- Add and run auto-fix command before commits to ensure code quality and consistency
- Use the uv created .venv when trying to run python code or python tests
- Run the uv run python src/build.py ../experiments call after you stop so you can test things manually
- Run the build script after pausing
- Remember to run the build script so you can manually test
- After you make a code change, run the build and the http server
- Don't run the http server after stopping
- Use semantic versioning commit messages
- After you make non trival changes, run ruff linting, then ruff formating, then the tests

## Testing

- **Run all tests**: `uv run pytest -v`
- **Frontend tests only**: `uv run pytest src/test_frontend.py -v`
- **ALWAYS run frontend tests at the start of any coding session before making changes**
- **Run frontend tests frequently during refactoring - after every 2-3 small changes**
- **If making UI or state management changes, run `uv run pytest src/test_frontend.py::test_no_console_errors -v` after each change**
- **Use `uv run pytest src/test_frontend.py -v -k "not pinned_run_removal"` to skip known flaky tests**
- Pytest automatically handles the build process via the `built_frontend` fixture
- No need to manually run build.py - pytest manages the full build and test cycle
- Tests include comprehensive browser automation with Playwright
- The `built_frontend` fixture generates test data and builds the frontend before running tests
- Tests verify UI loading, dropdowns, scenario selection (both base and specific), results display, console errors, and responsive layout

## Build Script Usage

- You can test the build.py script on a real experiment folder one level up in the folder tree. Example: `uv run python src/build.py ../experiments`

## Data Modeling

- We have Pydantic models that represent the input and output JSON

## Data Models

- **InputOutputItem**: Represents scenario input/output data with input choices and ADM decisions
- **InputData**: Contains scenario choices array with unstructured text and KDMA associations
- **Choice objects**: Each choice has unstructured text, action_id, action_type, character_id, kdma_association
- **Output data**: Contains choice index (integer) and action object with justification
- **ADM Decision extraction**: Use choice index from output.choice to get input.choices[index].unstructured for readable choice text
- **Justification location**: Found at output.action.justification, always present
- **Scores and timing**: Separate Pydantic models for structured score and timing data
- Always refer to the Pydantic model definitions in src/experiment_models.py for the exact field structure and types when working with experiment data