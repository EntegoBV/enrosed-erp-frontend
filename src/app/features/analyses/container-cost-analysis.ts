import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type { PurchaseOrderView } from '../../core/api/models';
import { EurPipe, NumPipe } from '../../shared/pipes';
import { PurchaseReconciliation } from '../purchasing/purchase-reconciliation';
import { ContainerCostFilter, containerCostRows, containerCostTotals } from '../purchasing/purchase-reconciliation-metrics';
import { mixRange, nacalcUnitMix, purchasePaymentResult, reconciliationUnit, type NacalcUnitMix, type ReconciliationUnit } from '../purchasing/purchase-payment-result-metrics';
import { containerPaymentResultTotals } from './container-payment-result-metrics';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { Icon } from '../../shared/icon';
import { Sheet } from '../../shared/ui';
import { containerName } from '../purchasing/container-name';
import { plural } from './analyses-words';

/**
 * Analyses › Inkoop › Containerkost (redesign 2026-10-17): its own filter row
 * (row 2 of the Inkoop bar), four light figures, the payment result and the
 * difference with the afspraak side by side, then the table per container.
 * The phone shows the containers as cells; each opens a sheet with every
 * figure of its row and the Afrekening & PDF (critique B1). Styles live in
 * src/styles/analyses-tabs.scss under app-container-cost-analysis (N4).
 * Payment reconciliation remains independent of the receipt-quality period.
 */
@Component({
  selector: 'app-container-cost-analysis',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Icon, NgTemplateOutlet, RouterLink, EurPipe, NumPipe, PurchaseReconciliation, Sheet],
  host: { class: 'an-part cc' },
  template: `
    <!-- Row 2 of the Inkoop tool bar: this part's own filters (critique B10, N10). -->
    <div class="an-bar an-bar--sub">
      @if (desk.active()) {
        <label class="an-field"><span class="sr-only">Containers</span>
          <select class="an-select" [ngModel]="filter()" (ngModelChange)="filter.set($event)" aria-label="Containers">
            @for (option of filters; track option.id) { <option [value]="option.id">{{ option.label }}</option> }
          </select></label>
        <label class="wk-search an-search"><app-icon name="search" [size]="15" />
          <input type="search" placeholder="Zoek container" aria-label="Zoek container" [ngModel]="search()" (ngModelChange)="search.set($event)" /></label>
      } @else {
        <select class="an-capsule-select" [ngModel]="filter()" (ngModelChange)="filter.set($event)" aria-label="Containers">
          @for (option of filters; track option.id) { <option [value]="option.id">{{ option.label }}</option> }
        </select>
      }
    </div>
    @if (!desk.active()) {
      <div class="ios-search an-phone-search"><label class="ios-search__field"><app-icon name="search" [size]="16" />
        <input type="search" placeholder="Zoek container" aria-label="Zoek container" [ngModel]="search()" (ngModelChange)="search.set($event)" /></label></div>
    }
    @if (loading()) {
      <div class="an-kpis" aria-label="Containerkost laden">@for (n of [1, 2, 3, 4]; track n) { <div class="an-kpi an-kpi--loading"><span></span><span></span><span></span></div> }</div>
    } @else {
      @if (unavailable()) {
        <div [class]="desk.active() ? 'wk-banner wk-banner--warn wk-banner--inset' : 'ios-banner'" role="status"><span class="wk-banner__text">Voor {{ plural(unavailable(), 'container', 'containers') }} ontbreekt de nacalculatie. Die bedragen zijn niet opgenomen; vernieuw om ze opnieuw op te halen.</span></div>
      }
      @if (rows().length) {
        @let total = totals();
        @let payment = paymentTotals();
        <div class="an-kpis an-kpis--cents">
          <div class="an-kpi"><span class="an-kpi__label">Afgesproken externe kost</span><span class="an-kpi__value">{{ total.plannedEur | eur }}</span>
            <span class="an-kpi__sub">{{ plural(rows().length, 'container', 'containers') }} in dit overzicht</span><span class="an-kpi__foot"></span></div>
          <div class="an-kpi"><span class="an-kpi__label">Werkelijk betaald</span><span class="an-kpi__value">{{ total.paidEur | eur }}</span>
            <span class="an-kpi__sub">opgeslagen eurobedragen van betalingen</span><span class="an-kpi__foot"></span></div>
          <div class="an-kpi"><span class="an-kpi__label">Nog te betalen</span><span class="an-kpi__value">{{ total.remainingEur | eur }}</span>
            <span class="an-kpi__sub">{{ plural(total.provisionalCount, 'container', 'containers') }} nog voorlopig</span><span class="an-kpi__foot"></span></div>
          <div class="an-kpi"><span class="an-kpi__label">{{ total.provisionalCount ? 'Verwachte externe kost' : 'Definitieve externe kost' }}</span><span class="an-kpi__value">{{ total.forecastEur | eur }}</span>
            <span class="an-kpi__sub">{{ plural(total.finalizedCount, 'container', 'containers') }} volledig afgerekend</span><span class="an-kpi__foot"></span></div>
        </div>
        <div class="an-cols">
          <div class="an-col">
            <section class="an-card cc-pay" aria-labelledby="cc-pay-title">
              <header class="an-card__head"><h2 class="an-card__title" id="cc-pay-title">Extra opbrengst uit betalingen</h2><span class="an-card__sub">apart van de ENROSED-kost</span>
                @if (payment.eligibleCount) { <span class="an-card__trail"><span class="wk-pill" [class.tone-warn]="payment.provisionalCount" [class.tone-ok]="!payment.provisionalCount">{{ payment.provisionalCount ? 'Tussenstand' : 'Afgerekend' }}</span></span> }</header>
              <div class="an-card__body an-card__pad">
                @if (payment.eligibleCount) {
                  <div class="cc-pay__amount">
                    <span>{{ payment.netResultEur < 0 ? 'Negatief betaalresultaat' : 'Netto extra opbrengst' }}</span>
                    <strong [class.is-warn]="payment.netResultEur < 0">{{ payment.netResultEur | eur: 2 }}</strong>
                    <small>{{ plural(payment.eligibleCount, 'container', 'containers') }} in deze selectie · {{ payment.finalizedCount | num }} volledig afgerekend</small>
                  </div>
                  <dl class="cc-pay__list">
                    <div><dt>ENROSED-kost</dt><dd>{{ payment.internalMarkupEur | eur: 2 }}</dd></div>
                    <div><dt>Betaalresultaat</dt><dd>{{ payment.netResultEur > 0 ? '+' : '' }}{{ payment.netResultEur | eur: 2 }}</dd></div>
                    <div class="is-total"><dt>ENROSED-kost + betaalresultaat</dt><dd>{{ payment.markupWithResultEur | eur: 2 }}</dd></div>
                  </dl>
                  @if (payment.unsettledOverrunsEur > 0) {
                    <p class="cc-pay__pending" role="note"><b>{{ payment.unsettledOverrunsEur | eur: 2 }} meer betaald, nog te beoordelen.</b>
                      Dit bedrag is nog niet verrekend in het betaalresultaat.</p>
                  }
                  <details class="cc-pay__details">
                    <summary>Hoe is dit berekend? <app-icon name="chevron-down" [size]="14" /></summary>
                    <dl class="cc-pay__list">
                      <div><dt>Minder betaald, definitief vereffend</dt><dd>{{ payment.settledSavingsEur | eur: 2 }}</dd></div>
                      <div><dt>Meer betaald, definitief vereffend</dt><dd>− {{ payment.settledOverrunsEur | eur: 2 }}</dd></div>
                      <div><dt>Extra uitgaven buiten de afspraak</dt><dd>− {{ payment.additionalCostsEur | eur: 2 }}</dd></div>
                    </dl>
                    <p>Besparing telt zodra de betreffende betaalgroep of leverancierstermijn is afgerekend. Andere termijnen blijven open; voorschotten en open bedragen zijn geen extra opbrengst.</p>
                    <p>ENROSED-kost en productprijzen blijven gelijk. Kostenverschillen zitten al in de verwachte containerkost; dit overzicht boekt ze niet nogmaals als winst.</p>
                  </details>
                } @else {
                  <p class="cc-pay__note">Nog geen betaalresultaat voor deze selectie.</p>
                }
                @if (payment.excludedCount) { <p class="cc-pay__note">{{ plural(payment.excludedCount, 'conceptcontainer of container', 'conceptcontainers of containers') }} zonder productregels niet meegeteld.</p> }
                @if (payment.unavailableCount) { <p class="cc-pay__note">Voor {{ plural(payment.unavailableCount, 'container', 'containers') }} is het betaalresultaat nog niet beschikbaar.</p> }
              </div>
            </section>
          </div>
          <div class="an-col">
            <section class="an-card" aria-labelledby="cc-diff-title">
              <header class="an-card__head"><h2 class="an-card__title" id="cc-diff-title">Verschil met de afspraak</h2></header>
              <div class="an-card__body">
                <div class="an-row an-row--nolead"><span class="an-row__body"><span class="an-row__title">Meer betaald op afgesproken kosten</span>
                  <span class="an-row__sub">Controleer bij open betaalstromen of er nog een correctie volgt.</span></span><span class="an-row__end"><span class="an-row__value">{{ total.overpaidEur | eur }}</span></span></div>
                <div class="an-row an-row--nolead"><span class="an-row__body"><span class="an-row__title">Minder betaald na vereffening</span>
                  <span class="an-row__sub">Een open saldo of gedeeltelijke betaling is geen besparing.</span></span><span class="an-row__end"><span class="an-row__value">{{ total.settledSavingEur | eur }}</span></span></div>
                <div class="an-row an-row--nolead"><span class="an-row__body"><span class="an-row__title">Extra uitgaven buiten de afspraak</span>
                  <span class="an-row__sub">Bankkosten, koerier en andere betalingen tellen mee in de kost.</span></span><span class="an-row__end"><span class="an-row__value">{{ total.additionalEur | eur }}</span></span></div>
                <div class="an-row an-row--nolead cc-total"><span class="an-row__body"><span class="an-row__title">Netto verschil met de afspraak</span>
                  <span class="an-row__sub">Interne Enrosed opslag staat apart in elke afrekening.</span></span>
                  <span class="an-row__end"><span class="an-row__value" [attr.data-tone]="total.varianceEur > 0 ? 'warn' : total.varianceEur < 0 ? 'ok' : null">{{ total.varianceEur > 0 ? '+' : '' }}{{ total.varianceEur | eur }}</span></span></div>
              </div>
            </section>
          </div>
        </div>
        <section class="an-card" aria-labelledby="cc-table-title">
          <header class="an-card__head"><h2 class="an-card__title" id="cc-table-title">Per container</h2><span class="an-card__trail">{{ plural(rows().length, 'container', 'containers') }}</span></header>
          @if (desk.active()) {
            <div class="cc-table" tabindex="0" role="region" aria-label="Kostenvergelijking per container">
              <table>
                <thead><tr><th>Container</th><th class="cc-col-status">Status</th><th>Afspraak</th><th>Betaald</th><th>Open</th><th>Verwachte kost</th><th>Verschil</th><th>Betaalresultaat</th><th>Per eenheid</th><th><span class="sr-only">Open afrekening</span></th></tr></thead>
                <tbody>
                  @for (row of rows(); track row.view.order.id) {
                    <tr [class.is-on]="expandedId() === row.view.order.id">
                      <td class="cc-name"><a [routerLink]="['/purchasing', row.view.order.id]">{{ name(row) }}</a>@if (row.view.order.alias) { <small>{{ row.view.order.number }}</small> }
                        <small>{{ orderStatus(row.view.order.status) }}<span class="cc-state-inline"> · {{ row.reconciliation.totals.finalized ? 'Afgerekend' : 'Voorlopig' }}</span></small></td>
                      <td class="cc-col-status"><span class="wk-pill" [class.tone-ok]="row.reconciliation.totals.finalized" [class.tone-warn]="!row.reconciliation.totals.finalized">{{ row.reconciliation.totals.finalized ? 'Afgerekend' : 'Voorlopig' }}</span></td>
                      <td>{{ row.reconciliation.totals.plannedExternalEur | eur }}</td>
                      <td>{{ row.reconciliation.totals.paidEur | eur }}</td>
                      <td>{{ row.reconciliation.totals.remainingEur | eur }}</td>
                      <td><b>{{ row.reconciliation.totals.forecastExternalEur | eur }}</b></td>
                      <td [class.is-warn]="row.reconciliation.totals.varianceEur > 0" [class.is-ok]="row.reconciliation.totals.varianceEur < 0">{{ row.reconciliation.totals.varianceEur > 0 ? '+' : '' }}{{ row.reconciliation.totals.varianceEur | eur }}</td>
                      <td>
                        @if (row.paymentResult; as result) {
                          @if (result.eligible) {
                            <b [class.is-warn]="result.netResultEur < 0" [class.is-ok]="result.netResultEur > 0">{{ result.netResultEur | eur: 2 }}</b>
                            <small>{{ result.finalized ? 'Afgerekend' : 'Tussenstand' }}</small>
                          } @else { <span>—</span><small>Niet meegeteld</small> }
                        } @else { <span>—</span><small>Niet beschikbaar</small> }
                      </td>
                      <td class="cc-unit"><ng-container *ngTemplateOutlet="unitCell; context: { $implicit: row }" /></td>
                      <td class="cc-actions"><button class="wk-btn wk-btn--sm" type="button" [attr.aria-expanded]="expandedId() === row.view.order.id" [attr.aria-label]="'Afrekening ' + name(row)" (click)="toggle(row.view.order.id)">{{ expandedId() === row.view.order.id ? 'Sluiten' : 'Afrekening & PDF' }}</button></td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else {
            <div class="an-card__body">
              @for (row of phoneRows(); track row.view.order.id) {
                <button class="an-row an-row--nolead an-row--chev" type="button" data-detail (click)="sheetId.set(row.view.order.id)">
                  <span class="an-row__body"><span class="an-row__title ios-cell__title--2">{{ name(row) }}</span>
                    <span class="an-row__sub">Afspraak {{ row.reconciliation.totals.plannedExternalEur | eur: 0 }} · betaald {{ row.reconciliation.totals.paidEur | eur: 0 }} · open {{ row.reconciliation.totals.remainingEur | eur: 0 }}</span></span>
                  <span class="an-row__end"><span class="an-row__value">{{ row.reconciliation.totals.forecastExternalEur | eur: 0 }}</span>
                    <span class="an-row__meta" [attr.data-tone]="row.reconciliation.totals.varianceEur > 0 ? 'warn' : row.reconciliation.totals.varianceEur < 0 ? 'ok' : null">verschil {{ row.reconciliation.totals.varianceEur | eur: 0 }}</span></span>
                  <span class="an-row__chev" aria-hidden="true">›</span>
                </button>
              }
              @if (rows().length > 5) {
                <button class="an-more" type="button" [attr.aria-expanded]="showAll()" (click)="showAll.set(!showAll())">{{ showAll() ? 'Minder tonen' : 'Alle ' + rows().length + ' tonen' }}</button>
              }
            </div>
          }
        </section>
        @if (desk.active() && expanded(); as row) {
          <section class="an-card cc-detail" aria-labelledby="cc-detail-title">
            <header class="an-card__head"><h2 class="an-card__title" id="cc-detail-title">{{ name(row) }}</h2><span class="an-card__sub">{{ row.view.order.number }} · afrekening &amp; PDF</span>
              <span class="an-card__trail"><button class="wk-btn wk-btn--sm" type="button" (click)="expandedId.set(null)">Sluiten</button></span></header>
            <div class="an-card__body an-card__pad"><app-purchase-reconciliation [data]="row.reconciliation" [orderId]="row.view.order.id" [orderNumber]="row.view.order.number" /></div>
          </section>
        }
      } @else { <p class="an-empty an-empty--card">Geen containers voor deze selectie.</p> }
    }

    <ng-template #unitCell let-row>
      @let mix = unitMix(row.reconciliation);
      @if (mix.uniform) {
        <!-- One product in its own unit: a display product per display with its piece price beside it, never 'per stuk' for a display. -->
        @let unit = unitOf(row.reconciliation.totals);
        @if (unit.unitEur === null) { — } @else { {{ unit.unitEur | eur: 4 }} per {{ unit.unit }} }@if (unit.pieceEur !== null) { <small>{{ unit.pieceEur | eur: 4 }} per stuk</small> }<small>{{ unit.quantity | num }} {{ unit.usable ? 'bruikbare' : 'bestelde' }} {{ unit.plural }}</small>
      } @else {
        <!-- Several products: their range per unit, never an average over them. -->
        {{ range(mix) }}<small>{{ mix.count }} producten · per {{ mix.unit }}</small>
      }
    </ng-template>

    <!-- Phone: every figure of a container in one sheet (critique B1). -->
    @if (sheetRow(); as row) {
      <app-sheet [title]="name(row)" variant="ios" (closed)="sheetId.set(null)">
        <div body class="cc-sheet">
          <div class="ios-group">
            <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Status</span></span>
              <span class="ios-cell__value">{{ orderStatus(row.view.order.status) }} · {{ row.reconciliation.totals.finalized ? 'Afgerekend' : 'Voorlopig' }}</span></div>
            <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Afspraak</span></span><span class="ios-cell__value">{{ row.reconciliation.totals.plannedExternalEur | eur }}</span></div>
            <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Betaald</span></span><span class="ios-cell__value">{{ row.reconciliation.totals.paidEur | eur }}</span></div>
            <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Open</span></span><span class="ios-cell__value">{{ row.reconciliation.totals.remainingEur | eur }}</span></div>
            <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Verwachte kost</span></span><span class="ios-cell__value ios-cell__value--strong">{{ row.reconciliation.totals.forecastExternalEur | eur }}</span></div>
            <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Verschil</span></span>
              <span class="ios-cell__value" [class.is-warn]="row.reconciliation.totals.varianceEur > 0" [class.is-ok]="row.reconciliation.totals.varianceEur < 0">{{ row.reconciliation.totals.varianceEur > 0 ? '+' : '' }}{{ row.reconciliation.totals.varianceEur | eur }}</span></div>
            <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Betaalresultaat</span>
              <span class="ios-cell__sub">@if (row.paymentResult; as result) { {{ result.eligible ? (result.finalized ? 'Afgerekend' : 'Tussenstand') : 'Niet meegeteld' }} } @else { Niet beschikbaar }</span></span>
              <span class="ios-cell__value">@if (row.paymentResult?.eligible) { {{ row.paymentResult!.netResultEur | eur: 2 }} } @else { — }</span></div>
            <div class="ios-cell cc-unit"><span class="ios-cell__body"><span class="ios-cell__title">Per eenheid</span></span>
              <span class="ios-cell__value"><ng-container *ngTemplateOutlet="unitCell; context: { $implicit: row }" /></span></div>
          </div>
          <div class="ios-section cc-sheet__recon">
            <div class="ios-section__head"><h3 class="ios-section__title">Afrekening &amp; PDF</h3></div>
            <app-purchase-reconciliation [data]="row.reconciliation" [orderId]="row.view.order.id" [orderNumber]="row.view.order.number" />
          </div>
          <a class="ios-capsule ios-capsule--accent ios-capsule--block" [routerLink]="['/purchasing', row.view.order.id]" (click)="sheetId.set(null)">Inkooporder openen</a>
        </div>
      </app-sheet>
    }
  `,
})
export class ContainerCostAnalysis {
  readonly desk = inject(DesktopViewport);
  readonly plural = plural;
  readonly filters: readonly { id: ContainerCostFilter; label: string }[] = [
    { id: 'active', label: 'Actieve containers' }, { id: 'all', label: 'Alle containers · ook concepten' },
    { id: 'open', label: 'Nog niet volledig afgerekend' }, { id: 'finalized', label: 'Volledig afgerekend' },
    { id: 'higher', label: 'Duurder dan afgesproken' }, { id: 'lower', label: 'Goedkoper dan afgesproken' },
  ];
  readonly purchases = input.required<PurchaseOrderView[]>();
  readonly loading = input(false);
  readonly filter = signal<ContainerCostFilter>('active');
  readonly search = signal('');
  readonly expandedId = signal<number | null>(null);
  readonly rows = computed(() => containerCostRows(this.purchases(), this.filter(), this.search())
    .map(row => ({ ...row, paymentResult: purchasePaymentResult(row.view) })));
  readonly totals = computed(() => containerCostTotals(this.rows()));
  readonly paymentTotals = computed(() => containerPaymentResultTotals(this.rows()));
  readonly expanded = computed(() => this.rows().find((row) => row.view.order.id === this.expandedId()) ?? null);
  /** The phone shows five containers, the rest behind "Alle n tonen" (design §2.3). */
  readonly showAll = signal(false);
  readonly phoneRows = computed(() => this.showAll() ? this.rows() : this.rows().slice(0, 5));
  /** The container whose sheet is open on the phone. */
  readonly sheetId = signal<number | null>(null);
  readonly sheetRow = computed(() => this.rows().find((row) => row.view.order.id === this.sheetId()) ?? null);
  name(row: { view: PurchaseOrderView }): string { return containerName(row.view.order); }
  readonly unavailable = computed(() => this.purchases().filter((row) => !row.reconciliation).length);
  toggle(id: number): void { this.expandedId.update((current) => current === id ? null : id); }
  /** One product keeps the container's own figure in its unit (unitOf); several get their range, never an average. */
  unitMix(reconciliation: NonNullable<PurchaseOrderView['reconciliation']>): NacalcUnitMix { return nacalcUnitMix(reconciliation); }
  unitOf(totals: NonNullable<PurchaseOrderView['reconciliation']>['totals']): ReconciliationUnit { return reconciliationUnit(totals); }
  range(mix: NacalcUnitMix): string { return mixRange(mix); }
  orderStatus(status: PurchaseOrderView['order']['status']): string {
    return { CONCEPT: 'Concept', BESTELD: 'Besteld', ONDERWEG: 'Onderweg', ONTVANGEN: 'Ontvangen' }[status];
  }
}
