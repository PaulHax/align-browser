// Functional State Management Module
// Pure functions for managing application state without mutations

// KDMA Utility Functions
export const KDMAUtils = {
  // Normalize KDMA object - removes extra fields, keeps only kdma and value
  normalize: (kdma) => ({ kdma: kdma.kdma, value: kdma.value }),
  
  // Normalize KDMA value to 1 decimal place
  normalizeValue: (value) => Math.round(parseFloat(value) * 10) / 10,
  
  // Format KDMA value for display (1 decimal place)
  formatValue: (value) => typeof value === 'number' ? value.toFixed(1) : value,
  
  // Sort KDMA array by kdma name
  sort: (kdmaArray) => [...kdmaArray].sort((a, b) => a.kdma.localeCompare(b.kdma)),
  
  // Normalize and sort KDMA array for comparison
  normalizeAndSort: (kdmaArray) => {
    return KDMAUtils.sort(kdmaArray.map(KDMAUtils.normalize));
  },
  
  // Compare two KDMA arrays (normalized comparison)
  arraysEqual: (array1, array2) => {
    const sorted1 = KDMAUtils.normalizeAndSort(array1);
    const sorted2 = KDMAUtils.normalizeAndSort(array2);
    return JSON.stringify(sorted1) === JSON.stringify(sorted2);
  },
  
  // Convert KDMA object to array and serialize for keys
  serializeToKey: (kdmaObject) => {
    const kdmaArray = Object.entries(kdmaObject).map(([kdma, value]) => ({ kdma, value }));
    return JSON.stringify(KDMAUtils.sort(kdmaArray));
  },
  
  // Convert KDMA object to key parts for experiment keys
  toKeyParts: (kdmaObject) => {
    return Object.entries(kdmaObject)
      .map(([kdma, value]) => `${kdma}-${KDMAUtils.formatValue(value)}`)
      .sort();
  }
};

// Create initial empty state
export function createInitialState() {
  return {
    // Data from manifest
    availableScenarios: [],
    availableScenes: [],
    availableAdmTypes: [],
    availableKDMAs: [],
    availableLLMs: [],
    
    // User selections
    selectedScenario: null,
    selectedScene: null,
    selectedAdmType: null,
    selectedLLM: null,
    selectedRunVariant: 'default',
    activeKDMAs: {},
    
    // LLM preferences per ADM type for preservation
    llmPreferences: {},
    
    // UI state
    isUpdatingProgrammatically: false,
    isTransitioning: false,
    
    // Comparison state
    pinnedRuns: new Map(),
    currentInputOutput: null,
    currentScores: null,
    currentTiming: null,
    currentInputOutputArray: null
  };
}

// Pure state updaters (immutable)
export function updateUserSelections(state, updates) {
  const newState = { ...state };
  
  if (updates.scenario !== undefined) {
    newState.selectedScenario = updates.scenario;
  }
  if (updates.scene !== undefined) {
    newState.selectedScene = updates.scene;
  }
  if (updates.admType !== undefined) {
    newState.selectedAdmType = updates.admType;
  }
  if (updates.llm !== undefined) {
    newState.selectedLLM = updates.llm;
  }
  if (updates.runVariant !== undefined) {
    newState.selectedRunVariant = updates.runVariant;
  }
  if (updates.kdmas !== undefined) {
    newState.activeKDMAs = { ...updates.kdmas };
  }
  
  return newState;
}

export function updateCurrentData(state, updates) {
  return {
    ...state,
    currentInputOutput: updates.inputOutput !== undefined ? updates.inputOutput : state.currentInputOutput,
    currentScores: updates.scores !== undefined ? updates.scores : state.currentScores,
    currentTiming: updates.timing !== undefined ? updates.timing : state.currentTiming,
    currentInputOutputArray: updates.inputOutputArray !== undefined ? updates.inputOutputArray : state.currentInputOutputArray
  };
}


// Pure selectors (computed values)
function getSelectedKey(state) {
  const admType = state.selectedAdmType;
  const llmBackbone = state.selectedLLM;
  const runVariant = state.selectedRunVariant;

  const kdmaParts = KDMAUtils.toKeyParts(state.activeKDMAs);
  const kdmaString = kdmaParts.join("_");

  return `${admType}:${llmBackbone}:${kdmaString}:${runVariant}`;
}

// Generate a unique run ID
export function generateRunId() {
  const timestamp = new Date().getTime();
  const random = Math.random().toString(36).substring(2, 11);
  return `run_${timestamp}_${random}`;
}


// Create a run configuration factory function
export function createRunConfig(state) {
  // Create sophisticated KDMA structure that preserves permutation constraints
  const kdmaStructure = {
    validCombinations: [], // Array of valid KDMA combinations
    availableTypes: new Set(), // All KDMA types that appear in any combination
    typeValueMap: {} // kdmaType -> Set of all possible values for that type
  };
  
  if (state.availableKDMAs && Array.isArray(state.availableKDMAs)) {
    // Store all valid combinations and build type/value maps
    state.availableKDMAs.forEach(kdmaCombination => {
      if (Array.isArray(kdmaCombination)) {
        // Store the valid combination
        kdmaStructure.validCombinations.push([...kdmaCombination]);
        
        // Extract types and values for the maps
        kdmaCombination.forEach(kdmaItem => {
          if (kdmaItem.kdma && kdmaItem.value !== undefined) {
            kdmaStructure.availableTypes.add(kdmaItem.kdma);
            if (!kdmaStructure.typeValueMap[kdmaItem.kdma]) {
              kdmaStructure.typeValueMap[kdmaItem.kdma] = new Set();
            }
            kdmaStructure.typeValueMap[kdmaItem.kdma].add(kdmaItem.value);
          }
        });
      }
    });
  }
  
  
  return {
    id: generateRunId(),
    timestamp: new Date().toISOString(),
    scenario: state.selectedScenario,
    scene: state.selectedScene,
    admType: state.selectedAdmType,
    llmBackbone: state.selectedLLM,
    runVariant: state.selectedRunVariant,
    kdmaValues: { ...state.activeKDMAs },
    experimentKey: getSelectedKey(state),
    loadStatus: 'pending',
    // Store available options at time of creation for dropdown population
    availableOptions: {
      scenarios: [...state.availableScenarios],
      scenes: [...state.availableScenes],
      admTypes: [...state.availableAdmTypes],
      llms: [...state.availableLLMs],
      kdmas: kdmaStructure  // Sophisticated structure with constraint information
    }
  };
}

// Parameter structure factory for run management
export function createParameterStructure(params = {}) {
  return {
    scenario: params.scenario || null,
    scene: params.scene || null,
    admType: params.admType || null,
    llmBackbone: params.llmBackbone || null,
    runVariant: params.runVariant || 'default',
    kdmas: params.kdmas || {}
  };
}

// URL State Management Functions
export function encodeStateToURL(state) {
  const urlState = {
    scene: state.selectedScene,
    scenario: state.selectedScenario,
    admType: state.selectedAdmType,
    llm: state.selectedLLM,
    runVariant: state.selectedRunVariant,
    kdmas: state.activeKDMAs,
    pinnedRuns: Array.from(state.pinnedRuns.values()).map(run => ({
      scenario: run.scenario,
      scene: run.scene,
      admType: run.admType,
      llmBackbone: run.llmBackbone,
      runVariant: run.runVariant,
      kdmaValues: run.kdmaValues,
      id: run.id
    }))
  };
  
  try {
    const encodedState = btoa(JSON.stringify(urlState));
    return `${window.location.pathname}?state=${encodedState}`;
  } catch (e) {
    console.warn('Failed to encode URL state:', e);
    return window.location.pathname;
  }
}

export function decodeStateFromURL() {
  const params = new URLSearchParams(window.location.search);
  const stateParam = params.get('state');
  
  if (stateParam) {
    try {
      return JSON.parse(atob(stateParam));
    } catch (e) {
      console.warn('Invalid URL state, using defaults:', e);
      return null;
    }
  }
  return null;
}

// Priority order for parameter cascading
const PARAMETER_PRIORITY_ORDER = ['scenario', 'scene', 'kdma_values', 'adm', 'llm', 'run_variant'];

// Parameter update system with priority-based cascading
const updateParametersBase = (priorityOrder) => (manifest) => (currentParams, changes) => {
  const newParams = { ...currentParams, ...changes };
  
  // Helper to check if manifest entry matches current selection
  const matchesCurrentSelection = (manifestEntry, excludeParam, currentSelection) => {
    const excludeParamIndex = priorityOrder.indexOf(excludeParam);
    
    for (const param of priorityOrder) {
      if (param === excludeParam) continue;
      
      const paramIndex = priorityOrder.indexOf(param);
      
      // Only apply constraints from higher priority parameters (already set)
      // Lower priority parameters shouldn't constrain higher priority ones
      if (paramIndex >= excludeParamIndex) {
        continue; // Skip constraints from same or lower priority parameters
      }
      
      // Only check constraint if the current selection has a non-null value for this parameter
      if (currentSelection[param] !== null && currentSelection[param] !== undefined) {
        // Special handling for kdma_values comparison (arrays where order doesn't matter)
        // This filters manifest entries to find compatible KDMA combinations
        if (param === 'kdma_values') {
          const manifestKdmas = manifestEntry[param];
          const selectionKdmas = currentSelection[param];
          
          if (!KDMAUtils.arraysEqual(manifestKdmas, selectionKdmas)) {
            return false;
          }
        } else if (manifestEntry[param] !== currentSelection[param]) {
          return false;
        }
      }
    }
    return true;
  };
  
  // Helper to get valid options for a parameter
  const getValidOptionsFor = (parameterName, currentSelection) => {
    const validEntries = manifest.filter(entry => 
      matchesCurrentSelection(entry, parameterName, currentSelection)
    );
    const options = [...new Set(validEntries.map(entry => entry[parameterName]))];
    
    return options;
  };
  
  // Find the highest priority parameter that changed
  const changedParams = Object.keys(changes);
  let highestChangedIndex;
  
  if (changedParams.length === 0) {
    // No changes provided - validate/correct all parameters from the beginning
    highestChangedIndex = -1;
  } else {
    highestChangedIndex = Math.min(
      ...changedParams.map(param => priorityOrder.indexOf(param))
    );
  }
  
  // Check and potentially update parameters starting from the highest changed index
  for (let i = highestChangedIndex + 1; i < priorityOrder.length; i++) {
    const param = priorityOrder[i];
    const currentValue = newParams[param];
    const validOptions = getValidOptionsFor(param, newParams);
    
    console.log(`Parameter ${param}: currentValue=${currentValue}, validOptions=${validOptions.length > 0 ? validOptions.slice(0, 3) : 'empty'}`);
    if (param === 'kdma_values') {
      console.log('  -> kdma_values validation using normalized comparison');
    }
    
    // Only change if current value is invalid
    let isValid = validOptions.includes(currentValue);
    
    // For kdma_values, use normalized comparison since validOptions contains
    // KDMA arrays that might have different object references but same values.
    // This validates the current value against the filtered valid options
    if (param === 'kdma_values' && !isValid && Array.isArray(currentValue)) {
      isValid = validOptions.some(option => {
        if (!Array.isArray(option)) return false;
        return KDMAUtils.arraysEqual(option, currentValue);
      });
    }
    
    if (!isValid) {
      const newValue = validOptions.length > 0 ? validOptions[0] : null;
      newParams[param] = newValue;
      console.log(`  -> Updated ${param} from ${currentValue} to ${newValue}`);
    }
  }
  
  // Calculate available options for all parameters
  const availableOptions = {};
  for (const param of priorityOrder) {
    availableOptions[param] = getValidOptionsFor(param, newParams);
  }
  
  return {
    params: newParams,
    options: availableOptions
  };
};

// Export updateParameters with priority order already curried
export const updateParameters = updateParametersBase(PARAMETER_PRIORITY_ORDER);

// Global manifest storage
let manifest = null;

let parameterRunMap = new Map();

// Load and initialize manifest
export async function loadManifest() {
    const response = await fetch("./data/manifest.json");
    manifest = await response.json();
    
    // Initialize updateParameters with the transformed manifest
    const transformedManifest = transformManifestForUpdateParameters(manifest);
    const updateAppParameters = updateParameters(transformedManifest);
    
    return { manifest, updateAppParameters };
}

// Get the loaded manifest
export function getManifest() {
  return manifest;
}

function resolveParametersToRun(params) {
  if (!parameterRunMap || parameterRunMap.size === 0) {
    console.warn('parameterRunMap is empty or not initialized');
    return undefined;
  }
  
  const { scenario, scene, kdmaValues, admType, llmBackbone, runVariant } = params;
  
  console.log('Input kdmaValues:', kdmaValues);
  
  const kdmaString = KDMAUtils.serializeToKey(kdmaValues || {});
  
  const mapKey = `${scenario}:${scene}:${kdmaString}:${admType}:${llmBackbone}:${runVariant}`;
  
  const result = parameterRunMap.get(mapKey);
  
  return result;
}

export async function fetchRunData(params) {
  const runInfo = resolveParametersToRun(params);
  if (!runInfo) {
    return undefined;
  }
  
  try {
    // Fetch both input/output and timing data
    const [inputOutputResponse, timingResponse] = await Promise.all([
      fetch(runInfo.inputOutputPath),
      fetch(runInfo.timingPath)
    ]);
    
    const inputOutputArray = await inputOutputResponse.json();
    const timingData = await timingResponse.json();
    
    // Return complete data structure
    return {
      inputOutput: inputOutputArray[runInfo.sourceIndex],
      inputOutputArray: inputOutputArray,
      timing: timingData,
      experimentKey: runInfo.experimentKey,
      timing_s: runInfo.timing_s
    };
  } catch (error) {
    console.error('Error fetching run data:', error);
    return undefined;
  }
}

// Transform hierarchical manifest to flat array for updateParameters
export function transformManifestForUpdateParameters(manifest) {
  console.log('transformManifestForUpdateParameters called with:', {
    hasExperiments: !!manifest.experiments,
    experimentKeys: manifest.experiments ? Object.keys(manifest.experiments) : []
  });
  
  const entries = [];
  
  if (!manifest.experiments) {
    console.warn('No experiments found in manifest');
    return entries;
  }
  
  parameterRunMap.clear();
  
  for (const [experimentKey, experiment] of Object.entries(manifest.experiments)) {
    console.log(`Processing experiment ${experimentKey}:`, {
      hasParameters: !!experiment.parameters,
      hasScenarios: !!experiment.scenarios,
      scenarioKeys: experiment.scenarios ? Object.keys(experiment.scenarios) : []
    });
    
    const { adm, llm, kdma_values, run_variant } = experiment.parameters;
    
    for (const [scenarioId, scenario] of Object.entries(experiment.scenarios)) {
      console.log(`  Processing scenario ${scenarioId}:`, {
        hasScenes: !!scenario.scenes,
        sceneKeys: scenario.scenes ? Object.keys(scenario.scenes) : []
      });
      
      for (const [sceneId, sceneInfo] of Object.entries(scenario.scenes)) {
        // normalize kdma values
        const cleanedKdmaValues = (kdma_values || []).map(KDMAUtils.normalize);
        const kdmaString = JSON.stringify(KDMAUtils.sort(cleanedKdmaValues));
        
        const entry = {
          scenario: scenarioId,
          scene: sceneId,
          kdma_values: cleanedKdmaValues,
          adm: adm.name,
          llm: llm.model_name,
          run_variant: run_variant
        };
        
        entries.push(entry);
        
        const mapKey = `${scenarioId}:${sceneId}:${kdmaString}:${adm.name}:${llm.model_name}:${run_variant}`;
        
        parameterRunMap.set(mapKey, {
          experimentKey,
          sourceIndex: sceneInfo.source_index,
          inputOutputPath: scenario.input_output.file,
          timingPath: scenario.timing,
          timing_s: sceneInfo.timing_s
        });
      }
    }
  }
  
  console.log(`Transform complete. Generated ${entries.length} entries:`, 
    entries.slice(0, 3).map(e => ({ ...e, kdma_values: 'truncated' }))
  );
  
  // Debug: show unique scenarios and scenes
  const uniqueScenarios = [...new Set(entries.map(e => e.scenario))];
  const uniqueScenes = [...new Set(entries.map(e => e.scene))];
  console.log(`Unique scenarios: ${uniqueScenarios.slice(0, 5)} (${uniqueScenarios.length} total)`);
  console.log(`Unique scenes: ${uniqueScenes.slice(0, 5)} (${uniqueScenes.length} total)`);
  
  return entries;
}