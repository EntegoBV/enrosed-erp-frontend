import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Auth } from '../../core/api/auth';
import type { PlannerItem } from '../../core/api/planner-api';
import { plannedBusinessDay } from '../../shared/business-days';
import { ContextMenu } from '../../shared/context-menu';
import type { ContextMenuItem } from '../../shared/context-menu';
import type { MenuPoint } from '../../shared/context-menu-position';
import { Icon } from '../../shared/icon';
import { NotificationBell } from '../../shared/notification-bell';
import { Skeleton } from '../../shared/skeleton';
import { Sheet } from '../../shared/ui';
import { weekdayDayMonth } from '../finance/cash-format';
import { DashboardSearchConsole } from './dashboard-search-console';
import { localPlannerDate } from './dashboard-today-state';
import { HOME_ADD_MENU, HomeAdd } from './home-add-actions';
import { HomeData } from './home-data';
import { HomeDeskAgenda } from './home-desk-agenda';
import { briefing, firstName, greeting, overline } from './home-figures';
import { VAT_SHOW_DAYS, nextWorkday, whyOrderLines } from './home-priority';
import type { HomeSource, HomeTask } from './home-priority';
import { homeTargetLink } from './home-sources';
import { amount, count } from './widgets/home-w';
import { HomeInkoop } from './widgets/home-inkoop';
import { HomeKas } from './widgets/home-kas';
import { HomeMarkt } from './widgets/home-markt';
import { HomeOntvangen } from './widgets/home-ontvangen';
import { HomePartners } from './widgets/home-partners';
import { HomeResultaat } from './widgets/home-resultaat';
import { HomeVerkoop } from './widgets/home-verkoop';
import { HomeVoorraad } from './widgets/home-voorraad';
import { HomeWebsite } from './widgets/home-website';

/** The icon and tile tone a row shows for its source (a Nu row is always red). */
const LOOK: Readonly<Record<HomeSource, { icon: string; tone: string }>> = {
  'container-due': { icon: 'purchase', tone: 'danger' }, advance: { icon: 'receipt', tone: 'amber' }, 'advance-later': { icon: 'receipt', tone: 'grey' },
  'overdue-invoices': { icon: 'arrow-in', tone: 'warn' }, 'small-invoices': { icon: 'arrow-in', tone: 'grey' }, krap: { icon: 'bank', tone: 'danger' },
  'overdue-costs': { icon: 'arrow-out', tone: 'warn' }, vat: { icon: 'document', tone: 'plum' }, customers: { icon: 'customers', tone: 'blue' },
  login: { icon: 'customers', tone: 'teal' }, planner: { icon: 'check', tone: 'grey' }, arrival: { icon: 'truck', tone: 'blue' },
  'purchase-check': { icon: 'purchase', tone: 'grey' }, settlement: { icon: 'exchange', tone: 'grey' }, 'bank-lines': { icon: 'link', tone: 'grey' },
  'recurring-due': { icon: 'repeat', tone: 'grey' }, 'open-credits': { icon: 'restore', tone: 'grey' }, regimes: { icon: 'settings', tone: 'grey' },
  catalog: { icon: 'globe', tone: 'grey' },
};

/** "08:12" of an epoch time, local. */
function clockOf(ms: number): string {
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** A "Waarom" line split into its bold lead ("Nu", "Vandaag", "Ook nog") and the rest. */
function whyParts(line: string): { lead: string | null; rest: string } {
  const match = /^(Nu|Vandaag|Ook nog):\s*(.*)$/.exec(line);
  return match ? { lead: match[1], rest: match[2] } : { lead: null, rest: line };
}

type RowMenu = { task: HomeTask; point: MenuPoint; inSheet: boolean };

/**
 * The desk home (spec-home §3, ≥ 680 px): a calm page that scrolls
 * normally. The header greets and briefs in one sentence, with the status,
 * "+ Nieuw" and the bell on the right. Row 1 is "Vandaag te doen" (at most
 * seven ranked rows, the reason chip, a verb and a "⋯" menu per row) beside
 * Kas, Verkoop, Resultaat and Inkoop & containers; row 2 the Agenda card;
 * row 3 the other figure blocks. "Alle n" (and ?alle=1) opens every open
 * point in one sheet, with the ranking explained underneath.
 *
 * The layout uses media queries only (home-desk.scss): no container query
 * may sit above the planner sheets, the bell or a menu.
 */
@Component({
  selector: 'app-home-desk',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgTemplateOutlet, RouterLink, Icon, Skeleton, Sheet, ContextMenu, NotificationBell, DashboardSearchConsole, HomeDeskAgenda,
    HomeKas, HomeVerkoop, HomeResultaat, HomeInkoop, HomeOntvangen, HomeVoorraad, HomePartners, HomeWebsite, HomeMarkt,
  ],
  template: `
    @let t = data.tasks();
    <main class="content home-desk" [attr.aria-busy]="data.loading() || data.refreshing() || null">
      <header class="home-desk__head">
        <div class="home-desk__lead">
          <p class="home-desk__over">{{ over() }}</p>
          <h1 class="home-desk__title">{{ title() }}</h1>
          <p class="home-desk__brief">@for (part of brief(); track $index) {@if (part.krap) {<a class="home-desk__krap" routerLink="/analyses/cash">{{ part.text }}</a>} @else if (part.strong) {<b>{{ part.text }}</b>} @else {<span>{{ part.text }}</span>}}</p>
        </div>
        <div class="home-desk__tools">
          @switch (status().kind) {
            @case ('busy') { <span class="wk-pill home-desk__status" role="status">{{ status().text }}</span> }
            @case ('warn') {
              <span class="wk-pill tone-warn home-desk__status" role="status">{{ status().text }} ·
                <button type="button" [disabled]="data.refreshing()" (click)="data.load()">Opnieuw</button></span>
            }
            @default { <span class="wk-pill tone-ok home-desk__status" role="status"><span class="wk-pill__dot"></span>{{ status().text }}</span> }
          }
          <span class="wk-split">
            <button #addButton class="wk-btn wk-btn--primary" type="button" aria-haspopup="menu" (click)="openAdd()">
              <app-icon name="plus" [size]="15" /> Nieuw</button>
            <button class="wk-btn wk-btn--primary" type="button" aria-haspopup="menu" aria-label="Nieuw: kies wat" (click)="openAdd()">
              <app-icon name="chevron-down" [size]="14" /></button>
          </span>
          <app-notification-bell />
        </div>
      </header>

      <div class="home-desk__top">
        <section class="wk-card home-todo" aria-labelledby="home-todo-title" [attr.aria-busy]="data.loading() || null">
          <header class="home-todo__head">
            <h2 id="home-todo-title" class="home-desk__card-title">Vandaag te doen</h2>
            @if (!data.loading()) { <span class="wk-pill home-todo__count" [attr.aria-label]="t.count + ' te doen'">{{ t.count }}</span> }
            <span #whyAnchor class="wk-popover-anchor home-todo__why">
              <button class="wk-link" type="button" aria-haspopup="dialog" [attr.aria-expanded]="whyOpen()" (click)="whyOpen.set(!whyOpen())">
                <app-icon name="info" [size]="14" /> Waarom deze volgorde</button>
              @if (whyOpen()) {
                <div class="wk-popover home-why" role="dialog" aria-label="Waarom deze volgorde">
                  <ng-container [ngTemplateOutlet]="whyText" />
                </div>
              }
            </span>
          </header>

          @if (data.loading()) {
            <div class="home-todo__loading" aria-label="Te doen laden"><app-skeleton kind="card" [rows]="4" /></div>
          } @else if (t.count === 0) {
            @if (t.allClear) {
              <div class="home-todo__clear">
                <span class="home-todo__tick" aria-hidden="true"><app-icon name="tick" [size]="18" /></span>
                <b>Niets dringends</b>
                <span>Geen klantvragen, termijnen of taken die vandaag moeten.</span>
              </div>
            } @else if (!data.settled()) {
              <div class="home-todo__clear is-open">
                <span class="home-todo__tick" aria-hidden="true">…</span>
                <b>Nog niet alles geladen</b>
                <span>Bijwerken…</span>
              </div>
            } @else {
              <div class="home-todo__clear is-open">
                <span class="home-todo__tick" aria-hidden="true">!</span>
                <b>Nog geen volledige all-clear</b>
                <span>Niet geladen: {{ t.missing.join(', ') }} ·
                  <button class="wk-link" type="button" [disabled]="data.refreshing()" (click)="data.load()">Opnieuw</button></span>
              </div>
            }
          } @else {
            @if (nu().length) {
              <h3 class="home-todo__group"><b class="is-nu">Nu</b> · geld of een termijn loopt vandaag uit</h3>
              <ul class="home-tasks">
                @for (task of nu(); track task.key) { <ng-container [ngTemplateOutlet]="row" [ngTemplateOutletContext]="{ $implicit: task, sheet: false }" /> }
              </ul>
            }
            @if (vandaag().length) {
              <h3 class="home-todo__group"><b class="is-vandaag">Vandaag</b> · iemand wacht, of een termijn binnen {{ vatDays }} dagen</h3>
              <ul class="home-tasks">
                @for (task of vandaag(); track task.key) { <ng-container [ngTemplateOutlet]="row" [ngTemplateOutletContext]="{ $implicit: task, sheet: false }" /> }
              </ul>
            }
            @if (data.settled() && !t.complete) {
              <p class="home-todo__note" role="status">Niet volledig: {{ t.missing.join(', ') }} ·
                <button class="wk-link" type="button" [disabled]="data.refreshing()" (click)="data.load()">Opnieuw</button></p>
            }
          }

          @if (!data.loading() && t.total > t.top.length) {
            <footer class="home-todo__foot">
              <b>{{ others() }} {{ others() === 1 ? 'ander open punt' : 'andere open punten' }}</b>
              <span [title]="othersTitles()">{{ othersTitles() }}</span>
              <button class="wk-link home-todo__all" type="button" (click)="openAll()">Alle {{ t.total }} ›</button>
            </footer>
          }
        </section>

        <div class="home-desk__figs">
          <app-home-kas variant="desk" />
          <app-home-verkoop variant="desk" />
          <app-home-resultaat variant="desk" />
          <app-home-inkoop variant="desk" />
        </div>
      </div>

      <app-home-desk-agenda />

      <div class="home-desk__more">
        <app-home-ontvangen variant="desk" />
        <app-home-voorraad variant="desk" />
        <app-home-partners variant="desk" />
        <app-home-website variant="desk" />
        @defer (on viewport) {
          <app-dashboard-search-console />
        } @placeholder {
          <div class="wk-card home-desk__placeholder" aria-hidden="true"></div>
        }
        @defer (on viewport) {
          <app-home-markt variant="desk" />
        } @placeholder {
          <div class="wk-card home-desk__placeholder" aria-hidden="true"></div>
        }
      </div>
    </main>

    <input #photo type="file" accept="image/*" capture="environment" hidden (change)="add.photoPicked($event)" />

    @if (addAnchor(); as anchor) {
      <app-context-menu title="Nieuw" [items]="addItems" [anchor]="anchor" (pick)="pickAdd($event.id)" (closed)="addAnchor.set(null)" />
    }
    @if (rowMenu(); as menu) {
      @if (!menu.inSheet) { <ng-container [ngTemplateOutlet]="rowMenuTpl" [ngTemplateOutletContext]="{ $implicit: menu }" /> }
    }

    @if (allOpen()) {
      <app-sheet title="Alle open punten" [wide]="true" (closed)="closeAll()">
        <div body class="home-all">
          @if (t.total === 0) {
            <p class="home-all__empty">{{ t.allClear ? 'Niets open.' : 'Nog geen volledige all-clear: niet geladen ' + t.missing.join(', ') + '.' }}</p>
          }
          @if (allNu().length) {
            <h3 class="home-todo__group"><b class="is-nu">Nu</b> · geld of een termijn loopt vandaag uit</h3>
            <ul class="home-tasks">
              @for (task of allNu(); track task.key) { <ng-container [ngTemplateOutlet]="row" [ngTemplateOutletContext]="{ $implicit: task, sheet: true }" /> }
            </ul>
          }
          @if (allVandaag().length) {
            <h3 class="home-todo__group"><b class="is-vandaag">Vandaag</b> · iemand wacht, of een termijn binnen {{ vatDays }} dagen</h3>
            <ul class="home-tasks">
              @for (task of allVandaag(); track task.key) { <ng-container [ngTemplateOutlet]="row" [ngTemplateOutletContext]="{ $implicit: task, sheet: true }" /> }
            </ul>
          }
          <h3 class="home-todo__group"><b class="is-ooknog">Ook nog</b> · opruimen zonder termijn</h3>
          <ul class="home-tasks">
            @for (task of t.ookNog; track task.key) { <ng-container [ngTemplateOutlet]="row" [ngTemplateOutletContext]="{ $implicit: task, sheet: true }" /> }
            <li class="home-task home-task--more">
              <span class="home-task__tile ios-tile ios-tile--soft tone-grey" aria-hidden="true"><app-icon name="bank" [size]="16" /></span>
              <span class="home-task__body">
                <a class="home-task__go" routerLink="/costs" title="Meer in Kosten &amp; bank — Vraagt aandacht: bonnen, betalingen en documenten die nog ontbreken">Meer in Kosten &amp; bank</a>
                <span class="home-task__sub"><span class="home-task__context">Vraagt aandacht: bonnen, betalingen en documenten die nog ontbreken</span></span>
              </span>
              <span class="home-task__chev" aria-hidden="true">›</span>
            </li>
          </ul>
          <div class="home-all__why">
            <h3 class="home-todo__group"><b>Waarom deze volgorde</b></h3>
            <ng-container [ngTemplateOutlet]="whyText" />
          </div>
          @if (rowMenu(); as menu) {
            @if (menu.inSheet) { <ng-container [ngTemplateOutlet]="rowMenuTpl" [ngTemplateOutletContext]="{ $implicit: menu }" /> }
          }
        </div>
      </app-sheet>
    }

    <!-- One task row: the tick (planner) or the source tile, the title as the row's one link, the chip and
         context, the amount or count, the verb and the "⋯" menu. Title and context may cut: the title button is
         stretched over the row, so it carries the full title and context in its title (the hover anywhere). -->
    <ng-template #row let-task let-sheet="sheet">
      <li class="home-task" [class.is-escalated]="task.escalated">
        @if (task.plannerId !== null) {
          <button class="ios-check home-task__tick" type="button" [attr.aria-label]="'Afvinken: ' + task.title" (click)="data.klaar(task)">
            <app-icon name="tick" [size]="13" /></button>
        } @else {
          <span class="home-task__tile ios-tile ios-tile--soft" [class]="'tone-' + toneOf(task)" aria-hidden="true">
            <app-icon [name]="iconOf(task)" [size]="16" /></span>
        }
        <span class="home-task__body">
          <button class="home-task__go" type="button" [title]="task.context ? task.title + ' — ' + task.context : task.title" (click)="open(task)">{{ task.title }}</button>
          <span class="home-task__sub">
            <span class="wk-pill home-task__chip" [class]="'tone-' + task.chip.tone">{{ task.chip.label }}</span>
            <span class="home-task__context" [title]="task.context">{{ task.context }}</span>
          </span>
        </span>
        <span class="home-task__value" [class.is-none]="task.eur === null && task.count === null">{{ valueOf(task) }}</span>
        <button class="wk-btn wk-btn--sm home-task__verb" type="button" (click)="verb(task)">{{ task.verb }}</button>
        <button class="wk-btn wk-btn--sm wk-btn--ghost wk-btn--icon home-task__menu" type="button" aria-haspopup="menu"
                [attr.aria-label]="'Meer acties: ' + task.title" (click)="openRowMenu(task, $event, sheet)">
          <app-icon name="more" [size]="16" /></button>
      </li>
    </ng-template>

    <ng-template #rowMenuTpl let-menu>
      <app-context-menu [title]="menu.task.title" [items]="rowItems(menu.task)" [anchor]="menu.point"
                        (pick)="pickRow(menu.task, $event.id)" (closed)="rowMenu.set(null)" />
    </ng-template>

    <ng-template #whyText>
      <ol class="home-why__lines">
        @for (line of why; track $index) {
          <li>@if (line.lead) {<b>{{ line.lead }}</b>: }{{ line.rest }}</li>
        }
      </ol>
    </ng-template>
  `,
  host: {
    '(document:click)': 'onDocumentClick($event)',
    '(document:keydown.escape)': 'onEscape()',
  },
})
export class HomeDesk {
  readonly data = inject(HomeData);
  readonly add = inject(HomeAdd);
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly params = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });

  private readonly agenda = viewChild.required(HomeDeskAgenda);
  private readonly bell = viewChild.required(NotificationBell);
  private readonly photo = viewChild.required<ElementRef<HTMLInputElement>>('photo');
  private readonly addButton = viewChild.required<ElementRef<HTMLButtonElement>>('addButton');
  private readonly whyAnchor = viewChild<ElementRef<HTMLElement>>('whyAnchor');

  readonly vatDays = VAT_SHOW_DAYS;
  readonly why = whyOrderLines().map(whyParts);
  readonly addItems: ContextMenuItem[] = [...HOME_ADD_MENU];

  readonly whyOpen = signal(false);
  readonly allOpen = signal(false);
  readonly addAnchor = signal<MenuPoint | null>(null);
  readonly rowMenu = signal<RowMenu | null>(null);

  /* ------------------------------------------------------------- header */

  readonly over = computed(() => overline(this.data.today()));
  readonly title = computed(() => {
    const name = firstName(this.auth.username());
    return `${greeting(this.data.hour())}${name ? `, ${name}` : ''}`;
  });
  /** "7 dingen te doen en 2 afspraken vandaag. Eerste afspraak om 10:00. De bank wordt krap van 3 tot 11 november." */
  readonly brief = computed(() => {
    const t = this.data.tasks();
    const cash = this.data.cash();
    const today = this.data.today();
    const planner = this.data.planner;
    return briefing({
      count: t.count, complete: t.complete, settled: this.data.settled(), nowTime: this.data.nowTime(),
      agenda: planner.loaded() && !planner.error() ? 'ok' : planner.error() ? 'failed' : 'loading',
      events: planner.items().filter((item) => item.kind === 'EVENT' && item.onDate === today),
      tight: cash.state === 'ready' ? cash.tight : null,
    });
  });
  /** "Alles bijgewerkt om 08:12", "Niet volledig: kosten" (with Opnieuw), or "Bijwerken…" while a load runs. */
  readonly status = computed<{ kind: 'busy' | 'warn' | 'ok'; text: string }>(() => {
    if (this.data.loading() || this.data.refreshing() || !this.data.settled()) return { kind: 'busy', text: 'Bijwerken…' };
    const warnings = this.data.warnings();
    if (warnings.length) return { kind: 'warn', text: `Niet volledig: ${warnings.join(', ')}` };
    const at = this.data.loadedAt();
    return { kind: 'ok', text: at === null ? 'Alles bijgewerkt' : `Alles bijgewerkt om ${clockOf(at)}` };
  });

  /* -------------------------------------------------------------- tasks */

  readonly nu = computed(() => this.data.tasks().top.filter((task) => task.tier === 'nu'));
  readonly vandaag = computed(() => this.data.tasks().top.filter((task) => task.tier === 'vandaag'));
  readonly allNu = computed(() => { const t = this.data.tasks(); return [...t.top, ...t.more].filter((task) => task.tier === 'nu'); });
  readonly allVandaag = computed(() => { const t = this.data.tasks(); return [...t.top, ...t.more].filter((task) => task.tier === 'vandaag'); });
  /** Everything the seven rows leave out: Nu/Vandaag beyond the cap, then Ook nog. */
  private readonly hidden = computed(() => { const t = this.data.tasks(); return [...t.more, ...t.ookNog]; });
  readonly others = computed(() => this.hidden().length);
  readonly othersTitles = computed(() => {
    const hidden = this.hidden();
    return hidden.slice(0, 3).map((task) => task.title).join(' · ') + (hidden.length > 3 ? ' …' : '');
  });

  constructor() {
    const documentTitle = inject(Title);
    effect(() => documentTitle.setTitle(`${greeting(this.data.hour())} — Enrosed`));
    /* ?alle=1 opens "Alle open punten" (the phone's Open punten page on a desk lands here). */
    effect(() => {
      if (this.params().get('alle') === '1') this.allOpen.set(true);
    });
    /* Escape on a row menu inside "Alle" closes the menu only: caught before the sheet's own document listener. */
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || !this.rowMenu()?.inSheet) return;
      event.stopPropagation();
      this.rowMenu.set(null);
    };
    window.addEventListener('keydown', onKey, true);
    inject(DestroyRef).onDestroy(() => window.removeEventListener('keydown', onKey, true));
  }

  toneOf(task: HomeTask): string {
    return task.tier === 'nu' ? 'danger' : LOOK[task.source].tone;
  }

  iconOf(task: HomeTask): string {
    return LOOK[task.source].icon;
  }

  /** The euro amount, else the count ("Klanten wachten · 5"), else a dash. */
  valueOf(task: HomeTask): string {
    if (task.eur !== null) return amount(task.eur);
    return task.count !== null ? count(task.count) : '—';
  }

  /** Row and verb lead to the target: a page, Kosten & bank, the Kasprognose, the bell sheet or the planner task. */
  open(task: HomeTask): void {
    const target = task.target;
    /* The planner and the bell open their own sheet: "Alle" closes first. */
    if ((target.kind === 'planner' || target.kind === 'bell') && this.allOpen()) this.closeAll();
    if (target.kind === 'planner') {
      const item = this.plannerItem(task.plannerId ?? target.id);
      if (item) this.cards().openEdit(item);
      return;
    }
    if (target.kind === 'bell') {
      this.bell().open();
      return;
    }
    const link = homeTargetLink(target);
    if (link) void this.router.navigate(link.commands, { queryParams: link.queryParams });
  }

  /** The verb button: "Morgen" moves a due planner task to the next workday; every other verb (a later pinned task's "Openen" too) opens the target. */
  verb(task: HomeTask): void {
    if (task.plannerId !== null && task.actions.includes('morgen')) void this.data.morgen(task);
    else this.open(task);
  }

  openRowMenu(task: HomeTask, event: MouseEvent, inSheet: boolean): void {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.rowMenu.set({ task, inSheet, point: { x: Math.max(8, rect.right - 240), y: rect.bottom + 4 } });
  }

  /** "⋯": Klaar / Morgen on a planner task (Morgen only on a due one), Later / Taak van maken on everything else. */
  rowItems(task: HomeTask): ContextMenuItem[] {
    if (task.plannerId !== null) {
      const next = weekdayDayMonth(localPlannerDate(plannedBusinessDay(new Date(), 1)));
      return [
        { id: 'klaar', label: 'Klaar', hint: 'Afvinken', iconName: 'tick' },
        ...(task.actions.includes('morgen') ? [{ id: 'morgen', label: 'Morgen', hint: `Naar ${next}`, iconName: 'calendar' }] : []),
      ];
    }
    return [
      { id: 'later', label: 'Later', hint: `Verbergen tot ${weekdayDayMonth(nextWorkday(this.data.today()))}`, iconName: 'recent' },
      { id: 'taak', label: 'Taak van maken', hint: 'Als taak in de agenda zetten', iconName: 'check' },
    ];
  }

  pickRow(task: HomeTask, id: string): void {
    this.rowMenu.set(null);
    switch (id) {
      case 'klaar': void this.data.klaar(task); break;
      case 'morgen': void this.data.morgen(task); break;
      case 'later': this.data.later(task); break;
      case 'taak':
        if (this.allOpen()) this.closeAll();
        this.data.makeTask(task, this.cards());
        break;
    }
  }

  /* -------------------------------------------------------- "+ Nieuw" */

  openAdd(): void {
    const rect = this.addButton().nativeElement.closest('.wk-split')!.getBoundingClientRect();
    this.addAnchor.set({ x: Math.max(8, rect.right - 280), y: rect.bottom + 4 });
  }

  /** Same eight as the phone sheet; the camera input is clicked inside the tap (Safari ignores it later). */
  pickAdd(id: string): void {
    this.addAnchor.set(null);
    if (id === 'photo') this.photo().nativeElement.click();
    else if (id === 'task') this.cards().openNew('TASK');
    else if (id === 'event') this.cards().openNew('EVENT', this.data.today());
    else this.add.go(id);
  }

  /* ------------------------------------------------------- Alle, popover */

  openAll(): void {
    this.whyOpen.set(false);
    this.allOpen.set(true);
  }

  closeAll(): void {
    this.allOpen.set(false);
    this.rowMenu.set(null);
    if (this.params().get('alle') !== null) {
      void this.router.navigate([], { relativeTo: this.route, queryParams: { alle: null }, queryParamsHandling: 'merge', replaceUrl: true, scroll: 'manual' });
    }
  }

  onDocumentClick(event: MouseEvent): void {
    if (!this.whyOpen()) return;
    const anchor = this.whyAnchor()?.nativeElement;
    if (anchor && !anchor.contains(event.target as Node)) this.whyOpen.set(false);
  }

  onEscape(): void {
    if (!this.whyOpen()) return;
    this.whyOpen.set(false);
    this.whyAnchor()?.nativeElement.querySelector<HTMLElement>('button')?.focus();
  }

  private cards() {
    return this.agenda().cards();
  }

  private plannerItem(id: number): PlannerItem | null {
    return this.data.planner.items().find((item) => item.id === id) ?? null;
  }
}
