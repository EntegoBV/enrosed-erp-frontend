import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { SourcingApi } from '../../core/api/sourcing-api';
import { CatalogApi } from '../../core/api/catalog-api';
import { AuthImage } from '../../core/api/auth-image';
import { PageHeader } from '../../shared/page-header';
import { Diary } from './diary';
import { Skeleton } from '../../shared/skeleton';
import { saveBlob } from '../../core/api/download';
import { Ui } from '../../shared/ui';
import { CbmPipe, EurPipe, NumPipe, PctPipe } from '../../shared/pipes';
import {
  Product, PurchaseOrderView, Supplier, StockLocation, PurchasePayment, PurchaseDocument,
} from '../../core/api/models';
import { containerLabel } from '../../core/api/geo';
import { DateNlPipe } from '../../shared/pipes';
import { effectiveUsdToEur, purchaseCostLabels } from './purchase-cost-labels';

/**
 * Read-only control room for one incoming container.
 *
 * The screen follows the goods instead of the database: progress and capacity
 * first, then the actual product load, the route and finally the internal
 * landed-cost explanation. Editing remains an explicit separate action.
 */
@Component({
  selector: 'app-purchase-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AuthImage, PageHeader, Skeleton, CbmPipe, DateNlPipe,
            EurPipe, NumPipe, PctPipe, Diary],
  template: `
    @if (view(); as data) {
      <app-page-header [title]="data.order.number"
                       [subtitle]="data.order.alias ? data.order.alias + ' · ' + supplierName() : supplierName()"
                       [showBack]="true" [showBell]="false">
        <button class="btn btn--sm" type="button" (click)="downloadPdf()"
                [attr.aria-label]="'Download ' + data.order.number + ' als PDF'">
          PDF
        </button>
        <a class="btn btn--primary btn--sm"
           [routerLink]="['/purchasing', data.order.id, 'edit']">
          Bewerken
        </a>
      </app-page-header>

      <div class="content purchase-view-page anim-rise">

        <section class="journey-hero" aria-labelledby="purchase-overview-title">
          <div class="journey-hero__top">
            <div class="journey-hero__copy">
              <span class="eyebrow">Inkomende container</span>
              <h1 id="purchase-overview-title">{{ supplierName() }}</h1>
              <p>
                {{ data.order.orderDate | dateNl }}
                @if (data.order.alias) { <span aria-hidden="true"> · </span>{{ data.order.alias }} }
              </p>
            </div>
            <span class="status-pill" [class.status-pill--done]="data.order.status === 'ONTVANGEN'">
              <span class="status-pill__dot" aria-hidden="true"></span>
              {{ statusLabel(data.order.status) }}
            </span>
          </div>

          <div class="route-strip" aria-label="Transportroute">
            <div class="route-stop">
              <span class="route-stop__dot" aria-hidden="true"></span>
              <span>
                <small>Vertrekhaven</small>
                <strong>{{ costLabels().loadingPort }}</strong>
              </span>
            </div>
            <span class="route-strip__line" aria-hidden="true"></span>
            <div class="route-stop route-stop--end">
              <span class="route-stop__dot" aria-hidden="true"></span>
              <span>
                <small>Aankomsthaven</small>
                <strong>{{ costLabels().destinationPort }}</strong>
              </span>
            </div>
          </div>

          <div class="stepper journey-stepper" aria-label="Voortgang van de inkooporder">
            @for (step of statusSteps; track step.value; let last = $last) {
              <div class="stepper__step"
                   [class.stepper__step--done]="stepIndex(data.order.status) > $index"
                   [class.stepper__step--now]="stepIndex(data.order.status) === $index">
                <span class="stepper__dot" aria-hidden="true">
                  @if (stepIndex(data.order.status) > $index) { ✓ } @else { {{ $index + 1 }} }
                </span>
                <span class="stepper__label">{{ step.label }}</span>
              </div>
              @if (!last) {
                <span class="stepper__line"
                      [class.stepper__line--done]="stepIndex(data.order.status) > $index"></span>
              }
            }
          </div>

          @if (data.attention?.length) {
            <div class="po-attention" role="status">
              <span class="attention-dot">{{ data.attention!.length }}</span>
              <div class="po-attention__body">
                <b>Actie vereist</b>
                @for (item of data.attention; track item) { <span>{{ item }}</span> }
              </div>
            </div>
          }

          <div class="overview-facts">
            <div class="overview-fact">
              <span>Container</span>
              <strong>{{ containerLabel(data.order.containerType) }}</strong>
            </div>
            <div class="overview-fact">
              <span>Productregels</span>
              <strong>{{ data.costing.lines.length }} regels</strong>
            </div>
            <div class="overview-fact">
              <span>Totale lading</span>
              <strong>{{ data.costing.totals.pieces | num }} st · {{ data.costing.totals.cartons | num }} dozen</strong>
            </div>
            <div class="overview-fact">
              <span>Volume</span>
              <strong>{{ data.costing.totals.cbm | cbm }}</strong>
            </div>
            @if (data.order.trackingReference) {
              <div class="overview-fact">
                <span>Track &amp; trace</span>
                <strong class="mono">{{ data.order.trackingReference }}</strong>
              </div>
            }
            <div class="overview-fact">
              <span>Lossen op</span>
              <strong>{{ receivingLocationName(data.order.receivingLocationId) }}</strong>
            </div>
            <div class="overview-fact overview-fact--total">
              <span>Totaal geland</span>
              <strong>{{ data.costing.totals.totalEur | eur }}</strong>
            </div>
          </div>
        </section>

        @if (isDdp()) {
          <!-- DDP: the supplier's container - its fill is their concern. -->
          <section class="card capacity-card" aria-label="Lading">
            <div class="capacity-card__top">
              <div>
                <span class="section-kicker">Lading</span>
                <h2>Geleverd DDP</h2>
                <p>{{ data.costing.totals.cbm | cbm }} · {{ data.costing.totals.cartons | num }} dozen · transport en rechten in de prijs</p>
              </div>
              <strong class="capacity-card__percentage">{{ data.costing.totals.pieces | num }} st</strong>
            </div>
          </section>
        } @else if (data.costing.containerFill; as fill) {
          <section class="card capacity-card" aria-labelledby="container-fill-title">
            <div class="capacity-card__top">
              <div>
                <span class="section-kicker">Capaciteit</span>
                <h2 id="container-fill-title">Containervulling</h2>
                <p>{{ fill.containerCode }} · {{ fill.usedCbm | cbm }} van {{ fill.capacityCbm | cbm }}</p>
              </div>
              <strong class="capacity-card__percentage"
                      [class.capacity-card__percentage--over]="fill.overflowCbm > 0"
                      [class.fill-pct--full]="fill.overflowCbm <= 0 && fill.fillPercent >= 97">
                {{ fill.fillPercent | pct: 0 }}
              </strong>
            </div>
            <div class="meter__track capacity-meter" role="meter"
                 aria-label="Containervulling" aria-valuemin="0" aria-valuemax="100"
                 [attr.aria-valuenow]="fill.fillPercent">
              <div class="meter__fill" [class.meter__fill--warn]="fill.overflowCbm > 0"
                   [class.meter__fill--full]="fill.overflowCbm <= 0 && fill.fillPercent >= 97"
                   [style.width.%]="fillWidth(fill.fillPercent)"></div>
            </div>
            <div class="capacity-card__footer">
              @if (fill.overflowCbm > 0) {
                <span class="capacity-state capacity-state--danger">
                  <span aria-hidden="true">!</span> {{ fill.overflowCbm | cbm }} te veel voor één container
                </span>
              } @else {
                <span class="capacity-state capacity-state--ok">
                  <span aria-hidden="true">✓</span> {{ fill.freeCbm | cbm }} vrije ruimte
                </span>
              }
              <span>{{ data.costing.totals.cartons | num }} dozen geladen</span>
            </div>
          </section>
        }

        <div class="view-layout">
          <main class="view-main">
            <section class="card products-card" aria-labelledby="purchase-products-title">
              <div class="section-heading">
                <span class="section-heading__copy">
                  <span class="section-kicker">Lading</span>
                  <h2 id="purchase-products-title">Productregels</h2>
                  <span>{{ data.costing.totals.pieces | num }} st ·
                    {{ data.costing.totals.cartons | num }} dozen· 1 USD = {{ usdToEurRate() | num: 4 }} EUR</span>
                </span>
                @if (data.costing.lines.length) {
                  <div class="per-toggle" role="group" aria-label="Kostopbouw tonen als">
                    <button type="button" [class.on]="!perPiece()"
                            [attr.aria-pressed]="!perPiece()"
                            (click)="perPiece.set(false)">Totaal</button>
                    <button type="button" [class.on]="perPiece()"
                            [attr.aria-pressed]="perPiece()"
                            (click)="perPiece.set(true)">Per stuk</button>
                  </div>
                }
              </div>

              <div class="product-lines">
                @for (line of data.costing.lines; track line.productId; let lineIndex = $index) {
                  <article class="purchase-line">
                    <div class="purchase-line__identity">
                      @if (photoOf(line.productId); as url) {
                        <img class="purchase-line__photo" [appAuthSrc]="url" alt="" />
                      } @else {
                        <span class="purchase-line__photo purchase-line__photo--empty" aria-hidden="true">◈</span>
                      }
                      <span class="purchase-line__copy">
                        <small>Regel {{ lineIndex + 1 }}</small>
                        <strong>{{ line.productName }}</strong>
                        <span>{{ line.quantity | num }} st · {{ line.cartons | num }} dozen</span>
                      </span>
                    </div>

                    <div class="line-facts">
                      <span><small>Aantal</small><strong>{{ line.quantity | num }} st</strong></span>
                      <span><small>Dozen</small><strong>{{ line.cartons | num }}</strong></span>
                      <span><small>Volume</small><strong>{{ line.cbm | cbm }}</strong></span>
                    </div>

                    <button class="line-breakdown-toggle" type="button"
                            [attr.aria-expanded]="openLine() === line.productId"
                            [attr.aria-controls]="linePanelId(line.productId)"
                            (click)="toggleLine(line.productId)">
                      <span>
                        <small>Kostopbouw</small>
                        <strong>{{ perPiece() ? 'Per stuk bekijken' : 'Hele regel bekijken' }}</strong>
                      </span>
                      <span class="line-breakdown-toggle__total">
                        {{ perPiece() ? (line.landedUnitEur | eur: 4) : (line.totalEur | eur) }}
                      </span>
                      <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"
                           [class.chevron-open]="openLine() === line.productId">
                        <path d="m6.5 8 3.5 3.5L13.5 8" fill="none" stroke="currentColor"
                              stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                      </svg>
                    </button>

                    @if (openLine() === line.productId) {
                      <div class="line-breakdown" [id]="linePanelId(line.productId)">
                        <div class="stat-row"><span>Goederen</span>
                          <span class="num">{{ amt(line.goodsEur, line) | eur: decimals() }}</span></div>
                        @if (line.originEur) {
                          <div class="stat-row"><span>{{ costLabels().originCostsLabel }}
                            <small>{{ costLabels().originRoute }}</small>
                          </span>
                            <span class="num">{{ amt(line.originEur, line) | eur: decimals() }}</span></div>
                        }
                        <div class="stat-row"><span>{{ costLabels().seaFreightLabel }}
                          <small>{{ costLabels().seaFreightRoute }}</small>
                        </span>
                          <span class="num">{{ amt(line.freightEur, line) | eur: decimals() }}</span></div>
                        <div class="stat-row line-breakdown__subtotal"><span>Douanewaarde</span>
                          <span class="num">{{ amt(line.customsValueEur, line) | eur: decimals() }}</span></div>
                        <div class="stat-row"><span>Invoerrecht {{ line.dutyRatePct | pct: 1 }}
                          @if (line.dutySource) { <small>({{ line.dutySource }})</small> }
                        </span><span class="num">{{ amt(line.dutyEur, line) | eur: decimals() }}</span></div>
                        <div class="stat-row"><span>{{ costLabels().destinationCostsLabel }}</span>
                          <span class="num">{{ amt(line.destinationEur, line) | eur: decimals() }}</span></div>
                        @if (line.extraRevenueEur) {
                          <div class="stat-row"><span>Enrosed kost</span>
                            <span class="num">{{ amt(line.extraRevenueEur, line) | eur: decimals() }}</span></div>
                        }
                      </div>
                    }
                  </article>
                } @empty {
                  <div class="product-empty">
                    <span class="product-empty__art" aria-hidden="true">◈</span>
                    <h3>Nog geen producten geladen</h3>
                    <p>Voeg producten en aantallen toe om de containervulling en kostprijs te berekenen.</p>
                    <a class="btn btn--primary"
                       [routerLink]="['/purchasing', data.order.id, 'edit']">
                      Producten toevoegen
                    </a>
                  </div>
                }
              </div>
            </section>

          </main>

          <aside class="view-sidebar" aria-label="Samenvatting en acties">
            <section class="card cost-card internal-block" aria-labelledby="purchase-cost-title">
              <div class="cost-card__head">
                <div>
                  <span class="section-kicker">Interne calculatie</span>
                  <h2 id="purchase-cost-title">Gelande kostprijs</h2>
                </div>
                <span class="internal-badge">Intern</span>
              </div>

              <div class="cost-card__body">
                <!-- DDP: the sum below already ends on the landed total; this box
                     would only repeat it. -->
                @if (!isDdp()) {
                <div class="cost-hero">
                  <!-- What the road adds on top of the goods - the figure a
                       buyer negotiates on; an average per piece over mixed
                       products said nothing. Quiet, the total is the star. -->
                  @if (!isDdp()) {
                  <div class="cost-hero__aside">
                    <div class="cost-hero__label">Bovenop de goederen</div>
                    <div class="cost-hero__value cost-hero__value--quiet">
                      + {{ data.costing.totals.totalEur - data.costing.totals.goodsEur | eur }}
                    </div>
                    <div class="cost-hero__sub">
                      @if (data.costing.totals.goodsEur > 0) {
                        {{ overheadPct(data.costing.totals) | num }} % van de inkoop
                      } @else {
                        nog geen goederen geladen
                      }
                    </div>
                  </div>
                  }
                  <div class="cost-hero__unit">
                    <div class="cost-hero__label">Totaal geland</div>
                    <div class="cost-hero__value cost-hero__value--rose">{{ data.costing.totals.totalEur | eur }}</div>
                  </div>
                </div>
                }

                <div class="cost-stage">
                  <span class="cost-stage__label">{{ isDdp() ? '1 · Goederen, geleverd incl. rechten' : '1 · Tot de EU-grens' }}</span>
                  <div class="stat-row"><span>{{ isDdp() ? 'Goederen (DDP)' : 'Goederen' }}
                    <small>{{ data.costing.totals.goodsUsd | num: 2 }} USD{{ isDdp() ? ' · transport en rechten inbegrepen' : '' }}</small>
                  </span><span class="num">{{ data.costing.totals.goodsEur | eur }}</span></div>
                  @if (!isDdp()) {
                  @if (data.costing.totals.originEur) {
                    <div class="stat-row"><span>{{ costLabels().originCostsLabel }}
                      <small>{{ costLabels().originRoute }}</small>
                    </span>
                      <span class="num">{{ data.costing.totals.originEur | eur }}</span></div>
                  }
                  <div class="stat-row"><span>{{ costLabels().seaFreightLabel }}
                    <small>{{ costLabels().seaFreightRoute }}</small>
                  </span>
                    <span class="num">{{ data.costing.totals.freightEur | eur }}</span></div>
                  <div class="stat-row cost-stage__subtotal"><span>Douanewaarde</span>
                    <span class="num">{{ data.costing.totals.customsValueEur | eur }}</span></div>
                  }
                </div>

                <div class="cost-stage">
                  <span class="cost-stage__label">{{ isDdp() ? '2 · Eigen kosten' : '2 · Invoer & aankomst' }}</span>
                  @if (!isDdp()) {
                  <div class="stat-row"><span>Invoerrechten
                    <small>gem. {{ data.costing.totals.effectiveDutyPct | pct: 1 }}</small>
                  </span><span class="num">{{ data.costing.totals.dutyEur | eur }}</span></div>
                  <div class="stat-row"><span>{{ costLabels().destinationCostsLabel }}</span>
                    <span class="num">{{ data.costing.totals.destinationEur | eur }}</span></div>
                  }
                  @if (data.costing.totals.extraRevenueEur) {
                    <div class="stat-row"><span>Enrosed kost</span>
                      <span class="num">{{ data.costing.totals.extraRevenueEur | eur }}</span></div>
                  }
                </div>

                <div class="cost-stage">
                  <span class="cost-stage__label">3 · Totaal</span>
                  <div class="stat-row cost-stage__subtotal">
                    <span>Totaal geland</span>
                    <strong class="num">{{ data.costing.totals.totalEur | eur }}</strong>
                  </div>
                </div>
              </div>
            </section>

            <!-- Two streams of money: the factory for the goods, the forwarder
                 and customs for the road. The Enrosed kost is ours. -->
            <section class="card payments-card" aria-labelledby="purchase-payments-title">
              <span class="section-kicker">Betalingen</span>
              <h2 id="purchase-payments-title">
                @if (paidAll() > 0) { {{ paidAll() | eur }} betaald } @else { Nog niets betaald }
              </h2>
              <p>Te betalen {{ owedAll() | eur }} · open {{ openAll() | eur }}</p>
              <div class="pay-stream">
                <div class="pay-stream__head">
                  <span><b>Aan de leverancier</b><small>{{ data.payable?.freightInSupplierPrice ? 'goederen + zeevracht' : 'de goederen' }}</small></span>
                  <span class="num"><b>{{ paidTo('SUPPLIER') | eur }}</b><small>van {{ supplierOwed() | eur }}</small></span>
                </div>
                <div class="payments-meter"><div class="payments-meter__fill" [style.width.%]="pct(paidTo('SUPPLIER'), supplierOwed())"></div></div>
                @for (payment of paymentsTo('SUPPLIER'); track payment.id) {
                  <div class="pay-line"><span class="pay-line__what"><b>{{ payment.label || 'Betaling' }}</b><small>{{ payment.paidOn | dateNl }}</small></span><span class="num pay-line__amount">{{ payment.amountEur | eur }}</span></div>
                }
              </div>
              @if ((data.payable?.logisticsEur ?? 0) > 0 || paymentsTo('LOGISTICS').length) {
                <div class="pay-stream">
                  <div class="pay-stream__head">
                    <span><b>Douane &amp; transport tot lossen op {{ receivingLocationName(data.order.receivingLocationId) }}</b><small>invoerrechten, transport, aankomst · na aankomst</small></span>
                    <span class="num"><b>{{ paidTo('LOGISTICS') | eur }}</b><small>van {{ logisticsOwed() | eur }}</small></span>
                  </div>
                  <div class="payments-meter"><div class="payments-meter__fill" [style.width.%]="pct(paidTo('LOGISTICS'), logisticsOwed())"></div></div>
                  @for (payment of paymentsTo('LOGISTICS'); track payment.id) {
                    <div class="pay-line"><span class="pay-line__what"><b>{{ payment.label || 'Betaling' }}</b><small>{{ payment.paidOn | dateNl }}</small></span><span class="num pay-line__amount">{{ payment.amountEur | eur }}</span></div>
                  }
                </div>
              }
              @if (data.costing.totals.extraRevenueEur) {
                <p class="pay-ours">Enrosed kost {{ data.costing.totals.extraRevenueEur | eur }} is onze eigen opslag - geen betaling.</p>
              }
            </section>

            @if (data.order.notes) {
              <!-- The container's diary, under the money it mostly talks about. -->
              <section class="card payments-card note-card" aria-labelledby="purchase-note-title">
                <span class="section-kicker">Notitie</span>
                <h2 id="purchase-note-title">Dagboek van de container</h2>
                <app-diary [notes]="data.order.notes" />
              </section>
            }

            @if (documents(); as docs) {
              @if (docs.length) {
                <section class="card payments-card" aria-label="Documenten">
                  <span class="section-kicker">Bestanden</span>
                  <h2>{{ docs.length }} document{{ docs.length === 1 ? '' : 'en' }}</h2>
                  <ul class="doc-list">
                    @for (doc of docs; track doc.id) {
                      <li>
                        <span class="pay-line__what"><b>{{ doc.kindLabel }}{{ doc.label ? ' · ' + doc.label : '' }}</b><small>{{ doc.originalFilename }} · {{ doc.addedAt | dateNl }}</small></span>
                        <button class="btn btn--sm" type="button" (click)="downloadDocument(doc)">Openen</button>
                      </li>
                    }
                  </ul>
                </section>
              }
            }

            <section class="card action-card" aria-labelledby="purchase-actions-title">
              <span class="section-kicker">Volgende actie</span>
              <h2 id="purchase-actions-title">
                {{ actionTitle(data.order.status, data.costing.lines.length) }}
              </h2>
              <p>{{ actionDescription(data.order.status, data.costing.lines.length) }}</p>
              <div class="action-card__buttons">
                <a class="btn btn--primary btn--block"
                   [routerLink]="['/purchasing', data.order.id, 'edit']">
                  {{ data.costing.lines.length ? 'Order bewerken' : 'Producten toevoegen' }}
                </a>
                <button class="btn btn--block" type="button" (click)="downloadPdf()">
                  PDF downloaden
                </button>
              </div>
            </section>
          </aside>
        </div>
      </div>
    } @else {
      <app-page-header title="Inkoop" [showBack]="true" [showBell]="false" />
      <div class="content purchase-view-page">
        <app-skeleton kind="card" [rows]="3" />
        <app-skeleton kind="lines" [rows]="4" />
      </div>
    }
  `,
  styles: [`
    :host{display:block;min-width:0}.purchase-view-page{max-width:1180px}.privacy-notice{margin-bottom:12px}

    .journey-hero{position:relative;margin-bottom:12px;padding:16px;border:1px solid var(--rose-line);border-radius:22px;background:linear-gradient(145deg,var(--surface),var(--rose-soft));box-shadow:var(--sh-1);overflow:hidden}
    .journey-hero:before{content:'';position:absolute;inset:0 auto 0 0;width:4px;background:var(--rose)}
    .journey-hero__top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.journey-hero__copy{min-width:0}
    :is(.eyebrow,.section-kicker){display:block;color:var(--rose);font-size:10px;font-weight:760;letter-spacing:.1em;text-transform:uppercase}
    .journey-hero h1{margin-top:3px;overflow:hidden;font-size:22px;text-overflow:ellipsis;white-space:nowrap}.journey-hero__copy p{color:var(--muted);font-size:12px}
    .status-pill{display:flex;flex:none;align-items:center;gap:6px;padding:6px 9px;border:1px solid var(--rose-line);border-radius:99px;background:var(--surface);color:var(--rose-dark);font-size:11px;font-weight:720}
    .status-pill__dot{width:7px;height:7px;border-radius:50%;background:currentColor}.status-pill--done{color:var(--ok)}

    .route-strip{display:flex;align-items:center;gap:7px;margin:15px 0;padding:10px;border:1px solid color-mix(in srgb,var(--line) 74%,transparent);border-radius:14px;background:color-mix(in srgb,var(--surface) 82%,transparent)}
    .route-stop{display:flex;min-width:0;align-items:center;gap:7px}.route-stop--end{text-align:right}.route-stop__dot{width:9px;height:9px;flex:none;border:2px solid var(--rose);border-radius:50%;background:var(--surface)}
    .route-stop span:last-child{display:flex;min-width:0;flex-direction:column}.route-stop small{color:var(--muted);font-size:9px;text-transform:uppercase}.route-stop strong{overflow:hidden;max-width:116px;font-size:11.5px;text-overflow:ellipsis;white-space:nowrap}
    .route-strip__line{height:1px;min-width:18px;flex:1;background:linear-gradient(90deg,var(--rose-line),var(--rose))}
    .journey-stepper{margin:0 0 15px}.overview-facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;border:1px solid var(--line);border-radius:14px;background:var(--line);overflow:hidden}
    .overview-fact--total strong{color:var(--rose-dark)}
    .payments-card{padding:14px 16px}.payments-card h2{margin-top:2px;font-size:16px}.payments-card p{margin-top:4px;color:var(--muted);font-size:12px}.payments-meter{height:6px;margin:10px 0;border-radius:999px;background:var(--line);overflow:hidden}.payments-meter__fill{height:100%;background:var(--ok,#2e7d4f);border-radius:999px}.payments-list{list-style:none;margin:6px 0 0;padding:0;border-top:1px solid var(--line)}.payments-list li{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--line)}.payments-list li:last-child{border-bottom:0}.payments-list__what{display:grid;min-width:0}.payments-list__what b{font-size:12.5px;font-weight:650}.payments-list__what small{color:var(--muted);font-size:11px}.payments-list__amount{font-weight:700;font-size:13px}
    .pay-stream{margin-top:10px;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2)}.pay-stream__head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.pay-stream__head>span{display:grid;min-width:0}.pay-stream__head b{font-size:13px}.pay-stream__head small{color:var(--muted);font-size:11px}.pay-stream__head .num{text-align:right}.pay-stream .payments-meter{margin:8px 0 4px}.pay-line{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:8px;padding:6px 0;border-top:1px solid var(--line)}.pay-line__what{display:grid;min-width:0}.pay-line__what b{font-size:12.5px;font-weight:650}.pay-line__what small{color:var(--muted);font-size:11px}.pay-line__amount{font-weight:700;font-size:13px}.pay-ours{margin-top:10px;color:var(--muted);font-size:11.5px}.doc-list{list-style:none;margin:8px 0 0;padding:0;border-top:1px solid var(--line)}.doc-list li{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid var(--line)}.doc-list li:last-child{border-bottom:0}
.po-attention{display:flex;align-items:flex-start;gap:10px;margin:12px 0;padding:10px 12px;border:1px solid #eddcb9;border-radius:12px;background:var(--warn-soft)}.po-attention__body{display:grid;gap:2px;min-width:0;font-size:12.5px;color:var(--ink-2)}.po-attention__body b{color:var(--warn);font-size:11px;letter-spacing:.06em;text-transform:uppercase}.attention-dot{display:inline-grid;place-items:center;flex:none;min-width:20px;height:20px;padding:0 5px;border-radius:999px;background:var(--warn);color:#fff;font-size:11px;font-weight:800;line-height:1}
    .capacity-card__percentage.fill-pct--full{color:var(--ok)}
    .overview-fact{min-width:0;padding:9px 10px;background:var(--surface)}.overview-fact span{display:block;color:var(--muted);font-size:9px;text-transform:uppercase}.overview-fact strong{display:block;overflow:hidden;font-size:11.5px;text-overflow:ellipsis;white-space:nowrap}

    .capacity-card{margin-bottom:12px;padding:14px;overflow:hidden}.capacity-card__top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.capacity-card h2{font-size:16px}.capacity-card__top p{color:var(--muted);font-size:11px}.capacity-card__percentage{color:var(--rose);font-size:25px;line-height:1}.capacity-card__percentage--over{color:var(--danger)}
    .capacity-meter{height:11px;margin-top:13px}.capacity-card__footer{display:flex;flex-wrap:wrap;justify-content:space-between;gap:6px;margin-top:9px;color:var(--muted);font-size:11px}.capacity-state{display:flex;align-items:center;gap:5px;font-weight:680}.capacity-state--ok{color:var(--ok)}.capacity-state--danger{color:var(--danger)}
  `, `
    :is(.view-main,.view-sidebar){min-width:0}:is(.view-main,.view-sidebar)>.card+.card{margin-top:12px}.view-sidebar{margin-top:12px}
    :is(.products-card,.details-card,.cost-card,.action-card){overflow:hidden}.section-heading{display:flex;min-height:76px;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid var(--line)}
    .section-number{display:grid;width:34px;height:34px;flex:0 0 34px;place-items:center;border:1px solid var(--rose-line);border-radius:11px;background:var(--rose-soft);color:var(--rose-dark);font-weight:760}
    .section-heading__copy{display:block;min-width:0;flex:1}.section-heading h2{font-size:15px}.section-heading__copy>span:last-child{display:block;overflow:hidden;color:var(--muted);font-size:11px;text-overflow:ellipsis;white-space:nowrap}
    .section-heading .per-toggle{flex:none}.section-heading .per-toggle button{padding-inline:8px;font-size:10px}

    .purchase-line{padding:14px;border-bottom:1px solid var(--line)}.purchase-line:last-child{border:0}.purchase-line__identity{display:grid;grid-template-columns:48px minmax(0,1fr);align-items:center;gap:10px}
    .purchase-line__photo{width:48px;height:48px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2);object-fit:cover}.purchase-line__photo--empty{display:grid;place-items:center;color:var(--muted);font-size:20px}
    .purchase-line__copy{display:flex;min-width:0;flex-direction:column}.purchase-line__copy small{color:var(--rose);font-size:9px;font-weight:720;text-transform:uppercase}.purchase-line__copy strong{overflow:hidden;font-size:14px;text-overflow:ellipsis;white-space:nowrap}.purchase-line__copy>span{color:var(--muted);font-size:11px}
    .line-facts{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;margin-top:10px;border:1px solid var(--line);border-radius:11px;background:var(--line);overflow:hidden}.line-facts>span{display:flex;min-width:0;flex-direction:column;padding:7px 8px;background:var(--surface-2)}.line-facts small{color:var(--muted);font-size:8.5px;text-transform:uppercase}.line-facts strong{overflow:hidden;font-size:11px;text-overflow:ellipsis;white-space:nowrap}
    .line-breakdown-toggle{display:flex;width:100%;min-height:48px;align-items:center;gap:8px;margin-top:9px;padding:7px 9px;border:1px solid var(--line);border-radius:12px;background:var(--surface);color:var(--ink);font:inherit;text-align:left;cursor:pointer}.line-breakdown-toggle>span:first-child{display:flex;min-width:0;flex:1;flex-direction:column}.line-breakdown-toggle small{color:var(--muted);font-size:9px}.line-breakdown-toggle strong{font-size:11px}.line-breakdown-toggle__total{color:var(--rose);font-size:12px;font-weight:760}.line-breakdown-toggle svg{flex:none;color:var(--muted);transition:transform .18s}.line-breakdown-toggle svg.chevron-open{transform:rotate(180deg)}
    .line-breakdown{margin-top:7px;padding:5px 10px 8px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2);animation:rise .18s ease}.line-breakdown .stat-row{padding:4px 0;font-size:11.5px}.line-breakdown small,.cost-stage small{display:block;color:var(--muted);font-size:9px}.line-breakdown__subtotal{border-top:1px solid var(--line)}
    .product-empty{padding:34px 18px;text-align:center}.product-empty__art{display:grid;width:64px;height:64px;margin:0 auto 12px;place-items:center;border:1px dashed var(--rose-mid);border-radius:20px;background:var(--rose-soft);color:var(--rose-dark);font-size:28px}.product-empty h3{font-size:16px}.product-empty p{max-width:360px;margin:4px auto 15px;color:var(--muted);font-size:12px}
  `, `
    .details-grid{display:grid;gap:1px;background:var(--line)}.detail-item{display:flex;min-width:0;flex-direction:column;padding:12px 14px;background:var(--surface)}.detail-item>span{color:var(--muted);font-size:9.5px;text-transform:uppercase}.detail-item strong{overflow-wrap:anywhere;font-size:12.5px}.detail-item small{color:var(--muted);font-size:10px}.detail-item--supplier app-supplier-address{margin-top:3px;color:var(--ink-2);font-size:10.5px}.detail-note{font-weight:500;white-space:pre-wrap}.internal-detail{background:var(--rose-soft)}

    .cost-card{border-color:var(--rose-line)}.cost-card__head{display:flex;min-height:76px;align-items:center;justify-content:space-between;gap:12px;padding:14px;border-bottom:1px solid var(--rose-line);background:linear-gradient(145deg,var(--surface),var(--rose-soft))}.cost-card h2{font-size:16px}.internal-badge{padding:5px 8px;border:1px solid var(--rose-line);border-radius:99px;background:var(--surface);color:var(--rose-dark);font-size:10px;font-weight:760;text-transform:uppercase}.cost-card__body{padding:14px}.cost-card .cost-hero{margin-top:0}.cost-stage{padding:8px 0}.cost-stage+.cost-stage{border-top:1px solid var(--line)}.cost-stage__label{display:block;margin-bottom:3px;color:var(--rose);font-size:9px;font-weight:760;letter-spacing:.08em;text-transform:uppercase}.cost-stage .stat-row{padding:4px 0;font-size:11.5px}.cost-stage__subtotal{border-top:1px solid var(--line);font-weight:680}
    .safe-card{display:flex;align-items:flex-start;gap:10px;padding:14px}.safe-card__icon{display:grid;width:34px;height:34px;flex:none;place-items:center;border-radius:11px;background:var(--ok-soft);color:var(--ok);font-weight:760}.safe-card h2{font-size:14px}.safe-card p{color:var(--muted);font-size:11px}
    .action-card{padding:14px}.action-card h2{margin-top:2px;font-size:16px}.action-card>p{margin-top:3px;color:var(--muted);font-size:11.5px}.action-card__buttons{display:grid;gap:7px;margin-top:13px}

    @media(min-width:560px){.overview-facts{grid-template-columns:repeat(3,1fr)}.details-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.detail-item--wide{grid-column:1/-1}.purchase-line__identity{grid-template-columns:52px minmax(0,1fr)}}
    @media(min-width: 680px){.journey-hero,.capacity-card{padding:18px}.section-heading{padding-inline:18px}.purchase-line{padding:16px 18px}.cost-card__head,.cost-card__body,.action-card{padding:18px}.route-stop strong{max-width:220px}}
    @media(min-width:680px){.view-layout{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(250px,.72fr);gap:16px;align-items:start}.view-sidebar{margin-top:0}}
  `],
})
export class PurchaseView {
  readonly containerLabel = containerLabel;

  private readonly sourcing = inject(SourcingApi);
  private readonly catalog = inject(CatalogApi);
  private readonly route = inject(ActivatedRoute);
  private readonly ui = inject(Ui);

  readonly view = signal<PurchaseOrderView | null>(null);
  readonly payments = signal<PurchasePayment[] | null>(null);
  readonly documents = signal<PurchaseDocument[] | null>(null);
  readonly supplierOwed = computed(() => this.view()?.payable?.supplierEur ?? this.view()?.costing.totals.goodsEur ?? 0);
  readonly logisticsOwed = computed(() => this.view()?.payable?.logisticsEur ?? 0);
  readonly owedAll = computed(() => this.supplierOwed() + this.logisticsOwed());
  readonly paidAll = computed(() => (this.payments() ?? []).reduce((sum, payment) => sum + payment.amountEur, 0));
  readonly openAll = computed(() => Math.max(0, this.owedAll() - this.paidAll()));
  paymentsTo(payee: 'SUPPLIER' | 'LOGISTICS'): PurchasePayment[] {
    return (this.payments() ?? []).filter((payment) => (payment.payee ?? 'SUPPLIER') === payee);
  }
  paidTo(payee: 'SUPPLIER' | 'LOGISTICS'): number {
    return this.paymentsTo(payee).reduce((sum, payment) => sum + payment.amountEur, 0);
  }
  pct(paid: number, owed: number): number {
    return owed > 0 ? Math.min(100, Math.round((paid / owed) * 100)) : 0;
  }
  async downloadDocument(doc: PurchaseDocument): Promise<void> {
    try { saveBlob(await this.sourcing.documentFile(doc.orderId, doc.id), doc.originalFilename); }
    catch { this.ui.toast('Document openen mislukt', 'err'); }
  }
  private readonly products = signal<Product[]>([]);
  private readonly suppliers = signal<Supplier[]>([]);

  readonly statusSteps = [
    { value: 'CONCEPT', label: 'Concept' },
    { value: 'BESTELD', label: 'Besteld' },
    { value: 'ONDERWEG', label: 'Vertrokken' },
    { value: 'ONTVANGEN', label: 'Ontvangen' },
  ];


  /** Cost breakdown as totals or per piece. */
  readonly perPiece = signal(true);

  /** Two decimals for totals, four for per-piece - tiny numbers need them. */
  readonly decimals = computed(() => this.perPiece() ? 4 : 2);

  /** Which product line shows its cost build-up; null is all folded. */
  readonly openLine = signal<number | null>(null);

  constructor() {
    const id = +(this.route.snapshot.paramMap.get('id') ?? 0);
    void this.load(id);
  }

  readonly stockLocations = signal<StockLocation[]>([]);

  receivingLocationName(id: number | null | undefined): string {
    const locations = this.stockLocations();
    const main = locations.find((location) => location.code === 'MAIN') ?? locations[0];
    return locations.find((location) => location.id === (id ?? main?.id))?.name ?? 'Magazijn';
  }

  private async load(id: number): Promise<void> {
    void this.sourcing.payments(id).then((list) => this.payments.set(list)).catch(() => this.payments.set([]));
    void this.sourcing.documents(id).then((list) => this.documents.set(list)).catch(() => this.documents.set([]));
    const [view, products, suppliers] = await Promise.all([
      this.sourcing.purchaseOrder(id), this.catalog.products(), this.sourcing.suppliers()]);
    this.catalog.stockLocations().then((locations) => this.stockLocations.set(locations)).catch(() => undefined);
    this.view.set(view);
    this.products.set(products);
    this.suppliers.set(suppliers);
  }

  amt(value: number, line: { quantity: number }): number {
    return this.perPiece() && line.quantity > 0 ? value / line.quantity : value;
  }

  /** Every line priced delivered duty paid: the road and the customs are in the price. */
  readonly isDdp = computed(() => {
    const lines = this.view()?.order.lines ?? [];
    return lines.length > 0 && lines.every((line) => (line.priceBasis ?? 'EXW') === 'DDP');
  });

  /** Transport, duty, handling and Enrosed kost as a share of the goods. */
  overheadPct(totals: { totalEur: number; goodsEur: number }): number {
    return totals.goodsEur > 0 ? Math.round(((totals.totalEur - totals.goodsEur) / totals.goodsEur) * 100) : 0;
  }

  toggleLine(productId: number): void {
    this.openLine.set(this.openLine() === productId ? null : productId);
  }

  linePanelId(productId: number): string {
    return `purchase-cost-line-${productId}`;
  }

  supplier(): Supplier | null {
    const id = this.view()?.order.supplierId;
    return this.suppliers().find((supplier) => supplier.id === id) ?? null;
  }

  supplierName(): string {
    return this.supplier()?.name ?? 'Onbekende leverancier';
  }

  readonly costLabels = computed(() => purchaseCostLabels(this.view(), this.supplier()));

  usdToEurRate(): number {
    return effectiveUsdToEur(this.view()?.order);
  }

  photoOf(productId: number): string | null {
    const product = this.products().find((candidate) => candidate.id === productId);
    return product?.photos?.[0]?.url ?? null;
  }

  stepIndex(status: string): number {
    return this.statusSteps.findIndex((step) => step.value === status);
  }

  statusLabel(status: string): string {
    if (status === 'ONTVANGEN') return 'Ontvangen';
    if (status === 'ONDERWEG') return 'Vertrokken';
    if (status === 'BESTELD') return 'Besteld';
    return 'Concept';
  }

  actionTitle(status: string, lineCount: number): string {
    if (!lineCount) return 'Voeg eerst producten toe';
    if (status === 'ONTVANGEN') return 'Container afgerond';
    if (status === 'ONDERWEG') return 'Klaar voor ontvangst?';
    if (status === 'BESTELD') return 'Is de container vertrokken?';
    return 'Klaar om te bestellen?';
  }

  actionDescription(status: string, lineCount: number): string {
    if (!lineCount) {
      return 'Deze container is nog leeg. Voeg productregels toe voordat je de lading en kosten afrondt.';
    }
    if (status === 'ONTVANGEN') {
      return 'De voorraad is bijgeboekt. Je kunt de calculatie nog controleren of als PDF bewaren.';
    }
    if (status === 'ONDERWEG') {
      return 'Controleer bij aankomst de werkelijk ontvangen aantallen voordat je de voorraad bijboekt.';
    }
    if (status === 'BESTELD') {
      return 'Zet de order op Vertrokken zodra het schip vaart; dan valt de volgende betaling en start de tracking.';
    }
    return 'Controleer lading, containerruimte en kosten voordat je de bestelling vastlegt.';
  }

  fillWidth(percent: number): number {
    return Math.min(100, Math.max(0, percent));
  }

  async downloadPdf(): Promise<void> {
    const data = this.view();
    if (!data) return;
    const blob = await this.sourcing.purchasePdf(data.order.id, true);
    saveBlob(blob, `${data.order.number}.pdf`);
    this.ui.toast('PDF gedownload — Enrosed kost als aparte regel');
  }
}
