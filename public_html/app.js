// DOM Elements
const lookupForm = document.getElementById('lookupForm');
const ipInput = document.getElementById('ipInput');
const lookupBtn = document.getElementById('lookupBtn');
const progressBar = document.getElementById('progressBar');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const resultsSection = document.getElementById('resultsSection');
const resultsContainer = document.getElementById('resultsContainer');
const errorMessage = document.getElementById('errorMessage');
const rblCount = document.getElementById('rblCount');

// Summary counts
const listedCount = document.getElementById('listedCount');
const notListedCount = document.getElementById('notListedCount');
const errorCountEl = document.getElementById('errorCount');
const totalCount = document.getElementById('totalCount');

// State
let currentFilter = 'all';
let allResults = [];

// Initialize
init();

async function init() {
    // Load RBL server count
    try {
        const response = await fetch('/api/rbl-servers');
        const data = await response.json();
        if (data.success) {
            rblCount.textContent = data.servers.length;
        }
    } catch (error) {
        console.error('Failed to load RBL servers:', error);
        rblCount.textContent = 'Error';
    }

    // Set up form handler
    lookupForm.addEventListener('submit', handleLookup);

    // Set up filter tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            currentFilter = e.target.dataset.filter;
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            filterResults();
        });
    });

    // Check for IP parameter in URL and trigger automatic lookup
    const urlParams = new URLSearchParams(window.location.search);
    const ipParam = urlParams.get('ip');
    if (ipParam) {
        ipInput.value = ipParam;
        // Trigger the lookup after a short delay to ensure DOM is ready
        setTimeout(() => {
            lookupForm.dispatchEvent(new Event('submit'));
        }, 100);
    }
}

async function handleLookup(e) {
    e.preventDefault();

    const ip = ipInput.value.trim();
    if (!ip) return;

    // Reset UI
    hideError();
    resultsSection.classList.remove('hidden');
    resultsContainer.innerHTML = '';
    progressBar.classList.remove('hidden');
    lookupBtn.disabled = true;
    lookupBtn.textContent = 'Looking up...';
    allResults = [];
    currentFilter = 'all';
    document.querySelector('.tab-btn[data-filter="all"]').click();

    // Reset summary counts
    listedCount.textContent = '0';
    notListedCount.textContent = '0';
    errorCountEl.textContent = '0';
    totalCount.textContent = '0';

    try {
        // Use Server-Sent Events for real-time updates
        const response = await fetch('/api/lookup-stream', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ ip })
        });

        if (!response.ok) {
            const data = await response.json();
            showError(data.error || 'Lookup failed');
            return;
        }

        // Read the stream
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();

            if (done) break;

            // Decode the chunk and add to buffer
            buffer += decoder.decode(value, { stream: true });

            // Process complete messages (separated by \n\n)
            const messages = buffer.split('\n\n');
            buffer = messages.pop(); // Keep incomplete message in buffer

            for (const message of messages) {
                if (!message.trim() || !message.startsWith('data: ')) continue;

                const jsonData = message.substring(6); // Remove 'data: ' prefix

                try {
                    const event = JSON.parse(jsonData);

                    if (event.type === 'result') {
                        // Add result to list
                        allResults.push(event.result);

                        // Update progress
                        updateProgress(event.progress.current, event.progress.total);

                        // Update summary counts
                        const listed = allResults.filter(r => r.listed === true).length;
                        const notListed = allResults.filter(r => r.listed === false && !r.error).length;
                        const errors = allResults.filter(r => r.error).length;

                        listedCount.textContent = listed;
                        notListedCount.textContent = notListed;
                        errorCountEl.textContent = errors;
                        totalCount.textContent = allResults.length;

                        // Add result to DOM if it matches current filter
                        if (shouldShowResult(event.result)) {
                            const item = createResultItem(event.result);
                            resultsContainer.appendChild(item);
                        }
                    } else if (event.type === 'complete') {
                        // Lookup complete
                        progressFill.style.width = '100%';
                        progressText.textContent = '100%';
                    } else if (event.type === 'error') {
                        showError(event.error);
                    }
                } catch (parseError) {
                    console.error('Failed to parse SSE message:', parseError);
                }
            }
        }
    } catch (error) {
        showError('Network error: ' + error.message);
    } finally {
        setTimeout(() => {
            progressBar.classList.add('hidden');
            progressFill.style.width = '0%';
            progressText.textContent = '0%';
        }, 500);
        lookupBtn.disabled = false;
        lookupBtn.textContent = 'Lookup';
    }
}

function shouldShowResult(result) {
    if (currentFilter === 'all') return true;
    if (currentFilter === 'listed') return result.listed === true;
    if (currentFilter === 'clean') return result.listed === false && !result.error;
    if (currentFilter === 'error') return result.error !== null;
    return true;
}

function displayResults(data) {
    // Update summary cards
    listedCount.textContent = data.listedCount;
    notListedCount.textContent = data.notListedCount;
    errorCountEl.textContent = data.errorCount;
    totalCount.textContent = data.totalChecked;

    // Display results
    resultsSection.classList.remove('hidden');
    filterResults();

    // Animate progress to 100%
    progressFill.style.width = '100%';
    progressText.textContent = '100%';
}

function filterResults() {
    resultsContainer.innerHTML = '';

    const filtered = allResults.filter(result => {
        if (currentFilter === 'all') return true;
        if (currentFilter === 'listed') return result.listed === true;
        if (currentFilter === 'clean') return result.listed === false;
        if (currentFilter === 'error') return result.error !== null;
        return true;
    });

    if (filtered.length === 0) {
        resultsContainer.innerHTML = '<p style="text-align: center; color: var(--text-secondary); padding: 2rem;">No results match this filter.</p>';
        return;
    }

    filtered.forEach(result => {
        const item = createResultItem(result);
        resultsContainer.appendChild(item);
    });
}

function createResultItem(result) {
    const div = document.createElement('div');
    div.className = 'result-item';

    // Determine status class
    let statusClass = 'clean';
    let statusIcon = '✓';
    let statusText = 'Clean';

    if (result.error) {
        statusClass = 'error';
        statusIcon = '!';
        statusText = 'Error';
    } else if (result.listed) {
        statusClass = 'listed';
        statusIcon = '✗';
        statusText = 'Listed';
    }

    div.classList.add(statusClass);

    div.innerHTML = `
        <div class="result-status" title="${statusText}">
            ${statusIcon}
        </div>
        <div class="result-info">
            <div class="result-name">
                ${escapeHtml(result.name)}
                ${result.customRbl ? '<span style="background: #4a90e2; color: white; font-size: 0.7em; padding: 2px 6px; border-radius: 3px; margin-left: 6px;">CUSTOM</span>' : ''}
            </div>
            <div class="result-host">${escapeHtml(result.host)}</div>
            <div class="result-description">${escapeHtml(result.description)}</div>
            ${result.error ? `<div class="result-description" style="color: var(--danger-color);">Error: ${escapeHtml(result.error)}</div>` : ''}
            ${result.response ? `<div class="result-description">Response: ${escapeHtml(result.response)}</div>` : ''}
            ${result.reason ? `<div class="result-description" style="color: #e74c3c; font-weight: 500;">Reason: ${escapeHtml(result.reason)}</div>` : ''}
        </div>
        <div class="result-meta">
            <div class="result-time">${result.responseTime}ms</div>
        </div>
    `;

    return div;
}

function showError(message) {
    errorMessage.textContent = message;
    errorMessage.classList.remove('hidden');
}

function hideError() {
    errorMessage.classList.add('hidden');
    errorMessage.textContent = '';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Update progress during lookup
function updateProgress(current, total) {
    const percentage = Math.round((current / total) * 100);
    progressFill.style.width = percentage + '%';
    progressText.textContent = percentage + '%';
}
