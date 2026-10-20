import assert from 'node:assert/strict';
import test from 'node:test';
import type { BankStatementLine } from '../src/app/core/api/banking-api.ts';
import type { CompanyCost, PurchasePaymentRow, SalesOrderView } from '../src/app/core/api/models.ts';
import { bankAllocationTargets } from '../src/app/features/finance/bank-allocation-targets.ts';
import {
  bankSearchMatches, cancellationCandidates, legDistance, lineStatus, lineSuggestions, searchAmount, selectionTotals, transferCandidates, vatPeriodLabel, vatPeriods,
} from '../src/app/features/finance/bank-suggestions.ts';
import type { SuggestionInput } from '../src/app/features/finance/bank-suggestions.ts';
import type { ContainerPayable } from '../src/app/features/finance/payables.ts';
import { containerName } from '../src/app/features/purchasing/container-name.ts';

function line(id: number, amountEur: number, values: Partial<BankStatementLine> = {}): BankStatementLine {
  return { id, account: 'BE94731074082814', fingerprint: `f${id}`, amountEur, bookedAt: '2026-10-13T22:00:00Z', timeZone: 'Europe/Brussels',
    reference: '', counterparty: '', recordedAt: '2026-10-14T06:00:00Z', actor: 'odoo', salesPaymentId: null, salesOrderId: null, allocatedAt: null,
    allocationCreatedPayment: false, source: 'ODOO', allocated: false, ...values };
}
function cost(id: number, values: Partial<CompanyCost> = {}): CompanyCost {
  return { id, date: '2026-10-01', category: 'ANDERE', description: `Kost ${id}`, party: null, amountExclEur: 100, amountInclEur: 121, vatPct: 21, reference: null,
    paidOn: null, salesChannel: null, notes: null, recurringCostId: null, payments: [], openEur: 121, paidEur: 0, cashTotalEur: 121, ...values } as CompanyCost;
}
const term: ContainerPayable = { key: 'container:43:SUPPLIER:ORDERED', orderId: 43, orderNumber: 'PO-2026-043', alias: null, status: 'BESTELD', archived: false,
  payee: 'SUPPLIER', termLabel: '30% bij bestelling', due: 'ORDERED', plannedEur: 9000, paidEur: 0, remainingEur: 9000, bucket: 'now', whenLabel: 'nu',
  invoiceNumber: 'CI-YP-2026-118', viaSupplier: false };
function payment(id: number, values: Partial<PurchasePaymentRow> = {}): PurchasePaymentRow {
  return { id, orderId: 31, orderNumber: 'PO-2026-031', orderAlias: null, paidOn: '2026-10-13', amountEur: 12480, label: '2e termijn', payee: 'SUPPLIER',
    bankStatementLineId: null, amount: 14560, currency: 'USD', instalmentDue: 'SHIPPED', ...values };
}
function input(values: Partial<SuggestionInput>): SuggestionInput {
  const base: SuggestionInput = { lines: [], targets: () => [], costs: [], sales: [], containers: [], purchasePayments: [], customerName: () => '', costPaymentsLinkedLines: [],
    lineDay: (row) => row.bookedAt.slice(0, 10) === '2026-10-13' ? '2026-10-14' : row.bookedAt.slice(0, 10), today: '2026-10-15' };
  const merged = { ...base, ...values };
  return { ...merged, targets: values.targets ?? ((row) => bankAllocationTargets(row.amountEur, merged.costs, merged.sales, merged.containers, merged.customerName,
    (item) => item.cashTotalEur ?? 0, (item) => item.openEur ?? 0, () => ({ party: 'Yunnan Pubei Flowers Co., Ltd', date: '2026-10-10' }))) };
}

test('a container term with the PO and the supplier in the bank text: suggested, exact, with its reasons', () => {
  const deposit = line(103, -9000, { counterparty: 'Yunnan Pubei Flowers Co., Ltd', reference: 'PO-2026-043 DEPOSIT 30PCT' });
  const result = lineSuggestions(input({ lines: [deposit], containers: [term] })).get(103)!;
  assert.equal(result.target.kind, 'term-new');
  assert.deepEqual(result.reasons, ['bedrag exact', 'PO in mededeling', 'naam bekend', 'nog open']);
  assert.equal(result.score, 100);
  assert.deepEqual([result.amountMatches, result.exact, result.changesAmount], [true, true, false]);
  assert.equal(lineStatus(deposit, result), 'SUGGESTED');
});

test('the invoice number and the cost reference count 30 each; an amount alone is no suggestion', () => {
  const brochure = cost(12, { party: 'Vandersanden Drukwerk', reference: 'VD-2026-188', amountInclEur: 423.5, cashTotalEur: 423.5, openEur: 423.5 });
  const byReference = line(1, -423.5, { reference: 'Factuur VD 2026 188' });
  const bare = line(2, -423.5, { reference: 'Overschrijving' });
  const map = lineSuggestions(input({ lines: [byReference, bare], costs: [brochure] }));
  assert.deepEqual(map.get(1)?.reasons, ['bedrag exact', 'referentie in mededeling', 'nog open']);
  assert.equal(map.get(1)?.score, 80);
  assert.equal(map.get(2), undefined, '40 + 10 stays under 70');
  assert.equal(lineStatus(bare, undefined), 'OPEN');
  const sales = { order: { id: 420, number: 'F2026-0420', docType: 'FACTUUR', status: 'UITGEREIKT', customerId: 7, orderDate: '2026-09-21' },
    priced: { totals: { totalInclVat: 4235 } }, paymentSummary: { invoiceTotalEur: 4235, remainingEur: 4235, refundableEur: 0, payments: [] } } as unknown as SalesOrderView;
  const incoming = line(3, 4235, { counterparty: 'Bloemen Lotus', reference: 'F2026-0420' });
  const invoice = lineSuggestions(input({ lines: [incoming], sales: [sales], customerName: () => 'Bloemen Lotus' })).get(3)!;
  assert.deepEqual(invoice.reasons, ['bedrag exact', 'factuurnummer in mededeling', 'naam bekend', 'nog open']);
  assert.equal(invoice.exact, true);
});

test('a second candidate from 50 points makes it ambiguous: suggested but not exact', () => {
  const second: ContainerPayable = { ...term, key: 'container:44:SUPPLIER:ORDERED', orderId: 44, orderNumber: 'PO-2026-044', invoiceNumber: null };
  const deposit = line(103, -9000, { counterparty: 'Yunnan Pubei Flowers Co., Ltd', reference: 'PO-2026-043 DEPOSIT 30PCT' });
  const result = lineSuggestions(input({ lines: [deposit], containers: [term, second] })).get(103)!;
  assert.equal((result.target as { orderId: number }).orderId, 43);
  assert.equal(result.exact, false, 'PO-2026-044 scores 70 too (amount, name, open)');
  assert.equal(result.others[0].score, 70);
});

test('an existing payment close to the transaction (exchange rate) is a suggestion that changes the amount', () => {
  const transfer = line(8841, -12512.40, { counterparty: 'Yunnan Pubei Flower Co Ltd', reference: 'PO-2026-031 2ND PAYMENT' });
  const result = lineSuggestions(input({ lines: [transfer], purchasePayments: [payment(77)] })).get(8841)!;
  assert.equal(result.target.kind, 'purchase-existing');
  assert.deepEqual(result.reasons, ['bedrag bijna gelijk', 'PO in mededeling', 'datum dichtbij']);
  assert.deepEqual([result.score, result.amountMatches, result.changesAmount, result.exact], [70, true, true, false]);
  const exact = lineSuggestions(input({ lines: [transfer], purchasePayments: [payment(77, { amountEur: 12512.4 })] })).get(8841)!;
  assert.deepEqual([exact.score, exact.changesAmount, exact.exact], [80, false, true]);
  const linked = lineSuggestions(input({ lines: [transfer], purchasePayments: [payment(77, { bankStatementLineId: 5 }), payment(78, { creditOffset: true })] }));
  assert.equal(linked.get(8841), undefined, 'a payment on a line or a credit offset is no candidate');
});

test('the cost pattern: a counterparty linked to costs of one category at least twice in a year', () => {
  const proximus = (id: number, day: string) => line(id, -86.73, { counterparty: 'PROXIMUS', bookedAt: `${day}T22:00:00Z`, allocated: true });
  const lines = [proximus(1, '2026-08-13'), proximus(2, '2026-09-13'), line(3, -91.2, { counterparty: 'Proximus', bookedAt: '2026-10-13T22:00:00Z' })];
  const linked = [
    { lineId: 1, costId: 51, category: 'TELEFOON', party: 'Proximus', description: 'Proximus augustus', date: '2026-08-14' },
    { lineId: 2, costId: 52, category: 'TELEFOON', party: 'Proximus', description: 'Proximus september', date: '2026-09-14' },
  ];
  const result = lineSuggestions(input({ lines, costPaymentsLinkedLines: linked, categoryLabel: (code) => code === 'TELEFOON' ? 'Telefoon & internet' : code })).get(3)!;
  assert.equal(result.target.kind, 'cost-pattern');
  assert.equal((result.target as { label: string }).label, 'Kost · Telefoon & internet · zoals de vorige 2 keer');
  assert.equal((result.target as { costId: number }).costId, 52, 'the registration starts from the latest');
  assert.equal(result.exact, false);
  const once = lineSuggestions(input({ lines, costPaymentsLinkedLines: linked.slice(0, 1) }));
  assert.equal(once.get(3), undefined, 'once is no pattern');
});

test('lineStatus: a booked line is BOOKED, linked lines LINKED', () => {
  assert.equal(lineStatus(line(1, -5000, { classification: 'INTERNAL_TRANSFER', allocated: true }), undefined), 'BOOKED');
  assert.equal(lineStatus(line(1, -5000, { allocated: true }), undefined), 'LINKED');
  assert.equal(lineStatus(line(1, 50, { salesPaymentId: 3 }), undefined), 'LINKED');
  const map = lineSuggestions(input({ lines: [line(9, -9000, { classification: 'VAT', allocated: true, reference: 'PO-2026-043' })], containers: [term] }));
  assert.equal(map.size, 0, 'a booked line gets no suggestion');
});

test('annulatie requires a free exact opposite, on any account or date; existing bookings are never overwritten', () => {
  const debit = line(92, -279.96, { bookedAt: '2026-09-01T00:00:00Z', counterparty: 'IKEA' });
  const refund = line(93, 279.96, { bookedAt: '2026-11-07T00:00:00Z', counterparty: 'IKEA' });
  const anotherAccount = line(94, 279.96, { account: 'WISE' });
  const all = [debit, refund, anotherAccount, line(95, 279.95), line(96, 279.97), line(97, -279.96),
    line(98, 279.96, { allocated: true }), line(99, 279.96, { classification: 'OTHER' }),
    line(100, 279.96, { salesPaymentId: 9 }), line(101, 279.96, { classification: 'TICA_SETTLEMENT' })];
  const day = (row: BankStatementLine) => row.bookedAt.slice(0, 10);
  assert.deepEqual(cancellationCandidates(debit, all, day).map(row => row.id), [94, 93]);
  assert.deepEqual(cancellationCandidates(refund, all, day).map(row => row.id), [97, 92]);
  assert.deepEqual(cancellationCandidates({ ...debit, classification: 'OTHER' }, all, day), []);
  assert.deepEqual(cancellationCandidates(line(102, 0), [line(103, 0)], day), []);
});

test('annulatie remains actual cash in and out, including when a range contains just one leg', () => {
  const debit = line(92, -279.96, { classification: 'CANCELLATION', transferLineId: 93, allocated: true });
  const refund = line(93, 279.96, { classification: 'CANCELLATION', transferLineId: 92, allocated: true });
  assert.equal(lineStatus(debit, undefined), 'BOOKED');
  assert.deepEqual(selectionTotals([debit, refund]), { inEur: 279.96, outEur: 279.96, netEur: 0, internal: 0 });
  assert.deepEqual(selectionTotals([debit]), { inEur: 0, outEur: 279.96, netEur: -279.96, internal: 0 });
});

test('search: every term matches a text or the amount in four ways', () => {
  const rent = line(1, -1452, { counterparty: 'Huur loods Wilrijk', reference: 'Oktober' });
  for (const query of ['1452', '1.452,00', '1452.00', '-1452', '1452,00', 'huur 1452', 'WILRIJK okt']) assert.equal(bankSearchMatches(rent, query), true, query);
  assert.equal(bankSearchMatches(line(2, -12512.4), '-12512'), false, 'whole euros do not match the cents');
  assert.equal(bankSearchMatches(line(2, -12512), '-12512'), true);
  assert.equal(bankSearchMatches(rent, 'huur 1453'), false);
  assert.equal(bankSearchMatches(rent, 'KBC', ['KBC-zichtrekening']), true, 'the account label and linked targets count');
  assert.equal(searchAmount('1.452.000'), 1452000);
  assert.equal(searchAmount('12,5'), 12.5);
  assert.equal(searchAmount('PO-2026'), null);
});

test('In · Uit leave internal transfers out and say so', () => {
  const totals = selectionTotals([line(1, 2000), line(2, -500), line(3, -5000, { classification: 'INTERNAL_TRANSFER' }), line(4, 5000, { classification: 'INTERNAL_TRANSFER' })]);
  assert.deepEqual(totals, { inEur: 2000, outEur: 500, netEur: 1500, internal: 2 });
});

test('Boeken als: the other leg of a transfer, the VAT quarters', () => {
  const day = (row: BankStatementLine) => row.bookedAt.slice(0, 10);
  const out = line(1, -5000, { account: 'K', bookedAt: '2026-10-14T10:00:00Z' });
  const lines = [out,
    line(2, 5000, { account: 'W', bookedAt: '2026-10-16T10:00:00Z' }),
    line(3, 5000, { account: 'W', bookedAt: '2026-10-14T12:00:00Z' }),
    line(4, 5000, { account: 'W', bookedAt: '2026-10-25T10:00:00Z' }),
    line(5, 5000, { account: 'K', bookedAt: '2026-10-14T10:00:00Z' }),
    line(6, 5000, { account: 'W', bookedAt: '2026-10-15T10:00:00Z', allocated: true }),
    line(7, 5000.01, { account: 'W', bookedAt: '2026-10-14T10:00:00Z' }),
    line(8, 5000, { account: 'X', bookedAt: '2026-10-14T10:00:00Z' })];
  assert.deepEqual(transferCandidates(out, lines, day, (key) => key, (key) => key !== 'X').map((row) => row.id), [3, 2]);
  assert.deepEqual([legDistance('2026-10-14', '2026-10-14'), legDistance('2026-10-14', '2026-10-16'), legDistance('2026-10-14', '2026-10-13')],
    ['zelfde dag', '2 dagen later', '1 dag eerder']);
  assert.deepEqual(vatPeriods('2026-10-15', '2026-10-24'), { options: ['2026-Q4', '2026-Q3', '2026-Q2', '2026-Q1', '2025-Q4'], preferred: '2026-Q3' });
  assert.equal(vatPeriods('2026-01-05', '2026-01-05').preferred, '2025-Q4');
  assert.equal(vatPeriodLabel('2026-Q3'), 'Btw-kwartaal Q3 2026');
});

test('suggestion titles name a container as the linked rows do (containerName); the PO number still scores', () => {
  // Review 2026-10-17: "Inkoop · PO-2026-043 · …" one row above "Inkoop · ORDER (3e) …" for the same container.
  const deposit = line(103, -9000, { counterparty: 'Yunnan Pubei Flowers Co., Ltd', reference: 'PO-2026-043 DEPOSIT 30PCT' });
  const named = { ...term, alias: 'ORDER (3e) OOSTENRIJKER' };
  const result = lineSuggestions(input({ lines: [deposit], containers: [named] })).get(103)!;
  assert.equal(result.target.title, 'Inkoop · ORDER (3e) OOSTENRIJKER · 30% bij bestelling');
  assert.ok(result.reasons.includes('PO in mededeling'), 'the PO number in the bank text still counts');
  assert.equal(lineSuggestions(input({ lines: [deposit], containers: [term] })).get(103)!.target.title, 'Inkoop · PO-2026-043 · 30% bij bestelling', 'no alias: the number');
  const transfer = line(8841, -12480, { counterparty: 'Yunnan Pubei Flower Co Ltd', reference: 'PO-2026-031 2ND PAYMENT' });
  const existing = lineSuggestions(input({ lines: [transfer], purchasePayments: [payment(77, { orderAlias: 'Foam Bear' })] })).get(8841)!;
  assert.equal(existing.target.title, 'Inkoop · Foam Bear · 2e termijn');
  assert.ok(existing.reasons.includes('PO in mededeling'));
  for (const [alias, number] of [['Foam Bear', 'PO-2026-031'], [null, 'PO-2026-031'], ['  ', ''], [null, null]] as const) {
    const title = lineSuggestions(input({ lines: [transfer], purchasePayments: [payment(77, { orderAlias: alias, orderNumber: number as string })] })).get(8841)?.target.title;
    if (title) assert.equal(title, `Inkoop · ${containerName({ id: 31, alias, number })} · 2e termijn`, 'the same rule as containerName');
  }
});

test('TICA commission offset is paid without bank cash and must never be suggested against an outgoing transfer', () => {
  const offset = cost(99, { party: 'TICA', reference: '267653273', openEur: 0, ticaSettlementId: 9,
    payments: [{ id: 17, paidOn: '2026-10-13', amountEur: 41.67, account: null, bankStatementLineId: null, note: null, settlementOffset: true }] });
  const transfer = line(999, -41.67, { counterparty: 'TICA', reference: '267653273' });
  assert.equal(lineSuggestions(input({ lines: [transfer], costs: [offset] })).size, 0);
});
