// Roku Control App
const STORAGE_KEY = 'roku_ip';
const PIN_CODE = '1234'; // Change this to your desired PIN
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
const TODDLER_CONTENT_URL_KEY = 'toddler_content_url';
const TIMER_CIRCUMFERENCE = 2 * Math.PI * 54;
const GOVEE_IP_STORAGE_KEY = 'govee_ip';
const GOVEE_PORT_STORAGE_KEY = 'govee_port';
const GOVEE_BRIGHTNESS_STORAGE_KEY = 'govee_brightness';
const GOVEE_DEFAULT_PORT = 4003;
const GOVEE_MIN_BRIGHTNESS = 1;
const GOVEE_POWER_STATE_PREFIX = 'govee_power_state_';
const GOVEE_API_KEY_STORAGE_KEY = 'govee_api_key';
const YOUTUBE_PLAYBACK_MODE_KEY = 'youtube_playback_mode'; // 'roku' or 'app'
const GOVEE_STATUS_VARIANTS = {
    info: 'bg-white/10 text-indigo-100',
    success: 'bg-emerald-500/20 text-emerald-50 border border-emerald-200/40',
    error: 'bg-rose-500/20 text-rose-50 border border-rose-200/40'
};
const GOVEE_CAPABILITY_LABELS = {
    'devices.capabilities.on_off': 'Power (on/off)',
    'devices.capabilities.brightness': 'Brightness control',
    'devices.capabilities.color': 'RGB color control',
    'devices.capabilities.color_temperature': 'Color temperature',
    'devices.capabilities.color_temperature_v2': 'Color temperature',
    'devices.capabilities.mode': 'Scene modes',
    'devices.capabilities.effect': 'Lighting effects',
    'devices.capabilities.music': 'Music sync',
    turn: 'Power (on/off)',
    brightness: 'Brightness',
    color: 'RGB color',
    colorTem: 'Color temperature',
    color_temp: 'Color temperature'
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
    magic: {
        id: 'magic',
        defaultLabel: 'Magic Time',
        defaultIcon: '⏱️',
        sections: ['magicSection']
    },
    lights: {
        id: 'lights',
        defaultLabel: 'Lights',
        defaultIcon: '💡',
        sections: ['lightsButtonSection', 'goveeSection']
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
let goveeCloudDevices = [];
let goveeCloudDevicesLoaded = false;
let goveeCloudDevicesLoading = false;

if (typeof window !== 'undefined') {
    window.getButtonHandlerCatalog = () => buttonTypeCatalog;
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
let fireworksInterval = null;
let fireworksTimeout = null;
let nativeTtsStatusTimeout = null;
let selectedTimerEmoji = '⭐';
let currentTimerAnimation = 0;

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

function getTabsForRendering() {
    // If we have a loaded config, use it
    if (tabsConfig && Array.isArray(tabsConfig.tabs)) {
        return tabsConfig.tabs.map(tab => ({
            id: tab.id,
            label: tab.label || TAB_DEFINITIONS[tab.id]?.defaultLabel || tab.id,
            icon: tab.icon || TAB_DEFINITIONS[tab.id]?.defaultIcon || '📱',
            // Use sections from TAB_DEFINITIONS since HTML sections are hardcoded
            sections: TAB_DEFINITIONS[tab.id]?.sections || []
        }));
    }

    // Fallback to hardcoded tabs
    return [
        buildTabFromDefinition(TAB_DEFINITIONS.remote),
        buildTabFromDefinition(TAB_DEFINITIONS.apps),
        buildTabFromDefinition(TAB_DEFINITIONS.lights),
        buildTabFromDefinition(TAB_DEFINITIONS.magic)
    ];
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

function renderBottomTabs() {
    const nav = document.getElementById('bottomTabNav');
    const buttonsContainer = document.getElementById('bottomTabButtons');
    if (!nav || !buttonsContainer) return;

    const tabs = getTabsForRendering();
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

function getToddlerContentUrl() {
    return localStorage.getItem(TODDLER_CONTENT_URL_KEY) || '';
}

function setToddlerContentUrl(url) {
    if (url) {
        localStorage.setItem(TODDLER_CONTENT_URL_KEY, url);
    } else {
        localStorage.removeItem(TODDLER_CONTENT_URL_KEY);
    }
    updateToddlerContentSourceInfo();
}

function updateToddlerContentSourceInfo() {
    const info = document.getElementById('toddlerContentCacheInfo');
    const urlInput = document.getElementById('toddlerContentUrl');
    const url = getToddlerContentUrl().trim();

    if (urlInput && urlInput !== document.activeElement) {
        urlInput.value = url;
    }

    if (!info) return;

    if (url) {
        info.textContent = `Source: ${url} (remote URL, always fetches fresh)`;
        return;
    }

    if (toddlerContentSource?.type === 'custom') {
        info.textContent = 'Using local kid-mode override (config/toddler/custom.json).';
    } else if (toddlerContentSource?.type === 'bundled') {
        info.textContent = 'Using bundled kid-mode buttons (config/toddler/default.json).';
    } else if (toddlerContentSource?.type === 'empty') {
        info.textContent = 'No kid-mode buttons available. Check your config files.';
    } else {
        info.textContent = 'Kid-mode button source not set yet.';
    }
}

// Legacy function name - kept for compatibility after refactor
function updateToddlerContentCacheMeta() {
    updateToddlerContentSourceInfo();
}

function setToddlerContentSource(source) {
    toddlerContentSource = source || { type: 'unknown' };
    updateToddlerContentSourceInfo();
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
    // Extract tabs and buttons from the unified config structure
    const tabs = Array.isArray(data?.tabs) ? data.tabs : [];

    // Store tabs config for navigation
    tabsConfig = { tabs };

    const remoteTab = tabs.find(tab => tab.id === 'remote');
    const appsTab = tabs.find(tab => tab.id === 'apps');
    const lightsTab = tabs.find(tab => tab.id === 'lights');
    const magicTab = tabs.find(tab => tab.id === 'magic');

    const remoteButtons = Array.isArray(remoteTab?.buttons) ? [...remoteTab.buttons] : [];
    const appsButtons = Array.isArray(appsTab?.buttons) ? [...appsTab.buttons] : [];
    const lightsButtons = Array.isArray(lightsTab?.buttons) ? [...lightsTab.buttons] : [];
    const magicButtons = Array.isArray(magicTab?.buttons) ? [...magicTab.buttons] : [];

    // Normalize quick launch items (auto-generate id, thumbnail, etc.)
    const rawQuickLaunch = Array.isArray(appsTab?.quickLaunch) ? appsTab.quickLaunch : [];
    toddlerQuickLaunchItems = rawQuickLaunch.map(normalizeQuickLaunchItem);

    // Combine remote and apps buttons for rendering
    toddlerSpecialButtons = [...remoteButtons, ...appsButtons, ...lightsButtons, ...magicButtons];

    renderToddlerButtons(remoteButtons, appsButtons, toddlerQuickLaunchItems);
    renderLightsButtons(lightsButtons);
    renderMagicButtons(magicButtons);
    renderQuickLaunchSettings(toddlerQuickLaunchItems);
}

async function fetchToddlerContentFromUrl(url) {
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

async function saveToddlerContentUrl() {
    const input = document.getElementById('toddlerContentUrl');
    if (!input) return;

    const rawUrl = input.value.trim();
    if (rawUrl) {
        try {
            // Validate URL format
            new URL(rawUrl);
        } catch (error) {
            showStatus('Enter a valid URL for kid-mode buttons.', 'error');
            return;
        }
        setToddlerContentUrl(rawUrl);
        await loadToddlerContent({ forceRefresh: true });
    } else {
        setToddlerContentUrl('');
        await loadToddlerContent({ forceRefresh: true });
        showStatus('Kid-mode button URL cleared. Using bundled defaults.', 'info');
    }
}

async function refreshToddlerContent() {
    await loadToddlerContent({ forceRefresh: true });
}

function clearToddlerContentCache() {
    // No cache to clear - just reload content
    showStatus('Reloading kid-mode buttons...', 'info');
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

function handleMagicTimerStart(durationSeconds) {
    const seconds = Number(durationSeconds);
    if (!Number.isFinite(seconds) || seconds <= 0) {
        showStatus('Pick a timer length to get started.', 'error');
        return;
    }

    const minutes = seconds / 60;
    const label =
        minutes >= 1
            ? `${Math.round(minutes * 10) / 10} minute timer`
            : `${seconds} second timer`;
    startToddlerTimer(seconds, label);
}

function handleMagicFireworks() {
    startFireworksShow(8, 'Fireworks Celebration!');
}

function handleMagicSpeak(text) {
    const phrase = typeof text === 'string' ? text.trim() : '';
    if (!phrase) {
        showStatus('Type something to say first.', 'error');
        return false;
    }
    speakTts(phrase);
    return true;
}

function stopMagicSpeak() {
    const nativeBridge = getNativeTtsBridge();
    try {
        if (nativeBridge?.stop) {
            nativeBridge.stop();
        }
    } catch (error) {
        console.warn('Native TTS stop failed', error);
    }

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        try {
            window.speechSynthesis.cancel();
        } catch (error) {
            console.warn('Speech synthesis cancel failed', error);
        }
    }

    showStatus('Voice stopped.', 'info');
}

function initMagicControls() {
    const quickButtons = document.querySelectorAll('[data-magic-timer]');
    quickButtons.forEach(button => {
        if (!button.__magicTimerBound) {
            button.__magicTimerBound = true;
            button.addEventListener('click', () => handleMagicTimerStart(button.dataset.magicTimer));
        }
    });

    const customMinutesInput = document.getElementById('magicTimerMinutes');
    const timerForm = document.getElementById('magicTimerForm');
    if (timerForm && !timerForm.__magicSubmitBound) {
        timerForm.__magicSubmitBound = true;
        timerForm.addEventListener('submit', event => {
            event.preventDefault();
            const minutesRaw = customMinutesInput ? Number(customMinutesInput.value) : NaN;
            if (!Number.isFinite(minutesRaw) || minutesRaw <= 0) {
                showStatus('Enter the number of minutes for the timer.', 'error');
                return;
            }
            handleMagicTimerStart(minutesRaw * 60);
        });
    }

    const cancelButton = document.getElementById('magicTimerCancel');
    if (cancelButton && !cancelButton.__magicCancelBound) {
        cancelButton.__magicCancelBound = true;
        cancelButton.addEventListener('click', () => cancelToddlerTimer());
    }

    const fireworksButton = document.getElementById('magicFireworksButton');
    if (fireworksButton && !fireworksButton.__magicFireworksBound) {
        fireworksButton.__magicFireworksBound = true;
        fireworksButton.addEventListener('click', () => handleMagicFireworks());
    }

    // Timer emoji selection
    const emojiButtons = document.querySelectorAll('[data-timer-emoji]');
    emojiButtons.forEach(button => {
        if (!button.__emojiSelectBound) {
            button.__emojiSelectBound = true;
            button.addEventListener('click', () => {
                const emoji = button.dataset.timerEmoji;
                selectedTimerEmoji = emoji || '⭐';

                // Update UI to show selected
                emojiButtons.forEach(btn => btn.setAttribute('data-selected', 'false'));
                button.setAttribute('data-selected', 'true');
            });
        }
    });

    // Set first emoji as selected by default
    if (emojiButtons.length > 0 && !emojiButtons[0].dataset.selected) {
        emojiButtons[0].setAttribute('data-selected', 'true');
    }

    const speakForm = document.getElementById('magicSpeakForm');
    const speakInput = document.getElementById('magicSpeakInput');
    if (speakForm && !speakForm.__magicSpeakBound) {
        speakForm.__magicSpeakBound = true;
        speakForm.addEventListener('submit', event => {
            event.preventDefault();
            const phrase = speakInput ? speakInput.value : '';
            const spoke = handleMagicSpeak(phrase);
            if (spoke && speakInput) {
                speakInput.value = '';
                speakInput.focus();
            }
        });
    }

    const stopSpeakButton = document.getElementById('magicSpeakStop');
    if (stopSpeakButton && !stopSpeakButton.__magicStopBound) {
        stopSpeakButton.__magicStopBound = true;
        stopSpeakButton.addEventListener('click', () => stopMagicSpeak());
    }
}

// Initialize on load
window.addEventListener('DOMContentLoaded', async () => {
    // Log runtime info for debugging
    if (isNativeRuntime) {
        console.log('Running inside Tauri shell');
    }

    // Load tabs config before initializing tab controls
    await loadTabsConfig();
    initTabControls();
    initMagicControls();
    updateToddlerContentCacheMeta();
    void loadButtonTypeCatalog();
    initGoveeControls();
    await loadToddlerContent();

    // Run device discovery at startup
    if (isNativeRuntime) {
        discoverAndRegisterAllDevices().catch(err => {
            console.warn('Startup discovery failed:', err);
        });
    }

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

    // Initialize room detection system
    await loadRoomConfig();
    updateRoomUI();

    // Start auto room detection if enabled
    if (roomConfig?.settings?.autoDetect && isNativeRuntime) {
        startRoomDetection();
    }
});

async function loadToddlerContent({ forceRefresh = false } = {}) {
    const remoteUrl = getToddlerContentUrl().trim();

    // If remote URL is configured, try fetching from it (always fresh, no cache)
    if (remoteUrl) {
        try {
            const remoteData = await fetchToddlerContentFromUrl(remoteUrl);
            setToddlerContentSource({ type: 'remote', url: remoteUrl });
            applyToddlerContent(remoteData);
            showStatus('Kid-mode buttons loaded from remote URL.', 'success');
            return;
        } catch (error) {
            console.error('Failed to fetch remote toddler content:', error);
            showStatus('Remote URL failed. Falling back to local config.', 'error');
            // Fall through to local loading
        }
    }

    // Load from local files (custom.json or default.json)
    const localContent = await fetchLocalToddlerContent();
    if (localContent) {
        setToddlerContentSource(localContent.source);
        applyToddlerContent(localContent.data);
        if (!remoteUrl) {
            // No remote URL configured - this is the primary source
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

function renderLightsButtons(buttons = []) {
    const column = document.getElementById('lightsButtonColumn');
    if (!column) return;

    column.innerHTML = '';

    if (buttons.length === 0) {
        const emptyState = document.createElement('div');
        emptyState.className = 'col-span-full rounded-3xl bg-white/10 px-6 py-8 text-center text-lg font-semibold text-indigo-100';
        emptyState.textContent = 'No light buttons configured yet.';
        column.appendChild(emptyState);
    } else {
        buttons.forEach(config => {
            const element = createQuickButtonElement(config);
            if (element) {
                column.appendChild(element);
            }
        });
    }
}

function renderMagicButtons(buttons = []) {
    const column = document.getElementById('magicButtonColumn');
    if (!column) return;

    column.innerHTML = '';

    if (buttons.length === 0) {
        const emptyState = document.createElement('div');
        emptyState.className = 'col-span-full rounded-3xl bg-white/10 px-6 py-8 text-center text-lg font-semibold text-indigo-100';
        emptyState.textContent = 'No magic buttons configured yet.';
        column.appendChild(emptyState);
    } else {
        buttons.forEach(config => {
            const element = createQuickButtonElement(config);
            if (element) {
                column.appendChild(element);
            }
        });
    }
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

    const args = Array.isArray(config.args)
        ? config.args
        : config.args !== undefined
            ? [config.args]
            : [];

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

// Device Registry System
const DEVICE_REGISTRY_KEY = 'device_registry';

function getDeviceRegistry() {
    try {
        const data = localStorage.getItem(DEVICE_REGISTRY_KEY);
        return data ? JSON.parse(data) : { roku: {}, govee: {} };
    } catch (error) {
        console.error('Failed to parse device registry:', error);
        return { roku: {}, govee: {} };
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
        roku: Object.values(registry.roku || {}),
        govee: Object.values(registry.govee || {})
    };
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

        // Discover Govee devices
        console.log('💡 Discovering Govee devices...');
        const goveeDevices = await tauriInvoke('govee_discover', { timeout_ms: 3000 });
        console.log(`Found ${goveeDevices.length} Govee device(s)`);
        goveeDevices.forEach(registerGoveeDevice);

        const allDevices = getAllDevices();
        console.log('✅ Discovery complete!');
        console.log(`   Total: ${allDevices.roku.length} Roku + ${allDevices.govee.length} Govee`);

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
            statusEl.textContent = `Found ${devices.roku.length} Roku + ${devices.govee.length} Govee devices`;
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
        // Try to load custom room config from localStorage
        const stored = localStorage.getItem(ROOM_CONFIG_STORAGE_KEY);
        if (stored) {
            roomConfig = JSON.parse(stored);
            console.log('📍 Loaded room config from localStorage');
            return roomConfig;
        }

        // Fall back to default config file
        const response = await fetch('/config/rooms.json');
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
        let completed = false;

        // Create a channel handler for receiving devices
        const handleDevices = (deviceList) => {
            if (!completed) {
                devices = deviceList;
            }
        };

        // Start the scan
        tauriInvoke('plugin:blec|scan', {
            timeout: timeoutMs,
            allowIbeacons: false,
            handler: handleDevices
        })
        .then(() => {
            completed = true;
            // Convert plugin format to our format
            const convertedDevices = devices.map(d => ({
                address: d.address,
                name: d.name || 'Unknown',
                rssi: d.rssi,
                manufacturer_data: Object.entries(d.manufacturer_data || {}).map(([id, data]) => ({
                    id: parseInt(id),
                    data: data.map(b => b.toString(16).padStart(2, '0')).join('')
                })),
                type: 'ble'
            }));
            resolve(convertedDevices);
        })
        .catch((error) => {
            completed = true;
            console.error('BLE scan error:', error);
            reject(error);
        });

        // Timeout fallback
        setTimeout(() => {
            if (!completed) {
                completed = true;
                resolve(devices);
            }
        }, timeoutMs + 1000);
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

function filterControlsByRoom() {
    // Filter buttons/controls to show only those relevant to current room
    // This will be implemented when we add room assignments to buttons

    const room = getCurrentRoom();

    if (!room || !roomConfig) {
        // Show all controls if no room selected
        return;
    }

    const roomData = roomConfig.rooms.find(r => r.id === room);
    if (!roomData) {
        return;
    }

    console.log(`🔍 Filtering controls for room: ${roomData.name}`);

    // TODO: Implement actual filtering logic
    // For now, just log which devices belong to this room
    console.log(`  Roku devices:`, roomData.devices?.roku || []);
    console.log(`  Govee devices:`, roomData.devices?.govee || []);
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

    if (!roomIndicator || !roomSelector) return;

    // Populate room selector dropdown
    if (roomConfig && roomConfig.rooms && roomConfig.rooms.length > 0) {
        roomSelector.innerHTML = '<option value="">All Rooms</option>';

        roomConfig.rooms.forEach(r => {
            const option = document.createElement('option');
            option.value = r.id;
            option.textContent = `${r.emoji || '📍'} ${r.name}`;
            roomSelector.appendChild(option);
        });

        // Show room selector bar
        if (roomSelectorBar) {
            roomSelectorBar.classList.remove('hidden');
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
    if (currentPin === PIN_CODE) {
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
    updateToddlerContentCacheMeta();
    updateGoveeUI();
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
(function() {
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
