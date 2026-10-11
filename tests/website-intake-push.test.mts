import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../public/push-sw.js', import.meta.url), 'utf8');

function worker(visible = false, withWindow = true) {
  const listeners: Record<string, (event: any) => void> = {};
  const notifications: any[] = [], messages: any[] = [], navigations: string[] = [];
  let focused = 0;
  const client = { visibilityState: visible ? 'visible' : 'hidden',
    postMessage: (data: any) => messages.push(data), focus: async () => { focused++; },
    navigate: async (url: string) => { navigations.push(url); } };
  vm.runInNewContext(source, { self: {
    addEventListener: (kind: string, listener: (event: any) => void) => { listeners[kind] = listener; },
    clients: { matchAll: async () => withWindow ? [client] : [], openWindow: async (url: string) => { navigations.push(url); } },
    registration: { showNotification: async (title: string, options: any) => { notifications.push({ title, ...options }); } },
  } });
  const emit = async (kind: string, event: any) => {
    let work: Promise<unknown> | undefined;
    listeners[kind]({ ...event, waitUntil: (task: Promise<unknown>) => { work = task; } });
    await work;
  };
  return { notifications, messages, navigations, focused: () => focused,
    push: (data: any) => emit('push', { data: { json: () => data } }),
    click: (notification: any) => emit('notificationclick', { notification: { ...notification, close() {} } }),
  };
}

for (const [kind, route] of [['contact-inquiry', '/contactaanvragen'], ['login-request', '/klantlogins']]) {
  test(`${kind}: separate requests stay separate and each notification opens its own detail`, async () => {
    const harness = worker();
    for (const id of [41, 42]) await harness.push({ kind, title: 'Nieuwe aanvraag', body: 'Zelfde bedrijfsnaam', url: `${route}?open=${id}` });
    assert.equal(harness.notifications.length, 2);
    assert.notEqual(harness.notifications[0].tag, harness.notifications[1].tag);
    await harness.click(harness.notifications[1]);
    assert.deepEqual(harness.navigations, [`${route}?open=42`]);
    assert.equal(harness.focused(), 1);
  });
}

test('a contact notification opens the requested page when the app has no open window', async () => {
  const harness = worker(false, false);
  await harness.push({ kind: 'contact-inquiry', title: 'Nieuw contactbericht', url: '/contactaanvragen?open=18' });
  await harness.click(harness.notifications[0]);
  assert.deepEqual(harness.navigations, ['/contactaanvragen?open=18']);
});

test('existing sales notifications with a shared destination still use their distinct message bodies', async () => {
  const harness = worker();
  for (const body of ['Offerte voor klant A', 'Offerte voor klant B']) {
    await harness.push({ kind: 'sale-quote', title: 'Nieuwe offerte', body, url: '/sales' });
  }
  assert.notEqual(harness.notifications[0].tag, harness.notifications[1].tag);
  assert.equal(harness.notifications[0].tag, 'sale-quote:Offerte voor klant A');
});

test('an open app receives both intake kinds for its toast and work-queue refresh', async () => {
  const harness = worker(true);
  for (const kind of ['contact-inquiry', 'login-request']) await harness.push({ kind, title: 'Nieuwe aanvraag', body: 'Voorbeeld' });
  assert.equal(harness.notifications.length, 0);
  assert.deepEqual(harness.messages.map(row => row.kind), ['contact-inquiry', 'login-request']);
  assert.ok(harness.messages.every(row => row.source === 'enrosed-push'));
});
