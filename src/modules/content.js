/**
 * @fileoverview Content module - Toddler/kid mode content management
 * Handles loading, caching, and managing curated kid-mode buttons and configurations
 */

import storage from '../utils/storage.js';
import state from '../utils/state.js';
import { handleError, AppError, ErrorType } from '../utils/errors.js';

// Storage keys
const PASSPHRASE_KEY = 'toddler_content_passphrase';

// Default paths
const DEFAULT_CUSTOM_PATH = '/config/toddler/custom.json';
const DEFAULT_BUNDLED_PATH = '/config/toddler/default.json';
const DEFAULT_BUTTON_TYPES_PATH = '/config/button-types.json';

// Default API base (can be configured)
let netlifyApiBase = 'https://toddler-phone-control.netlify.app/.netlify/functions/config';

/**
 * Content Manager - Handles all toddler content operations
 */
class ContentManager {
    constructor() {
        this.currentConfig = null;
        this.currentSource = { type: 'unknown' };
        this.buttonTypeCatalog = null;
        this.callbacks = {
            onStatusUpdate: null,
            onContentChanged: null,
            fetchViaRoku: null, // For CORS bypass in native mode
        };
    }

    /**
     * Set callback functions for external dependencies
     * @param {Object} callbacks - Callback functions
     * @param {Function} callbacks.onStatusUpdate - Function to show status messages
     * @param {Function} callbacks.onContentChanged - Function called when content changes
     * @param {Function} callbacks.fetchViaRoku - Function to fetch via Roku bridge (native mode)
     */
    setCallbacks(callbacks) {
        this.callbacks = { ...this.callbacks, ...callbacks };
    }

    /**
     * Configure Netlify API base URL
     * @param {string} baseUrl - Base URL for Netlify API
     */
    setNetlifyApiBase(baseUrl) {
        netlifyApiBase = baseUrl;
    }

    /**
     * Get passphrase from storage
     * @returns {string} Passphrase or empty string
     */
    getPassphrase() {
        return storage.get(PASSPHRASE_KEY, '');
    }

    /**
     * Set passphrase in storage
     * @param {string} passphrase - Passphrase to store
     */
    setPassphrase(passphrase) {
        if (passphrase && passphrase.trim()) {
            storage.set(PASSPHRASE_KEY, passphrase.trim());
        } else {
            storage.remove(PASSPHRASE_KEY);
        }
    }

    /**
     * Validate passphrase format
     * @param {string} passphrase - Passphrase to validate
     * @returns {Object} Validation result { valid: boolean, error?: string }
     */
    validatePassphrase(passphrase) {
        const trimmed = passphrase.trim();
        if (!trimmed) {
            return { valid: false, error: 'Passphrase cannot be empty' };
        }

        const words = trimmed.split(/\s+/);
        if (words.length < 5) {
            return { valid: false, error: `Passphrase must have at least 5 words (found ${words.length})` };
        }

        return { valid: true };
    }

    /**
     * Build cloud configuration URL
     * @param {string} passphrase - Passphrase for authentication
     * @param {string} type - Config type (default: 'app-config')
     * @returns {string|null} Cloud URL or null
     */
    buildCloudUrl(passphrase, type = 'app-config') {
        if (!passphrase) return null;
        const encoded = encodeURIComponent(passphrase);
        const typeParam = encodeURIComponent(type);
        return `${netlifyApiBase}?passphrase=${encoded}&type=${typeParam}`;
    }

    /**
     * Fetch content from URL (with optional native bridge support)
     * @private
     * @param {string} url - URL to fetch
     * @returns {Promise<Object>} Parsed JSON data
     */
    async _fetchFromUrl(url) {
        // Use native bridge if available to bypass CORS
        if (this.callbacks.fetchViaRoku) {
            try {
                const raw = await this.callbacks.fetchViaRoku(url);
                return JSON.parse(raw);
            } catch (error) {
                throw new AppError(`Failed to fetch via native bridge: ${error.message || error}`, ErrorType.NETWORK);
            }
        }

        // Fallback to browser fetch
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) {
            throw new AppError(`HTTP ${response.status}`, ErrorType.NETWORK);
        }
        return await response.json();
    }

    /**
     * Try fetching content from a local path
     * @private
     * @param {string} path - Local path to fetch
     * @returns {Promise<Object|null>} Parsed JSON or null if not found
     */
    async _tryFetchFromPath(path) {
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
                console.warn(`Failed to read config from ${path}:`, error);
            }
            return null;
        }
    }

    /**
     * Load content from local files (custom or bundled)
     * @private
     * @param {string} customPath - Path to custom config
     * @param {string} bundledPath - Path to bundled default config
     * @returns {Promise<Object|null>} { data, source } or null
     */
    async _fetchLocalContent(customPath = DEFAULT_CUSTOM_PATH, bundledPath = DEFAULT_BUNDLED_PATH) {
        const lookupOrder = [
            { type: 'custom', path: customPath },
            { type: 'bundled', path: bundledPath }
        ];

        for (const candidate of lookupOrder) {
            const data = await this._tryFetchFromPath(candidate.path);
            if (data) {
                return { data, source: candidate };
            }
        }

        return null;
    }

    /**
     * Validate content configuration
     * @param {Object} config - Configuration to validate
     * @returns {Object} Validation result { valid: boolean, error?: string }
     */
    validateConfig(config) {
        if (!config) {
            return { valid: false, error: 'Config is null or undefined' };
        }

        if (!config.tabs || !Array.isArray(config.tabs)) {
            return { valid: false, error: 'Config must have a "tabs" array' };
        }

        return { valid: true };
    }

    /**
     * Load content from cloud, local custom, or bundled default
     * Always fetches fresh content (no caching)
     * @param {Object} options - Load options
     * @param {string} options.customPath - Custom config path
     * @param {string} options.bundledPath - Bundled config path
     * @returns {Promise<Object>} Loaded configuration
     */
    async loadContent({ customPath, bundledPath } = {}) {
        const passphrase = this.getPassphrase().trim();

        // Try cloud first if passphrase is configured
        if (passphrase) {
            const cloudUrl = this.buildCloudUrl(passphrase);
            if (cloudUrl) {
                try {
                    const remoteData = await this._fetchFromUrl(cloudUrl);

                    // Validate before applying
                    const validation = this.validateConfig(remoteData);
                    if (!validation.valid) {
                        throw new AppError(`Invalid cloud config: ${validation.error}`, ErrorType.VALIDATION);
                    }

                    this.currentConfig = remoteData;
                    this.currentSource = { type: 'cloud', passphrase: '***' }; // Don't expose passphrase

                    if (this.callbacks.onContentChanged) {
                        this.callbacks.onContentChanged(remoteData, this.currentSource);
                    }

                    if (this.callbacks.onStatusUpdate) {
                        this.callbacks.onStatusUpdate('Kid-mode buttons loaded from cloud.', 'success');
                    }

                    return remoteData;
                } catch (error) {
                    console.error('Failed to fetch cloud content:', error);
                    if (this.callbacks.onStatusUpdate) {
                        this.callbacks.onStatusUpdate('Cloud config failed. Falling back to local config.', 'error');
                    }
                    // Fall through to local loading
                }
            }
        }

        // Load from local files (custom.json or default.json)
        const localContent = await this._fetchLocalContent(customPath, bundledPath);
        if (localContent) {
            // Validate before applying
            const validation = this.validateConfig(localContent.data);
            if (!validation.valid) {
                throw new AppError(`Invalid local config: ${validation.error}`, ErrorType.VALIDATION);
            }

            this.currentConfig = localContent.data;
            this.currentSource = localContent.source;

            if (this.callbacks.onContentChanged) {
                this.callbacks.onContentChanged(localContent.data, localContent.source);
            }

            if (this.callbacks.onStatusUpdate && !passphrase) {
                // No passphrase configured - this is the primary source
                const message = localContent.source.type === 'custom'
                    ? 'Kid-mode buttons loaded from local override.'
                    : 'Kid-mode buttons loaded from bundled defaults.';
                this.callbacks.onStatusUpdate(message, 'info');
            }

            return localContent.data;
        }

        // Complete failure - no content available
        console.error('Failed to load kid-mode buttons from any source.');
        this.currentConfig = { tabs: [] };
        this.currentSource = { type: 'empty' };

        if (this.callbacks.onContentChanged) {
            this.callbacks.onContentChanged(this.currentConfig, this.currentSource);
        }

        if (this.callbacks.onStatusUpdate) {
            this.callbacks.onStatusUpdate('Could not load kid-mode buttons. Check your config files.', 'error');
        }

        return this.currentConfig;
    }

    /**
     * Save configuration to cloud
     * @param {Object} config - Configuration to save
     * @param {string} passphrase - Passphrase for authentication
     * @returns {Promise<Object>} Save result
     */
    async saveToCloud(config, passphrase) {
        if (!passphrase || !passphrase.trim()) {
            throw new AppError('Passphrase is required', ErrorType.VALIDATION);
        }

        // Validate config before saving
        const validation = this.validateConfig(config);
        if (!validation.valid) {
            throw new AppError(validation.error, ErrorType.VALIDATION);
        }

        try {
            if (this.callbacks.onStatusUpdate) {
                this.callbacks.onStatusUpdate('Saving to cloud...', 'info');
            }

            const response = await fetch(netlifyApiBase, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${passphrase}`
                },
                body: JSON.stringify(config)
            });

            const result = await response.json();

            if (!response.ok) {
                throw new AppError(result.error || `HTTP ${response.status}`, ErrorType.NETWORK);
            }

            // Store the saved config
            this.currentConfig = config;

            if (this.callbacks.onStatusUpdate) {
                this.callbacks.onStatusUpdate('Config saved to cloud!', 'success');
            }

            return result;
        } catch (error) {
            console.error('Failed to save config to cloud:', error);
            if (this.callbacks.onStatusUpdate) {
                this.callbacks.onStatusUpdate(`Failed to save: ${error.message}`, 'error');
            }
            throw error;
        }
    }

    /**
     * Save device list to cloud
     * @param {Array} devices - List of devices
     * @param {string} type - Device type ('ble', 'wifi', etc.)
     * @returns {Promise<boolean>} True if saved successfully
     */
    async saveDevicesToCloud(devices, type = 'ble') {
        const passphrase = this.getPassphrase().trim();
        if (!passphrase) {
            console.log('No passphrase set, skipping cloud save for device list');
            return false;
        }

        const endpoint = `${netlifyApiBase}/${type}-devices.json`;

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

    /**
     * Get current loaded configuration
     * @returns {Object|null} Current configuration
     */
    getCurrentConfig() {
        return this.currentConfig;
    }

    /**
     * Get current content source
     * @returns {Object} Source information { type, ... }
     */
    getCurrentSource() {
        return this.currentSource;
    }

    /**
     * Normalize quick launch item (auto-generate missing fields)
     * @param {Object} item - Quick launch item
     * @returns {Object} Normalized item
     */
    normalizeQuickLaunchItem(item) {
        const normalized = { ...item };

        // Auto-generate id if not provided
        if (!normalized.id) {
            if (normalized.type === 'youtube' && normalized.videoId) {
                normalized.id = `yt-${normalized.videoId}`;
            } else {
                // Fallback: generate from label or random
                normalized.id = normalized.label
                    ? `ql-${normalized.label.toLowerCase().replace(/\s+/g, '-')}`
                    : `ql-${Date.now()}`;
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

    /**
     * Load button type catalog (metadata about handler types)
     * @param {string} catalogPath - Path to button types config
     * @returns {Promise<Object|null>} Button type catalog or null
     */
    async loadButtonTypeCatalog(catalogPath = DEFAULT_BUTTON_TYPES_PATH) {
        try {
            const response = await fetch(catalogPath, { cache: 'no-store' });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            this.buttonTypeCatalog = await response.json();
            return this.buttonTypeCatalog;
        } catch (error) {
            console.warn('Failed to load button type catalog:', error);
            return null;
        }
    }

    /**
     * Get button type catalog
     * @returns {Object|null} Button type catalog
     */
    getButtonTypeCatalog() {
        return this.buttonTypeCatalog;
    }
}

// Export singleton instance
const contentManager = new ContentManager();

export default contentManager;
export { ContentManager };
