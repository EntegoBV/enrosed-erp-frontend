import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { SourcingApi } from '../../core/api/sourcing-api';
import { PurchaseOrderView, Supplier } from '../../core/api/models';
import { PageHeader } from '../../shared/page-header';
import { containerLabel } from '../../core/api/geo';
import { Privacy } from '../../core/api/privacy';
import { Sheet, Ui } from '../../shared/ui';
import { Skeleton } from '../../shared/skeleton';
import { CbmPipe, DateNlPipe, EurPipe, NumPipe } from '../../shared/pipes';
import { messageOf } from '../../core/api/errors';
import { SupplierAddress } from '../../shared/supplier-address';

const PURCHASE_STATUS_LABEL: Record<string, string> = {
  CONCEPT: 'Concept', BESTELD: 'Besteld', ONDERWEG: 'Onderweg', ONTVANGEN: 'Ontvangen',
};

@Component({
  selector: 'app-purchase-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, FormsModule, PageHeader, Sheet, Skeleton, SupplierAddress,
            EurPipe, NumPipe, CbmPipe, DateNlPipe],
  template: `
    <app-page-header title="Inkoop" [subtitle]="orders().length + ' containercalculaties'">
      <button class="btn btn--primary btn--sm hide-mobile" type="button" (click)="startNew()">
        + Nieuw
      </button>
    </app-page-header>

    <div class="content">
      @if (privacy.showPurchase()) {
        <div class="alert alert--info">
          <span class="alert__icon">ℹ</span>
          <div>
            Inkoop gaat per container. Hier wordt de <b>kostprijs per stuk</b> berekend: EXW in
            USD of RMB, plus lokale kosten in China, zeevracht, invoerrechten per HS-code en de
            kosten vanaf de aankomsthaven.
          </div>
        </div>
      } @else {
        <div class="alert alert--ok">
          <span class="alert__icon">✓</span>
          <div>
            <b>Klantveilige weergave.</b> Alle inkoopbedragen, wisselkoersen en kostprijzen
            zijn verborgen. Orderstatus, planning, aantallen en containervulling blijven zichtbaar.
          </div>
        </div>
      }

      <div class="card mt-12"><div class="list">
        @for (row of orders(); track row.order.id) {
          <!-- iOS pattern: swipe the row left to reveal delete - no need to
               open a calculation just to get rid of it. -->
          <div class="swipe swipe--desktop-action"
               [class.swipe--open]="swiped() === row.order.id">
            <a class="list-item swipe__row" [routerLink]="['/purchasing', row.order.id]"
               (touchstart)="row.order.status !== 'ONTVANGEN' && swipeStart($event, row.order.id)"
               (touchmove)="row.order.status !== 'ONTVANGEN' && swipeMove($event, row.order.id)"
               (touchend)="swipeEnd()"
               (click)="blockWhenSwiped($event)">
            <div class="list-item__body">
              <div class="list-item__title">
                @if (row.order.alias) {
                  {{ row.order.alias }}
                  <span class="muted small">· {{ row.order.number }}</span>
                } @else {
                  {{ row.order.number }} — {{ supplierName(row.order.supplierId) }}
                }
              </div>
              <div class="list-item__meta">
                {{ row.order.orderDate | dateNl }} · {{ containerLabel(row.order.containerType) }} ·
                {{ row.costing.totals.cartons | num }} kartons ·
                {{ row.costing.totals.cbm | cbm }}
              </div>
            </div>
            <div class="list-item__end">
              @if (privacy.showPurchase()) {
                <div class="strong num">{{ row.costing.totals.totalEur | eur: 0 }}</div>
              }
              <span class="badge badge--neutral">{{ statusLabel(row.order.status) }}</span>
              @if (!privacy.showPurchase()) {
                <div class="tiny muted">bedragen verborgen</div>
              }
            </div>
            <span class="list-item__chev">›</span>
            </a>
            @if (row.order.status !== 'ONTVANGEN') {
              <button class="swipe__delete" type="button" (click)="remove(row.order.id, row.order.number)"
                      [attr.aria-label]="'Inkooporder ' + row.order.number + ' verwijderen'"
                      title="Calculatie verwijderen">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
                     stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
                     aria-hidden="true" focusable="false">
                  <path d="M4 7h16" /><path d="M9 7V5h6v2" />
                  <path d="M6.5 7l1 13h9l1-13" /><path d="M10 11v6" /><path d="M14 11v6" />
                </svg>
              </button>
            }
          </div>
        } @empty {
          @if (loading()) {
            <app-skeleton kind="list" [rows]="4" />
          } @else {
          <div class="empty">
            <div class="empty__icon">▩</div>
            <div class="empty__title">Nog geen inkooporders</div>
            @if (!loading()) {
              <button class="btn btn--primary" type="button" (click)="startNew()">
                Nieuwe calculatie
              </button>
            }
          </div>
          }
        }
      </div></div>
    </div>

    <button class="fab" type="button" (click)="startNew()">+ Calculatie</button>

    @if (picking()) {
      <app-sheet title="Nieuwe inkoopcalculatie" (closed)="picking.set(false)">
        <div body>
          <div class="field">
            <label for="po-supplier">Leverancier</label>
            <select class="select" id="po-supplier" [ngModel]="chosen()"
                    (ngModelChange)="chosen.set(+$event)">
              @for (supplier of suppliers(); track supplier.id) {
                <option [ngValue]="supplier.id">{{ supplier.name }} ({{ supplier.currency }})</option>
              }
            </select>
          </div>
          @if (privacy.showPurchase() && chosenSupplier(); as supplier) {
            <div class="chosen-supplier" aria-label="Gekozen leverancier">
              <span class="chosen-supplier__mark" aria-hidden="true">
                {{ supplier.name.charAt(0) || '?' }}
              </span>
              <span class="chosen-supplier__copy">
                <strong>{{ supplier.name }}</strong>
                <app-supplier-address [supplier]="supplier" [inline]="true" />
                <small>
                  {{ supplier.incoterm || 'Geen incoterm' }}
                  @if (supplier.portOfLoading) { · {{ supplier.portOfLoading }} }
                </small>
              </span>
            </div>
          }
          @if (privacy.showPurchase()) {
            <div class="field-row">
              <div class="field"><label for="po-cny">Koers RMB → USD</label>
                <input class="input num right" id="po-cny" type="number" step="0.0001"
                       [ngModel]="cnyToUsd()" (ngModelChange)="cnyToUsd.set(+$event)" /></div>
              <div class="field"><label for="po-usd">Koers USD → EUR</label>
                <input class="input num right" id="po-usd" type="number" step="0.0001"
                       [ngModel]="usdToEur()" (ngModelChange)="usdToEur.set(+$event)" /></div>
            </div>
            <p class="small muted">
              De koersen worden op de order vastgeklikt, zodat een oude calculatie niet verandert
              als de koers beweegt.
            </p>
          } @else {
            <div class="alert alert--ok">
              <span class="alert__icon">✓</span>
              <div>De calculatie wordt met de interne standaardkoersen aangemaakt; bedragen blijven verborgen.</div>
            </div>
          }
        </div>
        <div foot style="display:contents">
          <button class="btn" type="button" (click)="picking.set(false)">Annuleren</button>
          <button class="btn btn--primary" type="button" (click)="create()">Aanmaken</button>
        </div>
      </app-sheet>
    }
  `,
  styles: [`
    .chosen-supplier{display:grid;grid-template-columns:36px minmax(0,1fr);gap:9px;margin:0 0 14px;padding:10px;border:1px solid var(--line);border-radius:13px;background:var(--surface-2)}
    .chosen-supplier__mark{display:grid;width:36px;height:36px;place-items:center;border-radius:10px;background:var(--rose-soft);color:var(--rose-dark);font-weight:760;text-transform:uppercase}
    .chosen-supplier__copy{display:flex;min-width:0;flex-direction:column}.chosen-supplier__copy strong{overflow:hidden;font-size:12px;text-overflow:ellipsis;white-space:nowrap}.chosen-supplier__copy small{color:var(--muted);font-size:9.5px}
  `],
})
export class PurchaseList {
  statusLabel(status: string): string {
    return PURCHASE_STATUS_LABEL[status] ?? status;
  }

  readonly containerLabel = containerLabel;

  private readonly sourcing = inject(SourcingApi);
  private readonly router = inject(Router);
  private readonly ui = inject(Ui);
  readonly privacy = inject(Privacy);

  readonly orders = signal<PurchaseOrderView[]>([]);
  readonly suppliers = signal<Supplier[]>([]);
  readonly loading = signal(true);
  readonly picking = signal(false);
  readonly chosen = signal<number | null>(null);
  readonly cnyToUsd = signal(0.1385);
  readonly usdToEur = signal(0.89);

  constructor() { void this.load(); }

  private async load(): Promise<void> {
    const [orders, suppliers] = await Promise.all([
      this.sourcing.purchaseOrders(), this.sourcing.suppliers()]);
    this.orders.set(orders);
    this.suppliers.set(suppliers);
    this.chosen.set(suppliers[0]?.id ?? null);
    this.loading.set(false);
    if (this.picking() && !suppliers.length) {
      this.picking.set(false);
      this.ui.toast('Maak eerst een leverancier aan', 'err');
    }
  }

  supplierName(id: number): string {
    return this.suppliers().find((supplier) => supplier.id === id)?.name ?? 'Onbekend';
  }

  chosenSupplier(): Supplier | null {
    return this.suppliers().find((supplier) => supplier.id === this.chosen()) ?? null;
  }

  /** Which row shows its delete button; only one at a time, like iOS. */
  readonly swiped = signal<number | null>(null);
  private touchX = 0;
  private touchY = 0;
  private swipeHandled = false;

  swipeStart(event: TouchEvent, id: number): void {
    this.touchX = event.touches[0].clientX;
    this.touchY = event.touches[0].clientY;
    this.swipeHandled = false;
    if (this.swiped() !== null && this.swiped() !== id) this.swiped.set(null);
  }

  swipeMove(event: TouchEvent, id: number): void {
    if (this.swipeHandled) return;
    const dx = event.touches[0].clientX - this.touchX;
    const dy = event.touches[0].clientY - this.touchY;
    if (Math.abs(dx) < Math.abs(dy) * 1.5) return;
    /* A committed swipe acts as the button press itself, iOS-Mail style;
       the confirm dialog still guards the actual delete. */
    if (dx < -140) {
      this.swipeHandled = true;
      const row = this.orders().find((candidate) => candidate.order.id === id);
      if (row) this.remove(id, row.order.number);
      return;
    }
    if (dx < -24) { this.swiped.set(id); return; }
    if (dx > 24) { this.swipeHandled = true; this.swiped.set(null); }
  }

  swipeEnd(): void { /* the decision falls in swipeMove */ }

  /** A tap on a swiped-open row folds it back instead of navigating. */
  blockWhenSwiped(event: Event): void {
    if (this.swiped() !== null || this.swipeHandled) {
      event.preventDefault();
      event.stopPropagation();
      if (!this.swipeHandled) this.swiped.set(null);
    }
  }

  remove(id: number, number: string): void {
    const row = this.orders().find((candidate) => candidate.order.id === id);
    if (row?.order.status === 'ONTVANGEN') {
      this.swiped.set(null);
      this.ui.toast('Ontvangen inkooporders kunnen niet worden verwijderd', 'err');
      return;
    }
    this.ui.confirm(
      { title: 'Calculatie verwijderen',
        message: `Inkooporder <b>${number}</b> verwijderen?`,
        confirmLabel: 'Verwijderen', danger: true },
      async () => {
        try {
          await this.sourcing.deletePurchaseOrder(id);
          this.swiped.set(null);
          this.orders.update((orders) =>
            orders.filter((candidate) => candidate.order.id !== id));
          this.ui.toast('Calculatie verwijderd');
        } catch (failure: unknown) {
          this.ui.toast(messageOf(failure, 'Verwijderen mislukt'), 'err');
        }
      });
  }

  startNew(): void {
    /* Only judge the supplier list once it is actually loaded - an
       in-flight empty list is not "no suppliers". */
    if (!this.loading() && !this.suppliers().length) {
      this.ui.toast('Maak eerst een leverancier aan', 'err');
      return;
    }
    this.picking.set(true);
  }

  async create(): Promise<void> {
    const supplierId = this.chosen();
    if (supplierId === null) return;
    const view = await this.sourcing.createPurchaseOrder(
      supplierId, this.cnyToUsd(), this.usdToEur(), 10);
    this.picking.set(false);
    await this.router.navigate(['/purchasing', view.order.id, 'edit']);
  }
}
