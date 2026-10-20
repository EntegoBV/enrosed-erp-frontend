import { ChangeDetectionStrategy, Component, ElementRef, inject, input, signal, viewChild } from '@angular/core';
import { Icon } from '../../shared/icon';

/**
 * "Hoe gerekend" per tab (design §2.6, critique N17): the explanation that
 * used to stand as eyebrow, heading and paragraph above each section. The
 * desk shows it in a popover from the tool row, the phone in a sheet from ⋯.
 */
export type HowKey = 'cash' | 'overview' | 'sales' | 'inventory' | 'result'
  | 'purchasing-kosten' | 'purchasing-kwaliteit' | 'purchasing-partners' | 'purchasing-afwijkingen' | 'market' | 'website';
/** Every tab's explanation (design/analyses2/design.md §C.9): the desk popover and the phone ⋯ sheet read the same lines. */
export const HOW_TEXTS: Record<HowKey, readonly string[]> = {
  cash: [
    'We vertrekken van het berekende saldo van de rekeningen die meetellen: de laatste saldocontrole plus alle banktransacties daarna.',
    'Open facturen komen binnen op hun vervaldag, plus de dagen die de klant gewoonlijk later betaalt. Wat al vervallen is, staat op vandaag.',
    'Geaccepteerde offertes komen binnen na de leverweek plus de betaalvoorwaarde van de klant; zonder voorwaarde rekenen we 30 dagen.',
    'Partnervoorschotten volgen de vervaldagen van het voorschotschema.',
    'Containertermijnen tellen met hun open bedrag: bij bestelling meteen, bij vertrek op de vertrekdatum (aankomst min de transittijd), bij aankomst op de ETA. Douane en transport volgen twee dagen na aankomst, de inspectie een week voor vertrek.',
    'Btw bij invoer betalen we bij aankomst wanneer de container in België wordt ingeklaard, tenzij de vergunning ET 14000 aan staat.',
    'Kosten vallen op hun vervaldag, of op de kostdatum als er geen is; vaste kosten en domiciliëringen op hun eigen dag.',
    'De btw-aangifte valt op de 25e na het kwartaal: wat de aangifte vandaag al weet, plus de btw op de verwachte verkoop. Een tegoed schuift door naar het volgende kwartaal.',
    'Het scenario verkoopt de aangevinkte containers en de voorraad vanaf een week na aankomst, verspreid over de gekozen weken, tegen de prijs die je kiest. Klanten betalen na de betaaltermijn.',
    'Een banktransactie die een open post al lijkt te betalen, telt niet dubbel: die post blijft uit de prognose tot je koppelt of "Niet deze" kiest.',
    'Per maand: Gebeurd = de banktransacties per koppeling; wat nog te koppelen is, staat bij Kosten of Klanten. Klanten en voorraad = facturen, offertes, partnervoorschotten, TICA en de huidige voorraad.',
    'Alle bedragen zijn incl. btw, tenzij er excl. bij staat.',
  ],
  overview: [
    'Eén rij per onderdeel, dit jaar tenzij er een andere periode bij staat. Kasprognose: de laagste stand over de gekozen horizon (standaard 6 maanden), met het scenario.',
    'Aandacht: tik op een rij voor de lijst erachter.',
  ],
  sales: [
    'De periode volgt de documentdatum; ontvangsten tellen op hun betaaldatum. Open offertes, open en vervallen facturen zijn de stand van vandaag, over alle jaren.',
    'Omzet, marge, open offertes en geaccepteerd zijn excl. btw; gefactureerd, ontvangen, open en vervallen incl. btw. Omzet is hetzelfde cijfer als op Resultaat.',
    'Voorschotten blijven financiering tot de slotafrekening; ze tellen niet als omzet en niet in het aantal facturen. Een creditnota toont geen marge. Oude documenten kunnen nog actuele productprijzen gebruiken.',
    'TICA telt apart mee als verkoopkanaal, op de verkoopdatum en na korting excl. btw. De afrekening en bankontvangst tellen niet opnieuw als omzet. TICA-marges gebruiken de huidige productkost; bij ontbrekende productkosten is de marge onvolledig.',
    'De TICA-kaart telt niets op: gemiddelden, korting en producten komen uit de TICA-regels van dezelfde periode (hoogstens de laatste 366 dagen).',
  ],
  inventory: [
    'Momentopname uit de productkaart en de open inkooporders, over alle locaties, in de verkoopeenheid van elk product (stuks of displays).',
    'Kostwaarde: tegen kostprijs met Enrosed-kost, excl. btw. Verkoopwaarde: lijstprijs excl. btw, vóór staffelkorting. Voor de boekhouding: Jaarinventaris.',
    'Het tempo komt van de facturen van de laatste 90 dagen; TICA-verkopen tellen daar nog niet in mee. Raakt op: binnen 8 weken op, met wat onderweg is.',
  ],
  'purchasing-kosten': [
    'Afspraak, betalingen en open bedragen naast elkaar. Meer- en minderbetalingen blijven per leverancier, douane en extra kost zichtbaar.',
    'Minder betaald telt pas als besparing zodra die betaalgroep of leverancierstermijn is afgerekend; open bedragen en voorschotten zijn geen besparing. Een tegoed van de leverancier verlaagt de eindkost.',
    'Enrosed-kost en productprijzen blijven gelijk; het betaalresultaat zit al in de verwachte containerkost en telt niet nog eens als winst.',
  ],
  'purchasing-kwaliteit': [
    'Ontvangen orders in de gekozen periode. Perfect: alles bruikbaar ontvangen zoals besteld; meer ontvangen telt als afwijking. Op tijd: ontvangen op of vóór de laatst opgeslagen ETA.',
    'Doorlooptijd: van besteldatum tot ontvangst; afgesproken is de levertijd op de leverancier.',
  ],
  'purchasing-partners': [
    'De partner financiert de afgesproken kosten vooraf of samen met ons. Elke termijn krijgt een eigen voorschotfactuur. Het resultaat volgt uit uitgegeven deel- en slotafrekeningen, naar de werkelijk afgerekende hoeveelheden.',
    'Netto ontvangen: ontvangsten min terugbetalingen. Eigen kasinleg: betaalde containerkosten min ontvangen partnergeld. Voorschotten zijn geen winst.',
  ],
  'purchasing-afwijkingen': [
    'Tekorten en schade blijven hier staan, ook nadat de container is afgerond.',
    'Aantallen in de verkoopeenheid van elk product.',
  ],
  result: [
    'De marge op de goederen van de uitgegeven facturen, min de kosten die we zelf maakten.',
    'Verkoop telt op de factuurdatum, kosten op hun datum; een investering met haar afschrijving van de periode. Alles excl. btw.',
    'TICA-verkopen tellen op de verkoopdatum, na korting excl. btw. De huidige productkost bepaalt de TICA-marge. Bevestigde TICA-commissie staat één keer bij de bedrijfskosten; de afrekening en uitbetaling voegen geen tweede omzet toe.',
    'Algemene kosten: kosten zonder verkoopkanaal, zodat de kanalen optellen tot het resultaat.',
    'Containers ontvangen telt niet in het resultaat: goederen worden kost wanneer ze verkocht zijn.',
  ],
  market: [
    'Koersen: ECB-referentiekoersen zonder bankopslag, elke werkdag bijgewerkt.',
    'Koopkracht: hoeveel meer of minder een dollar en een yuan nu kosten dan aan het begin van de periode, gemiddeld over beide.',
    'Vracht: onze offertes in USD per 40ft naast Drewry WCI Shanghai → Rotterdam van dezelfde week; de indexen (NCFI, CCFI) tonen enkel de richting.',
  ],
  website: [
    'Eigen meting zonder cookies en zonder adressen. Bezoekers tellen per dag: wie op drie dagen komt, telt drie keer.',
    'Een sessie: de pagina\'s van één bezoeker met minder dan 30 minuten ertussen. Bronnen tellen per sessie, op de eerste pagina.',
    'Niet meegeteld: robots, bezoeken vanuit het ERP en previews, onze eigen gemeenten, toestellen die zich uitsloten, en de eerste pagina van een bezoek dat in een AI-assistent begon.',
    'Aanvragen: offerte- en webaanvragen in het ERP met de website als herkomst, op hun documentdatum.',
    'Google Analytics en Google zoeken meten met hun eigen regels; tel ze niet bij de eigen meting op.',
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
