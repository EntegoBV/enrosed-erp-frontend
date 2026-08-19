import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CatalogApi } from '../../core/api/catalog-api';
import { SourcingApi } from '../../core/api/sourcing-api';
import { saveBlob } from '../../core/api/download';
import { CONTAINER_TYPES, DESTINATION_PORTS, containerLabel, countryName } from '../../core/api/geo';
import { messageOf } from '../../core/api/errors';
import { Allocation, Currency, Product, PurchaseOrder, PurchaseOrderLine, PurchaseOrderView, Supplier } from '../../core/api/models';
import { Privacy } from '../../core/api/privacy';
import { PageHeader } from '../../shared/page-header';
import { ProductDraft } from '../../shared/product-picker';
import { ProductPicker } from '../../shared/product-picker';
import { DateField } from '../../shared/date-field';
import { Ui } from '../../shared/ui';
import { CbmPipe, CurPipe, EurPipe, NumPipe, PctPipe } from '../../shared/pipes';

/**
 * Landed-cost calculation of a container.
 *
 * The screen order follows the road of the goods: goods, local origin costs
 * and sea freight form the customs value, duty per HS code is levied on
 * that, and only then do the costs from the port of arrival join.
 */
@Component({
  selector: 'app-purchase-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, PageHeader, ProductPicker, DateField,
            EurPipe, CurPipe, NumPipe, PctPipe, CbmPipe],
  template: `
    @if (view(); as data) {
      <app-page-header [title]="data.order.number" [subtitle]="supplierName()"
                       [showBack]="true" [showBell]="false"
                       [titleEditable]="true"
                       (titleChange)="patch({ number: $event })">
        <!-- Only PDF up top; every action that changes the order lives at the
             bottom, in the reading order you finish the screen in. -->
        <button class="btn btn--sm" type="button" (click)="downloadPdf()">PDF</button>
      </app-page-header>

      <div class="content">
        <div class="card">
          <div class="card__head card__head--toggle" (click)="toggleSection('order')">
            <h2>Order</h2>
            @if (!sectionOpen('order')) {
              <span class="card__summary">{{ orderSummary() }}</span>
            } @else { <span class="spacer"></span> }
            <span class="card__chev" [class.card__chev--open]="sectionOpen('order')">›</span>
          </div>
          <div class="collapse" [class.collapse--open]="sectionOpen('order')"><div class="collapse__inner">
          <div class="card__body"><div class="form-grid">
            <div class="field"><label for="po-alias">Alias <span class="opt"></span></label>
              <input class="input" id="po-alias" [ngModel]="data.order.alias"
                     (ngModelChange)="patch({ alias: $event })"
                     placeholder="Bijv. voor Frans, variant -5%…" />
              <span class="hint">
                Vrije naam naast het nummer, om varianten snel terug te vinden.
              </span></div>
            <div class="field"><label for="po-date">Datum</label>
              <app-date-field fieldId="po-date" [value]="data.order.orderDate"
                              (valueChange)="patch({ orderDate: $event })" /></div>
            <div class="field span-2"><label>Status</label>
              <!-- A container's life is a one-way street: ordered, sailing,
                   received. A stepper says where it stands; the button in the
                   header moves it forward. No dropdown, because "put a received
                   container back to concept" is not an edit, it is an incident. -->
              <div class="stepper">
                @for (step of statusSteps; track step.value; let last = $last) {
                  <div class="stepper__step"
                       [class.stepper__step--done]="stepIndex(data.order.status) > $index"
                       [class.stepper__step--now]="data.order.status === step.value">
                    <span class="stepper__dot">
                      @if (stepIndex(data.order.status) > $index) { ✓ } @else { {{ $index + 1 }} }
                    </span>
                    <span class="stepper__label">{{ step.label }}</span>
                  </div>
                  @if (!last) { <span class="stepper__line"
                       [class.stepper__line--done]="stepIndex(data.order.status) > $index"></span> }
                }
              </div></div>
            <div class="field"><label for="po-container">Container</label>
              <select class="select" id="po-container" [ngModel]="data.order.containerType"
                      (ngModelChange)="patch({ containerType: $event })">
                @for (type of containerTypes; track type.value) {
                  <option [value]="type.value">{{ type.label }}</option>
                }
              </select></div>
            <div class="field"><label for="po-notes">Notitie <span class="opt"></span></label>
              <input class="input" id="po-notes" [ngModel]="data.order.notes"
                     (ngModelChange)="patch({ notes: $event })" /></div>
          </div></div>
          </div></div>
        </div>

        <div class="card">
          <div class="card__head card__head--toggle" (click)="toggleSection('costs')">
            <h2>Koersen &amp; kosten</h2>
            @if (!sectionOpen('costs')) {
              <span class="card__summary">{{ costsSummary() }}</span>
            } @else { <span class="spacer"></span> }
            <span class="card__chev" [class.card__chev--open]="sectionOpen('costs')">›</span>
          </div>
          <div class="collapse" [class.collapse--open]="sectionOpen('costs')"><div class="collapse__inner">
          <div class="card__body">
            <!-- The three rates share one row: they belong together and
                 each is only a handful of digits. -->
            <div class="rate-row">
              <div class="field"><label for="r-cny">RMB→USD</label>
                <input class="input num right" id="r-cny" type="number" step="0.0001"
                       [ngModel]="data.order.cnyToUsd"
                       (ngModelChange)="patch({ cnyToUsd: +$event })" /></div>
              <div class="field"><label for="r-goods">USD→EUR goed.</label>
                <input class="input num right" id="r-goods" type="number" step="0.0001"
                       [ngModel]="data.order.usdToEurGoods"
                       (ngModelChange)="patch({ usdToEurGoods: +$event })" /></div>
              <div class="field"><label for="r-transport">USD→EUR transp.</label>
                <input class="input num right" id="r-transport" type="number" step="0.0001"
                       [ngModel]="data.order.usdToEurTransport"
                       (ngModelChange)="patch({ usdToEurTransport: +$event })" /></div>
            </div>
            <div class="form-grid">
              <div class="field"><label class="req" for="c-freight">Zeevracht tot bestemmingshaven</label>
                <div class="input-affix">
                  <input class="input num right" id="c-freight" type="number" step="50"
                         [ngModel]="data.order.freightUsd"
                         (ngModelChange)="patch({ freightUsd: +$event })" />
                  <span class="input-affix__suffix">USD</span></div></div>
              <div class="field"><label for="c-origin">Lokale kosten {{ originLabel() }} <span class="opt"></span></label>
                <div class="input-affix">
                  <input class="input num right" id="c-origin" type="number" step="50"
                         [ngModel]="data.order.originCosts"
                         (ngModelChange)="patch({ originCosts: +$event })" />
                  <select class="input-affix__suffix" aria-label="Munt"
                          style="border-radius:0 var(--r-sm) var(--r-sm) 0"
                          [ngModel]="data.order.originCurrency"
                          (ngModelChange)="patch({ originCurrency: $event })">
                    <option value="USD">USD</option><option value="CNY">CNY</option>
                    <option value="EUR">EUR</option>
                  </select></div>
                <span class="hint">
                  Fabriek → haven, exportdocumenten. <b>Telt mee in de douanewaarde.</b>
                </span></div>
              <div class="field"><label for="c-port">Aankomsthaven</label>
                <select class="select" id="c-port" [ngModel]="data.order.destinationPort"
                        (ngModelChange)="patch({ destinationPort: $event })">
                  @for (port of ports; track port) { <option [value]="port">{{ port }}</option> }
                </select></div>
              <div class="field"><label for="c-dest">
                  Lokale kosten {{ data.order.destinationPort || 'Rotterdam' }} → magazijn</label>
                <div class="input-affix">
                  <input class="input num right" id="c-dest" type="number" step="25"
                         [ngModel]="data.order.destinationCostsEur"
                         (ngModelChange)="patch({ destinationCostsEur: +$event })" />
                  <span class="input-affix__suffix">EUR</span></div>
                <span class="hint">
                  Trucking en afhandeling van de haven naar het magazijn.
                  Ná de invoer, dus <b>geen invoerrecht</b> over.</span></div>
              <div class="field"><label for="c-duty">Invoerrecht zonder HS-code</label>
                <div class="input-affix">
                  <input class="input num right" id="c-duty" type="number" step="0.5"
                         [ngModel]="data.order.defaultDutyRatePct"
                         (ngModelChange)="patch({ defaultDutyRatePct: +$event })" />
                  <span class="input-affix__suffix">%</span></div></div>
              <div class="field"><label for="c-extra">Extra gewenste opbrengst <span class="opt"></span></label>
                <div class="input-affix">
                  <input class="input num right" id="c-extra" type="number" step="100"
                         [ngModel]="data.order.extraRevenueEur"
                         (ngModelChange)="patch({ extraRevenueEur: +$event })" />
                  <span class="input-affix__suffix">EUR</span></div></div>
            </div>

            <details class="mt-8">
              <summary class="small strong" style="cursor:pointer">Verdeelsleutels</summary>
              <div class="form-grid mt-8">
                @for (key of allocationKeys; track key.field) {
                  <div class="field">
                    <label [attr.for]="'a-' + key.field">{{ key.label }}</label>
                    <select class="select" [id]="'a-' + key.field"
                            [ngModel]="allocationOf(data.order, key.field)"
                            (ngModelChange)="setAllocation(key.field, $event)">
                      <option value="CBM">Naar volume (m³)</option>
                      <option value="VALUE">Naar goederenwaarde</option>
                      <option value="PIECES">Naar aantal stuks</option>
                    </select>
                  </div>
                }
              </div>
            </details>
          </div>
          </div></div>
        </div>

        <div class="card">
          <div class="card__head"><h2>Producten</h2><span class="spacer"></span>
            @if (data.costing.lines.length) {
              <button class="btn btn--sm" type="button" (click)="openPicker()">+ Toevoegen</button>
            }
          </div>
          <div class="card__body card__body--flush"><div class="list">
            @for (line of data.costing.lines; track line.productId) {
              <div class="list-item" style="flex-direction:column;align-items:stretch;gap:10px">
                <div class="row">
                  <div class="list-item__body">
                    <div class="list-item__title">{{ line.productName }}</div>
                    <div class="list-item__meta">
                      {{ line.cartons | num }} kartons · {{ line.cbm | cbm }}
                    </div>
                  </div>
                  <button class="btn btn--sm btn--danger" type="button"
                          (click)="removeLine(line.productId)">✕</button>
                </div>

                <div class="form-grid">
                  <div class="field">
                    <label [attr.for]="'qty-' + line.productId">Aantal stuks</label>
                    <input class="input input--sm num right" [id]="'qty-' + line.productId"
                           type="number" min="0" step="1" [ngModel]="line.quantity"
                           (ngModelChange)="setQuantity(line.productId, +$event)" />
                    @if (shortShipped(line.productId); as ordered) {
                      <!-- Containers regularly arrive short; the order remembers
                           what was agreed so the difference stays explainable. -->
                      <span class="hint warn-text">
                        Besteld {{ ordered | num }} → nu {{ line.quantity | num }}
                      </span>
                    }
                  </div>
                  <div class="field">
                    <label [attr.for]="'exw-' + line.productId">EXW-prijs per stuk</label>
                    <div class="input-affix">
                      <input class="input input--sm num right" [id]="'exw-' + line.productId"
                             type="number" min="0" step="0.01"
                             [ngModel]="orderLine(line.productId)?.exwPrice"
                             [placeholder]="line.quantity ? (line.goodsUsd / line.quantity | num: 4) : ''"
                             (ngModelChange)="setExwPrice(line.productId, $event)" />
                      <select class="input-affix__suffix" aria-label="Munt EXW-prijs"
                              style="border-radius:0 var(--r-sm) var(--r-sm) 0"
                              [ngModel]="orderLine(line.productId)?.exwCurrency ?? 'USD'"
                              (ngModelChange)="setExwCurrency(line.productId, $event)">
                        <option value="USD">USD</option><option value="CNY">CNY</option>
                        <option value="EUR">EUR</option>
                      </select>
                    </div>
                    <span class="hint">Leeg = de prijs van het product zelf.</span>
                  </div>
                </div>

                <div style="background:var(--surface-2);border:1px solid var(--line);
                            border-radius:var(--r-sm);padding:10px 12px">
                  <div class="row" style="justify-content:flex-end;margin-bottom:4px">
                    <div class="per-toggle">
                      <button type="button" [class.on]="!perPiece()"
                              (click)="perPiece.set(false)">Totaal</button>
                      <button type="button" [class.on]="perPiece()"
                              (click)="perPiece.set(true)">Per stuk</button>
                    </div>
                  </div>
                  @if (line.originEur) {
                    <div class="stat-row stat-row--muted"><span>Lokale kosten {{ originLabel() }}</span>
                      <span class="num">{{ amt(line.originEur, line) | eur: decimals() }}</span></div>
                  }
                  <div class="stat-row stat-row--muted"><span>Zeevracht</span>
                    <span class="num">{{ amt(line.freightEur, line) | eur: decimals() }}</span></div>
                  <div class="stat-row stat-row--muted"
                       style="border-top:1px dashed var(--line-strong);padding-top:6px">
                    <span>Douanewaarde</span>
                    <span class="num">{{ amt(line.customsValueEur, line) | eur: decimals() }}</span></div>
                  <div class="stat-row stat-row--muted">
                    <span>Invoerrecht {{ line.dutyRatePct | pct: 1 }}
                      <span class="tiny">({{ line.dutySource }})</span></span>
                    <span class="num">{{ amt(line.dutyEur, line) | eur: decimals() }}</span></div>
                  <div class="stat-row stat-row--muted"><span>Lokale kosten {{ view()?.order?.destinationPort || 'Rotterdam' }} → magazijn</span>
                    <span class="num">{{ amt(line.destinationEur, line) | eur: decimals() }}</span></div>
                  <div class="stat-row" style="border-top:1px solid var(--line);
                       margin-top:4px;padding-top:8px;font-weight:680">
                    <span>{{ perPiece() ? 'Kostprijs per stuk' : 'Totaal regel' }}</span>
                    <span class="num rose-text">{{ perPiece() ? (line.landedUnitEur | eur: 4)
                        : (line.totalEur | eur) }}</span></div>
                </div>
              </div>
            } @empty {
              <div class="empty">
                <div class="empty__icon">◈</div>
                <div class="empty__title">Nog geen producten</div>
                <button class="btn btn--primary" type="button" (click)="openPicker()">
                  Product toevoegen
                </button>
              </div>
            }
          </div></div>
        </div>

        <div class="card">
          <div class="card__head"><h2>Totaal container</h2>
            <span class="spacer"></span>
            <span class="muted small">{{ data.costing.totals.pieces | num }} st ·
              {{ data.costing.totals.cartons | num }} dozen</span>
          </div>
          <div class="card__body">
            <!-- The build-up reads as the journey of the goods: up to the
                 border, the border itself, and this side of it. Micro
                 section labels replace the old wall of look-alike rows. -->
            <div class="cost-section">Tot de EU-grens</div>
            <div class="stat-row"><span>Goederen
                <span class="tiny muted">{{ data.costing.totals.goodsUsd | cur: 'USD' }}</span></span>
              <span class="num">{{ data.costing.totals.goodsEur | eur }}</span></div>
            @if (data.costing.totals.originEur) {
              <div class="stat-row"><span>Lokale kosten {{ originLabel() }}</span>
                <span class="num">{{ data.costing.totals.originEur | eur }}</span></div>
            }
            <div class="stat-row"><span>Zeevracht</span>
              <span class="num">{{ data.costing.totals.freightEur | eur }}</span></div>
            <div class="stat-row stat-row--sub"><span>Douanewaarde</span>
              <span class="num">{{ data.costing.totals.customsValueEur | eur }}</span></div>

            <div class="cost-section">Invoer</div>
            <div class="stat-row"><span>Invoerrechten
                <span class="tiny muted">gem. {{ data.costing.totals.effectiveDutyPct | pct: 1 }}</span></span>
              <span class="num">{{ data.costing.totals.dutyEur | eur }}</span></div>

            <div class="cost-section">Na aankomst</div>
            <div class="stat-row"><span>{{ view()?.order?.destinationPort || 'Haven' }} → magazijn
                <span class="tiny muted">trucking en afhandeling</span></span>
              <span class="num">{{ data.costing.totals.destinationEur | eur }}</span></div>
            @if (data.costing.totals.extraRevenueEur) {
              <div class="stat-row"><span>Extra gewenste opbrengst</span>
                <span class="num">{{ data.costing.totals.extraRevenueEur | eur }}</span></div>
            }

            <div class="cost-hero">
              <div>
                <div class="cost-hero__label">Totaal geland</div>
                <div class="cost-hero__value">{{ data.costing.totals.totalEur | eur }}</div>
              </div>
              <div class="cost-hero__unit">
                <div class="cost-hero__label">Per stuk</div>
                <div class="cost-hero__value cost-hero__value--rose">
                  {{ data.costing.totals.averageUnitEur | eur: 4 }}</div>
              </div>
            </div>

            @if (data.costing.containerFill; as fill) {
              <div class="mt-16">
                <div class="meter__track">
                  <div class="meter__fill" [class.meter__fill--warn]="fill.fillPercent > 97"
                       [style.width.%]="fill.fillPercent"></div>
                </div>
                <div class="meter__labels">
                  <span>{{ fill.usedCbm | cbm }} van {{ fill.capacityCbm }} m³</span>
                  <span>{{ fill.fillPercent | num: 0 }}% gevuld</span>
                </div>
                @if (fill.overflowCbm > 0) {
                  <div class="alert alert--danger mt-12">
                    <span class="alert__icon">!</span>
                    <div>Past niet in één {{ containerLabel(data.order.containerType) }}:
                      <b>{{ fill.overflowCbm | cbm }} te veel</b>.</div>
                  </div>
                }
              </div>
            }
          </div>
        </div>

        @if (nextStep(); as step) {
          <button class="btn btn--primary btn--block mt-16" type="button"
                  (click)="advanceStatus()">
            {{ step.action }}
          </button>
        }
        <button class="btn btn--block mt-8" type="button" (click)="apply()">
          Kostprijzen toepassen op producten
        </button>
        <button class="btn btn--block mt-8" type="button" (click)="duplicate()">
          Kopiëren als variant
        </button>
        <button class="btn btn--danger btn--block mt-8" type="button" (click)="remove()">
          Calculatie verwijderen
        </button>
      </div>

      @if (picking()) {
        <app-product-picker
          heading="Product toevoegen aan de container"
          [products]="available()"
          [priceOf]="exwPriceOf"
          [enforceCartons]="false"
          (picked)="addLine($event)"
          (cancelled)="picking.set(false)"
          [allowCreate]="true"
          [createCurrency]="supplier()?.currency ?? 'USD'"
          (create)="quickCreate($event)"
        />
      }
    }
  `,
})
export class PurchaseEditor {
  /** Cost breakdowns as totals or per piece; one switch for all lines. */
  /* Per piece is what the buying conversation is about; totals are the
     exception you toggle to. */
  readonly perPiece = signal(true);

  /** Every line amount through one gate, so the toggle cannot miss one. */
  /** Two decimals for totals, four for per-piece - tiny numbers need them. */
  readonly decimals = computed(() => this.perPiece() ? 4 : 2);

  amt(value: number, line: { quantity: number }): number {
    return this.perPiece() && line.quantity > 0 ? value / line.quantity : value;
  }

  /** Which cards are folded open; the products are the heart of the screen. */
  readonly openSections = signal(new Set<string>());

  toggleSection(name: string): void {
    const next = new Set(this.openSections());
    if (next.has(name)) { next.delete(name); } else { next.add(name); }
    this.openSections.set(next);
  }

  sectionOpen(name: string): boolean {
    return this.openSections().has(name);
  }

  orderSummary(): string {
    const data = this.view();
    if (!data) return '';
    return [this.supplierName(), containerLabel(data.order.containerType),
        data.order.destinationPort].filter(Boolean).join(' · ');
  }

  costsSummary(): string {
    const data = this.view();
    if (!data) return '';
    return `USD ${data.order.usdToEurGoods} · vracht $${data.order.freightUsd}`;
  }

  readonly containerTypes = CONTAINER_TYPES;
  readonly containerLabel = containerLabel;

  /** The one-way street a container travels. */
  /* Three visible steps: "onderweg" added a tap without adding
     information - the stock only moves on receipt anyway. Orders still
     in ONDERWEG from before simply show as Besteld. */
  readonly statusSteps = [
    { value: 'CONCEPT' as const, label: 'Concept', action: 'Bestellen' },
    { value: 'BESTELD' as const, label: 'Besteld', action: 'Container ontvangen' },
    { value: 'ONTVANGEN' as const, label: 'Ontvangen', action: '' },
  ];

  /**
   * The ordered quantity when it no longer matches the line, or null.
   * The costing rows the template renders do not carry the snapshot; the
   * raw order lines do.
   */
  shortShipped(productId: number): number | null {
    const line = this.view()?.order.lines.find((l) => l.productId === productId);
    if (!line || line.orderedQuantity === null || line.orderedQuantity === undefined) return null;
    return line.orderedQuantity !== line.quantity ? line.orderedQuantity : null;
  }

  stepIndex(status: string): number {
    if (status === 'ONDERWEG') status = 'BESTELD';
    return this.statusSteps.findIndex((step) => step.value === status);
  }

  /** The transition the header button offers, or null when the road ends. */
  nextStep(): { action: string; to: string } | null {
    const index = this.stepIndex(this.view()?.order.status ?? 'CONCEPT');
    if (index < 0 || index >= this.statusSteps.length - 1) return null;
    return {
      action: this.statusSteps[index].action,
      to: this.statusSteps[index + 1].value,
    };
  }

  /**
   * Moves the container one step forward.
   *
   * Ordering snapshots the agreed quantities (the backend does that);
   * receiving books the stock, so that one asks first. Adjust short-shipped
   * lines before pressing receive - the order keeps "ordered X" next to
   * every changed line.
   */
  advanceStatus(): void {
    const data = this.view();
    const step = this.nextStep();
    if (!data || !step) return;

    if (step.to === 'ONTVANGEN') {
      this.ui.confirm(
        {
          title: 'Container ontvangen',
          message: 'De voorraad wordt bijgeboekt met de aantallen zoals ze nu op de order '
            + 'staan. Minder ontvangen dan besteld? Pas de aantallen eerst aan; de order '
            + 'onthoudt wat er besteld was.',
          confirmLabel: 'Ontvangen en bijboeken',
        },
        () => { this.enqueue((order) => ({ ...order, status: 'ONTVANGEN' })); },
      );
      return;
    }
    this.enqueue((order) => ({ ...order, status: step.to as PurchaseOrder['status'] }));
  }

  readonly ports = DESTINATION_PORTS;

  /**
   * Where the origin costs are incurred, named after the supplier's country.
   * "Local costs China" was hardcoded once, but not every supplier is Chinese.
   */
  readonly originLabel = computed(() => {
    const code = this.supplier()?.country;
    return code ? countryName(code) : 'oorsprong';
  });

  private readonly sourcing = inject(SourcingApi);
  private readonly catalog = inject(CatalogApi);
  private readonly router = inject(Router);
  private readonly ui = inject(Ui);
  readonly privacy = inject(Privacy);

  readonly id = input<string>('');

  readonly allocationKeys = [
    { field: 'allocFreight' as const, label: 'Zeevracht' },
    { field: 'allocOrigin' as const, label: 'Lokale kosten oorsprong' },
    { field: 'allocDestination' as const, label: 'Lokale kosten bestemming' },
    { field: 'allocExtra' as const, label: 'Extra opbrengst' },
  ];

  readonly view = signal<PurchaseOrderView | null>(null);
  readonly adjustments = signal<PurchaseOrderView['adjustments']>([]);
  readonly products = signal<Product[]>([]);
  /** The order's supplier; drives the header and the origin-cost label. */
  readonly supplier = signal<Supplier | null>(null);

  readonly picking = signal(false);

  constructor() {
    effect(() => {
      const routeId = this.id();
      if (routeId) void this.load(+routeId);
    });
  }

  private async load(orderId: number): Promise<void> {
    const view = await this.sourcing.purchaseOrder(orderId);
    this.view.set(view);
    const [products, suppliers] = await Promise.all([
      this.catalog.products(view.order.supplierId), this.sourcing.suppliers()]);
    this.products.set(products);
    this.supplier.set(suppliers.find((s) => s.id === view.order.supplierId) ?? null);
  }

  supplierName(): string { return this.supplier()?.name ?? 'Onbekend'; }

  readonly available = computed(() => {
    const used = new Set((this.view()?.order.lines ?? []).map((line) => line.productId));
    return this.products().filter((product) => !used.has(product.id!));
  });

  allocationOf(order: PurchaseOrder, field: keyof PurchaseOrder): Allocation {
    return order[field] as Allocation;
  }

  /* Saves run strictly in sequence; see the sales editor for the race
     this prevents. Each queued change is applied onto the freshest order. */
  private saveQueue: Promise<void> = Promise.resolve();

  private enqueue(make: (order: PurchaseOrder) => PurchaseOrder): void {
    this.saveQueue = this.saveQueue.then(async () => {
      const data = this.view();
      if (!data) return;
      await this.save(make(data.order));
    });
  }

  private async save(order: PurchaseOrder): Promise<void> {
    const result = await this.sourcing.updatePurchaseOrder(order.id, order);
    this.view.set(result);
    this.adjustments.set(result.adjustments ?? []);
    if (result.adjustments?.length) {
      /* Warning only: purchasing never rounds. A supplier can ship a sample of
         three pieces, and silently inflating an order costs real money. */
      const first = result.adjustments[0];
      this.ui.toast(
        `Let op: ${first.requested} stuks is geen volle doos (${first.piecesPerCarton}/doos)`,
        'err');
    }
    /* Stock levels may have just been booked; refetch the catalogue. */
    this.products.set(await this.catalog.products(order.supplierId));
  }

  piecesPerCarton(productId: number): number {
    return this.products().find((product) => product.id === productId)?.carton.piecesPerCarton ?? 1;
  }

  stockOf(productId: number): number {
    return this.products().find((product) => product.id === productId)?.stockQuantity ?? 0;
  }

  patch(changes: Partial<PurchaseOrder>): void {
    this.enqueue((order) => ({ ...order, ...changes }));
  }

  setAllocation(field: keyof PurchaseOrder, value: Allocation): void {
    this.patch({ [field]: value } as Partial<PurchaseOrder>);
  }

  setQuantity(productId: number, quantity: number): void {
    this.setLine(productId, { quantity });
  }

  /** The order line behind a calculation line, with the raw input. */
  orderLine(productId: number): PurchaseOrderLine | undefined {
    return this.view()?.order.lines.find((line) => line.productId === productId);
  }

  /**
   * Price agreed at the fair or the factory table? Enter it here, in the
   * currency it was named in. Clearing hands the line back to the price on
   * the product itself.
   */
  setExwPrice(productId: number, raw: unknown): void {
    const empty = raw === null || raw === undefined || raw === '';
    const line = this.orderLine(productId);
    this.setLine(productId, empty
      ? { exwPrice: null, exwCurrency: null }
      : { exwPrice: +String(raw), exwCurrency: line?.exwCurrency ?? 'USD' });
  }

  setExwCurrency(productId: number, currency: Currency): void {
    this.setLine(productId, { exwCurrency: currency });
  }

  private setLine(productId: number, patch: Partial<PurchaseOrderLine>): void {
    this.enqueue((order) => ({
      ...order,
      lines: order.lines.map((line) =>
        line.productId === productId ? { ...line, ...patch } : line),
    }));
  }

  removeLine(productId: number): void {
    this.enqueue((order) => ({
      ...order,
      lines: order.lines.filter((line) => line.productId !== productId),
    }));
  }

  openPicker(): void {
    this.picking.set(true);
  }

  /** In the purchase picker the price shows the supplier's EXW price. */
  readonly exwPriceOf = (product: Product): number => product.exwPrice ?? 0;

  /**
   * Creates a product from the measurements typed in the picker and puts
   * it on the order in one go - measure the article in your hand, done.
   * Photos, barcodes and translations can follow later on the product.
   */
  async quickCreate(draft: ProductDraft): Promise<void> {
    const data = this.view();
    if (!data) return;
    const created = await this.catalog.createProduct({
      id: null, sku: null, name: draft.name,
      dimensions: { lengthCm: draft.lengthCm, widthCm: draft.widthCm,
          heightCm: draft.heightCm },
      colour: '', description: '', categoryId: null,
      supplierId: data.order.supplierId, active: true,
      barcodeInner: '', barcodeOuter: '', hsCode: '',
      carton: { lengthCm: draft.cartonLengthCm, widthCm: draft.cartonWidthCm,
          heightCm: draft.cartonHeightCm,
          piecesPerCarton: draft.piecesPerCarton, weightKg: draft.weightKg },
      exwPrice: draft.exwPrice, exwCurrency: draft.exwCurrency, extraUnitCost: 0,
      landedCostEur: null, landedCostSource: null,
      markupPct: 45, fixedSalesPriceEur: null,
      stockQuantity: 0, photos: [],
    } as unknown as Product);
    this.products.set(await this.catalog.products(data.order.supplierId));
    this.addLine({ product: created, quantity: draft.piecesPerCarton });
    this.ui.toast(`${draft.name} aangemaakt en op de order gezet`);
  }

  addLine(choice: { product: Product; quantity: number }): void {
    this.picking.set(false);
    this.enqueue((order) => ({
      ...order,
      lines: [...order.lines, {
        id: null, productId: choice.product.id!, quantity: choice.quantity,
        exwPrice: null, exwCurrency: null, extraUnitCost: null,
        /* Added after ordering means nothing was agreed for it yet. */
        orderedQuantity: null }],
    }));
  }

  newProduct(): void {
    const data = this.view();
    this.picking.set(false);
    void this.router.navigate(['/products', 'new'], {
      queryParams: { supplier: data?.order.supplierId, returnTo: `/purchasing/${data?.order.id}` },
    });
  }

  /**
   * The calculation as a PDF.
   *
   * What goes on it follows the double-tap switch: with the purchase
   * figures on screen, the desired extra revenue is on the sheet too.
   * Hidden, that line disappears but stays folded into the total - that
   * sheet you can show a customer.
   *
   * Deliberately the same switch and no second checkbox: otherwise you
   * cover the screen and still print the wrong sheet.
   */
  async downloadPdf(): Promise<void> {
    const data = this.view();
    if (!data) return;
    const internal = this.privacy.showPurchase();
    try {
      const blob = await this.sourcing.purchasePdf(data.order.id, internal);
      saveBlob(blob, `${data.order.number}${internal ? '' : '-klantweergave'}.pdf`);
      this.ui.toast(internal
        ? 'Interne PDF gedownload — extra opbrengst als aparte regel'
        : 'Klantweergave gedownload — extra opbrengst zit in de stukprijs');
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'PDF maken mislukt'), 'err');
    }
  }

  /** Copies the calculation to price a variant quickly. */
  async duplicate(): Promise<void> {
    const data = this.view();
    if (!data) return;
    try {
      const copy = await this.sourcing.duplicatePurchaseOrder(data.order.id);
      this.ui.toast('Kopie gemaakt: ' + copy.order.number);
      await this.router.navigate(['/purchasing', copy.order.id, 'edit']);
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Kopiëren mislukt'), 'err');
    }
  }

  apply(): void {
    const data = this.view();
    if (!data) return;
    this.ui.confirm(
      {
        title: 'Kostprijzen toepassen',
        message: 'De berekende kostprijs per stuk wordt op de producten in de catalogus '
          + 'gezet en overschrijft wat daar staat. Alle marges op verkooporders rekenen '
          + 'vanaf dan met deze cijfers.',
        confirmLabel: 'Toepassen',
      },
      async () => {
        await this.sourcing.applyLandedCosts(data.order.id);
        this.ui.toast('Kostprijzen bijgewerkt in de catalogus');
      },
    );
  }

  remove(): void {
    const data = this.view();
    if (!data) return;
    this.ui.confirm(
      { title: 'Calculatie verwijderen',
        message: `Inkooporder <b>${data.order.number}</b> verwijderen?`,
        confirmLabel: 'Verwijderen', danger: true },
      async () => {
        await this.sourcing.deletePurchaseOrder(data.order.id);
        this.ui.toast('Calculatie verwijderd');
        await this.router.navigate(['/purchasing']);
      });
  }
}
