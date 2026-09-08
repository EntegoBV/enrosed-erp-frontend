import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { DateNlPipe, EurPipe } from '../../shared/pipes';
import { categoryLabel } from './cost-categories';
import { addDays, inclOf, intervalLabel, monthlyEquivalentEur, recurringSummary, upcomingRecurring } from './finance-metrics';
import { TODAY } from './finance-sections';
import { FinanceState } from './finance-state';

/** The recurring costs: what is set up, what it weighs per month, and the agenda ahead. */
@Component({
  selector: 'app-recurring-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EurPipe, DateNlPipe],
  template: `
    <section class="fin-kpis fin-kpis--4" aria-label="Vaste kosten samengevat">
      <article class="card fin-kpi fin-kpi--dark"><small>Per maand</small><strong>{{ summary().monthlyExclEur | eur: 0 }}</strong><span>{{ summary().activeCount }} actieve vaste {{ summary().activeCount === 1 ? 'kost' : 'kosten' }}, excl. btw</span></article>
      <article class="card fin-kpi"><small>Per jaar</small><strong>{{ summary().yearlyExclEur | eur: 0 }}</strong><span>{{ summary().yearlyInclEur | eur: 0 }} incl. btw</span></article>
      <article class="card fin-kpi"><small>Volgende boeking</small><strong>{{ next() ? (next()!.date | dateNl) : '—' }}</strong><span>{{ next()?.definition?.name ?? 'niets gepland' }}</span></article>
      <article class="card fin-kpi"><small>Komende 90 dagen</small><strong>{{ ninetyEur() | eur: 0 }}</strong><span>{{ ninety().length }} {{ ninety().length === 1 ? 'boeking' : 'boekingen' }}, incl. btw</span></article>
    </section>

    <section class="card fin-panel">
      <header class="fin-panel__head">
        <div><span class="section-kicker">Ingesteld</span><h2>Vaste kosten</h2></div>
        <div class="fin-panel__actions">
          <button class="btn btn--sm" type="button" [disabled]="state.booking()" (click)="state.bookNow()" title="Boek wat vandaag of eerder verviel, zonder op het uur te wachten">{{ state.booking() ? 'Bezig…' : 'Nu boeken' }}</button>
          <button class="btn btn--primary btn--sm hide-mobile" type="button" (click)="state.openRecurring(null)">+ Vaste kost</button>
        </div>
      </header>
      <p class="fin-panel__hint">De server boekt elke vaste kost vanzelf op haar dag en kijkt daar elk uur naar om. Een domiciliëring staat meteen op betaald; de rest komt bij Openstaand.</p>
      @if (state.dueNow().length) {
        <p class="fin-note fin-note--warn">{{ state.dueNow().length }} vaste {{ state.dueNow().length === 1 ? 'kost staat' : 'kosten staan' }} klaar om te boeken.</p>
      }
      @if (!state.recurring().length) {
        <p class="fin-empty">Nog geen vaste kosten. Denk aan huur, de boekhouder, software, verzekering, telefonie: stel ze één keer in en ze komen elke periode vanzelf in de boeken.</p>
      } @else {
        <div class="fin-list">
          @for (definition of state.recurring(); track definition.id) {
            <button class="fin-def" type="button" [class.fin-def--paused]="!definition.active" (click)="state.openRecurring(definition)">
              <span class="fin-def__rhythm">{{ intervalLabel(definition.interval) }}</span>
              <span class="fin-def__body">
                <b>{{ definition.name }}</b>
                <small>{{ categoryLabel(definition.category) }}{{ definition.party ? ' · ' + definition.party : '' }}{{ definition.autoPaid ? ' · domiciliëring' : '' }}{{ definition.endDate ? ' · tot ' + (definition.endDate | dateNl) : '' }}</small>
              </span>
              <span class="fin-def__next">
                @if (definition.active && definition.nextDate) { <small>volgende</small><b>{{ definition.nextDate | dateNl }}</b> }
                @else { <em>{{ !definition.nextDate && definition.lastBookedOn ? 'afgelopen' : 'gepauzeerd' }}</em> }
              </span>
              <span class="fin-def__amount"><b>{{ definition.amountExclEur | eur }}</b><small>{{ inclOf(definition) | eur }} incl. · {{ monthlyEquivalentEur(definition) | eur: 0 }}/maand</small></span>
            </button>
          }
        </div>
      }
    </section>

    @if (ninety().length) {
      <section class="card fin-panel">
        <header class="fin-panel__head"><div><span class="section-kicker">Agenda</span><h2>Komende 90 dagen</h2></div><strong class="fin-panel__total">{{ ninetyEur() | eur }}</strong></header>
        <ul class="fin-agenda">
          @for (row of ninety(); track row.date + '/' + row.definition.id) {
            <li>
              <span class="fin-agenda__date">{{ row.date | dateNl }}</span>
              <span class="fin-agenda__body"><b>{{ row.definition.name }}</b><small>{{ categoryLabel(row.definition.category) }}{{ row.definition.party ? ' · ' + row.definition.party : '' }}</small></span>
              <strong>{{ row.amountInclEur | eur }}</strong>
            </li>
          }
        </ul>
      </section>
    }
  `,
})
export class RecurringPanel {
  readonly state = inject(FinanceState);
  readonly intervalLabel = intervalLabel;
  readonly categoryLabel = categoryLabel;
  readonly inclOf = inclOf;
  readonly monthlyEquivalentEur = monthlyEquivalentEur;

  readonly summary = computed(() => recurringSummary(this.state.recurring()));
  readonly ninety = computed(() => upcomingRecurring(this.state.recurring(), TODAY, addDays(TODAY, 90)));
  readonly ninetyEur = computed(() => Math.round(this.ninety().reduce((sum, row) => sum + row.amountInclEur, 0) * 100) / 100);
  readonly next = computed(() => this.ninety()[0] ?? null);
}
