import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { saveBlob } from '../../core/api/download';
import { messageOf } from '../../core/api/errors';
import type { PartnerFinancing, Payee, PurchaseOrderView } from '../../core/api/models';
import { SourcingApi } from '../../core/api/sourcing-api';
import { Icon } from '../../shared/icon';
import { EurPipe, NumPipe } from '../../shared/pipes';
import { Skeleton } from '../../shared/skeleton';
import { Ui } from '../../shared/ui';
import type { NacalcPayeeRow, NacalcTone, PurchaseNacalc } from './purchase-nacalc-metrics';
import { PAYEE_LABEL, type LedgerTodo, type LedgerTone, type PaymentLedger, type PurchasePaymentAction, type PurchaseSettleRequest } from './purchase-payment-ledger';
import { formatEur, todoCopy } from './purchase-payment-menus';

/**
 * The nacalculatie on the phone: the Kosten stop of the read view and step 3
 * of the editor. A hero group with the meter, the payees as tappable cells
 * with one reason word each and at most one action cell, the receipt, the
 * cost per piece with the bridge to Kosten behind a disclosure, the products
 * collapsed, the partner, the notes, and a footer with the PDF and the ways
 * to Betalingen and Kosten & bank. Sheets belong to the host; nothing opens
 * here. Styles: styles/purchase-nacalc.scss (.np-*).
 */
@Component({
  selector: 'app-purchase-nacalc-overview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, RouterLink, Skeleton, EurPipe, NumPipe],
  template: `
    <div class="np" id="purchase-payment-result" tabindex="-1" aria-label="Nacalculatie">
      <div class="ios-section__head ios-section__head--prominent np-head">
        <h2>Nacalculatie</h2>
        @if (nacalc(); as n) { <span class="wk-pill np-pill" [class]="pillClass(n.headline.pill.tone)">{{ n.headline.pill.label }}</span> }
      </div>

      @if (nacalc(); as n) {
        @let head = n.headline;
        @let concept = head.kind === 'concept';
        <section class="ios-section">
          <div class="ios-group np-hero">
            <div class="ios-cell ios-cell--tall np-hero__main">
              <span class="ios-cell__body">
                <span class="ios-cell__sub">{{ head.label }}</span>
                <span class="np-hero__value">{{ head.eindkostEur | eur }}</span>
                <span class="ios-cell__sub np-hero__sub" [class.wk-amount--in]="head.verschilEur < 0" [class.wk-amount--warn]="head.verschilEur > 0 || head.reviewEur > 0">{{ heroSub(n) }}</span>
                @if (!concept && ledger(); as book) {
                  <span class="wk-meter np-hero__meter" role="img" [attr.aria-label]="'Betaald ' + round(book.summary.meter.paidPct) + '%, nu te betalen ' + round(book.summary.meter.duePct) + '%, later ' + round(book.summary.meter.laterPct) + '%'" title="betaald · nu te betalen · later">
                    <i class="tone-ok" [style.width.%]="book.summary.meter.paidPct"></i><i class="tone-warn" [style.width.%]="book.summary.meter.duePct"></i><i class="is-rest" [style.width.%]="book.summary.meter.laterPct"></i>
                  </span>
                }
              </span>
            </div>
            @if (!concept) {
              <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Betaald + open</span></span><span class="ios-cell__trail"><span class="ios-cell__value">{{ head.paidEur | eur }} + {{ head.openEur | eur }}</span></span></div>
            }
            <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Per stuk</span><span class="ios-cell__sub">{{ unitBasis(n) }}</span></span>
              <span class="ios-cell__trail"><span class="ios-cell__value ios-cell__value--strong">@if (head.unitEur !== null) { {{ head.unitEur | eur: 4 }} } @else { — }</span></span></div>
          </div>
          <p class="ios-section__foot">{{ concept ? 'De nacalculatie begint bij de bestelling: zodra betalingen genoteerd zijn, zie je hier wat de container echt kost.' : head.sentence }}</p>
        </section>

        @if (!concept) {
          <section class="ios-section" aria-label="Waar het verschil zit">
            <div class="ios-section__head"><h2>Waar het verschil zit</h2></div>
            @if (state() === 'error') {
              <p class="ios-caption np-caption">Betalingen niet actueel <button class="ios-capsule" type="button" (click)="refresh.emit()">Opnieuw laden</button></p>
            } @else if (!n.payees || state() === 'loading') {
              <div class="ios-group np-skeleton"><app-skeleton kind="list" [rows]="3" /></div>
            } @else {
              <div class="ios-group ios-group--icons">
                @for (row of n.payees; track row.payee) {
                  <button class="ios-cell ios-cell--tall np-payee" type="button" [class.np-payee--warn]="row.reason === 'review' || row.reason === 'unbudgeted' || row.reason === 'incomplete'" (click)="openPayee.emit(row.payee)">
                    <span class="ios-cell__lead"><span class="ios-tile" [class]="row.tone"><app-icon [name]="row.icon" [size]="17" /></span></span>
                    <!-- The reason reads under the agreement, on the wide side of the cell; the trail carries only the verschil. -->
                    <span class="ios-cell__body"><span class="ios-cell__title">{{ row.label }}</span><span class="ios-cell__sub">{{ payeeSub(row) }}</span>
                      <span class="ios-cell__meta np-payee__reason" [class]="tone(row.status.tone)">{{ row.reasonLabel }}@if (row.fxEur !== 0) { · waarvan koersverschil {{ signed(row.fxEur) }} }</span></span>
                    <span class="ios-cell__trail">
                      <span class="ios-cell__value" [class.ios-cell__value--strong]="row.verschilEur !== 0" [class.wk-amount--in]="row.verschilEur < 0" [class.wk-amount--warn]="row.verschilEur > 0">@if (row.reason === 'incomplete') { — } @else { {{ signed(row.verschilEur) }} }</span>
                    </span>
                    <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
                  </button>
                  @if (row.termsMixed) {
                    @for (term of row.terms; track term.due) {
                      <button class="ios-cell np-term" type="button" (click)="openPayee.emit('SUPPLIER')">
                        <span class="ios-cell__lead"></span>
                        <span class="ios-cell__body"><span class="ios-cell__title">{{ term.label }}</span><span class="ios-cell__sub">{{ term.paidEur | eur }} van {{ term.agreedEur | eur }}</span></span>
                        <span class="ios-cell__trail"><span class="ios-cell__value" [class.wk-amount--in]="term.verschilEur < 0" [class.wk-amount--warn]="term.verschilEur > 0">{{ signed(term.verschilEur) }}</span><span class="ios-cell__meta" [class]="tone(term.status.tone)">{{ term.status.label }}</span></span>
                      </button>
                    }
                  }
                }
                @if (todo(); as todo) {
                  <button class="ios-cell ios-cell--action np-action" type="button" [disabled]="busy() || (dirty() && todo.kind !== 'incomplete')" (click)="runTodo(todo)">{{ todoLabel(todo) }}</button>
                }
              </div>
              <p class="ios-section__foot">{{ dirty() && mode() === 'edit' ? 'Sla de container op om af te rekenen of te exporteren.' : 'Tik op een ontvanger voor termijnen, betalingen en afrekenen.' }}</p>
            }
          </section>
        }

        @if (n.receipt; as receipt) {
          <section class="ios-section" aria-label="Ontvangst">
            <div class="ios-section__head"><h2>Ontvangst</h2></div>
            <div class="ios-group">
              @if (receipt.clean) {
                <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Alles volgens bestelling</span></span><span class="ios-cell__trail"><span class="ios-cell__value">{{ receipt.usable | num }} stuks</span></span></div>
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
                      @if (receipt.supplierFact; as fact) { <span class="ios-cell__meta">{{ fact.kind === 'settled-lower' ? 'leverancier afgerekend met ' + eur(fact.amountEur) + ' minder' : fact.kind === 'open' ? 'nog ' + eur(fact.amountEur) + ' open bij de leverancier' : 'leverancier volledig betaald · verlies blijft bij Enrosed' }}</span> }</span></div>
                }
                @if (receipt.unvaluedPieces > 0) {
                  <a class="ios-cell" routerLink="/analyses/purchasing" [queryParams]="{ orderId: orderId() }"><span class="ios-cell__body"><span class="ios-cell__title">{{ receipt.unvaluedPieces | num }} stuks zonder inkoopwaarde</span><span class="ios-cell__sub">tellen niet mee · waarde vastleggen</span></span><app-icon class="ios-cell__chev" name="chevron-right" [size]="16" /></a>
                }
              }
              @if (receipt.later; as later) {
                <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Na uitpakken: @if (later.damaged) { {{ later.damaged | num }} beschadigd }@if (later.damaged && later.missing) { / }@if (later.missing) { {{ later.missing | num }} te weinig }</span><span class="ios-cell__sub">niet in de kostprijs verwerkt</span></span></div>
              }
              <!-- Only the read view renders the reports card; the editor has no reports to scroll to. -->
              @if (mode() === 'read' && (receipt.later || view().receiptReports?.length)) {
                <button class="ios-cell ios-cell--action" type="button" (click)="openReports.emit()">Schade en tekorten ›</button>
              }
            </div>
            @if (!receipt.clean && receipt.unitUsableEur !== null && receipt.unitOrderedEur !== null && receipt.unitDeltaEur !== null) {
              <p class="ios-section__foot">Kost per bruikbaar stuk {{ receipt.unitUsableEur | eur: 4 }}; per besteld stuk zou dit {{ receipt.unitOrderedEur | eur: 4 }} zijn ({{ signedUnit(receipt.unitDeltaEur) }}). Inkoopwaarde = goederenprijs per stuk tegen de orderkoers.</p>
            }
          </section>
        }

        <section class="ios-section" aria-label="Per stuk">
          <div class="ios-section__head"><h2>Per stuk</h2></div>
          <div class="ios-group">
            <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Enrosed kost</span><span class="ios-cell__sub">intern, geen betaling</span></span><span class="ios-cell__trail"><span class="ios-cell__value">{{ head.markupEur | eur }}</span></span></div>
            <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Kostbasis voor prijzen</span></span><span class="ios-cell__trail"><span class="ios-cell__value">{{ head.pricingEur | eur }}</span></span></div>
            <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Per stuk incl. Enrosed kost</span></span><span class="ios-cell__trail"><span class="ios-cell__value ios-cell__value--strong">@if (head.pricingUnitEur !== null) { {{ head.pricingUnitEur | eur: 4 }} } @else { — }</span></span></div>
            <details class="ios-disclosure np-disclosure">
              <summary>Hoe verhoudt dit zich tot Kosten?<app-icon class="ios-cell__chev" name="chevron-right" [size]="16" /></summary>
              <div class="np-disclosure__body">
                <dl class="wk-equation">
                  @for (row of n.bridge.rows; track row.key) {
                    <div [class.is-total]="row.op === '='" [class.is-sub]="row.key === 'REVIEW' || row.key === 'ADDITIONAL'">
                      <dt>@if (row.op && row.op !== '→') { <span class="wk-equation__op" aria-hidden="true">{{ row.op }}</span> }{{ row.label }}@if (row.note) { <small> · {{ row.note }}</small> }</dt>
                      <dd [class.wk-amount--in]="row.key === 'VARIANCE' && row.amountEur < 0" [class.wk-amount--warn]="row.key === 'VARIANCE' && row.amountEur > 0">{{ row.key === 'VARIANCE' ? signed(row.amountEur) : (row.amountEur | eur) }}</dd>
                    </div>
                  }
                </dl>
                @if (!n.bridge.consistent) { <p class="ios-caption">De onderdelen sluiten niet exact aan; controleer de kosten.</p> }
                @if (!concept) {
                  @let ex = n.explained;
                  <p class="np-disclosure__sub">Afgerekende verschillen</p>
                  <dl class="wk-equation">
                    <div><dt><span class="wk-equation__op" aria-hidden="true">−</span>minder betaald · afgerekend</dt><dd>{{ ex.savingsEur | eur }}</dd></div>
                    <div><dt><span class="wk-equation__op" aria-hidden="true">+</span>meer betaald · afgerekend</dt><dd>{{ ex.overrunsEur | eur }}</dd></div>
                    <div><dt><span class="wk-equation__op" aria-hidden="true">+</span>bijkomend</dt><dd>{{ ex.additionalEur | eur }}</dd></div>
                    @if (ex.fxEur !== 0) { <div class="is-sub"><dt>koersverschil · zit al in betaald</dt><dd>{{ signed(ex.fxEur) }}</dd></div> }
                    @if (ex.openEur > 0) { <div class="is-sub"><dt>nog open · blijft in de eindkost tot afrekening</dt><dd>{{ ex.openEur | eur }}</dd></div> }
                  </dl>
                  <p class="ios-caption">{{ head.kind === 'final' ? 'Alle ontvangers zijn afgerekend.' : 'Minder betalen telt pas na afrekening; te veel betaald blijft voorlopig tot het is nagekeken.' }}</p>
                }
              </div>
            </details>
            @if (n.receipt && head.kind === 'final') { <button class="ios-cell ios-cell--action" type="button" (click)="applyCosts.emit()">Kostprijzen toepassen bij Afronden ›</button> }
          </div>
        </section>

        <section class="ios-section" aria-label="Per product">
          <div class="ios-section__head"><h2>Per product</h2></div>
          <div class="ios-group">
            <details class="ios-disclosure np-disclosure">
              <summary>Kostprijs per product <span class="np-disclosure__count">{{ n.products.length }} {{ n.products.length === 1 ? 'product' : 'producten' }}</span><app-icon class="ios-cell__chev" name="chevron-right" [size]="16" /></summary>
              @for (row of n.products; track row.productId ?? row.name) {
                <!-- The whole cell is the link (44 px target); without a product id the link is disabled. -->
                <a class="ios-cell ios-cell--tall np-product" [class.np-product--plain]="!row.productId" [routerLink]="row.productId ? ['/products', row.productId] : null">
                  <span class="ios-cell__body">
                    <span class="ios-cell__title">{{ row.name }}</span>
                    <span class="ios-cell__sub">{{ productSub(row, !!n.receipt) }}</span>
                  </span>
                  <span class="ios-cell__trail"><span class="ios-cell__value ios-cell__value--strong">{{ row.eindkostEur | eur }}</span>
                    <span class="ios-cell__meta" [class.wk-amount--in]="row.verschilEur < 0" [class.wk-amount--warn]="row.verschilEur > 0">{{ row.unitQuantity === 0 ? 'geen bruikbare stuks' : row.verschilEur === 0 ? 'afspraak ' + eur(row.begrootEur) : signed(row.verschilEur) + ' t.o.v. de afspraak' }}</span></span>
                  @if (row.productId) { <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" /> }
                </a>
              } @empty {
                <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__sub">Geen productregels</span></span></div>
              }
            </details>
          </div>
        </section>

        @if (n.partner; as partner) {
          <section class="ios-section" aria-label="Partner">
            <div class="ios-section__head"><h2>Partner</h2></div>
            <div class="ios-group">
              <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Partner financiert</span>@if (partner.basisEur !== null) { <span class="ios-cell__sub np-wrap">op {{ partner.basisEur | eur }} incl. Enrosed kost en aparte kosten</span> }</span>
                <span class="ios-cell__trail"><span class="ios-cell__value ios-cell__value--strong">{{ partner.costPct }} %@if (partner.advanceEur !== null) { · {{ partner.advanceEur | eur }} }</span></span></div>
              <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Resultaat voor ENROSED</span></span><span class="ios-cell__trail"><span class="ios-cell__value">{{ partner.sharePct }} %</span></span></div>
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
              <div class="ios-cell ios-cell--tall"><span class="ios-cell__body"><span class="ios-cell__title">Bij de afrekening</span><span class="ios-cell__sub np-wrap">eindkost per bruikbaar stuk@if (partner.unitEur !== null) { ({{ partner.unitEur | eur: 4 }}) } × verkochte stuks + {{ partner.sharePct }} % resultaat; voorschot verrekend</span></span></div>
              <button class="ios-cell ios-cell--action" type="button" (click)="openPartner.emit()">Partnerfinanciering ›</button>
            </div>
            @if (partner.shortPieces > 0) {
              <p class="ios-section__foot wk-amount--warn">{{ partner.shortPieces | num }} stuks kwamen niet aan: de partner betaalt alleen voor bruikbare stuks, tegen een hogere kost per stuk.@if (partner.shortageAfterAdvance) { Het voorschot is berekend op {{ partner.ordered | num }} bestelde stuks; verreken het verschil bij de slotfactuur of met een creditnota op het voorschot. }</p>
            }
          </section>
        }

        <section class="ios-section" aria-label="Toelichting">
          <div class="ios-section__head"><h2>Toelichting</h2></div>
          <div class="ios-group">
            <details class="ios-disclosure np-disclosure">
              <summary>Hoe is dit berekend?<app-icon class="ios-cell__chev" name="chevron-right" [size]="16" /></summary>
              <ul class="np-notes">@for (note of n.notes; track $index) { <li>{{ note }}</li> }</ul>
            </details>
          </div>
        </section>

        <div class="ios-group np-footer">
          <button class="ios-cell ios-cell--action" type="button" [disabled]="dirty() || pdfBusy()" (click)="downloadPdf()">{{ pdfBusy() ? 'PDF maken…' : 'Betalingen & kostprijs (PDF)' }}</button>
          <button class="ios-cell" type="button" (click)="openPayments.emit()"><span class="ios-cell__body"><span class="ios-cell__title">Betalingen</span></span><app-icon class="ios-cell__chev" name="chevron-right" [size]="16" /></button>
          <a class="ios-cell" routerLink="/costs" [queryParams]="{ container: orderId() }"><span class="ios-cell__body"><span class="ios-cell__title">Kosten &amp; bank</span></span><app-icon class="ios-cell__chev" name="chevron-right" [size]="16" /></a>
        </div>
        @if (dirty()) { <p class="ios-caption np-caption">Sla de container op om de kostprijs als PDF te exporteren.</p> }
      } @else {
        <p class="ios-caption np-caption">De nacalculatie is nog niet beschikbaar. Vernieuw de order om de actuele betalingen op te halen.
          <button class="ios-capsule" type="button" (click)="refresh.emit()">Vernieuwen</button></p>
      }
    </div>
  `,
})
export class PurchaseNacalcOverview {
  private readonly sourcing = inject(SourcingApi);
  private readonly ui = inject(Ui);

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

  readonly pdfBusy = signal(false);
  readonly round = Math.round;
  readonly eur = formatEur;
  readonly partnerState = computed(() => { const partner = this.partner(); return partner === 'loading' || partner === 'error' ? partner : 'ready'; });
  /** The one action cell: the first ledger todo that is about money or a review, never a proof. */
  readonly todo = computed<LedgerTodo | null>(() => {
    if (this.nacalc()?.headline.kind === 'final') return null;
    const todos = this.ledger()?.todos ?? [];
    // Figures that do not close are looked at before more money is recorded.
    return todos.find(todo => todo.kind === 'incomplete') ?? todos.find(todo => todo.kind !== 'proof') ?? null;
  });

  tone(tone: LedgerTone): string { return tone === 'warn' ? 'wk-amount--warn' : tone === 'ok' ? 'wk-amount--in' : ''; }
  pillClass(tone: NacalcTone): string { return tone === 'ok' ? 'tone-ok' : tone === 'warn' ? 'tone-warn' : tone === 'outline' ? 'wk-pill--outline' : ''; }

  /** '+ € 120,00', '− € 50,00' or a plain '€ 0,00'; the sign never wraps away from its figure. */
  signed(value: number): string {
    if (!value) return formatEur(0);
    return (value > 0 ? '+ ' : '− ') + formatEur(Math.abs(value));
  }
  signedUnit(value: number): string {
    return (value < 0 ? '− € ' : '+ € ') + Math.abs(value).toLocaleString('nl-BE', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  }

  heroSub(n: PurchaseNacalc): string {
    const head = n.headline;
    if (head.kind === 'concept') return 'volgens de calculatie · nog niets betaald';
    const pct = head.verschilPct === null ? '' : ` (${Math.abs(head.verschilPct).toLocaleString('nl-BE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %)`;
    const review = head.reviewEur > 0 ? ` · waarvan ${formatEur(head.reviewEur)} na te kijken` : '';
    if (head.verschilEur === 0) return `afspraak ${formatEur(head.begrootEur)} · geen verschil${review}`;
    return `${formatEur(Math.abs(head.verschilEur))}${pct} ${head.verschilEur < 0 ? 'goedkoper' : 'duurder'} dan afgesproken${review}`;
  }

  unitBasis(n: PurchaseNacalc): string {
    const head = n.headline;
    const base = head.unitBasis === 'USABLE_RECEIVED'
      ? `${head.unitQuantity.toLocaleString('nl-BE')} bruikbare stuks · ${head.orderedQuantity.toLocaleString('nl-BE')} besteld`
      : `${head.unitQuantity.toLocaleString('nl-BE')} bestelde stuks`;
    return base + (head.includesInspection ? ' · incl. inspectie' : '') + (head.ddp ? ' · DDP' : '');
  }

  /**
   * The agreement in one line; the eindkost only when it differs from it (the
   * trail already carries the verschil). A payee paid without an agreement
   * reads like Bijkomende kosten, never 'afgesproken € 0,00'. DDP is one word
   * here: the per-stuk basis in the hero says it and the desk row spells it out.
   */
  payeeSub(row: NacalcPayeeRow): string {
    if (row.agreedEur === null || row.status.kind === 'UNBUDGETED') return `${formatEur(row.paidEur)} · zonder afspraak`;
    const agreed = `afgesproken ${formatEur(row.agreedEur)}`;
    const eindkost = row.eindkostEur === row.agreedEur ? '' : ` → eindkost ${formatEur(row.eindkostEur)}`;
    return agreed + eindkost + (row.ddpNote ? ' · DDP' : '');
  }

  productSub(row: PurchaseNacalc['products'][number], received: boolean): string {
    const pieces = received
      ? `${row.usable.toLocaleString('nl-BE')} bruikbare stuks${row.missing || row.damaged || row.over ? ` (${[row.missing ? row.missing + ' te weinig' : '', row.damaged ? row.damaged + ' beschadigd' : '', row.over ? row.over + ' te veel' : ''].filter(Boolean).join(', ')})` : ''}`
      : `${row.ordered.toLocaleString('nl-BE')} bestelde stuks`;
    const unit = row.unitEur !== null && row.unitQuantity > 0 ? ` · ${row.unitEur.toLocaleString('nl-BE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 4, maximumFractionDigits: 4 })}/st` : '';
    const pricing = row.pricingUnitEur !== null && row.unitQuantity > 0 ? ` · ${row.pricingUnitEur.toLocaleString('nl-BE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 4, maximumFractionDigits: 4 })} incl. Enrosed kost` : '';
    return pieces + unit + pricing;
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
      default: return todoCopy(todo, this.mode()).title;
    }
  }

  runTodo(todo: LedgerTodo): void {
    switch (todo.kind) {
      case 'pay': this.pay.emit({ payee: todo.payee, amount: todo.amountEur, label: todo.label, due: todo.due }); break;
      case 'settle': case 'review': case 'budget': this.settle.emit(todo.request); break;
      case 'incomplete': this.openPayee.emit(todo.payee); break;
    }
  }

  async downloadPdf(): Promise<void> {
    if (this.pdfBusy() || this.dirty() || !this.nacalc()) return;
    this.pdfBusy.set(true);
    try {
      saveBlob(await this.sourcing.purchasePaymentsPdf(this.orderId()), `${this.view().order.number.replace(/[^\p{L}\p{N}._-]/gu, '-')}-betalingen-kostprijs.pdf`);
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'De betalingsafrekening kon niet als PDF worden geëxporteerd'), 'err');
    } finally { this.pdfBusy.set(false); }
  }
}
