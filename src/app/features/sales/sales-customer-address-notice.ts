import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SalesApi } from '../../core/api/sales-api';
import type { SalesOrderView } from '../../core/api/models';
import { messageOf } from '../../core/api/errors';
import { customerAddressNotice } from './sales-customer-address';
import { Sheet, Ui } from '../../shared/ui';

/**
 * The notice on a sales document whose customer record lacks the address an
 * invoice needs. A customer made when a website login is approved has no
 * street, postal code or city; the invoice is refused until the record has
 * them. The notice names what is missing and, when the document has a
 * delivery address the server offers, lets staff take it over into the empty
 * fields of the record after they have seen it. Otherwise it links to the
 * customer.
 *
 * It renders only what the view carries: without an `invoiceCustomer` block
 * (nothing missing, an older backend) the host stays empty and takes no room.
 */
@Component({
  selector: 'app-sales-customer-address-notice',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Sheet],
  host: { '[class.is-shown]': '!!notice()' },
  template: `
    @if (notice(); as notice) {
      <div class="cust-notice" [class.cust-notice--desk]="variant() === 'desk'">
        @if (variant() === 'desk') { <b aria-hidden="true">!</b> }
        <div class="cust-notice__text">
          <p role="status">@if (variant() !== 'desk') { <span aria-hidden="true">!</span> } <strong>Klantgegevens onvolledig</strong> · {{ notice.lead }}</p>
          @if (notice.reason) { <p class="cust-notice__reason">{{ notice.reason }}</p> }
        </div>
        <div class="cust-notice__actions">
          @if (notice.takeover) {
            <button type="button" class="btn btn--sm btn--primary" [disabled]="busy() || blocked()" [title]="blockedTitle()" (click)="open()">Leveradres overnemen</button>
            <a class="cust-notice__link" [routerLink]="['/customers']" [queryParams]="{ q: notice.customerQuery }">Zelf invullen bij de klant ›</a>
          } @else {
            <a class="btn btn--sm" [routerLink]="['/customers']" [queryParams]="{ q: notice.customerQuery }">Naar de klant ›</a>
          }
        </div>
      </div>
      @if (sheet() && notice.takeover; as takeover) {
        <app-sheet title="Leveradres overnemen" (closed)="sheet.set(false)">
          <div body class="cust-sheet">
            <p>Dit adres komt in de klantgegevens van <strong>{{ notice.company }}</strong> en op de factuur:</p>
            <p class="cust-sheet__address">
              @for (line of takeover.lines; track $index) { <span>{{ line }}</span> }
            </p>
            <p class="cust-sheet__hint">Alleen lege adresvelden worden ingevuld; naam, btw-nummer en contactgegevens blijven zoals ze zijn.
              Is dit niet het adres van de klant zelf, bijvoorbeeld een levering bij een ander bedrijf? Vul het adres dan zelf in bij de klant.</p>
          </div>
          <div foot style="display:contents">
            <button class="btn" type="button" data-initial-focus (click)="sheet.set(false)">Terug</button>
            <button class="btn btn--primary" type="button" [disabled]="busy() || blocked()" (click)="take()">{{ busy() ? 'Overnemen…' : 'Adres overnemen' }}</button>
          </div>
        </app-sheet>
      }
    }
  `,
  styles: `
    :host { display:none;min-width:0 }
    :host(.is-shown) { display:block }
    /* Phone editor and read view: the look of the website-order banner above it. */
    .cust-notice { display:grid;gap:10px;margin:0 0 16px;padding:12px 14px;border:1px solid color-mix(in srgb,var(--gold) 45%,var(--line));border-radius:14px;
      background:color-mix(in srgb,var(--gold-soft) 30%,var(--surface)) }
    .cust-notice__text { display:grid;gap:5px;min-width:0 }
    .cust-notice p { margin:0;color:var(--ink-2);font-size:13px;line-height:1.45;overflow-wrap:anywhere }
    .cust-notice p strong { color:var(--ink) }
    .cust-notice__actions { display:flex;align-items:center;flex-wrap:wrap;gap:6px 14px }
    .cust-notice__actions .btn { flex:none;margin:0;min-height:44px }
    .cust-notice__link { display:inline-flex;align-items:center;min-height:44px;color:var(--rose-dark);font-size:13px;font-weight:650;text-decoration:underline }
    /* Desk: one row of the kit's attention bar (global .desk-attention), actions at the right. */
    .cust-notice--desk { display:flex;align-items:center;gap:10px;margin:12px 0;padding:9px 14px;border:1px solid #eddcb9;border-radius:12px;background:var(--warn-soft);color:var(--ink-2) }
    .cust-notice--desk > b { flex:none;display:inline-grid;place-items:center;min-width:20px;height:20px;padding:0 5px;border-radius:999px;background:var(--warn);color:#fff;font-size:11px }
    .cust-notice--desk .cust-notice__text { flex:1;gap:4px }
    .cust-notice--desk p { font-size:12.5px }
    .cust-notice--desk .cust-notice__reason { font-size:12px }
    .cust-notice--desk .cust-notice__actions { flex:none;flex-wrap:nowrap;justify-content:flex-end }
    .cust-notice--desk .cust-notice__actions .btn { min-height:32px }
    .cust-notice--desk .cust-notice__link { min-height:32px;font-size:12.5px;white-space:nowrap }
    @media (max-width:1100px) { .cust-notice--desk { flex-wrap:wrap } .cust-notice--desk .cust-notice__text { flex-basis:60% } .cust-notice--desk .cust-notice__actions { flex-wrap:wrap } }
    .cust-sheet { display:grid;gap:12px }
    .cust-sheet p { margin:0;font-size:14.5px;line-height:1.55;overflow-wrap:anywhere }
    .cust-sheet__address { display:grid;gap:1px;padding:11px 13px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2);font-weight:650 }
    .cust-sheet .cust-sheet__hint { font-size:12.5px;line-height:1.5;color:var(--muted) }
  `,
})
export class SalesCustomerAddressNotice {
  readonly view = input.required<SalesOrderView>();
  /** The desk shows it as one attention bar; phone editor and read view as a banner. */
  readonly variant = input<'desk' | 'ios'>('ios');
  /**
   * The host has unsaved edits or a write under way. The answer is a whole
   * server view; adopting it would drop what staff typed, so the takeover
   * waits until the document is saved.
   */
  readonly blocked = input(false);
  /** The view the server answered (or a fresh one after a refusal); the host adopts it. */
  readonly changed = output<SalesOrderView>();
  readonly busy = signal(false);
  readonly sheet = signal(false);
  private readonly sales = inject(SalesApi);
  private readonly ui = inject(Ui);

  readonly notice = computed(() => customerAddressNotice(this.view(), (code) => {
    try { return new Intl.DisplayNames('nl-BE', { type: 'region' }).of(code) ?? code; } catch { return code; }
  }));
  readonly blockedTitle = computed(() => this.blocked() ? 'Sla de wijzigingen eerst op' : '');

  open(): void {
    if (this.busy() || this.blocked() || !this.notice()?.takeover) return;
    this.sheet.set(true);
  }

  /** Writes the address staff are looking at; the server compares it with the delivery as it reads now. */
  async take(): Promise<void> {
    const notice = this.notice();
    if (this.busy() || this.blocked() || !notice?.takeover) return;
    const id = this.view().order.id;
    this.sheet.set(false);
    this.busy.set(true);
    try {
      const updated = await this.sales.takeCustomerAddressFromDelivery(id, notice.takeover.request);
      if (this.view().order.id === id) this.changed.emit(updated);
      this.ui.toast(`Adres overgenomen in de klantgegevens van ${notice.company}`);
    } catch (failure) {
      this.ui.toast(messageOf(failure, 'Leveradres overnemen mislukt. Probeer opnieuw.'), 'err');
      /* A refusal means the screen is behind (the customer changed the delivery, or the record was
         filled elsewhere): show what the server has now, so the next look is at the right address. */
      if ((failure as { status?: number })?.status === 409) {
        try {
          const fresh = await this.sales.order(id);
          if (this.view().order.id === id) this.changed.emit(fresh);
        } catch { /* the sentence above stands; the next load brings the rest */ }
      }
    } finally { this.busy.set(false); }
  }
}
