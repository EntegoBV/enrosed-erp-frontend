import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, output, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import type {
  ClosingArticle, ClosingArticleLocation, ClosingContainer, ClosingLayer, ClosingLot, ClosingStream, ClosingView, Decision,
  DecisionWrite, Notice, OpeningLayer, OpeningLayerWrite,
} from '../../core/api/inventory-models';
import { DateField } from '../../shared/date-field';
import { DateNlPipe, EurPipe, NumPipe, PctPipe } from '../../shared/pipes';
import { SegmentOption, Segmented } from '../../shared/segmented';
import { Ui, escapeHtml } from '../../shared/ui';
import { elementWidth } from '../../shared/workspace-layout';
import { AccrualChoice, ClosingAccrualSheet } from './closing-accrual-sheet';
import { ClosingCreditSheet, CreditChoice } from './closing-credit-sheet';
import {
  ClosingDecisionSheet, DecisionSheetResult, DecisionSheetSpec, followAnchor, parseDecimal,
} from './closing-decision-sheet';
import { ClosingWriteDownSheet, WriteDownChoice } from './closing-write-down-sheet';
import {
  SupplierBilledChoice, borderFixed, decisionWriteAccrual, decisionWriteCreditTreatment, decisionWriteOwnershipDate,
  decisionWriteSupplierBilled, decisionWriteWriteDown, defaultOpeningDate, openingDateError, streamButtonLabel, streamNotice,
  unvaluedRows,
} from './inventory-closing';
import { inventoryUnit } from './inventory-unit';

type ValueTab = 'producten' | 'containers' | 'zonder';
type Credit = ClosingContainer['credits'][number];

interface CategoryGroup {
  category: string;
  articles: ClosingArticle[];
}

/** A saved waardevermindering of a product with the amount its rows add up to. */
interface SavedWriteDown {
  decision: Decision;
  amountEur: number;
}

/** The generic sheet with what its answer does. */
interface Question {
  spec: DecisionSheetSpec;
  save: (result: DecisionSheetResult) => void;
  remove?: () => void;
}

const NO_CATEGORY = 'Zonder categorie';
const ROLE_LABEL: Record<ClosingContainer['role'], string> = {
  EIGEN: 'Eigen container', PARTNER: 'Partnercontainer', ONDERWEG: 'Onderweg', VORIG: 'Vorige afsluiting',
};
const STATE_LABEL: Record<ClosingStream['state'], string> = { WERKELIJK: 'Werkelijk', GESCHAT: 'Geschat', BEVESTIGD: 'Bevestigd' };
const LOT_STATUS: Partial<Record<ClosingLot['status'], string>> = {
  TEKORT: 'tekort', MEER_ONTVANGEN: 'meer ontvangen', GEEN_PRIJS: 'geen prijs', GEEN_ONTVANGST: 'niet ontvangen',
};
const CREDIT_EFFECT: Record<Credit['treatment'], string> = {
  VERLAAGT: 'verlaagt de aanschafwaarde', BUITEN: 'buiten de voorraadwaarde', IN_BETALING: 'reeds in de betaling',
  NOG_TE_BESLISSEN: 'nog te beslissen',
};
const BILLED_CHOICES: readonly { value: SupplierBilledChoice; label: string }[] = [
  { value: 'BESTELD', label: 'De leverancier rekende de bestelde stuks aan; het lagere bedrag is een prijsvermindering' },
  { value: 'GELEVERD', label: 'De leverancier rekende alleen de geleverde stuks aan' },
];
/* The six columns of the product table need about 920 px next to the 360 px build-up. */
const DOCK_MIN_PX = 1300;
const cents = (eur: number) => Math.round(eur * 100);

/**
 * Step 3 of the closing, "Waarde": the valued products with their FIFO
 * build-up, the containers behind the lots with every amount that entered
 * the acquisition value, and the products that still lack a value. Every
 * figure comes from the server; this step shows it and collects the
 * decisions (amount owed, ownership date, what a credit is, which pieces the
 * supplier charged, waardevermindering) and the beginwaarden, which it
 * emits. The shell saves and recomputes.
 */
@Component({
  selector: 'app-closing-step-value',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgTemplateOutlet, RouterLink, Segmented, DateField, EurPipe, NumPipe, DateNlPipe, PctPipe,
    ClosingWriteDownSheet, ClosingAccrualSheet, ClosingCreditSheet, ClosingDecisionSheet,
  ],
  host: { class: 'inv-step inv-value' },
  template: `
    <app-segmented class="inv-value__tabs" label="Waarde" semantics="tabs" [options]="tabs()" [value]="tab()" (changed)="tab.set($any($event))" />

    @switch (tab()) {
      @case ('producten') {
        <div class="inv-value__split" [class.inv-value__split--docked]="docked() && !!selected()">
          <div class="wk-table inv-scroll inv-products" role="table">
            <div class="wk-thead" role="row">
              <span class="wk-th" role="columnheader">Product</span>
              <span class="wk-th wk-th--num" role="columnheader">Aantal</span>
              <span class="wk-th wk-th--num" role="columnheader">Waarde per stuk (gem.)</span>
              <span class="wk-th wk-th--num" role="columnheader">Aanschafwaarde</span>
              <span class="wk-th wk-th--num" role="columnheader">Waardevermindering</span>
              <span class="wk-th wk-th--num" role="columnheader">Waarde</span>
            </div>
            @for (group of groups(); track group.category) {
              <div class="wk-group" role="row"><span class="wk-group__label" role="cell">{{ group.category }} <span class="wk-group__count">{{ group.articles.length }}</span></span></div>
              @for (article of group.articles; track article.productId) {
                <div class="wk-tr wk-tr--link inv-products__row" role="row" tabindex="0" [id]="'inv-product-' + article.productId"
                     [attr.aria-selected]="selectedId() === article.productId" (click)="select(article)" (keydown.enter)="select(article)">
                  <span class="wk-td" role="cell">{{ article.productName }}
                    <span class="wk-td__sub">{{ article.sku || 'Geen SKU' }}</span>
                    @if (article.estimatedEur > 0 || article.demo || article.unvaluedQuantity > 0 || (article.previousWriteDownEur ?? 0) > 0) {
                      <span class="inv-products__chips">
                        @if (article.estimatedEur > 0) { <span class="wk-pill tone-amber">geschat</span> }
                        @if (article.demo) { <span class="wk-pill tone-blue">demo</span> }
                        @if (article.unvaluedQuantity > 0) { <span class="wk-pill tone-danger">zonder waarde</span> }
                        @if ((article.previousWriteDownEur ?? 0) > 0) { <span class="inv-products__prev">Vorig jaar waardevermindering {{ article.previousWriteDownEur | eur }}</span> }
                      </span>
                    }
                  </span>
                  <span class="wk-td wk-td--num" role="cell">{{ article.ownQuantity | num }} {{ unitWord(article, article.ownQuantity) }}
                    @if (article.closingQuantity !== article.ownQuantity) { <span class="wk-td__sub">van {{ article.closingQuantity | num }} aanwezig</span> }
                  </span>
                  <span class="wk-td wk-td--num" role="cell">{{ article.averageUnitEur === null ? '—' : (article.averageUnitEur | eur: 4) }}</span>
                  <span class="wk-td wk-td--num" role="cell">{{ article.costValueEur | eur }}</span>
                  <span class="wk-td wk-td--num" role="cell">{{ article.writeDownEur ? (article.writeDownEur | eur) : '—' }}</span>
                  <span class="wk-td wk-td--num" role="cell">{{ article.ownValueEur | eur }}</span>
                </div>
                @if (!docked() && selectedId() === article.productId) {
                  <div class="inv-products__inline" [style.width.px]="width()"><ng-container [ngTemplateOutlet]="inspector" [ngTemplateOutletContext]="{ $implicit: article }" /></div>
                }
              }
            } @empty {
              <p class="inv-step__empty">Geen producten in deze afsluiting.</p>
            }
            <div class="wk-tr wk-tr--total" role="row">
              <span class="wk-td" role="cell">Totaal eigen voorraad</span>
              <span class="wk-td wk-td--num" role="cell">{{ view().totals.ownQuantity | num }}</span>
              <span class="wk-td" role="cell"></span>
              <span class="wk-td wk-td--num" role="cell">{{ view().totals.costValueEur | eur }}</span>
              <span class="wk-td wk-td--num" role="cell">{{ view().totals.writeDownEur | eur }}</span>
              <span class="wk-td wk-td--num" role="cell">{{ view().totals.ownValueEur | eur }}</span>
            </div>
          </div>
          @if (docked() && selected(); as article) {
            <aside class="inv-value__aside"><ng-container [ngTemplateOutlet]="inspector" [ngTemplateOutletContext]="{ $implicit: article }" /></aside>
          }
        </div>
      }

      @case ('containers') {
        @for (container of current(); track container.purchaseOrderId + container.role) {
          <ng-container [ngTemplateOutlet]="card" [ngTemplateOutletContext]="{ $implicit: container }" />
        } @empty {
          <p class="inv-step__empty">Geen containers in deze afsluiting.</p>
        }
        @if (previous().length) {
          <details class="inv-fold inv-fold--block">
            <summary>Containers uit vorige afsluiting, ter vergelijking ({{ previous().length }})</summary>
            @for (container of previous(); track container.purchaseOrderId + container.role) {
              <ng-container [ngTemplateOutlet]="card" [ngTemplateOutletContext]="{ $implicit: container }" />
            }
          </details>
        }
      }

      @case ('zonder') {
        <section class="wk-card inv-unvalued" id="inv-unvalued">
          <div class="wk-card__head"><h3 class="wk-card__title">Zonder waarde ({{ unvalued().length }})</h3></div>
          <div class="wk-card__body">
            <p class="inv-step__text">Een beginwaarde is de aanschafwaarde zonder Enrosed kost van voorraad van vóór de containers in het ERP, met haar bron. Geen vrije prijs.</p>
            @if (unvalued().length && editable()) {
              <div class="inv-unvalued__shared">
                <div class="field">
                  <label for="inv-opening-date">Datum van deze waarde</label>
                  <app-date-field fieldId="inv-opening-date" [value]="openingDate()" (valueChange)="openingDateInput.set($event)" />
                  @if (dateError(); as error) { <span class="hint inv-hint--stop">{{ error }}</span> }
                </div>
                <div class="field">
                  <label for="inv-opening-source">Bron</label>
                  <input class="input" id="inv-opening-source" type="text" maxlength="255" autocomplete="off" placeholder="bijv. inventaris 31/12/2025 van de boekhouder" [value]="source()" (input)="source.set($any($event.target).value)" />
                </div>
              </div>
            }
            @if (unvalued().length) {
              <div class="wk-table inv-unvalued__table" role="table">
                <div class="wk-thead" role="row">
                  <span class="wk-th" role="columnheader">Product</span>
                  <span class="wk-th wk-th--num" role="columnheader">Zonder waarde (aantal)</span>
                  <span class="wk-th wk-th--num" role="columnheader">Aantal</span>
                  <span class="wk-th wk-th--num" role="columnheader">{{ unvaluedHead() }}</span>
                </div>
                @for (article of unvalued(); track article.productId) {
                  <div class="wk-tr" role="row">
                    <span class="wk-td" role="cell">{{ article.productName }} <span class="wk-td__sub">{{ article.sku || 'Geen SKU' }}</span></span>
                    <span class="wk-td wk-td--num" role="cell">{{ article.unvaluedQuantity | num }} {{ unitWord(article, article.unvaluedQuantity) }}</span>
                    <span class="wk-td wk-td--num inv-unvalued__cell" role="cell">
                      <input class="inv-field" type="text" inputmode="numeric" autocomplete="off" [attr.aria-label]="'Aantal ' + article.productName"
                             [disabled]="!editable() || busy()" [value]="quantityText(article)" (input)="setQuantity(article, $any($event.target).value)" />
                    </span>
                    <span class="wk-td wk-td--num inv-unvalued__cell" role="cell">
                      <input class="inv-field" type="text" inputmode="decimal" autocomplete="off" placeholder="€"
                             [attr.aria-label]="'Waarde per ' + unitOf(article).singular + ' ' + article.productName"
                             [disabled]="!editable() || busy()" [value]="values()[article.productId] ?? ''" (input)="setValue(article, $any($event.target).value)" />
                      <span class="inv-unvalued__unit">per {{ unitOf(article).singular }}</span>
                    </span>
                  </div>
                }
              </div>
              @if (editable()) {
                <div class="inv-unvalued__foot">
                  <button class="wk-btn wk-btn--primary" type="button" [disabled]="!canSaveOpening()" (click)="saveOpening()">Beginwaarden bewaren</button>
                  <span class="inv-step__quiet">{{ filled().length }} van {{ unvalued().length }} ingevuld</span>
                </div>
              }
            } @else {
              <p class="inv-step__empty">Elk product heeft een gewaardeerde partij.</p>
            }
          </div>
        </section>

        @if (view().openingLayers.length) {
          <section class="wk-card">
            <div class="wk-card__head"><h3 class="wk-card__title">Beginwaarden ({{ view().openingLayers.length }})</h3></div>
            <div class="wk-card__body wk-card__body--flush">
              <div class="wk-table inv-scroll inv-opening" role="table">
                <div class="wk-thead" role="row">
                  <span class="wk-th" role="columnheader">Product</span>
                  <span class="wk-th wk-th--num" role="columnheader">Aantal</span>
                  <span class="wk-th wk-th--num" role="columnheader">Waarde per stuk</span>
                  <span class="wk-th" role="columnheader">Datum</span>
                  <span class="wk-th" role="columnheader">Bron</span>
                  <span class="wk-th" role="columnheader"></span>
                </div>
                @for (layer of view().openingLayers; track layer.id) {
                  <div class="wk-tr" role="row">
                    <span class="wk-td" role="cell">{{ layer.productName }} <span class="wk-td__sub">{{ layer.sku || 'Geen SKU' }}</span></span>
                    <span class="wk-td wk-td--num" role="cell">{{ layer.quantity | num }}</span>
                    <span class="wk-td wk-td--num" role="cell">{{ layer.unitValueEur | eur: 4 }}</span>
                    <span class="wk-td" role="cell">{{ layer.asOfDate | dateNl }}</span>
                    <span class="wk-td wk-td--wrap" role="cell">{{ layer.source }} <span class="wk-td__sub">{{ layer.createdByName }}</span></span>
                    <span class="wk-td inv-opening__action" role="cell">
                      @if (editable()) { <button class="wk-btn wk-btn--sm wk-btn--danger" type="button" [disabled]="busy()" (click)="retire(layer)">Verwijderen</button> }
                    </span>
                  </div>
                }
              </div>
            </div>
          </section>
        }
      }
    }

    <!-- "Opbouw (FIFO)" of one product: docked beside the table on a wide step, under its row otherwise -->
    <ng-template #inspector let-article>
      <div class="inv-inspector">
        <div class="inv-inspector__head">
          <h3 class="inv-inspector__title">Opbouw (FIFO) <small>{{ article.productName }}</small></h3>
          <button class="wk-btn wk-btn--sm wk-btn--ghost" type="button" (click)="selectedId.set(null)">Sluiten</button>
        </div>
        <section class="wk-section">
          <h4 class="wk-section__title">Partijen</h4>
          @for (layer of ownLayers(article); track layer.position) {
            <p class="inv-layer">
              <span>{{ layer.quantity | num }} x {{ layer.unitValueEur | eur: 4 }} · {{ layerLabel(layer) }}
                @if (layer.estimatedEur > 0) { <span class="wk-pill tone-amber">geschat</span> }
                @if (layer.writeDownEur > 0) { <span class="wk-td__sub">{{ layer.writeDownQuantity | num }} met waardevermindering {{ layer.writeDownEur | eur }}</span> }
              </span>
              <span class="wk-amount">{{ layer.valueEur | eur }}</span>
            </p>
          } @empty {
            <p class="inv-step__quiet">Geen gewaardeerde partij.</p>
          }
          @if (article.unvaluedQuantity > 0) {
            <p class="inv-layer inv-layer--stop"><span>{{ article.unvaluedQuantity | num }} zonder gewaardeerde partij</span>
              <button class="wk-link" type="button" (click)="tab.set('zonder')">Beginwaarde invullen ›</button></p>
          }
          @for (layer of invoicedLayers(article); track $index) {
            <p class="inv-layer inv-layer--apart">
              <span>{{ layer.quantity | num }} x {{ layer.unitValueEur | eur: 4 }} · {{ layerLabel(layer) }} <span class="wk-pill">gefactureerd, niet in het totaal</span></span>
              <span class="wk-amount wk-amount--muted">{{ layer.valueEur | eur }}</span>
            </p>
          }
        </section>
        <section class="wk-section">
          <h4 class="wk-section__title">Aanschafwaarde</h4>
          <dl class="wk-equation">
            <div><dt>Goederen (leverancier)</dt><dd>{{ article.goodsEur | eur }}</dd></div>
            <div><dt><span class="wk-equation__op">+</span>Transport via leverancier</dt><dd>{{ article.transportEur | eur }}</dd></div>
            <div><dt><span class="wk-equation__op">+</span>Douane &amp; transport</dt><dd>{{ article.logisticsEur | eur }}</dd></div>
            <div><dt><span class="wk-equation__op">+</span>Inspectie &amp; andere kosten</dt><dd>{{ article.separateEur | eur }}</dd></div>
            <div><dt><span class="wk-equation__op">+</span>Beginwaarde</dt><dd>{{ article.openingEur | eur }}</dd></div>
            <div class="is-total"><dt><span class="wk-equation__op">=</span>Aanschafwaarde</dt><dd>{{ article.costValueEur | eur }}</dd></div>
            @if (article.estimatedEur > 0) { <div class="is-sub"><dt>Waarvan geschat</dt><dd>{{ article.estimatedEur | eur }}</dd></div> }
            @if (article.writeDownEur > 0) {
              <div><dt><span class="wk-equation__op">−</span>Waardevermindering</dt><dd>{{ article.writeDownEur | eur }}</dd></div>
              <div class="is-total"><dt><span class="wk-equation__op">=</span>Waarde</dt><dd>{{ article.ownValueEur | eur }}</dd></div>
            }
          </dl>
          <p class="inv-step__quiet">Niet opgenomen: Enrosed kost</p>
        </section>
        <section class="wk-section">
          <h4 class="wk-section__title">Locaties</h4>
          @for (place of article.locations; track place.locationId) {
            <p class="inv-layer">
              <span>{{ place.locationName }} · {{ place.closingQuantity | num }} op de afsluitdatum, {{ place.ownQuantity | num }} eigen
                <span class="wk-td__sub inv-wrap">{{ countFacts(place) }}</span>
              </span>
              <span class="wk-amount">{{ place.costValueEur | eur }}</span>
            </p>
          }
          <p class="inv-step__quiet">Verdeling per locatie ter info</p>
        </section>
        <section class="wk-section">
          <h4 class="wk-section__title">Waardeverminderingen</h4>
          @for (saved of savedWriteDowns(article); track saved.decision.id) {
            <button class="inv-saved" type="button" [disabled]="!editable()" (click)="openWriteDown(article, saved.decision)">
              <span>{{ saved.decision.quantity === null ? 'Alle overige' : (saved.decision.quantity | num) }} {{ unitWord(article, saved.decision.quantity ?? 2) }} aan {{ saved.decision.unitValueEur | eur: 4 }} · {{ reasonLabel(saved.decision) }}
                <span class="wk-td__sub inv-wrap">{{ saved.decision.reason }} · {{ saved.decision.decidedByName }}</span></span>
              <span class="wk-amount">{{ saved.amountEur | eur }}</span>
            </button>
          } @empty {
            <p class="inv-step__quiet">Geen waardevermindering.</p>
          }
          @if (editable()) {
            <button class="wk-btn inv-inspector__add" type="button" [disabled]="busy()" (click)="openWriteDown(article, null)">Lagere marktwaarde of waardevermindering</button>
          }
        </section>
      </div>
    </ng-template>

    <!-- one container -->
    <ng-template #card let-container>
      <article class="wk-card inv-container" [id]="'inv-container-' + container.purchaseOrderId">
        <div class="wk-card__head">
          <h3 class="wk-card__title">{{ container.displayName }}</h3>
          <span class="wk-pill" [class.tone-blue]="container.role !== 'VORIG'">{{ roleLabel(container) }}</span>
          @if (container.estimatedEur > 0) { <span class="wk-pill tone-amber">geschat {{ container.estimatedEur | eur }}</span> }
          <a class="wk-link" [routerLink]="['/purchasing', container.purchaseOrderId]">Open container ›</a>
        </div>
        <div class="wk-card__body">
          <p class="inv-step__quiet">{{ container.orderNumber || 'Geen nummer' }} · {{ container.supplierName || 'Geen leverancier' }}
            @if (container.receivedOn) { · ontvangen {{ container.receivedOn | dateNl }} } @else if (container.shippedOn) { · afvaart {{ container.shippedOn | dateNl }} }</p>
          @for (notice of containerNotices(container); track $index) {
            <p class="inv-note" [class.inv-note--stop]="notice.severity === 'BLOCKER'">{{ notice.message }}</p>
          }

          <dl class="wk-equation inv-container__equation">
            <div><dt>Leverancier</dt><dd>{{ included(container, 'SUPPLIER') | eur }}</dd></div>
            <div><dt><span class="wk-equation__op">+</span>Douane &amp; transport</dt><dd>{{ included(container, 'LOGISTICS') | eur }}</dd></div>
            <div><dt><span class="wk-equation__op">+</span>Inspectie &amp; andere kosten</dt><dd>{{ included(container, 'SEPARATE') | eur }}</dd></div>
            <div><dt><span class="wk-equation__op">−</span>Prijscreditnota's</dt><dd>{{ container.priceCreditEur | eur }}</dd></div>
            <div class="is-total"><dt><span class="wk-equation__op">=</span>Aanschafwaarde van de container</dt><dd>{{ container.acquisitionEur | eur }}</dd></div>
          </dl>

          <h4 class="inv-container__title">Betaalstromen</h4>
          @for (stream of container.streams; track stream.payee) {
            <div class="inv-stream">
              <div class="inv-stream__text">
                <p class="inv-stream__line"><strong>{{ stream.payeeLabel }}</strong>
                  <span class="wk-pill" [class.tone-amber]="stream.state === 'GESCHAT'" [class.tone-ok]="stream.state === 'BEVESTIGD'">{{ stateLabel(stream) }}</span></p>
                <p class="inv-stream__line">Afspraak {{ stream.plannedEur | eur }} · betaald {{ stream.paidEur | eur }} · nog open {{ stream.openEur | eur }} · opgenomen {{ stream.includedEur | eur }}</p>
                @if (stream.accrual; as accrual) {
                  <p class="inv-stream__sub">Nog verschuldigd {{ accrual.amountEur | eur }}{{ accrual.invoiceReceived ? ' · factuur ontvangen' : '' }} · {{ accrual.reason }}</p>
                  @if (accrual.stale) { <p class="inv-note inv-note--stop">Het open bedrag is gewijzigd: bevestig opnieuw</p> }
                }
                @if (noticeOf(container, stream); as notice) {
                  <p class="inv-stream__sub">{{ notice.amountEur | eur }} {{ notice.code === 'MEER_BETAALD' ? 'meer betaald dan de Afspraak' : 'minder betaald en vereffend' }}</p>
                }
              </div>
              @if (canDecide(container)) {
                <button class="wk-btn wk-btn--sm" type="button" [disabled]="busy()" (click)="accrual.set({ container, stream })">{{ streamButton(stream) }}</button>
              }
            </div>
          }

          @if (container.role !== 'ONDERWEG' && container.rateCutoffDate) {
            <div class="inv-stream">
              <div class="inv-stream__text">
                @if (fixed(container)) {
                  <p class="inv-stream__line">Koers geldt tot {{ container.rateCutoffDate | dateNl }} · Overgenomen uit de vorige afsluiting · ligt vast</p>
                } @else {
                  <p class="inv-stream__line">Koers geldt tot {{ container.rateCutoffDate | dateNl }} · {{ container.rateCutoffSourceLabel }}</p>
                }
                <p class="inv-stream__sub">Betalingen in vreemde munt tot en met deze datum tellen aan hun bankwaarde; latere aan de koers van de container.</p>
              </div>
              @if (canDecide(container) && !fixed(container)) {
                <button class="wk-btn wk-btn--sm" type="button" [disabled]="busy()" (click)="askOwnership(container)">Datum van eigendom of risico invoeren</button>
              }
            </div>
          }

          @if (billedQuestion(container)) {
            <div class="inv-stream inv-stream--ask">
              <div class="inv-stream__text">
                <p class="inv-stream__line"><strong>Welke stuks rekende de leverancier aan?</strong>
                  @if (!billedDecision(container)) { <span class="wk-pill tone-danger">Nog te beslissen</span> }</p>
                @if (billedDecision(container); as decision) {
                  <p class="inv-stream__sub">{{ billedLabel(decision.choice) }} · {{ decision.reason }}</p>
                }
              </div>
              @if (canDecide(container)) {
                <div class="inv-stream__buttons">
                  @for (option of billedChoices; track option.value) {
                    <button class="wk-btn wk-btn--sm inv-stream__choice" type="button" [disabled]="busy()" [attr.aria-pressed]="billedDecision(container)?.choice === option.value" (click)="askBilled(container, option.value)">{{ option.label }}</button>
                  }
                </div>
              }
            </div>
          }

          <h4 class="inv-container__title">Partijen</h4>
          <div class="wk-table inv-scroll inv-lots" role="table">
            <div class="wk-thead" role="row">
              <span class="wk-th" role="columnheader">Product</span>
              <span class="wk-th wk-th--num" role="columnheader">Besteld</span>
              <span class="wk-th wk-th--num" role="columnheader">Ontvangen</span>
              <span class="wk-th wk-th--num" role="columnheader">Beschadigd</span>
              <span class="wk-th wk-th--num" role="columnheader" title="Later gemeld (ter info)">Later gemeld (ter info)</span>
              <span class="wk-th wk-th--num" role="columnheader">Goederen ÷ aangerekend</span>
              <span class="wk-th wk-th--num" role="columnheader">Kosten ÷ ontvangen</span>
              <span class="wk-th wk-th--num" role="columnheader">Waarde per stuk</span>
              <span class="wk-th wk-th--num" role="columnheader">In partij</span>
            </div>
            @for (lot of container.lots; track lot.productId) {
              <div class="wk-tr" role="row">
                <span class="wk-td" role="cell">{{ lot.productName }}
                  <span class="wk-td__sub">{{ lot.sku || 'Geen SKU' }}
                    @if (lotStatus(lot); as status) { <span class="wk-pill" [class.tone-danger]="lot.status === 'GEEN_PRIJS'" [class.tone-warn]="lot.status !== 'GEEN_PRIJS'">{{ status }}</span> }
                    @if (lot.estimatedEur > 0) { <span class="wk-pill tone-amber">geschat</span> }
                  </span></span>
                <span class="wk-td wk-td--num" role="cell">{{ lot.orderedQuantity | num }}</span>
                <span class="wk-td wk-td--num" role="cell">{{ lot.receivedQuantity | num }}</span>
                <span class="wk-td wk-td--num" role="cell">{{ lot.damagedQuantity | num }}</span>
                <span class="wk-td wk-td--num" role="cell">{{ lot.laterLostQuantity | num }}</span>
                <span class="wk-td wk-td--num" role="cell">{{ netGoods(lot) | eur }} ÷ {{ lot.goodsDivisor | num }}<span class="wk-td__sub">{{ lot.unitGoodsEur | eur: 4 }}</span></span>
                <span class="wk-td wk-td--num" role="cell">{{ lotCosts(lot) | eur }} ÷ {{ lot.costDivisor | num }}<span class="wk-td__sub">{{ unitCosts(lot) | eur: 4 }}</span></span>
                <span class="wk-td wk-td--num" role="cell"><strong>{{ lot.unitValueEur | eur: 4 }}</strong>
                  @if (lot.previousUnitValueEur !== null && lot.previousUnitValueEur !== lot.unitValueEur) { <span class="wk-td__sub">vorige afsluiting {{ lot.previousUnitValueEur | eur: 4 }}</span> }</span>
                <span class="wk-td wk-td--num" role="cell">{{ lot.capacity | num }}</span>
              </div>
            }
          </div>

          <details class="inv-fold">
            <summary>Verdeling over de producten</summary>
            <p class="inv-step__text">{{ container.allocationLabel }}</p>
            @if (container.notes) { <p class="inv-step__text inv-pre">{{ container.notes }}</p> }
            <div class="wk-table inv-scroll inv-keys" role="table">
              <div class="wk-thead" role="row">
                <span class="wk-th" role="columnheader">Product</span>
                <span class="wk-th wk-th--num" role="columnheader">Sleutel goederen</span>
                <span class="wk-th wk-th--num" role="columnheader">Goederen</span>
                <span class="wk-th wk-th--num" role="columnheader">Sleutel transport leverancier</span>
                <span class="wk-th wk-th--num" role="columnheader">Transport via leverancier</span>
                <span class="wk-th wk-th--num" role="columnheader">Sleutel douane &amp; transport</span>
                <span class="wk-th wk-th--num" role="columnheader">Douane &amp; transport</span>
                <span class="wk-th wk-th--num" role="columnheader">Sleutel inspectie</span>
                <span class="wk-th wk-th--num" role="columnheader">Inspectie &amp; andere kosten</span>
              </div>
              @for (lot of container.lots; track lot.productId) {
                <div class="wk-tr" role="row">
                  <span class="wk-td" role="cell">{{ lot.productName }}</span>
                  <span class="wk-td wk-td--num" role="cell">{{ lot.goodsKeyEur | num: 2 }}</span>
                  <span class="wk-td wk-td--num" role="cell">{{ lot.goodsEur | eur }}@if (lot.priceCreditEur > 0) { <span class="wk-td__sub">− {{ lot.priceCreditEur | eur }} creditnota</span> }</span>
                  <span class="wk-td wk-td--num" role="cell">{{ lot.transportKeyEur === null ? '—' : (lot.transportKeyEur | num: 2) }}</span>
                  <span class="wk-td wk-td--num" role="cell">{{ lot.transportEur | eur }}</span>
                  <span class="wk-td wk-td--num" role="cell">{{ lot.logisticsKeyEur | num: 2 }}</span>
                  <span class="wk-td wk-td--num" role="cell">{{ lot.logisticsEur | eur }}</span>
                  <span class="wk-td wk-td--num" role="cell">{{ lot.separateKeyEur | num: 2 }}</span>
                  <span class="wk-td wk-td--num" role="cell">{{ lot.separateEur | eur }}</span>
                </div>
              }
            </div>
            <p class="inv-step__quiet">Aandeel = bedrag x sleutel / som van de sleutels</p>
          </details>

          <details class="inv-fold">
            <summary>Volgens berekening, ter info</summary>
            <div class="wk-table inv-scroll inv-calc" role="table">
              <div class="wk-thead" role="row">
                <span class="wk-th" role="columnheader">Product</span>
                <span class="wk-th wk-th--num" role="columnheader">Kosten bij vertrek</span>
                <span class="wk-th wk-th--num" role="columnheader">Vracht</span>
                <span class="wk-th wk-th--num" role="columnheader">Invoerrechten</span>
                <span class="wk-th wk-th--num" role="columnheader">Kosten bij aankomst</span>
              </div>
              @for (lot of container.lots; track lot.productId) {
                <div class="wk-tr" role="row">
                  <span class="wk-td" role="cell">{{ lot.productName }}</span>
                  <span class="wk-td wk-td--num" role="cell">{{ lot.calcOriginEur | eur }}</span>
                  <span class="wk-td wk-td--num" role="cell">{{ lot.calcFreightEur | eur }}</span>
                  <span class="wk-td wk-td--num" role="cell">{{ lot.calcDutyEur | eur }}@if (lot.calcDutyRatePct !== null) { <span class="wk-td__sub">{{ lot.calcDutyRatePct | pct: 1 }}</span> }</span>
                  <span class="wk-td wk-td--num" role="cell">{{ lot.calcDestinationEur | eur }}</span>
                </div>
              }
            </div>
            <p class="inv-step__quiet">Volgens berekening, ter info: geen betaalde bedragen en in geen enkel totaal.</p>
          </details>

          <h4 class="inv-container__title">Betalingen in de waarde ({{ valuePayments(container).length }})</h4>
          <p class="inv-step__text">Staat hier een bedrag inclusief btw die je terugkrijgt? Pas de betaling op de container aan naar het bedrag zonder btw en boek de btw als aparte betaling onder 'Bijkomende kosten'.</p>
          @if (valuePayments(container).length) {
            <div class="wk-table inv-scroll inv-payments" role="table">
              <div class="wk-thead" role="row">
                <span class="wk-th" role="columnheader">Datum</span>
                <span class="wk-th" role="columnheader">Betaalstroom</span>
                <span class="wk-th" role="columnheader">Omschrijving</span>
                <span class="wk-th wk-th--num" role="columnheader">Bedrag</span>
                <span class="wk-th" role="columnheader">Munt</span>
                <span class="wk-th wk-th--num" role="columnheader">Geboekte eurowaarde</span>
                <span class="wk-th wk-th--num" role="columnheader">Getelde eurowaarde</span>
                <span class="wk-th" role="columnheader">Regel</span>
              </div>
              @for (payment of valuePayments(container); track payment.paymentId) {
                <div class="wk-tr" role="row">
                  <span class="wk-td" role="cell">{{ payment.paidOn | dateNl }}</span>
                  <span class="wk-td" role="cell">{{ payment.payeeLabel }}</span>
                  <span class="wk-td wk-td--wrap" role="cell">{{ payment.label || '—' }}</span>
                  <span class="wk-td wk-td--num" role="cell">{{ payment.amount | num: 2 }}</span>
                  <span class="wk-td" role="cell">{{ payment.currency }}</span>
                  <span class="wk-td wk-td--num" role="cell">{{ payment.storedEur === null ? '—' : (payment.storedEur | eur) }}</span>
                  <span class="wk-td wk-td--num" role="cell">{{ payment.countedEur | eur }}</span>
                  <span class="wk-td wk-td--wrap" role="cell">{{ payment.rule }}</span>
                </div>
              }
            </div>
          }

          @if (container.credits.length) {
            <h4 class="inv-container__title">Tegoeden leverancier</h4>
            @for (credit of container.credits; track credit.creditId) {
              <div class="inv-stream">
                <div class="inv-stream__text">
                  <p class="inv-stream__line">{{ credit.reasonLabel }} {{ credit.countedEur | eur }} · {{ creditEffect(credit) }}
                    @if (credit.decisionRequired) { <span class="wk-pill tone-danger">Nog te beslissen</span> }</p>
                  <p class="inv-stream__sub">Genoteerd op {{ credit.notedOn | dateNl }}@if (credit.currency !== 'EUR') { · {{ credit.amount | num: 2 }} {{ credit.currency }} }@if (credit.reason) { · {{ credit.reason }} }</p>
                </div>
                @if (canDecide(container)) {
                  <button class="wk-btn wk-btn--sm" type="button" [disabled]="busy()" (click)="credit$.set({ container, credit })">Wat is dit tegoed?</button>
                }
              </div>
            }
            @if (container.lossCreditEur > 0) {
              <p class="inv-step__quiet">Ontbrekende en beschadigde stuks kostten samen {{ container.missingAndDamagedCostEur | eur }}.</p>
            }
          }

          <h4 class="inv-container__title">Niet in de waarde</h4>
          <dl class="inv-kv inv-container__out">
            <div><dt>Enrosed kost</dt><dd>{{ container.enrosedCostExcludedEur | eur }}</dd></div>
            <div><dt>Bank- en betalingskosten ('Bijkomende kosten')</dt><dd>{{ container.otherExcludedEur | eur }}</dd></div>
            <div><dt>Koersverschil</dt><dd>{{ container.exchangeDifferenceEur | eur }}</dd></div>
            <div><dt>Tegoed buiten de voorraadwaarde</dt><dd>{{ container.lossCreditEur | eur }}</dd></div>
          </dl>
        </div>
      </article>
    </ng-template>

    @if (writeDown(); as open) {
      <app-closing-write-down-sheet [article]="open.article" [writeDowns]="rowsOf(open.article)" [reasons]="view().writeDownReasons"
                                    [decision]="open.decision" [busy]="busy()" (save)="saveWriteDown(open.article, open.decision, $event)"
                                    (remove)="open.decision && removeDecision.emit(open.decision.id)" (closed)="writeDown.set(null)" />
    }
    @if (accrual(); as open) {
      <app-closing-accrual-sheet [container]="open.container" [stream]="open.stream" [busy]="busy()" (save)="saveAccrual(open.container, open.stream, $event)"
                                 (remove)="open.stream.accrual && removeDecision.emit(open.stream.accrual.decisionId)" (closed)="accrual.set(null)" />
    }
    @if (credit$(); as open) {
      <app-closing-credit-sheet [container]="open.container" [credit]="open.credit" [busy]="busy()" (save)="saveCredit(open.container, open.credit, $event)"
                                (remove)="open.credit.decisionId !== null && removeDecision.emit(open.credit.decisionId)" (closed)="credit$.set(null)" />
    }
    @if (question(); as open) {
      <app-closing-decision-sheet [spec]="open.spec" [busy]="busy()" (save)="open.save($event)" (remove)="open.remove?.()" (closed)="question.set(null)" />
    }
  `,
})
export class ClosingStepValue {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly ui = inject(Ui);
  private readonly dateNl = new DateNlPipe();

  readonly view = input.required<ClosingView>();
  readonly busy = input(false);
  readonly decision = output<DecisionWrite>();
  readonly removeDecision = output<number>();
  readonly openingLayers = output<OpeningLayerWrite>();
  readonly retireOpeningLayer = output<number>();

  readonly tab = signal<ValueTab>('producten');
  readonly selectedId = signal<number | null>(null);
  readonly writeDown = signal<{ article: ClosingArticle; decision: Decision | null } | null>(null);
  readonly accrual = signal<{ container: ClosingContainer; stream: ClosingStream } | null>(null);
  readonly credit$ = signal<{ container: ClosingContainer; credit: Credit } | null>(null);
  readonly question = signal<Question | null>(null);

  /* The table "Zonder waarde": what was typed per product, the shared date and source. */
  readonly quantities = signal<Record<number, string>>({});
  readonly values = signal<Record<number, string>>({});
  readonly openingDateInput = signal<string | null>(null);
  readonly source = signal('');
  private openingSent = false;

  readonly billedChoices = BILLED_CHOICES;
  readonly editable = computed(() => this.view().status === 'CONCEPT');
  readonly width = elementWidth(() => this.host.nativeElement);
  /** The build-up docks beside the table when both fit; otherwise it opens under its row. */
  readonly docked = computed(() => this.width() >= DOCK_MIN_PX);

  readonly unvalued = computed(() => unvaluedRows(this.view()));
  readonly tabs = computed<SegmentOption[]>(() => [
    { id: 'producten', label: 'Producten' },
    { id: 'containers', label: 'Containers' },
    { id: 'zonder', label: `Zonder waarde (${this.unvalued().length})` },
  ]);

  readonly groups = computed<CategoryGroup[]>(() => {
    const byCategory = new Map<string, ClosingArticle[]>();
    for (const article of this.view().articles) {
      const category = article.categoryName?.trim() || NO_CATEGORY;
      byCategory.set(category, [...(byCategory.get(category) ?? []), article]);
    }
    return [...byCategory.entries()]
      .sort(([a], [b]) => (a === NO_CATEGORY ? 1 : 0) - (b === NO_CATEGORY ? 1 : 0) || a.localeCompare(b, 'nl'))
      .map(([category, articles]) => ({ category, articles: articles.sort((a, b) => a.productName.localeCompare(b.productName, 'nl')) }));
  });
  readonly selected = computed(() => this.view().articles.find((article) => article.productId === this.selectedId()) ?? null);

  readonly current = computed(() => this.view().containers.filter((container) => container.role !== 'VORIG'));
  readonly previous = computed(() => this.view().containers.filter((container) => container.role === 'VORIG'));

  readonly openingDate = computed(() => this.openingDateInput() ?? defaultOpeningDate(this.view()));
  readonly dateError = computed(() => openingDateError(this.view(), this.openingDate()));
  /** The rows with a value typed in; a row without one is simply not saved. */
  readonly filled = computed(() => this.unvalued().filter((article) => (this.values()[article.productId] ?? '').trim() !== ''));
  readonly canSaveOpening = computed(() => {
    if (this.busy() || this.dateError() || !this.source().trim() || !this.filled().length) return false;
    return this.filled().every((article) => this.openingRow(article) !== null);
  });
  readonly unvaluedHead = computed(() =>
    this.unvalued().some((article) => this.unitOf(article).isDisplay) ? 'Waarde per stuk of display' : 'Waarde per stuk');

  constructor() {
    followAnchor((anchor) => this.show(anchor));
    /* A new view is the answer to a save: the sheet that asked is done. */
    effect(() => {
      this.view();
      this.writeDown.set(null);
      this.accrual.set(null);
      this.credit$.set(null);
      this.question.set(null);
      if (this.openingSent) {
        this.openingSent = false;
        this.quantities.set({});
        this.values.set({});
      }
    });
  }

  /** Opens the tab (and the product) a notice link points at. */
  private show(anchor: string): void {
    const product = /^inv-product-(\d+)$/.exec(anchor);
    if (product) {
      this.tab.set('producten');
      this.selectedId.set(Number(product[1]));
    } else if (anchor.startsWith('inv-container-')) {
      this.tab.set('containers');
    } else if (anchor === 'inv-unvalued') {
      this.tab.set('zonder');
    }
  }

  /* ---- products ---- */

  select(article: ClosingArticle): void {
    this.selectedId.update((current) => (current === article.productId ? null : article.productId));
  }

  unitOf(row: Pick<ClosingArticle, 'unitKey' | 'salesUnit' | 'piecesPerUnit'>) {
    return inventoryUnit(row);
  }

  unitWord(article: ClosingArticle, quantity: number): string {
    const unit = inventoryUnit(article);
    return quantity === 1 ? unit.singular : unit.plural;
  }

  ownLayers(article: ClosingArticle): ClosingLayer[] {
    return article.layers.filter((layer) => layer.block === 'EIGEN');
  }

  invoicedLayers(article: ClosingArticle): ClosingLayer[] {
    return article.layers.filter((layer) => layer.block === 'GEFACTUREERD');
  }

  /** "{container}, ontvangen {datum}", "Inventaris {jaar}" for a carried layer, "Beginwaarde: {bron}". */
  layerLabel(layer: ClosingLayer): string {
    const container = layer.displayName || layer.orderNumber;
    if (layer.source === 'BEGINWAARDE') return `Beginwaarde: ${layer.openingSource ?? '—'}`;
    if (layer.source === 'VORIG') {
      const carried = layer.originClosingYear === null ? 'Vorige inventaris' : `Inventaris ${layer.originClosingYear}`;
      if (layer.originSource === 'BEGINWAARDE') return `${carried} · beginwaarde: ${layer.openingSource ?? '—'}`;
      return container ? `${carried}: ${container}` : carried;
    }
    return `${container ?? 'Container'}, ontvangen ${this.dateNl.transform(layer.receivedOn)}`;
  }

  countFacts(place: ClosingArticleLocation): string {
    if (place.countedQuantity === null) return place.anchor === 'TELLING' ? 'Niet op de telling: 0' : 'Stand volgens systeem, niet geteld';
    const parts = [`Geteld ${place.countedQuantity.toLocaleString('nl-BE')}`];
    if (place.countedAt) parts.push(`op ${this.dateNl.transform(place.countedAt)}`);
    if (place.countedByName) parts.push(`door ${place.countedByName}`);
    let text = parts.join(' ');
    if (place.countDifference) {
      text += ` · verschil ${place.countDifference > 0 ? '+' : '-'}${Math.abs(place.countDifference).toLocaleString('nl-BE')}`;
      if (place.countReasonLabel) text += ` (${place.countReasonLabel}${place.countReasonNote ? `: ${place.countReasonNote}` : ''})`;
    }
    return text;
  }

  rowsOf(article: ClosingArticle) {
    return this.view().writeDowns.filter((row) => row.productId === article.productId);
  }

  savedWriteDowns(article: ClosingArticle): SavedWriteDown[] {
    const rows = this.rowsOf(article);
    return this.view().decisions
      .filter((decision) => decision.kind === 'WRITE_DOWN' && decision.productId === article.productId)
      .sort((a, b) => a.id - b.id)
      .map((decision) => ({
        decision,
        amountEur: rows.filter((row) => row.decisionId === decision.id).reduce((sum, row) => sum + cents(row.amountEur), 0) / 100,
      }));
  }

  reasonLabel(decision: Decision): string {
    return this.view().writeDownReasons.find((reason) => reason.code === decision.reasonCode)?.label ?? decision.reasonCode ?? '';
  }

  openWriteDown(article: ClosingArticle, decision: Decision | null): void {
    if (this.editable()) this.writeDown.set({ article, decision });
  }

  saveWriteDown(article: ClosingArticle, decision: Decision | null, choice: WriteDownChoice): void {
    this.decision.emit(decisionWriteWriteDown(
      article.productId, choice.quantity, choice.marketUnitEur, choice.reasonCode, choice.reason, decision?.id ?? null));
  }

  /* ---- containers ---- */

  canDecide(container: ClosingContainer): boolean {
    return this.editable() && container.role !== 'VORIG';
  }

  roleLabel(container: ClosingContainer): string {
    return container.role === 'PARTNER' && container.partnerName ? `${ROLE_LABEL.PARTNER} · ${container.partnerName}` : ROLE_LABEL[container.role];
  }

  included(container: ClosingContainer, payee: ClosingStream['payee']): number {
    return container.streams.find((stream) => stream.payee === payee)?.includedEur ?? 0;
  }

  stateLabel(stream: ClosingStream): string {
    return STATE_LABEL[stream.state] ?? stream.state;
  }

  streamButton(stream: ClosingStream): string {
    return streamButtonLabel(stream);
  }

  noticeOf(container: ClosingContainer, stream: ClosingStream): Notice | null {
    return streamNotice(this.view(), container, stream);
  }

  /** The notices of this step that name the container, the two stream notices excepted (they stand under their stream). */
  containerNotices(container: ClosingContainer): Notice[] {
    if (container.role === 'VORIG') return [];
    return this.view().notices.filter((notice) => notice.segment === 'waarde'
      && notice.purchaseOrderId === container.purchaseOrderId && notice.code !== 'MEER_BETAALD' && notice.code !== 'LAGER_AFGEREKEND');
  }

  fixed(container: ClosingContainer): boolean {
    return borderFixed(container);
  }

  billedDecision(container: ClosingContainer): Decision | null {
    return this.view().decisions.find((decision) =>
      decision.kind === 'SUPPLIER_BILLED' && decision.purchaseOrderId === container.purchaseOrderId) ?? null;
  }

  /** The question of 2.10 stands while its blocker does, and stays once answered so the answer can change. */
  billedQuestion(container: ClosingContainer): boolean {
    if (container.role === 'VORIG') return false;
    return !!this.billedDecision(container) || this.view().notices.some((notice) =>
      notice.code === 'LEVERANCIER_LAGER_AFGEREKEND' && notice.purchaseOrderId === container.purchaseOrderId);
  }

  billedLabel(choice: string | null): string {
    return BILLED_CHOICES.find((option) => option.value === choice)?.label ?? choice ?? '';
  }

  lotStatus(lot: ClosingLot): string | null {
    return LOT_STATUS[lot.status] ?? null;
  }

  /** What the goods divisor divides: the goods share after its price credits, never below zero. */
  netGoods(lot: ClosingLot): number {
    return Math.max(0, cents(lot.goodsEur) - cents(lot.priceCreditEur)) / 100;
  }

  /** What the received pieces divide: the three container costs of the lot. */
  lotCosts(lot: ClosingLot): number {
    return (cents(lot.transportEur) + cents(lot.logisticsEur) + cents(lot.separateEur)) / 100;
  }

  unitCosts(lot: ClosingLot): number {
    const units = (eur: number) => Math.round(eur * 10_000);
    return (units(lot.unitTransportEur) + units(lot.unitLogisticsEur) + units(lot.unitSeparateEur)) / 10_000;
  }

  valuePayments(container: ClosingContainer) {
    return container.payments.filter((payment) => payment.inValue);
  }

  creditEffect(credit: Credit): string {
    return CREDIT_EFFECT[credit.treatment] ?? credit.treatmentLabel;
  }

  saveAccrual(container: ClosingContainer, stream: ClosingStream, choice: AccrualChoice): void {
    this.decision.emit(decisionWriteAccrual(container.purchaseOrderId, stream.payee, choice.amountEur, choice.invoiceReceived, choice.reason));
  }

  saveCredit(container: ClosingContainer, credit: Credit, choice: CreditChoice): void {
    this.decision.emit(decisionWriteCreditTreatment(container.purchaseOrderId, credit.creditId, choice.choice, choice.reason));
  }

  askOwnership(container: ClosingContainer): void {
    const saved = container.ownershipDecisionId === null ? null
      : this.view().decisions.find((decision) => decision.id === container.ownershipDecisionId) ?? null;
    const decisionId = container.ownershipDecisionId;
    this.question.set({
      spec: {
        title: 'Datum van eigendom of risico',
        lead: [`${container.displayName} · Koers geldt tot ${this.dateNl.transform(container.rateCutoffDate)} · ${container.rateCutoffSourceLabel}`,
          'Betalingen in vreemde munt tot en met deze datum tellen aan hun bankwaarde; latere aan de koers van de container.'],
        date: { label: 'Eigendom of risico overgegaan op', value: saved?.decisionDate ?? null },
        reason: { label: 'Waarop steunt dit?', value: saved?.reason ?? '', required: true },
        saveLabel: 'Bewaren',
        removeLabel: decisionId === null ? null : 'Terug naar de ontvangstdatum',
      },
      save: (result) => {
        if (result.date) this.decision.emit(decisionWriteOwnershipDate(container.purchaseOrderId, result.date, result.reason));
      },
      remove: decisionId === null ? undefined : () => this.removeDecision.emit(decisionId),
    });
  }

  askBilled(container: ClosingContainer, choice: SupplierBilledChoice): void {
    const saved = this.billedDecision(container);
    this.question.set({
      spec: {
        title: 'Welke stuks rekende de leverancier aan?',
        lead: [container.displayName],
        choice: { label: 'Welke stuks rekende de leverancier aan?', value: choice, options: BILLED_CHOICES },
        reason: { label: 'Reden', value: saved?.choice === choice ? saved.reason ?? '' : '', required: true },
        saveLabel: 'Bewaren',
      },
      save: (result) => {
        if (result.choice === 'BESTELD' || result.choice === 'GELEVERD') {
          this.decision.emit(decisionWriteSupplierBilled(container.purchaseOrderId, result.choice, result.reason));
        }
      },
    });
  }

  /* ---- zonder waarde ---- */

  quantityText(article: ClosingArticle): string {
    return this.quantities()[article.productId] ?? String(article.unvaluedQuantity);
  }

  setQuantity(article: ClosingArticle, text: string): void {
    this.quantities.update((all) => ({ ...all, [article.productId]: text }));
  }

  setValue(article: ClosingArticle, text: string): void {
    this.values.update((all) => ({ ...all, [article.productId]: text }));
  }

  /** The row a filled line becomes, or null while its quantity or value cannot be read. */
  private openingRow(article: ClosingArticle): OpeningLayerWrite['rows'][number] | null {
    const quantity = parseDecimal(this.quantityText(article));
    const unitValueEur = parseDecimal(this.values()[article.productId] ?? '');
    if (quantity === null || !Number.isInteger(quantity) || quantity < 1) return null;
    if (unitValueEur === null || !Number.isFinite(unitValueEur) || unitValueEur < 0) return null;
    return { productId: article.productId, quantity, unitValueEur };
  }

  saveOpening(): void {
    if (!this.canSaveOpening()) return;
    const rows = this.filled().map((article) => this.openingRow(article)).filter((row) => row !== null);
    this.openingSent = true;
    this.openingLayers.emit({ asOfDate: this.openingDate(), source: this.source().trim(), rows });
  }

  retire(layer: OpeningLayer): void {
    this.ui.confirm({
      title: 'Beginwaarde verwijderen?',
      message: `De beginwaarde van ${escapeHtml(layer.productName)} (${layer.quantity.toLocaleString('nl-BE')} stuks, ${escapeHtml(layer.source)}) telt dan niet meer mee. De stuks staan opnieuw zonder waarde.`,
      confirmLabel: 'Verwijderen', danger: true,
    }, () => this.retireOpeningLayer.emit(layer.id));
  }
}
