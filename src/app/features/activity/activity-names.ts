import { Injectable, computed, inject, signal } from '@angular/core';
import { SourcingApi } from '../../core/api/sourcing-api';
import { containerName } from '../purchasing/container-name';
import type { ActivityContext } from './activity-format';

/**
 * The names behind the Logboek's ids: purchase orders by their container
 * name (containerName(), the owner's rule) and suppliers by name. Loaded
 * once per app visit, after the first page of events is on screen; until
 * then (or when a call fails) the rows show the logged label and swap
 * silently. Shared by the Logboek and the settings overview.
 */
@Injectable({ providedIn: 'root' })
export class ActivityNames {
  private readonly sourcing = inject(SourcingApi);
  private readonly purchaseOrders = signal<ReadonlyMap<string, string>>(new Map());
  private readonly suppliers = signal<ReadonlyMap<string, string>>(new Map());
  private pending: Promise<void> | null = null;

  /** The lookups as a format context; a new object whenever a list arrives, so rows re-render. */
  readonly context = computed<ActivityContext>(() => {
    const orders = this.purchaseOrders();
    const suppliers = this.suppliers();
    return {
      poName: (id: string) => orders.get(id) ?? null,
      supplierName: (id: string) => suppliers.get(id) ?? null,
    };
  });

  /** Starts both lookups once; never throws. */
  load(): Promise<void> {
    this.pending ??= Promise.all([
      this.sourcing.purchaseOrders().then((views) => this.purchaseOrders.set(new Map(views.flatMap((view) => {
        const order = view?.order;
        return order?.id != null ? [[String(order.id), containerName(order)] as const] : [];
      })))).catch(() => undefined),
      this.sourcing.suppliers().then((list) => this.suppliers.set(new Map(list.flatMap((supplier) =>
        supplier.id != null ? [[String(supplier.id), supplier.name] as const] : [])))).catch(() => undefined),
    ]).then(() => undefined);
    return this.pending;
  }
}
