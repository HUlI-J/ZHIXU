/**
 * 知序内置免费 AI · 本地 mock（仅开发联调用，非生产）
 *
 * 与 worker/src/index.js 相同的对外契约，便于在没有 Cloudflare 时跑通完整链路。
 *   node worker/dev-server.mjs            # http://127.0.0.1:8788
 *   PORT=9000 node worker/dev-server.mjs
 *
 * 未设置 UPSTREAM_* 时返回模拟回复；设置后将真实代理到上游。
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.PORT || 8788);
const DEVICE_PREFIX = 'zxf_';
const MAX_BODY_BYTES = 200_000;
const MAX_OUTPUT_TOKENS = 1024;
const DAILY_LIMIT = Number(process.env.DAILY_LIMIT || 50);
const UPSTREAM_BASE_URL = (process.env.UPSTREAM_BASE_URL || '').replace(/\/+$/, '');
const UPSTREAM_API_KEY = process.env.UPSTREAM_API_KEY || '';
const UPSTREAM_MODEL = process.env.UPSTREAM_MODEL || 'glm-4-flash';

const MEMORY = new Map();
const today = () => new Date().toISOString().slice(0, 10);

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Cache-Control', 'no-store');
}

function sendJSON(res, status, body, extra = {}) {
  cors(res);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...extra });
  res.end(JSON.stringify(body));
}

function deviceId(req) {
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return '';
  const token = m[1].trim();
  if (!token.startsWith(DEVICE_PREFIX)) return '';
  const id = token.slice(DEVICE_PREFIX.length);
  return /^[A-Za-z0-9-]{8,64}$/.test(id) ? id : '';
}

function bump(key, limit) {
  const name = `${today()}:${key}`;
  const used = parseInt(MEMORY.get(name) || '0', 10) || 0;
  if (used >= limit) return { allowed: false, used, limit };
  MEMORY.set(name, String(used + 1));
  return { allowed: true, used: used + 1, limit };
}

function cannedReply(model, messages) {
  const lastUser = [...messages].reverse().find(m => m && m.role === 'user');
  const text = typeof lastUser?.content === 'string' ? lastUser.content : JSON.stringify(lastUser?.content ?? '');
  return {
    id: 'chatcmpl-dev-' + Date.now(),
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      message: { role: 'assistant', content: '【内置免费 AI · 本地模拟】已收到：' + text.slice(0, 120) },
      finish_reason: 'stop'
    }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
  };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); res.end(); return; }

  if (url.pathname === '/health' || url.pathname === '/v1/health') {
    return sendJSON(res, 200, { ok: true, service: 'zhixu-free-ai-mock', upstream: UPSTREAM_BASE_URL || 'mock', model: UPSTREAM_MODEL });
  }

  const id = deviceId(req);
  if (!id) return sendJSON(res, 401, { error: { message: '缺少或无效的设备标识', type: 'invalid_device' } });

  if (req.method === 'GET' && url.pathname.endsWith('/models')) {
    return sendJSON(res, 200, { object: 'list', data: [
      { id: 'zhixu-free', object: 'model', owned_by: 'zhixu' },
      { id: UPSTREAM_MODEL, object: 'model', owned_by: 'upstream' }
    ] });
  }

  if (req.method !== 'POST' || !url.pathname.endsWith('/chat/completions')) {
    return sendJSON(res, 404, { error: { message: '不支持的接口', type: 'not_found' } });
  }

  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > MAX_BODY_BYTES) { sendJSON(res, 413, { error: { message: '请求过大', type: 'payload_too_large' } }); return; }
  }
  let body;
  try { body = JSON.parse(raw); } catch { return sendJSON(res, 400, { error: { message: '请求 JSON 无效', type: 'bad_request' } }); }
  if (!Array.isArray(body.messages) || !body.messages.length) {
    return sendJSON(res, 400, { error: { message: '缺少 messages', type: 'bad_request' } });
  }

  // 只有合法请求才计入配额。
  const quota = bump(`dev:${id}`, DAILY_LIMIT);
  if (!quota.allowed) {
    return sendJSON(res, 429, { error: { message: '今日免费额度已用完', type: 'quota_exceeded', limit: DAILY_LIMIT } }, { 'X-Zhixu-Remaining': '0' });
  }

  const remaining = String(Math.max(0, DAILY_LIMIT - quota.used));
  if (!UPSTREAM_BASE_URL || !UPSTREAM_API_KEY) {
    return sendJSON(res, 200, cannedReply(UPSTREAM_MODEL, body.messages), { 'X-Zhixu-Remaining': remaining });
  }

  try {
    const upstream = await fetch(`${UPSTREAM_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${UPSTREAM_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, model: UPSTREAM_MODEL, stream: false, max_tokens: Math.min(Number(body.max_tokens) || MAX_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS) })
    });
    const payload = await upstream.text();
    cors(res);
    res.writeHead(upstream.status, { 'Content-Type': 'application/json; charset=utf-8', 'X-Zhixu-Remaining': remaining });
    res.end(payload);
  } catch {
    sendJSON(res, 502, { error: { message: '上游模型服务连接失败', type: 'upstream_unreachable' } });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`zhixu-free-ai mock listening on http://127.0.0.1:${PORT}  (upstream=${UPSTREAM_BASE_URL || 'mock'}, model=${UPSTREAM_MODEL}, limit=${DAILY_LIMIT})`);
});
