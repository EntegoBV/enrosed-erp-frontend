import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Icon } from '../../shared/icon';
import { addDaysIso, isoWeek, weekdayMon0 } from './agenda-days';
import { AgendaRows, WEEKDAYS_SHORT, countdown, dayAria, dotTone } from './agenda-month';
import type { AgendaSheets } from './agenda-month';
import { HomeData } from './home-data';
import { shortDate } from './home-figures';

/** Rows of the rest of today the card shows; the others read "Nog n vandaag". */
const TODAY_ROWS = 4;

/**
 * <app-agenda-strip variant="phone">: the home's Agenda card (spec-home §2
 * row 4). The pin countdown, the 7 days from today with a dot per type,
 * the rest of today and the next three moments from tomorrow on. The whole
 * card opens the Agenda page; a day and the pin open it on that day, and a
 * row opens what it is (the planner's sheet on the page's `cards`, or its
 * link), as in Agenda › Dag - all of them sit above the stretched card
 * link, never inside it (P9). The card is its
 * own ios-card (a wk-card on the desk variant, kept for later).
 * No styles here: the rules live in styles/home-agenda.scss.
 */
@Component({
  selector: 'app-agenda-strip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, AgendaRows],
  template: `
    <section class="home-strip" [class.ios-card]="variant() === 'phone'" [class.wk-card]="variant() === 'desk'"
             [class.home-strip--desk]="variant() === 'desk'" aria-label="Agenda">
      <header class="home-strip__head">
        <h2 class="home-strip__title"><a class="home-strip__go" routerLink="/dashboard/agenda">Agenda</a></h2>
        <span class="home-strip__week" aria-hidden="true">week {{ week() }} ›</span>
      </header>

      @if (data.agenda().pin; as pin) {
        <a class="home-strip__pin home-strip__raise" routerLink="/dashboard/agenda" [queryParams]="{ dag: pin.date }"
           [attr.aria-label]="'Vastgepind: ' + pin.title + ', ' + pinDay(pin.date) + ', ' + countdown(pin.inDays) + (morePins() ? ', en ' + morePins() + ' meer vastgepind' : '')">
          <app-icon name="tag" [size]="14" />
          <span class="home-strip__pin-title" [attr.title]="pin.title">{{ pin.title }}</span>
          <span class="home-strip__pin-day">· {{ pinDay(pin.date) }}</span>
          <b class="home-strip__pin-in" [class.is-late]="pin.inDays < 0">{{ countdown(pin.inDays) }}</b>
          @if (morePins()) { <span class="home-strip__pin-more">+{{ morePins() }}</span> }
        </a>
      }

      @if (data.planner.error()) {
        <p class="home-strip__error home-strip__raise" role="status">Agenda niet bijgewerkt ·
          <button class="home-strip__retry" type="button" [disabled]="data.planner.loading()" (click)="data.planner.reload()">Opnieuw</button></p>
      }

      <ol class="home-strip__days" aria-label="De komende 7 dagen">
        @for (day of days(); track day.date) {
          <li>
            @if (loading()) {
              <span class="home-day is-skel" aria-hidden="true"><span class="home-day__wd">{{ day.weekday }}</span><span class="skel home-day__num"></span></span>
            } @else {
              <a class="home-day home-strip__raise" [class.is-today]="day.today" [class.is-weekend]="day.weekend"
                 routerLink="/dashboard/agenda" [queryParams]="{ dag: day.date }" [attr.aria-label]="day.aria">
                <span class="home-day__wd">{{ day.weekday }}</span>
                <span class="home-day__num">{{ day.number }}</span>
                <span class="home-day__dots" aria-hidden="true">
                  @for (type of day.markers.types; track type) { <i class="home-dot" [class]="'home-dot--' + type + ' ' + tone(type, day.markers)"></i> }
                  @if (day.markers.more) { <b>+</b> }
                </span>
              </a>
            }
          </li>
        }
      </ol>

      @if (!loading()) {
        <h3 class="home-strip__label">Vandaag</h3>
        @if (today().length) {
          <app-agenda-rows class="home-strip__raise" [variant]="variant()" [entries]="today()" [interactive]="true" [cards]="cards()" [flat]="true" />
          @if (todayMore()) { <p class="home-strip__more">Nog {{ todayMore() }} vandaag</p> }
        } @else {
          <p class="home-strip__empty">Vandaag niets meer gepland</p>
        }
        <h3 class="home-strip__label">Komend</h3>
        @if (komend().length) {
          <app-agenda-rows class="home-strip__raise" [variant]="variant()" [entries]="komend()" [dated]="true" [month]="data.today().slice(0, 7)"
                           [interactive]="true" [cards]="cards()" [flat]="true" />
        } @else {
          <p class="home-strip__empty">Niets gepland de komende 30 dagen</p>
        }
      }
    </section>
  `,
})
export class AgendaStrip {
  readonly data = inject(HomeData);
  /** 'phone' is the home card; 'desk' renders the same in a wk-card (the desk draws its own 7 columns today). */
  readonly variant = input<'phone' | 'desk'>('phone');
  /** The page's planner sheets (its app-planner-cards): an appointment or task row opens there. */
  readonly cards = input<AgendaSheets | null>(null);
  readonly countdown = countdown;

  readonly loading = computed(() => !this.data.planner.loaded() && !this.data.planner.error());
  readonly week = computed(() => isoWeek(this.data.today()));
  readonly morePins = computed(() => Math.max(0, this.data.agenda().pinCount - 1));

  readonly days = computed(() => {
    const today = this.data.today();
    const agenda = this.data.agenda();
    return Array.from({ length: 7 }, (_, index) => {
      const date = addDaysIso(today, index);
      const weekday = weekdayMon0(date);
      return { date, today: index === 0, weekend: weekday >= 5, weekday: WEEKDAYS_SHORT[weekday], number: Number(date.slice(8, 10)),
        markers: agenda.markers(date), aria: dayAria(date, agenda.byDay.get(date) ?? [], today, agenda.krapDays.has(date)) };
    });
  });

  private readonly rest = computed(() => this.data.agenda().restOfToday);
  readonly today = computed(() => this.rest().slice(0, TODAY_ROWS));
  readonly todayMore = computed(() => Math.max(0, this.rest().length - TODAY_ROWS));
  readonly komend = computed(() => {
    const today = this.data.today();
    return this.data.agenda().komend(addDaysIso(today, 1), 3, addDaysIso(today, 30));
  });

  tone = dotTone;

  pinDay(date: string): string {
    return shortDate(date);
  }
}
