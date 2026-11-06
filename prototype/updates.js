/* Update controls are available only in the installed host application. */
let desktopUpdateStatus;
let promptedUpdateVersion = '';
let updatePromptObserver;
function promptForDownloadedUpdate(status) {
  if (status.stage !== 'ready' || !status.version || promptedUpdateVersion === status.version) return;
  const root = document.getElementById('modal-root');
  const current = root?.querySelector('.modal');
  if (current) {
    if (current.classList.contains('profile-modal') && current.querySelector('[data-settings-pane="updates"]')?.hidden === false) {
      promptedUpdateVersion = status.version;
      updatePromptObserver?.disconnect();
      updatePromptObserver = null;
    } else if (!updatePromptObserver && root) {
      updatePromptObserver = new MutationObserver(() => promptForDownloadedUpdate(desktopUpdateStatus));
      updatePromptObserver.observe(root, { childList: true });
    }
    return;
  }
  promptedUpdateVersion = status.version;
  updatePromptObserver?.disconnect();
  updatePromptObserver = null;
  openProfileSettings('updates');
}
function paintDesktopUpdate(status) {
  desktopUpdateStatus = status;
  let notice = document.getElementById('desktop-update-notice');
  if (status.stage === 'ready') {
    if (!notice) {
      notice = document.createElement('button');
      notice.id = 'desktop-update-notice';
      notice.className = 'btn btn-sm';
      notice.dataset.action = 'update-settings';
      document.body.append(notice);
    }
    notice.textContent = `新版本 ${status.version} 已就绪`;
  } else notice?.remove();
  promptForDownloadedUpdate(status);
  const output = document.getElementById('update-status');
  if (!output) return;
  output.textContent = status.message;
  document.getElementById('update-current-version').textContent = `当前版本 ${status.currentVersion}`;
  const target = document.getElementById('update-target-version');
  target.textContent = status.version ? `新版本 ${status.version}` : '';
  target.hidden = !status.version;
  document.getElementById('update-checked-at').textContent = status.checkedAt ?
    `上次检查 ${new Date(status.checkedAt).toLocaleString()}` : '尚未检查';
  const aboutVersion = document.getElementById('about-current-version');
  if (aboutVersion) aboutVersion.textContent = `v${status.currentVersion}`;
  const automatic = document.getElementById('update-automatic');
  if (automatic) automatic.checked = status.automatic;
  const progress = document.getElementById('update-progress');
  progress.hidden = status.stage !== 'downloading';
  progress.value = status.percent;
  progress.setAttribute('aria-label', `下载进度 ${Math.round(status.percent)}%`);
  const busy = ['checking', 'downloading', 'installing'].includes(status.stage);
  document.querySelectorAll('[data-action="update-check"]')
    .forEach(button => { button.disabled = busy; });
  const install = document.querySelector('[data-action="update-install"]');
  if (install) {
    install.hidden = status.stage !== 'ready';
    install.disabled = status.stage !== 'ready';
  }
  if (status.stage === 'error') output.classList.add('error');
  else output.classList.remove('error');
}
async function refreshDesktopUpdatePane() {
  const output = document.getElementById('update-status');
  if (!output) return;
  if (!window.zhixuDesktop?.updates || window.zhixuDesktop.isRemote) {
    output.textContent = '网页预览不提供更新检查，请在安装版中使用。';
    document.querySelectorAll('[data-action="update-check"],[data-action="update-install"]')
      .forEach(button => { button.disabled = true; });
    return;
  }
  if (desktopUpdateStatus && ['downloading', 'ready', 'installing'].includes(desktopUpdateStatus.stage)) return;
  try {
    const status = await window.zhixuDesktop.updates({ operation: 'status' });
    if (document.getElementById('update-status')) paintDesktopUpdate(status);
  } catch (error) {
    if (document.getElementById('update-status')) output.textContent = error.message;
  }
}
async function openDesktopUpdates() {
  openProfileSettings('updates');
}
async function desktopUpdateAction(action) {
  if (action === 'update-settings') { openProfileSettings('updates'); return; }
  const output = document.getElementById('update-status');
  try {
    const operation = action.slice('update-'.length);
    if (operation === 'install' && !confirm('保存当前工作并重启知序以完成更新？网页访问会暂时断开。')) return;
    const request = operation === 'save' ? {
      operation: 'configure', automatic: document.getElementById('update-automatic').checked
    } : { operation };
    const status = await window.zhixuDesktop.updates(request);
    paintDesktopUpdate(status);
  } catch (error) { if (output?.isConnected) output.textContent = error.message; }
}
async function prepareWorkbenchUpdate() {
  const modal = document.querySelector('#modal-root .modal');
  const updateSettings = modal?.classList.contains('profile-modal') &&
    modal.querySelector('[data-settings-pane="updates"]')?.hidden === false;
  if (!workbenchReady || state.chatSending || state.documentImportBusy || state.documentReparsing || state.documentAnalyzing ||
      state.providerDiagnosing || Object.values(state.integrationBusy || {}).some(Boolean) ||
      DB.runningTimer || document.getElementById('workbench-sync-notice') ||
      (modal && !updateSettings)) return false;
  if (document.getElementById('chat-input')?.value.trim()) return false;
  await persistWorkbench();
  return true;
}
function initializeDesktopUpdates() {
  if (!window.zhixuDesktop?.updates || window.zhixuDesktop.isRemote) return;
  window.zhixuDesktop.onUpdate?.(paintDesktopUpdate);
  void window.zhixuDesktop.updates({ operation: 'status' }).then(paintDesktopUpdate).catch(() => {});
}
