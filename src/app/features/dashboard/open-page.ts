import { ChangeDetectionStrategy, Component } from '@angular/core';
import { enterHome } from './home-data';

/**
 * /dashboard/open, "Open punten" (spec-home §2 row 3b). A stub of W4 that
 * renders its title only; W6 builds the full ranked list (Nu, Vandaag, Ook
 * nog) and the desk redirect to /dashboard?alle=1.
 */
@Component({
  selector: 'app-open-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="ios-page home-open"><h1 class="home-open__title">Open punten</h1></div>`,
})
export class OpenPage {
  constructor() {
    enterHome();
  }
}
