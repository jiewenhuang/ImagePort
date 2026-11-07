import type { AgentExecutionRoute, AgentRoundIntent } from './agent';
import type { AgentImageRoutingStrategy } from './settings';
import type { InputImage, MaskDraft } from './types';

const IMAGE_NOUN_PATTERN =
	/图片|图像|插画|海报|头像|壁纸|照片|封面|图标|视觉|画面|logo|image|picture|photo|illustration|poster|portrait|wallpaper|icon|artwork/i;
const VISUAL_IMAGE_DESCRIPTOR_PATTERN =
	/全景|构图|场景|画面|光影|柔光|逆光|摄影|景深|视角|镜头|插画|海报|头像|壁纸|照片|封面|图标|视觉|色调|氛围|渲染|材质|风格|艺术|科幻|赛博|写实|卡通|概念图|产品照|产品摄影|logo|image|picture|photo|illustration|poster|portrait|wallpaper|icon|artwork/i;
const IMAGE_ACTION_PATTERN = /生成|绘制|创作|制作|设计|渲染/i;
const CHINESE_IMAGE_GENERATION_PATTERN =
	/(?:生成|绘制|创作|制作|设计|渲染).{0,32}(?:一张|几张|多张|图片|图像|插画|海报|头像|壁纸|照片|封面|图标|视觉|画面|全景|构图|场景|光影|摄影|镜头|风格|渲染|概念图|产品照|产品摄影|logo)|(?:画|来|出|做).{0,8}(?:一张|几张|多张|一幅|几幅)/i;
const ENGLISH_IMAGE_GENERATION_PATTERN =
	/\b(?:generate|draw|paint|render|illustrate|create|make|design)\b.{0,36}\b(?:image|picture|photo|illustration|poster|portrait|wallpaper|icon|logo|artwork)\b/i;
const DIRECT_DRAWING_REQUEST_PATTERN =
	/(?:帮我|请|给我)?\s*(?:画(?:出|个|一幅|一张)?|绘图|生图|出图|来个)(?!法|面)|\b(?:draw|paint|illustrate)\b/i;
const EDIT_PATTERN =
	/编辑|修改|改成|改为|换成|替换|去掉|移除|删除|增加|添加|调整|重绘|修图|转换为|变成|背景|局部|edit|modify|replace|remove|erase|add|adjust|retouch|transform/i;
const EXPLANATION_QUESTION_PATTERN = /^\s*(?:如何|怎么|怎样|为什么|讲解|解释|介绍|how\s+(?:to|do|does)|why\s+)/i;

export interface ResolveAgentExecutionRouteInput {
	intent: AgentRoundIntent;
	strategy: AgentImageRoutingStrategy;
	agentBaseUrl: string;
}

export function detectAgentRoundIntent(
	prompt: string,
	inputImages: InputImage[] = [],
	mask: MaskDraft | null = null
): AgentRoundIntent {
	const text = prompt.trim();
	if (!text || EXPLANATION_QUESTION_PATTERN.test(text)) return 'conversation';
	const hasImageInput = inputImages.length > 0 || Boolean(mask);
	const asksForEdit = EDIT_PATTERN.test(text);
	if (hasImageInput && asksForEdit) return 'image-edit';
	const asksForImage =
		CHINESE_IMAGE_GENERATION_PATTERN.test(text) ||
		ENGLISH_IMAGE_GENERATION_PATTERN.test(text) ||
		DIRECT_DRAWING_REQUEST_PATTERN.test(text) ||
		(IMAGE_ACTION_PATTERN.test(text) && VISUAL_IMAGE_DESCRIPTOR_PATTERN.test(text)) ||
		(asksForEdit && IMAGE_NOUN_PATTERN.test(text));
	if (!asksForImage) return 'conversation';
	return hasImageInput && asksForEdit ? 'image-edit' : 'image-generate';
}

export function resolveAgentExecutionRoute(input: ResolveAgentExecutionRouteInput): AgentExecutionRoute {
	if (input.intent === 'conversation') return 'responses';
	if (input.strategy === 'native') return 'native-image-tool';
	if (input.strategy === 'profile') return 'image-profile';
	return isOfficialOpenAIResponsesEndpoint(input.agentBaseUrl) ? 'native-image-tool' : 'image-profile';
}

export function isOfficialOpenAIResponsesEndpoint(baseUrl: string): boolean {
	const trimmed = baseUrl.trim();
	if (!trimmed) return false;
	try {
		const url = new URL(/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`);
		return url.hostname.toLowerCase() === 'api.openai.com';
	} catch {
		return false;
	}
}

export function getAgentIntentLabel(intent: AgentRoundIntent): string {
	if (intent === 'image-generate') return '生成图片';
	if (intent === 'image-edit') return '编辑图片';
	return '对话';
}
