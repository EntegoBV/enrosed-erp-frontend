import { Injectable } from '@angular/core';
import { takeHandoff, type StepHandoff } from './purchase-phone-model';

/**
 * The read view's confirmed next step, waiting for the editor that runs it.
 * Memory only - never the URL or history.state - so a link or a reload can
 * never change a status; an unclaimed handoff goes stale after HANDOFF_MS.
 */
@Injectable({ providedIn: 'root' })
export class PurchaseStepHandoff {
  private pending: StepHandoff | null = null;

  offer(handoff: StepHandoff): void {
    this.pending = handoff;
  }

  /** The handoff for this order, once; a stale one is dropped on the way. */
  take(orderId: number, now: number): StepHandoff | null {
    const pending = this.pending;
    const taken = takeHandoff(pending, orderId, now);
    if (taken || (pending && !takeHandoff(pending, pending.orderId, now))) this.pending = null;
    return taken;
  }
}
