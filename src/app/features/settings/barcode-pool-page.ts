import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CatalogApi } from '../../core/api/catalog-api';
import { messageOf } from '../../core/api/errors';
import { PageHeader } from '../../shared/page-header';
import { Ui } from '../../shared/ui';

/**
 * The company's own EAN range: paste the codes from the GS1 sheet, and
 * every product takes the next free one with a tap. What is handed out
 * leaves this list, so it can never be handed out twice.
 */
@Component({
  selector: 'app-barcode-pool-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, PageHeader],
  template: `
    <app-page-header title="EAN-codes" [subtitle]="free().length + ' vrije code' + (free().length === 1 ? '' : 's')" />

    <div class="content">
      <div class="card">
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

      <div class="card mt-12">
        <div class="card__head"><h2>Vrije codes</h2><span class="spacer"></span>
          <span class="badge">{{ free().length }}</span></div>
        <div class="list">
          @for (code of free(); track code) {
            <!-- Tap the row to copy the code; swipe it left to strike it from
                 the list - a long swipe deletes at once, no question asked. -->
            <div class="swipe pool-item" [class.swipe--open]="swiped() === code"
                 [class.swipe--dragging]="dragging() === code"
                 [class.pool-item--leaving]="deleting() === code"
                 [style.--swipe-offset]="dragging() === code ? offset() + 'px' : null">
              <button class="swipe__row list-item pool-row" type="button" [title]="code + ' kopiëren'"
                      (touchstart)="swipeStart($event, code)" (touchmove)="swipeMove($event, code)"
                      (touchend)="swipeEnd(code)" (touchcancel)="swipeEnd(code)"
                      (click)="copyUnlessSwiped($event, code)">
                <span class="mono pool-row__code">{{ code }}</span>
                <span class="spacer"></span>
                <span class="pool-row__copy" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a1 1 0 0 1 1-1h10" /></svg>
                </span>
              </button>
              <button class="swipe__delete" type="button" [attr.aria-label]="code + ' uit de lijst halen'"
                      (click)="remove(code)">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8"
                     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M4 7h16" /><path d="M9 7V5h6v2" /><path d="M6.5 7l1 13h9l1-13" /><path d="M10 11v6" /><path d="M14 11v6" />
                </svg>
              </button>
            </div>
          } @empty {
            <div class="empty"><div class="empty__title">{{ loading() ? 'Laden…' : 'Geen vrije codes' }}</div>
              <div class="empty__text">Plak hierboven de codes uit je GS1-reeks.</div></div>
          }
        </div>
      </div>
    </div>
  `,
  styles: `
    .pool-row { width: 100%; gap: 10px; border: 0; border-bottom: 1px solid var(--line); font: inherit; text-align: left; cursor: pointer; }
    .pool-row__code { font-size: 14px; letter-spacing: .04em; }
    .pool-row .spacer { flex: 1 1 auto; }
    .pool-row__copy { margin-left: auto; }
    .pool-row__copy { width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center;
      border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--ink-2); }
    .pool-row__copy svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    .pool-row:hover .pool-row__copy { background: var(--surface-2); color: var(--ink); }
    .pool-item.swipe--dragging .swipe__row { transform: translateX(var(--swipe-offset, 0px)); transition: none; }
    .pool-item--leaving .swipe__row { transform: translateX(-110%); opacity: .3; transition: transform .2s ease, opacity .2s ease; }
  `,
})
export class BarcodePoolPage {
  private readonly catalog = inject(CatalogApi);
  private readonly ui = inject(Ui);

  readonly free = signal<string[]>([]);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly pasted = signal('');
  readonly report = signal<{ added: string[]; invalid: string[]; inUse: string[]; duplicate: string[] } | null>(null);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      this.free.set(await this.catalog.barcodePool());
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
    if (offset < -140) { void this.remove(code); return; }
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

  async remove(code: string): Promise<void> {
    if (this.deleting() !== null) return;
    this.deleting.set(code);
    this.swiped.set(null);
    try {
      await this.catalog.removeBarcode(code);
      this.free.update((list) => list.filter((item) => item !== code));
      this.ui.toast(`${code} uit de lijst gehaald`);
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Verwijderen mislukt'), 'err');
    } finally {
      this.deleting.set(null);
    }
  }
}
