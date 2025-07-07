// Client-side application logic for ADM Results

document.addEventListener("DOMContentLoaded", () => {
  const admTypeSelection = document.getElementById("adm-type-selection");
  const kdmaSliders = document.getElementById("kdma-sliders");
  const llmSelection = document.getElementById("llm-selection");
  const scenarioSelection = document.getElementById("scenario-selection"); // New element
  // runDisplay no longer needed - using table mode

  let manifest = {};
  
  // UI state persistence for expandable content
  const expandableStates = {
    text: new Map(), // parameterName -> isExpanded
    objects: new Map() // parameterName -> isExpanded
  };
  
  // Central application state
  const appState = {
    // Data from manifest
    availableScenarios: new Set(),
    availableBaseScenarios: new Set(),
    availableAdmTypes: new Set(),
    availableKDMAs: new Set(),
    availableLLMs: new Set(),
    validCombinations: {},
    
    // User selections
    selectedBaseScenario: null,
    selectedScenario: null,
    selectedAdmType: null,
    selectedLLM: null,
    activeKDMAs: {},
    
    // LLM preferences per ADM type for preservation
    llmPreferences: {},
    
    // UI state
    isUpdatingProgrammatically: false,
    isTransitioning: false,
    
    // Comparison state
    pinnedRuns: new Map(), // Map<runId, runData> for pinned comparisons
    currentInputOutput: null,
    currentScores: null, 
    currentTiming: null,

    // Run configuration factory
    createRunConfig: function() {
      return {
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
      };
    }
  };

  // ===== RUN ID CONTEXT SYSTEM (Phase 4) =====
  
  // Constants for run identification
  const CURRENT_RUN_ID = 'current';
  
  // Parameter storage by run ID - enables multi-run parameter management
  const columnParameters = new Map();
  
  // Parameter structure for each run
  function createParameterStructure(params = {}) {
    return {
      scenario: params.scenario || null,
      baseScenario: params.baseScenario || null,
      admType: params.admType || null,
      llmBackbone: params.llmBackbone || null,
      kdmas: params.kdmas || {}
    };
  }
  
  // Get parameters for any run ID
  function getParametersForRun(runId) {
    if (!columnParameters.has(runId)) {
      // Initialize with default parameters using auto-correction
      let defaultParams;
      
      if (runId === CURRENT_RUN_ID) {
        // For current run, use existing appState as starting point
        defaultParams = createParameterStructure({
          scenario: appState.selectedScenario,
          baseScenario: appState.selectedBaseScenario,
          admType: appState.selectedAdmType,
          llmBackbone: appState.selectedLLM,
          kdmas: appState.activeKDMAs
        });
      } else {
        // For new runs, start with auto-corrected valid combination
        defaultParams = correctParametersToValid({});
      }
      
      columnParameters.set(runId, defaultParams);
    }
    
    return columnParameters.get(runId);
  }
  
  // Set parameters for any run ID with validation
  function setParametersForRun(runId, params) {
    // Always validate parameters before storing
    const validParams = correctParametersToValid(params, true);
    columnParameters.set(runId, createParameterStructure(validParams));
    
    return validParams;
  }
  
  // Remove parameters for a run ID (cleanup)
  function removeParametersForRun(runId) {
    if (runId !== CURRENT_RUN_ID) {
      columnParameters.delete(runId);
    }
  }
  
  // Sync appState FROM current run parameters
  function syncAppStateFromRun(runId = CURRENT_RUN_ID) {
    if (runId === CURRENT_RUN_ID) {
      const params = getParametersForRun(CURRENT_RUN_ID);
      appState.selectedScenario = params.scenario;
      appState.selectedBaseScenario = params.baseScenario;
      appState.selectedAdmType = params.admType;
      appState.selectedLLM = params.llmBackbone;
      appState.activeKDMAs = { ...params.kdmas };
    }
  }
  
  // Sync current run parameters FROM appState
  function syncRunFromAppState() {
    const params = {
      scenario: appState.selectedScenario,
      baseScenario: appState.selectedBaseScenario,
      admType: appState.selectedAdmType,
      llmBackbone: appState.selectedLLM,
      kdmas: { ...appState.activeKDMAs }
    };
    
    const validParams = setParametersForRun(CURRENT_RUN_ID, params);
    
    // If auto-correction changed parameters, sync back to appState
    if (validParams.scenario !== params.scenario ||
        validParams.admType !== params.admType ||
        validParams.llmBackbone !== params.llmBackbone ||
        JSON.stringify(validParams.kdmas) !== JSON.stringify(params.kdmas)) {
      syncAppStateFromRun(CURRENT_RUN_ID);
      return true; // Parameters were corrected
    }
    
    return false; // No correction needed
  }
  
  // Update a parameter for any run with validation and UI sync
  function updateParameterForRun(runId, paramType, newValue, updateUI = true) {
    const params = getParametersForRun(runId);
    
    // Map parameter types to parameter structure fields
    const paramMap = {
      'scenario': 'scenario',
      'baseScenario': 'baseScenario', 
      'admType': 'admType',
      'llmBackbone': 'llmBackbone',
      'llm': 'llmBackbone', // alias
      'kdmas': 'kdmas'
    };
    
    const paramField = paramMap[paramType] || paramType;
    params[paramField] = newValue;
    
    // Apply auto-correction
    const correctedParams = setParametersForRun(runId, params);
    
    // Update UI if it's the current run
    if (runId === CURRENT_RUN_ID && updateUI) {
      syncAppStateFromRun(CURRENT_RUN_ID);
      updateUIFromCorrectedParams(correctedParams);
    }
    
    return correctedParams;
  }
  
  // Initialize the run context system after manifest is loaded
  function initializeRunContextSystem() {
    // Initialize current run parameters from appState
    // This establishes the baseline for the current sidebar state
    syncRunFromAppState();
    
    console.log('Run context system initialized with current run:', getParametersForRun(CURRENT_RUN_ID));
  }

  // URL State Management System
  const urlState = {
    // Encode current state to URL
    updateURL() {
      const state = {
        baseScenario: appState.selectedBaseScenario,
        scenario: appState.selectedScenario,
        admType: appState.selectedAdmType,
        llm: appState.selectedLLM,
        kdmas: appState.activeKDMAs,
        pinnedRuns: Array.from(appState.pinnedRuns.values()).map(run => ({
          scenario: run.scenario,
          baseScenario: run.baseScenario,
          admType: run.admType,
          llmBackbone: run.llmBackbone,
          kdmaValues: run.kdmaValues,
          id: run.id
        }))
      };
      
      try {
        const encodedState = btoa(JSON.stringify(state));
        const newURL = `${window.location.pathname}?state=${encodedState}`;
        window.history.replaceState(null, '', newURL);
      } catch (e) {
        console.warn('Failed to encode URL state:', e);
      }
    },

    // Restore state from URL on page load
    async restoreFromURL() {
      const params = new URLSearchParams(window.location.search);
      const stateParam = params.get('state');
      
      if (stateParam) {
        try {
          const state = JSON.parse(atob(stateParam));
          
          // Restore selections
          if (state.baseScenario) appState.selectedBaseScenario = state.baseScenario;
          if (state.scenario) appState.selectedScenario = state.scenario;
          if (state.admType) appState.selectedAdmType = state.admType;
          if (state.llm) appState.selectedLLM = state.llm;
          if (state.kdmas) appState.activeKDMAs = { ...state.kdmas };
          
          // Update UI controls to reflect restored state
          updateUIFromState();
          
          // Sync restored state to current run parameters
          syncRunFromAppState();
          
          // Restore pinned runs
          if (state.pinnedRuns && state.pinnedRuns.length > 0) {
            for (const runConfig of state.pinnedRuns) {
              await pinRunFromConfig(runConfig);
            }
          }
          
          // Load current run if configured
          if (appState.selectedScenario) {
            await loadResults();
          }
          
          return true; // Successfully restored
          
        } catch (e) {
          console.warn('Invalid URL state, using defaults:', e);
          return false;
        }
      }
      return false; // No state to restore
    }
  };

  // Function to fetch and parse manifest.json
  async function fetchManifest() {
    try {
      const response = await fetch("/manifest.json");
      manifest = await response.json();
      console.log("Manifest loaded:", manifest);
      extractParametersFromManifest();
      populateUIControls();
      
      // Initialize run context system
      initializeRunContextSystem();
      
      // Try to restore state from URL, otherwise load results normally
      const restoredFromURL = await urlState.restoreFromURL();
      if (!restoredFromURL) {
        loadResults(); // Load results initially only if not restored from URL
      }
    } catch (error) {
      console.error("Error fetching manifest:", error);
      // Error will be displayed in the table
      updateComparisonDisplay();
    }
  }

  // Extract unique parameters and build validCombinations structure
  function extractParametersFromManifest() {
    appState.availableScenarios.clear();
    appState.availableBaseScenarios.clear();
    appState.availableAdmTypes.clear();
    appState.availableKDMAs.clear();
    appState.availableLLMs.clear();
    appState.validCombinations = {};

    // Handle new manifest structure with experiment_keys
    const experiments = manifest.experiment_keys || manifest;

    // First pass: collect all scenarios and base scenario IDs
    for (const experimentKey in experiments) {
      const experiment = experiments[experimentKey];
      for (const scenarioId in experiment.scenarios) {
        appState.availableScenarios.add(scenarioId);
        // Extract base scenario ID by removing index suffix
        const baseScenarioId = scenarioId.replace(/-\d+$/, "");
        appState.availableBaseScenarios.add(baseScenarioId);
      }
    }

    // Second pass: build global parameter sets
    for (const experimentKey in experiments) {
      const experiment = experiments[experimentKey];
      for (const scenarioId in experiment.scenarios) {
        const scenario = experiment.scenarios[scenarioId];
        const config = scenario.config;
        if (!config) continue;

        const admType = config.adm ? config.adm.name : "unknown_adm";
        const llmBackbone =
          config.adm &&
          config.adm.structured_inference_engine &&
          config.adm.structured_inference_engine.model_name
            ? config.adm.structured_inference_engine.model_name
            : "no_llm";

        appState.availableAdmTypes.add(admType);
        appState.availableLLMs.add(llmBackbone);

        if (!appState.validCombinations[admType]) {
          appState.validCombinations[admType] = {};
        }
        if (!appState.validCombinations[admType][llmBackbone]) {
          appState.validCombinations[admType][llmBackbone] = {};
        }

        if (config.alignment_target && config.alignment_target.kdma_values) {
          config.alignment_target.kdma_values.forEach((kdma_entry) => {
            const kdma = kdma_entry.kdma;
            const value = kdma_entry.value;
            appState.availableKDMAs.add(kdma);

            if (!appState.validCombinations[admType][llmBackbone][kdma]) {
              appState.validCombinations[admType][llmBackbone][kdma] = new Set();
            }
            appState.validCombinations[admType][llmBackbone][kdma].add(value);
          });
        }
      }
    }

    // Convert Sets to sorted Arrays for easier use in UI
    appState.availableScenarios = Array.from(appState.availableScenarios).sort();
    appState.availableBaseScenarios = Array.from(appState.availableBaseScenarios).sort();
    appState.availableAdmTypes = Array.from(appState.availableAdmTypes).sort();
    appState.availableKDMAs = Array.from(appState.availableKDMAs).sort();
    appState.availableLLMs = Array.from(appState.availableLLMs).sort();

    // Convert inner Sets to sorted Arrays
    for (const adm in appState.validCombinations) {
      for (const llm in appState.validCombinations[adm]) {
        for (const kdma in appState.validCombinations[adm][llm]) {
          appState.validCombinations[adm][llm][kdma] = Array.from(
            appState.validCombinations[adm][llm][kdma],
          ).sort((a, b) => a - b);
        }
      }
    }

    console.log("Available base scenarios:", appState.availableBaseScenarios);
    console.log("Available scenarios:", appState.availableScenarios);
    console.log("Valid Combinations (structured):", appState.validCombinations);
  }

  // ===== EXTRACTED VALIDITY LOGIC (Phase 1) =====
  
  // Core function that extracts parameters from experiment config
  function extractParametersFromConfig(config) {
    if (!config) return null;
    
    const admType = config.adm ? config.adm.name : "unknown_adm";
    const llmBackbone = config.adm && 
      config.adm.structured_inference_engine && 
      config.adm.structured_inference_engine.model_name
      ? config.adm.structured_inference_engine.model_name 
      : "no_llm";
    
    const kdmas = {};
    if (config.alignment_target && config.alignment_target.kdma_values) {
      config.alignment_target.kdma_values.forEach((kdma_entry) => {
        const kdma = kdma_entry.kdma;
        const value = kdma_entry.value;
        
        if (!kdmas[kdma]) {
          kdmas[kdma] = new Set();
        }
        kdmas[kdma].add(value);
      });
    }
    
    return { admType, llmBackbone, kdmas };
  }
  
  // Check if extracted parameters match given constraints
  function matchesConstraints(constraints, scenarioId, params) {
    if (constraints.scenario && constraints.scenario !== scenarioId) {
      return false;
    }
    if (constraints.admType && constraints.admType !== params.admType) {
      return false;
    }
    if (constraints.llmBackbone && constraints.llmBackbone !== params.llmBackbone) {
      return false;
    }
    if (constraints.kdmas) {
      // Check if all constraint KDMAs have matching values
      for (const [kdmaName, requiredValue] of Object.entries(constraints.kdmas)) {
        if (!params.kdmas[kdmaName] || !params.kdmas[kdmaName].has(requiredValue)) {
          return false;
        }
      }
    }
    return true;
  }
  
  // Core function that finds all valid options given constraints
  function getValidOptionsForConstraints(constraints = {}) {
    const experiments = manifest.experiment_keys || manifest;
    const validOptions = {
      scenarios: new Set(),
      admTypes: new Set(),
      llmBackbones: new Set(),
      kdmas: {} // kdmaName -> Set of valid values
    };
    
    for (const expKey in experiments) {
      const experiment = experiments[expKey];
      
      for (const scenarioId in experiment.scenarios) {
        const scenario = experiment.scenarios[scenarioId];
        const params = extractParametersFromConfig(scenario.config);
        
        if (params && matchesConstraints(constraints, scenarioId, params)) {
          validOptions.scenarios.add(scenarioId);
          validOptions.admTypes.add(params.admType);
          validOptions.llmBackbones.add(params.llmBackbone);
          
          // Merge KDMAs
          for (const [kdmaName, kdmaValues] of Object.entries(params.kdmas)) {
            if (!validOptions.kdmas[kdmaName]) {
              validOptions.kdmas[kdmaName] = new Set();
            }
            kdmaValues.forEach(value => validOptions.kdmas[kdmaName].add(value));
          }
        }
      }
    }
    
    return validOptions;
  }
  
  // Convenience function to check if a specific parameter combination is valid
  function isValidParameterCombination(scenario, admType, llmBackbone, kdmas) {
    const constraints = { scenario, admType, llmBackbone, kdmas };
    const validOptions = getValidOptionsForConstraints(constraints);
    return validOptions.scenarios.has(scenario);
  }
  
  // ===== PARAMETER AUTO-CORRECTION LOGIC (Phase 2) =====
  
  // Find a valid parameter combination given partial constraints and preferences
  function findValidParameterCombination(constraints = {}, preferences = {}) {
    // Start with current selections as baseline
    const currentParams = {
      scenario: constraints.scenario || appState.selectedScenario,
      admType: constraints.admType || appState.selectedAdmType,
      llmBackbone: constraints.llmBackbone || appState.selectedLLM,
      kdmas: constraints.kdmas || { ...appState.activeKDMAs }
    };
    
    // If current combination is already valid, return it
    if (isValidParameterCombination(currentParams.scenario, currentParams.admType, currentParams.llmBackbone, currentParams.kdmas)) {
      return currentParams;
    }
    
    // Priority 1: Try to find valid scenario for current ADM+LLM
    if (currentParams.admType && currentParams.llmBackbone) {
      const validOptions = getValidOptionsForConstraints({ 
        admType: currentParams.admType, 
        llmBackbone: currentParams.llmBackbone 
      });
      
      if (validOptions.scenarios.size > 0) {
        const validScenario = Array.from(validOptions.scenarios)[0];
        const correctedParams = { ...currentParams, scenario: validScenario };
        
        // Get valid KDMAs for this combination
        const kdmaOptions = getValidOptionsForConstraints(correctedParams);
        if (Object.keys(kdmaOptions.kdmas).length > 0) {
          const firstKDMA = Object.keys(kdmaOptions.kdmas)[0];
          const firstValue = Array.from(kdmaOptions.kdmas[firstKDMA])[0];
          correctedParams.kdmas = { [firstKDMA]: firstValue };
          return correctedParams;
        }
      }
    }
    
    // Priority 2: Try to find valid LLM for current ADM
    if (currentParams.admType) {
      const validOptions = getValidOptionsForConstraints({ admType: currentParams.admType });
      
      if (validOptions.llmBackbones.size > 0) {
        // Prefer user's LLM preference if valid, otherwise use first available
        const preferredLLM = preferences.llmPreferences && preferences.llmPreferences[currentParams.admType];
        let selectedLLM;
        
        if (preferredLLM && validOptions.llmBackbones.has(preferredLLM)) {
          selectedLLM = preferredLLM;
        } else {
          selectedLLM = Array.from(validOptions.llmBackbones)[0];
        }
        
        const correctedParams = { ...currentParams, llmBackbone: selectedLLM };
        
        // Find valid scenario for this ADM+LLM combination
        const scenarioOptions = getValidOptionsForConstraints({ 
          admType: currentParams.admType, 
          llmBackbone: selectedLLM 
        });
        
        if (scenarioOptions.scenarios.size > 0) {
          correctedParams.scenario = Array.from(scenarioOptions.scenarios)[0];
          
          // Get valid KDMAs
          const kdmaOptions = getValidOptionsForConstraints(correctedParams);
          if (Object.keys(kdmaOptions.kdmas).length > 0) {
            const firstKDMA = Object.keys(kdmaOptions.kdmas)[0];
            const firstValue = Array.from(kdmaOptions.kdmas[firstKDMA])[0];
            correctedParams.kdmas = { [firstKDMA]: firstValue };
            return correctedParams;
          }
        }
      }
    }
    
    // Priority 3: Find any valid ADM combination
    const allValidOptions = getValidOptionsForConstraints({});
    
    if (allValidOptions.admTypes.size > 0) {
      const firstValidADM = Array.from(allValidOptions.admTypes)[0];
      const admOptions = getValidOptionsForConstraints({ admType: firstValidADM });
      
      if (admOptions.llmBackbones.size > 0 && admOptions.scenarios.size > 0) {
        const firstValidLLM = Array.from(admOptions.llmBackbones)[0];
        const firstValidScenario = Array.from(admOptions.scenarios)[0];
        
        const correctedParams = {
          scenario: firstValidScenario,
          admType: firstValidADM,
          llmBackbone: firstValidLLM,
          kdmas: {}
        };
        
        // Get valid KDMAs for this combination
        const kdmaOptions = getValidOptionsForConstraints(correctedParams);
        if (Object.keys(kdmaOptions.kdmas).length > 0) {
          const firstKDMA = Object.keys(kdmaOptions.kdmas)[0];
          const firstValue = Array.from(kdmaOptions.kdmas[firstKDMA])[0];
          correctedParams.kdmas = { [firstKDMA]: firstValue };
        }
        
        return correctedParams;
      }
    }
    
    // Fallback: return current params (should not happen with valid manifest)
    return currentParams;
  }
  
  // Correct parameters to be valid while preserving user preferences
  function correctParametersToValid(currentParams, preservePreferences = true) {
    const preferences = preservePreferences ? {
      llmPreferences: appState.llmPreferences
    } : {};
    
    return findValidParameterCombination(currentParams, preferences);
  }
  
  // Update a single parameter and auto-correct others to maintain validity
  function updateParameterWithValidation(paramType, newValue, updateUI = true) {
    const constraints = {};
    constraints[paramType] = newValue;
    
    const correctedParams = correctParametersToValid(constraints);
    
    if (updateUI) {
      // Update appState
      appState.selectedScenario = correctedParams.scenario;
      appState.selectedAdmType = correctedParams.admType;
      appState.selectedLLM = correctedParams.llmBackbone;
      appState.activeKDMAs = correctedParams.kdmas;
      
      // Update UI controls
      updateUIFromCorrectedParams(correctedParams);
    }
    
    return correctedParams;
  }
  
  // Helper function to update UI controls from corrected parameters
  function updateUIFromCorrectedParams(params) {
    appState.isUpdatingProgrammatically = true;
    
    // Update scenario selects
    if (params.scenario !== appState.selectedScenario) {
      const baseScenarioId = params.scenario.replace(/-\d+$/, "");
      const baseScenarioSelect = document.getElementById("base-scenario-select");
      const scenarioSelect = document.getElementById("scenario-select");
      
      if (baseScenarioSelect && baseScenarioSelect.value !== baseScenarioId) {
        appState.selectedBaseScenario = baseScenarioId;
        baseScenarioSelect.value = baseScenarioId;
        updateSpecificScenarioDropdown();
      }
      
      if (scenarioSelect && scenarioSelect.value !== params.scenario) {
        scenarioSelect.value = params.scenario;
      }
    }
    
    // Update ADM select
    const admSelect = document.getElementById("adm-type-select");
    if (admSelect && admSelect.value !== params.admType) {
      admSelect.value = params.admType;
    }
    
    // Update LLM select
    const llmSelect = document.getElementById("llm-select");
    if (llmSelect && llmSelect.value !== params.llmBackbone) {
      llmSelect.value = params.llmBackbone;
    }
    
    appState.isUpdatingProgrammatically = false;
  }

  function populateUIControls() {
    // ADM Type Selection
    admTypeSelection.innerHTML = "<h3>ADM Type</h3>";
    const admSelect = document.createElement("select");
    admSelect.id = "adm-type-select";
    admTypeSelection.appendChild(admSelect);
    admSelect.addEventListener("change", () => {
      if (appState.isUpdatingProgrammatically) return;
      appState.selectedAdmType = admSelect.value;
      updateLLMDropdown();
      if (!appState.isTransitioning) {
        loadResults();
      }
      urlState.updateURL(); // Update URL with new state
      
      // Sync to current run parameters
      syncRunFromAppState();
    });

    // LLM Backbone Selection
    llmSelection.innerHTML = "<h3>LLM Backbone</h3>";
    const llmSelect = document.createElement("select");
    llmSelect.id = "llm-select";
    llmSelection.appendChild(llmSelect);
    llmSelect.addEventListener("change", () => {
      if (appState.isUpdatingProgrammatically) return;
      appState.selectedLLM = llmSelect.value;
      // Store user's LLM preference for current ADM type
      if (appState.selectedAdmType) {
        appState.llmPreferences[appState.selectedAdmType] = llmSelect.value;
      }
      updateKDMASliders();
      if (!appState.isTransitioning) {
        loadResults();
      }
      urlState.updateURL(); // Update URL with new state
      
      // Sync to current run parameters
      syncRunFromAppState();
    });

    // KDMA Dynamic Selection container
    kdmaSliders.innerHTML = `
      <h3>KDMA Values</h3>
      <div id="active-kdmas"></div>
      <button id="add-kdma-btn" style="margin-top: 10px;">Add KDMA</button>
    `;

    // Base Scenario Selection - Add event listener to existing element
    const baseScenarioSelect = document.getElementById("base-scenario-select");
    baseScenarioSelect.addEventListener("change", () => {
      if (appState.isUpdatingProgrammatically) return;
      
      // Mark as transitioning to prevent "No data found" flash
      appState.isTransitioning = true;
      appState.isUpdatingProgrammatically = true;
      
      appState.selectedBaseScenario = baseScenarioSelect.value;
      updateSpecificScenarioDropdown(); // This updates appState.selectedScenario and DOM
      
      appState.isUpdatingProgrammatically = false;
      
      updateFromScenarioChange(); // This will clear isTransitioning when done
      urlState.updateURL(); // Update URL with new state
      
      // Sync to current run parameters
      syncRunFromAppState();
    });

    // Specific Scenario Selection - Add event listener to existing element
    const scenarioSelect = document.getElementById("scenario-select");
    scenarioSelect.addEventListener("change", () => {
      if (appState.isUpdatingProgrammatically) return;
      appState.selectedScenario = scenarioSelect.value;
      if (!appState.isTransitioning) {
        updateFromScenarioChange();
      }
      urlState.updateURL(); // Update URL with new state
      
      // Sync to current run parameters
      syncRunFromAppState();
    });

    // Add event handler for Add KDMA button
    document.getElementById("add-kdma-btn").addEventListener("click", () => {
      const validKDMAs = getValidKDMAsForCurrentSelection();
      const availableToAdd = Object.keys(validKDMAs).filter(k => appState.activeKDMAs[k] === undefined);
      
      if (availableToAdd.length > 0) {
        const kdmaToAdd = availableToAdd[0]; // Pick first available
        const validValues = validKDMAs[kdmaToAdd] || [];
        addKDMASelector(kdmaToAdd, validValues[0] || 0.5);
        updateAddKDMAButton();
        if (!appState.isTransitioning) {
          loadResults();
        }
        
        // Sync to current run parameters
        syncRunFromAppState();
      }
    });

    // Initial population of dropdowns and sliders
    // Order matters: Scenario first, then ADM filtered by scenario, then LLM and KDMAs
    updateBaseScenarioDropdown();
    updateADMDropdown();
    updateLLMDropdown(); // This will also call updateKDMASliders
    
    // Initialize current run parameters with initial state
    syncRunFromAppState();
  }

  function getValidADMsForCurrentScenario() {
    const currentScenario = appState.selectedScenario || getFirstAvailableScenario();
    const validOptions = getValidOptionsForConstraints({ scenario: currentScenario });
    return Array.from(validOptions.admTypes).sort();
  }

  function updateADMDropdown() {
    const admSelect = document.getElementById("adm-type-select");
    admSelect.innerHTML = ""; // Clear existing options

    // Get ADM types that are valid for the current scenario
    const validADMs = getValidADMsForCurrentScenario();
    
    if (validADMs.length === 0) {
      // No valid ADMs for current scenario - add placeholder
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No ADMs available for selected scenario";
      option.disabled = true;
      admSelect.appendChild(option);
      admSelect.disabled = true;
      return;
    }
    
    admSelect.disabled = false;
    validADMs.forEach((type) => {
      const option = document.createElement("option");
      option.value = type;
      option.textContent = type;
      admSelect.appendChild(option);
    });
    
    // Preserve current ADM selection if still valid, otherwise use first valid
    appState.isUpdatingProgrammatically = true;
    
    const currentAdm = appState.selectedAdmType;
    const admToSelect = (currentAdm && validADMs.includes(currentAdm)) ? currentAdm : validADMs[0];
    
    admSelect.value = admToSelect;
    appState.selectedAdmType = admToSelect;
    appState.isUpdatingProgrammatically = false;
  }

  function updateLLMDropdown() {
    const selectedAdm = appState.selectedAdmType || document.getElementById("adm-type-select").value;
    const llmSelect = document.getElementById("llm-select");
    llmSelect.innerHTML = ""; // Clear existing options

    const validOptions = getValidOptionsForConstraints({ admType: selectedAdm });
    const validLLMsForAdm = Array.from(validOptions.llmBackbones).sort();

    validLLMsForAdm.forEach((llm) => {
      const option = document.createElement("option");
      option.value = llm;
      option.textContent = llm;
      llmSelect.appendChild(option);
    });

    // Preserve LLM selection using stored preferences per ADM type
    if (validLLMsForAdm.length > 0) {
      appState.isUpdatingProgrammatically = true;
      
      // Check if we have a stored preference for this ADM type
      const preferredLLM = appState.llmPreferences[appState.selectedAdmType];
      const currentLLM = appState.selectedLLM;
      
      // Priority: 1) Stored preference if valid, 2) Current LLM if valid, 3) First available
      let llmToSelect;
      if (preferredLLM && validLLMsForAdm.includes(preferredLLM)) {
        llmToSelect = preferredLLM;
      } else if (currentLLM && validLLMsForAdm.includes(currentLLM)) {
        llmToSelect = currentLLM;
      } else {
        llmToSelect = validLLMsForAdm[0];
      }
      
      llmSelect.value = llmToSelect;
      appState.selectedLLM = llmToSelect;
      appState.isUpdatingProgrammatically = false;
    }

    // Disable LLM select if only one option is available
    if (validLLMsForAdm.length <= 1) {
      llmSelect.disabled = true;
    } else {
      llmSelect.disabled = false;
    }

    updateKDMASliders();
  }





  // Show loading spinner during transitions
  function showTransitionSpinner() {
    // Loading state will be shown in the table
    updateComparisonDisplay();
  }

  // Update function for scenario changes
  function updateFromScenarioChange() {
    // Show spinner immediately during transitions
    if (appState.isTransitioning) {
      showTransitionSpinner();
    }
    
    updateADMDropdown();
    updateLLMDropdown();
    
    // Clear transition flag and load results
    appState.isTransitioning = false;
    
    if (appState.selectedScenario) {
      loadResults();
    }
  }

  function getValidKDMAsForCurrentSelection() {
    const selectedAdm = document.getElementById("adm-type-select").value;
    const selectedLLM = document.getElementById("llm-select").value;
    const currentScenario = appState.selectedScenario || getFirstAvailableScenario();
    
    const constraints = {
      scenario: currentScenario,
      admType: selectedAdm,
      llmBackbone: selectedLLM
    };
    
    const validOptions = getValidOptionsForConstraints(constraints);
    
    // Convert Sets to sorted arrays to match original format
    const validKDMAs = {};
    Object.keys(validOptions.kdmas).forEach(kdma => {
      validKDMAs[kdma] = Array.from(validOptions.kdmas[kdma]).sort((a, b) => a - b);
    });
    
    return validKDMAs;
  }
  
  function getFirstAvailableScenario() {
    // Get first scenario from available scenarios, fallback to first in manifest
    if (appState.availableScenarios.length > 0) {
      return appState.availableScenarios[0];
    }
    
    const experiments = manifest.experiment_keys || manifest;
    for (const expKey in experiments) {
      const scenarios = experiments[expKey].scenarios;
      if (scenarios && Object.keys(scenarios).length > 0) {
        return Object.keys(scenarios)[0];
      }
    }
    return null;
  }

  function addKDMASelector(kdmaType, initialValue) {
    if (appState.activeKDMAs[kdmaType] !== undefined) {
      return; // Already exists
    }

    const activeKDMAsDiv = document.getElementById("active-kdmas");
    const kdmaDiv = document.createElement("div");
    kdmaDiv.className = "kdma-selector";
    kdmaDiv.id = `kdma-selector-${kdmaType}`;
    kdmaDiv.style.marginBottom = "10px";
    
    const validValues = getValidKDMAsForCurrentSelection()[kdmaType] || [];
    const value = initialValue !== undefined ? initialValue : (validValues[0] || 0.5);
    
    const availableKDMAs = getValidKDMAsForCurrentSelection();
    const availableForThisSelector = Object.keys(availableKDMAs).filter(k => 
      k === kdmaType || appState.activeKDMAs[k] === undefined
    );
    
    kdmaDiv.innerHTML = `
      <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
        <select id="${kdmaType}-type-select" style="min-width: 120px;">
          ${availableForThisSelector.map(k => 
            `<option value="${k}" ${k === kdmaType ? 'selected' : ''}>${k}</option>`
          ).join('')}
        </select>
        <input type="range" id="${kdmaType}-slider" min="0" max="1" step="0.1" value="${value}" style="min-width: 150px;">
        <span id="${kdmaType}-value" style="min-width: 30px;">${value.toFixed(1)}</span>
        <span id="${kdmaType}-warning" style="color: red; font-size: 12px; display: none;">⚠️ Invalid value</span>
        <button onclick="removeKDMASelector('${kdmaType}')" style="margin-left: 10px;">Remove</button>
      </div>
    `;
    
    activeKDMAsDiv.appendChild(kdmaDiv);
    
    // Add event listeners
    const typeSelect = kdmaDiv.querySelector(`#${kdmaType}-type-select`);
    const slider = kdmaDiv.querySelector(`#${kdmaType}-slider`);
    const valueSpan = kdmaDiv.querySelector(`#${kdmaType}-value`);
    const warningSpan = kdmaDiv.querySelector(`#${kdmaType}-warning`);
    
    // Handle KDMA type change
    typeSelect.addEventListener("change", () => {
      const newKdmaType = typeSelect.value;
      const oldKdmaType = kdmaType;
      
      // Update the active KDMAs tracking
      const currentValue = appState.activeKDMAs[oldKdmaType];
      delete appState.activeKDMAs[oldKdmaType];
      
      // Get valid values for new type and adjust value if needed
      const validValues = getValidKDMAsForCurrentSelection()[newKdmaType] || [];
      let newValue = currentValue;
      if (validValues.length > 0 && !validValues.includes(currentValue)) {
        newValue = validValues[0]; // Use first valid value
      }
      
      appState.activeKDMAs[newKdmaType] = newValue;
      
      // Update slider value and display
      slider.value = newValue;
      valueSpan.textContent = newValue.toFixed(1);
      
      // Update the kdmaType reference for future operations
      kdmaType = newKdmaType;
      
      // Update IDs to match new type
      slider.id = `${newKdmaType}-slider`;
      valueSpan.id = `${newKdmaType}-value`;
      warningSpan.id = `${newKdmaType}-warning`;
      kdmaDiv.id = `kdma-selector-${newKdmaType}`;
      
      // Update remove button onclick
      const removeButton = kdmaDiv.querySelector('button');
      removeButton.setAttribute('onclick', `removeKDMASelector('${newKdmaType}')`);
      
      validateKDMAValue(newKdmaType, newValue, warningSpan);
      updateAllKDMATypeSelectors(); // Update all KDMA dropdowns
      updateAddKDMAButton();
      if (!appState.isTransitioning) {
        loadResults();
      }
      urlState.updateURL(); // Update URL with new state
    });
    
    // Handle slider value change
    slider.addEventListener("input", () => {
      const rawValue = parseFloat(slider.value);
      const validValues = getValidKDMAsForCurrentSelection()[kdmaType] || [];
      
      // Snap to nearest valid value if we have valid values
      let newValue = rawValue;
      if (validValues.length > 0) {
        newValue = validValues.reduce((closest, validValue) => 
          Math.abs(validValue - rawValue) < Math.abs(closest - rawValue) ? validValue : closest
        );
        
        // Update slider to show snapped value
        if (newValue !== rawValue) {
          slider.value = newValue;
        }
      }
      
      valueSpan.textContent = newValue.toFixed(1);
      appState.activeKDMAs[kdmaType] = newValue;
      
      validateKDMAValue(kdmaType, newValue, warningSpan);
      if (!appState.isTransitioning) {
        loadResults();
      }
      urlState.updateURL(); // Update URL with new state
      
      // Sync to current run parameters
      syncRunFromAppState();
    });
    
    appState.activeKDMAs[kdmaType] = value;
    
    // Update all KDMA dropdowns to reflect the new addition
    updateAllKDMATypeSelectors();
  }

  // Helper function to validate KDMA value and show/hide warning
  function validateKDMAValue(kdmaType, value, warningSpan) {
    const validValues = getValidKDMAsForCurrentSelection()[kdmaType] || [];
    
    if (validValues.length === 0) {
      warningSpan.style.display = 'inline';
      warningSpan.textContent = '⚠️ KDMA not available for current selection';
    } else if (!validValues.includes(value)) {
      warningSpan.style.display = 'inline';
      warningSpan.textContent = `⚠️ Value ${value.toFixed(1)} not valid. Valid: ${validValues.map(v => v.toFixed(1)).join(', ')}`;
    } else {
      warningSpan.style.display = 'none';
    }
  }

  // Function to update all KDMA type selectors with filtered options
  function updateAllKDMATypeSelectors() {
    const validKDMAs = getValidKDMAsForCurrentSelection();
    
    Object.keys(appState.activeKDMAs).forEach(kdmaType => {
      const typeSelect = document.getElementById(`${kdmaType}-type-select`);
      if (typeSelect) {
        const currentSelection = typeSelect.value;
        const availableForThisSelector = Object.keys(validKDMAs).filter(k => 
          k === currentSelection || appState.activeKDMAs[k] === undefined
        );
        
        typeSelect.innerHTML = '';
        availableForThisSelector.forEach(k => {
          const option = document.createElement('option');
          option.value = k;
          option.textContent = k;
          option.selected = k === currentSelection;
          typeSelect.appendChild(option);
        });
      }
    });
  }

  // Make removeKDMASelector global so onclick can access it
  window.removeKDMASelector = function(kdmaType) {
    const kdmaDiv = document.getElementById(`kdma-selector-${kdmaType}`);
    if (kdmaDiv) {
      kdmaDiv.remove();
      delete appState.activeKDMAs[kdmaType];
      updateAllKDMATypeSelectors(); // Update all remaining KDMA dropdowns
      updateAddKDMAButton();
      if (!appState.isTransitioning) {
        loadResults();
      }
      urlState.updateURL(); // Update URL with new state
      
      // Sync to current run parameters
      syncRunFromAppState();
    }
  };

  function getMaxKDMAsForCurrentSelection() {
    const selectedAdm = document.getElementById("adm-type-select").value;
    const selectedLLM = document.getElementById("llm-select").value;
    const currentScenario = appState.selectedScenario || getFirstAvailableScenario();
    
    // Check actual experiment data to find max KDMAs for this ADM/LLM/Scenario combination
    const experiments = manifest.experiment_keys || manifest;
    let maxKDMAs = 0;
    
    // Look through all experiments to find the one with the most KDMAs for this ADM/LLM combination
    for (const expKey in experiments) {
      const experiment = experiments[expKey];
      
      // Check if this experiment has the current scenario
      if (experiment.scenarios && experiment.scenarios[currentScenario]) {
        const config = experiment.scenarios[currentScenario].config;
        if (!config) continue;
        
        const expAdm = config.adm ? config.adm.name : "unknown_adm";
        const expLLM = config.adm && 
          config.adm.structured_inference_engine && 
          config.adm.structured_inference_engine.model_name
          ? config.adm.structured_inference_engine.model_name 
          : "no_llm";
        
        // Only count KDMAs from experiments that match our ADM/LLM selection
        if (expAdm === selectedAdm && expLLM === selectedLLM) {
          if (config.alignment_target && config.alignment_target.kdma_values) {
            maxKDMAs = Math.max(maxKDMAs, config.alignment_target.kdma_values.length);
          }
        }
      }
    }
    
    // If no experiments found for current scenario, fallback to checking all experiments for this ADM/LLM
    if (maxKDMAs === 0) {
      for (const expKey in experiments) {
        if (expKey.startsWith(`${selectedAdm}_${selectedLLM}_`)) {
          const scenarios = experiments[expKey].scenarios;
          if (scenarios && Object.keys(scenarios).length > 0) {
            const firstScenario = Object.values(scenarios)[0];
            if (firstScenario.config && firstScenario.config.alignment_target) {
              const kdmaValues = firstScenario.config.alignment_target.kdma_values;
              maxKDMAs = Math.max(maxKDMAs, kdmaValues.length);
            }
          }
        }
      }
    }
    
    return maxKDMAs;
  }

  function updateAddKDMAButton() {
    const addButton = document.getElementById("add-kdma-btn");
    const validKDMAs = getValidKDMAsForCurrentSelection();
    const availableToAdd = Object.keys(validKDMAs).filter(k => appState.activeKDMAs[k] === undefined);
    const maxKDMAs = getMaxKDMAsForCurrentSelection();
    const currentKDMACount = Object.keys(appState.activeKDMAs).length;
    
    // Update button state based on both available KDMAs and max limit
    // Check max limit first - this takes precedence
    if (maxKDMAs > 0 && currentKDMACount >= maxKDMAs) {
      addButton.disabled = true;
      addButton.textContent = `Max KDMAs reached (${maxKDMAs})`;
    } else if (availableToAdd.length === 0) {
      addButton.disabled = true;
      // If max limit is known to be 1 and we have 1 KDMA, show limit message instead
      if (maxKDMAs === 1 && currentKDMACount === 1) {
        addButton.textContent = `Max KDMAs reached (${maxKDMAs})`;
      } else {
        addButton.textContent = "All KDMA types added";
      }
    } else {
      addButton.disabled = false;
      addButton.textContent = "Add KDMA";
    }
  }

  function updateKDMASliders() {
    const selectedAdm = document.getElementById("adm-type-select").value;
    const selectedLLM = document.getElementById("llm-select").value;
    const validKDMAs = getValidKDMAsForCurrentSelection();
    
    // Remove KDMAs that are no longer valid
    Object.keys(appState.activeKDMAs).forEach(kdmaType => {
      if (!validKDMAs[kdmaType]) {
        removeKDMASelector(kdmaType);
      }
    });
    
    // Fix invalid values for remaining KDMAs first
    Object.keys(appState.activeKDMAs).forEach(kdmaType => {
      const validValues = validKDMAs[kdmaType] || [];
      const currentValue = appState.activeKDMAs[kdmaType];
      
      // If current value is not valid, update to a valid value
      if (validValues.length > 0 && !validValues.includes(currentValue)) {
        const newValue = validValues[0]; // Use first valid value
        appState.activeKDMAs[kdmaType] = newValue;
        
        // Update the slider and display
        const slider = document.getElementById(`${kdmaType}-slider`);
        const valueSpan = document.getElementById(`${kdmaType}-value`);
        if (slider && valueSpan) {
          slider.value = newValue;
          valueSpan.textContent = newValue.toFixed(1);
        }
      }
    });
    
    // Auto-correct parameters if we have invalid combination
    if (Object.keys(validKDMAs).length === 0) {
      // Use auto-correction to find valid parameter combination
      const correctedParams = correctParametersToValid({});
      
      // Apply corrections to UI if parameters changed
      if (correctedParams.scenario !== appState.selectedScenario ||
          correctedParams.admType !== appState.selectedAdmType ||
          correctedParams.llmBackbone !== appState.selectedLLM) {
        
        updateUIFromCorrectedParams(correctedParams);
        
        // Update appState 
        appState.selectedScenario = correctedParams.scenario;
        appState.selectedAdmType = correctedParams.admType;
        appState.selectedLLM = correctedParams.llmBackbone;
        
        // Recursive call with corrected parameters
        updateKDMASliders();
        return;
      }
    }
    
    // Add a KDMA if we have none and valid options are available
    if (Object.keys(appState.activeKDMAs).length === 0 && Object.keys(validKDMAs).length > 0) {
      const availableKDMAs = Object.keys(validKDMAs).sort();
      const firstKDMAType = availableKDMAs[0];
      const validValuesForKDMA = validKDMAs[firstKDMAType] || [];
      const firstValidValue = validValuesForKDMA.length > 0 ? validValuesForKDMA[0] : 0.5;
      addKDMASelector(firstKDMAType, firstValidValue);
    }
    
    // Update all KDMA type selectors with proper filtering
    updateAllKDMATypeSelectors();
    
    // Update values for existing KDMAs and show warnings
    Object.keys(appState.activeKDMAs).forEach(kdmaType => {
      const slider = document.getElementById(`${kdmaType}-slider`);
      const warningSpan = document.getElementById(`${kdmaType}-warning`);
      
      if (slider && warningSpan) {
        let currentValue = appState.activeKDMAs[kdmaType];
        const validValues = validKDMAs[kdmaType] || [];
        
        // Validate current value
        validateKDMAValue(kdmaType, currentValue, warningSpan);
        
        if (validValues.length === 0) {
          slider.disabled = true;
        } else {
          slider.disabled = false;
        }
      }
    });
    
    updateAddKDMAButton();
  }

  function updateBaseScenarioDropdown() {
    const baseScenarioSelect = document.getElementById("base-scenario-select");
    if (!baseScenarioSelect) {
      console.error("base-scenario-select element not found");
      return;
    }

    baseScenarioSelect.innerHTML = "";

    // Use all available base scenarios (not filtered by ADM/KDMA)
    if (appState.availableBaseScenarios.length === 0) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No base scenarios available";
      baseScenarioSelect.appendChild(option);
      baseScenarioSelect.disabled = true;
      return;
    }

    baseScenarioSelect.disabled = false;
    appState.availableBaseScenarios.forEach((baseScenarioId) => {
      const option = document.createElement("option");
      option.value = baseScenarioId;
      option.textContent = baseScenarioId;
      baseScenarioSelect.appendChild(option);
    });

    // Set initial base scenario if none selected
    if (!appState.selectedBaseScenario && appState.availableBaseScenarios.length > 0) {
      appState.selectedBaseScenario = appState.availableBaseScenarios[0];
      baseScenarioSelect.value = appState.selectedBaseScenario;
      updateSpecificScenarioDropdown();
    }
  }

  function updateSpecificScenarioDropdown() {
    const scenarioSelect = document.getElementById("scenario-select");
    scenarioSelect.innerHTML = "";

    if (!appState.selectedBaseScenario) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "Select a scenario type first";
      scenarioSelect.appendChild(option);
      scenarioSelect.disabled = true;
      return;
    }

    // Find all scenarios that match the selected base scenario
    const matchingScenarios = appState.availableScenarios.filter((scenarioId) => {
      const baseScenarioId = scenarioId.replace(/-\d+$/, "");
      return baseScenarioId === appState.selectedBaseScenario;
    });

    if (matchingScenarios.length === 0) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No specific scenarios available";
      scenarioSelect.appendChild(option);
      scenarioSelect.disabled = true;
      return;
    }

    scenarioSelect.disabled = false;
    matchingScenarios.forEach((scenarioId) => {
      const option = document.createElement("option");
      option.value = scenarioId;
      option.textContent = scenarioId;
      scenarioSelect.appendChild(option);
    });

    // Always set to first matching scenario when base scenario changes
    // This ensures consistent state and prevents "No data found" flashes
    appState.selectedScenario = matchingScenarios[0];
    scenarioSelect.value = appState.selectedScenario;
  }

  // Function to construct the key based on current UI selections
  function getSelectedKey() {
    const admType = appState.selectedAdmType || document.getElementById("adm-type-select").value;
    const llmBackbone = appState.selectedLLM || document.getElementById("llm-select").value;

    const kdmaParts = [];
    // Use activeKDMAs instead of querying DOM
    Object.entries(appState.activeKDMAs).forEach(([kdma, value]) => {
      kdmaParts.push(`${kdma}-${value.toFixed(1)}`);
    });
    
    // Sort KDMA parts to match the key generation in build.py
    const kdmaString = kdmaParts.sort().join("_");

    return `${admType}_${llmBackbone}_${kdmaString}`;
  }

  // Internal function to load results without loading guard
  async function loadResultsInternal() {
    if (!appState.selectedScenario) {
      // Message will be displayed in the table
      
      // Clear current data when no scenario
      appState.currentInputOutput = null;
      appState.currentInputOutputArray = null;
      appState.currentScores = null;
      appState.currentTiming = null;
      updatePinnedCount(); // Disable pin button when no data
      updateComparisonDisplay(); // Update table with no scenario state
      return;
    }

    const selectedKey = getSelectedKey();
    console.log(
      "Attempting to load:",
      selectedKey,
      "Scenario:",
      appState.selectedScenario,
    );

    // Handle new manifest structure with experiment_keys
    const experiments = manifest.experiment_keys || manifest;
    if (
      experiments[selectedKey] &&
      experiments[selectedKey].scenarios[appState.selectedScenario]
    ) {
      const dataPaths = experiments[selectedKey].scenarios[appState.selectedScenario];
      try {
        const inputOutputArray = await (await fetch(dataPaths.input_output)).json();
        const scoresArray = await (await fetch(dataPaths.scores)).json();
        const timingData = await (await fetch(dataPaths.timing)).json();

        // Extract the index from the scenario ID (e.g., "test_scenario_1-0" → 0)
        const scenarioIndex = parseInt(appState.selectedScenario.split('-').pop());
        
        // Get the specific element from each array using the index
        const inputOutputItem = inputOutputArray[scenarioIndex];
        const scoreItem = Array.isArray(scoresArray) ? scoresArray[0] : scoresArray;

        // Helper function to format complex data structures cleanly
        const formatValue = (value, depth = 0) => {
          const indent = '  '.repeat(depth);
          
          if (value === null || value === undefined) {
            return '<span style="color: #999; font-style: italic;">null</span>';
          }
          
          if (typeof value === 'boolean') {
            return `<span style="color: #0066cc; font-weight: bold;">${value}</span>`;
          }
          
          if (typeof value === 'number') {
            return `<span style="color: #cc6600; font-weight: bold;">${value}</span>`;
          }
          
          if (typeof value === 'string') {
            if (value.length > 100) {
              return `<div style="background-color: #f8f9fa; padding: 8px; border-radius: 4px; border-left: 3px solid #dee2e6; margin: 4px 0; white-space: pre-wrap;">${value}</div>`;
            }
            return `<span style="color: #333;">${value}</span>`;
          }
          
          if (Array.isArray(value)) {
            if (value.length === 0) {
              return '<span style="color: #999; font-style: italic;">empty list</span>';
            }
            
            let html = '<div style="margin: 4px 0;">';
            value.forEach((item, index) => {
              html += `<div style="margin: 2px 0; padding-left: ${depth * 20 + 10}px;">`;
              html += `<span style="color: #666; font-size: 0.9em;">${index + 1}.</span> `;
              html += formatValue(item, depth + 1);
              html += '</div>';
            });
            html += '</div>';
            return html;
          }
          
          if (typeof value === 'object') {
            const keys = Object.keys(value);
            if (keys.length === 0) {
              return '<span style="color: #999; font-style: italic;">empty object</span>';
            }
            
            let html = '<div style="margin: 4px 0;">';
            keys.forEach(key => {
              html += `<div style="margin: 4px 0; padding-left: ${depth * 20 + 10}px;">`;
              html += `<span style="color: #0066cc; font-weight: 600;">${key}:</span> `;
              html += formatValue(value[key], depth + 1);
              html += '</div>';
            });
            html += '</div>';
            return html;
          }
          
          return String(value);
        };

        // Format and display the specific element
        const formatResults = () => {
          let html = '';
          
          if (inputOutputItem && inputOutputItem.input) {
            const input = inputOutputItem.input;
            
            // Simple scenario header
            html += `<h3>${appState.selectedScenario}</h3>`;
            
            // Scenario description
            if (input.state) {
              html += `<p style="margin-bottom: 20px; font-size: 16px; line-height: 1.6;">${input.state}</p>`;
            }
            
            
            // Simplified choices with horizontal layout
            if (input.choices && Array.isArray(input.choices)) {
              html += '<h4>Choices</h4>';
              html += '<div style="display: flex; flex-wrap: wrap; gap: 15px; margin-bottom: 20px;">';
              input.choices.forEach((choice, idx) => {
                html += `<div style="flex: 1; min-width: 200px; padding: 12px; background-color: #f8f9fa; border-radius: 6px;">`;
                html += `<div style="font-weight: 500; margin-bottom: 8px;">${choice.unstructured || choice.description || 'No description'}</div>`;
                
                // Short KDMA bars
                if (choice.kdma_association) {
                  Object.entries(choice.kdma_association).forEach(([kdma, value]) => {
                    const percentage = Math.round(value * 100);
                    const color = value >= 0.7 ? '#28a745' : value >= 0.4 ? '#ffc107' : '#dc3545';
                    
                    html += '<div style="display: flex; align-items: center; gap: 8px; margin: 3px 0;">';
                    html += `<span style="min-width: 60px; font-size: 0.9em; color: #666;">${kdma}</span>`;
                    html += `<div style="width: 60px; height: 4px; background-color: #e9ecef; border-radius: 2px;">`;
                    html += `<div style="width: ${percentage}%; height: 100%; background-color: ${color}; border-radius: 2px;"></div>`;
                    html += '</div>';
                    html += `<span style="font-size: 0.85em; color: ${color}; font-weight: 500;">${value}</span>`;
                    html += '</div>';
                  });
                }
                html += '</div>';
              });
              html += '</div>';
            }
          }
          
          // Simplified ADM Decision
          if (inputOutputItem && inputOutputItem.output) {
            const output = inputOutputItem.output;
            
            html += '<h4>ADM Decision</h4>';
            
            // Show the action text
            if (output.action && output.action.unstructured) {
              html += `<p style="font-weight: 600; color: #2e7d32; margin-bottom: 10px;">${output.action.unstructured}</p>`;
            } else if (output.action && output.action.action_id) {
              html += `<p style="font-weight: 600; color: #2e7d32; margin-bottom: 10px;">${output.action.action_id}</p>`;
            }
            
            // Show the justification
            if (output.action && output.action.justification) {
              html += `<p style="line-height: 1.6; color: #555;"><strong>Justification:</strong> ${output.action.justification}</p>`;
            } else if (output.justification) {
              html += `<p style="line-height: 1.6; color: #555;"><strong>Justification:</strong> ${output.justification}</p>`;
            }
          } else {
            html += '<h4>ADM Decision</h4>';
            html += '<p style="color: #666;">No decision data available</p>';
          }
          
          
          
          return html;
        };
        
        // Content will be displayed via the comparison table
        
        // Store current data for pinning
        appState.currentInputOutput = inputOutputItem;
        appState.currentInputOutputArray = inputOutputArray; // Store full array for raw data access
        appState.currentScores = scoreItem;
        appState.currentTiming = timingData;
        updatePinnedCount(); // Enable pin button when data loads
        
        // Update scores and timing in parameters section
        updateScoresTimingSection(scoreItem, timingData);
        
        // Update comparison display (always-on table mode)
        updateComparisonDisplay();
      } catch (error) {
        console.error("Error fetching experiment data:", error);
        // Error will be displayed in the table
        
        // Clear current data on error
        appState.currentInputOutput = null;
        appState.currentInputOutputArray = null;
        appState.currentScores = null;
        appState.currentTiming = null;
        updatePinnedCount(); // Disable pin button when no data
        updateComparisonDisplay(); // Update table with error state
      }
    } else {
      // Generate debug information to help identify the issue
      const availableKeys = Object.keys(experiments).filter(key => 
        key.startsWith(`${selectedKey.split('_')[0]}_${selectedKey.split('_')[1]}_`)
      );
      
      // No data message will be displayed in the table
      
      // Clear current data when no data found
      appState.currentInputOutput = null;
      appState.currentScores = null;
      appState.currentTiming = null;
      updatePinnedCount(); // Disable pin button when no data
      updateComparisonDisplay(); // Update table with no data state
    }
  }

  // Function to update scores and timing in parameters section
  function updateScoresTimingSection(scoreItem, timingData) {
    const scoresTimingSection = document.getElementById('scores-timing-section');
    if (!scoresTimingSection) return;
    
    let html = '';
    
    // Only show if we have data
    if (scoreItem || timingData) {
      html += '<div style="margin-top: 30px; padding-top: 20px; border-top: 2px solid #e9ecef;">';
      html += '<h3 style="margin-bottom: 15px; color: #495057;">Results Summary</h3>';
      
      // Add Overall Score (on top)
      if (scoreItem && scoreItem.score !== undefined) {
        html += `<div style="margin: 8px 0;"><strong>Score:</strong> ${scoreItem.score.toFixed(3)}</div>`;
      }
      
      // Add Average Decision Time
      if (timingData && timingData.avg_time_s !== undefined) {
        html += `<div style="margin: 8px 0;"><strong>Average Decision Time:</strong> ${timingData.avg_time_s.toFixed(4)}s</div>`;
      }
      
      html += '</div>';
    }
    
    scoresTimingSection.innerHTML = html;
  }

  // Function to load and display results
  async function loadResults() {
    if (appState.isUpdatingProgrammatically) {
      // Don't update results while we're in the middle of updating dropdowns
      return;
    }
    
    await loadResultsInternal();
  }

  // Pin current run to comparison
  function pinCurrentRun() {
    if (!appState.currentInputOutput) {
      showNotification('No data to pin - load a configuration first', 'error');
      return;
    }
    
    const runConfig = appState.createRunConfig();
    
    // Check for duplicates
    const existingRunId = findExistingRun(runConfig);
    if (existingRunId) {
      showNotification('This configuration is already pinned', 'info');
      return;
    }
    
    // Store complete run data
    const pinnedData = {
      ...runConfig,
      inputOutput: appState.currentInputOutput,
      inputOutputArray: appState.currentInputOutputArray,
      scores: appState.currentScores,
      timing: appState.currentTiming,
      loadStatus: 'loaded'
    };
    
    appState.pinnedRuns.set(runConfig.id, pinnedData);
    updatePinnedCount();
    updateComparisonDisplay();
    
    // Update URL after pinning
    urlState.updateURL();
  }

  // Helper functions for comparison feature
  function findExistingRun(runConfig) {
    for (const [runId, pinnedRun] of appState.pinnedRuns) {
      if (pinnedRun.experimentKey === runConfig.experimentKey &&
          JSON.stringify(pinnedRun.kdmaValues) === JSON.stringify(runConfig.kdmaValues)) {
        return runId;
      }
    }
    return null;
  }

  function updatePinnedCount() {
    const count = appState.pinnedRuns.size;
    
    const clearButton = document.getElementById('clear-all-pins');
    if (clearButton) {
      clearButton.disabled = count === 0;
    }
    
    // Enable pin button only when we have current data
    const pinButton = document.getElementById('pin-current-run');
    if (pinButton) {
      pinButton.disabled = !appState.currentInputOutput;
    }
  }

  function clearAllPins() {
    // Clean up expansion states for all pinned runs
    appState.pinnedRuns.forEach((runData, runId) => {
      cleanupRunStates(runId);
    });
    
    appState.pinnedRuns.clear();
    updatePinnedCount();
    updateComparisonDisplay();
    
    // Update URL after clearing pins
    urlState.updateURL();
  }

  // Pin run from configuration (for URL restoration)
  async function pinRunFromConfig(runConfig) {
    // Set app state to match the configuration
    appState.selectedBaseScenario = runConfig.baseScenario;
    appState.selectedScenario = runConfig.scenario;
    appState.selectedAdmType = runConfig.admType;
    appState.selectedLLM = runConfig.llmBackbone;
    appState.activeKDMAs = { ...runConfig.kdmaValues };
    
    // Check for duplicates using the restored config
    const existingRunId = findExistingRun(runConfig);
    if (existingRunId) {
      console.log('Configuration already pinned:', runConfig.id);
      return;
    }
    
    // Load the results for this configuration
    try {
      await loadResultsForConfig(runConfig);
      
      // Store complete run data
      const pinnedData = {
        ...runConfig,
        inputOutput: appState.currentInputOutput,
        inputOutputArray: appState.currentInputOutputArray,
        scores: appState.currentScores,
        timing: appState.currentTiming,
        loadStatus: 'loaded'
      };
      
      appState.pinnedRuns.set(runConfig.id, pinnedData);
      updatePinnedCount();
      
    } catch (error) {
      console.warn('Failed to load data for pinned configuration:', error);
      // Still add to pinned runs but mark as failed
      const pinnedData = {
        ...runConfig,
        inputOutput: null,
        scores: null,
        timing: null,
        loadStatus: 'error'
      };
      appState.pinnedRuns.set(runConfig.id, pinnedData);
    }
  }

  // Update UI controls to reflect current app state
  function updateUIFromState() {
    // Update base scenario dropdown
    const baseScenarioSelect = document.getElementById("base-scenario-select");
    if (baseScenarioSelect && appState.selectedBaseScenario) {
      baseScenarioSelect.value = appState.selectedBaseScenario;
    }
    
    // Update scenario dropdown
    const scenarioSelect = document.getElementById("scenario-select");
    if (scenarioSelect && appState.selectedScenario) {
      scenarioSelect.value = appState.selectedScenario;
    }
    
    // Update ADM type
    const admTypeInputs = document.querySelectorAll('input[name="adm-type"]');
    admTypeInputs.forEach(input => {
      input.checked = input.value === appState.selectedAdmType;
    });
    
    // Update LLM selection
    const llmInputs = document.querySelectorAll('input[name="llm"]');
    llmInputs.forEach(input => {
      input.checked = input.value === appState.selectedLLM;
    });
    
    // Update KDMA sliders
    for (const [kdma, value] of Object.entries(appState.activeKDMAs)) {
      const slider = document.getElementById(`kdma-${kdma}`);
      if (slider) {
        slider.value = value;
        // Update display value
        const display = document.getElementById(`kdma-${kdma}-value`);
        if (display) {
          display.textContent = value;
        }
      }
    }
  }

  // Load results for a specific configuration
  async function loadResultsForConfig(config) {
    // Temporarily set state to this config
    const originalState = {
      selectedBaseScenario: appState.selectedBaseScenario,
      selectedScenario: appState.selectedScenario,
      selectedAdmType: appState.selectedAdmType,
      selectedLLM: appState.selectedLLM,
      activeKDMAs: { ...appState.activeKDMAs }
    };
    
    // Set state to the config
    appState.selectedBaseScenario = config.baseScenario;
    appState.selectedScenario = config.scenario;
    appState.selectedAdmType = config.admType;
    appState.selectedLLM = config.llmBackbone;
    appState.activeKDMAs = { ...config.kdmaValues };
    
    try {
      // Load results using existing logic
      await loadResults();
    } finally {
      // Restore original state
      appState.selectedBaseScenario = originalState.selectedBaseScenario;
      appState.selectedScenario = originalState.selectedScenario;
      appState.selectedAdmType = originalState.selectedAdmType;
      appState.selectedLLM = originalState.selectedLLM;
      appState.activeKDMAs = originalState.activeKDMAs;
    }
  }

  // Update the comparison display with current + pinned runs
  function updateComparisonDisplay() {
    // Always use table mode - this is the "Always-On Comparison Mode"
    renderComparisonTable();
  }

  // Render the comparison table with current run + pinned runs
  function renderComparisonTable() {
    const container = document.getElementById('runs-container');
    if (!container) return;

    // Get current run data
    const currentRunData = getCurrentRunData();
    
    // Get all runs for comparison (current + pinned)
    const allRuns = [currentRunData, ...Array.from(appState.pinnedRuns.values())];
    
    // Extract all parameters from runs
    const parameters = extractParametersFromRuns(allRuns);
    
    // Build the table
    let tableHTML = '<div class="comparison-table-container">';
    tableHTML += '<table class="comparison-table">';
    
    // Header row
    tableHTML += '<thead><tr>';
    tableHTML += '<th class="parameter-header">Parameter</th>';
    
    // Current run header
    tableHTML += '<th class="current-run-header">';
    tableHTML += '<div class="run-header-content">';
    tableHTML += '<span class="run-title">Current Run</span>';
    tableHTML += '<span class="live-badge">Live</span>';
    tableHTML += '</div>';
    tableHTML += '</th>';
    
    // Pinned run headers
    appState.pinnedRuns.forEach((runData, runId) => {
      tableHTML += '<th class="pinned-run-header">';
      tableHTML += '<div class="run-header-content">';
      tableHTML += `<span class="run-title">${runData.displayName}</span>`;
      tableHTML += '<span class="pinned-badge">Pinned</span>';
      tableHTML += `<button class="remove-run-btn" onclick="removePinnedRun('${runId}')">×</button>`;
      tableHTML += '</div>';
      tableHTML += '</th>';
    });
    
    tableHTML += '</tr></thead>';
    
    // Body rows
    tableHTML += '<tbody>';
    
    parameters.forEach((paramInfo, paramName) => {
      tableHTML += `<tr class="parameter-row" data-category="${paramInfo.category}">`;
      tableHTML += `<td class="parameter-name">${formatParameterName(paramName)}</td>`;
      
      // Get all values for this parameter to check for differences
      const allValues = [];
      const currentValue = getParameterValue(currentRunData, paramName);
      allValues.push(currentValue);
      
      appState.pinnedRuns.forEach((runData) => {
        const pinnedValue = getParameterValue(runData, paramName);
        allValues.push(pinnedValue);
      });
      
      // Current run value (no left border needed for first column)
      tableHTML += `<td class="current-run-value">${formatValue(currentValue, paramInfo.type, paramName, 'current')}</td>`;
      
      // Pinned run values with border if different from previous column
      let previousValue = currentValue;
      appState.pinnedRuns.forEach((runData) => {
        const pinnedValue = getParameterValue(runData, paramName);
        const isDifferent = !compareValues(previousValue, pinnedValue);
        const borderStyle = isDifferent ? 'border-left: 3px solid #ffc107;' : '';
        tableHTML += `<td class="pinned-run-value" style="${borderStyle}">${formatValue(pinnedValue, paramInfo.type, paramName, runData.id)}</td>`;
        previousValue = pinnedValue;
      });
      
      tableHTML += '</tr>';
    });
    
    tableHTML += '</tbody>';
    tableHTML += '</table>';
    tableHTML += '</div>';
    
    container.innerHTML = tableHTML;
  }

  // Extract parameters from all runs to determine table structure
  function extractParametersFromRuns(runs) {
    const parameters = new Map();
    
    // Configuration parameters
    parameters.set("scenario", { type: "string", required: true, category: "Configuration" });
    parameters.set("adm_type", { type: "string", required: true, category: "Configuration" });
    parameters.set("llm_backbone", { type: "string", required: true, category: "Configuration" });
    
    // KDMA Values - single row showing all KDMA values
    parameters.set("kdma_values", { type: "kdma_values", required: false, category: "KDMA Values" });
    
    // Scenario details
    parameters.set("scenario_state", { type: "longtext", required: false, category: "Scenario Details" });
    parameters.set("available_choices", { type: "choices", required: false, category: "Choices" });
    
    // ADM Decision (using Pydantic model structure)
    parameters.set("adm_decision", { type: "text", required: false, category: "ADM Decision" });
    parameters.set("justification", { type: "longtext", required: false, category: "ADM Decision" });
    
    // Timing data
    parameters.set("probe_time", { type: "number", required: false, category: "Timing" });
    
    // Raw Data
    parameters.set("input_output_json", { type: "object", required: false, category: "Raw Data" });
    
    return parameters;
  }

  // Get current run data from the current state and loaded data
  function getCurrentRunData() {
    return {
      id: 'current',
      displayName: 'Current Run',
      scenario: appState.selectedScenario,
      baseScenario: appState.selectedBaseScenario,
      admType: appState.selectedAdmType,
      llmBackbone: appState.selectedLLM,
      kdmaValues: { ...appState.activeKDMAs },
      inputOutput: appState.currentInputOutput,
      inputOutputArray: appState.currentInputOutputArray,
      scores: appState.currentScores,
      timing: appState.currentTiming,
      experimentKey: getSelectedKey()
    };
  }

  // Extract parameter value from run data using Pydantic model structure
  function getParameterValue(run, paramName) {
    if (!run) return 'N/A';
    
    // Configuration parameters
    if (paramName === 'scenario') return run.scenario || 'N/A';
    if (paramName === 'adm_type') return run.admType || 'N/A';
    if (paramName === 'llm_backbone') return run.llmBackbone || 'N/A';
    
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
    
    // Timing data
    if (paramName === 'probe_time' && run.timing && run.scenario) {
      try {
        // Extract the scenario index from the scenario ID (e.g., "test_scenario_1-0" → 0)
        const scenarioIndex = parseInt(run.scenario.split('-').pop());
        if (scenarioIndex >= 0 && run.timing.raw_times_s && run.timing.raw_times_s[scenarioIndex] !== undefined) {
          return run.timing.raw_times_s[scenarioIndex].toFixed(2);
        }
      } catch (error) {
        console.warn('Error getting individual probe time:', error);
      }
      return 'N/A';
    }
    
    // Raw Data
    if (paramName === 'input_output_json') {
      if (run.inputOutputArray && run.scenario) {
        try {
          // Extract the scenario index from the scenario ID (e.g., "test_scenario_1-0" → 0)
          const scenarioIndex = parseInt(run.scenario.split('-').pop());
          
          if (scenarioIndex >= 0 && Array.isArray(run.inputOutputArray) && run.inputOutputArray[scenarioIndex]) {
            return run.inputOutputArray[scenarioIndex];
          }
        } catch (error) {
          console.warn('Error getting input/output JSON:', error);
        }
      }
      return 'N/A';
    }
    
    return 'N/A';
  }

  // Format values for display in table cells
  function formatValue(value, type, paramName = '', runId = '') {
    if (value === null || value === undefined || value === 'N/A') {
      return '<span class="na-value">N/A</span>';
    }
    
    switch (type) {
      case 'number':
        return typeof value === 'number' ? value.toFixed(3) : value.toString();
      
      case 'longtext':
        if (typeof value === 'string' && value.length > 400) {
          const truncated = value.substring(0, 400);
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
          value.forEach((choice, idx) => {
            choicesHtml += `<div class="choice-card">
              <div class="choice-text">${escapeHtml(choice.unstructured || choice.description || 'No description')}</div>`;
            
            // Add KDMA associations if available
            if (choice.kdma_association) {
              choicesHtml += '<div class="kdma-bars">';
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
              <span class="kdma-number">${typeof kdmaValue === 'number' ? kdmaValue.toFixed(1) : kdmaValue}</span>
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

  function formatParameterName(paramName) {
    return paramName.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
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

  function getObjectPreview(obj) {
    if (!obj || typeof obj !== 'object') return 'N/A';
    const keys = Object.keys(obj);
    if (keys.length === 0) return '{}';
    if (keys.length === 1 && typeof obj[keys[0]] !== 'object') {
      return `${keys[0]}: ${obj[keys[0]]}`;
    }
    return `{${keys.slice(0, 3).join(', ')}${keys.length > 3 ? '...' : ''}}`;
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


  // Create a pinned run element
  function createPinnedRunElement(runId, runData) {
    const wrapper = document.createElement('div');
    wrapper.className = 'run-wrapper';
    wrapper.id = `pinned-run-${runId}`;
    
    // Create header
    const header = document.createElement('div');
    header.className = 'run-content-header';
    
    const titleArea = document.createElement('div');
    titleArea.style.display = 'flex';
    titleArea.style.alignItems = 'center';
    
    const title = document.createElement('span');
    title.className = 'run-title';
    title.textContent = runData.displayName;
    
    const badge = document.createElement('span');
    badge.className = 'pinned-badge';
    badge.textContent = 'Pinned';
    badge.style.marginLeft = '8px';
    
    titleArea.appendChild(title);
    titleArea.appendChild(badge);
    
    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-run-btn';
    removeBtn.innerHTML = '×';
    removeBtn.title = 'Remove this pinned run';
    removeBtn.addEventListener('click', () => removePinnedRun(runId));
    
    header.appendChild(titleArea);
    header.appendChild(removeBtn);
    
    // Create content area
    const content = document.createElement('div');
    content.className = 'run-content';
    
    // Render the pinned run data
    renderPinnedRunData(content, runData);
    
    wrapper.appendChild(header);
    wrapper.appendChild(content);
    
    return wrapper;
  }

  // Render pinned run data using existing display logic
  function renderPinnedRunData(container, runData) {
    if (!runData.inputOutput) {
      container.innerHTML = '<p>No data available for this pinned run.</p>';
      return;
    }
    
    // Reuse the existing formatting logic from loadResultsInternal
    const inputOutputItem = runData.inputOutput;
    const scoreItem = runData.scores;
    
    // Format results using the same logic as the current run
    const formatResults = () => {
      let html = '';
      
      if (inputOutputItem && inputOutputItem.input) {
        const input = inputOutputItem.input;
        
        // Simple scenario header
        html += `<h3>${runData.scenario}</h3>`;
        
        // Scenario description
        if (input.state) {
          html += `<p style="margin-bottom: 20px; font-size: 16px; line-height: 1.6;">${input.state}</p>`;
        }
        
        // Simplified choices with horizontal layout
        if (input.choices && Array.isArray(input.choices)) {
          html += '<h4>Choices</h4>';
          html += '<div style="display: flex; flex-wrap: wrap; gap: 15px; margin-bottom: 20px;">';
          input.choices.forEach((choice, idx) => {
            html += `<div style="flex: 1; min-width: 200px; padding: 12px; background-color: #f8f9fa; border-radius: 6px;">`;
            html += `<div style="font-weight: 500; margin-bottom: 8px;">${choice.unstructured || choice.description || 'No description'}</div>`;
            
            // Short KDMA bars
            if (choice.kdma_association) {
              Object.entries(choice.kdma_association).forEach(([kdma, value]) => {
                const percentage = Math.round(value * 100);
                const color = value >= 0.7 ? '#28a745' : value >= 0.4 ? '#ffc107' : '#dc3545';
                
                html += '<div style="display: flex; align-items: center; gap: 8px; margin: 3px 0;">';
                html += `<span style="min-width: 60px; font-size: 0.9em; color: #666;">${kdma}</span>`;
                html += `<div style="width: 60px; height: 4px; background-color: #e9ecef; border-radius: 2px;">`;
                html += `<div style="width: ${percentage}%; height: 100%; background-color: ${color}; border-radius: 2px;"></div>`;
                html += '</div>';
                html += `<span style="font-size: 0.85em; color: ${color}; font-weight: 500;">${value}</span>`;
                html += '</div>';
              });
            }
            html += '</div>';
          });
          html += '</div>';
        }
      }
      
      // Simplified ADM Decision
      if (inputOutputItem && inputOutputItem.output) {
        const output = inputOutputItem.output;
        
        html += '<h4>ADM Decision</h4>';
        
        // Show the action text
        if (output.action && output.action.unstructured) {
          html += `<p style="font-weight: 600; color: #2e7d32; margin-bottom: 10px;">${output.action.unstructured}</p>`;
        } else if (output.action && output.action.action_id) {
          html += `<p style="font-weight: 600; color: #2e7d32; margin-bottom: 10px;">${output.action.action_id}</p>`;
        }
        
        // Show the justification
        if (output.action && output.action.justification) {
          html += `<p style="line-height: 1.6; color: #555;"><strong>Justification:</strong> ${output.action.justification}</p>`;
        } else if (output.justification) {
          html += `<p style="line-height: 1.6; color: #555;"><strong>Justification:</strong> ${output.justification}</p>`;
        }
      } else {
        html += '<h4>ADM Decision</h4>';
        html += '<p style="color: #666;">No decision data available</p>';
      }
      
      return html;
    };
    
    container.innerHTML = formatResults();
    
    // Add scores section if available
    if (scoreItem) {
      const scoresDiv = document.createElement('div');
      scoresDiv.style.marginTop = '20px';
      scoresDiv.style.paddingTop = '15px';
      scoresDiv.style.borderTop = '1px solid #e9ecef';
      
      let scoresHtml = '<h4>Results Summary</h4>';
      if (scoreItem.score !== undefined) {
        scoresHtml += `<div style="margin: 8px 0;"><strong>Score:</strong> ${scoreItem.score.toFixed(3)}</div>`;
      }
      
      if (runData.timing && runData.timing.avg_time_s !== undefined) {
        scoresHtml += `<div style="margin: 8px 0;"><strong>Average Decision Time:</strong> ${runData.timing.avg_time_s.toFixed(4)}s</div>`;
      }
      
      scoresDiv.innerHTML = scoresHtml;
      container.appendChild(scoresDiv);
    }
  }

  // Remove a pinned run
  function removePinnedRun(runId) {
    appState.pinnedRuns.delete(runId);
    
    // Clean up expansion states for this run
    cleanupRunStates(runId);
    
    updatePinnedCount();
    updateComparisonDisplay();
  }
  
  // Clean up expansion states when a run is removed
  function cleanupRunStates(runId) {
    // Remove text expansion states for this run
    for (const [key, value] of expandableStates.text.entries()) {
      if (key.includes(`_${runId}_`)) {
        expandableStates.text.delete(key);
      }
    }
    
    // Remove object expansion states for this run
    for (const [key, value] of expandableStates.objects.entries()) {
      if (key.includes(`_${runId}_`)) {
        expandableStates.objects.delete(key);
      }
    }
  }

  // Make removePinnedRun globally accessible for onclick handlers
  window.removePinnedRun = removePinnedRun;

  function generateRunId() {
    const timestamp = new Date().getTime();
    const random = Math.random().toString(36).substr(2, 9);
    return `run_${timestamp}_${random}`;
  }

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

  function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    notification.style.cssText = `
      position: fixed; top: 20px; right: 20px; padding: 10px 20px;
      background: ${type === 'error' ? '#f44336' : type === 'success' ? '#4caf50' : '#2196F3'};
      color: white; border-radius: 4px; z-index: 1000;
    `;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
  }

  function initializeComparisonFeatures() {
    const pinButton = document.getElementById("pin-current-run");
    const clearButton = document.getElementById("clear-all-pins");
    
    if (pinButton) {
      pinButton.addEventListener("click", pinCurrentRun);
    }
    
    if (clearButton) {
      clearButton.addEventListener("click", clearAllPins);
    }
    
    updatePinnedCount(); // Initial state
  }

  // Initial manifest fetch on page load
  fetchManifest();
  
  // Initialize comparison features after DOM is loaded
  initializeComparisonFeatures();
});
