import { Directive, ElementRef, inject, input, output } from '@angular/core';
import { ROW_LONG_PRESS_MS, ROW_LONG_PRESS_SLOP_PX } from './row-actions';
import type { MenuPoint } from './context-menu-position';

/**
 * The two ways a row asks for its menu: a right-click on a desk, a finger
 * (or a held mouse button) that stays put on a phone. Both arrive as one
 * event with the point the menu should open at. A press that turns into a
 * scroll never fires, and the ghost click after a long press is swallowed
 * so the row underneath is not toggled as well.
 */
@Directive({
  selector: '[appMenuTrigger]',
  host: {
    '(pointerdown)': 'onPointerDown($event)',
    '(pointermove)': 'onPointerMove($event)',
    '(pointerup)': 'onPointerEnd()',
    '(pointercancel)': 'onPointerEnd()',
    '(contextmenu)': 'onContextMenu($event)',
    '(click)': 'onClick($event)',
  },
})
export class MenuTrigger {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly menuTrigger = output<MenuPoint>();
  readonly menuTriggerDisabled = input(false, { alias: 'appMenuTriggerDisabled' });

  private hold: ReturnType<typeof setTimeout> | null = null;
  private pointerId: number | null = null;
  private startX = 0;
  private startY = 0;
  private firedAt = 0;

  onPointerDown(event: PointerEvent): void {
    if (this.menuTriggerDisabled() || !event.isPrimary || event.button !== 0) return;
    if (this.isInteractiveChild(event.target)) return;
    this.clearHold();
    this.pointerId = event.pointerId;
    this.startX = event.clientX;
    this.startY = event.clientY;
    const point = { x: event.clientX, y: event.clientY };
    this.hold = setTimeout(() => {
      this.hold = null;
      this.pointerId = null;
      this.firedAt = Date.now();
      this.menuTrigger.emit(point);
    }, ROW_LONG_PRESS_MS);
  }

  onPointerMove(event: PointerEvent): void {
    if (this.pointerId !== event.pointerId || this.hold === null) return;
    const moved = Math.hypot(event.clientX - this.startX, event.clientY - this.startY);
    if (moved >= ROW_LONG_PRESS_SLOP_PX) this.clearHold();
  }

  onPointerEnd(): void {
    this.clearHold();
  }

  onContextMenu(event: MouseEvent): void {
    if (this.menuTriggerDisabled()) return;
    event.preventDefault();
    this.clearHold();
    /* Android fires contextmenu after the same long press; one menu is enough. */
    if (Date.now() - this.firedAt < 1000) return;
    this.firedAt = Date.now();
    this.menuTrigger.emit({ x: event.clientX, y: event.clientY });
  }

  /** The click that trails a long press on a touch screen must not toggle the row. */
  onClick(event: MouseEvent): void {
    if (Date.now() - this.firedAt < 700) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  private clearHold(): void {
    if (this.hold !== null) clearTimeout(this.hold);
    this.hold = null;
    this.pointerId = null;
  }

  /** A press on a button inside the row means that button, not the row menu. */
  private isInteractiveChild(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false;
    const control = target.closest('button, a, select, textarea, input:not([type="checkbox"]):not([type="radio"])');
    return control !== null && control !== this.host.nativeElement;
  }
}
