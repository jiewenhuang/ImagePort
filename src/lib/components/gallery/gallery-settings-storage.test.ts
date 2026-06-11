import { describe, expect, test } from 'bun:test';
import { formatStorageBytes, getStorageBytesTone, shouldRefreshStorageBytesForTab } from './gallery-settings-storage';

describe('gallery settings storage helpers', () => {
	test('formats pending and concrete storage byte estimates', () => {
		expect(formatStorageBytes(null)).toBe('计算中...');
		expect(formatStorageBytes(512)).toBe('512 B');
		expect(formatStorageBytes(1536)).toBe('1.5 KB');
		expect(formatStorageBytes(2 * 1024 * 1024)).toBe('2.0 MB');
	});

	test('uses warning tone only after the storage warning threshold', () => {
		expect(getStorageBytesTone(null)).toBe('text-muted-foreground');
		expect(getStorageBytesTone(1024)).toBe('text-muted-foreground');
		expect(getStorageBytesTone(4 * 1024 * 1024)).toBe('text-amber-700');
	});

	test('requests storage estimates only for tabs that display them', () => {
		expect(shouldRefreshStorageBytesForTab('api')).toBe(false);
		expect(shouldRefreshStorageBytesForTab('general')).toBe(false);
		expect(shouldRefreshStorageBytesForTab('agent')).toBe(false);
		expect(shouldRefreshStorageBytesForTab('data')).toBe(true);
		expect(shouldRefreshStorageBytesForTab('about')).toBe(true);
	});
});
