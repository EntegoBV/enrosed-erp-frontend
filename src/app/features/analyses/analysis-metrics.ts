import type {
  Customer,
  ExpectedStock,
  Product,
  SalesOrderView,
} from '../../core/api/models';

export interface AnalysisOptions {
  /** Inclusive order-date cohort. Empty bounds mean all available orders. */
  from?: string | null;
  to?: string | null;
  /** ISO day used only to decide whether an unpaid invoice is overdue. */
  today?: string;
  topLimit?: number;
}

export interface CommercialBucket {
  count: number;
  pieces: number;
  /** Recalculated by the current pricing engine; this is not a historical snapshot. */
  calculatedValueEur: number;
  missingCostLines: number;
}

export interface SalesFunnel {
  created: number;
  sent: number;
  viewed: number;
  accepted: number;
  rejected: number;
  expired: number;
  closed: number;
  sendRatePct: number | null;
  viewRatePct: number | null;
  conversionRatePct: number | null;
}

export interface InvoiceAnalysis {
  created: number;
  draft: number;
  issued: number;
  paid: number;
  outstanding: number;
  overdue: number;
  /** Invoice claims include VAT, matching what the customer owes. */
  issuedValueEur: number;
  paidValueEur: number;
  outstandingValueEur: number;
  overdueValueEur: number;
  /** The issued claim divided by the issued count; null without invoices. */
  averageClaimEur: number | null;
  /** Days from invoice date to payment, over paid invoices that carry both dates. */
  avgDaysToPaid: number | null;
  marginEur: number;
  marginPct: number | null;
  missingCostLines: number;
}

/** One calendar month of the period: what was invoiced, accepted and asked. */
export interface SalesMonthPoint {
  /** ISO month, "2026-03". */
  month: string;
  invoicedEur: number;
  acceptedEur: number;
  quotesCreated: number;
  invoicesIssued: number;
}

export interface SalesCountryMetric {
  countryCode: string | null;
  orderCount: number;
  /** Issued invoice claims, including VAT. */
  calculatedValueEur: number;
}

export interface SalesCustomerMetric {
  customerId: number | null;
  name: string;
  orderCount: number;
  pieces: number;
  /** Issued invoice claims, including VAT, under the current order calculation. */
  calculatedValueEur: number;
}

export interface SalesProductMetric {
  productId: number;
  sku: string | null;
  name: string;
  orderCount: number;
  pieces: number;
  /** Goods revenue excluding freight and VAT, after proportional order discounts. */
  calculatedGoodsValueEur: number;
}

export interface SalesAttentionOrder {
  orderId: number;
  number: string;
  docType: 'OFFERTE' | 'FACTUUR';
  status: SalesOrderView['order']['status'];
  customerId: number | null;
  customerName: string;
  orderDate: string;
  dueDate: string | null;
  calculatedValueEur: number;
  reasons: string[];
  severity: 'danger' | 'warning' | 'info';
}

export interface SalesAnalysis {
  /** Makes the non-snapshot nature of all commercial amounts explicit to consumers. */
  valueBasis: 'CURRENT_ORDER_PRICING';
  period: { from: string | null; to: string | null };
  pipeline: CommercialBucket;
  funnel: SalesFunnel;
  accepted: CommercialBucket;
  invoices: InvoiceAnalysis;
  topCustomers: SalesCustomerMetric[];
  topProducts: SalesProductMetric[];
  topCountries: SalesCountryMetric[];
  /** Oldest month first, one point per month of the period; empty without bounds and orders. */
  monthly: SalesMonthPoint[];
  attentionOrders: SalesAttentionOrder[];
}

export interface InventoryStockSummary {
  knownSkuCount: number;
  unknownSkuCount: number;
  knownPieces: number;
  positivePieces: number;
  valuedPieces: number;
  costValueEur: number;
  saleablePieces: number;
  salesValueEur: number;
  /** Null means at least one saleable stock line has no landed cost. */
  potentialUpliftEur: number | null;
}

export interface InventoryDataGaps {
  unknownStockSkuCount: number;
  unvaluedStockSkuCount: number;
  unvaluedStockPieces: number;
  missingCartonSkuCount: number;
  negativeStockSkuCount: number;
}

export interface InventoryAttentionRow {
  productId: number;
  sku: string | null;
  name: string;
  colour: string | null;
  stockPieces: number;
  piecesPerCarton: number | null;
  missingPiecesToCarton: number | null;
  expectedPieces: number;
  nextArrival: string | null;
  orderIds: number[];
}

export interface InventoryAttentionGroup {
  count: number;
  rows: InventoryAttentionRow[];
}

export interface ZeroStockAnalysis extends InventoryAttentionGroup {
  withIncomingCount: number;
  withoutIncomingCount: number;
}

export interface IncomingInventoryRow {
  productId: number;
  sku: string | null;
  name: string;
  colour: string | null;
  pieces: number;
  expectedArrival: string | null;
  orderIds: number[];
  orderNumbers: string[];
}

export interface IncomingInventoryAnalysis {
  skuCount: number;
  pieces: number;
  nextArrival: string | null;
  rows: IncomingInventoryRow[];
}

export interface InventoryCapitalMetric {
  productId: number;
  sku: string | null;
  name: string;
  colour: string | null;
  stockPieces: number;
  landedUnitCostEur: number;
  costValueEur: number;
  sharePct: number;
}

/** How fast a product leaves, from issued invoices of the last weeks. */
export interface InventoryVelocity {
  days: number;
  piecesSold: number;
  skuCount: number;
  weeklyPieces: number;
}

export interface ReorderRow {
  productId: number;
  sku: string | null;
  name: string;
  colour: string | null;
  stockPieces: number;
  expectedPieces: number;
  weeklyPieces: number;
  /** Weeks the shelf lasts at the current pace; null when nothing sells. */
  weeksLeft: number | null;
  /** The same with what is on the water counted in. */
  weeksLeftWithIncoming: number | null;
}

export interface SlowMoverRow {
  productId: number;
  sku: string | null;
  name: string;
  colour: string | null;
  stockPieces: number;
  costValueEur: number;
}

export interface InventoryAnalysis {
  snapshotBasis: 'CURRENT_PRODUCT_DATA';
  stock: InventoryStockSummary;
  dataGaps: InventoryDataGaps;
  zeroStock: ZeroStockAnalysis;
  belowCarton: InventoryAttentionGroup;
  incoming: IncomingInventoryAnalysis;
  topCapital: InventoryCapitalMetric[];
  velocity: InventoryVelocity;
  /** Products that run out within the reorder horizon, soonest first. */
  reorder: { horizonWeeks: number; count: number; rows: ReorderRow[] };
  /** Valued stock that did not sell at all in the velocity window, most money first. */
  slowMovers: { count: number; valueEur: number; rows: SlowMoverRow[] };
}

export interface InventoryOptions extends Pick<AnalysisOptions, 'topLimit' | 'today'> {
  /** Issued invoices feed the sales pace; without them the pace is simply unknown. */
  sales?: readonly SalesOrderView[];
  velocityDays?: number;
  reorderWeeks?: number;
}

const OPEN_QUOTE_STATUSES = new Set<SalesOrderView['order']['status']>([
  'CONCEPT', 'VERZONDEN', 'BEKEKEN', 'WIJZIGING_GEVRAAGD',
]);
const CLOSED_QUOTE_STATUSES = new Set<SalesOrderView['order']['status']>([
  'GEACCEPTEERD', 'AFGEWEZEN', 'VERLOPEN',
]);

/**
 * A cohort analysis of sales documents created in the selected period.
 *
 * Values deliberately carry a `calculated` name: the current endpoint prices
 * old documents again with today's product data and does not expose a frozen
 * historical financial snapshot.
 */
export function salesAnalysis(
  orders: readonly SalesOrderView[],
  customers: readonly Customer[],
  options: AnalysisOptions = {},
): SalesAnalysis {
  const from = isoDayOrNull(options.from);
  const to = isoDayOrNull(options.to);
  const today = isoDayOrNull(options.today) ?? localIsoDay();
  const limit = positiveWhole(options.topLimit, 8);
  const selected = orders.filter((row) => inOrderDateRange(row.order.orderDate, from, to));
  const quotes = selected.filter((row) => docType(row) === 'OFFERTE');
  const invoices = selected.filter((row) => docType(row) === 'FACTUUR');

  const pipelineRows = quotes.filter((row) => OPEN_QUOTE_STATUSES.has(row.order.status));
  const acceptedRows = quotes.filter((row) => row.order.status === 'GEACCEPTEERD');
  const sentCount = quotes.filter((row) => !!row.order.sentAt).length;
  const viewedCount = quotes.filter((row) => !!row.order.viewedAt || row.order.viewCount > 0).length;
  const acceptedCount = acceptedRows.length;
  const rejectedCount = quotes.filter((row) => row.order.status === 'AFGEWEZEN').length;
  const expiredCount = quotes.filter((row) => row.order.status === 'VERLOPEN').length;
  const closedCount = quotes.filter((row) => CLOSED_QUOTE_STATUSES.has(row.order.status)).length;

  const issuedInvoices = invoices.filter((row) => row.order.status !== 'CONCEPT');
  const paidInvoices = issuedInvoices.filter((row) => row.order.status === 'BETAALD');
  const outstandingInvoices = issuedInvoices.filter((row) => row.order.status !== 'BETAALD');
  const overdueInvoices = outstandingInvoices.filter((row) => isOverdue(row, today));
  const invoiceGoods = issuedInvoices.reduce(
    (sum, row) => sum + finiteNonNegative(row.priced.totals.goodsTotal), 0);
  const invoiceMargin = issuedInvoices.reduce(
    (sum, row) => sum + finite(row.priced.totals.marginEur), 0);
  const customerNames = new Map(customers.map((customer) => [customer.id, customer.company]));
  const issuedValue = sumInvoiceClaims(issuedInvoices);
  const paymentDays = paidInvoices.flatMap((row) => {
    const paidDay = isoDayOrNull(row.order.paidAt?.slice(0, 10));
    const invoiceDay = isoDayOrNull(row.order.orderDate);
    if (!paidDay || !invoiceDay) return [];
    return [Math.max(0, daysBetween(invoiceDay, paidDay))];
  });

  return {
    valueBasis: 'CURRENT_ORDER_PRICING',
    period: { from, to },
    pipeline: commercialBucket(pipelineRows),
    funnel: {
      created: quotes.length,
      sent: sentCount,
      viewed: viewedCount,
      accepted: acceptedCount,
      rejected: rejectedCount,
      expired: expiredCount,
      closed: closedCount,
      sendRatePct: percentage(sentCount, quotes.length),
      viewRatePct: percentage(viewedCount, sentCount),
      conversionRatePct: percentage(acceptedCount, closedCount),
    },
    accepted: commercialBucket(acceptedRows),
    invoices: {
      created: invoices.length,
      draft: invoices.length - issuedInvoices.length,
      issued: issuedInvoices.length,
      paid: paidInvoices.length,
      outstanding: outstandingInvoices.length,
      overdue: overdueInvoices.length,
      issuedValueEur: sumInvoiceClaims(issuedInvoices),
      paidValueEur: sumInvoiceClaims(paidInvoices),
      outstandingValueEur: sumInvoiceClaims(outstandingInvoices),
      overdueValueEur: sumInvoiceClaims(overdueInvoices),
      averageClaimEur: issuedInvoices.length ? issuedValue / issuedInvoices.length : null,
      avgDaysToPaid: paymentDays.length
        ? Math.round(paymentDays.reduce((sum, days) => sum + days, 0) / paymentDays.length) : null,
      marginEur: invoiceMargin,
      marginPct: percentage(invoiceMargin, invoiceGoods),
      missingCostLines: missingCostLines(issuedInvoices),
    },
    topCustomers: topCustomers(issuedInvoices, customerNames, limit),
    topProducts: topProducts(issuedInvoices, limit),
    topCountries: topCountries(issuedInvoices, limit),
    monthly: monthlyPoints(quotes, issuedInvoices, acceptedRows, from, to),
    attentionOrders: attentionOrders(selected, customerNames, today),
  };
}

function topCountries(rows: readonly SalesOrderView[], limit: number): SalesCountryMetric[] {
  const grouped = new Map<string | null, SalesCountryMetric>();
  for (const row of rows) {
    const code = row.order.countryCode ? row.order.countryCode.toUpperCase() : null;
    const current = grouped.get(code) ?? { countryCode: code, orderCount: 0, calculatedValueEur: 0 };
    current.orderCount++;
    current.calculatedValueEur += invoiceClaim(row);
    grouped.set(code, current);
  }
  return [...grouped.values()]
    .sort((left, right) => right.calculatedValueEur - left.calculatedValueEur || right.orderCount - left.orderCount)
    .slice(0, limit);
}

/**
 * One point per month between the bounds; without bounds the months run from
 * the oldest to the newest document. Empty when there is nothing at all.
 */
function monthlyPoints(
  quotes: readonly SalesOrderView[],
  issuedInvoices: readonly SalesOrderView[],
  accepted: readonly SalesOrderView[],
  from: string | null,
  to: string | null,
): SalesMonthPoint[] {
  const all = [...quotes, ...issuedInvoices];
  const dates = all.map((row) => row.order.orderDate).filter((day) => isoDayOrNull(day)).sort();
  const first = (from ?? dates[0] ?? null)?.slice(0, 7) ?? null;
  const last = (to ?? dates.at(-1) ?? null)?.slice(0, 7) ?? null;
  if (!first || !last || first > last) return [];
  const points = new Map<string, SalesMonthPoint>();
  let [year, month] = first.split('-').map(Number);
  for (let guard = 0; guard < 120; guard++) {
    const key = `${year}-${String(month).padStart(2, '0')}`;
    points.set(key, { month: key, invoicedEur: 0, acceptedEur: 0, quotesCreated: 0, invoicesIssued: 0 });
    if (key >= last) break;
    month++;
    if (month > 12) { month = 1; year++; }
  }
  for (const row of quotes) {
    const point = points.get(row.order.orderDate.slice(0, 7));
    if (point) point.quotesCreated++;
  }
  for (const row of accepted) {
    const point = points.get(row.order.orderDate.slice(0, 7));
    if (point) point.acceptedEur += finiteNonNegative(row.priced.totals.total);
  }
  for (const row of issuedInvoices) {
    const point = points.get(row.order.orderDate.slice(0, 7));
    if (!point) continue;
    point.invoicedEur += invoiceClaim(row);
    point.invoicesIssued++;
  }
  return [...points.values()];
}

function daysBetween(fromDay: string, toDay: string): number {
  const from = Date.UTC(Number(fromDay.slice(0, 4)), Number(fromDay.slice(5, 7)) - 1, Number(fromDay.slice(8, 10)));
  const to = Date.UTC(Number(toDay.slice(0, 4)), Number(toDay.slice(5, 7)) - 1, Number(toDay.slice(8, 10)));
  return Math.round((to - from) / 86_400_000);
}

/** Current inventory snapshot. It intentionally makes no historical turnover claim. */
export function inventoryAnalysis(
  products: readonly Product[],
  expected: readonly ExpectedStock[],
  options: InventoryOptions = {},
): InventoryAnalysis {
  const limit = positiveWhole(options.topLimit, 8);
  const today = isoDayOrNull(options.today) ?? localIsoDay();
  const velocityDays = positiveWhole(options.velocityDays, 90);
  const reorderWeeks = positiveWhole(options.reorderWeeks, 8);
  const soldByProduct = piecesSoldByProduct(options.sales ?? [], today, velocityDays);
  const known = products.filter((product) => product.inventoryKnown === true);
  const positiveKnown = known.filter((product) => finite(product.stockQuantity) > 0);
  const valued = positiveKnown.filter((product) => validMoney(product.landedCostEur));
  const unvalued = positiveKnown.filter((product) => !validMoney(product.landedCostEur));
  const saleable = positiveKnown.filter((product) => product.active && !product.demo);
  const saleableCostComplete = saleable.every((product) => validMoney(product.landedCostEur));
  const expectedByProduct = aggregateExpected(expected);
  const byProductId = new Map(products.flatMap((product) =>
    product.id == null ? [] : [[product.id, product] as const]));

  const costValueEur = valued.reduce((sum, product) =>
    sum + finiteNonNegative(product.stockQuantity) * finiteNonNegative(product.landedCostEur), 0);
  const salesValueEur = saleable.reduce((sum, product) =>
    sum + finiteNonNegative(product.stockQuantity) * finiteNonNegative(product.computedSalesPriceEur), 0);
  const saleableCostValueEur = saleable.reduce((sum, product) =>
    sum + finiteNonNegative(product.stockQuantity) * finiteNonNegative(product.landedCostEur), 0);

  const zeroRows = products
    .filter((product) => product.id != null && product.active && !product.demo
      && product.inventoryKnown === true && finite(product.stockQuantity) <= 0)
    .map((product) => inventoryAttentionRow(product, expectedByProduct.get(product.id!)))
    .sort((left, right) => Number(left.expectedPieces > 0) - Number(right.expectedPieces > 0)
      || compareName(left.name, right.name));
  const belowCartonRows = products
    .filter((product) => {
      const stock = finite(product.stockQuantity);
      const per = cartonSize(product);
      return product.id != null && product.active && !product.demo
        && product.inventoryKnown === true && stock > 0 && per !== null && per > 1 && stock < per;
    })
    .map((product) => inventoryAttentionRow(product, expectedByProduct.get(product.id!)))
    .sort((left, right) =>
      (left.stockPieces / (left.piecesPerCarton ?? 1))
        - (right.stockPieces / (right.piecesPerCarton ?? 1))
      || compareName(left.name, right.name));

  const incomingRows: IncomingInventoryRow[] = [...expectedByProduct.values()]
    .filter((row) => row.pieces > 0)
    .map((row) => {
      const product = byProductId.get(row.productId);
      return {
        productId: row.productId,
        sku: product?.sku ?? null,
        name: product?.name ?? `Product ${row.productId}`,
        colour: product?.colour ?? null,
        pieces: row.pieces,
        expectedArrival: row.nextArrival,
        orderIds: row.orderIds,
        orderNumbers: row.orderNumbers,
      };
    })
    .sort((left, right) => (left.expectedArrival ?? '9999-99-99')
      .localeCompare(right.expectedArrival ?? '9999-99-99')
      || right.pieces - left.pieces || compareName(left.name, right.name));

  const capitalRows = valued
    .filter((product): product is Product & { id: number } => product.id != null)
    .map((product) => {
      const stockPieces = finiteNonNegative(product.stockQuantity);
      const landedUnitCostEur = finiteNonNegative(product.landedCostEur);
      return {
        productId: product.id,
        sku: product.sku,
        name: product.name,
        colour: product.colour,
        stockPieces,
        landedUnitCostEur,
        costValueEur: stockPieces * landedUnitCostEur,
        sharePct: 0,
      };
    })
    .sort((left, right) => right.costValueEur - left.costValueEur
      || compareName(left.name, right.name));
  for (const row of capitalRows) {
    row.sharePct = percentage(row.costValueEur, costValueEur) ?? 0;
  }

  const weeks = velocityDays / 7;
  const piecesSold = [...soldByProduct.values()].reduce((sum, pieces) => sum + pieces, 0);
  const reorderRows: ReorderRow[] = products
    .filter((product): product is Product & { id: number } => product.id != null
      && product.active && !product.demo && product.inventoryKnown === true)
    .flatMap((product) => {
      const sold = soldByProduct.get(product.id) ?? 0;
      if (sold <= 0) return [];
      const weekly = sold / weeks;
      const stockPieces = finiteNonNegative(product.stockQuantity);
      const expectedPieces = expectedByProduct.get(product.id)?.pieces ?? 0;
      const weeksLeft = stockPieces / weekly;
      const weeksLeftWithIncoming = (stockPieces + expectedPieces) / weekly;
      if (weeksLeftWithIncoming >= reorderWeeks) return [];
      return [{
        productId: product.id,
        sku: product.sku,
        name: product.name,
        colour: product.colour,
        stockPieces,
        expectedPieces,
        weeklyPieces: Math.round(weekly * 10) / 10,
        weeksLeft: Math.round(weeksLeft * 10) / 10,
        weeksLeftWithIncoming: Math.round(weeksLeftWithIncoming * 10) / 10,
      }];
    })
    .sort((left, right) => (left.weeksLeftWithIncoming ?? 0) - (right.weeksLeftWithIncoming ?? 0)
      || compareName(left.name, right.name));
  const slowRows: SlowMoverRow[] = options.sales === undefined ? [] : valued
    .filter((product): product is Product & { id: number } => product.id != null
      && product.active && !product.demo && (soldByProduct.get(product.id) ?? 0) <= 0)
    .map((product) => ({
      productId: product.id,
      sku: product.sku,
      name: product.name,
      colour: product.colour,
      stockPieces: finiteNonNegative(product.stockQuantity),
      costValueEur: finiteNonNegative(product.stockQuantity) * finiteNonNegative(product.landedCostEur),
    }))
    .sort((left, right) => right.costValueEur - left.costValueEur || compareName(left.name, right.name));

  return {
    snapshotBasis: 'CURRENT_PRODUCT_DATA',
    stock: {
      knownSkuCount: known.length,
      unknownSkuCount: products.length - known.length,
      knownPieces: known.reduce((sum, product) => sum + finite(product.stockQuantity), 0),
      positivePieces: positiveKnown.reduce(
        (sum, product) => sum + finiteNonNegative(product.stockQuantity), 0),
      valuedPieces: valued.reduce(
        (sum, product) => sum + finiteNonNegative(product.stockQuantity), 0),
      costValueEur,
      saleablePieces: saleable.reduce(
        (sum, product) => sum + finiteNonNegative(product.stockQuantity), 0),
      salesValueEur,
      potentialUpliftEur: saleableCostComplete ? salesValueEur - saleableCostValueEur : null,
    },
    dataGaps: {
      unknownStockSkuCount: products.length - known.length,
      unvaluedStockSkuCount: unvalued.length,
      unvaluedStockPieces: unvalued.reduce(
        (sum, product) => sum + finiteNonNegative(product.stockQuantity), 0),
      missingCartonSkuCount: products.filter((product) =>
        product.active && !product.demo && cartonSize(product) === null).length,
      negativeStockSkuCount: known.filter((product) => finite(product.stockQuantity) < 0).length,
    },
    zeroStock: {
      count: zeroRows.length,
      withIncomingCount: zeroRows.filter((row) => row.expectedPieces > 0).length,
      withoutIncomingCount: zeroRows.filter((row) => row.expectedPieces <= 0).length,
      rows: zeroRows,
    },
    belowCarton: { count: belowCartonRows.length, rows: belowCartonRows },
    incoming: {
      skuCount: incomingRows.length,
      pieces: incomingRows.reduce((sum, row) => sum + row.pieces, 0),
      nextArrival: incomingRows.find((row) => row.expectedArrival)?.expectedArrival ?? null,
      rows: incomingRows,
    },
    topCapital: capitalRows.slice(0, limit),
    velocity: {
      days: velocityDays,
      piecesSold,
      skuCount: [...soldByProduct.values()].filter((pieces) => pieces > 0).length,
      weeklyPieces: Math.round((piecesSold / weeks) * 10) / 10,
    },
    reorder: { horizonWeeks: reorderWeeks, count: reorderRows.length, rows: reorderRows.slice(0, limit) },
    slowMovers: {
      count: slowRows.length,
      valueEur: slowRows.reduce((sum, row) => sum + row.costValueEur, 0),
      rows: slowRows.slice(0, limit),
    },
  };
}

/** Pieces per product on issued invoices dated within the last `days` days up to today. */
function piecesSoldByProduct(
  sales: readonly SalesOrderView[],
  today: string,
  days: number,
): Map<number, number> {
  const sold = new Map<number, number>();
  const start = shiftIsoDay(today, -(days - 1));
  for (const row of sales) {
    if (docType(row) !== 'FACTUUR' || row.order.status === 'CONCEPT') continue;
    if (!inOrderDateRange(row.order.orderDate, start, today)) continue;
    for (const line of row.priced.lines) {
      if (!Number.isInteger(line.productId)) continue;
      sold.set(line.productId, (sold.get(line.productId) ?? 0) + finiteNonNegative(line.quantity));
    }
  }
  return sold;
}

function shiftIsoDay(day: string, offset: number): string {
  const date = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)) + offset));
  return date.toISOString().slice(0, 10);
}

function commercialBucket(rows: readonly SalesOrderView[]): CommercialBucket {
  return {
    count: rows.length,
    pieces: rows.reduce((sum, row) => sum + finiteNonNegative(row.priced.totals.pieces), 0),
    calculatedValueEur: rows.reduce(
      (sum, row) => sum + finiteNonNegative(row.priced.totals.total), 0),
    missingCostLines: missingCostLines(rows),
  };
}

function topCustomers(
  rows: readonly SalesOrderView[],
  names: ReadonlyMap<number | null, string>,
  limit: number,
): SalesCustomerMetric[] {
  const grouped = new Map<number | null, SalesCustomerMetric>();
  for (const row of rows) {
    const customerId = row.order.customerId;
    const current = grouped.get(customerId) ?? {
      customerId,
      name: names.get(customerId) ?? 'Geen klant',
      orderCount: 0,
      pieces: 0,
      calculatedValueEur: 0,
    };
    current.orderCount++;
    current.pieces += finiteNonNegative(row.priced.totals.pieces);
    current.calculatedValueEur += invoiceClaim(row);
    grouped.set(customerId, current);
  }
  return [...grouped.values()]
    .sort((left, right) => right.calculatedValueEur - left.calculatedValueEur
      || compareName(left.name, right.name))
    .slice(0, limit);
}

function topProducts(rows: readonly SalesOrderView[], limit: number): SalesProductMetric[] {
  const grouped = new Map<number, SalesProductMetric & { orderIds: Set<number> }>();
  for (const row of rows) {
    const rawGoods = row.priced.lines.reduce((sum, line) => sum + finiteNonNegative(line.net), 0);
    const goodsFactor = rawGoods > 0
      ? finiteNonNegative(row.priced.totals.goodsTotal) / rawGoods : 0;
    for (const line of row.priced.lines) {
      const current = grouped.get(line.productId) ?? {
        productId: line.productId,
        sku: line.sku || null,
        name: line.description || line.sku || `Product ${line.productId}`,
        orderCount: 0,
        pieces: 0,
        calculatedGoodsValueEur: 0,
        orderIds: new Set<number>(),
      };
      current.orderIds.add(row.order.id);
      current.orderCount = current.orderIds.size;
      current.pieces += finiteNonNegative(line.quantity);
      current.calculatedGoodsValueEur += finiteNonNegative(line.net) * goodsFactor;
      grouped.set(line.productId, current);
    }
  }
  return [...grouped.values()]
    .sort((left, right) => right.calculatedGoodsValueEur - left.calculatedGoodsValueEur
      || right.pieces - left.pieces || compareName(left.name, right.name))
    .slice(0, limit)
    .map(({ orderIds: _orderIds, ...row }) => row);
}

function attentionOrders(
  rows: readonly SalesOrderView[],
  customerNames: ReadonlyMap<number | null, string>,
  today: string,
): SalesAttentionOrder[] {
  return rows.flatMap((row): SalesAttentionOrder[] => {
    const reasons: string[] = [];
    let severity: SalesAttentionOrder['severity'] = 'info';
    if (docType(row) === 'FACTUUR' && row.order.status !== 'CONCEPT'
        && row.order.status !== 'BETAALD') {
      if (isOverdue(row, today)) {
        reasons.push('Factuur vervallen');
        severity = 'danger';
      } else {
        reasons.push('Betaling open');
      }
    }
    if (docType(row) === 'OFFERTE') {
      if (row.order.status === 'WIJZIGING_GEVRAAGD') {
        reasons.push('Klant vraagt een wijziging');
        severity = 'warning';
      }
      if (row.awaitingResend) {
        reasons.push('Aangepast voorstel opnieuw versturen');
        severity = 'warning';
      }
      if (OPEN_QUOTE_STATUSES.has(row.order.status) && row.order.deliveryTerms === 'TE_BEPALEN') {
        reasons.push('Levertermijn invullen');
        severity = severity === 'danger' ? severity : 'warning';
      }
      if (OPEN_QUOTE_STATUSES.has(row.order.status) && row.order.freight === 'TE_BEPALEN') {
        reasons.push('Vracht invullen');
        severity = severity === 'danger' ? severity : 'warning';
      }
    }
    const missing = row.priced.validation.productsWithoutCost.length;
    if (missing > 0 && (OPEN_QUOTE_STATUSES.has(row.order.status) || docType(row) === 'FACTUUR')) {
      reasons.push(`${missing} productregel${missing === 1 ? '' : 's'} zonder kostprijs`);
      if (severity === 'info') severity = 'warning';
    }
    if (!reasons.length) return [];
    return [{
      orderId: row.order.id,
      number: row.order.number,
      docType: docType(row),
      status: row.order.status,
      customerId: row.order.customerId,
      customerName: customerNames.get(row.order.customerId) ?? 'Geen klant',
      orderDate: row.order.orderDate,
      dueDate: row.order.invoiceDueDate ?? null,
      calculatedValueEur: docType(row) === 'FACTUUR'
        ? invoiceClaim(row) : finiteNonNegative(row.priced.totals.total),
      reasons,
      severity,
    }];
  }).sort((left, right) => severityRank(left.severity) - severityRank(right.severity)
    || (left.dueDate ?? '9999-99-99').localeCompare(right.dueDate ?? '9999-99-99')
    || right.orderDate.localeCompare(left.orderDate));
}

interface AggregatedExpected {
  productId: number;
  pieces: number;
  nextArrival: string | null;
  orderIds: number[];
  orderNumbers: string[];
}

function aggregateExpected(rows: readonly ExpectedStock[]): Map<number, AggregatedExpected> {
  const grouped = new Map<number, {
    productId: number; pieces: number; nextArrival: string | null;
    orderIds: Set<number>; orderNumbers: Set<string>;
  }>();
  for (const row of rows) {
    if (!Number.isInteger(row.productId) || row.productId <= 0) continue;
    const current = grouped.get(row.productId) ?? {
      productId: row.productId,
      pieces: 0,
      nextArrival: null,
      orderIds: new Set<number>(),
      orderNumbers: new Set<string>(),
    };
    current.pieces += finiteNonNegative(row.quantity);
    if (isoDayOrNull(row.expectedArrival)
        && (!current.nextArrival || row.expectedArrival! < current.nextArrival)) {
      current.nextArrival = row.expectedArrival;
    }
    row.orderIds.filter((id) => Number.isInteger(id) && id > 0)
      .forEach((id) => current.orderIds.add(id));
    row.orderNumbers.filter(Boolean).forEach((number) => current.orderNumbers.add(number));
    grouped.set(row.productId, current);
  }
  return new Map([...grouped].map(([productId, row]) => [productId, {
    productId,
    pieces: row.pieces,
    nextArrival: row.nextArrival,
    orderIds: [...row.orderIds],
    orderNumbers: [...row.orderNumbers],
  }]));
}

function inventoryAttentionRow(
  product: Product & { id: number | null },
  expected: AggregatedExpected | undefined,
): InventoryAttentionRow {
  const stockPieces = finite(product.stockQuantity);
  const piecesPerCarton = cartonSize(product);
  return {
    productId: product.id!,
    sku: product.sku,
    name: product.name,
    colour: product.colour,
    stockPieces,
    piecesPerCarton,
    missingPiecesToCarton: piecesPerCarton === null
      ? null : Math.max(0, piecesPerCarton - Math.max(0, stockPieces)),
    expectedPieces: expected?.pieces ?? 0,
    nextArrival: expected?.nextArrival ?? null,
    orderIds: expected?.orderIds ?? [],
  };
}

function docType(row: SalesOrderView): 'OFFERTE' | 'FACTUUR' {
  return row.order.docType === 'FACTUUR' ? 'FACTUUR' : 'OFFERTE';
}

function invoiceClaim(row: SalesOrderView): number {
  return finiteNonNegative(row.priced.totals.totalInclVat);
}

function sumInvoiceClaims(rows: readonly SalesOrderView[]): number {
  return rows.reduce((sum, row) => sum + invoiceClaim(row), 0);
}

function missingCostLines(rows: readonly SalesOrderView[]): number {
  return rows.reduce((sum, row) =>
    sum + (row.priced.validation.productsWithoutCost?.length ?? 0), 0);
}

function isOverdue(row: SalesOrderView, today: string): boolean {
  const due = isoDayOrNull(row.order.invoiceDueDate);
  return docType(row) === 'FACTUUR' && row.order.status !== 'BETAALD'
    && row.order.status !== 'CONCEPT' && due !== null && due < today;
}

function inOrderDateRange(day: string, from: string | null, to: string | null): boolean {
  const date = isoDayOrNull(day);
  if (!date) return false;
  return (!from || date >= from) && (!to || date <= to);
}

function cartonSize(product: Product): number | null {
  const pieces = product.carton?.piecesPerCarton;
  return pieces != null && Number.isInteger(pieces) && pieces > 0 ? pieces : null;
}

function percentage(value: number, total: number): number | null {
  return Number.isFinite(value) && Number.isFinite(total) && total > 0
    ? (value / total) * 100 : null;
}

function finite(value: number | null | undefined): number {
  return value != null && Number.isFinite(value) ? value : 0;
}

function finiteNonNegative(value: number | null | undefined): number {
  return Math.max(0, finite(value));
}

function validMoney(value: number | null | undefined): boolean {
  return value != null && Number.isFinite(value) && value >= 0;
}

function positiveWhole(value: number | null | undefined, fallback: number): number {
  return value != null && Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
}

function isoDayOrNull(value: string | null | undefined): string | null {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function localIsoDay(date = new Date()): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function compareName(left: string, right: string): number {
  return left.localeCompare(right, 'nl', { sensitivity: 'base' });
}

function severityRank(severity: SalesAttentionOrder['severity']): number {
  return severity === 'danger' ? 0 : severity === 'warning' ? 1 : 2;
}
