import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CatalogApi } from '../../core/api/catalog-api';
import { SalesApi } from '../../core/api/sales-api';
import { saveBlob } from '../../core/api/download';
import { OrderPallet,
  Country, Customer, LANGUAGES, LanguageCode, MarkupMode, Product, QuoteEvent, QuoteRevision,
  SalesOrder, SalesOrderView,
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
  imports: [FormsModule, PageHeader, Sheet, ProductPicker, DateField, WeekField,
            EurPipe, NumPipe, PctPipe, CbmPipe, DateNlPipe, DateTimeNlPipe, WeekNlPipe],
  template: `
    @if (view(); as data) {
      <!-- Only PDF up top. Sending lives in the bottom bar alone: the same
           action twice on one screen means one of them is the wrong one. -->
      <app-page-header [title]="data.order.number" [subtitle]="customerName()"
                       [showBack]="true" [showBell]="false"
                       [titleEditable]="true"
                       (titleChange)="patch({ number: $event })">
        <button class="btn btn--sm" type="button" (click)="openPdfSheet()">PDF</button>
      </app-page-header>

      <div class="content content--with-action-bar">
        <!-- ======================================= status and history -->
        <div class="card">
          <!-- The status block is itself the button to the history: that is
               where you look when wondering how this quote got here, and it
               saves a button on a screen that already has plenty. -->
          <button class="status-bar" type="button" (click)="toggleHistory()"
                  [attr.aria-expanded]="historyOpen()">
            <span class="badge" [class]="'badge--' + cls(data.order.status)">
              {{ label(data.order.status) }}
            </span>
            @if (data.order.sentAt) {
              <span class="small muted">verzonden {{ data.order.sentAt | dateNl }}</span>
            }
            @if (data.order.viewedAt) {
              <span class="small muted">
                · {{ data.order.viewCount }}× bekeken, laatst
                {{ data.order.viewedAt | dateNl }}
              </span>
            }
            @if (data.order.signedByName) {
              <span class="small ok-text">· getekend door {{ data.order.signedByName }}</span>
            }
            @if (!historyOpen() && lastEvent(); as last) {
              <!-- A bare "Concept" badge says nothing; the latest step does. -->
              <span class="small muted">· {{ last.summary }}</span>
            }
            <span class="spacer"></span>
            <span class="status-bar__more">
              Geschiedenis
              <span class="status-bar__toggle" [class.status-bar__toggle--open]="historyOpen()">
                ▾
              </span>
            </span>
          </button>

          @if (historyOpen()) {
            <div class="card__body" style="padding-top:0">
              <div class="section-title" style="margin-top:0">Geschiedenis</div>
              @for (step of history(); track step.id) {
                <div class="step" [class.step--customer]="step.byCustomer">
                  <span class="step__dot"></span>
                  <div class="step__body">
                    <div class="step__title">{{ step.summary }}</div>
                    <div class="step__meta">
                      {{ step.at | dateTimeNl }}
                      @if (step.actor) { · {{ step.actor }} }
                    </div>
                    @if (step.detail) {
                      <div class="step__detail">{{ step.detail }}</div>
                    }
                  </div>
                </div>
              } @empty {
                <p class="small muted">Nog niets gebeurd met deze offerte.</p>
              }
            </div>
          }
        </div>

        @if (pendingRevision(); as revision) {
          <div class="card" style="border-color:var(--gold)">
            <div class="card__head">
              <h2>De klant vraagt een wijziging</h2>
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
          </div>
        }

        <!-- ==================================== order -->
        <div class="card">
          <div class="card__head card__head--toggle" (click)="toggle('order')">
            <h2>Order</h2>
            @if (!isOpen('order')) {
              <span class="card__summary">{{ orderSummary() }}</span>
            } @else { <span class="spacer"></span> }
            <span class="card__chev" [class.card__chev--open]="isOpen('order')">›</span>
          </div>
          <div class="collapse" [class.collapse--open]="isOpen('order')"><div class="collapse__inner">
          <div class="card__body">
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
                  Leeg = de voorwaarden van de klant. Uit de lijst wordt vertaald op de offerte.
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
              <div class="field span-2">
                <label for="so-notes">Notitie op de offerte <span class="opt"></span></label>
                <input class="input" id="so-notes" [ngModel]="data.order.notes"
                       (ngModelChange)="patch({ notes: $event })" />
                <span class="hint">Deze ziet de klant.</span>
              </div>
              <div class="field span-2">
                <label for="so-internal">Interne notities <span class="opt"></span></label>
                <textarea class="textarea" id="so-internal"
                          [ngModel]="data.order.internalNotes"
                          (ngModelChange)="patch({ internalNotes: $event })"
                          placeholder="Wat je zelf wil onthouden over deze order."></textarea>
                <span class="hint">
                  Blijft binnen: niet op de offerte, niet in het klantportaal.
                </span>
              </div>
            </div>
          </div>
          </div></div>
        </div>

        <!-- ==================================== price build-up -->
        <div class="card">
          <div class="card__head card__head--toggle" (click)="toggle('pricing')">
            <h2>Prijsopbouw</h2>
            @if (!isOpen('pricing')) {
              <span class="card__summary">{{ pricingSummary() }}</span>
            } @else { <span class="spacer"></span> }
            <span class="card__chev" [class.card__chev--open]="isOpen('pricing')">›</span>
          </div>
          <div class="collapse" [class.collapse--open]="isOpen('pricing')"><div class="collapse__inner">
          <div class="card__body">
            <div class="chips" style="margin-bottom:10px">
              <button class="chip" type="button"
                      [class.active]="data.order.markupMode === 'PRODUCT'"
                      (click)="setMarkupMode('PRODUCT')">Opslag per product</button>
              <button class="chip" type="button"
                      [class.active]="data.order.markupMode === 'ORDER'"
                      (click)="setMarkupMode('ORDER')">Opslag op deze order</button>
            </div>
            @if (data.order.markupMode === 'ORDER') {
              <div class="field">
                <label for="so-markup">Opslag op de kostprijs, voor de hele order</label>
                <div class="input-affix">
                  <input class="input num right" id="so-markup" type="number" min="0" step="1"
                         inputmode="decimal" [ngModel]="data.order.orderMarkupPct"
                         (ngModelChange)="patch({ orderMarkupPct: +$event })" />
                  <span class="input-affix__suffix">%</span>
                </div>
              </div>
            } @else {
              <p class="small muted">Elk product gebruikt zijn eigen opslag uit de catalogus.</p>
            }

            <details style="margin-top:12px;border-top:1px solid var(--line);padding-top:12px">
              <summary class="small strong" style="cursor:pointer">
                Extra korting <span class="opt"></span>
              </summary>
              <p class="small muted" style="margin:10px 0">
                Losse korting bovenop de staffels, bijvoorbeeld een beurskorting. Ze rekent
                over wat er ná de staffelkorting nog staat, zodat de twee niet dubbel over
                hetzelfde bedrag lopen. Verschijnt met deze naam op de offerte.
              </p>
              <div class="field-row">
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
                         [ngModel]="data.order.extraDiscountLabel"
                         (ngModelChange)="patch({ extraDiscountLabel: $event })" />
                </div>
              </div>
            </details>
          </div>
          </div></div>
        </div>

        <!-- ==================================== lines -->
        <div class="card" id="order-lines">
          <div class="card__head">
            <h2>Regels</h2><span class="spacer"></span>
            <button class="btn btn--sm" type="button" (click)="openPicker()">+ Product</button>
          </div>
          <div class="card__body card__body--flush">
            <div class="list">
              @for (line of data.priced.lines; track line.productId) {
                <div class="list-item" style="flex-direction:column;align-items:stretch;gap:10px">
                  <div class="row">
                    <div class="list-item__body">
                      <div class="list-item__title">{{ line.description }}</div>
                      <div class="list-item__meta">
                        {{ line.sku }} · {{ line.cartons | num }} dozen ·
                        {{ line.pallets }} pallet(s) · {{ line.cbm | cbm }}
                      </div>
                    </div>
                    <div class="list-item__end">
                      <div class="strong num">{{ line.net | eur }}</div>
                      @if (line.discountPct) {
                        <div class="tiny ok-text">−{{ line.discountPct | pct: 1 }}</div>
                      }
                    </div>
                  </div>

                  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">
                    <div class="field">
                      <label [attr.for]="'q-' + line.productId">Aantal</label>
                      <input class="input input--sm num right" [id]="'q-' + line.productId"
                             type="number" min="0" step="1" inputmode="numeric"
                             [ngModel]="lineDraft()[line.productId] ?? line.quantity"
                             (ngModelChange)="setLineQuantity(line.productId, +$event)" />
                      @if (linePending()[line.productId]; as to) {
                        <span class="hint warn-text">Wordt zo <b>{{ to | num }}</b></span>
                      }
                    </div>
                    <div class="field">
                      <label [attr.for]="'p-' + line.productId">Stukprijs</label>
                      <input class="input input--sm num right" [id]="'p-' + line.productId"
                             type="number" min="0" step="0.01" inputmode="decimal"
                             [ngModel]="line.unitPrice"
                             (ngModelChange)="setLine(line.productId, { unitPriceEur: +$event })" />
                    </div>
                    <div class="field">
                      <label [attr.for]="'d-' + line.productId">Extra korting %</label>
                      <input class="input input--sm num right" [id]="'d-' + line.productId"
                             type="number" min="0" max="100" step="0.5" inputmode="decimal"
                             [ngModel]="line.manualPercent"
                             (ngModelChange)="setLine(line.productId, { manualDiscountPct: +$event })" />
                    </div>
                  </div>

                  <!-- Delivery: from stock the server counts a date from the
                       next working day plus the country's transit time. When
                       stock is short, you pick a delivery week yourself.
                       Never mandatory. -->
                  <div class="delivery">
                    <div class="row" style="gap:6px;align-items:flex-start">
                      <span class="stock-dot" style="margin-top:5px"
                            [class.stock-dot--none]="!line.inStock && !line.deliveryWeek"
                            [class.stock-dot--ok]="line.inStock || line.deliveryWeek"></span>
                      <span class="small grow">
                        @if (line.inStock) {
                          Leverbaar vanaf <b>{{ line.deliveryDate | dateNl }}</b>
                          @if (line.deliveryWeek) { · {{ line.deliveryWeek | weekNl: 'short' }} }
                        } @else if (line.deliveryWeek) {
                          Levering in <b>{{ line.deliveryWeek | weekNl }}</b>
                          <span class="muted">· {{ line.shortfall | num }} stuks te kort</span>
                        } @else {
                          <span class="danger-text">
                            <b>Levertermijn afspreken</b> — {{ line.shortfall | num }} stuks
                            te kort
                          </span>
                        }
                      </span>
                      <!-- A green line must be adjustable too: the calculated
                           date is an estimate, not a promise. -->
                      <button class="delivery__edit" type="button"
                              [attr.aria-label]="'Levertermijn wijzigen'"
                              [attr.aria-expanded]="editingDelivery() === line.productId"
                              (click)="toggleDelivery(line.productId)">✎</button>
                    </div>
                    @if (!line.inStock || editingDelivery() === line.productId) {
                      <div class="field mt-8" style="margin-bottom:0">
                        <label [attr.for]="'w-' + line.productId">
                          Leverweek <span class="opt"></span>
                        </label>
                        <app-week-field [fieldId]="'w-' + line.productId"
                                        [value]="weekOf(line.productId)"
                                        (valueChange)="setLine(line.productId, { deliveryWeek: $event })" />
                        <span class="hint">
                          @if (line.inStock) {
                            Er is voorraad, dus de datum hierboven geldt. Vul je toch een week
                            in, dan gaat die naar de klant.
                          } @else {
                            Kies de week waarin je denkt te leveren; de klant ziet die op zijn
                            offerte. Leeg laten mag ook.
                          }
                        </span>
                      </div>
                    }
                  </div>

                  @if (privacy.showPurchase()) {
                    <div class="internal">
                      <div class="internal__tag">intern</div>
                      <div class="stat-row stat-row--muted">
                        <span>Inkoopprijs (landed)</span>
                        <span class="num">{{ line.landedUnitCost | eur: 4 }}</span>
                      </div>
                      <div class="stat-row stat-row--muted">
                        <span>Marge</span>
                        <span class="num strong"
                              [class.ok-text]="line.marginPct >= 25"
                              [class.danger-text]="line.marginPct < 10">
                          {{ line.marginEur | eur }} · {{ line.marginPct | pct: 1 }}
                        </span>
                      </div>
                    </div>
                  }

                  <div class="row" style="gap:8px">
                    @if (line.nextTierAtQuantity) {
                      <span class="tiny warn-text">
                        +{{ line.nextTierAtQuantity - line.quantity | num }} st →
                        {{ line.nextTierPercent | pct: 0 }}
                      </span>
                    }
                    <span class="grow"></span>
                    <button class="btn btn--sm btn--danger" type="button"
                            (click)="removeLine(line.productId)">Verwijderen</button>
                  </div>
                </div>
              } @empty {
                <div class="empty">
                  <div class="empty__icon">◇</div>
                  <div class="empty__title">Nog geen producten</div>
                  <button class="btn btn--primary" type="button" (click)="openPicker()">
                    Product toevoegen
                  </button>
                </div>
              }
            </div>
          </div>
        </div>

        <!-- ==================================== pallets -->
        <div class="card">
          <div class="card__head"><h2>Pallets</h2>
            <span class="spacer"></span>
            <span class="card__summary" style="flex:none">{{ palletSummary() }}</span>
          </div>
          <div class="card__body">
            @if (data.order.pallets.length) {
              <div class="row" style="margin-bottom:10px">
                <span class="badge" [class]="layoutOk() ? 'badge--ok' : 'badge--warn'">
                  {{ layoutStatus() }}
                </span>
              </div>
            }
            @if (data.priced.totals.unassignedCartons > 0) {
              <div class="pallet-warn">
                {{ data.priced.totals.unassignedCartons }} dozen staan nog op geen pallet —
                de vracht telt alleen jouw pallets.
              </div>
            }
            <!-- Managing happens in a full-height sheet: rearranging pallets
                 halfway down a long form kept scrolling out of view on a
                 phone. -->
            <button class="btn btn--block" type="button" (click)="palletSheet.set(true)">
              {{ data.order.pallets.length ? 'Indeling beheren' : 'Zelf pallets indelen' }}
            </button>
          </div>
        </div>

        <!-- ==================================== totals -->
        <div class="card">
          <div class="card__head"><h2>Totaal</h2></div>
          <div class="card__body">
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
            <div class="stat-row">
              <span>Vracht ({{ palletCountLabel(data.priced.totals) }})
                <button class="linklike" type="button"
                        (click)="freightOpen.set(!freightOpen())">aanpassen</button>
              </span>
              <span class="num">
                @if (data.order.freight === 'TE_BEPALEN') {
                  <span class="danger-text">nog te bepalen</span>
                } @else {
                  {{ data.priced.totals.freight | eur }}
                }
              </span></div>

            @if (freightOpen()) {
              <div class="freight-edit">
                <label class="row" style="gap:8px;cursor:pointer">
                  <input type="checkbox"
                         [checked]="data.order.freight === 'TE_BEPALEN'"
                         (change)="setFreightPending($any($event.target).checked)" />
                  <span class="small strong">Vracht wordt later bepaald</span>
                </label>
                <span class="hint">
                  De klant ziet dan "nog te bepalen" in plaats van een bedrag, en leest dat
                  wij het laten weten. Er telt niets mee in het totaal.
                </span>

                @if (data.order.freight !== 'TE_BEPALEN') {
                  <div class="field mt-8" style="margin-bottom:0">
                    <label for="so-freight">Eigen vrachtbedrag <span class="opt"></span></label>
                    <input class="input num right" id="so-freight" type="number"
                           min="0" step="0.01" inputmode="decimal"
                           [ngModel]="data.order.manualFreightEur"
                           (ngModelChange)="patch({ manualFreightEur: $event === null || $event === ''
                                                    ? null : +$event })" />
                    <span class="hint">
                      Leeg laten betekent: reken het tarief van het bestemmingsland.
                    </span>
                  </div>
                }
              </div>
            }
            <div class="stat-row"><span>Administratie</span>
              <span class="num">{{ data.priced.totals.handling | eur }}</span></div>
            <div class="stat-row stat-row--total"><span>Totaal</span>
              <span class="num">{{ data.priced.totals.total | eur }}</span></div>
            @if (data.priced.totals.vatLegalMention) {
              <div class="stat-row stat-row--muted">
                <span>BTW — {{ vatLabel(data.priced.totals.vatTreatment) }}</span>
                <span class="num">{{ 0 | eur }}</span></div>
            } @else {
              <div class="stat-row stat-row--muted">
                <span>BTW {{ data.priced.totals.vatRatePct | pct: 1 }}</span>
                <span class="num">{{ data.priced.totals.vatAmount | eur }}</span></div>
              <div class="stat-row stat-row--muted"><span>Totaal incl. BTW</span>
                <span class="num">{{ data.priced.totals.totalInclVat | eur }}</span></div>
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
        </div>

        @if (privacy.showPurchase()) {
          <div class="card">
            <div class="card__head"><h2>Marge</h2><span class="spacer"></span>
              <span class="badge badge--neutral">intern</span></div>
            <div class="card__body">
              <div class="stat-row"><span>Inkoopwaarde</span>
                <span class="num">{{ data.priced.totals.costTotal | eur }}</span></div>
              <div class="stat-row stat-row--sub"><span>Brutomarge</span>
                <span class="num" [class.ok-text]="data.priced.totals.marginPct >= 25"
                      [class.danger-text]="data.priced.totals.marginPct < 10">
                  {{ data.priced.totals.marginEur | eur }} ·
                  {{ data.priced.totals.marginPct | pct: 1 }}
                </span></div>
              @if (data.priced.validation.productsWithoutCost.length) {
                <div class="alert alert--warn mt-12">
                  <span class="alert__icon">!</span>
                  <div>Geen kostprijs voor
                    <b>{{ data.priced.validation.productsWithoutCost.join(', ') }}</b>.</div>
                </div>
              }
            </div>
          </div>
        }

        @if (data.order.countryCode) {
          <div class="card">
            <div class="card__head"><h2>Minimum orderwaarde</h2></div>
            <div class="card__body">
              <div class="meter__track">
                <div class="meter__fill"
                     [class.meter__fill--ok]="data.priced.validation.meetsMinimum"
                     [style.width.%]="minimumPercent()"></div>
              </div>
              <div class="meter__labels">
                <span>{{ data.priced.totals.goodsTotal | eur: 0 }} van
                  {{ data.priced.validation.minOrderValue | eur: 0 }}</span>
                <span>{{ minimumPercent() | num: 0 }}%</span>
              </div>
              @if (!data.priced.validation.meetsMinimum) {
                <div class="alert alert--danger mt-12">
                  <span class="alert__icon">!</span>
                  <div>Nog <b>{{ data.priced.validation.shortfall | eur }}</b> nodig.</div>
                </div>
              }
            </div>
          </div>
        }

        <!-- ==================================== sending the quote -->
        <div class="card">
          <div class="card__head"><h2>Offerte</h2></div>
          <div class="card__body">
            <button class="btn btn--primary btn--block" type="button"
                    [disabled]="sending()" (click)="openSend()">
              {{ data.order.sentAt ? 'Opnieuw versturen' : 'Versturen naar de klant' }}
            </button>
            <button class="btn btn--block mt-8" type="button" (click)="openPdfSheet()">
              PDF downloaden
            </button>
            @if (data.order.portalToken) {
              <button class="btn btn--block mt-8" type="button" (click)="copyLink()">
                Klantlink kopiëren
              </button>
              <p class="tiny muted mt-8">
                De klant opent hiermee de offerte, tekent of stelt een wijziging voor.
              </p>
            }
            <button class="btn btn--danger btn--block mt-16" type="button" (click)="remove()">
              Order verwijderen
            </button>
          </div>
        </div>
      </div>

      <div class="action-bar">
        <!-- Minimum order value as a hairline on the bar itself: green when
             met, amber while short. No extra height - the bar stays a bar. -->
        @if (data.priced.validation.minOrderValue > 0) {
          <div class="action-bar__meter">
            <div class="action-bar__meter-fill"
                 [class.action-bar__meter-fill--ok]="data.priced.validation.meetsMinimum"
                 [style.width.%]="minimumPercent()"></div>
          </div>
        }
        <div class="action-bar__total">
          <div class="action-bar__label">
            Totaal · {{ palletCountLabel(data.priced.totals) }}
            @if (privacy.showPurchase()) { · marge {{ data.priced.totals.marginPct | pct: 0 }} }
          </div>
          <div class="action-bar__value">{{ data.priced.totals.total | eur: 0 }}</div>
        </div>
        @if (data.order.status === 'AFGEWEZEN' || data.order.status === 'VERLOPEN') {
          <button class="btn btn--primary" type="button"
                  [disabled]="busy()" (click)="reopen()">Heropenen</button>
        } @else {
          <button class="btn btn--primary" type="button" (click)="openSend()">
            {{ data.order.sentAt ? 'Opnieuw versturen' : 'Versturen' }}
          </button>
        }
      </div>

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
      <app-sheet title="Pallets" (closed)="palletSheet.set(false)">
        <div body>
          <!-- Help up front: this sheet is used twice a season, not daily. -->
          <p class="tiny muted" style="margin:0 0 12px">
            Verdeel de dozen per product over de pallets. Aantal aanpassen verplaatst
            dozen, 0 haalt het product van de pallet. De vracht telt jouw pallets.
          </p>
          @if (view(); as data) {
            @if (!data.order.pallets.length) {
              <p class="small muted" style="margin-top:0">
                De rekenmodule stapelt automatisch: {{ data.priced.totals.palletsStrict }}
                pallet(s), elk product apart. Zelf indelen kan ook — fragiel glas bovenaan,
                dozen van één klant samen — en dan telt de vracht jouw indeling.
              </p>
              <button class="btn btn--primary btn--block" type="button" (click)="autoLayout()">
                Start van de berekening
              </button>
              <button class="btn btn--block btn--quiet mt-8" type="button" (click)="addPallet()">
                Start leeg
              </button>
            } @else {
              @if (data.priced.totals.unassignedCartons > 0) {
                <div class="pallet-warn">
                  {{ data.priced.totals.unassignedCartons }} dozen staan nog op geen pallet —
                  de vracht telt alleen de pallets hieronder.
                </div>
              }
              <div class="row" style="margin-bottom:10px;gap:8px">
                <span class="badge" [class]="layoutOk() ? 'badge--ok' : 'badge--warn'">
                  {{ layoutStatus() }}
                </span>
                <span class="spacer"></span>
                <button class="btn btn--sm" type="button" (click)="autoLayout()">
                  Herbereken
                </button>
              </div>
              @for (pallet of data.order.pallets; track $index) {
                <div class="pallet">
                  <div class="pallet__head">
                    <button class="pallet__tool" type="button" [disabled]="$index === 0"
                            (click)="movePallet($index, -1)" aria-label="Omhoog">↑</button>
                    <button class="pallet__tool" type="button"
                            [disabled]="$index === data.order.pallets.length - 1"
                            (click)="movePallet($index, 1)" aria-label="Omlaag">↓</button>
                    <input class="pallet__label" [value]="pallet.label"
                           placeholder="Pallet {{ $index + 1 }}"
                           (change)="renamePallet($index, $any($event.target).value)" />
                    <button class="pallet__tool" type="button" (click)="removePallet($index)"
                            aria-label="Pallet verwijderen">✕</button>
                  </div>
                  <div class="pallet__sub">
                    <select class="pallet__type"
                            (change)="setPalletType($index, $any($event.target).value)">
                      @for (option of palletTypes; track option) {
                        <option [value]="option" [selected]="palletType(pallet) === option">
                          {{ option }}
                        </option>
                      }
                      @if (!palletTypes.includes(palletType(pallet))) {
                        <option [value]="palletType(pallet)" selected>{{ palletType(pallet) }}</option>
                      }
                      <option value="__other__">Anders…</option>
                    </select>
                    <input class="pallet__height" type="number" min="0" inputmode="numeric"
                           placeholder="hoogte" [value]="pallet.heightCm ?? ''"
                           (change)="setPalletHeight($index, $any($event.target).value)" />
                    <span class="tiny muted">cm</span>
                    <span class="spacer"></span>
                    <span class="pallet__count">{{ palletCartons(pallet) }} dozen</span>
                  </div>
                  @for (item of pallet.items; track item.productId) {
                    <div class="pallet__item">
                      <span class="pallet__item-name">{{ productLabel(item.productId) }}</span>
                      <input class="pallet__cartons" type="number" min="0" inputmode="numeric"
                             [value]="item.cartons"
                             (change)="setItemCartons($index, item.productId, +$any($event.target).value)" />
                      <span class="tiny muted">dozen</span>
                    </div>
                  }
                  @if (assignable($index).length) {
                    <div class="pallet__add">
                      <select class="select"
                              (change)="addItem($index, +$any($event.target).value);
                                        $any($event.target).selectedIndex = 0">
                        <option value="" selected disabled>+ Product op deze pallet…</option>
                        @for (option of assignable($index); track option.productId) {
                          <option [value]="option.productId">
                            {{ option.description }} — nog {{ option.remaining }} dozen
                          </option>
                        }
                      </select>
                    </div>
                  }
                </div>
              }
              <button class="btn btn--block" type="button" (click)="addPallet()">+ Pallet</button>
              <button class="btn btn--block btn--quiet mt-8" type="button" (click)="clearPallets()">
                Terug naar automatisch
              </button>
            }
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
            <button class="btn btn--primary" type="button" [disabled]="sending()"
                    (click)="send()">{{ sending() ? 'Bezig…' : 'Versturen' }}</button>
          </div>
        </app-sheet>
      }
    }
  `,
})
export class SalesEditor {
  private readonly sales = inject(SalesApi);
  private readonly catalog = inject(CatalogApi);
  private readonly router = inject(Router);
  private readonly ui = inject(Ui);
  readonly privacy = inject(Privacy);
  private readonly work = inject(WorkQueue);

  readonly id = input<string>('');

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
  readonly customers = signal<Customer[]>([]);
  readonly countries = signal<Country[]>([]);
  readonly products = signal<Product[]>([]);
  readonly revisions = signal<QuoteRevision[]>([]);

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
    });
  }

  private async loadReference(): Promise<void> {
    const [customers, countries, products] = await Promise.all([
      this.sales.customers(), this.sales.countries(), this.catalog.products(),
    ]);
    this.customers.set(customers);
    this.countries.set(countries);
    this.products.set(products);
  }

  private async reload(orderId: number): Promise<void> {
    const [view, revisions] = await Promise.all([
      this.sales.order(orderId), this.sales.revisionsFor(orderId),
    ]);
    this.view.set(view);
    this.revisions.set(revisions);
    void this.loadHistory(orderId);
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

  label = (status: SalesOrder['status']) => STATUS_LABEL[status];
  cls = statusClass;

  customerName(): string {
    const id = this.view()?.order.customerId;
    return this.customers().find((c) => c.id === id)?.company ?? 'Geen klant';
  }

  productName(productId: number): string {
    return this.products().find((p) => p.id === productId)?.describedAs ?? '#' + productId;
  }

  currentQuantity(productId: number): number {
    return this.view()?.order.lines.find((l) => l.productId === productId)?.quantity ?? 0;
  }

  /* --------------------------------------------------------- mutating */

  private async save(order: SalesOrder): Promise<void> {
    try {
      this.view.set(await this.sales.updateOrder(order.id, order));
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Opslaan mislukt'), 'err');
    }
  }

  patch(changes: Partial<SalesOrder>): void {
    const data = this.view();
    if (!data) return;
    void this.save({ ...data.order, ...changes });
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
    void this.save({
      ...data.order,
      markupMode: mode,
      lines: data.order.lines.map((line) => ({ ...line, unitPriceEur: null })),
    });
  }

  weekOf(productId: number): string {
    return this.view()?.order.lines.find((l) => l.productId === productId)?.deliveryWeek ?? '';
  }

  /** Quantity being typed per line; shown until the deferred save lands. */
  readonly lineDraft = signal<Record<number, number>>({});
  /** Announced carton correction per line: visible immediately, applied later. */
  readonly linePending = signal<Record<number, number>>({});
  private readonly lineTimers = new Map<number, ReturnType<typeof setTimeout>>();

  /**
   * Line quantities follow the same contract as the pickers: the notice is
   * immediate, the correction is not. Saving on every keystroke made the
   * server round instantly, which put "6" in the field while someone was
   * still typing "640". A round quantity saves after a short pause; an
   * off-carton one gets the full two seconds to finish typing.
   */
  setLineQuantity(productId: number, raw: number): void {
    const wanted = Math.max(0, raw || 0);
    this.lineDraft.update((map) => ({ ...map, [productId]: wanted }));

    const per = this.piecesPerCarton(productId);
    const snapped = Math.ceil(wanted / per) * per;
    const offCarton = snapped !== wanted && wanted > 0;
    this.linePending.update((map) => {
      const next = { ...map };
      if (offCarton) next[productId] = snapped;
      else delete next[productId];
      return next;
    });

    clearTimeout(this.lineTimers.get(productId));
    this.lineTimers.set(productId, setTimeout(() => {
      this.lineDraft.update((map) => {
        const next = { ...map };
        delete next[productId];
        return next;
      });
      this.linePending.update((map) => {
        const next = { ...map };
        delete next[productId];
        return next;
      });
      /* The server rounds sales quantities on save; this is the guarantee
         behind the courtesy above. */
      this.setLine(productId, { quantity: wanted });
    }, offCarton ? 2000 : 400));
  }

  private piecesPerCarton(productId: number): number {
    const per = this.products().find((product) => product.id === productId)
      ?.carton.piecesPerCarton;
    return Math.max(1, per ?? 1);
  }

  setLine(productId: number,
          changes: { quantity?: number; unitPriceEur?: number; manualDiscountPct?: number;
                     deliveryWeek?: string }): void {
    const data = this.view();
    if (!data) return;
    void this.save({
      ...data.order,
      lines: data.order.lines.map((line) =>
        line.productId === productId ? { ...line, ...changes } : line),
    });
  }

  removeLine(productId: number): void {
    const data = this.view();
    if (!data) return;
    void this.save({
      ...data.order,
      lines: data.order.lines.filter((line) => line.productId !== productId),
    });
  }

  openPicker(): void {
    this.picking.set(true);
  }

  /** Price the picker shows: what THIS order would charge for that product. */
  readonly priceOf = (product: Product): number => {
    if (product.fixedSalesPriceEur) return product.fixedSalesPriceEur;
    const order = this.view()?.order;
    const cost = product.landedCostEur ?? 0;
    const markup = order?.markupMode === 'ORDER'
      ? (order.orderMarkupPct ?? 0)
      : (product.markupPct ?? 0);
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
    const data = this.view();
    if (!data) return;
    this.picking.set(false);
    void this.save({
      ...data.order,
      lines: [...data.order.lines,
              { id: null, productId: choice.product.id!, quantity: choice.quantity,
                unitPriceEur: null, manualDiscountPct: null, deliveryWeek: null }],
    });
  }

  /* ------------------------------------------------------------ quote */

  openSend(): void {
    this.sendMessage.set('');
    this.sendSheet.set(true);
  }

  async send(): Promise<void> {
    const data = this.view();
    if (!data || this.sending()) return;
    this.sending.set(true);
    try {
      this.view.set(await this.sales.sendQuote(data.order.id, this.sendMessage()));
      this.sendSheet.set(false);
      void this.work.refresh();
      this.ui.toast('Offerte verstuurd naar de klant');
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
    try {
      this.view.set(await this.sales.reopenQuote(data.order.id));
      this.ui.toast('Offerte staat weer op concept');
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Heropenen mislukt'), 'err');
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
    if (!data) return;
    const wasPending = data.order.freight === 'TE_BEPALEN';
    this.patch({
      freight: pending ? 'TE_BEPALEN' : wasPending ? 'AANGEVULD' : data.order.freight,
    });
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
    const token = this.view()?.order.portalToken;
    if (!token) return;
    const link = `${location.origin}/offerte/${token}`;
    await navigator.clipboard.writeText(link);
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
        this.view.set(await this.sales.approveRevision(revision.id, 'Verkoop', ''));
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
        this.view.set(await this.sales.rejectRevision(revision.id, 'Verkoop', ''));
        this.revisions.set(await this.sales.revisionsFor(revision.salesOrderId));
        void this.work.refresh();
        this.ui.toast('Voorstel afgewezen');
      },
    );
  }

  remove(): void {
    const data = this.view();
    if (!data) return;
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

  /** Which cards are folded open; the lines are the heart, so they start open. */
  readonly openSections = signal(new Set<string>(['lines']));

  toggle(name: string): void {
    const next = new Set(this.openSections());
    if (next.has(name)) { next.delete(name); } else { next.add(name); }
    this.openSections.set(next);
  }

  isOpen(name: string): boolean {
    return this.openSections().has(name);
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
    if (!totals.palletsManual) return `automatisch · ${totals.palletsStrict} pallet(s)`;
    const rest = totals.unassignedCartons > 0
        ? ` · ${totals.unassignedCartons} dozen los` : '';
    return `${totals.palletsManual} pallet(s) · handmatig${rest}`;
  }

  /* ---------------------------------------------------------- pallets */

  palletCountLabel(totals: { palletsManual: number; palletsStrict: number }): string {
    return totals.palletsManual > 0
        ? `${totals.palletsManual} pallet(s) · handmatig`
        : `${totals.palletsStrict} pallet(s)`;
  }

  palletCartons(pallet: OrderPallet): number {
    return pallet.items.reduce((sum, item) => sum + item.cartons, 0);
  }

  productLabel(productId: number): string {
    return this.view()?.priced.lines
        .find((line) => line.productId === productId)?.description ?? `#${productId}`;
  }

  /** Cartons of this product already on any pallet. */
  private assignedFor(productId: number): number {
    return (this.view()?.order.pallets ?? [])
        .flatMap((pallet) => pallet.items)
        .filter((item) => item.productId === productId)
        .reduce((sum, item) => sum + item.cartons, 0);
  }

  /** Lines with cartons left to place, excluding ones already on this pallet. */
  assignable(palletIndex: number): { productId: number; description: string; remaining: number }[] {
    const data = this.view();
    if (!data) return [];
    const onThisPallet = new Set(
        data.order.pallets[palletIndex]?.items.map((item) => item.productId) ?? []);
    return data.priced.lines
        .filter((line) => !onThisPallet.has(line.productId))
        .map((line) => ({
          productId: line.productId,
          description: line.description,
          remaining: line.cartons - this.assignedFor(line.productId),
        }))
        .filter((line) => line.remaining > 0);
  }

  /** The road-freight standards; anything else goes through "Anders…". */
  readonly palletTypes = ['Europallet', 'Blokpallet 100×120', 'Halve pallet 60×80'];

  palletType(pallet: OrderPallet): string {
    return pallet.type || 'Europallet';
  }

  /** Does the manual layout still match the order's cartons exactly? */
  layoutOk(): boolean {
    const data = this.view();
    if (!data) return true;
    return data.priced.totals.unassignedCartons === 0 && !this.overassigned();
  }

  private overassigned(): boolean {
    const data = this.view();
    if (!data) return false;
    return data.priced.lines.some((line) =>
        this.assignedFor(line.productId) > line.cartons);
  }

  layoutStatus(): string {
    const data = this.view();
    if (!data) return '';
    if (this.overassigned()) return 'meer toegewezen dan besteld';
    const loose = data.priced.totals.unassignedCartons;
    return loose > 0 ? `${loose} dozen niet toegewezen` : 'indeling compleet';
  }

  setPalletHeight(index: number, raw: string): void {
    const pallets = this.clonePallets();
    const value = raw === '' ? null : Math.max(0, Math.round(+raw));
    pallets[index] = { ...pallets[index], heightCm: value };
    this.patchPallets(pallets);
  }

  setPalletType(index: number, value: string): void {
    if (value === '__other__') {
      const custom = window.prompt('Soort pallet');
      if (!custom || !custom.trim()) return;
      value = custom.trim();
    }
    const pallets = this.clonePallets();
    pallets[index] = { ...pallets[index], type: value };
    this.patchPallets(pallets);
  }

  private patchPallets(pallets: OrderPallet[]): void {
    this.patch({ pallets });
  }

  private clonePallets(): OrderPallet[] {
    return (this.view()?.order.pallets ?? []).map((pallet) => ({
      ...pallet, items: pallet.items.map((item) => ({ ...item })),
    }));
  }

  /** Starts from the calculator's strict stacking, ready to rearrange. */
  autoLayout(): void {
    const data = this.view();
    if (!data) return;
    const pallets: OrderPallet[] = [];
    for (const line of data.priced.lines) {
      const per = Math.max(1, line.cartonsPerPallet);
      let left = line.cartons;
      while (left > 0) {
        const take = Math.min(per, left);
        pallets.push({ id: null, label: '', type: 'Europallet', heightCm: null,
            items: [{ productId: line.productId, cartons: take }] });
        left -= take;
      }
    }
    this.patchPallets(pallets.map((pallet, index) => ({ ...pallet, label: `Pallet ${index + 1}` })));
  }

  addPallet(): void {
    const pallets = this.clonePallets();
    pallets.push({ id: null, label: `Pallet ${pallets.length + 1}`, type: 'Europallet', heightCm: null, items: [] });
    this.patchPallets(pallets);
  }

  removePallet(index: number): void {
    const pallets = this.clonePallets();
    pallets.splice(index, 1);
    this.patchPallets(pallets);
  }

  movePallet(index: number, direction: number): void {
    const pallets = this.clonePallets();
    const target = index + direction;
    if (target < 0 || target >= pallets.length) return;
    [pallets[index], pallets[target]] = [pallets[target], pallets[index]];
    this.patchPallets(pallets);
  }

  renamePallet(index: number, label: string): void {
    const pallets = this.clonePallets();
    pallets[index] = { ...pallets[index], label: label.trim() };
    this.patchPallets(pallets);
  }

  /** New product on a pallet starts with everything that is still loose. */
  addItem(palletIndex: number, productId: number): void {
    if (!productId) return;
    const line = this.view()?.priced.lines.find((l) => l.productId === productId);
    if (!line) return;
    const remaining = line.cartons - this.assignedFor(productId);
    if (remaining <= 0) return;
    const pallets = this.clonePallets();
    pallets[palletIndex].items.push({ productId, cartons: remaining });
    this.patchPallets(pallets);
  }

  setItemCartons(palletIndex: number, productId: number, cartons: number): void {
    const pallets = this.clonePallets();
    const items = pallets[palletIndex].items;
    const index = items.findIndex((item) => item.productId === productId);
    if (index < 0) return;
    if (!cartons || cartons <= 0) {
      items.splice(index, 1);
    } else {
      items[index] = { ...items[index], cartons: Math.floor(cartons) };
    }
    this.patchPallets(pallets);
  }

  clearPallets(): void {
    this.patchPallets([]);
  }

}
