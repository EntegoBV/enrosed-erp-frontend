import { ChangeDetectionStrategy, Component, ElementRef, HostListener, ViewEncapsulation, computed, inject, signal, viewChild } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { CatalogApi } from '../../core/api/catalog-api';
import { messageOf } from '../../core/api/errors';
import type { HsCode, Product } from '../../core/api/models';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import type { HasUnsavedChanges } from '../../core/guards/unsaved-changes.guard';
import { ContextMenu, type ContextMenuItem } from '../../shared/context-menu';
import type { MenuPoint } from '../../shared/context-menu-position';
import { Icon } from '../../shared/icon';
import { keyContext } from '../../shared/key-context';
import { LOAD_ERROR_FALLBACK, LoadError } from '../../shared/load-error';
import { PageHeader } from '../../shared/page-header';
import { Skeleton } from '../../shared/skeleton';
import { Sheet, Ui, confirmLeave, escapeHtml } from '../../shared/ui';
import {
  changedFields, countByCode, formatHs, matchesTariff, normalizeHs, parsePct, pctInput, pctLabel, spellingMismatches, validateTariff, withoutCode,
} from './douane-codes';

interface TariffDraft {
  /** The row it edits (its stored code), or NEW for a code still to add. */
  key: string;
  isNew: boolean;
  original: HsCode | null;
  code: string;
  description: string;
  dutyText: string;
}

const NEW = '\u0000new';

/**
 * Douane's area stylesheet (Inkoop redesign, 2026-10-17): styles/douane.scss stays
 * global CSS with every rule under app-douane-page, loaded with this screen's
 * lazy chunk instead of styles.scss (the initial bundle's 1 MB error budget).
 * Encapsulation None keeps the selectors as written; renders nothing.
 */
@Component({
  selector: 'app-douane-page-styles',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: { hidden: '' },
  template: '',
  styleUrl: '../../../styles/douane.scss',
})
export class DouanePageStyles {}

/**
 * Douane (Inkoop redesign I8, 2026-10-17): the HS codes and their import duty
 * on their own screen under Inkoop, instead of a card deep in Instellingen.
 * One row is edited at a time and saved on its own (no page reload); a saved
 * code is fixed (another code is another tariff). The two checks the server
 * cannot show: products without a code, and products whose code is a tariff in
 * another spelling (the server matches exactly, so they silently fall back to
 * the order's percentage).
 */
@Component({
  selector: 'app-douane-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, RouterLink, PageHeader, Skeleton, LoadError, Icon, Sheet, ContextMenu, DouanePageStyles],
  template: `
    <app-douane-page-styles />
    <app-page-header [showBack]="true" backTo="/more" title="Douane"
                     [subtitle]="desktop.active() ? 'HS-codes en invoerrechten · ' + codes().length + ' tarieven' : 'HS-codes en invoerrechten'">
      @if (desktop.active()) {
        <div class="wk-search dt-search">
          <app-icon name="search" [size]="16" />
          <input #searchField type="search" data-page-search placeholder="Zoek code of omschrijving" aria-label="Tarieven zoeken"
                 autocomplete="off" [value]="query()" (input)="query.set($any($event.target).value)" (keydown.escape)="escapeSearch($event)" />
          <kbd class="wk-kbd" aria-hidden="true">/</kbd>
          <button class="wk-search__clear" type="button" aria-label="Zoekopdracht wissen" (click)="query.set('')"><app-icon name="close" [size]="14" /></button>
        </div>
        <button class="btn btn--primary btn--sm" type="button" (click)="startNew()"><app-icon name="plus" [size]="16" />Nieuw</button>
      }
    </app-page-header>

    @if (desktop.active()) {
      <div class="content content--narrow dt">
        <div class="wk-banner wk-banner--warn wk-banner--inset dt-banner" role="note">Kijk deze percentages na in de TARIC-databank van de EU. Wat hier staat is configuratie, geen douaneadvies.</div>
        @if (loadError(); as error) {
          <div class="wk-card"><app-load-error [message]="error" [busy]="loading()" (retry)="load()" /></div>
        } @else if (loading()) {
          <div class="wk-card" role="status" aria-label="Tarieven laden"><app-skeleton kind="table" [rows]="5" /></div>
        } @else {
          <div class="wk-card dt-card">
            @if (!codes().length && !editing()) {
              <div class="wk-empty">
                <h2 class="wk-empty__title">Nog geen tarieven</h2>
                <p class="wk-empty__text">Voeg een HS-code toe met het invoerrecht dat erbij hoort.</p>
                <div class="wk-empty__actions"><button class="wk-btn wk-btn--primary" type="button" (click)="startNew()"><app-icon name="plus" [size]="16" />Nieuw</button></div>
              </div>
            } @else {
              <div class="wk-table dt-table" role="table" aria-label="Tarieven">
                <div class="wk-thead" role="row">
                  <span class="wk-th" role="columnheader">HS-code</span>
                  <span class="wk-th" role="columnheader">Omschrijving</span>
                  <span class="wk-th wk-th--num" role="columnheader">Invoerrecht</span>
                  <span class="wk-th wk-th--num" role="columnheader">Producten</span>
                  <span class="wk-th" role="columnheader"><span class="sr-only">Acties</span></span>
                </div>
                @if (editing()?.isNew) { <ng-container *ngTemplateOutlet="editRow" /> }
                @for (code of rows(); track code.id ?? code.code) {
                  @if (editing()?.key === code.code) {
                    <ng-container *ngTemplateOutlet="editRow" />
                  } @else {
                    <div class="wk-tr wk-tr--link dt-row" role="row" tabindex="0" [class.dt-row--saved]="savedKey() === code.code"
                         [animate.leave]="leavingCode() === code.code ? 'mo-leave' : ''"
                         (click)="startEdit(code)" (keydown.enter)="startEdit(code)">
                      <span class="wk-td dt-code" role="cell">{{ formatHs(code.code) }}</span>
                      <span class="wk-td wk-td--wrap" role="cell">{{ code.description || '—' }}</span>
                      <span class="wk-td wk-td--num" role="cell">{{ pctLabel(code.dutyRatePct) }}</span>
                      <span class="wk-td wk-td--num" role="cell">{{ counts().get(code.code) ?? 0 }}</span>
                      <span class="wk-td dt-actions" role="cell">
                        <button class="wk-btn wk-btn--ghost wk-btn--sm wk-btn--icon" type="button" aria-haspopup="menu" [attr.aria-label]="'Acties voor ' + formatHs(code.code)"
                                (click)="$event.stopPropagation(); openMenu($event, code)" (keydown.enter)="$event.stopPropagation()"><app-icon name="more" [size]="16" /></button>
                      </span>
                    </div>
                  }
                } @empty {
                  @if (!editing()?.isNew) {
                    <div class="wk-empty dt-none"><h2 class="wk-empty__title">Geen tarief gevonden</h2>
                      <div class="wk-empty__actions"><button class="wk-btn" type="button" (click)="query.set('')">Zoekopdracht wissen</button></div></div>
                  }
                }
              </div>
            }
            <ng-container *ngTemplateOutlet="notes" />
          </div>
          <p class="dt-foot">Het invoerrecht geldt over de douanewaarde: goederen + lokale kosten China + zeevracht. De kosten vanaf de aankomsthaven vallen erbuiten.</p>
        }
      </div>
    } @else {
      <div class="content dt dt--phone">
        <div class="ios-banner dt-ibanner" role="note">Kijk deze percentages na in de TARIC-databank van de EU. Wat hier staat is configuratie, geen douaneadvies.</div>
        <div class="ios-search dt-isearch">
          <div class="ios-search__field">
            <app-icon name="search" [size]="17" />
            <input type="search" data-page-search placeholder="Zoek code of omschrijving" aria-label="Tarieven zoeken" autocomplete="off"
                   enterkeyhint="search" [value]="query()" (input)="query.set($any($event.target).value)" />
            @if (query()) { <button class="ios-search__clear" type="button" aria-label="Zoekopdracht wissen" (click)="query.set('')"><app-icon name="close" [size]="16" /></button> }
          </div>
        </div>
        @if (loadError(); as error) {
          <app-load-error [message]="error" [busy]="loading()" (retry)="load()" />
        } @else if (loading()) {
          <div class="dt-loading" role="status" aria-label="Tarieven laden"><app-skeleton kind="group" [rows]="4" /></div>
        } @else if (!codes().length) {
          <div class="ios-empty">
            <h2 class="ios-empty__title">Nog geen tarieven</h2>
            <p class="ios-empty__text">Voeg een HS-code toe met het invoerrecht dat erbij hoort.</p>
            <button class="ios-capsule ios-capsule--tinted" type="button" (click)="startNew()">Nieuw tarief</button>
          </div>
        } @else {
          <section class="ios-section">
            <div class="ios-group">
              @for (code of rows(); track code.id ?? code.code) {
                <button class="ios-cell" type="button" (click)="startEdit(code)">
                  <span class="ios-cell__body">
                    <span class="ios-cell__title dt-code">{{ formatHs(code.code) }}</span>
                    <span class="ios-cell__sub dt-wrap">{{ code.description || '—' }}</span>
                  </span>
                  <span class="ios-cell__trail">
                    <span class="ios-cell__value ios-cell__value--strong">{{ pctLabel(code.dutyRatePct) }}</span>
                    <span class="ios-cell__meta">{{ productCount(counts().get(code.code) ?? 0) }}</span>
                  </span>
                  <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
                </button>
              } @empty {
                <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Geen tarief gevonden</span></span></div>
              }
            </div>
            <ng-container *ngTemplateOutlet="notes" />
            <p class="ios-section__foot">Het invoerrecht geldt over de douanewaarde: goederen + lokale kosten China + zeevracht. De kosten vanaf de aankomsthaven vallen erbuiten.</p>
          </section>
        }
      </div>
      <button class="fab" type="button" aria-label="Nieuw tarief" (click)="startNew()">+ Tarief</button>

      @if (editing(); as draft) {
        <app-sheet [title]="draft.isNew ? 'Nieuw tarief' : formatHs(draft.original!.code)" variant="ios" (closed)="cancel()">
          <div body class="dt-sheet">
            <div class="ios-group">
              @if (draft.isNew) {
                <label class="ios-cell dt-field" for="dt-code-p">
                  <span class="ios-cell__body"><span class="ios-cell__title">HS-code</span>
                    @if (attempted() && errors().code) { <span class="ios-cell__sub dt-error dt-wrap" role="alert">{{ errors().code }}</span> }</span>
                  <input class="dt-input dt-input--code" id="dt-code-p" type="text" inputmode="numeric" autocomplete="off" placeholder="bijv. 0603 90 00 00"
                         [value]="draft.code" (input)="patch({ code: $any($event.target).value })" />
                </label>
              }
              <label class="ios-cell dt-field" for="dt-desc-p">
                <span class="ios-cell__body"><span class="ios-cell__title">Omschrijving</span></span>
                <input class="dt-input" id="dt-desc-p" type="text" autocomplete="off" [value]="draft.description" (input)="patch({ description: $any($event.target).value })" />
              </label>
              <label class="ios-cell dt-field" for="dt-duty-p">
                <span class="ios-cell__body"><span class="ios-cell__title">Invoerrecht</span>
                  @if (attempted() && errors().duty) { <span class="ios-cell__sub dt-error dt-wrap" role="alert">{{ errors().duty }}</span> }</span>
                <span class="dt-pct"><input class="dt-input dt-input--pct" id="dt-duty-p" type="text" inputmode="decimal" autocomplete="off"
                       [value]="draft.dutyText" (input)="patch({ dutyText: $any($event.target).value })" /><i>%</i></span>
              </label>
            </div>
            @if (!draft.isNew) {
              <p class="ios-section__foot">De code ligt vast; een andere code is een ander tarief. {{ productCount(counts().get(draft.key) ?? 0) }} met deze code.</p>
              <div class="ios-group"><button class="ios-cell ios-cell--danger" type="button" (click)="remove(draft.original!)">Verwijderen</button></div>
            }
          </div>
          <div foot style="display:contents">
            <button class="btn" type="button" (click)="cancel()">Annuleren</button>
            <button class="btn btn--primary" type="button" [disabled]="saving()" (click)="save()">{{ saving() ? 'Bezig…' : 'Opslaan' }}</button>
          </div>
        </app-sheet>
      }
    }

    <ng-template #editRow>
      @if (editing(); as draft) {
        <div class="dt-edit" role="row" [class.dt-edit--warn]="blocked()" (keydown)="editKey($event)">
          <div class="dt-edit__cells">
            <span class="dt-edit__cell">
              @if (draft.isNew) {
                <input #codeField class="input dt-input dt-input--code" type="text" inputmode="numeric" autocomplete="off" placeholder="bijv. 0603 90 00 00"
                       aria-label="HS-code" [value]="draft.code" (input)="patch({ code: $any($event.target).value })" />
                @if (attempted() && errors().code) { <span class="dt-error" role="alert">{{ errors().code }}</span> }
              } @else {
                <span class="dt-code">{{ formatHs(draft.original!.code) }}</span><span class="dt-sub">code vast</span>
              }
            </span>
            <span class="dt-edit__cell">
              <input #descField class="input dt-input" type="text" autocomplete="off" aria-label="Omschrijving" [value]="draft.description"
                     (input)="patch({ description: $any($event.target).value })" />
            </span>
            <span class="dt-edit__cell dt-edit__cell--num">
              <span class="dt-pct"><input class="input dt-input dt-input--pct" type="text" inputmode="decimal" autocomplete="off" aria-label="Invoerrecht in procent"
                     [value]="draft.dutyText" (input)="patch({ dutyText: $any($event.target).value })" /><i>%</i></span>
              @if (attempted() && errors().duty) { <span class="dt-error" role="alert">{{ errors().duty }}</span> }
            </span>
            <span class="dt-edit__cell dt-edit__cell--num">{{ draft.isNew ? '—' : counts().get(draft.key) ?? 0 }}</span>
          </div>
          <div class="dt-strip" role="status">
            <span class="dt-strip__text">@if (blocked()) { Eerst opslaan of Esc } @else if (changes().length) { Gewijzigd: {{ changes().join(', ') }} · Enter slaat op, Esc annuleert } @else { Niets gewijzigd · Esc sluit }</span>
            <button class="wk-btn wk-btn--sm" type="button" (click)="cancel()">Annuleren</button>
            <button class="wk-btn wk-btn--primary wk-btn--sm" type="button" [disabled]="saving()" (click)="save()">{{ saving() ? 'Bezig…' : 'Opslaan' }}</button>
          </div>
        </div>
      }
    </ng-template>

    <ng-template #notes>
      @if (!loading() && (missing().length || mismatches().length)) {
        <div [class]="desktop.active() ? 'dt-notes' : 'dt-notes dt-notes--phone'">
          @if (missing().length) {
            <div class="dt-note">
              <p><b>{{ productCount(missing().length) }} zonder HS-code</b> {{ missing().length === 1 ? 'valt' : 'vallen' }} terug op het invoerrecht van hun inkooporder (meestal 10 %).
                <button class="wk-link" type="button" [attr.aria-expanded]="showMissing()" (click)="showMissing.set(!showMissing())">{{ showMissing() ? 'Verberg' : 'Toon ›' }}</button></p>
              @if (showMissing()) { <ng-container *ngTemplateOutlet="productList; context: { $implicit: missing() }" /> }
            </div>
          }
          @for (mismatch of mismatches(); track mismatch.code + mismatch.spelled) {
            <div class="dt-note dt-note--warn">
              <p><b>{{ productCount(mismatch.products.length) }}</b> {{ mismatch.products.length === 1 ? 'heeft' : 'hebben' }} <b class="dt-code">{{ mismatch.spelled }}</b>: dezelfde code in een andere schrijfwijze. Die vinden geen tarief en rekenen met het percentage van de order.
                <button class="wk-link" type="button" [attr.aria-expanded]="openMismatch() === mismatch.spelled" (click)="openMismatch.set(openMismatch() === mismatch.spelled ? null : mismatch.spelled)">{{ openMismatch() === mismatch.spelled ? 'Verberg' : 'Toon ›' }}</button></p>
              @if (openMismatch() === mismatch.spelled) { <ng-container *ngTemplateOutlet="productList; context: { $implicit: mismatch.products }" /> }
            </div>
          }
        </div>
      }
    </ng-template>

    <ng-template #productList let-products>
      <ul class="dt-products">
        @for (product of products.slice(0, 20); track product.id) { <li><a class="wk-link" [routerLink]="['/products', product.id]">{{ product.name }}</a></li> }
        @if (products.length > 20) { <li class="dt-sub">en {{ products.length - 20 }} meer</li> }
      </ul>
    </ng-template>

    @if (menu(); as open) {
      <app-context-menu [title]="formatHs(open.code.code)" [items]="menuItems" [anchor]="open.anchor" variant="ios" cancelLabel="Annuleren"
                        (pick)="menu.set(null); remove(open.code)" (closed)="menu.set(null)" />
    }
  `,
})
export class DouanePage implements HasUnsavedChanges {
  readonly desktop = inject(DesktopViewport);
  private readonly catalog = inject(CatalogApi);
  private readonly ui = inject(Ui);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly searchField = viewChild<ElementRef<HTMLInputElement>>('searchField');
  readonly formatHs = formatHs;
  readonly pctLabel = pctLabel;

  readonly codes = signal<HsCode[]>([]);
  readonly products = signal<Product[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly query = signal('');
  readonly editing = signal<TariffDraft | null>(null);
  /** A dirty row was left for another: it stays open and says so (N17). */
  readonly blocked = signal(false);
  readonly attempted = signal(false);
  readonly saving = signal(false);
  /** The row just saved, for a short highlight. */
  readonly savedKey = signal<string | null>(null);
  /** The row being deleted: only it leaves with a motion. */
  readonly leavingCode = signal<string | null>(null);
  readonly showMissing = signal(false);
  readonly openMismatch = signal<string | null>(null);
  readonly menu = signal<{ code: HsCode; anchor: MenuPoint | null } | null>(null);
  readonly menuItems: ContextMenuItem[] = [{ id: 'delete', label: 'Verwijderen…', iconName: 'trash', hint: 'Na bevestiging', danger: true }];

  readonly rows = computed(() => {
    const query = this.query();
    return this.codes().filter((code) => matchesTariff(code, query)).sort((a, b) => normalizeHs(a.code).localeCompare(normalizeHs(b.code)) || a.code.localeCompare(b.code));
  });
  readonly counts = computed(() => countByCode(this.products(), this.codes()));
  readonly missing = computed(() => withoutCode(this.products()));
  readonly mismatches = computed(() => spellingMismatches(this.products(), this.codes()));
  readonly errors = computed(() => {
    const draft = this.editing();
    return draft ? validateTariff(draft, this.codes()) : {};
  });
  readonly changes = computed(() => {
    const draft = this.editing();
    return draft ? changedFields(draft.original, draft) : [];
  });
  /** Unsaved work in the open row: a new code with something typed, or a saved one that changed. */
  readonly dirty = computed(() => {
    const draft = this.editing();
    if (!draft) return false;
    return draft.isNew ? !!(draft.code.trim() || draft.description.trim() || draft.dutyText.trim()) : this.changes().length > 0;
  });

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const [codes, products] = await Promise.all([this.catalog.hsCodes(), this.catalog.products()]);
      this.codes.set(codes);
      this.products.set(products);
    } catch (failure: unknown) {
      this.loadError.set(messageOf(failure, LOAD_ERROR_FALLBACK));
    } finally {
      this.loading.set(false);
    }
  }

  productCount(count: number): string {
    return `${count} ${count === 1 ? 'product' : 'producten'}`;
  }

  /** Open a row; a dirty row elsewhere keeps the focus and says so instead (N17). */
  startEdit(code: HsCode): void {
    const current = this.editing();
    if (current && current.key === code.code) return;
    if (current && this.dirty()) { this.blocked.set(true); return; }
    this.blocked.set(false);
    this.attempted.set(false);
    this.editing.set({ key: code.code, isNew: false, original: code, code: code.code, description: code.description ?? '', dutyText: pctInput(code.dutyRatePct) });
    this.focusEdit();
  }

  startNew(): void {
    const current = this.editing();
    if (current && this.dirty()) { this.blocked.set(true); return; }
    this.blocked.set(false);
    this.attempted.set(false);
    this.query.set('');
    this.editing.set({ key: NEW, isNew: true, original: null, code: '', description: '', dutyText: '' });
    this.focusEdit();
  }

  private focusEdit(): void {
    if (!this.desktop.active()) return;
    requestAnimationFrame(() => this.host.nativeElement.querySelector<HTMLInputElement>('.dt-edit input')?.focus());
  }

  patch(changes: Partial<TariffDraft>): void {
    this.editing.update((draft) => draft ? { ...draft, ...changes } : draft);
    this.blocked.set(false);
  }

  cancel(): void {
    this.editing.set(null);
    this.blocked.set(false);
    this.attempted.set(false);
  }

  /** Saves the open row alone: only that row changes on screen, no reload. */
  async save(): Promise<boolean> {
    const draft = this.editing();
    if (!draft || this.saving()) return false;
    this.attempted.set(true);
    const errors = this.errors();
    if (errors.code || errors.duty) return false;
    if (!draft.isNew && !this.changes().length) { this.cancel(); return true; }
    this.saving.set(true);
    try {
      const body: HsCode = { id: draft.original?.id ?? null, code: draft.isNew ? draft.code.trim() : draft.original!.code,
        description: draft.description.trim() || null, dutyRatePct: parsePct(draft.dutyText) ?? 0 };
      const saved = await this.catalog.saveHsCode(body);
      const row: HsCode = { ...body, ...(saved ?? {}) };
      this.codes.update((codes) => draft.isNew ? [...codes, row] : codes.map((code) => code.code === draft.original!.code ? row : code));
      this.cancel();
      this.savedKey.set(row.code);
      setTimeout(() => { if (this.savedKey() === row.code) this.savedKey.set(null); }, 1200);
      this.ui.toast('Tarief opgeslagen');
      return true;
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Opslaan mislukt'), 'err');
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  remove(code: HsCode): void {
    const count = this.counts().get(code.code) ?? 0;
    const who = count ? `<b>${this.productCount(count)}</b> ${count === 1 ? 'valt' : 'vallen'}` : 'Producten vallen';
    this.ui.confirm(
      { title: 'Tariefcode verwijderen', message: `<b>${escapeHtml(formatHs(code.code))}</b> verwijderen? ${who} terug op het invoerrecht van hun inkooporder.`,
        confirmLabel: 'Verwijderen', danger: true },
      async () => {
        try {
          await this.catalog.deleteHsCode(code.code);
          if (this.editing()?.key === code.code) this.cancel();
          this.leavingCode.set(code.code);
          this.codes.update((codes) => codes.filter((candidate) => candidate.code !== code.code));
          this.ui.toast('Tarief verwijderd');
        } catch (failure: unknown) {
          this.ui.toast(messageOf(failure, 'Verwijderen mislukt'), 'err');
        }
      });
  }

  openMenu(event: Event, code: HsCode): void {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.menu.set({ code, anchor: { x: rect.left, y: rect.bottom + 4 } });
  }

  /** In the open row: Enter saves, Esc cancels (unless a sheet or menu is open). */
  editKey(event: KeyboardEvent): void {
    if (document.querySelector('.overlay, .cm, [data-kit-overlay]')) return;
    if (event.key === 'Enter') { event.preventDefault(); void this.save(); }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.cancel(); }
  }

  escapeSearch(event: Event): void {
    event.preventDefault();
    if (this.query()) this.query.set('');
    else (event.target as HTMLInputElement).blur();
  }

  @HostListener('document:keydown', ['$event'])
  onKey(event: KeyboardEvent): void {
    if (!this.desktop.active() || event.metaKey || event.ctrlKey || event.altKey) return;
    const context = keyContext(event, this.host.nativeElement);
    if (context.typing || context.overlayOpen || !context.inScope) return;
    if (event.key === '/') { event.preventDefault(); this.searchField()?.nativeElement.focus(); }
    else if ((event.key === 'n' || event.key === 'N') && !event.shiftKey) { event.preventDefault(); this.startNew(); }
  }

  /** Leaving with an unsaved row asks first (the foundation's leave dialog: Opslaan / Niet opslaan / Annuleren). */
  canDeactivate(): boolean | Promise<boolean> {
    return this.dirty() ? confirmLeave(this.ui, () => this.save()) : true;
  }
}
