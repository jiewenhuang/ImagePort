import { describe, expect, test } from 'bun:test';
import {
	DEFAULT_SETTINGS,
	addApiProfile,
	addOpenAIProfile,
	duplicateProfile,
	getApiProviderLabel,
	getActiveProfile,
	importCustomProviderDefinitionFromJson,
	getProfileRequestBlockReason,
	getTaskReuseProfile,
	getWorkspaceProfile,
	removeCustomProvider,
	normalizeAgentImageRoutingStrategy,
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
		expect(settings.profiles[0].apiProtocol).toBe('openai-images');
		expect(settings.clearInputAfterSubmit).toBe(false);
		expect(settings.persistInputOnRestart).toBe(true);
		expect(settings.reuseTaskApiProfileTemporarily).toBe(false);
		expect(settings.alwaysShowRetryButton).toBe(true);
		expect(settings.agentMaxToolRounds).toBe(15);
		expect(settings.agentAutoScroll).toBe(true);
		expect(settings.agentWebSearch).toBe(false);
		expect(settings.agentImageRoutingStrategy).toBe('auto');
		expect(settings.zipDownloadRoutes.includes('task-detail-all')).toBe(true);
		expect(settings.favoriteCollections[0].id).toBe('favorites-default');
		expect(settings.activeFavoriteCollectionId).toBe(null);
		expect(settings.customProviders).toEqual([]);
		expect(settings.workspaceRouting.galleryProfileId).toBe(DEFAULT_SETTINGS.activeProfileId);
		expect(settings.workspaceRouting.agentImageProfileId).toBe(null);
		expect(getWorkspaceProfile(settings, 'agent-image').id).toBe(DEFAULT_SETTINGS.activeProfileId);
		expect(settings.schemaVersion).toBe(2);
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
			agentImageRoutingStrategy: 'profile',
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
		expect(settings.agentImageRoutingStrategy).toBe('profile');
		expect(settings.favoriteCollections.map((item) => item.id)).toEqual(['favorites-default', 'work']);
		expect(settings.activeFavoriteCollectionId).toBe('work');
	});
});

describe('workspace routing', () => {
	test('keeps Gallery and Agent profile routes independent', () => {
		const settings = normalizeSettings({
			profiles: [
				{ ...DEFAULT_SETTINGS.profiles[0], id: 'gallery', model: 'image-model' },
				{
					...DEFAULT_SETTINGS.profiles[0],
					id: 'agent',
					model: 'reasoning-model',
					apiMode: 'responses',
					apiProtocol: 'openai-responses'
				}
			],
			workspaceRouting: {
				galleryProfileId: 'gallery',
				agentProfileId: 'agent',
				agentImageProfileId: 'gallery',
				studioScriptProfileId: 'agent',
				studioImageProfileId: 'gallery',
				studioVideoModelId: 'happyhorse-1.1'
			}
		});

		expect(getWorkspaceProfile(settings, 'gallery').id).toBe('gallery');
		expect(getWorkspaceProfile(settings, 'agent').id).toBe('agent');
		expect(getWorkspaceProfile(settings, 'agent-image').id).toBe('gallery');
	});

	test('normalizes Agent image routing strategy values', () => {
		expect(normalizeAgentImageRoutingStrategy('native')).toBe('native');
		expect(normalizeAgentImageRoutingStrategy('profile')).toBe('profile');
		expect(normalizeAgentImageRoutingStrategy('unsupported')).toBe('auto');
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
		const openai = { ...DEFAULT_SETTINGS.profiles[0], apiKey: 'openai-key' };
		const xai = switchApiProfileProvider(openai, 'xai');
		const backToOpenAI = switchApiProfileProvider({ ...xai, apiKey: 'xai-key' }, 'openai');

		expect(backToOpenAI.provider).toBe('openai');
		expect(backToOpenAI.baseUrl).toBe(openai.baseUrl);
		expect(backToOpenAI.model).toBe(openai.model);
		expect(backToOpenAI.apiKey).toBe('openai-key');
		expect(xai.apiKey).toBe('');
	});

	test('creates first-class xAI and Google profiles', () => {
		const xaiSettings = addApiProfile(DEFAULT_SETTINGS, 'xai', () => 'xai-profile');
		const xaiProfile = getActiveProfile(xaiSettings);
		expect(xaiProfile.provider).toBe('xai');
		expect(xaiProfile.baseUrl).toBe('https://api.x.ai/v1');
		expect(xaiProfile.model).toBe('grok-imagine-image-quality');
		expect(xaiProfile.apiProtocol).toBe('xai-imagine');

		const googleSettings = addApiProfile(DEFAULT_SETTINGS, 'google', () => 'google-profile');
		const googleProfile = getActiveProfile(googleSettings);
		expect(googleProfile.provider).toBe('google');
		expect(googleProfile.baseUrl).toBe('https://generativelanguage.googleapis.com/v1beta');
		expect(googleProfile.model).toBe('gemini-3.1-flash-image');
		expect(googleProfile.apiProtocol).toBe('gemini-interactions');
	});

	test('keeps a Gemini model on an explicitly selected OpenAI-compatible protocol', () => {
		const settings = normalizeSettings({
			profiles: [
				{
					...DEFAULT_SETTINGS.profiles[0],
					provider: 'google',
					apiProtocol: 'openai-images',
					baseUrl: 'https://gateway.example.com/v1',
					model: 'gemini-image'
				}
			]
		});

		expect(settings.profiles[0].provider).toBe('google');
		expect(settings.profiles[0].apiProtocol).toBe('openai-images');
		expect(settings.profiles[0].baseUrl).toBe('https://gateway.example.com/v1');
	});

	test('preserves generateContent in saved profiles and provider drafts', () => {
		for (const apiProtocol of ['gemini-generate-content', 'gemini-generate-content-response-format'] as const) {
			const settings = normalizeSettings({
				profiles: [
					{
						...DEFAULT_SETTINGS.profiles[0],
						provider: 'google',
						apiProtocol,
						baseUrl: 'https://gateway.example.com/v1beta',
						model: 'gemini-nano-banana-2.1',
						providerDrafts: { google: { apiProtocol } }
					}
				]
			});
			const restored = normalizeSettings(JSON.parse(JSON.stringify(settings)));
			expect(restored.profiles[0].apiProtocol).toBe(apiProtocol);
			expect(restored.profiles[0].providerDrafts?.google?.apiProtocol).toBe(apiProtocol);
			expect(restored.profiles[0].baseUrl).toBe('https://gateway.example.com/v1beta');
			expect(restored.profiles[0].model).toBe('gemini-nano-banana-2.1');
		}
	});

	test('migrates legacy profiles to their provider-native protocols', () => {
		const settings = normalizeSettings({
			profiles: [
				{
					id: 'legacy-google',
					name: 'Legacy Google',
					provider: 'google',
					baseUrl: 'https://proxy.example.com/v1',
					model: 'gemini-image'
				},
				{
					id: 'legacy-responses',
					name: 'Legacy Responses',
					provider: 'openai',
					apiMode: 'responses',
					baseUrl: 'https://api.openai.com/v1',
					model: 'gpt-5.5'
				}
			]
		});

		expect(settings.profiles[0].apiProtocol).toBe('gemini-interactions');
		expect(settings.profiles[1].apiProtocol).toBe('openai-responses');
	});

	test('normalizes saved provider drafts against each provider protocol list', () => {
		const settings = normalizeSettings({
			profiles: [
				{
					...DEFAULT_SETTINGS.profiles[0],
					providerDrafts: {
						google: {
							apiMode: 'responses',
							apiProtocol: 'openai-responses',
							responseFormatB64Json: true,
							streamImages: true
						},
						xai: { apiProtocol: 'openai-images' }
					}
				}
			]
		});

		expect(settings.profiles[0].providerDrafts?.google?.apiProtocol).toBe('gemini-interactions');
		expect(settings.profiles[0].providerDrafts?.google?.apiMode).toBe('images');
		expect(settings.profiles[0].providerDrafts?.google?.responseFormatB64Json).toBe(false);
		expect(settings.profiles[0].providerDrafts?.google?.streamImages).toBe(false);
		expect(settings.profiles[0].providerDrafts?.xai?.apiProtocol).toBe('openai-images');
	});

	test('clears response_format for protocols that do not support the setting', () => {
		const settings = normalizeSettings({
			profiles: [
				{
					...DEFAULT_SETTINGS.profiles[0],
					apiMode: 'responses',
					apiProtocol: 'openai-responses',
					responseFormatB64Json: true
				}
			]
		});

		expect(settings.profiles[0].responseFormatB64Json).toBe(false);
	});

	test('migrates the previous Responses default model to the current default', () => {
		const settings = normalizeSettings({
			profiles: [
				{
					...DEFAULT_SETTINGS.profiles[0],
					apiMode: 'responses',
					apiProtocol: 'openai-responses',
					model: 'gpt-5.1'
				}
			]
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
		const settings: AppSettings = normalizeSettings({
			apiKey: 'sk-secret',
			s3Storage: {
				accessKeyId: 's3-access',
				secretAccessKey: 's3-secret',
				sessionToken: 's3-session'
			},
			profiles: [
				{
					...DEFAULT_SETTINGS.profiles[0],
					apiKey: 'sk-secret',
					providerDrafts: { xai: { apiKey: 'xai-secret' } }
				}
			]
		});

		const safeExport = serializeSettingsForExport(settings, false);
		const secretExport = serializeSettingsForExport(settings, true);

		expect(safeExport.profiles[0].apiKey).toBe('');
		expect(safeExport.profiles[0].providerDrafts?.xai?.apiKey).toBe('');
		expect(secretExport.profiles[0].apiKey).toBe('sk-secret');
		expect(secretExport.profiles[0].providerDrafts?.xai?.apiKey).toBe('xai-secret');
		expect('s3Storage' in safeExport).toBe(false);
		expect('s3Storage' in secretExport).toBe(false);
	});
});

describe('getProfileRequestBlockReason', () => {
	test('allows images api profiles', () => {
		const settings = normalizeSettings(null);

		expect(getProfileRequestBlockReason(settings.profiles[0])).toBe(null);
	});

	test('blocks OpenAI Images on the Google official API URL', () => {
		const settings = normalizeSettings({
			profiles: [
				{
					...DEFAULT_SETTINGS.profiles[0],
					provider: 'google',
					apiProtocol: 'openai-images',
					baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
					model: 'gemini-image'
				}
			]
		});

		expect(getProfileRequestBlockReason(settings.profiles[0], settings)?.includes('Google 官方地址')).toBe(true);
		expect(
			getProfileRequestBlockReason(
				{ ...settings.profiles[0], baseUrl: 'generativelanguage.googleapis.com/v1beta' },
				settings
			)?.includes('Google 官方地址')
		).toBe(true);
	});

	test('blocks relative or empty API URLs before native requests', () => {
		const profile = DEFAULT_SETTINGS.profiles[0];

		expect(getProfileRequestBlockReason({ ...profile, baseUrl: '' })?.includes('HTTP(S)')).toBe(true);
		expect(getProfileRequestBlockReason({ ...profile, baseUrl: '/v1' })?.includes('HTTP(S)')).toBe(true);
		expect(getProfileRequestBlockReason({ ...profile, baseUrl: 'gateway.example.com/v1' })).toBe(null);
	});

	test('allows responses api gallery requests', () => {
		const settings = normalizeSettings({
			profiles: [{ ...DEFAULT_SETTINGS.profiles[0], apiMode: 'responses', apiProtocol: 'openai-responses' }]
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
				{
					...DEFAULT_SETTINGS.profiles[0],
					id: 'matching',
					name: 'Matching',
					apiMode: 'responses',
					apiProtocol: 'openai-responses',
					model: 'gpt-5.5'
				}
			]
		});

		expect(
			getTaskReuseProfile(settings, {
				apiProfileId: 'deleted-profile',
				apiProvider: 'openai',
				apiMode: 'responses',
				apiProtocol: 'openai-responses',
				model: 'gpt-5.5'
			})?.id
		).toBe('matching');
	});
});
