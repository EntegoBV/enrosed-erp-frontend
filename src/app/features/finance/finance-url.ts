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
}

export const NO_ACCOUNT = '__none__';

const VIEWS: readonly FinanceView[] = ['overview', 'open', 'incoming', 'bank', 'costs', 'analysis'];
/** Kept in step with FINANCE_TABS in finance-sections.ts (a node test checks both). */
export const TAB_IDS: Readonly<Record<FinanceView, readonly string[]>> = {
  overview: [],
  open: ['all', 'costs', 'containers', 'recurring'],
  incoming: ['open', 'received'],
  bank: ['accounts', 'movements'],
  costs: ['company', 'containers', 'recurring'],
  analysis: [],
};
const PERIODS: readonly FinancePeriod[] = ['month', 'quarter', 'year', 'lastYear', 'all'];
const PURPOSES: readonly FinancePurpose[] = ['STANDARD', 'PARTNER_ADVANCE', 'PARTNER_SETTLEMENT'];

type Field = Exclude<keyof FinanceLocation, 'view' | 'tab'>;

/** Which filters each section and segment honours; the rest never reaches the address. */
function honoured(view: FinanceView, tab: string): readonly Field[] {
  switch (`${view}/${tab}`) {
    case 'open/all': case 'open/costs': case 'open/containers': case 'open/recurring': return ['q'];
    case 'incoming/open': return ['kind', 'q'];
    case 'incoming/received': return ['period', 'from', 'to', 'dir', 'purpose', 'account', 'q'];
    case 'bank/movements': return ['dir', 'link', 'account', 'period', 'from', 'to', 'q'];
    case 'costs/company': return ['period', 'from', 'to', 'q', 'cat', 'status', 'channel', 'docs', 'cost'];
    case 'costs/containers': return ['container', 'scope', 'q'];
    case 'analysis/': return ['year'];
    default: return [];
  }
}

/** The period a list starts with before anyone picks one. */
export function defaultPeriod(view: FinanceView, tab: string): FinancePeriod | '' {
  if (view === 'costs' && tab === 'company') return 'year';
  if (view === 'incoming' && tab === 'received') return 'month';
  if (view === 'bank' && tab === 'movements') return 'all';
  return '';
}

export function defaultTab(view: FinanceView): string {
  return TAB_IDS[view][0] ?? '';
}

export const DEFAULT_LOCATION: FinanceLocation = {
  view: 'overview', tab: '', period: '', from: '', to: '', q: '', cat: '', status: '', channel: '', docs: '',
  container: null, cost: null, scope: '', account: '', dir: '', link: '', kind: '', purpose: '', year: '',
};

/** A positive safe integer id, or null ('0', '-1', '1e3', 'abc' are all refused). */
export function positiveId(raw: string | null | undefined): number | null {
  if (!raw || !/^[1-9]\d*$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

const isDay = (raw: string | null): raw is string => !!raw && /^\d{4}-\d{2}-\d{2}$/.test(raw);

/**
 * Reads the address. Older links keep working: view=recurring is Uitgaven ›
 * Vaste kosten, container=<id> (from the purchase order) opens Uitgaven ›
 * Containers on that container, cost=<id> (or the older kost=<id>) inspects
 * that company cost, and anything unknown falls back to a sensible default.
 */
export function parseFinanceLocation(get: (key: string) => string | null): FinanceLocation {
  const raw = get('view');
  let view: FinanceView = VIEWS.includes(raw as FinanceView) ? raw as FinanceView : 'overview';
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
  location.container = allowed.has('container') ? container : null;
  location.cost = allowed.has('cost') ? cost : null;

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
  if (view !== 'overview') params['view'] = view;
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
    if (value !== null && value !== '') params[field] = String(value);
  }
  return params;
}

/** Applies a change to a location; a new section or segment starts from its own defaults. */
export function patchLocation(current: FinanceLocation, patch: Partial<FinanceLocation>): FinanceLocation {
  const view = patch.view ?? current.view;
  const sectionChanged = view !== current.view || (patch.tab !== undefined && patch.tab !== current.tab);
  const base: FinanceLocation = sectionChanged ? { ...DEFAULT_LOCATION, view, tab: current.view === view ? current.tab : '' } : current;
  const merged: FinanceLocation = { ...base, ...patch, view };
  if (!TAB_IDS[view].includes(merged.tab)) merged.tab = defaultTab(view);
  if (sectionChanged && patch.period === undefined && !patch.from && !patch.to) merged.period = defaultPeriod(view, merged.tab);
  if ((patch.from !== undefined || patch.to !== undefined) && patch.period === undefined) {
    merged.period = merged.from || merged.to ? 'custom' : defaultPeriod(view, merged.tab) || 'all';
  }
  if (patch.period && patch.period !== 'custom') { merged.from = ''; merged.to = ''; }
  return merged;
}
