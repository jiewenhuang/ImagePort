# ImagePort Release Checklist

## Build Gate

- `bun test`
- `bun run check`
- `bun run build`
- `cargo check` in `src-tauri`
- `bun run lint:oxc`
- `cargo fmt --check` in `src-tauri`
- `cargo test --lib` in `src-tauri` for native atomic snapshot commits and rollback.
- `bun qa/image-workbench-sql.ts` for real SQLite preview/update preservation checks.
- `bun run release:check <release-tag>` after selecting the release version.
- Manual launch with `bun run tauri dev`

## Data Compatibility

- Existing `imageport.db` loads Gallery tasks.
- Existing App Support `images/**` files remain untouched during app launch.
- Full backup ZIP restores tasks, settings, images, masks, partial images, and Agent conversations.
- Clear/cleanup actions only run after explicit user confirmation.
- ZIP download strategy toggles are reflected in task cards, task detail, selection, Lightbox, favorite collections, and Agent rounds.
- Import/export/cleanup includes history beyond the first loaded page. Favorites retain original file references and raw provider responses.
- A failed all-history read stops global data operations; missing original files report an error instead of exporting thumbnails.
- Batch task and Agent snapshots commit on one SQLite connection and remain visible after restarting the packaged app.
- Legacy settings import preserves image/Agent profiles and credentials and ignores retired Studio/video/S3 fields.
- Old Studio databases, tables, media, and WebKit data are retained; startup does not initialize Studio or resume video jobs.

## Capability Audit

Current capability scope:

- `dialog:allow-save` for save dialogs.
- `clipboard-manager:allow-write-image` for copying images.
- `store:default` for settings and input drafts.
- `sql:*` limited to local SQLite storage.
- `fs:*` scoped to `$APPLOCALDATA/images/**`.
- Custom HTTP bridge is exposed only through app-owned Tauri commands.
- Streaming HTTP requests support app-owned cancellation by `requestId`.

Before release, re-check that no unused plugin permissions remain.

## macOS Packaging

- Confirm bundle identifier: `run.jiewen.imageport-desktop`.
- Confirm product name: `ImagePort`.
- Replace template icons if needed.
- Prepare signing identity and Apple notarization credentials.
- Verify clipboard image write behavior on a packaged `.app`.
- Verify App Support path compatibility after version upgrade.

## Manual Smoke

- Open Gallery, generate 1 and 2 images.
- Generate with reference image and mask.
- Enable OpenAI streaming and confirm partial images appear.
- Enable OpenAI streaming with reference image and mask, then confirm multipart streaming returns partial/final images.
- Switch to Responses API and generate/edit.
- Import a custom provider manifest and verify sync/poll result parsing.
- Use Agent mode to create a conversation and generate an image task.
- Stop a streaming Agent round and confirm the UI keeps partial images while cancelling the stream request.
- Toggle each ZIP route in settings and confirm the corresponding download entry appears or disappears.
- Export and restore a full backup ZIP.
- Restart during generation; confirm the interrupted task is shown without automatically submitting another request.
- Keep Gallery generation running while switching to Agent, settings, and another history page.

The image-workbench pass is recorded in [image-workbench-validation.md](image-workbench-validation.md). Upgrade and archival details are in [image-workbench-upgrade.md](image-workbench-upgrade.md). GB-scale ZIP export/restore, signed distribution, and Windows/Linux real-device validation require separate coverage.
