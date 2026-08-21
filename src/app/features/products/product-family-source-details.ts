import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import {
  Product,
  ProductFamily,
  ProductPackage,
  ProductPriceObservation,
} from '../../core/api/models';

@Component({
  selector: 'app-product-family-source-details',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <details class="source-details">
      <summary>
        <span
          ><b>Bronnen &amp; technische gegevens</b
          ><small>Alleen nodig bij controle of migratieproblemen.</small></span
        >
        @if (family().conflicts.length) {
          <span class="issue-count">{{ family().conflicts.length }} conflict(en)</span>
        }
      </summary>
      <div class="source-details__body">
        <p class="source-note">
          Deze waarden zijn alleen-lezen zodat herkomst en bronmatches intact blijven.
        </p>

        <h4>Bronmaten &amp; verpakking</h4>
        <dl class="technical-list">
          <div>
            <dt>Model</dt>
            <dd>{{ sourceDimensions() }}</dd>
          </div>
          @for (item of family().packages; track item.id || item.sourceKey) {
            <div>
              <dt>{{ item.packageType || 'Verpakking' }} · {{ item.sourceKey }}</dt>
              <dd>{{ packageSummary(item) }}</dd>
            </div>
          } @empty {
            <div>
              <dt>Verpakkingen</dt>
              <dd>Geen bronverpakking vastgelegd</dd>
            </div>
          }
        </dl>

        <h4>Bronprijzen</h4>
        <p class="source-note">
          Alleen-lezen. Een bedrag wordt pas een operationele inkoop- of verkoopprijs nadat
          valuta, belasting en commerciële context zijn bevestigd.
        </p>
        <dl class="technical-list">
          @for (item of priceRows(); track item.id) {
            <div>
              <dt>{{ priceContext(item.context) }} · {{ item.sourceType || 'bron' }}</dt>
              <dd>
                <b class="num">{{ priceAmount(item) }}</b>
                @if (item.incoterm) { · {{ item.incoterm }} }
                @if (item.market) { · {{ item.market }} }
                @if (item.taxContext) { · belasting {{ item.taxContext }} }
                @if (item.sourceLocation) {
                  <small class="source-location">{{ item.sourceLocation }}</small>
                }
              </dd>
            </div>
          } @empty {
            <div>
              <dt>Prijsobservaties</dt>
              <dd>Geen bronprijs voor deze variant vastgelegd</dd>
            </div>
          }
        </dl>

        <h4>Externe identificaties</h4>
        <dl class="technical-list">
          @if (product().canonicalVariantKey) {
            <div>
              <dt>Canonieke variant</dt>
              <dd class="mono">{{ product().canonicalVariantKey }}</dd>
            </div>
          }
          @if (product().canonicalBarcode) {
            <div>
              <dt>Canonieke barcode</dt>
              <dd class="mono">{{ product().canonicalBarcode }}</dd>
            </div>
          }
          @for (
            identifier of family().externalIdentifiers;
            track identifier.source + identifier.identifierType + identifier.value
          ) {
            <div>
              <dt>{{ identifier.source }} · {{ identifier.identifierType }}</dt>
              <dd class="mono">{{ identifier.value }}</dd>
            </div>
          } @empty {
            @if (!product().canonicalVariantKey && !product().canonicalBarcode) {
              <div>
                <dt>Identificaties</dt>
                <dd>Geen vastgelegd</dd>
              </div>
            }
          }
        </dl>

        @if (family().conflicts.length) {
          <h4>Bronconflicten</h4>
          <ul class="conflict-list">
            @for (conflict of family().conflicts; track conflict.fieldName + conflict.reason) {
              <li>
                <b>{{ conflict.fieldName }}</b
                ><span>{{ conflict.reason }}</span>
              </li>
            }
          </ul>
        }

        <h4>Herkomst per veld</h4>
        <dl class="technical-list">
          @for (
            item of family().provenance;
            track item.fieldName + item.source + item.sourceRecordKey
          ) {
            <div>
              <dt>{{ item.fieldName }}</dt>
              <dd>
                {{ item.source }}
                @if (item.sourceRecordKey) {
                  · <span class="mono">{{ item.sourceRecordKey }}</span>
                }
              </dd>
            </div>
          } @empty {
            <div>
              <dt>Herkomst</dt>
              <dd>Nog geen migratiegegevens</dd>
            </div>
          }
        </dl>
      </div>
    </details>
  `,
  styles: `
    .issue-count {
      display: inline-flex;
      flex: 0 0 auto;
      padding: 3px 7px;
      border-radius: 999px;
      background: var(--warn-soft);
      color: var(--warn);
      font-size: 9px;
      font-weight: 750;
      text-transform: uppercase;
    }
    .source-location { display: block; margin-top: 2px; color: var(--muted); }
  `,
})
export class ProductFamilySourceDetails {
  readonly product = input.required<Product>();
  readonly family = input.required<ProductFamily>();

  sourceDimensions(): string {
    const value = this.family().dimensions;
    if (!value) return 'Niet vastgelegd';
    if (value.raw) return value.raw;
    const dimensions = [value.length, value.width, value.height];
    return dimensions.some((item) => item !== null)
      ? `B × D × H · ${dimensions.map((item) => item ?? '—').join(' × ')} ${value.unit ?? ''}`.trim()
      : 'Niet vastgelegd';
  }

  packageSummary(item: ProductPackage): string {
    if (item.raw) return item.raw;
    const dimensions = [item.length, item.width, item.height];
    const size = dimensions.some((value) => value !== null)
      ? `B × D × H · ${dimensions.map((value) => value ?? '—').join(' × ')} ${item.dimensionUnit ?? ''}`.trim()
      : 'maat onbekend';
    return item.piecesPerPackage ? `${size} · ${item.piecesPerPackage} stuks` : size;
  }

  priceRows(): ProductPriceObservation[] {
    const productId = this.product().id;
    return this.family().priceObservations.filter((item) => (
      item.ownerType === 'FAMILY' || (productId !== null && item.productId === productId)
    ));
  }

  priceAmount(item: ProductPriceObservation): string {
    if (item.amount === null) return 'Bedrag onbekend';
    const amount = item.amount.toLocaleString('nl-BE', { minimumFractionDigits: 0, maximumFractionDigits: 4 });
    return item.currency ? `${item.currency} ${amount}` : `${amount} · valuta onbekend`;
  }

  priceContext(value: string): string {
    return ({
      ODOO_STRUCTURED_COST: 'Odoo kostprijs',
      EXW: 'EXW',
      FRANCE_SALES: 'Frankrijk verkoop',
      SHOPIFY_RETAIL: 'Historische retail',
      SHOPIFY_COMPARE_AT: 'Historische vergelijkprijs',
      PDF_UNIT_UNCLASSIFIED: 'PDF stukbedrag · niet geclassificeerd',
      PDF_TOTAL_UNCLASSIFIED: 'PDF totaal · niet geclassificeerd',
      NARRATIVE_UNCLASSIFIED: 'Narratief bedrag · niet geclassificeerd',
      CIF: 'CIF',
      PURCHASE: 'Inkoopobservatie',
    } as Record<string, string>)[value] ?? value;
  }
}
