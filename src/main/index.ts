import { app, BrowserWindow, dialog, ipcMain, net, safeStorage, shell } from 'electron';
import { join, resolve } from 'node:path';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { WorkbenchStore } from './database';
import { polish } from './polish';
import { chat, summarizeChat } from './chat';
import { captureTask } from './capture';
import { providerDiagnose, providerModels } from './providers';
import { runIntegration } from './integrations';
import { exportBuffer, exportSchema, reportHTML } from './exports';
import { DocumentFiles } from './document-files';
import { analyzeDocument } from './document-analysis';
import { z } from 'zod';
import { Workspace } from './workspace';
import { Plugins } from './plugins';
import { SharedWorkbench } from './remote-state';
import { RemoteAccess } from './remote-access';
import updater from 'electron-updater';
import { dirname } from 'node:path';
import { Updates, UpdatePreparationError, updateFeedConfig } from './updates';
import { configureUpdateTransport } from './update-http';
import { assertMigrationTarget, dataLocationStatus, migrateData, resolveBrandedDataLocation, validateEmptyTarget, writeDataLocation } from './data-location';

let store: WorkbenchStore;
let window: BrowserWindow | null = null;
let remoteAccess: RemoteAccess | undefined;
let updates: Updates | undefined;

async function pdfBytes(title: string, text: string) {
  const printWindow = new BrowserWindow({ show: false, webPreferences: {
    sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false
  } });
  try {
    await printWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(reportHTML(title, text)));
    return await printWindow.webContents.printToPDF({ pageSize: 'A4', printBackground: true });
  } finally { printWindow.destroy(); }
}

const dataOverride = process.env.ZHIXU_DATA_DIR || process.env.XIAOYU_DATA_DIR;
const defaultDataPath = join(app.getPath('appData'), 'Zhixu');
const legacyDefaultDataPath = join(app.getPath('appData'), 'Xiaoyu');
// Keep the legacy lock identity so old and new versions cannot migrate or edit data concurrently.
const lockDataPath = dataOverride ? resolve(dataOverride)
  : existsSync(join(legacyDefaultDataPath, 'workbench.sqlite')) || existsSync(join(legacyDefaultDataPath, 'data-location.json'))
    ? legacyDefaultDataPath : defaultDataPath;
mkdirSync(lockDataPath, { recursive: true });
app.setPath('userData', lockDataPath);
app.setName('知序');
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore();
    window?.show();
    window?.focus();
  });
  app.whenReady().then(async () => {
    const savedLocation = dataOverride ? { path: resolve(dataOverride), warning: '' }
      : await resolveBrandedDataLocation(defaultDataPath, legacyDefaultDataPath);
    const dataLocationWarning = savedLocation.warning;
    mkdirSync(savedLocation.path, { recursive: true });
    app.setPath('userData', savedLocation.path);
    const dataDir = app.getPath('userData');
    mkdirSync(dataDir, { recursive: true });
    store = new WorkbenchStore(join(dataDir, 'workbench.sqlite'), {
      encrypt(value) {
        if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储不可用，设置未保存');
        return safeStorage.encryptString(value).toString('base64');
      },
      decrypt(value) {
        return safeStorage.decryptString(Buffer.from(value, 'base64'));
      }
    });
    const shared = new SharedWorkbench(store);
    let desktopRevision = shared.revision;
    const checkSender = (event: Electron.IpcMainInvokeEvent) => {
      if (!window || event.sender !== window.webContents ||
          event.senderFrame !== window.webContents.mainFrame) {
        throw new Error('不允许此窗口访问工作数据');
      }
    };
    ipcMain.handle('workbench:load', event => {
      checkSender(event); desktopRevision = shared.revision; return shared.load();
    });
    ipcMain.handle('workbench:save', (event, payload: unknown) => {
      checkSender(event);
      desktopRevision = shared.save(payload, desktopRevision);
    });
    ipcMain.handle('workbench:revision', event => { checkSender(event); return { changed: desktopRevision !== shared.revision }; });
    ipcMain.handle('workbench:reload', event => { checkSender(event); window!.webContents.reload(); });
    ipcMain.handle('workbench:remote-access', (event, payload: unknown) => { checkSender(event); return remoteAccess!.handle(payload); });
    ipcMain.handle('workbench:open-external', async (event, payload: unknown) => {
      checkSender(event);
      const url = z.url().parse(payload);
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com' ||
          !/^\/HULI-J\/ZHIXU(?:\/|$)/i.test(parsed.pathname)) {
        throw new Error('不允许打开此链接');
      }
      await shell.openExternal(parsed.toString());
      return { opened: true };
    });
    ipcMain.handle('workbench:export', async (event, input: unknown) => {
      checkSender(event);
      const payload = exportSchema.parse(input);
      const filename = payload.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 100);
      const result = await dialog.showSaveDialog(window!, {
        title: '导出文件', defaultPath: `${filename}.${payload.format}`,
        filters: [{ name: payload.format.toUpperCase(), extensions: [payload.format] }]
      });
      if (result.canceled || !result.filePath) return { saved: false };
      if (payload.format === 'pdf') {
        writeFileSync(result.filePath, await pdfBytes(payload.title, payload.text));
      } else writeFileSync(result.filePath, await exportBuffer(payload));
      return { saved: true };
    });
    ipcMain.handle('workbench:backup', async event => {
      checkSender(event);
      const now = new Date();
      const localDate = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
      const result = await dialog.showSaveDialog(window!, {
        title: '备份本地数据库', defaultPath: `知序备份-${localDate}.sqlite`,
        filters: [{ name: 'SQLite 数据库', extensions: ['sqlite'] }]
      });
      if (result.canceled || !result.filePath) return { saved: false };
      if (resolve(dataDir, 'workbench.sqlite').toLowerCase() === resolve(result.filePath).toLowerCase()) {
        throw new Error('备份须另存为其他文件，请勿覆盖正在使用的数据库');
      }
      await store.backup(result.filePath);
      return { saved: true };
    });
    ipcMain.handle('workbench:polish', (event, payload: unknown) => {
      checkSender(event);
      return polish(payload);
    });
    ipcMain.handle('workbench:chat', (event, payload: unknown) => {
      checkSender(event);
      return chat(payload);
    });
    ipcMain.handle('workbench:chat-summary', (event, payload: unknown) => {
      checkSender(event);
      return summarizeChat(payload);
    });
    ipcMain.handle('workbench:capture-task', (event, payload: unknown) => {
      checkSender(event);
      return captureTask(payload);
    });
    ipcMain.handle('workbench:provider-models', (event, payload: unknown) => {
      checkSender(event);
      return providerModels(payload);
    });
    ipcMain.handle('workbench:provider-diagnose', (event, payload: unknown) => {
      checkSender(event);
      return providerDiagnose(payload);
    });
    const documents = new DocumentFiles(join(dataDir, 'attachments'));
    let documentImportBusy = false;
    ipcMain.handle('workbench:document-import', async (event, payload: unknown) => {
      checkSender(event);
      if (documentImportBusy) throw new Error('正在处理另一份附件，请稍候');
      documentImportBusy = true;
      try { return await documents.import(payload); }
      finally { documentImportBusy = false; }
    });
    ipcMain.handle('workbench:document-analyze', (event, payload: unknown) => {
      checkSender(event);
      return analyzeDocument(payload);
    });
    ipcMain.handle('workbench:document-reparse', async (event, payload: unknown) => {
      checkSender(event);
      if (documentImportBusy) throw new Error('正在处理另一份附件，请稍候');
      documentImportBusy = true;
      try { return await documents.reparse(payload); }
      finally { documentImportBusy = false; }
    });
    ipcMain.handle('workbench:document-original', async (event, input: unknown) => {
      checkSender(event);
      const payload = z.object({ assetId: z.string().max(100), name: z.string().max(240) }).parse(input);
      const result = await dialog.showSaveDialog(window!, {
        title: '导出原文件', defaultPath: payload.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
      });
      if (result.canceled || !result.filePath) return { saved: false };
      await documents.export(payload.assetId, result.filePath);
      return { saved: true };
    });
    const activeIntegrations = new Set<string>();
    ipcMain.handle('workbench:integration', async (event, payload: unknown) => {
      checkSender(event);
      const id = String((payload as { id?: unknown })?.id || '');
      if (activeIntegrations.has(id)) throw new Error('此连接器正在处理请求，请稍候');
      activeIntegrations.add(id);
      try { return await runIntegration(payload, { fetch: net.fetch.bind(net) }); }
      finally { activeIntegrations.delete(id); }
    });
    const calls: Record<string, (value: unknown) => Promise<unknown>> = {
      polish, chat, 'chat-summary': summarizeChat, 'capture-task': captureTask,
      'provider-models': providerModels, 'provider-diagnose': providerDiagnose,
      'document-analyze': analyzeDocument,
      'document-reparse': async value => {
        if (documentImportBusy) throw new Error('正在处理另一份附件，请稍候');
        documentImportBusy = true;
        try { return await documents.reparse(value); } finally { documentImportBusy = false; }
      },
      integration: async value => {
        const id = String((value as { id?: unknown })?.id || '');
        if (activeIntegrations.has(id)) throw new Error('此连接器正在处理请求，请稍候');
        activeIntegrations.add(id);
        try { return await runIntegration(value, { fetch: net.fetch.bind(net) }); }
        finally { activeIntegrations.delete(id); }
      }
    };
    remoteAccess = new RemoteAccess(join(dataDir, 'remote'), {
      assets: join(import.meta.dirname, '../renderer'), shared,
      invoke: (operation, payload) => calls[operation](payload),
      importDocument: async (name, bytes) => {
        if (documentImportBusy) throw new Error('正在处理另一份附件，请稍候');
        documentImportBusy = true;
        try { return await documents.import({ name, bytes }); } finally { documentImportBusy = false; }
      },
      download: async (operation, input) => {
        if (operation === 'export') {
          const payload = exportSchema.parse(input);
          return { name: payload.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') + '.' + payload.format,
            bytes: payload.format === 'pdf' ? await pdfBytes(payload.title, payload.text) : await exportBuffer(payload) };
        }
        if (operation === 'original') {
          const payload = z.object({ assetId: z.string().max(100), name: z.string().max(240) }).parse(input);
          return { bytes: await documents.original(payload.assetId), name: payload.name };
        }
        const temporary = join(dataDir, `remote-backup-${randomBytes(12).toString('hex')}.sqlite`);
        try {
          await store.backup(temporary);
          return { bytes: await readFile(temporary), name: `知序备份-${new Date().toISOString().slice(0, 10)}.sqlite` };
        } finally { await rm(temporary, { force: true }); }
      }
    }, net.fetch.bind(net));
    window = new BrowserWindow({
      width: 1440, height: 960, minWidth: 900, minHeight: 640,
      backgroundColor: '#ffffff',
      title: '知序',
      icon: join(import.meta.dirname, '../renderer/brand/zhixu.png'),
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(import.meta.dirname, '../preload/index.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    if (dataLocationWarning) {
      window.webContents.once('did-finish-load', () => {
        if (!window || window.isDestroyed()) return;
        void dialog.showMessageBox(window, { type: 'warning', title: '数据位置不可用',
          message: '已选择的数据位置暂时不可用', detail: dataLocationWarning, buttons: ['知道了'] });
      });
    }
    const workspace = new Workspace(window);
    const plugins = new Plugins(join(dataDir, 'plugins'), window, {
      encrypt(value) {
        if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储不可用，插件配置未保存');
        return safeStorage.encryptString(value).toString('base64');
      },
      decrypt: value => safeStorage.decryptString(Buffer.from(value, 'base64'))
    });
    ipcMain.handle('workbench:plugins', (event, payload: unknown) => {
      checkSender(event);
      return plugins.handle(payload);
    });
    ipcMain.handle('workbench:workspace', (event, payload: unknown) => {
      checkSender(event);
      return workspace.handle(payload);
    });
    let migrating = false;
    const locationStatus = () => dataLocationStatus(defaultDataPath, dataDir, dataLocationWarning);
    ipcMain.handle('workbench:data-location', async (event, payload: unknown) => {
      checkSender(event);
      const request = z.discriminatedUnion('operation', [
        z.object({ operation: z.literal('status') }),
        z.object({ operation: z.literal('open') }),
        z.object({ operation: z.literal('choose') })
      ]).parse(payload);
      if (request.operation === 'status') return locationStatus();
      if (request.operation === 'open') {
        const failure = await shell.openPath(dataDir);
        if (failure) throw new Error(failure);
        return locationStatus();
      }
      if (dataOverride) throw new Error('当前使用测试数据目录，不能在应用内更改数据位置');
      if (migrating) throw new Error('正在迁移数据，请稍候');
      const picked = await dialog.showOpenDialog(window!, {
        title: '选择知序数据文件夹',
        buttonLabel: '使用此文件夹',
        properties: ['openDirectory', 'createDirectory']
      });
      if (picked.canceled || !picked.filePaths[0]) return { ...locationStatus(), canceled: true };
      const target = await validateEmptyTarget(picked.filePaths[0]);
      assertMigrationTarget(dataDir, target);
      const ready = await window!.webContents.executeJavaScript(
        'typeof prepareDataMigration === "function" ? prepareDataMigration() : persistWorkbench().then(() => true)');
      if (ready === false) throw new Error('请先完成当前对话、文件处理或计时，再更改数据位置。');
      migrating = true;
      try {
        await remoteAccess?.stop();
        updates?.dispose();
        await migrateData(dataDir, target, path => store.backup(path));
        await plugins.dispose();
        workspace.dispose();
        writeDataLocation(defaultDataPath, target);
        setTimeout(() => {
          try { store.close(); } catch { /* The copied database is already verified. */ }
          app.relaunch();
          app.exit(0);
        }, 1200);
        return { ...dataLocationStatus(defaultDataPath, target), migrated: true, message: '数据已迁移，正在重启知序…' };
      } catch (error) {
        migrating = false;
        throw error;
      }
    });
    let closing = false;
    updates = new Updates(join(dataDir, 'updates.json'), {
      version: app.getVersion(), packaged: app.isPackaged,
      async engine() {
        const engine = new updater.NsisUpdater();
        await configureUpdateTransport(engine);
        engine.setFeedURL(updateFeedConfig());
        engine.logger = null;
        engine.autoDownload = false;
        engine.autoInstallOnAppQuit = false;
        engine.allowDowngrade = false;
        engine.allowPrerelease = false;
        engine.disableDifferentialDownload = true;
        engine.disableWebInstaller = true;
        engine.installDirectory = dirname(app.getPath('exe'));
        return engine;
      },
      async prepare() {
        if (!window || window.isDestroyed()) throw new Error('窗口已关闭');
        const ready = await window.webContents.executeJavaScript(
          'typeof prepareWorkbenchUpdate === "function" ? prepareWorkbenchUpdate() : false');
        if (!ready) throw new UpdatePreparationError('请先完成当前对话、文件处理、计时或未保存的编辑，再重启更新。');
        const backups = join(dataDir, 'backups');
        mkdirSync(backups, { recursive: true });
        await store.backup(join(backups, `before-update-${app.getVersion()}-${Date.now()}.sqlite`));
        await remoteAccess?.stop();
        await plugins.dispose(); workspace.dispose();
        closing = true;
      },
      notify(status) {
        if (status.stage === 'error' || status.stage === 'ready') closing = false;
        if (window && !window.isDestroyed()) window.webContents.send('workbench:update-status', status);
      }
    });
    ipcMain.handle('workbench:updates', (event, payload: unknown) => { checkSender(event); return updates!.handle(payload); });
    updates.start();
    const devUrl = process.env.ELECTRON_RENDERER_URL;
    if (devUrl) void window.loadURL(devUrl);
    else void window.loadFile(join(import.meta.dirname, '../renderer/index.html'));
    window.on('close', event => {
      if (closing || !window) return;
      event.preventDefault();
      closing = true;
      const currentWindow = window;
      void currentWindow.webContents.executeJavaScript(
        'typeof persistWorkbench === "function" ? persistWorkbench() : Promise.resolve()'
      ).then(async () => { await plugins.dispose(); workspace.dispose(); currentWindow.destroy(); }).catch(error => {
        closing = false;
        dialog.showErrorBox('工作数据尚未保存', String(error));
      });
    });
    window.on('closed', () => { void remoteAccess?.stop(); void plugins.dispose(); workspace.dispose(); window = null; });
  }).catch(error => {
    dialog.showErrorBox('知序启动失败', String(error));
    app.quit();
  });
}

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => { updates?.dispose(); void remoteAccess?.stop(); store?.close(); });
