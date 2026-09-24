import {
  DestroyRef,
  Directive,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { DesktopViewport } from '../core/platform/desktop-viewport';
import {
  ROW_SWIPE_AXIS_LOCK_PX,
  ROW_SWIPE_EDGE_GUARD_PX,
  clampSwipeOffset,
  swipeGeometry,
  swipeRelease,
} from './row-actions';
import type { RowSwipeSide } from './row-actions';

/** Taps on these never start a swipe: they have work of their own. */
const NO_SWIPE = '.ios-swipe__actions, input, select, textarea, [contenteditable], .ios-switch';
/** A click this soon after a drag is the drag's own ghost click. */
const GHOST_CLICK_MS = 350;

/**
 * iOS swipe actions on a phone list row, with any number of buttons per
 * side. The directive sits on the .ios-swipe wrapper and only moves the
 * row; the buttons are the host's own markup, first = outermost = the one
 * a full swipe runs:
 *
 *   <div class="ios-swipe" appSwipeActions #sw="swipeActions" [swipeStart]="1" [swipeEnd]="2"
 *        swipeFull="start" (swipeCommit)="…">
 *     <div class="ios-swipe__actions ios-swipe__actions--start">
 *       <button class="ios-swipe__btn tone-ok" (click)="…; sw.close()">…Betaald</button>
 *     </div>
 *     <div class="ios-swipe__actions ios-swipe__actions--end">…</div>
 *     <div class="ios-swipe__row">…the .ios-cell…</div>
 *   </div>
 *
 * Only one row stays open at a time; a tap elsewhere or Escape closes it.
 * Keyboard users reach the buttons with Tab: the CSS reveals the side that
 * holds focus. Inactive on a desk, where rows have a context menu instead.
 */
@Directive({
  selector: '[appSwipeActions]',
  exportAs: 'swipeActions',
  host: {
    '[style.--swipe-start-n]': 'swipeStart()',
    '[style.--swipe-end-n]': 'swipeEnd()',
    '(pointerdown)': 'onPointerDown($event)',
    '(pointermove)': 'onPointerMove($event)',
    '(pointerup)': 'onPointerUp($event)',
    '(pointercancel)': 'onPointerCancel($event)',
  },
})
export class SwipeActions {
  /** The row that is open or being dragged; opening another closes it. */
  private static current: SwipeActions | null = null;

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly desktop = inject(DesktopViewport);

  readonly swipeStart = input(0);
  readonly swipeEnd = input(0);
  /** Which side runs its first action on a full swipe. */
  readonly swipeFull = input<'both' | 'start' | 'end' | 'none'>('both');
  readonly swipeDisabled = input(false);
  /** A full swipe: the host runs the first action of that side. */
  readonly swipeCommit = output<RowSwipeSide>();
  readonly swipeOpened = output<RowSwipeSide | null>();

  private readonly openSide = signal<RowSwipeSide | null>(null);
  readonly open = this.openSide.asReadonly();

  private readonly inactive = computed(() => this.desktop.active() || this.swipeDisabled()
    || (this.swipeStart() <= 0 && this.swipeEnd() <= 0));

  private pointerId: number | null = null;
  private startX = 0;
  private startY = 0;
  private restOffset = 0;
  private offset = 0;
  private locked = false;
  private swallowUntil = 0;
  private listening = false;

  constructor() {
    const element = this.host.nativeElement;
    element.addEventListener('click', this.swallowGhostClick, true);
    effect(() => {
      if (this.inactive()) untracked(() => this.close());
    });
    inject(DestroyRef).onDestroy(() => {
      element.removeEventListener('click', this.swallowGhostClick, true);
      this.unlistenDocument();
      if (SwipeActions.current === this) SwipeActions.current = null;
    });
  }

  onPointerDown(event: PointerEvent): void {
    if (this.inactive() || !event.isPrimary || event.button !== 0) return;
    /* The left edge belongs to the iOS back gesture. */
    if (event.clientX < ROW_SWIPE_EDGE_GUARD_PX) return;
    if (event.target instanceof Element && event.target.closest(NO_SWIPE)) return;
    if (SwipeActions.current && SwipeActions.current !== this) SwipeActions.current.close();
    this.pointerId = event.pointerId;
    this.startX = event.clientX;
    this.startY = event.clientY;
    this.restOffset = this.restingOffset(this.openSide());
    this.offset = this.restOffset;
    this.locked = false;
  }

  onPointerMove(event: PointerEvent): void {
    if (event.pointerId !== this.pointerId) return;
    const dx = event.clientX - this.startX;
    const dy = event.clientY - this.startY;
    if (!this.locked) {
      if (Math.hypot(dx, dy) < ROW_SWIPE_AXIS_LOCK_PX) return;
      /* Mostly vertical: a scroll, not a swipe. */
      if (Math.abs(dy) > Math.abs(dx)) {
        this.pointerId = null;
        return;
      }
      this.locked = true;
      SwipeActions.current = this;
      try { this.host.nativeElement.setPointerCapture(event.pointerId); } catch { /* already released */ }
      this.host.nativeElement.classList.add('is-dragging');
    }
    this.paint(clampSwipeOffset(this.restOffset + dx, this.swipeStart(), this.swipeEnd()));
  }

  onPointerUp(event: PointerEvent): void {
    if (event.pointerId !== this.pointerId) return;
    this.pointerId = null;
    if (!this.locked) {
      /* A tap on an open row closes it and does nothing else. */
      if (this.openSide()) {
        this.swallowUntil = Date.now() + GHOST_CLICK_MS;
        this.close();
      }
      return;
    }
    this.locked = false;
    this.host.nativeElement.classList.remove('is-dragging');
    this.swallowUntil = Date.now() + GHOST_CLICK_MS;
    const decision = swipeRelease(this.offset, this.swipeStart(), this.swipeEnd(), this.swipeFull());
    if (decision.action === 'commit' && decision.side) {
      this.swipeCommit.emit(decision.side);
      this.close();
    } else if (decision.action === 'reveal' && decision.side) {
      this.reveal(decision.side);
    } else {
      this.close();
    }
  }

  onPointerCancel(event: PointerEvent): void {
    if (event.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.locked = false;
    this.host.nativeElement.classList.remove('is-dragging');
    this.paint(this.restOffset);
  }

  /** Back to rest. Hosts call this after running an action from a revealed button. */
  close(): void {
    const wasOpen = this.openSide() !== null;
    this.pointerId = null;
    this.locked = false;
    this.host.nativeElement.classList.remove('is-dragging');
    this.paint(0);
    this.openSide.set(null);
    this.unlistenDocument();
    if (SwipeActions.current === this) SwipeActions.current = null;
    if (wasOpen) this.swipeOpened.emit(null);
  }

  private reveal(side: RowSwipeSide): void {
    const changed = this.openSide() !== side;
    this.openSide.set(side);
    this.paint(this.restingOffset(side));
    SwipeActions.current = this;
    this.listenDocument();
    if (changed) this.swipeOpened.emit(side);
  }

  private restingOffset(side: RowSwipeSide | null): number {
    if (side === 'start') return swipeGeometry(this.swipeStart()).rest;
    if (side === 'end') return -swipeGeometry(this.swipeEnd()).rest;
    return 0;
  }

  /** Writes the offset as CSS variables; at 0 they are removed so the :focus-visible reveal works. */
  private paint(offset: number): void {
    this.offset = offset;
    const style = this.host.nativeElement.style;
    if (offset === 0) {
      style.removeProperty('--swipe-x');
      style.removeProperty('--swipe-abs');
      delete this.host.nativeElement.dataset['armed'];
      return;
    }
    style.setProperty('--swipe-x', `${offset}px`);
    style.setProperty('--swipe-abs', `${Math.abs(offset)}px`);
    const side: RowSwipeSide = offset > 0 ? 'start' : 'end';
    const count = side === 'start' ? this.swipeStart() : this.swipeEnd();
    const full = this.swipeFull();
    const armed = (full === 'both' || full === side) && Math.abs(offset) >= swipeGeometry(count).commit;
    if (armed) this.host.nativeElement.dataset['armed'] = side;
    else delete this.host.nativeElement.dataset['armed'];
  }

  private readonly swallowGhostClick = (event: MouseEvent): void => {
    if (Date.now() >= this.swallowUntil) return;
    this.swallowUntil = 0;
    event.preventDefault();
    event.stopPropagation();
  };

  private readonly closeOnOutsidePointer = (event: PointerEvent): void => {
    if (event.target instanceof Node && this.host.nativeElement.contains(event.target)) return;
    this.close();
  };

  private readonly closeOnEscape = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') this.close();
  };

  private listenDocument(): void {
    if (this.listening) return;
    this.listening = true;
    document.addEventListener('pointerdown', this.closeOnOutsidePointer, true);
    document.addEventListener('keydown', this.closeOnEscape);
  }

  private unlistenDocument(): void {
    if (!this.listening) return;
    this.listening = false;
    document.removeEventListener('pointerdown', this.closeOnOutsidePointer, true);
    document.removeEventListener('keydown', this.closeOnEscape);
  }
}
