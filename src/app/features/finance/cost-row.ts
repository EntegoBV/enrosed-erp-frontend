import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { CompanyCost } from '../../core/api/models';
import { Icon } from '../../shared/icon';
import { MenuTrigger } from '../../shared/menu-trigger';
import { EurPipe } from '../../shared/pipes';
import { SwipeActions } from '../../shared/swipe-actions';
import { categoryLabel, categoryTone } from './cost-categories';
import { dayMonth } from './finance-format';
import { cashTotalOf, openOf, paidOf, regimeLabel, vatOf } from './finance-metrics';
import { FinanceState } from './finance-state';
import { daysBetween } from './payables';

/**
 * One company cost, in two shapes. On a desk a table row (Te betalen or
 * Uitgaven columns) that selects on click, opens its menu on right-click and
 * takes a dropped file. On a phone an inset row: leading swipe opens the payment sheet
 * with the amount still open, trailing swipe deletes or opens the
 * menu, long press opens the same menu, a tap opens the detail sheet. A cost
 * paid in several transfers (the KBC invoice) reads 'Deels · nog € x' until
 * the last one.
 */
@Component({
  selector: 'app-cost-row',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  imports: [Icon, EurPipe, MenuTrigger, SwipeActions],
  template: `
    @let row = cost();
    @if (layout() === 'grid') {
      <div class="wk-tr wk-tr--link fin-row" role="row" [attr.tabindex]="tabStop() ? 0 : -1" [attr.data-key]="key()" data-drop-cost
           [attr.aria-selected]="selected()" [class.wk-tr--drop]="dropping()"
           (focus)="focused.emit()" (click)="select.emit($event)" (dblclick)="state.openCost(row)"
           appMenuTrigger (menuTrigger)="state.costMenu(row, $event)"
           (dragover)="dragOver($event)" (dragleave)="dropping.set(false)" (drop)="drop($event)">
        <span class="wk-td" role="gridcell">
          <input class="wk-check" type="checkbox" tabindex="-1" [checked]="selected()" [attr.aria-label]="'Selecteer ' + row.description"
                 (click)="$event.stopPropagation()" (change)="check.emit()" />
        </span>
        @if (columns() === 'payable') {
          <span class="wk-td" role="gridcell">{{ date() }}
            @if (age() !== null && age()! > 0) { <span class="wk-pill fin-age" [class.tone-warn]="age()! > 30 && age()! <= 60" [class.tone-danger]="age()! > 60">{{ age() }} d</span> }
          </span>
          <span class="wk-td" role="gridcell">{{ row.description }}@if (regimeNote()) { <span class="wk-pill wk-pill--outline" [title]="regimeNote()">te bevestigen</span> }@if (row.party) { <span class="wk-td__sub">{{ row.party }}</span> }</span>
          <span class="wk-td" role="gridcell" data-hide="xs"><span class="wk-pill tone-teal">Kost</span></span>
          <span class="wk-td" role="gridcell"><span [class]="'wk-dot tone-' + tone()"></span> {{ category() }}</span>
          <span class="wk-td fin-clip" role="gridcell" data-hide="md">@if (documents()) { <app-icon name="clip" [size]="14" />{{ documents() }} }</span>
          <span class="wk-td wk-td--num" role="gridcell"><b>{{ open() | eur }}</b>@if (status() === 'partial') { <span class="wk-td__sub">van {{ incl() | eur }}</span> }</span>
          <span class="wk-td wk-td--actions" role="gridcell">
            <button class="wk-btn wk-btn--sm" type="button" tabindex="-1" (click)="$event.stopPropagation(); state.openPay([row])">Betaald…</button>
          </span>
        } @else {
          <span class="wk-td" role="gridcell">{{ date() }}</span>
          <span class="wk-td" role="gridcell">{{ row.description }}@if (row.recurringCostId) { <app-icon class="fin-inline-icon" name="repeat" [size]="13" title="Geboekt als vaste kost" /> }@if (regimeNote()) { <span class="wk-pill wk-pill--outline" [title]="regimeNote()">te bevestigen</span> }@if (row.party) { <span class="wk-td__sub">{{ row.party }}</span> }</span>
          <span class="wk-td" role="gridcell" data-hide="xs"><span [class]="'wk-dot tone-' + tone()"></span> {{ category() }}</span>
          <span class="wk-td fin-hide-lg" role="gridcell" data-hide="md inspecting">{{ row.reference || '—' }}</span>
          <span class="wk-td fin-hide-lg" role="gridcell" data-hide="md inspecting">{{ row.salesChannel ? channel(row.salesChannel) : '—' }}</span>
          <span class="wk-td fin-clip" role="gridcell" data-hide="md">@if (documents()) { <app-icon name="clip" [size]="14" />{{ documents() }} }@if (banked() !== 'none') { <app-icon name="bank" [size]="14" [attr.title]="bankTitle()" [style.opacity]="banked() === 'some' ? .55 : null" /> }</span>
          <span class="wk-td wk-td--num" role="gridcell" data-hide="xs">{{ row.amountExclEur | eur }}</span>
          <span class="wk-td wk-td--num" role="gridcell" data-hide="md">{{ vat() | eur }}</span>
          <span class="wk-td wk-td--num" role="gridcell"><b>{{ incl() | eur }}</b></span>
          <span class="wk-td fin-status" role="gridcell">
            @switch (status()) {
              @case ('paid') {
                @if (overpaid() > 0) { <span class="wk-pill tone-blue">Te veel betaald · {{ overpaid() | eur }}</span> }
                @else { <span class="wk-amount--muted">Betaald {{ paid() }}</span> }
              }
              @case ('partial') {
                <span class="wk-pill tone-warn fin-status__open">Deels</span><span class="wk-amount--muted fin-status__open">nog {{ open() | eur }}</span>
                <button class="wk-btn wk-btn--sm fin-status__pay" type="button" tabindex="-1" (click)="$event.stopPropagation(); state.openPay([row])">Betaald…</button>
              }
              @default {
                <span class="wk-pill tone-warn fin-status__open">Open</span>
                <button class="wk-btn wk-btn--sm fin-status__pay" type="button" tabindex="-1" (click)="$event.stopPropagation(); state.openPay([row])">Betaald…</button>
              }
            }
          </span>
        }
      </div>
    } @else {
      <div class="ios-swipe" appSwipeActions #sw="swipeActions" [swipeStart]="open() > 0 ? 1 : 0" [swipeEnd]="2" swipeFull="start"
           (swipeCommit)="$event === 'start' && state.swipePay(row)">
        @if (open() > 0) {
          <div class="ios-swipe__actions ios-swipe__actions--start">
            <button class="ios-swipe__btn tone-ok" type="button" (click)="state.swipePay(row); sw.close()"><app-icon name="tick" [size]="20" />Betaald…</button>
          </div>
        }
        <div class="ios-swipe__actions ios-swipe__actions--end">
          <button class="ios-swipe__btn tone-danger" type="button" (click)="state.deleteCost(row); sw.close()"><app-icon name="trash" [size]="20" />Verwijder</button>
          <button class="ios-swipe__btn tone-grey" type="button" (click)="state.costMenu(row, null); sw.close()"><app-icon name="more" [size]="20" />Meer</button>
        </div>
        <div class="ios-swipe__row">
          <button class="ios-cell ios-cell--tall" type="button" appMenuTrigger (menuTrigger)="state.costMenu(row, null)"
                  (click)="state.inspectItem({ kind: 'cost', id: row.id! })">
            <span class="ios-cell__lead"><span [class]="'ios-tile ios-tile--lg ios-tile--soft tone-' + tone()"><app-icon name="receipt" [size]="18" /></span></span>
            <span class="ios-cell__body">
              <span class="ios-cell__title">{{ row.description }}</span>
              <span class="ios-cell__sub">{{ row.party || category() }}</span>
            </span>
            <!-- The status sits under the amount, so a long party name is what gets cut, never the age or 'Open'. -->
            <span class="ios-cell__trail">
              <span class="ios-cell__value ios-cell__value--strong">{{ (columns() === 'payable' ? open() : incl()) | eur }}</span>
              <span class="ios-cell__meta">
                @if (documents()) { <app-icon name="clip" [size]="12" /> }
                @if (columns() === 'ledger') {
                  @switch (status()) {
                    @case ('paid') { @if (overpaid() > 0) { Te veel betaald · {{ overpaid() | eur }} } @else { Betaald {{ paid() }} } }
                    @case ('partial') { <span class="fin-warn-text">Deels · nog {{ open() | eur }}</span> }
                    @default { <span class="fin-warn-text">Open</span> }
                  }
                  @if (regimeNote()) { · {{ regimeNote() }} }
                } @else if (status() === 'partial') { <span class="fin-warn-text">Deels</span> · van {{ incl() | eur }} }
                @else if (age()) { <span [class.fin-warn-text]="age()! > 30">sinds {{ age() }} d</span> }
              </span>
            </span>
          </button>
        </div>
      </div>
    }
  `,
})
export class CostRow {
  readonly state = inject(FinanceState);
  readonly cost = input.required<CompanyCost>();
  readonly layout = input<'grid' | 'inset'>('grid');
  readonly columns = input<'payable' | 'ledger'>('ledger');
  readonly selected = input(false);
  /** This row is the table's Tab stop. */
  readonly tabStop = input(false);
  readonly select = output<MouseEvent>();
  readonly check = output<void>();
  readonly focused = output<void>();
  readonly dropping = signal(false);

  readonly key = computed(() => `cost:${this.cost().id}`);
  readonly incl = computed(() => cashTotalOf(this.cost()));
  readonly vat = computed(() => vatOf(this.cost()));
  /** What is still to pay; the server's figure, so a cost paid in parts reads right everywhere. */
  readonly open = computed(() => openOf(this.cost()));
  readonly overpaid = computed(() => Math.max(0, Math.round((paidOf(this.cost()) - cashTotalOf(this.cost())) * 100)) / 100);
  readonly status = computed<'open' | 'partial' | 'paid'>(() => {
    const open = Math.round(this.open() * 100);
    return open <= 0 ? 'paid' : open < Math.round(this.incl() * 100) ? 'partial' : 'open';
  });
  readonly date = computed(() => dayMonth(this.cost().date));
  readonly paid = computed(() => dayMonth(this.cost().paidOn));
  /** Import VAT on a customs document is its own line in the books, not a category. */
  readonly importVat = computed(() => this.cost().vatRegime === 'IMPORT_VAT_PAID');
  readonly category = computed(() => (this.importVat() ? 'Invoer-btw' : categoryLabel(this.cost().category)));
  readonly tone = computed(() => (this.importVat() ? 'grey' : categoryTone(this.cost().category)));
  readonly documents = computed(() => this.state.attachmentsFor(this.cost().id).length);
  /** Whether the bank holds the payments: none, some of them, or all. */
  readonly banked = computed(() => this.state.paymentsBanked(this.cost()));
  readonly bankTitle = computed(() => {
    if (this.banked() !== 'some') return 'Op de bank genoteerd';
    const lines = this.state.bankedLines();
    const payments = this.cost().payments ?? [];
    const onBank = payments.filter((payment) => payment.bankStatementLineId != null || (!!payment.id && lines.has(`kostbetaling#${payment.id}`))).length;
    return `${onBank} van ${payments.length} betalingen op de bank`;
  });
  /** 'België · te bevestigen' while the regime was only derived; 'Nog te bepalen' without one. */
  readonly regimeNote = computed(() => {
    const cost = this.cost();
    if (!cost.vatRegime) return regimeLabel(null);
    return cost.vatRegimeConfirmed ? '' : `${regimeLabel(cost.vatRegime)} · te bevestigen`;
  });
  readonly age = computed(() => {
    const cost = this.cost();
    return cost.date <= this.state.today() ? daysBetween(cost.date, this.state.today()) : null;
  });
  readonly channel = (code: string): string => this.state.channelName(code);

  dragOver(event: DragEvent): void {
    if (!event.dataTransfer || ![...event.dataTransfer.types].includes('Files')) return;
    event.preventDefault();
    this.dropping.set(true);
  }

  drop(event: DragEvent): void {
    this.dropping.set(false);
    const files = [...(event.dataTransfer?.files ?? [])];
    if (!files.length || !this.cost().id) return;
    event.preventDefault();
    event.stopPropagation();
    void this.state.attach(this.cost().id!, files);
  }
}
