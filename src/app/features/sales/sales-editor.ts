import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, HostListener } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CatalogApi } from '../../core/api/catalog-api';
import { SourcingApi } from '../../core/api/sourcing-api';
import { AuthImage } from '../../core/api/auth-image';
import { SalesApi } from '../../core/api/sales-api';
import { saveBlob } from '../../core/api/download';
import { OrderPallet,
  Carrier, Category, Country, Customer, CustomerPortalLink, FreightPricingStrategy, LANGUAGES, LanguageCode,
  MarkupMode, Product, ProductFamily, QuoteEvent, QuoteRevision, PricedLine, SalesOrder, SalesOrderView,
} from '../../core/api/models';
import { PageHeader } from '../../shared/page-header';
import { ProductPicker } from '../../shared/product-picker';
import { DateField } from '../../shared/date-field';
import { WeekField } from '../../shared/week-field';
import { messageOf } from '../../core/api/errors';
import { STANDARD_PAYMENT_TERMS } from '../../core/api/geo';
import { WorkQueue } from '../../core/api/work-queue';
import { escapeHtml, Sheet, Ui } from '../../shared/ui';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import {
  CbmPipe, DateNlPipe, DateTimeNlPipe, EurPipe, NumPipe, PctPipe, WeekNlPipe,
} from '../../shared/pipes';
import {
  STATUS_LABEL, internalNotesForDisplay, isWebsiteQuoteRequest,
  replaceInternalNotesForDisplay, statusClass, websiteCartonRequests,
} from './quote-status';
import {
  normalizeManualPalletType, ShippingOrderPatch, ShippingPalletAction, ShippingPlanner,
} from './shipping-planner';
import {
  isLocallyDeletableSalesDocument, salesDocumentLabel,
} from './sales-list-swipe';
import { salesLineSections } from './sales-product-line-groups';
import { SalesPdfSheet } from './sales-pdf-sheet';

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
            ShippingPlanner, SalesPdfSheet,
            EurPipe, NumPipe, PctPipe, CbmPipe, DateNlPipe, DateTimeNlPipe, WeekNlPipe, RouterLink],
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
          <!-- One primary at a time: with unsaved changes the only next
               step is saving; once saved, sending takes the spot. -->
          @if (canEdit() && (dirty() || saving())) {
            <button class="btn btn--primary btn--sm quote-header-button" type="button"
                    [disabled]="saving()" (click)="save()">
              {{ saving() ? 'Bezig…' : 'Opslaan' }}
            </button>
          }
          <button class="btn btn--sm quote-header-button quote-header-button--desktop" type="button"
                  (click)="openPdfSheet()">PDF</button>
          @if (data.order.status === 'AFGEWEZEN' || data.order.status === 'VERLOPEN') {
            <button class="btn btn--primary btn--sm quote-header-button" type="button"
                    [disabled]="busy()" (click)="reopen()">Heropen</button>
          } @else if (!isInvoiceDoc() && (data.order.status === 'CONCEPT'
                     || data.order.status === 'VERZONDEN' || data.order.status === 'BEKEKEN')) {
            <button class="btn btn--sm quote-header-button quote-header-button--send" type="button"
                    [class.quote-header-button--send-quiet]="dirty()"
                    [disabled]="sending()"
                    [attr.aria-label]="data.order.sentAt ? 'Offerte opnieuw versturen' : 'Offerte versturen'"
                    (click)="openSend()">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
                   stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M22 2 11 13"/><path d="M22 2l-7 20-4-9-9-4 22-7z"/>
              </svg>
              <span>{{ data.order.sentAt ? 'Opnieuw' : 'Verstuur' }}</span>
            </button>
          }
        </div>
      </app-page-header>

      <main class="content sales-page erp-workspace erp-workspace--edit erp-workspace--sales">
        <!-- A compact cockpit: status, readiness and commercial scale are
             visible before somebody starts editing a long order. -->
        <section class="quote-hero erp-workspace__hero" aria-labelledby="quote-overview-title">
          <div class="quote-hero__top">
            <div>
              <div class="quote-hero__label-row">
                <div class="quote-hero__eyebrow" id="quote-overview-title">
                  {{ isInvoiceDoc() ? 'Factuur' : 'Verkoopofferte' }}
                </div>
                @if (websiteRequest(data.order)) {
                  <span class="website-request-pill">
                    <span aria-hidden="true">↗</span> Nieuwe aanvraag
                  </span>
                }
              </div>
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
              <span class="hero-fact__label">{{ isInvoiceDoc() ? 'Factuurtotaal' : 'Offertetotaal' }}</span>
              <strong>{{ data.priced.totals.total | eur: 0 }}</strong>
              <span>{{ data.priced.totals.vatLegalMention ? 'BTW verlegd' : 'excl. BTW' }}</span>
            </div>
          </div>

          @if (data.order.countryCode && data.priced.validation.minOrderValue > 0) {
            <!-- The country's minimum rides with the totals, in view the
                 whole time you build; green the moment it is met. -->
            <div class="hero-min" [class.hero-min--ok]="data.priced.validation.meetsMinimum" role="status">
              <span class="hero-min__label">Minimumorder {{ data.priced.validation.minOrderValue | eur: 0 }}</span>
              <b>
                @if (data.priced.validation.meetsMinimum) { ✓ bereikt }
                @else { nog − {{ data.priced.validation.shortfall | eur: 0 }} }
              </b>
              <i class="hero-min__track" aria-hidden="true"><i [style.width.%]="minimumPercent()"></i></i>
            </div>
          }

          @if (data.awaitingResend) {
            <!-- An adopted proposal drops the quote back to concept, but the
                 customer is still waiting. Keep saying so until it goes out. -->
            <button class="hero-waiting" type="button" (click)="openSend()">
              <i aria-hidden="true">⏳</i>
              <span><b>Klant wacht op de nieuwe versie</b> — voorstel overgenomen, nog niet verstuurd</span>
              <b class="hero-waiting__go" aria-hidden="true">Verstuur ›</b>
            </button>
          }

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

        @if (saveError()) {
          <div class="alert alert--warn quote-action-error" role="alert">
            <span class="alert__icon">!</span>
            <div class="grow"><b>Offerte is nog niet opgeslagen</b><div class="small">{{ saveError() }}</div></div>
            <div class="quote-action-error__actions">
              <button class="btn btn--sm" type="button" [disabled]="saving()"
                      (click)="reloadLatestOrder()">Serverversie laden</button>
              <button class="btn btn--sm btn--primary" type="button" [disabled]="saving() || !dirty()"
                      (click)="save()">Opnieuw opslaan</button>
            </div>
          </div>
        } @else if (previewError()) {
          <div class="alert alert--warn quote-action-error" role="alert">
            <span class="alert__icon">!</span>
            <div class="grow"><b>Prijsvoorbeeld is mogelijk verouderd</b><div class="small">{{ previewError() }}</div></div>
            <button class="btn btn--sm" type="button" (click)="retryPreview()">Prijzen opnieuw berekenen</button>
          </div>
        }

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

        @if (websiteRequest(data.order)) {
          <section class="website-review card" aria-labelledby="website-review-title">
            <header class="website-review__head">
              <div>
                <span class="website-review__eyebrow">Eerste controle</span>
                <h2 id="website-review-title">Maak de websiteaanvraag klaar als offerte</h2>
                <p>Controleer de aanvraag op deze drie punten vóór u ze naar de klant verstuurt.</p>
              </div>
              <span class="website-review__source">Bron: website</span>
            </header>
            <div class="website-review__grid">
              <button type="button" (click)="scrollToSection('order-lines')">
                <span class="website-review__step">1 · Producten, dozen &amp; prijzen</span>
                <strong>{{ data.priced.totals.pieces | num }} stuks · {{ data.priced.totals.cartons | num }} dozen</strong>
                <small>Huidig offertetotaal {{ data.priced.totals.total | eur }} · controleer de stukprijzen.</small>
                @if (websiteCartons(data.order).length) {
                  <em class="website-review__warning">
                    {{ websiteCartons(data.order).length }}
                    {{ websiteCartons(data.order).length === 1 ? 'product heeft' : 'producten hebben' }}
                    nog geen bevestigde doosinhoud
                  </em>
                  @for (request of websiteCartons(data.order); track request.productId ?? request.sku) {
                    <small>
                      {{ request.sku || ('Product ' + request.productId) }} ·
                      {{ request.cartons || '?' }} aangevraagde dozen
                    </small>
                  }
                } @else {
                  <small>Aantallen zijn door de server naar volle dozen berekend.</small>
                }
                <span class="website-review__go">Productregels controleren ›</span>
              </button>
              <button type="button" (click)="scrollToSection('quote-setup')">
                <span class="website-review__step">2 · Klant &amp; btw</span>
                <strong>{{ vatLabel(data.priced.totals.vatTreatment) }}</strong>
                <small>BTW-nummer: {{ customerVatNumber() || 'ontbreekt' }}</small>
                @if (data.priced.totals.vatTreatment === 'INTRACOMMUNAUTAIR') {
                  <em class="website-review__warning">
                    Controleer het BTW-nummer handmatig in VIES; automatische VIES-controle is nog niet aangesloten.
                  </em>
                } @else {
                  <small>Controleer klant, land en btw-behandeling.</small>
                }
                <span class="website-review__go">Klantgegevens controleren ›</span>
              </button>
              <button type="button" (click)="scrollToSection('quote-logistics')">
                <span class="website-review__step">3 · Levering &amp; vracht</span>
                <strong>{{ freightStrategyLabel(data) }}</strong>
                <small>
                  @if (data.order.freight === 'TE_BEPALEN') {
                    Vrachtprijs moet nog worden ingevuld
                  } @else {
                    {{ data.priced.totals.freight | eur }} vracht
                  }
                </small>
                <span class="website-review__go">Levering controleren ›</span>
              </button>
            </div>
          </section>
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
          <section class="card revision-card" id="quote-revision" aria-labelledby="revision-title">
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

        <div class="workflow-layout erp-workspace__layout">
        <nav class="workflow-nav erp-workspace__section-nav" aria-label="Onderdelen van de offerte">
          @for (item of workflowSections; track item.id; let number = $index) {
            <!-- On the phone, Status lives inside the Controle step; an
                 invoice has no send step at all. -->
            @if (item.id !== 'quote-status' ? true : (desktop.active() && !isInvoiceDoc())) {
            <button type="button"
                    class="erp-workspace__section-link"
                    [class.workflow-nav__active]="desktop.active() ? activeSection() === item.id : stepOfId(item.id) === phoneStep()"
                    [class.active]="desktop.active() ? activeSection() === item.id : stepOfId(item.id) === phoneStep()"
                    [class.erp-workspace__section-link--complete]="workflowComplete(item.id)"
                    [class.erp-workspace__section-link--attention]="workflowAttention(item.id)"
                    [attr.aria-current]="activeSection() === item.id ? 'step' : null"
                    [attr.aria-label]="item.label + ': ' + workflowHint(item.id)"
                    (click)="scrollToSection(item.id)">
              <span class="workflow-nav__mark erp-workspace__section-mark" aria-hidden="true">{{ workflowMark(item.id, number + 1) }}</span>
              <span class="workflow-nav__copy erp-workspace__section-copy">
                <b>{{ item.label }}</b>
                <small>{{ workflowHint(item.id) }}</small>
              </span>
            </button>
            }
          }
        </nav>
        <div class="workflow-content erp-workspace__content">


        <!-- ==================================== order -->
        @if (desktop.active() || phoneStep() === 0) {
        <section class="card form-card erp-workspace__section" id="quote-setup" aria-labelledby="quote-setup-title">
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
              <div class="field-duo">
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
              @if (isInvoiceDoc()) {
                <div class="field">
                  <label for="so-due">Vervaldatum</label>
                  <app-date-field fieldId="so-due" [value]="data.order.invoiceDueDate ?? ''"
                                  (valueChange)="patch({ invoiceDueDate: $event })" />
                  <span class="hint">Tot wanneer de klant heeft om te betalen.</span>
                </div>
              } @else {
                <div class="field">
                  <label for="so-valid">Geldig tot</label>
                  <app-date-field fieldId="so-valid" [value]="data.order.validUntil"
                                  (valueChange)="patch({ validUntil: $event })" />
                </div>
              }
            </div>

            <details class="progressive-panel"
                     [open]="!!data.order.notes || !!visibleInternalNotes(data.order)">
              <summary>
                <span>Notities</span>
                <span class="progressive-panel__summary">
                  {{ data.order.notes || visibleInternalNotes(data.order) ? 'ingevuld' : 'optioneel' }}
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
                            [ngModel]="visibleInternalNotes(data.order)"
                            (ngModelChange)="setVisibleInternalNotes($event)"
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

        }

        <!-- ==================================== lines -->
        @if (desktop.active() || phoneStep() === 1) {
        <section class="card products-card erp-workspace__section" id="order-lines" aria-labelledby="order-lines-title">
          <div class="products-card__head">
            <div class="section-heading">
              <span class="section-heading__number">2</span>
              <div>
                <h2 id="order-lines-title">Producten</h2>
                <p>{{ data.priced.lines.length ? (data.priced.totals.pieces | num) + ' stuks in deze offerte' : 'Bouw de offerte regel voor regel op' }}</p>
              </div>
            </div>
            @if (data.priced.lines.length) {
              <button class="btn btn--primary btn--sm add-product" type="button"
                      [disabled]="!canEdit() || !available().length" (click)="openPicker()">
                <span aria-hidden="true">＋</span> Product
              </button>
            }
          </div>

          <div class="product-lines">
            @if (data.priced.lines.length) {
            @for (section of lineSections(); track section.key) {
              <section class="po-line-section"
                       [attr.aria-labelledby]="'sales-line-category-' + section.key">
                <header class="po-line-section__head">
                  <h3 [id]="'sales-line-category-' + section.key">{{ section.label }}</h3>
                  <span>{{ section.lines.length }} product{{ section.lines.length === 1 ? '' : 'en' }}</span>
                </header>
                @for (familyGroup of section.families; track familyGroup.key) {
                <section class="po-family"
                         [attr.aria-labelledby]="'sales-line-family-' + familyGroup.key">
                  <header class="po-family__head">
                    <span class="po-family__identity">
                      <small>{{ familyGroup.familyId === null ? 'Los product' : 'Productreeks' }}</small>
                      <strong [id]="'sales-line-family-' + familyGroup.key">{{ familyGroup.label }}</strong>
                      @if (familyGroup.swatches.length) {
                        <span class="po-family__swatches"
                              [attr.aria-label]="'Kleuren in ' + familyGroup.label">
                          @for (swatch of familyGroup.swatches; track swatch.key) {
                            <i class="line-colour-dot" [class.line-colour-dot--empty]="!swatch.hex"
                               [style.background]="swatch.hex || 'transparent'"
                               [title]="swatch.label"></i>
                          }
                        </span>
                      }
                    </span>
                    <span class="po-family__totals">
                      <strong>{{ familyGroup.lines.length }}
                        {{ familyGroup.lines.length === 1 ? 'variant' : 'varianten' }}</strong>
                      <small>{{ familyGroup.pieces | num }} st · {{ familyGroup.cartons | num }} dozen ·
                        {{ familyGroup.cbm | cbm }}</small>
                      <b>{{ familyGroup.totalEur | eur }}</b>
                    </span>
                  </header>
                  <div class="po-family__variants">
            @for (line of familyGroup.lines; track line.productId) {
              <article class="order-line" [attr.aria-labelledby]="'line-title-' + line.productId">
                <div class="order-line__head">
                  <!-- Photo and name walk through to the product itself. -->
                  <a class="order-line__link" [routerLink]="['/products', line.productId]"
                     [title]="line.description + ' openen'">
                  @if (line.photoUrl) {
                    <img class="order-line__photo" [appAuthSrc]="line.photoUrl"
                         alt="" loading="lazy" />
                  } @else {
                    <span class="order-line__photo order-line__photo--empty" aria-hidden="true">◇</span>
                  }
                  <div class="order-line__identity">
                    <span class="order-line__index">Regel {{ salesLineNumber(line.productId) }} · {{ line.sku }}</span>
                    <h3 [id]="'line-title-' + line.productId">{{ line.description }}</h3>
                    <span>
                      {{ line.cartons | num }} {{ line.cartons === 1 ? 'doos' : 'dozen' }} ·
                      @if (!isLooseCartons(data) && !data.order.pallets.length) {
                        {{ line.pallets }} {{ line.pallets === 1 ? 'pallet' : 'pallets' }} ·
                      }
                      {{ line.cbm | cbm }}
                    </span>
                  </div>
                  </a>
                  <div class="order-line__amount">
                    <strong>{{ line.net | eur }}</strong>
                    @if (line.discountPct) {
                      <span>Regelkorting −{{ line.discountPct | pct: 1 }}</span>
                    }
                  </div>
                  <!-- Small and out of the way: the row is about the product,
                       not about deleting it. -->
                  <button class="order-line__remove" type="button" [disabled]="!canEdit()"
                          title="Regel verwijderen" [attr.aria-label]="line.description + ' verwijderen'"
                          (click)="removeLine(line.productId)">×</button>
                </div>

                <!-- Three fields in one calm row: nothing folds, nothing jumps. -->
                <div class="line-fields">
                  <div class="field">
                    <label [attr.for]="'q-' + line.productId">Aantal</label>
                    <input class="input num" [id]="'q-' + line.productId" type="number"
                           min="0" step="1" inputmode="numeric" [disabled]="!canEdit()"
                           [ngModel]="line.quantity"
                           (ngModelChange)="setLineQuantity(line.productId, +$event)" />
                    @if (linePending()[line.productId]; as to) {
                      <span class="hint warn-text" role="status">Volle doos: wordt <b>{{ to | num }} st</b></span>
                    }
                  </div>
                  <div class="field">
                    <label [attr.for]="'p-' + line.productId">Stukprijs</label>
                    <div class="input-affix">
                      <input class="input num" [id]="'p-' + line.productId" type="number"
                             min="0" step="0.01" inputmode="decimal" [disabled]="!canEdit()"
                             [ngModel]="line.unitPrice"
                             (ngModelChange)="setLine(line.productId, { unitPriceEur: +$event })" />
                      <!-- The discount hides behind its own vertical tab: two
                           calm fields until you actually want a third. -->
                      <button class="input-affix__suffix discount-tab" type="button"
                              [class.discount-tab--on]="discountShown(line)"
                              [attr.aria-expanded]="discountShown(line)"
                              (click)="toggleDiscountOpen(line.productId)">korting</button>
                    </div>
                  </div>
                  @if (discountShown(line)) {
                  <div class="field">
                    <label [attr.for]="'d-' + line.productId">Extra korting</label>
                    <div class="input-affix">
                      @if (discountMode(line.productId) === 'EUR') {
                        <input class="input num" [id]="'d-' + line.productId" type="number"
                               min="0" step="0.01" inputmode="decimal"
                               [disabled]="!canEdit()" [ngModel]="lineDiscountEur(line)"
                               (ngModelChange)="setLineDiscountEur(line, +$event)" />
                      } @else {
                        <input class="input num" [id]="'d-' + line.productId" type="number"
                               min="0" max="100" step="0.5" inputmode="decimal"
                               [disabled]="!canEdit()" [ngModel]="line.manualPercent"
                               (ngModelChange)="setLine(line.productId, { manualDiscountPct: +$event })" />
                      }
                      <button class="input-affix__suffix discount-flip" type="button"
                              [title]="discountMode(line.productId) === 'EUR' ? 'Wissel naar procent' : 'Wissel naar euro'"
                              (click)="flipDiscountMode(line.productId)">
                        {{ discountMode(line.productId) === 'EUR' ? '€' : '%' }} ⇄
                      </button>
                    </div>
                    @if (discountMode(line.productId) === 'EUR' && line.manualPercent) {
                      <span class="hint">= {{ line.manualPercent | pct: 2 }}</span>
                    }
                  </div>
                  }
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

                <details class="line-internal">
                  <summary class="line-internal__summary">
                    <span class="line-internal__title">
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
                      <!-- Tapping the cost opens where every cent came from. -->
                      <button class="line-internal__unit line-internal__unit--btn" type="button"
                              (click)="openCostSheet(line)">
                        <dt>Gelande kost <i class="stock-tile__chev" aria-hidden="true"></i></dt>
                        <dd>{{ line.landedUnitCost | eur: 4 }}<small>/ stuk</small></dd>
                      </button>
                      <div class="line-internal__unit">
                        <dt>Netto verkoop</dt>
                        <dd>{{ line.netUnitPrice | eur: 2 }}<small>/ stuk</small></dd>
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

              </article>
            }
                  </div>
                </section>
                }
              </section>
            }
            } @else {
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

        <!-- Pricing rules ride with the products: they shape the same lines. -->
        }

        <!-- ==================================== transport and delivery -->
        @if (desktop.active() || phoneStep() === 2) {
        <section class="card logistics-card erp-workspace__section" id="quote-logistics" aria-labelledby="logistics-title">
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
                @if (transitDays(); as days) {
                  <span>Transittijd ± {{ days }} {{ days === 1 ? 'werkdag' : 'werkdagen' }}
                    naar {{ orderCountryName() }}</span>
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
                      @if (!isLooseCartons(data) && carriers().length) {
                        <option value="CARRIER">Verzendorganisatie (staffel)</option>
                      }
                      @if (effectiveFreightStrategy(data) === 'PER_CBM') {
                        <option value="PER_CBM">Tarief per m³</option>
                      }
                      <option value="FIXED">Vast bedrag</option>
                      <option value="PICKUP">Afhalen in het magazijn</option>
                    </select>
                  </div>
                  @if (effectiveFreightStrategy(data) === 'CARRIER') {
                    <div class="field">
                      <label for="so-freight-carrier">Verzendorganisatie</label>
                      <select class="select" id="so-freight-carrier"
                              [value]="data.order.freightCarrierId ?? ''"
                              (change)="setLockedCarrier($any($event.target).value)">
                        @for (carrier of carriers(); track carrier.id) {
                          <option [value]="carrier.id">{{ carrier.name }}</option>
                        }
                      </select>
                    </div>
                  }
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
        }

        <!-- ==================================== totals: the overview -->
        @if (desktop.active() || phoneStep() === 3) {
        <section class="card totals-card erp-workspace__section" id="quote-check" aria-labelledby="totals-title">
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
            <!-- What is actually in the box, before any figure: the check
                 starts with the order as the customer will read it. -->
            <ol class="check-lines">
              @for (line of data.priced.lines; track line.productId) {
                <li>
                  @if (line.photoUrl) {
                    <img class="check-lines__photo" [appAuthSrc]="line.photoUrl" alt="" loading="lazy" />
                  } @else {
                    <span class="check-lines__photo check-lines__photo--empty" aria-hidden="true">◇</span>
                  }
                  <span class="check-lines__what">
                    <b>{{ line.description }}</b>
                    <small>{{ line.quantity | num }} st × {{ line.unitPrice | eur: 2 }}@if (line.discountPct) { · −{{ line.discountPct | pct: 1 }}}
                      · {{ line.inStock ? 'op voorraad' : (line.deliveryWeek ? ('levering ' + (line.deliveryWeek | weekNl: 'short')) : 'levertijd onbekend') }}@if (line.deliveryDate) { · leverbaar vanaf {{ line.deliveryDate | dateNl }}}</small>
                  </span>
                  <span class="num check-lines__amount">{{ line.net | eur }}</span>
                </li>
              } @empty {
                <li class="hint">Nog geen producten op de order.</li>
              }
              @if (data.priced.lines.length) {
                <li class="check-lines__delivery">
                  <span class="check-lines__delivery-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24"><path d="M3 7h11v8H3zM14 10h4l3 3v2h-7zM7.5 17.5m-1.6 0a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0 -3.2 0M17.5 17.5m-1.6 0a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0 -3.2 0" /></svg>
                  </span>
                  <span class="check-lines__delivery-copy">
                    <b>Levering</b>
                    <span>{{ deliverySummary(data) }}</span>
                  </span>
                </li>
              }
            </ol>



            <!-- Reads like a till receipt: three section lines, discounts
                 only when they exist, one bold total at the foot. -->
            <section class="receipt" aria-labelledby="price-breakdown-title">
              <h3 id="price-breakdown-title" class="receipt__title">Prijsopbouw</h3>

              <div class="receipt__row receipt__row--head">
                <span>Goederen</span>
                <span class="num">{{ data.priced.totals.goodsTotal | eur }}</span>
              </div>
              @if (data.order.countryCode && data.priced.validation.minOrderValue > 0 && !data.priced.validation.meetsMinimum) {
                <!-- The minimum is a goods matter, so its line lives here. -->
                <div class="receipt-min receipt-min--goods">
                  <div class="receipt-min__row">
                    <span>Min {{ data.priced.validation.minOrderValue | eur: 0 }}</span>
                  </div>
                  <i class="receipt-min__track" aria-hidden="true"><i [style.width.%]="minimumPercent()"></i></i>
                </div>
              }
              @if (data.priced.totals.lineDiscountTotal || data.priced.totals.orderDiscountAmount) {
                <div class="receipt__row receipt__row--sub">
                  <span>Bruto</span><span class="num">{{ data.priced.totals.gross | eur }}</span>
                </div>
                @if (data.priced.totals.lineDiscountTotal) {
                  <div class="receipt__row receipt__row--sub receipt__row--minus">
                    <span>Kortingen op regels</span><span class="num">− {{ data.priced.totals.lineDiscountTotal | eur }}</span>
                  </div>
                }
                @if (data.priced.totals.orderDiscountAmount) {
                  <div class="receipt__row receipt__row--sub receipt__row--minus">
                    <span>Orderkorting {{ data.priced.totals.orderDiscountPercent | pct: 0 }}</span>
                    <span class="num">− {{ data.priced.totals.orderDiscountAmount | eur }}</span>
                  </div>
                }
              }
              @if (data.priced.totals.extraDiscountAmount) {
                <div class="receipt__row receipt__row--sub receipt__row--minus">
                  <span>{{ data.order.extraDiscountLabel || 'Extra korting' }}
                    {{ data.order.extraDiscountPct | pct: 1 }}</span>
                  <span class="num">− {{ data.priced.totals.extraDiscountAmount | eur }}</span>
                </div>
              }
              <!-- The one commercial lever at check time: an order discount
                   for a fair or a deal, as a percentage or an amount. -->
              @if (canEdit()) {
                @if (!orderDiscountOpen()) {
                  <button class="receipt-korting__add" type="button"
                          (click)="orderDiscountOpen.set(true)">
                    {{ data.priced.totals.extraDiscountAmount
                        ? 'Korting aanpassen' : '+ Korting op het order, bv. beurs' }}
                  </button>
                } @else {
                  <div class="receipt-korting">
                    <div class="discount-flip2" role="group" aria-label="Korting in euro of procent">
                      <button type="button" [class.discount-flip2__on]="orderDiscountShown() === 'PCT'"
                              (click)="orderDiscountShown.set('PCT')">%</button>
                      <button type="button" [class.discount-flip2__on]="orderDiscountShown() === 'EUR'"
                              (click)="orderDiscountShown.set('EUR')">€</button>
                    </div>
                    @if (orderDiscountShown() === 'PCT') {
                      <input class="input num" type="number" min="0" max="100" step="0.5"
                             placeholder="%" aria-label="Korting in procent"
                             [ngModel]="data.order.extraDiscountPct"
                             (ngModelChange)="setOrderDiscountPct($event)" />
                    } @else {
                      <input class="input num" type="number" min="0" step="0.01"
                             placeholder="€" aria-label="Korting in euro"
                             [ngModel]="orderDiscountEur(data)"
                             (ngModelChange)="setOrderDiscountEur($event)" />
                    }
                    <input class="input receipt-korting__name" placeholder="Naam, bv. beurskorting"
                           [ngModel]="data.order.extraDiscountLabel"
                           (ngModelChange)="patch({ extraDiscountLabel: $event })" />
                    <button class="receipt-korting__done" type="button" aria-label="Klaar"
                            (click)="orderDiscountOpen.set(false)">✓</button>
                  </div>
                }
              }

              <div class="receipt__row receipt__row--head">
                <span>Verzending</span>
                <span class="num">
                  @if (data.order.freight === 'TE_BEPALEN') {
                    <span class="danger-text">nog te bepalen</span>
                  } @else {
                    {{ data.priced.totals.freight + data.priced.totals.handling | eur }}
                  }
                </span>
              </div>
              @if (data.order.freight !== 'TE_BEPALEN') {
                <div class="receipt__row receipt__row--sub">
                  <span>Vracht · {{ freightBasisLabel(data) }}</span>
                  <span class="num">{{ data.priced.totals.freight | eur }}</span>
                </div>
              }
              @if (data.priced.totals.handling) {
                <div class="receipt__row receipt__row--sub">
                  <span>Administratie</span><span class="num">{{ data.priced.totals.handling | eur }}</span>
                </div>
              }

              <div class="receipt__row receipt__row--head">
                <span>BTW {{ data.priced.totals.vatLegalMention ? '0% · verlegd' : (data.priced.totals.vatRatePct | pct: 1) }}</span>
                <span class="num">{{ (data.priced.totals.vatLegalMention ? 0 : data.priced.totals.vatAmount) | eur }}</span>
              </div>

              <div class="receipt__row receipt__row--total">
                <span>Totaal
                  <span class="receipt__profit" [class.receipt__profit--negative]="data.priced.totals.marginEur < 0">
                    winst {{ data.priced.totals.marginEur >= 0 ? '+' : '' }}{{ data.priced.totals.marginEur | eur: 0 }}
                  </span>
                </span>
                <span class="num">{{ (data.priced.totals.vatLegalMention ? data.priced.totals.total : data.priced.totals.totalInclVat) | eur }}</span>
              </div>
            </section>
          </div>
        </section>

        <!-- ==================================== sending the quote -->
        @if (!isInvoiceDoc()) {
        <section class="card send-card erp-workspace__section" id="quote-status" aria-labelledby="send-title">
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
                    : (data.awaitingResend
                        ? 'Voorstel van de klant overgenomen — verstuur de nieuwe versie.'
                        : 'Klant, producten en minimumorder zijn gecontroleerd.') }}
              </p>
            </div>
          </div>
          <div class="send-card__body">
            @if (sendIssues().length) {
              <!-- Every open point is its own row: a checklist to tick off,
                   not a paragraph to decipher. -->
              <ul class="send-checklist">
                @for (issue of sendIssues(); track issue) {
                  <li>
                    <button type="button" (click)="fixIssue(issue)">
                      <i aria-hidden="true">!</i><span>{{ issue }}</span>
                      <b aria-hidden="true">›</b>
                    </button>
                  </li>
                }
              </ul>
            } @else {
              <ul class="send-checklist">
                <li class="send-checklist__ok"><i aria-hidden="true">✓</i>
                  <span>Klant, producten, pallets en minimumorder zijn in orde.</span></li>
              </ul>
            }
            <!-- One quiet row: the destructive act far left, the way
                 forward far right, nothing shouting. -->
            <div class="status-actions">
              @if (canDelete()) {
                <button class="delete-draft" type="button" [disabled]="deleting()"
                        (click)="remove()">
                  {{ deleting()
                      ? (isInvoiceDoc() ? 'Factuur verwijderen…' : 'Offerte verwijderen…')
                      : (isInvoiceDoc() ? 'Deze factuur verwijderen' : 'Deze offerte verwijderen') }}
                </button>
              }
              <span class="status-actions__spacer" aria-hidden="true"></span>
              @if (customerPortalLink(); as portalLink) {
                @if (portalLink.available && portalLink.url) {
                  <button class="btn" type="button" (click)="copyLink()">
                    Klantlink kopiëren
                  </button>
                }
              }
              <button class="btn btn--primary" type="button"
                      [disabled]="sending() || sendIssues().length > 0"
                      (click)="openSend()">
                {{ view()?.order?.sentAt ? 'Opnieuw versturen' : 'Versturen' }}
              </button>
            </div>
          </div>
        </section>
        }
        }

        </div>
        </div>
      </main>

      @if (!desktop.active()) {
        <!-- A fixed decision dock keeps navigation and the one relevant action
             within thumb reach. The form itself remains a single source of truth. -->
        <div class="sales-mobile-dock erp-workspace__mobile-dock" role="group"
             aria-label="Offerte navigatie en acties">
          @if (phoneStep() > 0) {
            <button class="sales-mobile-dock__back" type="button" (click)="previousPhoneStep()"
                    [attr.aria-label]="'Terug naar ' + phoneStepLabels[phoneStep() - 1]">‹</button>
          }
          <span class="sales-mobile-dock__context">
            <small>Stap {{ phoneStep() + 1 }} van 4</small>
            <strong>{{ phoneStepLabels[phoneStep()] }}</strong>
          </span>
          <button class="btn sales-mobile-dock__save" type="button"
                  [class.btn--primary]="dirty()"
                  [disabled]="saving() || !dirty()" (click)="save()">
            {{ saving() ? 'Opslaan…' : 'Opslaan' }}
          </button>
          @if (phoneStep() < 3) {
            <button class="sales-mobile-dock__next" type="button" (click)="nextPhoneStep()"
                    [attr.aria-label]="'Volgende: ' + phoneStepLabels[phoneStep() + 1]">
              <span aria-hidden="true">›</span>
            </button>
          } @else if (!dirty() && pendingRevision()) {
            <button class="btn btn--primary sales-mobile-dock__primary" type="button"
                    (click)="focusPendingRevision()">Wijziging beoordelen</button>
          } @else if (!dirty() && !isInvoiceDoc() && data.order.status === 'GEACCEPTEERD') {
            <a class="btn btn--primary sales-mobile-dock__primary"
               [routerLink]="['/sales', data.order.id]">Factuur maken</a>
          } @else if (!dirty() && !isInvoiceDoc()
                     && (data.order.status === 'AFGEWEZEN' || data.order.status === 'VERLOPEN')) {
            <button class="btn btn--primary sales-mobile-dock__primary" type="button"
                    [disabled]="busy()" (click)="reopen()">Heropenen</button>
          } @else if (!dirty() && !isInvoiceDoc() && !sendIssues().length) {
            <button class="btn btn--primary sales-mobile-dock__primary" type="button"
                    [disabled]="sending()" (click)="openSend()">Versturen</button>
          } @else if (!dirty() && !isInvoiceDoc() && sendIssues().length) {
            <button class="btn btn--primary sales-mobile-dock__primary" type="button"
                    (click)="fixIssue(sendIssues()[0])">
              {{ sendIssues().length }} open {{ sendIssues().length === 1 ? 'punt' : 'punten' }}
            </button>
          } @else if (!dirty() && isInvoiceDoc()) {
            <button class="btn btn--primary sales-mobile-dock__primary" type="button"
                    (click)="openPdfSheet()">PDF bekijken</button>
          }
        </div>
      }

      @if (costSheet(); as sheet) {
        <app-sheet [title]="'Gelande kost · ' + sheet.title" (closed)="costSheet.set(null)">
          <div body>
            @if (sheet.rows.length) {
              <dl class="cost-sheet">
                @for (row of sheet.rows; track row.label) {
                  <div [class.cost-sheet__sum]="row.sum">
                    <dt>{{ row.label }}@if (row.hint) { <small>{{ row.hint }}</small> }</dt>
                    <dd class="num">{{ row.eur | eur: 4 }}</dd>
                  </div>
                }
              </dl>
              @if (sheet.source) {
                <p class="hint">Kostprijs uit calculatie <b>{{ sheet.source }}</b>.</p>
              }
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
        <app-sales-pdf-sheet
          [orderId]="data.order.id"
          [orderNumber]="data.order.number"
          [customerName]="customerName()"
          [customerLanguage]="customerLanguage()"
          [invoice]="isInvoiceDoc()"
          [dirty]="dirty()"
          [saving]="saving()"
          (saveRequested)="save()"
          (closed)="pdfSheet.set(false)"
        />
      }

      @if (palletSheet()) {
        <app-sheet title="Transport &amp; levering" [wide]="true" (closed)="palletSheet.set(false)">
          <div body>
            @if (view(); as data) {
              <app-shipping-planner
                [view]="data"
                [canEdit]="canEdit()"
                [carriers]="carriers()"
                [customerPostcode]="customerPostcode()"
                [countryName]="orderCountryName()"
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
          [categories]="categories()"
          [families]="families()"
          [groupByFamily]="true"
          [preserveSourceOrder]="true"
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
            <div class="load-error__actions">
              <a class="btn" routerLink="/sales">Terug naar verkoop</a>
              @if (validOrderId()) {
                <button class="btn btn--primary" type="button" (click)="retryLoad()">
                  Opnieuw proberen
                </button>
              }
            </div>
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
            <a class="btn btn--primary" routerLink="/sales">Naar verkoop</a>
          </section>
        }
      </main>
    }
  `,
  styles: [`
    :host { display:block }
    .sales-page { max-width:1120px;padding-bottom:96px }
    .sales-page>*+* { margin-top:12px }
    #quote-setup,#order-lines,#quote-logistics,#quote-check,#quote-status { scroll-margin-top:calc(var(--appbar-h) + 76px) }
    .sr-only { position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0 }

    .quote-header-actions { display:flex;align-items:center;gap:5px }
    .quote-header-total { min-width:0;padding-right:3px;display:flex;flex-direction:column;align-items:flex-end;line-height:1.08;white-space:nowrap }
    .quote-header-total span { display:none;color:var(--muted);font-size:8.5px;font-weight:720;letter-spacing:.06em;text-transform:uppercase }
    .quote-header-total strong { font-size:12px;font-variant-numeric:tabular-nums }
    .quote-header-button { min-width:0;padding-inline:10px }
    /* The send pill: the one action that moves the quote forward, dressed to
       belong to the header instead of floating on it. While there are unsaved
       changes it steps back so Opslaan can lead. */
    .quote-header-button--send { gap:6px;border:none;color:#fff;font-weight:650;padding-inline:13px;
      background:linear-gradient(135deg,var(--rose-mid),var(--rose-dark));
      box-shadow:0 3px 10px color-mix(in srgb,var(--rose-dark) 28%,transparent),inset 0 1px 0 rgb(255 255 255/.18) }
    .quote-header-button--send svg { width:13px;height:13px;flex:none;margin-left:-1px }
    .quote-header-button--send-quiet { background:var(--rose-soft);color:var(--rose-dark);
      box-shadow:none;border:1px solid var(--rose-line) }
    @media(max-width:679px) { .quote-header-button--desktop { display:none } }
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
    .quote-hero__label-row { display:flex;align-items:center;flex-wrap:wrap;gap:7px }
    .quote-hero__eyebrow { color:rgb(255 255 255/.58);font-size:10px;font-weight:750;letter-spacing:.14em;text-transform:uppercase }
    .website-request-pill { display:inline-flex;align-items:center;gap:5px;padding:4px 8px;
      border:1px solid rgb(255 255 255/.3);border-radius:999px;background:#fff;color:#5f2437;
      font-size:9.5px;font-weight:800;letter-spacing:.02em;box-shadow:0 4px 14px rgb(0 0 0/.14) }
    .website-request-pill>span { font-size:11px;line-height:1 }
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
    .quote-action-error { align-items:center;flex-wrap:wrap }
    .quote-action-error__actions { display:flex;flex-wrap:wrap;gap:8px }
    .quote-action-error .btn { min-height:48px }
    .website-review { overflow:hidden;border-color:color-mix(in srgb,var(--gold) 58%,var(--line));
      background:linear-gradient(145deg,color-mix(in srgb,var(--gold-soft) 42%,var(--surface)),var(--surface) 56%) }
    .website-review__head { display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:18px;
      border-bottom:1px solid color-mix(in srgb,var(--gold) 34%,var(--line)) }
    .website-review__eyebrow { display:block;margin-bottom:4px;color:var(--rose-dark);font-size:11px;font-weight:820;
      letter-spacing:.11em;text-transform:uppercase }
    .website-review h2 { font-size:18px;line-height:1.25 }
    .website-review__head p { margin-top:5px;color:var(--muted);font-size:14px;line-height:1.45 }
    .website-review__source { flex:none;padding:7px 10px;border:1px solid color-mix(in srgb,var(--gold) 45%,var(--line));
      border-radius:999px;background:var(--surface);color:var(--rose-dark);font-size:12px;font-weight:780 }
    .website-review__grid { display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;background:color-mix(in srgb,var(--gold) 30%,var(--line)) }
    .website-review__grid>button { min-width:0;min-height:172px;padding:16px;display:flex;align-items:flex-start;
      flex-direction:column;gap:5px;border:0;background:var(--surface);color:var(--ink);font:inherit;text-align:left;cursor:pointer }
    .website-review__grid>button:hover { background:color-mix(in srgb,var(--gold-soft) 36%,var(--surface)) }
    .website-review__grid>button:focus-visible { position:relative;z-index:1;outline:3px solid var(--rose);outline-offset:-3px }
    .website-review__step { color:var(--rose-dark);font-size:11px;font-weight:820;letter-spacing:.06em;text-transform:uppercase }
    .website-review__grid strong { font-size:15px;line-height:1.35 }
    .website-review__grid small,.website-review__warning { color:var(--muted);font-size:13px;line-height:1.4;font-style:normal }
    .website-review__warning { color:var(--danger);font-weight:680 }
    .website-review__go { margin-top:auto;color:var(--rose-dark);font-size:13px;font-weight:780 }
    @media(max-width:560px) {
      .quote-action-error { align-items:stretch;flex-direction:column }
      .quote-action-error__actions { display:grid;grid-template-columns:1fr }
      .quote-action-error .btn { width:100% }
      .website-review__head { align-items:stretch;flex-direction:column;padding:16px }
      .website-review__source { align-self:flex-start }
      .website-review__grid { grid-template-columns:1fr }
      .website-review__grid>button { min-height:0;padding:16px }
      .website-review__go { margin-top:7px }
    }
    .revision-card { border-color:color-mix(in srgb,var(--gold) 48%,var(--line)) }

  `, `

    .workflow-layout { position:relative }
    .workflow-nav { position:sticky;top:calc(var(--appbar-h) + 8px);z-index:30;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:3px;padding:5px;border:1px solid var(--line);border-radius:16px;background:rgb(255 255 255/.92);box-shadow:0 5px 18px rgb(26 22 20/.08);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px) }
    .workflow-nav button { min-width:0;min-height:42px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;padding:4px 2px;border:0;border-radius:11px;background:transparent;color:var(--muted);font-size:10px;font-weight:670;cursor:pointer }
    .workflow-nav button:active { background:var(--surface-2) }
    @media (min-width:680px) { .workflow-nav { grid-template-columns:repeat(5,minmax(0,1fr)) } }
    .workflow-nav button>.workflow-nav__mark { width:19px;height:19px;display:grid;flex:none;place-items:center;border:1px solid var(--line-strong);border-radius:50%;color:var(--ink-2) }
    .workflow-nav__copy { min-width:0;display:grid;gap:0;text-align:inherit;line-height:1.1 }
    .workflow-nav__copy b { overflow:hidden;font-size:inherit;font-weight:720;text-overflow:ellipsis;white-space:nowrap }
    .workflow-nav__copy small { display:none;overflow:hidden;color:var(--muted);font-size:9px;font-weight:540;text-overflow:ellipsis;white-space:nowrap }
    .workflow-nav .workflow-nav__active { background:var(--rose-soft);color:var(--rose-dark) }
    .workflow-nav .workflow-nav__active>.workflow-nav__mark { border-color:var(--rose-line);background:var(--surface);color:var(--rose-dark) }
    .workflow-nav .erp-workspace__section-link--complete>.workflow-nav__mark { border-color:var(--ok);background:var(--ok);color:#fff }
    .workflow-nav .erp-workspace__section-link--attention>.workflow-nav__mark { border-color:var(--warn);background:var(--warn-soft);color:var(--warn) }
    .workflow-content { min-width:0;margin-top:0 }
    .workflow-content>*+* { margin-top:0 }

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
    .order-line__head { display:flex;gap:10px;align-items:center }
    .order-line__photo { width:48px;height:48px;flex:none;border:1px solid var(--line);border-radius:12px;background:var(--surface-2);object-fit:cover }
    .order-line__photo--empty { display:grid;place-items:center;color:var(--muted-2);font-size:20px }
    .order-line__identity { flex:1;min-width:0;display:flex;flex-direction:column }
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
    .tier-nudge { margin-top:5px;padding:5px 9px;display:flex;gap:7px;border-radius:9px;background:var(--gold-soft);color:#78591f;font-size:11px }
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
    .order-line { position:relative }
    .order-line__head { padding-right:30px }
    .order-line__remove { position:absolute;top:8px;right:8px;width:28px;height:28px;border:0;border-radius:8px;background:transparent;color:var(--muted-2);font-size:17px;line-height:1;cursor:pointer }
    .order-line__remove:hover:not(:disabled) { background:var(--danger-soft);color:var(--danger) }
    .order-line__remove:disabled { opacity:.35;cursor:default }
    .discount-flip { cursor:pointer;font-weight:700 }
    .check-lines { list-style:none;margin:0 0 14px;padding:0;border:1px solid var(--line);border-radius:14px;background:var(--surface-2);overflow:hidden }
    .check-lines li { display:flex;align-items:center;gap:10px;padding:9px 12px;border-bottom:1px solid var(--line);background:var(--surface) }
    .check-lines li:last-child { border-bottom:0 }
    .check-lines__photo { width:36px;height:36px;flex:none;border-radius:9px;object-fit:cover;background:var(--surface-2) }
    .check-lines__photo--empty { display:grid;place-items:center;color:var(--muted-2) }
    .check-lines__what { display:grid;flex:1;min-width:0 }
    .check-lines__what b { font-size:13px;font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap }
    .check-lines__what small { color:var(--muted);font-size:11px }
    .check-lines__amount { font-weight:700;font-size:13px;white-space:nowrap }
    .check-lines__delivery { display:flex;gap:11px;align-items:center;padding:11px 12px !important;
      background:linear-gradient(120deg,var(--rose-soft),color-mix(in srgb,var(--rose-soft) 55%,var(--surface))) !important }
    .check-lines__delivery-icon { display:grid;place-items:center;width:34px;height:34px;flex:none;border-radius:50%;
      background:var(--surface);border:1px solid var(--rose-line);box-shadow:0 2px 8px rgb(31 25 22/8%) }
    .check-lines__delivery-icon svg { width:19px;height:19px;fill:none;stroke:var(--rose-dark);stroke-width:1.5;stroke-linejoin:round }
    .check-lines__delivery-copy { display:grid }
    .check-lines__delivery-copy b { color:var(--rose-dark);font-size:10px;font-weight:780;letter-spacing:.07em;text-transform:uppercase }
    .check-lines__delivery-copy span { color:var(--ink-2);font-size:12.5px;font-weight:600 }
    .receipt-min { margin-top:12px }
    .receipt-min--goods { margin:2px 0 8px;padding-left:14px }
    .receipt-min__row { display:flex;align-items:baseline;justify-content:flex-end;gap:10px;margin-bottom:5px }
    .receipt-min__row span { color:var(--muted);font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase }
    .receipt-min__row b { color:var(--warn);font-size:12px;font-weight:800 }
    .receipt-min__track { display:block;height:4px;border-radius:99px;background:var(--line);overflow:hidden }
    .receipt-min__track i { display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#e7b566,var(--warn)) }
    .check-total { display:grid;justify-items:center;gap:3px;margin:0 0 12px;padding:18px 14px;border-radius:18px;
      background:linear-gradient(135deg,#23201e,#3a3430);color:#fff;text-align:center }
    .check-total__label { color:rgb(255 255 255/.65);font-size:10.5px;font-weight:750;letter-spacing:.07em;text-transform:uppercase }
    .check-total__value { font-size:30px;font-weight:800;letter-spacing:-.02em }
    .check-total__incl { color:rgb(255 255 255/.75);font-size:12px }
    .check-total__profit { margin-top:5px;padding:3px 11px;border-radius:999px;background:rgb(120 190 140/.25);color:#9fe0b4;font-size:11.5px;font-weight:750 }
    .check-total__profit--negative { background:rgb(220 120 110/.25);color:#f2b0a8 }
    .receipt { margin-top:14px;padding:14px;border:1px solid var(--line);border-radius:16px;background:var(--surface-2) }
    .receipt__title { margin:0 0 8px;color:var(--muted);font-size:11px;font-weight:780;letter-spacing:.07em;text-transform:uppercase }
    .receipt__row { display:flex;justify-content:space-between;gap:12px;padding:6px 0;font-size:13px }
    .receipt__row--head { font-weight:700;border-top:1px solid var(--line);padding-top:9px;margin-top:3px }
    .receipt__row--head:first-of-type { border-top:0;margin-top:0;padding-top:0 }
    .receipt__row--sub { padding:2px 0 2px 14px;color:var(--ink-2);font-size:12.5px }
    .receipt__row--minus span:last-child { color:var(--ok) }
    .receipt__row--total { margin-top:8px;padding-top:11px;border-top:2px solid var(--ink);font-size:15px;font-weight:800 }
    .receipt__note { margin:9px 0 0;color:var(--muted);font-size:11.5px;line-height:1.5 }
    .line-fields { display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px }
    @media (min-width:680px) { .line-fields { grid-template-columns:110px 130px minmax(150px,220px) } }
    .receipt__min { position:relative;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:4px 10px;
      margin:4px 0 6px;padding:8px 11px 12px;border:1px solid #eddcb9;border-radius:11px;background:var(--warn-soft);
      color:var(--warn);font-size:12px;font-weight:650 }
    .receipt__min b { font-weight:800 }
    .receipt__min-track { position:absolute;left:11px;right:11px;bottom:6px;display:block;height:3px;border-radius:99px;background:rgb(0 0 0/8%);overflow:hidden }
    .receipt__min-track i { display:block;height:100%;background:var(--warn) }
    .receipt__profit { margin-left:8px;padding:2px 9px;border-radius:999px;background:var(--ok-soft);color:var(--ok);font-size:11px;font-weight:750;vertical-align:2px }
    .receipt__profit--negative { background:var(--danger-soft);color:var(--danger) }
    .discount-tab { writing-mode:vertical-rl;text-orientation:mixed;padding:0 3px;font-size:9px;font-weight:750;
      letter-spacing:.08em;text-transform:uppercase;color:var(--muted);cursor:pointer }
    .discount-tab--on { background:var(--rose-soft);color:var(--rose-dark) }
    .line-internal__unit--btn { border:1px solid var(--line);border-radius:11px;background:var(--surface);
      font:inherit;text-align:left;cursor:pointer;transition:background .15s ease }
    .line-internal__unit--btn:hover { background:var(--surface-2) }
    .line-internal__unit--btn dt { display:flex;align-items:center;gap:5px }
    .stock-tile__chev { display:inline-grid;place-items:center;width:14px;height:14px;border:1px solid var(--line-strong);
      border-radius:50%;background:var(--surface) }
    .stock-tile__chev::before { content:'';width:4px;height:4px;margin-top:-1px;border-right:1.4px solid var(--ink-2);
      border-bottom:1.4px solid var(--ink-2);transform:rotate(45deg) }
    .cost-sheet { margin:0;padding:0 }
    .cost-sheet div { display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-bottom:1px solid var(--line) }
    .cost-sheet dt { color:var(--ink-2);font-size:12.5px }
    .cost-sheet dt small { display:block;color:var(--muted);font-size:10.5px }
    .cost-sheet dd { margin:0;font-size:13px;font-weight:650 }
    .cost-sheet__sum { font-weight:800 }
    .cost-sheet__sum dt { color:var(--ink);font-weight:750 }
    .pricing-row { display:flex;align-items:center;gap:11px;width:100%;padding:13px 16px;border:0;background:transparent;
      font:inherit;text-align:left;cursor:pointer }
    .pricing-row:hover { background:var(--surface-2) }
    .pricing-row__copy { display:grid;flex:1;min-width:0 }
    .pricing-row__copy strong { font-size:14px }
    .pricing-row__copy small { color:var(--muted);font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap }
    .pricing-row__chev { width:7px;height:7px;flex:none;border-right:1.6px solid var(--muted);border-bottom:1.6px solid var(--muted);
      transform:rotate(45deg);transition:transform .15s ease }
    .pricing-row__chev--open { transform:rotate(-135deg) }
    .pricing-card__head { display:flex;align-items:center;gap:11px;padding:14px 16px 4px }
    .pricing-card__icon { width:32px;height:32px;flex:none;display:grid;place-items:center;border:1px solid var(--line);
      border-radius:11px;background:var(--surface-2);color:var(--muted);font-weight:720 }
    .pricing-card__head h2 { font-size:15px }
    .pricing-card__head p { color:var(--muted);font-size:11.5px }
    .pricing-card__body { padding:10px 16px 14px;display:grid;gap:10px }
    .pricing-card__row { display:flex;flex-wrap:wrap;align-items:center;gap:10px }
    .pricing-card__row--center { justify-content:center }
    .pricing-help { margin:2px 0 -2px;color:var(--muted);font-size:11.5px }
    .pricing-card__markup { width:150px;flex:none }
    .pricing-card__markup .input-affix__suffix { font-size:11px;white-space:nowrap }
    .pricing-card__label { flex:1;min-width:170px }
    .pricing-card__hint { flex:1;min-width:170px }
    .field-duo { display:grid;grid-template-columns:1fr 1fr;gap:10px }
    .order-line__link { display:flex;flex:1;min-width:0;gap:10px;align-items:center;color:inherit;text-decoration:none }
    .order-line__link:hover h3 { color:var(--rose-dark);text-decoration:underline }
    .hero-min { position:relative;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:4px 10px;
      margin-top:10px;padding:8px 12px 13px;border-radius:12px;background:rgb(255 255 255/.09);
      color:#f4cf9a;font-size:12px;font-weight:650 }
    .hero-min--ok { color:#9fe0b4 }
    .hero-min b { font-weight:800 }
    .hero-min__label { color:rgb(255 255 255/.72) }
    .hero-min__track { position:absolute;left:12px;right:12px;bottom:6px;display:block;height:3px;border-radius:99px;background:rgb(255 255 255/.15);overflow:hidden }
    .hero-min__track i { display:block;height:100%;background:currentColor }
    .hero-waiting { display:flex;align-items:center;gap:9px;width:100%;margin-top:8px;padding:9px 12px;
      border:none;border-radius:12px;background:linear-gradient(120deg,rgb(244 207 154/.18),rgb(244 207 154/.08));
      color:#f4cf9a;font:inherit;font-size:12px;font-weight:650;text-align:left;cursor:pointer }
    .hero-waiting i { font-style:normal;flex:none }
    .hero-waiting span { flex:1;min-width:0 }
    .hero-waiting span b { font-weight:800 }
    .hero-waiting__go { flex:none;font-weight:800;white-space:nowrap }
    .sales-mobile-dock { display:flex;align-items:center;gap:7px }
    .sales-mobile-dock__back,.sales-mobile-dock__next { width:42px;height:42px;display:grid;flex:none;place-items:center;padding:0;border:0;border-radius:13px;background:var(--surface-2);color:var(--ink);font:inherit;font-size:23px;cursor:pointer }
    .sales-mobile-dock__next { background:var(--ink);color:#fff }
    .sales-mobile-dock__context { min-width:52px;display:grid;flex:1;line-height:1.15 }
    .sales-mobile-dock__context small { color:var(--muted);font-size:8.5px;font-weight:650;text-transform:uppercase }
    .sales-mobile-dock__context strong { overflow:hidden;font-size:11.5px;text-overflow:ellipsis;white-space:nowrap }
    .sales-mobile-dock .btn { min-height:42px;margin:0;padding-inline:11px }
    .sales-mobile-dock__save:disabled { opacity:.58 }
    .sales-mobile-dock__primary { flex:none }
    @media(max-width:390px) { .sales-mobile-dock__context { display:none }.sales-mobile-dock__primary { flex:1 }.sales-mobile-dock__save { padding-inline:9px!important } }
    @media (min-width:680px) { .sales-mobile-dock { display:none } }
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
    .send-checklist { margin:0 0 14px;padding:4px 0;display:grid;gap:7px;list-style:none }
    .send-checklist li { border:1px solid #f0dcbc;border-radius:11px;background:var(--warn-soft);font-size:12px;color:#7c450b }
    .send-checklist li > button { display:flex;width:100%;gap:9px;align-items:flex-start;padding:9px 11px;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer }
    .send-checklist li > button:hover span { text-decoration:underline }
    .send-checklist b { margin-left:auto;align-self:center;color:var(--warn);font-size:14px;font-weight:700 }
    .send-checklist__ok { display:flex;gap:9px;align-items:flex-start;padding:9px 11px }
    .send-checklist i { display:grid;place-items:center;width:18px;height:18px;flex:none;margin-top:-1px;border-radius:50%;background:var(--warn);color:#fff;font-size:11px;font-style:normal;font-weight:800 }
    .send-checklist__ok { border-color:#c6e5d5!important;background:var(--ok-soft)!important;color:var(--ok)!important }
    .send-checklist__ok i { background:var(--ok) }
    @media(max-width:350px) { .total-highlight { grid-template-columns:1fr } }
    .receipt-korting__add { margin:6px 0 2px;padding:6px 2px;border:0;background:transparent;color:var(--rose-dark);font:inherit;font-size:11px;font-weight:680;cursor:pointer;text-align:left }
    .receipt-korting__add:hover { text-decoration:underline }
    .receipt-korting { display:flex;align-items:center;gap:6px;margin:6px 0 2px }
    .receipt-korting .input { min-height:38px;padding:6px 8px;font-size:12px }
    .receipt-korting .num { max-width:86px }
    .receipt-korting__name { flex:1;min-width:0 }
    .receipt-korting__done { display:grid;place-items:center;width:34px;height:38px;flex:none;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--ok);font-size:14px;cursor:pointer }
    .discount-flip2 { display:inline-flex;flex:none;border:1px solid var(--line);border-radius:10px;overflow:hidden }
    .discount-flip2 button { min-width:34px;min-height:38px;border:0;background:var(--surface);color:var(--muted);font:inherit;font-size:12.5px;font-weight:700;cursor:pointer }
    .discount-flip2__on { background:var(--rose-soft)!important;color:var(--rose-dark)!important }
    .status-actions { display:flex;align-items:center;gap:8px }
    .status-actions__spacer { flex:1 }
    .status-actions .btn--primary { min-width:150px }
    .status-actions .delete-draft { min-height:0;padding:6px 2px;color:var(--danger);opacity:.75 }
    .status-actions .delete-draft:hover { opacity:1;text-decoration:underline }
    @media(max-width:679px) {
      .status-actions { flex-direction:column-reverse;align-items:stretch }
      .status-actions__spacer { display:none }
      .status-actions .delete-draft { margin:4px auto 0 }
    }

    .sales-state { max-width:760px }
    .loading-hero { height:150px;margin-bottom:12px;border-radius:22px }
    .loading-card { height:92px;margin-bottom:10px;border-radius:16px }
    .load-error { padding:24px;text-align:center }
    .load-error__icon { width:48px;height:48px;margin:0 auto 12px;display:grid;place-items:center;border-radius:16px;background:var(--danger-soft);color:var(--danger);font-size:20px;font-weight:760 }
    .load-error h2 { font-size:17px }
    .load-error p { max-width:420px;margin:5px auto 16px;color:var(--muted);font-size:13px }
    .load-error__actions { display:flex;justify-content:center;flex-wrap:wrap;gap:8px }
    .load-error .btn { min-height:48px }

    @media(max-width:520px) {
      .load-error__actions { display:grid;grid-template-columns:1fr }
      .load-error__actions .btn { width:100% }
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

      .line-internal__units .line-internal__unit-profit { grid-column:auto }
    }
    @media(min-width:680px) {
      .sales-page { padding-bottom:24px }
      #quote-setup,#order-lines,#quote-logistics,#quote-check,#quote-status { scroll-margin-top:calc(var(--appbar-h) + 28px) }
      .workflow-layout { display:grid;grid-template-columns:minmax(0,1fr) 168px;gap:16px;align-items:start }
      .workflow-content { grid-column:1;grid-row:1;margin-top:0 }
      .workflow-nav { grid-column:2;grid-row:1;top:calc(var(--appbar-h) + 16px);max-width:none;margin:0;grid-template-columns:1fr;gap:3px;padding:6px;border-radius:15px }
      .workflow-nav button { min-height:44px;flex-direction:row;justify-content:flex-start;gap:8px;padding:7px 9px;font-size:12px;text-align:left }
      .workflow-nav__copy small { display:block }
      .quote-hero__customer { overflow:hidden;text-overflow:ellipsis;white-space:nowrap }
      .order-line__head { grid-template-columns:56px minmax(0,1fr) auto }
      .order-line__photo { width:56px;height:56px }
    }
  `],
})
export class SalesEditor {
  private readonly sales = inject(SalesApi);
  private readonly catalog = inject(CatalogApi);
  private readonly sourcing = inject(SourcingApi);
  private readonly router = inject(Router);
  private readonly ui = inject(Ui);
  private readonly work = inject(WorkQueue);
  private readonly destroyRef = inject(DestroyRef);

  readonly id = input<string>('');
  readonly validOrderId = computed(() => {
    const value = Number(this.id());
    return Number.isInteger(value) && value > 0;
  });
  /* ---- the discount field hides behind its vertical tab ---- */
  private readonly discountOpens = signal(new Map<number, boolean>());

  discountShown(line: PricedLine): boolean {
    return this.discountOpens().get(line.productId) ?? !!line.manualPercent;
  }

  toggleDiscountOpen(productId: number): void {
    const line = this.view()?.priced.lines.find((item) => item.productId === productId);
    const open = line ? this.discountShown(line) : false;
    this.discountOpens.update((map) => new Map(map).set(productId, !open));
  }

  /* ---- where the landed cost came from, one tap deep ---- */
  readonly costSheet = signal<{ title: string; source: string | null;
    rows: { label: string; hint?: string; eur: number; sum?: boolean }[] } | null>(null);

  async openCostSheet(line: PricedLine): Promise<void> {
    this.costSheet.set({ title: line.description, source: null, rows: [] });
    try {
      const product = await this.catalog.product(line.productId);
      const source = product.landedCostSource;
      const rows: { label: string; hint?: string; eur: number; sum?: boolean }[] = [];
      let found = false;
      if (source) {
        const orders = await this.sourcing.purchaseOrders();
        const view = orders.find((item) => item.order.number === source);
        const costingLine = view?.costing.lines.find((item) => item.productId === line.productId);
        if (costingLine && costingLine.quantity > 0) {
          found = true;
          const per = (total: number) => total / costingLine.quantity;
          rows.push({ label: 'Inkoopprijs (EXW)', hint: `${costingLine.quantity.toLocaleString('nl-BE')} stuks in ${source}`, eur: per(costingLine.goodsEur) });
          if (costingLine.originEur) rows.push({ label: '+ Lokale kosten bij vertrek', eur: per(costingLine.originEur) });
          if (costingLine.freightEur) rows.push({ label: '+ Zeevracht', eur: per(costingLine.freightEur) });
          if (costingLine.dutyEur) rows.push({ label: `+ Invoerrechten ${costingLine.dutyRatePct} %`, eur: per(costingLine.dutyEur) });
          if (costingLine.destinationEur) rows.push({ label: '+ Kosten na aankomst', eur: per(costingLine.destinationEur) });
          if (costingLine.extraRevenueEur) rows.push({ label: '+ Enrosed kost', eur: per(costingLine.extraRevenueEur) });
        }
      }
      rows.push({ label: 'Gelande kost per stuk', hint: found ? undefined : 'incl. transport en rechten',
        eur: line.landedUnitCost, sum: true });
      rows.push({ label: 'Netto verkoop', eur: line.netUnitPrice });
      rows.push({ label: this.marginPerUnit(line) < 0 ? 'Verlies per stuk' : 'Winst per stuk',
        eur: this.marginPerUnit(line), sum: true });
      this.costSheet.set({ title: line.description, source: source ?? null, rows });
    } catch {
      this.costSheet.update((sheet) => sheet && { ...sheet,
        rows: [{ label: 'Gelande kost per stuk', eur: line.landedUnitCost, sum: true }] });
    }
  }

  /* ---- extra line discount, thought in percent or in euros ---- */
  private readonly discountModes = signal(new Map<number, 'PCT' | 'EUR'>());

  discountMode(productId: number): 'PCT' | 'EUR' {
    return this.discountModes().get(productId) ?? 'PCT';
  }

  flipDiscountMode(productId: number): void {
    const next = this.discountMode(productId) === 'EUR' ? 'PCT' : 'EUR';
    this.discountModes.update((map) => new Map(map).set(productId, next));
  }

  /** One sentence about when the goods can leave. */
  deliverySummary(data: SalesOrderView): string {
    const lines = data.priced.lines;
    const transit = this.transitDays();
    const transitText = transit
      ? ` Transittijd ± ${transit} ${transit === 1 ? 'werkdag' : 'werkdagen'} naar ${this.orderCountryName()}.`
      : '';
    if (lines.every((line) => line.inStock)) {
      return 'Alles op voorraad - kan meteen geleverd worden.' + transitText;
    }
    const weeks = lines.map((line) => line.deliveryWeek).filter((week): week is string => !!week);
    const unknown = lines.filter((line) => !line.inStock && !line.deliveryWeek).length;
    if (unknown) return 'Levertijd nog te bevestigen voor ' + unknown + ' regel(s).' + transitText;
    const latest = weeks.sort().at(-1);
    return (latest ? 'Volledig leverbaar tegen week ' + latest + '.'
      : 'Levertijd nog te bevestigen.') + transitText;
  }

  /** Road days to the delivery country, from the country configuration. */
  readonly transitDays = computed(() => {
    const code = this.view()?.order.countryCode;
    const days = this.countries().find((country) => country.code === code)?.transitDays;
    return days && days > 0 ? days : null;
  });

  lineDiscountEur(line: PricedLine): number {
    return Math.round(line.gross * (line.manualPercent ?? 0)) / 100;
  }

  /** Typed in euros, stored as the percent the pricing engine speaks. */
  setLineDiscountEur(line: PricedLine, amount: number): void {
    if (!(line.gross > 0)) return;
    const pct = Math.max(0, Math.min(100, (amount / line.gross) * 100));
    this.setLine(line.productId, { manualDiscountPct: Math.round(pct * 10000) / 10000 });
  }

  readonly workflowSections = [
    { id: 'quote-setup', label: 'Klant' },
    { id: 'order-lines', label: 'Producten' },
    { id: 'quote-logistics', label: 'Levering' },
    { id: 'quote-check', label: 'Controle' },
    { id: 'quote-status', label: 'Status' },
  ] as const;
  readonly activeSection = signal<(typeof this.workflowSections)[number]['id']>('quote-setup');

  /**
   * The rail is more than navigation: every stop tells the operator whether
   * that part of the quote is already usable. These checks only explain the
   * existing server-backed data; sending still uses the full preflight below.
   */
  workflowComplete(id: (typeof this.workflowSections)[number]['id']): boolean {
    const data = this.view();
    if (!data) return false;
    if (id === 'quote-setup') {
      return !!this.customers().find((customer) => customer.id === data.order.customerId)
        && !!data.order.countryCode;
    }
    if (id === 'order-lines') {
      return data.priced.lines.length > 0
        && data.priced.lines.every((line) => line.quantity > 0 && line.unitPrice > 0);
    }
    if (id === 'quote-logistics') {
      return !data.priced.validation.freightPricingIssue
        && (data.priced.totals.unassignedCartons ?? 0) <= 0
        && !this.overassigned();
    }
    if (id === 'quote-check') {
      return this.isInvoiceDoc()
        ? this.workflowComplete('quote-setup') && this.workflowComplete('order-lines')
        : this.sendIssues().length === 0;
    }
    return data.order.status !== 'CONCEPT' || (!this.isInvoiceDoc() && this.sendIssues().length === 0);
  }

  workflowAttention(id: (typeof this.workflowSections)[number]['id']): boolean {
    return !!this.view() && !this.workflowComplete(id);
  }

  workflowMark(id: (typeof this.workflowSections)[number]['id'], number: number): string {
    if (this.workflowComplete(id)) return '✓';
    if (this.workflowAttention(id)) return '!';
    return `${number}`;
  }

  workflowHint(id: (typeof this.workflowSections)[number]['id']): string {
    const data = this.view();
    if (!data) return 'Laden…';
    if (id === 'quote-setup') {
      const customer = this.customers().find((item) => item.id === data.order.customerId);
      return customer ? customer.company : 'Klant kiezen';
    }
    if (id === 'order-lines') {
      if (!data.priced.lines.length) return 'Product toevoegen';
      return `${data.priced.lines.length} ${data.priced.lines.length === 1 ? 'regel' : 'regels'}`;
    }
    if (id === 'quote-logistics') {
      if (data.priced.validation.freightPricingIssue) return 'Vracht nakijken';
      if (data.priced.totals.unassignedCartons > 0 || this.overassigned()) return 'Indeling nakijken';
      return data.order.freight === 'TE_BEPALEN' ? 'Vracht later' : 'In orde';
    }
    if (id === 'quote-check') {
      const open = this.isInvoiceDoc()
        ? Number(!this.workflowComplete('quote-setup')) + Number(!this.workflowComplete('order-lines'))
        : this.sendIssues().length;
      return open ? `${open} open ${open === 1 ? 'punt' : 'punten'}` : 'Klaar';
    }
    return this.label(data.order.status);
  }

  /* ---- the phone walks the order as a stepper, ending on the overview ---- */
  readonly desktop = inject(DesktopViewport);
  readonly phoneStep = signal(0);
  readonly phoneStepLabels = ['Gegevens', 'Producten', 'Levering', 'Controle'] as const;

  stepOfId(id: (typeof this.workflowSections)[number]['id']): number {
    return this.stepOf(id);
  }

  private stepOf(id: (typeof this.workflowSections)[number]['id']): number {
    return id === 'quote-setup' ? 0 : id === 'order-lines' ? 1
      : id === 'quote-logistics' ? 2 : 3;
  }

  nextPhoneStep(): void {
    this.phoneStep.update((step) => Math.min(3, step + 1));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  previousPhoneStep(): void {
    this.phoneStep.update((step) => Math.max(0, step - 1));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  focusPendingRevision(): void {
    this.phoneStep.set(0);
    requestAnimationFrame(() => {
      document.getElementById('quote-revision')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

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
  readonly saveError = signal<string | null>(null);
  readonly previewError = signal<string | null>(null);
  readonly customers = signal<Customer[]>([]);
  readonly carriers = signal<Carrier[]>([]);

  readonly isInvoiceDoc = computed(() => (this.view()?.order.docType ?? 'OFFERTE') === 'FACTUUR');

  /* --- the order discount at check time, in percent or euro --- */
  readonly orderDiscountOpen = signal(false);
  readonly orderDiscountShown = signal<'PCT' | 'EUR'>('PCT');

  setOrderDiscountPct(raw: unknown): void {
    const value = raw === null || raw === '' ? null : Math.min(100, Math.max(0, Number(raw) || 0));
    this.patch({ extraDiscountPct: value });
  }

  /** The euro face of the same discount; a typed amount converts to percent. */
  orderDiscountEur(data: SalesOrderView): number | null {
    return data.priced.totals.extraDiscountAmount || null;
  }

  setOrderDiscountEur(raw: unknown): void {
    const data = this.view();
    if (!data) return;
    const amount = raw === null || raw === '' ? null : Math.max(0, Number(raw) || 0);
    if (amount === null) { this.patch({ extraDiscountPct: null }); return; }
    const base = data.priced.totals.subtotal - data.priced.totals.orderDiscountAmount;
    if (base <= 0) return;
    this.patch({ extraDiscountPct: Math.min(100, +(amount / base * 100).toFixed(4)) });
  }

  /**
   * A complaint you can tap: every open point walks straight to the place
   * where it is solved, instead of leaving the reader to guess.
   */
  fixIssue(issue: string): void {
    const text = issue.toLowerCase();
    if (text.includes('vracht') || text.includes('pallet') || text.includes('omdo')
        || text.includes('transport')) {
      this.palletSheet.set(true);
      return;
    }
    if (text.includes('klant') || text.includes('e-mail') || text.includes('land')) {
      this.scrollToSection('quote-setup');
      return;
    }
    if (text.includes('product') || text.includes('minimum')) {
      this.scrollToSection('order-lines');
      return;
    }
    this.scrollToSection('quote-setup');
  }

  readonly orderCountryName = computed(() => {
    const code = this.view()?.order.countryCode;
    return this.countries().find((country) => country.code === code)?.name ?? code ?? null;
  });

  /** Postcode of the order's customer; the staffel resolves its zone with it. */
  readonly customerPostcode = computed(() => {
    const id = this.view()?.order.customerId;
    return this.customers().find((customer) => customer.id === id)?.postalCode ?? null;
  });
  readonly countries = signal<Country[]>([]);
  readonly products = signal<Product[]>([]);
  readonly categories = signal<Category[]>([]);
  readonly families = signal<ProductFamily[]>([]);
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
  readonly pdfFilename = signal('');
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
      const rawId = this.id();
      const routeId = Number(rawId);
      if (Number.isInteger(routeId) && routeId > 0) {
        void this.reload(routeId);
      } else {
        this.loading.set(false);
        this.view.set(null);
        this.loadError.set(rawId ? 'Het ordernummer in de link is ongeldig.' : '');
      }
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
      const [customers, countries, products, categories, families, carriers] = await Promise.all([
        this.sales.customers(), this.sales.countries(), this.catalog.products(),
        this.catalog.categories().catch(() => [] as Category[]),
        this.catalog.productFamilies().catch(() => [] as ProductFamily[]),
        this.sales.carriers().catch(() => []),
      ]);
      this.customers.set(customers);
      this.countries.set(countries);
      this.products.set(products);
      this.categories.set(categories);
      this.families.set(families);
      this.carriers.set(carriers.filter((carrier) => carrier.active));
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
    const routeId = Number(this.id());
    if (Number.isInteger(routeId) && routeId > 0) void this.reload(routeId);
  }

  readonly pendingRevision = computed(
    () => this.revisions().find((revision) => revision.status === 'IN_AFWACHTING') ?? null);

  readonly available = computed(() => {
    const used = new Set((this.view()?.order.lines ?? []).map((line) => line.productId));
    return this.products().filter((product) => !used.has(product.id!));
  });
  readonly lineSections = computed(() => salesLineSections(
    this.view()?.priced.lines ?? [], this.products(), this.categories(), this.families()));

  salesLineNumber(productId: number): number {
    return (this.view()?.priced.lines.findIndex((line) => line.productId === productId) ?? -1) + 1;
  }

  readonly minimumPercent = computed(() => {
    const data = this.view();
    if (!data) return 0;
    const minimum = data.priced.validation.minOrderValue;
    if (!minimum) return 100;
    return Math.min(100, (data.priced.totals.goodsTotal / minimum) * 100);
  });

  /** Commercial fields belong to the draft version only. */
  readonly canEdit = computed(() => this.view()?.order.status === 'CONCEPT');

  /** A customer-link token alone is not use; sending, viewing or deciding is. */
  readonly canDelete = computed(() => {
    const data = this.view();
    return !!data && this.revisions().length === 0
      && isLocallyDeletableSalesDocument(data.order);
  });
  readonly deleting = signal(false);

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
    if (data.priced.lines.some((line) => line.quantity <= 0)) {
      issues.push(websiteCartonRequests(data.order).length
        ? 'Bepaal de doosinhoud en vul voor elk aangevraagd product een positief aantal in'
        : 'Vul voor elk product een positief aantal in');
    }
    if (data.priced.lines.some((line) => !(line.unitPrice > 0))) {
      issues.push('Vul voor elk product een geldige stukprijs groter dan € 0 in');
    }
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
  readonly websiteRequest = isWebsiteQuoteRequest;
  readonly websiteCartons = websiteCartonRequests;
  readonly visibleInternalNotes = internalNotesForDisplay;

  setVisibleInternalNotes(notes: string): void {
    this.patch({
      internalNotes: replaceInternalNotesForDisplay(this.view()?.order, notes),
    });
  }

  customerName(): string {
    const id = this.view()?.order.customerId;
    return this.customers().find((c) => c.id === id)?.company ?? 'Geen klant';
  }

  customerVatNumber(): string | null {
    const id = this.view()?.order.customerId;
    return this.customers().find((customer) => customer.id === id)?.vatNumber?.trim() || null;
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
    this.saveError.set(null);
    this.previewError.set(null);
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
      this.previewError.set(null);
    } catch (failure: unknown) {
      if (version !== this.previewVersion) return;
      this.previewError.set(messageOf(
        failure,
        'Controleer de verbinding voordat je de offerte opslaat of verstuurt.',
      ));
    }
  }

  retryPreview(): void {
    void this.preview();
  }

  /** Writes the draft. Returns false when it could not be written. */
  async save(): Promise<boolean> {
    const data = this.view();
    if (!data || this.saving()) return false;
    if (!this.dirty()) return true;
    if (this.previewTimer !== null) { clearTimeout(this.previewTimer); this.previewTimer = null; }
    this.saving.set(true);
    this.saveError.set(null);
    const sentQuantities = new Map(data.order.lines.map((line) => [line.productId, line.quantity]));
    try {
      const saved = await this.sales.updateOrder(data.order.id, data.order);
      this.adopt(saved);
      /* The server rounds up to whole cartons; when it did, say so - a
         silently changed number reads as a bug. */
      const rounded = saved.order.lines.filter((line) =>
        sentQuantities.has(line.productId) && sentQuantities.get(line.productId) !== line.quantity);
      if (rounded.length) {
        const parts = rounded.map((line) =>
          `${sentQuantities.get(line.productId)} → ${line.quantity} st`);
        this.ui.toast(`Opgeslagen — aantal afgerond op volle dozen: ${parts.join(' · ')}`);
      } else {
        this.ui.toast('Opgeslagen');
      }
      this.linePending.set({});
      return true;
    } catch (failure: unknown) {
      const message = messageOf(
        failure,
        'Controleer de verbinding met Enrosed en probeer opnieuw.',
      );
      this.saveError.set(message);
      this.ui.toast(message, 'err');
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
    if (!this.dirty()) return;
    event.preventDefault();
    event.returnValue = '';
  }

  @HostListener('document:keydown', ['$event'])
  saveShortcut(event: KeyboardEvent): void {
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's'
        || !this.dirty() || this.saving()) return;
    event.preventDefault();
    void this.save();
  }

  reloadLatestOrder(): void {
    const data = this.view();
    if (!data || this.loading() || this.saving()) return;
    const reload = (): void => void this.reload(data.order.id);
    if (!this.dirty()) {
      reload();
      return;
    }
    this.ui.confirm({
      title: 'Serverversie laden',
      message: 'Je niet-opgeslagen offertewijzigingen worden vervangen door de laatst opgeslagen versie.',
      confirmLabel: 'Serverversie laden',
      danger: true,
    }, reload);
  }

  patch(changes: Partial<SalesOrder>): void {
    if (!this.canEdit()) {
      this.ui.toast('Deze offerteversie staat vast. Maak een nieuwe kopie om prijzen of aantallen te wijzigen.', 'err');
      return;
    }
    this.saveError.set(null);
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
    /* First save, then send: pressing Verstuur with unsaved changes
       writes them before anything leaves. */
    if (this.dirty() && !(await this.save())) return;
    /* Blocked is fine, silent is not: say the first open point and walk
       there, instead of a button that mysteriously does nothing. */
    const issues = this.sendIssues();
    if (issues.length) {
      this.ui.toast(issues[0], 'err');
      this.scrollToSection('quote-status');
      return;
    }
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
      void this.work.refresh(true);
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
    if ((strategy === 'COUNTRY_PALLET' || strategy === 'CARRIER')
        && this.isLooseCartons(data)) return;
    const manual = strategy === 'FIXED' ? data.order.manualFreightEur : null;
    const rate = strategy === 'PER_CBM' ? data.order.freightRatePerCbmEur ?? null : null;
    const carrierId = strategy === 'CARRIER'
      ? data.order.freightCarrierId ?? this.carriers()[0]?.id ?? null
      : null;
    const incomplete = (strategy === 'FIXED' && manual == null)
      || (strategy === 'PER_CBM' && !(rate! > 0))
      || (strategy === 'CARRIER' && carrierId == null);
    const state = incomplete ? 'TE_BEPALEN' : data.order.freight ?? 'BEREKEND';
    this.saveFreight(state, manual, strategy, rate, carrierId);
  }

  setLockedCarrier(raw: string): void {
    const data = this.view();
    const id = Number(raw);
    if (!data || !this.canEditTerms() || !Number.isInteger(id) || id <= 0) return;
    this.saveFreight(data.order.freight ?? 'BEREKEND', null, 'CARRIER', null, id);
  }

  private saveFreight(state: 'BEREKEND' | 'TE_BEPALEN' | 'AANGEVULD',
                      manualFreightEur: number | null,
                      freightPricingStrategy: SalesOrder['freightPricingStrategy'],
                      freightRatePerCbmEur: number | null,
                      freightCarrierId: number | null = null): void {
    void (async () => {
      /* The freight endpoint answers with the saved quote: write the draft
         first, or the answer would undo what was typed since. */
      if (this.dirty() && !(await this.save())) return;
      const data = this.view();
      if (!data) return;
      try {
        this.adopt(await this.sales.updateFreight(data.order.id, state, manualFreightEur,
          freightPricingStrategy ?? null, freightRatePerCbmEur, freightCarrierId));
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
    const data = this.view();
    /* Prefilled with number and customer: recognisable in any download
       folder, and the sequence number stays in the name by default. */
    this.pdfFilename.set(data
      ? `${data.order.number} - ${this.customerName() || 'klant'}`.trim()
      : '');
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
      const cleaned = this.pdfFilename().trim().replace(/[\\/:*?"<>|]+/g, '-');
      saveBlob(blob, `${cleaned || data.order.number}.pdf`);
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
        void this.work.refresh(true);
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
        void this.work.refresh(true);
        this.ui.toast('Voorstel afgewezen');
      },
    );
  }

  remove(): void {
    const data = this.view();
    if (!data || !this.canDelete() || this.deleting() || this.ui.confirmRequest() !== null) return;
    const label = salesDocumentLabel(data.order.docType);
    const customer = this.customerName();
    this.ui.confirm(
      {
        title: `${label} verwijderen`,
        message: `Weet je zeker dat je ${label.toLowerCase()} `
          + `<b>${escapeHtml(data.order.number)}</b> van `
          + `<b>${escapeHtml(customer)}</b> wilt verwijderen?<br><br>`
          + (this.dirty() ? 'Niet-opgeslagen wijzigingen gaan ook verloren.<br><br>' : '')
          + 'Dit kan niet ongedaan worden gemaakt.',
        confirmLabel: 'Verwijderen', danger: true,
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
      /* Prevent the unsaved-changes guard from trying to save a deleted row. */
      this.savedOrder.set(JSON.stringify(data.order));
      void this.work.refresh(true);
      this.ui.toast(`${label} verwijderd`);
      await this.router.navigate(['/sales']);
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, `${label} verwijderen mislukt`), 'err');
      this.deleting.set(false);
    }
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
    if (!this.desktop.active()) {
      this.phoneStep.set(this.stepOf(id as (typeof this.workflowSections)[number]['id']));
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
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
    if (strategy === 'PICKUP') return 'Afhalen';
    if (strategy === 'CARRIER') {
      return this.carriers().find((carrier) => carrier.id === data.order.freightCarrierId)?.name
        ?? 'Verzendorganisatie';
    }
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
