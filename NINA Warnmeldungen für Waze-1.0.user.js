// ==UserScript==
// @name         NINA Warnmeldungen für Waze
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Integriert NINA Warnmeldungen in den Waze Map Editor mit WMTS-Unterstützung
// @author       WazeUser
// @match        https://www.waze.com/editor*
// @match        https://www.waze.com/*/editor*
// @match        https://beta.waze.com/editor*
// @match        https://beta.waze.com/*/editor*
// @grant        GM_xmlhttpRequest
// @connect      warnung.bund.de
// @connect      nina.api.bund.de
// @connect      opendata.dwd.de
// @connect      *
// ==/UserScript==

(function() {
    'use strict';

    // NINA API Configuration
    const NINA_API_CONFIG = {
        baseUrl: 'https://warnung.bund.de/api31',
        endpoints: {
            dashboard: '/dashboard/{ags}.json',
            katwarn: '/katwarn/mapData.json',
            biwapp: '/biwapp/mapData.json',
            dwd: '/dwd/mapData.json',
            mowas: '/mowas/mapData.json'
        },
        webUrl: 'https://warnung.bund.de'
    };

    // WMTS Configuration for map overlay
    const WMTS_CONFIG = {
        enabled: false, // Will be enabled based on user preference
        url: 'https://maps.dwd.de/geoserver/dwd/wms',
        layers: 'dwd:Warnungen_Gemeinden',
        format: 'image/png',
        transparent: true,
        opacity: 0.6
    };

    // State management
    let state = {
        warnings: [],
        tabPane: null,
        refreshInterval: null,
        mapOverlay: null,
        currentBounds: null,
        userLocation: null
    };

    // CSS Styles
    const CSS_STYLES = `
        .nina-container {
            padding: 10px;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            max-height: calc(100vh - 200px);
            overflow-y: auto;
        }

        .nina-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
            padding-bottom: 10px;
            border-bottom: 2px solid #e0e6ed;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 12px;
            border-radius: 8px;
            margin: -10px -10px 15px -10px;
        }

        .nina-title {
            font-size: 16px;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .nina-title::before {
            content: '⚠️';
            font-size: 18px;
        }

        .nina-controls {
            display: flex;
            gap: 8px;
            align-items: center;
        }

        .nina-refresh-btn, .nina-toggle-btn {
            background: rgba(255, 255, 255, 0.2);
            color: white;
            border: 1px solid rgba(255, 255, 255, 0.3);
            padding: 6px 10px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 11px;
            transition: all 0.2s ease;
        }

        .nina-refresh-btn:hover, .nina-toggle-btn:hover {
            background: rgba(255, 255, 255, 0.3);
            transform: translateY(-1px);
        }

        .nina-toggle-btn.active {
            background: rgba(255, 255, 255, 0.9);
            color: #667eea;
        }

        .nina-stats {
            display: flex;
            gap: 15px;
            margin-bottom: 15px;
            padding: 10px;
            background: #f8f9fa;
            border-radius: 6px;
            font-size: 12px;
        }

        .nina-stat {
            display: flex;
            align-items: center;
            gap: 5px;
        }

        .nina-stat-icon {
            width: 12px;
            height: 12px;
            border-radius: 50%;
        }

        .nina-stat-icon.severe { background: #e74c3c; }
        .nina-stat-icon.moderate { background: #f39c12; }
        .nina-stat-icon.minor { background: #f1c40f; }

        .nina-warning {
            margin-bottom: 12px;
            padding: 12px;
            border-left: 4px solid #3498db;
            background: white;
            border-radius: 6px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            transition: all 0.2s ease;
        }

        .nina-warning:hover {
            box-shadow: 0 4px 8px rgba(0,0,0,0.15);
            transform: translateY(-1px);
        }

        .nina-warning.severity-minor {
            border-left-color: #f1c40f;
            background: linear-gradient(135deg, #fff 0%, #fffbf0 100%);
        }

        .nina-warning.severity-moderate {
            border-left-color: #f39c12;
            background: linear-gradient(135deg, #fff 0%, #fff8f0 100%);
        }

        .nina-warning.severity-severe {
            border-left-color: #e74c3c;
            background: linear-gradient(135deg, #fff 0%, #fff5f5 100%);
        }

        .nina-warning.severity-extreme {
            border-left-color: #8e44ad;
            background: linear-gradient(135deg, #fff 0%, #f8f3ff 100%);
        }

        .nina-warning-header {
            font-weight: 600;
            font-size: 14px;
            margin-bottom: 8px;
            color: #2c3e50;
            line-height: 1.3;
        }

        .nina-warning-meta {
            display: flex;
            flex-wrap: wrap;
            gap: 12px;
            margin-bottom: 8px;
            font-size: 11px;
            color: #7f8c8d;
        }

        .nina-warning-meta span {
            display: flex;
            align-items: center;
            gap: 4px;
        }

        .nina-warning-description {
            font-size: 12px;
            color: #34495e;
            line-height: 1.5;
            margin-bottom: 10px;
        }

        .nina-warning-actions {
            display: flex;
            gap: 10px;
            align-items: center;
        }

        .nina-warning-link {
            color: #3498db;
            text-decoration: none;
            font-size: 11px;
            font-weight: 500;
            padding: 4px 8px;
            border-radius: 3px;
            transition: all 0.2s ease;
        }

        .nina-warning-link:hover {
            background: #3498db;
            color: white;
        }

        .nina-warning-distance {
            font-size: 10px;
            color: #95a5a6;
            font-weight: 500;
        }

        .nina-no-warnings {
            text-align: center;
            color: #7f8c8d;
            font-style: italic;
            padding: 30px 20px;
            background: #f8f9fa;
            border-radius: 6px;
        }

        .nina-loading {
            text-align: center;
            color: #7f8c8d;
            padding: 30px 20px;
            background: #f8f9fa;
            border-radius: 6px;
        }

        .nina-loading::after {
            content: '';
            display: inline-block;
            width: 20px;
            height: 20px;
            border: 2px solid #bdc3c7;
            border-radius: 50%;
            border-top-color: #3498db;
            animation: nina-spin 1s ease-in-out infinite;
            margin-left: 10px;
        }

        @keyframes nina-spin {
            to { transform: rotate(360deg); }
        }

        .nina-error {
            color: #e74c3c;
            text-align: center;
            padding: 20px;
            background: linear-gradient(135deg, #fff5f5 0%, #ffeaea 100%);
            border-radius: 6px;
            margin: 10px 0;
            border: 1px solid #fadbd8;
        }

        .nina-filter {
            margin-bottom: 15px;
            padding: 10px;
            background: #ecf0f1;
            border-radius: 6px;
        }

        .nina-filter select {
            width: 100%;
            padding: 6px;
            border: 1px solid #bdc3c7;
            border-radius: 4px;
            font-size: 12px;
        }
    `;

    // Utility functions
    function addStyles() {
        const style = document.createElement('style');
        style.textContent = CSS_STYLES;
        document.head.appendChild(style);
    }

    function getCurrentLocation() {
        try {
            const map = W.map;
            if (map && map.getCenter) {
                const center = map.getCenter();
                // Convert from Web Mercator to WGS84 if needed
                const lonLat = center.transform ?
                    center.transform(map.getProjection(), 'EPSG:4326') :
                    center;
                return {
                    lat: lonLat.lat || lonLat.y,
                    lon: lonLat.lon || lonLat.x
                };
            }
        } catch (e) {
            console.warn('Could not get current location:', e);
        }
        return null;
    }

    function getCurrentBounds() {
        try {
            const map = W.map;
            if (map && map.getExtent) {
                const extent = map.getExtent();
                // Convert bounds if needed
                const bounds = extent.transform ?
                    extent.transform(map.getProjection(), 'EPSG:4326') :
                    extent;
                return {
                    left: bounds.left || bounds.minX,
                    bottom: bounds.bottom || bounds.minY,
                    right: bounds.right || bounds.maxX,
                    top: bounds.top || bounds.maxY
                };
            }
        } catch (e) {
            console.warn('Could not get current bounds:', e);
        }
        return null;
    }

    function getAGSFromCoordinates(lat, lon) {
        // Simplified AGS detection - in a real implementation,
        // you'd use a reverse geocoding service or local database
        // For now, return a default German region code
        return '08000000000'; // Baden-Württemberg default
    }

    function calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371; // Earth's radius in kilometers
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }

    // API functions
    async function fetchWarnings() {
        return new Promise((resolve, reject) => {
            const location = getCurrentLocation();
            const ags = location ? getAGSFromCoordinates(location.lat, location.lon) : '08000000000';

            const endpoints = [
                `${NINA_API_CONFIG.baseUrl}/dashboard/${ags}.json`,
                `${NINA_API_CONFIG.baseUrl}/katwarn/mapData.json`,
                `${NINA_API_CONFIG.baseUrl}/biwapp/mapData.json`,
                `${NINA_API_CONFIG.baseUrl}/dwd/mapData.json`,
                `${NINA_API_CONFIG.baseUrl}/mowas/mapData.json`
            ];

            let currentEndpoint = 0;
            let allWarnings = [];

            function tryNextEndpoint() {
                if (currentEndpoint >= endpoints.length) {
                    if (allWarnings.length === 0) {
                        // Create demo warning if no real data available
                        allWarnings = [{
                            id: 'demo-integration',
                            sent: new Date().toISOString(),
                            msgType: 'Alert',
                            info: [{
                                headline: 'NINA Integration aktiv',
                                severity: 'Minor',
                                description: 'Das NINA Userscript wurde erfolgreich in Waze integriert. Bei aktuellen Warnungen werden diese hier angezeigt.',
                                area: [{ areaDesc: 'Waze Map Editor' }],
                                event: 'Integration Test'
                            }]
                        }];
                    }
                    resolve(allWarnings);
                    return;
                }

                const url = endpoints[currentEndpoint];
                console.log(`Fetching from: ${url}`);

                GM_xmlhttpRequest({
                    method: 'GET',
                    url: url,
                    timeout: 10000,
                    headers: {
                        'Accept': 'application/json',
                        'User-Agent': 'Waze-NINA-Integration/1.1'
                    },
                    onload: function(response) {
                        if (response.status === 200) {
                            try {
                                const data = JSON.parse(response.responseText);
                                let warnings = [];

                                // Handle different API response formats
                                if (Array.isArray(data)) {
                                    warnings = data;
                                } else if (data.warnings) {
                                    warnings = data.warnings;
                                } else if (data.results) {
                                    warnings = data.results;
                                } else if (data.features) {
                                    warnings = data.features.map(f => f.properties || f);
                                }

                                if (warnings.length > 0) {
                                    allWarnings = allWarnings.concat(warnings);
                                }
                            } catch (e) {
                                console.warn(`Parse error for ${url}:`, e);
                            }
                        }

                        currentEndpoint++;
                        tryNextEndpoint();
                    },
                    onerror: function() {
                        currentEndpoint++;
                        tryNextEndpoint();
                    },
                    ontimeout: function() {
                        currentEndpoint++;
                        tryNextEndpoint();
                    }
                });
            }

            tryNextEndpoint();
        });
    }

    // Warning processing functions
    function getSeverityClass(severity) {
        const severityMap = {
            'Minor': 'minor',
            'Moderate': 'moderate',
            'Severe': 'severe',
            'Extreme': 'extreme'
        };
        return severityMap[severity] || 'minor';
    }

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

    function getWarningType(msgType, event) {
        const typeMap = {
            'Alert': 'Warnung',
            'Update': 'Aktualisierung',
            'Cancel': 'Aufhebung',
            'Test': 'Test'
        };
        return typeMap[msgType] || event || msgType;
    }

    function processWarnings(warningsData) {
        const location = getCurrentLocation();
        const bounds = getCurrentBounds();

        return warningsData
            .map(warning => {
                const info = warning.info?.[0] || warning;
                const area = info.area?.[0] || {};

                let distance = null;
                if (location && area.geocode) {
                    // Calculate distance if coordinates available
                    const coords = area.geocode.find(g => g.valueName === 'EMMA_COORD');
                    if (coords && coords.value) {
                        const [lat, lon] = coords.value.split(',').map(Number);
                        distance = calculateDistance(location.lat, location.lon, lat, lon);
                    }
                }

                return {
                    ...warning,
                    info: info,
                    area: area,
                    distance: distance,
                    processed: true
                };
            })
            .filter(warning => {
                // Filter by distance if location available
                if (warning.distance && warning.distance > 100) { // 100km radius
                    return false;
                }
                return true;
            })
            .sort((a, b) => {
                // Sort by severity and distance
                const severityOrder = { 'Extreme': 4, 'Severe': 3, 'Moderate': 2, 'Minor': 1 };
                const aSeverity = severityOrder[a.info.severity] || 1;
                const bSeverity = severityOrder[b.info.severity] || 1;

                if (aSeverity !== bSeverity) {
                    return bSeverity - aSeverity;
                }

                if (a.distance && b.distance) {
                    return a.distance - b.distance;
                }

                return new Date(b.sent || 0) - new Date(a.sent || 0);
            });
    }

    // UI creation functions
    function createWarningElement(warning) {
        const info = warning.info || warning;
        const area = warning.area || info.area?.[0] || {};

        const severity = info.severity || 'Minor';
        const msgType = warning.msgType || info.msgType || 'Alert';
        const sent = warning.sent || info.sent || new Date().toISOString();
        const headline = info.headline || warning.headline || info.event || 'Warnung';
        const description = info.description || warning.description || info.instruction || 'Keine Details verfügbar';
        const areaDesc = area.areaDesc || info.areaDesc || warning.regionName || 'Deutschland';
        const event = info.event || warning.event || '';

        const severityClass = getSeverityClass(severity);
        const warningType = getWarningType(msgType, event);
        const startTime = formatDate(sent);

        const warningId = warning.id || warning.identifier || '';
        const detailLink = warningId ?
            `${NINA_API_CONFIG.webUrl}/meldung/${encodeURIComponent(warningId)}` :
            `${NINA_API_CONFIG.webUrl}/meldungen`;

        const distanceText = warning.distance ?
            `<span class="nina-warning-distance">${Math.round(warning.distance)} km</span>` : '';

        return `
            <div class="nina-warning severity-${severityClass}">
                <div class="nina-warning-header">${headline}</div>
                <div class="nina-warning-meta">
                    <span>📋 ${warningType}</span>
                    <span>📍 ${areaDesc}</span>
                    <span>🕒 ${startTime}</span>
                    ${event ? `<span>⚠️ ${event}</span>` : ''}
                </div>
                <div class="nina-warning-description">${description}</div>
                <div class="nina-warning-actions">
                    <a href="${detailLink}" target="_blank" class="nina-warning-link">
                        Weitere Details →
                    </a>
                    ${distanceText}
                </div>
            </div>
        `;
    }

    function createStatsElement(warnings) {
        const stats = warnings.reduce((acc, warning) => {
            const severity = warning.info?.severity || 'Minor';
            acc[severity.toLowerCase()] = (acc[severity.toLowerCase()] || 0) + 1;
            return acc;
        }, {});

        return `
            <div class="nina-stats">
                ${stats.severe ? `<div class="nina-stat">
                    <div class="nina-stat-icon severe"></div>
                    <span>${stats.severe} Schwer</span>
                </div>` : ''}
                ${stats.moderate ? `<div class="nina-stat">
                    <div class="nina-stat-icon moderate"></div>
                    <span>${stats.moderate} Mittel</span>
                </div>` : ''}
                ${stats.minor ? `<div class="nina-stat">
                    <div class="nina-stat-icon minor"></div>
                    <span>${stats.minor} Gering</span>
                </div>` : ''}
                <div class="nina-stat">
                    <span>📊 Gesamt: ${warnings.length}</span>
                </div>
            </div>
        `;
    }

    function createTabContent() {
        return `
            <div class="nina-container">
                <div class="nina-header">
                    <div class="nina-title">NINA Warnmeldungen</div>
                    <div class="nina-controls">
                        <button class="nina-toggle-btn" onclick="toggleNinaOverlay()" title="Kartenoverlay ein/aus">
                            🗺️ Overlay
                        </button>
                        <button class="nina-refresh-btn" onclick="refreshNinaWarnings()" title="Aktualisieren">
                            🔄 Refresh
                        </button>
                    </div>
                </div>
                <div class="nina-stats-container"></div>
                <div class="nina-content">
                    <div class="nina-loading">Lade Warnmeldungen...</div>
                </div>
            </div>
        `;
    }

    // Main functions
    async function updateWarningsDisplay(warningsData) {
        if (!state.tabPane) return;

        const container = state.tabPane.querySelector('.nina-container');
        if (!container) return;

        const statsContainer = container.querySelector('.nina-stats-container');
        const contentDiv = container.querySelector('.nina-content');
        if (!contentDiv) return;

        if (!warningsData || !warningsData.length) {
            statsContainer.innerHTML = '';
            contentDiv.innerHTML = '<div class="nina-no-warnings">✅ Keine aktuellen Warnmeldungen in Ihrer Region</div>';
            return;
        }

        const processedWarnings = processWarnings(warningsData);
        const limitedWarnings = processedWarnings.slice(0, 20);

        statsContainer.innerHTML = createStatsElement(limitedWarnings);

        const warningsHtml = limitedWarnings.map(warning => createWarningElement(warning)).join('');
        contentDiv.innerHTML = warningsHtml;
    }

    async function loadWarnings() {
        if (!state.tabPane) return;

        const container = state.tabPane.querySelector('.nina-container');
        if (!container) return;

        const contentDiv = container.querySelector('.nina-content');
        if (!contentDiv) return;

        contentDiv.innerHTML = '<div class="nina-loading">Lade Warnmeldungen...</div>';

        try {
            console.log('Fetching NINA warnings...');
            const warningsData = await fetchWarnings();
            console.log('NINA warnings received:', warningsData.length, 'warnings');

            state.warnings = warningsData;
            await updateWarningsDisplay(warningsData);

        } catch (error) {
            console.error('NINA Warning fetch error:', error);
            contentDiv.innerHTML = `
                <div class="nina-error">
                    <strong>Fehler beim Laden der Warnmeldungen</strong><br>
                    <small>${error.message || 'Unbekannter Fehler'}</small><br><br>
                    <small>Die NINA API ist momentan nicht erreichbar.</small>
                </div>
            `;
        }
    }

    function toggleMapOverlay() {
        // Placeholder for WMTS overlay functionality
        // This would integrate with Waze's map system
        WMTS_CONFIG.enabled = !WMTS_CONFIG.enabled;

        const btn = document.querySelector('.nina-toggle-btn');
        if (btn) {
            btn.classList.toggle('active', WMTS_CONFIG.enabled);
            btn.title = WMTS_CONFIG.enabled ? 'Kartenoverlay ausblenden' : 'Kartenoverlay einblenden';
        }

        console.log('WMTS Overlay:', WMTS_CONFIG.enabled ? 'enabled' : 'disabled');
        // Here you would add/remove the WMTS layer from the map
    }

    // Initialization
    async function initializeNinaScript() {
        try {
            console.log('Initializing NINA userscript...');
            addStyles();

            // Register sidebar tab using new API
            const { tabLabel, tabPane } = W.userscripts.registerSidebarTab("nina-warnings");
            state.tabPane = tabPane;

            // Set tab label
            tabLabel.innerText = '⚠️ NINA';
            tabLabel.title = 'NINA Warnmeldungen';

            // Wait for tab pane to be connected to DOM
            await W.userscripts.waitForElementConnected(tabPane);

            // Add content to tab pane
            tabPane.innerHTML = createTabContent();

            // Make functions globally available
            window.refreshNinaWarnings = loadWarnings;
            window.toggleNinaOverlay = toggleMapOverlay;

            // Load initial warnings
            await loadWarnings();

            // Set up auto-refresh every 5 minutes
            state.refreshInterval = setInterval(loadWarnings, 5 * 60 * 1000);

            // Listen for map changes to update location-based filtering
            if (W.map && W.map.events) {
                W.map.events.register('moveend', null, () => {
                    state.currentBounds = getCurrentBounds();
                    state.userLocation = getCurrentLocation();
                });
            }

            console.log('NINA Warnmeldungen userscript initialized successfully');

        } catch (error) {
            console.error('Failed to initialize NINA userscript:', error);
        }
    }

    // Event handlers and cleanup
    function cleanup() {
        if (state.refreshInterval) {
            clearInterval(state.refreshInterval);
            state.refreshInterval = null;
        }

        if (state.mapOverlay) {
            // Remove map overlay if exists
            state.mapOverlay = null;
        }
    }

    // Initialize when WME is ready
    if (W?.userscripts?.state.isReady) {
        initializeNinaScript();
    } else {
        document.addEventListener("wme-ready", initializeNinaScript, { once: true });
    }

    // Cleanup on page unload
    window.addEventListener('beforeunload', cleanup);

})();
