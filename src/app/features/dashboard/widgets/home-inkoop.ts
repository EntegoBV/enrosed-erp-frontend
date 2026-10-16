import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { PurchaseOrderView } from '../../../core/api/models';
import { containerName } from '../../purchasing/container-name';
import { HomeData } from '../home-data';
import { nextContainerEvents } from '../home-figures';
import { HomeWidget, amount, count, counted } from './home-w';

interface Group { eur: number; pieces: number; orders: number; }

const groupOf = (rows: readonly PurchaseOrderView[]): Group => ({
  eur: rows.reduce((sum, row) => sum + row.costing.totals.totalEur, 0),
  pieces: rows.reduce((sum, row) => sum + row.costing.totals.pieces, 0),
  orders: rows.length,
});

/**
 * Inkoop & containers (spec-home §6.3): what is ordered and on its way (€,
 * pieces, orders, the old "Inkoop onderweg"), the next three expected
 * arrivals with a progress line from the order or sailing day, and Besteld ·
 * Op zee · Controleren. Every container is named by containerName(); each
 * arrival row opens its order.
 */
@Component({
  selector: 'app-home-inkoop',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, HomeWidget],
  template: `
    <app-home-w [variant]="variant()" kind="inkoop" title="Inkoop & containers" sub="besteld en onderweg" icon="purchase" tone="amber"
                link="/analyses/purchasing" [wide]="true" [state]="state()">
      @if (state() === 'ready') {
        @if (incoming().orders) {
          <div class="home-w__lead">
            <span class="home-w__value">{{ whole(incoming().eur) }}</span>
            <span class="home-w__line">{{ count(incoming().pieces) }} st · {{ counted(incoming().orders, 'order', 'orders') }}</span>
          </div>
          @if (events().length) {
            <ul class="home-w__events">
              @for (event of events(); track event.orderId) {
                <li>
                  <a class="home-w__event home-w__raise" [routerLink]="['/purchasing', event.orderId]"
                     [attr.aria-label]="event.label + ', ' + event.supplier + ', ' + event.text">
                    <span class="home-w__event-name"><b>{{ event.label }}</b>@if (event.supplier) { · {{ event.supplier }} }</span>
                    <span class="home-w__event-when" [class.is-late]="event.late">{{ event.text }}</span>
                    <span class="home-w__progress" aria-hidden="true"><i [style.width.%]="event.progressPct"></i></span>
                  </a>
                </li>
              }
            </ul>
          }
        } @else {
          <p class="home-w__empty">Geen containers besteld of onderweg</p>
        }
        <div class="home-w__figs home-w__figs--3">
          <div class="home-w__fig"><span class="home-w__fig-label">Besteld</span><strong class="home-w__fig-value">{{ whole(ordered().eur) }}</strong>
            <span class="home-w__fig-sub">{{ counted(ordered().orders, 'order', 'orders') }} · {{ count(ordered().pieces) }} st</span></div>
          <div class="home-w__fig"><span class="home-w__fig-label">Op zee</span><strong class="home-w__fig-value">{{ whole(atSea().eur) }}</strong>
            <span class="home-w__fig-sub">{{ counted(atSea().orders, 'order', 'orders') }} · {{ count(atSea().pieces) }} st</span></div>
          <div class="home-w__fig" [class.is-warn]="data.purchaseAttention().length > 0"><span class="home-w__fig-label">Controleren</span>
            <strong class="home-w__fig-value">{{ counted(data.purchaseAttention().length, 'order', 'orders') }}</strong>
            <span class="home-w__fig-sub">ontbrekende gegevens</span></div>
        </div>
      }
    </app-home-w>
  `,
})
export class HomeInkoop {
  readonly data = inject(HomeData);
  readonly variant = input<'desk' | 'phone'>('desk');
  readonly state = computed(() => this.data.combined('inkoop'));
  readonly whole = amount;
  readonly count = count;
  readonly counted = counted;

  private readonly open = computed(() => this.data.purchases().filter((row) => row.order.status === 'BESTELD' || row.order.status === 'ONDERWEG'));
  readonly incoming = computed(() => groupOf(this.open()));
  readonly ordered = computed(() => groupOf(this.open().filter((row) => row.order.status === 'BESTELD')));
  readonly atSea = computed(() => groupOf(this.open().filter((row) => row.order.status === 'ONDERWEG')));
  readonly events = computed(() => nextContainerEvents(this.data.milestones(), this.open().map((row) => ({
    orderId: row.order.id, label: containerName(row.order), supplier: this.data.supplierNames().get(row.order.supplierId) ?? '',
    status: row.order.status, orderDate: row.order.orderDate || null, shippedOn: row.order.shippedOn ?? null,
  })), this.data.today(), 3));
}
