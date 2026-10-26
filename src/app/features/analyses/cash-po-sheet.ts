import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import type { CostBasis, PriceMode, PurchaseOrderForecastWrite } from '../../core/api/models';
import { CashChart, CashChartMarker, CashChartSeries } from '../../shared/cash-chart';
import { DateField } from '../../shared/date-field';
import { Icon } from '../../shared/icon';
import { Segmented, SegmentOption } from '../../shared/segmented';
import type { ChoiceOrigin, PoFlowRow, ResolvedChoice } from '../finance/cash-forecast';
import { dayMon, eurWhole } from '../finance/cash-format';
import { CashPriceEditor } from './cash-price-editor';
import { parseCashAmount } from './cash-price-input';
import { CashState } from './cash-state';
import { likelyPaidText, lineLink, marginOfMarkup, pct, peakMonth, signedWhole } from './cash-view';
import type { CashLink } from './cash-view';

const PRICE_OPTIONS: SegmentOption[] = [
  { id: 'MARKUP_PCT', label: 'Percentage' }, { id: 'EUR_PER_UNIT', label: '€ / stuk' }, { id: 'LIST', label: 'Lijst' }, { id: 'HISTORIC', label: 'Historisch' },
];

/**
 * One container on its own (spec §4.4): what it costs, what its sales bring
 * back and when it is earned back, with the choices for that container
 * only. Each change is stored with the container (desk and phone share it).
 * The desk shows it in the right column instead of the scenario panel, the
 * phone in an iOS sheet whose foot holds "Betalingen" and "Container openen".
 */
@Component({
  selector: 'app-cash-po-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CashPriceEditor, CashChart, DateField, Icon, NgTemplateOutlet, RouterLink, Segmented],
  template: `
    @if (sheet(); as s) {
      <div class="cf-po" [class.cf-po--ios]="ios()">
        @if (!ios()) {
          <header class="cf-po__head">
            <button class="wk-btn wk-btn--ghost wk-btn--sm cf-po__back" type="button" (click)="state.closePo()"><app-icon name="chevron-left" [size]="14" />Scenario</button>
            <h3 class="cf-po__title">{{ s.title }}</h3>
            <button class="wk-btn wk-btn--ghost wk-btn--icon wk-btn--sm" type="button" aria-label="Sluiten" (click)="state.closePo()"><app-icon name="close" [size]="15" /></button>
          </header>
        }
        <div class="cf-po__headline">
          @if (s.partner && !s.choice) {
            <p class="cf-po__partner">{{ s.breakEvenText }}</p>
          } @else {
            <small>{{ s.partner ? 'Netto voor ENROSED' : 'Netto voor deze container' }}</small>
            <strong [class.is-neg]="s.netEur < 0" [class.is-pos]="s.netEur > 0">{{ signed(s.netEur) }}</strong>
            <p>{{ s.breakEvenText }}{{ etaText() }}</p>
          }
        </div>
        @if (lane().length && s.choice) {
          <div class="cf-po__lane">
            <app-cash-chart variant="lane" [series]="lane()" [markers]="laneMarkers()" [today]="state.today" [bufferEur]="null" [height]="ios() ? 150 : 140"
                            ariaLabel="Netto per dag voor deze container" emptyText="Nog geen bewegingen" />
          </div>
        }
        @if (s.partnerScenario; as partner) {
          <details class="cf-partner-summary" [open]="!ios()">
            <summary class="cf-partner-summary__title"><app-icon name="customers" [size]="17" /><b>Partnerafspraak · {{ pctText(partner.profitSharePct) }} % voor ENROSED</b><app-icon name="chevron-down" [size]="14" /></summary>
            <p>Partner financiert {{ pctText(partner.financingPct) }} % van de kost. ENROSED ontvangt {{ pctText(partner.profitSharePct) }} % van het resultaat.</p>
            <dl>
              <div><dt>Verwachte verkoop excl. btw</dt><dd>{{ whole(partner.proceedsEur) }}</dd></div>
              <div><dt>Externe containerkost</dt><dd>{{ whole(partner.externalCostEur) }}</dd></div>
              <div><dt>Resultaat voor ENROSED</dt><dd>{{ signed(partner.profitEur) }}</dd></div>
              <div><dt>Voorschotten verrekend</dt><dd>{{ whole(partner.advanceEur) }}</dd></div>
              <div class="is-total"><dt>Verwachte afrekening excl. btw</dt><dd>{{ signed(partner.settlementEur) }}</dd></div>
            </dl>
            <small>De verkoopmarge stel je hieronder in. De verdeling volgt de afspraak op de container.</small>
          </details>
        }
        <div class="cf-po__figs">
          <div><small>Betaald</small><b>{{ whole(s.paidEur) }}</b></div>
          <div><small>Nog uit</small><b>{{ whole(s.outstandingEur) }}</b></div>
          <div><small>{{ s.partnerScenario ? 'Totaal terug' : 'Terug' }}</small><b class="is-back">{{ whole(s.backEur) }}</b></div>
        </div>

        <!-- While the stored choices are unknown every control here waits: a write would replace them. -->
        <fieldset class="cf-po__choices" aria-label="Keuzes voor deze container" [disabled]="state.choicesFailed()">
          @if (s.choice; as c) {
            <section class="cf-po__sec" aria-label="Verkoop · jouw keuze">
              <h4 class="cf-po__sec-title">Verkoop · jouw keuze @if (c.origin.priceMode === 'stored' || c.origin.markupPct === 'stored' || c.origin.markupEurPerUnit === 'stored') { <span class="cf-adjusted">aangepast</span> }</h4>
              <app-segmented [variant]="ios() ? 'ios' : 'desk'" label="Verkoopprijs" [options]="priceOptions" [value]="c.priceMode" (changed)="change({ priceMode: asPrice($event) })" />
              <div class="cf-po__price">
                @switch (c.priceMode) {
                  @case ('EUR_PER_UNIT') {
                    <label class="cf-po__field"><span>Opslag per stuk</span>
                      <span class="cf-money"><span>€</span><input class="cf-input" type="text" inputmode="decimal" autocomplete="off" aria-label="Opslag per stuk in euro" [value]="decimal(c.markupEurPerUnit)" [attr.aria-invalid]="priceError() ? true : null"
                        (change)="setPerUnit($any($event.target).value)" /></span></label>
                    <p class="cf-po__note">kost per stuk + dit bedrag = marge {{ pctText(s.marginPct) }} %</p>
                  }
                  @case ('LIST') { <p class="cf-po__note">Prijs per product uit de lijstprijs · marge {{ pctText(s.marginPct) }} %</p> }
                  @case ('HISTORIC') { <p class="cf-po__note">Prijs per product uit je facturen van de laatste 12 maanden · marge {{ pctText(s.marginPct) }} %</p> }
                  @default {
                    <app-cash-price-editor [variant]="ios() ? 'ios' : 'desk'" [markupPct]="c.markupPct" (markupPctChange)="change({ markupPct: $event })" />
                  }
                }
                @if (priceError(); as message) { <p class="cf-po__error" role="alert">{{ message }}</p> }
              </div>
            </section>

            <div class="cf-po__cells">
              <div class="cf-po__cell">
                <span class="cf-po__cell-head"><span>Kost</span>@if (stored(c, 'costBasis')) { <span class="cf-adjusted">aangepast</span> }</span>
                <app-segmented [variant]="ios() ? 'ios' : 'desk'" label="Kostbasis" [options]="basisOptions()" [value]="c.costBasis" (changed)="change({ costBasis: asBasis($event) })" />
              </div>
              <div class="cf-po__cell cf-po__cell--row">
                <span class="cf-po__cell-head"><span>Verkocht in</span>@if (stored(c, 'sellWeeks')) { <span class="cf-adjusted">aangepast</span> }
                  <small>tempo laatste 90 d: {{ c.defaultSellWeeks }} weken</small></span>
                <span class="cf-step" role="group" aria-label="Verkocht in, weken">
                  <button type="button" aria-label="Een week minder" [disabled]="c.sellWeeks <= 1" (click)="change({ sellWeeks: c.sellWeeks - 1 })">−</button>
                  <output>{{ c.sellWeeks }} w</output>
                  <button type="button" aria-label="Een week meer" [disabled]="c.sellWeeks >= 104" (click)="change({ sellWeeks: c.sellWeeks + 1 })">+</button>
                </span>
              </div>
              <div class="cf-po__cell cf-po__cell--row">
                <span class="cf-po__cell-head"><span>Klant betaalt na</span>@if (stored(c, 'paymentDays')) { <span class="cf-adjusted">aangepast</span> }
                  <small>gemiddelde uit je facturen</small></span>
                <span class="cf-step" role="group" aria-label="Klant betaalt na, dagen">
                  <button type="button" aria-label="Een week vroeger" [disabled]="c.paymentDays <= 0" (click)="change({ paymentDays: Math.max(0, c.paymentDays - 7) })">−</button>
                  <output>{{ c.paymentDays }} d</output>
                  <button type="button" aria-label="Een week later" [disabled]="c.paymentDays >= 365" (click)="change({ paymentDays: Math.min(365, c.paymentDays + 7) })">+</button>
                </span>
              </div>
              <label class="cf-po__cell cf-po__cell--row">
                <span class="cf-po__cell-head"><span>Seizoen volgen</span>@if (stored(c, 'seasonal')) { <span class="cf-adjusted">aangepast</span> }
                  <small>{{ peak() ? 'Piek in ' + peak() : 'te weinig historiek' }}</small></span>
                <input class="cf-switch" type="checkbox" [checked]="c.seasonal && c.seasonalAvailable" [disabled]="!c.seasonalAvailable" (change)="change({ seasonal: $any($event.target).checked })" />
              </label>
              <label class="cf-po__cell cf-po__cell--row">
                <span class="cf-po__cell-head"><span>In het scenario</span>@if (stored(c, 'included')) { <span class="cf-adjusted">aangepast</span> }
                  <small>meetellen in het saldo hierboven</small></span>
                <input class="cf-switch" type="checkbox" [checked]="c.included" (change)="change({ included: $any($event.target).checked })" />
              </label>
            </div>
          }

          @if (s.departure; as departure) {
            <div class="cf-po__cells" id="cf-po-departure">
              <div class="cf-po__cell">
                <span class="cf-po__cell-head"><span>Vertrek</span>@if (departure.stored) { <span class="cf-adjusted">aangepast</span> }</span>
                <p class="cf-po__value">{{ departure.certainty === 'FIXED' ? '' : '± ' }}{{ dayMon(departure.date) }} · {{ departure.certainty === 'FIXED' ? 'Vast' : 'Geschat' }} ({{ departure.ruleText }})</p>
                <div class="cf-po__date">
                  <span>Datum vastleggen</span>
                  <app-date-field [fieldId]="'cf-ship-' + s.orderId" [value]="storedRow()?.expectedShipOn ?? ''" (valueChange)="change({ expectedShipOn: $event || null })" />
                  @if (departure.stored) { <button class="wk-link" type="button" (click)="change({ expectedShipOn: null })">Wissen</button> }
                </div>
              </div>
            </div>
          }
          @if (s.status === 'CONCEPT' && s.choice) {
            <div class="cf-po__cells">
              <div class="cf-po__cell">
                <span class="cf-po__cell-head"><span>Bestellen op</span>@if (storedRow()?.orderDateOverride) { <span class="cf-adjusted">aangepast</span> }</span>
                <div class="cf-po__date">
                  <app-date-field [fieldId]="'cf-order-' + s.orderId" [value]="s.choice?.orderDate ?? ''" (valueChange)="change({ orderDateOverride: $event || null })" />
                  @if (storedRow()?.orderDateOverride) { <button class="wk-link" type="button" (click)="change({ orderDateOverride: null })">Wissen</button> }
                </div>
              </div>
            </div>
          }
        </fieldset>

        @if (error(); as message) { <p class="cf-po__error" role="alert">{{ message }}</p> }
        <div class="cf-po__store" role="status" aria-live="polite">
          @if (state.choicesFailed()) {
            <span class="cf-po__failed">Keuzes konden niet laden</span>
            <button class="wk-link" type="button" [disabled]="state.sources.refreshing()" (click)="state.retryChoices()">Opnieuw</button>
          } @else if (state.cashRound()) {
            @if (state.choiceStatus(s.orderId) === 'saving') {
              <span>Bezig met bewaren…</span>
            } @else if (state.choiceStatus(s.orderId) === 'error') {
              <span class="cf-po__failed">Nog niet bewaard</span>
              <button class="wk-link" type="button" (click)="state.retryChoice(s.orderId)">Opnieuw bewaren</button>
            } @else { <span>{{ storedRow() ? 'Bewaard bij de container.' : 'Volgt het standaardscenario.' }}</span> }
            @if (storedRow()) { <button class="wk-link" type="button" (click)="state.resetChoice(s.orderId)">Terug naar standaard</button> }
          } @else {
            <span>Bewaren bij de container kan zodra de server bijgewerkt is.</span>
          }
        </div>

        @if (s.partnerScenario) { <p class="cf-po__note cf-po__receipt-note">Totaal terug = voorschotten + verwachte afrekening, excl. btw.</p> }
        <section class="cf-po__sec" aria-label="Geldstroom">
          <h4 class="cf-po__sec-title">Geldstroom <small>excl. btw</small></h4>
          <div class="cf-flows">
            <!-- A paid row opens its bank line, an open one the container's payments (design C.7). -->
            @for (flow of s.flows; track $index) {
              @if (flowLink(flow, s.orderId); as link) {
                <a class="cf-flow cf-flow--link" [attr.data-kind]="flow.kind" [routerLink]="link.path" [queryParams]="link.query"><ng-container *ngTemplateOutlet="flowBody; context: { $implicit: flow }" /></a>
              } @else {
                <div class="cf-flow" [attr.data-kind]="flow.kind"><ng-container *ngTemplateOutlet="flowBody; context: { $implicit: flow }" /></div>
              }
              @if (flow.kind === 'likely' && likelyFor(flow); as match) {
                <div class="cf-likely" role="note">
                  <p>{{ likelyText(match) }}</p>
                  <div class="cf-likely__actions">
                    <a class="wk-btn wk-btn--sm wk-btn--primary" routerLink="/costs" [queryParams]="{ view: 'bank', tab: 'movements', line: match.lineId }">Koppelen</a>
                    <button class="wk-btn wk-btn--sm" type="button" (click)="state.dismiss(match.lineId + ':' + match.itemKey)">Niet deze</button>
                  </div>
                </div>
              }
            }
          </div>
          <p class="cf-flows__total">Uit <b>{{ whole(s.paidEur + s.outstandingEur) }}</b> · Terug <b class="is-back">{{ whole(s.backEur) }}</b> · Netto <b>{{ signed(s.netEur) }}</b></p>
        </section>

        @if (s.products.length) {
          <section class="cf-po__sec" aria-label="Per product">
            <h4 class="cf-po__sec-title">Per product <small>uit de nacalculatie</small></h4>
            <div class="cf-products">
              @for (product of s.products; track $index) {
                @if (product.productId !== null) {
                  <a class="cf-product cf-product--link" [routerLink]="['/products', product.productId]">
                    <span><b>{{ product.name }}</b><small>{{ units(product.units) }} st · kost {{ unitEur(product.costUnitEur) }} → {{ unitEur(product.priceUnitEur) }}</small></span>
                    <strong>{{ whole(product.backEur) }}</strong>
                  </a>
                } @else {
                  <div class="cf-product">
                    <span><b>{{ product.name }}</b><small>{{ units(product.units) }} st · kost {{ unitEur(product.costUnitEur) }} → {{ unitEur(product.priceUnitEur) }}</small></span>
                    <strong>{{ whole(product.backEur) }}</strong>
                  </div>
                }
              }
            </div>
            <p class="cf-po__note">{{ s.partner ? "Verwachte verkoopopbrengst per product, vóór de partnerverdeling hierboven." : "Kost en verkoopprijs per product, excl. btw." }}</p>
          </section>
        }

        @if (!ios()) {
          <footer class="cf-po__foot">
            <a class="wk-btn" routerLink="/costs" [queryParams]="{ container: s.orderId }">Betalingen</a>
            <a class="wk-btn wk-btn--primary" [routerLink]="['/purchasing', s.orderId]">Container openen</a>
          </footer>
        }
      </div>
    } @else {
      <div class="cf-po cf-po--empty">
        @if (!ios()) {
          <header class="cf-po__head"><button class="wk-btn wk-btn--ghost wk-btn--sm cf-po__back" type="button" (click)="state.closePo()"><app-icon name="chevron-left" [size]="14" />Scenario</button></header>
        }
        <p class="cf-po__note">{{ state.input() ? 'Deze inkooporder staat niet (meer) in de lijst.' : 'Laden…' }}</p>
      </div>
    }

    <ng-template #flowBody let-flow>
      <span class="cf-flow__date">{{ flowDate(flow) }}</span>
      <span class="cf-flow__body"><b>{{ flow.title }}</b><small>{{ flow.status }}</small></span>
      <span class="cf-flow__amt" [class.is-in]="flow.kind === 'sales'">{{ flow.kind === 'internal' ? '(' + whole(flow.amountEur) + ')' : signed(flow.amountEur) }}</span>
    </ng-template>
  `,
})
export class CashPoSheet {
  readonly state = inject(CashState);
  readonly variant = input<'desk' | 'ios'>('desk');

  protected readonly Math = Math;
  readonly ios = computed(() => this.variant() === 'ios');
  readonly priceOptions = PRICE_OPTIONS;
  readonly dayMon = dayMon;
  readonly pctText = pct;
  readonly margin = marginOfMarkup;
  readonly whole = eurWhole;
  readonly signed = signedWhole;
  readonly likelyText = likelyPaidText;

  readonly sheet = this.state.sheet;
  readonly order = computed(() => {
    const sheet = this.sheet();
    return sheet ? this.state.input()?.orders.find((row) => row.orderId === sheet.orderId) ?? null : null;
  });
  readonly storedRow = computed(() => {
    const sheet = this.sheet();
    return sheet ? this.state.storedFor(sheet.orderId) : null;
  });
  /* "vorig jaar −2,5 %": the raw 12-month markup, a choice he can still tap even when it is too thin to be the default (critique B4). */
  readonly realised = computed(() => { const history = this.state.input()?.history; return history?.realisedSample?.markupPct ?? history?.realisedMarkupPct ?? null; });
  readonly peak = computed(() => peakMonth(this.state.input()?.history.seasonal ?? null));
  readonly error = computed(() => {
    const sheet = this.sheet();
    return sheet ? this.state.choiceErrors()[sheet.orderId] ?? null : null;
  });

  readonly basisOptions = computed<SegmentOption[]>(() => {
    const lines = this.order()?.lines ?? [];
    const external = lines.reduce((sum, line) => sum + line.externalEur, 0);
    const pricing = lines.reduce((sum, line) => sum + line.pricingEur, 0);
    return [{ id: 'EXTERNAL', label: `Extern ${eurWhole(external)}` }, { id: 'PRICING', label: `+ Enrosed-kost ${eurWhole(pricing)}` }];
  });

  readonly etaText = computed(() => {
    const order = this.order();
    if (!order || (order.status !== 'BESTELD' && order.status !== 'ONDERWEG')) return '';
    return order.expectedArrival ? ` · ETA ${dayMon(order.expectedArrival)}` : '';
  });

  readonly lane = computed<CashChartSeries[]>(() => {
    const sheet = this.sheet();
    return sheet && sheet.lane.length > 1 ? [{ id: 'lane', label: 'Netto voor deze container', points: sheet.lane, style: 'solid', tone: 'accent' }] : [];
  });
  readonly laneMarkers = computed<CashChartMarker[]>(() => {
    const sheet = this.sheet();
    return sheet?.breakEvenOn ? [{ day: sheet.breakEvenOn, eur: 0, kind: 'breakeven', label: `Terugverdiend ${dayMon(sheet.breakEvenOn)}` }] : [];
  });

  stored(choice: ResolvedChoice, field: keyof ResolvedChoice['origin']): boolean {
    return (choice.origin[field] as ChoiceOrigin) === 'stored';
  }

  change(change: Partial<PurchaseOrderForecastWrite>): void {
    const sheet = this.sheet();
    if (sheet) this.state.changeChoice(sheet.orderId, change);
    this.priceError.set(null);
  }

  asPrice(value: string): PriceMode { return value as PriceMode; }
  asBasis(value: string): CostBasis { return value as CostBasis; }

  readonly priceError = signal<string | null>(null);

  setPerUnit(raw: string): void {
    const parsed = parseCashAmount(raw);
    if (parsed.error !== null) { this.priceError.set(parsed.error); return; }
    this.change({ markupEurPerUnit: parsed.value });
  }

  flowDate(flow: PoFlowRow): string {
    if (!flow.date) return '—';
    return `${flow.approx ? '~' : ''}${dayMon(flow.date)}`;
  }

  /** A paid row with its bank line → the transaction; an open term → the container's payments; the rest stays text. */
  flowLink(flow: PoFlowRow, orderId: number): CashLink | null {
    if (flow.kind === 'paid') return flow.lineId !== null ? lineLink(flow.lineId) : null;
    return flow.kind === 'open' ? { path: ['/costs'], query: { container: orderId }, po: null } : null;
  }

  likelyFor(flow: PoFlowRow) {
    return this.sheet()?.likelyPaid.find((match) => match.lineId === flow.lineId) ?? null;
  }

  units(value: number): string {
    return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  /** '€ 11,1000': four decimals, the nacalculatie's precision. */
  unitEur(value: number): string {
    const [whole, fraction = ''] = value.toFixed(4).split('.');
    return `€ ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${fraction}`;
  }

  /** '1,5' for an amount field (Dutch comma, up to four decimals). */
  decimal(value: number): string {
    return String(Math.round(value * 10000) / 10000).replace('.', ',');
  }
}
