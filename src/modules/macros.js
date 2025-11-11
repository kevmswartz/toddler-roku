/**
 * @fileoverview Macros module - Automation sequences for Roku control
 * Handles macro creation, storage, execution, and UI rendering
 */

import storage from '../utils/storage.js';
import state from '../utils/state.js';
import { handleError, AppError, ErrorType } from '../utils/errors.js';

// Storage key
const STORAGE_KEY = 'roku_macros';

// Common Roku app IDs (for resolving app names in macros)
const COMMON_APPS = [
    { id: '12', name: 'Netflix' },
    { id: '13', name: 'Amazon Prime Video' },
    { id: '2213', name: 'Hulu' },
    { id: '837', name: 'YouTube' },
    { id: '291097', name: 'Disney+' },
    { id: '593099', name: 'Apple TV+' },
    { id: '61322', name: 'HBO Max' },
    { id: '74519', name: 'Peacock TV' },
    { id: '151908', name: 'Plex' },
    { id: '2285', name: 'Spotify' },
    { id: '19977', name: 'Pandora' },
    { id: '50539', name: 'The Roku Channel' },
];

/**
 * Macros Manager - Handles all macro-related operations
 */
class MacrosManager {
    constructor() {
        this.macros = [];
        this.draftSteps = [];
        this.isRunning = false;
        this.callbacks = {
            onStatusUpdate: null,
            onMacrosChanged: null,
            sendKey: null,
            launchApp: null,
            getRokuIp: null,
        };
    }

    /**
     * Set callback functions for external dependencies
     * @param {Object} callbacks - Callback functions
     * @param {Function} callbacks.onStatusUpdate - Function to show status messages
     * @param {Function} callbacks.onMacrosChanged - Function called when macros list changes
     * @param {Function} callbacks.sendKey - Function to send Roku key press
     * @param {Function} callbacks.launchApp - Function to launch Roku app
     * @param {Function} callbacks.getRokuIp - Function to get current Roku IP
     */
    setCallbacks(callbacks) {
        this.callbacks = { ...this.callbacks, ...callbacks };
    }

    /**
     * Initialize macros from storage
     */
    init() {
        try {
            const stored = storage.get(STORAGE_KEY, []);
            this.macros = Array.isArray(stored) ? stored : [];
        } catch (error) {
            console.warn('Failed to load macros:', error);
            this.macros = [];
        }

        this.draftSteps = [];
        return this;
    }

    /**
     * Get all saved macros
     * @returns {Array} List of macros
     */
    getMacros() {
        return [...this.macros];
    }

    /**
     * Get macro by ID
     * @param {string} macroId - Macro ID
     * @returns {Object|null} Macro object or null
     */
    getMacro(macroId) {
        return this.macros.find(m => m.id === macroId) || null;
    }

    /**
     * Get favorite macro
     * @returns {Object|null} Favorite macro or null
     */
    getFavoriteMacro() {
        return this.macros.find(m => m.favorite) || null;
    }

    /**
     * Get draft steps
     * @returns {Array} Current draft steps
     */
    getDraftSteps() {
        return [...this.draftSteps];
    }

    /**
     * Add step to draft
     * @param {Object} step - Macro step
     * @throws {AppError} If step is invalid
     */
    addDraftStep(step) {
        if (!step || !step.type) {
            throw new AppError('Invalid step', ErrorType.VALIDATION);
        }

        this.draftSteps.push(step);
        return this;
    }

    /**
     * Remove step from draft
     * @param {number} index - Step index
     */
    removeDraftStep(index) {
        if (index >= 0 && index < this.draftSteps.length) {
            this.draftSteps.splice(index, 1);
        }
        return this;
    }

    /**
     * Clear draft steps
     */
    clearDraft() {
        this.draftSteps = [];
        return this;
    }

    /**
     * Save a new macro
     * @param {string} name - Macro name
     * @param {boolean} favorite - Whether to mark as favorite
     * @returns {Object} Saved macro
     */
    saveMacro(name, favorite = false) {
        if (!name || !name.trim()) {
            throw new AppError('Macro name is required', ErrorType.VALIDATION);
        }

        if (this.draftSteps.length === 0) {
            throw new AppError('Add at least one step to the macro', ErrorType.VALIDATION);
        }

        const macro = {
            id: `macro-${Date.now()}`,
            name: name.trim(),
            steps: [...this.draftSteps],
            favorite: Boolean(favorite),
        };

        // If marking as favorite, unfavorite all others
        if (macro.favorite) {
            this.macros = this.macros.map(m => ({ ...m, favorite: false }));
        }

        this.macros.push(macro);
        this._persistMacros();

        // Clear draft after saving
        this.clearDraft();

        // Notify listeners
        if (this.callbacks.onMacrosChanged) {
            this.callbacks.onMacrosChanged();
        }

        return macro;
    }

    /**
     * Delete a macro
     * @param {string} macroId - Macro ID
     * @returns {boolean} True if deleted
     */
    deleteMacro(macroId) {
        const initialLength = this.macros.length;
        this.macros = this.macros.filter(m => m.id !== macroId);

        if (this.macros.length < initialLength) {
            this._persistMacros();
            if (this.callbacks.onMacrosChanged) {
                this.callbacks.onMacrosChanged();
            }
            return true;
        }

        return false;
    }

    /**
     * Toggle favorite status of a macro
     * @param {string} macroId - Macro ID
     * @returns {boolean} True if updated
     */
    toggleFavorite(macroId) {
        let updated = false;
        this.macros = this.macros.map(macro => {
            if (macro.id === macroId) {
                updated = true;
                return { ...macro, favorite: !macro.favorite };
            }
            // Unfavorite all others
            return { ...macro, favorite: false };
        });

        if (updated) {
            this._persistMacros();
            if (this.callbacks.onMacrosChanged) {
                this.callbacks.onMacrosChanged();
            }
        }

        return updated;
    }

    /**
     * Execute a macro
     * @param {string} macroId - Macro ID
     * @returns {Promise<void>}
     */
    async runMacro(macroId) {
        if (this.isRunning) {
            throw new AppError('A macro is already running', ErrorType.CONFLICT);
        }

        const macro = this.getMacro(macroId);
        if (!macro) {
            throw new AppError('Macro not found', ErrorType.NOT_FOUND);
        }

        // Check if Roku IP is available
        if (this.callbacks.getRokuIp) {
            const ip = this.callbacks.getRokuIp();
            if (!ip) {
                throw new AppError('Roku IP not configured', ErrorType.VALIDATION);
            }
        }

        this.isRunning = true;

        try {
            if (this.callbacks.onStatusUpdate) {
                this.callbacks.onStatusUpdate(`Running macro "${macro.name}"...`, 'info');
            }

            for (const step of macro.steps) {
                await this._executeStep(step);
            }

            if (this.callbacks.onStatusUpdate) {
                this.callbacks.onStatusUpdate(`Macro "${macro.name}" finished!`, 'success');
            }
        } catch (error) {
            if (this.callbacks.onStatusUpdate) {
                this.callbacks.onStatusUpdate(`Macro stopped: ${error.message}`, 'error');
            }
            throw error;
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * Run the favorite macro
     * @returns {Promise<void>}
     */
    async runFavoriteMacro() {
        const favorite = this.getFavoriteMacro();
        if (!favorite) {
            throw new AppError('No favorite macro set', ErrorType.NOT_FOUND);
        }
        return this.runMacro(favorite.id);
    }

    /**
     * Execute a single macro step
     * @private
     * @param {Object} step - Macro step
     */
    async _executeStep(step) {
        switch (step.type) {
            case 'key':
                if (this.callbacks.sendKey) {
                    await this.callbacks.sendKey(step.key);
                    await this._sleep(300);
                }
                break;

            case 'launch': {
                const label = step.label || this._resolveAppName(step.appId);
                if (this.callbacks.onStatusUpdate) {
                    this.callbacks.onStatusUpdate(`Macro launching ${label}...`, 'info');
                }
                if (this.callbacks.launchApp) {
                    await this.callbacks.launchApp(step.appId, step.params);
                    await this._sleep(1500);
                }
                break;
            }

            case 'delay':
                await this._sleep(step.duration);
                break;

            default:
                console.warn('Unknown macro step type:', step.type);
        }
    }

    /**
     * Describe a macro step in human-readable format
     * @param {Object} step - Macro step
     * @returns {string} Description
     */
    describeStep(step) {
        switch (step.type) {
            case 'key':
                return `Press ${step.key}`;
            case 'launch': {
                const label = step.label || this._resolveAppName(step.appId);
                return `Launch ${label}${step.params ? ` (${step.params})` : ''}`;
            }
            case 'delay': {
                const seconds = step.duration / 1000;
                return `Wait ${seconds.toFixed(seconds % 1 === 0 ? 0 : 1)}s`;
            }
            default:
                return 'Unknown step';
        }
    }

    /**
     * Parse launch value from input string
     * @param {string} rawValue - Input string (format: "appId?params|label")
     * @returns {Object} Parsed launch parameters
     */
    parseLaunchValue(rawValue) {
        const [endpointPart, labelPart] = rawValue.split('|').map(s => s.trim());
        const endpoint = endpointPart || '';
        const label = labelPart || '';

        if (!endpoint) {
            return { appId: '', params: '', label };
        }

        const [appIdPart, paramsPart = ''] = endpoint.split('?');
        return {
            appId: appIdPart.trim(),
            params: paramsPart.trim(),
            label,
        };
    }

    /**
     * Resolve app name from app ID
     * @private
     * @param {string} appId - Roku app ID
     * @returns {string} App name
     */
    _resolveAppName(appId) {
        const match = COMMON_APPS.find(app => app.id === appId);
        return match ? match.name : `App ${appId}`;
    }

    /**
     * Persist macros to storage
     * @private
     */
    _persistMacros() {
        storage.set(STORAGE_KEY, this.macros);
    }

    /**
     * Sleep utility
     * @private
     * @param {number} ms - Milliseconds to sleep
     * @returns {Promise<void>}
     */
    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Export singleton instance
const macrosManager = new MacrosManager();

export default macrosManager;
export { MacrosManager };
