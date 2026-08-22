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

/* ------------------------------------------------------------------ sheet */

/**
 * Onderaan ingeschoven paneel op telefoon, gecentreerde dialoog op desktop.
 * Gebruik met content projection:
 *
 *   <app-sheet title="Titel" (closed)="open.set(false)">
 *     <div body>…</div>
 *     <div foot>…</div>
 *   </app-sheet>
 */
@Component({
  selector: 'app-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="overlay" (click)="onBackdrop($event)">
      <div #dialog class="sheet" [class.sheet--wide]="wide()" role="dialog" aria-modal="true"
           [attr.aria-labelledby]="headingId" tabindex="-1">
        <div class="sheet__grab"></div>
        <div class="sheet__head">
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
  readonly closed = output<void>();

  readonly headingId = `sheet-heading-${++Sheet.nextId}`;

  @ViewChild('dialog', { static: true }) private dialog?: ElementRef<HTMLElement>;
  private returnFocus: HTMLElement | null = null;
  private registered = false;

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

  onBackdrop(event: MouseEvent): void {
    if (event.target !== event.currentTarget) return;
    event.stopPropagation();
    /* A click beside the sheet does not close it: on a desktop a stray
       click next to a half-filled supplier form used to throw the work
       away. The cross, Annuleren and Escape remain the ways out. */
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

export interface ToastMessage {
  id: number;
  text: string;
  kind: 'ok' | 'err';
}

export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  danger: boolean;
  onConfirm: () => void;
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

  toast(text: string, kind: 'ok' | 'err' = 'ok'): void {
    const id = ++this.counter;
    this.toasts.update((list) => [...list, { id, text, kind }]);
    setTimeout(() => {
      this.toasts.update((list) => list.filter((t) => t.id !== id));
    }, kind === 'err' ? 7000 : 3800);
  }

  confirm(
    options: { title: string; message: string; confirmLabel?: string; danger?: boolean },
    onConfirm: () => void,
  ): void {
    this.confirmRequest.set({
      title: options.title,
      message: options.message,
      confirmLabel: options.confirmLabel ?? 'Bevestigen',
      danger: options.danger ?? false,
      onConfirm,
    });
  }

  resolveConfirm(accepted: boolean): void {
    const request = this.confirmRequest();
    this.confirmRequest.set(null);
    if (accepted && request) request.onConfirm();
  }
}

/* ---------------------------------------------------------------- ui host */

/** Rendert toasts en de bevestigingsdialoog. Staat één keer in de app-shell. */
@Component({
  selector: 'app-ui-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet],
  template: `
    @if (confirm(); as request) {
      <app-sheet [title]="request.title" (closed)="ui.resolveConfirm(false)">
        <div body>
          <p style="font-size:14.5px;line-height:1.55" [innerHTML]="request.message"></p>
        </div>
        <div foot style="display:contents">
          <button class="btn" type="button" data-initial-focus
                  (click)="ui.resolveConfirm(false)">Annuleren</button>
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
        <div class="toast" [class.toast--err]="toast.kind === 'err'"
             [attr.role]="toast.kind === 'err' ? 'alert' : 'status'" aria-atomic="true">
          <span class="toast__dot"></span>
          <span>{{ toast.text }}</span>
        </div>
      }
    </div>
  `,
})
export class UiHost {
  constructor(readonly ui: Ui) {}
  readonly toasts = computed(() => this.ui.toasts());
  readonly confirm = computed(() => this.ui.confirmRequest());
}
