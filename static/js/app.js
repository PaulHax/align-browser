// Client-side application logic for ADM Results Visualization

document.addEventListener('DOMContentLoaded', () => {
    const admTypeSelection = document.getElementById('adm-type-selection');
    const kdmaSliders = document.getElementById('kdma-sliders');
    const llmSelection = document.getElementById('llm-selection');
    const scenarioSelection = document.getElementById('scenario-selection'); // New element
    const resultsDisplay = document.getElementById('results-display');

    let manifest = {};
    let availableAdmTypes = new Set();
    let availableKDMAs = new Set(); // Stores KDMA types like 'affiliation', 'merit'
    let availableLLMs = new Set();
    let validCombinations = {}; // Stores hierarchical valid combinations

    // Function to fetch and parse manifest.json
    async function fetchManifest() {
        try {
            const response = await fetch('/manifest.json');
            manifest = await response.json();
            console.log('Manifest loaded:', manifest);
            extractParametersFromManifest();
            populateUIControls();
            loadResults(); // Load results initially
        } catch (error) {
            console.error('Error fetching manifest:', error);
            resultsDisplay.innerHTML = '<p>Error loading experiment data. Please ensure the data is built correctly.</p>';
        }
    }

    // Extract unique parameters and build validCombinations structure
    function extractParametersFromManifest() {
        availableAdmTypes.clear();
        availableKDMAs.clear();
        availableLLMs.clear();
        validCombinations = {};

        for (const key in manifest) {
            const config = manifest[key].config;
            if (!config) continue;

            const admType = config.adm ? config.adm.name : 'unknown_adm';
            const llmBackbone = (config.adm && config.adm.structured_inference_engine && config.adm.structured_inference_engine.model_name)
                ? config.adm.structured_inference_engine.model_name
                : 'no_llm';

            availableAdmTypes.add(admType);
            availableLLMs.add(llmBackbone);

            if (!validCombinations[admType]) {
                validCombinations[admType] = {};
            }
            if (!validCombinations[admType][llmBackbone]) {
                validCombinations[admType][llmBackbone] = {};
            }

            if (config.alignment_target && config.alignment_target.kdma_values) {
                config.alignment_target.kdma_values.forEach(kdma_entry => {
                    const kdma = kdma_entry.kdma;
                    const value = kdma_entry.value;
                    availableKDMAs.add(kdma); // Add KDMA type

                    if (!validCombinations[admType][llmBackbone][kdma]) {
                        validCombinations[admType][llmBackbone][kdma] = new Set();
                    }
                    validCombinations[admType][llmBackbone][kdma].add(value);
                });
            }
        }

        // Convert Sets to sorted Arrays for easier use in UI
        availableAdmTypes = Array.from(availableAdmTypes).sort();
        availableKDMAs = Array.from(availableKDMAs).sort();
        // Fix: Convert availableLLMs to an array here for consistent .includes() usage
        availableLLMs = Array.from(availableLLMs).sort();

        // Convert inner Sets to sorted Arrays
        for (const adm in validCombinations) {
            for (const llm in validCombinations[adm]) {
                for (const kdma in validCombinations[adm][llm]) {
                    validCombinations[adm][llm][kdma] = Array.from(validCombinations[adm][llm][kdma]).sort((a, b) => a - b);
                }
            }
        }

        console.log('Valid Combinations (structured):', validCombinations);
    }

    function populateUIControls() {
        // ADM Type Selection
        admTypeSelection.innerHTML = '<h3>ADM Type</h3>';
        const admSelect = document.createElement('select');
        admSelect.id = 'adm-type-select';
        admTypeSelection.appendChild(admSelect);
        admSelect.addEventListener('change', () => { updateLLMDropdown(); loadResults(); });

        // LLM Backbone Selection
        llmSelection.innerHTML = '<h3>LLM Backbone</h3>';
        const llmSelect = document.createElement('select');
        llmSelect.id = 'llm-select';
        llmSelection.appendChild(llmSelect);
        llmSelect.addEventListener('change', () => { updateKDMASliders(); loadResults(); });

        // KDMA Sliders container
        kdmaSliders.innerHTML = '<h3>KDMA Values</h3>';
        // Initial population of KDMA sliders (all types, will be updated by updateKDMASliders)
        Array.from(availableKDMAs).sort().forEach(kdma => {
            const div = document.createElement('div');
            div.className = 'kdma-slider-group';
            div.innerHTML = `
                <label for="${kdma}-slider">${kdma}:</label>
                <input type="range" id="${kdma}-slider" min="0" max="1" step="0.1" value="0.5">
                <span id="${kdma}-value">0.5</span>
            `;
            kdmaSliders.appendChild(div);

            const slider = div.querySelector(`#${kdma}-slider`);
            const valueSpan = div.querySelector(`#${kdma}-value`);
            slider.addEventListener('input', () => {
                valueSpan.textContent = parseFloat(slider.value).toFixed(1); // Ensure 0.0, 1.0 format
                loadResults(); // Load results on slider change
            });
        });

        // Scenario Selection (New)
        scenarioSelection.innerHTML = '<h3>Scenario</h3>';
        const scenarioSelect = document.createElement('select');
        scenarioSelect.id = 'scenario-select';
        scenarioSelection.appendChild(scenarioSelect);
        scenarioSelect.addEventListener('change', loadResults);

        // Initial population of dropdowns and sliders
        updateADMDropdown();
        updateLLMDropdown(); // This will also call updateKDMASliders
    }

    function updateADMDropdown() {
        const admSelect = document.getElementById('adm-type-select');
        admSelect.innerHTML = ''; // Clear existing options

        Array.from(availableAdmTypes).sort().forEach(type => {
            const option = document.createElement('option');
            option.value = type;
            option.textContent = type;
            admSelect.appendChild(option);
        });
    }

    function updateLLMDropdown() {
        const selectedAdm = document.getElementById('adm-type-select').value;
        const llmSelect = document.getElementById('llm-select');
        llmSelect.innerHTML = ''; // Clear existing options

        const validLLMsForAdm = validCombinations[selectedAdm] ? Object.keys(validCombinations[selectedAdm]).sort() : [];

        // Use .includes() directly on the array availableLLMs
        if (availableLLMs.includes('no_llm') && !validLLMsForAdm.includes('no_llm')) {
            validLLMsForAdm.unshift('no_llm'); // Add to the beginning if not already there
        }

        validLLMsForAdm.forEach(llm => {
            const option = document.createElement('option');
            option.value = llm;
            option.textContent = llm;
            llmSelect.appendChild(option);
        });

        // Set default selected LLM if 'no_llm' is available, otherwise first valid
        if (validLLMsForAdm.includes('no_llm')) {
            llmSelect.value = 'no_llm';
        } else if (validLLMsForAdm.length > 0) {
            llmSelect.value = validLLMsForAdm[0];
        }

        // Disable LLM select if no valid LLMs other than 'no_llm' are available for the selected ADM
        if (validLLMsForAdm.length === 0 || (validLLMsForAdm.length === 1 && validLLMsForAdm[0] === 'no_llm')) {
            llmSelect.disabled = true;
        } else {
            llmSelect.disabled = false;
        }

        updateKDMASliders();
    }

    function updateKDMASliders() {
        const selectedAdm = document.getElementById('adm-type-select').value;
        const selectedLLM = document.getElementById('llm-select').value;

        // Get all KDMA slider elements
        const allKdmaSliders = document.querySelectorAll('.kdma-slider-group');

        allKdmaSliders.forEach(group => {
            const slider = group.querySelector('input[type="range"]');
            const valueSpan = group.querySelector('span');
            const kdmaType = slider.id.replace('-slider', '');

            const validValuesForThisKDMA = validCombinations[selectedAdm] &&
                                           validCombinations[selectedAdm][selectedLLM] &&
                                           validCombinations[selectedAdm][selectedLLM][kdmaType]
                                           ? validCombinations[selectedAdm][selectedLLM][kdmaType]
                                           : [];

            if (validValuesForThisKDMA.length > 0) {
                group.style.display = 'block'; // Show the slider group
                slider.disabled = false;
                // If the current value is not valid, snap to the closest valid one or default
                let currentValue = parseFloat(slider.value);
                if (!validValuesForThisKDMA.includes(currentValue)) {
                    // Find the closest valid value
                    const closest = validValuesForThisKDMA.reduce((prev, curr) =>
                        (Math.abs(curr - currentValue) < Math.abs(prev - currentValue) ? curr : prev)
                    );
                    slider.value = closest;
                    valueSpan.textContent = closest.toFixed(1);
                }
            } else {
                group.style.display = 'none'; // Hide the slider group if no valid values
                slider.disabled = true;
            }
        });
        updateScenarioDropdown(); // Call this after KDMA sliders are updated
    }

    function updateScenarioDropdown() {
        const selectedAdm = document.getElementById('adm-type-select').value;
        const selectedLLM = document.getElementById('llm-select').value;
        const scenarioSelect = document.getElementById('scenario-select');
        scenarioSelect.innerHTML = ''; // Clear existing options

        const selectedKey = getSelectedKey(); // Get the key for the current ADM/LLM/KDMA combination
        const scenariosForCombination = manifest[selectedKey] ? Object.keys(manifest[selectedKey].scenarios).sort() : [];

        if (scenariosForCombination.length > 0) {
            scenarioSelect.disabled = false;
            scenariosForCombination.forEach(scenarioId => {
                const option = document.createElement('option');
                option.value = scenarioId;
                option.textContent = scenarioId;
                scenarioSelect.appendChild(option);
            });
        } else {
            scenarioSelect.disabled = true;
            const option = document.createElement('option');
            option.value = '';
            option.textContent = 'No scenarios available';
            scenarioSelect.appendChild(option);
        }
    }

    // Function to construct the key based on current UI selections
    function getSelectedKey() {
        const admType = document.getElementById('adm-type-select').value;
        const llmBackbone = document.getElementById('llm-select').value;

        const kdmaParts = [];
        // Iterate over all KDMA types that are currently displayed/enabled
        document.querySelectorAll('.kdma-slider-group').forEach(group => {
            if (group.style.display !== 'none') { // Only consider visible sliders
                const slider = group.querySelector('input[type="range"]');
                const kdma = slider.id.replace('-slider', '');
                const value = parseFloat(slider.value).toFixed(1); // Ensure consistent format
                kdmaParts.push(`${kdma}-${value}`);
            }
        });
        // Sort KDMA parts to match the key generation in build.py
        const kdmaString = kdmaParts.sort().join('_');

        return `${admType}_${llmBackbone}_${kdmaString}`;
    }

    // Function to load and display results
    async function loadResults() {
        const selectedKey = getSelectedKey();
        const selectedScenario = document.getElementById('scenario-select').value;
        console.log('Attempting to load:', selectedKey, 'Scenario:', selectedScenario);

        if (manifest[selectedKey] && manifest[selectedKey].scenarios[selectedScenario]) {
            const dataPaths = manifest[selectedKey].scenarios[selectedScenario];
            try {
                const inputOutput = await (await fetch(dataPaths.input_output)).json();
                const scores = await (await fetch(dataPaths.scores)).json();
                const timing = await (await fetch(dataPaths.timing)).json();

                resultsDisplay.innerHTML = `
                    <h3>Results for ${selectedKey} - Scenario: ${selectedScenario}</h3>
                    <h4>Input/Output:</h4>
                    <pre>${JSON.stringify(inputOutput, null, 2)}</pre>
                    <h4>Scores:</h4>
                    <pre>${JSON.stringify(scores, null, 2)}</pre>
                    <h4>Timing:</h4>
                    <pre>${JSON.stringify(timing, null, 2)}</pre>
                `;
            } catch (error) {
                console.error('Error fetching experiment data:', error);
                resultsDisplay.innerHTML = '<p>Error loading data for selected parameters and scenario.</p>';
            }
        } else {
            resultsDisplay.innerHTML = '<p>No data found for the selected parameters and scenario. Adjust sliders or dropdowns.</p>';
        }
    }

    // Initial manifest fetch on page load
    fetchManifest();
});