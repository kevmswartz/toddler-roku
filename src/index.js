/**
 * @fileoverview Main entry point for modular Roku Control app
 * Exports all modules for use in the application
 */

// Utilities
export { default as storage, Storage } from './utils/storage.js';
export { default as state, StateManager } from './utils/state.js';
export { default as errors, ErrorType, AppError, handleError, withErrorHandling, retry, withTimeout, assert } from './utils/errors.js';

// Modules
export { default as rokuAPI, RokuAPI } from './modules/roku.js';
export { default as goveeAPI, GoveeAPI } from './modules/govee.js';
export { default as ui, showToast, showStatus, createElement, getElement, toggleElement, clearElement, domCache, debounce, throttle, loadingManager } from './modules/ui.js';

// Re-export for global window access (backwards compatibility)
if (typeof window !== 'undefined') {
    window.RokuControl = {
        storage,
        state,
        errors,
        rokuAPI,
        goveeAPI,
        ui
    };
}
