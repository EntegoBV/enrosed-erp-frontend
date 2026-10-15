import assert from 'node:assert/strict';
import test from 'node:test';
import { alsoContainerOptions, alsoNotice, alsoPartFor, alsoTotalEur, alsoWrites, rebalancedGoods } from '../src/app/features/purchasing/purchase-also-containers.ts';

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
  assert.equal(alsoNotice(parts), 'Ook op PO-2026-044 en PO-2026-045');
  assert.equal(alsoNotice(parts.slice(0, 1)), 'Ook op PO-2026-044');
  assert.equal(alsoNotice([...parts, { ...parts[0], orderId: 30, number: 'PO-2026-030' }]), 'Ook op PO-2026-044, PO-2026-045 en PO-2026-030');
  assert.equal(alsoNotice([]), null);
});
