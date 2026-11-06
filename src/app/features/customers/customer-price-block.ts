import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CatalogApi } from '../../core/api/catalog-api';
import {
  CatalogExportDetail, CatalogExportLine, CatalogExportSummary, CustomerPrice, CustomerPriceApi, CustomerPriceHistoryEntry,
  priceBasisRefusal,
} from '../../core/api/customer-price-api';
import { messageOf } from '../../core/api/errors';
import { Category, Product, ProductFamily } from '../../core/api/models';
import { DateField } from '../../shared/date-field';
import { DecimalInput } from '../../shared/decimal-input';
import { ProductPicker } from '../../shared/product-picker';
import { Skeleton } from '../../shared/skeleton';
import { Sheet, Ui, escapeHtml } from '../../shared/ui';
import { priceBasis, type PriceBasisNow } from '../products/catalog-prices';
import { otherBasisPrice, productSalesUnit, unitName } from '../products/product-sales-unit';
import {
  basisPer, dayText, euro, exportMeta, exportTitle, historyChange, historyMeta, languageLabel, layoutLabel, momentText,
  priceProblem, productLabel, productParts, rowMeta, rowMetaParts, sourcePill, statusPill, summaryText, todayIso,
} from './customer-price-state';

/** A price being typed: a row of the list, or a product just picked. */
interface PriceDraft {
  productId: number;
  isNew: boolean;
  amount: number | null;
  validUntil: string;
  note: string;
  /** The unit the amount was typed against: the price field's unit when it was typed, a stored amount's own basis. */
  basis: PriceBasisNow;
  /** The server refused the amount for a unit the product has since left: it stays on screen until typed again. */
  stale: boolean;
}

/** One place in the list: a stored price, or (row null) the product being added. */
interface PriceEntry {
  productId: number;
  row: CustomerPrice | null;
}

const ROWS_SHOWN = 6;
const EXPORTS_SHOWN = 3;
/** The most the journal answers at once (CatalogExportJournal.MAX_LIMIT): a full answer may leave older ones out. */
const EXPORT_LIMIT = 100;
const STALE_PRICE = 'De prijsbasis is gewijzigd · geef de prijs opnieuw in';

/**
 * Klantprijzen on the customer sheet: one agreed price per product, EUR
 * excl. VAT on the product's own sales unit, which a catalogue made for this
 * customer prints instead of the catalogue price. A row edits in place, "+
 * Product" goes through the product picker, and the Prijslijsten list shows
 * every catalogue made for the customer with the price each product carried.
 *
 * Like the Websitelogin block, every save here acts at once and on its own;
 * the sheet's Opslaan only takes an open price along (saveDraft).
 */
@Component({
  selector: 'app-customer-price-block',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, DateField, DecimalInput, ProductPicker, Sheet, Skeleton],
  template: `
    <div class="cp-head">
      <b>Klantprijzen</b>
      @if (!loading() && !error() && rows().length) { <small>{{ summary() }}</small> }
      <a class="cp-link" [routerLink]="['/activity']" [queryParams]="{ type: 'CUSTOMER', id: customerId() }">Logboek ›</a>
    </div>

    @if (loading()) {
      <app-skeleton kind="lines" [rows]="2" />
    } @else if (error(); as message) {
      <div class="alert alert--danger cp-error" role="alert">
        <div>{{ message }}</div>
        <button class="btn btn--sm" type="button" (click)="reload()">Opnieuw proberen</button>
      </div>
    } @else {
      <div class="cp-list">
        @for (entry of entries(); track entry.productId) {
          @if (draft()?.productId === entry.productId) {
            <div class="cp-edit" role="group" [attr.aria-label]="'Klantprijs ' + label(entry)">
              <div class="cp-edit__head">
                <b>{{ label(entry) }}</b>
                @if (entry.row && pill(entry.row); as tag) { <i class="badge" [class]="tag.css">{{ tag.label }}</i> }
                @if (entry.row; as row) {
                  <button class="linklike cp-edit__history" type="button" [disabled]="busy()" (click)="openHistory(row.productId)">Geschiedenis</button>
                }
              </div>
              @if (entry.row?.status === 'PRODUCT_GONE') {
                <span class="hint">{{ meta(entry.row!) }}</span>
              } @else {
                <div class="cp-fields">
                  <div class="field">
                    <label for="cp-price">{{ priceLabel(entry) }}</label>
                    <div class="input-affix">
                      <input class="input num" id="cp-price" appDecimal [placeholder]="placeholder(entry)" [disabled]="busy()"
                             [ngModel]="draft()!.amount" (ngModelChange)="patchDraft({ amount: $event })" (keydown.enter)="saveDraft()" />
                      <span class="input-affix__suffix">EUR</span>
                    </div>
                    <span class="hint">{{ priceHint(entry) }}</span>
                    @if (belowCost(entry); as cost) { <span class="hint hint--warn">Onder de kostprijs ({{ cost }})</span> }
                  </div>
                  <div class="field">
                    <label for="cp-until">Geldig tot <span class="opt"></span></label>
                    <app-date-field fieldId="cp-until" [value]="draft()!.validUntil" (valueChange)="patchDraft({ validUntil: $event })" />
                  </div>
                  <div class="field cp-note">
                    <label for="cp-note">Notitie <span class="opt"></span></label>
                    <input class="input" id="cp-note" maxlength="500" autocomplete="off" [disabled]="busy()"
                           [ngModel]="draft()!.note" (ngModelChange)="patchDraft({ note: $event ?? '' })" />
                  </div>
                </div>
              }
              @if (formError(); as message) { <div class="alert alert--danger" role="alert">{{ message }}</div> }
              <div class="cp-actions">
                @if (entry.row; as row) {
                  <button class="btn btn--sm btn--danger" type="button" [disabled]="busy()" (click)="remove(row)">Verwijderen</button>
                }
                <span class="cp-gap"></span>
                <button class="btn btn--sm" type="button" [disabled]="busy()" (click)="cancel()">Annuleren</button>
                @if (entry.row?.status !== 'PRODUCT_GONE') {
                  <button class="btn btn--sm btn--primary" type="button" [disabled]="busy() || !dirty() || draft()!.stale" (click)="saveDraft()">
                    {{ busy() ? 'Bezig…' : 'Prijs opslaan' }}
                  </button>
                }
              </div>
            </div>
          } @else if (entry.row; as row) {
            @let name = parts(row.productId);
            @let facts = metaParts(row);
            <button class="cp-row" type="button" [attr.data-product]="row.productId" [class.cp-row--off]="row.status !== 'ACTIVE'"
                    [class.cp-row--saved]="justSaved() === row.productId" [disabled]="!!draft() || busy()" (click)="edit(row)">
              <span class="cp-name"><span>{{ name.head }}</span>@if (name.tail) {<span class="cp-variant">{{ name.tail }}</span>}
                @if (pill(row); as tag) { <i class="badge" [class]="tag.css">{{ tag.label }}</i> }</span>
              <span class="cp-fig">{{ euro(row.priceExclVat) }}</span>
              <span class="cp-meta cp-meta--split"><span>{{ facts.main }}</span>@if (facts.until) {<span class="cp-pin">&nbsp;· {{ facts.until }}</span>}</span>
              <span class="cp-unit">{{ per(row) }}</span>
              <span class="sr-only"> · aanpassen</span>
            </button>
          }
        } @empty {
          <p class="cp-none">Een eigen prijs per product. Een catalogus voor deze klant drukt die af.</p>
        }
        @if (hiddenRows() > 0) {
          <button class="linklike cp-more" type="button" (click)="allRows.set(true)">Alle {{ rows().length }} tonen</button>
        }
      </div>
      <div class="cp-actions">
        <button class="btn btn--sm" type="button" [disabled]="!!draft() || busy() || pickerLoading()" (click)="pick()">
          {{ pickerLoading() ? 'Bezig…' : '+ Product' }}
        </button>
        @if (rows().length) {
          <button class="btn btn--sm" type="button" [disabled]="busy()" (click)="openHistory(null)">Geschiedenis</button>
        }
      </div>

      @if (exportsError()) {
        <div class="cp-head cp-head--sub"><b>Prijslijsten</b></div>
        <p class="cp-none">Niet geladen. <button class="linklike" type="button" (click)="loadExports(customerId())">Opnieuw proberen</button></p>
      } @else if (exports().length) {
        <div class="cp-head cp-head--sub"><b>Prijslijsten</b><small>{{ exports().length }}@if (exports().length >= exportLimit) {+}</small></div>
        <div class="cp-list">
          @for (entry of shownExports(); track entry.id) {
            <button class="cp-row" type="button" (click)="openExport(entry)">
              <span class="cp-name"><span>{{ exportTitle(entry) }}</span></span>
              <span class="cp-fig cp-fig--day">{{ day(entry.exportedAt) }}</span>
              <span class="cp-meta cp-meta--wide">{{ exportMeta(entry) }}</span>
            </button>
          }
          @if (!allExports() && exports().length > exportsShown) {
            <button class="linklike cp-more" type="button" (click)="allExports.set(true)">Alle {{ exports().length }} tonen</button>
          }
        </div>
      }
    }

    <!-- The sheets stack on the customer sheet (Sheet's stack); nothing around them is a size container or transformed. -->
    @if (picking()) {
      <app-product-picker
        heading="Product voor klantprijs kiezen"
        [products]="pickable()"
        [categories]="categories()"
        [families]="families()"
        [groupByFamily]="true"
        [preserveSourceOrder]="true"
        [selectionOnly]="true"
        [stockAware]="false"
        (picked)="choose($event.product)"
        (cancelled)="picking.set(false)"
      />
    }

    @if (historyFor(); as target) {
      <app-sheet title="Prijsgeschiedenis" variant="ios" [backdropCloses]="true" (closed)="historyFor.set(null)">
        <div body class="cp-sheet">
          @if (target.productId !== null) { <p class="cp-sheet__facts"><b>{{ labelOf(target.productId) }}</b></p> }
          @if (historyLoading()) {
            <app-skeleton kind="lines" [rows]="3" />
          } @else if (historyError(); as message) {
            <div class="alert alert--danger cp-error" role="alert">
              <div>{{ message }}</div>
              <button class="btn btn--sm" type="button" (click)="loadHistory()">Opnieuw proberen</button>
            </div>
          } @else {
            <div class="cp-list cp-list--sheet">
              @for (entry of history(); track $index) {
                <div class="cp-row cp-row--static">
                  @if (target.productId === null) {
                    @let name = parts(entry.productId);
                    <span class="cp-name"><span>{{ name.head }}</span>@if (name.tail) {<span class="cp-variant">{{ name.tail }}</span>}</span>
                  } @else {
                    <span class="cp-name"><span>{{ moment(entry.changedAt) }}</span></span>
                  }
                  <span class="cp-fig">{{ change(entry) }}</span>
                  <span class="cp-meta">{{ historyLine(entry, target.productId === null) }}</span>
                  <span class="cp-unit">{{ historyPer(entry) }}</span>
                </div>
              } @empty {
                <p class="cp-none">Nog geen wijzigingen.</p>
              }
            </div>
          }
        </div>
        <div foot style="display:contents">
          <span class="spacer"></span>
          <button class="btn" type="button" (click)="historyFor.set(null)">Sluiten</button>
        </div>
      </app-sheet>
    }

    @if (exportOpen(); as entry) {
      <app-sheet [title]="'Prijslijst van ' + day(entry.exportedAt)" variant="ios" [backdropCloses]="true" (closed)="exportOpen.set(null)">
        <div body class="cp-sheet">
          <p class="cp-sheet__facts">
            <b>{{ layoutLabel(entry.layout) }} · {{ languageLabel(entry.language) }}@if (unpriced()) { · zonder prijzen }</b>
            <span>{{ moment(entry.exportedAt) }}@if (entry.exportedBy) { · {{ entry.exportedBy }} }</span>
            @if (entry.fileName) { <span class="cp-file">{{ entry.fileName }}</span> }
          </p>
          @if (detailLoading()) {
            <app-skeleton kind="lines" [rows]="4" />
          } @else if (detailError(); as message) {
            <div class="alert alert--danger cp-error" role="alert">
              <div>{{ message }}</div>
              <button class="btn btn--sm" type="button" (click)="loadDetail(entry.id)">Opnieuw proberen</button>
            </div>
          } @else {
            <div class="cp-list cp-list--sheet">
              @for (line of detail()?.lines ?? []; track line.productId) {
                @let name = lineParts(line);
                <div class="cp-row cp-row--static">
                  <span class="cp-name"><span>{{ name.head }}</span>@if (name.tail) {<span class="cp-variant">{{ name.tail }}</span>}
                    @if (source(line); as tag) { <i class="badge" [class]="tag.css">{{ tag.label }}</i> }</span>
                  <span class="cp-fig">{{ linePrice(line) }}</span>
                  @let meta = lineMeta(line);
                  <span class="cp-meta cp-meta--split"><span>{{ meta.main }}</span>@if (meta.pin) {<span class="cp-pin">&nbsp;· {{ meta.pin }}</span>}</span>
                  <span class="cp-unit">{{ line.printedPriceEur == null ? '' : linePer(line) }}</span>
                </div>
              } @empty {
                <p class="cp-none">Geen producten bewaard.</p>
              }
            </div>
          }
        </div>
        <div foot style="display:contents">
          <span class="spacer"></span>
          <button class="btn" type="button" (click)="exportOpen.set(null)">Sluiten</button>
        </div>
      </app-sheet>
    }
  `,
  styles: `
    :host { display: grid; gap: 10px; min-width: 0; }
    .cp-head { display: flex; align-items: baseline; gap: 8px; min-width: 0; font-size: 13px; }
    .cp-head b { flex: none; }
    .cp-head small { min-width: 0; overflow: hidden; color: var(--ink-2); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
    .cp-head--sub { margin-top: 4px; }
    .cp-link { flex: none; margin-left: auto; color: var(--rose-dark); font-size: 12.5px; font-weight: 650; text-decoration: none; }
    .cp-list { display: grid; min-width: 0; }
    .cp-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: 'name fig' 'meta unit';
      align-items: baseline; gap: 2px 12px; width: 100%; min-width: 0; min-height: 48px; margin: 0; padding: 8px 0;
      border: 0; border-top: 1px solid var(--rose-line); background: none; color: var(--ink); font: inherit; text-align: left; cursor: pointer; }
    .cp-row:disabled { cursor: default; opacity: .5; }
    .cp-row--static { cursor: auto; }
    /* A price just added: the row it sorted into is marked for a moment (the shadows carry the tint past the text). */
    .cp-row { transition: background-color var(--dur-3, .32s) var(--ease-out, ease-out), box-shadow var(--dur-3, .32s) var(--ease-out, ease-out); }
    .cp-row--saved { --cp-mark: color-mix(in srgb, var(--rose) 13%, transparent); background: var(--cp-mark); box-shadow: -8px 0 var(--cp-mark), 8px 0 var(--cp-mark); }
    .cp-name { grid-area: name; display: flex; align-items: center; min-width: 0; font-size: 13.5px; font-weight: 650; }
    .cp-name > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    /* The rows of one family differ only in colour and size: the name gives way, the variant does not. */
    .cp-name > .cp-variant { flex: none; max-width: 75%; }
    .cp-name .badge { flex: none; margin-left: 6px; font-style: normal; }
    .cp-fig { grid-area: fig; font-size: 14px; font-weight: 700; font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
    .cp-fig--day { color: var(--ink-2); font-size: 12.5px; font-weight: 600; }
    .cp-row--off .cp-fig { color: var(--ink-2); font-weight: 600; }
    .cp-meta { grid-area: meta; min-width: 0; overflow: hidden; color: var(--ink-2); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
    /* The end date (a price list: the catalogue figure) stays whole; what comes before it gives way. */
    .cp-meta--split { display: flex; }
    .cp-meta--split > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    .cp-meta--split > .cp-pin { flex: none; }
    .cp-meta--wide { grid-column: 1 / -1; }
    .cp-unit { grid-area: unit; color: var(--ink-2); font-size: 12px; text-align: right; white-space: nowrap; }
    .cp-none { margin: 0; color: var(--ink-2); font-size: 13px; line-height: 1.45; }
    .cp-more { justify-self: start; margin-top: 6px; font-size: 12.5px; }
    .cp-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .cp-gap { flex: 1; }
    .cp-error { align-items: center; justify-content: space-between; }
    .cp-error .btn { flex: none; }
    .cp-edit { display: grid; gap: 10px; min-width: 0; padding: 10px 0 12px; border-top: 1px solid var(--rose-line); }
    .cp-edit__head { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; font-size: 13.5px; overflow-wrap: anywhere; }
    .cp-edit__head .badge { font-style: normal; }
    .cp-edit__history { margin-left: auto; font-size: 12.5px; }
    .cp-fields { display: grid; gap: 10px; min-width: 0; }
    .cp-fields .field { min-width: 0; margin: 0; }
    /* --muted is too faint for 12 px on the tinted block. */
    .hint { font-size: 12px; color: var(--ink-2); }
    .hint--warn { color: var(--warn); font-weight: 650; }
    .cp-sheet { display: grid; gap: 12px; min-width: 0; }
    .cp-sheet__facts { display: grid; gap: 2px; margin: 0; color: var(--ink-2); font-size: 13px; line-height: 1.4; overflow-wrap: anywhere; }
    .cp-sheet__facts b { color: var(--ink); }
    .cp-file { color: var(--muted); font-size: 12px; }
    .cp-list--sheet .cp-row { border-top-color: var(--line); }
    .cp-list--sheet .cp-row:first-child { border-top: 0; }
    @media (min-width: 1024px), (min-width: 680px) and (hover: hover) {
      .cp-fields { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
      .cp-note { grid-column: 1 / -1; }
      .cp-row:not(:disabled):not(.cp-row--static):hover .cp-name > span { color: var(--rose-dark); }
    }
    @media (max-width: 679.98px), (hover: none) and (max-width: 1023.98px) {
      /* The iOS sheets give their body no side padding. */
      .cp-sheet { padding: 0 16px; }
      .cp-actions .btn { min-height: 40px; }
    }
  `,
})
export class CustomerPriceBlock {
  private readonly api = inject(CustomerPriceApi);
  private readonly catalog = inject(CatalogApi);
  private readonly ui = inject(Ui);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly customerId = input.required<number>();

  readonly rows = signal<CustomerPrice[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);
  readonly draft = signal<PriceDraft | null>(null);
  readonly formError = signal<string | null>(null);
  readonly allRows = signal(false);
  /** The product whose price was just added, marked in the list for a moment. */
  readonly justSaved = signal<number | null>(null);
  private savedTimer: ReturnType<typeof setTimeout> | undefined;

  readonly exports = signal<CatalogExportSummary[]>([]);
  readonly exportsError = signal(false);
  readonly allExports = signal(false);
  readonly exportsShown = EXPORTS_SHOWN;
  readonly exportLimit = EXPORT_LIMIT;

  /** The catalogue, for variant names, today's sales unit and the picker; loaded once a row or the picker needs it. */
  readonly products = signal<ReadonlyMap<number, Product> | null>(null);
  readonly categories = signal<Category[]>([]);
  readonly families = signal<ProductFamily[]>([]);
  readonly picking = signal(false);
  readonly pickerLoading = signal(false);
  private productsRequest: Promise<void> | null = null;
  private listsRequest: Promise<void> | null = null;

  readonly historyFor = signal<{ productId: number | null } | null>(null);
  readonly history = signal<CustomerPriceHistoryEntry[]>([]);
  readonly historyLoading = signal(false);
  readonly historyError = signal<string | null>(null);

  readonly exportOpen = signal<CatalogExportSummary | null>(null);
  readonly detail = signal<CatalogExportDetail | null>(null);
  readonly detailLoading = signal(false);
  readonly detailError = signal<string | null>(null);
  /** A PDF made for the customer without prices: its lines carry no source. */
  readonly unpriced = computed(() => {
    const lines = this.detail()?.lines ?? [];
    return lines.length > 0 && lines.every((line) => line.priceSource == null && line.printedPriceEur == null);
  });

  /** Drops the answer of a load that a newer one (or another customer) has overtaken. */
  private version = 0;

  readonly euro = euro;
  readonly day = dayText;
  readonly moment = momentText;
  readonly change = historyChange;
  readonly historyLine = historyMeta;
  readonly exportTitle = exportTitle;
  readonly exportMeta = exportMeta;
  readonly layoutLabel = layoutLabel;
  readonly languageLabel = languageLabel;

  readonly summary = computed(() => summaryText(this.rows()));
  readonly entries = computed<PriceEntry[]>(() => {
    const draft = this.draft();
    const rows = this.allRows() ? this.rows() : this.rows().slice(0, ROWS_SHOWN);
    const added = draft?.isNew ? [{ productId: draft.productId, row: null }] : [];
    return [...added, ...rows.map((row) => ({ productId: row.productId, row }))];
  });
  readonly hiddenRows = computed(() => this.allRows() ? 0 : Math.max(0, this.rows().length - ROWS_SHOWN));
  readonly shownExports = computed(() => this.allExports() ? this.exports() : this.exports().slice(0, EXPORTS_SHOWN));
  /** Sellable products without a price for this customer yet. */
  readonly pickable = computed(() => {
    const priced = new Set(this.rows().map((row) => row.productId));
    return [...(this.products()?.values() ?? [])].filter((product) =>
      product.id != null && product.active && !product.demo && !priced.has(product.id));
  });

  /** The open price differs from what is stored (a picked product: once a price is typed). */
  readonly dirty = computed(() => {
    const draft = this.draft();
    if (!draft) return false;
    const row = this.rows().find((candidate) => candidate.productId === draft.productId);
    if (draft.isNew || !row || row.status === 'BASIS_CHANGED') return draft.amount != null;
    return draft.amount !== row.priceExclVat || draft.validUntil !== (row.validUntil ?? '') || draft.note.trim() !== (row.note ?? '');
  });
  /** For the sheet's Opslaan: a typed price that is not stored yet. */
  readonly pending = this.dirty;

  constructor() {
    void this.catalog.unitNames().catch(() => undefined);
    effect(() => {
      const customerId = this.customerId();
      untracked(() => {
        this.draft.set(null);
        this.formError.set(null);
        this.allRows.set(false);
        this.allExports.set(false);
        this.justSaved.set(null);
        void this.load(customerId);
      });
    });
    inject(DestroyRef).onDestroy(() => clearTimeout(this.savedTimer));
  }

  reload(): void {
    void this.load(this.customerId());
  }

  private async load(customerId: number): Promise<void> {
    const version = ++this.version;
    this.loading.set(true);
    this.error.set(null);
    void this.loadExports(customerId);
    try {
      const rows = await this.api.list(customerId);
      if (version !== this.version) return;
      this.rows.set(rows);
      if (rows.length) void this.ensureProducts();
    } catch (failure: unknown) {
      if (version !== this.version) return;
      this.rows.set([]);
      this.error.set(messageOf(failure, 'Klantprijzen konden niet geladen worden.'));
    } finally {
      if (version === this.version) this.loading.set(false);
    }
  }

  async loadExports(customerId: number): Promise<void> {
    const version = this.version;
    this.exportsError.set(false);
    try {
      const exports = await this.api.exports(customerId, EXPORT_LIMIT);
      if (version === this.version) this.exports.set(exports);
    } catch {
      if (version !== this.version) return;
      this.exports.set([]);
      this.exportsError.set(true);
    }
  }

  /** One catalogue request per block; a failure leaves the stored names and units in place and may be retried. */
  private ensureProducts(): Promise<void> {
    this.productsRequest ??= this.catalog.products()
      .then((products) => this.products.set(new Map(products.flatMap((product) => product.id == null ? [] : [[product.id, product] as const]))))
      .catch(() => { this.productsRequest = null; });
    return this.productsRequest;
  }

  private ensurePickerLists(): Promise<void> {
    this.listsRequest ??= Promise.all([
      this.catalog.categories().catch(() => []), this.catalog.productFamilies({ maxAgeMs: 20_000 }).catch(() => []),
    ]).then(([categories, families]) => {
      this.categories.set(categories);
      this.families.set(families);
    });
    return this.listsRequest;
  }

  /* ------------------------------------------------------------ wording */

  private productOf(productId: number): Product | null {
    return this.products()?.get(productId) ?? null;
  }

  labelOf(productId: number): string {
    const row = this.rows().find((candidate) => candidate.productId === productId);
    return productLabel(this.productOf(productId), row ?? { productId, name: null, sku: null });
  }

  label(entry: PriceEntry): string {
    return this.labelOf(entry.productId);
  }

  /** The name and the variant apart, for a row that cuts the name before the variant. */
  parts(productId: number): { label: string; head: string; tail: string | null } {
    const row = this.rows().find((candidate) => candidate.productId === productId);
    return productParts(this.productOf(productId), row ?? { productId, name: null, sku: null });
  }

  lineParts(line: CatalogExportLine): { label: string; head: string; tail: string | null } {
    return productParts(this.productOf(line.productId), line);
  }

  metaParts(row: CustomerPrice): { main: string; until: string | null } {
    const product = this.productOf(row.productId);
    return rowMetaParts(row, product ? this.currentPer(product) : null);
  }

  pill(row: CustomerPrice): { label: string; css: string } | null {
    return statusPill(row.status);
  }

  /** The unit the stored price is on: the basis it was set on. */
  per(row: CustomerPrice): string {
    return basisPer(row.salesUnit, row.piecesPerUnit, row.unitKey);
  }

  meta(row: CustomerPrice): string {
    const product = this.productOf(row.productId);
    return rowMeta(row, product ? this.currentPer(product) : null);
  }

  /** "per bowl", "per display van 6": the product's sales unit today. */
  private currentPer(product: Product): string {
    const unit = productSalesUnit(product);
    return unit.isDisplay ? basisPer('DISPLAY', unit.piecesPerDisplay, null) : unit.piece.per;
  }

  /** The field names the unit a new price is typed on: the product's own, today. */
  priceLabel(entry: PriceEntry): string {
    const product = this.productOf(entry.productId);
    if (product) return productSalesUnit(product).priceLabel;
    if (entry.row?.salesUnit === 'DISPLAY') return 'Prijs per display';
    const piece = unitName(entry.row?.unitKey);
    return piece.key === 'stuk' ? 'Stukprijs' : `Prijs per ${piece.one}`;
  }

  private catalogueOf(entry: PriceEntry): number | null {
    return entry.row?.cataloguePriceNow ?? this.productOf(entry.productId)?.computedSalesPriceEur ?? null;
  }

  /** The catalogue price as a placeholder: what the customer gets without a price of their own. */
  placeholder(entry: PriceEntry): string {
    const catalogue = this.catalogueOf(entry);
    return catalogue != null && catalogue > 0 ? catalogue.toLocaleString('nl-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
  }

  /** "Excl. btw · catalogus € 2,43", the other side of a display, and the catalogue price the stored one was set against. */
  priceHint(entry: PriceEntry): string {
    const catalogue = this.catalogueOf(entry);
    const amount = this.draft()?.amount ?? null;
    const product = this.productOf(entry.productId);
    const row = entry.row;
    const before = row?.cataloguePriceAtSet;
    return [
      'Excl. btw',
      catalogue != null && catalogue > 0 ? `catalogus ${euro(catalogue)}` : null,
      row?.status === 'BASIS_CHANGED' ? `was ${euro(row.priceExclVat)} ${this.per(row)}`
        : before != null && catalogue != null && before !== catalogue ? `bij instellen ${euro(before)}` : null,
      product && amount != null && !priceProblem(amount) ? otherBasisPrice(product, amount)?.text ?? null : null,
    ].filter(Boolean).join(' · ');
  }

  /** "€ 1,35" when the typed price is under the landed cost (a warning, never a block). */
  belowCost(entry: PriceEntry): string | null {
    const cost = this.productOf(entry.productId)?.landedCostEur;
    const amount = this.draft()?.amount;
    return cost != null && cost > 0 && amount != null && amount > 0 && amount < cost ? euro(cost) : null;
  }

  historyPer(entry: CustomerPriceHistoryEntry): string {
    const row = this.rows().find((candidate) => candidate.productId === entry.productId);
    return basisPer(entry.salesUnit, entry.piecesPerUnit, row?.unitKey ?? this.productOf(entry.productId)?.packaging?.unitKey);
  }

  source(line: CatalogExportLine): { label: string; css: string } | null {
    return sourcePill(line.priceSource);
  }

  /** The printed price, "Op aanvraag", or nothing in a PDF without prices (no source). */
  linePrice(line: CatalogExportLine): string {
    if (line.printedPriceEur != null) return euro(line.printedPriceEur);
    return line.priceSource === 'ON_REQUEST' ? 'Op aanvraag' : '';
  }

  /** "MB-RD · catalogus € 2,43": the SKU, which may give way, and the catalogue price when another one printed. */
  lineMeta(line: CatalogExportLine): { main: string; pin: string | null } {
    const other = line.priceSource != null && line.priceSource !== 'CATALOGUE';
    const catalogue = other && line.cataloguePriceEur != null ? `catalogus ${euro(line.cataloguePriceEur)}` : null;
    const sku = line.sku?.trim();
    return sku ? { main: sku, pin: catalogue } : { main: catalogue ?? '', pin: null };
  }

  linePer(line: CatalogExportLine): string {
    return basisPer(line.salesUnit, line.piecesPerUnit, line.unitKey);
  }

  /* ------------------------------------------------------------ editing */

  edit(row: CustomerPrice): void {
    if (this.draft() || this.busy()) return;
    this.formError.set(null);
    /* An amount on the old basis would store a display's price as one bowl's: a changed basis starts empty. */
    const changed = row.status === 'BASIS_CHANGED';
    const display = row.salesUnit === 'DISPLAY';
    this.draft.set({
      productId: row.productId, isNew: false, amount: changed ? null : row.priceExclVat,
      validUntil: row.validUntil ?? '', note: row.note ?? '',
      /* The stored amount stands on the basis it was set on. */
      basis: changed ? this.fieldBasis(row.productId)
        : { basis: display ? 'DISPLAY' : 'PIECE', piecesPerUnit: display ? row.piecesPerUnit ?? null : null },
      stale: false,
    });
    void this.ensureProducts();
    this.focusPrice();
  }

  patchDraft(changes: Partial<Pick<PriceDraft, 'amount' | 'validUntil' | 'note'>>): void {
    /* A typed amount is on the unit the field names right now. */
    this.draft.update((draft) => !draft ? draft
      : 'amount' in changes ? { ...draft, ...changes, basis: this.fieldBasis(draft.productId), stale: false } : { ...draft, ...changes });
    /* "Type the price again" stays until the price is typed. */
    if (this.formError() && !this.draft()?.stale) this.formError.set(null);
  }

  /** The unit the price field names (priceLabel): the product's sales unit now, else the stored basis while the catalogue is not loaded. */
  private fieldBasis(productId: number): PriceBasisNow {
    const product = this.productOf(productId);
    if (product) return priceBasis(product);
    const row = this.rows().find((candidate) => candidate.productId === productId);
    return row?.salesUnit === 'DISPLAY'
      ? { basis: 'DISPLAY', piecesPerUnit: row.piecesPerUnit ?? null }
      : { basis: 'PIECE', piecesPerUnit: null };
  }

  cancel(): void {
    this.draft.set(null);
    this.formError.set(null);
  }

  /** Brings the open price into view, for the sheet's Opslaan when it could not save it. */
  reveal(): void {
    this.host.nativeElement.querySelector('.cp-edit')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  /** Saves the open price on its own; true once stored (or when nothing is open). */
  async saveDraft(): Promise<boolean> {
    const draft = this.draft();
    if (!draft) return true;
    if (this.busy()) return false;
    const problem = (draft.stale ? this.formError() || STALE_PRICE : null) ?? priceProblem(draft.amount)
      ?? (draft.validUntil && draft.validUntil < todayIso() ? 'Kies vandaag of een latere datum, of laat Geldig tot leeg.' : null);
    if (problem) {
      this.formError.set(problem);
      return false;
    }
    const customerId = this.customerId();
    this.busy.set(true);
    this.formError.set(null);
    try {
      const rows = await this.api.save(customerId, {
        source: 'CUSTOMER_SCREEN',
        changes: [{
          productId: draft.productId, priceExclVat: draft.amount, validUntil: draft.validUntil || null, note: draft.note.trim() || null,
          basis: draft.basis.basis, piecesPerUnit: draft.basis.piecesPerUnit,
        }],
      });
      if (customerId !== this.customerId()) return true;
      this.rows.set(rows);
      this.draft.set(null);
      this.ui.toast('Klantprijs opgeslagen');
      if (draft.isNew) this.showSaved(draft.productId);
      return true;
    } catch (failure: unknown) {
      if (customerId !== this.customerId()) return false;
      const refused = priceBasisRefusal(failure);
      if (refused) {
        /* Nothing was stored: the rows and the product come again, and the amount stays in the field to be typed again. */
        const unit = await this.reloadRefused(customerId, refused.productIds.length ? refused.productIds : [draft.productId], draft.productId);
        if (customerId !== this.customerId()) return false;
        this.draft.update((open) => open?.productId === draft.productId ? { ...open, stale: true } : open);
        this.formError.set(unit ? `Het product wordt nu ${unit} verkocht · geef de prijs opnieuw in` : STALE_PRICE);
      } else {
        this.formError.set(messageOf(failure, 'Klantprijs opslaan mislukt'));
      }
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * After 409 CUSTOMER_PRICE_BASIS_CHANGED: the stored rows again, and the products the server named as it has them now,
   * so the field names their unit. Answers the unit of `productId` now ("per stolp"), or null when it could not be loaded.
   */
  private async reloadRefused(customerId: number, productIds: number[], productId: number): Promise<string | null> {
    const [rows, products] = await Promise.all([
      this.api.list(customerId).catch(() => null),
      Promise.all(productIds.map((id) => this.catalog.product(id).catch(() => null))),
    ]);
    if (customerId !== this.customerId()) return null;
    if (rows) this.rows.set(rows);
    const fresh = products.filter((product): product is Product => product?.id != null);
    const known = this.products();
    if (known && fresh.length) this.products.set(new Map([...known, ...fresh.map((product) => [product.id!, product] as const)]));
    /* Without the catalogue the field would keep naming the stored unit: it is asked again. */
    if (!known) void this.ensureProducts();
    const product = fresh.find((candidate) => candidate.id === productId);
    return product ? this.currentPer(product) : null;
  }

  /** A price just added sorts in by SKU: the list opens as far as its row, which comes into view and is marked for a moment. */
  private showSaved(productId: number): void {
    if (this.rows().findIndex((row) => row.productId === productId) >= ROWS_SHOWN) this.allRows.set(true);
    clearTimeout(this.savedTimer);
    this.justSaved.set(productId);
    setTimeout(() => this.host.nativeElement.querySelector(`.cp-row[data-product="${productId}"]`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 60);
    this.savedTimer = setTimeout(() => this.justSaved.set(null), 2400);
  }

  remove(row: CustomerPrice): void {
    if (this.busy()) return;
    this.ui.confirm({
      title: 'Klantprijs verwijderen',
      message: '<b>' + escapeHtml(this.labelOf(row.productId)) + '</b> krijgt weer de catalogusprijs.',
      confirmLabel: 'Verwijderen',
      danger: true,
    }, () => void this.removeNow(row));
  }

  private async removeNow(row: CustomerPrice): Promise<void> {
    if (this.busy()) return;
    const customerId = this.customerId();
    this.busy.set(true);
    try {
      const rows = await this.api.save(customerId, { source: 'CUSTOMER_SCREEN', changes: [{ productId: row.productId, priceExclVat: null }] });
      if (customerId !== this.customerId()) return;
      this.rows.set(rows);
      this.draft.set(null);
      this.ui.toast('Klantprijs verwijderd');
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Verwijderen mislukt'), 'err');
    } finally {
      this.busy.set(false);
    }
  }

  async pick(): Promise<void> {
    if (this.draft() || this.busy() || this.pickerLoading()) return;
    this.pickerLoading.set(true);
    try {
      await Promise.all([this.ensureProducts(), this.ensurePickerLists()]);
      if (!this.products()) {
        this.ui.toast('De producten konden niet geladen worden.', 'err');
        return;
      }
      this.picking.set(true);
    } finally {
      this.pickerLoading.set(false);
    }
  }

  choose(product: Product): void {
    this.picking.set(false);
    if (product.id == null) return;
    const row = this.rows().find((candidate) => candidate.productId === product.id);
    if (row) {
      this.edit(row);
      return;
    }
    this.formError.set(null);
    this.draft.set({ productId: product.id, isNew: true, amount: null, validUntil: '', note: '', basis: priceBasis(product), stale: false });
    this.focusPrice();
  }

  /** After the editor rendered: the price field in view and focused. */
  private focusPrice(): void {
    setTimeout(() => {
      const field = this.host.nativeElement.querySelector<HTMLInputElement>('#cp-price');
      field?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      field?.focus({ preventScroll: true });
    }, 60);
  }

  /* ------------------------------------------------------------ history and journal */

  openHistory(productId: number | null): void {
    this.historyFor.set({ productId });
    void this.ensureProducts();
    void this.loadHistory();
  }

  async loadHistory(): Promise<void> {
    const target = this.historyFor();
    if (!target) return;
    const customerId = this.customerId();
    this.historyLoading.set(true);
    this.historyError.set(null);
    try {
      const history = await this.api.history(customerId, target.productId ?? undefined);
      if (this.historyFor() !== target || customerId !== this.customerId()) return;
      this.history.set([...history].sort((left, right) => right.changedAt.localeCompare(left.changedAt)));
    } catch (failure: unknown) {
      if (this.historyFor() === target) this.historyError.set(messageOf(failure, 'De prijsgeschiedenis kon niet geladen worden.'));
    } finally {
      if (this.historyFor() === target) this.historyLoading.set(false);
    }
  }

  openExport(entry: CatalogExportSummary): void {
    this.exportOpen.set(entry);
    void this.ensureProducts();
    void this.loadDetail(entry.id);
  }

  async loadDetail(id: number): Promise<void> {
    this.detail.set(null);
    this.detailLoading.set(true);
    this.detailError.set(null);
    try {
      const detail = await this.api.exportDetail(id);
      if (this.exportOpen()?.id === id) this.detail.set(detail);
    } catch (failure: unknown) {
      if (this.exportOpen()?.id === id) this.detailError.set(messageOf(failure, 'Deze prijslijst kon niet geladen worden.'));
    } finally {
      if (this.exportOpen()?.id === id) this.detailLoading.set(false);
    }
  }
}
