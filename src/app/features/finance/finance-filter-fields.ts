import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Segmented, SegmentOption } from '../../shared/segmented';
import { SALES_CHANNELS } from '../sales/sales-channels';
import { categoryChoices } from './cost-categories';
import { FinanceState } from './finance-state';
import { FinancePurpose, NO_ACCOUNT } from './finance-url';

/**
 * The filters behind 'Filter (n)': for Uitgaven › Bedrijfskosten and for
 * Te ontvangen › Ontvangen. The same fields sit in the desk popover and in
 * the phone filter sheet (an inset group there); every change goes straight
 * to the address. The host has no box, so the popover's or sheet's grid
 * gap spaces the fields.
 */
@Component({
  selector: 'app-finance-filter-fields',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  imports: [Segmented],
  template: `
    @let location = state.location();
    <div class="fin-group" [class.ios-group]="!state.desk()">
    @if (kind() === 'costs') {
      <label class="fin-field"><span>Categorie</span>
        <select class="select" [value]="location.cat" (change)="state.go({ cat: $any($event.target).value })">
          <option value="">Alle categorieën</option>
          @for (option of categories(); track option.code) { <option [value]="option.code" [selected]="option.code === location.cat">{{ option.label }}</option> }
        </select></label>
      <div class="fin-field fin-field--stack"><span>Status</span>
        <app-segmented [variant]="variant()" label="Status" [options]="statusOptions" [value]="location.status" (changed)="state.go({ status: $any($event) })" /></div>
      <label class="fin-field"><span>Kanaal</span>
        <select class="select" [value]="location.channel" (change)="state.go({ channel: $any($event.target).value })">
          <option value="">Alle kanalen</option>
          @for (channel of channels; track channel.code) { <option [value]="channel.code" [selected]="channel.code === location.channel">{{ channel.label }}</option> }
        </select></label>
      <label class="fin-field fin-field--switch"><span>Zonder document<small>Alleen kosten zonder factuur of bon; vaste kosten tellen niet mee</small></span>
        <input [class]="state.desk() ? 'fin-checkbox' : 'ios-switch'" type="checkbox" role="switch" [checked]="location.docs === 'missing'" (change)="state.go({ docs: $any($event.target).checked ? 'missing' : '' })" /></label>
      <button [class]="state.desk() ? 'wk-link fin-reset' : 'fin-row-action'" type="button" (click)="reset()">Standaard herstellen</button>
    } @else {
      <div class="fin-field fin-field--stack"><span>Soort</span>
        <app-segmented [variant]="variant()" label="Soort" [options]="directionOptions" [value]="location.dir" (changed)="state.go({ dir: $any($event) })" /></div>
      <label class="fin-field"><span>Waarvoor</span>
        <select class="select" [value]="location.purpose" (change)="state.go({ purpose: $any($event.target).value })">
          <option value="">Alles</option>
          @for (option of purposes; track option.id) { <option [value]="option.id" [selected]="option.id === location.purpose">{{ option.label }}</option> }
        </select></label>
      <label class="fin-field"><span>Rekening</span>
        <select class="select" [value]="location.account" (change)="state.go({ account: $any($event.target).value })">
          <option value="">Alle rekeningen</option>
          <option [value]="noAccount" [selected]="location.account === noAccount">Geen rekening</option>
          @for (option of state.accountOptions(); track option.key) { <option [value]="option.key" [selected]="option.key === location.account">{{ option.label }}</option> }
        </select></label>
      <button [class]="state.desk() ? 'wk-link fin-reset' : 'fin-row-action'" type="button" (click)="state.go({ dir: '', purpose: '', account: '' })">Filters wissen</button>
    }
    </div>
  `,
})
export class FinanceFilterFields {
  readonly state = inject(FinanceState);
  readonly kind = input<'costs' | 'receipts'>('costs');
  readonly variant = computed(() => (this.state.desk() ? 'desk' : 'ios'));
  readonly channels = SALES_CHANNELS;
  readonly noAccount = NO_ACCOUNT;
  readonly categories = computed(() => categoryChoices(this.state.costs().map((cost) => cost.category)));
  readonly statusOptions: SegmentOption[] = [{ id: '', label: 'Alle' }, { id: 'open', label: 'Open' }, { id: 'paid', label: 'Betaald' }];
  readonly directionOptions: SegmentOption[] = [{ id: '', label: 'Alle' }, { id: 'in', label: 'Ontvangst' }, { id: 'out', label: 'Terugbetaling' }, { id: 'offset', label: 'Verrekend' }];
  readonly purposes: { id: FinancePurpose; label: string }[] = [
    { id: 'STANDARD', label: 'Klantbetaling' }, { id: 'PARTNER_ADVANCE', label: 'Partnervoorschot' }, { id: 'PARTNER_SETTLEMENT', label: 'Partnerafrekening' },
  ];

  /** Back to the list as it opens: this year, no search, no filters. */
  reset(): void {
    this.state.go({ period: 'year', from: '', to: '', q: '', cat: '', status: '', channel: '', docs: '', cost: null });
  }
}
