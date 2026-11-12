import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { StaffPartnerReport } from '../../core/api/partner-sales-api';
import { count, euro } from '../partner/partner-format';
import { buyerLine, productsShort, reportPieces } from '../partner/partner-report-format';
import { CHANNEL_CHOICES, ChannelChoice, PERIOD_CHOICES, PeriodKind, byDay, soldDay } from './partner-sales-filters';
import { reportTitle } from './partner-sales-format';

/**
 * Factureren, step 1 "Kies de meldingen": the partner's confirmed meldingen
 * that are still open, by sold-on day, each with a tick. Soort and Periode
 * narrow the list (only what is shown and ticked counts), a day's tick takes
 * that whole day, "Alleen deze dag" takes only it, Alles / Niets the shown
 * list. The host keeps the ticks (`selected`) and previews them.
 */
@Component({
  selector: 'app-partner-sales-invoice-pick',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ip-bar">
      <div class="wk-chips" role="group" aria-label="Soort">
        @for (option of channels; track option.id) {
          <button class="wk-chip" type="button" [attr.aria-pressed]="channel() === option.id" (click)="channelChange.emit(option.id)">{{ option.label }}</button>
        }
      </div>
      <div class="wk-chips" role="group" aria-label="Periode">
        @for (option of periods; track option.id) {
          <button class="wk-chip" type="button" [attr.aria-pressed]="period() === option.id" (click)="periodChange.emit(option.id)">{{ option.label }}</button>
        }
      </div>
      <span class="ip-bar__end">
        <button class="wk-link" type="button" [disabled]="!shown().length" (click)="all()">Alles</button>
        <button class="wk-link" type="button" [disabled]="!chosenCount()" (click)="none()">Niets</button>
      </span>
    </div>

    @if (!total()) {
      <p class="ip-none">{{ emptyText() }}</p>
    } @else if (!shown().length) {
      <p class="ip-none">Geen bevestigde meldingen in deze keuze.</p>
    } @else {
      <div class="ip-list" role="table" aria-label="Meldingen om te factureren">
        @for (day of days(); track day.day) {
          @let state = dayState(day.reports);
          <div class="ip-day" role="row">
            <label class="ip-day__label" role="rowheader">
              <input class="ip-check" type="checkbox" [checked]="state === 'all'" [indeterminate]="state === 'some'"
                     [attr.aria-label]="'Hele dag ' + dayText(day.day)" (change)="toggleDay(day.reports)" />
              <b>{{ dayText(day.day) }}</b><span class="ip-muted">· {{ day.reports.length === 1 ? '1 melding' : day.reports.length + ' meldingen' }} · {{ eur(dayNet(day.reports)) }}</span>
            </label>
            @if (days().length > 1) { <button class="wk-link ip-only" type="button" (click)="onlyDay(day.reports)">Alleen deze dag</button> }
          </div>
          @for (r of day.reports; track r.id) {
            @let pieces = piecesOf(r);
            <label class="ip-row" role="row" [class.is-on]="selected().has(r.id)">
              <span role="cell"><input class="ip-check" type="checkbox" [checked]="selected().has(r.id)" [attr.aria-label]="r.number + ' factureren'" (change)="toggle(r.id)" /></span>
              <span class="ip-what" role="cell"><b>{{ title(r) }}</b>@if (buyer(r); as b) { <span class="ip-muted">{{ b }}</span> }</span>
              <span class="ip-products" role="cell">{{ products(r) }}</span>
              <span class="ip-num" role="cell">{{ pieces.sale ? num(pieces.sale) + ' st' : '' }}@if (pieces.buyback) { <small> −{{ num(pieces.buyback) }} terug</small> }</span>
              <span class="ip-num ip-strong" role="cell">{{ eur(r.totals.netEur) }}</span>
            </label>
          }
        }
      </div>
    }
  `,
  styles: `
    :host{display:grid;gap:10px;min-width:0}
    .ip-bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px}
    .ip-bar__end{display:flex;gap:12px;margin-left:auto}
    .ip-bar__end .wk-link:disabled{color:var(--muted-2);cursor:default;text-decoration:none}
    .ip-none{margin:0;padding:18px 4px;color:var(--muted);font-size:13.5px}
    .ip-list{display:grid;border:1px solid var(--line);border-radius:12px;background:var(--surface);overflow:hidden}
    .ip-day{display:flex;align-items:center;gap:10px;min-height:36px;padding:0 12px;border-top:1px solid var(--line);background:var(--surface-2);font-size:12.5px}
    .ip-day:first-child{border-top:0}
    .ip-day__label{display:flex;flex:1;align-items:center;gap:8px;min-width:0;cursor:pointer}
    .ip-day__label b{color:var(--ink);font-weight:700;white-space:nowrap}
    .ip-only{flex:none;font-size:12px}
    .ip-row{display:grid;grid-template-columns:20px minmax(120px,170px) minmax(0,1fr) 96px 92px;align-items:center;gap:10px;min-height:42px;padding:4px 12px;border-top:1px solid var(--line);font-size:13px;cursor:pointer}
    .ip-row.is-on{background:color-mix(in srgb,var(--rose-soft) 55%,var(--surface))}
    .ip-what{display:grid;min-width:0}
    .ip-what b{overflow:hidden;font-weight:650;text-overflow:ellipsis;white-space:nowrap}
    .ip-products{min-width:0;overflow:hidden;color:var(--ink-2);text-overflow:ellipsis;white-space:nowrap}
    .ip-muted{overflow:hidden;color:var(--muted);font-size:12px;font-weight:500;text-overflow:ellipsis;white-space:nowrap}
    .ip-num{font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
    .ip-num small{display:block;color:var(--muted);font-size:11.5px}
    .ip-strong{font-weight:700}
    .ip-check{width:16px;height:16px;margin:0;accent-color:var(--rose);cursor:pointer}
    @media (max-width: 679.98px), (hover: none) and (max-width: 1023.98px){
      .ip-row{grid-template-columns:28px minmax(0,1fr) auto;min-height:56px;font-size:14px}
      .ip-products{display:none}
      .ip-row .ip-num:not(.ip-strong){display:none}
      .ip-check{width:22px;height:22px}
      .ip-day{min-height:44px;font-size:13.5px}
      .ip-bar{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;margin-inline:calc(-1 * var(--ios-inset,16px));padding-inline:var(--ios-inset,16px)}
      .ip-bar .wk-chips{flex-wrap:nowrap}
      .ip-bar .wk-chip{flex:none;height:36px;padding:0 14px;font-size:13.5px}
      .ip-bar__end{flex:none;margin-left:8px}
      .ip-bar__end .wk-link{min-height:36px;font-size:13.5px}
    }
  `,
})
export class PartnerSalesInvoicePick {
  /** The confirmed, open meldingen of the chosen partner that Soort and Periode leave shown (only these count). */
  readonly shown = input.required<readonly StaffPartnerReport[]>();
  /** How many there are before Soort and Periode. */
  readonly total = input.required<number>();
  readonly selected = input.required<ReadonlySet<number>>();
  readonly today = input.required<string>();
  readonly channel = input<ChannelChoice>('alle');
  readonly period = input<Exclude<PeriodKind, 'van-tot'>>('alles');
  readonly emptyText = input('Geen bevestigde meldingen om te factureren.');
  readonly selectedChange = output<ReadonlySet<number>>();
  readonly channelChange = output<ChannelChoice>();
  readonly periodChange = output<Exclude<PeriodKind, 'van-tot'>>();

  readonly channels = CHANNEL_CHOICES;
  readonly periods = PERIOD_CHOICES;

  readonly days = computed(() => byDay(this.shown()));
  readonly chosenCount = computed(() => this.shown().filter((r) => this.selected().has(r.id)).length);

  dayState(reports: readonly StaffPartnerReport[]): 'all' | 'some' | 'none' {
    const on = reports.filter((r) => this.selected().has(r.id)).length;
    return on === 0 ? 'none' : on === reports.length ? 'all' : 'some';
  }

  toggle(id: number): void {
    const next = new Set(this.selected());
    if (next.has(id)) next.delete(id); else next.add(id);
    this.selectedChange.emit(next);
  }

  toggleDay(reports: readonly StaffPartnerReport[]): void {
    const next = new Set(this.selected());
    const all = this.dayState(reports) === 'all';
    for (const r of reports) { if (all) next.delete(r.id); else next.add(r.id); }
    this.selectedChange.emit(next);
  }

  /** "Alleen deze dag": exactly that day's shown meldingen. */
  onlyDay(reports: readonly StaffPartnerReport[]): void {
    this.selectedChange.emit(new Set(reports.map((r) => r.id)));
  }

  all(): void {
    const next = new Set(this.selected());
    for (const r of this.shown()) next.add(r.id);
    this.selectedChange.emit(next);
  }

  none(): void {
    const next = new Set(this.selected());
    for (const r of this.shown()) next.delete(r.id);
    this.selectedChange.emit(next);
  }

  dayNet(reports: readonly StaffPartnerReport[]): number {
    return reports.reduce((sum, r) => sum + Math.round((r.totals.netEur || 0) * 100), 0) / 100;
  }

  title(r: StaffPartnerReport): string { return reportTitle(r); }
  buyer(r: StaffPartnerReport): string { return buyerLine(r); }
  products(r: StaffPartnerReport): string { return productsShort(r); }
  piecesOf(r: StaffPartnerReport): { sale: number; buyback: number } { return reportPieces(r); }
  dayText(day: string): string { return soldDay(day, this.today()); }
  eur(value: number): string { return euro(value); }
  num(value: number): string { return count(value); }
}
