# 知序内置免费 AI · Cloudflare Worker

一个轻量中转，把知序的 OpenAI 兼容请求转发到国内免费模型，并用匿名设备标识做每日限流。

## 为什么需要中转

浏览器/客户端里无法安全保存上游 API Key（会被逆向提取）。因此内置免费模式必须经过一个中转服务：**上游 Key 只放在 Worker 的服务端环境变量里，客户端只拿到一个不含密钥的设备标识**。

## 目录

- `src/index.js` — Worker 入口（`/v1/chat/completions`、`/v1/models`、`/health`）
- `wrangler.toml` — 部署配置
- `dev-server.mjs` — 本地 mock，用于无需 Cloudflare 的离线联调

## 部署步骤

1. 安装 wrangler 并登录：
   ```bash
   npx wrangler login
   ```
2. 准备一个国内免费上游的密钥（默认智谱 GLM-4-Flash）：
   ```bash
   npx wrangler secret put UPSTREAM_API_KEY
   ```
3. （推荐）创建 KV 命名空间用于每日配额，把返回的 id 填进 `wrangler.toml`：
   ```bash
   npx wrangler kv namespace create ZHIXU_KV
   ```
4. 部署：
   ```bash
   npx wrangler deploy
   ```
5. 记下输出的地址，例如 `https://zhixu-free-ai.<你的子域>.workers.dev`，填到知序
   **设置 → 模型 → 内置免费 AI → 内置服务地址**（末尾带 `/v1`）。

## 更换上游

任何 OpenAI 兼容的国内免费模型都可替换，改 `wrangler.toml` 的 `[vars]`：

| 上游 | UPSTREAM_BASE_URL | UPSTREAM_MODEL |
|---|---|---|
| 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-flash` |
| 阿里云百炼 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-flash` |
| 硅基流动 | `https://api.siliconflow.cn/v1` | 免费模型 ID |

> 免费额度与条款会变化，请以各厂商最新官方说明为准。

## 安全与成本

- 只接受 `Bearer zxf_<设备ID>`，按“设备 + IP”每日限流（默认 50 次/设备、200 次/IP）。
- 请求体上限 200 KB，输出 token 上限 1024。
- 不在服务端持久化对话正文；KV 只存配额计数（2 天过期）。
- 上线前请评估内容合规与备案要求。

## 本地联调（无需 Cloudflare）

```bash
node worker/dev-server.mjs            # 默认 http://127.0.0.1:8788
# 或代理到真实上游：
UPSTREAM_BASE_URL=... UPSTREAM_API_KEY=... UPSTREAM_MODEL=... node worker/dev-server.mjs
```

然后把内置服务地址设为 `http://127.0.0.1:8788/v1` 即可测试完整链路（未配置上游时返回模拟回复）。
