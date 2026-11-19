/* Remote access controls live in the host application, never in a shared page. */
let remoteStatusTimer;
let remoteStatusGeneration = 0;
let remoteActionPending = false;

function generateAccessPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}

function reloadWorkbench() {
  if (window.zhixuDesktop?.reload) void window.zhixuDesktop.reload();
  else location.reload();
}

function showRemotePassword(value) {
  const field = document.getElementById('remote-password');
  if (!field) return;
  field.value = value;
  document.getElementById('remote-password-row').hidden = !value;
}

function setRemoteBusy(busy) {
  document.querySelectorAll('.remote-modal button[data-action^="remote-"]')
    .forEach(button => { button.disabled = busy; });
}

function paintRemoteStatus(result) {
  const label = document.getElementById('remote-access-status');
  if (!label) return;
  label.textContent = result.message;
  const url = document.getElementById('remote-url');
  const ready = result.running && !!result.url;
  const address = ready ? result.url : '';
  if (url.value !== address || !ready) showRemotePassword('');
  url.value = address;
  document.getElementById('remote-access-details').hidden = !ready;
  document.querySelector('.remote-modal [data-action="remote-start"]').hidden = ready;
  document.querySelector('.remote-modal [data-action="remote-stop"]').hidden = !ready;
  setRemoteBusy(result.busy || remoteActionPending);
}

async function refreshRemoteStatus() {
  if (!window.zhixuDesktop?.remoteAccess || remoteActionPending) return;
  const generation = ++remoteStatusGeneration;
  const result = await window.zhixuDesktop.remoteAccess({ operation: 'status' });
  if (remoteStatusGeneration === generation && !remoteActionPending) paintRemoteStatus(result);
}

function openRemoteAccess() {
  if (!window.zhixuDesktop?.remoteAccess) return;
  const copy = icon('copy', 13);
  const refresh = icon('refresh', 13);
  const link = icon('link', 13);
  localModal('网页访问', [
    '<p id="remote-access-status" class="remote-feedback" role="status">网页访问未开启</p>',
    '<div id="remote-access-details" hidden>',
    '<div class="field"><label for="remote-url">HTTPS 地址</label><input class="input" id="remote-url" readonly>',
    '<button class="btn btn-sm mt-8" data-action="remote-url-copy">' + copy + ' 复制地址</button></div>',
    '<div class="field mt-12" id="remote-password-row" hidden>',
    '<label for="remote-password">访问密码</label><input class="input" type="text" id="remote-password" readonly autocomplete="off">',
    '<button class="btn btn-sm mt-8" data-action="remote-password-copy">' + copy + ' 复制密码</button></div>',
    '<p class="small muted mt-8">请保存本次密码。关闭窗口后，忘记密码可生成新密码；旧密码及登录会话将失效。</p>',
    '<button class="btn btn-sm mt-8" data-action="remote-password-generate">' + refresh + ' 生成新密码</button></div>',
    '<p class="small muted mt-12">主机需保持知序运行、联网且不休眠。重新开启后地址可能变化。</p>'
  ].join(''),
  '<button class="btn" data-action="remote-stop" hidden>关闭访问</button>' +
  '<button class="btn btn-primary" data-action="remote-start">' + link + ' 开启网页访问</button>', 'remote-modal');
  clearInterval(remoteStatusTimer);
  if (remoteActionPending) setRemoteBusy(true);
  void refreshRemoteStatus().catch(() => {});
  remoteStatusTimer = setInterval(() => { void refreshRemoteStatus().catch(() => {}); }, 2000);
}

async function remoteAction(action) {
  if (action === 'remote-settings') { openRemoteAccess(); return; }
  const status = document.getElementById('remote-access-status');
  if (!status || remoteActionPending) return;
  if (action === 'remote-url-copy' || action === 'remote-password-copy') {
    const field = document.getElementById(action === 'remote-url-copy' ? 'remote-url' : 'remote-password');
    if (!field?.value) return;
    try { await navigator.clipboard.writeText(field.value); showToast('已复制'); }
    catch { field.select(); showToast('请复制已选中的内容'); }
    return;
  }

  const stopping = action === 'remote-stop';
  const rotating = action === 'remote-password-generate';
  if (!stopping && !rotating && action !== 'remote-start') return;
  remoteActionPending = true;
  remoteStatusGeneration++;
  showRemotePassword('');
  if (!stopping) document.getElementById('remote-access-details').hidden = true;
  setRemoteBusy(true);
  status.textContent = stopping ? '正在关闭网页访问…' :
    rotating ? '正在使用新密码重新开启网页访问…' : '正在建立 HTTPS 连接…';
  try {
    if (stopping) {
      const result = await window.zhixuDesktop.remoteAccess({ operation: 'stop' });
      if (status.isConnected) paintRemoteStatus(result);
    } else {
      const password = generateAccessPassword();
      await persistWorkbench();
      const result = await window.zhixuDesktop.remoteAccess({ operation: 'start', password });
      if (status.isConnected) {
        paintRemoteStatus(result);
        if (result.running && result.url) showRemotePassword(password);
      }
    }
  } catch (error) {
    if (status.isConnected) {
      showRemotePassword('');
      status.textContent = error.message;
    }
  } finally {
    remoteActionPending = false;
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
