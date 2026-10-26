/*
 * The phone purchase order (read view and editor, below 680px): its five
 * tabs and their URL, the summary card's figures, the confirmed next step and
 * the editor's save bar and Acties menu. Pure and node-tested: type-only
 * imports; the euro formatting is its own, the same as the payment menus.
 */
import type { Currency, Payee, Product, PurchaseOrder, PurchaseOrderView } from '../../core/api/models';
import type { LedgerSummary } from './purchase-payment-ledger';
import type { NacalcHeadline } from './purchase-nacalc-metrics';
import type { ContextMenuItem } from '../../shared/context-menu';
import type { SegmentOption } from '../../shared/segmented';

const EURO = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' });
const ONE_DECIMAL = new Intl.NumberFormat('nl-BE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function eur(value: number): string {
  return EURO.format(Number.isFinite(value) ? value : 0);
}

/* ---- tabs ------------------------------------------------------------- */

export type PhoneTab = 'overzicht' | 'producten' | 'kosten' | 'betalingen' | 'dossier';

export const PHONE_TABS: readonly { id: PhoneTab; label: string; icon: string }[] = [
  { id: 'overzicht', label: 'Overzicht', icon: 'order' },
  { id: 'producten', label: 'Producten', icon: 'products' },
  { id: 'kosten', label: 'Kosten', icon: 'tag' },
  { id: 'betalingen', label: 'Betalingen', icon: 'bank' },
  { id: 'dossier', label: 'Dossier', icon: 'folder' },
];

/** The ?tab= value as a tab; anything unknown or empty is Overzicht. */
export function parseTab(raw: string | null | undefined): PhoneTab {
  return PHONE_TABS.find((tab) => tab.id === raw)?.id ?? 'overzicht';
}

/** The tab as the URL carries it; Overzicht is the default and stays out of the URL. */
export function tabParam(tab: PhoneTab): string | null {
  return tab === 'overzicht' ? null : tab;
}

const SECTION_TAB: Readonly<Record<string, PhoneTab>> = {
  'purchase-overview': 'overzicht',
  'purchase-order-section': 'overzicht',
  'purchase-receipt-section': 'overzicht',
  'purchase-actions-section': 'overzicht',
  'purchase-products-section': 'producten',
  'purchase-capacity-section': 'producten',
  'purchase-costs-section': 'kosten',
  'purchase-calc-section': 'kosten',
  'purchase-summary-section': 'kosten',
  'purchase-result-section': 'kosten',
  'purchase-payment-result': 'kosten',
  'purchase-payments-section': 'betalingen',
  'purchase-partner-section': 'betalingen',
  'purchase-partner-payments': 'betalingen',
  'purchase-advance-invoices': 'betalingen',
  'purchase-files-section': 'dossier',
  'purchase-notes-section': 'dossier',
  'purchase-reports-section': 'dossier',
};

const ROOT_SECTION: Readonly<Record<PhoneTab, string>> = {
  overzicht: 'purchase-overview',
  producten: 'purchase-products-section',
  kosten: 'purchase-costs-section',
  betalingen: 'purchase-payments-section',
  dossier: 'purchase-files-section',
};

/** The tab a section (an element id of either screen) lives on. */
export function tabOfSection(sectionId: string): PhoneTab {
  return SECTION_TAB[sectionId] ?? 'overzicht';
}

/** The section at the top of a tab. */
export function rootSectionOf(tab: PhoneTab): string {
  return ROOT_SECTION[tab];
}

/** What a tab's warn dot means, for a screen reader: the dot itself is aria-hidden. */
const DOT_WORDS: Readonly<Partial<Record<PhoneTab, string>>> = {
  producten: 'afwijkingen bij ontvangst',
  betalingen: 'er is nu iets te betalen',
};

/** The five segments, with a warn dot where something waits: never a count. */
export function tabSegments(dots: { producten: boolean; betalingen: boolean }): SegmentOption[] {
  return PHONE_TABS.map((tab) => {
    const dot = (tab.id === 'producten' && dots.producten) || (tab.id === 'betalingen' && dots.betalingen);
    return {
      id: tab.id, label: tab.label, icon: tab.icon, dot: dot ? 'warn' : null,
      ...(dot ? { ariaLabel: `${tab.label}, ${DOT_WORDS[tab.id]}` } : {}),
    };
  });
}

/** A received container with damage, a shortage or a report on it. */
export function productsDot(view: Pick<PurchaseOrderView, 'order' | 'receiptReports' | 'receiptVariance'>): boolean {
  if (view.order.status !== 'ONTVANGEN') return false;
  const affected = view.receiptVariance?.affectedLines ?? view.order.lines.filter((line) =>
    (line.orderedQuantity ?? line.quantity) !== line.quantity || (line.damagedQuantity ?? 0) > 0).length;
  return affected > 0 || (view.receiptReports?.length ?? 0) > 0;
}

/** The screens' payment state: a refresh keeps the figures on screen, so it counts as ready. */
export type PhonePaymentState = 'loading' | 'refreshing' | 'error' | 'ready';

/** Something is due now on the loaded payments. */
export function paymentsDot(summary: Pick<LedgerSummary, 'dueNowEur'> | null | undefined, state: PhonePaymentState): boolean {
  return (state === 'ready' || state === 'refreshing') && (summary?.dueNowEur ?? 0) > 0;
}

/* ---- summary card ------------------------------------------------------- */

const STATUS_ORDER: readonly PurchaseOrder['status'][] = ['CONCEPT', 'BESTELD', 'ONDERWEG', 'ONTVANGEN'];

export function statusLabel(status: PurchaseOrder['status']): 'Concept' | 'Besteld' | 'Vertrokken' | 'Ontvangen' {
  return status === 'ONTVANGEN' ? 'Ontvangen' : status === 'ONDERWEG' ? 'Vertrokken' : status === 'BESTELD' ? 'Besteld' : 'Concept';
}

export function statusTone(status: PurchaseOrder['status']): 'tone-grey' | 'tone-accent' | 'tone-blue' | 'tone-ok' {
  return status === 'ONTVANGEN' ? 'tone-ok' : status === 'ONDERWEG' ? 'tone-blue' : status === 'BESTELD' ? 'tone-accent' : 'tone-grey';
}

export interface ProgressStep { label: string; state: 'done' | 'now' | 'todo'; date: string | null; prefix: 'verwacht' | null }

/**
 * The day the calculation was made: its creation, else (an order from before
 * the logbook) the order date. One rule for the summary steps and the desk's
 * Afronden 'Calculatie gemaakt' (I-B22).
 */
export function calculationMadeOn(createdAt: string | null | undefined, orderDate: string | null | undefined): string | null {
  return createdAt || orderDate || null;
}

/**
 * The Ordernummer is fixed once the container is ordered: 'Kostprijzen
 * toepassen' writes it on the product cards (landedCostSource), so a later
 * rename would orphan the applied state (I-B5).
 */
export function orderNumberLocked(status: PurchaseOrder['status'] | null | undefined): boolean {
  return !!status && status !== 'CONCEPT';
}

/** Concept, Besteld, Vertrokken, Ontvangen with the day each was reached; the arrival is 'verwacht' until it happened. */
export function progressSteps(
  order: Pick<PurchaseOrder, 'status' | 'orderDate' | 'shippedOn' | 'receivedOn' | 'expectedArrival'>,
  createdAt: string | null,
): ProgressStep[] {
  const current = Math.max(0, STATUS_ORDER.indexOf(order.status));
  const received = order.status === 'ONTVANGEN';
  const state = (index: number): ProgressStep['state'] => received || index < current ? 'done' : index === current ? 'now' : 'todo';
  const expected = !received && order.expectedArrival ? order.expectedArrival : null;
  return [
    { label: 'Concept', state: state(0), date: calculationMadeOn(createdAt, order.orderDate), prefix: null },
    { label: 'Besteld', state: state(1), date: current >= 1 ? order.orderDate || null : null, prefix: null },
    { label: 'Vertrokken', state: state(2), date: current >= 2 ? order.shippedOn || null : null, prefix: null },
    { label: 'Ontvangen', state: state(3), date: received ? order.receivedOn || null : expected, prefix: expected ? 'verwacht' : null },
  ];
}

export interface MoneyTile { label: string; valueEur: number | null; sub: string; tone: 'warn' | 'ok' | 'neutral' }

/** The payment tile: the same words as the Betalingen headline. */
export function paymentTile(summary: LedgerSummary | null | undefined, state: PhonePaymentState, planLabel: string,
  payeeLabel: Readonly<Record<Payee, string>>): MoneyTile {
  if (state === 'error') return { label: 'Betalingen', valueEur: null, sub: 'Opnieuw laden', tone: 'neutral' };
  if (state === 'loading' || !summary) return { label: 'Betalingen', valueEur: null, sub: 'Bijwerken…', tone: 'neutral' };
  const next = summary.next;
  switch (summary.headline.kind) {
    case 'due':
      // The payee only beside a supplier term, as the headline has it: other payees are their own label.
      return { label: 'Nu te betalen', valueEur: summary.dueNowEur, sub: next ? next.label + (next.due ? ` · ${payeeLabel[next.payee]}` : '') : '', tone: 'warn' };
    case 'later':
      return { label: 'Niets nu te betalen', valueEur: summary.openEur, sub: next ? `Volgende: ${next.label} · ${next.when}` : '', tone: 'neutral' };
    case 'review': {
      const payee = summary.headline.payee;
      if (!payee) return { label: 'Nakijken', valueEur: summary.reviewEur > 0 ? summary.reviewEur : null, sub: '', tone: 'warn' };
      const kind = payee.status.kind;
      return {
        label: 'Nakijken',
        valueEur: kind === 'UNBUDGETED' ? payee.paidEur : kind === 'OVERPAID' ? (payee.reviewEur > 0 ? payee.reviewEur : payee.higherEur) : null,
        sub: `${payee.label}: ${kind === 'UNBUDGETED' ? 'betaald zonder afspraak' : kind === 'INCOMPLETE' ? 'bedragen onvolledig' : 'te veel betaald'}`,
        tone: 'warn',
      };
    }
    case 'done':
      return { label: 'Alles betaald', valueEur: summary.paidTotalEur, sub: '', tone: 'ok' };
    case 'concept':
      return { label: 'Nog niet besteld', valueEur: summary.agreedEur, sub: planLabel, tone: 'neutral' };
    default:
      return { label: 'Nog geen bedragen', valueEur: null, sub: 'Voeg producten en kosten toe.', tone: 'neutral' };
  }
}

/**
 * What the container counts in (F18, 2026-10-17): a container of display
 * products says 'Displays', a mix of displays and pieces 'Eenheden', else
 * 'Stuks'. From reconciliation.totals.setBasis; missing counts as pieces.
 * `short` is the phone's figure word ('960 st', '960 displays', '960 eenheden').
 */
export function countWords(setBasis: string | null | undefined): {
  label: 'Stuks' | 'Displays' | 'Eenheden'; plural: 'stuks' | 'displays' | 'stuks en displays'; short: 'st' | 'displays' | 'eenheden';
} {
  if (setBasis === 'DISPLAY') return { label: 'Displays', plural: 'displays', short: 'displays' };
  if (setBasis === 'MIXED') return { label: 'Eenheden', plural: 'stuks en displays', short: 'eenheden' };
  return { label: 'Stuks', plural: 'stuks', short: 'st' };
}

/** '1 regel', '12 regels': a container's product lines. */
export function lineCount(count: number): string {
  return `${count} ${count === 1 ? 'regel' : 'regels'}`;
}

/** Totaal geland and what the road adds on top of the goods (PurchaseView.overheadPct's rounding). */
export function landedTile(totals: { totalEur: number; goodsEur: number }, ddp: boolean): { valueEur: number; sub: string } {
  const sub = ddp ? 'DDP · transport en rechten in de prijs'
    : totals.goodsEur > 0 ? `+ ${Math.round(((totals.totalEur - totals.goodsEur) / totals.goodsEur) * 100)} % op de goederen`
    : 'nog geen goederen geladen';
  return { valueEur: totals.totalEur, sub };
}

/* ---- the editor's line rows ------------------------------------------- */

const CURRENCY_SIGN: Readonly<Record<Currency, string>> = { USD: '$', CNY: '¥', EUR: '€' };

/**
 * The purchase price a line row states: the order's own agreed price, else
 * the product card's price in the card's own currency, named as such; null
 * without either. Never the costing's goods figure, which is converted to
 * USD and levelled across a family's variants.
 */
export function linePriceText(own: { price: number | null | undefined; currency: Currency },
  card: { amount: number; currency: Currency } | null, format: (value: number) => string): string | null {
  if (own.price != null) return `${CURRENCY_SIGN[own.currency]} ${format(own.price)} afgesproken`;
  return card ? `${CURRENCY_SIGN[card.currency]} ${format(card.amount)} kaartprijs` : null;
}

export interface NacalcGlance {
  concept: boolean; label: string; pill: string; pillTone: string; eindkostEur: number; afspraakEur: number;
  /** 'Verschil · 5,0 %', or 'Verschil' without a percentage: of the part outside a review. */
  verschilTitle: string;
  /** '€ 3.271,34 minder' | '€ 120,00 meer' | 'geen verschil': the phone's one wording, never a sign; the part outside a review. */
  verschilText: string;
  /** False when only a review is left: the Nakijken row says it then, never 'geen verschil' above it. */
  verschilShown: boolean;
  /** The Nakijken row's figure, '€ 30,00 meer', while an overpayment waits for a review; '' otherwise. */
  reviewText: string;
  verschilTone: 'in' | 'warn' | 'none'; sub: string; foot: string;
}

/**
 * The Nacalculatie's headline for Overzicht: eindkost, Afspraak and the difference, never a new figure.
 * The Verschil reads as on the phone's Nacalculatie (purchase-phone-money's verschilText): '€ x minder'.
 */
export function nacalcGlance(head: NacalcHeadline): NacalcGlance {
  const concept = head.kind === 'concept';
  // As on Kosten and Betalingen (2026-10-26): what waits for a review is its own Nakijken row, never folded into the Verschil.
  const review = Math.max(0, Math.round(head.reviewEur * 100));
  const restCents = Math.round(head.verschilEur * 100) - review;
  const verschil = restCents / 100;
  const begroot = Math.round(head.begrootEur * 100);
  const pctValue = review > 0 ? (begroot > 0 ? Math.round(restCents / begroot * 1000) / 10 : null) : head.verschilPct;
  const pct = pctValue === null || !restCents ? '' : `${ONE_DECIMAL.format(Math.abs(pctValue))} %`;
  const tone = head.pill.tone;
  return {
    concept,
    label: head.label,
    pill: head.pill.label,
    pillTone: tone === 'ok' ? 'tone-ok' : tone === 'warn' ? 'tone-warn' : tone === 'outline' ? 'wk-pill--outline' : '',
    eindkostEur: head.eindkostEur,
    afspraakEur: head.begrootEur,
    // One line at 375 px: the percentage beside the title, the amount with its word in the trail.
    verschilTitle: pct ? `Verschil · ${pct}` : 'Verschil',
    verschilText: restCents ? `${eur(Math.abs(verschil))} ${verschil < 0 ? 'minder' : 'meer'}` : 'geen verschil',
    verschilShown: !(review > 0 && restCents === 0),
    reviewText: review > 0 ? `${eur(review / 100)} meer` : '',
    // Minder is green, a settled meer plain; the Nakijken row carries the warn tone.
    verschilTone: verschil < 0 ? 'in' : 'none',
    sub: concept ? 'volgens de calculatie · nog niets betaald' : '',
    foot: concept
      ? 'De nacalculatie begint bij de bestelling: zodra betalingen genoteerd zijn, zie je hier wat de container echt kost.'
      : head.sentence,
  };
}

/* ---- the next step, always confirmed ------------------------------------ */

export type PhoneStep = 'BESTELLEN' | 'VERTROKKEN' | 'ONTVANGEN' | 'BIJBOEKEN' | 'KOSTPRIJZEN';

export const STEP_BUTTON: Readonly<Record<PhoneStep, string>> = {
  BESTELLEN: 'Bestellen',
  VERTROKKEN: 'Container vertrokken',
  ONTVANGEN: 'Container ontvangen',
  BIJBOEKEN: 'Voorraad bijboeken',
  KOSTPRIJZEN: 'Kostprijzen toepassen',
};

/** The status a status step leads to; null for the steps that keep the status. */
export function stepTarget(step: PhoneStep): PurchaseOrder['status'] | null {
  return step === 'BESTELLEN' ? 'BESTELD' : step === 'VERTROKKEN' ? 'ONDERWEG' : step === 'ONTVANGEN' ? 'ONTVANGEN' : null;
}

/** The status step that leads to a status (the editor's nextStep().to). */
export function stepToward(to: string | null | undefined): AskedStep | null {
  return to === 'BESTELD' ? 'BESTELLEN' : to === 'ONDERWEG' ? 'VERTROKKEN' : to === 'ONTVANGEN' ? 'ONTVANGEN' : null;
}

/**
 * The read view's dock step: the status road, then the shelf, then the catalogue costs; nothing on an
 * empty container. The costs come back when products carry an older cost of this container (cost-fix Q2).
 */
export function readNextStep(s: {
  status: PurchaseOrder['status']; lineCount: number; stockBooked: boolean | null | undefined; costsApplied: boolean;
  /** A newer container's costs sit on some of these products: this one must not push them aside (amendment G12). */
  superseded?: boolean;
  /** Products carry an older cost of this container than it calculates now (costsStale). */
  stale?: boolean;
}): PhoneStep | null {
  if (s.lineCount <= 0) return null;
  if (s.status === 'CONCEPT') return 'BESTELLEN';
  if (s.status === 'BESTELD') return 'VERTROKKEN';
  if (s.status === 'ONDERWEG') return 'ONTVANGEN';
  if (s.stockBooked === false) return 'BIJBOEKEN';
  return (!s.costsApplied || s.stale) && !s.superseded ? 'KOSTPRIJZEN' : null;
}

/** '1 verschil', '3 verschillen': products whose cost differs from the container's calculation. */
export function differenceCount(count: number): string {
  return `${count.toLocaleString('nl-BE')} ${count === 1 ? 'verschil' : 'verschillen'}`;
}

/**
 * The step's button; Kostprijzen once applied says opnieuw, as Acties does. The phone dock is too
 * narrow for the whole phrase at 375 px: it keeps 'Opnieuw toepassen', the words of the sheet's button.
 */
export function stepLabel(step: PhoneStep, costsApplied: boolean, dock = false): string {
  if (step !== 'KOSTPRIJZEN' || !costsApplied) return STEP_BUTTON[step];
  return dock ? 'Opnieuw toepassen' : 'Kostprijzen opnieuw toepassen';
}

/**
 * The Overzicht card under 'Volgende stap', in words: it follows the dock's
 * readNextStep, so the card never says 'afgerond' while the dock still
 * offers a step (I-B6). Null means the road is done; `stale` counts the
 * products that carry an older cost of this container.
 */
export function nextStepCard(step: PhoneStep | null, lineCount: number, stale = 0): { title: string; text: string } {
  if (lineCount <= 0) {
    return { title: 'Voeg eerst producten toe', text: 'Deze container is nog leeg. Voeg productregels toe voordat je de lading en kosten afrondt.' };
  }
  switch (step) {
    case 'BESTELLEN':
      return { title: 'Klaar om te bestellen?', text: 'Controleer lading, containerruimte en kosten voordat je de bestelling vastlegt.' };
    case 'VERTROKKEN':
      return { title: 'Is de container vertrokken?', text: 'Zet de order op Vertrokken zodra het schip vaart; dan valt de volgende betaling en start de tracking.' };
    case 'ONTVANGEN':
      return { title: 'Klaar voor ontvangst?', text: 'Controleer bij aankomst de werkelijk ontvangen aantallen voordat je de voorraad bijboekt.' };
    case 'BIJBOEKEN':
      return { title: 'Klaar voor de volgende stap?', text: 'Ontvangen, nog niet bijgeboekt: de stuks staan nog niet in de voorraad.' };
    case 'KOSTPRIJZEN':
      return stale > 0
        ? { title: 'Kostprijzen opnieuw toepassen?',
          text: `${stale === 1 ? '1 product draagt' : `${stale.toLocaleString('nl-BE')} producten dragen`} een oudere kostprijs dan deze container nu rekent.` }
        : { title: 'Klaar voor de volgende stap?', text: 'De voorraad is bijgeboekt. Zet nu de gelande kost op de productkaarten.' };
    default:
      return { title: 'Container afgerond', text: 'De voorraad is bijgeboekt. Je kunt de calculatie nog controleren of als PDF bewaren.' };
  }
}

/** The editor's save-bar step; Kostprijzen stays under Acties there. */
export function editNextStep(s: { status: PurchaseOrder['status']; lineCount: number; stockBooked: boolean | null | undefined }): AskedStep | 'PRODUCTEN' | null {
  if (s.status === 'CONCEPT') return s.lineCount <= 0 ? 'PRODUCTEN' : 'BESTELLEN';
  if (s.status === 'BESTELD') return 'VERTROKKEN';
  if (s.status === 'ONDERWEG') return 'ONTVANGEN';
  return s.stockBooked === false ? 'BIJBOEKEN' : null;
}

export interface StepConfirm { title: string; message: string; confirmLabel: string; tracking: boolean; dirtyNote: boolean }

/**
 * The steps this question asks about. Kostprijzen toepassen asks in its own
 * sheet in the editor (PurchaseEditor.apply(), the cost price history round):
 * every product's cost now and next.
 */
export type AskedStep = Exclude<PhoneStep, 'KOSTPRIJZEN'>;

/** The question every next step asks first; each of them saves a draft that goes along. */
export function stepConfirm(step: AskedStep, ctx: { number: string; planLabel: string; location: string; dirty: boolean }): StepConfirm {
  const base = { tracking: step === 'VERTROKKEN', dirtyNote: ctx.dirty };
  switch (step) {
    case 'BESTELLEN':
      return { ...base, title: 'Bestellen?', confirmLabel: 'Ja, bestellen',
        message: `${ctx.number} gaat van Concept naar Besteld. Betalingen volgen vanaf nu het betaalplan: ${ctx.planLabel}.` };
    case 'VERTROKKEN':
      return { ...base, title: 'Container vertrokken?', confirmLabel: 'Ja, vertrokken',
        message: `Zet dit pas als het schip echt vaart: ${ctx.number} gaat naar Vertrokken, de volgende betaling valt en de tracking start.` };
    case 'ONTVANGEN':
      return { ...base, title: 'Container ontvangen?', confirmLabel: 'Ontvangst tellen',
        message: `Je telt eerst per product wat er echt in de container zat. Pas als je die telling bevestigt, gaat ${ctx.number} naar Ontvangen.` };
    case 'BIJBOEKEN':
      return { ...base, title: 'Voorraad bijboeken?', confirmLabel: 'Bijboeken',
        message: `Ontvangen min beschadigd gaat nu in de voorraad op ${ctx.location}.` };
  }
}

/** A step confirmed on the read view, run by the editor it opens: in memory only, never in a URL. */
export interface StepHandoff { orderId: number; step: PhoneStep; tracking: string | null; tab: PhoneTab; at: number }

export const HANDOFF_MS = 30_000;

/** The pending handoff when it is for this order and at most HANDOFF_MS old, else null. */
export function takeHandoff(pending: StepHandoff | null, orderId: number, now: number): StepHandoff | null {
  if (!pending || pending.orderId !== orderId) return null;
  const age = now - pending.at;
  return age >= 0 && age <= HANDOFF_MS ? pending : null;
}

/** Did an earlier apply of this order land on its products? (PurchaseEditor.costsApplied's rule.) */
export function costsAppliedFor(lines: readonly { productId: number }[], products: readonly Pick<Product, 'id' | 'landedCostSource'>[],
  orderNumber: string): boolean {
  const byId = new Map(products.map((product) => [product.id, product]));
  return lines.some((line) => byId.get(line.productId)?.landedCostSource === orderNumber);
}

/** Two container numbers of the same shape ('PO-2026-047'), compared by their numbers; null when they do not compare. */
function compareNumbers(a: string, b: string): number | null {
  const shape = (value: string) => value.trim().replace(/\d+/g, '#');
  if (!a.trim() || !b.trim() || shape(a) !== shape(b)) return null;
  return a.trim().localeCompare(b.trim(), 'nl', { numeric: true });
}

/** A product's cost source is a newer container than this one ('PO-2026-048' after 'PO-2026-047'). */
export function isNewerSource(source: string | null | undefined, orderNumber: string): boolean {
  return !!source && (compareNumbers(source, orderNumber) ?? 0) > 0;
}

/**
 * The products of these lines that carry a newer container's costs: applying this one would push
 * them aside. A line that received nothing is never applied (the server skips it), so it does not count.
 */
export function costsSupersededCount(lines: readonly { productId: number; quantity?: number }[],
  products: readonly Pick<Product, 'id' | 'landedCostSource'>[], orderNumber: string): number {
  const byId = new Map(products.map((product) => [product.id, product]));
  const ids = new Set(lines.filter((line) => (line.quantity ?? 1) > 0 && isNewerSource(byId.get(line.productId)?.landedCostSource, orderNumber))
    .map((line) => line.productId));
  return ids.size;
}

/** Some product carries the costs of a newer container than this one. */
export function costsSupersededFor(lines: readonly { productId: number; quantity?: number }[], products: readonly Pick<Product, 'id' | 'landedCostSource'>[],
  orderNumber: string): boolean {
  return costsSupersededCount(lines, products, orderNumber) > 0;
}

/* ---- the editor's Acties menu ------------------------------------------- */

export interface ActionsMenuState {
  status: PurchaseOrder['status'];
  /** The editor's nextStep()?.to. */
  step: string | null;
  lineCount: number;
  stockBooked: boolean | null | undefined;
  costsApplied: boolean;
  /**
   * Products carrying an older cost of this container (costsStale().count); 0 or absent when none, and
   * 0 while a newer container sits on some of its products: applying would push those aside too.
   */
  staleCount?: number;
  partner: boolean;
  canQuote: boolean;
  dirty: boolean;
  saving: boolean;
  booking: boolean;
  deleting: boolean;
  stepBackBusy: boolean;
}

const NEXT_HINT: Readonly<Record<string, { hint: string; icon: string }>> = {
  BESTELLEN: { hint: 'Controleer de producten en kosten voordat je de bestelling vastlegt.', icon: 'order' },
  VERTROKKEN: { hint: 'Zet de order op Vertrokken zodra het schip vaart.', icon: 'truck' },
  ONTVANGEN: { hint: 'Bij ontvangst tel je wat er echt in de container zat; bijboeken kan meteen of later.', icon: 'stock' },
};

/** What the old Afronden card and Meer acties held, as one menu. */
export function actionsMenu(s: ActionsMenuState): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];
  const received = s.status === 'ONTVANGEN';
  const next = stepToward(s.step);
  if (next) items.push({ id: 'next', label: STEP_BUTTON[next], hint: NEXT_HINT[next].hint, iconName: NEXT_HINT[next].icon, disabled: s.saving });
  if (received && s.stockBooked === false) {
    items.push({ id: 'book', label: 'Voorraad bijboeken', hint: 'Ontvangen, nog niet bijgeboekt: de stuks staan nog niet in de voorraad.',
      iconName: 'stock', disabled: s.booking });
  }
  items.push(
    { id: 'apply', label: (s.staleCount ?? 0) > 0 ? `Kostprijzen opnieuw toepassen · ${differenceCount(s.staleCount!)}`
      : s.costsApplied ? 'Kostprijzen opnieuw toepassen' : 'Kostprijzen toepassen',
      hint: 'Gelande kostprijs per display of per stuk naar de producten', iconName: 'tag' },
    { id: 'quote', label: s.partner ? 'Conceptvoorschotfacturen maken' : 'Verkoopofferte maken', iconName: 'sales', disabled: !s.canQuote },
    { id: 'copy', label: 'Deze container kopiëren', iconName: 'copy' },
    { id: 'pdf', label: 'PDF downloaden', iconName: 'pdf' },
  );
  if (s.status === 'BESTELD' || s.status === 'ONDERWEG') {
    items.push({ id: 'step-back', label: 'Status terugzetten…', hint: 'Een stap terug, als die per vergissing gezet is',
      iconName: 'restore', disabled: s.stepBackBusy, divider: true });
  }
  if (!received) {
    items.push({ id: 'delete', label: 'Calculatie verwijderen', danger: true, iconName: 'trash', disabled: s.deleting || s.saving,
      hint: 'Tijdelijk verwijderen. Herstellen kan via Instellingen → Beheer → Verwijderde items.', divider: s.status === 'CONCEPT' });
  }
  return items;
}

/* ---- the save bar: what is not saved yet ------------------------------- */

type OrderKey = keyof PurchaseOrder;

/** The order's fields by the name their row carries, in the order of the screen. */
function fieldLabels(labels: { seaFreight: string; origin: string; destination: string }): [string, readonly OrderKey[]][] {
  return [
    ['Ordernummer', ['number']],
    ['Herkenbare naam', ['alias']],
    ['Orderdatum', ['orderDate']],
    ['Verwacht op', ['expectedArrival']],
    ['Ontvangen op', ['receivedOn']],
    ['Track & trace', ['trackingReference']],
    ['Type container', ['containerType']],
    ['Vertrekhaven', ['departurePort']],
    ['Aankomsthaven', ['destinationPort']],
    ['Inklaring', ['clearance']],
    ['Lossen op', ['receivingLocationId']],
    ['RMB naar USD', ['cnyToUsd']],
    ['USD naar EUR', ['usdToEurGoods', 'usdToEurTransport']],
    [labels.seaFreight, ['freightUsd']],
    [labels.origin, ['originCosts', 'originCurrency']],
    [labels.destination, ['destinationCostsEur']],
    ['Invoerrecht', ['defaultDutyRatePct']],
    ['Enrosed kost', ['extraRevenueEur']],
    ['Inspectiekost', ['inspectionCostEur']],
    ['Andere kosten', ['otherCosts']],
    ['Verdeelsleutels', ['allocFreight', 'allocOrigin', 'allocDestination', 'allocExtra', 'allocSeparate', 'groupVariants']],
    ['Dagboek', ['notes']],
    ['Betaalplan', ['paymentTerms', 'payPctOrdered', 'payPctShipped', 'payPctArrived']],
    ['Prijsbasis en munt', ['freightViaSupplier']],
  ];
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const BASIS_KEYS = new Set(['priceBasis', 'exwCurrency']);
const EXTRA_KEYS = new Set(['extraShareEur', 'extraUnitCost']);

/** 'Zeevracht gewijzigd', 'Orderdatum en 2 regels gewijzigd', '4 wijzigingen' or '' when nothing differs. */
export function unsavedSummary(saved: PurchaseOrder | null, draft: PurchaseOrder | null,
  labels: { seaFreight: string; origin: string; destination: string }): string {
  if (!saved || !draft || same(saved, draft)) return '';
  const touched = new Set<string>();
  let changedLines = 0;
  const before = new Map((saved.lines ?? []).map((line) => [line.productId, line]));
  const after = new Map((draft.lines ?? []).map((line) => [line.productId, line]));
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const a = before.get(id) as Record<string, unknown> | undefined;
    const b = after.get(id) as Record<string, unknown> | undefined;
    if (!a || !b) { changedLines++; continue; }
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((key) => !same(a[key], b[key]));
    if (!keys.length) continue;
    if (keys.every((key) => BASIS_KEYS.has(key) || EXTRA_KEYS.has(key))) {
      if (keys.some((key) => BASIS_KEYS.has(key))) touched.add('Prijsbasis en munt');
      if (keys.some((key) => EXTRA_KEYS.has(key))) touched.add('Enrosed kost');
    } else {
      changedLines++;
    }
  }
  const names = fieldLabels(labels)
    .filter(([label, keys]) => touched.has(label) || keys.some((key) => !same(saved[key], draft[key])))
    .map(([label]) => label)
    .filter((label, index, all) => all.indexOf(label) === index);
  const lineName = changedLines ? `${changedLines} ${changedLines === 1 ? 'regel' : 'regels'}` : null;
  const all = lineName ? [...names, lineName] : names;
  if (!all.length) return 'Wijzigingen klaar';
  if (all.length === 1) return lineName ? `${lineName} aangepast` : `${all[0]} gewijzigd`;
  if (all.length === 2) return `${all[0]} en ${all[1]} gewijzigd`;
  return `${all.length} wijzigingen`;
}

/* ---- the tab in the URL ------------------------------------------------- */

/** What replaceTabInUrl needs of Angular's Location. */
export interface TabLocation {
  path(includeHash?: boolean): string;
  replaceState(path: string, query?: string, state?: unknown): void;
  getState?(): unknown;
}

/**
 * Writes the tab into the current URL without a navigation (no history entry,
 * no scroll to the top): every other query param stays; a deep link's
 * section, payee and due go, they were used.
 */
export function replaceTabInUrl(location: TabLocation, tab: PhoneTab): void {
  const full = location.path(false);
  const start = full.indexOf('?');
  const path = start < 0 ? full : full.slice(0, start);
  const params = new URLSearchParams(start < 0 ? '' : full.slice(start + 1));
  for (const key of ['tab', 'section', 'payee', 'due']) params.delete(key);
  const value = tabParam(tab);
  if (value) params.set('tab', value);
  location.replaceState(path, params.toString(), location.getState?.());
}
