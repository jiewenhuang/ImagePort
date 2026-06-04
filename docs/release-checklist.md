# ImagePort Release Checklist

## Build Gate

- `bun test`
- `bun run check`
- `bun run build`
- `cargo check` in `src-tauri`
- Manual launch with `bun run tauri dev`

## Data Compatibility

- Existing `imageport.db` loads Gallery tasks.
- Existing App Support `images/**` files remain untouched during app launch.
- Full backup ZIP restores tasks, settings, images, masks, partial images, and Agent conversations.
- Clear/cleanup actions only run after explicit user confirmation.
- ZIP download strategy toggles are reflected in task cards, task detail, selection, Lightbox, favorite collections, and Agent rounds.

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
