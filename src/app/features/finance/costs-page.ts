import { ChangeDetectionStrategy, Component, computed, inject, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { Icon } from '../../shared/icon';
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
import { containerFilterId } from './cost-ledger';

/**
 * Kosten & bank: its own workspace, the way Documenten & media is one. On a
 * desktop the sections sit in the dark navigation on the left; on a phone
 * they are a pill under the header. The address bar carries the section.
 */
@Component({
  selector: 'app-costs-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [FinanceState],
  host: { id: 'finance-workspace' },
  imports: [RouterLink, PageHeader, Icon, FinanceOverview, CostList, RecurringPanel, BankPanel, CostAnalysis, CostSheet, RecurringSheet, BankSheet],
  template: `
    @if (phone()) {
      <app-page-header [showBack]="true" backTo="/more" title="Kosten & bank" [subtitle]="section().hint" />
      <nav class="finance-nav" aria-label="Onderdelen van Kosten en bank">
        @for (item of sections; track item.id) {
          <button type="button" [class.active]="view() === item.id" [attr.aria-current]="view() === item.id ? 'page' : null" (click)="go(item.id)">
            <app-icon [name]="item.icon" [size]="18" /><span>{{ item.short }}</span>
          </button>
        }
      </nav>
    } @else {
      <header class="fin-head">
        <div class="fin-head__copy"><span class="section-kicker">Kosten &amp; bank</span><h1>{{ section().label }}</h1><p>{{ section().hint }}</p></div>
        <div class="fin-head__actions">
          @if (view() === 'bank') {
            <button class="btn btn--sm" type="button" (click)="state.openBank(null)">Banksaldo invullen</button>
          }
          <button class="btn btn--primary btn--sm" type="button" (click)="fab()">{{ fabLabel() }}</button>
        </div>
      </header>
    }

    <div class="content fin" [class.fin--phone]="phone()">
      <div class="finance-sync" aria-live="polite">
        <span>{{ state.loading() ? 'Gegevens ophalen…' : state.loadErrors().length ? 'Een deel van de gegevens ontbreekt' : 'Administratie bijgewerkt' }}@if (state.loadedAt(); as loaded) { · {{ updatedTime(loaded) }} }</span>
        <button type="button" class="linklike" [disabled]="state.loading()" (click)="state.load()">Vernieuwen</button>
      </div>
      @if (state.loadErrors().length) {
        <div class="finance-alert" role="alert"><b>De bedragen zijn mogelijk onvolledig</b><p>Niet geladen: {{ state.loadErrors().join(', ') }}. Eerder geladen gegevens blijven zichtbaar.</p><button type="button" class="btn btn--sm" [disabled]="state.loading()" (click)="state.load()">Opnieuw proberen</button></div>
      }
      @if (containerId()) {
        <p class="fin-note">Betalingen van {{ containerLabel() }} · alle datums
          <a class="linklike" [routerLink]="['/purchasing', containerId()]">Container bekijken ›</a>
          <button class="linklike" type="button" (click)="clearContainer()">Alle kosten tonen</button>
        </p>
      }
      @if (state.loading() && !state.loadedAt()) {
        <div class="card finance-loading" role="status">Je kosten, betalingen en rekeningen worden opgehaald…</div>
      } @else { @switch (view()) {
        @case ('costs') { <app-cost-list mode="all" [containerId]="containerId()" /> }
        @case ('open') { <app-cost-list mode="open" [containerId]="containerId()" /> }
        @case ('recurring') { <app-recurring-panel /> }
        @case ('bank') { <app-bank-panel /> }
        @case ('analysis') { <app-cost-analysis /> }
        @default { <app-finance-overview (navigate)="go($event)" /> }
      } }
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
  private readonly params = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
  readonly containerId = computed(() => containerFilterId(this.params().get('container')));
  readonly containerLabel = computed(() => this.state.payments().find((payment) => payment.orderId === this.containerId())?.orderNumber ?? `container #${this.containerId()}`);
  readonly view = computed(() => this.containerId() ? 'costs' : financeView(this.params().get('view')));
  readonly section = computed(() => financeSection(this.view()));
  readonly fabLabel = computed(() => (this.view() === 'recurring' ? '+ Vaste kost' : this.view() === 'bank' ? '+ Bankbeweging' : '+ Kost'));

  readonly bankPanel = viewChild(BankPanel);
  updatedTime(date: Date): string { return date.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' }); }

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

  clearContainer(): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: { view: 'costs' }, replaceUrl: true });
  }

  fab(): void {
    if (this.view() === 'recurring') this.state.openRecurring(null);
    else if (this.view() === 'bank') this.bankPanel()?.addMovement();
    else this.state.openCost(null);
  }
}
