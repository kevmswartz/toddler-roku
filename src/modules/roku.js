/**
 * @fileoverview Roku device control module
 * Handles all Roku ECP (External Control Protocol) communications
 */

import storage from '../utils/storage.js';
import state from '../utils/state.js';
import { handleError, withTimeout, ErrorType, AppError } from '../utils/errors.js';

// Storage keys
const STORAGE_KEY = 'roku_ip';

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

/**
 * Roku transport layer - handles HTTP communication with Roku devices
 */
class RokuTransport {
    constructor() {
        this.tauriInvoke = this._getTauriInvoke();
        this.isNative = Boolean(this.tauriInvoke);
    }

    /**
     * Get Tauri invoke function if available
     * @private
     */
    _getTauriInvoke() {
        if (typeof window === 'undefined') return undefined;
        const tauriBridge = window.__TAURI__;
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
    }

    /**
     * Build Roku URL
     * @param {string} ip - Roku IP address
     * @param {string} endpoint - API endpoint
     * @returns {string} Complete URL
     */
    buildUrl(ip, endpoint) {
        const trimmed = (ip || '').trim();
        if (!trimmed) {
            throw new AppError('Missing Roku IP address', ErrorType.VALIDATION);
        }

        const protocolMatch = trimmed.match(/^(https?:\/\/)/i);
        const protocol = protocolMatch ? protocolMatch[1].toLowerCase() : 'http://';
        const remainder = protocolMatch ? trimmed.slice(protocolMatch[1].length) : trimmed;

        const [hostPortRaw] = remainder.split('/');
        if (!hostPortRaw) {
            throw new AppError('Invalid Roku address', ErrorType.VALIDATION);
        }

        const hostPort = hostPortRaw.includes(':') ? hostPortRaw : `${hostPortRaw}:8060`;
        const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;

        return `${protocol}${hostPort}${path}`;
    }

    /**
     * Make HTTP request to Roku
     * @param {string} ip - Roku IP address
     * @param {string} endpoint - API endpoint
     * @param {Object} options - Request options
     * @returns {Promise<any>} Response data
     */
    async request(ip, endpoint, { method = 'GET', body, headers = {}, responseType = 'text' } = {}) {
        if (!ip) {
            throw new AppError('Missing Roku IP address', ErrorType.VALIDATION);
        }

        const url = this.buildUrl(ip, endpoint);
        const methodUpper = String(method || 'GET').toUpperCase();

        // Try Tauri native bridge first
        if (this.tauriInvoke) {
            try {
                if (methodUpper === 'GET') {
                    const raw = await this.tauriInvoke('roku_get', { url });
                    return responseType === 'json' ? JSON.parse(raw) : raw;
                } else {
                    const payload = body === undefined || body === null ? '' :
                                  typeof body === 'string' ? body : JSON.stringify(body);
                    await this.tauriInvoke('roku_post', { url, body: payload });
                    return '';
                }
            } catch (error) {
                console.warn('Tauri Roku command failed, falling back:', error);
            }
        }

        // Fallback to web fetch
        try {
            const response = await fetch(url, {
                method,
                headers,
                body: body !== undefined && body !== null ? body : undefined
            });

            if (!response.ok) {
                throw new AppError(`HTTP ${response.status}`, ErrorType.NETWORK);
            }

            return responseType === 'json' ? await response.json() : await response.text();
        } catch (error) {
            if (error instanceof TypeError || error.message?.includes('Failed to fetch')) {
                throw new AppError(
                    'Direct Roku requests blocked by browser CORS. Use Tauri build.',
                    ErrorType.DEVICE
                );
            }
            throw error;
        }
    }

    /**
     * Request XML data from Roku
     * @param {string} ip - Roku IP address
     * @param {string} endpoint - API endpoint
     * @returns {Promise<Document>} Parsed XML document
     */
    async requestXml(ip, endpoint) {
        const xmlText = await this.request(ip, endpoint, { responseType: 'text' });
        const parser = new DOMParser();
        return parser.parseFromString(xmlText, 'text/xml');
    }
}

// Create transport instance
const transport = new RokuTransport();

/**
 * Roku API module
 */
export class RokuAPI {
    /**
     * Get saved Roku IP address
     * @returns {string|null} Saved IP or null
     */
    getSavedIp() {
        return storage.get(STORAGE_KEY, null);
    }

    /**
     * Save Roku IP address
     * @param {string} ip - IP address to save
     */
    saveIp(ip) {
        storage.set(STORAGE_KEY, ip);
        state.set('roku.ip', ip);
        state.set('roku.isConnected', true);
    }

    /**
     * Send key press to Roku
     * @param {string} key - Key name (e.g., 'Home', 'Up', 'Select')
     */
    async sendKey(key) {
        const ip = this.getSavedIp();
        if (!ip) {
            throw new AppError('No Roku IP configured', ErrorType.VALIDATION);
        }

        await withTimeout(
            transport.request(ip, `/keypress/${encodeURIComponent(key)}`, { method: 'POST' }),
            6000,
            'Roku command timed out'
        );
    }

    /**
     * Launch Roku app
     * @param {string} appId - Roku app/channel ID
     * @param {string} contentId - Optional content ID for deep linking
     */
    async launchApp(appId, contentId = null) {
        const ip = this.getSavedIp();
        if (!ip) {
            throw new AppError('No Roku IP configured', ErrorType.VALIDATION);
        }

        let endpoint = `/launch/${encodeURIComponent(appId)}`;
        if (contentId) {
            endpoint += `?contentID=${encodeURIComponent(contentId)}`;
        }

        await withTimeout(
            transport.request(ip, endpoint, { method: 'POST' }),
            6000,
            'App launch timed out'
        );
    }

    /**
     * Get device info
     * @returns {Promise<Document>} Device info XML
     */
    async getDeviceInfo() {
        const ip = this.getSavedIp();
        if (!ip) {
            throw new AppError('No Roku IP configured', ErrorType.VALIDATION);
        }

        return await transport.requestXml(ip, '/query/device-info');
    }

    /**
     * Get installed apps
     * @returns {Promise<Array>} Array of installed apps
     */
    async getApps() {
        const ip = this.getSavedIp();
        if (!ip) {
            return [];
        }

        try {
            const xmlDoc = await transport.requestXml(ip, '/query/apps');
            const apps = [];
            const appElements = xmlDoc.querySelectorAll('app');

            appElements.forEach(app => {
                apps.push({
                    id: app.getAttribute('id'),
                    name: app.textContent,
                    type: app.getAttribute('type'),
                    version: app.getAttribute('version')
                });
            });

            state.set('roku.apps', apps);
            return apps;
        } catch (error) {
            // If apps query fails (403), return common apps as fallback
            console.warn('Apps query blocked, using common apps:', error);
            return COMMON_APPS;
        }
    }

    /**
     * Get currently playing content
     * @returns {Promise<Object|null>} Now playing info
     */
    async getNowPlaying() {
        const ip = this.getSavedIp();
        if (!ip) {
            return null;
        }

        try {
            const xmlDoc = await transport.requestXml(ip, '/query/active-app');
            const app = xmlDoc.querySelector('app');

            if (!app) return null;

            const nowPlaying = {
                appId: app.getAttribute('id'),
                appName: app.textContent
            };

            state.set('roku.nowPlaying', nowPlaying);
            return nowPlaying;
        } catch (error) {
            console.warn('Failed to get now playing:', error);
            return null;
        }
    }

    /**
     * Discover Roku devices on network (requires Tauri)
     * @param {number} timeoutSecs - Discovery timeout in seconds
     * @returns {Promise<Array>} Array of discovered devices
     */
    async discover(timeoutSecs = 5) {
        if (!transport.isNative) {
            throw new AppError('Roku discovery requires native app', ErrorType.PERMISSION);
        }

        const devices = await transport.tauriInvoke('roku_discover', { timeoutSecs });
        return devices || [];
    }

    /**
     * Test connection to Roku
     * @returns {Promise<boolean>} True if connection successful
     */
    async testConnection() {
        try {
            await this.getDeviceInfo();
            state.set('roku.isConnected', true);
            return true;
        } catch (error) {
            state.set('roku.isConnected', false);
            throw error;
        }
    }
}

// Create singleton instance
const rokuAPI = new RokuAPI();

export { transport, COMMON_APPS };
export default rokuAPI;
