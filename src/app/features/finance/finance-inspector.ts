import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MediaAssetSummary } from '../../core/api/media-models';
import { Payee, PurchaseOrderView, RecurringCost } from '../../core/api/models';
import { formatBytes } from '../../shared/format-bytes';
import { Icon } from '../../shared/icon';
import { EurPipe } from '../../shared/pipes';
import { Skeleton } from '../../shared/skeleton';
import { reconciliationStatusLabel } from '../purchasing/purchase-reconciliation-metrics';
import { channelLabel } from '../sales/sales-channels';
import { bankAccountKey } from './bank-reconciliation';
import { categoryLabel } from './cost-categories';
import { paymentPayeeLabel } from './cost-ledger';
import { PAYEE_TONES, dayMonth, dayMonthYear } from './finance-format';
import { inclOf, intervalLabel, monthlyEquivalentEur, occurrencesBetween, addDays, vatOf } from './finance-metrics';
import { FinanceState, InspectTarget } from './finance-state';
import { incomingPurposeLabel, paymentMomentLabel, uniqueIncomingPayments } from './incoming-money';
import { daysBetween } from './payables';

const STATUS_LABEL: Readonly<Record<string, string>> = { CONCEPT: 'Concept', BESTELD: 'Besteld', ONDERWEG: 'Onderweg', ONTVANGEN: 'Ontvangen' };

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
  imports: [RouterLink, Icon, EurPipe, Skeleton],
  template: `
    @let t = target();
    @if (layout() === 'foot') {
      @switch (t.kind) {
        @case ('cost') {
          @if (cost(); as cost) {
            @if (cost.paidOn) { <button class="btn" type="button" [disabled]="state.saving()" (click)="state.markUnpaid(cost)">Weer open zetten</button> }
            @else { <button class="btn btn--primary" type="button" (click)="state.openPay([cost])">Betaald…</button> }
            <button class="btn" type="button" (click)="state.openCost(cost)">Bewerken</button>
            <button class="ios-circle" type="button" aria-label="Meer" (click)="state.costMenu(cost, null)"><app-icon name="more" [size]="22" /></button>
          }
        }
        @case ('container') { <button class="btn btn--primary" type="button" (click)="state.openContainer(t.id)">Beheren bij de container ›</button> }
        @case ('invoice') {
          @if (invoice(); as row) { <button class="btn btn--primary" type="button" (click)="state.openInvoice(row.id)">Factuur openen ›</button> }
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
              @if (cost.paidOn) { <span class="wk-pill tone-ok">Betaald {{ day(cost.paidOn) }}</span> }
              @else { <span class="wk-pill tone-warn">Open{{ age(cost.date) > 0 ? ' · ' + age(cost.date) + ' d' : '' }}</span> }
            </section>
            <section class="wk-section">
              <dl class="wk-kv">
                <div><dt>Datum</dt><dd>{{ dayYear(cost.date) }}</dd></div>
                <div><dt>Categorie</dt><dd>{{ category(cost.category) }}</dd></div>
                <div><dt>Excl. btw</dt><dd>{{ cost.amountExclEur | eur }}</dd></div>
                <div><dt>Btw ({{ cost.vatPct ?? 0 }}%)</dt><dd>{{ vat(cost) | eur }}</dd></div>
                <div><dt>Incl. btw</dt><dd>{{ incl(cost) | eur }}</dd></div>
                @if (cost.reference) { <div><dt>Referentie</dt><dd>{{ cost.reference }}</dd></div> }
                @if (cost.salesChannel) { <div><dt>Kanaal</dt><dd>{{ channel(cost.salesChannel) }}</dd></div> }
                @if (cost.paidOn) { <div><dt>Betaald op</dt><dd>{{ dayYear(cost.paidOn) }}</dd></div> }
                @if (recurringOf(cost.recurringCostId); as definition) {
                  <div><dt>Vaste kost</dt><dd><button class="wk-link fin-insp-link" type="button" (click)="state.inspectItem({ kind: 'recurring', id: definition.id! })">{{ definition.name }} ›</button></dd></div>
                }
                @if (cost.paidOn) {
                  <div><dt>Op de bank</dt><dd>@if (bankedOn(cost.id); as account) { Genoteerd op {{ account }} } @else { <span class="wk-amount--warn">Nog niet op de bank</span> }</dd></div>
                }
              </dl>
            </section>
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
                @if (cost.paidOn) { <button class="wk-btn" type="button" [disabled]="state.saving()" (click)="state.markUnpaid(cost)">Weer open zetten</button> }
                @else { <button class="wk-btn wk-btn--primary" type="button" (click)="state.openPay([cost])">Betaald…</button> }
                <button class="wk-btn" type="button" (click)="state.openCost(cost)">Bewerken</button>
                <button class="wk-btn wk-btn--ghost wk-btn--icon" type="button" aria-label="Meer" (click)="state.costMenu(cost, anchor($event))"><app-icon name="more" [size]="16" /></button>
              </footer>
            }
          } @else { <p class="wk-empty__text fin-insp-missing">Deze kost staat niet meer in de lijst.</p> }
        }
        @case ('container') {
          @if (container(); as view) {
            <section class="wk-section fin-insp-hero">
              <span class="fin-insp-party">{{ view.order.alias || 'Container' }} · {{ statusOf(view) }}</span>
              <strong class="fin-insp-amount">{{ (view.reconciliation?.totals?.remainingEur ?? 0) | eur }}</strong>
              <span class="wk-amount--muted">nog open · verwacht</span>
            </section>
            @for (stream of view.reconciliation?.streams ?? []; track stream.payee) {
              <section class="wk-section">
                <h3 class="wk-section__title"><span><span [class]="'wk-dot tone-' + payeeTone(stream.payee)"></span> {{ payee(stream.payee) }}</span><span class="fin-insp-state">{{ streamStatus(stream) }}</span></h3>
                <dl class="wk-kv">
                  <div><dt>Afspraak</dt><dd>{{ stream.plannedEur | eur }}</dd></div>
                  <div><dt>Betaald</dt><dd>{{ stream.paidEur | eur }}</dd></div>
                  <div><dt>Open</dt><dd>{{ stream.remainingEur | eur }}</dd></div>
                </dl>
                @if (stream.payee === 'SUPPLIER' && view.reconciliation?.supplierInstalments?.length) {
                  <ul class="fin-terms">
                    @for (term of view.reconciliation!.supplierInstalments!; track term.due) {
                      <li><span>{{ term.label }}</span><span>{{ term.paidEur | eur }} / {{ term.plannedEur | eur }}</span></li>
                    }
                  </ul>
                }
              </section>
            }
            <section class="wk-section">
              <h3 class="wk-section__title">Betalingen</h3>
              @for (payment of state.paymentsFor(view.order.id); track payment.id) {
                <div class="fin-pay-line"><span>{{ day(payment.paidOn) }}</span><span>{{ payment.label || payee(payment.payee ?? 'SUPPLIER') }}</span><b>{{ payment.amountEur | eur }}</b></div>
              } @empty { <p class="fin-hint">Nog geen betalingen geregistreerd.</p> }
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
              <strong class="fin-insp-amount">{{ row.remainingEur | eur }}</strong>
              <span class="wk-pill" [class.tone-warn]="row.ageDays > 30">nog open · {{ row.ageDays }} d</span>
            </section>
            <section class="wk-section">
              <dl class="wk-kv">
                <div><dt>Soort</dt><dd>{{ purposeLabel(row.purpose) }}</dd></div>
                <div><dt>Factuurdatum</dt><dd>{{ dayYear(row.orderDate) }}</dd></div>
                <div><dt>Totaal</dt><dd>{{ row.totalEur | eur }}</dd></div>
                <div><dt>Ontvangen</dt><dd>{{ row.receivedEur | eur }}</dd></div>
                <div><dt>Nog open</dt><dd>{{ row.remainingEur | eur }}</dd></div>
              </dl>
            </section>
            <section class="wk-section">
              <h3 class="wk-section__title">Ontvangen op deze factuur</h3>
              @for (receipt of receipts(); track receipt.id) {
                <div class="fin-pay-line"><span>{{ moment(receipt.receivedAt, receipt.timeZone) }}</span>
                  <span>@if (state.receiptAccountKey(receipt); as account) { {{ state.accountLabel(account) }} } @else { <span class="wk-pill tone-warn" title="Telt niet mee in je banksaldo">geen rekening</span> }</span>
                  <b [class.wk-amount--in]="receipt.amountEur > 0">{{ receipt.amountEur | eur }}</b></div>
              } @empty { <p class="fin-hint">Nog niets ontvangen.</p> }
            </section>
            @if (layout() === 'pane') { <footer class="wk-inspector__foot"><button class="wk-btn wk-btn--primary" type="button" (click)="state.openInvoice(row.id)">Factuur openen ›</button></footer> }
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
                <button class="fin-pay-line fin-pay-line--link" type="button" (click)="state.inspectItem({ kind: 'cost', id: cost.id! })"><span>{{ day(cost.date) }}</span><span>{{ cost.paidOn ? 'betaald' : 'open' }}</span><b>{{ incl(cost) | eur }}</b></button>
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
  readonly bookedTotal = computed(() => Math.round(this.bookedThisYear().reduce((sum, cost) => sum + inclOf(cost) * 100, 0)) / 100);

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

  incl(row: { amountExclEur: number; vatPct: number | null }): number { return inclOf(row); }
  vat(row: { amountExclEur: number; vatPct: number | null }): number { return vatOf(row); }
  day(date: string | null): string { return dayMonth(date); }
  dayYear(date: string | null): string { return dayMonthYear(date); }
  age(date: string): number { return date <= this.state.today() ? daysBetween(date, this.state.today()) : 0; }
  category(code: string): string { return categoryLabel(code); }
  channel(code: string): string { return channelLabel(code); }
  payee(code: Payee): string { return paymentPayeeLabel(code); }
  payeeTone(code: string): string { return PAYEE_TONES[code] ?? 'grey'; }
  rhythm(code: string): string { return intervalLabel(code); }
  monthly(definition: RecurringCost): number { return monthlyEquivalentEur(definition); }
  purposeLabel(purpose: 'STANDARD' | 'PARTNER_ADVANCE' | 'PARTNER_SETTLEMENT'): string { return purpose === 'STANDARD' ? 'Klant' : incomingPurposeLabel(purpose); }
  moment(at: string, timeZone: string): string { return paymentMomentLabel({ receivedAt: at, timeZone }); }
  size(asset: MediaAssetSummary): string { return formatBytes(asset.sizeBytes); }
  statusOf(view: PurchaseOrderView): string { return view.reconciliation?.totals?.finalized ? 'Afgerond' : STATUS_LABEL[view.order.status] ?? view.order.status; }
  streamStatus(stream: Parameters<typeof reconciliationStatusLabel>[0]): string { return reconciliationStatusLabel(stream); }
  recurringOf(id: number | null | undefined) { return id ? this.state.recurring().find((row) => row.id === id) ?? null : null; }
  bankedOn(costId: number | null): string {
    const line = costId ? this.state.bankedLines().get(`kost#${costId}`) : null;
    return line ? this.state.accountLabel(bankAccountKey(line.account)) : '';
  }
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
