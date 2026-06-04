<script lang="ts">
	let {
		title,
		description,
		checked,
		disabled = false,
		onToggle
	}: {
		title: string;
		description: string;
		checked: boolean;
		disabled?: boolean;
		onToggle: () => void;
	} = $props();
</script>

<div class={`rounded-lg border bg-muted/25 p-3 ${disabled ? 'opacity-60' : ''}`}>
	<div class="flex items-center justify-between gap-4">
		<div>
			<div class="text-sm font-medium">{title}</div>
			<p class="text-muted-foreground mt-1 text-xs leading-relaxed">{description}</p>
		</div>
		<button
			type="button"
			class={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition ${checked ? 'bg-primary' : 'bg-muted-foreground/30'}`}
			role="switch"
			aria-checked={checked}
			aria-label={title}
			disabled={disabled}
			onclick={onToggle}
		>
			<span class={`inline-block size-4 rounded-full bg-background shadow transition ${checked ? 'translate-x-4' : 'translate-x-0.5'}`}></span>
		</button>
	</div>
</div>
