<script lang="ts">
	import { Input } from '$lib/components/ui/input';
	import { Select } from '$lib/components/ui/select';
	import SettingSwitch from './SettingSwitch.svelte';
	import {
		normalizeSettings,
		normalizeAgentMaxToolRounds,
		type AppSettings,
		type ReferenceImageEditAction
	} from '$lib/domain/settings';
	let { section, settings = $bindable() }: { section: 'general' | 'agent'; settings: AppSettings } = $props();
	function updateSettings(patch: Partial<AppSettings>) {
		settings = normalizeSettings({ ...settings, ...patch });
	}
	function updateReferenceImageEditAction(event: Event) {
		updateSettings({
			referenceImageEditAction: (event.currentTarget as HTMLSelectElement).value as ReferenceImageEditAction
		});
	}
	function updateAgentMaxToolRounds(event: Event) {
		updateSettings({
			agentMaxToolRounds: normalizeAgentMaxToolRounds((event.currentTarget as HTMLInputElement).value)
		});
	}
	function requestNotificationPermission() {
		if (typeof Notification === 'undefined') return;
		void Notification.requestPermission().then((permission) =>
			updateSettings({ taskCompletionNotification: permission === 'granted' })
		);
	}
</script>

{#if section === 'general'}
	<div class="grid gap-3">
		<SettingSwitch
			title="复用任务时临时使用原配置"
			description="复用历史任务时，如果原 API 配置还存在，会优先用原配置生成。"
			checked={settings.reuseTaskApiProfileTemporarily}
			onToggle={() => updateSettings({ reuseTaskApiProfileTemporarily: !settings.reuseTaskApiProfileTemporarily })}
		/>
		<SettingSwitch
			title="总是显示重试按钮"
			description="任务失败或部分完成时保持复用/重试入口可见。"
			checked={settings.alwaysShowRetryButton}
			onToggle={() => updateSettings({ alwaysShowRetryButton: !settings.alwaysShowRetryButton })}
		/>
		<SettingSwitch
			title="生成后清空输入"
			description="提交任务后清空提示词、参考图和遮罩。"
			checked={settings.clearInputAfterSubmit}
			onToggle={() => updateSettings({ clearInputAfterSubmit: !settings.clearInputAfterSubmit })}
		/>
		<SettingSwitch
			title="重启后保留输入草稿"
			description="保存提示词、参数、参考图和遮罩草稿。"
			checked={settings.persistInputOnRestart}
			onToggle={() => updateSettings({ persistInputOnRestart: !settings.persistInputOnRestart })}
		/>
		<SettingSwitch
			title="Enter 发送"
			description="开启后 Enter 发送，Shift + Enter 换行；关闭后 Ctrl/Command + Enter 暂未接入。"
			checked={settings.enterSubmit}
			onToggle={() => updateSettings({ enterSubmit: !settings.enterSubmit })}
		/>
		<SettingSwitch
			title="任务完成通知"
			description="生成完成时发送系统通知。首次开启会请求浏览器通知权限。"
			checked={settings.taskCompletionNotification}
			onToggle={() =>
				settings.taskCompletionNotification
					? updateSettings({ taskCompletionNotification: false })
					: requestNotificationPermission()}
		/>
		<label class="block space-y-1.5 rounded-lg border bg-muted/25 p-3">
			<span class="text-sm font-medium">参考图编辑默认行为</span>
			<Select
				value={settings.referenceImageEditAction}
				name="referenceImageEditAction"
				onchange={updateReferenceImageEditAction}
			>
				<option value="ask">每次询问</option>
				<option value="add-mask">添加遮罩</option>
				<option value="replace-reference">替换参考图</option>
			</Select>
			<span class="text-muted-foreground text-xs">遮罩编辑会直接打开画笔；替换参考图会清空旧参考图后添加当前图。</span>
		</label>
	</div>
{:else}
	<div class="grid gap-3">
		<label class="block space-y-1.5 rounded-lg border bg-muted/25 p-3">
			<span class="text-sm font-medium">最大工具轮数</span>
			<Input
				value={settings.agentMaxToolRounds}
				name="agentMaxToolRounds"
				type="number"
				min="1"
				max="50"
				oninput={updateAgentMaxToolRounds}
			/>
			<span class="text-muted-foreground text-xs">默认 15，范围 1-50。用于限制 Agent 连续调用工具，避免无限循环。</span>
		</label>
		<SettingSwitch
			title="Agent 回复后自动滚动到底部"
			description="发送消息、收到文字流或 partial 图片时保持最新内容可见。"
			checked={settings.agentAutoScroll}
			onToggle={() => updateSettings({ agentAutoScroll: !settings.agentAutoScroll })}
		/>
		<SettingSwitch
			title="允许 Agent 使用 Web Search"
			description="向 Responses 请求加入 hosted Web Search 工具，让 Agent 可按需检索网页信息。"
			checked={settings.agentWebSearch}
			onToggle={() => updateSettings({ agentWebSearch: !settings.agentWebSearch })}
		/>
		<div class="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs leading-relaxed text-blue-800">
			Agent 当前需要 OpenAI 服务商 + Responses API 配置。会话会持久化到 SQLite，图片结果会同步成为 Gallery 任务。
		</div>
	</div>
{/if}
