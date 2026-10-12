import { ChangeDetectionStrategy, Component, computed, forwardRef, inject, signal } from '@angular/core';
import { CostParty, Fair } from '../../core/api/models';
import type { ContextMenuItem } from '../../shared/context-menu';
import type { MenuPoint } from '../../shared/context-menu-position';
import { Icon } from '../../shared/icon';
import { MenuTrigger } from '../../shared/menu-trigger';
import { EurPipe } from '../../shared/pipes';
import { dayMonth } from './finance-format';
import { FINANCE_SECTION, FinanceSectionApi, StripItem } from './finance-section';
import type { FinanceCommand } from './finance-shortcuts';
import { FinanceState } from './finance-state';
import { normaliseParty } from './party-suggestions';

interface PartyRow {
  party: CostParty;
  /** "Beurs & stand · 21 % · TICA", or ''. */
  detail: string;
  /** With a space every four characters. */
  iban: string;
  count: number;
  exclEur: number;
  lastDate: string | null;
}

interface FairRow {
  fair: Fair;
  count: number;
  exclEur: number;
}

/**
 * Uitgaven › Aan wie & beurzen: the stored names with their defaults and
 * this year's figures, the names the bookings know but the list does not
 * yet (folded), and the fairs with their switch. The search box filters
 * all three.
 */
@Component({
  selector: 'app-cost-lists-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: FINANCE_SECTION, useExisting: forwardRef(() => CostListsPanel) }],
  imports: [Icon, EurPipe, MenuTrigger],
  template: `
    @if (state.desk()) {
      <div class="fin-lists">
        <section class="wk-card" aria-labelledby="fin-parties-title">
          <header class="wk-card__head"><h2 class="wk-card__title" id="fin-parties-title">Aan wie</h2><span class="wk-card__trail">{{ parties().length }}</span>
            <button class="wk-btn wk-btn--sm" type="button" (click)="state.openCostParty(null)"><app-icon name="plus" [size]="14" />Aan wie toevoegen</button></header>
          @if (parties().length) {
            <div class="wk-table fin-table fin-table--parties" role="grid" aria-label="Aan wie">
              <div class="wk-thead" role="row">
                <span class="wk-th" role="columnheader">Naam</span>
                <span class="wk-th" role="columnheader">Standaard</span>
                <span class="wk-th fin-lists-md" role="columnheader">IBAN</span>
                <span class="wk-th wk-th--num" role="columnheader">Kosten dit jaar</span>
                <span class="wk-th wk-th--num" role="columnheader">Totaal excl.</span>
                <span class="wk-th fin-lists-sm" role="columnheader">Laatst</span>
              </div>
              @for (row of parties(); track row.party.id) {
                <div class="wk-tr wk-tr--link" role="row" tabindex="0" (dblclick)="state.openCostParty(row.party)" (keydown.enter)="state.openCostParty(row.party)"
                     appMenuTrigger (menuTrigger)="partyMenu(row, $event)">
                  <span class="wk-td" role="gridcell"><b>{{ row.party.name }}</b></span>
                  <span class="wk-td" role="gridcell" [class.wk-tr--muted]="!row.detail">{{ row.detail || 'Geen standaard' }}</span>
                  <span class="wk-td fin-lists-md fin-iban" role="gridcell">{{ row.iban || '—' }}</span>
                  <span class="wk-td wk-td--num" role="gridcell">{{ row.count || '—' }}</span>
                  <span class="wk-td wk-td--num" role="gridcell">@if (row.count) { {{ row.exclEur | eur }} } @else { — }</span>
                  <span class="wk-td fin-lists-sm" role="gridcell">{{ row.lastDate ? day(row.lastDate) : '—' }}</span>
                </div>
              }
            </div>
          } @else {
            <div class="wk-empty"><span class="wk-empty__icon"><app-icon name="customers" [size]="22" /></span>
              <p class="wk-empty__title">{{ query() ? 'Niemand gevonden' : 'Nog niemand in de lijst' }}</p>
              <p class="wk-empty__text">{{ query() ? 'Geen naam in de lijst Aan wie past bij je zoekterm.' : 'Elke kost of bankbeweging met een naam komt hier vanzelf bij.' }}</p></div>
          }
        </section>
        @if (seen().length) {
          <section class="wk-card">
            <header class="wk-card__head">
              <button class="fin-lists__toggle" type="button" [attr.aria-expanded]="seenOpen()" (click)="seenOpen.set(!seenOpen())">
                <app-icon [name]="seenOpen() ? 'chevron-down' : 'chevron-right'" [size]="14" /><h2 class="wk-card__title">Nog niet in de lijst</h2></button>
              <span class="wk-card__trail">{{ seen().length }}</span></header>
            @if (seenOpen()) {
              <div class="wk-table fin-table fin-table--seen" role="grid" aria-label="Nog niet in de lijst">
                <div class="wk-thead" role="row">
                  <span class="wk-th" role="columnheader">Naam</span>
                  <span class="wk-th wk-th--num" role="columnheader">Boekingen</span>
                  <span class="wk-th wk-th--num" role="columnheader">Kosten dit jaar</span>
                  <span class="wk-th wk-th--num" role="columnheader">Totaal excl.</span>
                  <span class="wk-th" role="columnheader"></span>
                </div>
                @for (row of seen(); track row.name) {
                  <div class="wk-tr" role="row">
                    <span class="wk-td" role="gridcell"><b>{{ row.name }}</b></span>
                    <span class="wk-td wk-td--num" role="gridcell">{{ row.count }}</span>
                    <span class="wk-td wk-td--num" role="gridcell">{{ figures(row.name).count || '—' }}</span>
                    <span class="wk-td wk-td--num" role="gridcell">@if (figures(row.name).count) { {{ figures(row.name).exclEur | eur }} } @else { — }</span>
                    <span class="wk-td fin-td-end" role="gridcell"><button class="wk-btn wk-btn--sm" type="button" [disabled]="state.saving()" (click)="state.storeSeenParty(row.name)">Bewaren</button></span>
                  </div>
                }
              </div>
            }
          </section>
        }
        <section class="wk-card" aria-labelledby="fin-fairs-title">
          <header class="wk-card__head"><h2 class="wk-card__title" id="fin-fairs-title">Beurzen</h2><span class="wk-card__trail">{{ fairRows().length }}</span>
            <button class="wk-btn wk-btn--sm" type="button" (click)="state.openFair(null)"><app-icon name="plus" [size]="14" />Beurs toevoegen</button></header>
          @if (fairRows().length) {
            <div class="wk-table fin-table fin-table--fairs" role="grid" aria-label="Beurzen">
              <div class="wk-thead" role="row">
                <span class="wk-th" role="columnheader">Naam</span>
                <span class="wk-th fin-lists-sm" role="columnheader">Code</span>
                <span class="wk-th wk-th--num" role="columnheader">Kosten dit jaar</span>
                <span class="wk-th wk-th--num" role="columnheader">Totaal excl.</span>
                <span class="wk-th" role="columnheader">Actief</span>
              </div>
              @for (row of fairRows(); track row.fair.id) {
                <div class="wk-tr wk-tr--link" role="row" tabindex="0" [class.wk-tr--muted]="!row.fair.active" (dblclick)="state.openFair(row.fair)" (keydown.enter)="state.openFair(row.fair)"
                     appMenuTrigger (menuTrigger)="fairMenu(row, $event)">
                  <span class="wk-td" role="gridcell"><b>{{ row.fair.label }}</b></span>
                  <span class="wk-td fin-lists-sm" role="gridcell">{{ row.fair.code }}</span>
                  <span class="wk-td wk-td--num" role="gridcell">{{ row.count || '—' }}</span>
                  <span class="wk-td wk-td--num" role="gridcell">@if (row.count) { {{ row.exclEur | eur }} } @else { — }</span>
                  <span class="wk-td" role="gridcell">
                    <input class="fin-switch" type="checkbox" role="switch" [checked]="row.fair.active" [disabled]="state.saving()"
                           [attr.aria-label]="(row.fair.active ? 'Zet uit: ' : 'Zet aan: ') + row.fair.label" (click)="$event.stopPropagation()" (change)="flip(row.fair, $event)" />
                  </span>
                </div>
              }
            </div>
          } @else {
            <div class="wk-empty"><span class="wk-empty__icon"><app-icon name="tag" [size]="22" /></span>
              <p class="wk-empty__title">{{ query() ? 'Geen beurs gevonden' : 'Nog geen beurzen' }}</p>
              <p class="wk-empty__text">{{ query() ? 'Geen beurs past bij je zoekterm.' : 'TICA, Ede, …: een beurs is een kanaal waar je kosten aan hangen.' }}</p></div>
          }
        </section>
      </div>
    } @else {
      <section class="ios-section">
        <div class="ios-section__head"><h2>Aan wie</h2><button class="ios-section__link" type="button" (click)="state.openCostParty(null)">Toevoegen</button></div>
        <div class="ios-group">
          @for (row of parties(); track row.party.id) {
            <button class="ios-cell" type="button" appMenuTrigger (menuTrigger)="partyMenu(row, null)" (click)="state.openCostParty(row.party)">
              <span class="ios-cell__body"><span class="ios-cell__title">{{ row.party.name }}</span><span class="ios-cell__sub">{{ row.detail || 'Geen standaard' }}</span></span>
              <span class="ios-cell__trail">
                @if (row.count) { <span class="ios-cell__value">{{ row.exclEur | eur }}</span><span class="ios-cell__sub">{{ row.count }} {{ row.count === 1 ? 'kost' : 'kosten' }} dit jaar</span> }
                @else { <span class="ios-cell__sub">{{ row.lastDate ? 'laatst ' + day(row.lastDate) : 'nog geen kost' }}</span> }
              </span>
              <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
            </button>
          } @empty {
            <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__sub fin-wrap">{{ query() ? 'Niemand gevonden.' : 'Nog niemand in de lijst. Elke kost of bankbeweging met een naam komt hier vanzelf bij.' }}</span></span></div>
          }
        </div>
      </section>
      @if (seen().length) {
        <section class="ios-section">
          <details class="ios-group ios-disclosure">
            <summary>Nog niet in de lijst <span class="ios-section__trail">{{ seen().length }}</span><app-icon class="ios-cell__chev" name="chevron-right" [size]="16" /></summary>
            @for (row of seen(); track row.name) {
              <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">{{ row.name }}</span><span class="ios-cell__sub">{{ row.count }} {{ row.count === 1 ? 'boeking' : 'boekingen' }}</span></span>
                <button class="ios-capsule ios-capsule--sm ios-capsule--tinted" type="button" [disabled]="state.saving()" (click)="state.storeSeenParty(row.name)">Bewaren</button></div>
            }
          </details>
        </section>
      }
      <section class="ios-section">
        <div class="ios-section__head"><h2>Beurzen</h2><button class="ios-section__link" type="button" (click)="state.openFair(null)">Toevoegen</button></div>
        <div class="ios-group">
          @for (row of fairRows(); track row.fair.id) {
            <div class="ios-cell">
              <button class="fin-cell-button" type="button" appMenuTrigger (menuTrigger)="fairMenu(row, null)" (click)="state.openFair(row.fair)">
                <span class="ios-cell__body"><span class="ios-cell__title" [class.wk-tr--muted]="!row.fair.active">{{ row.fair.label }}</span>
                  <span class="ios-cell__sub">{{ row.fair.code }}{{ row.count ? ' · ' + row.count + (row.count === 1 ? ' kost' : ' kosten') + ' dit jaar' : '' }}</span></span>
                @if (row.count) { <span class="ios-cell__trail"><span class="ios-cell__value">{{ row.exclEur | eur }}</span></span> }
              </button>
              <input class="ios-switch" type="checkbox" role="switch" [checked]="row.fair.active" [disabled]="state.saving()"
                     [attr.aria-label]="(row.fair.active ? 'Zet uit: ' : 'Zet aan: ') + row.fair.label" (change)="flip(row.fair, $event)" />
            </div>
          } @empty {
            <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__sub fin-wrap">{{ query() ? 'Geen beurs gevonden.' : 'Nog geen beurzen. Voeg er een toe met +.' }}</span></span></div>
          }
        </div>
      </section>
    }
  `,
})
export class CostListsPanel implements FinanceSectionApi {
  readonly state = inject(FinanceState);
  /** "Nog niet in de lijst" starts folded. */
  readonly seenOpen = signal(false);

  readonly query = computed(() => normaliseParty(this.state.location().q));
  private readonly matches = (...parts: (string | null | undefined)[]): boolean => {
    const needle = this.query();
    return !needle || parts.some((part) => normaliseParty(part).includes(needle));
  };

  readonly parties = computed<PartyRow[]>(() => this.state.costParties().map((party) => {
    const figures = this.state.partyFiguresFor(party.name);
    return { party, detail: this.state.partyDetail(party), iban: spaced(party.iban), ...figures };
  }).filter((row) => this.matches(row.party.name, row.detail, row.iban, row.party.notes)));

  readonly seen = computed(() => this.state.unstoredParties().filter((row) => this.matches(row.name)));

  readonly fairRows = computed<FairRow[]>(() => {
    const year = this.state.today().slice(0, 4);
    const figures = new Map<string, { count: number; exclEur: number }>();
    for (const cost of this.state.costs()) {
      const code = (cost.salesChannel ?? '').trim().toUpperCase();
      if (!code || !cost.date.startsWith(year)) continue;
      const row = figures.get(code) ?? { count: 0, exclEur: 0 };
      row.count += 1;
      row.exclEur = Math.round((row.exclEur + (Number.isFinite(cost.amountExclEur) ? cost.amountExclEur : 0)) * 100) / 100;
      figures.set(code, row);
    }
    return this.state.fairs().map((fair) => ({ fair, ...(figures.get(fair.code.trim().toUpperCase()) ?? { count: 0, exclEur: 0 }) }))
      .filter((row) => this.matches(row.fair.label, row.fair.code));
  });

  readonly strip = computed<StripItem[]>(() => [
    { label: 'Aan wie', value: String(this.state.costParties().length), tone: 'strong' },
    ...(this.state.unstoredParties().length ? [{ label: 'Nog niet in de lijst', value: String(this.state.unstoredParties().length), tone: 'muted' as const }] : []),
    { label: 'Beurzen', value: `${this.state.fairs().filter((fair) => fair.active).length} actief van ${this.state.fairs().length}` },
  ]);
  readonly status = computed(() => `Aan wie ${this.state.costParties().length} · Beurzen ${this.state.fairs().length}`);

  /** Esc clears the search; the rest of the keyboard belongs to the page. */
  handle(command: FinanceCommand): boolean {
    if (command === 'escape' && this.state.location().q) {
      this.state.go({ q: '' });
      return true;
    }
    return false;
  }

  figures(name: string): { count: number; exclEur: number } {
    return this.state.partyFiguresFor(name);
  }

  partyMenu(row: PartyRow, anchor: MenuPoint | null): void {
    const items: ContextMenuItem[] = [
      { id: 'edit', label: 'Bewerken', iconName: 'pencil' },
      { id: 'costs', label: 'Toon kosten', iconName: 'receipt', disabled: !row.lastDate },
      { id: 'delete', label: 'Uit de lijst halen', iconName: 'trash', danger: true, divider: true },
    ];
    this.state.openMenu({ title: row.party.name, items, anchor, cancelLabel: anchor ? '' : 'Annuleren', pick: (id) => {
      if (id === 'edit') this.state.openCostParty(row.party);
      else if (id === 'costs') this.state.go({ view: 'costs', tab: 'company', period: 'all', q: row.party.name });
      else if (id === 'delete') this.state.deleteCostParty(row.party);
    } });
  }

  fairMenu(row: FairRow, anchor: MenuPoint | null): void {
    const items: ContextMenuItem[] = [
      { id: 'edit', label: 'Bewerken', iconName: 'pencil' },
      row.fair.active ? { id: 'off', label: 'Uitzetten', iconName: 'recent' } : { id: 'on', label: 'Aanzetten', iconName: 'tick' },
      { id: 'costs', label: 'Toon kosten', iconName: 'receipt', disabled: !row.count },
      { id: 'delete', label: 'Verwijderen', iconName: 'trash', danger: true, divider: true },
    ];
    this.state.openMenu({ title: row.fair.label, items, anchor, cancelLabel: anchor ? '' : 'Annuleren', pick: (id) => {
      if (id === 'edit') this.state.openFair(row.fair);
      else if (id === 'on' || id === 'off') void this.state.setFairActive(row.fair, id === 'on');
      else if (id === 'costs') this.state.go({ view: 'costs', tab: 'company', period: 'year', channel: row.fair.code });
      else if (id === 'delete') this.state.deleteFair(row.fair);
    } });
  }

  /** The switch asks the state; the box follows the data, not the click. */
  flip(fair: Fair, event: Event): void {
    (event.target as HTMLInputElement).checked = fair.active;
    void this.state.setFairActive(fair, !fair.active);
  }

  day(date: string): string { return dayMonth(date); }
}

/** 'BE68 5390 0754 7034': an IBAN in groups of four. */
function spaced(iban: string | null | undefined): string {
  return (iban ?? '').replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim();
}
