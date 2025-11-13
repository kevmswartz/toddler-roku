/**
 * @fileoverview Common Roku app IDs and metadata
 * Single source of truth for Roku app catalog
 */

/**
 * Common Roku app IDs
 * Used as fallback when /query/apps is blocked
 *
 * @type {Array<{id: string, name: string}>}
 */
export const COMMON_ROKU_APPS = [
    { id: '12', name: 'Netflix' },
    { id: '13', name: 'Amazon Prime Video' },
    { id: '2213', name: 'Hulu' },
    { id: '837', name: 'YouTube' },
    { id: '291097', name: 'Disney+' },        // Correct ID for Disney+
    { id: '593099', name: 'Apple TV+' },
    { id: '61322', name: 'HBO Max' },
    { id: '74519', name: 'Peacock TV' },
    { id: '151908', name: 'Plex' },
    { id: '2285', name: 'Spotify' },
    { id: '19977', name: 'Pandora' },
    { id: '50539', name: 'The Roku Channel' },
];

/**
 * Get app name by ID
 * @param {string} appId - Roku app ID
 * @returns {string|null} App name or null if not found
 */
export function getAppNameById(appId) {
    const app = COMMON_ROKU_APPS.find(app => app.id === appId);
    return app ? app.name : null;
}

/**
 * Get app ID by name (case-insensitive)
 * @param {string} appName - App name to search for
 * @returns {string|null} App ID or null if not found
 */
export function getAppIdByName(appName) {
    const normalizedName = appName.toLowerCase();
    const app = COMMON_ROKU_APPS.find(
        app => app.name.toLowerCase() === normalizedName
    );
    return app ? app.id : null;
}

export default COMMON_ROKU_APPS;
