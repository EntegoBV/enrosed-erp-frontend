import assert from 'node:assert/strict';
import test from 'node:test';
import { schedulePreset, scheduleRowAmount, scheduleRowAmounts, scheduleRequest } from '../src/app/features/purchasing/partner-advance-schedule-state.ts';
import { partialSettlementPreview } from '../src/app/features/sales/partner-settlement-progress.ts';
import type { PartnerSettlementAvailability } from '../src/app/core/api/models.ts';

test('30/70 invoices divide the financed partner amount, not the whole container', () => {
  const containerCost = 12000;
  for (const [fundingPct, expected] of [[50, [1800, 4200]], [100, [3600, 8400]]] as const) {
    const agreed = containerCost * fundingPct / 100;
    const rows = schedulePreset('30_70', agreed);
    assert.deepEqual(rows.map((row) => scheduleRowAmount(row, agreed)), expected);
    assert.deepEqual(scheduleRequest(rows, agreed).rows.map((row) => row.percentage), [30, 70]);
  }
});

test('thirds preserve the exact agreed cents and arbitrary amount/date terms stay explicit', () => {
  const rows = schedulePreset('THIRDS', 1000);
  assert.deepEqual(rows.map((row) => row.value), [333.33, 666.67]);
  rows[0].dueDate = '2026-10-01';
  assert.equal(scheduleRequest(rows, 1000).rows[0].dueDate, '2026-10-01');
  assert.throws(() => scheduleRequest([{ ...rows[0], value: 1001 }], 1000), /overschrijden/);
  assert.throws(() => scheduleRequest([{ ...rows[0], value: 1.001 }], 1000), /decimalen/);
  assert.throws(() => scheduleRequest(rows, 1000, 200), /overschrijden/, 'older advances reserve part of the agreed amount');
});

test('100% plans assign rounding residual only to an unbilled percentage row', () => {
  const rows = schedulePreset('30_70', .05).map((row) => ({ ...row, value: 50 }));
  assert.deepEqual(scheduleRowAmounts(rows, .05), [.03, .02]);
  assert.deepEqual(scheduleRowAmounts([{ ...rows[0], locked: true, fixedAmountEur: .02 }, rows[1]], .05), [.02, .03]);
  assert.doesNotThrow(() => scheduleRequest(rows, .05));
});

test('unused saved terms can all be removed before beginning the auction settlement', () => {
  assert.throws(() => scheduleRequest([], 6000), /minstens/);
  assert.deepEqual(scheduleRequest([], 6000, 0, true), { rows: [] });
});

const availability = (cost = 12000, advance = 6000): PartnerSettlementAvailability => ({
  purchaseOrderId: 1, partnerCustomerId: 2, externalCostEur: cost, issuedAdvanceEur: advance, creditedAdvanceEur: 0, remainingAdvanceEur: advance,
  lines: [{ productId: 9, productName: 'Roses', totalQuantity: 100, settledQuantity: 0, remainingQuantity: 100, totalCostEur: cost, settledCostEur: 0, remainingCostEur: cost }], settlements: [],
});

test('partial auctions allocate cost and advance once, with final batch taking exact residual', () => {
  const first = partialSettlementPreview(availability(), { 9: 40 }, { 9: 8000 }, 50);
  assert.equal(first.quantity, 40);
  assert.equal(first.costEur, 4800);
  assert.equal(first.advanceEur, 2400);
  assert.equal(first.profitShareEur, 1600);
  assert.equal(first.netEur, 4000);
  assert.equal(first.remainingQuantity, 60);
  assert.equal(first.finalSettlement, false);
  const remaining = availability();
  remaining.remainingAdvanceEur = 3600;
  Object.assign(remaining.lines[0], { settledQuantity: 40, remainingQuantity: 60, settledCostEur: 4800, remainingCostEur: 7200 });
  const final = partialSettlementPreview(remaining, { 9: 60 }, { 9: 12000 }, 50);
  assert.equal(final.finalSettlement, true);
  assert.equal(final.remainingQuantity, 0);
  assert.equal(first.costEur + final.costEur, 12000);
  assert.equal(first.advanceEur + final.advanceEur, 6000);
  assert.equal(first.profitShareEur + final.profitShareEur, 4000);
  assert.equal(first.netEur + final.netEur, 10000);
});

test('unselected products and loss batches do not lose reserved cost or hide credit', () => {
  const zero = partialSettlementPreview(availability(), {}, {}, 50);
  assert.equal(zero.costEur, 0);
  assert.equal(zero.advanceEur, 0);
  assert.equal(zero.finalSettlement, false);
  const loss = partialSettlementPreview(availability(3000, 3000), { 9: 100 }, { 9: 0 }, 50);
  assert.equal(loss.profitShareEur, -1500);
  assert.equal(loss.netEur, -1500);
  const halfCentLoss = partialSettlementPreview(availability(.01, .01), { 9: 100 }, { 9: 0 }, 50);
  assert.equal(halfCentLoss.profitShareEur, -.01, 'negative half cents round away from zero like the server');
});
