import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const evidence = join(root, '.desktop-test');
mkdirSync(evidence, { recursive: true });
const profile = mkdtempSync(join(evidence, 'brand-profile-'));
const { ELECTRON_RUN_AS_NODE, ...environment } = process.env;
const application = await electron.launch({
  executablePath: process.env.ZHIXU_TEST_EXE || join(root, 'node_modules/electron/dist/electron.exe'),
  args: process.env.ZHIXU_TEST_EXE ? [] : [join(root, 'out/main/index.js')],
  cwd: root, env: { ...environment, ZHIXU_DATA_DIR: profile }
});
try {
  const page = await application.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => typeof workbenchReady !== 'undefined' && workbenchReady);
  for (const view of ['today', 'chat', 'inbox', 'projects', 'reports', 'profile', 'data']) {
    await page.locator(`.nav [data-view="${view}"]`).click();
    assert.match(await page.title(), /知序/);
    assert.doesNotMatch(await page.locator('body').innerText(), /小鱼|Xiaoyu|jun944049/i);
  }
  const bridges = await page.evaluate(() => ({
    current: typeof window.zhixuDesktop?.save, legacy: typeof window.xiaoyuDesktop?.save
  }));
  assert.deepEqual(bridges, { current: 'function', legacy: 'function' });
  await application.evaluate(({ shell }) => {
    shell.openExternal = async () => {};
  });
  assert.equal(await page.evaluate(async () =>
    (await window.zhixuDesktop.openExternal('https://github.com/HUlI-J/ZHIXU/issues/new')).opened), true);
  assert.equal(await page.evaluate(async () => {
    try { await window.zhixuDesktop.openExternal('https://github.com/HULI-J/ZHIXU-fake'); return false; }
    catch { return true; }
  }), true);
  await page.evaluate(() => openProfileSettings('about'));
  await page.locator('[data-settings-pane="about"]').waitFor({ state: 'visible' });
  assert.match(await page.locator('[data-settings-pane="about"]').innerText(), /%APPDATA%\\Zhixu/);
  assert.equal(await page.evaluate(async () => (await window.zhixuDesktop.dataLocation({ operation: 'status' })).path), profile);
  assert.match(await page.locator('[data-action="open-external"]').first().getAttribute('data-url'), /github\.com\/HULI-J\/ZHIXU/);
  if (process.env.ZHIXU_SKIP_SCREENSHOTS !== '1') {
    await page.screenshot({ path: join(evidence, 'brand-about-0.2.17.png'), animations: 'disabled' });
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, pages: 7, bridges: true, repositoryLinks: true, dataPath: true, profile }));
} finally {
  await application.close();
}
