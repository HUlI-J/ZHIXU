/* Modals: quick capture, command palette, insert-impact analysis */

function closeModal() {
  if (state.polishTimer) {
    clearTimeout(state.polishTimer);
    state.polishTimer = null;
  }
  state.polishRequestId += 1;
  state.polishLoading = false;
  state.projectStakeholderDraft = null;
  state.overdueReturn = false;
  const root = document.getElementById('modal-root');
  if (root) root.innerHTML = '';
}

function showToast(msg) {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span class="check-ic">${icon('check', 14)}</span><span>${esc(msg)}</span>`;
  root.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translate(-50%, 6px)';
    el.style.transition = 'opacity .2s ease, transform .2s ease';
    setTimeout(() => el.remove(), 220);
  }, 2400);
}

function deriveInitials(name) {
  const s = String(name || '').trim();
  if (!s) return '—';
  if (/^[A-Za-z]/.test(s)) {
    return s.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  }
  return s.slice(0, 1);
}

function projectStakeholderRows() {
  return (state.projectStakeholderDraft || []).map((person, index) => `
    <div class="stakeholder-editor-row" data-stakeholder-id="${esc(person.id)}" role="group" aria-label="干系人 ${index + 1}">
      <div class="field"><label for="stakeholder-name-${esc(person.id)}">姓名 *</label>
        <input class="input" id="stakeholder-name-${esc(person.id)}" data-stakeholder-name maxlength="80" value="${esc(person.name)}" required></div>
      <div class="field"><label for="stakeholder-role-${esc(person.id)}">角色</label>
        <input class="input" id="stakeholder-role-${esc(person.id)}" data-stakeholder-role maxlength="80" value="${esc(person.role)}" placeholder="例如 客户、项目经理"></div>
      <button class="icon-btn" data-action="project-stakeholder-remove" data-id="${esc(person.id)}" title="移除干系人" aria-label="移除干系人 ${index + 1}">${icon('trash', 15)}</button>
    </div>`).join('') || '<p class="small muted">尚未添加干系人</p>';
}

function changeProjectStakeholder(removeId) {
  const people = readProjectStakeholders();
  if (!people) return;
  state.projectStakeholderDraft = removeId
    ? people.filter(person => person.id !== removeId)
    : [...people, { id: newRecordId('stakeholder'), name: '', role: '', c: DB.user.color }];
  document.getElementById('project-stakeholder-list').innerHTML = projectStakeholderRows();
  document.getElementById('project-stakeholder-error').hidden = true;
  if (!removeId) {
    document.querySelector('.stakeholder-editor-row:last-child [data-stakeholder-name]').focus();
  } else {
    document.querySelector('[data-action="project-stakeholder-add"]').focus();
  }
}

function openProjectEditor(id, focusStakeholders = false) {
  const project = id ? projectById(id) : null;
  if (id && !project) { showToast('项目已不存在'); return; }
  state.editProjectId = project?.id || null;
  const p = project || {
    name: '', code: '', goal: '', owner: DB.user.name, progress: 0,
    health: 'green', next: '', nextDate: ''
  };
  state.projectStakeholderDraft = (project ? detailForProject(project).stakeholders : []).map(person => ({
    ...person, id: person.id || newRecordId('stakeholder')
  }));
  document.getElementById('modal-root').innerHTML = `
    <div class="modal-backdrop" data-action="backdrop">
      <div class="modal project-editor" role="dialog" aria-modal="true" aria-label="${project ? '编辑项目' : '新建项目'}">
        <div class="modal-head">
          <h2>${project ? '编辑项目' : '新建项目'}</h2>
          <button class="icon-btn" data-action="close-modal" aria-label="关闭">${icon('x', 16)}</button>
        </div>
        <div class="modal-body form-grid">
          <div class="field full"><label for="project-name">项目名称 *</label>
            <input class="input" id="project-name" maxlength="80" value="${esc(p.name)}" required></div>
          <div class="field full"><label for="project-owner">负责人</label>
            <input class="input" id="project-owner" maxlength="40" value="${esc(p.owner)}"></div>
          <div class="field full"><label for="project-goal">目标</label>
            <textarea class="input" id="project-goal" maxlength="1000" rows="3">${esc(p.goal)}</textarea></div>
          <details class="project-advanced full">
            <summary>进度与其他信息</summary>
            <div class="form-grid mt-16">
          <div class="field"><label for="project-code">项目代号</label>
            <input class="input" id="project-code" maxlength="20" value="${esc(p.code)}"></div>
          <div class="field"><label for="project-progress">完成进度（%）</label>
            <input class="input" id="project-progress" type="number" min="0" max="100" step="1" value="${p.progress}"></div>
            ${textField('project-note', '新增项目备注')}
          <div class="field"><label for="project-health">健康度</label>
            <select class="select" id="project-health">
              ${['green', 'amber', 'red'].map(h => `<option value="${h}" ${p.health === h ? 'selected' : ''}>${healthLabel(h)}</option>`).join('')}
            </select></div>
          <div class="field"><label for="project-next">下一节点</label>
            <input class="input" id="project-next" maxlength="80" value="${esc(p.next === '未安排' ? '' : p.next)}"></div>
          <div class="field"><label for="project-next-date">节点日期</label>
            <input class="input" id="project-next-date" maxlength="30" value="${esc(p.nextDate === '—' ? '' : p.nextDate)}" placeholder="例如 2026-11-01"></div>
          ${customFieldInputs('project', p)}
            </div>
          </details>
          <section class="project-stakeholders full" aria-labelledby="project-stakeholders-title">
            <div class="stakeholder-editor-head row gap-8">
              <h3 id="project-stakeholders-title">干系人</h3>
              <button class="btn btn-sm" data-action="project-stakeholder-add">${icon('plus', 13)} 添加干系人</button>
            </div>
            <div id="project-stakeholder-list">${projectStakeholderRows()}</div>
            <p class="stakeholder-error small" id="project-stakeholder-error" role="alert" hidden></p>
          </section>
        </div>
        <div class="modal-foot">
          <button class="btn" data-action="close-modal">取消</button>
          <button class="btn btn-primary" data-action="save-project">${icon('check', 13)} 保存项目</button>
        </div>
      </div>
    </div>`;
  if (focusStakeholders) {
    document.getElementById('project-stakeholders-title').scrollIntoView({ block: 'center' });
    (document.querySelector('[data-stakeholder-name]') ||
      document.querySelector('[data-action="project-stakeholder-add"]')).focus();
  } else document.getElementById('project-name').focus();
}

function openProjectDelete(id) {
  const project = projectById(id);
  if (!project) { showToast('项目已不存在'); return; }
  state.deleteProjectId = id;
  const count = allWorkbenchTasks().filter(t => t.project === id).length;
  document.getElementById('modal-root').innerHTML = `
    <div class="modal-backdrop" data-action="backdrop">
      <div class="modal project-editor" role="dialog" aria-modal="true" aria-label="删除项目">
        <div class="modal-head">
          <h2>删除项目</h2>
          <button class="icon-btn" data-action="close-modal" aria-label="关闭">${icon('x', 16)}</button>
        </div>
        <div class="modal-body">
          <p>确定删除「${esc(project.name)}」？</p>
          <p class="muted mt-12">${count} 条关联任务将保留并改为未归属；项目记录将归档。</p>
        </div>
        <div class="modal-foot">
          <button class="btn" data-action="close-modal">取消</button>
          <button class="btn btn-danger" data-action="confirm-delete-project">${icon('trash', 13)} 确认删除</button>
        </div>
      </div>
    </div>`;
}

function openProfileSettings(tab = 'general') {
  const u = DB.user;
  const colors = ['#2F5BE3', '#1F8A70', '#C07A2B', '#6B5BD2', '#B85C7A', '#4C7A3F', '#4B5563'];
  const custom = (DB.settings && DB.settings.customProvider) || {};
  const activeProvider = (DB.settings && DB.settings.aiProvider) || (deepseekKey() ? 'deepseek' : 'local');
  const detected = custom.detected || detectAIProvider(custom.baseUrl, custom.model);
  const builtin = builtinAISettings();
  const builtinActive = builtin.consent === true && builtin.enabled !== false;
  state.profileDraft = { color: u.color, avatarImage: u.avatarImage || '', customProviderActive: activeProvider === 'custom' };
  state.customProviderTested = false;
  state.customProviderFingerprint = '';
  state.customProviderModels = custom.model ? [custom.model] : [];
  state.customProviderAutoModel = custom.model || '';
  state.customProviderSession = {};
  clearTimeout(state.customProviderFetchTimer);
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-backdrop" data-action="backdrop">
      <div class="modal profile-modal" role="dialog" aria-modal="true" aria-label="设置">
        <div class="modal-head">
          <div class="ai-orb">${icon('settings', 16)}</div>
          <div>
            <h2>设置</h2>
          </div>
          <button class="icon-btn" data-action="close-modal" aria-label="关闭">${icon('x', 16)}</button>
        </div>

        <div class="settings-tabs" role="tablist" aria-label="设置分类">
          <button type="button" role="tab" id="settings-tab-general" aria-controls="settings-general" data-action="settings-tab" data-tab="general">通用</button>
          <button type="button" role="tab" id="settings-tab-models" aria-controls="settings-models" data-action="settings-tab" data-tab="models">模型</button>
          <button type="button" role="tab" id="settings-tab-updates" aria-controls="settings-updates" data-action="settings-tab" data-tab="updates">版本与更新</button>
          <button type="button" role="tab" id="settings-tab-about" aria-controls="settings-about" data-action="settings-tab" data-tab="about">关于</button>
        </div>
        <div class="modal-body">
          <section class="settings-pane" id="settings-general" role="tabpanel" aria-labelledby="settings-tab-general" data-settings-pane="general">
          <div class="profile-preview">
            <span class="avatar lg" id="profile-avatar" style="background:${esc(u.color)}">${profileAvatarContent(u)}</span>
            <div>
              <div class="profile-preview-name" id="profile-preview-name">${esc(u.name)}</div>
              <div class="profile-preview-role" id="profile-preview-role">${esc(u.role)}</div>
            </div>
          </div>
          <div class="profile-photo-controls">
            <label class="btn btn-sm profile-photo-upload" for="profile-photo">${icon('upload', 13)} 上传头像
              <input type="file" id="profile-photo" accept="image/png,image/jpeg,image/webp" aria-label="上传头像">
            </label>
            <button class="btn btn-sm" data-action="profile-photo-remove" ${u.avatarImage ? '' : 'hidden'}>移除照片</button>
            <span class="small muted">JPG、PNG、WebP · 最大 5 MB</span>
          </div>
          <p id="profile-photo-status" class="small" role="status" aria-live="polite"></p>

          <div class="form-grid">
            ${window.zhixuDesktop?.updates ? `<div class="field full">
              <button class="btn" data-action="update-settings">${icon('download', 14)} 软件更新</button>
            </div>` : ''}
            ${window.zhixuDesktop?.remoteAccess ? `<div class="field full">
              <button class="btn" data-action="remote-settings">${icon('link', 14)} 网页访问</button>
            </div>` : ''}
            <div class="field full">
              <label>姓名</label>
              <input class="input" id="profile-name" value="${esc(u.name)}" maxlength="20">
            </div>

            <div class="field full">
              <label>角色 / 职位</label>
              <input class="input" id="profile-role" list="role-options" value="${esc(u.role)}" maxlength="30" placeholder="例如：项目负责人">
              <datalist id="role-options">
                <option value="项目负责人">
                <option value="产品经理">
                <option value="技术负责人">
                <option value="交付负责人">
                <option value="设计负责人">
                <option value="独立开发者">
                <option value="团队负责人">
              </datalist>
            </div>

            <div class="field full">
              <label>头像颜色</label>
              <div class="color-swatches">
                ${colors.map(c => `<button class="color-swatch ${c === u.color ? 'on' : ''}" style="background:${c}" data-action="avatar-color" data-color="${c}" aria-label="选择颜色 ${c}"></button>`).join('')}
              </div>
            </div>

          </div>
          </section>
          <section class="settings-pane" id="settings-models" role="tabpanel" aria-labelledby="settings-tab-models" data-settings-pane="models">
          <div class="form-grid">
            <div class="field full settings-field builtin-ai-box">
              <div class="custom-provider-head">
                <label>${icon('sparkles', 11)} 内置免费 AI（体验版）</label>
                <span class="chip ${builtinActive ? 'green' : 'outline'}" id="builtin-ai-current">${builtinActive ? '使用中' : '未启用'}</span>
              </div>
              <label class="builtin-ai-switch"><input type="checkbox" id="builtin-ai-enabled" ${builtin.enabled !== false ? 'checked' : ''}> 未配置自有 Key 时使用内置免费 AI</label>
              <div class="hint">使用内置模式时，你发送的内容会经知序免费中转转发给国内模型供应商处理，每日额度有限；项目、任务等本地数据仍保存在本机。可在下方测试服务或改用自有 Key。</div>
              <details class="provider-advanced full">
                <summary>内置服务设置</summary>
                <div class="form-grid">
                  <div class="field full"><label>内置服务地址</label>
                    <input class="input" id="builtin-ai-base" value="${esc(builtin.baseUrl || '')}" placeholder="https://xxx.workers.dev/v1" autocomplete="off" spellcheck="false"></div>
                  <div class="field"><label for="builtin-ai-model">模型别名</label>
                    <input class="input" id="builtin-ai-model" value="${esc(builtin.model || 'zhixu-free')}" maxlength="80" autocomplete="off" spellcheck="false"></div>
                  <div class="field"><label>设备标识</label>
                    <input class="input" value="${esc(builtin.installId)}" readonly></div>
                </div>
              </details>
              <div class="row gap-6">
                <button class="btn btn-sm" data-action="test-builtin-ai">${icon('zap', 12)} 测试内置服务</button>
                <button class="btn btn-sm" data-action="free-key-guide">${icon('link', 12)} 获取免费 API Key</button>
                <button class="btn btn-sm" data-action="builtin-repeat-consent">${icon('shield', 12)} 查看隐私说明</button>
              </div>
              <div class="hint" id="builtin-ai-status" role="status" aria-live="polite"></div>
            </div>
            <details class="provider-quick full">
              <summary>DeepSeek 快速接入</summary>
            <div class="field full settings-field">
              <label>${icon('zap', 11)} DeepSeek API Key ${activeProvider === 'deepseek' ? '<span class="chip green">当前</span>' : ''}</label>
              <div class="row gap-6">
                <input class="input" id="profile-deepseek-key" type="password" value="${esc(DB.settings.deepseekKey || '')}" placeholder="sk-..." autocomplete="off" spellcheck="false" style="flex:1">
                <button class="btn btn-sm" data-action="test-deepseek">${icon('zap', 11)} 测试连接</button>
              </div>
              <div class="hint" id="deepseek-test-result">填写密钥后测试连接。</div>
            </div>
            </details>
            <div class="field full settings-field custom-provider-box">
              <div class="custom-provider-head">
                <label>${icon('link', 11)} 模型连接</label>
                <span class="chip ${activeProvider === 'custom' ? 'green' : 'outline'}" id="custom-provider-current">${activeProvider === 'custom' ? '使用中' : '未连接'}</span>
              </div>
              <div class="custom-provider-grid">
                <div class="field full">
                  <label>API 地址</label>
                  <input class="input" id="custom-provider-base" value="${esc(custom.baseUrl || '')}" placeholder="https://api.openai.com/v1" autocomplete="off" spellcheck="false">
                </div>
                <div class="field full">
                  <label>API Key</label>
                  <div class="row gap-6">
                    <input class="input" id="custom-provider-key" type="password" value="${esc(custom.apiKey || '')}" placeholder="sk-..." autocomplete="off" spellcheck="false" style="flex:1">
                  </div>
                </div>
                <div class="field full">
                  <label for="custom-provider-model-select">模型</label>
                  <div class="provider-model-controls">
                    <select class="select" id="custom-provider-model-select"><option value="">填写地址与密钥后自动获取</option>
                      ${custom.model ? `<option value="${esc(custom.model)}" selected>${esc(custom.model)}</option>` : ''}</select>
                    <button class="btn btn-sm" data-action="fetch-custom-models">${icon('refresh', 12)} 获取模型</button>
                  </div>
                </div>
                <details class="provider-advanced full">
                  <summary>高级设置</summary>
                  <div class="form-grid">
                    <div class="field"><label>供应商名称</label>
                      <input class="input" id="custom-provider-name" value="${esc(custom.name || '')}" placeholder="自动识别" maxlength="30"></div>
                    <div class="field"><label for="custom-provider-protocol">协议</label>
                      <select class="select" id="custom-provider-protocol">
                        ${[['auto', '自动识别'], ['chat', 'Chat Completions'], ['responses', 'Responses API']].map(([value, label]) =>
                          `<option value="${value}" ${value === (custom.protocol || 'auto') ? 'selected' : ''}>${label}</option>`).join('')}
                      </select></div>
                    <div class="field full"><label for="custom-provider-model">手动填写模型</label>
                      <input class="input" id="custom-provider-model" value="${esc(custom.model || '')}" placeholder="模型 ID" maxlength="120" autocomplete="off" spellcheck="false"></div>
                  </div>
                </details>
              </div>
              <div class="custom-provider-detected">
                <span class="tiny muted">供应商</span>
                <span class="chip outline" id="custom-provider-detected">${esc(detected || '等待输入')}</span>
              </div>
              <div class="hint" id="custom-provider-result" role="status" aria-live="polite">填写地址与密钥后获取模型。诊断会发送测试请求，可能产生少量费用。</div>
              <button class="btn btn-sm" data-action="test-custom-provider">${icon('zap', 12)} 诊断供应商</button>
              <div id="custom-provider-diagnosis" class="provider-diagnosis" aria-live="polite"></div>
            </div>
          </div>
          </section>
          <section class="settings-pane" id="settings-updates" role="tabpanel" aria-labelledby="settings-tab-updates" data-settings-pane="updates">
            <div class="settings-stack">
              <section class="settings-card">
                <div class="settings-card-body">
                  <div class="settings-card-title">软件更新</div>
                  <p class="settings-card-desc">更新源为 GitHub 公开仓库，无需登录；下载完成后由你决定何时重启安装。</p>
                  <div class="update-version-row">
                    <span id="update-current-version" class="update-current">当前版本 —</span>
                    <span id="update-target-version" class="chip green" hidden></span>
                  </div>
                  <p id="update-status" class="remote-feedback settings-status" role="status" aria-live="polite">正在读取更新状态…</p>
                  <progress id="update-progress" max="100" value="0" hidden></progress>
                  <p id="update-checked-at" class="settings-meta"></p>
                </div>
                <div class="settings-card-side">
                  <button class="btn btn-sm" data-action="update-check">${icon('refresh', 13)} 检查更新</button>
                  <button class="btn btn-primary btn-sm" data-action="update-install" hidden>${icon('download', 13)} 重启并更新</button>
                </div>
              </section>
              <section class="settings-card">
                <div class="settings-card-body">
                  <div class="settings-card-title">自动检查更新</div>
                  <p class="settings-card-desc">启动约 15 秒后检查，此后每 6 小时检查一次。发现新版本后在后台下载，不会打断当前工作。</p>
                </div>
                <label class="switch" title="自动检查更新">
                  <input type="checkbox" id="update-automatic" aria-label="自动检查并下载更新">
                  <span class="switch-track" aria-hidden="true"></span>
                </label>
              </section>
              <p class="settings-note">${icon('shield', 12)} 安装会沿用原安装位置与「知序」快捷方式，并在覆盖前备份本机数据。</p>
            </div>
          </section>
          <section class="settings-pane" id="settings-about" role="tabpanel" aria-labelledby="settings-tab-about" data-settings-pane="about">
            <div class="settings-stack">
              <div class="about-hero">
                <span class="about-mark">${brandImage()}</span>
                <div class="about-hero-text">
                  <h3>知序</h3>
                  <p>把项目、任务、材料与对话收在一处的本地优先工作台。</p>
                </div>
                <span class="chip outline about-version" id="about-current-version">—</span>
              </div>
              <section class="settings-card">
                <div class="settings-card-body">
                  <div class="settings-card-title">版本与更新</div>
                  <p class="settings-card-desc">检查公开版本并安装修复。下载完成前不会影响当前工作。</p>
                </div>
                <div class="settings-card-side">
                  <button class="btn btn-sm" data-action="settings-tab" data-tab="updates">查看更新</button>
                </div>
              </section>
              <section class="settings-card">
                <div class="settings-card-body">
                  <div class="settings-card-title">开源仓库</div>
                  <p class="settings-card-desc">源代码、版本说明和安装包发布在 GitHub。</p>
                  <code class="about-link-text">github.com/HULI-J/ZHIXU</code>
                </div>
                <div class="settings-card-side">
                  <button class="btn btn-sm" data-action="open-external" data-url="https://github.com/HULI-J/ZHIXU">${icon('link', 12)} 打开仓库</button>
                </div>
              </section>
              <section class="settings-card">
                <div class="settings-card-body">
                  <div class="settings-card-title">问题反馈</div>
                  <p class="settings-card-desc">遇到问题或有改进建议，可以在 GitHub 提交反馈。</p>
                </div>
                <div class="settings-card-side">
                  <button class="btn btn-sm" data-action="open-external" data-url="https://github.com/HULI-J/ZHIXU/issues/new">${icon('message', 12)} 提交反馈</button>
                </div>
              </section>
              <section class="settings-card">
                <div class="settings-card-body">
                  <div class="settings-card-title">数据与隐私</div>
                  <p class="settings-card-desc">工作数据保存在本机，不会上传到 GitHub。默认位置为 %APPDATA%\\Zhixu；升级时自动迁移旧版默认目录并保留原数据，自定义位置继续沿用。实际位置如下。</p>
                  <code class="about-link-text" id="data-location-path">正在读取数据位置…</code>
                  <p class="settings-meta" id="data-location-note" hidden></p>
                </div>
                <div class="settings-card-side">
                  <button class="btn btn-sm" data-action="data-location-open">${icon('folder', 12)} 打开文件夹</button>
                  <button class="btn btn-sm" data-action="data-location-change">${icon('folder', 12)} 更改位置</button>
                </div>
              </section>
              <p class="about-foot">© 2026 知序 · 本地优先 · 更新源为 GitHub Releases</p>
            </div>
          </section>
        </div>

        <div class="modal-foot">
          <button class="btn" id="settings-cancel" data-action="close-modal">取消</button>
          <button class="btn btn-primary" id="settings-save" data-action="save-profile">${icon('check', 13)} 保存</button>
        </div>
      </div>
    </div>
  `;
  switchSettingsTab(tab);
}

function switchSettingsTab(tab) {
  const selected = ['general', 'models', 'updates', 'about'].includes(tab) ? tab : 'general';
  document.querySelectorAll('[data-settings-pane]').forEach(pane => {
    pane.hidden = pane.dataset.settingsPane !== selected;
  });
  document.querySelectorAll('[data-action="settings-tab"]').forEach(button => {
    button.setAttribute('aria-selected', String(button.dataset.tab === selected));
    button.tabIndex = button.dataset.tab === selected ? 0 : -1;
  });
  const editingProfile = selected === 'general' || selected === 'models';
  const save = document.getElementById('settings-save');
  if (save) save.hidden = !editingProfile;
  const cancel = document.getElementById('settings-cancel');
  if (cancel) cancel.textContent = editingProfile ? '取消' : '关闭';
  if (selected === 'updates') {
    if (desktopUpdateStatus) paintDesktopUpdate(desktopUpdateStatus);
    void refreshDesktopUpdatePane();
  }
  if (selected === 'about') {
    const version = document.getElementById('about-current-version');
    if (version && desktopUpdateStatus) version.textContent = `v${desktopUpdateStatus.currentVersion}`;
    void refreshDataLocation();
  }
}

function setAvatarColor(color) {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return;
  state.profileDraft.color = color;
  state.profileDraft.avatarImage = '';
  document.querySelectorAll('.color-swatch').forEach(el => {
    el.classList.toggle('on', el.dataset.color === color);
  });
  refreshProfileAvatar();
}

function refreshProfileAvatar() {
  const av = document.getElementById('profile-avatar');
  if (av) {
    av.style.background = state.profileDraft.color;
    av.innerHTML = profileAvatarContent({ ...state.profileDraft,
      initials: deriveInitials(document.getElementById('profile-name')?.value || DB.user.name) });
  }
  const remove = document.querySelector('[data-action="profile-photo-remove"]');
  if (remove) remove.hidden = !state.profileDraft.avatarImage;
}

function removeProfilePhoto() {
  state.profileDraft.avatarImage = '';
  const input = document.getElementById('profile-photo');
  if (input) input.value = '';
  refreshProfileAvatar();
}

async function importProfilePhoto(input) {
  const file = input.files?.[0];
  if (!file) return;
  const draft = state.profileDraft;
  const status = document.getElementById('profile-photo-status');
  const save = document.querySelector('[data-action="save-profile"]');
  draft.photoBusy = true;
  if (save) save.disabled = true;
  status.textContent = '正在读取头像…';
  try {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('请选择 JPG、PNG 或 WebP 图片');
    if (file.size > 5 * 1024 * 1024) throw new Error('头像不能超过 5 MB');
    const source = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('图片读取失败，请重新选择'));
      reader.readAsDataURL(file);
    });
    const image = new Image();
    image.src = source;
    await image.decode();
    if (!image.naturalWidth || image.naturalWidth * image.naturalHeight > 25000000) throw new Error('图片尺寸过大，请缩小至 2500 万像素以内');
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 192;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 192, 192);
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    ctx.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, 192, 192);
    if (state.profileDraft !== draft || !input.isConnected) return;
    draft.avatarImage = canvas.toDataURL('image/jpeg', .88);
    refreshProfileAvatar();
    status.textContent = '头像已选好，保存后生效。';
  } catch (error) {
    if (state.profileDraft === draft && input.isConnected) status.textContent =
      '头像读取失败：' + (error.message?.includes('图片') || error.message?.includes('头像') || error.message?.includes('请选择')
        ? error.message : '图片损坏或无法识别，请重新选择');
  } finally {
    draft.photoBusy = false;
    if (save?.isConnected) save.disabled = false;
    input.value = '';
  }
}

async function saveProfile() {
  if (state.profileDraft.photoBusy) return;
  const nameEl = document.getElementById('profile-name');
  const roleEl = document.getElementById('profile-role');
  const deepseekEl = document.getElementById('profile-deepseek-key');
  const customNameEl = document.getElementById('custom-provider-name');
  const customModelEl = document.getElementById('custom-provider-model');
  const customBaseEl = document.getElementById('custom-provider-base');
  const customKeyEl = document.getElementById('custom-provider-key');
  if (!nameEl || !roleEl) return;

  const oldName = DB.user.name;
  const name = nameEl.value.trim() || oldName;
  const role = roleEl.value.trim() || '项目负责人';
  const workspace = name + '的工作台';
  const initials = deriveInitials(name);
  const color = state.profileDraft.color || DB.user.color;
  const deepseek = deepseekEl ? deepseekEl.value.trim() : String((DB.settings && DB.settings.deepseekKey) || '');
  const customName = customNameEl ? customNameEl.value.trim() : '';
  let customModel = customModelEl ? customModelEl.value.trim() : '';
  const customBase = customBaseEl ? customBaseEl.value.trim().replace(/\/+$/, '') : '';
  const customKey = customKeyEl ? customKeyEl.value.trim() : '';
  const builtinEnabledEl = document.getElementById('builtin-ai-enabled');
  const builtinBaseEl = document.getElementById('builtin-ai-base');
  const builtinModelEl = document.getElementById('builtin-ai-model');
  if (customBase && customKey && !customModel) {
    await fetchCustomProviderModels();
    customModel = customModelEl ? customModelEl.value.trim() : '';
    if (document.getElementById('profile-name') !== nameEl) return;
    if (customBaseEl.value.trim().replace(/\/+$/, '') !== customBase || customKeyEl.value.trim() !== customKey) {
      showToast('供应商配置已改变，请重新保存');
      return;
    }
  }
  const customHasAny = !!(customName || customModel || customBase || customKey);

  if (customHasAny && !(customBase && customKey && customModel)) {
    showToast('自定义供应商需要填写 Base URL、API Key 和模型');
    return;
  }

  DB.user.name = name;
  DB.user.role = role;
  DB.user.workspace = workspace;
  DB.user.initials = initials;
  DB.user.color = color;
  DB.user.avatarImage = state.profileDraft.avatarImage || '';
  DB.settings = DB.settings || {};
  DB.settings.deepseekKey = deepseek;
  {
    const b = builtinAISettings();
    if (builtinEnabledEl) b.enabled = !!builtinEnabledEl.checked;
    if (builtinBaseEl) b.baseUrl = builtinBaseEl.value.trim().replace(/\/+$/, '');
    if (builtinModelEl) b.model = builtinModelEl.value.trim() || BUILTIN_AI_MODEL;
  }

  if (customHasAny) {
    const detected = detectAIProvider(customBase, customModel);
    const resolvedName = customName || detected || '自定义供应商';
    DB.settings.customProvider = {
      name: resolvedName,
      baseUrl: customBase,
      apiKey: customKey,
      model: customModel,
      protocol: document.getElementById('custom-provider-protocol')?.value || 'auto',
      detected,
      testedAt: state.customProviderTested && state.customProviderFingerprint === customProviderFingerprint()
        ? new Date().toISOString()
        : ''
    };
    DB.settings.aiProvider = 'custom';
  } else {
    delete DB.settings.customProvider;
    DB.settings.aiProvider = deepseek ? 'deepseek' : 'local';
  }
  state.chatModel = chatModelLabel();
  try { storageSet('jw-chat-model', state.chatModel); } catch (e) { /* ignore */ }

  DB.projects.forEach(p => {
    if (p.owner === oldName) p.owner = name;
  });
  Object.values(DB.projectDetails || {}).forEach(d => {
    (d.stakeholders || []).forEach(s => {
      if (s.name === oldName) s.name = name;
    });
  });

  try { storageSet('jw-profile', JSON.stringify({ name, role, color, avatarImage: DB.user.avatarImage })); } catch (e) { /* ignore */ }
  saveSettings();
  closeModal();
  render();
  showToast('设置已保存');
}

function builtinConsentModal() {
  localModal('启用内置免费 AI', `
    <p>未配置自有 API Key 时，知序可以使用<strong>内置免费 AI（体验版）</strong>完成对话、事项解析、润色与文档分析。</p>
    <p class="small muted mt-12">开启后，你发送的文本内容会经知序的免费中转服务（Cloudflare Worker）转发给国内模型供应商处理。这与“数据只留在本机”的默认方式不同；项目、任务、聊天记录等本地数据仍保存在本机。中转按匿名设备标识和 IP 限流，每日额度有限，用尽后会回退本地规则。</p>
    <ul class="small muted mt-12">
      <li>你可以随时在“设置 → 模型”中关闭内置免费 AI 或改用自有 Key。</li>
      <li>请勿在内置模式中输入密码、密钥等敏感信息。</li>
    </ul>`,
    `<button class="btn" data-action="builtin-consent-decline">暂不使用</button>
     <button class="btn btn-primary" data-action="builtin-consent-accept">${icon('check', 13)} 同意并启用</button>`,
    'builtin-consent');
}

// 首次进入且从未表态时，弹出显式同意；已同意或已拒绝则不再打扰。
function showBuiltinConsentIfNeeded() {
  const b = builtinAISettings();
  if (!b || typeof b.consent === 'boolean' || b.enabled === false) return false;
  const root = document.getElementById('modal-root');
  if (!root || root.innerHTML.trim()) return false;
  builtinConsentModal();
  return true;
}

async function testBuiltinAI() {
  const b = builtinAISettings();
  const status = document.getElementById('builtin-ai-status');
  const base = (document.getElementById('builtin-ai-base')?.value || '').trim().replace(/\/+$/, '');
  const model = (document.getElementById('builtin-ai-model')?.value || '').trim() || BUILTIN_AI_MODEL;
  if (!base) { if (status) status.textContent = '请先填写内置服务地址（部署 worker 后得到）。'; return; }
  if (status) status.textContent = '正在连接内置服务…';
  if (!window.zhixuDesktop || typeof window.zhixuDesktop.providerDiagnose !== 'function') {
    if (status) status.textContent = '内置服务测试请在桌面版进行。'; return;
  }
  try {
    const report = await window.zhixuDesktop.providerDiagnose({ baseUrl: base, apiKey: 'zxf_' + b.installId, model, protocol: 'chat' });
    if (status) status.textContent = report && report.ok
      ? `连接正常 · ${report.model || model}`
      : '连接失败：' + ((report && report.suggestion) || '请检查服务地址与部署状态');
  } catch (error) {
    if (status) status.textContent = '连接失败：' + ((error && error.message) || '未知错误');
  }
}

function openFreeKeyGuide() {
  const items = FREE_API_PROVIDERS.map(p => `
    <button class="btn free-key-item" data-action="free-key-provider" data-id="${esc(p.id)}">
      <div class="free-key-item-head"><b>${esc(p.name)}</b><span class="chip outline">${esc(p.tag)}</span></div>
      <p class="small muted">${esc(p.freeNote)}</p>
    </button>`).join('');
  localModal('获取免费 API Key', `
    <p>内置免费 AI 的体验额度有限。你也可以使用自己的免费 API Key：在国内厂商注册领取免费额度后，把 Key 粘贴进来即可长期使用，额度与费用都由你自己掌控。</p>
    <p class="small muted mt-8">用自己的 Key 时，内容会直接发给你选择的厂商，不再经过知序中转；Key 保存在本机加密设置中。</p>
    <div class="free-key-list">${items}</div>`,
    `<button class="btn" data-action="close-modal">关闭</button>`, 'free-key-guide');
}

function openFreeKeyProvider(id) {
  const p = FREE_API_PROVIDERS.find(item => item.id === id);
  if (!p) return;
  localModal('获取 ' + p.name + ' API Key', `
    <ol class="small free-key-steps">${p.steps.map(step => `<li>${esc(step)}</li>`).join('')}</ol>
    <div class="row gap-6 mt-8">
      <button class="btn btn-sm" data-action="free-key-open-site" data-url="${esc(p.signupUrl)}">${icon('link', 12)} 打开注册页</button>
      <button class="btn btn-sm" data-action="free-key-open-site" data-url="${esc(p.consoleUrl)}">${icon('link', 12)} 打开密钥页</button>
    </div>
    <div class="form-grid mt-12">
      <div class="field full"><label>API Key</label><input class="input" id="free-key-input" type="password" placeholder="sk-..." autocomplete="off" spellcheck="false"></div>
      <div class="field full"><label>API 地址</label><input class="input" id="free-key-base" value="${esc(p.baseUrl)}" autocomplete="off" spellcheck="false"></div>
      <div class="field"><label>模型</label><input class="input" id="free-key-model" value="${esc(p.model)}" placeholder="模型 ID" autocomplete="off" spellcheck="false"></div>
    </div>
    <div class="hint" id="free-key-status" role="status" aria-live="polite">填写后点「测试并保存」，会真实发送一次测试请求。</div>`,
    `<button class="btn" data-action="free-key-guide">返回</button>
     <button class="btn btn-primary" data-action="free-key-test-save" data-id="${esc(p.id)}">${icon('check', 13)} 测试并保存</button>`,
    'free-key-provider');
}

async function testAndSaveFreeKey(id) {
  const p = FREE_API_PROVIDERS.find(item => item.id === id);
  const key = (document.getElementById('free-key-input')?.value || '').trim();
  const base = (document.getElementById('free-key-base')?.value || '').trim().replace(/\/+$/, '');
  const model = (document.getElementById('free-key-model')?.value || '').trim();
  const status = document.getElementById('free-key-status');
  if (!key || !base || !model) { if (status) status.textContent = '请填写 API Key、API 地址和模型。'; return; }
  if (!window.zhixuDesktop || typeof window.zhixuDesktop.providerDiagnose !== 'function') {
    if (status) status.textContent = '测试并保存请在桌面版进行。'; return;
  }
  if (status) status.textContent = '正在测试连接…';
  try {
    const report = await window.zhixuDesktop.providerDiagnose({ baseUrl: base, apiKey: key, model, protocol: 'auto' });
    if (!report || !report.ok) {
      if (status) status.textContent = '连接失败：' + ((report && report.suggestion) || '请检查 Key、地址与模型是否正确');
      return;
    }
    DB.settings = DB.settings || {};
    DB.settings.customProvider = {
      name: (p && p.name) || '自定义供应商', baseUrl: base, apiKey: key,
      model: report.model || model, protocol: report.protocol || 'auto',
      detected: (p && p.name) || '', testedAt: new Date().toISOString()
    };
    DB.settings.aiProvider = 'custom';
    saveSettings();
    closeModal();
    render();
    showToast('已保存 ' + ((p && p.name) || '供应商') + '，后续优先使用自有 Key');
  } catch (error) {
    if (status) status.textContent = '连接失败：' + ((error && error.message) || '未知错误');
  }
}

async function testDeepSeek() {
  const input = document.getElementById('profile-deepseek-key');
  const hint = document.getElementById('deepseek-test-result');
  const key = input ? input.value.trim() : '';
  if (!key) {
    if (hint) hint.textContent = '请先填入 DeepSeek API Key。';
    showToast('请先填入 DeepSeek API Key');
    return;
  }
  if (hint) hint.textContent = '正在连接 DeepSeek…';
  try {
    const res = await requestPolish({ text: '测试连接', tone: '简洁', apiKey: key, model: 'deepseek-chat' });
    let data = null;
    try { data = await res.json(); } catch (err) { /* static server may return HTML */ }
    if (!res.ok) {
      if (res.status === 404 || res.status === 501) {
        throw new Error('未启动代理，请用 python server.py 启动预览');
      }
      throw new Error((data && (data.message || data.error)) || `HTTP ${res.status}`);
    }
    if (hint) hint.textContent = '连接成功 · DeepSeek 可用。保存后会用于润色。';
    showToast('DeepSeek 连接成功');
  } catch (err) {
    if (hint) hint.textContent = '连接失败：' + ((err && err.message) || '未知错误');
    showToast('DeepSeek 连接失败');
  }
}

function updateCustomProviderDetection() {
  const baseEl = document.getElementById('custom-provider-base');
  const modelEl = document.getElementById('custom-provider-model');
  const nameEl = document.getElementById('custom-provider-name');
  const detectedEl = document.getElementById('custom-provider-detected');
  if (!detectedEl) return;
  const detected = detectAIProvider(baseEl ? baseEl.value : '', modelEl ? modelEl.value : '');
  detectedEl.textContent = detected || '等待输入';
  detectedEl.className = 'chip ' + (detected && detected !== 'OpenAI 兼容' ? 'green' : 'outline');
  if (nameEl && !nameEl.value.trim()) nameEl.placeholder = detected || '自动识别';
}

function customProviderForm() {
  return { baseUrl: document.getElementById('custom-provider-base')?.value.trim().replace(/\/+$/, '') || '',
    apiKey: document.getElementById('custom-provider-key')?.value.trim() || '',
    model: document.getElementById('custom-provider-model')?.value.trim() || '',
    protocol: document.getElementById('custom-provider-protocol')?.value || 'auto' };
}

function customProviderFingerprint() { return JSON.stringify(customProviderForm()); }

function invalidateCustomProvider(id) {
  state.customProviderTested = false;
  state.customProviderFingerprint = '';
  const panel = document.getElementById('custom-provider-diagnosis');
  if (panel) panel.innerHTML = '';
  const current = document.getElementById('custom-provider-current');
  if (current) { current.className = 'chip outline'; current.textContent = '配置已修改，待诊断'; }
  const select = document.getElementById('custom-provider-model-select');
  if (id === 'custom-provider-model') {
    state.customProviderAutoModel = '';
    if (select) select.value = customProviderForm().model;
  }
  if (['custom-provider-base', 'custom-provider-key'].includes(id)) {
    const model = document.getElementById('custom-provider-model');
    if (model && model.value === state.customProviderAutoModel) model.value = '';
    state.customProviderAutoModel = '';
    state.customProviderModels = [];
    if (select) select.innerHTML = '<option value="">等待获取模型</option>';
    clearTimeout(state.customProviderFetchTimer);
    const session = state.customProviderSession;
    state.customProviderFetchTimer = setTimeout(() => {
      if (session === state.customProviderSession && document.getElementById('custom-provider-key')) {
        const config = customProviderForm();
        if (config.baseUrl && config.apiKey) void fetchCustomProviderModels();
      }
    }, 1000);
  }
}

function fillCustomProviderModels(models) {
  const input = document.getElementById('custom-provider-model');
  const select = document.getElementById('custom-provider-model-select');
  if (!input || !select) return;
  state.customProviderModels = models;
  if (!input.value.trim()) {
    input.value = models.find(model => !/embed|rerank|whisper|tts|image|dall-e|moderation|audio|video/i.test(model)) || '';
    state.customProviderAutoModel = input.value;
  }
  select.innerHTML = '<option value="">手动填写模型</option>' + models.map(model =>
    `<option value="${esc(model)}">${esc(model)}</option>`).join('');
  select.value = models.includes(input.value) ? input.value : '';
  updateCustomProviderDetection();
}

async function fetchCustomProviderModels() {
  clearTimeout(state.customProviderFetchTimer);
  const config = customProviderForm();
  const hint = document.getElementById('custom-provider-result');
  const session = state.customProviderSession;
  const requestId = state.customProviderModelsRequest = {};
  if (!hint) return;
  if (!config.baseUrl || !config.apiKey) { hint.textContent = '请填写 API 地址与 API Key。'; return; }
  if (!window.zhixuDesktop?.providerModels) { hint.textContent = '模型自动获取与接口诊断请使用更新后的桌面版。'; return; }
  hint.textContent = '正在从供应商获取模型列表…';
  try {
    const result = await window.zhixuDesktop.providerModels(config);
    const now = customProviderForm();
    if (state.customProviderSession !== session || !hint.isConnected || requestId !== state.customProviderModelsRequest ||
        now.baseUrl !== config.baseUrl || now.apiKey !== config.apiKey) return;
    fillCustomProviderModels(result.models);
    hint.textContent = `已获取 ${result.models.length} 个模型${now.model && !result.models.includes(now.model) ? '；当前手填模型未在列表中，已保留，请诊断确认。' : '，可在列表中选择。'}`;
  } catch (error) {
    const now = customProviderForm();
    if (state.customProviderSession !== session || !hint.isConnected || requestId !== state.customProviderModelsRequest ||
        now.baseUrl !== config.baseUrl || now.apiKey !== config.apiKey) return;
    hint.textContent = '模型获取失败：' + documentFailureReason(error) + '；可重试，或手动填写模型后诊断。';
  }
}

async function testCustomProvider() {
  clearTimeout(state.customProviderFetchTimer);
  state.customProviderModelsRequest = {};
  const config = customProviderForm();
  const fingerprint = customProviderFingerprint();
  const session = state.customProviderSession;
  const hint = document.getElementById('custom-provider-result');
  const panel = document.getElementById('custom-provider-diagnosis');
  const button = document.querySelector('[data-action="test-custom-provider"]');
  if (!hint || !panel || button?.disabled) return;
  if (!window.zhixuDesktop?.providerDiagnose) { hint.textContent = '接口诊断请使用更新后的桌面版。'; return; }
  state.customProviderTested = false;
  hint.textContent = '正在检查配置、模型列表与真实文本请求…';
  panel.innerHTML = '';
  if (button) button.disabled = true;
  try {
    const report = await window.zhixuDesktop.providerDiagnose(config);
    if (session !== state.customProviderSession || !panel.isConnected || fingerprint !== customProviderFingerprint()) return;
    if (report.models.length) fillCustomProviderModels(report.models);
    if (report.model && !document.getElementById('custom-provider-model').value) {
      document.getElementById('custom-provider-model').value = report.model;
    }
    if (report.ok && report.protocol) document.getElementById('custom-provider-protocol').value = report.protocol;
    state.customProviderTested = report.ok;
    state.customProviderFingerprint = report.ok ? customProviderFingerprint() : '';
    panel.innerHTML = [...report.checks, { name: '处理建议', status: report.ok ? 'pass' : 'warn', detail: report.suggestion }]
      .map(check => `<div class="provider-check ${check.status}">
        <b>${icon(check.status === 'pass' ? 'check' : check.status === 'fail' ? 'x' : 'alert', 14)} ${esc(check.name)}
          <span>${check.status === 'pass' ? '通过' : check.status === 'fail' ? '失败' : '需留意'}</span></b>
        ${check.endpoint ? `<p class="provider-endpoint">${esc(check.endpoint)}</p>` : ''}
        <p>${esc(check.detail)}</p>${check.durationMs != null ? `<small>${check.durationMs} ms</small>` : ''}</div>`).join('');
    hint.textContent = report.ok ? '真实请求通过；保存后使用此配置。' : '诊断未通过；输入内容已保留，请按以下原因修正。';
    const current = document.getElementById('custom-provider-current');
    if (current) { current.className = 'chip ' + (report.ok ? 'green' : 'outline'); current.textContent = report.ok ? '已验证，待保存' : '诊断失败'; }
  } catch (error) {
    if (session === state.customProviderSession && panel.isConnected && fingerprint === customProviderFingerprint()) {
      hint.textContent = '诊断失败：' + documentFailureReason(error);
    }
  } finally { if (button?.isConnected) button.disabled = false; }
}

function workflowRuleRows(rules) {
  return rules.map(r => `
    <div class="workflow-rule">
      <span class="wr-icon">${icon(r.icon, 12)}</span>
      <div>
        <div class="wr-title">${esc(r.title)}</div>
        <div class="wr-text">${esc(r.text)}</div>
      </div>
    </div>
  `).join('');
}

function updateWorkflowChrome() {
  const list = document.getElementById('workflow-rules');
  if (list) list.innerHTML = workflowRuleRows(DB.workflow.rules);
  const version = document.getElementById('workflow-version');
  if (version) version.textContent = `v${DB.workflow.version} · ${DB.workflow.updated}`;
  try { storageSet('jw-workflow', JSON.stringify(DB.workflow)); } catch (e) { /* ignore */ }
}

function parseWorkflow() {
  const ta = document.getElementById('workflow-input');
  if (!ta) return;
  const text = ta.value.trim();
  if (!text) {
    showToast('先写一句你的工作流，再解析');
    return;
  }

  const rules = [];
  const add = (iconName, title, ruleText) => {
    if (!rules.some(r => r.title === title)) rules.push({ icon: iconName, title, text: ruleText });
  };

  if (/飞书|钉钉|企业微信|企微/.test(text)) add('message', '来源', '聊天工具里的承诺先进入收件箱，不直接改项目');
  if (/老板|领导|上级/.test(text)) add('user', '触发', '老板/领导消息 → 标记高优先级，进入待确认');
  if (/星火|项目/.test(text)) add('folder', '归属', '命中项目别名 → 自动归属；不确定时给候选');
  if (/截止|ddl|DDL|时间/.test(text)) add('clock', '截止', '按原话解析；模糊时追问一次，不猜');
  if (/排不下|插单|影响|冲突|接不接/.test(text)) add('zap', '冲突', '今日排不下 → 先展示插单影响与取舍');
  if (/每天|09:30|9:30|提醒|简报/.test(text)) add('bell', '提醒', '每天 09:30 推送今日必做 + 等待墙');
  if (/会议|行动项/.test(text)) add('calendar', '会议', '会议结束 10 分钟内提取行动项，必须有负责人和截止');
  if (/日报|周报/.test(text)) add('file', '输出', '按事实生成日报/周报，AI 只写叙述');
  if (!rules.length) add('lightbulb', '自定义', '已记录描述；建议补充触发条件、归属规则和提醒时间');

  DB.workflow.text = text;
  DB.workflow.rules = rules;
  DB.workflow.version += 1;
  DB.workflow.updated = '刚刚';
  updateWorkflowChrome();
  showToast(`已提取 ${rules.length} 条规划草稿`);
}

function saveWorkflow() {
  const ta = document.getElementById('workflow-input');
  if (!ta) return;
  DB.workflow.text = ta.value.trim();
  DB.workflow.updated = '刚刚';
  updateWorkflowChrome();
  showToast('工作约定已保存');
}

const workflowTemplates = {
  boss: '老板在飞书派活时，先判断是不是星火项目；截止时间按老板原话算。如果今天排不下，先给我看会挤掉什么，再决定接不接。每天 9:30 把今日必做和等待墙发给我。',
  meeting: '开完会 10 分钟内，把行动项提取到收件箱；每条必须有负责人和截止时间。没有负责人的，归到我名下并标记待确认。',
  client: '客户邮件进来先判断项目；涉及承诺的交期先做产能校验。超过 2h 的任务自动拆成 3 个子任务，并在日报里单独列出。'
};

function applyWorkflowTemplate(key) {
  const ta = document.getElementById('workflow-input');
  if (!ta || !workflowTemplates[key]) return;
  ta.value = workflowTemplates[key];
  ta.focus();
  showToast('已插入示例，可继续改成你的说法');
}

function openCapture(projectId = null) {
  state.captureProjectId = projectById(projectId)?.id || null;
  state.captureDraft = null;
  state.captureParsed = false;
  const provider = aiProviderConfig();
  const sample = '老板说：星火下周要给客户演示，你把这周的联调问题整理一下，周三前发我，顺便把演示环境也准备下。';
  const sources = ['飞书', '邮件', '会议', '自己'];
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-backdrop" data-action="backdrop">
      <div class="modal capture-modal" role="dialog" aria-modal="true" aria-label="添加事项">
        <div class="modal-head">
          <div class="ai-orb">${icon('sparkles', 16)}</div>
          <div>
            <h2>添加事项</h2>
          </div>
          <button class="icon-btn" data-action="close-modal" aria-label="关闭">${icon('x', 16)}</button>
        </div>

        <div class="modal-body">
          <div class="capture-source">
            ${sources.map(s => `<button class="chip ${state.captureSource === s ? 'on' : ''}" data-action="capture-source" data-source="${s}">${s}</button>`).join('')}
          </div>

          <div class="capture-area">
            <textarea id="capture-text" maxlength="12000" placeholder="${esc(sample)}"></textarea>
          </div>

          <div id="capture-result"></div>
        </div>

        <div class="modal-foot capture-actions">
          <div class="left">
            <span class="chip" id="capture-engine">${esc(provider.id === 'local' ? '本地规则' : provider.model)}</span>
          </div>
          <p class="capture-feedback tiny muted" id="capture-feedback" role="status"></p>
          <div class="capture-buttons">
          <button class="btn" data-action="close-modal">取消</button>
          <button class="btn btn-primary" id="parse-btn" data-action="parse">${icon('sparkles', 13)} 解析</button>
          <button class="btn btn-primary" id="capture-save" data-action="confirm-capture" hidden>${icon('check', 13)} 确认保存</button>
          </div>
        </div>
      </div>
    </div>
  `;
  setTimeout(() => {
    const ta = document.getElementById('capture-text');
    if (ta) {
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }
  }, 60);
}

function deriveCaptureTitle(text) {
  return text.trim()
    .replace(/^(?:老板|客户|领导|[\u4e00-\u9fff]{1,4}(?:总|经理))说[：:，,\s]*/, '')
    .replace(/^[^：:\n]{1,30}项目[：:]\s*/, '')
    .replace(/^(?:那个[，,\s]*|就是[，,\s]*)/, '')
    .replace(/^我(?:明天|后天|今天)?(?:想要|需要|打算|准备|要|想)?(?:去)?给/, '为')
    .replace(/^我(?:明天|后天|今天)?(?:想要|需要|打算|准备|要|想)(?:去)?/, '')
    .replace(/^(?:请你|帮我|麻烦你|你)(?:帮我)?(?:把|将)?/, '')
    .replace(/^把/, '')
    .replace(/(?:弄一下|弄下|搞一下|搞下)/g, '整理')
    .replace(/(?:整理|处理|检查|准备|核对)(?:一下|下)(?=[，,。；;\s]|$)/g, match => match.replace(/一下$|下$/, ''))
    .replace(/[，,]\s*(?:预计|大约|大概)?\s*\d+(?:\.\d+)?\s*(?:小时|h\b)/gi, '')
    .replace(/[，,]\s*(?:今天|明天|后天)完成[。！!]?$/, '')
    .replace(/[。！？!?；;]+$/g, '').trim();
}

async function parseCapture() {
  const ta = document.getElementById('capture-text');
  const result = document.getElementById('capture-result');
  const btn = document.getElementById('parse-btn');
  const save = document.getElementById('capture-save');
  const feedback = document.getElementById('capture-feedback');
  if (!ta || !result || !btn || btn.disabled) return;

  const text = ta.value.trim();
  if (!text) { showToast('先输入需要记录的工作内容'); return; }
  btn.disabled = true;
  save.disabled = true;
  feedback.textContent = '';
  btn.innerHTML = `<span class="spinner"></span> 正在解析…`;

  try {
    const pid = state.captureProjectId || matchProjectByText(text, false)?.id || null;
    const provider = aiProviderConfig();
    let title = deriveCaptureTitle(text);
    let model = '本地规则';
    if (provider.id !== 'local') {
      if (!window.zhixuDesktop?.captureTask) throw new Error('当前预览不支持模型解析，请使用更新后的桌面版');
      try {
        const parsed = await window.zhixuDesktop.captureTask({
          text, projectName: projectById(pid)?.name || '',
          provider: { baseUrl: provider.baseUrl, apiKey: provider.apiKey, model: provider.model, protocol: provider.protocol || 'auto' }
        });
        title = parsed.title;
        model = parsed.model;
      } catch (err) {
        if (provider.id !== 'builtin') throw err;
        title = deriveCaptureTitle(text);
        model = '本地规则';
      }
    }
    if (!result.isConnected) return;
    if (ta.value.trim() !== text) throw new Error('内容已修改，请重新解析');
    if (!title || title.length > 80) throw new Error('请缩短事项描述，或连接模型提炼任务标题');
    const explicitDate = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    const date = explicitDate ? explicitDate[1]
      : /明天/.test(text) ? addDaysISO(DB.meta.today, 1)
      : /后天/.test(text) ? addDaysISO(DB.meta.today, 2) : DB.meta.today;
    const hours = text.match(/(\d+(?:\.\d+)?)\s*(?:小时|h\b)/i);
    const estimate = hours ? Number(hours[1]) : 1;
    state.captureDraft = { raw: text, source: state.captureSource, title, project: pid, date, estimate, model };
    document.getElementById('capture-engine').textContent = model;

    result.innerHTML = `
      <div class="parse-result">
        <div class="parse-result-head">${icon('file', 12)} 待确认任务</div>
        <div class="form-grid" style="padding:16px">
          <div class="field full"><label for="capture-title">任务标题</label>
            <input class="input" id="capture-title" maxlength="80" value="${esc(title)}"></div>
          <div class="field"><label for="capture-project">项目</label>
            <select class="select" id="capture-project">
              <option value="">未归属</option>
              ${DB.projects.map(project => `<option value="${project.id}" ${project.id === pid ? 'selected' : ''}>${esc(project.name)}</option>`).join('')}
            </select></div>
          <div class="field"><label for="capture-date">安排日期</label>
            <input class="input" id="capture-date" type="date" value="${date}"></div>
          <div class="field"><label for="capture-estimate">预计时长（小时）</label>
            <input class="input" id="capture-estimate" type="number" min="0.1" max="1000" step="0.1" value="${estimate}"></div>
          <div class="field"><label for="capture-priority">优先级</label>
            <select class="select" id="capture-priority">
              <option>P0</option><option selected>P1</option><option>P2</option><option>P3</option>
            </select></div>
        </div>
      </div>
    `;
    save.hidden = false;
    btn.classList.remove('btn-primary');
    state.captureParsed = true;
  } catch (error) {
    if (result.isConnected) feedback.textContent = '解析失败：' + (error.message || '请重试');
  } finally {
    if (btn.isConnected) {
      btn.disabled = false;
      save.disabled = false;
      btn.innerHTML = `${icon('sparkles', 13)} ${state.captureParsed ? '重新解析' : '解析'}`;
    }
  }
}

function openCommand() {
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-backdrop" data-action="backdrop">
      <div class="modal command-modal" role="dialog" aria-modal="true" aria-label="命令面板">
        <div class="command-input-wrap">
          ${icon('search', 16)}
          <input class="command-input" id="command-input" placeholder="搜索任务、项目、操作…" autocomplete="off">
          <span class="kbd">Esc</span>
        </div>
        <div class="command-list" id="command-list">
          <div class="command-group-label">跳转</div>
          <button class="command-item" data-action="nav" data-view="today">${icon('sun', 15)} 今天</button>
          <button class="command-item" data-action="nav" data-view="chat">${icon('message', 15)} 对话</button>
          <button class="command-item" data-action="nav" data-view="inbox">${icon('inbox', 15)} 收件箱</button>
          <button class="command-item" data-action="nav" data-view="projects">${icon('layout', 15)} 项目</button>
          <button class="command-item" data-action="nav" data-view="reports">${icon('file', 15)} 报告</button>
          <button class="command-item" data-action="nav" data-view="profile">${icon('chart', 15)} 回顾</button>
          <button class="command-item" data-action="nav" data-view="data">${icon('database', 15)} 连接与数据</button>

          <div class="command-group-label">操作</div>
          <button class="command-item" data-action="capture">${icon('plus', 15)} 添加事项</button>
          <button class="command-item" data-action="impact">${icon('calendar', 15)} 安排临时任务</button>
          <button class="command-item" data-action="profile-settings">${icon('settings', 15)} 设置</button>
          <button class="command-item" data-action="command-weekly">${icon('sparkles', 15)} 生成周报</button>
          <button class="command-item" data-action="new-project">${icon('folder', 15)} 新建项目</button>

          <div class="command-group-label">项目</div>
          ${DB.projects.slice(0, 4).map(p => `<button class="command-item" data-action="project" data-id="${p.id}">${icon('folder', 15)} ${esc(p.name)} <span class="ci-sub">${p.progress}%</span></button>`).join('')}
          <div class="command-group-label">任务</div>
          ${allWorkbenchTasks().map(t => `<button class="command-item" data-action="task-edit" data-id="${esc(t.id)}">${icon('check', 15)} ${esc(t.title)}</button>`).join('')}
          <div class="command-group-label">文档</div>
          ${DB.documents.map(d => `<button class="command-item" data-action="document-open" data-id="${esc(d.id)}">${icon('file', 15)} ${esc(d.title)}</button>`).join('')}
        </div>
        <div class="command-foot">
          <span class="k">↵ 打开</span>
          <span class="k">Esc 关闭</span>
          <span style="margin-left:auto">${esc(assistantName())} · 本地优先</span>
        </div>
      </div>
    </div>
  `;
  setTimeout(() => {
    const input = document.getElementById('command-input');
    if (input) input.focus();
  }, 40);
}

function filterCommand(query) {
  const q = query.trim().toLowerCase();
  const list = document.getElementById('command-list');
  if (!list) return;
  list.querySelectorAll('.command-item').forEach(item => {
    item.style.display = !q || item.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
  list.querySelectorAll('.command-group-label').forEach(label => {
    let next = label.nextElementSibling;
    let any = false;
    while (next && !next.classList.contains('command-group-label')) {
      if (next.classList.contains('command-item') && next.style.display !== 'none') any = true;
      next = next.nextElementSibling;
    }
    label.style.display = any ? '' : 'none';
  });
}

function openImpact() {
  state.pendingImpact = null;
  const tasks = tasksOnDate(DB.meta.today).filter(t => !t.done);
  localModal('插单影响分析', `<p class="small muted">当前承诺 ${DB.capacity.committed}h / 可用 ${DB.capacity.available}h</p>
    <div class="form-grid">${inputField('impact-title', '新增事项', '')}
    ${inputField('impact-hours', '预计小时', '1', 'number', 'min="0.1" max="1000" step="0.1"')}
    ${selectField('impact-mode', '安排方案', [['today', '加入今日'], ['defer', '将一项今日任务移至明天'], ['nextweek', '安排到下周一']], 'today')}
    ${selectField('impact-move', '需要移至明天的任务', tasks.map(t => [t.id, t.title]), tasks[0]?.id)}</div>`,
    '<button class="btn" data-action="close-modal">取消</button><button class="btn btn-primary" data-action="impact-preview">预览调整</button>');
}
