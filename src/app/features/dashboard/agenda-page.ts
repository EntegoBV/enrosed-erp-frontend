import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { ContextMenu } from '../../shared/context-menu';
import type { ContextMenuItem } from '../../shared/context-menu';
import { Icon } from '../../shared/icon';
import { IosNav } from '../../shared/ios-nav';
import { onHostLineChange } from '../../shared/large-title';
import { Segmented } from '../../shared/segmented';
import type { SegmentOption } from '../../shared/segmented';
import { Skeleton } from '../../shared/skeleton';
import { addDaysIso, firstOfMonth, isoOf, isoWeek, shiftMonthIso, weekdayMon0 } from './agenda-days';
import type { AgendaEntry } from './agenda-entries';
import { AgendaMonth, AgendaRows, WEEKDAYS_SHORT, dayAria, dotTone, monthName } from './agenda-month';
import { enterHome } from './home-data';
import { longDate, shortDate } from './home-figures';
import { PlannerCards } from './planner-cards';
import { HomeStyles } from './home-styles';

type Seg = 'dag' | 'komend' | 'taken';

/** Komend on this page: from tomorrow, at most this many days ahead and this many rows. */
const KOMEND_DAYS = 30;
const KOMEND_ROWS = 20;

/** A real 'YYYY-MM-DD' from the address, else null. */
function validDay(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return isoOf(Number(value.slice(0, 4)), Number(value.slice(5, 7)), Number(value.slice(8, 10))) === value ? value : null;
}

const capital = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * /dashboard/agenda (spec-home §5.2), the phone's full agenda: the month as
 * a grid under a large title, Dag / Komend / Taken under it. Scrolled past
 * the grid, the month folds into the selected week: a sticky subbar with
 * the 7 days and the segments appears under the nav. The address carries
 * the day and the segment (?dag=2026-10-24&seg=komend): a new day is a
 * history step, a segment replaces it. On a desk the page hands over to
 * the home's Maand segment (/dashboard?agenda=maand).
 *
 * The page hosts the planner sheets once (app-planner-cards, which is the
 * Taken card too), and a "+" that adds a task or an appointment on the
 * selected day.
 */
@Component({
  selector: 'app-agenda-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IosNav, Icon, Segmented, Skeleton, ContextMenu, AgendaMonth, AgendaRows, PlannerCards, HomeStyles],
  template: `
    <app-home-styles hidden />
    @if (!desk()) {
      <div class="ios-page home-agenda">
        <app-ios-nav [title]="title()" [subtitle]="subtitle()" backLabel="Vandaag" backUrl="/dashboard" backAriaLabel="Terug naar Vandaag">
          <div trail class="home-agenda__trail">
            <!-- One way back to today, and only when another day is shown (the back capsule already says "Vandaag", P8). -->
            @if (selected() !== data.today()) {
              <button class="ios-capsule ios-capsule--tinted ios-capsule--sm" type="button" (click)="goToday()"
                      [attr.aria-label]="'Naar vandaag, ' + todayLabel()">Naar vandaag</button>
            }
            <button class="ios-circle" type="button" aria-label="Toevoegen" aria-haspopup="dialog" (click)="adding.set(true)">
              <app-icon name="plus" [size]="22" />
            </button>
          </div>
          <div below class="home-agenda__fold" [class.is-folded]="folded()" [attr.aria-hidden]="folded() ? null : 'true'" [attr.inert]="folded() ? null : ''">
            <div class="ios-subbar home-agenda__subbar">
              <div class="home-agenda__week" role="group" [attr.aria-label]="'Week ' + weekNumber()">
                @for (day of week(); track day.date) {
                  <button class="home-day" type="button" [class.is-today]="day.today" [class.is-selected]="day.date === selected()"
                          [attr.aria-pressed]="day.date === selected()" [attr.aria-label]="day.aria" (click)="pick(day.date)">
                    <span class="home-day__wd">{{ day.weekday }}</span>
                    <span class="home-day__num">{{ day.number }}</span>
                    <span class="home-day__dots" aria-hidden="true">
                      @for (type of day.markers.types; track type) { <i class="home-dot" [class]="'home-dot--' + type + ' ' + tone(type, day.markers)"></i> }
                      @if (day.markers.more) { <b>+</b> }
                    </span>
                  </button>
                }
              </div>
              <app-segmented variant="ios" semantics="tabs" label="Weergave" controls="home-agenda-panel"
                             [options]="segments()" [value]="seg()" (changed)="setSeg($event)" />
            </div>
          </div>
        </app-ios-nav>

        @if (data.planner.error()) {
          <div class="ios-banner" role="status">
            <span>Agenda niet bijgewerkt</span>
            <button class="ios-capsule ios-capsule--sm" type="button" [disabled]="data.planner.loading()" (click)="data.planner.reload()">Opnieuw</button>
          </div>
        }

        <section class="ios-card home-agenda__card" aria-label="Maand">
          <div class="home-agenda__months">
            <!-- The large title names the month already: this heading is for a screen reader only (P8). -->
            <h2 class="home-agenda__month sr-only">{{ monthLabel() }}</h2>
            <button class="ios-circle" type="button" aria-label="Vorige maand" (click)="shiftMonth(-1)"><app-icon name="chevron-left" [size]="20" /></button>
            <button class="ios-circle" type="button" aria-label="Volgende maand" (click)="shiftMonth(1)"><app-icon name="chevron-right" [size]="20" /></button>
          </div>
          <app-agenda-month variant="phone" [selected]="selected()" (selectedChange)="pick($event)" />
        </section>

        <div class="home-agenda__seg" [class.is-covered]="folded()">
          <app-segmented variant="ios" semantics="tabs" label="Weergave" controls="home-agenda-panel"
                         [options]="segments()" [value]="seg()" (changed)="setSeg($event)" />
        </div>
        <div #sentinel class="home-agenda__sentinel" aria-hidden="true"></div>

        <div class="home-agenda__panel" id="home-agenda-panel" role="tabpanel" [attr.aria-label]="panelLabel()">
          @switch (seg()) {
            @case ('dag') {
              <section class="ios-section">
                <div class="ios-section__head">
                  <h2>{{ longDay() }}</h2>
                  @if (!loading()) { <span class="ios-section__trail">{{ dayEntries().length }}</span> }
                </div>
                @if (loading()) {
                  <div class="ios-group home-agenda__skel"><app-skeleton kind="list" [rows]="3" /></div>
                } @else if (dayEntries().length) {
                  <app-agenda-rows variant="phone" [entries]="dayEntries()" [cards]="cards() ?? null" />
                } @else {
                  <div class="ios-group"><p class="home-agenda__empty">Niets gepland</p></div>
                }
              </section>
              @if (!loading() && !dayEntries().length && soon().length) {
                <section class="ios-section">
                  <div class="ios-section__head"><h2>Komend</h2></div>
                  <app-agenda-rows variant="phone" [entries]="soon()" [dated]="true" [month]="selected().slice(0, 7)" [cards]="cards() ?? null" />
                </section>
              }
            }
            @case ('komend') {
              @if (loading()) {
                <div class="ios-group home-agenda__skel"><app-skeleton kind="list" [rows]="4" /></div>
              } @else {
                @for (group of komend(); track group.date) {
                  <section class="ios-section">
                    <div class="ios-section__head">
                      <h2>{{ group.label }}</h2>
                      <span class="ios-section__trail">{{ group.entries.length }}</span>
                    </div>
                    <app-agenda-rows variant="phone" [entries]="group.entries" [cards]="cards() ?? null" />
                  </section>
                } @empty {
                  <div class="ios-group"><p class="home-agenda__empty">Niets gepland de komende 30 dagen</p></div>
                }
                <!-- The advances without a due day: no day of their own, one row after the dated ones (critique B4). -->
                @if (undatedRow(); as row) {
                  <section class="ios-section home-agenda__undated">
                    <app-agenda-rows variant="phone" [entries]="[row]" [cards]="cards() ?? null" />
                  </section>
                }
              }
              <div class="ios-group home-agenda__more">
                <button class="ios-cell" type="button" (click)="moreInMonth()">
                  <span class="ios-cell__body"><span class="ios-cell__title">Meer in de maand</span>
                    <span class="ios-cell__sub">{{ capital(nextMonthLabel()) }}</span></span>
                  <app-icon class="ios-cell__chev" name="chevron-right" [size]="18" />
                </button>
              </div>
            }
          }
          <!-- Always rendered: in Taken it is the task card, in Dag and Komend it hosts the view and edit sheets. -->
          <app-planner-cards [section]="seg() === 'taken' ? 'tasks' : 'none'" />
        </div>

        @if (adding()) {
          <app-context-menu title="Toevoegen" variant="ios" cancelLabel="Annuleren" [items]="addItems()"
                            (pick)="add($event)" (closed)="adding.set(false)" />
        }
      </div>
    }
  `,
})
export class AgendaPage {
  readonly data = enterHome();
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly desk = inject(DesktopViewport).active;

  private readonly query = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
  /** The selected day: ?dag=, else today. */
  readonly selected = computed(() => validDay(this.query().get('dag')) ?? this.data.today());
  readonly seg = computed<Seg>(() => {
    const seg = this.query().get('seg');
    return seg === 'komend' || seg === 'taken' ? seg : 'dag';
  });

  readonly cards = viewChild(PlannerCards);
  private readonly sentinel = viewChild<ElementRef<HTMLElement>>('sentinel');
  /** The grid has scrolled under the nav: the week subbar shows. */
  readonly folded = signal(false);
  readonly adding = signal(false);
  readonly capital = capital;

  readonly loading = computed(() => !this.data.planner.loaded() && !this.data.planner.error());
  readonly agenda = computed(() => this.data.agenda());

  readonly title = computed(() => capital(monthName(this.selected())));
  /** "2026 · week 40–44": the weeks of the month's first and last day. */
  readonly subtitle = computed(() => {
    const first = firstOfMonth(this.selected());
    const last = addDaysIso(`${shiftMonthIso(first, 1)}-01`, -1);
    return `${first.slice(0, 4)} · week ${isoWeek(first)}–${isoWeek(last)}`;
  });
  readonly monthLabel = computed(() => `${capital(monthName(this.selected()))} ${this.selected().slice(0, 4)}`);
  readonly nextMonthLabel = computed(() => {
    const next = shiftMonthIso(this.data.today(), 1);
    return `${monthName(next)} ${next.slice(0, 4)}`;
  });
  readonly todayLabel = computed(() => longDate(this.data.today()));
  readonly longDay = computed(() => longDate(this.selected()));
  readonly weekNumber = computed(() => isoWeek(this.selected()));

  readonly segments = computed<SegmentOption[]>(() => [
    { id: 'dag', label: 'Dag' },
    { id: 'komend', label: 'Komend' },
    this.loading() ? { id: 'taken', label: 'Taken' }
      : { id: 'taken', label: 'Taken', count: this.agenda().openTaskCount, ariaLabel: `Taken, ${this.agenda().openTaskCount} open` },
  ]);
  readonly panelLabel = computed(() => ({ dag: 'Dag', komend: 'Komend', taken: 'Taken' })[this.seg()]);

  readonly addItems = computed<ContextMenuItem[]>(() => {
    const day = shortDate(this.selected());
    return [
      { id: 'TASK', label: 'Taak', hint: `op ${day}`, iconName: 'tick' },
      { id: 'EVENT', label: 'Afspraak', hint: `op ${day}`, iconName: 'calendar' },
    ];
  });

  /** The selected week (Monday to Sunday) for the folded subbar. */
  readonly week = computed(() => {
    const day = this.selected();
    const today = this.data.today();
    const agenda = this.agenda();
    const monday = addDaysIso(day, -weekdayMon0(day));
    return Array.from({ length: 7 }, (_, index) => {
      const date = addDaysIso(monday, index);
      return { date, today: date === today, weekday: WEEKDAYS_SHORT[index], number: Number(date.slice(8, 10)), markers: agenda.markers(date),
        aria: dayAria(date, agenda.byDay.get(date) ?? [], today, agenda.krapDays.has(date)) };
    });
  });

  readonly dayEntries = computed(() => this.agenda().byDay.get(this.selected()) ?? []);
  /** Under an empty day: the first three of Komend after it (or after today). */
  readonly soon = computed(() => {
    const today = this.data.today();
    return this.agenda().komend(addDaysIso(this.selected() > today ? this.selected() : today, 1), 3);
  });
  /** Komend per day, from tomorrow: at most 30 days ahead and 20 rows. */
  readonly komend = computed(() => {
    const today = this.data.today();
    const tomorrow = addDaysIso(today, 1);
    const groups: { date: string; label: string; entries: AgendaEntry[] }[] = [];
    for (const entry of this.agenda().komend(tomorrow, KOMEND_ROWS, addDaysIso(today, KOMEND_DAYS))) {
      let group = groups.at(-1);
      if (group?.date !== entry.date) {
        group = { date: entry.date, label: `${entry.date === tomorrow ? 'morgen · ' : ''}${longDate(entry.date)}`, entries: [] };
        groups.push(group);
      }
      group.entries.push(entry);
    }
    return groups;
  });

  /** "Zonder datum · 3 voorschotten · + € 61.935" (the forecast's advance rows without a due day), to the Kasprognose. */
  readonly undatedRow = computed<AgendaEntry | null>(() => {
    const undated = this.agenda().undated;
    if (!undated) return null;
    return { key: 'undated', date: this.data.today(), atTime: null, type: 'geld', title: 'Zonder datum', term: null,
      sub: `${undated.count} ${undated.count === 1 ? 'voorschot' : 'voorschotten'}`, eur: undated.eur, past: false, late: false, done: false,
      pinned: false, deadline: false, plannerId: null, orderId: null, link: { path: ['/analyses/cash'] }, milestoneKind: null };
  });

  tone = dotTone;

  constructor() {
    /* A desk has the month in the home's Agenda card: the same day (?dag=), or its Taken view. */
    effect(() => {
      if (!this.desk()) return;
      untracked(() => {
        const taken = this.seg() === 'taken';
        const day = taken ? null : validDay(this.query().get('dag'));
        void this.router.navigate(['/dashboard'], { queryParams: { agenda: taken ? 'taken' : 'maand', dag: day }, replaceUrl: true });
      });
    });
    /*
     * The fold: the sentinel sits between the segments and the panel. Once it passes under where the subbar's
     * bottom will be, the grid is all but gone and the in-page segments sit where the subbar's are: the
     * subbar (the week and the segments) takes over in place, and the panel scrolls on under it.
     */
    effect((onCleanup) => {
      const sentinel = this.sentinel()?.nativeElement;
      if (!sentinel || typeof IntersectionObserver === 'undefined') return;
      const fold = this.host.nativeElement.querySelector<HTMLElement>('.home-agenda__fold');
      const bar = this.host.nativeElement.querySelector<HTMLElement>('.home-agenda__subbar');
      let observer: IntersectionObserver | null = null;
      const start = (): void => {
        observer?.disconnect();
        /* The fold's sticky line, its own top (the nav's height, except on the native host's strip poses). */
        const height = Math.round((fold ? parseFloat(getComputedStyle(fold).top) || 0 : 44) + (bar?.offsetHeight ?? 0));
        observer = new IntersectionObserver(([entry]) => {
          this.folded.set(!entry.isIntersecting && entry.boundingClientRect.top < height);
        }, { rootMargin: `-${height}px 0px 0px 0px`, threshold: 0 });
        observer.observe(sentinel);
      };
      start();
      const stopMarks = onHostLineChange(sentinel.ownerDocument, start);
      onCleanup(() => { observer?.disconnect(); stopMarks(); });
    });
  }

  /** A day is a step in the history (Back returns to the day before); the page keeps its scroll. */
  pick(date: string | null): void {
    if (!date || date === this.selected()) return;
    void this.router.navigate([], { relativeTo: this.route, queryParams: { dag: date }, queryParamsHandling: 'merge', scroll: 'manual' });
  }

  /** A segment replaces the address; while folded the new panel starts right under the subbar, still folded. */
  setSeg(id: string): void {
    const seg = id as Seg;
    if (seg === this.seg()) return;
    const folded = this.folded();
    void this.router.navigate([], { relativeTo: this.route, queryParams: { seg: seg === 'dag' ? null : seg },
      queryParamsHandling: 'merge', replaceUrl: true, scroll: 'manual' }).then(() => { if (folded) this.keepPanelUnderBar(); });
  }

  goToday(): void {
    this.pick(this.data.today());
  }

  /** ‹ and ›: the other month on its first day, or on today when that is today's month. */
  shiftMonth(step: number): void {
    const month = shiftMonthIso(this.selected(), step);
    const today = this.data.today();
    this.pick(month === today.slice(0, 7) ? today : `${month}-01`);
  }

  /** "Meer in de maand": the month after this one, on its first day, in Dag. */
  moreInMonth(): void {
    void this.router.navigate([], { relativeTo: this.route,
      queryParams: { dag: `${shiftMonthIso(this.data.today(), 1)}-01`, seg: null }, queryParamsHandling: 'merge' });
  }

  add(item: ContextMenuItem): void {
    this.adding.set(false);
    this.cards()?.openNew(item.id === 'EVENT' ? 'EVENT' : 'TASK', this.selected());
  }

  private keepPanelUnderBar(): void {
    requestAnimationFrame(() => {
      const panel = this.host.nativeElement.querySelector<HTMLElement>('.home-agenda__panel');
      const bar = this.host.nativeElement.querySelector<HTMLElement>('.home-agenda__subbar');
      if (!panel || !bar) return;
      const top = panel.getBoundingClientRect().top;
      const under = bar.getBoundingClientRect().bottom - 1;
      if (top !== under) window.scrollBy({ top: top - under, behavior: 'instant' as ScrollBehavior });
    });
  }
}
