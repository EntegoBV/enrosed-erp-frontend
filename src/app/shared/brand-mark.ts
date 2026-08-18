import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { Privacy } from '../core/api/privacy';

/**
 * The Enrosed logo, doubling as the hidden switch for purchase figures.
 *
 * Double-click or double-tap toggles cost price and margin. Deliberately no
 * visible button: at a fair the customer stands next to you, and a button
 * saying "hide purchasing" betrays exactly that there is something to
 * hide. The logo takes a light tint while the figures are visible, so one
 * glance tells you the state without anyone else noticing.
 */
@Component({
  selector: 'app-brand-mark',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="brand-mark"
      [class.brand-mark--inverted]="privacy.showPurchase()"
      [class.brand-mark--small]="small()"
      [class.brand-mark--on-dark]="onDark()"
      role="button"
      tabindex="0"
      [attr.aria-label]="privacy.showPurchase()
        ? 'Inkoopcijfers zijn zichtbaar — dubbelklik om ze te verbergen'
        : 'Inkoopcijfers zijn verborgen — dubbelklik om ze te tonen'"
      (dblclick)="privacy.toggle()"
      (touchend)="onTouch($event)"
      (keydown.enter)="privacy.toggle()"
    >
      <img class="brand-mark__logo" src="logo.png" alt="Enrosed" draggable="false" />
      @if (subtitle()) {
        <span class="brand-mark__sub">{{ subtitle() }}</span>
      }
    </div>
  `,
  styles: `
    .brand-mark {
      display: inline-flex;
      flex-direction: column;
      cursor: pointer;
      user-select: none;
      -webkit-user-select: none;
      /* Without this, iOS turns a double-tap into a zoom instead of a toggle. */
      touch-action: manipulation;
      -webkit-touch-callout: none;
      padding: 4px 8px;
      margin: -4px -8px;
      border-radius: 6px;
      transition: background 0.15s;
    }
    /* The logo is very wide (roughly 6:1); a fixed height with width:auto
       keeps the ratio instead of stretching it. */
    .brand-mark__logo {
      height: 26px;
      width: auto;
      max-width: min(200px, 55vw);
      object-fit: contain;
      object-position: left center;
    }
    /* The logo is black ink on transparent. On a dark bar it must be
       inverted, on the light header it must not - or it is white on cream
       and you see nothing. */
    .brand-mark--on-dark .brand-mark__logo { filter: invert(1); }
    .brand-mark--small .brand-mark__logo { height: 19px; }
    .brand-mark__sub {
      font-size: 10px;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--brand-sub, #9a8f88);
      margin-top: 3px;
    }

    /* Once the purchase figures are visible the logo turns rose red, like
       the rest of the theme. No background plate: a colour reads from
       further away than a plate, and the plate made the logo harder to
       read. */
    .brand-mark--inverted .brand-mark__logo { filter: var(--logo-filter); }
    .brand-mark--inverted.brand-mark--on-dark .brand-mark__logo {
      /* On the dark bar: invert first, colour after. */
      filter: invert(1) var(--logo-filter);
    }
    .brand-mark--inverted .brand-mark__sub { color: var(--rose); }
  `,
})
export class BrandMark {
  readonly privacy = inject(Privacy);
  readonly subtitle = input('');
  readonly small = input(false);
  /** Does the mark sit on a dark background, like the sidebar? */
  readonly onDark = input(false);

  private lastTap = 0;

  /**
   * Double-tap on a touchscreen.
   *
   * Browsers send no reliable dblclick for it, so the time between two taps
   * is measured by hand. 400 ms is wide enough to manage two and short
   * enough not to toggle by accident on two separate taps.
   */
  onTouch(event: Event): void {
    const now = Date.now();
    if (now - this.lastTap < 400) {
      /* Stops the tap from arriving again as a click. */
      event.preventDefault();
      this.privacy.toggle();
      this.lastTap = 0;
      return;
    }
    this.lastTap = now;
  }
}
