import '@angular/compiler';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createEnvironmentInjector, runInInjectionContext } from '@angular/core';
import { SalesApi } from '../src/app/core/api/sales-api';
import { WorkQueue } from '../src/app/core/api/work-queue';
import type { AppNotification } from '../src/app/core/api/models';

// Run with esbuild (already supplied by Angular) so the real injectable service is exercised:
// npx esbuild tests/work-queue.test.mts --bundle --platform=node --format=esm --outfile=/tmp/enrosed-work-queue-tests.mjs
// node --test /tmp/enrosed-work-queue-tests.mjs

const notification = (kind: AppNotification['kind'], orderId: number): AppNotification => ({
  kind, orderId, orderNumber: `ENR-${orderId}`, customer: 'Example BV',
  title: kind, detail: 'Wacht op beoordeling', actionNeeded: kind !== 'BEKEKEN', at: null,
});

async function queueWith(items: AppNotification[]) {
  const injector = createEnvironmentInjector([
    { provide: SalesApi, useValue: { notifications: async () => ({ items }) } },
  ], null!);
  const queue = runInInjectionContext(injector, () => new WorkQueue());
  await queue.refresh();
  return { queue, injector };
}

test('a first website request counts in sales without suggesting an empty revision list', async () => {
  const { queue, injector } = await queueWith([notification('WEBSITE_AANVRAAG', 41)]);
  try {
    assert.equal(queue.actionCount(), 1);
    assert.equal(queue.revisionCount(), 0);
    assert.deepEqual(queue.actions().map(item => item.orderId), [41]);
  } finally { injector.destroy(); }
});

test('only actual customer proposals count toward the Wijzigingen destination', async () => {
  const { queue, injector } = await queueWith([
    notification('WEBSITE_AANVRAAG', 41), notification('VOORSTEL', 42),
    notification('VRACHT', 43), notification('LEVERTERMIJN', 44), notification('BEKEKEN', 45),
  ]);
  try {
    assert.equal(queue.actionCount(), 4);
    assert.equal(queue.revisionCount(), 1);
    assert.equal(queue.news().length, 1);
  } finally { injector.destroy(); }
});

test('dismissing an alert does not remove a still-pending proposal from its page count', async () => {
  const proposal = notification('VOORSTEL', 42);
  const { queue, injector } = await queueWith([proposal]);
  try {
    queue.dismiss(proposal);
    assert.equal(queue.actionCount(), 0);
    assert.equal(queue.revisionCount(), 1);
    queue.items.set([]);
    assert.equal(queue.revisionCount(), 0);
  } finally { injector.destroy(); }
});
