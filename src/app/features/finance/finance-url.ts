import type { FinanceView } from './finance-sections';

/*
 * The address of the Kosten & bank workspace: section, segment and every
 * list filter live in the query string, so a reload, Back from an invoice or
 * a shared link lands on the same list. This is the only place that reads or
 * writes those parameters. Pure: the node tests run it on its own.
 */

export type FinancePeriod = 'month' | 'quarter' | 'year' | 'lastYear' | 'all' | 'custom';
export type FinancePurpose = 'STANDARD' | 'PARTNER_ADVANCE' | 'PARTNER_SETTLEMENT';

export interface FinanceLocation {
  view: FinanceView;
  /** The segment; '' on sections without segments, never empty on the others. */
  tab: string;
  /** '' where the section has no period; 'custom' when from/to carry it. */
  period: FinancePeriod | '';
  from: string;
  to: string;
  q: string;
  cat: string;
  status: 'open' | 'paid' | '';
  channel: string;
  docs: 'missing' | '';
  container: number | null;
  cost: number | null;
  /** Uitgaven › Containers: 'all' shows finished containers too. */
  scope: 'all' | '';
  /** A bank account key, or '__none__' for receipts without an account. */
  account: string;
  /** Ontvangen: receipts, refunds, or the verrekeningen between credit notes and invoices. */
  dir: 'in' | 'out' | 'offset' | '';
  link: 'unlinked' | '';
  kind: 'customer' | 'partner' | 'credit' | '';
  purpose: FinancePurpose | '';
  /** Analyse: 'YYYY' or 'all'; '' is the current year. */
  year: string;
  /** Analyse › Btw-aangifte: the quarter; '' is the last closed one. */
  quarter: '' | '1' | '2' | '3' | '4';
  /** Uitgaven › Bedrijfskosten: a regime code, or 'unconfirmed' for the derived and unknown ones. */
  regime: string;
  /** A bank line in the inspector (desk) or the detail sheet (phone); honoured on every section. */
  line: number | null;
  /** The Kaslijn's span on Bank; null is the default, 8 weeks. */
  weeks: 4 | 8 | 13 | null;
  /** Facturen: the chip ('' is Alles; in: containers · costs · odoo-new · no-file, out: invoices · credit-notes · odoo). */
  only: string;
  /** Facturen: one container's invoices (its "Facturen ›" link); kept across Inkomend and Uitgaand. */
  po: number | null;
  /** Facturen: the row in the preview, by its key (pi:12, cost:9, odoo:900001, …). */
  doc: string;
}

export const NO_ACCOUNT = '__none__';

const VIEWS: readonly FinanceView[] = ['bank', 'open', 'incoming', 'invoices', 'costs', 'analysis'];
/** Kept in step with FINANCE_TABS in finance-sections.ts (a node test checks both). */
export const TAB_IDS: Readonly<Record<FinanceView, readonly string[]>> = {
  open: ['all', 'costs', 'containers', 'recurring'],
  incoming: ['open', 'received'],
  invoices: ['in', 'out'],
  bank: ['accounts', 'movements'],
  costs: ['company', 'containers', 'recurring', 'lists'],
  analysis: ['costs', 'vat'],
};
const PERIODS: readonly FinancePeriod[] = ['month', 'quarter', 'year', 'lastYear', 'all'];
const PURPOSES: readonly FinancePurpose[] = ['STANDARD', 'PARTNER_ADVANCE', 'PARTNER_SETTLEMENT'];
/** The regime codes of finance-metrics VAT_REGIMES, as the address accepts them. */
/** Facturen's chips per direction. */
const ONLY: Readonly<Record<string, readonly string[]>> = { in: ['containers', 'costs', 'odoo-new', 'no-file'], out: ['invoices', 'credit-notes', 'odoo'] };
/** A finder row key, as the server accepts it. */
const DOC_KEY = /^(pi|pd|cost|odoo|so):[1-9]\d{0,17}$/;
const REGIMES = new Set(['BE', 'EU_GOODS', 'EU_SERVICES', 'NON_EU_SERVICES', 'FOREIGN_VAT', 'EXEMPT', 'OUT_OF_SCOPE', 'NO_INVOICE', 'IMPORT_VAT_PAID', 'unconfirmed']);

type Field = Exclude<keyof FinanceLocation, 'view' | 'tab'>;

/** Which filters each section and segment honours; the rest never reaches the address. A bank line (`line`) opens anywhere. */
export function honoured(view: FinanceView, tab: string): readonly Field[] {
  switch (`${view}/${tab}`) {
    case 'bank/accounts': return ['line', 'weeks'];
    case 'bank/movements': return ['dir', 'link', 'account', 'period', 'from', 'to', 'q', 'line'];
    case 'open/all': case 'open/costs': case 'open/containers': case 'open/recurring': return ['q', 'line'];
    case 'incoming/open': return ['kind', 'q', 'line'];
    case 'incoming/received': return ['period', 'from', 'to', 'dir', 'purpose', 'account', 'q', 'line'];
    case 'costs/company': return ['period', 'from', 'to', 'q', 'cat', 'status', 'channel', 'docs', 'cost', 'regime', 'line'];
    case 'costs/containers': return ['container', 'scope', 'q', 'line'];
    case 'costs/lists': return ['q', 'line'];
    case 'analysis/costs': return ['year', 'line'];
    case 'analysis/vat': return ['year', 'quarter', 'line'];
    case 'invoices/in': case 'invoices/out': return ['q', 'period', 'from', 'to', 'only', 'po', 'doc', 'line'];
    default: return ['line'];
  }
}

/** The period a list starts with before anyone picks one. */
export function defaultPeriod(view: FinanceView, tab: string): FinancePeriod | '' {
  if (view === 'costs' && tab === 'company') return 'year';
  if (view === 'incoming' && tab === 'received') return 'month';
  if (view === 'bank' && tab === 'movements') return 'all';
  if (view === 'invoices') return 'all';
  return '';
}

export function defaultTab(view: FinanceView): string {
  return TAB_IDS[view][0] ?? '';
}

export const DEFAULT_LOCATION: FinanceLocation = {
  view: 'bank', tab: '', period: '', from: '', to: '', q: '', cat: '', status: '', channel: '', docs: '',
  container: null, cost: null, scope: '', account: '', dir: '', link: '', kind: '', purpose: '', year: '', quarter: '', regime: '',
  line: null, weeks: null, only: '', po: null, doc: '',
};

/** A positive safe integer id, or null ('0', '-1', '1e3', 'abc' are all refused). */
export function positiveId(raw: string | null | undefined): number | null {
  if (!raw || !/^[1-9]\d*$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

const isDay = (raw: string | null): raw is string => !!raw && /^\d{4}-\d{2}-\d{2}$/.test(raw);

/**
 * Reads the address. Older links keep working: view=overview (the Overzicht
 * before 2026-10-16) and any unknown view are Bank, view=recurring is
 * Uitgaven › Vaste kosten, container=<id> (from the purchase order) opens
 * Uitgaven › Containers on that container, cost=<id> (or the older
 * kost=<id>) inspects that company cost, and anything unknown falls back to
 * a sensible default.
 */
export function parseFinanceLocation(get: (key: string) => string | null): FinanceLocation {
  const raw = get('view');
  let view: FinanceView = VIEWS.includes(raw as FinanceView) ? raw as FinanceView : 'bank';
  let tab = get('tab') ?? '';
  if (raw === 'recurring') { view = 'costs'; tab = 'recurring'; }
  const container = positiveId(get('container'));
  const cost = positiveId(get('cost') ?? get('kost'));
  if (container) { view = 'costs'; tab = 'containers'; }
  else if (cost && !(view === 'costs' && (tab === '' || tab === 'company'))) { view = 'costs'; tab = 'company'; }
  if (!TAB_IDS[view].includes(tab)) tab = defaultTab(view);

  const allowed = new Set(honoured(view, tab));
  const location: FinanceLocation = { ...DEFAULT_LOCATION, view, tab };
  const text = (key: Field): string => (allowed.has(key) ? get(key) ?? '' : '');
  location.q = text('q');
  location.cat = text('cat').trim().toUpperCase();
  location.channel = text('channel').trim().toUpperCase();
  location.account = text('account').trim();
  const status = text('status');
  location.status = status === 'open' || status === 'paid' ? status : '';
  location.docs = text('docs') === 'missing' ? 'missing' : '';
  location.scope = text('scope') === 'all' ? 'all' : '';
  const dir = text('dir');
  location.dir = dir === 'in' || dir === 'out' || dir === 'offset' ? dir : '';
  location.link = text('link') === 'unlinked' ? 'unlinked' : '';
  const kind = text('kind');
  location.kind = kind === 'customer' || kind === 'partner' || kind === 'credit' ? kind : '';
  const purpose = text('purpose');
  location.purpose = PURPOSES.includes(purpose as FinancePurpose) ? purpose as FinancePurpose : '';
  const year = text('year');
  location.year = year === 'all' || /^\d{4}$/.test(year) ? year : '';
  const quarter = text('quarter');
  location.quarter = quarter === '1' || quarter === '2' || quarter === '3' || quarter === '4' ? quarter : '';
  const regime = text('regime').trim();
  const regimeCode = regime === 'unconfirmed' ? regime : regime.toUpperCase();
  location.regime = REGIMES.has(regimeCode) ? regimeCode : '';
  location.container = allowed.has('container') ? container : null;
  location.cost = allowed.has('cost') ? cost : null;
  location.line = allowed.has('line') ? positiveId(get('line')) : null;
  const weeks = text('weeks');
  location.weeks = weeks === '4' ? 4 : weeks === '13' ? 13 : null;
  const only = text('only');
  location.only = (ONLY[tab] ?? []).includes(only) ? only : '';
  location.po = allowed.has('po') ? positiveId(get('po')) : null;
  const doc = text('doc');
  location.doc = DOC_KEY.test(doc) ? doc : '';

  if (allowed.has('period')) {
    const from = get('from'), to = get('to');
    if (isDay(from) || isDay(to)) {
      location.period = 'custom';
      location.from = isDay(from) ? from : '';
      location.to = isDay(to) ? to : '';
    } else {
      const period = get('period') as FinancePeriod;
      location.period = PERIODS.includes(period) ? period : defaultPeriod(view, tab);
    }
  }
  return location;
}

/** Writes a location back as query parameters, leaving out every default. */
export function financeQueryParams(location: FinanceLocation): Record<string, string> {
  const params: Record<string, string> = {};
  const { view, tab } = location;
  if (view !== 'bank') params['view'] = view;
  if (tab && tab !== defaultTab(view) && TAB_IDS[view].includes(tab)) params['tab'] = tab;
  for (const field of honoured(view, tab || defaultTab(view))) {
    if (field === 'from' || field === 'to') continue;
    if (field === 'period') {
      if (location.period === 'custom') {
        if (location.from) params['from'] = location.from;
        if (location.to) params['to'] = location.to;
      } else if (location.period && location.period !== defaultPeriod(view, tab || defaultTab(view))) {
        params['period'] = location.period;
      }
      continue;
    }
    const value = location[field];
    if (field === 'weeks' && value === 8) continue;
    if (value !== null && value !== '') params[field] = String(value);
  }
  return params;
}

/** Applies a change to a location; a new section or segment starts from its own defaults. */
export function patchLocation(current: FinanceLocation, patch: Partial<FinanceLocation>): FinanceLocation {
  const view = patch.view ?? current.view;
  const sectionChanged = view !== current.view || (patch.tab !== undefined && patch.tab !== current.tab);
  /* Facturen: Inkomend ↔ Uitgaand keeps the search, the period and the container (it filters both); the chip and the preview reset. */
  const finderTab = sectionChanged && view === 'invoices' && current.view === 'invoices';
  const base: FinanceLocation = !sectionChanged ? current
    : finderTab ? { ...DEFAULT_LOCATION, view, tab: current.tab, q: current.q, period: current.period, from: current.from, to: current.to, po: current.po }
    : { ...DEFAULT_LOCATION, view, tab: current.view === view ? current.tab : '' };
  const merged: FinanceLocation = { ...base, ...patch, view };
  if (!TAB_IDS[view].includes(merged.tab)) merged.tab = defaultTab(view);
  if (sectionChanged && !finderTab && patch.period === undefined && !patch.from && !patch.to) merged.period = defaultPeriod(view, merged.tab);
  if ((patch.from !== undefined || patch.to !== undefined) && patch.period === undefined) {
    merged.period = merged.from || merged.to ? 'custom' : defaultPeriod(view, merged.tab) || 'all';
  }
  if (patch.period && patch.period !== 'custom') { merged.from = ''; merged.to = ''; }
  return merged;
}
