/**
 * @fileoverview Unit tests for Content module
 *
 * To run these tests, you'll need to install a test framework.
 * Recommended: npm install --save-dev vitest
 * Run with: npx vitest src/modules/content.test.js
 */

import { ContentManager } from './content.js';

/**
 * Test suite for ContentManager
 */
describe('ContentManager', () => {
    let manager;

    beforeEach(() => {
        manager = new ContentManager();
    });

    describe('passphrase management', () => {
        test('should get empty passphrase by default', () => {
            expect(manager.getPassphrase()).toBe('');
        });

        test('should set and get passphrase', () => {
            manager.setPassphrase('test passphrase here');
            expect(manager.getPassphrase()).toBe('test passphrase here');
        });

        test('should trim passphrase when setting', () => {
            manager.setPassphrase('  test passphrase  ');
            expect(manager.getPassphrase()).toBe('test passphrase');
        });

        test('should remove passphrase when empty', () => {
            manager.setPassphrase('test');
            manager.setPassphrase('');
            expect(manager.getPassphrase()).toBe('');
        });
    });

    describe('passphrase validation', () => {
        test('should reject empty passphrase', () => {
            const result = manager.validatePassphrase('');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('empty');
        });

        test('should reject passphrase with less than 5 words', () => {
            const result = manager.validatePassphrase('one two three four');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('5 words');
        });

        test('should accept passphrase with 5 or more words', () => {
            const result = manager.validatePassphrase('one two three four five');
            expect(result.valid).toBe(true);
        });

        test('should count words correctly with multiple spaces', () => {
            const result = manager.validatePassphrase('one  two   three    four     five');
            expect(result.valid).toBe(true);
        });
    });

    describe('cloud URL building', () => {
        test('should build cloud URL with passphrase', () => {
            const url = manager.buildCloudUrl('my secret passphrase');
            expect(url).toContain('passphrase=');
            expect(url).toContain('type=app-config');
        });

        test('should encode passphrase in URL', () => {
            const url = manager.buildCloudUrl('my secret passphrase');
            expect(url).toContain(encodeURIComponent('my secret passphrase'));
        });

        test('should support custom type parameter', () => {
            const url = manager.buildCloudUrl('test', 'rooms');
            expect(url).toContain('type=rooms');
        });

        test('should return null for empty passphrase', () => {
            expect(manager.buildCloudUrl('')).toBeNull();
            expect(manager.buildCloudUrl(null)).toBeNull();
        });
    });

    describe('configuration validation', () => {
        test('should reject null config', () => {
            const result = manager.validateConfig(null);
            expect(result.valid).toBe(false);
        });

        test('should reject config without tabs', () => {
            const result = manager.validateConfig({});
            expect(result.valid).toBe(false);
            expect(result.error).toContain('tabs');
        });

        test('should reject config with non-array tabs', () => {
            const result = manager.validateConfig({ tabs: 'not-an-array' });
            expect(result.valid).toBe(false);
        });

        test('should accept valid config', () => {
            const result = manager.validateConfig({
                tabs: [
                    { id: 'remote', label: 'Remote', buttons: [] }
                ]
            });
            expect(result.valid).toBe(true);
        });

        test('should accept config with empty tabs array', () => {
            const result = manager.validateConfig({ tabs: [] });
            expect(result.valid).toBe(true);
        });
    });

    describe('quick launch normalization', () => {
        test('should auto-generate ID for YouTube items', () => {
            const item = {
                type: 'youtube',
                videoId: 'dQw4w9WgXcQ',
                label: 'Test Video'
            };

            const normalized = manager.normalizeQuickLaunchItem(item);
            expect(normalized.id).toBe('yt-dQw4w9WgXcQ');
        });

        test('should generate ID from label if no videoId', () => {
            const item = {
                type: 'custom',
                label: 'My Custom Button'
            };

            const normalized = manager.normalizeQuickLaunchItem(item);
            expect(normalized.id).toBe('ql-my-custom-button');
        });

        test('should generate random ID if no label or videoId', () => {
            const item = { type: 'custom' };
            const normalized = manager.normalizeQuickLaunchItem(item);
            expect(normalized.id).toMatch(/^ql-\d+$/);
        });

        test('should auto-generate thumbnail for YouTube items', () => {
            const item = {
                type: 'youtube',
                videoId: 'dQw4w9WgXcQ',
                label: 'Test Video'
            };

            const normalized = manager.normalizeQuickLaunchItem(item);
            expect(normalized.thumbnail).toContain('img.youtube.com');
            expect(normalized.thumbnail).toContain('dQw4w9WgXcQ');
        });

        test('should not override existing thumbnail', () => {
            const item = {
                type: 'youtube',
                videoId: 'dQw4w9WgXcQ',
                thumbnail: 'https://example.com/custom.jpg'
            };

            const normalized = manager.normalizeQuickLaunchItem(item);
            expect(normalized.thumbnail).toBe('https://example.com/custom.jpg');
        });

        test('should default label to empty string', () => {
            const item = { type: 'custom', id: 'test' };
            const normalized = manager.normalizeQuickLaunchItem(item);
            expect(normalized.label).toBe('');
        });

        test('should preserve existing fields', () => {
            const item = {
                id: 'custom-id',
                type: 'custom',
                label: 'Test',
                handler: 'testHandler',
                thumbnail: 'test.jpg'
            };

            const normalized = manager.normalizeQuickLaunchItem(item);
            expect(normalized.id).toBe('custom-id');
            expect(normalized.type).toBe('custom');
            expect(normalized.label).toBe('Test');
            expect(normalized.handler).toBe('testHandler');
        });
    });

    describe('current state', () => {
        test('should return null config initially', () => {
            expect(manager.getCurrentConfig()).toBeNull();
        });

        test('should return unknown source initially', () => {
            const source = manager.getCurrentSource();
            expect(source.type).toBe('unknown');
        });

        test('should update config when loaded', () => {
            const config = { tabs: [] };
            manager.currentConfig = config;
            expect(manager.getCurrentConfig()).toBe(config);
        });

        test('should update source when content loaded', () => {
            manager.currentSource = { type: 'cloud', passphrase: '***' };
            expect(manager.getCurrentSource().type).toBe('cloud');
        });
    });

    describe('button type catalog', () => {
        test('should return null catalog initially', () => {
            expect(manager.getButtonTypeCatalog()).toBeNull();
        });

        test('should store loaded catalog', () => {
            const catalog = {
                buttonTypes: [
                    { type: 'key', description: 'Press a key' }
                ]
            };
            manager.buttonTypeCatalog = catalog;
            expect(manager.getButtonTypeCatalog()).toBe(catalog);
        });
    });

    describe('callbacks', () => {
        test('should set callbacks', () => {
            const mockCallback = jest.fn();
            manager.setCallbacks({ onStatusUpdate: mockCallback });

            expect(manager.callbacks.onStatusUpdate).toBe(mockCallback);
        });

        test('should preserve existing callbacks when setting new ones', () => {
            const callback1 = jest.fn();
            const callback2 = jest.fn();

            manager.setCallbacks({ onStatusUpdate: callback1 });
            manager.setCallbacks({ onContentChanged: callback2 });

            expect(manager.callbacks.onStatusUpdate).toBe(callback1);
            expect(manager.callbacks.onContentChanged).toBe(callback2);
        });
    });

    describe('Netlify API configuration', () => {
        test('should allow setting custom API base', () => {
            manager.setNetlifyApiBase('https://custom-api.example.com');
            const url = manager.buildCloudUrl('test');
            expect(url).toContain('custom-api.example.com');
        });
    });
});
