/**
 * @fileoverview localStorage abstraction layer with error handling and type safety
 * Provides safe access to browser localStorage with fallback mechanisms
 */

/**
 * Storage utility class for safe localStorage operations
 */
class Storage {
    constructor() {
        this.cache = new Map();
        this.isAvailable = this._checkAvailability();
    }

    /**
     * Check if localStorage is available
     * @private
     * @returns {boolean} True if localStorage is accessible
     */
    _checkAvailability() {
        try {
            const test = '__storage_test__';
            localStorage.setItem(test, test);
            localStorage.removeItem(test);
            return true;
        } catch (e) {
            console.warn('localStorage is not available, using in-memory fallback');
            return false;
        }
    }

    /**
     * Get a value from storage
     * @param {string} key - Storage key
     * @param {*} defaultValue - Default value if key doesn't exist
     * @returns {*} The stored value or default value
     */
    get(key, defaultValue = null) {
        try {
            if (!this.isAvailable) {
                return this.cache.get(key) ?? defaultValue;
            }

            const item = localStorage.getItem(key);
            if (item === null) {
                return defaultValue;
            }

            // Try to parse as JSON, fallback to raw string
            try {
                return JSON.parse(item);
            } catch {
                return item;
            }
        } catch (error) {
            console.error(`Error reading from storage (key: ${key}):`, error);
            return defaultValue;
        }
    }

    /**
     * Set a value in storage
     * @param {string} key - Storage key
     * @param {*} value - Value to store (will be JSON stringified)
     * @returns {boolean} True if successful
     */
    set(key, value) {
        try {
            const serialized = typeof value === 'string' ? value : JSON.stringify(value);

            if (!this.isAvailable) {
                this.cache.set(key, value);
                return true;
            }

            localStorage.setItem(key, serialized);
            return true;
        } catch (error) {
            if (error.name === 'QuotaExceededError') {
                console.error('Storage quota exceeded. Consider clearing old data.');
            } else {
                console.error(`Error writing to storage (key: ${key}):`, error);
            }
            return false;
        }
    }

    /**
     * Remove a value from storage
     * @param {string} key - Storage key
     * @returns {boolean} True if successful
     */
    remove(key) {
        try {
            if (!this.isAvailable) {
                this.cache.delete(key);
                return true;
            }

            localStorage.removeItem(key);
            return true;
        } catch (error) {
            console.error(`Error removing from storage (key: ${key}):`, error);
            return false;
        }
    }

    /**
     * Check if a key exists in storage
     * @param {string} key - Storage key
     * @returns {boolean} True if key exists
     */
    has(key) {
        if (!this.isAvailable) {
            return this.cache.has(key);
        }
        return localStorage.getItem(key) !== null;
    }

    /**
     * Clear all storage
     * @returns {boolean} True if successful
     */
    clear() {
        try {
            if (!this.isAvailable) {
                this.cache.clear();
                return true;
            }

            localStorage.clear();
            return true;
        } catch (error) {
            console.error('Error clearing storage:', error);
            return false;
        }
    }

    /**
     * Get all keys in storage
     * @returns {string[]} Array of storage keys
     */
    keys() {
        if (!this.isAvailable) {
            return Array.from(this.cache.keys());
        }
        return Object.keys(localStorage);
    }

    /**
     * Get storage size estimate in bytes
     * @returns {number} Estimated storage size
     */
    size() {
        if (!this.isAvailable) {
            return 0;
        }

        let total = 0;
        for (let key in localStorage) {
            if (localStorage.hasOwnProperty(key)) {
                total += localStorage[key].length + key.length;
            }
        }
        return total;
    }
}

// Create singleton instance
const storage = new Storage();

// Export both the instance and the class
export { storage, Storage };
export default storage;
