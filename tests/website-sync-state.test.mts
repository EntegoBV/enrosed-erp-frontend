import assert from 'node:assert/strict';
import test from 'node:test';
import type { WebsiteRebuildState, WebsiteRebuildStatus } from '../src/app/core/api/models.ts';
import { WebsiteSyncState } from '../src/app/features/settings/website-sync-state.ts';

function status(state: WebsiteRebuildState): WebsiteRebuildStatus {
  return { status: state, queuedAt: null, lastAttemptAt: null, hookAcceptedAt: null, liveAt: null,
    nextAttemptAt: null, currentRevision: null, liveRevision: null, lastError: null };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function harness() {
  const reads: ReturnType<typeof deferred<WebsiteRebuildStatus>>[] = [];
  const retries: ReturnType<typeof deferred<WebsiteRebuildStatus>>[] = [];
  const state = new WebsiteSyncState({
    websiteRebuildStatus: () => { const task = deferred<WebsiteRebuildStatus>(); reads.push(task); return task.promise; },
    retryWebsiteRebuild: () => { const task = deferred<WebsiteRebuildStatus>(); retries.push(task); return task.promise; },
  }, (_failure, fallback) => fallback);
  return { state, reads, retries };
}

const settle = () => new Promise<void>((done) => setImmediate(done));

test('two panels asking in the same turn share one status request', async () => {
  const { state, reads } = harness();
  state.attach();
  state.attach();
  state.refresh();
  state.refresh();
  await settle();
  assert.equal(reads.length, 1);
  assert.equal(state.loading(), true);
  reads[0].resolve(status('LIVE'));
  await settle();
  assert.equal(reads.length, 1);
  assert.equal(state.status()?.status, 'LIVE');
  assert.equal(state.loading(), false);
});

test('a retry is one request whose answer every panel reads', async () => {
  const { state, reads, retries } = harness();
  state.attach();
  state.attach();
  state.refresh();
  await settle();
  reads[0].resolve(status('FAILED_OR_STALE'));
  await settle();
  void state.retry();
  assert.equal(state.retrying(), true);
  void state.retry();
  assert.equal(retries.length, 1);
  retries[0].resolve(status('TRIGGERED'));
  await settle();
  assert.equal(state.status()?.status, 'TRIGGERED');
  assert.equal(state.retrying(), false);
  state.detach();
  state.detach();
});

test('a refresh during a running request is read again afterwards', async () => {
  const { state, reads } = harness();
  state.attach();
  void state.load();
  state.refresh();
  await settle();
  assert.equal(reads.length, 1);
  reads[0].resolve(status('LIVE'));
  await settle();
  assert.equal(reads.length, 2);
  reads[1].resolve(status('QUEUED'));
  await settle();
  assert.equal(state.status()?.status, 'QUEUED');
  state.detach();
});

test('one poll runs however many panels watch, and stops with the last one', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const { state, reads } = harness();
  state.attach();
  state.attach();
  void state.load();
  reads[0].resolve(status('TRIGGERED'));
  await settle();
  t.mock.timers.tick(8_000);
  assert.equal(reads.length, 2);
  reads[1].resolve(status('TRIGGERED'));
  await settle();
  state.detach();
  t.mock.timers.tick(8_000);
  assert.equal(reads.length, 3);
  reads[2].resolve(status('TRIGGERED'));
  await settle();
  state.detach();
  t.mock.timers.tick(60_000);
  assert.equal(reads.length, 3);
  assert.equal(state.status(), null);
});

test('an answer that arrives after the last panel left is dropped', async () => {
  const { state, reads } = harness();
  state.attach();
  void state.load();
  state.detach();
  assert.equal(state.loading(), false);
  state.attach();
  void state.load();
  assert.equal(reads.length, 2);
  reads[0].resolve(status('FAILED_OR_STALE'));
  await settle();
  assert.equal(state.status(), null);
  assert.equal(state.loading(), true);
  reads[1].resolve(status('LIVE'));
  await settle();
  assert.equal(state.status()?.status, 'LIVE');
  state.detach();
});

test('a failed read shows the message and keeps the last known status', async () => {
  const { state, reads } = harness();
  state.attach();
  void state.load();
  reads[0].resolve(status('LIVE'));
  await settle();
  void state.load();
  reads[1].reject(new Error('offline'));
  await settle();
  assert.equal(state.loadError(), 'Controleer de verbinding en probeer opnieuw.');
  assert.equal(state.status()?.status, 'LIVE');
  assert.equal(state.loading(), false);
  state.detach();
});
