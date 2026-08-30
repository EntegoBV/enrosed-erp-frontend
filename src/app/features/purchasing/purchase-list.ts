import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { SourcingApi } from '../../core/api/sourcing-api';
import { PurchaseOrderView, Supplier } from '../../core/api/models';
import { PageHeader } from '../../shared/page-header';
import { containerLabel } from '../../core/api/geo';
import { escapeHtml, Sheet, Ui } from '../../shared/ui';
import { Skeleton } from '../../shared/skeleton';
import { CbmPipe, DateNlPipe, EurPipe, NumPipe } from '../../shared/pipes';
import { messageOf } from '../../core/api/errors';
import { SupplierAddress } from '../../shared/supplier-address';
import { Auth } from '../../core/api/auth';

const PURCHASE_STATUS_LABEL: Record<string, string> = {
  CONCEPT: 'Concept', BESTELD: 'Besteld', ONDERWEG: 'Vertrokken', ONTVANGEN: 'Ontvangen',
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
      <!-- One compact pill instead of a rail of chips: the native picker
           opens on tap, the pill just shows where you stand. -->
      <div class="po-filterbar">
        <div class="po-filter" [class.po-filter--on]="statusFilter() !== 'ALL'">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4" /></svg>
          <span>{{ statusFilterLabel() }}</span>
          <select class="po-filter__native" aria-label="Filter op status"
                  [ngModel]="statusFilter()" (ngModelChange)="statusFilter.set($event)">
            @for (option of statusOptions; track option.key) {
              <option [value]="option.key">{{ option.label }}{{ countFor(option.key) ? ' (' + countFor(option.key) + ')' : '' }}</option>
            }
          </select>
        </div>
        <span class="tiny muted">{{ filtered().length }} van {{ orders().length }}</span>
      </div>

      @for (group of supplierSections(); track group.supplierId) {
        <!-- One block per supplier: with many orders coming, the name on
             top reads faster than a name on every row. -->
        <section class="section po-supplier">
          <h2 class="section-head">
            <span>{{ group.name }}</span>
            <small>{{ group.rows.length }} order{{ group.rows.length === 1 ? '' : 's' }}</small>
          </h2>
          <div class="card"><div class="list">
        @for (row of group.rows; track row.order.id) {
          <!-- iOS pattern, also with a mouse or trackpad: drag or scroll the
               row hard to the left and the delete confirm comes up itself;
               a softer swipe only reveals the button. No standing bin. -->
          <div class="swipe"
               [class.swipe--open]="swiped() === row.order.id"
               [class.swipe--dragging]="draggingOrderId() === row.order.id"
               [style.--swipe-offset]="draggingOrderId() === row.order.id ? swipeOffset() + 'px' : null">
            <a class="list-item swipe__row" [routerLink]="['/purchasing', row.order.id]"
               (pointerdown)="startSwipe($event, row)"
               (pointermove)="moveSwipe($event, row)"
               (pointerup)="finishSwipe($event, row)"
               (pointercancel)="cancelSwipe($event)"
               (wheel)="wheelSwipe($event, row)"
               (dragstart)="$event.preventDefault()"
               (click)="blockWhenSwiped($event)">
            <div class="list-item__body">
              <!-- The nickname or the supplier leads; the number is the small
                   print. A phone has no room for both on one line. -->
              <!-- The supplier already heads the block; the row leads with
                   its own identity: the nickname or the number. -->
              <div class="list-item__title">{{ row.order.alias || row.order.number }}</div>
              <div class="list-item__meta">
                {{ creatorName(row) }} · {{ row.order.orderDate | dateNl }}
                @if (row.order.alias) { · <b class="po-row__number">{{ row.order.number }}</b> }
              </div>
              <div class="list-item__meta hide-mobile">
                {{ containerLabel(row.order.containerType) }} ·
                {{ row.costing.totals.cartons | num }} kartons ·
                {{ row.costing.totals.cbm | cbm }}
              </div>
              @if (row.attention?.length) {
                <div class="po-attn-line" [attr.title]="row.attention!.join(' · ')">
                  <b>{{ row.attention!.length }}</b>
                  <span>{{ row.attention![0] }}{{ row.attention!.length > 1 ? ' · +' + (row.attention!.length - 1) : '' }}</span>
                </div>
              }
            </div>
            <!-- The right edge belongs to figure and status alone; what
                 still needs you gets its own amber line under the row. -->
            <div class="list-item__end po-row-end">
              <div class="strong num">{{ row.costing.totals.totalEur | eur: 0 }}</div>
              <span class="po-status-mini" [class]="'po-status-mini ' + statusMiniClass(row.order.status)">
                <i aria-hidden="true"></i>{{ statusLabel(row.order.status) }}
              </span>
            </div>
            <span class="list-item__chev">›</span>
            </a>
            @if (row.order.status !== 'ONTVANGEN') {
              <button class="swipe__delete" type="button" (click)="remove(row.order.id, row.order.number)"
                      [disabled]="deletingOrderId() === row.order.id"
                      [attr.aria-busy]="deletingOrderId() === row.order.id"
                      [attr.aria-label]="'Inkooporder ' + row.order.number + ' verwijderen'"
                      title="Inkooporder verwijderen">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
                     stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
                     aria-hidden="true" focusable="false">
                  <path d="M4 7h16" /><path d="M9 7V5h6v2" />
                  <path d="M6.5 7l1 13h9l1-13" /><path d="M10 11v6" /><path d="M14 11v6" />
                </svg>
              </button>
            }
          </div>
        }
          </div></div>
        </section>
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
          @if (chosenSupplier(); as supplier) {
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
          <p class="po-creator-note">
            <span aria-hidden="true">●</span>
            Aangemeld als <b>{{ auth.username() || 'onbekend' }}</b> · wordt als maker opgeslagen
          </p>
        </div>
        <div foot style="display:contents">
          <button class="btn" type="button" (click)="picking.set(false)">Annuleren</button>
          <button class="btn btn--primary" type="button" (click)="create()">Aanmaken</button>
        </div>
      </app-sheet>
    }
  `,
  styles: [`
    .po-supplier + .po-supplier { margin-top: 16px; }
    .po-filterbar { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .po-filter { position: relative; display: inline-flex; align-items: center; gap: 7px; min-height: 36px;
      padding: 0 12px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface);
      color: var(--ink-2); font-size: 12.5px; font-weight: 650; }
    .po-filter--on { border-color: var(--rose-line); background: var(--rose-soft); color: var(--rose-dark); }
    .po-filter svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.8;
      stroke-linecap: round; }
    .po-filter__native { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; font-size: 16px; }
    .po-row-end { display: grid; justify-items: end; gap: 3px; }
    .po-status-mini { display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px;
      border-radius: 999px; background: color-mix(in srgb, currentColor 10%, transparent);
      font-size: 10.5px; font-weight: 750; white-space: nowrap; }
    .po-status-mini i { width: 6px; height: 6px; flex: none; border-radius: 50%; background: currentColor; }
    .po-status-mini--ok { color: var(--ok); }
    .po-status-mini--warn { color: var(--warn); }
    .po-status-mini--rose { color: var(--rose-dark); }
    .po-status-mini--muted { color: var(--muted); }
    .po-attn-line { display: flex; align-items: center; gap: 6px; margin-top: 5px; min-width: 0; }
    .po-attn-line b { display: inline-grid; place-items: center; flex: none; min-width: 16px; height: 16px;
      padding: 0 4px; border-radius: 999px; background: var(--warn); color: #fff; font-size: 9.5px; font-weight: 800; }
    .po-attn-line span { overflow: hidden; color: var(--warn); font-size: 11px; font-weight: 650;
      text-overflow: ellipsis; white-space: nowrap; }
    .section-head { display: flex; align-items: baseline; gap: 8px; margin: 14px 0 8px 4px;
      color: var(--ink-2); font-size: 11.5px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    .section-head small { color: var(--muted); font-size: 11px; font-weight: 650; letter-spacing: 0; }
    .swipe--dragging { user-select: none; }
    .swipe--dragging .swipe__row { transform: translateX(var(--swipe-offset, 0px)); transition: none; }
    .swipe__row { touch-action: pan-y; }
    .po-row__number { color: var(--ink-2); font-weight: 650; }
    .chip-rail { display: flex; gap: 6px; overflow-x: auto; padding: 2px 0 6px; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
    .chip-rail::-webkit-scrollbar { display: none; }
    .chip { display: inline-flex; align-items: center; gap: 5px; flex: none; min-height: 34px; padding: 0 12px;
      border: 1px solid var(--line); border-radius: 999px; background: var(--surface); color: var(--ink-2);
      font: inherit; font-size: 13px; font-weight: 650; cursor: pointer; -webkit-tap-highlight-color: transparent; }
    .chip small { color: var(--muted); font-size: 11px; font-weight: 650; }
    .chip--on { border-color: var(--rose); background: var(--rose-soft); color: var(--rose-dark); }
    .chip--on small { color: var(--rose-dark); }
    .list-item__status { display: inline-flex; align-items: center; justify-content: flex-end; gap: 6px; }
    .attention-dot { display: inline-grid; place-items: center; min-width: 20px; height: 20px; padding: 0 5px;
      border-radius: 999px; background: var(--warn); color: #fff; font-size: 11px; font-weight: 800;
      line-height: 1; cursor: help; }
    .chosen-supplier{display:grid;grid-template-columns:36px minmax(0,1fr);gap:9px;margin:0 0 14px;padding:10px;border:1px solid var(--line);border-radius:13px;background:var(--surface-2)}
    .chosen-supplier__mark{display:grid;width:36px;height:36px;place-items:center;border-radius:10px;background:var(--rose-soft);color:var(--rose-dark);font-weight:760;text-transform:uppercase}
    .chosen-supplier__copy{display:flex;min-width:0;flex-direction:column}.chosen-supplier__copy strong{overflow:hidden;font-size:12px;text-overflow:ellipsis;white-space:nowrap}.chosen-supplier__copy small{color:var(--muted);font-size:9.5px}
    .po-creator-note{display:flex;align-items:center;gap:6px;margin-top:10px;color:var(--muted);font-size:11.5px}.po-creator-note span{color:var(--ok);font-size:7px}.po-creator-note b{color:var(--ink-2)}
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
  readonly auth = inject(Auth);

  readonly orders = signal<PurchaseOrderView[]>([]);
  readonly statusOptions: { key: string; label: string }[] = [
    { key: 'ALL', label: 'Alle' }, { key: 'CONCEPT', label: 'Concept' }, { key: 'BESTELD', label: 'Besteld' },
    { key: 'ONDERWEG', label: 'Vertrokken' }, { key: 'ONTVANGEN', label: 'Ontvangen' }, { key: 'ATTENTION', label: 'Actie vereist' },
  ];
  readonly statusFilter = signal('ALL');
  private readonly statusCounts = computed(() => {
    const counts = new Map<string, number>();
    let attention = 0;
    for (const row of this.orders()) {
      counts.set(row.order.status, (counts.get(row.order.status) ?? 0) + 1);
      if (row.attention?.length) attention++;
    }
    counts.set('ATTENTION', attention);
    return counts;
  });
  readonly filtered = computed(() => {
    const key = this.statusFilter();
    const rows = key === 'ALL' ? this.orders()
      : key === 'ATTENTION' ? this.orders().filter((row) => row.attention?.length)
      : this.orders().filter((row) => row.order.status === key);
    /* Newest first: the order you placed this week is the one you want. */
    return rows.slice().sort((a, b) => b.order.orderDate.localeCompare(a.order.orderDate)
      || (b.order.id ?? 0) - (a.order.id ?? 0));
  });

  /** One block per supplier, ordered by whoever has the newest order. */
  readonly supplierSections = computed(() => {
    const groups = new Map<number, { supplierId: number; name: string; rows: PurchaseOrderView[] }>();
    for (const row of this.filtered()) {
      const id = row.order.supplierId;
      let group = groups.get(id);
      if (!group) {
        group = { supplierId: id, name: this.supplierName(id), rows: [] };
        groups.set(id, group);
      }
      group.rows.push(row);
    }
    return [...groups.values()];
  });

  statusMiniClass(status: string): string {
    return status === 'ONTVANGEN' ? 'po-status-mini--ok'
      : status === 'ONDERWEG' ? 'po-status-mini--warn'
      : status === 'BESTELD' ? 'po-status-mini--rose' : 'po-status-mini--muted';
  }

  readonly statusFilterLabel = computed(() =>
    this.statusOptions.find((option) => option.key === this.statusFilter())?.label ?? 'Alle');
  countFor(key: string): number {
    if (key === 'ALL') return 0;
    return this.statusCounts().get(key) ?? 0;
  }
  readonly suppliers = signal<Supplier[]>([]);
  private readonly supplierById = computed(() =>
    new Map(this.suppliers().map((supplier) => [supplier.id, supplier])));
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
    return this.supplierById().get(id)?.name ?? 'Onbekend';
  }

  creatorName(row: PurchaseOrderView): string {
    return row.createdBy?.displayName || 'Maker onbekend';
  }

  readonly chosenSupplier = computed(() => {
    const id = this.chosen();
    return id === null ? null : this.supplierById().get(id) ?? null;
  });

  /** Which row shows its delete button; only one at a time, like iOS. */
  readonly swiped = signal<number | null>(null);
  readonly draggingOrderId = signal<number | null>(null);
  readonly swipeOffset = signal(0);
  readonly deletingOrderId = signal<number | null>(null);
  private swipeHandled = false;
  private pointerSwipe: { pointerId: number; orderId: number; startX: number; startY: number;
    startOffset: number; horizontal: boolean; row: HTMLElement } | null = null;
  private swipeResetTimer: ReturnType<typeof setTimeout> | null = null;
  /* Trackpads swipe with a horizontal scroll: gathered per gesture. */
  private wheelTotal = 0;
  private wheelOrderId: number | null = null;
  private wheelTimer: ReturnType<typeof setTimeout> | null = null;

  startSwipe(event: PointerEvent, row: PurchaseOrderView): void {
    if (row.order.status === 'ONTVANGEN' || row.order.id === null
        || !event.isPrimary || event.button !== 0) return;
    if (this.swipeResetTimer !== null) clearTimeout(this.swipeResetTimer);
    this.swipeHandled = false;
    if (this.swiped() !== null && this.swiped() !== row.order.id) this.swiped.set(null);
    const target = event.currentTarget as HTMLElement;
    this.pointerSwipe = {
      pointerId: event.pointerId, orderId: row.order.id,
      startX: event.clientX, startY: event.clientY,
      startOffset: this.swiped() === row.order.id ? -76 : 0,
      horizontal: false, row: target,
    };
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      this.pointerSwipe = null;
    }
  }

  moveSwipe(event: PointerEvent, row: PurchaseOrderView): void {
    const active = this.pointerSwipe;
    if (!active || active.pointerId !== event.pointerId || active.orderId !== row.order.id) return;
    const dx = event.clientX - active.startX;
    const dy = event.clientY - active.startY;
    if (!active.horizontal) {
      if (Math.hypot(dx, dy) < 8) return;
      if (Math.abs(dx) <= Math.abs(dy) * 1.2) return;
      active.horizontal = true;
      this.swipeHandled = true;
      this.draggingOrderId.set(active.orderId);
    }
    event.preventDefault();
    event.stopPropagation();
    this.swipeOffset.set(Math.max(-150, Math.min(0, active.startOffset + dx)));
  }

  finishSwipe(event: PointerEvent, row: PurchaseOrderView): void {
    const active = this.pointerSwipe;
    if (!active || active.pointerId !== event.pointerId) return;
    if (active.horizontal) {
      event.preventDefault();
      event.stopPropagation();
      const offset = this.swipeOffset();
      /* Dragged well past the button: that is the delete itself, iOS-Mail
         style. The confirm dialog still guards the actual delete. */
      if (offset <= -130) {
        this.swiped.set(null);
        this.remove(row.order.id, row.order.number);
      } else {
        this.swiped.set(offset <= -38 ? active.orderId : null);
      }
      this.deferSwipeClickRelease();
    }
    this.releaseSwipePointer(active);
    this.draggingOrderId.set(null);
    this.swipeOffset.set(0);
    this.pointerSwipe = null;
  }

  cancelSwipe(event: PointerEvent): void {
    const active = this.pointerSwipe;
    if (!active || active.pointerId !== event.pointerId) return;
    if (active.horizontal) this.deferSwipeClickRelease();
    else this.swipeHandled = false;
    this.releaseSwipePointer(active);
    this.draggingOrderId.set(null);
    this.swipeOffset.set(0);
    this.pointerSwipe = null;
  }

  /** A hard two-finger swipe on a trackpad reads as the same gesture. */
  wheelSwipe(event: WheelEvent, row: PurchaseOrderView): void {
    if (row.order.status === 'ONTVANGEN' || row.order.id === null) return;
    if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
    event.preventDefault();
    if (this.wheelOrderId !== row.order.id) { this.wheelOrderId = row.order.id; this.wheelTotal = 0; }
    this.wheelTotal += event.deltaX;
    if (this.wheelTimer !== null) clearTimeout(this.wheelTimer);
    this.wheelTimer = setTimeout(() => { this.wheelOrderId = null; this.wheelTotal = 0; }, 250);
    if (this.wheelTotal >= 130) {
      this.wheelOrderId = null; this.wheelTotal = 0;
      this.swiped.set(null);
      this.remove(row.order.id, row.order.number);
    } else if (this.wheelTotal >= 40) {
      this.swiped.set(row.order.id);
    } else if (this.wheelTotal <= -40) {
      this.swiped.set(null);
    }
  }

  private deferSwipeClickRelease(): void {
    if (this.swipeResetTimer !== null) clearTimeout(this.swipeResetTimer);
    this.swipeResetTimer = setTimeout(() => {
      this.swipeHandled = false;
      this.swipeResetTimer = null;
    }, 400);
  }

  private releaseSwipePointer(active: { pointerId: number; row: HTMLElement }): void {
    try {
      if (active.row.hasPointerCapture(active.pointerId)) {
        active.row.releasePointerCapture(active.pointerId);
      }
    } catch {
      /* A cancelled pointer has already been released by the browser. */
    }
  }

  /** A tap on a swiped-open row folds it back instead of navigating. */
  blockWhenSwiped(event: Event): void {
    if (this.swiped() !== null || this.swipeHandled) {
      event.preventDefault();
      event.stopPropagation();
      if (!this.swipeHandled) this.swiped.set(null);
    }
  }

  remove(id: number, number: string): void {
    if (this.deletingOrderId() !== null || this.ui.confirmRequest() !== null) return;
    const row = this.orders().find((candidate) => candidate.order.id === id);
    if (row?.order.status === 'ONTVANGEN') {
      this.swiped.set(null);
      this.ui.toast('Ontvangen inkooporders kunnen niet worden verwijderd', 'err');
      return;
    }
    this.ui.confirm(
      { title: 'Inkooporder verwijderen',
        message: `Inkooporder <b>${escapeHtml(number)}</b> definitief verwijderen?`
          + '<br><small>Dit kan niet ongedaan worden gemaakt.</small>',
        confirmLabel: 'Verwijderen', danger: true },
      async () => {
        this.deletingOrderId.set(id);
        try {
          await this.sourcing.deletePurchaseOrder(id);
          this.swiped.set(null);
          this.orders.update((orders) =>
            orders.filter((candidate) => candidate.order.id !== id));
          this.ui.toast('Inkooporder verwijderd');
        } catch (failure: unknown) {
          this.ui.toast(messageOf(failure, 'Verwijderen mislukt'), 'err');
        } finally {
          this.deletingOrderId.set(null);
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
