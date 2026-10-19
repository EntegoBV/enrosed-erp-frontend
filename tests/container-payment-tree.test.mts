import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import type { PurchaseOrderView, PurchasePaymentRow } from '../src/app/core/api/models.ts';
import { invoiceComparison, invoiceCoverage, invoiceFileText, invoiceLine, primaryInvoice } from '../src/app/features/purchasing/purchase-invoices.ts';
import type { PayeeBranch } from '../src/app/features/finance/container-payment-tree.ts';

// Kosten & bank per container: invoices → terms → payments (round of 2026-10-15). The module words its invoices
// through purchase-invoices.ts at runtime, so it is compiled without its imports and gets those words handed in.
const source = await readFile(new URL('../src/app/features/finance/container-payment-tree.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('container-payment-tree.ts', source, ts.ScriptTarget.Latest, true);
const javascript = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed,
  parsed.statements.filter(node => !ts.isImportDeclaration(node)))), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const exports: Record<string, any> = {};
vm.runInNewContext(javascript, { exports, invoiceComparison, invoiceCoverage, invoiceFileText, invoiceLine, primaryInvoice, Intl });
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
  assert.deepEqual(supplier.invoices, [{ id: 7, text: 'Factuur CI-2026-118 · 20/08/2026 · € 31.048,04', documentId: 88, name: 'CI-2026-118.pdf', primary: true, comparison: 'gelijk aan de afspraak',
    coverage: 'Geldt voor alle betalingen van Leverancier (2)' }]);
  assert.deepEqual(supplier.invoiceFiles, [{ documentId: 77, text: 'invoice.pdf · zonder gegevens', name: 'invoice.pdf' }]);
  assert.deepEqual(supplier.terms.map(term => [term.label, term.paidEur, term.plannedEur, term.payments.map(node => [node.paidOn, node.label, node.amountEur, node.bank])]), [
    ['30% bij bestelling', 9314.41, 9314.41, [['2026-08-02', 'Aanbetaling 30%', 9314.41, 'op de bank · KBC']]],
    ['70% bij vertrek', 21733.63, 21733.63, [['2026-09-24', 'Saldo 70% · 2 transacties', 21733.63, '']]],
  ]);
  assert.deepEqual([supplier.terms[1].payments[0].firstPaidOn, supplier.terms[0].payments[0].firstPaidOn], ['2026-09-10', null],
    'one date rule with Betalingen: the newest transfer, the first one beside it');
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

test('every stream is headed with the ERP\'s own payee words, whatever label the server sends', () => {
  const other = { ...stream('OTHER', 0, 120), label: 'Andere betaling' };
  const branches = tree(view({ reconciliation: { streams: [{ ...stream('SUPPLIER', 31048.04, 31048.04), label: 'Leverancier (goederen)' }, other], supplierInstalments: [] } }), [], {});
  assert.deepEqual(branches.map(branch => branch.label), ['Leverancier', 'Bijkomende kosten']);
});

test("a PI is the supplier's invoice file: 'Proforma (PI) · …', so the container no longer reads as without an invoice (Emre, 2026-10-19)", () => {
  const pi = { documentId: 1, kind: 'PROFORMA_INVOICE', label: 'PI', originalFilename: 'PI CULINAN.xlsx', paymentId: null, payee: 'SUPPLIER' };
  const ci = { documentId: 4, kind: 'COMMERCIAL_INVOICE', label: null, originalFilename: 'COMMERCILA INVOICE YNPB-ENR-20260513.pdf', paymentId: null, payee: 'SUPPLIER' };
  const [supplier] = tree(view({ invoices: [], invoiceFiles: [pi, ci] }), [], {});
  assert.deepEqual(supplier.invoiceFiles, [
    { documentId: 1, text: 'Proforma (PI) · PI CULINAN.xlsx', name: 'PI CULINAN.xlsx' },
    { documentId: 4, text: 'COMMERCILA INVOICE YNPB-ENR-20260513.pdf · zonder gegevens', name: 'COMMERCILA INVOICE YNPB-ENR-20260513.pdf' },
  ]);
  const [older] = tree(view({ invoices: [], invoiceFiles: [{ ...ci, kind: undefined }] }), [], {});
  assert.equal(older.invoiceFiles[0].text, 'COMMERCILA INVOICE YNPB-ENR-20260513.pdf · zonder gegevens', 'a server without the kind on its files');
});

test('a server with this round but no invoices yet, and an older server without the field', () => {
  const none = tree(view({ invoices: [], invoiceFiles: [] }), [], {});
  assert.deepEqual([none[0].invoices, none[0].invoiceFiles, none[1].viaSupplier], [[], [], null]);
  const flag = tree(view({ invoices: [], invoiceFiles: [], order: { id: 14, number: 'PO-2026-014', inspectionViaSupplier: true } }), [], {});
  assert.equal(flag[1].viaSupplier, 'Factuur van de leverancier nog niet ingevoerd');
  const older = tree(view({ invoices: undefined, invoiceFiles: undefined }), [row(101, { bankStatementLineId: 501 })], {});
  assert.deepEqual([older[0].invoices, older[0].payments.map(node => node.bank)], [[], ['op de bank']], 'a hard link to a line not loaded still counts');
});

// Kosten & bank round (2026-10-16): where a payment stands on the bank links to the transaction (line=), with its day.
const linesWithDay = (view: PurchaseOrderView, rows: PurchasePaymentRow[], lines: Record<number, { label: string; day: string }>): PayeeBranch[] =>
  JSON.parse(JSON.stringify(exports['containerPaymentTree'](view, rows,
    (row: PurchasePaymentRow) => row.bankStatementLineId != null ? { accountLabel: lines[row.bankStatementLineId]?.label ?? '', day: lines[row.bankStatementLineId]?.day ?? '', lineId: row.bankStatementLineId } : null,
    (stream: { status: string }) => stream.status)).replace(/[\u00a0\u202f]/g, ' '));

test('"op de bank · {account} · {d mmm}" with its line id, and "aangepast aan de bank (was … op dd/mm)"', () => {
  const rows = [
    row(101, { amountEur: 12512.4, label: '30%', instalmentDue: 'ORDERED', bankStatementLineId: 8841, paidOn: '2026-10-14', bankAdjustedFromEur: 12480, bankAdjustedFromOn: '2026-10-13' }),
    row(102, { amountEur: 10000, label: 'Saldo 70%', instalmentDue: 'SHIPPED', paidOn: '2026-09-10', groupId: 102, bankStatementLineId: 520 }),
    row(103, { amountEur: 11733.63, label: 'Saldo 70%', instalmentDue: 'SHIPPED', paidOn: '2026-09-24', groupId: 102, bankStatementLineId: 534, bankAdjustedFromEur: 11700 }),
  ];
  const [supplier] = linesWithDay(view(), rows, { 8841: { label: 'KBC-zichtrekening', day: '2026-10-14' }, 520: { label: 'KBC-zichtrekening', day: '2026-09-10' }, 534: { label: 'KBC-zichtrekening', day: '2026-09-24' } });
  const deposit = supplier.terms[0].payments[0];
  assert.deepEqual([deposit.bank, deposit.lineId, deposit.adjusted], ['op de bank · KBC-zichtrekening · 14 okt', 8841, 'aangepast aan de bank (was € 12.480,00 op 13/10)']);
  const group = supplier.terms[1].payments[0];
  assert.deepEqual([group.bank, group.lineId, group.adjusted], ['', null, null], 'a payment in parts speaks through its parts');
  assert.deepEqual(group.parts.map(part => [part.bank, part.lineId, part.adjusted]),
    [['op de bank · KBC-zichtrekening · 10 sep', 520, null], ['op de bank · KBC-zichtrekening · 24 sep', 534, 'aangepast aan de bank (was € 11.700,00)']]);
  assert.equal(supplier.invoices[0].coverage, 'Geldt voor alle betalingen van Leverancier (2)', 'round 2\'s R2-3 words, a payment in parts once');
});

test('one transfer for three containers: each container says which others it shares the transaction with', () => {
  const rows = [
    row(301, { amountEur: 9000, instalmentDue: 'ORDERED', bankStatementLineId: 900 }),
    row(302, { orderId: 15, orderNumber: 'PO-2026-015', amountEur: 9000, instalmentDue: 'ORDERED', bankStatementLineId: 900 }),
    row(303, { orderId: 16, orderNumber: 'PO-2026-016', amountEur: 9000, instalmentDue: 'ORDERED', bankStatementLineId: 900 }),
    row(304, { amountEur: 100, payee: 'SEPARATE', bankStatementLineId: 901 }),
  ];
  const [supplier, inspection] = linesWithDay(view(), rows, { 900: { label: 'KBC', day: '2026-10-02' }, 901: { label: 'KBC', day: '2026-10-03' } });
  assert.equal(supplier.terms[0].payments[0].sharedWith, 'zelfde transactie als PO-2026-015 en PO-2026-016');
  assert.equal(inspection.payments[0].sharedWith, null);
});

test('a payee with nothing agreed, paid or invoiced reads as one "… · geen" line; any figure or document keeps the block', () => {
  const empty = exports['emptyBranch'];
  const base = { payee: 'OTHER', label: 'Bijkomende kosten', status: '', plannedEur: 0, paidEur: 0, remainingEur: 0, invoices: [], invoiceFiles: [], viaSupplier: null, terms: [], payments: [] };
  assert.equal(empty(base), true);
  assert.equal(empty({ ...base, paidEur: 180 }), false);
  assert.equal(empty({ ...base, invoiceFiles: [{ documentId: 1, text: 'x', name: 'x' }] }), false);
  assert.equal(empty({ ...base, payee: 'SEPARATE', viaSupplier: 'Factuur via leverancier · CI-2026-140' }), false);
});
