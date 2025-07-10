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


