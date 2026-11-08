/**
 * 知序内置免费 AI · Cloudflare Worker 中转
 *
 * 对外提供 OpenAI 兼容接口：
 *   POST /v1/chat/completions
 *   GET  /v1/models
 *   GET  /health
 *
 * 上游为任意 OpenAI 兼容的国内免费模型（默认智谱 GLM-4-Flash）。
 * 鉴权使用匿名设备标识：客户端发送 `Authorization: Bearer zxf_<设备ID>`。
 * 每日配额按“设备 + IP”限流，优先使用 KV 持久化；未绑定 KV 时退回进程内内存（仅适合本地调试）。
 *
 * 部署后请在知序“设置 → 模型 → 内置免费 AI”里填入本 Worker 的地址
 * （例如 https://zhixu-free-ai.<你的子域>.workers.dev/v1）。
 */

const DEVICE_PREFIX = 'zxf_';
const MAX_BODY_BYTES = 200_000;
const MAX_OUTPUT_TOKENS = 1024;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400'
};

const MEMORY = new Map();
const memoryKV = {
  async get(key) { return MEMORY.has(key) ? MEMORY.get(key) : null; },
  async put(key, value) { MEMORY.set(key, value); }
};

function kv(env) { return env.ZHIXU_KV || memoryKV; }

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS, ...extra }
  });
}

function deviceId(request) {
  const auth = request.headers.get('Authorization') || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return '';
  const token = match[1].trim();
  if (!token.startsWith(DEVICE_PREFIX)) return '';
  const id = token.slice(DEVICE_PREFIX.length);
  return /^[A-Za-z0-9-]{8,64}$/.test(id) ? id : '';
}

function today() { return new Date().toISOString().slice(0, 10); }

async function bumpQuota(env, key, limit) {
  const store = kv(env);
  const name = `quota:${today()}:${key}`;
  const used = parseInt((await store.get(name)) || '0', 10) || 0;
  if (used >= limit) return { allowed: false, used, limit };
  await store.put(name, String(used + 1), { expirationTtl: 172800 });
  return { allowed: true, used: used + 1, limit };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    if (url.pathname === '/health' || url.pathname === '/v1/health') {
      return json({ ok: true, service: 'zhixu-free-ai', model: env.UPSTREAM_MODEL || 'glm-4-flash' });
    }

    const id = deviceId(request);
    if (!id) {
      return json({ error: { message: '缺少或无效的设备标识', type: 'invalid_device' } }, 401);
    }

    if (request.method === 'GET' && url.pathname.endsWith('/models')) {
      const model = env.UPSTREAM_MODEL || 'glm-4-flash';
      return json({ object: 'list', data: [
        { id: 'zhixu-free', object: 'model', owned_by: 'zhixu' },
        { id: model, object: 'model', owned_by: 'upstream' }
      ] });
    }

    if (request.method !== 'POST' || !url.pathname.endsWith('/chat/completions')) {
      return json({ error: { message: '不支持的接口', type: 'not_found' } }, 404);
    }

    let raw;
    try { raw = await request.text(); } catch { return json({ error: { message: '请求体读取失败', type: 'bad_request' } }, 400); }
    if (raw.length > MAX_BODY_BYTES) return json({ error: { message: '请求过大', type: 'payload_too_large' } }, 413);
    let body;
    try { body = JSON.parse(raw); } catch { return json({ error: { message: '请求 JSON 无效', type: 'bad_request' } }, 400); }
    if (!Array.isArray(body.messages) || !body.messages.length) {
      return json({ error: { message: '缺少 messages', type: 'bad_request' } }, 400);
    }

    // 只有合法请求才计入配额，避免畸形请求消耗额度。
    const dailyLimit = parseInt(env.DAILY_LIMIT || '50', 10) || 50;
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const quota = await bumpQuota(env, `dev:${id}`, dailyLimit);
    if (!quota.allowed) {
      return json({ error: { message: '今日免费额度已用完，可在知序设置中配置自有 API Key', type: 'quota_exceeded', limit: dailyLimit } },
        429, { 'X-Zhixu-Remaining': '0' });
    }
    const ipQuota = await bumpQuota(env, `ip:${ip}`, dailyLimit * 4);
    if (!ipQuota.allowed) {
      return json({ error: { message: '当前网络今日免费额度已用完', type: 'quota_exceeded' } }, 429, { 'X-Zhixu-Remaining': '0' });
    }

    if (!env.UPSTREAM_API_KEY) {
      return json({ error: { message: '服务端未配置上游密钥', type: 'misconfigured' } }, 500);
    }
    const base = String(env.UPSTREAM_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4').replace(/\/+$/, '');
    const upstreamBody = {
      ...body,
      model: env.UPSTREAM_MODEL || 'glm-4-flash',
      stream: false,
      max_tokens: Math.min(Number(body.max_tokens) || MAX_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS)
    };

    let upstream;
    try {
      upstream = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.UPSTREAM_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(upstreamBody)
      });
    } catch {
      return json({ error: { message: '上游模型服务连接失败', type: 'upstream_unreachable' } }, 502);
    }

    const payload = await upstream.text();
    return new Response(payload, {
      status: upstream.status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Zhixu-Remaining': String(Math.max(0, dailyLimit - quota.used)),
        ...CORS
      }
    });
  }
};
