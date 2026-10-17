import assert from 'node:assert/strict';
import test from 'node:test';
import { QUEUE_INTERVAL_MS, QUEUE_STALE_MS, shouldRefreshQueue } from '../src/app/core/api/work-queue-refresh.ts';

test('the queue refreshes when visible and older than a minute, never while hidden', () => {
  const now = 10_000_000;
  assert.equal(shouldRefreshQueue(null, now, true), true, 'never refreshed');
  assert.equal(shouldRefreshQueue(now - 30_000, now, true), false, 'refreshed half a minute ago');
  assert.equal(shouldRefreshQueue(now - QUEUE_STALE_MS - 1, now, true), true);
  assert.equal(shouldRefreshQueue(null, now, false), false, 'hidden');
  assert.equal(shouldRefreshQueue(now - QUEUE_INTERVAL_MS, now, false), false, 'hidden, even when old');
  assert.equal(QUEUE_INTERVAL_MS, 300_000);
});

test('WorkQueue wires focus, visibility and the five-minute tick, and App starts it while logged in', async () => {
  const { readFileSync } = await import('node:fs');
  const queue = readFileSync(new URL('../src/app/core/api/work-queue.ts', import.meta.url), 'utf8');
  assert.match(queue, /startAutoRefresh\(win: Window = window\): \(\) => void/);
  assert.match(queue, /addEventListener\('focus', maybeRefresh\)/);
  assert.match(queue, /addEventListener\('visibilitychange', maybeRefresh\)/);
  assert.match(queue, /setInterval\(maybeRefresh, QUEUE_INTERVAL_MS\)/);
  const shell = readFileSync(new URL('../src/app/app.ts', import.meta.url), 'utf8');
  assert.match(shell, /if \(this\.auth\.isLoggedIn\(\)\) onCleanup\(this\.work\.startAutoRefresh\(\)\)/);
});
