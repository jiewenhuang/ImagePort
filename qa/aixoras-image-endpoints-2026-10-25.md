# Aixoras Nano Banana 接口排查记录

日期：2026-10-25（Asia/Shanghai）。域名：`https://aixoras.com`。模型：`gemini-nano-banana-2.1`。

## 结论

已确认客户端的 OpenAI Images 分流条件是是否存在参考图：无参考图使用 `/v1/images/generations`，有参考图使用 `/v1/images/edits`。遮罩不是切换接口的条件。重复提交、替换参考图或切换协议再切回，不会改变这条规则。

当前服务端对该模型的可用接口提示和实际处理存在冲突。并发数设为 1 不能根治；推荐的替代接口也未通过实测。为什么相同配置的 edits 请求时而成功、时而拒绝，仍需 Aixoras 根据请求 ID 检查实际节点、渠道和配置版本；客户端记录不能证明其中某一种具体原因。

## 证据

1. 本机任务记录中，同一个生成 2 张的任务拆成两个相同模型、参数、参考图、无蒙版的请求，出现一个成功、一个报模型不支持 edits 的情况。18:05:41 的失败请求 ID：`202610251005450696675598268d9d6ohufxjr3`。
2. 改成每次生成 1 张后，18:38:39 仍出现相同错误（请求 ID：`202610251038448093515888268d9d6hkkzIQ59`），18:38:58 又成功。因此并发不是充分解释。
3. 使用同一配置的 API Key，通过新原生适配器、两张合成纯色测试图直接请求：

   `POST https://aixoras.com/v1beta/models/gemini-nano-banana-2.1:generateContent`

   请求按 Gemini JSON 结构包含 `contents[].parts[].inlineData` 和 `generationConfig.imageConfig.imageSize = "1K"`。收到 HTTP 400：

   > model gemini-nano-banana-2.1 is configured as image_size but current endpoint does not support image size billing

   请求 ID：`202610251222519011475948268d9d66mgIIQe2`。第一条请求即被拒绝，未继续第二次生图测试。

4. 对报错中推荐的单数路径做路由探测（发送无效 JSON，不提交有效生图请求）：

   `POST https://aixoras.com/v1/image/generations` 返回 HTTP 404，`Invalid URL (POST /v1/image/generations)`。

   复数路径 `/v1/images/generations` 返回 HTTP 400、JSON 解析错误，说明该路由存在；这不证明它支持本模型的参考图请求。

5. `GET /v1/models` 返回该模型的 `supported_endpoint_types: ["openai"]`。该元数据没有提供可验证的参考图 generations 请求格式。

6. 根据 [Rolldek Banana 2.1 文档](https://www.rolldek.com/docs/#/banana-2-1)，改用 `responseModalities: ["IMAGE"]` 和 `generationConfig.responseFormat.image`（`imageSize: "1K"`、`aspectRatio: "1:1"`），保留两张测试参考图，再向 Aixoras 的 generateContent 接口请求一次。仍收到 HTTP 400 和相同的 `image_size` 计费错误。请求 ID：`202610251238507541796318268d9d6dwhyL2nA`。因此这次参数格式调整没有解决 Aixoras 的错误；本轮没有向 Rolldek 发送鉴权请求。

## 给 Aixoras 的排查请求（可直接复制）

使用 `https://aixoras.com` 上的 `gemini-nano-banana-2.1`：

- 相同输入、无蒙版的 `/v1/images/edits` 请求间歇成功或拒绝。单请求也能复现。失败请求 ID：`202610251038448093515888268d9d6hkkzIQ59`。
- 错误推荐 `/v1beta/models/{model}:generateContent`，但该接口返回“模型配置为 image_size 计费，当前接口不支持 image size billing”。请求 ID：`202610251222519011475948268d9d66mgIIQe2`。
- 错误同时推荐 `/v1/image/generations`，但这个单数路径返回 404 Invalid URL。

请核对模型的端点能力配置、实际路由、各节点/渠道配置一致性，以及 image_size 计费与 generateContent 的兼容性。请提供一个可连续成功、包含两张参考图的完整请求示例（URL、请求体、鉴权方式）。解决方式可以是稳定支持 `/v1/images/edits`，或修复 generateContent 的计费支持；若指定使用 generations，请明确单复数路径及参考图字段。

## 应用侧修改与验证

- 设置页分别展示无参考图、有参考图的请求地址，修正此前始终展示 generations 的误导。
- 添加可选的 `Gemini generateContent` 协议，保留已有 Interactions 和 OpenAI Images 协议；没有改写本机保存的配置。
- 新协议支持多参考图和重复提交，使用原生 JSON 请求及候选图片响应解析。
- 新增可选的 `Gemini generateContent（responseFormat）` 参数格式，与 Rolldek 文档一致；原来的 `imageConfig` 格式保持不变。
- 76 项相关测试通过；Svelte 检查 0 错误、0 警告；包含 responseFormat 选项的 macOS 应用构建通过。
- 新协议的本地实现验证通过，但当前 Aixoras 的线上请求仍被上述计费错误阻止。该客户端构建不能替代服务端修复。

原生请求结构参考：[Google generateContent API](https://ai.google.dev/api/generate-content)。
