# Gallery Workspace Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce `GalleryWorkspace.svelte` complexity while improving task deletion responsiveness and avoiding avoidable work.

**Architecture:** Move pure task-selection and task-card behavior into focused modules/components first. Then isolate persistence and task lifecycle concerns so `GalleryWorkspace.svelte` becomes a coordinator instead of a container for every detail. Keep behavior stable with Bun unit tests and Svelte checks after each slice.

**Tech Stack:** Svelte 5, SvelteKit, Bun test, Tauri plugin APIs, existing shadcn-svelte UI wrappers.

---

### Task 1: Task Selection Helpers

**Files:**

- Create: `src/lib/domain/task-selection.ts`
- Create: `src/lib/domain/task-selection.test.ts`
- Modify: `src/lib/components/gallery/GalleryWorkspace.svelte`

- [x] Write failing tests for toggling ids, inverting visible task selection, and drag rectangle hits.
- [x] Add pure task selection helpers.
- [x] Replace inline selection calculations in `GalleryWorkspace.svelte`.
- [x] Run `bun test src/lib/domain/task-selection.test.ts src/lib/domain/task-gallery.test.ts`.

### Task 2: Selection Bar Component

**Files:**

- Create: `src/lib/components/gallery/TaskSelectionBar.svelte`
- Modify: `src/lib/components/gallery/GalleryWorkspace.svelte`

- [x] Move the selected-task action bar out of `GalleryWorkspace.svelte`.
- [x] Keep `showBulkDeleteDialog` bound from the parent.
- [x] Run `bun run check` and `bun run lint:oxc`.

### Task 3: Task Card Component

**Files:**

- Create: `src/lib/components/gallery/TaskCard.svelte`
- Modify: `src/lib/components/gallery/GalleryWorkspace.svelte`

- [x] Move task card markup, preview rendering, card actions, and card menu into `TaskCard.svelte`.
- [x] Pass parent callbacks for open, retry, favorite, delete, download, copy, reference, and mask edit.
- [x] Keep `data-task-card-id` on the card root for drag selection.
- [x] Run `bun run check`.

### Task 4: Task Deletion Lifecycle

**Files:**

- Modify: `src/lib/components/gallery/GalleryWorkspace.svelte`
- Modify or create tests under `src/lib/domain/` or `src/lib/storage/` if logic is extracted.

- [x] Track active gallery request ids by task id.
- [x] Cancel gallery native requests when deleting a running task.
- [x] Keep existing Agent request cancellation behavior unchanged.
- [x] Run focused API/task tests and `bun run check`.

### Task 5: Background Image Cleanup

**Files:**

- Modify: `src/lib/components/gallery/GalleryWorkspace.svelte`
- Modify: `src/lib/storage/task-file-cleanup.test.ts` if helper behavior changes.

- [x] Make task deletion toast immediately after removing tasks from state and storage.
- [x] Run image file cleanup in the background.
- [x] Show warning only if background cleanup reports failures.
- [x] Keep settings modal manual cleanup behavior unchanged.

### Task 6: Lazy Task Storage Size

**Files:**

- Modify: `src/lib/components/gallery/GalleryWorkspace.svelte`
- Modify: `src/lib/components/gallery/GallerySettingsModal.svelte` only if its API needs to change.
- Test: add or update domain tests if size calculation moves.

- [x] Stop calculating `estimateTasksStorageBytes(tasks)` on every task list mutation.
- [x] Calculate storage size when settings opens and after settings-side data operations.
- [x] Preserve the displayed storage-size value in the settings modal.
- [x] Run `bun run check`.

### Task 7: Gallery Hydration Helpers

**Files:**

- Create: `src/lib/domain/gallery-hydration.ts`
- Create: `src/lib/domain/gallery-hydration.test.ts`
- Modify: `src/lib/components/gallery/GalleryWorkspace.svelte`

- [x] Move legacy localStorage JSON reading into a pure helper.
- [x] Move input draft normalization and input-image filtering into a pure helper.
- [x] Replace inline hydration helpers in `GalleryWorkspace.svelte`.
- [x] Run `bun test src/lib/domain/gallery-hydration.test.ts` and `bun run check`.

### Task 8: Final Verification

**Files:**

- All modified files.

- [x] Run `bun test`.
- [x] Run `bun run check`.
- [x] Run `bun run lint:oxc`.
- [x] Run `bun run build`.
- [x] Review `git diff --stat` and note any unrelated untracked files.
