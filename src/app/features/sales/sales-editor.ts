import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, HostListener } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CatalogApi } from '../../core/api/catalog-api';
import { AuthImage } from '../../core/api/auth-image';
import { SalesApi } from '../../core/api/sales-api';
import { saveBlob } from '../../core/api/download';
import { OrderPallet,
  Country, Customer, CustomerPortalLink, FreightPricingStrategy, LANGUAGES, LanguageCode,
  MarkupMode, Product, QuoteEvent, QuoteRevision, PricedLine, SalesOrder, SalesOrderView,
} from '../../core/api/models';
import { PageHeader } from '../../shared/page-header';
import { ProductPicker } from '../../shared/product-picker';
import { DateField } from '../../shared/date-field';
import { WeekField } from '../../shared/week-field';
import { Privacy } from '../../core/api/privacy';
import { messageOf } from '../../core/api/errors';
import { STANDARD_PAYMENT_TERMS } from '../../core/api/geo';
import { WorkQueue } from '../../core/api/work-queue';
import { Sheet, Ui } from '../../shared/ui';
import {
  CbmPipe, DateNlPipe, DateTimeNlPipe, EurPipe, NumPipe, PctPipe, WeekNlPipe,
} from '../../shared/pipes';
import { STATUS_LABEL, statusClass } from './quote-status';
import {
  normalizeManualPalletType, ShippingOrderPatch, ShippingPalletAction, ShippingPlanner,
} from './shipping-planner';

/**
 * Sales order and quote.
 *
 * The server calculates; this screen shows and edits. After every change
 * the priced result comes back, so there is no second calculation engine
 * here to drift from the first.
 */
@Component({
  selector: 'app-sales-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, AuthImage, PageHeader, Sheet, ProductPicker, DateField, WeekField,
            ShippingPlanner,
            EurPipe, NumPipe, PctPipe, CbmPipe, DateNlPipe, DateTimeNlPipe, WeekNlPipe],
  template: `
    @if (view(); as data) {
      <app-page-header [title]="data.order.number" [subtitle]="customerName()"
                       [showBack]="true" [showBell]="false"
                       [titleEditable]="canEdit()"
                       (titleChange)="patch({ number: $event })">
        <div class="quote-header-actions">
          <div class="quote-header-total" aria-label="Offertetotaal exclusief btw">
            <span>Totaal</span>
            <strong>{{ data.priced.totals.total | eur: 0 }}</strong>
          </div>
          @if (canEdit()) {
            <button class="btn btn--primary btn--sm quote-header-button" type="button"
                    [disabled]="saving() || !dirty()" (click)="save()">
              {{ saving() ? 'Bezig…' : (dirty() ? 'Opslaan' : 'Opgeslagen') }}
            </button>
          }
          <button class="btn btn--sm quote-header-button" type="button"
                  (click)="openPdfSheet()">PDF</button>
          @if (data.order.status === 'AFGEWEZEN' || data.order.status === 'VERLOPEN') {
            <button class="btn btn--primary btn--sm quote-header-button" type="button"
                    [disabled]="busy()" (click)="reopen()">Heropen</button>
          } @else if (data.order.status === 'CONCEPT' || data.order.status === 'VERZONDEN'
                     || data.order.status === 'BEKEKEN') {
            <button class="btn btn--primary btn--sm quote-header-button" type="button"
                    [disabled]="sending() || sendIssues().length > 0"
                    [attr.title]="sendIssues()[0] || null"
                    [attr.aria-label]="data.order.sentAt ? 'Offerte opnieuw versturen' : 'Offerte versturen'"
                    (click)="openSend()">
              {{ data.order.sentAt ? 'Opnieuw' : 'Verstuur' }}
            </button>
          }
        </div>
      </app-page-header>

      <main class="content sales-page">
        <!-- A compact cockpit: status, readiness and commercial scale are
             visible before somebody starts editing a long order. -->
        <section class="quote-hero" aria-labelledby="quote-overview-title">
          <div class="quote-hero__top">
            <div>
              <div class="quote-hero__eyebrow" id="quote-overview-title">Verkoopofferte</div>
              <div class="quote-hero__customer">{{ customerName() }}</div>
              <div class="quote-hero__meta">
                {{ data.order.countryCode || 'Nog geen leverland' }}
                · {{ data.order.incoterm || 'Geen incoterm' }}
              </div>
            </div>
            <button class="history-button" type="button" (click)="toggleHistory()"
                    [attr.aria-expanded]="historyOpen()" aria-controls="quote-history">
              <span class="badge" [class]="'badge--' + cls(data.order.status)">
                {{ label(data.order.status) }}
              </span>
              <span aria-hidden="true" class="history-button__chev"
                    [class.history-button__chev--open]="historyOpen()">⌄</span>
              <span class="sr-only">Geschiedenis tonen</span>
            </button>
          </div>

          <div class="quote-hero__facts" aria-label="Offerte-overzicht">
            <div class="hero-fact">
              <span class="hero-fact__label">Producten</span>
              <strong>{{ data.priced.lines.length }}</strong>
              <span>{{ data.priced.totals.pieces | num }} stuks</span>
            </div>
            <div class="hero-fact">
              <span class="hero-fact__label">Levering</span>
              @if (isLooseCartons(data)) {
                <strong>{{ data.priced.totals.cbm | cbm }}</strong>
                <span>
                  {{ data.priced.totals.cartons | num }}
                  {{ data.priced.totals.cartons === 1 ? 'losse doos' : 'losse dozen' }}
                </span>
              } @else {
                <strong>{{ data.priced.totals.palletsManual || data.priced.totals.palletsStrict }}</strong>
                <span>
                  {{ (data.priced.totals.palletsManual || data.priced.totals.palletsStrict) === 1
                      ? 'pallet' : 'pallets' }}
                </span>
              }
            </div>
            <div class="hero-fact hero-fact--total">
              <span class="hero-fact__label">Offertetotaal</span>
              <strong>{{ data.priced.totals.total | eur: 0 }}</strong>
              <span>{{ data.priced.totals.vatLegalMention ? 'BTW verlegd' : 'excl. BTW' }}</span>
            </div>
          </div>

          @if (historyOpen()) {
            <div class="quote-history" id="quote-history">
              <div class="quote-history__title">Geschiedenis</div>
              @for (step of history(); track step.id) {
                <div class="step" [class.step--customer]="step.byCustomer">
                  <span class="step__dot"></span>
                  <div class="step__body">
                    <div class="step__title">{{ step.summary }}</div>
                    <div class="step__meta">
                      {{ step.at | dateTimeNl }}@if (step.actor) { · {{ step.actor }} }
                    </div>
                    @if (step.detail) { <div class="step__detail">{{ step.detail }}</div> }
                  </div>
                </div>
              } @empty {
                <p class="small muted">Nog niets gebeurd met deze offerte.</p>
              }
            </div>
          }
        </section>

        @if (referenceError()) {
          <div class="alert alert--warn reference-alert" role="status">
            <span class="alert__icon">!</span>
            <div class="grow">
              <b>Keuzelijsten konden niet volledig laden</b>
              <div class="small">{{ referenceError() }}</div>
            </div>
            <button class="btn btn--sm" type="button" (click)="retryReference()">Opnieuw</button>
          </div>
        }

        @if (!canEdit()) {
          <div class="alert alert--info quote-lock">
            <span class="alert__icon">✓</span>
            <div class="grow">
              <b>Deze offerteversie staat vast</b>
              <div class="small">
                Klant, aantallen en prijzen veranderen niet meer via dit scherm.
                Leverweken en vracht kun je nog veilig aanvullen.
              </div>
            </div>
            <button class="btn btn--sm" type="button" [disabled]="busy()"
                    (click)="duplicate()">Nieuwe kopie</button>
          </div>
        }

        @if (pendingRevision(); as revision) {
          <section class="card revision-card" aria-labelledby="revision-title">
            <div class="card__head">
              <h2 id="revision-title">De klant vraagt een wijziging</h2>
              <span class="spacer"></span>
              <span class="badge badge--gold">wacht op ons</span>
            </div>
            <div class="card__body">
              @if (revision.message) {
                <p class="small" style="margin-bottom:10px">"{{ revision.message }}"</p>
              }
              <div class="small muted" style="margin-bottom:12px">
                Voorgesteld door {{ revision.proposedBy || 'de klant' }}
              </div>
              @for (line of revision.lines; track line.productId) {
                <div class="stat-row">
                  <span>{{ productName(line.productId) }}</span>
                  <span class="num">
                    {{ currentQuantity(line.productId) | num }} → <b>{{ line.quantity | num }}</b>
                  </span>
                </div>
              }
              <div class="mt-12">
                <!-- The explanation lives inside each button: no paragraph to
                     misalign, and the choice explains itself at the point of
                     tapping. -->
                <button class="btn btn--primary btn--block btn--stacked" type="button"
                        (click)="approve(revision, true)">
                  <span>Wijzigen</span>
                  <span class="btn__sub">overnemen en zelf nog bijsturen</span>
                </button>
                <button class="btn btn--block btn--stacked mt-8" type="button"
                        (click)="approve(revision, false)">
                  <span>Overnemen</span>
                  <span class="btn__sub">precies zoals de klant vroeg</span>
                </button>
                <button class="btn btn--block btn--quiet mt-8" type="button"
                        (click)="reject(revision)">Afwijzen</button>
              </div>
            </div>
          </section>
        }

        <div class="workflow-layout">
        <nav class="workflow-nav" aria-label="Onderdelen van de offerte">
          @for (item of workflowSections; track item.id; let number = $index) {
            <button type="button"
                    [class.workflow-nav__active]="activeSection() === item.id"
                    [attr.aria-current]="activeSection() === item.id ? 'step' : null"
                    (click)="scrollToSection(item.id)">
              <span>{{ number + 1 }}</span>{{ item.label }}
            </button>
          }
        </nav>
        <div class="workflow-content">

        <!-- ==================================== order -->
        <section class="card form-card" id="quote-setup" aria-labelledby="quote-setup-title">
          <button class="section-toggle" type="button" (click)="toggle('order')"
                  [attr.aria-expanded]="isOpen('order')" aria-controls="quote-setup-body">
            <span class="section-toggle__number">1</span>
            <span class="section-toggle__copy">
              <strong id="quote-setup-title">Klant &amp; offerte</strong>
              <span>{{ orderSummary() }}</span>
            </span>
            <span class="section-toggle__chev" aria-hidden="true"
                  [class.section-toggle__chev--open]="isOpen('order')">›</span>
          </button>
          <div class="collapse" id="quote-setup-body"
               [class.collapse--open]="isOpen('order')"><div class="collapse__inner">
          <div class="card__body">
            <fieldset class="form-lock" [disabled]="!canEdit()">
            <p class="card-intro">
              Kies eerst voor wie de offerte is. Leverland en voorwaarden worden waar mogelijk
              van de klant overgenomen.
            </p>
            <div class="form-grid">
              <div class="field span-2">
                <label class="req" for="so-customer">Klant</label>
                <select class="select" id="so-customer" [ngModel]="data.order.customerId"
                        (ngModelChange)="setCustomer(+$event)">
                  @for (customer of customers(); track customer.id) {
                    <option [ngValue]="customer.id">{{ customer.company }}</option>
                  }
                </select>
              </div>
              <div class="field">
                <label class="req" for="so-country">Land van levering</label>
                <select class="select" id="so-country" [ngModel]="data.order.countryCode"
                        (ngModelChange)="patch({ countryCode: $event })">
                  @for (country of countries(); track country.code) {
                    <option [ngValue]="country.code">{{ country.name }}</option>
                  }
                </select>
              </div>
              <div class="field">
                <label for="so-incoterm">Incoterm</label>
                <select class="select" id="so-incoterm" [ngModel]="data.order.incoterm"
                        (ngModelChange)="patch({ incoterm: $event })">
                  @for (term of incoterms; track term) {
                    <option [ngValue]="term">{{ term }}</option>
                  }
                </select>
              </div>
              <div class="field">
                <label for="so-pay">Betaalvoorwaarden <span class="opt"></span></label>
                <select class="select" id="so-pay" [ngModel]="paymentChoice()"
                        (ngModelChange)="pickPaymentTerms($event)">
                  <option value="">Van de klant</option>
                  @for (term of paymentTermsList; track term) {
                    <option [value]="term">{{ term }}</option>
                  }
                  <option value="__other__">Anders…</option>
                </select>
                @if (customPaymentTerms()) {
                  <input class="input mt-8" aria-label="Eigen betaalvoorwaarden"
                         placeholder="Eigen voorwaarden…" [ngModel]="data.order.paymentTerms"
                         (ngModelChange)="patch({ paymentTerms: $event })" />
                }
                <span class="hint">
                  Standaard gebruiken we de voorwaarden uit het klantprofiel.
                </span>
              </div>
              <div class="field">
                <label for="so-date">Datum</label>
                <app-date-field fieldId="so-date" [value]="data.order.orderDate"
                                (valueChange)="patch({ orderDate: $event })" />
              </div>
              <div class="field">
                <label for="so-valid">Geldig tot</label>
                <app-date-field fieldId="so-valid" [value]="data.order.validUntil"
                                (valueChange)="patch({ validUntil: $event })" />
              </div>
            </div>

            <details class="progressive-panel" [open]="!!data.order.notes || !!data.order.internalNotes">
              <summary>
                <span>Notities</span>
                <span class="progressive-panel__summary">
                  {{ data.order.notes || data.order.internalNotes ? 'ingevuld' : 'optioneel' }}
                </span>
              </summary>
              <div class="progressive-panel__body form-grid">
                <div class="field span-2">
                  <label for="so-notes">Bericht op de offerte <span class="opt"></span></label>
                  <textarea class="textarea" id="so-notes" [ngModel]="data.order.notes"
                            (ngModelChange)="patch({ notes: $event })"
                            placeholder="Bijvoorbeeld een afspraak of persoonlijke toelichting."></textarea>
                  <span class="hint">Zichtbaar voor de klant.</span>
                </div>
                <div class="field span-2">
                  <label for="so-internal">Interne notities <span class="opt"></span></label>
                  <textarea class="textarea" id="so-internal"
                            [ngModel]="data.order.internalNotes"
                            (ngModelChange)="patch({ internalNotes: $event })"
                            placeholder="Wat moet het team over deze order weten?"></textarea>
                  <span class="hint">Alleen zichtbaar in het ERP.</span>
                </div>
              </div>
            </details>
            </fieldset>
          </div>
          </div></div>
        </section>

        <!-- Pricing is important but not part of every edit. It remains one
             obvious, resumable section instead of a wall of fields. -->
        <section class="card form-card" aria-labelledby="pricing-title">
          <button class="section-toggle section-toggle--quiet" type="button"
                  (click)="toggle('pricing')" [attr.aria-expanded]="isOpen('pricing')"
                  aria-controls="pricing-body">
            <span class="section-toggle__icon" aria-hidden="true">%</span>
            <span class="section-toggle__copy">
              <strong id="pricing-title">Prijsregels</strong>
              <span>{{ pricingSummary() }}</span>
            </span>
            <span class="section-toggle__chev" aria-hidden="true"
                  [class.section-toggle__chev--open]="isOpen('pricing')">›</span>
          </button>
          <div class="collapse" id="pricing-body"
               [class.collapse--open]="isOpen('pricing')"><div class="collapse__inner">
          <div class="card__body">
            <fieldset class="form-lock" [disabled]="!canEdit()">
            <p class="card-intro">Bepaal waar de verkoopprijs vandaan komt. Handmatig aangepaste stukprijzen worden gewist wanneer je wisselt.</p>
            <div class="segmented" role="group" aria-label="Prijsopbouw">
              <button type="button" [class.segmented__active]="data.order.markupMode === 'PRODUCT'"
                      [attr.aria-pressed]="data.order.markupMode === 'PRODUCT'"
                      (click)="setMarkupMode('PRODUCT')">
                Per product
              </button>
              <button type="button" [class.segmented__active]="data.order.markupMode === 'ORDER'"
                      [attr.aria-pressed]="data.order.markupMode === 'ORDER'"
                      (click)="setMarkupMode('ORDER')">
                Hele order
              </button>
            </div>
            @if (data.order.markupMode === 'ORDER') {
              <div class="field price-field">
                <label for="so-markup">Opslag op kostprijs</label>
                <div class="input-affix">
                  <input class="input num right" id="so-markup" type="number" min="0" step="1"
                         inputmode="decimal" [ngModel]="data.order.orderMarkupPct"
                         (ngModelChange)="patch({ orderMarkupPct: +$event })" />
                  <span class="input-affix__suffix">%</span>
                </div>
              </div>
            } @else {
              <div class="mode-explanation">
                <span aria-hidden="true">✓</span>
                Elk product gebruikt zijn eigen opslag uit de catalogus.
              </div>
            }

            <details class="progressive-panel"
                     [open]="!!data.order.extraDiscountPct || !!data.order.extraDiscountLabel">
              <summary>
                <span>Extra orderkorting</span>
                <span class="progressive-panel__summary">
                  {{ data.order.extraDiscountPct ? (data.order.extraDiscountPct + '%') : 'optioneel' }}
                </span>
              </summary>
              <div class="progressive-panel__body">
                <p class="panel-help">
                  Bovenop staffelkorting, bijvoorbeeld voor een beursactie. De omschrijving
                  verschijnt op de offerte.
                </p>
              <div class="field-row price-discount-fields">
                <div class="field">
                  <label for="so-extra-pct">Percentage</label>
                  <div class="input-affix">
                    <input class="input num right" id="so-extra-pct" type="number" min="0" max="100"
                           step="0.5" inputmode="decimal" [ngModel]="data.order.extraDiscountPct"
                           (ngModelChange)="patch({ extraDiscountPct: $event === null ? null : +$event })" />
                    <span class="input-affix__suffix">%</span>
                  </div>
                </div>
                <div class="field">
                  <label for="so-extra-label">Omschrijving</label>
                  <input class="input" id="so-extra-label" placeholder="Beurskorting"
                         [value]="data.order.extraDiscountLabel ?? ''"
                         (change)="patch({ extraDiscountLabel: $any($event.target).value })" />
                </div>
              </div></div>
            </details>
            </fieldset>
          </div>
          </div></div>
        </section>

        <!-- ==================================== lines -->
        <section class="card products-card" id="order-lines" aria-labelledby="order-lines-title">
          <div class="products-card__head">
            <div class="section-heading">
              <span class="section-heading__number">2</span>
              <div>
                <h2 id="order-lines-title">Producten</h2>
                <p>{{ data.priced.lines.length ? (data.priced.totals.pieces | num) + ' stuks in deze offerte' : 'Bouw de offerte regel voor regel op' }}</p>
              </div>
            </div>
            <button class="btn btn--primary btn--sm add-product" type="button"
                    [disabled]="!canEdit() || !available().length" (click)="openPicker()">
              <span aria-hidden="true">＋</span> Product
            </button>
          </div>

          <div class="product-lines">
            @for (line of data.priced.lines; track line.productId; let index = $index) {
              <article class="order-line" [attr.aria-labelledby]="'line-title-' + line.productId">
                <div class="order-line__head">
                  @if (line.photoUrl) {
                    <img class="order-line__photo" [appAuthSrc]="line.photoUrl"
                         alt="" loading="lazy" />
                  } @else {
                    <span class="order-line__photo order-line__photo--empty" aria-hidden="true">◇</span>
                  }
                  <div class="order-line__identity">
                    <span class="order-line__index">Regel {{ index + 1 }} · {{ line.sku }}</span>
                    <h3 [id]="'line-title-' + line.productId">{{ line.description }}</h3>
                    <span>
                      {{ line.cartons | num }} {{ line.cartons === 1 ? 'doos' : 'dozen' }} ·
                      @if (!isLooseCartons(data) && !data.order.pallets.length) {
                        {{ line.pallets }} {{ line.pallets === 1 ? 'pallet' : 'pallets' }} ·
                      }
                      {{ line.cbm | cbm }}
                    </span>
                  </div>
                  <div class="order-line__amount">
                    <strong>{{ line.net | eur }}</strong>
                    @if (line.discountPct) {
                      <span>Regelkorting −{{ line.discountPct | pct: 1 }}</span>
                    }
                  </div>
                </div>

                <div class="line-quick-controls">
                  <div class="quantity-editor">
                    <div class="field">
                      <label [attr.for]="'q-' + line.productId">Aantal stuks</label>
                      <input class="input num" [id]="'q-' + line.productId" type="number"
                             min="0" step="1" inputmode="numeric" [disabled]="!canEdit()"
                             [ngModel]="line.quantity"
                             (ngModelChange)="setLineQuantity(line.productId, +$event)" />
                      @if (linePending()[line.productId]; as to) {
                        <span class="hint warn-text" role="status">
                          Volle doos: wordt <b>{{ to | num }} stuks</b>
                        </span>
                      }
                    </div>
                  </div>

                  <details class="line-pricing">
                    <summary>
                      <span>Prijs aanpassen</span>
                      <span>{{ line.unitPrice | eur: 2 }} / stuk@if (line.manualPercent) { · {{ line.manualPercent | pct: 1 }} extra }</span>
                    </summary>
                    <div class="line-pricing__fields">
                      <div class="field">
                        <label [attr.for]="'p-' + line.productId">Stukprijs</label>
                        <input class="input num" [id]="'p-' + line.productId" type="number"
                               min="0" step="0.01" inputmode="decimal" [disabled]="!canEdit()"
                               [ngModel]="line.unitPrice"
                               (ngModelChange)="setLine(line.productId, { unitPriceEur: +$event })" />
                      </div>
                      <div class="field">
                        <label [attr.for]="'d-' + line.productId">Extra korting</label>
                        <div class="input-affix">
                          <input class="input num" [id]="'d-' + line.productId" type="number"
                                 min="0" max="100" step="0.5" inputmode="decimal"
                                 [disabled]="!canEdit()" [ngModel]="line.manualPercent"
                                 (ngModelChange)="setLine(line.productId, { manualDiscountPct: +$event })" />
                          <span class="input-affix__suffix">%</span>
                        </div>
                      </div>
                    </div>
                  </details>
                </div>
                @if (line.nextTierAtQuantity) {
                  <div class="tier-nudge">
                    <span aria-hidden="true">↗</span>
                    <span>Nog <b>{{ line.nextTierAtQuantity - line.quantity | num }}</b> stuks voor {{ line.nextTierPercent | pct: 0 }} korting</span>
                  </div>
                }

                <div class="delivery order-line__delivery">
                  <div class="delivery-row">
                    <span class="stock-dot"
                          [class.stock-dot--none]="line.inventoryKnown && !line.inStock && !line.deliveryWeek"
                          [class.stock-dot--low]="!line.inventoryKnown && !line.deliveryWeek"
                          [class.stock-dot--ok]="line.inStock || line.deliveryWeek"></span>
                    <span class="delivery-row__copy">
                      @if (!line.inventoryKnown) {
                        <b>Voorraad nog niet bevestigd</b>
                        <span>Vul de leverweek in zodra de beschikbaarheid is bevestigd.</span>
                      } @else if (line.inStock) {
                        <b>Op voorraad</b>
                        <span>Leverbaar vanaf {{ line.deliveryDate | dateNl }}@if (line.deliveryWeek) { · {{ line.deliveryWeek | weekNl: 'short' }} }</span>
                      } @else if (line.deliveryWeek) {
                        <b>Levering {{ line.deliveryWeek | weekNl }}</b>
                        <span>{{ line.shortfall ?? 0 | num }} stuks niet op voorraad</span>
                      } @else {
                        <b class="danger-text">Levertermijn nodig</b>
                        <span>{{ line.shortfall ?? 0 | num }} stuks niet op voorraad</span>
                      }
                    </span>
                    <button class="delivery-edit" type="button" [disabled]="!canEditTerms()"
                            [attr.aria-label]="editingDelivery() === line.productId
                              ? 'Leverweek sluiten voor ' + line.description
                              : (!line.inStock && !line.deliveryWeek
                                ? 'Leverweek invullen voor ' + line.description
                                : 'Leverweek wijzigen voor ' + line.description)"
                            [attr.aria-expanded]="editingDelivery() === line.productId"
                            [attr.aria-controls]="'delivery-week-' + line.productId"
                            (click)="toggleDelivery(line.productId)">
                      {{ editingDelivery() === line.productId
                          ? 'Sluiten'
                          : (!line.inStock && !line.deliveryWeek ? 'Invullen' : 'Wijzigen') }}
                    </button>
                  </div>
                  @if (editingDelivery() === line.productId) {
                    <div class="delivery-week" [id]="'delivery-week-' + line.productId">
                      <div class="field">
                        <label [attr.for]="'w-' + line.productId">Beloofde leverweek <span class="opt"></span></label>
                        <app-week-field [fieldId]="'w-' + line.productId"
                                        [value]="weekOf(line.productId)"
                                        (valueChange)="setLine(line.productId, { deliveryWeek: $event })" />
                        <span class="hint">Deze week wordt zichtbaar voor de klant.</span>
                      </div>
                    </div>
                  }
                </div>

                @if (privacy.showPurchase()) {
                  <details class="line-internal">
                    <summary class="line-internal__summary">
                      <span class="line-internal__title">
                        <span class="line-internal__privacy">Alleen intern</span>
                        <strong>Rendabiliteit per stuk</strong>
                      </span>
                      <span class="line-internal__profit"
                            [class.line-internal__profit--negative]="marginPerUnit(line) < 0">
                        {{ marginPerUnit(line) < 0 ? 'Verlies' : 'Winst' }}
                        {{ absolute(marginPerUnit(line)) | eur: 2 }} / stuk
                      </span>
                    </summary>

                    <div class="line-internal__body">
                      <dl class="line-internal__units">
                        <div>
                          <dt>Netto verkoop</dt>
                          <dd>{{ line.netUnitPrice | eur: 2 }}<small>/ stuk</small></dd>
                        </div>
                        <div>
                          <dt>Gelande kost</dt>
                          <dd>{{ line.landedUnitCost | eur: 4 }}<small>/ stuk</small></dd>
                        </div>
                        <div class="line-internal__unit-profit"
                             [class.line-internal__unit-profit--negative]="marginPerUnit(line) < 0">
                          <dt>{{ marginPerUnit(line) < 0 ? 'Verlies' : 'Winst' }} per stuk</dt>
                          <dd>{{ absolute(marginPerUnit(line)) | eur: 2 }}<small>/ stuk</small></dd>
                        </div>
                      </dl>

                      <div class="line-internal__total">
                        <span>
                          Totale regel{{ line.marginEur < 0 ? 'verlies' : 'winst' }}
                          <small>{{ line.quantity | num }} stuks, na regelkorting</small>
                        </span>
                        <strong [class.ok-text]="line.marginEur >= 0"
                                [class.danger-text]="line.marginEur < 0">
                          {{ absolute(line.marginEur) | eur: 2 }}
                        </strong>
                      </div>
                      <p class="line-internal__note">
                        Vóór orderkorting en vracht; de definitieve winst staat bij Controleren.
                      </p>
                    </div>
                  </details>
                }

                <div class="order-line__foot">
                  <button class="remove-line" type="button" [disabled]="!canEdit()"
                          (click)="removeLine(line.productId)">
                    <span aria-hidden="true">×</span> Verwijderen
                  </button>
                </div>
              </article>
            } @empty {
              <div class="products-empty">
                <div class="products-empty__art" aria-hidden="true"><span>＋</span></div>
                <h3>Nog geen producten</h3>
                <p>Voeg een product toe, kies het aantal en de prijs wordt meteen berekend.</p>
                <button class="btn btn--primary" type="button"
                        [disabled]="!canEdit() || !available().length"
                        (click)="openPicker()">Eerste product toevoegen</button>
              </div>
            }
          </div>
        </section>

        <!-- ==================================== transport and delivery -->
        <section class="card logistics-card" id="quote-logistics" aria-labelledby="logistics-title">
          <div class="section-card-head">
            <div class="section-heading">
              <span class="section-heading__number">3</span>
              <div>
                <h2 id="logistics-title">Transport &amp; levering</h2>
                <p>{{ palletSummary() }}</p>
              </div>
            </div>
          </div>
          <div class="logistics-grid">
            <div class="logistics-option">
              <div class="logistics-option__icon" aria-hidden="true">
                {{ isLooseCartons(data) ? '▤' : '▦' }}
              </div>
              <div class="logistics-option__copy">
                <strong>Transport</strong>
                <span>
                  @if (isLooseCartons(data)) {
                    {{ data.priced.totals.cbm | cbm }} · losse dozen
                  } @else {
                    {{ data.order.pallets.length ? 'Zelf ingedeeld' : 'Automatische indeling' }}
                  }
                </span>
                @if (data.order.freight === 'TE_BEPALEN') {
                  <span class="danger-text">Vrachtprijs nog te bepalen</span>
                } @else {
                  <span>{{ freightStrategyLabel(data) }} · {{ data.priced.totals.freight | eur }}</span>
                }
              </div>
              @if (!isLooseCartons(data) && data.order.pallets.length) {
                <span class="badge" [class]="layoutOk() ? 'badge--ok' : 'badge--warn'">
                  {{ layoutOk() ? 'compleet' : 'nakijken' }}
                </span>
              }
              <button class="btn btn--sm" type="button" [disabled]="!canEditTerms()"
                      (click)="canEdit() ? palletSheet.set(true) : freightOpen.set(!freightOpen())"
                      [attr.aria-expanded]="canEdit() ? palletSheet() : freightOpen()"
                      [attr.aria-haspopup]="canEdit() ? 'dialog' : null"
                      [attr.aria-controls]="canEdit() ? null : 'freight-options'">
                {{ !canEdit() && freightOpen() ? 'Sluiten' : 'Aanpassen' }}
              </button>

              @if (!isLooseCartons(data) && data.priced.totals.unassignedCartons > 0) {
                <div class="logistics-option__warning">
                  {{ data.priced.totals.unassignedCartons }} dozen zijn nog niet toegewezen.
                </div>
              }

              @if (!canEdit() && freightOpen()) {
                <div class="freight-options" id="freight-options">
                  <label class="check-option">
                    <input type="checkbox" [checked]="data.order.freight === 'TE_BEPALEN'"
                           (change)="setFreightPending($any($event.target).checked)" />
                    <span>
                      <strong>Later bepalen</strong>
                      <small>De klant ziet geen bedrag; vracht telt nog niet mee.</small>
                    </span>
                  </label>
                  <div class="field">
                    <label for="so-freight-strategy">Prijsstrategie</label>
                    <select class="select" id="so-freight-strategy"
                            [value]="effectiveFreightStrategy(data)"
                            (change)="setLockedFreightStrategy($any($event.target).value)">
                      @if (!isLooseCartons(data)) {
                        <option value="COUNTRY_PALLET">Landentarief per pallet</option>
                      }
                      <option value="PER_CBM">Tarief per m³</option>
                      <option value="FIXED">Vast bedrag</option>
                    </select>
                  </div>
                  @if (effectiveFreightStrategy(data) === 'PER_CBM') {
                    <div class="field">
                      <label for="so-freight-cbm">Tarief per m³</label>
                      <div class="input-prefix">
                        <span>€</span>
                        <input class="input num" id="so-freight-cbm" type="number" min="0"
                               step="0.01" inputmode="decimal"
                               [value]="data.order.freightRatePerCbmEur ?? ''"
                               (change)="setFreightCbmRate($any($event.target).value)" />
                      </div>
                    </div>
                  } @else if (effectiveFreightStrategy(data) === 'FIXED') {
                    <div class="field">
                      <label for="so-freight">Vast vrachtbedrag</label>
                      <div class="input-prefix">
                        <span>€</span>
                        <input class="input num" id="so-freight" type="number" min="0"
                               step="0.01" inputmode="decimal"
                               [value]="data.order.manualFreightEur ?? ''"
                               (change)="setManualFreight($any($event.target).value)" />
                      </div>
                    </div>
                  }
                  @if (data.order.freight === 'TE_BEPALEN') {
                    <span class="hint">Vul de prijs in en zet ‘Later bepalen’ uit wanneer hij klaar is.</span>
                  }
                </div>
              }
            </div>
          </div>
        </section>

        <!-- ==================================== totals -->
        <section class="card totals-card" id="quote-check" aria-labelledby="totals-title">
          <div class="section-card-head">
            <div class="section-heading">
              <span class="section-heading__number">4</span>
              <div>
                <h2 id="totals-title">Controleren</h2>
                <p>Bedragen, minimumorder en winst vóór het versturen</p>
              </div>
            </div>
          </div>
          <div class="card__body">
            <div class="total-highlight">
              <div>
                <span>Offertetotaal</span>
                <strong>{{ data.priced.totals.total | eur }}</strong>
                <small class="quote-total__meta">
                  <span>{{ data.priced.totals.vatLegalMention ? 'BTW verlegd' : 'exclusief BTW' }}</span>
                  @if (privacy.showPurchase()) {
                    <span class="quote-profit"
                          [class.quote-profit--negative]="data.priced.totals.marginEur < 0">
                      Winst {{ data.priced.totals.marginEur >= 0 ? '+' : '' }} {{ data.priced.totals.marginEur | eur: 0 }}
                    </span>
                  }
                </small>
              </div>
              @if (!data.priced.totals.vatLegalMention) {
                <div>
                  <span>Inclusief BTW</span>
                  <strong>{{ data.priced.totals.totalInclVat | eur }}</strong>
                  <small>{{ data.priced.totals.vatRatePct | pct: 1 }} BTW</small>
                </div>
              }
            </div>

            @if (data.order.countryCode && data.priced.validation.minOrderValue > 0) {
              <div class="minimum-check" [class.minimum-check--ok]="data.priced.validation.meetsMinimum">
                <div class="minimum-check__copy">
                  <strong>
                    {{ data.priced.validation.meetsMinimum ? 'Minimumorder bereikt' : 'Minimumorder nog niet bereikt' }}
                  </strong>
                  <span>
                    {{ data.priced.totals.goodsTotal | eur: 0 }} van
                    {{ data.priced.validation.minOrderValue | eur: 0 }}
                  </span>
                </div>
                <span class="minimum-check__value">
                  @if (data.priced.validation.meetsMinimum) { ✓ }
                  @else { −{{ data.priced.validation.shortfall | eur: 0 }} }
                </span>
                <div class="meter__track" aria-hidden="true">
                  <div class="meter__fill"
                       [class.meter__fill--ok]="data.priced.validation.meetsMinimum"
                       [style.width.%]="minimumPercent()"></div>
                </div>
              </div>
            }

            <section class="cost-breakdown" aria-labelledby="price-breakdown-title">
              <div class="cost-breakdown__head">
                <h3 id="price-breakdown-title">Prijsopbouw</h3>
              </div>
              <div class="cost-breakdown__body">
            <div class="cost-section">Goederen</div>
            <div class="stat-row"><span>Bruto goederen</span>
              <span class="num">{{ data.priced.totals.gross | eur }}</span></div>
            <div class="stat-row stat-row--discount"><span>Kortingen op regels</span>
              <span class="num">− {{ data.priced.totals.lineDiscountTotal | eur }}</span></div>
            <div class="stat-row stat-row--discount">
              <span>Orderkorting {{ data.priced.totals.orderDiscountPercent | pct: 0 }}</span>
              <span class="num">− {{ data.priced.totals.orderDiscountAmount | eur }}</span></div>
            <div class="stat-row stat-row--sub"><span>Goederenwaarde</span>
              <span class="num">{{ data.priced.totals.goodsTotal | eur }}</span></div>
            <!-- Freight can be an open item, just like the delivery term: a
                 destination outside the usual rates, or a customer arranging
                 pickup, is unknown at drafting time. -->
            <div class="cost-section">Verzending</div>
            <div class="stat-row">
              <span>Vracht ({{ freightBasisLabel(data) }})</span>
              <span class="num">
                @if (data.order.freight === 'TE_BEPALEN') {
                  <span class="danger-text">nog te bepalen</span>
                } @else {
                  {{ data.priced.totals.freight | eur }}
                }
              </span></div>
            <div class="stat-row"><span>Administratie</span>
              <span class="num">{{ data.priced.totals.handling | eur }}</span></div>
            @if (!data.priced.totals.vatLegalMention) {
              <div class="cost-section">BTW</div>
              <div class="stat-row"><span>BTW {{ data.priced.totals.vatRatePct | pct: 1 }}</span>
                <span class="num">{{ data.priced.totals.vatAmount | eur }}</span></div>
            }

            @if (data.priced.totals.vatLegalMention) {
              <div class="alert alert--info mt-12">
                <span class="alert__icon">§</span>
                <div>
                  <b>{{ vatLabel(data.priced.totals.vatTreatment) }}</b><br />
                  {{ data.priced.totals.vatLegalMention }}
                </div>
              </div>
            } @else if (data.priced.totals.vatReason) {
              <div class="tiny muted mt-8">{{ data.priced.totals.vatReason }}</div>
              }
              </div>
            </section>
          </div>
        </section>

        <!-- ==================================== sending the quote -->
        <section class="card send-card" id="quote-status" aria-labelledby="send-title">
          <div class="send-card__head">
            <div class="send-card__icon" [class.send-card__icon--ok]="!sendIssues().length"
                 aria-hidden="true">{{ sendIssues().length ? '!' : '✓' }}</div>
            <div>
              <h2 id="send-title">
                {{ sendIssues().length ? 'Nog niet klaar om te versturen' : 'Klaar voor de klant' }}
              </h2>
              <p>
                {{ sendIssues().length
                    ? 'Los onderstaande punten op; daarna kun je meteen versturen.'
                    : 'Klant, producten en minimumorder zijn gecontroleerd.' }}
              </p>
            </div>
          </div>
          <div class="send-card__body">
            @if (sendIssues().length) {
              <ul class="send-issues">
                @for (issue of sendIssues(); track issue) { <li>{{ issue }}</li> }
              </ul>
            }
            <div class="status-actions">
              <button class="btn" type="button" (click)="openCustomerPreview()">
                Klantweergave openen
              </button>
              @if (customerPortalLink(); as portalLink) {
                @if (portalLink.available && portalLink.url) {
                  <button class="btn" type="button" (click)="copyLink()">
                    Klantlink kopiëren
                  </button>
                }
              }
            </div>
            @if (canDelete()) {
              <button class="delete-draft" type="button" (click)="remove()">
                Dit concept verwijderen
              </button>
            }
          </div>
        </section>
        </div>
        </div>
      </main>

      @if (pdfSheet()) {
        <app-sheet title="Offerte als PDF" (closed)="pdfSheet.set(false)">
          <div body>
            <div class="field">
              <label for="pdf-lang">Taal</label>
              <select class="select" id="pdf-lang" [ngModel]="pdfLanguage()"
                      (ngModelChange)="pdfLanguage.set($event)">
                @for (language of languages; track language.code) {
                  <option [value]="language.code">
                    {{ language.label }}@if (language.code === customerLanguage()) { — taal van de klant }
                  </option>
                }
              </select>
              <span class="hint">
                Standaard de taal van de klant. Versturen gebruikt altijd die taal, ongeacht
                wat je hier kiest.
              </span>
            </div>

            <!-- The packing slip travels with the goods: pallets when they
                 are laid out, plain lines otherwise. Never a requirement. -->
            <button class="btn btn--block btn--stacked mt-8" type="button"
                    (click)="downloadPackingSlip()">
              <span>Pakbon downloaden</span>
              <span class="btn__sub">
                {{ view() && isLooseCartons(view()!)
                    ? 'per product; volume uit omdozen'
                    : view()?.order?.pallets?.length
                      ? 'per pallet, met type en hoogte'
                      : 'per product; automatische palletberekening' }}
              </span>
            </button>
          </div>
          <div foot style="display:contents">
            <button class="btn" type="button" (click)="pdfSheet.set(false)">Annuleren</button>
            <button class="btn btn--primary" type="button" (click)="downloadPdf()">
              Downloaden
            </button>
          </div>
        </app-sheet>
      }

      @if (palletSheet()) {
        <app-sheet title="Transport &amp; levering" [wide]="true" (closed)="palletSheet.set(false)">
          <div body>
            @if (view(); as data) {
              <app-shipping-planner
                [view]="data"
                [canEdit]="canEdit()"
                (patch)="applyShippingPatch($event)"
                (action)="handlePalletAction($event)"
              />
            }
          </div>
          <div foot style="display:contents">
            <button class="btn btn--primary btn--block" type="button"
                    (click)="palletSheet.set(false)">Klaar</button>
          </div>
        </app-sheet>
      }

    @if (picking()) {
        <app-product-picker
          heading="Product toevoegen"
          [products]="available()"
          [priceOf]="priceOf"
          (picked)="addLine($event)"
          (cancelled)="picking.set(false)"
        />
      }

      @if (sendSheet()) {
        <app-sheet title="Offerte versturen" (closed)="sendSheet.set(false)">
          <div body>
            <p class="small muted" style="margin-bottom:14px">
              De klant krijgt de PDF in bijlage en een link om de offerte online te bekijken,
              te tekenen of een wijziging voor te stellen.
            </p>
            <div class="field">
              <label for="send-message">Persoonlijk bericht</label>
              <textarea class="textarea" id="send-message" [ngModel]="sendMessage()"
                        (ngModelChange)="sendMessage.set($event)"></textarea>
            </div>
          </div>
          <div foot style="display:contents">
            <button class="btn" type="button" (click)="sendSheet.set(false)">Annuleren</button>
            <button class="btn btn--primary" type="button"
                    [disabled]="sending() || sendIssues().length > 0"
                    (click)="send()">{{ sending() ? 'Bezig…' : 'Versturen' }}</button>
          </div>
        </app-sheet>
      }
    } @else {
      <app-page-header title="Offerte" subtitle="Verkoop" [showBack]="true"
                       [showBell]="false" />
      <main class="content sales-state" aria-live="polite">
        @if (loadError()) {
          <section class="card load-error" role="alert">
            <div class="load-error__icon" aria-hidden="true">!</div>
            <h2>Offerte niet beschikbaar</h2>
            <p>{{ loadError() }}</p>
            <button class="btn btn--primary" type="button" (click)="retryLoad()">
              Opnieuw proberen
            </button>
          </section>
        } @else if (loading()) {
          <div class="skel loading-hero" aria-hidden="true"></div>
          <div class="skel loading-card" aria-hidden="true"></div>
          <div class="skel loading-card" aria-hidden="true"></div>
          <span class="sr-only">Offerte laden…</span>
        } @else {
          <section class="card load-error" role="status">
            <div class="load-error__icon" aria-hidden="true">?</div>
            <h2>Geen offerte geselecteerd</h2>
            <p>Ga terug naar Verkoop en open een offerte.</p>
          </section>
        }
      </main>
    }
  `,
  styles: [`
    :host { display:block }
    .sales-page { max-width:1120px }
    .sales-page>*+* { margin-top:12px }
    #quote-setup,#order-lines,#quote-logistics,#quote-check,#quote-status { scroll-margin-top:calc(var(--appbar-h) + 76px) }
    .sr-only { position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0 }

    .quote-header-actions { display:flex;align-items:center;gap:5px }
    .quote-header-total { min-width:0;padding-right:3px;display:flex;flex-direction:column;align-items:flex-end;line-height:1.08;white-space:nowrap }
    .quote-header-total span { display:none;color:var(--muted);font-size:8.5px;font-weight:720;letter-spacing:.06em;text-transform:uppercase }
    .quote-header-total strong { font-size:12px;font-variant-numeric:tabular-nums }
    .quote-header-button { min-width:0;padding-inline:10px }
    @media(max-width:380px) {
      .quote-header-actions { gap:3px }
      .quote-header-total { padding-right:0 }
      .quote-header-total strong { font-size:11px }
      .quote-header-button { padding-inline:7px;font-size:12px }
    }
    @media(max-width:340px) {
      .quote-header-total { display:none }
    }

    .quote-hero { overflow:hidden;border-radius:22px;color:#fff;background:radial-gradient(circle at 92% 0%,color-mix(in srgb,var(--rose-mid) 42%,transparent),transparent 42%),linear-gradient(145deg,#211a17,#33251f 62%,color-mix(in srgb,var(--rose-dark) 58%,#211a17));box-shadow:0 12px 32px rgb(26 22 20/.15) }
    .quote-hero__top { display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:18px }
    .quote-hero__top>div:first-child { min-width:0;flex:1 }
    .quote-hero__eyebrow { color:rgb(255 255 255/.58);font-size:10px;font-weight:750;letter-spacing:.14em;text-transform:uppercase }
    .quote-hero__customer { margin-top:3px;font-size:clamp(20px,6vw,28px);font-weight:740;line-height:1.18;letter-spacing:-.025em }
    .quote-hero__meta { margin-top:4px;color:rgb(255 255 255/.66);font-size:12px }
    .history-button { min-height:44px;padding:5px 8px 5px 6px;display:flex;align-items:center;gap:5px;border:1px solid rgb(255 255 255/.14);border-radius:99px;background:rgb(255 255 255/.09);cursor:pointer;flex:none }
    .history-button .badge { background:#fff;border-color:#fff;color:#2c231f }
    .history-button__chev { color:rgb(255 255 255/.7);transition:transform .18s }
    .history-button__chev--open { transform:rotate(180deg) }
    .quote-hero__facts { display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border-top:1px solid rgb(255 255 255/.1);background:rgb(0 0 0/.1) }
    .hero-fact { min-width:0;padding:12px 7px;text-align:center }
    .hero-fact+.hero-fact { border-left:1px solid rgb(255 255 255/.1) }
    .hero-fact__label { display:block;color:rgb(255 255 255/.54);font-size:9px;font-weight:720;letter-spacing:.08em;text-transform:uppercase }
    .hero-fact strong { display:block;overflow:hidden;font-size:17px;font-variant-numeric:tabular-nums;text-overflow:ellipsis;white-space:nowrap }
    .hero-fact>span:last-child { display:block;color:rgb(255 255 255/.58);font-size:10px }
    .hero-fact--total strong { color:color-mix(in srgb,var(--rose-mid) 35%,#fff) }
    .quote-history { padding:6px 18px 14px;border-top:1px solid rgb(255 255 255/.1) }
    .quote-history__title { padding:10px 0 4px;color:rgb(255 255 255/.52);font-size:10px;font-weight:720;letter-spacing:.1em;text-transform:uppercase }
    .quote-history .step+.step { border-color:rgb(255 255 255/.1) }
    .quote-history .step__meta,.quote-history .step__detail { color:rgb(255 255 255/.55) }
    .quote-history .step__dot { background:rgb(255 255 255/.42) }
    .reference-alert,.quote-lock { align-items:center;flex-wrap:wrap }
    .reference-alert .btn,.quote-lock .btn { min-height:44px;margin-left:auto }
    .revision-card { border-color:color-mix(in srgb,var(--gold) 48%,var(--line)) }

  `, `

    .workflow-layout { position:relative }
    .workflow-nav { position:sticky;top:calc(var(--appbar-h) + 8px);z-index:30;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:3px;padding:5px;border:1px solid var(--line);border-radius:16px;background:rgb(255 255 255/.92);box-shadow:0 5px 18px rgb(26 22 20/.08);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px) }
    .workflow-nav button { min-width:0;min-height:42px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;padding:4px 2px;border:0;border-radius:11px;background:transparent;color:var(--muted);font-size:10px;font-weight:670;cursor:pointer }
    .workflow-nav button:active { background:var(--surface-2) }
    .workflow-nav button span { width:19px;height:19px;display:grid;place-items:center;border:1px solid var(--line-strong);border-radius:50%;color:var(--ink-2) }
    .workflow-nav .workflow-nav__active { background:var(--rose-soft);color:var(--rose-dark) }
    .workflow-nav .workflow-nav__active span { border-color:var(--rose-line);background:var(--surface);color:var(--rose-dark) }
    .workflow-content { min-width:0;margin-top:12px }
    .workflow-content>*+* { margin-top:12px }

    .form-lock { border:0;margin:0;min-inline-size:0;padding:0 }
    .section-toggle { width:100%;min-height:68px;padding:12px 14px;display:flex;align-items:center;gap:11px;border:0;background:var(--surface);text-align:left;cursor:pointer }
    .section-toggle:hover { background:var(--surface-2) }
    .section-toggle__number,.section-heading__number { width:32px;height:32px;flex:none;display:grid;place-items:center;border-radius:11px;background:var(--rose-soft);color:var(--rose-dark);font-size:13px;font-weight:780 }
    .section-toggle__icon { width:32px;height:32px;flex:none;display:grid;place-items:center;border:1px solid var(--line);border-radius:11px;background:var(--surface-2);color:var(--muted);font-weight:720 }
    .section-toggle__copy { min-width:0;flex:1;display:flex;flex-direction:column }
    .section-toggle__copy strong { font-size:15px }
    .section-toggle__copy>span { overflow:hidden;color:var(--muted);font-size:11.5px;text-overflow:ellipsis;white-space:nowrap }
    .section-toggle__chev { color:var(--muted);font-size:18px;transition:transform .2s }
    .section-toggle__chev--open { transform:rotate(90deg) }
    .form-card .collapse--open { border-top:1px solid var(--line) }
    .card-intro,.panel-help { margin:0 0 14px;color:var(--muted);font-size:12px }
    .progressive-panel,.line-pricing,.cost-breakdown { border:1px solid var(--line);border-radius:13px;background:var(--surface-2);overflow:hidden }
    .progressive-panel { margin-top:4px }
    .progressive-panel summary,.line-pricing summary { min-height:48px;padding:11px 12px;display:flex;align-items:center;gap:10px;cursor:pointer;list-style:none;font-size:12.5px;font-weight:670 }
    .progressive-panel summary::-webkit-details-marker,.line-pricing summary::-webkit-details-marker { display:none }
    .progressive-panel summary:before,.line-pricing summary:before { content:'+';width:20px;height:20px;display:grid;place-items:center;flex:none;border-radius:50%;background:var(--surface);color:var(--muted);font-size:16px;font-weight:400 }
    .progressive-panel[open] summary:before,.line-pricing[open] summary:before { content:'−' }
    .progressive-panel summary>span:first-of-type,.line-pricing summary>span:first-of-type { flex:1 }
    .progressive-panel__summary,.line-pricing summary>span:last-child { color:var(--muted);font-size:11px;font-weight:520 }
    .progressive-panel__body { padding:14px 12px 0;border-top:1px solid var(--line);background:var(--surface) }
    .segmented { display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:4px;border:1px solid var(--line);border-radius:13px;background:var(--surface-2) }
    .segmented button { min-height:42px;padding:8px;border:0;border-radius:9px;background:transparent;color:var(--muted);font-size:12.5px;font-weight:650;cursor:pointer }
    .segmented .segmented__active { background:var(--surface);color:var(--ink);box-shadow:0 1px 5px rgb(26 22 20/.09) }
    .price-field { max-width:260px;margin:14px 0 0 }
    .mode-explanation { margin-top:12px;display:flex;gap:7px;color:var(--muted);font-size:12px }
    .mode-explanation span { color:var(--ok) }
    .price-discount-fields { padding-bottom:14px }
  `, `

    .products-card__head,.section-card-head { padding:14px;display:flex;align-items:center;justify-content:space-between;gap:10px;border-bottom:1px solid var(--line) }
    .section-heading { min-width:0;display:flex;align-items:center;gap:10px }
    .section-heading h2 { font-size:15px;line-height:1.25 }
    .section-heading p { overflow:hidden;color:var(--muted);font-size:11.5px;text-overflow:ellipsis;white-space:nowrap }
    .add-product { flex:none }
    .product-lines { padding:10px;background:color-mix(in srgb,var(--bg) 68%,var(--surface)) }
    .order-line { padding:12px;border:1px solid var(--line);border-radius:15px;background:var(--surface);box-shadow:0 1px 5px rgb(26 22 20/.04) }
    .order-line+.order-line { margin-top:10px }
    .order-line__head { display:grid;grid-template-columns:48px minmax(0,1fr) auto;gap:10px;align-items:center }
    .order-line__photo { width:48px;height:48px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2);object-fit:cover }
    .order-line__photo--empty { display:grid;place-items:center;color:var(--muted-2);font-size:20px }
    .order-line__identity { min-width:0;display:flex;flex-direction:column }
    .order-line__identity h3 { overflow:hidden;font-size:14px;line-height:1.25;text-overflow:ellipsis;white-space:nowrap }
    .order-line__identity>span { color:var(--muted);font-size:10.5px }
    .order-line__index { color:var(--muted-2)!important;font-size:9.5px!important;font-weight:700;text-transform:uppercase }
    .order-line__amount { display:flex;flex-direction:column;align-items:flex-end }
    .order-line__amount strong { font-size:14px;font-variant-numeric:tabular-nums }
    .order-line__amount span { color:var(--ok);font-size:10px }
    .line-quick-controls { margin-top:10px;display:grid;grid-template-columns:minmax(108px,.42fr) minmax(0,1fr);gap:8px;align-items:stretch }
    .quantity-editor { min-width:0;overflow:hidden;border:1px solid var(--line);border-radius:13px;background:var(--surface-2) }
    .quantity-editor:focus-within { border-color:var(--rose);box-shadow:0 0 0 3px var(--rose-soft) }
    .quantity-editor .field { height:100%;margin:0;padding:8px 10px 6px;display:grid;grid-template-rows:auto minmax(28px,1fr);align-content:center }
    .quantity-editor label { color:var(--ink-2);font-size:10.5px;line-height:1.15 }
    .quantity-editor .input { width:100%;min-height:28px;height:28px;padding:0;border:0;background:transparent;box-shadow:none;font-size:15px;font-weight:680;outline:0 }
    .tier-nudge { margin-top:8px;padding:8px 10px;display:flex;gap:8px;border-radius:10px;background:var(--gold-soft);color:#78591f;font-size:11px }
    .line-pricing { margin:0 }
    .line-pricing[open] { grid-column:1/-1 }
    .line-pricing summary { min-height:58px;padding:7px 9px;display:grid;grid-template-columns:20px minmax(0,1fr);grid-template-rows:auto auto;column-gap:9px;row-gap:2px;align-content:center }
    .line-pricing summary:before { grid-column:1;grid-row:1/3 }
    .line-pricing summary>span:first-of-type { grid-column:2;grid-row:1;font-size:10.5px;line-height:1.15 }
    .line-pricing summary>span:last-child { grid-column:2;grid-row:2;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px }
    .line-pricing__fields { display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:12px 10px 0;border-top:1px solid var(--line);background:var(--surface) }
    .order-line__delivery { margin-top:10px;padding:10px }
    .delivery-row { display:flex;align-items:center;gap:8px }
    .delivery-row__copy { min-width:0;flex:1;display:flex;flex-direction:column;font-size:11.5px }
    .delivery-row__copy b { font-size:12px }
    .delivery-row__copy span { overflow:hidden;color:var(--muted);text-overflow:ellipsis;white-space:nowrap }
    .delivery-edit,.remove-line,.delete-draft { min-height:44px;padding:7px 9px;border:0;border-radius:10px;background:transparent;color:var(--rose-dark);font-size:11.5px;font-weight:680;cursor:pointer }
    .delivery-week { margin-top:10px;padding-top:10px;border-top:1px solid var(--line) }
    .delivery-week .field { margin:0 }
    .line-internal { margin-top:10px;border:1px solid #e8d3ae;border-radius:13px;background:var(--surface);overflow:hidden }
    .line-internal__summary { min-height:50px;padding:8px 10px;display:grid;grid-template-columns:minmax(0,1fr) auto 16px;gap:8px;align-items:center;background:var(--warn-soft);cursor:pointer;list-style:none }
    .line-internal__summary::-webkit-details-marker { display:none }
    .line-internal__summary:after { content:'⌄';color:var(--muted);font-size:14px;transition:transform .18s }
    .line-internal[open] .line-internal__summary:after { transform:rotate(180deg) }
    .line-internal__title { min-width:0;display:flex;flex-direction:column;gap:1px }
    .line-internal__title strong { overflow:hidden;color:var(--ink);font-size:11.5px;line-height:1.25;text-overflow:ellipsis;white-space:nowrap }
    .line-internal__privacy { color:var(--warn);font-size:8.5px;font-weight:780;letter-spacing:.075em;text-transform:uppercase }
    .line-internal__profit { flex:none;padding:5px 7px;border-radius:999px;background:var(--ok-soft);color:var(--ok);font-size:9.5px;font-weight:760;font-variant-numeric:tabular-nums;white-space:nowrap }
    .line-internal__profit--negative { background:var(--danger-soft);color:var(--danger) }
    .line-internal__body { border-top:1px solid #ecdcbf }
    .line-internal__units { margin:0;padding:9px;display:grid;grid-template-columns:1fr 1fr;gap:7px }
    .line-internal__units>div { min-width:0;padding:9px;border:1px solid var(--line);border-radius:10px;background:var(--surface-2) }
    .line-internal__units dt { color:var(--muted);font-size:9.5px;line-height:1.25 }
    .line-internal__units dd { margin:3px 0 0;color:var(--ink);font-size:14px;font-weight:720;font-variant-numeric:tabular-nums;line-height:1.2 }
    .line-internal__units dd small { margin-left:3px;color:var(--muted);font-size:8.5px;font-weight:560 }
    .line-internal__units .line-internal__unit-profit { grid-column:1/-1;border-color:#c6e5d5;background:var(--ok-soft) }
    .line-internal__unit-profit dd { color:var(--ok) }
    .line-internal__units .line-internal__unit-profit--negative { border-color:#efcac6;background:var(--danger-soft) }
    .line-internal__unit-profit--negative dd { color:var(--danger) }
    .line-internal__total { margin:0 9px;padding:10px 2px 9px;display:flex;align-items:center;justify-content:space-between;gap:12px;border-top:1px solid var(--line) }
    .line-internal__total>span { min-width:0;display:flex;flex-direction:column;color:var(--ink);font-size:11px;font-weight:680 }
    .line-internal__total small { margin-top:1px;color:var(--muted);font-size:9px;font-weight:520 }
    .line-internal__total strong { flex:none;font-size:17px;font-variant-numeric:tabular-nums }
    .line-internal__note { margin:0;padding:0 11px 10px;color:var(--muted);font-size:9px;line-height:1.4 }
    .order-line__foot { margin-top:8px;display:flex;align-items:center;justify-content:flex-end;gap:8px }
    .remove-line,.delete-draft { color:var(--danger) }
    .products-empty { padding:38px 18px 42px;text-align:center }
    .products-empty__art { width:64px;height:64px;margin:0 auto 12px;display:grid;place-items:center;border:1px dashed var(--rose-mid);border-radius:20px;background:var(--rose-soft);color:var(--rose-dark);font-size:28px }
    .products-empty h3 { font-size:16px }
    .products-empty p { max-width:340px;margin:4px auto 16px;color:var(--muted);font-size:12.5px }

  `, `

    .logistics-grid { padding:10px;background:var(--surface-2) }
    .logistics-option { display:grid;grid-template-columns:38px minmax(0,1fr) auto;gap:9px;align-items:center;padding:11px;border:1px solid var(--line);border-radius:14px;background:var(--surface) }
    .logistics-option__icon { width:38px;height:38px;display:grid;place-items:center;border-radius:11px;background:var(--surface-2);color:var(--muted);font-size:17px }
    .logistics-option__copy { min-width:0;display:flex;flex-direction:column }
    .logistics-option__copy strong { font-size:13px }
    .logistics-option__copy span { overflow:hidden;color:var(--muted);font-size:11px;text-overflow:ellipsis;white-space:nowrap }
    .logistics-option__copy .danger-text { color:var(--danger) }
    .logistics-option .badge { grid-column:2;justify-self:start }
    .logistics-option>.btn { min-height:44px }
    .logistics-option__warning { grid-column:1/-1;padding:8px 10px;border-radius:9px;background:var(--warn-soft);color:var(--warn);font-size:11.5px }
    .freight-options { grid-column:1/-1;padding-top:10px;border-top:1px solid var(--line) }
    .check-option { min-height:52px;padding:10px;display:flex;gap:10px;border:1px solid var(--line);border-radius:11px;cursor:pointer }
    .check-option input { width:20px;height:20px;margin:1px 0;accent-color:var(--rose) }
    .check-option span { display:flex;flex-direction:column }
    .check-option strong { font-size:12.5px }
    .check-option small { color:var(--muted);font-size:10.5px }
    .freight-options .field { margin:12px 0 0 }
    .input-prefix { display:flex }
    .input-prefix>span { min-width:42px;display:grid;place-items:center;border:1px solid var(--line-strong);border-right:0;border-radius:var(--r-sm) 0 0 var(--r-sm);background:var(--surface-2);color:var(--muted) }
    .input-prefix .input { border-radius:0 var(--r-sm) var(--r-sm) 0 }
  `, `

    .total-highlight { display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,.8fr);gap:8px;margin-bottom:12px }
    .total-highlight>div { min-width:0;padding:13px 12px;display:flex;flex-direction:column;border-radius:13px;background:#241c18;color:#fff }
    .total-highlight>div+div { background:var(--rose-soft);color:var(--ink) }
    .total-highlight span { color:rgb(255 255 255/.58);font-size:9px;font-weight:700;text-transform:uppercase }
    .total-highlight>div+div span,.total-highlight>div+div small { color:var(--muted) }
    .total-highlight strong { overflow:hidden;font-size:clamp(17px,5vw,22px);font-variant-numeric:tabular-nums;text-overflow:ellipsis;white-space:nowrap }
    .total-highlight small { color:rgb(255 255 255/.52);font-size:10px }
    .quote-total__meta { display:flex;align-items:center;gap:7px;min-width:0;white-space:nowrap }
    .quote-profit { color:#63d69c;font-weight:720;font-variant-numeric:tabular-nums }
    .quote-profit--negative { color:#ff8b84 }
    .minimum-check { margin-bottom:12px;padding:11px;display:grid;grid-template-columns:1fr auto;gap:8px 12px;border:1px solid #f0dcbc;border-radius:13px;background:var(--warn-soft) }
    .minimum-check--ok { border-color:#c6e5d5;background:var(--ok-soft) }
    .minimum-check__copy { display:flex;flex-direction:column }
    .minimum-check__copy strong { font-size:12.5px }
    .minimum-check__copy span { color:var(--muted);font-size:10.5px }
    .minimum-check__value { align-self:center;color:var(--warn);font-size:12px;font-weight:760 }
    .minimum-check--ok .minimum-check__value { color:var(--ok);font-size:17px }
    .minimum-check .meter__track { grid-column:1/-1;height:5px }
    .cost-breakdown__head { min-height:44px;padding:9px 12px;display:flex;align-items:center;gap:10px }
    .cost-breakdown__head h3 { font-size:12.5px;font-weight:700 }
    .cost-breakdown__body { padding:4px 12px 12px;border-top:1px solid var(--line);background:var(--surface) }
    .send-card { border-color:color-mix(in srgb,var(--rose) 22%,var(--line)) }
    .send-card__head { padding:16px;display:flex;align-items:center;gap:12px }
    .send-card__icon { width:40px;height:40px;flex:none;display:grid;place-items:center;border-radius:13px;background:var(--warn-soft);color:var(--warn);font-size:18px;font-weight:780 }
    .send-card__icon--ok { background:var(--ok-soft);color:var(--ok) }
    .send-card__head h2 { font-size:15px }
    .send-card__head p { color:var(--muted);font-size:11.5px }
    .send-card__body { padding:0 14px 14px }
    .send-issues { margin:0 0 14px;padding:10px 12px 10px 30px;border-radius:11px;background:var(--warn-soft);color:#7c450b;font-size:12px }
    @media(max-width:350px) { .total-highlight { grid-template-columns:1fr } }
    .status-actions { display:flex;flex-wrap:wrap;gap:8px }
    .delete-draft { width:100%;margin-top:10px }

    .sales-state { max-width:760px }
    .loading-hero { height:150px;margin-bottom:12px;border-radius:22px }
    .loading-card { height:92px;margin-bottom:10px;border-radius:16px }
    .load-error { padding:24px;text-align:center }
    .load-error__icon { width:48px;height:48px;margin:0 auto 12px;display:grid;place-items:center;border-radius:16px;background:var(--danger-soft);color:var(--danger);font-size:20px;font-weight:760 }
    .load-error h2 { font-size:17px }
    .load-error p { max-width:420px;margin:5px auto 16px;color:var(--muted);font-size:13px }

    @media(max-width:520px) {
      .reference-alert .btn,.quote-lock .btn { margin-left:0;width:100% }
      .products-card__head { align-items:flex-start }
      .add-product { min-height:42px;padding-inline:12px }
      .section-heading p { max-width:190px }
      .logistics-option .badge { display:none }
    }
    @media(min-width: 680px) {
      .quote-hero__top { padding:22px 24px 20px }
      .quote-header-total span { display:block }
      .workflow-nav { max-width:640px;margin-inline:auto }
      .workflow-nav button { flex-direction:row;gap:7px;font-size:11.5px }
      .product-lines,.logistics-grid { padding:14px }
      .order-line { padding:16px }
      .line-quick-controls { grid-template-columns:180px minmax(0,1fr);gap:10px }
      .tier-nudge { align-items:center }
      .line-internal__units { grid-template-columns:repeat(3,minmax(0,1fr)) }
      .line-internal__units .line-internal__unit-profit { grid-column:auto }
    }
    @media(min-width:680px) {
      #quote-setup,#order-lines,#quote-logistics,#quote-check,#quote-status { scroll-margin-top:calc(var(--appbar-h) + 28px) }
      .workflow-layout { display:grid;grid-template-columns:minmax(0,1fr) 168px;gap:16px;align-items:start }
      .workflow-content { grid-column:1;grid-row:1;margin-top:0 }
      .workflow-nav { grid-column:2;grid-row:1;top:calc(var(--appbar-h) + 16px);max-width:none;margin:0;grid-template-columns:1fr;gap:3px;padding:6px;border-radius:15px }
      .workflow-nav button { min-height:44px;flex-direction:row;justify-content:flex-start;gap:8px;padding:7px 9px;font-size:12px;text-align:left }
      .quote-hero__customer { overflow:hidden;text-overflow:ellipsis;white-space:nowrap }
      .order-line__head { grid-template-columns:56px minmax(0,1fr) auto }
      .order-line__photo { width:56px;height:56px }
    }
  `],
})
export class SalesEditor {
  private readonly sales = inject(SalesApi);
  private readonly catalog = inject(CatalogApi);
  private readonly router = inject(Router);
  private readonly ui = inject(Ui);
  readonly privacy = inject(Privacy);
  private readonly work = inject(WorkQueue);
  private readonly destroyRef = inject(DestroyRef);

  readonly id = input<string>('');
  readonly workflowSections = [
    { id: 'quote-setup', label: 'Klant' },
    { id: 'order-lines', label: 'Producten' },
    { id: 'quote-logistics', label: 'Levering' },
    { id: 'quote-check', label: 'Controle' },
    { id: 'quote-status', label: 'Status' },
  ] as const;
  readonly activeSection = signal<(typeof this.workflowSections)[number]['id']>('quote-setup');

  readonly paymentTermsList = STANDARD_PAYMENT_TERMS;
  /** True while terms outside the standard list are being typed. */
  readonly customPaymentTerms = signal(false);

  paymentChoice(): string {
    if (this.customPaymentTerms()) return '__other__';
    const terms = this.view()?.order.paymentTerms ?? '';
    if (!terms) return '';
    return (this.paymentTermsList as readonly string[]).includes(terms) ? terms : '__other__';
  }

  pickPaymentTerms(choice: string): void {
    if (choice === '__other__') {
      this.customPaymentTerms.set(true);
      return;
    }
    this.customPaymentTerms.set(false);
    this.patch({ paymentTerms: choice || null });
  }

  readonly incoterms = ['EXW', 'FOB', 'CIF', 'DAP', 'DDP'];

  readonly view = signal<SalesOrderView | null>(null);
  readonly loading = signal(true);
  readonly loadError = signal('');
  readonly referenceError = signal('');
  readonly customers = signal<Customer[]>([]);
  readonly countries = signal<Country[]>([]);
  readonly products = signal<Product[]>([]);
  readonly revisions = signal<QuoteRevision[]>([]);
  readonly customerPortalLink = signal<CustomerPortalLink | null>(null);

  readonly picking = signal(false);
  readonly sendSheet = signal(false);
  readonly sendMessage = signal('');
  readonly sending = signal(false);
  /** The freight tweak panel, folded away until asked for. */
  readonly freightOpen = signal(false);

  /** Pallet management opens as a sheet: full height, scrollable, phone-first. */
  readonly palletSheet = signal(false);

  /** Is an action running that should block the buttons? */
  readonly busy = signal(false);
  /** Which line has its delivery-term block folded open. */
  readonly editingDelivery = signal<number | null>(null);
  readonly historyOpen = signal(false);
  readonly pdfSheet = signal(false);
  readonly pdfLanguage = signal<LanguageCode>('NL');
  readonly languages = LANGUAGES;

  /** The language belonging to this customer; the pick-list's starting point. */
  readonly customerLanguage = computed<LanguageCode>(() => {
    const id = this.view()?.order.customerId;
    return this.customers().find((c) => c.id === id)?.language ?? 'NL';
  });
  readonly history = signal<QuoteEvent[]>([]);

  constructor() {
    void this.loadReference();
    effect(() => {
      const routeId = this.id();
      if (routeId) void this.reload(+routeId);
      else this.loading.set(false);
    });
    const scheduleSectionUpdate = () => this.scheduleSectionUpdate();
    window.addEventListener('scroll', scheduleSectionUpdate, { passive: true });
    window.addEventListener('resize', scheduleSectionUpdate, { passive: true });
    this.destroyRef.onDestroy(() => {
      window.removeEventListener('scroll', scheduleSectionUpdate);
      window.removeEventListener('resize', scheduleSectionUpdate);
      if (this.sectionFrame !== null) cancelAnimationFrame(this.sectionFrame);
    });
    effect(() => {
      if (this.view()) this.scheduleSectionUpdate();
    });
  }

  private async loadReference(): Promise<void> {
    this.referenceError.set('');
    try {
      const [customers, countries, products] = await Promise.all([
        this.sales.customers(), this.sales.countries(), this.catalog.products(),
      ]);
      this.customers.set(customers);
      this.countries.set(countries);
      this.products.set(products);
    } catch (failure: unknown) {
      this.referenceError.set(messageOf(failure, 'Klanten, landen of producten ontbreken'));
    }
  }

  private async reload(orderId: number): Promise<void> {
    this.loading.set(true);
    this.loadError.set('');
    this.view.set(null);
    this.customerPortalLink.set(null);
    try {
      const [view, revisions] = await Promise.all([
        this.sales.order(orderId), this.sales.revisionsFor(orderId),
      ]);
      this.adopt(view);
      this.revisions.set(revisions);
      void this.loadHistory(orderId);
      void this.loadCustomerPortalLink(orderId);
    } catch (failure: unknown) {
      this.view.set(null);
      this.loadError.set(messageOf(failure, 'De offerte kon niet worden geladen'));
    } finally {
      this.loading.set(false);
    }
  }

  private async loadCustomerPortalLink(orderId: number): Promise<void> {
    try {
      this.customerPortalLink.set(await this.sales.portalLink(orderId));
    } catch {
      this.customerPortalLink.set(null);
    }
  }

  retryReference(): void {
    void this.loadReference();
  }

  retryLoad(): void {
    const routeId = +this.id();
    if (routeId) void this.reload(routeId);
  }

  readonly pendingRevision = computed(
    () => this.revisions().find((revision) => revision.status === 'IN_AFWACHTING') ?? null);

  readonly available = computed(() => {
    const used = new Set((this.view()?.order.lines ?? []).map((line) => line.productId));
    return this.products().filter((product) => !used.has(product.id!));
  });

  readonly minimumPercent = computed(() => {
    const data = this.view();
    if (!data) return 0;
    const minimum = data.priced.validation.minOrderValue;
    if (!minimum) return 100;
    return Math.min(100, (data.priced.totals.goodsTotal / minimum) * 100);
  });

  /** Commercial fields belong to the draft version only. */
  readonly canEdit = computed(() => this.view()?.order.status === 'CONCEPT');

  /** A quote that has ever reached the customer must remain in the audit trail. */
  readonly canDelete = computed(() => this.canEdit() && !this.view()?.order.sentAt);

  /** Open delivery promises may still be completed without unlocking prices. */
  readonly canEditTerms = computed(() => {
    const status = this.view()?.order.status;
    return status === 'CONCEPT' || status === 'VERZONDEN' || status === 'BEKEKEN';
  });

  /** The same preflight the server enforces, phrased before the user taps send. */
  readonly sendIssues = computed(() => {
    const data = this.view();
    if (!data) return ['De offerte wordt nog geladen'];
    const issues: string[] = [];
    if (!['CONCEPT', 'VERZONDEN', 'BEKEKEN'].includes(data.order.status)) {
      issues.push(`Status ${this.label(data.order.status).toLowerCase()} laat versturen niet toe`);
    }
    const customer = this.customers().find((item) => item.id === data.order.customerId);
    if (!customer) issues.push('Kies een klant');
    else if (!customer.email?.trim()) issues.push(`${customer.company} heeft geen e-mailadres`);
    if (!data.order.countryCode) issues.push('Kies een land van levering');
    if (!data.priced.validation.hasLines) issues.push('Voeg minstens één product toe');
    if (data.order.loadMode === 'LOOSE_CARTONS'
        && data.priced.validation.productsWithoutCartonDimensions?.length) {
      issues.push('Vul de buitenmaten van alle omdozen in');
    }
    if (data.order.loadMode !== 'LOOSE_CARTONS'
        && data.priced.validation.productsWithoutPalletFit?.length) {
      issues.push('Controleer de omdoosmaten: niet elk product past op de gekozen pallet');
    }
    if (data.order.loadMode !== 'LOOSE_CARTONS' && data.order.pallets.length) {
      if (data.priced.totals.unassignedCartons > 0) {
        issues.push('Wijs alle dozen toe aan de handmatige pallets');
      }
      if (this.overassigned()) issues.push('Er zijn meer dozen op pallets gezet dan besteld');
      if (data.order.pallets.some((pallet) => pallet.items.length === 0)) {
        issues.push('Verwijder lege pallets of zet er producten op');
      }
      if (data.order.pallets.some((pallet) =>
          pallet.items.some((item) => item.cartons <= 0))) {
        issues.push('Vul op elke pallet een geldig aantal dozen in');
      }
      const lineIds = new Set(data.priced.lines.map((line) => line.productId));
      if (data.order.pallets.some((pallet) =>
          pallet.items.some((item) => !lineIds.has(item.productId)))) {
        issues.push('Vernieuw de palletindeling: er staat een verwijderd product op');
      }
      const palletBase = data.priced.totals.palletBaseHeightCm ?? 14.4;
      const palletMax = data.priced.totals.palletMaxHeightCm ?? 260;
      if (data.order.pallets.some((pallet) => pallet.heightCm != null
          && (pallet.heightCm < palletBase || pallet.heightCm > palletMax))) {
        issues.push('Controleer de gemeten hoogte van de handmatige pallets');
      }
    }
    if (data.priced.validation.freightPricingIssue) {
      issues.push(data.priced.validation.freightPricingIssue);
    } else if (data.order.freight !== 'TE_BEPALEN') {
      const strategy = data.order.freightPricingStrategy
        ?? (data.order.manualFreightEur != null ? 'FIXED' : 'COUNTRY_PALLET');
      if (strategy === 'PER_CBM' && !(data.order.freightRatePerCbmEur! > 0)) {
        issues.push('Vul een vrachttarief per m³ in');
      }
      if (strategy === 'FIXED' && data.order.manualFreightEur == null) {
        issues.push('Vul het vaste vrachtbedrag in');
      }
      if (strategy === 'COUNTRY_PALLET' && data.order.loadMode === 'LOOSE_CARTONS') {
        issues.push('Kies voor losse dozen een m³-tarief of vast vrachtbedrag');
      }
    }
    if (data.order.orderDate && data.order.validUntil
        && data.order.validUntil < data.order.orderDate) {
      issues.push('Geldig-totdatum ligt vóór de offertedatum');
    }
    if (!data.priced.validation.meetsMinimum) {
      issues.push('De minimum orderwaarde is nog niet bereikt');
    }
    return issues;
  });

  label = (status: SalesOrder['status']) => STATUS_LABEL[status];
  cls = statusClass;

  customerName(): string {
    const id = this.view()?.order.customerId;
    return this.customers().find((c) => c.id === id)?.company ?? 'Geen klant';
  }

  productName(productId: number): string {
    return this.products().find((product) => product.id === productId)?.describedAs
      ?? '#' + productId;
  }

  currentQuantity(productId: number): number {
    return this.view()?.order.lines.find((l) => l.productId === productId)?.quantity ?? 0;
  }

  /**
   * The server owns pricing. Its line margin is the net line amount minus
   * landed cost, after line discount and before order-level adjustments.
   * Dividing that returned value keeps this unit figure exactly aligned with
   * the total shown alongside it instead of recreating pricing in the UI.
   */
  marginPerUnit(line: PricedLine): number {
    return line.quantity > 0 ? line.marginEur / line.quantity : 0;
  }

  absolute(value: number): number {
    return Math.abs(value);
  }

  /* --------------------------------------------------------- mutating */

  /* ---- draft, preview, save ---------------------------------------- */

  /* The quote on screen is a draft: every edit lands here at once and the
     server re-prices it without saving. Only Opslaan - or an action such as
     Verstuur, which saves first - writes the quote. */
  private readonly savedOrder = signal<string>('');
  readonly saving = signal(false);
  readonly dirty = computed(() => {
    const data = this.view();
    return !!data && JSON.stringify(data.order) !== this.savedOrder();
  });
  private previewTimer: ReturnType<typeof setTimeout> | null = null;
  private previewVersion = 0;

  /** A view straight from the server: what is shown is what is saved. */
  private adopt(view: SalesOrderView): void {
    ++this.previewVersion;
    this.view.set(view);
    this.savedOrder.set(JSON.stringify(view.order));
  }

  /** Applies a change to the draft and re-prices it. */
  private enqueue(make: (order: SalesOrder) => SalesOrder | null): void {
    const data = this.view();
    if (!data) return;
    const next = make(data.order);
    if (!next) return;
    this.view.set({ ...data, order: next });
    this.schedulePreview();
  }

  private schedulePreview(): void {
    if (this.previewTimer !== null) clearTimeout(this.previewTimer);
    this.previewTimer = setTimeout(() => { this.previewTimer = null; void this.preview(); }, 250);
  }

  private async preview(): Promise<void> {
    const data = this.view();
    if (!data) return;
    const version = ++this.previewVersion;
    try {
      const fresh = await this.sales.previewOrder(data.order.id, data.order);
      const current = this.view();
      if (version !== this.previewVersion || !current) return;
      this.view.set({ ...fresh, order: current.order });
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Prijzen vernieuwen mislukt'), 'err');
    }
  }

  /** Writes the draft. Returns false when it could not be written. */
  async save(): Promise<boolean> {
    const data = this.view();
    if (!data || this.saving()) return false;
    if (!this.dirty()) return true;
    if (this.previewTimer !== null) { clearTimeout(this.previewTimer); this.previewTimer = null; }
    this.saving.set(true);
    try {
      this.adopt(await this.sales.updateOrder(data.order.id, data.order));
      this.ui.toast('Opgeslagen');
      return true;
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Opslaan mislukt'), 'err');
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  canDeactivate(): boolean | Promise<boolean> {
    if (this.saving()) return false;
    if (!this.dirty()) return true;
    return new Promise<boolean>((resolve) => {
      this.ui.confirm(
        {
          title: 'Niet-opgeslagen wijzigingen',
          message: 'Deze offerte heeft wijzigingen die nog niet zijn opgeslagen. Opslaan voor je verdergaat?',
          confirmLabel: 'Opslaan',
          secondaryLabel: 'Niet opslaan',
        },
        async () => { await this.save(); resolve(!this.dirty()); },
        () => resolve(true),
      );
    });
  }

  @HostListener('window:beforeunload', ['$event'])
  warnBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.dirty()) event.preventDefault();
  }

  patch(changes: Partial<SalesOrder>): void {
    if (!this.canEdit()) {
      this.ui.toast('Deze offerteversie staat vast. Maak een nieuwe kopie om prijzen of aantallen te wijzigen.', 'err');
      return;
    }
    this.enqueue((order) => ({ ...order, ...changes }));
  }

  setCustomer(customerId: number): void {
    const customer = this.customers().find((c) => c.id === customerId);
    this.patch({
      customerId,
      countryCode: customer?.countryCode ?? this.view()?.order.countryCode ?? null,
      incoterm: customer?.incoterm ?? 'DAP',
    });
  }

  setMarkupMode(mode: MarkupMode): void {
    const data = this.view();
    if (!data || data.order.markupMode === mode) return;
    /* Clear manual prices, or the new markup cannot get through. */
    this.enqueue((order) => ({
      ...order,
      markupMode: mode,
      lines: order.lines.map((line) => ({ ...line, unitPriceEur: null })),
    }));
  }

  weekOf(productId: number): string {
    return this.view()?.order.lines.find((l) => l.productId === productId)?.deliveryWeek ?? '';
  }

  /** Announced carton correction per line: the server rounds on save. */
  readonly linePending = signal<Record<number, number>>({});

  /**
   * The quantity lands in the draft at once. An off-carton figure is kept
   * as typed with a notice of what the server will make of it on save -
   * nothing is rounded under someone's fingers.
   */
  setLineQuantity(productId: number, raw: number): void {
    if (!this.canEdit()) return;
    const wanted = Math.max(0, raw || 0);
    const per = this.piecesPerCarton(productId);
    const snapped = Math.ceil(wanted / per) * per;
    const offCarton = snapped !== wanted && wanted > 0;
    this.linePending.update((map) => {
      const next = { ...map };
      if (offCarton) next[productId] = snapped;
      else delete next[productId];
      return next;
    });
    this.setLine(productId, { quantity: wanted });
  }

  /** Saves the draft before an action reads the order on the server. */
  private async flushPendingEdits(): Promise<boolean> {
    this.linePending.set({});
    return this.save();
  }

  private piecesPerCarton(productId: number): number {
    const per = this.products().find((product) => product.id === productId)
      ?.carton.piecesPerCarton;
    return Math.max(1, per ?? 1);
  }

  setLine(productId: number,
          changes: { quantity?: number; unitPriceEur?: number; manualDiscountPct?: number;
                     deliveryWeek?: string }): void {
    if (!this.canEdit()) {
      const deliveryOnly = Object.keys(changes).length === 1
          && Object.prototype.hasOwnProperty.call(changes, 'deliveryWeek');
      if (deliveryOnly && this.canEditTerms()) {
        void (async () => {
          const data = this.view();
          if (!data) return;
          try {
            this.adopt(await this.sales.updateDeliveryTerms(data.order.id, [{
              productId,
              deliveryWeek: changes.deliveryWeek?.trim() || null,
            }]));
          } catch (failure: unknown) {
            this.ui.toast(messageOf(failure, 'Leverweek opslaan mislukt'), 'err');
          }
        })();
      }
      return;
    }
    this.enqueue((order) => ({
      ...order,
      lines: order.lines.map((line) =>
        line.productId === productId ? { ...line, ...changes } : line),
    }));
  }

  removeLine(productId: number): void {
    this.enqueue((order) => ({
      ...order,
      lines: order.lines.filter((line) => line.productId !== productId),
    }));
  }

  openPicker(): void {
    if (!this.canEdit()) return;
    this.picking.set(true);
  }

  /** Price the picker shows: what THIS order would charge for that product. */
  readonly priceOf = (product: Product): number => {
    const order = this.view()?.order;
    if (order?.markupMode !== 'ORDER') return product.computedSalesPriceEur;
    const cost = product.landedCostEur ?? 0;
    const markup = order.orderMarkupPct ?? 0;
    return Math.round(cost * (1 + markup / 100) * 100) / 100;
  };

  vatLabel(treatment: string): string {
    switch (treatment) {
      case 'INTRACOMMUNAUTAIR': return 'intracommunautaire levering';
      case 'UITVOER': return 'uitvoer';
      case 'EU_ZONDER_BTW_NUMMER': return 'EU zonder BTW-nummer';
      default: return 'binnenland';
    }
  }

  addLine(choice: { product: Product; quantity: number }): void {
    this.picking.set(false);
    this.enqueue((order) => ({
      ...order,
      lines: [...order.lines,
              { id: null, productId: choice.product.id!, quantity: choice.quantity,
                unitPriceEur: null, manualDiscountPct: null, deliveryWeek: null }],
    }));
  }

  /* ------------------------------------------------------------ quote */

  async openSend(): Promise<void> {
    if (!(await this.flushPendingEdits())) return;
    if (this.sendIssues().length) {
      this.ui.toast(this.sendIssues()[0], 'err');
      return;
    }
    this.sendMessage.set('');
    this.sendSheet.set(true);
  }

  async send(): Promise<void> {
    if (this.sending()) return;
    this.sending.set(true);
    try {
      if (!(await this.flushPendingEdits())) return;
      const data = this.view();
      if (!data) return;
      if (this.sendIssues().length) {
        this.ui.toast(this.sendIssues()[0], 'err');
        return;
      }
      const sent = await this.sales.sendQuote(data.order.id, this.sendMessage());
      this.adopt(sent);
      this.sendSheet.set(false);
      void this.work.refresh();
      this.ui.toast('Offerte verstuurd naar de klant');
      await this.router.navigate(['/sales', sent.order.id]);
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Versturen mislukt'), 'err');
    } finally {
      this.sending.set(false);
    }
  }

  /**
   * Puts a rejected quote back on concept.
   *
   * A "no" is rarely the end: usually it was too expensive or the delivery
   * date did not suit. Then you want to adjust that same quote and resend
   * instead of retyping everything.
   */
  async reopen(): Promise<void> {
    const data = this.view();
    if (!data || this.busy()) return;
    this.busy.set(true);
    this.customerPortalLink.set(null);
    try {
      this.adopt(await this.sales.reopenQuote(data.order.id));
      void this.loadCustomerPortalLink(data.order.id);
      this.ui.toast('Offerte staat weer op concept');
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Heropenen mislukt'), 'err');
    } finally {
      this.busy.set(false);
    }
  }

  /** Starts a clean draft instead of changing a quote the customer already received. */
  async duplicate(): Promise<void> {
    const data = this.view();
    if (!data || this.busy()) return;
    this.busy.set(true);
    try {
      const copy = await this.sales.duplicateOrder(data.order.id);
      this.ui.toast('Nieuwe conceptkopie gemaakt');
      await this.router.navigate(['/sales', copy.order.id, 'edit']);
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Kopie maken mislukt'), 'err');
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Sets the freight to "to be determined" or back.
   *
   * On the way back the state jumps to AANGEVULD, not BEREKEND, when the
   * quote already left with an open item: the customer is waiting on that
   * amount and should read that it is now there.
   */
  setFreightPending(pending: boolean): void {
    const data = this.view();
    if (!data || !this.canEditTerms()) return;
    const wasPending = data.order.freight === 'TE_BEPALEN';
    const state = pending ? 'TE_BEPALEN' : wasPending ? 'AANGEVULD' : 'BEREKEND';
    const strategy = this.effectiveFreightStrategy(data);
    if (!pending && strategy === 'PER_CBM' && !(data.order.freightRatePerCbmEur! > 0)) {
      this.ui.toast('Vul eerst een vrachttarief per m³ in', 'err');
      return;
    }
    if (!pending && strategy === 'FIXED' && data.order.manualFreightEur == null) {
      this.ui.toast('Vul eerst het vaste vrachtbedrag in', 'err');
      return;
    }
    if (!pending && strategy === 'COUNTRY_PALLET' && this.isLooseCartons(data)) {
      this.ui.toast('Kies voor losse dozen een m³-tarief of vast bedrag', 'err');
      return;
    }
    this.saveFreight(state, data.order.manualFreightEur, strategy,
      data.order.freightRatePerCbmEur ?? null);
  }

  setManualFreight(raw: string): void {
    const data = this.view();
    if (!data || !this.canEditTerms()) return;
    const amount = raw.trim() === '' ? null : Number(raw);
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
      this.ui.toast('Vul een geldig vrachtbedrag in', 'err');
      return;
    }
    if (amount === null && this.isLooseCartons(data)
        && data.order.freight !== 'TE_BEPALEN') {
      this.ui.toast('Losse dozen hebben een m³-tarief of vast vrachtbedrag nodig', 'err');
      return;
    }
    const strategy = amount === null
      ? data.order.freight === 'TE_BEPALEN' ? 'FIXED' : 'COUNTRY_PALLET'
      : 'FIXED';
    this.saveFreight(data.order.freight ?? 'BEREKEND', amount, strategy, null);
  }

  setFreightCbmRate(raw: string): void {
    const data = this.view();
    if (!data || !this.canEditTerms()) return;
    const rate = raw.trim() === '' ? null : Number(raw);
    if (rate === null || !Number.isFinite(rate) || rate <= 0) {
      this.ui.toast('Vul een vrachttarief groter dan € 0 per m³ in', 'err');
      return;
    }
    this.saveFreight(data.order.freight ?? 'BEREKEND', null, 'PER_CBM', rate);
  }

  setLockedFreightStrategy(strategy: FreightPricingStrategy): void {
    const data = this.view();
    if (!data || !this.canEditTerms()) return;
    if (strategy === 'COUNTRY_PALLET' && this.isLooseCartons(data)) return;
    const manual = strategy === 'FIXED' ? data.order.manualFreightEur : null;
    const rate = strategy === 'PER_CBM' ? data.order.freightRatePerCbmEur ?? null : null;
    const incomplete = (strategy === 'FIXED' && manual == null)
      || (strategy === 'PER_CBM' && !(rate! > 0));
    const state = incomplete ? 'TE_BEPALEN' : data.order.freight ?? 'BEREKEND';
    this.saveFreight(state, manual, strategy, rate);
  }

  private saveFreight(state: 'BEREKEND' | 'TE_BEPALEN' | 'AANGEVULD',
                      manualFreightEur: number | null,
                      freightPricingStrategy: SalesOrder['freightPricingStrategy'],
                      freightRatePerCbmEur: number | null): void {
    void (async () => {
      /* The freight endpoint answers with the saved quote: write the draft
         first, or the answer would undo what was typed since. */
      if (this.dirty() && !(await this.save())) return;
      const data = this.view();
      if (!data) return;
      try {
        this.adopt(await this.sales.updateFreight(data.order.id, state, manualFreightEur,
          freightPricingStrategy ?? null, freightRatePerCbmEur));
      } catch (failure: unknown) {
        this.ui.toast(messageOf(failure, 'Vracht opslaan mislukt'), 'err');
      }
    })();
  }

  effectiveFreightStrategy(data: SalesOrderView): FreightPricingStrategy {
    return data.order.freightPricingStrategy
      ?? (data.order.manualFreightEur != null ? 'FIXED' : 'COUNTRY_PALLET');
  }

  /** The most recent step, shown next to the status badge. */
  readonly lastEvent = computed(() => this.history()[0] ?? null);

  toggleHistory(): void {
    this.historyOpen.set(!this.historyOpen());
  }

  /** History loads with the order: the status bar shows its last step. */
  private async loadHistory(orderId: number): Promise<void> {
    try {
      this.history.set(await this.sales.history(orderId));
    } catch {
      this.history.set([]);
    }
  }

  /** Folds a line's delivery-term block open or closed. */
  toggleDelivery(productId: number): void {
    this.editingDelivery.set(this.editingDelivery() === productId ? null : productId);
  }

  /**
   * Opens the PDF sheet with the customer's language preselected.
   *
   * Preselected because nine times out of ten it is right - sending uses it
   * anyway. The pick-list is there for the tenth: a quick English copy for
   * someone passing it around internally, without touching the language on
   * the customer file.
   */
  openPdfSheet(): void {
    this.pdfLanguage.set(this.customerLanguage());
    this.pdfSheet.set(true);
  }

  async downloadPackingSlip(): Promise<void> {
    const data = this.view();
    if (!data) return;
    const blob = await this.sales.packingSlip(data.order.id);
    saveBlob(blob, `${data.order.number}-pakbon.pdf`);
    this.pdfSheet.set(false);
    this.ui.toast('Pakbon gedownload — zonder prijzen, voor magazijn en transport');
  }

  async downloadPdf(): Promise<void> {
    const data = this.view();
    if (!data) return;
    const language = this.pdfLanguage();
    try {
      const blob = await this.sales.quotePdf(data.order.id, language);
      saveBlob(blob, `${data.order.number}-${language.toLowerCase()}.pdf`);
      this.pdfSheet.set(false);
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'PDF maken mislukt'), 'err');
    }
  }

  async copyLink(): Promise<void> {
    const portalLink = this.customerPortalLink();
    if (!portalLink?.available || !portalLink.url) return;
    await navigator.clipboard.writeText(portalLink.url);
    this.ui.toast('Klantlink gekopieerd');
  }

  openCustomerPreview(): void {
    const orderId = this.view()?.order.id;
    if (orderId != null) void this.router.navigate(['/sales', orderId, 'customer-preview']);
  }

  /* ---------------------------------------------------------- changes */

  /**
   * Adopts the customer's proposal.
   *
   * Either way their quantities land on the order and the quote falls back
   * to concept. The difference is what you do next: *Wijzigen* scrolls the
   * screen to the lines so you can adjust right away, *Overnemen* leaves it
   * as the customer asked. Two buttons instead of one, because "agreed" and
   * "agreed provided that" are two different answers.
   */
  approve(revision: QuoteRevision, thenEdit: boolean): void {
    this.ui.confirm(
      {
        title: thenEdit ? 'Overnemen en bijsturen' : 'Voorstel overnemen',
        message: thenEdit
          ? 'De aantallen van de klant komen op de order te staan. Daarna kan je ze zelf '
            + 'nog aanpassen voor je opnieuw verstuurt.'
          : 'De aantallen van de klant worden overgenomen. De offerte gaat terug naar '
            + 'concept zodat je nog kan bijsturen voor je opnieuw verstuurt.',
        confirmLabel: thenEdit ? 'Overnemen en bijsturen' : 'Overnemen',
      },
      async () => {
        this.customerPortalLink.set(null);
        this.adopt(await this.sales.approveRevision(revision.id, 'Verkoop', ''));
        void this.loadCustomerPortalLink(revision.salesOrderId);
        this.revisions.set(await this.sales.revisionsFor(revision.salesOrderId));
        /* The tab counter and the bell must drop this immediately. */
        void this.work.refresh();
        this.ui.toast(thenEdit ? 'Overgenomen — pas gerust nog aan' : 'Voorstel overgenomen');

        if (thenEdit) {
          /* Scroll to the lines: that is where you want to act now, and on
             a phone they sit a screen lower otherwise. */
          setTimeout(() => {
            document.getElementById('order-lines')
              ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }, 100);
        }
      },
    );
  }

  reject(revision: QuoteRevision): void {
    this.ui.confirm(
      {
        title: 'Voorstel afwijzen',
        message: 'De offerte blijft zoals ze verstuurd is.',
        confirmLabel: 'Afwijzen', danger: true,
      },
      async () => {
        this.adopt(await this.sales.rejectRevision(revision.id, 'Verkoop', ''));
        this.revisions.set(await this.sales.revisionsFor(revision.salesOrderId));
        void this.work.refresh();
        this.ui.toast('Voorstel afgewezen');
      },
    );
  }

  remove(): void {
    const data = this.view();
    if (!data || !this.canDelete()) return;
    this.ui.confirm(
      {
        title: 'Order verwijderen',
        message: `Verkooporder <b>${data.order.number}</b> verwijderen?`,
        confirmLabel: 'Verwijderen', danger: true,
      },
      async () => {
        await this.sales.deleteOrder(data.order.id);
        this.ui.toast('Order verwijderd');
        await this.router.navigate(['/sales']);
      },
    );
  }
  /* --------------------------------------------------------- sections */

  /** Start with the customer context visible; pricing stays progressive. */
  readonly openSections = signal(new Set<string>(['order']));

  toggle(name: string): void {
    const next = new Set(this.openSections());
    if (next.has(name)) { next.delete(name); } else { next.add(name); }
    this.openSections.set(next);
  }

  isOpen(name: string): boolean {
    return this.openSections().has(name);
  }

  scrollToSection(id: string): void {
    if (this.workflowSections.some((item) => item.id === id)) {
      this.activeSection.set(id as (typeof this.workflowSections)[number]['id']);
    }
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  private sectionFrame: number | null = null;

  private scheduleSectionUpdate(): void {
    if (this.sectionFrame !== null) return;
    this.sectionFrame = requestAnimationFrame(() => {
      this.sectionFrame = null;
      this.updateActiveSection();
    });
  }

  /** Follow the section just below the sticky chrome, including at page end. */
  private updateActiveSection(): void {
    const sections = this.workflowSections.flatMap((item) => {
      const element = document.getElementById(item.id);
      return element ? [{ item, element }] : [];
    });
    if (!sections.length) return;

    const appbarBottom = document.querySelector<HTMLElement>('.appbar')
      ?.getBoundingClientRect().bottom ?? 0;
    const mobileNavBottom = window.innerWidth < 680
      ? (document.querySelector<HTMLElement>('.workflow-nav')?.getBoundingClientRect().bottom
        ?? appbarBottom)
      : appbarBottom;
    const activationLine = mobileNavBottom + 24;
    let current = sections[0].item.id;
    for (const section of sections) {
      if (section.element.getBoundingClientRect().top <= activationLine) {
        current = section.item.id;
      } else {
        break;
      }
    }
    const atPageEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 8;
    this.activeSection.set(atPageEnd ? sections.at(-1)!.item.id : current);
  }

  orderSummary(): string {
    const data = this.view();
    if (!data) return '';
    const customer = this.customers().find((c) => c.id === data.order.customerId);
    const parts = [customer?.company ?? 'Geen klant', data.order.countryCode ?? '',
        data.order.incoterm ?? ''].filter(Boolean);
    return parts.join(' · ');
  }

  pricingSummary(): string {
    const data = this.view();
    if (!data) return '';
    const markup = data.order.markupMode === 'ORDER'
        ? `${data.order.orderMarkupPct ?? 0}% op ordertotaal` : 'Opslag per product';
    const extra = data.order.extraDiscountPct
        ? ` · ${data.order.extraDiscountLabel || 'extra korting'}` : '';
    return markup + extra;
  }

  palletSummary(): string {
    const data = this.view();
    if (!data) return '';
    const totals = data.priced.totals;
    if (this.isLooseCartons(data)) {
      return `${this.countLabel(totals.cartons, 'doos', 'dozen')} · `
        + `${new CbmPipe().transform(totals.cbm)} · los geladen`;
    }
    if (!totals.palletsManual) {
      return `automatisch · ${this.countLabel(totals.palletsStrict, 'pallet', 'pallets')}`;
    }
    const rest = totals.unassignedCartons > 0
        ? ` · ${this.countLabel(totals.unassignedCartons, 'doos', 'dozen')} los` : '';
    return `${this.countLabel(totals.palletsManual, 'pallet', 'pallets')} · handmatig${rest}`;
  }

  /* ---------------------------------------------------------- pallets */

  applyShippingPatch(changes: ShippingOrderPatch): void {
    this.patch(changes);
  }

  handlePalletAction(event: ShippingPalletAction): void {
    switch (event.type) {
      case 'auto-layout': this.autoLayout(); break;
      case 'add-pallet': this.addPallet(); break;
      case 'clear-layout': this.clearPallets(); break;
      case 'move-pallet': this.movePallet(event.index, event.direction); break;
      case 'reorder-pallet': this.reorderPallet(event.fromIndex, event.toIndex); break;
      case 'remove-pallet': this.removePallet(event.index); break;
      case 'rename-pallet': this.renamePallet(event.index, event.label); break;
      case 'set-pallet-type': this.setPalletType(event.index, event.palletType); break;
      case 'set-pallet-height': this.setPalletHeight(event.index, event.heightCm); break;
      case 'add-item': this.addItem(event.palletIndex, event.productId); break;
      case 'set-item-cartons':
        this.setItemCartons(event.palletIndex, event.productId, event.cartons);
        break;
    }
  }

  isLooseCartons(data: SalesOrderView): boolean {
    return data.order.loadMode === 'LOOSE_CARTONS';
  }

  freightStrategyLabel(data: SalesOrderView): string {
    const strategy = data.order.freightPricingStrategy
      ?? (data.order.manualFreightEur != null ? 'FIXED' : 'COUNTRY_PALLET');
    if (strategy === 'PER_CBM') return 'Tarief per m³';
    if (strategy === 'FIXED') return 'Vast bedrag';
    return 'Landentarief';
  }

  freightBasisLabel(data: SalesOrderView): string {
    const strategy = data.order.freightPricingStrategy
      ?? (data.order.manualFreightEur != null ? 'FIXED' : 'COUNTRY_PALLET');
    if (strategy === 'FIXED') return 'vast bedrag';
    if (strategy === 'PER_CBM') {
      return `${new CbmPipe().transform(data.priced.totals.cbm)} · per m³`;
    }
    const totals = data.priced.totals;
    return totals.palletsManual > 0
      ? `${this.countLabel(totals.palletsManual, 'pallet', 'pallets')} · handmatig`
      : this.countLabel(totals.palletsStrict, 'pallet', 'pallets');
  }

  private countLabel(count: number, singular: string, plural: string): string {
    return `${count} ${count === 1 ? singular : plural}`;
  }

  /** Cartons of this product already on any pallet. */
  private assignedFor(productId: number): number {
    return (this.view()?.order.pallets ?? [])
        .flatMap((pallet) => pallet.items)
        .filter((item) => item.productId === productId)
        .reduce((sum, item) => sum + item.cartons, 0);
  }

  /** Does the manual layout still match the order's cartons exactly? */
  layoutOk(): boolean {
    const data = this.view();
    if (!data) return true;
    const lineIds = new Set(data.priced.lines.map((line) => line.productId));
    const palletBase = data.priced.totals.palletBaseHeightCm ?? 14.4;
    const palletMax = data.priced.totals.palletMaxHeightCm ?? 260;
    return data.order.pallets.every((pallet) => pallet.items.length > 0
        && pallet.items.every((item) => item.cartons > 0 && lineIds.has(item.productId))
        && (pallet.heightCm == null
          || (pallet.heightCm >= palletBase && pallet.heightCm <= palletMax)))
      && data.priced.totals.unassignedCartons === 0
      && !this.overassigned();
  }

  private overassigned(): boolean {
    const data = this.view();
    if (!data) return false;
    return data.priced.lines.some((line) =>
        this.assignedFor(line.productId) > line.cartons);
  }

  setPalletHeight(index: number, raw: string | number | null): void {
    const rounded = Math.round(Number(raw));
    const minimum = Math.ceil(this.view()?.priced.totals.palletBaseHeightCm ?? 14.4);
    const maximum = Math.floor(this.view()?.priced.totals.palletMaxHeightCm ?? 260);
    const value = raw === '' || raw === null || !Number.isFinite(rounded) || rounded <= 0
      ? null
      : Math.max(minimum, Math.min(maximum, rounded));
    this.mutatePallets((pallets) => {
      if (pallets[index]) pallets[index] = { ...pallets[index], heightCm: value };
      return pallets;
    });
  }

  setPalletType(index: number, value: string): void {
    if (value === '__other__') {
      const custom = window.prompt('Soort pallet');
      if (!custom || !custom.trim()) return;
      value = custom.trim();
    }
    value = normalizeManualPalletType(value);
    this.mutatePallets((pallets) => {
      if (pallets[index]) pallets[index] = { ...pallets[index], type: value };
      return pallets;
    });
  }

  /*
   * Every pallet mutation clones and edits INSIDE the save queue's
   * builder. Cloning at click time captured a stale list: three quick
   * taps on "remove" all removed the same pallet from the same copy.
   */
  private mutatePallets(mutate: (pallets: OrderPallet[]) => OrderPallet[]): void {
    this.enqueue((order) => ({
      ...order,
      pallets: mutate(order.pallets.map((pallet) => ({
        ...pallet,
        type: normalizeManualPalletType(pallet.type),
        items: pallet.items.map((item) => ({ ...item })),
      }))),
    }));
  }

  /** Starts from the calculator's strict stacking, ready to rearrange. */
  autoLayout(): void {
    this.enqueue((order) => {
      const lines = this.view()?.priced.lines ?? [];
      const invalid = lines.find((line) =>
        line.cartons > 0 && line.cartonsPerPallet <= 0);
      if (invalid) {
        this.ui.toast(
          `Palletindeling niet mogelijk voor ${invalid.description}. `
            + 'Controleer omdoosafmetingen, gewicht en laadhoogte.',
          'err',
        );
        return null;
      }
      const pallets: OrderPallet[] = [];
      const type = this.palletTypeForProfile(order.palletProfile);
      for (const line of lines) {
        const per = line.cartonsPerPallet;
        let left = line.cartons;
        while (left > 0) {
          const take = Math.min(per, left);
          pallets.push({ id: null, label: `Pallet ${pallets.length + 1}`, type,
              heightCm: null, items: [{ productId: line.productId, cartons: take }] });
          left -= take;
        }
      }
      return { ...order, pallets };
    });
  }

  addPallet(): void {
    this.mutatePallets((pallets) => {
      const type = this.palletTypeForProfile(this.view()?.order.palletProfile);
      pallets.push({ id: null, label: `Pallet ${pallets.length + 1}`, type,
          heightCm: null, items: [] });
      return pallets;
    });
  }

  removePallet(index: number): void {
    this.mutatePallets((pallets) => {
      pallets.splice(index, 1);
      return pallets;
    });
  }

  movePallet(index: number, direction: number): void {
    const count = this.view()?.order.pallets.length ?? 0;
    const target = index + direction;
    if (index < 0 || index >= count || target < 0 || target >= count) return;
    this.mutatePallets((pallets) => {
      [pallets[index], pallets[target]] = [pallets[target], pallets[index]];
      return pallets;
    });
  }

  reorderPallet(fromIndex: number, toIndex: number): void {
    const count = this.view()?.order.pallets.length ?? 0;
    if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)
        || fromIndex === toIndex || fromIndex < 0 || toIndex < 0
        || fromIndex >= count || toIndex >= count) return;
    this.mutatePallets((pallets) => {
      const [moved] = pallets.splice(fromIndex, 1);
      pallets.splice(toIndex, 0, moved);
      return pallets;
    });
  }

  renamePallet(index: number, label: string): void {
    this.mutatePallets((pallets) => {
      if (pallets[index]) pallets[index] = { ...pallets[index], label: label.trim() };
      return pallets;
    });
  }

  /** New product on a pallet starts with everything that is still loose. */
  addItem(palletIndex: number, productId: number): void {
    if (!productId) return;
    this.mutatePallets((pallets) => {
      const line = this.view()?.priced.lines.find((l) => l.productId === productId);
      const assigned = pallets.flatMap((pallet) => pallet.items)
          .filter((item) => item.productId === productId)
          .reduce((sum, item) => sum + item.cartons, 0);
      const remaining = line ? line.cartons - assigned : 0;
      if (remaining > 0 && pallets[palletIndex]) {
        pallets[palletIndex].items.push({ productId, cartons: remaining });
      }
      return pallets;
    });
  }

  setItemCartons(palletIndex: number, productId: number, cartons: number): void {
    this.mutatePallets((pallets) => {
      const items = pallets[palletIndex]?.items ?? [];
      const index = items.findIndex((item) => item.productId === productId);
      if (index < 0) return pallets;
      if (!cartons || cartons <= 0) {
        items.splice(index, 1);
      } else {
        items[index] = { ...items[index], cartons: Math.floor(cartons) };
      }
      return pallets;
    });
  }

  clearPallets(): void {
    this.patch({ pallets: [] });
  }

  private palletTypeForProfile(profile: SalesOrder['palletProfile']): string {
    switch (profile) {
      case 'BLOCK_120X100': return 'Blokpallet 120×100';
      case 'HALF_80X60': return 'Halve pallet 80×60';
      default: return 'Europallet';
    }
  }

}
