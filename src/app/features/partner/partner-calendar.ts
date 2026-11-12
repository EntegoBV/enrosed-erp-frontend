import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, output } from '@angular/core';
import type { PartnerContainer } from '../../core/api/partner-portal-api';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { Icon } from '../../shared/icon';
import {
  CalendarCell, STATE_TONE, STATE_WORD, WEEKDAY_HEADS, arrivalLine, arrivalWords, calendarCells, cargoLine, monthOf,
  monthTitle, nextMonth, progressOf, stateOf, upcoming,
} from './partner-containers-model';

/** How many coming containers the list beside the month shows (desk, phone); the rest are in the table below. */
const LIST_MAX = 5;
const LIST_MAX_PHONE = 3;

interface ComingRow {
  id: number;
  name: string;
  own: boolean;
  word: string;
  tone: string;
  cargo: string;
  when: string;
  late: boolean;
  moved: string | null;
  progress: number | null;
}

/**
 * The calendar card on top of Containers: a Monday-first month with every
 * container on its arrival day (the expected day, or the receipt once in),
 * ‹ › and Vandaag; beside it "Komt eraan", the containers still coming, the
 * nearest first, each with its cargo, "± do 20 nov · over 8 dagen" and a thin
 * bar from leaving to arriving (amber when its day has passed). A chip or a
 * row picks the container (the page selects it in the table). On the phone
 * the month shows dots and a day with containers is one button.
 */
@Component({
  selector: 'app-partner-calendar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <div class="pk">
      <div class="pk-month">
        <div class="pk-head">
          <h2 class="pk-title" aria-live="polite">{{ title() }}</h2>
          <div class="pk-nav">
            <button class="wk-btn wk-btn--sm wk-btn--icon pk-nav__btn" type="button" aria-label="Vorige maand" (click)="shift(-1)"><app-icon name="chevron-left" [size]="16" /></button>
            <button class="wk-btn wk-btn--sm pk-nav__btn pk-nav__today" type="button" [disabled]="isThisMonth()" (click)="month.set(thisMonth())">Vandaag</button>
            <button class="wk-btn wk-btn--sm wk-btn--icon pk-nav__btn" type="button" aria-label="Volgende maand" (click)="shift(1)"><app-icon name="chevron-right" [size]="16" /></button>
          </div>
        </div>
        <div class="pk-grid" role="grid" [attr.aria-label]="'Aankomsten in ' + title()">
          <div class="pk-week pk-week--head" role="row">
            @for (head of heads; track head) { <span class="pk-wd" role="columnheader">{{ head }}</span> }
          </div>
          @for (week of weeks(); track week[0].key) {
            <div class="pk-week" role="row">
              @for (cell of week; track cell.key) {
                @if (desk.active() || !cell.chips.length) {
                  <div class="pk-day" role="gridcell" [class.is-out]="!cell.inMonth" [class.is-today]="cell.today" [class.is-past]="cell.past"
                       [class.is-weekend]="cell.weekend" [attr.aria-label]="dayLabel(cell)">
                    <span class="pk-num">{{ cell.label }}</span>
                    @for (chip of cell.chips.slice(0, 2); track chip.id) {
                      <button class="pk-chip {{ chip.tone }}" type="button" [class.is-on]="chip.id === selectedId()" [class.is-late]="chip.late"
                              [title]="chip.name + ' · ' + chip.word + (chip.own ? ' · samen met jou' : '')" (click)="picked.emit(chip.id)">
                        <i class="pk-chip__dot" aria-hidden="true"></i><span class="pk-chip__text pk-chip__full">{{ chip.name }}</span><span class="pk-chip__text pk-chip__short">{{ chip.short }}</span>
                      </button>
                    }
                    @if (cell.chips.length > 2) {
                      <button class="pk-more" type="button" [title]="restNames(cell)" (click)="picked.emit(cell.chips[2].id)">+{{ cell.chips.length - 2 }}</button>
                    }
                  </div>
                } @else {
                  <button class="pk-day pk-day--tap {{ cell.chips[0].late ? 'tone-amber' : cell.chips[0].tone }}" type="button" role="gridcell" [class.is-out]="!cell.inMonth" [class.is-today]="cell.today"
                          [class.is-past]="cell.past" [class.is-on]="hasSelected(cell)" [attr.aria-label]="dayLabel(cell)" (click)="picked.emit(cell.chips[0].id)">
                    <span class="pk-num">{{ cell.label }}</span>
                    <span class="pk-dots" aria-hidden="true">
                      @for (chip of cell.chips.slice(0, 3); track chip.id) { <i class="pk-dot {{ chip.late ? 'tone-amber' : chip.tone }}"></i> }
                    </span>
                  </button>
                }
              }
            </div>
          }
        </div>
      </div>

      <section class="pk-side" aria-labelledby="pk-coming">
        <h2 class="pk-side__title" id="pk-coming">Komt eraan @if (coming().length) { <span class="pk-side__count">{{ coming().length }}</span> }</h2>
        @for (row of shown(); track row.id) {
          <button class="pk-row" type="button" [class.is-on]="row.id === selectedId()" [attr.aria-current]="row.id === selectedId() ? 'true' : null" (click)="picked.emit(row.id)">
            <span class="pk-row__top">
              <b class="pk-row__name">{{ row.name }}</b>
              @if (row.own) { <span class="wk-pill tone-accent pk-row__own">Samen met jou</span> }
            </span>
            <span class="pk-row__cargo {{ row.tone }}"><i class="wk-dot" aria-hidden="true"></i>{{ row.word }} · {{ row.cargo }}</span>
            <span class="pk-row__when" [class.is-late]="row.late">{{ row.when }}</span>
            @if (row.progress !== null) {
              <span class="pk-bar {{ row.late ? 'tone-amber' : row.tone }}" role="presentation"><i [style.width.%]="row.progress"></i></span>
            }
            @if (row.moved) { <span class="pk-row__moved">{{ row.moved }}</span> }
          </button>
        } @empty {
          <p class="pk-none">Er komt nu geen container aan.</p>
        }
        @if (coming().length > shown().length) {
          <p class="pk-rest">+ {{ coming().length - shown().length }} later, in de tabel hieronder</p>
        }
      </section>
    </div>
  `,
  styles: `
    :host{display:block;container:pk / inline-size}
    .pk{display:grid;grid-template-columns:minmax(0,1fr);gap:0}
    .pk-month{min-width:0;padding:14px 16px 16px}
    .pk-head{display:flex;align-items:center;gap:10px;margin:0 0 10px}
    .pk-title{flex:1;min-width:0;margin:0;font-size:17px;font-weight:780;letter-spacing:-.015em}
    .pk-nav{display:flex;flex:none;gap:4px}
    .pk-grid{display:grid;border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--surface)}
    .pk-week{display:grid;grid-template-columns:repeat(7,minmax(0,1fr))}
    .pk-week+.pk-week{border-top:1px solid var(--line)}
    .pk-week--head{background:var(--surface-2)}
    .pk-wd{padding:6px 8px;color:var(--muted);font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}
    .pk-day{display:flex;flex-direction:column;gap:3px;min-width:0;min-height:64px;padding:5px 5px 6px;border:0;background:var(--surface);color:var(--ink);font:inherit;text-align:left}
    .pk-day+.pk-day{border-left:1px solid var(--line)}
    .pk-day.is-weekend{background:color-mix(in srgb,var(--surface-2) 60%,var(--surface))}
    .pk-day.is-out .pk-num{color:var(--muted-2)}
    .pk-day.is-past:not(.is-today) .pk-num{color:var(--muted)}
    .pk-num{display:inline-grid;place-items:center;align-self:flex-start;min-width:22px;height:22px;padding:0 4px;border-radius:999px;font-size:12px;font-weight:650;font-variant-numeric:tabular-nums}
    .pk-day.is-today .pk-num{background:var(--rose);color:#fff}
    .pk-chip{display:flex;align-items:center;gap:5px;min-width:0;height:20px;padding:0 6px;border:0;border-radius:6px;background:color-mix(in srgb,var(--tone) 13%,var(--surface));color:color-mix(in srgb,var(--tone) 82%,var(--ink));font:inherit;font-size:11px;font-weight:700;cursor:pointer}
    .pk-chip:hover{background:color-mix(in srgb,var(--tone) 22%,var(--surface))}
    .pk-chip.is-on{box-shadow:inset 0 0 0 1.5px var(--tone)}
    .pk-chip.is-late{background:color-mix(in srgb,#c7851d 15%,var(--surface));color:#8a5a10}
    .pk-chip:focus-visible,.pk-more:focus-visible,.pk-row:focus-visible,.pk-day--tap:focus-visible{outline:2px solid var(--rose-dark);outline-offset:-2px}
    .pk-chip__dot{flex:none;width:6px;height:6px;border-radius:50%;background:var(--tone)}
    .pk-chip.is-late .pk-chip__dot{background:#c7851d}
    .pk-chip__text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .pk-chip__full{display:none}
    .pk-more{align-self:flex-start;height:18px;padding:0 6px;border:0;border-radius:6px;background:var(--surface-2);color:var(--ink-2);font:inherit;font-size:11px;font-weight:700;cursor:pointer}
    .pk-side{min-width:0;padding:14px 16px 16px;border-top:1px solid var(--line)}
    .pk-side__title{display:flex;align-items:center;gap:8px;margin:0 0 8px;font-size:15px;font-weight:780}
    .pk-side__count{color:var(--muted);font-size:13px;font-weight:650}
    .pk-row{display:grid;gap:3px;width:100%;margin:0 0 6px;padding:9px 11px 10px;border:1px solid var(--line);border-radius:11px;background:var(--surface);color:var(--ink);font:inherit;text-align:left;cursor:pointer}
    .pk-row:hover{border-color:var(--line-strong);background:var(--surface-2)}
    .pk-row.is-on{border-color:var(--rose-line);background:var(--rose-soft)}
    .pk-row__top{display:flex;align-items:center;gap:8px;min-width:0}
    .pk-row__name{min-width:0;overflow:hidden;font-size:13.5px;font-weight:720;font-variant-numeric:tabular-nums;text-overflow:ellipsis;white-space:nowrap}
    .pk-row__own{flex:none}
    .pk-row__cargo{display:flex;align-items:center;gap:6px;min-width:0;overflow:hidden;color:var(--ink-2);font-size:12px;text-overflow:ellipsis;white-space:nowrap}
    .pk-row__when{font-size:12.5px;font-weight:650;font-variant-numeric:tabular-nums}
    .pk-row__when.is-late{color:#9a6212}
    .pk-row__moved{color:var(--muted);font-size:11.5px}
    .pk-bar{display:block;height:4px;margin-top:3px;border-radius:2px;background:color-mix(in srgb,var(--tone) 14%,var(--surface-2));overflow:hidden}
    .pk-bar>i{display:block;height:100%;border-radius:2px;background:var(--tone)}
    .pk-none{margin:0;padding:18px 8px;color:var(--muted);font-size:13.5px;text-align:center}
    .pk-rest{margin:2px 0 0;color:var(--muted);font-size:12.5px}
    @container pk (min-width: 820px){
      .pk{grid-template-columns:minmax(0,1fr) 320px}
      .pk-side{border-top:0;border-left:1px solid var(--line)}
    }
    @container pk (min-width: 1100px){
      .pk{grid-template-columns:minmax(0,1fr) 350px}
      .pk-day{min-height:70px}
      .pk-chip__full{display:block}
      .pk-chip__short{display:none}
    }
    @media (max-width: 679.98px), (hover: none) and (max-width: 1023.98px){
      .pk-month{padding:14px 12px 12px}
      .pk-title{font-size:18px;white-space:nowrap}
      .pk-nav__btn{height:44px;min-width:44px;border-radius:12px}
      .pk-nav__today{padding:0 10px;font-size:14px}
      .pk-wd{padding:6px 0;text-align:center}
      .pk-day{align-items:center;min-height:48px;padding:4px 0}
      /* A day with containers is tinted in the first one's tone and is one button (feedback: highlight, not a small glyph). */
      .pk-day--tap{background:color-mix(in srgb,var(--tone) 12%,var(--surface));cursor:pointer;-webkit-tap-highlight-color:transparent}
      .pk-day--tap:not(.is-today) .pk-num{color:color-mix(in srgb,var(--tone) 85%,var(--ink));font-weight:800}
      .pk-day--tap.is-on{box-shadow:inset 0 0 0 2px var(--tone)}
      .pk-num{align-self:center;min-width:26px;height:26px;font-size:14px}
      .pk-dots{display:flex;gap:3px}
      .pk-dot{width:6px;height:6px;border-radius:50%;background:var(--tone)}
      .pk-side{padding:14px 12px 12px}
      .pk-side__title{font-size:17px}
      .pk-row{min-height:44px;padding:11px 13px 12px;border-radius:14px}
      .pk-row__name{font-size:15.5px}
      .pk-row__cargo{font-size:13.5px}
      .pk-row__when{font-size:14px}
      .pk-row__moved{font-size:13px}
    }
  `,
})
export class PartnerCalendar {
  readonly containers = input.required<readonly PartnerContainer[]>();
  /** The server's today (yyyy-mm-dd). */
  readonly today = input.required<string>();
  readonly selectedId = input<number | null>(null);
  readonly picked = output<number>();

  readonly desk = inject(DesktopViewport);
  readonly heads = WEEKDAY_HEADS;

  readonly thisMonth = computed(() => monthOf(this.today()));
  /** The month shown; back on this month when the server's day moves to another one. */
  readonly month = linkedSignal(() => this.thisMonth());
  readonly isThisMonth = computed(() => this.month() === this.thisMonth());
  readonly title = computed(() => monthTitle(this.month()));

  readonly weeks = computed<CalendarCell[][]>(() => {
    const cells = calendarCells(this.month(), this.containers(), this.today());
    const weeks: CalendarCell[][] = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    return weeks;
  });

  readonly coming = computed<ComingRow[]>(() => {
    const today = this.today();
    return upcoming(this.containers(), today).map((container) => {
      const state = stateOf(container, today);
      const words = arrivalWords(container, today);
      return {
        id: container.id, name: container.name, own: container.own, word: STATE_WORD[state], tone: STATE_TONE[state],
        cargo: cargoLine(container), when: arrivalLine(container, today), late: words.late, moved: words.moved,
        progress: progressOf(container, today),
      };
    });
  });

  readonly shown = computed(() => this.coming().slice(0, this.desk.active() ? LIST_MAX : LIST_MAX_PHONE));

  shift(step: number): void {
    this.month.set(nextMonth(this.month(), step));
  }

  hasSelected(cell: CalendarCell): boolean {
    const id = this.selectedId();
    return id !== null && cell.chips.some((chip) => chip.id === id);
  }

  restNames(cell: CalendarCell): string {
    return cell.chips.slice(2).map((chip) => chip.name).join(', ');
  }

  dayLabel(cell: CalendarCell): string {
    const day = `${cell.label} ${monthTitle(cell.key.slice(0, 7)).split(' ')[0].toLowerCase()}`;
    if (!cell.chips.length) return day;
    return `${day}: ${cell.chips.map((chip) => `${chip.name} ${chip.word.toLowerCase()}`).join(', ')}`;
  }
}
