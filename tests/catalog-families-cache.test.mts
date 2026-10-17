import assert from 'node:assert/strict';
import test from 'node:test';
import { cachedOnce } from '../src/app/core/api/request-cache.ts';

function loader() {
  const calls: Array<{ resolve: (value: string) => void; reject: (failure: unknown) => void }> = [];
  const load = () => new Promise<string>((resolve, reject) => { calls.push({ resolve, reject }); });
  return { calls, load };
}

test('callers share the request in flight', async () => {
  const { calls, load } = loader();
  const cache = cachedOnce(load, 20_000, () => 0);
  const one = cache.get();
  const two = cache.get(20_000);
  assert.equal(calls.length, 1);
  calls[0].resolve('families');
  assert.deepEqual(await Promise.all([one, two]), ['families', 'families']);
});

test('without an age every call asks again once the answer is in', async () => {
  const { calls, load } = loader();
  const cache = cachedOnce(load, 20_000, () => 0);
  const first = cache.get();
  calls[0].resolve('a');
  await first;
  const second = cache.get();
  assert.equal(calls.length, 2, 'the default behaves as before: one request each');
  calls[1].resolve('b');
  assert.equal(await second, 'b');
});

test('an opted-in answer lives 20 s on a fake clock', async () => {
  const { calls, load } = loader();
  let clock = 1_000;
  const cache = cachedOnce(load, 20_000, () => clock);
  const first = cache.get(20_000);
  calls[0].resolve('a');
  assert.equal(await first, 'a');
  clock += 19_999;
  assert.equal(await cache.get(20_000), 'a');
  assert.equal(calls.length, 1);
  clock += 2;
  const late = cache.get(20_000);
  assert.equal(calls.length, 2, 'older than 20 s asks again');
  calls[1].resolve('b');
  assert.equal(await late, 'b');
  clock += 5_000;
  assert.equal(await cache.get(60_000), 'b', 'a longer wish is capped at the ttl but still fresh');
  clock += 16_000;
  const capped = cache.get(60_000);
  assert.equal(calls.length, 3, 'never older than the ttl');
  calls[2].resolve('c');
  await capped;
});

test('a write clears the answer and the request in flight', async () => {
  const { calls, load } = loader();
  const cache = cachedOnce(load, 20_000, () => 0);
  const first = cache.get(20_000);
  calls[0].resolve('before');
  await first;
  cache.clear();
  const after = cache.get(20_000);
  assert.equal(calls.length, 2);
  /* A request in flight during a write is not kept as the answer. */
  cache.clear();
  calls[1].resolve('stale');
  assert.equal(await after, 'stale', 'its own caller still gets an answer');
  const fresh = cache.get(20_000);
  assert.equal(calls.length, 3, 'the stale answer was not stored');
  calls[2].resolve('fresh');
  assert.equal(await fresh, 'fresh');
});

test('a failure is not cached', async () => {
  const { calls, load } = loader();
  const cache = cachedOnce(load, 20_000, () => 0);
  const first = cache.get(20_000);
  calls[0].reject(new Error('offline'));
  await assert.rejects(first, /offline/);
  const again = cache.get(20_000);
  assert.equal(calls.length, 2);
  calls[1].resolve('ok');
  assert.equal(await again, 'ok');
});
