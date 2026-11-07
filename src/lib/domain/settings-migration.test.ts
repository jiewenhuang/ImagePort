import { describe, expect, test } from 'bun:test';
import { DEFAULT_SETTINGS, buildExportedSettings, normalizeSettings, parseImportedSettings } from './settings';

describe('image workspace settings migration', () => {
	const legacySettings = {
		...DEFAULT_SETTINGS,
		schemaVersion: 1,
		profiles: [
			{ ...DEFAULT_SETTINGS.profiles[0], id: 'images', apiKey: 'image-secret', model: 'custom-image' },
			{
				...DEFAULT_SETTINGS.profiles[0],
				id: 'thinking',
				apiProtocol: 'openai-responses',
				apiMode: 'responses',
				apiKey: 'agent-secret'
			}
		],
		activeProfileId: 'images',
		workspaceRouting: {
			galleryProfileId: 'images',
			agentProfileId: 'thinking',
			agentImageProfileId: 'images',
			studioScriptProfileId: 'thinking',
			studioImageProfileId: 'images',
			studioVideoModelId: 'seedance-2.0',
			studioVideoTransportId: 'byteplus-modelark'
		},
		videoProviderConnections: [{ apiKey: 'retired-video-secret' }],
		s3Storage: { secretAccessKey: 'retired-storage-secret' },
		favoriteCollections: [{ id: 'favorites-custom', name: '作品' }],
		agentImageRoutingStrategy: 'profile',
		persistInputOnRestart: false
	};

	test('retains image and Agent profiles, credentials, routes and preferences', () => {
		const migrated = normalizeSettings(legacySettings);
		expect(migrated.schemaVersion).toBe(2);
		expect(migrated.profiles.map(({ id, apiKey }) => ({ id, apiKey }))).toEqual([
			{ id: 'images', apiKey: 'image-secret' },
			{ id: 'thinking', apiKey: 'agent-secret' }
		]);
		expect(migrated.workspaceRouting).toEqual({
			galleryProfileId: 'images',
			agentProfileId: 'thinking',
			agentImageProfileId: 'images'
		});
		expect(migrated.profiles[0].model).toBe('custom-image');
		expect(migrated.favoriteCollections.find((collection) => collection.id === 'favorites-custom')?.name).toBe('作品');
		expect(migrated.agentImageRoutingStrategy).toBe('profile');
		expect(migrated.persistInputOnRestart).toBe(false);
		expect(normalizeSettings(migrated)).toEqual(migrated);
	});

	test('ignores retired settings without mutating the original backup', () => {
		const original = JSON.stringify(legacySettings);
		const migrated = normalizeSettings(legacySettings);
		expect('videoProviderConnections' in migrated).toBe(false);
		expect('s3Storage' in migrated).toBe(false);
		expect(JSON.stringify(migrated).includes('retired-')).toBe(false);
		expect(JSON.stringify(legacySettings)).toBe(original);
	});

	test('imports both raw settings and version 1 exports and round-trips version 2', () => {
		const expected = normalizeSettings(legacySettings);
		expect(parseImportedSettings(JSON.stringify(legacySettings))).toEqual(expected);
		expect(parseImportedSettings(JSON.stringify({ version: 1, settings: legacySettings }))).toEqual(expected);
		const exported = buildExportedSettings(expected, true);
		expect(exported.version).toBe(2);
		expect(parseImportedSettings(JSON.stringify(exported))).toEqual(expected);
		const safe = buildExportedSettings(expected, false);
		expect(safe.settings.profiles.every((profile) => profile.apiKey === '')).toBe(true);
	});
});
