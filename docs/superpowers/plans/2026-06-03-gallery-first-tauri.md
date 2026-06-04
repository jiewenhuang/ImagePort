# Gallery First Tauri Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first usable Gallery slice of ImagePort Desktop with shadcn-svelte UI and a Tauri-backed OpenAI-compatible image generation request path.

**Architecture:** Svelte owns the desktop UI, Gallery task state, request form, and response parsing. Rust owns outbound HTTP and image URL downloading so the app is not constrained by browser CORS. The first slice intentionally excludes Agent mode, mask editing, custom providers, and persistent history migration.

**Tech Stack:** SvelteKit SPA, Svelte 5, Tailwind v4, shadcn-svelte, Tauri v2, Rust, reqwest, Bun test.

---

### File Structure

- `src/lib/domain/types.ts`: shared Gallery settings, params, task, and API result types.
- `src/lib/domain/url.ts`: pure API URL normalization and endpoint building.
- `src/lib/api/openai-compatible.ts`: request body construction and response parsing for the Gallery OpenAI-compatible Images API path.
- `src/lib/tauri/http-client.ts`: TypeScript wrapper around Tauri commands.
- `src/lib/components/ui/*`: lightweight shadcn-style controls needed for the first Gallery screen.
- `src/lib/components/shell/AppShell.svelte`: desktop frame and header.
- `src/lib/components/gallery/GalleryWorkspace.svelte`: Gallery form, task submission, and result grid.
- `src/routes/+page.svelte`: renders the Gallery workspace.
- `src-tauri/src/commands/http.rs`: Tauri command handlers exposed to the frontend.
- `src-tauri/src/services/http_client.rs`: Rust HTTP implementation for JSON requests and image downloads.
- `src-tauri/src/lib.rs`: command registration.
- `src-tauri/Cargo.toml`: Rust HTTP dependencies.

### Task 1: Pure URL and Request Tests

**Files:**
- Create: `src/lib/domain/url.test.ts`
- Create: `src/lib/api/openai-compatible.test.ts`
- Create: `src/lib/domain/types.ts`
- Create: `src/lib/domain/url.ts`
- Create: `src/lib/api/openai-compatible.ts`

- [ ] **Step 1: Write failing tests for API URL normalization**

```ts
import { describe, expect, test } from 'bun:test'
import { buildApiUrl, normalizeBaseUrl } from './url'

describe('normalizeBaseUrl', () => {
  test('adds https and v1 when the user enters a host', () => {
    expect(normalizeBaseUrl('api.example.com')).toBe('https://api.example.com')
    expect(buildApiUrl('api.example.com', 'images/generations')).toBe('https://api.example.com/v1/images/generations')
  })

  test('keeps only the path up to v1', () => {
    expect(normalizeBaseUrl('https://api.example.com/openai/v1/images/generations')).toBe('https://api.example.com/openai/v1')
    expect(buildApiUrl('https://api.example.com/openai/v1/images/generations', 'responses')).toBe('https://api.example.com/openai/v1/responses')
  })
})
```

- [ ] **Step 2: Run URL tests and verify RED**

Run: `bun test src/lib/domain/url.test.ts`

Expected: FAIL because `src/lib/domain/url.ts` does not export the requested functions.

- [ ] **Step 3: Implement URL helpers**

```ts
export function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim()
  if (!trimmed) return ''
  const input = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`

  try {
    const url = new URL(input)
    const pathSegments = url.pathname.split('/').filter(Boolean)
    const v1Index = pathSegments.indexOf('v1')
    const normalizedSegments = v1Index >= 0 ? pathSegments.slice(0, v1Index + 1) : pathSegments
    const pathname = normalizedSegments.length ? `/${normalizedSegments.join('/')}` : ''
    return `${url.origin}${pathname}`
  } catch {
    return trimmed.replace(/\/+$/, '')
  }
}

export function buildApiUrl(baseUrl: string, path: string): string {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)
  const endpointPath = path.replace(/^\/+/, '')
  const apiPath = normalizedBaseUrl.endsWith('/v1') ? endpointPath : `v1/${endpointPath}`
  return normalizedBaseUrl ? `${normalizedBaseUrl}/${apiPath}` : `/${apiPath}`
}
```

- [ ] **Step 4: Write failing tests for Images API request and response parsing**

```ts
import { describe, expect, test } from 'bun:test'
import { buildImagesGenerationRequest, parseImagesGenerationResponse } from './openai-compatible'

describe('buildImagesGenerationRequest', () => {
  test('builds a JSON request for text-to-image generation', () => {
    const request = buildImagesGenerationRequest({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-image-2',
      prompt: 'a quiet desktop image generation tool',
      params: {
        size: '1024x1024',
        quality: 'auto',
        output_format: 'png',
        output_compression: null,
        moderation: 'auto',
        n: 1,
      },
    })

    expect(request.url).toBe('https://api.openai.com/v1/images/generations')
    expect(request.method).toBe('POST')
    expect(request.headers.Authorization).toBe('Bearer sk-test')
    expect(request.body).toEqual({
      model: 'gpt-image-2',
      prompt: 'a quiet desktop image generation tool',
      size: '1024x1024',
      quality: 'auto',
      output_format: 'png',
      moderation: 'auto',
    })
  })
})

describe('parseImagesGenerationResponse', () => {
  test('normalizes base64 image payloads into data URLs', () => {
    const parsed = parseImagesGenerationResponse(
      { data: [{ b64_json: 'abc123', revised_prompt: 'revised' }] },
      'png',
    )

    expect(parsed.images).toEqual(['data:image/png;base64,abc123'])
    expect(parsed.revisedPrompts).toEqual(['revised'])
  })
})
```

- [ ] **Step 5: Run API tests and verify RED**

Run: `bun test src/lib/api/openai-compatible.test.ts`

Expected: FAIL because `src/lib/api/openai-compatible.ts` does not export the requested functions.

- [ ] **Step 6: Implement minimal domain types and Images API helpers**

Add `TaskParams`, `ImageGenerationRequestInput`, `NativeJsonRequest`, and `CallApiResult` to `types.ts`. Implement `buildImagesGenerationRequest()` and `parseImagesGenerationResponse()` in `openai-compatible.ts`.

- [ ] **Step 7: Run pure tests and verify GREEN**

Run: `bun test src/lib/domain/url.test.ts src/lib/api/openai-compatible.test.ts`

Expected: PASS.

### Task 2: Tauri HTTP Bridge

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/services/http_client.rs`
- Create: `src-tauri/src/services/mod.rs`
- Create: `src-tauri/src/commands/http.rs`
- Create: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Create: `src/lib/tauri/http-client.ts`

- [ ] **Step 1: Add Rust dependencies**

Add `reqwest = { version = "0.13.4", features = ["json", "multipart"] }` and `base64 = "0.22.1"` to `src-tauri/Cargo.toml`.

- [ ] **Step 2: Implement JSON request command**

Create a `native_json_request` command accepting `url`, `method`, `headers`, `body`, and `timeout_secs`. It should return `status`, `headers`, and `body` as `serde_json::Value`.

- [ ] **Step 3: Implement image URL download command**

Create a `download_image_as_data_url` command accepting `url` and `fallback_mime`. It should fetch bytes using Rust and return `data:<mime>;base64,<payload>`.

- [ ] **Step 4: Register commands**

Register both commands in `tauri::generate_handler!`.

- [ ] **Step 5: Add frontend invoke wrappers**

Create `nativeJsonRequest()` and `downloadImageAsDataUrl()` in `src/lib/tauri/http-client.ts`.

- [ ] **Step 6: Verify Rust build**

Run: `cargo check`

Expected: PASS.

### Task 3: Gallery UI Slice

**Files:**
- Create: `src/lib/components/ui/input/input.svelte`
- Create: `src/lib/components/ui/input/index.ts`
- Create: `src/lib/components/ui/textarea/textarea.svelte`
- Create: `src/lib/components/ui/textarea/index.ts`
- Create: `src/lib/components/ui/select/select.svelte`
- Create: `src/lib/components/ui/select/index.ts`
- Create: `src/lib/components/shell/AppShell.svelte`
- Create: `src/lib/components/gallery/GalleryWorkspace.svelte`
- Modify: `src/routes/+layout.svelte`
- Modify: `src/routes/+page.svelte`
- Modify: `src/app.css`

- [ ] **Step 1: Add shadcn-style primitive controls**

Implement Svelte input, textarea, and select primitives using existing theme variables and `cn()`.

- [ ] **Step 2: Add AppShell**

Create a desktop shell with a compact title bar, status text, and full-height workspace.

- [ ] **Step 3: Add GalleryWorkspace**

Create API settings fields, generation params, prompt textarea, generate button, error state, and a simple responsive result grid.

- [ ] **Step 4: Wire submit path**

On submit, use `buildImagesGenerationRequest()`, call `nativeJsonRequest()`, parse the JSON response, download any remote image URLs through Rust if needed in a later task, and render base64 images.

- [ ] **Step 5: Verify Svelte check**

Run: `bun run check`

Expected: PASS.

### Task 4: Verification

**Files:**
- No new files.

- [ ] **Step 1: Run frontend tests**

Run: `bun test src/lib/domain/url.test.ts src/lib/api/openai-compatible.test.ts`

Expected: PASS.

- [ ] **Step 2: Run Svelte type check**

Run: `bun run check`

Expected: PASS.

- [ ] **Step 3: Run Rust check**

Run: `cargo check` from `src-tauri`.

Expected: PASS.

- [ ] **Step 4: Start development server**

Run: `bun run dev`

Expected: Vite serves on `http://localhost:1420`.

### Self-Review

- Spec coverage: This plan covers Gallery-first scope, shadcn-svelte integration, and CORS removal through Tauri-backed HTTP for text-to-image generation.
- Explicit exclusions: Agent mode, mask editing, custom HTTP providers, streaming SSE, and persistent IndexedDB history are outside this first slice.
- Placeholder scan: No implementation step depends on unknown files or unnamed future work.
- Type consistency: Request, response, and params names are consistent across tasks.
