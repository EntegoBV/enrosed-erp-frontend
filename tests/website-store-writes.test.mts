import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import type { StoreWrite } from '../src/app/features/website-builder/website-store-writes.ts';
import {
  STORE_WRITE_MEMORY_MS,
  rememberWrite,
  replayWrites,
  writesSince,
} from '../src/app/features/website-builder/website-store-writes.ts';

interface Reeks { id: number; status: 'PUBLISHED' | 'DRAFT' }

const flip = (id: number, status: Reeks['status'], at: number): StoreWrite<Reeks[] | null> => ({
  at, apply: (list) => list?.map((item) => item.id === id ? { ...item, status } : item) ?? list,
});

test('an answer that started before a switch gets the switch replayed on it', () => {
  /* The families GET starts at 1000; he switches reeks 2 off at 1600; the GET answers at 2600 with the old list. */
  const writes = [flip(2, 'DRAFT', 1600)];
  const answer: Reeks[] = [{ id: 1, status: 'PUBLISHED' }, { id: 2, status: 'PUBLISHED' }];
  assert.deepEqual(replayWrites(answer, writes, 1000), [{ id: 1, status: 'PUBLISHED' }, { id: 2, status: 'DRAFT' }]);
});

test('an answer that started after a write already holds it: nothing is replayed', () => {
  const writes = [flip(2, 'DRAFT', 1600)];
  const answer: Reeks[] = [{ id: 2, status: 'PUBLISHED' }];
  assert.deepEqual(replayWrites(answer, writes, 2000), [{ id: 2, status: 'PUBLISHED' }], 'the server answer is newer than the write');
  assert.deepEqual(writesSince(writes, 2000), []);
});

test('several writes replay oldest first and a write at the start moment counts', () => {
  const writes = [flip(2, 'DRAFT', 1000), flip(2, 'PUBLISHED', 1200)];
  const answer: Reeks[] = [{ id: 2, status: 'DRAFT' }];
  assert.deepEqual(replayWrites(answer, writes, 1000), [{ id: 2, status: 'PUBLISHED' }]);
  assert.equal(writesSince(writes, 1000).length, 2);
});

test('remembering a write forgets the writes no answer under way can predate', () => {
  const old = flip(1, 'DRAFT', 0);
  const recent = flip(1, 'PUBLISHED', STORE_WRITE_MEMORY_MS - 1);
  const list = rememberWrite(rememberWrite([], old), recent);
  assert.equal(list.length, 2);
  const later = rememberWrite(list, flip(1, 'DRAFT', STORE_WRITE_MEMORY_MS + 10));
  assert.deepEqual(later.map((write) => write.at), [STORE_WRITE_MEMORY_MS - 1, STORE_WRITE_MEMORY_MS + 10]);
});

test('WebsiteStore keeps its patches and replays them on an older answer', async () => {
  const source = await readFile(new URL('../src/app/features/website-builder/website-store.ts', import.meta.url), 'utf8');
  for (const patch of ['patchFamily', 'patchContentGroup', 'removeContentGroup']) {
    const body = source.slice(source.indexOf(`  ${patch}(`), source.indexOf('\n  }\n', source.indexOf(`  ${patch}(`)));
    assert.match(body, /this\.remember\('(families|content)', apply\)/, `${patch} remembers its write`);
  }
  assert.match(source, /this\.set\(part, replayWrites\(value, writes, started\)\)/);
});
