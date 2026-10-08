import { DestroyRef, Directive, ElementRef, afterNextRender, inject, signal } from '@angular/core';

/**
 * Says that a wide table goes on beyond the edge. Every `.inv-scroll` box
 * scrolls sideways when the step is narrow; without a sign the columns to
 * the right (often the figure that counts) look as if they do not exist.
 * The directive measures the box and sets `inv-scroll--right` / `--left`
 * while there is more on that side; styles/inventory-closing.scss fades
 * that edge. Scrolling to the end takes the fade away.
 */
@Directive({
  selector: '.inv-scroll',
  host: {
    '[class.inv-scroll--right]': 'right()',
    '[class.inv-scroll--left]': 'left()',
    '[attr.tabindex]': 'right() || left() ? 0 : null',
    '(scroll)': 'measure()',
  },
})
export class InventoryScrollCue {
  private readonly box = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  readonly right = signal(false);
  readonly left = signal(false);

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      this.measure();
      if (typeof ResizeObserver !== 'function') return;
      const observer = new ResizeObserver(() => this.measure());
      observer.observe(this.box);
      for (const child of Array.from(this.box.children)) observer.observe(child);
      destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  measure(): void {
    const { scrollLeft, scrollWidth, clientWidth } = this.box;
    this.left.set(scrollLeft > 1);
    this.right.set(scrollWidth - clientWidth - scrollLeft > 1);
  }
}
