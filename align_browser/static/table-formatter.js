// Table formatting functions for displaying experiment data

// HTML Templates
const HTML_NA_SPAN = '<span class="na-value">N/A</span>';

// Utility function to escape HTML
export function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Create expandable content showing only first N lines
export function createExpandableContentWithLines(value, id, maxLines = 3) {
  // Check if this is available from the main app context
  const expandableStates = window.expandableStates || { text: new Map(), objects: new Map() };
  
  const isExpanded = expandableStates.text.get(id) || false;
  const lines = value.split('\n');
  const preview = lines.slice(0, maxLines).join('\n');
  const needsExpansion = lines.length > maxLines;
  
  // If it doesn't need expansion, just return the content with proper formatting
  if (!needsExpansion) {
    return `<span style="white-space: pre-wrap;">${escapeHtml(value)}</span>`;
  }
  
  const shortDisplay = isExpanded ? 'none' : 'inline';
  const fullDisplay = isExpanded ? 'inline' : 'none';
  const buttonText = isExpanded ? 'Show Less' : 'Show More';

  return `<div class="expandable-text" data-full-text="${escapeHtml(value)}" data-param-id="${id}">
    <span id="${id}_short" style="display: ${shortDisplay}; white-space: pre-wrap;">${escapeHtml(preview)}${needsExpansion ? '...' : ''}</span>
    <span id="${id}_full" style="display: ${fullDisplay}; white-space: pre-wrap;">${escapeHtml(value)}</span>
    <button class="show-more-btn" onclick="toggleText('${id}')">${buttonText}</button>
  </div>`;
}

// Create expandable content for long text or objects
export function createExpandableContent(value, id, isLongText = false) {
  const TEXT_PREVIEW_LENGTH = 800;
  
  // Check if this is available from the main app context
  const expandableStates = window.expandableStates || { text: new Map(), objects: new Map() };
  
  const isExpanded = expandableStates[isLongText ? 'text' : 'objects'].get(id) || false;
  const content = isLongText ? value : JSON.stringify(value, null, 2);
  const preview = isLongText ? `${value.substring(0, TEXT_PREVIEW_LENGTH)}...` : getObjectPreview(value);
  
  const shortDisplay = isExpanded ? 'none' : (isLongText ? 'inline' : 'inline');
  const fullDisplay = isExpanded ? (isLongText ? 'inline' : 'block') : 'none';
  const buttonText = isExpanded ? (isLongText ? 'Show Less' : 'Show Preview') : (isLongText ? 'Show More' : 'Show Details');
  const toggleFunction = isLongText ? 'toggleText' : 'toggleObject';
  const shortTag = isLongText ? 'span' : 'span';
  const fullTag = isLongText ? 'span' : 'pre';

  return `<div class="${isLongText ? 'expandable-text' : 'object-display'}" ${isLongText ? `data-full-text="${escapeHtml(content)}"` : ''} data-param-id="${id}">
    <${shortTag} id="${id}_${isLongText ? 'short' : 'preview'}" style="display: ${shortDisplay};">${escapeHtml(preview)}</${shortTag}>
    <${fullTag} id="${id}_full" style="display: ${fullDisplay};">${escapeHtml(content)}</${fullTag}>
    <button class="show-more-btn" onclick="${toggleFunction}('${id}')">${buttonText}</button>
  </div>`;
}

// Helper function to get object preview
export function getObjectPreview(obj) {
  if (!obj) return 'N/A';
  const keys = Object.keys(obj);
  if (keys.length === 0) return '{}';
  if (keys.length === 1) {
    return `${keys[0]}: ${obj[keys[0]]}`;
  }
  return `{${keys.slice(0, 3).join(', ')}${keys.length > 3 ? '...' : ''}}`;
}

// Create summary text for choice_info sections
export function createChoiceInfoSummary(key, value) {
  switch (key) {
    case 'predicted_kdma_values':
      const choiceCount = Object.keys(value).length;
      const kdmaTypes = new Set();
      Object.values(value).forEach(choiceKdmas => {
        Object.keys(choiceKdmas).forEach(kdma => kdmaTypes.add(kdma));
      });
      return `${choiceCount} choices with ${kdmaTypes.size} KDMA type(s)`;
    
    case 'icl_example_responses':
      const kdmaCount = Object.keys(value).length;
      let totalExamples = 0;
      Object.values(value).forEach(examples => {
        if (Array.isArray(examples)) {
          totalExamples += examples.length;
        }
      });
      return `${kdmaCount} KDMA(s) with ${totalExamples} example(s)`;
    
    default:
      if (typeof value === 'object') {
        const keys = Object.keys(value);
        return `Object with ${keys.length} key(s): ${keys.slice(0, 3).join(', ')}${keys.length > 3 ? '...' : ''}`;
      }
      return value.toString().substring(0, 50) + (value.toString().length > 50 ? '...' : '');
  }
}

// Create detailed content for choice_info sections
export function createChoiceInfoDetails(key, value, runId = '') {
  let html = '';
  
  switch (key) {
    case 'predicted_kdma_values':
      Object.entries(value).forEach(([choiceName, kdmaValues]) => {
        html += `<div class="choice-kdma-prediction">
          <div class="choice-name">${escapeHtml(choiceName)}</div>
          <div class="kdma-predictions">`;
        
        Object.entries(kdmaValues).forEach(([kdmaName, values]) => {
          const valueList = Array.isArray(values) ? values : [values];
          html += `<div class="kdma-prediction-item">
            <span class="kdma-name">${escapeHtml(kdmaName)}:</span>
            <span class="kdma-values">[${valueList.map(v => v.toFixed(2)).join(', ')}]</span>
          </div>`;
        });
        
        html += `</div></div>`;
      });
      break;
    
    case 'icl_example_responses':
      Object.entries(value).forEach(([kdmaName, examples]) => {
        html += `<div class="icl-kdma-section">
          <h5 class="icl-kdma-name">${escapeHtml(kdmaName)}</h5>`;
        
        if (Array.isArray(examples)) {
          examples.forEach((example, index) => {
            html += `<div class="icl-example">
              <div class="icl-example-header">Example ${index + 1}</div>`;
            
            if (example.prompt) {
              // Process the prompt text to handle escaped characters and newlines
              const processedPrompt = example.prompt
                .replace(/\\n/g, '\n')
                .replace(/\\"/g, '"')
                .replace(/\\'/g, "'")
                .replace(/\\\\/g, '\\')
                .trim(); // Remove leading/trailing whitespace
              
              const promptId = `icl_prompt_${runId}_${kdmaName}_${index}`;
              html += `<div class="icl-prompt">
                <strong>Prompt:</strong> ${createExpandableContentWithLines(processedPrompt, promptId, 3)}
              </div>`;
            }
            
            if (example.response) {
              html += `<div class="icl-response">
                <strong>Response:</strong>
                <div class="icl-response-content">`;
              
              Object.entries(example.response).forEach(([choiceName, responseData]) => {
                html += `<div class="icl-choice-response">
                  <div class="icl-choice-name">${escapeHtml(choiceName)}</div>
                  <div class="icl-choice-details">
                    <div class="icl-score">Score: ${responseData.score}</div>
                    <div class="icl-reasoning">${escapeHtml(responseData.reasoning || 'No reasoning provided')}</div>
                  </div>
                </div>`;
              });
              
              html += `</div></div>`;
            }
            
            html += `</div>`;
          });
        }
        
        html += `</div>`;
      });
      break;
    
    default:
      if (typeof value === 'object') {
        const objectId = `choice_info_generic_${runId}_${key}`;
        html += createExpandableContent(value, objectId, false);
      } else {
        html += escapeHtml(value.toString());
      }
  }
  
  return html;
}

// Format choice_info object for display with expandable sections
export function formatChoiceInfoValue(choiceInfo, runId = '') {
  if (!choiceInfo || typeof choiceInfo !== 'object') {
    return HTML_NA_SPAN;
  }
  
  const keys = Object.keys(choiceInfo);
  if (keys.length === 0) {
    return HTML_NA_SPAN;
  }
  
  let html = '<div class="choice-info-display">';
  
  // Create expandable section for each top-level key
  keys.forEach(key => {
    const value = choiceInfo[key];
    const summary = createChoiceInfoSummary(key, value);
    const details = createChoiceInfoDetails(key, value, runId);
    const sectionId = `choice_info_section_${runId}_${key}`;
    
    // Determine section class based on key type
    let sectionClass = 'choice-info-generic-section';
    if (key === 'predicted_kdma_values') {
      sectionClass = 'predicted-kdma-section';
    } else if (key === 'icl_example_responses') {
      sectionClass = 'icl-examples-section';
    }
    
    html += `<div class="${sectionClass}">
      <div class="choice-info-section-header">
        <h4 class="choice-info-header">${escapeHtml(key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()).replace(/\bIcl\b/g, 'ICL'))}</h4>
        <span id="${sectionId}_summary" class="choice-info-summary">${summary}</span>
        <button class="show-more-btn choice-info-toggle" onclick="toggleChoiceInfoSection('${sectionId}')" id="${sectionId}_button">Show Details</button>
      </div>
      <div id="${sectionId}_details" class="choice-info-details" style="display: none;">
        ${details}
      </div>
    </div>`;
  });
  
  html += '</div>';
  return html;
}

// Toggle function for choice_info sections
function toggleChoiceInfoSection(sectionId) {
  const summarySpan = document.getElementById(`${sectionId}_summary`);
  const detailsDiv = document.getElementById(`${sectionId}_details`);
  const button = document.getElementById(`${sectionId}_button`);
  
  const isCurrentlyExpanded = detailsDiv.style.display !== 'none';
  const newExpanded = !isCurrentlyExpanded;
  
  if (newExpanded) {
    summarySpan.style.display = 'none';
    detailsDiv.style.display = 'block';
    button.textContent = 'Show Less';
  } else {
    summarySpan.style.display = 'inline';
    detailsDiv.style.display = 'none';
    button.textContent = 'Show Details';
  }
  
  // Save state for persistence (access global expandableStates if available)
  if (window.expandableStates && window.expandableStates.objects) {
    window.expandableStates.objects.set(sectionId, newExpanded);
  }
}


// Make toggle function globally available for onclick handlers
window.toggleChoiceInfoSection = toggleChoiceInfoSection;