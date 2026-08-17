import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Location } from '@angular/common';
import { BrandMark } from './brand-mark';
import { NotificationBell } from './notification-bell';

/**
 * Bovenbalk van een pagina. Op telefoon staat er links een terugknop wanneer
 * de pagina een detailweergave is; op desktop verdwijnt die (de zijbalk neemt
 * de navigatie over).
 */
@Component({
  selector: 'app-page-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BrandMark, NotificationBell],
  template: `
    <header class="appbar">
      @if (showBack()) {
        <button class="appbar__back" type="button" aria-label="Terug" (click)="back()">‹</button>
      } @else {
        <!-- Op telefoon staat hier het woordmerk; dubbelklikken schakelt de
             inkoopcijfers. Op desktop doet de zijbalk dat. -->
        <div class="appbar__brand hide-desktop">
          <app-brand-mark [small]="true" />
        </div>
      }
      <div class="appbar__titles">
        <div class="appbar__title">{{ title() }}</div>
        @if (subtitle()) {
          <div class="appbar__sub">{{ subtitle() }}</div>
        }
      </div>
      <div class="appbar__actions">
        <ng-content />
        @if (showBell()) {
          <app-notification-bell />
        }
      </div>
    </header>
  `,
})
export class PageHeader {
  readonly title = input.required<string>();
  readonly subtitle = input('');
  readonly showBack = input(false);
  /**
   * Het belletje hoort op de overzichtsschermen, niet op elk detailscherm.
   * Op een offerte die je aan het bewerken bent is het alleen maar afleiding.
   */
  readonly showBell = input(true);

  constructor(private readonly location: Location) {}

  back(): void {
    this.location.back();
  }
}
