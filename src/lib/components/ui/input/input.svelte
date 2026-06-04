<script lang="ts">
	import { cn, type WithElementRef } from '$lib/utils';
	import type { HTMLInputAttributes } from 'svelte/elements';

	type InputProps = WithElementRef<Omit<HTMLInputAttributes, 'value'>, HTMLInputElement> & {
		value?: HTMLInputAttributes['value'];
	};

	let {
		class: className,
		ref = $bindable(null),
		type = 'text',
		value = $bindable(),
		...restProps
	}: InputProps = $props();
</script>

<input
	bind:this={ref}
	bind:value
	data-slot="input"
	{type}
	class={cn(
		'border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex h-9 w-full rounded-md border px-3 py-1 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50',
		className
	)}
	{...restProps}
/>
