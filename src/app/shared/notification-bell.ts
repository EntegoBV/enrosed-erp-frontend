import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { WorkQueue } from '../core/api/work-queue';
import { AppNotification } from '../core/api/models';
import { Sheet } from './ui';
import { Icon } from './icon';

/**
 * The bell top right: what is waiting on us.
 *
 * The number only counts what we must do — fill in a delivery term, set a
 * freight amount, review a proposal. That a customer opened their quote is
 * useful to know but no task, and would inflate the number until it means
 * nothing. Those notifications do appear in the list, under their own
 * heading.
 */
@Component({
  selector: 'app-notification-bell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet, Icon],
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
      <app-sheet title="Meldingen" (closed)="sheet.set(false)">
        <div body>
          @if (error()) {
            <div class="notification-error" role="alert">
              <div><b>Meldingen niet vernieuwd</b><small>{{ error() }}</small></div>
              <button class="btn" type="button" [disabled]="loading()" (click)="refresh()">
                {{ loading() ? 'Laden…' : 'Opnieuw proberen' }}
              </button>
            </div>
          }
          @if (actions().length) {
            <div class="section-title" style="margin-top:0">Wij zijn aan zet</div>
            @for (item of actions(); track $index) {
              <div class="note-row note-row--action">
                <button class="note note--action" type="button" (click)="go(item)">
                  <span class="note__icon">{{ icon(item.kind) }}</span>
                  <span class="note__body">
                    <span class="note__title">{{ item.title }}</span>
                    <span class="note__meta">
                      {{ item.orderNumber }}@if (item.customer) { · {{ item.customer }} }
                    </span>
                    <span class="note__detail">{{ item.detail }}</span>
                  </span>
                  <span class="note__chev">›</span>
                </button>
                <button class="note__dismiss" type="button" (click)="dismiss(item, $event)"
                        [attr.aria-label]="'Melding wegklikken: ' + item.title">✕</button>
              </div>
            }
          }

          @if (news().length) {
            <div class="section-title">Van de klant</div>
            @for (item of news(); track $index) {
              <div class="note-row">
                <button class="note" type="button" (click)="go(item)">
                  <span class="note__icon">{{ icon(item.kind) }}</span>
                  <span class="note__body">
                    <span class="note__title">{{ item.title }}</span>
                    <span class="note__meta">
                      {{ item.orderNumber }}@if (item.customer) { · {{ item.customer }} }
                    </span>
                    <span class="note__detail">{{ item.detail }}</span>
                  </span>
                  <span class="note__chev">›</span>
                </button>
                <button class="note__dismiss" type="button" (click)="dismiss(item, $event)"
                        [attr.aria-label]="'Melding wegklikken: ' + item.title">✕</button>
              </div>
            }
          }

          @if (!actions().length && !news().length) {
            <div class="empty">
              <div class="empty__icon">◇</div>
              <div class="empty__title">Niets openstaand</div>
              <div class="empty__text">Geen offertes die op ons wachten.</div>
            </div>
          }
        </div>
        <div foot style="display:contents">
          <button class="btn" type="button" (click)="sheet.set(false)">Sluiten</button>
          <button class="btn btn--primary" type="button" [disabled]="loading()" (click)="refresh()">
            {{ loading() ? 'Vernieuwen…' : 'Vernieuwen' }}
          </button>
        </div>
      </app-sheet>
    }
  `,
  styles: `
    .bell {
      position: relative;
      width: 36px;
      height: 36px;
      border: 0;
      border-radius: 50%;
      background: transparent;
      color: var(--ink);
      font-size: 15px;
      cursor: pointer;
      flex: none;
    }
    .bell:active { background: var(--surface-2); }
    /* The number counts tasks, not events; hence the accent colour. */
    .bell__badge {
      position: absolute;
      top: 1px;
      right: 0;
      min-width: 17px;
      height: 17px;
      padding: 0 4px;
      border-radius: 9px;
      background: var(--rose);
      color: #fff;
      font-size: 10.5px;
      font-weight: 700;
      line-height: 17px;
      text-align: center;
    }

    /* Plain full-width rows. The old negative-margin trick made rows wider
       than the sheet, pushing part of the message out of view on phones. */
    .note-row { display: flex; align-items: stretch; gap: 4px; margin-bottom: 6px; }
    .note {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      width: 100%;
      padding: 11px 12px;
      margin: 0;
      border: 0;
      border-radius: var(--r-sm);
      background: var(--surface-2);
      text-align: left;
      cursor: pointer;
    }
    .note:active { background: var(--line); }
    .note--action { background: var(--rose-soft); }
    .note__icon { font-size: 13px; color: var(--muted); margin-top: 2px; flex: none; }
    .note__body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .note__title { font-size: 14px; font-weight: 620; }
    .note__meta { font-size: 11.5px; color: var(--muted); }
    .note__detail { font-size: 12.5px; color: var(--muted); }
    .note__chev { color: var(--muted-2); font-size: 17px; flex: none; }
    /* Dismissing sits NEXT TO the notification, not inside it: tapping may
       take you to the order, not accidentally make something vanish. */
    .note__dismiss {
      color: var(--muted-2);
      font-size: 12px;
      min-width: 44px;
      min-height: 44px;
      padding: 4px;
      flex: none;
      cursor: pointer;
      border: 0;
      border-radius: var(--r-sm);
      background: var(--surface-2);
    }
    .note-row--action .note__dismiss { background: var(--rose-soft); }
    .note__dismiss:active { background: var(--line); }
    .notification-error { display: grid; gap: 10px; margin-bottom: 12px; padding: 12px;
      border: 1px solid var(--danger); border-radius: var(--r-sm); background: var(--danger-soft);
      color: var(--danger); }
    .notification-error > div { display: grid; gap: 2px; }
    .notification-error b { font-size: 15px; }
    .notification-error small { color: var(--muted); font-size: 14px; line-height: 1.45; }
    .notification-error .btn { width: 100%; min-height: 48px; }
  `,
})
export class NotificationBell {
  private readonly work = inject(WorkQueue);
  private readonly router = inject(Router);

  readonly sheet = signal(false);

  constructor() {
    void this.work.refresh();
  }

  readonly count = this.work.actionCount;
  readonly actions = this.work.actions;
  readonly news = this.work.news;
  readonly loading = this.work.loading;
  readonly error = this.work.error;

  refresh(): Promise<void> {
    return this.work.refresh(true);
  }

  /** Weggeklikt: verdwijnt tot de melding iets anders te zeggen heeft. */
  dismiss(item: AppNotification, event: Event): void {
    event.stopPropagation();
    this.work.dismiss(item);
  }

  open(): void {
    this.sheet.set(true);
    void this.refresh();
  }

  async go(item: AppNotification): Promise<void> {
    this.sheet.set(false);
    if (item.orderId) await this.router.navigate(['/sales', item.orderId]);
  }

  icon(kind: AppNotification['kind']): string {
    switch (kind) {
      case 'WEBSITE_AANVRAAG': return '↗';
      case 'LEVERTERMIJN': return '◷';
      case 'VRACHT': return '▤';
      case 'VOORSTEL': return '⇄';
      case 'GETEKEND': return '✓';
      case 'AFGEWEZEN': return '✕';
      default: return '◉';
    }
  }
}
