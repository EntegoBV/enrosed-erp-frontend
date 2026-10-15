/*
 * The phone purchase order (read view and editor, below 680px): its five
 * tabs and their URL, the summary card's figures, the confirmed next step and
 * the editor's save bar and Acties menu. Pure and node-tested: type-only
 * imports; the euro formatting is its own, the same as the payment menus.
 */
import type { Payee, Product, PurchaseOrder, PurchaseOrderView } from '../../core/api/models';
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

/** The five segments, with a warn dot where something waits: never a count. */
export function tabSegments(dots: { producten: boolean; betalingen: boolean }): SegmentOption[] {
  return PHONE_TABS.map((tab) => ({
    id: tab.id, label: tab.label, icon: tab.icon,
    dot: (tab.id === 'producten' && dots.producten) || (tab.id === 'betalingen' && dots.betalingen) ? 'warn' : null,
  }));
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
    { label: 'Concept', state: state(0), date: createdAt || null, prefix: null },
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

/** Totaal geland and what the road adds on top of the goods (PurchaseView.overheadPct's rounding). */
export function landedTile(totals: { totalEur: number; goodsEur: number }, ddp: boolean): { valueEur: number; sub: string } {
  const sub = ddp ? 'DDP · transport en rechten in de prijs'
    : totals.goodsEur > 0 ? `+ ${Math.round(((totals.totalEur - totals.goodsEur) / totals.goodsEur) * 100)} % op de goederen`
    : 'nog geen goederen geladen';
  return { valueEur: totals.totalEur, sub };
}

export interface NacalcGlance {
  concept: boolean; label: string; pill: string; pillTone: string; eindkostEur: number; afspraakEur: number;
  verschilText: string; verschilWords: string; verschilTone: 'in' | 'warn' | 'none'; sub: string; foot: string;
}

/** The Nacalculatie's headline for Overzicht: eindkost, Afspraak and the difference, never a new figure. */
export function nacalcGlance(head: NacalcHeadline): NacalcGlance {
  const concept = head.kind === 'concept';
  const verschil = head.verschilEur;
  const pct = head.verschilPct === null || !verschil ? '' : ` (${ONE_DECIMAL.format(Math.abs(head.verschilPct))} %)`;
  const review = head.reviewEur > 0 ? ` · waarvan ${eur(head.reviewEur)} na te kijken` : '';
  const tone = head.pill.tone;
  return {
    concept,
    label: head.label,
    pill: head.pill.label,
    pillTone: tone === 'ok' ? 'tone-ok' : tone === 'warn' ? 'tone-warn' : tone === 'outline' ? 'wk-pill--outline' : '',
    eindkostEur: head.eindkostEur,
    afspraakEur: head.begrootEur,
    verschilText: verschil ? `${verschil > 0 ? '+ ' : '− '}${eur(Math.abs(verschil))}${pct}` : eur(0),
    verschilWords: (verschil < 0 ? 'goedkoper dan afgesproken' : verschil > 0 ? 'duurder dan afgesproken' : 'geen verschil') + review,
    verschilTone: verschil < 0 ? 'in' : verschil > 0 || head.reviewEur > 0 ? 'warn' : 'none',
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
export function stepToward(to: string | null | undefined): PhoneStep | null {
  return to === 'BESTELD' ? 'BESTELLEN' : to === 'ONDERWEG' ? 'VERTROKKEN' : to === 'ONTVANGEN' ? 'ONTVANGEN' : null;
}

/** The read view's dock step: the status road, then the shelf, then the catalogue costs; nothing on an empty container. */
export function readNextStep(s: {
  status: PurchaseOrder['status']; lineCount: number; stockBooked: boolean | null | undefined; costsApplied: boolean;
  /** A newer container's costs sit on some of these products: this one must not push them aside (amendment G12). */
  superseded?: boolean;
}): PhoneStep | null {
  if (s.lineCount <= 0) return null;
  if (s.status === 'CONCEPT') return 'BESTELLEN';
  if (s.status === 'BESTELD') return 'VERTROKKEN';
  if (s.status === 'ONDERWEG') return 'ONTVANGEN';
  if (s.stockBooked === false) return 'BIJBOEKEN';
  return !s.costsApplied && !s.superseded ? 'KOSTPRIJZEN' : null;
}

/** The editor's save-bar step; Kostprijzen stays under Acties there. */
export function editNextStep(s: { status: PurchaseOrder['status']; lineCount: number; stockBooked: boolean | null | undefined }): PhoneStep | 'PRODUCTEN' | null {
  if (s.status === 'CONCEPT') return s.lineCount <= 0 ? 'PRODUCTEN' : 'BESTELLEN';
  if (s.status === 'BESTELD') return 'VERTROKKEN';
  if (s.status === 'ONDERWEG') return 'ONTVANGEN';
  return s.stockBooked === false ? 'BIJBOEKEN' : null;
}

export interface StepConfirm { title: string; message: string; confirmLabel: string; tracking: boolean; dirtyNote: boolean }

/** The question every next step asks first. */
export function stepConfirm(step: PhoneStep, ctx: { number: string; planLabel: string; location: string; dirty: boolean; again: boolean }): StepConfirm {
  const saves = step === 'BESTELLEN' || step === 'VERTROKKEN' || step === 'ONTVANGEN' || step === 'BIJBOEKEN';
  const base = { tracking: step === 'VERTROKKEN', dirtyNote: ctx.dirty && saves };
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
    default:
      return { ...base, title: ctx.again ? 'Opnieuw kostprijzen toepassen?' : 'Kostprijzen toepassen?',
        confirmLabel: ctx.again ? 'Opnieuw toepassen' : 'Toepassen',
        message: 'De berekende kostprijs per stuk wordt op de producten in de catalogus gezet en overschrijft wat daar staat. '
          + 'Alle marges op verkooporders rekenen vanaf dan met deze cijfers.' };
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

/** Some product carries the costs of a newer container than this one. */
export function costsSupersededFor(lines: readonly { productId: number }[], products: readonly Pick<Product, 'id' | 'landedCostSource'>[],
  orderNumber: string): boolean {
  const byId = new Map(products.map((product) => [product.id, product]));
  return lines.some((line) => {
    const source = byId.get(line.productId)?.landedCostSource;
    return !!source && (compareNumbers(source, orderNumber) ?? 0) > 0;
  });
}

/* ---- the editor's Acties menu ------------------------------------------- */

export interface ActionsMenuState {
  status: PurchaseOrder['status'];
  /** The editor's nextStep()?.to. */
  step: string | null;
  lineCount: number;
  stockBooked: boolean | null | undefined;
  costsApplied: boolean;
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
    { id: 'apply', label: s.costsApplied ? 'Opnieuw kostprijzen toepassen' : 'Kostprijzen toepassen',
      hint: 'Gelande kostprijs per stuk naar de producten', iconName: 'tag' },
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
