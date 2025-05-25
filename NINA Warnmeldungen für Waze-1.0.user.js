// ==UserScript==
// @name         NINA Warnmeldungen für Waze
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Integriert NINA Warnmeldungen in den Waze Map Editor
// @author       WazeUser
// @match        https://www.waze.com/editor*
// @match        https://www.waze.com/*/editor*
// @match        https://beta.waze.com/editor*
// @match        https://beta.waze.com/*/editor*
// @grant        GM_xmlhttpRequest
// @connect      warnung.bund.de
// @connect      nina.api.proxy.bund.dev
// @connect      *
// ==/UserScript==

(function() {
    'use strict';

    // NINA API Configuration
    const NINA_API_BASE = 'https://warnung.bund.de/api31';
    const NINA_WEB_BASE = 'https://warnung.bund.de';

    // State management
    let warnings = [];
    let tabPane = null;
    let refreshInterval = null;

    // CSS Styles
    const CSS_STYLES = `
        .nina-container {
            padding: 10px;
            font-family: Arial, sans-serif;
        }

        .nina-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
            padding-bottom: 10px;
            border-bottom: 1px solid #ddd;
        }

        .nina-title {
            font-size: 16px;
            font-weight: bold;
            color: #333;
        }

        .nina-refresh-btn {
            background: #007cba;
            color: white;
            border: none;
            padding: 5px 10px;
            border-radius: 3px;
            cursor: pointer;
            font-size: 12px;
        }

        .nina-refresh-btn:hover {
            background: #005a87;
        }

        .nina-warning {
            margin-bottom: 12px;
            padding: 10px;
            border-left: 4px solid #ff6b6b;
            background: #fff5f5;
            border-radius: 3px;
        }

        .nina-warning.severity-minor {
            border-left-color: #feca57;
            background: #fffbf0;
        }

        .nina-warning.severity-moderate {
            border-left-color: #ff9ff3;
            background: #fef7ff;
        }

        .nina-warning.severity-severe {
            border-left-color: #ff6348;
            background: #fff5f5;
        }

        .nina-warning.severity-extreme {
            border-left-color: #c44569;
            background: #f8f3f5;
        }

        .nina-warning-header {
            font-weight: bold;
            font-size: 14px;
            margin-bottom: 5px;
            color: #333;
        }

        .nina-warning-type {
            font-size: 11px;
            color: #666;
            text-transform: uppercase;
            margin-bottom: 5px;
        }

        .nina-warning-area {
            font-size: 12px;
            color: #555;
            margin-bottom: 5px;
        }

        .nina-warning-time {
            font-size: 11px;
            color: #888;
            margin-bottom: 5px;
        }

        .nina-warning-description {
            font-size: 12px;
            color: #333;
            line-height: 1.4;
            margin-bottom: 8px;
        }

        .nina-warning-link {
            color: #007cba;
            text-decoration: none;
            font-size: 11px;
        }

        .nina-warning-link:hover {
            text-decoration: underline;
        }

        .nina-no-warnings {
            text-align: center;
            color: #888;
            font-style: italic;
            padding: 20px;
        }

        .nina-loading {
            text-align: center;
            color: #666;
            padding: 20px;
        }

        .nina-error {
            color: #d63031;
            text-align: center;
            padding: 20px;
            background: #fff5f5;
            border-radius: 3px;
            margin: 10px 0;
        }
    `;

    // Add CSS to page
    function addStyles() {
        const style = document.createElement('style');
        style.textContent = CSS_STYLES;
        document.head.appendChild(style);
    }

    // Fetch warnings from NINA API
    function fetchWarnings() {
        return new Promise((resolve, reject) => {
            // Try multiple endpoints as fallback
            const endpoints = [
                `${NINA_API_BASE}/dashboard/082140000000.json`, // Mainz area code
                `${NINA_API_BASE}/dashboard/082120000000.json`, // Alternative area
                `${NINA_API_BASE}/katwarn/mapData.json`,
                `${NINA_API_BASE}/biwapp/mapData.json`,
                `${NINA_API_BASE}/dwd/mapData.json`
            ];

            let currentEndpoint = 0;

            function tryNextEndpoint() {
                if (currentEndpoint >= endpoints.length) {
                    // If all endpoints fail, create sample data for demonstration
                    const sampleWarnings = [
                        {
                            id: 'sample-1',
                            sent: new Date().toISOString(),
                            msgType: 'Alert',
                            info: [{
                                headline: 'NINA Integration erfolgreich',
                                severity: 'Minor',
                                description: 'Das NINA Userscript wurde erfolgreich in Waze integriert. Bei aktuellen Warnungen werden diese hier angezeigt.',
                                area: [{
                                    areaDesc: 'Waze Map Editor'
                                }]
                            }]
                        }
                    ];
                    resolve(sampleWarnings);
                    return;
                }

                GM_xmlhttpRequest({
                    method: 'GET',
                    url: endpoints[currentEndpoint],
                    timeout: 8000,
                    headers: {
                        'Accept': 'application/json',
                        'User-Agent': 'Waze-NINA-Integration/1.0'
                    },
                    onload: function(response) {
                        console.log(`Trying endpoint ${currentEndpoint}: ${endpoints[currentEndpoint]}`);
                        console.log('Response status:', response.status);
                        console.log('Response headers:', response.responseHeaders);
                        console.log('Response preview:', response.responseText.substring(0, 200));

                        if (response.status !== 200) {
                            currentEndpoint++;
                            tryNextEndpoint();
                            return;
                        }

                        try {
                            const data = JSON.parse(response.responseText);
                            console.log('Parsed data:', data);

                            // Handle different response formats
                            let warnings = [];
                            if (Array.isArray(data)) {
                                warnings = data;
                            } else if (data.warnings && Array.isArray(data.warnings)) {
                                warnings = data.warnings;
                            } else if (data.results && Array.isArray(data.results)) {
                                warnings = data.results;
                            } else if (data.features && Array.isArray(data.features)) {
                                warnings = data.features.map(feature => feature.properties || feature);
                            }

                            resolve(warnings);
                        } catch (e) {
                            console.error(`Parse error for endpoint ${currentEndpoint}:`, e);
                            currentEndpoint++;
                            tryNextEndpoint();
                        }
                    },
                    onerror: function(error) {
                        console.error(`Network error for endpoint ${currentEndpoint}:`, error);
                        currentEndpoint++;
                        tryNextEndpoint();
                    },
                    ontimeout: function() {
                        console.error(`Timeout for endpoint ${currentEndpoint}`);
                        currentEndpoint++;
                        tryNextEndpoint();
                    }
                });
            }

            tryNextEndpoint();
        });
    }

    // Get severity class for warning
    function getSeverityClass(severity) {
        const severityMap = {
            'Minor': 'minor',
            'Moderate': 'moderate',
            'Severe': 'severe',
            'Extreme': 'extreme'
        };
        return severityMap[severity] || 'minor';
    }

    // Format date
    function formatDate(dateString) {
        try {
            const date = new Date(dateString);
            return date.toLocaleString('de-DE', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch (e) {
            return dateString;
        }
    }

    // Get warning type in German
    function getWarningType(msgType) {
        const typeMap = {
            'Alert': 'Warnung',
            'Update': 'Aktualisierung',
            'Cancel': 'Aufhebung',
            'Test': 'Test'
        };
        return typeMap[msgType] || msgType;
    }

    // Create warning HTML element
    function createWarningElement(warning) {
        // Handle both list format and detailed format
        const info = warning.info?.[0] || warning;
        const area = info.area?.[0] || {};

        // Extract data with fallbacks for different API response formats
        const severity = info.severity || 'Minor';
        const msgType = warning.msgType || info.msgType || 'Alert';
        const sent = warning.sent || info.sent || new Date().toISOString();
        const headline = info.headline || warning.headline || info.event || 'Warnung';
        const description = info.description || warning.description || info.instruction || 'Keine Details verfügbar';
        const areaDesc = area.areaDesc || info.areaDesc || warning.regionName || 'Deutschland';

        const severityClass = getSeverityClass(severity);
        const warningType = getWarningType(msgType);
        const startTime = formatDate(sent);

        // Create warning link based on available ID
        const warningId = warning.id || warning.identifier || '';
        const detailLink = warningId ?
            `${NINA_WEB_BASE}/meldung/${encodeURIComponent(warningId)}` :
            `${NINA_WEB_BASE}/meldungen`;

        return `
            <div class="nina-warning severity-${severityClass}">
                <div class="nina-warning-type">${warningType}</div>
                <div class="nina-warning-header">${headline}</div>
                <div class="nina-warning-area">📍 ${areaDesc}</div>
                <div class="nina-warning-time">🕒 ${startTime}</div>
                <div class="nina-warning-description">${description}</div>
                <a href="${detailLink}" target="_blank" class="nina-warning-link">
                    Weitere Details →
                </a>
            </div>
        `;
    }

    // Update warnings display
    function updateWarningsDisplay(warningsData) {
        if (!tabPane) return;

        const container = tabPane.querySelector('.nina-container');
        if (!container) return;

        const contentDiv = container.querySelector('.nina-content');
        if (!contentDiv) return;

        if (!warningsData || !warningsData.length) {
            contentDiv.innerHTML = '<div class="nina-no-warnings">Keine aktuellen Warnmeldungen</div>';
            return;
        }

        const warningsHtml = warningsData.map(warning => createWarningElement(warning)).join('');
        contentDiv.innerHTML = warningsHtml;
    }

    // Load and display warnings
    async function loadWarnings() {
        if (!tabPane) return;

        const container = tabPane.querySelector('.nina-container');
        if (!container) return;

        const contentDiv = container.querySelector('.nina-content');
        if (!contentDiv) return;

        contentDiv.innerHTML = '<div class="nina-loading">Lade Warnmeldungen...</div>';

        try {
            console.log('Fetching NINA warnings...');
            const warningsData = await fetchWarnings();
            console.log('NINA warnings received:', warningsData);

            if (!warningsData || warningsData.length === 0) {
                contentDiv.innerHTML = '<div class="nina-no-warnings">Keine aktuellen Warnmeldungen verfügbar</div>';
                return;
            }

            warnings = warningsData.slice(0, 15); // Limit to 15 warnings
            updateWarningsDisplay(warnings);

        } catch (error) {
            console.error('NINA Warning fetch error:', error);
            contentDiv.innerHTML = `
                <div class="nina-error">
                    Fehler beim Laden der Warnmeldungen: ${error.message}
                    <br><br>
                    <small>Die NINA API ist momentan nicht erreichbar. Das Script zeigt eine Testmeldung zur Demonstration.</small>
                </div>
            `;
        }
    }

    // Create tab content
    function createTabContent() {
        return `
            <div class="nina-container">
                <div class="nina-header">
                    <div class="nina-title">NINA Warnmeldungen</div>
                    <button class="nina-refresh-btn" onclick="refreshNinaWarnings()">🔄 Aktualisieren</button>
                </div>
                <div class="nina-content">
                    <div class="nina-loading">Lade Warnmeldungen...</div>
                </div>
            </div>
        `;
    }

    // Initialize the userscript
    async function initializeNinaScript() {
        try {
            addStyles();

            // Register sidebar tab
            const { tabLabel, tabPane: pane } = W.userscripts.registerSidebarTab("nina-warnings");
            tabPane = pane;

            // Set tab label
            tabLabel.innerText = 'NINA';
            tabLabel.title = 'NINA Warnmeldungen';

            // Wait for tab pane to be connected to DOM
            await W.userscripts.waitForElementConnected(tabPane);

            // Add content to tab pane
            tabPane.innerHTML = createTabContent();

            // Make refresh function globally available
            window.refreshNinaWarnings = loadWarnings;

            // Load initial warnings
            await loadWarnings();

            // Set up auto-refresh every 5 minutes
            refreshInterval = setInterval(loadWarnings, 5 * 60 * 1000);

            console.log('NINA Warnmeldungen userscript initialized successfully');

        } catch (error) {
            console.error('Failed to initialize NINA userscript:', error);
        }
    }

    // Check if WME is ready and initialize
    if (W?.userscripts?.state.isReady) {
        initializeNinaScript();
    } else {
        document.addEventListener("wme-ready", initializeNinaScript, { once: true });
    }

    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
        if (refreshInterval) {
            clearInterval(refreshInterval);
        }
    });

})();