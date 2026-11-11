import { computed, signal } from '@angular/core';
import type {
  PartnerCosts, PartnerProductTile, PartnerReportEntryRequest, PartnerReportPartRequest, PartnerReportRequest,
} from '../../core/api/partner-portal-api';
import { KIND_CHANNEL, PartnerKind } from './partner-format';
import { MeldingMoney, MoneyPart, meldingMoney, partComplete, round2, round4 } from './partner-money';

/**
 * A melding being typed: the products, per product the sale and (Veiling) the
 * buyback on the clock, the date and the extra kost. A plain class with
 * signals, owned by the screen that shows the form: the partner's Melden, or
 * a staff screen entering a melding Frans phoned in (FE2), which hands the
 * same draft to <app-partner-entry>.
 *
 * Which parts count follows the kind: Veiling = sale (+ buyback when opened),
 * Direct = sale only, Terugkoop = buyback only. Values of a hidden part stay,
 * so flipping the kind back loses nothing; they are just not sent.
 */

export type PriceMode = 'unit' | 'total';

export interface DraftPart {
  quantity: number | null;
  price: number | null;
  mode: PriceMode;
}

export interface DraftEntry {
  product: PartnerProductTile;
  sale: DraftPart;
  buyback: DraftPart;
  /** Veiling: "+ Teruggekocht op de klok" was opened on this product. */
  buybackOpen: boolean;
}

export interface DraftExtra {
  mode: 'AMOUNT' | 'PCT';
  value: number | null;
}

const EMPTY_PART: DraftPart = { quantity: null, price: null, mode: 'unit' };

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

function partRequest(part: DraftPart): PartnerReportPartRequest {
  return part.mode === 'total'
    ? { quantity: part.quantity!, totalEur: round2(part.price!) }
    : { quantity: part.quantity!, unitPriceEur: round4(part.price!) };
}

function typed(part: DraftPart): boolean {
  return part.quantity != null || part.price != null;
}

export class MeldingDraft {
  readonly kind = signal<PartnerKind>('veiling');
  /** yyyy-mm-dd; set by the screen to the server's today. */
  readonly soldOn = signal('');
  readonly entries = signal<DraftEntry[]>([]);
  readonly extra = signal<DraftExtra | null>(null);
  readonly note = signal('');
  /** The melding's percentages (the partner's settings). */
  readonly costs = signal<PartnerCosts>({ auctionCommissionPct: 4.5, auctionTransportPct: 5.5 });
  /** The most a product can sell (its stock there, in sales units). */
  readonly saleLimits = signal<ReadonlyMap<number, number>>(new Map());
  /**
   * The limit of a product not in saleLimits: the partner's list is all the
   * stock there is, so 0; null (the default) means no limit is known.
   */
  readonly saleLimitOtherwise = signal<number | null>(null);
  /** The first and last day the date row accepts (yyyy-mm-dd); empty = no limit. */
  readonly earliest = signal('');
  readonly latest = signal('');
  /** One per melding: the retries of a failed send carry the same one, so nothing is booked twice. */
  private clientRefValue = newClientRef();
  get clientRef(): string { return this.clientRefValue; }

  readonly channel = computed(() => KIND_CHANNEL[this.kind()]);
  readonly showsSale = computed(() => this.kind() !== 'terugkoop');

  /** Does this entry's buyback count (Terugkoop always, Veiling once opened)? */
  showsBuyback(entry: DraftEntry, kind: PartnerKind = this.kind()): boolean {
    return kind === 'terugkoop' || (kind === 'veiling' && entry.buybackOpen);
  }

  /** The extra kost that counts: not on Terugkoop, and only once a value is typed. */
  readonly activeExtra = computed<DraftExtra | null>(() => {
    const extra = this.extra();
    return this.showsSale() && extra && extra.value != null ? extra : null;
  });

  readonly money = computed<MeldingMoney>(() => {
    const kind = this.kind();
    const costs = this.costs();
    return meldingMoney({
      channel: KIND_CHANNEL[kind],
      commissionPct: costs.auctionCommissionPct,
      transportPct: costs.auctionTransportPct,
      extraCost: this.activeExtra(),
      entries: this.entries().map((entry) => ({
        sale: kind !== 'terugkoop' ? entry.sale as MoneyPart : null,
        buyback: this.showsBuyback(entry, kind) ? entry.buyback as MoneyPart : null,
      })),
    });
  });

  /** The most this product can sell, or null when no limit is known. */
  saleLimit(productId: number): number | null {
    return this.saleLimits().get(productId) ?? this.saleLimitOtherwise();
  }

  /** The sale quantity is above what lies there. */
  overLimit(entry: DraftEntry): boolean {
    const limit = this.saleLimit(entry.product.productId);
    return this.showsSale() && limit !== null && entry.sale.quantity != null && entry.sale.quantity > limit;
  }

  readonly extraProblem = computed<string | null>(() => {
    const extra = this.activeExtra();
    if (!extra) return null;
    if (extra.value! < 0) return 'Geen negatief bedrag';
    if (extra.mode === 'PCT' && extra.value! > 100) return 'Hoogstens 100 %';
    return null;
  });

  readonly dateProblem = computed<string | null>(() => {
    const day = this.soldOn();
    if (!day) return null;
    if (this.latest() && day > this.latest()) return 'Een datum in de toekomst kan niet';
    if (this.earliest() && day < this.earliest()) return 'Hoogstens 90 dagen terug';
    return null;
  });

  /** Every product has a quantity and a price for what it shows (the sale, the buyback once it shows). */
  readonly filled = computed(() => {
    const entries = this.entries();
    const kind = this.kind();
    return entries.length > 0 && entries.every((entry) =>
      (kind === 'terugkoop' || partComplete(entry.sale))
      && (!this.showsBuyback(entry, kind) || partComplete(entry.buyback)));
  });

  /** Filled in, nothing is over the stock, no refusal ahead. */
  readonly complete = computed(() =>
    this.filled() && !this.entries().some((entry) => this.overLimit(entry))
    && !this.extraProblem() && !this.dateProblem() && !this.money().costsExceedGross);

  /** Something was typed that a swipe back would lose. */
  readonly dirty = computed(() =>
    this.entries().some((entry) => typed(entry.sale) || typed(entry.buyback))
    || this.extra()?.value != null || this.note().trim() !== '');

  has(productId: number): boolean {
    return this.entries().some((entry) => entry.product.productId === productId);
  }

  add(product: PartnerProductTile): void {
    if (this.has(product.productId)) return;
    this.entries.update((list) => [...list, { product, sale: { ...EMPTY_PART }, buyback: { ...EMPTY_PART }, buybackOpen: false }]);
  }

  remove(productId: number): void {
    this.entries.update((list) => list.filter((entry) => entry.product.productId !== productId));
  }

  /** Step 1: a tap picks a product or puts it back. */
  toggle(product: PartnerProductTile): void {
    if (this.has(product.productId)) this.remove(product.productId); else this.add(product);
  }

  updatePart(productId: number, which: 'sale' | 'buyback', patch: Partial<DraftPart>): void {
    this.entries.update((list) => list.map((entry) => entry.product.productId !== productId ? entry
      : { ...entry, [which]: { ...entry[which], ...patch } }));
  }

  setBuybackOpen(productId: number, open: boolean): void {
    this.entries.update((list) => list.map((entry) => entry.product.productId !== productId ? entry
      : { ...entry, buybackOpen: open, buyback: open ? entry.buyback : { ...EMPTY_PART } }));
  }

  /** The body for POST /api/partner-portal/reports (staff add customerId). Only when complete. */
  request(): PartnerReportRequest {
    const kind = this.kind();
    const entries = this.entries().map((entry): PartnerReportEntryRequest => {
      const body: PartnerReportEntryRequest = { productId: entry.product.productId };
      if (kind !== 'terugkoop') body.sale = partRequest(entry.sale);
      if (this.showsBuyback(entry, kind)) body.buyback = partRequest(entry.buyback);
      return body;
    });
    const extra = this.activeExtra();
    return {
      channel: KIND_CHANNEL[kind],
      soldOn: this.soldOn() || null,
      clientRef: this.clientRefValue,
      note: this.note().trim() || null,
      extraCost: extra ? { mode: extra.mode, value: extra.mode === 'PCT' ? round4(extra.value!) : round2(extra.value!) } : null,
      entries,
    };
  }

  /**
   * The server's today and the first day it accepts. A date still on the old today moves along: it read "Vandaag"
   * all the while, so a portal left open overnight books the new day, never the evening before. A day he picked stays.
   */
  setToday(today: string, earliest: string): void {
    const before = this.latest();
    this.latest.set(today);
    this.earliest.set(earliest);
    if (!this.soldOn() || this.soldOn() === before) this.soldOn.set(today);
  }

  /** A new melding: empty form, a new clientRef; the kind and the date limits stay. */
  reset(today: string = this.latest()): void {
    this.entries.set([]);
    this.extra.set(null);
    this.note.set('');
    this.soldOn.set(today);
    this.clientRefValue = newClientRef();
  }
}
