import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SalesApi } from '../../core/api/sales-api';
import type { SalesOrderView } from '../../core/api/models';
import { messageOf } from '../../core/api/errors';
import { fulfillmentStatusOf } from './quote-status';
import { WeekNlPipe } from '../../shared/pipes';

@Component({
  selector: 'app-sales-fulfillment-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, WeekNlPipe],
  template: `
    @if (view().fulfillment; as split) {
      <section class="fulfillment" aria-label="Gesplitste order">
        <div class="fulfillment__main">
          <div class="fulfillment__parts" aria-hidden="true"><span [class.active]="split.part === 1">1</span><i></i><span [class.active]="split.part === 2">2</span></div>
          <div class="fulfillment__copy"><small>Gesplitste order · deel {{ split.part }} van 2</small><h2>{{ split.part === 1 ? 'Eerste levering' : 'Nalevering' }}</h2>
            @if (status(); as state) { <span class="fulfillment__status" [class.fulfillment__status--waiting]="state.cls === 'gold'">{{ state.label }}</span> }
            @if (weeks().length) { <span class="fulfillment__week">@for (week of weeks(); track week) { {{ week | weekNl }}@if (!$last) { · } }</span> }
          </div>
          @if (split.siblingId) { <a class="fulfillment__sibling" [routerLink]="['/sales', split.siblingId]"><span>{{ split.part === 1 ? 'Naar nalevering' : 'Naar eerste levering' }}</span><small>{{ split.siblingNumber || 'Ander deel openen' }} ↗</small></a> }
        </div>
        @if (canPlan()) {
          <div class="fulfillment__action"><p>Is de voorraad binnen? Controleer de beschikbaarheid en plan dit deel in.</p><button type="button" class="btn btn--sm" [disabled]="busy() || blocked()" (click)="markReady()">{{ busy() ? 'Voorraad controleren…' : 'Klaar voor levering' }}</button></div>
          @if (blocked()) { <p class="fulfillment__hint">Sla openstaande wijzigingen eerst op.</p> }
        }
        @if (view().order.status === 'CONCEPT' && !view().order.archivedAt) { <p class="fulfillment__hint">Aantallen en staffels zijn vastgelegd. Transport en extra korting blijven aanpasbaar op dit concept.</p> }
        @if (error()) { <p class="fulfillment__error" role="alert">{{ error() }}</p> }
      </section>
    }
  `,
  styles: `
    :host { display:block;min-width:0 }
    .fulfillment { margin:0 0 16px;padding:17px 18px;border:1px solid var(--rose-line);border-radius:20px;background:linear-gradient(130deg,var(--surface),var(--rose-soft));color:var(--ink) }
    .fulfillment__main { display:flex;align-items:center;gap:14px;flex-wrap:wrap }
    .fulfillment__parts { display:flex;align-items:center;gap:4px;flex:none }
    .fulfillment__parts span { display:grid;place-items:center;width:28px;height:28px;border:1px solid var(--rose-line);border-radius:50%;font-size:12px;color:var(--muted);background:var(--surface) }
    .fulfillment__parts span.active { background:var(--rose);color:white;border-color:var(--rose) }
    .fulfillment__parts i { width:10px;height:1px;background:var(--rose-line) }
    .fulfillment__copy { flex:1;min-width:170px }
    .fulfillment__copy>small { color:var(--muted);font-size:10px }
    h2 { margin:4px 0 6px;font-size:17px;letter-spacing:-.02em }
    .fulfillment__status { font-size:11px;font-weight:650;color:var(--rose-dark) }
    .fulfillment__status--waiting { color:var(--warn) }
    .fulfillment__week { margin-left:10px;font-size:11px;color:var(--muted) }
    .fulfillment__sibling { display:grid;gap:5px;min-height:44px;align-content:center;padding:9px 12px;border:1px solid var(--line);border-radius:13px;background:var(--surface);color:var(--rose-dark);text-decoration:none;font-size:12px;font-weight:650 }
    .fulfillment__sibling small { color:var(--muted);font-size:10px;font-weight:400 }
    .fulfillment__action { display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;padding-top:12px;margin-top:13px;border-top:1px solid var(--rose-line) }
    .fulfillment__action p { flex:1;min-width:200px;margin:0;font-size:12px;line-height:1.5;color:var(--ink-2) }
    .fulfillment__action .btn { min-height:44px;margin:0;flex:none }
    .fulfillment__hint { margin:11px 0 0;color:var(--muted);font-size:11px;line-height:1.5 }
    .fulfillment__error { margin:12px 0 0;color:var(--danger);font-size:13px;line-height:1.5 }
    @media(max-width:679px) { .fulfillment { padding:15px;border-radius:19px }.fulfillment__parts { gap:3px }.fulfillment__copy { min-width:150px }.fulfillment__sibling { width:100%;grid-template-columns:1fr auto;align-items:center }.fulfillment__action .btn { width:100% } }
  `,
})
export class SalesFulfillmentCard {
  readonly view = input.required<SalesOrderView>();
  readonly blocked = input(false);
  readonly changed = output<SalesOrderView>();
  readonly busy = signal(false);
  readonly error = signal('');
  private readonly sales = inject(SalesApi);
  readonly status = computed(() => fulfillmentStatusOf(this.view()));
  readonly weeks = computed(() => [...new Set(this.view().order.lines.map(line => line.deliveryWeek).filter((week): week is string => !!week))]);
  readonly canPlan = computed(() => this.view().fulfillment?.status === 'WAITING_FOR_STOCK'
    && !this.view().order.archivedAt && !this.view().order.goodsShippedAt && !this.view().invoicedAsId && !this.view().invoicedAs
    && !['GEANNULEERD', 'AFGEWEZEN', 'VERLOPEN'].includes(this.view().order.status));

  async markReady(): Promise<void> {
    if (this.busy() || this.blocked() || !this.canPlan()) return;
    const id = this.view().order.id;
    this.busy.set(true); this.error.set('');
    try {
      const updated = await this.sales.markFulfillmentReady(id);
      if (this.view().order.id === id) this.changed.emit(updated);
    } catch (failure) {
      if (this.view().order.id === id) this.error.set(messageOf(failure, 'Beschikbaarheid controleren mislukt. Probeer opnieuw.'));
    } finally { this.busy.set(false); }
  }
}
