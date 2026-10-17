import { ChangeDetectionStrategy, Component, ViewEncapsulation } from '@angular/core';

/**
 * Carries the Producten list's area partial (styles/products/_list.scss) into
 * the list's lazy chunk. The initial bundle sits at its 1 MB error budget, so
 * the area partials are not global; their rules are scoped under the host
 * elements (app-product-list, app-product-list-table), hence no emulation.
 * Renders nothing.
 */
@Component({
  selector: 'app-product-list-styles',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
  styleUrl: '../../../styles/products/_list.scss',
  encapsulation: ViewEncapsulation.None,
  host: { hidden: '' },
})
export class ProductListStyles {}
