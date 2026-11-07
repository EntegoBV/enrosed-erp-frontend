import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { AppliedPriceRow, CustomerPriceApi } from '../../core/api/customer-price-api';
import { EurPipe } from '../../shared/pipes';
import { Skeleton } from '../../shared/skeleton';
import { appliedDay, appliedProductName, CustomerPricePopup } from './customer-price-popup';

const ROWS_SHOWN = 6;
const sameAmount = (a: number, b: number): boolean => Math.abs(a - b) < 0.005;

/**
 * The pill beside a row: the last price was the klantprijs, it strays from the klantprijs of today, or the line
 * followed the catalogue (quiet "standaard": the figure shown is the catalogue price of today, not a stored one).
 */
export function appliedPill(row: Pick<AppliedPriceRow, 'lastPriceSource' | 'lastPriceExclVat' | 'agreedPriceExclVat'>): { label: string; tone: 'accent' | 'warn' | 'grey' } | null {
  /* A catalogue line stores no price: nothing of its own to compare with the klantprijs, so never "≠ klantprijs". */
  if (row.lastPriceExclVat == null) return { label: 'standaard', tone: 'grey' };
  if (row.agreedPriceExclVat != null && !sameAmount(row.agreedPriceExclVat, row.lastPriceExclVat)) return { label: '≠ klantprijs', tone: 'warn' };
  if (row.lastPriceSource === 'CUSTOMER') return { label: 'klantprijs', tone: 'accent' };
  return null;
}

/**
 * Gehanteerde prijzen on the customer sheet (CRM round): per product what
 * this customer was actually charged on quotes and invoices, last document
 * first. The Klantprijzen block above it says what was agreed; this one says
 * what happened. A row is the target on desk and phone alike (Emre: no small
 * glyph on the phone) and opens the product's popup with every document.
 */
@Component({
  selector: 'app-customer-applied-prices',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EurPipe, Skeleton, CustomerPricePopup],
  template: `
    <div class="ap-head">
      <b>Gehanteerde prijzen</b>
      @if (!loading() && !error() && rows().length) { <small>{{ summary() }}</small> }
    </div>

    @if (loading()) {
      <app-skeleton kind="list" [rows]="3" />
    } @else if (error()) {
      <p class="ap-none">Niet geladen. <button class="linklike" type="button" (click)="reload()">Opnieuw proberen</button></p>
    } @else {
      <div class="ap-list">
        @for (row of shown(); track row.productId) {
          @let pill = appliedPill(row);
          <button class="ap-row" type="button" (click)="open(row)">
            <span class="ap-name">
              <span>{{ nameOf(row) }}</span>
              @if (row.sku) { <span class="ap-sku">{{ row.sku }}</span> }
              @if (pill) { <i class="wk-pill" [class.tone-accent]="pill.tone === 'accent'" [class.tone-warn]="pill.tone === 'warn'" [class.tone-grey]="pill.tone === 'grey'">{{ pill.label }}</i> }
            </span>
            <!-- A catalogue line was charged the catalogue price: today's, since that day's is not stored; "op aanvraag" when there is none. -->
            <span class="ap-fig">
              @if (row.lastPriceExclVat != null) { {{ row.lastPriceExclVat | eur }} }
              @else if (row.cataloguePriceNow != null) { {{ row.cataloguePriceNow | eur }} }
              @else { op aanvraag }
            </span>
            <span class="ap-meta">{{ meta(row) }}</span>
            <span class="ap-unit">per {{ row.unit }}</span>
          </button>
        } @empty {
          <p class="ap-none">Nog geen offerte of factuur voor deze klant.</p>
        }
        @if (hidden() > 0) {
          <button class="linklike ap-more" type="button" (click)="all.set(true)">Alle {{ rows().length }} tonen</button>
        }
      </div>
    }

    @if (popup(); as row) {
      <app-customer-price-popup [customerId]="customerId()" [productId]="row.productId" [customerName]="customerName()"
                                [productName]="nameOf(row)" [showCustomerLink]="false" (closed)="popup.set(null)" />
    }
  `,
  styles: `
    :host { display: grid; gap: 10px; min-width: 0; }
    .ap-head { display: flex; align-items: baseline; gap: 8px; min-width: 0; font-size: 13px; }
    .ap-head b { flex: none; }
    .ap-head small { min-width: 0; overflow: hidden; color: var(--ink-2); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
    .ap-list { display: grid; min-width: 0; }
    .ap-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: 'name fig' 'meta unit';
      align-items: baseline; gap: 2px 12px; width: 100%; min-width: 0; min-height: 48px; margin: 0; padding: 8px 0;
      border: 0; border-top: 1px solid var(--rose-line); background: none; color: var(--ink); font: inherit; text-align: left; cursor: pointer; }
    .ap-name { grid-area: name; display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 13.5px; font-weight: 650; }
    .ap-name > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ap-sku { flex: none; max-width: 40%; color: var(--ink-2); font-size: 12px; font-weight: 500; }
    .ap-name .wk-pill { flex: none; font-style: normal; }
    .ap-fig { grid-area: fig; font-size: 14px; font-weight: 700; font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
    .ap-meta { grid-area: meta; min-width: 0; overflow: hidden; color: var(--ink-2); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
    .ap-unit { grid-area: unit; color: var(--ink-2); font-size: 12px; text-align: right; white-space: nowrap; }
    .ap-none { margin: 0; color: var(--ink-2); font-size: 13px; line-height: 1.45; }
    .ap-more { justify-self: start; margin-top: 6px; font-size: 12.5px; }
    @media (min-width: 1024px), (min-width: 680px) and (hover: hover) {
      .ap-row:hover .ap-name > span:first-child, .ap-row:focus-visible .ap-name > span:first-child { color: var(--rose-dark); }
    }
  `,
})
export class CustomerAppliedPrices {
  private readonly api = inject(CustomerPriceApi);
  private readonly destroy = inject(DestroyRef);

  readonly customerId = input.required<number>();
  /** For the popup's subtitle; the list itself does without. */
  readonly customerName = input('');

  readonly rows = signal<AppliedPriceRow[]>([]);
  readonly loading = signal(true);
  readonly error = signal(false);
  readonly all = signal(false);
  readonly popup = signal<AppliedPriceRow | null>(null);
  /** Drops the answer of a load another customer has overtaken. */
  private version = 0;

  readonly appliedPill = appliedPill;
  readonly nameOf = appliedProductName;

  readonly shown = computed(() => this.all() ? this.rows() : this.rows().slice(0, ROWS_SHOWN));
  readonly hidden = computed(() => this.all() ? 0 : Math.max(0, this.rows().length - ROWS_SHOWN));
  /** "12 producten · laatst 3 nov": the rows come last document first, so the first one carries the latest date. */
  readonly summary = computed(() => {
    const rows = this.rows();
    const count = `${rows.length} ${rows.length === 1 ? 'product' : 'producten'}`;
    const latest = rows.reduce<string>((best, row) => row.lastOrderDate > best ? row.lastOrderDate : best, rows[0]?.lastOrderDate ?? '');
    return latest ? `${count} · laatst ${appliedDay(latest)}` : count;
  });

  constructor() {
    effect(() => {
      const customerId = this.customerId();
      untracked(() => {
        this.all.set(false);
        this.popup.set(null);
        void this.load(customerId);
      });
    });
  }

  reload(): void {
    void this.load(this.customerId());
  }

  private async load(customerId: number): Promise<void> {
    const version = ++this.version;
    this.loading.set(true);
    this.error.set(false);
    try {
      const rows = await this.api.appliedPrices(customerId);
      if (this.destroy.destroyed || version !== this.version) return;
      this.rows.set(Array.isArray(rows) ? rows : []);
    } catch (failure: unknown) {
      if (this.destroy.destroyed || version !== this.version) return;
      this.rows.set([]);
      /* An older server has no applied prices (404, during the rolling deploy): the block stays quiet, as the K marker does. */
      if (!(failure instanceof HttpErrorResponse && failure.status === 404)) this.error.set(true);
    } finally {
      if (!this.destroy.destroyed && version === this.version) this.loading.set(false);
    }
  }

  /** "laatst 3 nov · OF-2026-031 · 4 documenten" */
  meta(row: AppliedPriceRow): string {
    const count = `${row.documentCount} ${row.documentCount === 1 ? 'document' : 'documenten'}`;
    return [`laatst ${appliedDay(row.lastOrderDate)}`, row.lastDocumentNumber, count].filter(Boolean).join(' · ');
  }

  open(row: AppliedPriceRow): void {
    this.popup.set(row);
  }
}
