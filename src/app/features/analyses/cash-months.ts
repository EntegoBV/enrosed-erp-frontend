import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Sheet } from '../../shared/ui';
import type { ForecastMonth } from '../finance/cash-forecast';
import { weekdayDayMonth } from '../finance/cash-format';
import { CashState } from './cash-state';
import { itemLink, lineLink, monthLines, monthTable, monthTableNote, signedWhole, tableCell, underBuffer } from './cash-view';

/**
 * "Per maand" (spec §4.5): begin, what went and goes out and in per kind,
 * end and lowest, the past months from the bank, the future ones from the
 * forecast. A month opens a sheet with the lines behind it. The desk shows
 * the full table, the phone a compact one.
 */
@Component({
  selector: 'app-cash-months',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet],
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
                  <th scope="col" [class.is-past]="month.past"><button type="button" (click)="open(month)" [attr.aria-label]="'Regels van ' + month.label">{{ month.label }}</button></th>
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
        <p class="cf-mtable__note">{{ note() }}</p>
      } @else {
        <div class="ios-group cf-mlist" role="table" aria-label="Per maand">
          <div class="cf-mlist__head" role="row"><span role="columnheader">Maand</span><span role="columnheader">Laagste</span><span role="columnheader">Einde</span><span role="columnheader">±</span></div>
          @for (month of t.months; track month.key) {
            <button class="cf-mlist__row" type="button" role="row" [class.is-past]="month.past" (click)="open(month)">
              <span role="cell">{{ month.label }}</span>
              <span role="cell" [class.is-low]="low(month.lowestEur)">{{ cell(month.lowestEur) }}</span>
              <span role="cell">{{ cell(month.endEur) }}</span>
              <span role="cell">{{ delta(month) }}</span>
            </button>
          }
        </div>
        <p class="ios-section__foot">{{ note() }}</p>
      }
    }

    @if (opened(); as month) {
      <app-sheet [title]="(month.past ? 'Gebeurd · ' : 'Verwacht · ') + month.label" variant="ios" (closed)="opened.set(null)">
        <div body class="cf-lines">
          @for (line of lines(); track $index) {
            <button class="cf-line" type="button" (click)="follow(line)">
              <span class="cf-line__day">{{ day(line.day) }}</span>
              <span class="cf-line__body"><b>{{ line.title }}</b><small>{{ line.sub }}</small></span>
              <span class="cf-line__amt" [class.is-in]="line.amountEur > 0">{{ signed(line.amountEur) }}</span>
            </button>
          } @empty {
            <p class="cf-lines__empty">Geen regels in deze maand.</p>
          }
        </div>
      </app-sheet>
    }
  `,
})
export class CashMonths {
  private readonly state = inject(CashState);
  private readonly router = inject(Router);
  readonly variant = input<'desk' | 'ios'>('desk');
  readonly ios = computed(() => this.variant() === 'ios');

  readonly opened = signal<ForecastMonth | null>(null);
  readonly table = computed(() => {
    const forecast = this.state.forecast();
    return forecast ? monthTable(forecast) : null;
  });
  readonly note = computed(() => {
    const input = this.state.input();
    const forecast = this.state.forecast();
    return input && forecast ? monthTableNote(input, forecast) : '';
  });
  readonly lines = computed(() => {
    const month = this.opened();
    const input = this.state.input();
    const forecast = this.state.forecast();
    return month && input && forecast ? monthLines(input, forecast, month) : [];
  });

  readonly cell = tableCell;
  readonly signed = signedWhole;
  readonly day = weekdayDayMonth;

  /** Laagste under the buffer (amber); never in relative mode. */
  low(eur: number | null): boolean {
    const forecast = this.state.forecast();
    return !!forecast && underBuffer(forecast, eur);
  }

  delta(month: ForecastMonth): string {
    if (month.beginEur === null || month.endEur === null) return '—';
    return signedWhole(month.endEur - month.beginEur);
  }

  open(month: ForecastMonth): void {
    this.opened.set(month);
  }

  follow(line: ReturnType<typeof monthLines>[number]): void {
    const link = line.lineId !== null ? lineLink(line.lineId) : line.item ? itemLink(line.item) : null;
    if (!link) return;
    this.opened.set(null);
    if (link.po !== null) { this.state.openPo(link.po); return; }
    void this.router.navigate(link.path, link.query ? { queryParams: link.query } : {});
  }
}
