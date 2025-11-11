/**
 * @fileoverview UI utilities and DOM helpers
 * Centralizes all UI-related operations
 */

// Status message variants
const STATUS_VARIANTS = {
    info: { icon: 'ℹ️', classes: 'bg-white/20 text-white' },
    success: { icon: '✅', classes: 'bg-emerald-400/20 text-emerald-50 border border-emerald-200/40' },
    error: { icon: '⚠️', classes: 'bg-rose-500/20 text-rose-50 border border-rose-200/40' }
};

let toastTimer = null;

/**
 * Show toast notification
 * @param {string} message - Message to display
 * @param {string} type - Message type (info, success, error)
 * @param {number} duration - Duration in ms
 */
export function showToast(message, type = 'info', duration = 3200) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    container.innerHTML = '';

    const variant = STATUS_VARIANTS[type] || STATUS_VARIANTS.info;
    const toast = document.createElement('div');
    toast.className = `pointer-events-auto flex items-center gap-3 rounded-2xl px-5 py-3 text-sm font-semibold shadow-2xl backdrop-blur ${variant.classes}`;

    const iconSpan = document.createElement('span');
    iconSpan.className = 'text-base';
    iconSpan.textContent = variant.icon;

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

/**
 * Show status message (legacy compatibility)
 * @param {string} message - Message to display
 * @param {string} type - Message type
 */
export function showStatus(message, type = 'info') {
    showToast(message, type);
}

/**
 * Create element helper
 * @param {string} tag - HTML tag name
 * @param {Object} props - Element properties
 * @param {Array|string} children - Child elements or text
 * @returns {HTMLElement} Created element
 */
export function createElement(tag, props = {}, children = []) {
    const element = document.createElement(tag);

    // Set properties
    Object.entries(props).forEach(([key, value]) => {
        if (key === 'className') {
            element.className = value;
        } else if (key === 'style' && typeof value === 'object') {
            Object.assign(element.style, value);
        } else if (key.startsWith('on') && typeof value === 'function') {
            const event = key.slice(2).toLowerCase();
            element.addEventListener(event, value);
        } else if (key === 'dataset' && typeof value === 'object') {
            Object.assign(element.dataset, value);
        } else {
            element.setAttribute(key, value);
        }
    });

    // Add children
    const childArray = Array.isArray(children) ? children : [children];
    childArray.forEach(child => {
        if (typeof child === 'string') {
            element.appendChild(document.createTextNode(child));
        } else if (child instanceof HTMLElement) {
            element.appendChild(child);
        }
    });

    return element;
}

/**
 * Get element by ID with error handling
 * @param {string} id - Element ID
 * @param {boolean} required - Whether element is required
 * @returns {HTMLElement|null} Element or null
 */
export function getElement(id, required = false) {
    const element = document.getElementById(id);
    if (!element && required) {
        console.error(`Required element not found: ${id}`);
    }
    return element;
}

/**
 * Toggle element visibility
 * @param {string|HTMLElement} elementOrId - Element or ID
 * @param {boolean} show - Whether to show element
 */
export function toggleElement(elementOrId, show) {
    const element = typeof elementOrId === 'string' ? getElement(elementOrId) : elementOrId;
    if (!element) return;

    if (show) {
        element.classList.remove('hidden');
    } else {
        element.classList.add('hidden');
    }
}

/**
 * Clear element contents
 * @param {string|HTMLElement} elementOrId - Element or ID
 */
export function clearElement(elementOrId) {
    const element = typeof elementOrId === 'string' ? getElement(elementOrId) : elementOrId;
    if (element) {
        element.innerHTML = '';
    }
}

/**
 * DOM query cache to reduce repeated queries
 */
class DOMCache {
    constructor() {
        this.cache = new Map();
    }

    get(id) {
        if (!this.cache.has(id)) {
            this.cache.set(id, document.getElementById(id));
        }
        return this.cache.get(id);
    }

    clear() {
        this.cache.clear();
    }

    invalidate(id) {
        this.cache.delete(id);
    }
}

export const domCache = new DOMCache();

/**
 * Debounce function calls
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in ms
 * @returns {Function} Debounced function
 */
export function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Throttle function calls
 * @param {Function} func - Function to throttle
 * @param {number} limit - Time limit in ms
 * @returns {Function} Throttled function
 */
export function throttle(func, limit) {
    let inThrottle;
    return function(...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

/**
 * Loading state manager
 */
export class LoadingManager {
    constructor() {
        this.loading = new Set();
    }

    start(key) {
        this.loading.add(key);
        this._updateUI();
    }

    stop(key) {
        this.loading.delete(key);
        this._updateUI();
    }

    isLoading(key) {
        return this.loading.has(key);
    }

    _updateUI() {
        // Update global loading indicator if present
        const indicator = getElement('loadingIndicator');
        if (indicator) {
            toggleElement(indicator, this.loading.size > 0);
        }
    }
}

export const loadingManager = new LoadingManager();

// Export all utilities as default object
export default {
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
