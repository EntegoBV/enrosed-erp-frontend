import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import type { PurchaseOrderView, PurchasePaymentRow } from '../src/app/core/api/models.ts';
import { invoiceComparison, invoiceLine, primaryInvoice } from '../src/app/features/purchasing/purchase-invoices.ts';
import type { PayeeBranch } from '../src/app/features/finance/container-payment-tree.ts';

// Kosten & bank per container: invoices → terms → payments (round of 2026-10-15). The module words its invoices
// through purchase-invoices.ts at runtime, so it is compiled without its imports and gets those words handed in.
const source = await readFile(new URL('../src/app/features/finance/container-payment-tree.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('container-payment-tree.ts', source, ts.ScriptTarget.Latest, true);
const javascript = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed,
  parsed.statements.filter(node => !ts.isImportDeclaration(node)))), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const exports: Record<string, any> = {};
vm.runInNewContext(javascript, { exports, invoiceComparison, invoiceLine, primaryInvoice, Intl });
const tree = (view: PurchaseOrderView, rows: PurchasePaymentRow[], lines: Record<number, string>): PayeeBranch[] =>
  JSON.parse(JSON.stringify(exports['containerPaymentTree'](view, rows,
    (row: PurchasePaymentRow) => row.bankStatementLineId != null ? { accountLabel: lines[row.bankStatementLineId] ?? '', day: '' } : null,
    (stream: { status: string }) => stream.status)).replace(/[  ]/g, ' '));

function stream(payee: string, plannedEur: number, paidEur: number) {
  return { payee, label: { SUPPLIER: 'Leverancier', LOGISTICS: 'Douane & transport', SEPARATE: 'Inspectie & andere kosten', OTHER: 'Bijkomende kosten' }[payee],
    status: 'PAID', plannedEur, paidEur, remainingEur: plannedEur - paidEur };
}
function row(id: number, values: Partial<PurchasePaymentRow> = {}): PurchasePaymentRow {
  return { id, orderId: 14, orderNumber: 'PO-2026-014', orderAlias: null, paidOn: '2026-08-02', amountEur: 100, label: null, payee: 'SUPPLIER',
    bankStatementLineId: null, amount: 100, currency: 'EUR', instalmentDue: null, settles: false, groupId: null, resolvedInvoiceId: null, invoiceNumber: null,
    creditOffset: false, ...values };
}
function view(values: Record<string, unknown> = {}): PurchaseOrderView {
  return {
    order: { id: 14, number: 'PO-2026-014', inspectionCostEur: 300, inspectionViaSupplier: false },
    reconciliation: { streams: [stream('SUPPLIER', 31048.04, 31048.04), stream('SEPARATE', 300, 300)],
      supplierInstalments: [{ due: 'ORDERED', label: '30% bij bestelling', plannedEur: 9314.41, paidEur: 9314.41 },
        { due: 'SHIPPED', label: '70% bij vertrek', plannedEur: 21733.63, paidEur: 21733.63 }] },
    invoices: [{ id: 7, orderId: 14, payee: 'SUPPLIER', payeeLabel: 'Leverancier', number: 'CI-2026-118', invoiceDate: '2026-08-20', amount: 31048.04, currency: 'EUR',
      amountEur: 31048.04, documentId: 88, documentName: 'CI-2026-118.pdf', notes: null, actor: 'Emre', recordedAt: '2026-08-21T08:10:00Z', primary: true,
      coversInspection: false, paymentIds: [101, 102, 103], paidEur: 31048.04 }],
    invoiceFiles: [{ documentId: 77, kind: 'COMMERCIAL_INVOICE', label: null, originalFilename: 'invoice.pdf', paymentId: 101, payee: 'SUPPLIER' }],
    ...values,
  } as unknown as PurchaseOrderView;
}

test('example (a) and (c): the invoice, its file without data, the terms and a payment in two transfers', () => {
  const rows = [
    row(101, { amountEur: 9314.41, label: 'Aanbetaling 30%', instalmentDue: 'ORDERED', bankStatementLineId: 501 }),
    row(102, { amountEur: 10000, label: 'Saldo 70%', instalmentDue: 'SHIPPED', paidOn: '2026-09-10', groupId: 102, bankStatementLineId: 520 }),
    row(103, { amountEur: 11733.63, label: 'Saldo 70%', instalmentDue: 'SHIPPED', paidOn: '2026-09-24', groupId: 102, bankStatementLineId: 534 }),
    row(900, { orderId: 15, amountEur: 5 }),
  ];
  const [supplier] = tree(view(), rows, { 501: 'KBC', 520: 'KBC', 534: 'KBC' });
  assert.deepEqual(supplier.invoices, [{ id: 7, text: 'Factuur CI-2026-118 · 20/08/2026 · € 31.048,04', documentId: 88, name: 'CI-2026-118.pdf', primary: true, comparison: 'gelijk aan de afspraak' }]);
  assert.deepEqual(supplier.invoiceFiles, [{ documentId: 77, text: 'invoice.pdf · zonder gegevens', name: 'invoice.pdf' }]);
  assert.deepEqual(supplier.terms.map(term => [term.label, term.paidEur, term.plannedEur, term.payments.map(node => [node.paidOn, node.label, node.amountEur, node.bank])]), [
    ['30% bij bestelling', 9314.41, 9314.41, [['2026-08-02', 'Aanbetaling 30%', 9314.41, 'op de bank · KBC']]],
    ['70% bij vertrek', 21733.63, 21733.63, [['2026-09-10', 'Saldo 70% · 2 transacties', 21733.63, '']]],
  ]);
  assert.deepEqual(supplier.terms[1].payments[0].parts.map(part => [part.paidOn, part.amountEur, part.bank]),
    [['2026-09-10', 10000, 'op de bank · KBC'], ['2026-09-24', 11733.63, 'op de bank · KBC']]);
  assert.deepEqual([supplier.payments, supplier.status, supplier.viaSupplier], [[], 'PAID', null]);
});

test('example (b): the inspection paid via the supplier in the goods\' transfer, under the supplier\'s invoice', () => {
  const rows = [
    row(201, { amountEur: 10000, label: 'Aanbetaling 30%', instalmentDue: 'ORDERED', paidOn: '2026-09-03', bankStatementLineId: 610 }),
    row(202, { amountEur: 300, label: 'Aanbetaling 30% · inspectie', payee: 'SEPARATE', paidOn: '2026-09-03', bankStatementLineId: 610 }),
    row(203, { amountEur: 120, label: 'Labtest', payee: 'SEPARATE', paidOn: '2026-09-05', bankStatementLineId: 700 }),
    row(204, { amountEur: 50, label: 'Verrekend tegoed INK-9', payee: 'SEPARATE', paidOn: '2026-09-06', creditOffset: true }),
    row(205, { amountEur: 20, label: 'Koerier', payee: 'SEPARATE', paidOn: '2026-09-07' }),
  ];
  const invoices = [{ ...view().invoices![0], number: 'CI-2026-140', coversInspection: true, amountEur: 31348.04 }];
  const branches = tree(view({ invoices, invoiceFiles: [], order: { id: 14, number: 'PO-2026-021', inspectionCostEur: 300, inspectionViaSupplier: true } }), rows, { 610: 'KBC', 700: 'Belfius' });
  assert.equal(branches[0].invoices[0].comparison, 'gelijk aan de afspraak + inspectie');
  const inspection = branches[1];
  assert.deepEqual([inspection.viaSupplier, inspection.invoices], ['Factuur via leverancier · CI-2026-140', []]);
  assert.deepEqual(inspection.payments.map(node => [node.label, node.bank]), [
    ['Aanbetaling 30% · inspectie', 'via leverancier · zelfde transactie'], ['Labtest', 'op de bank · Belfius'],
    ['Verrekend tegoed INK-9', 'verrekend tegoed'], ['Koerier', 'niet op de bank'],
  ]);
});

test('a server with this round but no invoices yet, and an older server without the field', () => {
  const none = tree(view({ invoices: [], invoiceFiles: [] }), [], {});
  assert.deepEqual([none[0].invoices, none[0].invoiceFiles, none[1].viaSupplier], [[], [], null]);
  const flag = tree(view({ invoices: [], invoiceFiles: [], order: { id: 14, number: 'PO-2026-014', inspectionViaSupplier: true } }), [], {});
  assert.equal(flag[1].viaSupplier, 'Factuur van de leverancier nog niet ingevoerd');
  const older = tree(view({ invoices: undefined, invoiceFiles: undefined }), [row(101, { bankStatementLineId: 501 })], {});
  assert.deepEqual([older[0].invoices, older[0].payments.map(node => node.bank)], [[], ['op de bank']], 'a hard link to a line not loaded still counts');
});
