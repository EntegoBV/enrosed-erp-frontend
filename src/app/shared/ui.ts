/**
 * Small UI building blocks: bottom sheet, confirm dialog and toasts.
 * Deliberately without an external UI library, so the look is fully ours.
 */

import {
  Component,
  Injectable,
  ChangeDetectionStrategy,
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
      <div class="sheet" [class.sheet--wide]="wide()" role="dialog" aria-modal="true">
        <div class="sheet__grab"></div>
        <div class="sheet__head">
          <h2>{{ heading() }}</h2>
          <button class="sheet__close" type="button" aria-label="Sluiten" (click)="closed.emit()">
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
export class Sheet {
  readonly heading = input('', { alias: 'title' });
  readonly wide = input(false);
  readonly closed = output<void>();

  onBackdrop(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('overlay')) this.closed.emit();
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
    }, 2800);
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
          <button class="btn" type="button" (click)="ui.resolveConfirm(false)">Annuleren</button>
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

    @if (toasts().length) {
      <div class="toasts">
        @for (toast of toasts(); track toast.id) {
          <div class="toast" [class.toast--err]="toast.kind === 'err'">
            <span class="toast__dot"></span>
            <span>{{ toast.text }}</span>
          </div>
        }
      </div>
    }
  `,
})
export class UiHost {
  constructor(readonly ui: Ui) {}
  readonly toasts = computed(() => this.ui.toasts());
  readonly confirm = computed(() => this.ui.confirmRequest());
}
