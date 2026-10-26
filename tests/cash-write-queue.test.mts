import assert from 'node:assert/strict';
import test from 'node:test';
import { CashWriteQueue } from '../src/app/features/analyses/cash-write-queue.ts';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

test('a reset waits for an in-flight save, and the next edit is saved after the reset', async () => {
  const queue = new CashWriteQueue();
  const first = deferred();
  const calls: string[] = [];
  let stored: number | null = null;
  const save = queue.run(11, async () => { calls.push('save 50'); await first.promise; stored = 50; });
  const reset = queue.run(11, async () => { calls.push('reset'); stored = null; });
  const latest = queue.run(11, async () => { calls.push('save 75'); stored = 75; });
  await Promise.resolve();
  assert.deepEqual(calls, ['save 50']);
  first.resolve();
  await Promise.all([save, reset, latest]);
  assert.deepEqual(calls, ['save 50', 'reset', 'save 75']);
  assert.equal(stored, 75);
});

test('one slow container does not hold up another container', async () => {
  const queue = new CashWriteQueue();
  const first = deferred();
  const save = queue.run(11, () => first.promise);
  assert.equal(await queue.run(13, async () => 'saved'), 'saved');
  first.resolve();
  await save;
});

test('a failed request leaves the queue available for retry and later reset', async () => {
  const queue = new CashWriteQueue();
  const calls: string[] = [];
  const failed = queue.run(11, async () => { throw new Error('offline'); });
  const retry = queue.run(11, async () => { calls.push('retry'); });
  await assert.rejects(failed, /offline/);
  await retry;
  await queue.run(11, async () => { calls.push('reset'); });
  assert.deepEqual(calls, ['retry', 'reset']);
});

test('a superseded queued draft can be skipped without losing the latest draft', async () => {
  const queue = new CashWriteQueue();
  const first = deferred();
  const inFlight = queue.run(11, () => first.promise);
  const values: number[] = [];
  let pending = 60;
  const middle = queue.run(11, async () => { if (pending === 60) values.push(60); });
  pending = 75;
  const latest = queue.run(11, async () => { if (pending === 75) values.push(75); });
  first.resolve();
  await Promise.all([inFlight, middle, latest]);
  assert.deepEqual(values, [75]);
});
