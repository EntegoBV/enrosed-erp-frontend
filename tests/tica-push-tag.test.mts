import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/push-sw.js', import.meta.url), 'utf8');

async function notification(data: object): Promise<{ title: string; options: { tag: string; data: { url: string } } }> {
  const handlers: Record<string, (event: unknown) => void> = {};
  let shown: { title: string; options: { tag: string; data: { url: string } } } | undefined;
  let completed: Promise<void> | undefined;
  vm.runInNewContext(source, { self: {
    addEventListener: (event: string, handler: (event: unknown) => void) => { handlers[event] = handler; },
    clients: { matchAll: async () => [] },
    registration: { showNotification: async (title: string, options: { tag: string; data: { url: string } }) => { shown = { title, options }; } },
  } });
  handlers['push']({ data: { json: () => data }, waitUntil: (promise: Promise<void>) => { completed = promise; } });
  await completed;
  assert.ok(shown);
  return shown;
}

test('a retried TICA notice keeps one tag even if its delivery text changes', async () => {
  const first = await notification({ kind: 'tica-daily', title: 'TICA', body: '5 stuks', url: '/tica', tag: 'tica-42' });
  const retry = await notification({ kind: 'tica-daily', title: 'TICA', body: '5 stuks · dagoverzicht', url: '/tica', tag: 'tica-42' });
  assert.equal(first.options.tag, 'tica-42');
  assert.equal(retry.options.tag, first.options.tag);
  assert.equal(retry.options.data.url, '/tica');
});

test('existing push senders and invalid optional tags retain their notification grouping', async () => {
  assert.equal((await notification({ kind: 'sale-invoice', body: 'Factuur 123' })).options.tag, 'sale-invoice:Factuur 123');
  assert.equal((await notification({ kind: 'login-request', body: 'Nieuwe aanvraag', url: '/klantlogins?open=7', tag: ' ' })).options.tag, 'login-request:/klantlogins?open=7');
});
