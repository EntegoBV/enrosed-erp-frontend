import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Sheet } from '../../shared/ui';
import { FINANCE_SHORTCUT_HELP } from './finance-shortcuts';
import { FinanceState } from './finance-state';

/** The two explanations: how the bank balance is calculated (spec §3.14, six paragraphs), and the keyboard. */
@Component({
  selector: 'app-finance-help-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet],
  template: `
    @if (state.shortcutsOpen()) {
      <app-sheet variant="ios" title="Sneltoetsen" (closed)="state.shortcutsOpen.set(false)">
        <div body class="fin-sheet">
          <dl class="fin-keys">
            @for (row of general; track row.label) {
              <div><dt>@for (key of row.keys; track key) { <kbd class="wk-kbd">{{ key }}</kbd> }</dt><dd>{{ row.label }}</dd></div>
            }
          </dl>
          <h3 class="fin-keys__group">Transacties</h3>
          <dl class="fin-keys">
            @for (row of transactions; track row.label) {
              <div><dt>@for (key of row.keys; track key) { <kbd class="wk-kbd">{{ key }}</kbd> }</dt><dd>{{ row.label }}</dd></div>
            }
          </dl>
        </div>
      </app-sheet>
    } @else {
      <app-sheet variant="ios" title="Hoe werkt je banksaldo?" (closed)="state.helpOpen.set(false)">
        <div body class="fin-sheet fin-help">
          <p>Je saldo = de laatste saldocontrole + alle banktransacties daarna. Rekeningen via Odoo krijgen hun transacties uit Odoo; kies Transacties ophalen om bij te werken.</p>
          <p>Vul één keer een beginsaldo in per rekening. Daarna rekent Enrosed zelf verder; vergelijk af en toe met je bankapp via Saldo controleren.</p>
          <p>Koppel elke transactie aan wat ze betaalt: een factuur, een kost, een containertermijn of een bestaande betaling. Bedrag en datum van een bestaande betaling volgen dan de bank.</p>
          <p>Geen factuur of kost? Kies Boeken als…: interne overboeking, btw, lening, kapitaal, privé of andere. Bankkosten en rente boek je als kost.</p>
          <p>Het saldo naast elke transactie is het saldo na die transactie. Vóór de eerste saldocontrole van een handmatige rekening is het onbekend.</p>
          <p>De kaslijn zet open facturen, kosten, vaste kosten, containertermijnen en btw op hun verwachte dag. De volledige prognose met verkoop staat in Analyses › Kasprognose.</p>
        </div>
      </app-sheet>
    }
  `,
})
export class FinanceHelpSheet {
  readonly state = inject(FinanceState);
  readonly general = FINANCE_SHORTCUT_HELP.filter((row) => !row.group);
  readonly transactions = FINANCE_SHORTCUT_HELP.filter((row) => row.group === 'Transacties');
}
