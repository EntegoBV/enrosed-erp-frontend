import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { Router } from '@angular/router';
import { messageOf } from '../../core/api/errors';
import { Customer, PurchaseOrder } from '../../core/api/models';
import { SalesApi } from '../../core/api/sales-api';
import { NumPipe } from '../../shared/pipes';
import { Sheet, Ui } from '../../shared/ui';

/** One product line of the container as it will land on the quote. */
export interface PurchaseQuoteLine {
  productId: number;
  name: string;
  quantity: number;
}

/**
 * A container becomes an offer: pick the customer, and a new sales quote
 * opens with every product line and its pieces already on it. Prices are
 * the customer's own; the container only lends the products and numbers.
 */
@Component({
  selector: 'app-purchase-quote-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet, NumPipe],
  template: `
    <app-sheet title="Verkoopofferte maken" (closed)="closed.emit()">
      <div body class="pq">
        <p class="pq__intro">Alle {{ lines().length }} productregels van {{ order().number }} gaan mee met dezelfde aantallen.
          Prijzen en korting volgen de klant; de offerte opent meteen om bij te sturen.</p>
        <div class="field">
          <label class="req" for="pq-customer">Klant</label>
          @if (loadError(); as error) {
            <p class="pq__error">{{ error }} <button class="linklike" type="button" (click)="load()">Opnieuw</button></p>
          } @else {
            <select class="select" id="pq-customer" [disabled]="loading()" (change)="choose($any($event.target).value)">
              <option value="">{{ loading() ? 'Klanten laden…' : 'Kies een klant' }}</option>
              @for (customer of customers(); track customer.id) {
                <option [value]="customer.id" [selected]="chosen() === customer.id">{{ customer.company }}@if (customer.countryCode) { · {{ customer.countryCode }} }</option>
              }
            </select>
          }
        </div>
        <ul class="pq__lines" aria-label="Productregels die meegaan">
          @for (line of lines(); track line.productId) {
            <li><span>{{ line.name }}</span><b>{{ line.quantity | num }} st.</b></li>
          } @empty {
            <li class="pq__empty">Deze container heeft nog geen productregels.</li>
          }
        </ul>
      </div>
      <div foot style="display:contents">
        <span class="spacer"></span>
        <button class="btn" type="button" [disabled]="busy()" (click)="closed.emit()">Annuleren</button>
        <button class="btn btn--primary" type="button" [disabled]="busy() || chosen() === null || !lines().length"
                (click)="create()">{{ busy() ? 'Bezig…' : 'Offerte maken' }}</button>
      </div>
    </app-sheet>
  `,
  styles: `
    :host { display: contents; }
    .pq { display: grid; gap: 14px; }
    .pq__intro { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.5; }
    .pq__error { margin: 0; color: var(--danger); font-size: 13px; }
    .pq__lines { display: grid; max-height: 40dvh; margin: 0; padding: 0; overflow-y: auto; list-style: none; border: 1px solid var(--line); border-radius: 12px; }
    .pq__lines li { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 9px 12px; font-size: 13px; }
    .pq__lines li + li { border-top: 1px solid var(--line); }
    .pq__lines li span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pq__lines b { flex: none; font-variant-numeric: tabular-nums; }
    .pq__empty { color: var(--muted); }
  `,
})
export class PurchaseQuoteSheet {
  private readonly sales = inject(SalesApi);
  private readonly router = inject(Router);
  private readonly ui = inject(Ui);

  readonly order = input.required<PurchaseOrder>();
  readonly lines = input<PurchaseQuoteLine[]>([]);
  readonly closed = output<void>();

  readonly customers = signal<Customer[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly chosen = signal<number | null>(null);
  readonly busy = signal(false);

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const customers = await this.sales.customers();
      this.customers.set([...customers].sort((left, right) => left.company.localeCompare(right.company, 'nl')));
    } catch (failure: unknown) {
      this.loadError.set(messageOf(failure, 'Klanten laden mislukt'));
    } finally {
      this.loading.set(false);
    }
  }

  choose(value: string): void {
    const id = Number(value);
    this.chosen.set(Number.isInteger(id) && id > 0 ? id : null);
  }

  /** Creates the quote for the customer, puts every line on it, and opens it. */
  async create(): Promise<void> {
    const customer = this.customers().find((row) => row.id === this.chosen());
    if (!customer || customer.id === null || this.busy()) return;
    this.busy.set(true);
    try {
      const created = await this.sales.createOrder(customer.id, customer.countryCode, customer.incoterm || 'DAP', 'OFFERTE');
      const filled = await this.sales.updateOrder(created.order.id, {
        ...created.order,
        lines: this.lines().map((line) => ({
          id: null, productId: line.productId, quantity: line.quantity,
          unitPriceEur: null, manualDiscountPct: null, deliveryWeek: null,
        })),
      });
      this.ui.toast(`Offerte ${filled.order.number} gemaakt met ${this.lines().length} regel${this.lines().length === 1 ? '' : 's'}`, 'ok');
      this.closed.emit();
      await this.router.navigate(['/sales', filled.order.id, 'edit']);
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Offerte maken mislukt'), 'err');
    } finally {
      this.busy.set(false);
    }
  }
}
