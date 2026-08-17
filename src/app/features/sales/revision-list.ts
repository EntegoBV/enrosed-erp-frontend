import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SalesApi } from '../../core/api/sales-api';
import { QuoteRevision, SalesOrderView } from '../../core/api/models';
import { PageHeader } from '../../shared/page-header';
import { DateNlPipe, NumPipe } from '../../shared/pipes';

/** Wijzigingsvoorstellen van klanten die op onze beoordeling wachten. */
@Component({
  selector: 'app-revision-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PageHeader, NumPipe, DateNlPipe],
  template: `
    <app-page-header title="Wijzigingen"
                     [subtitle]="revisions().length + ' voorstel(len) in behandeling'" />

    <div class="content">
      <div class="alert alert--info">
        <span class="alert__icon">ℹ</span>
        <div>
          Een klant kan een offerte niet zelf aanpassen. Hij stelt een wijziging voor en die
          komt hier terecht: pas wanneer jij ze overneemt gaan de aantallen naar de order.
        </div>
      </div>

      <div class="card mt-12">
        <div class="list">
          @for (revision of revisions(); track revision.id) {
            <a class="list-item" [routerLink]="['/sales', revision.salesOrderId]">
              <div class="list-item__body">
                <div class="list-item__title">
                  {{ orderNumber(revision.salesOrderId) }} —
                  {{ revision.proposedBy || 'de klant' }}
                </div>
                <div class="list-item__meta">{{ revision.message }}</div>
                <div class="list-item__meta">
                  {{ revision.proposedAt | dateNl }} ·
                  {{ revision.lines.length | num }} regel(s)
                </div>
              </div>
              <span class="badge badge--gold">wacht</span>
              <span class="list-item__chev">›</span>
            </a>
          } @empty {
            <div class="empty">
              <div class="empty__icon">⇄</div>
              <div class="empty__title">
                {{ loading() ? 'Laden…' : 'Geen openstaande voorstellen' }}
              </div>
              <div class="empty__text">
                Zodra een klant een wijziging voorstelt verschijnt die hier.
              </div>
            </div>
          }
        </div>
      </div>
    </div>
  `,
})
export class RevisionList {
  private readonly sales = inject(SalesApi);

  readonly revisions = signal<QuoteRevision[]>([]);
  readonly orders = signal<SalesOrderView[]>([]);
  readonly loading = signal(true);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    const [revisions, orders] = await Promise.all([
      this.sales.pendingRevisions(), this.sales.orders(),
    ]);
    this.revisions.set(revisions);
    this.orders.set(orders);
    this.loading.set(false);
  }

  orderNumber(orderId: number): string {
    return this.orders().find((row) => row.order.id === orderId)?.order.number ?? '#' + orderId;
  }
}
