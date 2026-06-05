import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

function readComponent(fileName: string) {
	return readFileSync(new URL(`./${fileName}`, import.meta.url), 'utf8');
}

describe('image action context menus', () => {
	test('render above task detail and lightbox overlays', () => {
		const source = readComponent('ImageActionContextMenu.svelte');

		expect(source.includes('class="contents"')).toBe(true);
		expect(source.includes('z-[100]')).toBe(true);
	});

	test('are available inside the lightbox image viewport', () => {
		const source = readComponent('GalleryLightbox.svelte');

		expect(source.includes("import ImageActionContextMenu from './ImageActionContextMenu.svelte'")).toBe(true);
		expect(source.includes('<ImageActionContextMenu')).toBe(true);
		expect(source.includes('onDownload={downloadCurrent}')).toBe(true);
		expect(source.includes('onCopy={copyCurrent}')).toBe(true);
	});

	test('leave right click available when the lightbox image is zoomed', () => {
		const source = readComponent('GalleryLightbox.svelte');

		expect(source.includes('event.button !== 0')).toBe(true);
	});
});

describe('image preview navigation controls', () => {
	test('do not combine active button translation with transform-based centering', () => {
		const taskDetailSource = readComponent('TaskDetailModal.svelte');
		const lightboxSource = readComponent('GalleryLightbox.svelte');

		expect(taskDetailSource.includes('-translate-y-1/2')).toBe(false);
		expect(lightboxSource.includes('-translate-y-1/2')).toBe(false);
	});
});
