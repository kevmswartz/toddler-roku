// Govee Lights Control App
const GOVEE_IP_STORAGE_KEY = 'govee_ip';
const GOVEE_PORT_STORAGE_KEY = 'govee_port';
const GOVEE_BRIGHTNESS_STORAGE_KEY = 'govee_brightness';
const GOVEE_DEFAULT_PORT = 4003;
const GOVEE_MIN_BRIGHTNESS = 1;
const GOVEE_POWER_STATE_PREFIX = 'govee_power_state_';
const GOVEE_API_KEY_STORAGE_KEY = 'govee_api_key';
const CONFIG_BASE_PATH = 'config';
const APP_CONFIG_PATH = `${CONFIG_BASE_PATH}/app-config.json`;
const APP_CONFIG_CUSTOM_PATH = `${CONFIG_BASE_PATH}/app-config.custom.json`;
const NETLIFY_CONFIG_API_BASE = 'https://toddler-phone-control.netlify.app/api/config';
const TODDLER_CONTENT_PASSPHRASE_KEY = 'toddler_content_passphrase';

const GOVEE_STATUS_VARIANTS = {
    info: 'bg-white/10 text-indigo-100',
    success: 'bg-emerald-500/20 text-emerald-50 border border-emerald-200/40',
    error: 'bg-rose-500/20 text-rose-50 border border-rose-200/40'
};
const tauriBridge = typeof window !== 'undefined' ? window.__TAURI__ : undefined;
const tauriInvoke = (() => {
    if (!tauriBridge) return undefined;
    if (typeof tauriBridge.invoke === 'function') {
        return tauriBridge.invoke.bind(tauriBridge);
    }
    if (typeof tauriBridge.core?.invoke === 'function') {
        return tauriBridge.core.invoke.bind(tauriBridge.core);
    }
    if (typeof tauriBridge.tauri?.invoke === 'function') {
        return tauriBridge.tauri.invoke.bind(tauriBridge.tauri);
    }
    return undefined;
})();
const isNativeRuntime = Boolean(tauriInvoke);
const goveeLanBridge = (() => {
    if (typeof window === 'undefined') return undefined;
    if (!window.goveeLan && tauriInvoke) {
        window.goveeLan = {
            send: async ({ host, port, body }) => {
                await tauriInvoke('govee_send', { host, port, body: body ?? '' });
                return { host, port };
            },
            discover: async (options = {}) => {
                return tauriInvoke('govee_discover', options);
            }
        };
    }
    return window.goveeLan;
})();

const TAB_DEFINITIONS = {
    lights: {
        id: 'lights',
        defaultLabel: 'Lights',
        defaultIcon: '💡',
        sections: ['lightsButtonSection', 'goveeSection']
    }
};
const TAB_MANAGED_SECTION_IDS = Array.from(
    new Set(
        Object.values(TAB_DEFINITIONS).flatMap(def => Array.isArray(def.sections) ? def.sections : [])
    )
);

// Store latest media data for detailed view
let toddlerContentSource = { type: 'bundled', path: APP_CONFIG_PATH };
let tabsConfig = null;
let goveeCloudDevices = [];
let goveeCloudDevicesLoaded = false;
let goveeCloudDevicesLoading = false;


function getNativeTtsBridge() {
    if (typeof window === 'undefined') return undefined;
    return window.NativeTts;
}

function buildTabFromDefinition(definition, overrides = {}) {
    const label = (overrides.customLabel || '').trim();
    const icon = (overrides.customIcon || '').trim();
    return {
        id: definition.id,
        label: label || definition.defaultLabel,
        icon: icon || definition.defaultIcon,
        sections: Array.isArray(definition.sections) ? [...definition.sections] : []
    };
}

async function isOnWifi() {
    // In native mode, use the Tauri command to check WiFi (not mobile data)
    if (isNativeRuntime && tauriInvoke) {
        try {
            const connected = await tauriInvoke('is_wifi_connected');
            return connected === true;
        } catch (error) {
            console.warn('Failed to check WiFi status:', error);
            // Fallback to basic online check
            return typeof navigator !== 'undefined' && navigator.onLine !== false;
        }
    }

    // In browser mode, fall back to basic online check
    return typeof navigator !== 'undefined' && navigator.onLine !== false;
}

function getTabsForRendering() {
    let tabs;

    // If we have a loaded config, use it
    if (tabsConfig && Array.isArray(tabsConfig.tabs)) {
        tabs = tabsConfig.tabs.map(tab => ({
            id: tab.id,
            label: tab.label || TAB_DEFINITIONS[tab.id]?.defaultLabel || tab.id,
            icon: tab.icon || TAB_DEFINITIONS[tab.id]?.defaultIcon || '📱',
            // Use sections from TAB_DEFINITIONS since HTML sections are hardcoded
            sections: TAB_DEFINITIONS[tab.id]?.sections || []
        }));
    } else {
        // Fallback to hardcoded tabs
        tabs = [
            buildTabFromDefinition(TAB_DEFINITIONS.lights)
        ];
    }

    // Note: WiFi check is async, filtering happens in renderBottomTabs()
    return tabs;
}

async function getTabsForRenderingFiltered() {
    // WiFi filtering disabled - always show all tabs
    return getTabsForRendering();
}

function getActiveTabId() {
    // Store active tab in a simple variable instead of preferences
    if (!window._activeTabId || !TAB_DEFINITIONS[window._activeTabId]) {
        window._activeTabId = 'lights';
    }
    return window._activeTabId;
}

function updateTabButtonsState(activeTabId) {
    const buttonsContainer = document.getElementById('bottomTabButtons');
    if (!buttonsContainer) return;
    const buttons = buttonsContainer.querySelectorAll('button[data-tab-id]');
    buttons.forEach(button => {
        const isActive = button.dataset.tabId === activeTabId;
        button.setAttribute('data-tab-active', String(isActive));
    });
}

function clearTabVisibility() {
    for (const sectionId of TAB_MANAGED_SECTION_IDS) {
        const sectionEl = document.getElementById(sectionId);
        if (sectionEl) {
            sectionEl.classList.remove('tab-hidden');
        }
    }
}

function applyTabVisibility(activeTabId, availableTabs) {
    // Show only sections for the active tab
    const tabs = Array.isArray(availableTabs) ? availableTabs : getTabsForRendering();
    const activeTab = tabs.find(tab => tab.id === activeTabId) || tabs[0];
    const visibleSections = new Set(activeTab?.sections || []);

    for (const sectionId of TAB_MANAGED_SECTION_IDS) {
        const sectionEl = document.getElementById(sectionId);
        if (!sectionEl) continue;
        if (visibleSections.has(sectionId)) {
            sectionEl.classList.remove('tab-hidden');
        } else {
            sectionEl.classList.add('tab-hidden');
        }
    }
}

function setActiveTab(tabId) {
    const tabs = getTabsForRendering();
    const desired = tabs.some(tab => tab.id === tabId) ? tabId : 'lights';
    window._activeTabId = desired;
    updateTabButtonsState(desired);
    applyTabVisibility(desired, tabs);
}

async function renderBottomTabs() {
    const nav = document.getElementById('bottomTabNav');
    const buttonsContainer = document.getElementById('bottomTabButtons');
    if (!nav || !buttonsContainer) return;

    const tabs = await getTabsForRenderingFiltered();
    nav.classList.remove('hidden');
    buttonsContainer.innerHTML = '';

    const activeTabId = getActiveTabId();

    tabs.forEach(tab => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.tabId = tab.id;
        button.setAttribute('data-tab-active', String(tab.id === activeTabId));
        button.setAttribute('aria-label', tab.label);
        button.className =
            'flex flex-1 flex-col items-center justify-center rounded-2xl px-3 py-3 text-xs font-semibold text-indigo-100 transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/40';

        const iconSpan = document.createElement('span');
        iconSpan.className = 'text-3xl leading-none';
        iconSpan.textContent = tab.icon || '';

        button.appendChild(iconSpan);

        button.addEventListener('click', () => {
            if (tab.id !== getActiveTabId()) {
                setActiveTab(tab.id);
            }
        });

        buttonsContainer.appendChild(button);
    });

    updateTabButtonsState(activeTabId);
    applyTabVisibility(activeTabId, tabs);
}

function initTabControls() {
    // Fixed tabs - just render them
    renderBottomTabs();
}

function getToddlerContentPassphrase() {
    return localStorage.getItem(TODDLER_CONTENT_PASSPHRASE_KEY) || '';
}

function setToddlerContentPassphrase(passphrase) {
    if (passphrase) {
        localStorage.setItem(TODDLER_CONTENT_PASSPHRASE_KEY, passphrase);
    } else {
        localStorage.removeItem(TODDLER_CONTENT_PASSPHRASE_KEY);
    }
    updateToddlerContentSourceInfo();
    updateCloudEditorVisibility();
}

function validatePassphrase(passphrase) {
    const trimmed = passphrase.trim();
    if (!trimmed) return { valid: false, error: 'Passphrase cannot be empty' };

    const words = trimmed.split(/\s+/);
    if (words.length < 5) {
        return { valid: false, error: `Passphrase must have at least 5 words (found ${words.length})` };
    }

    return { valid: true };
}

function buildCloudConfigUrl(passphrase, type = 'app-config') {
    if (!passphrase) return null;
    const encoded = encodeURIComponent(passphrase);
    const typeParam = encodeURIComponent(type);
    return `${NETLIFY_CONFIG_API_BASE}?passphrase=${encoded}&type=${typeParam}`;
}

async function saveDeviceListToCloud(devices, type = 'ble') {
    const passphrase = getToddlerContentPassphrase().trim();
    if (!passphrase) {
        console.log('No passphrase set, skipping cloud save for device list');
        return false;
    }

    const endpoint = type === 'ble'
        ? `${NETLIFY_CONFIG_API_BASE}/${type}-devices.json`
        : `${NETLIFY_CONFIG_API_BASE}/${type}-devices.json`;

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${passphrase}`
            },
            body: JSON.stringify({
                devices: devices,
                timestamp: new Date().toISOString(),
                deviceCount: devices.length
            })
        });

        if (!response.ok) {
            const error = await response.json();
            console.error(`Failed to save ${type} devices to cloud:`, error);
            return false;
        }

        const result = await response.json();
        console.log(`✅ Saved ${result.deviceCount} ${type} devices to cloud`);
        return true;
    } catch (error) {
        console.error(`Error saving ${type} devices to cloud:`, error);
        return false;
    }
}

function updateToddlerContentSourceInfo() {
    const info = document.getElementById('toddlerContentCacheInfo');
    const passphraseInput = document.getElementById('toddlerContentPassphrase');
    const passphrase = getToddlerContentPassphrase().trim();

    if (passphraseInput && passphraseInput !== document.activeElement) {
        passphraseInput.value = passphrase;
    }

    if (!info) return;

    if (passphrase) {
        const wordCount = passphrase.split(/\s+/).length;
        info.textContent = `Using cloud config with your ${wordCount}-word passphrase. Always fetches fresh from Netlify.`;
        return;
    }

    if (toddlerContentSource?.type === 'custom') {
        info.textContent = 'Using local kid-mode override (config/toddler/custom.json).';
    } else if (toddlerContentSource?.type === 'bundled') {
        info.textContent = 'Using bundled kid-mode buttons (config/toddler/default.json).';
    } else if (toddlerContentSource?.type === 'empty') {
        info.textContent = 'No kid-mode buttons available. Check your config files.';
    } else {
        info.textContent = 'No passphrase set. Using bundled default buttons.';
    }
}


function setToddlerContentSource(source) {
    toddlerContentSource = source || { type: 'unknown' };
    updateToddlerContentSourceInfo();
    updateCloudEditorVisibility();
}

function updateCloudEditorVisibility() {
    const editor = document.getElementById('cloudConfigEditor');
    const passphrase = getToddlerContentPassphrase().trim();

    if (editor) {
        // Show editor only if passphrase is set
        editor.classList.toggle('hidden', !passphrase);
    }
}

let currentLoadedConfig = null; // Store the current config for editing

function loadCurrentConfigIntoEditor() {
    const textarea = document.getElementById('cloudConfigJson');
    if (!textarea) return;

    // Use the last loaded config, or try to get from toddlerSpecialButtons
    let config;
    if (currentLoadedConfig) {
        config = currentLoadedConfig;
    } else {
        // Rebuild config from current state
        config = {
            tabs: [
                {
                    id: 'lights',
                    label: 'Lights',
                    icon: '💡',
                    buttons: toddlerSpecialButtons.filter(b => b.category === 'lights')
                }
            ].filter(tab => tab.buttons.length > 0 || tab.quickLaunch?.length > 0),
            version: '1.0.0',
            lastUpdated: new Date().toISOString()
        };
    }

    textarea.value = JSON.stringify(config, null, 2);
    showStatus('Current config loaded into editor. Make your changes and click Save to Cloud.', 'info');
}

function validateConfigJson() {
    const textarea = document.getElementById('cloudConfigJson');
    if (!textarea) return false;

    try {
        const config = JSON.parse(textarea.value);

        // Basic validation
        if (!config.tabs || !Array.isArray(config.tabs)) {
            showStatus('Invalid config: must have a "tabs" array.', 'error');
            return false;
        }

        showStatus(`Valid JSON! Found ${config.tabs.length} tabs.`, 'success');
        return true;
    } catch (error) {
        showStatus(`Invalid JSON: ${error.message}`, 'error');
        return false;
    }
}

async function saveConfigToCloud() {
    const textarea = document.getElementById('cloudConfigJson');
    const passphrase = getToddlerContentPassphrase().trim();

    if (!passphrase) {
        showStatus('No passphrase set. Enter a passphrase first.', 'error');
        return;
    }

    if (!textarea || !textarea.value.trim()) {
        showStatus('Editor is empty. Load current config or paste your JSON first.', 'error');
        return;
    }

    // Validate JSON first
    let config;
    try {
        config = JSON.parse(textarea.value);
    } catch (error) {
        showStatus(`Invalid JSON: ${error.message}`, 'error');
        return;
    }

    // Basic validation
    if (!config.tabs || !Array.isArray(config.tabs)) {
        showStatus('Invalid config: must have a "tabs" array.', 'error');
        return;
    }

    try {
        showStatus('Saving to cloud...', 'info');

        const response = await fetch(NETLIFY_CONFIG_API_BASE, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${passphrase}`
            },
            body: JSON.stringify(config)
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || `HTTP ${response.status}`);
        }

        showStatus('Config saved to cloud! Refreshing...', 'success');

        // Reload from cloud to verify
        await loadToddlerContent({ forceRefresh: true });

        // Update editor with the freshly loaded config (includes new lastUpdated timestamp)
        const editorTextarea = document.getElementById('cloudConfigJson');
        if (editorTextarea && currentLoadedConfig) {
            editorTextarea.value = JSON.stringify(currentLoadedConfig, null, 2);
        }

        showStatus('Config saved and refreshed successfully!', 'success');
    } catch (error) {
        console.error('Failed to save config to cloud:', error);
        showStatus(`Failed to save: ${error.message}`, 'error');
    }
}

function normalizeQuickLaunchItem(item) {
    // Auto-generate missing fields for quick launch items
    const normalized = { ...item };

    // Auto-generate id if not provided
    if (!normalized.id) {
        if (normalized.type === 'youtube' && normalized.videoId) {
            normalized.id = `yt-${normalized.videoId}`;
        } else {
            // Fallback: generate from label or random
            normalized.id = normalized.label ? `ql-${normalized.label.toLowerCase().replace(/\s+/g, '-')}` : `ql-${Date.now()}`;
        }
    }

    // Auto-generate thumbnail for youtube if not provided
    if (normalized.type === 'youtube' && normalized.videoId && !normalized.thumbnail) {
        normalized.thumbnail = `https://img.youtube.com/vi/${normalized.videoId}/maxresdefault.jpg`;
    }

    // Default label to empty string
    if (!normalized.label) {
        normalized.label = '';
    }

    return normalized;
}

function applyToddlerContent(data) {
    // Store the raw config for editing
    currentLoadedConfig = data;

    const settingsData = data?.settings || {};
    if (Object.prototype.hasOwnProperty.call(settingsData, 'goveeApiKey')) {
        const normalizedKey = (settingsData.goveeApiKey || '').trim();
        const currentKey = getStoredGoveeApiKey().trim();
        if (normalizedKey !== currentKey) {
            setStoredGoveeApiKey(normalizedKey);
            goveeCloudDevices = [];
            goveeCloudDevicesLoaded = false;
            if (normalizedKey) {
                goveeLoadCloudDevices({ auto: true });
            } else {
                renderGoveeCloudDevices();
            }
        }
    }

    // Extract tabs and buttons from the unified config structure
    const tabs = Array.isArray(data?.tabs) ? data.tabs : [];
    // Store tabs config for navigation
    tabsConfig = { tabs };

    const lightsTab = tabs.find(tab => tab.id === 'lights');
    const lightsButtons = Array.isArray(lightsTab?.buttons) ? [...lightsTab.buttons] : [];

    renderLightsButtons(lightsButtons);
}

async function fetchToddlerContentFromUrl(url) {
    // Use Tauri bridge in native mode to bypass CORS
    if (isNativeRuntime && tauriInvoke) {
        try {
            const raw = await tauriInvoke('roku_get', { url });
            return JSON.parse(raw);
        } catch (error) {
            throw new Error(`Failed to fetch via native bridge: ${error.message || error}`);
        }
    }

    // Fallback to browser fetch for web mode
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
}

async function tryFetchToddlerContentFromPath(path) {
    try {
        const response = await fetch(path, { cache: 'no-store' });
        if (response.status === 404) {
            return null;
        }
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        // Check content type - if it's HTML, this is likely a 404 page
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('text/html')) {
            return null;
        }

        return await response.json();
    } catch (error) {
        // Only warn if this isn't an expected missing custom.json
        if (!path.includes('custom.json')) {
            console.warn(`Failed to read kid-mode config from ${path}:`, error);
        }
        return null;
    }
}

async function fetchLocalToddlerContent() {
    const lookupOrder = [
        { type: 'custom', path: APP_CONFIG_CUSTOM_PATH },
        { type: 'bundled', path: APP_CONFIG_PATH }
    ];

    for (const candidate of lookupOrder) {
        const data = await tryFetchToddlerContentFromPath(candidate.path);
        if (data) {
            return { data, source: candidate };
        }
    }

    return null;
}

async function loadButtonTypeCatalog() {
    const container = document.getElementById('buttonHandlerCatalog');
    if (!container) return;

    try {
        const response = await fetch(BUTTON_TYPES_CONFIG_PATH, { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        buttonTypeCatalog = await response.json();
        renderButtonTypeCatalog(buttonTypeCatalog);
    } catch (error) {
        console.warn('Failed to load button type catalog:', error);
        container.classList.add('hidden');
    }
}

function renderButtonTypeCatalog(catalog) {
    const container = document.getElementById('buttonHandlerCatalog');
    const buttonList = document.getElementById('buttonHandlerList');
    const providerList = document.getElementById('contentProviderList');
    if (!container || !buttonList || !providerList) return;

    buttonList.innerHTML = '';
    providerList.innerHTML = '';

    const buttonTypes = Array.isArray(catalog?.buttonTypes) ? catalog.buttonTypes : [];
    const providers = Array.isArray(catalog?.contentProviders) ? catalog.contentProviders : [];

    if (buttonTypes.length) {
        buttonTypes.forEach(def => {
            const card = document.createElement('div');
            card.className = 'rounded-2xl bg-white/5 p-4 text-sm text-indigo-100 shadow-inner';

            const title = document.createElement('h3');
            title.className = 'text-base font-semibold text-white';
            title.textContent = def.type;

            const description = document.createElement('p');
            description.className = 'mt-2 text-xs text-indigo-100/80';
            description.textContent = def.description || 'Add custom kid-mode buttons using this type.';

            const handlerList = document.createElement('ul');
            handlerList.className = 'mt-3 space-y-1 text-xs font-semibold text-indigo-100';

            (Array.isArray(def.handlers) ? def.handlers : []).forEach(handler => {
                const item = document.createElement('li');
                item.textContent = handler;
                handlerList.appendChild(item);
            });

            card.append(title, description, handlerList);
            buttonList.appendChild(card);
        });
    } else {
        const empty = document.createElement('p');
        empty.className = 'rounded-2xl bg-white/5 p-4 text-xs text-indigo-100/80';
        empty.textContent = 'No handler catalog available.';
        buttonList.appendChild(empty);
    }

    if (providers.length) {
        providers.forEach(provider => {
            const row = document.createElement('div');
            row.className = 'rounded-2xl bg-white/5 p-3 text-xs text-indigo-100';

            const heading = document.createElement('div');
            heading.className = 'font-semibold text-white';
            heading.textContent = provider.type;

            const details = document.createElement('p');
            details.className = 'mt-1 text-indigo-100/80';
            const handlerNames = Array.isArray(provider.sourceButtons) ? provider.sourceButtons.join(', ') : 'No handlers listed';
            const availability = provider.availableByDefault ? 'available by default' : 'enable manually';
            details.textContent = `Handlers: ${handlerNames} • ${availability}`;

            const notes = document.createElement('p');
            notes.className = 'mt-2 text-[11px] text-indigo-100/70';
            notes.textContent = provider.notes || '';

            row.append(heading, details, notes);
            providerList.appendChild(row);
        });
    } else {
        const fallback = document.createElement('p');
        fallback.className = 'rounded-2xl bg-white/5 p-3 text-xs text-indigo-100/80';
        fallback.textContent = 'No content provider metadata available.';
        providerList.appendChild(fallback);
    }

    container.classList.toggle('hidden', !buttonTypes.length && !providers.length);
}

async function saveToddlerContentPassphrase() {
    const input = document.getElementById('toddlerContentPassphrase');
    if (!input) return;

    const rawPassphrase = input.value.trim();
    if (rawPassphrase) {
        // Validate passphrase
        const validation = validatePassphrase(rawPassphrase);
        if (!validation.valid) {
            showStatus(validation.error, 'error');
            return;
        }
        setToddlerContentPassphrase(rawPassphrase);
        await loadToddlerContent({ forceRefresh: true });
        showStatus(`Passphrase saved! Loading config from cloud...`, 'success');
    } else {
        setToddlerContentPassphrase('');
        await loadToddlerContent({ forceRefresh: true });
        showStatus('Passphrase cleared. Using bundled defaults.', 'info');
    }
}

async function refreshToddlerContent() {
    await loadToddlerContent({ forceRefresh: true });
}

function clearToddlerContentPassphrase() {
    setToddlerContentPassphrase('');
    showStatus('Reloading with bundled buttons...', 'info');
    loadToddlerContent({ forceRefresh: true });
}





// Initialize on load
// Initialize on load
window.addEventListener('DOMContentLoaded', async () => {
    // Log runtime info for debugging
    if (isNativeRuntime) {
        console.log('Running inside Tauri shell');
    }

    // Load tabs config before initializing tab controls
    await loadTabsConfig();
    initTabControls();
    updateToddlerContentSourceInfo();
    updateCloudEditorVisibility();
    void loadButtonTypeCatalog();
    initGoveeControls();
    await loadToddlerContent();

    // Run device discovery at startup only if on WiFi
    if (isNativeRuntime && await isOnWifi()) {
        discoverAndRegisterAllDevices().catch(err => {
            console.warn('Startup discovery failed:', err);
        });
    }

    // Listen for network connectivity changes
    window.addEventListener('online', async () => {
        console.log('Network connection changed');
        await renderBottomTabs(); // Re-render tabs
        // Trigger device discovery if on WiFi
        if (isNativeRuntime && await isOnWifi()) {
            console.log('WiFi detected, running device discovery');
            discoverAndRegisterAllDevices().catch(err => {
                console.warn('Online discovery failed:', err);
            });
        }
    });

    window.addEventListener('offline', async () => {
        console.log('Network connection lost');
        await renderBottomTabs();
    });
});

async function loadToddlerContent({ forceRefresh = false } = {}) {
    const passphrase = getToddlerContentPassphrase().trim();

    // If passphrase is configured, try fetching from cloud (always fresh, no cache)
    if (passphrase) {
        const cloudUrl = buildCloudConfigUrl(passphrase);
        if (cloudUrl) {
            try {
                const remoteData = await fetchToddlerContentFromUrl(cloudUrl);
                setToddlerContentSource({ type: 'cloud', passphrase: '***' }); // Don't expose passphrase
                applyToddlerContent(remoteData);
                showStatus('Kid-mode buttons loaded from cloud.', 'success');
                return;
            } catch (error) {
                console.error('Failed to fetch cloud toddler content:', error);
                showStatus('Cloud config failed. Falling back to local config.', 'error');
                // Fall through to local loading
            }
        }
    }

    // Load from local files (custom.json or default.json)
    const localContent = await fetchLocalToddlerContent();
    if (localContent) {
        setToddlerContentSource(localContent.source);
        applyToddlerContent(localContent.data);
        if (!passphrase) {
            // No passphrase configured - this is the primary source
            if (localContent.source.type === 'custom') {
                showStatus('Kid-mode buttons loaded from local override.', 'info');
            } else {
                showStatus('Kid-mode buttons loaded from bundled defaults.', 'info');
            }
        }
        return;
    }

    // Complete failure - no content available
    console.error('Failed to load kid-mode buttons from any source.');
    setToddlerContentSource({ type: 'empty' });
    applyToddlerContent({ tabs: [] });
    showStatus('Could not load kid-mode buttons. Check your config files.', 'error');
}



function renderLightsButtons(buttons = []) {
    const column = document.getElementById('lightsButtonColumn');
    if (!column) return;

    column.innerHTML = '';

    // Filter buttons by current room
    const activeRoomId = getCurrentRoom();
    const filteredButtons = buttons.filter(config => {
        // If no rooms specified, show in all rooms
        if (!config.rooms || config.rooms.length === 0) {
            return true;
        }
        // If no active room (showing all rooms), show all buttons
        if (!activeRoomId) {
            return true;
        }
        // Otherwise, only show if current room is in the button's rooms array
        return config.rooms.includes(activeRoomId);
    });

    if (filteredButtons.length === 0) {
        const emptyState = document.createElement('div');
        emptyState.className = 'col-span-full rounded-3xl bg-white/10 px-6 py-8 text-center text-lg font-semibold text-indigo-100';
        emptyState.textContent = activeRoomId ? 'No lights available in this room.' : 'No light buttons configured yet.';
        column.appendChild(emptyState);
    } else {
        filteredButtons.forEach(config => {
            const element = createQuickButtonElement(config);
            if (element) {
                column.appendChild(element);
            }
        });
    }
}





function createQuickButtonElement(config) {
    const isQuickLaunch = Boolean(config.launchItem);
    const hasThumbnail = Boolean(config.thumbnail);

    const buttonEl = document.createElement('button');
    buttonEl.type = 'button';
    buttonEl.className = hasThumbnail
        ? 'group relative overflow-hidden rounded-3xl shadow-xl transition hover:-translate-y-1 hover:shadow-2xl focus:outline-none focus:ring-4 focus:ring-white/40 active:scale-[0.98] touch-manipulation select-none aspect-[16/9]'
        : 'flex min-h-[11rem] flex-col items-center justify-center gap-4 rounded-3xl bg-white text-indigo-600 shadow-xl transition hover:-translate-y-1 hover:shadow-2xl focus:outline-none focus:ring-4 focus:ring-white/50 active:scale-95 touch-manipulation select-none';

    if (config.id) {
        buttonEl.id = config.id;
    }

    if (config.label) {
        buttonEl.setAttribute('aria-label', config.label);
    }

    const clickHandler = () => {
        invokeToddlerHandler(config);
    };

    buttonEl.addEventListener('click', clickHandler);

    if (hasThumbnail) {
        const img = document.createElement('img');
        img.src = config.thumbnail || '';
        img.alt = config.label || 'Quick launch';
        img.loading = 'lazy';
        img.className = 'absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-105';

        const overlay = document.createElement('div');
        overlay.className = 'absolute inset-0 bg-black/20 transition duration-300 group-hover:bg-black/35 pointer-events-none';

        const label = document.createElement('span');
        label.className = 'absolute bottom-4 left-1/2 w-[85%] -translate-x-1/2 rounded-full bg-black/70 px-4 py-2 text-center text-sm font-semibold uppercase tracking-wide text-white shadow-lg';
        label.textContent = config.label || 'Watch';

        buttonEl.append(img, overlay, label);
    } else {
        const iconSpan = document.createElement('span');
        iconSpan.className = 'text-5xl';
        iconSpan.textContent = config.emoji || '🔘';

        const labelSpan = document.createElement('span');
        labelSpan.className = 'text-2xl font-extrabold tracking-tight text-indigo-700';
        if (config.favoriteLabelId) {
            labelSpan.id = config.favoriteLabelId;
        }
        labelSpan.textContent = config.label || 'Button';

        buttonEl.append(iconSpan, labelSpan);
    }

    return buttonEl;
}



function invokeToddlerHandler(config) {
    const handlerName = config?.handler;
    if (!handlerName) {
        console.warn('Toddler button missing handler:', config);
        return;
    }

    const handler = window[handlerName];
    if (typeof handler !== 'function') {
        console.warn(`Handler "${handlerName}" is not available for toddler button.`);
        showStatus('That action is not ready yet.', 'error');
        return;
    }

    let args = Array.isArray(config.args)
        ? config.args
        : config.args !== undefined
            ? [config.args]
            : [];

    // Allow new lightRoutine configs to pass their steps without duplicating data in args
    if (
        handlerName === 'lightRoutine' &&
        Array.isArray(config.routine) &&
        config.routine.length > 0 &&
        args.length === 0
    ) {
        args = [config.routine];
    }

    try {
        handler(...args);
    } catch (error) {
        console.error(`Error running handler "${handlerName}"`, error);
        showStatus('Could not run that action. Try again.', 'error');
    }
}



function speakTts(message = '') {
    const text = typeof message === 'string' ? message.trim() : '';

    if (!text) {
        showStatus('Nothing to say yet.', 'error');
        return;
    }

    const nativeBridge = getNativeTtsBridge();
    if (nativeBridge?.speak) {
        try {
            if (typeof nativeBridge.stop === 'function') {
                nativeBridge.stop();
            }

            if (nativeTtsStatusTimeout) {
                clearTimeout(nativeTtsStatusTimeout);
                nativeTtsStatusTimeout = null;
            }

            const ready = typeof nativeBridge.isReady === 'function' ? Boolean(nativeBridge.isReady()) : true;
            const success = nativeBridge.speak(text);

            if (!success) {
                showStatus('Could not speak that phrase.', 'error');
                return;
            }

            showStatus(ready ? `Saying "${text}"...` : 'Warming up the voice...', 'info');

            nativeTtsStatusTimeout = setTimeout(() => {
                showStatus(`Said: "${text}"`, 'success');
                nativeTtsStatusTimeout = null;
            }, ready ? 1400 : 2000);
            return;
        } catch (error) {
            console.error('Native TTS error', error);
            showStatus('Could not speak that phrase.', 'error');
            return;
        }
    }

    if (!('speechSynthesis' in window)) {
        showStatus('Your browser cannot talk yet. Try another device.', 'error');
        return;
    }

    try {
        const synth = window.speechSynthesis;
        synth.cancel();

        const speakWithVoices = () => {
            const voices = synth.getVoices();
            if (!voices || voices.length === 0) {
                showStatus('Loading voices...', 'info');
                synth.onvoiceschanged = () => {
                    synth.onvoiceschanged = null;
                    speakWithVoices();
                };
                return;
            }

            const voiceList = [...voices];
            const isEnUs = voice => (voice.lang || '').toLowerCase().includes('en-us');
            const femaleNames = voiceList.filter(voice => /female|woman|girl|amy|aria|emma|olivia|salli|joanna|linda|allison|nicole|kendra|kimberly/i.test(voice.name));
            const preferred = femaleNames.find(isEnUs)
                || voiceList.find(isEnUs)
                || femaleNames[0]
                || voiceList.find(voice => (voice.lang || '').toLowerCase().startsWith('en'))
                || voiceList[0];

            const utterance = new SpeechSynthesisUtterance(text);
            utterance.rate = 1;
            utterance.pitch = 1;
            if (preferred) utterance.voice = preferred;
            utterance.onend = () => showStatus(`Said: "${text}"`, 'success');
            utterance.onerror = event => {
                console.error('Speech synthesis error', event);
                showStatus('Could not speak that phrase.', 'error');
            };

            synth.speak(utterance);
            showStatus(`Saying "${text}"...`, 'info');
        };

        speakWithVoices();
    } catch (error) {
        console.error('Speech synthesis exception', error);
        showStatus('Could not speak that phrase.', 'error');
    }
}

function applyTimerAnimation(element) {
    if (!element) return;

    const animations = [
        'spin 3s linear infinite',
        'pulse-grow 2s ease-in-out infinite',
        'bounce-float 2s ease-in-out infinite',
        'rotate-pulse 3s ease-in-out infinite',
        'wiggle 1s ease-in-out infinite',
        'rainbow-glow 3s linear infinite'
    ];

    element.style.animation = animations[currentTimerAnimation];
}

function setupTimerOverlayEmojiButtons() {
    const overlayEmojiButtons = document.querySelectorAll('#timerOverlay [data-timer-emoji]');

    overlayEmojiButtons.forEach(button => {
        if (!button.__timerOverlayBound) {
            button.__timerOverlayBound = true;
            button.addEventListener('click', () => {
                const emoji = button.dataset.timerEmoji;
                selectedTimerEmoji = emoji || '⭐';

                // Update the spinner emoji
                const spinnerEmoji = document.getElementById('timerSpinnerEmoji');
                if (spinnerEmoji) {
                    spinnerEmoji.textContent = selectedTimerEmoji;
                }

                // Cycle to next animation
                currentTimerAnimation = (currentTimerAnimation + 1) % 6;
                applyTimerAnimation(spinnerEmoji);

                // Update selected state
                overlayEmojiButtons.forEach(btn => btn.setAttribute('data-selected', 'false'));
                button.setAttribute('data-selected', 'true');
            });
        }
    });

    // Set currently selected emoji
    const currentEmojiButton = Array.from(overlayEmojiButtons).find(
        btn => btn.dataset.timerEmoji === selectedTimerEmoji
    );
    if (currentEmojiButton) {
        overlayEmojiButtons.forEach(btn => btn.setAttribute('data-selected', 'false'));
        currentEmojiButton.setAttribute('data-selected', 'true');
    }
}

function startToddlerTimer(durationSeconds = 300, label = 'Timer') {
    const secondsValue = Number(Array.isArray(durationSeconds) ? durationSeconds[0] : durationSeconds);
    const labelValue = Array.isArray(durationSeconds) && durationSeconds.length > 1 ? durationSeconds[1] : label;
    const displayLabel = typeof labelValue === 'string' && labelValue.trim().length > 0 ? labelValue.trim() : 'Timer';

    const overlay = document.getElementById('timerOverlay');
    const originalTimeEl = document.getElementById('timerOriginalTime');
    const spinnerEmoji = document.getElementById('timerSpinnerEmoji');
    if (!overlay) {
        console.warn('Timer overlay elements are missing.');
        return;
    }

    const sanitizedSeconds = Number.isFinite(secondsValue) && secondsValue > 0 ? secondsValue : 300;

    cancelToddlerTimer({ silent: true });

    timerDurationMs = sanitizedSeconds * 1000;
    timerEndTimestamp = Date.now() + timerDurationMs;
    timerLabelText = displayLabel || 'Timer';

    // Display original time
    if (originalTimeEl) {
        const minutes = Math.floor(sanitizedSeconds / 60);
        const seconds = sanitizedSeconds % 60;
        const timeStr = seconds > 0 ? `${minutes}:${String(seconds).padStart(2, '0')}` : `${minutes}:00`;
        originalTimeEl.textContent = timeStr;
    }

    if (spinnerEmoji) {
        spinnerEmoji.textContent = selectedTimerEmoji;
        applyTimerAnimation(spinnerEmoji);
    }

    // Set up emoji button listeners in overlay
    setupTimerOverlayEmojiButtons();

    if (typeof document !== 'undefined' && document.body) {
        document.body.classList.add('timer-open');
    }
    overlay.classList.remove('hidden');
    overlay.classList.add('flex');

    updateToddlerTimerDisplay();
    showStatus(`Started ${timerLabelText} for ${formatTimerDuration(sanitizedSeconds)}.`, 'success');
}

function formatTimerDuration(totalSeconds = 0) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.max(0, Math.round(totalSeconds % 60));
    const minutePart = minutes > 0 ? `${minutes} min` : '';
    const secondPart = seconds > 0 ? `${seconds} sec` : '';
    return `${minutePart} ${secondPart}`.trim() || '0 sec';
}

function updateToddlerTimerDisplay() {
    const overlay = document.getElementById('timerOverlay');
    const countdownEl = document.getElementById('timerCountdown');
    if (!overlay || overlay.classList.contains('hidden')) {
        return;
    }

    const now = Date.now();
    const remainingMs = Math.max(0, timerEndTimestamp - now);
    const remainingSeconds = Math.ceil(remainingMs / 1000);
    const minutes = String(Math.floor(remainingSeconds / 60)).padStart(2, '0');
    const seconds = String(remainingSeconds % 60).padStart(2, '0');

    if (countdownEl) {
        countdownEl.textContent = `${minutes}:${seconds}`;
    }

    if (remainingMs <= 0) {
        completeToddlerTimer();
        return;
    }

    timerAnimationFrame = requestAnimationFrame(updateToddlerTimerDisplay);
}

function completeToddlerTimer() {
    cancelToddlerTimer({ silent: true });
    speakTts(`${timerLabelText || 'Timer'} is done!`);
    showStatus('Timer finished!', 'success');
}

function cancelToddlerTimer({ silent = false } = {}) {
    if (timerAnimationFrame) {
        cancelAnimationFrame(timerAnimationFrame);
        timerAnimationFrame = null;
    }
    if (typeof document !== 'undefined' && document.body) {
        document.body.classList.remove('timer-open');
    }
    const overlay = document.getElementById('timerOverlay');
    const countdownEl = document.getElementById('timerCountdown');
    if (overlay) {
        overlay.classList.add('hidden');
        overlay.classList.remove('flex');
    }
    if (countdownEl) {
        countdownEl.textContent = '00:00';
    }
    timerEndTimestamp = 0;
    timerDurationMs = 0;
    timerLabelText = '';
    if (!silent) {
        showStatus('Timer cancelled.', 'info');
    }
}

function startFireworksShow(durationSeconds = 6, message = 'Fireworks!') {
    const overlay = document.getElementById('fireworksOverlay');
    const labelEl = document.getElementById('fireworksLabel');

    if (!overlay || !labelEl) {
        console.warn('Fireworks overlay elements are missing.');
        return;
    }

    stopFireworksShow({ silent: true });

    const safeSeconds = Number(durationSeconds);
    const durationMs = Number.isFinite(safeSeconds) && safeSeconds > 0 ? safeSeconds * 1000 : 6000;
    const messageText = String(message || 'Fireworks!').trim() || 'Fireworks!';

    labelEl.textContent = messageText;
    if (typeof document !== 'undefined' && document.body) {
        document.body.classList.add('fireworks-open');
    }
    overlay.classList.remove('hidden');
    overlay.classList.add('flex');

    // Use canvas-confetti if available
    if (typeof confetti === 'function') {
        const colors = ['#fde68a', '#fca5a5', '#a5b4fc', '#7dd3fc', '#f9a8d4', '#bbf7d0'];

        const launchConfetti = () => {
            // Launch multiple bursts from different positions
            const count = 2 + Math.floor(Math.random() * 2);
            for (let i = 0; i < count; i++) {
                setTimeout(() => {
                    confetti({
                        particleCount: 50,
                        spread: 70,
                        origin: { x: Math.random() * 0.6 + 0.2, y: Math.random() * 0.5 + 0.3 },
                        colors: colors,
                        shapes: ['circle', 'square'],
                        gravity: 0.8,
                        scalar: 1.2,
                        drift: 0,
                        ticks: 200
                    });
                }, i * 100);
            }
        };

        launchConfetti();
        fireworksInterval = setInterval(launchConfetti, 600);
    } else {
        console.warn('Canvas confetti library not loaded');
    }

    fireworksTimeout = setTimeout(() => {
        stopFireworksShow({ silent: true });
    }, durationMs);

    speakTts(messageText);
    showStatus('Fireworks launched!', 'success');
}

function stopFireworksShow({ silent = false } = {}) {
    if (fireworksInterval) {
        clearInterval(fireworksInterval);
        fireworksInterval = null;
    }
    if (fireworksTimeout) {
        clearTimeout(fireworksTimeout);
        fireworksTimeout = null;
    }

    // Reset confetti if available
    if (typeof confetti === 'function' && typeof confetti.reset === 'function') {
        confetti.reset();
    }

    const overlay = document.getElementById('fireworksOverlay');
    if (overlay) {
        overlay.classList.add('hidden');
        overlay.classList.remove('flex');
    }
    if (typeof document !== 'undefined' && document.body) {
        document.body.classList.remove('fireworks-open');
    }

    if (!silent) {
        showStatus('Fireworks finished.', 'info');
    }
}

function createFireworkBurst(stage, options = {}) {
    if (!stage) return;
    const colors = ['#fde68a', '#fca5a5', '#a5b4fc', '#7dd3fc', '#f9a8d4', '#bbf7d0', '#fef3c7', '#bfdbfe'];
    const particleCount = options.particleCount ?? 32;
    const rect = stage.getBoundingClientRect();
    const stageWidth = rect.width || stage.clientWidth || 1;
    const stageHeight = rect.height || stage.clientHeight || 1;
    const originX = stageWidth * (0.15 + Math.random() * 0.7);
    const originY = stageHeight * (0.25 + Math.random() * 0.5);

    for (let i = 0; i < particleCount; i++) {
        const angle = (Math.PI * 2 * i) / particleCount + Math.random() * 0.5;
        const distance = 140 + Math.random() * 260;
        const targetX = originX + Math.cos(angle) * distance;
        const targetY = originY + Math.sin(angle) * distance;

        const particle = document.createElement('div');
        particle.className = 'firework-particle';
        particle.style.setProperty('--x', `${(targetX / stageWidth) * 100}%`);
        particle.style.setProperty('--y', `${(targetY / stageHeight) * 100}%`);
        const color = colors[Math.floor(Math.random() * colors.length)];
        particle.style.background = color;
        particle.style.animationDuration = `${520 + Math.random() * 720}ms`;
        particle.style.boxShadow = `0 0 24px 6px ${color}`;

        stage.appendChild(particle);

        setTimeout(() => {
            particle.remove();
        }, 1100);
    }
}

function getStoredGoveeConfig() {
    const ip = localStorage.getItem(GOVEE_IP_STORAGE_KEY) || '';
    const portValue = localStorage.getItem(GOVEE_PORT_STORAGE_KEY);
    const port = portValue ? Number(portValue) : null;
    return { ip, port: port && Number.isFinite(port) ? port : null };
}

function setStoredGoveeConfig({ ip, port }) {
    if (ip) {
        localStorage.setItem(GOVEE_IP_STORAGE_KEY, ip.trim());
    } else {
        localStorage.removeItem(GOVEE_IP_STORAGE_KEY);
    }

    if (port) {
        localStorage.setItem(GOVEE_PORT_STORAGE_KEY, String(port));
    } else {
        localStorage.removeItem(GOVEE_PORT_STORAGE_KEY);
    }
    updateGoveeUI();
}

function getStoredGoveeApiKey() {
    return localStorage.getItem(GOVEE_API_KEY_STORAGE_KEY) || '';
}

function setStoredGoveeApiKey(value) {
    if (value) {
        localStorage.setItem(GOVEE_API_KEY_STORAGE_KEY, value.trim());
    } else {
        localStorage.removeItem(GOVEE_API_KEY_STORAGE_KEY);
    }
    updateGoveeCloudUI();
}

function getStoredGoveeBrightness() {
    const raw = localStorage.getItem(GOVEE_BRIGHTNESS_STORAGE_KEY);
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= GOVEE_MIN_BRIGHTNESS && parsed <= 100) {
        return parsed;
    }
    return 80;
}

function setStoredGoveeBrightness(value) {
    localStorage.setItem(GOVEE_BRIGHTNESS_STORAGE_KEY, String(value));
}

function getGoveePowerStateKey(host, port) {
    return `${GOVEE_POWER_STATE_PREFIX}${host}:${port}`;
}

function getStoredGoveePowerState(target) {
    const key = getGoveePowerStateKey(target.host, target.port);
    const raw = localStorage.getItem(key);
    if (raw === 'on') return true;
    if (raw === 'off') return false;
    return null;
}

function setStoredGoveePowerState(target, state) {
    const key = getGoveePowerStateKey(target.host, target.port);
    localStorage.setItem(key, state ? 'on' : 'off');
}

function getGoveeIdentifierPowerStateKey(identifier) {
    const normalized = normalizeDeviceIdentifier(identifier);
    if (!normalized) return null;
    return `${GOVEE_POWER_STATE_PREFIX}cloud_${normalized}`;
}

function getStoredGoveeIdentifierPowerState(identifier) {
    const key = getGoveeIdentifierPowerStateKey(identifier);
    if (!key) return null;
    const raw = localStorage.getItem(key);
    if (raw === 'on') return true;
    if (raw === 'off') return false;
    return null;
}

function setStoredGoveeIdentifierPowerState(identifier, state) {
    const key = getGoveeIdentifierPowerStateKey(identifier);
    if (!key) return;
    localStorage.setItem(key, state ? 'on' : 'off');
}

// Device Registry System
const DEVICE_REGISTRY_KEY = 'device_registry';

function getDeviceRegistry() {
    try {
        const data = localStorage.getItem(DEVICE_REGISTRY_KEY);
        return data ? JSON.parse(data) : { govee: {} };
    } catch (error) {
        console.error('Failed to parse device registry:', error);
        return { govee: {} };
    }
}

function saveDeviceRegistry(registry) {
    try {
        localStorage.setItem(DEVICE_REGISTRY_KEY, JSON.stringify(registry));
    } catch (error) {
        console.error('Failed to save device registry:', error);
    }
}



function registerGoveeDevice(device) {
    const registry = getDeviceRegistry();
    const mac = device.mac_address || device.device_id;

    if (!mac) {
        console.warn('Cannot register Govee device without MAC address', device);
        return;
    }

    registry.govee[mac] = {
        mac,
        ip: device.ip,
        model: device.model,
        name: device.name,
        device_id: device.device_id,
        last_seen: Date.now()
    };

    saveDeviceRegistry(registry);
    console.log('✅ Registered Govee device:', mac, '→', device.ip);
}

function getDeviceByMac(type, mac) {
    const registry = getDeviceRegistry();
    return registry[type]?.[mac];
}

function getAllDevices() {
    const registry = getDeviceRegistry();
    return {
        govee: Object.values(registry.govee || {})
    };
}

function normalizeDeviceIdentifier(value) {
    if (typeof value !== 'string') return '';
    let normalized = value.trim();
    if (!normalized) return '';
    normalized = normalized.replace(/^govee:/i, '');
    normalized = normalized.replace(/^https?:\/\//i, '');
    normalized = normalized.replace(/-+/g, ':');
    if (normalized.endsWith('/')) {
        normalized = normalized.slice(0, -1);
    }
    return normalized.toLowerCase();
}

function isLikelyIpAddress(value) {
    if (typeof value !== 'string') return false;
    const trimmed = value.trim();
    if (!trimmed) return false;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(trimmed)) return true;
    if (/^\d{1,3}(\.\d{1,3}){3}:\d{1,5}$/.test(trimmed)) return true;
    if (/^\[(?:[0-9a-fA-F:]+)\](?::\d{1,5})?$/.test(trimmed)) return true;
    if (trimmed.includes('::') && /^[0-9a-fA-F:]+$/.test(trimmed)) return true;
    return false;
}

function findRegisteredGoveeDeviceByIdentifier(identifier) {
    const normalized = normalizeDeviceIdentifier(identifier);
    if (!normalized) return null;
    const registry = getDeviceRegistry();
    const entries = Object.values(registry.govee || {});
    for (const device of entries) {
        const candidates = [
            device.mac,
            device.device_id,
            device.ip,
            device.name
        ];
        if (candidates.some(candidate => normalizeDeviceIdentifier(candidate) === normalized)) {
            return device;
        }
    }
    return null;
}

function resolveGoveeOverridesFromDeviceIdentifier(identifier, fallbackPort = GOVEE_DEFAULT_PORT) {
    if (typeof identifier !== 'string') return null;
    const trimmed = identifier.trim();
    if (!trimmed) return null;
    const cleaned = trimmed.replace(/^govee:/i, '');

    if (isLikelyIpAddress(cleaned)) {
        return { ip: cleaned, port: fallbackPort || GOVEE_DEFAULT_PORT };
    }

    const registered = findRegisteredGoveeDeviceByIdentifier(cleaned);
    if (registered?.ip) {
        return { ip: registered.ip, port: fallbackPort || GOVEE_DEFAULT_PORT };
    }

    return null;
}

function resolveGoveeOverridesForStep(step) {
    if (!step) return null;
    const fallbackPort = Number(step.port) || GOVEE_DEFAULT_PORT;
    const candidates = [];

    const pushCandidate = value => {
        if (typeof value === 'string' && value.trim()) {
            candidates.push(value);
        }
    };

    pushCandidate(step.device);
    pushCandidate(step.mac);
    pushCandidate(step.ip);

    if (Array.isArray(step.devices)) {
        step.devices.forEach(deviceValue => {
            if (typeof deviceValue === 'string') {
                pushCandidate(deviceValue);
            } else if (deviceValue && typeof deviceValue === 'object') {
                pushCandidate(deviceValue.device);
                pushCandidate(deviceValue.ip);
            }
        });
    }

    for (const candidate of candidates) {
        const overrides = resolveGoveeOverridesFromDeviceIdentifier(candidate, fallbackPort);
        if (overrides) {
            return overrides;
        }
    }

    return null;
}

function findGoveeCloudDeviceByIdentifier(identifier) {
    const normalized = normalizeDeviceIdentifier(identifier);
    if (!normalized) return null;
    const list = Array.isArray(goveeCloudDevices) ? goveeCloudDevices : [];
    for (const device of list) {
        const deviceId = device?.device || device?.mac || device?.device_id;
        if (normalizeDeviceIdentifier(deviceId) === normalized) {
            return device;
        }
        const altId = device?.deviceName || device?.device_name || device?.name || device?.nickName;
        if (normalizeDeviceIdentifier(altId) === normalized) {
            return device;
        }
    }
    return null;
}

function resolveGoveeCloudTarget(step) {
    if (!step) return null;
    const identifier = step.mac || step.device;
    if (!identifier) return null;

    const normalized = normalizeDeviceIdentifier(identifier);
    if (!normalized) return null;

    const cloudDevice = findGoveeCloudDeviceByIdentifier(identifier);
    if (cloudDevice) {
        return {
            device: cloudDevice.device || identifier,
            model: cloudDevice.model || step.model || ''
        };
    }

    const registryMatch = findRegisteredGoveeDeviceByIdentifier(identifier);
    if (registryMatch) {
        return {
            device: identifier,
            model: registryMatch.model || step.model || ''
        };
    }

    return {
        device: identifier,
        model: step.model || ''
    };
}

async function sendGoveeCloudRoutineCommand(step, cmd) {
    if (!tauriInvoke) {
        setGoveeStatus('Cloud control requires running inside the Tauri app.', 'error');
        return false;
    }

    const apiKey = getStoredGoveeApiKey();
    if (!apiKey) {
        setGoveeStatus('Save your Govee API key to control lights via the cloud.', 'error');
        return false;
    }

    const target = resolveGoveeCloudTarget(step);
    if (!target || !target.device) {
        setGoveeStatus('That light is not linked to your Govee account yet. Refresh the cloud device list.', 'error');
        return false;
    }

    try {
        await tauriInvoke('govee_cloud_control', {
            apiKey,
            device: target.device,
            model: target.model || '',
            cmd
        });
        if (cmd?.name === 'turn' && target.device) {
            const rawValue = typeof cmd.value === 'string' ? cmd.value.toLowerCase() : cmd.value;
            if (rawValue === 'on' || rawValue === 1 || rawValue === true) {
                setStoredGoveeIdentifierPowerState(target.device, true);
            } else if (rawValue === 'off' || rawValue === 0 || rawValue === false) {
                setStoredGoveeIdentifierPowerState(target.device, false);
            }
        }
        return true;
    } catch (error) {
        console.error('Govee cloud command failed:', error);
        setGoveeStatus(`Cloud command failed: ${error.message || error}`, 'error');
        return false;
    }
}

async function discoverAndRegisterAllDevices() {
    console.log('🔄 Starting device discovery...');

    if (!isNativeRuntime) {
        console.warn('⚠️  Discovery requires native runtime');
        return;
    }

    try {
        // Discover Govee devices
        console.log('💡 Discovering Govee devices...');
        const goveeDevices = await tauriInvoke('govee_discover', { timeout_ms: 3000 });
        console.log(`Found ${goveeDevices.length} Govee device(s)`);
        goveeDevices.forEach(registerGoveeDevice);

        const allDevices = getAllDevices();
        console.log('✅ Discovery complete!');
        console.log(`   Total: ${allDevices.govee.length} Govee`);

        return allDevices;
    } catch (error) {
        console.error('❌ Discovery failed:', error);
        return null;
    }
}

async function refreshDeviceDiscovery() {
    const statusEl = document.getElementById('discoveryStatus');

    if (statusEl) {
        statusEl.classList.remove('hidden');
        statusEl.textContent = 'Discovering devices...';
    }

    const devices = await discoverAndRegisterAllDevices();

    if (devices) {
        populateDeviceSelector();
        if (statusEl) {
            statusEl.textContent = `Found ${devices.govee.length} Govee devices`;
        }
    } else {
        if (statusEl) {
            statusEl.textContent = 'Discovery failed';
        }
    }
}

function populateDeviceSelector() {
    const selector = document.getElementById('deviceSelector');
    if (!selector) return;

    const devices = getAllDevices();

    // Clear existing options except first
    selector.innerHTML = '<option value="">-- Select a device --</option>';



    // Add Govee devices
    devices.govee.forEach(device => {
        const option = document.createElement('option');
        option.value = `govee:${device.mac}`;
        const name = device.name || device.model || device.ip;
        option.textContent = `💡 ${name} (${device.ip})`;
        selector.appendChild(option);
    });
}

// Room Detection System
const ROOM_CONFIG_STORAGE_KEY = 'room_config';
const CURRENT_ROOM_STORAGE_KEY = 'current_room';
const ROOM_RSSI_HISTORY_KEY = 'room_rssi_history';

let roomConfig = null;
let currentRoom = null;
let roomDetectionInterval = null;
let rssiHistory = {};

async function loadRoomConfig() {
    try {
        const passphrase = getToddlerContentPassphrase().trim();

        // If passphrase is configured, try fetching from cloud (always fresh, no cache)
        if (passphrase) {
            const cloudUrl = buildCloudConfigUrl(passphrase, 'rooms');
            if (cloudUrl) {
                try {
                    const response = await fetch(cloudUrl, { cache: 'no-store' });
                    if (response.ok) {
                        roomConfig = await response.json();
                        console.log('📍 Loaded room config from cloud');
                        return roomConfig;
                    }
                } catch (error) {
                    console.warn('Failed to load room config from cloud, falling back:', error);
                }
            }
        }

        // Try to load custom room config from localStorage
        const stored = localStorage.getItem(ROOM_CONFIG_STORAGE_KEY);
        if (stored) {
            roomConfig = JSON.parse(stored);
            console.log('📍 Loaded room config from localStorage');
            return roomConfig;
        }

        // Fall back to default config file
        const response = await fetch('/config/rooms.json', { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`Failed to load rooms.json: ${response.status}`);
        }

        roomConfig = await response.json();
        console.log('📍 Loaded default room config from file');
        return roomConfig;
    } catch (error) {
        console.error('Failed to load room config:', error);
        // Return minimal default
        roomConfig = {
            rooms: [],
            settings: {
                autoDetect: false,
                scanInterval: 10000,
                rssiSampleSize: 3,
                detectionMode: 'manual',
                fallbackRoom: null
            }
        };
        return roomConfig;
    }
}

function saveRoomConfig(config) {
    try {
        localStorage.setItem(ROOM_CONFIG_STORAGE_KEY, JSON.stringify(config));
        roomConfig = config;
        console.log('💾 Room config saved');
    } catch (error) {
        console.error('Failed to save room config:', error);
    }
}

function getCurrentRoom() {
    if (currentRoom) return currentRoom;

    const stored = localStorage.getItem(CURRENT_ROOM_STORAGE_KEY);
    if (stored) {
        currentRoom = stored;
    }

    return currentRoom;
}

function setCurrentRoom(roomId, source = 'manual') {
    currentRoom = roomId;
    localStorage.setItem(CURRENT_ROOM_STORAGE_KEY, roomId);

    console.log(`📍 Room changed to: ${roomId} (source: ${source})`);

    // Trigger UI update
    updateRoomUI();
    filterControlsByRoom();

    // Dispatch custom event for other components
    window.dispatchEvent(new CustomEvent('roomChanged', {
        detail: { roomId, source }
    }));
}

async function scanBluetoothLE(timeoutMs) {
    // Use tauri-plugin-blec for BLE scanning (better Android support)
    return new Promise((resolve, reject) => {
        let devices = [];
        let scanError = null;
        let lastDeviceCount = 0;

        // Check if Tauri API is available
        if (!tauriBridge || !tauriBridge.core || !tauriBridge.core.Channel) {
            reject(new Error('Tauri BLE API not available. Running in native mode?'));
            return;
        }

        // Create a channel for receiving device updates
        const onDevices = new tauriBridge.core.Channel();
        onDevices.onmessage = (deviceList) => {
            const newDevices = deviceList || [];
            // Only log when device count changes
            if (newDevices.length !== lastDeviceCount) {
                console.log(`BLE scan update: ${newDevices.length} devices (was ${lastDeviceCount})`);
                lastDeviceCount = newDevices.length;
            }
            devices = newDevices;
        };

        // Set timeout to collect results - wait for full scan duration plus buffer
        const timeoutId = setTimeout(() => {
            if (scanError) {
                console.error('BLE scan failed:', scanError);
                reject(scanError);
                return;
            }

            console.log('BLE scan timeout reached. Final devices count:', devices.length);
            console.log('Raw devices:', devices);

            // Convert plugin format to our format
            const convertedDevices = (devices || []).map(d => ({
                address: d.address,
                name: d.name || 'Unknown',
                rssi: d.rssi,
                manufacturer_data: Object.entries(d.manufacturerData || d.manufacturer_data || {}).map(([id, data]) => ({
                    id: parseInt(id),
                    data: data.map(b => b.toString(16).padStart(2, '0')).join('')
                })),
                type: 'ble'
            }));
            console.log('Converted devices:', convertedDevices);
            resolve(convertedDevices);
        }, timeoutMs + 500); // Add 500ms buffer to ensure all channel messages arrive

        // Start the scan
        console.log('Starting BLE scan with timeout:', timeoutMs);
        tauriInvoke('plugin:blec|scan', {
            timeout: timeoutMs,
            allowIbeacons: false,
            onDevices: onDevices
        })
            .then(() => {
                console.log('BLE scan command completed successfully');
            })
            .catch((error) => {
                scanError = error;
                clearTimeout(timeoutId);
                console.error('BLE scan error:', error);
                reject(error);
            });
    });
}

async function scanForRoomDetection() {
    if (!isNativeRuntime || !tauriInvoke) {
        console.log('📍 Room detection requires native runtime');
        return null;
    }

    try {
        const timeout = roomConfig?.settings?.scanInterval || 5000;
        const devices = await scanBluetoothLE(timeout);

        console.log(`📍 Scanned ${devices.length} nearby BLE devices`);

        return devices;
    } catch (error) {
        console.error('Room scan failed:', error);
        return null;
    }
}

function detectRoomFromRSSI(scannedDevices) {
    if (!roomConfig || !roomConfig.rooms || roomConfig.rooms.length === 0) {
        console.log('📍 No room config available');
        return null;
    }

    if (!scannedDevices || scannedDevices.length === 0) {
        console.log('📍 No devices scanned');
        return null;
    }

    const mode = roomConfig.settings?.detectionMode || 'strongest_signal';

    if (mode === 'manual') {
        return null; // Don't auto-detect in manual mode
    }

    // Build RSSI map by device address
    const rssiMap = {};
    scannedDevices.forEach(device => {
        if (device.address && device.rssi !== null && device.rssi !== undefined) {
            rssiMap[device.address.toLowerCase()] = device.rssi;
        }
    });

    // Calculate room scores
    const roomScores = [];

    roomConfig.rooms.forEach(room => {
        if (!room.beacons || room.beacons.length === 0) {
            return; // Skip rooms with no beacons
        }

        let totalScore = 0;
        let matchedBeacons = 0;

        room.beacons.forEach(beacon => {
            const beaconAddr = beacon.address.toLowerCase();
            const rssi = rssiMap[beaconAddr];

            if (rssi !== undefined) {
                const threshold = beacon.rssiThreshold || -70;

                if (rssi >= threshold) {
                    // Stronger signal = higher score
                    // RSSI is negative, so -50 is better than -70
                    const score = 100 + rssi; // Convert to positive score
                    totalScore += score;
                    matchedBeacons++;
                }
            }
        });

        if (matchedBeacons > 0) {
            const averageScore = totalScore / matchedBeacons;
            roomScores.push({
                roomId: room.id,
                score: averageScore,
                matchedBeacons: matchedBeacons
            });
        }
    });

    if (roomScores.length === 0) {
        console.log('📍 No rooms matched');
        return roomConfig.settings?.fallbackRoom || null;
    }

    // Sort by score (highest first)
    roomScores.sort((a, b) => b.score - a.score);

    const detectedRoom = roomScores[0];
    console.log(`📍 Detected room: ${detectedRoom.roomId} (score: ${detectedRoom.score.toFixed(1)}, beacons: ${detectedRoom.matchedBeacons})`);

    return detectedRoom.roomId;
}

async function performRoomDetection() {
    if (!roomConfig?.settings?.autoDetect) {
        return;
    }

    const devices = await scanForRoomDetection();
    if (!devices) {
        return;
    }

    const detectedRoomId = detectRoomFromRSSI(devices);

    if (detectedRoomId && detectedRoomId !== currentRoom) {
        setCurrentRoom(detectedRoomId, 'auto');
    }
}

function startRoomDetection() {
    if (roomDetectionInterval) {
        stopRoomDetection();
    }

    if (!roomConfig?.settings?.autoDetect) {
        console.log('📍 Auto room detection is disabled');
        return;
    }

    const interval = roomConfig.settings.scanInterval || 10000;

    console.log(`📍 Starting room detection (scan every ${interval}ms)`);

    // Perform immediate scan
    performRoomDetection();

    // Set up periodic scanning
    roomDetectionInterval = setInterval(() => {
        performRoomDetection();
    }, interval);
}

function stopRoomDetection() {
    if (roomDetectionInterval) {
        clearInterval(roomDetectionInterval);
        roomDetectionInterval = null;
        console.log('📍 Room detection stopped');
    }
}

async function toggleRoomAutoDetect() {
    if (!roomConfig) {
        showStatus('No room configuration loaded', 'error');
        return;
    }

    if (!isNativeRuntime) {
        showStatus('Auto room detection requires the native app', 'error');
        return;
    }

    // Toggle the setting
    const newState = !roomConfig.settings.autoDetect;
    roomConfig.settings.autoDetect = newState;
    saveRoomConfig(roomConfig);

    // Update UI
    updateRoomUI();

    // Start or stop detection based on new state
    if (newState) {
        startRoomDetection();
        showStatus('🔍 Auto room detection enabled', 'success');
    } else {
        stopRoomDetection();
        showStatus('🔍 Auto room detection disabled', 'success');
    }
}

async function manuallyLocateRoom() {
    if (!roomConfig || roomConfig.rooms.length === 0) {
        showStatus('No rooms configured', 'error');
        return;
    }

    if (!isNativeRuntime) {
        showStatus('Room detection requires the native app', 'error');
        return;
    }

    const button = document.getElementById('roomLocateButton');
    if (button) {
        button.disabled = true;
    }

    try {
        showStatus('📡 Scanning for nearby devices...', 'info');

        // Scan for devices (works regardless of autoDetect setting)
        const devices = await scanForRoomDetection();
        if (!devices) {
            showStatus('❌ Failed to scan for devices', 'error');
            return;
        }

        // Detect room from RSSI
        const detectedRoomId = detectRoomFromRSSI(devices);

        if (detectedRoomId) {
            // Find room data to show the name
            const roomData = roomConfig.rooms.find(r => r.id === detectedRoomId);
            const roomName = roomData ? `${roomData.emoji || '📍'} ${roomData.name}` : detectedRoomId;

            // Update current room
            setCurrentRoom(detectedRoomId, 'manual');
            showStatus(`✅ Found room: ${roomName}`, 'success');
        } else {
            showStatus('📍 No matching room found', 'info');
        }
    } catch (error) {
        console.error('Manual room detection failed:', error);
        showStatus('❌ Room detection failed', 'error');
    } finally {
        if (button) {
            button.disabled = false;
        }
    }
}

function filterControlsByRoom() {
    // Filter buttons/controls to show only those relevant to current room

    const room = getCurrentRoom();

    if (!roomConfig) {
        return;
    }

    if (room) {
        const roomData = roomConfig.rooms.find(r => r.id === room);
        if (roomData) {
            console.log(`🔍 Filtering controls for room: ${roomData.name}`);
            console.log(`  Govee devices:`, roomData.devices?.govee || []);
        }
    } else {
        console.log(`🔍 Showing all controls (no room selected)`);
    }

    // Re-render lights buttons with room filtering
    if (tabsConfig && Array.isArray(tabsConfig.tabs)) {
        const lightsTab = tabsConfig.tabs.find(tab => tab.id === 'lights');
        if (lightsTab && Array.isArray(lightsTab.buttons)) {
            renderLightsButtons(lightsTab.buttons);
        }
    }
}

// Bluetooth Scanner UI Functions
async function scanBluetoothDevices() {
    if (!isNativeRuntime || !tauriInvoke) {
        showStatus('Bluetooth scanning requires native runtime', 'error');
        return;
    }

    const button = document.getElementById('btScanButton');
    const status = document.getElementById('btScanStatus');
    const resultsDiv = document.getElementById('btScanResults');
    const deviceList = document.getElementById('btDeviceList');
    const deviceCount = document.getElementById('btDeviceCount');

    // Update UI to scanning state
    button.disabled = true;
    button.textContent = '⏳ Scanning...';
    status.textContent = 'Scanning for Bluetooth devices (5 seconds)...';
    deviceList.innerHTML = '';
    resultsDiv.classList.add('hidden');

    try {
        const devices = await scanBluetoothLE(5000);

        console.log(`📡 Bluetooth scan complete: ${devices.length} devices found`, devices);

        // Filter out info messages
        const realDevices = devices.filter(d => d.type !== 'info');

        // Update device count
        deviceCount.textContent = `${realDevices.length} device${realDevices.length !== 1 ? 's' : ''}`;

        if (realDevices.length === 0) {
            deviceList.innerHTML = `
                <div class="rounded-2xl bg-white/10 p-4 text-center text-sm text-indigo-100/80">
                    No Bluetooth devices found. Make sure Bluetooth is enabled and devices are nearby.
                </div>
            `;
        } else {
            // Sort by RSSI (strongest signal first)
            realDevices.sort((a, b) => (b.rssi || -999) - (a.rssi || -999));

            // Create device cards
            realDevices.forEach(device => {
                const card = createBluetoothDeviceCard(device);
                deviceList.appendChild(card);
            });
        }

        // Show results
        resultsDiv.classList.remove('hidden');
        status.textContent = `Scan complete! Found ${realDevices.length} device${realDevices.length !== 1 ? 's' : ''}`;

        // Save to cloud if passphrase is set
        if (realDevices.length > 0) {
            const saved = await saveDeviceListToCloud(realDevices, 'ble');
            if (saved) {
                console.log('💾 BLE scan results saved to cloud');
            }
        }

    } catch (error) {
        console.error('Bluetooth scan failed:', error);
        status.textContent = `Scan failed: ${error}`;
        showStatus(`Bluetooth scan failed: ${error}`, 'error');
    } finally {
        // Reset button
        button.disabled = false;
        button.textContent = '🔍 Scan for Devices';
    }
}

function createBluetoothDeviceCard(device) {
    const card = document.createElement('div');
    card.className = 'rounded-2xl bg-white/10 p-4 space-y-3 border border-white/10 hover:border-white/30 transition';

    const rssi = device.rssi !== null && device.rssi !== undefined ? device.rssi : null;
    const rssiColor = rssi ? getSignalStrengthColor(rssi) : 'text-gray-400';
    const rssiLabel = rssi ? getSignalStrengthLabel(rssi) : 'Unknown';

    card.innerHTML = `
        <div class="flex items-start justify-between gap-3">
            <div class="flex-1 min-w-0">
                <div class="font-semibold text-white truncate">
                    ${device.name || 'Unknown Device'}
                </div>
                <div class="mt-1 font-mono text-xs text-indigo-200/80 truncate">
                    ${device.address}
                </div>
            </div>
            <div class="flex flex-col items-end gap-1">
                <div class="font-mono text-lg font-bold ${rssiColor}">
                    ${rssi !== null ? rssi + ' dBm' : '—'}
                </div>
                <div class="text-xs ${rssiColor}">
                    ${rssiLabel}
                </div>
            </div>
        </div>
        ${device.manufacturer_data && device.manufacturer_data.length > 0 ? `
            <details class="text-xs">
                <summary class="cursor-pointer text-indigo-200/70 hover:text-indigo-200">Manufacturer Data</summary>
                <div class="mt-2 font-mono text-indigo-100/60 break-all">
                    ${device.manufacturer_data.map(m => `ID ${m.id}: ${m.data}`).join('<br>')}
                </div>
            </details>
        ` : ''}
        <button
            onclick="copyToClipboard('${device.address}')"
            class="w-full rounded-lg bg-white/10 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/20">
            📋 Copy Address
        </button>
    `;

    return card;
}

function getSignalStrengthColor(rssi) {
    if (rssi >= -50) return 'text-emerald-400';
    if (rssi >= -70) return 'text-yellow-400';
    if (rssi >= -80) return 'text-orange-400';
    return 'text-red-400';
}

function getSignalStrengthLabel(rssi) {
    if (rssi >= -50) return '🟢 Very Strong';
    if (rssi >= -70) return '🟡 Good';
    if (rssi >= -80) return '🟠 Fair';
    return '🔴 Weak';
}

async function copyToClipboard(text) {
    try {
        if (navigator.clipboard) {
            await navigator.clipboard.writeText(text);
            showStatus('Address copied to clipboard!', 'success');
        } else {
            // Fallback for older browsers
            const textarea = document.createElement('textarea');
            textarea.value = text;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            showStatus('Address copied!', 'success');
        }
    } catch (error) {
        console.error('Failed to copy:', error);
        showStatus(`Failed to copy: ${error}`, 'error');
    }
}

function updateRoomUI() {
    const room = getCurrentRoom();
    const roomIndicator = document.getElementById('currentRoomIndicator');
    const roomSelector = document.getElementById('roomSelector');
    const roomSelectorBar = document.getElementById('roomSelectorBar');
    const autoDetectToggle = document.getElementById('roomAutoDetectToggle');
    const autoDetectIcon = document.getElementById('roomAutoDetectIcon');

    console.log('🏠 updateRoomUI called', {
        hasRoomConfig: !!roomConfig,
        roomsCount: roomConfig?.rooms?.length || 0,
        currentRoom: room,
        elementsFound: {
            roomIndicator: !!roomIndicator,
            roomSelector: !!roomSelector,
            roomSelectorBar: !!roomSelectorBar
        }
    });

    if (!roomIndicator || !roomSelector) {
        console.warn('⚠️ Room UI elements not found in DOM');
        return;
    }

    // Populate room selector dropdown with inline styles for Windows compatibility
    if (roomConfig && roomConfig.rooms && roomConfig.rooms.length > 0) {
        console.log('✅ Showing room selector with', roomConfig.rooms.length, 'rooms');
        // Clear and add "All Rooms" option with inline styling
        roomSelector.innerHTML = '';
        const allRoomsOption = document.createElement('option');
        allRoomsOption.value = '';
        allRoomsOption.textContent = 'All Rooms';
        allRoomsOption.style.backgroundColor = '#1e1b4b';
        allRoomsOption.style.color = 'white';
        roomSelector.appendChild(allRoomsOption);

        // Add room options with inline styling
        roomConfig.rooms.forEach(r => {
            const option = document.createElement('option');
            option.value = r.id;
            option.textContent = `${r.emoji || '📍'} ${r.name}`;
            option.style.backgroundColor = '#1e1b4b';
            option.style.color = 'white';
            roomSelector.appendChild(option);
        });

        // Show room selector bar
        if (roomSelectorBar) {
            console.log('✅ Removing hidden class from roomSelectorBar');
            roomSelectorBar.classList.remove('hidden');
        } else {
            console.warn('⚠️ roomSelectorBar element not found!');
        }
    } else {
        console.log('❌ Room config not ready or no rooms available', {
            hasRoomConfig: !!roomConfig,
            hasRooms: !!roomConfig?.rooms,
            roomsLength: roomConfig?.rooms?.length
        });
    }

    // Update auto-detect toggle button appearance
    if (autoDetectToggle && autoDetectIcon) {
        const isAutoDetectEnabled = roomConfig?.settings?.autoDetect || false;
        if (isAutoDetectEnabled) {
            autoDetectToggle.classList.add('bg-green-500/30', 'border-green-400/50');
            autoDetectToggle.classList.remove('bg-white/10', 'border-white/30');
            autoDetectIcon.textContent = '🔍✓';
            autoDetectToggle.title = 'Auto room detection enabled (click to disable)';
        } else {
            autoDetectToggle.classList.remove('bg-green-500/30', 'border-green-400/50');
            autoDetectToggle.classList.add('bg-white/10', 'border-white/30');
            autoDetectIcon.textContent = '🔍';
            autoDetectToggle.title = 'Auto room detection disabled (click to enable)';
        }
    }

    // Update current room display
    if (room && roomConfig) {
        const roomData = roomConfig.rooms.find(r => r.id === room);
        if (roomData) {
            roomIndicator.textContent = `${roomData.emoji || '📍'} ${roomData.name}`;
            roomIndicator.classList.remove('hidden');
            roomSelector.value = room;
        }
    } else {
        roomIndicator.textContent = '📍 All Rooms';
        roomIndicator.classList.remove('hidden');
        if (roomSelector) {
            roomSelector.value = '';
        }
    }
}

function handleDeviceSelection() {
    const selector = document.getElementById('deviceSelector');
    const detailsEl = document.getElementById('deviceDetails');
    const commandsEl = document.getElementById('deviceCommands');

    if (!selector || !detailsEl || !commandsEl) return;

    const value = selector.value;

    if (!value) {
        detailsEl.classList.add('hidden');
        commandsEl.innerHTML = '';
        return;
    }

    const [type, id] = value.split(':');
    const device = getDeviceByMac(type, id);

    if (!device) return;

    // Show device details
    detailsEl.classList.remove('hidden');

    if (type === 'roku') {
        detailsEl.innerHTML = `
            <div class="space-y-2">
                <div><strong>Type:</strong> Roku Device</div>
                <div><strong>IP:</strong> ${device.ip}</div>
                ${device.friendly_name ? `<div><strong>Name:</strong> ${device.friendly_name}</div>` : ''}
                ${device.model_name ? `<div><strong>Model:</strong> ${device.model_name}</div>` : ''}
                ${device.serial_number ? `<div><strong>Serial:</strong> ${device.serial_number}</div>` : ''}
                <div><strong>Last Seen:</strong> ${new Date(device.last_seen).toLocaleString()}</div>
            </div>
        `;

        // Show Roku commands
        commandsEl.innerHTML = `
            <button onclick="testRokuCommand('${device.ip}', 'Home')" class="w-full rounded-xl bg-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/40">🏠 Home</button>
            <button onclick="testRokuCommand('${device.ip}', 'Select')" class="w-full rounded-xl bg-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/40">⭕ Select</button>
            <button onclick="testRokuCommand('${device.ip}', 'Play')" class="w-full rounded-xl bg-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/40">⏯️ Play</button>
            <button onclick="testRokuCommand('${device.ip}', 'Back')" class="w-full rounded-xl bg-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/40">⬅️ Back</button>
            <button onclick="testRokuInfo('${device.ip}')" class="w-full rounded-xl bg-emerald-500/30 px-4 py-2 text-sm text-white transition hover:bg-emerald-500/40 focus:outline-none focus:ring-2 focus:ring-emerald-300/60">ℹ️ Get Device Info</button>
        `;
    } else if (type === 'govee') {
        detailsEl.innerHTML = `
            <div class="space-y-2">
                <div><strong>Type:</strong> Govee Light</div>
                <div><strong>IP:</strong> ${device.ip}</div>
                ${device.name ? `<div><strong>Name:</strong> ${device.name}</div>` : ''}
                ${device.model ? `<div><strong>Model:</strong> ${device.model}</div>` : ''}
                <div><strong>MAC:</strong> ${device.mac}</div>
                <div><strong>Last Seen:</strong> ${new Date(device.last_seen).toLocaleString()}</div>
            </div>
        `;

        // Show Govee commands
        commandsEl.innerHTML = `
            <button onclick="testGoveeCommand('${device.ip}', 'on')" class="w-full rounded-xl bg-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/40">💡 Turn On</button>
            <button onclick="testGoveeCommand('${device.ip}', 'off')" class="w-full rounded-xl bg-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/40">⚫ Turn Off</button>
            <button onclick="testGoveeCommand('${device.ip}', 'brightness', 100)" class="w-full rounded-xl bg-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/40">🔆 Full Brightness</button>
            <button onclick="testGoveeCommand('${device.ip}', 'brightness', 50)" class="w-full rounded-xl bg-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/40">🔅 50% Brightness</button>
            <button onclick="testGoveeCommand('${device.ip}', 'color', {r:255,g:0,b:0})" class="w-full rounded-xl bg-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/40">🔴 Red</button>
            <button onclick="testGoveeCommand('${device.ip}', 'status')" class="w-full rounded-xl bg-emerald-500/30 px-4 py-2 text-sm text-white transition hover:bg-emerald-500/40 focus:outline-none focus:ring-2 focus:ring-emerald-300/60">ℹ️ Get Status</button>
        `;
    }
}

async function testRokuCommand(ip, key) {
    const statusEl = document.getElementById('discoveryStatus');

    try {
        const url = `http://${ip}:8060/keypress/${key}`;
        await tauriInvoke('roku_post', { url, body: null });

        if (statusEl) {
            statusEl.classList.remove('hidden');
            statusEl.textContent = `✅ Sent ${key} to Roku at ${ip}`;
        }
    } catch (error) {
        if (statusEl) {
            statusEl.classList.remove('hidden');
            statusEl.textContent = `❌ Failed to send ${key}: ${error}`;
        }
    }
}

async function testRokuInfo(ip) {
    const statusEl = document.getElementById('discoveryStatus');

    try {
        const url = `http://${ip}:8060/query/device-info`;
        const result = await tauriInvoke('roku_get', { url });
        console.log('📱 Roku device info:', result);

        if (statusEl) {
            statusEl.classList.remove('hidden');
            statusEl.textContent = `✅ Got device info - check console`;
        }
    } catch (error) {
        if (statusEl) {
            statusEl.classList.remove('hidden');
            statusEl.textContent = `❌ Failed to get info: ${error}`;
        }
    }
}

async function testGoveeCommand(ip, command, value) {
    const statusEl = document.getElementById('discoveryStatus');

    try {
        if (command === 'status') {
            const result = await tauriInvoke('govee_status', { host: ip, port: 4003 });
            console.log('💡 Govee status:', result);
            if (statusEl) {
                statusEl.classList.remove('hidden');
                statusEl.textContent = `✅ Status: ${result.online ? 'Online' : 'Offline'}, Power: ${result.power ? 'ON' : 'OFF'} - check console`;
            }
            return;
        }

        let body;
        if (command === 'on') {
            body = { msg: { cmd: 'turn', data: { value: 1 } } };
        } else if (command === 'off') {
            body = { msg: { cmd: 'turn', data: { value: 0 } } };
        } else if (command === 'brightness') {
            body = { msg: { cmd: 'brightness', data: { value } } };
        } else if (command === 'color') {
            body = { msg: { cmd: 'colorwc', data: { color: value, colorTemInKelvin: 0 } } };
        }

        await tauriInvoke('govee_send', { host: ip, port: 4003, body });

        if (statusEl) {
            statusEl.classList.remove('hidden');
            statusEl.textContent = `✅ Sent ${command} to Govee at ${ip}`;
        }
    } catch (error) {
        if (statusEl) {
            statusEl.classList.remove('hidden');
            statusEl.textContent = `❌ Failed to send ${command}: ${error}`;
        }
    }
}

function parseGoveeOverrides(ipOrOptions, portArg) {
    if (Array.isArray(ipOrOptions)) {
        const [first, second] = ipOrOptions;
        return parseGoveeOverrides(first, second ?? portArg);
    }

    const overrides = {};

    if (typeof ipOrOptions === 'object' && ipOrOptions !== null) {
        if (ipOrOptions.ip || ipOrOptions.host) {
            overrides.ip = ipOrOptions.ip ?? ipOrOptions.host;
        }
        if (ipOrOptions.port !== undefined) {
            overrides.port = ipOrOptions.port;
        }
    } else if (typeof ipOrOptions === 'string' && ipOrOptions.trim()) {
        overrides.ip = ipOrOptions.trim();
    } else if (typeof ipOrOptions === 'number' && Number.isFinite(ipOrOptions)) {
        overrides.port = ipOrOptions;
    }

    if (portArg !== undefined && portArg !== null && portArg !== '') {
        overrides.port = portArg;
    }

    return overrides;
}

function resolveGoveeTarget(overrides = {}) {
    const { ip: storedIp, port: storedPort } = getStoredGoveeConfig();
    let ipCandidate = overrides.ip !== undefined && overrides.ip !== null && String(overrides.ip).trim()
        ? String(overrides.ip).trim()
        : (storedIp || '');

    if (!ipCandidate) {
        throw new Error('Enter the Govee light IP address in settings or pass it into the button.');
    }

    let protocol = 'http://';
    const protocolMatch = ipCandidate.match(/^(https?:\/\/)/i);
    if (protocolMatch) {
        protocol = protocolMatch[1].toLowerCase();
        ipCandidate = ipCandidate.slice(protocolMatch[1].length);
    }

    if (ipCandidate.includes('/')) {
        ipCandidate = ipCandidate.split('/')[0];
    }

    let host = ipCandidate;
    let explicitPort = null;

    if (host.includes(':')) {
        const hostParts = host.split(':');
        const potentialPort = Number(hostParts.pop());
        if (Number.isFinite(potentialPort)) {
            explicitPort = potentialPort;
        } else {
            hostParts.push(String(potentialPort));
        }
        host = hostParts.join(':') || host;
    }

    let port = overrides.port !== undefined && overrides.port !== null && overrides.port !== ''
        ? Number(overrides.port)
        : (explicitPort ?? storedPort ?? GOVEE_DEFAULT_PORT);

    if (!Number.isFinite(port) || port <= 0) {
        port = GOVEE_DEFAULT_PORT;
    }

    return { protocol, host, port };
}

function buildGoveeUrl(pathname = '/devices/control', overrides = {}) {
    const target = resolveGoveeTarget(overrides);
    const safePath = pathname.startsWith('/') ? pathname : `/${pathname}`;
    return {
        url: `${target.protocol}${target.host}:${target.port}${safePath}`,
        target
    };
}

function setGoveeStatus(message, variant = 'info') {
    const statusEl = document.getElementById('goveeStatus');
    if (!statusEl) return;

    const baseClasses = 'mt-4 rounded-2xl px-4 py-3 text-sm font-semibold transition-colors';
    const variantClasses = GOVEE_STATUS_VARIANTS[variant] || GOVEE_STATUS_VARIANTS.info;
    statusEl.className = `${baseClasses} ${variantClasses}`;
    statusEl.textContent = message;
}

function setGoveeCloudStatus(message, variant = 'info') {
    const statusEl = document.getElementById('goveeCloudStatus');
    if (!statusEl) return;

    const baseClasses = 'rounded-2xl px-4 py-3 text-sm font-semibold transition-colors';
    const variantClasses = GOVEE_STATUS_VARIANTS[variant] || GOVEE_STATUS_VARIANTS.info;
    statusEl.className = `${baseClasses} ${variantClasses}`;
    statusEl.textContent = message;
}

async function sendGoveeCommand(command, overrides = {}) {
    const { url, target } = buildGoveeUrl('/devices/control', overrides);
    const payload = { msg: command };

    if (goveeLanBridge?.send) {
        await goveeLanBridge.send({ host: target.host, port: target.port, body: payload });
        return { data: null, target };
    }

    const environmentLabel = isNativeRuntime ? 'native shell' : 'web mode';
    throw new Error(
        `Govee LAN control requires the Tauri native shell (currently running in ${environmentLabel}). Build the Tauri app to send UDP packets from this device.`
    );
}

function normalizeGoveePowerValue(raw) {
    if (Array.isArray(raw) && raw.length > 0) {
        return normalizeGoveePowerValue(raw[0]);
    }

    if (typeof raw === 'string') {
        const normalized = raw.trim().toLowerCase();
        if (['on', 'true', '1', 'yes', 'start'].includes(normalized)) {
            return true;
        }
        if (['off', 'false', '0', 'no', 'stop'].includes(normalized)) {
            return false;
        }
    }

    if (typeof raw === 'number') {
        return raw > 0;
    }

    return Boolean(raw);
}

async function goveePower(turnOn = true, ipOrOptions, portArg) {
    let overrides = {};
    let requestedState = turnOn;

    if (Array.isArray(turnOn)) {
        overrides = { ...overrides, ...parseGoveeOverrides(turnOn[1], turnOn[2]) };
        requestedState = turnOn[0];
    } else if (typeof turnOn === 'object' && turnOn !== null) {
        overrides = { ...overrides, ...parseGoveeOverrides(turnOn) };
        requestedState = turnOn.value ?? turnOn.state ?? true;
    }

    overrides = { ...overrides, ...parseGoveeOverrides(ipOrOptions, portArg) };
    const desired = normalizeGoveePowerValue(requestedState);

    try {
        const { target } = await sendGoveeCommand({ cmd: 'turn', data: { value: desired ? 1 : 0 } }, overrides);
        const targetLabel = `${target.host}:${target.port}`;
        const message = desired
            ? `Govee lights at ${targetLabel} turned on.`
            : `Govee lights at ${targetLabel} turned off.`;
        setStoredGoveePowerState(target, desired);
        setGoveeStatus(message, 'success');
        showStatus(message, 'success');
    } catch (error) {
        console.error('Govee power command failed', error);
        setGoveeStatus('Could not reach the Govee light. Double-check the IP and LAN control.', 'error');
        showStatus('Govee light unreachable. Check the IP and LAN control settings.', 'error');
    }
}

async function goveeApplyBrightness(value, ipOrOptions, portArg) {
    let overrides = {};
    let requestedValue = value;

    if (Array.isArray(value)) {
        overrides = { ...overrides, ...parseGoveeOverrides(value[1], value[2]) };
        requestedValue = value[0];
    } else if (typeof value === 'object' && value !== null) {
        overrides = { ...overrides, ...parseGoveeOverrides(value) };
        requestedValue = value.value ?? value.level ?? getStoredGoveeBrightness();
    }

    overrides = { ...overrides, ...parseGoveeOverrides(ipOrOptions, portArg) };

    const normalized = Math.max(GOVEE_MIN_BRIGHTNESS, Math.min(100, Math.round(requestedValue)));
    if (!overrides.ip && !overrides.port) {
        setStoredGoveeBrightness(normalized);
    }
    updateGoveeBrightnessLabel(normalized);

    try {
        const { target } = await sendGoveeCommand({ cmd: 'brightness', data: { value: normalized } }, overrides);
        const targetLabel = `${target.host}:${target.port}`;
        setGoveeStatus(`Brightness set to ${normalized}% for ${targetLabel}.`, 'success');
    } catch (error) {
        console.error('Govee brightness command failed', error);
        setGoveeStatus('Could not update brightness. Make sure LAN control is enabled.', 'error');
    }
}

async function goveeSetColor(r, g, b, ipOrOptions, portArg) {
    let overrides = parseGoveeOverrides(ipOrOptions, portArg);

    if (Array.isArray(r)) {
        const [red, green, blue, ipOverride, portOverride] = r;
        overrides = { ...overrides, ...parseGoveeOverrides(ipOverride, portOverride) };
        return goveeSetColor(red, green ?? 0, blue ?? 0, overrides);
    }

    if (typeof r === 'object' && r !== null) {
        overrides = { ...overrides, ...parseGoveeOverrides(r) };
        return goveeSetColor(r.r ?? r.red ?? 255, r.g ?? r.green ?? 255, r.b ?? r.blue ?? 255, overrides);
    }

    const color = {
        r: Math.max(0, Math.min(255, Math.round(r))),
        g: Math.max(0, Math.min(255, Math.round(g))),
        b: Math.max(0, Math.min(255, Math.round(b)))
    };

    try {
        const { target } = await sendGoveeCommand({ cmd: 'color', data: color }, overrides);
        const targetLabel = `${target.host}:${target.port}`;
        setGoveeStatus(`Color set to RGB(${color.r}, ${color.g}, ${color.b}) for ${targetLabel}.`, 'success');
    } catch (error) {
        console.error('Govee color command failed', error);
        setGoveeStatus('Could not change color. Verify LAN control and try again.', 'error');
    }
}

async function goveeTogglePower(ipOrOptions, portArg) {
    const overrides = parseGoveeOverrides(ipOrOptions, portArg);
    const target = resolveGoveeTarget(overrides);
    const storedState = getStoredGoveePowerState(target);
    const desired = !(storedState ?? false);
    return goveePower(desired, overrides);
}

async function goveeSetWarmWhite(ipOrOptions, portArg) {
    await goveeSetColor(255, 230, 200, ipOrOptions, portArg);
}

async function goveeSetOceanBlue(ipOrOptions, portArg) {
    await goveeSetColor(120, 180, 255, ipOrOptions, portArg);
}

async function goveeSetSunsetGlow(ipOrOptions, portArg) {
    await goveeSetColor(255, 140, 90, ipOrOptions, portArg);
}

// Multi-device Govee handlers - control multiple lights at once
async function goveeMultiPower(turnOn = true, devices = []) {
    if (!Array.isArray(devices) || devices.length === 0) {
        console.warn('goveeMultiPower: No devices specified');
        setGoveeStatus('No devices specified for multi-light control', 'error');
        return;
    }

    console.log(`🔄 Sending power ${turnOn ? 'ON' : 'OFF'} to ${devices.length} device(s)`);
    const promises = devices.map(device => {
        const [ip, port] = Array.isArray(device) ? device : [device, 4003];
        return goveePower(turnOn, { ip, port: port || 4003 }).catch(err => {
            console.error(`Failed to control ${ip}:`, err);
            return null;
        });
    });

    await Promise.all(promises);
    setGoveeStatus(`Sent power ${turnOn ? 'ON' : 'OFF'} to ${devices.length} device(s)`, 'success');
}

async function goveeMultiToggle(devices = []) {
    if (!Array.isArray(devices) || devices.length === 0) {
        console.warn('goveeMultiToggle: No devices specified');
        setGoveeStatus('No devices specified for multi-light control', 'error');
        return;
    }

    console.log(`🔄 Toggling ${devices.length} device(s)`);
    const promises = devices.map(device => {
        const [ip, port] = Array.isArray(device) ? device : [device, 4003];
        return goveeTogglePower({ ip, port: port || 4003 }).catch(err => {
            console.error(`Failed to toggle ${ip}:`, err);
            return null;
        });
    });

    await Promise.all(promises);
    setGoveeStatus(`Toggled ${devices.length} device(s)`, 'success');
}

async function goveeMultiBrightness(brightness, devices = []) {
    if (!Array.isArray(devices) || devices.length === 0) {
        console.warn('goveeMultiBrightness: No devices specified');
        setGoveeStatus('No devices specified for multi-light control', 'error');
        return;
    }

    console.log(`🔄 Setting brightness to ${brightness}% on ${devices.length} device(s)`);
    const promises = devices.map(device => {
        const [ip, port] = Array.isArray(device) ? device : [device, 4003];
        return goveeSetBrightness(brightness, { ip, port: port || 4003 }).catch(err => {
            console.error(`Failed to set brightness on ${ip}:`, err);
            return null;
        });
    });

    await Promise.all(promises);
    setGoveeStatus(`Set brightness to ${brightness}% on ${devices.length} device(s)`, 'success');
}

async function goveeMultiColor(r, g, b, devices = []) {
    if (!Array.isArray(devices) || devices.length === 0) {
        console.warn('goveeMultiColor: No devices specified');
        setGoveeStatus('No devices specified for multi-light control', 'error');
        return;
    }

    console.log(`🔄 Setting color RGB(${r}, ${g}, ${b}) on ${devices.length} device(s)`);
    const promises = devices.map(device => {
        const [ip, port] = Array.isArray(device) ? device : [device, 4003];
        return goveeSetColor(r, g, b, { ip, port: port || 4003 }).catch(err => {
            console.error(`Failed to set color on ${ip}:`, err);
            return null;
        });
    });

    await Promise.all(promises);
    setGoveeStatus(`Set color RGB(${r}, ${g}, ${b}) on ${devices.length} device(s)`, 'success');
}

async function lightRoutine(routine) {
    if (!Array.isArray(routine) || routine.length === 0) {
        console.warn('lightRoutine: No steps specified');
        setGoveeStatus('No steps specified in light routine', 'error');
        return;
    }

    console.log(`🎬 Executing light routine with ${routine.length} step(s)`);
    setGoveeStatus(`Running routine: ${routine.length} step(s)...`, 'info');

    for (let i = 0; i < routine.length; i++) {
        const step = routine[i];
        console.log(`Step ${i + 1}/${routine.length}:`, step);

        try {
            switch (step.type) {
                case 'power': {
                    const overrides = resolveGoveeOverridesForStep(step);
                    if (overrides) {
                        if (step.value === 'toggle') {
                            await goveeTogglePower(overrides);
                        } else {
                            const turnOn = normalizeGoveePowerValue(step.value);
                            await goveePower(turnOn, overrides);
                        }
                        break;
                    }

                    console.warn('lightRoutine power step missing resolvable LAN device:', step);
                    const identifier = step.mac || step.device;
                    let desired = step.value === 'toggle'
                        ? 'toggle'
                        : normalizeGoveePowerValue(step.value) ? 'on' : 'off';

                    if (desired === 'toggle') {
                        const stored = getStoredGoveeIdentifierPowerState(identifier);
                        if (stored === null) {
                            desired = 'on';
                        } else {
                            desired = stored ? 'off' : 'on';
                        }
                    }

                    const sent = await sendGoveeCloudRoutineCommand(step, { name: 'turn', value: desired });
                    if (!sent) {
                        continue;
                    }
                    break;
                }

                case 'brightness': {
                    const overrides = resolveGoveeOverridesForStep(step);
                    const brightness = parseInt(step.value, 10);

                    if (overrides) {
                        await goveeApplyBrightness(brightness, overrides);
                        break;
                    }

                    console.warn('lightRoutine brightness step missing resolvable LAN device:', step);
                    const brightnessSent = await sendGoveeCloudRoutineCommand(step, {
                        name: 'brightness',
                        value: brightness
                    });
                    if (!brightnessSent) {
                        continue;
                    }
                    break;
                }

                case 'color': {
                    const overrides = resolveGoveeOverridesForStep(step);
                    const rgb = step.value.split(',').map(v => parseInt(v.trim(), 10));
                    if (rgb.length !== 3 || rgb.some(val => Number.isNaN(val))) {
                        console.warn('Invalid RGB value in lightRoutine step:', step.value);
                        continue;
                    }

                    if (overrides) {
                        await goveeSetColor(rgb[0], rgb[1], rgb[2], overrides);
                        break;
                    }

                    console.warn('lightRoutine color step missing resolvable LAN device:', step);
                    const colorSent = await sendGoveeCloudRoutineCommand(step, {
                        name: 'color',
                        value: { r: rgb[0], g: rgb[1], b: rgb[2] }
                    });
                    if (!colorSent) {
                        continue;
                    }
                    break;
                }

                case 'colorTemp': {
                    const kelvin = parseInt(step.value, 10);
                    const sent = await sendGoveeCloudRoutineCommand(step, {
                        name: 'colorTem',
                        value: kelvin
                    });
                    if (!sent) {
                        continue;
                    }
                    break;
                }

                case 'scene': {
                    const sceneValue = isNaN(parseInt(step.value, 10))
                        ? step.value
                        : parseInt(step.value, 10);
                    const sent = await sendGoveeCloudRoutineCommand(step, {
                        name: 'scene',
                        value: sceneValue
                    });
                    if (!sent) {
                        continue;
                    }
                    break;
                }

                case 'wait': {
                    const duration = parseInt(step.value, 10);
                    console.log(`⏱️ Waiting ${duration}ms...`);
                    await new Promise(resolve => setTimeout(resolve, duration));
                    break;
                }

                default:
                    console.warn(`Unknown step type: ${step.type}`);
            }
        } catch (error) {
            console.error(`Error in step ${i + 1}:`, error);
            setGoveeStatus(`Error in step ${i + 1}: ${error.message}`, 'error');
            // Continue with next steps even if one fails
        }
    }

    console.log('✅ Light routine completed');
    setGoveeStatus('Routine completed!', 'success');
}

function goveeSaveSettings() {
    const ipInput = document.getElementById('goveeIpInput');
    const portInput = document.getElementById('goveePortInput');
    const ip = ipInput?.value.trim() || '';
    const portRaw = portInput?.value.trim() || '';

    if (!ip) {
        showStatus('Enter the Govee IP address (find it in the Govee Home app under LAN control).', 'error');
        return;
    }

    let port = null;
    if (portRaw) {
        const parsed = Number(portRaw);
        if (!Number.isFinite(parsed) || parsed <= 0) {
            showStatus('Enter a valid port number (default is 4003).', 'error');
            return;
        }
        port = parsed;
    }

    setStoredGoveeConfig({ ip, port });
    try {
        const { host, port: resolvedPort } = resolveGoveeTarget({ ip, port });
        setGoveeStatus(`Saved LAN IP ${host}:${resolvedPort} for Govee lights.`, 'success');
    } catch (error) {
        setGoveeStatus('Saved settings, but the IP format looks unusual. Double-check the value if commands fail.', 'error');
    }
    showStatus('Govee LAN settings saved! Try the buttons below.', 'success');
}

function updateGoveeBrightnessLabel(value) {
    const labelEl = document.getElementById('goveeBrightnessValue');
    if (labelEl) {
        labelEl.textContent = `${value}%`;
    }
}

async function goveeDiscoverDevices(timeoutMs = 3000) {
    if (!isNativeRuntime) {
        setGoveeStatus('Device discovery requires the native app. Please use the Tauri build.', 'error');
        return;
    }

    if (!await isOnWifi()) {
        setGoveeStatus('No WiFi connection. Please connect to WiFi (not mobile data) to discover Govee devices.', 'error');
        return;
    }

    console.log('🔍 Starting Govee device discovery...');
    console.log('📡 Sending multicast probe to 239.255.255.250:4001');
    console.log('👂 Listening for responses on UDP 4002');
    console.log(`⏱️  Timeout: ${timeoutMs}ms`);

    setGoveeStatus('Discovering Govee devices on your network...', 'info');

    try {
        const devices = await tauriInvoke('govee_discover', { timeout_ms: timeoutMs });

        console.log('\n═══════════════════════════════════════════════════');
        console.log(`✅ Discovery complete! Found ${devices.length} device(s)`);
        console.log('═══════════════════════════════════════════════════\n');

        if (devices.length === 0) {
            console.log('⚠️  No devices found. Make sure:');
            console.log('   1. Your Govee device has LAN Control enabled');
            console.log('   2. The device is on the same network');
            console.log('   3. Your firewall allows UDP multicast');
            setGoveeStatus('No Govee devices found on your network.', 'error');
        } else {
            devices.forEach((device, index) => {
                console.log(`\n📱 Device #${index + 1}:`);
                console.log('─────────────────────────────────────────────────');
                if (device.ip) {
                    console.log(`   IP Address: ${device.ip}`);
                }
                if (device.model) {
                    console.log(`   Model/SKU: ${device.model}`);
                }
                if (device.name) {
                    console.log(`   Device Name: ${device.name}`);
                }
                if (device.device_id) {
                    console.log(`   Device ID: ${device.device_id}`);
                }
                if (device.ble_version) {
                    console.log(`   BLE Version: ${device.ble_version}`);
                }
                if (device.wifi_version) {
                    console.log(`   WiFi Version: ${device.wifi_version}`);
                }
                console.log(`   Source: ${device.source_ip}:${device.source_port}`);
                console.log('\n   📦 Full Response:');
                console.log(JSON.stringify(device.raw_response, null, 2));
            });

            console.log('\n═══════════════════════════════════════════════════');
            console.log('💡 To control these devices, use their IP on port 4003');
            console.log('═══════════════════════════════════════════════════\n');

            setGoveeStatus(`Found ${devices.length} Govee device(s)! Check console for details.`, 'success');

            // Save to cloud if passphrase is set
            const saved = await saveDeviceListToCloud(devices, 'govee');
            if (saved) {
                console.log('💾 Govee discovery results saved to cloud');
            }
        }

        return devices;
    } catch (error) {
        console.error('❌ Discovery failed:', error);
        setGoveeStatus(`Discovery failed: ${error}`, 'error');
        return [];
    }
}

async function refreshGoveeStatus() {
    if (!isNativeRuntime) {
        setGoveeStatus('Status detection requires the native app. Please use the Tauri build.', 'error');
        return;
    }

    const { ip, port } = getStoredGoveeConfig();
    if (!ip) {
        setGoveeStatus('Enter a Govee IP address to check status.', 'error');
        return;
    }

    try {
        const status = await tauriInvoke('govee_status', { host: ip, port });
        displayGoveeStatus(status);

        if (!status.online) {
            setGoveeStatus('Device is offline or not responding.', 'error');
        } else {
            setGoveeStatus('Status updated successfully!', 'success');
        }
    } catch (error) {
        setGoveeStatus(`Failed to get status: ${error}`, 'error');
        console.error('Govee status error:', error);
    }
}

function displayGoveeStatus(status) {
    const onlineEl = document.getElementById('goveeOnlineStatus');
    const powerEl = document.getElementById('goveePowerStatus');
    const brightnessEl = document.getElementById('goveeBrightnessStatus');
    const colorBoxEl = document.getElementById('goveeColorBox');
    const colorTextEl = document.getElementById('goveeColorText');

    if (onlineEl) {
        if (status.online) {
            onlineEl.textContent = '🟢 Online';
            onlineEl.className = 'font-mono text-emerald-300';
        } else {
            onlineEl.textContent = '🔴 Offline';
            onlineEl.className = 'font-mono text-rose-300';
        }
    }

    if (powerEl) {
        if (status.power === true) {
            powerEl.textContent = '🟢 ON';
            powerEl.className = 'font-mono text-emerald-300';
        } else if (status.power === false) {
            powerEl.textContent = '⚫ OFF';
            powerEl.className = 'font-mono text-gray-400';
        } else {
            powerEl.textContent = '—';
            powerEl.className = 'font-mono text-white';
        }
    }

    if (brightnessEl) {
        if (status.brightness != null) {
            brightnessEl.textContent = `${status.brightness}%`;
            brightnessEl.className = 'font-mono text-white';
        } else {
            brightnessEl.textContent = '—';
            brightnessEl.className = 'font-mono text-white';
        }
    }

    if (colorBoxEl && colorTextEl) {
        if (status.color) {
            const { r, g, b } = status.color;
            colorBoxEl.style.backgroundColor = `rgb(${r}, ${g}, ${b})`;
            colorTextEl.textContent = `RGB(${r}, ${g}, ${b})`;
        } else {
            colorBoxEl.style.backgroundColor = '#6b7280';
            colorTextEl.textContent = '—';
        }
    }
}

function updateGoveeCloudUI() {
    const key = getStoredGoveeApiKey();
    const input = document.getElementById('goveeApiKeyInput');
    const statusEl = document.getElementById('goveeApiKeyStatus');
    const clearButton = document.getElementById('goveeApiKeyClear');

    if (input && input !== document.activeElement) {
        input.value = key;
    }
    if (clearButton) {
        clearButton.classList.toggle('hidden', !key);
    }
    if (statusEl) {
        if (key) {
            const masked = key.length > 6 ? `${key.slice(0, 3)}…${key.slice(-3)}` : '••••••';
            statusEl.textContent = `Key saved locally (${masked}).`;
        } else {
            statusEl.textContent = 'No API key saved yet.';
        }
    }

    if (!key) {
        if (!goveeCloudDevicesLoading) {
            setGoveeCloudStatus('Save your Govee API key to load your devices from the cloud.', 'info');
        }
        if (!goveeCloudDevicesLoading) {
            goveeCloudDevices = [];
            goveeCloudDevicesLoaded = false;
            renderGoveeCloudDevices();
        }
        return;
    }

    if (!goveeCloudDevicesLoading && !goveeCloudDevicesLoaded) {
        setGoveeCloudStatus('API key saved. Tap “Refresh Cloud Devices” to pull your cloud list.', 'info');
    }
    if (!goveeCloudDevicesLoading) {
        renderGoveeCloudDevices();
    }
}

function updateGoveeUI() {
    const { ip, port } = getStoredGoveeConfig();
    const ipInput = document.getElementById('goveeIpInput');
    const portInput = document.getElementById('goveePortInput');
    const brightnessInput = document.getElementById('goveeBrightnessSlider');

    updateGoveeCloudUI();

    if (ipInput && ipInput !== document.activeElement) {
        ipInput.value = ip;
    }
    if (portInput && portInput !== document.activeElement) {
        portInput.value = port ? String(port) : '';
    }
    if (brightnessInput) {
        const brightness = getStoredGoveeBrightness();
        brightnessInput.value = String(brightness);
        updateGoveeBrightnessLabel(brightness);
    }

    if (ip) {
        try {
            const { host, port: resolvedPort } = resolveGoveeTarget({ ip, port });
            setGoveeStatus(`Ready to control lights at ${host}:${resolvedPort}.`, 'info');

            // Auto-refresh status when showing settings
            if (isNativeRuntime) {
                refreshGoveeStatus();
            }
        } catch (error) {
            setGoveeStatus('The saved Govee IP looks invalid. Double-check it in settings.', 'error');
        }
    } else {
        setGoveeStatus('Enter the LAN IP from the Govee Home app to enable light controls.', 'info');
    }
}

function handleGoveeBrightnessInput(event) {
    const value = Number(event.target.value || getStoredGoveeBrightness());
    updateGoveeBrightnessLabel(value);
}

function handleGoveeBrightnessChange(event) {
    const value = Number(event.target.value || getStoredGoveeBrightness());
    goveeApplyBrightness(value);
}

function initGoveeControls() {
    updateGoveeUI();

    const brightnessInput = document.getElementById('goveeBrightnessSlider');
    if (brightnessInput) {
        brightnessInput.addEventListener('input', handleGoveeBrightnessInput);
        brightnessInput.addEventListener('change', handleGoveeBrightnessChange);
    }

    if (getStoredGoveeApiKey()) {
        goveeLoadCloudDevices({ auto: true });
    }
}

function goveeSaveApiKey() {
    const input = document.getElementById('goveeApiKeyInput');
    if (!input) return;

    const key = input.value.trim();
    if (!key) {
        showStatus('Enter your Govee API key before saving.', 'error');
        return;
    }

    setStoredGoveeApiKey(key);
    goveeCloudDevices = [];
    goveeCloudDevicesLoaded = false;
    renderGoveeCloudDevices();
    updateGoveeCloudUI();
    showStatus('Govee API key saved locally on this device.', 'success');
    goveeLoadCloudDevices({ auto: true });
}

function goveeClearApiKey() {
    setStoredGoveeApiKey('');
    goveeCloudDevices = [];
    goveeCloudDevicesLoaded = false;
    renderGoveeCloudDevices();
    updateGoveeCloudUI();
    const input = document.getElementById('goveeApiKeyInput');
    if (input) {
        input.value = '';
    }
    showStatus('Removed the stored Govee API key for this device.', 'info');
}

function humanizeGoveeCapability(value) {
    if (!value) return '';

    if (typeof value === 'object') {
        if (value.label) return value.label;
        if (value.command) return humanizeGoveeCapability(value.command);
        return humanizeGoveeCapability(value.type || value.name || value.capability);
    }

    const raw = String(value).trim();
    if (!raw) return '';

    const lookup = GOVEE_CAPABILITY_LABELS[raw];
    if (lookup) return lookup;

    const cleaned = raw
        .replace(/^devices\.capabilities\./i, '')
        .replace(/^capabilities\./i, '')
        .replace(/_/g, ' ')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .trim();

    if (!cleaned) return '';

    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function extractGoveeDeviceCommands(device = {}) {
    const commands = [];
    const push = (candidate) => {
        const label = humanizeGoveeCapability(candidate);
        if (label) {
            const key = label.toLowerCase();
            if (!commands.some(existing => existing.toLowerCase() === key)) {
                commands.push(label);
            }
        }
    };

    if (Array.isArray(device.supportCmds)) {
        device.supportCmds.forEach(push);
    }
    if (Array.isArray(device.supportCommands)) {
        device.supportCommands.forEach(item => {
            if (typeof item === 'string' || typeof item === 'object') {
                push(item);
            }
        });
    }
    if (Array.isArray(device.capabilities)) {
        device.capabilities.forEach(cap => push(cap));
    }
    if (Array.isArray(device?.deviceExt?.lastDeviceData)) {
        device.deviceExt.lastDeviceData.forEach(entry => push(entry));
    }

    return commands;
}

function renderGoveeCloudDevices() {
    const container = document.getElementById('goveeCloudDeviceList');
    if (!container) return;

    container.innerHTML = '';

    if (goveeCloudDevicesLoading) {
        const loading = document.createElement('div');
        loading.className = 'text-sm text-indigo-100/80';
        loading.textContent = 'Loading devices…';
        container.appendChild(loading);
        return;
    }

    if (!goveeCloudDevicesLoaded) {
        return;
    }

    if (!Array.isArray(goveeCloudDevices) || goveeCloudDevices.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'text-sm text-indigo-100/70';
        empty.textContent = 'No devices returned by the Govee cloud yet.';
        container.appendChild(empty);
        return;
    }

    goveeCloudDevices.forEach(device => {
        const card = document.createElement('div');
        card.className = 'rounded-3xl bg-slate-950/40 p-4 space-y-3';

        const header = document.createElement('div');
        header.className = 'flex flex-wrap items-start justify-between gap-3';

        const titleWrapper = document.createElement('div');
        titleWrapper.className = 'space-y-1';
        const name = document.createElement('div');
        name.className = 'text-base font-semibold text-white';
        name.textContent = device.deviceName || device.device_name || device.name || device.nickName || 'Unnamed device';
        titleWrapper.appendChild(name);

        const subtitleParts = [];
        if (device.model) subtitleParts.push(device.model);
        if (device.roomName) subtitleParts.push(device.roomName);
        if (device.device) subtitleParts.push(device.device);
        if (subtitleParts.length > 0) {
            const subtitle = document.createElement('div');
            subtitle.className = 'text-xs text-indigo-100/70';
            subtitle.textContent = subtitleParts.join(' • ');
            titleWrapper.appendChild(subtitle);
        }
        header.appendChild(titleWrapper);

        const badgeGroup = document.createElement('div');
        badgeGroup.className = 'flex flex-wrap gap-2 text-xs';

        const commands = extractGoveeDeviceCommands(device);

        if (device.controllable === true || device.controllable === 'true') {
            const badge = document.createElement('span');
            badge.className = 'rounded-full bg-emerald-500/20 px-2 py-1 font-semibold text-emerald-100';
            badge.textContent = 'Controllable';
            badgeGroup.appendChild(badge);
        }
        if (device.retrievable === true || device.retrievable === 'true') {
            const badge = document.createElement('span');
            badge.className = 'rounded-full bg-sky-500/20 px-2 py-1 font-semibold text-sky-100';
            badge.textContent = 'Reports State';
            badgeGroup.appendChild(badge);
        }
        if (commands.length > 0) {
            const badge = document.createElement('span');
            badge.className = 'rounded-full bg-white/10 px-2 py-1 font-semibold text-indigo-100';
            badge.textContent = `${commands.length} command${commands.length === 1 ? '' : 's'}`;
            badgeGroup.appendChild(badge);
        }

        if (badgeGroup.childElementCount > 0) {
            header.appendChild(badgeGroup);
        }

        card.appendChild(header);

        if (device.device) {
            const idRow = document.createElement('div');
            idRow.className = 'text-xs text-indigo-100/70';
            idRow.innerHTML = `<span class="font-semibold text-indigo-100">Device ID:</span> <span class="font-mono">${device.device}</span>`;
            card.appendChild(idRow);
        }

        const commandsWrapper = document.createElement('div');
        commandsWrapper.className = 'space-y-2';
        const commandsLabel = document.createElement('div');
        commandsLabel.className = 'text-xs font-semibold uppercase tracking-wide text-indigo-200';
        commandsLabel.textContent = 'Supported Commands';
        commandsWrapper.appendChild(commandsLabel);

        if (commands.length > 0) {
            const list = document.createElement('ul');
            list.className = 'grid gap-1 text-sm text-indigo-100';
            commands.forEach(command => {
                const item = document.createElement('li');
                item.className = 'flex items-center gap-2';

                const bullet = document.createElement('span');
                bullet.textContent = '•';
                bullet.className = 'text-indigo-300';

                const label = document.createElement('span');
                label.textContent = command;

                item.append(bullet, label);
                list.appendChild(item);
            });
            commandsWrapper.appendChild(list);
        } else {
            const emptyCommands = document.createElement('div');
            emptyCommands.className = 'text-sm text-indigo-100/70';
            emptyCommands.textContent = 'The cloud API has not reported specific commands for this device yet.';
            commandsWrapper.appendChild(emptyCommands);
        }

        card.appendChild(commandsWrapper);

        container.appendChild(card);
    });

    // Populate test device selector
    const testDeviceSelect = document.getElementById('goveeTestDevice');
    if (testDeviceSelect && goveeCloudDevices && goveeCloudDevices.length > 0) {
        // Clear existing options except first
        testDeviceSelect.innerHTML = '<option value="">— Select a device —</option>';

        goveeCloudDevices.forEach((device, index) => {
            const option = document.createElement('option');
            option.value = index;
            option.textContent = `${device.deviceName || device.device_name || device.name || 'Unnamed'} (${device.model || 'Unknown'})`;
            testDeviceSelect.appendChild(option);
        });
    }
}

async function goveeLoadCloudDevices(options = {}) {
    const { auto = false } = options || {};
    const apiKey = getStoredGoveeApiKey();

    if (!apiKey) {
        if (!auto) {
            setGoveeCloudStatus('Save your Govee API key to load cloud devices.', 'error');
            const input = document.getElementById('goveeApiKeyInput');
            if (input) {
                input.focus();
            }
        }
        return;
    }

    if (goveeCloudDevicesLoading) {
        return;
    }

    goveeCloudDevicesLoading = true;
    renderGoveeCloudDevices();
    setGoveeCloudStatus('Loading devices from the Govee cloud…', 'info');

    try {
        const response = await fetch('https://developer-api.govee.com/v1/devices', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Govee-API-Key': apiKey
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(errorText || `Request failed with status ${response.status}`);
        }

        let payload = {};
        try {
            payload = await response.json();
        } catch (parseError) {
            throw new Error('Received an unreadable response from the Govee cloud.');
        }

        const devices =
            (Array.isArray(payload?.data?.devices) && payload.data.devices) ||
            (Array.isArray(payload?.devices) && payload.devices) ||
            [];

        goveeCloudDevices = devices;
        goveeCloudDevicesLoaded = true;

        if (devices.length === 0) {
            setGoveeCloudStatus('No devices returned by the Govee cloud for this account.', 'error');
        } else {
            setGoveeCloudStatus(`Found ${devices.length} device${devices.length === 1 ? '' : 's'} in your account.`, 'success');
        }
    } catch (error) {
        goveeCloudDevicesLoaded = false;
        console.error('Govee cloud device load failed:', error);
        const message = (error?.message || 'Unknown error').trim();
        setGoveeCloudStatus(`Cloud request failed: ${message}`, 'error');
        if (!auto) {
            showStatus('Could not load Govee cloud devices. Double-check your API key.', 'error');
        }
    } finally {
        goveeCloudDevicesLoading = false;
        renderGoveeCloudDevices();
    }
}

// Testing Playground Functions
let goveeTestSelectedDevice = null;
let goveeTestLastCommand = null;

function goveeTestDeviceChanged() {
    const select = document.getElementById('goveeTestDevice');
    const deviceIndex = parseInt(select.value, 10);

    if (isNaN(deviceIndex) || deviceIndex < 0 || deviceIndex >= goveeCloudDevices.length) {
        goveeTestSelectedDevice = null;
        document.getElementById('goveeTestDeviceInfo').classList.add('hidden');
        return;
    }

    const device = goveeCloudDevices[deviceIndex];
    goveeTestSelectedDevice = device;

    // Update device info display
    const modelEl = document.getElementById('goveeTestModel');
    const deviceIdEl = document.getElementById('goveeTestDeviceId');
    const capsEl = document.getElementById('goveeTestCaps');

    modelEl.textContent = device.model || '—';
    deviceIdEl.textContent = device.device || '—';

    // Extract capabilities
    const capabilities = extractGoveeDeviceCommands(device);
    capsEl.textContent = capabilities.length > 0 ? capabilities.join(', ') : 'Unknown';

    document.getElementById('goveeTestDeviceInfo').classList.remove('hidden');
}

function goveeTestCommandTypeChanged() {
    const commandType = document.getElementById('goveeTestCommandType').value;
    const paramsContainer = document.getElementById('goveeTestParams');

    // Hide all param sections
    document.getElementById('goveeTestParamsPower').classList.add('hidden');
    document.getElementById('goveeTestParamsBrightness').classList.add('hidden');
    document.getElementById('goveeTestParamsColor').classList.add('hidden');
    document.getElementById('goveeTestParamsColorTem').classList.add('hidden');
    document.getElementById('goveeTestParamsColorTemPct').classList.add('hidden');
    document.getElementById('goveeTestParamsSegment').classList.add('hidden');
    document.getElementById('goveeTestParamsScene').classList.add('hidden');
    document.getElementById('goveeTestParamsMusicMode').classList.add('hidden');
    document.getElementById('goveeTestParamsWorkMode').classList.add('hidden');

    if (!commandType) {
        paramsContainer.classList.add('hidden');
        return;
    }

    // Show relevant param section
    paramsContainer.classList.remove('hidden');

    if (commandType === 'turn') {
        document.getElementById('goveeTestParamsPower').classList.remove('hidden');
    } else if (commandType === 'brightness') {
        document.getElementById('goveeTestParamsBrightness').classList.remove('hidden');
    } else if (commandType === 'color') {
        document.getElementById('goveeTestParamsColor').classList.remove('hidden');
    } else if (commandType === 'colorTem') {
        document.getElementById('goveeTestParamsColorTem').classList.remove('hidden');
    } else if (commandType === 'colorTemPercentage') {
        document.getElementById('goveeTestParamsColorTemPct').classList.remove('hidden');
    } else if (commandType === 'segment') {
        document.getElementById('goveeTestParamsSegment').classList.remove('hidden');
    } else if (commandType === 'scene') {
        document.getElementById('goveeTestParamsScene').classList.remove('hidden');
    } else if (commandType === 'musicMode') {
        document.getElementById('goveeTestParamsMusicMode').classList.remove('hidden');
    } else if (commandType === 'work_mode') {
        document.getElementById('goveeTestParamsWorkMode').classList.remove('hidden');
    }
}

function goveeTestColorPickerChanged() {
    const colorPicker = document.getElementById('goveeTestColorPicker');
    const hex = colorPicker.value;

    // Convert hex to RGB
    const r = parseInt(hex.substr(1, 2), 16);
    const g = parseInt(hex.substr(3, 2), 16);
    const b = parseInt(hex.substr(5, 2), 16);

    document.getElementById('goveeTestColorR').textContent = r;
    document.getElementById('goveeTestColorG').textContent = g;
    document.getElementById('goveeTestColorB').textContent = b;
}

async function goveeTestSendCommand() {
    const apiKey = getStoredGoveeApiKey();
    if (!apiKey) {
        showStatus('Save your Govee API key first.', 'error');
        return;
    }

    if (!goveeTestSelectedDevice) {
        showStatus('Select a device first.', 'error');
        return;
    }

    const commandType = document.getElementById('goveeTestCommandType').value;
    if (!commandType) {
        showStatus('Select a command type first.', 'error');
        return;
    }

    // Build command based on type
    let cmd = { name: commandType };

    if (commandType === 'turn') {
        const powerValue = document.getElementById('goveeTestPowerValue').value;
        cmd.value = powerValue;
    } else if (commandType === 'brightness') {
        const brightness = parseInt(document.getElementById('goveeTestBrightnessValue').value, 10);
        cmd.value = brightness;
    } else if (commandType === 'color') {
        const r = parseInt(document.getElementById('goveeTestColorR').textContent, 10);
        const g = parseInt(document.getElementById('goveeTestColorG').textContent, 10);
        const b = parseInt(document.getElementById('goveeTestColorB').textContent, 10);
        cmd.value = { r, g, b };
    } else if (commandType === 'colorTem') {
        const kelvin = parseInt(document.getElementById('goveeTestColorTemValue').value, 10);
        cmd.value = kelvin;
    } else if (commandType === 'colorTemPercentage') {
        const percentage = parseInt(document.getElementById('goveeTestColorTemPctValue').value, 10);
        cmd.value = percentage;
    } else if (commandType === 'segment') {
        try {
            const segmentData = JSON.parse(document.getElementById('goveeTestSegmentValue').value);
            cmd.value = segmentData;
        } catch (e) {
            showStatus('Invalid segment data JSON.', 'error');
            return;
        }
    } else if (commandType === 'scene') {
        const sceneValue = document.getElementById('goveeTestSceneValue').value.trim();
        if (!sceneValue) {
            showStatus('Please enter a scene ID or value.', 'error');
            return;
        }
        // Try to parse as number, otherwise use as string
        const parsed = parseInt(sceneValue, 10);
        cmd.value = isNaN(parsed) ? sceneValue : parsed;
    } else if (commandType === 'musicMode') {
        const musicModeValue = parseInt(document.getElementById('goveeTestMusicModeValue').value, 10);
        cmd.value = musicModeValue;
    } else if (commandType === 'work_mode') {
        const workModeValue = parseInt(document.getElementById('goveeTestWorkModeValue').value, 10);
        cmd.value = workModeValue;
    }

    // Store the command for later use
    goveeTestLastCommand = {
        device: goveeTestSelectedDevice.device,
        model: goveeTestSelectedDevice.model,
        cmd: cmd
    };

    // Show loading state
    const sendBtn = document.getElementById('goveeTestSendBtn');
    const originalText = sendBtn.textContent;
    sendBtn.textContent = '⏳ Sending...';
    sendBtn.disabled = true;

    try {
        // Use Tauri bridge if available
        if (tauriInvoke) {
            const response = await tauriInvoke('govee_cloud_control', {
                apiKey: apiKey,
                device: goveeTestSelectedDevice.device,
                model: goveeTestSelectedDevice.model,
                cmd: cmd
            });

            // Show response
            showGoveeTestResponse(response, 'success');
            showStatus('Command sent successfully!', 'success');
        } else {
            showStatus('Cloud commands require running in Tauri (not browser mode).', 'error');
        }
    } catch (error) {
        console.error('Govee test command failed:', error);
        showGoveeTestResponse({ error: error.toString() }, 'error');
        showStatus('Command failed: ' + error.toString(), 'error');
    } finally {
        sendBtn.textContent = originalText;
        sendBtn.disabled = false;
    }
}

function showGoveeTestResponse(response, status) {
    const responseEl = document.getElementById('goveeTestResponse');
    const statusEl = document.getElementById('goveeTestResponseStatus');
    const bodyEl = document.getElementById('goveeTestResponseBody');

    responseEl.classList.remove('hidden');

    if (status === 'success') {
        statusEl.textContent = '✅ Success';
        statusEl.className = 'text-xs font-semibold text-emerald-300';
    } else {
        statusEl.textContent = '❌ Error';
        statusEl.className = 'text-xs font-semibold text-rose-300';
    }

    bodyEl.textContent = JSON.stringify(response, null, 2);

    // Show save button if successful
    if (status === 'success') {
        document.getElementById('goveeTestSaveBtn').classList.remove('hidden');
    }
}

function goveeClearTestResponse() {
    document.getElementById('goveeTestResponse').classList.add('hidden');
    document.getElementById('goveeTestButtonConfig').classList.add('hidden');
    document.getElementById('goveeTestSaveBtn').classList.add('hidden');
}

function goveeTestSaveAsButton() {
    if (!goveeTestLastCommand) {
        showStatus('Send a command first.', 'error');
        return;
    }

    const configEl = document.getElementById('goveeTestButtonConfig');
    configEl.classList.remove('hidden');

    // Scroll to it
    configEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    // Generate button config
    goveeUpdateButtonConfig();
}

function goveeUpdateButtonConfig() {
    if (!goveeTestLastCommand) return;

    const label = document.getElementById('goveeTestButtonLabel').value || 'My Light Command';
    const emoji = document.getElementById('goveeTestButtonEmoji').value || '💡';

    const buttonConfig = {
        id: `govee_${Date.now()}`,
        label: label,
        emoji: emoji,
        handler: 'goveeCloudCommand',
        args: [
            goveeTestLastCommand.device,
            goveeTestLastCommand.model,
            goveeTestLastCommand.cmd
        ]
    };

    const jsonEl = document.getElementById('goveeTestButtonConfigJSON');
    jsonEl.textContent = JSON.stringify(buttonConfig, null, 2);
}

function goveeCopyButtonConfig() {
    const jsonEl = document.getElementById('goveeTestButtonConfigJSON');
    const text = jsonEl.textContent;

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            showStatus('Button config copied to clipboard!', 'success');
        }).catch(err => {
            console.error('Failed to copy:', err);
            showStatus('Failed to copy to clipboard.', 'error');
        });
    } else {
        // Fallback for older browsers
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        try {
            document.execCommand('copy');
            showStatus('Button config copied to clipboard!', 'success');
        } catch (err) {
            console.error('Failed to copy:', err);
            showStatus('Failed to copy to clipboard.', 'error');
        }
        document.body.removeChild(textarea);
    }
}

// Handler function that can be called from button configs
async function goveeCloudCommand(device, model, cmd, options = {}) {
    const apiKey = getStoredGoveeApiKey();
    if (!apiKey) {
        showStatus('Govee API key not configured.', 'error');
        return;
    }

    try {
        if (tauriInvoke) {
            await tauriInvoke('govee_cloud_control', {
                apiKey: apiKey,
                device: device,
                model: model,
                cmd: cmd
            });
            showStatus('Lights updated!', 'success');
        } else {
            showStatus('Cloud commands require Tauri (not browser).', 'error');
        }
    } catch (error) {
        console.error('Govee cloud command failed:', error);
        showStatus('Command failed: ' + error.toString(), 'error');
    }
}

// Listen for button label/emoji changes to update the config
if (document.getElementById('goveeTestButtonLabel')) {
    document.getElementById('goveeTestButtonLabel').addEventListener('input', goveeUpdateButtonConfig);
}
if (document.getElementById('goveeTestButtonEmoji')) {
    document.getElementById('goveeTestButtonEmoji').addEventListener('input', goveeUpdateButtonConfig);
}



// Show status message
function showStatus(message, type = 'info') {
    const statusEl = document.getElementById('statusMessage');
    if (statusEl) {
        statusEl.textContent = message;
        statusEl.classList.add('hidden');
    }
    showToast(message, type);
}

function showToast(message, type = 'info', duration = 3200) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    container.innerHTML = '';

    const variant = STATUS_VARIANTS[type] || STATUS_VARIANTS.info;
    const toast = document.createElement('div');
    toast.className = `pointer-events-auto flex items-center gap-3 rounded-2xl px-5 py-3 text-sm font-semibold shadow-2xl backdrop-blur ${variant.classes}`;

    const iconSpan = document.createElement('span');
    iconSpan.className = 'text-base';
    iconSpan.textContent = variant.icon || 'ℹ️';

    const messageSpan = document.createElement('span');
    messageSpan.textContent = message;

    toast.append(iconSpan, messageSpan);
    container.appendChild(toast);
    container.classList.remove('hidden');

    if (toastTimer) {
        clearTimeout(toastTimer);
    }

    toastTimer = setTimeout(() => {
        container.classList.add('hidden');
        container.innerHTML = '';
    }, duration);
}

function showInlineMessage(element, message, type = 'info') {
    const variant = INLINE_VARIANTS[type] || INLINE_VARIANTS.info;
    element.className = `w-full rounded-2xl px-4 py-3 text-xs text-left ${variant}`;
    element.textContent = message;
    element.classList.remove('hidden');
}




























function applyToddlerContent(data) {
    if (!data) return;
    tabsConfig = data;

    // Extract lights buttons
    let lightsButtons = [];
    if (data.buttons) {
        lightsButtons = data.buttons.filter(b => b.tab === 'lights');
    } else if (data.tabs) {
        // Handle new config format if tabs are defined
        const lightsTab = data.tabs.find(t => t.id === 'lights');
        if (lightsTab && lightsTab.buttons) {
            lightsButtons = lightsTab.buttons;
        }
    }

    renderLightsButtons(lightsButtons);
    updateToddlerContentSourceInfo();
}

async function discoverAndRegisterAllDevices() {
    // Only discover Govee devices
    await goveeDiscoverDevices();
}
