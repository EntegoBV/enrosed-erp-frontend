import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { PartnerFinancing, Payee, PurchaseOrderView } from '../../core/api/models';
import { Icon } from '../../shared/icon';
import { EurPipe, NumPipe } from '../../shared/pipes';
import { Skeleton } from '../../shared/skeleton';
import { Sheet } from '../../shared/ui';
import { PurchaseNacalcFooter } from './purchase-nacalc-footer';
import {
  nacalcPartnerLine, nacalcPartnerShortage, pctLabel, nacalcPhoneNotes, nacalcReceiptUnitLine, nacalcMixBasis, nacalcUnitBasis,
  type NacalcProductRow, type NacalcTone, type PurchaseNacalc,
} from './purchase-nacalc-metrics';
import {
  PAYEE_LABEL, type LedgerTodo, type LedgerTone, type PaymentLedger, type PurchasePaymentAction, type PurchaseSettleRequest, type SupplierCreditAction,
} from './purchase-payment-ledger';
import { formatEur, todoCopy } from './purchase-payment-menus';
import { mixPricingRange, mixQuantity, mixRange, mixReceiptLine } from './purchase-payment-result-metrics';
import {
  afspraakBridge, nacalcChain, nacalcGrossLine, productRows, productSheetRows, settledMeter, storySub, storyVerschil,
  type ChainRow, type PhoneAmount, type PhoneTone, type SheetRow,
} from './purchase-phone-money';

/**
 * The nacalculatie on the phone, as one story (2026-10-25): the top of the
 * Kosten tab of an ordered container and step 3 of the editor. One card with
 * the Eindkost, the Afspraak and the Verschil in one net figure; where the
 * difference sits per payee and per term, with at most one action cell and
 * the gross figures as one sentence; the receipt; per product with the
 * list visible; the cost basis with the bridge to the Afspraak behind a
 * disclosure; the partner, the notes, and (unless the host places it) the
 * footer with the PDF and the ways to Betalingen and Kosten & bank. The payee sheet belongs to the host; the
 * small product sheet opens here. Styles: styles/purchase-nacalc.scss (.np-*).
 */
@Component({
  selector: 'app-purchase-nacalc-overview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, RouterLink, Sheet, Skeleton, EurPipe, NumPipe, PurchaseNacalcFooter],
  template: `
    <div class="np" id="purchase-payment-result" tabindex="-1" aria-label="Nacalculatie">
      <div class="ios-section__head ios-section__head--prominent np-head">
        <h2>Nacalculatie</h2>
        @if (nacalc(); as n) { <span class="wk-pill np-pill" [class]="pillClass(n.headline.pill.tone)">{{ n.headline.pill.label }}</span> }
      </div>

      @if (nacalc(); as n) {
        @let head = n.headline;
        @let concept = head.kind === 'concept';
        <!-- The story in one card: the Eindkost and how it is made, the Afspraak, the Verschil in one net figure. -->
        <section class="ios-section">
          <div class="ios-card np-story">
            <div class="ios-headline">
              <div class="ios-headline__label">{{ head.label }}</div>
              <div class="ios-headline__value">{{ head.eindkostEur | eur }}</div>
              <div class="ios-headline__sub">{{ storySub(head) }}</div>
            </div>
            @if (!concept && ledger(); as book) {
              @let meter = meterOf(book.summary);
              <span class="wk-meter np-story__meter" role="img" [attr.aria-label]="'Betaald of afgerekend ' + round(meter.paidPct) + '%, nu te betalen ' + round(meter.duePct) + '%, later ' + round(meter.laterPct) + '%'" title="betaald · nu te betalen · later">
                <i class="tone-ok" [style.width.%]="meter.paidPct"></i><i class="tone-warn" [style.width.%]="meter.duePct"></i><i class="is-rest" [style.width.%]="meter.laterPct"></i>
              </span>
            }
            @if (!concept) {
              <!-- Afspraak + Verschil (+ Nakijken) = the Eindkost above; bijkomend and the koersverschil are in its line ('incl.'). -->
              @let split = storyVerschil(head);
              <dl class="wk-equation">
                <div><dt>Afspraak</dt><dd>{{ head.begrootEur | eur }}</dd></div>
                @if (split.verschil; as verschil) {
                  <div class="is-total"><dt>Verschil@if (split.pct) { <small> · {{ split.pct }}</small> }</dt><dd [class]="amountTone(verschil.tone)">{{ verschil.text }}</dd></div>
                }
                @if (split.review; as review) { <div [class.is-total]="!split.verschil"><dt>Nakijken</dt><dd class="wk-amount--warn">{{ review.text }}</dd></div> }
              </dl>
            }
          </div>
          <p class="ios-section__foot">{{ concept ? 'De nacalculatie begint bij de bestelling: zodra betalingen genoteerd zijn, zie je hier wat de container echt kost.' : head.sentence }}</p>
        </section>

        @if (!concept) {
          <section class="ios-section" aria-label="Waar het verschil zit">
            <div class="ios-section__head"><h2>Waar het verschil zit</h2><span class="ios-section__trail">afspraak → eindkost</span></div>
            @if (state() === 'error') {
              <p class="ios-caption np-caption">Betalingen niet actueel <button class="ios-capsule" type="button" (click)="refresh.emit()">Opnieuw laden</button></p>
            } @else if (!n.payees || state() === 'loading') {
              <div class="ios-group np-skeleton"><app-skeleton kind="list" [rows]="3" /></div>
            } @else {
              <!-- A card, not an icon list: name and Verschil fit on line 1 at 375 px, afspraak → eindkost and one word on line 2. -->
              <div class="ios-card np-chain">
                @for (row of chain(); track row.key) {
                  <button class="np-chain__row" type="button" [class.np-chain__row--term]="row.kind === 'term'" [class.np-chain__row--warn]="row.warn"
                          [attr.aria-label]="chainLabel(row)" (click)="openPayee.emit(row.payee)">
                    <span class="np-chain__name">{{ row.name }}</span>
                    <span class="np-chain__amount" [class]="amountTone(row.amount.tone)">{{ row.amount.text }}</span>
                    @if (row.kind === 'payee') { <app-icon class="np-chain__chev" name="chevron-right" [size]="14" /> }
                    <span class="np-chain__line"><span class="np-chain__sub">{{ row.line }}</span>@if (row.word; as word) { <span class="np-chain__word" [class]="tone(word.tone)">{{ word.word }}</span> }</span>
                  </button>
                }
              </div>
              @if (todo(); as todo) {
                <div class="ios-group np-chain__todo">
                  <button class="ios-cell ios-cell--action np-action" type="button" [disabled]="busy() || (dirty() && todo.kind !== 'incomplete')" (click)="runTodo(todo)">{{ todoLabel(todo) }}</button>
                </div>
              }
              @if (dirty() && mode() === 'edit') {
                <p class="ios-section__foot">Sla de container op om af te rekenen of te exporteren.</p>
              } @else if (grossLine(); as gross) {
                <!-- What Emre asked about ('minder en meer betaald'): bruto both figures, netto the Verschil. -->
                <p class="ios-section__foot">{{ gross }}</p>
              }
            }
          </section>
        }

        @if (n.receipt; as receipt) {
          <section class="ios-section" aria-label="Ontvangst">
            <div class="ios-section__head"><h2>Ontvangst</h2></div>
            <div class="ios-group">
              @if (receipt.clean) {
                <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Alles volgens bestelling</span></span><span class="ios-cell__trail"><span class="ios-cell__value">{{ receipt.usable | num }} {{ head.unitPlural }}</span></span></div>
              } @else {
                <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Besteld → bruikbaar</span></span><span class="ios-cell__trail"><span class="ios-cell__value ios-cell__value--strong">{{ receipt.ordered | num }} → {{ receipt.usable | num }}</span></span></div>
                @if (receipt.missing > 0) {
                  <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Te weinig</span></span><span class="ios-cell__trail"><span class="ios-cell__value wk-amount--warn">{{ receipt.missing | num }}@if (receipt.missingValueEur !== null) { · {{ receipt.missingValueEur | eur }} }</span></span></div>
                }
                @if (receipt.damaged > 0) {
                  <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Beschadigd</span></span><span class="ios-cell__trail"><span class="ios-cell__value np-danger">{{ receipt.damaged | num }}@if (receipt.damagedValueEur !== null) { · {{ receipt.damagedValueEur | eur }} }</span></span></div>
                }
                @if (receipt.over > 0) {
                  <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Te veel</span><span class="ios-cell__sub">noteer de extra factuur als Leverancier en reken hoger af</span></span><span class="ios-cell__trail"><span class="ios-cell__value">{{ receipt.over | num }} · ≈ @if (receipt.overValueEur === null) { — } @else { {{ receipt.overValueEur | eur }} } extra factuur</span></span></div>
                }
                @if (receipt.missing > 0 || receipt.damaged > 0) {
                  <div class="ios-cell ios-cell--tall"><span class="ios-cell__body"><span class="ios-cell__title ios-cell__title--strong">Verlies op inkoopwaarde</span><span class="ios-cell__sub">goederenwaarde bij ontvangst, excl. transport</span></span>
                    <span class="ios-cell__trail"><span class="ios-cell__value ios-cell__value--strong">@if (receipt.lossEur === null) { — } @else { {{ receipt.lossEur | eur }} }</span>
                      @if (receipt.supplierFact; as fact) { <span class="ios-cell__meta">{{ fact.kind === 'settled-lower' ? 'leverancier afgerekend met ' + eur(fact.amountEur) + ' minder' : fact.kind === 'open' ? 'nog ' + eur(fact.amountEur) + ' open bij de leverancier' : receipt.credit ? 'leverancier volledig betaald' : 'leverancier volledig betaald · noteer een tegoed' }}</span> }</span></div>
                }
                @if (receipt.unvaluedPieces > 0) {
                  <a class="ios-cell" routerLink="/analyses/purchasing" [queryParams]="{ orderId: orderId() }"><span class="ios-cell__body"><span class="ios-cell__title">{{ receipt.unvaluedPieces | num }} {{ head.unitPlural }} zonder inkoopwaarde</span><span class="ios-cell__sub">tellen niet mee · waarde vastleggen</span></span><app-icon class="ios-cell__chev" name="chevron-right" [size]="16" /></a>
                }
              }
              @if (receipt.credit; as credit) {
                <button class="ios-cell ios-cell--tall" type="button" (click)="openPayee.emit('SUPPLIER')">
                  <span class="ios-cell__body"><span class="ios-cell__title">Tegoed leverancier</span><span class="ios-cell__sub">{{ credit.openEur > 0 ? eur(credit.openEur) + ' nog te ontvangen' : 'terugbetaald of verrekend' }} · verlaagt de eindkost</span></span>
                  <span class="ios-cell__trail"><span class="ios-cell__value ios-cell__value--strong wk-amount--in">− {{ credit.totalEur | eur }}</span></span>
                  <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
                </button>
              }
              @if (!receipt.clean || receipt.credit) {
                <button class="ios-cell ios-cell--action" type="button" [disabled]="busy() || (mode() === 'edit' && dirty())" (click)="credit.emit({ kind: 'add' })">Tegoed noteren…</button>
              }
              @if (receipt.later; as later) {
                <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Na uitpakken: @if (later.damaged) { {{ later.damaged | num }} beschadigd }@if (later.damaged && later.missing) { / }@if (later.missing) { {{ later.missing | num }} te weinig }</span><span class="ios-cell__sub">niet in de kostprijs verwerkt</span></span></div>
              }
              <!-- Only the read view renders the reports card; the editor has no reports to scroll to. -->
              @if (mode() === 'read' && (receipt.later || view().receiptReports?.length)) {
                <button class="ios-cell ios-cell--action" type="button" (click)="openReports.emit()">Schade en tekorten ›</button>
              }
            </div>
            @if (!receipt.clean && receiptLine(receipt); as line) {
              <p class="ios-section__foot">{{ line }}. Inkoopwaarde = goederenprijs per {{ head.setBasis === 'DISPLAY' ? 'display' : head.setBasis === 'MIXED' ? 'display of stuk' : 'stuk' }} tegen de orderkoers.</p>
            }
          </section>
        }

        <!-- Per product, the list visible: what each costs per unit, incl. Enrosed kost, and its Verschil; a tap shows the rest. -->
        <section class="ios-section" aria-label="Per product">
          <div class="ios-section__head"><h2>Per product</h2><span class="ios-section__trail">{{ n.products.length }} {{ n.products.length === 1 ? 'product' : 'producten' }}</span></div>
          <div class="ios-group">
            @if (n.mix.uniform) {
              <div class="ios-cell np-range"><span class="ios-cell__body"><span class="ios-cell__title">{{ head.unitLabel }}</span><span class="ios-cell__sub">{{ unitBasis(n) }}</span></span>
                <span class="ios-cell__trail"><span class="ios-cell__value ios-cell__value--strong">@if (head.stripUnitEur !== null) { {{ head.stripUnitEur | eur: 4 }} } @else { — }</span></span></div>
              <div class="ios-cell np-range"><span class="ios-cell__body"><span class="ios-cell__title">Incl. Enrosed kost</span><span class="ios-cell__sub">per {{ head.setBasis === 'DISPLAY' ? 'display' : 'stuk' }}@if (head.setBasis === 'DISPLAY' && head.pricingPieceEur !== null) { · {{ head.pricingPieceEur | eur: 4 }} per stuk }</span></span>
                <span class="ios-cell__trail"><span class="ios-cell__value">@if (head.stripPricingEur !== null) { {{ head.stripPricingEur | eur: 4 }} } @else { — }</span></span></div>
            } @else {
              <!-- Several products: their range, never an average over them. -->
              <div class="ios-cell np-range"><span class="ios-cell__body"><span class="ios-cell__title">Per {{ n.mix.unit }}</span><span class="ios-cell__sub">@if (quantity(n); as line) { {{ line }} }{{ mixBasis(n) }}</span></span>
                <span class="ios-cell__trail"><span class="ios-cell__value ios-cell__value--strong">{{ range(n) }}</span></span></div>
              <div class="ios-cell np-range"><span class="ios-cell__body"><span class="ios-cell__title">Incl. Enrosed kost</span><span class="ios-cell__sub">per {{ n.mix.unit }}</span></span>
                <span class="ios-cell__trail"><span class="ios-cell__value">{{ pricingRange(n) ?? '—' }}</span></span></div>
            }
            @for (line of productLines(); track line.row.productId ?? line.row.name) {
              <button class="ios-cell np-product" type="button" (click)="productOpen.set(line.row)">
                <span class="ios-cell__body"><span class="ios-cell__title">{{ line.row.name }}</span>
                  <span class="np-product__line"><span class="ios-cell__sub"><b>{{ line.unitText }}</b>@if (line.inclText) { · {{ line.inclText }} }</span>
                    <span class="ios-cell__meta" [class]="amountTone(line.verschil.tone)">{{ line.verschil.text }}</span></span></span>
                <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
              </button>
            } @empty {
              <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__sub">Geen productregels</span></span></div>
            }
            @if (n.products.length > 5 && !showAllProducts()) {
              <button class="ios-cell ios-cell--action" type="button" (click)="showAllProducts.set(true)">Toon alle {{ n.products.length }} producten</button>
            }
          </div>
        </section>

        <section class="ios-section" aria-label="Kostbasis">
          <div class="ios-section__head"><h2>Kostbasis</h2></div>
          <div class="ios-group">
            <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Enrosed kost</span><span class="ios-cell__sub">intern, geen betaling</span></span><span class="ios-cell__trail"><span class="ios-cell__value">{{ head.markupEur | eur }}</span></span></div>
            <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Kostbasis voor prijzen</span><span class="ios-cell__sub">{{ concept ? 'verwachte eindkost' : 'eindkost' }} + Enrosed kost</span></span><span class="ios-cell__trail"><span class="ios-cell__value ios-cell__value--strong">{{ head.pricingEur | eur }}</span></span></div>
            <details class="ios-disclosure np-disclosure">
              <summary>Van calculatie naar afspraak<app-icon class="ios-cell__chev" name="chevron-right" [size]="16" /></summary>
              <!-- Up to the Afspraak only: paid, open, the eindkost and the Verschil stand in the card at the top. -->
              <div class="np-disclosure__body">
                <dl class="wk-equation">
                  @for (row of bridge(); track row.key) {
                    <div [class.is-total]="row.op === '='">
                      <dt>@if (row.op && row.op !== '→') { <span class="wk-equation__op" aria-hidden="true">{{ row.op }}</span> }{{ row.label }}@if (row.note) { <small> · {{ row.note }}</small> }</dt>
                      <dd>{{ row.amountEur | eur }}</dd>
                    </div>
                  }
                </dl>
                @if (!n.bridge.consistent) { <p class="ios-caption">De onderdelen sluiten niet exact aan; controleer de kosten.</p> }
              </div>
            </details>
            <!-- The phone has no Afronden tab: the read view hands the step to the editor, which opens the apply sheet as the dock does. -->
            @if (n.receipt && head.kind === 'final') { <button class="ios-cell ios-cell--action" type="button" (click)="applyCosts.emit()">Kostprijzen toepassen ›</button> }
          </div>
        </section>

        @if (n.partner; as partner) {
          <section class="ios-section" aria-label="Partner">
            <div class="ios-section__head"><h2>Partner</h2></div>
            <div class="ios-group">
              <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Partner financiert</span>@if (partner.basisEur !== null) { <span class="ios-cell__sub np-wrap">op {{ partner.basisEur | eur }} incl. Enrosed kost en aparte kosten</span> }</span>
                <span class="ios-cell__trail"><span class="ios-cell__value ios-cell__value--strong">{{ pctLabel(partner.costPct) }}@if (partner.advanceEur !== null) { · {{ partner.advanceEur | eur }} }</span></span></div>
              <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Resultaat voor ENROSED</span></span><span class="ios-cell__trail"><span class="ios-cell__value">{{ pctLabel(partner.sharePct) }}</span></span></div>
              @if (partnerState() === 'loading') {
                <div class="ios-cell np-skeleton"><app-skeleton kind="lines" [rows]="2" /></div>
              } @else if (partnerState() === 'error') {
                <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__sub">Partnerfinanciering niet beschikbaar</span></span><button class="ios-capsule" type="button" (click)="refreshPartner.emit()">Opnieuw laden</button></div>
              } @else if (partner.financing; as fin) {
                <!-- The money-in figures live on the Partner tab; here they fold away so the Kosten stop stays short. -->
                <details class="ios-disclosure np-disclosure">
                  <summary>Voorschot en afrekening <span class="np-disclosure__count">{{ fin.settlementNumber ? (fin.settlementComplete ? 'afgerekend' : 'deels afgerekend') : 'ontvangen ' + eur(fin.receivedAdvanceEur) }}</span><app-icon class="ios-cell__chev" name="chevron-right" [size]="16" /></summary>
                  <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Voorschot ontvangen</span><span class="ios-cell__sub np-wrap">incl. btw · open {{ fin.openAdvanceEur | eur }} · gefactureerd {{ fin.invoicedAdvanceEur | eur }} excl. btw@if (fin.committedAdvanceEur) { · afgesproken {{ fin.committedAdvanceEur | eur }} }</span></span><span class="ios-cell__trail"><span class="ios-cell__value">{{ fin.receivedAdvanceEur | eur }}</span></span></div>
                  <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Eigen geld ingelegd</span></span><span class="ios-cell__trail"><span class="ios-cell__value">{{ fin.ownExposureEur | eur }}</span></span></div>
                  <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Afgerekend met de partner</span>@if (fin.settlementNumber) { <span class="ios-cell__sub">{{ fin.settlementComplete ? 'slotfactuur' : 'deelfactuur' }}</span> }</span><span class="ios-cell__trail"><span class="ios-cell__value">{{ fin.settlementNumber ?? 'nog niet' }}</span></span></div>
                  @if (fin.creditEur > 0) { <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Tegoed partner</span><span class="ios-cell__sub">terug te betalen of te verrekenen</span></span><span class="ios-cell__trail"><span class="ios-cell__value wk-amount--warn">{{ fin.creditEur | eur }}</span></span></div> }
                  @if (fin.unbilledCount > 0) { <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__sub">{{ fin.unbilledCount }} {{ fin.unbilledCount === 1 ? 'voorschottermijn' : 'voorschottermijnen' }} nog te factureren</span></span></div> }
                </details>
              }
              <div class="ios-cell ios-cell--tall"><span class="ios-cell__body"><span class="ios-cell__title">Bij de afrekening</span><span class="ios-cell__sub np-wrap">{{ partnerLine(partner, head) }}</span></span></div>
              <button class="ios-cell ios-cell--action" type="button" (click)="openPartner.emit()">Partnerfinanciering ›</button>
            </div>
            @if (partner.shortPieces > 0) {
              <p class="ios-section__foot wk-amount--warn">{{ partnerShortage(partner, head) }}</p>
            }
          </section>
        }

        <section class="ios-section" aria-label="Toelichting">
          <div class="ios-section__head"><h2>Toelichting</h2></div>
          <div class="ios-group">
            <details class="ios-disclosure np-disclosure">
              <summary>Hoe is dit berekend?<app-icon class="ios-cell__chev" name="chevron-right" [size]="16" /></summary>
              <ul class="np-notes">@for (note of notes(); track $index) { <li>{{ note }}</li> }</ul>
            </details>
          </div>
        </section>

        <!-- The read view puts these ways out at the end of the Kosten tab, after the Calculatie ([footer]="false"). -->
        @if (footer()) { <app-purchase-nacalc-footer [orderId]="orderId()" [orderNumber]="view().order.number" [dirty]="dirty()" (openPayments)="openPayments.emit()" /> }
      } @else {
        <p class="ios-caption np-caption">De nacalculatie is nog niet beschikbaar. Vernieuw de order om de actuele betalingen op te halen.
          <button class="ios-capsule" type="button" (click)="refresh.emit()">Vernieuwen</button></p>
      }
    </div>
    @if (productOpen(); as row) {
      <!-- One product: its quantity, Afspraak, Eindkost and Verschil, then per unit; the product page one tap further. -->
      <app-sheet [title]="row.name" variant="ios" (closed)="productOpen.set(null)">
        <div body class="np-product-sheet">
          <div class="ios-group">
            @for (cell of productSheet(row); track cell.label) {
              <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">{{ cell.label }}</span>@if (cell.sub) { <span class="ios-cell__sub">{{ cell.sub }}</span> }</span>
                <span class="ios-cell__trail"><span class="ios-cell__value" [class.ios-cell__value--strong]="cell.strong" [class]="amountTone(cell.tone ?? 'none')">{{ cell.value }}</span></span></div>
            }
          </div>
        </div>
        <div foot style="display:contents">
          <button class="btn" type="button" (click)="productOpen.set(null)">Sluiten</button>
          @if (row.productId) { <a class="btn btn--primary" [routerLink]="['/products', row.productId]">Naar product</a> }
        </div>
      </app-sheet>
    }
  `,
})
export class PurchaseNacalcOverview {
  readonly view = input.required<PurchaseOrderView>();
  readonly ledger = input<PaymentLedger | null>(null);
  readonly nacalc = input<PurchaseNacalc | null>(null);
  readonly partner = input<PartnerFinancing | null | 'loading' | 'error'>(null);
  readonly state = input<'loading' | 'refreshing' | 'error' | 'ready'>('ready');
  readonly error = input<string | null>(null);
  readonly mode = input<'read' | 'edit'>('read');
  readonly dirty = input(false);
  readonly busy = input(false);
  readonly orderId = input.required<number>();
  readonly openPayee = output<Payee>();
  readonly pay = output<PurchasePaymentAction>();
  readonly settle = output<PurchaseSettleRequest>();
  readonly openPayments = output<void>();
  readonly openPartner = output<void>();
  readonly openReports = output<void>();
  readonly applyCosts = output<void>();
  readonly refresh = output<void>();
  readonly refreshPartner = output<void>();
  /** 'Tegoed noteren…': the editor opens the sheet, the read view opens the editor. */
  readonly credit = output<SupplierCreditAction>();

  /** The PDF, Betalingen and Kosten & bank under the Nacalculatie; the read view places them itself, after the Calculatie. */
  readonly footer = input(true);
  /** Per product shows the five biggest until asked for all. */
  readonly showAllProducts = signal(false);
  readonly productOpen = signal<NacalcProductRow | null>(null);
  readonly round = Math.round;
  readonly eur = formatEur;
  readonly meterOf = settledMeter;
  readonly storySub = storySub;
  /** Waar het verschil zit: the payees and, when they tell their own story, the supplier's terms. */
  readonly chain = computed<ChainRow[]>(() => {
    const n = this.nacalc();
    const book = this.ledger();
    const of = (payee: Payee) => book?.payees.find(item => item.payee === payee);
    return n?.payees ? nacalcChain(n.payees, payee => of(payee)?.terms ?? [], n.headline.kind === 'concept', payee => of(payee)?.reviewEur ?? 0) : [];
  });
  /** 'Bruto € a minder en € b meer; netto € n minder.' or null. */
  readonly grossLine = computed(() => {
    const n = this.nacalc();
    return n ? nacalcGrossLine(n.explained, n.headline.verschilEur, n.headline.creditEur) : null;
  });
  readonly productLines = computed(() => {
    const n = this.nacalc();
    return n ? productRows(n.products, n.headline.setBasis, this.showAllProducts()) : [];
  });
  /** Van calculatie naar afspraak: the bridge up to the Afspraak. */
  readonly bridge = computed(() => afspraakBridge(this.nacalc()?.bridge.rows ?? []));
  /** Hoe is dit berekend?: the notes without the desk's Afronden tab, which the phone does not have. */
  readonly notes = computed(() => nacalcPhoneNotes(this.nacalc()?.notes ?? []));
  readonly partnerState = computed(() => { const partner = this.partner(); return partner === 'loading' || partner === 'error' ? partner : 'ready'; });
  /** The one action cell: the first ledger todo that is about money or a review, never a proof. */
  readonly todo = computed<LedgerTodo | null>(() => {
    if (this.nacalc()?.headline.kind === 'final') return null;
    const todos = this.ledger()?.todos ?? [];
    // Figures that do not close are looked at before more money is recorded.
    return todos.find(todo => todo.kind === 'incomplete') ?? todos.find(todo => todo.kind !== 'proof') ?? null;
  });

  tone(tone: LedgerTone | PhoneTone): string { return tone === 'warn' ? 'wk-amount--warn' : tone === 'ok' ? 'wk-amount--in' : ''; }
  amountTone(tone: PhoneAmount['tone']): string { return tone === 'in' ? 'wk-amount--in' : tone === 'warn' ? 'wk-amount--warn' : ''; }
  pillClass(tone: NacalcTone): string { return tone === 'ok' ? 'tone-ok' : tone === 'warn' ? 'tone-warn' : tone === 'outline' ? 'wk-pill--outline' : ''; }

  /** The Verschil as one figure and word, '€ 3.271,34 minder' with its percentage; a meer still to review apart, as Nakijken. */
  readonly storyVerschil = storyVerschil;

  /** What the unit figure rests on, per display or per stuk (purchase-nacalc-metrics). */
  unitBasis(n: PurchaseNacalc): string { return nacalcUnitBasis(n.headline); }
  range(n: PurchaseNacalc): string { return mixRange(n.mix); }
  mixBasis(n: PurchaseNacalc): string { return nacalcMixBasis(n.headline); }
  /** '7.976 st ' before the basis words: what the products' figures rest on. */
  quantity(n: PurchaseNacalc): string | null { return mixQuantity(n.mix); }
  pricingRange(n: PurchaseNacalc): string | null { return mixPricingRange(n.mix); }
  /** The receipt's effect per unit; over several products per product, never as an average. */
  receiptLine(receipt: NonNullable<PurchaseNacalc['receipt']>): string | null {
    const n = this.nacalc();
    if (!n) return null;
    return n.mix.uniform ? nacalcReceiptUnitLine(receipt, n.headline) : mixReceiptLine(n.mix);
  }
  readonly partnerLine = (partner: NonNullable<PurchaseNacalc['partner']>, head: PurchaseNacalc['headline']) => nacalcPartnerLine(partner, head, true);
  readonly partnerShortage = nacalcPartnerShortage;
  readonly pctLabel = pctLabel;

  /** A chain row for a screen reader: 'Leverancier, € 1.297,17 minder, € 52.021,07 → € 50.723,90, Afgerekend'. */
  chainLabel(row: ChainRow): string {
    return [row.name, row.amount.text, row.line, row.word?.word].filter(Boolean).join(', ');
  }

  productSheet(row: NacalcProductRow): SheetRow[] {
    const n = this.nacalc();
    return productSheetRows(row, !!n?.receipt, n?.headline.setBasis ?? 'PIECE');
  }

  /** The action cell in words: the Te doen verb, the payee or term, the amount; the read view settles in the editor. */
  todoLabel(todo: LedgerTodo): string {
    const verb = todoCopy(todo, this.mode()).action;
    const read = this.mode() === 'read';
    switch (todo.kind) {
      case 'pay': return `${verb} ${todo.label} · ${formatEur(todo.amountEur)}`;
      case 'settle': return read ? 'Afrekenen in bewerken ›' : `${verb} ${PAYEE_LABEL[todo.payee]}…`;
      case 'review': return read ? 'Afrekenen in bewerken ›' : `${verb}: ${formatEur(todo.amountEur)} te veel betaald aan ${PAYEE_LABEL[todo.payee]}`;
      case 'budget': return read ? 'Afrekenen in bewerken ›' : `${verb}: ${PAYEE_LABEL[todo.payee]} betaald zonder afspraak`;
      case 'incomplete': return `${verb}: betaling zonder eurowaarde bij ${PAYEE_LABEL[todo.payee]}`;
      case 'credit': return `Tegoed open bij ${PAYEE_LABEL[todo.payee]} · ${formatEur(todo.amountEur)} ›`;
      default: return todoCopy(todo, this.mode()).title;
    }
  }

  runTodo(todo: LedgerTodo): void {
    switch (todo.kind) {
      case 'pay': this.pay.emit({ payee: todo.payee, amount: todo.amountEur, label: todo.label, due: todo.due }); break;
      case 'settle': case 'review': case 'budget': this.settle.emit(todo.request); break;
      case 'incomplete': case 'credit': this.openPayee.emit(todo.payee); break;
    }
  }
}
