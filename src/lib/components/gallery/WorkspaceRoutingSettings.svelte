<script lang="ts">
	import { Bot, Image, Images, PenTool } from '@lucide/svelte';
	import * as Card from '$lib/components/ui/card';
	import { Select } from '$lib/components/ui/select';
	import {
		getWorkspaceProfile,
		type AgentImageRoutingStrategy,
		type AppSettings,
		type WorkspaceApiRouting
	} from '$lib/domain/settings';

	let {
		settings,
		onSettingsChange
	}: {
		settings: AppSettings;
		onSettingsChange: (settings: AppSettings) => void;
	} = $props();

	let agentProfile = $derived(getWorkspaceProfile(settings, 'agent'));
	let agentImageProfile = $derived(getWorkspaceProfile(settings, 'agent-image'));
	let agentImageProfiles = $derived(settings.profiles.filter((profile) => profile.apiMode === 'images'));

	type ProfileRouteKey = Exclude<keyof WorkspaceApiRouting, 'agentImageProfileId'>;

	function updateRoute(key: ProfileRouteKey, profileId: string) {
		onSettingsChange({
			...settings,
			workspaceRouting: { ...settings.workspaceRouting, [key]: profileId }
		});
	}

	function updateAgentImageRoute(profileId: string) {
		onSettingsChange({
			...settings,
			workspaceRouting: {
				...settings.workspaceRouting,
				agentImageProfileId: profileId || null
			}
		});
	}

	function updateAgentImageStrategy(strategy: AgentImageRoutingStrategy) {
		onSettingsChange({ ...settings, agentImageRoutingStrategy: strategy });
	}

	function profileDescription(profileId: string) {
		const profile = settings.profiles.find((item) => item.id === profileId);
		return profile ? `${profile.provider} · ${profile.apiProtocol} · ${profile.model}` : '配置不存在';
	}

	function agentRoutingDescription(strategy: AgentImageRoutingStrategy) {
		if (strategy === 'native') return '始终要求 THINK Profile 调用 Responses 原生图片工具。';
		if (strategy === 'profile') return '所有图片请求直接交给 IMAGE Profile，不经过 Responses 图片工具。';
		return '官方 OpenAI 优先使用原生工具；第三方 Responses 直接交给 IMAGE Profile。';
	}
</script>

<div class="grid gap-4">
	<div class="grid gap-4 lg:grid-cols-2">
		<Card.Root size="sm">
			<Card.Header>
				<div class="flex items-center gap-2">
					<Images class="text-muted-foreground size-4" />
					<Card.Title>Gallery</Card.Title>
				</div>
				<Card.Description>画廊默认使用的图片生成 Profile，单次复用仍可临时覆盖。</Card.Description>
			</Card.Header>
			<Card.Content>
				<label class="block space-y-1.5">
					<span class="text-xs font-medium">默认图片生成</span>
					<Select
						value={settings.workspaceRouting.galleryProfileId}
						aria-label="Gallery 默认图片生成"
						onchange={(event) => updateRoute('galleryProfileId', event.currentTarget.value)}
					>
						{#each settings.profiles as profile (profile.id)}
							<option value={profile.id}>{profile.name} · {profile.model}</option>
						{/each}
					</Select>
					<p class="text-muted-foreground text-xs">{profileDescription(settings.workspaceRouting.galleryProfileId)}</p>
				</label>
			</Card.Content>
		</Card.Root>

		<Card.Root size="sm">
			<Card.Header>
				<div class="flex items-center gap-2">
					<Bot class="text-muted-foreground size-4" />
					<Card.Title>Agent</Card.Title>
				</div>
				<Card.Description>对话推理与图片执行彼此独立，按服务端能力自动选择路径。</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-3">
				<div class="grid gap-3 md:grid-cols-2">
					<label class="block space-y-1.5 rounded-lg border p-3">
						<span class="text-muted-foreground text-[10px] font-medium tracking-wider">01 · THINK</span>
						<span class="flex items-center gap-2 text-xs font-medium"><PenTool class="size-3.5" />对话与任务理解</span>
						<Select
							value={settings.workspaceRouting.agentProfileId}
							aria-label="Agent 思考 Profile"
							onchange={(event) => updateRoute('agentProfileId', event.currentTarget.value)}
						>
							{#each settings.profiles as profile (profile.id)}
								<option value={profile.id}>{profile.name} · {profile.model}</option>
							{/each}
						</Select>
						<p
							class={agentProfile.provider === 'openai' && agentProfile.apiProtocol === 'openai-responses'
								? 'text-muted-foreground text-xs'
								: 'text-destructive text-xs'}
						>
							{agentProfile.provider === 'openai' && agentProfile.apiProtocol === 'openai-responses'
								? `${agentProfile.model} · Responses`
								: 'THINK 需要 OpenAI Responses Profile'}
						</p>
					</label>

					<label class="block space-y-1.5 rounded-lg border p-3">
						<span class="text-muted-foreground text-[10px] font-medium tracking-wider">02 · IMAGE</span>
						<span class="flex items-center gap-2 text-xs font-medium"><Image class="size-3.5" />图片生成与编辑</span>
						<Select
							value={settings.workspaceRouting.agentImageProfileId ?? ''}
							aria-label="Agent 图片执行 Profile"
							onchange={(event) => updateAgentImageRoute(event.currentTarget.value)}
						>
							<option value="">跟随 Gallery · {getWorkspaceProfile(settings, 'gallery').model}</option>
							{#each agentImageProfiles as profile (profile.id)}
								<option value={profile.id}>{profile.name} · {profile.model}</option>
							{/each}
						</Select>
						<p
							class={agentImageProfile.apiMode === 'images'
								? 'text-muted-foreground text-xs'
								: 'text-destructive text-xs'}
						>
							{agentImageProfile.apiMode === 'images'
								? `${settings.workspaceRouting.agentImageProfileId ? agentImageProfile.name : '跟随 Gallery'} · ${agentImageProfile.model}`
								: 'Gallery 当前不是图片 Profile，请单独选择 IMAGE Profile'}
						</p>
					</label>
				</div>

				<div class="bg-muted/25 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
					<div class="min-w-0">
						<p class="text-sm font-medium">图片路由策略</p>
						<p class="text-muted-foreground mt-0.5 text-xs">
							{agentRoutingDescription(settings.agentImageRoutingStrategy)}
						</p>
					</div>
					<Select
						value={settings.agentImageRoutingStrategy}
						class="h-9 w-full sm:w-44"
						aria-label="Agent 图片路由策略"
						onchange={(event) => updateAgentImageStrategy(event.currentTarget.value as AgentImageRoutingStrategy)}
					>
						<option value="auto">自动选择</option>
						<option value="native">强制原生工具</option>
						<option value="profile">强制独立 Profile</option>
					</Select>
				</div>
			</Card.Content>
		</Card.Root>
	</div>
</div>
