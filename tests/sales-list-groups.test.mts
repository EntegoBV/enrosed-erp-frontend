import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { computed, signal } from '@angular/core';
import { parseTemplate } from '@angular/compiler';
import { invoiceReceivable } from '../src/app/features/finance/incoming-money.ts';
import { isPartnerDocument } from '../src/app/features/sales/sales-payment-state.ts';
import { statusOf } from '../src/app/features/sales/quote-status.ts';
import type { SalesOrderView } from '../src/app/core/api/models.ts';
import type { SalesContainerGroup, SalesListEntry } from '../src/app/features/sales/sales-list-groups.ts';

const helperSource = await readFile(new URL('../src/app/features/sales/sales-list-groups.ts', import.meta.url), 'utf8');
const helperJs = ts.transpileModule(helperSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const helperExports: any = {};
vm.runInNewContext(helperJs, { exports: helperExports, require: (path: string) => {
  if (path === '../finance/incoming-money') return { invoiceReceivable };
  if (path === './sales-payment-state') return { isPartnerDocument };
  if (path === './quote-status') return { statusOf };
  throw new Error(`Unexpected dependency ${path}`);
} });
const groupSalesInvoices = helperExports.groupSalesInvoices as (rows: readonly SalesOrderView[], attention?: (row: SalesOrderView) => boolean) => SalesListEntry[];

function invoice(id: number, amount: number, changes: any = {}): SalesOrderView {
  return { order: { id, number: `INV-${id}`, docType: 'FACTUUR', customerId: 2, partnerPurchaseOrderId: 45,
    purpose: 'PARTNER_ADVANCE', status: 'CONCEPT', ...changes },
    priced: { totals: { total: amount, totalInclVat: amount, pieces: 0 } }, awaitingResend: false,
    advanceContents: { purchaseOrderId: 45, purchaseOrderNumber: 'PO-45', lines: [], totals: { pieces: 8540 } },
  } as unknown as SalesOrderView;
}
function group(rows: SalesOrderView[]): SalesContainerGroup {
  const result = groupSalesInvoices(rows);
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, 'PARTNER_CONTAINER');
  return result[0] as SalesContainerGroup;
}

test('groups only partner invoices by purchase and customer, at their first sorted position', () => {
  const a = invoice(1, 18145.27), b = invoice(2, 36290.55);
  const regular = invoice(3, 100, { purpose: 'STANDARD' });
  const otherPo = invoice(4, 500, { partnerPurchaseOrderId: 46 });
  const otherCustomer = invoice(5, 500, { customerId: 3 });
  const quote = invoice(6, 700, { docType: 'OFFERTE' });
  const unlinked = invoice(7, 800, { partnerPurchaseOrderId: null });
  const source = [a, regular, otherPo, b, otherCustomer, quote, unlinked];
  const before = JSON.stringify(source);
  const entries = groupSalesInvoices(source);
  assert.deepEqual(Array.from(entries, entry => entry.key), [
    'container-45-customer-2', 'document-3', 'container-46-customer-2', 'container-45-customer-3', 'document-6', 'document-7',
  ]);
  assert.deepEqual(Array.from((entries[0] as SalesContainerGroup).rows, row => row.order.id), [1, 2]);
  assert.equal(JSON.stringify(source), before, 'Grouping never changes API documents or their order');
});

test('draft advances retain every cent and count the repeated container cargo once', () => {
  const rows = [invoice(1, 18145.27), invoice(2, 36290.55)];
  const result = group(rows);
  assert.equal(result.summary.count, 2);
  assert.equal(result.summary.totalEur, 54435.82);
  assert.equal(result.summary.draftEur, 54435.82);
  assert.equal(result.summary.draftCount, 2);
  assert.equal(result.summary.remainingEur, 0, 'Unissued concepts are never displayed as receivables');
  assert.equal(result.summary.receivedEur, 0);
  assert.equal(result.summary.containerPieces, 8540, 'Two advance snapshots do not mean 17,080 pieces');
  assert.equal(result.purchaseOrderNumber, 'PO-45');
  rows[1].advanceContents!.totals.pieces = 9000;
  assert.equal(group(rows).summary.containerPieces, null, 'Different snapshots cannot invent a combined cargo quantity');
  rows.forEach(row => { row.advanceContents = null; });
  assert.equal(group(rows).summary.containerPieces, null, 'Empty financial product rows are not a zero-piece shipment');
});

test('issued receipts and credits remain separate from drafts and cancelled claims', () => {
  const paid = invoice(1, 100, { status: 'BETAALD' });
  const open = invoice(2, 200.02, { status: 'UITGEREIKT' });
  open.paymentSummary = { receivedEur: 50.01, remainingEur: 150.01, overpaidEur: 0, creditEur: 0 } as any;
  const credit = invoice(3, -20.01, { status: 'UITGEREIKT', purpose: 'PARTNER_SETTLEMENT' });
  const cancelled = invoice(4, 999, { status: 'GEANNULEERD' });
  const draft = invoice(5, 80.01);
  const result = groupSalesInvoices([paid, open, credit, cancelled, draft], row => row.order.id === 2)[0] as SalesContainerGroup;
  assert.equal(result.summary.totalEur, 360.02);
  assert.equal(result.summary.draftEur, 80.01);
  assert.equal(result.summary.issuedCount, 3);
  assert.equal(result.summary.inactiveCount, 1);
  assert.equal(result.summary.receivedEur, 150.01);
  assert.equal(result.summary.remainingEur, 150.01, 'A credit is not silently allocated to another invoice');
  assert.equal(result.summary.creditEur, 20.01);
  assert.equal(result.summary.attentionCount, 1);
});

test('concepts remain concepts regardless of a derived payment summary, until explicitly issued', () => {
  for (const paymentStatus of ['UNPAID', 'PARTIAL', 'PAID', 'OVERPAID', 'CREDIT'] as const) {
    const draft = invoice(61, 18145.27);
    draft.paymentSummary = { status: paymentStatus, receivedEur: 100, remainingEur: 18045.27 } as any;
    assert.deepEqual(statusOf(draft), { label: 'Concept', cls: 'neutral' });
    const result = group([draft]);
    assert.deepEqual(Array.from(result.summary.statuses, badge => [badge.label, badge.count, badge.concept]), [['Concept', 1, true]]);
    assert.equal(result.summary.issuedCount, 0);
    assert.equal(result.summary.draftEur, 18145.27);
    assert.equal(result.summary.receivedEur, 0);
    assert.equal(result.summary.remainingEur, 0, 'Payment metadata does not make a concept an open invoice');
    assert.equal(draft.order.status, 'CONCEPT');
  }
  const issued = invoice(61, 18145.27, { status: 'UITGEREIKT' });
  issued.paymentSummary = { status: 'UNPAID', receivedEur: 0, remainingEur: 18145.27 } as any;
  assert.equal(group([issued]).summary.statuses[0].label, 'Uitgereikt · niet gemaild');
  assert.equal(group([issued]).summary.remainingEur, 18145.27);
});

test('mixed groups show each actual invoice status using the same label and color as individual rows', () => {
  const issued = invoice(1, 100, { status: 'UITGEREIKT' });
  const sent = invoice(2, 100, { status: 'VERZONDEN' });
  const partialIssued = invoice(3, 100, { status: 'UITGEREIKT' });
  const partialSent = invoice(4, 100, { status: 'VERZONDEN' });
  for (const row of [partialIssued, partialSent]) {
    row.paymentSummary = { status: 'PARTIAL', receivedEur: 25, remainingEur: 75 } as any;
  }
  const paid = invoice(5, 100, { status: 'BETAALD' });
  const draft = invoice(6, 100);
  const cancelled = invoice(7, 100, { status: 'GEANNULEERD' });
  const expired = invoice(8, 100, { status: 'VERLOPEN' });
  const rows = [issued, sent, partialIssued, partialSent, paid, draft, cancelled, expired];
  const before = JSON.stringify(rows);
  const result = group(rows);
  assert.deepEqual(Array.from(result.summary.statuses, badge => [badge.label, badge.count]), [
    ['Concept', 1], ['Uitgereikt · niet gemaild', 1], ['Verzonden', 1], ['Deels betaald', 2],
    ['Betaald', 1], ['Geannuleerd', 1], ['Verlopen', 1],
  ]);
  for (const row of rows) {
    const status = statusOf(row);
    const badge = result.summary.statuses.find(badge => badge.label === status.label);
    assert.equal(badge?.cls, status.cls);
  }
  assert.equal(result.summary.totalEur, 600);
  assert.equal(result.summary.draftCount, 1);
  assert.equal(result.summary.issuedCount, 5);
  assert.equal(result.summary.inactiveCount, 2);
  assert.equal(result.summary.receivedEur, 150);
  assert.equal(result.summary.remainingEur, 350);
  assert.equal(JSON.stringify(rows), before, 'Status presentation never mutates a document or its financial data');
});

test('terminal lifecycle and historical quote states are never replaced by payment badges', () => {
  for (const status of ['GEANNULEERD', 'VERLOPEN', 'AFGEWEZEN'] as const) {
    const row = invoice(1, 100, { status });
    row.paymentSummary = { status: 'PAID', receivedEur: 100, remainingEur: 0 } as any;
    assert.equal(statusOf(row).label, { GEANNULEERD: 'Geannuleerd', VERLOPEN: 'Verlopen', AFGEWEZEN: 'Afgewezen' }[status]);
    const result = group([row]);
    assert.equal(result.summary.statuses[0].inactive, true);
    assert.equal(result.summary.totalEur, 0);
    assert.equal(result.summary.issuedCount, 0);
  }
  assert.deepEqual(statusOf({ order: { docType: 'OFFERTE', status: 'VERZONDEN' }, paymentSummary: { status: 'PARTIAL' } }),
    { label: 'Verzonden', cls: 'rose' });
  assert.equal(statusOf({ order: { docType: 'OFFERTE', status: 'CONCEPT' }, invoicedAs: 'INV-1', invoiceStatus: 'CONCEPT' }).label, 'Factuur in concept');
  assert.equal(statusOf({ order: { docType: 'OFFERTE', status: 'CONCEPT' }, invoicedAs: 'INV-1', invoiceStatus: 'UITGEREIKT' }).label, 'Gefactureerd');
  for (const status of ['PAID', 'OVERPAID'] as const) {
    assert.deepEqual(statusOf({ order: { docType: 'FACTUUR', status: 'VERZONDEN' }, paymentSummary: { status } }),
      { label: 'Betaald', cls: 'ok' });
  }
});

const listSource = await readFile(new URL('../src/app/features/sales/sales-list.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('sales-list.ts', listSource, ts.ScriptTarget.Latest, true);
const original = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === 'SalesList');
assert.ok(original);
const names = ['rows', 'groupedRows', 'expandedGroups', 'groupOpen', 'toggleGroup', 'inTab', 'rowsByDocument', 'switchTab', 'switchScope'];
const members = original.members.filter(member => member.name && ts.isIdentifier(member.name) && names.includes(member.name.text));
assert.equal(members.length, names.length);
const isolated = ts.factory.updateClassDeclaration(original, original.modifiers?.filter(modifier => !ts.isDecorator(modifier)), original.name, undefined, undefined, members);
const listJs = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [isolated])), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function listHarness(rows: SalesOrderView[]) {
  const exports: any = {};
  vm.runInNewContext(listJs, { exports, computed, signal, groupSalesInvoices, isPartnerDocument, invoiceReceivable,
    isWebsiteQuoteRequest: () => false });
  const screen = new exports.SalesList();
  Object.assign(screen, { all: signal(rows), docTab: signal('FACTUUR'), businessScope: signal('ALL'),
    query: signal(''), filter: signal(''), customerFilter: signal(''), websiteOnly: signal(false), outstandingOnly: signal(false),
    attention: () => null, customerName: (row: SalesOrderView) => `Customer ${row.order.customerId}`,
    openRow: signal(null), rememberNavigation() {},
  });
  return screen;
}

test('production search, customer, status, scope and archive filters apply before grouping', () => {
  const regular = invoice(3, 10, { purpose: 'STANDARD' });
  const archived = invoice(4, 20, { archivedAt: '2026-09-10T12:00:00Z' });
  const screen = listHarness([invoice(1, 18145.27), regular, invoice(2, 36290.55, { status: 'UITGEREIKT' }), archived]);
  assert.equal(screen.rows().length, 3);
  assert.equal(screen.groupedRows().length, 2);
  screen.query.set('INV-2');
  assert.equal(screen.rows().length, 1);
  assert.equal(screen.groupedRows()[0].summary.totalEur, 36290.55, 'Searching one invoice does not pull in hidden sibling amounts');
  screen.query.set(''); screen.filter.set('CONCEPT');
  assert.equal(screen.groupedRows()[0].summary.count, 1);
  screen.filter.set(''); screen.customerFilter.set(9);
  assert.equal(screen.groupedRows().length, 0);
  screen.customerFilter.set(''); screen.switchScope('STANDARD');
  assert.equal(screen.groupedRows().length, 1);
  assert.equal(screen.groupedRows()[0].kind, 'DOCUMENT');
  screen.switchScope('PARTNER'); screen.switchTab('ARCHIEF');
  assert.equal(screen.groupedRows()[0].rows[0].order.id, 4);
  screen.switchTab('FACTUUR'); screen.outstandingOnly.set(true);
  assert.equal(screen.groupedRows()[0].summary.count, 1, 'Unissued drafts do not appear in the outstanding filter');
});

test('container groups start collapsed, toggle independently and never expose stale swipe actions', () => {
  const screen = listHarness([invoice(1, 1), invoice(2, 2, { partnerPurchaseOrderId: 46 })]);
  const keys = Array.from(screen.groupedRows(), (entry: any) => entry.key);
  assert.ok(keys.every(key => !screen.groupOpen(key)));
  screen.openRow.set({ id: 1, side: 'end' });
  screen.toggleGroup(keys[0]);
  assert.equal(screen.groupOpen(keys[0]), true);
  assert.equal(screen.groupOpen(keys[1]), false);
  assert.equal(screen.openRow(), null);
  screen.toggleGroup(keys[0]); assert.equal(screen.groupOpen(keys[0]), false);
  screen.toggleGroup(keys[1]); screen.switchTab('ARCHIEF');
  assert.ok(keys.every(key => !screen.groupOpen(key)));
});

test('searching the displayed container reference retains its matching invoices before grouping', () => {
  const rows = [invoice(1, 18145.27), invoice(2, 36290.55), invoice(3, 100, { partnerPurchaseOrderId: 46 }),
    invoice(4, 500, { purpose: 'STANDARD' })];
  const settlement = invoice(5, 200, { purpose: 'PARTNER_SETTLEMENT' });
  settlement.advanceContents = null; rows.push(settlement);
  const screen = listHarness(rows);
  screen.query.set('po-45');
  assert.deepEqual(Array.from(screen.rows(), (row: SalesOrderView) => row.order.id), [1, 2, 5], 'A matching PO also retains its settlement without a repeated cargo snapshot');
  assert.equal(screen.groupedRows()[0].summary.totalEur, 54635.82);
  screen.query.set('Inkoop #46');
  assert.deepEqual(Array.from(screen.rows(), (row: SalesOrderView) => row.order.id), [3], 'A snapshot for another PO never supplies the reference');
  screen.query.set('po-45'); screen.filter.set('UITGEREIKT');
  assert.equal(screen.groupedRows().length, 0, 'Container search never bypasses the existing document filters');
});

test('the Angular template remains valid after sharing the individual document row', () => {
  const template = /template:\s*`([\s\S]*?)`,\s*styles:/.exec(listSource)?.[1];
  assert.ok(template);
  const result = parseTemplate(template, 'sales-list.html');
  assert.equal(result.errors, null, JSON.stringify(result.errors));
});
