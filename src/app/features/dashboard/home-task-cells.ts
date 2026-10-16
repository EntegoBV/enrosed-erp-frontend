import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { PlannerItem } from '../../core/api/planner-api';
import { Icon } from '../../shared/icon';
import { SwipeActions } from '../../shared/swipe-actions';
import type { RowSwipeSide } from '../../shared/row-actions';
import { eurWhole } from '../finance/cash-format';
import { HomeData } from './home-data';
import type { HomeSource, HomeTask } from './home-priority';
import { homeTargetLink } from './home-sources';
import { amount, count } from './widgets/home-w';

/** What a task row may open on its page: the bell's sheet and the planner's edit sheet both live at page-host level. */
export interface TaskCellHosts {
  bell: { open(): void } | null;
  cards: { openEdit(item: PlannerItem): void } | null;
}

/** The lead tile per source (a planner task has its tick circle instead). */
const LEAD: Readonly<Record<HomeSource, { icon: string; tone: string }>> = {
  'container-due': { icon: 'purchase', tone: 'danger' },
  advance: { icon: 'order', tone: 'plum' },
  'advance-later': { icon: 'order', tone: 'plum' },
  'overdue-invoices': { icon: 'arrow-in', tone: 'amber' },
  'small-invoices': { icon: 'arrow-in', tone: 'grey' },
  krap: { icon: 'bank', tone: 'danger' },
  'overdue-costs': { icon: 'receipt', tone: 'warn' },
  vat: { icon: 'document', tone: 'teal' },
  customers: { icon: 'customers', tone: 'blue' },
  login: { icon: 'customers', tone: 'teal' },
  planner: { icon: 'check', tone: 'accent' },
  arrival: { icon: 'truck', tone: 'blue' },
  'purchase-check': { icon: 'purchase', tone: 'grey' },
  settlement: { icon: 'exchange', tone: 'grey' },
  'bank-lines': { icon: 'link', tone: 'grey' },
  'recurring-due': { icon: 'repeat', tone: 'grey' },
  'open-credits': { icon: 'arrow-out', tone: 'grey' },
  regimes: { icon: 'info', tone: 'grey' },
  catalog: { icon: 'globe', tone: 'grey' },
};

/**
 * The phone's task rows (spec-home §2 rows 3a/3b), one inset group of them:
 * the home's Nu and Vandaag groups and the three groups of Open punten. A
 * row leads with its source tile, or with a tick circle on a planner task
 * (a tap ticks it: Klaar), then the title, the reason chip and the context
 * (both cut by design, the full text in title and aria-label), and the
 * amount or count, which never are. A row opens its target; the bell and
 * the planner's sheets are the page's (`hosts`), never inside a row - a
 * swipe row is transformed and would trap them.
 *
 * Swipes: a planner task has Klaar to the right and, when it is due, Morgen to the left; a
 * system item has Later and "Taak van maken" to the left (a full swipe runs
 * Later). Every action toasts with "Ongedaan maken" (HomeData).
 *
 * Anything projected lands after the rows, inside the group: the home's
 * "Nog n · Alle n ›" cell and Open punten's "Meer in Kosten & bank" row.
 * No styles here: the rules live in styles/home-phone.scss.
 */
@Component({
  selector: 'app-home-task-cells',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, RouterLink, Icon, SwipeActions],
  template: `
    <div class="ios-group ios-group--icons home-tasks" role="group" [attr.aria-label]="label()">
      @for (task of tasks(); track task.key) {
        @let planner = task.plannerId !== null;
        @let morgen = task.actions.includes('morgen');
        @let link = linkOf(task);
        <div class="ios-swipe home-task" appSwipeActions #sw="swipeActions" [swipeStart]="planner ? 1 : 0" [swipeEnd]="planner ? (morgen ? 1 : 0) : 2"
             [swipeFull]="planner ? (morgen ? 'both' : 'start') : 'end'" (swipeCommit)="commit($event, task)">
          @if (planner) {
            <div class="ios-swipe__actions ios-swipe__actions--start">
              <button class="ios-swipe__btn tone-ok" type="button" (click)="sw.close(); data.klaar(task)"><app-icon name="tick" [size]="18" />Klaar</button>
            </div>
            @if (morgen) {
              <div class="ios-swipe__actions ios-swipe__actions--end">
                <button class="ios-swipe__btn tone-amber" type="button" (click)="sw.close(); data.morgen(task)"><app-icon name="calendar" [size]="18" />Morgen</button>
              </div>
            }
          } @else {
            <div class="ios-swipe__actions ios-swipe__actions--end">
              <button class="ios-swipe__btn tone-grey" type="button" (click)="sw.close(); data.later(task)"><app-icon name="recent" [size]="18" />Later</button>
              <button class="ios-swipe__btn tone-blue" type="button" (click)="sw.close(); makeTask(task)"><app-icon name="plus" [size]="18" /><span>Taak van<br />maken</span></button>
            </div>
          }
          <div class="ios-swipe__row">
            @if (planner) {
              <div class="ios-cell ios-cell--tall home-task__cell">
                <button class="home-task__check" type="button" [attr.aria-label]="'Afvinken: ' + task.title" (click)="data.klaar(task)">
                  <span class="ios-check"><app-icon name="tick" [size]="14" /></span>
                </button>
                <button class="home-task__go" type="button" [attr.aria-label]="rowLabel(task)" (click)="open(task)">
                  <ng-container *ngTemplateOutlet="body; context: { $implicit: task }" />
                </button>
              </div>
            } @else if (link) {
              <a class="ios-cell ios-cell--tall home-task__cell" [routerLink]="link.commands" [queryParams]="link.queryParams"
                 [attr.aria-label]="rowLabel(task)">
                <span class="ios-tile ios-tile--soft ios-cell__lead" [class]="'tone-' + lead(task).tone" aria-hidden="true"><app-icon [name]="lead(task).icon" [size]="17" /></span>
                <ng-container *ngTemplateOutlet="body; context: { $implicit: task }" />
              </a>
            } @else {
              <button class="ios-cell ios-cell--tall home-task__cell" type="button" [attr.aria-label]="rowLabel(task)" (click)="open(task)">
                <span class="ios-tile ios-tile--soft ios-cell__lead" [class]="'tone-' + lead(task).tone" aria-hidden="true"><app-icon [name]="lead(task).icon" [size]="17" /></span>
                <ng-container *ngTemplateOutlet="body; context: { $implicit: task }" />
              </button>
            }
          </div>
        </div>
      }
      <ng-content />
    </div>

    <ng-template #body let-task>
      <span class="ios-cell__body">
        <span class="ios-cell__title ios-cell__title--strong" [title]="task.title">{{ task.title }}</span>
        <span class="home-task__sub">
          <span class="wk-pill" [class]="'tone-' + task.chip.tone">{{ task.chip.label }}</span>
          <span class="home-task__context" [title]="task.context">{{ task.context }}</span>
        </span>
      </span>
      @if (task.eur !== null) {
        <span class="ios-cell__trail"><span class="ios-cell__value ios-cell__value--strong" [class.is-neg]="task.eur < 0">{{ whole(task.eur) }}</span></span>
      } @else if (task.count !== null) {
        <span class="ios-cell__trail"><span class="home-task__count">{{ count(task.count) }}</span></span>
      }
      <app-icon class="ios-cell__chev" name="chevron-right" [size]="18" />
    </ng-template>
  `,
})
export class HomeTaskCells {
  readonly data = inject(HomeData);
  readonly tasks = input.required<readonly HomeTask[]>();
  readonly hosts = input.required<TaskCellHosts>();
  /** The group's name for a screen reader (the tier: "Nu", "Vandaag", "Ook nog"). */
  readonly label = input<string | null>(null);
  readonly whole = amount;
  readonly count = count;

  lead(task: HomeTask): { icon: string; tone: string } {
    return LEAD[task.source] ?? { icon: 'info', tone: 'grey' };
  }

  linkOf(task: HomeTask): ReturnType<typeof homeTargetLink> {
    return homeTargetLink(task.target);
  }

  /** Everything the row says, for a screen reader and for the cut title and context. */
  rowLabel(task: HomeTask): string {
    const figure = task.eur !== null ? eurWhole(task.eur) : task.count !== null ? `${task.count}` : null;
    return [task.title, task.chip.label, task.context, figure].filter(Boolean).join(', ');
  }

  /** The bell and the planner open on the page; every other target is the row's own link. */
  open(task: HomeTask): void {
    const hosts = this.hosts();
    if (task.target.kind === 'bell') {
      hosts.bell?.open();
      return;
    }
    if (task.target.kind === 'planner') {
      const id = task.target.id;
      const item = this.data.planner.items().find((row) => row.id === id);
      if (item) hosts.cards?.openEdit(item);
    }
  }

  makeTask(task: HomeTask): void {
    const cards = this.hosts().cards;
    if (cards) this.data.makeTask(task, cards);
  }

  /** A full swipe: to the right ticks a planner task; to the left moves a due one a workday, or hides a system item until then. */
  commit(side: RowSwipeSide, task: HomeTask): void {
    if (task.plannerId !== null) {
      if (side === 'start') void this.data.klaar(task);
      else if (task.actions.includes('morgen')) void this.data.morgen(task);
    } else if (side === 'end') {
      this.data.later(task);
    }
  }
}
