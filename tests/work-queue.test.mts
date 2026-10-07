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

type LoginSummary = { pending: number; intakeFull: boolean; intakeFullSources?: string[] };

function queueWithSummary(summary: () => Promise<LoginSummary>, notifications = async () => ({ items: [] as AppNotification[] })) {
  const injector = createEnvironmentInjector([
    { provide: SalesApi, useValue: { notifications, loginRequestSummary: summary } },
  ], null!);
  return { queue: runInInjectionContext(injector, () => new WorkQueue()), injector };
}

test('the login request summary sets the count and names the full intake route', async () => {
  const { queue, injector } = queueWithSummary(async () => ({ pending: 2, intakeFull: true, intakeFullSources: ['QUOTE'] }));
  try {
    await queue.refresh();
    assert.equal(queue.loginRequestCount(), 2);
    assert.equal(queue.loginIntakeFull(), true);
    assert.deepEqual(queue.loginIntakeFullSources(), ['QUOTE']);
    assert.equal(queue.error(), null);
    assert.equal(queue.loading(), false);
  } finally { injector.destroy(); }
});

test('a summary without intake routes leaves an empty list', async () => {
  const { queue, injector } = queueWithSummary(async () => ({ pending: 1, intakeFull: true }));
  try {
    await queue.refresh();
    assert.equal(queue.loginRequestCount(), 1);
    assert.equal(queue.loginIntakeFull(), true);
    assert.deepEqual(queue.loginIntakeFullSources(), []);
  } finally { injector.destroy(); }
});

test('a failing summary keeps the previous login request values and raises no feed error', async () => {
  let fail = false;
  const { queue, injector } = queueWithSummary(async () => {
    if (fail) throw new Error('offline');
    return { pending: 2, intakeFull: true, intakeFullSources: ['ORDER_SCREEN'] };
  });
  try {
    await queue.refresh();
    fail = true;
    await queue.refresh(true);
    assert.equal(queue.loginRequestCount(), 2);
    assert.equal(queue.loginIntakeFull(), true);
    assert.deepEqual(queue.loginIntakeFullSources(), ['ORDER_SCREEN']);
    assert.equal(queue.error(), null);
  } finally { injector.destroy(); }
});

test('a failing feed neither resets the login request count nor keeps the summary from being read', async () => {
  let fail = false;
  let pending = 3;
  const { queue, injector } = queueWithSummary(
    async () => ({ pending, intakeFull: false, intakeFullSources: [] }),
    async () => { if (fail) throw new Error('offline'); return { items: [notification('VOORSTEL', 42)] }; });
  try {
    await queue.refresh();
    assert.equal(queue.loginRequestCount(), 3);
    fail = true;
    pending = 5;
    await queue.refresh(true);
    /* 5, not 3: the summary is still fetched when the feed fails. */
    assert.equal(queue.loginRequestCount(), 5);
    assert.equal(queue.items().length, 1);
    assert.notEqual(queue.error(), null);
  } finally { injector.destroy(); }
});

test('a summary that a newer refresh has overtaken does not overwrite the newer count', async () => {
  const answers: ((summary: LoginSummary) => void)[] = [];
  const { queue, injector } = queueWithSummary(() => new Promise<LoginSummary>((resolve) => answers.push(resolve)));
  const asked = async (count: number) => {
    for (let turn = 0; turn < 50 && answers.length < count; turn++) await Promise.resolve();
    assert.equal(answers.length, count, 'summary calls under way');
  };
  try {
    const first = queue.refresh(true);
    await asked(1);
    const second = queue.refresh(true);
    await asked(2);
    answers[1]({ pending: 5, intakeFull: true, intakeFullSources: ['QUOTE'] });
    await second;
    answers[0]({ pending: 3, intakeFull: false, intakeFullSources: [] });
    await first;
    assert.equal(queue.loginRequestCount(), 5);
    assert.equal(queue.loginIntakeFull(), true);
    assert.deepEqual(queue.loginIntakeFullSources(), ['QUOTE']);
  } finally { injector.destroy(); }
});

test('a backend without the summary leaves the count at zero', async () => {
  const { queue, injector } = await queueWith([notification('VOORSTEL', 42)]);
  try {
    assert.equal(queue.loginRequestCount(), 0);
    assert.equal(queue.loginIntakeFull(), false);
    assert.equal(queue.error(), null);
  } finally { injector.destroy(); }
});
