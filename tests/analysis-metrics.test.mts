import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  Customer,
  ExpectedStock,
  PricedLine,
  Product,
  QuoteStatus,
  SalesOrderView,
} from '../src/app/core/api/models.ts';
import {
  inventoryAnalysis,
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
    marginEur: 450,
    marginPct: (450 / 1_300) * 100,
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
