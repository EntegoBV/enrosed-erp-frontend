import type { ActivityCategory, ActivityChange, ActivityEvent } from '../../core/api/models';

/**
 * The Logboek in words: values formatted the way the rest of the ERP shows
 * them, events grouped into bursts, filters in the URL, and the workaround
 * for the missing FINANCE category on today's backend. Pure (node-tested):
 * names of purchase orders and suppliers come in through a context.
 */

/** Names the page knows from its lookups (loaded lazily, may be empty). */
export interface ActivityContext {
  /** A purchase order's container name by id (containerName()), or null. */
  poName?: (id: string) => string | null;
  /** A supplier's name by id, or null. */
  supplierName?: (id: string) => string | null;
}

export type CategoryChip = 'ALL' | ActivityCategory;

const FINANCE_TYPES = new Set(['COMPANY_COST', 'RECURRING_COST', 'BANK_BALANCE', 'BANK_STATEMENT']);

/** Costs and bank events, which today's backend files under OTHER. */
export function isFinanceEntity(entityType: string): boolean {
  return FINANCE_TYPES.has(entityType.trim().toUpperCase());
}

/**
 * What to ask the API for a category chip. The backend has no FINANCE yet:
 * "Kosten & bank" asks FINANCE once; after a 400 (financeSupported false) it
 * asks OTHER and keeps only the cost and bank events, and "Overig" drops
 * them. Adopts the backend category by itself once it exists.
 */
export function categoryRequest(chip: CategoryChip, financeSupported: boolean | null): {
  category: ActivityCategory | undefined;
  keep: 'all' | 'finance' | 'not-finance';
} {
  if (chip === 'ALL') return { category: undefined, keep: 'all' };
  if (chip === 'FINANCE') return financeSupported === false ? { category: 'OTHER', keep: 'finance' } : { category: 'FINANCE', keep: 'all' };
  if (chip === 'OTHER') return { category: 'OTHER', keep: 'not-finance' };
  return { category: chip, keep: 'all' };
}

export function keepForChip(event: Pick<ActivityEvent, 'entityType'>, keep: 'all' | 'finance' | 'not-finance'): boolean {
  if (keep === 'all') return true;
  return keep === 'finance' ? isFinanceEntity(event.entityType) : !isFinanceEntity(event.entityType);
}

/* ------------------------------------------------------------ filters */

export interface ActivityFilters {
  category: CategoryChip;
  /** An account username, 'systeem', or null for everybody. */
  actor: string | null;
  entityType: string | null;
  entityId: string | null;
}

const CHIPS: readonly CategoryChip[] = ['ALL', 'SALES', 'PURCHASING', 'CATALOGUE', 'RELATIONS', 'PLANNING', 'FINANCE', 'OTHER'];

/** ?soort=PURCHASING&wie=berat&type=PURCHASE_ORDER&id=62 → filters (unknown values fall back). */
export function activityFiltersFromQuery(params: Readonly<Record<string, string | null | undefined>>): ActivityFilters {
  const soort = (params['soort'] ?? '').toUpperCase() as CategoryChip;
  const wie = (params['wie'] ?? '').trim().toLowerCase();
  const type = (params['type'] ?? '').trim().toUpperCase();
  const id = (params['id'] ?? '').trim();
  return {
    category: CHIPS.includes(soort) ? soort : 'ALL',
    actor: /^[a-z0-9._-]{1,40}$/.test(wie) ? wie : null,
    entityType: /^[A-Z_]{2,40}$/.test(type) && id ? type : null,
    entityId: /^[A-Z_]{2,40}$/.test(type) && /^[\w-]{1,40}$/.test(id) ? id : null,
  };
}

/** The query for these filters; defaults are left out. */
export function activityQueryFromFilters(filters: ActivityFilters): Record<string, string> {
  const query: Record<string, string> = {};
  if (filters.category !== 'ALL') query['soort'] = filters.category;
  if (filters.actor) query['wie'] = filters.actor;
  if (filters.entityType && filters.entityId) { query['type'] = filters.entityType; query['id'] = filters.entityId; }
  return query;
}

/* ------------------------------------------------------------- values */

const STATUS_WORDS: Record<string, string> = {
  CONCEPT: 'Concept', BESTELD: 'Besteld', PRODUCTIE: 'In productie', ONDERWEG: 'Vertrokken', ONTVANGEN: 'Ontvangen',
  CALCULATIE: 'Calculatie', AFGEROND: 'Afgerond', UITGEREIKT: 'Uitgereikt', VERZONDEN: 'Verstuurd', BEKEKEN: 'Bekeken',
  GEACCEPTEERD: 'Geaccepteerd', AFGEWEZEN: 'Afgewezen', GEANNULEERD: 'Geannuleerd', VERLOPEN: 'Verlopen', BETAALD: 'Betaald',
  WIJZIGING_GEVRAAGD: 'Wijziging gevraagd',
};
const ENUM_WORDS: Record<string, string> = {
  PAYMENT_PROOF: 'Betaalbewijs', COMMERCIAL_INVOICE: 'Handelsfactuur', INVOICE: 'Factuur', PACKING_LIST: 'Paklijst',
  BILL_OF_LADING: 'Cognossement (B/L)', CUSTOMS: 'Douanedocument', OTHER: 'Overig',
};
/** Labels whose values are references, never numbers to format. */
const RAW_LABEL = /barcode|\bean\b|sku|code|nummer|\bhs\b|iban|referentie|telefoon|btw/i;

const pad = (n: number) => String(n).padStart(2, '0');

/** "1407.53" → "1.407,53", "2000.00" → "2.000", "18.90" → "18,90". */
export function nlNumber(raw: string): string {
  const negative = raw.trim().startsWith('-');
  const [whole, fraction = ''] = raw.trim().replace(/^[-+]/, '').split('.');
  const grouped = whole.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const decimals = /^0*$/.test(fraction) ? '' : `,${fraction.length === 1 ? fraction + '0' : fraction}`;
  return `${negative ? '−' : ''}${grouped}${decimals}`;
}

/**
 * "-18415.00" → "€ −18.415,00" (always two decimals for money). The space
 * after the symbol is a no-break space: a line never ends on a bare "€".
 */
export function nlMoney(raw: string, currency = 'EUR'): string {
  const negative = raw.trim().startsWith('-');
  const [whole, fraction = ''] = raw.trim().replace(/^[-+]/, '').split('.');
  const grouped = whole.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const cents = (fraction + '00').slice(0, 2);
  const symbol = currency === 'EUR' ? '€' : currency === 'USD' ? '$' : currency;
  return `${symbol}\u00a0${negative ? '−' : ''}${grouped},${cents}`;
}

const NUMBER = /^-?\d+(\.\d+)?$/;

/** The currency an event names (a "Valuta" change), if any. */
function eventCurrency(event: Pick<ActivityEvent, 'changes'>): string | null {
  const change = (event.changes ?? []).find((item) => /^valuta$|currency/i.test(item.label) || item.field === 'currency');
  const value = (change?.afterValue ?? change?.beforeValue ?? '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(value) ? value : null;
}

/**
 * One value of a change, as the ERP shows it elsewhere. Money only with a
 * known currency (EXW prices are USD on purchase orders, so a blind € would
 * be wrong); dates in Belgian notation; statuses and document kinds in
 * words; supplier ids by name; references (SKU, EAN, codes) as they are.
 */
export function activityValue(
  change: Pick<ActivityChange, 'label' | 'field'>,
  value: string | null,
  event: Pick<ActivityEvent, 'changes'>,
  ctx: ActivityContext = {},
): string {
  const raw = (value ?? '').trim();
  if (!raw) return 'Niet ingevuld';
  const label = change.label ?? '';
  if (/^leverancier$/i.test(label) || change.field === 'supplierId') {
    return (NUMBER.test(raw) ? ctx.supplierName?.(raw) : null) ?? raw;
  }
  if (/^status/i.test(label) || change.field === 'status') return STATUS_WORDS[raw.toUpperCase()] ?? raw;
  if (ENUM_WORDS[raw]) return ENUM_WORDS[raw];
  if (/^(ja|true)$/i.test(raw)) return 'Ja';
  if (/^(nee|false)$/i.test(raw)) return 'Nee';
  const date = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (date) return `${date[3]}/${date[2]}/${date[1]}`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)) {
    const at = new Date(raw);
    if (!Number.isNaN(at.getTime())) return `${pad(at.getDate())}/${pad(at.getMonth() + 1)}/${at.getFullYear()} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
  }
  if (RAW_LABEL.test(label)) return raw;
  if (NUMBER.test(raw)) {
    if (/\(EUR\)\s*$/i.test(label)) return nlMoney(raw, 'EUR');
    const currency = eventCurrency(event);
    return currency && !/aantal|stuks|percentage|%|dagen/i.test(label) ? nlMoney(raw, currency) : nlNumber(raw);
  }
  return raw;
}

/** Older entries could carry a value that "changed" into itself; those pairs say nothing (both empty = a private field). */
export function changesOf(event: Pick<ActivityEvent, 'changes'>): ActivityChange[] {
  return (event.changes ?? []).filter((change) => change.beforeValue !== change.afterValue
    || (change.beforeValue === null && change.afterValue === null));
}

/** A private change (both values withheld) reads "Inhoud aangepast". */
export function isPrivateChange(change: Pick<ActivityChange, 'beforeValue' | 'afterValue'>): boolean {
  return change.beforeValue === null && change.afterValue === null;
}

/** "Status Concept → Besteld · EXW-prijs → 18,90 · +3". */
export function changePreview(event: Pick<ActivityEvent, 'changes'>, ctx: ActivityContext = {}, max = 2): string {
  const changes = changesOf(event);
  const parts = changes.slice(0, max).map((change) => {
    const label = change.label.split(' · ')[0];
    if (isPrivateChange(change)) return `${label} aangepast`;
    const after = activityValue(change, change.afterValue, event, ctx);
    if (change.beforeValue === null || change.beforeValue.trim() === '') return `${label} → ${after}`;
    return `${label} ${activityValue(change, change.beforeValue, event, ctx)} → ${after}`;
  });
  if (changes.length > max) parts.push(`+${changes.length - max}`);
  return parts.join(' · ');
}

/** Bank summaries in euro: "toegewezen -18415.00 · verschil 0.00" → "toegewezen € −18.415,00 · verschil € 0,00". */
export function activitySummaryText(summary: string): string {
  return summary.replace(/\b(toegewezen|verschil|saldo|bedrag|totaal)(:?\s+)(-?\d+\.\d{2})\b/gi,
    (_, word: string, gap: string, amount: string) => `${word}${gap}${nlMoney(amount)}`);
}

/** The record's name: a purchase order by its container name, a bank line with its IBAN in groups and the amount in euro. */
export function activityEntityText(event: Pick<ActivityEvent, 'entityType' | 'entityId' | 'entityLabel'>, ctx: ActivityContext = {}): string {
  const label = (event.entityLabel ?? '').trim();
  const type = event.entityType.trim().toUpperCase();
  if (type === 'PURCHASE_ORDER' && event.entityId) {
    const name = ctx.poName?.(event.entityId);
    if (name) return name;
  }
  if (type === 'BANK_STATEMENT' || type === 'BANK_BALANCE') {
    const match = label.match(/^([A-Z]{2}\d{2}[A-Z0-9]{8,30})\s*·\s*(-?\d+(?:\.\d+)?)$/);
    if (match) return `${match[1].replace(/(.{4})(?=.)/g, '$1 ')} · ${nlMoney(match[2])}`;
  }
  return label;
}

/** The number under a container name, when the name is not the number itself. */
export function activityEntitySub(event: Pick<ActivityEvent, 'entityType' | 'entityId' | 'entityLabel'>, ctx: ActivityContext = {}): string | null {
  const label = (event.entityLabel ?? '').trim();
  const name = activityEntityText(event, ctx);
  return event.entityType.trim().toUpperCase() === 'PURCHASE_ORDER' && label && name !== label ? label : null;
}

/* ------------------------------------------------------------- bursts */

export interface ActivityRow {
  /** The newest event's id. */
  key: number;
  /** Newest first; one event, or a burst of the same edit. */
  events: ActivityEvent[];
}

const MILESTONES = new Set(['CREATED', 'DELETED', 'STATUS_CHANGED']);

/**
 * Consecutive events (newest first) become one row when the same person did
 * the same action on the same record, each within `windowMin` minutes of the
 * previous one. Creation, deletion and status changes always stand alone.
 */
export function activityRows(events: readonly ActivityEvent[], windowMin = 15): ActivityRow[] {
  const rows: ActivityRow[] = [];
  for (const event of events) {
    const last = rows.at(-1);
    const previous = last?.events.at(-1);
    const action = event.action.trim().toUpperCase();
    if (last && previous && !MILESTONES.has(action)
      && previous.action.trim().toUpperCase() === action
      && (previous.actor?.username ?? null) === (event.actor?.username ?? null)
      && previous.entityType === event.entityType && previous.entityId === event.entityId && event.entityId !== null
      && Math.abs(new Date(previous.at).getTime() - new Date(event.at).getTime()) <= windowMin * 60_000) {
      last.events.push(event);
    } else {
      rows.push({ key: event.id, events: [event] });
    }
  }
  return rows;
}

/** "12:18", or "10:42–10:47" for a burst. */
export function rowTime(row: ActivityRow): string {
  const time = (at: string) => { const d = new Date(at); return Number.isNaN(d.getTime()) ? '' : `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const newest = time(row.events[0].at);
  const oldest = time(row.events.at(-1)!.at);
  return newest === oldest ? newest : `${oldest}–${newest}`;
}

export interface ActivityDay {
  key: string;
  label: string;
  /** Events of that day (not rows). */
  count: number;
  rows: ActivityRow[];
}

const dayKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** "Vandaag", "Gisteren", else "Woensdag 14 oktober 2026" (the month in lower case). */
export function dayLabel(at: string, now: Date = new Date()): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return 'Datum onbekend';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (dayKey(date) === dayKey(now)) return 'Vandaag';
  if (dayKey(date) === dayKey(yesterday)) return 'Gisteren';
  const label = new Intl.DateTimeFormat('nl-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Rows grouped per day; the day count counts events, not rows. */
export function activityDays(rows: readonly ActivityRow[], now: Date = new Date()): ActivityDay[] {
  const days = new Map<string, ActivityDay>();
  for (const row of rows) {
    const at = new Date(row.events[0].at);
    const key = Number.isNaN(at.getTime()) ? 'unknown' : dayKey(at);
    const day = days.get(key) ?? { key, label: dayLabel(row.events[0].at, now), count: 0, rows: [] };
    day.rows.push(row);
    day.count += row.events.length;
    days.set(key, day);
  }
  return [...days.values()];
}

/** "donderdag 16 oktober 2026, 10:48". */
export function longDateTime(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return '';
  const day = new Intl.DateTimeFormat('nl-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(date);
  return `${day}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/* ----------------------------------------------------------- overview */

export interface ActivityOverview {
  total: number;
  /** "14 tot 16 okt". */
  span: string;
  people: { name: string; count: number }[];
  categories: { category: ActivityCategory; count: number }[];
  records: { entityType: string; entityId: string; label: string; count: number; sample: ActivityEvent }[];
}

/** Who did what in the loaded events: per person, per category and the three most changed records. */
export function activityOverview(events: readonly ActivityEvent[], categoryOf: (event: ActivityEvent) => ActivityCategory): ActivityOverview {
  const count = <K>(map: Map<K, number>, key: K) => map.set(key, (map.get(key) ?? 0) + 1);
  const people = new Map<string, number>();
  const categories = new Map<ActivityCategory, number>();
  const records = new Map<string, { entityType: string; entityId: string; label: string; count: number; sample: ActivityEvent }>();
  for (const event of events) {
    count(people, event.actor?.displayName || 'Systeem');
    count(categories, categoryOf(event));
    if (event.entityId) {
      const key = `${event.entityType}:${event.entityId}`;
      const record = records.get(key) ?? { entityType: event.entityType, entityId: event.entityId, label: event.entityLabel ?? '', count: 0, sample: event };
      record.count++;
      records.set(key, record);
    }
  }
  const times = events.map((event) => new Date(event.at).getTime()).filter((time) => !Number.isNaN(time));
  const short = (time: number) => new Intl.DateTimeFormat('nl-BE', { day: 'numeric', month: 'short' }).format(new Date(time)).replace('.', '');
  const span = times.length ? (short(Math.min(...times)) === short(Math.max(...times))
    ? short(Math.max(...times))
    : `${new Date(Math.min(...times)).getDate()} tot ${short(Math.max(...times))}`) : '';
  const sorted = <T extends { count: number }>(list: T[]) => list.sort((a, b) => b.count - a.count);
  return {
    total: events.length,
    span,
    people: sorted([...people].map(([name, value]) => ({ name, count: value }))),
    categories: sorted([...categories].map(([category, value]) => ({ category, count: value }))),
    records: sorted([...records.values()]).slice(0, 3),
  };
}

/** How many of these events happened today. */
export function todayEvents(events: readonly Pick<ActivityEvent, 'at'>[], now: Date = new Date()): number {
  const today = dayKey(now);
  return events.filter((event) => { const at = new Date(event.at); return !Number.isNaN(at.getTime()) && dayKey(at) === today; }).length;
}

/* ------------------------------------------------- names behind the ids */

/** How long the container and supplier names stay fresh before a Logboek or overview refresh reads them again. */
export const NAMES_MAX_AGE_MS = 10 * 60_000;
/** A purchase order the rows name but the lookup lacks (new, or deleted) is looked up again at most this often. */
export const NAMES_MISSING_RETRY_MS = 60_000;

/**
 * Whether the names behind the Logboek's ids should be read (again): the
 * first time, after a failed lookup (a network blip or a cold start must
 * not leave PO numbers for the rest of the visit), when they are old, or
 * when the rows name a purchase order the lookup does not know yet.
 */
export function namesReloadDue(
  state: { inFlight: boolean; failed: boolean; loadedAt: number | null; missing: boolean },
  now: number,
): boolean {
  if (state.inFlight) return false;
  if (state.loadedAt === null || state.failed) return true;
  const age = now - state.loadedAt;
  return age > NAMES_MAX_AGE_MS || (state.missing && age > NAMES_MISSING_RETRY_MS);
}

/** The purchase order ids the events name (their record, not their changes). */
export function purchaseOrderIds(events: readonly ActivityEvent[]): string[] {
  return [...new Set(events.flatMap((event) =>
    event.entityType.trim().toUpperCase() === 'PURCHASE_ORDER' && event.entityId ? [event.entityId] : []))];
}
