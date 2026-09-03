import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { ProductDesk } from './product-desk';
import { ProductView } from './product-view';

/**
 * One route, the right screen for the room: the product desk on a wide
 * viewport, the guided product view on a phone. Both read the product id
 * from the route themselves.
 */
@Component({
  selector: 'app-product-screen',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ProductDesk, ProductView],
  template: `
    @if (desktop.active()) {
      <app-product-desk />
    } @else {
      <app-product-view />
    }
  `,
})
export class ProductScreen {
  readonly desktop = inject(DesktopViewport);
}
