import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { ForecastMonth } from '../finance/cash-forecast';
import { dayMon, eurWhole } from '../finance/cash-format';
import { CashState } from './cash-state';
import { itemLink, lineLink, monthLines, monthTable, monthTableNote, monthTableNoteQuery, signedWhole, tableCell, underBuffer } from './cash-view';
import { cashMonthView } from './drill-cash';
import type { CashDrillContext } from './drill-cash';
import { AnDrillHost } from './drill-host';

/**
 * "Per maand" (spec §4.5): begin, what went and goes out and in per kind,
 * end and lowest, the past months from the bank, the future ones from the
 * forecast. A month opens the page's drill-down with the lines behind it
 * (design/analyses2 §B.8; it no longer renders a sheet of its own inside the
 * Kasprognose size container, D-K1). The desk shows the full table, the
 * phone a compact one.
 */
@Component({
  selector: 'app-cash-months',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    @if (table(); as t) {
      @if (!ios()) {
        <div class="cf-mtable" role="region" aria-label="Per maand" tabindex="0">
          <table>
            <thead>
              <tr class="cf-mtable__band"><th></th>
                @for (month of t.months; track month.key) { <th [class.is-past]="month.past">{{ month.past ? 'Gebeurd · bank' : 'Verwacht' }}</th> }
              </tr>
              <tr><th scope="col">Maand</th>
                @for (month of t.months; track month.key) {
                  <th scope="col" [class.is-past]="month.past"><button type="button" aria-haspopup="dialog" (click)="open(month)" [attr.aria-label]="'Regels van ' + month.label">{{ month.label }}</button></th>
                }
              </tr>
            </thead>
            <tbody>
              @for (row of t.rows; track row.id) {
                <tr [attr.data-row]="row.id">
                  <th scope="row">{{ row.label }}</th>
                  @for (value of row.values; track $index) {
                    <td [class.is-past]="t.months[$index].past" [class.is-low]="row.id === 'lowest' && low(value)"
                        [class.is-neg]="value !== null && value < 0 && row.id !== 'lowest'">{{ cell(value) }}</td>
                  }
                </tr>
              }
            </tbody>
          </table>
        </div>
        @if (note(); as text) { <a class="wk-link cf-mtable__note" routerLink="/costs" [queryParams]="unlinked()">{{ text }} ›</a> }
      } @else {
        <div class="ios-group cf-mlist" role="table" aria-label="Per maand">
          <div class="cf-mlist__head" role="row"><span role="columnheader">Maand</span><span role="columnheader">Laagste</span><span role="columnheader">Einde</span><span role="columnheader">±</span></div>
          @for (month of t.months; track month.key) {
            <button class="cf-mlist__row" type="button" role="row" aria-haspopup="dialog" [class.is-past]="month.past" (click)="open(month)">
              <span role="cell">{{ month.label }}</span>
              <span role="cell" [class.is-low]="low(month.lowestEur)">{{ cell(month.lowestEur) }}</span>
              <span role="cell">{{ cell(month.endEur) }}</span>
              <span role="cell">{{ delta(month) }}</span>
            </button>
          }
        </div>
        @if (note(); as text) { <a class="ios-section__foot cf-mlist__note" routerLink="/costs" [queryParams]="unlinked()">{{ text }} ›</a> }
      }
    }
  `,
})
export class CashMonths {
  private readonly state = inject(CashState);
  private readonly drill = inject(AnDrillHost);
  readonly variant = input<'desk' | 'ios'>('desk');
  readonly ios = computed(() => this.variant() === 'ios');
  /** The note's link: the bank movements still to link, over the days and account the note counts. */
  readonly unlinked = computed(() => {
    const input = this.state.input();
    const forecast = this.state.forecast();
    return input && forecast ? monthTableNoteQuery(input, forecast) : { view: 'bank', tab: 'movements', link: 'unlinked' };
  });
  private readonly drillContext: CashDrillContext = { day: dayMon, whole: eurWhole, itemLink, lineLink, openPo: (orderId) => this.state.openPo(orderId) };

  readonly table = computed(() => {
    const forecast = this.state.forecast();
    return forecast ? monthTable(forecast) : null;
  });
  readonly note = computed(() => {
    const input = this.state.input();
    const forecast = this.state.forecast();
    return input && forecast ? monthTableNote(input, forecast) : '';
  });

  readonly cell = tableCell;

  /** Laagste under the buffer (amber); never in relative mode. */
  low(eur: number | null): boolean {
    const forecast = this.state.forecast();
    return !!forecast && underBuffer(forecast, eur);
  }

  delta(month: ForecastMonth): string {
    if (month.beginEur === null || month.endEur === null) return '—';
    return signedWhole(month.endEur - month.beginEur);
  }

  /** A month: the lines behind it in the page's drill-down (`cash.month.{key}`). */
  open(month: ForecastMonth): void {
    const input = this.state.input();
    const forecast = this.state.forecast();
    if (input && forecast) this.drill.open([cashMonthView(month, monthLines(input, forecast, month), this.drillContext)]);
  }
}
