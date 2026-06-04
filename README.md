# ImagePort

ImagePort 是一个基于 Tauri + SvelteKit 的桌面端 AI 图片生成与编辑工具。它把原 Web 项目的 Gallery 工作流迁移到桌面端，通过 Tauri 后端代理请求，解决浏览器跨域限制，并把历史任务、输入图、蒙版、partial images 和设置持久化到本地。

## 功能

- Gallery 生图与改图：支持 OpenAI-compatible Images API、Responses API、自定义服务商 manifest。
- 参考图与蒙版编辑：输入区可添加多张参考图，并对参考图绘制 mask。
- 多任务历史：任务可并发发起，历史任务持久化到 SQLite，图片文件保存到应用数据目录。
- 多图查看：输出图支持 Lightbox、上一张/下一张、缩放、拖拽、下载、复制、用作参考图。
- 收藏集合：任务可加入收藏集合，并支持集合筛选、批量下载和批量删除。
- Agent 模式：基于 Responses API，支持会话、工具调用预算、partial images、停止/重试/继续。
- 数据备份：支持完整备份 ZIP 和恢复，避免把大图直接内嵌进大型 JSON。

## 技术栈

- Tauri 2
- SvelteKit 2 / Svelte 5
- shadcn-svelte / bits-ui
- Tailwind CSS 4
- SQLite via `@tauri-apps/plugin-sql`
- Tauri Store / FS / Dialog / Clipboard Manager plugins
- Rust `reqwest` HTTP bridge

## 目录结构

```text
ImagePort-Desktop/
  src/
    lib/api/              # Provider adapter、OpenAI-compatible、Responses/Agent runner
    lib/components/       # Gallery、设置、Lightbox、Mask editor、品牌组件
    lib/domain/           # 纯业务模型、设置归一化、下载、收藏、备份、任务历史
    lib/storage/          # SQLite、Store、FS 图片文件、剪贴板、下载
    lib/tauri/            # 前端 Tauri command wrapper
    routes/               # SvelteKit 页面入口
  src-tauri/
    capabilities/         # Tauri 权限配置
    src/commands/         # Tauri commands
    src/services/         # Rust HTTP client / streaming / cancellation
  static/brand/           # ImagePort logo 草案与预览页
  docs/                   # 发布检查清单等项目文档
```

## 开发环境

需要安装：

- Bun
- Rust
- Tauri 2 依赖环境

安装依赖：

```bash
bun install
```

启动前端开发服务器：

```bash
bun run dev
```

启动桌面端：

```bash
bun run tauri dev
```

## 常用命令

```bash
bun test
bun run check
bun run build
cd src-tauri && cargo check
```

桌面端生产构建：

```bash
bun run tauri build
```

## 配置

在应用设置里创建 API Profile：

- OpenAI Images：适合常规 `/v1/images/generations` 和 `/v1/images/edits`。
- OpenAI Responses：用于 Agent 模式，也可用于 Gallery 的 Responses 生图/改图路径。
- Custom Provider：通过 JSON manifest 描述提交、轮询和结果解析路径。

API Key 保存在本地 Tauri Store 中。导出设置时默认不包含 API Key。

## 数据存储

ImagePort 使用本地持久化：

- SQLite：任务记录、Agent 会话等 JSON payload。
- App data 图片目录：输出图、缩略图、输入图、mask、partial images。
- Tauri Store：应用设置和输入草稿。

历史数据优先级最高：应用不会在启动时自动清理历史图片；清理动作必须由用户确认。

## Logo

Logo 草案在 `static/brand/`：

- `imageport-app-icon.png`：当前应用内 logo、favicon 和 Tauri app icon 的源图。
- `src-tauri/icons/`：由 Tauri CLI 从当前源图生成的 PNG、ICNS、ICO 和平台图标。
- `imageport-mark-minimal-focus.svg`：保留的简约 SVG 草案。
- `imageport-mark-minimal-frame.svg`：更偏图片编辑/画廊的简约备选。
- `imageport-logo-concepts-minimal.png`：使用 image generation 生成的简约概念图。
- `logo-preview.html`：本地预览页面。

## 发布前检查

发布前至少运行：

```bash
bun test
bun run check
bun run build
cd src-tauri && cargo check
```

更多手动检查见 `docs/release-checklist.md`。

## GitHub Release 自动打包

项目包含 `.github/workflows/release.yml`。在 GitHub 发布 Release 时，工作流会在 macOS、Windows 和 Linux 上分别运行 `tauri build`，并把生成的安装包上传到当前 Release。

发版流程：

```bash
git tag v0.1.0
git push origin v0.1.0
```

然后在 GitHub Releases 页面基于该 tag 创建并发布 Release。工作流触发后会自动追加各平台产物。

当前 workflow 未配置代码签名/公证。macOS 和 Windows 的签名证书、notarization、updater 私钥等发布凭据后续可通过 GitHub Secrets 接入。
