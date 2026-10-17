import { ChangeDetectionStrategy, Component, ElementRef, computed, forwardRef, inject, signal } from '@angular/core';
import { RecurringCost } from '../../core/api/models';
import { Icon } from '../../shared/icon';
import { MenuTrigger } from '../../shared/menu-trigger';
import { EurPipe } from '../../shared/pipes';
import { SwipeActions } from '../../shared/swipe-actions';
import { categoryLabel, categoryTone } from './cost-categories';
import { dayMonth, dayMonthYear, monthLabel, monthShort } from './finance-format';
import { addDays, cashTotalOf, intervalLabel, perYear, recurringGroups, recurringSummary, upcomingRecurring } from './finance-metrics';
import type { UpcomingCost } from './finance-metrics';
import { FINANCE_SECTION, FinanceSectionApi, StripItem } from './finance-section';
import type { FinanceCommand } from './finance-shortcuts';
import { FinanceState, formatEuro } from './finance-state';
import { FinanceTable } from './finance-table';
import { blankRecurring } from './finance-sections';
import { recurringCandidates, type RecurringCandidate } from './recurring-candidates';

type GroupId = 'active' | 'paused' | 'ended';

/**
 * Uitgaven › Vaste kosten: the definitions, grouped the way the server sees
 * them (active, paused, ended), with a switch to pause or resume, and the
 * agenda of the coming three months. Booking runs by itself; 'Nu boeken'
 * shows only while something is due.
 */
@Component({
  selector: 'app-recurring-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: FINANCE_SECTION, useExisting: forwardRef(() => RecurringPanel) }],
  imports: [Icon, EurPipe, MenuTrigger, SwipeActions],
  template: `
    @if (state.dueNow().length) {
      @if (state.desk()) {
        <div class="wk-banner wk-banner--warn wk-banner--inset" role="status"><app-icon name="repeat" [size]="18" />
          <span class="wk-banner__text">{{ dueText() }}</span>
          <span class="wk-banner__actions"><button class="wk-btn wk-btn--sm" type="button" [disabled]="state.booking()" (click)="state.bookNow()">{{ state.booking() ? 'Bezig…' : 'Nu boeken' }}</button></span></div>
      } @else {
        <div class="ios-banner"><span>{{ dueText() }}</span><button class="ios-capsule ios-capsule--sm ios-capsule--accent" type="button" [disabled]="state.booking()" (click)="state.bookNow()">Boek nu</button></div>
      }
    }
    @if (state.desk()) {
      <div class="fin-recurring" [class.fin-recurring--agenda]="!state.inspect() && agenda().length > 0">
        <div class="fin-recurring__main">
          @if (state.recurring().length) {
            <div class="wk-table fin-table fin-table--recurring" role="grid" aria-label="Vaste kosten">
              <div class="wk-thead" role="row">
                <span class="wk-th" role="columnheader">Naam</span>
                <span class="wk-th fin-rec-lg" role="columnheader">Categorie</span>
                <span class="wk-th fin-rec-sm" role="columnheader">Ritme</span>
                <span class="wk-th" role="columnheader">Volgende</span>
                <span class="wk-th wk-th--num" role="columnheader">Per keer incl.</span>
                <span class="wk-th wk-th--num fin-rec-md" role="columnheader">Per maand incl.</span>
                <span class="wk-th fin-rec-lg" role="columnheader">Domiciliëring</span>
                <span class="wk-th" role="columnheader">Actief</span>
              </div>
              @for (group of groups(); track group.id) {
                <div class="wk-group" role="row">
                  <span class="wk-group__label">
                    <button class="wk-group__toggle" type="button" [attr.aria-expanded]="isOpen(group.id)" [attr.aria-label]="group.label + ' tonen of verbergen'" (click)="toggleGroup(group.id)"><app-icon name="chevron-down" [size]="14" /></button>
                    {{ group.label }} <span class="wk-group__count">({{ group.rows.length }})</span></span>
                </div>
                @if (isOpen(group.id)) {
                  @for (definition of group.rows; track definition.id) {
                    <div class="wk-tr wk-tr--link" role="row" [attr.tabindex]="table.stop() === 'recurring:' + definition.id ? 0 : -1" [attr.data-key]="'recurring:' + definition.id"
                         [attr.aria-selected]="table.isSelected('recurring:' + definition.id)" [class.wk-tr--muted]="group.id !== 'active'"
                         (focus)="table.focused('recurring:' + definition.id)" (click)="table.click('recurring:' + definition.id, $event)" (dblclick)="state.openRecurring(definition)"
                         appMenuTrigger (menuTrigger)="state.recurringMenu(definition, $event)">
                      <span class="wk-td" role="gridcell"><b>{{ definition.name }}</b>@if (definition.party) { <span class="wk-td__sub">{{ definition.party }}</span> }</span>
                      <span class="wk-td fin-rec-lg" role="gridcell"><span [class]="'wk-dot tone-' + tone(definition.category)"></span> {{ category(definition.category) }}</span>
                      <span class="wk-td fin-rec-sm" role="gridcell">{{ rhythm(definition.interval) }}</span>
                      <span class="wk-td" role="gridcell">{{ nextLabel(definition, group.id) }}</span>
                      <span class="wk-td wk-td--num" role="gridcell">{{ incl(definition) | eur }}</span>
                      <span class="wk-td wk-td--num fin-rec-md" role="gridcell">{{ monthlyIncl(definition) | eur }}</span>
                      <span class="wk-td fin-rec-lg" role="gridcell">@if (definition.autoPaid) { <app-icon name="tick" [size]="16" title="Domiciliëring: gaat vanzelf" /> }</span>
                      <span class="wk-td" role="gridcell">
                        @if (group.id !== 'ended') {
                          <input class="fin-switch" type="checkbox" role="switch" [checked]="definition.active" [disabled]="state.saving()"
                                 [attr.aria-label]="(definition.active ? 'Pauzeer ' : 'Hervat ') + definition.name"
                                 (click)="$event.stopPropagation()" (change)="flip(definition, $event)" />
                        }
                      </span>
                    </div>
                  }
                }
              }
            </div>
          } @else {
            <div class="wk-empty"><span class="wk-empty__icon"><app-icon name="repeat" [size]="22" /></span><p class="wk-empty__title">Nog geen vaste kosten</p>
              <p class="wk-empty__text">Huur, de boekhouder, software, verzekering: stel ze één keer in, de boekingen volgen vanzelf.</p>
              <div class="wk-empty__actions"><button class="wk-btn wk-btn--primary" type="button" (click)="state.openRecurring(null)">Vaste kost instellen</button></div></div>
            @if (candidates().length) {
              <!-- Costs booked by hand that come back: set one up from its rhythm, starting at the next expected booking (critique B12). -->
              <section class="wk-card fin-candidates" aria-labelledby="fin-candidates-title">
                <header class="wk-card__head"><h2 class="wk-card__title" id="fin-candidates-title">Lijkt te herhalen</h2></header>
                @for (candidate of candidates(); track candidate.party) {
                  <div class="fin-candidate"><span><b>{{ candidate.party }}</b><small>{{ candidateText(candidate) }}</small></span>
                    <button class="wk-btn wk-btn--sm" type="button" (click)="setUp(candidate)">Instellen…</button></div>
                }
              </section>
            }
          }
        </div>
        @if (agenda().length) {
          <aside class="wk-card fin-agenda" aria-label="Komende 3 maanden">
            <header class="wk-card__head"><h2 class="wk-card__title">Komende 3 maanden</h2><span class="wk-card__trail">{{ agendaTotal() | eur }}</span></header>
            <div class="wk-card__body">
              @for (month of agenda(); track month.key) {
                <h3 class="wk-section__title">{{ month.label }}</h3>
                @for (row of month.rows; track row.date + '/' + row.definition.id) {
                  <div class="fin-pay-line"><span>{{ day(row.date) }}</span><span>{{ row.definition.name }}</span><b>{{ row.amountInclEur | eur }}</b></div>
                }
              }
            </div>
          </aside>
        }
      </div>
    } @else {
      <!-- as on the desk: without any definition the zeros say nothing; the empty state and "Lijkt te herhalen" take their place (N5) -->
      @if (strip()) {
        <div class="ios-figures ios-figures--3">
          <div><small>Per maand</small><strong>{{ monthlyInclTotal() | eur: 0 }}</strong></div>
          <div><small>Per jaar</small><strong>{{ summary().yearlyInclEur | eur: 0 }}</strong></div>
          <div><small>Volgende</small><strong>{{ next() ? day(next()!.date) : '—' }}</strong></div>
        </div>
      }
      @for (group of groups(); track group.id) {
        <section class="ios-section">
          <div class="ios-section__head"><h2>{{ group.label }}</h2><span class="ios-section__trail">{{ group.rows.length }}</span></div>
          <div class="ios-group ios-group--icons">
            @for (definition of group.rows; track definition.id) {
              <div class="ios-swipe" appSwipeActions #sw="swipeActions" [swipeEnd]="group.id === 'ended' ? 0 : 1" swipeFull="none">
                <div class="ios-swipe__actions ios-swipe__actions--end">
                  <button class="ios-swipe__btn tone-amber" type="button" (click)="state.setRecurringActive(definition, !definition.active); sw.close()">
                    <app-icon [name]="definition.active ? 'recent' : 'repeat'" [size]="20" />{{ definition.active ? 'Pauzeer' : 'Hervat' }}</button>
                </div>
                <div class="ios-swipe__row">
                  <div class="ios-cell ios-cell--tall">
                    <span class="ios-cell__lead"><span [class]="'ios-tile ios-tile--lg ios-tile--soft tone-' + tone(definition.category)"><app-icon name="repeat" [size]="18" /></span></span>
                    <button class="fin-cell-button" type="button" appMenuTrigger (menuTrigger)="state.recurringMenu(definition, null)" (click)="state.inspectItem({ kind: 'recurring', id: definition.id! })">
                      <span class="ios-cell__body"><span class="ios-cell__title">{{ definition.name }}</span><span class="ios-cell__sub">{{ rhythm(definition.interval) }} · {{ nextLabel(definition, group.id) }}</span></span>
                      <span class="ios-cell__trail"><span class="ios-cell__value ios-cell__value--strong">{{ incl(definition) | eur }}</span></span>
                    </button>
                    @if (group.id !== 'ended') {
                      <input class="ios-switch" type="checkbox" role="switch" [checked]="definition.active" [disabled]="state.saving()"
                             [attr.aria-label]="(definition.active ? 'Pauzeer ' : 'Hervat ') + definition.name" (change)="flip(definition, $event)" />
                    }
                  </div>
                </div>
              </div>
            }
          </div>
        </section>
      } @empty {
        <div class="ios-empty"><span class="ios-empty__icon"><app-icon name="repeat" [size]="26" /></span><p class="ios-empty__title">Nog geen vaste kosten</p>
          <p class="ios-empty__text">Stel ze één keer in, de boekingen volgen vanzelf.</p>
          <button class="ios-capsule ios-capsule--tinted" type="button" (click)="state.openRecurring(null)">Vaste kost instellen</button></div>
        @if (candidates().length) {
          <section class="ios-section">
            <div class="ios-section__head"><h2>Lijkt te herhalen</h2></div>
            <div class="ios-group">
              @for (candidate of candidates(); track candidate.party) {
                <button class="ios-cell ios-cell--tall" type="button" (click)="setUp(candidate)">
                  <span class="ios-cell__body"><span class="ios-cell__title fin-wrapall">{{ candidate.party }}</span><span class="ios-cell__sub fin-wrapall">{{ candidateText(candidate) }}</span></span>
                  <span class="ios-cell__trail"><span class="ios-cell__value">Instellen…</span></span>
                </button>
              }
            </div>
          </section>
        }
      }
      @if (agenda().length) {
        <section class="ios-section">
          <details class="ios-group ios-disclosure">
            <summary>Komende 3 maanden <span class="ios-cell__meta">{{ agendaTotal() | eur }}</span><app-icon class="ios-cell__chev" name="chevron-right" [size]="16" /></summary>
            @for (row of agendaRows(); track row.date + '/' + row.definition.id) {
              <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">{{ row.definition.name }}</span><span class="ios-cell__sub">{{ day(row.date) }}</span></span>
                <span class="ios-cell__trail"><span class="ios-cell__value">{{ row.amountInclEur | eur }}</span></span></div>
            }
          </details>
        </section>
      }
    }
  `,
})
export class RecurringPanel implements FinanceSectionApi {
  readonly state = inject(FinanceState);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  /** Afgelopen starts folded. */
  readonly closed = signal<ReadonlySet<GroupId>>(new Set(['ended']));

  readonly summary = computed(() => recurringSummary(this.state.recurring()));
  readonly monthlyInclTotal = computed(() => Math.round(this.summary().yearlyInclEur / 12 * 100) / 100);
  readonly groups = computed(() => {
    const sort = (rows: RecurringCost[]) => [...rows].sort((a, b) => (a.nextDate ?? '9999').localeCompare(b.nextDate ?? '9999') || a.name.localeCompare(b.name, 'nl'));
    const grouped = recurringGroups(this.state.recurring(), this.state.today());
    return ([
      { id: 'active', label: 'Actief', rows: sort(grouped.active) },
      { id: 'paused', label: 'Gepauzeerd', rows: sort(grouped.paused) },
      { id: 'ended', label: 'Afgelopen', rows: sort(grouped.ended) },
    ] as { id: GroupId; label: string; rows: RecurringCost[] }[]).filter((group) => group.rows.length);
  });
  readonly agendaRows = computed(() => upcomingRecurring(this.state.recurring(), this.state.today(), addDays(this.state.today(), 91)));
  readonly agendaTotal = computed(() => Math.round(this.agendaRows().reduce((sum, row) => sum + row.amountInclEur * 100, 0)) / 100);
  readonly agenda = computed(() => {
    const months = new Map<string, UpcomingCost[]>();
    for (const row of this.agendaRows()) months.set(row.date.slice(0, 7), [...(months.get(row.date.slice(0, 7)) ?? []), row]);
    return [...months.entries()].map(([key, rows]) => ({ key, label: monthLabel(key), rows }));
  });
  readonly next = computed(() => this.agendaRows()[0] ?? null);
  readonly dueText = computed(() => {
    const n = this.state.dueNow().length;
    return `${n} vaste ${n === 1 ? 'kost staat' : 'kosten staan'} klaar om te boeken`;
  });

  readonly table = new FinanceTable({
    order: () => this.groups().filter((group) => this.isOpen(group.id)).flatMap((group) => group.rows.map((row) => `recurring:${row.id}`)),
    host: () => this.host.nativeElement,
    inspect: (key) => this.state.inspectItem({ kind: 'recurring', id: Number(key.split(':')[1]) }),
  });

  /** Without any definition the strip's zeros say nothing: the empty state and "Lijkt te herhalen" take its place (N5). */
  readonly strip = computed<StripItem[] | null>(() => {
    if (!this.state.recurring().length) return null;
    const next = this.next();
    return [
      { label: 'Per maand', value: `${formatEuro(this.monthlyInclTotal())} incl. (${formatEuro(this.summary().monthlyExclEur)} excl.)`, tone: 'strong' },
      { label: 'Per jaar', value: `${formatEuro(this.summary().yearlyInclEur)} incl.` },
      { label: 'Volgende', value: next ? `${next.definition.name} op ${dayMonth(next.date)}` : '—', tone: 'muted' },
    ];
  });
  /** "Lijkt te herhalen": hand-booked costs to one party that come back (recurring-candidates.ts). */
  readonly candidates = computed(() => this.state.recurring().length ? [] : recurringCandidates(this.state.costs(),
    this.state.recurring().map((definition) => definition.party ?? definition.name), this.state.today()));
  /** "6 boekingen sinds mrt · laatst € 363,00 · maandelijks" ("sinds okt 2025" for a start in another year). */
  candidateText(candidate: RecurringCandidate): string {
    return `${candidate.count} boekingen sinds ${monthShort(candidate.since, this.state.today())} · laatst ${formatEuro(cashTotalOf(candidate.last))} · ${intervalLabel(candidate.interval).toLowerCase()}`;
  }
  /**
   * The recurring sheet, prefilled from the newest booking (amount excl. and VAT rate as stored) and starting at the
   * next expected day; nothing is saved before Opslaan. A regime that booking only derived stays unconfirmed, so the
   * sheet opens its regime section: every booking the definition makes carries that flag into the VAT return (N5).
   */
  setUp(candidate: RecurringCandidate): void {
    const last = candidate.last;
    this.state.recurringDraft.set({ ...blankRecurring(this.state.today()), name: candidate.party, party: candidate.party, category: last.category,
      amountExclEur: last.amountExclEur, vatPct: last.vatPct, salesChannel: last.salesChannel, interval: candidate.interval, startDate: candidate.nextDate,
      vatRegime: last.vatRegime ?? 'BE', vatRegimeConfirmed: !!last.vatRegime && last.vatRegimeConfirmed === true, supplierCountry: last.supplierCountry ?? 'BE', costKind: last.costKind,
      expenseType: last.expenseType ?? 'STANDARD', vatDeductiblePct: last.vatDeductiblePct ?? 100, taxDeductiblePct: last.taxDeductiblePct ?? 100 });
  }
  readonly status = computed(() => `${this.state.recurring().length} vaste ${this.state.recurring().length === 1 ? 'kost' : 'kosten'}`);

  handle(command: FinanceCommand): boolean {
    if (this.table.handle(command)) return true;
    const focus = this.table.selection().focus;
    const definition = focus ? this.state.recurring().find((row) => `recurring:${row.id}` === focus) : null;
    if (!definition) return false;
    if (command === 'open') { this.state.inspectItem({ kind: 'recurring', id: definition.id! }); return true; }
    if (command === 'edit') { this.state.openRecurring(definition); return true; }
    if (command === 'delete') { this.state.deleteRecurring(definition); return true; }
    return false;
  }

  isOpen(id: GroupId): boolean { return !this.closed().has(id); }
  toggleGroup(id: GroupId): void {
    this.closed.update((set) => { const next = new Set(set); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  /** The switch asks the state; a resume with a backlog confirms first, so the box follows the data, not the click. */
  flip(definition: RecurringCost, event: Event): void {
    const input = event.target as HTMLInputElement;
    input.checked = definition.active;
    this.state.setRecurringActive(definition, !definition.active);
  }

  nextLabel(definition: RecurringCost, group: GroupId): string {
    if (group === 'ended') return definition.lastBookedOn ? `Afgelopen op ${dayMonthYear(definition.lastBookedOn)}` : 'Afgelopen';
    if (group === 'paused') return 'Gepauzeerd';
    return definition.nextDate ? dayMonth(definition.nextDate) : '—';
  }

  incl(definition: RecurringCost): number { return cashTotalOf(definition); }
  monthlyIncl(definition: RecurringCost): number { return Math.round(cashTotalOf(definition) * perYear(definition.interval) / 12 * 100) / 100; }
  rhythm(code: string): string { return intervalLabel(code); }
  category(code: string): string { return categoryLabel(code); }
  tone(code: string): string { return categoryTone(code); }
  day(date: string): string { return dayMonth(date); }
}
