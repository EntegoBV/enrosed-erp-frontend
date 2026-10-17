import { ChangeDetectionStrategy, Component, computed, effect, inject, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { Icon } from '../../shared/icon';
import { IosNav } from '../../shared/ios-nav';
import { NotificationBell } from '../../shared/notification-bell';
import { Skeleton } from '../../shared/skeleton';
import { enterHome } from './home-data';
import { whyOrderLines } from './home-priority';
import type { HomeTask, Tier } from './home-priority';
import { HomeTaskCells } from './home-task-cells';
import { PlannerCards } from './planner-cards';

/** "Nu: geld …" → the tier word in bold, the rest as it is. */
function whyLine(line: string): { lead: string; rest: string } {
  const colon = line.indexOf(':');
  return colon > 0 && colon <= 8 ? { lead: line.slice(0, colon + 1), rest: line.slice(colon + 1) } : { lead: '', rest: line };
}

/**
 * /dashboard/open, "Open punten" (spec-home §2 row 3b): every open point
 * of the home in its order - Nu, Vandaag, Ook nog - with the same rows,
 * swipes and targets as Te doen, the uncounted "Meer in Kosten & bank" row
 * at the end of Ook nog (what the home cannot count), and "Waarom deze
 * volgorde". A phone page; on a desk it becomes the home's "Alle open
 * punten" sheet (/dashboard?alle=1). The bell's and the planner's sheets
 * sit at page-host level, as on the home.
 */
@Component({
  selector: 'app-open-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, IosNav, Skeleton, NotificationBell, PlannerCards, HomeTaskCells],
  template: `
    @let t = data.tasks();
    <div class="ios-page home-open">
      <app-ios-nav title="Open punten" [subtitle]="subtitle()" backLabel="Vandaag" backUrl="/dashboard" backAriaLabel="Terug naar Vandaag">
        @if (data.loading() || data.refreshing()) {
          <p caption class="ios-large__sub home-phone__status" role="status">Bijwerken…</p>
        } @else if (data.warnings().length) {
          <p caption class="ios-large__sub home-phone__status is-warn" role="status">Niet volledig: {{ data.warnings().join(', ') }} ·
            <button class="home-phone__retry" type="button" (click)="data.load()">Opnieuw</button></p>
        }
      </app-ios-nav>

      @if (!data.tasksReady() || (!t.total && !data.settled())) {
        <div class="ios-group home-todo__skeleton" aria-busy="true"><app-skeleton kind="list" [rows]="5" /></div>
      } @else {
        @if (!t.count && data.settled()) {
          @if (t.allClear) {
            <div class="ios-empty home-open__clear">
              <span class="ios-empty__icon" aria-hidden="true"><app-icon name="tick" [size]="26" /></span>
              <p class="ios-empty__title">Niets dringends</p>
              <p class="ios-empty__text">Geen klantvragen, termijnen of taken die vandaag moeten.</p>
            </div>
          } @else {
            <div class="ios-banner" role="status">
              <span><b>Nog niet alles nagekeken</b><br />Niet geladen: {{ t.missing.join(', ') }}</span>
              <button class="ios-capsule ios-capsule--sm" type="button" [disabled]="data.refreshing()" (click)="data.load()">Opnieuw</button>
            </div>
          }
        }
        @for (group of groups(); track group.tier) {
          <section class="ios-section" [attr.aria-labelledby]="'home-open-' + group.tier">
            <div class="ios-section__head">
              <h2 [id]="'home-open-' + group.tier"><i class="wk-dot" [class]="group.tone" aria-hidden="true"></i> {{ group.label }}</h2>
              <span class="ios-section__trail">{{ group.rows.length }}</span>
            </div>
            <app-home-task-cells [tasks]="group.rows" [label]="group.label" [hosts]="{ bell: bell, cards: cards }">
              @if (group.tier === 'ooknog') {
                <a class="ios-cell home-open__finance" routerLink="/costs">
                  <span class="ios-tile ios-tile--soft tone-grey ios-cell__lead" aria-hidden="true"><app-icon name="bank" [size]="17" /></span>
                  <span class="ios-cell__body"><span class="ios-cell__title">Meer in Kosten &amp; bank</span>
                    <span class="ios-cell__sub">Vraagt aandacht</span></span>
                  <app-icon class="ios-cell__chev" name="chevron-right" [size]="18" />
                </a>
              }
            </app-home-task-cells>
          </section>
        }
        <section class="ios-section home-open__why" aria-labelledby="home-open-why">
          <div class="ios-section__head"><h2 id="home-open-why">Waarom deze volgorde</h2></div>
          <ul class="ios-card home-open__why-list">
            @for (line of why; track $index) { <li>@if (line.lead) { <b>{{ line.lead }}</b> }{{ line.rest }}</li> }
          </ul>
        </section>
      }
    </div>

    <!-- host level: the sheets never sit inside a swipe row -->
    <app-planner-cards #cards section="none" [milestones]="data.milestones()" />
    <app-notification-bell #bell class="home-bell-host" />
  `,
})
export class OpenPage {
  readonly data = enterHome();
  private readonly router = inject(Router);
  private readonly desk = inject(DesktopViewport).active;

  readonly why = whyOrderLines().map(whyLine);

  /** "14 open · eerst wat vandaag moet, dan wie wacht". */
  readonly subtitle = computed(() => {
    const t = this.data.tasks();
    return this.data.tasksReady() && (t.total || this.data.settled()) ? `${t.total} open · eerst wat vandaag moet, dan wie wacht` : 'Laden…';
  });

  /** Nu, Vandaag (the home's rows and the ones past the cap) and Ook nog; Ook nog always, it ends with the Kosten & bank row. */
  readonly groups = computed(() => {
    const t = this.data.tasks();
    const ranked = [...t.top, ...t.more];
    const of = (tier: Tier): HomeTask[] => ranked.filter((task) => task.tier === tier);
    return [
      { tier: 'nu' as const, label: 'Nu', tone: 'tone-danger', rows: of('nu') },
      { tier: 'vandaag' as const, label: 'Vandaag', tone: 'tone-amber', rows: of('vandaag') },
      { tier: 'ooknog' as const, label: 'Ook nog', tone: 'tone-grey', rows: t.ookNog },
    ].filter((group) => group.rows.length > 0 || group.tier === 'ooknog');
  });

  constructor() {
    /* A desk shows every open point in the home's "Alle open punten" sheet. */
    effect(() => {
      if (this.desk()) untracked(() => void this.router.navigate(['/dashboard'], { queryParams: { alle: '1' }, replaceUrl: true }));
    });
  }
}
