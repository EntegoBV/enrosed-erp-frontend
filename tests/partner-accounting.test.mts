import assert from 'node:assert/strict';
import test from 'node:test';
import type { PartnerFinancing, PurchaseOrderView, SalesOrderView } from '../src/app/core/api/models.ts';
import { documentAccounting, partnerFinancingAnalysis, resultAnalysis, salesAnalysis } from '../src/app/features/analyses/analysis-metrics.ts';

function document(id: number, purpose: 'PARTNER_ADVANCE' | 'PARTNER_SETTLEMENT', claim: number, revenue: number, cost: number, paid = 0): SalesOrderView {
  return { order: { id, number: `PARTNER-${id}`, docType: 'FACTUUR', status: 'VERZONDEN', orderDate: '2026-09-08', invoiceDueDate: '2026-09-09', purpose, partnerPurchaseOrderId: 1, partnerSettlement: purpose === 'PARTNER_SETTLEMENT', salesChannel: 'PARTNER' },
    priced: { totals: { total: claim, totalInclVat: claim, goodsTotal: 3300, costTotal: 0, marginEur: 3300, pieces: 100 }, lines: [{ productId: 1, quantity: 100, net: 3300, sku: 'ROSE', description: 'Roos' }], validation: { productsWithoutCost: [] } },
    accounting: { recognizedRevenueEur: revenue, recognizedCostEur: cost, recognizedProfitEur: revenue - cost, recognizedQuantity: purpose === 'PARTNER_ADVANCE' ? 0 : 100 },
    paymentSummary: { invoiceTotalEur: claim, receivedEur: paid, remainingEur: Math.max(0, claim - paid), overpaidEur: Math.max(0, paid - claim), creditEur: 0, status: paid >= claim ? 'PAID' : 'PARTIAL', payments: [], instalments: [], legacyPaidMarker: false },
  } as unknown as SalesOrderView;
}
const purchase = { order: { id: 1, number: 'PO-1', partnerCustomerId: 7, partnerCostPct: 100, partnerSharePct: 50, status: 'ONTVANGEN' }, costing: { totals: { totalEur: 3000 } }, reconciliation: { totals: { forecastExternalEur: 3000, paidEur: 3000 } } } as unknown as PurchaseOrderView;

test('fully financed container C3000 with profit share300 recognizes 3300 revenue, 3000 cost, 300 profit once', () => {
  const advance = document(1, 'PARTNER_ADVANCE', 3000, 0, 0, 3000);
  const final = document(2, 'PARTNER_SETTLEMENT', 300, 3300, 3000);
  const result = resultAnalysis([advance, final], [], []);
  assert.equal(result.revenueEur, 3300);
  assert.equal(result.goodsCostEur, 3000);
  assert.equal(result.resultEur, 300);
  assert.equal(result.byChannel[0].resultEur, 300);
  assert.equal(result.monthly[0].resultEur, 300);
  const sales = salesAnalysis([advance, final], [], { today: '2026-09-10' });
  assert.equal(sales.invoices.issuedValueEur, 3300);
  assert.equal(sales.invoices.outstandingValueEur, 300);
  assert.equal(sales.invoices.overdueValueEur, 300);
  assert.equal(sales.topProducts[0].pieces, 100, 'the advance never counts the same products twice');
  assert.equal(sales.topCustomers[0].pieces, 100);
});

test('co-financing 50 percent changes the advance and final claim, not the economic result', () => {
  const advance = document(1, 'PARTNER_ADVANCE', 1500, 0, 0, 1000);
  const final = document(2, 'PARTNER_SETTLEMENT', 1800, 3300, 3000);
  const result = resultAnalysis([advance, final], [], []);
  assert.equal(result.resultEur, 300);
  const sales = salesAnalysis([advance, final], [], { today: '2026-09-10' });
  assert.equal(sales.invoices.paidValueEur, 1000);
  assert.equal(sales.invoices.outstandingValueEur, 2300);
});

test('before settlement neither a paid advance nor a draft final reports turnover, loss or inventory sale', () => {
  const advance = document(1, 'PARTNER_ADVANCE', 1500, 0, 0, 1500);
  const final = document(2, 'PARTNER_SETTLEMENT', 1800, 3300, 3000);
  final.order.status = 'CONCEPT';
  assert.equal(resultAnalysis([advance, final], [], []).resultEur, 0);
  assert.equal(resultAnalysis([advance, final], [], []).revenueEur, 0);
  assert.equal(documentAccounting(advance).recognizedQuantity, 0);
  assert.equal(salesAnalysis([advance, final], []).topProducts.length, 0);
});

test('partner funding quotes do not inflate the regular sales pipeline or conversion funnel', () => {
  const funding = document(1, 'PARTNER_ADVANCE', 3000, 0, 0);
  funding.order.docType = 'OFFERTE';
  const analysis = salesAnalysis([funding], []);
  assert.equal(analysis.pipeline.calculatedValueEur, 0);
  assert.equal(analysis.funnel.created, 0);
});

test('partner containers with no documents still have agreed financing and no invented loss', () => {
  const result = partnerFinancingAnalysis([purchase], []);
  assert.equal(result.partner.count, 1);
  assert.equal(result.own.count, 0);
  assert.equal(result.resultEur, 0);
  assert.equal(result.committedAdvanceEur, 3000);
  assert.equal(result.awaitingSettlement, 1);
});

test('partner cash, open claims, financing exposure and result use authoritative server fields', () => {
  const summary = { purchaseOrderId: 1, partnerCustomerId: 7, partnerName: 'Partner', profitSharePct: 50, costPct: 100, forecastExternalEur: 3000,
    committedAdvanceEur: 3000, invoicedAdvanceEur: 3000, totalReceivedEur: 1000, totalOpenEur: 2300, ownExposureEur: 2000,
    recognizedProfitEur: 300, settlementEur: 300, creditEur: 0, costFinalized: true,
    documents: [{ id: 2, number: 'PARTNER-2', purpose: 'PARTNER_SETTLEMENT', docType: 'FACTUUR', status: 'VERZONDEN' }], payments: [],
  } as unknown as PartnerFinancing;
  const result = partnerFinancingAnalysis([purchase], [], [], [summary]);
  assert.equal(result.receivedEur, 1000);
  assert.equal(result.openEur, 2300);
  assert.equal(result.ownExposureEur, 2000);
  assert.equal(result.resultEur, 300);
  assert.equal(result.rows[0].settled, true);
  assert.equal(result.awaitingSettlement, 0);
  assert.equal(result.rows[0].documents[0].number, 'PARTNER-2');
});
