import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, output, signal } from '@angular/core';
import { Router } from '@angular/router';
import { messageOf } from '../../core/api/errors';
import { Customer, PurchaseOrder } from '../../core/api/models';
import { SalesApi } from '../../core/api/sales-api';
import { EurPipe, NumPipe } from '../../shared/pipes';
import { Sheet, Ui } from '../../shared/ui';

/** One product line of the container as it will land on the quote. */
export interface PurchaseQuoteLine {
  productId: number;
  name: string;
  quantity: number;
  /** What one piece of this container cost us landed, freight and duties included; null when unknown. */
  landedUnitEur: number | null;
}

/** A cost of the container that can travel to the quote as a line of its own. */
export interface PurchaseQuoteCost {
  key: string;
  description: string;
  amountEur: number;
}

export type PurchaseQuotePricing = 'CUSTOMER' | 'COST';

/**
 * A container becomes an offer: pick the customer, and a new sales quote
 * opens with every product line and its pieces already on it. Prices are
 * the customer's own; the container only lends the products and numbers.
 */
@Component({
  selector: 'app-purchase-quote-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet, NumPipe, EurPipe],
  template: `
    <app-sheet title="Verkoopofferte maken" (closed)="closed.emit()">
      <div body class="pq">
        <p class="pq__intro">Alle {{ lines().length }} productregels van {{ order().number }} gaan mee met dezelfde aantallen.
          Prijzen en korting volgen de klant; de offerte opent meteen om bij te sturen.</p>
        <div class="pq__pick">
          <label class="pq__search">
            <span class="sr-only">Klant zoeken</span>
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>
            <input class="input" type="search" autocomplete="off" autofocus
                   [value]="query()" [disabled]="loading()"
                   [placeholder]="loading() ? 'Klanten laden…' : 'Zoek op naam, plaats, land of btw-nummer'"
                   (input)="query.set($any($event.target).value)"
                   (keydown.enter)="$event.preventDefault(); chooseFirst()" />
          </label>
          @if (loadError(); as error) {
            <p class="pq__error">{{ error }} <button class="linklike" type="button" (click)="load()">Opnieuw</button></p>
          } @else {
            <div class="pq__list" role="listbox" aria-label="Klanten">
              @for (customer of visible(); track customer.id) {
                <button class="pq__customer" type="button" role="option"
                        [class.pq__customer--on]="chosen() === customer.id"
                        [attr.aria-selected]="chosen() === customer.id"
                        (click)="chosen.set(customer.id)">
                  <span class="pq__flag" aria-hidden="true">{{ flag(customer.countryCode) }}</span>
                  <span class="pq__who"><b>{{ customer.company }}</b><small>{{ where(customer) }}</small></span>
                  <i aria-hidden="true">{{ chosen() === customer.id ? '✓' : '' }}</i>
                </button>
              } @empty {
                <p class="pq__empty-list">{{ loading() ? 'Klanten laden…' : query() ? 'Geen klant gevonden voor "' + query() + '"' : 'Nog geen klanten' }}</p>
              }
              @if (hidden() > 0) {
                <p class="pq__more">Nog {{ hidden() }} klanten · zoek verder om ze te zien</p>
              }
            </div>
          }
          @if (chosenCustomer(); as customer) {
            <p class="pq__chosen">Offerte voor <b>{{ customer.company }}</b> · {{ customer.incoterm || 'DAP' }}@if (customer.language) { · {{ customer.language }} }</p>
          }
        </div>
        <div class="pq__pricing">
          <div class="per-toggle" role="group" aria-label="Prijzen op de offerte">
            <button type="button" [class.on]="pricing() === 'CUSTOMER'" (click)="pricing.set('CUSTOMER')">Klantprijzen</button>
            <button type="button" [class.on]="pricing() === 'COST'" [disabled]="!costKnown()" (click)="pricing.set('COST')">Kostprijs van deze container</button>
          </div>
          @if (pricing() === 'COST') {
            <p class="pq__hint">Elke regel op de gelande kost per stuk van deze container, vracht en rechten inbegrepen. Inspectie en andere kosten gaan als aparte regels mee; alles blijft op de offerte aanpasbaar.</p>
            <div class="pq__markup">
              <label for="pq-markup">Opslag op de kostprijs</label>
              <span class="pq__markup-field"><input class="input num right" id="pq-markup" type="number" min="0" step="0.5" inputmode="decimal"
                     [value]="markupPct()" (input)="setMarkup($any($event.target).value)" /><i>%</i></span>
            </div>
            @if (costs().length) {
              <div class="pq__costs" role="group" aria-label="Aparte kosten van de container">
                @for (cost of costs(); track cost.key) {
                  <label class="pq__cost">
                    <input type="checkbox" [checked]="includedCosts().has(cost.key)" (change)="toggleCost(cost.key)" />
                    <span>{{ cost.description }}</span><b>{{ cost.amountEur | eur }}</b>
                  </label>
                }
              </div>
            }
          } @else if (!costKnown()) {
            <p class="pq__hint">De kostprijs per stuk is nog niet bekend voor elke regel; reken de calculatie eerst door om aan kostprijs te kunnen offreren.</p>
          }
        </div>
        <ul class="pq__lines" aria-label="Regels die meegaan">
          @for (line of lines(); track line.productId) {
            <li>
              <span>{{ line.name }}</span>
              <b>{{ line.quantity | num }} st.@if (pricing() === 'COST' && line.landedUnitEur !== null) { · {{ unitPrice(line) | eur }} / st }</b>
            </li>
          } @empty {
            <li class="pq__empty">Deze container heeft nog geen productregels.</li>
          }
          @if (pricing() === 'COST') {
            @for (cost of chosenCosts(); track cost.key) {
              <li class="pq__extra"><span>{{ cost.description }}</span><b>{{ cost.amountEur | eur }}</b></li>
            }
            <li class="pq__total"><span>Goederen en aparte kosten, excl. btw en levering</span><b>{{ previewTotal() | eur }}</b></li>
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
    .pq__pick { display: grid; gap: 8px; }
    .pq__search { position: relative; display: block; }
    .pq__search svg { position: absolute; left: 12px; top: 50%; width: 17px; height: 17px; transform: translateY(-50%); fill: none; stroke: var(--muted); stroke-width: 1.8; pointer-events: none; }
    .pq__search .input { min-height: 46px; padding-left: 38px; font-size: 15px; }
    .pq__list { display: grid; max-height: 38dvh; overflow-y: auto; overscroll-behavior: contain; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); }
    .pq__customer { display: grid; grid-template-columns: 26px minmax(0, 1fr) 20px; align-items: center; gap: 10px; width: 100%; min-height: 50px; padding: 8px 12px; border: 0; border-bottom: 1px solid var(--line); background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
    .pq__customer:last-of-type { border-bottom: 0; }
    .pq__customer:hover { background: var(--surface-2); }
    .pq__customer--on { background: var(--rose-soft); box-shadow: inset 3px 0 0 var(--rose); }
    .pq__flag { font-size: 18px; text-align: center; }
    .pq__who { display: grid; min-width: 0; }
    .pq__who b { overflow: hidden; font-size: 14px; text-overflow: ellipsis; white-space: nowrap; }
    .pq__who small { overflow: hidden; color: var(--muted); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
    .pq__customer i { color: var(--rose-dark); font-style: normal; font-weight: 700; text-align: center; }
    .pq__empty-list, .pq__more { margin: 0; padding: 12px; color: var(--muted); font-size: 13px; }
    .pq__more { border-top: 1px dashed var(--line); font-size: 12px; }
    .pq__chosen { margin: 0; color: var(--ink-2); font-size: 13px; }
    .pq__lines { display: grid; max-height: 40dvh; margin: 0; padding: 0; overflow-y: auto; list-style: none; border: 1px solid var(--line); border-radius: 12px; }
    .pq__lines li { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 9px 12px; font-size: 13px; }
    .pq__lines li + li { border-top: 1px solid var(--line); }
    .pq__lines li span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pq__lines b { flex: none; font-variant-numeric: tabular-nums; }
    .pq__empty { color: var(--muted); }
    .pq__pricing { display: grid; gap: 10px; }
    .pq__hint { margin: 0; color: var(--muted); font-size: 12.5px; line-height: 1.5; }
    .pq__markup { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 13px; }
    .pq__markup-field { display: inline-flex; align-items: center; gap: 6px; }
    .pq__markup-field .input { width: 84px; min-height: 40px; }
    .pq__markup-field i { color: var(--muted); font-style: normal; }
    .pq__costs { display: grid; gap: 6px; }
    .pq__cost { display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 10px; font-size: 13px; cursor: pointer; }
    .pq__cost input { width: 18px; height: 18px; accent-color: var(--rose); }
    .pq__cost span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pq__cost b { font-variant-numeric: tabular-nums; }
    .pq__extra span { color: var(--ink-2); font-style: italic; }
    .pq__total { background: var(--surface-2); font-weight: 700; }
    .pq__total span { color: var(--muted); font-size: 12px; font-weight: 600; white-space: normal; }
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
  readonly query = signal('');
  readonly pricing = signal<PurchaseQuotePricing>('CUSTOMER');
  readonly markupPct = signal(0);

  /** Cost pricing needs a landed cost on every line; a half-calculated container cannot be passed on. */
  readonly costKnown = computed(() => this.lines().length > 0 && this.lines().every((line) => line.landedUnitEur !== null));
  /** The container's separate costs: inspection and the named others, each a line of its own. */
  readonly costs = computed<PurchaseQuoteCost[]>(() => {
    const order = this.order();
    const suffix = ` · ${order.number}`;
    const costs: PurchaseQuoteCost[] = [];
    if ((order.inspectionCostEur ?? 0) > 0) costs.push({ key: 'inspection', description: `Inspectie${suffix}`, amountEur: order.inspectionCostEur! });
    (order.otherCosts ?? []).forEach((cost, index) => {
      const amount = cost.amountEur ?? 0;
      if (!cost.label?.trim() || !(amount > 0)) return;
      costs.push({ key: `other-${index}`, description: `${cost.label.trim()}${suffix}`, amountEur: amount });
    });
    return costs;
  });
  /* Every separate cost travels along unless it is ticked off; a new container resets the ticks. */
  readonly includedCosts = linkedSignal<ReadonlySet<string>>(() => new Set(this.costs().map((cost) => cost.key)));
  readonly chosenCosts = computed(() => this.costs().filter((cost) => this.includedCosts().has(cost.key)));
  readonly previewTotal = computed(() => this.lines().reduce((sum, line) => sum + this.unitPrice(line) * line.quantity, 0)
    + this.chosenCosts().reduce((sum, cost) => sum + cost.amountEur, 0));

  /** Every customer the search matches, the chosen one always among them. */
  readonly matches = computed(() => {
    const needle = normalise(this.query());
    const chosen = this.chosen();
    return this.customers().filter((customer) => customer.id === chosen || !needle
      || normalise([customer.company, customer.city, customer.countryCode, this.countryName(customer.countryCode),
        customer.vatNumber, customer.contact, customer.email].filter(Boolean).join(' ')).includes(needle));
  });
  readonly visible = computed(() => this.matches().slice(0, SHOWN));
  readonly hidden = computed(() => Math.max(0, this.matches().length - SHOWN));
  readonly chosenCustomer = computed(() => this.customers().find((row) => row.id === this.chosen()) ?? null);
  private readonly regionNames = new Intl.DisplayNames(['nl'], { type: 'region' });

  constructor() {
    void this.load();
  }

  setMarkup(raw: string): void {
    const value = Number(String(raw).replace(',', '.'));
    this.markupPct.set(Number.isFinite(value) && value >= 0 ? value : 0);
  }

  toggleCost(key: string): void {
    this.includedCosts.update((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /** The line's price at cost: the container's landed cost per piece plus the chosen markup. */
  unitPrice(line: PurchaseQuoteLine): number {
    if (line.landedUnitEur === null) return 0;
    return Math.round(line.landedUnitEur * (1 + this.markupPct() / 100) * 100) / 100;
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

  /** Enter in the search box takes the first match: one hit, one key. */
  chooseFirst(): void {
    const first = this.visible()[0];
    if (first && first.id !== null) this.chosen.set(first.id);
  }

  where(customer: Customer): string {
    return [customer.city, this.countryName(customer.countryCode), customer.vatNumber].filter(Boolean).join(' · ');
  }

  countryName(code: string | null | undefined): string {
    if (!code) return '';
    try { return this.regionNames.of(code.toUpperCase()) ?? code; } catch { return code; }
  }

  flag(code: string | null | undefined): string {
    if (!code || code.length !== 2) return '🏳';
    return [...code.toUpperCase()].map((letter) => String.fromCodePoint(127397 + letter.charCodeAt(0))).join('');
  }

  /** Creates the quote for the customer, puts every line on it, and opens it. */
  async create(): Promise<void> {
    const customer = this.customers().find((row) => row.id === this.chosen());
    if (!customer || customer.id === null || this.busy()) return;
    this.busy.set(true);
    try {
      const created = await this.sales.createOrder(customer.id, customer.countryCode, customer.incoterm || 'DAP', 'OFFERTE');
      const atCost = this.pricing() === 'COST' && this.costKnown();
      const extraLines = atCost ? this.chosenCosts().map((cost) => ({ description: cost.description, quantity: 1, unitPriceEur: cost.amountEur })) : [];
      const filled = await this.sales.updateOrder(created.order.id, {
        ...created.order,
        lines: this.lines().map((line) => ({
          id: null, productId: line.productId, quantity: line.quantity,
          unitPriceEur: atCost ? this.unitPrice(line) : null, manualDiscountPct: null, deliveryWeek: null,
        })),
        extraLines,
      });
      const count = this.lines().length + extraLines.length;
      this.ui.toast(`Offerte ${filled.order.number} gemaakt met ${count} regel${count === 1 ? '' : 's'}${atCost ? ' aan kostprijs' : ''}`, 'ok');
      this.closed.emit();
      await this.router.navigate(['/sales', filled.order.id, 'edit']);
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Offerte maken mislukt'), 'err');
    } finally {
      this.busy.set(false);
    }
  }
}

/** Rows shown before the list asks for a narrower search. */
const SHOWN = 40;

function normalise(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('nl-BE').trim();
}
