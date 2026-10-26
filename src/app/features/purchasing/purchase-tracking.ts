import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { ContainerTrackingApi } from '../../core/api/container-tracking-api';
import type { ContainerTracking, ContainerTrackingFeed } from '../../core/api/container-tracking-models';
import { messageOf } from '../../core/api/errors';
import { Icon } from '../../shared/icon';
import { LoadError } from '../../shared/load-error';
import { Skeleton } from '../../shared/skeleton';
import { ContainerTrackingPanel } from './container-tracking-panel';
import { trackingTime } from './container-tracking-model';
import { purchaseTrackingRow, purchaseTrackingScope } from './purchase-tracking-model';

/** Saved tracking stays separate from the purchase editor and its unsaved changes. */
@Component({
  selector: 'app-purchase-tracking',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ContainerTrackingPanel, Icon, LoadError, Skeleton],
  host: { id: 'purchase-tracking-section', tabindex: '-1' },
  template: `
    <details class="purchase-track" [open]="expanded()" (toggle)="toggled($event)">
      <summary class="purchase-track__summary">
        <span class="purchase-track__icon"><app-icon name="countries" [size]="21" /></span>
        <span class="purchase-track__main">
          <span class="purchase-track__title">Track &amp; trace</span>
          @if (!expanded()) {
            @if (row(); as item) {
              <span class="purchase-track__vessel">{{ item.vessel || item.carrier || 'Container volgen' }}</span>
              <span class="purchase-track__reference">{{ item.trackingReference }}</span>
            } @else {
              <span class="purchase-track__reference">{{ trackingReference() }}</span>
            }
          }
        </span>
        @if (!expanded()) {
          <span class="purchase-track__state">
            @if (row(); as item) {
              <span class="purchase-track__status" [class.purchase-track__status--attention]="!!item.error || !item.automatic">{{ item.statusLabel }}</span>
              <span class="purchase-track__checked">{{ item.checkedAt ? 'Gecontroleerd ' + time(item.checkedAt) : 'Nog niet gecontroleerd' }}</span>
            } @else {
              <span class="purchase-track__checked">{{ loading() ? 'Tracking laden…' : error() ? 'Tijdelijk niet beschikbaar' : 'Tracking nog niet beschikbaar' }}</span>
            }
          </span>
        }
        <span class="purchase-track__action">{{ expanded() ? 'Sluiten' : 'Kaart en details' }}<app-icon [name]="expanded() ? 'chevron-up' : 'chevron-down'" [size]="16" /></span>
      </summary>
      @if (expanded() && active()) {
        <div class="purchase-track__body">
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
      }
    </details>
  `,
  styles: `
    :host{display:block;min-width:0;scroll-margin-top:150px;outline:none}
    .purchase-track{border:1px solid var(--line);border-radius:16px;background:var(--surface);overflow:hidden}
    .purchase-track__summary{display:flex;align-items:center;gap:14px;padding:16px 18px;cursor:pointer;list-style:none;min-height:74px;box-sizing:border-box}
    .purchase-track__summary::-webkit-details-marker{display:none}
    .purchase-track__summary:focus-visible{outline:3px solid var(--rose);outline-offset:-4px;border-radius:15px}
    .purchase-track__icon{display:grid;place-items:center;flex:none;width:40px;height:40px;background:color-mix(in srgb,var(--rose) 8%,transparent);color:var(--rose);border-radius:12px}
    .purchase-track__main{display:flex;flex:1;min-width:0;flex-direction:column;gap:3px}
    .purchase-track__title{font-size:12px;font-weight:700;color:var(--muted)}
    .purchase-track__vessel{font-size:16px;font-weight:750;color:var(--ink);overflow-wrap:anywhere}
    .purchase-track__reference{font-size:11px;line-height:1.4;color:var(--muted);overflow-wrap:anywhere}
    .purchase-track__state{display:flex;flex-direction:column;align-items:flex-end;gap:5px;max-width:38%;min-width:0;text-align:right}
    .purchase-track__status{font-size:12px;line-height:1.4;font-weight:700;color:var(--ink);overflow-wrap:anywhere}
    .purchase-track__status--attention{color:var(--muted)}
    .purchase-track__checked{font-size:11px;line-height:1.4;color:var(--muted)}
    .purchase-track__action{display:flex;align-items:center;gap:8px;flex:none;margin-left:12px;font-size:12px;font-weight:700;color:var(--rose)}
    .purchase-track[open]>.purchase-track__summary{min-height:60px;border-bottom:1px solid var(--line)}
    .purchase-track[open] .purchase-track__title{color:var(--ink);font-size:14px}
    .purchase-track__body{padding:12px}
    .purchase-track__notice{display:flex;align-items:center;gap:12px;padding:10px 4px 14px;font-size:12px;line-height:1.5;color:var(--muted)}
    .purchase-track__notice span{flex:1}.purchase-track__notice button{flex:none}
    .purchase-track__empty{padding:24px 12px;color:var(--ink);font-size:14px}.purchase-track__empty p{margin:8px 0 16px;color:var(--muted);line-height:1.5}
    @media(max-width:600px){
      .purchase-track__summary{display:grid;grid-template-columns:36px minmax(0,1fr) auto;gap:10px;padding:14px}
      .purchase-track__icon{width:36px;height:36px;align-self:start}
      .purchase-track__vessel{font-size:15px}.purchase-track__state{grid-column:2 / -1;align-items:flex-start;text-align:left;max-width:none;gap:3px}
      .purchase-track__action{grid-column:3;grid-row:1;margin:0;font-size:0;gap:0}
      .purchase-track__body{padding:8px}.purchase-track__notice{align-items:flex-start;flex-direction:column;padding:8px 6px 14px}
    }
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
  readonly expanded = signal(false);
  readonly panelBusy = signal(false);
  readonly time = trackingTime;

  private readonly api = inject(ContainerTrackingApi);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private currentScope: string | null = null;
  private requestVersion = 0;
  private destroyed = false;

  constructor() {
    effect(() => {
      const scope = this.scope();
      const active = this.active();
      untracked(() => {
        this.invalidateRequest();
        if (scope !== this.currentScope) {
          this.currentScope = scope;
          this.feed.set(null);
          this.error.set(null);
          this.expanded.set(false);
          this.panelBusy.set(false);
        }
        if (!active) this.panelBusy.set(false);
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

  toggled(event: Event): void {
    const open = (event.currentTarget as HTMLDetailsElement).open;
    this.expanded.set(open);
    if (!open) this.panelBusy.set(false);
  }

  showDetails(): void {
    this.expanded.set(true);
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';
    this.host.nativeElement.scrollIntoView({ behavior, block: 'start' });
    this.host.nativeElement.querySelector('summary')?.focus({ preventScroll: true });
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
