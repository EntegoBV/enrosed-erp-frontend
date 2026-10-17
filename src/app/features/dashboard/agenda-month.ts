import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy, Component, ElementRef, Injectable, Injector, afterNextRender, computed, inject, input, model, viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { messageOf } from '../../core/api/errors';
import { PlannerApi, PlannerStore } from '../../core/api/planner-api';
import type { PlannerItem } from '../../core/api/planner-api';
import { Icon } from '../../shared/icon';
import { Ui } from '../../shared/ui';
import { addDaysIso, isoWeek, monthCells, shiftMonthIso, weekdayMon0 } from './agenda-days';
import { PIN_MIN_EUR } from './agenda-entries';
import type { AgendaEntry, AgendaType, DayMarkers } from './agenda-entries';
import { HomeData } from './home-data';
import { agendaDay, longDate } from './home-figures';
import { PlannerCards } from './planner-cards';
import { amount } from './widgets/home-w';

/*
 * The agenda's month grid and its day rows (spec-home §5.2), shared by the
 * desk's Maand segment, the phone Agenda page and the home's 7-day strip.
 * Everything reads HomeData.agenda (agenda-entries.ts): one entry per
 * appointment, task, container moment and money moment, with the markers
 * per day. No styles here: the rules live in styles/home-agenda.scss.
 */

export const WEEKDAYS_SHORT = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'] as const;
const MONTHS_LONG = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];

/** The view and edit sheets of the planner, hosted once per page (an app-planner-cards). */
export type AgendaSheets = Pick<PlannerCards, 'openView' | 'openEdit'>;

/** "oktober" of a day or month. */
export function monthName(iso: string): string {
  return MONTHS_LONG[Number(iso.slice(5, 7)) - 1] ?? '';
}

/** "+ € 2.180" in, "− € 21.350" out; amounts never break across lines. */
export function signedAmount(eur: number): string {
  return Math.round(eur) > 0 ? `+ ${amount(eur)}` : amount(eur);
}

/** The pin countdown: "vandaag", "morgen", "over 9 d", or "2 d te laat" for an open pinned task from before today. */
export function countdown(inDays: number): string {
  if (inDays === 0) return 'vandaag';
  if (inDays === 1) return 'morgen';
  return inDays > 1 ? `over ${inDays} d` : `${-inDays} d te laat`;
}

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

/** What a day holds, for the label of its button: "donderdag 15 oktober, vandaag, 2 afspraken, 1 taak, geld − € 21.350". */
export function dayAria(date: string, entries: readonly AgendaEntry[], today: string, krap: boolean): string {
  const parts = [longDate(date)];
  if (date === today) parts.push('vandaag');
  const events = entries.filter((entry) => entry.type === 'afspraak').length;
  const tasks = entries.filter((entry) => entry.type === 'taak' && !entry.done).length;
  const containers = entries.filter((entry) => entry.type === 'container' && !entry.past).length;
  const money = entries.filter((entry) => entry.type === 'geld' && entry.eur !== null);
  if (events) parts.push(plural(events, 'afspraak', 'afspraken'));
  if (tasks) parts.push(plural(tasks, 'taak', 'taken'));
  if (containers) parts.push(plural(containers, 'container', 'containers'));
  if (money.length) parts.push(`geld ${signedAmount(money.reduce((sum, entry) => sum + (entry.eur ?? 0), 0))}`);
  if (entries.some((entry) => entry.deadline)) parts.push('btw uiterste dag');
  if (krap) parts.push('krap op de bank');
  return parts.join(', ');
}

/** The marker colours: an appointment is the accent, a task a ring (red when late), a container blue, money amber. */
export function dotTone(type: AgendaType, markers: Pick<DayMarkers, 'lateTask'>): string {
  switch (type) {
    case 'afspraak': return 'tone-accent';
    case 'taak': return markers.lateTask ? 'tone-danger' : 'tone-grey';
    case 'container': return 'tone-blue';
    default: return 'tone-amber';
  }
}

const TYPE_LABEL: Record<AgendaType, string> = { afspraak: 'Afspraak', taak: 'Taak', container: 'Container', geld: 'Geld' };

/** Opening and ticking agenda entries, the same way on every agenda surface. */
@Injectable({ providedIn: 'root' })
export class AgendaActions {
  private readonly router = inject(Router);
  private readonly api = inject(PlannerApi);
  private readonly store = inject(PlannerStore);
  private readonly ui = inject(Ui);

  private itemOf(entry: AgendaEntry): PlannerItem | null {
    return entry.plannerId === null ? null : this.store.items().find((item) => item.id === entry.plannerId) ?? null;
  }

  /** Whether a row leads somewhere: a planner item with its sheets at hand, or a link. */
  opens(entry: AgendaEntry, sheets: AgendaSheets | null): boolean {
    return entry.plannerId !== null ? !!sheets : !!entry.link || entry.orderId !== null;
  }

  /** An appointment opens its view sheet, a task its edit sheet, a container its order, money its own link. */
  open(entry: AgendaEntry, sheets: AgendaSheets | null): void {
    if (entry.plannerId !== null) {
      const item = this.itemOf(entry);
      if (!item || !sheets) return;
      if (item.kind === 'EVENT') sheets.openView(item);
      else sheets.openEdit(item);
      return;
    }
    const link = entry.link ?? (entry.orderId !== null ? { path: ['/purchasing', entry.orderId] } : null);
    if (link) void this.router.navigate(link.path, link.query ? { queryParams: link.query } : {});
  }

  /** Ticks a task on or off (the planner's own toggle). */
  async toggle(entry: AgendaEntry): Promise<void> {
    const item = this.itemOf(entry);
    if (!item) return;
    try {
      await this.api.update({ ...item, done: !item.done });
      await this.store.reload(true);
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Aanpassen mislukt'), 'err');
    }
  }
}

/**
 * Agenda rows: the time (or "dag", or the day on a dated list - with its
 * month under it when it lies outside the month the list sits beside), a type bar,
 * the title with its sub and the signed amount. A task carries a tick;
 * past appointments are muted, container history is grey, done tasks are
 * struck through. Phone rows sit in an ios-group, desk rows in a plain list.
 */
@Component({
  selector: 'app-agenda-rows',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, NgTemplateOutlet],
  template: `
    <div class="home-arows" [class.ios-group]="variant() === 'phone' && !flat()" [class.home-arows--phone]="variant() === 'phone'"
         [class.home-arows--desk]="variant() === 'desk'" [class.home-arows--flat]="flat()" role="list">
      @for (entry of entries(); track entry.key) {
        <div class="home-arow" [class]="toneOf(entry)" [class.is-past]="entry.past" [class.is-done]="entry.done"
             [class.is-late]="entry.late" [class.is-task]="entry.type === 'taak'" [class.has-check]="hasCheck(entry)"
             [class.no-when]="!showWhen(entry)" role="listitem">
          @if (hasCheck(entry)) {
            <button class="home-arow__check" type="button" role="checkbox" [attr.aria-checked]="entry.done"
                    [attr.aria-label]="(entry.done ? 'Terugzetten: ' : 'Afvinken: ') + entry.title" (click)="actions.toggle(entry)">
              <span class="ios-check" [class.is-on]="entry.done"><app-icon name="tick" [size]="14" /></span>
            </button>
          }
          @if (interactive() && actions.opens(entry, cards())) {
            <button class="home-arow__main" type="button" [attr.aria-label]="ariaOf(entry)" (click)="actions.open(entry, cards())">
              <ng-container [ngTemplateOutlet]="body" [ngTemplateOutletContext]="{ $implicit: entry }" />
            </button>
          } @else {
            <div class="home-arow__main">
              <span class="sr-only">{{ ariaOf(entry) }}</span>
              <ng-container [ngTemplateOutlet]="body" [ngTemplateOutletContext]="{ $implicit: entry }" />
            </div>
          }
        </div>
      }
    </div>

    <ng-template #body let-entry>
      @if (showWhen(entry)) {
        <span class="home-arow__when" aria-hidden="true">
          <b>{{ whenOf(entry) }}</b>
          @if (monthOf(entry); as month) { <small class="home-arow__month">{{ month }}</small> }
          @if (dated() && entry.atTime) { <small>{{ entry.atTime.slice(0, 5) }}</small> }
        </span>
      }
      <i class="home-arow__bar" aria-hidden="true"></i>
      <span class="home-arow__text" aria-hidden="true">
        <span class="home-arow__title" [attr.title]="entry.title">{{ entry.title }}</span>
        @if (subOf(entry); as sub) { <span class="home-arow__sub" [attr.title]="sub">{{ sub }}</span> }
      </span>
      @if (entry.eur !== null) {
        <span class="home-arow__eur" aria-hidden="true">{{ signed(entry.eur) }}</span>
      }
    </ng-template>
  `,
})
export class AgendaRows {
  readonly actions = inject(AgendaActions);
  readonly variant = input<'desk' | 'phone'>('phone');
  readonly entries = input.required<readonly AgendaEntry[]>();
  /** The rows of several days: the day leads, with the time under it. */
  readonly dated = input(false);
  /** On a dated list, the month it sits beside ('YYYY-MM'): a day outside it shows its month under it ("di 1" over "dec"). */
  readonly month = input<string | null>(null);
  readonly cards = input<AgendaSheets | null>(null);
  /** False inside a card that is one link itself (the home strip): the rows are text then. */
  readonly interactive = input(true);
  /** Rows inside a card of their own (the home strip): no inset group, hairlines between rows. */
  readonly flat = input(false);
  /**
   * False where a task's tick would push its day out of the date column (the home strip's Komend, a dated list):
   * every row keeps one lead column, the day; the row still opens the task, whose sheet ticks it.
   */
  readonly ticks = input(true);
  readonly signed = signedAmount;

  /** A planner task carries its tick on an interactive list (unless `ticks` is off). */
  hasCheck(entry: AgendaEntry): boolean {
    return this.interactive() && this.ticks() && entry.type === 'taak' && entry.plannerId !== null;
  }

  /** A task with its tick on a one-day list has no time to show: the tick takes the time's place. */
  showWhen(entry: AgendaEntry): boolean {
    return this.dated() || !this.hasCheck(entry);
  }

  /** On a dated list the day; on one day an appointment's time or "dag", nothing for the rest (no repeated "dag", P2). */
  whenOf(entry: AgendaEntry): string {
    if (this.dated()) return agendaDay(entry.date, null).day;
    if (entry.type !== 'afspraak') return '';
    return entry.atTime ? entry.atTime.slice(0, 5) : 'dag';
  }

  /** On a dated list, the month under the day when it lies outside the month the list sits beside. */
  monthOf(entry: AgendaEntry): string | null {
    return this.dated() ? agendaDay(entry.date, this.month()).month : null;
  }

  subOf(entry: AgendaEntry): string | null {
    if (entry.type !== 'taak') return [entry.term, entry.sub].filter(Boolean).join(' · ') || null;
    const late = entry.late && !this.dated() ? 'te laat' : null;
    return ['Taak', late, entry.sub].filter(Boolean).join(' · ');
  }

  toneOf(entry: AgendaEntry): string {
    if (entry.type === 'afspraak') return 'tone-accent';
    if (entry.type === 'taak') return entry.late ? 'tone-danger' : 'tone-grey';
    if (entry.type === 'container') return entry.past ? 'tone-grey' : 'tone-blue';
    return entry.deadline ? 'tone-danger' : 'tone-amber';
  }

  ariaOf(entry: AgendaEntry): string {
    const when = this.dated() ? `${longDate(entry.date)}${entry.atTime ? ` ${entry.atTime.slice(0, 5)}` : ''}`
      : entry.atTime ? entry.atTime.slice(0, 5) : entry.type === 'afspraak' ? 'hele dag' : null;
    return [`${TYPE_LABEL[entry.type]}: ${entry.title}`, when, this.subOf(entry), entry.eur !== null ? signedAmount(entry.eur) : null,
      entry.done ? 'afgevinkt' : null, entry.past && entry.type !== 'geld' ? 'voorbij' : null].filter(Boolean).join(', ');
  }
}

interface MonthCell { key: string; date: string; label: number; inMonth: boolean; today: boolean; krap: boolean; markers: DayMarkers; aria: string; }

/**
 * <app-agenda-month variant="desk|phone" [(selected)]>: the month of the
 * selected day as a Monday-first grid. A cell shows its number and up to
 * three dots (appointment, task ring, container, money from € 5.000; "+"
 * for more); today is filled, the selected day ringed, days outside the
 * month muted, krap days underlined in amber. The arrow keys move the day
 * (Page Up/Down a month), so the grid is one tab stop.
 *
 * Desk: the ISO week numbers, and beside the grid the selected day's list
 * with Komend under it; a planner entry opens in `cards` (the page's own
 * app-planner-cards), else in a sheet host of its own. Phone: the grid
 * only; the Agenda page renders the lists.
 */
@Component({
  selector: 'app-agenda-month',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AgendaRows, PlannerCards],
  template: `
    <div class="home-month" [class.home-month--desk]="desk()" [class.home-month--phone]="!desk()">
      <div class="home-month__cal">
        @if (desk()) { <h3 class="home-month__name">{{ monthLabel() }}</h3> }
        <div class="home-month__grid" role="group" [attr.aria-label]="monthLabel()" [attr.aria-busy]="loading() || null" (keydown)="onKey($event)">
          <div class="home-month__row home-month__row--head" aria-hidden="true">
            @if (desk()) { <span class="home-month__wk">wk</span> }
            @for (name of weekdays; track name) { <span class="home-month__wd">{{ name }}</span> }
          </div>
          @for (week of weeks(); track week.key) {
            <div class="home-month__row">
              @if (desk()) { <span class="home-month__wk" aria-hidden="true">{{ week.number }}</span> }
              @for (cell of week.cells; track cell.key) {
                @if (loading()) {
                  <span class="home-day is-skel" aria-hidden="true"><span class="skel home-day__num"></span></span>
                } @else {
                  <button class="home-day" type="button" [class.is-out]="!cell.inMonth" [class.is-today]="cell.today"
                          [class.is-selected]="cell.date === day()" [class.is-krap]="cell.krap"
                          [attr.aria-pressed]="cell.date === day()" [attr.aria-current]="cell.today ? 'date' : null"
                          [attr.aria-label]="cell.aria" [attr.tabindex]="cell.date === day() ? 0 : -1" (click)="pick(cell.date)">
                    <span class="home-day__num">{{ cell.label }}</span>
                    <span class="home-day__dots" aria-hidden="true">
                      @for (type of cell.markers.types; track type) { <i class="home-dot" [class]="'home-dot--' + type + ' ' + tone(type, cell.markers)"></i> }
                      @if (cell.markers.more) { <b>+</b> }
                    </span>
                  </button>
                }
              }
            </div>
          }
        </div>
        <p class="home-month__legend">
          <span><i class="home-dot tone-accent"></i>Afspraak</span>
          <span><i class="home-dot home-dot--taak tone-grey"></i>Taak</span>
          <span><i class="home-dot tone-blue"></i>Container</span>
          <span><i class="home-dot tone-amber"></i>Geld (vanaf {{ pinMin }})</span>
          @if (krapInView()) { <span><i class="home-month__krap-key"></i>Krap op de bank</span> }
          @if (moneySource() === 'facturen') { <span class="home-month__note">· Geld: alleen factuurdata (Kasprognose niet geladen)</span> }
        </p>
      </div>
      @if (desk()) {
        <div class="home-month__side">
          <div class="home-month__day-head">
            <h3>{{ dayLabel() }}</h3>
            @if (day() === data.today()) { <span class="wk-pill tone-accent">Vandaag</span> }
            <span class="home-month__count">{{ dayEntries().length }}</span>
          </div>
          @if (dayEntries().length) {
            <app-agenda-rows variant="desk" [entries]="dayEntries()" [cards]="sheets()" />
          } @else {
            <p class="home-month__empty">{{ loading() ? 'Agenda laden…' : 'Niets gepland' }}</p>
          }
          <h4 class="home-month__label">Komend</h4>
          @if (komend().length) {
            <app-agenda-rows variant="desk" [entries]="komend()" [dated]="true" [month]="day().slice(0, 7)" [cards]="sheets()" />
          } @else {
            <p class="home-month__empty">Niets gepland de komende 30 dagen</p>
          }
        </div>
        @if (!cards()) { <app-planner-cards section="none" /> }
      }
    </div>
  `,
})
export class AgendaMonth {
  readonly data = inject(HomeData);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  readonly variant = input<'desk' | 'phone'>('desk');
  /** The selected day; null follows today. Two-way: a tap sets it and emits selectedChange. */
  readonly selected = model<string | null>(null);
  /** The page's planner sheets (its app-planner-cards); without them the desk month hosts its own. */
  readonly cards = input<AgendaSheets | null>(null);

  readonly weekdays = WEEKDAYS_SHORT;
  readonly pinMin = amount(PIN_MIN_EUR);
  readonly desk = computed(() => this.variant() === 'desk');
  readonly day = computed(() => this.selected() ?? this.data.today());
  /** The planner has never answered yet (a failed planner shows its grid with what is known). */
  readonly loading = computed(() => !this.data.planner.loaded() && !this.data.planner.error());

  private readonly own = viewChild(PlannerCards);
  readonly sheets = computed<AgendaSheets | null>(() => this.cards() ?? this.own() ?? null);

  readonly monthLabel = computed(() => `${monthName(this.day())} ${this.day().slice(0, 4)}`);
  readonly dayLabel = computed(() => {
    const text = longDate(this.day());
    return text.charAt(0).toUpperCase() + text.slice(1);
  });

  readonly weeks = computed(() => {
    const day = this.day();
    const today = this.data.today();
    const agenda = this.data.agenda();
    const cells: MonthCell[] = monthCells(Number(day.slice(0, 4)), Number(day.slice(5, 7)), this.desk() ? 6 : 'fit').map((cell) => {
      const krap = agenda.krapDays.has(cell.date);
      return { ...cell, today: cell.date === today, krap, markers: agenda.markers(cell.date),
        aria: dayAria(cell.date, agenda.byDay.get(cell.date) ?? [], today, krap) };
    });
    return Array.from({ length: cells.length / 7 }, (_, index) => {
      const week = cells.slice(index * 7, index * 7 + 7);
      return { key: week[0].key, number: isoWeek(week[0].date), cells: week };
    });
  });

  /**
   * Where the money moments come from: the forecast's BASE items once it is ready, else the open invoices
   * (the same rule as home-sources.ts agendaInputOf, which the agenda model does not hand back).
   */
  readonly moneySource = computed<'prognose' | 'facturen' | null>(() => {
    const state = this.data.cash().state;
    if (this.data.forecast() && (state === 'ready' || state === 'no-reading')) return 'prognose';
    return this.data.stateOf('verkoop') === 'ready' ? 'facturen' : null;
  });
  readonly krapInView = computed(() => this.weeks().some((week) => week.cells.some((cell) => cell.krap)));
  readonly dayEntries = computed(() => this.data.agenda().byDay.get(this.day()) ?? []);
  /** Komend under the day list: from the day after the selected one (or tomorrow), so it never repeats the list above. */
  readonly komend = computed(() => {
    const today = this.data.today();
    const from = addDaysIso(this.day() > today ? this.day() : today, 1);
    return this.data.agenda().komend(from, 5);
  });

  tone(type: AgendaType, markers: DayMarkers): string {
    return dotTone(type, markers);
  }

  pick(date: string): void {
    if (date !== this.day()) this.selected.set(date);
  }

  onKey(event: KeyboardEvent): void {
    const day = this.day();
    let next: string;
    switch (event.key) {
      case 'ArrowLeft': next = addDaysIso(day, -1); break;
      case 'ArrowRight': next = addDaysIso(day, 1); break;
      case 'ArrowUp': next = addDaysIso(day, -7); break;
      case 'ArrowDown': next = addDaysIso(day, 7); break;
      case 'Home': next = addDaysIso(day, -weekdayMon0(day)); break;
      case 'End': next = addDaysIso(day, 6 - weekdayMon0(day)); break;
      case 'PageUp': next = sameDayIn(shiftMonthIso(day, -1), day); break;
      case 'PageDown': next = sameDayIn(shiftMonthIso(day, 1), day); break;
      default: return;
    }
    event.preventDefault();
    this.pick(next);
    afterNextRender(() => {
      this.host.nativeElement.querySelector<HTMLElement>('.home-day[aria-pressed="true"]')?.focus();
    }, { injector: this.injector });
  }
}

/** The same day number in another month, clamped to its last day (31 Jan → 28 Feb). */
function sameDayIn(month: string, day: string): string {
  const last = Number(addDaysIso(`${shiftMonthIso(month, 1)}-01`, -1).slice(8, 10));
  return `${month}-${String(Math.min(Number(day.slice(8, 10)), last)).padStart(2, '0')}`;
}
