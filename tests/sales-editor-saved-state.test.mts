import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { computed, signal } from '@angular/core';
import { firstValueFrom, of } from 'rxjs';
import { withPaymentState } from '../src/app/features/sales/sales-payment-state.ts';
import { normalizeSalesPdfOptions, salesPdfQuery } from '../src/app/core/api/sales-pdf-options.ts';
import { messageOf } from '../src/app/core/api/errors.ts';
import { customerMessageIsReadOnly } from '../src/app/features/sales/quote-status.ts';

async function isolate(file: string, name: string, names: string[], globals: Record<string, any> = {}) {
  const source = ts.createSourceFile(file, await readFile(new URL(`../src/app/${file}.ts`, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const cls = source.statements.find((n): n is ts.ClassDeclaration => ts.isClassDeclaration(n) && n.name?.text === name); assert.ok(cls);
  const members = cls.members.filter(m => m.name && names.includes(m.name.getText(source))); assert.equal(members.length, names.length);
  const isolated = ts.factory.updateClassDeclaration(cls, cls.modifiers?.filter(m => !ts.isDecorator(m)), cls.name, undefined, undefined, members);
  const js = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(source, [isolated])), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: any = {}; vm.runInNewContext(js, { exports, signal, computed, clearTimeout, Map, messageOf, withPaymentState, customerMessageIsReadOnly, ...globals }); return exports[name];
}
const Editor = await isolate('features/sales/sales-editor', 'SalesEditor', [
  'documentMutationBusy', 'mobileSplitBusy', 'mobileFinanciallyLocked', 'mobileAcceptsDraft', 'canEdit', 'canEditTerms', 'dirty', 'adopt', 'enqueue', 'save', 'paymentReceived', 'setLine', 'saveFreight',
]);
const Desk = await isolate('features/sales/sales-desk', 'SalesDesk', ['markSent', 'shipGoods']);
Object.setPrototypeOf(Desk.prototype, Editor.prototype);
const PdfApi = await isolate('core/api/sales-api', 'SalesApi', ['quotePdf'], { firstValueFrom, salesPdfQuery, api: (path: string) => path });
const downloads: string[] = [];
const PdfSheet = await isolate('features/sales/sales-pdf-sheet', 'SalesPdfSheet', ['downloadDocument', 'safeFilename'], { saveBlob: (_blob: unknown, filename: string) => downloads.push(filename) });
const document = (status = 'CONCEPT', extra: Record<string, any> = {}) => ({
  order: { id: 65, number: 'QA-PARTNER-65', docType: 'FACTUUR', purpose: 'PARTNER_ADVANCE', status, archivedAt: null,
    notes: 'Opgeslagen notitie', paidAt: null, sentAt: null, lines: [], ...extra },
  paymentSummary: { receivedEur: 0, remainingEur: 18145.27 },
});
function harness(initial = document()) {
  const screen = new Editor(), calls: string[] = [], toasts: string[] = [];
  Object.setPrototypeOf(screen, Desk.prototype);
  Object.assign(screen, {
    documentMutationBusy: signal(false), advanceAgreement: () => null, view: signal(initial),
    savedOrder: signal(JSON.stringify(initial.order)), saveError: signal(null), previewError: signal(null), saving: signal(false),
    previewVersion: 0, previewTimer: null, linePending: signal({}), shipSheet: signal({}),
    loadHistory: async () => { calls.push('GET history'); }, schedulePreview: () => { calls.push('POST preview'); },
    ui: { toast: (text: string) => toasts.push(text) },
    sales: {
      markInvoiceSent: async () => { calls.push('POST mark-sent'); return document('UITGEREIKT'); },
      shipGoods: async () => { calls.push('POST ship'); return document('VERZONDEN', { goodsShippedAt: '2026-09-10T10:00:00Z' }); },
      updateOrder: async (_id: number, order: any) => { calls.push('PUT order'); return { ...initial, order: { ...order } }; },
    },
  });
  screen.invoiceBusy = screen.documentMutationBusy;
  return { screen, calls, toasts };
}

test('issuing an invoice adopts the server baseline and PDF settings download only with GET', async () => {
  const { screen, calls } = harness(); assert.equal(screen.dirty(), false);
  await screen.markSent(screen.view());
  assert.equal(screen.view().order.status, 'UITGEREIKT'); assert.equal(screen.dirty(), false);
  assert.equal(await screen.save(), true); assert.equal(calls.includes('PUT order'), false);
  const pdf = new PdfApi(); pdf.http = { get: (url: string) => { calls.push(`GET ${url}`); return of({}); } };
  const sheet = new PdfSheet(); Object.assign(sheet, {
    dirty: screen.dirty, busy: () => false, documentBusy: signal(false), error: signal(null), orderId: () => 65,
    documentOptions: () => normalizeSalesPdfOptions({ showOuterCarton: true, showBarcode: true, includeProductDetails: false, includeLogistics: false }),
    filename: () => 'partner-factuur', orderNumber: () => 'QA-PARTNER-65', invoice: () => true, sales: pdf, closed: { emit() {} }, ui: { toast() {} },
  });
  await sheet.downloadDocument();
  const request = calls.find(call => call.startsWith('GET /api/sales-orders/65/pdf?')); assert.ok(request);
  const params = new URLSearchParams(request.split('?')[1]);
  assert.equal(params.get('showOuterCarton'), 'true'); assert.equal(params.get('showBarcode'), 'true');
  assert.equal(params.get('includeProductDetails'), 'false'); assert.equal(params.get('includeLogistics'), 'false');
  assert.deepEqual(calls.filter(call => call.startsWith('PUT')), []);
});

test('shipping adopts its persisted status without manufacturing unsaved commercial changes', async () => {
  const { screen, calls } = harness(document('UITGEREIKT', { purpose: 'STANDARD' }));
  await screen.shipGoods(screen.view());
  assert.equal(screen.view().order.status, 'VERZONDEN'); assert.equal(screen.dirty(), false);
  assert.equal(screen.shipSheet(), null); assert.equal(await screen.save(), true);
  assert.equal(calls.includes('PUT order'), false);
});

test('immutable invoices refuse full PUT and preserve genuine local edits for explicit recovery', async () => {
  for (const status of ['UITGEREIKT', 'VERZONDEN', 'BEKEKEN', 'BETAALD']) {
    const { screen, calls } = harness(document(status)); const saved = screen.savedOrder();
    screen.view.set(document(status, { notes: 'Mijn echte onopgeslagen wijziging' }));
    assert.equal(await screen.save(), false); assert.equal(calls.length, 0);
    assert.equal(screen.view().order.notes, 'Mijn echte onopgeslagen wijziging'); assert.equal(screen.savedOrder(), saved);
    assert.equal(screen.dirty(), true); assert.match(screen.saveError(), /lokale wijzigingen blijven/);
  }
});

test('all queued product or pallet changes are blocked on fixed, archived or currently issuing documents', async () => {
  for (const initial of [document('UITGEREIKT'), document('CONCEPT', { archivedAt: '2026-09-10T10:00:00Z' })]) {
    const { screen, calls } = harness(initial); let changed = false;
    screen.enqueue((order: any) => { changed = true; return { ...order, notes: 'do not apply' }; });
    assert.equal(changed, false); assert.equal(screen.dirty(), false); assert.equal(calls.length, 0);
  }
  const { screen, calls } = harness(); let finish!: (value: any) => void;
  screen.sales.markInvoiceSent = () => new Promise(resolve => { finish = resolve; });
  const pending = screen.markSent(screen.view());
  assert.equal(screen.canEdit(), false);
  screen.enqueue((order: any) => ({ ...order, notes: 'A late edit' }));
  assert.equal(screen.dirty(), false); assert.equal(calls.includes('POST preview'), false);
  finish(document('UITGEREIKT')); await pending; assert.equal(screen.dirty(), false);
});

test('ordinary concept edits still preview and save normally', async () => {
  const { screen, calls } = harness(document('CONCEPT', { purpose: 'STANDARD' }));
  screen.enqueue((order: any) => ({ ...order, notes: 'Bewuste wijziging' }));
  assert.equal(screen.dirty(), true); assert.equal(await screen.save(), true);
  assert.equal(screen.dirty(), false); assert.equal(screen.view().order.notes, 'Bewuste wijziging');
  assert.deepEqual(calls, ['POST preview', 'PUT order']);
});

test('payment replies adopt a clean document including persisted issuance fields', () => {
  const { screen } = harness();
  screen.paymentReceived(document('VERZONDEN', { sentAt: '2026-09-10T11:34:01Z' }));
  assert.equal(screen.dirty(), false); assert.equal(screen.view().order.sentAt, '2026-09-10T11:34:01Z');
  screen.paymentReceived(document('BETAALD', { paidAt: '2026-09-10T12:00:00Z' }));
  assert.equal(screen.dirty(), false); assert.equal(screen.view().order.status, 'BETAALD');
});

test('payment refresh preserves real unsaved edits without claiming they are saved', async () => {
  const { screen, calls } = harness(document('UITGEREIKT'));
  screen.view.set(document('UITGEREIKT', { notes: 'Nog niet opgeslagen' }));
  screen.paymentReceived(document('BETAALD', { paidAt: '2026-09-10T12:00:00Z' }));
  assert.equal(screen.view().order.notes, 'Nog niet opgeslagen'); assert.equal(screen.view().order.status, 'BETAALD');
  assert.equal(JSON.parse(screen.savedOrder()).notes, 'Opgeslagen notitie'); assert.equal(JSON.parse(screen.savedOrder()).status, 'BETAALD');
  assert.equal(screen.dirty(), true); assert.equal(await screen.save(), false); assert.equal(calls.includes('PUT order'), false);
});

test('an unrelated payment reply and failed lifecycle request do not replace the current draft', async () => {
  const { screen } = harness(); const before = screen.savedOrder();
  screen.paymentReceived(document('BETAALD', { id: 99 })); assert.equal(screen.view().order.id, 65); assert.equal(screen.savedOrder(), before);
  screen.sales.markInvoiceSent = async () => { throw { status: 409, error: { message: 'Factuur is gewijzigd' } }; };
  await screen.markSent(screen.view()); assert.equal(screen.dirty(), false); assert.equal(screen.view().order.status, 'CONCEPT');
  assert.equal(screen.documentMutationBusy(), false); assert.equal(screen.canEdit(), true);
});

test('late delivery-week and freight edits cannot bypass an invoice mutation or archive lock', async () => {
  for (const archived of [false, true]) {
    const { screen, calls } = harness(document('CONCEPT', archived ? { archivedAt: '2026-09-10T10:00:00Z' } : {}));
    screen.documentMutationBusy.set(!archived);
    screen.sales.updateDeliveryTerms = async () => { calls.push('PUT delivery-terms'); return document(); };
    screen.sales.updateFreight = async () => { calls.push('PUT freight'); return document(); };
    assert.equal(screen.canEdit(), false); assert.equal(screen.canEditTerms(), false);
    screen.setLine(1, { deliveryWeek: '2026-W46' });
    screen.saveFreight('BEREKEND', 120, 'FIXED', null);
    await Promise.resolve();
    assert.deepEqual(calls, []); assert.equal(screen.dirty(), false);
  }
  const { screen, calls } = harness(document('VERZONDEN', { docType: 'OFFERTE', purpose: 'STANDARD' }));
  screen.sales.updateDeliveryTerms = async () => { calls.push('PUT delivery-terms'); return screen.view(); };
  assert.equal(screen.canEditTerms(), true, 'Existing delivery-only editing remains available for eligible sent documents');
  screen.setLine(1, { deliveryWeek: '2026-W46' }); await Promise.resolve();
  assert.deepEqual(calls, ['PUT delivery-terms']);
});

for (const [action, endpoint] of [['markSent', 'markInvoiceSent'], ['shipGoods', 'shipGoods']]) {
  test(`${action} ignores a late previous-document response and preserves the new document and edits`, async () => {
    const { screen, calls, toasts } = harness(); let finish!: (value: any) => void;
    screen.sales[endpoint] = () => new Promise(resolve => { finish = resolve; });
    const pending = screen[action](screen.view());
    const next = document('CONCEPT', { id: 99, number: 'QA-99', notes: 'Ander opgeslagen document' });
    screen.adopt(next); const baseline = screen.savedOrder();
    screen.view.set({ ...next, order: { ...next.order, notes: 'Nieuwe lokale wijziging' } });
    const sheet = { number: 'QA-99' }; screen.shipSheet.set(sheet);
    finish(document('UITGEREIKT')); await pending;
    assert.equal(screen.view().order.id, 99); assert.equal(screen.view().order.notes, 'Nieuwe lokale wijziging');
    assert.equal(screen.savedOrder(), baseline); assert.equal(screen.dirty(), true); assert.equal(screen.shipSheet(), sheet);
    assert.deepEqual(calls, []); assert.deepEqual(toasts, []); assert.equal(screen.documentMutationBusy(), false);
  });
  test(`${action} ignores an old-document failure after navigation and clears pending state`, async () => {
    const { screen, toasts } = harness(); let fail!: (reason: unknown) => void;
    screen.sales[endpoint] = () => new Promise((_resolve, reject) => { fail = reject; });
    const pending = screen[action](screen.view()); screen.adopt(document('CONCEPT', { id: 99 }));
    fail({ status: 409, error: { message: 'Old document failure' } }); await pending;
    assert.equal(screen.view().order.id, 99); assert.equal(screen.dirty(), false);
    assert.deepEqual(toasts, []); assert.equal(screen.documentMutationBusy(), false);
  });
}
