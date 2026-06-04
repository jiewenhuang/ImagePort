import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type {
	NativeJsonRequest,
	NativeJsonResponse,
	NativeMultipartRequest,
	NativeMultipartStreamRequest,
	NativeStreamRequest
} from '../domain/types';

export function nativeJsonRequest(request: NativeJsonRequest): Promise<NativeJsonResponse> {
	return invoke<NativeJsonResponse>('native_json_request', { request });
}

export function nativeMultipartRequest(request: NativeMultipartRequest): Promise<NativeJsonResponse> {
	return invoke<NativeJsonResponse>('native_multipart_request', { request });
}

export async function nativeMultipartStreamRequest(
	request: NativeMultipartStreamRequest,
	onChunk: (chunk: string) => void
): Promise<NativeJsonResponse> {
	const unlisten = await listen<{ requestId: string; chunk: string }>('imageport://stream-chunk', (event) => {
		if (event.payload.requestId !== request.requestId) return;
		onChunk(event.payload.chunk);
	});
	try {
		return await invoke<NativeJsonResponse>('native_multipart_stream_request', { request });
	} finally {
		unlisten();
	}
}

export async function nativeJsonStreamRequest(
	request: NativeStreamRequest,
	onChunk: (chunk: string) => void
): Promise<NativeJsonResponse> {
	const unlisten = await listen<{ requestId: string; chunk: string }>('imageport://stream-chunk', (event) => {
		if (event.payload.requestId !== request.requestId) return;
		onChunk(event.payload.chunk);
	});
	try {
		return await invoke<NativeJsonResponse>('native_json_stream_request', { request });
	} finally {
		unlisten();
	}
}

export function cancelNativeJsonStreamRequest(requestId: string): Promise<boolean> {
	return cancelNativeRequest(requestId);
}

export function cancelNativeRequest(requestId: string): Promise<boolean> {
	return invoke<boolean>('cancel_native_request', { requestId });
}

export function downloadImageAsDataUrl(url: string, fallbackMime: string): Promise<string> {
	return invoke<string>('download_image_as_data_url', { url, fallbackMime });
}
