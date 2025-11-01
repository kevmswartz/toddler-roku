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
const TODDLER_CONTENT_DEFAULT_PATH = `${CONFIG_BASE_PATH}/toddler/default.json`;
const TODDLER_CONTENT_CUSTOM_PATH = `${CONFIG_BASE_PATH}/toddler/custom.json`;
const BUTTON_TYPES_CONFIG_PATH = `${CONFIG_BASE_PATH}/button-types.json`;
const TODDLER_CONTENT_URL_KEY = 'toddler_content_url';
const TIMER_CIRCUMFERENCE = 2 * Math.PI * 54;
const GOVEE_IP_STORAGE_KEY = 'govee_ip';
const GOVEE_PORT_STORAGE_KEY = 'govee_port';
const GOVEE_BRIGHTNESS_STORAGE_KEY = 'govee_brightness';
const GOVEE_DEFAULT_PORT = 4003;
const GOVEE_MIN_BRIGHTNESS = 1;
const GOVEE_POWER_STATE_PREFIX = 'govee_power_state_';
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
    remote: {
        id: 'remote',
        defaultLabel: 'Remote',
        defaultIcon: '🎮',
        sections: ['toddlerControls', 'remoteSection']
    },
    apps: {
        id: 'apps',
        defaultLabel: 'Roku Rooms',
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
        sections: ['goveeSection']
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
let toddlerContentSource = { type: 'bundled', path: TODDLER_CONTENT_DEFAULT_PATH };
let buttonTypeCatalog = null;

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

function getTabsForRendering() {
    // Fixed tabs: Remote, Roku Rooms, Lights, Magic Time
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
    document.body.classList.add('has-bottom-tabs');
    nav.classList.remove('hidden');
    buttonsContainer.innerHTML = '';

    const activeTabId = getActiveTabId();

    tabs.forEach(tab => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.tabId = tab.id;
        button.setAttribute('data-tab-active', String(tab.id === activeTabId));
        button.className =
            'flex flex-1 flex-col items-center gap-1 rounded-2xl px-3 py-2 text-xs font-semibold text-indigo-100 transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/40';

        const iconSpan = document.createElement('span');
        iconSpan.className = 'text-2xl leading-none';
        iconSpan.textContent = tab.icon || '';

        const labelSpan = document.createElement('span');
        labelSpan.className = 'text-[0.7rem] sm:text-xs uppercase tracking-wider leading-tight';
        labelSpan.textContent = tab.label;

        button.append(iconSpan, labelSpan);

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

function applyToddlerContent(data) {
    toddlerSpecialButtons = Array.isArray(data?.specialButtons) ? [...data.specialButtons] : [];
    toddlerQuickLaunchItems = Array.isArray(data?.quickLaunch) ? [...data.quickLaunch] : [];
    renderToddlerButtons(toddlerSpecialButtons, toddlerQuickLaunchItems);
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
        { type: 'custom', path: TODDLER_CONTENT_CUSTOM_PATH },
        { type: 'bundled', path: TODDLER_CONTENT_DEFAULT_PATH }
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

    initTabControls();
    initMagicControls();
    updateToddlerContentCacheMeta();
    void loadButtonTypeCatalog();
    initGoveeControls();
    await loadToddlerContent();

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
    applyToddlerContent({ specialButtons: [], quickLaunch: [] });
    showStatus('Could not load kid-mode buttons. Check your config files.', 'error');
}

function renderToddlerButtons(buttons = [], quickLaunch = []) {
    const quickColumn = document.getElementById('toddlerQuickColumn');
    const remoteColumn = document.getElementById('toddlerRemoteColumn');
    if (!quickColumn || !remoteColumn) return;

    quickColumn.innerHTML = '';
    remoteColumn.innerHTML = '';

    const baseButtons = Array.isArray(buttons) ? [...buttons] : [];
    const quickSpecial = baseButtons.filter(btn => (btn.zone || 'quick') === 'quick');
    const quickSpecialWithImages = quickSpecial.filter(btn => btn.thumbnail);
    const quickSpecialNoImages = quickSpecial.filter(btn => !btn.thumbnail);
    const remoteSpecial = baseButtons.filter(btn => btn.zone === 'remote');

    const quickItems = [
        ...(Array.isArray(quickLaunch) ? quickLaunch.map(mapQuickLaunchToToddlerButton) : []),
        ...quickSpecialWithImages,
        ...quickSpecialNoImages
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

    renderRemoteColumn(remoteColumn, remoteSpecial);
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
            args: ['Back'],
            category: 'kidMode-remote',
            zone: 'remote'
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

function startToddlerTimer(durationSeconds = 300, label = 'Timer') {
    const secondsValue = Number(Array.isArray(durationSeconds) ? durationSeconds[0] : durationSeconds);
    const labelValue = Array.isArray(durationSeconds) && durationSeconds.length > 1 ? durationSeconds[1] : label;
    const displayLabel = typeof labelValue === 'string' && labelValue.trim().length > 0 ? labelValue.trim() : 'Timer';

    const overlay = document.getElementById('timerOverlay');
    const labelEl = document.getElementById('timerLabel');
    if (!overlay || !labelEl) {
        console.warn('Timer overlay elements are missing.');
        return;
    }

    const sanitizedSeconds = Number.isFinite(secondsValue) && secondsValue > 0 ? secondsValue : 300;

    cancelToddlerTimer({ silent: true });

    timerDurationMs = sanitizedSeconds * 1000;
    timerEndTimestamp = Date.now() + timerDurationMs;
    timerLabelText = displayLabel || 'Timer';

    labelEl.textContent = `${timerLabelText} — ${formatTimerDuration(sanitizedSeconds)} timer`;
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
    const progressCircle = document.getElementById('timerProgressCircle');
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

    if (progressCircle && timerDurationMs > 0) {
        const progress = Math.min(1, 1 - remainingMs / timerDurationMs);
        const offset = TIMER_CIRCUMFERENCE * (1 - progress);
        progressCircle.style.strokeDashoffset = offset.toString();
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
    const progressCircle = document.getElementById('timerProgressCircle');
    const countdownEl = document.getElementById('timerCountdown');
    if (overlay) {
        overlay.classList.add('hidden');
        overlay.classList.remove('flex');
    }
    if (progressCircle) {
        progressCircle.style.strokeDashoffset = TIMER_CIRCUMFERENCE.toString();
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

function updateGoveeUI() {
    const { ip, port } = getStoredGoveeConfig();
    const ipInput = document.getElementById('goveeIpInput');
    const portInput = document.getElementById('goveePortInput');
    const brightnessInput = document.getElementById('goveeBrightnessSlider');

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

// Check Roku status and load apps
async function checkStatus() {
    const ip = getSavedIp();
    if (!ip) return;

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

// Launch specific YouTube video by ID
async function launchSpecificYouTube(videoId) {
    const ip = getSavedIp();
    if (!ip) return;

    showStatus(`Launching YouTube video ${videoId}...`, 'info');

    try {
        const appId = '837'; // YouTube app ID
        const endpoint = `/launch/${appId}?contentId=${videoId}`;
        console.log('Launching YouTube:', endpoint);

        await rokuPost(ip, endpoint);
        showStatus(`Launched YouTube video!`, 'success');
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

function showSettings() {
    // Show all advanced settings
    const advancedSections = document.querySelectorAll('[data-settings]');
    advancedSections.forEach(section => {
        section.classList.remove('hidden');
    });
    renderQuickLaunchSettings(toddlerQuickLaunchItems);
    updateToddlerContentCacheMeta();
    updateGoveeUI();
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
