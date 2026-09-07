import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { Router } from '@angular/router';
import { messageOf } from '../../core/api/errors';
import { Customer } from '../../core/api/models';
import { SalesApi } from '../../core/api/sales-api';
import { EurPipe, NumPipe } from '../../shared/pipes';
import { Sheet, Ui } from '../../shared/ui';
import { auctionLineSplit, auctionTotals } from './partner-settlement';

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
  imports: [Sheet, EurPipe, NumPipe],
  template: `
    <app-sheet title="Veilingafrekening maken" (closed)="closed.emit()">
      <div body class="as">
        <p class="as__intro">Vul per product in wat het op de veiling opbracht, uit het overzicht van {{ customerName() || 'de partner' }}@if (reference()) { voor container {{ reference() }} }.
          Per product rekenen we het deel van de gelande kost dat wij financierden terug en nemen we ons deel van de winst; de factuur draagt de producten zelf, zodat de voorraad en de marge kloppen.</p>
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
          <div class="field">
            <label for="as-cost">Deel van de kost dat wij terugvragen</label>
            <span class="as__pct"><input class="input num right" id="as-cost" type="number" min="0" max="100" step="5" inputmode="decimal"
                   [value]="costShare()" (input)="setCostShare($any($event.target).value)" /><i>%</i></span>
            <span class="hint">Wat de partner nog niet betaalde van de gelande kost.</span>
          </div>
          <div class="field">
            <label for="as-profit">Ons deel van de winst</label>
            <span class="as__pct"><input class="input num right" id="as-profit" type="number" min="0" max="100" step="0.5" inputmode="decimal"
                   [value]="profitShare()" (input)="setProfitShare($any($event.target).value)" /><i>%</i></span>
            <span class="hint">Op de winst boven de volledige gelande kost.</span>
          </div>
        </div>
        <div class="as__table-wrap">
          <table class="as__table">
            <thead><tr><th>Product</th><th class="num">Verkocht</th><th class="num">Opbrengst</th><th class="num">Kost</th><th class="num">Winst</th><th class="num">Ons deel</th></tr></thead>
            <tbody>
              @for (line of lines(); track line.productId) {
                @let split = splitOf(line);
                <tr>
                  <td class="as__product"><b>{{ line.name }}</b><small>{{ line.landedUnitEur | eur: 4 }} / st geland</small></td>
                  <td class="num" data-label="Verkocht"><input class="input num right" type="number" min="0" step="1" inputmode="numeric" [attr.aria-label]="'Verkocht ' + line.name"
                                         [value]="soldOf(line)" (input)="setSold(line.productId, $any($event.target).value)" /></td>
                  <td class="num" data-label="Opbrengst"><span class="as__money"><i>€</i><input class="input num right" type="number" min="0" step="0.01" inputmode="decimal" [attr.aria-label]="'Opbrengst ' + line.name"
                                         [value]="proceedsOf(line.productId) || ''" (input)="setProceeds(line.productId, $any($event.target).value)" /></span></td>
                  <td class="num" data-label="Kost">{{ split.cost | eur }}</td>
                  <td class="num" data-label="Winst" [class.is-bad]="split.profit < 0">{{ proceedsOf(line.productId) > 0 ? (split.profit | eur) : '—' }}</td>
                  <td class="num as__ours" data-label="Ons deel">{{ proceedsOf(line.productId) > 0 ? (split.ours | eur) : '—' }}</td>
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
          <div><dt>Kost terug · {{ costShare() }} %</dt><dd>{{ totals().proceeds > 0 ? (totals().costPart | eur) : '—' }}</dd></div>
          <div><dt>Winstdeling · {{ profitShare() }} %</dt><dd>{{ totals().proceeds > 0 ? (totals().profitPart | eur) : '—' }}</dd></div>
          <div class="as__sums-ours"><dt>Op de factuur, excl. btw</dt><dd>{{ totals().proceeds > 0 ? (totals().ours | eur) : '—' }}</dd></div>
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
  `,
})
export class AuctionSettlementSheet {
  private readonly sales = inject(SalesApi);
  private readonly router = inject(Router);
  private readonly ui = inject(Ui);

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
  readonly closed = output<void>();

  readonly costShare = signal(100);
  readonly profitShare = signal(50);
  readonly note = signal('');
  readonly busy = signal(false);
  readonly chosenCustomer = signal<number | null>(null);
  readonly partners = signal<Customer[]>([]);
  readonly loadingCustomers = signal(false);
  private readonly proceeds = signal<Record<number, number>>({});
  private readonly sold = signal<Record<number, number>>({});

  readonly totals = computed(() => auctionTotals(this.lines().map((line) => this.splitOf(line))));
  readonly soldTotal = computed(() => this.lines().reduce((sum, line) => sum + this.soldOf(line), 0));
  readonly canCreate = computed(() => (this.customerId() !== null || this.chosenCustomer() !== null)
    && this.lines().some((line) => this.soldOf(line) > 0 && this.proceedsOf(line.productId) > 0));

  constructor() {
    queueMicrotask(() => {
      this.costShare.set(clampPct(this.costSharePct(), 100));
      this.profitShare.set(clampPct(this.profitSharePct(), 50));
      if (this.customerId() === null) void this.loadPartners();
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
    return this.sold()[line.productId] ?? line.quantity;
  }

  proceedsOf(productId: number): number {
    return this.proceeds()[productId] ?? 0;
  }

  splitOf(line: AuctionSheetLine) {
    return auctionLineSplit(this.soldOf(line), this.proceedsOf(line.productId), line.landedUnitEur, this.costShare(), this.profitShare());
  }

  setSold(productId: number, raw: string): void {
    const value = Math.floor(Number(String(raw).replace(',', '.')));
    this.sold.update((current) => ({ ...current, [productId]: Number.isFinite(value) && value >= 0 ? value : 0 }));
  }

  setProceeds(productId: number, raw: string): void {
    const value = Number(String(raw).replace(',', '.'));
    this.proceeds.update((current) => ({ ...current, [productId]: Number.isFinite(value) && value > 0 ? value : 0 }));
  }

  setCostShare(raw: string): void {
    this.costShare.set(clampPct(Number(String(raw).replace(',', '.')), 0));
  }

  setProfitShare(raw: string): void {
    this.profitShare.set(clampPct(Number(String(raw).replace(',', '.')), 0));
  }

  async create(): Promise<void> {
    if (this.busy() || !this.canCreate()) return;
    this.busy.set(true);
    try {
      const created = await this.sales.createAuctionSettlement({
        customerId: this.customerId() ?? this.chosenCustomer(),
        purchaseOrderId: this.purchaseOrderId(),
        reference: this.reference(),
        sourceId: this.sourceId(),
        costSharePct: this.costShare(),
        profitSharePct: this.profitShare(),
        lines: this.lines()
          .filter((line) => this.soldOf(line) > 0 && this.proceedsOf(line.productId) > 0)
          .map((line) => ({ productId: line.productId, quantity: this.soldOf(line), proceedsEur: this.proceedsOf(line.productId), landedUnitCostEur: line.landedUnitEur })),
        note: this.note().trim() || null,
      });
      this.ui.toast(`Veilingafrekening ${created.order.number} gemaakt: ${this.totals().ours.toLocaleString('nl-BE', { style: 'currency', currency: 'EUR' })}`, 'ok');
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
