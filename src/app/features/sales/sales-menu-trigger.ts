import { Directive, ElementRef, OnDestroy, inject, input, output } from '@angular/core';
import { SalesMenuGesture } from './sales-menu-gesture';

@Directive({ selector: '[appSalesMenu]' })
export class SalesMenuTrigger implements OnDestroy {
  readonly disabled = input(false, { alias: 'appSalesMenuDisabled' });
  readonly salesMenu = output<void>();
  private readonly gesture = new SalesMenuGesture(inject<ElementRef<HTMLElement>>(ElementRef).nativeElement,
    () => this.disabled(), () => this.salesMenu.emit());
  ngOnDestroy(): void { this.gesture.destroy(); }
}
