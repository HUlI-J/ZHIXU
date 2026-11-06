import { backup, DatabaseSync } from 'node:sqlite';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, rmdirSync, statSync, writeFileSync } from 'node:fs';
import { cp, copyFile, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

export interface DataLocation {
  path: string;
  defaultPath: string;
  custom: boolean;
  warning: string;
}

export function dataLocationPointer(defaultPath: string): string {
  return join(defaultPath, 'data-location.json');
}

function inside(parent: string, child: string): boolean {
  const value = relative(resolve(parent), resolve(child));
  return value === '' || (!isAbsolute(value) && value !== '..' && !value.startsWith('..\\') && !value.startsWith('../'));
}

export function assertMigrationTarget(current: string, target: string): void {
  const from = resolve(current);
  const to = resolve(target);
  if (from.toLowerCase() === to.toLowerCase()) throw new Error('新位置不能与当前数据位置相同');
  if (inside(from, to)) throw new Error('新位置不能位于当前数据文件夹内部');
  if (inside(to, from)) throw new Error('新位置不能包含当前数据文件夹，请选择其他空文件夹');
}

export async function validateEmptyTarget(target: string): Promise<string> {
  const value = resolve(target);
  if (!isAbsolute(value)) throw new Error('请选择有效的数据文件夹');
  const info = await stat(value);
  if (!info.isDirectory()) throw new Error('请选择文件夹而不是文件');
  if ((await readdir(value)).length) throw new Error('请选择空文件夹；现有文件不会被改动或覆盖');
  const probe = join(value, `.zhixu-write-${Date.now()}.tmp`);
  try { await writeFile(probe, 'ok', { flag: 'wx' }); }
  catch { throw new Error('该文件夹不可写，请检查权限或选择其他位置'); }
  finally { await rm(probe, { force: true }); }
  return value;
}

export function readDataLocation(defaultPath: string): { path: string; warning: string } {
  const pointer = dataLocationPointer(defaultPath);
  try {
    if (!existsSync(pointer)) return { path: defaultPath, warning: '' };
    const saved = JSON.parse(readFileSync(pointer, 'utf8'));
    if (typeof saved?.path !== 'string' || !isAbsolute(saved.path)) throw new Error('invalid path');
    const target = resolve(saved.path);
    if (!existsSync(join(target, 'workbench.sqlite'))) {
      return { path: defaultPath, warning:
        `已选择的数据位置暂时不可用：${target}\n本次使用默认位置启动。请恢复该文件夹或磁盘，然后在“关于 → 数据与隐私”中重新设置。` };
    }
    return { path: target, warning: '' };
  } catch {
    return { path: defaultPath, warning: '数据位置设置无法读取，本次使用默认位置启动。可以在“关于 → 数据与隐私”中重新设置。' };
  }
}

export function writeDataLocation(defaultPath: string, target: string): void {
  mkdirSync(defaultPath, { recursive: true });
  const pointer = dataLocationPointer(defaultPath);
  const temporary = pointer + '.tmp';
  writeFileSync(temporary, JSON.stringify({ path: resolve(target), updatedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
  renameSync(temporary, pointer);
}

// Activate the new directory only after a consistent SQLite backup and all assets are verified.
export async function migrateLegacyDefaultData(legacyPath: string, defaultPath: string): Promise<void> {
  const source = resolve(legacyPath);
  const target = resolve(defaultPath);
  if (source.toLowerCase() === target.toLowerCase()) throw new Error('旧版数据目录不能与新版目录相同');
  if (!existsSync(join(source, 'workbench.sqlite'))) throw new Error('旧版数据目录不存在有效数据库');
  if (existsSync(target) && readdirSync(target).length) throw new Error('新版数据目录不是空文件夹');
  const temporary = `${target}.migration-${process.pid}-${Date.now()}`;
  if (existsSync(temporary)) throw new Error('旧数据迁移临时目录已存在');
  mkdirSync(temporary);
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(join(source, 'workbench.sqlite'), { readOnly: true });
    await backup(database, join(temporary, 'workbench.sqlite'));
    for (const name of ['attachments', 'plugins', 'remote', 'backups', 'updates.json']) {
      if (!existsSync(join(source, name))) continue;
      cpSync(join(source, name), join(temporary, name), { recursive: true, force: false, errorOnExist: true });
    }
    verifyDatabase(join(temporary, 'workbench.sqlite'));
    database.close();
    database = undefined;
    if (existsSync(target)) rmdirSync(target);
    renameSync(temporary, target);
  } finally {
    database?.close();
    if (existsSync(temporary)) rmSync(temporary, { recursive: true, force: true });
  }
}

export async function resolveBrandedDataLocation(defaultPath: string, legacyPath: string): Promise<{ path: string; warning: string }> {
  const current = readDataLocation(defaultPath);
  if (existsSync(dataLocationPointer(defaultPath)) || existsSync(join(defaultPath, 'workbench.sqlite'))) return current;
  const legacy = readDataLocation(legacyPath);
  if (existsSync(dataLocationPointer(legacyPath))) return legacy;
  if (!existsSync(join(legacyPath, 'workbench.sqlite'))) return current;
  try {
    await migrateLegacyDefaultData(legacyPath, defaultPath);
    return { path: defaultPath, warning: '' };
  } catch {
    return { path: legacyPath, warning: '旧版数据目录迁移未完成，本次继续使用原目录；原数据未改动。请在“关于 → 数据与隐私”查看实际位置。' };
  }
}

export function dataLocationStatus(defaultPath: string, current: string, warning = ''): DataLocation {
  return { path: current, defaultPath, custom: resolve(current).toLowerCase() !== resolve(defaultPath).toLowerCase(), warning };
}

function verifyDatabase(path: string): void {
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(path, { readOnly: true });
    const row = database.prepare('SELECT COUNT(*) AS count FROM workbench').get() as { count?: number } | undefined;
    if (!row || Number(row.count) !== 1) throw new Error('数据库内容不完整');
  } finally { database?.close(); }
}

export async function migrateData(current: string, target: string,
  backup: (path: string) => Promise<void>): Promise<void> {
  const source = resolve(current);
  const destination = await validateEmptyTarget(target);
  assertMigrationTarget(source, destination);
  const copied: string[] = [];
  try {
    await mkdir(destination, { recursive: true });
    await backup(join(destination, 'workbench.sqlite')); copied.push('workbench.sqlite');
    for (const name of ['attachments', 'plugins', 'remote', 'backups']) {
      const from = join(source, name);
      if (!existsSync(from) || !statSync(from).isDirectory()) continue;
      await cp(from, join(destination, name), { recursive: true, force: false, errorOnExist: true });
      copied.push(name);
    }
    const updates = join(source, 'updates.json');
    if (existsSync(updates)) {
      await copyFile(updates, join(destination, 'updates.json'));
      copied.push('updates.json');
    }
    verifyDatabase(join(destination, 'workbench.sqlite'));
  } catch (error) {
    for (const name of copied) {
      try { await rm(join(destination, name), { recursive: true, force: true }); } catch { /* Best effort cleanup. */ }
    }
    try {
      for (const name of readdirSync(destination)) rmSync(join(destination, name), { recursive: true, force: true });
    } catch { /* The original data is untouched. */ }
    throw error;
  }
}
