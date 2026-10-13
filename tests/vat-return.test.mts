import assert from 'node:assert/strict';
import test from 'node:test';
import type { CompanyCost, PurchaseOrderView, SalesOrderView } from '../src/app/core/api/models.ts';
import { returnLineOf } from '../src/app/features/finance/finance-metrics.ts';
import { clearanceSuggestion, containerLines, salesDocLines, vatReturn, vatReturnCsv } from '../src/app/features/finance/vat-return.ts';
import type { ContainerLine, SalesDocLine, VatReturn } from '../src/app/features/finance/vat-return.ts';

function cost(input: Partial<CompanyCost> & { id: number; amountExclEur: number }): CompanyCost {
  return { date: '2026-08-10', category: 'SOFTWARE', description: `Kost ${input.id}`, party: 'Partij', vatPct: 21, amountInclEur: null, reference: `F-${input.id}`, paidOn: null,
    salesChannel: null, notes: null, recurringCostId: null, vatRegime: 'BE', vatRegimeConfirmed: true, supplierCountry: 'BE', costKind: null, expenseType: 'STANDARD',
    vatDeductiblePct: 100, taxDeductiblePct: 100, depreciationYears: null, depreciationStart: null, ...input };
}
const lines = (costs: CompanyCost[]) => costs.map((row) => returnLineOf(row, true));

function doc(input: { id: number; docType?: 'FACTUUR' | 'CREDITNOTA' | 'OFFERTE'; status?: string; date?: string; treatment: string; rate: number; total: number; vat: number; purpose?: string }): SalesOrderView {
  return {
    order: { id: input.id, number: `D-${input.id}`, customerId: 5, orderDate: input.date ?? '2026-08-20', status: input.status ?? 'VERZONDEN', docType: input.docType ?? 'FACTUUR', purpose: input.purpose ?? 'STANDARD' },
    priced: { totals: { total: input.total, vatRatePct: input.rate, vatAmount: input.vat, vatTreatment: input.treatment } },
  } as unknown as SalesOrderView;
}
const customer = (id: number | null) => (id === 5 ? 'Bloemen BV' : '');

function container(input: { id: number; status?: string; receivedOn?: string | null; expectedArrival?: string | null; clearance?: string | null; port?: string }): PurchaseOrderView {
  return {
    order: { id: input.id, number: `INK-${input.id}`, alias: 'Rozen', status: input.status ?? 'ONTVANGEN', receivedOn: input.receivedOn ?? null, expectedArrival: input.expectedArrival ?? null,
      clearance: input.clearance ?? null, destinationPort: input.port ?? 'Rotterdam', usdToEurGoods: 0.92 },
    costing: { totals: { goodsEur: 20000, goodsUsd: 21739.13, customsValueEur: 22000, dutyEur: 1320 } },
  } as unknown as PurchaseOrderView;
}

const settings = { importVatDeferred: false, today: '2026-10-12' };
const eur = (result: VatReturn, code: string) => result.grids.find((grid) => grid.code === code)!.eur;
const rows = (result: VatReturn, code: string) => result.grids.find((grid) => grid.code === code)!.rows;
/** Intl puts a no-break space behind the euro sign; the assertions read it as a plain one. */
const plain = (texts: readonly string[]) => texts.map((text) => text.replace(/\u00a0/g, ' '));

test('every grid is listed, in its kader, and a Belgian invoice fills 82 and 59', () => {
  const result = vatReturn(2026, 3, lines([cost({ id: 1, amountExclEur: 100 })]), [], [], settings);
  assert.equal(result.grids.length, 25);
  assert.deepEqual(result.grids.filter((grid) => grid.kader === 'V').map((grid) => grid.code), ['59', '64']);
  assert.deepEqual([result.from, result.to, result.filingDeadline], ['2026-07-01', '2026-09-30', '2026-10-25']);
  assert.deepEqual([eur(result, '82'), eur(result, '59'), eur(result, '81')], [100, 21, 0]);
  assert.deepEqual(result.totals, { dueEur: 0, deductibleEur: 21, payableEur: 0, refundEur: 21 });
  assert.equal(result.status, 'ready', 'the quarter is over and nothing waits');
  assert.equal(vatReturn(2026, 4, lines([cost({ id: 1, amountExclEur: 100, date: '2026-10-02' })]), [], [], settings).status, 'provisional', 'the running quarter');
  assert.equal(rows(result, '82')[0].reference, 'F-1');
});

test('reverse charge goes three ways; a half deduction lifts the base and halves 59', () => {
  const full = vatReturn(2026, 3, lines([cost({ id: 1, amountExclEur: 100, vatRegime: 'EU_GOODS', supplierCountry: 'DE', category: 'MATERIAAL' })]), [], [], settings);
  assert.deepEqual([eur(full, '81'), eur(full, '86'), eur(full, '55'), eur(full, '59')], [100, 100, 21, 21]);
  const services = vatReturn(2026, 3, lines([cost({ id: 2, amountExclEur: 100, vatRegime: 'EU_SERVICES', supplierCountry: 'IE' })]), [], [], settings);
  assert.deepEqual([eur(services, '82'), eur(services, '88'), eur(services, '55'), eur(services, '59')], [100, 100, 21, 21]);
  const us = vatReturn(2026, 3, lines([cost({ id: 3, amountExclEur: 100, vatRegime: 'NON_EU_SERVICES', supplierCountry: 'US' })]), [], [], settings);
  assert.deepEqual([eur(us, '82'), eur(us, '87'), eur(us, '56'), eur(us, '59')], [100, 100, 21, 21]);
  assert.deepEqual(us.totals, { dueEur: 21, deductibleEur: 21, payableEur: 0, refundEur: 0 });
  const half = vatReturn(2026, 3, lines([cost({ id: 4, amountExclEur: 100, vatRegime: 'EU_SERVICES', supplierCountry: 'IE', vatDeductiblePct: 50 })]), [], [], settings);
  assert.deepEqual([eur(half, '82'), eur(half, '88'), eur(half, '55'), eur(half, '59')], [110.5, 100, 21, 10.5]);
  assert.deepEqual(half.totals, { dueEur: 21, deductibleEur: 10.5, payableEur: 10.5, refundEur: 0 });
});

test('restaurant, import VAT, an investment and an unknown regime', () => {
  const restaurant = vatReturn(2026, 3, lines([cost({ id: 1, amountExclEur: 100, expenseType: 'RESTAURANT', vatDeductiblePct: 0, taxDeductiblePct: 69 })]), [], [], settings);
  assert.deepEqual([eur(restaurant, '82'), eur(restaurant, '59'), rows(restaurant, '59').length], [121, 0, 0]);
  const importVat = vatReturn(2026, 3, lines([cost({ id: 2, amountExclEur: 0, vatPct: null, amountInclEur: 500, vatRegime: 'IMPORT_VAT_PAID', category: 'TRANSPORT' })]), [], [], settings);
  assert.deepEqual([eur(importVat, '81'), eur(importVat, '82'), eur(importVat, '59')], [0, 0, 500], 'import VAT only in 59');
  const investment = vatReturn(2026, 3, lines([cost({ id: 3, amountExclEur: 3000, costKind: 'INVESTMENT', depreciationYears: 3, depreciationStart: '2026-07-01' })]), [], [], settings);
  assert.deepEqual([eur(investment, '83'), eur(investment, '82'), eur(investment, '59')], [3000, 0, 630]);
  const unknown = vatReturn(2026, 3, lines([cost({ id: 4, amountExclEur: 10, vatPct: 0, vatRegime: null, vatRegimeConfirmed: false }), cost({ id: 5, amountExclEur: 10, vatRegimeConfirmed: false })]), [], [], settings);
  assert.deepEqual(unknown.unknown.map((line) => line.costId), [4]);
  assert.equal(unknown.unconfirmedCount, 1);
  assert.equal(unknown.status, 'provisional');
  assert.deepEqual(rows(unknown, '82')[0].badges, ['te bevestigen']);
  assert.equal(eur(unknown, '82'), 10, 'a derived regime counts normally');
  const other = vatReturn(2026, 2, lines([cost({ id: 1, amountExclEur: 100 })]), [], [], settings);
  assert.equal(eur(other, '82'), 0, 'another quarter');
});

test('Kader II from the issued documents: rate, intra-EU, export, credit notes', () => {
  const docs = salesDocLines([
    doc({ id: 1, treatment: 'BINNENLAND', rate: 21, total: 1000, vat: 210, purpose: 'PARTNER_ADVANCE' }),
    doc({ id: 2, treatment: 'INTRACOMMUNAUTAIR', rate: 0, total: 2000, vat: 0 }),
    doc({ id: 3, treatment: 'EU_ZONDER_BTW_NUMMER', rate: 9, total: 300, vat: 27 }),
    doc({ id: 4, docType: 'CREDITNOTA', treatment: 'INTRACOMMUNAUTAIR', rate: 0, total: 400, vat: 0 }),
    doc({ id: 5, docType: 'CREDITNOTA', treatment: 'BINNENLAND', rate: 21, total: 100, vat: 21 }),
    doc({ id: 6, treatment: 'UITVOER', rate: 0, total: 700, vat: 0 }),
    doc({ id: 7, treatment: 'VERLEGD_FISCAAL_VERTEGENWOORDIGER', rate: 0, total: 800, vat: 0 }),
    doc({ id: 8, treatment: 'BINNENLAND', rate: 6, total: 50, vat: 3 }),
    doc({ id: 9, treatment: 'BINNENLAND', rate: 21, total: 999, vat: 209.79, status: 'CONCEPT' }),
    doc({ id: 10, treatment: 'BINNENLAND', rate: 21, total: 999, vat: 209.79, status: 'GEANNULEERD' }),
    doc({ id: 11, docType: 'OFFERTE', treatment: 'BINNENLAND', rate: 21, total: 999, vat: 209.79, status: 'GEACCEPTEERD' }),
  ], customer);
  assert.deepEqual(docs.map((row) => row.id), [1, 2, 3, 4, 5, 6, 7, 8], 'concepts, dead documents and quotes stay out');
  assert.equal(docs[0].customer, 'Bloemen BV');
  const result = vatReturn(2026, 3, [], docs, [], settings);
  assert.deepEqual([eur(result, '01'), eur(result, '02'), eur(result, '03'), eur(result, '54')], [50, 0, 1300, 240], 'the advance invoice counts in 03/54');
  assert.deepEqual([eur(result, '46'), eur(result, '47')], [2000, 1500]);
  assert.deepEqual([eur(result, '48'), eur(result, '49'), eur(result, '64')], [400, 100, 21]);
  assert.deepEqual(rows(result, '03').find((row) => row.id === 3)!.badges, ['tarief 9 % · te bevestigen']);
  assert.deepEqual(rows(result, '03').find((row) => row.id === 1)!.badges, []);
  assert.deepEqual(result.totals, { dueEur: 240, deductibleEur: 21, payableEur: 219, refundEur: 0 });
});

test('containers: the goods in 81, the import VAT by clearance', () => {
  const representative = { importVatDeferred: false, representative: '24/7 Customs' };
  const nl = containerLines([container({ id: 1, receivedOn: '2026-08-15', clearance: 'NL_FISCAL_REP_TO_BE' })], representative);
  assert.deepEqual([nl[0].goodsEur, nl[0].baseEur, nl[0].vatEur, nl[0].dutyEur, nl[0].dateSource, nl[0].suggested], [20000, 23320, 4897.2, 1320, 'received', 'NL_FISCAL_REP_SOLD_IN_NL']);
  const viaRep = vatReturn(2026, 3, [], [], nl, settings);
  assert.deepEqual([eur(viaRep, '81'), eur(viaRep, '86'), eur(viaRep, '55'), eur(viaRep, '59')], [20000, 23320, 4897.2, 4897.2]);
  assert.ok(rows(viaRep, '86')[0].badges.includes('via 24/7 Customs'));
  assert.equal(viaRep.status, 'ready');
  assert.equal(viaRep.openClearanceCount, 0, 'a picked clearance is not open');

  const soldInNl = vatReturn(2026, 3, [], [], containerLines([container({ id: 2, receivedOn: '2026-08-15', clearance: 'NL_FISCAL_REP_SOLD_IN_NL' })], representative), settings);
  assert.deepEqual([eur(soldInNl, '81'), eur(soldInNl, '86'), eur(soldInNl, '55')], [20000, 0, 0]);

  const be = containerLines([container({ id: 3, receivedOn: '2026-08-15', clearance: 'BE_CUSTOMS', port: 'Antwerp' })], representative);
  const paidAtCustoms = vatReturn(2026, 3, [], [], be, settings);
  assert.deepEqual([eur(paidAtCustoms, '81'), eur(paidAtCustoms, '87'), eur(paidAtCustoms, '57'), eur(paidAtCustoms, '59')], [20000, 0, 0, 0], 'without ET 14000 the import VAD comes through its own cost');
  const deferred = vatReturn(2026, 3, [], [], be, { importVatDeferred: true, today: '2026-10-12' });
  assert.deepEqual([eur(deferred, '81'), eur(deferred, '87'), eur(deferred, '57'), eur(deferred, '59')], [20000, 23320, 4897.2, 4897.2]);
  assert.ok(rows(deferred, '87')[0].badges.includes('ET 14000 · zelf aangegeven'));

  const open = vatReturn(2026, 3, [], [], containerLines([container({ id: 4, expectedArrival: '2026-09-20', clearance: null, port: 'Rotterdam' })], representative), settings);
  assert.deepEqual([eur(open, '81'), eur(open, '86'), eur(open, '55'), eur(open, '59')], [20000, 0, 0, 0], 'the suggestion applies until the clearance is picked: the goods stay in the Netherlands');
  assert.deepEqual(plain(rows(open, '81')[0].badges), ['inklaring te bevestigen', 'voorlopig zonder 86/55/59 · basis € 23.320,00 als de goederen naar België komen',
    'verwachte aankomst', 'koers van de order 0.92', 'invoerrechten · bij de goederen, geen vak'], 'the assumption and the base at stake stand beside the open clearance');
  assert.equal(open.status, 'provisional');
  assert.equal(open.openClearanceCount, 1);

  const openAntwerp = containerLines([container({ id: 7, receivedOn: '2026-08-15', clearance: null, port: 'Antwerp' })], representative);
  const antwerp = vatReturn(2026, 3, [], [], openAntwerp, { importVatDeferred: true, today: '2026-10-12' });
  assert.deepEqual(rows(antwerp, '81')[0].badges, ['inklaring te bevestigen', 'koers van de order 0.92', 'invoerrechten · bij de goederen, geen vak'], 'an Antwerp suggestion assumes nothing about the Netherlands');
  assert.deepEqual(rows(antwerp, '87')[0].badges, ['inklaring te bevestigen', 'ET 14000 · zelf aangegeven']);
  assert.deepEqual([eur(antwerp, '87'), antwerp.openClearanceCount, antwerp.status], [23320, 1, 'provisional']);
  const picked = vatReturn(2026, 3, [], [], containerLines([container({ id: 8, receivedOn: '2026-08-15', clearance: 'NL_FISCAL_REP_SOLD_IN_NL' })], representative), settings);
  assert.deepEqual(rows(picked, '81')[0].badges, ['koers van de order 0.92', 'invoerrechten · bij de goederen, geen vak'], 'a confirmed stay in the Netherlands is no assumption');
  const several = vatReturn(2026, 3, [], [], containerLines([
    container({ id: 9, receivedOn: '2026-07-02', clearance: null }), container({ id: 10, expectedArrival: '2026-09-30', clearance: null, port: 'Antwerp' }),
    container({ id: 11, receivedOn: '2026-10-01', clearance: null }), container({ id: 12, status: 'ONDERWEG', clearance: null }), container({ id: 13, receivedOn: '2026-08-01', clearance: 'BE_CUSTOMS' }),
  ], representative), settings);
  assert.equal(several.openClearanceCount, 2, 'only the containers of the quarter count: not the next quarter, not one without a date');
  const noCosting = { ...containerLines([container({ id: 14, receivedOn: '2026-08-15', clearance: null })], representative)[0], baseEur: 0, vatEur: 0 };
  assert.deepEqual(rows(vatReturn(2026, 3, [], [], [noCosting], settings), '81')[0].badges.slice(0, 2), ['inklaring te bevestigen', 'voorlopig zonder 86/55/59'], 'without a customs value there is no base to name');
  const notReceived = vatReturn(2026, 3, [], [], containerLines([container({ id: 5, status: 'ONDERWEG' }), container({ id: 6, status: 'CONCEPT', receivedOn: '2026-08-01' })], representative), settings);
  assert.deepEqual(notReceived.notReceived.map((row) => row.id), [5]);
  assert.equal(eur(notReceived, '81'), 0, 'concepts never count');
  assert.equal(clearanceSuggestion('Antwerp'), 'BE_CUSTOMS');
  assert.equal(clearanceSuggestion('Antwerpen'), 'BE_CUSTOMS');
  assert.equal(clearanceSuggestion('Zeebrugge'), 'BE_CUSTOMS');
  assert.equal(clearanceSuggestion('Rotterdam'), 'NL_FISCAL_REP_SOLD_IN_NL');
  assert.equal(clearanceSuggestion(null), 'NL_FISCAL_REP_SOLD_IN_NL');
});

test('71 and 72 are never both filled; the CSV says what state the return is in', () => {
  const sales: SalesDocLine[] = [{ id: 1, number: 'F-1', customer: 'Bloemen BV', date: '2026-08-01', docType: 'FACTUUR', treatment: 'BINNENLAND', ratePct: 21, baseEur: 1000, vatEur: 210 }];
  const payable = vatReturn(2026, 3, lines([cost({ id: 1, amountExclEur: 100 })]), sales, [], settings);
  assert.deepEqual([payable.totals.payableEur, payable.totals.refundEur], [189, 0]);
  const refund = vatReturn(2026, 3, lines([cost({ id: 1, amountExclEur: 2000 })]), sales, [], settings);
  assert.deepEqual([refund.totals.payableEur, refund.totals.refundEur], [0, 210]);
  const csv = vatReturnCsv(payable).split('\r\n');
  assert.match(csv[0], /^KLAAR · btw-aangifte 2026 Q3/);
  assert.equal(csv[1], 'Kader;Rooster;Omschrijving;Bedrag;Document;Datum;Partij;Referentie;Basis;Btw;Opmerking');
  assert.ok(csv.includes('III;82;Diensten en diverse goederen;100,00;;;;;;;'));
  assert.ok(csv.includes('III;82;;;Kost 1;2026-08-10;Partij;F-1;100,00;21,00;'));
  assert.ok(csv.includes('II;03;;;F-1;2026-08-01;Bloemen BV;;1000,00;210,00;'));
  assert.ok(csv.includes(';71;Btw te betalen;189,00'));
  const provisional = vatReturnCsv(vatReturn(2026, 3, lines([cost({ id: 2, amountExclEur: 10, vatRegimeConfirmed: false }), cost({ id: 3, amountExclEur: 10, vatPct: 0, vatRegime: null })]), [], [], settings)).split('\r\n');
  assert.match(provisional[0], /^VOORLOPIG · 2 te bevestigen/);
  assert.ok(provisional.includes(';Nog te bepalen;;;Kost 3;2026-08-10;Partij;F-3;10,00;;btw-regeling kiezen'), 'the accountant gets the amount to decide on');
  const toBelgium: ContainerLine[] = containerLines([container({ id: 1, receivedOn: '2026-08-15', clearance: 'NL_FISCAL_REP_TO_BE' })], { importVatDeferred: false, representative: null });
  assert.ok(vatReturnCsv(vatReturn(2026, 3, [], [], toBelgium, settings)).includes('via fiscaal vertegenwoordiger'));
  const unconfirmed: ContainerLine[] = containerLines([container({ id: 2, receivedOn: '2026-08-15', clearance: null })], { importVatDeferred: false, representative: null });
  const unconfirmedCsv = vatReturnCsv(vatReturn(2026, 3, [], [], unconfirmed, settings));
  assert.ok(unconfirmedCsv.includes('inklaring te bevestigen'), 'an unconfirmed container says so');
  assert.ok(!unconfirmedCsv.includes('via fiscaal vertegenwoordiger'), 'and is not declared as an acquisition until it is said to come to Belgium');
  assert.match(unconfirmedCsv.split('\r\n')[0], /^VOORLOPIG · 1 te bevestigen · btw-aangifte 2026 Q3/, 'the open clearance is what keeps the return provisional, and it is counted');
  assert.ok(plain(unconfirmedCsv.split('\r\n')).includes('III;81;;;INK-2 · Rozen;2026-08-15;container;;20000,00;0,00;inklaring te bevestigen · voorlopig zonder 86/55/59 · basis € 23.320,00 als de goederen naar België komen · koers van de order 0.92 · invoerrechten · bij de goederen, geen vak'));
  const mixed = vatReturn(2026, 3, lines([cost({ id: 2, amountExclEur: 10, vatRegimeConfirmed: false }), cost({ id: 3, amountExclEur: 10, vatPct: 0, vatRegime: null })]), [], unconfirmed, settings);
  assert.deepEqual([mixed.unconfirmedCount, mixed.unknown.length, mixed.openClearanceCount], [1, 1, 1]);
  assert.match(vatReturnCsv(mixed), /^VOORLOPIG · 3 te bevestigen/, 'regimes and clearances add up in the header');
});
