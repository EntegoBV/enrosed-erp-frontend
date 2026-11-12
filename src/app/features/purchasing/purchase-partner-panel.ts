import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { messageOf } from '../../core/api/errors';
import { Customer, PurchaseOrder, PurchaseOrderView, SalesOrderView } from '../../core/api/models';
import { SalesApi } from '../../core/api/sales-api';
import { SourcingApi } from '../../core/api/sourcing-api';
import { DateNlPipe, EurPipe, NumPipe } from '../../shared/pipes';
import { Ui } from '../../shared/ui';
import { partnerDocumentKind } from '../sales/partner-settlement';
import { STATUS_LABEL } from '../sales/quote-status';
import { pctLabel } from './purchase-nacalc-metrics';

/**
 * The partner question, asked where the container is described: off by
 * default, and once on it shows who, what he pays up front and our share of
 * the profit, saved straight onto the container. From here the partner's
 * draft invoices are made without searching, an existing document is linked, and the
 * auction settlement follows.
 */
@Component({
  selector: 'app-purchase-partner-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, EurPipe, DateNlPipe, NumPipe],
  template: `
    <section class="po-partner" [class.po-partner--on]="on()" aria-labelledby="po-partner-title">
      <header class="po-partner__head">
        <label class="po-partner__switch">
          <input type="checkbox" role="switch" [checked]="on() || editing()" [disabled]="busy() || (on() && docs().length > 0)" (change)="toggle($any($event.target).checked)" />
          <span><b id="po-partner-title">Partnercontainer</b><small>{{ on() ? (partnerName() || 'partner') + ' bestelt mee' : editing() ? 'Wie bestelt mee, en wat is de afspraak?' : 'Standaard uit: we betalen de container zelf' }}</small></span>
        </label>
        @if (on() && !editing()) {
          <button class="linklike" type="button" (click)="editing.set(true)">Afspraak wijzigen</button>
        }
      </header>

      @if (editing()) {
          <div class="po-partner__form">
            <div class="field">
              <label for="po-partner-customer">Partner</label>
              @if (partners().length) {
                <select class="select" id="po-partner-customer" [ngModel]="draftCustomerId()" (ngModelChange)="pickCustomer(+$event)">
                  @for (customer of partners(); track customer.id) { <option [value]="customer.id">{{ customer.company }}</option> }
                </select>
              } @else {
                <p class="hint">Nog geen partnerklant. Zet bij de klant "Partner" aan; dan staat hij hier.</p>
              }
            </div>
            <div class="field">
              <span class="label">Partner betaalt vooraf</span>
              <div class="po-partner__chips" role="group" aria-label="Totaal gefinancierd deel">
                <button type="button" class="fin-chip" [class.on]="draftCostPct() === 100" (click)="draftCostPct.set(100)">100 %</button>
                <button type="button" class="fin-chip" [class.on]="draftCostPct() === 50" (click)="draftCostPct.set(50)">50 %</button>
                <button type="button" class="fin-chip" [class.on]="draftCostPct() === 0" (click)="draftCostPct.set(0)">0 %</button>
                <span class="po-partner__pct"><input class="input num right" type="number" min="0" max="100" step="0.5" inputmode="decimal" aria-label="Eigen percentage"
                       [ngModel]="draftCostPct()" (ngModelChange)="draftCostPct.set(clamp($event))" /><i>%</i></span>
              </div>
              <span class="hint">Van het inkooptotaal incl. aparte kosten{{ (advanceBasisEur() ?? 0) ? ': ' + ((advanceBasisEur() ?? 0) * draftCostPct() / 100 | eur) + ' vooraf, ' + ((advanceBasisEur() ?? 0) * (100 - draftCostPct()) / 100 | eur) + ' resterend deel tot de veiling' : '' }}.</span>
            </div>
            <div class="field">
              <label for="po-partner-share">Ons deel van het veilingresultaat na de veiling</label>
              <span class="po-partner__pct"><input class="input num right" id="po-partner-share" type="number" min="0" max="100" step="0.5" inputmode="decimal"
                     [ngModel]="draftSharePct()" (ngModelChange)="draftSharePct.set(clamp($event))" /><i>%</i></span>
            </div>
            <div class="po-partner__actions">
              <button class="btn btn--sm" type="button" [disabled]="busy()" (click)="cancel()">Annuleren</button>
              <button class="btn btn--primary btn--sm" type="button" [disabled]="busy() || draftCustomerId() === null" (click)="save()">{{ busy() ? 'Bezig…' : 'Bewaren' }}</button>
            </div>
          </div>
      } @else if (!on()) {
        <p class="po-partner__lead">Deze container betalen we volledig zelf. Bestelt een partner mee en verkoopt hij de goederen op de veiling? Zet de schakelaar aan; de voorschotfacturen, de koppeling en de veilingafrekening volgen dan hier.</p>
      } @else {
          <dl class="po-partner__facts">
            <div><dt>Partner</dt><dd>{{ partnerName() || '—' }}</dd></div>
            <div><dt>Bijdrage volgens actueel inkooptotaal</dt><dd>{{ pctLabel(order().partnerCostPct ?? 100) }} van het inkooptotaal incl. aparte kosten{{ (advanceBasisEur() ?? 0) ? ' · ' + ((advanceBasisEur() ?? 0) * (order().partnerCostPct ?? 100) / 100 | eur) : '' }}</dd></div>
            <div><dt>Ons deel van het veilingresultaat</dt><dd>{{ pctLabel(order().partnerSharePct ?? 50) }}</dd></div>
          </dl>
          <p class="po-partner__lead">Maak direct conceptvoorschotfacturen, bijvoorbeeld 30% bij productiestart en 70% na productie. Elke termijn krijgt een eigen factuur; er wordt nog niets uitgegeven of verstuurd. De slotfactuur verrekent de voorschotten, de werkelijke kosten en ons aandeel in het resultaat.</p>

        @if (docs().length) {
          <ul class="po-partner__docs">
            @for (deal of docs(); track deal.order.id) {
              <li>
                <a class="po-partner__doc" [routerLink]="['/sales', deal.order.id]">
                  <b>{{ deal.order.number }}</b>
                  <small>{{ kind(deal.order, deal.settlement?.finalSettlement) }} · {{ statusLabel[deal.order.status] }} · {{ deal.order.orderDate | dateNl }}{{ paidSuffix(deal) }}</small>
                </a>
                <span class="po-partner__amount">@if (deal.advanceAgreement) { Betaalafspraken } @else { {{ deal.priced.totals.total | eur }} }</span>
                <button class="po-partner__unlink" type="button" [attr.aria-label]="'Koppeling van ' + deal.order.number + ' verwijderen'" title="Koppeling verwijderen" (click)="unlink.emit(deal)">×</button>
              </li>
            }
          </ul>
        }

        @if (reported(); as open) {
          <!-- Veilingverkopen: what the partner reported from this container and nobody invoiced yet (Factureren there). -->
          <a class="po-partner__reported" routerLink="/veilingverkopen">
            <span>Veilingverkopen nog te factureren</span>
            <b>{{ open.quantity | num }} {{ open.quantity === 1 ? 'stuk' : 'stuks' }} · netto {{ open.netEur | eur }}</b>
            <i aria-hidden="true">›</i>
          </a>
        }

        <div class="po-partner__buttons">
          <button class="btn btn--sm" [class.btn--primary]="!costDocument()" type="button" [disabled]="!canQuote()" (click)="quote.emit()">Conceptvoorschotfacturen maken</button>
          <button class="btn btn--sm" [class.btn--primary]="!!costDocument()" type="button" (click)="schedule.emit()">{{ costDocument() ? 'Voorschotfacturen per termijn' : 'Betaalafspraken bekijken' }}</button>
          @if (canAuction()) { <button class="btn btn--sm" type="button" (click)="auction.emit()">Deelveiling / slot afrekenen</button> }
          <button class="btn btn--sm" type="button" (click)="link.emit()">Bestaande factuur koppelen</button>
        </div>
        @if (!costDocument() && !canQuote()) { <p class="hint">Reken de container eerst door; de voorschotfacturen volgen de afgesproken bijdrage in het inkooptotaal incl. aparte kosten.</p> }
      }
    </section>
  `,
  styles: `
    .po-partner__reported { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 10px; min-height: 44px; margin: 10px 0 0; padding: 8px 12px;
      border: 1px solid color-mix(in srgb, var(--warn) 35%, var(--line)); border-radius: 12px; background: color-mix(in srgb, var(--warn) 8%, var(--surface));
      color: inherit; font-size: 13px; text-decoration: none; }
    .po-partner__reported span { flex: 1 1 auto; color: var(--ink-2); }
    .po-partner__reported b { color: var(--warn); font-variant-numeric: tabular-nums; white-space: nowrap; }
    .po-partner__reported i { color: var(--muted); font-style: normal; }
    .po-partner__reported:hover { border-color: var(--warn); }
  `,
})
export class PurchasePartnerPanel {
  private readonly sales = inject(SalesApi);
  private readonly sourcing = inject(SourcingApi);
  private readonly ui = inject(Ui);

  readonly order = input.required<PurchaseOrder>();
  /** The partner's sales documents on this container: quote, invoice, settlement. */
  readonly docs = input<SalesOrderView[]>([]);
  readonly advanceBasisEur = input<number | null>(null);
  /** Whether advance invoices can be made: every line has a landed cost. */
  readonly canQuote = input(true);
  /** Whether the auction statement can be drawn up: the container has costed lines. */
  readonly canAuction = input(false);

  readonly saved = output<PurchaseOrderView>();
  readonly quote = output<void>();
  readonly link = output<void>();
  readonly auction = output<void>();
  readonly schedule = output<void>();
  readonly unlink = output<SalesOrderView>();

  readonly statusLabel = STATUS_LABEL;
  readonly pctLabel = pctLabel;
  /** ' · betaald' / ' · nog niet betaald' on an invoice, never after a status that already says Betaald (F24). */
  paidSuffix(deal: SalesOrderView): string {
    const order = deal.order;
    if (order.docType !== 'FACTUUR' || order.status === 'CONCEPT') return '';
    if (order.paidAt) return /^betaald$/i.test(this.statusLabel[order.status] ?? '') ? '' : ' · betaald';
    return ' · nog niet betaald';
  }
  readonly kind = partnerDocumentKind;
  readonly customers = signal<Customer[]>([]);
  readonly busy = signal(false);
  readonly editing = signal(false);
  readonly draftCustomerId = signal<number | null>(null);
  readonly draftCostPct = signal(100);
  readonly draftSharePct = signal(50);

  readonly on = computed(() => this.order().partnerCustomerId != null);
  /**
   * Veilingverkopen still to invoice on this container, summed over the lines of partner-settlement-availability
   * (openReportedQuantity / openReportedNetEur); null when there is nothing, on an older backend or when it failed.
   */
  readonly reported = signal<{ quantity: number; netEur: number } | null>(null);
  private availabilityRound = 0;
  readonly partners = computed(() => this.customers().filter((customer) => customer.partner));
  readonly partnerName = computed(() => {
    const id = this.order().partnerCustomerId;
    return id == null ? '' : this.customers().find((customer) => customer.id === id)?.company ?? '';
  });
  /** The quote or invoice the partner paid, as opposed to the settlement. */
  readonly costDocument = computed(() => this.docs().find((deal) => !deal.order.partnerSettlement) ?? null);

  constructor() {
    void this.loadCustomers();
    /* An outside change (the container adopted a partner through a link) closes the form. */
    effect(() => { this.order().partnerCustomerId; this.editing.set(false); });
    /* The reported line: asked again when the container or its documents change (a new settlement takes pieces). */
    effect(() => {
      const id = this.order().id, partner = this.on() && this.canAuction();
      this.docs().length;
      void this.loadReported(partner ? id : null);
    });
  }

  private async loadReported(orderId: number | null): Promise<void> {
    const round = ++this.availabilityRound;
    if (orderId === null) { this.reported.set(null); return; }
    try {
      const available = await this.sourcing.partnerSettlementAvailability(orderId);
      if (round !== this.availabilityRound) return;
      const quantity = available.lines.reduce((sum, line) => sum + (line.openReportedQuantity ?? 0), 0);
      const netEur = Math.round(available.lines.reduce((sum, line) => sum + (line.openReportedNetEur ?? 0), 0) * 100) / 100;
      this.reported.set(quantity !== 0 || netEur !== 0 ? { quantity, netEur } : null);
    } catch {
      /* The line is a pointer, not a figure anything depends on: no line when the call fails. */
      if (round === this.availabilityRound) this.reported.set(null);
    }
  }

  private async loadCustomers(): Promise<void> {
    try { this.customers.set(await this.sales.customers()); } catch { this.customers.set([]); }
  }

  /** The switch: on opens the form with the first partner customer; off ends the deal. */
  toggle(checked: boolean): void {
    if (checked) {
      const first = this.partners()[0];
      this.draftCustomerId.set(first?.id ?? null);
      this.draftCostPct.set(first?.partnerCostPct ?? 100);
      this.draftSharePct.set(first?.partnerSharePct ?? 50);
      this.editing.set(true);
      return;
    }
    if (this.docs().length) {
      this.ui.toast('Ontkoppel eerst de documenten van de partner', 'err');
      return;
    }
    void this.persist(null, null, null, 'Geen partnercontainer meer');
  }

  pickCustomer(id: number): void {
    this.draftCustomerId.set(Number.isFinite(id) ? id : null);
    const customer = this.partners().find((row) => row.id === id);
    if (customer) {
      this.draftCostPct.set(customer.partnerCostPct ?? 100);
      this.draftSharePct.set(customer.partnerSharePct ?? 50);
    }
  }

  clamp(raw: unknown): number {
    const value = Number(String(raw ?? '').replace(',', '.'));
    return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
  }

  cancel(): void {
    this.editing.set(false);
    /* Switched on but never saved: the switch falls back. */
  }

  save(): void {
    if (this.draftCustomerId() === null) return;
    void this.persist(this.draftCustomerId(), this.draftCostPct(), this.draftSharePct(), 'Partnercontainer bewaard');
  }

  private async persist(customerId: number | null, costPct: number | null, sharePct: number | null, message: string): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const view = await this.sourcing.setPartner(this.order().id, { customerId, costPct, sharePct });
      this.editing.set(false);
      this.ui.toast(message, 'ok');
      this.saved.emit(view);
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Bewaren mislukt'), 'err');
    } finally {
      this.busy.set(false);
    }
  }
}
