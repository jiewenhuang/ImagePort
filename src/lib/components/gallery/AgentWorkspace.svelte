<script lang="ts">
	import { Download, MessagesSquare, Trash2 } from '@lucide/svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import type { AgentConversation } from '$lib/domain/agent';
	import type { ApiProfile, AppSettings } from '$lib/domain/settings';
	import type { OutputImageCount, TaskRecord } from '$lib/domain/types';

	let {
		agentConversations,
		activeAgentConversation,
		activeAgentTasks,
		activeProfile,
		settings,
		tasks,
		messagesViewport = $bindable(),
		canDownloadRoundZip,
		onCreateConversation,
		onSelectConversation,
		onRemoveConversation,
		onStopRound,
		onRetryRound,
		onContinueRound,
		onDownloadRoundZip,
		onOpenTask,
		formatImageCountRatio,
		getAgentRoundClass,
		getAgentRoundDownloadableTaskCount,
		getAgentRoundLabel,
		getStatusLabel
	}: {
		agentConversations: AgentConversation[];
		activeAgentConversation: AgentConversation | null;
		activeAgentTasks: TaskRecord[];
		activeProfile: ApiProfile;
		settings: AppSettings;
		tasks: TaskRecord[];
		messagesViewport?: HTMLDivElement;
		canDownloadRoundZip: boolean;
		onCreateConversation: () => void;
		onSelectConversation: (conversationId: string) => void;
		onRemoveConversation: (conversationId: string) => void;
		onStopRound: (roundId: string) => void;
		onRetryRound: (roundId: string) => void;
		onContinueRound: (roundId: string) => void;
		onDownloadRoundZip: (roundId: string) => void;
		onOpenTask: (task: TaskRecord) => void;
		formatImageCountRatio: (actualCount: number, expectedCount: OutputImageCount) => string;
		getAgentRoundClass: (roundStatus: string | undefined) => string;
		getAgentRoundDownloadableTaskCount: (roundId: string) => number;
		getAgentRoundLabel: (roundStatus: string | undefined) => string;
		getStatusLabel: (status: TaskRecord['status']) => string;
	} = $props();
</script>

<div
	class="mx-auto grid h-full min-h-0 w-full max-w-7xl grid-cols-[260px_minmax(0,1fr)_320px] gap-4 py-5 max-xl:grid-cols-[220px_minmax(0,1fr)] max-lg:grid-cols-1"
>
	<aside
		data-no-drag-select
		class="border-border bg-card min-h-0 overflow-hidden rounded-lg border shadow-xs max-lg:hidden"
	>
		<div class="border-border flex items-center justify-between border-b p-3">
			<div>
				<h2 class="text-sm font-semibold">Agent 会话</h2>
				<p class="text-muted-foreground text-xs">{agentConversations.length} 个会话</p>
			</div>
			<Button type="button" variant="outline" size="icon-sm" onclick={onCreateConversation} aria-label="新建会话">
				<MessagesSquare class="size-4" />
			</Button>
		</div>
		<div class="min-h-0 overflow-y-auto p-2">
			{#each agentConversations as conversation}
				<button
					type="button"
					class={`mb-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm ${activeAgentConversation?.id === conversation.id ? 'bg-primary/10 text-primary' : 'hover:bg-muted'}`}
					onclick={() => onSelectConversation(conversation.id)}
				>
					<MessagesSquare class="size-4 shrink-0" />
					<span class="min-w-0 flex-1 truncate">{conversation.title}</span>
					<span class="text-muted-foreground text-xs">{conversation.rounds.length}</span>
				</button>
			{/each}
		</div>
	</aside>

	<section class="border-border bg-card flex min-h-0 flex-col overflow-hidden rounded-lg border shadow-xs">
		<header data-no-drag-select class="border-border flex items-center justify-between border-b px-4 py-3">
			<div class="min-w-0">
				<h2 class="truncate text-sm font-semibold">{activeAgentConversation?.title ?? 'Agent'}</h2>
				<p class="text-muted-foreground text-xs">
					{activeProfile.name} · {activeProfile.model} · 最大工具轮数 {settings.agentMaxToolRounds}
				</p>
			</div>
			<div class="flex items-center gap-2">
				<Button type="button" variant="outline" size="sm" onclick={onCreateConversation}>新会话</Button>
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					disabled={!activeAgentConversation}
					onclick={() => activeAgentConversation && onRemoveConversation(activeAgentConversation.id)}
					aria-label="删除会话"
				>
					<Trash2 class="size-4" />
				</Button>
			</div>
		</header>
		<div bind:this={messagesViewport} class="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
			{#if !activeAgentConversation?.messages.length}
				<div
					class="border-border bg-muted/20 flex h-full min-h-96 items-center justify-center rounded-lg border border-dashed p-8 text-center"
				>
					<div>
						<MessagesSquare class="text-muted-foreground mx-auto mb-3 size-8" />
						<p class="font-medium">开始一个 Agent 生成会话</p>
						<p class="text-muted-foreground mt-1 text-sm">
							Agent 通过 Responses API 调用图片工具，输出会沉淀为 Gallery 任务。
						</p>
					</div>
				</div>
			{:else if activeAgentConversation}
				{#each activeAgentConversation.messages as message}
					{@const round = activeAgentConversation.rounds.find((item) => item.id === message.roundId)}
					<div class={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
						<div
							class={`max-w-[78%] rounded-lg border px-3 py-2 text-sm leading-relaxed ${message.role === 'user' ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted/35'}`}
						>
							<div class="flex items-start justify-between gap-3">
								<p class="whitespace-pre-wrap">
									{message.content || (message.role === 'assistant' ? '...' : '')}
								</p>
								{#if message.role === 'assistant' && round}
									<Badge variant="outline" class={`shrink-0 ${getAgentRoundClass(round.status)}`}
										>{getAgentRoundLabel(round.status)}</Badge
									>
								{/if}
							</div>
							{#if message.role === 'assistant' && round}
								<div class="text-muted-foreground mt-2 flex flex-wrap items-center gap-2 text-xs">
									<span>工具 {round.toolCallCount}/{round.maxToolRounds ?? settings.agentMaxToolRounds}</span>
									{#if round.webSearchEnabled}
										<span>Web Search</span>
									{/if}
									{#if round.responseId}
										<span class="max-w-44 truncate">response {round.responseId}</span>
									{/if}
								</div>
								{#if round.error}
									<p class="text-destructive mt-2 text-xs">{round.error}</p>
								{/if}
								{#if round.toolCalls.length}
									<div class="mt-2 flex flex-wrap gap-1">
										{#each round.toolCalls as toolCall}
											<Badge variant="secondary" class="max-w-56 truncate">
												{toolCall.type}{toolCall.status ? ` · ${toolCall.status}` : ''}{toolCall.title
													? ` · ${toolCall.title}`
													: ''}
											</Badge>
										{/each}
									</div>
								{/if}
								<div class="mt-2 flex flex-wrap gap-2">
									{#if round.status === 'running'}
										<Button type="button" variant="outline" size="sm" class="h-7" onclick={() => onStopRound(round.id)}
											>停止</Button
										>
									{:else if round.status === 'error' || round.status === 'canceled'}
										<Button type="button" variant="outline" size="sm" class="h-7" onclick={() => onRetryRound(round.id)}
											>重试</Button
										>
									{:else}
										<Button
											type="button"
											variant="outline"
											size="sm"
											class="h-7"
											onclick={() => onContinueRound(round.id)}>继续</Button
										>
										<Button type="button" variant="ghost" size="sm" class="h-7" onclick={() => onRetryRound(round.id)}
											>再跑一次</Button
										>
									{/if}
									{#if canDownloadRoundZip && getAgentRoundDownloadableTaskCount(round.id) > 0}
										<Button
											type="button"
											variant="ghost"
											size="sm"
											class="h-7"
											onclick={() => onDownloadRoundZip(round.id)}
										>
											<Download class="size-4" />
											下载本轮
										</Button>
									{/if}
								</div>
							{/if}
							{#if message.outputTaskIds?.length}
								<div class="mt-2 grid grid-cols-2 gap-2">
									{#each message.outputTaskIds as taskId}
										{@const task = tasks.find((item) => item.id === taskId)}
										{#if task}
											<button
												type="button"
												class="overflow-hidden rounded-md border bg-background text-left"
												onclick={() => onOpenTask(task)}
											>
												{#if task.images[0] || task.streamPartialImageIds[0]}
													<img
														class="aspect-square w-full object-cover"
														src={task.images[0] ?? task.streamPartialImageIds.at(-1)}
														alt={task.prompt}
													/>
												{:else}
													<div class="text-muted-foreground flex aspect-square items-center justify-center text-xs">
														{getStatusLabel(task.status)}
													</div>
												{/if}
												<div class="p-2 text-xs text-foreground">
													{formatImageCountRatio(task.images.length, task.params.n)}
												</div>
											</button>
										{/if}
									{/each}
								</div>
							{/if}
						</div>
					</div>
				{/each}
			{/if}
		</div>
	</section>

	<aside
		data-no-drag-select
		class="border-border bg-card min-h-0 overflow-hidden rounded-lg border shadow-xs max-xl:hidden"
	>
		<div class="border-border border-b p-3">
			<h2 class="text-sm font-semibold">Agent 图片</h2>
			<p class="text-muted-foreground text-xs">当前会话输出任务</p>
		</div>
		<div class="grid max-h-full gap-2 overflow-y-auto p-3">
			{#each activeAgentTasks as task}
				<button
					type="button"
					class="overflow-hidden rounded-lg border bg-muted/15 text-left"
					onclick={() => onOpenTask(task)}
				>
					{#if task.images[0] || task.streamPartialImageIds[0]}
						<img
							class="aspect-video w-full object-cover"
							src={task.images[0] ?? task.streamPartialImageIds.at(-1)}
							alt={task.prompt}
						/>
					{:else}
						<div class="text-muted-foreground flex aspect-video items-center justify-center text-xs">
							{getStatusLabel(task.status)}
						</div>
					{/if}
					<div class="p-2">
						<p class="line-clamp-2 text-xs font-medium">{task.prompt}</p>
						<p class="text-muted-foreground mt-1 text-xs">
							{formatImageCountRatio(task.images.length, task.params.n)} · {getStatusLabel(task.status)}
						</p>
					</div>
				</button>
			{/each}
		</div>
	</aside>
</div>
