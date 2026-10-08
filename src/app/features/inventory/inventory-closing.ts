import type {
  ClosingArticle, ClosingArticleLocation, ClosingContainer, ClosingLayer, ClosingStream, ClosingSummary, ClosingTotals,
  ClosingView, DecisionKind, DecisionWrite, Notice, NoticeSegment, WriteDownRow,
} from '../../core/api/inventory-models';

/**
 * The rules behind the closing screens, without Angular.
 *
 * The server computes every figure of a closing; this module only decides
 * what the screens say about them (step states, texts, defaults) and builds
 * the decision payloads. The one calculation is the preview of a
 * waardevermindering, in whole cents with the server's rule. Pure and
 * type-imports only, so node tests it directly.
 */

const LOCALE = 'nl-BE';
const ZONE = 'Europe/Brussels';

const whole = (value: number) => value.toLocaleString(LOCALE);
const signed = (value: number) => (value > 0 ? `+${whole(value)}` : value < 0 ? `-${whole(-value)}` : '0');
const cents = (eur: number) => Math.round(eur * 100);
const trimmed = (text: string | null | undefined) => text?.trim() || null;

/** 31/12/2026 for a date, and for an instant its Brussels day. */
function dateText(value: string): string {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (day) return `${day[3]}/${day[2]}/${day[1]}`;
  const at = new Date(value);
  if (isNaN(at.getTime())) return value;
  return new Intl.DateTimeFormat(LOCALE, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: ZONE }).format(at);
}

/** The calendar day before or after a yyyy-MM-dd date. */
function shiftDay(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/* ---- steps and notices ---- */

export type StepState = 'TODO' | 'BEZIG' | 'KLAAR';

export interface ClosingStep {
  key: NoticeSegment;
  /** The name alone: "Tellen". */
  label: string;
  state: StepState;
  /** The numbered line of the step bar with its counter: "1 Tellen · 2 van 3 locaties geboekt". */
  line: string;
}

/** The decision kinds that count as "something done" in a step. */
const STEP_DECISIONS: Partial<Record<NoticeSegment, readonly DecisionKind[]>> = {
  datum: ['MOVEMENT'],
  waarde: ['ACCRUAL', 'SUPPLIER_BILLED', 'CREDIT_TREATMENT', 'OWNERSHIP_DATE', 'WRITE_DOWN'],
  apart: ['TRANSIT', 'PARTNER_CONTAINER', 'PARTNER_QUANTITY', 'INVOICED', 'THIRD_PARTY'],
};

/** The notices of one step, blockers first. */
export function noticesFor(view: ClosingView, segment: NoticeSegment): Notice[] {
  const own = view.notices.filter((notice) => notice.segment === segment);
  return [...own.filter((notice) => notice.severity === 'BLOCKER'), ...own.filter((notice) => notice.severity !== 'BLOCKER')];
}

const blockerCount = (view: ClosingView, segment: NoticeSegment) =>
  view.notices.filter((notice) => notice.segment === segment && notice.severity === 'BLOCKER').length;

function somethingDone(view: ClosingView, segment: NoticeSegment): boolean {
  if (segment === 'tellen') return view.locations.some((location) => location.anchor === 'TELLING');
  const kinds = STEP_DECISIONS[segment] ?? [];
  if (view.decisions.some((decision) => kinds.includes(decision.kind))) return true;
  return segment === 'waarde'
    && view.articles.some((article) => article.layers.some((layer) => layer.source === 'BEGINWAARDE'));
}

/**
 * The five steps of the step bar. Tellen, datum, waarde and apart are KLAAR
 * without a blocker of their own, BEZIG with a blocker and something done,
 * TODO with a blocker and nothing done. Afsluiten is KLAAR once the closing
 * is final, BEZIG on a concept that no blocker holds back, TODO otherwise.
 */
export function stepStates(view: ClosingView): ClosingStep[] {
  const state = (segment: NoticeSegment): StepState =>
    blockerCount(view, segment) === 0 ? 'KLAAR' : somethingDone(view, segment) ? 'BEZIG' : 'TODO';
  const anchored = view.locations.filter((location) => location.anchor !== 'GEEN');
  const countedLocations = anchored.filter((location) => location.anchor === 'TELLING').length;
  const movements = view.locations.reduce((sum, location) => sum + location.movementCount, 0);
  const reviews = view.locations.reduce((sum, location) => sum + location.reviewCount, 0);
  const unvalued = view.articles.filter((article) => article.status === 'ZONDER_WAARDE').length;
  const valueOpen = blockerCount(view, 'waarde');
  const valueLine = unvalued > 0 ? `3 Waarde · ${whole(unvalued)} producten zonder waarde`
    : valueOpen > 0 ? `3 Waarde · ${whole(valueOpen)} punten open`
    : '3 Waarde';
  const anyBlocker = view.notices.some((notice) => notice.severity === 'BLOCKER');
  const finalState: StepState = view.status === 'DEFINITIEF' ? 'KLAAR' : anyBlocker ? 'TODO' : 'BEZIG';
  return [
    { key: 'tellen', label: 'Tellen', state: state('tellen'),
      line: `1 Tellen · ${whole(countedLocations)} van ${whole(anchored.length)} locaties geboekt` },
    { key: 'datum', label: 'Bewegingen rond de afsluitdatum', state: state('datum'),
      line: `2 Bewegingen rond de afsluitdatum · ${whole(movements)} bewegingen, ${whole(reviews)} na te kijken` },
    { key: 'waarde', label: 'Waarde', state: state('waarde'), line: valueLine },
    { key: 'apart', label: 'Afzonderlijk', state: state('apart'),
      line: `4 Afzonderlijk · ${whole(blockerCount(view, 'apart'))} beslissingen open` },
    { key: 'afsluiten', label: 'Afsluiten', state: finalState, line: '5 Afsluiten' },
  ];
}

export interface StripItem {
  key: 'cost' | 'writeDown' | 'own' | 'separate' | 'total' | 'estimated';
  label: string;
  valueEur: number;
}

/** The six figures of the strip, in screen order. */
export function stripItems(totals: ClosingTotals): StripItem[] {
  return [
    { key: 'cost', label: 'Aanschafwaarde eigen voorraad', valueEur: totals.costValueEur },
    { key: 'writeDown', label: 'Waardeverminderingen', valueEur: totals.writeDownEur },
    { key: 'own', label: 'Eigen voorraad na waardevermindering', valueEur: totals.ownValueEur },
    { key: 'separate', label: 'Partner en onderweg, opgenomen',
      valueEur: (cents(totals.partnerIncludedEur) + cents(totals.transitIncludedEur)) / 100 },
    { key: 'total', label: 'Totaal voorraadwaarde', valueEur: totals.totalValueEur },
    { key: 'estimated', label: 'Waarvan geschat', valueEur: totals.estimatedEur },
  ];
}

/** The MEER_BETAALD or LAGER_AFGEREKEND notice of one payee stream of a container, or null. */
export function streamNotice(view: ClosingView, container: ClosingContainer, stream: ClosingStream): Notice | null {
  return view.notices.find((notice) =>
    (notice.code === 'MEER_BETAALD' || notice.code === 'LAGER_AFGEREKEND')
    && notice.purchaseOrderId === container.purchaseOrderId && notice.payee === stream.payee) ?? null;
}

/* ---- step 2: movements around the closing date ---- */

/** The result line of one product at one location, by that product's own anchor. */
export function rollLine(articleLocation: ClosingArticleLocation, closingDate: string): string {
  const date = dateText(closingDate);
  const start = `Geteld ${whole(articleLocation.anchorQuantity)}, bewegingen`;
  const result = `${signed(articleLocation.rollDelta)} → ${whole(articleLocation.closingQuantity)}`;
  return articleLocation.countAfterClosingDate
    ? `${start} sinds ${date} teruggeteld: ${result} op ${date}`
    : `${start} tot ${date} bijgeteld: ${result}`;
}

/** The intro above the fold "Later geboekt": rows of the 31 days after the later of the two moments. */
export function laterRowsIntro(countAfterClosingDate: boolean, closingDate: string, countDate: string): string {
  const intro = countAfterClosingDate
    ? `Na de telling geboekt. Vink alleen aan wat tussen ${dateText(closingDate)} en de telling van ${dateText(countDate)} al gebeurd was.`
    : `Na de afsluitdatum geboekt. Vink alleen aan wat vóór ${dateText(closingDate)} al gebeurd was.`;
  return `${intro} Een gewone beweging van na die datum laat je uitgevinkt.`;
}

/* ---- step 3: value ---- */

/**
 * What a waardevermindering would do, in whole cents with the server's rule:
 * the pieces come from the own layers with the highest unit value first
 * (equal values: the lower position first), pieces an earlier decision wrote
 * down are skipped, and per layer the amount is pieces x max(0, layer unit -
 * market value), rounded to the cent.
 *
 * `layers` are the layers of the product, `writeDowns` its stored rows. A
 * new decision (`editingDecisionId` null) comes after all of them. When a
 * saved decision is edited its own rows are released first and the rows of
 * decisions with a higher id are ignored, because the server processes those
 * after this one. A null quantity takes every piece the remaining rows leave
 * free. `valueEur` is the acquisition value of the product minus the
 * remaining rows and minus this amount.
 */
export function writeDownPreview(
  layers: readonly ClosingLayer[], writeDowns: readonly WriteDownRow[], quantity: number | null,
  marketUnitEur: number, editingDecisionId: number | null,
): { amountEur: number; valueEur: number } {
  const own = layers.filter((layer) => layer.block === 'EIGEN');
  const earlier = writeDowns.filter((row) => editingDecisionId === null || row.decisionId < editingDecisionId);
  const taken = new Map<number, number>();
  for (const row of earlier) taken.set(row.layerPosition, (taken.get(row.layerPosition) ?? 0) + row.quantity);

  /* Unit values carry four decimals: work in ten-thousandths of a euro. */
  const units = (eur: number) => Math.round(eur * 10_000);
  const market = units(Math.max(0, marketUnitEur));
  const order = [...own].sort((a, b) => units(b.unitValueEur) - units(a.unitValueEur) || a.position - b.position);
  let left = quantity === null ? Number.POSITIVE_INFINITY : Math.max(0, quantity);
  let amountCents = 0;
  for (const layer of order) {
    if (left <= 0) break;
    const pieces = Math.min(left, Math.max(0, layer.quantity - (taken.get(layer.position) ?? 0)));
    if (pieces <= 0) continue;
    left -= pieces;
    /* Half up, like the server; the product is never negative. */
    amountCents += Math.floor((pieces * Math.max(0, units(layer.unitValueEur) - market) + 50) / 100);
  }
  const costCents = own.reduce((sum, layer) => sum + cents(layer.valueEur), 0);
  const earlierCents = earlier.reduce((sum, row) => sum + cents(row.amountEur), 0);
  return { amountEur: amountCents / 100, valueEur: (costCents - earlierCents - amountCents) / 100 };
}

/** The products of the tab "Zonder waarde": those with a remainder no layer covers. */
export function unvaluedRows(view: ClosingView): ClosingArticle[] {
  return view.articles.filter((article) => article.unvaluedQuantity > 0);
}

/**
 * The date a new beginwaarde gets: the day after the previous closing date,
 * or without a previous closing the day before the closing year starts;
 * never after the closing date.
 */
export function defaultOpeningDate(view: ClosingView): string {
  const date = view.previousClosing ? shiftDay(view.previousClosing.closingDate, 1) : `${view.closingYear - 1}-12-31`;
  return date > view.closingDate ? view.closingDate : date;
}

/** Why a beginwaarde date is refused (only dates inside the period are used by this closing), or null. */
export function openingDateError(view: ClosingView, date: string | null): string | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'Geef de datum van deze waarde';
  const previous = view.previousClosing?.closingDate ?? null;
  if (date <= view.closingDate && (previous === null || date > previous)) return null;
  return previous === null
    ? `De datum moet op of voor ${dateText(view.closingDate)} liggen`
    : `De datum moet na ${dateText(previous)} en op of voor ${dateText(view.closingDate)} liggen`;
}

export function streamButtonLabel(stream: ClosingStream): string {
  return stream.openEur > 0 || stream.accrual ? 'Bedrag bevestigen of aanpassen' : 'Nog verschuldigd bedrag toevoegen';
}

/** The border date of the rates was frozen by the previous closing and can no longer be chosen. */
export function borderFixed(container: ClosingContainer): boolean {
  return container.rateCutoffSource === 'VORIGE_AFSLUITING';
}

/* ---- decisions ---- */

export type SupplierBilledChoice = 'BESTELD' | 'GELEVERD';
export type CreditTreatmentChoice = 'VERLAAGT' | 'BUITEN' | 'IN_BETALING';
export type InvoicedChoice = 'UIT' | 'BLIJFT' | 'AL_WEG';

/** "Nog verschuldigd bedrag" of one payee stream; `invoiceReceived` makes it a confirmed amount. */
export function decisionWriteAccrual(
  purchaseOrderId: number, payee: ClosingStream['payee'], amountEur: number, invoiceReceived: boolean, reason: string,
): DecisionWrite {
  return { kind: 'ACCRUAL', purchaseOrderId, payee, amountEur, flag: invoiceReceived, reason: trimmed(reason) };
}

/** Which pieces the supplier charged when he was settled lower while pieces are short. */
export function decisionWriteSupplierBilled(purchaseOrderId: number, choice: SupplierBilledChoice, reason: string): DecisionWrite {
  return { kind: 'SUPPLIER_BILLED', purchaseOrderId, choice, reason: trimmed(reason) };
}

export function decisionWriteCreditTreatment(
  purchaseOrderId: number, creditId: number, choice: CreditTreatmentChoice, reason: string,
): DecisionWrite {
  return { kind: 'CREDIT_TREATMENT', purchaseOrderId, creditId, choice, reason: trimmed(reason) };
}

export function decisionWriteOwnershipDate(purchaseOrderId: number, decisionDate: string, reason: string): DecisionWrite {
  return { kind: 'OWNERSHIP_DATE', purchaseOrderId, decisionDate, reason: trimmed(reason) };
}

/** Goederen onderweg: the date ownership or risk passed goes along only when the container is included. */
export function decisionWriteTransit(
  purchaseOrderId: number, included: boolean, decisionDate: string | null, reason: string,
): DecisionWrite {
  return { kind: 'TRANSIT', purchaseOrderId, flag: included, decisionDate: included ? decisionDate : null, reason: trimmed(reason) };
}

export function decisionWritePartnerContainer(purchaseOrderId: number, included: boolean, reason: string): DecisionWrite {
  return { kind: 'PARTNER_CONTAINER', purchaseOrderId, flag: included, reason: trimmed(reason) };
}

export function decisionWritePartnerQuantity(
  purchaseOrderId: number, productId: number, quantity: number, reason: string,
): DecisionWrite {
  return { kind: 'PARTNER_QUANTITY', purchaseOrderId, productId, quantity, reason: trimmed(reason) };
}

/** One invoice; "Uit eigen voorraad" needs no reason. */
export function decisionWriteInvoiced(salesOrderId: number, choice: InvoicedChoice, reason: string | null): DecisionWrite {
  return { kind: 'INVOICED', salesOrderId, choice, reason: trimmed(reason) };
}

/** Goederen van derden always add a row; pass the `id` to change a saved one. */
export function decisionWriteThirdParty(
  productId: number, quantity: number, counterparty: string, reason: string, id: number | null = null,
): DecisionWrite {
  return { ...(id === null ? {} : { id }), kind: 'THIRD_PARTY', productId, quantity, counterparty: trimmed(counterparty), reason: trimmed(reason) };
}

/**
 * A waardevermindering: a null quantity means every piece that has none yet.
 * Always adds a row; pass the `id` to change a saved one.
 */
export function decisionWriteWriteDown(
  productId: number, quantity: number | null, marketUnitEur: number, reasonCode: string, reason: string, id: number | null = null,
): DecisionWrite {
  return {
    ...(id === null ? {} : { id }), kind: 'WRITE_DOWN', productId, quantity, unitValueEur: marketUnitEur, reasonCode,
    reason: trimmed(reason),
  };
}

/** "Meerekenen" of one ledger row, against the proposal. */
export function decisionWriteMovement(movementId: number, applied: boolean, reason: string): DecisionWrite {
  return { kind: 'MOVEMENT', movementId, flag: applied, reason: trimmed(reason) };
}

/** The tick of step 5; unticking deletes the decision. */
export function decisionWriteVatConfirmation(): DecisionWrite {
  return { kind: 'VAT_CONFIRMATION', flag: true };
}

/** The invoices of "Gefactureerd, nog niet afgepunt" that still wait for a choice, in list order. */
export function undecidedInvoiceIds(view: ClosingView): number[] {
  const decided = new Set(view.decisions.filter((decision) => decision.kind === 'INVOICED').map((decision) => decision.salesOrderId));
  const ids = new Set<number>();
  for (const item of view.separate) {
    if (item.kind !== 'GEFACTUREERD' || item.automatic || item.salesOrderId === null) continue;
    if (item.decisionId === null && !decided.has(item.salesOrderId)) ids.add(item.salesOrderId);
  }
  return [...ids];
}

/** "Alle {n} …": one write that gives every undecided invoice the same choice and reason. */
export function invoiceBulkWrite(view: ClosingView, choice: InvoicedChoice, reason: string | null): DecisionWrite {
  return { kind: 'INVOICED', salesOrderIds: undecidedInvoiceIds(view), choice, reason: trimmed(reason) };
}

/* ---- files and the hub ---- */

/** The name the server gives the download: "jaarinventaris-2026-v1.pdf", a concept "…-v1-concept.pdf". */
export function fileName(view: Pick<ClosingView, 'closingYear' | 'versionNo' | 'status'>, kind: 'pdf' | 'xlsx'): string {
  return `jaarinventaris-${view.closingYear}-v${view.versionNo}${view.status === 'CONCEPT' ? '-concept' : ''}.${kind}`;
}

/**
 * The year the hub opens on: the year of an open concept (the latest one),
 * else last year from January to June, else this year. `today` is yyyy-MM-dd.
 */
export function defaultInventoryYear(today: string, closings: readonly ClosingSummary[]): number {
  const concepts = closings.filter((closing) => closing.status === 'CONCEPT').map((closing) => closing.closingYear);
  if (concepts.length) return Math.max(...concepts);
  const [year, month] = today.split('-').map(Number);
  return month <= 6 ? year - 1 : year;
}
