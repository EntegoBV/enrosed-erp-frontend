import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyShare, shareBody, shareNewPart, sharePartsOf, shareStatus, shareToast, shareWeight, splitCents,
} from '../src/app/features/purchasing/purchase-payment-share.ts';
import { alsoContainerOptions, alsoPartFor, proposeShare } from '../src/app/features/purchasing/purchase-also-containers.ts';
import { inspectionSplitBlocked, linkChange, pendingLinkPlan, shareEffect } from '../src/app/features/purchasing/purchase-payment-links.ts';

/*
 * "Verdelen over containers" (Emre, 2026-10-16): one transfer of € 11.403,38
 * paid the 30 % of PO-2026-038, -039 and -040. "1/3 nemen van die transactie
 * bijvoorbeeld en ook manueel kunnen aanpassen."
 */
const plain = (text: string | null | undefined) => text?.replace(/[  ]/g, ' ');
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

test('splitCents: the transaction to the cent, rounding rest on the largest part (the last of equal ones)', () => {
  assert.deepEqual(splitCents(11403.38, [1, 1, 1]), [3801.13, 3801.13, 3801.12], 'equal weights: exactly 1/3, the last one takes the cent');
  assert.deepEqual(splitCents(11403.38, [3070.2, 3070.2, 3070.2]), [3801.13, 3801.13, 3801.12], 'equal Afspraak amounts are equal weights');
  assert.deepEqual(splitCents(11403.38, [3000, 4500, 3903.38]), [3000, 4500, 3903.38], 'weights that make the total come back exactly');
  assert.deepEqual(splitCents(100, [1, 2]), [33.33, 66.67]);
  assert.deepEqual(splitCents(0.1, [1, 1, 1]), [0.03, 0.03, 0.04], 'a cent short: the last of the equal ones takes it');
  assert.deepEqual(splitCents(0.11, [2, 1, 2]), [0.04, 0.02, 0.05], 'ties for the largest weight: the last of them');
  assert.deepEqual(splitCents(0.05, [1, 1]), [0.03, 0.02], 'half up, then the rest on the last largest');
  const ten = splitCents(1000.01, Array(10).fill(1))!;
  assert.equal(ten.length, 10);
  assert.equal(Math.round(ten.reduce((sum, part) => sum + part, 0) * 100), 100001);
  assert.deepEqual([ten[0], ten[9]], [100, 100.01], 'ten parts: the cent on the last');
  for (const weights of [[1, 0], [1, -2], [1, Number.NaN], [1, Number.POSITIVE_INFINITY], []]) assert.equal(splitCents(100, weights), null, String(weights));
  assert.equal(splitCents(0, [1, 1]), null);
  assert.equal(splitCents(-5, [1, 1]), null);
  assert.equal(splitCents(0.01, [1, 1]), null, 'a part below a cent');
});

/* The containers as the sheet loads them: PO-039 has its 30 % noted (not on the bank), PO-040 only its open term. */
const view = (id: number, plannedEur: number, paidEur: number, extra: Record<string, unknown> = {}) => ({
  order: { id, number: `PO-2026-0${id}`, alias: null, supplierId: 8, status: 'BESTELD', archivedAt: null, ...extra },
  reconciliation: { streams: [{ payee: 'SUPPLIER', plannedEur: plannedEur * 3, paidEur, finalized: false }],
    supplierInstalments: [{ due: 'ORDERED', label: '30% bij bestelling', plannedEur, paidEur, remainingEur: Math.max(0, plannedEur - paidEur), finalized: false },
      { due: 'SHIPPED', label: '70% bij vertrek', plannedEur: plannedEur * 7 / 3, paidEur: 0, remainingEur: plannedEur * 7 / 3, finalized: false }] },
}) as any;
const term = (orderId: number, due: string, remainingEur: number, plannedEur = remainingEur) => ({
  key: `container:${orderId}:SUPPLIER:${due}`, orderId, orderNumber: `PO-2026-0${orderId}`, alias: null, status: 'BESTELD', archived: false, payee: 'SUPPLIER',
  termLabel: due === 'ORDERED' ? '30% bij bestelling' : '70% bij vertrek', due, plannedEur, paidEur: plannedEur - remainingEur, remainingEur,
  bucket: 'now', whenLabel: 'nu', invoiceNumber: null, viaSupplier: false,
}) as any;
const row = (id: number, orderId: number, amountEur: number, extra: Record<string, unknown> = {}) => ({
  id, orderId, orderNumber: `PO-2026-0${orderId}`, orderAlias: null, paidOn: '2026-09-25', amountEur, amount: amountEur, currency: 'EUR', label: '30% bij bestelling',
  payee: 'SUPPLIER', bankStatementLineId: null, instalmentDue: 'ORDERED', creditOffset: false, ...extra,
}) as any;
const views = [view(38, 3011.65, 3070.2), view(39, 3070.2, 3070.2, { alias: 'Kerst 2026' }), view(40, 3070.2, 0), view(41, 3070.2, 3070.2), view(42, 3680, 3680), view(30, 2000, 0, { supplierId: 7 })];
const payables = [term(38, 'SHIPPED', 7027.18), { ...term(39, 'SHIPPED', 7163.8), alias: 'Kerst 2026' }, term(40, 'ORDERED', 3070.2), term(40, 'SHIPPED', 7163.8), term(41, 'SHIPPED', 7163.8),
  term(42, 'SHIPPED', 8586.67), term(30, 'ORDERED', 2000)];
const payments = [
  row(381, 38, 3070.2, { paidOn: '2026-09-26' }),
  row(392, 39, 3070.2, { orderAlias: 'Kerst 2026' }),
  row(411, 41, 3070.2, { bankStatementLineId: 77 }),
  row(421, 42, 3680, { amount: 4000, currency: 'USD', paidOn: '2026-09-06' }),
  row(395, 39, 300, { payee: 'SEPARATE', instalmentDue: null, label: 'Inspectie' }),
  row(399, 39, 120, { creditOffset: true }),
];
const orders = views.map((item: any) => ({ id: item.order.id, supplierId: item.order.supplierId }));
const names = new Map([[7, 'Mock Rose Crafts Ltd'], [8, 'Yunnan Pubei Flowers Co., Ltd']]);
const options = () => alsoContainerOptions(payables, orders, names, 38, 8, { payments, views, payee: 'SUPPLIER' });

test('shareWeight and applyShare: by Afspraak (open payment, open term, else the Afspraak) or equally; MANUAL stays the sheet\'s', () => {
  const [po39, po40] = proposeAndAdd();
  assert.deepEqual([shareWeight(po39), shareWeight(po40)], [3070.2, 3070.2]);
  assert.equal(shareWeight({ ...po40, openEur: 0, plannedEur: 3903.38 }), 3903.38, 'nothing open: its Afspraak');
  assert.equal(shareWeight({ ...po40, openEur: 0, plannedEur: 0 }), null);
  const equal = applyShare('AFSPRAAK', -11403.38, 3070.2, [po39, po40])!;
  assert.deepEqual([equal.own, ...equal.parts.map(part => part.amount)], [3801.13, 3801.13, 3801.12]);
  assert.deepEqual(equal.parts.map(part => part.amountInput), ['3.801,13', '3.801,12']);
  const unequal = applyShare('AFSPRAAK', 11403.38, 3000, [{ ...po39, paymentEur: 4500 }, { ...po40, openEur: 3903.38 }])!;
  assert.deepEqual([unequal.own, ...unequal.parts.map(part => part.amount)], [3000, 4500, 3903.38]);
  const thirds = applyShare('EQUAL', 11403.38, 3000, [{ ...po39, paymentEur: 4500 }, { ...po40, openEur: 3903.38 }])!;
  assert.deepEqual([thirds.own, ...thirds.parts.map(part => part.amount)], [3801.13, 3801.13, 3801.12]);
  assert.equal(applyShare('AFSPRAAK', 11403.38, null, [po39]), null);
});

test('shareStatus: the live line and the two-cent rule', () => {
  const [po39, po40] = proposeAndAdd();
  const parts = [{ ...po39, amount: 3801.13 }, { ...po40, amount: 3801.12 }];
  assert.equal(shareStatus(3801.13, parts, -11403.38).matches, true);
  assert.equal(plain(shareStatus(3801.13, parts, -11403.38).text), 'Samen € 11.403,38 van € 11.403,38 ✓');
  assert.equal(shareStatus(3801.14, parts, -11403.38).matches, true, 'a cent off still matches');
  const short = shareStatus(3397.75, parts, 11403.38);
  assert.deepEqual([short.matches, plain(short.text)], [false, 'Samen € 11.000,00 van € 11.403,38 · nog € 403,38 te verdelen']);
  const over = shareStatus(3813.13, parts, 11403.38);
  assert.deepEqual([over.matches, plain(over.text)], [false, 'Samen € 11.415,38 van € 11.403,38 · € 12,00 te veel']);
  assert.equal(shareStatus(null, [], 11403.38).matches, false);
});

test('shareEffect: link, carve, grow above the Afspraak, a USD payment whole, a new payment', () => {
  const standing = { label: '30% bij bestelling', term: true, plannedEur: 3011.65, paidEur: 3070.2 };
  assert.equal(shareEffect({ paymentEur: 3070.2, currency: 'EUR', partEur: 3070.21, standing, day: '2026-09-28' }), 'wordt gekoppeld · betaald op 28/09/2026');
  assert.equal(plain(shareEffect({ paymentEur: 3070.2, currency: 'EUR', partEur: 2000, standing, day: '2026-09-28' })),
    '€ 2.000,00 op de bank; € 1.070,20 blijft open als tweede transactie');
  assert.equal(plain(shareEffect({ paymentEur: 3070.2, currency: 'EUR', partEur: 3801.13, standing, day: '2026-09-28' })),
    'betaling wordt € 3.801,13 (was € 3.070,20); de termijn komt € 789,48 boven de afspraak', "the owner's own sentence, said before he saves");
  assert.equal(plain(shareEffect({ paymentEur: 3070.2, currency: 'EUR', partEur: 3801.13, standing: null, day: '2026-09-28' })),
    'betaling wordt € 3.801,13 (was € 3.070,20)');
  assert.equal(plain(shareEffect({ paymentEur: 3680, currency: 'USD', amount: 4000, partEur: 3700, standing, day: '2026-09-28' })),
    'betaling in USD: gaat helemaal op deze transactie; de euro wordt € 3.700,00 (was € 3.680,00)');
  assert.match(plain(shareEffect({ paymentEur: 3680, currency: 'USD', amount: 4000, partEur: 2000, day: '2026-09-28' }))!, / · wijkt sterk af, controleer het deel$/);
  const open = { label: '30% bij bestelling', term: true, plannedEur: 3070.2, paidEur: 0 };
  assert.equal(plain(shareEffect({ paymentEur: null, partEur: 3801.12, standing: open, day: '2026-09-28', label: '30% bij bestelling' })),
    'nieuwe betaling · 30% bij bestelling; de termijn komt € 730,92 boven de afspraak');
  assert.equal(plain(shareEffect({ paymentEur: null, partEur: 3000, standing: open, day: '2026-09-28', label: '30% bij bestelling', openEur: 3070.2 })),
    'nieuwe betaling · 30% bij bestelling · open € 3.070,20', 'under the Afspraak: nothing to warn about');
});

test('shareBody: this payment first (its euro only when given), open payments with the euro the screen saw, new ones on their term', () => {
  const [po39, po40] = proposeAndAdd();
  const parts = [{ ...po39, amount: 3801.13 }, { ...po40, amount: 3801.12 }];
  assert.deepEqual(clone(shareBody({ paymentId: 381, partEur: 3801.13, expectedEur: 3070.2 }, parts)), [
    { paymentId: 381, amountEur: 3801.13, expectedAmountEur: 3070.2 },
    { paymentId: 392, amountEur: 3801.13, expectedAmountEur: 3070.2 },
    { purchaseOrderId: 40, amountEur: 3801.12, payee: 'SUPPLIER', instalmentDue: 'ORDERED', label: '30% bij bestelling', settles: false },
  ]);
  assert.deepEqual(clone(shareBody({ paymentId: 381, partEur: 3801.13, expectedEur: null }, [])), [{ paymentId: 381, amountEur: 3801.13 }]);
  assert.deepEqual(clone(sharePartsOf([parts[1]], 'LOGISTICS'))[0].payee, 'LOGISTICS');
  assert.deepEqual(clone(shareNewPart(38, { paidOn: '2026-09-28', amount: 9000, currency: 'EUR', label: '30% bij bestelling', payee: 'SUPPLIER', settles: false,
    instalmentDue: 'ORDERED', invoiceId: 7, inspectionViaSupplier: true })), { purchaseOrderId: 38, amountEur: 9000, payee: 'SUPPLIER', instalmentDue: 'ORDERED',
    label: '30% bij bestelling', settles: false, invoiceId: 7, inspectionViaSupplier: true });
});

test('shareToast names every container, its alias first', () => {
  assert.equal(plain(shareToast([{ name: 'PO-2026-038', amountEur: 3801.13 }, { name: 'Kerst 2026', amountEur: 3801.13 }, { name: 'PO-2026-040', amountEur: 3801.12 }])),
    'Verdeeld over 3 containers: PO-2026-038 € 3.801,13 · Kerst 2026 € 3.801,13 · PO-2026-040 € 3.801,12');
});

/** What 'Verdelen over containers' starts with, plus PO-040 added on this payment's term. */
function proposeAndAdd() {
  const all = options();
  const proposed = proposeShare(all, { orderId: 38, due: 'ORDERED', label: '30% bij bestelling', paidOn: '2026-09-26' }, 8);
  return [...proposed, alsoPartFor(all.find(option => option.orderId === 40)!, 'ORDERED', '30% bij bestelling')];
}

test('proposeShare: the same supplier\'s open payment on the same term noted within a week; never a linked one, an offset, another supplier or an older one', () => {
  const all = options();
  const proposed = proposeShare(all, { orderId: 38, due: 'ORDERED', label: '30% bij bestelling', paidOn: '2026-09-26' }, 8);
  assert.deepEqual(proposed.map(part => [part.orderId, part.paymentId, part.amount, part.alias]), [[39, 392, 3070.2, 'Kerst 2026']],
    'PO-041 is on the bank, PO-042 was noted twenty days earlier, PO-030 is another supplier');
  assert.deepEqual(clone(proposed[0].standing), { label: '30% bij bestelling', term: true, plannedEur: 3070.2, paidEur: 3070.2 });
  assert.deepEqual(proposeShare(all, { orderId: 38, due: 'SHIPPED', label: '70%', paidOn: '2026-09-26' }, 8), [], 'nothing on that term');
  assert.deepEqual(proposeShare(all, { orderId: 38, due: 'ORDERED', label: '', paidOn: '2026-10-20' }, 8), [], 'too far apart');
  assert.deepEqual(proposeShare(all, { orderId: 38, due: 'ORDERED', label: '', paidOn: '2026-09-26' }, null), []);
  // Without a term the label decides.
  const noTerm = alsoContainerOptions(payables, orders, names, 38, 8, { payments: [row(392, 39, 3070.2, { instalmentDue: null, label: 'Saldo' })], views });
  assert.equal(proposeShare(noTerm, { orderId: 38, due: null, label: 'saldo', paidOn: '2026-09-25' }, 8).length, 1);
  assert.equal(proposeShare(noTerm, { orderId: 38, due: null, label: 'Aanbetaling', paidOn: '2026-09-25' }, 8).length, 0);
  // Ten candidates: too many to guess, the owner adds them himself.
  const many = Array.from({ length: 10 }, (_, index) => row(500 + index, 60 + index, 1000));
  const manyViews = many.map((item: any) => view(item.orderId, 1000, 1000));
  const crowd = alsoContainerOptions([], manyViews.map((item: any) => ({ id: item.order.id, supplierId: 8 }) as any), names, 38, 8, { payments: many, views: manyViews });
  assert.equal(crowd.length, 10);
  assert.deepEqual(proposeShare(crowd, { orderId: 38, due: 'ORDERED', label: '', paidOn: '2026-09-25' }, 8), []);
  assert.equal(proposeShare(crowd.slice(0, 9), { orderId: 38, due: 'ORDERED', label: '', paidOn: '2026-09-25' }, 8).length, 9);
});

test('pendingLinkPlan: SHARE shares a larger euro transaction and a USD/CNY one; elsewhere it is ignored; the inspection split waits', () => {
  const line = [{ id: 610, amountEur: -11403.38 }];
  assert.deepEqual(pendingLinkPlan(3070.2, line, true, null), { kind: 'higher', lineId: 610, extraEur: 8333.18 });
  assert.deepEqual(pendingLinkPlan(3070.2, line, true, 'SHARE'), { kind: 'share', lineId: 610 });
  assert.deepEqual(pendingLinkPlan(3070.2, line, true, 'ADJUST'), { kind: 'part', lineId: 610, whole: true, surplus: 'ADJUST' });
  assert.deepEqual(pendingLinkPlan(11403.38, line, true, 'SHARE'), { kind: 'part', lineId: 610, whole: true }, 'a matching transaction is simply linked');
  assert.deepEqual(pendingLinkPlan(12000, line, true, 'SHARE'), { kind: 'part', lineId: 610, whole: false }, 'a smaller one carves');
  assert.equal(pendingLinkPlan(3070.2, line, false, 'SHARE').kind, 'invalid', 'an older server has no share');
  assert.deepEqual(pendingLinkPlan(3680, [{ id: 611, amountEur: -11403.38 }], true, 'SHARE', [], { amount: 4000, currency: 'USD', part: null }), { kind: 'share', lineId: 611 });
  assert.deepEqual(pendingLinkPlan(3680, [{ id: 611, amountEur: -11403.38 }], true, null, [], { amount: 4000, currency: 'USD', part: null }), { kind: 'part', lineId: 611, whole: true });
  assert.equal(pendingLinkPlan(3070.2, [...line, { id: 612, amountEur: -1 }], true, 'SHARE').kind, 'invalid', 'two transactions are never shared');
  assert.equal(inspectionSplitBlocked({ kind: 'share', lineId: 610 }), true);
  assert.deepEqual(linkChange({ amount: 3070.2, currency: 'EUR', amountEur: 3070.2, paidOn: '2026-09-25', proof: 'geen' },
    { amountEur: -11403.38, day: '2026-09-28', text: 'x' }, { kind: 'share', lineId: 610 }), [], "the share block says what changes, not 'Wat verandert'");
});
