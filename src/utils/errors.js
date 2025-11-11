/**
 * @fileoverview Standardized error handling utilities
 * Provides consistent error handling patterns across the application
 */

/**
 * Application error types
 * @enum {string}
 */
export const ErrorType = {
    NETWORK: 'NETWORK',
    STORAGE: 'STORAGE',
    VALIDATION: 'VALIDATION',
    DEVICE: 'DEVICE',
    PERMISSION: 'PERMISSION',
    TIMEOUT: 'TIMEOUT',
    UNKNOWN: 'UNKNOWN'
};

/**
 * Custom application error class
 */
export class AppError extends Error {
    /**
     * @param {string} message - Error message
     * @param {ErrorType} type - Error type
     * @param {Object} context - Additional context
     */
    constructor(message, type = ErrorType.UNKNOWN, context = {}) {
        super(message);
        this.name = 'AppError';
        this.type = type;
        this.context = context;
        this.timestamp = Date.now();
    }

    /**
     * Convert error to user-friendly message
     * @returns {string} User-friendly error message
     */
    toUserMessage() {
        const typeMessages = {
            [ErrorType.NETWORK]: 'Network connection issue',
            [ErrorType.STORAGE]: 'Storage error',
            [ErrorType.VALIDATION]: 'Invalid input',
            [ErrorType.DEVICE]: 'Device communication error',
            [ErrorType.PERMISSION]: 'Permission denied',
            [ErrorType.TIMEOUT]: 'Request timed out',
            [ErrorType.UNKNOWN]: 'An error occurred'
        };

        return `${typeMessages[this.type]}: ${this.message}`;
    }
}

/**
 * Error handler options
 * @typedef {Object} ErrorHandlerOptions
 * @property {boolean} showUser - Show error to user (default: true)
 * @property {boolean} log - Log error to console (default: true)
 * @property {Function} onError - Custom error callback
 * @property {string} fallbackMessage - Fallback error message
 * @property {Function} showStatus - Function to show status to user
 */

/**
 * Handle errors in a consistent way
 * @param {Error} error - The error to handle
 * @param {ErrorHandlerOptions} options - Handler options
 * @returns {AppError} Normalized application error
 */
export function handleError(error, options = {}) {
    const {
        showUser = true,
        log = true,
        onError,
        fallbackMessage = 'An unexpected error occurred',
        showStatus
    } = options;

    // Normalize to AppError
    let appError;
    if (error instanceof AppError) {
        appError = error;
    } else {
        // Determine error type
        let type = ErrorType.UNKNOWN;
        if (error.message?.includes('fetch') || error.message?.includes('network')) {
            type = ErrorType.NETWORK;
        } else if (error.message?.includes('timeout')) {
            type = ErrorType.TIMEOUT;
        } else if (error.name === 'QuotaExceededError') {
            type = ErrorType.STORAGE;
        }

        appError = new AppError(
            error.message || fallbackMessage,
            type,
            { originalError: error }
        );
    }

    // Log if requested
    if (log) {
        console.error('[Error]', appError.type, appError.message, appError.context);
    }

    // Show to user if requested
    if (showUser && showStatus) {
        showStatus(appError.toUserMessage(), 'error');
    }

    // Call custom handler if provided
    if (onError) {
        try {
            onError(appError);
        } catch (callbackError) {
            console.error('Error in error callback:', callbackError);
        }
    }

    return appError;
}

/**
 * Wrap an async function with error handling
 * @param {Function} fn - Async function to wrap
 * @param {ErrorHandlerOptions} options - Handler options
 * @returns {Function} Wrapped function
 */
export function withErrorHandling(fn, options = {}) {
    return async function(...args) {
        try {
            return await fn(...args);
        } catch (error) {
            const handledError = handleError(error, options);
            // Re-throw if no fallback provided
            if (!options.fallbackValue) {
                throw handledError;
            }
            return options.fallbackValue;
        }
    };
}

/**
 * Retry a function with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {Object} options - Retry options
 * @param {number} options.maxRetries - Maximum number of retries (default: 3)
 * @param {number} options.initialDelay - Initial delay in ms (default: 1000)
 * @param {number} options.maxDelay - Maximum delay in ms (default: 10000)
 * @param {Function} options.shouldRetry - Function to determine if should retry
 * @returns {Promise} Result of function
 */
export async function retry(fn, options = {}) {
    const {
        maxRetries = 3,
        initialDelay = 1000,
        maxDelay = 10000,
        shouldRetry = () => true
    } = options;

    let lastError;
    let delay = initialDelay;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;

            // Don't retry if it's the last attempt or shouldRetry returns false
            if (attempt >= maxRetries || !shouldRetry(error, attempt)) {
                throw error;
            }

            // Wait before retrying
            await new Promise(resolve => setTimeout(resolve, delay));

            // Exponential backoff with cap
            delay = Math.min(delay * 2, maxDelay);
        }
    }

    throw lastError;
}

/**
 * Timeout wrapper for promises
 * @param {Promise} promise - Promise to wrap
 * @param {number} ms - Timeout in milliseconds
 * @param {string} message - Timeout error message
 * @returns {Promise} Promise that rejects if timeout is reached
 */
export function withTimeout(promise, ms, message = 'Operation timed out') {
    const timeout = new Promise((_, reject) => {
        setTimeout(() => reject(new AppError(message, ErrorType.TIMEOUT)), ms);
    });

    return Promise.race([promise, timeout]);
}

/**
 * Validate input and throw ValidationError if invalid
 * @param {boolean} condition - Validation condition
 * @param {string} message - Error message if validation fails
 * @throws {AppError} If validation fails
 */
export function assert(condition, message) {
    if (!condition) {
        throw new AppError(message, ErrorType.VALIDATION);
    }
}

// Export default object with all utilities
export default {
    ErrorType,
    AppError,
    handleError,
    withErrorHandling,
    retry,
    withTimeout,
    assert
};
