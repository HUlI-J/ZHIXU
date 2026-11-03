import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import test from 'node:test';
import { assertMigrationTarget, migrateData, readDataLocation, validateEmptyTarget, writeDataLocation } from '../src/main/data-location';

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
