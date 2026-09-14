import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { signal, type WritableSignal } from '@angular/core';
import ts from 'typescript';
import { messageOf } from '../src/app/core/api/errors.ts';
import type { PlannerItem } from '../src/app/core/api/planner-api.ts';

// Exercise the production class and its initializers without bootstrapping HTTP or a browser.
const source = fs.readFileSync(new URL('../src/app/core/api/planner-api.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('planner-api.ts', source, ts.ScriptTarget.Latest, true);
const declaration = parsed.statements.find((node): node is ts.ClassDeclaration =>
  ts.isClassDeclaration(node) && node.name?.text === 'PlannerStore');
assert.ok(declaration, 'PlannerStore must be present');
const compiled = ts.transpileModule(
  `class Subject { ${declaration.members.map(member => member.getText(parsed)).join('\n')} }
   module.exports = Subject;`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
).outputText;

interface Store {
  items: WritableSignal<PlannerItem[]>;
  loaded: WritableSignal<boolean>;
  loading: WritableSignal<boolean>;
  error: WritableSignal<string | null>;
  reload(afterMutation?: boolean): Promise<void>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function harness() {
  const requests: ReturnType<typeof deferred<PlannerItem[]>>[] = [];
  const api = { list: () => {
    const task = deferred<PlannerItem[]>();
    requests.push(task);
    return task.promise;
  } };
  const context = { module: { exports: null as unknown as new () => Store },
    inject: () => api, PlannerApi: {}, signal, messageOf };
  vm.runInNewContext(compiled, context);
  return { store: new context.module.exports(), requests };
}

const appointment = (id: number, title = 'Afspraak'): PlannerItem => ({
  id, title, kind: 'EVENT', onDate: '2026-09-14', atTime: '10:00', note: null, done: false,
});

test('successful load exposes appointments only after completion and marks the data loaded', async () => {
  const { store, requests } = harness();
  assert.equal(store.loaded(), false);
  assert.equal(store.loading(), false);
  assert.equal(store.error(), null);
  assert.equal(store.items().length, 0);
  const pending = store.reload();
  assert.equal(store.loading(), true);
  assert.equal(store.loaded(), false);
  const items = [appointment(1)];
  requests[0].resolve(items);
  await pending;
  assert.strictEqual(store.items(), items);
  assert.equal(store.loaded(), true);
  assert.equal(store.loading(), false);
  assert.equal(store.error(), null);
});

test('parallel dashboard and agenda reloads share one in-flight request', async () => {
  const { store, requests } = harness();
  const dashboard = store.reload();
  const agenda = store.reload();
  const refreshClick = store.reload();
  assert.equal(requests.length, 1);
  assert.strictEqual(dashboard, agenda);
  assert.strictEqual(agenda, refreshClick);
  requests[0].resolve([appointment(1)]);
  await Promise.all([dashboard, agenda, refreshClick]);
  assert.equal(store.items()[0].id, 1);
  assert.equal(store.loading(), false);

  const next = store.reload();
  assert.equal(requests.length, 2);
  requests[1].resolve([appointment(2)]);
  await next;
  assert.equal(store.items()[0].id, 2);
});

test('a failed refresh preserves the last loaded appointments and a retry replaces them', async () => {
  const { store, requests } = harness();
  const first = store.reload();
  const previous = [appointment(1, 'Ontvangstgesprek')];
  requests[0].resolve(previous);
  await first;

  const failed = store.reload();
  assert.strictEqual(store.items(), previous);
  assert.equal(store.loaded(), true);
  requests[1].reject({ status: 503, error: { message: 'Agenda tijdelijk niet beschikbaar' } });
  await failed;
  assert.strictEqual(store.items(), previous);
  assert.equal(store.loaded(), true);
  assert.equal(store.loading(), false);
  assert.equal(store.error(), 'Agenda tijdelijk niet beschikbaar');

  const retry = store.reload();
  assert.equal(store.loading(), true);
  assert.equal(store.error(), null);
  assert.strictEqual(store.items(), previous);
  requests[2].resolve([appointment(1, 'Bijgewerkte afspraak'), appointment(2)]);
  await retry;
  assert.deepEqual(store.items().map(item => item.title), ['Bijgewerkte afspraak', 'Afspraak']);
  assert.equal(store.loaded(), true);
  assert.equal(store.loading(), false);
  assert.equal(store.error(), null);
});

test('an initial failure is never presented as a successfully loaded empty agenda', async () => {
  const { store, requests } = harness();
  const failed = store.reload();
  const shared = store.reload();
  requests[0].reject({ status: 502, error: '<html>Proxy failure</html>' });
  await Promise.all([failed, shared]);
  assert.equal(store.loaded(), false);
  assert.equal(store.loading(), false);
  assert.equal(store.items().length, 0);
  assert.equal(store.error(), 'De agenda kon niet worden bijgewerkt.');

  const retry = store.reload();
  assert.equal(requests.length, 2);
  assert.equal(store.loaded(), false);
  requests[1].resolve([]);
  await retry;
  assert.equal(store.loaded(), true);
  assert.equal(store.items().length, 0);
  assert.equal(store.loading(), false);
  assert.equal(store.error(), null);
});

test('an authoritative empty refresh clears removed appointments', async () => {
  const { store, requests } = harness();
  const first = store.reload();
  requests[0].resolve([appointment(1)]);
  await first;
  const refresh = store.reload();
  requests[1].resolve([]);
  await refresh;
  assert.equal(store.items().length, 0);
  assert.equal(store.loaded(), true);
  assert.equal(store.error(), null);
});

test('a mutation during an older GET waits for a fresh read before reporting the agenda current', async () => {
  const { store, requests } = harness();
  const earlierRead = store.reload();
  let mutationReloadFinished = false;
  // The write has completed, but the read started before it is still in flight.
  const afterMutation = store.reload(true).then(() => { mutationReloadFinished = true; });
  const anotherMutation = store.reload(true);
  assert.equal(requests.length, 1);
  requests[0].resolve([appointment(1, 'Oude afspraak')]);
  await earlierRead;
  assert.equal(requests.length, 2);
  assert.equal(mutationReloadFinished, false);
  assert.equal(store.loading(), true);

  const ordinaryRefresh = store.reload();
  assert.equal(requests.length, 2);
  requests[1].resolve([appointment(1, 'Gewijzigde afspraak'), appointment(2)]);
  await Promise.all([afterMutation, anotherMutation, ordinaryRefresh]);
  assert.deepEqual(store.items().map(item => item.title), ['Gewijzigde afspraak', 'Afspraak']);
  assert.equal(mutationReloadFinished, true);
  assert.equal(requests.length, 2);
  assert.equal(store.loaded(), true);
  assert.equal(store.loading(), false);
  assert.equal(store.error(), null);
});
