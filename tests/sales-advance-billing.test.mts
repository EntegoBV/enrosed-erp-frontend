import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { computed, signal } from '@angular/core';
import { parseTemplate } from '@angular/compiler';
import type { SalesAdvanceInvoice, SalesOrderView } from '../src/app/core/api/models.ts';
import {
  advanceBaseExcl, advanceInvoiceBlock, advancePaymentState, advancePreview, advancedExcl, billingKind, billingTag, dayText,
  deductionPaidText, finalInvoiceConfirmLines, finalInvoicePlan, invoiceActionLabel, invoiceConfirmOptions, isAdvanceBillingInvoice, isDeductionLine,
  isFinalBillingInvoice, isRegularQuote, lastReceiptDate, liveAdvances, quoteSettlement, remainingToInvoiceExcl,
} from '../src/app/features/sales/sales-advance-billing.ts';
import { isAdvanceDocument, skipsShipping } from '../src/app/features/sales/sales-payment-state.ts';

const advance = (id: number, amountExclEur: number, changes: Partial<SalesAdvanceInvoice> = {}): SalesAdvanceInvoice => ({
  id, number: `F-2026-0${id}`, status: 'UITGEREIKT', invoiceDate: '2026-04-03', percentage: null, amountExclEur,
  totalInclVatEur: amountExclEur, paidAt: null, receivedEur: 0, remainingEur: amountExclEur, receipts: [], creditedExclEur: 0, ...changes,
});
const quote = (changes: Record<string, unknown> = {}, totals: Record<string, unknown> = {}): SalesOrderView => ({
  order: { id: 41, number: 'OF-2026-041', docType: 'OFFERTE', purpose: 'STANDARD', status: 'GEACCEPTEERD', freight: 'AANGEVULD',
    sourcePurchaseOrderId: 12, partnerPurchaseOrderId: null, archivedAt: null },
  priced: { totals: { total: 30000, vatRatePct: 0, vatLegalMention: 'Exonération de TVA', ...totals } },
  awaitingResend: false, advanceInvoices: [], ...changes,
} as unknown as SalesOrderView);

test('the base is the quote total excl. btw; live advances count, cancelled ones do not', () => {
  const view = quote({ advanceInvoices: [advance(1, 9000), advance(2, 12000, { status: 'CONCEPT' }), advance(3, 500, { status: 'GEANNULEERD' })] });
  assert.equal(advanceBaseExcl(view), 30000);
  assert.deepEqual(liveAdvances(view).map((row) => row.id), [1, 2]);
  assert.equal(advancedExcl(view), 21000);
  assert.equal(remainingToInvoiceExcl(view), 9000);
});

test('30 % of the quote, an amount, VAT on a Belgian quote and the cap', () => {
  const french = quote();
  assert.deepEqual(advancePreview(french, { kind: 'PERCENT', pct: 30 }, '2026-10-15'), {
    exclEur: 9000, vatEur: 0, inclEur: 9000, vatPct: 0, remainingAfterEur: 21000, error: null, request: { percentage: 30, dueDate: '2026-10-15' } });
  const belgian = quote({}, { total: 1000.05, vatRatePct: 21, vatLegalMention: null });
  const third = advancePreview(belgian, { kind: 'PERCENT', pct: 33.3333 });
  assert.equal(third.exclEur, 333.35, '33,3333 % of € 1.000,05 = 333,3497 → half-up 333,35');
  assert.equal(third.vatEur, 70); assert.equal(third.inclEur, 403.35);
  assert.equal(advancePreview(belgian, { kind: 'PERCENT', pct: 50 }).exclEur, 500.03, '500,025 rounds half-up');
  assert.deepEqual(advancePreview(belgian, { kind: 'AMOUNT', amountEur: 250 }, 'no-date').request, { amountEur: 250, dueDate: null });
  const capped = advancePreview(quote({ advanceInvoices: [advance(1, 25000)] }), { kind: 'PERCENT', pct: 30 });
  assert.match(capped.error!, /meer gefactureerd worden dan de offerte \(€ 30\.000,00 excl\. btw\); nog € 5\.000,00 te factureren/);
  assert.equal(capped.request, null);
  assert.match(advancePreview(french, { kind: 'PERCENT', pct: 0 }).error!, /groter dan 0/);
  assert.match(advancePreview(french, { kind: 'PERCENT', pct: 120 }).error!, /hoogstens 100/);
  assert.match(advancePreview(french, { kind: 'AMOUNT', amountEur: 10.001 }).error!, /twee decimalen/);
  assert.match(advancePreview(french, { kind: 'AMOUNT', amountEur: null }).error!, /groter dan € 0,00/);
});

test('only an open regular quote with a known freight gets an advance', () => {
  assert.equal(advanceInvoiceBlock(quote()), null);
  assert.equal(isRegularQuote(quote({ advanceAgreement: { purchaseOrderId: 12 } })), false);
  assert.match(advanceInvoiceBlock(quote({ order: { ...quote().order, freight: 'TE_BEPALEN' } }))!, /Vul eerst de vracht in/);
  assert.match(advanceInvoiceBlock(quote({ invoicedAs: 'F-2026-0120', invoicedAsId: 120 }))!, /al gefactureerd \(F-2026-0120\)/);
  assert.match(advanceInvoiceBlock(quote({ order: { ...quote().order, status: 'AFGEWEZEN' } }))!, /afgesloten/);
  assert.match(advanceInvoiceBlock(quote({ order: { ...quote().order, partnerPurchaseOrderId: 12, purpose: 'PARTNER_ADVANCE' } }))!, /reguliere offerte/);
  assert.match(advanceInvoiceBlock(quote({ fulfillment: { groupId: 'g' } }))!, /gesplitste/);
  assert.match(advanceInvoiceBlock(quote({ advanceInvoices: [advance(1, 30000)] }))!, /volledig gefactureerd/);
});

test('the paid label comes from the receipts: paid on the last date, in part, or open', () => {
  assert.equal(dayText('2026-04-05'), '05/04/2026'); assert.equal(dayText('2026-04-05T22:30:00Z'), '05/04/2026'); assert.equal(dayText(null), '');
  const receipts = [{ receivedOn: '2026-04-12', amountEur: 4000 }, { receivedOn: '2026-04-05', amountEur: 5000 }];
  assert.equal(lastReceiptDate(receipts), '2026-04-12');
  assert.deepEqual(advancePaymentState(advance(1, 9000, { receivedEur: 9000, remainingEur: 0, receipts, status: 'BETAALD' })),
    { label: 'Betaald op 12/04/2026', cls: 'ok', paidOn: '2026-04-12' });
  assert.deepEqual(advancePaymentState(advance(1, 9000, { receivedEur: 5000, remainingEur: 4000, receipts: receipts.slice(1) })),
    { label: 'Deels betaald · € 5.000,00 ontvangen', cls: 'warn', paidOn: null });
  assert.equal(advancePaymentState(advance(1, 9000)).label, 'Open');
  assert.equal(advancePaymentState(advance(1, 9000, { status: 'CONCEPT' })).label, 'Concept · nog niet uitgereikt');
  assert.equal(deductionPaidText({ paidOn: '2026-04-12', receipts }), 'betaald op 12/04/2026');
  assert.equal(deductionPaidText({ paidOn: null, receipts: receipts.slice(1) }), 'deels betaald: € 5.000,00 op 05/04/2026');
  assert.equal(deductionPaidText({ paidOn: null, receipts: [] }), 'nog open');
});

test('the slotfactuur deducts the issued advances, refuses while one is a concept and warns below zero', () => {
  assert.equal(finalInvoicePlan(quote()), null, 'Without advances the quote becomes an ordinary invoice');
  const plan = finalInvoicePlan(quote({ advanceInvoices: [advance(1, 9000, { receivedEur: 9000, remainingEur: 0, status: 'BETAALD', receipts: [{ receivedOn: '2026-04-05', amountEur: 9000 }] }), advance(2, 12000)] }))!;
  assert.equal(plan.blocking, null); assert.equal(plan.deductedExclEur, 21000); assert.equal(plan.balanceExclEur, 9000); assert.equal(plan.negative, false);
  assert.deepEqual(finalInvoiceConfirmLines(quote({ advanceInvoices: plan.advances })), [
    'De slotfactuur neemt de volledige offerte over en trekt deze voorschotfacturen af:',
    'F-2026-01 · € 9.000,00 excl. btw · betaald op 05/04/2026',
    'F-2026-02 · € 12.000,00 excl. btw · open',
    'Saldo € 9.000,00 excl. btw; de btw wordt berekend op het saldo. Er wordt geen e-mail verstuurd.',
  ]);
  const concept = finalInvoicePlan(quote({ advanceInvoices: [advance(1, 9000), advance(2, 12000, { status: 'CONCEPT' })] }))!;
  assert.equal(concept.blocking, 'Reik eerst voorschotfactuur F-2026-02 uit of verwijder ze.');
  assert.equal(finalInvoicePlan(quote({ advanceInvoices: [advance(1, 31000)] }, { total: 30000 }))!.negative, true);
});

test('stage labels and the server-owned deduction lines', () => {
  const advanceView = { order: { docType: 'FACTUUR' }, advanceBilling: { stage: 'ADVANCE', quoteId: 41, quoteNumber: 'OF-2026-041', percentage: 30, amountExclEur: 9000 } } as unknown as SalesOrderView;
  const finalView = { order: { docType: 'FACTUUR' }, advanceBilling: { stage: 'FINAL', quoteId: 41, quoteNumber: 'OF-2026-041', percentage: null, amountExclEur: 21000 } } as unknown as SalesOrderView;
  assert.equal(billingKind(advanceView), 'Voorschotfactuur'); assert.equal(billingKind(finalView), 'Slotfactuur'); assert.equal(billingKind(quote()), null);
  assert.equal(billingTag(advanceView), 'Voorschotfactuur · offerte OF-2026-041');
  assert.equal(billingTag(finalView), 'Slotfactuur · offerte OF-2026-041');
  const deductions = [{ number: 'F-2026-0123' }];
  assert.equal(isDeductionLine('Voorschotfactuur F-2026-0123 van 03/04/2026', deductions), true);
  assert.equal(isDeductionLine('Voorschotfactuur F-2026-0124 van 03/04/2026', deductions), false);
  assert.equal(isDeductionLine('Montage', deductions), false);
  assert.equal(isDeductionLine('Voorschotfactuur F-2026-0123', []), false);
});

test('the card, the sheet and the deductions block have valid templates', async () => {
  for (const file of ['sales-advance-billing-card', 'sales-advance-invoice-sheet', 'sales-advance-deductions']) {
    const source = await readFile(new URL(`../src/app/features/sales/${file}.ts`, import.meta.url), 'utf8');
    const template = /template:\s*`([\s\S]*?)`,\s*\}\)/.exec(source)?.[1];
    assert.ok(template, file);
    assert.equal(parseTemplate(template, `${file}.html`).errors, null, file);
  }
});

test('the slotfactuur deducts each advance minus its issued credit notes and leaves a fully credited one out', () => {
  // € 30.000 quote, advance 50 % = € 15.000 issued, then an issued credit note of € 5.000: € 10.000 off, saldo € 20.000.
  const credited = quote({ advanceInvoices: [advance(1, 15000, { percentage: 50, creditedExclEur: 5000 })] });
  const plan = finalInvoicePlan(credited)!;
  assert.equal(plan.creditsKnown, true);
  assert.equal(plan.deductedExclEur, 10000); assert.equal(plan.balanceExclEur, 20000); assert.equal(plan.negative, false);
  assert.deepEqual(finalInvoiceConfirmLines(credited), [
    'De slotfactuur neemt de volledige offerte over en trekt deze voorschotfacturen af:',
    'F-2026-01 · € 10.000,00 excl. btw na creditnota · open',
    'Saldo € 20.000,00 excl. btw; de btw wordt berekend op het saldo. Er wordt geen e-mail verstuurd.',
  ]);
  // € 18.000 of advances on a € 15.000 quote is below zero until a credit note of € 3.000 is issued on one of them.
  const below = quote({ advanceInvoices: [advance(1, 9000), advance(2, 9000)] }, { total: 15000 });
  assert.equal(finalInvoicePlan(below)!.negative, true);
  const belowConfirm = invoiceConfirmOptions(below, (value) => value);
  assert.ok(!('refused' in belowConfirm)); assert.match(belowConfirm.message, /uitreiken lukt pas na een creditnota op een voorschotfactuur/);
  const corrected = quote({ advanceInvoices: [advance(1, 9000), advance(2, 9000, { creditedExclEur: 3000 })] }, { total: 15000 });
  const correctedPlan = finalInvoicePlan(corrected)!;
  assert.equal(correctedPlan.deductedExclEur, 15000); assert.equal(correctedPlan.balanceExclEur, 0); assert.equal(correctedPlan.negative, false);
  const correctedConfirm = invoiceConfirmOptions(corrected, (value) => value);
  assert.ok(!('refused' in correctedConfirm)); assert.doesNotMatch(correctedConfirm.message, /Let op/);
  // A fully credited advance is skipped, as the server does; null from the server means no credit note.
  const full = quote({ advanceInvoices: [advance(1, 9000, { creditedExclEur: 9000 }), advance(2, 6000, { creditedExclEur: null })] });
  const fullPlan = finalInvoicePlan(full)!;
  assert.equal(fullPlan.creditsKnown, true);
  assert.deepEqual(fullPlan.deductions.map((row) => row.advance.id), [2]);
  assert.equal(fullPlan.deductedExclEur, 6000); assert.equal(fullPlan.balanceExclEur, 24000);
  assert.equal(finalInvoiceConfirmLines(full)[1], 'F-2026-01 · volledig gecrediteerd · wordt niet afgetrokken');
});

test('against an older backend without creditedExclEur the slotfactuur preview reads before credit notes', () => {
  const { creditedExclEur: _unknown, ...legacy } = advance(1, 18000);
  const view = quote({ advanceInvoices: [legacy] }, { total: 15000 });
  const plan = finalInvoicePlan(view)!;
  assert.equal(plan.creditsKnown, false); assert.equal(plan.negative, true);
  assert.equal(finalInvoiceConfirmLines(view).at(-1),
    "Saldo − € 3.000,00 excl. btw vóór creditnota's op de voorschotten; de btw wordt berekend op het saldo. Er wordt geen e-mail verstuurd.");
  const confirm = invoiceConfirmOptions(view, (value) => value);
  assert.ok(!('refused' in confirm));
  assert.match(confirm.message, /vóór creditnota's zijn de voorschotten hoger dan de offerte; zonder creditnota op een voorschotfactuur lukt uitreiken niet/);
  assert.match(advanceInvoiceBlock(quote({ advanceInvoices: undefined }))!, /zodra de server bijgewerkt is/, 'no advance endpoint on an older backend');
});

test('a quote settled by its slotfactuur names it, before the archive', () => {
  const settled = quote({ order: { ...quote().order, archivedAt: '2026-05-01T10:00:00Z' }, invoicedAs: 'F-2026-0120', invoicedAsId: 120,
    invoiceStatus: 'CONCEPT', advanceInvoices: [advance(1, 9000)] });
  assert.equal(advanceInvoiceBlock(settled), 'Deze offerte is al gefactureerd (F-2026-0120).');
  assert.deepEqual(quoteSettlement(settled), { id: 120, number: 'F-2026-0120', state: 'nog in concept' });
  assert.equal(quoteSettlement({ ...settled, invoiceStatus: 'UITGEREIKT' })!.state, 'uitgereikt');
  assert.equal(quoteSettlement({ ...settled, invoiceStatus: 'BETAALD' })!.state, 'betaald');
  assert.equal(quoteSettlement(quote()), null);
});

async function isolate(file: string, className: string, names: string[], globals: Record<string, unknown> = {}) {
  const source = await readFile(new URL(`../src/app/features/sales/${file}.ts`, import.meta.url), 'utf8');
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const cls = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === className); assert.ok(cls);
  const members = cls.members.filter((member) => member.name && names.includes(member.name.getText(parsed))); assert.equal(members.length, names.length, className);
  const selected = ts.factory.updateClassDeclaration(cls, cls.modifiers?.filter((modifier) => !ts.isDecorator(modifier)), cls.name, undefined, undefined, members);
  const js = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [selected])),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: any = {}; vm.runInNewContext(js, { exports, computed, signal, ...globals });
  return exports[className];
}

test('the card waits for the backend that serves it and names the slotfactuur once it exists', async () => {
  const Card = await isolate('sales-advance-billing-card', 'SalesAdvanceBillingCard', ['advances', 'shown', 'remaining', 'plan', 'settled'],
    { liveAdvances, isRegularQuote, remainingToInvoiceExcl, finalInvoicePlan, quoteSettlement });
  const card = (view: SalesOrderView) => Object.assign(new Card(), { view: () => view });
  assert.equal(card(quote({ advanceInvoices: undefined })).shown(), false, 'An older backend has no advance endpoint');
  assert.equal(card(quote()).shown(), true);
  const settled = card(quote({ order: { ...quote().order, archivedAt: '2026-05-01T10:00:00Z' }, invoicedAs: 'F-2026-0120', invoicedAsId: 120,
    invoiceStatus: 'UITGEREIKT', advanceInvoices: [advance(1, 9000)] }));
  assert.equal(settled.shown(), true);
  assert.deepEqual(settled.settled(), { id: 120, number: 'F-2026-0120', state: 'uitgereikt' });
  const source = await readFile(new URL('../src/app/features/sales/sales-advance-billing-card.ts', import.meta.url), 'utf8');
  assert.match(source, /@if \(settled\(\); as s\) \{[\s\S]*?\[routerLink\]="\['\/sales', s\.id\]"[\s\S]*?verrekent deze voorschotfacturen[\s\S]*?\} @else \{/);
  assert.match(source, /\(settled\(\) \? 0 : remaining\(\)\) \| eur/, 'Nothing is left to invoice once the slotfactuur exists');
});

test('a voorschotfactuur is the server\'s in the editor: no products, lines, freight or discount of its own', async () => {
  const Editor = await isolate('sales-editor', 'SalesEditor', ['documentMutationBusy', 'mobileSplitBusy', 'mobileFinanciallyLocked', 'advanceLocked',
    'mobileCommercialEditable', 'canEdit', 'canEditTerms', 'canEditShipping', 'extraLineLocked'], { isAdvanceBillingInvoice, isFinalBillingInvoice, isDeductionLine });
  const concept = (advanceBilling: unknown) => ({ order: { id: 90, docType: 'FACTUUR', purpose: 'STANDARD', status: 'CONCEPT', archivedAt: null,
    extraLines: [{ description: 'Voorschot 30 % · offerte OF-2026-041', quantity: 1, unitPriceEur: 9000 }] }, advanceBilling, advanceDeductions: null });
  const editor = (view: unknown) => Object.assign(new Editor(), { view: () => view, advanceAgreement: () => null });
  const advanceEditor = editor(concept({ stage: 'ADVANCE', quoteId: 41, quoteNumber: 'OF-2026-041', percentage: 30, amountExclEur: 9000 }));
  assert.equal(advanceEditor.canEdit(), true, 'Notes and due date stay editable on the concept');
  assert.equal(advanceEditor.advanceLocked(), true);
  assert.equal(advanceEditor.mobileCommercialEditable(), false, 'No products, lines or discount');
  assert.equal(advanceEditor.canEditShipping(), false, 'No freight of its own');
  assert.equal(advanceEditor.extraLineLocked(advanceEditor.view().order.extraLines[0]), true);
  const ordinary = editor(concept(null));
  assert.equal(ordinary.advanceLocked(), false); assert.equal(ordinary.mobileCommercialEditable(), true); assert.equal(ordinary.canEditShipping(), true);
  assert.equal(ordinary.extraLineLocked(ordinary.view().order.extraLines[0]), false);
  const editorSource = await readFile(new URL('../src/app/features/sales/sales-editor.ts', import.meta.url), 'utf8');
  const deskSource = await readFile(new URL('../src/app/features/sales/sales-desk.ts', import.meta.url), 'utf8');
  assert.match(deskSource, /readonly commercialEditable = computed\(\(\) => this\.canEdit\(\) && !this\.financiallyLocked\(\) && !this\.advanceLocked\(\)\);/);
  for (const source of [editorSource, deskSource]) {
    assert.match(source, /isCreditNoteDoc\(\) \|\| advanceLocked\(\)" \[ngModel\]="data\.order\.customerId"/, 'The customer follows the quote');
    assert.match(source, /advanceLockNote/);
  }
});

test('a voorschotfactuur skips the shipping step: issue, send, receipts', async () => {
  const invoice = (advanceBilling: unknown, changes: Record<string, unknown> = {}) => ({
    order: { id: 90, docType: 'FACTUUR', purpose: 'STANDARD', status: 'UITGEREIKT', goodsShippedAt: null, partnerPurchaseOrderId: null, ...changes },
    advanceBilling, priced: { totals: { totalInclVat: 9000 } }, creditedEur: 0 } as unknown as SalesOrderView);
  const regular = invoice({ stage: 'ADVANCE', quoteId: 41, quoteNumber: 'OF-2026-041', percentage: 30, amountExclEur: 9000 });
  const slot = invoice({ stage: 'FINAL', quoteId: 41, quoteNumber: 'OF-2026-041', percentage: null, amountExclEur: 9000 });
  assert.equal(isAdvanceBillingInvoice(regular), true);
  assert.equal(skipsShipping(regular), true);
  assert.equal(skipsShipping(invoice(null, { purpose: 'PARTNER_ADVANCE', partnerPurchaseOrderId: 45 })), true);
  assert.equal(skipsShipping(slot), false, 'The slotfactuur carries the goods');
  assert.equal(skipsShipping(invoice(null)), false);

  const View = await isolate('sales-view', 'SalesView', ['skipsShipping', 'hasStatusAction', 'nextStepTitle', 'nextStepHelp'],
    { skipsShipping, salesAllProductsUnavailable: () => false, advanceAgreementFor: () => null, invoiceActionLabel, liveAdvances });
  const phone = Object.assign(new View(), { pendingRevision: () => null, creditStep: () => null });
  assert.equal(phone.nextStepTitle(regular), 'Betaling registreren');
  assert.equal(phone.nextStepHelp(regular), 'Leg de betaling vast zodra het bedrag ontvangen is.');
  assert.equal(phone.nextStepTitle(slot), 'Bestelling verzenden');
  const paid = invoice({ stage: 'ADVANCE', quoteId: 41, quoteNumber: 'OF-2026-041', percentage: 30, amountExclEur: 9000 }, { status: 'BETAALD' });
  assert.equal(phone.hasStatusAction(paid), false); assert.equal(phone.nextStepHelp(paid), 'Factuur en betaling zijn verwerkt.');
  // The accepted quote's next step says slotfactuur once it has advances.
  assert.equal(phone.nextStepTitle(quote({ advanceInvoices: [advance(1, 9000)] })), 'Slotfactuur maken');
  assert.match(phone.nextStepHelp(quote({ advanceInvoices: [advance(1, 9000)] })), /trekt de uitgereikte voorschotfacturen af/);
  assert.equal(phone.nextStepTitle(quote()), 'Factuur maken');

  const Desk = await isolate('sales-desk', 'SalesDesk', ['invoiceNextStep']);
  const desk = Object.assign(new Desk(), { skipsShipping });
  assert.equal(desk.invoiceNextStep(regular), 'Betaling registreren');
  assert.equal(desk.invoiceNextStep(slot), 'Bestelling verzenden');

  const List = await isolate('sales-list', 'SalesList', ['todo'], { isAdvanceDocument, actionNeeded: () => null });
  const list = Object.assign(new List(), { overdue: () => false });
  assert.equal(list.todo(regular.order, false, false, isAdvanceBillingInvoice(regular)), null, 'Nothing to ship on a voorschotfactuur');
  assert.equal(list.todo(slot.order, false, false, isAdvanceBillingInvoice(slot)), 'Bestelling nog te verzenden');
  const listSource = await readFile(new URL('../src/app/features/sales/sales-list.ts', import.meta.url), 'utf8');
  assert.match(listSource, /this\.todo\(row\.order, row\.awaitingResend, fullyCredited, isAdvanceBillingInvoice\(row\)\)/);

  const viewSource = await readFile(new URL('../src/app/features/sales/sales-view.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(viewSource, /!isAdvance\(data\.order\) && !data\.order\.goodsShippedAt/, 'Every shipping step asks skipsShipping');
  assert.match(viewSource, /openPdfSheet\(skipsShipping\(data\) \? 'DOCUMENT' : 'PACKING_SLIP'\)/);
});
