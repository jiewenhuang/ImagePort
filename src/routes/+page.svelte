<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import GalleryWorkspace from '$lib/components/gallery/GalleryWorkspace.svelte';
	import { DEFAULT_SETTINGS, normalizeSettings, type AppSettings } from '$lib/domain/settings';
	import { readLocalStorageJson } from '$lib/domain/gallery-hydration';
	import { loadStoredSettings, saveStoredSettings } from '$lib/storage/app-store';

	const SETTINGS_STORAGE_KEY = 'imageport.gallery.settings';
	let settings = $state<AppSettings>(normalizeSettings(DEFAULT_SETTINGS));
	let hasHydratedSettings = $state(false);

	onMount(() => {
		let mounted = true;
		void hydrateSettings().then((loaded) => {
			if (mounted) hasHydratedSettings = loaded;
		});
		return () => {
			mounted = false;
		};
	});

	$effect(() => {
		if (!hasHydratedSettings) return;
		localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
		void saveStoredSettings(settings).catch((error) => {
			toast.error('设置保存失败', { description: error instanceof Error ? error.message : String(error) });
		});
	});

	async function hydrateSettings() {
		try {
			const saved = (await loadStoredSettings()) ?? readLocalStorageJson(localStorage, SETTINGS_STORAGE_KEY);
			if (saved) settings = normalizeSettings(saved);
			return true;
		} catch (error) {
			toast.error('设置读取失败，已暂停自动保存', {
				description: error instanceof Error ? error.message : String(error)
			});
			return false;
		}
	}
</script>

<svelte:head>
	<title>ImagePort</title>
</svelte:head>

<GalleryWorkspace bind:settings />
