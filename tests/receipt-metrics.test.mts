import assert from 'node:assert/strict';
import test from 'node:test';
import {
  averageLeadDays,
  supplierScorecards,
  inDateRange,
  receiptLineMetrics,
  receiptMetrics,
  supplierReceiptPerformance,
} from '../src/app/features/analyses/receipt-metrics.ts';

test('receipt arithmetic separates shortage, over-receipt, damage and usable pieces', () => {
  assert.deepEqual(receiptLineMetrics({
    orderedPieces: 10, receivedPieces: 8, damagedPieces: 2, unitValueEur: 4.5,
  }), {
    orderedPieces: 10,
    receivedPieces: 8,
    missingPieces: 2,
    overReceivedPieces: 0,
    damagedPieces: 2,
    usablePieces: 6,
    lossPieces: 4,
    unitValueEur: 4.5,
    missingValueEur: 9,
    damagedValueEur: 9,
    totalLossValueEur: 18,
    valuationComplete: true,
  });

  const over = receiptLineMetrics({
    orderedPieces: 10, receivedPieces: 12, damagedPieces: 1, unitValueEur: 2,
  });
  assert.equal(over.missingPieces, 0);
  assert.equal(over.overReceivedPieces, 2);
  assert.equal(over.usablePieces, 11);
  assert.equal(over.totalLossValueEur, 2);
});

test('unknown value remains explicit while known loss values still total', () => {
  const totals = receiptMetrics([
    { orderedPieces: 10, receivedPieces: 8, damagedPieces: 0, unitValueEur: null },
    { orderedPieces: 5, receivedPieces: 5, damagedPieces: 1, unitValueEur: 7 },
  ]);
  assert.equal(totals.totalLossValueEur, 7);
  assert.equal(totals.unvaluedLossPieces, 2);
  assert.equal(totals.valuationComplete, false);
  assert.equal(totals.affectedLines, 2);
});

test('damage is clamped to received and invalid quantities never become negative', () => {
  const line = receiptLineMetrics({
    orderedPieces: -2, receivedPieces: 3.8, damagedPieces: 9, unitValueEur: -1,
  });
  assert.equal(line.orderedPieces, 0);
  assert.equal(line.receivedPieces, 3);
  assert.equal(line.damagedPieces, 3);
  assert.equal(line.usablePieces, 0);
  assert.equal(line.unitValueEur, null);
});

test('supplier performance excludes legacy unknown snapshots from perfect receipts', () => {
  const result = supplierReceiptPerformance([
    { receivedOn: '2026-04-09', expectedArrival: '2026-04-10',
      lines: [{ orderedQuantity: 10, quantity: 10, damagedQuantity: 0 }] },
    { receivedOn: '2026-05-12', expectedArrival: '2026-05-10',
      lines: [{ orderedQuantity: 10, quantity: 8, damagedQuantity: 1 }] },
    { receivedOn: '2026-06-01', expectedArrival: null,
      lines: [{ orderedQuantity: null, quantity: 5, damagedQuantity: 0 }] },
  ]);
  assert.equal(result.receivedOrders, 3);
  assert.equal(result.comparableOrders, 2);
  assert.equal(result.perfectOrders, 1);
  assert.equal(result.unknownOrders, 1);
  assert.equal(result.perfectPct, 50);
  assert.equal(result.assessedPieces, 20);
  assert.equal(result.goodPieces, 17);
  assert.equal(result.qualityPct, 85);
  assert.equal(result.datedOrders, 2);
  assert.equal(result.onTimeOrders, 1);
  assert.equal(result.onTimePct, 50);
});

test('ISO-day range boundaries are inclusive', () => {
  assert.equal(inDateRange('2026-01-01', '2026-01-01', '2026-12-31'), true);
  assert.equal(inDateRange('2025-12-31', '2026-01-01', '2026-12-31'), false);
  assert.equal(inDateRange(null, '2026-01-01', '2026-12-31'), false);
});

test('supplier scorecards line every supplier up by business, quality and speed', () => {
  const cards = supplierScorecards([
    { supplierId: 1, supplierName: 'Ningbo Glass', orderDate: '2026-01-10', receivedOn: '2026-03-01', expectedArrival: '2026-03-05', totalEur: 12_000,
      lines: [{ orderedQuantity: 10, quantity: 10, damagedQuantity: 0 }] },
    { supplierId: 1, supplierName: 'Ningbo Glass', orderDate: '2026-02-01', receivedOn: '2026-04-02', expectedArrival: '2026-04-01', totalEur: 8_000,
      lines: [{ orderedQuantity: 10, quantity: 9, damagedQuantity: 0 }] },
    { supplierId: 2, supplierName: 'Yiwu Foam', orderDate: null, receivedOn: '2026-05-01', expectedArrival: null, totalEur: 30_000,
      lines: [{ orderedQuantity: 5, quantity: 5, damagedQuantity: 0 }] },
  ]);
  assert.deepEqual(cards.map((card) => card.name), ['Yiwu Foam', 'Ningbo Glass']);
  assert.deepEqual(cards[1], {
    supplierId: 1, name: 'Ningbo Glass', orders: 2, totalEur: 20_000, perfectPct: 50, onTimePct: 50,
    avgLeadDays: 55, latestReceivedOn: '2026-04-02',
  });
  assert.equal(cards[0].avgLeadDays, null);
  assert.equal(averageLeadDays([{ orderDate: '2026-01-01', receivedOn: '2026-01-31' }, { orderDate: null, receivedOn: '2026-02-01' }]), 30);
  assert.equal(averageLeadDays([]), null);
});
