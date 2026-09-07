import assert from 'node:assert/strict';
import test from 'node:test';
import { isSettlementInvoice, partnerDocumentKind, settlementSplit } from '../src/app/features/sales/partner-settlement.ts';

test('the auction profit above the cost basis is split by the agreed share', () => {
  assert.deepEqual(settlementSplit(12000, 1152.8, 50), { costBasis: 1152.8, proceeds: 12000, profit: 10847.2, ours: 5423.6, theirs: 5423.6 });
  assert.deepEqual(settlementSplit(3000, 1000, 30), { costBasis: 1000, proceeds: 3000, profit: 2000, ours: 600, theirs: 1400 });
});

test('no profit means nothing to share, and odd input never breaks the sums', () => {
  assert.deepEqual(settlementSplit(900, 1000, 50), { costBasis: 1000, proceeds: 900, profit: -100, ours: 0, theirs: 0 });
  assert.deepEqual(settlementSplit(Number.NaN, 1000, 150).ours, 0);
  assert.equal(settlementSplit(2000, 1000, 150).ours, 1000, 'a share above 100 is capped');
});

test('a settlement invoice is recognised by its single profit-share line', () => {
  const settlement = { docType: 'FACTUUR', partnerPurchaseOrderId: 13, lines: [], extraLines: [{ description: 'Winstdeling veiling · PO-2026-008 · 50 % van € 3.998,40' }] };
  assert.equal(isSettlementInvoice(settlement), true);
  assert.equal(partnerDocumentKind(settlement), 'Slotfactuur winstdeling');
  assert.equal(isSettlementInvoice({ ...settlement, lines: [{}] }), false);
  assert.equal(partnerDocumentKind({ ...settlement, lines: [{}] }), 'Factuur aan kostprijs');
  assert.equal(partnerDocumentKind({ docType: 'OFFERTE', partnerPurchaseOrderId: 13, lines: [{}], extraLines: [] }), 'Offerte aan kostprijs');
  assert.equal(isSettlementInvoice({ docType: 'FACTUUR', partnerPurchaseOrderId: null, lines: [], extraLines: [{ description: 'Winstdeling' }] }), false);
});
