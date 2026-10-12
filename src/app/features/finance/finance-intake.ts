import { Injectable } from '@angular/core';

/** What another page asks the finance workspace to open: a cost (with the photo just taken), or the movement form. */
export type IntakeRequest = { kind: 'cost'; files: File[] } | { kind: 'movement' };

/**
 * The hand-over from the phone home's '+' to the Kosten & bank page: the
 * home queues a request and navigates; FinanceState (provided per page)
 * takes it in its constructor. Root-provided so it outlives both pages; a
 * request is taken once and never replayed on a reload.
 */
@Injectable({ providedIn: 'root' })
export class FinanceIntake {
  private pending: IntakeRequest | null = null;

  queue(request: IntakeRequest): void {
    this.pending = request;
  }

  take(): IntakeRequest | null {
    const request = this.pending;
    this.pending = null;
    return request;
  }
}
