// Client-side application logic for ADM Results
import {
  createInitialState,
  createRunConfig,
  createParameterStructure,
  encodeStateToURL,
  decodeStateFromURL,
  loadManifest,
  fetchRunData,
  KDMAUtils,
} from './state.js';

document.addEventListener("DOMContentLoaded", () => {

  let manifest = {};
  
  // UI state persistence for expandable content
  const expandableStates = {
    text: new Map(), // parameterName -> isExpanded
    objects: new Map() // parameterName -> isExpanded
  };
  
  // Central application state initialized with functional state
  let appState = {
    ...createInitialState()
  };

  // Standalone function to create run config from parameters
  function createRunConfigFromParams(params) {
    // Get context-specific available options using updateAppParameters with the run's parameters
    let availableKDMAs = [];
    let enhancedParams = { ...params };
    
    if (window.updateAppParameters) {
      const result = window.updateAppParameters({
        scenario: params.scenario,
        scene: params.scene,
        kdma_values: params.kdmaValues || {},
        adm: params.admType,
        llm: params.llmBackbone,
        run_variant: params.runVariant
      }, {});
      
      availableKDMAs = result.options.kdma_values || [];
      
      // Add all available options to params if they weren't provided
      enhancedParams = {
        ...params,
        availableScenarios: params.availableScenarios || result.options.scenario || [],
        availableScenes: params.availableScenes || result.options.scene || [],
        availableAdmTypes: params.availableAdmTypes || result.options.adm || [],
        availableLLMs: params.availableLLMs || result.options.llm || []
      };
    }
    
    return createRunConfig(enhancedParams, availableKDMAs);
  }

  
  // Parameter storage by run ID 
  const columnParameters = new Map();
  
  // Get parameters for any run ID
  function getParametersForRun(runId) {
    if (!columnParameters.has(runId)) {
      // Initialize with default parameters using auto-correction
      let defaultParams;
      
      // For pinned runs, initialize with the run's actual parameters
      const run = appState.pinnedRuns.get(runId);
      if (run) {
        defaultParams = createParameterStructure({
          scenario: run.scenario,
          scene: run.scene,
          admType: run.admType,
          llmBackbone: run.llmBackbone,
          kdmas: run.kdmaValues
        });
      }
      columnParameters.set(runId, defaultParams);
    }
    
    return columnParameters.get(runId);
  }
  
  // Update a parameter for any run with validation and UI sync
  function updateParameterForRun(runId, paramType, newValue) {
    const params = getParametersForRun(runId);
    
    // Map parameter types to parameter structure fields
    const paramMap = {
      'scenario': 'scenario',
      'scene': 'scene', 
      'admType': 'admType',
      'llmBackbone': 'llmBackbone',
      'llm': 'llmBackbone', // alias
      'kdmas': 'kdmas',
      'runVariant': 'runVariant'
    };
    
    const paramField = paramMap[paramType] || paramType;
    params[paramField] = newValue;
    
    // Use updateAppParameters for validation instead of setParametersForRun
    const stateParams = {
      scenario: params.scenario || null,
      scene: params.scene || null,
      kdma_values: params.kdmas || {},
      adm: params.admType || null,
      llm: params.llmBackbone || null,
      run_variant: params.runVariant || null
    };
    
    const result = window.updateAppParameters(stateParams, {});
    const validParams = result.params;
    const validOptions = result.options;
    
    // Convert back to app.js format
    const kdmas = {};
    if (validParams.kdma_values && Array.isArray(validParams.kdma_values)) {
      validParams.kdma_values.forEach(item => {
        kdmas[item.kdma] = item.value;
      });
    }
    
    const correctedParams = {
      scenario: validParams.scenario,
      scene: validParams.scene,
      admType: validParams.adm,
      llmBackbone: validParams.llm,
      kdmas: kdmas,
      runVariant: validParams.run_variant
    };
    
    // Store corrected parameters
    columnParameters.set(runId, createParameterStructure(correctedParams));
    
    // Update the actual run state
    const run = appState.pinnedRuns.get(runId);
    run.scenario = correctedParams.scenario;
    run.scene = correctedParams.scene;
    run.admType = correctedParams.admType;
    run.llmBackbone = correctedParams.llmBackbone;
    run.runVariant = correctedParams.runVariant;
    run.kdmaValues = correctedParams.kdmas;
    
    // Store the available options for UI dropdowns
    run.availableOptions = {
      scenarios: validOptions.scenario || [],
      scenes: validOptions.scene || [],
      admTypes: validOptions.adm || [],
      llms: validOptions.llm || [],
      kdmas: {
        validCombinations: validOptions.kdma_values || []
      }
    };
    
    return correctedParams;
  }
  
  // Initialize the run context system after manifest is loaded

  // URL State Management System
  const urlState = {
    // Encode current state to URL
    updateURL() {
      const newURL = encodeStateToURL(appState);
      window.history.replaceState(null, '', newURL);
    },

    // Restore state from URL on page load
    async restoreFromURL() {
      const state = decodeStateFromURL();
      
      if (state) {
        // Restore pinned runs
        if (state.pinnedRuns && state.pinnedRuns.length > 0) {
          for (const runConfig of state.pinnedRuns) {
            // Convert runConfig to params format expected by addColumn
            // Don't pass availableOptions - let addColumn calculate them fresh
            const params = {
              scenario: runConfig.scenario,
              scene: runConfig.scene,
              admType: runConfig.admType,
              llmBackbone: runConfig.llmBackbone,
              runVariant: runConfig.runVariant,
              kdmaValues: runConfig.kdmaValues
            };
            // Skip URL updates during batch restoration
            await addColumn(params, { updateURL: false });
          }
          // Update URL once after all runs are restored
          urlState.updateURL();
        }
        
        return true; // Successfully restored
      }
      return false; // No state to restore
    }
  };

  // Function to fetch and parse manifest.json
  async function fetchManifest() {
      const result = await loadManifest();
      manifest = result.manifest;
      window.updateAppParameters = result.updateAppParameters;
      
      const initialResult = window.updateAppParameters({
        scenario: null,
        scene: null,
        kdma_values: [],
        adm: null,
        llm: null,
        run_variant: null
      }, {});
      
      // Store first valid parameters for auto-pinning but don't populate appState selections
      const firstValidParams = {
        scenario: initialResult.params.scenario,
        scene: initialResult.params.scene,
        admType: initialResult.params.adm,
        llmBackbone: initialResult.params.llm,
        runVariant: initialResult.params.run_variant,
        kdmaValues: Object.fromEntries(
          (initialResult.params.kdma_values || []).map(({ kdma, value }) => [kdma, value])
        ),
        availableScenarios: initialResult.options.scenario || [],
        availableScenes: initialResult.options.scene || [], 
        availableAdmTypes: initialResult.options.adm || [],
        availableLLMs: initialResult.options.llm || []
      };
      
      // Try to restore state from URL, otherwise auto-pin first valid configuration
      const restoredFromURL = await urlState.restoreFromURL();
      if (!restoredFromURL) {
        // Auto-pin the first valid configuration if no pinned runs exist
        if (appState.pinnedRuns.size === 0 && firstValidParams.scenario) {
          await addColumn(firstValidParams);
        }
      }
  }

  
  

  // Handle LLM change for pinned runs - global for onclick access
  window.handleRunLLMChange = async function(runId, newLLM) {
    await window.updatePinnedRunState({
      runId,
      parameter: 'llmBackbone',
      value: newLLM,
      needsReload: true,
      updateUI: false 
    });
  };

  // Handle ADM type change for pinned runs - global for onclick access
  window.handleRunADMChange = async function(runId, newADM) {
    const run = appState.pinnedRuns.get(runId);
    
    // Initialize LLM preferences for this run if not present
    if (!run.llmPreferences) {
      run.llmPreferences = {};
    }
    
    // Store current LLM preference for the old ADM type
    if (run.admType && run.llmBackbone) {
      run.llmPreferences[run.admType] = run.llmBackbone;
    }
    
    // Update ADM type with validation - this will also update available options
    updateParameterForRun(runId, 'admType', newADM);
    
    // Try to restore LLM preference for the new ADM type
    if (run.llmPreferences[newADM] && run.availableOptions?.llms?.includes(run.llmPreferences[newADM])) {
      updateParameterForRun(runId, 'llmBackbone', run.llmPreferences[newADM]);
    }
    
    await window.updatePinnedRunState({
      runId,
      needsReload: true,
      updateUI: true
    });
  };

  // Handle run variant change for pinned runs - global for onclick access
  window.handleRunVariantChange = async function(runId, newVariant) {
    await window.updatePinnedRunState({
      runId,
      parameter: 'runVariant',
      value: newVariant,
      needsReload: true,
      updateUI: true
    });
  };

  // Handle base scenario change for pinned runs - global for onclick access
  window.handleRunSceneChange = async function(runId, newScene) {
    await window.updatePinnedRunState({
      runId,
      parameter: 'scene',
      value: newScene,
      needsReload: true,
      updateUI: true
    });
  };

  window.handleRunScnarioChange = async function(runId, newScenario) {
    await window.updatePinnedRunState({
      runId,
      parameter: 'scenario',
      value: newScenario,
      needsReload: true,
      updateUI: true
    });
  };


  // Handle adding KDMA to pinned run - global for onclick access
  window.addKDMAToRun = async function(runId) {
    const run = appState.pinnedRuns.get(runId);
    
    const availableKDMAs = getValidKDMAsForRun(runId);
    const currentKDMAs = run.kdmaValues || {};
    const maxKDMAs = getMaxKDMAsForRun(runId);
    
    if (Object.keys(currentKDMAs).length >= maxKDMAs) {
      console.warn(`Cannot add KDMA: max limit (${maxKDMAs}) reached for run ${runId}`);
      return;
    }
    
    // Find first available KDMA type
    const availableTypes = Object.keys(availableKDMAs).filter(type => 
      currentKDMAs[type] === undefined
    );
    
    if (availableTypes.length === 0) {
      console.warn(`No available KDMA types for run ${runId}`);
      return;
    }
    
    const kdmaType = availableTypes[0];
    const validValues = Array.from(availableKDMAs[kdmaType] || []);
    const initialValue = validValues.length > 0 ? validValues[0] : 0.0;
    console.log(`Adding KDMA ${kdmaType} with initial value ${initialValue} to run ${runId}`);
    
    // Update KDMAs through the parameter validation system
    const newKDMAs = { ...currentKDMAs, [kdmaType]: initialValue };
    
    await updatePinnedRunState({
      runId,
      parameter: 'kdmas',
      value: newKDMAs,
      needsReload: true,
      updateUI: true
    });
  };

  // Handle removing KDMA from pinned run - global for onclick access
  window.removeKDMAFromRun = async function(runId, kdmaType) {
    const run = appState.pinnedRuns.get(runId);
    const currentKDMAs = { ...(run.kdmaValues || {}) };
    delete currentKDMAs[kdmaType];
    
    await updatePinnedRunState({
      runId,
      parameter: 'kdmas',
      value: currentKDMAs,
      needsReload: true,
      updateUI: true
    });
  };

  // Handle KDMA type change for pinned run - global for onclick access
  window.handleRunKDMATypeChange = async function(runId, oldKdmaType, newKdmaType) {
    const run = appState.pinnedRuns.get(runId);
    const currentKDMAs = { ...(run.kdmaValues || {}) };
    const currentValue = currentKDMAs[oldKdmaType];
    
    // Remove old type and add new type
    delete currentKDMAs[oldKdmaType];
    
    // Get valid values for new type and adjust value if needed
    const availableKDMAs = getValidKDMAsForRun(runId);
    const validValues = availableKDMAs[newKdmaType] || [];
    let newValue = currentValue;
    
    if (validValues.length > 0 && !validValues.some(v => Math.abs(v - newValue) < 0.001)) {
      newValue = validValues[0]; // Use first valid value
    }
    
    currentKDMAs[newKdmaType] = newValue;
    
    await updatePinnedRunState({
      runId,
      parameter: 'kdmas',
      value: currentKDMAs,
      needsReload: true,
      updateUI: true
    });
  };

  // Handle KDMA slider input for pinned run - global for onclick access
  window.handleRunKDMASliderInput = async function(runId, kdmaType, sliderElement) {
    const run = appState.pinnedRuns.get(runId);
    if (!run) return;
    
    // The slider already constrains to valid values via min/max/step, so just normalize
    const normalizedValue = KDMAUtils.normalizeValue(sliderElement.value);
    
    // Update the display value immediately for responsiveness
    const valueDisplay = document.getElementById(`kdma-value-${runId}-${kdmaType}`);
    if (valueDisplay) {
      valueDisplay.textContent = formatKDMAValue(normalizedValue);
    }
    
    // Update the KDMA values - let the parameter system handle validation
    const currentKDMAs = { ...(run.kdmaValues || {}) };
    const updatedKDMAs = { ...currentKDMAs, [kdmaType]: normalizedValue };
    
    // Use updatePinnedRunState with debouncing for the reload
    await updatePinnedRunState({
      runId,
      parameter: 'kdmas',
      value: updatedKDMAs,
      needsReload: true,
      updateUI: true, // Let the parameter system update the UI with validated values
      updateURL: true,
      debounceMs: 500 // Debounce to avoid too many requests while sliding
    });
  };



  // Reload data for a specific pinned run after parameter changes (pure approach)
  async function reloadPinnedRun(runId) {
    const run = appState.pinnedRuns.get(runId);
    if (!run) {
      console.warn(`Run ${runId} not found in pinned runs`);
      return;
    }
    
    // Prevent concurrent reloads for the same run
    if (run.isReloading) {
      console.log(`Skipping reload for run ${runId} - already in progress`);
      return;
    }
    
    console.log(`Reloading data for run ${runId}`);
    
    // Mark as reloading to prevent concurrent requests
    run.isReloading = true;
    
    // Show loading state
    run.loadStatus = 'loading';
    renderComparisonTable();

    // Get updated parameters from columnParameters
    const params = getParametersForRun(runId);
    
    
    try {
      // Load new data using fetchRunData
      const experimentData = await fetchRunData({
        scenario: params.scenario,
        scene: params.scene,
        admType: params.admType,
        llmBackbone: params.llmBackbone,
        kdmaValues: params.kdmas,
        runVariant: params.runVariant
      });
      
      // Always update run parameters to reflect the intended state
      run.scenario = params.scenario;
      run.scene = params.scene;
      run.admType = params.admType;
      run.llmBackbone = params.llmBackbone;
      run.runVariant = params.runVariant;
      run.kdmaValues = { ...params.kdmas };
      
      if (!experimentData || !experimentData.inputOutput) {
        console.error(`Failed to load data for run ${runId}: No data returned`);
        run.loadStatus = 'error';
      } else {
        // Update with new results
        run.experimentKey = experimentData.experimentKey;
        run.inputOutput = experimentData.inputOutput;
        run.inputOutputArray = experimentData.inputOutputArray;
        run.timing = experimentData.timing;
        run.timing_s = experimentData.timing_s;
        run.loadStatus = 'loaded';
        
        console.log(`Successfully reloaded run ${runId} with new data`);
      }
      
    } catch (error) {
      console.error(`Failed to reload data for run ${runId}:`, error);
      
      // Even on exception, update run parameters to reflect the intended state
      run.scenario = params.scenario;
      run.scene = params.scene;
      run.admType = params.admType;
      run.llmBackbone = params.llmBackbone;
      run.runVariant = params.runVariant;
      run.kdmaValues = { ...params.kdmas };
      run.loadStatus = 'error';
    } finally {
      // Clear the reloading flag
      run.isReloading = false;
    }
    
    renderComparisonTable();
  }


  // Render the comparison table with pinned runs only
  function renderComparisonTable() {
    const container = document.getElementById('runs-container');
    if (!container) return;

    // Get all pinned runs for comparison
    const allRuns = Array.from(appState.pinnedRuns.values());
    
    // Extract all parameters from runs
    const parameters = extractParametersFromRuns(allRuns);
    
    // Show/hide the Add Column button based on pinned runs
    const addColumnBtn = document.getElementById('add-column-btn');
    if (addColumnBtn) {
      addColumnBtn.style.display = appState.pinnedRuns.size > 0 ? 'inline-block' : 'none';
    }
    
    // Find the existing table elements
    const table = container.querySelector('.comparison-table');
    if (!table) return;
    
    const thead = table.querySelector('thead tr');
    const tbody = table.querySelector('tbody');
    if (!thead || !tbody) return;
    
    // Clear existing run columns from header (keep first column)
    const headerCells = thead.querySelectorAll('th:not(.parameter-header)');
    headerCells.forEach(cell => cell.remove());
    
    // Add pinned run headers
    Array.from(appState.pinnedRuns.entries()).forEach(([runId, runData], index) => {
      const th = document.createElement('th');
      th.className = 'pinned-run-header';
      th.setAttribute('data-run-id', runId);
      th.setAttribute('data-experiment-key', runData.experimentKey || 'none');
      
      // Always render button but control visibility to prevent layout shifts
      const shouldShowButton = index > 0 || appState.pinnedRuns.size > 1;
      const visibility = shouldShowButton ? 'visible' : 'hidden';
      th.innerHTML = `<button class="remove-run-btn" onclick="removeRun('${runId}')" style="visibility: ${visibility};">×</button>`;
      
      thead.appendChild(th);
    });
    
    // Clear existing run value columns from all parameter rows (keep first column)
    const parameterRows = tbody.querySelectorAll('.parameter-row');
    parameterRows.forEach(row => {
      const valueCells = row.querySelectorAll('td:not(.parameter-name)');
      valueCells.forEach(cell => cell.remove());
    });
    
    // Add pinned run values to each parameter row
    parameters.forEach((paramInfo, paramName) => {
      const row = tbody.querySelector(`tr[data-category="${paramName}"]`);
      if (!row) return;
      
      // Pinned run values with border if different from previous column
      let previousValue = null;
      let isFirstColumn = true;
      appState.pinnedRuns.forEach((runData) => {
        const pinnedValue = getParameterValue(runData, paramName);
        const isDifferent = !isFirstColumn && !compareValues(previousValue, pinnedValue);
        
        const td = document.createElement('td');
        td.className = 'pinned-run-value';
        if (isDifferent) {
          td.style.borderLeft = '3px solid #007bff';
        }
        td.innerHTML = formatValue(pinnedValue, paramInfo.type, paramName, runData.id);
        
        row.appendChild(td);
        
        previousValue = pinnedValue;
        isFirstColumn = false;
      });
    });
  }

  // Extract parameters from all runs to determine table structure
  function extractParametersFromRuns() {
    const parameters = new Map();
    
    // Configuration parameters
    parameters.set("scene", { type: "string", required: true });
    parameters.set("scenario", { type: "string", required: true });
    parameters.set("scenario_state", { type: "longtext", required: false });
    parameters.set("available_choices", { type: "choices", required: false });
    parameters.set("kdma_values", { type: "kdma_values", required: false });
    parameters.set("adm_type", { type: "string", required: true });
    parameters.set("llm_backbone", { type: "string", required: true });
    parameters.set("run_variant", { type: "string", required: false });
    
    // ADM Decision (using Pydantic model structure)
    parameters.set("adm_decision", { type: "text", required: false });
    parameters.set("justification", { type: "longtext", required: false });
    
    // Timing data
    parameters.set("probe_time", { type: "number", required: false });
    
    // Raw Data
    parameters.set("input_output_json", { type: "object", required: false });
    
    return parameters;
  }

  // Extract parameter value from run data using Pydantic model structure
  function getParameterValue(run, paramName) {
    if (!run) return 'N/A';
    
    // Configuration parameters
    if (paramName === 'scene') return run.scene || 'N/A';
    if (paramName === 'scenario') return run.scenario || 'N/A';
    if (paramName === 'adm_type') return run.admType || 'N/A';
    if (paramName === 'llm_backbone') return run.llmBackbone || 'N/A';
    if (paramName === 'run_variant') return run.runVariant || 'N/A';
    
    // KDMA Values - single row showing all KDMA values
    if (paramName === 'kdma_values') {
      return run.kdmaValues || {};
    }
    
    // Scenario details
    if (paramName === 'scenario_state' && run.inputOutput?.input) {
      return run.inputOutput.input.state || 'N/A';
    }
    
    // Available choices
    if (paramName === 'available_choices' && run.inputOutput?.input?.choices) {
      return run.inputOutput.input.choices;
    }
    
    // ADM Decision - proper extraction using Pydantic model structure
    if (paramName === 'adm_decision' && run.inputOutput?.output && run.inputOutput?.input?.choices) {
      const choiceIndex = run.inputOutput.output.choice;
      const choices = run.inputOutput.input.choices;
      if (typeof choiceIndex === 'number' && choices[choiceIndex]) {
        return choices[choiceIndex].unstructured || choices[choiceIndex].action_id || 'N/A';
      }
      return 'N/A';
    }
    
    // Justification - proper path using Pydantic model structure
    if (paramName === 'justification' && run.inputOutput?.output?.action) {
      return run.inputOutput.output.action.justification || 'N/A';
    }
    
    // Timing data - comes from scene timing_s in manifest
    if (paramName === 'probe_time' && run.timing_s !== undefined && run.timing_s !== null) {
      return run.timing_s.toFixed(2);
    }
    
    // Raw Data - inputOutput is already the correct object for this scene
    if (paramName === 'input_output_json' && run.inputOutput) {
      return run.inputOutput;
    }
    
    return 'N/A';
  }

  // Create dropdown HTML for LLM selection in table cells
  function createLLMDropdownForRun(runId, currentValue) {
    const run = appState.pinnedRuns.get(runId);
    if (!run) return escapeHtml(currentValue);
    
    const validLLMs = Array.from(run.availableOptions.llms);
    
    let html = `<select class="table-llm-select" onchange="handleRunLLMChange('${runId}', this.value)">`;
    validLLMs.forEach(llm => {
      const selected = llm === currentValue ? 'selected' : '';
      html += `<option value="${escapeHtml(llm)}" ${selected}>${escapeHtml(llm)}</option>`;
    });
    html += '</select>';
    
    return html;
  }

  // Create dropdown HTML for ADM type selection in table cells
  function createADMDropdownForRun(runId, currentValue) {
    const run = appState.pinnedRuns.get(runId);
    if (!run) return escapeHtml(currentValue);
    
    const validADMs = Array.from(run.availableOptions.admTypes);
    
    let html = `<select class="table-adm-select" onchange="handleRunADMChange('${runId}', this.value)">`;
    validADMs.forEach(adm => {
      const selected = adm === currentValue ? 'selected' : '';
      html += `<option value="${escapeHtml(adm)}" ${selected}>${escapeHtml(adm)}</option>`;
    });
    html += '</select>';
    
    return html;
  }

  // Create dropdown HTML for base scenario selection in table cells
  function createSceneDropdownForRun(runId, currentValue) {
    // Check if run exists
    const run = appState.pinnedRuns.get(runId);
    if (!run) return escapeHtml(currentValue);
    
    // For base scenario, we show all available base scenarios
    const availableScenes = run.availableOptions.scenes.sort();
    
    let html = `<select class="table-scenario-select" onchange="handleRunSceneChange('${runId}', this.value)">`;
    availableScenes.forEach(scene => {
      const selected = scene === currentValue ? 'selected' : '';
      html += `<option value="${escapeHtml(scene)}" ${selected}>${escapeHtml(scene)}</option>`;
    });
    html += '</select>';
    
    return html;
  }

  // Create dropdown HTML for specific scenario selection in table cells
  function createSpecificScenarioDropdownForRun(runId, currentValue) {
    // Check if run exists
    const run = appState.pinnedRuns.get(runId);
    if (!run) return escapeHtml(currentValue);
    
    const sceneId = run.scene;
    
    if (!sceneId) {
      return '<span class="na-value">No scene</span>';
    }
    
    const availableScenarios = run.availableOptions.scenarios;
    
    if (availableScenarios.length === 0) {
      return '<span class="na-value">No scenarios available</span>';
    }
    
    let html = `<select class="table-scenario-select" onchange="handleRunScnarioChange('${runId}', this.value)">`;
    availableScenarios.forEach(scenario => {
      const selected = scenario === currentValue ? 'selected' : '';
      html += `<option value="${escapeHtml(scenario)}" ${selected}>${escapeHtml(scenario)}</option>`;
    });
    html += '</select>';
    
    return html;
  }

  // Create dropdown HTML for run variant selection in table cells
  function createRunVariantDropdownForRun(runId, currentValue) {
    const run = appState.pinnedRuns.get(runId);
    if (!run) return escapeHtml(currentValue);
    
    // Use the run's actual runVariant instead of the passed currentValue
    // This ensures we show the correct selection after parameter updates
    const actualCurrentValue = run.runVariant;
    
    
    // Get available run variants for the current ADM+LLM+KDMA combination
    // Use the same buildExperimentKey function that's used throughout the app
    const baseKey = buildExperimentKey(run.admType, run.llmBackbone, run.kdmaValues);
    
    // Find all experiment keys that match this base pattern AND have data for the current scenario
    const availableVariants = new Set();
    let hasExactMatch = false;
    
    for (const experimentKey of Object.keys(manifest.experiment_keys || {})) {
      const experiment = manifest.experiment_keys[experimentKey];
      
      // Only consider variants that have data for the current scenario
      if (!experiment.scenarios[run.scenario]) {
        continue;
      }
      
      if (experimentKey === baseKey) {
        hasExactMatch = true;
        availableVariants.add('default');
      } else if (experimentKey.startsWith(baseKey + '_')) {
        // Extract potential run variant from the key
        const suffix = experimentKey.substring(baseKey.length + 1); // Remove base key and underscore
        
        // Only consider as run variant if it's NOT a KDMA extension
        // KDMA extensions follow pattern: kdma-value (e.g., merit-0.0, affiliation-1.0)
        // Run variants are typically words/phrases (e.g., greedy_w_cache, rerun)
        const isKDMAExtension = /^[a-z_]+-(0\.?\d*|1\.0?)$/.test(suffix);
        
        if (!isKDMAExtension) {
          availableVariants.add(suffix);
        }
      }
    }
    
    // If no exact match for base key, don't add default option
    // Just show available variants without auto-selection
    
    // Add default option only if base key exists without variant AND has data for current scenario
    if (hasExactMatch) {
      availableVariants.add('default');
    }
    
    // If no variants found, try to extract from the current run's experiment key
    if (availableVariants.size === 0) {
      // Try to extract run variant from the current experiment key being used
      if (run.experimentKey && run.experimentKey.startsWith(baseKey + '_')) {
        const extractedVariant = run.experimentKey.substring(baseKey.length + 1);
        return escapeHtml(extractedVariant);
      }
      return escapeHtml(actualCurrentValue || 'N/A');
    }
    
    // If only one variant, show it without dropdown
    if (availableVariants.size === 1) {
      const variant = Array.from(availableVariants)[0];
      const displayValue = variant === 'default' ? '(default)' : variant;
      return escapeHtml(displayValue);
    }
    
    const sortedVariants = Array.from(availableVariants).sort();
    
    let html = `<select class="table-run-variant-select" onchange="handleRunVariantChange('${runId}', this.value)">`;
    sortedVariants.forEach(variant => {
      const selected = variant === actualCurrentValue ? 'selected' : '';
      const displayValue = variant === 'default' ? '(default)' : variant;
      html += `<option value="${escapeHtml(variant)}" ${selected}>${escapeHtml(displayValue)}</option>`;
    });
    html += '</select>';
    
    return html;
  }

  // Get max KDMAs allowed for a specific run based on its constraints and current selections
  function getMaxKDMAsForRun(runId) {
    const run = appState.pinnedRuns.get(runId);
    if (!run) return 0;
    
    const kdmaOptions = run.availableOptions?.kdmas;
    if (!kdmaOptions || !kdmaOptions.validCombinations) {
      return 1; // Default to at least 1 KDMA if no options available
    }
    
    // Find the maximum number of KDMAs in any valid combination
    let maxKDMAs = 0;
    kdmaOptions.validCombinations.forEach(combination => {
      if (typeof combination === 'object' && combination !== null) {
        maxKDMAs = Math.max(maxKDMAs, Object.keys(combination).length);
      }
    });
    
    return Math.max(maxKDMAs, 1); // At least 1 KDMA should be possible
  }

  // Get valid KDMAs for a specific run
  function getValidKDMAsForRun(runId) {
    const run = appState.pinnedRuns.get(runId);
    if (!run?.availableOptions?.kdmas?.validCombinations) {
      return {};
    }
    
    // Extract all available types and values from valid combinations
    const availableOptions = {};
    run.availableOptions.kdmas.validCombinations.forEach(combination => {
      if (typeof combination === 'object' && combination !== null) {
        Object.entries(combination).forEach(([kdmaType, value]) => {
          if (!availableOptions[kdmaType]) {
            availableOptions[kdmaType] = new Set();
          }
          availableOptions[kdmaType].add(value);
        });
      }
    });
    
    return availableOptions;
  }
  

  // Check if a specific KDMA can be removed from a run
  function canRemoveSpecificKDMA(runId, kdmaType) {
    const run = appState.pinnedRuns.get(runId);
    if (!run) return false;
    
    const currentKDMAs = run.kdmaValues || {};
    const kdmaOptions = run.availableOptions?.kdmas;
    if (!kdmaOptions || !kdmaOptions.validCombinations) {
      return false;
    }
    
    // Create a copy of current KDMAs without the one we want to remove
    const remainingKDMAs = { ...currentKDMAs };
    delete remainingKDMAs[kdmaType];
    
    // Check if the remaining KDMA combination exists in validCombinations
    return kdmaOptions.validCombinations.some(combination => {
      if (typeof combination !== 'object' || combination === null) return false;
      
      return KDMAUtils.objectsEqual(remainingKDMAs, combination);
    });
  }
  
  // Format KDMA value consistently across the application
  function formatKDMAValue(value) {
    return KDMAUtils.formatValue(value);
  }

  // Generate experiment key from parameters (shared utility function)
  function buildExperimentKey(admType, llmBackbone, kdmas) {
    const kdmaParts = [];
    Object.entries(kdmas || {}).forEach(([kdma, value]) => {
      kdmaParts.push(`${kdma}-${formatKDMAValue(value)}`);
    });
    const kdmaString = kdmaParts.sort().join("_");
    return kdmaString ? `${admType}_${llmBackbone}_${kdmaString}` : `${admType}_${llmBackbone}`;
  }

  // Check if we can add another KDMA given current KDMA values
  function canAddKDMAToRun(runId, currentKDMAs) {
    const run = appState.pinnedRuns.get(runId);
    if (!run?.availableOptions?.kdmas?.validCombinations) {
      return false;
    }
    
    const currentKDMAEntries = Object.entries(currentKDMAs || {});
    const maxKDMAs = getMaxKDMAsForRun(runId);
    
    // First check if we're already at max
    if (currentKDMAEntries.length >= maxKDMAs) {
      return false;
    }
    
    // Convert current KDMAs to array format for comparison
    const currentKDMAArray = currentKDMAEntries.map(([kdma, value]) => ({ kdma, value }));
    
    // Check if there are any valid combinations that:
    // 1. Include all current KDMAs with their exact values
    // 2. Have at least one additional KDMA
    return run.availableOptions.kdmas.validCombinations.some(combination => {
      if (!Array.isArray(combination) || combination.length <= currentKDMAArray.length) {
        return false;
      }
      
      // Check if this combination includes all current KDMAs with matching values
      return currentKDMAArray.every(currentKDMA => 
        combination.some(combKDMA => 
          combKDMA.kdma === currentKDMA.kdma && 
          Math.abs(combKDMA.value - currentKDMA.value) < 0.001
        )
      );
    });
  }

  // Create KDMA controls HTML for table cells
  function createKDMAControlsForRun(runId, currentKDMAs) {
    const run = appState.pinnedRuns.get(runId);
    if (!run) return '<span class="na-value">N/A</span>';
    
    const currentKDMAEntries = Object.entries(currentKDMAs || {});
    const canAddMore = canAddKDMAToRun(runId, currentKDMAs);
    
    let html = `<div class="table-kdma-container" data-run-id="${runId}">`;
    
    // Render existing KDMA controls
    currentKDMAEntries.forEach(([kdmaType, value], index) => {
      html += createSingleKDMAControlForRun(runId, kdmaType, value, index);
    });
    
    // Add button - always show but enable/disable based on availability
    const disabledAttr = canAddMore ? '' : 'disabled';
    
    // Determine tooltip text for disabled state
    let tooltipText = '';
    if (!canAddMore) {
      tooltipText = 'title="No valid KDMA combinations available with current values"';
    }
    
    html += `<button class="add-kdma-btn" onclick="addKDMAToRun('${runId}')" 
               ${disabledAttr} ${tooltipText}
               style="margin-top: 5px; font-size: 12px; padding: 2px 6px;">
               Add KDMA
             </button>`;
    
    html += '</div>';
    return html;
  }

  // Create individual KDMA control for table cell
  function createSingleKDMAControlForRun(runId, kdmaType, value) {
    const availableKDMAs = getValidKDMAsForRun(runId);
    const run = appState.pinnedRuns.get(runId);
    const currentKDMAs = run.kdmaValues || {};
    
    // Get available types (current type + unused types)
    const availableTypes = Object.keys(availableKDMAs).filter(type => 
      type === kdmaType || currentKDMAs[type] === undefined
    );
    
    const validValues = Array.from(availableKDMAs[kdmaType] || []);
    
    // Ensure current value is in the list (in case of data inconsistencies)
    if (value !== undefined && value !== null) {
      // Check with tolerance for floating point
      const hasValue = validValues.some(v => Math.abs(v - value) < 0.001);
      if (!hasValue) {
        // Add current value and sort
        validValues.push(value);
        validValues.sort((a, b) => a - b);
      }
    }
    
    // Sort valid values to ensure proper order
    validValues.sort((a, b) => a - b);
    
    // Calculate slider properties from valid values
    const minVal = validValues.length > 0 ? Math.min(...validValues) : 0;
    const maxVal = validValues.length > 0 ? Math.max(...validValues) : 1;
    
    // Calculate step as smallest difference between consecutive values, or 0.1 if only one value
    let step = 0.1;
    if (validValues.length > 1) {
      const diffs = [];
      for (let i = 1; i < validValues.length; i++) {
        diffs.push(validValues[i] - validValues[i-1]);
      }
      step = Math.min(...diffs);
    }
    
    return `
      <div class="table-kdma-control">
        <select class="table-kdma-type-select" 
                onchange="handleRunKDMATypeChange('${runId}', '${kdmaType}', this.value)">
          ${availableTypes.map(type => 
            `<option value="${type}" ${type === kdmaType ? 'selected' : ''}>${type}</option>`
          ).join('')}
        </select>
        
        <input type="range" 
               class="table-kdma-value-slider"
               id="kdma-slider-${runId}-${kdmaType}"
               min="${minVal}" max="${maxVal}" step="${step}" 
               value="${value}"
               oninput="handleRunKDMASliderInput('${runId}', '${kdmaType}', this)">
        <span class="table-kdma-value-display" id="kdma-value-${runId}-${kdmaType}">${formatKDMAValue(value)}</span>
        
        <button class="table-kdma-remove-btn" 
                onclick="removeKDMAFromRun('${runId}', '${kdmaType}')" 
                ${!canRemoveSpecificKDMA(runId, kdmaType) ? 'disabled' : ''}
                title="${!canRemoveSpecificKDMA(runId, kdmaType) ? 'No valid experiments exist without this KDMA' : 'Remove KDMA'}">×</button>
      </div>
    `;
  }

  // Format values for display in table cells
  function formatValue(value, type, paramName = '', runId = '') {
    // Special handling for run_variant - always try to show dropdown if possible
    if (runId !== '' && paramName === 'run_variant') {
      return createRunVariantDropdownForRun(runId, value);
    }
    
    if (value === null || value === undefined || value === 'N/A') {
      return '<span class="na-value">N/A</span>';
    }
    
    // Special handling for editable parameters in pinned runs
    if (runId !== '') {
      if (paramName === 'llm_backbone') {
        return createLLMDropdownForRun(runId, value);
      }
      if (paramName === 'adm_type') {
        return createADMDropdownForRun(runId, value);
      }
      if (paramName === 'scene') {
        return createSceneDropdownForRun(runId, value);
      }
      if (paramName === 'scenario') {
        return createSpecificScenarioDropdownForRun(runId, value);
      }
      if (paramName === 'kdma_values') {
        return createKDMAControlsForRun(runId, value);
      }
    }
    
    switch (type) {
      case 'number':
        return typeof value === 'number' ? value.toFixed(3) : value.toString();
      
      case 'longtext':
        if (typeof value === 'string' && value.length > 800) {
          const truncated = value.substring(0, 800);
          // Include runId for per-column state persistence
          const id = `text_${paramName}_${runId}_${type}`;
          const isExpanded = expandableStates.text.get(id) || false;
          
          const shortDisplay = isExpanded ? 'none' : 'inline';
          const fullDisplay = isExpanded ? 'inline' : 'none';
          const buttonText = isExpanded ? 'Show Less' : 'Show More';
          
          return `<div class="expandable-text" data-full-text="${escapeHtml(value)}" data-param-id="${id}">
            <span id="${id}_short" style="display: ${shortDisplay};">${escapeHtml(truncated)}...</span>
            <span id="${id}_full" style="display: ${fullDisplay};">${escapeHtml(value)}</span>
            <button class="show-more-btn" onclick="toggleText('${id}')">${buttonText}</button>
          </div>`;
        }
        return escapeHtml(value.toString());
      
      case 'text':
        return escapeHtml(value.toString());
      
      case 'choices':
        if (Array.isArray(value)) {
          let choicesHtml = '<div class="choices-display">';
          value.forEach((choice) => {
            choicesHtml += `<div class="choice-card">
              <div class="choice-text">${escapeHtml(choice.unstructured || choice.description || 'No description')}</div>`;
            
            // Add KDMA associations if available
            if (choice.kdma_association) {
              choicesHtml += '<div class="kdma-bars">';
              choicesHtml += '<div class="kdma-truth-header">KDMA Association Truth</div>';
              Object.entries(choice.kdma_association).forEach(([kdma, val]) => {
                const percentage = Math.round(val * 100);
                const color = val >= 0.7 ? '#28a745' : val >= 0.4 ? '#ffc107' : '#dc3545';
                choicesHtml += `<div class="kdma-bar">
                  <span class="kdma-name">${kdma}</span>
                  <div class="kdma-bar-container">
                    <div class="kdma-bar-fill" style="width: ${percentage}%; background-color: ${color};"></div>
                  </div>
                  <span class="kdma-value">${val.toFixed(2)}</span>
                </div>`;
              });
              choicesHtml += '</div>';
            }
            choicesHtml += '</div>';
          });
          choicesHtml += '</div>';
          return choicesHtml;
        }
        return escapeHtml(value.toString());
      
      case 'kdma_values':
        if (typeof value === 'object' && value !== null) {
          const kdmaEntries = Object.entries(value);
          if (kdmaEntries.length === 0) {
            return '<span class="na-value">No KDMAs</span>';
          }
          
          let kdmaHtml = '<div class="kdma-values-display">';
          kdmaEntries.forEach(([kdmaName, kdmaValue]) => {
            kdmaHtml += `<div class="kdma-value-item">
              <span class="kdma-name">${escapeHtml(kdmaName)}:</span>
              <span class="kdma-number">${formatKDMAValue(kdmaValue)}</span>
            </div>`;
          });
          kdmaHtml += '</div>';
          return kdmaHtml;
        }
        return '<span class="na-value">N/A</span>';
      
      case 'object':
        if (typeof value === 'object') {
          // Include runId for per-column state persistence
          const id = `object_${paramName}_${runId}_${type}`;
          const isExpanded = expandableStates.objects.get(id) || false;
          
          const preview = getObjectPreview(value);
          const fullJson = JSON.stringify(value, null, 2);
          
          const previewDisplay = isExpanded ? 'none' : 'inline';
          const fullDisplay = isExpanded ? 'block' : 'none';
          const buttonText = isExpanded ? 'Show Preview' : 'Show Details';
          
          return `<div class="object-display" data-param-id="${id}">
            <span id="${id}_preview" style="display: ${previewDisplay};">${escapeHtml(preview)}</span>
            <pre id="${id}_full" style="display: ${fullDisplay};">${escapeHtml(fullJson)}</pre>
            <button class="show-more-btn" onclick="toggleObject('${id}')">${buttonText}</button>
          </div>`;
        }
        return escapeHtml(value.toString());
      
      default:
        return escapeHtml(value.toString());
    }
  }

  // Helper functions
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function compareValues(val1, val2) {
    if (val1 === val2) return true;
    
    // Handle null/undefined cases
    if (val1 == null || val2 == null) {
      return val1 == val2;
    }
    
    // Handle numeric comparison with floating point tolerance
    if (typeof val1 === 'number' && typeof val2 === 'number') {
      return Math.abs(val1 - val2) < 0.001;
    }
    
    // Handle string comparison
    if (typeof val1 === 'string' && typeof val2 === 'string') {
      return val1 === val2;
    }
    
    // Handle array comparison
    if (Array.isArray(val1) && Array.isArray(val2)) {
      if (val1.length !== val2.length) return false;
      for (let i = 0; i < val1.length; i++) {
        if (!compareValues(val1[i], val2[i])) return false;
      }
      return true;
    }
    
    // Handle object comparison
    if (typeof val1 === 'object' && typeof val2 === 'object') {
      const keys1 = Object.keys(val1);
      const keys2 = Object.keys(val2);
      
      if (keys1.length !== keys2.length) return false;
      
      for (const key of keys1) {
        if (!keys2.includes(key)) return false;
        if (!compareValues(val1[key], val2[key])) return false;
      }
      return true;
    }
    
    return false;
  }

  // Add a column with specific parameters (no appState manipulation)
  async function addColumn(params, options = {}) {
    if (!params.scenario) {
      console.warn('No scenario provided for addColumn');
      return;
    }

    // Create run config from parameters
    const runConfig = createRunConfigFromParams(params);
    
    // Fetch data for these parameters
    const runData = await fetchRunData({
      scenario: params.scenario,
      scene: params.scene,
      admType: params.admType,
      llmBackbone: params.llmBackbone,
      runVariant: params.runVariant,
      kdmaValues: params.kdmaValues
    });
    
    if (!runData || !runData.inputOutput) {
      throw new Error('No data found for parameters');
    }
    
    // Store complete run data
    const pinnedData = {
      ...runConfig,
      inputOutput: runData.inputOutput,
      inputOutputArray: runData.inputOutputArray,
      timing: runData.timing,
      timing_s: runData.timing_s,
      loadStatus: 'loaded'
    };
    
    appState.pinnedRuns.set(runConfig.id, pinnedData);
    renderComparisonTable();
    
    // Only update URL if not explicitly disabled (e.g., during batch restoration)
    if (options.updateURL !== false) {
      urlState.updateURL();
    }
    
    return runConfig.id; // Return the ID for reference
    
   
  }

  function getObjectPreview(obj) {
    if (!obj || typeof obj !== 'object') return 'N/A';
    const keys = Object.keys(obj);
    if (keys.length === 0) return '{}';
    if (keys.length === 1 && typeof obj[keys[0]] !== 'object') {
      return `${keys[0]}: ${obj[keys[0]]}`;
    }
    return `{${keys.slice(0, 3).join(', ')}${keys.length > 3 ? '...' : ''}}`;
  }

  // Copy the rightmost column's parameters to create a new column
  async function copyColumn() {
    if (appState.pinnedRuns.size === 0) {
      console.warn('No columns to copy from');
      return;
    }
    
    // Get parameters from the rightmost (last) pinned run
    const pinnedRunsArray = Array.from(appState.pinnedRuns.values());
    const lastRun = pinnedRunsArray[pinnedRunsArray.length - 1];
    
    const params = {
      scene: lastRun.scene,
      scenario: lastRun.scenario,
      admType: lastRun.admType,
      llmBackbone: lastRun.llmBackbone,
      runVariant: lastRun.runVariant,
      kdmaValues: lastRun.kdmaValues,
      availableScenarios: lastRun.availableOptions?.scenarios || [],
      availableScenes: lastRun.availableOptions?.scenes || [],
      availableAdmTypes: lastRun.availableOptions?.admTypes || [],
      availableLLMs: lastRun.availableOptions?.llms || []
    };
    
    // Use the new addColumn function
    return await addColumn(params);
  }

  // Toggle functions for expandable content
  window.toggleText = function(id) {
    const shortSpan = document.getElementById(`${id}_short`);
    const fullSpan = document.getElementById(`${id}_full`);
    const button = document.querySelector(`[onclick="toggleText('${id}')"]`);
    
    const isCurrentlyExpanded = fullSpan.style.display !== 'none';
    const newExpanded = !isCurrentlyExpanded;
    
    if (newExpanded) {
      shortSpan.style.display = 'none';
      fullSpan.style.display = 'inline';
      button.textContent = 'Show Less';
    } else {
      shortSpan.style.display = 'inline';
      fullSpan.style.display = 'none';
      button.textContent = 'Show More';
    }
    
    // Save state for persistence
    expandableStates.text.set(id, newExpanded);
  };

  window.toggleObject = function(id) {
    const preview = document.getElementById(`${id}_preview`);
    const full = document.getElementById(`${id}_full`);
    const button = document.querySelector(`[onclick="toggleObject('${id}')"]`);
    
    const isCurrentlyExpanded = full.style.display !== 'none';
    const newExpanded = !isCurrentlyExpanded;
    
    if (newExpanded) {
      preview.style.display = 'none';
      full.style.display = 'block';
      button.textContent = 'Show Preview';
    } else {
      preview.style.display = 'inline';
      full.style.display = 'none';
      button.textContent = 'Show Details';
    }
    
    // Save state for persistence
    expandableStates.objects.set(id, newExpanded);
  };

  // Remove a pinned run
  function removeRun(runId) {
    window.updatePinnedRunState({
      runId,
      action: 'remove',
      needsCleanup: true
    });
  }
  
  // Generalized function for handling pinned run state updates
  window.updatePinnedRunState = async function(options = {}) {
    const {
      runId,
      action = 'update', // 'update', 'add', 'remove', 'clear'
      parameter,
      value,
      needsReload = false,
      needsCleanup = false,
      updateUI = true,
      updateURL = true,
      debounceMs = 0
    } = options;

    const executeUpdate = async () => {
      try {
        // Handle different types of actions
        switch (action) {
          case 'remove':
            if (runId) {
              appState.pinnedRuns.delete(runId);
              if (needsCleanup) {
                cleanupRunStates(runId);
              }
            }
            break;
            
          case 'clear':
            // Clean up all runs before clearing
            appState.pinnedRuns.forEach((_, id) => cleanupRunStates(id));
            appState.pinnedRuns.clear();
            break;
            
          case 'add':
            if (runId && value) {
              appState.pinnedRuns.set(runId, value);
            }
            break;
            
          case 'update':
          default:
            if (runId && parameter !== undefined) {
              updateParameterForRun(runId, parameter, value);
            }
            break;
        }

        // Reload data if needed
        if (needsReload && runId) {
          await reloadPinnedRun(runId);
        }

        // Update UI if requested
        if (updateUI) {
          renderComparisonTable();
        }

        // Update URL state if requested
        if (updateURL) {
          urlState.updateURL();
        }

      } catch (error) {
        console.error('Error updating pinned run state:', error);
        throw error;
      }
    };

    // Execute immediately or with debounce
    if (debounceMs > 0) {
      // Clear any existing timeout for this operation
      if (window.updatePinnedRunState._debounceTimeout) {
        clearTimeout(window.updatePinnedRunState._debounceTimeout);
      }
      
      window.updatePinnedRunState._debounceTimeout = setTimeout(executeUpdate, debounceMs);
    } else {
      await executeUpdate();
    }
  }
  
  // Clean up expansion states when a run is removed
  function cleanupRunStates(runId) {
    // Remove text expansion states for this run
    for (const [key] of expandableStates.text.entries()) {
      if (key.includes(`_${runId}_`)) {
        expandableStates.text.delete(key);
      }
    }
    
    // Remove object expansion states for this run
    for (const [key] of expandableStates.objects.entries()) {
      if (key.includes(`_${runId}_`)) {
        expandableStates.objects.delete(key);
      }
    }
  }

  // Make removePinnedRun globally accessible for onclick handlers
  window.removeRun = removeRun;

  // Display name generation uses imported function


  // Initialize static button event listeners
  const addColumnBtn = document.getElementById('add-column-btn');
  if (addColumnBtn) {
    addColumnBtn.addEventListener('click', copyColumn);
  }

  // Initial manifest fetch on page load
  fetchManifest();
});
