import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { Privacy } from '../core/api/privacy';

/**
 * Het Enrosed-logo, tevens de verborgen schakelaar voor inkoopcijfers.
 *
 * Dubbelklikken of dubbeltikken zet kostprijs en marge aan of uit. Bewust geen
 * zichtbare knop: op een beurs staat de klant naast je, en een knop met
 * "inkoop verbergen" verraadt precies dat er iets te verbergen valt. Het logo
 * krijgt een lichte achtergrond zolang de cijfers zichtbaar zijn, zodat je met
 * een blik ziet hoe het staat zonder dat het iemand anders opvalt.
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
      /* Zonder dit maakt iOS van een dubbeltik een zoom in plaats van een schakel. */
      touch-action: manipulation;
      -webkit-touch-callout: none;
      padding: 4px 8px;
      margin: -4px -8px;
      border-radius: 6px;
      transition: background 0.15s;
    }
    /* Het logo is zeer breed (ongeveer 6:1); een vaste hoogte met width:auto
       houdt de verhouding intact in plaats van het uit te rekken. */
    .brand-mark__logo {
      height: 26px;
      width: auto;
      max-width: min(200px, 55vw);
      object-fit: contain;
      object-position: left center;
    }
    /* Het logo is zwarte inkt op transparant. Op een donkere balk moet het
       omgekeerd worden, op de lichte koptekst juist niet - anders is het wit
       op crème en zie je niets meer. */
    .brand-mark--on-dark .brand-mark__logo { filter: invert(1); }
    .brand-mark--small .brand-mark__logo { height: 19px; }
    .brand-mark__sub {
      font-size: 10px;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--brand-sub, #9a8f88);
      margin-top: 3px;
    }

    /* Zodra de inkoopcijfers zichtbaar zijn wordt het logo rozerood, net als de
       rest van het thema. Geen achtergrondvlak: een kleur lees je van verder weg
       dan een vlak, en het vlak maakte het logo juist slechter leesbaar. */
    .brand-mark--inverted .brand-mark__logo { filter: var(--logo-filter); }
    .brand-mark--inverted.brand-mark--on-dark .brand-mark__logo {
      /* Op de donkere balk eerst omkeren, dan pas kleuren. */
      filter: invert(1) var(--logo-filter);
    }
    .brand-mark--inverted .brand-mark__sub { color: var(--rose); }
  `,
})
export class BrandMark {
  readonly privacy = inject(Privacy);
  readonly subtitle = input('');
  readonly small = input(false);
  /** Staat het merk op een donkere ondergrond, zoals de zijbalk? */
  readonly onDark = input(false);

  private lastTap = 0;

  /**
   * Dubbeltik op een touchscreen.
   *
   * Browsers sturen daar geen betrouwbare dblclick voor, dus wordt de tijd
   * tussen twee tikken zelf gemeten. 400 ms is ruim genoeg om er twee te halen
   * en kort genoeg om niet per ongeluk te schakelen bij twee losse tikken.
   */
  onTouch(event: Event): void {
    const now = Date.now();
    if (now - this.lastTap < 400) {
      /* Voorkomt dat de tik daarna ook nog als klik doorkomt. */
      event.preventDefault();
      this.privacy.toggle();
      this.lastTap = 0;
      return;
    }
    this.lastTap = now;
  }
}
