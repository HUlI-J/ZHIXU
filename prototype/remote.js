/* Remote access controls live in the host application, never in a shared page. */
let remoteStatusTimer;
let remoteStatus = { running: false, busy: false };
function generateAccessPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}
async function copyRemotePassword(value) {
  if (!value) return false;
  try { await navigator.clipboard.writeText(value); return true; }
  catch { return false; }
}
function reloadWorkbench() {
  if (window.zhixuDesktop?.reload) void window.zhixuDesktop.reload();
  else location.reload();
}
function paintRemoteStatus(result) {
  remoteStatus = result;
  const label = document.getElementById('remote-access-status');
  if (!label) return;
  label.textContent = result.message;
  const url = document.getElementById('remote-url');
  if (url) url.value = result.running ? result.url : '';
  const start = document.querySelector('.remote-modal [data-action="remote-start"]');
  const stop = document.querySelector('.remote-modal [data-action="remote-stop"]');
  if (start) start.hidden = result.running;
  if (stop) stop.hidden = !result.running;
  document.querySelectorAll('.remote-modal .modal-foot button,.remote-modal [data-action="remote-password-generate"],.remote-modal [data-action="remote-password-copy"]')
    .forEach(button => { button.disabled = result.busy; });
}
async function refreshRemoteStatus() {
  if (!window.zhixuDesktop?.remoteAccess) return undefined;
  const result = await window.zhixuDesktop.remoteAccess({ operation: 'status' });
  if (document.getElementById('remote-access-status')) paintRemoteStatus(result);
  return result;
}
function setRemoteBusy(busy) {
  document.querySelectorAll('.remote-modal .modal-foot button,.remote-modal [data-action="remote-password-generate"],.remote-modal [data-action="remote-password-copy"]')
    .forEach(button => { button.disabled = busy; });
}
function openRemoteAccess() {
  if (!window.zhixuDesktop?.remoteAccess) return;
  localModal('网页访问', `<div class="field">
      <label for="remote-password">访问密码</label><input class="input" type="text" id="remote-password"
      autocomplete="new-password" minlength="12" maxlength="200" placeholder="开启时自动生成，也可以手动输入">
      <p class="hint">开启时留空会自动生成强密码并显示在这里。密码只保存哈希，关闭窗口后无法再次查看；忘记时点“生成密码”重置。</p>
      <p id="remote-password-note" class="small muted mt-8" hidden></p>
    </div>
    <div class="row gap-8 mt-12"><button class="btn btn-sm" data-action="remote-password-generate">${icon('refresh', 13)} 生成密码</button>
      <button class="btn btn-sm" data-action="remote-password-copy">${icon('copy', 13)} 复制密码</button></div>
    <div class="field mt-16"><label for="remote-url">HTTPS 地址</label><input class="input" id="remote-url" readonly placeholder="开启后显示">
      <button class="btn btn-sm mt-12" data-action="remote-url-copy">${icon('copy', 13)} 复制地址</button></div>
    <p class="small muted">主机需保持知序运行、联网且不休眠。重新开启后地址可能变化；关闭访问或重置密码会退出已登录设备。</p>
    <p id="remote-access-status" class="remote-feedback" role="status"></p>`,
    `<button class="btn" data-action="remote-stop" hidden>关闭访问</button>
    <button class="btn btn-primary" data-action="remote-start">${icon('link', 13)} 开启网页访问</button>`, 'remote-modal');
  clearInterval(remoteStatusTimer);
  void refreshRemoteStatus();
  remoteStatusTimer = setInterval(() => { void refreshRemoteStatus().catch(() => {}); }, 2000);
}

async function remoteAction(action) {
  if (action === 'remote-settings') { openRemoteAccess(); return; }
  const password = document.getElementById('remote-password');
  const status = document.getElementById('remote-access-status');
  const note = document.getElementById('remote-password-note');
  if (action === 'remote-password-generate') {
    const value = generateAccessPassword();
    if (password) { password.value = value; password.type = 'text'; }
    if (remoteStatus.running) {
      setRemoteBusy(true);
      if (status) status.textContent = '正在应用新密码并重新开启网页访问…';
      try {
        await window.zhixuDesktop.remoteAccess({ operation: 'password', password: value });
        const result = await window.zhixuDesktop.remoteAccess({ operation: 'start' });
        if (password?.isConnected) { password.value = value; password.type = 'text'; }
        if (note?.isConnected) { note.hidden = false; note.textContent = '新密码已应用；旧密码和原登录会话已失效。'; }
        paintRemoteStatus(result);
        const copied = await copyRemotePassword(value);
        showToast(copied ? '新密码已生成、应用并复制' : '新密码已生成并应用，请点击“复制密码”');
      } catch (error) {
        if (status?.isConnected) status.textContent = error.message;
      } finally { setRemoteBusy(false); }
      return;
    }
    if (note?.isConnected) { note.hidden = false; note.textContent = '已生成新密码；点击“开启网页访问”后生效。'; }
    showToast('已生成新密码，开启网页访问后生效');
    return;
  }
  if (action.endsWith('-copy')) {
    const field = action === 'remote-url-copy' ? document.getElementById('remote-url') : password;
    if (!field?.value) { showToast('暂无可复制内容'); return; }
    try { await navigator.clipboard.writeText(field.value); showToast('已复制'); }
    catch { field.select(); showToast('请复制已选中的内容'); }
    return;
  }
  if (action === 'remote-start') {
    let generated = false;
    if (password && !password.value.trim()) {
      password.value = generateAccessPassword();
      password.type = 'text';
      generated = true;
    }
    const value = password?.value || '';
    setRemoteBusy(true);
    if (status) status.textContent = generated ? '正在自动生成密码并开启网页访问…' : '正在开启网页访问…';
    try {
      await persistWorkbench();
      const result = await window.zhixuDesktop.remoteAccess({ operation: 'start', password: value || undefined });
      if (password?.isConnected) { password.value = value; password.type = 'text'; }
      if (note?.isConnected && generated) { note.hidden = false; note.textContent = '访问密码已自动生成，请立即复制保存。'; }
      paintRemoteStatus(result);
      if (generated) {
        const copied = await copyRemotePassword(value);
        showToast(copied ? '访问密码已自动生成并复制' : '访问密码已自动生成，请点击“复制密码”');
      }
    } catch (error) {
      if (status?.isConnected) status.textContent = error.message;
    } finally { setRemoteBusy(false); }
    return;
  }
  setRemoteBusy(true);
  if (status) status.textContent = '正在处理…';
  try {
    const result = await window.zhixuDesktop.remoteAccess({ operation: action.slice('remote-'.length) });
    if (status?.isConnected) status.textContent = result.message;
    paintRemoteStatus(result);
  } catch (error) {
    if (status?.isConnected) status.textContent = error.message;
  } finally {
    setRemoteBusy(false);
  }
}

async function refreshDataLocation() {
  const path = document.getElementById('data-location-path');
  if (!path) return;
  if (!window.zhixuDesktop?.dataLocation) {
    path.textContent = '网页预览不显示本机数据位置，请在安装版中查看。';
    document.querySelectorAll('[data-action^="data-location-"]').forEach(button => { button.disabled = true; });
    return;
  }
  try {
    const status = await window.zhixuDesktop.dataLocation({ operation: 'status' });
    path.textContent = status.path;
    const note = document.getElementById('data-location-note');
    if (note) {
      note.hidden = !status.warning;
      note.textContent = status.warning || '';
      note.classList.toggle('error', !!status.warning);
    }
  } catch (error) {
    path.textContent = error.message;
  }
}

async function dataLocationAction(action) {
  if (!window.zhixuDesktop?.dataLocation) { showToast('请在安装版中更改数据位置'); return; }
  const note = document.getElementById('data-location-note');
  if (action === 'data-location-change') {
    if (!confirm('更改数据位置会先保存当前工作，再把数据库、附件和插件配置复制到新文件夹，然后重启知序。原位置会保留一份完整副本。继续吗？')) return;
    const overlay = document.createElement('div');
    overlay.className = 'data-migration-overlay';
    overlay.innerHTML = '<div><strong>正在迁移工作数据…</strong><span>请勿关闭知序，完成后会自动重启。</span></div>';
    document.body.append(overlay);
    try {
      const result = await window.zhixuDesktop.dataLocation({ operation: 'choose' });
      if (result.canceled) { overlay.remove(); return; }
      if (note) { note.hidden = false; note.textContent = result.message || '正在重启知序…'; }
    } catch (error) {
      overlay.remove();
      if (note) { note.hidden = false; note.textContent = error.message; }
      showToast(error.message || '更改数据位置失败');
    }
    return;
  }
  try { await window.zhixuDesktop.dataLocation({ operation: 'open' }); }
  catch (error) { showToast(error.message || '无法打开数据文件夹'); }
}

async function prepareDataMigration() {
  if (!workbenchReady || state.chatSending || state.documentImportBusy || state.documentReparsing || state.documentAnalyzing ||
      state.providerDiagnosing || Object.values(state.integrationBusy || {}).some(Boolean) || DB.runningTimer ||
      document.getElementById('workbench-sync-notice')) return false;
  const modal = document.querySelector('#modal-root .modal');
  if (modal && !modal.classList.contains('profile-modal')) return false;
  await persistWorkbench();
  return true;
}

function workbenchSyncNotice(message) {
  let root = document.getElementById('workbench-sync-notice');
  if (!root) {
    root = document.createElement('div');
    root.id = 'workbench-sync-notice';
    root.setAttribute('role', 'status');
    document.body.append(root);
  }
  root.innerHTML = `<span>${esc(message)}</span><div>
    <button class="btn btn-sm" id="sync-export-draft">导出本次编辑</button>
    <button class="btn btn-sm" id="sync-reload">重新载入</button></div>`;
  root.querySelector('#sync-export-draft').onclick = () => {
    const snapshot = exportableSnapshot();
    const unsavedInputs = [...document.querySelectorAll('#modal-root input,#modal-root textarea,#modal-root select,#chat-input')]
      .filter(field => !['password', 'file'].includes(field.type))
      .map(field => ({ id: field.id, value: field.value }));
    const url = URL.createObjectURL(new Blob([JSON.stringify({ snapshot, unsavedInputs,
      exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = '知序-本次编辑.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  };
  root.querySelector('#sync-reload').onclick = () => {
    if (confirm('未保存的本次编辑会被替换。请先导出需要保留的内容，再重新载入。')) reloadWorkbench();
  };
}

function initializeWorkbenchSync() {
  if (!window.zhixuDesktop?.revision) return;
  let checking = false;
  setInterval(async () => {
    if (checking || !workbenchReady || document.visibilityState === 'hidden' ||
        workbenchLastQueued !== workbenchLastSaved) return;
    checking = true;
    try {
      const result = await window.zhixuDesktop.revision();
      if (workbenchLastQueued !== workbenchLastSaved) return;
      if (!result.changed) { document.getElementById('workbench-sync-notice')?.remove(); return; }
      const editing = document.activeElement?.matches('input,textarea,[contenteditable="true"]') ||
        document.querySelector('#modal-root .modal') || state.chatSending || state.documentImportBusy ||
        state.documentReparsing || state.providerDiagnosing || DB.runningTimer;
      if (!editing && JSON.stringify(workbenchSnapshot()) === workbenchLastSaved) reloadWorkbench();
      else workbenchSyncNotice('其他设备已更新工作数据；请先保留本次编辑，再重新载入。');
    } catch { /* Offline clients keep their current content and report errors on save. */ }
    finally { checking = false; }
  }, 5000);
  window.addEventListener('zhixu-login-expired', () => {
    workbenchSyncNotice('登录已过期，请先保留本次内容，再重新登录。');
    const button = document.getElementById('sync-reload');
    if (button) button.textContent = '重新登录';
  });
}
