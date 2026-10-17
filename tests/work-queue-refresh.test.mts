import assert from 'node:assert/strict';
import test from 'node:test';
import { QUEUE_INTERVAL_MS, QUEUE_REUSE_MS, QUEUE_STALE_MS, reusesQueueRefresh, shouldRefreshQueue } from '../src/app/core/api/work-queue-refresh.ts';

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

test('a refresh that started less than five seconds ago serves the next unforced one; older, never, or a clock going back does not', () => {
  const now = 10_000_000;
  assert.equal(QUEUE_REUSE_MS, 5_000);
  assert.equal(reusesQueueRefresh(null, now), false, 'never refreshed');
  assert.equal(reusesQueueRefresh(now - 190, now), true, 'the shell refreshed on start, the home asks 190 ms later');
  assert.equal(reusesQueueRefresh(now - QUEUE_REUSE_MS + 1, now), true);
  assert.equal(reusesQueueRefresh(now - QUEUE_REUSE_MS, now), false);
  assert.equal(reusesQueueRefresh(now + 1_000, now), false, 'clock went back');
});

test('WorkQueue.refresh reuses only when not forced, not running and not failed; the home asks unforced', async () => {
  const { readFileSync } = await import('node:fs');
  const queue = readFileSync(new URL('../src/app/core/api/work-queue.ts', import.meta.url), 'utf8');
  const body = queue.slice(queue.indexOf('refresh(force = false): Promise<void> {'), queue.indexOf('private async fetch()'));
  const inFlight = body.indexOf('if (!force && this.refreshPromise) return this.refreshPromise;');
  const reuse = body.indexOf('if (!force && !this.error() && reusesQueueRefresh(this.lastRefreshAt, Date.now())) return Promise.resolve();');
  assert.ok(inFlight > 0 && reuse > inFlight, 'a fetch under way is shared first, then a recent good answer');
  assert.ok(body.indexOf('this.lastRefreshAt = Date.now();') > reuse, 'a reused answer does not move the clock');
  const home = readFileSync(new URL('../src/app/features/dashboard/home-data.ts', import.meta.url), 'utf8');
  assert.match(home, /want\('bell'\) \? this\.work\.refresh\(\)\.then/);
});
