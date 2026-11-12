import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AppliedPriceEntry, AppliedPriceRow, CustomerPriceApi, followsCatalogue, type AppliedDocType } from '../../core/api/customer-price-api';
import type { SalesLinePriceSource } from '../../core/api/models';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { Icon } from '../../shared/icon';
import { DateNlPipe, EurPipe } from '../../shared/pipes';
import { Skeleton } from '../../shared/skeleton';
import { Sheet } from '../../shared/ui';
import { STATUS_LABEL } from '../sales/quote-status';

const DOC_TYPE_LABEL: Record<AppliedDocType, string> = { OFFERTE: 'Offerte', FACTUUR: 'Factuur' };

/** The quiet pill behind a document line's price: where that price came from. */
export function appliedSourceLabel(source: SalesLinePriceSource | null | undefined): string | null {
  switch (source) {
    case 'CUSTOMER': return 'Klantprijs';
    case 'STANDARD': return 'Standaard';
    case 'MANUAL': return 'Eigen prijs';
    default: return null;
  }
}

/** "3 nov": a date as a list row cites it; a date-only value is read in UTC so it never shifts a day. */
export function appliedDay(value: string | null | undefined): string {
  if (!value) return '';
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(dateOnly ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('nl-BE', { day: 'numeric', month: 'short', ...(dateOnly ? { timeZone: 'UTC' } : {}) })
    .format(date).replace('.', '');
}

/** The product a row stands for, also once it is gone from the catalogue. */
export function appliedProductName(row: Pick<AppliedPriceRow, 'productId' | 'name'>): string {
  return row.name?.trim() || `Verwijderd product #${row.productId}`;
}

/**
 * One product for one customer: the price agreed, the catalogue price and
 * what the last document charged, then every quote and invoice the pair is
 * on (CRM round, Emre: "welke prijs ik daarop heb gehanteerd"). Opened from
 * the customer's Gehanteerde prijzen list, from a product's Klantprijzen
 * list (then with a way to the customer) and from the K beside a sales line.
 * An iOS sheet on the phone, a centred dialog on the desk; the cells are the
 * phone kit's, which the desk only tones down.
 */
@Component({
  selector: 'app-customer-price-popup',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, Sheet, Skeleton, DateNlPipe, EurPipe],
  template: `
    <app-sheet [title]="productName() || 'Gehanteerde prijs'" variant="ios" [backdropCloses]="true" (closed)="closed.emit()">
      <div body class="cpp">
        @if (customerName()) { <p class="cpp__sub">{{ customerName() }}</p> }
        @if (loading()) {
          <div class="cpp__pad"><app-skeleton kind="lines" [rows]="3" /></div>
        } @else if (error()) {
          <p class="cpp__none">Niet geladen. <button class="linklike" type="button" (click)="load()">Opnieuw proberen</button></p>
        } @else {
          @if (figures(); as figures) {
            <div class="ios-group">
              <div class="ios-cell">
                <span class="ios-cell__body"><span class="ios-cell__title">Klantprijs</span></span>
                <span class="ios-cell__trail">
                  @if (figures.agreed != null) {
                    <span class="ios-cell__value ios-cell__value--strong cpp__accent">{{ figures.agreed | eur }}</span>
                    @if (figures.unit) { <span class="ios-cell__meta">per {{ figures.unit }}</span> }
                  } @else { <span class="ios-cell__value">geen</span> }
                </span>
              </div>
              <div class="ios-cell">
                <span class="ios-cell__body"><span class="ios-cell__title">Standaardprijs</span></span>
                <span class="ios-cell__trail">
                  @if (figures.catalogue != null) {
                    <span class="ios-cell__value ios-cell__value--strong">{{ figures.catalogue | eur }}</span>
                    @if (figures.unit) { <span class="ios-cell__meta">per {{ figures.unit }}</span> }
                  } @else { <span class="ios-cell__value">op aanvraag</span> }
                </span>
              </div>
              @if (figures.last; as row) {
                <div class="ios-cell">
                  <span class="ios-cell__body">
                    <span class="ios-cell__title">Laatst gehanteerd</span>
                    <span class="ios-cell__sub">{{ row.lastOrderDate | dateNl }}@if (row.lastDocumentNumber) { · {{ row.lastDocumentNumber }} }</span>
                  </span>
                  <!-- A catalogue line stored no price: it was charged the catalogue price, shown as today's with the pill saying so. -->
                  <span class="ios-cell__trail">
                    @if (row.lastPriceExclVat != null) {
                      <span class="ios-cell__value ios-cell__value--strong">{{ row.lastPriceExclVat | eur }}</span>
                      <span class="ios-cell__meta">per {{ row.unit }}</span>
                    } @else {
                      @if (row.cataloguePriceNow != null) {
                        <span class="ios-cell__value ios-cell__value--strong">{{ row.cataloguePriceNow | eur }}</span>
                      } @else { <span class="ios-cell__value">op aanvraag</span> }
                      <i class="wk-pill cpp__pill tone-grey">Standaard</i>
                    }
                  </span>
                </div>
              }
            </div>
          }
          <h3 class="cpp__head">Documenten</h3>
          @if (entries().length) {
            <div class="ios-group">
              @for (entry of entries(); track entry.documentId) {
                <!-- The document open in the editor is listed as what it is, not as history, and leads nowhere: a link to itself would only raise the unsaved-changes prompt. -->
                @if (entry.documentId === currentDocumentId()) {
                  <div class="ios-cell cpp__current">
                    <span class="ios-cell__body">
                      <span class="ios-cell__title ios-cell__title--strong">{{ docLabel(entry) }}</span>
                      <span class="ios-cell__sub">dit document · {{ entry.orderDate | dateNl }} · × {{ quantity(entry) }}</span>
                    </span>
                    <span class="ios-cell__trail">
                      <span class="ios-cell__value">{{ entryPrice(entry) }}</span>
                      @if (followsCatalogue(entry)) { <i class="wk-pill cpp__pill tone-grey">Standaard</i> }
                    </span>
                  </div>
                } @else {
                  <a class="ios-cell" [routerLink]="['/sales', entry.documentId]" (click)="closed.emit()">
                    <span class="ios-cell__body">
                      <span class="ios-cell__title ios-cell__title--strong">{{ docLabel(entry) }}</span>
                      <span class="ios-cell__sub">{{ entry.orderDate | dateNl }} · {{ statusLabel(entry) }} · × {{ quantity(entry) }}@if (entry.manualDiscountPct) { · −{{ entry.manualDiscountPct }} %}</span>
                    </span>
                    <span class="ios-cell__trail">
                      <span class="ios-cell__value ios-cell__value--strong">{{ entryPrice(entry) }}</span>
                      @if (followsCatalogue(entry)) {
                        <i class="wk-pill cpp__pill tone-grey">Standaard</i>
                      } @else if (sourceLabel(entry.priceSource); as label) {
                        <i class="wk-pill cpp__pill" [class.tone-accent]="entry.priceSource === 'CUSTOMER'" [class.tone-grey]="entry.priceSource !== 'CUSTOMER'">{{ label }}</i>
                      }
                    </span>
                    <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
                  </a>
                }
              }
            </div>
          } @else {
            <p class="cpp__none">Nog niet op een document gebruikt.</p>
          }
        }
      </div>
      <div foot style="display:contents">
        @if (desktop.active()) {
          @if (showCustomerLink() && customerName()) {
            <a class="btn" [routerLink]="['/customers']" [queryParams]="{ q: customerName() }" (click)="closed.emit()">Naar klant ›</a>
          }
          <span class="spacer"></span>
          <button class="btn" type="button" (click)="closed.emit()">Sluiten</button>
        } @else {
          <div class="cpp__foot">
            @if (showCustomerLink() && customerName()) {
              <a class="ios-capsule ios-capsule--block" [routerLink]="['/customers']" [queryParams]="{ q: customerName() }" (click)="closed.emit()">Naar klant ›</a>
            }
            <button class="ios-capsule ios-capsule--block ios-capsule--tinted" type="button" (click)="closed.emit()">Sluiten</button>
          </div>
        }
      </div>
    </app-sheet>
  `,
  styles: `
    /* Opened from inside a chip, a dark price preview or a line marker: the dialog reads in the body's type again. */
    :host {
      display: contents; color: var(--ink); font-size: 15px; font-weight: 400; line-height: 1.5; letter-spacing: normal;
      text-align: left; text-transform: none; white-space: normal;
    }
    .cpp { display: grid; gap: 12px; min-width: 0; }
    .cpp__sub, .cpp__none, .cpp__head { margin: 0; padding: 0 calc(var(--ios-inset) + 16px); }
    .cpp__sub { margin-top: -4px; color: var(--muted); font-size: 13.5px; line-height: 1.4; text-align: center; overflow-wrap: anywhere; }
    .cpp__head { margin-top: 4px; margin-bottom: -5px; color: var(--muted); font-size: 13px; font-weight: 600; letter-spacing: .02em; text-transform: uppercase; }
    .cpp__none { color: var(--muted); font-size: 13.5px; line-height: 1.45; }
    .cpp__pad { padding: 0 var(--ios-inset); }
    .cpp__accent { color: var(--rose-dark); }
    .cpp__pill { margin-top: 2px; }
    .cpp__current { color: var(--muted); }
    .cpp__foot { display: grid; flex: 1; gap: 8px; }
    .cpp__foot .ios-capsule--block { text-decoration: none; }
    .ios-cell__sub { white-space: normal; }
    /* The dialog's own body is already padded, and the cells sit on white: a hairline keeps the groups legible. */
    @media (min-width: 1024px), (min-width: 680px) and (hover: hover) {
      .cpp { --ios-inset: 0px; --ios-radius: 12px; --ios-row: 44px; }
      .cpp__sub { margin-top: -6px; text-align: left; }
      .cpp__head { padding-left: 2px; }
      .cpp__none { padding: 0; }
      .ios-group { border: 1px solid var(--line); }
      .ios-cell { padding: 7px 14px; font-size: 14px; }
      .ios-cell__title, .ios-cell__value { font-size: 14px; }
      .ios-cell__sub { font-size: 12.5px; }
      .ios-cell__meta { font-size: 12px; }
      a.ios-cell:hover .ios-cell__title, a.ios-cell:focus-visible .ios-cell__title { color: var(--rose-dark); }
      .btn { text-decoration: none; }
    }
  `,
})
export class CustomerPricePopup {
  private readonly api = inject(CustomerPriceApi);
  private readonly destroy = inject(DestroyRef);
  readonly desktop = inject(DesktopViewport);

  readonly customerId = input.required<number>();
  readonly productId = input.required<number>();
  readonly customerName = input('');
  readonly productName = input('');
  /** From a product's list the customer is one step away; from the customer's own sheet the link would lead in a circle. */
  readonly showCustomerLink = input(false);
  /** The document open in the editor, when opened from a line's K marker: listed as "dit document", not as history. */
  readonly currentDocumentId = input<number | null>(null);
  /**
   * What the opener already knows (a product's Klantprijzen row and the product's price): shown when the server has no
   * row for the pair, which is the case for a customer with a klantprijs who was never on a document.
   */
  readonly agreedPriceExclVat = input<number | null>(null);
  readonly cataloguePriceNow = input<number | null>(null);
  readonly unit = input('');
  readonly closed = output<void>();

  readonly row = signal<AppliedPriceRow | null>(null);
  readonly entries = signal<AppliedPriceEntry[]>([]);
  readonly loading = signal(true);
  readonly error = signal(false);
  /** Drops the answer of a load another pair has overtaken. */
  private version = 0;

  readonly sourceLabel = appliedSourceLabel;
  readonly followsCatalogue = followsCatalogue;
  private readonly eur = new EurPipe();

  /** The top group: the server's row when there is one, else the opener's figures; null when neither says anything. */
  readonly figures = computed<{ agreed: number | null; catalogue: number | null; unit: string; last: AppliedPriceRow | null } | null>(() => {
    const row = this.row();
    if (row) return { agreed: row.agreedPriceExclVat, catalogue: row.cataloguePriceNow, unit: row.unit, last: row };
    const agreed = this.agreedPriceExclVat();
    const catalogue = this.cataloguePriceNow();
    if (agreed == null && catalogue == null) return null;
    return { agreed, catalogue, unit: this.unit(), last: null };
  });

  constructor() {
    effect(() => {
      this.customerId();
      this.productId();
      untracked(() => void this.load());
    });
  }

  async load(): Promise<void> {
    const version = ++this.version;
    const customerId = this.customerId();
    const productId = this.productId();
    this.loading.set(true);
    this.error.set(false);
    try {
      const [rows, entries] = await Promise.all([
        this.api.appliedPrices(customerId, productId),
        this.api.appliedPriceEntries(customerId, productId),
      ]);
      if (this.destroy.destroyed || version !== this.version) return;
      this.row.set(rows.find((candidate) => candidate.productId === productId) ?? rows[0] ?? null);
      this.entries.set([...entries].sort((left, right) => right.orderDate.localeCompare(left.orderDate) || right.documentId - left.documentId));
    } catch {
      if (this.destroy.destroyed || version !== this.version) return;
      this.row.set(null);
      this.entries.set([]);
      this.error.set(true);
    } finally {
      if (!this.destroy.destroyed && version === this.version) this.loading.set(false);
    }
  }

  /** "Offerte OF-2026-031"; a document without a number yet by its kind alone. */
  docLabel(entry: AppliedPriceEntry): string {
    const kind = DOC_TYPE_LABEL[entry.docType] ?? entry.docType;
    return entry.number ? `${kind} ${entry.number}` : kind;
  }

  /** The quote status as the sales list words it; an unknown one from a newer server reads as sent. */
  statusLabel(entry: AppliedPriceEntry): string {
    return STATUS_LABEL[entry.status] ?? entry.status;
  }

  quantity(entry: AppliedPriceEntry): string {
    return (entry.quantity ?? 0).toLocaleString('nl-BE', { maximumFractionDigits: 2 });
  }

  /**
   * The figure of one document line. A line that followed the catalogue stored no price of its own but was charged
   * the catalogue price: the pair's catalogue price of today stands in (that day's is not kept), "op aanvraag" when
   * the product has none. "geen prijs" would say nothing was charged, which is not what happened.
   */
  entryPrice(entry: AppliedPriceEntry): string {
    const price = followsCatalogue(entry) ? this.figures()?.catalogue ?? null : entry.unitPriceEur;
    return price == null ? 'op aanvraag' : this.eur.transform(price);
  }
}
