import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { messageOf } from '../../core/api/errors';
import type { CustomerPartnerOrigin } from '../../core/api/models';
import { PartnerSalesApi } from '../../core/api/partner-sales-api';
import { WorkQueue } from '../../core/api/work-queue';
import { Ui } from '../../shared/ui';
import { shortDateNl } from './customer-form';

/**
 * A customer the partner made in the Partnerportaal (the buyer of a direct
 * sale), on its sheet: "Aangemaakt door Frans via Partnerportaal · 12 nov 2026"
 * and Nagekeken once staff put the data right (the bell item goes then). While
 * it is not checked and has no VAT number, the sheet saves without one.
 */
@Component({
  selector: 'app-customer-partner-origin',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cpo" [class.is-open]="!reviewedAt()" role="note">
      <span class="cpo__text">Aangemaakt door <b>{{ origin().createdByName || 'de partner' }}</b> via Partnerportaal@if (when(origin().createdAt); as day) { · {{ day }} }
        @if (reviewedAt(); as at) { <small>nagekeken {{ when(at) }}</small> } @else { <small>Vul aan wat ontbreekt en vink af.</small> }</span>
      @if (!reviewedAt()) {
        <button class="cpo__btn" type="button" [disabled]="busy()" (click)="review()">{{ busy() ? 'Bezig…' : 'Nagekeken' }}</button>
      } @else {
        <span class="cpo__done" aria-hidden="true">✓</span>
      }
    </div>
  `,
  styles: `
    :host { display: block; margin-bottom: 12px; }
    .cpo { display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 6px 8px 6px 12px; border: 1px solid var(--line); border-radius: 12px;
      background: var(--surface-2); font-size: 13px; }
    .cpo.is-open { border-color: #eddcb9; background: var(--warn-soft); }
    .cpo__text { flex: 1; min-width: 0; line-height: 1.35; }
    .cpo__text small { display: block; color: var(--muted); font-size: 12px; }
    .cpo__btn { flex: none; min-height: 36px; padding: 0 14px; border: 1px solid var(--line-strong); border-radius: 999px; background: var(--surface);
      color: var(--ink); font: inherit; font-size: 13px; font-weight: 650; cursor: pointer; }
    .cpo__btn:hover:not(:disabled) { border-color: var(--rose); color: var(--rose-dark); }
    .cpo__done { flex: none; padding: 0 6px; color: var(--ok); font-weight: 800; }
    @media (max-width: 679.98px), (hover: none) and (max-width: 1023.98px) { .cpo { font-size: 14.5px; } .cpo__btn { min-height: 44px; font-size: 15px; } }
  `,
})
export class CustomerPartnerOriginRow {
  private readonly api = inject(PartnerSalesApi);
  private readonly work = inject(WorkQueue);
  private readonly ui = inject(Ui);

  readonly customerId = input.required<number>();
  readonly origin = input.required<CustomerPartnerOrigin>();
  /** The moment it was checked, for the list and the sheet's draft. */
  readonly reviewed = output<string>();

  readonly busy = signal(false);
  private readonly reviewedNow = signal<string | null>(null);
  readonly reviewedAt = computed(() => this.reviewedNow() ?? this.origin().reviewedAt ?? null);

  when(iso: string | null | undefined): string {
    return iso ? shortDateNl(iso) : '';
  }

  async review(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const at = (await this.api.markCustomerReviewed(this.customerId())) ?? new Date().toISOString();
      this.reviewedNow.set(at);
      this.reviewed.emit(at);
      void this.work.refresh(true);
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Nagekeken zetten is niet gelukt'), 'err');
    } finally {
      this.busy.set(false);
    }
  }
}
