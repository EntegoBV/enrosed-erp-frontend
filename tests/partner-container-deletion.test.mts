import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { signal } from '@angular/core';
import { parseTemplate } from '@angular/compiler';
import { firstValueFrom, of } from 'rxjs';
import { messageOf } from '../src/app/core/api/errors.ts';

function isolate(source: string, name: string, members: string[], globals: Record<string, any> = {}) {
  const parsed = ts.createSourceFile('fixture.ts', source, ts.ScriptTarget.Latest, true);
  const original = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === name);
  assert.ok(original);
  const selected = original.members.filter(member => member.name && ts.isIdentifier(member.name) && members.includes(member.name.text));
  assert.equal(selected.length, members.length);
  const isolated = ts.factory.updateClassDeclaration(original, original.modifiers?.filter(modifier => !ts.isDecorator(modifier)), original.name, undefined, undefined, selected);
  const js = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [isolated])), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: any = {}; vm.runInNewContext(js, { exports, ...globals }); return exports[name];
}
const menuSource = await readFile(new URL('../src/app/features/sales/sales-container-menu.ts', import.meta.url), 'utf8');
const listSource = await readFile(new URL('../src/app/features/sales/sales-list.ts', import.meta.url), 'utf8');
const apiSource = await readFile(new URL('../src/app/core/api/partner-container-deletion-api.ts', import.meta.url), 'utf8');
const Menu = isolate(menuSource, 'SalesContainerMenu', ['close', 'back', 'check', 'remove', 'ngOnDestroy'], { messageOf });
const preview = (allowed = true) => ({ purchaseOrderId: 50, number: 'PO-50', allowed, blockReason: allowed ? null : 'Factuur 82 is al uitgereikt.',
  invoices: [{ id: 81, number: 'INV-81', status: 'CONCEPT', totalEur: 18145.27 }, { id: 82, number: 'INV-82', status: allowed ? 'CONCEPT' : 'UITGEREIKT', totalEur: 36290.55 }] });
function harness() {
  const menu = new Menu(), calls: any[] = [], deleted: any[] = [], busy: boolean[] = [], closed: boolean[] = [];
  Object.assign(menu, {
    container: signal({ purchaseOrderId: 50, rows: [{ order: { id: 81 } }] }), externalBusy: signal(false),
    reviewing: signal(false), checking: signal(false), deleting: signal(false), preview: signal(null), error: signal(''),
    version: 0, destroyed: false, closed: { emit: () => closed.push(true) }, deleted: { emit: (value: any) => deleted.push(value) }, busyChange: { emit: (value: boolean) => busy.push(value) },
    api: { preview: async (id: number) => { calls.push({ method: 'GET', id }); return preview(); },
      remove: async (id: number, ids: number[]) => { calls.push({ method: 'POST', id, ids: Array.from(ids) }); return { purchaseOrderId: id, deletedInvoiceIds: [81, 82] }; } },
  });
  return { menu, calls, deleted, busy, closed };
}

test('checking is read only and cancellation never deletes a container', async () => {
  const { menu, calls, deleted, closed } = harness();
  await menu.remove(); assert.equal(calls.length, 0);
  await menu.check(); assert.deepEqual(calls, [{ method: 'GET', id: 50 }]);
  assert.equal(menu.preview().invoices.length, 2);
  menu.back(); await menu.remove(); menu.close();
  assert.equal(menu.preview(), null); assert.equal(menu.reviewing(), false);
  assert.equal(deleted.length, 0); assert.equal(closed.length, 1); assert.equal(calls.length, 1);
});

test('explicit removal submits the full server invoice set once, even when search shows one invoice', async () => {
  const { menu, calls, deleted, busy, closed } = harness(); await menu.check();
  let finish!: (response: any) => void;
  menu.api.remove = (id: number, ids: number[]) => { calls.push({ method: 'POST', id, ids: Array.from(ids) }); return new Promise(resolve => { finish = resolve; }); };
  const pending = menu.remove(); await menu.remove(); menu.back(); menu.close();
  assert.equal(closed.length, 0); assert.equal(menu.reviewing(), true); assert.equal(menu.deleting(), true);
  assert.deepEqual(calls[1], { method: 'POST', id: 50, ids: [81, 82] });
  finish({ purchaseOrderId: 50, deletedInvoiceIds: [81, 82] }); await pending;
  assert.equal(calls.length, 2); assert.equal(deleted.length, 1); assert.deepEqual(busy, [true, false]);
});

test('backend eligibility and concurrent local mutations block submission', async () => {
  const { menu, calls, deleted } = harness(); menu.api.preview = async () => preview(false);
  await menu.check(); await menu.remove(); assert.equal(calls.length, 0); assert.equal(deleted.length, 0);
  assert.match(menu.preview().blockReason, /al uitgereikt/);
  menu.preview.set(preview()); menu.externalBusy.set(true); await menu.remove(); await menu.check();
  assert.equal(calls.length, 0);
});

test('changed invoice set or failed deletion requires a new check before any retry', async () => {
  const { menu, calls, deleted } = harness(); await menu.check();
  menu.api.remove = async () => { calls.push({ method: 'POST' }); throw { status: 409, error: { message: 'De gekoppelde facturen zijn gewijzigd. Controleer opnieuw.' } }; };
  await menu.remove(); assert.match(menu.error(), /facturen zijn gewijzigd/); assert.equal(menu.preview(), null);
  assert.equal(menu.deleting(), false); assert.equal(deleted.length, 0);
  await menu.remove(); assert.equal(calls.length, 2, 'A stale invoice set is never submitted again');
  await menu.check(); assert.equal(calls.length, 3); assert.equal(menu.error(), ''); assert.equal(menu.preview().allowed, true);
});

test('stale or mismatched previews and destroyed dialogs cannot authorize a different container', async () => {
  const { menu, calls, deleted } = harness(); let finish!: (response: any) => void;
  menu.api.preview = () => new Promise(resolve => { finish = resolve; }); const pending = menu.check();
  menu.back(); finish(preview()); await pending; assert.equal(menu.preview(), null);
  menu.api.preview = async () => ({ ...preview(), purchaseOrderId: 99 }); await menu.check();
  assert.equal(menu.preview(), null); assert.match(menu.error(), /niet overeen/); await menu.remove(); assert.equal(calls.length, 0);
  menu.api.preview = async () => preview(); await menu.check();
  menu.api.remove = () => new Promise(resolve => { finish = resolve; }); const deletion = menu.remove();
  menu.ngOnDestroy(); finish({ purchaseOrderId: 50, deletedInvoiceIds: [81, 82] }); await deletion;
  assert.equal(deleted.length, 0);
});

test('API uses the atomic container endpoint and posts only the expected server invoice ids', async () => {
  const Api = isolate(apiSource, 'PartnerContainerDeletionApi', ['preview', 'remove'], { firstValueFrom, api: (path: string) => path });
  const instance = new Api(), calls: any[] = [];
  instance.http = { get: (path: string) => { calls.push(['GET', path]); return of(preview()); },
    post: (path: string, body: any) => { calls.push(['POST', path, JSON.parse(JSON.stringify(body))]); return of({ purchaseOrderId: 50, deletedInvoiceIds: [81, 82] }); } };
  await instance.preview(50); await instance.remove(50, [81, 82]);
  assert.deepEqual(calls, [['GET', '/api/purchase-orders/50/partner-container-deletion'], ['POST', '/api/purchase-orders/50/partner-container-deletion', { expectedInvoiceIds: [81, 82] }]]);
});

const List = isolate(listSource, 'SalesList', ['openContainerMenu', 'containerDeleted', 'load'], { messageOf });
function listHarness() {
  const list = new List(), toasts: string[] = [], refreshed: boolean[] = [];
  Object.assign(list, { all: signal([{ order: { id: 81 } }, { order: { id: 82 } }, { order: { id: 99 } }]),
    loading: signal(false), loadError: signal(null), loadVersion: 0, chosen: signal(1), customers: signal([]), countries: signal([]), picking: signal(false),
    expandedGroups: signal(new Set(['container-50-customer-1', 'container-60-customer-1'])),
    containerMenu: signal(null), containerDeletingId: signal(null), rowMenu: signal({}), openRow: signal({}), deletingOrderId: signal(null), archivingOrderId: signal(null),
    ui: { confirmRequest: () => null, toast: (text: string) => toasts.push(text) },
    sales: { orders: async () => [{ order: { id: 99 } }], customers: async () => [{ id: 1 }], countries: async () => [] },
    work: { refresh: async (force: boolean) => { refreshed.push(force); } },
  });
  return { list, toasts, refreshed };
}

test('container actions keep the collapse state and prevent ordinary row actions from overlapping', () => {
  const { list } = listHarness(); const event = { preventDefault() {}, stopPropagation() {} }, group = { purchaseOrderId: 50 };
  list.openContainerMenu(event, group); assert.equal(list.containerMenu(), group); assert.equal(list.rowMenu(), null); assert.equal(list.openRow(), null);
  list.containerDeletingId.set(50); list.openContainerMenu(event, { purchaseOrderId: 60 }); assert.equal(list.containerMenu(), group);
  list.containerDeletingId.set(null); list.deletingOrderId.set(81); list.openContainerMenu(event, { purchaseOrderId: 60 }); assert.equal(list.containerMenu(), group);
});

test('success removes the complete cascade and stale overview responses cannot restore hidden invoices', async () => {
  const { list, toasts, refreshed } = listHarness(); let finish!: (value: any) => void;
  list.sales.orders = () => new Promise(resolve => { finish = resolve; }); const stale = list.load();
  list.sales.orders = async () => [{ order: { id: 99 } }];
  await list.containerDeleted({ purchaseOrderId: 50, deletedInvoiceIds: [81, 82] });
  finish([{ order: { id: 81 } }, { order: { id: 82 } }, { order: { id: 99 } }]); await stale;
  assert.deepEqual(list.all().map((row: any) => row.order.id), [99]); assert.equal(list.containerMenu(), null);
  assert.deepEqual(Array.from(list.expandedGroups()), ['container-60-customer-1']);
  assert.match(toasts[0], /2 voorschotfacturen tijdelijk verwijderd/); assert.deepEqual(refreshed, [true]);
});

test('a failed post-delete refresh keeps local deletion and reports only the loading problem', async () => {
  const { list, toasts } = listHarness(); list.sales.orders = async () => { throw { status: 0 }; };
  await list.containerDeleted({ purchaseOrderId: 50, deletedInvoiceIds: [81, 82] });
  assert.deepEqual(list.all().map((row: any) => row.order.id), [99]); assert.equal(list.loading(), false);
  assert.match(list.loadError(), /Geen verbinding/); assert.equal(toasts.length, 1);
});

test('templates expose keyboard actions and full scope, preserve escaped text and nullable amounts', () => {
  for (const [source, name] of [[menuSource, 'sales-container-menu'], [listSource, 'sales-list']]) {
    const template = /template:\s*`([\s\S]*?)`,\s*styles:/.exec(source)?.[1]; assert.ok(template);
    assert.equal(parseTemplate(template, `${name}.html`).errors, null);
  }
  assert.match(listSource, /class="sales-container__menu" type="button" aria-haspopup="dialog"/);
  assert.match(listSource, /\(contextmenu\)="openContainerMenu\(\$event, entry\)"/);
  assert.match(menuSource, /volledige factuurlijst/); assert.match(menuSource, /Herstel eerst de container en daarna de facturen/);
  assert.match(menuSource, /invoice.totalEur === null \? 'Niet beschikbaar'/);
  assert.doesNotMatch(menuSource, /innerHTML|deleteOrder\(|sendOrder\(/);
});
