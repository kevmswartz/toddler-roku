/**
 * @fileoverview Centralized state management for the application
 * Provides a single source of truth for application state with reactive updates
 */

/**
 * Application state manager with reactive updates
 */
class StateManager {
    constructor() {
        this._state = {
            // Roku state
            roku: {
                ip: null,
                apps: [],
                installedAppMap: new Map(),
                nowPlaying: null,
                isConnected: false
            },

            // Govee state
            govee: {
                ip: null,
                port: 4003,
                brightness: 50,
                devices: [],
                cloudDevices: [],
                apiKey: null,
                powerStates: new Map()
            },

            // Content state
            content: {
                buttons: [],
                quickLaunch: [],
                source: null,
                passphrase: null
            },

            // Macros state
            macros: {
                list: [],
                draft: [],
                recording: false,
                favorite: null
            },

            // Rooms/BLE state
            rooms: {
                config: null,
                current: null,
                rssiHistory: new Map(),
                scanning: false
            },

            // UI state
            ui: {
                activeTab: 'remote',
                settingsUnlocked: false,
                isLoading: false,
                statusMessage: null
            },

            // Timer/Magic state
            magic: {
                timerActive: false,
                timerDuration: 0,
                timerEmoji: '⏱️',
                speaking: false
            }
        };

        this._subscribers = new Map();
        this._history = [];
        this._maxHistory = 10;
    }

    /**
     * Get a value from state
     * @param {string} path - Dot-notation path (e.g., 'roku.ip')
     * @returns {*} The state value
     */
    get(path) {
        const keys = path.split('.');
        let value = this._state;

        for (const key of keys) {
            if (value === null || value === undefined) {
                return undefined;
            }
            value = value[key];
        }

        return value;
    }

    /**
     * Set a value in state
     * @param {string} path - Dot-notation path (e.g., 'roku.ip')
     * @param {*} value - Value to set
     * @param {boolean} notify - Whether to notify subscribers (default: true)
     */
    set(path, value, notify = true) {
        const keys = path.split('.');
        const lastKey = keys.pop();
        let target = this._state;

        // Navigate to the target object
        for (const key of keys) {
            if (!(key in target)) {
                target[key] = {};
            }
            target = target[key];
        }

        // Store old value for history
        const oldValue = target[lastKey];

        // Set new value
        target[lastKey] = value;

        // Add to history
        this._addToHistory(path, oldValue, value);

        // Notify subscribers
        if (notify) {
            this._notify(path, value, oldValue);
        }
    }

    /**
     * Update multiple state values at once
     * @param {Object} updates - Object with path:value pairs
     */
    update(updates) {
        for (const [path, value] of Object.entries(updates)) {
            this.set(path, value, false);
        }
        // Notify once after all updates
        this._notify('*', this._state, null);
    }

    /**
     * Subscribe to state changes
     * @param {string} path - Path to watch (use '*' for all changes)
     * @param {Function} callback - Callback function(newValue, oldValue, path)
     * @returns {Function} Unsubscribe function
     */
    subscribe(path, callback) {
        if (!this._subscribers.has(path)) {
            this._subscribers.set(path, new Set());
        }

        this._subscribers.get(path).add(callback);

        // Return unsubscribe function
        return () => {
            const subscribers = this._subscribers.get(path);
            if (subscribers) {
                subscribers.delete(callback);
                if (subscribers.size === 0) {
                    this._subscribers.delete(path);
                }
            }
        };
    }

    /**
     * Get the entire state tree
     * @returns {Object} Deep copy of state
     */
    getState() {
        return JSON.parse(JSON.stringify(this._state));
    }

    /**
     * Reset state to initial values
     */
    reset() {
        const oldState = this._state;
        this._state = this.constructor.prototype._state;
        this._notify('*', this._state, oldState);
    }

    /**
     * Get state change history
     * @returns {Array} Array of state changes
     */
    getHistory() {
        return [...this._history];
    }

    /**
     * Notify subscribers of state changes
     * @private
     * @param {string} path - Changed path
     * @param {*} newValue - New value
     * @param {*} oldValue - Old value
     */
    _notify(path, newValue, oldValue) {
        // Notify specific path subscribers
        const pathSubscribers = this._subscribers.get(path);
        if (pathSubscribers) {
            pathSubscribers.forEach(callback => {
                try {
                    callback(newValue, oldValue, path);
                } catch (error) {
                    console.error(`Error in state subscriber (path: ${path}):`, error);
                }
            });
        }

        // Notify wildcard subscribers
        const wildcardSubscribers = this._subscribers.get('*');
        if (wildcardSubscribers && path !== '*') {
            wildcardSubscribers.forEach(callback => {
                try {
                    callback(newValue, oldValue, path);
                } catch (error) {
                    console.error('Error in wildcard state subscriber:', error);
                }
            });
        }
    }

    /**
     * Add change to history
     * @private
     * @param {string} path - Changed path
     * @param {*} oldValue - Old value
     * @param {*} newValue - New value
     */
    _addToHistory(path, oldValue, newValue) {
        this._history.push({
            timestamp: Date.now(),
            path,
            oldValue,
            newValue
        });

        // Keep history size manageable
        if (this._history.length > this._maxHistory) {
            this._history.shift();
        }
    }
}

// Create singleton instance
const state = new StateManager();

// Export both the instance and the class
export { state, StateManager };
export default state;
