import assert from 'node:assert/strict';
import test from 'node:test';
import {
  alsoContainerOptions, alsoNotice, alsoPartAs, alsoPartChoices, alsoPartFor, alsoPartKey, alsoTotalEur, alsoWrites, rebalancedGoods,
} from '../src/app/features/purchasing/purchase-also-containers.ts';

/* "Deze transactie dekt ook andere containers" (owner addition 2026-10-15): Yunnan Pubei's PO-43/44/45, 30 % of all three in one transfer. */
const term = (orderId: number, due: string | null, remainingEur: number, extra: Record<string, unknown> = {}) => ({
  key: `container:${orderId}:SUPPLIER:${due}`, orderId, orderNumber: `PO-2026-0${orderId}`, alias: null, status: 'BESTELD', archived: false, payee: 'SUPPLIER',
  termLabel: due === 'ORDERED' ? '30% bij bestelling' : due === 'SHIPPED' ? '70% bij vertrek' : null, due, plannedEur: remainingEur, paidEur: 0, remainingEur,
  bucket: 'now', whenLabel: 'nu', invoiceNumber: null, viaSupplier: false, ...extra,
}) as any;
const payables = [
  term(43, 'ORDERED', 9000), term(43, 'SHIPPED', 21000),
  term(44, 'SHIPPED', 7000), term(44, 'ORDERED', 3000),
  term(45, 'ORDERED', 4500),
  term(30, 'ORDERED', 3700),
  term(46, 'ORDERED', 1200, { archived: true }),
  { ...term(45, null, 600), payee: 'SEPARATE', key: 'container:45:SEPARATE' },
  term(47, 'ORDERED', 0),
];
const orders = [{ id: 43, supplierId: 8 }, { id: 44, supplierId: 8 }, { id: 45, supplierId: 8 }, { id: 30, supplierId: 7 }, { id: 46, supplierId: 8 }, { id: 47, supplierId: 8 }];
const names = new Map([[7, 'Mock Rose Crafts Ltd'], [8, 'Yunnan Pubei Flowers Co., Ltd']]);

test('the other containers with an open supplier amount, the same supplier first; this one, archived, paid-up and non-supplier streams left out', () => {
  const options = alsoContainerOptions(payables, orders, names, 43, 8);
  assert.deepEqual(options.map(option => option.number), ['PO-2026-044', 'PO-2026-045', 'PO-2026-030']);
  assert.deepEqual(options[0].terms.map(item => [item.due, item.openEur]), [['SHIPPED', 7000], ['ORDERED', 3000]]);
  assert.equal(options[2].supplier, 'Mock Rose Crafts Ltd');
  assert.deepEqual(options[1].terms.map(item => item.label), ['30% bij bestelling'], 'the inspection stream is not a supplier term');
});

test('a container added takes this payment\'s term when open there, else its earliest open term, at its open amount', () => {
  const [po44, po45, po30] = alsoContainerOptions(payables, orders, names, 43, 8);
  assert.deepEqual(JSON.parse(JSON.stringify(alsoPartFor(po44, 'ORDERED'))),
    { orderId: 44, number: 'PO-2026-044', supplierId: 8, due: 'ORDERED', label: '30% bij bestelling', amountInput: '3.000,00', amount: 3000 });
  assert.equal(alsoPartFor(po44, 'ARRIVED').due, 'SHIPPED', 'not open there: its first open term');
  assert.equal(alsoPartFor(po45, null).amount, 4500);
  assert.equal(alsoPartFor(po30, 'ORDERED').supplierId, 7, 'another supplier is allowed (the sheet warns)');
});

test('the transaction stays balanced while containers come and go; typed amounts that did not match stand', () => {
  // € 16.500 for 30 % of PO-43/44/45: the sheet first set this payment to the whole transaction.
  assert.equal(rebalancedGoods(16500, 16500, 0, 3000, 16500), 13500);
  assert.equal(rebalancedGoods(13500, 13500, 3000, 7500, 16500), 9000);
  assert.equal(rebalancedGoods(9000, 9000, 7500, 3000, 16500), 13500, 'removing one gives it back');
  assert.equal(rebalancedGoods(9000, 9000, 0, 3000, 16500), null, 'not balanced before: nothing moves');
  assert.equal(rebalancedGoods(3000, 3000, 0, 3000, 3000), null, 'never down to nothing');
  assert.equal(rebalancedGoods(null, 0, 0, 3000, 3000), null);
});

test('the writes name their own order, in euro on the transaction\'s day; the notice names the containers', () => {
  const parts = [alsoPartFor(alsoContainerOptions(payables, orders, names, 43, 8)[0], 'ORDERED'), { ...alsoPartFor(alsoContainerOptions(payables, orders, names, 43, 8)[1], 'ORDERED') }];
  assert.equal(alsoTotalEur(parts), 7500);
  assert.equal(alsoTotalEur(null), 0);
  assert.deepEqual(JSON.parse(JSON.stringify(alsoWrites(parts, '2026-10-13'))), [
    { paidOn: '2026-10-13', amount: 3000, currency: 'EUR', label: '30% bij bestelling', payee: 'SUPPLIER', settles: false, instalmentDue: 'ORDERED', purchaseOrderId: 44 },
    { paidOn: '2026-10-13', amount: 4500, currency: 'EUR', label: '30% bij bestelling', payee: 'SUPPLIER', settles: false, instalmentDue: 'ORDERED', purchaseOrderId: 45 },
  ]);
  assert.equal(plain(alsoNotice(parts)), 'Ook op PO-2026-044 en PO-2026-045');
  assert.equal(alsoNotice(parts.slice(0, 1)), 'Ook op PO-\u20602026-\u2060044', 'a toast never breaks inside the number');
  assert.equal(plain(alsoNotice(parts.slice(0, 1))), 'Ook op PO-2026-044');
  assert.equal(plain(alsoNotice([...parts, { ...parts[0], orderId: 30, number: 'PO-2026-030' }])), 'Ook op PO-2026-044, PO-2026-045 en PO-2026-030');
  assert.equal(alsoNotice([]), null);
});

/* ---- Emre, 2026-10-16: a container whose instalment was already noted gets that payment linked, never a second one */

const plain = (text: string | null | undefined) => text?.replace(/[\u00a0\u202f]/g, ' ').replace(/\u2060/g, '');
const view = (id: number, terms: [string, number, number][], extra: Record<string, unknown> = {}) => ({
  order: { id, number: `PO-2026-0${id}`, alias: null, supplierId: 8, status: 'BESTELD', archivedAt: null, ...extra },
  reconciliation: { streams: [{ payee: 'SUPPLIER', plannedEur: 0, paidEur: 0, finalized: false }, { payee: 'LOGISTICS', plannedEur: 1300, paidEur: 1046.95, finalized: false }],
    supplierInstalments: terms.map(([due, plannedEur, paidEur]) => ({ due, label: due === 'ORDERED' ? '30% bij bestelling' : '70% bij vertrek', plannedEur, paidEur,
      remainingEur: Math.max(0, plannedEur - paidEur), finalized: false })) },
}) as any;
const paid = (id: number, orderId: number, amountEur: number, extra: Record<string, unknown> = {}) => ({ id, orderId, orderNumber: `PO-2026-0${orderId}`, orderAlias: null,
  paidOn: '2026-10-12', amountEur, amount: amountEur, currency: 'EUR', label: '30% bij bestelling', payee: 'SUPPLIER', bankStatementLineId: null,
  instalmentDue: 'ORDERED', creditOffset: false, ...extra }) as any;

test('with the payments loaded, a container whose term an open payment covers is listed with it; linked, offset, other-payee and archived ones are not', () => {
  const views = [view(44, [['ORDERED', 3000, 3000], ['SHIPPED', 7000, 0]], { alias: 'Lente' }), view(45, [['ORDERED', 4500, 0]]), view(48, [['ORDERED', 2000, 2000]]),
    view(49, [['ORDERED', 1000, 1000]], { archivedAt: '2026-10-01T00:00:00Z' }), view(30, [['ORDERED', 3700, 0]], { supplierId: 7 })];
  const open = [{ ...term(44, 'SHIPPED', 7000), alias: 'Lente' }, term(45, 'ORDERED', 4500), term(30, 'ORDERED', 3700)];
  const payments = [paid(441, 44, 3000, { orderAlias: 'Lente' }), paid(442, 44, 120, { creditOffset: true }), paid(443, 44, 500, { payee: 'LOGISTICS', instalmentDue: null }),
    paid(481, 48, 2000, { bankStatementLineId: 90 }), paid(491, 49, 1000), paid(431, 43, 900)];
  const options = alsoContainerOptions(open, views.map((item: any) => ({ id: item.order.id, supplierId: item.order.supplierId })), names, 43, 8, { payments, views });
  assert.deepEqual(options.map(option => option.number), ['PO-2026-044', 'PO-2026-045', 'PO-2026-030'], 'the same supplier with an open payment first; PO-048 is on the bank, PO-049 archived');
  assert.deepEqual(options[0].openPayments!.map(payment => [payment.id, payment.due, payment.amountEur]), [[441, 'ORDERED', 3000]]);
  assert.deepEqual(options[0].standings!.map(item => [item.due, item.plannedEur, item.paidEur]), [['ORDERED', 3000, 3000], ['SHIPPED', 7000, 0]]);
  assert.deepEqual(options[0].terms.map(item => [item.due, item.openEur, item.plannedEur]), [['SHIPPED', 7000, 7000]]);
  // On this payment's term the open payment wins: linked, at its own euro, with where its term stands.
  const part = alsoPartFor(options[0], 'ORDERED', '30% bij bestelling');
  assert.deepEqual([part.paymentId, part.amount, part.amountInput, part.due, part.alias, part.paymentEur, part.paidOn], [441, 3000, '3.000,00', 'ORDERED', 'Lente', 3000, '2026-10-12']);
  assert.deepEqual(part.standing, { label: '30% bij bestelling', term: true, plannedEur: 3000, paidEur: 3000 });
  assert.equal(alsoPartKey(part), 'p:441');
  assert.equal(alsoPartFor(options[0], 'SHIPPED').paymentId, null, 'another term: a new payment on that open term');
  assert.deepEqual([alsoPartFor(options[1], 'ORDERED').paymentId, alsoPartFor(options[1], 'ORDERED').openEur], [null, 4500]);
  // The row can switch: the open payment, or a new payment on an open term or on the open payment's own term; the typed amount stays.
  assert.deepEqual(alsoPartChoices(options[0]).map(choice => [choice.key, plain(choice.text)]),
    [['p:441', 'Bestaand: € 3.000,00'], ['t:SHIPPED', 'Nieuw: 70% bij vertrek'], ['t:ORDERED', 'Nieuw: 30% bij bestelling']]);
  assert.equal(alsoPartChoices(options[0]).every(choice => plain(choice.text)!.length <= 25), true, 'short enough for a phone');
  const typed = { ...part, amount: 3801.13, amountInput: '3.801,13' };
  const fresh = alsoPartAs(options[0], 't:ORDERED', typed)!;
  assert.deepEqual([fresh.paymentId, fresh.due, fresh.label, fresh.amount, fresh.openEur, fresh.plannedEur], [null, 'ORDERED', '30% bij bestelling', 3801.13, 0, 3000]);
  assert.equal(alsoPartKey(fresh), 't:ORDERED');
  assert.equal(alsoPartAs(options[0], 'p:441', fresh)!.paymentId, 441);
  assert.equal(alsoPartAs(options[0], 'p:999', fresh), null);
  // Logistics: its own payments and its stream.
  const logistics = alsoContainerOptions([], views.map((item: any) => ({ id: item.order.id, supplierId: item.order.supplierId })), names, 43, 8, { payments, views, payee: 'LOGISTICS' });
  assert.deepEqual(logistics.map(option => [option.number, option.openPayments!.map(payment => payment.id)]), [['PO-2026-044', [443]]]);
  assert.deepEqual(logistics[0].standings, [{ due: null, label: 'Douane & transport', term: false, plannedEur: 1300, paidEur: 1046.95 }]);
  assert.equal(plain(alsoNotice([part, alsoPartFor(options[1], 'ORDERED')])), 'Ook op Lente en PO-2026-045', 'containers by their name');
});

test('several open payments: the same label wins, the choices tell them apart', () => {
  const views = [view(44, [['ORDERED', 6000, 6000]])];
  const payments = [paid(441, 44, 3000, { label: 'Aanbetaling', paidOn: '2026-10-01' }), paid(442, 44, 3000, { label: '30% bij bestelling' })];
  const [option] = alsoContainerOptions([], [{ id: 44, supplierId: 8 }], names, 43, 8, { payments, views });
  assert.equal(alsoPartFor(option, 'ORDERED', '30% bij bestelling').paymentId, 442);
  assert.equal(alsoPartFor(option, 'ORDERED', null).paymentId, 441, 'without a label: the oldest');
  assert.deepEqual(alsoPartChoices(option).map(choice => plain(choice.text)), ['Aanbetaling: € 3.000,00', '30% bij bestelling: € 3.000,00', 'Nieuw: 30% bij bestelling']);
  const same = alsoContainerOptions([], [{ id: 44, supplierId: 8 }], names, 43, 8, { payments: payments.map(item => ({ ...item, label: 'Saldo' })), views })[0];
  assert.deepEqual(alsoPartChoices(same).slice(0, 2).map(choice => plain(choice.text)), ['Bestaand 01/10: € 3.000,00', 'Bestaand 12/10: € 3.000,00']);
});

test("under 'Automatisch' (no term) or a term not open there, a container's open payment is linked, never a new payment beside it", () => {
  // PO-039 noted its 30 % (€ 3.070,20, not on the bank); its 70 % is open (€ 7.163,80). The new payment on PO-038 stays on 'Automatisch'.
  const views = [view(39, [['ORDERED', 3070.2, 3070.2], ['SHIPPED', 7163.8, 0]], { alias: 'Moederdag Rood' }), view(40, [['ORDERED', 3070.2, 0]])];
  const open = [{ ...term(39, 'SHIPPED', 7163.8), alias: 'Moederdag Rood' }, term(40, 'ORDERED', 3070.2)];
  const payments = [paid(392, 39, 3070.2, { orderAlias: 'Moederdag Rood', paidOn: '2026-09-25' })];
  const [po39, po40] = alsoContainerOptions(open, [{ id: 39, supplierId: 8 }, { id: 40, supplierId: 8 }], names, 38, 8, { payments, views });
  const auto = alsoPartFor(po39, null, null);
  assert.deepEqual([auto.paymentId, auto.amount, auto.amountInput, auto.due], [392, 3070.2, '3.070,20', 'ORDERED'], "not 'nieuwe betaling · 70% bij vertrek'");
  assert.equal(alsoPartFor(po39, null, 'Aanbetaling').paymentId, 392, 'another label: still its open payment');
  assert.equal(alsoPartFor(po39, 'ARRIVED', null).paymentId, 392, 'a term it does not have open: its open payment');
  assert.deepEqual([alsoPartFor(po39, 'SHIPPED').paymentId, alsoPartFor(po39, 'SHIPPED').amount], [null, 7163.8], 'its open term of this payment: a new payment on it');
  assert.deepEqual([alsoPartFor(po40, null).paymentId, alsoPartFor(po40, null).due, alsoPartFor(po40, null).amount], [null, 'ORDERED', 3070.2], 'no open payment: its earliest open term');
  // Two open payments: the same label first, else the earliest term.
  const two = alsoContainerOptions(open, [{ id: 39, supplierId: 8 }], names, 38, 8,
    { payments: [paid(395, 39, 1000, { instalmentDue: 'SHIPPED', label: '70% bij vertrek', paidOn: '2026-09-01' }), ...payments], views })[0];
  assert.equal(alsoPartFor(two, null, null).paymentId, 392, '30 % before 70 %, whichever was noted first');
  assert.equal(alsoPartFor(two, null, '70% bij vertrek').paymentId, 395);
});

test("a new transfer's row switched to another choice brings that choice's own amount; a term with nothing open keeps the typed one", () => {
  const views = [view(39, [['ORDERED', 3070.2, 3070.2], ['SHIPPED', 7163.8, 0]])];
  const [po39] = alsoContainerOptions([term(39, 'SHIPPED', 7163.8)], [{ id: 39, supplierId: 8 }], names, 38, 8, { payments: [paid(392, 39, 3070.2)], views });
  const fresh = alsoPartAs(po39, 't:SHIPPED', alsoPartFor(po39, null), true)!;
  assert.deepEqual([fresh.paymentId, fresh.amount, fresh.amountInput], [null, 7163.8, '7.163,80']);
  const back = alsoPartAs(po39, 'p:392', fresh, true)!;
  assert.deepEqual([back.paymentId, back.amount, back.amountInput], [392, 3070.2, '3.070,20'], 'not € 7.163,80 on a € 3.070,20 payment');
  assert.deepEqual([alsoPartAs(po39, 't:ORDERED', back, true)!.amount, alsoPartAs(po39, 't:ORDERED', back, true)!.paymentId], [3070.2, null], 'its term is covered: the typed amount stays');
  assert.equal(alsoPartAs(po39, 'p:392', fresh)!.amount, 7163.8, 'a share keeps the typed amount');
});

test('a toast keeps a short alias whole with its amount; a long one may wrap at its spaces', () => {
  const part = (alias: string) => ({ orderId: 39, number: 'PO-2026-039', alias, supplierId: 8, due: 'ORDERED', label: '30%', amountInput: '1,00', amount: 1 }) as any;
  assert.equal(alsoNotice([part('Moederdag Rood')]), 'Ook op Moederdag Rood');
  assert.equal(alsoNotice([part('Moederdag Rood grote container 2026')]), 'Ook op Moederdag Rood grote container 2026');
});
