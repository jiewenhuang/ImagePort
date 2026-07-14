import {
	type CallApiResult,
	type NativeJsonRequest,
	type NativeMultipartRequest,
	type TaskParams
} from '$lib/domain/types';
import {
	type ApiProfile,
	type AppSettings,
	type CustomProviderDefinition,
	type CustomProviderPollMapping,
	type CustomProviderResultMapping,
	type CustomProviderSubmitMapping
} from '$lib/domain/settings';
import { buildApiUrl } from '$lib/domain/url';
import { getBuiltInImageProtocolAdapter } from './providers/registry';
import {
	buildResponsesImageRequest,
	parseImageStreamEvents,
	parseResponsesImageResponse,
	type ParsedImageStreamEvents
} from './providers/openai-adapter';
import type { BuildProviderRequestGroupInput, ProviderNativeRequest, ProviderRequestGroup } from './providers/types';

export { buildResponsesImageRequest, parseImageStreamEvents, parseResponsesImageResponse };
export type { BuildProviderRequestGroupInput, ParsedImageStreamEvents, ProviderNativeRequest, ProviderRequestGroup };

const MIME_MAP: Record<string, string> = {
	png: 'image/png',
	jpeg: 'image/jpeg',
	webp: 'image/webp'
};

export function buildImageProviderRequestGroup(input: BuildProviderRequestGroupInput): ProviderRequestGroup {
	const customProvider = getCustomProvider(input.settings, input.profile.provider);
	if (customProvider) return buildCustomProviderRequestGroup(input, customProvider);
	const adapter = getBuiltInImageProtocolAdapter(input.profile.apiProtocol);
	if (!adapter) throw new Error(`没有找到接口协议适配器：${input.profile.apiProtocol}`);
	return adapter.buildRequestGroup(input);
}

export function buildCustomProviderRequestGroup(
	input: BuildProviderRequestGroupInput,
	customProvider = getCustomProvider(input.settings, input.profile.provider)
): ProviderRequestGroup {
	if (!customProvider) throw new Error('自定义服务商配置不存在');
	const isEdit = input.inputImages.length > 0;
	const mapping = isEdit ? customProvider.editSubmit : customProvider.submit;
	if (!mapping) throw new Error('当前自定义服务商未配置图像编辑接口');
	const request = buildCustomProviderRequest(mapping, input);
	return {
		provider: customProvider.id,
		requests: [
			{
				kind: request.kind,
				request: request.request as NativeJsonRequest & NativeMultipartRequest,
				parse: (payload) => parseCustomProviderResponse(payload, mapping.result ?? {}, input.params.output_format),
				customAsync:
					mapping.taskIdPath && customProvider.poll ? { submit: mapping, poll: customProvider.poll } : undefined
			} as ProviderNativeRequest
		]
	};
}

export function readCustomTaskId(payload: unknown, mapping: CustomProviderSubmitMapping): string | null {
	const value = getByPath(payload, mapping.taskIdPath);
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function buildCustomPollRequest(
	profile: ApiProfile,
	poll: CustomProviderPollMapping,
	taskId: string
): NativeJsonRequest {
	return {
		url: buildApiUrl(profile.baseUrl, appendQuery(buildTaskPath(poll.path, taskId), poll.query)),
		method: poll.method ?? 'GET',
		headers: {
			Authorization: `Bearer ${profile.apiKey}`
		},
		timeoutSecs: profile.timeoutSecs
	};
}

export function getCustomPollState(
	payload: unknown,
	poll: CustomProviderPollMapping
): 'success' | 'failure' | 'pending' {
	const status = getByPath(payload, poll.statusPath);
	const statusText = typeof status === 'string' ? status : String(status ?? '');
	if (poll.successValues.includes(statusText)) return 'success';
	if (poll.failureValues.includes(statusText)) return 'failure';
	return 'pending';
}

function buildCustomProviderRequest(mapping: CustomProviderSubmitMapping, input: BuildProviderRequestGroupInput) {
	const context = createCustomProviderContext(input);
	const path = appendQuery(mapping.path, renderQuery(mapping.query, context));
	const url = buildApiUrl(input.profile.baseUrl, path);
	const headers = {
		Authorization: `Bearer ${input.profile.apiKey}`
	};
	if ((mapping.contentType ?? 'json') === 'multipart') {
		return {
			kind: 'multipart' as const,
			request: {
				url,
				method: 'POST',
				headers,
				fields: createCustomFields(mapping, context, input.profile.responseFormatB64Json),
				files: createCustomFiles(mapping, input),
				timeoutSecs: input.profile.timeoutSecs
			} satisfies NativeMultipartRequest
		};
	}

	const body = resolveTemplateValue(mapping.body ?? {}, context);
	if (input.profile.responseFormatB64Json && isRecord(body)) body.response_format = 'b64_json';
	return {
		kind: 'json' as const,
		request: {
			url,
			method: mapping.method ?? 'POST',
			headers: {
				...headers,
				'Content-Type': 'application/json'
			},
			body: isRecord(body) ? body : {},
			timeoutSecs: input.profile.timeoutSecs
		} satisfies NativeJsonRequest
	};
}

export function parseCustomProviderResponse(
	payload: unknown,
	result: CustomProviderResultMapping,
	outputFormat: TaskParams['output_format']
): CallApiResult {
	const mime = MIME_MAP[outputFormat] ?? 'image/png';
	const images: string[] = [];
	const imageUrls = (result.imageUrlPaths ?? []).flatMap((path) =>
		getAllByPath(payload, path).filter(
			(value): value is string => typeof value === 'string' && (isHttpUrl(value) || isDataUrl(value))
		)
	);
	for (const path of result.b64JsonPaths ?? []) {
		for (const value of getAllByPath(payload, path)) {
			if (typeof value === 'string' && value.trim()) images.push(normalizeBase64Image(value, mime));
		}
	}
	const rawImageUrls = imageUrls.filter(isHttpUrl);
	if (!images.length && !rawImageUrls.length) {
		throw new Error('接口没有返回可识别的图片数据，请检查自定义服务商的结果提取路径。');
	}
	return {
		images,
		rawImageUrls,
		rawResponsePayload: safeStringify(payload)
	};
}

function createCustomProviderContext(input: BuildProviderRequestGroupInput) {
	return {
		profile: input.profile,
		prompt: input.prompt,
		params: input.params,
		inputImages: {
			dataUrls: input.inputImages.map((image) => image.dataUrl),
			count: input.inputImages.length
		},
		mask: {
			dataUrl: input.mask?.dataUrl
		}
	};
}

function createCustomFields(
	mapping: CustomProviderSubmitMapping,
	context: Record<string, unknown>,
	responseFormatB64Json: boolean
) {
	const resolved = resolveTemplateValue(mapping.body ?? {}, context);
	const record = isRecord(resolved) ? resolved : {};
	if (responseFormatB64Json) record.response_format = 'b64_json';
	const fields: Record<string, string> = {};
	for (const [key, value] of Object.entries(record)) {
		if (value == null) continue;
		if (Array.isArray(value)) {
			value.forEach((item) => {
				if (item != null) fields[key] = String(item);
			});
		} else {
			fields[key] = String(value);
		}
	}
	return fields;
}

function createCustomFiles(mapping: CustomProviderSubmitMapping, input: BuildProviderRequestGroupInput) {
	const files: NativeMultipartRequest['files'] = [];
	for (const file of mapping.files ?? []) {
		if (file.source === 'inputImages') {
			for (const image of input.inputImages) {
				files.push({
					field: file.field,
					fileName: image.name || `${image.id}.png`,
					mime: getDataUrlMime(image.dataUrl) ?? 'image/png',
					dataUrl: image.dataUrl
				});
			}
		}
		if (file.source === 'mask' && input.mask) {
			files.push({
				field: file.field,
				fileName: 'mask.png',
				mime: 'image/png',
				dataUrl: input.mask.dataUrl
			});
		}
	}
	return files;
}

function resolveTemplateValue(value: unknown, context: Record<string, unknown>): unknown {
	if (typeof value === 'string' && value.startsWith('$')) return getByPath(context, value.slice(1));
	if (Array.isArray(value)) {
		return value.map((item) => resolveTemplateValue(item, context)).filter((item) => item != null);
	}
	if (isRecord(value)) {
		return Object.fromEntries(
			Object.entries(value)
				.map(([key, item]) => [key, resolveTemplateValue(item, context)] as const)
				.filter(([, item]) => item != null && (!Array.isArray(item) || item.length > 0))
		);
	}
	return value;
}

function renderQuery(query: Record<string, string> | undefined, context: Record<string, unknown>) {
	if (!query) return undefined;
	return Object.fromEntries(
		Object.entries(query)
			.map(([key, value]) => [key, resolveTemplateValue(value, context)] as const)
			.filter(([, value]) => value != null && String(value).trim().length > 0)
			.map(([key, value]) => [key, String(value)] as const)
	);
}

function appendQuery(path: string, query?: Record<string, string>) {
	if (!query || !Object.keys(query).length) return path;
	const params = new URLSearchParams(query);
	return `${path}${path.includes('?') ? '&' : '?'}${params.toString()}`;
}

function buildTaskPath(path: string, taskId: string) {
	return path.replace(/\{task_id\}/g, encodeURIComponent(taskId)).replace(/\{taskId\}/g, encodeURIComponent(taskId));
}

function getCustomProvider(settings: AppSettings, provider: string): CustomProviderDefinition | null {
	return settings.customProviders.find((item) => item.id === provider) ?? null;
}

function getByPath(source: unknown, path: string | undefined): unknown {
	if (!path) return source;
	return path
		.split('.')
		.filter(Boolean)
		.reduce<unknown>((current, key) => {
			if (current == null) return undefined;
			if (/^\d+$/.test(key) && Array.isArray(current)) return current[Number(key)];
			if (isRecord(current)) return current[key];
			return undefined;
		}, source);
}

function getAllByPath(source: unknown, path: string | undefined): unknown[] {
	if (!path) return [source];
	let current: unknown[] = [source];
	for (const key of path.split('.').filter(Boolean)) {
		const next: unknown[] = [];
		for (const item of current) {
			if (item == null) continue;
			if (key === '*') {
				if (Array.isArray(item)) next.push(...item);
				else if (isRecord(item)) next.push(...Object.values(item));
				continue;
			}
			if (/^\d+$/.test(key) && Array.isArray(item)) {
				next.push(item[Number(key)]);
				continue;
			}
			if (isRecord(item)) next.push(item[key]);
		}
		current = next;
	}
	return current.flatMap((item) => (Array.isArray(item) ? item : [item])).filter((item) => item != null);
}

function normalizeBase64Image(value: string, fallbackMime: string): string {
	return value.startsWith('data:') ? value : `data:${fallbackMime};base64,${value}`;
}

function getDataUrlMime(dataUrl: string) {
	const match = dataUrl.match(/^data:([^;,]+)[;,]/);
	return match?.[1];
}

function isHttpUrl(value: unknown): value is string {
	return typeof value === 'string' && /^https?:\/\//i.test(value);
}

function isDataUrl(value: unknown): value is string {
	return typeof value === 'string' && value.startsWith('data:');
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeStringify(value: unknown) {
	try {
		return JSON.stringify(value);
	} catch {
		return undefined;
	}
}
