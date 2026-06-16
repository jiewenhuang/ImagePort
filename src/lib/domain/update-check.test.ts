import { describe, expect, test } from 'bun:test';
import { checkForGitHubUpdate, compareVersions, GITHUB_RELEASES_API_URL } from './update-check';

describe('update check', () => {
	test('compares semantic versions with optional v prefixes', () => {
		expect(compareVersions('v0.1.7', '0.1.6')).toBe(1);
		expect(compareVersions('0.1.6', 'v0.1.6')).toBe(0);
		expect(compareVersions('0.1.5', '0.1.6')).toBe(-1);
	});

	test('reports an available GitHub release update', async () => {
		const result = await checkForGitHubUpdate({
			currentVersion: '0.1.6',
			fetcher: async (url) => {
				expect(url).toBe(GITHUB_RELEASES_API_URL);
				return {
					ok: true,
					status: 200,
					json: async () => ({
						tag_name: 'v0.1.7',
						name: 'ImagePort 0.1.7',
						html_url: 'https://github.com/jiewenhuang/ImagePort/releases/tag/v0.1.7',
						body: 'Fixes and improvements.',
						published_at: '2026-06-16T00:00:00Z'
					})
				};
			}
		});

		expect(result.status).toBe('update-available');
		expect(result.latest.version).toBe('0.1.7');
		expect(result.latest.releaseUrl).toBe('https://github.com/jiewenhuang/ImagePort/releases/tag/v0.1.7');
	});

	test('reports up to date when the latest release is not newer', async () => {
		const result = await checkForGitHubUpdate({
			currentVersion: '0.1.6',
			fetcher: async () => ({
				ok: true,
				status: 200,
				json: async () => ({ tag_name: 'v0.1.6', html_url: 'https://example.com/release' })
			})
		});

		expect(result.status).toBe('up-to-date');
		expect(result.latest.version).toBe('0.1.6');
	});

	test('throws when GitHub does not return a usable release', async () => {
		let message = '';
		try {
			await checkForGitHubUpdate({
				currentVersion: '0.1.6',
				fetcher: async () => ({ ok: true, status: 200, json: async () => ({}) })
			});
		} catch (err) {
			message = err instanceof Error ? err.message : String(err);
		}

		expect(message).toBe('无法读取最新版本');
	});
});
