import { ChangeDetectionStrategy, Component, ElementRef, inject, input, signal, viewChild } from '@angular/core';
import { Icon } from '../../shared/icon';

/**
 * "Hoe gerekend" per tab (design §2.6, critique N17): the explanation that
 * used to stand as eyebrow, heading and paragraph above each section. The
 * desk shows it in a popover from the tool row, the phone in a sheet from ⋯.
 */
export type HowKey = 'cash' | 'overview' | 'sales' | 'inventory' | 'result'
  | 'purchasing-kosten' | 'purchasing-kwaliteit' | 'purchasing-partners' | 'purchasing-afwijkingen';
export const HOW_TEXTS: Record<HowKey, readonly string[]> = {
  cash: ['Vertrekt van het berekende banksaldo en zet elke verwachte betaling en ontvangst op zijn dag.'],
  overview: [
    'Dezelfde actuele bronnen als het dashboard, met ontvangstkwaliteit erbij. De cijfers gelden voor dit jaar, tenzij er een andere periode bij staat.',
    'Op tijd: ontvangen op of voor de laatst opgeslagen ETA.',
  ],
  sales: [
    'De periode volgt de aanmaakdatum van de verkoopdocumenten. Facturen volgen hun documentdatum; ontvangsten hun echte betaaldatum.',
    'Voorschotten blijven financiering tot de slotafrekening. Oude documenten kunnen nog actuele productprijzen gebruiken.',
    'Omzet, marge, pijplijn en geaccepteerd zijn excl. btw; gefactureerd, ontvangen, open en vervallen incl. btw.',
  ],
  inventory: [
    'Een actuele momentopname uit de productkaart en open inkooporders; het tempo komt van de facturen van de laatste 90 dagen.',
    'De kostwaarde bevat de Enrosed-kost. Voor de boekhouding: Jaarinventaris.',
  ],
  'purchasing-kosten': ['Afspraak, betalingen en open bedragen naast elkaar. Meer- en minderbetalingen blijven per leverancier, douane en extra kost zichtbaar.'],
  'purchasing-kwaliteit': ['Actuele containerwaarde plus de ontvangen orders in de gekozen periode. Perfect: alles bruikbaar ontvangen zoals besteld. Op tijd: ontvangen op of voor de laatst opgeslagen ETA.'],
  'purchasing-partners': ['De partner financiert de afgesproken kosten vooraf of samen met ons. Elke termijn krijgt een eigen voorschotfactuur. Het resultaat volgt uit uitgegeven deel- en slotafrekeningen, naar de werkelijk afgerekende hoeveelheden.'],
  'purchasing-afwijkingen': ['Tekorten en schade blijven hier staan, ook nadat de container is afgerond.'],
  result: [
    'De marge op de goederen van de uitgegeven facturen, min de kosten die we zelf maakten.',
    'Verkoop telt op de factuurdatum, kosten op hun datum; een investering met haar afschrijving van de periode. Alles excl. btw.',
  ],
};

@Component({
  selector: 'app-an-how',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  host: {
    class: 'wk-popover-anchor an-how',
    '(document:pointerdown)': 'outside($event)',
    '(document:keydown.escape)': 'escape()',
  },
  template: `
    <button #button class="wk-btn wk-btn--ghost" type="button" aria-haspopup="dialog" [attr.aria-expanded]="open()" (click)="open.set(!open())">
      <app-icon name="info" [size]="15" />Hoe gerekend</button>
    @if (open()) {
      <div class="wk-popover an-how__pop" role="dialog" aria-label="Hoe gerekend">
        @for (line of lines(); track $index) { <p>{{ line }}</p> }
      </div>
    }
  `,
})
export class AnHow {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly button = viewChild.required<ElementRef<HTMLButtonElement>>('button');
  readonly lines = input.required<readonly string[]>();
  readonly open = signal(false);

  outside(event: Event): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) this.open.set(false);
  }

  escape(): void {
    if (!this.open()) return;
    this.open.set(false);
    this.button().nativeElement.focus();
  }
}
