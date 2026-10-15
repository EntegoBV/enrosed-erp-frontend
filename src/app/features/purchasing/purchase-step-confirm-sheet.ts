import { ChangeDetectionStrategy, Component, input, linkedSignal, output } from '@angular/core';
import { Sheet } from '../../shared/ui';
import type { StepConfirm } from './purchase-phone-model';

/**
 * The question every next step of a phone purchase order asks first
 * (Bestellen, Container vertrokken, …): what happens, the track & trace for
 * a departure, and a note when unsaved edits go along. The host runs it.
 * Styles: styles/purchase-phone.scss (.mpo-confirm).
 */
@Component({
  selector: 'app-purchase-step-confirm-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet],
  template: `
    <app-sheet [title]="text().title" variant="ios" (closed)="cancel.emit()">
      <div body class="mpo-confirm">
        <p class="mpo-confirm__text">{{ text().message }}</p>
        @if (text().tracking) {
          <div class="ios-group"><label class="ios-cell mpo-field-row mpo-field-row--stack" for="mpo-step-tracking">
            <span class="ios-cell__body"><span class="ios-cell__title">Track &amp; trace</span><span class="ios-cell__sub">optioneel</span></span>
            <input class="mpo-input mpo-input--wide" id="mpo-step-tracking" type="text" enterkeyhint="done" autocomplete="off"
                   placeholder="Containernummer, B/L of link" [value]="draft()" (input)="draft.set($any($event.target).value)" /></label></div>
        }
        @if (text().dirtyNote) { <p class="ios-caption mpo-confirm__note">Je openstaande wijzigingen worden mee opgeslagen.</p> }
      </div>
      <div foot style="display:contents">
        <button class="btn" type="button" (click)="cancel.emit()">Annuleren</button>
        <button class="btn btn--primary" type="button" [disabled]="busy()" (click)="confirmed.emit({ tracking: text().tracking ? draft() : null })">{{ text().confirmLabel }}</button>
      </div>
    </app-sheet>
  `,
  styles: `:host{display:contents}`,
})
export class PurchaseStepConfirmSheet {
  readonly text = input.required<StepConfirm>();
  /** The track & trace the order has now; the field starts with it. */
  readonly tracking = input('');
  readonly busy = input(false);
  readonly confirmed = output<{ tracking: string | null }>();
  readonly cancel = output<void>();

  readonly draft = linkedSignal(() => this.tracking());
}
