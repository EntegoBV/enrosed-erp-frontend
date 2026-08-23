import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** The Enrosed logo, as it sits in the header and the sidebar. */
@Component({
  selector: 'app-brand-mark',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="brand-mark" [class.brand-mark--small]="small()" [class.brand-mark--on-dark]="onDark()">
      <img class="brand-mark__logo" src="logo-ui.png" alt="Enrosed" draggable="false" />
      @if (subtitle()) {
        <span class="brand-mark__sub">{{ subtitle() }}</span>
      }
    </div>
  `,
  styles: `
    .brand-mark {
      display: inline-flex;
      flex-direction: column;
      user-select: none;
      -webkit-user-select: none;
      touch-action: manipulation;
      -webkit-touch-callout: none;
      padding: 4px 8px;
      margin: -4px -8px;
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
  `,
})
export class BrandMark {
  readonly subtitle = input('');
  readonly small = input(false);
  /** Does the mark sit on a dark background, like the sidebar? */
  readonly onDark = input(false);
}
