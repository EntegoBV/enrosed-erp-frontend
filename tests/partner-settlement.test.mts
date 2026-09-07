import assert from 'node:assert/strict';
import test from 'node:test';
import {
  auctionLineSplit, auctionTotals, isSettlementInvoice, partnerDocumentKind,
} from '../src/app/features/sales/partner-settlement.ts';

test('an auction line recovers the financed cost and shares the profit above the full landed cost', () => {
  /* We financed everything: the partner pays the cost back plus half the profit. */
  const financed = auctionLineSplit(40, 5000, 75, 100, 50);
  assert.deepEqual(financed, { cost: 3000, proceeds: 5000, profit: 2000, costPart: 3000, profitPart: 1000, ours: 4000 });
  /* The partner paid the cost up front: only the profit share is left. */
  const upfront = auctionLineSplit(40, 5000, 75, 0, 50);
  assert.equal(upfront.ours, 1000);
  /* Half financed: half the cost back plus the profit share. */
  assert.equal(auctionLineSplit(40, 5000, 75, 50, 50).ours, 1500 + 1000);
});

test('a loss at auction reduces our part and never turns the line negative', () => {
  const loss = auctionLineSplit(10, 400, 50, 0, 50);
  assert.equal(loss.profit, -100);
  assert.equal(loss.profitPart, -50);
  assert.equal(loss.ours, 0);
  const financedLoss = auctionLineSplit(10, 400, 50, 100, 50);
  assert.equal(financedLoss.ours, 500 - 50, 'the financed cost comes back, minus our share of the loss');
  assert.deepEqual(auctionLineSplit(0, 100, 5, 100, 50), { cost: 0, proceeds: 100, profit: 100, costPart: 0, profitPart: 50, ours: 50 });
});

test('auction totals add the lines up', () => {
  const totals = auctionTotals([auctionLineSplit(40, 5000, 75, 0, 50), auctionLineSplit(10, 400, 50, 0, 50)]);
  assert.deepEqual(totals, { cost: 3500, proceeds: 5400, profit: 1900, costPart: 0, profitPart: 950, ours: 1000 });
});

test('a settlement invoice is recognised by its flag, or by the old single profit-share line', () => {
  const flagged = { docType: 'FACTUUR', partnerPurchaseOrderId: 13, partnerSettlement: true, lines: [{}], extraLines: [] };
  assert.equal(isSettlementInvoice(flagged), true);
  assert.equal(partnerDocumentKind(flagged), 'Veilingafrekening');
  const legacy = { docType: 'FACTUUR', partnerPurchaseOrderId: 13, lines: [], extraLines: [{ description: 'Winstdeling veiling · PO-2026-008 · 50 % van € 3.998,40' }] };
  assert.equal(isSettlementInvoice(legacy), true);
  assert.equal(partnerDocumentKind({ ...legacy, lines: [{}] }), 'Factuur aan kostprijs');
  assert.equal(partnerDocumentKind({ docType: 'OFFERTE', partnerPurchaseOrderId: 13, lines: [{}], extraLines: [] }), 'Offerte aan kostprijs');
  assert.equal(isSettlementInvoice({ docType: 'FACTUUR', partnerPurchaseOrderId: null, partnerSettlement: true, lines: [], extraLines: [] }), false);
});
