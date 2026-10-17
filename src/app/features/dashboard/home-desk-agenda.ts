import { ChangeDetectionStrategy, Component, computed, inject, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import type { PlannerItem } from '../../core/api/planner-api';
import { Icon } from '../../shared/icon';
import { Segmented } from '../../shared/segmented';
import type { SegmentOption } from '../../shared/segmented';
import { eurWhole, weekdayDayMonth } from '../finance/cash-format';
import { addDaysIso, daysInMonth, shiftMonthIso, weekdayMon0 } from './agenda-days';
import type { AgendaEntry } from './agenda-entries';
import { AgendaMonth } from './agenda-month';
import { HomeData } from './home-data';
import { PlannerCards } from './planner-cards';

/** The card's three views; the address keeps them as ?agenda=maand|taken (7 dagen is the default). */
export type DeskAgendaView = 'week' | 'maand' | 'taken';

const WEEKDAYS = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];
/** A day column shows this many chips (appointments and tasks first); "+n meer" opens the day in the month. */
const DAY_CHIPS = 6;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** '+ € 2.180', '− € 21.350' with no-break spaces: an amount never wraps inside a chip. */
function signed(value: number): string {
  return `${value > 0 ? '+ ' : ''}${eurWhole(value)}`.replace(/ /g, ' ');
}

/** "over 9 dagen", "morgen", "vandaag", "2 d te laat" (a pinned task can be late). */
function inDaysText(days: number): string {
  if (days === 0) return 'vandaag';
  if (days === 1) return 'morgen';
  return days > 1 ? `over ${days} dagen` : `${-days} d te laat`;
}

/**
 * The desk Agenda card (spec-home §3 D6): full width under row 1, with
 * three views - 7 dagen (day columns from today with at most six chips
 * each, the rest one tap away in the month; the pinned line and the
 * "Daarna" moments after the window), Maand (the month grid of
 * app-agenda-month with the selected day's list) and Taken (the planner's
 * own Taken card). The one app-planner-cards instance is always rendered:
 * it hosts the view and edit sheets for the whole desk page, which opens
 * them through `cards()`.
 *
 * The view and the selected day live in the address (?agenda=maand,
 * ?dag=YYYY-MM-DD), so the phone Agenda's desk redirect and a reload land
 * on the same place; switching replaces the entry and never scrolls.
 */
@Component({
  selector: 'app-home-desk-agenda',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, Segmented, PlannerCards, AgendaMonth],
  template: `
    @let model = data.agenda();
    <section class="wk-card home-ag" aria-labelledby="home-ag-title">
      <header class="home-ag__head">
        <h2 id="home-ag-title" class="home-desk__card-title">Agenda</h2>
        <app-segmented variant="desk" label="Agenda" semantics="tabs" controls="home-ag-panel"
                       [options]="views()" [value]="view()" (changed)="setView($event)" />
        @if (view() !== 'taken') {
          <span class="home-ag__nav">
            <button class="wk-btn wk-btn--sm wk-btn--icon" type="button" (click)="step(-1)"
                    [attr.aria-label]="view() === 'maand' ? 'Vorige maand' : 'Vorige 7 dagen'"><app-icon name="chevron-left" [size]="14" /></button>
            <button class="wk-btn wk-btn--sm" type="button" (click)="toToday()">Vandaag</button>
            <button class="wk-btn wk-btn--sm wk-btn--icon" type="button" (click)="step(1)"
                    [attr.aria-label]="view() === 'maand' ? 'Volgende maand' : 'Volgende 7 dagen'"><app-icon name="chevron-right" [size]="14" /></button>
          </span>
        }
        @if (view() === 'week') {
          <span class="home-ag__legend" aria-hidden="true">
            <span><i class="home-ag__key is-afspraak"></i>Afspraak</span><span><i class="home-ag__key is-container"></i>Container</span>
            <span><i class="home-ag__key is-geld"></i>Geld</span><span><i class="home-ag__key is-taak"></i>Taak</span>
          </span>
        }
        <button class="wk-btn wk-btn--sm home-ag__add" type="button" (click)="addEvent()"><app-icon name="plus" [size]="14" /> Afspraak</button>
      </header>

      @if (data.planner.error()) {
        <div class="wk-banner wk-banner--warn wk-banner--inset home-ag__banner" role="status">
          <app-icon name="alert" [size]="16" />
          <span class="wk-banner__text">Agenda niet bijgewerkt ·
            <button class="wk-link" type="button" [disabled]="data.refreshing()" (click)="data.load()">Opnieuw</button></span>
        </div>
      }

      <div id="home-ag-panel" role="tabpanel" [attr.aria-label]="viewLabel()">
        @if (view() !== 'taken' && model.pin; as pin) {
          <button class="home-ag__pin" type="button" [title]="pinText(pin)" (click)="openEntry(pin)">
            <app-icon name="tag" [size]="15" />
            <b>Vastgepind</b>
            <span class="home-ag__pin-text">{{ pinText(pin) }}</span>
            @if (model.pinCount > 1) { <span class="home-ag__pin-more">+{{ model.pinCount - 1 }} vastgepind</span> }
            <span class="home-ag__pin-when">{{ when(pin.inDays) }} ›</span>
          </button>
        }

        @switch (view()) {
          @case ('week') {
            <div class="home-ag__week" [style.--ag-cols]="columns()">
              @for (day of days(); track day.date) {
                <section class="home-ag__day" [class.is-today]="day.today" [class.is-weekend]="day.weekend"
                         [attr.aria-label]="day.label">
                  <h3 class="home-ag__dh"><b>{{ day.number }}</b> {{ day.weekday }}
                    @if (day.today) { <em>Vandaag</em> } @else if (day.tomorrow) { <em>Morgen</em> }</h3>
                  @if (day.entries.length) {
                    <ul class="home-ag__entries">
                      @for (entry of day.shown; track entry.key) {
                        <li>
                          <button class="home-ag__chip" type="button" [class]="'is-' + entry.type" [class.is-past]="entry.past"
                                  [class.is-done]="entry.done" [class.is-late]="entry.late" [title]="chipTitle(entry)"
                                  [attr.aria-label]="chipTitle(entry)" (click)="openEntry(entry)">
                            <b>{{ entry.title }}</b>
                            @let line = chipLine(entry);
                            @if (line.amount || line.text) {
                              <small>@if (line.amount) {<span class="home-ag__amt">{{ line.amount }}</span>}@if (line.text) {<span>{{ line.amount ? '· ' : '' }}{{ line.text }}</span>}</small>
                            }
                          </button>
                        </li>
                      }
                      @if (day.more) {
                        <li><button class="home-ag__more" type="button" [title]="'Alles van ' + day.long + ' in de maand'" (click)="showDay(day.date)">
                          +{{ day.more }} meer</button></li>
                      }
                    </ul>
                  } @else if (!data.planner.loaded() && !data.planner.error()) {
                    <p class="home-ag__empty">Laden…</p>
                  } @else {
                    <p class="home-ag__empty">{{ day.weekend ? 'Vrij' : 'Niets gepland' }}</p>
                  }
                </section>
              }
            </div>
            @if (after().length) {
              <div class="home-ag__after">
                <b>Daarna</b>
                @for (entry of after(); track entry.key) {
                  <button type="button" [title]="'In de maand tonen: ' + afterText(entry)" (click)="showDay(entry.date)">
                    <i class="home-ag__key" [class]="'is-' + entry.type" aria-hidden="true"></i>{{ afterText(entry) }}</button>
                }
              </div>
            }
          }
          @case ('maand') {
            <div class="home-ag__month">
              <app-agenda-month variant="desk" [selected]="selected()" (selectedChange)="select($event)" [cards]="sheets" />
            </div>
          }
        }
        <!-- Always here: the Taken card on 'taken', and on every view the sheets the desk page opens (the month's too). -->
        <app-planner-cards #sheets [section]="view() === 'taken' ? 'tasks' : 'none'" />
      </div>
    </section>
  `,
})
export class HomeDeskAgenda {
  readonly data = inject(HomeData);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly params = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });

  /** The page's one planner host: its sheets serve the task rows, the "+ Nieuw" menu and this card. */
  readonly cards = viewChild.required(PlannerCards);

  readonly view = computed<DeskAgendaView>(() => {
    const value = this.params().get('agenda');
    return value === 'maand' || value === 'taken' ? value : 'week';
  });
  /** The day the month grid selects: ?dag=, else today. */
  readonly selected = computed(() => {
    const day = this.params().get('dag');
    return day && ISO_DAY.test(day) ? day : this.data.today();
  });
  /** The first of the seven columns; null follows today (and so the day at midnight). */
  private readonly start = signal<string | null>(null);

  readonly views = computed<SegmentOption[]>(() => [
    { id: 'week', label: '7 dagen' },
    { id: 'maand', label: 'Maand' },
    { id: 'taken', label: 'Taken', count: this.data.agenda().openTaskCount },
  ]);
  readonly viewLabel = computed(() => this.views().find((option) => option.id === this.view())?.label ?? 'Agenda');

  readonly windowStart = computed(() => this.start() ?? this.data.today());
  readonly days = computed(() => {
    const today = this.data.today();
    const tomorrow = addDaysIso(today, 1);
    const model = this.data.agenda();
    return Array.from({ length: 7 }, (_, index) => {
      const date = addDaysIso(this.windowStart(), index);
      const weekdayIndex = weekdayMon0(date);
      const entries = model.byDay.get(date) ?? [];
      const shown = entries.length > DAY_CHIPS ? entries.slice(0, DAY_CHIPS - 1) : entries;
      return {
        date, number: Number(date.slice(8, 10)), weekday: WEEKDAYS[weekdayIndex], weekend: weekdayIndex >= 5,
        today: date === today, tomorrow: date === tomorrow, entries, shown, more: entries.length - shown.length,
        long: weekdayDayMonth(date), label: `${weekdayDayMonth(date)}, ${entries.length ? `${entries.length} in de agenda` : 'niets gepland'}`,
      };
    });
  });
  /** Weekend columns are narrower (0.6fr); the page uses this from 1000 px, below it the days stack. */
  readonly columns = computed(() => this.days().map((day) => (day.weekend ? 'minmax(0, .6fr)' : 'minmax(0, 1fr)')).join(' '));
  /** "Daarna": up to five moments after the seven days (pins, deadlines, arrivals, big money, the krap start). */
  readonly after = computed(() => this.data.agenda().after(addDaysIso(this.windowStart(), 6), 5));

  readonly when = inDaysText;

  setView(id: string): void {
    const view = id as DeskAgendaView;
    this.setParams({ agenda: view === 'week' ? null : view, dag: view === 'maand' ? this.params().get('dag') : null });
  }

  /** ±7 days, or ±1 month on the same day number (the month's last day when it is shorter). */
  step(direction: 1 | -1): void {
    if (this.view() === 'maand') {
      const day = this.selected();
      const month = shiftMonthIso(day, direction);
      const last = daysInMonth(Number(month.slice(0, 4)), Number(month.slice(5, 7)));
      this.select(`${month}-${String(Math.min(Number(day.slice(8, 10)), last)).padStart(2, '0')}`);
    } else {
      this.start.set(addDaysIso(this.windowStart(), 7 * direction));
    }
  }

  toToday(): void {
    if (this.view() === 'maand') this.setParams({ dag: null });
    else this.start.set(null);
  }

  /** The month grid picked a day (null: today); the address keeps it (replaced, so Back leaves the home as before). */
  select(day: string | null): void {
    this.setParams({ dag: !day || day === this.data.today() ? null : day });
  }

  /** A "Daarna" moment: the month on that day. */
  showDay(day: string): void {
    this.setParams({ agenda: 'maand', dag: day });
  }

  addEvent(): void {
    this.cards().openNew('EVENT', this.view() === 'maand' ? this.selected() : this.data.today());
  }

  /** Appointment → its view sheet; task → its edit sheet; a container or money moment → its page. */
  openEntry(entry: AgendaEntry): void {
    if (entry.plannerId !== null) {
      const item = this.plannerItem(entry.plannerId);
      if (!item) return;
      if (item.kind === 'EVENT') this.cards().openView(item);
      else this.cards().openEdit(item);
      return;
    }
    if (entry.link) void this.router.navigate(entry.link.path, { queryParams: entry.link.query ?? {} });
  }

  /** "Beurs Side Arendonk · standopbouw — za 24 okt 08:00 · Bus huren, displays mee". */
  pinText(pin: AgendaEntry): string {
    const at = pin.atTime ? ` ${pin.atTime.slice(0, 5)}` : '';
    return `${pin.title} — ${weekdayDayMonth(pin.date)}${at}${pin.sub ? ` · ${pin.sub}` : ''}`;
  }

  /** The chip's second line: the signed amount (never cut) and the rest (time, note, supplier, "uiterste dag"). */
  chipLine(entry: AgendaEntry): { amount: string | null; text: string | null } {
    switch (entry.type) {
      case 'afspraak': return { amount: null, text: [entry.atTime ? entry.atTime.slice(0, 5) : 'dag', entry.sub].filter(Boolean).join(' · ') };
      case 'taak': return { amount: null, text: entry.sub ?? (entry.late ? 'taak · te laat' : entry.done ? 'taak · afgevinkt' : 'taak') };
      case 'container': return { amount: null, text: entry.sub };
      default: return { amount: entry.eur === null ? null : signed(entry.eur), text: [entry.term, entry.sub].filter(Boolean).join(' · ') || null };
    }
  }

  /** The full text of a chip (its title and aria-label: the chip may cut it at 1100 px). */
  chipTitle(entry: AgendaEntry): string {
    const line = this.chipLine(entry);
    return [entry.title, line.amount, line.text].filter(Boolean).join(' · ');
  }

  /** "za 24 okt · Beurs Side Arendonk", "zo 25 okt · Btw-aangifte Q3 uiterste dag · − € 3.918", "± 5 nov · PO-2026-044 verwachte aankomst". */
  afterText(entry: AgendaEntry): string {
    const day = `${entry.milestoneKind === 'EXPECTED_ARRIVAL' ? '± ' : ''}${weekdayDayMonth(entry.date)}`;
    const title = entry.deadline && entry.sub ? `${entry.title} ${entry.sub}` : entry.title;
    return [day, title, entry.term, entry.eur === null ? null : signed(entry.eur)].filter(Boolean).join(' · ');
  }

  private plannerItem(id: number): PlannerItem | null {
    return this.data.planner.items().find((item) => item.id === id) ?? null;
  }

  private setParams(params: Record<string, string | null>): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: params, queryParamsHandling: 'merge', replaceUrl: true, scroll: 'manual' });
  }
}

