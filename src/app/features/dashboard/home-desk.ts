import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * The desk home (spec-home §3, ≥ 680 px). A stub of W4 that renders its
 * title only; W5 builds the header, Vandaag te doen, the figure blocks and
 * the Agenda card on HomeData. The shell (DashboardHome) enters the home.
 */
@Component({
  selector: 'app-home-desk',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<main class="content home-desk"><h1 class="home-desk__title">Vandaag</h1></main>`,
})
export class HomeDesk {}
