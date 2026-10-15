import { ChangeDetectionStrategy, Component } from '@angular/core';
import { enterHome } from './home-data';

/**
 * /dashboard/agenda (spec-home §5.2). A stub of W4 that renders its title
 * only; W7 builds the month that folds into the week, Dag / Komend / Taken
 * and the desk redirect to /dashboard?agenda=maand.
 */
@Component({
  selector: 'app-agenda-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="ios-page home-agenda"><h1 class="home-agenda__title">Agenda</h1></div>`,
})
export class AgendaPage {
  constructor() {
    enterHome();
  }
}
