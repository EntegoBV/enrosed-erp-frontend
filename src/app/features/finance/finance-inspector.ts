import { ContainerPaymentTreeView } from './container-payment-tree-view';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MediaAssetSummary } from '../../core/api/media-models';
import { CompanyCost, Payee, PurchaseOrderView, RecurringCost } from '../../core/api/models';
import { formatBytes } from '../../shared/format-bytes';
import { Icon } from '../../shared/icon';
import { EurPipe } from '../../shared/pipes';
import { Skeleton } from '../../shared/skeleton';
import { categoryLabel } from './cost-categories';
import { countryName } from './cost-countries';
import { paymentPayeeLabel } from './cost-ledger';
import { CostPaymentsSection } from './cost-payments-section';
import { dayMonth, dayMonthYear } from './finance-format';
import { REVERSE_CHARGE, acquisitionValueOf, cashTotalOf, expenseOf, intervalLabel, isInvestment, monthlyEquivalentEur, occurrencesBetween, addDays, openOf, paidOf, regimeLabel, revisionUntil, vatOf } from './finance-metrics';
import { FinanceState, InspectTarget, formatEuro } from './finance-state';
import { incomingPurposeLabel, paymentMomentLabel, uniqueIncomingPayments } from './incoming-money';
import { daysBetween } from './payables';

const STATUS_LABEL: Readonly<Record<string, string>> = { CONCEPT: 'Concept', BESTELD: 'Besteld', ONDERWEG: 'Onderweg', ONTVANGEN: 'Ontvangen' };
const KIND_LABEL: Readonly<Record<string, string>> = { GOODS: 'Goederen', SERVICES: 'Diensten', INVESTMENT: 'Investering' };
const DAY = 86_400_000;

/**
 * The detail of one row: a cost, a container, an invoice or a recurring
 * cost. Docked beside the table on a wide desk, a drawer on a narrow one,
 * and the detail sheet on a phone: one body for all three. The phone sheet
 * renders it twice, as 'sheet' in its body and as 'foot' (the actions only,
 * as iOS capsules) in its foot slot.
 */
@Component({
  selector: 'app-finance-inspector',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  imports: [RouterLink, Icon, EurPipe, Skeleton, CostPaymentsSection, ContainerPaymentTreeView],
  template: `
    @let t = target();
    @if (layout() === 'foot') {
      @switch (t.kind) {
        @case ('cost') {
          @if (cost(); as cost) {
            @if (!cost.ticaSettlementId && open(cost) !== 0) { <button class="btn btn--primary" type="button" (click)="state.openPay([cost])">{{ incl(cost) < 0 ? 'Terugbetaling…' : 'Betaald…' }}</button> }
            @if (cost.ticaSettlementId) { <button class="btn btn--primary" type="button" (click)="state.openTicaSettlement(cost.ticaSettlementId)">TICA-afrekening ›</button> }
            @else { <button class="btn" [class.btn--primary]="open(cost) === 0" type="button" (click)="state.openCost(cost)">Bewerken</button> }
            <button class="ios-circle" type="button" aria-label="Meer" (click)="state.costMenu(cost, null)"><app-icon name="more" [size]="22" /></button>
          }
        }
        @case ('container') { <button class="btn btn--primary" type="button" (click)="state.openContainer(t.id)">Beheren bij de container ›</button> }
        @case ('invoice') {
          @if (invoice(); as row) { <button class="btn btn--primary" type="button" (click)="state.openInvoice(row.id)">{{ row.kind === 'credit' ? 'Creditnota openen ›' : 'Factuur openen ›' }}</button> }
        }
        @case ('recurring') {
          @if (recurring(); as definition) {
            <button class="btn" type="button" (click)="state.openRecurring(definition)">Bewerken</button>
            <button class="btn" type="button" [disabled]="state.saving()" (click)="state.setRecurringActive(definition, !definition.active)">{{ definition.active ? 'Pauzeren' : 'Hervatten' }}</button>
            <button class="ios-circle" type="button" aria-label="Meer" (click)="state.recurringMenu(definition, null)"><app-icon name="more" [size]="22" /></button>
          }
        }
      }
    } @else {
      @if (layout() === 'pane') {
        <header class="wk-inspector__head">
          <h2 class="wk-inspector__title" tabindex="-1" #heading>{{ title() }}</h2>
          <button class="wk-btn wk-btn--ghost wk-btn--icon wk-btn--sm" type="button" aria-label="Sluiten" (click)="state.closeInspector()"><app-icon name="close" [size]="16" /></button>
        </header>
      }
      @switch (t.kind) {
        @case ('cost') {
          @if (cost(); as cost) {
            <section class="wk-section fin-insp-hero">
              @if (cost.party) { <span class="fin-insp-party">{{ cost.party }}</span> }
              <strong class="fin-insp-amount">{{ incl(cost) | eur }}</strong>
              @if (open(cost) === 0) {
                @if (overpaid(cost) > 0) { <span class="wk-pill tone-blue">Te veel betaald · {{ overpaid(cost) | eur }}</span> }
                @else { <span class="wk-pill tone-ok">{{ incl(cost) < 0 ? 'Terugbetaald' : 'Betaald' }} {{ day(cost.paidOn) }}</span> }
              } @else if (partial(cost)) { <span class="wk-pill tone-warn">{{ incl(cost) < 0 ? 'Deels terugbetaald' : 'Deels betaald' }} · nog {{ abs(open(cost)) | eur }}</span> }
              @else { <span class="wk-pill tone-warn">{{ incl(cost) < 0 ? 'Terug te ontvangen' : 'Open' }}{{ age(cost.date) > 0 ? ' · ' + age(cost.date) + ' d' : '' }}</span> }
            </section>
            <section class="wk-section">
              <dl class="wk-kv">
                <div><dt>{{ dateLabel(cost) }}</dt><dd>{{ dayYear(cost.date) }}</dd></div>
                @if (cost.dueDate) { <div><dt>Vervalt op</dt><dd>{{ dayYear(cost.dueDate) }}</dd></div> }
                <div><dt>Categorie</dt><dd>{{ cost.vatRegime === 'IMPORT_VAT_PAID' ? 'Invoer-btw' : category(cost.category) }}</dd></div>
                @if (cost.vatRegime !== 'IMPORT_VAT_PAID') { <div><dt>Excl. btw</dt><dd>{{ cost.amountExclEur | eur }}</dd></div> }
                <div><dt>{{ vatLabel(cost) }}</dt><dd>{{ vat(cost) | eur }}</dd></div>
                <div><dt>{{ totalLabel(cost) }}</dt><dd>{{ incl(cost) | eur }}</dd></div>
                <div><dt>Btw-regeling</dt><dd>{{ regime(cost) }}
                  @if (!cost.vatRegime) { <button class="wk-link fin-insp-link" type="button" (click)="state.openCost(cost, [], { regime: true })">Kiezen ›</button> }
                  @else if (!cost.vatRegimeConfirmed) { <span class="wk-pill wk-pill--outline">te bevestigen</span>
                    <button class="wk-link fin-insp-link" type="button" [disabled]="state.busy()" (click)="state.confirmRegime([cost])">Klopt</button> }
                </dd></div>
                @if (cost.vatRegime !== 'IMPORT_VAT_PAID' && cost.vatRegime !== 'OUT_OF_SCOPE') { <div><dt>Soort</dt><dd>{{ kind(cost) }}</dd></div> }
                @if (deduction(cost); as text) { <div><dt>Aftrekbaar</dt><dd>{{ text }}</dd></div> }
                @if (depreciation(cost); as text) { <div><dt>Afschrijving</dt><dd>{{ text }}</dd></div> }
                @if (fiscal(cost); as amount) { <div><dt>Fiscaal aftrekbaar</dt><dd>{{ amount | eur }}</dd></div> }
                @if (cost.reference) { <div><dt>Referentie</dt><dd>{{ cost.reference }}</dd></div> }
                @if (cost.salesChannel) { <div><dt>Kanaal</dt><dd>{{ channel(cost.salesChannel) }}</dd></div> }
                @if (recurringOf(cost.recurringCostId); as definition) {
                  <div><dt>Vaste kost</dt><dd><button class="wk-link fin-insp-link" type="button" (click)="state.inspectRelated({ kind: 'recurring', id: definition.id! })">{{ definition.name }} ›</button></dd></div>
                }
              </dl>
            </section>
            <app-cost-payments-section [cost]="cost" />
            <section class="wk-section" (dragover)="dragOver($event)" (dragleave)="dropping.set(false)" (drop)="drop($event, cost.id!)">
              <h3 class="wk-section__title">Documenten
                <a class="wk-link fin-insp-link" routerLink="/files" [queryParams]="{ view: 'cost', doel: cost.id }">In Documenten &amp; media ›</a></h3>
              @for (asset of documents(); track asset.id) {
                <div class="fin-doc">
                  <button class="fin-doc__open" type="button" (click)="state.openAttachment(asset)" [title]="asset.originalFilename">
                    <app-icon [name]="asset.kind === 'IMAGE' ? 'image' : 'document'" [size]="18" />
                    <span><b>{{ asset.name }}</b><small>{{ size(asset) }}</small></span>
                  </button>
                  @if (asset.archived) { <span class="wk-pill wk-pill--outline">gearchiveerd</span> }
                  <a class="fin-doc__icon" routerLink="/files" [queryParams]="{ view: 'cost', doel: cost.id, bestand: asset.id }" aria-label="Toon in Documenten & media"><app-icon name="link" [size]="15" /></a>
                  <button class="fin-doc__icon" type="button" aria-label="Document losmaken" [disabled]="state.detaching().has(asset.id)" (click)="state.detach(asset, cost.id!)"><app-icon name="close" [size]="15" /></button>
                </div>
              }
              @if (layout() === 'pane') {
                <div class="fin-dropzone" [class.is-over]="dropping()">
                  <span>{{ state.uploading() ? 'Opladen…' : 'Sleep een factuur of bon hierheen' }}</span>
                  <button class="wk-btn wk-btn--sm" type="button" [disabled]="state.uploading()" (click)="addDocument(cost.id!)"><app-icon name="plus" [size]="14" />Document</button>
                </div>
              } @else {
                <div class="fin-doc-buttons">
                  <label class="ios-capsule ios-capsule--tinted"><app-icon name="camera" [size]="18" />Foto maken
                    <input class="fin-hidden" type="file" accept="image/*" capture="environment" [disabled]="state.uploading()" (change)="picked($event, cost.id!)" /></label>
                  <label class="ios-capsule ios-capsule--tinted"><app-icon name="document" [size]="18" />Bestand kiezen
                    <input class="fin-hidden" type="file" multiple accept="application/pdf,image/*,.doc,.docx,.xls,.xlsx,.txt" [disabled]="state.uploading()" (change)="picked($event, cost.id!)" /></label>
                </div>
                @if (state.uploading()) { <p class="fin-hint" role="status">Opladen…</p> }
              }
            </section>
            @if (cost.notes) { <section class="wk-section"><h3 class="wk-section__title">Notities</h3><p class="fin-notes">{{ cost.notes }}</p></section> }
            @if (layout() === 'pane') {
              <footer class="wk-inspector__foot">
                @if (!cost.ticaSettlementId && open(cost) !== 0) { <button class="wk-btn wk-btn--primary" type="button" (click)="state.openPay([cost])">{{ incl(cost) < 0 ? 'Terugbetaling…' : 'Betaald…' }}</button> }
                @else if (!cost.ticaSettlementId) { <button class="wk-btn" type="button" [disabled]="state.saving() || state.busy()" (click)="state.markUnpaid(cost)">Weer open zetten</button> }
                @if (cost.ticaSettlementId) { <button class="wk-btn" type="button" (click)="state.openTicaSettlement(cost.ticaSettlementId)">TICA-afrekening ›</button> }
                @else { <button class="wk-btn" type="button" (click)="state.openCost(cost)">Bewerken</button> }
                <button class="wk-btn wk-btn--ghost wk-btn--icon" type="button" aria-label="Meer" (click)="state.costMenu(cost, anchor($event))"><app-icon name="more" [size]="16" /></button>
              </footer>
            }
          } @else { <p class="wk-empty__text fin-insp-missing">Deze kost staat niet meer in de lijst.</p> }
        }
        @case ('container') {
          @if (container(); as view) {
            <section class="wk-section fin-insp-hero">
              <span class="fin-insp-party">{{ view.order.number }} · {{ statusOf(view) }}</span>
              <strong class="fin-insp-amount">{{ (view.reconciliation?.totals?.remainingEur ?? 0) | eur }}</strong>
              <span class="wk-amount--muted">nog open · verwacht</span>
            </section>
            <!-- Per payee: invoices → terms → payments, with where each payment stands on the bank (as Uitgaven › Containers). -->
            <section class="wk-section fin-insp-tree">
              <app-container-payment-tree [view]="view" />
              @if (!state.paymentsFor(view.order.id).length) { <p class="fin-hint">Nog geen betalingen geregistreerd.</p> }
            </section>
            @if (layout() === 'pane') { <footer class="wk-inspector__foot"><button class="wk-btn wk-btn--primary" type="button" (click)="state.openContainer(view.order.id)">Beheren bij de container ›</button></footer> }
          } @else if (state.containersLoading()) {
            <section class="wk-section"><app-skeleton kind="lines" [rows]="5" /></section>
          } @else {
            <section class="wk-section">
              @for (payment of state.paymentsFor(t.id); track payment.id) {
                <div class="fin-pay-line"><span>{{ day(payment.paidOn) }}</span><span>{{ payment.label || payee(payment.payee ?? 'SUPPLIER') }}</span><b>{{ payment.amountEur | eur }}</b></div>
              }
            </section>
            @if (layout() === 'pane') { <footer class="wk-inspector__foot"><button class="wk-btn wk-btn--primary" type="button" (click)="state.openContainer(t.id)">Beheren bij de container ›</button></footer> }
          }
        }
        @case ('invoice') {
          @if (invoice(); as row) {
            <section class="wk-section fin-insp-hero">
              <span class="fin-insp-party">{{ row.customer || 'Klant onbekend' }}</span>
              <strong class="fin-insp-amount">{{ row.kind === 'credit' ? '− ' + (row.creditEur | eur) : (row.remainingEur | eur) }}</strong>
              <span class="wk-pill" [class.tone-warn]="row.kind !== 'credit' && row.ageDays > 30" [class.tone-plum]="row.kind === 'credit'">{{ row.kind === 'credit' ? 'tegoed af te handelen' : 'nog open' }} · {{ row.ageDays }} d</span>
            </section>
            <section class="wk-section">
              <dl class="wk-kv">
                <div><dt>Soort</dt><dd>{{ row.kind === 'credit' ? 'Creditnota' + (row.creditedInvoiceNumber ? ' op ' + row.creditedInvoiceNumber : '') : purposeLabel(row.purpose) }}</dd></div>
                <div><dt>{{ row.kind === 'credit' ? 'Datum' : 'Factuurdatum' }}</dt><dd>{{ dayYear(row.orderDate) }}</dd></div>
                <div><dt>Totaal</dt><dd>{{ row.totalEur | eur }}</dd></div>
                @if (row.kind === 'credit') {
                  <div><dt>Verrekend of terugbetaald</dt><dd>{{ -row.receivedEur | eur }}</dd></div>
                  <div><dt>Tegoed</dt><dd>{{ row.creditEur | eur }}</dd></div>
                } @else {
                  <div><dt>Ontvangen</dt><dd>{{ row.receivedEur | eur }}</dd></div>
                  <div><dt>Nog open</dt><dd>{{ row.remainingEur | eur }}</dd></div>
                }
              </dl>
            </section>
            <section class="wk-section">
              <h3 class="wk-section__title">{{ row.kind === 'credit' ? 'Verrekend en terugbetaald' : 'Ontvangen op deze factuur' }}</h3>
              @for (receipt of receipts(); track receipt.id) {
                <div class="fin-pay-line"><span>{{ moment(receipt.receivedAt, receipt.timeZone) }}</span>
                  <span>@if (receipt.offsetPaymentId != null) { verrekend met {{ receipt.offsetOrderNumber || 'document' }} } @else if (state.receiptAccountKey(receipt); as account) { {{ state.accountLabel(account) }} } @else { <span class="wk-pill tone-warn" title="Telt niet mee in je banksaldo">geen rekening</span> }</span>
                  <b [class.wk-amount--in]="receipt.amountEur > 0 && receipt.offsetPaymentId == null">{{ receipt.amountEur | eur }}</b></div>
              } @empty { <p class="fin-hint">{{ row.kind === 'credit' ? 'Nog niets verrekend of terugbetaald.' : 'Nog niets ontvangen.' }}</p> }
            </section>
            @if (layout() === 'pane') { <footer class="wk-inspector__foot"><button class="wk-btn wk-btn--primary" type="button" (click)="state.openInvoice(row.id)">{{ row.kind === 'credit' ? 'Creditnota openen ›' : 'Factuur openen ›' }}</button></footer> }
          } @else { <p class="wk-empty__text fin-insp-missing">Deze factuur staat niet meer open.</p> }
        }
        @case ('recurring') {
          @if (recurring(); as definition) {
            <section class="wk-section fin-insp-hero">
              <span class="fin-insp-party">{{ definition.party || category(definition.category) }}</span>
              <strong class="fin-insp-amount">{{ incl(definition) | eur }}</strong>
              <span class="wk-pill" [class.tone-ok]="definition.active" [class.tone-warn]="!definition.active">{{ rhythm(definition.interval) }}{{ definition.active ? '' : ' · gepauzeerd' }}</span>
            </section>
            <section class="wk-section">
              <dl class="wk-kv">
                <div><dt>Per keer excl.</dt><dd>{{ definition.amountExclEur | eur }}</dd></div>
                <div><dt>Per maand excl.</dt><dd>{{ monthly(definition) | eur }}</dd></div>
                <div><dt>Categorie</dt><dd>{{ category(definition.category) }}</dd></div>
                <div><dt>Domiciliëring</dt><dd>{{ definition.autoPaid ? 'ja, gaat vanzelf' : 'nee' }}</dd></div>
                @if (definition.endDate) { <div><dt>Tot</dt><dd>{{ dayYear(definition.endDate) }}</dd></div> }
              </dl>
            </section>
            <section class="wk-section">
              <h3 class="wk-section__title">Volgende boekingen</h3>
              @for (date of nextDates(); track date) { <div class="fin-pay-line"><span>{{ dayYear(date) }}</span><b>{{ incl(definition) | eur }}</b></div> }
              @empty { <p class="fin-hint">{{ definition.active ? 'Niets meer gepland.' : 'Gepauzeerd: er wordt niets geboekt.' }}</p> }
            </section>
            <section class="wk-section">
              <h3 class="wk-section__title">Geboekt dit jaar <span>{{ bookedThisYear().length }} · {{ bookedTotal() | eur }}</span></h3>
              @for (cost of bookedThisYear(); track cost.id) {
                <button class="fin-pay-line fin-pay-line--link" type="button" (click)="state.inspectRelated({ kind: 'cost', id: cost.id! })"><span>{{ day(cost.date) }}</span><span>{{ open(cost) === 0 ? 'betaald' : partial(cost) ? 'deels · nog ' + (open(cost) | eur) : 'open' }}</span><b>{{ incl(cost) | eur }}</b></button>
              }
            </section>
            @if (layout() === 'pane') {
              <footer class="wk-inspector__foot">
                <button class="wk-btn" type="button" (click)="state.openRecurring(definition)">Bewerken</button>
                <button class="wk-btn" type="button" [disabled]="state.saving()" (click)="state.setRecurringActive(definition, !definition.active)">{{ definition.active ? 'Pauzeren' : 'Hervatten' }}</button>
                <button class="wk-btn wk-btn--danger" type="button" (click)="state.deleteRecurring(definition)">Verwijderen</button>
              </footer>
            }
          } @else { <p class="wk-empty__text fin-insp-missing">Deze vaste kost bestaat niet meer.</p> }
        }
      }
    }
  `,
})
export class FinanceInspector {
  readonly state = inject(FinanceState);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly target = input.required<InspectTarget>();
  /** 'pane': docked or drawer on a desk; 'sheet': the phone detail sheet's body; 'foot': that sheet's actions. */
  readonly layout = input<'pane' | 'sheet' | 'foot'>('pane');
  readonly dropping = signal(false);

  readonly cost = computed(() => this.target().kind === 'cost' ? this.state.costs().find((row) => row.id === this.target().id) ?? null : null);
  readonly documents = computed(() => this.state.attachmentsFor(this.cost()?.id));
  readonly container = computed<PurchaseOrderView | null>(() => this.target().kind === 'container'
    ? this.state.purchaseViews().find((view) => view.order.id === this.target().id) ?? null : null);
  readonly invoice = computed(() => this.target().kind === 'invoice'
    ? this.state.receivables().find((row) => row.id === this.target().id) ?? null : null);
  readonly receipts = computed(() => uniqueIncomingPayments(this.state.incomingPayments()).filter((row) => row.salesOrderId === this.target().id));
  readonly recurring = computed(() => this.target().kind === 'recurring' ? this.state.recurring().find((row) => row.id === this.target().id) ?? null : null);
  readonly nextDates = computed(() => {
    const definition = this.recurring();
    if (!definition?.active || (!definition.nextDate && definition.lastBookedOn)) return [];
    const from = definition.nextDate && definition.nextDate > this.state.today() ? definition.nextDate : this.state.today();
    return occurrencesBetween(definition, from, addDays(from, 800)).slice(0, 6);
  });
  readonly bookedThisYear = computed(() => {
    const year = this.state.today().slice(0, 4);
    return this.state.costs().filter((cost) => cost.recurringCostId === this.target().id && cost.date.startsWith(year))
      .sort((a, b) => b.date.localeCompare(a.date));
  });
  readonly bookedTotal = computed(() => Math.round(this.bookedThisYear().reduce((sum, cost) => sum + cashTotalOf(cost) * 100, 0)) / 100);

  readonly title = computed(() => this.state.inspectTitle(this.target()));

  constructor() {
    /* Keyboard users land on the heading when the inspector opens, and back on the row it came from when it closes. */
    const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    afterNextRender(() => {
      if (this.layout() === 'pane') this.host.nativeElement.querySelector<HTMLElement>('.wk-inspector__title')?.focus({ preventScroll: true });
    });
    inject(DestroyRef).onDestroy(() => {
      const active = document.activeElement;
      const lost = !active || active === document.body || this.host.nativeElement.contains(active);
      if (this.layout() === 'pane' && lost && origin?.isConnected) origin.focus({ preventScroll: true });
    });
  }

  readonly abs = Math.abs;
  incl(row: { amountExclEur: number; vatPct: number | null; amountInclEur?: number | null }): number { return cashTotalOf(row); }
  vat(row: { amountExclEur: number; vatPct: number | null; amountInclEur?: number | null }): number { return vatOf(row); }
  open(cost: CompanyCost): number { return openOf(cost); }
  /** Something was paid, but not everything. */
  partial(cost: CompanyCost): boolean { const open = openOf(cost); return open !== 0 && Math.abs(Math.round(open * 100)) < Math.abs(Math.round(cashTotalOf(cost) * 100)); }
  overpaid(cost: CompanyCost): number { return Math.max(0, Math.round(Math.sign(cashTotalOf(cost)) * (paidOf(cost) - cashTotalOf(cost)) * 100)) / 100; }
  dateLabel(cost: CompanyCost): string {
    const regime = cost.vatRegime;
    if (regime === 'IMPORT_VAT_PAID') return 'Datum douanedocument';
    return !regime || regime === 'OUT_OF_SCOPE' || regime === 'NO_INVOICE' ? 'Datum' : 'Factuurdatum';
  }
  vatLabel(cost: CompanyCost): string {
    const pct = `${cost.vatPct}%`;
    if (cost.vatRegime === 'IMPORT_VAT_PAID') return 'Betaalde invoer-btw';
    if (cost.vatPct == null) return 'Btw op document';
    if (cost.vatRegime && REVERSE_CHARGE.has(cost.vatRegime)) return `Btw verlegd (${pct})`;
    return cost.vatRegime === 'FOREIGN_VAT' ? `Buitenlandse btw (${pct})` : `Btw (${pct})`;
  }
  /** What leaves the bank: the invoice total for a Belgian or foreign-VAT invoice, the amount without VAT otherwise. */
  totalLabel(cost: CompanyCost): string {
    return !cost.vatRegime || cost.vatRegime === 'BE' || cost.vatRegime === 'FOREIGN_VAT' ? 'Incl. btw' : 'Te betalen';
  }
  regime(cost: CompanyCost): string {
    const country = cost.supplierCountry && cost.supplierCountry !== 'BE' ? ` · ${countryName(cost.supplierCountry, this.state.countryChoices())}` : '';
    return `${regimeLabel(cost.vatRegime)}${cost.vatRegime ? country : ''}`;
  }
  kind(cost: CompanyCost): string { return KIND_LABEL[cost.costKind ?? ''] ?? 'Nog te bepalen'; }
  /** 'x % btw · y % fiscaal', only when a share is not fully deductible. */
  deduction(cost: CompanyCost): string {
    if (cost.vatRegime === 'IMPORT_VAT_PAID' || cost.vatRegime === 'OUT_OF_SCOPE') return '';
    const vat = cost.vatDeductiblePct ?? 100;
    const tax = cost.taxDeductiblePct ?? 100;
    return vat === 100 && tax === 100 ? '' : `${vat} % btw · ${tax} % fiscaal`;
  }
  /** '€ a per jaar · tot dd mmm jjjj · herziening tot dd mmm jjjj' for an investment. */
  depreciation(cost: CompanyCost): string {
    if (!isInvestment(cost)) return '';
    const years = Number.isInteger(cost.depreciationYears) && (cost.depreciationYears as number) >= 1 ? cost.depreciationYears as number : 5;
    const start = cost.depreciationStart || cost.date;
    const annuity = Math.round(acquisitionValueOf(cost) * 100 / years) / 100;
    const [year, month, day] = start.split('-').map(Number);
    const until = new Date(Date.UTC(year + years, month - 1, day) - DAY).toISOString().slice(0, 10);
    return `${formatEuro(annuity)} per jaar · tot ${dayMonthYear(until)} · herziening tot ${dayMonthYear(revisionUntil(start))}`;
  }
  /** The fiscally deductible share of the expense, only when it is not the whole. */
  fiscal(cost: CompanyCost): number {
    const pct = cost.taxDeductiblePct ?? 100;
    return pct >= 100 ? 0 : Math.round(expenseOf(cost) * pct) / 100;
  }
  day(date: string | null): string { return dayMonth(date); }
  dayYear(date: string | null): string { return dayMonthYear(date); }
  age(date: string): number { return date <= this.state.today() ? daysBetween(date, this.state.today()) : 0; }
  category(code: string): string { return categoryLabel(code); }
  channel(code: string): string { return this.state.channelName(code); }
  payee(code: Payee): string { return paymentPayeeLabel(code); }
  rhythm(code: string): string { return intervalLabel(code); }
  monthly(definition: RecurringCost): number { return monthlyEquivalentEur(definition); }
  purposeLabel(purpose: 'STANDARD' | 'PARTNER_ADVANCE' | 'PARTNER_SETTLEMENT'): string { return purpose === 'STANDARD' ? 'Klant' : incomingPurposeLabel(purpose); }
  moment(at: string, timeZone: string): string { return paymentMomentLabel({ receivedAt: at, timeZone }, this.state.today()); }
  size(asset: MediaAssetSummary): string { return formatBytes(asset.sizeBytes); }
  statusOf(view: PurchaseOrderView): string { return view.reconciliation?.totals?.finalized ? 'Afgerond' : STATUS_LABEL[view.order.status] ?? view.order.status; }
  recurringOf(id: number | null | undefined) { return id ? this.state.recurring().find((row) => row.id === id) ?? null : null; }
  anchor(event: MouseEvent): { x: number; y: number } {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: rect.left, y: rect.top - 8 };
  }

  addDocument(costId: number): void {
    void this.state.pickFiles().then((files) => this.state.attach(costId, files));
  }

  /** 'Foto maken' / 'Bestand kiezen' in the phone sheet. */
  picked(event: Event, costId: number): void {
    const input = event.target as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';
    void this.state.attach(costId, files);
  }

  dragOver(event: DragEvent): void {
    if (!event.dataTransfer || ![...event.dataTransfer.types].includes('Files')) return;
    event.preventDefault();
    this.dropping.set(true);
  }

  drop(event: DragEvent, costId: number): void {
    this.dropping.set(false);
    const files = [...(event.dataTransfer?.files ?? [])];
    if (!files.length) return;
    event.preventDefault();
    event.stopPropagation();
    void this.state.attach(costId, files);
  }
}
