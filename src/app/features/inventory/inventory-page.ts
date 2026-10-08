import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { saveBlob } from '../../core/api/download';
import { messageOf, readableFailure } from '../../core/api/errors';
import { InventoryApi, refusalCode, refusalDetails } from '../../core/api/inventory-api';
import type { ClosingOverview, ClosingSummary, CountLocation, CountOverview } from '../../core/api/inventory-models';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { ContextMenu } from '../../shared/context-menu';
import type { ContextMenuItem } from '../../shared/context-menu';
import type { MenuPoint } from '../../shared/context-menu-position';
import { DateField } from '../../shared/date-field';
import { Icon } from '../../shared/icon';
import { PageHeader } from '../../shared/page-header';
import { EurPipe, NumPipe } from '../../shared/pipes';
import { BrusselsDatePipe } from './inventory-dates';
import { Skeleton } from '../../shared/skeleton';
import { Sheet, Ui } from '../../shared/ui';
import { dateText, defaultInventoryYear, fileName, todoText } from './inventory-closing';

/** What the sheet "Telling starten" holds; the year and the location can still be changed there. */
interface CountDraft {
  title: string;
  year: number;
  locationId: number | null;
  note: string;
}

interface ClosingDraft {
  year: number;
  /** yyyy-MM-dd; follows the year until the user sets a date of his own. */
  date: string;
  ownDate: boolean;
}

type RowMenu = { anchor: MenuPoint | null } & ({ location: CountLocation } | { closing: ClosingSummary });

/** Today in Brussels as yyyy-MM-dd: the financial year does not follow the device's time zone. */
function brusselsToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date());
}

const whole = (value: number) => value.toLocaleString('nl-BE');
const counted = (value: number, one: string, many: string) => `${whole(value)} ${value === 1 ? one : many}`;

/**
 * The hub of the Jaarinventaris: per financial year the count of every
 * location, the closing with its versions and files, and the valuation
 * rule. It starts counts and closings and leads to their screens; counting
 * happens on the count page, valuing in the closing. An ordinary page for
 * phone and desk; its own layout classes are the .inv-hub ones below.
 */
@Component({
  selector: 'app-inventory-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, RouterLink, PageHeader, Skeleton, Icon, Sheet, ContextMenu, DateField, BrusselsDatePipe, EurPipe, NumPipe],
  template: `
    <app-page-header [showBack]="true" backTo="/more" title="Jaarinventaris"
                     subtitle="Voorraadtelling en eindvoorraad met waarde, per boekjaar" />

    <div class="content inv-hub">
      <div class="inv-hub__year">
        <label for="inv-hub-year">Boekjaar</label>
        <select class="select" id="inv-hub-year" [disabled]="!years().length" (change)="pickYear(+$any($event.target).value)">
          @for (option of years(); track option) { <option [value]="option" [selected]="option === year()">{{ option }}</option> }
        </select>
      </div>

      @if (loadError(); as message) {
        <div class="alert alert--danger" role="alert">
          <span><strong>De jaarinventaris kon niet worden geladen.</strong> {{ message }}</span>
        </div>
        <p class="inv-hub__retry"><button class="btn btn--sm btn--primary" type="button" (click)="load()">Opnieuw proberen</button></p>
      } @else if (!closings() || !counts()) {
        <div aria-busy="true"><app-skeleton kind="card" /><app-skeleton kind="list" [rows]="4" /></div>
      } @else {
        @if (nothingYet()) {
          <p class="inv-hub__empty">Nog geen jaarinventaris. Start met een telling of met de afsluiting van het boekjaar.</p>
        }

        <section class="card" aria-labelledby="inv-hub-counts">
          <div class="card__head"><h2 id="inv-hub-counts">Tellingen {{ year() }}</h2></div>
          <p class="inv-hub__intro">Tel elke locatie. Twee mensen kunnen tegelijk op hun telefoon tellen; je kan stoppen en later verder tellen, alles wat je invult blijft bewaard. Er wordt pas iets in de voorraad geboekt wanneer je de telling boekt.
            @if (anyBooked()) { <span class="inv-hub__intro-more">'Telling corrigeren' is voor een tikfout of een doos die je later vond: je telt alleen de producten die je toevoegt.</span> }</p>
          @for (location of counts()!.locations; track location.locationId) {
            <div class="inv-hub__row">
              <div class="inv-hub__body">
                <div class="inv-hub__title">{{ location.locationName }}
                  <span class="inv-hub__kind">{{ kindText(location) }}</span></div>
                <div class="inv-hub__state">{{ countState(location) }}</div>
                @if (otherYearOpen(location); as other) {
                  <div class="inv-hub__state inv-hub__state--todo">Telling {{ other.countYear }} bezig op deze locatie · {{ other.countedCount | num }} van {{ other.lineCount | num }} geteld.
                    Een nieuwe telling of correctie kan pas wanneer die geboekt of geannuleerd is.</div>
                }
              </div>
              <div class="inv-hub__actions">
                @if (otherYearOpen(location); as other) {
                  @if (location.booked; as booked) {
                    <a class="btn btn--sm" [routerLink]="['/stock/inventaris/telling', booked.id]">Bekijk telling</a>
                  }
                  <a class="btn btn--sm" [routerLink]="['/stock/inventaris/telling', other.id]">Open telling {{ other.countYear }}</a>
                } @else if (location.open; as open) {
                  <a class="btn btn--sm btn--primary" [routerLink]="['/stock/inventaris/telling', open.id]">Verder tellen</a>
                } @else if (location.booked; as booked) {
                  <a class="btn btn--sm" [routerLink]="['/stock/inventaris/telling', booked.id]">Bekijk telling</a>
                  <button class="btn btn--sm" type="button" [disabled]="busy()" (click)="startCorrection(location)">Telling corrigeren</button>
                  <button class="btn btn--sm inv-hub__more" type="button" [attr.aria-label]="'Meer voor ' + location.locationName"
                          (click)="openMenu($event, { location })"><app-icon name="more" [size]="20" /></button>
                } @else if (location.productsWithStock > 0) {
                  <button class="btn btn--sm btn--primary" type="button" [disabled]="busy()" (click)="askCount(location, 'Telling starten')">Telling starten</button>
                } @else {
                  <button class="btn btn--sm" type="button" [disabled]="busy()" (click)="confirmEmpty(location)">Lege locatie bevestigen</button>
                }
              </div>
            </div>
          } @empty {
            <p class="inv-hub__none">Er zijn geen voorraadlocaties.</p>
          }
        </section>

        <section class="card" aria-labelledby="inv-hub-closing">
          <div class="card__head"><h2 id="inv-hub-closing">Eindvoorraad {{ year() }}</h2></div>
          @if (!yearClosings().length) {
            <div class="inv-hub__row">
              <div class="inv-hub__body"><div class="inv-hub__state">Nog geen afsluiting voor {{ year() }}.</div></div>
              <div class="inv-hub__actions">
                <button class="btn btn--sm btn--primary" type="button" [disabled]="busy()" (click)="askClosing()">Afsluiting starten</button>
              </div>
            </div>
          } @else {
            @for (closing of currentClosings(); track closing.id) {
              <ng-container [ngTemplateOutlet]="closingRow" [ngTemplateOutletContext]="{ $implicit: closing }" />
            }
            @if (replacedClosings().length) {
              <details class="inv-hub__fold">
                <summary>Eerdere versies ({{ replacedClosings().length }})</summary>
                @for (closing of replacedClosings(); track closing.id) {
                  <ng-container [ngTemplateOutlet]="closingRow" [ngTemplateOutletContext]="{ $implicit: closing }" />
                }
              </details>
            }
          }
        </section>

        <section class="card" aria-labelledby="inv-hub-rule">
          <div class="card__head"><h2 id="inv-hub-rule">Waarderingsregel</h2></div>
          <div class="inv-hub__row">
            <div class="inv-hub__body">
              @if (closings()!.rule; as rule) {
                <div class="inv-hub__title">{{ rule.methodLabel }} · van toepassing sinds boekjaar {{ rule.effectiveFromYear }}</div>
              } @else {
                <div class="inv-hub__title">FIFO per ontvangen partij</div>
              }
              <div class="inv-hub__state">Aanschafwaarde zonder Enrosed kost</div>
              @if (!closings()!.closings.length) { <div class="inv-hub__state">Wordt vastgelegd bij de eerste afsluiting.</div> }
              @if (closings()!.closings.length && !anyFinal()) { <div class="inv-hub__state">De regel geldt vanaf het boekjaar van je eerste afsluiting. Dat jaar ligt vast zodra een afsluiting definitief is.</div> }
            </div>
            @if (closings()!.rule) {
              <div class="inv-hub__actions"><button class="inv-hub__link" type="button" (click)="ruleOpen.set(true)">Tekst bekijken</button></div>
            }
          </div>
        </section>
      }
    </div>

    <ng-template #closingRow let-closing>
      <div class="inv-hub__row">
        <a class="inv-hub__body inv-hub__body--link" [routerLink]="['/stock/inventaris/afsluiting', closing.id]">
          @if (closing.status === 'CONCEPT') {
            <div class="inv-hub__title">Versie {{ closing.versionNo }} · per {{ closing.closingDate | brusselsDate }} · Concept</div>
            <div class="inv-hub__state" [class.inv-hub__state--todo]="closing.blockerCount > 0" [class.inv-hub__state--ok]="closing.blockerCount === 0">{{ todo(closing) }}</div>
          } @else {
            <div class="inv-hub__title">Versie {{ closing.versionNo }} · per {{ closing.closingDate | brusselsDate }} · Definitief</div>
            @if (closing.superseded) { <div class="inv-hub__state">{{ replacedText(closing) }}</div> }
            <div class="inv-hub__state">
              @if (closing.totalValueEur !== null) { Totaal voorraadwaarde <b class="inv-hub__total">{{ closing.totalValueEur | eur }}</b> }
              @if (closing.estimatedEur !== null) { · waarvan geschat {{ closing.estimatedEur | eur }} }
            </div>
            <div class="inv-hub__state">Definitief gemaakt op {{ closing.finalizedAt | brusselsDate }}@if (closing.finalizedByName) { door {{ closing.finalizedByName }} }</div>
          }
          @if (closing.status !== 'CONCEPT') { <span class="inv-hub__chev" aria-hidden="true">›</span> }
        </a>
        <div class="inv-hub__actions">
          @if (closing.status === 'CONCEPT') {
            <a class="btn btn--sm btn--primary" [routerLink]="['/stock/inventaris/afsluiting', closing.id]">Verder met afsluiten</a>
            <button class="btn btn--sm inv-hub__more" type="button" [attr.aria-label]="'Meer voor versie ' + closing.versionNo"
                    (click)="openMenu($event, { closing })"><app-icon name="more" [size]="20" /></button>
          } @else {
            <button class="btn btn--sm" type="button" [disabled]="busy()" (click)="download(closing, 'pdf')">PDF</button>
            <button class="btn btn--sm" type="button" [disabled]="busy()" (click)="download(closing, 'xlsx')">Excel</button>
          }
        </div>
      </div>
    </ng-template>

    @if (countDraft(); as draft) {
      <app-sheet [title]="draft.title" (closed)="countDraft.set(null)">
        <div body>
          <div class="field"><label for="inv-start-year">Boekjaar</label>
            <select class="select" id="inv-start-year" (change)="patchCount({ year: +$any($event.target).value })">
              @for (option of years(); track option) { <option [value]="option" [selected]="option === draft.year">{{ option }}</option> }
            </select></div>
          <div class="field"><label for="inv-start-location">Locatie</label>
            <select class="select" id="inv-start-location" (change)="patchCount({ locationId: +$any($event.target).value || null })">
              <option value="">Kies een locatie</option>
              @for (location of counts()?.locations ?? []; track location.locationId) {
                <option [value]="location.locationId" [selected]="location.locationId === draft.locationId">{{ location.locationName }}</option>
              }
            </select></div>
          <div class="field"><label for="inv-start-note">Notitie <span class="opt"></span></label>
            <textarea class="textarea" id="inv-start-note" rows="2" maxlength="500" [value]="draft.note"
                      (input)="patchCount({ note: $any($event.target).value })"></textarea></div>
        </div>
        <div foot style="display:contents">
          <button class="btn" type="button" (click)="countDraft.set(null)">Annuleren</button>
          <button class="btn btn--primary" type="button" [disabled]="busy() || draft.locationId === null" (click)="startDraft()">{{ busy() ? 'Bezig…' : 'Start telling' }}</button>
        </div>
      </app-sheet>
    }

    @if (closingDraft(); as draft) {
      <app-sheet title="Afsluiting starten" (closed)="closingDraft.set(null)">
        <div body>
          <div class="field"><label for="inv-closing-year">Boekjaar</label>
            <select class="select" id="inv-closing-year" (change)="patchClosingYear(+$any($event.target).value)">
              @for (option of years(); track option) { <option [value]="option" [selected]="option === draft.year">{{ option }}</option> }
            </select></div>
          <div class="field"><label for="inv-closing-date">Afsluitdatum</label>
            <app-date-field fieldId="inv-closing-date" [value]="draft.date" (valueChange)="patchClosingDate($event)" />
            <span class="hint">Pas aan bij een verlengd boekjaar</span></div>
        </div>
        <div foot style="display:contents">
          <button class="btn" type="button" (click)="closingDraft.set(null)">Annuleren</button>
          <button class="btn btn--primary" type="button" [disabled]="busy() || !draft.date" (click)="createClosing()">{{ busy() ? 'Bezig…' : 'Aanmaken' }}</button>
        </div>
      </app-sheet>
    }

    @if (ruleOpen() && closings()?.rule; as rule) {
      <app-sheet title="Waarderingsregel" [wide]="true" (closed)="ruleOpen.set(false)">
        <div body><p class="inv-hub__rule">{{ rule.text }}</p></div>
      </app-sheet>
    }

    @if (menu(); as open) {
      <app-context-menu [items]="menuItems()" [title]="menuTitle()" [anchor]="open.anchor" cancelLabel="Annuleren"
                        (pick)="pickMenu($event)" (closed)="menu.set(null)" />
    }
  `,
  styles: `
    .inv-hub { max-width: 920px; }
    .inv-hub > .card { margin-top: 12px; }
    .inv-hub__year { display: flex; align-items: center; gap: 10px; margin: 0 2px 4px; }
    .inv-hub__year label { color: var(--ink-2); font-size: 13px; font-weight: 650; }
    .inv-hub__year .select { width: auto; min-width: 110px; }
    .inv-hub__empty { margin: 14px 2px 2px; padding: 12px 14px; border-radius: var(--r-sm); background: var(--surface-2);
      color: var(--ink-2); font-size: 14px; line-height: 1.45; }
    .inv-hub__intro { margin: 0; padding: 12px 14px; border-bottom: 1px solid var(--line); color: var(--ink-2);
      font-size: 13.5px; line-height: 1.5; }
    .inv-hub__row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 12px 14px;
      border-bottom: 1px solid var(--line); }
    .inv-hub__row:last-child { border-bottom: 0; }
    .inv-hub__body { flex: 1 1 240px; min-width: 0; display: grid; gap: 2px; color: inherit; text-decoration: none; }
    .inv-hub__body--link { position: relative; padding-right: 22px; cursor: pointer; }
    .inv-hub__chev { position: absolute; top: 50%; right: 2px; transform: translateY(-50%); color: var(--muted-2); font-size: 18px; }
    .inv-hub__body--link:focus-visible { outline: 2px solid var(--rose); outline-offset: 3px; border-radius: 6px; }
    .inv-hub__title { font-size: 14.5px; font-weight: 650; line-height: 1.35; overflow-wrap: anywhere; }
    .inv-hub__kind { margin-left: 6px; color: var(--muted); font-size: 12.5px; font-weight: 500; }
    .inv-hub__state { color: var(--muted); font-size: 13px; line-height: 1.45; font-variant-numeric: tabular-nums; }
    .inv-hub__state--todo { color: var(--warn); font-weight: 650; }
    .inv-hub__state--ok { color: var(--ok, #1f7a4d); font-weight: 650; }
    .inv-hub__intro-more { display: block; margin-top: 6px; color: var(--muted); font-size: 12.5px; }
    .inv-hub__retry { margin: 12px 2px 0; }
    .inv-hub__total { color: var(--ink); font-weight: 700; }
    .inv-hub__actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .inv-hub__more { width: 44px; padding: 0; }
    .inv-hub__none { margin: 0; padding: 14px; color: var(--muted); font-size: 13.5px; }
    .inv-hub__fold { border-top: 1px solid var(--line); }
    .inv-hub__fold > summary { display: flex; align-items: center; min-height: 44px; padding: 6px 14px; color: var(--ink-2);
      font-size: 13px; font-weight: 650; cursor: pointer; }
    .inv-hub__fold[open] > summary { border-bottom: 1px solid var(--line); }
    .inv-hub__link { min-height: 34px; padding: 0; border: 0; background: none; color: var(--rose-dark); font: inherit;
      font-size: 13.5px; font-weight: 650; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
    .inv-hub__rule { margin: 0; color: var(--ink-2); font-size: 14px; line-height: 1.6; white-space: pre-line; }
    @media (min-width: 680px) {
      .inv-hub__more { width: 34px; }
    }
  `,
})
export class InventoryPage {
  private readonly api = inject(InventoryApi);
  private readonly ui = inject(Ui);
  private readonly router = inject(Router);
  private readonly desktop = inject(DesktopViewport);

  /** Query `jaar`: the financial year on screen; absent = the default year. */
  readonly jaar = input<string>();

  readonly closings = signal<ClosingOverview | null>(null);
  readonly counts = signal<CountOverview | null>(null);
  readonly loadError = signal<string | null>(null);
  /** A start, a create, a delete or a download under way. */
  readonly busy = signal(false);

  readonly countDraft = signal<CountDraft | null>(null);
  readonly closingDraft = signal<ClosingDraft | null>(null);
  readonly ruleOpen = signal(false);
  readonly menu = signal<RowMenu | null>(null);

  private readonly today = brusselsToday();
  /** The default year once it is known: deleting a concept must not move the page to another year. */
  private readonly firstYear = signal<number | null>(null);
  private run = 0;

  private readonly chosenYear = computed(() => {
    const year = Number(this.jaar());
    return Number.isInteger(year) && year >= 2000 && year <= 2200 ? year : null;
  });
  /** Null until the closings are read: without `jaar` the default year depends on an open concept. */
  readonly year = computed(() => {
    const chosen = this.chosenYear();
    return chosen !== null ? chosen : this.firstYear();
  });
  /** Every year with a closing or a count, this year and last year, and the one on screen; newest first. */
  readonly years = computed(() => {
    const thisYear = Number(this.today.slice(0, 4));
    const all = new Set<number>([thisYear, thisYear - 1]);
    for (const closing of this.closings()?.closings ?? []) all.add(closing.closingYear);
    for (const year of this.counts()?.years ?? []) all.add(year);
    const shown = this.year();
    if (shown !== null) all.add(shown);
    return [...all].sort((a, b) => b - a);
  });
  readonly yearClosings = computed(() =>
    (this.closings()?.closings ?? []).filter((closing) => closing.closingYear === this.year())
      .sort((a, b) => b.versionNo - a.versionNo));
  readonly currentClosings = computed(() => this.yearClosings().filter((closing) => !closing.superseded));
  readonly replacedClosings = computed(() => this.yearClosings().filter((closing) => closing.superseded));
  readonly anyFinal = computed(() => (this.closings()?.closings ?? []).some((closing) => closing.status === 'DEFINITIEF'));
  /** A booked count on screen: the one explanation of "Telling corrigeren" is shown under the intro. */
  readonly anyBooked = computed(() => (this.counts()?.locations ?? []).some((location) => location.booked && !location.open));
  readonly nothingYet = computed(() => !this.closings()?.closings.length && !this.counts()?.years.length);

  readonly menuItems = computed<ContextMenuItem[]>(() => {
    const open = this.menu();
    if (!open) return [];
    return 'location' in open
      ? [{ id: 'recount', label: 'Volledig opnieuw tellen', iconName: 'stock' }]
      : [{ id: 'delete', label: 'Concept verwijderen', iconName: 'trash', danger: true }];
  });
  readonly menuTitle = computed(() => {
    const open = this.menu();
    if (!open) return '';
    return 'location' in open ? open.location.locationName : `Versie ${open.closing.versionNo} · Concept`;
  });

  constructor() {
    effect(() => {
      this.chosenYear();
      untracked(() => void this.load());
    });
  }

  /* ------------------------------------------------------------- loading */

  async load(): Promise<void> {
    const run = ++this.run;
    this.loadError.set(null);
    try {
      /* The closings first: without a year in the address they decide which year the counts are read for. */
      const closings = await this.api.closings();
      if (run !== this.run) return;
      this.closings.set(closings);
      if (this.firstYear() === null) this.firstYear.set(defaultInventoryYear(this.today, closings.closings));
      const counts = await this.api.countOverview(this.year());
      if (run !== this.run) return;
      this.counts.set(counts);
    } catch (failure) {
      if (run !== this.run) return;
      this.closings.set(null);
      this.counts.set(null);
      this.loadError.set(messageOf(failure, 'Probeer het opnieuw.'));
    }
  }

  pickYear(year: number): void {
    if (year === this.year()) return;
    this.counts.set(null);
    void this.router.navigate([], { queryParams: { jaar: year }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  /* -------------------------------------------------------------- counts */

  /**
   * The server answers the location's open session whatever its year (one
   * session per location at a time). When it belongs to another year than
   * the one on screen it is shown as such, and the booked count of the year
   * on screen stays visible beside it.
   */
  otherYearOpen(location: CountLocation): CountLocation['open'] {
    const open = location.open;
    return open && this.year() !== null && open.countYear !== this.year() ? open : null;
  }

  /** "Magazijn" once when name and kind are the same word. */
  kindText(location: CountLocation): string {
    const same = location.kindLabel.trim().toLocaleLowerCase('nl-BE') === location.locationName.trim().toLocaleLowerCase('nl-BE');
    return [same ? '' : location.kindLabel, location.active ? '' : 'inactief'].filter(Boolean).join(' · ');
  }

  todo(closing: ClosingSummary): string {
    return todoText(closing.blockerCount);
  }

  countState(location: CountLocation): string {
    const open = this.otherYearOpen(location) ? null : location.open;
    if (open) {
      return open.correctsCountId !== null
        ? `Correctie bezig · ${counted(open.countedCount, 'product', 'producten')}`
        : `Bezig · ${whole(open.countedCount)} van ${whole(open.lineCount)} geteld`;
    }
    const booked = location.booked;
    if (booked) {
      const date = dateText(booked.bookedAt);
      return `Geboekt op ${date} door ${booked.bookedByName || 'onbekend'} · ${counted(booked.differenceCount, 'verschil', 'verschillen')}`
        + (location.correctionCount > 0 ? ` · ${counted(location.correctionCount, 'correctie', 'correcties')}` : '');
    }
    return location.productsWithStock > 0
      ? `Nog niet geteld · ${counted(location.productsWithStock, 'product', 'producten')} met voorraad`
      : 'Geen voorraad · bevestig met een lege telling';
  }

  askCount(location: CountLocation, title: string): void {
    const year = this.year();
    if (year === null) return;
    this.countDraft.set({ title, year, locationId: location.locationId, note: '' });
  }

  patchCount(patch: Partial<CountDraft>): void {
    this.countDraft.update((draft) => (draft ? { ...draft, ...patch } : draft));
  }

  startDraft(): void {
    const draft = this.countDraft();
    if (!draft || draft.locationId === null) return;
    void this.startCount(draft.year, draft.locationId, draft.note.trim() || null, null, false);
  }

  /** A location without stock: a full count that goes straight to its booking sheet. */
  confirmEmpty(location: CountLocation): void {
    const year = this.year();
    if (year !== null) void this.startCount(year, location.locationId, null, null, true);
  }

  startCorrection(location: CountLocation): void {
    const year = this.year();
    if (year !== null && location.booked) void this.startCount(year, location.locationId, null, location.booked.id, false);
  }

  private async startCount(
    year: number, locationId: number, note: string | null, correctsCountId: number | null, book: boolean,
  ): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const view = await this.api.startCount(year, locationId, note, correctsCountId);
      this.countDraft.set(null);
      await this.router.navigate(['/stock/inventaris/telling', view.id], book ? { queryParams: { boeken: 1 } } : {});
    } catch (failure) {
      const running = refusalCode(failure) === 'TELLING_LOOPT' ? refusalDetails<{ countId: number }>(failure)?.countId ?? null : null;
      this.ui.toast(messageOf(failure, 'De telling kon niet worden gestart.'), 'err');
      if (running !== null) {
        /* Somebody started this location meanwhile: that session is the one to count in. */
        this.countDraft.set(null);
        await this.router.navigate(['/stock/inventaris/telling', running]);
      }
    } finally {
      this.busy.set(false);
    }
  }

  /* ------------------------------------------------------------ closings */

  askClosing(): void {
    const year = this.year();
    if (year !== null) this.closingDraft.set({ year, date: `${year}-12-31`, ownDate: false });
  }

  patchClosingYear(year: number): void {
    this.closingDraft.update((draft) => (draft ? { ...draft, year, date: draft.ownDate ? draft.date : `${year}-12-31` } : draft));
  }

  patchClosingDate(date: string): void {
    this.closingDraft.update((draft) => (draft ? { ...draft, date, ownDate: date !== `${draft.year}-12-31` } : draft));
  }

  async createClosing(): Promise<void> {
    const draft = this.closingDraft();
    if (!draft || !draft.date || this.busy()) return;
    this.busy.set(true);
    try {
      const view = await this.api.createClosing(draft.year, draft.date);
      this.closingDraft.set(null);
      await this.router.navigate(['/stock/inventaris/afsluiting', view.id]);
    } catch (failure) {
      const existing = refusalCode(failure) === 'BESTAAT_AL' ? refusalDetails<{ closingId: number }>(failure)?.closingId ?? null : null;
      this.ui.toast(messageOf(failure, 'De afsluiting kon niet worden aangemaakt.'), 'err');
      if (existing !== null) {
        this.closingDraft.set(null);
        await this.router.navigate(['/stock/inventaris/afsluiting', existing]);
      }
    } finally {
      this.busy.set(false);
    }
  }

  /** The version that took the place of a replaced one: the next final version of the year. */
  replacedText(closing: ClosingSummary): string {
    const next = this.yearClosings()
      .filter((other) => other.status === 'DEFINITIEF' && other.versionNo > closing.versionNo)
      .reduce<number | null>((lowest, other) => (lowest === null || other.versionNo < lowest ? other.versionNo : lowest), null);
    return next === null ? 'Vervangen' : `Vervangen door versie ${next}`;
  }

  async download(closing: ClosingSummary, kind: 'pdf' | 'xlsx'): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const blob = kind === 'pdf' ? await this.api.closingPdf(closing.id) : await this.api.closingXlsx(closing.id);
      saveBlob(blob, fileName(closing, kind));
    } catch (failure) {
      /* The refusal of a file route arrives as a Blob: read the server's sentence out of it. */
      const readable = await readableFailure(failure);
      this.ui.toast(messageOf(readable, kind === 'pdf' ? 'De PDF kon niet worden gedownload.' : 'Het Excel-bestand kon niet worden gedownload.'), 'err');
    } finally {
      this.busy.set(false);
    }
  }

  private askDelete(closing: ClosingSummary): void {
    this.ui.confirm({
      title: 'Concept verwijderen?',
      message: 'Dit concept en zijn beslissingen verdwijnen. Tellingen en beginwaarden blijven.',
      confirmLabel: 'Concept verwijderen',
      danger: true,
    }, () => void this.deleteClosing(closing));
  }

  private async deleteClosing(closing: ClosingSummary): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await this.api.deleteClosing(closing.id);
      this.ui.toast('Concept verwijderd');
    } catch (failure) {
      this.ui.toast(messageOf(failure, 'Het concept kon niet worden verwijderd.'), 'err');
    } finally {
      this.busy.set(false);
    }
    /* Also after a refusal: the concept may have become final meanwhile. */
    await this.load();
  }

  /* ---------------------------------------------------------------- menu */

  openMenu(event: MouseEvent, target: { location: CountLocation } | { closing: ClosingSummary }): void {
    const button = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.menu.set({ ...target, anchor: this.desktop.active() ? { x: button.left, y: button.bottom + 4 } : null });
  }

  pickMenu(item: ContextMenuItem): void {
    const open = this.menu();
    this.menu.set(null);
    if (!open) return;
    if (item.id === 'recount' && 'location' in open) this.askCount(open.location, 'Volledig opnieuw tellen');
    else if (item.id === 'delete' && 'closing' in open) this.askDelete(open.closing);
  }
}
