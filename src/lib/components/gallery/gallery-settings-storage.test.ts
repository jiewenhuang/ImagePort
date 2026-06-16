import { describe, expect, test } from 'bun:test';
import {
	formatLoadedTaskCount,
	formatStorageBytes,
	getStorageBytesTone,
	getTaskStorageEstimateLabel,
	shouldRefreshStorageBytesForTab
} from './gallery-settings-storage';

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

	test('formats loaded task counts separately from total task counts', () => {
		expect(formatLoadedTaskCount(24, 60)).toBe('24 / 60');
		expect(formatLoadedTaskCount(24, 24)).toBe('24');
		expect(formatLoadedTaskCount(24, null)).toBe('24');
	});

	test('labels storage estimates as loaded task export estimates when history is partially loaded', () => {
		expect(getTaskStorageEstimateLabel(24, 60)).toBe('已加载任务导出 JSON 估算');
		expect(getTaskStorageEstimateLabel(24, 24)).toBe('导出 JSON 估算');
	});

	test('requests storage estimates only for tabs that display them', () => {
		expect(shouldRefreshStorageBytesForTab('api')).toBe(false);
		expect(shouldRefreshStorageBytesForTab('general')).toBe(false);
		expect(shouldRefreshStorageBytesForTab('agent')).toBe(false);
		expect(shouldRefreshStorageBytesForTab('data')).toBe(true);
		expect(shouldRefreshStorageBytesForTab('about')).toBe(true);
	});
});
