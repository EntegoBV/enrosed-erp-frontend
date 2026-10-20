/*
 * The Verkoop list on the Inkoop recipe (2026-10-19): what a row, a customer
 * group and the subbar say beyond the document itself. The money reads the
 * receivable the component hands in (finance's invoiceReceivable), so the
 * list never disagrees with Kosten & bank. Pure and node-tested: type-only
 * imports.
 */
import type { SalesOrder, SalesOrderView } from '../../core/api/models';
import type { SalesContainerGroup, SalesContainerStatus, SalesListEntry, SalesSplitGroup } from './sales-list-groups';

export type SalesTab = 'OFFERTE' | 'FACTUUR' | 'ARCHIEF';
export type SalesScope = 'STANDARD' | 'PARTNER' | 'ALL';
/** Within Facturen: everything, only invoices, or only credit notes. */
export type SalesDocsFilter = 'all' | 'f' | 'cn';

/** What finance knows of a document's money (invoiceReceivable): the list reads only these. */
export interface ListReceivable { receivedEur: number; remainingEur: number; creditEur: number }

/** Statuses that take a document out of every sum; CONCEPT is not issued yet. */
const CLOSED = new Set(['GEANNULEERD', 'AFGEWEZEN', 'VERLOPEN']);

const cents = (value: number | null | undefined): number => Math.round((Number.isFinite(value) ? value as number : 0) * 100);

function docTypeOf(order: Pick<SalesOrder, 'docType'>): string {
  return order.docType ?? 'OFFERTE';
}

function day(value: string | null | undefined): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? '');
  return match ? `${match[3]}/${match[2]}/${match[1]}` : null;
}

/** '1 offerte', '3 offertes'. */
export function countText(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Euros as the eur pipe writes them ('€ 2.480,15'). */
export function euro(value: number, decimals = 2): string {
  return new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR', maximumFractionDigits: decimals, minimumFractionDigits: decimals })
    .format(Number.isFinite(value) ? value : 0);
}

/** Whole euros, the way the subbar and the captions read ('€ 2.480'). */
export function wholeEuro(value: number): string {
  return euro(value, 0);
}

/**
 * An amount on a phone trail: whole euros, as Inkoop's trails and the
 * document totals read; under one euro it keeps its cents, so a small rest
 * never reads '€ 0 open'.
 */
export function trailEuro(value: number): string {
  const amount = cents(value);
  return euro(amount / 100, amount !== 0 && Math.abs(amount) < 100 ? 2 : 0);
}

/** The trail gave up cents on this amount: the exact figure belongs in the menu's hint. */
export function roundedAway(value: number): boolean {
  const amount = cents(value);
  return Math.abs(amount) >= 100 && amount % 100 !== 0;
}

/** Lowercase without accents: 'Café' finds 'cafe'. */
export function foldText(value: string | null | undefined): string {
  return (value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('nl-BE').trim();
}

/** The search: every word of the query must occur in the document's text (customer, numbers, container). */
export function matchesWords(haystack: string, query: string): boolean {
  const words = foldText(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = foldText(haystack);
  return words.every((word) => text.includes(word));
}

/** An issued invoice past its due date (today is 'YYYY-MM-DD'). */
export function invoiceOverdue(order: Pick<SalesOrder, 'docType' | 'status' | 'invoiceDueDate'>, today: string): boolean {
  return docTypeOf(order) === 'FACTUUR' && (order.status === 'VERZONDEN' || order.status === 'UITGEREIKT')
    && !!order.invoiceDueDate && order.invoiceDueDate < today;
}

/**
 * What a set of documents still holds. open: to receive on issued invoices;
 * overdue: the part of it past the due date; tegoed: open credit on issued
 * credit notes; offer: live offers not invoiced yet, excl. btw.
 */
export interface ListMoney {
  openEur: number;
  overdueEur: number;
  overdueCount: number;
  tegoedEur: number;
  offerEur: number;
}

export function listMoney(rows: readonly SalesOrderView[], receivableOf: (row: SalesOrderView) => ListReceivable, today: string): ListMoney {
  let open = 0, overdue = 0, overdueCount = 0, tegoed = 0, offer = 0;
  for (const row of rows) {
    const order = row.order;
    const type = docTypeOf(order);
    if (CLOSED.has(order.status)) continue;
    if (type === 'OFFERTE') {
      if (!row.invoicedAsId && !row.invoicedAs) offer += cents(row.priced?.totals?.total);
      continue;
    }
    if (order.status === 'CONCEPT') continue;
    const money = receivableOf(row);
    if (type === 'CREDITNOTA') { tegoed += cents(money.creditEur); continue; }
    const remaining = cents(money.remainingEur);
    open += remaining;
    if (remaining > 0 && invoiceOverdue(order, today)) { overdue += remaining; overdueCount++; }
  }
  return { openEur: open / 100, overdueEur: overdue / 100, overdueCount, tegoedEur: tegoed / 100, offerEur: offer / 100 };
}

/** One block per customer: its entries in list order (newest first), how many documents and what it still owes. */
export interface SalesCustomerSection {
  /** The customer id; 0 for documents without one. Also the fold key. */
  id: number;
  name: string;
  entries: SalesListEntry[];
  /** Documents in the block, the members of a partner container or split order included. */
  count: number;
  money: ListMoney;
}

/** The documents an entry stands for. */
export function entryRows(entry: SalesListEntry): readonly SalesOrderView[] {
  return entry.kind === 'DOCUMENT' ? [entry.row] : entry.rows;
}

/** Whose entry it is: both group kinds are already keyed per customer (sales-list-groups). */
export function entryCustomerId(entry: SalesListEntry): number | null {
  if (entry.kind === 'PARTNER_CONTAINER') return entry.customerId;
  return entryRows(entry)[0]?.order.customerId ?? null;
}

/** Call on the grouped, filtered list: the customer whose newest document comes first leads. */
export function customerSections(entries: readonly SalesListEntry[], nameOf: (customerId: number | null) => string,
  receivableOf: (row: SalesOrderView) => ListReceivable, today: string): SalesCustomerSection[] {
  const sections = new Map<number, SalesCustomerSection>();
  for (const entry of entries) {
    const customerId = entryCustomerId(entry);
    const id = customerId ?? 0;
    let section = sections.get(id);
    if (!section) {
      section = { id, name: nameOf(customerId), entries: [], count: 0, money: listMoney([], receivableOf, today) };
      sections.set(id, section);
    }
    section.entries.push(entry);
  }
  for (const section of sections.values()) {
    const rows = section.entries.flatMap((entry) => entryRows(entry));
    section.count = rows.length;
    section.money = listMoney(rows, receivableOf, today);
  }
  return [...sections.values()];
}

/** A status class of quote-status (statusOf, the web and delivery pills) as a kit tone. */
export function salesTone(cls: string | null | undefined): string {
  switch (cls) {
    case 'ok': return 'tone-ok';
    case 'danger': return 'tone-danger';
    case 'gold': return 'tone-amber';
    case 'rose': return 'tone-accent';
    case 'blue': return 'tone-blue';
    case 'warn': return 'tone-warn';
    case 'credit': return 'tone-plum';
    default: return 'tone-grey';
  }
}

/** One fact on the line under the status pill; cls is a status class ('' = plain muted text). */
export interface LinePart { text: string; cls: string }

/** What the status line knows of a row; the component reads it from the row and the quote-status helpers. */
export interface StatusFacts {
  order: Pick<SalesOrder, 'docType' | 'status' | 'validUntil' | 'invoiceDueDate'>;
  /** A quote that has its invoice. */
  invoiced: boolean;
  remainingEur: number;
  overdue: boolean;
  webOrder: boolean;
  /** webOrderListPill: where a website order stands between the customer and us. */
  webPill: { label: string; cls: string } | null;
  websiteRequest: boolean;
  /** fulfillmentStatusOf with its part: 'Deel 2 · Wacht op voorraad'. */
  delivery: { part: number | null; label: string; cls: string } | null;
  /** Shipped without a split delivery. */
  shipped: boolean;
  unavailable: number;
}

/**
 * The status line: 'geldig tot' on a sent offer, 'vervalt' on an issued
 * invoice with money open (danger once past), the website facts, the
 * delivery and what is not available.
 */
export function statusParts(facts: StatusFacts): LinePart[] {
  const parts: LinePart[] = [];
  const { order } = facts;
  const type = docTypeOf(order);
  const valid = day(order.validUntil);
  if (type === 'OFFERTE' && !facts.invoiced && (order.status === 'VERZONDEN' || order.status === 'BEKEKEN') && valid) {
    parts.push({ text: `geldig tot ${valid}`, cls: '' });
  }
  const due = day(order.invoiceDueDate);
  if (type === 'FACTUUR' && due && facts.remainingEur > 0 && ['VERZONDEN', 'UITGEREIKT', 'BEKEKEN'].includes(order.status)) {
    parts.push({ text: `vervalt ${due}`, cls: facts.overdue ? 'danger' : '' });
  }
  if (facts.webOrder) {
    parts.push({ text: 'Websitebestelling', cls: '' });
    if (facts.webPill) parts.push({ text: facts.webPill.label, cls: facts.webPill.cls });
  } else if (facts.websiteRequest) {
    parts.push({ text: 'Websiteaanvraag', cls: '' });
  }
  if (facts.delivery) parts.push({ text: `${facts.delivery.part ? `Deel ${facts.delivery.part} · ` : ''}${facts.delivery.label}`, cls: facts.delivery.cls });
  if (facts.shipped) parts.push({ text: 'Bestelling verzonden', cls: 'ok' });
  if (facts.unavailable > 0) parts.push({ text: `${countText(facts.unavailable, 'product', 'producten')} niet beschikbaar`, cls: 'gold' });
  return parts;
}

/**
 * A row's Betaling cell. none: no money (an offer, a cancelled invoice);
 * concept: not issued yet; open: something to receive; settled: nothing
 * open; credit: a credit note (its own tegoed line).
 */
export interface PaymentCell {
  state: 'none' | 'concept' | 'open' | 'settled' | 'credit';
  openEur: number;
  receivedEur: number;
  overdue: boolean;
}

export function paymentCell(order: Pick<SalesOrder, 'docType' | 'status'>, money: Pick<ListReceivable, 'receivedEur' | 'remainingEur'>, overdue: boolean): PaymentCell {
  const type = docTypeOf(order);
  const none = (state: PaymentCell['state']): PaymentCell => ({ state, openEur: 0, receivedEur: 0, overdue: false });
  if (type === 'OFFERTE') return none('none');
  if (order.status === 'CONCEPT') return none('concept');
  if (type === 'CREDITNOTA') return none('credit');
  if (CLOSED.has(order.status)) return none('none');
  const openEur = cents(money.remainingEur) / 100, receivedEur = cents(money.receivedEur) / 100;
  return openEur > 0 ? { state: 'open', openEur, receivedEur, overdue } : { state: 'settled', openEur: 0, receivedEur, overdue: false };
}

/** A status-line part that names a day: the phone shows it on the trail, not on the facts line. */
const DAY_FACT = /^(geldig tot|vervalt) /;

/**
 * The phone row. facts: the website and delivery facts, the muted line under
 * the number. trail: the third trailing line, '€ x open' (warn once overdue),
 * else '€ x tegoed' while a credit note still holds one (its pill says the
 * rest: never 'verrekend · afgehandeld' beside 'Afgehandeld'), else the day
 * of 'geldig tot' / 'vervalt'; amounts in trail euros. unshown: the day the
 * trail gives up for the open amount, for the menu's Openen hint.
 */
export interface PhoneLines {
  facts: LinePart[];
  trail: { kind: 'open' | 'credit' | 'day' | 'none'; text: string; overdue: boolean };
  unshown: string | null;
}

/** tegoedEur: what a credit note still holds (null on any other document). */
export function phoneLines(parts: readonly LinePart[], pay: Pick<PaymentCell, 'state' | 'overdue' | 'openEur'>, tegoedEur: number | null): PhoneLines {
  const facts = parts.filter((part) => !DAY_FACT.test(part.text));
  const dated = parts.find((part) => DAY_FACT.test(part.text)) ?? null;
  if (pay.state === 'open') return { facts, trail: { kind: 'open', text: `${trailEuro(pay.openEur)} open`, overdue: pay.overdue }, unshown: dated?.text ?? null };
  if (pay.state === 'credit' && cents(tegoedEur) > 0) {
    return { facts, trail: { kind: 'credit', text: `${trailEuro(tegoedEur!)} tegoed`, overdue: false }, unshown: dated?.text ?? null };
  }
  return { facts, trail: dated ? { kind: 'day', text: dated.text, overdue: dated.cls === 'danger' } : { kind: 'none', text: '', overdue: false }, unshown: null };
}

/* ---- the phone's partner-container and split-order heads (2026-10-20) ------------------------------------------ */

/** Member pills that leave nothing to do with the money. */
const SETTLED = new Set(['Betaald', 'Afgehandeld', 'Gecrediteerd']);

/**
 * A head cell with a document's anatomy. sub: 'Partnercontainer · 2 facturen'
 * or 'Gesplitste order · 2 delen'; total: trail euros, signed; status: the one
 * thing beside it, what is open or one pill; attention: the amber line, how
 * many members wait on us and the first reason.
 */
export interface PhoneHead {
  sub: string;
  total: string;
  /** open: text '€ x open', warn once overdue; pill: text is the label, cls its status class. */
  status: { kind: 'open' | 'pill'; text: string; cls: string; overdue: boolean } | null;
  attention: { count: number; first: string } | null;
}

/** '− € 991' for a negative sum, as a credit note's total reads. */
function signedTrail(value: number): string {
  return cents(value) < 0 ? `− ${trailEuro(-value)}` : trailEuro(value);
}

function headAttention(rows: readonly SalesOrderView[], reasonsOf: (row: SalesOrderView) => readonly string[]): PhoneHead['attention'] {
  const waiting = rows.map(reasonsOf).filter((reasons) => reasons.length > 0);
  return waiting.length ? { count: waiting.length, first: waiting[0][0] } : null;
}

/**
 * The members in one pill: all settled with something paid 'Betaald', any
 * concept 'Concept', else the most frequent status; a tie goes to what still
 * asks for something, then to list order. Cancelled members count only when
 * nothing else is left.
 */
export function containerPill(statuses: readonly SalesContainerStatus[]): { label: string; cls: string } | null {
  const live = statuses.filter((status) => !status.inactive);
  const pool = live.length ? live : statuses;
  if (!pool.length) return null;
  if (pool.every((status) => SETTLED.has(status.label)) && pool.some((status) => status.label === 'Betaald')) return { label: 'Betaald', cls: 'ok' };
  const concept = pool.find((status) => status.concept);
  if (concept) return { label: concept.label, cls: concept.cls };
  const best = pool.reduce((lead, status) => status.count > lead.count
    || (status.count === lead.count && SETTLED.has(lead.label) && !SETTLED.has(status.label)) ? status : lead);
  return { label: best.label, cls: best.cls };
}

/** A partner container's head: '€ x open' while its invoices hold money, else one pill for its members. */
export function containerHead(entry: SalesContainerGroup, receivableOf: (row: SalesOrderView) => ListReceivable, today: string,
  reasonsOf: (row: SalesOrderView) => readonly string[]): PhoneHead {
  const money = listMoney(entry.rows, receivableOf, today);
  const credits = entry.rows.some((row) => row.order.docType === 'CREDITNOTA');
  const pill = containerPill(entry.summary.statuses);
  return {
    sub: `Partnercontainer · ${credits ? countText(entry.rows.length, 'document', 'documenten') : countText(entry.rows.length, 'factuur', 'facturen')}`,
    total: signedTrail(entry.summary.totalEur),
    status: money.openEur > 0 ? { kind: 'open', text: `${trailEuro(money.openEur)} open`, cls: '', overdue: money.overdueCount > 0 }
      : pill ? { kind: 'pill', text: pill.label, cls: pill.cls, overdue: false } : null,
    attention: headAttention(entry.rows, reasonsOf),
  };
}

/** A split order's head: its delivery in one pill, the first that applies in the desk head's order. */
export function splitHead(entry: SalesSplitGroup, reasonsOf: (row: SalesOrderView) => readonly string[]): PhoneHead {
  const { parts, unavailableCount, waitingCount, shippedCount, pieces } = entry.summary;
  const pill = unavailableCount ? { text: `${unavailableCount} niet beschikbaar`, cls: 'gold' }
    : waitingCount ? { text: 'Wacht op voorraad', cls: 'gold' }
    : shippedCount ? { text: shippedCount >= parts ? 'Verzonden' : 'Deels verzonden', cls: 'ok' }
    : pieces > 0 ? { text: 'Leveringen gepland', cls: 'blue' } : null;
  return {
    sub: `Gesplitste order · ${parts === 2 ? '2 delen' : `${parts} van 2 delen`}`,
    total: signedTrail(entry.summary.totalEur),
    status: pill ? { kind: 'pill', ...pill, overdue: false } : null,
    attention: headAttention(entry.rows, reasonsOf),
  };
}

/**
 * What the phone head leaves to the container menu's head: the exact total
 * when the trail rounded it and what of it is concept, the members per
 * status when they differ, the pieces in the container, the money in and
 * the open credit (incl. btw). Nothing the head already says.
 */
export function containerHint(entry: SalesContainerGroup): string[] {
  const summary = entry.summary;
  const facts: string[] = [];
  const total = roundedAway(summary.totalEur) ? `${euro(summary.totalEur)} excl. btw` : '';
  const draft = summary.draftCount && summary.issuedCount ? `waarvan concept ${euro(summary.draftEur)}` : '';
  if (total || draft) facts.push(total && draft ? `${total}, ${draft}` : total || draft);
  if (summary.statuses.length > 1) {
    facts.push(summary.statuses.map((status) => `${status.count} ${status.label.toLocaleLowerCase('nl-BE')}${status.inactive ? ' (buiten totaal)' : ''}`).join(', '));
  }
  if (summary.containerPieces !== null) facts.push(`${new Intl.NumberFormat('nl-BE').format(summary.containerPieces)} stuks in container`);
  const money = [roundedAway(summary.remainingEur) ? `${euro(summary.remainingEur)} open` : '',
    summary.receivedEur > 0 ? `${euro(summary.receivedEur)} ontvangen` : '', summary.creditEur > 0 ? `${euro(summary.creditEur)} tegoed` : ''].filter(Boolean);
  if (money.length) facts.push(...money, 'incl. btw');
  return facts;
}

/**
 * The Document column's sub: 'Verkoopfactuur · 18/10/2026 · uit ENR-2026-0041'.
 * The linked documents are text here; the row menu opens them (no link inside the row link).
 */
export function documentSub(parts: { kind: string; date: string | null | undefined; sourceQuote?: string | null; invoicedAs?: string | null;
  creditedInvoice?: string | null; creditReason?: string | null }): string {
  return [
    parts.kind, day(parts.date),
    parts.sourceQuote ? `uit ${parts.sourceQuote}` : null,
    parts.invoicedAs ? `factuur ${parts.invoicedAs}` : null,
    parts.creditedInvoice ? `op ${parts.creditedInvoice}` : null,
    parts.creditedInvoice && parts.creditReason ? parts.creditReason : null,
  ].filter(Boolean).join(' · ');
}

/**
 * The phone's large-title caption: the tab's count, on Facturen with what
 * is still to receive; with a search or a filter, what shows of how many.
 */
export function listCaption(tab: SalesTab, shown: number, pile: number, narrowed: boolean, openEur: number): string {
  if (narrowed) return `${shown} van ${pile}${openEur > 0 ? ` · ${wholeEuro(openEur)} open` : ''}`;
  if (tab === 'OFFERTE') return countText(pile, 'offerte', 'offertes');
  if (tab === 'ARCHIEF') return `${pile} in het archief`;
  return countText(pile, 'factuur', 'facturen') + (openEur > 0 ? ` · ${wholeEuro(openEur)} te ontvangen` : '');
}
