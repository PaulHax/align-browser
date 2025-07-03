// Client-side application logic for ADM Results

document.addEventListener("DOMContentLoaded", () => {
  const admTypeSelection = document.getElementById("adm-type-selection");
  const kdmaSliders = document.getElementById("kdma-sliders");
  const llmSelection = document.getElementById("llm-selection");
  const scenarioSelection = document.getElementById("scenario-selection"); // New element
  const runDisplay = document.getElementById("run-display");

  let manifest = {};
  
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
    isTransitioning: false
  };

  // Function to fetch and parse manifest.json
  async function fetchManifest() {
    try {
      const response = await fetch("/manifest.json");
      manifest = await response.json();
      console.log("Manifest loaded:", manifest);
      extractParametersFromManifest();
      populateUIControls();
      loadResults(); // Load results initially
    } catch (error) {
      console.error("Error fetching manifest:", error);
      runDisplay.innerHTML =
        "<p>Error loading experiment data. Please ensure the data is built correctly.</p>";
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
    });

    // Specific Scenario Selection - Add event listener to existing element
    const scenarioSelect = document.getElementById("scenario-select");
    scenarioSelect.addEventListener("change", () => {
      if (appState.isUpdatingProgrammatically) return;
      appState.selectedScenario = scenarioSelect.value;
      if (!appState.isTransitioning) {
        updateFromScenarioChange();
      }
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
      }
    });

    // Initial population of dropdowns and sliders
    // Order matters: Scenario first, then ADM filtered by scenario, then LLM and KDMAs
    updateBaseScenarioDropdown();
    updateADMDropdown();
    updateLLMDropdown(); // This will also call updateKDMASliders
  }

  function getValidADMsForCurrentScenario() {
    const currentScenario = appState.selectedScenario || getFirstAvailableScenario();
    const experiments = manifest.experiment_keys || manifest;
    const validADMs = new Set();
    
    for (const expKey in experiments) {
      const experiment = experiments[expKey];
      
      // Check if this experiment has the current scenario
      if (experiment.scenarios && experiment.scenarios[currentScenario]) {
        const config = experiment.scenarios[currentScenario].config;
        if (!config) continue;
        
        const expAdm = config.adm ? config.adm.name : "unknown_adm";
        validADMs.add(expAdm);
      }
    }
    
    return Array.from(validADMs).sort();
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

    const validLLMsForAdm = appState.validCombinations[selectedAdm]
      ? Object.keys(appState.validCombinations[selectedAdm]).sort()
      : [];

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
    const runDisplay = document.getElementById("run-display");
    runDisplay.innerHTML = `
      <div class="loading-spinner">
        <div class="spinner"></div>
        <div class="loading-text">Loading scenario...</div>
      </div>
    `;
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
    
    // Find experiments that match the current scenario and ADM/LLM selection
    const experiments = manifest.experiment_keys || manifest;
    const validKDMAs = {};
    
    for (const expKey in experiments) {
      const experiment = experiments[expKey];
      
      // Check if this experiment has the selected scenario
      if (experiment.scenarios && experiment.scenarios[currentScenario]) {
        const config = experiment.scenarios[currentScenario].config;
        if (!config) continue;
        
        const expAdm = config.adm ? config.adm.name : "unknown_adm";
        const expLLM = config.adm && 
          config.adm.structured_inference_engine && 
          config.adm.structured_inference_engine.model_name
          ? config.adm.structured_inference_engine.model_name 
          : "no_llm";
        
        // Only include KDMAs from experiments that match our ADM/LLM selection
        if (expAdm === selectedAdm && expLLM === selectedLLM) {
          if (config.alignment_target && config.alignment_target.kdma_values) {
            config.alignment_target.kdma_values.forEach((kdma_entry) => {
              const kdma = kdma_entry.kdma;
              const value = kdma_entry.value;
              
              if (!validKDMAs[kdma]) {
                validKDMAs[kdma] = new Set();
              }
              validKDMAs[kdma].add(value);
            });
          }
        }
      }
    }
    
    // Convert Sets to sorted Arrays
    for (const kdma in validKDMAs) {
      validKDMAs[kdma] = Array.from(validKDMAs[kdma]).sort((a, b) => a - b);
    }
    
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
    
    // Find a valid experiment combination if we have no active KDMAs
    if (Object.keys(appState.activeKDMAs).length === 0) {
      // If no valid KDMAs for current selection, need to find a different combination
      if (Object.keys(validKDMAs).length === 0) {
        // Current ADM/LLM/Scenario combination has no valid experiments
        // First try to find a valid scenario for this ADM/LLM
        const experiments = manifest.experiment_keys || manifest;
        let foundValidScenario = null;
        
        for (const expKey in experiments) {
          const experiment = experiments[expKey];
          
          for (const scenarioId in experiment.scenarios) {
            const config = experiment.scenarios[scenarioId].config;
            if (!config) continue;
            
            const expAdm = config.adm ? config.adm.name : "unknown_adm";
            const expLLM = config.adm && 
              config.adm.structured_inference_engine && 
              config.adm.structured_inference_engine.model_name
              ? config.adm.structured_inference_engine.model_name 
              : "no_llm";
            
            if (expAdm === selectedAdm && expLLM === selectedLLM) {
              foundValidScenario = scenarioId;
              break;
            }
          }
          
          if (foundValidScenario) break;
        }
        
        if (foundValidScenario && foundValidScenario !== appState.selectedScenario) {
          // Switch to valid scenario
          appState.selectedScenario = foundValidScenario;
          
          // Update scenario selects
          const baseScenarioId = foundValidScenario.replace(/-\d+$/, "");
          const baseScenarioSelect = document.getElementById("base-scenario-select");
          const scenarioSelect = document.getElementById("scenario-select");
          
          if (baseScenarioSelect && baseScenarioSelect.value !== baseScenarioId) {
            appState.selectedBaseScenario = baseScenarioId;
            baseScenarioSelect.value = baseScenarioId;
            updateSpecificScenarioDropdown();
          }
          
          if (scenarioSelect && scenarioSelect.value !== foundValidScenario) {
            scenarioSelect.value = foundValidScenario;
          }
          
          // Retry with new scenario
          updateKDMASliders();
          return;
        }
        
        // If no valid scenario found, try to find a valid LLM for this ADM
        const validLLMsForAdm = appState.validCombinations[selectedAdm] 
          ? Object.keys(appState.validCombinations[selectedAdm]).sort() 
          : [];
        
        if (validLLMsForAdm.length > 0) {
          // Switch to first valid LLM for this ADM
          const firstValidLLM = validLLMsForAdm[0];
          const llmSelect = document.getElementById("llm-select");
          if (llmSelect && llmSelect.value !== firstValidLLM) {
            llmSelect.value = firstValidLLM;
            // This will trigger updateKDMASliders again with valid combination
            updateKDMASliders();
            return;
          }
        } else {
          // No valid LLMs for this ADM, switch to first valid ADM
          const validADMs = Object.keys(appState.validCombinations).sort();
          if (validADMs.length > 0) {
            const firstValidADM = validADMs[0];
            const admSelect = document.getElementById("adm-type-select");
            if (admSelect && admSelect.value !== firstValidADM) {
              admSelect.value = firstValidADM;
              // This will trigger updateLLMDropdown and then updateKDMASliders
              updateLLMDropdown();
              return;
            }
          }
        }
      } else {
        // We have valid KDMAs, add the first available KDMA type with its first valid value
        const availableKDMAs = Object.keys(validKDMAs).sort();
        if (availableKDMAs.length > 0) {
          const firstKDMAType = availableKDMAs[0];
          const validValuesForKDMA = validKDMAs[firstKDMAType] || [];
          const firstValidValue = validValuesForKDMA.length > 0 ? validValuesForKDMA[0] : 0.5;
          addKDMASelector(firstKDMAType, firstValidValue);
        }
      }
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
      runDisplay.innerHTML =
        "<p>Please select a specific scenario first.</p>";
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
        
        runDisplay.innerHTML = formatResults();
        
        // Update scores and timing in parameters section
        updateScoresTimingSection(scoreItem, timingData);
      } catch (error) {
        console.error("Error fetching experiment data:", error);
        runDisplay.innerHTML =
          "<p>Error loading data for selected parameters and scenario.</p>";
      }
    } else {
      // Generate debug information to help identify the issue
      const availableKeys = Object.keys(experiments).filter(key => 
        key.startsWith(`${selectedKey.split('_')[0]}_${selectedKey.split('_')[1]}_`)
      );
      
      runDisplay.innerHTML = `
        <p>No data found for the selected parameters and scenario.</p>
        <p><strong>Looking for:</strong> ${selectedKey}</p>
        <p><strong>Scenario:</strong> ${appState.selectedScenario}</p>
        <p><strong>Available keys for this ADM/LLM:</strong></p>
        <ul>${availableKeys.length > 0 ? availableKeys.map(key => `<li>${key}</li>`).join('') : '<li>None found</li>'}</ul>
        <p>Please ensure KDMA values match the available experiment data.</p>
      `;
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

  // Initial manifest fetch on page load
  fetchManifest();
});
