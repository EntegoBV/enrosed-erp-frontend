import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { ContainerTrackingApi } from '../../core/api/container-tracking-api';
import type { ContainerTracking, ContainerTrackingFeed } from '../../core/api/container-tracking-models';
import { messageOf } from '../../core/api/errors';
import { Sheet } from '../../shared/ui';
import { LoadError } from '../../shared/load-error';
import { Skeleton } from '../../shared/skeleton';
import { ContainerTrackingPanel } from './container-tracking-panel';
import { purchaseTrackingRow, purchaseTrackingScope } from './purchase-tracking-model';

/** Saved tracking stays separate from the purchase editor and its unsaved changes. */
@Component({
  selector: 'app-purchase-tracking',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ContainerTrackingPanel, Sheet, LoadError, Skeleton],
  template: `
    @if (opened() && active()) {
      <app-sheet title="Track &amp; trace" variant="ios" [wide]="true" (closed)="closeDetails()">
        <div body class="purchase-track__body">
          @if (row(); as item) {
            @if (error(); as failure) {
              <div class="purchase-track__notice" role="status">
                <span>De laatste opgeslagen tracking blijft zichtbaar. {{ failure }}</span>
                <button type="button" class="wk-link" [disabled]="loading() || panelBusy()" (click)="reload()">Opnieuw proberen</button>
              </div>
            }
            @for (key of [scope()]; track key) {
              <app-container-tracking-panel [row]="item" [configured]="feed()?.configured ?? false"
                [intervalHours]="feed()?.intervalHours ?? 6" [showOrderLink]="false"
                (busyChange)="panelBusyChanged($event)" (rowUpdated)="rowUpdated($event)" />
            }
          } @else if (loading()) {
            <app-skeleton kind="card" [rows]="3" />
          } @else if (error(); as failure) {
            <app-load-error title="Tracking kon niet worden geladen" [message]="failure" [busy]="loading()" (retry)="reload()" />
          } @else {
            <div class="purchase-track__empty">
              <strong>Nog geen trackinggegevens</strong>
              <p>Voor deze opgeslagen referentie is nog geen tracking beschikbaar.</p>
              <button type="button" class="wk-btn wk-btn--sm" (click)="reload()">Opnieuw laden</button>
            </div>
          }
        </div>
      </app-sheet>
    }
  `,
  styles: `
    :host{display:contents}
    .purchase-track__body{min-width:0}
    .purchase-track__notice{display:flex;align-items:center;gap:12px;padding:0 4px 14px;font-size:12px;line-height:1.5;color:var(--muted)}
    .purchase-track__notice span{flex:1}.purchase-track__notice button{flex:none}
    .purchase-track__empty{padding:24px 12px;color:var(--ink);font-size:14px}.purchase-track__empty p{margin:8px 0 16px;color:var(--muted);line-height:1.5}
    @media(max-width:600px){.purchase-track__notice{align-items:flex-start;flex-direction:column;padding:0 6px 14px}}
  `,
})
export class PurchaseTracking {
  readonly orderId = input.required<number>();
  readonly trackingReference = input<string | null>(null);
  readonly active = input(true);
  readonly scope = computed(() => purchaseTrackingScope(this.orderId(), this.trackingReference()));
  readonly feed = signal<ContainerTrackingFeed | null>(null);
  readonly row = computed(() => purchaseTrackingRow(this.feed(), this.orderId(), this.trackingReference()));
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly opened = signal(false);
  readonly panelBusy = signal(false);
  readonly ready = computed(() => !!this.scope() && this.scope() === this.currentScope());

  private readonly api = inject(ContainerTrackingApi);
  private readonly currentScope = signal<string | null>(null);
  private requestVersion = 0;
  private destroyed = false;

  constructor() {
    effect(() => {
      const scope = this.scope();
      const active = this.active();
      untracked(() => {
        this.invalidateRequest();
        if (scope !== this.currentScope()) {
          this.currentScope.set(scope);
          this.feed.set(null);
          this.error.set(null);
          this.opened.set(false);
          this.panelBusy.set(false);
        }
        if (!active) { this.panelBusy.set(false); this.opened.set(false); }
        if (scope && active) void this.reload();
      });
    });
    const visible = () => {
      if (document.visibilityState === 'visible') void this.reload();
      else this.invalidateRequest();
    };
    document.addEventListener('visibilitychange', visible);
    // This GET reads stored snapshots. The backend owns the six-hour source checks.
    const timer = window.setInterval(() => void this.reload(), 60_000);
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.invalidateRequest();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    });
  }

  showDetails(): void {
    if (!this.scope() || !this.active()) return;
    this.opened.set(true);
    void this.reload();
  }

  closeDetails(): void {
    this.opened.set(false);
    this.panelBusy.set(false);
  }

  panelBusyChanged(busy: boolean): void {
    this.panelBusy.set(busy);
    if (busy) this.invalidateRequest();
  }

  rowUpdated(row: ContainerTracking): void {
    if (this.destroyed || purchaseTrackingScope(row.orderId, row.trackingReference) !== this.scope()) return;
    this.invalidateRequest();
    this.error.set(null);
    this.feed.update((feed) => feed ? {
      ...feed, containers: [...feed.containers.filter((item) => item.orderId !== row.orderId), row],
    } : feed);
  }

  async reload(): Promise<void> {
    const scope = this.scope();
    if (this.destroyed || !scope || !this.active() || this.panelBusy() || this.loading() || document.visibilityState !== 'visible') return;
    const version = ++this.requestVersion;
    this.loading.set(true);
    try {
      const feed = await this.api.list();
      if (!this.accepts(version, scope)) return;
      this.feed.set(feed);
      this.error.set(null);
    } catch (failure) {
      if (this.accepts(version, scope)) this.error.set(messageOf(failure, 'Controleer de verbinding en probeer opnieuw.'));
    } finally {
      if (this.accepts(version, scope)) this.loading.set(false);
    }
  }

  private accepts(version: number, scope: string): boolean {
    return !this.destroyed && version === this.requestVersion && scope === this.scope() && this.active();
  }

  private invalidateRequest(): void {
    this.requestVersion += 1;
    this.loading.set(false);
  }
}
