// Roku Control App
const STORAGE_KEY = 'roku_ip';
const DEFAULT_PIN_CODE = '1234';
const HOLD_DURATION = 2000; // 2 seconds to hold
const PROGRESS_CIRCUMFERENCE = 163;
const STATUS_VARIANTS = {
    info: { icon: 'ℹ️', classes: 'bg-white/20 text-white' },
    success: { icon: '✅', classes: 'bg-emerald-400/20 text-emerald-50 border border-emerald-200/40' },
    error: { icon: '⚠️', classes: 'bg-rose-500/20 text-rose-50 border border-rose-200/40' }
};
const INLINE_VARIANTS = {
    info: 'bg-slate-950/60 text-indigo-100',
    success: 'bg-emerald-500/20 text-emerald-50 border border-emerald-200/40',
    error: 'bg-rose-500/20 text-rose-50 border border-rose-200/40'
};
const QUICK_ACTION_COOLDOWN_MS = 1000;
const quickActionCooldowns = new Map();
const MACRO_STORAGE_KEY = 'roku_macros';
const CONFIG_BASE_PATH = 'config';
const APP_CONFIG_PATH = `${CONFIG_BASE_PATH}/app-config.json`;
const APP_CONFIG_CUSTOM_PATH = `${CONFIG_BASE_PATH}/app-config.custom.json`;
const BUTTON_TYPES_CONFIG_PATH = `${CONFIG_BASE_PATH}/button-types.json`;
const TODDLER_CONTENT_PASSPHRASE_KEY = 'toddler_content_passphrase';
const NETLIFY_CONFIG_API_BASE = 'https://toddler-phone-control.netlify.app/api/config';

const YOUTUBE_PLAYBACK_MODE_KEY = 'youtube_playback_mode'; // 'roku' or 'app'
const PARENTAL_PIN_STORAGE_KEY = 'parental_pin';
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

const TAB_DEFINITIONS = {
    remote: {
        id: 'remote',
        defaultLabel: 'Remote',
        defaultIcon: '🎮',
        sections: ['toddlerControls', 'remoteSection']
    },
    apps: {
        id: 'apps',
        defaultLabel: 'Roku',
        defaultIcon: '📺',
        sections: ['kidQuickSection', 'connectionSection', 'nowPlayingSection', 'appsSection', 'quickLaunchSection', 'deepLinkSection']
    },


    macros: {
        id: 'macros',
        defaultLabel: 'Macros',
        defaultIcon: '✨',
        sections: ['macroSection']
    }
};
const TAB_MANAGED_SECTION_IDS = Array.from(
    new Set(
        Object.values(TAB_DEFINITIONS).flatMap(def => Array.isArray(def.sections) ? def.sections : [])
    )
);

// Store latest media data for detailed view
let latestMediaData = null;
let macroStepsDraft = [];
let macros = [];
let toddlerSpecialButtons = [];
let toddlerQuickLaunchItems = [];
let installedApps = [];
let installedAppMap = new Map();
let toddlerContentSource = { type: 'bundled', path: APP_CONFIG_PATH };
let buttonTypeCatalog = null;
let tabsConfig = null;
let remotePinCode = DEFAULT_PIN_CODE;

if (typeof window !== 'undefined') {
    window.getButtonHandlerCatalog = () => buttonTypeCatalog;
}

function sanitizePinValue(value) {
    if (typeof value !== 'string') return '';
    const digits = value.replace(/\D/g, '').slice(0, 4);
    return digits.length === 4 ? digits : '';
}

function getLocalParentalPin() {
    const raw = localStorage.getItem(PARENTAL_PIN_STORAGE_KEY);
    if (raw && /^\d{4}$/.test(raw)) {
        return raw;
    }
    return null;
}

function setLocalParentalPin(pin) {
    const sanitized = sanitizePinValue(pin);
    if (sanitized) {
        localStorage.setItem(PARENTAL_PIN_STORAGE_KEY, sanitized);
    } else {
        localStorage.removeItem(PARENTAL_PIN_STORAGE_KEY);
    }
    updateParentalControlsUI();
}

function setRemotePinCode(pinValue) {
    const sanitized = sanitizePinValue(typeof pinValue === 'number' ? String(pinValue) : (pinValue || ''));
    remotePinCode = sanitized || DEFAULT_PIN_CODE;
    updateParentalControlsUI();
}

function getActivePinCode() {
    return getLocalParentalPin() || remotePinCode || DEFAULT_PIN_CODE;
}
// Settings lock state
let holdTimer = null;
let holdProgress = 0;
let isHolding = false;
let settingsUnlocked = false;
let currentPin = '';
let toastTimer = null;
let timerAnimationFrame = null;
let timerEndTimestamp = 0;
let timerDurationMs = 0;
let timerLabelText = '';


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

async function loadTabsConfig() {
    // Tabs are now loaded as part of the unified app config via loadToddlerContent()
    // This function is kept for backwards compatibility but does nothing
    // since tabsConfig is populated by applyToddlerContent()
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
            buildTabFromDefinition(TAB_DEFINITIONS.remote),
            buildTabFromDefinition(TAB_DEFINITIONS.apps),

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
        window._activeTabId = 'remote';
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
    const desired = tabs.some(tab => tab.id === tabId) ? tabId : 'remote';
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
                    id: 'remote',
                    label: 'Remote',
                    icon: '🎮',
                    buttons: toddlerSpecialButtons.filter(b => b.category === 'kidMode-remote' || !b.category)
                },
                {
                    id: 'apps',
                    label: 'Roku',
                    icon: '📺',
                    buttons: toddlerSpecialButtons.filter(b => b.category === 'kidMode-content'),
                    quickLaunch: toddlerQuickLaunchItems
                },

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


    if (Object.prototype.hasOwnProperty.call(settingsData, 'parentalPin')) {
        setRemotePinCode(settingsData.parentalPin);
    } else {
        setRemotePinCode(null);
    }

    // Extract tabs and buttons from the unified config structure
    const tabs = Array.isArray(data?.tabs) ? data.tabs : [];

    // Store tabs config for navigation
    tabsConfig = { tabs };

    const remoteTab = tabs.find(tab => tab.id === 'remote');
    const appsTab = tabs.find(tab => tab.id === 'apps');


    const remoteButtons = Array.isArray(remoteTab?.buttons) ? [...remoteTab.buttons] : [];
    const appsButtons = Array.isArray(appsTab?.buttons) ? [...appsTab.buttons] : [];


    // Normalize quick launch items (auto-generate id, thumbnail, etc.)
    const rawQuickLaunch = Array.isArray(appsTab?.quickLaunch) ? appsTab.quickLaunch : [];
    toddlerQuickLaunchItems = rawQuickLaunch.map(normalizeQuickLaunchItem);

    // Combine remote and apps buttons for rendering
    toddlerSpecialButtons = [...remoteButtons, ...appsButtons];

    renderToddlerButtons(remoteButtons, appsButtons, toddlerQuickLaunchItems);


    renderQuickLaunchSettings(toddlerQuickLaunchItems);
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

function getQuickActionKey(source) {
    if (!source) return '__quick_action__';
    if (typeof source === 'string') return source;
    return source.id || source.appId || source.appName || source.label || '__quick_action__';
}

function registerQuickActionCooldown(source) {
    const key = getQuickActionKey(source);
    const now = Date.now();
    const last = quickActionCooldowns.get(key) || 0;
    if (now - last < QUICK_ACTION_COOLDOWN_MS) {
        return false;
    }
    quickActionCooldowns.set(key, now);
    return true;
}



// Initialize on load
window.addEventListener('DOMContentLoaded', async () => {
    // Log runtime info for debugging
    if (isNativeRuntime) {
        console.log('Running inside Tauri shell');
    }

    updateParentalControlsUI();

    // Load tabs config before initializing tab controls
    await loadTabsConfig();
    initTabControls();

    updateToddlerContentSourceInfo();
    updateCloudEditorVisibility();
    void loadButtonTypeCatalog();

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
        await renderBottomTabs(); // Re-render tabs (show Roku tab if on WiFi)
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
        await renderBottomTabs(); // Re-render tabs to hide Roku tab
    });

    const savedIp = localStorage.getItem(STORAGE_KEY);
    if (savedIp) {
        document.getElementById('rokuIp').value = savedIp;
        showStatus('Found saved IP: ' + savedIp + '. Attempting to connect...', 'info');

        // Try to auto-connect
        try {
            await checkStatus();
        } catch (error) {
            showStatus('Could not connect to saved IP: ' + savedIp + '. Ask a grown-up to double-check it in settings.', 'error');
        }
    } else {
        showStatus('No Roku IP saved yet. Ask a grown-up to unlock settings and type it in.', 'info');
    }

    initMacroSystem();


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

function renderToddlerButtons(remoteButtons = [], appsButtons = [], quickLaunch = []) {
    const quickColumn = document.getElementById('toddlerQuickColumn');
    const remoteColumn = document.getElementById('toddlerRemoteColumn');
    if (!quickColumn || !remoteColumn) return;

    quickColumn.innerHTML = '';
    remoteColumn.innerHTML = '';

    // Separate apps buttons by whether they have thumbnails
    const appsButtonsWithImages = appsButtons.filter(btn => btn.thumbnail);
    const appsButtonsNoImages = appsButtons.filter(btn => !btn.thumbnail);

    // Combine quick launch items with apps buttons (images first, then no-image buttons)
    const quickItems = [
        ...(Array.isArray(quickLaunch) ? quickLaunch.map(mapQuickLaunchToToddlerButton) : []),
        ...appsButtonsWithImages,
        ...appsButtonsNoImages
    ];

    if (quickItems.length === 0) {
        const emptyState = document.createElement('div');
        emptyState.className = 'col-span-full rounded-3xl bg-white/10 px-6 py-8 text-center text-lg font-semibold text-indigo-100';
        emptyState.textContent = 'No kid buttons configured yet.';
        quickColumn.appendChild(emptyState);
    } else {
        quickItems.forEach(config => {
            const element = createQuickButtonElement(config);
            if (element) {
                quickColumn.appendChild(element);
            }
        });
    }

    renderRemoteColumn(remoteColumn, remoteButtons);
    updateFavoriteMacroButton();
}



function mapQuickLaunchToToddlerButton(item) {
    const buttonLabel = item.label || '';
    return {
        id: item.id ? `${item.id}-button` : undefined,
        label: buttonLabel,
        thumbnail: item.thumbnail || '',
        launchItem: item
    };
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
        if (isQuickLaunch) {
            handleQuickLaunch(config.launchItem);
        } else {
            invokeToddlerHandler(config);
        }
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

function renderRemoteColumn(container, remoteButtons) {
    if (!Array.isArray(remoteButtons) || remoteButtons.length === 0) {
        const emptyState = document.createElement('div');
        emptyState.className = 'rounded-3xl bg-white/10 px-4 py-6 text-center text-sm text-indigo-100';
        emptyState.textContent = 'Remote controls will appear here once configured.';
        container.appendChild(emptyState);
        return;
    }

    const remoteMap = new Map(remoteButtons.map(btn => [btn.id, btn]));

    if (!remoteMap.has('backButton')) {
        remoteMap.set('backButton', {
            id: 'backButton',
            emoji: '⟵',
            label: 'Go Back',
            handler: 'sendKey',
            args: ['Back']
        });
    }

    const navGrid = document.createElement('div');
    navGrid.className = 'grid grid-cols-3 gap-3';

    navGrid.appendChild(createRemoteButton(remoteMap.get('backButton')) || createRemoteSpacer());
    navGrid.appendChild(createRemoteButton(remoteMap.get('homeButton')) || createRemoteSpacer());
    navGrid.appendChild(createRemoteButton(remoteMap.get('findRokuButton')) || createRemoteSpacer());

    navGrid.appendChild(createRemoteSpacer());
    navGrid.appendChild(createRemoteButton(remoteMap.get('upButton')) || createRemoteSpacer());
    navGrid.appendChild(createRemoteSpacer());

    navGrid.appendChild(createRemoteButton(remoteMap.get('leftButton')) || createRemoteSpacer());
    navGrid.appendChild(createRemoteButton(remoteMap.get('selectButton')) || createRemoteSpacer());
    navGrid.appendChild(createRemoteButton(remoteMap.get('rightButton')) || createRemoteSpacer());

    navGrid.appendChild(createRemoteButton(remoteMap.get('instantReplayButton')) || createRemoteSpacer());
    navGrid.appendChild(createRemoteButton(remoteMap.get('downButton')) || createRemoteSpacer());
    navGrid.appendChild(createRemoteButton(remoteMap.get('playPauseButton')) || createRemoteSpacer());

    container.appendChild(navGrid);

    const bottomRow = document.createElement('div');
    bottomRow.className = 'grid gap-3';
    const powerBtn = createRemoteButton(remoteMap.get('powerButton'));
    if (powerBtn) bottomRow.appendChild(powerBtn);
    if (bottomRow.childElementCount) {
        container.appendChild(bottomRow);
    }
}

function createRemoteButton(config) {
    if (!config) return null;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'flex h-20 items-center justify-center rounded-3xl bg-white text-indigo-600 text-2xl font-bold shadow-xl transition hover:-translate-y-1 hover:shadow-2xl focus:outline-none focus:ring-4 focus:ring-white/50 active:scale-95 touch-manipulation select-none';

    if (config.id) {
        button.id = `${config.id}-remote`;
    }

    button.setAttribute('aria-label', config.label || config.emoji || 'Remote button');

    button.addEventListener('click', () => invokeToddlerHandler(config));

    const iconSpan = document.createElement('span');
    iconSpan.className = 'text-3xl';
    iconSpan.textContent = config.emoji || '';

    const hideLabel = ['Up', 'Down', 'Left', 'Right'].includes(config.label || '');
    if (config.emoji) {
        button.appendChild(iconSpan);
    }
    if (config.label && (!hideLabel || !config.emoji)) {
        const labelSpan = document.createElement('span');
        labelSpan.className = config.emoji ? 'ml-2 text-lg font-semibold' : 'text-lg font-semibold';
        labelSpan.textContent = config.label;
        button.appendChild(labelSpan);
    }

    return button;
}

function createRemoteSpacer() {
    const spacer = document.createElement('div');
    spacer.className = 'h-20 select-none opacity-0';
    spacer.setAttribute('aria-hidden', 'true');
    return spacer;
}

function invokeToddlerHandler(config) {
    if (config?.launchItem) {
        handleQuickLaunch(config.launchItem);
        return;
    }

    if (config?.appId || config?.appName) {
        if (!registerQuickActionCooldown(config)) {
            showStatus('Hang on, that action is already starting...', 'info');
            return;
        }
        const announceName = (config.appName || config.label || '').trim();
        if (announceName) {
            speakTts(`Opening ${announceName}`);
        }
        launchConfiguredApp(config);
        return;
    }

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

    if (
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

function renderQuickLaunch(items) {
    renderQuickLaunchSettings(items);
}

function renderQuickLaunchSettings(items) {
    const section = document.getElementById('quickLaunchSection');
    const grid = document.getElementById('quickLaunchGrid');
    if (!section || !grid) return;

    grid.innerHTML = '';

    const launches = Array.isArray(items) ? [...items] : [];
    if (launches.length === 0) {
        section.classList.add('hidden');
        return;
    }

    launches.forEach(item => {
        const button = document.createElement('button');
        button.className = 'group relative overflow-hidden rounded-3xl shadow-lg transition hover:-translate-y-1 hover:shadow-xl focus:outline-none focus:ring-4 focus:ring-white/40 active:scale-[0.98] touch-manipulation select-none';
        button.type = 'button';

        if (item.id) {
            button.id = item.id;
        }

        button.addEventListener('click', () => handleQuickLaunch(item));

        const img = document.createElement('img');
        img.src = item.thumbnail || '';
        img.alt = item.label || 'Quick launch item';
        img.loading = 'lazy';
        img.className = 'h-full w-full object-cover transition duration-300 group-hover:scale-105';

        button.appendChild(img);

        const captionLabel = item.label || '';
        if (captionLabel) {
            const caption = document.createElement('span');
            caption.className = 'pointer-events-none absolute bottom-3 left-1/2 w-[85%] -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-center text-xs font-semibold uppercase tracking-wide text-white shadow-lg';
            caption.textContent = captionLabel;
            button.appendChild(caption);
        }

        grid.appendChild(button);
    });

    if (settingsUnlocked) {
        section.classList.remove('hidden');
    } else {
        section.classList.add('hidden');
    }
}

function handleQuickLaunch(item) {
    if (!item) return;

    if (!registerQuickActionCooldown(item)) {
        showStatus('Hang on, that action is already starting...', 'info');
        return;
    }

    const announceLabel = (item.label || item.appName || '').trim();
    if (announceLabel) {
        const quickType = (item.type || '').toLowerCase();
        const verb = quickType === 'youtube' || quickType === 'video' ? 'Playing' : 'Opening';
        speakTts(`${verb} ${announceLabel}`);
    }

    if (item.type === 'youtube' && item.videoId) {
        launchSpecificYouTube(item.videoId);
        return;
    }

    const handlerName = item.handler;
    if (handlerName && typeof window[handlerName] === 'function') {
        const args = Array.isArray(item.args) ? item.args : item.args !== undefined ? [item.args] : [];
        try {
            window[handlerName](...args);
            return;
        } catch (error) {
            console.error(`Quick launch handler "${handlerName}" failed`, error);
            showStatus('Quick launch failed. Try again.', 'error');
            return;
        }
    }

    showStatus('Quick launch is missing an action.', 'error');
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





// Device Registry System
const DEVICE_REGISTRY_KEY = 'device_registry';

function getDeviceRegistry() {
    try {
        const data = localStorage.getItem(DEVICE_REGISTRY_KEY);
        return data ? JSON.parse(data) : { roku: {} };
    } catch (error) {
        console.error('Failed to parse device registry:', error);
        return { roku: {} };
    }
}

function saveDeviceRegistry(registry) {
    try {
        localStorage.setItem(DEVICE_REGISTRY_KEY, JSON.stringify(registry));
    } catch (error) {
        console.error('Failed to save device registry:', error);
    }
}

function registerRokuDevice(device) {
    const registry = getDeviceRegistry();
    const id = device.serial_number || device.device_id || device.ip;

    if (!id) {
        console.warn('Cannot register Roku device without ID', device);
        return;
    }

    registry.roku[id] = {
        id,
        ip: device.ip,
        serial_number: device.serial_number,
        device_id: device.device_id,
        model_name: device.model_name,
        friendly_name: device.friendly_name,
        last_seen: Date.now()
    };

    saveDeviceRegistry(registry);
    console.log('✅ Registered Roku device:', id, '→', device.ip);
}

function getDeviceByMac(type, mac) {
    const registry = getDeviceRegistry();
    return registry[type]?.[mac];
}

function getAllDevices() {
    const registry = getDeviceRegistry();
    return {
        roku: Object.values(registry.roku || {}),

    };
}

function normalizeDeviceIdentifier(value) {
    if (typeof value !== 'string') return '';
    let normalized = value.trim();
    if (!normalized) return '';

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

async function discoverAndRegisterAllDevices() {
    console.log('🔄 Starting device discovery...');

    if (!isNativeRuntime) {
        console.warn('⚠️  Discovery requires native runtime');
        return;
    }

    try {
        // Discover Roku devices
        console.log('📺 Discovering Roku devices...');
        const rokuDevices = await tauriInvoke('roku_discover', { timeout_secs: 3 });
        console.log(`Found ${rokuDevices.length} Roku device(s)`);
        rokuDevices.forEach(registerRokuDevice);

        const allDevices = getAllDevices();
        console.log('✅ Discovery complete!');
        console.log(`   Total: ${allDevices.roku.length} Roku devices`);

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
            statusEl.textContent = `Found ${devices.roku.length} Roku devices`;
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

    // Add Roku devices
    devices.roku.forEach(device => {
        const option = document.createElement('option');
        option.value = `roku:${device.id}`;
        const name = device.friendly_name || device.model_name || device.ip;
        option.textContent = `📺 ${name} (${device.ip})`;
        selector.appendChild(option);
    });
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


// Testing Playground Functions

// Handler function that can be called from button configs

// Listen for button label/emoji changes to update the config

// Save IP to localStorage
function saveIp() {
    const ip = document.getElementById('rokuIp').value.trim();
    if (!ip) {
        showStatus('Ask a grown-up to enter the Roku IP address in settings.', 'error');
        return;
    }

    // Basic IP validation (optional :port)
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}(:\d{1,5})?$/;
    if (!ipRegex.test(ip)) {
        showStatus('Ask a grown-up to enter a valid Roku IP address (e.g., 192.168.1.100 or 192.168.1.100:8060).', 'error');
        return;
    }

    localStorage.setItem(STORAGE_KEY, ip);
    showStatus('IP address saved! Click "Check Status" to connect.', 'success');
}

// Get saved IP
function getSavedIp() {
    const ip = localStorage.getItem(STORAGE_KEY);
    if (!ip) {
        showStatus('Ask a grown-up to unlock settings and enter the Roku IP address first.', 'error');
        return null;
    }
    return ip;
}

const RokuTransport = (() => {
    const xhrSupported = typeof XMLHttpRequest !== 'undefined';

    function buildUrl(ip, endpoint) {
        const trimmed = (ip || '').trim();
        if (!trimmed) {
            throw new Error('Missing Roku IP address.');
        }

        const protocolMatch = trimmed.match(/^(https?:\/\/)/i);
        const protocol = protocolMatch ? protocolMatch[1].toLowerCase() : 'http://';
        const remainder = protocolMatch ? trimmed.slice(protocolMatch[1].length) : trimmed;

        const [hostPortRaw] = remainder.split('/');
        if (!hostPortRaw) {
            throw new Error('Invalid Roku address. Double-check the IP in settings.');
        }

        const hostPort = hostPortRaw.includes(':') ? hostPortRaw : `${hostPortRaw}:8060`;
        const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;

        return `${protocol}${hostPort}${path}`;
    }

    async function request(ip, endpoint, { method = 'GET', body, headers = {}, responseType = 'text' } = {}) {
        if (!ip) {
            throw new Error('Missing Roku IP address.');
        }

        const url = buildUrl(ip, endpoint);
        const methodUpper = String(method || 'GET').toUpperCase();

        if (tauriInvoke) {
            try {
                if (methodUpper === 'GET') {
                    const raw = await tauriInvoke('roku_get', { url });
                    if (responseType === 'json') {
                        try {
                            return JSON.parse(raw);
                        } catch (error) {
                            throw new Error('Failed to parse Roku JSON response');
                        }
                    }
                    return raw;
                } else {
                    const payload =
                        body === undefined || body === null
                            ? ''
                            : typeof body === 'string'
                                ? body
                                : JSON.stringify(body);
                    await tauriInvoke('roku_post', { url, body: payload });
                    return '';
                }
            } catch (error) {
                console.warn('Tauri Roku command failed, falling back to web transport:', error);
            }
        }

        if (xhrSupported) {
            try {
                const xhr = new XMLHttpRequest();
                xhr.open(method, url, true);
                Object.entries(headers).forEach(([key, value]) => {
                    xhr.setRequestHeader(key, value);
                });

                return await new Promise((resolve, reject) => {
                    xhr.onreadystatechange = () => {
                        if (xhr.readyState === XMLHttpRequest.DONE) {
                            if (xhr.status >= 200 && xhr.status < 300) {
                                resolve(responseType === 'json' ? JSON.parse(xhr.responseText) : xhr.responseText);
                            } else {
                                reject(new Error(`HTTP ${xhr.status}`));
                            }
                        }
                    };
                    xhr.onerror = () => reject(new Error('Network error'));
                    xhr.send(body ?? null);
                });
            } catch (error) {
                console.warn('XHR request failed, falling back to fetch:', error);
            }
        }

        try {
            const fetchOptions = {
                method,
                headers
            };

            if (body !== undefined && body !== null) {
                fetchOptions.body = body;
            }

            const response = await fetch(url, fetchOptions);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            if (responseType === 'json') {
                return await response.json();
            }

            return await response.text();
        } catch (error) {
            if (error instanceof TypeError || error.message.includes('Failed to fetch')) {
                throw new Error('Direct Roku requests were blocked. Build and run with the Tauri shell to avoid browser CORS limits.');
            }
            throw error;
        }
    }

    async function requestXml(ip, endpoint) {
        const xmlText = await request(ip, endpoint, { responseType: 'text' });
        const parser = new DOMParser();
        return parser.parseFromString(xmlText, 'text/xml');
    }

    return {
        request,
        requestXml,
        isNative: isNativeRuntime,
        hasPlugin: () => Boolean(tauriInvoke)
    };
})();

async function rokuPost(ip, endpoint) {
    await RokuTransport.request(ip, endpoint, { method: 'POST' });
}

function encodeRokuPathSegment(segment) {
    if (!segment) return '';
    return encodeURIComponent(segment).replace(/%25([0-9a-fA-F]{2})/g, '%$1');
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

function launchConfiguredApp(config) {
    const desiredName = config.appName || config.label || '';
    const contentId = config.contentId || null;
    let appId = config.appId || resolveAppIdByName(desiredName);

    if (!appId) {
        showStatus(`Couldn't find ${desiredName || 'that app'} on this Roku yet. Try loading apps first.`, 'error');
        return;
    }

    const appLabel = config.label || desiredName || `App ${appId}`;
    launchApp(appId, appLabel, contentId);
}

function resolveAppIdByName(name) {
    if (!name) return '';
    const normalized = name.trim().toLowerCase();
    return installedAppMap.get(normalized) || '';
}

// Common Roku app IDs (fallback when /query/apps is blocked)
const COMMON_APPS = [
    { id: '12', name: 'Netflix' },
    { id: '13', name: 'Amazon Prime Video' },
    { id: '2213', name: 'Hulu' },
    { id: '837', name: 'YouTube' },
    { id: '41468', name: 'Disney+' },
    { id: '593099', name: 'Apple TV+' },
    { id: '61322', name: 'HBO Max' },
    { id: '74519', name: 'Peacock TV' },
    { id: '151908', name: 'Plex' },
    { id: '2285', name: 'Spotify' },
    { id: '19977', name: 'Pandora' },
    { id: '50539', name: 'The Roku Channel' },
];

// Discover Roku devices on the network
async function discoverRoku() {
    if (!isNativeRuntime) {
        showStatus('Roku discovery requires the native app. Please use the Tauri build.', 'error');
        return;
    }

    if (!await isOnWifi()) {
        showStatus('No WiFi connection. Please connect to WiFi (not mobile data) to discover Roku devices.', 'error');
        return;
    }

    showStatus('🔍 Searching for Roku devices on your network...', 'info');

    try {
        const devices = await tauriInvoke('roku_discover', { timeoutSecs: 5 });

        if (!devices || devices.length === 0) {
            showStatus('No Roku devices found. Make sure your Roku is on the same network.', 'error');
            return;
        }

        // If only one device found, auto-fill it
        if (devices.length === 1) {
            const device = devices[0];
            document.getElementById('rokuIp').value = device.ip;
            showStatus(`Found Roku at ${device.ip}! Click "Save IP" to connect.`, 'success');
            return;
        }

        // Multiple devices found - show selection
        const deviceList = devices.map((d, i) => `${i + 1}. ${d.ip}`).join('\n');
        showStatus(`Found ${devices.length} Roku devices:\n${deviceList}\n\nEnter the IP you want to use.`, 'info');

        // Auto-fill first device
        if (devices[0]) {
            document.getElementById('rokuIp').value = devices[0].ip;
        }
    } catch (error) {
        showStatus('Failed to discover Roku devices: ' + error, 'error');
        console.error('Roku discovery error:', error);
    }
}

// Check Roku status and load apps
async function checkStatus() {
    const ip = getSavedIp();
    if (!ip) {
        // If no IP saved, try discovery first
        if (isNativeRuntime) {
            await discoverRoku();
        } else {
            showStatus('Please enter a Roku IP address in settings.', 'error');
        }
        return;
    }

    showStatus('Connecting to Roku...', 'info');

    try {
        // Get device info
        const deviceInfo = await fetchRokuData(ip, '/query/device-info');
        displayDeviceInfo(deviceInfo);

        // Try to get apps list
        try {
            const appsData = await fetchRokuData(ip, '/query/apps');
            displayApps(appsData);
        } catch (appsError) {
            // If apps query fails (403), show common apps as fallback
            console.warn('Apps query blocked, using common apps:', appsError);
            displayCommonApps();
        }

        // Check what's currently playing
        checkNowPlaying();

        showStatus('Connected successfully!', 'success');
    } catch (error) {
        showStatus('Connection failed: ' + error.message + '. Ask a grown-up to check the Roku IP in settings.', 'error');
        console.error('Full error:', error);
    }
}

// Fetch data from Roku via proxy
async function fetchRokuData(ip, endpoint) {
    try {
        return await RokuTransport.requestXml(ip, endpoint);
    } catch (error) {
        if (!RokuTransport.hasPlugin() && !RokuTransport.isNative) {
            throw new Error(`${error.message} (build the Tauri shell to bypass browser CORS restrictions)`);
        }
        throw error;
    }
}

// Display device information
function displayDeviceInfo(xmlDoc) {
    const deviceInfoEl = document.getElementById('deviceInfo');
    const friendlyName = xmlDoc.querySelector('friendly-device-name')?.textContent || 'Unknown';
    const modelName = xmlDoc.querySelector('model-name')?.textContent || 'Unknown';
    const serialNumber = xmlDoc.querySelector('serial-number')?.textContent || 'Unknown';

    deviceInfoEl.innerHTML = `
        <dl class="grid gap-1 text-indigo-100">
            <div><span class="font-semibold text-white">Device:</span> ${friendlyName}</div>
            <div><span class="font-semibold text-white">Model:</span> ${modelName}</div>
            <div><span class="font-semibold text-white">Serial:</span> ${serialNumber}</div>
        </dl>
    `;
    deviceInfoEl.classList.remove('hidden');
}

// Display available apps from XML
function displayApps(xmlDoc) {
    const appsSection = document.getElementById('appsSection');
    const appsList = document.getElementById('appsList');

    const apps = xmlDoc.querySelectorAll('app');
    if (apps.length === 0) {
        installedApps = [];
        installedAppMap = new Map();
        appsList.innerHTML = '<p class="col-span-full rounded-2xl bg-white/10 px-4 py-3 text-sm text-indigo-100">No apps found.</p>';
        return;
    }

    appsList.innerHTML = '';
    installedApps = [];
    installedAppMap = new Map();

    apps.forEach(app => {
        const id = app.getAttribute('id');
        const name = app.textContent;
        const displayName = (name || '').trim() || `App ${id}`;

        installedApps.push({ id, name: displayName });
        if (name) {
            installedAppMap.set(name.trim().toLowerCase(), id);
        }
        installedAppMap.set(displayName.trim().toLowerCase(), id);

        const button = document.createElement('button');
        button.className = 'rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-left text-sm font-semibold text-white shadow transition hover:-translate-y-1 hover:bg-white/15 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-white/30';
        button.innerHTML = `
            <span class="block text-base font-bold text-white">${displayName}</span>
            <span class="mt-1 block text-xs font-mono uppercase tracking-wide text-indigo-200/80">ID: ${id}</span>
        `;
        button.onclick = () => launchApp(id, displayName);
        appsList.appendChild(button);
    });

    if (settingsUnlocked) {
        appsSection.classList.remove('hidden');
    }
}

// Display common apps (fallback when query is blocked)
function displayCommonApps() {
    const appsSection = document.getElementById('appsSection');
    const appsList = document.getElementById('appsList');

    appsList.innerHTML = '<p class="col-span-full rounded-2xl bg-white/10 px-4 py-3 text-sm text-indigo-100">Your Roku blocked the apps query. Showing common apps:</p>';

    installedApps = [...COMMON_APPS];
    installedAppMap = new Map(COMMON_APPS.map(app => [app.name.trim().toLowerCase(), app.id]));

    COMMON_APPS.forEach(app => {
        const button = document.createElement('button');
        button.className = 'rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-left text-sm font-semibold text-white shadow transition hover:-translate-y-1 hover:bg-white/15 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-white/30';
        button.innerHTML = `
            <span class="block text-base font-bold text-white">${app.name}</span>
            <span class="mt-1 block text-xs font-mono uppercase tracking-wide text-indigo-200/80">ID: ${app.id}</span>
        `;
        button.onclick = () => launchApp(app.id, app.name);
        appsList.appendChild(button);
    });

    if (settingsUnlocked) {
        appsSection.classList.remove('hidden');
    }
}

// Launch an app (with optional deep link)
async function launchApp(appId, appName, contentId = null) {
    const ip = getSavedIp();
    if (!ip) return;

    showStatus(`Launching ${appName}...`, 'info');

    try {
        let endpoint = `/launch/${appId}`;
        // Add content ID for deep linking (if provided)
        if (contentId) {
            endpoint += `?contentID=${encodeURIComponent(contentId)}`;
        }

        await rokuPost(ip, endpoint);
        showStatus(`Launched ${appName}!`, 'success');
        // Auto-refresh now playing after launch
        setTimeout(() => checkNowPlaying(), 2000);
    } catch (error) {
        showStatus(`Failed to launch ${appName}: ${error.message}`, 'error');
        console.error('Launch error:', error);
    }
}

// Check what's currently playing
async function checkNowPlaying() {
    const ip = getSavedIp();
    if (!ip) return;

    const nowPlayingSection = document.getElementById('nowPlayingSection');
    const nowPlayingInfo = document.getElementById('nowPlayingInfo');

    try {
        // Get active app info
        const activeAppData = await fetchRokuData(ip, '/query/active-app');
        const app = activeAppData.querySelector('app');

        if (!app) {
            nowPlayingInfo.innerHTML = '<em>No active app detected</em>';
            if (settingsUnlocked) {
                nowPlayingSection.classList.remove('hidden');
            }
            return;
        }

        const appId = app.getAttribute('id');
        const appName = app.textContent;
        const version = app.getAttribute('version') || 'Unknown';

        let htmlContent = `
            <strong>Active App:</strong> ${appName}<br>
            <strong>App ID:</strong> ${appId}<br>
            <strong>Version:</strong> ${version}<br>
        `;

        // Try to get app UI info (may contain content details)
        try {
            const appUIData = await fetchRokuData(ip, `/query/app-ui?app=${appId}`);
            console.log('App UI XML:', new XMLSerializer().serializeToString(appUIData));

            // Look for any useful content metadata
            const allUIElements = appUIData.querySelectorAll('*');
            const contentFields = [];

            allUIElements.forEach(el => {
                const tagName = el.tagName.toLowerCase();
                const text = el.textContent.trim();

                // Look for fields that might contain content info
                if ((tagName.includes('title') ||
                    tagName.includes('name') ||
                    tagName.includes('content') ||
                    tagName.includes('media') ||
                    tagName.includes('episode') ||
                    tagName.includes('series') ||
                    tagName.includes('show')) && text && text.length > 0) {

                    // Avoid duplicates and long text
                    if (!contentFields.includes(text) && text.length < 200) {
                        contentFields.push({ tag: el.tagName, value: text });
                    }
                }
            });

            if (contentFields.length > 0) {
                htmlContent += '<br><strong style="color: #6633cc;">Content Info:</strong><br>';
                contentFields.forEach(field => {
                    htmlContent += `<strong>${field.tag}:</strong> ${field.value}<br>`;
                });
            }
        } catch (uiError) {
            console.log('App UI info not available:', uiError);
        }

        // Try to get media player info (technical playback details)
        try {
            const mediaData = await fetchRokuData(ip, '/query/media-player');
            latestMediaData = mediaData; // Store for detailed view

            const player = mediaData.querySelector('player');

            if (player) {
                htmlContent += '<br><strong style="color: #6633cc;">Media Player Info:</strong><br>';

                // Get plugin info
                const plugin = player.querySelector('plugin');
                if (plugin) {
                    const pluginId = plugin.getAttribute('id');
                    const pluginName = plugin.getAttribute('name') || plugin.textContent;
                    if (pluginId) htmlContent += `<strong>Plugin ID:</strong> ${pluginId}<br>`;
                    if (pluginName) htmlContent += `<strong>Plugin:</strong> ${pluginName}<br>`;
                }

                // Get all child elements of player and display them
                const children = player.children;
                for (let i = 0; i < children.length; i++) {
                    const child = children[i];
                    const tagName = child.tagName;
                    const text = child.textContent.trim();

                    // Skip plugin since we already handled it
                    if (tagName.toLowerCase() === 'plugin') continue;

                    // Format time fields
                    if (tagName.toLowerCase().includes('duration') ||
                        tagName.toLowerCase().includes('position') ||
                        tagName.toLowerCase().includes('runtime')) {
                        const timeVal = parseInt(text);
                        if (!isNaN(timeVal)) {
                            htmlContent += `<strong>${tagName}:</strong> ${formatTime(timeVal)}<br>`;
                            continue;
                        }
                    }

                    // Show all other fields
                    if (text) {
                        htmlContent += `<strong>${tagName}:</strong> ${text}<br>`;
                    }

                    // Show attributes too
                    Array.from(child.attributes).forEach(attr => {
                        htmlContent += `<strong>${tagName}.${attr.name}:</strong> ${attr.value}<br>`;
                    });
                }

                console.log('Full media player XML:', new XMLSerializer().serializeToString(mediaData));
            }
        } catch (mediaError) {
            // Media player info not available (normal for some apps)
            console.log('Media player info not available:', mediaError);
            latestMediaData = null;
        }

        nowPlayingInfo.innerHTML = htmlContent;
        if (settingsUnlocked) {
            nowPlayingSection.classList.remove('hidden');
        }
    } catch (error) {
        nowPlayingInfo.innerHTML = `<em>Error: ${error.message}</em>`;
        if (settingsUnlocked) {
            nowPlayingSection.classList.remove('hidden');
        }
        console.error('Now playing error:', error);
    }
}

// Show full media player XML details
function showFullMediaInfo() {
    const fullMediaInfo = document.getElementById('fullMediaInfo');

    if (!latestMediaData) {
        fullMediaInfo.textContent = 'No media data available. Click "Refresh Now Playing" first.';
        if (settingsUnlocked) {
            fullMediaInfo.classList.remove('hidden');
        }
        return;
    }

    // Pretty print the XML
    const serializer = new XMLSerializer();
    const xmlString = serializer.serializeToString(latestMediaData);

    // Format the XML for better readability
    const formatted = formatXml(xmlString);
    fullMediaInfo.textContent = formatted;
    if (settingsUnlocked) {
        fullMediaInfo.classList.remove('hidden');
    }
}

// Helper to format XML with indentation
function formatXml(xml) {
    let formatted = '';
    let indent = '';
    const tab = '  ';

    xml.split(/>\s*</).forEach(node => {
        if (node.match(/^\/\w/)) indent = indent.substring(tab.length); // Decrease indent
        formatted += indent + '<' + node + '>\n';
        if (node.match(/^<?\w[^>]*[^\/]$/)) indent += tab; // Increase indent
    });

    return formatted.substring(1, formatted.length - 2);
}

// Helper function to format time (milliseconds to readable format)
function formatTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// Get YouTube playback mode preference
function getYoutubePlaybackMode() {
    return localStorage.getItem(YOUTUBE_PLAYBACK_MODE_KEY) || 'roku';
}

// Set YouTube playback mode preference
function setYoutubePlaybackMode(mode) {
    localStorage.setItem(YOUTUBE_PLAYBACK_MODE_KEY, mode);
    updateYoutubeModeUI();
    showStatus(`YouTube videos will now play ${mode === 'app' ? 'in the app' : 'on Roku'}.`, 'success');
}

// Update YouTube mode button UI
function updateYoutubeModeUI() {
    const mode = getYoutubePlaybackMode();
    const rokuBtn = document.getElementById('youtubePlayRoku');
    const appBtn = document.getElementById('youtubePlayApp');

    if (rokuBtn && appBtn) {
        rokuBtn.setAttribute('data-selected', mode === 'roku' ? 'true' : 'false');
        appBtn.setAttribute('data-selected', mode === 'app' ? 'true' : 'false');
    }
}

// Open YouTube player in app
function openYoutubePlayer(videoId) {
    const overlay = document.getElementById('youtubePlayerOverlay');
    const iframe = document.getElementById('youtubePlayerFrame');

    if (!overlay || !iframe) {
        console.warn('YouTube player elements missing');
        return;
    }

    // YouTube embed URL with autoplay
    iframe.src = `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`;

    overlay.classList.remove('hidden');
    overlay.classList.add('flex');
    document.body.classList.add('youtube-player-open');
}

// Close YouTube player
function closeYoutubePlayer() {
    const overlay = document.getElementById('youtubePlayerOverlay');
    const iframe = document.getElementById('youtubePlayerFrame');

    if (overlay) {
        overlay.classList.add('hidden');
        overlay.classList.remove('flex');
    }

    if (iframe) {
        iframe.src = ''; // Stop video playback
    }

    document.body.classList.remove('youtube-player-open');
}

// Launch specific YouTube video by ID
async function launchSpecificYouTube(videoId) {
    const mode = getYoutubePlaybackMode();

    if (mode === 'app') {
        // Play in app
        openYoutubePlayer(videoId);
        showStatus('Playing video in app...', 'success');
        return;
    }

    // Play on Roku (default)
    const ip = getSavedIp();
    if (!ip) {
        showStatus('No Roku IP configured. Set it in settings or switch to "Play in App" mode.', 'error');
        return;
    }

    showStatus(`Launching YouTube video ${videoId} on Roku...`, 'info');

    try {
        const appId = '837'; // YouTube app ID
        const endpoint = `/launch/${appId}?contentId=${videoId}`;
        console.log('Launching YouTube:', endpoint);

        await rokuPost(ip, endpoint);
        showStatus(`Launched YouTube video on Roku!`, 'success');
        showToast('Launched on Roku!', 'success');
        setTimeout(() => checkNowPlaying(), 2000);
    } catch (error) {
        showStatus(`Failed to launch YouTube: ${error.message}`, 'error');
    }
}

// Launch YouTube video from URL
async function launchYouTube() {
    const url = document.getElementById('youtubeUrl').value.trim();
    const result = document.getElementById('youtubeResult');

    if (!url) {
        showInlineMessage(result, 'Please enter a YouTube URL.', 'error');
        return;
    }

    // YouTube URL patterns:
    // https://www.youtube.com/watch?v=VIDEO_ID
    // https://youtu.be/VIDEO_ID
    // https://m.youtube.com/watch?v=VIDEO_ID

    const patterns = [
        /[?&]v=([a-zA-Z0-9_-]+)/,  // ?v= parameter
        /youtu\.be\/([a-zA-Z0-9_-]+)/, // youtu.be short links
        /youtube\.com\/embed\/([a-zA-Z0-9_-]+)/, // embed links
    ];

    let videoId = null;

    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) {
            videoId = match[1];
            break;
        }
    }

    if (!videoId) {
        showInlineMessage(result, 'Could not extract a video ID. Double-check the URL.', 'error');
        return;
    }

    showInlineMessage(result, `Launching YouTube video ${videoId}...`, 'info');

    const appId = '837'; // YouTube app ID
    const ip = getSavedIp();
    if (!ip) return;

    try {
        // YouTube uses contentId parameter
        const endpoint = `/launch/${appId}?contentId=${videoId}`;
        console.log('Launching YouTube:', endpoint);

        await rokuPost(ip, endpoint);
        showStatus(`Launched YouTube video!`, 'success');
        showInlineMessage(result, `✓ Launched video ${videoId}!`, 'success');
        setTimeout(() => checkNowPlaying(), 2000);
    } catch (error) {
        showStatus(`Failed to launch YouTube: ${error.message}`, 'error');
        showInlineMessage(result, `Failed to launch: ${error.message}`, 'error');
    }
}

// Extract Disney+ content ID from URL
function extractDisneyId() {
    const url = document.getElementById('disneyUrl').value.trim();
    const result = document.getElementById('disneyIdResult');

    if (!url) {
        showInlineMessage(result, 'Please enter a Disney+ URL.', 'error');
        return;
    }

    // Disney+ URL patterns:
    // https://www.disneyplus.com/series/NAME/ID
    // https://www.disneyplus.com/movies/NAME/ID
    // https://www.disneyplus.com/video/ID
    // https://www.disneyplus.com/play/UUID (direct play links)

    const patterns = [
        /disneyplus\.com\/play\/([a-zA-Z0-9_-]+)/,
        /disneyplus\.com\/series\/[^\/]+\/([a-zA-Z0-9_-]+)/,
        /disneyplus\.com\/movies\/[^\/]+\/([a-zA-Z0-9_-]+)/,
        /disneyplus\.com\/video\/([a-zA-Z0-9_-]+)/,
        /disneyplus\.com\/[^\/]+\/[^\/]+\/([a-zA-Z0-9_-]+)/
    ];

    let contentId = null;
    let contentType = 'unknown';

    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) {
            contentId = match[1];
            if (url.includes('/play/')) contentType = 'play';
            else if (url.includes('/series/')) contentType = 'series';
            else if (url.includes('/movies/')) contentType = 'movie';
            else if (url.includes('/video/')) contentType = 'video';
            break;
        }
    }

    if (contentId) {
        result.className = 'rounded-2xl bg-slate-950/60 px-4 py-4 text-xs text-indigo-50 space-y-3';
        result.innerHTML = `
            <div class="text-sm font-semibold text-emerald-300">
                Found ${contentType} ID:
                <code class="ml-1 rounded bg-emerald-500/20 px-2 py-1 font-mono text-[11px] text-emerald-100">${contentId}</code>
            </div>
            <div class="flex flex-col gap-2 sm:flex-row">
                <button class="rounded-2xl bg-white/15 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/25" onclick="tryDisneyDeepLinkSingle('${contentId}', 0)">
                    Try Format 1
                </button>
                <button class="rounded-2xl bg-primary px-3 py-2 text-xs font-semibold text-white transition hover:bg-primary-dark" onclick="tryDisneyDeepLink('${contentId}', '${contentType}')">
                    Try All (30s)
                </button>
            </div>
            <div id="disneyFormatNav" class="hidden items-center justify-between gap-2 rounded-2xl bg-white/10 px-3 py-2 text-[11px] text-indigo-100">
                <button class="rounded-xl bg-white/10 px-3 py-1 text-[11px] font-semibold text-white transition hover:bg-white/20" onclick="tryDisneyPrevFormat()">◄ Prev</button>
                <span id="disneyFormatInfo" class="text-center">Format 1/10</span>
                <button class="rounded-xl bg-white/10 px-3 py-1 text-[11px] font-semibold text-white transition hover:bg-white/20" onclick="tryDisneyNextFormat()">Next ►</button>
            </div>
            <p class="text-[11px] text-indigo-200/80">
                Disney+ deep linking is undocumented. Try different formats until one sticks.
            </p>
        `;
        result.classList.remove('hidden');

        // Store content ID for navigation
        window.currentDisneyContentId = contentId;
        window.currentDisneyContentType = contentType;
        window.currentDisneyFormatIndex = 0;

        // Show navigation
        const nav = document.getElementById('disneyFormatNav');
        if (nav) {
            nav.classList.remove('hidden');
        }
    } else {
        showInlineMessage(result, 'Could not extract an ID. Make sure the Disney+ URL is valid.', 'error');
    }
}

// Get Disney+ format list
function getDisneyFormats(contentId, contentType) {
    return [
        `contentId=${contentId}`,
        `videoId=${contentId}`,
        `programId=${contentId}`,
        `seriesId=${contentId}`,
        `mediaType=${contentType}&contentId=${contentId}`,
        `playbackVideoId=${contentId}`,
        `guid=${contentId}`,
        `uuid=${contentId}`,
        `id=${contentId}`,
        `contentId=${encodeURIComponent(contentId)}`
    ];
}

// Try single Disney+ format
async function tryDisneyDeepLinkSingle(contentId, formatIndex) {
    const appId = '291097';
    const formats = getDisneyFormats(contentId, window.currentDisneyContentType || 'play');

    if (formatIndex >= formats.length) formatIndex = 0;
    if (formatIndex < 0) formatIndex = formats.length - 1;

    window.currentDisneyFormatIndex = formatIndex;

    const params = formats[formatIndex];
    showStatus(`Trying format ${formatIndex + 1}/${formats.length}: ${params}`, 'info');

    // Update nav display
    const navInfo = document.getElementById('disneyFormatInfo');
    if (navInfo) {
        navInfo.textContent = `Format ${formatIndex + 1}/${formats.length}: ${params.substring(0, 40)}${params.length > 40 ? '...' : ''}`;
    }

    try {
        await launchAppWithParams(appId, params);
        setTimeout(() => checkNowPlaying(), 2000);
    } catch (error) {
        showStatus(`Format ${formatIndex + 1} failed: ${error.message}`, 'error');
    }
}

// Navigation functions
function tryDisneyNextFormat() {
    const contentId = window.currentDisneyContentId;
    const currentIndex = window.currentDisneyFormatIndex || 0;
    tryDisneyDeepLinkSingle(contentId, currentIndex + 1);
}

function tryDisneyPrevFormat() {
    const contentId = window.currentDisneyContentId;
    const currentIndex = window.currentDisneyFormatIndex || 0;
    tryDisneyDeepLinkSingle(contentId, currentIndex - 1);
}

// Try Disney+ deep link with extracted ID (all formats)
async function tryDisneyDeepLink(contentId, contentType) {
    const appId = '291097'; // Disney+ app ID
    const formats = getDisneyFormats(contentId, contentType);

    showStatus(`Trying Disney+ deep link (format 1/${formats.length})...`, 'info');

    // Try each format with longer delays
    for (let i = 0; i < formats.length; i++) {
        const params = formats[i];
        showStatus(`Trying format ${i + 1}/${formats.length}: ${params}`, 'info');

        try {
            await launchAppWithParams(appId, params);
            // Wait 3 seconds between attempts to give Disney+ time to respond
            await new Promise(resolve => setTimeout(resolve, 3000));
        } catch (error) {
            console.log(`Format ${i + 1} failed:`, error);
        }
    }

    showStatus('Tried all formats. Check your Roku to see if any worked! Refreshing status...', 'info');
    setTimeout(() => checkNowPlaying(), 3000);
}

// Helper to launch with specific params
async function launchAppWithParams(appId, params = '') {
    const ip = getSavedIp();
    if (!ip) return;

    let endpoint = `/launch/${appId}`;
    if (params) {
        endpoint += `?${params}`;
    }
    console.log('Trying endpoint:', endpoint);

    await rokuPost(ip, endpoint);
}

// Launch deep link from manual input
async function launchDeepLink() {
    const appId = document.getElementById('deepLinkAppId').value.trim();
    const contentId = document.getElementById('deepLinkContentId').value.trim();

    if (!appId) {
        showStatus('Please enter an App ID', 'error');
        return;
    }

    if (!contentId) {
        showStatus('Please enter content parameters', 'error');
        return;
    }

    const ip = getSavedIp();
    if (!ip) return;

    showStatus(`Launching deep link...`, 'info');

    try {
        // Build the deep link URL
        // Format: /launch/{appId}?contentId=xxx or other params
        let endpoint = `/launch/${appId}?${contentId}`;

        // If contentId doesn't start with a parameter name, assume it's contentId
        if (!contentId.includes('=')) {
            endpoint = `/launch/${appId}?contentId=${encodeURIComponent(contentId)}`;
        }

        console.log('Deep link endpoint:', endpoint);

        await rokuPost(ip, endpoint);
        showStatus(`Deep link launched!`, 'success');
        setTimeout(() => checkNowPlaying(), 2000);
    } catch (error) {
        showStatus(`Failed to launch deep link: ${error.message}`, 'error');
        console.error('Deep link error:', error);
    }
}

// Macro System
function initMacroSystem() {
    try {
        const stored = localStorage.getItem(MACRO_STORAGE_KEY);
        macros = stored ? JSON.parse(stored) : [];
    } catch (error) {
        console.warn('Failed to parse macros:', error);
        macros = [];
    }

    macroStepsDraft = [];

    const form = document.getElementById('macroForm');
    if (form) {
        form.addEventListener('submit', handleMacroSubmit);
    }

    updateMacroPreview();
    renderMacroList();
    updateFavoriteMacroButton();
}

function handleMacroSubmit(event) {
    event.preventDefault();

    const nameInput = document.getElementById('macroName');
    const favoriteCheckbox = document.getElementById('macroMarkFavorite');
    const name = nameInput.value.trim();

    if (!name) {
        showStatus('Give your macro a fun name before saving.', 'error');
        return;
    }

    if (macroStepsDraft.length === 0) {
        showStatus('Add at least one step to the macro.', 'error');
        return;
    }

    const macro = {
        id: `macro-${Date.now()}`,
        name,
        steps: [...macroStepsDraft],
        favorite: favoriteCheckbox.checked
    };

    if (macro.favorite) {
        macros = macros.map(existing => ({ ...existing, favorite: false }));
    }

    macros.push(macro);
    saveMacros();

    macroStepsDraft = [];
    updateMacroPreview();
    renderMacroList();
    updateFavoriteMacroButton();

    event.target.reset();
    showStatus(`Saved macro "${macro.name}".`, 'success');
}

function addMacroStep() {
    const type = document.getElementById('macroActionType').value;
    const valueInput = document.getElementById('macroActionValue');
    const rawValue = valueInput.value.trim();

    if (!rawValue) {
        showStatus('Enter a value for the macro step.', 'error');
        return;
    }

    let step = null;

    if (type === 'key') {
        step = { type: 'key', key: rawValue };
    } else if (type === 'launch') {
        const { appId, params, label } = parseLaunchValue(rawValue);
        if (!appId) {
            showStatus('Launch steps need an app ID.', 'error');
            return;
        }
        step = { type: 'launch', appId, params, label };
    } else if (type === 'delay') {
        const duration = parseInt(rawValue, 10);
        if (Number.isNaN(duration) || duration < 0) {
            showStatus('Delay steps must be a positive number of milliseconds.', 'error');
            return;
        }
        step = { type: 'delay', duration };
    }

    if (!step) {
        showStatus('Could not add that step. Please try again.', 'error');
        return;
    }

    macroStepsDraft.push(step);
    updateMacroPreview();
    valueInput.value = '';
    valueInput.focus();
}

function removeMacroStep(index) {
    macroStepsDraft.splice(index, 1);
    updateMacroPreview();
}

function parseLaunchValue(rawValue) {
    const [endpointPart, labelPart] = rawValue.split('|').map(piece => piece.trim());
    const endpoint = endpointPart || '';
    const label = labelPart || '';

    if (!endpoint) return { appId: '', params: '', label };

    const [appIdPart, paramsPart = ''] = endpoint.split('?');
    return {
        appId: appIdPart.trim(),
        params: paramsPart.trim(),
        label
    };
}

function describeMacroStep(step) {
    switch (step.type) {
        case 'key':
            return `Press ${step.key}`;
        case 'launch': {
            const label = step.label || resolveAppName(step.appId);
            return `Launch ${label}${step.params ? ` (${step.params})` : ''}`;
        }
        case 'delay':
            return `Wait ${(step.duration / 1000).toFixed(step.duration % 1000 === 0 ? 0 : 1)}s`;
        default:
            return 'Unknown step';
    }
}

function updateMacroPreview() {
    const preview = document.getElementById('macroStepsPreview');
    if (!preview) return;

    preview.innerHTML = '';

    if (macroStepsDraft.length === 0) {
        const emptyMessage = document.createElement('li');
        emptyMessage.className = 'rounded-2xl bg-white/5 px-4 py-3 text-sm text-indigo-200';
        emptyMessage.textContent = 'No steps yet. Add a key press, launch, or delay.';
        preview.appendChild(emptyMessage);
        return;
    }

    macroStepsDraft.forEach((step, index) => {
        const item = document.createElement('li');
        item.className = 'flex items-center justify-between gap-3 rounded-2xl bg-white/10 px-4 py-2 text-sm text-indigo-100';

        const description = document.createElement('span');
        description.textContent = describeMacroStep(step);

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'rounded-xl bg-white/10 px-3 py-1 text-xs font-semibold text-white transition hover:bg-white/20';
        removeBtn.textContent = 'Remove';
        removeBtn.addEventListener('click', () => removeMacroStep(index));

        item.append(description, removeBtn);
        preview.appendChild(item);
    });
}

function renderMacroList() {
    const list = document.getElementById('macroList');
    if (!list) return;

    list.innerHTML = '';

    if (macros.length === 0) {
        const emptyState = document.createElement('p');
        emptyState.className = 'rounded-2xl bg-white/10 px-4 py-3 text-sm text-indigo-100';
        emptyState.textContent = 'No macros yet. Build one above to unlock automations.';
        list.appendChild(emptyState);
        return;
    }

    macros.forEach(macro => {
        const card = document.createElement('div');
        card.className = 'rounded-2xl bg-white/10 p-4 text-sm text-indigo-100 shadow';

        const header = document.createElement('div');
        header.className = 'flex items-center justify-between gap-3';

        const title = document.createElement('h4');
        title.className = 'text-base font-semibold text-white';
        title.textContent = macro.name;

        const badge = document.createElement('span');
        if (macro.favorite) {
            badge.className = 'rounded-full bg-primary px-3 py-1 text-xs font-semibold text-white';
            badge.textContent = 'Magic Button';
        }

        const steps = document.createElement('p');
        steps.className = 'mt-3 text-xs leading-relaxed text-indigo-100/80';
        steps.textContent = macro.steps.map(describeMacroStep).join(' • ');

        const actions = document.createElement('div');
        actions.className = 'mt-4 flex flex-wrap gap-2';

        const runBtn = document.createElement('button');
        runBtn.className = 'rounded-2xl bg-primary px-4 py-2 text-xs font-semibold text-white transition hover:bg-primary-dark';
        runBtn.textContent = 'Run';
        runBtn.addEventListener('click', () => runMacro(macro.id));

        const favoriteBtn = document.createElement('button');
        favoriteBtn.className = 'rounded-2xl bg-white/15 px-4 py-2 text-xs font-semibold text-white transition hover:bg-white/25';
        favoriteBtn.textContent = macro.favorite ? 'Unset Magic Button' : 'Set as Magic Button';
        favoriteBtn.addEventListener('click', () => setFavoriteMacro(macro.id));

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'rounded-2xl bg-rose-500/20 px-4 py-2 text-xs font-semibold text-rose-100 transition hover:bg-rose-500/30';
        deleteBtn.textContent = 'Delete';
        deleteBtn.addEventListener('click', () => deleteMacro(macro.id));

        header.append(title);
        if (macro.favorite) header.append(badge);
        actions.append(runBtn, favoriteBtn, deleteBtn);
        card.append(header, steps, actions);
        list.appendChild(card);
    });
}

function setFavoriteMacro(macroId) {
    let updated = false;
    macros = macros.map(macro => {
        if (macro.id === macroId) {
            updated = true;
            return { ...macro, favorite: !macro.favorite };
        }
        return { ...macro, favorite: false };
    });

    if (!updated) {
        showStatus('Macro not found.', 'error');
        return;
    }

    saveMacros();
    renderMacroList();
    updateFavoriteMacroButton();
}

function deleteMacro(macroId) {
    macros = macros.filter(macro => macro.id !== macroId);
    saveMacros();
    renderMacroList();
    updateFavoriteMacroButton();
    showStatus('Macro deleted.', 'info');
}

function updateFavoriteMacroButton() {
    const button = document.getElementById('favoriteMacroButton');
    const label = document.getElementById('favoriteMacroLabel');

    if (!button || !label) return;

    const favoriteMacro = macros.find(macro => macro.favorite);

    if (favoriteMacro) {
        label.textContent = favoriteMacro.name;
        button.classList.remove('hidden');
    } else {
        button.classList.add('hidden');
    }
}

let macroRunning = false;

async function runMacro(macroId) {
    if (macroRunning) {
        showStatus('A macro is already running.', 'error');
        return;
    }

    const macro = macros.find(item => item.id === macroId);
    if (!macro) {
        showStatus('Macro not found.', 'error');
        return;
    }

    const ip = getSavedIp();
    if (!ip) return;

    macroRunning = true;
    showStatus(`Running macro "${macro.name}"...`, 'info');

    try {
        for (const step of macro.steps) {
            await executeMacroStep(step);
        }
        showStatus(`Macro "${macro.name}" finished!`, 'success');
    } catch (error) {
        showStatus(`Macro stopped: ${error.message}`, 'error');
    } finally {
        macroRunning = false;
    }
}

async function executeMacroStep(step) {
    switch (step.type) {
        case 'key':
            await sendKey(step.key);
            await sleep(300);
            break;
        case 'launch': {
            const label = step.label || resolveAppName(step.appId);
            showStatus(`Macro launching ${label}...`, 'info');
            await launchAppWithParams(step.appId, step.params);
            await sleep(1500);
            break;
        }
        case 'delay':
            await sleep(step.duration);
            break;
        default:
            console.warn('Unknown macro step encountered:', step);
    }
}

function resolveAppName(appId) {
    const match = COMMON_APPS.find(app => app.id === appId);
    return match ? match.name : `App ${appId}`;
}

function saveMacros() {
    localStorage.setItem(MACRO_STORAGE_KEY, JSON.stringify(macros));
}

function runFavoriteMacro() {
    const favorite = macros.find(macro => macro.favorite);
    if (!favorite) {
        showStatus('Set a macro as the Magic Button in Settings first.', 'error');
        return;
    }
    runMacro(favorite.id);
}

function openMacroHelp() {
    showStatus('Add steps (Press Key, Launch App, Wait) to craft routines. Mark one as the Magic Button to show it in kid mode.', 'info');
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function maskPin(pin) {
    if (!pin) return '';
    return '•'.repeat(pin.length);
}

function updateParentalControlsUI() {
    const input = document.getElementById('parentalPinInput');
    const statusEl = document.getElementById('parentalPinStatus');
    const localPin = getLocalParentalPin();

    if (input && input !== document.activeElement) {
        input.value = localPin || '';
    }

    if (statusEl) {
        if (localPin) {
            statusEl.textContent = `Using device-specific PIN (${maskPin(localPin)}) on this device.`;
        } else if (remotePinCode && remotePinCode !== DEFAULT_PIN_CODE) {
            statusEl.textContent = 'Using PIN from cloud config.';
        } else {
            statusEl.textContent = 'Using default PIN (1234).';
        }
    }
}

function saveParentalPinOverride() {
    const input = document.getElementById('parentalPinInput');
    if (!input) return;
    const digits = sanitizePinValue(input.value);
    if (digits.length !== 4) {
        showStatus('PIN must be exactly 4 digits.', 'error');
        return;
    }
    setLocalParentalPin(digits);
    showStatus('PIN updated for this device.', 'success');
}

function clearParentalPinOverride() {
    setLocalParentalPin('');
    const input = document.getElementById('parentalPinInput');
    if (input && input !== document.activeElement) {
        input.value = '';
    }
    showStatus('PIN reset to the cloud/default value.', 'info');
}

// Settings Lock Functions
function handleSettingsClick(event) {
    const pinModal = document.getElementById('pinModal');
    const modalOpen = pinModal && !pinModal.classList.contains('hidden');
    if (settingsUnlocked && !modalOpen) {
        event.preventDefault();
        hideSettings();
        return;
    }
    if (!settingsUnlocked && !modalOpen) {
        event.preventDefault();
        showStatus('Hold the gear button for two seconds to unlock advanced controls.', 'info');
    }
}

function startSettingsHold() {
    if (isHolding) return;
    if (settingsUnlocked) {
        hideSettings();
        return;
    }
    isHolding = true;

    const circle = document.getElementById('progressCircle');
    const lockBtn = document.getElementById('settingsLock');
    lockBtn.classList.add('scale-95', 'ring-4', 'ring-white/60');

    const startTime = Date.now();
    const interval = 50; // Update every 50ms

    holdTimer = setInterval(() => {
        const elapsed = Date.now() - startTime;
        holdProgress = Math.min(elapsed / HOLD_DURATION, 1);

        // Update circle progress
        const offset = PROGRESS_CIRCUMFERENCE - (holdProgress * PROGRESS_CIRCUMFERENCE);
        circle.style.strokeDashoffset = offset;

        if (holdProgress >= 1) {
            stopSettingsHold();
            openPinModal();
        }
    }, interval);
}

function stopSettingsHold() {
    if (!isHolding) return;
    isHolding = false;

    clearInterval(holdTimer);
    holdTimer = null;
    holdProgress = 0;

    const circle = document.getElementById('progressCircle');
    const lockBtn = document.getElementById('settingsLock');
    circle.style.strokeDashoffset = PROGRESS_CIRCUMFERENCE;
    lockBtn.classList.remove('scale-95', 'ring-4', 'ring-white/60');
}

// PIN Modal Functions
function openPinModal() {
    const modal = document.getElementById('pinModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    currentPin = '';
    updatePinDisplay();
}

function closePinModal() {
    const modal = document.getElementById('pinModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    currentPin = '';
}

function enterPin(digit) {
    if (currentPin.length < 4) {
        currentPin += digit;
        updatePinDisplay();

        if (currentPin.length === 4) {
            checkPin();
        }
    }
}

function clearPin() {
    currentPin = '';
    updatePinDisplay();
}

function updatePinDisplay() {
    const display = document.getElementById('pinDisplay');
    const filled = '●'.repeat(currentPin.length);
    const empty = '○'.repeat(Math.max(0, 4 - currentPin.length));
    display.textContent = (filled + empty).padEnd(4, '○');
    display.classList.remove('text-rose-500');
    display.classList.add('text-indigo-600');
}

function checkPin() {
    if (currentPin === getActivePinCode()) {
        settingsUnlocked = true;
        closePinModal();
        showSettings();
    } else {
        // Wrong PIN - shake and clear
        const display = document.getElementById('pinDisplay');
        display.textContent = '✖ Wrong PIN';
        display.classList.remove('text-indigo-600');
        display.classList.add('text-rose-500');
        setTimeout(() => {
            clearPin();
        }, 1000);
    }
}

function renderTabConfig() {
    const container = document.getElementById('tabConfigList');
    if (!container) return;

    container.innerHTML = '';

    const tabs = getTabsForRendering();
    tabs.forEach(tab => {
        const card = document.createElement('div');
        card.className = 'rounded-2xl bg-white/10 p-4 space-y-2';

        const header = document.createElement('div');
        header.className = 'flex items-center gap-2';

        const icon = document.createElement('span');
        icon.className = 'text-2xl';
        icon.textContent = tab.icon;

        const label = document.createElement('span');
        label.className = 'font-bold text-white';
        label.textContent = tab.label;

        header.append(icon, label);

        const info = document.createElement('div');
        info.className = 'text-xs text-indigo-100 space-y-1';

        const idInfo = document.createElement('div');
        idInfo.innerHTML = `<span class="font-semibold">ID:</span> <code class="font-mono bg-white/10 px-1 py-0.5 rounded">${tab.id}</code>`;

        // Get button count from the config if available
        const tabData = tabsConfig?.tabs?.find(t => t.id === tab.id);
        const buttonCount = Array.isArray(tabData?.buttons) ? tabData.buttons.length : 0;
        const quickLaunchCount = Array.isArray(tabData?.quickLaunch) ? tabData.quickLaunch.length : 0;

        const buttonsInfo = document.createElement('div');
        buttonsInfo.className = 'text-[11px]';
        if (quickLaunchCount > 0) {
            buttonsInfo.innerHTML = `<span class="font-semibold">Content:</span> ${buttonCount} buttons, ${quickLaunchCount} quick launch items`;
        } else {
            buttonsInfo.innerHTML = `<span class="font-semibold">Content:</span> ${buttonCount} buttons`;
        }

        info.append(idInfo, buttonsInfo);
        card.append(header, info);
        container.appendChild(card);
    });
}

function showSettings() {
    // Show all advanced settings
    const advancedSections = document.querySelectorAll('[data-settings]');
    advancedSections.forEach(section => {
        section.classList.remove('hidden');
    });
    renderQuickLaunchSettings(toddlerQuickLaunchItems);
    updateToddlerContentSourceInfo();

    updateParentalControlsUI();
    updateYoutubeModeUI();
    renderTabConfig();
    showStatus('Settings unlocked! Advanced controls are now visible.', 'success');

    const contentSourceSection = document.getElementById('contentSourceSection');
    if (contentSourceSection) {
        setTimeout(() => {
            contentSourceSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
            contentSourceSection.classList.add('showcase-highlight');
            setTimeout(() => {
                contentSourceSection.classList.remove('showcase-highlight');
            }, 1600);
        }, 50);
    }
}

function hideSettings() {
    const advancedSections = document.querySelectorAll('[data-settings]');
    advancedSections.forEach(section => {
        section.classList.add('hidden');
    });
    const contentSourceSection = document.getElementById('contentSourceSection');
    if (contentSourceSection) {
        contentSourceSection.classList.remove('showcase-highlight');
    }
    settingsUnlocked = false;
    showStatus('Advanced controls hidden. Hold the gear button to unlock again.', 'info');
}

// Toggle dark/light theme
function toggleTheme() {
    const html = document.documentElement;
    const currentTheme = html.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', newTheme);
    applyTheme(newTheme);
    localStorage.setItem('theme', newTheme);
}

// Initialize theme on separate listener to avoid conflicts
(function () {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    applyTheme(savedTheme);
})();

function applyTheme(theme) {
    const body = document.body;
    const darkClasses = ['from-indigo-500', 'via-indigo-600', 'to-purple-700', 'text-white'];
    const lightClasses = ['from-indigo-200', 'via-purple-100', 'to-pink-200', 'text-slate-900'];

    if (theme === 'light') {
        body.classList.remove(...darkClasses);
        body.classList.add(...lightClasses);
    } else {
        body.classList.remove(...lightClasses);
        body.classList.add(...darkClasses);
    }
}

// Send key press to Roku
async function sendKey(key) {
    const ip = getSavedIp();
    if (!ip) return;

    try {
        await rokuPost(ip, `/keypress/${encodeRokuPathSegment(key)}`);

        // Visual feedback
        console.log(`Sent key: ${key}`);
    } catch (error) {
        showStatus(`Failed to send key ${key}: ${error.message}`, 'error');
        console.error('Key press error:', error);
    }
}
