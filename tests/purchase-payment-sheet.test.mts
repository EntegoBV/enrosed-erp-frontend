import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { computed, linkedSignal, signal, untracked } from '@angular/core';
import { bankAmountsMatch, bankTransactionDay } from '../src/app/shared/bank-transaction-options.ts';
import { appendPaymentProofs, PROOF_ACCEPT, proofFileKey } from '../src/app/shared/payment-proof-selection.ts';
import { DUE_MOMENT, FREIGHT_TERM_LABEL, PAYEE_LABEL, PAYEE_ORDER, PAYEE_SHORT } from '../src/app/features/purchasing/purchase-payment-ledger.ts';
import { amountInputText, parsePurchasePaymentAmount } from '../src/app/features/purchasing/purchase-payment-amount.ts';
import { dayText, invoiceCandidates, invoiceNumberKey, invoiceOption, invoicesOf, resolveInvoice } from '../src/app/features/purchasing/purchase-invoices.ts';
import {
  adjustConsequence, carveForeignText, carveText, foreignLinkWarning, growLinkPlan, growPreview, inspectionSplitBlocked, linkChange, pendingAlreadyLinked,
  pendingLinkPlan, pendingPartEur, shareEffect, surplusQuestion, transferCompanions,
} from '../src/app/features/purchasing/purchase-payment-links.ts';
import {
  alsoContainerOptions, alsoPartAs, alsoPartChoices, alsoPartFor, alsoPartKey, alsoTotalEur, rebalancedGoods,
} from '../src/app/features/purchasing/purchase-also-containers.ts';
import { applyShare, shareStatus } from '../src/app/features/purchasing/purchase-payment-share.ts';
import { containerName, containerNumberHint } from '../src/app/features/purchasing/container-name.ts';

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
/** Values made inside the vm context compare by their JSON. */
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

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
    invoiceNumberKey, carveForeignText, foreignLinkWarning, adjustConsequence, growLinkPlan, growPreview, amountInputText,
    appendPaymentProofs, PROOF_ACCEPT, proofFileKey, bankAmountsMatch, bankTransactionDay,
    alsoPartAs, alsoPartChoices, alsoPartFor, alsoPartKey, alsoTotalEur, rebalancedGoods, applyShare, shareStatus, shareEffect, containerName, containerNumberHint,
    formatEur: (value: number) => value.toLocaleString('nl-BE', { style: 'currency', currency: 'EUR' }),
  });
  const sheet = new exports['PurchasePaymentSheet']();
  // The editor binds (patch) as paying.set({ ...pay, ...$event }).
  for (const name of ['patch', 'unlinkLine', 'removeProof', 'openDocument', 'alsoLoad']) {
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

/* ---- round-2 review: USD/CNY links, a refused choice that stays open, the invoice the file and the number belong to */

test('a USD payment and one transaction: the sheet shows a whole link with the rate, a named part carves in dollars, never the larger-transaction question', () => {
  const { sheet } = mount();
  const usd = { ...goods, id: 401, amount: 12000, currency: 'USD', amountEur: 10250, paidOn: '2026-01-03', bankStatementLineId: null };
  sheet.draft.set(draft(usd));
  sheet.parts.set([part(usd)]);
  sheet.orderPayments.set([usd]);
  sheet.inspectionOffered.set(true);
  sheet.pickLine(401, { ...line610, id: 650, amountEur: -5090, bookedAt: '2026-01-05T09:00:00Z' });
  assert.deepEqual(clone(sheet.pendingPlan()), { kind: 'part', lineId: 650, whole: true }, 'the server links it whole: no carve in euro');
  assert.deepEqual([sheet.pickingClosed(), sheet.saveBlocked(), sheet.foreignPick()?.currency], [false, false, 'USD']);
  assert.match(plain(sheet.foreignWarning())!, /^€ 5\.090,00 wijkt sterk af van de geboekte € 10\.250,00/);
  assert.deepEqual(sheet.changeRows().map((row: any) => row.label), ['Bedrag', 'Betaald op', 'Koers', 'Bewijs']);
  sheet.foreignPartInput('6.000');
  assert.deepEqual(clone(sheet.pendingPlan()), { kind: 'part', lineId: 650, whole: false, amount: 6000 });
  assert.equal(sheet.foreignWarning(), null);
  assert.equal(plain(sheet.carve(sheet.pendingLine())),
    'Deel van deze betaling: US$ 6.000,00 (€ 5.090,00) van US$ 12.000,00; de rest (US$ 6.000,00) blijft open als tweede transactie.');
  sheet.foreignPartInput('abc');
  assert.deepEqual([sheet.foreignPartInvalid(), sheet.saveBlocked()], [true, true]);
  sheet.foreignPartInput('13000');
  assert.equal(sheet.pendingMessage()?.startsWith('Het deel moet kleiner zijn dan de betaling'), true);
  // A larger euro line: whole, no question, no 'Rest als inspectie'.
  sheet.cancelPending();
  assert.deepEqual([sheet.draft().pendingPartAmountInput, sheet.draft().pendingPartAmount], ['', null], 'a new pick starts without a named part');
  sheet.pickLine(401, { ...line610, id: 651, amountEur: -10600 });
  assert.equal(sheet.pendingPlan().kind, 'part');
  assert.equal(template.includes("@if (foreignPick(); as foreign)"), true);
});

test('a refused link never locks the choice: the options, Annuleren and × stay usable, and the button retries only while something is left', () => {
  const { sheet } = mount();
  const open = { ...goods, id: 301, amount: 10250, amountEur: 10250, paidOn: '2026-01-03', bankStatementLineId: null };
  sheet.draft.set(draft(open, { bankLinkPending: true, bankLinkError: 'Inspectie via leverancier staat al geboekt' }));
  sheet.parts.set([part(open)]);
  sheet.orderPayments.set([open]);
  sheet.pickLine(301, { ...line610, id: 611, amountEur: -10300 });
  assert.equal(sheet.draft().bankLinkError, '', 'a new pick clears the refusal');
  sheet.chooseSurplus('INSPECTION');
  sheet.draft.set({ ...sheet.draft(), bankLinkError: 'geweigerd' });
  sheet.chooseSurplus('ADJUST');
  assert.deepEqual([sheet.draft().surplus, sheet.draft().bankLinkError, sheet.retrying()], ['ADJUST', '', true]);
  sheet.cancelPending();
  assert.equal(sheet.retrying(), false, "nothing left to link: 'Wijziging bewaren', not 'Koppeling opnieuw proberen'");
  const block = template.slice(template.indexOf('pay-sheet__line--pending'), template.indexOf('pay-sheet__line--change'));
  assert.equal(block.includes('pay.bankLinkPending'), false, 'the pending ×, the choices and Annuleren are never disabled by a pending link');
});

test('a new invoice: the switch only beside another invoice, a number the payee has already is picked instead, the file follows', () => {
  const { sheet } = mount();
  const invoice = { id: 7, orderId: 21, payee: 'SUPPLIER', payeeLabel: 'Leverancier', number: 'CI-2026-118', invoiceDate: '2026-08-20', amount: 33633.33,
    currency: 'EUR', amountEur: 33633.33, documentId: null, documentName: null, notes: null, actor: null, recordedAt: '', primary: true,
    coversInspection: true, paymentIds: [201], paidEur: 0 };
  sheet.draft.set(draft(goods, { invoiceId: null }));
  sheet.payeePaymentCount.set(3);
  sheet.openNewInvoice();
  assert.equal(sheet.newInvoiceBeside(), false, 'the first invoice of the payee holds for every payment by itself');
  assert.equal(sheet.newInvoiceNote(), 'Geldt voor alle betalingen van Leverancier (3)');
  sheet.invoices.set([invoice]);
  const file = new File(['x'], 'ci-118.pdf');
  sheet.patchInvoice({ number: ' ci-2026-118', amountInput: '100', amount: 100, file });
  assert.equal(sheet.duplicateInvoice()?.id, 7);
  assert.deepEqual([sheet.newInvoiceInvalid(), sheet.saveBlocked(), sheet.newInvoiceBeside()], [true, true, false]);
  sheet.patchInvoice({ number: 'CI-2026-140' });
  assert.deepEqual([sheet.duplicateInvoice(), sheet.newInvoiceBeside()], [null, true]);
  // After a lost answer the invoice on the container is this sheet's own: no warning, the retry goes on.
  sheet.patchInvoice({ number: 'CI-2026-118' });
  sheet.draft.set({ ...sheet.draft(), invoiceAttempt: 'ci-2026-118' });
  assert.equal(sheet.duplicateInvoice(), null);
  sheet.draft.set({ ...sheet.draft(), invoiceAttempt: undefined });
  sheet.useExistingInvoice(sheet.duplicateInvoice());
  assert.deepEqual([sheet.draft().invoiceId, sheet.draft().invoiceIdChanged, sheet.draft().newInvoice, sheet.draft().invoiceFile, sheet.draft().invoiceFileFor],
    [7, true, undefined, file, 7], 'the typed file goes to the invoice that has none');
  assert.match(template, /@if \(newInvoiceBeside\(\)\)/);
});

test("'Bestand bij de factuur' on an inspection paid via the supplier remembers the supplier's invoice it was chosen for", () => {
  const { sheet } = mount();
  const invoice = { id: 7, orderId: 21, payee: 'SUPPLIER', payeeLabel: 'Leverancier', number: 'CI-2026-118', invoiceDate: '2026-08-20', amount: 31048.04,
    currency: 'EUR', amountEur: 31048.04, documentId: null, documentName: null, notes: null, actor: null, recordedAt: '', primary: true,
    coversInspection: true, paymentIds: [], paidEur: 0 };
  sheet.draft.set(draft(inspection, { invoiceId: null }));
  sheet.parts.set([part(inspection)]);
  sheet.orderPayments.set([goods, inspection]);
  sheet.invoices.set([invoice]);
  sheet.viaSupplier.set(true);
  assert.equal(sheet.chosenInvoice()?.id, 7);
  const file = new File(['x'], 'ci-118.pdf');
  sheet.chooseInvoiceFile({ target: { files: [file], value: 'x' } });
  assert.deepEqual([sheet.draft().invoiceFile, sheet.draft().invoiceFileFor], [file, 7]);
});

/* ---- round 3 (screen check of round 2): one more transaction on a payment fully on the bank, the consequence before the choice, the proof head */

test("a payment fully on the bank offers 'Transactie toevoegen': one transaction, said before it is saved, the payment grows by it", () => {
  const { sheet } = mount();
  const linked = { ...goods, id: 201, amount: 12000, amountEur: 12000, paidOn: '2026-10-02', bankStatementLineId: 680 };
  sheet.draft.set(draft(linked));
  sheet.parts.set([part(linked)]);
  sheet.bankLines.set([{ ...line610, id: 680, amountEur: -12000 }]);
  sheet.termStanding.set({ label: '30% bij bestelling', term: true, plannedEur: 12000, paidEur: 12000 });
  assert.deepEqual([sheet.allLinked(), sheet.addOffered(), sheet.provenByBank()], [true, true, true]);
  assert.equal(template.includes('alle transacties gekoppeld'), false, 'no sentence on every finished payment');
  sheet.startAdd();
  assert.deepEqual([sheet.draft().addTransfer, sheet.draft().pendingPartId, sheet.addOffered()], [true, 201, false]);
  sheet.pickAdded({ ...line610, id: 695, amountEur: -500, bookedAt: '2026-10-08T08:30:00Z' });
  assert.deepEqual(clone(sheet.pendingPlan()), { kind: 'grow', lineId: 695, addEur: 500 });
  assert.equal(plain(sheet.growText()), 'De betaling wordt € 12.500,00 (was € 12.000,00); de termijn komt € 500,00 boven de afspraak.');
  assert.equal(sheet.changeRows().length, 0, 'no carve, no Wat verandert of a part');
  assert.equal(sheet.saveBlocked(), false);
  assert.match(template, /pay\.addTransfer && shownPending\(\)\.length \? 'Transactie toevoegen'/);
  sheet.cancelPending();
  assert.deepEqual([sheet.draft().addTransfer, sheet.draft().pendingLines.length, sheet.addOffered()], [false, 0, true]);
  // The old marker without a hard link, or a credit offset: nothing to grow on the server.
  sheet.parts.set([{ ...part(linked), bankStatementLineId: null, onBank: true }]);
  assert.equal(sheet.addOffered(), false);
});

test("'Bedrag aanpassen' says what it does to the term; the question has no Annuleren of its own", () => {
  const { sheet } = mount();
  const open = { ...goods, id: 201, amount: 12000, amountEur: 12000, paidOn: '2026-10-02', bankStatementLineId: null };
  sheet.draft.set(draft(open));
  sheet.parts.set([part(open)]);
  sheet.orderPayments.set([open]);
  sheet.termStanding.set({ label: '30% bij bestelling', term: true, plannedEur: 12000, paidEur: 12000 });
  sheet.pickLine(201, { ...line610, id: 680, amountEur: -12300 });
  assert.equal(plain(sheet.adjustText()), 'De termijn komt dan € 300,00 boven de afspraak (te veel betaald).');
  sheet.termStanding.set({ label: '30% bij bestelling', term: true, plannedEur: 12500, paidEur: 12000 });
  assert.equal(plain(sheet.adjustText()), 'De betaling volgt de transactie; daarna nog open voor de termijn: € 200,00.');
  const question = template.slice(template.indexOf('pay-sheet__surplusopts'), template.indexOf('@if (foreignPick(); as foreign)'));
  assert.equal(question.includes('Annuleren'), false, "one 'Annuleren': the footer's");
  assert.match(question, /\{\{ adjustText\(\) \}\}/);
});

test('on the bank the transaction is the proof: the head says so and the files are optional; a linked USD payment shows its bank rate', () => {
  const { sheet } = mount();
  const usd = { ...goods, id: 301, amount: 4320, currency: 'USD', amountEur: 3760, paidOn: '2026-09-18', bankStatementLineId: 690 };
  sheet.draft.set(draft(usd, { amountInput: '4.320,00', amountEur: 3760, amountEurInput: '3.760,00' }));
  sheet.parts.set([part(usd)]);
  sheet.rateEur.set(3715.2);
  assert.deepEqual([sheet.provenByBank(), sheet.linkedSingle()], [true, true]);
  assert.equal(sheet.bankRate(), 'Koers 0,8704 (bank)', 'instead of the order-rate hint');
  assert.match(template, /Bewijs: transactie ✓/);
  assert.match(template, /bestanden \(optioneel\) \{\{ fileCount\(\) \}\}\/\{\{ fileRoom\(\) \}\}/);
  sheet.parts.set([{ ...part(usd), bankStatementLineId: null, onBank: false }]);
  assert.deepEqual([sheet.provenByBank(), sheet.bankRate()], [false, null]);
  assert.equal(sheet.amountText(12000), '12.000,00');
});

/* ---- Emre, 2026-10-16: no second bank movement; one transaction shared over containers */

test("no 'Ook als bankbeweging noteren': a picked transaction is the movement", () => {
  const { sheet } = mount();
  assert.equal(template.includes('Ook als bankbeweging noteren'), false);
  assert.equal(template.includes('Nog geen rekening'), false);
  assert.equal(template.includes('De bestaande banktransactie wordt gekoppeld. Er komt geen extra bankbeweging bij.'), true);
  assert.equal('toBankOffered' in sheet || 'bankBlocked' in sheet || 'bankAccount' in sheet, false);
});

/* PO-038 noted its 30 % (€ 3.070,20 against an Afspraak of € 3.011,65); PO-039 noted the same; PO-040 has its 30 % open. One € 11.403,38 transfer paid all three. */
const sharedViews = [38, 39, 40].map(id => ({ order: { id, number: `PO-2026-0${id}`, alias: null, supplierId: 8, status: 'BESTELD', archivedAt: null },
  reconciliation: { streams: [], supplierInstalments: [{ due: 'ORDERED', label: '30% bij bestelling', plannedEur: id === 38 ? 3011.65 : 3070.2, paidEur: id === 40 ? 0 : 3070.2,
    remainingEur: id === 40 ? 3070.2 : 0, finalized: false }] } })) as any[];
const sharedPayables = [{ key: 'container:40:SUPPLIER:ORDERED', orderId: 40, orderNumber: 'PO-2026-040', alias: null, status: 'BESTELD', archived: false, payee: 'SUPPLIER',
  termLabel: '30% bij bestelling', due: 'ORDERED', plannedEur: 3070.2, paidEur: 0, remainingEur: 3070.2, bucket: 'now', whenLabel: 'nu', invoiceNumber: null, viaSupplier: false }] as any[];
const sharedRows = [{ id: 392, orderId: 39, orderNumber: 'PO-2026-039', orderAlias: null, paidOn: '2026-09-25', amountEur: 3070.2, amount: 3070.2, currency: 'EUR',
  label: '30% bij bestelling', payee: 'SUPPLIER', bankStatementLineId: null, instalmentDue: 'ORDERED', creditOffset: false }] as any[];
const sharedOptions = () => alsoContainerOptions(sharedPayables, sharedViews.map(view => ({ id: view.order.id, supplierId: 8 })), new Map([[8, 'Yunnan']]), 38, 8,
  { payments: sharedRows, views: sharedViews, payee: 'SUPPLIER' });

test("a larger transaction offers 'Verdelen over containers' first; the share follows the Afspraak, 1/n or what is typed, and saves only when it makes the transaction", () => {
  const { sheet, outputs } = mount();
  const options = template.slice(template.indexOf('pay-sheet__surplusopts'), template.indexOf('@if (plan.kind === \'share\')'));
  assert.ok(options.indexOf('Verdelen over containers') >= 0 && options.indexOf('Verdelen over containers') < options.indexOf('Bedrag aanpassen naar'), 'Verdelen comes first');
  const own = { ...goods, id: 381, orderId: 38, amount: 3070.2, amountEur: 3070.2, paidOn: '2026-09-25', bankStatementLineId: null, label: '30% bij bestelling' };
  sheet.draft.set(draft(own));
  sheet.parts.set([part(own)]);
  sheet.orderPayments.set([own]);
  sheet.orderName.set('PO-2026-038');
  sheet.termStanding.set({ label: '30% bij bestelling', term: true, plannedEur: 3011.65, paidEur: 3070.2 });
  sheet.pickLine(381, { ...line610, id: 700, amountEur: -11403.38, bookedAt: '2026-09-28T09:00:00Z', account: 'BE94731074082814' });
  assert.deepEqual([sheet.pendingPlan().kind, sheet.shareOffered(), plain(sheet.surplusText())], ['higher', true, 'Transactie is € 8.333,18 hoger dan deze betaling']);
  sheet.chooseSurplus('SHARE');
  assert.deepEqual(clone(sheet.pendingPlan()), { kind: 'share', lineId: 700 });
  assert.equal(sheet.pickingClosed(), true, 'a shared transaction stands alone: no second picker beside it');
  assert.deepEqual([sheet.draft().shareOwn, sheet.draft().shareOwnInput, sheet.draft().shareMode, outputs.alsoLoad.length], [3070.2, '3.070,20', 'AFSPRAAK', 1]);
  assert.equal(sheet.saveBlocked(), true, 'no other container yet');
  // The host loaded the containers (it may also have proposed PO-039); here the owner adds them.
  sheet.alsoState.set({ loading: false, supported: true, options: sharedOptions() });
  sheet.addAlso('39');
  assert.deepEqual([sheet.draft().alsoParts[0].paymentId, sheet.draft().shareOwn, sheet.draft().alsoParts[0].amount], [392, 5701.69, 5701.69], 'its open payment, half each');
  sheet.addAlso('40');
  const rows = sheet.draft().alsoParts;
  assert.deepEqual([sheet.draft().shareOwn, ...rows.map((row: any) => row.amount)], [3801.13, 3801.13, 3801.12]);
  assert.deepEqual([plain(sheet.shareState().text), sheet.saveBlocked()], ['Samen € 11.403,38 van € 11.403,38 ✓', false]);
  assert.equal(plain(sheet.ownShareText()), 'deze betaling · 30% bij bestelling · € 3.070,20 · betaling wordt € 3.801,13 (was € 3.070,20); de termijn komt € 789,48 boven de afspraak');
  assert.equal(plain(sheet.alsoRowText(rows[0])),
    'bestaande betaling · 30% bij bestelling · € 3.070,20 · nog niet op de bank · betaling wordt € 3.801,13 (was € 3.070,20); de termijn komt € 730,93 boven de afspraak');
  assert.equal(plain(sheet.alsoRowText(rows[1])), 'nieuwe betaling · 30% bij bestelling · open € 3.070,20; de termijn komt € 730,92 boven de afspraak');
  assert.deepEqual(sheet.choicesOf(rows[0]).map((choice: any) => plain(choice.text)), ['Bestaand: € 3.070,20', 'Nieuw: 30% bij bestelling']);
  assert.equal(sheet.choicesOf(rows[1]).length, 1, 'one choice: no select');
  // Typed by hand: MANUAL, and the save waits until the parts make the transaction again.
  sheet.setShareOwn('3.500');
  assert.deepEqual([sheet.draft().shareMode, plain(sheet.shareState().text), sheet.saveBlocked()], ['MANUAL', 'Samen € 11.102,25 van € 11.403,38 · nog € 301,13 te verdelen', true]);
  sheet.setAlsoAmount(40, '4.102,25');
  assert.deepEqual([sheet.shareState().matches, sheet.saveBlocked()], [true, false]);
  // A row switched to a new payment keeps its amount while MANUAL; 'Gelijk verdelen' then gives 1/3 again.
  sheet.switchAlso(39, 't:ORDERED');
  assert.deepEqual([sheet.draft().alsoParts[0].paymentId, sheet.draft().alsoParts[0].amount], [null, 3801.13]);
  sheet.setShareMode('EQUAL');
  assert.deepEqual([sheet.draft().shareMode, sheet.draft().shareOwn, ...sheet.draft().alsoParts.map((row: any) => row.amount)], ['EQUAL', 3801.13, 3801.13, 3801.12]);
  sheet.removeAlso(40);
  assert.deepEqual([sheet.draft().shareOwn, sheet.draft().alsoParts[0].amount], [5701.69, 5701.69], 'the mode follows a removed row');
  assert.match(template, /pendingPlan\(\)\.kind === 'share' \? 'Verdelen en koppelen'/);
  assert.match(template, /Voeg minstens één andere container toe\./);
  // Another choice ends the share: its rows go.
  sheet.chooseSurplus('ADJUST');
  assert.deepEqual([sheet.pendingPlan().kind, sheet.draft().alsoParts.length, sheet.draft().shareOwn], ['part', 0, null]);
});

test('a USD payment and a transaction far above its euro may be shared too: the payment goes whole, the dollar part field steps aside', () => {
  const { sheet } = mount();
  const usd = { ...goods, id: 421, orderId: 38, amount: 4000, currency: 'USD', amountEur: 3680, paidOn: '2026-09-06', bankStatementLineId: null };
  sheet.draft.set(draft(usd));
  sheet.parts.set([part(usd)]);
  sheet.orderPayments.set([usd]);
  sheet.pickLine(421, { ...line610, id: 701, amountEur: -11403.38 });
  assert.equal(sheet.pendingPlan().kind, 'part');
  assert.match(plain(sheet.foreignWarning())!, /wijkt sterk af/);
  assert.deepEqual([sheet.shareOffered(), sheet.surplusEur() > 0], [true, true]);
  sheet.chooseSurplus('SHARE');
  assert.deepEqual([sheet.pendingPlan().kind, sheet.foreignPick(), sheet.foreignPayment()?.currency], ['share', null, 'USD']);
  assert.match(plain(sheet.ownShareText())!, /^deze betaling · .* · US\$ 4\.000,00 \(€ 3\.680,00\) · betaling in USD: gaat helemaal op deze transactie; de euro wordt € 3\.680,00 \(was € 3\.680,00\)$/);
  assert.match(template, /Niet verdelen<small>De hele betaling gaat op deze transactie<\/small>/);
  sheet.chooseSurplus(null);
  assert.deepEqual([sheet.pendingPlan().kind, sheet.foreignPick()?.currency], ['part', 'USD']);
  // Never for Andere kosten.
  sheet.draft.set({ ...sheet.draft(), payee: 'OTHER' });
  assert.equal(sheet.shareOffered(), false);
});

test("a new transfer's other container starts on its open payment (never a second one), switchable to a new payment", () => {
  const { sheet } = mount();
  const bank = { ...line610, id: 702, amountEur: -16500, bookedAt: '2026-10-12T22:00:00Z', account: 'BE94731074082814' };
  sheet.draft.set({ id: null, amount: 16500, amountInput: '16.500,00', currency: 'EUR', paidOn: '2026-10-13', label: '30% bij bestelling', payee: 'SUPPLIER', files: [],
    settles: false, instalmentDue: 'ORDERED', bankTransaction: bank, alsoOpen: true, alsoParts: [] });
  sheet.transferEur.set(16500);
  sheet.supplierId.set(8);
  sheet.alsoState.set({ loading: false, supported: true, options: sharedOptions() });
  assert.equal(sheet.alsoOffered(), true);
  assert.deepEqual(sheet.alsoChoices().map((option: any) => sheet.optionText(option)), ['PO-2026-039 · open betaling', 'PO-2026-040']);
  sheet.addAlso('39');
  const row = sheet.draft().alsoParts[0];
  assert.deepEqual([row.paymentId, row.amount, sheet.draft().amount], [392, 3070.2, 13429.8], "this payment's goods give way while the transaction was made");
  assert.equal(plain(sheet.alsoRowText(row)), 'bestaande betaling · 30% bij bestelling · € 3.070,20 · nog niet op de bank · wordt gekoppeld · betaald op 13/10/2026');
  sheet.switchAlso(39, 't:ORDERED');
  assert.deepEqual([sheet.draft().alsoParts[0].paymentId, sheet.draft().alsoParts[0].amount, sheet.partKey(sheet.draft().alsoParts[0])], [null, 3070.2, 't:ORDERED']);
  assert.equal('shareMode' in sheet.draft(), false, 'no modes on a new transfer');
});

test("Betaalbewijs: a transaction shared with other containers names them after this container's own parts", () => {
  const { sheet } = mount();
  sheet.draft.set(draft(goods));
  sheet.parts.set([part(goods)]);
  sheet.orderPayments.set([goods, inspection]);
  sheet.viaSupplier.set(true);
  sheet.lineShares.set([{ lineId: 610, name: 'PO-2026-039', amountEur: 3801.13 }, { lineId: 610, name: 'Kerst 2026', amountEur: 3801.12 }, { lineId: 999, name: 'PO-2026-041', amountEur: 5 }]);
  assert.equal(plain(sheet.carries(line610)), 'Inspectie € 300,00 (via leverancier), PO-2026-039 € 3.801,13, Kerst 2026 € 3.801,12');
  sheet.orderPayments.set([goods]);
  assert.equal(plain(sheet.carries(line610)), 'PO-2026-039 € 3.801,13, Kerst 2026 € 3.801,12');
  sheet.lineShares.set([]);
  assert.equal(sheet.carries(line610), null);
});
