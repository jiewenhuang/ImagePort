<script lang="ts">
	let { children } = $props();
</script>

<div class="bg-background text-foreground flex min-h-screen flex-col">
	<header
		class="border-border/80 bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky top-0 z-20 border-b backdrop-blur"
	>
		<div class="mx-auto flex h-12 max-w-7xl items-center justify-between px-5">
			<div class="flex items-center gap-3">
				<div class="bg-primary size-7 rounded-md shadow-xs"></div>
				<div>
					<h1 class="text-sm font-semibold tracking-normal">ImagePort</h1>
					<p class="text-muted-foreground text-xs">Gallery desktop preview</p>
				</div>
			</div>
			<div class="text-muted-foreground text-xs">Tauri HTTP bridge enabled</div>
		</div>
	</header>

	<main class="mx-auto flex w-full max-w-7xl flex-1 px-5 py-4">
		{@render children?.()}
	</main>
</div>
