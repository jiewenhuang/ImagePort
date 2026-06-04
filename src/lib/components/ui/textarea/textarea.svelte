<script lang="ts">
	import { cn, type WithElementRef } from '$lib/utils';
	import type { HTMLTextareaAttributes } from 'svelte/elements';

	type TextareaProps = WithElementRef<Omit<HTMLTextareaAttributes, 'value'>, HTMLTextAreaElement> & {
		value?: HTMLTextareaAttributes['value'];
	};

	let { class: className, ref = $bindable(null), value = $bindable(), ...restProps }: TextareaProps = $props();
</script>

<textarea
	bind:this={ref}
	bind:value
	data-slot="textarea"
	class={cn(
		'border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring min-h-24 w-full rounded-md border px-3 py-2 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50',
		className
	)}
	{...restProps}
></textarea>
