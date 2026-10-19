import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { computed, signal } from '@angular/core';
import type { BankStatementLine } from '../src/app/core/api/banking-api.ts';
import type { PurchasePaymentRow } from '../src/app/core/api/models.ts';
import { changePreview } from '../src/app/features/finance/bank-change-preview.ts';
import type { LinkTarget } from '../src/app/features/finance/bank-change-preview.ts';
import { runLink } from '../src/app/features/finance/bank-link-actions.ts';
import type { LinkApis, LinkChoice } from '../src/app/features/finance/bank-link-actions.ts';
import { feeContainers, feeText, filterFeeContainers, lineSuggestions } from '../src/app/features/finance/bank-suggestions.ts';
import type { FeeContainer, SuggestionInput } from '../src/app/features/finance/bank-suggestions.ts';
import { FEE_LABEL, feeFits, feePaymentPart, feeSharePart, goodsAfterFee } from '../src/app/features/finance/transaction-fees.ts';
import { linkChange } from '../src/app/features/purchasing/purchase-payment-links.ts';
import { containerName } from '../src/app/features/purchasing/container-name.ts';

/*
 * Transactiekosten (Emre, 2026-10-19): the bank's charge on a Chinese
 * transfer is a cost of the container (a Bijkomende kosten payment, payee
 * OTHER, EUR, no term), never a company cost. On a line of its own (Boeken
 * als › Bankkosten › Bij een container…, or the suggestion), inside a new
 * term's debit ('Waarvan transactiekosten'), or as the rest of a debit larger
 * than an open payment (bank-part's FEE / feeEur, backend B2).
 */

const plain = (text: string | null | undefined): string => (text ?? '').replace(/[  ]/g, ' ');
const json = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

function line(id: number, amountEur: number, values: Partial<BankStatementLine> = {}): BankStatementLine {
  return { id, account: 'BE94731074082814', fingerprint: `f${id}`, amountEur, bookedAt: '2026-10-13T10:00:00Z', timeZone: 'Europe/Brussels',
    reference: '', counterparty: '', recordedAt: '2026-10-14T06:00:00Z', actor: 'odoo', salesPaymentId: null, salesOrderId: null, allocatedAt: null,
    allocationCreatedPayment: false, source: 'ODOO', allocated: false, ...values };
}
function payment(id: number, values: Partial<PurchasePaymentRow> = {}): PurchasePaymentRow {
  return { id, orderId: 39, orderNumber: 'PO-2026-005', orderAlias: null, paidOn: '2026-10-13', amountEur: 20289.56, label: '40%', payee: 'SUPPLIER',
    bankStatementLineId: null, amount: 20289.56, currency: 'EUR', instalmentDue: 'ORDERED', ...values };
}

test('the fee is a Bijkomende kosten payment in euro, without a term, settling nothing, in both calls', () => {
  assert.deepEqual(json(feePaymentPart('2026-10-14', -25.4)), { paidOn: '2026-10-14', amount: 25.4, currency: 'EUR', amountEur: null, label: 'Transactiekosten',
    payee: 'OTHER', instalmentDue: null, settles: false });
  assert.deepEqual(json(feePaymentPart('2026-10-14', 25.4, 39)), { ...(json(feePaymentPart('2026-10-14', 25.4)) as object), purchaseOrderId: 39 }, 'its own container in a split');
  assert.deepEqual(json(feeSharePart(39, 25.4)), { purchaseOrderId: 39, amountEur: 25.4, payee: 'OTHER', instalmentDue: null, label: FEE_LABEL, settles: false });
});

test('a new term with its fee: the goods take the rest (euro), or the transaction\'s euro less the fee (USD/CNY)', () => {
  assert.deepEqual(goodsAfterFee(10300, 'EUR', -10300, 25), { amount: 10275, amountEur: null });
  assert.deepEqual(goodsAfterFee(12000, 'USD', -10325, 25), { amount: 12000, amountEur: 10300 });
  assert.deepEqual(goodsAfterFee(10300, 'EUR', -10300, null), { amount: 10300, amountEur: null }, 'no fee: as before');
  assert.deepEqual(goodsAfterFee(12000, 'USD', -10325, null), { amount: 12000, amountEur: 10325 });
  assert.equal(feeFits(25, 10300), true);
  assert.equal(feeFits(10300, 10300), false, 'never the whole transaction');
  assert.equal(feeFits(0, 10300), false);
  assert.equal(feeFits(null, 10300), false);
});

/* ---- bank-part (B2): FEE for a euro payment, feeEur for USD/CNY, and "Betaling houden" */

const eurPayment: LinkTarget = { kind: 'purchase-existing', orderId: 39, paymentId: 4, title: 'Inkoop · PO-2026-005 · 40%', amountEur: 20289.56, paidOn: '2026-08-24',
  currency: 'EUR', amount: 20289.56, account: null, proofCount: 0, hasInspectionAfspraak: false, groupSize: 1 };
const usdPayment: LinkTarget = { ...eurPayment, currency: 'USD', amount: 23000, amountEur: 20000 };
const fees = { amountEur: -20314.96, day: '2026-10-14', accountLabel: 'KBC' };

function apis() {
  const calls: unknown[][] = [];
  const sourcing = {
    linkPaymentPart: async (...args: unknown[]) => { calls.push(['linkPaymentPart', ...json(args) as unknown[]]); return { payments: [], lines: [line(120, -20314.96)], notice: null }; },
  };
  const banking = { linkPayments: async (...args: unknown[]) => { calls.push(['linkPayments', ...json(args) as unknown[]]); return line(120, -20314.96); } };
  return { calls, apis: { banking, sourcing, finance: {} } as unknown as LinkApis };
}
const choice = (over: Partial<LinkChoice> = {}): LinkChoice => ({ follow: true, keepAs: 'TRANSACTIEKOSTEN', surplus: 'ADJUST', cashRound: true, ...over });

test("'Rest als transactiekosten' sends FEE; a USD payment's fee goes as feeEur; 'Betaling houden' takes the same call, never a company cost", async () => {
  const row = line(120, -20314.96);
  const rest = apis(); await runLink(rest.apis, row, eurPayment, choice({ surplus: 'FEE' }));
  assert.deepEqual(rest.calls, [['linkPaymentPart', 4, 120, null, { higher: 'FEE', withPaymentIds: [] }]]);
  const usd = apis(); await runLink(usd.apis, row, usdPayment, choice({ feeEur: 25.4 }));
  assert.deepEqual(usd.calls, [['linkPaymentPart', 4, 120, null, { higher: null, withPaymentIds: [], feeEur: 25.4 }]]);
  const keepEur = apis(); await runLink(keepEur.apis, row, eurPayment, choice({ follow: false }));
  assert.deepEqual(keepEur.calls, [['linkPaymentPart', 4, 120, null, { higher: 'FEE', withPaymentIds: [] }]], 'kept: bank-part with FEE, not /links with Bankkosten');
  const keepUsd = apis(); await runLink(keepUsd.apis, row, usdPayment, choice({ follow: false }));
  assert.deepEqual(keepUsd.calls, [['linkPaymentPart', 4, 120, null, { higher: null, withPaymentIds: [], feeEur: 314.96 }]], 'its euro stays, the difference is the fee');
  const rate = apis(); await runLink(rate.apis, row, usdPayment, choice({ follow: false, keepAs: 'KOERSVERSCHIL' }));
  assert.deepEqual(rate.calls, [['linkPayments', 120, { purchasePaymentIds: [4], keepDifferenceAs: 'KOERSVERSCHIL' }]], 'Koersverschil stays as it is');
});

test("'Wat verandert' says where the fee goes: the payment keeps its amount, or its euro is the rest", () => {
  const rows = (preview: ReturnType<typeof changePreview>) => preview.rows.map((item) => [item.label, plain(item.now), plain(item.after)]);
  const rest = changePreview(eurPayment, fees, true, 'TRANSACTIEKOSTEN', 'FEE');
  assert.deepEqual(rows(rest).filter(([label]) => label === 'Bedrag' || label === 'Transactiekosten'),
    [['Bedrag', '€ 20.289,56', '€ 20.289,56'], ['Transactiekosten', '—', '€ 25,40 op dezelfde transactie']]);
  const usd = changePreview(usdPayment, fees, true, 'TRANSACTIEKOSTEN', 'ADJUST', 25.4);
  assert.deepEqual(rows(usd).filter(([label]) => label === 'Bedrag' || label === 'Transactiekosten'),
    [['Bedrag', '€ 20.000,00', '€ 20.289,56'], ['Transactiekosten', '—', '€ 25,40 op dezelfde transactie']]);
  assert.equal(rows(changePreview(usdPayment, fees, true, 'TRANSACTIEKOSTEN', 'ADJUST', 20314.96)).some(([label]) => label === 'Transactiekosten'), false, 'never the whole line');
  const kept = changePreview(eurPayment, fees, false, 'TRANSACTIEKOSTEN');
  assert.deepEqual(rows(kept).slice(0, 2), [['Bedrag', '€ 20.289,56', '€ 20.289,56'], ['Betaald op', '24 aug', '14 okt']], 'bank-part links it: the day follows');
  assert.equal(plain(kept.notice), 'Gekoppeld aan Inkoop · PO-2026-005 · 40%. Verschil € 25,40 als transactiekosten bij de container.');
  assert.equal(kept.primaryLabel, 'Koppelen en verschil boeken');
});

test("Al genoteerd › one payment: 'Rest als transactiekosten' and a USD payment's fee in its 'Wat verandert'", () => {
  const subject = { amount: 20289.56, currency: 'EUR' as const, amountEur: 20289.56, paidOn: '2026-08-24', proof: 'geen' };
  const bank = { amountEur: -20314.96, day: '2026-10-14', text: 'KBC' };
  assert.deepEqual(linkChange(subject, bank, { kind: 'part', lineId: 120, whole: true, surplus: 'FEE' }).map((row) => [row.label, plain(row.after)]),
    [['Bedrag', '€ 20.289,56'], ['Betaald op', '14/10/2026'], ['Transactiekosten', '€ 25,40 op dezelfde transactie'], ['Bewijs', 'KBC']]);
  const usd = linkChange({ ...subject, amount: 23000, currency: 'USD', amountEur: 20000 }, bank, { kind: 'part', lineId: 120, whole: true }, 0, 25.4);
  assert.deepEqual(usd.map((row) => [row.label, plain(row.after)]).filter(([label]) => label !== 'Koers'),
    [['Bedrag', 'US$ 23.000,00 · € 20.289,56'], ['Betaald op', '14/10/2026'], ['Transactiekosten', '€ 25,40 op dezelfde transactie'], ['Bewijs', 'KBC']]);
  assert.equal(linkChange({ ...subject }, bank, { kind: 'part', lineId: 120, whole: true, surplus: 'ADJUST' }, 0, 25.4).some((row) => row.label === 'Transactiekosten'), false,
    'a euro payment takes FEE, never feeEur');
});

/* ---- a fee on a line of its own: the suggestion and Boeken als › Bij een container… */

const goods = line(110, -20289.56, { counterparty: 'Yunnan Pubei Agricultural Science A', allocated: true, bookedAt: '2026-10-12T09:00:00Z' });
const supplierPayment = payment(4, { bankStatementLineId: 110 });
function input(lines: BankStatementLine[], values: Partial<SuggestionInput> = {}): SuggestionInput {
  return { lines, targets: () => [], costs: [], sales: [], containers: [], purchasePayments: [supplierPayment], customerName: () => '', costPaymentsLinkedLines: [],
    lineDay: (row) => row.bookedAt.slice(0, 10), today: '2026-10-15', supplierOf: () => 'Yunnan Pubei', ...values };
}

test('a small charge near a supplier transfer on the same account: "Transactiekosten · PO-… (supplier)", never exact', () => {
  const fee = line(111, -25.4, { counterparty: 'KBC', reference: 'Kosten buitenlandse betaling OUR', bookedAt: '2026-10-14T09:00:00Z' });
  const suggestion = lineSuggestions(input([goods, fee])).get(111)!;
  assert.deepEqual(json(suggestion.target), { kind: 'container-fee', orderId: 39, label: 'Transactiekosten · PO-2026-005 (Yunnan Pubei)' });
  assert.equal(suggestion.exact, false);
  // Not: another account, more than three days, no charge words, too large, money in.
  assert.equal(lineSuggestions(input([goods, { ...fee, account: 'BE00 WISE' }])).get(111), undefined);
  assert.equal(lineSuggestions(input([goods, { ...fee, bookedAt: '2026-10-16T09:00:00Z' }])).get(111), undefined);
  assert.equal(lineSuggestions(input([goods, { ...fee, reference: 'Overschrijving' }])).get(111), undefined);
  assert.equal(lineSuggestions(input([goods, { ...fee, amountEur: -250 }])).get(111), undefined);
  assert.equal(lineSuggestions(input([goods, { ...fee, amountEur: 25.4 }])).get(111), undefined);
  // An alias reads as the container's name; one account under two keys is one account.
  const named = lineSuggestions(input([goods, { ...fee, account: 'kbc' }], { purchasePayments: [{ ...supplierPayment, orderAlias: 'Culinan' }], accountKey: () => 'KBC' })).get(111)!;
  assert.equal((named.target as { label: string }).label, 'Transactiekosten · Culinan (Yunnan Pubei)');
});

test('the charge words: kosten, fee, charge, commission, SWIFT, OUR, SHA, frais, Gebühr; never inside another word', () => {
  for (const reference of ['Transactiekosten', 'Kosten buitenlandse betaling', 'Overschrijvingskosten', 'SWIFT fee', 'Charges', 'Commission', 'OUR', 'sha', 'Frais de transfert', 'Gebühr']) {
    assert.equal(feeText({ counterparty: '', reference }), true, reference);
  }
  // Review 2026-10-20: every '…kosten' made the account's own charges a container's Transactiekosten.
  for (const reference of ['Four seasons', 'Shanghai', 'Coffee', 'PO-2026-005', 'Beheerskosten zichtrekening', 'Verzendkosten']) assert.equal(feeText({ counterparty: '', reference }), false, reference);
});

test('a charge that went to company costs twice stays a cost pattern beside a supplier transfer', () => {
  const charge = (id: number, day: string) => line(id, -9.95, { counterparty: 'KBC', reference: 'Kosten zichtrekening', allocated: true, bookedAt: `${day}T09:00:00Z` });
  const fee = line(111, -9.95, { counterparty: 'KBC', reference: 'Kosten zichtrekening', bookedAt: '2026-10-14T09:00:00Z' });
  const linked = [{ lineId: 101, costId: 7, category: 'BANKKOSTEN', party: 'KBC', description: 'Kosten zichtrekening', date: '2026-08-14' },
    { lineId: 102, costId: 8, category: 'BANKKOSTEN', party: 'KBC', description: 'Kosten zichtrekening', date: '2026-09-14' }];
  const suggestion = lineSuggestions(input([goods, charge(101, '2026-08-14'), charge(102, '2026-09-14'), fee], { costPaymentsLinkedLines: linked })).get(111)!;
  assert.equal(suggestion.target.kind, 'cost-pattern');
  assert.equal(lineSuggestions(input([goods, fee])).get(111)?.target.kind, 'container-fee', 'without that history: the container');
});

test('Bij een container…: the supplier transfers within five days of this line first, then the counterparty, then by PO; the search', () => {
  const containers: FeeContainer[] = [
    { orderId: 37, number: 'PO-2026-003', alias: null, supplier: 'Dongguan Plastics' },
    { orderId: 39, number: 'PO-2026-005', alias: 'Culinan', supplier: 'Yunnan Pubei' },
    { orderId: 48, number: 'PO-2026-014', alias: null, supplier: 'Kunming Flowers' },
    { orderId: 40, number: 'PO-2026-006', alias: null, supplier: 'Yunnan Pubei' },
  ];
  const other = line(112, -9000, { counterparty: 'Kunming Flowers', allocated: true, bookedAt: '2026-09-01T09:00:00Z' });
  const fee = line(113, -18, { counterparty: 'Kunming Flowers', reference: 'fee', bookedAt: '2026-10-16T09:00:00Z' });
  const payments = [supplierPayment, payment(5, { orderId: 48, orderNumber: 'PO-2026-014', bankStatementLineId: 112 })];
  const ranked = feeContainers(fee, containers, [goods, other, fee], payments, (row) => row.bookedAt.slice(0, 10));
  assert.deepEqual(ranked.map((row) => [row.number, row.near, row.party]), [
    ['PO-2026-005', 'betaling 4 dagen ernaast', false], ['PO-2026-014', null, true], ['PO-2026-006', null, false], ['PO-2026-003', null, false]]);
  assert.deepEqual(filterFeeContainers(ranked, 'culinan').map((row) => row.orderId), [39]);
  assert.deepEqual(filterFeeContainers(ranked, 'yunnan').map((row) => row.orderId), [39, 40]);
  assert.deepEqual(filterFeeContainers(ranked, '014').map((row) => row.orderId), [48]);
});

/* ---- FinanceState.bookContainerFee and Boeken als (the real members, services replaced) */

async function selectedClass(path: string, name: string, names: string[], globals: Record<string, unknown>) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const cls = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === name)!;
  const members = cls.members.filter((member) => member.name && names.includes(member.name.getText(parsed)));
  assert.equal(members.length, names.length);
  const isolated = ts.factory.updateClassDeclaration(cls, cls.modifiers?.filter((m) => !ts.isDecorator(m)), cls.name, undefined, undefined, members);
  const code = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [isolated])), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports: any = {};
  vm.runInNewContext(code, { exports, signal, computed, ...globals });
  return exports[name];
}
const formatEuro = (value: number): string => new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' }).format(value);
const messageOf = (error: any, fallback: string) => error?.message || fallback;

test('a fee booked at a container: one OTHER payment on the line via …/purchase-payment, a toast with Ongedaan maken, never a cost', async () => {
  const State = await selectedClass('../src/app/features/finance/finance-state.ts', 'FinanceState', ['bookContainerFee'], { containerName, feePaymentPart, formatEuro, messageOf });
  const state = new State();
  const calls: unknown[] = [], toasts: { message: string; tone?: string; undo: boolean }[] = [];
  const fee = line(113, -25.4);
  Object.assign(state, {
    linking: signal<number | null>(null), bankStatements: signal([fee]),
    purchaseViews: () => [{ order: { id: 39, number: 'PO-2026-005', alias: null } }],
    lineDay: () => '2026-10-14', refreshBank: async () => {}, reload: async (sources: string[]) => calls.push(['reload', json(sources)]), flash: () => {}, undoContainers: async () => {},
    banking: { addPurchasePayment: async (...args: unknown[]) => { calls.push(['addPurchasePayment', ...json(args) as unknown[]]); return { line: { ...fee, allocated: true }, payments: [{ id: 9, orderId: 39 }] }; } },
    ui: { toast: (message: string, tone?: string, action?: unknown) => toasts.push({ message: plain(message), tone, undo: !!action }) },
  });
  assert.equal(await state.bookContainerFee(fee, 39), '');
  assert.deepEqual(calls, [['addPurchasePayment', 113, 39, [{ paidOn: '2026-10-14', amount: 25.4, currency: 'EUR', amountEur: null, label: 'Transactiekosten', payee: 'OTHER',
    instalmentDue: null, settles: false }]], ['reload', ['costs', 'payments', 'containers']]]);
  assert.deepEqual(toasts, [{ message: 'Transactiekosten € 25,40 bij PO-2026-005 (Bijkomende kosten)', tone: 'ok', undo: true }]);
  assert.equal(state.bankStatements()[0].allocated, true);
  assert.equal(state.linking(), null);
  // A refusal comes back (Boeken als shows it in the sheet), no toast then.
  state.banking.addPurchasePayment = async () => { throw new Error('Deze transactie is al gekoppeld.'); };
  assert.equal(await state.bookContainerFee(fee, 39, false), 'Deze transactie is al gekoppeld.');
  assert.equal(toasts.length, 1);
});

test("Splitsen on one container: 'Gekoppeld aan PO-… (n delen).' only with several parts", async () => {
  // Review 2026-10-20: one ticked term read '(1 delen)'.
  const State = await selectedClass('../src/app/features/finance/finance-state.ts', 'FinanceState', ['linkContainers'], { messageOf, SERVER_PENDING: 'pending' });
  const toasts: string[] = [];
  const goodsLine = line(120, -3070.2);
  const state = new State();
  Object.assign(state, {
    cashRound: () => true, linking: signal<number | null>(null), bankStatements: signal([goodsLine]), refreshBank: async () => {}, reload: async () => {}, undoContainers: async () => {},
    banking: { addPurchasePayment: async () => ({ line: { ...goodsLine, allocated: true }, payments: [] }) },
    ui: { toast: (message: string) => toasts.push(message) },
  });
  const part = { purchaseOrderId: 39, paidOn: '2026-10-14', amount: 3070.2, currency: 'EUR', amountEur: null, label: '30%', payee: 'SUPPLIER', instalmentDue: 'ORDERED', settles: false };
  assert.equal(await state.linkContainers(goodsLine, [part], ['PO-2026-005']), '');
  assert.equal(await state.linkContainers(goodsLine, [part, feePaymentPart('2026-10-14', 25, 39)], ['PO-2026-005']), '');
  assert.equal(await state.linkContainers(goodsLine, [part, { ...part, purchaseOrderId: 40 }], ['PO-2026-005', 'PO-2026-006']), '');
  assert.deepEqual(toasts, ['Gekoppeld aan PO-2026-005.', 'Gekoppeld aan PO-2026-005 (2 delen).', 'Gekoppeld aan 2 containers (PO-2026-005, PO-2026-006).']);
});

test('Boeken als › Bankkosten: "Algemene bankkost" stays a cost; "Bij een container…" starts on the nearest transfer and books it there', async () => {
  const source = await readFile(new URL('../src/app/features/finance/book-as-sheet.ts', import.meta.url), 'utf8');
  const template = source.slice(source.indexOf('template: `'), source.indexOf('`,\n})'));
  assert.match(template, />Algemene bankkost<\/label>/);
  assert.match(template, />Bij een container…<\/label>/);
  assert.match(template, /\{\{ containerSub\(container\) \}\}/, 'the supplier on every row');
  const Sheet = await selectedClass('../src/app/features/finance/book-as-sheet.ts', 'BookAsSheet',
    ['line', 'choice', 'note', 'period', 'busy', 'error', 'feeWhere', 'feeOrder', 'feeQuery', 'feeRanked', 'feeShown', 'ready', 'chooseContainerFee', 'containerSub', 'book'],
    { feeContainers, filterFeeContainers });
  const fee = line(113, -25.4, { reference: 'Kosten', bookedAt: '2026-10-14T09:00:00Z' });
  const booked: unknown[] = [], costs: unknown[] = [];
  const bookAsLine = signal<BankStatementLine | null>(fee);
  const state = {
    bookAsLine, bankStatements: () => [goods, fee], payments: () => [supplierPayment], lineDay: (row: BankStatementLine) => row.bookedAt.slice(0, 10), canonicalAccount: (key: string) => key,
    suppliers: () => [{ id: 8, name: 'Yunnan Pubei' }],
    purchaseViews: () => [{ order: { id: 37, number: 'PO-2026-003', status: 'CONCEPT', supplierId: 8 } }, { order: { id: 39, number: 'PO-2026-005', status: 'ONTVANGEN', supplierId: 8 } },
      { order: { id: 41, number: 'PO-2026-007', status: 'BESTELD', supplierId: 8, archivedAt: '2026-10-01' } }, { order: { id: 48, number: 'PO-2026-014', status: 'BESTELD', supplierId: 9 } }],
    bookContainerFee: async (row: BankStatementLine, orderId: number) => { booked.push([row.id, orderId]); return ''; },
    openCostFromBank: (...args: unknown[]) => costs.push(args),
  };
  // The injected FinanceState: the computed fields read it through `this.state`.
  Object.defineProperty(Sheet.prototype, 'state', { get: () => state, configurable: true });
  const sheet = new Sheet();
  assert.deepEqual(sheet.feeRanked().map((row: any) => [row.number, row.supplier, row.near]), [['PO-2026-005', 'Yunnan Pubei', 'betaling 2 dagen ernaast'], ['PO-2026-014', '', null]],
    'no concept, no archived container');
  sheet.choice.set('BANKKOSTEN');
  assert.equal(sheet.ready(), true, 'Algemene bankkost: as today');
  sheet.chooseContainerFee();
  assert.equal(sheet.feeOrder(), 39, 'the nearest supplier transfer starts chosen');
  assert.equal(plain(sheet.containerSub(sheet.feeRanked()[1])), 'Leverancier onbekend');
  await sheet.book(fee);
  assert.deepEqual(booked, [[113, 39]]);
  assert.deepEqual(costs, [], 'never a company cost as well');
  assert.equal(bookAsLine(), null, 'the sheet closes');
});

test('Inkoop: "Aan wie? Bijkomend" offers a Transactiekosten chip that fills the label', async () => {
  const source = await readFile(new URL('../src/app/features/purchasing/purchase-payment-sheet.ts', import.meta.url), 'utf8');
  const chip = source.slice(source.indexOf("@if (pay.payee === 'OTHER' && !creditOffset()) {"), source.indexOf('Transactiekosten</button>') + 25);
  assert.match(chip, /\(click\)="patch\.emit\(\{ label: 'Transactiekosten' \}\)">Transactiekosten<\/button>/);
  assert.match(chip, /\[attr\.aria-pressed\]="pay\.label === 'Transactiekosten'"/);
});
