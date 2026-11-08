# 第三方视频网关核实结果（2026-11-07，来自 GET https://newapi.dragon3api.com/api/pricing，无需密钥）
- 网关是 new-api（QuantumNous/new-api）。视频任务端点：`POST /v1/videos`（supported_endpoint "视频任务"）。查询/下载接口按 new-api 文档核实（通常 `GET /v1/videos/{id}`、`GET /v1/videos/{id}/content`）。
- 分组 "视频" 倍率 1 → 标价即实价（人民币）。
- 方法论里的两个模型在网关上的名字与单价（720p）：
  - `seedance-2.0-mini`：¥0.15/秒（首帧/首尾帧同价 ¥0.15；480p ¥0.03）。
  - `seedance-2.5`：¥0.55/秒（480p 0.25，1080p 1.35）。描述只写"支持参考素材"，**没写支持首尾帧**——需核实；`seedance-2.5-draft`（480p ¥0.35）写了支持首尾帧。
  - 其他可选：`seedance-2.0` ¥0.45/秒（720p，支持首尾帧）；`seedance-2.0-fast` ¥0.20/秒；按次计费的 `*-per-call*` 变体（¥3.5–18.75/次，不按秒）。
- billing_usage_schema 里有 `seconds`、`resolution`、`spec`（standard|portrait|plus；首尾帧走 plus）、`reference_video_seconds`。
- 完整价目副本：gateway-pricing.json（同目录）。
