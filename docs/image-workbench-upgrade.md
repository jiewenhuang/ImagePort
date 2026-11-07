# 图片工作台收敛与升级说明

实施日期：2026-11-07。技术栈继续使用 Tauri 2、SvelteKit / Svelte 5、TypeScript、Tailwind CSS 4、SQLite 与 Rust HTTP bridge。

## 功能范围

主界面保留画廊与 Agent。图片生成、参考图编辑、蒙版、历史、收藏、检索、批量管理、大图查看、下载和备份继续保留。图片 Provider 协议与 Agent 推理/图片连接仍可独立配置。

Studio、剧本、角色项目、分镜、视频生成、视频任务恢复、时间轴、成片导出及其 S3 配置退出当前实现。图片 Provider 所需的自定义轮询不受影响。

根页面不再挂载 Studio；数据库初始化不再创建 Studio 表；Rust 不再注册其存储/媒体命令，也不再启用其 asset protocol scope。

## 设置与历史兼容

- 设置 schema 升为 2，仍接受旧版设置 JSON 与旧 ZIP 备份。图片/Agent Profile、API Key、服务商草稿与三个在用的模型分工被保留；退役字段被忽略。
- 设置 JSON 导出默认不包含 API Key；完整 ZIP 备份沿用原格式，包含本地设置及其中的凭据，应按私人备份保存。
- 数据库及应用标识仍沿用 `run.jiewen.imageport-desktop`，没有更换 Gallery 历史格式或自动删表。
- 历史列表先读缩略图与轻量元数据；查看详情、复用、下载和导出时读取原图、参考图及蒙版。缺少旧缩略图时兼容读取原图。
- 大体量原始 Provider 响应留在 SQLite，打开详情时再读。修改收藏只更新元数据，保留原图引用与原始响应。
- 重启会把之前运行中的任务标记为中断，不自动提交生成请求。
- 全局任务导入、导出、备份和清空覆盖数据库中尚未分页加载的历史；图片清理保护所有历史引用。历史读取失败会停止数据操作。
- 任务与 Agent 会话的整批保存由 Rust 在同一条 SQLite 连接上执行原子事务；任一记录写入失败会回滚整批，不再通过连接池中的独立调用拼接 `BEGIN` / `COMMIT`。

## 旧 Studio 数据

功能退出不会自动删除旧 Studio 表、独立数据库或媒体文件。macOS 原数据目录为：

```text
~/Library/Application Support/run.jiewen.imageport-desktop/
  imageport.db
  imageport-studio.db
  imageport-settings.json
  images/
  studio-media/
~/Library/WebKit/run.jiewen.imageport-desktop/
```

本机已在仓库外建立受限访问的归档目录：

```text
../.imageport-archives/20261107-162843/
  source.tar.gz
  source-manifest.json
  working-tree.patch
  runtime-data.tar.gz
  runtime-data-manifest.json
  runtime-data-verification.json
```

源码归档包含实施前已修改与未跟踪文件；运行数据归档包含数据库一致性快照、设置、图片、Studio 媒体和 WebKit 存储。运行数据压缩包的 2009 个文件已逐一核对大小与 SHA-256，共 3,181,396,899 字节。

应用里的完整备份 ZIP 只覆盖图片工作台数据，不包含退役的 Studio 项目和媒体。需要旧视频功能时使用源码及运行数据归档恢复；先退出应用，在独立目录解压、校验，并另存升级后的数据，避免覆盖仍在使用的目录。归档内含私人数据和凭据，不应提交到 Git 或上传公开位置。

## 本地验收与发布

`qa/image-workbench-smoke.ts` 提供仅监听 `127.0.0.1:23361` 的模拟图片/推理接口。使用独立的 `run.jiewen.imageport-desktop.preview` 应用标识与样例历史，不读取真实 API Key。首次运行 `bun qa/image-workbench-smoke.ts --init` 初始化样例；之后不带 `--init` 启动服务，初始化器会拒绝覆盖已有预览配置。

预览打包用的 product name / identifier 覆盖仅存在本机归档配置中，正式配置仍为 `ImagePort` / `run.jiewen.imageport-desktop`。本轮功能验收没有修改已安装应用。源码提交与仓库同步按用户指令单独执行，版本号仍沿用 0.1.8；对外发布前需选择新版本号，并完成签名、公证和其他平台的检查。

现有 ZIP 导出/恢复仍在 WebView 内存中处理完整媒体。GB 级历史可继续使用上述原生目录一致性归档；流式或分卷备份留作后续优化，本次不把它标为已通过大数据量验收。
