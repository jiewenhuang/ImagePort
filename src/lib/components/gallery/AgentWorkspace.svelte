<script lang="ts">
	import { getTaskOutputCount, getTaskPartialCount } from '$lib/domain/task-media';
	import type { Snippet } from 'svelte';
	import {
		ChevronDown,
		CircleAlert,
		Download,
		GitBranch,
		ImageIcon,
		MessagesSquare,
		Package,
		Palette,
		Pencil,
		Plus,
		Settings,
		Sparkles,
		Trash2
	} from '@lucide/svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Progress } from '$lib/components/ui/progress';
	import { Select } from '$lib/components/ui/select';
	import { sanitizeUnsupportedToolOutput } from '$lib/api/agent-runtime';
	import type { AgentConversation, AgentRound } from '$lib/domain/agent';
	import { getAgentIntentLabel } from '$lib/domain/agent-routing';
	import type { ApiProfile, AppSettings } from '$lib/domain/settings';
	import type { OutputImageCount, TaskRecord } from '$lib/domain/types';

	type AgentTaskFilter = 'all' | 'done' | 'running' | 'partial' | 'error';
	type AgentTaskSort = 'newest' | 'oldest';

	let {
		agentConversations,
		activeAgentConversation,
		activeAgentTasks,
		activeProfile,
		activeImageProfile,
		settings,
		tasks,
		composer,
		messagesViewport = $bindable(),
		canDownloadRoundZip,
		onCreateConversation,
		onSelectConversation,
		onRemoveConversation,
		onRenameConversation,
		onUsePrompt,
		onOpenSettings,
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
		activeImageProfile: ApiProfile;
		settings: AppSettings;
		tasks: TaskRecord[];
		composer: () => ReturnType<Snippet>;
		messagesViewport?: HTMLDivElement;
		canDownloadRoundZip: boolean;
		onCreateConversation: () => void;
		onSelectConversation: (conversationId: string) => void;
		onRemoveConversation: (conversationId: string) => void;
		onRenameConversation: (conversationId: string, title: string) => void;
		onUsePrompt: (prompt: string) => void;
		onOpenSettings: () => void;
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

	let editingTitle = $state(false);
	let titleDraft = $state('');
	let taskFilter = $state<AgentTaskFilter>('all');
	let taskSort = $state<AgentTaskSort>('newest');

	let visibleAgentTasks = $derived.by(() => {
		const filtered = activeAgentTasks.filter((task) => taskFilter === 'all' || task.status === taskFilter);
		return [...filtered].sort((a, b) =>
			taskSort === 'newest' ? b.createdAt - a.createdAt : a.createdAt - b.createdAt
		);
	});
	let activeAgentImageCount = $derived(
		activeAgentTasks.reduce(
			(count, task) =>
				count + getTaskOutputCount(task) + (getTaskOutputCount(task) ? 0 : Math.min(getTaskPartialCount(task), 1)),
			0
		)
	);

	$effect(() => {
		const conversationId = activeAgentConversation?.id;
		if (!conversationId) {
			editingTitle = false;
			titleDraft = '';
			return;
		}
		editingTitle = false;
		titleDraft = activeAgentConversation.title;
	});

	function getRoundDisplayLabel(round: AgentRound) {
		if (round.status !== 'done') return getAgentRoundLabel(round.status);
		return round.intent === 'conversation' ? '已回复' : '生成完成';
	}

	function getRoundDisplayClass(round: AgentRound) {
		return getAgentRoundClass(round.status);
	}

	function getRoundRouteLabel(round: AgentRound) {
		if (round.executionRoute === 'responses') return 'Responses 对话';
		if (round.executionRoute === 'native-image-tool' && round.imageProfileId) {
			const fallbackProfile = settings.profiles.find((profile) => profile.id === round.imageProfileId);
			return `原生工具 → ${fallbackProfile?.model ?? '图片 Profile'}`;
		}
		if (round.executionRoute === 'native-image-tool') return 'Responses 原生图片工具';
		const imageProfile = settings.profiles.find((profile) => profile.id === round.imageProfileId);
		return `独立图片 Profile${imageProfile ? ` · ${imageProfile.model}` : ''}`;
	}

	function getVisibleAssistantContent(content: string) {
		const sanitized = sanitizeUnsupportedToolOutput(content);
		return sanitized.text || (sanitized.unsupportedToolOutput ? '已隐藏不受支持的工具输出。' : '...');
	}

	function getConversationPreview(conversation: AgentConversation) {
		const firstUserMessage = conversation.messages.find((message) => message.role === 'user');
		return firstUserMessage?.content || '开始新的创作';
	}

	function formatConversationTime(timestamp: number) {
		const date = new Date(timestamp);
		const today = new Date();
		if (
			date.getFullYear() === today.getFullYear() &&
			date.getMonth() === today.getMonth() &&
			date.getDate() === today.getDate()
		) {
			return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
		}
		return `${date.getMonth() + 1}月${date.getDate()}日`;
	}

	function beginTitleEdit() {
		if (!activeAgentConversation) return;
		titleDraft = activeAgentConversation.title;
		editingTitle = true;
	}

	function saveTitleEdit() {
		if (!editingTitle || !activeAgentConversation) return;
		const nextTitle = titleDraft.trim();
		editingTitle = false;
		if (!nextTitle || nextTitle === activeAgentConversation.title) return;
		onRenameConversation(activeAgentConversation.id, nextTitle);
	}

	function handleTitleKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			saveTitleEdit();
		}
		if (event.key === 'Escape') {
			editingTitle = false;
			titleDraft = activeAgentConversation?.title ?? '';
		}
	}
</script>

<div data-agent-workspace class="bg-muted/40 h-full min-h-0 w-full px-[10px] pt-[10px] pb-[22px]">
	<div class="border-border/70 bg-background flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border shadow-sm">
		<div
			class="grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 xl:grid-cols-[250px_minmax(0,1fr)_340px] 2xl:grid-cols-[297px_minmax(0,1fr)_460px]"
		>
			<aside
				data-no-drag-select
				class="border-border bg-card hidden min-h-0 flex-col overflow-hidden rounded-xl border shadow-xs xl:flex"
			>
				<div class="p-4 pb-3">
					<Button type="button" variant="outline" class="h-9 w-full justify-start px-3" onclick={onCreateConversation}>
						<MessagesSquare class="size-4" />
						新建会话
						<Plus class="ml-auto size-4" />
					</Button>
				</div>
				<div class="text-muted-foreground px-4 py-1 text-xs font-medium">最近会话</div>
				<div class="min-h-0 flex-1 overflow-y-auto px-3 py-2">
					{#each agentConversations as conversation}
						<Button
							type="button"
							variant={activeAgentConversation?.id === conversation.id ? 'secondary' : 'ghost'}
							class="mb-1 h-auto w-full items-start justify-start gap-3 rounded-xl px-3 py-3 text-left whitespace-normal"
							onclick={() => onSelectConversation(conversation.id)}
						>
							<div
								class={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg ${activeAgentConversation?.id === conversation.id ? 'bg-background/80' : 'bg-muted'}`}
							>
								<MessagesSquare class="size-4" />
							</div>
							<div class="min-w-0 flex-1">
								<div class="flex items-center justify-between gap-2">
									<span class="truncate text-sm font-medium">{conversation.title}</span>
									<span class="text-muted-foreground shrink-0 text-xs"
										>{formatConversationTime(conversation.updatedAt)}</span
									>
								</div>
								<p class="text-muted-foreground mt-0.5 truncate text-xs">{getConversationPreview(conversation)}</p>
							</div>
						</Button>
					{/each}
				</div>
				<div class="border-border border-t px-4 py-4">
					<div class="text-muted-foreground mb-2 flex items-center justify-between text-xs">
						<span>会话数</span>
						<span>{agentConversations.length} / 50</span>
					</div>
					<Progress value={Math.min(agentConversations.length, 50)} max={50} class="h-1.5" />
				</div>
			</aside>

			<div class="grid min-h-0 grid-rows-[minmax(0,1fr)_218px] gap-5">
				<section class="border-border bg-card flex min-h-0 flex-col overflow-hidden rounded-xl border shadow-xs">
					<header data-no-drag-select class="flex h-[76px] shrink-0 items-center justify-between gap-4 px-5 2xl:px-9">
						<div class="min-w-0">
							{#if editingTitle}
								<Input
									bind:value={titleDraft}
									name="agentConversationTitle"
									class="h-8 max-w-64 text-base font-semibold"
									onblur={saveTitleEdit}
									onkeydown={handleTitleKeydown}
								/>
							{:else}
								<div class="flex items-center gap-1.5">
									<h2 class="truncate text-base font-semibold">{activeAgentConversation?.title ?? '新会话'}</h2>
									<Button
										type="button"
										variant="ghost"
										size="icon-xs"
										onclick={beginTitleEdit}
										aria-label="编辑会话标题"
									>
										<Pencil class="size-3.5" />
									</Button>
								</div>
							{/if}
							<p class="text-muted-foreground mt-1 truncate text-xs">
								思考：{activeProfile.model} · 图片：{activeImageProfile.model}
							</p>
						</div>
						<div class="flex shrink-0 items-center gap-2">
							<Button
								type="button"
								variant="outline"
								size="sm"
								class="h-9"
								disabled={!activeAgentConversation}
								onclick={() => activeAgentConversation && onRemoveConversation(activeAgentConversation.id)}
							>
								<Trash2 class="size-4" />
								清空对话
							</Button>
						</div>
					</header>

					<div class="min-h-0 flex-1 px-5 pb-7 2xl:px-[34px]">
						<div
							bind:this={messagesViewport}
							class="border-border/80 h-full min-h-0 overflow-y-auto rounded-xl border bg-background"
						>
							{#if !activeAgentConversation?.messages.length}
								<div class="flex h-full min-h-0 items-center justify-center px-6 py-8 text-center">
									<div class="w-full max-w-[600px] translate-y-2">
										<div
											class="bg-muted/70 border-border mx-auto mb-5 flex size-13 items-center justify-center rounded-full border"
										>
											<MessagesSquare class="size-6" />
										</div>
										<h3 class="text-2xl font-semibold tracking-tight">开始与 Agent 对话</h3>
										<p class="text-muted-foreground mt-2 text-sm">
											描述你想要生成的图片或任务，Agent 会帮助你完成创作。
										</p>
										<div class="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
											<Button
												type="button"
												variant="outline"
												class="h-auto flex-col items-stretch gap-0 rounded-xl px-4 py-3.5 text-left whitespace-normal"
												onclick={() => onUsePrompt('生成一座悬浮在云海中的未来城市全景，清晨柔光，电影级构图。')}
											>
												<div class="flex items-center gap-2 text-sm font-medium">
													<Sparkles class="size-4" />创意场景
												</div>
												<p class="text-muted-foreground mt-1 truncate text-xs">例如：一座悬浮在云中的城堡</p>
											</Button>
											<Button
												type="button"
												variant="outline"
												class="h-auto flex-col items-stretch gap-0 rounded-xl px-4 py-3.5 text-left whitespace-normal"
												onclick={() => onUsePrompt('设计一款温暖、克制的智能桌面设备，柔和材质，产品摄影风格。')}
											>
												<div class="flex items-center gap-2 text-sm font-medium">
													<Package class="size-4" />产品设计
												</div>
												<p class="text-muted-foreground mt-1 truncate text-xs">例如：未来感的智能设备</p>
											</Button>
											<Button
												type="button"
												variant="outline"
												class="h-auto flex-col items-stretch gap-0 rounded-xl px-4 py-3.5 text-left whitespace-normal"
												onclick={() => onUsePrompt('将画面转换为细腻的赛博朋克风格，保留主体轮廓并增强霓虹氛围。')}
											>
												<div class="flex items-center gap-2 text-sm font-medium">
													<Palette class="size-4" />风格转换
												</div>
												<p class="text-muted-foreground mt-1 truncate text-xs">例如：赛博风格的星空</p>
											</Button>
										</div>
									</div>
								</div>
							{:else if activeAgentConversation}
								<div class="space-y-5 p-5">
									{#each activeAgentConversation.messages as message}
										{@const round = activeAgentConversation.rounds.find((item) => item.id === message.roundId)}
										<div class={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
											<div
												class={`max-w-[80%] rounded-xl border px-3.5 py-2.5 text-sm leading-relaxed ${message.role === 'user' ? 'border-primary bg-primary text-primary-foreground' : 'bg-muted/25'}`}
											>
												<div class="flex items-start justify-between gap-3">
													<p class="whitespace-pre-wrap">
														{message.role === 'assistant'
															? getVisibleAssistantContent(message.content)
															: message.content}
													</p>
													{#if message.role === 'assistant' && round}
														<Badge variant="outline" class={`shrink-0 ${getRoundDisplayClass(round)}`}
															>{getRoundDisplayLabel(round)}</Badge
														>
													{/if}
												</div>
												{#if message.role === 'assistant' && round}
													<div class="text-muted-foreground mt-2 flex flex-wrap items-center gap-2 text-xs">
														<span class="inline-flex items-center gap-1"
															><GitBranch class="size-3" />{getRoundRouteLabel(round)}</span
														>
														<span>·</span>
														<span>{getAgentIntentLabel(round.intent)}</span>
													</div>
													{#if round.error}<p class="text-destructive mt-2 text-xs">{round.error}</p>{/if}
													{#if round.toolCalls.length || round.responseId || round.protocolWarning || round.webSearchEnabled}
														<details class="group mt-2 text-xs">
															<summary
																class="text-muted-foreground hover:text-foreground inline-flex cursor-pointer list-none items-center gap-1"
															>
																诊断详情
																<ChevronDown class="size-3 transition-transform group-open:rotate-180" />
															</summary>
															<div class="border-border/70 bg-background/70 mt-2 space-y-2 rounded-lg border p-2.5">
																<div class="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
																	<span
																		>工具 {round.toolCallCount}/{round.maxToolRounds ??
																			settings.agentMaxToolRounds}</span
																	>
																	{#if round.webSearchEnabled}<span>Web Search</span>{/if}
																	{#if round.responseId}<span class="max-w-56 truncate"
																			>Response ID · {round.responseId}</span
																		>{/if}
																</div>
																{#if round.protocolWarning}
																	<p class="text-amber-700 dark:text-amber-400 flex items-start gap-1.5">
																		<CircleAlert class="mt-0.5 size-3.5 shrink-0" />
																		<span>{round.protocolWarning}</span>
																	</p>
																{/if}
																{#if round.toolCalls.length}
																	<div class="flex flex-wrap gap-1">
																		{#each round.toolCalls as toolCall}
																			<Badge variant="secondary" class="max-w-56 truncate">
																				{toolCall.type}{toolCall.status ? ` · ${toolCall.status}` : ''}{toolCall.title
																					? ` · ${toolCall.title}`
																					: ''}
																			</Badge>
																		{/each}
																	</div>
																{/if}
															</div>
														</details>
													{/if}
													<div class="mt-2 flex flex-wrap gap-2">
														{#if round.status === 'running'}
															<Button
																type="button"
																variant="outline"
																size="sm"
																class="h-7"
																onclick={() => onStopRound(round.id)}>停止</Button
															>
														{:else if round.status === 'needs-action'}
															<Button type="button" variant="outline" size="sm" class="h-7" onclick={onOpenSettings}
																><Settings class="size-3.5" />选择图片模型</Button
															>
														{:else if round.status === 'error' || round.status === 'canceled' || round.status === 'partial'}
															<Button
																type="button"
																variant="outline"
																size="sm"
																class="h-7"
																onclick={() => onRetryRound(round.id)}>重试</Button
															>
														{:else}
															<Button
																type="button"
																variant="outline"
																size="sm"
																class="h-7"
																onclick={() => onContinueRound(round.id)}>继续</Button
															>
															<Button
																type="button"
																variant="ghost"
																size="sm"
																class="h-7"
																onclick={() => onRetryRound(round.id)}>再跑一次</Button
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
																<Download class="size-4" />下载本轮
															</Button>
														{/if}
													</div>
												{/if}
												{#if message.outputTaskIds?.length}
													<div class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
														{#each message.outputTaskIds as taskId}
															{@const task = tasks.find((item) => item.id === taskId)}
															{#if task}
																<Button
																	type="button"
																	variant="outline"
																	class="h-auto flex-col items-stretch gap-0 overflow-hidden rounded-lg p-0 text-left whitespace-normal"
																	onclick={() => onOpenTask(task)}
																>
																	{#if task.images[0] || task.streamPartialImageIds[0]}
																		<img
																			class="aspect-square w-full object-cover"
																			src={task.images[0] ?? task.streamPartialImageIds.at(-1)}
																			alt={task.prompt}
																		/>
																	{:else}
																		<div
																			class="text-muted-foreground flex aspect-square items-center justify-center text-xs"
																		>
																			{getStatusLabel(task.status)}
																		</div>
																	{/if}
																	<div class="p-2 text-xs text-foreground">
																		{formatImageCountRatio(getTaskOutputCount(task), task.params.n)}
																	</div>
																</Button>
															{/if}
														{/each}
													</div>
												{/if}
											</div>
										</div>
									{/each}
								</div>
							{/if}
						</div>
					</div>
				</section>

				<div data-agent-composer class="h-[218px] min-h-0">{@render composer()}</div>
			</div>

			<aside
				data-agent-results
				data-no-drag-select
				class="border-border bg-card hidden min-h-0 flex-col overflow-hidden rounded-xl border shadow-xs xl:flex"
			>
				<div class="shrink-0 px-5 pt-4 pb-4">
					<div class="mb-4 flex items-center gap-2">
						<h2 class="text-base font-semibold">Agent 图片</h2>
						<Badge variant="secondary" class="rounded-full px-2 font-normal">{activeAgentImageCount}</Badge>
					</div>
					<div class="flex items-center gap-3">
						<Select
							bind:value={taskFilter}
							name="agentTaskFilter"
							class="h-9 min-w-0 basis-0 rounded-lg text-xs"
							style="flex: 1.45 1 0%"
							aria-label="筛选 Agent 图片任务"
						>
							<option value="all">全部任务</option>
							<option value="done">已完成</option>
							<option value="running">生成中</option>
							<option value="partial">部分完成</option>
							<option value="error">失败</option>
						</Select>
						<Select
							bind:value={taskSort}
							name="agentTaskSort"
							class="h-9 min-w-0 flex-1 rounded-lg text-xs"
							aria-label="排序 Agent 图片任务"
						>
							<option value="newest">最新优先</option>
							<option value="oldest">最早优先</option>
						</Select>
					</div>
				</div>

				{#if visibleAgentTasks.length === 0}
					<div
						class="border-border/80 mt-0 mr-4 mb-[26px] ml-4 flex min-h-0 flex-1 items-center justify-center rounded-xl border border-dashed px-6 text-center"
					>
						<div class="-translate-y-[76px]">
							<ImageIcon class="text-muted-foreground/40 mx-auto mb-5 size-10" />
							<p class="text-muted-foreground text-base font-medium">暂无图片</p>
							<p class="text-muted-foreground mt-2 text-sm">
								{activeAgentTasks.length ? '没有符合当前筛选的图片' : '生成的图片将显示在这里'}
							</p>
						</div>
					</div>
				{:else}
					<div class="grid min-h-0 flex-1 auto-rows-max grid-cols-2 gap-3 overflow-y-auto p-4 pt-0">
						{#each visibleAgentTasks as task}
							<Button
								type="button"
								variant="outline"
								class="h-auto flex-col items-stretch gap-0 overflow-hidden rounded-xl p-0 text-left whitespace-normal"
								onclick={() => onOpenTask(task)}
							>
								{#if task.images[0] || task.streamPartialImageIds[0]}
									<img
										class="aspect-square w-full object-cover"
										src={task.images[0] ?? task.streamPartialImageIds.at(-1)}
										alt={task.prompt}
									/>
								{:else}
									<div
										class="text-muted-foreground flex aspect-square w-full items-center justify-center bg-muted/40 text-xs"
									>
										{getStatusLabel(task.status)}
									</div>
								{/if}
								<div class="min-w-0 p-3">
									<p class="line-clamp-2 text-xs font-medium">{task.prompt}</p>
									<p class="text-muted-foreground mt-1 text-xs">
										{formatImageCountRatio(getTaskOutputCount(task), task.params.n)} · {getStatusLabel(task.status)}
									</p>
								</div>
							</Button>
						{/each}
					</div>
				{/if}
			</aside>
		</div>
	</div>
</div>
