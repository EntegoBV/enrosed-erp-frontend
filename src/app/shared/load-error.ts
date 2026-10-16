import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { DesktopViewport } from '../core/platform/desktop-viewport';
import { Icon } from './icon';

/** The text under the title when the screen has no better message. */
export const LOAD_ERROR_FALLBACK = 'Controleer de verbinding en probeer opnieuw.';

/**
 * A screen that could not load its data: what happened and one way out.
 *
 *   <app-load-error [message]="messageOf(failure, LOAD_ERROR_FALLBACK)" (retry)="load()" />
 *
 * Desk: the kit's wk-empty look with a danger tile; phone: the ios-empty
 * look. The title is the app's own phrase, "Dit scherm kon niet worden
 * geladen"; a screen may name its thing instead ("Inkooporder kon niet
 * worden geladen"). Kit component: no styles array, its rules live in
 * styles/workspace-kit.scss.
 */
@Component({
  selector: 'app-load-error',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    @if (desktop.active()) {
      <div class="wk-empty" role="alert">
        <div class="wk-empty__icon wk-empty__icon--danger"><app-icon name="alert" [size]="22" /></div>
        <h2 class="wk-empty__title">{{ title() }}</h2>
        <p class="wk-empty__text">{{ message() || fallback }}</p>
        <div class="wk-empty__actions">
          <button class="wk-btn" type="button" [disabled]="busy()" (click)="retry.emit()">
            <app-icon name="refresh" [size]="16" />{{ busy() ? 'Opnieuw proberen…' : 'Opnieuw proberen' }}
          </button>
        </div>
      </div>
    } @else {
      <div class="ios-empty" role="alert">
        <div class="ios-empty__icon ios-empty__icon--danger"><app-icon name="alert" [size]="26" /></div>
        <h2 class="ios-empty__title">{{ title() }}</h2>
        <p class="ios-empty__text">{{ message() || fallback }}</p>
        <button class="ios-capsule ios-capsule--tinted" type="button" [disabled]="busy()" (click)="retry.emit()">
          {{ busy() ? 'Opnieuw proberen…' : 'Opnieuw proberen' }}
        </button>
      </div>
    }
  `,
})
export class LoadError {
  readonly desktop = inject(DesktopViewport);
  readonly fallback = LOAD_ERROR_FALLBACK;

  readonly title = input('Dit scherm kon niet worden geladen');
  /** Usually messageOf(failure, LOAD_ERROR_FALLBACK); empty shows the fallback. */
  readonly message = input<string | null>(null);
  /** True while the retry runs: the button waits. */
  readonly busy = input(false);
  readonly retry = output<void>();
}
