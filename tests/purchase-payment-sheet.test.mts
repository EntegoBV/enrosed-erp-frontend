import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { computed, linkedSignal, signal, untracked } from '@angular/core';
import { bankAmountsMatch, bankTransactionDay } from '../src/app/shared/bank-transaction-options.ts';
import { appendPaymentProofs, PROOF_ACCEPT, proofFileKey } from '../src/app/shared/payment-proof-selection.ts';
import { DUE_MOMENT, FREIGHT_TERM_LABEL, PAYEE_LABEL, PAYEE_ORDER, PAYEE_SHORT } from '../src/app/features/purchasing/purchase-payment-ledger.ts';
import { parsePurchasePaymentAmount } from '../src/app/features/purchasing/purchase-payment-amount.ts';
import { dayText, invoiceCandidates, invoiceOption, invoicesOf, resolveInvoice } from '../src/app/features/purchasing/purchase-invoices.ts';
import {
  carveText, inspectionSplitBlocked, linkChange, pendingAlreadyLinked, pendingLinkPlan, pendingPartEur, surplusQuestion, transferCompanions,
} from '../src/app/features/purchasing/purchase-payment-links.ts';

/*
 * The payment sheet of round 2 (Emre, 2026-10-15): one 'Betaalbewijs' list
 * with the bank transaction first and every file of the payment, the
 * question for a larger transaction, 'Wat verandert' before a link, and the
 * invoice that holds for every part-payment. The real class runs with
 * Angular's signals; its inputs are writable signals the test sets the way
 * the editor binds them, and a patch is applied the way the editor applies
 * it. The template is read as text for its order and words.
 */

const source = await readFile(new URL('../src/app/features/purchasing/purchase-payment-sheet.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('purchase-payment-sheet.ts', source, ts.ScriptTarget.Latest, true);
const original = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === 'PurchasePaymentSheet')!;
const isolated = ts.factory.updateClassDeclaration(original, original.modifiers?.filter(modifier => !ts.isDecorator(modifier)),
  original.name, original.typeParameters, undefined, original.members);
const javascript = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [isolated])), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const template = source.slice(source.indexOf('template: `'), source.indexOf('`,\n})\nexport class PurchasePaymentSheet'));
const plain = (text: string | null | undefined) => text == null ? text : text.replace(/[  ]/g, ' ');

function mount() {
  const exports: Record<string, new () => any> = {};
  const tokens = { viewport: Symbol('DesktopViewport'), accounts: Symbol('BankAccountsStore') };
  const input = Object.assign((initial?: unknown) => signal(initial), { required: () => signal<unknown>(undefined) });
  const outputs: Record<string, unknown[]> = {};
  vm.runInNewContext(javascript, {
    exports, computed, signal, linkedSignal, untracked, input, nextSheetId: 0,
    output: () => ({ emit: () => undefined }),
    inject: (token: symbol) => token === tokens.viewport ? { active: signal(true) }
      : { options: signal([{ key: 'KBC', label: 'KBC' }]), loading: signal(false), load: async () => undefined },
    DesktopViewport: tokens.viewport, BankAccountsStore: tokens.accounts,
    PAYEE_ORDER, PAYEE_SHORT, PAYEE_LABEL, DUE_MOMENT, FREIGHT_TERM_LABEL, parsePurchasePaymentAmount, dayText, invoiceCandidates, invoiceOption,
    invoicesOf, resolveInvoice, carveText, inspectionSplitBlocked, linkChange, pendingAlreadyLinked, pendingLinkPlan, pendingPartEur, surplusQuestion, transferCompanions,
    appendPaymentProofs, PROOF_ACCEPT, proofFileKey, bankAmountsMatch, bankTransactionDay,
    formatEur: (value: number) => value.toLocaleString('nl-BE', { style: 'currency', currency: 'EUR' }),
  });
  const sheet = new exports['PurchasePaymentSheet']();
  // The editor binds (patch) as paying.set({ ...pay, ...$event }).
  for (const name of ['patch', 'unlinkLine', 'removeProof', 'openDocument']) {
    outputs[name] = [];
    sheet[name] = { emit: (value: unknown) => { outputs[name].push(value); if (name === 'patch') sheet.draft.set({ ...sheet.draft(), ...(value as object) }); } };
  }
  sheet.roundOnServer.set(true);
  sheet.today.set('2026-10-15');
  return { sheet, outputs };
}

const goods = { id: 201, orderId: 21, paidOn: '2026-08-03', amount: 10000, currency: 'EUR', amountEur: 10000, label: 'Aanbetaling 30%', actor: 'Emre',
  recordedAt: '2026-08-03T10:00:00Z', payee: 'SUPPLIER', settles: false, instalmentDue: 'ORDERED', bankStatementLineId: 610 };
const inspection = { ...goods, id: 202, amount: 300, amountEur: 300, label: 'Aanbetaling 30% · inspectie', payee: 'SEPARATE', instalmentDue: null };
const line610 = { id: 610, amountEur: -10300, bookedAt: '2026-08-03T09:00:00Z', timeZone: 'Europe/Brussels', account: 'KBC', reference: 'PO-2026-021 30% + inspectie' };
const part = (payment: any, proofs: any[] = []) => ({ id: payment.id, payment, paidOn: payment.paidOn, amount: payment.amount, currency: payment.currency,
  amountEur: payment.amountEur, bankStatementLineId: payment.bankStatementLineId ?? null, onBank: payment.bankStatementLineId != null, proofs });
const draft = (payment: any, values: any = {}) => ({ id: payment.id, amount: payment.amount, amountInput: String(payment.amount), currency: payment.currency,
  paidOn: payment.paidOn, label: payment.label, payee: payment.payee, files: [], settles: false, instalmentDue: payment.instalmentDue, groupIds: [payment.id], ...values });

test('Betaalbewijs lists the bank transaction first, then every file, and counts only what it lists', () => {
  const { sheet } = mount();
  const proof = { id: 900, orderId: 21, kind: 'PAYMENT_PROOF', originalFilename: 'kbc-afschrift.pdf', paymentId: 201 };
  const old = { id: 77, orderId: 21, kind: 'COMMERCIAL_INVOICE', originalFilename: 'invoice.pdf', paymentId: 201 };
  sheet.draft.set(draft(goods, { files: [new File(['x'], 'bevestiging.pdf')] }));
  sheet.parts.set([part(goods, [proof])]);
  sheet.proofFiles.set([proof]);
  sheet.invoiceFiles.set([old]);
  sheet.bankLines.set([line610]);
  sheet.orderPayments.set([goods, inspection]);
  sheet.viaSupplier.set(true);
  // The old invoice.pdf takes one of the payment's five places: room for three new files.
  sheet.proofSlots.set(3);
  assert.deepEqual([sheet.fileCount(), sheet.fileRoom()], [2, 4], 'the stored proof and the new file, of the four places the list has');
  assert.equal(plain(sheet.lineText(line610)), '03/08/2026 · KBC · € 10.300,00');
  assert.equal(plain(sheet.carries(line610)), 'Inspectie € 300,00 (via leverancier)', 'the € 10.300 transaction explains itself');
  assert.equal(sheet.showInspectionSplit(), false, 'the transaction already carries the inspection: no second split');
  // The template: one Betaalbewijs block, the transaction before the files, no second proof picker, the agreed words.
  const block = template.slice(template.indexOf('aria-label="Betaalbewijs"'));
  const order = ['lineOf(part)', 'Deze transactie draagt ook', 'proofFiles()', 'newFiles', 'addFile', 'Een gekoppelde banktransactie is al het bewijs; een bestand is optioneel.'];
  assert.deepEqual(order.map(word => block.indexOf(word) >= 0), order.map(() => true));
  assert.deepEqual(order.map(word => block.indexOf(word)), [...order.map(word => block.indexOf(word))].sort((a, b) => a - b));
  assert.equal(template.includes('app-payment-proof-picker'), false);
  assert.equal(template.includes('Bankafschrift toevoegen'), false);
  assert.equal(template.includes('Banktransactie koppelen'), false, "one word for it in this sheet: 'Transactie toevoegen'");
  assert.equal((template.match(/Transactie toevoegen/g) ?? []).length >= 3, true);
  assert.match(template, /Factuurbestand zonder gegevens · hangt aan deze betaling/);
});

test('a larger transaction asks what the surplus is, then shows what will change; a smaller one previews its part', () => {
  const { sheet } = mount();
  const open = { ...goods, id: 301, amount: 10250, amountEur: 10250, paidOn: '2026-01-03', bankStatementLineId: null };
  sheet.draft.set(draft(open));
  sheet.parts.set([part(open)]);
  sheet.orderPayments.set([open]);
  sheet.inspectionOffered.set(true);
  const bigger = { ...line610, id: 611, amountEur: -10300, bookedAt: '2026-01-05T09:00:00Z' };
  // Money typed before the pick goes back to the stored payment: the transaction decides.
  sheet.draft.set({ ...sheet.draft(), amount: 9999, amountInput: '9999' });
  sheet.pickLine(301, bigger);
  assert.deepEqual([sheet.draft().amount, sheet.draft().paidOn, sheet.linkingOne()], [10250, '2026-01-03', true]);
  assert.equal(sheet.pendingPlan().kind, 'higher');
  assert.equal(sheet.saveBlocked(), true);
  assert.equal(plain(sheet.surplusText()), 'Transactie is € 50,00 hoger dan deze betaling');
  assert.equal(sheet.changeRows().length, 0);
  sheet.chooseSurplus('ADJUST');
  assert.equal(sheet.saveBlocked(), false);
  assert.deepEqual(sheet.changeRows().map((row: any) => [row.label, plain(row.now), plain(row.after)]), [
    ['Bedrag', '€ 10.250,00', '€ 10.300,00'], ['Betaald op', '03/01/2026', '05/01/2026'], ['Bewijs', 'geen', '05/01/2026 · KBC · € 10.300,00']]);
  sheet.cancelPending();
  assert.deepEqual([sheet.draft().pendingLines.length, sheet.draft().surplus], [0, null]);
  // A smaller one: 'Deel van deze betaling …' as Kosten & bank says it.
  const big = { ...open, amount: 12000, amountEur: 12000 };
  sheet.draft.set(draft(big));
  sheet.parts.set([part(big)]);
  sheet.pickLine(301, { ...line610, id: 640, amountEur: -5000 });
  assert.equal(plain(sheet.carve(sheet.pendingLine())), 'Deel van deze betaling: € 5.000,00 van € 12.000,00; de rest (€ 7.000,00) blijft open als tweede transactie.');
});

test('after a lost answer the transactions on the payment are no longer pending: no red text, the retry is not blocked', () => {
  const { sheet } = mount();
  const root = { ...goods, id: 102, amount: 10000, amountEur: 10000, paidOn: '2026-09-10', groupId: 102, bankStatementLineId: 520 };
  const rest = { ...root, id: 103, amount: 11733.63, amountEur: 11733.63, paidOn: '2026-09-24', bankStatementLineId: 534 };
  sheet.draft.set(draft(root, { groupIds: [102, 103], pendingPartId: 102, bankLinkPending: true,
    pendingLines: [{ ...line610, id: 520, amountEur: -10000 }, { ...line610, id: 534, amountEur: -11733.63 }] }));
  sheet.parts.set([part(root), part(rest)]);
  assert.deepEqual([sheet.shownPending().length, sheet.pendingMessage(), sheet.saveBlocked()], [0, null, false]);
  assert.equal(sheet.allLinked(), true, "'Transactie toevoegen' explains: alle transacties gekoppeld");
  assert.deepEqual([sheet.newestDay(), sheet.firstDay()], ['2026-09-24', '2026-09-10'], 'one date rule: the newest transfer, the first beside it');
});

test("the payee's only invoice holds for all its payments; a new invoice is for all part-payments by default", () => {
  const { sheet } = mount();
  const invoice = { id: 7, orderId: 21, payee: 'SUPPLIER', payeeLabel: 'Leverancier', number: 'CI-2026-118', invoiceDate: '2026-08-20', amount: 33633.33,
    currency: 'EUR', amountEur: 33633.33, documentId: null, documentName: null, notes: null, actor: null, recordedAt: '', primary: true,
    coversInspection: true, paymentIds: [201], paidEur: 0 };
  sheet.draft.set(draft(goods, { invoiceId: null }));
  sheet.invoices.set([invoice]);
  sheet.payeePaymentCount.set(3);
  assert.equal(sheet.forAllNote(), 'Geldt voor alle betalingen van Leverancier (3)');
  sheet.invoices.set([invoice, { ...invoice, id: 8, number: 'CI-2026-140' }]);
  assert.equal(sheet.forAllNote(), null, 'two invoices: the select says which');
  sheet.openNewInvoice();
  assert.equal(sheet.draft().newInvoice.forAll, true);
  assert.match(template, /Voor alle deelbetalingen/);
  assert.match(template, /Hoort bij de factuur, niet bij deze ene betaling\./);
});
