<script lang="ts">
	import { ContextMenu as ContextMenuPrimitive } from "bits-ui";

	let { ref = $bindable(null), ...restProps }: ContextMenuPrimitive.TriggerProps = $props();
</script>

<ContextMenuPrimitive.Trigger bind:ref {...restProps} />
