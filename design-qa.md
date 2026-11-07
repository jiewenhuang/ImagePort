# ImagePort Agent Workspace Design QA

Date: 2026-08-05\
Implementation: `http://127.0.0.1:4173/`\
Layout reference: `/var/folders/50/0_x6wlnn43zdpcd12dsdmlfm0000gn/T/codex-clipboard-7f3ad34d-fc47-41a9-821e-c1a5f7e87fbd.png`\
Implementation screenshot: `qa/agent-layout-1672-unified-final.png`\
Responsive screenshot: `qa/agent-layout-1024-unified.png`\
Reference/final comparison: `qa/agent-layout-reference-final-comparison.png`\
Viewport and state: `1672 × 941`, light theme, empty Agent conversation; responsive check at `1024 × 768`

The reference is used as a spatial layout baseline only. Its blue accent palette is intentionally not reproduced; the implementation follows ImagePort's existing theme tokens and shadcn-svelte component language.

## Findings

No actionable P0, P1, or P2 differences remain for the requested layout optimization.

- Typography: the existing ImagePort type system is retained. Heading, metadata, helper, and control sizes follow the reference hierarchy without introducing a second product style.
- Spacing and layout rhythm: the desktop workbench measures `297 / 843 / 460 px`, with a `568 px` conversation region and a `218 px` embedded composer. The side rails use the full available height.
- Colors and visual tokens: surfaces use `background`, `card`, `muted`, `primary`, `border`, `foreground`, and semantic destructive tokens. Agent status badges no longer contain hard-coded blue, red, green, amber, or slate palettes.
- Components: Button, Select, Input, Textarea, Badge, Progress, and DropdownMenu are the project's existing shadcn-svelte components. Native layout containers are used only for structure.
- Copy and content: the empty state explains the Agent-to-image relationship, and all three starter cards populate the real composer. Text-only Responses remain valid successful Agent output.

## Full-view comparison evidence

- Reference/final: `qa/agent-layout-reference-final-comparison.png` places the supplied layout reference and the ImagePort implementation side by side at the same `1672 × 941` size.
- Final: `qa/agent-layout-1672-unified-final.png` preserves the reference's three-column workbench and embedded composer while visibly using ImagePort's neutral theme instead of the reference's blue styling.
- Responsive: `qa/agent-layout-1024-unified.png` collapses the auxiliary rails and keeps the conversation and composer available without horizontal or page-level vertical overflow.

## Focused-region comparison evidence

Separate crops were not required because the native-resolution comparison keeps the session rail, dialogue panel, composer controls, prompt starters, and result empty state readable in one frame.

## Comparison history

1. Spatial reconstruction
   - Replaced the shared Gallery shell with an Agent-only workbench.
   - Embedded the composer below the conversation and extended the session/result rails to the workspace bottom.
   - Preserved the right image rail even when a successful Response contains no image tasks.
2. Product-style reconciliation
   - Removed the reference's copied blue/blue-gray emphasis.
   - Replaced Agent-specific status colors with ImagePort theme tokens.
   - Kept controls on the existing shadcn-svelte primitives.
3. Responsive polish
   - At `1024 × 768`, auxiliary rails hide and the central work area remains usable without horizontal overflow.

## Interaction and runtime verification

- Switched from Gallery to Agent and verified the Agent-only workbench after the production build.
- Confirmed the starter-card, advanced-parameter, new-conversation, and clear-conversation interactions.
- Confirmed the empty Agent textarea, persistent zero-image result rail, and no browser console warnings or errors.
- Agent-focused automated tests: `21` passed, `0` failed.
- Svelte diagnostics: `0` errors and `0` warnings.
- OXC lint and production build passed. The existing large-chunk advisory remains unrelated to this layout change.

## Open Questions

None for this scope.

## Follow-up Polish

No blocking follow-up.

final result: passed

---

# ImagePort Studio Design QA

Date: 2026-07-15\
Implementation: `http://localhost:1420/`\
Result: passed for the local interactive prototype

## Product flow under test

`故事稿 → 分秒脚本 → 人物与场景资产 → 首帧审批 → 视频 Take 审批 → 粗剪成片`

The flow is intentionally dependency-aware. A generated result does not silently become an approved upstream asset or enter the final cut.

## Visual evidence

- Primary script view: `qa/studio-timeline-script-refactor.png`
- Character workstation: `qa/studio-character-1440-final.png`
- Shot workstation: `qa/studio-storyboard-inputs-final.png`
- Responsive character layout: `qa/studio-character-1024-bottom.png`
- Responsive shot layout: `qa/studio-storyboard-inputs-1024.png`
- Original flow audit evidence: `qa/audit-studio-flow/`

The implementation keeps ImagePort's existing neutral palette, Inter/system typography, navigation, border language, and shadcn-svelte controls. The Studio workspace reads as a production desk rather than a separate visual product.

## Current information architecture

1. **剧本**
   - `故事稿` owns project premise, visual language, target duration, and scene prose.
   - `分秒脚本` owns second-level visual, camera, action, dialogue, sound, and Shot/Clip mapping.
2. **资产**
   - Character input generates a face anchor plus front/profile/back reference views.
   - Identity versions are immutable after lock; unlocking creates a new draft version.
3. **镜头**
   - Frame prompt and motion prompt are separate.
   - The user must generate, select, and lock a first frame before video generation.
   - Completed Takes remain in review until the user explicitly selects one for the cut.
4. **成片**
   - Only selected Takes render as media.
   - Missing Takes stay visibly marked as planned placeholders.

## Conflict checks

- Studio opens on the script stage, matching the navigation order.
- Stage progress is textual: locked scripts, locked identities, locked first frames, and selected Takes.
- Locked Identity and first-frame inputs are read-only.
- Unlocking Identity V1 creates V2 without changing shots that still bind V1.
- V2 initially labels its inherited V1 references as a baseline; V2 cannot lock until its own all-angle sheet is generated and a master candidate is selected.
- Character copy distinguishes total planned usage from the actual version used by loaded shots.
- Editing a first frame marks old candidates and Takes stale.
- Video generation is disabled until a newly selected first frame is locked.
- Video generation completes as `已完成 · 待选择`; it does not auto-enter the cut.
- Cut export stays disabled until every shot has a selected Take.
- Grok duration copy and constraints use the current `1–15 秒` range.
- Timecoded script locking is blocked when beats overlap, leave gaps, fail to cover the scene duration, or omit a required visual/camera/audio field.
- Statuses in scene, character, and shot lists are readable text rather than color-only dots.

## Responsive checks

- `1440 × 1024`: left index, center workstation, and right inspector remain available.
- `1280 × 720`: the same three-region production layout remains visible.
- `1024 × 768`: regions stack vertically; the primary action and inspector remain reachable.
- Browser runtime log check: no warnings or errors.

## Interaction verification

- Locked SC01's timecoded script and confirmed its fields became read-only.
- Introduced a beat overlap and confirmed the lock action became disabled with a concrete error; restoring the boundary re-enabled locking.
- Unlocked 林默 from Identity V1 to V2 and confirmed SH02 still displayed `林默 V1`.
- Confirmed inherited V1 views could not lock as V2; after generating the V2 sheet, selection remained required before the lock action became available.
- Created a new SH02 first-frame draft and confirmed old candidates became stale and video generation was disabled.
- Generated three candidates, selected B, manually locked it, then confirmed video generation became available.
- Generated Take A and confirmed the cut stayed at `0/3 Takes` while the Take awaited review.
- Selected Take A and confirmed only SH02 became real media in the cut; SH01 and SH03 remained planned placeholders.
- Confirmed preview activates with one Take while MP4 export remains blocked until all shots are resolved.
- Confirmed Studio model routing is `Responses Profile → Images Profile → one video model`; Seedance, HappyHorse, and Grok are mutually exclusive.
- Confirmed the video connection page only renders the provider selected by the current video model.
- Confirmed a real keyframe data URL is compiled into the provider request instead of an `asset://` placeholder.
- Confirmed the shot inspector reports script, identity, location, first-frame, transition, and Take-version continuity separately.

## Automated verification

- `bun test`: 249 passed, 0 failed.
- Studio state tests: 10 passed, 0 failed.
- `bun run check`: 0 errors, 0 warnings.
- `bun run lint:oxc`: passed.
- `bun run build`: passed; Vite reports the existing large-chunk advisory.
- `git diff --check`: passed.
- Full `format:check` still reports four pre-existing files outside the Studio change set; all Studio and newly added shadcn-svelte files are formatted.

## Remaining product scope

Projects, provider jobs, character sheets, and keyframes now persist locally. Script, character, keyframe, and video provider runtimes are wired; completed videos are materialized into the Studio media directory before selection. The first cut exporter concatenates selected local Takes to a silent 1080p/24fps MP4 through FFmpeg. Remaining product scope includes real three-provider end-to-end certification, Grok gateway media proxying, audio/subtitle tracks, transitions, local inpainting, and a bundled FFmpeg sidecar for release builds.

final result: passed
