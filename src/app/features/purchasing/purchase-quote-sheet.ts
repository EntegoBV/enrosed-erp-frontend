import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, output, signal } from '@angular/core';
import { Router } from '@angular/router';
import { messageOf } from '../../core/api/errors';
import { Customer, PurchaseOrder } from '../../core/api/models';
import { SalesApi } from '../../core/api/sales-api';
import { EurPipe, NumPipe, EurUpPipe, NumUpPipe } from '../../shared/pipes';
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
  imports: [Sheet, NumPipe, EurPipe, EurUpPipe, NumUpPipe],
  template: `
    <app-sheet title="Verkoopofferte maken" (closed)="closed.emit()">
      <div body class="pq">
        <p class="pq__intro">Alle {{ lines().length }} productregels van {{ order().number }} gaan mee met dezelfde aantallen.
          @if (partnersOnly()) { Een partner rekent aan onze kostprijs van deze container; een andere klant krijgt zijn eigen prijzen. } @else { Prijzen en korting volgen de klant; de offerte opent meteen om bij te sturen. }</p>
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
          @if (partnerCustomers().length) {
            <div class="pq__scope" role="group" aria-label="Welke klanten">
              <button type="button" [class.on]="!showAll()" (click)="showAll.set(false)">Partners <small>{{ partnerCustomers().length }}</small></button>
              <button type="button" [class.on]="showAll()" (click)="showAll.set(true)">Alle klanten <small>{{ customers().length }}</small></button>
            </div>
          }
          @if (loadError(); as error) {
            <p class="pq__error">{{ error }} <button class="linklike" type="button" (click)="load()">Opnieuw</button></p>
          } @else {
            <div class="pq__list" role="listbox" aria-label="Klanten">
              @for (customer of visible(); track customer.id) {
                <button class="pq__customer" type="button" role="option"
                        [class.pq__customer--on]="chosen() === customer.id"
                        [attr.aria-selected]="chosen() === customer.id"
                        (click)="choose(customer)">
                  <span class="pq__flag" aria-hidden="true">{{ flag(customer.countryCode) }}</span>
                  <span class="pq__who"><b>{{ customer.company }}@if (customer.partner) { <em class="pq__partner-tag">partner</em> }</b><small>{{ where(customer) }}</small></span>
                  <i aria-hidden="true">{{ chosen() === customer.id ? '✓' : '' }}</i>
                </button>
              } @empty {
                <p class="pq__empty-list">{{ loading() ? 'Klanten laden…' : query() ? 'Geen klant gevonden voor "' + query() + '"' : partnersOnly() ? 'Nog geen partnerklanten' : 'Nog geen klanten' }}</p>
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
            <p class="pq__hint">Elke regel op de gelande kost per stuk van deze container: fabrieksprijs, zeevracht, invoerrechten en handling, tot op de cent zoals op de inkooporder. Inspectie en andere kosten zitten in die stukprijs. De vracht op de offerte staat op nul, want die zit al in de kost.</p>
            <div class="pq__markup">
              <label for="pq-markup">Opslag op de kostprijs</label>
              <span class="pq__markup-field"><input class="input num right" id="pq-markup" type="number" min="0" step="0.5" inputmode="decimal"
                     [value]="markupPct()" (input)="setMarkup($any($event.target).value)" /><i>%</i></span>
            </div>
            <div class="pq__partner">
              <label class="pq__partner-toggle">
                <input type="checkbox" [checked]="partner()" (change)="partner.set($any($event.target).checked)" />
                <span><b>Partnercontainer</b><small>De klant bestelt de container mee en verkoopt de goederen door; na de veiling maken we een slotfactuur voor ons deel van de winst.</small></span>
              </label>
              @if (partner()) {
                <div class="pq__markup">
                  <label for="pq-share">Ons deel van de winst na de veiling</label>
                  <span class="pq__markup-field"><input class="input num right" id="pq-share" type="number" min="0" max="100" step="0.5" inputmode="decimal"
                         [value]="sharePct()" (input)="setShare($any($event.target).value)" /><i>%</i></span>
                </div>
                <div class="pq__markup">
                  <label for="pq-cost">Deel van de kost dat de partner nu betaalt</label>
                  <span class="pq__markup-field">
                    <span class="pq__quick" role="group" aria-label="Snel kiezen">
                      <button type="button" [class.on]="costPct() === 100" (click)="setCost('100')">100</button>
                      <button type="button" [class.on]="costPct() === 50" (click)="setCost('50')">50</button>
                      <button type="button" [class.on]="costPct() === 0" (click)="setCost('0')">0</button>
                    </span>
                    <input class="input num right" id="pq-cost" type="number" min="0" max="100" step="5" inputmode="decimal"
                           [value]="costPct()" (input)="setCost($any($event.target).value)" /><i>%</i></span>
                </div>
                <p class="pq__hint">@if (costPct() === 0) { Wij financieren de container; de kost en onze winst rekenen we na de veiling af. } @else if (costPct() < 100) { De rest van de kost en onze winst volgen in de veilingafrekening. } @else { De partner betaalt de container vooraf; na de veiling volgt enkel onze winstdeling. }</p>
              }
            </div>
            @if (separateCostsEur() > 0) {
              <p class="pq__hint">Inspectie en andere kosten ({{ separateCostsEur() | eur }}) zitten in de kostprijs per stuk verdeeld.</p>
            }
          } @else if (!costKnown()) {
            <p class="pq__hint">De kostprijs per stuk is nog niet bekend voor elke regel; reken de calculatie eerst door om aan kostprijs te kunnen offreren.</p>
          }
        </div>
        <ul class="pq__lines" aria-label="Regels die meegaan">
          @for (line of lines(); track line.productId) {
            <li>
              <span>{{ line.name }}</span>
              <b>{{ line.quantity | num }} st.@if (pricing() === 'COST' && line.landedUnitEur !== null) { · {{ unitPrice(line) | eurUp: 3 }} / st }</b>
            </li>
          } @empty {
            <li class="pq__empty">Deze container heeft nog geen productregels.</li>
          }
          @if (pricing() === 'COST') {
            <li class="pq__total"><span>Goederen aan gelande kostprijs, excl. btw en levering</span><b>{{ previewTotal() | eur }}</b></li>
          }
        </ul>
      </div>
      <div foot style="display:contents">
        @if (createError(); as error) { <p class="pq__error pq__error--foot" role="alert">{{ error }}</p> }
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
    .pq__error--foot { flex: 1 1 100%; padding: 8px 10px; border: 1px solid color-mix(in srgb, var(--danger) 30%, var(--line)); border-radius: 10px; background: color-mix(in srgb, var(--danger) 8%, var(--surface)); }
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
    .pq__scope { display: inline-flex; gap: 2px; padding: 3px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface-2); }
    .pq__scope button { display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; border: 0; border-radius: 999px; background: transparent; color: var(--muted); font: inherit; font-size: 12.5px; font-weight: 650; cursor: pointer; }
    .pq__scope button.on { background: var(--surface); color: var(--ink); box-shadow: var(--sh-1); }
    .pq__scope small { padding: 0 6px; border-radius: 999px; background: var(--rose-soft); color: var(--rose-dark); font-size: 10.5px; font-weight: 750; }
    .pq__partner-tag { margin-left: 6px; padding: 1px 6px; border-radius: 999px; background: var(--rose-soft); color: var(--rose-dark); font-size: 10px; font-style: normal; font-weight: 750; letter-spacing: .03em; text-transform: uppercase; vertical-align: middle; }
    .pq__quick { display: inline-flex; gap: 2px; padding: 2px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface); }
    .pq__quick button { min-width: 34px; padding: 4px 8px; border: 0; border-radius: 999px; background: transparent; color: var(--muted); font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; }
    .pq__quick button.on { background: var(--rose); color: #fff; }
    .pq__partner { display: grid; gap: 8px; padding: 10px 12px; border: 1px solid var(--rose-line); border-radius: 12px; background: var(--rose-soft); }
    .pq__partner-toggle { display: grid; grid-template-columns: 22px minmax(0, 1fr); align-items: start; gap: 10px; cursor: pointer; }
    .pq__partner-toggle input { width: 18px; height: 18px; margin-top: 2px; accent-color: var(--rose); }
    .pq__partner-toggle span { display: grid; gap: 2px; font-size: 13px; }
    .pq__partner-toggle small { color: var(--ink-2); font-size: 12px; line-height: 1.4; }
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
  /** The container's own partner and deal: chosen the moment the sheet opens, so nobody has to search. */
  readonly presetCustomerId = input<number | null>(null);
  readonly presetCostPct = input<number | null>(null);
  readonly presetSharePct = input<number | null>(null);
  readonly closed = output<void>();

  readonly customers = signal<Customer[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly chosen = signal<number | null>(null);
  readonly busy = signal(false);
  readonly query = signal('');
  /** Why the last attempt was refused, shown next to the button until the next try. */
  readonly createError = signal<string | null>(null);
  readonly pricing = signal<PurchaseQuotePricing>('CUSTOMER');
  readonly markupPct = signal(0);
  /** A partner deal: the customer sponsors the container and shares the auction profit with us. */
  readonly partner = signal(false);
  readonly sharePct = signal(50);
  /** The part of the landed cost the partner pays on this quote; the rest is settled after the auction. */
  readonly costPct = signal(100);
  /** Whether the list shows every customer or only the partners. */
  readonly showAll = signal(false);
  readonly partnerCustomers = computed(() => this.customers().filter((customer) => customer.partner));
  readonly partnersOnly = computed(() => this.partnerCustomers().length > 0 && !this.showAll());

  /** Cost pricing needs a landed cost on every line; a half-calculated container cannot be passed on. */
  readonly costKnown = computed(() => this.lines().length > 0 && this.lines().every((line) => line.landedUnitEur !== null));
  /** The inspection and the named other costs; since they sit inside every landed piece price, nothing travels as a line of its own. */
  readonly costs = computed<PurchaseQuoteCost[]>(() => []);
  readonly separateCostsEur = computed(() => {
    const order = this.order();
    return (order.inspectionCostEur ?? 0) + (order.otherCosts ?? []).reduce((sum, cost) => sum + (cost.amountEur ?? 0), 0);
  });
  /* Every separate cost travels along unless it is ticked off; a new container resets the ticks. */
  readonly includedCosts = linkedSignal<ReadonlySet<string>>(() => new Set(this.costs().map((cost) => cost.key)));
  readonly chosenCosts = computed(() => this.costs().filter((cost) => this.includedCosts().has(cost.key)));
  readonly previewTotal = computed(() => this.lines().reduce((sum, line) => sum + this.unitPrice(line) * line.quantity, 0)
    + this.chosenCosts().reduce((sum, cost) => sum + this.costAmount(cost), 0));

  /** Every customer the search matches, the chosen one always among them. */
  readonly matches = computed(() => {
    const needle = normalise(this.query());
    const chosen = this.chosen();
    const pool = this.partnersOnly() ? this.partnerCustomers() : this.customers();
    return pool.filter((customer) => customer.id === chosen || !needle
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

  /** A customer is chosen: a partner switches the sheet to cost pricing with their own agreement. */
  choose(customer: Customer): void {
    if (customer.id === null) return;
    this.chosen.set(customer.id);
    if (customer.partner) {
      this.partner.set(true);
      this.sharePct.set(customer.partnerSharePct ?? 50);
      this.costPct.set(customer.partnerCostPct ?? 100);
      if (this.costKnown()) this.pricing.set('COST');
    } else {
      this.partner.set(false);
      this.pricing.set('CUSTOMER');
    }
  }

  setCost(raw: string): void {
    const value = Number(String(raw).replace(',', '.'));
    this.costPct.set(Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 100);
  }

  /** The partner's part of a separate cost, on this quote. */
  costAmount(cost: PurchaseQuoteCost): number {
    const share = this.partner() ? this.costPct() / 100 : 1;
    return Math.round(cost.amountEur * share * 100) / 100;
  }

  setShare(raw: string): void {
    const value = Number(String(raw).replace(',', '.'));
    this.sharePct.set(Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0);
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

  /**
   * The line's price at cost: the container's landed cost per piece plus the
   * chosen markup, times the part a partner pays now. Four decimals, so the
   * quote adds up to the cent of the purchase order.
   */
  unitPrice(line: PurchaseQuoteLine): number {
    if (line.landedUnitEur === null) return 0;
    const share = this.partner() ? this.costPct() / 100 : 1;
    return Math.round(line.landedUnitEur * (1 + this.markupPct() / 100) * share * 10000) / 10000;
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const customers = await this.sales.customers();
      this.customers.set([...customers].sort((left, right) => left.company.localeCompare(right.company, 'nl')));
      const preset = this.presetCustomerId();
      const partner = preset == null ? null : this.customers().find((row) => row.id === preset);
      if (partner) {
        this.choose(partner);
        this.partner.set(true);
        if (this.costKnown()) this.pricing.set('COST');
        if (this.presetCostPct() != null) this.costPct.set(this.presetCostPct()!);
        if (this.presetSharePct() != null) this.sharePct.set(this.presetSharePct()!);
      }
    } catch (failure: unknown) {
      this.loadError.set(messageOf(failure, 'Klanten laden mislukt'));
    } finally {
      this.loading.set(false);
    }
  }

  /** Enter in the search box takes the first match: one hit, one key. */
  chooseFirst(): void {
    const first = this.visible()[0];
    if (first) this.choose(first);
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

  /** Creates the quote in one go on the server and opens it; a rule that blocks it shows here, not in a half-made draft. */
  async create(): Promise<void> {
    const customer = this.customers().find((row) => row.id === this.chosen());
    if (!customer || customer.id === null || this.busy()) return;
    this.busy.set(true);
    this.createError.set(null);
    try {
      const atCost = this.pricing() === 'COST' && this.costKnown();
      const partnerDeal = atCost && this.partner();
      const included = this.chosenCosts().map((cost) => cost.key);
      const view = await this.sales.createFromPurchaseOrder({
        purchaseOrderId: this.order().id,
        customerId: customer.id,
        pricing: atCost ? 'COST' : 'CUSTOMER',
        markupPct: atCost ? this.markupPct() : 0,
        partner: partnerDeal,
        sharePct: partnerDeal ? this.sharePct() : null,
        costPct: partnerDeal ? this.costPct() : null,
        includeInspection: false,
        otherCostIndexes: [],
        salesChannel: partnerDeal ? 'PARTNER' : null,
      });
      const count = view.order.lines.length + (view.order.extraLines ?? []).length;
      this.ui.toast(`Offerte ${view.order.number} gemaakt met ${count} regel${count === 1 ? '' : 's'}${partnerDeal ? ' als partnercontainer' : atCost ? ' aan kostprijs' : ''}`, 'ok');
      this.closed.emit();
      await this.router.navigate(['/sales', view.order.id, 'edit']);
    } catch (failure: unknown) {
      const message = messageOf(failure, 'Offerte maken mislukt');
      this.createError.set(message);
      this.ui.toast(message, 'err');
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
