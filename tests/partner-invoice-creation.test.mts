import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { computed, signal } from '@angular/core';
import { advanceInvoiceScheduleRequest, schedulePreset } from '../src/app/features/purchasing/partner-advance-schedule-state.ts';
import { isAdvanceDocument, isPartnerDocument } from '../src/app/features/sales/sales-payment-state.ts';
import { messageOf } from '../src/app/core/api/errors.ts';

/** Execute the actual Angular class methods with explicit service doubles; no HTTP/email is possible. */
async function isolate(file: string, className: string, names: string[], functions: string[] = []) {
  const source = await readFile(new URL(`../src/app/features/${file}.ts`, import.meta.url), 'utf8');
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const original = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === className);
  assert.ok(original);
  const members = original.members.filter(member => member.name && ts.isIdentifier(member.name) && names.includes(member.name.text));
  assert.equal(members.length, names.length);
  const isolated = ts.factory.updateClassDeclaration(original, original.modifiers?.filter(modifier => !ts.isDecorator(modifier)),
    original.name, original.typeParameters, undefined, members);
  const helpers = parsed.statements.filter(node => ts.isFunctionDeclaration(node) && functions.includes(node.name?.text ?? ''));
  const javascript = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [...helpers, isolated])), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports: Record<string, any> = {};
  vm.runInNewContext(javascript, { exports, signal, computed, advanceInvoiceScheduleRequest, isAdvanceDocument, isPartnerDocument, messageOf, Error });
  return exports;
}

const { PurchaseQuoteSheet } = await isolate('purchasing/purchase-quote-sheet', 'PurchaseQuoteSheet', ['create']);
function creationHarness(partner = true) {
  const screen = new PurchaseQuoteSheet();
  const requests: any[] = [], routes: unknown[] = [], toasts: string[] = [];
  const document = { order: { id: 71, number: 'partner/2026/071', status: 'CONCEPT', docType: partner ? 'FACTUUR' : 'OFFERTE', lines: [], sentAt: null } };
  Object.assign(screen, {
    customers: signal([{ id: 2, company: 'Partner' }]), chosen: signal(2), partner: signal(partner),
    busy: signal(false), loading: signal(false), termsLoading: signal(false), termsError: signal(''), createError: signal(null),
    costKnown: signal(true), pricing: signal('COST'), chosenCosts: signal([]), terms: signal(schedulePreset('30_70', 5000)),
    agreementEur: signal(5000), savedTerms: signal(null), order: signal({ id: 48 }),
    costPct: signal(50), sharePct: signal(50), markupPct: signal(15), deliveryWeek: signal(''),
    sales: { createFromPurchaseOrder: async (body: any) => { requests.push(body); return document; } },
    router: { navigate: async (...args: unknown[]) => { routes.push(args); return true; } },
    closed: { emit() {} }, ui: { toast(message: string) { toasts.push(message); } },
  });
  return { screen, requests, routes, toasts, document };
}

test('30/70 on a 50% contribution creates only term invoices in one request and opens the first unsent invoice', async () => {
  const { screen, requests, routes, toasts, document } = creationHarness();
  const original = JSON.stringify(document);
  await screen.create();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].purpose, 'PARTNER_ADVANCE');
  assert.equal(requests[0].costPct, 50, 'Funding percentage is independent from the payment tranches');
  assert.equal(requests[0].paymentPlan, 'FULL', 'Each invoice is one complete term, never another 30/70 split');
  assert.equal(JSON.stringify(requests[0].advanceSchedule.rows.map((row: any) => row.percentage)), '[30,70]');
  assert.equal(JSON.stringify(routes), JSON.stringify([[['/sales', 71]]]));
  assert.equal(JSON.stringify(document), original, 'The UI never fabricates sent/issued state');
  assert.match(toasts[0], /niets verstuurd/);
  assert.equal(screen.busy(), false);
});

test('one full term still uses the same atomic creation endpoint and stale pricing cannot make a partner quote', async () => {
  const { screen, requests } = creationHarness();
  screen.terms.set(schedulePreset('FULL', 5000));
  screen.pricing.set('CUSTOMER');
  await screen.create();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].advanceSchedule.rows.length, 1);
  assert.equal(requests[0].advanceSchedule.rows[0].percentage, 100);
  assert.equal(requests[0].pricing, 'COST');
  assert.equal(requests[0].purpose, 'PARTNER_ADVANCE');
});

test('ordinary sales still create a regular quote and open its editor', async () => {
  const { screen, requests, routes } = creationHarness(false);
  await screen.create();
  assert.equal(requests[0].purpose, 'STANDARD');
  assert.equal(requests[0].advanceSchedule, undefined);
  assert.equal(requests[0].costPct, null);
  assert.equal(JSON.stringify(routes), JSON.stringify([[['/sales', 71, 'edit']]]));
});

test('zero funding, invalid terms, unfinished loads and duplicate clicks cannot create documents', async () => {
  const { screen, requests } = creationHarness();
  screen.agreementEur.set(0); await screen.create();
  assert.match(screen.createError(), /geen voorschot/);
  screen.agreementEur.set(5000); screen.terms.set([]); await screen.create();
  assert.match(screen.createError(), /minstens/);
  screen.terms.set(schedulePreset('30_70', 5000));
  for (const flag of ['loading', 'termsLoading', 'busy']) {
    screen[flag].set(true); await screen.create(); screen[flag].set(false);
  }
  screen.termsError.set('Settlement already started'); await screen.create();
  assert.equal(requests.length, 0);
});

test('API failures stay in the sheet, and an outdated quote response is never presented as an invoice', async () => {
  const { screen, routes, document } = creationHarness();
  document.order.docType = 'OFFERTE';
  await screen.create();
  assert.equal(routes.length, 0);
  assert.match(screen.createError(), /geen conceptfactuur/);
  screen.sales.createFromPurchaseOrder = async () => { throw { error: { message: 'Termijn is al afgehandeld' } }; };
  await screen.create();
  assert.equal(screen.createError(), 'Termijn is al afgehandeld');
  assert.equal(screen.busy(), false);
  assert.equal(routes.length, 0);
});

const { SalesAdvanceInvoices, advanceInvoicePurchaseId } = await isolate('sales/sales-advance-invoices', 'SalesAdvanceInvoices',
  ['load', 'ngOnDestroy'], ['advanceInvoicePurchaseId']);

test('only advance invoices load sibling invoices; regular sales, quotes and settlements do not', () => {
  const order = { id: 71, docType: 'FACTUUR', purpose: 'PARTNER_ADVANCE', partnerPurchaseOrderId: 48 };
  assert.equal(advanceInvoicePurchaseId(order), 48);
  for (const change of [{ docType: 'OFFERTE' }, { purpose: 'STANDARD' }, { purpose: 'PARTNER_SETTLEMENT' }, { partnerPurchaseOrderId: null }]) {
    assert.equal(advanceInvoicePurchaseId({ ...order, ...change }), null);
  }
});

function contextHarness() {
  const screen = new SalesAdvanceInvoices();
  const pending: Array<{ id: number; resolve: (plan: any) => void; reject: (error: any) => void }> = [];
  Object.assign(screen, {
    version: 0, purchaseOrderId: signal<number | null>(48), schedule: signal(null), loading: signal(false), error: signal(''),
    sourcing: { partnerAdvanceSchedule: (id: number) => new Promise((resolve, reject) => pending.push({ id, resolve, reject })) },
  });
  return { screen, pending };
}

test('sibling navigation reads the existing schedule without writes and ignores old routes', async () => {
  const { screen, pending } = contextHarness();
  const older = screen.load(48);
  screen.purchaseOrderId.set(49);
  const newer = screen.load(49);
  const correct = { purchaseOrderId: 49, rows: [{ id: 3, invoiceId: 72 }, { id: 4, invoiceId: 73 }] };
  pending[1].resolve(correct); await newer;
  pending[0].resolve({ purchaseOrderId: 48, rows: [] }); await older;
  assert.equal(screen.schedule(), correct);
  assert.deepEqual(pending.map(request => request.id), [48, 49]);
  assert.equal(screen.loading(), false);
  screen.purchaseOrderId.set(null); await screen.load(null);
  assert.equal(pending.length, 2, 'Switching to regular sales does not request a container');
  assert.equal(screen.schedule(), null);
});

test('navigation errors can be retried, and destroyed contexts cannot publish late schedules', async () => {
  const { screen, pending } = contextHarness();
  const failing = screen.load(48);
  pending[0].reject({ error: { message: 'Container niet beschikbaar' } }); await failing;
  assert.equal(screen.error(), 'Container niet beschikbaar');
  assert.equal(screen.loading(), false);
  const retry = screen.load(48);
  screen.ngOnDestroy();
  pending[1].resolve({ purchaseOrderId: 48, rows: [] }); await retry;
  assert.equal(screen.schedule(), null);
});

const { PurchasePartnerSheet } = await isolate('purchasing/purchase-partner-sheet', 'PurchasePartnerSheet', ['matches', 'link']);
const { PartnerLinkSheet } = await isolate('sales/partner-link-sheet', 'PartnerLinkSheet', ['link']);
test('both document-linking paths reject quote-to-partner shortcuts before calling the API', async () => {
  const quote = { order: { id: 7, docType: 'OFFERTE', status: 'CONCEPT', partnerPurchaseOrderId: null } };
  const calls: unknown[] = [];
  const services = { busy: signal(false), chosen: signal(7), sales: { setPartnerDeal: (...args: unknown[]) => { calls.push(args); } } };
  const purchase = new PurchasePartnerSheet();
  Object.assign(purchase, services, { documents: signal([quote]), order: signal({ id: 48 }) });
  await purchase.link();
  const sales = new PartnerLinkSheet();
  Object.assign(sales, services, { partner: signal(true), order: signal(quote.order), containers: signal([{ order: { id: 7 } }]) });
  await sales.link();
  assert.equal(calls.length, 0);
});

const { SalesEditor } = await isolate('sales/sales-editor', 'SalesEditor', ['duplicate']);
test('copying a partner invoice or legacy quote opens its schedule without duplicating its claim', async () => {
  for (const docType of ['OFFERTE', 'FACTUUR']) {
    const screen = new SalesEditor(), calls: unknown[] = [], routes: unknown[] = [];
    Object.assign(screen, { view: signal({ order: { id: 71, docType, purpose: 'PARTNER_ADVANCE', partnerPurchaseOrderId: 48 } }),
      advanceAgreement: () => null, busy: signal(false),
      sales: { duplicateOrder: (...args: unknown[]) => { calls.push(args); } },
      router: { navigate: async (...args: unknown[]) => { routes.push(args); } } });
    await screen.duplicate();
    assert.equal(calls.length, 0);
    assert.equal(JSON.stringify(routes), JSON.stringify([[['/purchasing', 48], { queryParams: { section: 'payments' } }]]));
  }
});
