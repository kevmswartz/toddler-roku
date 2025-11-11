/**
 * @fileoverview Govee smart light control module
 * Handles both LAN and Cloud API communications with deduplication
 */

import storage from '../utils/storage.js';
import state from '../utils/state.js';
import { handleError, withTimeout, ErrorType, AppError } from '../utils/errors.js';

// Storage keys
const GOVEE_IP_KEY = 'govee_ip';
const GOVEE_PORT_KEY = 'govee_port';
const GOVEE_BRIGHTNESS_KEY = 'govee_brightness';
const GOVEE_API_KEY_KEY = 'govee_api_key';
const GOVEE_POWER_STATE_PREFIX = 'govee_power_state_';

const GOVEE_DEFAULT_PORT = 4003;
const GOVEE_MIN_BRIGHTNESS = 1;

/**
 * Parse Govee overrides from various input formats
 * @param {*} ipOrOptions - IP address, options object, or null
 * @param {number} portArg - Optional port
 * @returns {Object} Normalized overrides
 */
function parseGoveeOverrides(ipOrOptions, portArg) {
    const overrides = {};

    if (typeof ipOrOptions === 'string') {
        overrides.ip = ipOrOptions;
        if (portArg) overrides.port = portArg;
    } else if (typeof ipOrOptions === 'object' && ipOrOptions !== null) {
        if (ipOrOptions.ip) overrides.ip = ipOrOptions.ip;
        if (ipOrOptions.host) overrides.ip = ipOrOptions.host;
        if (ipOrOptions.port) overrides.port = ipOrOptions.port;
        if (ipOrOptions.device) overrides.device = ipOrOptions.device;
        if (ipOrOptions.model) overrides.model = ipOrOptions.model;
    }

    return overrides;
}

/**
 * Govee LAN control module
 */
class GoveeLAN {
    constructor() {
        this.bridge = this._initBridge();
    }

    /**
     * Initialize Tauri bridge for Govee LAN
     * @private
     */
    _initBridge() {
        if (typeof window === 'undefined') return undefined;

        const tauriBridge = window.__TAURI__;
        const tauriInvoke = tauriBridge?.invoke || tauriBridge?.core?.invoke;

        if (!tauriInvoke || window.goveeLan) {
            return window.goveeLan;
        }

        // Create bridge if Tauri is available
        window.goveeLan = {
            send: async ({ host, port, body }) => {
                await tauriInvoke('govee_send', { host, port, body: body ?? '' });
                return { host, port };
            },
            discover: async (options = {}) => {
                return tauriInvoke('govee_discover', options);
            }
        };

        return window.goveeLan;
    }

    /**
     * Get target device (IP/port)
     * @param {Object} overrides - Override settings
     * @returns {Object} Target device
     */
    getTarget(overrides = {}) {
        return {
            host: overrides.ip || storage.get(GOVEE_IP_KEY, '192.168.1.100'),
            port: overrides.port || storage.get(GOVEE_PORT_KEY, GOVEE_DEFAULT_PORT)
        };
    }

    /**
     * Send command to Govee device
     * @param {Object} command - Command object with cmd and data
     * @param {Object} overrides - Override settings
     * @returns {Promise<Object>} Result with target info
     */
    async sendCommand(command, overrides = {}) {
        if (!this.bridge) {
            throw new AppError('Govee LAN bridge not available', ErrorType.DEVICE);
        }

        const target = this.getTarget(overrides);
        const body = JSON.stringify({ msg: command });

        await this.bridge.send({
            host: target.host,
            port: target.port,
            body
        });

        return { target };
    }

    /**
     * Discover Govee devices on network
     * @param {number} timeoutMs - Discovery timeout
     * @returns {Promise<Array>} Discovered devices
     */
    async discover(timeoutMs = 3000) {
        if (!this.bridge?.discover) {
            throw new AppError('Govee discovery not available', ErrorType.DEVICE);
        }

        return await this.bridge.discover({ timeoutMs });
    }

    /**
     * Save device settings
     * @param {string} ip - Device IP
     * @param {number} port - Device port
     */
    saveSettings(ip, port = GOVEE_DEFAULT_PORT) {
        storage.set(GOVEE_IP_KEY, ip);
        storage.set(GOVEE_PORT_KEY, port);
        state.set('govee.ip', ip);
        state.set('govee.port', port);
    }

    /**
     * Get/set power state for device
     */
    getPowerState(target) {
        const key = `${GOVEE_POWER_STATE_PREFIX}${target.host}`;
        return storage.get(key, null);
    }

    setPowerState(target, state) {
        const key = `${GOVEE_POWER_STATE_PREFIX}${target.host}`;
        storage.set(key, state);
    }

    /**
     * Get/set brightness
     */
    getBrightness() {
        return storage.get(GOVEE_BRIGHTNESS_KEY, 50);
    }

    setBrightness(value) {
        const normalized = Math.max(GOVEE_MIN_BRIGHTNESS, Math.min(100, Math.round(value)));
        storage.set(GOVEE_BRIGHTNESS_KEY, normalized);
        state.set('govee.brightness', normalized);
        return normalized;
    }
}

/**
 * Higher-order function to create Govee command functions
 * Eliminates duplication across 12+ similar functions
 * @param {string} cmd - Govee command name
 * @param {Function} dataBuilder - Function to build command data
 * @param {Object} options - Additional options
 * @returns {Function} Command function
 */
function createGoveeCommand(cmd, dataBuilder, options = {}) {
    return async function(...args) {
        let overrides = {};
        let value = args[0];

        // Handle array format: [value, ip, port]
        if (Array.isArray(args[0])) {
            overrides = parseGoveeOverrides(args[0][1], args[0][2]);
            value = args[0][0];
        }
        // Handle object format
        else if (typeof args[0] === 'object' && args[0] !== null && !options.skipObjectParse) {
            overrides = parseGoveeOverrides(args[0]);
            value = args[0].value ?? args[0][options.valueKey || 'value'] ?? value;
        }

        // Parse additional override arguments
        overrides = { ...overrides, ...parseGoveeOverrides(args[1], args[2]) };

        // Build command data
        const data = dataBuilder(value, overrides);

        try {
            const lan = new GoveeLAN();
            const result = await lan.sendCommand({ cmd, data }, overrides);

            // Call success callback if provided
            if (options.onSuccess) {
                options.onSuccess(result, value, overrides);
            }

            return result;
        } catch (error) {
            // Call error callback if provided
            if (options.onError) {
                options.onError(error, value, overrides);
            }
            throw error;
        }
    };
}

/**
 * Govee API - Provides convenient access to all Govee functions
 */
export class GoveeAPI {
    constructor() {
        this.lan = new GoveeLAN();
    }

    /**
     * Control power - DEDUPLICATED using higher-order function
     */
    power = createGoveeCommand(
        'turn',
        (turnOn) => ({ value: turnOn ? 1 : 0 }),
        {
            onSuccess: (result, value) => {
                this.lan.setPowerState(result.target, value);
            }
        }
    );

    /**
     * Set brightness - DEDUPLICATED
     */
    setBrightness = createGoveeCommand(
        'brightness',
        (value) => {
            const normalized = this.lan.setBrightness(value);
            return { value: normalized };
        }
    );

    /**
     * Set color - DEDUPLICATED
     */
    setColor = createGoveeCommand(
        'color',
        (r, g, b) => {
            // Handle RGB object or separate values
            if (typeof r === 'object' && r !== null) {
                return {
                    r: Math.max(0, Math.min(255, Math.round(r.r ?? r.red ?? 255))),
                    g: Math.max(0, Math.min(255, Math.round(r.g ?? r.green ?? 255))),
                    b: Math.max(0, Math.min(255, Math.round(r.b ?? r.blue ?? 255)))
                };
            }
            return {
                r: Math.max(0, Math.min(255, Math.round(r))),
                g: Math.max(0, Math.min(255, Math.round(g ?? 0))),
                b: Math.max(0, Math.min(255, Math.round(b ?? 0)))
            };
        },
        { skipObjectParse: true }
    );

    /**
     * Toggle power
     * @param {Object} overrides - Device overrides
     */
    async togglePower(overrides = {}) {
        const target = this.lan.getTarget(overrides);
        const currentState = this.lan.getPowerState(target);
        return await this.power(!currentState, overrides);
    }

    /**
     * Preset colors - DEDUPLICATED
     */
    setWarmWhite = (overrides) => this.setColor(255, 230, 200, overrides);
    setOceanBlue = (overrides) => this.setColor(120, 180, 255, overrides);
    setSunsetGlow = (overrides) => this.setColor(255, 140, 90, overrides);

    /**
     * Multi-device control - Apply command to multiple devices
     * @param {Function} commandFn - Command function to apply
     * @param {Array} devices - Array of device configs
     * @param {...any} args - Command arguments
     */
    async multiCommand(commandFn, devices, ...args) {
        if (!Array.isArray(devices) || devices.length === 0) {
            throw new AppError('No devices specified', ErrorType.VALIDATION);
        }

        const results = await Promise.allSettled(
            devices.map(device => commandFn.call(this, ...args, device))
        );

        const successes = results.filter(r => r.status === 'fulfilled');
        const failures = results.filter(r => r.status === 'rejected');

        return {
            successes: successes.length,
            failures: failures.length,
            results
        };
    }

    /**
     * Multi-device power control
     */
    multiPower = (turnOn, devices) => this.multiCommand(this.power, devices, turnOn);
    multiToggle = (devices) => this.multiCommand(this.togglePower, devices);
    multiBrightness = (value, devices) => this.multiCommand(this.setBrightness, devices, value);
    multiColor = (r, g, b, devices) => this.multiCommand(this.setColor, devices, r, g, b);

    /**
     * Discover devices
     */
    async discover(timeoutMs = 3000) {
        return await this.lan.discover(timeoutMs);
    }

    /**
     * Save settings
     */
    saveSettings(ip, port) {
        this.lan.saveSettings(ip, port);
    }

    /**
     * Get settings
     */
    getSettings() {
        return {
            ip: storage.get(GOVEE_IP_KEY),
            port: storage.get(GOVEE_PORT_KEY, GOVEE_DEFAULT_PORT),
            brightness: this.lan.getBrightness(),
            apiKey: storage.get(GOVEE_API_KEY_KEY)
        };
    }
}

// Create singleton instance
const goveeAPI = new GoveeAPI();

export { GoveeLAN, createGoveeCommand };
export default goveeAPI;
