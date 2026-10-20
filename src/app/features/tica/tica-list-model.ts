import type { TicaSale, TicaSettlement, TicaStatus } from '../../core/api/tica-api';

/*
 * TICA verkopen on the list recipe (Inkoop/Verkoop, 2026-10-20): the pure
 * part of the screen. Sales lines grouped per Brussels day with their sums,
 * the search, the period presets and words, the import state as one line,
 * and the settlements' status, groups and sums.
 *
 * Pure and node-tested: type imports only.
 */

export type TicaTab = 'verkopen' | 'afrekeningen';
export type TicaPreset = 'today' | 'week' | 'month' | 'prev';
export type SettlementGroup = 'boeken' | 'ontvangen' | 'betaald';
export type SettlementFilter = SettlementGroup | 'all';
export type Tone = 'ok' | 'warn' | 'danger' | 'blue' | 'amber' | 'grey';

const MONTHS_LONG = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
const MONTHS_SHORT = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const WEEKDAYS_SHORT = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
const DAY_MS = 86_400_000;

const money = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;
const cents = (value: number): number => Math.round((value + Number.EPSILON) * 100);
const utc = (iso: string): number => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const isoOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const plusDays = (iso: string, days: number): string => isoOf(utc(iso) + days * DAY_MS);

/* ------------------------------------------------------------ words */

/** Lower case without accents: 'Crème' matches 'creme'. */
export function foldWords(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('nl');
}

/** Every word of the query occurs somewhere in the text (accents folded); an empty query matches. */
export function matchesWords(text: string, query: string): boolean {
  const words = foldWords(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = foldWords(text);
  return words.every((word) => hay.includes(word));
}

/** 'di 20 okt', with the year when it is not today's year. */
export function dayText(iso: string, today: string): string {
  const day = new Date(utc(iso));
  const base = `${WEEKDAYS_SHORT[day.getUTCDay()]} ${day.getUTCDate()} ${MONTHS_SHORT[day.getUTCMonth()]}`;
  return iso.slice(0, 4) === today.slice(0, 4) ? base : `${base} ${iso.slice(0, 4)}`;
}

/** 'Vandaag', 'Gisteren', else 'di 20 okt'. */
export function dayHead(iso: string, today: string): string {
  if (iso === today) return 'Vandaag';
  if (iso === plusDays(today, -1)) return 'Gisteren';
  return dayText(iso, today);
}

/** '14:05' of the portal's wall-clock time (already Brussels). */
export function saleTime(soldAt: string): string {
  return /T\d{2}:\d{2}/.test(soldAt) ? soldAt.slice(11, 16) : '';
}

/* ------------------------------------------------------------ periods */

/** The period of a preset; 'prev' is the whole previous month. */
export function presetPeriod(preset: TicaPreset, today: string): { from: string; to: string } {
  if (preset === 'today') return { from: today, to: today };
  if (preset === 'week') return { from: plusDays(today, -6), to: today };
  const monthStart = `${today.slice(0, 7)}-01`;
  if (preset === 'month') return { from: monthStart, to: today };
  const prevEnd = plusDays(monthStart, -1);
  return { from: `${prevEnd.slice(0, 7)}-01`, to: prevEnd };
}

export const PRESETS: readonly { id: TicaPreset; label: string }[] = [
  { id: 'today', label: 'Vandaag' }, { id: 'week', label: '7 dagen' }, { id: 'month', label: 'Deze maand' }, { id: 'prev', label: 'Vorige maand' },
];

/** The preset a period is, or null for a chosen one. */
export function presetOf(from: string, to: string, today: string): TicaPreset | null {
  return PRESETS.find((preset) => {
    const period = presetPeriod(preset.id, today);
    return period.from === from && period.to === to;
  })?.id ?? null;
}

/** 'Vandaag', '7 dagen', 'oktober', 'september 2025', '12–18 okt', '28 sep – 4 okt'. */
export function periodText(from: string, to: string, today: string): string {
  const preset = presetOf(from, to, today);
  if (preset === 'today' || preset === 'week') return PRESETS.find((row) => row.id === preset)!.label;
  const year = (iso: string): string => (iso.slice(0, 4) === today.slice(0, 4) ? '' : ` ${iso.slice(0, 4)}`);
  const [fromMonth, toMonth] = [Number(from.slice(5, 7)) - 1, Number(to.slice(5, 7)) - 1];
  const [fromDay, toDay] = [Number(from.slice(8, 10)), Number(to.slice(8, 10))];
  if (from === to) return dayText(from, today);
  if (from.slice(0, 7) === to.slice(0, 7)) {
    const wholeMonth = fromDay === 1 && (plusDays(to, 1).slice(8, 10) === '01' || to === today);
    return wholeMonth ? `${MONTHS_LONG[fromMonth]}${year(from)}` : `${fromDay}–${toDay} ${MONTHS_SHORT[toMonth]}${year(to)}`;
  }
  return `${fromDay} ${MONTHS_SHORT[fromMonth]}${from.slice(0, 4) === to.slice(0, 4) ? '' : year(from)} – ${toDay} ${MONTHS_SHORT[toMonth]}${year(to)}`;
}

/* ------------------------------------------------------------ sales */

export interface SalesTotals { lines: number; transactions: number; pieces: number; netEur: number; grossEur: number; discountEur: number; unmatched: number }

const transactionKey = (line: Pick<TicaSale, 'exhibitor' | 'location' | 'transactionNumber'>): string =>
  `${line.exhibitor}|${line.location}|${line.transactionNumber}`;

/** Sums of lines: distinct receipts, pieces, revenue after and before discount, lines without an ERP product. */
export function salesTotals(lines: readonly TicaSale[]): SalesTotals {
  const net = lines.reduce((sum, line) => sum + cents(line.netTotal), 0);
  const gross = lines.reduce((sum, line) => sum + cents(line.grossTotal), 0);
  return {
    lines: lines.length, transactions: new Set(lines.map(transactionKey)).size,
    pieces: lines.reduce((sum, line) => sum + line.quantity, 0),
    netEur: net / 100, grossEur: gross / 100, discountEur: Math.max(0, gross - net) / 100,
    unmatched: lines.filter((line) => line.productId === null || line.mappingStatus !== 'MATCHED').length,
  };
}

export const unmatched = (line: TicaSale): boolean => line.productId === null || line.mappingStatus !== 'MATCHED';

/** The search: article, codes, receipt number and location. */
export function saleMatches(line: TicaSale, query: string): boolean {
  return matchesWords([line.description, line.sku, line.beeyondArticleNumber, line.barcode, line.transactionNumber, line.location].filter(Boolean).join(' '), query);
}

export interface DayGroup { date: string; lines: TicaSale[]; totals: SalesTotals }

/** Lines per Brussels day, newest day first and newest line first inside it. */
export function dayGroups(lines: readonly TicaSale[]): DayGroup[] {
  const days = new Map<string, TicaSale[]>();
  for (const line of [...lines].sort((a, b) => b.soldAt.localeCompare(a.soldAt) || b.id - a.id)) {
    const date = line.soldAt.slice(0, 10);
    days.set(date, [...(days.get(date) ?? []), line]);
  }
  return [...days].map(([date, rows]) => ({ date, lines: rows, totals: salesTotals(rows) }));
}

/** '−10 %' for a line with a discount; '' without one. */
export function discountText(line: Pick<TicaSale, 'discountPercent' | 'grossTotal' | 'netTotal'>): string {
  if (line.discountPercent > 0) return `−${String(Math.round(line.discountPercent * 10) / 10).replace('.', ',')} %`;
  return cents(line.grossTotal) > cents(line.netTotal) ? 'korting' : '';
}

/* ------------------------------------------------------------ import state */

export interface SyncLine { text: string; tone: 'ok' | 'busy' | 'warn' | 'muted'; title: string }

function brussels(instant: Date): { day: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instant);
  const part = (type: string): string => parts.find((row) => row.type === type)?.value ?? '';
  return { day: `${part('year')}-${part('month')}-${part('day')}`, time: `${part('hour')}:${part('minute')}` };
}

/** 'om 14:05' today, else 'op 19 okt'. */
function when(value: string | null, now: Date): string | null {
  const at = value ? new Date(value) : null;
  if (!at || !Number.isFinite(at.getTime())) return null;
  const local = brussels(at);
  return local.day === brussels(now).day ? `om ${local.time}` : `op ${Number(local.day.slice(8, 10))} ${MONTHS_SHORT[Number(local.day.slice(5, 7)) - 1]}`;
}

/** The import state in a few words for the toolbar pill (desk) or the caption (phone); the title holds the rest. */
export function syncLine(status: TicaStatus | null, failed: boolean, now: Date): SyncLine {
  if (!status) return failed ? { text: 'Status niet beschikbaar', tone: 'warn', title: 'De importstatus kon niet worden geladen.' }
    : { text: 'Status ophalen…', tone: 'muted', title: '' };
  const last = when(status.lastSuccessAt, now);
  const title = last ? `Laatste geslaagde import ${last}` : 'Nog geen geslaagde import';
  switch (status.syncState) {
    case 'RUNNING': case 'PENDING': return { text: 'Ophalen…', tone: 'busy', title };
    case 'ERROR': return { text: 'Ophalen mislukt', tone: 'warn', title: [status.lastError, title].filter(Boolean).join(' · ') };
    case 'DISABLED': return { text: 'Ophalen staat uit', tone: 'warn', title };
    case 'NOT_CONFIGURED': return { text: 'Verbinding instellen', tone: 'warn', title };
    case 'NEVER_SYNCED': return { text: 'Nog niet opgehaald', tone: 'muted', title };
    default: return { text: last ? `Bijgewerkt ${last.replace(/^(om|op) /, '')}` : 'Bijgewerkt', tone: 'ok', title };
  }
}

/* ------------------------------------------------------------ settlements */

export function settlementGroupOf(row: Pick<TicaSettlement, 'status'>): SettlementGroup {
  return row.status === 'DRAFT' ? 'boeken' : row.status === 'OPEN' ? 'ontvangen' : 'betaald';
}

export const SETTLEMENT_GROUPS: readonly { id: SettlementGroup; label: string }[] = [
  { id: 'boeken', label: 'Te boeken' }, { id: 'ontvangen', label: 'Te ontvangen' }, { id: 'betaald', label: 'Ontvangen' },
];

/** The status pill: an imported draft is 'Te controleren', a manual one 'Concept'. */
export function settlementStatus(row: Pick<TicaSettlement, 'status' | 'sourceKey'>): { label: string; tone: Tone } {
  if (row.status === 'DRAFT') return row.sourceKey ? { label: 'Te controleren', tone: 'amber' } : { label: 'Concept', tone: 'grey' };
  return row.status === 'OPEN' ? { label: 'Te ontvangen', tone: 'blue' } : { label: 'Ontvangen', tone: 'ok' };
}

const euroText = (value: number): string =>
  `€ ${Math.abs(value).toLocaleString('nl-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const shortDay = (iso: string): string => `${Number(iso.slice(8, 10))} ${MONTHS_SHORT[Number(iso.slice(5, 7)) - 1]}`;

/**
 * What a settlement still needs, in a few words: a draft names what blocks booking (the source document first, then
 * the revenue check, then the amounts) or says it is ready; an open one its expected day; a paid one its day.
 */
export function settlementNote(row: TicaSettlement, ready: boolean, today: string): { text: string; tone: Tone | null } | null {
  if (row.status === 'DRAFT') {
    if (!row.sourceDocumentUrl?.trim()) return { text: 'Broncreditnota ontbreekt', tone: 'warn' };
    if (Math.abs(row.reconciliationDifference) > 0.020001) return { text: `Omzet wijkt ${euroText(row.reconciliationDifference)} af`, tone: 'warn' };
    return ready ? { text: 'Klaar om te boeken', tone: 'ok' } : { text: 'Bedragen sluiten niet aan', tone: 'warn' };
  }
  if (row.status === 'OPEN') return row.dueDate ? { text: `verwacht ${shortDay(row.dueDate)}`, tone: row.dueDate < today ? 'warn' : null } : null;
  return row.paidAt ? { text: `ontvangen ${shortDay(brussels(new Date(row.paidAt)).day)}`, tone: null } : null;
}

/** 'september 2026' for a whole month, '1–15 sep 2026', '28 sep – 4 okt 2026'. */
export function settlementPeriod(from: string, to: string): string {
  const [fromMonth, toMonth] = [Number(from.slice(5, 7)) - 1, Number(to.slice(5, 7)) - 1];
  const [fromDay, toDay] = [Number(from.slice(8, 10)), Number(to.slice(8, 10))];
  if (from.slice(0, 7) === to.slice(0, 7)) {
    return fromDay === 1 && plusDays(to, 1).slice(8, 10) === '01' ? `${MONTHS_LONG[fromMonth]} ${to.slice(0, 4)}`
      : `${fromDay}–${toDay} ${MONTHS_SHORT[toMonth]} ${to.slice(0, 4)}`;
  }
  return `${fromDay} ${MONTHS_SHORT[fromMonth]} – ${toDay} ${MONTHS_SHORT[toMonth]} ${to.slice(0, 4)}`;
}

export function settlementMatches(row: TicaSettlement, query: string): boolean {
  return matchesWords([row.reference, row.location, settlementPeriod(row.periodFrom, row.periodTo), row.documentNote ?? ''].join(' '), query);
}

export interface SettlementSums { openEur: number; paidEur: number; commissionEur: number; draftCount: number }

/** Te ontvangen and ontvangen (incl. btw) and the booked commission (excl. btw), as the old metrics. */
export function settlementSums(rows: readonly TicaSettlement[]): SettlementSums {
  const sum = (filter: (row: TicaSettlement) => boolean, value: (row: TicaSettlement) => number): number =>
    rows.filter(filter).reduce((total, row) => total + cents(value(row)), 0) / 100;
  return {
    openEur: sum((row) => row.status === 'OPEN', (row) => row.netReceivable),
    paidEur: sum((row) => row.status === 'PAID', (row) => row.netReceivable),
    commissionEur: sum((row) => row.status !== 'DRAFT', (row) => row.commissionExcl),
    draftCount: rows.filter((row) => row.status === 'DRAFT').length,
  };
}

export interface SettlementSection { id: SettlementGroup; label: string; rows: TicaSettlement[]; netEur: number }

/** The groups in working order (Te boeken, Te ontvangen, Ontvangen), newest document first; empty groups left out. */
export function settlementSections(rows: readonly TicaSettlement[], query: string, filter: SettlementFilter): SettlementSection[] {
  const shown = rows.filter((row) => (filter === 'all' || settlementGroupOf(row) === filter) && settlementMatches(row, query))
    .sort((a, b) => b.documentDate.localeCompare(a.documentDate) || b.id - a.id);
  return SETTLEMENT_GROUPS.map((group) => {
    const members = shown.filter((row) => settlementGroupOf(row) === group.id);
    return { id: group.id, label: group.label, rows: members, netEur: money(members.reduce((sum, row) => sum + row.netReceivable, 0)) };
  }).filter((section) => section.rows.length > 0);
}

/** Per group how many settlements there are (the chips' counts, following the search). */
export function settlementCounts(rows: readonly TicaSettlement[], query: string): Record<SettlementGroup, number> {
  const counts: Record<SettlementGroup, number> = { boeken: 0, ontvangen: 0, betaald: 0 };
  for (const row of rows) if (settlementMatches(row, query)) counts[settlementGroupOf(row)]++;
  return counts;
}
