# Multi-Run Comparison Table Design

## Overview

Design for displaying multiple experimental runs side-by-side to easily compare parameters and outcomes. **Key requirement**: Always show current run with live parameter updates PLUS pinned runs for comparison.

**Phase 1 Approach**: Instead of converting to a table format immediately, we'll use a simpler flexbox layout that shifts the existing run display to the right when pinning, preserving all current formatting and display logic.

## User Requirements Summary

Based on user feedback during implementation:

1. **Always Multi-Mode**: "I don't want a single vs multi display mode. It always multi mode. The Columns fill out as the user adds them."

2. **Current Run + Pinned Runs**: "The current run selected by the current parameters also should live in the table" + "add a pin button to stack the current run to the right, and a new active run section that the parameters operates on appears"

3. **Preserve Original Behavior**: "Changing the Parameters should always update a visible run with resolved run results and display them. Just like before."

4. **All Original Fields in Table**: "I would like to keep all the content we had displayed for each run before this table effort" - ALL detailed fields must be in table rows, not separate sections.

5. **Proper Data Extraction**: "ADM decision and justification are text and N/A respectively they should be the Unstructured readable choice and not N/A. There is always a justification" - Use Pydantic models for proper data access.

6. **No Ellipses for Important Text**: "don't do ellipses for justification. show it with the show more button if its long" + "for the scenario state show more lines of it by default before we add the show more button"

7. **Content Curation**: "remove scenario_unstructured row" - Only show essential fields.

## Final Table Structure

### Columns
- **Leftmost Column**: Current run (live updates with parameter changes) - highlighted with blue border and "Live" badge
- **Additional Columns**: Pinned runs (static snapshots) - each with remove button (×)
- **First Column**: Parameter names (sticky, always visible)

### Rows (Complete Field Set)
All original detailed fields now displayed as table rows:

#### Configuration Parameters
- `scenario` - Selected scenario ID
- `adm_type` - ADM type selection  
- `llm_backbone` - LLM model selection
- `kdma_*` - All active KDMA values (dynamic based on selections)

#### Scenario Details  
- `scenario_state` - Full scenario description (400 char preview, expandable)

#### Available Choices
- `available_choices` - All choice options formatted as compact cards

#### ADM Decision
- `adm_decision` - Selected choice unstructured text (from `input.choices[output.choice].unstructured`)
- `justification` - Full reasoning (from `output.action.justification`, always expandable if >100 chars)

#### Scoring Data
- `overall_score` - Numerical score
- `detailed_scores` - Complete scoring breakdown (compact object display)

#### Timing Data  
- `avg_decision_time` - Decision timing
- `timing_details` - Full timing information (compact object display)

#### Metadata
- `input_metadata` - Additional input parameters (compact object display)
- `output_metadata` - Additional output data (compact object display)

## Key Features (As Implemented)

### 1. Always-On Comparison Mode
- **Current Run Column**: Leftmost column always shows live run based on current parameters
- **Pin Button**: "📌 Pin Current Configuration" copies current run to comparison table  
- **Live Updates**: Current run updates automatically when any parameter changes
- **Visual Distinction**: Current run highlighted with blue border and "Live" badge

### 2. Dynamic Column Management  
- **Add Columns**: Pin button creates new column with current configuration
- **Remove Columns**: X button in pinned run headers to remove from comparison
- **Persistent Current**: Current run column cannot be removed, always visible

### 3. Smart Content Formatting
- **Long Text Handling**: Expandable "Show More/Less" buttons for lengthy content
- **Object Display**: Compact display for complex objects with key fields visible
- **Choice Arrays**: Formatted as mini-cards with truncated descriptions  
- **No Ellipses Rule**: Important fields (justification, scenario state) never truncated with "..."
- **Data Model Aware**: Proper extraction using Pydantic model structure

### 4. Interactive Elements
- **Sticky Headers**: Column headers remain visible when scrolling
- **Sticky First Column**: Parameter names always visible
- **Expandable Content**: Click to expand long text, objects, and choice arrays
- **Tooltips**: Full content available on hover for truncated text

## Data Models Integration

### Pydantic Model Structure
The codebase uses Pydantic models to represent JSON data structures:
- **InputOutputItem**: Represents scenario input/output data with input choices and ADM decisions
- **InputData**: Contains scenario choices array with unstructured text and KDMA associations
- **Choice objects**: Each choice has unstructured text, action_id, action_type, character_id, kdma_association
- **Output data**: Contains choice index (integer) and action object with justification
- **ADM Decision extraction**: Use choice index from output.choice to get input.choices[index].unstructured for readable choice text
- **Justification location**: Found at output.action.justification, always present
- **Scores and timing**: Separate Pydantic models for structured score and timing data

### Implementation Strategy (Final)

#### Phase 1 - Simplified Flexbox Approach

Instead of immediately converting to a table, we'll:
1. Keep the existing run display HTML/CSS completely intact
2. Wrap runs in a horizontal flexbox container
3. When pinning, the current run shifts right and a new current run appears on the left
4. Each pinned run loads its data and displays using the existing rendering logic

#### 1. State Management Extension

```javascript
const appState = {
  // Existing state...
  selectedAdmType: null,
  selectedLLM: null,
  activeKDMAs: {},

  // Comparison state (phase 1 - simplified)
  pinnedRuns: new Map(), // Map<runId, runData> for pinned comparisons
  
  // Run configuration factory
  createRunConfig: () => ({
    id: generateRunId(),
    timestamp: new Date().toISOString(),
    scenario: appState.selectedScenario,
    baseScenario: appState.selectedBaseScenario,
    admType: appState.selectedAdmType,
    llmBackbone: appState.selectedLLM,
    kdmaValues: { ...appState.activeKDMAs },
    experimentKey: getSelectedKey(),
    displayName: generateDisplayName(),
    loadStatus: 'pending'
  })
};
```

#### 2. Data Loading Strategy (Phase 1 - Simplified)

```javascript
// Pin current run to comparison (called by pin button)
async function pinCurrentRun() {
  const runConfig = appState.createRunConfig();
  
  // Check if already pinned
  const existingRunId = findExistingRun(runConfig);
  if (existingRunId) {
    showNotification('This configuration is already pinned');
    return;
  }
  
  // Add to pinned runs with current data
  const pinnedData = {
    ...runConfig,
    inputOutput: appState.currentInputOutput,
    scores: appState.currentScores,
    timing: appState.currentTiming,
    loadStatus: 'loaded'
  };
  
  appState.pinnedRuns.set(runConfig.id, pinnedData);
  updateComparisonDisplay();
}

// Update the display to show current + pinned runs
function updateComparisonDisplay() {
  const container = document.getElementById('run-display-container');
  
  // Clear and rebuild the flexbox layout
  container.innerHTML = '';
  container.style.display = 'flex';
  container.style.overflowX = 'auto';
  container.style.gap = '20px';
  
  // Add current run (leftmost)
  const currentRunDiv = createRunDisplay('current', null, true);
  container.appendChild(currentRunDiv);
  
  // Add all pinned runs
  appState.pinnedRuns.forEach((runData, runId) => {
    const pinnedRunDiv = createRunDisplay(runId, runData, false);
    container.appendChild(pinnedRunDiv);
  });
}

// Create a run display div (reusing existing rendering logic)
function createRunDisplay(runId, runData, isCurrent) {
  const runDiv = document.createElement('div');
  runDiv.className = 'run-display';
  runDiv.id = `run-${runId}`;
  
  if (isCurrent) {
    runDiv.classList.add('current-run');
    runDiv.style.border = '2px solid #2196F3';
  }
  
  // Add header with remove button for pinned runs
  if (!isCurrent) {
    const header = document.createElement('div');
    header.className = 'run-header';
    header.innerHTML = `
      <span>${runData.displayName}</span>
      <button class="remove-run" data-run-id="${runId}">×</button>
    `;
    runDiv.appendChild(header);
  }
  
  // Add the actual run content div
  const contentDiv = document.createElement('div');
  contentDiv.id = isCurrent ? 'run-display' : `run-display-${runId}`;
  runDiv.appendChild(contentDiv);
  
  // If current run, it will be updated by existing logic
  // If pinned run, render the saved data
  if (!isCurrent && runData) {
    renderRunData(contentDiv, runData);
  }
  
  return runDiv;
}
```

#### 3. Parameter Extraction (Final - All Fields)

```javascript
function extractParametersFromRuns(runs) {
  const allParameters = new Map();
  
  // Configuration parameters
  allParameters.set("scenario", { type: "string", required: true, category: "Configuration" });
  allParameters.set("adm_type", { type: "string", required: true, category: "Configuration" });
  allParameters.set("llm_backbone", { type: "string", required: true, category: "Configuration" });
  
  // KDMA parameters (dynamic based on runs)
  runs.forEach((run) => {
    Object.keys(run.kdmaValues || {}).forEach((kdma) => {
      allParameters.set(`kdma_${kdma}`, { type: "number", required: false, category: "KDMAs" });
    });
  });
  
  // Scenario details
  allParameters.set("scenario_state", { type: "longtext", required: false, category: "Scenario Details" });
  
  // Available choices
  allParameters.set("available_choices", { type: "choices", required: false, category: "Choices" });
  
  // ADM Decision (using Pydantic model structure)
  allParameters.set("adm_decision", { type: "text", required: false, category: "ADM Decision" });
  allParameters.set("justification", { type: "longtext", required: false, category: "ADM Decision" });
  
  // Scoring data
  allParameters.set("overall_score", { type: "number", required: false, category: "Scores" });
  allParameters.set("detailed_scores", { type: "object", required: false, category: "Scores" });
  
  // Timing data
  allParameters.set("avg_decision_time", { type: "number", required: false, category: "Timing" });
  allParameters.set("timing_details", { type: "object", required: false, category: "Timing" });
  
  // Input/Output metadata
  allParameters.set("input_metadata", { type: "object", required: false, category: "Metadata" });
  allParameters.set("output_metadata", { type: "object", required: false, category: "Metadata" });
  
  return allParameters;
}

// Data extraction using Pydantic model structure
function getParameterValue(run, paramName) {
  // Configuration parameters
  if (paramName === 'scenario') return run.scenario;
  if (paramName === 'adm_type') return run.admType;
  if (paramName === 'llm_backbone') return run.llmBackbone;
  
  // KDMA parameters
  if (paramName.startsWith('kdma_')) {
    const kdmaName = paramName.replace('kdma_', '');
    return run.kdmaValues[kdmaName] || 'N/A';
  }
  
  // Scenario details
  if (paramName === 'scenario_state' && run.data?.inputOutput?.input) {
    return run.data.inputOutput.input.state || 'N/A';
  }
  
  // Available choices
  if (paramName === 'available_choices' && run.data?.inputOutput?.input?.choices) {
    return run.data.inputOutput.input.choices;
  }
  
  // ADM Decision - proper extraction using Pydantic model structure
  if (paramName === 'adm_decision' && run.data?.inputOutput?.output && run.data?.inputOutput?.input?.choices) {
    const choiceIndex = run.data.inputOutput.output.choice;
    const choices = run.data.inputOutput.input.choices;
    if (typeof choiceIndex === 'number' && choices[choiceIndex]) {
      return choices[choiceIndex].unstructured || choices[choiceIndex].action_id || 'N/A';
    }
    return 'N/A';
  }
  
  // Justification - proper path using Pydantic model structure
  if (paramName === 'justification' && run.data?.inputOutput?.output?.action) {
    return run.data.inputOutput.output.action.justification || 'N/A';
  }
  
  // [Additional parameter extraction logic...]
  return 'N/A';
}
```

## Data Structure

```javascript
// Enhanced run configuration for comparison
const runConfig = {
  id: "adm1_llm1_kdma1-0.5_scenario1_20240101120000",
  timestamp: "2024-01-01T12:00:00",
  displayName: "ADM1 + LLM1 (kdma1=0.5)",

  // Configuration
  scenario: "test_scenario_1-0",
  baseScenario: "test_scenario_1",
  admType: "adm_type_1",
  llmBackbone: "llm_model_1",
  kdmaValues: { "MoralDesertKDMA": 0.5 },
  experimentKey: "adm_type_1_llm_model_1_MoralDesertKDMA-0.5",

  // Loaded data
  data: {
    inputOutput: { input: {...}, output: {...} },
    scores: { score: 0.75 },
    timing: { avg_time_s: 1.234 }
  },

  // Error handling
  error: null,
  loadStatus: 'loaded' // 'loading' | 'loaded' | 'error'
}
```

## UI Controls

### Run Selection Panel

- List of available runs with checkboxes
- Search/filter functionality
- Metadata preview (date, scenario type)
- "Compare" button to add selected runs

### Comparison Tools

- **Share**: Generate shareable link. Serialize the state to the URL all the time to maintain state.
- **pin columns**: Keep certain columns always visible

### Integration with Existing UI (Phase 1 - Simplified)

```html
<!-- Add to existing control panel -->
<div class="comparison-controls" style="margin-top: 20px;">
  <button id="pin-current-run" class="btn btn-primary">
    📌 Pin Current Configuration
  </button>
  <span id="pinned-count" style="margin-left: 10px;">
    Pinned: <span class="count">0</span>
  </span>
  <button id="clear-all-pins" class="btn btn-danger" disabled>Clear All</button>
</div>

<!-- Modify existing run-display to be wrapped in a container -->
<div id="run-display-container" style="display: flex; overflow-x: auto; gap: 20px; padding: 10px;">
  <!-- Current run display will be here -->
  <div id="run-display" class="run-content">
    <!-- Existing run display content -->
  </div>
</div>
```

### CSS for Phase 1

```css
#run-display-container {
  display: flex;
  overflow-x: auto;
  gap: 20px;
  padding: 10px;
  min-height: 600px;
}

.run-display {
  flex: 0 0 auto;
  min-width: 400px;
  max-width: 600px;
  position: relative;
}

.current-run {
  border: 2px solid #2196F3;
  box-shadow: 0 0 10px rgba(33, 150, 243, 0.3);
}

.run-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px;
  background: #f5f5f5;
  border-bottom: 1px solid #ddd;
}

.remove-run {
  background: none;
  border: none;
  font-size: 20px;
  cursor: pointer;
  color: #666;
}

.remove-run:hover {
  color: #f44336;
}
```

### Component Integration Strategy (Phase 1 - Simplified)

```javascript
// Add to existing DOMContentLoaded handler
function initializeComparisonFeatures() {
  // Wrap existing run-display in container if not already done
  const runDisplay = document.getElementById('run-display');
  if (!runDisplay.parentElement || runDisplay.parentElement.id !== 'run-display-container') {
    const container = document.createElement('div');
    container.id = 'run-display-container';
    runDisplay.parentElement.insertBefore(container, runDisplay);
    container.appendChild(runDisplay);
  }
  
  // Pin current run button
  document.getElementById("pin-current-run").addEventListener("click", () => {
    pinCurrentRun();
  });

  // Clear all pins
  document.getElementById("clear-all-pins").addEventListener("click", () => {
    appState.pinnedRuns.clear();
    updateComparisonDisplay();
    updatePinnedCount();
  });
  
  // Event delegation for remove buttons
  document.getElementById('run-display-container').addEventListener('click', (e) => {
    if (e.target.classList.contains('remove-run')) {
      const runId = e.target.dataset.runId;
      appState.pinnedRuns.delete(runId);
      updateComparisonDisplay();
      updatePinnedCount();
    }
  });
}

// Phase 1 - Helper functions

// Update pinned count display
function updatePinnedCount() {
  const count = appState.pinnedRuns.size;
  document.querySelector('#pinned-count .count').textContent = count;
  document.getElementById('clear-all-pins').disabled = count === 0;
  document.getElementById('pin-current-run').disabled = !appState.currentInputOutput;
}

// Check if configuration already exists in pinned runs
function findExistingRun(runConfig) {
  for (const [runId, pinnedRun] of appState.pinnedRuns) {
    if (pinnedRun.experimentKey === runConfig.experimentKey &&
        JSON.stringify(pinnedRun.kdmaValues) === JSON.stringify(runConfig.kdmaValues)) {
      return runId;
    }
  }
  return null;
}

// Render pinned run data using existing display logic
function renderRunData(container, runData) {
  // This function would call the existing rendering functions
  // but apply them to the specific container instead of the main run-display
  // For phase 1, we can duplicate the rendering logic or refactor it to be reusable
  
  // Example structure (using existing display patterns):
  container.innerHTML = `
    <div class="results-header">
      <h3>Results</h3>
    </div>
    <div class="scenario-info">
      <!-- Scenario details from runData -->
    </div>
    <div class="choices-section">
      <!-- Choices from runData.inputOutput -->
    </div>
    <div class="decision-section">
      <!-- ADM decision from runData -->
    </div>
    <div class="scores-section">
      <!-- Scores from runData.scores -->
    </div>
  `;
  
  // TODO: Call existing rendering functions with the container and runData
}

// Helper function to get parameter value from run
function getParameterValue(run, paramName) {
  if (paramName === 'scenario') return run.scenario;
  if (paramName === 'adm_type') return run.admType;
  if (paramName === 'llm_backbone') return run.llmBackbone;
  if (paramName.startsWith('kdma_')) {
    const kdmaName = paramName.replace('kdma_', '');
    return run.kdmaValues[kdmaName] || 'N/A';
  }
  if (paramName === 'overall_score' && run.data?.scores) {
    return run.data.scores.score || run.data.scores;
  }
  if (paramName === 'avg_decision_time' && run.data?.timing) {
    return run.data.timing.avg_time_s;
  }
  if (paramName === 'adm_decision' && run.data?.inputOutput?.output) {
    return run.data.inputOutput.output.choice || 'N/A';
  }
  if (paramName === 'justification' && run.data?.inputOutput?.output) {
    return run.data.inputOutput.output.justification || 'N/A';
  }
  return 'N/A';
}

// Helper function to format values for display
function formatValue(value) {
  if (value === null || value === undefined) return 'N/A';
  if (typeof value === 'number') return value.toFixed(2);
  if (typeof value === 'string' && value.length > 50) {
    return `<span title="${value}">${value.substring(0, 50)}...</span>`;
  }
  return value;
}

// Update comparison UI elements
function updateComparisonUI() {
  const pinnedCount = appState.pinnedRuns.size;
  document.getElementById('pinned-count').textContent = pinnedCount;
  document.getElementById('toggle-comparison-mode').disabled = pinnedCount === 0;
  document.getElementById('clear-all-pins').disabled = pinnedCount === 0;
}

// Helper function to generate unique run ID
function generateRunId() {
  const timestamp = new Date().getTime();
  const random = Math.random().toString(36).substr(2, 9);
  return `run_${timestamp}_${random}`;
}

// Helper function to generate display name for run
function generateDisplayName() {
  const parts = [];
  if (appState.selectedAdmType) {
    parts.push(appState.selectedAdmType.replace(/_/g, ' '));
  }
  if (appState.selectedLLM) {
    parts.push(appState.selectedLLM.replace(/_/g, ' '));
  }
  const kdmaKeys = Object.keys(appState.activeKDMAs);
  if (kdmaKeys.length > 0) {
    const kdmaStr = kdmaKeys.map(k => `${k}=${appState.activeKDMAs[k]}`).join(', ');
    parts.push(`(${kdmaStr})`);
  }
  return parts.join(' - ') || 'Unnamed Run';
}

// Helper function to show notifications
function showNotification(message, type = 'info') {
  // Simple implementation - can be enhanced with better UI
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.textContent = message;
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 10px 20px;
    background: ${type === 'error' ? '#f44336' : '#2196F3'};
    color: white;
    border-radius: 4px;
    z-index: 1000;
  `;
  document.body.appendChild(notification);
  setTimeout(() => notification.remove(), 3000);
}

// Helper function to update comparison table for a specific run
function updateComparisonTable(runId) {
  // If table is already rendered, update just the affected column
  if (appState.currentViewMode === 'comparison') {
    renderComparisonTable();
  }
}
```

## Technical Considerations

### Performance

- Lazy load run data
- Virtual scrolling for large datasets
- Debounce column operations
- Cache rendered comparisons

### Accessibility

- Keyboard navigation
- Screen reader support
- High contrast mode
- Focus indicators

### State Management

- URL parameters for shareable views
- Local storage for user preferences
- Undo/redo for column operations

## Corner Cases & Edge Scenarios

### Data Inconsistencies

- **Mismatched Parameter Sets**: Runs with completely different parameters (e.g., medical vs. military scenarios)
- **Missing Parameters**: Some runs missing key parameters (null/undefined values)
- **Parameter Name Drift**: Same parameter with different names across runs ("casualty_count" vs "casualtyCount")
- **Schema Evolution**: Older runs with deprecated parameters, newer runs with additional fields
- **Data Type Mismatches**: Same parameter with different types (string "5" vs number 5)

### Implementation-Specific Edge Cases

- **Experiment Key Mismatch**: Constructed key doesn't match manifest structure
- **Scenario Index Parsing**: Scenario IDs like "test_scenario_1-0" with varying formats
- **KDMA Value Precision**: Floating point precision differences (0.5 vs 0.50000001)
- **Dynamic KDMA Sets**: Different runs with completely different KDMA combinations
- **Missing Data Files**: Input/output, scores, or timing files not found
- **Array vs Object Scores**: Inconsistent score data structure between experiments
- **Manifest Structure Changes**: `manifest.experiment_keys` vs direct manifest structure
- **Base Scenario Matching**: Scenario filtering by base scenario prefix logic
- **LLM Preference Conflicts**: Stored LLM preferences vs available options per ADM
- **Transition State Issues**: UI state during programmatic updates causing display issues

### Scale Cases

We will porbably only need to support up to 8 runs or columns.

### UI/UX Edge Cases

- **Identical Runs**: All parameters exactly the same (no differences to highlight)
- **Single Run**: User attempts to compare just one run
- **Extreme Narrow Screen**: Mobile device too narrow for even 2 columns
- **Very Wide Screen**: Ultra-wide monitors with 50+ columns visible
- **Empty Data**: Runs with no parameters or empty values
- **Special Characters**: Unicode, emojis, or control characters in parameter values

### Interaction Edge Cases

- **Remove All Columns**: User removes all run columns, leaving only parameter names
- **Baseline Removal**: User removes the column that was set as baseline
- **Rapid Operations**: User rapidly adding/removing columns faster than UI can update
- **Drag Operations**: Dragging columns during data loading or updates
- **Keyboard Navigation**: Complex tab order with dynamic columns

### Data Format Edge Cases

- **Mixed Types**: Same parameter as string in one run, object in another
- **Boolean Variations**: true/false vs "true"/"false" vs 1/0
- **Date Formats**: Different date string formats across runs
- **Floating Point**: Precision differences (3.14159 vs 3.14)
- **Null vs Empty**: null vs "" vs undefined vs 0

## Testing Scenarios

### Load Testing

2. **Memory Test**: Monitor memory usage with progressively larger datasets
3. **Render Test**: Time to render table with varying numbers of columns/rows
4. **Scroll Performance**: Smooth scrolling with sticky headers/columns

### Data Integrity Testing

1. **Schema Mismatch**: Mix runs from different experiment types
2. **Missing Data**: Runs with 50% missing parameters
3. **Corrupted Data**: Invalid JSON, truncated data, encoding issues
4. **Type Confusion**: Mix strings, numbers, booleans, objects for same parameter

### User Interaction Testing

1. **Rapid Clicking**: Fast add/remove column operations
2. **Resize Stress**: Rapidly resize columns and browser window
3. **Drag Edge Cases**: Drag columns to invalid positions
4. **Keyboard Only**: Complete workflow using only keyboard
5. **Screen Reader**: Full accessibility with assistive technology

### Error Recovery Testing

1. **Network Failure**: Connection drops during data loading
2. **Partial Load**: Some runs fail to load
3. **Browser Crash**: Recovery from browser restart
4. **Data Corruption**: Handle malformed or corrupted run data

### Mobile/Responsive Testing

1. **Orientation Change**: Rotate device during comparison
2. **Zoom Levels**: Test at 50% to 200% zoom
3. **Touch Interactions**: Swipe, pinch, tap on small screens
4. **Keyboard Appearance**: On-screen keyboard affecting layout

### Business Logic Testing

4. **Share Link Validity**: Expired or invalid comparison links

### Implementation-Specific Testing

1. **Manifest Loading**: Handle corrupt or missing manifest.json
2. **Experiment Key Generation**: Test key construction with various KDMA combinations
3. **Scenario Index Extraction**: Parse scenario IDs with different formats
4. **KDMA Value Snapping**: Test slider snapping to valid values
5. **State Synchronization**: Prevent `isUpdatingProgrammatically` flag issues
6. **Transition Handling**: Test `isTransitioning` flag during scenario changes
7. **Data File Loading**: Handle missing input_output, scores, or timing files
8. **Array Index Bounds**: Test scenario index extraction and array access
9. **Dynamic KDMA Management**: Add/remove KDMAs during comparison
10. **Preference Persistence**: Test LLM preference storage across ADM changes

### Performance Benchmarks

- **Initial Load**: <2 seconds for 10 runs
- **Add Column**: <500ms to add new column
- **Remove Column**: <200ms to remove column

## Fallback Strategies

### Error Handling

- **Data Loading Errors**: Show error message, retry button
- **Render Failures**: Fallback to simple table without advanced features
- **Memory Limits**: Progressive data loading, warn before large operations

## Implementation Timeline

### Phase 1: Basic Comparison (MVP) - Simplified Approach

1. **State Management**: Extend `appState` with comparison features
2. **Pin Feature**: Add "Pin Current Run" button that shifts current display right
3. **Flexbox Layout**: Single flexbox container with current run + pinned runs
4. **Data Loading**: Load pinned run data and display in existing format
5. **Remove Pinned**: X button to remove pinned runs

#### Phase 1 Implementation Details:
- **No table conversion**: Keep existing run display HTML/CSS intact
- **Simple shift**: When pinning, current run section slides right into flexbox
- **Preserve formatting**: Each run maintains its original display format
- **Side-by-side view**: Horizontal flexbox with scrolling if needed
- **Current run remains interactive**: Parameters still update leftmost run

### Phase 2: Enhanced Features

1. **Baseline Comparison**: Visual highlighting of differences
2. **Export**: CSV export functionality
3. **Responsive Design**: Mobile-friendly table layout
4. **Parameter Filtering**: Show/hide parameter groups
5. **Better Styling**: Improved visual design

### Phase 3: Advanced Features

1. **Virtual Scrolling**: Handle large numbers of runs
2. **Column Reordering**: Drag-and-drop column rearrangement
3. **Share Links**: Shareable comparison URLs
4. **Statistical Analysis**: Show variance, trends
5. **Performance Optimization**: Lazy loading, caching

### Phase 4: Polish & Edge Cases

1. **Error Handling**: Robust error recovery
2. **Accessibility**: Full keyboard navigation, screen reader support
3. **Performance Testing**: Load testing with large datasets
4. **Advanced Filtering**: Complex parameter queries
5. **Data Validation**: Handle malformed or missing data

## Example User Flow (Final Implementation)

1. **Initial State**: User sees empty comparison table with message "Select parameters to see current run, then pin configurations to compare"

2. **Configure Parameters**: User selects scenario, ADM type, LLM, and KDMA values using existing controls

3. **Current Run Appears**: Table automatically shows current run in leftmost column with:
   - Blue border highlighting and "Live" badge
   - All detailed fields populated (scenario state, choices, ADM decision, justification, scores, etc.)
   - Real-time updates when any parameter changes

4. **Pin for Comparison**: User clicks "📌 Pin Current Configuration" to create a static snapshot
   - New column appears to the right with remove button (×)
   - Current run column remains on the left and continues updating

5. **Compare Multiple Runs**: User adjusts parameters and pins additional configurations
   - Each pinned run becomes a new column
   - All detailed content visible side-by-side in table rows
   - Easy comparison of differences across runs

6. **Interactive Content**: 
   - Click "Show More" buttons to expand long justifications or scenario descriptions
   - Hover for tooltips on truncated content
   - View formatted choices and object data in compact display

7. **Manage Comparisons**:
   - Remove pinned runs with × button in column headers
   - Clear all pinned runs with "Clear All" button
   - Current run always remains (cannot be removed)

## Key Implementation Decisions

### Major Design Changes from User Feedback

1. **No Mode Switching**: Original design had single vs comparison modes. User feedback: "I don't want a single vs multi display mode. It always multi mode." → **Final**: Always-on comparison table.

2. **Current Run Integration**: Original design showed only pinned runs. User feedback: "The current run selected by the current parameters also should live in the table" → **Final**: Current run as leftmost column with live updates.

3. **Preserve Live Updates**: Original design broke parameter → result updates. User feedback: "Changing the Parameters should always update a visible run with resolved run results and display them. Just like before." → **Final**: Current run updates automatically with parameter changes.

4. **All Fields in Table**: Original design had separate detailed content. User feedback: "I would like to keep all the content we had displayed for each run before this table effort" → **Final**: All detailed fields as table rows.

5. **Proper Data Extraction**: Original showed choice indices instead of readable text. User feedback: "ADM decision and justification are text and N/A respectively they should be the Unstructured readable choice and not N/A. There is always a justification" → **Final**: Use Pydantic model structure for proper data access.

6. **Smart Text Formatting**: User feedback: "don't do ellipses for justification. show it with the show more button if its long" and "for the scenario state show more lines of it by default before we add the show more button" → **Final**: Field-specific formatting rules.

7. **Content Curation**: User feedback: "remove scenario_unstructured row" → **Final**: Show only essential fields.

## Current Implementation Status

✅ **Complete Features**:
- Always-on comparison table
- Current run with live updates (leftmost column)
- Pin button for creating static snapshots
- All original detailed fields in table rows
- Proper ADM decision and justification extraction
- Smart content formatting (expandable text, compact objects)
- Remove pinned runs functionality
- Visual highlighting for current run
- Responsive design with sticky headers

🎯 **Working as Designed**:
- Parameter changes immediately update current run
- Pin button copies current configuration to comparison
- All detailed content visible in table format
- No data loss from original implementation
