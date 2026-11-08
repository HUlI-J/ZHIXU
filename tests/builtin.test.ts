import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const UUID = '11111111-2222-3333-4444-555555555555';

function loadShared(settings: Record<string, unknown> = {}) {
  const context = createContext({
    DB: { settings, tasks: { must: [], should: [], could: [] }, projects: [], meta: { today: '2026-11-08' } },
    storageGet: () => null,
    storageSet: () => {},
    crypto: { randomUUID: () => UUID },
    console
  });
  runInContext(readFileSync('prototype/shared.js', 'utf8'), context);
  return context;
}

function provider(context: ReturnType<typeof createContext>) {
  return JSON.parse(runInContext('JSON.stringify(aiProviderConfig())', context) as string);
}

test('内置免费 AI 在未表态同意时不可用，只回退本地规则', () => {
  const ctx = loadShared({});
  assert.equal(provider(ctx).id, 'local');
  // 但设置对象应已初始化设备标识与默认值，供同意流程使用
  const b = JSON.parse(runInContext('JSON.stringify(DB.settings.builtinAI)', ctx) as string);
  assert.equal(b.installId, UUID);
  assert.equal(b.enabled, true);
  assert.equal(typeof b.consent, 'undefined');
});

test('用户同意后内置免费 AI 成为默认供应商，且不含上游密钥', () => {
  const ctx = loadShared({ builtinAI: { consent: true, enabled: true, installId: UUID } });
  const cfg = provider(ctx);
  assert.equal(cfg.id, 'builtin');
  assert.equal(cfg.name, '知序内置免费');
  assert.equal(cfg.model, 'zhixu-free');
  assert.equal(cfg.protocol, 'chat');
  assert.match(cfg.baseUrl, /^https?:\/\//);
  // 设备标识以 zxf_ 前缀随 Bearer 发送；它只是匿名设备号，不是上游密钥
  assert.equal(cfg.apiKey, 'zxf_' + UUID);
  assert.equal(/sk-|Bearer/.test(cfg.apiKey), false);
});

test('配置了自有供应商或 DeepSeek 时，自有配置优先于内置免费', () => {
  const custom = loadShared({
    builtinAI: { consent: true, enabled: true, installId: UUID },
    customProvider: { name: '我的代理', baseUrl: 'https://api.example.com/v1', apiKey: 'sk-own', model: 'own-model' }
  });
  assert.equal(provider(custom).id, 'custom');

  const deepseek = loadShared({
    builtinAI: { consent: true, enabled: true, installId: UUID },
    deepseekKey: 'sk-deepseek-own'
  });
  assert.equal(provider(deepseek).id, 'deepseek');
});

test('免费 Key 向导目录结构完整、均为 https 且带步骤', () => {
  const ctx = loadShared({});
  const list = JSON.parse(runInContext('JSON.stringify(FREE_API_PROVIDERS)', ctx) as string);
  assert.ok(list.length >= 4);
  for (const p of list) {
    assert.ok(p.id && p.name && p.tag, '缺少基础字段');
    assert.match(p.signupUrl, /^https:\/\//);
    assert.match(p.consoleUrl, /^https:\/\//);
    assert.match(p.baseUrl, /^https:\/\//);
    assert.equal(typeof p.model, 'string');
    assert.ok(Array.isArray(p.steps) && p.steps.length >= 2);
  }
});

test('关闭内置或地址非法时回退本地规则', () => {
  const disabled = loadShared({ builtinAI: { consent: true, enabled: false, installId: UUID } });
  assert.equal(provider(disabled).id, 'local');

  const badUrl = loadShared({ builtinAI: { consent: true, enabled: true, installId: UUID, baseUrl: 'ftp://nope' } });
  assert.equal(provider(badUrl).id, 'local');
});
