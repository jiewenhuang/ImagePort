export const GITHUB_REPOSITORY_URL = 'https://github.com/jiewenhuang/ImagePort';
export const GITHUB_RELEASES_API_URL = 'https://api.github.com/repos/jiewenhuang/ImagePort/releases/latest';

export interface GitHubReleaseInfo {
	version: string;
	tagName: string;
	name: string;
	releaseUrl: string;
	body: string | null;
	publishedAt: string | null;
}

export interface UpdateCheckResult {
	status: 'update-available' | 'up-to-date';
	currentVersion: string;
	latest: GitHubReleaseInfo;
}

export interface UpdateCheckInput {
	currentVersion: string;
	fetcher?: UpdateFetch;
}

export type UpdateFetch = (
	url: string,
	init?: RequestInit
) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

export async function checkForGitHubUpdate(input: UpdateCheckInput): Promise<UpdateCheckResult> {
	const fetcher = input.fetcher ?? globalThis.fetch.bind(globalThis);
	const response = await fetcher(GITHUB_RELEASES_API_URL, {
		headers: { Accept: 'application/vnd.github+json' },
		cache: 'no-store'
	});
	if (!response.ok) throw new Error(`检查更新失败：GitHub 返回 ${response.status}`);

	const latest = parseGitHubRelease(await response.json());
	const status = compareVersions(latest.version, input.currentVersion) > 0 ? 'update-available' : 'up-to-date';
	return { status, currentVersion: input.currentVersion, latest };
}

export function compareVersions(left: string, right: string): -1 | 0 | 1 {
	const a = parseVersion(left);
	const b = parseVersion(right);
	for (let index = 0; index < 3; index += 1) {
		if (a.parts[index] > b.parts[index]) return 1;
		if (a.parts[index] < b.parts[index]) return -1;
	}
	if (a.prerelease === b.prerelease) return 0;
	if (!a.prerelease) return 1;
	if (!b.prerelease) return -1;
	return a.prerelease > b.prerelease ? 1 : a.prerelease < b.prerelease ? -1 : 0;
}

function parseGitHubRelease(value: unknown): GitHubReleaseInfo {
	if (!isRecord(value) || typeof value.tag_name !== 'string' || !value.tag_name.trim()) {
		throw new Error('无法读取最新版本');
	}
	const tagName = value.tag_name.trim();
	const releaseUrl =
		typeof value.html_url === 'string' && value.html_url.trim()
			? value.html_url
			: `${GITHUB_REPOSITORY_URL}/releases/tag/${encodeURIComponent(tagName)}`;
	return {
		version: normalizeVersion(tagName),
		tagName,
		name: typeof value.name === 'string' && value.name.trim() ? value.name : tagName,
		releaseUrl,
		body: typeof value.body === 'string' && value.body.trim() ? value.body : null,
		publishedAt: typeof value.published_at === 'string' && value.published_at.trim() ? value.published_at : null
	};
}

function parseVersion(value: string) {
	const [core, prerelease = ''] = normalizeVersion(value).split('-', 2);
	const parts = core.split('.').map((part) => {
		const number = Number.parseInt(part, 10);
		return Number.isFinite(number) ? number : 0;
	});
	while (parts.length < 3) parts.push(0);
	return { parts: parts.slice(0, 3), prerelease };
}

function normalizeVersion(value: string) {
	return value.trim().replace(/^v/iu, '').split('+', 1)[0];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
