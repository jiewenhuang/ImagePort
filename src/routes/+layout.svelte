<script lang="ts">
	import { Toaster } from '$lib/components/ui/sonner';
	import '../app.css';

	let { children } = $props();
</script>

<div class="min-h-screen">
	{@render children()}
	<Toaster position="top-right" richColors closeButton />
</div>
