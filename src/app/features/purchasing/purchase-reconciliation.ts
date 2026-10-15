import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { saveBlob } from '../../core/api/download';
import { messageOf } from '../../core/api/errors';
import type { PurchaseReconciliation as Reconciliation } from '../../core/api/models';
import { SourcingApi } from '../../core/api/sourcing-api';
import { Icon } from '../../shared/icon';
import { EurPipe, NumPipe } from '../../shared/pipes';
import { Ui } from '../../shared/ui';
import { PAYEE_ICON, PAYEE_LABEL, PAYEE_TONE } from './purchase-payment-ledger';
import { reconciliationStatusLabel } from './purchase-reconciliation-metrics';
import {
  mixPricingRange, mixRange, nacalcUnitMix, reconciliationLineUnit, reconciliationUnit, type NacalcUnitMix, type ReconciliationUnit,
} from './purchase-payment-result-metrics';

/**
 * The server-owned settlement picture in Analyses › Inkoop (Containerafrekening):
 * what the container really costs, per stream, per piece and per product. The
 * container screens tell this story with app-purchase-nacalc-workbench and
 * -overview. Styles live in styles/purchase-payments.scss.
 */
@Component({
  selector: 'app-purchase-reconciliation',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, EurPipe, NumPipe],
  template: `
    <section class="reconciliation" aria-label="Kostprijs en nacalculatie">
      <header class="reconciliation__head">
        <h3>Kostprijs</h3>
        @if (data(); as r) {
          <span class="wk-pill" [class]="r.totals.finalized ? 'tone-ok' : 'tone-warn'">{{ r.totals.finalized ? 'Definitief' : 'Voorlopig' }}</span>
        }
        <button class="wk-btn wk-btn--sm reconciliation__pdf" type="button" (click)="download()" [disabled]="downloading() || dirty() || !data()"><app-icon name="document" [size]="14" />{{ downloading() ? 'PDF maken…' : 'PDF' }}</button>
      </header>
      @if (data(); as r) {
        @let t = r.totals;
        <dl class="wk-equation">
          <div><dt>Betaald</dt><dd>{{ t.paidEur | eur }}</dd></div>
          <div><dt><span class="wk-equation__op" aria-hidden="true">+</span>Open</dt><dd>{{ t.remainingEur | eur }}</dd></div>
          <div class="is-total"><dt>@if (closes(r)) { <span class="wk-equation__op" aria-hidden="true">=</span> }{{ t.finalized ? 'Definitieve externe kost' : 'Verwachte externe kost' }}</dt><dd>{{ t.forecastExternalEur | eur }}</dd></div>
        </dl>
        <!-- The calculation in Kosten is the yardstick: it sits with the difference, not in the sum. -->
        @if (t.varianceEur === 0) {
          <p class="reconciliation__variance is-none">Geen verschil met de afspraak van {{ t.plannedExternalEur | eur }}</p>
        } @else {
          <div class="reconciliation__variance" [class.is-higher]="t.varianceEur > 0" [class.is-lower]="t.varianceEur < 0">
            <span>{{ t.finalized ? 'Verschil na afrekening' : 'Verschil met de afspraak' }}<small>afspraak {{ t.plannedExternalEur | eur }}</small></span>
            <strong>{{ t.varianceEur > 0 ? '+ ' : '− ' }}{{ abs(t.varianceEur) | eur }}</strong>
          </div>
        }
        <p class="reconciliation__note">{{ t.finalized ? 'Alle ontvangers zijn afgerekend.' : 'Open bedragen tellen mee in de verwachte kost; minder betalen telt pas na afrekening.' }}</p>

        @if (showStreams()) {
          <div class="reconciliation__streams">
            @for (stream of r.streams; track stream.payee) {
              @if (stream.plannedEur || stream.paymentCount || stream.paidEur) {
                <div class="pr-payee">
                  <span class="pr-payee__tile" [class]="tone[stream.payee]"><app-icon [name]="icon[stream.payee]" [size]="14" /></span>
                  <span class="pr-payee__copy">
                    <b>{{ payeeLabel[stream.payee] }}</b>
                    <!-- A payee paid without an agreement reads like Bijkomende kosten, never '€ 0,00 afgesproken'. -->
                    @let agreed = stream.payee !== 'OTHER' && stream.status !== 'ADDITIONAL';
                    <span class="pr-payee__figures">@if (agreed) { {{ stream.plannedEur | eur }} afgesproken · }{{ stream.paidEur | eur }} betaald@if (agreed) { · {{ stream.remainingEur | eur }} open } @else { · zonder afspraak }</span>
                    <span class="pr-payee__state"><span class="wk-pill" [class]="streamTone(stream)">{{ statusLabel(stream, stream.payee === 'SUPPLIER' ? r.supplierInstalments : undefined) }}</span></span>
                  </span>
                  <span class="pr-payee__diff" [class.wk-amount--in]="stream.varianceEur < 0" [class.wk-amount--warn]="stream.varianceEur > 0" [class.wk-amount--muted]="stream.varianceEur === 0">
                    {{ stream.varianceEur > 0 ? '+ ' : stream.varianceEur < 0 ? '− ' : '' }}{{ abs(stream.varianceEur) | eur }}
                    <small>{{ stream.payee === 'OTHER' ? 'bijkomende kosten' : stream.varianceEur < 0 ? 'na afrekening' : stream.varianceEur > 0 ? (stream.finalized ? 'meer dan verwacht' : 'meer betaald · nakijken') : 'geen verschil' }}</small>
                  </span>
                </div>
              }
            }
          </div>
        }

        <dl class="wk-equation reconciliation__unit">
          @let mix = unitMix(r);
          @let unit = unitOf(t);
          @if (mix.uniform) {
            <!-- One product in its own unit: a display product per display, its piece price beside it ('€ 2,5800 per stuk'). -->
            <div>
              <dt>{{ t.finalized ? 'Externe kost per ' : 'Verwachte externe kost per ' }}{{ unit.unit }}<span class="wk-td__sub">@if (unit.pieceEur !== null) { {{ unit.pieceEur | eur: 4 }} per stuk · }{{ unit.quantity | num }} {{ unit.usable ? 'bruikbaar ontvangen' : 'bestelde' }} {{ unit.plural }}, incl. inspectie</span></dt>
              <dd>@if (unit.unitEur !== null) { {{ unit.unitEur | eur: 4 }} }</dd>
            </div>
          } @else {
            <!-- Several products have no one price per stuk: their range, each one under Per product; never an average over them. -->
            <div>
              <dt>{{ t.finalized ? 'Externe kost' : 'Verwachte externe kost' }} · {{ mix.count }} producten<span class="wk-td__sub">per {{ mix.unit }}, incl. inspectie · per product hieronder</span></dt>
              <dd>{{ range(mix) }}</dd>
            </div>
          }
          @if (t.receiptRecorded && (t.damagedQuantity || t.receivedQuantity !== t.orderedQuantity)) {
            <div class="is-sub"><dt>{{ t.orderedQuantity | num }} besteld · {{ t.receivedQuantity | num }} ontvangen · {{ t.damagedQuantity | num }} beschadigd</dt><dd></dd></div>
          }
          <div class="is-sub"><dt>Interne Enrosed opslag</dt><dd>{{ t.internalMarkupEur | eur }}</dd></div>
          <div class="is-sub"><dt>Kostbasis incl. opslag</dt><dd>{{ t.forecastPricingEur | eur }}</dd></div>
          @if (mix.uniform) {
            <div class="is-sub"><dt>Per {{ unit.unit }} incl. opslag@if (unit.pricingPieceEur !== null) { <span class="wk-td__sub">{{ unit.pricingPieceEur | eur: 4 }} per stuk</span> }</dt><dd>@if (unit.pricingUnitEur !== null) { {{ unit.pricingUnitEur | eur: 4 }} }</dd></div>
          } @else {
            <div class="is-sub"><dt>Per {{ mix.unit }} incl. opslag · {{ mix.count }} producten</dt><dd>{{ pricingRange(mix) ?? '—' }}</dd></div>
          }
        </dl>
        <p class="reconciliation__note">De opslag is geen betaling en past prijzen of offertes niet aan.</p>

        @if (r.lines.length) {
          <details class="reconciliation__details">
            <summary>Per product <span>{{ r.lines.length }} {{ r.lines.length === 1 ? 'productregel' : 'productregels' }}</span></summary>
            <div class="rc-products">
              @for (line of r.lines; track line.productId ?? line.productName) {
                @let lineUnit = lineUnitOf(line);
                <div class="rc-product">
                  <span class="rc-product__copy">
                    @if (line.productId) { <a [routerLink]="['/products', line.productId]">{{ line.productName }}</a> } @else { <b>{{ line.productName }}</b> }
                    <!-- Four decimals, like the totals above and the product pages: this is where a product gets priced. A display per display, its piece price beside it. -->
                    <small>{{ lineUnit.quantity | num }} {{ lineUnit.usable ? 'bruikbare' : 'bestelde' }} {{ lineUnit.plural }}@if (lineUnit.unitEur !== null) { · {{ lineUnit.unitEur | eur: 4 }} per {{ lineUnit.unit }} }@if (lineUnit.pieceEur !== null) { · {{ lineUnit.pieceEur | eur: 4 }} per stuk }@if (lineUnit.pricingUnitEur !== null) { · {{ lineUnit.pricingUnitEur | eur: 4 }}@if (lineUnit.unit === 'display') { per display } incl. opslag }</small>
                    @if (line.unitCostQuantity === 0) { <small class="wk-amount--warn">Geen bruikbare {{ lineUnit.plural }}: de kost blijft bij deze productregel.</small> }
                  </span>
                  <span class="rc-product__amount">
                    <b>{{ line.forecastExternalEur | eur }}</b>
                    <small class="rc-product__plan">afspraak {{ line.plannedExternalEur | eur }}</small>
                    @if (line.varianceEur !== 0) { <small [class.wk-amount--warn]="line.varianceEur > 0" [class.wk-amount--in]="line.varianceEur < 0">{{ line.varianceEur > 0 ? '+ ' : '− ' }}{{ abs(line.varianceEur) | eur }} t.o.v. de afspraak</small> }
                  </span>
                </div>
              }
            </div>
          </details>
        }
        @if (r.notes.length) {
          <details class="reconciliation__details reconciliation__notes"><summary>Toelichting op de berekening</summary><ul>@for (note of r.notes; track $index) { <li>{{ note }}</li> }</ul></details>
        }
      } @else {
        <p class="reconciliation__note">De nacalculatie is nog niet beschikbaar. Vernieuw de order om de actuele betalingen op te halen.</p>
      }
      <div class="reconciliation__foot">
        <a class="wk-link" [routerLink]="['/purchasing', orderId()]" [queryParams]="{ section: 'payment-result' }">Nacalculatie ›</a>
        <span aria-hidden="true">·</span>
        <a class="wk-link" [routerLink]="['/purchasing', orderId()]" [queryParams]="{ section: 'ledger' }">Betalingen ›</a>
        <span aria-hidden="true">·</span>
        <a class="wk-link" routerLink="/costs" [queryParams]="{ container: orderId() }">Kosten &amp; bank ›</a>
      </div>
      @if (dirty()) { <p class="reconciliation__note">Voorbeeld met je wijzigingen. Sla de container op om deze kostprijs als PDF te exporteren.</p> }
    </section>
  `,
})
export class PurchaseReconciliation {
  readonly data = input<Reconciliation | null | undefined>(undefined);
  readonly orderId = input.required<number>();
  readonly orderNumber = input.required<string>();
  readonly dirty = input(false);
  /** The payee figures belong to Betalingen; Analyses still shows them here. */
  readonly showStreams = input(true);
  readonly payeeLabel = PAYEE_LABEL;
  readonly icon = PAYEE_ICON;
  readonly tone = PAYEE_TONE;
  readonly downloading = signal(false);
  readonly statusLabel = reconciliationStatusLabel;
  readonly abs = Math.abs;
  private readonly sourcing = inject(SourcingApi);
  private readonly ui = inject(Ui);

  /** One product keeps the container's own figure, in its unit (unitOf); several get their range. */
  unitMix(r: Reconciliation): NacalcUnitMix { return nacalcUnitMix(r); }
  unitOf(totals: Reconciliation['totals']): ReconciliationUnit { return reconciliationUnit(totals); }
  lineUnitOf(line: Reconciliation['lines'][number]): ReconciliationUnit { return reconciliationLineUnit(line); }
  range(mix: NacalcUnitMix): string { return mixRange(mix); }
  pricingRange(mix: NacalcUnitMix): string | null { return mixPricingRange(mix); }

  /** Betaald + open lands on the forecast, so the '=' is honest; a stale response can miss it. */
  closes(r: Reconciliation): boolean {
    return Math.abs(r.totals.paidEur + r.totals.remainingEur - r.totals.forecastExternalEur) <= 0.01;
  }

  streamTone(stream: Reconciliation['streams'][number]): string {
    switch (stream.status) {
      case 'PAID': case 'SETTLED_LOWER': return 'tone-ok';
      case 'OVERPAID': return stream.finalized ? '' : 'tone-warn';
      case 'UNPAID': return 'tone-warn';
      case 'ADDITIONAL': return stream.payee === 'OTHER' ? '' : 'tone-warn';
      default: return '';
    }
  }

  async download(): Promise<void> {
    if (this.downloading() || this.dirty() || !this.data()) return;
    this.downloading.set(true);
    try {
      saveBlob(await this.sourcing.purchasePaymentsPdf(this.orderId()), `${this.orderNumber().replace(/[^\p{L}\p{N}._-]/gu, '-')}-betalingen-kostprijs.pdf`);
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'De betalingsafrekening kon niet als PDF worden geëxporteerd'), 'err');
    } finally { this.downloading.set(false); }
  }
}
