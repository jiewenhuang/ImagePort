<script lang="ts">
	import { cn, type WithElementRef } from '$lib/utils';
	import type { HTMLSelectAttributes } from 'svelte/elements';

	type SelectProps = WithElementRef<Omit<HTMLSelectAttributes, 'value'>, HTMLSelectElement> & {
		value?: HTMLSelectAttributes['value'];
	};

	let { class: className, ref = $bindable(null), value = $bindable(), children, ...restProps }: SelectProps = $props();
</script>

<select
	bind:this={ref}
	bind:value
	data-slot="select"
	class={cn(
		'border-input bg-background ring-offset-background focus-visible:ring-ring flex h-9 w-full rounded-md border px-3 py-1 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50',
		className
	)}
	{...restProps}
>
	{@render children?.()}
</select>
