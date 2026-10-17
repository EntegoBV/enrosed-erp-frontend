/**
 * Small UI building blocks: bottom sheet, confirm dialog and toasts.
 * Deliberately without an external UI library, so the look is fully ours.
 */

import {
  AfterViewInit,
  Component,
  Injectable,
  ChangeDetectionStrategy,
  ElementRef,
  HostListener,
  OnDestroy,
  ViewChild,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import {
  sheetBackdropFactor, sheetDragOffset, sheetDragOutcome, sheetDragStarted,
} from './sheet-drag';

/* ------------------------------------------------------------------ sheet */

/**
 * Onderaan ingeschoven paneel op telefoon, gecentreerde dialoog op desktop.
 * Gebruik met content projection:
 *
 *   <app-sheet title="Titel" (closed)="open.set(false)">
 *     <div body>…</div>
 *     <div foot>…</div>
 *   </app-sheet>
 *
 * `variant="ios"` gives phone sheets the iOS 26 look of the workspace kit
 * (grouped background, centred title, round close button, glass foot with
 * a 50px primary button); desks see no difference.
 *
 * Motion (styles/motion.scss): it rises in, and when its parent removes it
 * Angular's animate.leave puts mo-leaving on the host, so the backdrop
 * fades and the sheet slides down (desk: fades and shrinks a little)
 * before the DOM goes; the component itself is destroyed at once, so
 * closing stays synchronous for callers and the leaving overlay takes no
 * taps. On a phone the grab and the head can drag it down to dismiss
 * (sheet-drag.ts); the ×, Escape and the backdrop stay the ways out for
 * keyboards and screen readers.
 */
@Component({
  selector: 'app-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'animate.leave': 'mo-leaving' },
  template: `
    <div #overlay class="overlay" (click)="onBackdrop($event)">
      <div #dialog class="sheet" [class.sheet--wide]="wide()" [class.sheet--ios]="variant() === 'ios'"
           role="dialog" aria-modal="true"
           [attr.aria-labelledby]="headingId" tabindex="-1">
        <div class="sheet__grab" aria-hidden="true" (pointerdown)="dragStart($event)"></div>
        <div class="sheet__head" (pointerdown)="dragStart($event)">
          <h2 [id]="headingId">{{ heading() }}</h2>
          <button class="sheet__close" type="button" [attr.aria-label]="closeLabel()"
                  (click)="requestClose()">
            &times;
          </button>
        </div>
        <div class="sheet__body">
          <ng-content select="[body]" />
        </div>
        <div class="sheet__foot">
          <ng-content select="[foot]" />
        </div>
      </div>
    </div>
  `,
})
export class Sheet implements AfterViewInit, OnDestroy {
  private static nextId = 0;
  private static readonly stack: Sheet[] = [];
  private static bodyLockCount = 0;
  private static previousBodyOverflow = '';

  readonly heading = input('', { alias: 'title' });
  readonly wide = input(false);
  readonly closeLabel = input('Sluiten');
  readonly variant = input<'default' | 'ios'>('default');
  readonly closed = output<void>();

  readonly headingId = `sheet-heading-${++Sheet.nextId}`;

  @ViewChild('dialog', { static: true }) private dialog?: ElementRef<HTMLElement>;
  @ViewChild('overlay', { static: true }) private overlay?: ElementRef<HTMLElement>;
  private returnFocus: HTMLElement | null = null;
  private registered = false;
  /** Set when the parent removed the sheet: a drag that asked to close then lets the leave animation finish. */
  private destroyed = false;
  private drag: {
    id: number; startY: number; lastY: number; lastT: number; velocity: number; active: boolean; handle: HTMLElement;
  } | null = null;

  ngAfterViewInit(): void {
    this.returnFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement : null;
    Sheet.stack.push(this);
    this.registered = true;
    if (Sheet.bodyLockCount++ === 0) {
      Sheet.previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }

    queueMicrotask(() => {
      const dialog = this.dialog?.nativeElement;
      if (!dialog || Sheet.stack.at(-1) !== this) return;
      /* querySelector follows DOM order, not selector order. The close button
         precedes projected content, so resolve an explicit target separately. */
      const explicit = dialog.querySelector<HTMLElement>('[autofocus]')
        ?? dialog.querySelector<HTMLElement>('[data-initial-focus]');
      const fallback = dialog.querySelector<HTMLElement>(
        '.sheet__close, .sheet__body input:not([type="hidden"]):not([disabled]), '
        + '.sheet__body select:not([disabled]), .sheet__body textarea:not([disabled]), '
        + '.sheet__body button:not([disabled]), .sheet__body a[href]',
      );
      const initial = explicit ?? fallback;
      (initial ?? dialog).focus();
    });
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.stopDragListening();
    if (this.registered) {
      const index = Sheet.stack.lastIndexOf(this);
      if (index >= 0) Sheet.stack.splice(index, 1);
      if (Sheet.bodyLockCount > 0 && --Sheet.bodyLockCount === 0) {
        document.body.style.overflow = Sheet.previousBodyOverflow;
      }
    }
    const target = this.returnFocus;
    queueMicrotask(() => {
      if (target?.isConnected) target.focus();
    });
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (Sheet.stack.at(-1) !== this) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.requestClose();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = this.focusableElements();
    if (!focusable.length) {
      event.preventDefault();
      this.dialog?.nativeElement.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !this.dialog?.nativeElement.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !this.dialog?.nativeElement.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  requestClose(): void {
    if (Sheet.stack.at(-1) === this) this.closed.emit();
  }

  /* ---- drag to dismiss (phone) */

  /** Only a touch phone drags; a desk dialog never moves. */
  private dragEnabled(): boolean {
    return typeof window !== 'undefined' && window.innerWidth < 680
      && !!window.matchMedia?.('(pointer: coarse)').matches;
  }

  dragStart(event: PointerEvent): void {
    if (this.drag || !this.dragEnabled() || Sheet.stack.at(-1) !== this) return;
    /* A press on a control stays a press: the × keeps its click (critique B13). */
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('button, a, input, select, textarea, [role=button]')) return;
    this.drag = {
      id: event.pointerId, startY: event.clientY, lastY: event.clientY, lastT: event.timeStamp, velocity: 0,
      active: false, handle: event.currentTarget as HTMLElement,
    };
    document.addEventListener('pointermove', this.onDragMove, { passive: false });
    document.addEventListener('pointerup', this.onDragEnd);
    document.addEventListener('pointercancel', this.onDragCancel);
  }

  private readonly onDragMove = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.id) return;
    const raw = event.clientY - drag.startY;
    if (!drag.active) {
      if (!sheetDragStarted(raw)) return;
      /* Only now is the pointer captured: before this, a tap reaches its target as usual. */
      drag.active = true;
      try { drag.handle.setPointerCapture(drag.id); } catch { /* the pointer may already be gone */ }
    }
    event.preventDefault();
    const dt = event.timeStamp - drag.lastT;
    if (dt > 0) drag.velocity = (event.clientY - drag.lastY) / dt;
    drag.lastY = event.clientY;
    drag.lastT = event.timeStamp;
    this.placeSheet(sheetDragOffset(raw));
  };

  private readonly onDragEnd = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.id) return;
    this.stopDragListening();
    if (!drag.active) return;
    const dy = sheetDragOffset(event.clientY - drag.startY);
    if (sheetDragOutcome(dy, drag.velocity) === 'close') {
      this.requestClose();
      /* The leave animation continues from where the finger let go. A parent
         that refuses to close keeps the sheet (not destroyed): it springs back. */
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (!this.destroyed) this.springBack();
      }));
    } else {
      this.springBack();
    }
  };

  private readonly onDragCancel = (event: PointerEvent): void => {
    if (!this.drag || event.pointerId !== this.drag.id) return;
    const active = this.drag.active;
    this.stopDragListening();
    if (active) this.springBack();
  };

  private stopDragListening(): void {
    this.drag = null;
    if (typeof document === 'undefined') return;
    document.removeEventListener('pointermove', this.onDragMove);
    document.removeEventListener('pointerup', this.onDragEnd);
    document.removeEventListener('pointercancel', this.onDragCancel);
  }

  /** Follows the finger: the sheet moves, the backdrop lightens. */
  private placeSheet(dy: number): void {
    const sheet = this.dialog?.nativeElement;
    const overlay = this.overlay?.nativeElement;
    if (!sheet || !overlay) return;
    sheet.style.transition = 'none';
    sheet.style.transform = `translateY(${dy}px)`;
    sheet.style.setProperty('--drag-y', `${Math.max(0, dy)}px`);
    overlay.style.backgroundColor = `rgb(26 22 20 / ${(45 * sheetBackdropFactor(dy)).toFixed(1)}%)`;
  }

  /** Back to rest; afterwards no transform stays on the sheet (trap rule). */
  private springBack(): void {
    const sheet = this.dialog?.nativeElement;
    const overlay = this.overlay?.nativeElement;
    if (!sheet || !overlay) return;
    sheet.style.transition = 'transform var(--dur-2, .2s) var(--ease-spring, ease)';
    sheet.style.transform = '';
    overlay.style.backgroundColor = '';
    const done = () => {
      sheet.style.transition = '';
      sheet.style.removeProperty('--drag-y');
      sheet.removeEventListener('transitionend', done);
    };
    sheet.addEventListener('transitionend', done);
    setTimeout(done, 400);
  }

  onBackdrop(event: MouseEvent): void {
    if (event.target !== event.currentTarget) return;
    event.stopPropagation();
    /* Desktop: a stray click beside a half-filled form must not throw the
       work away - the cross, Annuleren and Escape remain the ways out.
       Phone: tapping the dimmed area is the natural way to dismiss a
       bottom sheet, so there it still closes. */
    if (window.innerWidth >= 680) return;
    this.requestClose();
  }

  private focusableElements(): HTMLElement[] {
    const dialog = this.dialog?.nativeElement;
    if (!dialog) return [];
    const selector = [
      'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
      'select:not([disabled])', 'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',');
    return Array.from(dialog.querySelectorAll<HTMLElement>(selector)).filter((element) =>
      element.getAttribute('aria-hidden') !== 'true'
      && (element.offsetWidth > 0 || element.offsetHeight > 0 || element.getClientRects().length > 0));
  }
}

/* ------------------------------------------------------------- ui service */

/** One button on a toast, e.g. "Ongedaan maken". */
export interface ToastAction {
  label: string;
  run: () => void;
}

export interface ToastMessage {
  id: number;
  text: string;
  kind: 'ok' | 'err';
  action?: ToastAction;
}

export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  danger: boolean;
  /** A second way out next to the main one, e.g. "Niet opslaan". */
  secondaryLabel?: string;
  onConfirm: () => void;
  onSecondary?: () => void;
  /** Annuleren, closing, or another question taking its place: for a caller that awaits the answer. */
  onCancel?: () => void;
}

/** Escapes dynamic copy before it is embedded in a confirm dialog's rich text. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

@Injectable({ providedIn: 'root' })
export class Ui {
  private counter = 0;

  readonly toasts = signal<ToastMessage[]>([]);
  readonly confirmRequest = signal<ConfirmRequest | null>(null);

  /**
   * Shows a short message. An action (typically "Ongedaan maken") keeps the
   * toast a little longer, so there is time to reach for it. Returns the id
   * for dismissToast.
   */
  toast(text: string, kind: 'ok' | 'err' = 'ok', action?: ToastAction): number {
    const id = ++this.counter;
    this.toasts.update((list) => [...list, action ? { id, text, kind, action } : { id, text, kind }]);
    setTimeout(() => this.dismissToast(id), kind === 'err' ? 7000 : action ? 6000 : 3800);
    return id;
  }

  dismissToast(id: number): void {
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }

  /**
   * Asks before acting. Annuleren (or closing) always means "stay as you
   * were"; a second choice such as "Niet opslaan" can be offered next to the
   * main one for the save-or-drop question.
   */
  confirm(
    options: { title: string; message: string; confirmLabel?: string; danger?: boolean;
      secondaryLabel?: string },
    onConfirm: () => void,
    onSecondary?: () => void,
    onCancel?: () => void,
  ): void {
    const replaced = this.confirmRequest();
    this.confirmRequest.set({
      title: options.title,
      message: options.message,
      confirmLabel: options.confirmLabel ?? 'Bevestigen',
      danger: options.danger ?? false,
      secondaryLabel: options.secondaryLabel,
      onConfirm,
      onSecondary,
      onCancel,
    });
    /* A question that never gets its answer counts as Annuleren. */
    replaced?.onCancel?.();
  }

  resolveConfirm(accepted: boolean, secondary = false): void {
    const request = this.confirmRequest();
    this.confirmRequest.set(null);
    if (!request) return;
    if (secondary) request.onSecondary?.();
    else if (accepted) request.onConfirm();
    else request.onCancel?.();
  }
}

/* ---------------------------------------------------------- leave confirm */

/** The words of the leave question; the app's own verb is "Opslaan" (every save button says it). */
export const LEAVE_CONFIRM_TEXT = {
  title: 'Niet-opgeslagen wijzigingen',
  saveMessage: 'Je hebt wijzigingen die nog niet zijn opgeslagen. Opslaan voor je verdergaat?',
  dropMessage: 'Als je dit scherm verlaat, gaan je wijzigingen verloren.',
  save: 'Opslaan',
  drop: 'Niet opslaan',
} as const;

/**
 * Asks before leaving a screen with unsaved changes; for canDeactivate.
 *
 *   canDeactivate(): boolean | Promise<boolean> {
 *     return this.dirty() ? confirmLeave(this.ui, () => this.save()) : true;
 *   }
 *
 * With a save function: Opslaan (primary) · Niet opslaan · Annuleren.
 * Opslaan resolves true once save() succeeds (it returns true or nothing),
 * false when it returns false or throws, so the screen stays. Without one:
 * Niet opslaan (danger) · Annuleren. Annuleren, closing the sheet, or
 * another question taking its place resolve false.
 */
export function confirmLeave(
  ui: Ui,
  save?: () => boolean | void | Promise<boolean | void>,
  options: { message?: string } = {},
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (save) {
      ui.confirm(
        {
          title: LEAVE_CONFIRM_TEXT.title,
          message: options.message ?? LEAVE_CONFIRM_TEXT.saveMessage,
          confirmLabel: LEAVE_CONFIRM_TEXT.save,
          secondaryLabel: LEAVE_CONFIRM_TEXT.drop,
        },
        async () => {
          try { resolve((await save()) !== false); } catch { resolve(false); }
        },
        () => resolve(true),
        () => resolve(false),
      );
    } else {
      ui.confirm(
        {
          title: LEAVE_CONFIRM_TEXT.title,
          message: options.message ?? LEAVE_CONFIRM_TEXT.dropMessage,
          confirmLabel: LEAVE_CONFIRM_TEXT.drop,
          danger: true,
        },
        () => resolve(true),
        undefined,
        () => resolve(false),
      );
    }
  });
}

/* ---------------------------------------------------------------- ui host */

/** Rendert toasts en de bevestigingsdialoog. Staat één keer in de app-shell. */
@Component({
  selector: 'app-ui-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet],
  template: `
    @if (confirm(); as request) {
      <app-sheet variant="ios" [title]="request.title" (closed)="ui.resolveConfirm(false)">
        <div body>
          <p class="confirm-message" [innerHTML]="request.message"></p>
        </div>
        <!-- Desk: Annuleren · second choice · main choice in a row; phone: stacked, the main choice on top. -->
        <div foot class="confirm-actions">
          <button class="btn" type="button" data-initial-focus
                  (click)="ui.resolveConfirm(false)">Annuleren</button>
          @if (request.secondaryLabel) {
            <button class="btn" type="button" (click)="ui.resolveConfirm(false, true)">
              {{ request.secondaryLabel }}
            </button>
          }
          <button
            class="btn"
            type="button"
            [class.btn--danger]="request.danger"
            [class.btn--primary]="!request.danger"
            (click)="ui.resolveConfirm(true)"
          >
            {{ request.confirmLabel }}
          </button>
        </div>
      </app-sheet>
    }

    <div class="toasts" aria-live="polite" aria-relevant="additions text">
      @for (toast of toasts(); track toast.id) {
        <div class="toast" animate.leave="mo-toast-leaving" [class.toast--err]="toast.kind === 'err'"
             [attr.role]="toast.kind === 'err' ? 'alert' : 'status'" aria-atomic="true">
          <span class="toast__dot"></span>
          <span>{{ toast.text }}</span>
          @if (toast.action; as action) {
            <button class="toast__action" type="button" (click)="runAction(toast.id, action)">
              {{ action.label }}
            </button>
          }
        </div>
      }
    </div>
  `,
})
export class UiHost {
  constructor(readonly ui: Ui) {}
  readonly toasts = computed(() => this.ui.toasts());
  readonly confirm = computed(() => this.ui.confirmRequest());

  /** The toast goes first, so an action that toasts again is not stacked under it. */
  runAction(id: number, action: ToastAction): void {
    this.ui.dismissToast(id);
    action.run();
  }
}
