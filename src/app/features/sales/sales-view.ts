import { ChangeDetectionStrategy, Component, HostListener, computed, effect, inject, input, signal } from '@angular/core';
import { Location, NgTemplateOutlet } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { SalesApi } from '../../core/api/sales-api';
import { CatalogApi } from '../../core/api/catalog-api';
import { AuthImage } from '../../core/api/auth-image';
import { saveBlob } from '../../core/api/download';
import { messageOf } from '../../core/api/errors';
import { SalesOrder,
  Category, Country, Customer, CustomerPortalLink, PricedLine, Product, ProductFamily,
  QuoteEvent, QuoteRevision, QuoteStatus,
  SalesOrderView,
} from '../../core/api/models';
import { PageHeader } from '../../shared/page-header';
import { Skeleton } from '../../shared/skeleton';
import { escapeHtml, Sheet, Ui } from '../../shared/ui';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { WorkQueue } from '../../core/api/work-queue';
import {
  CbmPipe, DateNlPipe, DateTimeNlPipe, EurPipe, NumPipe, PctPipe, WeekNlPipe,
} from '../../shared/pipes';
import { STATUS_LABEL, isWebsiteQuoteRequest, statusClass } from './quote-status';
import {
  isLocallyDeletableSalesDocument, salesDocumentLabel,
} from './sales-list-swipe';
import { salesLineSections } from './sales-product-line-groups';
import { toggleProductGroup as nextProductGroupDisclosure } from '../../shared/product-group-disclosure';

type SalesDetailSectionId = 'sales-products' | 'sales-delivery' | 'sales-control' | 'sales-status';

/**
 * Read-first sales order.
 *
 * Looking at an order must be safe: this page contains no fields and never
 * changes commercial data. Actions that can alter the quote live in the
 * editor, behind one explicit button.
 */
@Component({
  selector: 'app-sales-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, NgTemplateOutlet, AuthImage, PageHeader, Sheet, Skeleton, CbmPipe, DateNlPipe,
            DateTimeNlPipe, EurPipe, NumPipe, PctPipe, WeekNlPipe],
  template: `
    @if (view(); as data) {
      @if (desktop.active()) {
        <app-page-header [title]="data.order.number" [subtitle]="customerName()"
                         [showBack]="true" [showBell]="false">
          <button class="btn btn--sm" type="button" [disabled]="downloading()"
                  (click)="downloadPdf()">
            {{ downloading() ? 'Even wachten…' : 'PDF' }}
          </button>
          <a class="btn btn--primary btn--sm" [routerLink]="['/sales', data.order.id, 'edit']">
            {{ actionLabel() }}
          </a>
        </app-page-header>
      }

      <main class="content sales-view-page anim-rise erp-workspace erp-workspace--detail erp-workspace--sales">
        <section class="sales-hero erp-workspace__hero" id="sales-overview" aria-labelledby="sales-overview-title">
          <!-- Phone: the app bar folds into the hero - back, PDF and the
               edit action live on the dark surface itself. -->
          @if (!desktop.active()) {
            <div class="shero-bar">
              <button class="shero-back" type="button" aria-label="Terug" (click)="goBack()">‹</button>
              <span class="shero-spacer"></span>
              <button class="shero-pdf" type="button" [disabled]="downloading()" (click)="downloadPdf()">
                {{ downloading() ? '…' : 'PDF' }}
              </button>
              <a class="shero-edit" [routerLink]="['/sales', data.order.id, 'edit']">{{ actionLabel() }}</a>
            </div>
          }
          <div class="sales-hero__top">
            <div class="sales-hero__identity">
              <span class="eyebrow">{{ isInvoice() ? 'Factuur' : 'Verkoopofferte' }}</span>
              <h1 id="sales-overview-title">
                <a [routerLink]="['/customers']" [queryParams]="{ q: customerName() }">{{ customerName() }}</a>
              </h1>
              <p>
                {{ data.order.orderDate | dateNl }}
                <span aria-hidden="true"> · </span>
                {{ countryName() }}
              </p>
            </div>
            <div class="sales-hero__badges">
              @if (websiteRequest(data.order)) {
                <span class="website-request-pill">
                  <span aria-hidden="true">↗</span> Websiteaanvraag
                </span>
              }
              <span class="status-pill" [class]="'status-pill status-pill--' + cls(data.order.status)">
                <span aria-hidden="true"></span>{{ label(data.order.status) }}
              </span>
            </div>
          </div>

          <div class="hero-facts" aria-label="Offerte in cijfers">
            <div>
              <span>Producten</span>
              <strong>{{ data.priced.lines.length }}</strong>
              <small>{{ data.priced.totals.pieces | num }} stuks</small>
            </div>
            <div>
              <span>Levering</span>
              @if (isLooseCartons(data)) {
                <strong>{{ data.priced.totals.cbm | cbm }}</strong>
                <small>
                  {{ data.priced.totals.cartons | num }}
                  {{ data.priced.totals.cartons === 1 ? 'losse doos' : 'losse dozen' }}
                </small>
              } @else {
                <strong>{{ palletCount(data) | num }}</strong>
                <small>{{ palletCount(data) === 1 ? 'pallet' : 'pallets' }}</small>
              }
            </div>
            <div class="hero-facts__total">
              <span>{{ isInvoice() ? 'Factuurtotaal' : 'Offertetotaal' }}</span>
              <strong>{{ data.priced.totals.total | eur: 0 }}</strong>
              <small>{{ data.priced.totals.vatLegalMention ? 'BTW verlegd' : 'excl. BTW' }}</small>
            </div>
          </div>

          <!-- The agreement in one glass row: what used to be its own
               Offertedetails card lives with the rest of the header. -->
          <div class="hero-details">
            @if (isInvoice()) {
              <span><small>Vervaldatum</small><b>{{ data.order.invoiceDueDate | dateNl }}</b></span>
            } @else {
              <span><small>Geldig tot</small><b>{{ data.order.validUntil | dateNl }}</b></span>
            }
            <a [routerLink]="['/customers']" [queryParams]="{ q: customerName() }">
              <small>Contact</small><b>{{ customer()?.contact || '—' }}</b>
            </a>
            <span class="hero-details__pay">
              <small>Betaling</small>
              <b>{{ desktop.active() ? paymentTerms() : paymentShort() }}</b>
            </span>
            <span><small>BTW</small><b>{{ data.priced.totals.vatLegalMention ? 'verlegd · 0%' : (data.priced.totals.vatRatePct | pct: 0) }}</b></span>
          </div>

          <!-- The inkoop journey, retold for a quote or an invoice. -->
          <div class="stepper hero-stepper"
               [attr.aria-label]="isInvoice() ? 'Status van de factuur' : 'Status van de offerte'">
            @for (step of journey(data.order); track step.label; let last = $last) {
              <div class="stepper__step"
                   [class.stepper__step--done]="step.state === 'done'"
                   [class.stepper__step--now]="step.state === 'now'"
                   [class.hero-stepper__step--danger]="step.kind === 'danger'"
                   [class.hero-stepper__step--gold]="step.kind === 'gold'"
                   [class.hero-stepper__step--muted]="step.kind === 'muted'">
                <span class="stepper__dot" aria-hidden="true">{{ step.mark }}</span>
                <span class="stepper__label">{{ step.label }}</span>
              </div>
              @if (!last) {
                <span class="stepper__line" [class.stepper__line--done]="step.state === 'done'"></span>
              }
            }
          </div>

          <div class="profit-strip">
            <span>Winst</span>
            <strong [class.profit-strip__negative]="data.priced.totals.marginEur < 0">
              {{ signedMoney(data.priced.totals.marginEur) }}
            </strong>
          </div>
        </section>

        <nav class="sales-section-nav erp-workspace__section-nav" aria-label="Onderdelen van het verkoopdocument">
          <button class="erp-workspace__section-link" type="button"
                  [class.erp-workspace__section-link--active]="activeDetailSection() === 'sales-products'"
                  [class.active]="activeDetailSection() === 'sales-products'"
                  [attr.aria-current]="activeDetailSection() === 'sales-products' ? 'true' : null"
                  (click)="scrollToSection('sales-products')">
            <span class="erp-workspace__section-mark" aria-hidden="true">1</span>
            <span class="erp-workspace__section-copy"><b>Producten</b>
              <small>{{ data.priced.lines.length }} {{ data.priced.lines.length === 1 ? 'regel' : 'regels' }}</small></span>
          </button>
          <button class="erp-workspace__section-link" type="button"
                  [class.erp-workspace__section-link--active]="activeDetailSection() === 'sales-delivery'"
                  [class.active]="activeDetailSection() === 'sales-delivery'"
                  [attr.aria-current]="activeDetailSection() === 'sales-delivery' ? 'true' : null"
                  (click)="scrollToSection('sales-delivery')">
            <span class="erp-workspace__section-mark" aria-hidden="true">2</span>
            <span class="erp-workspace__section-copy"><b>Levering</b><small>{{ deliveryState(data) }}</small></span>
          </button>
          <button class="erp-workspace__section-link" type="button"
                  [class.erp-workspace__section-link--active]="activeDetailSection() === 'sales-control'"
                  [class.active]="activeDetailSection() === 'sales-control'"
                  [attr.aria-current]="activeDetailSection() === 'sales-control' ? 'true' : null"
                  (click)="scrollToSection('sales-control')">
            <span class="erp-workspace__section-mark" aria-hidden="true">3</span>
            <span class="erp-workspace__section-copy"><b>Controle</b><small>{{ data.priced.totals.total | eur: 0 }}</small></span>
          </button>
          <button class="erp-workspace__section-link" type="button"
                  [class.erp-workspace__section-link--active]="activeDetailSection() === 'sales-status'"
                  [class.active]="activeDetailSection() === 'sales-status'"
                  [attr.aria-current]="activeDetailSection() === 'sales-status' ? 'true' : null"
                  (click)="scrollToSection('sales-status')">
            <span class="erp-workspace__section-mark" aria-hidden="true">4</span>
            <span class="erp-workspace__section-copy"><b>Status</b><small>{{ label(data.order.status) }}</small></span>
          </button>
        </nav>

        @if (pendingRevision(); as revision) {
          <section class="revision-alert" aria-labelledby="revision-alert-title">
            <span class="revision-alert__icon" aria-hidden="true">⇄</span>
            <div>
              <span class="eyebrow">Klant wacht op ons</span>
              <h2 id="revision-alert-title">De klant vraagt een wijziging</h2>
              <p>
                {{ revision.proposedBy || 'De klant' }} stuurde een voorstel met
                {{ revision.lines.length }} gewijzigde regel(s).
              </p>
            </div>
            <a class="btn btn--primary btn--sm" [routerLink]="['/sales', data.order.id, 'edit']">
              Beoordelen
            </a>
          </section>
        }

        <div class="sales-layout erp-workspace__layout">
          <div class="sales-main erp-workspace__content">
            <section class="section-card products-card erp-workspace__section" id="sales-products" aria-labelledby="sales-lines-title">
              <header class="section-card__head">
                <div>
                  <span class="section-kicker">Orderinhoud</span>
                  <h2 id="sales-lines-title">Producten</h2>
                </div>
                <div class="line-head-tools">
                  <div class="profit-mode" role="group" aria-label="Winstbedrag tonen per stuk of per regel">
                    <button type="button" [class.profit-mode__active]="profitMode() === 'UNIT'"
                            (click)="profitMode.set('UNIT')">Per stuk</button>
                    <button type="button" [class.profit-mode__active]="profitMode() === 'LINE'"
                            (click)="profitMode.set('LINE')">Hele regel</button>
                  </div>
                  <span class="section-count">
                    {{ data.priced.lines.length }}
                    {{ data.priced.lines.length === 1 ? 'regel' : 'regels' }}
                  </span>
                </div>
              </header>

              <div class="product-lines purchase-model-list">
                @for (section of lineSections(); track section.key) {
                  <section class="purchase-category" [attr.aria-labelledby]="salesCategoryHeadingId(section.key)">
                    <h3 class="purchase-category__head" [id]="salesCategoryHeadingId(section.key)">
                      <span>{{ section.label }}</span>
                      <small>{{ section.families.length }} {{ section.families.length === 1 ? 'model' : 'modellen' }} ·
                        {{ section.lines.length }} {{ section.lines.length === 1 ? 'variant' : 'varianten' }}</small>
                    </h3>
                    <div class="purchase-category__models">
                      @for (group of section.families; track group.key) {
                        <section class="purchase-model"
                                 [class.purchase-model--family]="group.familyId !== null"
                                 [class.purchase-model--standalone]="group.familyId === null"
                                 [class.purchase-model--open]="productGroupOpen(group.key)">
                          <button class="purchase-model__head" type="button"
                                  [id]="productGroupPanelId(group.key) + '-toggle'"
                                  [attr.aria-expanded]="productGroupOpen(group.key)"
                                  [attr.aria-controls]="productGroupPanelId(group.key)"
                                  (click)="toggleProductGroup(group.key)">
                            @if (group.photoUrl; as photo) {
                              <img class="purchase-model__photo" [appAuthSrc]="photo" alt="" />
                            } @else {
                              <span class="purchase-model__photo purchase-model__photo--empty" aria-hidden="true">◈</span>
                            }
                            <span class="purchase-model__copy">
                              <small>{{ group.familyId === null ? 'Product' : 'Productmodel' }}</small>
                              <strong>{{ group.label }}</strong>
                              <span>
                                {{ group.lines.length }} {{ group.lines.length === 1 ? 'variant' : 'varianten' }}
                                @if (group.swatches.length) {
                                  <span class="purchase-model__swatches" aria-label="Kleuren in dit model">
                                    @for (swatch of group.swatches.slice(0, 8); track swatch.key) {
                                      <i class="product-colour-dot"
                                         [class.product-colour-dot--empty]="!swatch.hex"
                                         [style.background]="swatch.hex || 'transparent'"
                                         [title]="swatch.label"></i>
                                    }
                                    @if (group.swatches.length > 8) {
                                      <small>+{{ group.swatches.length - 8 }}</small>
                                    }
                                  </span>
                                }
                              </span>
                            </span>
                            <span class="purchase-model__totals">
                              <strong>{{ group.pieces | num }} st</strong>
                              <small>{{ group.cartons | num }} dozen · {{ group.cbm | cbm }}</small>
                              <small class="purchase-model__cost-label">
                                {{ profitMode() === 'UNIT' ? 'Gem. netto / stuk' : 'Netto verkoop' }}
                              </small>
                              <b>{{ profitMode() === 'UNIT'
                                ? (averageGroupUnitPrice(group.totalEur, group.pieces) | eur: 2)
                                : (group.totalEur | eur) }}</b>
                            </span>
                            <svg class="purchase-model__chevron" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
                              <path d="m6.5 8 3.5 3.5L13.5 8" fill="none" stroke="currentColor"
                                    stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                          </button>
                          @if (productGroupOpen(group.key)) {
                            <div class="purchase-model__variants"
                                 [id]="productGroupPanelId(group.key)"
                                 role="region"
                                 [attr.aria-labelledby]="productGroupPanelId(group.key) + '-toggle'">
                            @for (line of group.lines; track line.productId; let variantIndex = $index) {
                              <ng-container *ngTemplateOutlet="salesVariant; context: {
                                $implicit: line, group: group, section: section, variantIndex: variantIndex
                              }" />
                            }
                            </div>
                          }
                        </section>
                      }
                    </div>
                  </section>
                } @empty {
                  <div class="products-empty">
                    <span aria-hidden="true">◇</span>
                    <strong>Nog geen producten</strong>
                    <p>Open Bewerken om de eerste productregel toe te voegen.</p>
                  </div>
                }

                <ng-template #salesVariant let-line let-group="group" let-section="section"
                             let-variantIndex="variantIndex">
                  <article class="sales-line" [class.sales-line--variant]="group.familyId !== null">
                    <a class="sales-line__identity" [routerLink]="['/products', line.productId]"
                       [title]="line.description + ' openen'">
                      @if (line.photoUrl) {
                        <img class="sales-line__photo" [appAuthSrc]="line.photoUrl" alt="" />
                      } @else {
                        <span class="sales-line__photo sales-line__photo--empty" aria-hidden="true">◈</span>
                      }
                      <span class="sales-line__copy">
                        <small>
                          @if (group.familyId === null) {
                            Regel {{ salesLineNumber(line.productId) }} · {{ section.label }}
                          } @else {
                            Variant {{ variantIndex + 1 }} van {{ group.lines.length }}
                            @if (line.sku) { · <span class="mono">{{ line.sku }}</span> }
                          }
                        </small>
                        <strong>{{ group.familyId === null
                          ? line.description
                          : salesVariantTitle(line.productId, line.description) }}</strong>
                        <span class="purchase-line__meta">
                          @if (productFor(line.productId); as product) {
                            @if (product.colour; as colour) {
                              <i class="product-colour-dot"
                                 [class.product-colour-dot--empty]="!product.colourHex"
                                 [style.background]="product.colourHex || 'transparent'" aria-hidden="true"></i>
                              <b>{{ colour }}</b>
                            }
                            @if (product.variantSize; as size) {
                              @if (product.colour) { <span aria-hidden="true"> · </span> }
                              <b>{{ size }}</b>
                            }
                          }
                          @if (group.familyId === null && line.sku) {
                            <span aria-hidden="true"> · </span><span class="mono">{{ line.sku }}</span>
                          }
                        </span>
                      </span>
                    </a>

                    <div class="line-facts">
                      <span><small>Aantal</small><strong>{{ line.quantity | num }} st</strong></span>
                      <span><small>Dozen</small><strong>{{ line.cartons | num }}</strong></span>
                      <button type="button"
                              [class.line-facts__ok]="!deliveryOpen(line, data)"
                              [class.line-facts__warn]="deliveryOpen(line, data)"
                              (click)="deliveryInfo.set(line)">
                        <small>Levering</small>
                        <strong>{{ deliveryShort(line, data) }}<i aria-hidden="true">›</i></strong>
                      </button>
                    </div>

                    <button class="line-breakdown-toggle" type="button"
                            [attr.aria-expanded]="openLine() === line.productId"
                            [attr.aria-controls]="linePanelId(line.productId)"
                            (click)="toggleLine(line.productId)">
                      <span>
                        <small>Prijsopbouw</small>
                        <strong>{{ profitMode() === 'UNIT' ? 'Per stuk bekijken' : 'Hele regel bekijken' }}</strong>
                      </span>
                      <span class="line-breakdown-toggle__total">
                        {{ profitMode() === 'UNIT' ? (line.netUnitPrice | eur: 2) : (line.net | eur) }}
                      </span>
                      <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"
                           [class.chevron-open]="openLine() === line.productId">
                        <path d="m6.5 8 3.5 3.5L13.5 8" fill="none" stroke="currentColor"
                              stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                      </svg>
                    </button>

                    @if (openLine() === line.productId) {
                      <div class="line-breakdown" [id]="linePanelId(line.productId)">
                        @if (line.discountPct) {
                          <div class="stat-row"><span>Regelkorting {{ line.discountPct | pct: 1 }}</span>
                            <span class="num">− {{ profitDiscount(line) | eur: 2 }}</span></div>
                        }
                        <div class="stat-row"><span>Verkoop na korting</span>
                          <span class="num">{{ profitNet(line) | eur: 2 }}</span></div>
                        <div class="stat-row"><span>Kostprijs</span>
                          <span class="num">− {{ profitCost(line) | eur: 2 }}</span></div>
                        <div class="stat-row line-breakdown__result"
                             [class.line-breakdown__result--negative]="line.marginEur < 0">
                          <span>{{ line.marginEur < 0 ? 'Verlies' : 'Winst' }}</span>
                          <span class="num">{{ profitPill(line) }}</span>
                        </div>
                      </div>
                    }
                  </article>
                </ng-template>
              </div>
            </section>


            <section class="section-card erp-workspace__section" id="sales-delivery" aria-labelledby="delivery-details-title">
              <header class="section-card__head">
                <div><span class="section-kicker">Logistiek</span><h2 id="delivery-details-title">Levering</h2></div>
                <span class="delivery-state" [class.delivery-state--open]="data.order.deliveryTerms === 'TE_BEPALEN'">
                  {{ deliveryState(data) }}
                </span>
              </header>
              <div class="details-grid">
                <div class="detail-item"><span>Leverland</span><strong>{{ countryName() }}</strong></div>
                <div class="detail-item"><span>Incoterm</span><strong>{{ data.order.incoterm || '—' }}</strong></div>
                <div class="detail-item"><span>Verzendwijze</span><strong>{{ isLooseCartons(data) ? 'Losse dozen' : 'Pallets' }}</strong></div>
                @if (!isLooseCartons(data)) {
                  <div class="detail-item"><span>Pallets</span><strong>{{ palletCount(data) | num }}</strong></div>
                }
                <div class="detail-item"><span>Dozen</span><strong>{{ data.priced.totals.cartons | num }}</strong></div>
                <div class="detail-item"><span>Volume</span><strong>{{ data.priced.totals.cbm | cbm }}</strong></div>
                <div class="detail-item"><span>Gewicht</span><strong>{{ data.priced.totals.weightKg | num: 1 }} kg</strong></div>
                <div class="detail-item"><span>Vracht · {{ freightStrategyLabel(data) }}</span><strong>{{ freightLabel(data) }}</strong></div>
                <div class="detail-item"><span>Levertermijn</span><strong>{{ deliveryState(data) }}</strong></div>
              </div>
            </section>

          </div>

          <aside class="sales-side erp-workspace__rail" id="sales-control" aria-label="Totalen en acties">
            <section class="totals-card erp-workspace__decision">
              <header><span class="section-kicker">Controle</span><h2>Totalen</h2></header>
              <dl class="totals-list">
                <div><dt>Goederen</dt><dd>{{ data.priced.totals.goodsTotal | eur: 2 }}</dd></div>
                <div><dt>Vracht <small>{{ freightStrategyLabel(data) }}</small></dt><dd>{{ freightAmount(data) }}</dd></div>
                <div><dt>Handling</dt><dd>{{ data.priced.totals.handling | eur: 2 }}</dd></div>
                <div class="totals-list__main"><dt>{{ isInvoice() ? 'Factuurtotaal' : 'Offertetotaal' }} <small>excl. BTW</small></dt><dd>{{ data.priced.totals.total | eur: 2 }}</dd></div>
                <div><dt>BTW {{ data.priced.totals.vatRatePct | pct: 0 }}</dt><dd>{{ data.priced.totals.vatAmount | eur: 2 }}</dd></div>
                <div class="totals-list__incl"><dt>Inclusief BTW</dt><dd>{{ data.priced.totals.totalInclVat | eur: 2 }}</dd></div>
              </dl>
              <div class="totals-profit">
                <div><b>Winst</b><strong [class.negative]="data.priced.totals.marginEur < 0">{{ data.priced.totals.marginEur | eur: 2 }}</strong></div>
                <small>Goederenwinst vóór vrachtkosten</small>
              </div>

              <section class="next-step-card" aria-labelledby="sales-next-step-title">
                <span class="section-kicker">Volgende stap</span>
                <h3 id="sales-next-step-title">{{ nextStepTitle(data) }}</h3>
                <p>{{ nextStepHelp(data) }}</p>
                @if (pendingRevision()) {
                  <a class="btn btn--primary btn--block" [routerLink]="['/sales', data.order.id, 'edit']">
                    Wijziging beoordelen
                  </a>
                } @else if (isInvoice()) {
                  @if (data.order.status === 'CONCEPT') {
                    <button class="btn btn--primary btn--block" type="button" [disabled]="sendingQuote()"
                            (click)="sendSheetOpen.set(true)">Factuur versturen…</button>
                  } @else if (!data.order.goodsShippedAt) {
                    <button class="btn btn--primary btn--block" type="button" [disabled]="invoiceBusy()"
                            (click)="openShipSheet(data)">Bestelling verzonden</button>
                  } @else if (data.order.status !== 'BETAALD') {
                    <button class="btn btn--primary btn--block" type="button" [disabled]="invoiceBusy()"
                            (click)="markPaid(data)">Betaling registreren</button>
                  } @else {
                    <button class="btn btn--primary btn--block" type="button" [disabled]="packing()"
                            (click)="downloadPackingSlip(data)">
                      {{ packing() ? 'Pakbon maken…' : 'Pakbon downloaden' }}
                    </button>
                  }
                } @else if (data.order.status === 'CONCEPT') {
                  <button class="btn btn--primary btn--block" type="button" [disabled]="sendingQuote()"
                          (click)="sendSheetOpen.set(true)">
                    {{ data.order.sentAt ? 'Nieuwe versie versturen…' : 'Offerte versturen…' }}
                  </button>
                } @else if (data.order.status === 'GEACCEPTEERD') {
                  <button class="btn btn--primary btn--block" type="button" [disabled]="invoiceBusy()"
                          (click)="makeInvoice(data)">
                    {{ invoiceBusy() ? 'Factuur maken…' : 'Factuur maken' }}
                  </button>
                } @else {
                  <a class="btn btn--primary btn--block" [routerLink]="['/sales', data.order.id, 'edit']">
                    {{ actionLabel() }}
                  </a>
                }
              </section>

              <details class="manage-more">
                <summary>Meer acties <span aria-hidden="true">⌄</span></summary>
              <div class="manage-actions">
                @if (!nextStepOpensEditor(data)) {
                <a class="btn btn--block" [routerLink]="['/sales', data.order.id, 'edit']">
                  {{ actionLabel() }}
                </a>
                }
                @if (isInvoice()) {
                  @if (data.order.status === 'CONCEPT') {
                    <button class="btn btn--block" type="button" [disabled]="invoiceBusy()"
                            (click)="markSent(data)">Markeer als verstuurd</button>
                    <p class="link-explainer">Gebruik dit alleen wanneer je de factuur buiten het ERP bezorgde.</p>
                  } @else if (data.order.status !== 'BETAALD' && !data.order.goodsShippedAt) {
                    <button class="btn btn--block" type="button" [disabled]="invoiceBusy()"
                            (click)="markPaid(data)">Markeer als betaald</button>
                  }
                  @if (data.order.goodsShippedAt) {
                    <p class="link-explainer">Bestelling verzonden op
                      {{ data.order.goodsShippedAt | dateNl }} — voorraad afgepunt.</p>
                  }
                  @if (!(data.order.status === 'BETAALD' && data.order.goodsShippedAt)) {
                  <button class="btn btn--block" type="button" [disabled]="packing()"
                          (click)="downloadPackingSlip(data)">
                    {{ packing() ? 'Pakbon maken…' : 'Pakbon downloaden' }}
                  </button>
                  }
                  @if (data.order.sourceQuoteId; as quoteId) {
                    <a class="btn btn--block" [routerLink]="['/sales', quoteId]">
                      Naar de offerte
                    </a>
                  }
                } @else {
                  @if (data.order.status === 'CONCEPT') {
                    <button class="btn btn--block" type="button" [disabled]="invoiceBusy()"
                            (click)="makeInvoice(data)">
                      {{ invoiceBusy() ? 'Factuur maken…' : 'Factuur maken' }}
                    </button>
                  }
                }
                @if (!isInvoice() && portalLink()?.available && portalLink()?.url) {
                  <button class="btn btn--block" type="button" [disabled]="copyingLink()"
                          (click)="copyCustomerLink()">
                    {{ copyingLink() ? 'Kopiëren…' : 'Klantlink kopiëren' }}
                  </button>
                } @else if (data.order.status === 'CONCEPT' && data.order.sentAt) {
                  <p class="link-explainer">De bestaande klantlink blijft verborgen tot deze versie opnieuw is verstuurd.</p>
                }
                @if (canDelete()) {
                  <button class="btn btn--danger btn--block manage-actions__delete" type="button"
                          [disabled]="deleting()" (click)="remove(data)">
                    {{ deleting()
                        ? (isInvoice() ? 'Factuur verwijderen…' : 'Offerte verwijderen…')
                        : (isInvoice() ? 'Factuur verwijderen' : 'Offerte verwijderen') }}
                  </button>
                }
              </div>
              </details>
            </section>
          </aside>

            <section class="section-card history-card erp-workspace__section" id="sales-status" aria-labelledby="quote-history-title">
              <header class="section-card__head">
                <div><span class="section-kicker">Status</span><h2 id="quote-history-title">Geschiedenis</h2></div>
                <span class="badge" [class]="'badge badge--' + cls(data.order.status)">{{ label(data.order.status) }}</span>
              </header>
              <div class="timeline">
                @for (event of history(); track event.id) {
                  <div class="timeline__event" [class.timeline__event--customer]="event.byCustomer">
                    <span class="timeline__dot" aria-hidden="true"></span>
                    <div>
                      <strong>{{ event.summary }}</strong>
                      <p>{{ event.at | dateTimeNl }}@if (event.actor) { · {{ event.actor }} }</p>
                      @if (event.detail) { <small>{{ event.detail }}</small> }
                    </div>
                  </div>
                } @empty {
                  <p class="empty-history">Nog geen statuswijzigingen geregistreerd.</p>
                }
              </div>
            </section>
        </div>

        @if (shipSheet(); as ship) {
          <app-sheet title="Voorraad afpunten" (closed)="shipSheet.set(null)">
            <div body>
              <p class="ship-intro">Deze aantallen gaan als verkocht uit de voorraad
                op {{ ship.number }}. Dit gebeurt één keer.</p>
              <ul class="ship-lines">
                @for (row of ship.rows; track $index) {
                  <li>
                    @if (row.photoUrl) {
                      <img class="ship-line__photo" [appAuthSrc]="row.photoUrl" alt="" />
                    } @else {
                      <span class="ship-line__photo ship-line__photo--empty" aria-hidden="true">◈</span>
                    }
                    <div class="ship-line__copy">
                      <strong>{{ row.name }}</strong>
                      <span>−{{ row.qty | num }} stuks</span>
                    </div>
                    <div class="ship-line__stock"
                         [class.ship-line__stock--negative]="row.after !== null && row.after < 0">
                      @if (row.before !== null) {
                        <small>voorraad</small>
                        <span>{{ row.before | num }} <b aria-hidden="true">→</b> {{ row.after | num }}</span>
                      } @else {
                        <small>voorraad</small><span>onbekend</span>
                      }
                    </div>
                  </li>
                }
              </ul>
              @if (shipHasNegative()) {
                <p class="ship-warning">Minstens één product komt onder nul te staan —
                  controleer de telling voor je afpunt.</p>
              }
            </div>
            <div foot style="display:contents">
              <button class="btn" type="button" (click)="shipSheet.set(null)">Annuleren</button>
              <span class="spacer"></span>
              <button class="btn btn--primary" type="button" [disabled]="invoiceBusy()"
                      (click)="confirmShipFromSheet()">
                {{ invoiceBusy() ? 'Bezig…' : 'Voorraad afpunten' }}
              </button>
            </div>
          </app-sheet>
        }

        @if (sendSheetOpen()) {
      <app-sheet [title]="isInvoice() ? 'Factuur versturen' : 'Offerte versturen'"
                 (closed)="sendSheetOpen.set(false)">
        <div body>
          <p class="small muted" style="margin-bottom:14px">
            {{ isInvoice()
                ? 'De klant krijgt de factuur-PDF in bijlage, met de betaalgegevens in de mail.'
                : 'De klant krijgt de PDF in bijlage en een link om online te tekenen of een wijziging voor te stellen.' }}
          </p>
          <div class="field">
            <label for="view-send-message">Persoonlijk bericht</label>
            <textarea class="textarea" id="view-send-message" rows="3"
                      [value]="sendMessage()"
                      (input)="sendMessage.set($any($event.target).value)"></textarea>
          </div>
        </div>
        <div foot style="display:contents">
          <button class="btn" type="button" (click)="sendSheetOpen.set(false)">Annuleren</button>
          <button class="btn btn--primary" type="button" [disabled]="sendingQuote()"
                  (click)="sendFromView()">{{ sendingQuote() ? 'Bezig…' : 'Versturen' }}</button>
        </div>
      </app-sheet>
    }

    @if (deliveryInfo(); as line) {
          <app-sheet [title]="'Levering · ' + line.description" (closed)="deliveryInfo.set(null)">
            <div class="delivery-sheet" body>
              @if (deliveryText(line, data) !== deliveryShort(line, data)) {
                <p>{{ deliveryText(line, data) }}</p>
              }
              <dl class="delivery-sheet__facts">
                <div><dt>Besteld</dt><dd>{{ line.quantity | num }} st</dd></div>
                @if (line.inventoryKnown) {
                  <div><dt>Op voorraad</dt><dd>{{ (line.stockQuantity ?? 0) | num }} st</dd></div>
                }
                @if (line.shortfall) {
                  <div><dt>Tekort</dt><dd>{{ line.shortfall | num }} st</dd></div>
                }
                @if (line.deliveryWeek) {
                  <div><dt>Leverweek</dt><dd>{{ line.deliveryWeek | weekNl }}</dd></div>
                }
                @if (line.deliveryDate) {
                  <div><dt>Leverbaar vanaf</dt><dd>{{ line.deliveryDate | dateNl }}</dd></div>
                }
              </dl>
            </div>
          </app-sheet>
        }
      </main>

      @if (!desktop.active()) {
        <div class="sales-detail-dock erp-workspace__mobile-dock" role="group"
             aria-label="Belangrijkste acties voor dit verkoopdocument">
          <button class="sales-detail-dock__pdf" type="button" [disabled]="downloading()"
                  (click)="downloadPdf()">{{ downloading() ? '…' : 'PDF' }}</button>
          @if (pendingRevision()) {
            <a class="btn btn--primary sales-detail-dock__primary"
               [routerLink]="['/sales', data.order.id, 'edit']">Beoordelen</a>
          } @else {
            <a class="btn sales-detail-dock__edit" [class.btn--primary]="!hasStatusAction(data)"
               [routerLink]="['/sales', data.order.id, 'edit']">{{ actionLabel() }}</a>
            @if (isInvoice()) {
              @if (data.order.status === 'CONCEPT') {
                <button class="btn btn--primary sales-detail-dock__primary" type="button"
                        [disabled]="sendingQuote()" (click)="sendSheetOpen.set(true)">Versturen</button>
              } @else if (!data.order.goodsShippedAt) {
                <button class="btn btn--primary sales-detail-dock__primary" type="button"
                        [disabled]="invoiceBusy()" (click)="openShipSheet(data)">Verzonden</button>
              } @else if (data.order.status !== 'BETAALD') {
                <button class="btn btn--primary sales-detail-dock__primary" type="button"
                        [disabled]="invoiceBusy()" (click)="markPaid(data)">Betaald</button>
              }
            } @else if (data.order.status === 'CONCEPT') {
              <button class="btn btn--primary sales-detail-dock__primary" type="button"
                      [disabled]="sendingQuote()" (click)="sendSheetOpen.set(true)">Versturen</button>
            } @else if (data.order.status === 'GEACCEPTEERD') {
              <button class="btn btn--primary sales-detail-dock__primary" type="button"
                      [disabled]="invoiceBusy()" (click)="makeInvoice(data)">Factuur</button>
            }
          }
        </div>
      }
    } @else if (loading()) {
      <app-page-header title="Offerte laden" [showBack]="true" [showBell]="false" />
      <main class="content sales-view-page">
        <app-skeleton kind="card" />
        <div class="loading-grid"><app-skeleton kind="lines" [rows]="5" /><app-skeleton kind="lines" [rows]="4" /></div>
      </main>
    } @else {
      <app-page-header title="Offerte niet beschikbaar" [showBack]="true" [showBell]="false" />
      <main class="content sales-view-page">
        <section class="load-error">
          <span aria-hidden="true">!</span>
          <h1>Deze offerte kon niet worden geopend</h1>
          <p>{{ loadError() }}</p>
          <div class="load-error__actions">
            <a class="btn" routerLink="/sales">Terug naar verkoop</a>
            @if (validOrderId()) {
              <button class="btn btn--primary" type="button" (click)="retry()">Opnieuw proberen</button>
            }
          </div>
        </section>
      </main>
    }
  `,
  styles: [`
    .sales-view-page { max-width:1180px;margin-inline:auto;padding-bottom:96px;background:transparent }
    .sales-view-page>*+* { margin-top:12px }
    .sales-hero { overflow:hidden;padding:18px;border-radius:22px;background:linear-gradient(145deg,#27211f,#151210);color:#fff;box-shadow:var(--sh-2) }
    .sales-hero__top { display:flex;align-items:flex-start;justify-content:space-between;gap:12px }
    .shero-bar { display:flex;align-items:center;gap:8px;margin:-2px 0 12px }
    .shero-back { display:grid;place-items:center;width:34px;height:34px;padding:0 0 2px;border:0;border-radius:50%;background:rgb(255 255 255/.12);color:#fff;font-size:21px;line-height:1;cursor:pointer }
    .shero-back:active { background:rgb(255 255 255/.24) }
    .shero-spacer { flex:1 }
    .shero-pdf { padding:8px 14px;border:0;border-radius:999px;background:rgb(255 255 255/.12);color:#fff;font:inherit;font-size:12.5px;font-weight:750;cursor:pointer }
    .shero-pdf:disabled { opacity:.55 }
    .shero-edit { padding:8px 16px;border-radius:999px;background:#fff;color:#1a1614;font-size:12.5px;font-weight:750;text-decoration:none }
    .shero-edit:active { opacity:.8 }
    @media (max-width:679px) {
      .sales-hero { margin:-14px -12px 0;border-radius:0 0 22px 22px;padding:calc(12px + env(safe-area-inset-top, 0px)) 16px 15px }
      .sales-hero__top { flex-direction:column;align-items:center;gap:9px;text-align:center }
      .sales-hero__identity { display:flex;flex-direction:column;align-items:center }
      .sales-hero__top .sales-hero__badges { justify-content:center }
    }
    .sales-hero h1 a { color:inherit;text-decoration:none }
    .sales-hero h1 a:active { opacity:.75 }
    .eyebrow,.section-kicker { color:var(--rose);font-size:9.5px;font-weight:800;letter-spacing:.11em;text-transform:uppercase }
    .sales-hero .eyebrow { color:#efb8c4 }
    .sales-hero h1 { margin:3px 0 0;color:#fff;font-size:clamp(21px,6vw,30px);line-height:1.14;letter-spacing:-.03em }
    .sales-hero__identity p { margin:5px 0 0;color:rgb(255 255 255/.62);font-size:11.5px }
    .sales-hero__badges { display:flex;flex:0 0 auto;flex-wrap:wrap;justify-content:flex-end;gap:6px }
    .website-request-pill { display:inline-flex;align-items:center;gap:6px;padding:6px 10px;
      border:1px solid rgb(255 255 255/.3);border-radius:999px;background:#fff;color:#5f2437;
      font-size:10.5px;font-weight:800;box-shadow:0 5px 16px rgb(0 0 0/.16) }
    .website-request-pill>span { font-size:12px;line-height:1 }
    .status-pill { display:inline-flex;flex:0 0 auto;align-items:center;gap:6px;max-width:44%;padding:6px 9px;border:1px solid rgb(255 255 255/.18);border-radius:999px;background:rgb(255 255 255/.08);font-size:10.5px;font-weight:750;text-align:center }
    .sales-hero__badges .status-pill { max-width:none }
    .status-pill>span { width:7px;height:7px;border-radius:50%;background:#c6beb9 }
    .status-pill--ok>span { background:#50cc8c }.status-pill--danger>span { background:#ff8076 }.status-pill--gold>span { background:#f1c66d }.status-pill--rose>span { background:#ef8ba2 }.status-pill--blue>span { background:#81b9f5 }
    .hero-facts { display:grid;grid-template-columns:.72fr .72fr 1.35fr;gap:1px;margin-top:18px;overflow:hidden;border:1px solid rgb(255 255 255/.1);border-radius:14px;background:rgb(255 255 255/.1) }
    .hero-facts>div { min-width:0;padding:11px;background:rgb(255 255 255/.055) }
    .hero-facts span,.hero-facts small { display:block;color:rgb(255 255 255/.56);font-size:9.5px }.hero-facts strong { display:block;overflow:hidden;margin-top:2px;color:#fff;font-size:17px;line-height:1.2;text-overflow:ellipsis;white-space:nowrap }
    .hero-facts__total strong { font-size:19px }.hero-facts__total { background:rgb(255 255 255/.1)!important }
    .profit-strip { display:flex;align-items:center;justify-content:space-between;gap:12px;margin:10px -3px -3px;padding:8px 11px;border-radius:10px;background:rgb(77 203 137/.12);color:#a8e8c6;font-size:10px }
    .profit-strip strong { font-size:13px;font-variant-numeric:tabular-nums }.profit-strip .profit-strip__negative { color:#ff9189 }
    .revision-alert { display:grid;grid-template-columns:auto minmax(0,1fr);gap:10px 12px;padding:14px;border:1px solid #ead49d;border-radius:var(--r);background:var(--gold-soft);box-shadow:var(--sh-1) }
    .revision-alert__icon { display:grid;width:38px;height:38px;place-items:center;border-radius:12px;background:#fff;color:var(--gold);font-size:19px }
    .revision-alert h2 { margin:2px 0 0;font-size:14px }.revision-alert p { margin:3px 0 0;color:var(--muted);font-size:11.5px;line-height:1.45 }.revision-alert .btn { grid-column:1/-1 }
    .sales-layout,.sales-main { display:grid;gap:12px;min-width:0 }
    .section-card,.totals-card { overflow:hidden;border:1px solid rgb(255 255 255/.75);border-radius:var(--r);background:var(--surface);box-shadow:var(--sh-1) }
    .section-card__head { min-height:62px;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border-bottom:1px solid var(--line) }
    .section-card h2,.totals-card h2 { margin:2px 0 0;font-size:15px;letter-spacing:-.01em }
    .section-count,.delivery-state { flex:0 0 auto;padding:5px 8px;border-radius:999px;background:var(--surface-2);color:var(--muted);font-size:10px;font-weight:700 }
    .line-head-tools { display:flex;align-items:center;justify-content:flex-end;gap:7px;flex-wrap:wrap }
    .profit-mode { display:flex;padding:2px;border:1px solid var(--line);border-radius:9px;background:var(--surface-2) }.profit-mode button { min-height:25px;border:0;border-radius:7px;background:transparent;padding:0 7px;color:var(--muted);font-size:9px;font-weight:720;cursor:pointer }.profit-mode .profit-mode__active { background:#fff;color:var(--ink);box-shadow:0 1px 4px rgb(39 33 31/.1) }
    .delivery-state { background:var(--ok-soft);color:var(--ok) }.delivery-state--open { background:var(--warn-soft);color:var(--warn) }
  `, `
    .product-lines { padding:0 0 4px }
    .sales-line { padding:13px 14px;border-bottom:1px solid var(--line) }
    .sales-line:last-child { border-bottom:0 }
    .sales-line__identity { display:grid;grid-template-columns:48px minmax(0,1fr);align-items:center;gap:10px;color:inherit;text-decoration:none }
    a.sales-line__identity:hover strong { color:var(--rose-dark);text-decoration:underline }
    .sales-line__photo { width:48px;height:48px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2);object-fit:cover }
    .sales-line__photo--empty { display:grid;place-items:center;color:var(--muted);font-size:20px }
    .ship-intro { margin:0 0 12px;color:var(--ink-2);font-size:12.5px;line-height:1.5 }
    .ship-lines { margin:0;padding:0;list-style:none }
    .ship-lines li { display:flex;align-items:center;gap:11px;padding:9px 0;border-top:1px solid var(--line) }
    .ship-line__photo { width:44px;height:44px;flex:none;border:1px solid var(--line);border-radius:11px;background:var(--surface-2);object-fit:cover }
    .ship-line__photo--empty { display:grid;place-items:center;color:var(--muted);font-size:18px }
    .ship-line__copy { flex:1;min-width:0 }
    .ship-line__copy strong { display:block;overflow:hidden;font-size:13px;text-overflow:ellipsis;white-space:nowrap }
    .ship-line__copy span { color:var(--muted);font-size:11.5px;font-weight:650 }
    .ship-line__stock { flex:none;text-align:right;font-variant-numeric:tabular-nums }
    .ship-line__stock small { display:block;color:var(--muted);font-size:9px;font-weight:750;letter-spacing:.07em;text-transform:uppercase }
    .ship-line__stock span { font-size:12.5px;font-weight:750 }
    .ship-line__stock b { color:var(--muted);font-weight:600 }
    .ship-line__stock--negative span { color:var(--danger) }
    .ship-warning { margin:12px 0 0;padding:9px 12px;border-radius:10px;background:var(--warn-soft);color:var(--warn);font-size:12px;font-weight:650 }
    .sales-line__copy { display:flex;min-width:0;flex-direction:column }
    .sales-line__copy small { color:var(--rose);font-size:9px;font-weight:720;text-transform:uppercase }
    .sales-line__copy strong { overflow:hidden;font-size:14px;text-overflow:ellipsis;white-space:nowrap }
    .sales-line__copy>span { overflow:hidden;color:var(--muted);font-size:11px;text-overflow:ellipsis;white-space:nowrap }
    .line-facts { display:grid;grid-template-columns:repeat(3,1fr);gap:1px;margin-top:10px;border:1px solid var(--line);border-radius:11px;background:var(--line);overflow:hidden }
    .line-facts>span,.line-facts>button { display:flex;min-width:0;flex-direction:column;padding:7px 8px;background:var(--surface-2);border:0;font:inherit;text-align:left;color:inherit }
    .line-facts>button { cursor:pointer }
    .line-facts>button strong { display:flex;align-items:center;gap:3px }
    .line-facts>button i { margin-left:auto;color:var(--muted);font-size:13px;font-style:normal;line-height:1 }
    .line-facts small { color:var(--muted);font-size:8.5px;text-transform:uppercase }
    .line-facts strong { overflow:hidden;font-size:11px;text-overflow:ellipsis;white-space:nowrap }
    .line-facts__ok strong { color:var(--ok) }
    .line-facts__warn strong { color:var(--warn) }
    .line-breakdown-toggle { display:flex;width:100%;min-height:48px;align-items:center;gap:8px;margin-top:9px;padding:7px 9px;border:1px solid var(--line);border-radius:12px;background:var(--surface);color:var(--ink);font:inherit;text-align:left;cursor:pointer }
    .line-breakdown-toggle>span:first-child { display:flex;min-width:0;flex:1;flex-direction:column }
    .line-breakdown-toggle small { color:var(--muted);font-size:9px }
    .line-breakdown-toggle strong { font-size:11px }
    .line-breakdown-toggle__total { color:var(--rose);font-size:12px;font-weight:760;font-variant-numeric:tabular-nums }
    .line-breakdown-toggle svg { flex:none;color:var(--muted);transition:transform .18s }
    .line-breakdown-toggle svg.chevron-open { transform:rotate(180deg) }
    .line-breakdown { margin-top:7px;padding:5px 10px 8px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2);animation:rise .18s ease }
    .stat-row { display:flex;align-items:baseline;justify-content:space-between;gap:12px }
    .line-breakdown .stat-row { padding:4px 0;font-size:11.5px }
    .line-breakdown .stat-row>span:first-child { color:var(--ink-2) }
    .line-breakdown__result { border-top:1px solid var(--line);font-weight:760 }
    .line-breakdown__result>span { color:var(--ok)!important }
    .line-breakdown__result--negative>span { color:var(--danger)!important }
    .negative { color:var(--danger)!important }
    .products-empty { padding:36px 18px;text-align:center;color:var(--muted) }.products-empty>span { display:block;font-size:32px;opacity:.55 }.products-empty strong { display:block;margin-top:6px;color:var(--ink-2);font-size:13px }.products-empty p { margin:4px 0 0;font-size:11.5px }
    .details-grid { display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;background:var(--line) }
    .detail-item { display:flex;min-width:0;flex-direction:column;padding:12px 14px;background:var(--surface) }
    .detail-item>span { color:var(--muted);font-size:9.5px;text-transform:uppercase }
    .detail-item strong { overflow-wrap:anywhere;font-size:12.5px }
    .details-grid>.detail-item:last-child:nth-child(odd) { grid-column:1/-1 }
    .delivery-sheet { display:grid;gap:12px }
    .delivery-sheet p { margin:0;color:var(--ink-2);font-size:12.5px;line-height:1.55 }
    .delivery-sheet__facts { margin:0;display:grid;gap:1px;border:1px solid var(--line);border-radius:12px;background:var(--line);overflow:hidden }
    .delivery-sheet__facts>div { display:flex;justify-content:space-between;gap:12px;padding:9px 12px;background:var(--surface);font-size:12px }
    .delivery-sheet__facts dt { color:var(--muted) }
    .delivery-sheet__facts dd { margin:0;font-weight:680;font-variant-numeric:tabular-nums }
    .timeline { padding:4px 14px 14px }.timeline__event { position:relative;display:grid;grid-template-columns:13px minmax(0,1fr);gap:9px;padding:9px 0 }.timeline__event:not(:last-child)::before { position:absolute;top:22px;bottom:-8px;left:5px;width:1px;background:var(--line);content:'' }
    .timeline__dot { position:relative;z-index:1;width:11px;height:11px;margin-top:3px;border:3px solid var(--surface);border-radius:50%;background:var(--rose);box-shadow:0 0 0 1px var(--rose) }.timeline__event--customer .timeline__dot { background:var(--gold);box-shadow:0 0 0 1px var(--gold) }
    .product-line__row { display:flex;width:100%;gap:10px;align-items:center;padding:10px 2px;border:0;background:transparent;font:inherit;text-align:left;cursor:pointer }
    .product-line__row:hover { background:var(--surface-2) }
    .product-line__photo { width:42px;height:42px;flex:none;display:grid;place-items:center;border:1px solid var(--line);border-radius:11px;background:var(--surface-2);overflow:hidden;color:var(--muted-2) }
    .product-line__photo img { width:100%;height:100%;object-fit:cover }
    .product-line__copy { flex:1;min-width:0;display:grid }
    .product-line__copy h3 { overflow:hidden;font-size:13px;font-weight:650;text-overflow:ellipsis;white-space:nowrap }
    .product-line__copy small { color:var(--muted);font-size:11px;display:flex;align-items:center;gap:5px }
    .delivery-dot { width:7px;height:7px;flex:none;border-radius:50%;background:var(--warn) }
    .delivery-dot--ok { background:var(--ok) }
    .product-line__amount { flex:none;display:inline-flex;align-items:center;gap:7px;font-size:13px;font-weight:750 }
    .product-line__chev { width:6px;height:6px;border-right:1.5px solid var(--muted);border-bottom:1.5px solid var(--muted);transform:rotate(45deg);transition:transform .15s ease }
    .product-line--open .product-line__chev { transform:rotate(-135deg) }
    .product-line__detail { padding:2px 2px 10px 54px }
    .line-detail { margin:0;padding:0;display:grid;gap:3px }
    .line-detail div { display:flex;justify-content:space-between;gap:10px;font-size:12px }
    .line-detail dt { color:var(--muted) }
    .line-detail dd { margin:0;font-weight:650 }
    .line-detail__profit { padding-top:5px;border-top:1px solid var(--line);font-weight:750 }
    .line-detail__profit dd { color:var(--ok) }
    .line-detail__profit dd.negative { color:var(--danger) }
    .product-line__detail .linklike { display:inline-block;margin-top:8px;font-size:12px }
    .hero-details { display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:10px }
    @media (min-width:680px) { .hero-details { grid-template-columns:repeat(4,minmax(0,1fr)) } }
    .hero-details>* { display:grid;gap:1px;padding:8px 11px;border-radius:11px;background:rgb(255 255 255/.08);color:inherit;text-decoration:none;align-content:center }
    .hero-details a:active { background:rgb(255 255 255/.16) }
    @media(max-width:679px) { .hero-details__pay small { display:none } }
    .hero-details small { color:rgb(255 255 255/.6);font-size:9px;font-weight:750;letter-spacing:.06em;text-transform:uppercase }
    .hero-details b { color:#fff;font-size:12px;font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap }
    .hero-stepper { margin-top:10px;padding:9px 12px;border-radius:13px;background:rgb(255 255 255/.08);flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none }
    .hero-stepper::-webkit-scrollbar { display:none }
    .hero-stepper .stepper__dot { width:19px;height:19px;background:transparent;border-color:rgb(255 255 255/.32);color:rgb(255 255 255/.55);font-size:9.5px }
    .hero-stepper .stepper__label { color:rgb(255 255 255/.5);font-size:10.5px;white-space:nowrap }
    .hero-stepper .stepper__step--done .stepper__dot,.hero-stepper .stepper__step--now .stepper__dot { background:#fff;border-color:#fff;color:var(--rose-dark) }
    .hero-stepper .stepper__step--done .stepper__label,.hero-stepper .stepper__step--now .stepper__label { color:#fff }
    .hero-stepper .stepper__step--now .stepper__label { font-weight:700 }
    .hero-stepper .stepper__line { background:rgb(255 255 255/.18) }
    .hero-stepper .stepper__line--done { background:rgb(255 255 255/.75) }
    .hero-stepper__step--danger .stepper__dot { background:#ffb3aa!important;border-color:#ffb3aa!important;color:#5c150d!important }
    .hero-stepper__step--danger .stepper__label { color:#ffb3aa!important }
    .hero-stepper__step--gold .stepper__dot { background:#ffd57a!important;border-color:#ffd57a!important;color:#5f4200!important }
    .hero-stepper__step--gold .stepper__label { color:#ffd57a!important }
    .hero-stepper__step--muted .stepper__dot { background:rgb(255 255 255/.25)!important;border-color:transparent!important;color:#fff!important }

    .timeline strong { display:block;font-size:11.5px }.timeline p { margin:2px 0 0;color:var(--muted);font-size:9.5px }.timeline small { display:block;margin-top:4px;color:var(--ink-2);font-size:10.5px;line-height:1.45 }.empty-history { margin:12px 0 0;color:var(--muted);font-size:11.5px }
  `, `
    .totals-card { padding:15px }.totals-card header { margin-bottom:7px }.totals-list { margin:0 }.totals-list>div { display:flex;align-items:baseline;justify-content:space-between;gap:14px;padding:8px 0;border-bottom:1px solid var(--line) }.totals-list dt { color:var(--muted);font-size:11px }.totals-list dd { margin:0;font-size:12px;font-weight:680;font-variant-numeric:tabular-nums;white-space:nowrap }
    .totals-list__main { margin-top:4px;padding:12px 0!important;border-top:1px solid var(--line) }.totals-list__main dt { color:var(--ink)!important;font-weight:760 }.totals-list__main dt small { display:block;margin-top:1px;color:var(--muted);font-size:8.5px;font-weight:550 }.totals-list__main dd { font-size:17px!important }
    .totals-list__incl { border-bottom:0!important }.totals-list__incl dt,.totals-list__incl dd { color:var(--ink-2);font-weight:730 }
    .totals-profit { margin:10px 0 12px;padding:10px;border:1px solid var(--rose-line);border-radius:11px;background:var(--rose-soft) }.totals-profit>span { color:var(--rose-dark);font-size:8.5px;font-weight:800;letter-spacing:.09em;text-transform:uppercase }.totals-profit>div { display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-top:3px }.totals-profit b { font-size:11px }.totals-profit strong { color:var(--ok);font-size:14px;font-variant-numeric:tabular-nums }.totals-profit small { display:block;margin-top:3px;color:var(--muted);font-size:9.5px }
    .next-step-card { margin:12px 0;padding:12px;border:1px solid var(--rose-line);border-radius:13px;background:linear-gradient(145deg,var(--rose-soft),#fff) }
    .next-step-card h3 { margin:3px 0 0;font-size:14px;letter-spacing:-.01em }
    .next-step-card p { margin:4px 0 11px;color:var(--muted);font-size:10.5px;line-height:1.45 }
    .manage-more { border-top:1px solid var(--line) }
    .manage-more>summary { min-height:44px;display:flex;align-items:center;justify-content:space-between;padding:4px 2px;color:var(--ink-2);font-size:11px;font-weight:720;cursor:pointer;list-style:none }
    .manage-more>summary::-webkit-details-marker { display:none }.manage-more[open]>summary span { transform:rotate(180deg) }
    .manage-actions { display:grid;gap:7px }.manage-actions .btn { margin:0 }.manage-actions__delete { margin-top:5px!important }.link-explainer { margin:1px 3px 0;color:var(--muted);font-size:9.5px;line-height:1.4;text-align:center }
    .sales-detail-dock { display:flex;align-items:center;gap:7px }
    .sales-detail-dock .btn { min-height:42px;margin:0;padding-inline:12px }
    .sales-detail-dock__pdf { min-width:48px;min-height:42px;border:0;border-radius:12px;background:var(--surface-2);color:var(--ink);font:inherit;font-size:11px;font-weight:760;cursor:pointer }
    .sales-detail-dock__edit { flex:1 }.sales-detail-dock__primary { flex:1 }
    .sales-side { min-width:0 }.load-error { max-width:520px;margin:28px auto!important;padding:34px 20px;border:1px solid var(--line);border-radius:var(--r-lg);background:var(--surface);text-align:center;box-shadow:var(--sh-1) }.load-error>span { display:grid;width:46px;height:46px;margin:0 auto 11px;place-items:center;border-radius:14px;background:var(--danger-soft);color:var(--danger);font-size:20px;font-weight:800 }.load-error h1 { font-size:17px }.load-error p { margin:5px 0 15px;color:var(--muted);font-size:13px;line-height:1.45 }.load-error__actions { display:flex;justify-content:center;flex-wrap:wrap;gap:8px }.load-error__actions .btn { min-height:48px }.loading-grid { display:grid;gap:12px;margin-top:12px }
    .vat-detail__short { display:none }
    @media(max-width:520px) { .products-card .section-card__head { align-items:flex-start;flex-direction:column }.line-head-tools { width:100%;justify-content:space-between }.profit-mode { order:2 }.section-count { order:1 }.hero-facts>div { padding:9px 8px }.hero-facts strong { font-size:15px }.hero-facts__total strong { font-size:16px }.revision-alert { padding:12px }.vat-detail__full { display:none }.vat-detail__short { display:inline;font-size:16px;letter-spacing:.08em }.load-error__actions { display:grid;grid-template-columns:1fr }.load-error__actions .btn { width:100% } }
    @media(min-width: 680px) { .sales-hero { padding:22px }.hero-facts { max-width:700px }.revision-alert { grid-template-columns:auto minmax(0,1fr) auto;align-items:center }.revision-alert .btn { grid-column:auto }.sales-line { padding:15px 18px }.sales-line__identity { grid-template-columns:52px minmax(0,1fr) }.sales-line__photo { width:52px;height:52px }.loading-grid { grid-template-columns:1fr 1fr } }
    @media(min-width:680px) { .sales-view-page { padding-bottom:24px }#sales-products,#sales-delivery,#sales-control,#sales-status { scroll-margin-top:calc(var(--appbar-h) + 28px) }.sales-layout { grid-template-columns:minmax(0,1fr) minmax(250px,310px);align-items:start }.sales-main { grid-column:1;grid-row:1 }.sales-side { grid-column:2;grid-row:1/3;position:sticky;top:78px }.history-card { grid-column:1;grid-row:2 }.details-grid { grid-template-columns:repeat(3,1fr) }.details-grid>.detail-item:last-child:nth-child(odd) { grid-column:auto }.sales-hero__top { align-items:center }.sales-hero h1 { max-width:700px }.sales-side .btn { min-height:46px }.sales-detail-dock { display:none } }
  `],
})
export class SalesView {
  private readonly sales = inject(SalesApi);
  private readonly catalog = inject(CatalogApi);
  private readonly ui = inject(Ui);
  private readonly work = inject(WorkQueue);

  readonly id = input<string>('');
  readonly validOrderId = computed(() => {
    const value = Number(this.id());
    return Number.isInteger(value) && value > 0;
  });
  readonly view = signal<SalesOrderView | null>(null);
  readonly customers = signal<Customer[]>([]);
  readonly countries = signal<Country[]>([]);
  readonly products = signal<Product[]>([]);
  readonly categories = signal<Category[]>([]);
  readonly families = signal<ProductFamily[]>([]);
  readonly revisions = signal<QuoteRevision[]>([]);
  readonly history = signal<QuoteEvent[]>([]);
  readonly desktop = inject(DesktopViewport);
  private readonly browserLocation = inject(Location);

  goBack(): void {
    if (window.history.length <= 1) { void this.routerNav.navigateByUrl('/sales'); return; }
    this.browserLocation.back();
  }
  private readonly routerNav = inject(Router);

  readonly portalLink = signal<CustomerPortalLink | null>(null);
  readonly profitMode = signal<'UNIT' | 'LINE'>('UNIT');
  readonly loading = signal(true);
  readonly loadError = signal('');
  readonly downloading = signal(false);
  readonly copyingLink = signal(false);
  readonly deleting = signal(false);

  readonly customer = computed(() => {
    const customerId = this.view()?.order.customerId;
    return this.customers().find((item) => item.id === customerId) ?? null;
  });

  readonly country = computed(() => {
    const code = this.view()?.order.countryCode;
    return this.countries().find((item) => item.code === code) ?? null;
  });

  readonly pendingRevision = computed(
    () => this.revisions().find((item) => item.status === 'IN_AFWACHTING') ?? null);

  readonly actionLabel = computed(() =>
    this.view()?.order.status === 'CONCEPT' ? 'Bewerken' : 'Beheren');

  readonly lineSections = computed(() => salesLineSections(
    this.view()?.priced.lines ?? [], this.products(), this.categories(), this.families()));
  private readonly productsById = computed(() => new Map(this.products().flatMap((product) =>
    product.id === null ? [] : [[product.id, product] as const])));

  readonly detailSections: readonly SalesDetailSectionId[] = [
    'sales-products', 'sales-delivery', 'sales-control', 'sales-status',
  ];
  readonly activeDetailSection = signal<SalesDetailSectionId>('sales-products');

  scrollToSection(id: SalesDetailSectionId): void {
    this.activeDetailSection.set(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  @HostListener('window:scroll')
  trackDetailSection(): void {
    if (!this.view()) return;
    const railBottom = document.querySelector('.sales-section-nav')?.getBoundingClientRect().bottom ?? 0;
    /* Controle is a parallel sticky rail on desktop, so it must not eclipse
       Producten merely because both columns start at the same y-position. */
    const tracked: readonly SalesDetailSectionId[] = this.desktop.active()
      ? ['sales-products', 'sales-delivery', 'sales-status']
      : this.detailSections;
    let current: SalesDetailSectionId = tracked[0];
    for (const id of tracked) {
      const section = document.getElementById(id);
      if (section && section.getBoundingClientRect().top <= railBottom + 18) current = id;
    }
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 12) {
      current = tracked[tracked.length - 1];
    }
    if (current !== this.activeDetailSection()) this.activeDetailSection.set(current);
  }

  /** One decision at a time, derived from the same statuses the action methods use. */
  hasStatusAction(data: SalesOrderView): boolean {
    if (this.pendingRevision()) return true;
    if ((data.order.docType ?? 'OFFERTE') === 'FACTUUR') {
      return data.order.status === 'CONCEPT' || !data.order.goodsShippedAt
        || data.order.status !== 'BETAALD';
    }
    return data.order.status === 'CONCEPT' || data.order.status === 'GEACCEPTEERD';
  }

  nextStepOpensEditor(data: SalesOrderView): boolean {
    if (this.pendingRevision()) return true;
    return (data.order.docType ?? 'OFFERTE') !== 'FACTUUR'
      && data.order.status !== 'CONCEPT' && data.order.status !== 'GEACCEPTEERD';
  }

  nextStepTitle(data: SalesOrderView): string {
    if (this.pendingRevision()) return 'Wijzigingsvoorstel beoordelen';
    if ((data.order.docType ?? 'OFFERTE') === 'FACTUUR') {
      if (data.order.status === 'CONCEPT') return 'Factuur naar de klant';
      if (!data.order.goodsShippedAt) return 'Bestelling verzenden';
      if (data.order.status !== 'BETAALD') return 'Betaling registreren';
      return 'Order afgerond';
    }
    if (data.order.status === 'CONCEPT') return data.order.sentAt
      ? 'Nieuwe versie naar de klant' : 'Offerte naar de klant';
    if (data.order.status === 'GEACCEPTEERD') return 'Factuur maken';
    if (data.order.status === 'VERZONDEN' || data.order.status === 'BEKEKEN') {
      return 'Reactie van de klant volgen';
    }
    if (data.order.status === 'AFGEWEZEN' || data.order.status === 'VERLOPEN') {
      return 'Nieuwe versie voorbereiden';
    }
    return 'Verkoopdocument beheren';
  }

  nextStepHelp(data: SalesOrderView): string {
    if (this.pendingRevision()) return 'De klant wacht op jouw keuze. Open het voorstel en neem de wijzigingen gericht over.';
    if ((data.order.docType ?? 'OFFERTE') === 'FACTUUR') {
      if (data.order.status === 'CONCEPT') return 'Mail de PDF vanuit het ERP, of markeer ze bij de extra acties als je ze zelf bezorgde.';
      if (!data.order.goodsShippedAt) return 'Bevestig de verzending en punt de verkochte aantallen één keer uit de voorraad.';
      if (data.order.status !== 'BETAALD') return 'Leg de betaling vast zodra het bedrag ontvangen is.';
      return 'Factuur, verzending en betaling zijn verwerkt. De pakbon blijft beschikbaar.';
    }
    if (data.order.status === 'CONCEPT') return 'Controleer de PDF en verstuur daarna dezelfde versie naar de klant.';
    if (data.order.status === 'GEACCEPTEERD') return 'Bevries deze afspraken in een nieuwe verkoopfactuur.';
    if (data.order.status === 'VERZONDEN' || data.order.status === 'BEKEKEN') {
      return 'De klantlink blijft actief. Open Beheren alleen als je een nieuwe versie wilt voorbereiden.';
    }
    return 'Open Beheren om deze status of een nieuwe versie verder af te handelen.';
  }

  readonly isInvoice = computed(() => (this.view()?.order.docType ?? 'OFFERTE') === 'FACTUUR');
  readonly canDelete = computed(() => {
    const data = this.view();
    return !!data && this.revisions().length === 0
      && isLocallyDeletableSalesDocument(data.order);
  });
  readonly invoiceBusy = signal(false);
  readonly sendSheetOpen = signal(false);
  readonly packing = signal(false);

  /** The paper that travels with the goods; prices stay off it. */
  async downloadPackingSlip(data: SalesOrderView): Promise<void> {
    if (this.packing()) return;
    this.packing.set(true);
    try {
      const blob = await this.sales.packingSlip(data.order.id!);
      saveBlob(blob, `${data.order.number}-pakbon.pdf`);
      this.ui.toast('Pakbon gedownload — zonder prijzen, voor magazijn en transport');
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Pakbon maken mislukt'), 'err');
    } finally {
      this.packing.set(false);
    }
  }
  readonly sendMessage = signal('');
  readonly sendingQuote = signal(false);

  /** The next step without opening the editor: the quote leaves from here. */
  async sendFromView(): Promise<void> {
    const data = this.view();
    if (!data || this.sendingQuote()) return;
    this.sendingQuote.set(true);
    try {
      this.view.set(await this.sales.sendQuote(data.order.id!, this.sendMessage().trim()));
      this.sendSheetOpen.set(false);
      this.sendMessage.set('');
      this.ui.toast(this.isInvoice() ? 'Factuur verstuurd' : 'Offerte verstuurd');
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Versturen mislukt'), 'err');
    } finally {
      this.sendingQuote.set(false);
    }
  }

  /** The quote's journey, or the invoice's shorter one. */
  journey(order: SalesOrder) {
    if ((order.docType ?? 'OFFERTE') !== 'FACTUUR') return this.quoteJourney(order.status);
    /* Payment and shipment are separate facts, so each step carries its own
       flag; the first thing not yet done gets the "now" ring. */
    const flags = [true, order.status !== 'CONCEPT', !!order.goodsShippedAt,
                   order.status === 'BETAALD'];
    const now = flags.indexOf(false);
    return [
      { label: 'Concept', mark: '✓' },
      { label: 'Verstuurd', mark: '✓' },
      { label: 'Bestelling', mark: '✓' },
      { label: 'Betaald', mark: '✓' },
    ].map((step, index) => ({
      ...step,
      state: (flags[index] ? 'done' : index === now ? 'now' : 'todo') as 'done' | 'now' | 'todo',
      kind: undefined as undefined,
    }));
  }

  makeInvoice(data: SalesOrderView): void {
    if (this.invoiceBusy()) return;
    this.ui.confirm({
      title: 'Factuur maken',
      message: `De inhoud van ${data.order.number} wordt bevroren in een nieuwe factuur. `
        + 'De offerte zelf blijft bestaan.',
      confirmLabel: 'Factuur maken',
    }, () => { void this.createInvoice(data); });
  }

  private async createInvoice(data: SalesOrderView): Promise<void> {
    this.invoiceBusy.set(true);
    try {
      const invoice = await this.sales.createInvoiceFrom(data.order.id!);
      this.ui.toast(`${invoice.order.number} aangemaakt`);
      await this.routerNav.navigate(['/sales', invoice.order.id]);
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Factuur maken mislukt'), 'err');
    } finally {
      this.invoiceBusy.set(false);
    }
  }

  async markSent(data: SalesOrderView): Promise<void> {
    if (this.invoiceBusy()) return;
    this.invoiceBusy.set(true);
    try {
      this.view.set(await this.sales.markInvoiceSent(data.order.id!));
      this.ui.toast('Factuur staat op verstuurd');
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Status wijzigen mislukt'), 'err');
    } finally {
      this.invoiceBusy.set(false);
    }
  }

  readonly shipSheet = signal<{
    rows: { name: string; photoUrl: string | null; qty: number;
            before: number | null; after: number | null }[];
    pieces: number; number: string;
  } | null>(null);

  /**
   * Deducting stock is deliberate: the sheet first shows every product with
   * its photo and the count before and after, and flags a line that would
   * push the book below zero.
   */
  async openShipSheet(data: SalesOrderView): Promise<void> {
    if (this.invoiceBusy()) return;
    let stockById = new Map<number, number>();
    try {
      const products = await this.catalog.products();
      stockById = new Map(products.filter(product => product.id !== null)
        .map(product => [product.id!, product.stockQuantity ?? 0]));
    } catch { /* stock preview is best-effort; the rows then say "onbekend" */ }
    const rows = data.priced.lines.map(line => {
      const before = stockById.has(line.productId) ? stockById.get(line.productId)! : null;
      return { name: line.description, photoUrl: line.photoUrl, qty: line.quantity,
               before, after: before === null ? null : before - line.quantity };
    });
    this.shipSheet.set({ rows, pieces: data.priced.totals.pieces, number: data.order.number });
  }

  shipHasNegative(): boolean {
    return (this.shipSheet()?.rows ?? []).some(row => row.after !== null && row.after < 0);
  }

  confirmShipFromSheet(): void {
    const data = this.view();
    if (!data) return;
    void this.shipGoods(data);
  }

  private async shipGoods(data: SalesOrderView): Promise<void> {
    this.invoiceBusy.set(true);
    try {
      this.view.set(await this.sales.shipGoods(data.order.id!));
      this.history.set(await this.sales.history(data.order.id!).catch(() => this.history()));
      this.shipSheet.set(null);
      this.ui.toast('Bestelling verzonden — voorraad afgepunt');
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Voorraad afpunten mislukt'), 'err');
    } finally {
      this.invoiceBusy.set(false);
    }
  }

  async markPaid(data: SalesOrderView): Promise<void> {
    if (this.invoiceBusy()) return;
    this.invoiceBusy.set(true);
    try {
      this.view.set(await this.sales.markInvoicePaid(data.order.id!));
      this.ui.toast('Factuur betaald — mooi zo');
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Status wijzigen mislukt'), 'err');
    } finally {
      this.invoiceBusy.set(false);
    }
  }

  remove(data: SalesOrderView): void {
    if (!this.canDelete() || this.deleting() || this.ui.confirmRequest() !== null) return;
    const label = salesDocumentLabel(data.order.docType);
    const customer = this.customerName();
    this.ui.confirm(
      {
        title: `${label} verwijderen`,
        message: `Weet je zeker dat je ${label.toLowerCase()} `
          + `<b>${escapeHtml(data.order.number)}</b> van `
          + `<b>${escapeHtml(customer)}</b> wilt verwijderen?<br><br>`
          + 'Dit kan niet ongedaan worden gemaakt.',
        confirmLabel: 'Verwijderen',
        danger: true,
      },
      () => { void this.deleteAndLeave(data, label); },
    );
  }

  private async deleteAndLeave(
    data: SalesOrderView,
    label: 'Offerte' | 'Verkoopfactuur',
  ): Promise<void> {
    if (this.deleting()) return;
    this.deleting.set(true);
    try {
      await this.sales.deleteOrder(data.order.id);
      void this.work.refresh(true);
      this.ui.toast(`${label} verwijderd`);
      await this.routerNav.navigate(['/sales']);
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, `${label} verwijderen mislukt`), 'err');
      this.deleting.set(false);
    }
  }

  constructor() {
    effect(() => {
      const orderId = Number(this.id());
      if (Number.isInteger(orderId) && orderId > 0) void this.load(orderId);
      else {
        this.loading.set(false);
        this.loadError.set('Het ordernummer in de link is ongeldig.');
      }
    });
  }

  private async load(orderId: number): Promise<void> {
    this.loading.set(true);
    this.loadError.set('');
    this.view.set(null);
    this.portalLink.set(null);
    this.openLine.set(null);
    this.openProductGroups.set(new Set());
    try {
      const [view, customers, countries, revisions, history, portalLink, products, categories, families] = await Promise.all([
        this.sales.order(orderId),
        this.sales.customers(),
        this.sales.countries(),
        this.sales.revisionsFor(orderId).catch(() => [] as QuoteRevision[]),
        this.sales.history(orderId).catch(() => [] as QuoteEvent[]),
        this.sales.portalLink(orderId).catch(() => null),
        this.catalog.products().catch(() => [] as Product[]),
        this.catalog.categories().catch(() => [] as Category[]),
        this.catalog.productFamilies().catch(() => [] as ProductFamily[]),
      ]);
      this.view.set(view);
      this.customers.set(customers);
      this.countries.set(countries);
      this.revisions.set(revisions);
      this.history.set(history);
      this.portalLink.set(portalLink);
      this.products.set(products);
      this.categories.set(categories);
      this.families.set(families);
    } catch (failure: unknown) {
      this.loadError.set(messageOf(failure, 'De offerte kon niet worden geladen'));
    } finally {
      this.loading.set(false);
    }
  }

  retry(): void {
    const orderId = Number(this.id());
    if (Number.isInteger(orderId) && orderId > 0) void this.load(orderId);
  }

  salesLineNumber(productId: number): number {
    return (this.view()?.priced.lines.findIndex((line) => line.productId === productId) ?? -1) + 1;
  }

  salesCategoryHeadingId(key: string): string {
    return `sales-category-${key.replace(/[^a-z0-9-]/gi, '-')}`;
  }

  productFor(productId: number): Product | null {
    return this.productsById().get(productId) ?? null;
  }

  salesVariantTitle(productId: number, fallback: string): string {
    const product = this.productFor(productId);
    if (!product) return fallback;
    const parts = [product.colour, product.variantSize]
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value));
    return parts.length ? parts.join(' · ') : fallback;
  }

  averageGroupUnitPrice(totalEur: number, pieces: number): number {
    return pieces > 0 ? totalEur / pieces : 0;
  }

  customerName(): string {
    return this.customer()?.company || 'Geen klant';
  }

  countryName(): string {
    return this.country()?.name || this.view()?.order.countryCode || 'Geen leverland';
  }

  /** "50% voorschot / 50% bij levering" reads as "50/50" on a phone tile. */
  paymentShort(): string {
    const label = this.paymentTerms();
    const parts = label.match(/\d+(?=\s*%)/g);
    return parts && parts.length > 1 ? parts.join('/') : label;
  }

  paymentTerms(): string {
    /* Mirrors the backend: without agreed terms the house standard applies. */
    return this.view()?.order.paymentTerms || this.customer()?.paymentTerms || 'Vooruitbetaling';
  }

  palletCount(data: SalesOrderView): number {
    return data.priced.totals.palletsManual || data.priced.totals.palletsStrict;
  }

  isLooseCartons(data: SalesOrderView): boolean {
    return data.order.loadMode === 'LOOSE_CARTONS';
  }

  freightStrategyLabel(data: SalesOrderView): string {
    if (data.order.freight === 'TE_BEPALEN') return 'later bepalen';
    const strategy = data.order.freightPricingStrategy
      ?? (data.order.manualFreightEur != null ? 'FIXED' : 'COUNTRY_PALLET');
    if (strategy === 'PER_CBM') return 'per m³';
    if (strategy === 'FIXED') return 'vast bedrag';
    if (strategy === 'CARRIER') return 'staffel verzendorganisatie';
    if (strategy === 'PICKUP') return 'afhalen';
    return 'per pallet';
  }

  deliveryOpen(line: PricedLine, data: SalesOrderView): boolean {
    return !line.deliveryWeek && (data.order.deliveryTerms === 'TE_BEPALEN'
      || !line.inventoryKnown || (line.shortfall ?? 0) > 0);
  }

  deliveryText(line: PricedLine, data: SalesOrderView): string {
    if (line.deliveryWeek) return new WeekNlPipe().transform(line.deliveryWeek, 'short');
    if (line.deliveryExplanation) return line.deliveryExplanation;
    if (data.order.deliveryTerms === 'TE_BEPALEN') return 'Nog te bepalen';
    if (!line.inventoryKnown) return 'Voorraad nog niet bevestigd';
    if ((line.shortfall ?? 0) > 0) return `${line.shortfall} stuks tekort`;
    if (line.inStock) return 'Op voorraad';
    return 'Volgens afspraak';
  }

  /** Fact-cell version of deliveryText: always a couple of words. */
  deliveryShort(line: PricedLine, data: SalesOrderView): string {
    if (line.deliveryWeek) return new WeekNlPipe().transform(line.deliveryWeek, 'short');
    if ((line.shortfall ?? 0) > 0) return `${new NumPipe().transform(line.shortfall!)} tekort`;
    if (data.order.deliveryTerms === 'TE_BEPALEN') return 'Te bepalen';
    if (!line.inventoryKnown) return 'Onbevestigd';
    if (line.inStock) return 'Op voorraad';
    return 'Volgens afspraak';
  }

  deliveryState(data: SalesOrderView): string {
    switch (data.order.deliveryTerms) {
      case 'TE_BEPALEN': return 'Nog te bepalen';
      case 'AANGEVULD': return 'Aangevuld';
      default: return 'Volledig';
    }
  }

  freightLabel(data: SalesOrderView): string {
    return data.order.freight === 'TE_BEPALEN'
      ? 'Nog te bepalen'
      : new EurPipe().transform(data.priced.totals.freight, 2);
  }

  freightAmount(data: SalesOrderView): string {
    return data.order.freight === 'TE_BEPALEN'
      ? 'open post'
      : new EurPipe().transform(data.priced.totals.freight, 2);
  }

  vatLabel(data: SalesOrderView): string {
    return data.priced.totals.vatLegalMention
      || `${new PctPipe().transform(data.priced.totals.vatRatePct, 0)} · ${data.priced.totals.vatTreatment.toLowerCase()}`;
  }

  signedMoney(value: number): string {
    const formatted = new EurPipe().transform(Math.abs(value), 0);
    return `${value >= 0 ? '+' : '−'} ${formatted}`;
  }

  profitPill(line: PricedLine): string {
    const value = this.profitAmount(line);
    return `${value < 0 ? '−' : '+'} ${new EurPipe().transform(Math.abs(value), 2)}`;
  }

  profitDiscount(line: PricedLine): number {
    return this.profitMode() === 'UNIT' && line.quantity > 0
      ? line.discountAmount / line.quantity
      : line.discountAmount;
  }

  readonly openLine = signal<number | null>(null);
  readonly openProductGroups = signal<ReadonlySet<string>>(new Set());
  readonly deliveryInfo = signal<PricedLine | null>(null);

  /** The inkoop stepper, retold for a quote: three fixed stops, one outcome. */
  quoteJourney(status: QuoteStatus): {
    label: string; mark: string; state: 'done' | 'now' | 'todo';
    kind?: 'danger' | 'gold' | 'muted';
  }[] {
    const reached: Record<QuoteStatus, number> = {
      CONCEPT: 0, VERZONDEN: 1, BEKEKEN: 2,
      WIJZIGING_GEVRAAGD: 3, GEACCEPTEERD: 3, AFGEWEZEN: 3, VERLOPEN: 3, BETAALD: 3,
    };
    const outcome = status === 'AFGEWEZEN' ? { label: 'Afgewezen', mark: '✕', kind: 'danger' as const }
      : status === 'WIJZIGING_GEVRAAGD' ? { label: 'Wijziging', mark: '!', kind: 'gold' as const }
      : status === 'VERLOPEN' ? { label: 'Verlopen', mark: '–', kind: 'muted' as const }
      : { label: 'Geaccepteerd', mark: '✓', kind: undefined };
    const steps: { label: string; mark: string; kind?: 'danger' | 'gold' | 'muted' }[] = [
      { label: 'Concept', mark: '✓' }, { label: 'Verzonden', mark: '✓' },
      { label: 'Bekeken', mark: '✓' }, outcome,
    ];
    const now = reached[status];
    return steps.map((step, index) => ({
      label: step.label,
      mark: index < now ? '✓' : index === now ? step.mark : `${index + 1}`,
      state: index < now ? 'done' as const : index === now ? 'now' as const : 'todo' as const,
      kind: index === now ? step.kind : undefined,
    }));
  }
  linePanelId(productId: number): string { return `sales-line-breakdown-${productId}`; }
  productGroupPanelId(key: string): string {
    return `sales-product-group-${key.replace(/[^a-z0-9_-]/gi, '-')}`;
  }
  productGroupOpen(key: string): boolean { return this.openProductGroups().has(key); }
  toggleProductGroup(key: string): void {
    this.openProductGroups.update((openGroups) => nextProductGroupDisclosure(openGroups, key));
  }
  toggleLine(productId: number): void {
    this.openLine.update((current) => (current === productId ? null : productId));
  }

  profitAmount(line: PricedLine): number {
    return this.profitMode() === 'UNIT' && line.quantity > 0
      ? line.marginEur / line.quantity
      : line.marginEur;
  }

  profitNet(line: PricedLine): number {
    return this.profitMode() === 'UNIT' && line.quantity > 0
      ? line.netUnitPrice
      : line.net;
  }

  profitCost(line: PricedLine): number {
    return this.profitMode() === 'UNIT' && line.quantity > 0
      ? line.landedUnitCost
      : line.costTotal;
  }

  label = (status: QuoteStatus) => STATUS_LABEL[status];
  cls = statusClass;
  readonly websiteRequest = isWebsiteQuoteRequest;

  async downloadPdf(): Promise<void> {
    const data = this.view();
    if (!data || this.downloading()) return;
    this.downloading.set(true);
    try {
      const blob = await this.sales.quotePdf(data.order.id);
      saveBlob(blob, `${data.order.number} - ${this.customerName() || 'klant'}.pdf`);
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'PDF downloaden mislukt'), 'err');
    } finally {
      this.downloading.set(false);
    }
  }

  async copyCustomerLink(): Promise<void> {
    const link = this.portalLink();
    if (!link?.available || !link.url || this.copyingLink()) return;
    this.copyingLink.set(true);
    try {
      await navigator.clipboard.writeText(link.url);
      this.ui.toast('Klantlink gekopieerd');
    } catch {
      this.ui.toast('Klantlink kon niet worden gekopieerd', 'err');
    } finally {
      this.copyingLink.set(false);
    }
  }
}
