/**
 * @fileoverview Rooms module - BLE-based room detection and management
 * Handles room configuration, Bluetooth scanning, RSSI-based detection, and room switching
 */

import storage from '../utils/storage.js';
import state from '../utils/state.js';
import { handleError, AppError, ErrorType } from '../utils/errors.js';

// Storage keys
const ROOM_CONFIG_KEY = 'room_config';
const CURRENT_ROOM_KEY = 'current_room';

/**
 * Rooms Manager - Handles all room-related operations
 */
class RoomsManager {
    constructor() {
        this.config = null;
        this.currentRoom = null;
        this.detectionInterval = null;
        this.rssiHistory = {};
        this.callbacks = {
            onStatusUpdate: null,
            onRoomChanged: null,
            scanBLE: null,
            buildCloudUrl: null,
            getPassphrase: null,
        };
    }

    /**
     * Set callback functions for external dependencies
     * @param {Object} callbacks - Callback functions
     * @param {Function} callbacks.onStatusUpdate - Function to show status messages
     * @param {Function} callbacks.onRoomChanged - Function called when room changes
     * @param {Function} callbacks.scanBLE - Function to scan for BLE devices
     * @param {Function} callbacks.buildCloudUrl - Function to build cloud config URL
     * @param {Function} callbacks.getPassphrase - Function to get content passphrase
     */
    setCallbacks(callbacks) {
        this.callbacks = { ...this.callbacks, ...callbacks };
    }

    /**
     * Load room configuration from cloud, localStorage, or default file
     * @returns {Promise<Object>} Room configuration
     */
    async loadConfig() {
        try {
            // Try cloud first if passphrase is configured
            if (this.callbacks.getPassphrase && this.callbacks.buildCloudUrl) {
                const passphrase = this.callbacks.getPassphrase()?.trim();
                if (passphrase) {
                    const cloudUrl = this.callbacks.buildCloudUrl(passphrase, 'rooms');
                    if (cloudUrl) {
                        try {
                            const response = await fetch(cloudUrl, { cache: 'no-store' });
                            if (response.ok) {
                                this.config = await response.json();
                                console.log('📍 Loaded room config from cloud');
                                return this.config;
                            }
                        } catch (error) {
                            console.warn('Failed to load room config from cloud:', error);
                        }
                    }
                }
            }

            // Try localStorage
            const stored = storage.get(ROOM_CONFIG_KEY, null);
            if (stored) {
                this.config = stored;
                console.log('📍 Loaded room config from localStorage');
                return this.config;
            }

            // Fallback to default file
            const response = await fetch('/config/rooms.json', { cache: 'no-store' });
            if (!response.ok) {
                throw new Error(`Failed to load rooms.json: ${response.status}`);
            }

            this.config = await response.json();
            console.log('📍 Loaded default room config from file');
            return this.config;
        } catch (error) {
            console.error('Failed to load room config:', error);
            // Return minimal default
            this.config = {
                rooms: [],
                settings: {
                    autoDetect: false,
                    scanInterval: 10000,
                    rssiSampleSize: 3,
                    detectionMode: 'manual',
                    fallbackRoom: null
                }
            };
            return this.config;
        }
    }

    /**
     * Save room configuration to localStorage
     * @param {Object} config - Room configuration
     */
    saveConfig(config) {
        try {
            storage.set(ROOM_CONFIG_KEY, config);
            this.config = config;
            console.log('💾 Room config saved');
        } catch (error) {
            console.error('Failed to save room config:', error);
            throw new AppError('Failed to save room config', ErrorType.STORAGE);
        }
    }

    /**
     * Get current room configuration
     * @returns {Object|null} Room configuration
     */
    getConfig() {
        return this.config;
    }

    /**
     * Get current room ID
     * @returns {string|null} Current room ID
     */
    getCurrentRoom() {
        if (this.currentRoom) {
            return this.currentRoom;
        }

        const stored = storage.get(CURRENT_ROOM_KEY, null);
        if (stored) {
            this.currentRoom = stored;
        }

        return this.currentRoom;
    }

    /**
     * Set current room
     * @param {string} roomId - Room ID
     * @param {string} source - Source of change ('manual' or 'auto')
     */
    setCurrentRoom(roomId, source = 'manual') {
        this.currentRoom = roomId;
        storage.set(CURRENT_ROOM_KEY, roomId);

        console.log(`📍 Room changed to: ${roomId} (source: ${source})`);

        // Notify callback
        if (this.callbacks.onRoomChanged) {
            this.callbacks.onRoomChanged(roomId, source);
        }

        // Dispatch custom event for other components
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('roomChanged', {
                detail: { roomId, source }
            }));
        }
    }

    /**
     * Get room data by ID
     * @param {string} roomId - Room ID
     * @returns {Object|null} Room data
     */
    getRoom(roomId) {
        if (!this.config || !this.config.rooms) {
            return null;
        }
        return this.config.rooms.find(r => r.id === roomId) || null;
    }

    /**
     * Detect room from scanned BLE devices using RSSI
     * @param {Array} scannedDevices - List of scanned BLE devices
     * @returns {string|null} Detected room ID or null
     */
    detectRoomFromRSSI(scannedDevices) {
        if (!this.config || !this.config.rooms || this.config.rooms.length === 0) {
            console.log('📍 No room config available');
            return null;
        }

        if (!scannedDevices || scannedDevices.length === 0) {
            console.log('📍 No devices scanned');
            return null;
        }

        const mode = this.config.settings?.detectionMode || 'strongest_signal';

        if (mode === 'manual') {
            return null; // Don't auto-detect in manual mode
        }

        // Build RSSI map by device address
        const rssiMap = {};
        scannedDevices.forEach(device => {
            if (device.address && device.rssi !== null && device.rssi !== undefined) {
                rssiMap[device.address.toLowerCase()] = device.rssi;
            }
        });

        // Calculate room scores
        const roomScores = [];

        this.config.rooms.forEach(room => {
            if (!room.beacons || room.beacons.length === 0) {
                return; // Skip rooms with no beacons
            }

            let totalScore = 0;
            let matchedBeacons = 0;

            room.beacons.forEach(beacon => {
                const beaconAddr = beacon.address.toLowerCase();
                const rssi = rssiMap[beaconAddr];

                if (rssi !== undefined) {
                    const threshold = beacon.rssiThreshold || -70;

                    if (rssi >= threshold) {
                        // Stronger signal = higher score
                        // RSSI is negative, so -50 is better than -70
                        const score = 100 + rssi; // Convert to positive score
                        totalScore += score;
                        matchedBeacons++;
                    }
                }
            });

            if (matchedBeacons > 0) {
                const averageScore = totalScore / matchedBeacons;
                roomScores.push({
                    roomId: room.id,
                    score: averageScore,
                    matchedBeacons: matchedBeacons
                });
            }
        });

        if (roomScores.length === 0) {
            console.log('📍 No rooms matched');
            return this.config.settings?.fallbackRoom || null;
        }

        // Sort by score (highest first)
        roomScores.sort((a, b) => b.score - a.score);

        const detectedRoom = roomScores[0];
        console.log(`📍 Detected room: ${detectedRoom.roomId} (score: ${detectedRoom.score.toFixed(1)}, beacons: ${detectedRoom.matchedBeacons})`);

        return detectedRoom.roomId;
    }

    /**
     * Perform room detection scan
     * @returns {Promise<void>}
     */
    async performDetection() {
        if (!this.config?.settings?.autoDetect) {
            return;
        }

        if (!this.callbacks.scanBLE) {
            console.warn('📍 BLE scan callback not configured');
            return;
        }

        try {
            const timeout = this.config.settings.scanInterval || 5000;
            const devices = await this.callbacks.scanBLE(timeout);

            if (!devices || devices.length === 0) {
                console.log('📍 No devices found during scan');
                return;
            }

            console.log(`📍 Scanned ${devices.length} nearby BLE devices`);

            const detectedRoomId = this.detectRoomFromRSSI(devices);

            if (detectedRoomId && detectedRoomId !== this.currentRoom) {
                this.setCurrentRoom(detectedRoomId, 'auto');
            }
        } catch (error) {
            console.error('Room detection scan failed:', error);
        }
    }

    /**
     * Start automatic room detection
     */
    startAutoDetection() {
        if (this.detectionInterval) {
            this.stopAutoDetection();
        }

        if (!this.config?.settings?.autoDetect) {
            console.log('📍 Auto room detection is disabled');
            return;
        }

        const interval = this.config.settings.scanInterval || 10000;

        console.log(`📍 Starting room detection (scan every ${interval}ms)`);

        // Perform immediate scan
        this.performDetection();

        // Set up periodic scanning
        this.detectionInterval = setInterval(() => {
            this.performDetection();
        }, interval);
    }

    /**
     * Stop automatic room detection
     */
    stopAutoDetection() {
        if (this.detectionInterval) {
            clearInterval(this.detectionInterval);
            this.detectionInterval = null;
            console.log('📍 Room detection stopped');
        }
    }

    /**
     * Toggle auto-detect setting
     * @returns {Promise<boolean>} New auto-detect state
     */
    async toggleAutoDetect() {
        if (!this.config) {
            throw new AppError('No room configuration loaded', ErrorType.NOT_FOUND);
        }

        // Toggle the setting
        const newState = !this.config.settings.autoDetect;
        this.config.settings.autoDetect = newState;
        this.saveConfig(this.config);

        // Start or stop detection based on new state
        if (newState) {
            this.startAutoDetection();
            if (this.callbacks.onStatusUpdate) {
                this.callbacks.onStatusUpdate('🔍 Auto room detection enabled', 'success');
            }
        } else {
            this.stopAutoDetection();
            if (this.callbacks.onStatusUpdate) {
                this.callbacks.onStatusUpdate('🔍 Auto room detection disabled', 'success');
            }
        }

        return newState;
    }

    /**
     * Manually detect current room (one-time scan)
     * @returns {Promise<string|null>} Detected room ID or null
     */
    async detectRoomManually() {
        if (!this.config || this.config.rooms.length === 0) {
            throw new AppError('No rooms configured', ErrorType.NOT_FOUND);
        }

        if (!this.callbacks.scanBLE) {
            throw new AppError('BLE scan callback not configured', ErrorType.VALIDATION);
        }

        try {
            if (this.callbacks.onStatusUpdate) {
                this.callbacks.onStatusUpdate('📡 Scanning for nearby devices...', 'info');
            }

            // Scan for devices (works regardless of autoDetect setting)
            const timeout = this.config.settings?.scanInterval || 5000;
            const devices = await this.callbacks.scanBLE(timeout);

            if (!devices || devices.length === 0) {
                if (this.callbacks.onStatusUpdate) {
                    this.callbacks.onStatusUpdate('📍 No devices found', 'info');
                }
                return null;
            }

            // Detect room from RSSI
            const detectedRoomId = this.detectRoomFromRSSI(devices);

            if (detectedRoomId) {
                // Find room data to show the name
                const roomData = this.getRoom(detectedRoomId);
                const roomName = roomData ? `${roomData.emoji || '📍'} ${roomData.name}` : detectedRoomId;

                // Update current room
                this.setCurrentRoom(detectedRoomId, 'manual');

                if (this.callbacks.onStatusUpdate) {
                    this.callbacks.onStatusUpdate(`✅ Found room: ${roomName}`, 'success');
                }

                return detectedRoomId;
            } else {
                if (this.callbacks.onStatusUpdate) {
                    this.callbacks.onStatusUpdate('📍 No matching room found', 'info');
                }
                return null;
            }
        } catch (error) {
            console.error('Manual room detection failed:', error);
            if (this.callbacks.onStatusUpdate) {
                this.callbacks.onStatusUpdate('❌ Room detection failed', 'error');
            }
            throw error;
        }
    }

    /**
     * Get devices for current room
     * @param {string} deviceType - Device type ('roku', 'govee', etc.)
     * @returns {Array} List of device IDs
     */
    getRoomDevices(deviceType) {
        const room = this.getCurrentRoom();
        if (!room || !this.config) {
            return [];
        }

        const roomData = this.getRoom(room);
        if (!roomData || !roomData.devices) {
            return [];
        }

        return roomData.devices[deviceType] || [];
    }

    /**
     * Check if device is in current room
     * @param {string} deviceType - Device type ('roku', 'govee', etc.)
     * @param {string} deviceId - Device ID
     * @returns {boolean} True if device is in current room or no room selected
     */
    isDeviceInCurrentRoom(deviceType, deviceId) {
        const room = this.getCurrentRoom();

        // If no room selected, show all devices
        if (!room) {
            return true;
        }

        const roomDevices = this.getRoomDevices(deviceType);
        return roomDevices.includes(deviceId);
    }
}

// Export singleton instance
const roomsManager = new RoomsManager();

export default roomsManager;
export { RoomsManager };
