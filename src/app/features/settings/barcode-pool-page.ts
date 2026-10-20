import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CatalogApi } from '../../core/api/catalog-api';
import { messageOf } from '../../core/api/errors';
import { PageHeader } from '../../shared/page-header';
import { Ui } from '../../shared/ui';
import { Skeleton } from '../../shared/skeleton';
import { LoadError, LOAD_ERROR_FALLBACK } from '../../shared/load-error';
import { Segmented, type SegmentOption } from '../../shared/segmented';
import { Icon } from '../../shared/icon';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { barcodesInUse, matchesBarcode, type BarcodeInUse } from './barcode-usage';

/**
 * The company's own EAN range: paste the codes from the GS1 sheet, and
 * every product takes the next free one with a tap. What is handed out
 * leaves this list, so it can never be handed out twice.
 */
@Component({
  selector: 'app-barcode-pool-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, PageHeader, Skeleton, LoadError, Segmented, Icon],
  template: `
    <app-page-header [showBack]="true" title="EAN-codes" [subtitle]="subtitle()">
      @if (desktop.active()) {
        <app-segmented label="Weergave" [options]="viewOptions()" [value]="view()" (changed)="view.set($any($event))" />
      }
    </app-page-header>

    <div class="content ean" [class.ean--phone]="!desktop.active()">
      @if (!desktop.active()) {
        <div class="ean-seg"><app-segmented variant="ios" label="Weergave" [options]="viewOptions()" [value]="view()" (changed)="view.set($any($event))" /></div>
      }
      @if (view() === 'free') {
        <div class="card ean-add">
          <div class="card__head"><h2>Codes toevoegen</h2></div>
          <div class="card__body">
            <p class="hint">Plak je codes, één per regel of gescheiden door komma's of spaties. Ongeldige
              codes en codes die al op een product staan worden overgeslagen.</p>
            <textarea class="textarea mt-8" rows="5" placeholder="5410000000019&#10;5410000000026&#10;…"
                      [ngModel]="pasted()" (ngModelChange)="pasted.set($event)"></textarea>
            <div class="row mt-8" style="justify-content:flex-end">
              <button class="btn btn--primary" type="button" [disabled]="busy() || !pasted().trim()" (click)="add()">
                {{ busy() ? 'Bezig…' : 'Toevoegen aan de lijst' }}
              </button>
            </div>
            @if (report(); as r) {
              <div class="alert alert--info mt-8">
                <span class="alert__icon">✓</span>
                <div>
                  <b>{{ r.added.length }} toegevoegd.</b>
                  @if (r.inUse.length) { {{ r.inUse.length }} stond al op een product ({{ r.inUse.join(', ') }}). }
                  @if (r.duplicate.length) { {{ r.duplicate.length }} stond al in de lijst. }
                  @if (r.invalid.length) { {{ r.invalid.length }} ongeldig ({{ r.invalid.join(', ') }}). }
                </div>
              </div>
            }
          </div>
        </div>

        @if (loadError(); as error) {
          <app-load-error [message]="error" [busy]="loading()" (retry)="reload()" />
        } @else if (loading()) {
          <app-skeleton [kind]="desktop.active() ? 'list' : 'group'" [rows]="3" />
        } @else if (!free().length) {
          <div class="wk-empty ean-empty">
            <div class="wk-empty__icon"><app-icon name="barcode" [size]="22" /></div>
            <h2 class="wk-empty__title">Nog geen vrije codes</h2>
            <p class="wk-empty__text">Plak hierboven de codes uit je GS1-reeks.</p>
          </div>
        } @else if (desktop.active()) {
          <!-- A click copies; the × strikes a code (with undo, so no question first). -->
          <ul class="ean-grid" aria-label="Vrije codes">
            @for (code of free(); track code) {
              <li class="ean-chip" animate.leave="mo-leave">
                <button class="ean-chip__copy" type="button" [title]="code + ' kopiëren'" (click)="copy(code)">
                  <span class="mono">{{ code }}</span><app-icon name="copy" [size]="15" />
                </button>
                <button class="ean-chip__x" type="button" [attr.aria-label]="code + ' uit de lijst halen'" [disabled]="deleting() === code"
                        (click)="remove(code)"><app-icon name="close" [size]="13" /></button>
              </li>
            }
          </ul>
        } @else {
          <div class="ios-group ean-cells">
            @for (code of free(); track code) {
              <!-- Tap to copy; swipe left to show the bin (undo on the toast). -->
              <div class="swipe pool-item" [class.swipe--open]="swiped() === code" [class.swipe--dragging]="dragging() === code"
                   [style.--swipe-offset]="dragging() === code ? offset() + 'px' : null" animate.leave="mo-leave">
                <button class="swipe__row ios-cell pool-row" type="button" [title]="code + ' kopiëren'"
                        (touchstart)="swipeStart($event, code)" (touchmove)="swipeMove($event, code)"
                        (touchend)="swipeEnd(code)" (touchcancel)="swipeEnd(code)"
                        (click)="copyUnlessSwiped($event, code)">
                  <span class="ios-cell__body"><span class="ios-cell__title mono">{{ code }}</span></span>
                  <app-icon class="ios-cell__chev" name="copy" [size]="16" />
                </button>
                <button class="swipe__delete" type="button" [attr.aria-label]="code + ' uit de lijst halen'" (click)="remove(code)">
                  <app-icon name="trash" [size]="20" />
                </button>
              </div>
            }
          </div>
        }
      } @else {
        @if (desktop.active()) {
          <div class="ean-tools">
            <label class="wk-search"><app-icon name="search" [size]="15" />
              <input type="search" placeholder="Zoek code of product" aria-label="Zoek code of product" [value]="query()" (input)="query.set($any($event.target).value)" />
              <button class="wk-search__clear" type="button" aria-label="Zoekterm wissen" (click)="query.set('')"><app-icon name="close" [size]="13" /></button></label>
          </div>
        } @else {
          <div class="ios-search ean-search"><label class="ios-search__field"><app-icon name="search" [size]="16" />
            <input type="search" placeholder="Zoek code of product" aria-label="Zoek code of product" [value]="query()" (input)="query.set($any($event.target).value)" />
            <button class="ios-search__clear" type="button" aria-label="Zoekterm wissen" (click)="query.set('')"><app-icon name="close" [size]="14" /></button></label></div>
        }
        @if (usedError(); as error) {
          <app-load-error [message]="error" [busy]="usedLoading()" (retry)="loadUsed()" />
        } @else if (used() === null) {
          <app-skeleton [kind]="desktop.active() ? 'table' : 'group'" [rows]="6" />
        } @else if (desktop.active()) {
          <div class="wk-card">
            <div class="wk-table ean-table" role="table" aria-label="Codes in gebruik">
              <div class="wk-thead" role="row">
                <span class="wk-th" role="columnheader">Code</span><span class="wk-th" role="columnheader">Soort</span>
                <span class="wk-th" role="columnheader">Product</span><span class="wk-th" role="columnheader">Status</span>
              </div>
              @for (row of usedRows(); track row.code + row.kind + row.productId) {
                <div class="wk-tr" role="row">
                  <span class="wk-td mono" role="cell">{{ row.code }}</span>
                  <span class="wk-td" role="cell">{{ row.kind }}</span>
                  <span class="wk-td ean-product" role="cell"><a [routerLink]="['/products', row.productId]">{{ row.name }}</a>@if (row.detail) { <small>{{ row.detail }}</small> }</span>
                  <span class="wk-td" role="cell"><span class="wk-pill" [class.tone-ok]="row.active">{{ row.active ? 'Actief' : 'Inactief' }}</span></span>
                </div>
              } @empty {
                <div class="wk-empty"><p class="wk-empty__text">Geen code gevonden.</p></div>
              }
            </div>
          </div>
        } @else {
          <div class="ios-group">
            @for (row of usedRows(); track row.code + row.kind + row.productId) {
              <a class="ios-cell ios-cell--tall" [routerLink]="['/products', row.productId]">
                <span class="ios-cell__body"><span class="ios-cell__title mono">{{ row.code }}</span>
                  <span class="ios-cell__sub ean-wrap">{{ row.name }} · {{ row.kind }}{{ row.active ? '' : ' · inactief' }}</span></span>
                <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
              </a>
            } @empty {
              <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__sub">Geen code gevonden.</span></span></div>
            }
          </div>
        }
      }
    </div>
  `,
})
export class BarcodePoolPage {
  private readonly catalog = inject(CatalogApi);
  private readonly ui = inject(Ui);

  readonly desktop = inject(DesktopViewport);
  readonly free = signal<string[]>([]);
  /** Vrij (the pool) or In gebruik (every code on a product, built from the products). */
  readonly view = signal<'free' | 'used'>('free');
  readonly query = signal('');
  readonly used = signal<BarcodeInUse[] | null>(null);
  readonly usedLoading = signal(false);
  readonly usedError = signal<string | null>(null);
  readonly usedRows = computed(() => (this.used() ?? []).filter((row) => matchesBarcode(row, this.query())));
  readonly usedCount = computed(() => new Set((this.used() ?? []).map((row) => row.code)).size);
  readonly viewOptions = computed<SegmentOption[]>(() => [
    { id: 'free', label: 'Vrij', count: this.loading() ? null : this.free().length },
    { id: 'used', label: 'In gebruik', count: this.used() === null ? null : this.usedCount() },
  ]);
  readonly subtitle = computed(() => {
    if (this.loading()) return '';
    const free = `${this.free().length} vrije code${this.free().length === 1 ? '' : 's'}`;
    return this.used() === null || !this.desktop.active() ? free : `${free} · ${this.usedCount()} in gebruik`;
  });
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly pasted = signal('');
  readonly report = signal<{ added: string[]; invalid: string[]; inUse: string[]; duplicate: string[] } | null>(null);

  constructor() {
    void this.load();
    /* The products are asked once, after the pool shows (or when In gebruik opens). */
    effect(() => {
      if (!this.loading() || this.view() === 'used') untracked(() => { if (this.used() === null && !this.usedLoading()) void this.loadUsed(); });
    });
  }

  async loadUsed(): Promise<void> {
    if (this.usedLoading()) return;
    this.usedLoading.set(true);
    this.usedError.set(null);
    try {
      this.used.set(barcodesInUse(await this.catalog.products()));
    } catch (failure: unknown) {
      this.usedError.set(messageOf(failure, LOAD_ERROR_FALLBACK));
    } finally {
      this.usedLoading.set(false);
    }
  }

  /** The pool did not load: the page says so, with a retry, instead of "no codes". */
  readonly loadError = signal<string | null>(null);

  reload(): void {
    if (!this.loading()) void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      this.free.set(await this.catalog.barcodePool());
    } catch (failure: unknown) {
      this.loadError.set(messageOf(failure, LOAD_ERROR_FALLBACK));
    } finally {
      this.loading.set(false);
    }
  }

  async add(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      this.report.set(await this.catalog.addBarcodes(this.pasted()));
      this.pasted.set('');
      await this.load();
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Toevoegen mislukt'), 'err');
    } finally {
      this.busy.set(false);
    }
  }

  /* ---- swipe left to strike a code; tap to copy ---- */
  readonly swiped = signal<string | null>(null);
  readonly dragging = signal<string | null>(null);
  readonly offset = signal(0);
  readonly deleting = signal<string | null>(null);
  private touchX = 0;
  private touchY = 0;
  private horizontal = false;
  private swipeHandled = false;

  swipeStart(event: TouchEvent, code: string): void {
    this.touchX = event.touches[0].clientX;
    this.touchY = event.touches[0].clientY;
    this.horizontal = false;
    this.swipeHandled = false;
    if (this.swiped() !== null && this.swiped() !== code) this.swiped.set(null);
  }

  swipeMove(event: TouchEvent, code: string): void {
    const dx = event.touches[0].clientX - this.touchX;
    const dy = event.touches[0].clientY - this.touchY;
    if (!this.horizontal) {
      if (Math.hypot(dx, dy) < 8 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      this.horizontal = true;
      this.dragging.set(code);
    }
    const base = this.swiped() === code ? -76 : 0;
    this.offset.set(Math.min(0, base + dx));
  }

  swipeEnd(code: string): void {
    if (this.dragging() !== code) return;
    const offset = this.offset();
    this.dragging.set(null);
    this.offset.set(0);
    this.swipeHandled = true;
    this.swiped.set(offset < -40 ? code : null);
  }

  copyUnlessSwiped(event: Event, code: string): void {
    if (this.swipeHandled || this.swiped() !== null) {
      event.preventDefault();
      this.swipeHandled = false;
      this.swiped.set(null);
      return;
    }
    void this.copy(code);
  }

  async copy(code: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(code);
      this.ui.toast(`${code} gekopieerd`, 'ok');
    } catch {
      this.ui.toast('Kopiëren lukte niet - selecteer de code en kopieer handmatig', 'err');
    }
  }

  /** Undo: the code goes back into the pool. */
  private async restore(code: string): Promise<void> {
    try {
      await this.catalog.addBarcodes(code);
      await this.load();
      this.ui.toast(`${code} staat weer in de lijst`, 'ok');
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Terugzetten mislukt'), 'err');
    }
  }

  async remove(code: string): Promise<void> {
    if (this.deleting() !== null) return;
    this.deleting.set(code);
    this.swiped.set(null);
    try {
      await this.catalog.removeBarcode(code);
      this.free.update((list) => list.filter((item) => item !== code));
      this.ui.toast(`${code} verwijderd`, 'ok', { label: 'Ongedaan maken', run: () => void this.restore(code) });
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Verwijderen mislukt'), 'err');
    } finally {
      this.deleting.set(null);
    }
  }
}
