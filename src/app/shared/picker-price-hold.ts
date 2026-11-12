import { DestroyRef, Directive, ElementRef, inject, input, output } from '@angular/core';
import { SalesMenuGesture } from '../features/sales/sales-menu-gesture';

/**
 * A long press on a picker row whose price is the customer's own (phone), a
 * right click or the menu key on the desk: the row shows its price note
 * instead of being ticked. Rows without a note keep their normal tap and
 * context menu.
 */
@Directive({ selector: '[appPickerPriceHold]' })
export class PickerPriceHold {
  readonly appPickerPriceHold = input(false);
  readonly priceHeld = output<void>();

  constructor() {
    const gesture = new SalesMenuGesture(inject<ElementRef<HTMLElement>>(ElementRef).nativeElement,
      () => !this.appPickerPriceHold(), () => this.priceHeld.emit());
    inject(DestroyRef).onDestroy(() => gesture.destroy());
  }
}
