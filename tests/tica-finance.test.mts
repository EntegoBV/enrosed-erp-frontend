import assert from 'node:assert/strict';
import test from 'node:test';
import type { BankStatementLine } from '../src/app/core/api/banking-api.ts';
import type { CompanyCost } from '../src/app/core/api/models.ts';
import type { TicaAnalyticsDay } from '../src/app/core/api/tica-api.ts';
import { salesAnalysis, resultAnalysis } from '../src/app/features/analyses/analysis-metrics.ts';
import { withTicaSales, withTicaResult } from '../src/app/features/analyses/tica-analysis.ts';
import { settlementDifference, ticaBankCandidates } from '../src/app/features/tica/tica-settlement-rules.ts';

const amounts = { salesExcl: 344.35, salesVat: 72.31, commissionExcl: 34.44, commissionVat: 7.23, netReceivable: 374.99 };
const daily: TicaAnalyticsDay[] = [{ date: '2026-10-17', transactionCount: 5, quantity: 7, revenueExcl: 344.35, goodsCostEur: 100, missingCostLines: 0 }];
const options = { from: '2026-10-01', to: '2026-10-31', today: '2026-10-20' };
test('TICA creditnota reconciles sales VAT, commission and net receipt in cents', () => {
  assert.equal(settlementDifference(amounts), 0);
  assert.equal(settlementDifference({ ...amounts, netReceivable: 374.97 }), .02);
  assert.equal(settlementDifference({ ...amounts, commissionVat: null }), null);
  assert.equal(settlementDifference({ ...amounts, salesExcl: NaN }), null);
});
test('bank candidates exclude allocated and classified receipts and tolerate at most two cents', () => {
  const line = (id: number, amountEur: number, extra: Partial<BankStatementLine> = {}) => ({ id, amountEur, bookedAt: '2026-10-20T12:00:00Z', counterparty: 'TICA', reference: '267653273', account: 'KBC', ...extra }) as BankStatementLine;
  const lines = [line(1, 374.99), line(2, 375.01), line(3, 375.02), line(4, -374.99), line(5, 374.99, { allocated: true }),
    line(6, 374.99, { classification: 'TICA_SETTLEMENT' }), line(7, 374.99, { ticaSettlementId: 4 }), line(8, 374.99, { salesPaymentId: 2 })];
  assert.deepEqual(ticaBankCandidates(lines, 374.99).map(row => row.id), [2, 1]);
  assert.equal(ticaBankCandidates(lines, 374.99, 'other').length, 0);
});
test('portal revenue adds a separate sales channel without invoice count or claims', () => {
  const base = salesAnalysis([], [], options), result = withTicaSales(base, daily);
  assert.equal(result.revenueExclEur, 344.35);
  assert.equal(result.marginEur, 244.35);
  assert.deepEqual(result.invoices, base.invoices);
  assert.equal(result.channels[0].invoiceCount, 0);
  assert.equal(result.channels[0].claimInclEur, 0);
  assert.equal(result.channels[0].ticaTransactions, 5);
  assert.equal(result.ticaMonthly[0].revenueExclEur, 344.35);
});
test('TICA P&L deducts commission once, current goods cost once, and preserves real invoice count', () => {
  const commission = { id: 77, date: '2026-10-19', description: 'TICA commissie', category: 'COMMISSIE', salesChannel: 'TICA', amountExclEur: 34.44,
    amountInclEur: 41.67, vatPct: 21, paidOn: '2026-10-19', ticaSettlementId: 1 } as CompanyCost;
  const base = resultAnalysis([], [], [commission], options), result = withTicaResult(base, daily);
  assert.equal(result.revenueEur, 344.35);
  assert.equal(result.goodsCostEur, 100);
  assert.equal(result.costsEur, 34.44);
  assert.equal(result.resultEur, 209.91);
  assert.equal(result.invoiceCount, 0);
  assert.equal(result.byChannel.length, 1);
  assert.equal(result.byChannel[0].resultEur, 209.91);
  assert.equal(result.monthly[0].resultEur, 209.91);
});
test('selected period, negative returns and unknown product costs remain visible', () => {
  const days = [...daily, { ...daily[0], date: '2026-09-30', revenueExcl: 9999 },
    { ...daily[0], date: '2026-10-18', revenueExcl: -10, goodsCostEur: -3, transactionCount: 1, missingCostLines: 2 }];
  const result = withTicaResult(resultAnalysis([], [], [], options), days);
  assert.equal(result.revenueEur, 334.35);
  assert.equal(result.goodsCostEur, 97);
  assert.equal(result.ticaTransactions, 6);
  assert.equal(result.missingCostLines, 2);
  assert.equal(result.byChannel[0].ticaMissingCostLines, 2);
});
