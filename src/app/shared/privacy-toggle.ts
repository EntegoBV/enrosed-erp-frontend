import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Privacy } from '../core/api/privacy';

/**
 * Schakelaar voor inkoopcijfers, bedoeld voor de bovenbalk.
 *
 * Staat op elk scherm waar kostprijs of marge kan opduiken, met dezelfde
 * stand — ook op het beginscherm, want daar staan de margecijfers het grootst.
 */
@Component({
  selector: 'app-privacy-toggle',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      class="privacy-btn"
      type="button"
      [class.privacy-btn--on]="privacy.showPurchase()"
      [attr.aria-pressed]="privacy.showPurchase()"
      [title]="privacy.showPurchase()
        ? 'Inkoopcijfers staan aan — verberg ze als er een klant meekijkt'
        : 'Inkoopcijfers zijn verborgen'"
      (click)="privacy.toggle()"
    >
      {{ privacy.showPurchase() ? '👁 Inkoop zichtbaar' : '🔒 Inkoop verborgen' }}
    </button>
  `,
})
export class PrivacyToggle {
  readonly privacy = inject(Privacy);
}
