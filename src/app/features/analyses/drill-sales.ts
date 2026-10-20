import type { TicaAnalyticsDay } from '../../core/api/tica-api';
import type { MissingCostRow, SalesDocumentRow, SalesLineRow } from './analysis-metrics';
import type { DrillColumn, DrillGroup, DrillLink, DrillRow, DrillView } from './drill-model';
import type { TicaProductRow } from './tica-breakdown';

/*
 * The drill-downs of Verkoop and of the Overzicht rows that read sales (design/analyses2/design.md §B.1–B.3): rows
 * from salesDocumentRows, salesLineRows and missingCostRows (analysis-metrics.ts), TICA one row per month. Each view
 * takes its figure from the value the tile shows (rule A.4); the dialog adds the rows up and names any gap.
 *
 * Pure and node-tested (tests/analyses-drill-sales.test.mts): type imports only; the names the page knows (channels,
 * sales units) come in as functions.
 */

export interface SalesDrillContext {
  /** "Dit jaar · 1 jan – 20 okt 2026": the page's period and its range. */
  period: string;
  /** "Rechtstreeks", "Website", "TICA" (sales-channels.ts). */
  channelName: (code: string) => string;
}

/** One TICA month of a period: the TICA screen's own rows, summed per month (no lines). */
export interface TicaMonthRow {
  month: string;
  /** The month clipped to the period: the window of its /tica link. */
  from: string;
  to: string;
  transactions: number;
  revenueExclEur: number;
  goodsCostEur: number;
  missingCostLines: number;
  /** Revenue minus the current product cost; null while a line has no cost. */
  marginEur: number | null;
}

const MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'] as const;
const money = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;
const STATUS_WORDS: Record<string, string> = {
  CONCEPT: 'Concept', VERZONDEN: 'Verzonden', UITGEREIKT: 'Uitgereikt', BEKEKEN: 'Bekeken', WIJZIGING_GEVRAAGD: 'Wijziging gevraagd',
  GEACCEPTEERD: 'Geaccepteerd', AFGEWEZEN: 'Afgewezen', VERLOPEN: 'Verlopen', GEANNULEERD: 'Geannuleerd', BETAALD: 'Betaald',
};
const SALES_LIST: DrillLink = { path: ['/sales'], query: { scope: 'ALL', tab: 'FACTUUR' } };
const OPEN_INVOICES: DrillLink = { path: ['/sales'], query: { scope: 'ALL', tab: 'FACTUUR', payment: 'open' } };

function lastDayOf(month: string): string {
  const [year, index] = month.split('-').map(Number);
  return `${month}-${String(new Date(Date.UTC(year, index, 0)).getUTCDate()).padStart(2, '0')}`;
}

/**
 * The period's TICA days per month, oldest first (the days withTicaSales adds to Omzet and Brutomarge): revenue,
 * cost, the lines without a cost and the month's window clipped to the period.
 */
export function ticaMonthRows(days: readonly TicaAnalyticsDay[], from: string | null, to: string | null): TicaMonthRow[] {
  const months = new Map<string, TicaMonthRow>();
  for (const day of days) {
    if ((from && day.date < from) || (to && day.date > to)) continue;
    const month = day.date.slice(0, 7);
    const row = months.get(month) ?? { month, from: from && from > `${month}-01` ? from : `${month}-01`, to: to && to < lastDayOf(month) ? to : lastDayOf(month),
      transactions: 0, revenueExclEur: 0, goodsCostEur: 0, missingCostLines: 0, marginEur: null };
    row.transactions += day.transactionCount;
    row.revenueExclEur = money(row.revenueExclEur + day.revenueExcl);
    row.goodsCostEur = money(row.goodsCostEur + day.goodsCostEur);
    row.missingCostLines += day.missingCostLines;
    months.set(month, row);
  }
  return [...months.values()]
    .map((row) => ({ ...row, marginEur: row.missingCostLines ? null : money(row.revenueExclEur - row.goodsCostEur) }))
    .sort((left, right) => left.month.localeCompare(right.month));
}

/* ---------- columns (B.1) */

const COL = {
  doc: { key: 'doc', label: 'Document', format: 'text', phone: 'title' },
  customer: { key: 'customer', label: 'Klant', format: 'text', phone: 'sub' },
  date: { key: 'date', label: 'Datum', format: 'day', phone: 'sub' },
  channel: { key: 'channel', label: 'Kanaal', format: 'text', phone: 'none' },
  revenue: { key: 'revenue', label: 'Omzet excl.', format: 'eur', phone: 'value' },
  margin: { key: 'margin', label: 'Marge', format: 'eur', phone: 'value' },
  claim: { key: 'claim', label: 'Gefactureerd incl.', format: 'eur', phone: 'value' },
  outstanding: { key: 'outstanding', label: 'Open incl.', format: 'eur', phone: 'value' },
  status: { key: 'status', label: 'Status', format: 'text', phone: 'sub' },
  due: { key: 'due', label: 'Vervaldatum', format: 'day', phone: 'sub' },
  late: { key: 'late', label: 'Te laat', format: 'days', phone: 'none' },
  value: { key: 'value', label: 'Waarde excl.', format: 'eur', phone: 'value' },
} as const satisfies Record<string, DrillColumn>;

/** A column in a supporting role: off the phone cell, optionally summed. */
function aside(column: DrillColumn, sum = false): DrillColumn {
  return { ...column, phone: 'none', ...(sum ? { sum: true } : {}) };
}

/** "Creditnota", "Voorschot", "Slotfactuur": the one word after a document number. */
export function documentPill(doc: SalesDocumentRow): string | null {
  if (doc.kind === 'CREDITNOTA') return 'Creditnota';
  if (doc.advance || doc.advanceStage === 'ADVANCE') return 'Voorschot';
  if (doc.settlement || doc.advanceStage === 'FINAL') return 'Slotfactuur';
  return null;
}

function documentRow(doc: SalesDocumentRow, channelName: (code: string) => string = (code) => code, group?: string): DrillRow {
  return {
    key: `d${doc.id}`,
    cells: {
      doc: doc.number, customer: doc.customerName, date: doc.orderDate, channel: channelName(doc.channel),
      revenue: doc.revenueExclEur, margin: doc.marginEur, claim: doc.claimInclEur, outstanding: doc.outstandingEur,
      status: STATUS_WORDS[doc.status] ?? doc.status, due: doc.dueDate, late: doc.overdueDays,
    },
    pill: documentPill(doc),
    group: group ?? null,
    link: { path: ['/sales', doc.id] },
  };
}

function ticaRow(row: TicaMonthRow, to: string | null): DrillRow {
  const year = (to ?? row.to).slice(0, 4);
  const month = `${MONTHS[Number(row.month.slice(5, 7)) - 1]}${row.month.slice(0, 4) === year ? '' : ` ${row.month.slice(0, 4)}`}`;
  return {
    key: `t${row.month}`,
    cells: {
      doc: `TICA · ${month}`, customer: `${row.transactions} ${row.transactions === 1 ? 'verkoop' : 'verkopen'}`, date: row.to, channel: 'TICA',
      revenue: row.revenueExclEur, margin: row.marginEur,
    },
    pill: 'TICA',
    group: 'tica',
    link: { path: ['/tica'], query: { from: row.from, to: row.to } },
  };
}

/** The revenue documents of a period: issued invoices and credit notes that move the omzet (a voorschot does not). */
export function revenueDocuments(docs: readonly SalesDocumentRow[]): SalesDocumentRow[] {
  return docs.filter((doc) => doc.kind !== 'OFFERTE' && doc.revenueExclEur !== 0);
}

const DOC_GROUPS: readonly DrillGroup[] = [{ key: 'docs', label: 'Facturen' }, { key: 'tica', label: 'TICA' }];

/** Documents plus TICA months, grouped Facturen / TICA only when TICA sold in the period. */
function documentsWithTica(docs: readonly SalesDocumentRow[], tica: readonly TicaMonthRow[], ctx: SalesDrillContext, to: string | null): { rows: DrillRow[]; groups?: readonly DrillGroup[] } {
  const grouped = tica.length > 0;
  return {
    rows: [...docs.map((doc) => documentRow(doc, ctx.channelName, grouped ? 'docs' : undefined)), ...tica.map((row) => ticaRow(row, to))],
    ...(grouped ? { groups: DOC_GROUPS } : {}),
  };
}

/** Per customer: the documents' sums (revenue and the margin they show), TICA as one row. */
function perCustomer(docs: readonly SalesDocumentRow[], tica: readonly TicaMonthRow[]): DrillRow[] {
  const rows = new Map<string, { name: string; docs: number; revenue: number; margin: number }>();
  for (const doc of docs) {
    const key = `c${doc.customerId ?? 'none'}`;
    const row = rows.get(key) ?? { name: doc.customerName, docs: 0, revenue: 0, margin: 0 };
    row.docs += 1;
    row.revenue = money(row.revenue + doc.revenueExclEur);
    /* A credit note shows no margin: its effect is the view's gap row. */
    row.margin = money(row.margin + (doc.marginEur ?? 0));
    rows.set(key, row);
  }
  const result: DrillRow[] = [...rows].map(([key, row]) => ({ key, cells: { customer: row.name, docs: row.docs, revenue: row.revenue, margin: row.margin } }));
  if (tica.length) {
    const transactions = tica.reduce((sum, row) => sum + row.transactions, 0);
    const known = tica.every((row) => row.marginEur !== null);
    result.push({ key: 'tica', pill: 'TICA', cells: {
      customer: `TICA · ${transactions} ${transactions === 1 ? 'verkoop' : 'verkopen'}`, docs: null,
      revenue: money(tica.reduce((sum, row) => sum + row.revenueExclEur, 0)),
      margin: known ? money(tica.reduce((sum, row) => sum + (row.marginEur ?? 0), 0)) : null,
    } });
  }
  return result;
}

/** Omzet (Verkoop and Resultaat): per document with the TICA months, and per customer. */
export function revenueViews(docs: readonly SalesDocumentRow[], tica: readonly TicaMonthRow[], figure: number, ctx: SalesDrillContext, to: string | null): DrillView[] {
  const revenue = revenueDocuments(docs);
  const scope = `${ctx.period} · excl. btw`;
  const total = { value: figure, format: 'eur', of: 'sum' } as const;
  const foot = { label: 'Verkooporders ›', link: SALES_LIST };
  return [
    { id: 'sales.revenue', tab: 'Per document', title: 'Omzet', scope, ...documentsWithTica(revenue, tica, ctx, to),
      columns: [COL.doc, COL.customer, COL.date, COL.channel, COL.revenue], valueKey: 'revenue', total,
      sort: { key: 'date', dir: 'desc' }, empty: 'Geen omzet in deze periode.', foot },
    { id: 'sales.revenue.customer', tab: 'Per klant', title: 'Omzet', scope, rows: perCustomer(revenue, tica),
      columns: [{ ...COL.customer, phone: 'title' }, { key: 'docs', label: 'Documenten', format: 'int', phone: 'sub' }, COL.revenue],
      valueKey: 'revenue', total, sort: { key: 'revenue', dir: 'desc' }, empty: 'Geen omzet in deze periode.', foot },
  ];
}

/** Why the margin rows miss the figure: credit notes show none, TICA months without a cost neither. */
function marginGap(docs: readonly SalesDocumentRow[], tica: readonly TicaMonthRow[]): string {
  const credit = docs.some((doc) => doc.kind === 'CREDITNOTA');
  const ticaUnknown = tica.some((row) => row.marginEur === null);
  return credit && ticaUnknown ? 'Creditnota’s en TICA zonder kost' : ticaUnknown ? 'TICA zonder kost' : 'Creditnota’s';
}

export interface MarginFigure {
  /** The margin as computed (withTicaSales), also when lines lack a cost. */
  marginEur: number;
  marginPct: number | null;
  missingCostLines: number;
}

/**
 * Brutomarge: with lines without a cost the list to fix comes first ("Zonder kost", then "Per document"); otherwise
 * per document and per customer. A credit note shows no margin: its effect is the gap row.
 */
export function marginViews(docs: readonly SalesDocumentRow[], tica: readonly TicaMonthRow[], missing: readonly MissingCostRow[], figure: MarginFigure,
  ctx: SalesDrillContext, to: string | null, ticaWindow: { from: string; to: string } | null): DrillView[] {
  const revenue = revenueDocuments(docs);
  const scope = `${ctx.period} · excl. btw`;
  const total = { value: figure.marginEur, format: 'eur', of: 'sum' } as const;
  const pct = figure.marginPct === null ? null : `${figure.marginPct.toLocaleString('nl-BE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} % op goederen`;
  const summary = figure.missingCostLines
    ? `Onvolledig: ${figure.missingCostLines} ${figure.missingCostLines === 1 ? 'regel' : 'regels'} zonder kost` : pct;
  const gapLabel = marginGap(revenue, tica);
  const perDocument: DrillView = {
    id: 'sales.margin', tab: 'Per document', title: 'Brutomarge', scope, summary, ...documentsWithTica(revenue, tica, ctx, to),
    columns: [COL.doc, COL.customer, COL.date, aside(COL.revenue, true), COL.margin], valueKey: 'margin', total, gapLabel,
    sort: { key: 'margin', dir: 'desc' }, empty: 'Geen omzet in deze periode.',
  };
  if (!figure.missingCostLines) {
    return [perDocument, { id: 'sales.margin.customer', tab: 'Per klant', title: 'Brutomarge', scope, summary, rows: perCustomer(revenue, tica),
      columns: [{ ...COL.customer, phone: 'title' }, { key: 'docs', label: 'Documenten', format: 'int', phone: 'sub' }, aside(COL.revenue, true), COL.margin],
      valueKey: 'margin', total, gapLabel, sort: { key: 'margin', dir: 'desc' }, empty: 'Geen omzet in deze periode.' }];
  }
  return [missingCostView(missing, tica, figure.missingCostLines, ctx, ticaWindow), perDocument];
}

/** Brutomarge › Zonder kost: per product the lines priced without a cost, TICA as one row. */
export function missingCostView(missing: readonly MissingCostRow[], tica: readonly TicaMonthRow[], figure: number, ctx: SalesDrillContext,
  ticaWindow: { from: string; to: string } | null): DrillView {
  const ticaLines = tica.reduce((sum, row) => sum + row.missingCostLines, 0);
  const rows: DrillRow[] = missing.map((row) => ({
    key: row.key, cells: { product: row.name, sku: row.sku, docs: row.documents, lines: row.lines },
    link: row.productId !== null ? { path: ['/products', row.productId] } : null,
  }));
  if (ticaLines > 0) {
    rows.push({ key: 'tica', pill: 'TICA', cells: { product: `TICA · ${ticaLines} ${ticaLines === 1 ? 'regel' : 'regels'}`, sku: null, docs: null, lines: ticaLines },
      link: ticaWindow ? { path: ['/tica'], query: { from: ticaWindow.from, to: ticaWindow.to } } : null });
  }
  return {
    id: 'sales.missingCost', tab: 'Zonder kost', title: 'Brutomarge', scope: `${ctx.period} · facturen en TICA`, rows,
    columns: [{ key: 'product', label: 'Product', format: 'text', phone: 'title' }, { key: 'sku', label: 'SKU', format: 'text', phone: 'sub' },
      { key: 'docs', label: 'Documenten', format: 'int', phone: 'sub' }, { key: 'lines', label: 'Regels', format: 'int', phone: 'value' }],
    valueKey: 'lines', total: { value: figure, format: 'int', of: 'sum', label: 'Regels zonder kost' },
    sort: { key: 'lines', dir: 'desc' }, empty: 'Elke verkoopregel heeft een kost.', note: 'Vul de kostprijs in op het product.',
  };
}

/** Gefactureerd: every issued invoice (voorschot included, with its container) and credit note, incl. btw. */
export function invoicedView(docs: readonly SalesDocumentRow[], figure: number, averageRegularEur: number | null, ctx: SalesDrillContext, average: (value: number) => string): DrillView {
  const rows = docs.filter((doc) => doc.kind !== 'OFFERTE').map((doc) => {
    const row = documentRow(doc, ctx.channelName);
    return doc.advance && doc.partnerContainerName ? { ...row, cells: { ...row.cells, customer: `${doc.customerName} · ${doc.partnerContainerName}` } } : row;
  });
  return {
    id: 'sales.invoiced', title: 'Gefactureerd', scope: `${ctx.period} · incl. btw`, rows,
    summary: averageRegularEur === null ? null : `gem. ${average(averageRegularEur)} per gewone factuur`,
    columns: [COL.doc, COL.customer, COL.date, aside(COL.outstanding, true), COL.claim], valueKey: 'claim',
    total: { value: figure, format: 'eur', of: 'sum' }, sort: { key: 'date', dir: 'desc' }, empty: 'Geen facturen in deze periode.',
    foot: { label: 'Verkooporders ›', link: SALES_LIST },
  };
}

/** Open offertes (Verkoop and Overzicht): the open regular quotes of every year, today's value. */
export function openQuotesView(quotes: readonly SalesDocumentRow[], figure: number, summary: string | null): DrillView {
  return {
    id: 'sales.openQuotes', title: 'Open offertes', scope: 'Vandaag · alle jaren · excl. btw', summary,
    rows: quotes.map((doc) => ({
      key: `d${doc.id}`, link: { path: ['/sales', doc.id] },
      cells: { doc: doc.number, customer: doc.customerName, date: doc.orderDate, status: STATUS_WORDS[doc.status] ?? doc.status,
        validUntil: doc.validUntil, margin: doc.quoteMarginEur, value: doc.quoteValueExclEur },
    })),
    columns: [COL.doc, COL.customer, COL.date, COL.status, { key: 'validUntil', label: 'Geldig tot', format: 'day', phone: 'none' }, aside(COL.margin), COL.value],
    valueKey: 'value', total: { value: figure, format: 'eur', of: 'sum' }, sort: { key: 'value', dir: 'desc' },
    empty: 'Geen open offertes.', foot: { label: 'Alle offertes ›', link: { path: ['/sales'], query: { scope: 'STANDARD', tab: 'OFFERTE' } } },
  };
}

/** The regular quotes of the period (the funnel's set: partner funding is container financing). */
export function regularQuotes(docs: readonly SalesDocumentRow[]): SalesDocumentRow[] {
  return docs.filter((doc) => doc.kind === 'OFFERTE' && !doc.partnerFunding);
}

/** Geaccepteerd: the period's accepted regular quotes and the invoice made from each. */
export function acceptedView(docs: readonly SalesDocumentRow[], figure: number, ctx: SalesDrillContext): DrillView {
  return {
    id: 'sales.accepted', title: 'Geaccepteerd', scope: `${ctx.period} · excl. btw`,
    rows: regularQuotes(docs).filter((doc) => doc.status === 'GEACCEPTEERD').map((doc) => ({
      key: `d${doc.id}`, link: { path: ['/sales', doc.id] },
      cells: { doc: doc.number, customer: doc.customerName, decided: doc.decidedAt, invoice: doc.invoicedAs ?? 'nog geen factuur', value: doc.quoteValueExclEur },
    })),
    columns: [COL.doc, COL.customer, { key: 'decided', label: 'Beslist', format: 'day', phone: 'sub' }, { key: 'invoice', label: 'Factuur', format: 'text', phone: 'sub' }, COL.value],
    valueKey: 'value', total: { value: figure, format: 'eur', of: 'sum' }, sort: { key: 'decided', dir: 'desc' },
    empty: 'Geen geaccepteerde offertes in deze periode.',
  };
}

export type FunnelStep = 'created' | 'sent' | 'viewed' | 'rejected' | 'expired' | 'cancelled';
const FUNNEL: Record<FunnelStep, { title: string; keep: (doc: SalesDocumentRow) => boolean }> = {
  created: { title: 'Aangemaakt', keep: () => true },
  sent: { title: 'Verzonden', keep: (doc) => doc.sent },
  viewed: { title: 'Bekeken door de klant', keep: (doc) => doc.viewed },
  rejected: { title: 'Afgewezen', keep: (doc) => doc.status === 'AFGEWEZEN' },
  expired: { title: 'Verlopen', keep: (doc) => doc.status === 'VERLOPEN' },
  cancelled: { title: 'Geannuleerd', keep: (doc) => doc.status === 'GEANNULEERD' },
};

/** A funnel step: the period's regular quotes that reached it (the salesAnalysis rules); the figure is the step count. */
export function funnelView(step: FunnelStep, docs: readonly SalesDocumentRow[], count: number, ctx: SalesDrillContext): DrillView {
  return {
    id: `sales.funnel.${step}`, title: `Offertes · ${FUNNEL[step].title.toLocaleLowerCase('nl')}`, scope: `${ctx.period} · excl. btw`,
    rows: regularQuotes(docs).filter(FUNNEL[step].keep).map((doc) => ({
      key: `d${doc.id}`, link: { path: ['/sales', doc.id] },
      cells: { doc: doc.number, customer: doc.customerName, date: doc.orderDate, status: STATUS_WORDS[doc.status] ?? doc.status, views: doc.viewCount, value: doc.quoteValueExclEur },
    })),
    columns: [COL.doc, COL.customer, COL.date, COL.status, { key: 'views', label: 'Bekeken', format: 'int', phone: 'none' }, { ...COL.value, sum: true }],
    valueKey: null, total: { value: count, format: 'int', of: 'rows', label: 'Offertes' }, sort: { key: 'date', dir: 'desc' },
    empty: 'Geen offertes in deze stap.',
  };
}

/** Open facturen: every issued invoice with something open, all years, overdue first. */
export function openInvoicesView(docs: readonly SalesDocumentRow[], figure: number): DrillView {
  return {
    id: 'sales.openInvoices', title: 'Open facturen', scope: 'Vandaag · alle jaren · incl. btw',
    rows: docs.filter((doc) => doc.kind === 'FACTUUR' && doc.outstandingEur > 0)
      .map((doc) => ({ ...documentRow(doc), group: doc.overdueDays !== null ? 'overdue' : 'open',
        tone: doc.overdueDays !== null ? 'danger' as const : null })),
    groups: [{ key: 'overdue', label: 'Vervallen' }, { key: 'open', label: 'Nog niet vervallen' }],
    columns: [COL.doc, COL.customer, COL.due, COL.late, COL.outstanding], valueKey: 'outstanding',
    total: { value: figure, format: 'eur', of: 'sum' }, sort: { key: 'due', dir: 'asc' }, empty: 'Geen open facturen.',
    foot: { label: 'Alle open facturen ›', link: OPEN_INVOICES },
  };
}

/** Vervallen (Verkoop and Overzicht): the invoices past their due day with something open, all years. */
export function overdueView(docs: readonly SalesDocumentRow[], figure: number): DrillView {
  return {
    id: 'sales.overdue', title: 'Vervallen facturen', scope: 'Vandaag · alle jaren · incl. btw',
    rows: docs.filter((doc) => doc.overdueDays !== null).map((doc) => ({ ...documentRow(doc), tone: 'danger' as const })),
    columns: [COL.doc, COL.customer, COL.due, COL.late, COL.outstanding], valueKey: 'outstanding',
    total: { value: figure, format: 'eur', of: 'sum' }, sort: { key: 'due', dir: 'asc' }, empty: 'Geen vervallen facturen.',
    foot: { label: 'Alle open facturen ›', link: OPEN_INVOICES },
  };
}

/** One row of Omzet per kanaal (not TICA): its revenue documents. */
export function channelView(code: string, docs: readonly SalesDocumentRow[], figure: number, ctx: SalesDrillContext): DrillView {
  return {
    id: `sales.channel.${code}`, title: `Omzet · ${ctx.channelName(code)}`, scope: `${ctx.period} · excl. btw`,
    rows: revenueDocuments(docs).filter((doc) => doc.channel === code).map((doc) => documentRow(doc, ctx.channelName)),
    columns: [COL.doc, COL.customer, COL.date, COL.channel, COL.revenue], valueKey: 'revenue',
    total: { value: figure, format: 'eur', of: 'sum' }, sort: { key: 'date', dir: 'desc' }, empty: 'Geen omzet op dit kanaal.',
    foot: { label: 'Verkooporders ›', link: SALES_LIST },
  };
}

/** One row of Landen: the country's revenue documents, grouped per customer (most revenue first). */
export function countryView(code: string | null, name: string, docs: readonly SalesDocumentRow[], figure: number, ctx: SalesDrillContext): DrillView {
  const rows = revenueDocuments(docs).filter((doc) => doc.countryCode === code);
  const customers = new Map<string, { label: string; revenue: number }>();
  for (const doc of rows) {
    const key = `c${doc.customerId ?? 'none'}`;
    const current = customers.get(key) ?? { label: doc.customerName, revenue: 0 };
    current.revenue += doc.revenueExclEur;
    customers.set(key, current);
  }
  return {
    id: `sales.country.${code ?? 'none'}`, title: `Omzet · ${name}`, scope: `${ctx.period} · excl. btw`,
    rows: rows.map((doc) => documentRow(doc, ctx.channelName, `c${doc.customerId ?? 'none'}`)),
    groups: [...customers].sort(([, left], [, right]) => right.revenue - left.revenue).map(([key, row]) => ({ key, label: row.label })),
    columns: [COL.doc, COL.date, aside(COL.margin), COL.revenue], valueKey: 'revenue',
    total: { value: figure, format: 'eur', of: 'sum' }, sort: { key: 'revenue', dir: 'desc' }, empty: 'Geen omzet uit dit land.',
  };
}

/** One row of Klanten: the customer's issued documents of the period; margin and open money in the summary. */
export function customerView(customerId: number | null, name: string, docs: readonly SalesDocumentRow[], figure: number, ctx: SalesDrillContext,
  amount: (value: number) => string): DrillView {
  const rows = docs.filter((doc) => doc.kind !== 'OFFERTE' && doc.customerId === customerId);
  /* The margin of the same rows, credit notes and voorschotten out (they show none). */
  const withMargin = rows.filter((doc) => doc.marginEur !== null);
  const marginRevenue = withMargin.reduce((sum, doc) => sum + doc.revenueExclEur, 0);
  const margin = withMargin.reduce((sum, doc) => sum + (doc.marginEur ?? 0), 0);
  const open = rows.reduce((sum, doc) => sum + doc.outstandingEur, 0);
  const pct = marginRevenue > 0 ? `marge ${(margin / marginRevenue * 100).toLocaleString('nl-BE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %` : null;
  return {
    id: `sales.customer.${customerId ?? 'none'}`, title: name, scope: `${ctx.period} · excl. btw`,
    summary: [pct, `open ${amount(open)}`].filter(Boolean).join(' · '),
    rows: rows.map((doc) => documentRow(doc, ctx.channelName)),
    columns: [COL.doc, { ...COL.date, phone: 'sub' }, { ...COL.channel, phone: 'sub' }, aside(COL.outstanding, true), COL.revenue], valueKey: 'revenue',
    total: { value: figure, format: 'eur', of: 'sum' }, sort: { key: 'date', dir: 'desc' }, empty: 'Geen documenten in deze periode.',
    foot: customerId === null ? null : { label: 'Klant openen ›', link: { path: ['/customers'], query: { q: name } } },
  };
}

/** One row of Producten: the product's invoice and credit-note lines; TICA sells it on its own card. */
export function productView(productId: number, name: string, lines: readonly SalesLineRow[], docs: readonly SalesDocumentRow[], figure: number,
  ctx: SalesDrillContext, unitText: (productId: number, count: number) => string): DrillView {
  const customers = new Map(docs.map((doc) => [doc.id, doc.customerName]));
  return {
    id: `sales.product.${productId}`, title: name, scope: `${ctx.period} · goederen excl. btw`,
    rows: lines.map((line) => ({
      key: line.key, pill: line.kind === 'CREDITNOTA' ? 'Creditnota' : null, link: { path: ['/sales', line.documentId] },
      cells: { doc: line.number, customer: customers.get(line.documentId) ?? '—', date: line.orderDate, qty: unitText(productId, line.quantity), goods: line.goodsEur },
    })),
    columns: [COL.doc, COL.customer, COL.date, { key: 'qty', label: 'Aantal', format: 'text', phone: 'sub' }, { key: 'goods', label: 'Goederen excl.', format: 'eur', phone: 'value' }],
    valueKey: 'goods', total: { value: figure, format: 'eur', of: 'sum' }, sort: { key: 'date', dir: 'desc' },
    empty: 'Geen factuurregels in deze periode.', note: 'TICA-verkopen staan op de TICA-kaart.',
    foot: { label: 'Product openen ›', link: { path: ['/products', productId] } },
  };
}

/** TICA › Niet herkend: the articles without an ERP product (no stock, no margin until they are mapped). */
export function ticaUnmatchedView(products: readonly TicaProductRow[], unmatchedLines: number, window: { from: string; to: string }, range: string): DrillView {
  return {
    id: 'sales.ticaUnmatched', title: 'TICA · niet herkend', scope: `${range} · na korting excl. btw`,
    summary: `${unmatchedLines} ${unmatchedLines === 1 ? 'regel' : 'regels'} zonder ERP-product`,
    rows: products.filter((product) => product.productId === null).map((product) => ({
      key: product.key, cells: { name: product.code ? `${product.name} · ${product.code}` : product.name, pieces: product.pieces, net: product.netEur },
    })),
    columns: [{ key: 'name', label: 'Artikel', format: 'text', phone: 'title' }, { key: 'pieces', label: 'Stuks', format: 'int', phone: 'sub' },
      { key: 'net', label: 'Omzet', format: 'eur', phone: 'value' }],
    valueKey: 'net', total: null, sort: { key: 'net', dir: 'desc' }, empty: 'Elk TICA-artikel is herkend.',
    foot: { label: 'TICA verkopen ›', link: { path: ['/tica'], query: { from: window.from, to: window.to } } },
  };
}
