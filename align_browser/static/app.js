// Client-side application logic for ADM Results
import {
  createInitialState,
  updateUserSelections,
  updateCurrentData,
  getSelectedKey,
  createRunConfig,
  createParameterStructure,
  encodeStateToURL,
  decodeStateFromURL
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
    ...createInitialState(),
    // Convert arrays to Sets to maintain existing behavior
    availableScenarios: new Set(),
    availableBaseScenarios: new Set(),
    availableAdmTypes: new Set(),
    availableKDMAs: new Set(),
    availableLLMs: new Set(),
    
    // Run configuration factory
    createRunConfig: function() {
      return createRunConfig(appState);
    }
  };

  // Constants for run identification
  const CURRENT_RUN_ID = 'current';
  
  // Parameter storage by run ID - enables multi-run parameter management
  const columnParameters = new Map();
  
  // Use imported parameter structure factory
  
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
        // For pinned runs, initialize with the run's actual parameters
        const run = appState.pinnedRuns.get(runId);
        if (run) {
          defaultParams = createParameterStructure({
            scenario: run.scenario,
            baseScenario: run.baseScenario,
            admType: run.admType,
            llmBackbone: run.llmBackbone,
            kdmas: run.kdmaValues
          });
        } else {
          // For truly new runs, start with auto-corrected valid combination
          defaultParams = correctParametersToValid({});
        }
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
  
  // Sync appState FROM current run parameters
  function syncAppStateFromRun(runId = CURRENT_RUN_ID) {
    if (runId === CURRENT_RUN_ID) {
      const params = getParametersForRun(CURRENT_RUN_ID);
      appState = updateUserSelections(appState, {
        scenario: params.scenario,
        baseScenario: params.baseScenario,
        admType: params.admType,
        llm: params.llmBackbone,
        kdmas: { ...params.kdmas }
      });
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
      'kdmas': 'kdmas',
      'runVariant': 'runVariant'
    };
    
    const paramField = paramMap[paramType] || paramType;
    params[paramField] = newValue;
    
    // Apply auto-correction
    const correctedParams = setParametersForRun(runId, params);
    
    // Update UI if it's the current run
    if (runId === CURRENT_RUN_ID && updateUI) {
      syncAppStateFromRun(CURRENT_RUN_ID);
    }
    
    return correctedParams;
  }
  
  // Initialize the run context system after manifest is loaded
  function initializeRunContextSystem() {
    // Initialize current run parameters from appState
    // This establishes the baseline for the current run state
    syncRunFromAppState();
    
    console.log('Run context system initialized with current run:', getParametersForRun(CURRENT_RUN_ID));
  }

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
        // Restore selections
        appState = updateUserSelections(appState, {
          baseScenario: state.baseScenario || appState.selectedBaseScenario,
          scenario: state.scenario || appState.selectedScenario,
          admType: state.admType || appState.selectedAdmType,
          llm: state.llm || appState.selectedLLM,
          kdmas: state.kdmas || appState.activeKDMAs
        });
        
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
      }
      return false; // No state to restore
    }
  };

  // Function to fetch and parse manifest.json
  async function fetchManifest() {
    try {
      const response = await fetch("./data/manifest.json");
      manifest = await response.json();
      console.log("Manifest loaded:", manifest);
      extractParametersFromManifest();
      populateUIControls();
      
      // Initialize run context system
      initializeRunContextSystem();
      
      // Try to restore state from URL, otherwise load results normally
      const restoredFromURL = await urlState.restoreFromURL();
      if (!restoredFromURL) {
        await loadResults(); // Load results initially only if not restored from URL
        // Auto-pin the initial configuration if no pinned runs exist
        if (appState.pinnedRuns.size === 0 && appState.currentInputOutput) {
          // Ensure we have a valid display name before pinning
          setTimeout(() => {
            pinCurrentRun();
          }, 100); // Small delay to ensure appState is fully updated
        }
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

    // Convert Sets to Arrays for easier use in UI
    appState.availableScenarios = Array.from(appState.availableScenarios);
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

    console.log("Valid Combinations (structured):", appState.validCombinations);
  }
  
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
  function isValidParameterCombination(scenario, admType, llmBackbone, kdmas, baseScenario = null, runVariant = null) {
    // Check baseScenario/scenario consistency if both are provided
    if (baseScenario && scenario) {
      const scenarioBase = scenario.replace(/-\d+$/, "");
      if (scenarioBase !== baseScenario) {
        return false;
      }
    }
    
    const constraints = { scenario, admType, llmBackbone, kdmas };
    const validOptions = getValidOptionsForConstraints(constraints);
    
    // Check if the basic combination is valid
    if (!validOptions.scenarios.has(scenario)) {
      return false;
    }
    
    // If no run variant specified, combination is valid
    if (!runVariant) {
      return true;
    }
    
    // Check if run variant exists for this ADM+LLM+KDMA combination
    const baseKey = buildExperimentKey(admType, llmBackbone, kdmas);
    const runVariantKey = `${baseKey}_${runVariant}`;
    
    return Object.keys(manifest.experiment_keys || {}).includes(runVariantKey);
  }
  
  // Find a valid parameter combination given partial constraints and preferences
  // Priority order: 1) Scenario (highest), 2) No KDMAs when user wants none, 3) KDMA values, 4) ADM type, 5) LLM backbone (lowest)
  function findValidParameterCombination(constraints = {}, preferences = {}, depth = 0) {
    // Prevent infinite recursion
    if (depth > 2) {
      console.warn('Auto-correction recursion limit reached, using fallback');
      const allValidOptions = getValidOptionsForConstraints({});
      if (allValidOptions.scenarios.size > 0) {
        const firstScenario = Array.from(allValidOptions.scenarios)[0];
        return {
          scenario: firstScenario,
          baseScenario: firstScenario.replace(/-\d+$/, ""),
          admType: Array.from(allValidOptions.admTypes)[0],
          llmBackbone: Array.from(allValidOptions.llmBackbones)[0],
          kdmas: {},
          runVariant: constraints.runVariant || null
        };
      }
    }
    // Start with current selections as baseline
    const currentParams = {
      scenario: constraints.scenario || appState.selectedScenario,
      baseScenario: constraints.baseScenario || appState.selectedBaseScenario,
      admType: constraints.admType || appState.selectedAdmType,
      llmBackbone: constraints.llmBackbone || appState.selectedLLM,
      kdmas: constraints.kdmas || { ...appState.activeKDMAs },
      runVariant: constraints.runVariant || appState.selectedRunVariant || null
    };
    
    // If current combination is already valid, return it
    // Special check: if KDMAs are empty, ensure the ADM+LLM actually supports no KDMAs
    if (Object.keys(currentParams.kdmas).length === 0) {
      const noVariantKey = `${currentParams.admType}_${currentParams.llmBackbone}_`;
      if (manifest.experiment_keys[noVariantKey] && 
          manifest.experiment_keys[noVariantKey].scenarios[currentParams.scenario]) {
        return currentParams;
      }
      // Fall through to Priority 2 logic if this ADM doesn't support empty KDMAs
    } else if (isValidParameterCombination(currentParams.scenario, currentParams.admType, currentParams.llmBackbone, currentParams.kdmas, currentParams.baseScenario, currentParams.runVariant)) {
      return currentParams;
    }
    
    // Check if just the run variant is invalid while base parameters are valid
    if (currentParams.runVariant && isValidParameterCombination(currentParams.scenario, currentParams.admType, currentParams.llmBackbone, currentParams.kdmas, currentParams.baseScenario, null)) {
      // Base parameters are valid, but run variant is not - reset run variant to null
      return {
        ...currentParams,
        runVariant: null
      };
    }
    
    // Priority 1: Preserve scenario, adjust other parameters to make it work
    // But only if scenario matches baseScenario (if baseScenario is specified)
    const scenarioMatchesBase = !currentParams.baseScenario || 
                               currentParams.scenario.replace(/-\d+$/, "") === currentParams.baseScenario;
    
    if (currentParams.scenario && scenarioMatchesBase) {
      const validOptions = getValidOptionsForConstraints({ scenario: currentParams.scenario });
      
      if (validOptions.admTypes.size > 0) {
        // Try to preserve current ADM type if valid for this scenario
        let selectedADM = currentParams.admType;
        if (!validOptions.admTypes.has(selectedADM)) {
          selectedADM = Array.from(validOptions.admTypes)[0];
        }
        
        const admOptions = getValidOptionsForConstraints({ 
          scenario: currentParams.scenario, 
          admType: selectedADM 
        });
        
        if (admOptions.llmBackbones.size > 0) {
          // Try to preserve LLM preference for this ADM, or current LLM
          let selectedLLM = currentParams.llmBackbone;
          const preferredLLM = preferences.llmPreferences && preferences.llmPreferences[selectedADM];
          
          if (preferredLLM && admOptions.llmBackbones.has(preferredLLM)) {
            selectedLLM = preferredLLM;
          } else if (!admOptions.llmBackbones.has(selectedLLM)) {
            selectedLLM = Array.from(admOptions.llmBackbones)[0];
          }
          
          const kdmaOptions = getValidOptionsForConstraints({
            scenario: currentParams.scenario,
            admType: selectedADM,
            llmBackbone: selectedLLM
          });
          
          // Check if current ADM+LLM supports no KDMAs when user wants no KDMAs
          const userWantsNoKDMAs = Object.keys(currentParams.kdmas).length === 0;
          const admSupportsNoKDMAs = isValidParameterCombination(
            currentParams.scenario, 
            selectedADM, 
            selectedLLM, 
            {}, 
            currentParams.baseScenario, 
            currentParams.runVariant
          );
          
          if (userWantsNoKDMAs && admSupportsNoKDMAs) {
            // User wants no KDMAs and current ADM supports it - keep no KDMAs
            return {
              scenario: currentParams.scenario,
              baseScenario: currentParams.scenario.replace(/-\d+$/, ""),
              admType: selectedADM,
              llmBackbone: selectedLLM,
              kdmas: {},
              runVariant: currentParams.runVariant
            };
          } else if (Object.keys(kdmaOptions.kdmas).length > 0) {
            // Try to preserve current KDMA values, adjust if needed
            const correctedKDMAs = {};
            
            // For each current KDMA, check if it's still valid
            for (const [kdma, value] of Object.entries(currentParams.kdmas)) {
              if (kdmaOptions.kdmas[kdma] && kdmaOptions.kdmas[kdma].has(value)) {
                correctedKDMAs[kdma] = value; // Keep current value
              } else if (kdmaOptions.kdmas[kdma] && kdmaOptions.kdmas[kdma].size > 0) {
                const newValue = Array.from(kdmaOptions.kdmas[kdma])[0];
                correctedKDMAs[kdma] = newValue; // Use first valid value
              }
            }
            
            // If no KDMAs preserved and user didn't explicitly want no KDMAs, use first available
            if (Object.keys(correctedKDMAs).length === 0 && !userWantsNoKDMAs) {
              const firstKDMA = Object.keys(kdmaOptions.kdmas)[0];
              const firstValue = Array.from(kdmaOptions.kdmas[firstKDMA])[0];
              correctedKDMAs[firstKDMA] = firstValue;
            }
            
            return {
              scenario: currentParams.scenario,
              baseScenario: currentParams.scenario.replace(/-\d+$/, ""),
              admType: selectedADM,
              llmBackbone: selectedLLM,
              kdmas: correctedKDMAs,
              runVariant: currentParams.runVariant
            };
          }
        }
      }
    }
    
    // Priority 0: Fix baseScenario/scenario inconsistency first, then restart auto-correction
    if (currentParams.baseScenario && !scenarioMatchesBase) {
      const matchingScenarios = Array.from(appState.availableScenarios).filter((scenarioId) => {
        const extractedBase = scenarioId.replace(/-\d+$/, "");
        return extractedBase === currentParams.baseScenario;
      });
      
      if (matchingScenarios.length > 0) {
        // Recursively call with corrected scenario - this reuses all existing logic
        return findValidParameterCombination({
          ...constraints,
          scenario: matchingScenarios[0]
        }, preferences, depth + 1);
      }
    }
    
    // Priority 2: Handle case where user wants no KDMAs but current ADM doesn't support it
    if (Object.keys(currentParams.kdmas).length === 0) {
      // User wants no KDMAs - find ADM+LLM that supports this for current scenario
      const scenarioOptions = getValidOptionsForConstraints({ scenario: currentParams.scenario });
      
      for (const admType of scenarioOptions.admTypes) {
        const admOptions = getValidOptionsForConstraints({ 
          scenario: currentParams.scenario, 
          admType 
        });
        
        for (const llmBackbone of admOptions.llmBackbones) {
          // Check if this ADM+LLM combination has an experiment with no run variant (ends with underscore)
          const noVariantKey = `${admType}_${llmBackbone}_`;
          if (manifest.experiment_keys[noVariantKey] && 
              manifest.experiment_keys[noVariantKey].scenarios[currentParams.scenario]) {
            return {
              scenario: currentParams.scenario,
              baseScenario: currentParams.scenario.replace(/-\d+$/, ""),
              admType: admType,
              llmBackbone: llmBackbone,
              kdmas: {},
              runVariant: null
            };
          }
        }
      }
    }
    
    // Priority 3: Preserve KDMA values, find scenario+ADM+LLM that supports them
    if (Object.keys(currentParams.kdmas).length > 0) {
      const allValidOptions = getValidOptionsForConstraints({});
      
      // Try scenarios that match the current base scenario first
      let scenariosToTry = Array.from(allValidOptions.scenarios);
      if (currentParams.scenario) {
        const currentBaseScenario = currentParams.scenario.replace(/-\d+$/, "");
        scenariosToTry.sort((a, b) => {
          const aBase = a.replace(/-\d+$/, "");
          const bBase = b.replace(/-\d+$/, "");
          if (aBase === currentBaseScenario && bBase !== currentBaseScenario) return -1;
          if (bBase === currentBaseScenario && aBase !== currentBaseScenario) return 1;
          return 0;
        });
      }
      
      for (const scenario of scenariosToTry) {
        const scenarioOptions = getValidOptionsForConstraints({ scenario });
        
        for (const admType of scenarioOptions.admTypes) {
          const admOptions = getValidOptionsForConstraints({ scenario, admType });
          
          for (const llmBackbone of admOptions.llmBackbones) {
            const kdmaOptions = getValidOptionsForConstraints({ scenario, admType, llmBackbone });
            
            // Check if all current KDMAs are valid for this combination
            let allKDMAsValid = true;
            for (const [kdma, value] of Object.entries(currentParams.kdmas)) {
              if (!kdmaOptions.kdmas[kdma] || !kdmaOptions.kdmas[kdma].has(value)) {
                allKDMAsValid = false;
                break;
              }
            }
            
            if (allKDMAsValid) {
              return {
                scenario,
                baseScenario: scenario.replace(/-\d+$/, ""),
                admType,
                llmBackbone,
                kdmas: currentParams.kdmas,
                runVariant: currentParams.runVariant
              };
            }
          }
        }
      }
    }
    
    // Priority 4: Preserve ADM type, adjust LLM and scenario
    if (currentParams.admType) {
      const validOptions = getValidOptionsForConstraints({ admType: currentParams.admType });
      
      if (validOptions.llmBackbones.size > 0 && validOptions.scenarios.size > 0) {
        // Try to preserve LLM preference
        const preferredLLM = preferences.llmPreferences && preferences.llmPreferences[currentParams.admType];
        let selectedLLM = currentParams.llmBackbone;
        
        if (preferredLLM && validOptions.llmBackbones.has(preferredLLM)) {
          selectedLLM = preferredLLM;
        } else if (!validOptions.llmBackbones.has(selectedLLM)) {
          selectedLLM = Array.from(validOptions.llmBackbones)[0];
        }
        
        // Find scenario that works with this ADM+LLM
        const scenarioOptions = getValidOptionsForConstraints({ 
          admType: currentParams.admType, 
          llmBackbone: selectedLLM 
        });
        
        let selectedScenario;
        // Try to preserve base scenario
        if (currentParams.scenario) {
          const currentBaseScenario = currentParams.scenario.replace(/-\d+$/, "");
          const matchingScenarios = Array.from(scenarioOptions.scenarios).filter(s => 
            s.replace(/-\d+$/, "") === currentBaseScenario
          );
          
          if (matchingScenarios.length > 0) {
            selectedScenario = matchingScenarios[0];
          }
        }
        
        if (!selectedScenario) {
          selectedScenario = Array.from(scenarioOptions.scenarios)[0];
        }
        
        const kdmaOptions = getValidOptionsForConstraints({
          scenario: selectedScenario,
          admType: currentParams.admType,
          llmBackbone: selectedLLM
        });
        
        if (Object.keys(kdmaOptions.kdmas).length > 0) {
          const firstKDMA = Object.keys(kdmaOptions.kdmas)[0];
          const firstValue = Array.from(kdmaOptions.kdmas[firstKDMA])[0];
          
          return {
            scenario: selectedScenario,
            baseScenario: selectedScenario.replace(/-\d+$/, ""),
            admType: currentParams.admType,
            llmBackbone: selectedLLM,
            kdmas: { [firstKDMA]: firstValue },
            runVariant: currentParams.runVariant
          };
        }
      }
    }
    
    // Priority 5 (Fallback): Find any valid combination
    const allValidOptions = getValidOptionsForConstraints({});
    
    if (allValidOptions.admTypes.size > 0) {
      const firstValidADM = Array.from(allValidOptions.admTypes)[0];
      const admOptions = getValidOptionsForConstraints({ admType: firstValidADM });
      
      if (admOptions.llmBackbones.size > 0 && admOptions.scenarios.size > 0) {
        const firstValidLLM = Array.from(admOptions.llmBackbones)[0];
        const firstValidScenario = Array.from(admOptions.scenarios)[0];
        
        const kdmaOptions = getValidOptionsForConstraints({
          scenario: firstValidScenario,
          admType: firstValidADM,
          llmBackbone: firstValidLLM
        });
        
        const correctedParams = {
          scenario: firstValidScenario,
          baseScenario: firstValidScenario.replace(/-\d+$/, ""),
          admType: firstValidADM,
          llmBackbone: firstValidLLM,
          kdmas: {},
          runVariant: currentParams.runVariant
        };
        
        if (Object.keys(kdmaOptions.kdmas).length > 0) {
          const firstKDMA = Object.keys(kdmaOptions.kdmas)[0];
          const firstValue = Array.from(kdmaOptions.kdmas[firstKDMA])[0];
          correctedParams.kdmas = { [firstKDMA]: firstValue };
        }
        
        return correctedParams;
      }
    }
    
    // Fallback: return original parameters (should not happen with valid manifest)
    console.warn('No valid parameter combination found, returning original parameters');
    return currentParams;
  }
  
  // Correct parameters to be valid while preserving user preferences
  function correctParametersToValid(currentParams, preservePreferences = true) {
    const preferences = preservePreferences ? {
      llmPreferences: appState.llmPreferences
    } : {};
    
    return findValidParameterCombination(currentParams, preferences);
  }

  function populateUIControls() {
    // Initialize current run parameters with initial state
    syncRunFromAppState();
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
    console.log(`Changing ADM type for run ${runId} to ${newADM}`);
    
    const run = appState.pinnedRuns.get(runId);
    if (!run) {
      console.warn(`Run ${runId} not found`);
      return;
    }
    
    // Initialize LLM preferences for this run if not present
    if (!run.llmPreferences) {
      run.llmPreferences = {};
    }
    
    // Store current LLM preference for the old ADM type
    if (run.admType && run.llmBackbone) {
      run.llmPreferences[run.admType] = run.llmBackbone;
    }
    
    // Update ADM type with validation
    const updatedParams = updateParameterForRun(runId, 'admType', newADM);
    
    // Try to restore LLM preference for the new ADM type
    if (run.llmPreferences[newADM]) {
      // Check if preferred LLM is valid for new ADM
      const validOptions = getValidOptionsForConstraints({
        scenario: updatedParams.scenario,
        admType: newADM
      });
      
      if (validOptions.llmBackbones.has(run.llmPreferences[newADM])) {
        console.log(`Restoring LLM preference for ADM ${newADM}: ${run.llmPreferences[newADM]}`);
        updateParameterForRun(runId, 'llmBackbone', run.llmPreferences[newADM]);
      }
    }
    
    // Reload data for this specific run
    await reloadPinnedRun(runId);
    
    // Update URL state
    urlState.updateURL();
  };

  // Handle run variant change for pinned runs - global for onclick access
  window.handleRunVariantChange = async function(runId, newVariant) {
    console.log(`Changing run variant for run ${runId} to ${newVariant}`);
    
    const run = appState.pinnedRuns.get(runId);
    if (!run) {
      console.warn(`Run ${runId} not found`);
      return;
    }
    
    // Update run variant with validation
    updateParameterForRun(runId, 'runVariant', newVariant === 'default' ? null : newVariant);
    
    // Reload data for this specific run
    await reloadPinnedRun(runId);
    
    // Update URL state
    urlState.updateURL();
  };

  // Handle base scenario change for pinned runs - global for onclick access
  window.handleRunBaseScenarioChange = async function(runId, newBaseScenario) {
    console.log(`Changing base scenario for run ${runId} to ${newBaseScenario}`);
    
    const run = appState.pinnedRuns.get(runId);
    if (!run) {
      console.warn(`Run ${runId} not found`);
      return;
    }
    
    // Update base scenario with validation through central system
    updateParameterForRun(runId, 'baseScenario', newBaseScenario);
    
    // After scenario change, validate and potentially reset KDMAs
    await validateKDMAsForScenarioChange(runId);
    
    // Reload data for this specific run
    await reloadPinnedRun(runId);
    
    // Update URL state
    urlState.updateURL();
  };

  // Handle specific scenario change for pinned runs - global for onclick access
  window.handleRunSpecificScenarioChange = async function(runId, newScenario) {
    console.log(`Changing specific scenario for run ${runId} to ${newScenario}`);
    
    // Update scenario with validation through central system
    updateParameterForRun(runId, 'scenario', newScenario);
    
    // After scenario change, validate and potentially reset KDMAs
    await validateKDMAsForScenarioChange(runId);
    
    // Reload data for this specific run
    await reloadPinnedRun(runId);
    
    // Update URL state
    urlState.updateURL();
  };

  // Validate KDMAs after scenario change and reset if necessary
  async function validateKDMAsForScenarioChange(runId) {
    const run = appState.pinnedRuns.get(runId);
    if (!run) return;

    // Check if current KDMA configuration is valid for the new scenario
    const currentParams = getParametersForRun(runId);
    const baseKey = buildExperimentKey(currentParams.admType, currentParams.llmBackbone, currentParams.kdmas);
    
    // Check if this combination exists for the current scenario
    const experimentExists = Object.keys(manifest.experiment_keys || {}).some(key => {
      if (key === baseKey || key.startsWith(baseKey + '_')) {
        const experiment = manifest.experiment_keys[key];
        return experiment && experiment.scenarios && experiment.scenarios[currentParams.scenario];
      }
      return false;
    });

    if (!experimentExists) {
      console.log(`Current KDMA configuration not valid for scenario ${currentParams.scenario}, resetting KDMAs`);
      
      // Get first valid KDMA combination for this scenario+ADM+LLM
      const constraints = {
        scenario: currentParams.scenario,
        admType: currentParams.admType,
        llmBackbone: currentParams.llmBackbone
      };
      
      const validOptions = getValidOptionsForConstraints(constraints);
      
      if (Object.keys(validOptions.kdmas).length > 0) {
        // Build first valid KDMA combination
        const newKDMAs = {};
        for (const [kdmaName, kdmaValues] of Object.entries(validOptions.kdmas)) {
          if (kdmaValues.size > 0) {
            newKDMAs[kdmaName] = Array.from(kdmaValues)[0];
          }
        }
        
        console.log(`Resetting to valid KDMA configuration:`, newKDMAs);
        
        // Update both run state and column parameters
        run.kdmaValues = newKDMAs;
        currentParams.kdmas = newKDMAs;
        columnParameters.set(runId, createParameterStructure(currentParams));
        
        // Update comparison display to show new KDMA controls
        updateComparisonDisplay();
      }
    }
  }

  // Handle adding KDMA to pinned run - global for onclick access
  window.addKDMAToRun = function(runId) {
    const run = appState.pinnedRuns.get(runId);
    if (!run) return;
    
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
    
    // Use the parameter update system to ensure validation
    updateParameterForRun(runId, 'kdmas', newKDMAs);
    
    // Refresh the comparison display to show new KDMA control
    updateComparisonDisplay();
    
    // Reload experiment data for the new KDMA combination
    reloadPinnedRun(runId);
    
    // Update URL state
    urlState.updateURL();
  };

  // Handle removing KDMA from pinned run - global for onclick access
  window.removeKDMAFromRun = function(runId, kdmaType) {
    const run = appState.pinnedRuns.get(runId);
    if (!run) return;
    
    const currentKDMAs = { ...(run.kdmaValues || {}) };
    delete currentKDMAs[kdmaType];
    
    // Use the parameter update system to ensure validation
    updateParameterForRun(runId, 'kdmas', currentKDMAs);
    
    // Refresh the comparison display
    updateComparisonDisplay();
    
    // Reload experiment data for the new KDMA combination
    reloadPinnedRun(runId);
    
    // Update URL state
    urlState.updateURL();
  };

  // Handle KDMA type change for pinned run - global for onclick access
  window.handleRunKDMATypeChange = function(runId, oldKdmaType, newKdmaType) {
    const run = appState.pinnedRuns.get(runId);
    if (!run) return;
    
    const currentKDMAs = { ...(run.kdmaValues || {}) };
    const currentValue = currentKDMAs[oldKdmaType];
    
    // Remove old type and add new type
    delete currentKDMAs[oldKdmaType];
    
    // Get valid values for new type and adjust value if needed
    const availableKDMAs = getValidKDMAsForRun(runId);
    const validValues = availableKDMAs[newKdmaType] || [];
    let newValue = currentValue;
    
    if (validValues.length > 0 && !validValues.includes(currentValue)) {
      newValue = validValues[0]; // Use first valid value
    }
    
    currentKDMAs[newKdmaType] = newValue;
    
    // Use the parameter update system to ensure validation
    updateParameterForRun(runId, 'kdmas', currentKDMAs);
    
    // Refresh the comparison display
    updateComparisonDisplay();
    
    // Reload experiment data for the new KDMA combination
    reloadPinnedRun(runId);
    
    // Update URL state
    urlState.updateURL();
  };

  // Handle KDMA slider input for pinned run - global for onclick access
  window.handleRunKDMASliderInput = function(runId, kdmaType, sliderElement) {
    const run = appState.pinnedRuns.get(runId);
    if (!run) return;
    
    const rawValue = parseFloat(sliderElement.value);
    
    // Get valid values considering current KDMA constraints
    const currentKDMAs = { ...(run.kdmaValues || {}) };
    
    // Create a constraint that includes other KDMAs but NOT the one being changed
    const constraintKDMAs = { ...currentKDMAs };
    delete constraintKDMAs[kdmaType]; // Remove the one we're changing
    
    const constraints = {
      scenario: run.scenario,
      admType: run.admType,  
      llmBackbone: run.llmBackbone
    };
    
    // Add other KDMAs as constraints if any exist
    if (Object.keys(constraintKDMAs).length > 0) {
      constraints.kdmas = constraintKDMAs;
    }
    
    const validOptions = getValidOptionsForConstraints(constraints);
    const validValues = Array.from(validOptions.kdmas[kdmaType] || []);
    
    // Snap to nearest valid value if we have valid values
    let newValue = rawValue;
    if (validValues.length > 0) {
      newValue = validValues.reduce((closest, validValue) => 
        Math.abs(validValue - rawValue) < Math.abs(closest - rawValue) ? validValue : closest
      );
      
      // Update slider to show snapped value
      if (newValue !== rawValue) {
        sliderElement.value = newValue;
      }
    }
    
    // Update the display value immediately
    const valueDisplay = document.getElementById(`kdma-value-${runId}-${kdmaType}`);
    if (valueDisplay) {
      valueDisplay.textContent = formatKDMAValue(newValue);
    }
    
    currentKDMAs[kdmaType] = newValue;
    
    // Update the run state immediately to prevent bouncing
    run.kdmaValues = currentKDMAs;
    
    // Update column parameters directly without validation
    // since slider values are already validated
    const params = getParametersForRun(runId);
    params.kdmas = currentKDMAs;
    columnParameters.set(runId, createParameterStructure(params));
    
    // Debounce the reload to avoid too many requests while sliding
    if (window.kdmaReloadTimeout) {
      clearTimeout(window.kdmaReloadTimeout);
    }
    window.kdmaReloadTimeout = setTimeout(async () => {
      await reloadPinnedRun(runId);
      urlState.updateURL();
    }, 500);
  };

  // Internal function to load results without loading guard
  async function loadResultsInternal() {
    if (!appState.selectedScenario) {
      // Message will be displayed in the table
      
      // Clear current data when no scenario
      appState = updateCurrentData(appState, {
        inputOutput: null,
        inputOutputArray: null,
        timing: null
      });
      updateComparisonDisplay(); // Update table with no scenario state
      return;
    }

    const selectedKey = getSelectedKey(appState);
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
        const timingData = await (await fetch(dataPaths.timing)).json();

        // Extract the index from the scenario ID (e.g., "test_scenario_1-0" → 0)
        const scenarioIndex = parseInt(appState.selectedScenario.split('-').pop());
        
        // Get the specific element from each array using the index
        const inputOutputItem = inputOutputArray[scenarioIndex];

        // Helper function to format complex data structures cleanly
        const formatValue = (value, depth = 0) => {
          
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

        // Content will be displayed via the comparison table
        
        // Store current data for pinning
        appState = updateCurrentData(appState, {
          inputOutput: inputOutputItem,
          inputOutputArray: inputOutputArray,
          timing: timingData
        });
          
        
        // Update comparison display (always-on table mode)
        updateComparisonDisplay();
      } catch (error) {
        console.error("Error fetching experiment data:", error);
        // Error will be displayed in the table
        
        // Clear current data on error
        appState = updateCurrentData(appState, {
          inputOutput: null,
          inputOutputArray: null,
            timing: null
        });
          updateComparisonDisplay(); // Update table with error state
      }
    } else {
      // Try to find a fallback experiment key with run variant
      let fallbackKey = null;
      
      // Look for keys that start with the base pattern
      const availableKeys = Object.keys(experiments);
      const basePattern = selectedKey;
      
      // First, try to find exact match with available variants
      for (const key of availableKeys) {
        if (key.startsWith(basePattern + '_') && experiments[key].scenarios[appState.selectedScenario]) {
          fallbackKey = key;
          break;
        }
      }
      
      if (fallbackKey) {
        console.log(`Using fallback key: ${fallbackKey} for requested key: ${selectedKey}`);
        
        // Auto-update the app state to use the run variant found
        const variantSuffix = fallbackKey.substring(basePattern.length + 1);
        if (variantSuffix) {
          appState.selectedRunVariant = variantSuffix;
          console.log(`Auto-selected run variant: ${variantSuffix}`);
        }
        
        const dataPaths = experiments[fallbackKey].scenarios[appState.selectedScenario];
        try {
          const inputOutputArray = await (await fetch(dataPaths.input_output)).json();
          const timingData = await (await fetch(dataPaths.timing)).json();

          const scenarioIndex = parseInt(appState.selectedScenario.split('-').pop());
          const inputOutputItem = inputOutputArray[scenarioIndex];

          appState = updateCurrentData(appState, {
            inputOutput: inputOutputItem,
            inputOutputArray: inputOutputArray,
              timing: timingData
          });

          updateComparisonDisplay();
          return;
        } catch (error) {
          console.error("Error fetching fallback experiment data:", error);
        }
      }
      
      // No data message will be displayed in the table
      console.warn(`No data found for key: ${selectedKey}, scenario: ${appState.selectedScenario}`);
      
      // Clear current data when no data found
      appState.currentInputOutput = null;
      appState.currentTiming = null;
      updateComparisonDisplay(); // Update table with no data state
    }
  }


  // Pure function to load experiment data for any parameter combination
  async function loadExperimentData(scenario, admType, llmBackbone, kdmas, runVariant = null) {
    if (!scenario) {
      return {
        inputOutput: null,
        inputOutputArray: null,
        timing: null,
        error: 'No scenario provided'
      };
    }

    // Generate experiment key from parameters using shared utility
    let experimentKey = buildExperimentKey(admType, llmBackbone, kdmas);
    
    // Add run variant if provided
    if (runVariant) {
      experimentKey += `_${runVariant}`;
    }

    console.log("Loading experiment data:", experimentKey, "Scenario:", scenario);

    // Handle new manifest structure with experiment_keys
    const experiments = manifest.experiment_keys || manifest;
    if (
      experiments[experimentKey] &&
      experiments[experimentKey].scenarios[scenario]
    ) {
      const dataPaths = experiments[experimentKey].scenarios[scenario];
      try {
        const inputOutputArray = await (await fetch(dataPaths.input_output)).json();
        const timingData = await (await fetch(dataPaths.timing)).json();

        // Extract the index from the scenario ID (e.g., "test_scenario_1-0" → 0)
        const scenarioIndex = parseInt(scenario.split('-').pop());
        
        // Get the specific element from each array using the index
        const inputOutputItem = inputOutputArray[scenarioIndex];

        return {
          inputOutput: inputOutputItem,
          inputOutputArray: inputOutputArray,
          timing: timingData,
          experimentKey: experimentKey,
          error: null
        };
      } catch (error) {
        console.error("Error fetching experiment data:", error);
        return {
          inputOutput: null,
          inputOutputArray: null,
            timing: null,
          experimentKey: experimentKey,
          error: error.message
        };
      }
    } else {
      // Try to find a fallback experiment key
      let fallbackKey = null;
      
      // If a run variant was requested, try falling back to the base key (without run variant)
      if (runVariant) {
        const baseKey = buildExperimentKey(admType, llmBackbone, kdmas);
        if (experiments[baseKey] && experiments[baseKey].scenarios[scenario]) {
          fallbackKey = baseKey;
          console.log(`Fallback: Using base key without run variant: ${fallbackKey} for requested key: ${experimentKey}`);
        }
      }
      
      // If no fallback found yet, try to find any other variant for the same base
      if (!fallbackKey) {
        const availableKeys = Object.keys(experiments);
        const baseKey = runVariant ? buildExperimentKey(admType, llmBackbone, kdmas) : experimentKey;
        
        // Look for keys that match the base pattern (either exact or with variants)
        for (const key of availableKeys) {
          if ((key === baseKey || key.startsWith(baseKey + '_')) && experiments[key].scenarios[scenario]) {
            fallbackKey = key;
            break;
          }
        }
      }
      
      if (fallbackKey) {
        console.log(`Using fallback key: ${fallbackKey} for requested key: ${experimentKey}`);
        const dataPaths = experiments[fallbackKey].scenarios[scenario];
        try {
          const inputOutputArray = await (await fetch(dataPaths.input_output)).json();
          const timingData = await (await fetch(dataPaths.timing)).json();

          const scenarioIndex = parseInt(scenario.split('-').pop());
          const inputOutputItem = inputOutputArray[scenarioIndex];

          return {
            inputOutput: inputOutputItem,
            inputOutputArray: inputOutputArray,
              timing: timingData,
            experimentKey: fallbackKey, // Return the actual key used
            error: null
          };
        } catch (error) {
          console.error("Error fetching fallback experiment data:", error);
        }
      }
      
      // Generate debug information to help identify the issue
      const similarKeys = Object.keys(experiments).filter(key => 
        key.startsWith(`${experimentKey.split('_')[0]}_${experimentKey.split('_')[1]}_`)
      );
      
      console.warn(`No data found for key: ${experimentKey}, scenario: ${scenario}`);
      console.warn(`Available similar keys:`, similarKeys);
      
      return {
        inputOutput: null,
        inputOutputArray: null,
        timing: null,
        experimentKey: experimentKey,
        error: `No experiment data found for ${experimentKey} with scenario ${scenario}`
      };
    }
  }

  // Function to load and display results for current run
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
    
    // Store complete run data
    const pinnedData = {
      ...runConfig,
      inputOutput: appState.currentInputOutput,
      inputOutputArray: appState.currentInputOutputArray,
      timing: appState.currentTiming,
      loadStatus: 'loaded'
    };
    
    appState.pinnedRuns.set(runConfig.id, pinnedData);
    updateComparisonDisplay();
    
    // Update URL after pinning
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
    
    // Load the results for this configuration
    try {
      await loadResultsForConfig(runConfig);
      
      // Store complete run data
      const pinnedData = {
        ...runConfig,
        inputOutput: appState.currentInputOutput,
        inputOutputArray: appState.currentInputOutputArray,
          timing: appState.currentTiming,
        loadStatus: 'loaded'
      };
      
      appState.pinnedRuns.set(runConfig.id, pinnedData);
        
    } catch (error) {
      console.warn('Failed to load data for pinned configuration:', error);
      // Still add to pinned runs but mark as failed
      const pinnedData = {
        ...runConfig,
        inputOutput: null,
        timing: null,
        loadStatus: 'error'
      };
      appState.pinnedRuns.set(runConfig.id, pinnedData);
    }
  }

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
    updateComparisonDisplay();
    
    // Get updated parameters from columnParameters
    const params = getParametersForRun(runId);
    
    try {
      // Load new data using pure function - no global state modification
      const experimentData = await loadExperimentData(
        params.scenario,
        params.admType,
        params.llmBackbone,
        params.kdmas,
        params.runVariant
      );
      
      // Always update run parameters to reflect the intended state
      run.scenario = params.scenario;
      run.baseScenario = params.baseScenario;
      run.admType = params.admType;
      run.llmBackbone = params.llmBackbone;
      run.runVariant = params.runVariant;
      run.kdmaValues = { ...params.kdmas };
      
      if (experimentData.error) {
        console.error(`Failed to load data for run ${runId}:`, experimentData.error);
        run.loadStatus = 'error';
        // Keep existing data but update parameters
        run.experimentKey = experimentData.experimentKey || run.experimentKey;
      } else {
        // Update with new results
        run.experimentKey = experimentData.experimentKey;
        run.inputOutput = experimentData.inputOutput;
        run.inputOutputArray = experimentData.inputOutputArray;
        run.timing = experimentData.timing;
        run.loadStatus = 'loaded';
        
        console.log(`Successfully reloaded run ${runId} with new data`);
      }
      
    } catch (error) {
      console.error(`Failed to reload data for run ${runId}:`, error);
      
      // Even on exception, update run parameters to reflect the intended state
      run.scenario = params.scenario;
      run.baseScenario = params.baseScenario;
      run.admType = params.admType;
      run.llmBackbone = params.llmBackbone;
      run.runVariant = params.runVariant;
      run.kdmaValues = { ...params.kdmas };
      run.loadStatus = 'error';
    } finally {
      // Clear the reloading flag
      run.isReloading = false;
    }
    
    // Re-render the comparison table (current run data is unaffected)
    updateComparisonDisplay();
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
    parameters.set("base_scenario", { type: "string", required: true });
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
    if (paramName === 'base_scenario') return run.baseScenario || 'N/A';
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

  // Create dropdown HTML for LLM selection in table cells
  function createLLMDropdownForRun(runId, currentValue) {
    const run = appState.pinnedRuns.get(runId);
    if (!run) return escapeHtml(currentValue);
    
    const validOptions = getValidOptionsForConstraints({ 
      scenario: run.scenario,
      admType: run.admType 
    });
    const validLLMs = Array.from(validOptions.llmBackbones).sort();
    
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
    
    const validOptions = getValidOptionsForConstraints({ 
      scenario: run.scenario
    });
    const validADMs = Array.from(validOptions.admTypes).sort();
    
    let html = `<select class="table-adm-select" onchange="handleRunADMChange('${runId}', this.value)">`;
    validADMs.forEach(adm => {
      const selected = adm === currentValue ? 'selected' : '';
      html += `<option value="${escapeHtml(adm)}" ${selected}>${escapeHtml(adm)}</option>`;
    });
    html += '</select>';
    
    return html;
  }

  // Create dropdown HTML for base scenario selection in table cells
  function createBaseScenarioDropdownForRun(runId, currentValue) {
    // Check if run exists
    const run = appState.pinnedRuns.get(runId);
    if (!run) return escapeHtml(currentValue);
    
    // For base scenario, we show all available base scenarios
    const availableBaseScenarios = Array.from(appState.availableBaseScenarios).sort();
    
    let html = `<select class="table-scenario-select" onchange="handleRunBaseScenarioChange('${runId}', this.value)">`;
    availableBaseScenarios.forEach(baseScenario => {
      const selected = baseScenario === currentValue ? 'selected' : '';
      html += `<option value="${escapeHtml(baseScenario)}" ${selected}>${escapeHtml(baseScenario)}</option>`;
    });
    html += '</select>';
    
    return html;
  }

  // Create dropdown HTML for specific scenario selection in table cells
  function createSpecificScenarioDropdownForRun(runId, currentValue) {
    // Check if run exists
    const run = appState.pinnedRuns.get(runId);
    if (!run) return escapeHtml(currentValue);
    
    const baseScenarioId = run.baseScenario;
    
    if (!baseScenarioId) {
      return '<span class="na-value">No base scenario</span>';
    }
    
    const matchingScenarios = Array.from(appState.availableScenarios).filter((scenarioId) => {
      const extractedBase = scenarioId.replace(/-\d+$/, "");
      return extractedBase === baseScenarioId;
    });
    
    if (matchingScenarios.length === 0) {
      return '<span class="na-value">No scenarios available</span>';
    }
    
    let html = `<select class="table-scenario-select" onchange="handleRunSpecificScenarioChange('${runId}', this.value)">`;
    matchingScenarios.forEach(scenario => {
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
    
    // First check if we can add more KDMAs given current constraints
    const currentKDMAs = run.kdmaValues || {};
    const currentCount = Object.keys(currentKDMAs).length;
    
    // Try to see if adding one more KDMA is possible
    const constraints = {
      scenario: run.scenario,
      admType: run.admType,
      llmBackbone: run.llmBackbone
    };
    
    // If we have current KDMAs, include them as constraints
    if (currentCount > 0) {
      constraints.kdmas = { ...currentKDMAs };
    }
    
    const validOptions = getValidOptionsForConstraints(constraints);
    const availableTypes = Object.keys(validOptions.kdmas || {}).filter(type => 
      !currentKDMAs[type]
    );
    
    // If we can add more types, max is at least current + 1
    if (availableTypes.length > 0) {
      return currentCount + 1;
    }
    
    // Otherwise, check what we actually have experimentally
    const experiments = manifest.experiment_keys || manifest;
    let maxKDMAs = currentCount;
    
    for (const expKey in experiments) {
      if (expKey.startsWith(`${run.admType}_${run.llmBackbone}_`) && 
          experiments[expKey].scenarios && 
          experiments[expKey].scenarios[run.scenario]) {
        
        // Count KDMAs in this experiment key
        const keyParts = expKey.split('_');
        let kdmaCount = 0;
        for (let i = 2; i < keyParts.length; i++) {
          if (keyParts[i].includes('-')) {
            kdmaCount++;
          }
        }
        maxKDMAs = Math.max(maxKDMAs, kdmaCount);
      }
    }
    
    return Math.max(maxKDMAs, 1); // At least 1 KDMA should be possible
  }

  // Get valid KDMAs for a specific run
  function getValidKDMAsForRun(runId) {
    const run = appState.pinnedRuns.get(runId);
    if (!run) return {};
    
    // KDMA prioritization: Find all possible KDMAs for this scenario regardless of current ADM selection
    // This allows users to add KDMAs even when current ADM has no KDMAs
    const constraints = {
      scenario: run.scenario
      // Note: NOT including admType here to allow all ADMs for the scenario
    };
    
    // If there are existing KDMAs, include them as constraints to ensure consistency
    if (run.kdmaValues && Object.keys(run.kdmaValues).length > 0) {
      constraints.kdmas = { ...run.kdmaValues };
    }
    
    const validOptions = getValidOptionsForConstraints(constraints);
    
    return validOptions.kdmas;
  }
  
  // Check if removing KDMAs is allowed for a run (i.e., experiments exist without KDMAs)
  function canRemoveKDMAsForRun(runId) {
    const run = appState.pinnedRuns.get(runId);
    if (!run) return false;
    
    // KDMA prioritization: Check if ANY ADM for this scenario has no KDMAs
    // This allows users to remove KDMAs even when current ADM requires them
    const experiments = manifest.experiment_keys || manifest;
    
    // Look for any experiment key that has this scenario but no KDMAs
    for (const experimentKey in experiments) {
      const experiment = experiments[experimentKey];
      
      // Check if this experiment includes our scenario
      if (experiment.scenarios && experiment.scenarios[run.scenario]) {
        // Check if this experiment key has no KDMAs
        // Keys without KDMAs end with underscore (indicating no KDMA suffix)
        if (experimentKey.endsWith('_')) {
          return true;
        }
      }
    }
    
    return false;
  }

  // Check if a specific KDMA can be removed from a run
  function canRemoveSpecificKDMA(runId, kdmaType) {
    const run = appState.pinnedRuns.get(runId);
    if (!run) return false;
    
    const currentKDMAs = run.kdmaValues || {};
    
    // Create a copy of current KDMAs without the one we want to remove
    const remainingKDMAs = { ...currentKDMAs };
    delete remainingKDMAs[kdmaType];
    
    // If no KDMAs would remain, use the original canRemoveKDMAsForRun check
    if (Object.keys(remainingKDMAs).length === 0) {
      return canRemoveKDMAsForRun(runId);
    }
    
    // Check if experiments exist with the remaining KDMAs for this specific scenario
    // We need to directly check the manifest instead of using getValidOptionsForConstraints
    // because that function might be too permissive
    return checkExperimentExistsForScenario(run.scenario, run.admType, run.llmBackbone, remainingKDMAs);
  }
  
  // Format KDMA value consistently across the application
  function formatKDMAValue(value) {
    return typeof value === 'number' ? value.toFixed(1) : value;
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

  // Check if experiments exist for a specific scenario with given parameters
  function checkExperimentExistsForScenario(scenario, admType, llmBackbone, kdmas) {
    const experiments = manifest.experiment_keys || manifest;
    
    // Build the experiment key using shared utility
    const experimentKey = buildExperimentKey(admType, llmBackbone, kdmas);
    
    // Check if this experiment exists and has the target scenario
    if (experiments[experimentKey] && 
        experiments[experimentKey].scenarios && 
        experiments[experimentKey].scenarios[scenario]) {
      return true;
    }
    
    // If direct key lookup fails, try all possible orderings of KDMAs
    // since the experiment keys might have different KDMA ordering
    const kdmaKeys = Object.keys(kdmas || {});
    if (kdmaKeys.length > 1) {
      const permutations = getKDMAPermutations(kdmaKeys);
      for (const permutation of permutations) {
        const reorderedKdmas = {};
        permutation.forEach(kdmaName => {
          if (kdmas[kdmaName] !== undefined) {
            reorderedKdmas[kdmaName] = kdmas[kdmaName];
          }
        });
        
        const altKey = buildExperimentKey(admType, llmBackbone, reorderedKdmas);
        if (experiments[altKey] && 
            experiments[altKey].scenarios && 
            experiments[altKey].scenarios[scenario]) {
          return true;
        }
      }
    }
    
    return false;
  }
  
  // Generate all permutations of KDMA keys for experiment key lookup
  function getKDMAPermutations(kdmaKeys) {
    if (kdmaKeys.length <= 1) return [kdmaKeys];
    
    const permutations = [];
    for (let i = 0; i < kdmaKeys.length; i++) {
      const rest = kdmaKeys.slice(0, i).concat(kdmaKeys.slice(i + 1));
      const restPermutations = getKDMAPermutations(rest);
      for (const perm of restPermutations) {
        permutations.push([kdmaKeys[i]].concat(perm));
      }
    }
    return permutations;
  }

  // Create KDMA controls HTML for table cells
  function createKDMAControlsForRun(runId, currentKDMAs) {
    const run = appState.pinnedRuns.get(runId);
    if (!run) return '<span class="na-value">N/A</span>';
    
    const maxKDMAs = getMaxKDMAsForRun(runId);
    const currentKDMAEntries = Object.entries(currentKDMAs || {});
    const canAddMore = currentKDMAEntries.length < maxKDMAs;
    
    let html = `<div class="table-kdma-container" data-run-id="${runId}">`;
    
    // Render existing KDMA controls
    currentKDMAEntries.forEach(([kdmaType, value], index) => {
      html += createSingleKDMAControlForRun(runId, kdmaType, value, index);
    });
    
    // Add button - always show but enable/disable based on availability
    const availableKDMAs = getValidKDMAsForRun(runId);
    const availableTypes = Object.keys(availableKDMAs).filter(type => 
      !currentKDMAs || currentKDMAs[type] === undefined
    );
    
    const canAdd = canAddMore && availableTypes.length > 0;
    const disabledAttr = canAdd ? '' : 'disabled';
    
    // Determine tooltip text for disabled state
    let tooltipText = '';
    if (!canAdd) {
      if (!canAddMore) {
        tooltipText = `title="Maximum KDMAs reached (${maxKDMAs})"`;
      } else {
        tooltipText = 'title="All available KDMA types have been added"';
      }
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
               min="0" max="1" step="0.1" 
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
    if (runId !== 'current' && runId !== '' && paramName === 'run_variant') {
      return createRunVariantDropdownForRun(runId, value);
    }
    
    if (value === null || value === undefined || value === 'N/A') {
      return '<span class="na-value">N/A</span>';
    }
    
    // Special handling for editable parameters in pinned runs
    if (runId !== 'current' && runId !== '') {
      if (paramName === 'llm_backbone') {
        return createLLMDropdownForRun(runId, value);
      }
      if (paramName === 'adm_type') {
        return createADMDropdownForRun(runId, value);
      }
      if (paramName === 'base_scenario') {
        return createBaseScenarioDropdownForRun(runId, value);
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

  function getObjectPreview(obj) {
    if (!obj || typeof obj !== 'object') return 'N/A';
    const keys = Object.keys(obj);
    if (keys.length === 0) return '{}';
    if (keys.length === 1 && typeof obj[keys[0]] !== 'object') {
      return `${keys[0]}: ${obj[keys[0]]}`;
    }
    return `{${keys.slice(0, 3).join(', ')}${keys.length > 3 ? '...' : ''}}`;
  }

  // Add a new column by duplicating the rightmost column's parameters
  async function addNewColumn() {
    if (appState.pinnedRuns.size === 0) return;
    
    // Get the rightmost (last) pinned run
    const pinnedRunsArray = Array.from(appState.pinnedRuns.values());
    const lastRun = pinnedRunsArray[pinnedRunsArray.length - 1];
    
    // Temporarily update app state to match the last run's configuration
    const originalState = {
      selectedBaseScenario: appState.selectedBaseScenario,
      selectedScenario: appState.selectedScenario,
      selectedAdmType: appState.selectedAdmType,
      selectedLLM: appState.selectedLLM,
      activeKDMAs: { ...appState.activeKDMAs }
    };
    
    appState.selectedBaseScenario = lastRun.baseScenario;
    appState.selectedScenario = lastRun.scenario;
    appState.selectedAdmType = lastRun.admType;
    appState.selectedLLM = lastRun.llmBackbone;
    appState.activeKDMAs = { ...lastRun.kdmaValues };
    
    // Pin directly without duplicate checking since we want to allow duplicates for comparison
    const runConfig = appState.createRunConfig();
    
    try {
      await loadResultsForConfig(runConfig);
      
      // Store complete run data
      const pinnedData = {
        ...runConfig,
        inputOutput: appState.currentInputOutput,
        inputOutputArray: appState.currentInputOutputArray,
          timing: appState.currentTiming,
        loadStatus: 'loaded'
      };
      
      appState.pinnedRuns.set(runConfig.id, pinnedData);
        updateComparisonDisplay();
      urlState.updateURL();
      
    } catch (error) {
      console.warn('Failed to load data for new column:', error);
      // Still add to pinned runs but mark as failed
      const pinnedData = {
        ...runConfig,
        loadStatus: 'failed',
        error: error.message
      };
      appState.pinnedRuns.set(runConfig.id, pinnedData);
        updateComparisonDisplay();
    }
    
    // Restore original app state
    Object.assign(appState, originalState);
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
                updateComparisonDisplay();
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

  // Initialize static button event listeners
  const addColumnBtn = document.getElementById('add-column-btn');
  if (addColumnBtn) {
    addColumnBtn.addEventListener('click', addNewColumn);
  }

  // Initial manifest fetch on page load
  fetchManifest();
});
