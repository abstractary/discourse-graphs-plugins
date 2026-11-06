import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createStore } from '../src/store.ts';

function tempStore(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), 'dg-store-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, store: createStore(dir) };
}

test('values and blobs survive a fresh store on the same folder', (t) => {
  const { dir, store } = tempStore(t);
  store.write('labs/a', { hello: 'world' });
  store.writeBlob('papers/a/b', Buffer.from([1, 2, 3]));
  const reopened = createStore(dir);
  assert.deepEqual(reopened.read('labs/a'), { hello: 'world' });
  assert.deepEqual(reopened.readBlob('papers/a/b'), Buffer.from([1, 2, 3]));
  assert.deepEqual(reopened.list('labs'), ['a']);
  assert.equal(reopened.read('labs/none'), undefined);
  assert.equal(reopened.readBlob('papers/none'), undefined);
  assert.deepEqual(reopened.list('nothing'), []);
});

test('a write leaves no temp file behind and replaces the old value whole', (t) => {
  const { dir, store } = tempStore(t);
  store.write('labs/a', { version: 1 });
  store.write('labs/a', { version: 2 });
  assert.deepEqual(readdirSync(join(dir, 'json', 'labs')), ['a.json']);
  assert.deepEqual(store.read('labs/a'), { version: 2 });
});

test('a write swaps in a new file rather than changing the old one in place', (t) => {
  const { dir, store } = tempStore(t);
  const path = join(dir, 'json', 'labs', 'a.json');
  store.write('labs/a', { version: 1 });
  const before = statSync(path).ino;
  store.write('labs/a', { version: 2 });
  assert.notEqual(statSync(path).ino, before);

  const blob = join(dir, 'blobs', 'papers', 'a');
  store.writeBlob('papers/a', Buffer.from('one'));
  const blobBefore = statSync(blob).ino;
  store.writeBlob('papers/a', Buffer.from('two'));
  assert.notEqual(statSync(blob).ino, blobBefore);
});

test('a failed rename leaves other values alone and cleans up its temp file', (t) => {
  const { dir, store } = tempStore(t);
  store.write('labs/a', { version: 1 });
  // A folder sitting at the target path makes the final rename fail.
  mkdirSync(join(dir, 'json', 'labs', 'b.json'));
  assert.throws(() => store.write('labs/b', { version: 1 }));
  assert.deepEqual(readdirSync(join(dir, 'json', 'labs')).sort(), ['a.json', 'b.json']);
  assert.equal(readFileSync(join(dir, 'json', 'labs', 'a.json'), 'utf8'), '{"version":1}');
});

test('keys cannot climb out of the data folder', (t) => {
  const { store } = tempStore(t);
  for (const key of ['../escape', 'labs/../../escape', '/etc/passwd', 'a/.hidden', '']) {
    assert.throws(() => store.write(key, {}));
    assert.throws(() => store.read(key));
    assert.throws(() => store.writeBlob(key, Buffer.alloc(0)));
  }
});
