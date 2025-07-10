// Functional State Management Module
// Pure functions for managing application state without mutations

// Create initial empty state
export function createInitialState() {
  return {
    // Data from manifest
    availableScenarios: [],
    availableBaseScenarios: [],
    availableAdmTypes: [],
    availableKDMAs: [],
    availableLLMs: [],
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
  
  if (updates.baseScenario !== undefined) {
    newState.selectedBaseScenario = updates.baseScenario;
  }
  if (updates.scenario !== undefined) {
    newState.selectedScenario = updates.scenario;
  }
  if (updates.admType !== undefined) {
    newState.selectedAdmType = updates.admType;
  }
  if (updates.llm !== undefined) {
    newState.selectedLLM = updates.llm;
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
export function getSelectedKey(state) {
  const admType = state.selectedAdmType;
  const llmBackbone = state.selectedLLM;

  const kdmaParts = [];
  Object.entries(state.activeKDMAs).forEach(([kdma, value]) => {
    kdmaParts.push(`${kdma}-${value.toFixed(1)}`);
  });
  
  // Sort KDMA parts to match the key generation in build.py
  const kdmaString = kdmaParts.sort().join("_");

  return `${admType}_${llmBackbone}_${kdmaString}`;
}

// Generate a unique run ID
export function generateRunId() {
  const timestamp = new Date().getTime();
  const random = Math.random().toString(36).substr(2, 9);
  return `run_${timestamp}_${random}`;
}

// Generate display name for a run based on current state
export function generateDisplayName(state) {
  const parts = [];
  if (state.selectedAdmType) {
    parts.push(state.selectedAdmType.replace(/_/g, ' '));
  }
  if (state.selectedLLM) {
    parts.push(state.selectedLLM.replace(/_/g, ' '));
  }
  const kdmaKeys = Object.keys(state.activeKDMAs || {});
  if (kdmaKeys.length > 0) {
    const kdmaStr = kdmaKeys.map(k => `${k}=${state.activeKDMAs[k]}`).join(', ');
    parts.push(`(${kdmaStr})`);
  }
  const result = parts.join(' - ') || 'Unnamed Run';
  return result === '' ? 'Unnamed Run' : result;
}

// Create a run configuration factory function
export function createRunConfig(state) {
  return {
    id: generateRunId(),
    timestamp: new Date().toISOString(),
    scenario: state.selectedScenario,
    baseScenario: state.selectedBaseScenario,
    admType: state.selectedAdmType,
    llmBackbone: state.selectedLLM,
    kdmaValues: { ...state.activeKDMAs },
    experimentKey: getSelectedKey(state),
    displayName: generateDisplayName(state),
    loadStatus: 'pending'
  };
}

// Parameter structure factory for run management
export function createParameterStructure(params = {}) {
  return {
    scenario: params.scenario || null,
    baseScenario: params.baseScenario || null,
    admType: params.admType || null,
    llmBackbone: params.llmBackbone || null,
    kdmas: params.kdmas || {}
  };
}

// URL State Management Functions
export function encodeStateToURL(state) {
  const urlState = {
    baseScenario: state.selectedBaseScenario,
    scenario: state.selectedScenario,
    admType: state.selectedAdmType,
    llm: state.selectedLLM,
    kdmas: state.activeKDMAs,
    pinnedRuns: Array.from(state.pinnedRuns.values()).map(run => ({
      scenario: run.scenario,
      baseScenario: run.baseScenario,
      admType: run.admType,
      llmBackbone: run.llmBackbone,
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


