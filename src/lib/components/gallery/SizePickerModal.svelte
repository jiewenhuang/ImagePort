<script lang="ts">
	import { X } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { calculateImageSize, normalizeImageSize, parseRatio, type SizeTier } from '$lib/domain/size';

	type Mode = 'auto' | 'ratio' | 'resolution';

	const tiers: SizeTier[] = ['1K', '2K', '4K'];
	const ratios = [
		{ label: '1:1', value: '1:1' },
		{ label: '3:2', value: '3:2' },
		{ label: '2:3', value: '2:3' },
		{ label: '16:9', value: '16:9' },
		{ label: '9:16', value: '9:16' },
		{ label: '4:3', value: '4:3' },
		{ label: '3:4', value: '3:4' },
		{ label: '21:9', value: '21:9' }
	];

	const sizeLimitText = '会自动规整到合法尺寸：16 的倍数，最大边长 3840px，宽高比不超过 3:1。';

	let {
		open = $bindable(false),
		currentSize = 'auto',
		onSelect
	}: {
		open?: boolean;
		currentSize?: string;
		onSelect: (size: string) => void;
	} = $props();

	let mode = $state<Mode>('auto');
	let tier = $state<SizeTier>('1K');
	let ratio = $state('1:1');
	let customRatio = $state('16:9');
	let customWidth = $state('1024');
	let customHeight = $state('1024');

	let activeRatio = $derived(ratio === 'custom' ? customRatio : ratio);
	let customRatioValid = $derived(ratio !== 'custom' || Boolean(parseRatio(customRatio)));
	let previewSize = $derived.by(() => {
		if (mode === 'auto') return 'auto';
		if (mode === 'ratio') return calculateImageSize(tier, activeRatio) ?? '';
		const width = Number(customWidth);
		const height = Number(customHeight);
		if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return '';
		return normalizeImageSize(`${width}x${height}`);
	});
	let wasClamped = $derived.by(() => {
		if (mode !== 'resolution' || !previewSize) return false;
		return `${Number(customWidth)}x${Number(customHeight)}` !== previewSize;
	});

	$effect(() => {
		if (open) mode = currentSize === 'auto' ? 'auto' : 'ratio';
	});

	function close() {
		open = false;
	}

	function applySize() {
		if (!previewSize) return;
		onSelect(previewSize);
		close();
	}

	function buttonClass(active: boolean) {
		return active
			? 'border-primary bg-primary text-primary-foreground'
			: 'border-border bg-background text-foreground hover:bg-muted';
	}
</script>

{#if open}
	<div class="fixed inset-0 z-[60] flex items-center justify-center p-4">
		<button type="button" class="absolute inset-0 cursor-default bg-black/30 backdrop-blur-sm" aria-label="关闭尺寸选择" onclick={close}></button>

		<section class="bg-card text-card-foreground relative z-10 flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border shadow-2xl">
			<header class="border-border flex items-start justify-between gap-4 border-b px-5 py-4">
				<div>
					<h2 class="text-base font-semibold">设置图像尺寸</h2>
					<p class="text-muted-foreground mt-1 text-xs">当前：{currentSize || 'auto'}</p>
				</div>
				<Button variant="ghost" size="icon-sm" onclick={close} aria-label="关闭">
					<X class="size-4" />
				</Button>
			</header>

			<div class="min-h-0 flex-1 overflow-y-auto px-5 py-5">
				<div class="bg-muted mb-5 grid grid-cols-3 rounded-lg p-1">
					<button class={`rounded-md px-3 py-2 text-sm font-medium transition ${mode === 'auto' ? 'bg-background shadow-xs' : 'text-muted-foreground hover:text-foreground'}`} onclick={() => (mode = 'auto')}>自动</button>
					<button class={`rounded-md px-3 py-2 text-sm font-medium transition ${mode === 'ratio' ? 'bg-background shadow-xs' : 'text-muted-foreground hover:text-foreground'}`} onclick={() => (mode = 'ratio')}>按比例</button>
					<button class={`rounded-md px-3 py-2 text-sm font-medium transition ${mode === 'resolution' ? 'bg-background shadow-xs' : 'text-muted-foreground hover:text-foreground'}`} onclick={() => (mode = 'resolution')}>自定义宽高</button>
				</div>

				{#if mode === 'auto'}
					<div class="flex min-h-64 items-center justify-center text-center">
						<div>
							<div class="bg-muted mx-auto mb-4 flex size-14 items-center justify-center rounded-lg text-xl">AUTO</div>
							<p class="text-sm font-medium">自动尺寸</p>
							<p class="text-muted-foreground mt-2 text-xs leading-relaxed">不向模型传递具体分辨率，由模型决定生成尺寸。</p>
						</div>
					</div>
				{:else if mode === 'ratio'}
					<div class="space-y-5">
						<section>
							<div class="text-muted-foreground mb-2 text-xs font-medium">基准分辨率</div>
							<div class="grid grid-cols-3 gap-2">
								{#each tiers as item}
									<button class={`rounded-lg border px-3 py-2 text-sm transition ${buttonClass(tier === item)}`} onclick={() => (tier = item)}>
										{item}
									</button>
								{/each}
							</div>
						</section>

						<section>
							<div class="text-muted-foreground mb-2 text-xs font-medium">图像比例</div>
							<div class="grid grid-cols-4 gap-2">
								{#each ratios as item}
									{@const parts = item.value.split(':').map(Number)}
									{@const wide = parts[0] > parts[1]}
									{@const square = parts[0] === parts[1]}
									<button class={`flex flex-col items-center gap-1.5 rounded-lg border px-2 py-2 text-xs transition ${buttonClass(ratio === item.value)}`} onclick={() => (ratio = item.value)}>
										<span class="flex size-5 items-center justify-center">
											<span
												class="rounded-[3px] border border-current opacity-70"
												style={`width:${wide || square ? '100%' : `${(parts[0] / parts[1]) * 100}%`};height:${!wide || square ? '100%' : `${(parts[1] / parts[0]) * 100}%`}`}
											></span>
										</span>
										<span>{item.label}</span>
									</button>
								{/each}
								<button class={`col-span-4 rounded-lg border px-3 py-2 text-sm transition ${buttonClass(ratio === 'custom')}`} onclick={() => (ratio = 'custom')}>
									自定义比例
								</button>
							</div>
						</section>

						{#if ratio === 'custom'}
							<label class="block space-y-1.5">
								<span class="text-muted-foreground text-xs font-medium">输入自定义比例</span>
								<Input bind:value={customRatio} name="customRatio" class={customRatioValid ? '' : 'border-destructive focus-visible:ring-destructive/30'} placeholder="例如 5:4 / 2.39:1" />
							</label>
						{/if}
					</div>
				{:else}
					<div class="space-y-5">
						<div class="grid grid-cols-[1fr_auto_1fr] items-end gap-4">
							<label class="space-y-1.5">
								<span class="text-muted-foreground text-xs font-medium">宽度</span>
								<Input bind:value={customWidth} name="customWidth" type="number" min="1" placeholder="1024" />
							</label>
							<div class="text-muted-foreground pb-2 text-sm">×</div>
							<label class="space-y-1.5">
								<span class="text-muted-foreground text-xs font-medium">高度</span>
								<Input bind:value={customHeight} name="customHeight" type="number" min="1" placeholder="1024" />
							</label>
						</div>
						<div class="border-border bg-muted/50 rounded-lg border px-3 py-3 text-xs leading-relaxed text-muted-foreground">
							{sizeLimitText}
						</div>
					</div>
				{/if}
			</div>

			<footer class="border-border bg-background flex items-center gap-3 border-t px-5 py-4">
				<div class="bg-muted min-w-0 flex-1 rounded-lg px-3 py-2">
					<div class="text-muted-foreground text-xs">将使用</div>
					<div class="font-mono text-lg font-semibold">{previewSize || '尺寸无效'}</div>
					{#if wasClamped}
						<div class="text-muted-foreground mt-1 text-xs">{sizeLimitText}</div>
					{/if}
				</div>
				<Button variant="outline" onclick={close}>取消</Button>
				<Button onclick={applySize} disabled={!previewSize}>确定</Button>
			</footer>
		</section>
	</div>
{/if}
