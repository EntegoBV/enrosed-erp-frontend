import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { saveBlob } from '../../core/api/download';
import { messageOf } from '../../core/api/errors';
import { SourcingApi } from '../../core/api/sourcing-api';
import { Icon } from '../../shared/icon';
import { Ui } from '../../shared/ui';

/**
 * The ways out of the Nacalculatie on the phone: the PDF, Betalingen and
 * Kosten & bank. Under the Nacalculatie in the editor; at the end of the read
 * view's Kosten tab, after the Calculatie, so they never split the tab in two
 * (2026-10-26). Styles: styles/purchase-nacalc.scss (.np-footer).
 */
@Component({
  selector: 'app-purchase-nacalc-footer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, RouterLink],
  template: `
    <div class="ios-group np-footer">
      <button class="ios-cell ios-cell--action" type="button" [disabled]="dirty() || pdfBusy()" (click)="downloadPdf()">{{ pdfBusy() ? 'PDF maken…' : 'Betalingen & kostprijs (PDF)' }}</button>
      <button class="ios-cell" type="button" (click)="openPayments.emit()"><span class="ios-cell__body"><span class="ios-cell__title">Betalingen</span></span><app-icon class="ios-cell__chev" name="chevron-right" [size]="16" /></button>
      <a class="ios-cell" routerLink="/costs" [queryParams]="{ container: orderId() }"><span class="ios-cell__body"><span class="ios-cell__title">Kosten &amp; bank</span></span><app-icon class="ios-cell__chev" name="chevron-right" [size]="16" /></a>
    </div>
    @if (dirty()) { <p class="ios-caption np-caption">Sla de container op om de kostprijs als PDF te exporteren.</p> }
  `,
  styles: `:host{display:block}`,
})
export class PurchaseNacalcFooter {
  private readonly sourcing = inject(SourcingApi);
  private readonly ui = inject(Ui);

  readonly orderId = input.required<number>();
  readonly orderNumber = input.required<string>();
  readonly dirty = input(false);
  readonly openPayments = output<void>();
  readonly pdfBusy = signal(false);

  async downloadPdf(): Promise<void> {
    if (this.pdfBusy() || this.dirty()) return;
    this.pdfBusy.set(true);
    try {
      saveBlob(await this.sourcing.purchasePaymentsPdf(this.orderId()), `${this.orderNumber().replace(/[^\p{L}\p{N}._-]/gu, '-')}-betalingen-kostprijs.pdf`);
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'De betalingsafrekening kon niet als PDF worden geëxporteerd'), 'err');
    } finally { this.pdfBusy.set(false); }
  }
}
