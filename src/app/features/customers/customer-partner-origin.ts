import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { CustomerPartnerOrigin } from '../../core/api/models';
import { shortDateNl } from './customer-form';

/**
 * A customer the partner made in the Partnerportaal (the buyer of a direct
 * sale), on its sheet: "Aangemaakt door Frans via Partnerportaal · 12 nov
 * 2026" and Nagekeken. Nagekeken is part of the sheet's own Opslaan, in the
 * order the hint asks (fill in, tick, save): the tick only marks the draft;
 * the sheet stores the customer first and then marks it checked, so no typed
 * change is lost. It needs the VAT number: after Nagekeken every save needs
 * it (as for every customer), while before it the sheet saves without one.
 */
@Component({
  selector: 'app-customer-partner-origin',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cpo" [class.is-open]="!origin().reviewedAt" role="note">
      <span class="cpo__text">Aangemaakt door <b>{{ origin().createdByName || 'de partner' }}</b> via Partnerportaal@if (when(origin().createdAt); as day) { · {{ day }} }
        @if (origin().reviewedAt; as at) { <small>nagekeken {{ when(at) }}</small> }
        @else if (marked()) { <small>Wordt nagekeken bij Opslaan.</small> }
        @else if (vatMissing()) { <small>Vul aan wat ontbreekt, met het BTW-nummer, en vink af.</small> }
        @else { <small>Vul aan wat ontbreekt en vink af.</small> }</span>
      @if (!origin().reviewedAt) {
        <button class="cpo__btn" type="button" [class.is-on]="marked()" [attr.aria-pressed]="marked()"
                [disabled]="vatMissing() && !marked()" [attr.title]="vatMissing() && !marked() ? 'Nagekeken kan zodra het BTW-nummer er staat' : null"
                (click)="markChange.emit(!marked())">@if (marked()) {✓ }Nagekeken</button>
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
    .cpo__btn:disabled { color: var(--muted-2); cursor: default; }
    .cpo__btn.is-on { border-color: var(--ok); background: var(--ok-soft, var(--surface)); color: var(--ok); }
    .cpo__done { flex: none; padding: 0 6px; color: var(--ok); font-weight: 800; }
    @media (max-width: 679.98px), (hover: none) and (max-width: 1023.98px) { .cpo { font-size: 14.5px; } .cpo__btn { min-height: 44px; font-size: 15px; } }
  `,
})
export class CustomerPartnerOriginRow {
  readonly origin = input.required<CustomerPartnerOrigin>();
  /** The draft asks to be marked Nagekeken when the sheet is saved. */
  readonly marked = input(false);
  /** The draft has no VAT number: Nagekeken waits for it. */
  readonly vatMissing = input(false);
  readonly markChange = output<boolean>();

  when(iso: string | null | undefined): string {
    return iso ? shortDateNl(iso) : '';
  }
}
