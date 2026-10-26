import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { DesktopViewport } from '../core/platform/desktop-viewport';
import { WorkQueue } from '../core/api/work-queue';
import { AppNotification } from '../core/api/models';
import { Sheet } from './ui';
import { Icon } from './icon';
import { localDay, oldestFirst, waitLabel, waitingSummary, whenLabel } from './customer-wait';
import { notificationTarget } from './notification-target';

/**
 * The bell top right: what is waiting on us.
 *
 * The number only counts what we must do — fill in a delivery term, set a
 * freight amount, review a proposal, send a quote again after adopting the
 * customer's change. That a customer opened their quote is
 * useful to know but no task, and would inflate the number until it means
 * nothing. Those notifications do appear in the list, under their own
 * heading.
 */
@Component({
  selector: 'app-notification-bell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, Sheet, Icon],
  template: `
    <button class="bell" type="button" (click)="open()"
            [attr.aria-label]="count() > 0
              ? count() + ' zaken vragen je aandacht'
              : 'Meldingen'">
      <app-icon class="bell__icon" name="bell" [size]="20" />
      @if (count(); as n) {
        <span class="bell__badge">{{ n > 9 ? '9+' : n }}</span>
      }
    </button>

    @if (sheet()) {
      <app-sheet title="Meldingen" [variant]="desk() ? 'default' : 'ios'" (closed)="sheet.set(false)">
        <div body class="bell-sheet" [class.bell--ios]="!desk()">
          <!-- Who waits and for how long, with Vernieuwen beside it (no foot: × and Esc close). -->
          <p class="bell-sum">
            <span>@if (summary(); as line) {<b>{{ line.lead }}</b>{{ line.rest }}} @else if (arrivalRows().length) {<b>{{ arrivalRows().length }} {{ arrivalRows().length === 1 ? 'container nadert' : 'containers naderen' }}</b>} @else {Niemand wacht op ons}</span>
            <button class="wk-link" type="button" [disabled]="loading()" (click)="refresh()">{{ loading() ? 'Vernieuwen…' : 'Vernieuwen' }}</button>
          </p>
          @if (error()) {
            @if (desk()) {
              <div class="wk-banner wk-banner--warn wk-banner--inset" role="alert">
                <app-icon name="alert" [size]="16" />
                <span class="wk-banner__text"><b>Meldingen niet vernieuwd</b> · {{ error() }}</span>
                <span class="wk-banner__actions"><button class="wk-btn wk-btn--sm" type="button" [disabled]="loading()" (click)="refresh()">
                  {{ loading() ? 'Laden…' : 'Opnieuw proberen' }}</button></span>
              </div>
            } @else {
              <div class="ios-banner" role="alert">
                <span><b>Meldingen niet vernieuwd</b><br />{{ error() }}</span>
                <button class="ios-capsule ios-capsule--sm" type="button" [disabled]="loading()" (click)="refresh()">{{ loading() ? 'Laden…' : 'Opnieuw proberen' }}</button>
              </div>
            }
          }
          @if (arrivalRows().length) {
            <h3 class="bell-sec">Containers bijna aangekomen</h3>
            <ul class="bell-list" [class.ios-group]="!desk()" [class.ios-group--icons]="!desk()">
              @for (row of arrivalRows(); track $index) {
                <ng-container [ngTemplateOutlet]="rowTpl" [ngTemplateOutletContext]="{ $implicit: row.item, pill: row.when, pillTone: 'tone-warn', tile: 'tone-warn', aria: row.when }" />
              }
            </ul>
          }
          @if (actionRows().length) {
            <h3 class="bell-sec">Wij zijn aan zet</h3>
            <ul class="bell-list" [class.ios-group]="!desk()" [class.ios-group--icons]="!desk()">
              @for (row of actionRows(); track $index) {
                <ng-container [ngTemplateOutlet]="rowTpl" [ngTemplateOutletContext]="{ $implicit: row.item, pill: row.wait?.label ?? null,
                  pillTone: row.wait ? (row.wait.nu ? 'tone-danger' : 'tone-warn') : '', tile: row.wait?.nu ? 'tone-danger' : 'tone-warn',
                  aria: row.wait ? 'wacht ' + row.wait.label : null }" />
              }
            </ul>
          }
          @if (newsRows().length) {
            <h3 class="bell-sec">Van de klant</h3>
            <ul class="bell-list" [class.ios-group]="!desk()" [class.ios-group--icons]="!desk()">
              @for (row of newsRows(); track $index) {
                <ng-container [ngTemplateOutlet]="rowTpl" [ngTemplateOutletContext]="{ $implicit: row.item, pill: row.when, pillTone: '', tile: 'tone-grey', aria: row.when }" />
              }
            </ul>
          }
          @if (!actionRows().length && !newsRows().length && !arrivalRows().length) {
            @if (desk()) {
              <div class="wk-empty"><span class="wk-empty__icon" aria-hidden="true"><app-icon name="bell" [size]="20" /></span>
                <p class="wk-empty__title">Niets openstaand</p><p class="wk-empty__text">Geen klanten die op ons wachten.</p></div>
            } @else {
              <div class="ios-empty"><span class="ios-empty__icon" aria-hidden="true"><app-icon name="bell" [size]="26" /></span>
                <p class="ios-empty__title">Niets openstaand</p><p class="ios-empty__text">Geen klanten die op ons wachten.</p></div>
            }
          }
        </div>
      </app-sheet>
    }

    <!-- One row: a single button (tile, customer, wait or when, order, what it is about) and the ✕ beside it, never inside
         it - tapping opens the order, it never makes something vanish by accident (N15). -->
    <ng-template #rowTpl let-item let-pill="pill" let-pillTone="pillTone" let-tile="tile" let-aria="aria">
      <li class="bell-row">
        <button class="bell-row__go" type="button" [attr.aria-label]="ariaOf(item, aria)" (click)="go(item)">
          <span class="bell-row__tile ios-tile ios-tile--soft" [class]="tile" aria-hidden="true"><app-icon [name]="iconOf(item.kind)" [size]="16" /></span>
          <span class="bell-row__body">
            <span class="bell-row__title">{{ nameOf(item) }}</span>
            <span class="bell-row__sub">@if (pill) {<span class="wk-pill" [class]="pillTone">{{ pill }}</span>}<span class="bell-row__meta">{{ item.orderNumber }}</span></span>
            @if (detailOf(item); as detail) { <span class="bell-row__detail" [title]="detail">{{ detail }}</span> }
          </span>
        </button>
        <button class="bell-row__x" type="button" (click)="dismiss(item, $event)" [attr.aria-label]="'Melding wegklikken: ' + nameOf(item)">✕</button>
      </li>
    </ng-template>
  `,
  styles: `
    /* One badge rule for every icon badge (bell, tab bar): red with a ring
       of the surface, 9+ capped. The number counts tasks, not events; inline
       counts in lists are accent chips instead. */
    /* Phone: a glass circle in the bar (44 px hit, 36 px visual), like app-ios-nav's buttons. */
    .bell {
      position: relative;
      isolation: isolate;
      display: grid;
      place-items: center;
      width: 44px;
      height: 44px;
      flex: none;
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: transparent;
      color: var(--ink);
      font-size: 15px;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
    }
    .bell::before {
      content: '';
      position: absolute;
      inset: 4px;
      z-index: -1;
      border-radius: 50%;
      background: var(--glass-bg);
      box-shadow: var(--glass-highlight), 0 1px 3px rgb(26 22 20 / 12%);
      backdrop-filter: var(--glass-filter);
      -webkit-backdrop-filter: var(--glass-filter);
      transition: transform var(--dur-1, .12s) var(--ease-out, ease);
    }
    .bell:active::before { transform: scale(.96); }
    .bell__badge {
      position: absolute;
      top: 1px;
      right: 0;
      display: grid;
      place-items: center;
      min-width: 18px;
      height: 18px;
      padding: 0 4px;
      border: 2px solid var(--surface);
      border-radius: 9px;
      background: var(--danger);
      color: #fff;
      font-size: 10px;
      font-weight: 750;
      font-variant-numeric: tabular-nums;
      line-height: 1;
    }
    /* Desk: a 32 px ghost square at the end of the toolbar. */
    @media (min-width: 680px) {
      .bell::before { content: none; }
      .bell {
        width: 32px;
        height: 32px;
        border-radius: var(--wk-radius, 9px);
        color: var(--ink-2);
        transition: background-color var(--dur-1, .12s) var(--ease-out, ease), color var(--dur-1, .12s) var(--ease-out, ease);
      }
      .bell:hover { background: var(--surface-2); color: var(--ink); }
      .bell__badge { top: -3px; right: -4px; min-width: 16px; height: 16px; font-size: 9.5px; }
    }

    /* The sheet (redesign home §2.8): a summary line with Vernieuwen, then the rows - one button each with the ✕
       beside it. Desk: a bordered list; phone (the ios sheet, whose body has no side padding): inset groups. */
    :host ::ng-deep .sheet__foot:empty { display: none; }
    .bell-sum { display: flex; align-items: baseline; gap: 8px; margin: 0 0 10px; color: var(--muted); font-size: 13px; }
    .bell-sum b { color: var(--ink); font-weight: 650; }
    .bell-sum .wk-link { flex: none; margin-left: auto; }
    .bell-sec { margin: 14px 2px 6px; color: var(--muted); font-size: 11px; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; }
    .bell-sum + .bell-sec, .wk-banner + .bell-sec { margin-top: 4px; }
    .bell-list { display: grid; margin: 0; padding: 0; overflow: hidden; border: 1px solid var(--line); border-radius: 14px; background: var(--surface); list-style: none; }
    .bell-row { display: grid; grid-template-columns: minmax(0, 1fr) 40px; align-items: center; border-top: 1px solid var(--line); }
    .bell-row:first-child { border-top: 0; }
    .bell-row:hover { background: var(--surface-2); }
    .bell-row__go { display: grid; grid-template-columns: 32px minmax(0, 1fr); align-items: center; gap: 12px; min-width: 0; min-height: 58px;
      padding: 8px 0 8px 14px; border: 0; background: none; color: var(--ink); font: inherit; text-align: left; cursor: pointer; }
    .bell-row__go:focus-visible { outline: 2px solid var(--rose); outline-offset: -2px; }
    .bell-row__tile { width: 32px; height: 32px; border-radius: 9px; }
    .bell-row__body { display: grid; gap: 1px; min-width: 0; }
    .bell-row__title { overflow: hidden; font-size: 14px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
    .bell-row__sub { display: flex; align-items: center; gap: 7px; min-width: 0; }
    .bell-row__sub > .wk-pill { flex: none; }
    .bell-row__meta, .bell-row__detail { min-width: 0; overflow: hidden; color: var(--muted); font-size: 12.5px; text-overflow: ellipsis; white-space: nowrap; }
    .bell-row__detail { color: var(--ink-2); }
    .bell-row__x { display: grid; place-items: center; width: 32px; height: 32px; padding: 0; border: 0; border-radius: 8px; background: none;
      color: var(--muted-2); font-size: 13px; cursor: pointer; }
    .bell-row__x:hover { background: var(--line); color: var(--ink); }
    .bell--ios .bell-sum { margin: 0 var(--ios-inset, 16px) 10px; font-size: 14px; }
    .bell--ios .bell-sec { margin-inline: calc(var(--ios-inset, 16px) + 4px); }
    .bell--ios .bell-list { margin: 0 var(--ios-inset, 16px); border: 0; border-radius: var(--ios-radius, 22px); }
    .bell--ios .bell-row { grid-template-columns: minmax(0, 1fr) 44px; border-top: 0; }
    .bell--ios .bell-row:hover { background: none; }
    .bell--ios .bell-row__go { grid-template-columns: 30px minmax(0, 1fr); min-height: 64px; padding-left: 16px; }
    .bell--ios .bell-row__tile { width: 30px; height: 30px; }
    .bell--ios .bell-row__title { font-size: 16px; font-weight: 600; }
    .bell--ios :is(.bell-row__meta, .bell-row__detail) { font-size: 13px; }
    /* The customer's own words: two lines on the phone (no hover title on touch), one with the title on the desk. */
    .bell--ios .bell-row__detail { display: -webkit-box; white-space: normal; overflow-wrap: anywhere; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
    .bell--ios .bell-row__x { width: 44px; height: 44px; }
  `,
})
export class NotificationBell {
  private readonly work = inject(WorkQueue);
  private readonly router = inject(Router);
  readonly desk = inject(DesktopViewport).active;

  readonly sheet = signal(false);
  /** The clock the wait pills read: taken when the sheet opens. */
  private readonly nowMs = signal(Date.now());

  constructor() {
    void this.work.refresh();
  }

  readonly count = computed(() => this.work.actionCount() + this.work.arrivals().length);
  readonly actions = this.work.actions;
  readonly news = this.work.news;
  readonly loading = this.work.loading;
  readonly error = this.work.error;

  /** What we must do, oldest first, with how long each customer waits. */
  readonly actionRows = computed(() => {
    const now = this.nowMs();
    const today = localDay(now);
    return oldestFirst(this.actions()).map((item) => ({ item, wait: waitLabel(item.at, now, today) }));
  });
  /** The customers' news, with when it came in. */
  readonly newsRows = computed(() => {
    const now = this.nowMs();
    return this.news().map((item) => ({ item, when: whenLabel(item.at, now) }));
  });
  readonly arrivalRows = computed(() => this.work.arrivals().map(item => ({ item, when: whenLabel(item.at, this.nowMs()) })));
  /** The oldest wait ("27 werkdagen"), for the summary line; null when no item has an instant. */
  readonly oldest = computed(() => this.actionRows().find((row) => row.wait)?.wait?.label ?? null);
  /** "6 meldingen van 4 klanten · de oudste 3 werkdagen": the items (the badge's number) and the customers they come from. */
  readonly summary = computed(() => waitingSummary(this.actions(), this.oldest()));

  refresh(): Promise<void> {
    return this.work.refresh(true);
  }

  /** Weggeklikt: verdwijnt tot de melding iets anders te zeggen heeft. */
  dismiss(item: AppNotification, event: Event): void {
    event.stopPropagation();
    this.work.dismiss(item);
  }

  open(): void {
    this.nowMs.set(Date.now());
    this.sheet.set(true);
    void this.refresh();
  }

  async go(item: AppNotification): Promise<void> {
    this.sheet.set(false);
    const target = notificationTarget(item);
    if (target) await this.router.navigate(target.commands, { queryParams: target.queryParams });
  }

  /** The row's tile icon by kind. */
  iconOf(kind: AppNotification['kind']): string {
    switch (kind) {
      case 'WEBSITE_AANVRAAG': return 'globe';
      case 'LEVERTERMIJN': return 'calendar';
      case 'VRACHT': return 'truck';
      case 'VOORSTEL': return 'exchange';
      case 'OPNIEUW_VERSTUREN': return 'refresh';
      case 'GETEKEND': return 'tick';
      case 'AFGEWEZEN': return 'close';
      case 'BEKEKEN': return 'eye';
      case 'CONTAINER_AANKOMST': return 'purchase';
      default: return 'bell';
    }
  }

  /** The row's title: the customer, else what it is about. */
  nameOf(item: AppNotification): string {
    return item.customer?.trim() || item.title;
  }

  /** "{what it is about} · {detail}" (just the detail when the title already is what it is about). */
  detailOf(item: AppNotification): string {
    const about = item.customer?.trim() ? item.title : '';
    return [about, item.detail].filter(Boolean).join(' · ');
  }

  /** "{klant}, wacht 27 werkdagen, {order}, {wat}": one name for the whole row (N15). */
  ariaOf(item: AppNotification, when: string | null): string {
    return [this.nameOf(item), when, item.orderNumber, item.customer?.trim() ? item.title : null].filter(Boolean).join(', ');
  }
}
