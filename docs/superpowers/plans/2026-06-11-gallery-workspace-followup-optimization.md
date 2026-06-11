# Gallery Workspace Follow-up Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the remaining Gallery Workspace optimizations: incremental task loading, safer task state updates, more focused UI modules, bounded cleanup work, and a leaner task card API.

**Architecture:** Add storage pagination primitives first, then connect the gallery to incremental hydration. Move repeated task-state mutations into pure domain helpers with tests. Extract remaining large UI chunks into Svelte components and keep parent-owned side effects in `GalleryWorkspace.svelte`. Bound background image cleanup through a small concurrency queue.

**Tech Stack:** Svelte 5, SvelteKit, Bun test, Tauri SQLite plugin, existing shadcn-svelte UI wrappers.

---

### Task 1: DB-backed incremental task loading

**Files:**

- Modify: `src/lib/storage/gallery-db.ts`
- Modify: `src/lib/storage/gallery-db.test.ts`
- Modify: `src/lib/components/gallery/GalleryWorkspace.svelte`

- [x] Add tested SQL helpers for paged task rows and total task count.
- [x] Add `loadStoredTasksPage({ offset, limit })` for SQLite-backed incremental hydration.
- [x] Hydrate only the first task page on app start when SQLite is available.
- [x] Load the next SQLite page when the user clicks “加载更多”.
- [x] Preserve legacy localStorage fallback behavior.

### Task 2: Task state helpers

**Files:**

- Create: `src/lib/domain/task-state.ts`
- Create: `src/lib/domain/task-state.test.ts`
- Modify: `src/lib/components/gallery/GalleryWorkspace.svelte`

- [x] Add pure helpers for update-by-id, partial-image updates, finish/error updates, and removals.
- [x] Replace scattered `tasks.map(...)` state transitions in `GalleryWorkspace.svelte`.
- [x] Keep Agent and Gallery behavior unchanged.

### Task 3: Bounded image cleanup queue

**Files:**

- Modify: `src/lib/storage/task-file-cleanup.ts`
- Modify: `src/lib/storage/task-file-cleanup.test.ts`

- [x] Run task image cleanup with bounded concurrency.
- [x] Preserve per-task failure counting.
- [x] Keep background cleanup behavior in `GalleryWorkspace.svelte` unchanged.

### Task 4: Composer and import/export extraction

**Files:**

- Create: `src/lib/components/gallery/GalleryComposer.svelte`
- Create: `src/lib/components/gallery/gallery-import-export.ts`
- Modify: `src/lib/components/gallery/GalleryWorkspace.svelte`

- [x] Move the bottom prompt/reference/parameter form into `GalleryComposer.svelte`.
- [x] Move import/export/backup helpers into `gallery-import-export.ts`.
- [x] Keep side effects such as toasts and persistence in the parent.

### Task 5: TaskCard view model

**Files:**

- Create: `src/lib/components/gallery/task-card-view-model.ts`
- Create: `src/lib/components/gallery/task-card-view-model.test.ts`
- Modify: `src/lib/components/gallery/TaskCard.svelte`
- Modify: `src/lib/components/gallery/GalleryWorkspace.svelte`

- [x] Move display strings, preview images, primary image, and action flags into a view model helper.
- [x] Reduce formatter props passed into `TaskCard.svelte`.
- [x] Preserve card selection, context menu, and drag selection attributes.

### Task 6: Final verification

**Files:**

- All modified files.

- [x] Run `bun test`.
- [x] Run `bun run check`.
- [x] Run `bun run lint:oxc`.
- [x] Run `bun run build`.
- [x] Review `git diff --stat` and note unrelated untracked files.
