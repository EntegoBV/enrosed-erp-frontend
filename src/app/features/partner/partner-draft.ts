import { computed, signal } from '@angular/core';
import {
  PARTNER_API_VERSION,
  type PartnerBuyerRef, type PartnerChannel, type PartnerCosts, type PartnerCountUnit, type PartnerCountUnitKey,
  type PartnerExtraCostLine, type PartnerProductTile, type PartnerReport, type PartnerReportBuyback, type PartnerReportEntry,
  type PartnerReportEntryRequest, type PartnerReportPartRequestV2, type PartnerReportRequest, type PartnerReportSale,
} from '../../core/api/partner-portal-api';
import { KIND_CHANNEL, PartnerKind, reportKind } from './partner-format';
import { MeldingMoney, MoneyPart, meldingMoney, partComplete, round2, round4 } from './partner-money';
import {
  defaultUnitOf, maxCountOf, pieceUnit, piecesOf, piecesPerSalesUnit, salesUnitsOf, switchCount, unitOf,
} from './partner-units';

/**
 * A melding being typed or edited: the products, per product the sale and
 * (Veiling) the buyback on the clock, each as a count in a count unit with a
 * price per piece; the date, the extra kost lines and (Direct) the buyer. A
 * plain class with signals, owned by the screen that shows the form: the
 * partner's Melden, or a staff screen, which hands the same draft to
 * <app-partner-entry>.
 *
 * Which parts count follows the kind: Veiling = sale (+ buyback when opened),
 * Direct = sale only, Terugkoop = buyback only. Values of a hidden part stay,
 * so flipping the kind back loses nothing; they are just not sent.
 *
 * Editing (`loadReport`): the costs are the melding's own percentages while
 * its channel stays, the sale limit of a product adds the melding's own old
 * sale and takes off its own old buyback, an unchanged date of any age is
 * fine, and `dirty` compares with what was loaded.
 */

export interface DraftPart {
  unit: PartnerCountUnitKey;
  count: number | null;
  /** Average per piece (per roos). */
  price: number | null;
  /** A unit switch kept the count (the pieces did not fit the new unit): said once under the row. */
  kept?: boolean;
}

export interface DraftEntry {
  product: PartnerProductTile;
  sale: DraftPart;
  buyback: DraftPart;
  /** Veiling: "Teruggekocht op de klok" was opened on this product. */
  buybackOpen: boolean;
}

export interface DraftExtraLine {
  /** Stable key for the list (never sent). */
  key: number;
  description: string;
  mode: 'AMOUNT' | 'PCT';
  value: number | null;
}

/** The melding being edited, as it was loaded. */
export interface DraftEditing {
  id: number;
  number: string;
  /** Sent back as expectedToken. */
  token: string;
  channel: PartnerChannel;
  /** The melding's own percentages (its snapshot). */
  costs: PartnerCosts;
  soldOn: string;
}

export const MAX_EXTRA_LINES = 5;
export const EXTRA_DESCRIPTION_MAX = 80;

/** A fresh id for one melding and its retries. */
export function newClientRef(): string {
  const cryptoApi = globalThis.crypto as Crypto | undefined;
  if (cryptoApi?.randomUUID) {
    try { return cryptoApi.randomUUID(); } catch { /* not a secure context: fall through */ }
  }
  const bytes = new Uint8Array(16);
  if (cryptoApi?.getRandomValues) cryptoApi.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function typed(part: DraftPart): boolean {
  return part.count != null || part.price != null;
}

/**
 * A part nothing is typed in yet: a sale counts in Enrosed's default unit for the product, a buyback on the clock
 * always per piece (stolp, roos): lots bought back are a few pieces, and 6 typed in a unit of 24 would book 144.
 */
function emptyPart(product: PartnerProductTile, which: 'sale' | 'buyback' = 'sale'): DraftPart {
  return { unit: (which === 'buyback' ? pieceUnit(product) : defaultUnitOf(product)).unit, count: null, price: null };
}

/** The product of a melding's entry as a tile (round 2 sends the whole tile with every entry). */
export function tileOfEntry(entry: PartnerReportEntry): PartnerProductTile {
  return {
    productId: entry.productId, sku: entry.sku ?? null, name: entry.name, variant: entry.variant, colourHex: entry.colourHex,
    familyId: entry.familyId ?? null, familyName: entry.familyName ?? null, unitOne: entry.unitOne, unitOther: entry.unitOther,
    piecesPerUnit: entry.piecesPerUnit ?? null, hasPhoto: entry.hasPhoto, photoVersion: entry.photoVersion,
    salesUnit: entry.salesUnit, piecesPerSalesUnit: entry.piecesPerSalesUnit, pieceOne: entry.pieceOne, pieceOther: entry.pieceOther,
    countUnits: entry.countUnits, defaultUnit: entry.defaultUnit,
  };
}

/**
 * What a booked part was typed as: the entered unit and count when they still make the booked pieces with today's
 * unit (a carton's content may have changed since), else the pieces per stuk; the price per piece.
 */
export function partOfReport(product: PartnerProductTile, part: PartnerReportSale | PartnerReportBuyback): DraftPart {
  const perSalesUnit = piecesPerSalesUnit(product);
  const pieces = part.pieces ?? part.quantity * perSalesUnit;
  const price = part.piecePriceEur ?? round4(part.unitPriceEur / perSalesUnit);
  const entered = unitOf(product, part.enteredUnit);
  if (entered && part.enteredCount && piecesOf(entered, part.enteredCount) === pieces
      && salesUnitsOf(product, entered, part.enteredCount) === part.quantity) {
    return { unit: entered.unit, count: part.enteredCount, price };
  }
  const piece = pieceUnit(product);
  if (salesUnitsOf(product, piece, pieces) === part.quantity) return { unit: piece.unit, count: pieces, price };
  return { unit: piece.unit, count: part.quantity, price };
}

export class MeldingDraft {
  readonly kind = signal<PartnerKind>('veiling');
  /** yyyy-mm-dd; set by the screen to the server's today. */
  readonly soldOn = signal('');
  readonly entries = signal<DraftEntry[]>([]);
  readonly extraCosts = signal<DraftExtraLine[]>([]);
  readonly note = signal('');
  /** The buyer of a direct sale. */
  readonly buyer = signal<PartnerBuyerRef | null>(null);
  /** A direct sale needs a buyer before it is sent (the partner's portal; staff may leave it out). */
  readonly buyerRequired = signal(false);
  /** The partner's percentages (its settings); an edit keeps the melding's own while its channel stays. */
  readonly costs = signal<PartnerCosts>({ auctionCommissionPct: 4.5, auctionTransportPct: 5.5 });
  /** The most a product can sell (its stock there, in sales units; an edit adds its own old sale). */
  readonly saleLimits = signal<ReadonlyMap<number, number>>(new Map());
  /**
   * The limit of a product not in saleLimits: the partner's list is all the
   * stock there is, so 0; null (the default) means no limit is known.
   */
  readonly saleLimitOtherwise = signal<number | null>(null);
  /** The first and last day the date row accepts (yyyy-mm-dd); empty = no limit. */
  readonly earliest = signal('');
  readonly latest = signal('');
  /** The melding being edited; null for a new one. */
  readonly editing = signal<DraftEditing | null>(null);
  /** Per product what the edited melding booked (sales units): the sale limit adds it back. */
  private ownOld = new Map<number, { sale: number; buyback: number }>();
  /** What was loaded, to tell an edit with changes from one without. */
  private readonly snapshot = signal<string | null>(null);
  private extraKey = 0;
  /** One per melding: the retries of a failed send carry the same one, so nothing is booked twice. */
  private clientRefValue = newClientRef();
  get clientRef(): string { return this.clientRefValue; }

  readonly channel = computed<PartnerChannel>(() => KIND_CHANNEL[this.kind()]);
  readonly showsSale = computed(() => this.kind() !== 'terugkoop');

  /** The percentages that apply: the edited melding's own while its channel stays, else the settings. */
  readonly effectiveCosts = computed<PartnerCosts>(() => {
    const editing = this.editing();
    return editing && editing.channel === this.channel() ? editing.costs : this.costs();
  });

  /** Does this entry's buyback count (Terugkoop always, Veiling once opened)? */
  showsBuyback(entry: DraftEntry, kind: PartnerKind = this.kind()): boolean {
    return kind === 'terugkoop' || (kind === 'veiling' && entry.buybackOpen);
  }

  /* ---- units */

  unitOf(entry: DraftEntry, which: 'sale' | 'buyback'): PartnerCountUnit {
    return unitOf(entry.product, entry[which].unit) ?? defaultUnitOf(entry.product);
  }

  /** Whole sales units of the part, or null (no count, or not whole). */
  salesUnits(entry: DraftEntry, which: 'sale' | 'buyback'): number | null {
    return salesUnitsOf(entry.product, this.unitOf(entry, which), entry[which].count);
  }

  pieces(entry: DraftEntry, which: 'sale' | 'buyback'): number {
    return piecesOf(this.unitOf(entry, which), entry[which].count);
  }

  /** A count was typed that books no whole sales units (37 rozen of displays of 12). */
  notWhole(entry: DraftEntry, which: 'sale' | 'buyback'): boolean {
    const countValue = entry[which].count;
    return countValue != null && countValue > 0 && this.salesUnits(entry, which) === null;
  }

  private moneyPart(entry: DraftEntry, which: 'sale' | 'buyback'): MoneyPart {
    return { salesUnits: this.salesUnits(entry, which), piecesPerSalesUnit: piecesPerSalesUnit(entry.product), piecePrice: entry[which].price };
  }

  partComplete(entry: DraftEntry, which: 'sale' | 'buyback'): boolean {
    return partComplete(this.moneyPart(entry, which));
  }

  /** The extra kost lines that count: not on Terugkoop, and only once a value is typed. */
  readonly activeExtras = computed<DraftExtraLine[]>(() =>
    this.showsSale() ? this.extraCosts().filter((line) => line.value != null) : []);

  readonly money = computed<MeldingMoney>(() => {
    const kind = this.kind();
    const costs = this.effectiveCosts();
    const extras = this.showsSale() ? this.extraCosts() : [];
    return meldingMoney({
      channel: KIND_CHANNEL[kind],
      commissionPct: costs.auctionCommissionPct,
      transportPct: costs.auctionTransportPct,
      extraCosts: extras.map((line) => ({ mode: line.mode, value: line.value })),
      entries: this.entries().map((entry) => ({
        sale: kind !== 'terugkoop' ? this.moneyPart(entry, 'sale') : null,
        buyback: this.showsBuyback(entry, kind) ? this.moneyPart(entry, 'buyback') : null,
      })),
    });
  });

  /* ---- limits */

  /** The most this product can sell (sales units), or null when no limit is known. */
  saleLimit(productId: number): number | null {
    return this.saleLimits().get(productId) ?? this.saleLimitOtherwise();
  }

  /** The most the sale can count in its unit, or null without a limit. */
  maxCount(entry: DraftEntry): number | null {
    const limit = this.saleLimit(entry.product.productId);
    return limit === null ? null : maxCountOf(entry.product, this.unitOf(entry, 'sale'), limit);
  }

  /**
   * The sale is above what lies there. An edit that keeps a product's quantities (only prices or costs change) is
   * never held back: the server changes the money on the same parts and moves no stock.
   */
  overLimit(entry: DraftEntry): boolean {
    if (!this.showsSale()) return false;
    const limit = this.saleLimit(entry.product.productId);
    const units = this.salesUnits(entry, 'sale');
    if (limit === null || units === null || units <= limit) return false;
    const old = this.ownOld.get(entry.product.productId);
    if (this.editing() && old && old.sale === units && old.buyback === (this.showsBuyback(entry) ? this.salesUnits(entry, 'buyback') ?? 0 : 0)) return false;
    return true;
  }

  /**
   * The stock there (sales units per product) as the sale limits; an edit adds the melding's own old sale and takes
   * off its own old buyback. Call again after every refresh of the stock.
   */
  applyStock(stock: ReadonlyMap<number, number>, otherwise: number | null = 0): void {
    const limits = new Map(stock);
    for (const [productId, old] of this.ownOld) {
      limits.set(productId, Math.max(0, (stock.get(productId) ?? 0) + old.sale - old.buyback));
    }
    this.saleLimits.set(limits);
    this.saleLimitOtherwise.set(otherwise);
  }

  /* ---- problems */

  extraProblemOf(line: DraftExtraLine): string | null {
    if (line.description.trim().length > EXTRA_DESCRIPTION_MAX) return `Hoogstens ${EXTRA_DESCRIPTION_MAX} tekens`;
    if (line.value == null) return null;
    if (line.value < 0) return 'Geen negatief bedrag';
    if (line.mode === 'PCT' && line.value > 100) return 'Hoogstens 100 %';
    return null;
  }

  readonly extraProblem = computed<string | null>(() => {
    for (const line of this.activeExtras()) {
      const problem = this.extraProblemOf(line);
      if (problem) return problem;
    }
    return null;
  });

  readonly dateProblem = computed<string | null>(() => {
    const day = this.soldOn();
    if (!day) return null;
    if (this.latest() && day > this.latest()) return 'Een datum in de toekomst kan niet';
    /* An edit keeps its own date, however old; only a changed date must lie within the 90 days. */
    if (this.editing()?.soldOn === day) return null;
    if (this.earliest() && day < this.earliest()) return 'Hoogstens 90 dagen terug';
    return null;
  });

  readonly buyerProblem = computed<string | null>(() =>
    this.channel() === 'DIRECT' && this.buyerRequired() && !this.buyer() ? 'Kies de klant of voeg er een toe' : null);

  /** Every product has a whole count and a price for what it shows (the sale, the buyback once it shows). */
  readonly filled = computed(() => {
    const entries = this.entries();
    const kind = this.kind();
    return entries.length > 0 && entries.every((entry) =>
      (kind === 'terugkoop' || this.partComplete(entry, 'sale'))
      && (!this.showsBuyback(entry, kind) || this.partComplete(entry, 'buyback')));
  });

  /** Filled in, nothing is over the stock, no refusal ahead. */
  readonly complete = computed(() =>
    this.filled() && !this.entries().some((entry) => this.overLimit(entry))
    && !this.extraProblem() && !this.dateProblem() && !this.buyerProblem() && !this.money().costsExceedGross);

  /** What the form holds now, to compare with what an edit loaded. */
  private readonly signature = computed(() => {
    const kind = this.kind();
    const part = (entry: DraftEntry, which: 'sale' | 'buyback') =>
      [entry[which].unit, entry[which].count, entry[which].price == null ? null : round4(entry[which].price!)];
    return JSON.stringify({
      k: kind,
      d: this.soldOn(),
      e: this.entries().map((entry) => [entry.product.productId,
        kind !== 'terugkoop' ? part(entry, 'sale') : null, this.showsBuyback(entry, kind) ? part(entry, 'buyback') : null]),
      x: this.activeExtras().map((line) => [line.description.trim(), line.mode, line.mode === 'PCT' ? round4(line.value!) : round2(line.value!)]),
      b: this.channel() === 'DIRECT' ? this.buyer()?.customerId ?? null : null,
      n: this.note().trim(),
    });
  });

  /** Something would be lost by leaving: a new melding with typed values, an edit that differs from what was loaded. */
  readonly dirty = computed(() => {
    const snapshot = this.snapshot();
    if (snapshot !== null) return this.signature() !== snapshot;
    return this.entries().some((entry) => typed(entry.sale) || typed(entry.buyback))
      || this.extraCosts().some((line) => line.value != null || line.description.trim() !== '') || this.note().trim() !== '';
  });

  /* ---- products */

  has(productId: number): boolean {
    return this.entries().some((entry) => entry.product.productId === productId);
  }

  add(product: PartnerProductTile): void {
    if (this.has(product.productId)) return;
    this.entries.update((list) => [...list, { product, sale: emptyPart(product), buyback: emptyPart(product, 'buyback'), buybackOpen: false }]);
  }

  remove(productId: number): void {
    this.entries.update((list) => list.filter((entry) => entry.product.productId !== productId));
  }

  /** The picker: a tick adds a product or puts it back. */
  toggle(product: PartnerProductTile): void {
    if (this.has(product.productId)) this.remove(product.productId); else this.add(product);
  }

  updatePart(productId: number, which: 'sale' | 'buyback', patch: Partial<DraftPart>): void {
    this.entries.update((list) => list.map((entry) => entry.product.productId !== productId ? entry
      : { ...entry, [which]: { ...entry[which], kept: false, ...patch } }));
  }

  /** Another count unit: the pieces stay when they fit in whole units of it, else the count stays (and says so). */
  setUnit(productId: number, which: 'sale' | 'buyback', key: PartnerCountUnitKey): void {
    const entry = this.entries().find((item) => item.product.productId === productId);
    const to = entry ? unitOf(entry.product, key) : null;
    if (!entry || !to || to.unit === entry[which].unit) return;
    const switched = switchCount(entry.product, this.unitOf(entry, which), entry[which].count, to);
    this.updatePart(productId, which, { unit: to.unit, count: switched.count, kept: switched.kept });
  }

  setBuybackOpen(productId: number, open: boolean): void {
    this.entries.update((list) => list.map((entry) => entry.product.productId !== productId ? entry
      : { ...entry, buybackOpen: open, buyback: open ? entry.buyback : emptyPart(entry.product, 'buyback') }));
  }

  /* ---- extra kost lines */

  addExtra(mode: 'AMOUNT' | 'PCT' = 'AMOUNT'): void {
    if (this.extraCosts().length >= MAX_EXTRA_LINES) return;
    this.extraCosts.update((lines) => [...lines, { key: ++this.extraKey, description: '', mode, value: null }]);
  }

  updateExtra(key: number, patch: Partial<Omit<DraftExtraLine, 'key'>>): void {
    this.extraCosts.update((lines) => lines.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  removeExtra(key: number): void {
    this.extraCosts.update((lines) => lines.filter((line) => line.key !== key));
  }

  /* ---- the body */

  private partRequest(entry: DraftEntry, which: 'sale' | 'buyback'): PartnerReportPartRequestV2 {
    const part = entry[which];
    return { enteredUnit: this.unitOf(entry, which).unit, enteredCount: part.count!, piecePriceEur: round4(part.price!) };
  }

  /**
   * The round-2 body for POST (new) or PUT (edit: + expectedToken) /api/partner-portal/reports; staff add
   * customerId. Only when complete. The screen sends it only to a server that answers apiVersion 2.
   */
  request(): PartnerReportRequest {
    const kind = this.kind();
    const entries = this.entries().map((entry): PartnerReportEntryRequest => {
      const body: PartnerReportEntryRequest = { productId: entry.product.productId };
      if (kind !== 'terugkoop') body.sale = this.partRequest(entry, 'sale');
      if (this.showsBuyback(entry, kind)) body.buyback = this.partRequest(entry, 'buyback');
      return body;
    });
    const extraCosts: PartnerExtraCostLine[] = this.activeExtras().map((line) => ({
      description: line.description.trim() || null,
      mode: line.mode,
      value: line.mode === 'PCT' ? round4(line.value!) : round2(line.value!),
    }));
    const body: PartnerReportRequest = {
      apiVersion: PARTNER_API_VERSION,
      channel: KIND_CHANNEL[kind],
      soldOn: this.soldOn() || null,
      clientRef: this.clientRefValue,
      note: this.note().trim() || null,
      extraCosts,
      entries,
    };
    const buyer = this.buyer();
    if (body.channel === 'DIRECT' && buyer) body.buyerCustomerId = buyer.customerId;
    const editing = this.editing();
    if (editing) body.expectedToken = editing.token;
    return body;
  }

  /* ---- dates, reset, edit */

  /**
   * The server's today and the first day it accepts. A date still on the old today moves along: it read "Vandaag"
   * all the while, so a portal left open overnight books the new day, never the evening before. A day he picked
   * stays; an edit keeps its own date (and accepts it however old).
   */
  setToday(today: string, earliest: string): void {
    const before = this.latest();
    const editing = this.editing();
    this.latest.set(today);
    this.earliest.set(editing && editing.soldOn < earliest ? editing.soldOn : earliest);
    if (editing) return;
    if (!this.soldOn() || this.soldOn() === before) this.soldOn.set(today);
  }

  /** A new melding: empty form, a new clientRef; the kind, the costs and the date limits stay. */
  reset(today: string = this.latest()): void {
    this.entries.set([]);
    this.extraCosts.set([]);
    this.note.set('');
    this.buyer.set(null);
    this.editing.set(null);
    this.ownOld = new Map();
    this.snapshot.set(null);
    this.soldOn.set(today);
    this.clientRefValue = newClientRef();
  }

  /**
   * Loads a saved melding to edit it: its kind, date, products with what was typed, its extra kost lines, buyer
   * and note; its own percentages; its own quantities for the limits. Call applyStock and setToday after it.
   */
  loadReport(report: PartnerReport): void {
    const kind = reportKind(report);
    this.kind.set(kind);
    this.soldOn.set(report.soldOn);
    this.note.set(report.note ?? '');
    this.buyer.set(report.buyer ?? null);
    const ownOld = new Map<number, { sale: number; buyback: number }>();
    this.entries.set(report.entries.map((entry): DraftEntry => {
      const product = tileOfEntry(entry);
      ownOld.set(entry.productId, { sale: entry.sale?.quantity ?? 0, buyback: entry.buyback?.quantity ?? 0 });
      return {
        product,
        sale: entry.sale ? partOfReport(product, entry.sale) : emptyPart(product),
        buyback: entry.buyback ? partOfReport(product, entry.buyback) : emptyPart(product, 'buyback'),
        buybackOpen: kind === 'veiling' && !!entry.buyback,
      };
    }));
    this.ownOld = ownOld;
    const lines = report.extraCosts ?? (report.extraCost ? [{ description: null, ...report.extraCost }] : []);
    this.extraCosts.set(lines.map((line) => ({ key: ++this.extraKey, description: line.description ?? '', mode: line.mode, value: line.value })));
    this.editing.set({
      id: report.id, number: report.number, token: report.editToken ?? report.updatedAt ?? report.createdAt,
      channel: report.channel, soldOn: report.soldOn,
      costs: { auctionCommissionPct: report.commissionPct, auctionTransportPct: report.transportPct },
    });
    this.clientRefValue = newClientRef();
    this.snapshot.set(this.signature());
  }

  /** A loaded melding as a new draft (staff screens that keep one draft per page can call loadReport instead). */
  static fromReport(report: PartnerReport): MeldingDraft {
    const draft = new MeldingDraft();
    draft.loadReport(report);
    return draft;
  }

  /** After a successful save: what the form holds is what is stored (nothing to lose on leaving). */
  markSaved(): void {
    this.snapshot.set(this.signature());
  }
}
