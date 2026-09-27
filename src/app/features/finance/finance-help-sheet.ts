import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Sheet } from '../../shared/ui';
import { FINANCE_SHORTCUT_HELP } from './finance-shortcuts';
import { FinanceState } from './finance-state';

/** The two explanations: how the bank balance is calculated, and the keyboard. */
@Component({
  selector: 'app-finance-help-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet],
  template: `
    @if (state.shortcutsOpen()) {
      <app-sheet variant="ios" title="Sneltoetsen" (closed)="state.shortcutsOpen.set(false)">
        <div body class="fin-sheet">
          <dl class="fin-keys">
            @for (row of shortcuts; track row.label) {
              <div><dt>@for (key of row.keys; track key) { <kbd class="wk-kbd">{{ key }}</kbd> }</dt><dd>{{ row.label }}</dd></div>
            }
          </dl>
        </div>
      </app-sheet>
    } @else {
      <app-sheet variant="ios" title="Hoe werkt je banksaldo?" (closed)="state.helpOpen.set(false)">
        <div body class="fin-sheet fin-help">
          <ol>
            <li>Vul per rekening je saldo in.</li>
            <li>Noteer wat er daarna in- en uitgaat, of zet het vinkje bij Betaald zetten.</li>
            <li>Koppel ontvangen geld aan de factuur, dan telt het één keer.</li>
          </ol>
          <h3>Waarom verandert mijn saldo niet als ik een kost betaald zet?</h3>
          <p>Een kost of containerbetaling heeft geen bankrekening. Noteer de betaling als bankbeweging (of zet dat aan bij Betaald zetten), dan beweegt het saldo mee.</p>
          <h3>Wat telt mee?</h3>
          <p>Elke rekening begint bij haar laatste saldo. Daarna tellen de bankbewegingen op die rekening, en de factuurbetalingen met die rekening die nog aan geen bankbeweging hangen. Een factuurbetaling zonder rekening telt niet mee.</p>
          <h3>Wat kan nog niet?</h3>
          <p>Een uitgaande bankbeweging aan een kost of containerbetaling koppelen en een rekeningafschrift inlezen vragen nog werk aan de server. Tot dan helpt 'Nog niet op de bank' je de betalingen terug te vinden.</p>
        </div>
      </app-sheet>
    }
  `,
})
export class FinanceHelpSheet {
  readonly state = inject(FinanceState);
  readonly shortcuts = FINANCE_SHORTCUT_HELP;
}
