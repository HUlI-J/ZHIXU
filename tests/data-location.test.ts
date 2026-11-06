import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import test from 'node:test';
import { assertMigrationTarget, migrateData, migrateLegacyDefaultData, readDataLocation, resolveBrandedDataLocation, validateEmptyTarget, writeDataLocation } from '../src/main/data-location';

function createDatabase(path: string) {
  const database = new DatabaseSync(path);
  database.exec('CREATE TABLE workbench (id INTEGER PRIMARY KEY, payload TEXT NOT NULL)');
  database.prepare('INSERT INTO workbench VALUES (1, ?)').run('{}');
  database.close();
}

test('data location rejects overlapping folders', () => {
  const root = mkdtempSync(join(tmpdir(), 'zhixu-location-'));
  const current = join(root, 'current');
  mkdirSync(current);
  assert.throws(() => assertMigrationTarget(current, current), /相同/);
  assert.throws(() => assertMigrationTarget(current, join(current, 'child')), /内部/);
  assert.throws(() => assertMigrationTarget(current, root), /包含/);
  assert.doesNotThrow(() => assertMigrationTarget(current, join(root, 'other')));
  rmSync(root, { recursive: true, force: true });
});

test('data location only accepts empty writable folders', async () => {
  const root = mkdtempSync(join(tmpdir(), 'zhixu-location-'));
  const empty = join(root, 'empty');
  mkdirSync(empty);
  assert.equal(await validateEmptyTarget(empty), resolve(empty));
  const full = join(root, 'full');
  mkdirSync(full);
  writeFileSync(join(full, 'existing.txt'), 'keep');
  await assert.rejects(validateEmptyTarget(full), /空文件夹/);
  rmSync(root, { recursive: true, force: true });
});

test('data location pointer falls back when the selected folder is unavailable', () => {
  const root = mkdtempSync(join(tmpdir(), 'zhixu-location-'));
  const defaultPath = join(root, 'default');
  const target = join(root, 'target');
  mkdirSync(defaultPath);
  mkdirSync(target);
  createDatabase(join(target, 'workbench.sqlite'));
  writeDataLocation(defaultPath, target);
  assert.equal(readDataLocation(defaultPath).path, resolve(target));
  assert.equal(readDataLocation(defaultPath).warning, '');
  rmSync(join(target, 'workbench.sqlite'));
  const fallback = readDataLocation(defaultPath);
  assert.equal(fallback.path, defaultPath);
  assert.match(fallback.warning, /不可用/);
  rmSync(root, { recursive: true, force: true });
});

test('data migration copies the database, attachments and settings then verifies the result', async () => {
  const root = mkdtempSync(join(tmpdir(), 'zhixu-location-'));
  const source = join(root, 'source');
  const target = join(root, 'target');
  mkdirSync(join(source, 'attachments'), { recursive: true });
  mkdirSync(join(source, 'plugins'), { recursive: true });
  mkdirSync(join(source, 'remote'), { recursive: true });
  mkdirSync(join(source, 'backups'), { recursive: true });
  writeFileSync(join(source, 'attachments', 'a.txt'), 'attachment');
  writeFileSync(join(source, 'plugins', 'p.txt'), 'plugin');
  writeFileSync(join(source, 'remote', 'r.txt'), 'remote');
  writeFileSync(join(source, 'backups', 'b.sqlite'), 'backup');
  writeFileSync(join(source, 'updates.json'), '{"automatic":true}');
  mkdirSync(target);
  await migrateData(source, target, async path => createDatabase(path));
  assert.equal(readFileSync(join(target, 'attachments', 'a.txt'), 'utf8'), 'attachment');
  assert.equal(readFileSync(join(target, 'plugins', 'p.txt'), 'utf8'), 'plugin');
  assert.equal(readFileSync(join(target, 'remote', 'r.txt'), 'utf8'), 'remote');
  assert.equal(readFileSync(join(target, 'backups', 'b.sqlite'), 'utf8'), 'backup');
  assert.equal(readFileSync(join(target, 'updates.json'), 'utf8'), '{"automatic":true}');
  const database = new DatabaseSync(join(target, 'workbench.sqlite'), { readOnly: true });
  assert.equal(Number((database.prepare('SELECT COUNT(*) AS count FROM workbench').get() as { count: number }).count), 1);
  database.close();
  rmSync(root, { recursive: true, force: true });
});

test('failed data migration leaves the selected empty folder clean', async () => {
  const root = mkdtempSync(join(tmpdir(), 'zhixu-location-'));
  const source = join(root, 'source');
  const target = join(root, 'target');
  mkdirSync(source);
  mkdirSync(target);
  await assert.rejects(migrateData(source, target, async () => { throw new Error('backup failed'); }), /backup failed/);
  assert.deepEqual(readdirSync(target), []);
  rmSync(root, { recursive: true, force: true });
});

test('legacy Xiaoyu data migration preserves live WAL commits, assets, credentials and the source', async () => {
  const root = mkdtempSync(join(tmpdir(), 'zhixu-legacy-'));
  const legacy = join(root, 'Xiaoyu');
  const branded = join(root, 'Zhixu');
  mkdirSync(join(legacy, 'attachments'), { recursive: true });
  createDatabase(join(legacy, 'workbench.sqlite'));
  const writer = new DatabaseSync(join(legacy, 'workbench.sqlite'));
  writer.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; UPDATE workbench SET payload='{\"marker\":\"latest\",\"encryptedSettings\":\"original-secret\"}'");
  writeFileSync(join(legacy, 'attachments', 'source.txt'), 'source');
  try {
    await migrateLegacyDefaultData(legacy, branded);
    const migrated = new DatabaseSync(join(branded, 'workbench.sqlite'), { readOnly: true });
    try {
      assert.equal(migrated.prepare('SELECT payload FROM workbench').get()!.payload,
        writer.prepare('SELECT payload FROM workbench').get()!.payload);
    } finally { migrated.close(); }
    assert.equal(readFileSync(join(branded, 'attachments', 'source.txt'), 'utf8'), 'source');
    assert.equal(writer.prepare('SELECT COUNT(*) AS count FROM workbench').get()!.count, 1);
    assert.deepEqual(readdirSync(root).sort(), ['Xiaoyu', 'Zhixu']);
  } finally { writer.close(); rmSync(root, { recursive: true, force: true }); }
});

test('legacy default migration refuses to overwrite a non-empty branded directory', async () => {
  const root = mkdtempSync(join(tmpdir(), 'zhixu-legacy-'));
  const legacy = join(root, 'Xiaoyu');
  const branded = join(root, 'Zhixu');
  mkdirSync(legacy);
  mkdirSync(branded);
  writeFileSync(join(legacy, 'workbench.sqlite'), 'database');
  writeFileSync(join(branded, 'existing.txt'), 'keep');
  await assert.rejects(migrateLegacyDefaultData(legacy, branded), /空文件夹/);
  assert.equal(readFileSync(join(branded, 'existing.txt'), 'utf8'), 'keep');
  rmSync(root, { recursive: true, force: true });
});

test('failed legacy migration never activates a partial database and can retry', async () => {
  const root = mkdtempSync(join(tmpdir(), 'zhixu-legacy-'));
  const legacy = join(root, 'Xiaoyu'), branded = join(root, 'Zhixu');
  mkdirSync(legacy);
  writeFileSync(join(legacy, 'workbench.sqlite'), 'invalid database');
  assert.equal((await resolveBrandedDataLocation(branded, legacy)).path, legacy);
  assert.deepEqual(readdirSync(root), ['Xiaoyu']);
  rmSync(join(legacy, 'workbench.sqlite'));
  createDatabase(join(legacy, 'workbench.sqlite'));
  assert.equal((await resolveBrandedDataLocation(branded, legacy)).path, branded);
  assert.equal((await resolveBrandedDataLocation(branded, legacy)).path, branded);
  rmSync(root, { recursive: true, force: true });
});

test('brand migration retains custom data locations and never replaces an existing Zhixu database', async () => {
  const root = mkdtempSync(join(tmpdir(), 'zhixu-legacy-'));
  const legacy = join(root, 'Xiaoyu'), branded = join(root, 'Zhixu'), custom = join(root, 'custom');
  mkdirSync(custom);
  createDatabase(join(custom, 'workbench.sqlite'));
  writeDataLocation(legacy, custom);
  assert.equal((await resolveBrandedDataLocation(branded, legacy)).path, custom);
  rmSync(join(custom, 'workbench.sqlite'));
  const unavailable = await resolveBrandedDataLocation(branded, legacy);
  assert.equal(unavailable.path, legacy);
  assert.match(unavailable.warning, /不可用/);
  mkdirSync(branded);
  createDatabase(join(branded, 'workbench.sqlite'));
  assert.equal((await resolveBrandedDataLocation(branded, legacy)).path, branded);
  rmSync(root, { recursive: true, force: true });
});
