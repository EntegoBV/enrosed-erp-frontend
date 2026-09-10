import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthImage } from '../../core/api/auth-image';
import type { Product, SalesOrderView } from '../../core/api/models';
import { CbmPipe, DateNlPipe, NumPipe, WeekNlPipe } from '../../shared/pipes';
import { advanceContentsFor, advanceContentsSummary, advanceProductPhoto } from './sales-advance-contents-state';

@Component({
  selector: 'app-sales-advance-contents',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AuthImage, CbmPipe, DateNlPipe, NumPipe, WeekNlPipe],
  template: `
    <section class="advance-contents" [attr.aria-label]="mode() === 'products' ? 'Productinhoud van de partnercontainer' : 'Levering van de partnercontainer'">
      <header><div><span>Partnercontainer</span><h2>{{ mode() === 'products' ? 'Producten & aantallen' : 'Transport & levering' }}</h2></div>
        @if (view().order.partnerPurchaseOrderId; as purchaseId) { <a [routerLink]="['/purchasing', purchaseId]">{{ contents()?.purchaseOrderNumber || 'Inkooporder bekijken' }} <span aria-hidden="true">↗</span></a> }
      </header>
      @if (contents(); as contents) {
        @if (mode() === 'products') {
          <p>De volledige containerinhoud bij dit voorschot. Deze aantallen gelden voor de hele container; het factuurbedrag is alleen het voorschot van deze termijn.</p>
          <div class="contents-summary"><b>{{ summary().pieces }}</b><span>{{ summary().load }}</span><span>{{ summary().volume }}</span></div>
          <ul class="contents-list">
            @for (line of contents.lines; track $index) {
              <li>
                <a class="contents-product" [routerLink]="['/products', line.productId]">
                  @if (photo(line.productId); as photoUrl) { <img [appAuthSrc]="photoUrl" alt="" width="60" height="60" loading="lazy" /> }
                  @else { <span class="contents-photo-empty" aria-hidden="true">◇</span> }
                  <span><b>{{ line.productName }}</b><small>{{ line.sku }}</small></span>
                </a>
                <div class="contents-quantity"><strong>{{ line.quantity | num }} <small>stuks</small></strong><span>{{ line.cartons != null ? (line.cartons | num) + ' dozen' : 'Verpakking nog te bevestigen' }}</span></div>
              </li>
            } @empty { <li>De productinhoud is nog niet vastgelegd. Bekijk de inkooporder.</li> }
          </ul>
          <p class="contents-note">Producten en aantallen zijn vastgelegd bij deze factuur. Hier staan geen productprijzen.</p>
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
  `,
})
export class SalesAdvanceContents {
  readonly view = input.required<SalesOrderView>();
  readonly products = input<readonly Product[]>([]);
  readonly mode = input<'products' | 'delivery'>('products');
  readonly contents = computed(() => advanceContentsFor(this.view()));
  readonly summary = computed(() => advanceContentsSummary(this.view()));
  photo(productId: number): string | null { return advanceProductPhoto(this.products(), productId); }
}
