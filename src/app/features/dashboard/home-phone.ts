import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * The phone home (spec-home §2, < 680 px). A stub of W4 that renders its
 * title only; W6 builds the nav, the Kas hero, Te doen, Cijfers, Meer
 * cijfers and the Toevoegen sheet on HomeData. The shell enters the home.
 */
@Component({
  selector: 'app-home-phone',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="ios-page home-phone"><h1 class="home-phone__title">Vandaag</h1></div>`,
})
export class HomePhone {}
