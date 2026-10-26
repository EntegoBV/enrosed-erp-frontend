import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, forwardRef, inject, signal, untracked } from '@angular/core';
import type { InvoiceRow } from '../../core/api/invoice-finder-api';
import { Icon } from '../../shared/icon';
import { Skeleton } from '../../shared/skeleton';
import { containerName } from '../purchasing/container-name';
import { FINANCE_SECTION, FinanceSectionApi, StripItem } from './finance-section';
import { selectOne } from './finance-selection';
import type { FinanceCommand } from './finance-shortcuts';
import { FinanceState, SERVER_PENDING } from './finance-state';
import { FinanceTable } from './finance-table';
import { InvoiceFinderState } from './invoice-finder-state';
import {
  amountText, containerLabel, dateTitle, deskDate, deskFacts, eurApprox, linkChips, monthGroups, numberText, onlyOptions, partyName,
  phoneSubParts, statusWord, titleLine,
} from './invoice-finder';

/**
 * Facturen: the finder's list. A desk table (Van/Aan · nummer, Datum,
 * Bedrag, Status, Gekoppeld) whose row opens the preview beside it, or
 * phone cells by month. It renders on its own, before FinanceState has
 * loaded; the preview and the sheets are rendered by CostsPage.
 */
@Component({
  selector: 'app-invoices-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: FINANCE_SECTION, useExisting: forwardRef(() => InvoicesPanel) }],
  imports: [Icon, Skeleton],
  template: `
    @let rows = finder.rows();
    @if (state.desk()) {
      @if (finder.odoo()?.state === 'ERROR') {
        <div class="wk-banner wk-banner--warn wk-banner--inset fin-inv-banner" role="alert">
          <app-icon name="alert" [size]="18" />
          <span class="wk-banner__text">Odoo niet bereikbaar. Alleen ENROSED getoond.</span>
          <span class="wk-banner__actions"><button class="wk-btn wk-btn--sm" type="button" [disabled]="finder.loading()" (click)="finder.reload()">Opnieuw</button></span>
        </div>
      }
      @if (skeleton()) {
        <div class="fin-loading" aria-busy="true"><app-skeleton kind="table" [rows]="10" /></div>
      } @else if (finder.pending()) {
        <div class="wk-empty"><span class="wk-empty__icon"><app-icon name="document" [size]="22" /></span>
          <p class="wk-empty__title">Facturen</p><p class="wk-empty__text">{{ serverPending }}</p></div>
      } @else if (finder.error() && !rows.length) {
        <div class="wk-empty"><span class="wk-empty__icon"><app-icon name="alert" [size]="22" /></span>
          <p class="wk-empty__title">{{ finder.error() }}</p>
          <div class="wk-empty__actions"><button class="wk-btn" type="button" (click)="finder.reload()">Opnieuw</button></div></div>
      } @else if (rows.length) {
        <div class="wk-table fin-table fin-table--invoices" role="grid" aria-label="Facturen" [attr.aria-busy]="finder.loading() || null">
          <div class="wk-thead" role="row">
            <span class="wk-th" role="columnheader">{{ tab() === 'out' ? 'Aan · nummer' : 'Van · nummer' }}</span>
            <span class="wk-th" role="columnheader">Datum</span>
            <span class="wk-th wk-th--num" role="columnheader">Bedrag</span>
            <span class="wk-th" role="columnheader">Status</span>
            <span class="wk-th" role="columnheader" data-hide="xs">Gekoppeld</span>
          </div>
          @for (row of rows; track row.key) {
            @let chips = chipsOf(row);
            <div class="wk-tr wk-tr--link fin-inv-row" role="row" [attr.tabindex]="table.stop() === row.key ? 0 : -1" [attr.data-key]="row.key"
                 [attr.aria-selected]="finder.selectedKey() === row.key" (focus)="table.focused(row.key)" (click)="pick(row.key)" (dblclick)="finder.openSource(row)">
              <span class="wk-td fin-inv__main" role="gridcell">
                <span class="fin-inv__title"><b>{{ party(row) }}</b> · <span class="fin-inv__no">{{ number(row) }}</span></span>
                <span class="wk-td__sub fin-inv__sub"><span class="fin-inv__facts">{{ facts(row) }}</span>
                  @if (chips.length) {
                    <span class="fin-narrow-only fin-inv__chips">
                      <button class="wk-chip fin-inv-chip" type="button" [title]="chips[0].title" (click)="openChip($event, chips[0])" (dblclick)="$event.stopPropagation()">{{ chips[0].label }}</button>
                      @if (chips.length > 1) { <span class="fin-inv__more" [title]="moreTitle(chips, 1)">+{{ chips.length - 1 }}</span> }
                    </span>
                  }</span>
              </span>
              <span class="wk-td" role="gridcell" [attr.title]="dateTitle(row)">{{ deskDate(row.sortDate) }}</span>
              <span class="wk-td wk-td--num fin-inv__amount" role="gridcell" [attr.title]="eurApprox(row)">{{ amount(row) }}</span>
              <span class="wk-td" role="gridcell"><span class="wk-pill" [class]="pillClass(row)">{{ statusWord(row).label }}</span></span>
              <span class="wk-td fin-inv__links" role="gridcell" data-hide="xs">
                @for (chip of chips.slice(0, 2); track chip.type + chip.id; let second = $odd) {
                  <button class="wk-chip fin-inv-chip" [class.fin-inv-chip--fixed]="chip.type !== 'CONTAINER'" [class.fin-inv-chip--second]="second" type="button" [title]="chip.title" (click)="openChip($event, chip)" (dblclick)="$event.stopPropagation()">{{ chip.label }}</button>
                }
                @if (chips.length > 2) { <span class="fin-inv__more fin-inv__more--wide" [title]="moreTitle(chips, 2)">+{{ chips.length - 2 }}</span> }
                @if (chips.length > 1) { <span class="fin-inv__more fin-inv__more--narrow" [title]="moreTitle(chips, 1)">+{{ chips.length - 1 }}</span> }
              </span>
            </div>
          }
        </div>
        @if (finder.hasMore()) {
          <div class="fin-more"><button class="wk-btn" type="button" [disabled]="finder.loadingMore()" (click)="finder.more()">{{ finder.loadingMore() ? 'Laden…' : 'Meer laden' }}</button></div>
        }
      } @else {
        <div class="wk-empty"><span class="wk-empty__icon"><app-icon name="document" [size]="22" /></span>
          @if (filtered()) {
            <p class="wk-empty__title">Geen factuur gevonden</p>
            <div class="wk-empty__actions"><button class="wk-link" type="button" (click)="clearFilters()">Filters wissen</button></div>
          } @else {
            <p class="wk-empty__title">Nog geen facturen</p>
          }
        </div>
      }
    } @else {
      <div class="ios-search fin-ios-search"><label class="ios-search__field"><app-icon name="search" [size]="16" />
        <input type="search" placeholder="Nummer, naam, bedrag of container" aria-label="Zoeken in facturen" [value]="state.location().q" (input)="search($any($event.target).value)" />
        <button class="ios-search__clear" type="button" aria-label="Zoekterm wissen" (click)="search('', true)"><app-icon name="close" [size]="14" /></button></label></div>
      <div class="ios-chips" role="group" aria-label="Soort">
        @if (state.location().po) {
          <button class="ios-chip" type="button" aria-pressed="true" [attr.aria-label]="'Filter op ' + poName() + ' wissen'" (click)="state.go({ po: null })">{{ poName() }} <app-icon name="close" [size]="12" /></button>
        }
        @for (option of options(); track option.id) {
          <button class="ios-chip" type="button" [attr.aria-pressed]="state.location().only === option.id" (click)="state.go({ only: option.id })">{{ option.label }}</button>
        }
      </div>
      @if (finder.odoo()?.state === 'ERROR') {
        <div class="ios-banner fin-ios-banner" role="alert">
          <span>Odoo niet bereikbaar. Alleen ENROSED getoond.</span>
          <button class="ios-capsule ios-capsule--sm ios-capsule--tinted" type="button" [disabled]="finder.loading()" (click)="finder.reload()">Opnieuw</button>
        </div>
      }
      @if (skeleton()) {
        <div class="fin-loading" aria-busy="true"><app-skeleton kind="group" [rows]="6" /></div>
      } @else if (finder.pending()) {
        <div class="ios-empty"><span class="ios-empty__icon"><app-icon name="document" [size]="26" /></span><p class="ios-empty__title">Facturen</p>
          <p class="ios-empty__text">{{ serverPending }}</p></div>
      } @else if (finder.error() && !rows.length) {
        <div class="ios-empty"><span class="ios-empty__icon"><app-icon name="alert" [size]="26" /></span><p class="ios-empty__title">{{ finder.error() }}</p>
          <button class="ios-capsule ios-capsule--tinted" type="button" (click)="finder.reload()">Opnieuw</button></div>
      } @else {
        @for (group of groups(); track group.label) {
          <section class="ios-section">
            <div class="ios-section__head"><h2>{{ group.label }}</h2></div>
            <div class="ios-group">
              @for (row of group.rows; track row.key) {
                @let sub = subOf(row);
                <button class="ios-cell ios-cell--tall fin-inv-cell" type="button" (click)="finder.select(row.key, 'push')">
                  <span class="ios-cell__body"><span class="ios-cell__title ios-cell__title--2">{{ title(row) }}</span>
                    <!-- the status never gives way: a long container name ends in "…" before it -->
                    <span class="ios-cell__sub fin-inv-sub"><span class="fin-inv-sub__lead">{{ sub.lead }}</span><span class="fin-inv-sub__status" [class.fin-warn-text]="row.status === 'OVERDUE'">· {{ sub.status }}</span></span></span>
                  <span class="ios-cell__trail"><span class="ios-cell__value ios-cell__value--strong">{{ amount(row) }}</span></span>
                  <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
                </button>
              }
            </div>
          </section>
        } @empty {
          <div class="ios-empty"><span class="ios-empty__icon"><app-icon name="document" [size]="26" /></span>
            <p class="ios-empty__title">{{ filtered() ? 'Geen factuur gevonden' : 'Nog geen facturen' }}</p>
            @if (filtered()) { <button class="ios-capsule ios-capsule--tinted" type="button" (click)="clearFilters()">Filters wissen</button> }
          </div>
        }
        @if (finder.hasMore()) {
          <div class="ios-group fin-inv-more"><button class="ios-cell ios-cell--action" type="button" [disabled]="finder.loadingMore()" (click)="finder.more()">{{ finder.loadingMore() ? 'Laden…' : 'Meer laden' }}</button></div>
        }
      }
    }
  `,
})
export class InvoicesPanel implements FinanceSectionApi {
  readonly state = inject(FinanceState);
  readonly finder = inject(InvoiceFinderState);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly serverPending = SERVER_PENDING;

  readonly strip = signal<readonly StripItem[] | null>(null);
  readonly status = computed(() => {
    const count = this.finder.rows().length;
    if (this.finder.pending() || (!this.finder.answered() && !count)) return '';
    return this.finder.hasMore() ? `${count} getoond · meer laden` : `${count} ${count === 1 ? 'factuur' : 'facturen'}`;
  });

  readonly tab = computed<'in' | 'out'>(() => (this.state.location().tab === 'out' ? 'out' : 'in'));
  readonly options = computed(() => onlyOptions(this.tab()));
  readonly keys = computed(() => this.finder.rows().map((row) => row.key));
  readonly groups = computed(() => monthGroups(this.finder.rows()));
  readonly skeleton = computed(() => !this.finder.answered() && !this.finder.rows().length);
  /** Something narrows the list (search, chip, container, period): the empty state offers "Filters wissen". */
  readonly filtered = computed(() => {
    const location = this.state.location();
    return !!location.q.trim() || !!location.only || !!location.po || (!!location.period && location.period !== 'all');
  });
  /** The container of po=: from the rows (before FinanceState lands), then the purchase orders and payments. */
  readonly poName = computed(() => {
    const id = this.state.location().po;
    if (!id) return '';
    const container = this.finder.rows().find((row) => row.container?.id === id)?.container;
    if (container) return containerLabel(container);
    const view = this.state.purchaseViews().find((row) => row.order.id === id);
    if (view) return containerName(view.order);
    const payment = this.state.payments().find((row) => row.orderId === id);
    return containerName({ id, number: payment?.orderNumber, alias: payment?.orderAlias });
  });

  readonly table = new FinanceTable({
    order: () => this.keys(),
    host: () => this.host.nativeElement,
    inspect: (key) => this.finder.select(key, 'replace'),
  });

  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  /* The row helpers the template calls; kept as members so the template stays readable. */
  readonly party = partyName;
  readonly number = numberText;
  readonly title = titleLine;
  readonly amount = amountText;
  readonly statusWord = statusWord;
  readonly dateTitle = dateTitle;
  readonly deskDate = deskDate;
  readonly eurApprox = eurApprox;
  facts(row: InvoiceRow): string { return deskFacts(row).join(' · '); }
  chipsOf(row: InvoiceRow) { return linkChips(row); }
  subOf(row: InvoiceRow) { return phoneSubParts(row, this.state.today()); }
  pillClass(row: InvoiceRow): string { const tone = statusWord(row).tone; return tone ? `wk-pill tone-${tone}` : 'wk-pill'; }
  moreTitle(chips: { label: string }[], shown: number): string { return chips.slice(shown).map((chip) => chip.label).join(', '); }

  constructor() {
    inject(DestroyRef).onDestroy(() => { if (this.searchTimer) clearTimeout(this.searchTimer); });
    /* The preview's row is the table's row: a deep link (doc=) selects it and scrolls it into view. */
    effect(() => {
      const key = this.finder.selectedKey();
      const present = this.keys().includes(key);
      untracked(() => {
        if (!key || !present || this.table.selection().focus === key) return;
        this.table.selection.set(selectOne(key));
        setTimeout(() => this.host.nativeElement.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)?.scrollIntoView({ block: 'nearest' }));
      });
    });
  }

  /** A click picks one row and shows it in the preview (no multi-select in the finder). */
  pick(key: string): void {
    this.table.selection.set(selectOne(key));
    this.finder.select(key, 'replace');
  }

  openChip(event: MouseEvent, chip: { type: 'CONTAINER' | 'TRANSACTION' | 'TICA'; id: number }): void {
    event.stopPropagation();
    this.finder.openLink(chip);
  }

  private focusRow(): InvoiceRow | null {
    const focus = this.table.selection().focus;
    return this.finder.rows().find((row) => row.key === focus) ?? this.finder.selected();
  }

  handle(command: FinanceCommand): boolean {
    switch (command) {
      case 'up': case 'down': return this.table.handle(command);
      case 'open': {
        const row = this.focusRow();
        if (!row) return false;
        this.finder.openSource(row);
        return true;
      }
      case 'toggle': {
        if (this.finder.selectedKey()) { this.finder.close(); return true; }
        const row = this.focusRow();
        if (!row) return false;
        this.finder.select(row.key, 'replace');
        return true;
      }
      case 'escape':
        /* A transaction opened from a chip sits above the preview: the page closes it first. */
        if (this.state.inspect() || !this.finder.selectedKey()) return false;
        this.finder.close();
        return true;
      case 'link': {
        const row = this.finder.selected() ?? this.focusRow();
        if (!row || row.source !== 'ODOO' || !row.odoo?.registrable || !this.finder.financeReady()) return false;
        this.finder.registering.set(row);
        return true;
      }
      default: return false;
    }
  }

  search(value: string, now = false): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    if (now) { this.state.go({ q: value }); return; }
    this.searchTimer = setTimeout(() => { this.searchTimer = null; this.state.go({ q: value }); }, 400);
  }

  /** "Filters wissen": chip, container, period and search. */
  clearFilters(): void {
    this.state.go({ only: '', po: null, period: 'all', from: '', to: '', q: '' });
  }
}
