/**
 * @fileoverview Unit tests for Macros module
 *
 * To run these tests, you'll need to install a test framework.
 * Recommended: npm install --save-dev vitest
 * Run with: npx vitest src/modules/macros.test.js
 */

import { MacrosManager } from './macros.js';

/**
 * Test suite for MacrosManager
 */
describe('MacrosManager', () => {
    let manager;

    beforeEach(() => {
        manager = new MacrosManager();
        manager.init();
    });

    describe('initialization', () => {
        test('should initialize with empty macros', () => {
            expect(manager.getMacros()).toEqual([]);
        });

        test('should initialize with empty draft steps', () => {
            expect(manager.getDraftSteps()).toEqual([]);
        });

        test('should not be running initially', () => {
            expect(manager.isRunning).toBe(false);
        });
    });

    describe('draft step management', () => {
        test('should add step to draft', () => {
            const step = { type: 'key', key: 'Home' };
            manager.addDraftStep(step);

            expect(manager.getDraftSteps()).toHaveLength(1);
            expect(manager.getDraftSteps()[0]).toEqual(step);
        });

        test('should remove step from draft by index', () => {
            manager.addDraftStep({ type: 'key', key: 'Home' });
            manager.addDraftStep({ type: 'key', key: 'Back' });
            manager.removeDraftStep(0);

            expect(manager.getDraftSteps()).toHaveLength(1);
            expect(manager.getDraftSteps()[0].key).toBe('Back');
        });

        test('should clear draft', () => {
            manager.addDraftStep({ type: 'key', key: 'Home' });
            manager.clearDraft();

            expect(manager.getDraftSteps()).toHaveLength(0);
        });

        test('should throw error for invalid step', () => {
            expect(() => manager.addDraftStep(null)).toThrow();
            expect(() => manager.addDraftStep({ key: 'Home' })).toThrow(); // Missing type
        });
    });

    describe('macro creation', () => {
        test('should save macro with valid name and steps', () => {
            manager.addDraftStep({ type: 'key', key: 'Home' });
            const macro = manager.saveMacro('Test Macro');

            expect(macro).toBeDefined();
            expect(macro.name).toBe('Test Macro');
            expect(macro.steps).toHaveLength(1);
            expect(macro.id).toMatch(/^macro-\d+$/);
        });

        test('should throw error for empty name', () => {
            manager.addDraftStep({ type: 'key', key: 'Home' });
            expect(() => manager.saveMacro('')).toThrow();
        });

        test('should throw error for no steps', () => {
            expect(() => manager.saveMacro('Test')).toThrow();
        });

        test('should clear draft after saving', () => {
            manager.addDraftStep({ type: 'key', key: 'Home' });
            manager.saveMacro('Test');

            expect(manager.getDraftSteps()).toHaveLength(0);
        });

        test('should unfavorite other macros when saving favorite', () => {
            manager.addDraftStep({ type: 'key', key: 'Home' });
            manager.saveMacro('First', true);

            manager.addDraftStep({ type: 'key', key: 'Back' });
            manager.saveMacro('Second', true);

            const macros = manager.getMacros();
            expect(macros[0].favorite).toBe(false);
            expect(macros[1].favorite).toBe(true);
        });
    });

    describe('macro management', () => {
        test('should get macro by ID', () => {
            manager.addDraftStep({ type: 'key', key: 'Home' });
            const saved = manager.saveMacro('Test');

            const found = manager.getMacro(saved.id);
            expect(found).toEqual(saved);
        });

        test('should return null for non-existent macro', () => {
            expect(manager.getMacro('invalid-id')).toBeNull();
        });

        test('should delete macro by ID', () => {
            manager.addDraftStep({ type: 'key', key: 'Home' });
            const saved = manager.saveMacro('Test');

            const deleted = manager.deleteMacro(saved.id);
            expect(deleted).toBe(true);
            expect(manager.getMacros()).toHaveLength(0);
        });

        test('should return false when deleting non-existent macro', () => {
            expect(manager.deleteMacro('invalid-id')).toBe(false);
        });

        test('should toggle favorite status', () => {
            manager.addDraftStep({ type: 'key', key: 'Home' });
            const saved = manager.saveMacro('Test', false);

            manager.toggleFavorite(saved.id);
            expect(manager.getMacro(saved.id).favorite).toBe(true);

            manager.toggleFavorite(saved.id);
            expect(manager.getMacro(saved.id).favorite).toBe(false);
        });
    });

    describe('step descriptions', () => {
        test('should describe key step', () => {
            const desc = manager.describeStep({ type: 'key', key: 'Home' });
            expect(desc).toBe('Press Home');
        });

        test('should describe launch step', () => {
            const desc = manager.describeStep({
                type: 'launch',
                appId: '12',
                label: 'Netflix',
                params: 'contentId=123'
            });
            expect(desc).toBe('Launch Netflix (contentId=123)');
        });

        test('should describe delay step', () => {
            const desc = manager.describeStep({ type: 'delay', duration: 1500 });
            expect(desc).toBe('Wait 1.5s');
        });

        test('should handle unknown step type', () => {
            const desc = manager.describeStep({ type: 'unknown' });
            expect(desc).toBe('Unknown step');
        });
    });

    describe('launch value parsing', () => {
        test('should parse app ID only', () => {
            const result = manager.parseLaunchValue('12');
            expect(result).toEqual({ appId: '12', params: '', label: '' });
        });

        test('should parse app ID with params', () => {
            const result = manager.parseLaunchValue('12?contentId=123');
            expect(result).toEqual({ appId: '12', params: 'contentId=123', label: '' });
        });

        test('should parse app ID with label', () => {
            const result = manager.parseLaunchValue('12|Netflix');
            expect(result).toEqual({ appId: '12', params: '', label: 'Netflix' });
        });

        test('should parse full format', () => {
            const result = manager.parseLaunchValue('12?contentId=123|Netflix');
            expect(result).toEqual({ appId: '12', params: 'contentId=123', label: 'Netflix' });
        });

        test('should handle empty input', () => {
            const result = manager.parseLaunchValue('');
            expect(result).toEqual({ appId: '', params: '', label: '' });
        });
    });
});
