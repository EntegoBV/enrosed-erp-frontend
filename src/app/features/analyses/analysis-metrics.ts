import type {
  Customer,
  ExpectedStock,
  Product,
  SalesOrderView,
  PurchaseOrderView,
  CompanyCost,
  PartnerFinancing,
  SalesAccounting,
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

export interface SalesChannelMetric {
  channel: string;
  invoiceCount: number;
  /** Excluding VAT: the revenue as the result analysis counts it. */
  revenueExclEur: number;
  claimInclEur: number;
  goodsValueEur: number;
  marginEur: number;
  sharePct: number;
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
  /** Issued invoices per sales channel, biggest first: direct, website, TICA, partner, fair. */
  channels: SalesChannelMetric[];
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
  /** Pieces already invoiced to a partner but not yet shipped: their money sits on our shelves. */
  partnerPieces: number;
  partnerCostValueEur: number;
  /** The cost value that is really ours: everything valued minus the partner's pieces. */
  ownCostValueEur: number;
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
  const quotes = selected.filter((row) => docType(row) === 'OFFERTE' && !isPartnerFundingDocument(row));
  const invoices = selected.filter((row) => docType(row) === 'FACTUUR');

  const pipelineRows = quotes.filter((row) => OPEN_QUOTE_STATUSES.has(row.order.status));
  const acceptedRows = quotes.filter((row) => row.order.status === 'GEACCEPTEERD');
  const sentCount = quotes.filter((row) => !!row.order.sentAt).length;
  const viewedCount = quotes.filter((row) => !!row.order.viewedAt || row.order.viewCount > 0).length;
  const acceptedCount = acceptedRows.length;
  const rejectedCount = quotes.filter((row) => row.order.status === 'AFGEWEZEN').length;
  const expiredCount = quotes.filter((row) => row.order.status === 'VERLOPEN').length;
  const closedCount = quotes.filter((row) => CLOSED_QUOTE_STATUSES.has(row.order.status)).length;

  const issuedInvoices = invoices.filter(isIssuedInvoice);
  const paidInvoices = issuedInvoices.filter((row) => invoiceOutstanding(row) === 0 && invoiceClaim(row) > 0);
  const outstandingInvoices = issuedInvoices.filter((row) => invoiceOutstanding(row) > 0);
  const overdueInvoices = outstandingInvoices.filter((row) => isOverdue(row, today));
  const invoiceGoods = issuedInvoices.reduce(
    (sum, row) => sum + documentAccounting(row).recognizedRevenueEur, 0);
  const invoiceMargin = issuedInvoices.reduce(
    (sum, row) => sum + documentAccounting(row).recognizedProfitEur, 0);
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
      draft: invoices.filter((row) => row.order.status === 'CONCEPT').length,
      issued: issuedInvoices.length,
      paid: paidInvoices.length,
      outstanding: outstandingInvoices.length,
      overdue: overdueInvoices.length,
      issuedValueEur: sumInvoiceClaims(issuedInvoices),
      paidValueEur: round2(issuedInvoices.reduce((sum, row) => sum + invoiceReceived(row), 0)),
      outstandingValueEur: round2(outstandingInvoices.reduce((sum, row) => sum + invoiceOutstanding(row), 0)),
      overdueValueEur: round2(overdueInvoices.reduce((sum, row) => sum + invoiceOutstanding(row), 0)),
      averageClaimEur: issuedInvoices.length ? issuedValue / issuedInvoices.length : null,
      avgDaysToPaid: paymentDays.length
        ? Math.round(paymentDays.reduce((sum, days) => sum + days, 0) / paymentDays.length) : null,
      marginEur: invoiceMargin,
      marginPct: percentage(invoiceMargin, invoiceGoods),
      missingCostLines: missingCostLines(issuedInvoices.filter((row) => !isAdvanceDocument(row))),
    },
    topCustomers: topCustomers(issuedInvoices, customerNames, limit),
    topProducts: topProducts(issuedInvoices, limit),
    topCountries: topCountries(issuedInvoices, limit),
    channels: channelMetrics(issuedInvoices),
    monthly: monthlyPoints(quotes, issuedInvoices, acceptedRows, from, to),
    attentionOrders: attentionOrders(selected, customerNames, today),
  };
}

/** Where a document sold: the stored channel, direct when none was chosen. */
function channelOf(order: SalesOrderView['order']): string {
  return (order.salesChannel ?? '').trim().toUpperCase() || 'DIRECT';
}

function channelMetrics(rows: readonly SalesOrderView[]): SalesChannelMetric[] {
  const buckets = new Map<string, SalesChannelMetric>();
  for (const row of rows) {
    const channel = channelOf(row.order);
    const bucket = buckets.get(channel) ?? { channel, invoiceCount: 0, revenueExclEur: 0, claimInclEur: 0, goodsValueEur: 0, marginEur: 0, sharePct: 0 };
    bucket.invoiceCount += 1;
    bucket.revenueExclEur = round2(bucket.revenueExclEur + documentAccounting(row).recognizedRevenueEur);
    bucket.claimInclEur = round2(bucket.claimInclEur + finite(row.priced.totals.totalInclVat));
    bucket.goodsValueEur = round2(bucket.goodsValueEur + documentAccounting(row).recognizedRevenueEur);
    bucket.marginEur = round2(bucket.marginEur + documentAccounting(row).recognizedProfitEur);
    buckets.set(channel, bucket);
  }
  const total = [...buckets.values()].reduce((sum, bucket) => sum + bucket.revenueExclEur, 0);
  return [...buckets.values()]
    .map((bucket) => ({ ...bucket, sharePct: total > 0 ? round2(bucket.revenueExclEur / total * 100) : 0 }))
    .sort((left, right) => right.revenueExclEur - left.revenueExclEur || left.channel.localeCompare(right.channel));
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
  const partnerQty = partnerPiecesAwaitingShipment(options.sales ?? []);
  const partnerPiecesOf = (product: Product): number =>
    product.id == null ? 0 : Math.min(finiteNonNegative(product.stockQuantity), partnerQty.get(product.id) ?? 0);
  const partnerPieces = positiveKnown.reduce((sum, product) => sum + partnerPiecesOf(product), 0);
  const partnerCostValueEur = valued.reduce((sum, product) =>
    sum + partnerPiecesOf(product) * finiteNonNegative(product.landedCostEur), 0);
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
      partnerPieces,
      partnerCostValueEur,
      ownCostValueEur: costValueEur - partnerCostValueEur,
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
/**
 * Pieces on partner invoices that have not left the door yet, per product.
 * Those goods are on our shelves but already the partner's money: a
 * settlement invoice carries no goods and a shipped invoice no longer counts.
 */
function partnerPiecesAwaitingShipment(sales: readonly SalesOrderView[]): Map<number, number> {
  const pieces = new Map<number, number>();
  for (const view of sales) {
    const order = view.order;
    if (!isIssuedInvoice(view) || !order.partnerPurchaseOrderId || order.goodsShippedAt || isAdvanceDocument(view)) continue;
    for (const line of view.priced.lines ?? []) {
      if (line.productId == null) continue;
      pieces.set(line.productId, (pieces.get(line.productId) ?? 0) + finiteNonNegative(line.quantity));
    }
  }
  return pieces;
}

/* ---------------------------------------------------------- partner money */

export interface PartnerFinancingRow {
  purchaseOrderId: number;
  number: string;
  alias: string | null;
  status: PurchaseOrderView['order']['status'];
  partnerName: string;
  sharePct: number | null;
  /** What the container cost us, landed. */
  landedEur: number;
  /** Issued advances, excluding VAT and the final settlement. */
  invoicedEur: number;
  /** Only a quote so far: the partner has not been invoiced yet. */
  quotedOnly: boolean;
  /** Whether every partner invoice for the goods is paid. */
  invoicesPaid: boolean;
  /** Net claim of issued final invoices, after advance deductions, excluding VAT. */
  settlementEur: number;
  /** Recognized profit from issued final invoices; advances and cash movements do not create profit. */
  resultEur: number;
  committedAdvanceEur: number;
  unbilledAdvanceEur: number;
  unbilledAdvanceCount: number;
  overdueUnbilledAdvanceEur: number;
  nextAdvanceDueDate: string | null;
  receivedEur: number;
  openEur: number;
  creditEur: number;
  ownExposureEur: number;
  settled: boolean;
  settledQuantity: number;
  remainingQuantity: number;
  costFinalized: boolean;
  /** Received, but the auction has not been settled yet: the statement is still to come. */
  awaitingSettlement: boolean;
  documents: { id: number; number: string; docType: 'OFFERTE' | 'FACTUUR'; settlement: boolean; status: string }[];
}

export interface PartnerFinancingAnalysis {
  own: { count: number; landedEur: number };
  partner: { count: number; landedEur: number };
  invoicedEur: number;
  settlementEur: number;
  resultEur: number;
  receivedEur: number;
  openEur: number;
  creditEur: number;
  ownExposureEur: number;
  committedAdvanceEur: number;
  unbilledAdvanceEur: number;
  unbilledAdvanceCount: number;
  overdueUnbilledAdvanceEur: number;
  /** Saved funding terms awaiting their own invoice, due terms first. */
  unbilledAdvances: PartnerFinancingRow[];
  /** Partner containers received without an auction settlement so far. */
  awaitingSettlement: number;
  rows: PartnerFinancingRow[];
}

const DEAD_SALES_STATUSES = new Set<SalesOrderView['order']['status']>(['GEANNULEERD', 'AFGEWEZEN', 'VERLOPEN']);

/**
 * Which containers run on our own money and which on a partner's, with
 * agreed funding, actual cash, remaining invoice claims and recognized profit.
 * Server summaries include partner containers even before their first document.
 */
export function partnerFinancingAnalysis(
  purchases: readonly PurchaseOrderView[],
  sales: readonly SalesOrderView[],
  customers: readonly Customer[] = [],
  summaries: readonly PartnerFinancing[] = [],
): PartnerFinancingAnalysis {
  const byContainer = new Map<number, SalesOrderView[]>();
  for (const view of sales) {
    const id = view.order.partnerPurchaseOrderId;
    if (id == null || !isPartnerFundingDocument(view) || DEAD_SALES_STATUSES.has(view.order.status)) continue;
    byContainer.set(id, [...(byContainer.get(id) ?? []), view]);
  }
  const customerName = (id: number | null | undefined): string =>
    customers.find((row) => row.id === id)?.company ?? 'Partner';
  const rows: PartnerFinancingRow[] = [];
  let ownCount = 0;
  let ownLanded = 0;
  for (const purchase of purchases) {
    const docs = byContainer.get(purchase.order.id) ?? [];
    /* The partner pays inspection and the other separate costs too: the landed figure includes them. */
    const summary = summaries.find((row) => row.purchaseOrderId === purchase.order.id);
    const landedEur = summary?.forecastExternalEur ?? finiteNonNegative(purchase.reconciliation?.totals.forecastExternalEur
      ?? purchase.costing?.totals?.totalWithSeparateCostsEur ?? purchase.costing?.totals?.totalEur);
    if (!summary && !purchase.order.partnerCustomerId && !docs.length) {
      ownCount += 1;
      ownLanded += landedEur;
      continue;
    }
    const settlement = (view: SalesOrderView): boolean => isSettlementDocument(view);
    const goodsInvoices = docs.filter((view) => isIssuedInvoice(view) && !settlement(view));
    const settlements = docs.filter((view) => isIssuedInvoice(view) && settlement(view));
    const invoicedEur = goodsInvoices.reduce((sum, view) => sum + finite(view.priced.totals.total), 0);
    const settlementEur = settlements.reduce((sum, view) => sum + finite(view.priced.totals.total), 0);
    const quotedOnly = goodsInvoices.length === 0;
    const first = docs.slice().sort((left, right) => left.order.id - right.order.id)[0];
    const receivedEur = summary?.totalReceivedEur ?? docs.filter(isIssuedInvoice).reduce((sum, row) => sum + invoiceReceived(row), 0);
    const settled = summary?.settlementComplete ?? (settlements.some((row) => row.settlement?.finalSettlement !== false)
      || !!summary?.documents.some((row) => row.purpose === 'PARTNER_SETTLEMENT' && row.docType === 'FACTUUR' && row.status !== 'CONCEPT' && !DEAD_SALES_STATUSES.has(row.status)));
    rows.push({
      purchaseOrderId: purchase.order.id,
      number: purchase.order.number,
      alias: purchase.order.alias ?? null,
      status: purchase.order.status,
      partnerName: summary?.partnerName ?? customerName(purchase.order.partnerCustomerId ?? first?.order.customerId),
      sharePct: summary?.profitSharePct ?? purchase.order.partnerSharePct ?? first?.order.partnerSharePct ?? null,
      landedEur,
      invoicedEur: summary?.invoicedAdvanceEur ?? invoicedEur,
      quotedOnly,
      invoicesPaid: goodsInvoices.length > 0 && goodsInvoices.every((view) => invoiceOutstanding(view) === 0),
      settlementEur: summary?.settlementEur ?? settlementEur,
      resultEur: summary?.recognizedProfitEur ?? round2(settlements.reduce((sum, view) => sum + documentAccounting(view).recognizedProfitEur, 0)),
      committedAdvanceEur: summary?.committedAdvanceEur ?? round2(landedEur * (purchase.order.partnerCostPct ?? 100) / 100),
      unbilledAdvanceEur: finiteNonNegative(summary?.unbilledAdvanceEur),
      unbilledAdvanceCount: finiteNonNegative(summary?.unbilledAdvanceCount),
      overdueUnbilledAdvanceEur: finiteNonNegative(summary?.overdueUnbilledAdvanceEur),
      nextAdvanceDueDate: summary?.nextAdvanceDueDate ?? null,
      receivedEur, openEur: summary?.totalOpenEur ?? round2(docs.filter(isIssuedInvoice).reduce((sum, row) => sum + invoiceOutstanding(row), 0)),
      creditEur: summary?.creditEur ?? 0,
      ownExposureEur: summary?.ownExposureEur ?? Math.max(0, finite(purchase.reconciliation?.totals.paidEur) - receivedEur),
      settled,
      settledQuantity: summary?.settledQuantity ?? settlements.reduce((total, row) => total + finite(row.priced.totals.pieces), 0),
      remainingQuantity: summary?.remainingQuantity ?? 0,
      costFinalized: summary?.costFinalized ?? false,
      awaitingSettlement: purchase.order.status === 'ONTVANGEN' && !settled,
      documents: summary ? summary.documents.map((doc) => ({ id: doc.id, number: doc.number, docType: doc.docType === 'FACTUUR' ? 'FACTUUR' : 'OFFERTE', settlement: doc.purpose === 'PARTNER_SETTLEMENT', status: doc.status })) : docs
        .slice()
        .sort((left, right) => left.order.id - right.order.id)
        .map((view) => ({ id: view.order.id, number: view.order.number, docType: view.order.docType === 'FACTUUR' ? 'FACTUUR' : 'OFFERTE', settlement: settlement(view), status: view.order.status })),
    });
  }
  rows.sort((left, right) => right.purchaseOrderId - left.purchaseOrderId);
  return {
    own: { count: ownCount, landedEur: round2(ownLanded) },
    partner: { count: rows.length, landedEur: round2(rows.reduce((sum, row) => sum + row.landedEur, 0)) },
    invoicedEur: round2(rows.reduce((sum, row) => sum + (row.quotedOnly ? 0 : row.invoicedEur), 0)),
    settlementEur: round2(rows.reduce((sum, row) => sum + row.settlementEur, 0)),
    resultEur: round2(rows.reduce((sum, row) => sum + row.resultEur, 0)),
    receivedEur: round2(rows.reduce((sum, row) => sum + row.receivedEur, 0)),
    openEur: round2(rows.reduce((sum, row) => sum + row.openEur, 0)),
    creditEur: round2(rows.reduce((sum, row) => sum + row.creditEur, 0)),
    ownExposureEur: round2(rows.reduce((sum, row) => sum + row.ownExposureEur, 0)),
    committedAdvanceEur: round2(rows.reduce((sum, row) => sum + row.committedAdvanceEur, 0)),
    unbilledAdvanceEur: round2(rows.reduce((sum, row) => sum + row.unbilledAdvanceEur, 0)),
    unbilledAdvanceCount: rows.reduce((sum, row) => sum + row.unbilledAdvanceCount, 0),
    overdueUnbilledAdvanceEur: round2(rows.reduce((sum, row) => sum + row.overdueUnbilledAdvanceEur, 0)),
    unbilledAdvances: rows.filter((row) => row.unbilledAdvanceCount > 0).sort((left, right) =>
      Number(right.overdueUnbilledAdvanceEur > 0) - Number(left.overdueUnbilledAdvanceEur > 0)
      || (left.nextAdvanceDueDate ?? '9999-12-31').localeCompare(right.nextAdvanceDueDate ?? '9999-12-31')
      || left.purchaseOrderId - right.purchaseOrderId),
    awaitingSettlement: rows.filter((row) => row.awaitingSettlement).length,
    rows,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * A partner-deal settlement: flagged by the server, or an older one-line
 * settlement that only carried a profit-share line. Kept local so this
 * module stays free of runtime imports and testable on its own.
 */
function isSettlementDocument(view: SalesOrderView): boolean {
  const order = view.order;
  if (order.docType !== 'FACTUUR' || !order.partnerPurchaseOrderId) return false;
  if (order.purpose === 'PARTNER_SETTLEMENT' || order.partnerSettlement) return true;
  if ((view.priced.lines ?? []).length > 0) return false;
  return (order.extraLines ?? []).some((line) => (line.description ?? '').startsWith('Winstdeling'));
}

function piecesSoldByProduct(
  sales: readonly SalesOrderView[],
  today: string,
  days: number,
): Map<number, number> {
  const sold = new Map<number, number>();
  const start = shiftIsoDay(today, -(days - 1));
  for (const row of sales) {
    if (!isIssuedInvoice(row) || isAdvanceDocument(row)) continue;
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
    current.pieces += documentAccounting(row).recognizedQuantity;
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
    if (isAdvanceDocument(row)) continue;
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
        ? invoiceOutstanding(row) : finiteNonNegative(row.priced.totals.total),
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
  return finiteNonNegative(row.paymentSummary?.invoiceTotalEur ?? row.priced.totals.totalInclVat);
}

function invoiceReceived(row: SalesOrderView): number {
  return row.paymentSummary ? finite(row.paymentSummary.receivedEur)
    : row.order.status === 'BETAALD' || row.order.paidAt ? invoiceClaim(row) : 0;
}

function invoiceOutstanding(row: SalesOrderView): number {
  return row.paymentSummary ? finiteNonNegative(row.paymentSummary.remainingEur) : Math.max(0, invoiceClaim(row) - invoiceReceived(row));
}

function isIssuedInvoice(view: SalesOrderView): boolean {
  return view.order.docType === 'FACTUUR' && view.order.status !== 'CONCEPT' && !DEAD_SALES_STATUSES.has(view.order.status);
}

function isAdvanceDocument(view: SalesOrderView): boolean {
  return view.order.purpose === 'PARTNER_ADVANCE' || (!view.order.purpose && !!view.order.partnerPurchaseOrderId && !isSettlementDocument(view));
}

/** Partner funding belongs to container financing rather than the regular commercial quote funnel. */
export function isPartnerFundingDocument(view: SalesOrderView): boolean {
  return view.order.purpose === 'PARTNER_ADVANCE' || view.order.purpose === 'PARTNER_SETTLEMENT'
    || (!view.order.purpose && !!view.order.partnerPurchaseOrderId);
}

/** Use the server's recognition, not the invoice claim after an advance deduction. */
export function documentAccounting(view: SalesOrderView): SalesAccounting {
  if (!isIssuedInvoice(view) || isAdvanceDocument(view)) return { recognizedRevenueEur: 0, recognizedCostEur: 0, recognizedProfitEur: 0, recognizedQuantity: 0 };
  if (view.accounting) return view.accounting;
  return { recognizedRevenueEur: finite(view.priced.totals.total), recognizedCostEur: finite(view.priced.totals.costTotal),
    recognizedProfitEur: finite(view.priced.totals.marginEur), recognizedQuantity: finiteNonNegative(view.priced.totals.pieces) };
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
  return isIssuedInvoice(row) && invoiceOutstanding(row) > 0 && due !== null && due < today;
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

/* ------------------------------------------------------------------ result */

export interface ResultChannelRow {
  channel: string;
  invoiceCount: number;
  revenueEur: number;
  goodsCostEur: number;
  marginEur: number;
  /** The company costs booked on this channel, such as the TICA stand. */
  costsEur: number;
  resultEur: number;
}

export interface ResultMonthRow {
  month: string;
  revenueEur: number;
  marginEur: number;
  costsEur: number;
  resultEur: number;
}

export interface ResultAnalysis {
  period: { from: string | null; to: string | null };
  invoiceCount: number;
  /** Issued invoices, excluding VAT. */
  revenueEur: number;
  /** The landed cost of the goods on those invoices. */
  goodsCostEur: number;
  marginEur: number;
  marginPct: number | null;
  /** The company's own costs in the period, excluding VAT. */
  costsEur: number;
  unpaidCostsEur: number;
  /** Margin on the goods minus the company costs. */
  resultEur: number;
  /** External paid cost plus open commitments for received containers; excludes internal markup. */
  purchasedEur: number;
  receivedContainers: number;
  byChannel: ResultChannelRow[];
  byCategory: { category: string; amountEur: number; sharePct: number }[];
  /** Oldest month first. */
  monthly: ResultMonthRow[];
  /** Invoice lines whose product has no landed cost: the margin is incomplete by that much. */
  missingCostLines: number;
}

const DEAD_STATUSES = new Set<SalesOrderView['order']['status']>(['GEANNULEERD', 'AFGEWEZEN', 'VERLOPEN']);

/**
 * What the company keeps: the margin on the goods invoiced in the period
 * minus what it spent on itself, per channel and per month. Sales are
 * counted when they were invoiced, costs when they were made.
 */
export function resultAnalysis(
  sales: readonly SalesOrderView[],
  purchases: readonly PurchaseOrderView[],
  costs: readonly CompanyCost[],
  options: { from?: string | null; to?: string | null } = {},
): ResultAnalysis {
  const from = isoDayOrNull(options.from);
  const to = isoDayOrNull(options.to);
  const inPeriod = (day: string | null | undefined): boolean =>
    !!day && (!from || day >= from) && (!to || day <= to);
  const invoices = sales.filter((row) => row.order.docType === 'FACTUUR' && row.order.status !== 'CONCEPT'
    && !DEAD_STATUSES.has(row.order.status) && inPeriod(row.order.orderDate));
  const periodCosts = costs.filter((cost) => inPeriod(cost.date));
  const received = purchases.filter((row) => row.order.status === 'ONTVANGEN' && inPeriod(row.order.receivedOn ?? null));

  const revenueEur = round2(invoices.reduce((sum, row) => sum + documentAccounting(row).recognizedRevenueEur, 0));
  const marginEur = round2(invoices.reduce((sum, row) => sum + documentAccounting(row).recognizedProfitEur, 0));
  const goodsCostEur = round2(invoices.reduce((sum, row) => sum + documentAccounting(row).recognizedCostEur, 0));
  const costsEur = round2(periodCosts.reduce((sum, cost) => sum + finiteNonNegative(cost.amountExclEur), 0));
  const unpaidCostsEur = round2(periodCosts.filter((cost) => !cost.paidOn)
    .reduce((sum, cost) => sum + finiteNonNegative(cost.amountExclEur) * (1 + finiteNonNegative(cost.vatPct) / 100), 0));
  const goodsTotal = invoices.reduce((sum, row) => sum + documentAccounting(row).recognizedRevenueEur, 0);

  const channels = new Map<string, ResultChannelRow>();
  const channelRow = (channel: string): ResultChannelRow => {
    const row = channels.get(channel) ?? { channel, invoiceCount: 0, revenueEur: 0, goodsCostEur: 0, marginEur: 0, costsEur: 0, resultEur: 0 };
    channels.set(channel, row);
    return row;
  };
  for (const invoice of invoices) {
    const row = channelRow(channelOf(invoice.order));
    row.invoiceCount += 1;
    row.revenueEur = round2(row.revenueEur + documentAccounting(invoice).recognizedRevenueEur);
    row.goodsCostEur = round2(row.goodsCostEur + documentAccounting(invoice).recognizedCostEur);
    row.marginEur = round2(row.marginEur + documentAccounting(invoice).recognizedProfitEur);
  }
  for (const cost of periodCosts) {
    if (!cost.salesChannel) continue;
    const row = channelRow(cost.salesChannel.trim().toUpperCase());
    row.costsEur = round2(row.costsEur + finiteNonNegative(cost.amountExclEur));
  }
  const byChannel = [...channels.values()]
    .map((row) => ({ ...row, resultEur: round2(row.marginEur - row.costsEur) }))
    .sort((left, right) => right.revenueEur - left.revenueEur || left.channel.localeCompare(right.channel));

  const categories = new Map<string, number>();
  for (const cost of periodCosts) {
    const key = (cost.category ?? '').trim().toUpperCase() || 'ANDERE';
    categories.set(key, round2((categories.get(key) ?? 0) + finiteNonNegative(cost.amountExclEur)));
  }
  const byCategory = [...categories.entries()]
    .map(([category, amountEur]) => ({ category, amountEur, sharePct: costsEur > 0 ? round2(amountEur / costsEur * 100) : 0 }))
    .sort((left, right) => right.amountEur - left.amountEur || left.category.localeCompare(right.category));

  const months = new Map<string, ResultMonthRow>();
  const monthRow = (month: string): ResultMonthRow => {
    const row = months.get(month) ?? { month, revenueEur: 0, marginEur: 0, costsEur: 0, resultEur: 0 };
    months.set(month, row);
    return row;
  };
  for (const invoice of invoices) {
    const row = monthRow(invoice.order.orderDate.slice(0, 7));
    row.revenueEur = round2(row.revenueEur + documentAccounting(invoice).recognizedRevenueEur);
    row.marginEur = round2(row.marginEur + documentAccounting(invoice).recognizedProfitEur);
  }
  for (const cost of periodCosts) {
    const row = monthRow(cost.date.slice(0, 7));
    row.costsEur = round2(row.costsEur + finiteNonNegative(cost.amountExclEur));
  }
  const monthly = [...months.values()]
    .map((row) => ({ ...row, resultEur: round2(row.marginEur - row.costsEur) }))
    .sort((left, right) => left.month.localeCompare(right.month));

  return {
    period: { from, to },
    invoiceCount: invoices.length,
    revenueEur,
    goodsCostEur,
    marginEur,
    marginPct: goodsTotal > 0 ? round2(marginEur / goodsTotal * 100) : null,
    costsEur,
    unpaidCostsEur: round2(unpaidCostsEur),
    resultEur: round2(marginEur - costsEur),
    purchasedEur: round2(received.reduce((sum, row) => sum + finiteNonNegative(row.reconciliation?.totals.forecastExternalEur
      ?? Math.max(0, finiteNonNegative(row.costing?.totals?.totalWithSeparateCostsEur ?? row.costing?.totals?.totalEur)
        - finiteNonNegative(row.costing?.totals?.extraRevenueEur))), 0)),
    receivedContainers: received.length,
    byChannel,
    byCategory,
    monthly,
    missingCostLines: invoices.reduce((sum, row) => sum + (row.priced.validation?.productsWithoutCost?.length ?? 0), 0),
  };
}
