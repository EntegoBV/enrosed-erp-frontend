import type {
  CashForecast, ForecastCertainty, ForecastItem, ForecastKind, ForecastMonth, ForecastRule, Iso, ScenarioSource,
} from '../finance/cash-forecast';
import type { CashLink, MonthLine, RuleSwitch } from './cash-view';
import type { DrillColumn, DrillGroup, DrillLink, DrillRow, DrillView } from './drill-model';

/*
 * The drill-downs of Analyses › Kasprognose (design/analyses2/design.md §B.8):
 * every list reads CashState.forecast(), so its rows add up to the figure
 * that was clicked (rule A.4). Type-only imports: what needs cash-format,
 * cash-view or the state comes in through CashDrillContext.
 */

/** The runtime helpers this module may not import. */
export interface CashDrillContext {
  /** dayMon (cash-format): '3 jan'. */
  day: (day: Iso) => string;
  /** eurWhole (cash-format): '€ 7.450', for a summary. */
  whole: (eur: number) => string;
  /** itemLink and lineLink (cash-view). */
  itemLink: (item: ForecastItem) => CashLink | null;
  lineLink: (lineId: number) => CashLink;
  /** A container sale opens the container's sheet (CashState.openPo; the phone closes its own sheet first). */
  openPo: (orderId: number) => void;
}

/* Local copies (this module imports types only). */
const CERTAINTY: Record<ForecastCertainty, string> = { FIXED: 'Vast', EXPECTED: 'Verwacht', ESTIMATED: 'Geschat', SCENARIO: 'Scenario' };
const COMMITTED_GROUPS: readonly DrillGroup[] = [
  { key: 'today', label: 'Vandaag' }, { key: 'containers', label: 'Containers' }, { key: 'costs', label: 'Kosten' }, { key: 'vat', label: 'Btw' },
  { key: 'customers', label: 'Klanten' }, { key: 'partners', label: 'Partners' }, { key: 'tica', label: 'TICA' }, { key: 'other', label: 'Overig' },
];
const GROUP_OF: Partial<Record<ForecastKind, string>> = {
  SUPPLIER: 'containers', LOGISTICS: 'containers', INSPECTION: 'containers', OTHER_CONTAINER: 'containers',
  COST: 'costs', RECURRING: 'costs', VAT: 'vat', IMPORT_VAT: 'vat', CUSTOMER: 'customers', QUOTE: 'customers', OPEN_QUOTE: 'customers',
  CREDIT: 'customers', PARTNER: 'partners', TICA: 'tica',
};
const cents = (value: number | null | undefined): number => Math.round((typeof value === 'number' && Number.isFinite(value) ? value : 0) * 100);
const euros = (value: number): number => (value === 0 ? 0 : value / 100);
const pctText = (value: number): string => String(Math.round(value * 10) / 10).replace('.', ',');

/** A forecast link as a drill link: a container's sales open its sheet on the screen. */
export function drillLinkOf(link: CashLink | null, ctx: Pick<CashDrillContext, 'openPo'>): DrillLink | null {
  if (!link) return null;
  if (link.po !== null) { const po = link.po; return { run: () => ctx.openPo(po) }; }
  return link.path.length ? { path: link.path, query: link.query } : null;
}

const itemDrillLink = (item: ForecastItem | null, ctx: CashDrillContext): DrillLink | null => (item ? drillLinkOf(ctx.itemLink(item), ctx) : null);

/** The start row of the balance lists: the bank today (0 in relative mode, the figures are differences then). */
function todayRow(forecast: CashForecast, group: string | null, extra: Record<string, string | number | null> = {}): DrillRow {
  return { key: 'today', group, link: null,
    cells: { date: forecast.today, title: forecast.mode === 'relative' ? 'Vandaag · saldo ontbreekt' : 'Vandaag op de bank', amount: forecast.startEur, ...extra } };
}

/* ------------------------------------------------------------ Wat telt mee */

/** "Wat telt mee" › a rule's amount: the items it adds up, also while the rule is off (`cash.rule.{rule}`). */
export function cashRuleView(forecast: CashForecast, rule: RuleSwitch, ctx: CashDrillContext): DrillView {
  const key: ForecastRule = rule.rule;
  const end = ctx.day(forecast.horizonEnd);
  const columns: DrillColumn[] = [
    { key: 'date', label: 'Datum', format: 'day', phone: 'sub', width: '84px' },
    { key: 'title', label: 'Omschrijving', format: 'text', phone: 'title' },
    { key: 'party', label: 'Partij', format: 'text', phone: 'sub' },
    { key: 'certainty', label: 'Zekerheid', format: 'text', phone: 'none', width: '96px' },
    { key: 'amount', label: 'Bedrag', format: 'eurSigned', phone: 'value' },
  ];
  const rows = forecast.ruleItems[key].map((item): DrillRow => ({
    key: item.key, pill: item.overdue ? 'Vervallen' : null, link: itemDrillLink(item, ctx),
    cells: { date: item.date, title: item.title, party: item.party && item.party !== item.title ? item.party : null, certainty: CERTAINTY[item.certainty], amount: item.amountEur },
  }));
  return {
    id: `cash.rule.${key}`, title: rule.label, scope: `Tot ${end} · incl. btw`,
    summary: rule.on ? null : 'Staat uit: telt niet mee',
    note: rule.sub ? `${rule.sub.charAt(0).toUpperCase()}${rule.sub.slice(1)}.` : null,
    columns, rows, valueKey: 'amount', total: { value: forecast.ruleTotals[key], format: 'eurSigned', of: 'sum' },
    sort: { key: 'date', dir: 'asc' }, empty: `Niets in deze regel tot ${end}.`,
  };
}

/* ------------------------------------------------------------ the figures */

/** "Laagste stand": the bank today and every movement up to the lowest day, the running saldo beside them (`cash.lowest`). */
export function cashLowestView(forecast: CashForecast, ctx: CashDrillContext): DrillView {
  const lowest = forecast.lowestWith;
  const rows: DrillRow[] = [todayRow(forecast, null, { kind: 'Bank', balance: forecast.startEur })];
  for (const row of forecast.register) {
    if (row.kind !== 'future' || row.date > lowest.day) continue;
    rows.push({ key: row.key, pill: row.layer === 'SCENARIO' ? 'Scenario' : null, link: itemDrillLink(row.item, ctx),
      cells: { date: row.date, title: row.title, kind: row.kindLabel, balance: row.balanceEur, amount: row.amountEur } });
  }
  return {
    id: 'cash.lowest', title: 'Laagste stand', scope: `Vandaag tot ${ctx.day(lowest.day)} · met scenario · incl. btw`,
    summary: `${ctx.whole(lowest.eur)} op ${ctx.day(lowest.day)}`,
    columns: [
      { key: 'date', label: 'Datum', format: 'day', phone: 'sub', width: '84px' },
      { key: 'title', label: 'Omschrijving', format: 'text', phone: 'title' },
      { key: 'kind', label: 'Soort', format: 'text', phone: 'none', width: '120px' },
      { key: 'balance', label: 'Saldo', format: 'eur', phone: 'none' },
      { key: 'amount', label: 'Bedrag', format: 'eurSigned', phone: 'value' },
    ],
    rows, valueKey: 'amount', total: { value: lowest.eur, format: 'eur', of: 'sum', label: 'Laagste stand' },
    sort: { key: 'date', dir: 'asc' }, empty: 'Geen bewegingen tot die dag.',
  };
}

/** "Zonder verkoop": the bank today and what is fixed up to the horizon, per kind (`cash.committed`). */
export function cashCommittedView(forecast: CashForecast, ctx: CashDrillContext): DrillView {
  const end = ctx.day(forecast.horizonEnd);
  const rows: DrillRow[] = [todayRow(forecast, 'today')];
  for (const item of forecast.items) {
    if (item.layer !== 'BASE') continue;
    rows.push({ key: item.key, group: GROUP_OF[item.kind] ?? 'other', pill: item.overdue ? 'Vervallen' : null, link: itemDrillLink(item, ctx),
      cells: { date: item.date, title: item.title, amount: item.amountEur } });
  }
  const used = new Set(rows.map((row) => row.group));
  const relative = forecast.mode === 'relative';
  const zero = forecast.zeroBase ? `${relative ? 'lager dan vandaag' : 'onder nul'} op ${ctx.day(forecast.zeroBase)}` : relative ? 'niet lager dan vandaag' : 'blijft boven nul';
  return {
    id: 'cash.committed', title: 'Zonder verkoop', scope: `Vandaag tot ${end} · zonder nieuwe verkoop · incl. btw`,
    summary: `${zero.charAt(0).toUpperCase()}${zero.slice(1)}`,
    columns: [
      { key: 'date', label: 'Datum', format: 'day', phone: 'sub', width: '84px' },
      { key: 'title', label: 'Omschrijving', format: 'text', phone: 'title' },
      { key: 'amount', label: 'Bedrag', format: 'eurSigned', phone: 'value' },
    ],
    rows, groups: COMMITTED_GROUPS.filter((group) => used.has(group.key)), valueKey: 'amount',
    total: { value: forecast.endBaseEur, format: 'eur', of: 'sum', label: `Op ${end} zonder verkoop` },
    sort: { key: 'date', dir: 'asc' }, empty: 'Niets vast tot de horizon.',
  };
}

/* ------------------------------------------------------------- scenario */

/** Uitkomst › Verkoop excl. btw / Marge op goederen: the scenario's sales up to the horizon per source (`cash.scenarioSales`). */
export function cashScenarioSalesView(forecast: CashForecast, ctx: CashDrillContext): DrillView {
  const end = ctx.day(forecast.horizonEnd);
  const sums = new Map<number | null, { sales: number; cost: number; cash: number }>();
  for (const item of forecast.items) {
    if (item.kind !== 'SALES') continue;
    const sum = sums.get(item.orderId) ?? { sales: 0, cost: 0, cash: 0 };
    sum.sales += cents(item.amountEur) - cents(item.vatEur);
    sum.cost += cents(item.costEur);
    sum.cash += cents(item.amountEur);
    sums.set(item.orderId, sum);
  }
  const sources = new Map(forecast.scenario.sources.map((source) => [source.id, source]));
  const rows = [...sums].map(([orderId, sum]): DrillRow => {
    const source = sources.get(orderId ?? 'stock');
    return {
      key: `source:${orderId ?? 'stock'}`, pill: source?.status === 'CONCEPT' ? 'Concept' : null,
      link: orderId === null ? null : { run: () => ctx.openPo(orderId) },
      cells: { source: source?.label ?? (orderId === null ? 'Huidige voorraad' : `Inkoop #${orderId}`), sales: euros(sum.sales), cost: euros(sum.cost),
        inBank: euros(sum.cash), margin: euros(sum.sales - sum.cost) },
    };
  });
  const sales = forecast.scenario.salesExclEur;
  return {
    id: 'cash.scenarioSales', title: 'Verkoop in het scenario', scope: `Tot ${end} · verkoop, kost en marge excl. btw`,
    summary: sales > 0 ? `${pctText(forecast.scenario.marginEur / sales * 100)} % marge op ${ctx.whole(sales)} verkoop` : null,
    note: `Alleen wat tot ${end} verkocht en betaald is; de rest van het plan komt later.`,
    columns: [
      { key: 'source', label: 'Bron', format: 'text', phone: 'title' },
      { key: 'sales', label: 'Verkoop excl.', format: 'eur', phone: 'sub', sum: true },
      { key: 'cost', label: 'Kost', format: 'eur', phone: 'none', sum: true },
      { key: 'inBank', label: 'Binnen incl.', format: 'eur', phone: 'none', sum: true },
      { key: 'margin', label: 'Marge', format: 'eur', phone: 'value' },
    ],
    rows, valueKey: 'margin', total: { value: forecast.scenario.marginEur, format: 'eur', of: 'sum', label: 'Marge op goederen' },
    sort: { key: 'margin', dir: 'desc' }, empty: `Geen scenarioverkoop tot ${end}.`,
  };
}

/** Scenario › Huidige voorraad: the stock's sales plan per product (`cash.stockPlan`). */
export function cashStockPlanView(source: ScenarioSource, ctx: CashDrillContext): DrillView {
  const rows = (source.products ?? []).map((product, index): DrillRow => ({
    key: product.productId === null ? `line:${index}` : `product:${product.productId}`,
    link: product.productId === null ? null : { path: ['/products', product.productId] },
    cells: { product: product.name, units: product.units, unitCost: product.costUnitEur, unitPrice: product.priceUnitEur, back: product.backEur },
  }));
  const weeks = source.choice?.sellWeeks;
  return {
    id: 'cash.stockPlan', title: source.label, scope: 'Het hele verkoopplan · excl. btw',
    summary: `Kost ${ctx.whole(source.costEur)}${weeks ? ` · verkocht in ${weeks} w` : ''}`,
    columns: [
      { key: 'product', label: 'Product', format: 'text', phone: 'title' },
      { key: 'units', label: 'Eenheden', format: 'int', phone: 'sub' },
      { key: 'unitCost', label: 'Kost/eenheid', format: 'eur2', phone: 'none' },
      { key: 'unitPrice', label: 'Prijs/eenheid', format: 'eur2', phone: 'none' },
      { key: 'back', label: 'Terug excl.', format: 'eur', phone: 'value' },
    ],
    rows, valueKey: 'back', total: { value: source.backEur, format: 'eur', of: 'sum', label: 'Terug excl. btw' },
    sort: { key: 'back', dir: 'desc' }, empty: 'Geen voorraad met een kostprijs.',
  };
}

/* ------------------------------------------------------------- Per maand */

/**
 * A month of "Per maand": the bank lines of a past month, the items of a future one (`cash.month.{key}`). The total
 * is the month's in + out as the table counts it; a receipt on a manual account has no bank line (design D-K3).
 */
export function cashMonthView(month: ForecastMonth, lines: readonly MonthLine[], ctx: CashDrillContext): DrillView {
  const rows = lines.map((line, index): DrillRow => ({
    key: line.lineId !== null ? `line:${line.lineId}` : line.item?.key ?? `row:${index}`,
    pill: line.item?.layer === 'SCENARIO' ? 'Scenario' : null,
    link: line.lineId !== null ? drillLinkOf(ctx.lineLink(line.lineId), ctx) : itemDrillLink(line.item, ctx),
    cells: { day: line.day, title: line.title, sub: line.sub, amount: line.amountEur },
  }));
  return {
    id: `cash.month.${month.key}`, title: `${month.past ? 'Gebeurd' : 'Verwacht'} · ${month.label}`,
    scope: `${month.past ? 'Banktransacties van de rekeningen die meetellen' : 'Verwachte bewegingen met het scenario'} · incl. btw`,
    columns: [
      { key: 'day', label: 'Dag', format: 'day', phone: 'sub', width: '84px' },
      { key: 'title', label: 'Omschrijving', format: 'text', phone: 'title' },
      { key: 'sub', label: 'Regel', format: 'text', phone: 'sub' },
      { key: 'amount', label: 'Bedrag', format: 'eurSigned', phone: 'value' },
    ],
    rows, valueKey: 'amount', total: { value: euros(cents(month.inEur) + cents(month.outEur)), format: 'eurSigned', of: 'sum', label: 'Netto' },
    gapLabel: 'Ontvangsten zonder banklijn', sort: { key: 'day', dir: 'asc' }, empty: 'Geen regels in deze maand.',
  };
}

/* ----------------------------------------------------------- Aansluiting */

/**
 * Aansluiting › "Lijkt al betaald (niet dubbel geteld)": the open items an unlinked bank line seems to have paid
 * (`cash.likelyPaid`). The line adds them back to the Vooruitblik, so its figure is minus their sum; a match that
 * another line counts (a VAT return, a fixed cost, a quote) is the gap.
 */
export function cashLikelyPaidView(forecast: CashForecast, lineEur: number, ctx: CashDrillContext): DrillView {
  const rows = forecast.likelyPaid.map((match): DrillRow => ({
    key: `${match.lineId}:${match.itemKey}`, link: drillLinkOf(ctx.lineLink(match.lineId), ctx),
    cells: { title: match.title, bank: [match.account, match.counterparty].filter(Boolean).join(' · '), day: match.day, amount: match.amountEur },
  }));
  return {
    id: 'cash.likelyPaid', title: 'Lijkt al betaald', scope: 'Niet gekoppelde banklijnen van de laatste 90 dagen · incl. btw',
    note: 'Tot je de banklijn koppelt, telt de post niet nog eens mee.',
    columns: [
      { key: 'title', label: 'Omschrijving', format: 'text', phone: 'title' },
      { key: 'bank', label: 'Banklijn', format: 'text', phone: 'sub' },
      { key: 'day', label: 'Dag', format: 'day', phone: 'sub', width: '84px' },
      { key: 'amount', label: 'Bedrag', format: 'eurSigned', phone: 'value' },
    ],
    rows, valueKey: 'amount', total: { value: euros(-cents(lineEur)), format: 'eurSigned', of: 'sum', label: 'Niet dubbel geteld' },
    gapLabel: 'Telt in een andere regel', sort: { key: 'day', dir: 'asc' }, empty: 'Geen banklijn die een open post lijkt te betalen.',
  };
}
