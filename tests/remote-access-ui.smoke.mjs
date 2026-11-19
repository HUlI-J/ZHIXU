import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  await page.setContent('<div id="modal-root"></div>');
  await page.evaluate(() => {
    const inactive = { running: false, busy: false, url: '', message: '网页访问未开启' };
    window.remoteFixture = { status: inactive, starts: 0, pending: null, copied: [] };
    const fixture = window.remoteFixture;
    window.localModal = (_title, body, footer) => {
      document.querySelector('#modal-root').innerHTML =
        '<div class="remote-modal">' + body + '<footer>' + footer + '</footer></div>';
    };
    window.icon = () => '';
    window.persistWorkbench = async () => {};
    window.showToast = () => {};
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true, value: { writeText: async value => { fixture.copied.push(value); } }
    });
    window.zhixuDesktop = { async remoteAccess({ operation, password }) {
      if (operation === 'status') return fixture.status;
      if (operation === 'stop') return (fixture.status = inactive);
      if (operation !== 'start') throw new Error('Unexpected operation');
      fixture.starts++;
      return new Promise((resolve, reject) => {
        fixture.pending = {
          validPassword: /^[a-f0-9]{36}$/.test(password),
          succeed() {
            fixture.status = { running: true, busy: false, url: 'https://fixture-' + fixture.starts + '.example.invalid',
              message: '网页访问已开启' };
            fixture.matchesPassword = () => document.getElementById('remote-password').value === password;
            resolve(fixture.status);
          },
          fail() { fixture.status = inactive; reject(new Error('连接失败')); }
        };
      });
    } };
    document.addEventListener('click', event => {
      const action = event.target.closest('[data-action]')?.dataset.action;
      if (action) void remoteAction(action);
    });
  });
  await page.addScriptTag({ path: fileURLToPath(new URL('../prototype/remote.js', import.meta.url)) });
  await page.evaluate(() => openRemoteAccess());
  const start = page.getByRole('button', { name: '开启网页访问' });
  const stop = page.getByRole('button', { name: '关闭访问' });
  const address = page.getByLabel('HTTPS 地址');
  const password = page.getByLabel('访问密码');
  const waitForStart = count => page.waitForFunction(count => window.remoteFixture.starts === count, count);
  async function assertPending() {
    assert.ok(await page.evaluate(() => window.remoteFixture.pending.validPassword));
    assert.equal(await address.isVisible(), false);
    assert.equal(await password.isVisible(), false);
    assert.equal(await password.inputValue(), '');
  }

  await start.click();
  await waitForStart(1);
  await assertPending();
  await page.evaluate(() => window.remoteFixture.pending.fail());
  await page.getByText('连接失败', { exact: true }).waitFor();
  assert.equal(await password.isVisible(), false);
  assert.equal(await password.inputValue(), '');

  await start.click();
  await waitForStart(2);
  await assertPending();
  await page.evaluate(() => window.remoteFixture.pending.succeed());
  await password.waitFor();
  assert.match(await address.inputValue(), /^https:/);
  assert.ok(await page.evaluate(() => window.remoteFixture.matchesPassword()));
  assert.equal(await page.evaluate(() => window.remoteFixture.copied.length), 0);
  await page.getByRole('button', { name: '复制密码' }).click();
  assert.equal(await page.evaluate(() => window.remoteFixture.copied.length), 1);

  await page.evaluate(() => openRemoteAccess());
  await address.waitFor();
  assert.equal(await password.isVisible(), false);
  await page.getByRole('button', { name: '生成新密码' }).click();
  await waitForStart(3);
  await assertPending();
  await page.evaluate(() => window.remoteFixture.pending.succeed());
  await password.waitFor();
  assert.ok(await page.evaluate(() => window.remoteFixture.matchesPassword()));
  await stop.click();
  await start.waitFor();
  assert.equal(await address.isVisible(), false);
  assert.equal(await password.inputValue(), '');
  console.log('Remote access UI passed: pending, failure, retry, reveal, copy, reopen, rotate and stop.');
} finally {
  await browser.close();
}
