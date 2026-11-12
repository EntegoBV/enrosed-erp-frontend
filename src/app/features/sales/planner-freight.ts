import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import type { Carrier, CarrierShipQuote, FreightPricingStrategy, SalesOrderView } from '../../core/api/models';
import { SalesApi } from '../../core/api/sales-api';
import { Icon } from '../../shared/icon';
import { CbmPipe, EurPipe, PctPipe } from '../../shared/pipes';
import { shippedPallets } from './pallet-stack';
import { freightGap, freightStrategy, strategyLabel } from './shipping-planner-model';
import type { ShippingOrderPatch } from './shipping-planner';

interface FreightOption { id: FreightPricingStrategy; label: string; sub: string }

/**
 * What the freight costs and how it is worked out: the five bases, the
 * detail the chosen one needs, "Later bepalen", the carrier's staffel
 * breakdown. The phone shows it as the planner's last section, the desk in
 * the sticky aside. A split order only gets its own amount; a read-only
 * one sees the chosen basis and the amount.
 */
@Component({
  selector: 'app-planner-freight',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CbmPipe, EurPipe, Icon, PctPipe],
  template: `
    <section class="fr" [class.fr--desk]="desk()" aria-labelledby="fr-title">
      <div class="fr-head">
        <h3 id="fr-title">Vracht</h3>
        @if (pending()) { <span class="badge badge--warn">later</span> }
        @else if (issue()) { <span class="badge badge--danger">nakijken</span> }
        @else {
          <b>@if (totals().freightIsMinimum) { <span class="badge badge--neutral">minimum</span> }{{ totals().freight | eur }}</b>
        }
      </div>

      @if (splitFreight()) {
        <div class="fr-group">
          <label class="fr-field"><span>Transport voor dit deel</span>
            <span class="fr-money">€<input type="number" inputmode="decimal" min="0" step="0.01" [value]="order().manualFreightEur ?? ''"
                   (change)="setSplitFreight($any($event.target).value)" /></span></label>
        </div>
        <p class="fr-note">Handling blijft behouden</p>
      } @else if (!canEdit()) {
        <div class="fr-group"><div class="fr-opt fr-opt--static"><b>{{ label() }}</b><small>{{ subOf(strategy()) }}</small></div></div>
      } @else {
        <div class="fr-group" role="radiogroup" aria-label="Vrachtprijs">
          @for (option of options(); track option.id) {
            <button class="fr-opt" type="button" role="radio" [attr.aria-checked]="option.id === strategy()" (click)="choose(option.id)">
              <b>{{ option.label }}</b><small>{{ option.sub }}</small>
              <app-icon class="fr-tick" name="tick" [size]="desk() ? 14 : 18" />
            </button>
          }
        </div>

        @switch (strategy()) {
          @case ('CARRIER') {
            <div class="fr-group">
              @if (carriers().length > 1) {
                <label class="fr-field"><span>Verzendorganisatie</span>
                  <select (change)="setCarrier($any($event.target).value)">
                    @for (carrier of carriers(); track carrier.id) {
                      <option [value]="carrier.id" [selected]="carrier.id === order().freightCarrierId">{{ carrier.name }}</option>
                    }
                  </select></label>
              }
              <label class="fr-field"><span>Toeslag Enrosed <span class="badge badge--neutral">intern</span></span>
                <span class="fr-money">€<input type="number" inputmode="decimal" min="0" step="0.01" [value]="order().freightCarrierExtraEur ?? ''"
                       (change)="setCarrierExtra($any($event.target).value)" /></span></label>
              @if (breakdown(); as b) {
                <details class="fr-more">
                  <summary>Opbouw<app-icon name="chevron-right" [size]="14" /></summary>
                  <dl>
                    <div><dt>Zone</dt><dd>{{ b.zoneName }} · {{ countryName() || order().countryCode }}@if (!b.postcodeMatched) { <small>dichtstbijzijnde bij {{ customerPostcode() || '—' }}</small> }</dd></div>
                    <div><dt>Staffeltrap</dt><dd>{{ b.tierLabel }}</dd></div>
                    <div><dt>Basis</dt><dd>{{ b.baseEur | eur: 2 }}</dd></div>
                    @if (b.dieselEur) { <div><dt>Dieseltoeslag {{ b.dieselPct | pct: 0 }}</dt><dd>+ {{ b.dieselEur | eur: 2 }}</dd></div> }
                    @if (b.surchargePctEur) { <div><dt>Toeslag {{ b.surchargePct | pct: 0 }}</dt><dd>+ {{ b.surchargePctEur | eur: 2 }}</dd></div> }
                    @if (b.surchargeFixedEur) { <div><dt>Vaste toeslag</dt><dd>+ {{ b.surchargeFixedEur | eur: 2 }}</dd></div> }
                    @if (order().freightCarrierExtraEur; as extra) {
                      <div><dt>Toeslag Enrosed</dt><dd>+ {{ extra | eur: 2 }}</dd></div>
                      <div class="fr-total"><dt>Vracht voor de klant</dt><dd>{{ b.totalEur + extra | eur: 2 }}</dd></div>
                    } @else {
                      <div class="fr-total"><dt>Vracht</dt><dd>{{ b.totalEur | eur: 2 }}</dd></div>
                    }
                  </dl>
                  @if (b.surchargeNote) { <p class="fr-note">{{ b.surchargeNote }}</p> }
                </details>
              }
            </div>
          }
          @case ('PER_CBM') {
            <div class="fr-group">
              <label class="fr-field"><span>Tarief per m³</span>
                <span class="fr-money">€<input type="number" inputmode="decimal" min="0" step="0.01" [value]="order().freightRatePerCbmEur ?? ''"
                       (change)="setCbmRate($any($event.target).value)" /></span></label>
            </div>
            @if ((order().freightRatePerCbmEur ?? 0) > 0 && !pending()) {
              <p class="fr-note">{{ totals().cbm | cbm }} × {{ order().freightRatePerCbmEur | eur: 2 }} = {{ totals().freight | eur: 2 }}</p>
            }
          }
          @case ('FIXED') {
            <div class="fr-group">
              <label class="fr-field"><span>Vast bedrag</span>
                <span class="fr-money">€<input type="number" inputmode="decimal" min="0" step="0.01" [value]="order().manualFreightEur ?? ''"
                       (change)="setFixedFreight($any($event.target).value)" /></span></label>
            </div>
          }
        }

        <div class="fr-group">
          <label class="fr-switch"><span>Later bepalen</span>
            <input type="checkbox" role="switch" [class.ios-switch]="!desk()" [checked]="pending()" (change)="setPending($any($event.target).checked)" /></label>
        </div>
      }

      @if (totals().handling > 0) { <p class="fr-note">+ {{ totals().handling | eur }} handling</p> }
      @if (canEdit() && gap(); as gap) { <p class="fr-warn">{{ gap }}</p> }
      @if (strategy() === 'CARRIER' && !pending()) {
        @if (!customerPostcode()) { <p class="fr-warn">Postcode van de klant ontbreekt</p> }
        @else if (quoteMissing()) { <p class="fr-warn">Past niet in de staffel · kies Vast bedrag</p> }
      }
      @if (issue(); as issue) { <p class="fr-warn" role="status">{{ issue }}</p> }
    </section>
  `,
  styles: [`
    .fr{display:grid;gap:8px;min-width:0}
    .fr-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:0 16px;color:var(--muted);font-size:13px;font-weight:600}
    .fr-head h3{font-size:13px;font-weight:600;letter-spacing:.02em;text-transform:uppercase}
    .fr-head b{display:flex;align-items:center;gap:6px;color:var(--ink);font-size:15px;font-weight:700;font-variant-numeric:tabular-nums}
    .fr-group{overflow:hidden;border-radius:var(--ios-radius,22px);background:var(--surface)}
    .fr-group>*+*{border-top:.5px solid var(--ios-sep)}
    .fr-opt{display:grid;grid-template-columns:minmax(0,1fr) auto 22px;align-items:center;gap:8px;width:100%;min-height:52px;padding:8px 16px;border:0;background:var(--surface);color:var(--ink);text-align:left;cursor:pointer;-webkit-tap-highlight-color:transparent}
    .fr-opt b{min-width:0;overflow:hidden;font-size:16px;font-weight:500;text-overflow:ellipsis;white-space:nowrap}
    .fr-opt small{color:var(--muted);font-size:13px;white-space:nowrap}
    .fr-tick{justify-self:end;color:var(--rose);visibility:hidden}.fr-opt[aria-checked=true] .fr-tick{visibility:visible}
    .fr-opt--static{grid-template-columns:minmax(0,1fr) auto;cursor:default}
    .fr-field,.fr-switch{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:12px;min-height:52px;padding:4px 16px;font-size:16px}
    .fr-field>span:first-child{display:flex;align-items:center;gap:6px}
    .fr-field select,.fr-money input{min-width:0;width:100%;height:44px;padding:0;border:0;background:none;color:var(--ink);font-size:16px;text-align:right;text-align-last:right}
    .fr-money{display:flex;align-items:center;gap:4px;min-width:0;color:var(--muted)}
    .fr-field :focus{outline:none}
    .fr-switch{grid-template-columns:minmax(0,1fr) auto;cursor:pointer}
    .fr-more summary{display:flex;align-items:center;justify-content:space-between;min-height:44px;padding:0 16px;list-style:none;color:var(--rose);font-size:15px;cursor:pointer}
    .fr-more summary::-webkit-details-marker{display:none}
    .fr-more summary app-icon{transition:transform var(--dur-1,.15s)}.fr-more[open] summary app-icon{transform:rotate(90deg)}
    .fr-more dl{display:grid;gap:4px;margin:0;padding:0 16px 12px}
    .fr-more dl div{display:flex;align-items:baseline;justify-content:space-between;gap:12px;font-size:13px}
    .fr-more dt{color:var(--muted)}.fr-more dd{text-align:right;font-weight:600;font-variant-numeric:tabular-nums}
    .fr-more dd small{display:block;color:var(--muted);font-size:11.5px;font-weight:500}
    .fr-total{margin-top:2px;padding-top:6px;border-top:1px dashed var(--line)}.fr-total dt{color:var(--ink)}
    .fr-more .fr-note{padding:0 16px 12px}
    .fr-note,.fr-warn{padding:0 16px;color:var(--muted);font-size:13px;font-variant-numeric:tabular-nums}
    .fr-warn{color:var(--warn);font-weight:600}
    .fr--desk{gap:6px}
    .fr--desk .fr-head{padding:0}.fr--desk .fr-head h3{color:var(--rose);font-size:10px;font-weight:760;letter-spacing:.1em}
    .fr--desk .fr-head b{font-size:20px;font-weight:750}
    .fr--desk .fr-group{border-radius:0;background:none}.fr--desk .fr-group>*+*{border-top:0}
    .fr--desk .fr-group+.fr-group{padding-top:4px;border-top:1px solid var(--line)}
    .fr--desk .fr-opt{grid-template-columns:minmax(0,1fr) auto 16px;min-height:36px;padding:4px 8px;border-radius:8px;background:none}
    .fr--desk .fr-opt:hover{background:var(--surface-2)}
    .fr--desk .fr-opt[aria-checked=true]{background:var(--rose-soft);color:var(--rose-dark)}
    .fr--desk .fr-opt b{font-size:12.5px;font-weight:600}.fr--desk .fr-opt small{font-size:11px}
    .fr--desk .fr-field,.fr--desk .fr-switch{min-height:36px;padding:2px 8px;font-size:12.5px;font-weight:600}
    .fr--desk .fr-field select,.fr--desk .fr-money input{height:30px;padding:0 6px;border:1px solid var(--line-strong);border-radius:8px;background:var(--surface);font-size:12.5px;text-align:right}
    .fr--desk .fr-money{max-width:120px;justify-self:end}
    .fr--desk .fr-switch input{width:18px;height:18px;accent-color:var(--rose)}
    .fr--desk .fr-more summary{min-height:32px;padding:0 8px;font-size:12.5px;font-weight:650}
    .fr--desk .fr-more dl,.fr--desk .fr-more .fr-note{padding:0 8px 8px}.fr--desk .fr-more dl div{font-size:12px}
    .fr--desk .fr-note,.fr--desk .fr-warn{padding:0 8px;font-size:12px}
  `],
})
export class PlannerFreight {
  readonly view = input.required<SalesOrderView>();
  readonly canEdit = input(true);
  readonly carriers = input<Carrier[]>([]);
  readonly customerPostcode = input<string | null>(null);
  readonly countryName = input<string | null>(null);
  readonly splitFreight = input(false);
  readonly desk = input(false);
  readonly patch = output<ShippingOrderPatch>();

  private readonly sales = inject(SalesApi);
  readonly breakdown = signal<CarrierShipQuote | null>(null);
  readonly quoteMissing = signal(false);

  readonly order = computed(() => this.view().order);
  readonly totals = computed(() => this.view().priced.totals);
  readonly strategy = computed(() => freightStrategy(this.order()));
  readonly pending = computed(() => this.order().freight === 'TE_BEPALEN');
  readonly issue = computed(() => (this.pending() ? null : this.view().priced.validation.freightPricingIssue || null));
  readonly gap = computed(() => freightGap(this.order()));
  readonly label = computed(() => strategyLabel(this.strategy(), this.carriers(), this.order().freightCarrierId));
  readonly options = computed<FreightOption[]>(() => {
    const pallets = (this.order().loadMode ?? 'PALLETS') === 'PALLETS';
    const carriers = this.carriers();
    const options: FreightOption[] = [];
    if (pallets) options.push({ id: 'COUNTRY_PALLET', label: 'Landentarief', sub: this.subOf('COUNTRY_PALLET') });
    if (pallets && carriers.length) {
      options.push({ id: 'CARRIER', sub: this.subOf('CARRIER'),
        label: carriers.length === 1 ? carriers[0].name : strategyLabel('CARRIER', carriers, this.order().freightCarrierId) });
    }
    options.push({ id: 'PER_CBM', label: 'Per m³', sub: this.subOf('PER_CBM') },
      { id: 'FIXED', label: 'Vast bedrag', sub: this.subOf('FIXED') }, { id: 'PICKUP', label: 'Afhalen', sub: this.subOf('PICKUP') });
    return options;
  });

  /** What the staffel is asked; the breakdown is fetched again only when this changes. */
  private readonly quoteKey = computed(() => {
    const data = this.view();
    const carrierId = data.order.freightCarrierId;
    if (this.strategy() !== 'CARRIER' || !carrierId || !data.order.countryCode) return null;
    const totals = data.priced.totals;
    const profile = data.order.palletProfile;
    return JSON.stringify({
      carrierId, country: data.order.countryCode, postcode: this.customerPostcode(),
      pallets: shippedPallets(totals), weightKg: totals.weightKg ?? null,
      palletType: profile === 'BLOCK_120X100' ? 'BLOCK' : profile === 'HALF_80X60' ? 'HALF' : 'EURO',
    });
  });
  private quoteVersion = 0;

  constructor() {
    /* The breakdown mirrors what the backend already priced: same zone resolution, same rungs, fetched only to show why. */
    effect(() => {
      const key = this.quoteKey();
      const version = ++this.quoteVersion;
      if (!key) { this.breakdown.set(null); this.quoteMissing.set(false); return; }
      const ask = JSON.parse(key) as { carrierId: number; country: string; postcode: string | null; pallets: number;
        weightKg: number | null; palletType: 'EURO' | 'BLOCK' | 'HALF' };
      void this.sales.carrierQuote(ask.carrierId, ask).then((quote) => {
        if (version !== this.quoteVersion) return;
        this.breakdown.set(quote);
        this.quoteMissing.set(quote === null && ask.pallets > 0);
      }).catch(() => {
        if (version !== this.quoteVersion) return;
        this.breakdown.set(null);
        this.quoteMissing.set(false);
      });
    });
  }

  subOf(strategy: FreightPricingStrategy): string {
    switch (strategy) {
      case 'COUNTRY_PALLET': return 'per pallet';
      case 'CARRIER': return 'staffel per zone';
      case 'PER_CBM': return 'eigen tarief';
      case 'FIXED': return 'één prijs';
      default: return 'geen vracht';
    }
  }

  private money(raw: string): number | null {
    return String(raw).trim() === '' ? null : Math.max(0, Number(raw) || 0);
  }

  private state(): 'TE_BEPALEN' | 'BEREKEND' {
    return this.pending() ? 'TE_BEPALEN' : 'BEREKEND';
  }

  choose(strategy: FreightPricingStrategy): void {
    if (!this.canEdit() || strategy === this.strategy()) return;
    const order = this.order();
    const freight = this.totals().freight;
    const fixed = strategy === 'FIXED'
      ? order.manualFreightEur ?? (this.pending() || !(freight > 0) ? null : freight) : null;
    this.patch.emit({
      freight: this.state(),
      freightPricingStrategy: strategy,
      freightRatePerCbmEur: strategy === 'PER_CBM' ? order.freightRatePerCbmEur : null,
      manualFreightEur: fixed,
      freightCarrierId: strategy === 'CARRIER'
        ? order.freightCarrierId ?? this.carriers().find((carrier) => carrier.active)?.id ?? this.carriers()[0]?.id
        : order.freightCarrierId,
    });
  }

  setPending(pending: boolean): void {
    if (this.canEdit()) this.patch.emit({ freight: pending ? 'TE_BEPALEN' : 'BEREKEND' });
  }

  setCbmRate(raw: string): void {
    if (!this.canEdit()) return;
    this.patch.emit({ freight: this.state(), freightPricingStrategy: 'PER_CBM', freightRatePerCbmEur: this.money(raw), manualFreightEur: null });
  }

  setFixedFreight(raw: string): void {
    if (!this.canEdit()) return;
    this.patch.emit({ freight: this.state(), freightPricingStrategy: 'FIXED', freightRatePerCbmEur: null, manualFreightEur: this.money(raw) });
  }

  /** A split part keeps its handling; only its own transport amount changes. */
  setSplitFreight(raw: string): void {
    this.patch.emit({ manualFreightEur: this.money(raw) });
  }

  setCarrier(raw: string): void {
    const id = Number(raw);
    if (this.canEdit() && Number.isInteger(id) && id > 0) this.patch.emit({ freightCarrierId: id, freightPricingStrategy: 'CARRIER' });
  }

  setCarrierExtra(raw: string): void {
    if (this.canEdit()) this.patch.emit({ freightCarrierExtraEur: this.money(raw), freightPricingStrategy: 'CARRIER' });
  }
}
