import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { enterHome } from './home-data';
import { HomeDesk } from './home-desk';
import { HomePhone } from './home-phone';

/**
 * /dashboard: the operational front door (spec-home §1). A shell that picks
 * the desk page (680 px and up) or the phone page; both read HomeData, which
 * loads and derives everything once. Entering keeps the day current: a 60 s
 * interval and window focus move the clock, and a new day loads again.
 */
@Component({
  selector: 'app-dashboard-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HomeDesk, HomePhone],
  template: `@if (desk()) { <app-home-desk /> } @else { <app-home-phone /> }`,
})
export class DashboardHome {
  readonly desk = inject(DesktopViewport).active;

  constructor() {
    enterHome();
  }
}
