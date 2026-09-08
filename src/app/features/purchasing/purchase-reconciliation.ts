import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { saveBlob } from '../../core/api/download';
import { messageOf } from '../../core/api/errors';
import type { PurchaseReconciliation as Reconciliation } from '../../core/api/models';
import { SourcingApi } from '../../core/api/sourcing-api';
import { EurPipe, NumPipe } from '../../shared/pipes';
import { Ui } from '../../shared/ui';
import { reconciliationStatusLabel } from './purchase-reconciliation-metrics';

/** The same server-owned settlement picture in the desk, phone and container analysis. */
@Component({
  selector: 'app-purchase-reconciliation',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, EurPipe, NumPipe],
  template: `
    <section class="reconciliation" aria-label="Betalingen en werkelijke containerkost">
      <header class="reconciliation__head">
        <div><span class="eyebrow">Betalingen &amp; kostprijs</span><h3>Nacalculatie container</h3></div>
        @if (data(); as result) {
          <span class="state" [class.state--final]="result.totals.finalized">{{ result.totals.finalized ? 'Afgerekend' : 'Voorlopig' }}</span>
        }
      </header>
      @if (data(); as result) {
        <div class="reconciliation__metrics">
          <div><span>Begrote externe kost</span><b>{{ result.totals.plannedExternalEur | eur }}</b></div>
          <div><span>Werkelijk betaald</span><b>{{ result.totals.paidEur | eur }}</b></div>
          <div><span>Nog te betalen</span><b>{{ result.totals.remainingEur | eur }}</b></div>
          <div class="reconciliation__forecast"><span>{{ result.totals.finalized ? 'Definitieve externe kost' : 'Verwachte externe kost' }}</span><b>{{ result.totals.forecastExternalEur | eur }}</b></div>
        </div>
        <div class="reconciliation__variance" [class.reconciliation__variance--higher]="result.totals.varianceEur > 0" [class.reconciliation__variance--lower]="result.totals.varianceEur < 0">
          <span>{{ result.totals.finalized ? 'Verschil na afrekening' : 'Verwacht verschil met begroting' }}</span>
          <strong>{{ result.totals.varianceEur > 0 ? '+' : '' }}{{ result.totals.varianceEur | eur }}</strong>
        </div>
        <p class="reconciliation__explanation">{{ result.totals.finalized ? 'Alle bekende betaalstromen zijn afgerekend.' : 'Open bedragen blijven in de verwachte kost. Minder betalen telt pas als besparing zodra de betaalstroom is vereffend.' }}</p>

        <details class="reconciliation__details">
          <summary>Per betaalstroom <span>leverancier, douane &amp; extra kosten</span></summary>
          <div class="reconciliation__streams">
            @for (stream of result.streams; track stream.payee) {
              @if (stream.plannedEur || stream.paymentCount || stream.paidEur) {
                <article class="stream">
                  <header><b>{{ stream.label }}</b><small>{{ statusLabel(stream) }}</small></header>
                  <dl><div><dt>Begroot</dt><dd>{{ stream.plannedEur | eur }}</dd></div><div><dt>Betaald</dt><dd>{{ stream.paidEur | eur }}</dd></div><div><dt>Open</dt><dd>{{ stream.remainingEur | eur }}</dd></div></dl>
                  @if (stream.varianceEur !== 0) {
                    <p [class.higher]="stream.varianceEur > 0" [class.lower]="stream.varianceEur < 0">
                      {{ stream.varianceEur > 0 ? '+' : '' }}{{ stream.varianceEur | eur }}
                      {{ stream.payee === 'OTHER' ? 'extra kosten' : stream.varianceEur < 0 ? 'na vereffening' : stream.finalized ? 'meer dan begroot' : 'meer betaald; beoordeel correctie of vereffening' }}
                    </p>
                  }
                </article>
              }
            }
          </div>
        </details>

        <div class="reconciliation__unit">
          <div><span>{{ result.totals.finalized ? 'Externe kost per stuk' : 'Verwachte externe kost per stuk' }}</span><b>{{ result.totals.forecastExternalUnitEur === null ? '—' : (result.totals.forecastExternalUnitEur | eur: 4) }}</b></div>
          <p>Verdeeld over {{ result.totals.unitCostQuantity | num }} {{ result.totals.unitCostBasis === 'USABLE_RECEIVED' ? 'bruikbaar ontvangen' : 'bestelde' }} stuks, inclusief inspectie en overige externe kosten.</p>
          @if (result.totals.receiptRecorded && (result.totals.damagedQuantity || result.totals.receivedQuantity !== result.totals.orderedQuantity)) {
            <p>{{ result.totals.orderedQuantity | num }} besteld · {{ result.totals.receivedQuantity | num }} ontvangen · {{ result.totals.damagedQuantity | num }} beschadigd.</p>
          }
          <div class="reconciliation__markup"><span>Interne Enrosed opslag</span><b>{{ result.totals.internalMarkupEur | eur }}</b></div>
          <div class="reconciliation__markup"><span>Kostbasis incl. interne opslag</span><b>{{ result.totals.forecastPricingEur | eur }}</b></div>
          <div class="reconciliation__markup"><span>Per stuk incl. interne opslag</span><b>{{ result.totals.forecastPricingUnitEur === null ? '—' : (result.totals.forecastPricingUnitEur | eur: 4) }}</b></div>
          <p>De interne opslag is geen bankbetaling. Dit overzicht past productprijzen en bestaande offertes niet automatisch aan.</p>
        </div>

        @if (result.lines.length) {
          <details class="reconciliation__details">
            <summary>Kostprijs per product <span>{{ result.lines.length }} productregels</span></summary>
            <div class="reconciliation__products">
              @for (line of result.lines; track line.productId) {
                <article class="product-cost">
                  @if (line.productId) { <a [routerLink]="['/products', line.productId]">{{ line.productName }}</a> } @else { <b>{{ line.productName }}</b> }
                  <small>{{ line.unitCostQuantity | num }} {{ line.unitCostBasis === 'USABLE_RECEIVED' ? 'bruikbare' : 'bestelde' }} stuks</small>
                  <dl><div><dt>Begrote externe kost</dt><dd>{{ line.plannedExternalEur | eur }}</dd></div><div><dt>{{ result.totals.finalized ? 'Externe kost' : 'Verwachte externe kost' }}</dt><dd>{{ line.forecastExternalEur | eur }}</dd></div><div><dt>Verschil</dt><dd [class.higher]="line.varianceEur > 0" [class.lower]="line.varianceEur < 0">{{ line.varianceEur > 0 ? '+' : '' }}{{ line.varianceEur | eur }}</dd></div><div><dt>Externe kost per stuk</dt><dd>{{ line.forecastExternalUnitEur === null ? '—' : (line.forecastExternalUnitEur | eur: 4) }}</dd></div><div><dt>Per stuk incl. interne opslag</dt><dd>{{ line.forecastPricingUnitEur === null ? '—' : (line.forecastPricingUnitEur | eur: 4) }}</dd></div></dl>
                  @if (line.unitCostQuantity === 0) { <p class="higher">Geen bruikbare stuks: de kost blijft bij deze productregel, zonder stukprijs.</p> }
                </article>
              }
            </div>
          </details>
        }
        @if (result.notes.length) {
          <details class="reconciliation__details reconciliation__notes"><summary>Toelichting op de berekening</summary><ul>@for (note of result.notes; track $index) { <li>{{ note }}</li> }</ul></details>
        }
      } @else {
        <p class="reconciliation__explanation">De nacalculatie is nog niet beschikbaar. Vernieuw de order om de actuele betalingen op te halen.</p>
      }
      <div class="reconciliation__actions">
        <button class="btn btn--sm" type="button" (click)="download()" [disabled]="downloading() || dirty() || !data()">{{ downloading() ? 'PDF maken…' : 'Betalingen & kostprijs (PDF)' }}</button>
        <a routerLink="/costs" [queryParams]="{ container: orderId() }">Kosten &amp; bank ›</a>
      </div>
      @if (dirty()) { <p class="reconciliation__explanation">Voorbeeld met je wijzigingen. Sla de container op om deze kostprijs als PDF te exporteren.</p> }
    </section>
  `,
  styles: `
    :host{display:block;min-width:0;margin:12px 0}.reconciliation{min-width:0;padding:14px;border:1px solid var(--line);border-radius:14px;background:var(--surface)}
    .reconciliation__head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:12px}.eyebrow{font-size:9px;font-weight:750;color:var(--rose-dark);letter-spacing:.08em;text-transform:uppercase}h3{margin:3px 0 0;font-size:15px}.state{padding:4px 7px;border-radius:999px;background:var(--warn-soft);color:var(--warn);font-size:10px;white-space:nowrap}.state--final{color:var(--ok);background:var(--ok-soft)}
    .reconciliation__metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.reconciliation__metrics>div{display:grid;gap:5px;min-width:0;padding:10px;border-radius:10px;background:var(--surface-2)}.reconciliation__metrics span{font-size:10.5px;color:var(--muted);line-height:1.35}.reconciliation__metrics b{font-size:15px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.reconciliation__metrics .reconciliation__forecast{background:var(--ink);color:#fff}.reconciliation__forecast span{color:rgb(255 255 255 / 78%)}
    .reconciliation__variance{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-top:8px;padding:10px;border-radius:10px;background:var(--surface-2);font-size:11.5px}.reconciliation__variance strong{flex-shrink:0;font-variant-numeric:tabular-nums}.reconciliation__variance--higher{background:var(--warn-soft)}.reconciliation__variance--higher strong,.higher{color:var(--warn)}.reconciliation__variance--lower{background:var(--ok-soft)}.reconciliation__variance--lower strong,.lower{color:var(--ok)}
    .reconciliation__explanation,.reconciliation__unit p{margin:8px 0;font-size:11px;line-height:1.5;color:var(--muted)}.reconciliation__details{border-top:1px solid var(--line);margin-top:10px;padding-top:2px}.reconciliation__details>summary{padding:10px 0;color:var(--ink);font-size:12px;font-weight:650;cursor:pointer}.reconciliation__details>summary span{display:block;margin-left:15px;margin-top:2px;color:var(--muted);font-size:10px;font-weight:400}.reconciliation__streams{display:grid;gap:8px}.stream{padding:10px;border:1px solid var(--line);border-radius:10px}.stream header{display:grid;gap:3px}.stream header b{font-size:12px}.stream header small{font-size:10px;color:var(--muted)}.stream dl{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin:9px 0 0}.stream dt{font-size:10px;color:var(--muted)}.stream dd{margin:3px 0 0;font-size:11px;font-weight:700;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}.stream p{margin:8px 0 0;font-size:11px;line-height:1.45}
    .reconciliation__unit{margin-top:12px;padding:12px 0;border-top:1px solid var(--line)}.reconciliation__unit>div{display:flex;align-items:baseline;justify-content:space-between;gap:10px;font-size:12px}.reconciliation__unit>div b{flex-shrink:0;font-variant-numeric:tabular-nums}.reconciliation__unit .reconciliation__markup{margin-top:8px;font-size:11px}.reconciliation__markup span{color:var(--muted)}
    .reconciliation__products{display:grid;gap:8px}.product-cost{padding:10px;border:1px solid var(--line);border-radius:10px}.product-cost>a{display:block;overflow-wrap:anywhere;font-size:12px;font-weight:700;color:var(--rose-dark);text-decoration:none}.product-cost>small{display:block;margin-top:3px;color:var(--muted);font-size:10px}.product-cost dl{display:grid;gap:7px;margin:10px 0 0}.product-cost dl>div{display:flex;justify-content:space-between;gap:10px;font-size:11px}.product-cost dt{color:var(--muted)}.product-cost dd{margin:0;flex-shrink:0;font-weight:650;font-variant-numeric:tabular-nums}.product-cost>p{font-size:11px;line-height:1.4}.reconciliation__notes ul{padding-left:16px;margin:2px 0 10px;color:var(--muted);font-size:11px;line-height:1.5}.reconciliation__notes li+li{margin-top:5px}
    .reconciliation__actions{display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin-top:9px}.reconciliation__actions .btn{white-space:normal;text-align:left}.reconciliation__actions>a{color:var(--rose-dark);font-size:11px;font-weight:650;text-decoration:none}.reconciliation__actions>a:hover{text-decoration:underline}
  `,
})
export class PurchaseReconciliation {
  readonly data = input<Reconciliation | null | undefined>(undefined);
  readonly orderId = input.required<number>();
  readonly orderNumber = input.required<string>();
  readonly dirty = input(false);
  readonly downloading = signal(false);
  readonly statusLabel = reconciliationStatusLabel;
  private readonly sourcing = inject(SourcingApi);
  private readonly ui = inject(Ui);

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
