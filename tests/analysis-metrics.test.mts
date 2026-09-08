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
  partnerFinancingAnalysis,
  resultAnalysis,
  salesAnalysis,
} from '../src/app/features/analyses/analysis-metrics.ts';

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
