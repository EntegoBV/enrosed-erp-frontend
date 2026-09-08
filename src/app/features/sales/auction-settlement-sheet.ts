import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { messageOf } from '../../core/api/errors';
import { Customer, PartnerFinancing, PartnerSettlementAvailability } from '../../core/api/models';
import { SalesApi } from '../../core/api/sales-api';
import { SourcingApi } from '../../core/api/sourcing-api';
import { EurPipe, NumPipe } from '../../shared/pipes';
import { Sheet, Ui } from '../../shared/ui';
import { auctionLineSplit, auctionTotals } from './partner-settlement';
import { partialSettlementPreview } from './partner-settlement-progress';

/** One product of the container as it appears on the partner's statement. */
export interface AuctionSheetLine {
  productId: number;
  name: string;
  /** Pieces of the container; the partner may have sold fewer. */
  quantity: number;
  /** What one piece cost us landed, freight and duties included. */
  landedUnitEur: number;
}

/**
 * The auction settlement of a partner container. The partner sends a
 * statement of what every product fetched at auction; per product we
 * recover the part of the landed cost we financed and take our share of
 * the profit, and the whole lands on one invoice with real product lines.
 */
@Component({
  selector: 'app-auction-settlement-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet, RouterLink, EurPipe, NumPipe],
  template: `
    <app-sheet [title]="finalBatch() ? 'Resterende container afrekenen' : 'Deelveiling afrekenen'" (closed)="closed.emit()">
      <div body class="as">
        <p class="as__intro">Vul per product in wat het netto op de veiling opbracht, na veilingkosten, uit het overzicht van {{ customerName() || 'de partner' }}@if (reference()) { voor container {{ reference() }} }.
          Elke afrekening bevat alleen de stuks van deze veiling, hun externe kost en ons winst- of verliesaandeel. Het bijbehorende voorschot wordt evenredig verrekend; de laatste afrekening neemt het resterende saldo mee.</p>
        @if (customerId() === null) {
          <div class="field">
            <label class="req" for="as-customer">Partner</label>
            <select class="select" id="as-customer" [value]="chosenCustomer() ?? ''" (change)="pickCustomer($any($event.target).value)">
              <option value="" disabled>Kies de partner…</option>
              @for (customer of partners(); track customer.id) {
                <option [value]="customer.id">{{ customer.company }}</option>
              }
            </select>
            @if (!partners().length && !loadingCustomers()) { <span class="hint">Nog geen klant staat als partner ingesteld; zet dat eerst aan bij de klant.</span> }
          </div>
        }
        <div class="desk-form__duo">
          @if (!purchaseOrderId()) { <div class="field">
            <label for="as-cost">Deel van de kost dat wij terugvragen</label>
            <span class="as__pct"><input class="input num right" id="as-cost" type="number" min="0" max="100" step="5" inputmode="decimal"
                   [value]="costShare()" (input)="setCostShare($any($event.target).value)" /><i>%</i></span>
            <span class="hint">Aandeel van de kost voor deze afrekening.</span>
          </div> }
          <div class="field">
            <label for="as-profit">{{ purchaseOrderId() ? 'Afgesproken aandeel ENROSED' : 'Ons deel van de winst' }}</label>
            <span class="as__pct"><input class="input num right" id="as-profit" type="number" min="0" max="100" step="0.5" inputmode="decimal"
                   [value]="profitShare()" [readOnly]="!!purchaseOrderId()" (input)="setProfitShare($any($event.target).value)" /><i>%</i></span>
            <span class="hint">Op de winst boven de volledige gelande kost.</span>
          </div>
        </div>
        @if (separateUnitEur() > 0) {
          <p class="hint">Inspectie en andere kosten staan apart op de container: {{ separateUnitEur() | eur: 4 }} per stuk telt mee in de kost.</p>
        }
        @if (purchaseOrderId()) {
          <div class="per-toggle" role="group" aria-label="Omvang afrekening"><button type="button" [class.on]="!finalBatch()" (click)="setFinal(false)">Deelveiling</button><button type="button" [class.on]="finalBatch()" (click)="setFinal(true)">Alles wat resteert</button></div>
          <p class="hint">{{ finalBatch() ? 'Deze factuur sluit alle resterende stuks af.' : 'Vul alleen de aantallen en netto-opbrengsten van deze veiling in. Andere producten blijven op 0.' }} Voer 0 opbrengst in voor verkochte of afgeboekte stuks zonder opbrengst.</p>
          @if (availability(); as available) {
            <p class="hint">{{ remainingBefore() | num }} stuks beschikbaar · {{ available.remainingAdvanceEur | eur }} voorschot nog te verrekenen. Conceptafrekeningen reserveren hun aantallen en voorschot al.</p>
            @if (available.settlements.length) { <details><summary>Eerdere afrekeningen · {{ available.settlements.length }}</summary><div class="as__history">@for (previous of available.settlements; track previous.invoiceId) { <a [routerLink]="['/sales', previous.invoiceId]"><b>{{ previous.number }} · {{ previous.finalSettlement ? 'slot' : 'deelveiling' }}</b><span>{{ previous.quantity | num }} stuks · {{ previous.invoiceTotalEur | eur }} excl. btw · {{ previous.status === 'CONCEPT' ? 'concept / gereserveerd' : 'uitgereikt' }}</span></a> }</div></details> }
          }
        }
        @if (financingError()) { <p class="hint is-bad" role="alert">{{ financingError() }}</p> }
        @if (hasPendingFunding()) {
          <p class="hint is-bad">Rond eerst de voorschotten af: maak en geef de geplande facturen uit, of verwijder ongebruikte termijnen en concepten. Daarna kan de eerste veilingafrekening worden gemaakt. <a [routerLink]="['/purchasing', purchaseOrderId()]" [queryParams]="{ section: 'payments' }" (click)="funding.emit(); closed.emit()">Factuurtermijnen openen ›</a></p>
        }
        @if (financing(); as finance) { @if (!finance.costFinalized) { <p class="hint is-bad">De externe containerkost is nog voorlopig. Deze conceptafrekening gebruikt de huidige verwachte kost.</p> } }
        @if (availability() && !remainingBefore()) { <p class="hint">Alle bruikbare stuks zijn al afgerekend of gereserveerd in een conceptafrekening. Open de bestaande facturen hierboven.</p> }
        <div class="as__table-wrap">
          <table class="as__table">
            <thead><tr><th>Product</th><th class="num">Verkocht</th><th class="num">Netto opbrengst</th><th class="num">Kost</th><th class="num">Winst</th><th class="num">Ons deel</th></tr></thead>
            <tbody>
              @for (line of availableLines(); track line.productId) {
                @let split = splitOf(line);
                <tr>
                  <td class="as__product"><b>{{ line.name }}</b><small>{{ line.quantity | num }} stuks resterend · {{ unitCostOf(line) | eur: 4 }} / st kost</small></td>
                  <td class="num" data-label="Verkocht"><input class="input num right" type="number" min="0" step="1" inputmode="numeric" [attr.aria-label]="'Verkocht ' + line.name"
                                         [value]="soldOf(line)" [max]="line.quantity" [readOnly]="finalBatch()" (input)="setSold(line.productId, $any($event.target).value)" /></td>
                  <td class="num" data-label="Opbrengst"><span class="as__money"><i>€</i><input class="input num right" type="number" min="0" step="0.01" inputmode="decimal" [attr.aria-label]="'Netto opbrengst ' + line.name"
                                         [value]="proceedsEntered(line.productId) ? proceedsOf(line.productId) : ''" (input)="setProceeds(line.productId, $any($event.target).value)" /></span></td>
                  <td class="num" data-label="Kost">{{ split.cost | eur }}</td>
                  <td class="num" data-label="Winst" [class.is-bad]="split.profit < 0">{{ proceedsEntered(line.productId) ? (split.profit | eur) : '—' }}</td>
                  <td class="num as__ours" data-label="Ons deel">{{ proceedsEntered(line.productId) ? (split.ours | eur) : '—' }}</td>
                </tr>
              }
            </tbody>
            <tfoot>
              <tr>
                <th>Totaal</th>
                <th class="num">{{ soldTotal() | num }}</th>
                <th class="num">{{ totals().proceeds | eur }}</th>
                <th class="num">{{ totals().cost | eur }}</th>
                <th class="num" [class.is-bad]="totals().profit < 0">{{ totals().profit | eur }}</th>
                <th class="num as__ours">{{ totals().ours | eur }}</th>
              </tr>
            </tfoot>
          </table>
        </div>
        <dl class="as__sums">
          <div><dt>Externe kost in de verkoopwaarde</dt><dd>{{ allProceedsEntered() ? (totals().costPart | eur) : '—' }}</dd></div>
          <div><dt>Winstdeling · {{ profitShare() }} %</dt><dd>{{ allProceedsEntered() ? (totals().profitPart | eur) : '—' }}</dd></div>
          @if (purchaseOrderId()) { <div><dt>Voorschot voor deze veiling verrekenen</dt><dd>− {{ advanceDeduction() | eur }}</dd></div><div><dt>Na deze afrekening nog te verkopen</dt><dd>{{ preview()?.remainingQuantity ?? remainingBefore() | num }} stuks</dd></div> }
          <div class="as__sums-ours"><dt>{{ finalAmount() < 0 ? 'Credit voor de partner, excl. btw' : preview()?.finalSettlement ? 'Op de slotfactuur, excl. btw' : 'Op de deelfactuur, excl. btw' }}</dt><dd>{{ allProceedsEntered() ? (finalAmount() | eur) : '—' }}</dd></div>
        </dl>
        <div class="field">
          <label for="as-note">Interne notitie <span class="opt"></span></label>
          <input class="input" id="as-note" type="text" maxlength="200" placeholder="bijv. veiling Aalsmeer, week 38"
                 [value]="note()" (input)="note.set($any($event.target).value)" />
        </div>
      </div>
      <div foot style="display:contents">
        <span class="spacer"></span>
        <button class="btn" type="button" [disabled]="busy()" (click)="closed.emit()">Annuleren</button>
        <button class="btn btn--primary" type="button" [disabled]="busy() || !canCreate()" (click)="create()">{{ busy() ? 'Bezig…' : 'Veilingafrekening maken' }}</button>
      </div>
    </app-sheet>
  `,
  styles: `
    :host { display: contents; }
    .as { display: grid; gap: 12px; }
    .as__intro { margin: 0; color: var(--ink-2); font-size: 13px; line-height: 1.5; }
    .as__pct, .as__money { display: inline-flex; align-items: center; gap: 6px; }
    .as__pct .input { width: 96px; }
    .as__pct i, .as__money i { color: var(--muted); font-style: normal; font-size: 13px; }
    .as__money .input { width: 110px; }
    .as__table-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 12px; }
    .as__table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .as__table th, .as__table td { padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: middle; }
    .as__table thead th { color: var(--muted); font-size: 10px; font-weight: 750; letter-spacing: .05em; text-transform: uppercase; text-align: left; }
    .as__table .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .as__table td b { display: block; font-size: 13px; }
    .as__table td small { color: var(--muted); font-size: 11px; }
    .as__table td .input { width: 76px; min-height: 36px; }
    .as__table tfoot th { border-bottom: 0; background: var(--surface-2); font-weight: 700; }
    .as__ours { color: var(--rose-dark); font-weight: 750; }
    .is-bad { color: var(--danger); }
    @media (max-width: 719px) {
      .as__table thead, .as__table tfoot { display: none; }
      .as__table, .as__table tbody { display: block; }
      .as__table tr { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px 8px; padding: 10px 12px; border-bottom: 1px solid var(--line); }
      .as__table tr:last-child { border-bottom: 0; }
      .as__table td { display: block; padding: 0; border: 0; text-align: left !important; }
      .as__table td.as__product { grid-column: 1 / -1; }
      .as__table td[data-label]::before { content: attr(data-label); display: block; margin-bottom: 2px; color: var(--muted); font-size: 9.5px; font-weight: 750; letter-spacing: .05em; text-transform: uppercase; }
      .as__table td .input, .as__money .input { width: 100%; }
      .as__money { display: flex; }
    }
    .as__sums { display: grid; margin: 0; border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
    .as__sums > div { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 9px 12px; font-size: 13px; }
    .as__sums > div + div { border-top: 1px solid var(--line); }
    .as__sums dt { margin: 0; color: var(--muted); }
    .as__sums dd { margin: 0; font-variant-numeric: tabular-nums; font-weight: 600; }
    .as__sums-ours { background: var(--rose-soft); }
    .as__sums-ours dt { color: var(--rose-dark); font-weight: 650; }
    .as__sums-ours dd { color: var(--rose-dark); font-size: 15px; font-weight: 800; }
    .as__history{display:grid;gap:10px;padding:10px 0}.as__history a{display:grid;gap:3px;color:var(--rose-dark);font-size:12px}.as__history span{color:var(--muted);font-size:11px}
  `,
})
export class AuctionSettlementSheet {
  private readonly sales = inject(SalesApi);
  private readonly router = inject(Router);
  private readonly ui = inject(Ui);
  private readonly sourcing = inject(SourcingApi);
  readonly financing = signal<PartnerFinancing | null>(null);
  readonly availability = signal<PartnerSettlementAvailability | null>(null);
  readonly finalBatch = signal(false);
  readonly financingError = signal('');

  readonly lines = input.required<AuctionSheetLine[]>();
  /** The partner; null lets the sheet pick one from the partner customers. */
  readonly customerId = input<number | null>(null);
  readonly customerName = input('');
  readonly purchaseOrderId = input<number | null>(null);
  /** The container's number, for the invoice text. */
  readonly reference = input<string | null>(null);
  /** The cost document the partner paid, when there is one. */
  readonly sourceId = input<number | null>(null);
  readonly costSharePct = input(100);
  readonly profitSharePct = input(50);
  /** Inspection and other costs the container keeps apart from the piece price, per piece; the backend counts them the same way. */
  readonly separateUnitEur = input(0);
  readonly closed = output<void>();
  readonly funding = output<void>();

  readonly costShare = signal(100);
  readonly profitShare = signal(50);
  readonly note = signal('');
  readonly busy = signal(false);
  readonly chosenCustomer = signal<number | null>(null);
  readonly partners = signal<Customer[]>([]);
  readonly loadingCustomers = signal(false);
  private readonly proceeds = signal<Record<number, number>>({});
  private readonly sold = signal<Record<number, number>>({});

  readonly availableLines = computed<AuctionSheetLine[]>(() => this.purchaseOrderId() ? (this.availability()?.lines ?? []).filter((line) => line.remainingQuantity > 0).map((line) => ({ productId: line.productId, name: line.productName, quantity: line.remainingQuantity, landedUnitEur: line.remainingCostEur / line.remainingQuantity })) : this.lines());
  readonly remainingBefore = computed(() => this.availableLines().reduce((sum, line) => sum + line.quantity, 0));
  readonly preview = computed(() => this.availability() ? partialSettlementPreview(this.availability()!, Object.fromEntries(this.availableLines().map((line) => [line.productId, this.soldOf(line)])), this.proceeds(), this.profitShare()) : null);
  readonly totals = computed(() => auctionTotals(this.availableLines().map((line) => this.splitOf(line))));
  readonly soldTotal = computed(() => this.availableLines().reduce((sum, line) => sum + this.soldOf(line), 0));
  readonly allProceedsEntered = computed(() => this.soldTotal() > 0 && this.availableLines().filter((line) => this.soldOf(line) > 0).every((line) => this.proceedsEntered(line.productId)));
  readonly advanceDeduction = computed(() => this.preview()?.advanceEur ?? 0);
  readonly finalAmount = computed(() => this.preview()?.netEur ?? this.totals().ours);
  readonly hasPendingFunding = computed(() => !!this.availability() && !this.availability()!.settlements.length
    && ((this.financing()?.unbilledAdvanceCount ?? 0) > 0 || !!this.financing()?.documents.some((document) =>
      document.purpose === 'PARTNER_ADVANCE' && document.docType === 'FACTUUR' && document.status === 'CONCEPT')));
  readonly canCreate = computed(() => (this.customerId() !== null || this.chosenCustomer() !== null) && this.allProceedsEntered()
    && !this.hasPendingFunding()
    && (!this.purchaseOrderId() || (!!this.availability() && (!this.finalBatch() || !!this.preview()?.finalSettlement))));

  constructor() {
    queueMicrotask(() => {
      this.costShare.set(clampPct(this.costSharePct(), 100));
      this.profitShare.set(clampPct(this.profitSharePct(), 50));
      if (this.customerId() === null) void this.loadPartners();
      if (this.purchaseOrderId()) void this.loadFinancing();
    });
  }

  private async loadPartners(): Promise<void> {
    this.loadingCustomers.set(true);
    try {
      const customers = await this.sales.customers();
      this.partners.set(customers.filter((customer) => customer.partner && customer.id !== null));
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Klanten laden mislukt'), 'err');
    } finally {
      this.loadingCustomers.set(false);
    }
  }

  pickCustomer(value: string): void {
    const id = Number(value);
    this.chosenCustomer.set(Number.isFinite(id) && id > 0 ? id : null);
    const customer = this.partners().find((row) => row.id === id);
    if (customer) {
      this.profitShare.set(clampPct(customer.partnerSharePct ?? 50, 50));
      this.costShare.set(clampPct(100 - (customer.partnerCostPct ?? 100), 0));
    }
  }

  soldOf(line: AuctionSheetLine): number {
    return this.finalBatch() ? line.quantity : this.sold()[line.productId] ?? (this.purchaseOrderId() ? 0 : line.quantity);
  }

  setFinal(value: boolean): void { this.finalBatch.set(value); if (!value) this.sold.set({}); }

  async loadFinancing(): Promise<void> {
    try { const [financing, availability] = await Promise.all([this.sourcing.partnerFinancing(this.purchaseOrderId()!), this.sourcing.partnerSettlementAvailability(this.purchaseOrderId()!)]); this.financing.set(financing); this.profitShare.set(financing.profitSharePct); this.availability.set(availability); }
    catch (failure: unknown) { this.financingError.set(messageOf(failure, 'Financieringsafspraken laden mislukt. Sluit en open de afrekening opnieuw.')); }
  }

  proceedsEntered(productId: number): boolean { return Object.hasOwn(this.proceeds(), productId); }
  proceedsOf(productId: number): number {
    return this.proceeds()[productId] ?? 0;
  }

  /** What one piece cost us: landed, plus the inspection and other costs kept apart. */
  unitCostOf(line: AuctionSheetLine): number {
    return line.landedUnitEur + (this.availability() ? 0 : this.separateUnitEur());
  }

  splitOf(line: AuctionSheetLine) {
    const row = this.preview()?.rows.find((row) => row.productId === line.productId);
    if (row) return { cost: row.costEur, proceeds: row.proceedsEur, profit: row.profitEur, costPart: row.costEur, profitPart: row.profitShareEur, ours: row.revenueEur };
    return auctionLineSplit(this.soldOf(line), this.proceedsOf(line.productId), this.unitCostOf(line), this.purchaseOrderId() ? 100 : this.costShare(), this.profitShare());
  }

  setSold(productId: number, raw: string): void {
    const value = Math.floor(Number(String(raw).replace(',', '.')));
    const cap = this.availableLines().find((line) => line.productId === productId)?.quantity ?? 0;
    this.sold.update((current) => ({ ...current, [productId]: Number.isFinite(value) && value >= 0 ? Math.min(cap, value) : 0 }));
  }

  setProceeds(productId: number, raw: string): void {
    const value = Number(String(raw).replace(',', '.'));
    this.proceeds.update((current) => {
      const next = { ...current };
      if (!String(raw).trim() || !Number.isFinite(value) || value < 0) delete next[productId];
      else next[productId] = Math.round(value * 100) / 100;
      return next;
    });
  }

  setCostShare(raw: string): void {
    this.costShare.set(clampPct(Number(String(raw).replace(',', '.')), 0));
  }

  setProfitShare(raw: string): void {
    if (this.purchaseOrderId()) return;
    this.profitShare.set(clampPct(Number(String(raw).replace(',', '.')), 0));
  }

  async create(): Promise<void> {
    if (this.busy() || !this.canCreate()) return;
    this.busy.set(true);
    try {
      const created = await this.sales.createAuctionSettlement({
        finalSettlement: this.finalBatch(),
        customerId: this.customerId() ?? this.chosenCustomer(),
        purchaseOrderId: this.purchaseOrderId(),
        reference: this.reference(),
        sourceId: this.sourceId(),
        costSharePct: this.purchaseOrderId() ? 100 : this.costShare(),
        profitSharePct: this.profitShare(),
        lines: this.availableLines()
          .filter((line) => this.soldOf(line) > 0 && this.proceedsEntered(line.productId))
          /* The landed unit only: the backend adds the apart costs per piece itself. */
          .map((line) => ({ productId: line.productId, quantity: this.soldOf(line), proceedsEur: this.proceedsOf(line.productId), landedUnitCostEur: line.landedUnitEur })),
        note: this.note().trim() || null,
      });
      this.ui.toast(`Veilingafrekening ${created.order.number} gemaakt: ${this.finalAmount().toLocaleString('nl-BE', { style: 'currency', currency: 'EUR' })}`, 'ok');
      this.closed.emit();
      await this.router.navigate(['/sales', created.order.id, 'edit']);
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Veilingafrekening maken mislukt'), 'err');
    } finally {
      this.busy.set(false);
    }
  }
}

function clampPct(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : fallback;
}
