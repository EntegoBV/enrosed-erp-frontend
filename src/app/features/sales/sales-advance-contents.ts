import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthImage } from '../../core/api/auth-image';
import type { Product, PurchaseOrderView, SalesOrderView } from '../../core/api/models';
import { SourcingApi } from '../../core/api/sourcing-api';
import { CbmPipe, DateNlPipe, EurPipe, NumPipe, WeekNlPipe } from '../../shared/pipes';
import { advanceContentsFor, advanceContentsSummary, advanceProductPhoto } from './sales-advance-contents-state';
import { advancePurchasePricing } from './sales-advance-pricing';

@Component({
  selector: 'app-sales-advance-contents',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AuthImage, CbmPipe, DateNlPipe, EurPipe, NumPipe, WeekNlPipe],
  template: `
    <section class="advance-contents" [attr.aria-label]="mode() === 'products' ? 'Productinhoud van de partnercontainer' : 'Levering van de partnercontainer'">
      <header><div><span>Partnercontainer</span><h2>{{ mode() === 'products' ? 'Producten & prijzen' : 'Transport & levering' }}</h2></div>
        @if (view().order.partnerPurchaseOrderId; as purchaseId) { <a [routerLink]="['/purchasing', purchaseId]">{{ contents()?.purchaseOrderNumber || 'Inkooporder bekijken' }} <span aria-hidden="true">↗</span></a> }
      </header>
      @if (contents(); as contents) {
        @if (mode() === 'products') {
          <p>De volledige containerinhoud bij dit voorschot. Deze aantallen gelden voor de hele container; het factuurbedrag is alleen het voorschot van deze termijn.</p>
          <div class="contents-summary"><b>{{ summary().pieces }}</b><span>{{ summary().load }}</span><span>{{ summary().volume }}</span></div>
          <div class="contents-pricing-source">
            <span>{{ pricingLoading() ? 'Inkoopprijzen laden…' : 'Actuele inkoopprijzen · excl. btw' }}</span>
            <button type="button" (click)="refreshPrices()" [disabled]="pricingLoading()" aria-label="Inkoopprijzen vernieuwen">Vernieuwen <span aria-hidden="true">↻</span></button>
          </div>
          @if (pricingError()) { <p class="contents-price-error" role="status">De inkoopprijzen konden niet worden geladen. Je kunt ze opnieuw ophalen met Vernieuwen.</p> }
          @if (pricing()?.contentsDiffer) { <p class="contents-price-error">De actuele inkoopinhoud wijkt af van de vastgelegde containerinhoud. Bij afwijkende aantallen staat de inkoophoeveelheid naast het regeltotaal.</p> }
          <ul class="contents-list">
            @for (line of contents.lines; track $index) {
              @let price = pricing()?.lines?.[$index];
              <li>
                <a class="contents-product" [routerLink]="['/products', line.productId]">
                  @if (photo(line.productId); as photoUrl) { <img [appAuthSrc]="photoUrl" alt="" width="60" height="60" loading="lazy" /> }
                  @else { <span class="contents-photo-empty" aria-hidden="true">◇</span> }
                  <span><b>{{ line.productName }}</b><small>{{ line.sku }}</small></span>
                </a>
                <div class="contents-quantity"><strong>{{ line.quantity | num }} <small>stuks</small></strong><span>{{ line.cartons != null ? (line.cartons | num) + ' dozen' : 'Verpakking nog te bevestigen' }}</span></div>
                <div class="contents-price"><span>Prijs / stuk</span><strong>{{ price?.unitPriceEur != null ? (price!.unitPriceEur | eur: 4) : '—' }}</strong></div>
                <div class="contents-price contents-price--total"><span>{{ price?.quantityDiffers ? 'Totaal inkoop' : 'Regeltotaal' }}</span><strong>{{ price?.totalEur != null ? (price!.totalEur | eur) : '—' }}</strong>
                  @if (price?.quantityDiffers) { <small>Bij {{ price!.quantity | num }} stuks inkoop</small> }
                  @else if (!pricingLoading() && price?.totalEur == null) { <small>Prijs niet beschikbaar</small> }
                </div>
              </li>
            } @empty { <li>De productinhoud is nog niet vastgelegd. Bekijk de inkooporder.</li> }
          </ul>
          @if (pricing(); as price) {
            <dl class="contents-totals">
              <div><dt>Producten · hele container</dt><dd>{{ price.goodsTotalEur != null ? (price.goodsTotalEur | eur) : '—' }}</dd></div>
              @if (price.separateCostsEur != null && price.separateCostsEur > 0) {
                <div><dt>Aparte kosten @if (price.separateCostsIncluded) { <small>al in de productprijzen</small> }</dt><dd>{{ price.separateCostsIncluded ? 'Inbegrepen' : (price.separateCostsEur | eur) }}</dd></div>
              }
              <div class="contents-totals__purchase"><dt>Totaal inkoop incl. aparte kosten</dt><dd>{{ price.totalEur != null ? (price.totalEur | eur) : '—' }}</dd></div>
            </dl>
          }
          <div class="contents-claim"><span>Deze voorschotfactuur <small>excl. btw</small></span><strong>{{ view().priced.totals.total | eur }}</strong></div>
          <p class="contents-note">De inkoopprijzen zijn alleen voor intern inzicht. Het bedrag van deze voorschotfactuur blijft vaststaan; op de PDF staan de producten zonder prijzen.</p>
        } @else {
          <p>De lading en planning van de container zoals vastgelegd bij deze factuur.</p>
          <dl class="contents-delivery">
            <div><dt>Lading</dt><dd>{{ summary().load }}</dd></div>
            <div><dt>Volume</dt><dd>{{ contents.totals.cbm != null ? (contents.totals.cbm | cbm) : 'Nog te bevestigen' }}</dd></div>
            <div><dt>Gewicht</dt><dd>{{ contents.totals.weightKg != null ? (contents.totals.weightKg | num: 1) + ' kg' : 'Nog te bevestigen' }}</dd></div>
            @if (contents.delivery.containerType) { <div><dt>Container</dt><dd>{{ contents.delivery.containerType }}</dd></div> }
            @if (contents.delivery.loadMode) { <div><dt>Laadwijze</dt><dd>{{ contents.delivery.loadMode === 'LOOSE_CARTONS' ? 'Losse dozen' : contents.delivery.loadMode === 'PALLETS' ? 'Op pallets' : contents.delivery.loadMode }}</dd></div> }
            @if (contents.totals.pallets != null) { <div><dt>Pallets</dt><dd>{{ contents.totals.pallets | num }}</dd></div> }
            @if (contents.delivery.destinationCountry) { <div><dt>Bestemmingsland</dt><dd>{{ contents.delivery.destinationCountry }}</dd></div> }
            @if (contents.delivery.departurePort || contents.delivery.destinationPort) { <div><dt>Havenroute</dt><dd>{{ contents.delivery.departurePort || 'Vertrek nog te bevestigen' }} → {{ contents.delivery.destinationPort || 'Bestemming nog te bevestigen' }}</dd></div> }
            @if (contents.delivery.shippedOn) { <div><dt>Verscheept</dt><dd>{{ contents.delivery.shippedOn | dateNl }}</dd></div> }
            @if (contents.delivery.receivedOn) { <div><dt>Container ontvangen</dt><dd>{{ contents.delivery.receivedOn | dateNl }}</dd></div> }
            <div><dt>Verwachte aankomst</dt><dd>{{ contents.delivery.expectedArrival ? (contents.delivery.expectedArrival | dateNl) : 'Nog te bevestigen' }}</dd></div>
            <div><dt>Leverweek</dt><dd>{{ contents.delivery.deliveryWeek ? (contents.delivery.deliveryWeek | weekNl) : 'Nog te bevestigen' }}</dd></div>
          </dl>
          <p class="contents-note">De voorschotfactuur is geen verzendbevestiging. Bekijk de inkooporder voor de actuele planning.</p>
        }
      } @else {
        <p role="status">De vastgelegde containerinhoud is nog niet beschikbaar. Bekijk de inkooporder voor de producten en leverafspraken.</p>
      }
    </section>
  `,
  styles: `
    :host{display:block;min-width:0}.advance-contents{padding:18px;background:var(--surface);border:1px solid var(--line);border-radius:14px}header{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}header div>span{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:700}h2{font-size:18px;margin:4px 0 0}header>a{font-size:12px;color:var(--rose-dark);display:flex;align-items:center;gap:8px;min-height:40px;overflow-wrap:anywhere}p{font-size:12px;line-height:1.6;color:var(--muted);margin:12px 0}.contents-summary{display:flex;gap:8px 16px;flex-wrap:wrap;font-size:12px;padding:12px 0;border-bottom:1px solid var(--line)}.contents-list{margin:0;padding:0;list-style:none}.contents-list li{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:13px 0;border-bottom:1px solid var(--line)}.contents-product{display:flex;gap:12px;align-items:center;min-width:0;color:inherit;text-decoration:none}.contents-product>span:not(.contents-photo-empty){display:grid;gap:5px;min-width:0}.contents-product b{font-size:13px;overflow-wrap:anywhere}.contents-product small{font-size:11px;color:var(--muted);overflow-wrap:anywhere}.contents-product img,.contents-photo-empty{width:60px;height:60px;flex:none;background:var(--surface-2);border:1px solid var(--line);border-radius:10px;object-fit:contain}.contents-photo-empty{display:grid;place-items:center;color:var(--muted)}.contents-quantity{text-align:right;display:grid;gap:5px;flex-shrink:0}.contents-quantity strong{font-size:15px;font-variant-numeric:tabular-nums}.contents-quantity strong small{font-size:11px;font-weight:400}.contents-quantity>span{font-size:11px;color:var(--muted)}.contents-note{font-size:11px;margin-bottom:0}.contents-delivery{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(210px,100%),1fr));gap:14px 20px;margin:16px 0}.contents-delivery>div{display:grid;gap:5px;min-width:0}.contents-delivery dt{font-size:11px;color:var(--muted)}.contents-delivery dd{margin:0;font-size:13px;font-weight:650;overflow-wrap:anywhere}@media(max-width:440px){.advance-contents{padding:14px}.contents-list li{align-items:flex-start;gap:9px;flex-wrap:wrap}.contents-product{flex:1 1 100%;gap:10px}.contents-product img,.contents-photo-empty{width:48px;height:48px}.contents-quantity{margin-left:58px;text-align:left;display:flex;align-items:center;gap:12px;flex-wrap:wrap}.contents-delivery{grid-template-columns:1fr 1fr;gap:15px 12px}}
    :host{container-type:inline-size}.contents-pricing-source{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:6px 0;color:var(--muted);font-size:11px}.contents-pricing-source button{display:inline-flex;align-items:center;gap:6px;min-height:40px;padding:6px 0 6px 10px;border:0;background:transparent;color:var(--rose-dark);font:inherit;font-weight:650;cursor:pointer}.contents-pricing-source button:disabled{opacity:.5;cursor:wait}.contents-pricing-source button:focus-visible{outline:2px solid var(--rose);outline-offset:3px;border-radius:5px}.contents-list li{display:grid;grid-template-columns:minmax(0,1fr) auto auto auto;gap:16px}.contents-price{display:grid;gap:5px;text-align:right;font-variant-numeric:tabular-nums}.contents-price>span,.contents-price small{font-size:10px;color:var(--muted)}.contents-price strong{font-size:13px;white-space:nowrap}.contents-price--total strong{font-size:15px;color:var(--ink)}.contents-price-error{padding:10px 12px;border-radius:9px;background:var(--surface-2);margin:6px 0;font-size:11px}.contents-totals{margin:12px 0 0;display:grid;gap:8px}.contents-totals>div{display:flex;align-items:baseline;justify-content:space-between;gap:16px}.contents-totals dt{font-size:12px;color:var(--muted)}.contents-totals dt small{display:block;font-size:10px}.contents-totals dd{margin:0;font-size:13px;font-weight:650;font-variant-numeric:tabular-nums;white-space:nowrap}.contents-totals__purchase{padding-top:10px;border-top:1px solid var(--line)}.contents-totals__purchase dt{color:var(--ink);font-weight:650}.contents-totals__purchase dd{font-size:16px}.contents-claim{margin-top:16px;padding:13px 14px;background:var(--rose-soft);border:1px solid var(--rose-line);border-radius:11px;display:flex;justify-content:space-between;align-items:center;gap:14px;color:var(--rose-dark)}.contents-claim>span{font-size:12px;font-weight:650}.contents-claim small{display:block;font-size:10px;font-weight:400;margin-top:3px}.contents-claim strong{font-size:19px;white-space:nowrap;font-variant-numeric:tabular-nums}
    @container(max-width:640px){.contents-list li{grid-template-columns:minmax(0,1fr) auto;gap:7px 12px;padding:14px 0;align-items:start}.contents-product{grid-column:1/-1;gap:10px;margin-bottom:3px}.contents-product img,.contents-photo-empty{width:48px;height:48px}.contents-quantity{grid-column:1;grid-row:2;text-align:left;margin:0;display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}.contents-quantity strong{font-size:13px}.contents-price:not(.contents-price--total){grid-column:1;grid-row:3;text-align:left;display:flex;align-items:baseline;gap:7px;flex-wrap:wrap}.contents-price--total{grid-column:2;grid-row:2/4;align-self:center}.contents-price--total small{max-width:140px}.contents-price--total strong{font-size:16px}.contents-totals dt{font-size:11px}.contents-totals__purchase dd{font-size:15px}}
  `,
})
export class SalesAdvanceContents {
  private readonly sourcing = inject(SourcingApi);
  readonly view = input.required<SalesOrderView>();
  readonly products = input<readonly Product[]>([]);
  readonly mode = input<'products' | 'delivery'>('products');
  readonly contents = computed(() => advanceContentsFor(this.view()));
  readonly summary = computed(() => advanceContentsSummary(this.view()));
  private readonly purchaseId = computed(() => this.mode() === 'products' ? this.contents()?.purchaseOrderId ?? null : null);
  private readonly purchase = signal<PurchaseOrderView | null>(null);
  private readonly pricingRevision = signal(0);
  readonly pricingLoading = signal(false);
  readonly pricingError = signal(false);
  readonly pricing = computed(() => advancePurchasePricing(this.view(), this.purchase()));

  constructor() {
    effect(onCleanup => {
      const id = this.purchaseId();
      this.pricingRevision();
      let active = true;
      onCleanup(() => { active = false; });
      this.purchase.set(null);
      this.pricingError.set(false);
      this.pricingLoading.set(id != null);
      if (id == null) return;
      void this.sourcing.purchaseOrder(id).then(purchase => {
        if (active) this.purchase.set(purchase);
      }).catch(() => {
        if (active) this.pricingError.set(true);
      }).finally(() => {
        if (active) this.pricingLoading.set(false);
      });
    });
  }

  refreshPrices(): void { this.pricingRevision.update(revision => revision + 1); }
  photo(productId: number): string | null { return advanceProductPhoto(this.products(), productId); }
}
