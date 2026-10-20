import { paymentOriginLabel } from '../src/app/features/purchasing/purchase-payment-origin.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import type { PurchaseDocument } from '../src/app/core/api/models.ts';
import { PAYEE_ICON, PAYEE_LABEL, PAYEE_ORDER, nettedCarrierDue, type LedgerRow, type PayeeLedger } from '../src/app/features/purchasing/purchase-payment-ledger.ts';

// The menus and the betaalbewijs words of the payment rows (round of 2026-10-15): no 'Bewijs toevoegen' any more, the bank
// transaction is the proof, a payment paid in parts is removed per transaction. The module imports the payee words at runtime,
// so it is compiled without its imports and gets them handed in.
const source = await readFile(new URL('../src/app/features/purchasing/purchase-payment-menus.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('purchase-payment-menus.ts', source, ts.ScriptTarget.Latest, true);
const javascript = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed,
  parsed.statements.filter(node => !ts.isImportDeclaration(node)))), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const menus: Record<string, any> = {};
vm.runInNewContext(javascript, { exports: menus, paymentOriginLabel, PAYEE_LABEL, PAYEE_ORDER, PAYEE_ICON, nettedCarrierDue, Intl });
const ids = (items: { id: string }[]) => Array.from(items, item => item.id);

function doc(id: number, name: string): PurchaseDocument {
  return { id, kind: 'PAYMENT_PROOF', kindLabel: 'Betaalbewijs', label: null, originalFilename: name, contentType: 'application/pdf', sizeBytes: 10,
    paymentId: 1, actor: null, addedAt: '2026-09-10', orderId: 50 };
}

function row(values: Partial<LedgerRow> = {}): LedgerRow {
  const payment = { id: 1, orderId: 50, paidOn: '2026-09-10', amount: 100, currency: 'EUR', amountEur: 100, label: null, actor: null,
    recordedAt: '2026-09-10T10:00:00Z', payee: 'SUPPLIER' } as LedgerRow['payment'];
  return { id: 1, payment, parts: [{ id: 1, payment, paidOn: '2026-09-10', amount: 100, currency: 'EUR', amountEur: 100, bankStatementLineId: null, onBank: false, proofs: [] }],
    payee: 'SUPPLIER', payeeLabel: 'Leverancier', payeeShort: 'Leverancier', paidOn: '2026-09-10', title: 'Leverancier', label: null, due: null,
    termLabel: null, settles: false, settlesLabel: null, amount: 100, currency: 'EUR', foreign: false, amountEur: 100, proofs: [], proofCount: 0,
    hasProof: false, onBank: false, bank: { linked: 0, total: 1, sharedWith: [] }, proven: false, invoice: null, invoiceFiles: [],
    actor: null, recordedAt: '2026-09-10T10:00:00Z', creditOffset: null, ...values };
}

test('the betaalbewijs of a row in words: the bank first, then files, else none; a credit offset needs none', () => {
  assert.equal(menus['bankProofLine'](row({ creditOffset: { creditId: 1, sourceOrderId: 4, sourceOrderNumber: 'INK-9', paymentId: 1, amountEur: 100 } })), 'verrekend tegoed');
  assert.equal(menus['bankProofLine'](row({ bank: { linked: 1, total: 1, sharedWith: [] }, onBank: true })), 'op de bank');
  assert.equal(menus['bankProofLine'](row({ bank: { linked: 2, total: 2, sharedWith: [] }, onBank: true })), '2 transacties op de bank');
  assert.equal(menus['bankProofLine'](row({ bank: { linked: 1, total: 2, sharedWith: [] } })), '1 van 2 op de bank');
  assert.equal(menus['bankProofLine'](row({ hasProof: true, proofCount: 1, proofs: [doc(9, 'kbc-0209.pdf')] })), 'kbc-0209.pdf');
  assert.equal(menus['bankProofLine'](row({ hasProof: true, proofCount: 2, proofs: [doc(9, 'a.pdf'), doc(10, 'b.pdf')] })), '2 bewijzen');
  assert.equal(menus['bankProofLine'](row()), 'geen betaalbewijs');
  assert.equal(menus['bankProofLine'](row({ hasProof: null, proofs: null })), null, 'unknown while the documents load');
  assert.equal(menus['bankProofLine'](row({ payee: 'SEPARATE', bank: { linked: 1, total: 1, sharedWith: ['SUPPLIER'] }, onBank: true })),
    'op de bank · zelfde transactie als de goederen');
});

test('a phone row shows its betaalbewijs line only when it adds to the trailing \'geen betaalbewijs\'', () => {
  assert.equal(menus['bankProofSub'](row()), null, 'no second \'geen betaalbewijs\'');
  assert.equal(menus['bankProofSub'](row({ hasProof: null, proofs: null })), null);
  assert.equal(menus['bankProofSub'](row({ bank: { linked: 1, total: 2, sharedWith: [] } })), '1 van 2 op de bank', 'a part on the bank still says so');
  assert.equal(menus['bankProofSub'](row({ bank: { linked: 1, total: 1, sharedWith: [] }, onBank: true, proven: true })), 'op de bank');
  assert.equal(menus['bankProofSub'](row({ hasProof: true, proofCount: 1, proofs: [doc(9, 'kbc-0209.pdf')], proven: true })), 'kbc-0209.pdf');
  assert.equal(menus['bankProofSub'](row({ creditOffset: { creditId: 1, sourceOrderId: 4, sourceOrderNumber: 'INK-9', paymentId: 1, amountEur: 100 }, proven: true })),
    'verrekend tegoed');
});

test('the payment menu has no \'Bewijs toevoegen\'; it opens the invoice and older invoice files, and a payment in parts is removed per transaction', () => {
  const plain = ids(menus['paymentMenuItems'](row(), { move: false, busy: false }));
  assert.equal(plain.includes('proof'), false);
  assert.deepEqual(plain, ['edit', 'settle', 'remove']);
  const invoiced = row({ invoice: { id: 7, number: 'CI-2026-118', documentId: 88, viaSupplier: false },
    invoiceFiles: [{ ...doc(77, 'invoice.pdf'), kind: 'COMMERCIAL_INVOICE' }], proofs: [doc(9, 'kbc.pdf')] });
  const items = menus['paymentMenuItems'](invoiced, { move: false, busy: false });
  assert.deepEqual(ids(items).slice(0, 4), ['edit', 'open:9', 'invoice-file', 'invoice-file:77']);
  assert.equal(items[2].label, 'Factuur openen');
  assert.equal(items[3].label, 'Factuurbestand openen');
  const group = row({ parts: [...row().parts, { ...row().parts[0], id: 2 }] });
  const remove = menus['paymentMenuItems'](group, { move: true, busy: false }).find((item: { id: string }) => item.id === 'remove');
  assert.deepEqual([remove.label, remove.disabled], ['Verwijderen kan per transactie in Aanpassen', true]);
});

test('every payee row offers \'Factuur toevoegen…\' and the inspection its switch, only against a server that knows invoices', () => {
  const payee = (code: 'SUPPLIER' | 'SEPARATE', via = false) => ({ payee: code, canSettle: false, canUndoSettle: false, viaSupplier: via }) as unknown as PayeeLedger;
  assert.equal(ids(menus['payeeRowMenuItems'](payee('SUPPLIER'), false)).includes('invoice'), false, 'an older server');
  assert.equal(ids(menus['payeeRowMenuItems'](payee('SUPPLIER'), false, true)).includes('invoice'), true);
  const inspection = menus['payeeRowMenuItems'](payee('SEPARATE', true), false, true);
  const via = inspection.find((item: { id: string }) => item.id === 'inspection-via');
  assert.deepEqual([via.label, via.hint, via.iconName], ['Inspectie via leverancier', 'aan', 'search']);
  assert.deepEqual(ids(menus['invoiceMenuItems']({ documentId: 88 }, false)), ['edit', 'file', 'remove']);
  assert.deepEqual(ids(menus['invoiceMenuItems']({ documentId: null }, false)), ['edit', 'remove']);
  assert.deepEqual(ids(menus['invoiceMenuItems']({ documentId: 88 }, false, true)), ['edit', 'assign', 'file', 'remove'],
    'an invoice not yet on every payment of its payee: Toewijzen aan alle betalingen');
});

test("a payment fully on the bank offers 'Transactie toevoegen…' (the server's addTransfer); never a part off the bank, the old marker or a credit offset", () => {
  const linkedPart = { ...row().parts[0], bankStatementLineId: 680, onBank: true };
  const linked = row({ parts: [linkedPart], onBank: true, bank: { linked: 1, total: 1, sharedWith: [] } });
  assert.deepEqual(ids(menus['paymentMenuItems'](linked, { move: false, busy: false, addTransfer: true })).slice(0, 2), ['edit', 'add-transfer']);
  assert.equal(menus['paymentMenuItems'](linked, { move: false, busy: false, addTransfer: true })[1].label, 'Transactie toevoegen…');
  assert.equal(ids(menus['paymentMenuItems'](linked, { move: false, busy: false })).includes('add-transfer'), false, 'an older server');
  const half = row({ parts: [linkedPart, { ...row().parts[0], id: 2 }] });
  assert.equal(menus['transferAddable'](half), false, 'an open transfer takes the next transaction instead');
  assert.equal(menus['transferAddable'](row({ parts: [{ ...linkedPart, bankStatementLineId: null }], onBank: true })), false, 'the old marker is no hard link');
  assert.equal(menus['transferAddable'](row({ parts: [linkedPart], creditOffset: { creditId: 1, sourceOrderId: 4, sourceOrderNumber: 'INK-9', paymentId: 1, amountEur: 100 } })), false);
  assert.equal(menus['todoCopy']({ kind: 'proof', key: 'p', count: 1 }).detail, 'Koppel de banktransactie', 'short enough for the phone row');
});

test('a bridge amount carries its sign in front of the euro: − € 0,01, never € -0,01 (Inkoop redesign F25)', () => {
  const plain = (text: string): string => text.replace(/[  ]/g, ' ');
  assert.equal(plain(menus['signedEur'](-0.01)), '− € 0,01');
  assert.equal(plain(menus['signedEur'](1234.5)), '€ 1.234,50');
  assert.equal(plain(menus['signedEur'](-0.001)), '€ 0,00', 'less than a cent is no amount');
  assert.equal(plain(menus['signedEur'](Number.NaN)), '€ 0,00');
});


test('external origin is visible without pretending there is a bank link or uploaded proof', () => {
  const item = row({ parts: [{ id: 1, payment: { origin: { source: 'OTHER_COMPANY', payerName: 'Entego', note: 'oude bankrekening' } }, bankStatementLineId: null }] as any });
  assert.equal(menus['bankProofLine'](item), 'Betaald door Entego · oude bankrekening');
  assert.equal(menus['bankProofSub'](item), 'Betaald door Entego · oude bankrekening');
  assert.equal(item.proven, false);
  assert.equal(menus['transferAddable'](item), false);
});
