import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { SalesApi } from '../../core/api/sales-api';
import type { SalesOrderView } from '../../core/api/models';
import { messageOf } from '../../core/api/errors';
import { cancelledByCustomer, webOrderMailDue, webOrderMailRepeatable } from './quote-status';
import { DateTimeNlPipe } from '../../shared/pipes';
import { Sheet, Ui } from '../../shared/ui';

/**
 * What a website order adds to the notes of a document: the delivery the
 * customer gave for this order, when and by which login it was placed, a
 * cancellation by the customer and the state of the customer mail.
 *
 * It renders only what the view carries. A derived document (invoice, split
 * part, copy) has a delivery block and no order block; a plain document and
 * an older backend have neither and the component renders nothing.
 */
@Component({
  selector: 'app-sales-web-order-note',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DateTimeNlPipe, Sheet],
  template: `
    @if (view().delivery || view().webOrder) {
      <section class="web-note" aria-label="Gegevens van de websitebestelling">
        @if (view().delivery; as delivery) {
          <div class="web-note__block">
            @if (delivery.fulfillment === 'PICKUP') {
              <h3>Afhaling</h3>
              <p class="web-note__address">
                @if (delivery.pickupLabel) { <span>{{ delivery.pickupLabel }}</span> }
                @if (delivery.pickupAddress) { <span>{{ delivery.pickupAddress }}</span> }
              </p>
            } @else {
              <h3>Leveradres van deze bestelling</h3>
              <p class="web-note__address">
                @if (delivery.address) { <span>{{ delivery.address }}</span> }
                @if (delivery.postalCode || delivery.city) { <span>{{ delivery.postalCode }} {{ delivery.city }}</span> }
                @if (country(); as name) { <span>{{ name }}</span> }
              </p>
            }
            @if (contact(); as line) { <p class="web-note__line">Contact voor deze bestelling: {{ line }}</p> }
            @if (delivery.differsFromCustomerRecord) {
              <p class="web-note__line web-note__line--gold">Wijkt af van het adres in de klantgegevens. De vracht is berekend op dit leveradres.</p>
            }
            <p class="web-note__hint">Alleen de klant kan dit wijzigen, en alleen zolang de bestelling niet in verwerking is. Klopt het adres niet? Zet de vracht op “Vast bedrag” en noteer het juiste adres bij de interne notities.</p>
          </div>
        }
        @if (view().webOrder; as order) {
          <div class="web-note__block">
            <p class="web-note__line">Besteld op {{ order.placedAt | dateTimeNl }} via klantlogin {{ order.accountEmail }}</p>
            @if (cancelled()) {
              <p class="web-note__line web-note__line--danger">Door de klant geannuleerd op {{ order.customerCancelledAt | dateTimeNl }}.</p>
            }
            @if (mailDue()) {
              <p class="web-note__line web-note__line--danger web-note__mail" role="alert">
                <span>{{ mailFailure() }}</span>
                <button type="button" class="btn btn--sm" [disabled]="busy()" (click)="resend(false)">{{ busy() ? 'Versturen…' : 'Opnieuw sturen' }}</button>
              </p>
            } @else if (repeatable(); as sentAt) {
              <p class="web-note__line web-note__line--muted web-note__mail">
                <span>E-mail aan de klant verstuurd op {{ sentAt | dateTimeNl }}</span>
                <button type="button" class="web-note__link" [disabled]="busy()" (click)="repeatSheet.set(true)">Opnieuw sturen</button>
              </p>
            }
          </div>
        }
      </section>
      @if (repeatSheet()) {
        <app-sheet title="E-mail opnieuw sturen" (closed)="repeatSheet.set(false)">
          <div body><p class="web-note__confirm">De klant krijgt dezelfde e-mail nog een keer. Opnieuw sturen?</p></div>
          <div foot style="display:contents">
            <button class="btn" type="button" data-initial-focus (click)="repeatSheet.set(false)">Terug</button>
            <button class="btn btn--primary" type="button" [disabled]="busy()" (click)="resend(true)">Opnieuw sturen</button>
          </div>
        </app-sheet>
      }
    }
  `,
  styles: `
    :host { display:block;min-width:0 }
    .web-note { display:grid;gap:12px;padding:13px 14px;border:1px solid var(--line);border-radius:14px;background:var(--surface-2);color:var(--ink) }
    .web-note__block { display:grid;gap:6px;min-width:0 }
    .web-note__block + .web-note__block { padding-top:12px;border-top:1px solid var(--line) }
    h3 { margin:0;font-size:12px;font-weight:700;letter-spacing:0;color:var(--ink) }
    .web-note__address { display:grid;gap:1px;margin:0;font-size:13px;line-height:1.45;overflow-wrap:anywhere }
    .web-note__line { margin:0;font-size:12px;line-height:1.5;color:var(--ink-2);overflow-wrap:anywhere }
    .web-note__line--gold { padding:7px 9px;border-left:3px solid var(--gold);border-radius:8px;background:var(--gold-soft);color:var(--ink) }
    .web-note__line--danger { color:var(--danger);font-weight:650 }
    .web-note__line--muted { color:var(--muted) }
    .web-note__mail { display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px }
    .web-note__mail span { flex:1;min-width:180px }
    .web-note__mail .btn { flex:none;margin:0;min-height:44px }
    .web-note__link { flex:none;min-height:44px;padding:0 4px;border:0;background:none;color:var(--rose-dark);font:inherit;font-weight:650;text-decoration:underline;cursor:pointer }
    .web-note__link:disabled { opacity:.45;cursor:not-allowed }
    .web-note__hint { margin:0;font-size:11px;line-height:1.5;color:var(--muted) }
    .web-note__confirm { margin:0;font-size:14.5px;line-height:1.55 }
  `,
})
export class SalesWebOrderNote {
  readonly view = input.required<SalesOrderView>();
  /** The view the server answered after a mail went out; the host adopts it. */
  readonly changed = output<SalesOrderView>();
  readonly busy = signal(false);
  readonly repeatSheet = signal(false);
  private readonly sales = inject(SalesApi);
  private readonly ui = inject(Ui);

  readonly cancelled = computed(() => cancelledByCustomer(this.view()));
  readonly mailDue = computed(() => webOrderMailDue(this.view()));
  readonly repeatable = computed(() => webOrderMailRepeatable(this.view()));
  /** Follows mailDue, not the error: a mail that never left without a recorded error still gets the line. */
  readonly mailFailure = computed(() => {
    const error = this.view().webOrder?.mailError?.trim();
    return 'De e-mail aan de klant is niet vertrokken' + (error ? `: ${error}` : '');
  });
  readonly contact = computed(() => {
    const delivery = this.view().delivery;
    return [delivery?.contactName, delivery?.phone].map(part => part?.trim()).filter(Boolean).join(' · ');
  });
  /** The block carries the code only; the name saves staff a lookup. */
  readonly country = computed(() => {
    const code = this.view().delivery?.countryCode?.trim().toUpperCase();
    if (!code) return '';
    try { return new Intl.DisplayNames('nl-BE', { type: 'region' }).of(code) ?? code; } catch { return code; }
  });

  /** Sends the mail that is due, or with repeat the last order mail once more. */
  async resend(repeat: boolean): Promise<void> {
    if (this.busy()) return;
    const id = this.view().order.id;
    this.repeatSheet.set(false);
    this.busy.set(true);
    try {
      const updated = await this.sales.resendWebOrderMails(id, repeat);
      if (this.view().order.id === id) this.changed.emit(updated);
      this.ui.toast(repeat ? 'E-mail opnieuw verstuurd' : 'E-mail verstuurd');
    } catch (failure) {
      this.ui.toast(messageOf(failure, 'E-mail versturen mislukt. Probeer opnieuw.'), 'err');
    } finally { this.busy.set(false); }
  }
}
