import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthImage } from '../../core/api/auth-image';
import { PricedLine, SalesOrder, SalesOrderView } from '../../core/api/models';
import { PageHeader } from '../../shared/page-header';
import { ProductPicker } from '../../shared/product-picker';
import { DateField } from '../../shared/date-field';
import { WeekField } from '../../shared/week-field';
import { Sheet, escapeHtml } from '../../shared/ui';
import { messageOf } from '../../core/api/errors';
import {
  CbmPipe, DateNlPipe, DateTimeNlPipe, EurPipe, NumPipe, PctPipe, WeekNlPipe,
} from '../../shared/pipes';
import { ShippingPlanner } from './shipping-planner';
import { SalesPdfSheet } from './sales-pdf-sheet';
import { SalesEditor } from './sales-editor';
import { salesDocumentLabel } from './sales-list-swipe';

type RailTab = 'order' | 'delivery' | 'check' | 'status';

type DeskRow =
  | { kind: 'section'; key: string; label: string; count: number }
  | { kind: 'group'; key: string; label: string; lines: PricedLine[]; pieces: number; cartons: number;
      cbm: number; net: number; leadPhoto: string | null }
  | { kind: 'line'; key: string; line: PricedLine; variant: boolean };

interface JourneyStep {
  label: string;
  state: 'done' | 'now' | 'todo';
}

/**
 * The quote or invoice on a desk: one screen, no scrolling to find things.
 *
 * A phone walks the seller through steps; a desk shows the whole document
 * at once. The dark hero keeps status, customer and the live figures in
 * view, the products are a real table you can key through, and everything
 * else - customer and terms, transport, the price build-up, sending and
 * the history - lives in one tabbed rail beside it. The logic is the phone
 * editor's, untouched: only the room it gets is different.
 */
@Component({
  selector: 'app-sales-desk',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, AuthImage, PageHeader, Sheet, ProductPicker, DateField, WeekField,
            ShippingPlanner, SalesPdfSheet,
            EurPipe, NumPipe, PctPipe, CbmPipe, DateNlPipe, DateTimeNlPipe, WeekNlPipe],
  template: `
    @if (view(); as data) {
      <app-page-header [title]="data.order.number" [subtitle]="customerName()"
                       [showBack]="true" [showBell]="false"
                       [titleEditable]="canEdit()"
                       (titleChange)="patch({ number: $event })">
        @if (canEdit() && (dirty() || saving())) {
          <button class="btn btn--primary btn--sm" type="button" [disabled]="saving()" (click)="save()">
            {{ saving() ? 'Bezig…' : 'Opslaan' }}
          </button>
        }
        <button class="btn btn--sm" type="button" (click)="openPdfSheet()">PDF</button>
        @if (canCancel()) {
          <button class="btn btn--sm" type="button" [disabled]="busy()" (click)="openCancel()">
            {{ websiteRequest(data.order) && !data.order.sentAt ? 'Aanvraag annuleren' : 'Annuleren' }}
          </button>
        }
        @if (data.order.status === 'AFGEWEZEN' || data.order.status === 'VERLOPEN' || data.order.status === 'GEANNULEERD') {
          <button class="btn btn--primary btn--sm" type="button" [disabled]="busy()" (click)="reopen()">Heropenen</button>
        } @else if (!isInvoiceDoc() && (data.order.status === 'CONCEPT'
                   || data.order.status === 'VERZONDEN' || data.order.status === 'BEKEKEN')) {
          <button class="btn btn--primary btn--sm" type="button" [disabled]="sending() || dirty()"
                  [title]="dirty() ? 'Sla eerst op' : ''" (click)="openSend()">
            {{ data.order.sentAt ? 'Opnieuw versturen' : 'Versturen' }}
          </button>
        } @else if (!isInvoiceDoc() && data.order.status === 'GEACCEPTEERD') {
          <button class="btn btn--primary btn--sm" type="button" [disabled]="invoiceBusy()" (click)="makeInvoice(data)">
            {{ invoiceBusy() ? 'Factuur maken…' : 'Factuur maken' }}
          </button>
        }
      </app-page-header>

      <div class="content desk">
        <!-- ============================ hero: who, how far, and the figures that matter -->
        <header class="desk-hero">
          <div class="desk-hero__top">
            <div class="desk-hero__who">
              <span class="desk-hero__eyebrow">{{ isInvoiceDoc() ? 'Verkoopfactuur' : 'Verkoopofferte' }}@if (websiteRequest(data.order)) { · websiteaanvraag }</span>
              <h1>{{ customerName() }}</h1>
              <p>{{ orderCountryName() || 'Nog geen leverland' }} · {{ data.order.incoterm || 'geen incoterm' }}
                · {{ paymentChoice() ? data.order.paymentTerms : 'betaalvoorwaarden van de klant' }}</p>
              <p class="desk-hero__meta">{{ data.order.orderDate | dateNl }}
                @if (isInvoiceDoc()) { · vervalt {{ data.order.invoiceDueDate ? (data.order.invoiceDueDate | dateNl) : '—' }} }
                @else { · geldig tot {{ data.order.validUntil | dateNl }} }
                @if (lastEvent(); as event) { · {{ event.summary }} ({{ event.at | dateTimeNl }}) }</p>
            </div>
            <div class="desk-status" role="group" aria-label="Voortgang van het document">
              @if (terminalLabel(data.order); as terminal) {
                <span class="desk-status__step desk-status__step--now"><i aria-hidden="true">!</i>{{ terminal }}</span>
              }
              @for (step of journey(); track step.label; let last = $last) {
                <span class="desk-status__step"
                      [class.desk-status__step--done]="step.state === 'done'"
                      [class.desk-status__step--now]="step.state === 'now'">
                  <i aria-hidden="true">@if (step.state === 'done') { ✓ } @else { {{ $index + 1 }} }</i>{{ step.label }}
                </span>
                @if (!last) { <span class="desk-status__line" [class.desk-status__line--done]="step.state === 'done'" aria-hidden="true"></span> }
              }
            </div>
          </div>

          <div class="desk-kpis" aria-label="Kerncijfers">
            <div class="desk-kpi">
              <small>Producten</small>
              <strong>{{ data.priced.totals.pieces | num }}</strong>
              <span>{{ data.priced.lines.length }} {{ data.priced.lines.length === 1 ? 'regel' : 'regels' }} · {{ data.priced.totals.cartons | num }} dozen</span>
            </div>
            <button class="desk-kpi desk-kpi--button" type="button" (click)="railTab.set('delivery')">
              <small>Levering</small>
              @if (isLooseCartons(data)) {
                <strong>{{ data.priced.totals.cbm | cbm }}</strong>
                <span>losse dozen</span>
              } @else {
                <strong>{{ data.priced.totals.palletsManual || data.priced.totals.palletsStrict }} {{ (data.priced.totals.palletsManual || data.priced.totals.palletsStrict) === 1 ? 'pallet' : 'pallets' }}</strong>
                <span>{{ data.order.pallets.length ? 'zelf ingedeeld' : 'automatisch' }} · {{ data.priced.totals.cbm | cbm }}</span>
              }
            </button>
            <button class="desk-kpi desk-kpi--button" type="button" (click)="railTab.set('delivery')"
                    [class.is-warn]="data.order.freight === 'TE_BEPALEN'">
              <small>Verzending</small>
              @if (data.order.freight === 'TE_BEPALEN') {
                <strong>te bepalen</strong>
              } @else {
                <strong>{{ data.priced.totals.freight + data.priced.totals.handling | eur: 0 }}</strong>
              }
              <span>{{ freightStrategyLabel(data) }}</span>
            </button>
            <button class="desk-kpi desk-kpi--button" type="button" (click)="railTab.set('check')">
              <small>Winst</small>
              <strong [class.is-ok]="data.priced.totals.marginEur > 0" [class.is-bad]="data.priced.totals.marginEur < 0">{{ data.priced.totals.marginEur | eur: 0 }}</strong>
              <span>{{ data.priced.totals.marginPct | pct: 0 }} van de goederen</span>
            </button>
            <button class="desk-kpi desk-kpi--total desk-kpi--button" type="button" (click)="railTab.set('check')">
              <small>{{ isInvoiceDoc() ? 'Factuurtotaal' : 'Offertetotaal' }}</small>
              <strong>{{ data.priced.totals.total | eur: 0 }}</strong>
              <span>{{ data.priced.totals.vatLegalMention ? 'btw verlegd' : 'excl. btw · ' + ((data.priced.totals.totalInclVat) | eur: 0) + ' incl.' }}</span>
            </button>
            @if (isInvoiceDoc()) {
              <button class="desk-kpi desk-kpi--go" type="button" [disabled]="invoiceBusy()" (click)="railTab.set('status')">
                <small>Volgende stap</small>
                <strong>{{ invoiceNextStep(data) }} ›</strong>
                <span>{{ data.order.goodsShippedAt ? 'bestelling verzonden ' + (data.order.goodsShippedAt | dateNl) : 'voorraad nog niet afgepunt' }}</span>
              </button>
            } @else if (data.order.status === 'GEACCEPTEERD') {
              <button class="desk-kpi desk-kpi--go" type="button" [disabled]="invoiceBusy()" (click)="makeInvoice(data)">
                <small>Volgende stap</small>
                <strong>Factuur maken ›</strong>
                <span>getekend door {{ data.order.signedByName || 'de klant' }}</span>
              </button>
            } @else if (sendIssues().length) {
              <button class="desk-kpi desk-kpi--go" type="button" (click)="railTab.set('status')">
                <small>Nog niet klaar</small>
                <strong>{{ sendIssues().length }} open {{ sendIssues().length === 1 ? 'punt' : 'punten' }} ›</strong>
                <span>{{ sendIssues()[0] }}</span>
              </button>
            } @else if (data.order.status === 'CONCEPT' || data.order.status === 'VERZONDEN' || data.order.status === 'BEKEKEN') {
              <button class="desk-kpi desk-kpi--go" type="button" [disabled]="sending() || dirty()" (click)="openSend()">
                <small>Volgende stap</small>
                <strong>{{ data.order.sentAt ? 'Opnieuw versturen' : 'Versturen' }} ›</strong>
                <span>{{ dirty() ? 'slaat eerst op' : (data.awaitingResend ? 'de klant wacht op de nieuwe versie' : 'klaar voor de klant') }}</span>
              </button>
            } @else {
              <div class="desk-kpi desk-kpi--total">
                <small>Status</small>
                <strong>{{ label(data.order.status) }}</strong>
                <span>{{ data.order.decidedAt ? (data.order.decidedAt | dateTimeNl) : '' }}</span>
              </div>
            }
          </div>
        </header>

        @if (pendingRevision(); as revision) {
          <div class="desk-attention" role="status">
            <b>⇄</b>
            <span><strong>De klant vraagt een wijziging</strong> · {{ revision.lines.length }} gewijzigde {{ revision.lines.length === 1 ? 'regel' : 'regels' }}@if (revision.proposedBy) { · {{ revision.proposedBy }} }</span>
            <button class="linklike" type="button" (click)="railTab.set('status')">Beoordelen ›</button>
          </div>
        } @else if (websiteRequest(data.order)) {
          <div class="desk-attention" role="status">
            <b>↗</b>
            <span><strong>Websiteaanvraag</strong> · controleer producten en dozen, klant en btw ({{ vatLabel(data.priced.totals.vatTreatment) }}), levering en vracht vóór het versturen</span>
            <button class="linklike" type="button" (click)="railTab.set('status')">Checklist ›</button>
          </div>
        } @else if (data.awaitingResend) {
          <div class="desk-attention" role="status">
            <b>⏳</b>
            <span><strong>Klant wacht op de nieuwe versie</strong> · voorstel overgenomen, nog niet verstuurd</span>
            <button class="linklike" type="button" [disabled]="dirty()" (click)="openSend()">Versturen ›</button>
          </div>
        }
        @if (saveError()) {
          <div class="alert alert--warn desk-alert" role="alert">
            <span class="alert__icon">!</span>
            <div class="grow"><b>Nog niet opgeslagen</b><div class="small">{{ saveError() }}</div></div>
            <button class="btn btn--sm" type="button" [disabled]="saving()" (click)="reloadLatestOrder()">Serverversie laden</button>
            <button class="btn btn--sm btn--primary" type="button" [disabled]="saving() || !dirty()" (click)="save()">Opnieuw opslaan</button>
          </div>
        } @else if (previewError()) {
          <div class="alert alert--warn desk-alert" role="alert">
            <span class="alert__icon">!</span>
            <div class="grow"><b>Prijsvoorbeeld is mogelijk verouderd</b><div class="small">{{ previewError() }}</div></div>
            <button class="btn btn--sm" type="button" (click)="retryPreview()">Opnieuw berekenen</button>
          </div>
        }
        @if (referenceError()) {
          <div class="alert alert--warn desk-alert" role="status">
            <span class="alert__icon">!</span>
            <div class="grow"><b>Keuzelijsten konden niet volledig laden</b><div class="small">{{ referenceError() }}</div></div>
            <button class="btn btn--sm" type="button" (click)="retryReference()">Opnieuw</button>
          </div>
        }
        @if (!canEdit()) {
          <div class="desk-lock" role="status">
            <span aria-hidden="true">✓</span>
            <span><b>Deze versie staat vast.</b> Klant, aantallen en prijzen veranderen niet meer; leverweken en vracht kun je nog aanvullen.</span>
            <button class="btn btn--sm" type="button" [disabled]="busy()" (click)="duplicate()">Nieuwe kopie</button>
          </div>
        }

        <div class="desk-body">
          <!-- ============================ the table: every line, keyed through -->
          <main class="desk-main">
            <div class="desk-table-bar">
              <div>
                <h2>Producten</h2>
                <p>{{ data.priced.lines.length ? (data.priced.totals.pieces | num) + ' stuks · ' + (data.priced.totals.cartons | num) + ' dozen · ' + (data.priced.totals.cbm | cbm) : 'Bouw het document regel voor regel op' }}</p>
              </div>
              <span class="per-toggle" role="group" aria-label="Winst tonen per">
                <button type="button" [class.on]="profitPerPiece()" [attr.aria-pressed]="profitPerPiece()" (click)="profitPerPiece.set(true)">Per stuk</button>
                <button type="button" [class.on]="!profitPerPiece()" [attr.aria-pressed]="!profitPerPiece()" (click)="profitPerPiece.set(false)">Per regel</button>
              </span>
              <button class="btn btn--primary btn--sm" type="button" [disabled]="!canEdit() || !available().length" (click)="openPicker()">
                <span aria-hidden="true">＋</span> Product
              </button>
            </div>

            @if (data.priced.lines.length) {
              <div class="desk-table-wrap">
              <table class="desk-table" [class.desk-table--editing]="canEdit()">
                <thead>
                  <tr>
                    <th class="c-product">Product</th>
                    <th class="c-qty">Aantal</th>
                    <th class="c-price">Stukprijs</th>
                    <th class="c-disc">Korting</th>
                    <th class="c-money">Netto</th>
                    <th class="c-money">{{ profitPerPiece() ? 'Winst / stuk' : 'Winst / regel' }}</th>
                    <th class="c-delivery">Levering</th>
                    @if (canEdit()) { <th class="c-act"><span class="sr-only">Acties</span></th> }
                  </tr>
                </thead>
                <tbody>
                @for (row of tableRows(); track row.key) {
                  @switch (row.kind) {
                    @case ('section') {
                      <tr class="desk-section__row"><th [attr.colspan]="canEdit() ? 8 : 7">{{ row.label }} <small>{{ row.count }} product{{ row.count === 1 ? '' : 'en' }}</small></th></tr>
                    }
                    @case ('group') {
                      <tr class="desk-group">
                        <td class="c-product">
                          <div class="desk-product">
                            @if (row.leadPhoto) {
                              <img class="desk-product__photo" [appAuthSrc]="row.leadPhoto" alt="" draggable="false" />
                            } @else {
                              <span class="desk-product__photo desk-product__photo--empty" aria-hidden="true">◈</span>
                            }
                            <span class="desk-product__copy">
                              <strong>{{ row.label }}</strong>
                              <small>Reeks · {{ row.lines.length }} varianten · {{ row.cartons | num }} dozen · {{ row.cbm | cbm }}</small>
                            </span>
                          </div>
                        </td>
                        <td class="c-qty num"><b>{{ row.pieces | num }}</b></td>
                        <td class="c-price"></td>
                        <td class="c-disc"></td>
                        <td class="c-money num c-money--total">{{ row.net | eur }}</td>
                        <td class="c-money"></td>
                        <td class="c-delivery"></td>
                        @if (canEdit()) { <td class="c-act"></td> }
                      </tr>
                    }
                    @case ('line') {
                      @let line = row.line;
                      <tr class="desk-row" [class.desk-row--variant]="row.variant">
                        <td class="c-product">
                          <div class="desk-product">
                            <a class="desk-product__photo-link" [routerLink]="['/products', line.productId]" [title]="line.description + ' openen'" tabindex="-1">
                              @if (line.photoUrl) {
                                <img class="desk-product__photo" [appAuthSrc]="line.photoUrl" alt="" draggable="false" />
                              } @else {
                                <span class="desk-product__photo desk-product__photo--empty" aria-hidden="true">{{ salesLineNumber(line.productId) }}</span>
                              }
                            </a>
                            <div class="desk-product__copy">
                              <a class="desk-product__name" [routerLink]="['/products', line.productId]" [title]="line.description + ' openen'">
                                <strong>{{ line.description }}</strong>
                              </a>
                              <div class="desk-product__meta">
                                <span>{{ line.sku }}</span>
                                <span>{{ line.cartons | num }} {{ line.cartons === 1 ? 'doos' : 'dozen' }} · {{ line.cbm | cbm }}</span>
                                @if (linePending()[line.productId]; as to) {
                                  <span class="is-warn" role="status">Volle doos: wordt {{ to | num }} st</span>
                                }
                                @if (line.nextTierAtQuantity) {
                                  <span>nog {{ line.nextTierAtQuantity - line.quantity | num }} st voor {{ line.nextTierPercent | pct: 0 }}</span>
                                }
                              </div>
                            </div>
                          </div>
                        </td>
                        <td class="c-qty num">
                          @if (canEdit()) {
                            <input class="input num right desk-cell" type="number" min="0" step="1" inputmode="numeric"
                                   [attr.aria-label]="'Aantal ' + line.description"
                                   [ngModel]="line.quantity" (ngModelChange)="setLineQuantity(line.productId, +$event)" />
                          } @else {
                            <b>{{ line.quantity | num }}</b>
                          }
                        </td>
                        <td class="c-price num">
                          @if (canEdit()) {
                            <input class="input num right desk-cell" type="number" min="0" step="0.01" inputmode="decimal"
                                   [attr.aria-label]="'Stukprijs ' + line.description"
                                   [ngModel]="line.unitPrice" (ngModelChange)="setLine(line.productId, { unitPriceEur: +$event })" />
                          } @else {
                            <b>{{ line.unitPrice | eur: 2 }}</b>
                          }
                          @if (line.tierPercent) { <small>staffel −{{ line.tierPercent | pct: 1 }}</small> }
                        </td>
                        <td class="c-disc num">
                          @if (canEdit()) {
                            <div class="desk-disc">
                              <input class="input num right desk-cell" type="number" min="0" max="100" step="0.5" inputmode="decimal"
                                     [attr.aria-label]="'Extra korting ' + line.description"
                                     [ngModel]="line.manualPercent || null" placeholder="–"
                                     (ngModelChange)="setLine(line.productId, { manualDiscountPct: $event === '' || $event === null ? 0 : +$event })" />
                              <span class="desk-disc__unit">%</span>
                            </div>
                          } @else if (line.discountPct) {
                            <b>−{{ line.discountPct | pct: 1 }}</b>
                          } @else {
                            <span class="muted">–</span>
                          }
                        </td>
                        <td class="c-money num c-money--total">
                          <b>{{ line.net | eur }}</b>
                          <small>{{ line.netUnitPrice | eur: 2 }} / st</small>
                        </td>
                        <td class="c-money num">
                          <button class="desk-total desk-total--profit" type="button" (click)="openCostSheet(line)"
                                  [class.is-bad]="(profitPerPiece() ? marginPerUnit(line) : line.marginEur) < 0"
                                  [title]="'Gelande kost van ' + line.description">
                            <b>{{ (profitPerPiece() ? marginPerUnit(line) : line.marginEur) | eur: profitPerPiece() ? 2 : 0 }}</b>
                            <small>kost {{ line.landedUnitCost | eur: 2 }} <i aria-hidden="true">›</i></small>
                          </button>
                        </td>
                        <td class="c-delivery">
                          <span class="desk-delivery"
                                [class.desk-delivery--ok]="line.inStock || line.deliveryWeek"
                                [class.desk-delivery--bad]="line.inventoryKnown && !line.inStock && !line.deliveryWeek">
                            @if (!line.inventoryKnown) { <b>Voorraad onbevestigd</b> }
                            @else if (line.inStock) { <b>Op voorraad</b><small>vanaf {{ line.deliveryDate | dateNl }}</small> }
                            @else if (line.deliveryWeek) { <b>{{ line.deliveryWeek | weekNl: 'short' }}</b><small>{{ line.shortfall ?? 0 | num }} st te leveren</small> }
                            @else { <b>Levertermijn nodig</b><small>{{ line.shortfall ?? 0 | num }} st niet op voorraad</small> }
                          </span>
                          @if (canEditTerms()) {
                            <button class="desk-product__link" type="button" (click)="toggleDelivery(line.productId)"
                                    [attr.aria-expanded]="editingDelivery() === line.productId">
                              {{ editingDelivery() === line.productId ? 'Sluiten' : (line.deliveryWeek ? 'Week wijzigen' : 'Leverweek') }}
                            </button>
                          }
                          @if (editingDelivery() === line.productId) {
                            <div class="desk-week">
                              <app-week-field [fieldId]="'dw-' + line.productId" [value]="weekOf(line.productId)"
                                              (valueChange)="setLine(line.productId, { deliveryWeek: $event })" />
                            </div>
                          }
                        </td>
                        @if (canEdit()) {
                          <td class="c-act">
                            <button class="desk-remove" type="button" [attr.aria-label]="line.description + ' verwijderen'"
                                    (click)="removeLine(line.productId)">×</button>
                          </td>
                        }
                      </tr>
                    }
                  }
                }
                </tbody>
                <tfoot>
                  <tr>
                    <th class="c-product">Totaal</th>
                    <th class="c-qty">{{ data.priced.totals.pieces | num }}</th>
                    <th class="c-price"></th>
                    <th class="c-disc">@if (data.priced.totals.lineDiscountTotal) { −{{ data.priced.totals.lineDiscountTotal | eur: 0 }} }</th>
                    <th class="c-money">{{ data.priced.totals.subtotal | eur }}</th>
                    <th class="c-money" [class.is-bad]="data.priced.totals.marginEur < 0">{{ data.priced.totals.marginEur | eur: 0 }}</th>
                    <th class="c-delivery"></th>
                    @if (canEdit()) { <th class="c-act"></th> }
                  </tr>
                </tfoot>
              </table>
              </div>
            } @else {
              <div class="desk-empty">
                <div class="desk-empty__art" aria-hidden="true">＋</div>
                <h3>Nog geen producten</h3>
                <p>Voeg een product toe, kies het aantal en de prijs wordt meteen berekend.</p>
                <button class="btn btn--primary" type="button" [disabled]="!canEdit() || !available().length" (click)="openPicker()">Eerste product toevoegen</button>
              </div>
            }
          </main>

          <!-- ============================ the rail: everything that is not a product line -->
          <aside class="desk-rail" aria-label="Documentgegevens">
            <div class="desk-tabs" role="tablist">
              <button type="button" role="tab" [class.on]="railTab() === 'order'" [attr.aria-selected]="railTab() === 'order'" (click)="railTab.set('order')">Klant</button>
              <button type="button" role="tab" [class.on]="railTab() === 'delivery'" [attr.aria-selected]="railTab() === 'delivery'" (click)="railTab.set('delivery')">
                Levering @if (data.order.freight === 'TE_BEPALEN' || (!isLooseCartons(data) && data.priced.totals.unassignedCartons > 0)) { <i class="desk-tabs__dot" aria-hidden="true"></i> }
              </button>
              <button type="button" role="tab" [class.on]="railTab() === 'check'" [attr.aria-selected]="railTab() === 'check'" (click)="railTab.set('check')">
                Prijs @if (data.order.countryCode && data.priced.validation.minOrderValue > 0 && !data.priced.validation.meetsMinimum) { <i class="desk-tabs__dot" aria-hidden="true"></i> }
              </button>
              <button type="button" role="tab" [class.on]="railTab() === 'status'" [attr.aria-selected]="railTab() === 'status'" (click)="railTab.set('status')">
                {{ isInvoiceDoc() ? 'Status' : 'Versturen' }} @if (pendingRevision() || (!isInvoiceDoc() && sendIssues().length && data.order.status === 'CONCEPT')) { <i class="desk-tabs__dot" aria-hidden="true"></i> }
              </button>
            </div>

            <div class="desk-panel">
              @switch (railTab()) {
                @case ('order') {
                  <fieldset class="desk-form form-lock" [disabled]="!canEdit()">
                    <p class="desk-form__group">Klant &amp; document</p>
                    <div class="field">
                      <label class="req" for="sd-customer">Klant</label>
                      <select class="select" id="sd-customer" [ngModel]="data.order.customerId" (ngModelChange)="setCustomer(+$event)">
                        @for (customer of customers(); track customer.id) {
                          <option [ngValue]="customer.id">{{ customer.company }}</option>
                        }
                      </select>
                      @if (customerVatNumber()) { <span class="hint">BTW {{ customerVatNumber() }} · {{ vatLabel(data.priced.totals.vatTreatment) }}</span> }
                      @else { <span class="hint">Geen BTW-nummer bij de klant · {{ vatLabel(data.priced.totals.vatTreatment) }}</span> }
                    </div>
                    <div class="desk-form__duo">
                      <div class="field">
                        <label class="req" for="sd-country">Land van levering</label>
                        <select class="select" id="sd-country" [ngModel]="data.order.countryCode" (ngModelChange)="patch({ countryCode: $event })">
                          @for (country of countries(); track country.code) {
                            <option [ngValue]="country.code">{{ country.name }}</option>
                          }
                        </select>
                      </div>
                      <div class="field">
                        <label for="sd-incoterm">Incoterm</label>
                        <select class="select" id="sd-incoterm" [ngModel]="data.order.incoterm" (ngModelChange)="patch({ incoterm: $event })">
                          @for (term of incoterms; track term) { <option [ngValue]="term">{{ term }}</option> }
                        </select>
                      </div>
                    </div>
                    <div class="field">
                      <label for="sd-pay">Betaalvoorwaarden <span class="opt"></span></label>
                      <select class="select" id="sd-pay" [ngModel]="paymentChoice()" (ngModelChange)="pickPaymentTerms($event)">
                        <option value="">Van de klant</option>
                        @for (term of paymentTermsList; track term) { <option [value]="term">{{ term }}</option> }
                        <option value="__other__">Anders…</option>
                      </select>
                      @if (customPaymentTerms()) {
                        <input class="input mt-8" aria-label="Eigen betaalvoorwaarden" placeholder="Eigen voorwaarden…"
                               [ngModel]="data.order.paymentTerms" (ngModelChange)="patch({ paymentTerms: $event })" />
                      }
                    </div>
                    <div class="desk-form__duo">
                      <div class="field">
                        <label for="sd-date">Datum</label>
                        <app-date-field fieldId="sd-date" [value]="data.order.orderDate" (valueChange)="patch({ orderDate: $event })" />
                      </div>
                      @if (isInvoiceDoc()) {
                        <div class="field">
                          <label for="sd-due">Vervaldatum</label>
                          <app-date-field fieldId="sd-due" [value]="data.order.invoiceDueDate ?? ''" (valueChange)="patch({ invoiceDueDate: $event })" />
                        </div>
                      } @else {
                        <div class="field">
                          <label for="sd-valid">Geldig tot</label>
                          <app-date-field fieldId="sd-valid" [value]="data.order.validUntil" (valueChange)="patch({ validUntil: $event })" />
                        </div>
                      }
                    </div>
                    <p class="desk-form__group">Notities</p>
                    <div class="field">
                      <label for="sd-notes">Bericht op het document <span class="opt"></span></label>
                      <textarea class="textarea" id="sd-notes" rows="3" [ngModel]="data.order.notes" (ngModelChange)="patch({ notes: $event })"
                                placeholder="Bijvoorbeeld een afspraak of persoonlijke toelichting."></textarea>
                      <span class="hint">Zichtbaar voor de klant.</span>
                    </div>
                    <div class="field">
                      <label for="sd-internal">Interne notities <span class="opt"></span></label>
                      <textarea class="textarea" id="sd-internal" rows="3" [ngModel]="visibleInternalNotes(data.order)"
                                (ngModelChange)="setVisibleInternalNotes($event)" placeholder="Wat moet het team over deze order weten?"></textarea>
                      <span class="hint">Alleen zichtbaar in het ERP.</span>
                    </div>
                  </fieldset>
                }

                @case ('delivery') {
                  <div class="desk-form">
                    <p class="desk-form__group">Transport</p>
                    <dl class="desk-facts">
                      <div><dt>Lading</dt><dd>
                        @if (isLooseCartons(data)) { {{ data.priced.totals.cartons | num }} losse dozen · {{ data.priced.totals.cbm | cbm }} }
                        @else { {{ data.priced.totals.palletsManual || data.priced.totals.palletsStrict }} {{ (data.priced.totals.palletsManual || data.priced.totals.palletsStrict) === 1 ? 'pallet' : 'pallets' }}<small>{{ data.order.pallets.length ? 'zelf ingedeeld' : 'automatische indeling' }} · {{ data.priced.totals.cartons | num }} dozen · {{ data.priced.totals.weightKg | num: 0 }} kg</small> }
                      </dd></div>
                      <div><dt>Vracht</dt><dd>
                        @if (data.order.freight === 'TE_BEPALEN') { <span class="danger-text">nog te bepalen</span><small>de klant ziet geen bedrag</small> }
                        @else { {{ data.priced.totals.freight | eur }}<small>{{ freightStrategyLabel(data) }} · {{ freightBasisLabel(data) }}</small> }
                      </dd></div>
                      @if (transitDays(); as days) {
                        <div><dt>Transit</dt><dd>± {{ days }} {{ days === 1 ? 'werkdag' : 'werkdagen' }}<small>naar {{ orderCountryName() }}</small></dd></div>
                      }
                      <div><dt>Levering</dt><dd>{{ deliverySummary(data) }}</dd></div>
                    </dl>
                    @if (!isLooseCartons(data) && data.priced.totals.unassignedCartons > 0) {
                      <p class="hint hint--warn">{{ data.priced.totals.unassignedCartons }} dozen zijn nog niet aan een pallet toegewezen.</p>
                    }
                    @if (canEdit()) {
                      <button class="btn btn--block" type="button" (click)="palletSheet.set(true)">Transport &amp; levering aanpassen</button>
                    } @else if (canEditTerms()) {
                      <p class="desk-form__group">Vracht aanvullen</p>
                      <label class="check-option">
                        <input type="checkbox" [checked]="data.order.freight === 'TE_BEPALEN'" (change)="setFreightPending($any($event.target).checked)" />
                        <span><strong>Later bepalen</strong><small>De klant ziet geen bedrag; vracht telt nog niet mee.</small></span>
                      </label>
                      <div class="field">
                        <label for="sd-freight-strategy">Prijsstrategie</label>
                        <select class="select" id="sd-freight-strategy" [value]="effectiveFreightStrategy(data)" (change)="setLockedFreightStrategy($any($event.target).value)">
                          @if (!isLooseCartons(data)) { <option value="COUNTRY_PALLET">Landentarief per pallet</option> }
                          @if (!isLooseCartons(data) && carriers().length) { <option value="CARRIER">Verzendorganisatie (staffel)</option> }
                          @if (effectiveFreightStrategy(data) === 'PER_CBM') { <option value="PER_CBM">Tarief per m³</option> }
                          <option value="FIXED">Vast bedrag</option>
                          <option value="PICKUP">Afhalen in het magazijn</option>
                        </select>
                      </div>
                      @if (effectiveFreightStrategy(data) === 'CARRIER') {
                        <div class="field">
                          <label for="sd-freight-carrier">Verzendorganisatie</label>
                          <select class="select" id="sd-freight-carrier" [value]="data.order.freightCarrierId ?? ''" (change)="setLockedCarrier($any($event.target).value)">
                            @for (carrier of carriers(); track carrier.id) { <option [value]="carrier.id">{{ carrier.name }}</option> }
                          </select>
                        </div>
                      }
                      @if (effectiveFreightStrategy(data) === 'PER_CBM') {
                        <div class="field">
                          <label for="sd-freight-cbm">Tarief per m³</label>
                          <div class="input-affix">
                            <input class="input num right" id="sd-freight-cbm" type="number" min="0" step="0.01" inputmode="decimal"
                                   [value]="data.order.freightRatePerCbmEur ?? ''" (change)="setFreightCbmRate($any($event.target).value)" />
                            <span class="input-affix__suffix">EUR</span>
                          </div>
                        </div>
                      } @else if (effectiveFreightStrategy(data) === 'FIXED') {
                        <div class="field">
                          <label for="sd-freight">Vast vrachtbedrag</label>
                          <div class="input-affix">
                            <input class="input num right" id="sd-freight" type="number" min="0" step="0.01" inputmode="decimal"
                                   [value]="data.order.manualFreightEur ?? ''" (change)="setManualFreight($any($event.target).value)" />
                            <span class="input-affix__suffix">EUR</span>
                          </div>
                        </div>
                      }
                    }
                  </div>
                }

                @case ('check') {
                  <div class="desk-form">
                    <p class="desk-form__group">Prijsopbouw</p>
                    <div class="desk-chain">
                      <div class="desk-chain__row"><i></i><span>Bruto <small>{{ data.priced.totals.pieces | num }} stuks</small></span><b>{{ data.priced.totals.gross | eur }}</b></div>
                      @if (data.priced.totals.lineDiscountTotal) {
                        <div class="desk-chain__row"><i>−</i><span>Kortingen op regels <small>staffel en extra</small></span><b>{{ data.priced.totals.lineDiscountTotal | eur }}</b></div>
                      }
                      @if (data.priced.totals.orderDiscountAmount) {
                        <div class="desk-chain__row"><i>−</i><span>Orderkorting <small>{{ data.priced.totals.orderDiscountPercent | pct: 0 }}</small></span><b>{{ data.priced.totals.orderDiscountAmount | eur }}</b></div>
                      }
                      @if (data.priced.totals.extraDiscountAmount) {
                        <div class="desk-chain__row"><i>−</i><span>{{ data.order.extraDiscountLabel || 'Extra korting' }} <small>{{ data.order.extraDiscountPct | pct: 1 }}</small></span><b>{{ data.priced.totals.extraDiscountAmount | eur }}</b></div>
                      }
                      <div class="desk-chain__row desk-chain__row--sub"><i>=</i><span>Goederen</span><b>{{ data.priced.totals.goodsTotal | eur }}</b></div>
                      <div class="desk-chain__row"><i>+</i><span>Verzending <small>{{ data.order.freight === 'TE_BEPALEN' ? 'nog te bepalen' : freightBasisLabel(data) }}</small></span>
                        <b>@if (data.order.freight === 'TE_BEPALEN') { <span class="danger-text">—</span> } @else { {{ data.priced.totals.freight + data.priced.totals.handling | eur }} }</b></div>
                      <div class="desk-chain__row desk-chain__row--sub"><i>=</i><span>Totaal excl. btw</span><b>{{ data.priced.totals.total | eur }}</b></div>
                      <div class="desk-chain__row"><i>+</i><span>BTW <small>{{ data.priced.totals.vatLegalMention ? '0% · verlegd' : (data.priced.totals.vatRatePct | pct: 1) }}</small></span><b>{{ (data.priced.totals.vatLegalMention ? 0 : data.priced.totals.vatAmount) | eur }}</b></div>
                      <div class="desk-chain__row desk-chain__row--total"><i>=</i><span>Totaal <small>winst {{ data.priced.totals.marginEur >= 0 ? '+' : '' }}{{ data.priced.totals.marginEur | eur: 0 }} · {{ data.priced.totals.marginPct | pct: 0 }}</small></span><b>{{ (data.priced.totals.vatLegalMention ? data.priced.totals.total : data.priced.totals.totalInclVat) | eur }}</b></div>
                    </div>

                    @if (data.order.countryCode && data.priced.validation.minOrderValue > 0) {
                      <div class="desk-minimum" [class.desk-minimum--ok]="data.priced.validation.meetsMinimum" role="status">
                        <span>Minimumorder {{ data.priced.validation.minOrderValue | eur: 0 }}</span>
                        <b>@if (data.priced.validation.meetsMinimum) { ✓ bereikt } @else { nog − {{ data.priced.validation.shortfall | eur: 0 }} }</b>
                        <i class="desk-minimum__track" aria-hidden="true"><i [style.width.%]="minimumPercent()"></i></i>
                      </div>
                    }

                    @if (canEdit()) {
                      <p class="desk-form__group">Korting op het order</p>
                      <div class="desk-form__duo">
                        <div class="field">
                          <label for="sd-discount">Korting</label>
                          <div class="input-affix">
                            @if (orderDiscountShown() === 'PCT') {
                              <input class="input num right" id="sd-discount" type="number" min="0" max="100" step="0.5"
                                     [ngModel]="data.order.extraDiscountPct" (ngModelChange)="setOrderDiscountPct($event)" />
                            } @else {
                              <input class="input num right" id="sd-discount" type="number" min="0" step="0.01"
                                     [ngModel]="orderDiscountEur(data)" (ngModelChange)="setOrderDiscountEur($event)" />
                            }
                            <button class="input-affix__suffix desk-flip" type="button"
                                    [title]="orderDiscountShown() === 'PCT' ? 'Wissel naar euro' : 'Wissel naar procent'"
                                    (click)="orderDiscountShown.set(orderDiscountShown() === 'PCT' ? 'EUR' : 'PCT')">{{ orderDiscountShown() === 'PCT' ? '%' : '€' }} ⇄</button>
                          </div>
                        </div>
                        <div class="field">
                          <label for="sd-discount-name">Naam</label>
                          <input class="input" id="sd-discount-name" placeholder="bv. beurskorting"
                                 [ngModel]="data.order.extraDiscountLabel" (ngModelChange)="patch({ extraDiscountLabel: $event })" />
                        </div>
                      </div>
                      <span class="hint">Staat als eigen lijn op het document, bovenop de staffels.</span>
                    }
                  </div>
                }

                @case ('status') {
                  <div class="desk-form">
                    @if (pendingRevision(); as revision) {
                      <p class="desk-form__group">Voorstel van de klant</p>
                      <div class="desk-revision">
                        @if (revision.message) { <p class="desk-revision__quote">"{{ revision.message }}"</p> }
                        <p class="hint">Voorgesteld door {{ revision.proposedBy || 'de klant' }}</p>
                        @for (line of revision.lines; track line.productId) {
                          <div class="stat-row"><span>{{ productName(line.productId) }}</span>
                            <span class="num">{{ currentQuantity(line.productId) | num }} → <b>{{ line.quantity | num }}</b></span></div>
                        }
                        <div class="desk-actions">
                          <button class="desk-action" type="button" (click)="approve(revision, true)"><i aria-hidden="true">✎</i><span><b>Wijzigen</b><small>overnemen en zelf nog bijsturen</small></span></button>
                          <button class="desk-action" type="button" (click)="approve(revision, false)"><i aria-hidden="true">✓</i><span><b>Overnemen</b><small>precies zoals de klant vroeg</small></span></button>
                          <button class="desk-action" type="button" (click)="reject(revision)"><i aria-hidden="true">×</i><span><b>Afwijzen</b><small>de klant krijgt bericht</small></span></button>
                        </div>
                      </div>
                    }

                    @if (!isInvoiceDoc()) {
                      <p class="desk-form__group">{{ sendIssues().length ? 'Nog niet klaar om te versturen' : 'Klaar voor de klant' }}</p>
                      @if (sendIssues().length) {
                        <div class="desk-actions">
                          @for (issue of sendIssues(); track issue) {
                            <button class="desk-action" type="button" (click)="fixIssue(issue)"><i aria-hidden="true">!</i><span><b>{{ issue }}</b></span></button>
                          }
                        </div>
                      } @else {
                        <p class="desk-ok"><span aria-hidden="true">✓</span> Klant, producten, pallets en minimumorder zijn in orde.</p>
                      }
                    }

                    <p class="desk-form__group">Acties</p>
                    <div class="desk-actions">
                      @if (isInvoiceDoc()) {
                        @if (data.order.status === 'CONCEPT') {
                          <button class="desk-action" type="button" [disabled]="invoiceBusy()" (click)="markSent(data)"><i aria-hidden="true">✉</i><span><b>Markeer als verstuurd</b><small>Als je de factuur buiten het ERP bezorgde</small></span></button>
                        }
                        @if (!data.order.goodsShippedAt) {
                          <button class="desk-action" type="button" [disabled]="invoiceBusy()" (click)="openShipSheet(data)"><i aria-hidden="true">▤</i><span><b>Bestelling verzonden</b><small>Punt de voorraad af</small></span></button>
                        }
                        @if (data.order.status !== 'BETAALD') {
                          <button class="desk-action" type="button" [disabled]="invoiceBusy()" (click)="markPaid(data)"><i aria-hidden="true">€</i><span><b>Betaling registreren</b><small>Zet de factuur op betaald</small></span></button>
                        }
                        <button class="desk-action" type="button" (click)="openPdfSheet()"><i aria-hidden="true">⎙</i><span><b>PDF of pakbon</b><small>Factuur of pakbon instellen en downloaden</small></span></button>
                        @if (data.order.sourceQuoteId; as quoteId) {
                          <a class="desk-action" [routerLink]="['/sales', quoteId]"><i aria-hidden="true">›</i><span><b>Naar de offerte</b><small>Waar deze factuur uit gemaakt is</small></span></a>
                        }
                      } @else {
                        @if (data.order.status === 'CONCEPT' || data.order.status === 'VERZONDEN' || data.order.status === 'BEKEKEN') {
                          <button class="desk-action" type="button" [disabled]="sending() || sendIssues().length > 0 || dirty()" (click)="openSend()">
                            <i aria-hidden="true">➤</i><span><b>{{ data.order.sentAt ? 'Opnieuw versturen' : 'Versturen' }}</b><small>{{ dirty() ? 'Sla eerst op' : 'PDF in bijlage en een link om te tekenen' }}</small></span>
                          </button>
                        }
                        @if (data.order.status === 'GEACCEPTEERD' || data.order.status === 'CONCEPT') {
                          <button class="desk-action" type="button" [disabled]="invoiceBusy()" (click)="makeInvoice(data)"><i aria-hidden="true">€</i><span><b>Factuur maken</b><small>De inhoud wordt bevroren in een nieuwe factuur</small></span></button>
                        }
                        @if (customerPortalLink(); as portalLink) {
                          @if (portalLink.available && portalLink.url) {
                            <button class="desk-action" type="button" (click)="copyLink()"><i aria-hidden="true">⧉</i><span><b>Klantlink kopiëren</b><small>De pagina waar de klant tekent</small></span></button>
                          }
                        }
                        @if (data.order.status === 'AFGEWEZEN' || data.order.status === 'VERLOPEN' || data.order.status === 'GEANNULEERD') {
                          <button class="desk-action" type="button" [disabled]="busy()" (click)="reopen()"><i aria-hidden="true">↺</i><span><b>Heropenen</b><small>Terug naar concept om aan te passen</small></span></button>
                        }
                        @if (canCancel()) {
                          <button class="desk-action" type="button" [disabled]="busy()" (click)="openCancel()"><i aria-hidden="true">⊘</i><span><b>{{ websiteRequest(data.order) && !data.order.sentAt ? 'Aanvraag annuleren' : 'Offerte annuleren' }}</b><small>De klant kan niet meer aanvaarden</small></span></button>
                        }
                        <button class="desk-action" type="button" (click)="openPdfSheet()"><i aria-hidden="true">⎙</i><span><b>PDF</b><small>Taal en inhoud kiezen en downloaden</small></span></button>
                      }
                      <button class="desk-action" type="button" [disabled]="busy()" (click)="duplicate()"><i aria-hidden="true">⧉</i><span><b>Nieuwe kopie</b><small>Een nieuw concept met dezelfde inhoud</small></span></button>
                    </div>

                    <p class="desk-form__group">Geschiedenis</p>
                    <ol class="desk-history">
                      @for (step of history(); track step.id) {
                        <li [class.desk-history__customer]="step.byCustomer">
                          <b>{{ step.summary }}</b>
                          <small>{{ step.at | dateTimeNl }}@if (step.actor) { · {{ step.actor }} }</small>
                          @if (step.detail) { <span>{{ step.detail }}</span> }
                        </li>
                      } @empty {
                        <li><small>Nog niets gebeurd met dit document.</small></li>
                      }
                    </ol>

                    @if (canDelete()) {
                      <details class="desk-danger">
                        <summary>Verwijderen</summary>
                        <p>Alleen een concept dat de klant nooit zag. Dit kan niet ongedaan worden gemaakt.</p>
                        <button class="btn btn--danger btn--block" type="button" [disabled]="deleting()" (click)="remove()">
                          {{ deleting() ? 'Verwijderen…' : (isInvoiceDoc() ? 'Deze factuur verwijderen' : 'Deze offerte verwijderen') }}
                        </button>
                      </details>
                    }
                  </div>
                }
              }
            </div>
          </aside>
        </div>
      </div>

      <!-- ============================ sheets: the same ones the phone editor opens -->
      @if (costSheet(); as sheet) {
        <app-sheet [title]="'Gelande kost · ' + sheet.title" (closed)="costSheet.set(null)">
          <div body>
            @if (sheet.rows.length) {
              <dl class="desk-cost">
                @for (row of sheet.rows; track row.label) {
                  <div [class.desk-cost__sum]="row.sum">
                    <dt>{{ row.label }}@if (row.hint) { <small>{{ row.hint }}</small> }</dt>
                    <dd class="num">{{ row.eur | eur: 4 }}</dd>
                  </div>
                }
              </dl>
              @if (sheet.source) { <p class="hint">Kostprijs uit calculatie <b>{{ sheet.source }}</b>.</p> }
            } @else {
              <p class="hint">Opbouw laden…</p>
            }
          </div>
          <div foot style="display:contents">
            <span class="spacer"></span>
            <button class="btn" type="button" (click)="costSheet.set(null)">Sluiten</button>
          </div>
        </app-sheet>
      }

      @if (pdfSheet()) {
        <app-sales-pdf-sheet [orderId]="data.order.id" [orderNumber]="data.order.number"
                             [customerName]="customerName()" [customerLanguage]="customerLanguage()"
                             [invoice]="isInvoiceDoc()" [dirty]="dirty()" [saving]="saving()"
                             (saveRequested)="save()" (closed)="pdfSheet.set(false)" />
      }

      @if (palletSheet()) {
        <app-sheet title="Transport &amp; levering" [wide]="true" (closed)="palletSheet.set(false)">
          <div body>
            <app-shipping-planner [view]="data" [canEdit]="canEdit()" [carriers]="carriers()"
                                  [customerPostcode]="customerPostcode()" [countryName]="orderCountryName()"
                                  (patch)="applyShippingPatch($event)" (action)="handlePalletAction($event)" />
          </div>
          <div foot style="display:contents">
            <button class="btn btn--primary btn--block" type="button" (click)="palletSheet.set(false)">Klaar</button>
          </div>
        </app-sheet>
      }

      @if (picking()) {
        <app-product-picker heading="Product toevoegen" [products]="available()" [categories]="categories()"
                            [families]="families()" [groupByFamily]="true" [preserveSourceOrder]="true"
                            [priceOf]="priceOf" (picked)="addLine($event)" (cancelled)="picking.set(false)" />
      }

      @if (cancelSheet()) {
        <app-sheet [title]="websiteRequest(data.order) && !data.order.sentAt ? 'Aanvraag annuleren' : 'Offerte annuleren'" (closed)="cancelSheet.set(false)">
          <div body>
            <p class="small muted" style="margin-bottom:14px">
              @if (websiteRequest(data.order) && !data.order.sentAt) {
                De klant stuurde deze aanvraag via de website en kreeg nog geen offerte. Ze gaat op “Geannuleerd”; er volgt geen offerte. Heropenen kan later nog.
              } @else {
                De offerte gaat op “Geannuleerd” en kan niet meer aanvaard worden. Heropenen kan later nog; dan staat ze weer op concept.
              }
            </p>
            <div class="field">
              <label for="sd-cancel-message">Bericht aan de klant <span class="opt"></span></label>
              <textarea class="textarea" id="sd-cancel-message" rows="3" [ngModel]="cancelMessage()" (ngModelChange)="cancelMessage.set($event)"
                        placeholder="bijv. de gevraagde kleur is niet meer leverbaar; u krijgt een nieuwe offerte"></textarea>
            </div>
            <label class="switch-row" [class.switch-row--on]="cancelNotify()">
              <span class="switch-row__copy">
                <b>Klant verwittigen per e-mail</b>
                <small>
                  @if (!customerEmail()) { De klant heeft geen e-mailadres; de offertepagina toont wel dat ze geannuleerd is. }
                  @else if (data.order.sentAt) { Naar {{ customerEmail() }}, met de link naar de offertepagina, waar ze als geannuleerd staat. }
                  @else { De klant krijgt in zijn eigen taal een mail dat de aanvraag geannuleerd is, met een knop om een nieuwe aanvraag te starten. }
                </small>
              </span>
              <input class="switch-row__input" type="checkbox" role="switch" [attr.aria-checked]="cancelNotify()"
                     [disabled]="!customerEmail()" [ngModel]="cancelNotify()" (ngModelChange)="cancelNotify.set($event)" />
              <span class="switch-row__track" aria-hidden="true"><i></i></span>
            </label>
          </div>
          <div foot style="display:contents">
            <button class="btn" type="button" (click)="cancelSheet.set(false)">Terug</button>
            <button class="btn btn--primary" type="button" [disabled]="busy()" (click)="cancel()">
              {{ busy() ? 'Bezig…' : (websiteRequest(data.order) && !data.order.sentAt ? 'Aanvraag annuleren' : 'Offerte annuleren') }}
            </button>
          </div>
        </app-sheet>
      }

      @if (sendSheet()) {
        <app-sheet title="Offerte versturen" (closed)="sendSheet.set(false)">
          <div body>
            <p class="small muted" style="margin-bottom:14px">
              De klant krijgt de PDF in bijlage en een link om de offerte online te bekijken, te tekenen of een wijziging voor te stellen.
            </p>
            <div class="field">
              <label for="sd-send-message">Persoonlijk bericht</label>
              <textarea class="textarea" id="sd-send-message" rows="4" [ngModel]="sendMessage()" (ngModelChange)="sendMessage.set($event)"></textarea>
            </div>
          </div>
          <div foot style="display:contents">
            <button class="btn" type="button" (click)="sendSheet.set(false)">Annuleren</button>
            <button class="btn btn--primary" type="button" [disabled]="sending() || sendIssues().length > 0" (click)="send()">
              {{ sending() ? 'Bezig…' : 'Versturen' }}
            </button>
          </div>
        </app-sheet>
      }

      @if (shipSheet(); as ship) {
        <app-sheet title="Voorraad afpunten" (closed)="shipSheet.set(null)">
          <div body>
            <p class="small muted" style="margin-bottom:12px">Deze aantallen gaan als verkocht uit de voorraad op {{ ship.number }}. Dit gebeurt één keer.</p>
            <ul class="desk-ship">
              @for (row of ship.rows; track $index) {
                <li>
                  @if (row.photoUrl) { <img class="desk-ship__photo" [appAuthSrc]="row.photoUrl" alt="" /> }
                  @else { <span class="desk-ship__photo desk-ship__photo--empty" aria-hidden="true">◈</span> }
                  <span class="desk-ship__copy"><strong>{{ row.name }}</strong><small>−{{ row.qty | num }} stuks</small></span>
                  <span class="desk-ship__stock" [class.is-bad]="row.after !== null && row.after < 0">
                    @if (row.before !== null) { {{ row.before | num }} → {{ row.after | num }} } @else { onbekend }
                  </span>
                </li>
              }
            </ul>
            @if (shipHasNegative()) {
              <p class="hint hint--warn">Minstens één product komt onder nul te staan — controleer de telling voor je afpunt.</p>
            }
          </div>
          <div foot style="display:contents">
            <button class="btn" type="button" (click)="shipSheet.set(null)">Annuleren</button>
            <span class="spacer"></span>
            <button class="btn btn--primary" type="button" [disabled]="invoiceBusy()" (click)="confirmShipFromSheet()">
              {{ invoiceBusy() ? 'Bezig…' : 'Voorraad afpunten' }}
            </button>
          </div>
        </app-sheet>
      }
    } @else {
      <app-page-header title="Verkoop" [subtitle]="loadError() ? 'Document niet beschikbaar' : 'Document laden…'"
                       [showBack]="true" [showBell]="false" />
      <div class="content desk">
        @if (loadError()) {
          <section class="card desk-load-error" role="alert">
            <h2>Document niet beschikbaar</h2>
            <p>{{ loadError() }}</p>
            <a class="btn" routerLink="/sales">Terug naar verkoop</a>
            @if (validOrderId()) { <button class="btn btn--primary" type="button" (click)="retryLoad()">Opnieuw proberen</button> }
          </section>
        } @else {
          <div class="desk-loading" role="status" aria-live="polite">Document laden…</div>
        }
      </div>
    }
  `,
  styles: [`
    :host{display:block;min-width:0}
    .desk-table-bar{display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--line)}
    .desk-table-bar>div{flex:1;min-width:0}.desk-table-bar h2{font-size:15px}.desk-table-bar p{color:var(--muted);font-size:11.5px}
    .desk-table-wrap{overflow-x:auto}
    .desk-table{width:100%;min-width:760px;border-collapse:separate;border-spacing:0;table-layout:fixed;font-size:12.5px}.desk-table--editing{min-width:860px}
    .desk-table thead th{padding:9px 10px 9px 12px;border-bottom:1px solid var(--line);background:var(--surface-2);color:var(--muted);font-size:9.5px;font-weight:750;letter-spacing:.04em;text-align:right;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .desk-table thead th.c-product,.desk-table thead th.c-delivery{text-align:left}.desk-table thead th.c-product{padding-left:16px}
    .desk-table td{padding:10px 12px;border-bottom:1px solid var(--line);vertical-align:middle;line-height:1.25}
    .desk-table td.c-product{padding-left:16px}
    .c-product{width:30%;min-width:210px}.c-qty{width:76px;text-align:right}.c-price{width:104px;text-align:right}.c-disc{width:84px;text-align:right}.c-money{width:112px;text-align:right;font-variant-numeric:tabular-nums}.c-delivery{width:150px;text-align:left}.c-act{width:34px}
    .desk-table--editing .c-qty{width:86px}.desk-table--editing .c-price{width:112px}.desk-table--editing .c-disc{width:96px}
    .c-money--total b{color:var(--rose-dark);font-weight:750}
    .c-money small,.c-price small{display:block;margin-top:2px;color:var(--muted);font-size:10.5px;white-space:nowrap}
    .c-qty b,.c-price>b,.c-disc>b{display:block;font-size:13.5px;font-variant-numeric:tabular-nums}
    .desk-section__row th{padding:12px 16px 5px;color:var(--rose);font-size:10px;font-weight:760;letter-spacing:.1em;text-align:left;text-transform:uppercase;background:var(--surface)}
    .desk-section__row th small{margin-left:6px;color:var(--muted);font-weight:600;letter-spacing:0;text-transform:none}
    .desk-group td{background:var(--surface-2)}.desk-group .c-money,.desk-group .c-qty b{font-weight:750}
    .desk-row--variant td.c-product{padding-left:34px}.desk-row--variant .desk-product__photo{width:36px;height:36px}
    .desk-row:hover td{background:color-mix(in srgb,var(--rose-soft) 45%,var(--surface))}
    .desk-product{display:flex;align-items:center;gap:11px}.desk-product__photo-link{flex:none;line-height:0}.desk-product__copy{display:grid;min-width:0;line-height:1.25}
    .desk-product__name{color:inherit;text-decoration:none}.desk-product__name:hover strong{text-decoration:underline}.desk-product__copy strong{display:block;font-size:13.5px}.desk-product__copy small{display:block;color:var(--muted);font-size:11px}
    .desk-product__photo{width:44px;height:44px;flex:none;border:1px solid var(--line);border-radius:11px;object-fit:cover;background:#fff}
    .desk-product__photo--empty{display:grid;place-items:center;background:var(--surface-2);color:var(--muted);font-size:11px;font-weight:700}
    .desk-product__meta{display:flex;flex-wrap:wrap;align-items:center;margin-top:2px;color:var(--muted);font-size:11px}
    .desk-product__meta>*{white-space:nowrap}.desk-product__meta>*:not(:last-child)::after{content:'·';margin:0 6px;color:var(--line-strong)}.desk-product__meta .is-warn{color:var(--warn);font-weight:650}
    .desk-product__link{padding:0;border:0;background:none;color:var(--rose-dark);font:inherit;font-size:11px;font-weight:650;cursor:pointer}.desk-product__link:hover{text-decoration:underline}
    .desk-cell{min-height:34px;padding:5px 10px 5px 8px;font-size:13px}.desk-table--editing td.c-qty,.desk-table--editing td.c-price,.desk-table--editing td.c-disc{padding-right:6px}
    .desk-disc{display:flex;align-items:center}.desk-disc .desk-cell{flex:1;min-width:0;border-radius:var(--r-sm) 0 0 var(--r-sm)}.desk-disc__unit{display:grid;place-items:center;min-height:34px;padding:0 8px;border:1px solid var(--line-strong);border-left:0;border-radius:0 var(--r-sm) var(--r-sm) 0;background:var(--surface-2);color:var(--muted);font-size:12px}
    .desk-remove{width:28px;height:28px;border:0;border-radius:8px;background:transparent;color:var(--muted);font-size:18px;line-height:1;cursor:pointer}.desk-remove:hover{background:var(--danger-soft);color:var(--danger)}
    .desk-total{display:inline-grid;justify-items:end;gap:1px;margin:-4px 0;padding:4px 0 4px 6px;border:0;border-radius:8px;background:transparent;color:var(--ok);font:inherit;font-weight:750;font-variant-numeric:tabular-nums;line-height:1.2;cursor:pointer}
    .desk-total.is-bad{color:var(--danger)}.desk-total small{display:inline-flex;align-items:center;gap:2px;color:var(--muted);font-size:9.5px;font-weight:600;white-space:nowrap}.desk-total i{font-style:normal;font-size:12px;font-weight:700}.desk-total:hover{background:var(--rose-soft)}
    .desk-delivery{display:grid;gap:1px;font-size:11.5px}.desk-delivery b{color:var(--warn);font-weight:650}.desk-delivery--ok b{color:var(--ok)}.desk-delivery--bad b{color:var(--danger)}.desk-delivery small{color:var(--muted);font-size:10.5px}
    .desk-week{margin-top:6px}
    .desk-table tfoot th{padding:11px 10px;border-top:2px solid var(--line-strong);background:var(--surface-2);font-size:13px;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
    .desk-table tfoot th.c-product{text-align:left;padding-left:16px;color:var(--muted);font-size:10px;font-weight:750;letter-spacing:.08em;text-transform:uppercase}.desk-table tfoot th.is-bad{color:var(--danger)}
    .desk-empty{display:grid;justify-items:center;gap:6px;padding:40px 20px;text-align:center}.desk-empty__art{display:grid;width:52px;height:52px;place-items:center;border-radius:50%;background:var(--rose-soft);color:var(--rose);font-size:24px}.desk-empty h3{font-size:15px}.desk-empty p{max-width:360px;color:var(--muted);font-size:12.5px}
    .desk-lock{display:flex;align-items:center;gap:10px;margin-top:12px;padding:9px 14px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2);color:var(--ink-2);font-size:12.5px}.desk-lock>span:first-child{color:var(--ok);font-weight:800}.desk-lock>span:nth-child(2){flex:1}
    .desk-minimum{display:grid;grid-template-columns:1fr auto;gap:2px 10px;margin-top:10px;padding:9px 12px;border:1px solid #eddcb9;border-radius:12px;background:var(--warn-soft);font-size:12px}.desk-minimum--ok{border-color:color-mix(in srgb,var(--ok) 40%,transparent);background:color-mix(in srgb,var(--ok) 8%,var(--surface))}.desk-minimum b{font-variant-numeric:tabular-nums}.desk-minimum__track{grid-column:1/-1;display:block;height:5px;border-radius:99px;background:rgb(0 0 0/.08);overflow:hidden}.desk-minimum__track i{display:block;height:100%;background:var(--ok);border-radius:99px}
    .desk-flip{min-width:56px;font-size:12px}
    .desk-ok{display:flex;gap:8px;margin:0;padding:9px 12px;border-radius:12px;background:color-mix(in srgb,var(--ok) 10%,var(--surface));color:var(--ok);font-size:12.5px}
    .desk-revision{padding:10px 12px;border:1px solid var(--rose-line);border-radius:12px;background:var(--rose-soft)}.desk-revision__quote{margin:0 0 6px;font-size:12.5px;font-style:italic}.desk-revision .stat-row{padding:3px 0;font-size:12px}.desk-revision .desk-actions{margin-top:8px}
    .desk-history{display:grid;gap:0;margin:0;padding:0;list-style:none;border:1px solid var(--line);border-radius:12px;background:var(--surface-2);overflow:hidden}.desk-history li{display:grid;gap:1px;padding:8px 12px;border-left:3px solid var(--line-strong);font-size:12px}.desk-history li+li{border-top:1px solid var(--line)}.desk-history__customer{border-left-color:var(--rose)!important}.desk-history b{font-weight:650}.desk-history small{color:var(--muted);font-size:10.5px}.desk-history span{color:var(--ink-2);font-size:11.5px}
    .desk-cost{display:grid;margin:0;padding:0}.desk-cost>div{display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-bottom:1px solid var(--line);font-size:13px}.desk-cost dt small{display:block;color:var(--muted);font-size:11px}.desk-cost dd{margin:0;font-variant-numeric:tabular-nums}.desk-cost__sum{font-weight:750}
    .desk-ship{display:grid;gap:8px;margin:0;padding:0;list-style:none}.desk-ship li{display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--line);border-radius:12px}.desk-ship__photo{width:40px;height:40px;flex:none;border-radius:9px;object-fit:cover;border:1px solid var(--line)}.desk-ship__photo--empty{display:grid;place-items:center;background:var(--surface-2);color:var(--muted)}.desk-ship__copy{display:grid;flex:1;min-width:0}.desk-ship__copy strong{font-size:13px}.desk-ship__copy small{color:var(--muted);font-size:11px}.desk-ship__stock{font-variant-numeric:tabular-nums;font-weight:700}.desk-ship__stock.is-bad{color:var(--danger)}
    .desk-loading{padding:40px;color:var(--muted);text-align:center}.desk-load-error{display:grid;gap:8px;justify-items:start;padding:20px}
    .hint--warn{color:var(--danger);font-weight:650}
    .check-option{display:flex;gap:10px;padding:8px 0;cursor:pointer}.check-option input{width:20px;height:20px;flex:none;accent-color:var(--rose)}.check-option span{display:grid;gap:2px}.check-option strong{font-size:12.5px}.check-option small{color:var(--muted);font-size:11px}
  `],
})
export class SalesDesk extends SalesEditor {
  /** Which drawer of the rail is open; the customer first, as on paper. */
  readonly railTab = signal<RailTab>('order');
  /** Profit per piece or per line in the table. */
  readonly profitPerPiece = signal(true);

  /**
   * The table, row by row: a category caption only when there are several,
   * a series header whenever a series has more than one variant, and the
   * lines - indented under their series, or on their own.
   */
  readonly tableRows = computed<DeskRow[]>(() => {
    const sections = this.lineSections();
    const rows: DeskRow[] = [];
    for (const section of sections) {
      if (sections.length > 1) {
        rows.push({ kind: 'section', key: 's:' + section.key, label: section.label, count: section.lines.length });
      }
      for (const family of section.families) {
        const grouped = family.familyId !== null && family.lines.length > 1;
        if (grouped) {
          rows.push({
            kind: 'group', key: 'g:' + family.key, label: family.label, lines: family.lines,
            pieces: family.pieces, cartons: family.cartons, cbm: family.cbm,
            net: family.lines.reduce((sum, line) => sum + line.net, 0),
            leadPhoto: family.lines.find((line) => line.photoUrl)?.photoUrl ?? null,
          });
        }
        for (const line of family.lines) rows.push({ kind: 'line', key: 'l:' + line.productId, line, variant: grouped });
      }
    }
    return rows;
  });

  /** The document's road, as far as it got: four stops for a quote, four for an invoice. */
  journey(): JourneyStep[] {
    const order = this.view()?.order;
    if (!order) return [];
    if (this.isInvoiceDoc()) {
      const flags = [true, order.status !== 'CONCEPT', !!order.goodsShippedAt, order.status === 'BETAALD'];
      const now = flags.indexOf(false);
      return ['Concept', 'Verstuurd', 'Bestelling verzonden', 'Betaald'].map((label, index) => ({
        label, state: flags[index] ? 'done' : index === now ? 'now' : 'todo',
      }));
    }
    const reached = order.status === 'GEACCEPTEERD' ? 4
      : order.status === 'BEKEKEN' || order.status === 'WIJZIGING_GEVRAAGD' ? 3
      : order.status === 'VERZONDEN' || order.sentAt ? 2 : 1;
    return ['Concept', 'Verzonden', 'Bekeken', 'Geaccepteerd'].map((label, index) => ({
      label, state: index < reached - 1 ? 'done' : index === reached - 1 ? 'now' : 'todo',
    }));
  }

  /** A state outside the happy road gets its own chip in front of the steps. */
  terminalLabel(order: SalesOrder): string | null {
    switch (order.status) {
      case 'AFGEWEZEN': case 'VERLOPEN': case 'GEANNULEERD': case 'WIJZIGING_GEVRAAGD':
        return this.label(order.status);
      default:
        return null;
    }
  }

  invoiceNextStep(data: SalesOrderView): string {
    if (data.order.status === 'CONCEPT') return 'Factuur versturen';
    if (!data.order.goodsShippedAt) return 'Bestelling verzenden';
    if (data.order.status !== 'BETAALD') return 'Betaling registreren';
    return 'Afgerond ✓';
  }

  /** The checklist and the website review jump to a rail tab instead of scrolling a page. */
  override scrollToSection(id: string): void {
    const tab: RailTab | null = id === 'quote-setup' ? 'order'
      : id === 'quote-logistics' ? 'delivery'
      : id === 'quote-check' ? 'check'
      : id === 'quote-status' ? 'status' : null;
    if (tab) this.railTab.set(tab);
    if (id === 'order-lines') document.querySelector<HTMLElement>('.desk-main')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---- invoices: the same steps the phone view offers ---- */
  readonly invoiceBusy = signal(false);

  makeInvoice(data: SalesOrderView): void {
    if (this.invoiceBusy()) return;
    this.ui.confirm({
      title: 'Factuur maken',
      message: `De inhoud van <b>${escapeHtml(data.order.number)}</b> wordt bevroren in een nieuwe factuur. `
        + 'De offerte zelf blijft bestaan.',
      confirmLabel: 'Factuur maken',
    }, () => { void this.createInvoice(data); });
  }

  private async createInvoice(data: SalesOrderView): Promise<void> {
    this.invoiceBusy.set(true);
    try {
      const invoice = await this.sales.createInvoiceFrom(data.order.id);
      this.ui.toast(`${invoice.order.number} aangemaakt`);
      await this.router.navigate(['/sales', invoice.order.id]);
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
      this.view.set(await this.sales.markInvoiceSent(data.order.id));
      void this.loadHistory(data.order.id);
      this.ui.toast('Factuur staat op verstuurd');
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Status wijzigen mislukt'), 'err');
    } finally {
      this.invoiceBusy.set(false);
    }
  }

  readonly shipSheet = signal<{
    rows: { name: string; photoUrl: string | null; qty: number; before: number | null; after: number | null }[];
    pieces: number; number: string;
  } | null>(null);

  /** Deducting stock is deliberate: first every product with its count before and after. */
  async openShipSheet(data: SalesOrderView): Promise<void> {
    if (this.invoiceBusy()) return;
    let stockById = new Map<number, number>();
    try {
      const products = await this.catalog.products();
      stockById = new Map(products.filter((product) => product.id !== null)
        .map((product) => [product.id!, product.stockQuantity ?? 0]));
    } catch { /* the stock preview is best-effort; the rows then say "onbekend" */ }
    const rows = data.priced.lines.map((line) => {
      const before = stockById.has(line.productId) ? stockById.get(line.productId)! : null;
      return { name: line.description, photoUrl: line.photoUrl, qty: line.quantity,
               before, after: before === null ? null : before - line.quantity };
    });
    this.shipSheet.set({ rows, pieces: data.priced.totals.pieces, number: data.order.number });
  }

  shipHasNegative(): boolean {
    return (this.shipSheet()?.rows ?? []).some((row) => row.after !== null && row.after < 0);
  }

  confirmShipFromSheet(): void {
    const data = this.view();
    if (data) void this.shipGoods(data);
  }

  private async shipGoods(data: SalesOrderView): Promise<void> {
    this.invoiceBusy.set(true);
    try {
      this.view.set(await this.sales.shipGoods(data.order.id));
      void this.loadHistory(data.order.id);
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
      this.view.set(await this.sales.markInvoicePaid(data.order.id));
      void this.loadHistory(data.order.id);
      this.ui.toast('Factuur betaald — mooi zo');
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Status wijzigen mislukt'), 'err');
    } finally {
      this.invoiceBusy.set(false);
    }
  }

  documentLabel(order: SalesOrder): string {
    return salesDocumentLabel(order.docType);
  }
}
