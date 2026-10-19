import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  Customer,
  ExpectedStock,
  PricedLine,
  CompanyCost,
  Product,
  PurchaseOrderView,
  QuoteStatus,
  SalesOrderView,
} from '../src/app/core/api/models.ts';
import {
  inventoryAnalysis,
  openPipelineQuotes,
  partnerFinancingAnalysis,
  piecesSoldByProduct,
  resultAnalysis,
  salesAnalysis,
} from '../src/app/features/analyses/analysis-metrics.ts';
import { costChargeIn, openOf } from '../src/app/features/finance/finance-metrics.ts';

interface SalesFixture {
  id: number;
  date?: string;
  docType?: 'OFFERTE' | 'FACTUUR';
  status?: QuoteStatus;
  total?: number;
  claim?: number;
  goods?: number;
  margin?: number;
  pieces?: number;
  sent?: boolean;
  viewed?: boolean;
  due?: string | null;
  customerId?: number;
  missingCosts?: string[];
  awaitingResend?: boolean;
  deliveryTerms?: 'VOLLEDIG' | 'TE_BEPALEN' | 'AANGEVULD';
  freight?: 'BEREKEND' | 'TE_BEPALEN' | 'AANGEVULD';
  lines?: Partial<PricedLine>[];
}

function salesRow(input: SalesFixture): SalesOrderView {
  const total = input.total ?? 0;
  const pieces = input.pieces ?? 0;
  return {
    order: {
      id: input.id,
      number: `${input.docType === 'FACTUUR' ? 'INV' : 'OFF'}-${input.id}`,
      customerId: input.customerId ?? 1,
      orderDate: input.date ?? '2026-04-10',
      status: input.status ?? 'CONCEPT',
      docType: input.docType ?? 'OFFERTE',
      sentAt: input.sent ? '2026-04-11T10:00:00Z' : null,
      viewedAt: input.viewed ? '2026-04-12T10:00:00Z' : null,
      viewCount: input.viewed ? 1 : 0,
      invoiceDueDate: input.due ?? null,
      deliveryTerms: input.deliveryTerms ?? 'VOLLEDIG',
      freight: input.freight ?? 'BEREKEND',
    },
    priced: {
      lines: (input.lines ?? []).map((line, index) => ({
        productId: line.productId ?? index + 1,
        sku: line.sku ?? `SKU-${index + 1}`,
        description: line.description ?? `Product ${index + 1}`,
        quantity: line.quantity ?? pieces,
        net: line.net ?? total,
        ...line,
      })),
      totals: {
        pieces,
        total,
        totalInclVat: input.claim ?? total,
        goodsTotal: input.goods ?? total,
        marginEur: input.margin ?? 0,
      },
      validation: { productsWithoutCost: input.missingCosts ?? [] },
    },
    awaitingResend: input.awaitingResend ?? false,
  } as SalesOrderView;
}

test('sales analysis keeps a clear cohort funnel and current-calculation values', () => {
  const rows: SalesOrderView[] = [
    salesRow({ id: 1, total: 100, pieces: 5, missingCosts: ['SKU-X'] }),
    salesRow({ id: 2, status: 'BEKEKEN', total: 200, pieces: 10, sent: true,
      viewed: true, deliveryTerms: 'TE_BEPALEN' }),
    salesRow({ id: 3, status: 'GEACCEPTEERD', total: 300, pieces: 20,
      sent: true, viewed: true }),
    salesRow({ id: 4, status: 'AFGEWEZEN', total: 400, pieces: 30, sent: true }),
    salesRow({ id: 5, status: 'VERLOPEN', total: 500, pieces: 40, sent: true }),
    salesRow({ id: 6, docType: 'FACTUUR', status: 'CONCEPT', total: 600,
      claim: 726, pieces: 15 }),
    salesRow({ id: 7, docType: 'FACTUUR', status: 'VERZONDEN', total: 700,
      claim: 847, goods: 600, margin: 200, pieces: 30, sent: true,
      due: '2026-05-01', customerId: 1,
      lines: [{ productId: 1, sku: 'P-1', description: 'Roos', quantity: 30, net: 600 }] }),
    salesRow({ id: 8, docType: 'FACTUUR', status: 'BETAALD', total: 800,
      claim: 968, goods: 700, margin: 250, pieces: 25, sent: true,
      customerId: 1,
      lines: [
        { productId: 1, sku: 'P-1', description: 'Roos', quantity: 10, net: 300 },
        { productId: 2, sku: 'P-2', description: 'Box', quantity: 15, net: 400 },
      ] }),
    salesRow({ id: 9, date: '2025-12-31', status: 'GEACCEPTEERD', total: 9_999,
      pieces: 100, sent: true, viewed: true }),
  ];
  const customers = [{ id: 1, company: 'Bloemenhuis' }] as Customer[];

  const result = salesAnalysis(rows, customers, {
    from: '2026-01-01', to: '2026-12-31', today: '2026-06-01', topLimit: 5,
  });

  assert.equal(result.valueBasis, 'CURRENT_ORDER_PRICING');
  assert.deepEqual(result.period, { from: '2026-01-01', to: '2026-12-31' });
  assert.deepEqual(result.pipeline, {
    count: 2, pieces: 15, calculatedValueEur: 300, missingCostLines: 1,
  });
  assert.deepEqual(result.funnel, {
    created: 5,
    sent: 4,
    viewed: 2,
    accepted: 1,
    rejected: 1,
    expired: 1,
    closed: 3,
    open: 2,
    cancelled: 0,
    sendRatePct: 80,
    viewRatePct: 50,
    conversionRatePct: (1 / 3) * 100,
  });
  assert.equal(result.accepted.calculatedValueEur, 300);
  assert.equal(result.accepted.pieces, 20);

  assert.deepEqual(result.invoices, {
    created: 3,
    draft: 1,
    issued: 2,
    paid: 1,
    outstanding: 1,
    overdue: 1,
    issuedValueEur: 1_815,
    paidValueEur: 968,
    outstandingValueEur: 847,
    overdueValueEur: 847,
    averageClaimEur: 907.5,
    avgDaysToPaid: null,
    marginEur: 450,
    marginPct: 30,
    missingCostLines: 0,
    creditedEur: 0,
    creditNoteCount: 0,
    revenueExclEur: 1_500,
    advanceClaimEur: 0,
  });
  assert.deepEqual(result.topCustomers, [{
    customerId: 1,
    name: 'Bloemenhuis',
    orderCount: 2,
    pieces: 55,
    calculatedValueEur: 1_815,
  }]);
  assert.deepEqual(result.topProducts, [
    {
      productId: 1,
      sku: 'P-1',
      name: 'Roos',
      orderCount: 2,
      pieces: 40,
      calculatedGoodsValueEur: 900,
    },
    {
      productId: 2,
      sku: 'P-2',
      name: 'Box',
      orderCount: 1,
      pieces: 15,
      calculatedGoodsValueEur: 400,
    },
  ]);
  assert.equal(result.attentionOrders[0].orderId, 7);
  assert.equal(result.attentionOrders[0].severity, 'danger');
  assert.ok(result.attentionOrders.some((row) =>
    row.orderId === 2 && row.reasons.includes('Levertermijn invullen')));
  assert.ok(result.attentionOrders.some((row) =>
    row.orderId === 1 && row.reasons.includes('1 productregel zonder kostprijs')));
});

test('sales rates stay null when a cohort has no denominator', () => {
  const result = salesAnalysis([], [], { today: '2026-06-01' });
  assert.equal(result.funnel.sendRatePct, null);
  assert.equal(result.funnel.viewRatePct, null);
  assert.equal(result.funnel.conversionRatePct, null);
  assert.equal(result.invoices.marginPct, null);
});

interface ProductFixture {
  id: number;
  name?: string;
  stock: number;
  known?: boolean | null;
  active?: boolean;
  demo?: boolean;
  per?: number | null;
  cost?: number | null;
  sales?: number;
}

function product(input: ProductFixture): Product {
  return {
    id: input.id,
    sku: `SKU-${input.id}`,
    name: input.name ?? `Product ${input.id}`,
    colour: input.id % 2 ? 'Rood' : null,
    inventoryKnown: input.known === undefined ? true : input.known,
    stockQuantity: input.stock,
    active: input.active ?? true,
    demo: input.demo ?? false,
    carton: { piecesPerCarton: input.per === undefined ? 6 : input.per },
    landedCostEur: input.cost === undefined ? 2 : input.cost,
    computedSalesPriceEur: input.sales ?? 5,
  } as Product;
}

test('only products sold per full carton are short of one; per display or per unit they still sell', () => {
  const sold = (id: number, orderStep?: 'CARTON' | 'PACKAGE' | 'UNIT' | null) =>
    ({ ...product({ id, stock: 5, per: 12 }), packaging: { orderStep } } as Product);
  const result = inventoryAnalysis([
    product({ id: 1, stock: 5, per: 12 }), sold(2, 'CARTON'), sold(3, null), sold(4, 'UNIT'), sold(5, 'PACKAGE'),
  ], [], { topLimit: 3 });
  assert.deepEqual(result.belowCarton.rows.map((row) => row.productId), [1, 2, 3]);
  assert.equal(result.belowCarton.count, 3);
});

test('inventory analysis separates current value, data gaps and carton attention', () => {
  const products: Product[] = [
    product({ id: 1, name: 'Nul met levering', stock: 0, per: 6, cost: 5, sales: 10 }),
    product({ id: 2, name: 'Losse doos', stock: 5, per: 6, cost: 2, sales: 5 }),
    product({ id: 3, name: 'Geen kost', stock: 12, per: 6, cost: null, sales: 8 }),
    product({ id: 4, name: 'Voorraad onbekend', stock: 20, known: false, per: 6, cost: 1 }),
    product({ id: 5, name: 'Inactief kapitaal', stock: 10, active: false, per: 6, cost: 10 }),
    product({ id: 6, name: 'Negatieve stand', stock: -2, per: 6, cost: 2 }),
    product({ id: 7, name: 'Geen omdoos', stock: 3, per: null, cost: 4, sales: 8 }),
    product({ id: 8, name: 'Demo', stock: 4, demo: true, per: 1, cost: 5, sales: 12 }),
  ];
  const expected: ExpectedStock[] = [
    { productId: 1, quantity: 2, expectedArrival: '2026-11-01', orderIds: [11], orderNumbers: ['PO-11'] },
    { productId: 1, quantity: 4, expectedArrival: '2026-10-01', orderIds: [12], orderNumbers: ['PO-12'] },
    { productId: 9, quantity: 10, expectedArrival: null, orderIds: [13], orderNumbers: ['PO-13'] },
  ];

  const result = inventoryAnalysis(products, expected, { topLimit: 3 });

  assert.equal(result.snapshotBasis, 'CURRENT_PRODUCT_DATA');
  assert.deepEqual(result.stock, {
    knownSkuCount: 7,
    unknownSkuCount: 1,
    knownPieces: 32,
    positivePieces: 34,
    valuedPieces: 22,
    costValueEur: 142,
    partnerPieces: 0,
    partnerCostValueEur: 0,
    ownCostValueEur: 142,
    saleablePieces: 20,
    salesValueEur: 145,
    potentialUpliftEur: null,
  });
  assert.deepEqual(result.dataGaps, {
    unknownStockSkuCount: 1,
    unvaluedStockSkuCount: 1,
    unvaluedStockPieces: 12,
    missingCartonSkuCount: 1,
    negativeStockSkuCount: 1,
  });
  assert.equal(result.zeroStock.count, 2);
  assert.equal(result.zeroStock.withIncomingCount, 1);
  assert.equal(result.zeroStock.withoutIncomingCount, 1);
  assert.equal(result.zeroStock.rows[0].productId, 6);
  assert.equal(result.zeroStock.rows[1].expectedPieces, 6);
  assert.equal(result.zeroStock.rows[1].nextArrival, '2026-10-01');
  assert.deepEqual(result.zeroStock.rows[1].orderIds, [11, 12]);

  assert.equal(result.belowCarton.count, 1);
  assert.equal(result.belowCarton.rows[0].productId, 2);
  assert.equal(result.belowCarton.rows[0].missingPiecesToCarton, 1);

  assert.equal(result.incoming.skuCount, 2);
  assert.equal(result.incoming.pieces, 16);
  assert.equal(result.incoming.nextArrival, '2026-10-01');
  assert.equal(result.incoming.rows[0].productId, 1);
  assert.deepEqual(result.incoming.rows[0].orderNumbers, ['PO-11', 'PO-12']);

  assert.equal(result.topCapital.length, 3);
  assert.equal(result.topCapital[0].productId, 5);
  assert.equal(result.topCapital[0].costValueEur, 100);
  assert.equal(result.topCapital[0].sharePct, (100 / 142) * 100);
});

test('inventory uplift is available only when every saleable stock line has a cost', () => {
  const result = inventoryAnalysis([
    product({ id: 1, stock: 4, cost: 2, sales: 5 }),
    product({ id: 2, stock: 6, cost: 3, sales: 7 }),
  ], []);
  assert.equal(result.stock.salesValueEur, 62);
  assert.equal(result.stock.potentialUpliftEur, 36);
});

test('sales analysis adds the month by month view, countries and the payment term', () => {
  const paid = salesRow({ id: 21, date: '2026-02-10', docType: 'FACTUUR', status: 'BETAALD', total: 500, claim: 605 });
  paid.order.paidAt = '2026-03-02T09:00:00Z';
  paid.order.countryCode = 'de';
  const open = salesRow({ id: 22, date: '2026-03-15', docType: 'FACTUUR', status: 'VERZONDEN', total: 300, claim: 363 });
  open.order.countryCode = 'BE';
  const paidFast = salesRow({ id: 23, date: '2026-03-20', docType: 'FACTUUR', status: 'BETAALD', total: 100, claim: 121 });
  paidFast.order.paidAt = '2026-03-26T09:00:00Z';
  paidFast.order.countryCode = 'DE';
  const rows = [
    paid, open, paidFast,
    salesRow({ id: 24, date: '2026-01-05', status: 'GEACCEPTEERD', total: 900 }),
    salesRow({ id: 25, date: '2026-03-05', status: 'VERZONDEN', total: 50 }),
  ];
  const result = salesAnalysis(rows, [], { from: '2026-01-01', to: '2026-04-30', today: '2026-05-01' });

  assert.deepEqual(result.monthly, [
    { month: '2026-01', invoicedEur: 0, acceptedEur: 900, quotesCreated: 1, invoicesIssued: 0 },
    { month: '2026-02', invoicedEur: 605, acceptedEur: 0, quotesCreated: 0, invoicesIssued: 1 },
    { month: '2026-03', invoicedEur: 484, acceptedEur: 0, quotesCreated: 1, invoicesIssued: 2 },
    { month: '2026-04', invoicedEur: 0, acceptedEur: 0, quotesCreated: 0, invoicesIssued: 0 },
  ]);
  assert.deepEqual(result.topCountries, [
    { countryCode: 'DE', orderCount: 2, calculatedValueEur: 726 },
    { countryCode: 'BE', orderCount: 1, calculatedValueEur: 363 },
  ]);
  assert.equal(result.invoices.avgDaysToPaid, 13);
  assert.equal(result.invoices.averageClaimEur, 363);
  assert.deepEqual(salesAnalysis([], [], {}).monthly, []);
});

test('inventory analysis reads the sales pace into reorder advice and slow movers', () => {
  const products: Product[] = [
    product({ id: 1, name: 'Hardloper', stock: 10, per: 6, cost: 5, sales: 10 }),
    product({ id: 2, name: 'Gedekt', stock: 100, per: 6, cost: 2, sales: 5 }),
    product({ id: 3, name: 'Slaper', stock: 40, per: 6, cost: 3, sales: 8 }),
    product({ id: 4, name: 'Onderweg genoeg', stock: 2, per: 6, cost: 4, sales: 8 }),
  ];
  const sales: SalesOrderView[] = [
    salesRow({ id: 50, date: '2026-05-20', docType: 'FACTUUR', status: 'BETAALD',
      lines: [{ productId: 1, quantity: 30 }, { productId: 2, quantity: 13 }, { productId: 4, quantity: 26 }] }),
    salesRow({ id: 51, date: '2026-01-01', docType: 'FACTUUR', status: 'BETAALD',
      lines: [{ productId: 3, quantity: 99 }] }),
    salesRow({ id: 52, date: '2026-05-25', docType: 'FACTUUR', status: 'CONCEPT',
      lines: [{ productId: 3, quantity: 99 }] }),
  ];
  const expected: ExpectedStock[] = [
    { productId: 4, quantity: 60, expectedArrival: '2026-07-01', orderIds: [1], orderNumbers: ['PO-1'] },
  ];
  const result = inventoryAnalysis(products, expected, { sales, today: '2026-06-01', velocityDays: 91, reorderWeeks: 8 });

  assert.deepEqual(result.velocity, { days: 91, piecesSold: 69, skuCount: 3, weeklyPieces: 5.3 });
  assert.deepEqual(result.reorder.rows.map((row) => [row.productId, row.weeksLeft, row.weeksLeftWithIncoming]), [
    [1, 4.3, 4.3],
  ]);
  assert.equal(result.reorder.count, 1);
  assert.deepEqual(result.slowMovers.rows.map((row) => row.productId), [3]);
  assert.equal(result.slowMovers.valueEur, 120);
  assert.equal(inventoryAnalysis(products, expected, {}).slowMovers.count, 0);
});

function container(id: number, landed: number, status = 'ONTVANGEN'): PurchaseOrderView {
  return { order: { id, number: `PO-${id}`, alias: null, status, supplierId: 1 }, costing: { totals: { totalEur: landed } } } as unknown as PurchaseOrderView;
}

function partnerDoc(input: SalesFixture & { container: number; share?: number; shipped?: boolean; settlement?: number }): SalesOrderView {
  const row = salesRow(input);
  row.order.partnerPurchaseOrderId = input.container;
  row.order.partnerSharePct = input.share ?? 50;
  row.order.goodsShippedAt = input.shipped ? '2026-05-01T10:00:00Z' : null;
  if (input.settlement !== undefined) {
    row.priced.lines = [];
    row.order.extraLines = [{ description: 'Winstdeling veiling · PO · 50 % van € 1.000,00', quantity: 1, unitPriceEur: input.settlement }];
    row.priced.totals.total = input.settlement;
  }
  return row;
}

test('partner financing shows advances while draft settlements and quotes never count as earned profit', () => {
  const purchases = [container(1, 4000), container(2, 1000), container(3, 2500)];
  const customers = [{ id: 7, company: 'Frans Verhoeven' }] as unknown as Customer[];
  const sales = [
    partnerDoc({ id: 10, docType: 'OFFERTE', status: 'GEACCEPTEERD', total: 4000, container: 1, customerId: 7 }),
    partnerDoc({ id: 11, docType: 'FACTUUR', status: 'BETAALD', total: 4000, container: 1, customerId: 7 }),
    partnerDoc({ id: 12, docType: 'FACTUUR', status: 'CONCEPT', total: 4000, container: 1, customerId: 7, settlement: 900 }),
    partnerDoc({ id: 13, docType: 'OFFERTE', status: 'VERZONDEN', total: 2600, container: 3, customerId: 7, share: 40 }),
    partnerDoc({ id: 14, docType: 'FACTUUR', status: 'GEANNULEERD', total: 999, container: 2, customerId: 7 }),
    salesRow({ id: 15, docType: 'FACTUUR', status: 'VERZONDEN', total: 500 }),
  ];

  const result = partnerFinancingAnalysis(purchases, sales, customers);

  assert.deepEqual(result.own, { count: 1, landedEur: 1000 });
  assert.deepEqual(result.partner, { count: 2, landedEur: 6500 });
  assert.equal(result.invoicedEur, 4000, 'a quote alone is not invoiced money');
  assert.equal(result.settlementEur, 0, 'a draft settlement is not an issued claim');
  assert.equal(result.resultEur, 0, 'neither a quote nor a draft settlement creates realized profit');
  const first = result.rows.find((row) => row.purchaseOrderId === 1)!;
  assert.equal(first.partnerName, 'Frans Verhoeven');
  assert.equal(first.invoicedEur, 4000);
  assert.equal(first.invoicesPaid, true);
  assert.equal(first.settlementEur, 0);
  assert.equal(first.resultEur, 0);
  assert.deepEqual(first.documents.map((doc) => `${doc.number}${doc.settlement ? '*' : ''}`), ['OFF-10', 'INV-11', 'INV-12*']);
  const third = result.rows.find((row) => row.purchaseOrderId === 3)!;
  assert.equal(third.quotedOnly, true);
  assert.equal(third.sharePct, 40);
  assert.equal(third.resultEur, 0);
});

test('inventory value keeps the partner pieces that wait for shipment apart from our own money', () => {
  const products: Product[] = [
    product({ id: 1, name: 'Rood', stock: 40, per: 6, cost: 20, sales: 30 }),
    product({ id: 2, name: 'Wit', stock: 10, per: 6, cost: 5, sales: 8 }),
  ];
  const sales = [
    partnerDoc({ id: 1, docType: 'FACTUUR', status: 'VERZONDEN', total: 600, container: 1, lines: [{ productId: 1, quantity: 30 }] }),
    partnerDoc({ id: 2, docType: 'FACTUUR', status: 'BETAALD', total: 200, container: 1, shipped: true, lines: [{ productId: 1, quantity: 10 }] }),
    partnerDoc({ id: 3, docType: 'FACTUUR', status: 'CONCEPT', total: 100, container: 2, lines: [{ productId: 2, quantity: 25 }] }),
  ];
  for (const row of sales) row.order.purpose = 'PARTNER_SETTLEMENT';
  sales.push(partnerDoc({ id: 4, docType: 'FACTUUR', status: 'BETAALD', total: 600, container: 1, lines: [{ productId: 1, quantity: 30 }] }));

  const result = inventoryAnalysis(products, [], { sales });

  assert.equal(result.stock.costValueEur, 40 * 20 + 10 * 5);
  assert.equal(result.stock.partnerPieces, 30, 'shipped goods, draft invoices and advances do not allocate stock');
  assert.equal(result.stock.partnerCostValueEur, 30 * 20);
  assert.equal(result.stock.ownCostValueEur, 10 * 20 + 10 * 5);
});

test('sales analysis splits the issued invoices per channel', () => {
  const rows = [
    salesRow({ id: 1, docType: 'FACTUUR', status: 'VERZONDEN', total: 1000, claim: 1210, goods: 900, margin: 300 }),
    salesRow({ id: 2, docType: 'FACTUUR', status: 'BETAALD', total: 500, claim: 605, goods: 500, margin: 100 }),
    salesRow({ id: 3, docType: 'FACTUUR', status: 'CONCEPT', total: 9999 }),
  ];
  rows[1].order.salesChannel = 'tica';
  const result = salesAnalysis(rows, [], { from: '2026-01-01', to: '2026-12-31', today: '2026-05-01' });
  assert.deepEqual(result.channels.map((row) => [row.channel, row.invoiceCount, row.revenueExclEur, row.marginEur, row.sharePct]),
    [['DIRECT', 1, 1000, 300, 66.67], ['TICA', 1, 500, 100, 33.33]]);
});

test('the result sets the margin on the goods against the own costs, per channel and per month', () => {
  const sales = [
    salesRow({ id: 1, docType: 'FACTUUR', status: 'VERZONDEN', date: '2026-10-05', total: 1000, goods: 900, margin: 300 }),
    salesRow({ id: 2, docType: 'FACTUUR', status: 'BETAALD', date: '2026-10-20', total: 500, goods: 500, margin: 100 }),
    salesRow({ id: 3, docType: 'FACTUUR', status: 'VERZONDEN', date: '2026-09-02', total: 700, goods: 700, margin: 200 }),
    salesRow({ id: 4, docType: 'OFFERTE', status: 'GEACCEPTEERD', date: '2026-10-06', total: 5000, margin: 2000 }),
    salesRow({ id: 5, docType: 'FACTUUR', status: 'GEANNULEERD', date: '2026-10-07', total: 800, margin: 400 }),
  ];
  sales[1].order.salesChannel = 'TICA';
  sales[1].priced.totals.costTotal = 400;
  sales[0].priced.totals.costTotal = 600;
  sales[2].priced.totals.costTotal = 500;
  const costs: CompanyCost[] = [
    { id: 1, date: '2026-10-01', category: 'TICA', description: 'Stand', party: null, amountExclEur: 250, vatPct: 21, reference: null, paidOn: null, salesChannel: 'TICA', notes: null },
    { id: 2, date: '2026-10-15', category: 'BOEKHOUDER', description: 'Kwartaal', party: null, amountExclEur: 300, vatPct: 21, reference: null, paidOn: '2026-10-16', salesChannel: null, notes: null },
    { id: 3, date: '2026-08-01', category: 'HUUR', description: 'Augustus', party: null, amountExclEur: 900, vatPct: 21, reference: null, paidOn: '2026-08-01', salesChannel: null, notes: null },
  ];
  const purchases = [
    { order: { id: 1, number: 'PO-1', alias: null, status: 'ONTVANGEN', supplierId: 1, receivedOn: '2026-10-03' }, costing: { totals: { totalEur: 4000, totalWithSeparateCostsEur: 4230 } } },
    { order: { id: 2, number: 'PO-2', alias: null, status: 'ONDERWEG', supplierId: 1, receivedOn: null }, costing: { totals: { totalEur: 1000 } } },
  ] as unknown as PurchaseOrderView[];

  const result = resultAnalysis(sales, purchases, costs, { from: '2026-09-01', to: '2026-10-31' });

  assert.equal(result.invoiceCount, 3);
  assert.equal(result.revenueEur, 2200);
  assert.equal(result.marginEur, 600);
  assert.equal(result.goodsCostEur, 1500);
  assert.equal(result.costsEur, 550, 'august rent is outside the period');
  assert.equal(result.unpaidCostsEur, 302.5);
  assert.equal(result.resultEur, 50);
  assert.equal(result.purchasedEur, 4230);
  assert.equal(result.receivedContainers, 1);
  assert.deepEqual(result.byChannel.map((row) => [row.channel, row.revenueEur, row.marginEur, row.costsEur, row.resultEur]),
    [['DIRECT', 1700, 500, 0, 500], ['TICA', 500, 100, 250, -150]]);
  assert.deepEqual(result.byCategory.map((row) => [row.category, row.amountEur]), [['BOEKHOUDER', 300], ['TICA', 250]]);
  assert.deepEqual(result.monthly.map((row) => [row.month, row.revenueEur, row.marginEur, row.costsEur, row.resultEur]),
    [['2026-09', 700, 200, 0, 200], ['2026-10', 1500, 400, 550, -150]]);
});

test('with the money rule an investment charges its depreciation, import VAT is no cost and remainders are what is open', () => {
  const base = { category: 'BOEKHOUDER', description: 'Kost', party: null, vatPct: 21, reference: null, paidOn: null, salesChannel: null, notes: null, amountInclEur: null,
    vatRegime: 'BE', vatRegimeConfirmed: true, supplierCountry: 'BE', costKind: null, expenseType: 'STANDARD', vatDeductiblePct: 100, taxDeductiblePct: 100, depreciationYears: null, depreciationStart: null } as const;
  const costs: CompanyCost[] = [
    { ...base, id: 1, date: '2026-09-15', amountExclEur: 100 },
    { ...base, id: 2, date: '2026-07-01', amountExclEur: 3000, category: 'SOFTWARE', description: 'Laptop', costKind: 'INVESTMENT', depreciationYears: 3, depreciationStart: '2026-07-01', paidOn: '2026-07-01', openEur: 0 },
    { ...base, id: 3, date: '2026-10-02', amountExclEur: 0, vatPct: null, amountInclEur: 500, category: 'TRANSPORT', description: 'Invoer-btw', vatRegime: 'IMPORT_VAT_PAID' },
  ];
  const result = resultAnalysis([], [], costs, { from: '2026-09-01', to: '2026-10-31', costCharge: costChargeIn, openEur: openOf });
  assert.equal(result.depreciationEur, 167.12, '1 000 × 61 / 365: the investment of July depreciates into the period');
  assert.equal(result.costsEur, 267.12, 'the expense plus the depreciation; the import VAT is no cost');
  assert.equal(result.unpaidCostsEur, 621, 'what is still open: € 121 and the € 500 import VAT');
  assert.deepEqual(result.byCategory.map((row) => [row.category, row.amountEur]), [['AFSCHRIJVINGEN', 167.12], ['BOEKHOUDER', 100]]);
  assert.deepEqual(result.monthly.map((row) => [row.month, row.costsEur]), [['2026-09', 182.19], ['2026-10', 84.93]]);
  const plain = resultAnalysis([], [], costs, { from: '2026-09-01', to: '2026-10-31' });
  assert.deepEqual([plain.costsEur, plain.depreciationEur], [100, 0], 'without the rule only the excl. amounts dated in the period count');
  const allYears = resultAnalysis([], [], costs, { costCharge: (cost, from, to) => costChargeIn(cost, from, to, '2026-10-12'), openEur: openOf });
  assert.equal(allYears.depreciationEur, 284.93, "'Alle jaren' charges only the days elapsed: 504,11 × 104 / 184, not the whole life");
  assert.equal(allYears.costsEur, 384.93);
});

test('issued credit notes come off Gefactureerd, the trend and the top lists, and ask for their tegoed instead of a payment', () => {
  const invoice = salesRow({ id: 30, docType: 'FACTUUR', status: 'UITGEREIKT', date: '2026-04-10', total: 1000, claim: 1210, goods: 1000, margin: 300, pieces: 100, customerId: 1, due: '2026-05-10' });
  const creditNote = {
    ...salesRow({ id: 31, docType: 'FACTUUR', status: 'UITGEREIKT', date: '2026-04-20', total: 100, claim: 121, goods: 100, margin: 30, pieces: 10, customerId: 1 }),
  } as SalesOrderView;
  creditNote.order = { ...creditNote.order, docType: 'CREDITNOTA', number: 'CN-31', creditedInvoiceId: 30, creditReason: 'SHORT_DELIVERY' } as SalesOrderView['order'];
  creditNote.paymentSummary = { ...creditNote.paymentSummary!, invoiceTotalEur: -121, remainingEur: 0, creditEur: 121, refundableEur: 121, status: 'CREDIT' };
  creditNote.accounting = { recognizedRevenueEur: -100, recognizedCostEur: -70, recognizedProfitEur: -30, recognizedQuantity: -10 };
  const concept = { ...creditNote, order: { ...creditNote.order, id: 32, number: 'CN-32', status: 'CONCEPT' } } as SalesOrderView;
  const result = salesAnalysis([invoice, creditNote, concept], [{ id: 1, company: 'Bloemen BV' } as Customer], { from: '2026-04-01', to: '2026-04-30', today: '2026-04-25' });
  assert.equal(result.invoices.issued, 1, 'a credit note is not an invoice');
  assert.equal(result.invoices.issuedValueEur, 1089, '1210 − 121');
  assert.equal(result.invoices.creditedEur, 121);
  assert.equal(result.invoices.creditNoteCount, 1, 'concepts do not count');
  assert.equal(result.invoices.outstanding, 1, 'outstanding stays FACTUUR-only');
  assert.equal(result.invoices.outstandingValueEur, 1210);
  assert.equal(result.invoices.marginEur, 270, 'the server accounting of the credit note reduces the margin');
  assert.equal(result.monthly.find((point) => point.month === '2026-04')?.invoicedEur, 1089);
  assert.equal(result.monthly.find((point) => point.month === '2026-04')?.invoicesIssued, 1);
  assert.equal(result.topCustomers[0].calculatedValueEur, 1089);
  assert.equal(result.topCustomers[0].pieces, 90);
  assert.equal(result.topCustomers[0].orderCount, 1);
  const credit = result.attentionOrders.find((row) => row.orderId === 31);
  assert.ok(credit, 'an open tegoed asks to be settled');
  assert.deepEqual(credit!.reasons, ['Tegoed af te handelen']);
  assert.equal(credit!.severity, 'warning');
  assert.equal(credit!.calculatedValueEur, 121);
  assert.ok(!result.attentionOrders.some((row) => row.orderId === 32), 'a concept credit note asks nothing');
  const fullyCredited = { ...invoice, creditedEur: 1210 } as SalesOrderView;
  assert.ok(!salesAnalysis([fullyCredited], [], { today: '2026-06-01' }).attentionOrders.some((row) => row.orderId === 30), 'a fully credited invoice is no open payment');
});

test('piecesSoldByProduct counts the pieces of issued regular invoices in the window up to today', () => {
  const sales: SalesOrderView[] = [
    salesRow({ id: 60, date: '2026-05-20', docType: 'FACTUUR', status: 'BETAALD', lines: [{ productId: 1, quantity: 30 }, { productId: 2, quantity: 13 }] }),
    salesRow({ id: 61, date: '2026-06-01', docType: 'FACTUUR', status: 'VERZONDEN', lines: [{ productId: 1, quantity: 5 }] }),
    salesRow({ id: 62, date: '2026-03-02', docType: 'FACTUUR', status: 'BETAALD', lines: [{ productId: 1, quantity: 99 }] }),
    salesRow({ id: 63, date: '2026-05-25', docType: 'FACTUUR', status: 'CONCEPT', lines: [{ productId: 1, quantity: 99 }] }),
    salesRow({ id: 64, date: '2026-05-25', docType: 'OFFERTE', status: 'GEACCEPTEERD', lines: [{ productId: 2, quantity: 99 }] }),
  ];
  const sold = piecesSoldByProduct(sales, '2026-06-01', 90);
  assert.deepEqual([...sold].sort(([left], [right]) => left - right), [[1, 35], [2, 13]]);
  assert.equal(piecesSoldByProduct(sales, '2026-06-01', 1).get(1), 5);
  assert.equal(piecesSoldByProduct([], '2026-06-01', 90).size, 0);
});

test('the funnel adds up: open, closed, cancelled and the rest make the created count', () => {
  const rows = [
    salesRow({ id: 1 }),
    salesRow({ id: 2, status: 'VERZONDEN', sent: true }),
    salesRow({ id: 3, status: 'WIJZIGING_GEVRAAGD', sent: true }),
    salesRow({ id: 4, status: 'GEACCEPTEERD', sent: true }),
    salesRow({ id: 5, status: 'AFGEWEZEN', sent: true }),
    salesRow({ id: 6, status: 'GEANNULEERD' }),
    salesRow({ id: 7, status: 'GEANNULEERD', sent: true }),
  ];
  const { funnel, pipeline } = salesAnalysis(rows, [], { from: '2026-01-01', to: '2026-12-31', today: '2026-06-01' });
  assert.equal(funnel.created, 7);
  assert.equal(funnel.open, 3, 'nog open = the open statuses, the pipeline count');
  assert.equal(funnel.open, pipeline.count);
  assert.equal(funnel.closed, 2);
  assert.equal(funnel.cancelled, 2);
  assert.equal(funnel.created - funnel.open - funnel.closed - funnel.cancelled, 0, 'nothing left over on this fixture');
});

test('Omzet excl. btw and the advance share of Gefactureerd are their own figures', () => {
  const invoice = salesRow({ id: 1, docType: 'FACTUUR', status: 'VERZONDEN', total: 1000, claim: 1210, margin: 200 });
  const regularAdvance = salesRow({ id: 2, docType: 'FACTUUR', status: 'VERZONDEN', total: 300, claim: 363 });
  regularAdvance.advanceBilling = { stage: 'ADVANCE', quoteId: 9, quoteNumber: 'OFF-9', percentage: 30, amountExclEur: 300 } as SalesOrderView['advanceBilling'];
  const partnerAdvance = salesRow({ id: 3, docType: 'FACTUUR', status: 'VERZONDEN', total: 5000, claim: 5000 });
  partnerAdvance.order.purpose = 'PARTNER_ADVANCE';
  partnerAdvance.order.partnerPurchaseOrderId = 4;
  const concept = salesRow({ id: 4, docType: 'FACTUUR', status: 'CONCEPT', total: 700, claim: 847 });
  const { invoices } = salesAnalysis([invoice, regularAdvance, partnerAdvance, concept], [], { from: '2026-01-01', to: '2026-12-31', today: '2026-06-01' });
  assert.equal(invoices.issuedValueEur, 6573);
  assert.equal(invoices.advanceClaimEur, 5363, 'the regular voorschotfactuur and the partner voorschot, incl. btw');
  assert.equal(invoices.revenueExclEur, 1300, 'a partner advance is financing, no revenue; the regular advance is revenue as the server recognises it');
});

test('Resultaat counts a credit note apart, per channel too, and shows every month of the period up to today', () => {
  const invoice = salesRow({ id: 1, docType: 'FACTUUR', status: 'VERZONDEN', date: '2026-03-05', total: 1000, margin: 300 });
  const second = salesRow({ id: 2, docType: 'FACTUUR', status: 'VERZONDEN', date: '2026-05-10', total: 400, margin: 100 });
  const credit = salesRow({ id: 3, docType: 'FACTUUR', status: 'UITGEREIKT', date: '2026-05-20', total: 100, margin: 30 });
  credit.order = { ...credit.order, docType: 'CREDITNOTA' } as SalesOrderView['order'];
  credit.accounting = { recognizedRevenueEur: -100, recognizedCostEur: -70, recognizedProfitEur: -30, recognizedQuantity: 0 };
  const result = resultAnalysis([invoice, second, credit], [], [], { from: '2026-01-01', to: '2026-06-15', today: '2026-06-15' });
  assert.equal(result.invoiceCount, 2, 'the credit note is no invoice');
  assert.equal(result.creditNoteCount, 1);
  assert.deepEqual(result.byChannel.map((row) => [row.channel, row.invoiceCount, row.revenueEur]), [['DIRECT', 2, 1300]]);
  assert.deepEqual(result.monthly.map((row) => [row.month, row.revenueEur, row.marginEur]),
    [['2026-01', 0, 0], ['2026-02', 0, 0], ['2026-03', 1000, 300], ['2026-04', 0, 0], ['2026-05', 300, 70], ['2026-06', 0, 0]]);
  const future = resultAnalysis([invoice], [], [], { from: '2026-01-01', to: '2026-12-31', today: '2026-04-02' });
  assert.deepEqual(future.monthly.map((row) => row.month), ['2026-01', '2026-02', '2026-03', '2026-04'], 'never past today');
  const allYears = resultAnalysis([invoice], [], [], { today: '2026-05-02' });
  assert.deepEqual(allYears.monthly.map((row) => row.month), ['2026-03', '2026-04', '2026-05'], 'all years: from the first data month');
  const plain = resultAnalysis([invoice, second], [], [], { from: '2026-01-01', to: '2026-06-15' });
  assert.deepEqual(plain.monthly.map((row) => row.month), ['2026-03', '2026-05'], 'without today only the months with data, as before');
});

test('A-M4: one pipeline: open regular quotes; Overzicht counts every year, Verkoop its period', () => {
  const funding = salesRow({ id: 4, status: 'VERZONDEN', total: 5_000, date: '2026-03-01' });
  funding.order = { ...funding.order, purpose: 'PARTNER_ADVANCE' } as SalesOrderView['order'];
  const rows = [
    salesRow({ id: 1, status: 'CONCEPT', total: 100, date: '2026-03-01' }),
    salesRow({ id: 2, status: 'WIJZIGING_GEVRAAGD', total: 200, date: '2025-11-20' }),
    salesRow({ id: 3, status: 'GEACCEPTEERD', total: 300, date: '2026-03-01' }),
    funding,
    salesRow({ id: 5, docType: 'FACTUUR', status: 'VERZONDEN', total: 400, date: '2026-03-01' }),
  ];
  assert.deepEqual(openPipelineQuotes(rows).map((row) => row.order.id), [1, 2], 'no partner funding, no closed quote, no invoice');
  const all = salesAnalysis(rows, [], { today: '2026-10-19' });
  assert.equal(all.pipeline.count, openPipelineQuotes(rows).length, 'Verkoop on Alle jaren = the Overzicht count');
  assert.equal(all.pipeline.calculatedValueEur, 300);
  const year = salesAnalysis(rows, [], { from: '2026-01-01', to: '2026-10-19', today: '2026-10-19' });
  assert.equal(year.pipeline.count, 1, 'Dit jaar: only the quotes created in the period');
});

test('A-M1: the home Resultaat options give the Analyses figure (an investment charges its depreciation)', () => {
  const invoice = salesRow({ id: 1, docType: 'FACTUUR', status: 'VERZONDEN', date: '2026-03-05', total: 10_000, margin: 4_000 });
  const laptop = { id: 1, date: '2026-01-10', amountExclEur: 3_000, vatPct: 21, category: 'IT', costKind: 'INVESTMENT', depreciationYears: 3 } as CompanyCost;
  const options = { from: '2026-01-01', to: '2026-10-19', today: '2026-10-19' };
  const analyses = resultAnalysis([invoice], [], [laptop], { ...options, costCharge: (cost, from, to) => costChargeIn(cost, from, to, '2026-10-19'), openEur: openOf });
  const bare = resultAnalysis([invoice], [], [laptop], options);
  assert.ok(analyses.costsEur < 3_000 && analyses.costsEur > 0, 'depreciation, not the purchase');
  assert.notEqual(bare.resultEur, analyses.resultEur, 'without the options the home showed another Resultaat');
});
