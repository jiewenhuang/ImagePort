<script lang="ts">
	import { ImagePlus, SendHorizontal, SlidersHorizontal } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Select } from '$lib/components/ui/select';
	import { Textarea } from '$lib/components/ui/textarea';
	import type { AppSettings, ApiProfile } from '$lib/domain/settings';
	import type { InputImage, MaskDraft, TaskParams } from '$lib/domain/types';
	import ReferenceImageStrip from './ReferenceImageStrip.svelte';

	let {
		appMode,
		inputBarHeight = $bindable(0),
		prompt = $bindable(''),
		agentPrompt = $bindable(''),
		params = $bindable(),
		inputImages,
		mask,
		error,
		settings,
		activeProfile,
		effectiveGalleryProfile,
		activeParams,
		profileBlockReason,
		agentBlockReason,
		nextGalleryProfileOverrideId,
		canSubmit,
		canSubmitAgent,
		maxInputImages,
		maxOutputImages,
		qualityOptions,
		formatOptions,
		moderationOptions,
		onSubmit,
		onPaste,
		onOpenFilePicker,
		onOpenSizePicker,
		onRemoveInputImage,
		onClearInputImages,
		onEditMask
	}: {
		appMode: 'gallery' | 'agent';
		inputBarHeight?: number;
		prompt: string;
		agentPrompt: string;
		params: TaskParams;
		inputImages: InputImage[];
		mask: MaskDraft | null;
		error: string | null;
		settings: AppSettings;
		activeProfile: ApiProfile;
		effectiveGalleryProfile: ApiProfile;
		activeParams: TaskParams;
		profileBlockReason: string | null;
		agentBlockReason: string | null;
		nextGalleryProfileOverrideId: string | null;
		canSubmit: boolean;
		canSubmitAgent: boolean;
		maxInputImages: number;
		maxOutputImages: number;
		qualityOptions: TaskParams['quality'][];
		formatOptions: TaskParams['output_format'][];
		moderationOptions: TaskParams['moderation'][];
		onSubmit: () => void;
		onPaste: (event: ClipboardEvent) => void | Promise<void>;
		onOpenFilePicker: () => void;
		onOpenSizePicker: () => void;
		onRemoveInputImage: (id: string) => void;
		onClearInputImages: () => void;
		onEditMask: (id: string) => void;
	} = $props();

	function updateImageCount(event: Event) {
		if (params.n === 'auto') return;
		const input = event.currentTarget as HTMLInputElement;
		const numeric = Number(input.value);
		params = {
			...params,
			n: Number.isFinite(numeric) ? Math.min(maxOutputImages, Math.max(1, Math.trunc(numeric))) : 1
		};
	}

	function updateCompression(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const trimmed = input.value.trim();
		if (!trimmed) {
			params = { ...params, output_compression: null };
			return;
		}
		const numeric = Number(trimmed);
		params = {
			...params,
			output_compression: Number.isFinite(numeric) ? Math.min(100, Math.max(0, Math.trunc(numeric))) : null
		};
	}

	function handlePromptKeydown(event: KeyboardEvent) {
		if (!settings.enterSubmit) return;
		if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
		event.preventDefault();
		onSubmit();
	}

	function clearPrompt() {
		if (appMode === 'agent') agentPrompt = '';
		else prompt = '';
	}
</script>

<div
	data-input-bar
	bind:clientHeight={inputBarHeight}
	class="pointer-events-none fixed bottom-4 left-1/2 z-30 w-full max-w-4xl -translate-x-1/2 px-3"
>
	<div class="pointer-events-auto w-full">
		<form
			class="border-border bg-card/95 rounded-xl border p-3 shadow-2xl backdrop-blur"
			onsubmit={(event) => {
				event.preventDefault();
				onSubmit();
			}}
			onpaste={onPaste}
		>
			{#if inputImages.length > 0}
				<ReferenceImageStrip
					images={inputImages}
					{mask}
					onAdd={onOpenFilePicker}
					onRemove={onRemoveInputImage}
					onClear={onClearInputImages}
					onEditMask={onEditMask}
				/>
			{/if}

			<div class="mb-3 grid grid-cols-[auto_repeat(6,minmax(0,1fr))] items-end gap-2 max-lg:grid-cols-3">
				<div class="text-muted-foreground flex h-9 items-center gap-1.5 text-xs font-medium max-lg:col-span-3">
					<SlidersHorizontal class="size-3.5" />
					参数
				</div>
				<Button type="button" variant="outline" class="justify-start overflow-hidden px-3 text-xs" onclick={onOpenSizePicker}>
					<span class="truncate">{params.size}</span>
				</Button>
				<Select bind:value={params.quality} name="quality" class="h-9 rounded-lg text-xs" aria-label="质量">
					{#each qualityOptions as option}
						<option value={option}>质量 {option}</option>
					{/each}
				</Select>
				<Select bind:value={params.output_format} name="outputFormat" class="h-9 rounded-lg text-xs" aria-label="格式">
					{#each formatOptions as option}
						<option value={option}>格式 {option}</option>
					{/each}
				</Select>
				<Select bind:value={params.moderation} name="moderation" class="h-9 rounded-lg text-xs" aria-label="审核强度">
					{#each moderationOptions as option}
						<option value={option}>审核 {option}</option>
					{/each}
				</Select>
				<Input
					value={params.output_compression ?? ''}
					name="outputCompression"
					type="number"
					min="0"
					max="100"
					class="h-9 rounded-lg text-xs"
					placeholder="压缩"
					disabled={params.output_format === 'png'}
					oninput={updateCompression}
				/>
				<Input
					value={activeParams.n}
					name="imageCount"
					type={activeParams.n === 'auto' ? 'text' : 'number'}
					min="1"
					max={maxOutputImages}
					class="h-9 rounded-lg text-xs"
					disabled={activeParams.n === 'auto'}
					aria-label="生成数量"
					oninput={updateImageCount}
				/>
			</div>

			<div class="flex gap-3">
				<Textarea
					value={appMode === 'agent' ? agentPrompt : prompt}
					name="prompt"
					class="max-h-36 min-h-20 flex-1 resize-none rounded-lg border-0 bg-muted/40 p-3 shadow-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0"
					placeholder={appMode === 'agent'
						? '给 Agent 发送图片生成或修改需求...'
						: inputImages.length
							? '描述如何编辑或参考这些图片...'
							: '描述你想生成的图片...'}
					oninput={(event) => {
						if (appMode === 'agent') agentPrompt = (event.currentTarget as HTMLTextAreaElement).value;
						else prompt = (event.currentTarget as HTMLTextAreaElement).value;
					}}
					onkeydown={handlePromptKeydown}
				/>
				<div class="flex w-11 flex-col gap-2">
					<Button
						type="button"
						variant="outline"
						size="icon"
						onclick={onOpenFilePicker}
						disabled={inputImages.length >= maxInputImages}
						aria-label="添加参考图"
					>
						<ImagePlus class="size-4" />
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						onclick={clearPrompt}
						disabled={appMode === 'agent' ? !agentPrompt.trim() : !prompt.trim()}
						aria-label="清空提示词"
					>
						<span class="text-base leading-none">×</span>
					</Button>
					<Button
						type="submit"
						size="icon"
						disabled={appMode === 'agent' ? !canSubmitAgent : !canSubmit}
						aria-label={activeProfile.apiKey ? (appMode === 'agent' ? '发送 Agent 消息' : '生成图像') : '配置 API'}
					>
						<SendHorizontal class="size-4" />
					</Button>
				</div>
			</div>

			<div class="mt-2 flex items-center justify-between gap-3">
				<p class="text-muted-foreground truncate text-xs">
					{!activeProfile.apiKey
						? '尚未配置 API'
						: appMode === 'agent' && agentBlockReason
							? agentBlockReason
							: profileBlockReason
								? profileBlockReason
								: appMode === 'agent'
									? `Agent · 最大工具轮数 ${settings.agentMaxToolRounds}${settings.agentWebSearch ? ' · Web Search' : ''} · ${activeProfile.name} · ${activeProfile.model} · ${activeProfile.timeoutSecs}s${activeProfile.responseFormatB64Json ? ' · b64_json' : ''}`
									: `${nextGalleryProfileOverrideId ? '临时复用 · ' : ''}${effectiveGalleryProfile.name} · ${effectiveGalleryProfile.model} · ${effectiveGalleryProfile.timeoutSecs}s${effectiveGalleryProfile.responseFormatB64Json ? ' · b64_json' : ''}`}
				</p>
				<p class="text-muted-foreground hidden text-xs sm:block">可粘贴或拖拽图片到窗口</p>
			</div>

			{#if error}
				<div class="border-destructive/30 bg-destructive/10 text-destructive mt-3 rounded-md border px-3 py-2 text-sm">
					{error}
				</div>
			{/if}
		</form>
	</div>
</div>
