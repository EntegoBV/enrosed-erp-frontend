import { Injectable, computed, inject, signal } from '@angular/core';
import { SourcingApi } from '../../core/api/sourcing-api';
import { containerName } from '../purchasing/container-name';
import type { ActivityEvent } from '../../core/api/models';
import { namesReloadDue, purchaseOrderIds, type ActivityContext } from './activity-format';

/**
 * The names behind the Logboek's ids: purchase orders by their container
 * name (containerName(), the owner's rule) and suppliers by name. Read after
 * the first page of events is on screen; until then (or while a call fails)
 * the rows show the logged label and swap silently. Read again after a
 * failed lookup, after ten minutes, or when the rows name a purchase order
 * the lookup does not know yet (at most once a minute): namesReloadDue.
 * Shared by the Logboek and the settings overview.
 */
@Injectable({ providedIn: 'root' })
export class ActivityNames {
  private readonly sourcing = inject(SourcingApi);
  private readonly purchaseOrders = signal<ReadonlyMap<string, string>>(new Map());
  private readonly suppliers = signal<ReadonlyMap<string, string>>(new Map());
  private pending: Promise<void> | null = null;
  private inFlight = false;
  private failed = false;
  private loadedAt: number | null = null;

  /** The lookups as a format context; a new object whenever a list arrives, so rows re-render. */
  readonly context = computed<ActivityContext>(() => {
    const orders = this.purchaseOrders();
    const suppliers = this.suppliers();
    return {
      poName: (id: string) => orders.get(id) ?? null,
      supplierName: (id: string) => suppliers.get(id) ?? null,
    };
  });

  /** Reads both lookups when they are due (see namesReloadDue); `events` are the rows on screen. Never throws. */
  load(events: readonly ActivityEvent[] = []): Promise<void> {
    const known = this.purchaseOrders();
    const missing = purchaseOrderIds(events).some((id) => !known.has(id));
    if (!namesReloadDue({ inFlight: this.inFlight, failed: this.failed, loadedAt: this.loadedAt, missing }, Date.now())) {
      return this.pending ?? Promise.resolve();
    }
    this.inFlight = true;
    this.failed = false;
    const fail = () => { this.failed = true; };
    this.pending = Promise.all([
      this.sourcing.purchaseOrders().then((views) => this.purchaseOrders.set(new Map(views.flatMap((view) => {
        const order = view?.order;
        return order?.id != null ? [[String(order.id), containerName(order)] as const] : [];
      })))).catch(fail),
      this.sourcing.suppliers().then((list) => this.suppliers.set(new Map(list.flatMap((supplier) =>
        supplier.id != null ? [[String(supplier.id), supplier.name] as const] : [])))).catch(fail),
    ]).then(() => {
      this.loadedAt = Date.now();
      this.inFlight = false;
    });
    return this.pending;
  }
}
