import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Supplier } from '../core/api/models';
import { countryName } from '../core/api/geo';

/**
 * One presentation path for supplier addresses across supplier and purchasing screens.
 *
 * The locality line deliberately supports district/city/province combinations used by
 * Chinese suppliers instead of assuming the Belgian street/postcode structure.
 */
@Component({
  selector: 'app-supplier-address',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (lines().length) {
      <address class="supplier-address" [class.supplier-address--inline]="inline()">
        @if (inline()) {
          <span>{{ lines().join(' · ') }}</span>
        } @else {
          @for (line of lines(); track $index) { <span>{{ line }}</span> }
          @if (addressHint(); as hint) {
            <small class="supplier-address__hint">{{ hint }}</small>
          }
        }
      </address>
    } @else if (showEmpty()) {
      <span class="supplier-address__empty">Adres nog niet ingevuld</span>
    }
  `,
  styles: [`
    :host{display:block;min-width:0}
    .supplier-address{display:flex;min-width:0;flex-direction:column;color:inherit;font-size:inherit;font-style:normal;line-height:1.45}
    .supplier-address span{overflow-wrap:anywhere}
    .supplier-address--inline{display:block;overflow:hidden;color:var(--muted);font-size:10px;text-overflow:ellipsis;white-space:nowrap}
    .supplier-address--inline span{white-space:nowrap}
    .supplier-address__empty{color:var(--muted);font-size:11px;font-style:normal}
    .supplier-address__hint{margin-top:3px;color:var(--warn);font-size:9.5px;font-style:normal}
  `],
})
export class SupplierAddress {
  readonly supplier = input<Supplier | null>(null);
  readonly inline = input(false);
  readonly showEmpty = input(true);

  readonly lines = computed(() => {
    const supplier = this.supplier();
    if (!supplier) return [];
    const hasAnyLocation = [supplier.addressLine1, supplier.addressLine2,
      supplier.postalCode, supplier.city, supplier.region]
      .some((value) => !!value?.trim());
    if (!hasAnyLocation) return [];

    const locality = [supplier.city?.trim(), supplier.region?.trim()]
      .filter(Boolean).join(', ');
    const localityWithPostal = [supplier.postalCode?.trim(), locality]
      .filter(Boolean).join(' ');
    return [supplier.addressLine1?.trim(), supplier.addressLine2?.trim(),
      localityWithPostal, countryName(supplier.country)]
      .filter((value): value is string => !!value);
  });

  readonly addressHint = computed(() => {
    const supplier = this.supplier();
    if (!supplier || !this.lines().length) return null;
    if (!supplier.addressLine1?.trim() || !supplier.city?.trim()) {
      return 'Adres gedeeltelijk ingevuld';
    }
    if (supplier.country === 'CN'
        && (!supplier.region?.trim() || !/^\d{6}$/.test(supplier.postalCode?.trim() ?? ''))) {
      return 'Voor China: voeg provincie en 6-cijferige postcode toe';
    }
    return null;
  });
}
