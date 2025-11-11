/**
 * @fileoverview Unit tests for Rooms module
 *
 * To run these tests, you'll need to install a test framework.
 * Recommended: npm install --save-dev vitest
 * Run with: npx vitest src/modules/rooms.test.js
 */

import { RoomsManager } from './rooms.js';

/**
 * Test suite for RoomsManager
 */
describe('RoomsManager', () => {
    let manager;

    beforeEach(() => {
        manager = new RoomsManager();
    });

    describe('initialization', () => {
        test('should initialize with null config', () => {
            expect(manager.getConfig()).toBeNull();
        });

        test('should initialize with null current room', () => {
            expect(manager.getCurrentRoom()).toBeNull();
        });

        test('should not have active detection interval', () => {
            expect(manager.detectionInterval).toBeNull();
        });
    });

    describe('room configuration', () => {
        test('should save and retrieve config', () => {
            const config = {
                rooms: [
                    { id: 'living-room', name: 'Living Room', emoji: '🛋️', beacons: [] }
                ],
                settings: {
                    autoDetect: false,
                    scanInterval: 10000
                }
            };

            manager.saveConfig(config);
            expect(manager.getConfig()).toEqual(config);
        });

        test('should get room by ID', () => {
            manager.config = {
                rooms: [
                    { id: 'living-room', name: 'Living Room' },
                    { id: 'bedroom', name: 'Bedroom' }
                ]
            };

            const room = manager.getRoom('living-room');
            expect(room.name).toBe('Living Room');
        });

        test('should return null for non-existent room', () => {
            manager.config = { rooms: [] };
            expect(manager.getRoom('invalid')).toBeNull();
        });
    });

    describe('current room management', () => {
        test('should set and get current room', () => {
            manager.setCurrentRoom('living-room', 'manual');
            expect(manager.getCurrentRoom()).toBe('living-room');
        });

        test('should trigger callback when room changes', () => {
            const mockCallback = jest.fn();
            manager.setCallbacks({ onRoomChanged: mockCallback });

            manager.setCurrentRoom('living-room', 'manual');

            expect(mockCallback).toHaveBeenCalledWith('living-room', 'manual');
        });

        test('should dispatch custom event when room changes', () => {
            const eventListener = jest.fn();
            window.addEventListener('roomChanged', eventListener);

            manager.setCurrentRoom('living-room', 'auto');

            expect(eventListener).toHaveBeenCalled();
            const event = eventListener.mock.calls[0][0];
            expect(event.detail.roomId).toBe('living-room');
            expect(event.detail.source).toBe('auto');
        });
    });

    describe('RSSI-based room detection', () => {
        beforeEach(() => {
            manager.config = {
                rooms: [
                    {
                        id: 'living-room',
                        name: 'Living Room',
                        beacons: [
                            { address: 'AA:BB:CC:DD:EE:11', rssiThreshold: -70 }
                        ]
                    },
                    {
                        id: 'bedroom',
                        name: 'Bedroom',
                        beacons: [
                            { address: 'AA:BB:CC:DD:EE:22', rssiThreshold: -70 }
                        ]
                    }
                ],
                settings: {
                    detectionMode: 'strongest_signal'
                }
            };
        });

        test('should detect room with strongest signal', () => {
            const devices = [
                { address: 'aa:bb:cc:dd:ee:11', rssi: -60 }, // Living room (stronger)
                { address: 'aa:bb:cc:dd:ee:22', rssi: -75 }  // Bedroom (weaker)
            ];

            const detected = manager.detectRoomFromRSSI(devices);
            expect(detected).toBe('living-room');
        });

        test('should return null if no beacons match', () => {
            const devices = [
                { address: 'aa:bb:cc:dd:ee:99', rssi: -60 } // Unknown device
            ];

            const detected = manager.detectRoomFromRSSI(devices);
            expect(detected).toBeNull();
        });

        test('should respect RSSI threshold', () => {
            const devices = [
                { address: 'aa:bb:cc:dd:ee:11', rssi: -80 } // Below threshold (-70)
            ];

            const detected = manager.detectRoomFromRSSI(devices);
            expect(detected).toBeNull();
        });

        test('should return null in manual mode', () => {
            manager.config.settings.detectionMode = 'manual';

            const devices = [
                { address: 'aa:bb:cc:dd:ee:11', rssi: -60 }
            ];

            const detected = manager.detectRoomFromRSSI(devices);
            expect(detected).toBeNull();
        });

        test('should return fallback room when no matches', () => {
            manager.config.settings.fallbackRoom = 'default-room';

            const devices = [
                { address: 'aa:bb:cc:dd:ee:99', rssi: -60 }
            ];

            const detected = manager.detectRoomFromRSSI(devices);
            expect(detected).toBe('default-room');
        });

        test('should handle case-insensitive MAC addresses', () => {
            const devices = [
                { address: 'AA:BB:CC:DD:EE:11', rssi: -60 } // Uppercase
            ];

            const detected = manager.detectRoomFromRSSI(devices);
            expect(detected).toBe('living-room');
        });
    });

    describe('device filtering', () => {
        beforeEach(() => {
            manager.config = {
                rooms: [
                    {
                        id: 'living-room',
                        devices: {
                            roku: ['192.168.1.100'],
                            govee: ['AA:BB:CC:DD:EE:11']
                        }
                    }
                ]
            };
            manager.currentRoom = 'living-room';
        });

        test('should get devices for current room', () => {
            const rokuDevices = manager.getRoomDevices('roku');
            expect(rokuDevices).toEqual(['192.168.1.100']);
        });

        test('should return empty array for unknown device type', () => {
            const devices = manager.getRoomDevices('unknown');
            expect(devices).toEqual([]);
        });

        test('should check if device is in current room', () => {
            expect(manager.isDeviceInCurrentRoom('roku', '192.168.1.100')).toBe(true);
            expect(manager.isDeviceInCurrentRoom('roku', '192.168.1.200')).toBe(false);
        });

        test('should show all devices when no room selected', () => {
            manager.currentRoom = null;
            expect(manager.isDeviceInCurrentRoom('roku', '192.168.1.200')).toBe(true);
        });
    });

    describe('auto-detection', () => {
        beforeEach(() => {
            manager.config = {
                rooms: [],
                settings: {
                    autoDetect: false,
                    scanInterval: 10000
                }
            };
        });

        test('should not start detection when disabled', () => {
            manager.startAutoDetection();
            expect(manager.detectionInterval).toBeNull();
        });

        test('should start detection when enabled', () => {
            manager.config.settings.autoDetect = true;
            manager.startAutoDetection();
            expect(manager.detectionInterval).not.toBeNull();
        });

        test('should stop detection', () => {
            manager.config.settings.autoDetect = true;
            manager.startAutoDetection();
            manager.stopAutoDetection();
            expect(manager.detectionInterval).toBeNull();
        });

        test('should toggle auto-detect setting', async () => {
            expect(manager.config.settings.autoDetect).toBe(false);

            await manager.toggleAutoDetect();
            expect(manager.config.settings.autoDetect).toBe(true);

            await manager.toggleAutoDetect();
            expect(manager.config.settings.autoDetect).toBe(false);
        });
    });
});
