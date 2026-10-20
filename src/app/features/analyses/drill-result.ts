import type { ReceivedContainerRow, ResultCostRow, SalesDocumentRow } from './analysis-metrics';
import type { DrillColumn, DrillGroup, DrillRow, DrillView } from './drill-model';

/*
 * The drill-downs of Resultaat (design/analyses2/design.md §B.4): Eigen kosten and each category, Containers
 * ontvangen, a month and a sales channel (Algemene kosten included). Omzet and Marge op goederen open Verkoop's views
 * (drill-sales.ts) with Resultaat's figures. Rows from resultCostRows, receivedContainerRows and salesDocumentRows
 * (analysis-metrics.ts); each view takes its figure from the value the page shows (rule A.4). A credit note shows no
 * result: its effect is the gap row "Creditnota's".
 *
 * Pure and node-tested (tests/analyses-drill-result.test.mts): type imports only; names come in as functions.
 */

export interface ResultDrillContext {
  /** "Dit jaar · 1 jan – 20 okt 2026": the page's period and its range. */
  period: string;
  /** "Rechtstreeks", "Website", "TICA" (sales-channels.ts). */
  channelName: (code: string) => string;
  /** "Huur & magazijn", "Afschrijvingen" (cost-categories.ts). */
  categoryName: (code: string) => string;
  /** Kosten & bank › Kosten of the same period (the page's costsQuery). */
  costsQuery: Readonly<Record<string, string | number | null>>;
}

/** A TICA month of the period: drill-sales' TicaMonthRow has this shape. */
export interface ResultTicaMonth {
  month: string;
  /** The month clipped to the period: the window of its /tica link. */
  from: string;
  to: string;
  transactions: number;
  revenueExclEur: number;
  /** Null while a line has no cost. */
  marginEur: number | null;
}

/** The figure of a month or channel row: its result, unless a product cost is missing (the page then shows "—"). */
export interface ResultRowFigure {
  resultEur: number;
  complete: boolean;
}

const MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'] as const;
const INCOMPLETE = 'Onvolledig: productkosten ontbreken';
/* Costs count without the btw we deduct; non-deductible btw is part of the cost (costChargeIn → expenseOf). */
const COST_BASIS = 'zonder aftrekbare btw';
const FLOW_BASIS = 'omzet excl. btw · kosten zonder aftrekbare btw';

const COL = {
  date: { key: 'date', label: 'Datum', format: 'day', width: '84px', phone: 'sub' },
  what: { key: 'what', label: 'Omschrijving', format: 'text', width: 'minmax(0,1.6fr)', phone: 'title' },
  party: { key: 'party', label: 'Aan wie', format: 'text', phone: 'sub' },
  channel: { key: 'channel', label: 'Kanaal', format: 'text', phone: 'none' },
  open: { key: 'open', label: 'Open incl.', format: 'eur', phone: 'none', sum: true },
  /* A cost's charge (expenseOf): excl. btw plus the btw we cannot deduct, so not an "excl." amount. */
  amount: { key: 'amount', label: 'Kost', format: 'eur', phone: 'value' },
  revenue: { key: 'revenue', label: 'Omzet excl.', format: 'eur', phone: 'none', sum: true },
  result: { key: 'result', label: 'Resultaat', format: 'eurSigned', phone: 'value' },
} as const satisfies Record<string, DrillColumn>;

const COST_COLUMNS: readonly DrillColumn[] = [COL.date, COL.what, COL.party, COL.channel, COL.open, COL.amount];
const FLOW_COLUMNS: readonly DrillColumn[] = [COL.what, COL.date, COL.revenue, COL.result];
const FLOW_GROUPS: readonly DrillGroup[] = [{ key: 'sales', label: 'Verkoop' }, { key: 'tica', label: 'TICA' }, { key: 'costs', label: 'Kosten' }];

/**
 * A cost part as a row. Outside the category groups an investment's part says so: a pill (the dialog sets it after
 * the row's name) in the month and channel views, the word after the description in Algemene kosten.
 */
function costRow(row: ResultCostRow, ctx: ResultDrillContext, options: { group?: string; mark?: 'pill' | 'text'; sign?: 1 | -1 } = {}): DrillRow {
  const what = row.description || ctx.categoryName(row.categoryKey);
  const depreciation = row.part === 'depreciation';
  return {
    key: row.key,
    group: options.group ?? null,
    pill: options.mark === 'pill' && depreciation ? 'Afschrijving' : null,
    cells: {
      date: row.date, what: options.mark === 'text' && depreciation ? `${what} · afschrijving` : what, party: row.party,
      channel: row.channel ? ctx.channelName(row.channel) : null, open: row.openEur, amount: (options.sign ?? 1) * row.amountEur,
    },
    link: row.id !== null ? { path: ['/costs'], query: { cost: row.id } } : null,
  };
}

/** Eigen kosten: every cost part of the period, grouped per category in Kosten per categorie's order. */
export function costsView(rows: readonly ResultCostRow[], order: readonly string[], figure: number, ctx: ResultDrillContext): DrillView {
  /* A category that only holds an open cost of € 0 (import VAT) has no row of its own there: it goes last. */
  const keys = [...new Set([...order, ...rows.map((row) => row.categoryKey)])].filter((key) => rows.some((row) => row.categoryKey === key));
  return {
    id: 'result.costs', title: 'Eigen kosten', scope: `${ctx.period} · ${COST_BASIS}`,
    rows: rows.map((row) => costRow(row, ctx, { group: row.categoryKey })),
    groups: keys.map((key) => ({ key, label: ctx.categoryName(key) })),
    columns: COST_COLUMNS, valueKey: 'amount', total: { value: figure, format: 'eur', of: 'sum' },
    sort: { key: 'amount', dir: 'desc' }, empty: 'Geen kosten in deze periode.',
    foot: { label: 'Alle kosten ›', link: { path: ['/costs'], query: ctx.costsQuery } },
  };
}

/** One row of Kosten per categorie: its cost parts; Kosten & bank opens on the category (Afschrijvingen has none there). */
export function categoryView(code: string, rows: readonly ResultCostRow[], figure: number, ctx: ResultDrillContext): DrillView {
  return {
    id: `result.category.${code}`, title: ctx.categoryName(code), scope: `${ctx.period} · ${COST_BASIS}`,
    rows: rows.filter((row) => row.categoryKey === code).map((row) => costRow(row, ctx)),
    columns: COST_COLUMNS, valueKey: 'amount', total: { value: figure, format: 'eur', of: 'sum' },
    sort: { key: 'amount', dir: 'desc' }, empty: 'Geen kosten in deze categorie.',
    foot: { label: 'In Kosten & bank ›', link: { path: ['/costs'], query: code === 'AFSCHRIJVINGEN' ? ctx.costsQuery : { ...ctx.costsQuery, cat: code } } },
  };
}

/** Containers ontvangen: the period's received containers and their external cost (outside the result). */
export function receivedView(rows: readonly ReceivedContainerRow[], figure: number, ctx: ResultDrillContext,
  names: { container: (row: ReceivedContainerRow) => string; supplier: (id: number) => string; amount: (value: number) => string }): DrillView {
  const partner = rows.filter((row) => row.partner).reduce((sum, row) => sum + row.externalCostEur, 0);
  return {
    id: 'result.received', title: 'Containers ontvangen', scope: `${ctx.period} · op ontvangstdatum`,
    summary: partner > 0 ? `waarvan partner ${names.amount(partner)}` : null,
    rows: rows.map((row) => ({
      key: `o${row.id}`, pill: row.partner ? 'Partner' : null, link: { path: ['/purchasing', row.id] },
      cells: { name: names.container(row), supplier: names.supplier(row.supplierId), received: row.receivedOn, state: row.finalized ? 'Afgerekend' : 'Voorlopig',
        cost: row.externalCostEur },
    })),
    columns: [{ key: 'name', label: 'Container', format: 'text', phone: 'title' }, { key: 'supplier', label: 'Leverancier', format: 'text', phone: 'sub' },
      { key: 'received', label: 'Ontvangen', format: 'day', phone: 'sub' }, { key: 'state', label: 'Afrekening', format: 'text', phone: 'none' },
      { key: 'cost', label: 'Externe kost', format: 'eur', phone: 'value' }],
    valueKey: 'cost', total: { value: figure, format: 'eur', of: 'sum' }, sort: { key: 'received', dir: 'desc' },
    empty: 'Geen containers ontvangen in deze periode.',
  };
}

/** "Creditnota", "Voorschot", "Slotfactuur": drill-sales' word after a document number. */
function documentPill(doc: SalesDocumentRow): string | null {
  if (doc.kind === 'CREDITNOTA') return 'Creditnota';
  if (doc.advance || doc.advanceStage === 'ADVANCE') return 'Voorschot';
  return doc.settlement || doc.advanceStage === 'FINAL' ? 'Slotfactuur' : null;
}

/** A document that moves the result: issued, with revenue or margin (a voorschot moves neither). */
function resultDocument(doc: SalesDocumentRow): boolean {
  return doc.kind !== 'OFFERTE' && (doc.revenueExclEur !== 0 || doc.profitEur !== 0);
}

function documentRow(doc: SalesDocumentRow): DrillRow {
  return {
    key: `d${doc.id}`, group: 'sales', pill: documentPill(doc), link: { path: ['/sales', doc.id] },
    /* A credit note shows no result: its effect is the gap row. */
    cells: { what: `${doc.number} · ${doc.customerName}`, date: doc.orderDate, revenue: doc.revenueExclEur, result: doc.marginEur },
  };
}

function ticaRow(row: ResultTicaMonth, withMonth: boolean): DrillRow {
  const sales = `${row.transactions} ${row.transactions === 1 ? 'verkoop' : 'verkopen'}`;
  return {
    key: `t${row.month}`, group: 'tica', pill: 'TICA', link: { path: ['/tica'], query: { from: row.from, to: row.to } },
    cells: { what: withMonth ? `TICA · ${MONTHS[Number(row.month.slice(5, 7)) - 1]} · ${sales}` : `TICA · ${sales}`, date: row.to,
      revenue: row.revenueExclEur, result: row.marginEur },
  };
}

function flowCostRow(row: ResultCostRow, ctx: ResultDrillContext): DrillRow {
  const cost = costRow(row, ctx, { group: 'costs', mark: 'pill' });
  return { ...cost, cells: { what: cost.cells['what'], date: row.date, revenue: null, result: -row.amountEur } };
}

/**
 * A month of Marge en kosten per maand and Per maand: its documents (the margin), its TICA row and its cost parts
 * (minus), oldest first. The figure is the month's result; with a cost missing the rows stand without a total.
 */
export function monthView(month: string, label: string, docs: readonly SalesDocumentRow[], tica: readonly ResultTicaMonth[], costs: readonly ResultCostRow[],
  figure: ResultRowFigure, ctx: ResultDrillContext): DrillView {
  return {
    id: `result.month.${month}`, title: label, scope: `${ctx.period} · ${FLOW_BASIS}`,
    summary: figure.complete ? null : INCOMPLETE,
    rows: [
      ...docs.filter((doc) => resultDocument(doc) && doc.orderDate.startsWith(month)).map(documentRow),
      ...tica.filter((row) => row.month === month).map((row) => ticaRow(row, false)),
      ...costs.filter((row) => row.amountEur !== 0).map((row) => flowCostRow(row, ctx)),
    ],
    groups: FLOW_GROUPS, columns: FLOW_COLUMNS, valueKey: 'result',
    total: figure.complete ? { value: figure.resultEur, format: 'eurSigned', of: 'sum', label: 'Resultaat' } : null,
    gapLabel: 'Creditnota’s', sort: { key: 'date', dir: 'asc' }, empty: 'Niets in deze maand.',
  };
}

/** One row of Per verkoopkanaal: its documents, its TICA months (the TICA channel) and the costs booked on it. */
export function channelView(code: string, docs: readonly SalesDocumentRow[], tica: readonly ResultTicaMonth[], costs: readonly ResultCostRow[],
  figure: ResultRowFigure, ctx: ResultDrillContext): DrillView {
  return {
    id: `result.channel.${code}`, title: ctx.channelName(code), scope: `${ctx.period} · ${FLOW_BASIS}`,
    summary: figure.complete ? null : INCOMPLETE,
    rows: [
      ...docs.filter((doc) => resultDocument(doc) && doc.channel === code).map(documentRow),
      ...(code === 'TICA' ? tica.map((row) => ticaRow(row, true)) : []),
      ...costs.filter((row) => row.channel === code && row.amountEur !== 0).map((row) => flowCostRow(row, ctx)),
    ],
    groups: FLOW_GROUPS, columns: FLOW_COLUMNS, valueKey: 'result',
    total: figure.complete ? { value: figure.resultEur, format: 'eurSigned', of: 'sum', label: 'Resultaat' } : null,
    gapLabel: 'Creditnota’s', sort: { key: 'date', dir: 'desc' }, empty: 'Niets op dit kanaal in deze periode.',
    foot: { label: 'Kosten van dit kanaal ›', link: { path: ['/costs'], query: { ...ctx.costsQuery, channel: code } } },
  };
}

/** Algemene kosten: the cost parts booked on no channel, as minus, so the channel rows add up to Resultaat (D-O5). */
export function generalCostsView(costs: readonly ResultCostRow[], figure: number, ctx: ResultDrillContext): DrillView {
  return {
    id: 'result.channel.none', title: 'Algemene kosten', scope: `${ctx.period} · ${COST_BASIS}`,
    rows: costs.filter((row) => row.channel === null && row.amountEur !== 0).map((row) => costRow(row, ctx, { mark: 'text', sign: -1 })),
    columns: [COL.date, COL.what, COL.party, COL.open, { ...COL.amount, format: 'eurSigned' }], valueKey: 'amount',
    total: { value: -figure, format: 'eurSigned', of: 'sum' }, sort: { key: 'amount', dir: 'asc' },
    empty: 'Geen kosten zonder verkoopkanaal.', foot: { label: 'Alle kosten ›', link: { path: ['/costs'], query: ctx.costsQuery } },
  };
}
