import { DestroyRef, Signal, afterNextRender, inject, signal } from '@angular/core';

/**
 * The inspector of a workspace docks as a column beside the list when the
 * page host is at least this wide; below that it slides in as a drawer
 * (.wk-inspector--drawer) over the list. Both workspaces use this rule:
 *
 *   readonly width = elementWidth(() => this.host.nativeElement);
 *   readonly docked = computed(() => this.width() >= WK_DOCK_MIN_PX);
 */
export const WK_DOCK_MIN_PX = 1000;

/**
 * The live width of an element, in CSS pixels. Call it in an injection
 * context (a field initialiser or the constructor): it measures after the
 * first render, follows the element with a ResizeObserver and stops when
 * the caller is destroyed. 0 until measured.
 */
export function elementWidth(target: () => Element | null | undefined): Signal<number> {
  const width = signal(0);
  let observer: ResizeObserver | null = null;
  afterNextRender(() => {
    const element = target();
    if (!element) return;
    width.set(element.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    observer = new ResizeObserver(() => width.set(element.getBoundingClientRect().width));
    observer.observe(element);
  });
  inject(DestroyRef).onDestroy(() => observer?.disconnect());
  return width.asReadonly();
}
