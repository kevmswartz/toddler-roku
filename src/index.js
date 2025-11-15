/**
 * @fileoverview Main entry point for modular Roku Control app
 * Exports all modules for use in the application
 */

// Utilities
import storage, { Storage } from './utils/storage.js';
import state, { StateManager } from './utils/state.js';
import errors, { ErrorType, AppError, handleError, withErrorHandling, retry, withTimeout, assert } from './utils/errors.js';

export {
    storage,
    Storage,
    state,
    StateManager,
    errors,
    ErrorType,
    AppError,
    handleError,
    withErrorHandling,
    retry,
    withTimeout,
    assert
};

// Modules
import rokuAPI, { RokuAPI } from './modules/roku.js';
import goveeAPI, { GoveeAPI } from './modules/govee.js';
import ui, { showToast, showStatus, createElement, getElement, toggleElement, clearElement, domCache, debounce, throttle, loadingManager } from './modules/ui.js';

export {
    rokuAPI,
    RokuAPI,
    goveeAPI,
    GoveeAPI,
    ui,
    showToast,
    showStatus,
    createElement,
    getElement,
    toggleElement,
    clearElement,
    domCache,
    debounce,
    throttle,
    loadingManager
};

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
