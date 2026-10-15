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

  /** A fresh handoff waits for this order; it stays waiting. */
  waiting(orderId: number, now: number): boolean {
    return takeHandoff(this.pending, orderId, now) !== null;
  }

  /** The editor this order's handoff was meant for went away before it ran the step: the step never runs later. */
  discard(orderId: number): void {
    if (this.pending?.orderId === orderId) this.pending = null;
  }
}
