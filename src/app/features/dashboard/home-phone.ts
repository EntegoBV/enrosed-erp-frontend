import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ContextMenu } from '../../shared/context-menu';
import type { ContextMenuItem } from '../../shared/context-menu';
import { Icon } from '../../shared/icon';
import { IosNav } from '../../shared/ios-nav';
import { NotificationBell } from '../../shared/notification-bell';
import { Skeleton } from '../../shared/skeleton';
import { AgendaStrip } from './agenda-strip';
import { DashboardSearchConsole } from './dashboard-search-console';
import { HomeAdd } from './home-add-actions';
import { HomeAddSheet } from './home-add-sheet';
import { HomeData } from './home-data';
import { greeting, longDate } from './home-figures';
import { othersOf } from './home-priority';
import type { HomeTask, Tier } from './home-priority';
import { HomeTaskCells } from './home-task-cells';
import { PlannerCards } from './planner-cards';
import { HomeInkoop } from './widgets/home-inkoop';
import { HomeKas } from './widgets/home-kas';
import { HomeMarkt } from './widgets/home-markt';
import { HomeOntvangen } from './widgets/home-ontvangen';
import { HomePartners } from './widgets/home-partners';
import { HomeResultaat } from './widgets/home-resultaat';
import { HomeTica } from './widgets/home-tica';
import { HomeVerkoop } from './widgets/home-verkoop';
import { HomeVoorraad } from './widgets/home-voorraad';
import { HomeWebsite } from './widgets/home-website';

const MENU: ContextMenuItem[] = [
  { id: 'reload', label: 'Vernieuwen', iconName: 'refresh' },
  { id: 'agenda', label: 'Agenda', iconName: 'calendar' },
  { id: 'open', label: 'Open punten', iconName: 'list' },
  { id: 'analyses', label: 'Alle analyses', iconName: 'analytics' },
];

/**
 * The phone home (spec-home §2, below 680 px), one calm page: the large
 * title "Vandaag" with the greeting and the date, the glass bell (the same
 * count as "Klanten wachten") and "…"; the Kas hero; Te doen, at most seven
 * rows in Nu and Vandaag with "n andere open punten · Alle n ›" to Open punten; the
 * Agenda card (W7's strip, a card of its own, its rows open like Agenda ›
 * Dag); the figure blocks in their fixed order; and Meer cijfers. The ERP tab bar stays, narrowed
 * on /dashboard (app.ts shell--home), with the '+' beside it opening
 * Toevoegen.
 *
 * Trap rule: the bell's sheet, the planner's sheets, the menu, the
 * Toevoegen sheet and the camera input all sit at page-host level - never
 * in the sticky nav (the bell button there is a proxy), a swipe row or a
 * figure block.
 */
@Component({
  selector: 'app-home-phone',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgTemplateOutlet, RouterLink, Icon, IosNav, Skeleton, ContextMenu, NotificationBell, PlannerCards, AgendaStrip, DashboardSearchConsole,
    HomeAddSheet, HomeTaskCells, HomeKas, HomeVerkoop, HomeInkoop, HomeResultaat, HomeOntvangen, HomeVoorraad, HomePartners, HomeWebsite,
    HomeMarkt, HomeTica,
  ],
  template: `
    @let t = data.tasks();
    @let bellCount = data.work.actionCount();
    <div class="ios-page home-phone">
      <app-ios-nav title="Vandaag" [subtitle]="subtitle()">
        <span trail class="ios-glass-group">
          <button class="ios-circle home-phone__bell" type="button" [attr.aria-label]="bellLabel()" (click)="bell.open()">
            <app-icon name="bell" [size]="20" />
            @if (bellCount) { <span class="home-phone__badge" aria-hidden="true">{{ bellCount > 9 ? '9+' : bellCount }}</span> }
          </button>
          <button class="ios-circle" type="button" aria-label="Meer" (click)="menu.set(true)"><app-icon name="more" [size]="22" /></button>
        </span>
        @if (data.loading() || data.refreshing()) {
          <p caption class="ios-large__sub home-phone__status" role="status">Bijwerken…</p>
        } @else if (data.warnings().length) {
          <p caption class="ios-large__sub home-phone__status is-warn" role="status">Niet volledig: {{ data.warnings().join(', ') }} ·
            <button class="home-phone__retry" type="button" (click)="data.load()">Opnieuw</button></p>
        }
      </app-ios-nav>

      <app-home-kas variant="phone" />

      <!-- Te doen: Nu and Vandaag, at most seven rows -->
      <section class="ios-section home-todo" aria-labelledby="home-todo-title">
        <div class="ios-section__head ios-section__head--prominent">
          <h2 id="home-todo-title">Te doen</h2>
          @if (data.tasksReady() && (data.settled() || t.count)) { <span class="ios-section__trail" [attr.aria-label]="t.count + ' te doen'">{{ t.count }}</span> }
        </div>
        <!-- One reveal (critique B2): the rows show once Te doen's sources and the Kas answered, never source by source. -->
        @if (!data.tasksReady()) {
          <div class="ios-group home-todo__skeleton" aria-busy="true"><app-skeleton kind="list" [rows]="3" /></div>
        } @else if (t.count) {
          @for (group of groups(); track group.tier) {
            <p class="home-tier"><i class="wk-dot" [class]="group.tier === 'nu' ? 'tone-danger' : 'tone-amber'" aria-hidden="true"></i>{{ group.label }}</p>
            <app-home-task-cells [tasks]="group.rows" [label]="group.label" [hosts]="{ bell: bell, cards: cards }">
              @if ($last && moreText()) { <ng-container *ngTemplateOutlet="more" /> }
            </app-home-task-cells>
          }
        } @else if (!data.settled()) {
          <div class="ios-group home-todo__skeleton" aria-busy="true"><app-skeleton kind="list" [rows]="3" /></div>
        } @else {
          <div class="ios-group ios-group--icons">
            @if (t.allClear) {
              <div class="ios-cell ios-cell--tall home-todo__clear">
                <span class="ios-tile tone-ok ios-cell__lead" aria-hidden="true"><app-icon name="tick" [size]="17" /></span>
                <span class="ios-cell__body"><span class="ios-cell__title ios-cell__title--strong">Niets dringends</span>
                  <span class="home-todo__note">Geen klantvragen, termijnen of taken die vandaag moeten.</span></span>
              </div>
            } @else {
              <div class="ios-cell ios-cell--tall home-todo__clear">
                <span class="ios-tile ios-tile--soft tone-warn ios-cell__lead" aria-hidden="true"><app-icon name="alert" [size]="17" /></span>
                <span class="ios-cell__body"><span class="ios-cell__title ios-cell__title--strong home-todo__unsure">Nog niet alles nagekeken</span>
                  <span class="home-todo__note">Niet geladen: {{ t.missing.join(', ') }}</span></span>
                <button class="ios-capsule ios-capsule--tinted ios-capsule--sm" type="button" [disabled]="data.refreshing()" (click)="data.load()">Opnieuw</button>
              </div>
            }
            @if (moreText()) { <ng-container *ngTemplateOutlet="more" /> }
          </div>
        }
      </section>

      <!-- Agenda: W7's card - the pin, the next seven days, the rest of today and what comes; its rows open like Agenda › Dag -->
      <div class="home-phone__agenda"><app-agenda-strip variant="phone" [cards]="cards" /></div>

      <!-- Cijfers: the blocks in their fixed order -->
      <section class="ios-section home-phone__figures" aria-labelledby="home-figures-title">
        <div class="ios-section__head"><h2 id="home-figures-title">Cijfers</h2><a class="ios-section__link" routerLink="/analyses/overview">Analyses</a></div>
        <div class="ios-widgets">
          <app-home-verkoop variant="phone" />
          <app-home-tica variant="phone" />
          <app-home-inkoop variant="phone" />
          <app-home-resultaat variant="phone" />
          <app-home-ontvangen variant="phone" />
          <app-home-voorraad variant="phone" />
          <app-home-partners variant="phone" />
          <app-home-website variant="phone" />
        </div>
      </section>

      <section class="ios-section home-phone__more" aria-labelledby="home-more-title">
        <div class="ios-section__head"><h2 id="home-more-title">Meer cijfers</h2></div>
        @defer (on viewport) {
          <div class="home-phone__search"><app-dashboard-search-console /></div>
        } @placeholder {
          <div class="home-phone__search home-phone__search--wait" aria-hidden="true"></div>
        }
        <div class="ios-group ios-group--icons">
          @defer (on viewport) {
            <app-home-markt variant="phone" />
          } @placeholder {
            <div class="ios-cell ios-cell--tall" aria-hidden="true"></div>
          }
          <a class="ios-cell" routerLink="/analyses/overview">
            <span class="ios-tile ios-tile--soft tone-grey ios-cell__lead" aria-hidden="true"><app-icon name="analytics" [size]="17" /></span>
            <span class="ios-cell__body"><span class="ios-cell__title">Alle analyses</span></span>
            <app-icon class="ios-cell__chev" name="chevron-right" [size]="18" />
          </a>
        </div>
      </section>

      <button class="ios-accessory" type="button" aria-label="Toevoegen" (click)="adding.set(true)"><app-icon name="plus" [size]="26" /></button>
    </div>

    <!-- The desk's words (critique B3): every hidden open point, and how many of them are for today. -->
    <ng-template #more>
      @let others = moreCount();
      <a class="ios-cell home-todo__more" routerLink="/dashboard/open" [attr.aria-label]="moreText() + '. Alle ' + data.tasks().total + ' open punten'">
        <span class="ios-cell__body home-todo__more-body">
          <b class="home-todo__more-text">{{ others.count }} {{ others.count === 1 ? 'ander open punt' : 'andere open punten' }}</b>
          @if (others.urgent) { <span class="wk-pill tone-warn home-todo__urgent">{{ others.urgent }} voor vandaag</span> }
        </span>
        <span class="ios-section__link home-todo__all">Alle {{ data.tasks().total }} ›</span>
      </a>
    </ng-template>

    <!-- host level: the sheets never sit under the sticky nav, in a swipe row or in a block -->
    <app-planner-cards #cards section="none" [milestones]="data.milestones()" />
    <app-notification-bell #bell class="home-bell-host" />
    <input #photo type="file" accept="image/*" capture="environment" hidden (change)="add.photoPicked($event)" />
    @if (menu()) {
      <app-context-menu variant="ios" title="Vandaag" cancelLabel="Annuleren" [items]="menuItems" (pick)="menuPick($event.id)" (closed)="menu.set(false)" />
    }
    @if (adding()) {
      <app-home-add-sheet (picked)="addPicked($event, cards)" (closed)="adding.set(false)" />
    }
  `,
})
export class HomePhone {
  readonly data = inject(HomeData);
  readonly add = inject(HomeAdd);
  private readonly router = inject(Router);
  private readonly photo = viewChild.required<ElementRef<HTMLInputElement>>('photo');

  readonly menu = signal(false);
  readonly adding = signal(false);
  readonly menuItems = MENU;

  /** "Goedemorgen · donderdag 15 oktober". */
  readonly subtitle = computed(() => `${greeting(this.data.hour())} · ${longDate(this.data.today())}`);
  readonly bellLabel = computed(() => {
    const n = this.data.work.actionCount();
    return n === 0 ? 'Meldingen' : n === 1 ? '1 klant wacht' : `${n} klanten wachten`;
  });

  /** The shown rows per tier: Nu, then Vandaag (both at most the cap together). */
  readonly groups = computed(() => {
    const top = this.data.tasks().top;
    return ([['nu', 'Nu'], ['vandaag', 'Vandaag']] as [Tier, string][])
      .map(([tier, label]) => ({ tier, label, rows: top.filter((task: HomeTask) => task.tier === tier) }))
      .filter((group) => group.rows.length > 0);
  });

  /** What the rows leave out: every hidden open point and how many are Nu or Vandaag past the cap (othersOf, as on the desk). */
  readonly moreCount = computed(() => othersOf(this.data.tasks()));
  /** "6 andere open punten, 1 voor vandaag"; null when every open point is on screen. */
  readonly moreText = computed(() => {
    const { count, urgent } = this.moreCount();
    if (!count) return null;
    return `${count} ${count === 1 ? 'ander open punt' : 'andere open punten'}${urgent ? `, ${urgent} voor vandaag` : ''}`;
  });

  menuPick(id: string): void {
    this.menu.set(false);
    if (id === 'reload') void this.data.load();
    else if (id === 'agenda') void this.router.navigate(['/dashboard/agenda']);
    else if (id === 'open') void this.router.navigate(['/dashboard/open']);
    else if (id === 'analyses') void this.router.navigate(['/analyses/overview']);
  }

  /** Toevoegen's page actions: the camera input is clicked inside the same tap; a new appointment opens on today. */
  addPicked(id: 'photo' | 'event', cards: PlannerCards): void {
    if (id === 'photo') this.photo().nativeElement.click();
    else cards.openNew('EVENT', this.data.today());
  }
}
