import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CatalogApi } from '../../core/api/catalog-api';
import { SalesApi } from '../../core/api/sales-api';
import { saveBlob } from '../../core/api/download';
import {
  Country, Customer, LANGUAGES, LanguageCode, MarkupMode, Product, QuoteEvent, QuoteRevision,
  SalesOrder, SalesOrderView,
} from '../../core/api/models';
import { PageHeader } from '../../shared/page-header';
import { ProductPicker } from '../../shared/product-picker';
import { DateField } from '../../shared/date-field';
import { WeekField } from '../../shared/week-field';
import { Privacy } from '../../core/api/privacy';
import { messageOf } from '../../core/api/errors';
import { WorkQueue } from '../../core/api/work-queue';
import { Sheet, Ui } from '../../shared/ui';
import {
  CbmPipe, DateNlPipe, DateTimeNlPipe, EurPipe, NumPipe, PctPipe, WeekNlPipe,
} from '../../shared/pipes';
import { STATUS_LABEL, statusClass } from './quote-status';

/**
 * Verkooporder en offerte.
 *
 * De server rekent; dit scherm toont en bewerkt. Na elke wijziging komt het
 * doorgerekende resultaat terug, dus er staat hier geen tweede rekenmotor die
 * uit de pas kan lopen met de eerste.
 */
@Component({
  selector: 'app-sales-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, PageHeader, Sheet, ProductPicker, DateField, WeekField,
            EurPipe, NumPipe, PctPipe, CbmPipe, DateNlPipe, DateTimeNlPipe, WeekNlPipe],
  template: `
    @if (view(); as data) {
      <app-page-header [title]="data.order.number" [subtitle]="customerName()" [showBack]="true" [showBell]="false">
        <button class="btn btn--sm" type="button" (click)="openPdfSheet()">PDF</button>
        @if (data.order.status === 'AFGEWEZEN' || data.order.status === 'VERLOPEN') {
          <button class="btn btn--primary btn--sm" type="button"
                  [disabled]="busy()" (click)="reopen()">Heropenen</button>
        } @else {
          <button class="btn btn--primary btn--sm" type="button"
                  [disabled]="sending()" (click)="openSend()">
            {{ data.order.sentAt ? 'Opnieuw sturen' : 'Versturen' }}
          </button>
        }
      </app-page-header>

      <div class="content content--with-action-bar">
        <!-- ==================================== status en geschiedenis -->
        <div class="card">
          <!-- Het statusblok is zelf de knop naar de geschiedenis: dat is waar je
               kijkt als je je afvraagt hoe deze offerte hier gekomen is, en het
               scheelt een knop op een scherm dat er al veel heeft. -->
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
            <span class="spacer"></span>
            <span class="status-bar__toggle" [class.status-bar__toggle--open]="historyOpen()">
              ▾
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
              <div class="row wrap mt-12" style="gap:8px">
                <button class="btn btn--primary" type="button" (click)="approve(revision, true)">
                  Wijzigen
                </button>
                <button class="btn" type="button" (click)="approve(revision, false)">
                  Overnemen
                </button>
                <button class="btn" type="button" (click)="reject(revision)">Afwijzen</button>
              </div>
              <span class="hint">
                <b>Wijzigen</b> zet hun aantallen op de order en laat je daarna zelf nog
                bijsturen. <b>Overnemen</b> neemt ze ongewijzigd over.
              </span>
            </div>
          </div>
        }

        <!-- ==================================== order -->
        <div class="card">
          <div class="card__head"><h2>Order</h2></div>
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
                <label for="so-number">Offertenummer</label>
                <input class="input" id="so-number" [ngModel]="data.order.number"
                       (ngModelChange)="patch({ number: $event })" />
                <span class="hint">Wordt automatisch gegeven; aanpassen mag zolang het nummer nog vrij is.</span>
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
        </div>

        <!-- ==================================== prijsopbouw -->
        <div class="card">
          <div class="card__head"><h2>Prijsopbouw</h2></div>
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
        </div>

        <!-- ==================================== regels -->
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
                             [ngModel]="line.quantity"
                             (ngModelChange)="setLine(line.productId, { quantity: +$event })" />
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

                  <!-- Levering: uit voorraad rekent de server een datum vanaf de
                       eerstvolgende werkdag plus de transittijd van het land. Ligt er
                       te weinig, dan vul je zelf een leverweek in. Nooit verplicht. -->
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
                      <!-- Ook een groene regel moet je kunnen bijstellen: de berekende
                           datum is een schatting, geen belofte. -->
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

        <!-- ==================================== totalen -->
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
            <!-- Vracht kan een open post zijn, net als de levertermijn: bij een
                 bestemming buiten de gewone tarieven of een klant die zelf laat
                 ophalen weet je het bij het opmaken nog niet. -->
            <div class="stat-row">
              <span>Vracht ({{ data.priced.totals.palletsStrict }} pallet)</span>
              <span class="num">
                @if (data.order.freight === 'TE_BEPALEN') {
                  <span class="danger-text">nog te bepalen</span>
                } @else {
                  {{ data.priced.totals.freight | eur }}
                }
              </span></div>

            <details style="margin-top:10px;border-top:1px solid var(--line);padding-top:10px">
              <summary class="small strong" style="cursor:pointer">
                Vracht aanpassen <span class="opt"></span>
              </summary>
              <div style="margin-top:10px">
                <label class="row" style="gap:8px;cursor:pointer">
                  <input type="checkbox"
                         [checked]="data.order.freight === 'TE_BEPALEN'"
                         (change)="setFreightPending($any($event.target).checked)" />
                  <span class="small strong">Vracht wordt later bepaald</span>
                </label>
                <span class="hint">
                  De klant ziet dan "nog te bepalen" in plaats van een bedrag, en leest dat
                  wij het laten weten. Er telt niets mee in het totaal — een bedrag verzinnen
                  en later corrigeren is erger, want de klant rekent op wat er stond.
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
            </details>
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

        <!-- ==================================== offerte versturen -->
        <div class="card">
          <div class="card__head"><h2>Offerte</h2></div>
          <div class="card__body">
            <button class="btn btn--primary btn--block" type="button"
                    [disabled]="sending()" (click)="openSend()">
              {{ data.order.sentAt ? 'Opnieuw versturen' : 'Versturen naar de klant' }}
            </button>
            <button class="btn btn--block mt-8" type="button" (click)="downloadPdf()">
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
        <div class="action-bar__total">
          <div class="action-bar__label">
            Totaal · {{ data.priced.totals.palletsStrict }} pallet(s)
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
  /** Loopt er een actie die de knoppen moet blokkeren? */
  readonly busy = signal(false);
  /** Welke regel heeft zijn levertermijnblok opengeklapt. */
  readonly editingDelivery = signal<number | null>(null);
  readonly historyOpen = signal(false);
  readonly pdfSheet = signal(false);
  readonly pdfLanguage = signal<LanguageCode>('NL');
  readonly languages = LANGUAGES;

  /** De taal die bij deze klant hoort; het vertrekpunt van de keuzelijst. */
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

  /* ---------------------------------------------------------- muteren */

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
    /* Handmatige prijzen wissen, anders komt de nieuwe opslag er niet door. */
    void this.save({
      ...data.order,
      markupMode: mode,
      lines: data.order.lines.map((line) => ({ ...line, unitPriceEur: null })),
    });
  }

  weekOf(productId: number): string {
    return this.view()?.order.lines.find((l) => l.productId === productId)?.deliveryWeek ?? '';
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

  /** Prijs die de kiezer toont: wat déze order voor dat product zou rekenen. */
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

  /* ---------------------------------------------------------- offerte */

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
   * Zet een afgewezen offerte terug op concept.
   *
   * Een "nee" is zelden het einde: meestal was het te duur of kwam de
   * levertermijn niet uit. Dan wil je dezelfde offerte bijsturen en opnieuw
   * sturen in plaats van alles over te typen.
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
   * Zet de vracht op "nog te bepalen" of terug.
   *
   * Bij het terugzetten springt de stand niet naar BEREKEND maar naar
   * AANGEVULD wanneer de offerte al met een open post vertrokken is: de klant
   * wacht dan op dat bedrag en hoort te lezen dat het er nu staat.
   */
  setFreightPending(pending: boolean): void {
    const data = this.view();
    if (!data) return;
    const wasPending = data.order.freight === 'TE_BEPALEN';
    this.patch({
      freight: pending ? 'TE_BEPALEN' : wasPending ? 'AANGEVULD' : data.order.freight,
    });
  }

  /**
   * Klapt de geschiedenis open, en haalt ze de eerste keer op.
   *
   * Pas ophalen bij het openen: de meeste keren dat je een offerte opent wil je
   * de regels aanpassen, niet teruglezen wat er gebeurd is.
   */
  async toggleHistory(): Promise<void> {
    const opening = !this.historyOpen();
    this.historyOpen.set(opening);
    if (!opening) return;

    const data = this.view();
    if (!data) return;
    try {
      this.history.set(await this.sales.history(data.order.id));
    } catch {
      this.history.set([]);
    }
  }

  /** Klapt het levertermijnblok van een regel open of dicht. */
  toggleDelivery(productId: number): void {
    this.editingDelivery.set(this.editingDelivery() === productId ? null : productId);
  }

  /**
   * Opent het PDF-venster met de taal van de klant al gekozen.
   *
   * Die staat voorgeselecteerd omdat dat in negen van de tien gevallen klopt -
   * versturen gebruikt hem sowieso. De keuzelijst staat er voor de tiende keer:
   * even een Engelse versie voor iemand die ze intern moet doorgeven, zonder
   * daarvoor de taal op de klantfiche te wijzigen.
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

  /* ------------------------------------------------------ wijzigingen */

  /**
   * Neemt het voorstel van de klant over.
   *
   * In beide gevallen komen zijn aantallen op de order en valt de offerte terug
   * op concept. Het verschil zit in wat je daarna doet: bij *Wijzigen* rolt het
   * scherm door naar de regels zodat je meteen kan bijsturen, bij *Overnemen*
   * blijft het staan zoals de klant het vroeg. Twee knoppen in plaats van één,
   * want "akkoord" en "akkoord mits" zijn twee verschillende antwoorden.
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
        this.view.set(await this.sales.approveRevision(revision.id, 'Verkoop', 'Akkoord.'));
        this.revisions.set(await this.sales.revisionsFor(revision.salesOrderId));
        /* De teller op de tab en het belletje moeten dit meteen kwijt zijn. */
        void this.work.refresh();
        this.ui.toast(thenEdit ? 'Overgenomen — pas gerust nog aan' : 'Voorstel overgenomen');

        if (thenEdit) {
          /* Naar de regels scrollen: dat is waar je nu iets wil doen, en op een
             telefoon staan die anders een scherm lager. */
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
        this.view.set(await this.sales.rejectRevision(revision.id, 'Verkoop', 'Niet akkoord.'));
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
}
