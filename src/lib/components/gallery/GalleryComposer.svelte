<script lang="ts">
	import { ChevronDown, ExternalLink, ImagePlus, SendHorizontal, SlidersHorizontal, X } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Select } from '$lib/components/ui/select';
	import { Textarea } from '$lib/components/ui/textarea';
	import type { AgentExecutionRoute, AgentRoundIntent } from '$lib/domain/agent';
	import { getAgentIntentLabel } from '$lib/domain/agent-routing';
	import type { AppSettings, ApiProfile } from '$lib/domain/settings';
	import type { InputImage, MaskDraft, TaskParams } from '$lib/domain/types';
	import ReferenceImageStrip from './ReferenceImageStrip.svelte';

	let {
		appMode,
		embedded = false,
		inputBarHeight = $bindable(0),
		prompt = $bindable(''),
		agentPrompt = $bindable(''),
		params = $bindable(),
		inputImages,
		mask,
		error,
		settings,
		activeProfile,
		agentThinkingProfile,
		agentImageProfile,
		agentIntent,
		agentExecutionRoute,
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
		supportsOutputCompression,
		imageEditSupported,
		imageEditUnsupportedReason,
		maskSupported,
		maskUnsupportedReason,
		onSubmit,
		onPaste,
		onOpenFilePicker,
		onOpenSizePicker,
		onRemoveInputImage,
		onClearInputImages,
		onEditMask,
		onClearMask
	}: {
		appMode: 'gallery' | 'agent';
		embedded?: boolean;
		inputBarHeight?: number;
		prompt: string;
		agentPrompt: string;
		params: TaskParams;
		inputImages: InputImage[];
		mask: MaskDraft | null;
		error: string | null;
		settings: AppSettings;
		activeProfile: ApiProfile;
		agentThinkingProfile: ApiProfile;
		agentImageProfile: ApiProfile;
		agentIntent: AgentRoundIntent;
		agentExecutionRoute: AgentExecutionRoute;
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
		supportsOutputCompression: boolean;
		imageEditSupported: boolean;
		imageEditUnsupportedReason: string | null;
		maskSupported: boolean;
		maskUnsupportedReason: string | null;
		onSubmit: () => void;
		onPaste: (event: ClipboardEvent) => void | Promise<void>;
		onOpenFilePicker: () => void;
		onOpenSizePicker: () => void;
		onRemoveInputImage: (id: string) => void;
		onClearInputImages: () => void;
		onEditMask: (id: string) => void;
		onClearMask: () => void;
	} = $props();

	let showAgentAdvanced = $state(false);

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

	function getAgentRouteSummary() {
		if (agentIntent === 'conversation') return `对话 · ${agentThinkingProfile.model}`;
		const intentLabel = getAgentIntentLabel(agentIntent);
		if (agentExecutionRoute === 'native-image-tool') {
			return `${intentLabel} · ${agentThinkingProfile.model} 原生图片工具`;
		}
		return `${intentLabel} · ${agentImageProfile.name} · ${agentImageProfile.model}`;
	}
</script>

<div
	data-input-bar
	data-embedded={embedded || undefined}
	bind:clientHeight={inputBarHeight}
	class={embedded
		? 'h-full min-h-0 w-full'
		: 'pointer-events-none fixed bottom-4 left-1/2 z-30 w-full max-w-4xl -translate-x-1/2 px-3'}
>
	<div class={embedded ? 'h-full min-h-0 w-full' : 'pointer-events-auto w-full'}>
		<form
			class={embedded
				? 'border-border bg-card flex h-full min-h-0 flex-col rounded-xl border px-3 pt-3 pb-2 shadow-xs'
				: 'border-border bg-card/95 rounded-xl border p-3 shadow-2xl backdrop-blur'}
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
					{onEditMask}
					{onClearMask}
					maxImages={maxInputImages}
					{imageEditSupported}
					{imageEditUnsupportedReason}
					{maskSupported}
					{maskUnsupportedReason}
				/>
			{/if}

			{#if embedded && appMode === 'agent'}
				<div class="mb-2 flex min-h-9 items-center gap-2">
					<div class="text-muted-foreground flex h-9 shrink-0 items-center gap-1.5 text-xs font-medium 2xl:w-[82px]">
						<SlidersHorizontal class="size-3.5" />
						参数设置
					</div>
					<div class="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
						{#if qualityOptions.length}
							<Select
								bind:value={params.quality}
								name="agentQuality"
								class="h-8 min-w-24 flex-1 rounded-lg text-xs 2xl:w-28 2xl:flex-none"
								aria-label="质量"
							>
								{#each qualityOptions as option}
									<option value={option}>质量 {option}</option>
								{/each}
							</Select>
						{/if}
						{#if formatOptions.length}
							<Select
								bind:value={params.output_format}
								name="agentOutputFormat"
								class="h-8 min-w-24 flex-1 rounded-lg text-xs 2xl:w-32 2xl:flex-none"
								aria-label="格式"
							>
								{#each formatOptions as option}
									<option value={option}>格式 {option}</option>
								{/each}
							</Select>
						{/if}
						{#if moderationOptions.length}
							<Select
								bind:value={params.moderation}
								name="agentModeration"
								class="h-8 min-w-24 flex-1 rounded-lg text-xs 2xl:w-32 2xl:flex-none"
								aria-label="审核强度"
							>
								{#each moderationOptions as option}
									<option value={option}>审核 {option}</option>
								{/each}
							</Select>
						{/if}
						{#if supportsOutputCompression}
							<Input
								value={params.output_compression ?? ''}
								name="agentOutputCompression"
								type="number"
								min="0"
								max="100"
								class="h-8 min-w-24 flex-1 rounded-lg text-xs 2xl:w-[120px] 2xl:flex-none"
								placeholder="压缩 auto"
								disabled={params.output_format === 'png'}
								oninput={updateCompression}
							/>
						{/if}
						<Button
							type="button"
							variant="ghost"
							size="sm"
							class="ml-auto h-8 shrink-0 px-2 text-xs"
							aria-expanded={showAgentAdvanced}
							onclick={() => (showAgentAdvanced = !showAgentAdvanced)}
						>
							更多
							<ChevronDown class={`size-3.5 transition-transform ${showAgentAdvanced ? 'rotate-180' : ''}`} />
						</Button>
					</div>
				</div>
				{#if showAgentAdvanced}
					<div class="bg-muted/30 mb-2 grid grid-cols-2 gap-2 rounded-lg p-2">
						<Button
							type="button"
							variant="outline"
							class="h-8 justify-start overflow-hidden px-3 text-xs"
							onclick={onOpenSizePicker}
						>
							<span class="text-muted-foreground mr-1">尺寸</span>
							<span class="truncate">{params.size}</span>
						</Button>
						<Input
							value={activeParams.n}
							name="agentImageCount"
							type={activeParams.n === 'auto' ? 'text' : 'number'}
							min="1"
							max={maxOutputImages}
							class="h-8 rounded-lg text-xs"
							disabled={activeParams.n === 'auto'}
							aria-label="生成数量"
							oninput={updateImageCount}
						/>
					</div>
				{/if}
			{:else}
				<div class="mb-3 flex items-end gap-2 max-lg:flex-col max-lg:items-stretch">
					<div class="text-muted-foreground flex h-9 shrink-0 items-center gap-1.5 text-xs font-medium">
						<SlidersHorizontal class="size-3.5" />
						参数
					</div>
					<div class="grid min-w-0 flex-1 grid-cols-[repeat(auto-fit,minmax(110px,1fr))] gap-2">
						<Button
							type="button"
							variant="outline"
							class="justify-start overflow-hidden px-3 text-xs"
							onclick={onOpenSizePicker}
						>
							<span class="truncate">{params.size}</span>
						</Button>
						{#if qualityOptions.length}
							<Select bind:value={params.quality} name="quality" class="h-9 rounded-lg text-xs" aria-label="质量">
								{#each qualityOptions as option}
									<option value={option}>质量 {option}</option>
								{/each}
							</Select>
						{/if}
						{#if formatOptions.length}
							<Select
								bind:value={params.output_format}
								name="outputFormat"
								class="h-9 rounded-lg text-xs"
								aria-label="格式"
							>
								{#each formatOptions as option}
									<option value={option}>格式 {option}</option>
								{/each}
							</Select>
						{/if}
						{#if moderationOptions.length}
							<Select
								bind:value={params.moderation}
								name="moderation"
								class="h-9 rounded-lg text-xs"
								aria-label="审核强度"
							>
								{#each moderationOptions as option}
									<option value={option}>审核 {option}</option>
								{/each}
							</Select>
						{/if}
						{#if supportsOutputCompression}
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
						{/if}
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
				</div>
			{/if}

			{#if embedded && appMode === 'agent'}
				<div class="relative min-h-24 flex-1 2xl:h-[120px] 2xl:flex-none">
					<Textarea
						value={agentPrompt}
						name="agentPrompt"
						class="bg-muted/25 h-full min-h-24 w-full resize-none rounded-xl pr-14 text-sm shadow-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0"
						placeholder="请输入你的需求，例如：生成一张夏日海滩的日落景色..."
						oninput={(event) => (agentPrompt = (event.currentTarget as HTMLTextAreaElement).value)}
						onkeydown={handlePromptKeydown}
					/>
					<Button
						type="button"
						variant="outline"
						size="icon-sm"
						class="absolute top-2 right-2"
						onclick={onOpenFilePicker}
						disabled={inputImages.length >= maxInputImages}
						aria-label="添加参考图"
					>
						<ImagePlus class="size-4" />
					</Button>
					<Button
						type="submit"
						size="icon-sm"
						class="absolute right-2 bottom-2 shadow-sm"
						disabled={!canSubmitAgent}
						aria-label={activeProfile.apiKey ? '发送 Agent 消息' : '配置 API'}
					>
						<SendHorizontal class="size-4" />
					</Button>
				</div>
			{:else}
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
							<X class="size-4" />
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
			{/if}

			<div class={`flex items-center justify-between gap-3 ${embedded ? 'mt-2 min-h-5' : 'mt-2'}`}>
				<p class="text-muted-foreground truncate text-xs">
					{appMode === 'agent'
						? `${getAgentRouteSummary()}${agentBlockReason ? ` · ${agentBlockReason}` : ` · 最大工具轮数 ${settings.agentMaxToolRounds}${settings.agentWebSearch ? ' · Web Search' : ''}`}`
						: !activeProfile.apiKey
							? '尚未配置 API'
							: profileBlockReason
								? profileBlockReason
								: `${nextGalleryProfileOverrideId ? '临时复用 · ' : ''}${effectiveGalleryProfile.name} · ${effectiveGalleryProfile.model} · ${effectiveGalleryProfile.timeoutSecs}s${effectiveGalleryProfile.responseFormatB64Json ? ' · b64_json' : ''}`}
				</p>
				{#if embedded && appMode === 'agent'}
					<a
						class="text-muted-foreground hover:text-foreground hidden shrink-0 items-center gap-1 text-xs sm:flex"
						href="https://platform.openai.com/docs/api-reference/responses"
						target="_blank"
						rel="noreferrer"
					>
						查看 API 文档
						<ExternalLink class="size-3" />
					</a>
				{:else}
					<p class="text-muted-foreground hidden text-xs sm:block">可粘贴或拖拽图片到窗口</p>
				{/if}
			</div>
			{#if appMode === 'gallery' && effectiveGalleryProfile.provider === 'google' && typeof activeParams.n === 'number' && activeParams.n > 1}
				<p class="mt-1 text-xs text-amber-700 dark:text-amber-400">
					Gemini 将发起 {activeParams.n} 次独立生成请求，并按实际请求计费。
				</p>
			{/if}

			{#if error}
				<div class="border-destructive/30 bg-destructive/10 text-destructive mt-3 rounded-md border px-3 py-2 text-sm">
					{error}
				</div>
			{/if}
		</form>
	</div>
</div>
