import { describe, expect, test } from 'bun:test';
import {
	DEFAULT_SETTINGS,
	addOpenAIProfile,
	duplicateProfile,
	getApiProviderLabel,
	importCustomProviderDefinitionFromJson,
	getProfileRequestBlockReason,
	getTaskReuseProfile,
	removeCustomProvider,
	normalizeAgentMaxToolRounds,
	normalizeSettings,
	normalizeZipDownloadRoutes,
	removeProfile,
	serializeSettingsForExport,
	switchApiProfileProvider,
	type AppSettings
} from './settings';

describe('normalizeSettings', () => {
	test('returns a usable default settings object', () => {
		const settings = normalizeSettings(null);

		expect(settings.activeProfileId).toBe(DEFAULT_SETTINGS.activeProfileId);
		expect(settings.profiles.length).toBe(1);
		expect(settings.profiles[0].baseUrl).toBe('https://api.openai.com/v1');
		expect(settings.profiles[0].model).toBe('gpt-image-2');
		expect(settings.profiles[0].apiMode).toBe('images');
		expect(settings.clearInputAfterSubmit).toBe(false);
		expect(settings.persistInputOnRestart).toBe(true);
		expect(settings.reuseTaskApiProfileTemporarily).toBe(false);
		expect(settings.alwaysShowRetryButton).toBe(true);
		expect(settings.agentMaxToolRounds).toBe(15);
		expect(settings.agentAutoScroll).toBe(true);
		expect(settings.agentWebSearch).toBe(false);
		expect(settings.zipDownloadRoutes.includes('task-detail-all')).toBe(true);
		expect(settings.favoriteCollections[0].id).toBe('favorites-default');
		expect(settings.activeFavoriteCollectionId).toBe(null);
		expect(settings.customProviders).toEqual([]);
	});

	test('migrates legacy single-profile fields', () => {
		const settings = normalizeSettings({
			baseUrl: 'https://proxy.example.com/v1',
			apiKey: 'sk-legacy',
			model: 'image-model',
			timeoutSecs: 240,
			responseFormatB64Json: true
		});

		const profile = settings.profiles[0];
		expect(profile.baseUrl).toBe('https://proxy.example.com/v1');
		expect(profile.apiKey).toBe('sk-legacy');
		expect(profile.model).toBe('image-model');
		expect(profile.timeoutSecs).toBe(240);
		expect(profile.responseFormatB64Json).toBe(true);
	});

	test('normalizes profile and behavior bounds', () => {
		const settings = normalizeSettings({
			activeProfileId: 'custom',
			profiles: [
				{
					id: 'custom',
					name: '',
					provider: 'openai',
					baseUrl: '',
					apiKey: 'sk-test',
					model: '',
					timeoutSecs: 9999,
					apiMode: 'responses',
					streamImages: true,
					streamPartialImages: 99
				}
			],
			referenceImageEditAction: 'replace-reference',
			enterSubmit: true,
			reuseTaskApiProfileTemporarily: true,
			alwaysShowRetryButton: false,
			zipDownloadRoutes: ['task-card', 'bad-route', 'task-card'],
			agentMaxToolRounds: 999,
			agentAutoScroll: false,
			agentWebSearch: true,
			favoriteCollections: [{ id: 'work', name: 'Work', createdAt: 10, updatedAt: 20 }],
			activeFavoriteCollectionId: 'work'
		});

		const profile = settings.profiles[0];
		expect(profile.name).toBe('OpenAI');
		expect(profile.baseUrl).toBe('https://api.openai.com/v1');
		expect(profile.model).toBe('gpt-5.5');
		expect(profile.timeoutSecs).toBe(1800);
		expect(profile.streamPartialImages).toBe(3);
		expect(settings.referenceImageEditAction).toBe('replace-reference');
		expect(settings.enterSubmit).toBe(true);
		expect(settings.reuseTaskApiProfileTemporarily).toBe(true);
		expect(settings.alwaysShowRetryButton).toBe(false);
		expect(settings.zipDownloadRoutes).toEqual(['task-card']);
		expect(settings.agentMaxToolRounds).toBe(50);
		expect(settings.agentAutoScroll).toBe(false);
		expect(settings.agentWebSearch).toBe(true);
		expect(settings.favoriteCollections.map((item) => item.id)).toEqual(['favorites-default', 'work']);
		expect(settings.activeFavoriteCollectionId).toBe('work');
	});
});

describe('provider settings', () => {
	test('migrates removed providers back to OpenAI-compatible profiles', () => {
		const settings = normalizeSettings({
			activeProfileId: 'removed-prod',
			profiles: [
				{
					id: 'removed-prod',
					name: 'Removed Provider',
					provider: 'removed-provider',
					baseUrl: 'https://removed.example.com/',
					apiKey: 'removed-key',
					model: 'openai/gpt-image-2',
					timeoutSecs: 90,
					apiMode: 'images',
					responseFormatB64Json: true,
					streamImages: true
				}
			]
		});

		const profile = settings.profiles[0];
		expect(profile.provider).toBe('openai');
		expect(profile.name).toBe('OpenAI');
		expect(profile.baseUrl).toBe('https://api.openai.com/v1');
		expect(profile.apiKey).toBe('');
		expect(profile.model).toBe(DEFAULT_SETTINGS.profiles[0].model);
		expect(profile.responseFormatB64Json).toBe(false);
		expect(profile.streamImages).toBe(false);
		expect(getProfileRequestBlockReason(profile, settings)).toBe(null);
	});

	test('imports custom provider manifests and allows profiles to use them', () => {
		const provider = importCustomProviderDefinitionFromJson(
			JSON.stringify({
				id: 'custom-lab',
				name: 'Lab Gateway',
				submit: {
					path: 'image',
					contentType: 'json',
					body: { prompt: '$prompt', model: '$profile.model' },
					result: { b64JsonPaths: ['data.*.b64_json'] }
				}
			})
		);
		const settings = normalizeSettings({
			customProviders: [provider],
			profiles: [
				{
					...DEFAULT_SETTINGS.profiles[0],
					id: 'lab-profile',
					provider: 'custom-lab',
					baseUrl: 'https://lab.example.com/v1',
					model: 'lab-image'
				}
			],
			activeProfileId: 'lab-profile'
		});

		expect(settings.customProviders[0].id).toBe('custom-lab');
		expect(settings.profiles[0].provider).toBe('custom-lab');
		expect(getApiProviderLabel(settings, 'custom-lab')).toBe('Lab Gateway');
		expect(getProfileRequestBlockReason(settings.profiles[0], settings)).toBe(null);
	});

	test('switches profile provider with provider-specific defaults', () => {
		const openai = DEFAULT_SETTINGS.profiles[0];
		const backToOpenAI = switchApiProfileProvider(openai, 'openai');

		expect(backToOpenAI.provider).toBe('openai');
		expect(backToOpenAI.baseUrl).toBe(openai.baseUrl);
		expect(backToOpenAI.model).toBe(openai.model);
	});

	test('migrates the previous Responses default model to the current default', () => {
		const settings = normalizeSettings({
			profiles: [{ ...DEFAULT_SETTINGS.profiles[0], apiMode: 'responses', model: 'gpt-5.1' }]
		});

		expect(settings.profiles[0].model).toBe('gpt-5.5');
	});

	test('removes custom providers without leaving dead profile providers', () => {
		const current = normalizeSettings({
			customProviders: [
				{
					id: 'custom-old',
					name: 'Old',
					submit: {
						path: 'images',
						result: { b64JsonPaths: ['data.*.b64_json'] }
					}
				}
			],
			profiles: [{ ...DEFAULT_SETTINGS.profiles[0], id: 'custom-profile', provider: 'custom-old' }],
			activeProfileId: 'custom-profile'
		});
		const removed = removeCustomProvider(current, 'custom-old');

		expect(removed.customProviders).toEqual([]);
		expect(removed.profiles[0].provider).toBe('openai');
	});
});

describe('download and agent settings helpers', () => {
	test('normalizes zip download routes and agent tool round bounds', () => {
		expect(normalizeZipDownloadRoutes(['task-selection', 'task-selection', 'unknown'])).toEqual(['task-selection']);
		expect(normalizeZipDownloadRoutes(null)).toEqual(DEFAULT_SETTINGS.zipDownloadRoutes);
		expect(normalizeAgentMaxToolRounds(0)).toBe(1);
		expect(normalizeAgentMaxToolRounds(99)).toBe(50);
		expect(normalizeAgentMaxToolRounds('12')).toBe(12);
	});
});

describe('serializeSettingsForExport', () => {
	test('omits api keys unless requested', () => {
		const settings: AppSettings = normalizeSettings({ apiKey: 'sk-secret' });

		const safeExport = serializeSettingsForExport(settings, false);
		const secretExport = serializeSettingsForExport(settings, true);

		expect(safeExport.profiles[0].apiKey).toBe('');
		expect(secretExport.profiles[0].apiKey).toBe('sk-secret');
	});
});

describe('getProfileRequestBlockReason', () => {
	test('allows images api profiles', () => {
		const settings = normalizeSettings(null);

		expect(getProfileRequestBlockReason(settings.profiles[0])).toBe(null);
	});

	test('allows responses api gallery requests', () => {
		const settings = normalizeSettings({
			profiles: [{ ...DEFAULT_SETTINGS.profiles[0], apiMode: 'responses' }]
		});

		expect(getProfileRequestBlockReason(settings.profiles[0], settings)).toBe(null);
	});

	test('allows OpenAI Images streaming in Gallery', () => {
		const settings = normalizeSettings({
			profiles: [{ ...DEFAULT_SETTINGS.profiles[0], streamImages: true }]
		});

		expect(getProfileRequestBlockReason(settings.profiles[0], settings)).toBe(null);
	});
});

describe('profile management', () => {
	test('adds a new OpenAI profile and activates it', () => {
		const settings = addOpenAIProfile(DEFAULT_SETTINGS, () => 'profile-new');

		expect(settings.profiles.length).toBe(2);
		expect(settings.activeProfileId).toBe('profile-new');
		expect(settings.profiles[1].name).toBe('新配置');
		expect(settings.profiles[1].model).toBe('gpt-image-2');
	});

	test('duplicates the active profile with a unique id', () => {
		const current = normalizeSettings({
			profiles: [{ ...DEFAULT_SETTINGS.profiles[0], id: 'source', name: '生产', apiKey: 'sk-prod' }],
			activeProfileId: 'source'
		});

		const settings = duplicateProfile(current, 'source', () => 'copy');

		expect(settings.profiles.length).toBe(2);
		expect(settings.activeProfileId).toBe('copy');
		expect(settings.profiles[1].name).toBe('生产（复制）');
		expect(settings.profiles[1].apiKey).toBe('sk-prod');
	});

	test('removes a profile and keeps one active profile', () => {
		const current = normalizeSettings({
			profiles: [
				{ ...DEFAULT_SETTINGS.profiles[0], id: 'first', name: 'First' },
				{ ...DEFAULT_SETTINGS.profiles[0], id: 'second', name: 'Second' }
			],
			activeProfileId: 'second'
		});

		const settings = removeProfile(current, 'second');

		expect(settings.profiles.length).toBe(1);
		expect(settings.activeProfileId).toBe('first');
	});

	test('removes a profile without rewriting the remaining profile draft name', () => {
		const current: AppSettings = {
			...DEFAULT_SETTINGS,
			profiles: [
				{ ...DEFAULT_SETTINGS.profiles[0], id: 'draft', name: '' },
				{ ...DEFAULT_SETTINGS.profiles[0], id: 'remove-me', name: 'Remove Me' }
			],
			activeProfileId: 'remove-me'
		};

		const settings = removeProfile(current, 'remove-me');

		expect(settings.profiles.length).toBe(1);
		expect(settings.profiles[0].name).toBe('');
		expect(settings.activeProfileId).toBe('draft');
	});

	test('does not remove the final profile', () => {
		const settings = removeProfile(DEFAULT_SETTINGS, DEFAULT_SETTINGS.activeProfileId);

		expect(settings.profiles.length).toBe(1);
		expect(settings.activeProfileId).toBe(DEFAULT_SETTINGS.activeProfileId);
	});
});

describe('getTaskReuseProfile', () => {
	test('returns null when temporary reuse is disabled', () => {
		const settings = normalizeSettings({
			reuseTaskApiProfileTemporarily: false,
			profiles: [{ ...DEFAULT_SETTINGS.profiles[0], id: 'source' }]
		});

		expect(getTaskReuseProfile(settings, { apiProfileId: 'source' })).toBe(null);
	});

	test('prefers the saved API profile id when available', () => {
		const settings = normalizeSettings({
			reuseTaskApiProfileTemporarily: true,
			profiles: [
				{ ...DEFAULT_SETTINGS.profiles[0], id: 'active', name: 'Active' },
				{ ...DEFAULT_SETTINGS.profiles[0], id: 'source', name: 'Source', model: 'source-model' }
			]
		});

		expect(getTaskReuseProfile(settings, { apiProfileId: 'source' })?.id).toBe('source');
	});

	test('falls back to provider, mode, and model when profile id is gone', () => {
		const settings = normalizeSettings({
			reuseTaskApiProfileTemporarily: true,
			profiles: [
				{ ...DEFAULT_SETTINGS.profiles[0], id: 'active', name: 'Active', model: 'gpt-image-2' },
				{ ...DEFAULT_SETTINGS.profiles[0], id: 'matching', name: 'Matching', apiMode: 'responses', model: 'gpt-5.5' }
			]
		});

		expect(
			getTaskReuseProfile(settings, {
				apiProfileId: 'deleted-profile',
				apiProvider: 'openai',
				apiMode: 'responses',
				model: 'gpt-5.5'
			})?.id
		).toBe('matching');
	});
});
