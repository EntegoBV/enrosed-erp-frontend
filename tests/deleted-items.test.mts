import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { signal, computed } from '@angular/core';
import { parseTemplate } from '@angular/compiler';
import { firstValueFrom, of } from 'rxjs';
import type { DeletedItemDetail, DeletedItemSummary } from '../src/app/core/api/deleted-items-api.ts';
import { deletedAttachmentFilename, deletedItemLabel, filterDeletedItems, restoredItemRoute } from '../src/app/features/settings/deleted-items-state.ts';
import { TEMPORARY_DELETION_NOTICE } from '../src/app/shared/deleted-item-notice.ts';
import { messageOf } from '../src/app/core/api/errors.ts';

const item = (id = 1, extra: Partial<DeletedItemDetail> = {}): DeletedItemDetail => ({
  id, sourceId: 100 + id, type: 'INVOICE', number: `FACTUUR-${id}`, partyName: 'Café & Co', status: 'CONCEPT',
  deletedAt: '2026-09-10T10:00:00Z', expiresAt: '2026-12-09T10:00:00Z', deletedBy: 'Emre', totalEur: 18145.27,
  restoreAllowed: true, blockReason: null, fields: [{ label: 'BTW', value: '0%' }], lines: [], notes: 'Niet versturen.', attachments: [], ...extra,
});
const escapeHtml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');

function isolate(source: string, name: string, members: string[], globals: Record<string, any>) {
  const parsed = ts.createSourceFile('fixture.ts', source, ts.ScriptTarget.Latest, true);
  const original = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === name);
  assert.ok(original);
  const selected = original.members.filter(member => member.name && ts.isIdentifier(member.name) && members.includes(member.name.text));
  assert.equal(selected.length, members.length);
  const isolated = ts.factory.updateClassDeclaration(original, original.modifiers?.filter(modifier => !ts.isDecorator(modifier)), original.name, undefined, undefined, selected);
  const js = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [isolated])), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: any = {}; vm.runInNewContext(js, { exports, ...globals }); return exports[name];
}
const source = await readFile(new URL('../src/app/features/settings/deleted-items-page.ts', import.meta.url), 'utf8');
const downloads: { blob: Blob; filename: string }[] = [];
const Page = isolate(source, 'DeletedItemsPage', ['visible', 'load', 'open', 'close', 'confirmRestore', 'restore', 'downloadAttachment', 'ngOnDestroy'], {
  signal, computed, filterDeletedItems, restoredItemRoute, messageOf, escapeHtml, deletedAttachmentFilename, saveBlob: (blob: Blob, filename: string) => downloads.push({ blob, filename }),
});
function harness() {
  const page = new Page(), calls: string[] = [], toasts: string[] = [], prompts: any[] = [];
  const confirmRequest = signal<any>(null);
  Object.assign(page, {
    items: signal<DeletedItemSummary[]>([]), query: signal(''), type: signal(''), retentionDays: signal(null), loading: signal(false), listError: signal(''),
    selected: signal(null), detail: signal(null), detailLoading: signal(false), detailError: signal(''), attachmentBusy: signal({}), attachmentErrors: signal({}), restoringId: signal(null), restored: signal(null),
    listVersion: 0, detailVersion: 0, destroyed: false, label: deletedItemLabel,
    api: { list: async () => { calls.push('GET list'); return { retentionDays: 30, items: [item()] }; },
      detail: async (id: number) => { calls.push(`GET ${id}`); return item(id); },
      restore: async (id: number) => { calls.push(`POST ${id}/restore`); return { sourceId: 100 + id, targetRoute: `/sales/${100 + id}` }; } },
    ui: { confirmRequest, confirm: (options: unknown, callback: () => void) => { prompts.push(options); confirmRequest.set(callback); }, toast: (text: string) => toasts.push(text) },
    work: { refresh: async () => { calls.push('GET notifications'); } },
  });
  return { page, calls, toasts, prompts, confirmRequest };
}

test('search matches all entered words and type, preserving source ordering and cents', () => {
  const list = [item(1), item(2, { type: 'QUOTE', number: 'OFF-45', deletedAt: '2026-09-11T10:00:00Z' }), item(3, { type: 'PURCHASE_ORDER', partyName: 'Shanghai Flowers', number: 'INK-45' })];
  assert.deepEqual(filterDeletedItems(list, 'cafe 45', '').map(row => row.id), [2]);
  assert.deepEqual(filterDeletedItems(list, '45', 'PURCHASE_ORDER').map(row => row.id), [3]);
  assert.deepEqual(filterDeletedItems(list, '', '').map(row => row.id), [2, 3, 1]);
  assert.deepEqual(list.map(row => row.id), [1, 2, 3]);
  assert.equal(filterDeletedItems(list, 'FACTUUR', '')[0].totalEur, 18145.27);
});

test('restored links target only the same document and never an external or different financial route', () => {
  assert.equal(restoredItemRoute(item(), { sourceId: 101, targetRoute: '/sales/101' }), '/sales/101');
  assert.equal(restoredItemRoute(item(1, { type: 'PURCHASE_ORDER' }), { sourceId: 101, targetRoute: '/purchasing/101' }), '/purchasing/101');
  for (const targetRoute of ['https://example.com', '//evil.test', '/sales/101/send', '/sales/999', '/purchasing/101', '/sales/101?send=true']) {
    assert.equal(restoredItemRoute(item(), { sourceId: 101, targetRoute }), null);
  }
  assert.equal(restoredItemRoute(item(), { sourceId: 999, targetRoute: '/sales/999' }), null);
});

test('listing and opening are read only, use server retention, and do not restore without confirmation', async () => {
  const { page, calls, prompts } = harness();
  await page.load(); assert.equal(page.retentionDays(), 30);
  await page.open(item()); assert.deepEqual(calls, ['GET list', 'GET 1']);
  page.confirmRestore(); assert.equal(prompts.length, 1); assert.match(prompts[0].message, /Café &amp; Co/);
  assert.deepEqual(calls, ['GET list', 'GET 1']);
  page.close(); assert.equal(page.detail(), null);
});

test('restore is explicit, single-flight, removes only its row, and offers a safe opening link', async () => {
  const { page, calls, toasts } = harness();
  page.items.set([item(1), item(2)]); await page.open(item());
  let finish!: (response: unknown) => void;
  page.api.restore = (id: number) => { calls.push(`POST ${id}/restore`); return new Promise(resolve => { finish = resolve; }); };
  const pending = page.restore(page.detail()); await page.restore(page.detail());
  page.close(); assert.equal(page.selected()?.id, 1, 'Keep the pending dialog open');
  finish({ sourceId: 101, targetRoute: '/sales/101' }); await pending;
  assert.equal(calls.filter(call => call.startsWith('POST')).length, 1);
  assert.deepEqual(page.items().map((row: DeletedItemSummary) => row.id), [2]);
  assert.equal(page.selected(), null); assert.equal(page.restored().route, '/sales/101');
  assert.equal(toasts.length, 1);
});

test('backend blocks and failures keep the deleted document available for review and retry', async () => {
  const { page, calls, prompts } = harness(); await page.load();
  page.api.detail = async () => item(1, { restoreAllowed: false, blockReason: 'Er bestaat al een voorschotfactuur voor deze termijn.' });
  await page.open(item()); page.confirmRestore(); await page.restore(page.detail());
  assert.equal(prompts.length, 0); assert.equal(calls.filter(call => call.startsWith('POST')).length, 0);
  page.api.detail = async () => item(); await page.open(item());
  page.api.restore = async () => { throw { status: 409, error: { message: 'De hersteltermijn is verstreken.' } }; };
  await page.restore(page.detail());
  assert.equal(page.detailError(), 'De hersteltermijn is verstreken.'); assert.equal(page.items().length, 1);
  assert.equal(page.restoringId(), null); assert.equal(page.restored(), null);
  page.api.list = async () => { throw { status: 0 }; }; await page.load(); assert.match(page.listError(), /Geen verbinding/);
  assert.equal(page.items().length, 1);
});

test('stale detail replies cannot replace another document and stale list refresh cannot resurrect restored rows', async () => {
  const { page } = harness(); page.items.set([item()]);
  let finishFirst!: (value: unknown) => void;
  page.api.detail = () => new Promise(resolve => { finishFirst = resolve; }); const first = page.open(item());
  page.api.detail = async () => item(2); await page.open(item(2)); finishFirst(item()); await first;
  assert.equal(page.detail().id, 2);
  let finishList!: (value: unknown) => void;
  page.api.list = () => new Promise(resolve => { finishList = resolve; }); const refresh = page.load();
  await page.restore(page.detail()); finishList({ retentionDays: 90, items: [item(), item(2)] }); await refresh;
  assert.equal(page.items().some((row: DeletedItemSummary) => row.id === 2), false);
  assert.equal(page.loading(), false);
});

test('destroyed pages discard pending reads and restores without late UI updates', async () => {
  const { page, toasts } = harness(); await page.open(item());
  let finish!: (value: unknown) => void;
  page.api.restore = () => new Promise(resolve => { finish = resolve; }); const pending = page.restore(page.detail());
  page.ngOnDestroy(); finish({ sourceId: 101, targetRoute: '/sales/101' }); await pending;
  assert.equal(toasts.length, 0); assert.equal(page.restored(), null);
});

test('attachment filenames discard path and reserved characters while preserving usable names', () => {
  assert.equal(deletedAttachmentFilename('../leverancier/factuur.pdf'), 'factuur.pdf');
  assert.equal(deletedAttachmentFilename('C:\\facturen\\factuur?.pdf'), 'factuur_.pdf');
  assert.equal(deletedAttachmentFilename('  Café & Co.pdf  '), 'Café & Co.pdf');
  assert.equal(deletedAttachmentFilename('../..'), 'bijlage');
  assert.equal(deletedAttachmentFilename('factuur\u202e\u0000.pdf'), 'factuur.pdf');
});

test('attachment downloads use snapshot IDs only, ignore null URLs and prevent repeated pending requests', async () => {
  downloads.length = 0;
  const { page } = harness();
  page.api.detail = async () => item(1, { attachments: [
    { id: 501, name: '../factuur?.pdf', url: 'https://untrusted.example/not-used' },
    { id: 502, name: 'naam.pdf', url: null },
  ] });
  await page.open(item()); const requests: number[][] = [];
  let finish!: (blob: Blob) => void;
  page.api.attachment = (id: number, attachmentId: number) => { requests.push([id, attachmentId]); return new Promise(resolve => { finish = resolve; }); };
  await page.downloadAttachment(502); await page.downloadAttachment(999); assert.equal(requests.length, 0);
  const pending = page.downloadAttachment(501); await page.downloadAttachment(501);
  assert.equal(page.attachmentBusy()[501], true); assert.deepEqual(requests, [[1, 501]]);
  const blob = new Blob(['%PDF-1.4 fixture'], { type: 'application/pdf' }); finish(blob); await pending;
  assert.equal(downloads.length, 1); assert.equal(downloads[0].blob, blob); assert.equal(downloads[0].filename, 'factuur_.pdf');
  assert.equal(page.attachmentBusy()[501], false);
});

test('attachment errors belong to that file, can retry, and late results after closing never download', async () => {
  downloads.length = 0; const { page } = harness();
  page.api.detail = async () => item(1, { attachments: [{ id: 501, name: 'factuur.pdf', url: '/api/deleted-items/1/attachments/501/file' }] });
  await page.open(item());
  page.api.attachment = async () => { throw { status: 403 }; };
  await page.downloadAttachment(501); assert.match(page.attachmentErrors()[501], /geen toegang/);
  assert.equal(page.detailError(), ''); assert.equal(page.attachmentBusy()[501], false);
  page.api.attachment = async () => new Blob(['%PDF retry']); await page.downloadAttachment(501);
  assert.equal(page.attachmentErrors()[501], ''); assert.equal(downloads.length, 1);
  let finish!: (blob: Blob) => void; page.api.attachment = () => new Promise(resolve => { finish = resolve; });
  const pending = page.downloadAttachment(501); page.close(); finish(new Blob(['%PDF stale'])); await pending;
  assert.equal(downloads.length, 1); assert.equal(page.selected(), null);
});

test('API uses exact trash endpoints and never calls active order or financial APIs', async () => {
  const apiSource = await readFile(new URL('../src/app/core/api/deleted-items-api.ts', import.meta.url), 'utf8');
  const Api = isolate(apiSource, 'DeletedItemsApi', ['list', 'detail', 'attachment', 'restore'], { firstValueFrom, api: (path: string) => path });
  const api = new Api(), calls: unknown[] = [];
  api.http = { get: (...args: unknown[]) => { calls.push(['GET', ...args]); return of({}); }, post: (...args: unknown[]) => { calls.push(['POST', ...args]); return of({}); } };
  await api.list(); await api.detail(5); await api.attachment(5, 501); await api.restore(5);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['GET', '/api/deleted-items'], ['GET', '/api/deleted-items/5'], ['GET', '/api/deleted-items/5/attachments/501/file', { responseType: 'blob' }], ['POST', '/api/deleted-items/5/restore', {}]]);
});

const purchaseSource = await readFile(new URL('../src/app/features/purchasing/purchase-editor.ts', import.meta.url), 'utf8');
const Purchase = isolate(purchaseSource, 'PurchaseEditor', ['dirty', 'remove', 'deleteAndLeave', 'canDeactivate', 'save'], { computed, messageOf, escapeHtml, TEMPORARY_DELETION_NOTICE, clearTimeout });
function purchaseHarness() {
  const page = new Purchase(), calls: string[] = [], messages: string[] = [];
  Object.assign(page, { view: signal({ order: { id: 50, number: 'PO <img src=x>', notes: 'Wijziging' } }),
    savedOrder: signal(JSON.stringify({ id: 50, number: 'PO <img src=x>', notes: '' })),
    deletingOrder: signal(false), saving: signal(false), previewTimer: null, previewVersion: 0, isReceived: () => false,
    ui: { confirmRequest: () => null, confirm: (options: any) => messages.push(options.message), toast: (text: string) => messages.push(text) },
    sourcing: { deletePurchaseOrder: async () => { calls.push('DELETE purchase'); } },
    router: { navigate: async () => { assert.equal(page.canDeactivate(), true); calls.push('navigate'); return true; } },
  }); return { page, calls, messages };
}

test('purchase delete confirms temporary removal, escapes names and never offers saving deleted dirty state', async () => {
  const { page, calls, messages } = purchaseHarness();
  assert.equal(page.dirty(), true); page.remove(); assert.match(messages[0], /PO &lt;img src=x&gt;/);
  assert.match(messages[0], /Niet-opgeslagen/); assert.match(messages[0], /tijdelijk/); assert.deepEqual(calls, []);
  await page.deleteAndLeave(page.view()); assert.equal(page.dirty(), false);
  assert.deepEqual(calls, ['DELETE purchase', 'navigate']); assert.equal(page.deletingOrder(), false);
});

test('pending purchase deletion blocks duplicate DELETE and save; failures preserve dirty state', async () => {
  const { page, calls } = purchaseHarness(); let reject!: (failure: unknown) => void;
  page.sourcing.deletePurchaseOrder = () => { calls.push('DELETE'); return new Promise((_resolve, fail) => { reject = fail; }); };
  const pending = page.deleteAndLeave(page.view()); await page.deleteAndLeave(page.view());
  assert.equal(await page.save(), null); assert.equal(page.canDeactivate(), false);
  reject({ error: { message: 'Deze order kan niet worden verwijderd.' } }); await pending;
  assert.deepEqual(calls, ['DELETE']); assert.equal(page.dirty(), true); assert.equal(page.deletingOrder(), false);
});

test('templates parse with read-only details, no direct attachment links, and all five confirmations use temporary-removal copy', async () => {
  const template = /template:\s*`([\s\S]*?)`,\s*styles:/.exec(source)?.[1]; assert.ok(template);
  assert.equal(parseTemplate(template, 'deleted-items.html').errors, null);
  assert.doesNotMatch(template, /innerHTML|\[href\]|app-sales-editor|app-purchase-editor|Definitief verwijderen/);
  assert.match(template, /\{\{ data.notes \}\}/); assert.match(template, /aria-pressed/);
  for (const file of ['sales/sales-list.ts', 'sales/sales-view.ts', 'sales/sales-editor.ts', 'purchasing/purchase-list.ts', 'purchasing/purchase-editor.ts']) {
    const content = await readFile(new URL('../src/app/features/' + file, import.meta.url), 'utf8');
    assert.match(content, /TEMPORARY_DELETION_NOTICE/); assert.doesNotMatch(content, /Dit kan niet ongedaan worden gemaakt|definitief verwijderen\?/);
  }
});
