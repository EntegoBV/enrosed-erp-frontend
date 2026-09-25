import { afterNextRender, ChangeDetectionStrategy, Component, computed, ElementRef, inject, input, linkedSignal, output, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { saveBlob } from '../../core/api/download';
import { messageOf } from '../../core/api/errors';
import type { PartnerFinancing, Payee, PurchaseOrderView } from '../../core/api/models';
import { SourcingApi } from '../../core/api/sourcing-api';
import { ContextMenu, type ContextMenuItem } from '../../shared/context-menu';
import type { MenuPoint } from '../../shared/context-menu-position';
import { Icon } from '../../shared/icon';
import { MenuTrigger } from '../../shared/menu-trigger';
import { CurPipe, EurPipe, NumPipe } from '../../shared/pipes';
import { Skeleton } from '../../shared/skeleton';
import { Ui } from '../../shared/ui';
import type { NacalcPayeeRow, NacalcReason, NacalcTone, PurchaseNacalc } from './purchase-nacalc-metrics';
import type { Due, LedgerTone, PaymentLedger, PurchaseSettleRequest } from './purchase-payment-ledger';
import { formatEur } from './purchase-payment-menus';

type MenuState = { kind: 'more'; point: MenuPoint } | { kind: 'payee'; point: MenuPoint; row: NacalcPayeeRow };

/**
 * The nacalculatie on the desk, across the whole main pane: the headline
 * strip (begroot → eindkost → verschil → per stuk), the payees with one
 * reason word and at most one action each, the receipt, the products, and
 * the side cards that explain how the eindkost came about, what prices rest
 * on, what the partner finances and how it was calculated. Sheets and menus
 * of the actions render at page level in the desk; only the ⋯ menus live
 * here. Styles: styles/purchase-nacalc.scss (.nc-*).
 */
@Component({
  selector: 'app-purchase-nacalc-workbench',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ContextMenu, Icon, MenuTrigger, RouterLink, Skeleton, EurPipe, CurPipe, NumPipe],
  template: `
    <section class="nc" id="purchase-payment-result" tabindex="-1" aria-label="Nacalculatie">
      <div class="wk-toolbar wk-toolbar--sticky nc-bar">
        <div class="wk-toolbar__lead">
          <div class="nc-bar__copy">
            <h2 class="wk-toolbar__title">Nacalculatie</h2>
            <p class="nc-bar__sub">{{ nacalc()?.headline?.sentence ?? 'De nacalculatie is nog niet beschikbaar.' }}</p>
          </div>
        </div>
        <div class="wk-toolbar__tools">
          <button class="wk-btn" type="button" title="Betalingen &amp; kostprijs" [disabled]="dirty() || pdfBusy() || !nacalc()" (click)="downloadPdf()"><app-icon name="document" [size]="16" />{{ pdfBusy() ? 'PDF maken…' : 'PDF' }}</button>
          <button class="wk-btn wk-btn--icon" type="button" aria-label="Meer acties" (click)="openMenu('more', $event)"><app-icon name="more" [size]="18" /></button>
        </div>
      </div>
      @if (dirty()) {
        <div class="wk-banner wk-banner--warn wk-banner--inset nc-note" role="status">
          <app-icon name="alert" [size]="16" />
          <span class="wk-banner__text">Niet-opgeslagen wijzigingen aan de order. Die worden eerst opgeslagen voordat je afrekent of exporteert.</span>
          <span class="wk-banner__actions"><button class="wk-btn wk-btn--sm" type="button" [disabled]="saving()" (click)="save.emit()">{{ saving() ? 'Opslaan…' : 'Opslaan' }}</button></span>
        </div>
      }

      @if (nacalc(); as n) {
        @let head = n.headline;
        @let concept = head.kind === 'concept';
        <div class="wk-strip nc-strip" aria-label="Begroot, eindkost en verschil">
          <div class="wk-strip__item nc-cell"><span class="wk-strip__label">Begroot</span><span class="wk-strip__value">{{ head.begrootEur | eur }}</span><small class="nc-strip__sub">calculatie op {{ head.orderedQuantity | num }} bestelde stuks</small></div>
          <span class="wk-strip__op nc-op" aria-hidden="true">→</span>
          <div class="wk-strip__item nc-cell nc-cell--grand">
            <span class="wk-strip__label">{{ head.label }} <span class="wk-pill nc-pill" [class]="pillClass(head.pill.tone)">{{ head.pill.label }}</span></span>
            <span class="wk-strip__value">{{ head.eindkostEur | eur }}</span>
            <small class="nc-strip__sub">@if (concept) { volgens de calculatie · nog niets betaald } @else if (head.kind === 'final') { betaald {{ head.paidEur | eur }} · alles afgerekend } @else { betaald {{ head.paidEur | eur }} + open {{ head.openEur | eur }} }</small>
          </div>
          <span class="wk-strip__op nc-op" aria-hidden="true">=</span>
          <div class="wk-strip__item nc-cell">
            <span class="wk-strip__label">Verschil</span>
            <span class="wk-strip__value" [class.wk-amount--muted]="head.verschilEur === 0" [class.wk-amount--in]="head.verschilEur < 0" [class.wk-amount--warn]="head.verschilEur > 0">{{ head.verschilEur === 0 ? 'geen verschil' : signed(head.verschilEur) }}</span>
            <small class="nc-strip__sub">@if (head.verschilEur !== 0 && head.verschilPct !== null) { {{ pct(head.verschilPct) }} {{ head.verschilEur < 0 ? 'goedkoper' : 'duurder' }} }@if (head.reviewEur > 0) { @if (head.verschilEur !== 0) { · } waarvan {{ head.reviewEur | eur }} na te kijken }</small>
          </div>
          <span class="wk-strip__sep nc-sep" aria-hidden="true"></span>
          <div class="wk-strip__item nc-cell">
            <span class="wk-strip__label">Per stuk</span>
            <span class="wk-strip__value">@if (head.unitEur !== null) { {{ head.unitEur | eur: 4 }} } @else { — }</span>
            <small class="nc-strip__sub">{{ unitBasis(n) }}@if (head.pricingUnitEur !== null) { <br />incl. Enrosed kost {{ head.pricingUnitEur | eur: 4 }} }</small>
          </div>
        </div>
        @if (!concept && ledger(); as book) {
          @let meter = book.summary.meter;
          <div class="nc-meter" [title]="'betaald · nu te betalen · later'">
            <div class="wk-meter" role="img" [attr.aria-label]="'Betaald ' + round(meter.paidPct) + '%, nu te betalen ' + round(meter.duePct) + '%, later ' + round(meter.laterPct) + '%'">
              <i class="tone-ok" [style.width.%]="meter.paidPct"></i><i class="tone-warn" [style.width.%]="meter.duePct"></i><i class="is-rest" [style.width.%]="meter.laterPct"></i>
            </div>
            @if (meter.agreedPct !== null) { <span class="nc-meter__mark" [style.left.%]="meter.agreedPct" title="Einde van de afspraak"></span> }
          </div>
        }

        <p class="nc-muted nc-sentence">{{ head.sentence }}</p>
        <div class="nc-body" [class.is-loading]="state() === 'refreshing'">
          <div class="nc-main">
            @if (concept) {
              <section class="wk-card">
                <div class="wk-empty">
                  <span class="wk-empty__icon"><app-icon name="layers" [size]="22" /></span>
                  <p class="wk-empty__title">Nog niet besteld</p>
                  <p class="wk-empty__text">De nacalculatie begint bij de bestelling. Tot dan is dit de begroting uit Kosten.</p>
                  <div class="wk-empty__actions"><button class="wk-btn" type="button" (click)="openCosts.emit()">Calculatie ›</button></div>
                </div>
              </section>
            } @else {
              <section class="wk-card" aria-labelledby="nc-payees-title">
                <header class="wk-card__head"><h3 class="wk-card__title" id="nc-payees-title">Per ontvanger</h3></header>
                <div class="wk-card__body wk-card__body--flush">
                  @if (state() === 'error') {
                    <div class="wk-banner wk-banner--danger wk-banner--inset nc-note" role="alert">
                      <app-icon name="alert" [size]="16" />
                      <span class="wk-banner__text">Betalingen niet actueel{{ error() ? ' · ' + error() : '' }}</span>
                      <span class="wk-banner__actions"><button class="wk-btn wk-btn--sm" type="button" (click)="refresh.emit()">Opnieuw laden</button></span>
                    </div>
                  } @else if (!n.payees || state() === 'loading') {
                    <div class="nc-skeleton"><app-skeleton kind="list" [rows]="4" /></div>
                  } @else {
                    <div class="wk-table nc-payees" role="grid" aria-labelledby="nc-payees-title">
                      <div class="wk-thead" role="row">
                        <span class="wk-th" role="columnheader">Ontvanger</span>
                        <span class="wk-th wk-th--num" role="columnheader" data-nc-hide="mid narrow">Afspraak · begroot</span>
                        <span class="wk-th wk-th--num" role="columnheader">Betaald</span>
                        <span class="wk-th wk-th--num" role="columnheader">Open</span>
                        <span class="wk-th wk-th--num" role="columnheader">Eindkost</span>
                        <span class="wk-th wk-th--num" role="columnheader">Verschil</span>
                        <span class="wk-th" role="columnheader" data-nc-hide="mid">Status</span>
                        <span class="wk-th" role="columnheader"><span class="sr-only">Acties</span></span>
                      </div>
                      @for (row of n.payees; track row.payee) {
                        <div class="wk-tr wk-tr--link nc-row" role="row" tabindex="0" [attr.data-payee]="row.payee" [class.nc-row--warn]="row.status.tone === 'warn' && (row.reason === 'review' || row.reason === 'unbudgeted' || row.reason === 'incomplete')"
                             appMenuTrigger (menuTrigger)="menu.set({ kind: 'payee', point: $event, row })"
                             (click)="rowClick($event, row.payee)" (keydown)="onRowKey($event, row.payee)">
                          <span class="wk-td" role="gridcell"><span class="nc-payee">
                            <span class="nc-tile" [class]="row.tone"><app-icon [name]="row.icon" [size]="14" /></span>
                            <span class="nc-payee__copy"><span class="nc-payee__name"><b>{{ row.label }}</b>
                              @if (row.terms.length) {
                                <button class="nc-chev" type="button" [attr.aria-expanded]="isExpanded(row.payee)" [attr.aria-label]="(isExpanded(row.payee) ? 'Termijnen verbergen: ' : 'Termijnen tonen: ') + row.label"
                                        (click)="$event.stopPropagation(); toggle(row.payee)"><app-icon name="chevron-right" [size]="14" /></button>
                              }</span><span class="wk-td__sub nc-basis" [title]="row.basis">{{ row.basis }}</span>
                              <span class="nc-when-mid nc-state"><span class="wk-pill" [class]="tone(row.status.tone)">{{ row.status.label }}</span>@if (reasonBeyondStatus(row.reason)) { <span class="wk-td__sub nc-reason">{{ row.reasonLabel }}</span> }</span>
                              @if (row.agreedEur !== null) { <span class="wk-td__sub nc-when-mid">{{ row.payee === 'SUPPLIER' ? 'afspraak' : 'begroot' }} {{ row.agreedEur | eur }}</span> }
                            </span></span></span>
                          <span class="wk-td wk-td--num wk-amount" role="gridcell" data-nc-hide="mid narrow">@if (row.agreedEur === null) { — } @else { {{ row.agreedEur | eur }} }</span>
                          <span class="wk-td wk-td--num wk-amount" role="gridcell">{{ row.paidEur | eur }}
                            @if (row.paidForeign; as foreign) { <span class="wk-td__sub">{{ foreign.amount | cur: foreign.currency }}</span> }
                            @if (row.legacy) { <span class="wk-td__sub">historisch {{ row.legacyEur | eur }} bij ontvangst</span> }</span>
                          <span class="wk-td wk-td--num wk-amount" role="gridcell">@if (row.agreedEur === null) { — } @else { {{ row.openEur | eur }} }
                            @if (row.dueNowEur > 0 && row.laterEur > 0) { <span class="wk-td__sub" data-nc-hide="mid">{{ row.dueNowEur | eur }} nu · {{ row.laterEur | eur }} later</span> }</span>
                          <span class="wk-td wk-td--num wk-amount wk-amount--strong" role="gridcell">{{ row.eindkostEur | eur }}</span>
                          <span class="wk-td wk-td--num wk-amount" role="gridcell" [class.wk-amount--in]="row.verschilEur < 0" [class.wk-amount--warn]="row.verschilEur > 0 || row.reason === 'review'" [class.wk-amount--muted]="row.verschilEur === 0 && row.reason !== 'review'">
                            @if (row.reason === 'incomplete') { — } @else { {{ signed(row.verschilEur) }} }
                            <span class="wk-td__sub nc-reason" data-nc-hide="mid">{{ row.reasonLabel }}</span>
                            @if (row.fxEur !== 0) { <span class="wk-td__sub nc-reason">waarvan koersverschil {{ signed(row.fxEur) }}</span> }</span>
                          <span class="wk-td wk-td--wrap" role="gridcell" data-nc-hide="mid"><span class="wk-pill" [class]="tone(row.status.tone)">{{ row.status.label }}</span></span>
                          <span class="wk-td wk-td--actions nc-actions" role="gridcell">
                            @if (row.actionLabel; as label) {
                              @if (row.action === 'add') {
                                <button class="wk-btn wk-btn--sm" type="button" data-nc-hide="narrow" [disabled]="!actionable()" (click)="$event.stopPropagation(); openPayments.emit(row.payee)">{{ label }}</button>
                              } @else {
                                <button class="wk-btn wk-btn--sm" type="button" data-nc-hide="narrow" [disabled]="!actionable()" (click)="$event.stopPropagation(); settle.emit(row.settleDefault)">{{ label }}</button>
                              }
                            }
                            <button class="wk-btn wk-btn--sm wk-btn--icon nc-more" type="button" [attr.aria-label]="'Acties voor ' + row.label" (click)="$event.stopPropagation(); openMenu('payee', $event, row)"><app-icon name="more" [size]="16" /></button>
                          </span>
                        </div>
                        @if (row.terms.length && isExpanded(row.payee)) {
                          @for (term of row.terms; track term.due) {
                            <div class="wk-tr wk-tr--sub nc-term" role="row">
                              <span class="wk-td" role="gridcell"><span class="nc-sub">{{ term.label }}<span class="wk-td__sub nc-when-mid"><span class="wk-pill" [class]="tone(term.status.tone)">{{ term.status.label }}</span></span></span></span>
                              <span class="wk-td wk-td--num wk-amount" role="gridcell" data-nc-hide="mid narrow">{{ term.agreedEur | eur }}</span>
                              <span class="wk-td wk-td--num wk-amount" role="gridcell">{{ term.paidEur | eur }}</span>
                              <span class="wk-td wk-td--num wk-amount" role="gridcell">{{ term.openEur | eur }}</span>
                              <span class="wk-td" role="gridcell"></span>
                              <span class="wk-td wk-td--num wk-amount" role="gridcell" [class.wk-amount--in]="term.verschilEur < 0" [class.wk-amount--warn]="term.verschilEur > 0" [class.wk-amount--muted]="term.verschilEur === 0">{{ signed(term.verschilEur) }}@if (reasonBeyondStatus(term.reason)) { <span class="wk-td__sub nc-reason">{{ term.reasonLabel }}</span> }</span>
                              <span class="wk-td" role="gridcell" data-nc-hide="mid"><span class="wk-pill" [class]="tone(term.status.tone)">{{ term.status.label }}</span></span>
                              <span class="wk-td" role="gridcell"></span>
                            </div>
                          }
                        }
                      }
                      @let totals = payeeTotals();
                      <div class="wk-tr wk-tr--total" role="row">
                        <span class="wk-td" role="gridcell">Totaal</span>
                        <span class="wk-td wk-td--num wk-amount" role="gridcell" data-nc-hide="mid narrow">{{ totals.agreedEur | eur }}</span>
                        <span class="wk-td wk-td--num wk-amount" role="gridcell">{{ totals.paidEur | eur }}</span>
                        <span class="wk-td wk-td--num wk-amount" role="gridcell">{{ totals.openEur | eur }}</span>
                        <span class="wk-td wk-td--num wk-amount" role="gridcell">{{ totals.eindkostEur | eur }}</span>
                        <span class="wk-td wk-td--num wk-amount" role="gridcell" [class.wk-amount--in]="totals.verschilEur < 0" [class.wk-amount--warn]="totals.verschilEur > 0">{{ signed(totals.verschilEur) }}</span>
                        <span class="wk-td" role="gridcell" data-nc-hide="mid"></span>
                        <span class="wk-td" role="gridcell"></span>
                      </div>
                    </div>
                  }
                </div>
              </section>

              @if (n.receipt; as receipt) {
                <section class="wk-card" aria-labelledby="nc-receipt-title">
                  <header class="wk-card__head"><h3 class="wk-card__title" id="nc-receipt-title">Ontvangst</h3>
                    <a class="wk-link wk-card__trail" routerLink="/analyses/purchasing" [queryParams]="{ orderId: orderId() }">Ontvangstanalyse ›</a></header>
                  <div class="wk-card__body">
                    @if (receipt.clean) {
                      <p class="nc-muted">Alles volgens bestelling: {{ receipt.usable | num }} stuks ontvangen en bruikbaar.</p>
                    } @else {
                      <div class="nc-tiles">
                        <div class="nc-stat"><small>Besteld</small><b>{{ receipt.ordered | num }}</b></div>
                        <div class="nc-stat"><small>Ontvangen</small><b>{{ receipt.received | num }}</b></div>
                        <div class="nc-stat" [class.is-warn]="receipt.missing > 0"><small>Te weinig</small><b>{{ receipt.missing | num }}</b></div>
                        <div class="nc-stat" [class.is-danger]="receipt.damaged > 0"><small>Beschadigd</small><b>{{ receipt.damaged | num }}</b></div>
                        @if (receipt.over > 0) { <div class="nc-stat"><small>Te veel</small><b>{{ receipt.over | num }}</b></div> }
                        <div class="nc-stat is-strong"><small>Bruikbaar</small><b>{{ receipt.usable | num }}</b></div>
                      </div>
                      @if (receipt.missing > 0 || receipt.damaged > 0) {
                        <dl class="wk-equation nc-receipt__money">
                          <div><dt>Inkoopwaarde ontbrekende stuks<span class="wk-td__sub">{{ receipt.missing | num }} × inkoopwaarde bij ontvangst</span></dt><dd>@if (receipt.missingValueEur === null) { — } @else { {{ receipt.missingValueEur | eur }} }</dd></div>
                          <div><dt>Inkoopwaarde beschadigde stuks<span class="wk-td__sub">{{ receipt.damaged | num }} × inkoopwaarde bij ontvangst</span></dt><dd>@if (receipt.damagedValueEur === null) { — } @else { {{ receipt.damagedValueEur | eur }} }</dd></div>
                          <div class="is-total"><dt>Verlies op inkoopwaarde<span class="wk-td__sub">goederenwaarde bij ontvangst, excl. transport</span></dt><dd>@if (receipt.lossEur === null) { — } @else { {{ receipt.lossEur | eur }} }</dd></div>
                        </dl>
                        @if (receipt.unvaluedPieces > 0 || receipt.lossEur === null) {
                          <p class="nc-muted wk-amount--warn">@if (receipt.unvaluedPieces > 0) { {{ receipt.unvaluedPieces | num }} afwijkende stuks hebben nog geen bevroren inkoopwaarde en tellen niet mee. } @else { De inkoopwaarde van de afwijkende stuks is nog niet vastgelegd. }
                            <a class="wk-link" routerLink="/analyses/purchasing" [queryParams]="{ orderId: orderId() }">Waarde vastleggen ›</a></p>
                        }
                      }
                      @if (receipt.unitUsableEur !== null && receipt.unitOrderedEur !== null && receipt.unitDeltaEur !== null) {
                        <p class="nc-muted">Kost per bruikbaar stuk {{ receipt.unitUsableEur | eur: 4 }} · per besteld stuk zou dit {{ receipt.unitOrderedEur | eur: 4 }} zijn ({{ signedUnit(receipt.unitDeltaEur) }}).</p>
                      }
                      @if (receipt.supplierFact; as fact) {
                        <p class="nc-muted">
                          @switch (fact.kind) {
                            @case ('settled-lower') { Leverancier afgerekend met {{ fact.amountEur | eur }} minder betaald. }
                            @case ('open') { Nog {{ fact.amountEur | eur }} open bij de leverancier — reken lager af als je de tekorten verrekent. }
                            @default { De leverancier is volledig betaald; het verlies van {{ fact.amountEur | eur }} blijft bij Enrosed. Een terugbetaling kan hier nog niet worden genoteerd; verreken het op de volgende order. }
                          }
                        </p>
                      }
                      @if (receipt.over > 0) {
                        <p class="nc-muted">{{ receipt.over | num }} stuks meer dan besteld: de leverancier kan @if (receipt.overValueEur === null) { ≈ — } @else { ≈ {{ receipt.overValueEur | eur }} } extra factureren ({{ receipt.over | num }} × inkoopwaarde). Noteer die betaling als Leverancier en reken dan hoger af.</p>
                      }
                    }
                    @if (receipt.later; as later) {
                      <p class="nc-muted nc-later">Na uitpakken gemeld: @if (later.damaged) { {{ later.damaged | num }} beschadigd }@if (later.damaged && later.missing) { / }@if (later.missing) { {{ later.missing | num }} te weinig } ({{ later.products.join(', ') }}) · uit voorraad genomen, niet in de kostprijs verwerkt.
                        <button class="wk-link" type="button" (click)="openReports.emit()">Schade en tekorten ›</button></p>
                    } @else if (view().receiptReports?.length) {
                      <p class="nc-muted"><button class="wk-link" type="button" (click)="openReports.emit()">Schade en tekorten ›</button></p>
                    }
                  </div>
                </section>
              }
            }

            <section class="wk-card" aria-labelledby="nc-products-title">
              <header class="wk-card__head"><h3 class="wk-card__title" id="nc-products-title">Per product</h3><span class="nc-card__count">{{ n.products.length }} {{ n.products.length === 1 ? 'product' : 'producten' }}</span></header>
              <div class="wk-card__body wk-card__body--flush">
                @if (!n.products.length) {
                  <p class="nc-muted nc-note">Geen productregels</p>
                } @else {
                  @let received = !!n.receipt;
                  <div class="wk-table nc-products" [class.nc-products--received]="received" role="grid" aria-labelledby="nc-products-title">
                    <div class="wk-thead" role="row">
                      <span class="wk-th" role="columnheader">Product</span>
                      <span class="wk-th wk-th--num" role="columnheader">Besteld</span>
                      @if (received) { <span class="wk-th wk-th--num" role="columnheader">Bruikbaar</span> }
                      <span class="wk-th wk-th--num" role="columnheader" data-nc-hide="narrow">Begroot</span>
                      <span class="wk-th wk-th--num" role="columnheader">Eindkost</span>
                      <span class="wk-th wk-th--num" role="columnheader" data-nc-hide="narrow">Verschil</span>
                      <span class="wk-th wk-th--num" role="columnheader">Per stuk</span>
                      <span class="wk-th wk-th--num" role="columnheader" data-nc-hide="mid">Incl. Enrosed kost</span>
                    </div>
                    @for (row of n.products; track row.productId ?? row.name) {
                      <div class="wk-tr" role="row">
                        <span class="wk-td" role="gridcell">
                          @if (row.productId) { <a class="nc-product" [routerLink]="['/products', row.productId]">{{ row.name }}</a> } @else { <b>{{ row.name }}</b> }
                          @if (received && (row.missing || row.damaged || row.over)) {
                            <span class="wk-td__sub">{{ row.ordered | num }} besteld@if (row.missing) { · {{ row.missing | num }} te weinig }@if (row.damaged) { · {{ row.damaged | num }} beschadigd }@if (row.over) { · {{ row.over | num }} te veel }</span>
                          }
                          @if (row.unitQuantity === 0) { <span class="wk-td__sub wk-amount--warn">Geen bruikbare stuks: de kost blijft bij deze regel.</span> }
                        </span>
                        <span class="wk-td wk-td--num wk-amount" role="gridcell">{{ row.ordered | num }}</span>
                        @if (received) { <span class="wk-td wk-td--num wk-amount" role="gridcell">{{ row.usable | num }}</span> }
                        <span class="wk-td wk-td--num wk-amount" role="gridcell" data-nc-hide="narrow">{{ row.begrootEur | eur }}</span>
                        <span class="wk-td wk-td--num wk-amount wk-amount--strong" role="gridcell">{{ row.eindkostEur | eur }}
                          @if (row.verschilEur !== 0) { <span class="wk-td__sub nc-when-narrow" [class.wk-amount--in]="row.verschilEur < 0" [class.wk-amount--warn]="row.verschilEur > 0">{{ signed(row.verschilEur) }}</span> }</span>
                        <span class="wk-td wk-td--num wk-amount" role="gridcell" data-nc-hide="narrow" [class.wk-amount--in]="row.verschilEur < 0" [class.wk-amount--warn]="row.verschilEur > 0" [class.wk-amount--muted]="row.verschilEur === 0">{{ row.verschilEur === 0 ? '—' : signed(row.verschilEur) }}</span>
                        <span class="wk-td wk-td--num wk-amount" role="gridcell">@if (row.unitEur !== null && row.unitQuantity > 0) { {{ row.unitEur | eur: 4 }} } @else { — }
                          @if (row.pricingUnitEur !== null && row.unitQuantity > 0) { <span class="wk-td__sub nc-when-mid">{{ row.pricingUnitEur | eur: 4 }} incl. Enrosed kost</span> }</span>
                        <span class="wk-td wk-td--num wk-amount" role="gridcell" data-nc-hide="mid">@if (row.pricingUnitEur !== null && row.unitQuantity > 0) { {{ row.pricingUnitEur | eur: 4 }} } @else { — }</span>
                      </div>
                    }
                    <div class="wk-tr wk-tr--total" role="row">
                      <span class="wk-td" role="gridcell">Totaal</span>
                      <span class="wk-td wk-td--num wk-amount" role="gridcell">{{ head.orderedQuantity | num }}</span>
                      @if (received) { <span class="wk-td wk-td--num wk-amount" role="gridcell">{{ head.unitQuantity | num }}</span> }
                      <span class="wk-td wk-td--num wk-amount" role="gridcell" data-nc-hide="narrow">{{ n.productTotals.begrootEur | eur }}</span>
                      <span class="wk-td wk-td--num wk-amount" role="gridcell">{{ n.productTotals.eindkostEur | eur }}</span>
                      <span class="wk-td wk-td--num wk-amount" role="gridcell" data-nc-hide="narrow" [class.wk-amount--in]="n.productTotals.verschilEur < 0" [class.wk-amount--warn]="n.productTotals.verschilEur > 0">{{ n.productTotals.verschilEur === 0 ? '—' : signed(n.productTotals.verschilEur) }}</span>
                      <span class="wk-td wk-td--num wk-amount" role="gridcell">@if (head.unitEur !== null) { {{ head.unitEur | eur: 4 }} }</span>
                      <span class="wk-td wk-td--num wk-amount" role="gridcell" data-nc-hide="mid">@if (head.pricingUnitEur !== null) { {{ head.pricingUnitEur | eur: 4 }} }</span>
                    </div>
                  </div>
                }
              </div>
            </section>
          </div>

          <aside class="nc-side" aria-label="Opbouw, kostbasis, partner en toelichting">
            @if (!concept) {
              <section class="wk-card">
                <header class="wk-card__head"><h3 class="wk-card__title">Zo komt de eindkost tot stand</h3><button class="wk-link wk-card__trail" type="button" (click)="openCosts.emit()">Kosten ›</button></header>
                <div class="wk-card__body">
                  <dl class="wk-equation nc-bridge">
                    @for (row of n.bridge.rows; track row.key) {
                      <div [class.is-total]="row.op === '='" [class.is-sub]="row.key === 'REVIEW' || row.key === 'ADDITIONAL'" [class.nc-bridge__variance]="row.key === 'VARIANCE'">
                        <dt>@if (row.op && row.op !== '→') { <span class="wk-equation__op" aria-hidden="true">{{ row.op }}</span> }{{ row.label }}@if (row.note) { <span class="wk-td__sub">{{ row.note }}</span> }</dt>
                        <dd [class.wk-amount--in]="row.key === 'VARIANCE' && row.amountEur < 0" [class.wk-amount--warn]="row.key === 'VARIANCE' && row.amountEur > 0" [class.wk-amount--muted]="row.key === 'VARIANCE' && row.amountEur === 0">{{ row.key === 'VARIANCE' ? signed(row.amountEur) : (row.amountEur | eur) }}</dd>
                      </div>
                    }
                  </dl>
                  @if (!n.bridge.consistent) { <p class="nc-muted wk-amount--warn">De onderdelen sluiten niet exact aan; controleer de kosten.</p> }
                  @let ex = n.explained;
                  <h4 class="nc-side__sub">Afgerekende verschillen</h4>
                  <dl class="wk-equation nc-explained">
                    <div><dt><span class="wk-equation__op" aria-hidden="true">−</span>minder betaald · afgerekend</dt><dd [class.wk-amount--in]="ex.savingsEur > 0">{{ ex.savingsEur | eur }}</dd></div>
                    <div><dt><span class="wk-equation__op" aria-hidden="true">+</span>meer betaald · afgerekend</dt><dd [class.wk-amount--warn]="ex.overrunsEur > 0">{{ ex.overrunsEur | eur }}</dd></div>
                    <div><dt><span class="wk-equation__op" aria-hidden="true">+</span>bijkomend</dt><dd [class.wk-amount--warn]="ex.additionalEur > 0">{{ ex.additionalEur | eur }}</dd></div>
                    @if (ex.fxEur !== 0) { <div class="is-sub"><dt>koersverschil · zit al in betaald</dt><dd>{{ signed(ex.fxEur) }}</dd></div> }
                    @if (ex.openEur > 0) { <div class="is-sub"><dt>nog open · blijft in de eindkost tot afrekening</dt><dd>{{ ex.openEur | eur }}</dd></div> }
                  </dl>
                  <p class="nc-muted">{{ head.kind === 'final' ? 'Alle ontvangers zijn afgerekend.' : 'Minder betalen telt pas na afrekening; te veel betaald blijft voorlopig tot het is nagekeken.' }}</p>
                </div>
              </section>
            }

            <section class="wk-card">
              <header class="wk-card__head"><h3 class="wk-card__title">Kostbasis voor prijzen</h3>
                @if (n.receipt) { <button class="wk-link wk-card__trail" type="button" (click)="applyCosts.emit()">Kostprijzen toepassen ›</button> }
                @else { <button class="wk-link wk-card__trail" type="button" (click)="openCosts.emit()">Calculatie ›</button> }</header>
              <div class="wk-card__body">
                <dl class="wk-equation">
                  <div><dt>{{ concept ? 'Begrote kost' : head.label }}</dt><dd>{{ head.eindkostEur | eur }}</dd></div>
                  <div><dt><span class="wk-equation__op" aria-hidden="true">+</span>Enrosed kost<span class="wk-td__sub">intern, geen betaling</span></dt><dd>{{ head.markupEur | eur }}</dd></div>
                  <div class="is-total"><dt><span class="wk-equation__op" aria-hidden="true">=</span>Kostbasis</dt><dd>{{ head.pricingEur | eur }}</dd></div>
                  <div class="is-sub"><dt>Per stuk incl. Enrosed kost</dt><dd>@if (head.pricingUnitEur !== null) { {{ head.pricingUnitEur | eur: 4 }} } @else { — }</dd></div>
                </dl>
                <p class="nc-muted">Gelijk aan “{{ head.separateApart ? 'Totaal incl. aparte kosten' : 'Totaal geland' }}” in Kosten zolang er niets anders betaald is. De Enrosed kost is geen betaling en past prijzen of offertes niet aan.</p>
              </div>
            </section>

            @if (n.partner; as partner) {
              <section class="wk-card nc-partner">
                <header class="wk-card__head"><h3 class="wk-card__title">Partner</h3><button class="wk-link wk-card__trail" type="button" (click)="openPartner.emit()">Partner ›</button></header>
                <div class="wk-card__body">
                  <dl class="wk-equation">
                    <div><dt>Partner financiert {{ partner.costPct }} %<span class="wk-td__sub">@if (partner.advanceEur !== null) { voorschot op {{ partner.basisEur | eur }} incl. Enrosed kost en aparte kosten }@if (partner.financing) { @if (partner.advanceEur !== null) { · } afgesproken {{ partner.financing.committedAdvanceEur | eur }} }</span></dt><dd>@if (partner.advanceEur !== null) { {{ partner.advanceEur | eur }} }</dd></div>
                    <div><dt>Resultaat voor ENROSED</dt><dd>{{ partner.sharePct }} %</dd></div>
                    @if (partnerState() === 'loading') {
                      <div><dt><app-skeleton kind="lines" [rows]="3" /></dt><dd></dd></div>
                    } @else if (partnerState() === 'error') {
                      <div><dt class="wk-amount--muted">Partnerfinanciering niet beschikbaar · <button class="wk-link" type="button" (click)="refreshPartner.emit()">Opnieuw laden</button></dt><dd></dd></div>
                    } @else if (partner.financing; as fin) {
                      <div><dt>Voorschot gefactureerd<span class="wk-td__sub">excl. btw</span></dt><dd>{{ fin.invoicedAdvanceEur | eur }}</dd></div>
                      <div><dt>Voorschot ontvangen<span class="wk-td__sub">incl. btw · open {{ fin.openAdvanceEur | eur }}</span></dt><dd>{{ fin.receivedAdvanceEur | eur }}</dd></div>
                      <div><dt>Eigen geld ingelegd</dt><dd>{{ fin.ownExposureEur | eur }}</dd></div>
                      <div><dt>Afgerekend met de partner@if (fin.settlementNumber) { <span class="wk-td__sub">{{ fin.settlementComplete ? 'slotfactuur' : 'deelfactuur' }}</span> }</dt><dd>{{ fin.settlementNumber ?? 'nog niet' }}</dd></div>
                      @if (fin.creditEur > 0) { <div><dt>Tegoed partner<span class="wk-td__sub">terug te betalen of te verrekenen</span></dt><dd class="wk-amount--warn">{{ fin.creditEur | eur }}</dd></div> }
                      @if (fin.unbilledCount > 0) { <div><dt>{{ fin.unbilledCount }} {{ fin.unbilledCount === 1 ? 'voorschottermijn' : 'voorschottermijnen' }} nog te factureren</dt><dd></dd></div> }
                    }
                  </dl>
                  <p class="nc-muted">Bij de veilingafrekening betaalt de partner de eindkost van de verkochte stuks @if (partner.unitEur !== null) { ({{ partner.unitEur | eur: 4 }} per bruikbaar stuk) } plus {{ partner.sharePct }} % van het resultaat; het voorschot wordt dan verrekend.</p>
                  @if (partner.shortPieces > 0) {
                    <p class="nc-muted nc-warn">{{ partner.shortPieces | num }} stuks kwamen niet aan: de partner betaalt alleen voor bruikbare stuks, tegen een hogere kost per stuk.@if (partner.shortageAfterAdvance) { Het voorschot is berekend op {{ partner.ordered | num }} bestelde stuks; verreken het verschil bij de slotfactuur of met een creditnota op het voorschot. }</p>
                  }
                </div>
              </section>
            }

            <section class="wk-card">
              <details class="nc-details" [open]="notesOpen()" (toggle)="notesOpen.set($any($event.target).open)">
                <summary class="wk-card__head"><h3 class="wk-card__title">Toelichting</h3><app-icon class="nc-details__chev" name="chevron-right" [size]="16" /></summary>
                <div class="wk-card__body"><ul class="nc-notes">@for (note of n.notes; track $index) { <li>{{ note }}</li> }</ul></div>
              </details>
            </section>
          </aside>
        </div>

        <footer class="wk-statusbar nc-status">
          <span>{{ paymentCount() }} {{ paymentCount() === 1 ? 'betaling' : 'betalingen' }} · budget op bestelde aantallen en orderkoersen · excl. btw@if (head.fxEur !== 0) { · koersverschil {{ signed(head.fxEur) }} t.o.v. orderkoers }</span>
          <span class="wk-statusbar__end nc-keys"><kbd class="wk-kbd">⌥1</kbd> <kbd class="wk-kbd">⌥2</kbd> <kbd class="wk-kbd">⌥3</kbd> weergave</span>
        </footer>
      } @else {
        <div class="wk-empty nc-empty">
          <span class="wk-empty__icon"><app-icon name="layers" [size]="22" /></span>
          <p class="wk-empty__text">De nacalculatie is nog niet beschikbaar. Vernieuw de order om de actuele betalingen op te halen.</p>
          <div class="wk-empty__actions"><button class="wk-btn" type="button" (click)="refresh.emit()">Vernieuwen</button></div>
        </div>
      }
    </section>
    @if (menu(); as open) {
      <app-context-menu [title]="open.kind === 'more' ? 'Nacalculatie' : open.row.label" [anchor]="open.point" [items]="menuItems(open)" (pick)="pick(open, $event)" (closed)="menu.set(null)" />
    }
  `,
})
export class PurchaseNacalcWorkbench {
  private readonly router = inject(Router);
  private readonly sourcing = inject(SourcingApi);
  private readonly ui = inject(Ui);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    // The Toelichting starts open only where the side column has room for it: at ≥ 1100 px of the section.
    afterNextRender(() => {
      const root = this.host.nativeElement.querySelector('.nc');
      if (root && root.clientWidth < 1100) this.notesOpen.set(false);
    });
  }

  readonly view = input.required<PurchaseOrderView>();
  readonly ledger = input<PaymentLedger | null>(null);
  readonly nacalc = input<PurchaseNacalc | null>(null);
  readonly partner = input<PartnerFinancing | null | 'loading' | 'error'>(null);
  readonly state = input<'loading' | 'refreshing' | 'error' | 'ready'>('ready');
  readonly error = input<string | null>(null);
  readonly dirty = input(false);
  readonly saving = input(false);
  readonly busy = input(false);
  readonly orderId = input.required<number>();
  /** A payee, or nothing for the Betalingen workbench as a whole. */
  readonly openPayments = output<Payee | undefined>();
  readonly settle = output<PurchaseSettleRequest>();
  readonly undoSettle = output<{ payee: Payee; due?: Due | null }>();
  readonly save = output<void>();
  readonly refresh = output<void>();
  readonly refreshPartner = output<void>();
  readonly openPartner = output<void>();
  readonly openReports = output<void>();
  readonly applyCosts = output<void>();
  readonly openCosts = output<void>();

  readonly menu = signal<MenuState | null>(null);
  readonly pdfBusy = signal(false);
  readonly notesOpen = signal(true);
  /** The supplier's terms open by themselves when they tell different stories. */
  readonly expanded = linkedSignal<Set<Payee>>(() => {
    const mixed = this.nacalc()?.payees?.filter(row => row.termsMixed).map(row => row.payee) ?? [];
    return new Set(mixed);
  });
  readonly round = Math.round;
  readonly actionable = computed(() => !this.busy() && !this.dirty() && this.state() === 'ready' && !!this.ledger());
  readonly partnerState = computed(() => { const partner = this.partner(); return partner === 'loading' || partner === 'error' ? partner : 'ready'; });
  readonly paymentCount = computed(() => this.ledger()?.summary.paymentCount ?? this.view().reconciliation?.streams.reduce((sum, stream) => sum + stream.paymentCount, 0) ?? 0);
  readonly payeeTotals = computed(() => {
    const rows = this.nacalc()?.payees ?? [];
    const sum = (pick: (row: NacalcPayeeRow) => number) => Math.round(rows.reduce((total, row) => total + pick(row) * 100, 0)) / 100;
    return { agreedEur: sum(row => row.agreedEur ?? 0), paidEur: sum(row => row.paidEur), openEur: sum(row => row.openEur),
      eindkostEur: sum(row => row.eindkostEur), verschilEur: sum(row => row.verschilEur) };
  });

  tone(tone: LedgerTone): string { return tone === 'warn' ? 'tone-warn' : tone === 'ok' ? 'tone-ok' : ''; }
  /** Next to the status pill only a reason that says more than the pill does: how much is open, what is historic, what has no agreement. */
  reasonBeyondStatus(reason: NacalcReason): boolean { return reason === 'open' || reason === 'partly-settled' || reason === 'legacy' || reason === 'additional'; }
  pillClass(tone: NacalcTone): string { return tone === 'ok' ? 'tone-ok' : tone === 'warn' ? 'tone-warn' : tone === 'outline' ? 'wk-pill--outline' : ''; }
  isExpanded(payee: Payee): boolean { return this.expanded().has(payee); }
  toggle(payee: Payee): void {
    this.expanded.update(open => { const next = new Set(open); if (next.has(payee)) next.delete(payee); else next.add(payee); return next; });
  }

  /** '+ € 120,00', '− € 50,00' or a plain '€ 0,00'; the sign never wraps away from its figure. */
  signed(value: number): string {
    if (!value) return formatEur(0);
    return (value > 0 ? '+ ' : '− ') + formatEur(Math.abs(value));
  }
  signedUnit(value: number): string {
    const text = Math.abs(value).toLocaleString('nl-BE', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
    return (value < 0 ? '− € ' : '+ € ') + text;
  }
  pct(value: number): string { return Math.abs(value).toLocaleString('nl-BE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' %'; }

  unitBasis(n: PurchaseNacalc): string {
    const head = n.headline;
    const base = head.unitBasis === 'USABLE_RECEIVED'
      ? `${head.unitQuantity.toLocaleString('nl-BE')} bruikbare stuks · ${head.orderedQuantity.toLocaleString('nl-BE')} besteld`
      : `${head.unitQuantity.toLocaleString('nl-BE')} bestelde stuks`;
    return base + (head.includesInspection ? ' · incl. inspectie' : '') + (head.ddp ? ' · DDP' : '');
  }

  /** A row click shows the payee's payments; the click that trails a long-press menu is left alone. */
  rowClick(event: MouseEvent, payee: Payee): void {
    if (event.defaultPrevented) return;
    this.openPayments.emit(payee);
  }

  /** Enter on the row itself shows the payee's payments; a button inside the row keeps its own keys. */
  onRowKey(event: KeyboardEvent, payee: Payee): void {
    if (event.target !== event.currentTarget || event.key !== 'Enter' || event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();
    this.openPayments.emit(payee);
  }

  openMenu(kind: 'more' | 'payee', event: MouseEvent, row?: NacalcPayeeRow): void {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const point = { x: rect.left, y: rect.bottom + 4 };
    this.menu.set(kind === 'payee' ? { kind, point, row: row! } : { kind, point });
  }

  menuItems(open: MenuState): ContextMenuItem[] {
    const n = this.nacalc();
    const busy = !this.actionable();
    if (open.kind === 'more') {
      const received = !!n?.receipt;
      // One undo item per settled payee, so the confirm never picks a payee the owner did not name.
      const undoable = n?.payees?.filter(row => row.canUndoSettle) ?? [];
      return [
        { id: 'payments', label: 'Betalingen ›', iconName: 'bank' },
        ...(received ? [{ id: 'apply', label: 'Kostprijzen toepassen ›', iconName: 'tick' }] : []),
        { id: 'finance', label: 'Kosten & bank ›', iconName: 'exchange' },
        ...(received ? [{ id: 'analysis', label: 'Ontvangstanalyse ›', iconName: 'analytics' }] : []),
        ...(this.view().receiptReports?.length ? [{ id: 'reports', label: 'Schade en tekorten ›', iconName: 'alert' }] : []),
        ...undoable.map(row => ({ id: 'undo:' + row.payee, label: undoable.length === 1 ? 'Afrekening ongedaan maken…' : `Afrekening ongedaan maken · ${row.label}…`, iconName: 'restore', disabled: busy })),
        { id: 'refresh', label: 'Vernieuwen', iconName: 'refresh', divider: true },
      ];
    }
    const row = open.row;
    return [
      { id: 'payments', label: `Betalingen van ${row.label} ›`, iconName: 'list' },
      ...(row.canUndoSettle ? [{ id: 'undo', label: 'Afrekening ongedaan maken', iconName: 'restore', disabled: busy }] : []),
      ...(row.payee === 'SUPPLIER' && row.terms.length && !row.termsMixed ? [{ id: 'terms', label: 'Termijnen ›', iconName: 'calendar' }] : []),
      ...(row.payee === 'LOGISTICS' || row.payee === 'SEPARATE' ? [{ id: 'costs', label: 'Bedrag in Kosten aanpassen ›', iconName: 'pencil' }] : []),
    ];
  }

  pick(open: MenuState, item: ContextMenuItem): void {
    this.menu.set(null);
    if (open.kind === 'more') {
      if (item.id.startsWith('undo:')) { this.undoSettle.emit({ payee: item.id.slice('undo:'.length) as Payee }); return; }
      switch (item.id) {
        case 'payments': this.openPayments.emit(undefined); break;
        case 'apply': this.applyCosts.emit(); break;
        case 'finance': void this.router.navigate(['/costs'], { queryParams: { container: this.orderId() } }); break;
        case 'analysis': void this.router.navigate(['/analyses/purchasing'], { queryParams: { orderId: this.orderId() } }); break;
        case 'reports': this.openReports.emit(); break;
        default: this.refresh.emit();
      }
      return;
    }
    switch (item.id) {
      case 'undo': this.undoSettle.emit({ payee: open.row.payee }); break;
      case 'terms': this.expanded.update(set => new Set([...set, open.row.payee])); break;
      case 'costs': this.openCosts.emit(); break;
      default: this.openPayments.emit(open.row.payee);
    }
  }

  /** The same PDF as the Betalingen workbench offers; only of what is saved. */
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
