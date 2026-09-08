import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { PageHeader } from '../../shared/page-header';
import { BankPanel } from './bank-panel';
import { BankSheet } from './bank-sheet';
import { CostAnalysis } from './cost-analysis';
import { CostList } from './cost-list';
import { CostSheet } from './cost-sheet';
import { FinanceOverview } from './finance-overview';
import { FINANCE_SECTIONS, FinanceView, financeSection, financeView } from './finance-sections';
import { FinanceState } from './finance-state';
import { RecurringPanel } from './recurring-panel';
import { RecurringSheet } from './recurring-sheet';

/**
 * Kosten & bank: its own workspace, the way Documenten & media is one. On a
 * desktop the sections sit in the dark navigation on the left; on a phone
 * they are a pill under the header. The address bar carries the section.
 */
@Component({
  selector: 'app-costs-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [FinanceState],
  imports: [PageHeader, FinanceOverview, CostList, RecurringPanel, BankPanel, CostAnalysis, CostSheet, RecurringSheet, BankSheet],
  template: `
    @if (phone()) {
      <app-page-header [showBack]="true" backTo="/more" title="Kosten & bank" [subtitle]="section().hint" />
      <nav class="workflow-nav workflow-nav--wide fin-nav" aria-label="Onderdelen van Kosten en bank">
        @for (item of sections; track item.id; let index = $index) {
          <button type="button" class="workflow-nav__item" [class.workflow-nav__active]="view() === item.id" (click)="go(item.id)">
            <span class="workflow-nav__mark">{{ index + 1 }}</span>
            <span class="workflow-nav__copy"><b>{{ item.short }}</b></span>
          </button>
        }
      </nav>
    } @else {
      <header class="fin-head">
        <div class="fin-head__copy"><span class="section-kicker">Kosten &amp; bank</span><h1>{{ section().label }}</h1><p>{{ section().hint }}</p></div>
        <div class="fin-head__actions">
          <button class="btn btn--sm" type="button" (click)="state.openBank(null)">+ Banksaldo</button>
          <button class="btn btn--sm" type="button" (click)="state.openRecurring(null)">+ Vaste kost</button>
          <button class="btn btn--primary btn--sm" type="button" (click)="state.openCost(null)">+ Kost</button>
        </div>
      </header>
    }

    <div class="content fin" [class.fin--phone]="phone()">
      @switch (view()) {
        @case ('costs') { <app-cost-list mode="all" /> }
        @case ('open') { <app-cost-list mode="open" /> }
        @case ('recurring') { <app-recurring-panel /> }
        @case ('bank') { <app-bank-panel /> }
        @case ('analysis') { <app-cost-analysis /> }
        @default { <app-finance-overview (navigate)="go($event)" /> }
      }
    </div>

    @if (phone()) {
      <button class="fab" type="button" (click)="fab()">{{ fabLabel() }}</button>
    }
    @if (state.costDraft()) { <app-cost-sheet /> }
    @if (state.recurringDraft()) { <app-recurring-sheet /> }
    @if (state.bankDraft()) { <app-bank-sheet /> }
  `,
})
export class CostsPage {
  readonly state = inject(FinanceState);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly desktop = inject(DesktopViewport);
  readonly sections = FINANCE_SECTIONS;

  readonly phone = computed(() => !this.desktop.active());
  readonly view = toSignal(this.route.queryParamMap.pipe(map((params) => financeView(params.get('view')))), { initialValue: financeView(this.route.snapshot.queryParamMap.get('view')) });
  readonly section = computed(() => financeSection(this.view()));
  readonly fabLabel = computed(() => (this.view() === 'recurring' ? '+ Vaste kost' : this.view() === 'bank' ? '+ Saldo' : '+ Kost'));

  constructor() {
    void this.state.load();
  }

  go(view: FinanceView): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: view === 'overview' ? {} : { view },
      replaceUrl: !this.phone(),
    });
  }

  fab(): void {
    if (this.view() === 'recurring') this.state.openRecurring(null);
    else if (this.view() === 'bank') this.state.openBank(null);
    else this.state.openCost(null);
  }
}
