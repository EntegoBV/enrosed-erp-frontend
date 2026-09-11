import { ROW_LONG_PRESS_MS, ROW_LONG_PRESS_SLOP_PX } from '../../shared/row-actions';

export function isSalesMenuInteractiveChild(host: HTMLElement, target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const control = target.closest('a, button, input, select, textarea, summary, [role="button"], [contenteditable]:not([contenteditable="false"])');
  return control !== null && control !== host;
}

/** Context actions without taking over the row's normal click or scrolling. */
export class SalesMenuGesture {
  private hold: ReturnType<typeof setTimeout> | null = null;
  private press: { id: number; x: number; y: number; fired: boolean } | null = null;
  private suppressClickUntil = 0;
  private openedAt = 0;
  private ignoreTouchContext = false;
  private ghostTimer: ReturnType<typeof setTimeout> | null = null;
  private ghostWatching = false;

  constructor(private readonly host: HTMLElement, private readonly disabled: () => boolean, private readonly open: () => void) {
    host.addEventListener('pointerdown', this.start, { passive: true });
    host.addEventListener('contextmenu', this.context);
    host.addEventListener('keydown', this.key);
    // Capture precedes RouterLink and the container's click-to-expand handler.
    host.addEventListener('click', this.click, true);
  }

  private interactiveChild(target: EventTarget | null): boolean {
    return isSalesMenuInteractiveChild(this.host, target);
  }

  private readonly start = (event: PointerEvent): void => {
    if (event.pointerType !== 'touch' && event.pointerType !== 'pen') { this.ignoreTouchContext = false; return; }
    if (!event.isPrimary || event.button !== 0) { this.cancel(true); return; }
    if (this.disabled() || this.interactiveChild(event.target)) return;
    this.cancel(); this.suppressClickUntil = 0; this.ignoreTouchContext = false;
    this.press = { id: event.pointerId, x: event.clientX, y: event.clientY, fired: false };
    this.watch(true);
    this.hold = setTimeout(() => {
      this.hold = null;
      if (!this.press || this.disabled() || !this.host.isConnected) { this.cancel(); return; }
      this.press.fired = true;
      this.suppressClickUntil = Infinity;
      this.openedAt = Date.now();
      this.guardRetargetedClick();
      this.open();
    }, ROW_LONG_PRESS_MS);
  };

  private readonly move = (event: PointerEvent): void => {
    const press = this.press;
    if (!press || press.id !== event.pointerId || press.fired) return;
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) >= ROW_LONG_PRESS_SLOP_PX) this.cancel(true);
  };

  private readonly end = (event: PointerEvent): void => {
    if (this.press?.id === event.pointerId) this.cancel(event.type === 'pointercancel');
  };

  private readonly anotherPointer = (event: PointerEvent): void => {
    if (this.press && event.pointerId !== this.press.id) this.cancel(true);
  };

  private readonly scroll = (): void => { if (!this.press?.fired) this.cancel(true); };

  private readonly context = (event: MouseEvent): void => {
    if (this.disabled() || this.interactiveChild(event.target)) return;
    event.preventDefault(); event.stopPropagation();
    if (this.ignoreTouchContext && (event as PointerEvent).pointerType !== 'mouse') return;
    // Native Android contextmenu can follow the touch hold that already opened it.
    if (this.press?.fired || Date.now() - this.openedAt < 700) return;
    if (this.press) {
      if (this.hold !== null) clearTimeout(this.hold);
      this.hold = null; this.press.fired = true; this.suppressClickUntil = Infinity;
    } else {
      this.cancel(); this.suppressClickUntil = Date.now() + 700;
    }
    this.openedAt = Date.now();
    this.guardRetargetedClick();
    this.open();
  };

  private readonly key = (event: KeyboardEvent): void => {
    if (this.disabled() || this.interactiveChild(event.target)
      || !(event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) return;
    event.preventDefault(); event.stopPropagation(); this.cancel(); this.open();
  };

  private readonly click = (event: MouseEvent): void => {
    if (Date.now() > this.suppressClickUntil) return;
    event.preventDefault(); event.stopImmediatePropagation();
  };

  /** Opening a sheet can retarget touchend's compatibility click to its backdrop. */
  private guardRetargetedClick(): void {
    if (!this.ghostWatching) {
      this.host.ownerDocument.addEventListener('click', this.click as EventListener, true);
      this.host.ownerDocument.addEventListener('pointerdown', this.newIntent as EventListener, true);
      this.ghostWatching = true;
    }
    this.expireGhostGuard();
  }

  private readonly newIntent = (event: PointerEvent): void => {
    if (this.press?.id === event.pointerId) return;
    this.stopGhostGuard(); this.suppressClickUntil = 0;
  };

  private expireGhostGuard(): void {
    if (this.ghostTimer !== null) clearTimeout(this.ghostTimer);
    this.ghostTimer = null;
    if (this.ghostWatching && Number.isFinite(this.suppressClickUntil)) {
      this.ghostTimer = setTimeout(() => this.stopGhostGuard(), Math.max(0, this.suppressClickUntil - Date.now()) + 1);
    }
  }

  private stopGhostGuard(): void {
    if (this.ghostTimer !== null) clearTimeout(this.ghostTimer);
    this.ghostTimer = null;
    this.host.ownerDocument.removeEventListener('click', this.click as EventListener, true);
    this.host.ownerDocument.removeEventListener('pointerdown', this.newIntent as EventListener, true);
    this.ghostWatching = false;
  }

  private watch(on: boolean): void {
    const document = this.host.ownerDocument;
    const method = on ? 'addEventListener' : 'removeEventListener';
    document[method]('pointerdown', this.anotherPointer as EventListener, true);
    document[method]('pointermove', this.move as EventListener, true);
    document[method]('pointerup', this.end as EventListener, true);
    document[method]('pointercancel', this.end as EventListener, true);
    document[method]('scroll', this.scroll, true);
  }

  private cancel(ignoreNative = false): void {
    if (ignoreNative && this.press && !this.press.fired) this.ignoreTouchContext = true;
    if (this.hold !== null) clearTimeout(this.hold);
    this.hold = null;
    if (this.press?.fired) { this.suppressClickUntil = Date.now() + 700; this.expireGhostGuard(); }
    this.press = null; this.watch(false);
  }

  destroy(): void {
    this.cancel();
    this.stopGhostGuard();
    this.host.removeEventListener('pointerdown', this.start);
    this.host.removeEventListener('contextmenu', this.context);
    this.host.removeEventListener('keydown', this.key);
    this.host.removeEventListener('click', this.click, true);
  }
}
