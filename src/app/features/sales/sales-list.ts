import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { SalesApi } from '../../core/api/sales-api';
import { Country, Customer, LANGUAGES, QuoteStatus, SalesOrder, SalesOrderView } from '../../core/api/models';
import { PageHeader } from '../../shared/page-header';
import { WorkQueue } from '../../core/api/work-queue';
import { Sheet, Ui } from '../../shared/ui';
import { Skeleton } from '../../shared/skeleton';
import { CbmPipe, DateNlPipe, EurPipe, NumPipe, PctPipe } from '../../shared/pipes';
import {
  STATUS_LABEL, actionNeeded, isWebsiteQuoteRequest, statusClass,
} from './quote-status';
import { messageOf } from '../../core/api/errors';

@Component({
  selector: 'app-sales-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, FormsModule, PageHeader, Sheet, Skeleton,
            EurPipe, NumPipe, PctPipe, CbmPipe, DateNlPipe],
  template: `
    <app-page-header title="Verkoop" [subtitle]="rows().length + ' orders'">
      <button class="btn btn--primary btn--sm hide-mobile" type="button" (click)="startNew()">
        + Nieuw
      </button>
    </app-page-header>

    <div class="content">
      @if (loadError()) {
        <section class="sales-load-error" role="alert">
          <span aria-hidden="true">!</span>
          <div><b>Verkoopoverzicht kon niet worden vernieuwd</b><small>{{ loadError() }}</small></div>
          <button class="btn" type="button" [disabled]="loading()" (click)="load()">
            {{ loading() ? 'Laden…' : 'Opnieuw proberen' }}
          </button>
        </section>
      }
      <!-- What waits on us sits at the top, not tucked under Meer: this is
           the list you keep up with, not something you go look up. -->
      @if (attentionCount()) {
        <!-- The card appears and disappears; without its own bottom margin it
             lands right on top of the search bar. -->
        <div class="card" style="border-color:var(--rose-line);margin-bottom:14px">
          <div class="card__head">
            <h2>Klant wacht op ons</h2>
            <span class="spacer"></span>
            <span class="badge badge--todo">{{ attentionCount() }}</span>
          </div>
          <div class="card__body card__body--flush">
            <div class="list">
              @for (item of openWork(); track $index) {
                <a class="list-item" [routerLink]="['/sales', item.orderId]">
                  <span class="thumb thumb--placeholder">{{ workIcon(item.kind) }}</span>
                  <div class="list-item__body">
                    <div class="list-item__title">{{ item.title }}</div>
                    <div class="list-item__meta">
                      {{ item.orderNumber }}@if (item.customer) { · {{ item.customer }} }
                    </div>
                  </div>
                  <span class="list-item__chev">›</span>
                </a>
              }
            </div>
          </div>
        </div>
      }

      <!-- Offerte or factuur: two piles of a different nature; the tab
           keeps each pile clean instead of mixing claim and proposal. -->
      <div class="doc-tabs" role="tablist" aria-label="Documenttype">
        <button type="button" role="tab" [attr.aria-selected]="docTab() === 'OFFERTE'"
                [class.doc-tabs__active]="docTab() === 'OFFERTE'" (click)="switchTab('OFFERTE')">
          Offertes <b>{{ docCount('OFFERTE') }}</b>
        </button>
        <button type="button" role="tab" [attr.aria-selected]="docTab() === 'FACTUUR'"
                [class.doc-tabs__active]="docTab() === 'FACTUUR'" (click)="switchTab('FACTUUR')">
          Facturen <b>{{ docCount('FACTUUR') }}</b>
        </button>
      </div>

      <!-- One quiet row: search grows, two pills open native pickers,
           the count sits at the end - no card, no grid of chips. -->
      <!-- One Filter button; the choices unfold underneath, catalogue-style. -->
      <div class="sales-filterbar">
        <div class="search-control search-control--bar">
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="6.5"></circle>
            <path d="m16 16 4 4"></path>
          </svg>
          <input class="input" id="sales-search" type="search" inputmode="search"
                 autocomplete="off" placeholder="Zoek klant of nummer…"
                 [ngModel]="query()" (ngModelChange)="query.set($event)" />
          @if (query()) {
            <button class="search-clear" type="button" aria-label="Zoekopdracht wissen"
                    (click)="query.set('')">×</button>
          }
        </div>
        <button class="filter-toggle" type="button"
                [class.filter-toggle--active]="activeFilterCount() > 0"
                [attr.aria-expanded]="filtersOpen()"
                (click)="filtersOpen.set(!filtersOpen())">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4" /></svg>
          <span class="hide-mobile">Filters</span>
          @if (activeFilterCount(); as n) { <b class="filter-toggle__count">{{ n }}</b> }
          <i class="filter-toggle__chev" [class.filter-toggle__chev--open]="filtersOpen()"></i>
        </button>
        @if (docTab() === 'OFFERTE' && websiteRequests().length) {
          <button class="website-filter" type="button"
                  [class.website-filter--active]="websiteOnly()"
                  [attr.aria-pressed]="websiteOnly()"
                  (click)="websiteOnly.set(!websiteOnly())">
            <span>Websiteaanvragen</span>
            <b>{{ websiteRequests().length }}</b>
          </button>
        }
        @if (filtersOpen()) {
          <div class="filter-grid">
            <label class="filter-field">
              <span class="filter-field__label">Status</span>
              <select class="select filter-field__select" [ngModel]="filter()" (ngModelChange)="selectStatus($event)">
                @for (option of visibleFilters(); track option.value) {
                  <option [ngValue]="option.value">{{ option.label }} ({{ statusCount(option.value) }})</option>
                }
              </select>
            </label>
            <label class="filter-field">
              <span class="filter-field__label">Klant</span>
              <select class="select filter-field__select" [ngModel]="customerFilter()" (ngModelChange)="customerFilter.set($event)">
                <option [ngValue]="''">Alle klanten</option>
                @for (customer of customersWithOrders(); track customer.id) {
                  <option [ngValue]="customer.id">{{ customer.company }}</option>
                }
              </select>
            </label>
          </div>
          <div class="filter-summary">
            <span><strong>{{ rows().length }}</strong> van {{ docCount(docTab()) }}
              {{ docTab() === 'FACTUUR' ? 'facturen' : 'offertes' }}</span>
            @if (activeFilterCount()) {
              <button class="filter-reset" type="button" (click)="clearFilters()">Filters wissen</button>
            }
          </div>
        }
      </div>

      <div class="card">
        <div class="list">
          @for (row of rows(); track row.order.id) {
            <a class="list-item" [routerLink]="['/sales', row.order.id]">
              <div class="list-item__body">
                <div class="list-item__title">{{ customerName(row) }}</div>
                <!-- No country chip: it repeats what the customer name already
                     implies and pushed the date into "18/0...". -->
                <div class="list-item__meta list-item__meta--wrap">
                  {{ row.order.number }} · {{ row.order.orderDate | dateNl }}
                  @if (docTab() === 'FACTUUR' && row.order.invoiceDueDate) {
                    · vervalt {{ row.order.invoiceDueDate | dateNl }}
                  }
                </div>
                <div class="list-item__meta list-item__meta--wrap">
                  {{ row.priced.totals.pieces | num }} st ·
                  @if (row.order.loadMode === 'LOOSE_CARTONS') {
                    {{ row.priced.totals.cartons | num }}
                    {{ row.priced.totals.cartons === 1 ? 'doos' : 'dozen' }} ·
                    {{ row.priced.totals.cbm | cbm }}
                  } @else {
                    {{ row.priced.totals.palletsManual || row.priced.totals.palletsStrict }}
                    {{ (row.priced.totals.palletsManual || row.priced.totals.palletsStrict) === 1
                        ? 'pallet' : 'pallets' }}
                  }
                  @if (row.priced.totals.marginPct) {
                    · marge {{ row.priced.totals.marginPct | pct: 0 }}
                  }
                </div>
              </div>
              <div class="list-item__end list-item__end--stacked">
                @if (websiteRequest(row.order)) {
                  <span class="so-source-mini">Websiteaanvraag</span>
                }
                <div class="strong num">{{ row.priced.totals.total | eur: 0 }}</div>
                <span class="so-status-mini" [class]="'so-status-mini so-status-mini--' + cls(row.order.status)">
                  <i aria-hidden="true"></i>{{ label(row.order.status) }}
                </span>
                @if (row.order.goodsShippedAt) {
                  <span class="so-status-mini so-status-mini--ok">
                    <i aria-hidden="true"></i>Bestelling verzonden
                  </span>
                }
                @if (attention(row); as attn) {
                  <span class="so-status-mini so-status-mini--warn" [attr.title]="attn.join(' · ')">
                    <i aria-hidden="true"></i>{{ attn[0] }}{{ attn.length > 1 ? ' +' + (attn.length - 1) : '' }}
                  </span>
                }
              </div>
              <span class="list-item__chev">›</span>
            </a>
          } @empty {
            @if (loading()) {
              <app-skeleton kind="list" [rows]="5" />
            } @else if (loadError()) {
              <div class="empty">
                <div class="empty__icon">!</div>
                <div class="empty__title">Orders niet geladen</div>
                <p class="muted">Gebruik ‘Opnieuw proberen’ bovenaan.</p>
              </div>
            } @else if (activeFilterCount()) {
              <div class="empty">
                <div class="empty__icon">⌕</div>
                <div class="empty__title">Geen orders gevonden</div>
                <p class="muted">Pas de zoekterm of offertestatus aan.</p>
                <button class="btn" type="button" (click)="clearFilters()">
                  Filters wissen
                </button>
              </div>
            } @else {
              <div class="empty">
                <div class="empty__icon">▤</div>
                <div class="empty__title">Geen orders</div>
                <button class="btn btn--primary" type="button" (click)="startNew()">
                  Nieuwe order
                </button>
              </div>
            }
          }
        </div>
      </div>
    </div>

    <button class="fab" type="button" (click)="startNew()">+ Order</button>

    @if (picking()) {
      <app-sheet [title]="newDocType() === 'FACTUUR' ? 'Nieuwe factuur' : 'Nieuwe offerte'"
                 (closed)="picking.set(false)">
        <div body>
          @if (loading()) {
            <app-skeleton kind="lines" [rows]="3" />
          } @else if (!addingCustomer()) {
            <div class="per-toggle doc-choice" role="group" aria-label="Documenttype">
              <button type="button" [class.on]="newDocType() === 'OFFERTE'"
                      (click)="newDocType.set('OFFERTE')">Offerte</button>
              <button type="button" [class.on]="newDocType() === 'FACTUUR'"
                      (click)="newDocType.set('FACTUUR')">Factuur</button>
            </div>
            @if (newDocType() === 'FACTUUR') {
              <p class="tiny muted" style="margin:-4px 0 10px">
                Meteen een factuur, zonder offerte vooraf — voor directe verkoop.
                Vanuit een geaccepteerde offerte maak je een factuur via de offerte zelf.
              </p>
            }
            <div class="field">
              <label class="req" for="so-customer">Klant</label>
              <select class="select" id="so-customer" [ngModel]="chosen()"
                      (ngModelChange)="selectCustomer($event)">
                @for (customer of customers(); track customer.id) {
                  <option [ngValue]="customer.id">
                    {{ customer.company }} — {{ customer.city }} ({{ customer.countryCode }})
                  </option>
                }
              </select>
            </div>
            <button class="btn btn--block" type="button" (click)="startAddCustomer()">
              + Klant staat er nog niet bij
            </button>
            <p class="tiny muted mt-8">
              Op de beurs staat de klant vaak nog niet in het systeem. Voeg hem hier meteen toe
              zonder de order te verlaten.
            </p>
          } @else {
            <p class="legend"><b>*</b> verplicht — de rest kan je later aanvullen.</p>
            <div class="form-grid">
              <div class="field span-2">
                <label class="req" for="nc-company">Bedrijfsnaam</label>
                <input class="input" id="nc-company" [ngModel]="newCustomer().company"
                       (ngModelChange)="patchNew({ company: $event })" />
              </div>
              <div class="field">
                <label for="nc-contact">Contactpersoon <span class="opt"></span></label>
                <input class="input" id="nc-contact" [ngModel]="newCustomer().contact"
                       (ngModelChange)="patchNew({ contact: $event })" />
              </div>
              <div class="field">
                <label for="nc-email">E-mail <span class="opt"></span></label>
                <input class="input" id="nc-email" type="email" [ngModel]="newCustomer().email"
                       (ngModelChange)="patchNew({ email: $event })" />
                <span class="hint">Nodig zodra je de offerte wil versturen.</span>
              </div>
              <div class="field">
                <label class="req" for="nc-country">Land</label>
                <select class="select" id="nc-country" [ngModel]="newCustomer().countryCode"
                        (ngModelChange)="patchNew({ countryCode: $event })">
                  @for (country of countries(); track country.code) {
                    <option [value]="country.code">{{ country.name }}</option>
                  }
                </select>
              </div>
              <div class="field">
                <label class="req" for="nc-language">Taal</label>
                <select class="select" id="nc-language" [ngModel]="newCustomer().language"
                        (ngModelChange)="patchNew({ language: $event })">
                  @for (language of languages; track language.code) {
                    <option [value]="language.code">{{ language.label }}</option>
                  }
                </select>
                <span class="hint">De offerte vertrekt in deze taal.</span>
              </div>
              <div class="field">
                <label for="nc-city">Stad <span class="opt"></span></label>
                <input class="input" id="nc-city" [ngModel]="newCustomer().city"
                       (ngModelChange)="patchNew({ city: $event })" />
              </div>
            </div>
          }
        </div>
        <div foot style="display:contents">
          @if (addingCustomer()) {
            <button class="btn" type="button" (click)="addingCustomer.set(false)">Terug</button>
            <button class="btn btn--primary" type="button" [disabled]="busy()"
                    (click)="saveNewCustomer()">Klant opslaan</button>
          } @else {
            <button class="btn" type="button" [disabled]="creating()"
                    (click)="picking.set(false)">Annuleren</button>
            <button class="btn btn--primary" type="button"
                    [disabled]="loading() || creating() || chosen() === null"
                    [attr.aria-busy]="creating()"
                    (click)="create()">
              {{ creating() ? 'Aanmaken…' : 'Openen' }}
            </button>
          }
        </div>
      </app-sheet>
    }
  `,
  styles: `
    .so-status-mini { display:inline-flex;align-items:center;gap:6px;max-width:100%;padding:3px 9px;
      border-radius:999px;background:color-mix(in srgb,currentColor 10%,transparent);
      font-size:10.5px;font-weight:750;white-space:nowrap;overflow:hidden;text-overflow:ellipsis }
    .so-status-mini i { width:6px;height:6px;flex:none;border-radius:50%;background:currentColor }
    .so-status-mini--ok { color:var(--ok) }
    .so-status-mini--danger { color:var(--danger) }
    .so-status-mini--gold { color:var(--gold) }
    .so-status-mini--rose { color:var(--rose-dark) }
    .so-status-mini--blue { color:var(--blue) }
    .so-status-mini--neutral { color:var(--muted) }
    .so-status-mini--warn { color:var(--warn) }
    .so-source-mini { display:inline-flex;align-items:center;max-width:100%;padding:4px 9px;
      border:1px solid color-mix(in srgb,var(--rose) 38%,transparent);border-radius:999px;
      background:var(--rose);color:#fff;font-size:10px;font-weight:780;line-height:1.2;
      white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-shadow:0 4px 12px rgb(103 31 52/14%) }
    .website-request-item { background:color-mix(in srgb,var(--rose-soft) 55%,var(--surface)) }
    .website-request-item__icon { border:1px solid var(--rose-line);background:#fff!important;
      color:var(--rose-dark);font-weight:850 }

    .doc-tabs { display:grid;grid-template-columns:1fr 1fr;gap:3px;margin-bottom:10px;padding:4px;
      border:1px solid var(--line);border-radius:14px;background:var(--surface) }
    .doc-tabs button { min-height:40px;display:inline-flex;align-items:center;justify-content:center;gap:7px;
      border:0;border-radius:10px;background:transparent;color:var(--muted);font:inherit;font-size:12.5px;
      font-weight:680;cursor:pointer }
    .doc-tabs button b { min-width:20px;padding:1px 6px;border-radius:999px;background:var(--surface-2);
      font-size:10.5px;font-weight:750 }
    .doc-tabs__active { background:var(--rose-soft)!important;color:var(--rose-dark)!important }
    .doc-tabs__active b { background:var(--surface)!important }
    .doc-choice { margin-bottom:12px }
    .sales-filterbar { display:flex;flex-wrap:wrap;align-items:center;gap:9px;margin-bottom:12px;padding:12px;
      border:1px solid var(--line);border-radius:var(--r);background:color-mix(in srgb,var(--surface) 88%,var(--surface-2));
      box-shadow:0 5px 18px rgb(31 25 22/4%) }
    .sales-load-error { display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;
      gap:12px;margin-bottom:14px;padding:14px;border:1px solid var(--danger);border-radius:var(--r-sm);
      background:var(--danger-soft);color:var(--danger) }
    .sales-load-error>span { display:grid;width:38px;height:38px;place-items:center;border-radius:50%;
      background:var(--surface);font-size:18px;font-weight:800 }
    .sales-load-error>div { display:grid;gap:2px;min-width:0 }
    .sales-load-error b { font-size:15px }
    .sales-load-error small { color:var(--muted);font-size:14px;line-height:1.45 }
    .sales-load-error .btn { min-height:48px }
    .filter-toggle { display:inline-flex;align-items:center;gap:7px;min-height:42px;padding:0 13px;border:1px solid var(--line);
      border-radius:13px;background:var(--surface);color:var(--ink-2);font:inherit;font-size:13px;font-weight:650;cursor:pointer }
    .filter-toggle--active { border-color:var(--rose-line);color:var(--rose-dark);background:var(--rose-soft) }
    .filter-toggle svg { width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round }
    .filter-toggle__count { display:inline-grid;place-items:center;min-width:18px;height:18px;padding:0 5px;border-radius:999px;
      background:var(--rose);color:#fff;font-size:10.5px }
    .filter-toggle__chev { width:6px;height:6px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;
      transform:rotate(45deg);transition:transform .15s ease }
    .filter-toggle__chev--open { transform:rotate(-135deg) }
    .website-filter { display:inline-flex;align-items:center;gap:7px;min-height:42px;padding:0 12px;
      border:1px solid var(--rose-line);border-radius:13px;background:var(--rose-soft);
      color:var(--rose-dark);font:inherit;font-size:12px;font-weight:720;cursor:pointer }
    .website-filter b { display:grid;min-width:20px;height:20px;padding:0 5px;place-items:center;
      border-radius:999px;background:#fff;color:var(--rose-dark);font-size:10px;font-variant-numeric:tabular-nums }
    .website-filter--active { border-color:var(--rose);background:var(--rose);color:#fff }
    .website-filter--active b { color:var(--rose-dark) }
    .filter-grid { flex:1 0 100%;display:grid;gap:10px }
    @media (min-width:680px) { .filter-grid { grid-template-columns:1fr 1fr } }
    .filter-field__label { display:block;margin:0 0 5px 2px;color:var(--muted);font-size:10px;font-weight:750;letter-spacing:.055em;text-transform:uppercase }
    .filter-field__select { min-height:42px;font-size:13px;font-weight:650 }
    .filter-summary { flex:1 0 100%;display:flex;align-items:center;justify-content:space-between;color:var(--muted);font-size:12px }
    .filter-summary strong { color:var(--ink) }
    .filter-reset { border:0;background:transparent;color:var(--rose-dark);font-size:12px;font-weight:700;cursor:pointer }
    .search-control--bar { flex:1 1 200px;min-width:0 }
    .sales-filterbar__count { margin-left:auto;white-space:nowrap }
    .po-filter { position:relative;display:inline-flex;align-items:center;gap:7px;min-height:36px;max-width:46vw;
      padding:0 12px;border:1px solid var(--line);border-radius:999px;background:var(--surface);
      color:var(--ink-2);font-size:12.5px;font-weight:650 }
    .po-filter span { overflow:hidden;text-overflow:ellipsis;white-space:nowrap }
    .po-filter--on { border-color:var(--rose-line);background:var(--rose-soft);color:var(--rose-dark) }
    .po-filter svg { width:16px;height:16px;flex:none;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round }
    .po-filter__native { position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;font-size:16px }
    .order-finder {
      min-width: 0;
      margin-bottom: 14px;
      padding: 16px;
      border: 1px solid var(--line);
      border-radius: var(--r);
      background: var(--surface);
      box-shadow: var(--shadow-sm);
    }
    .order-finder__head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 15px;
    }
    .order-finder__head h2 { margin: 0; font-size: 16px; letter-spacing: -.01em; }
    .order-finder__head p {
      margin: 3px 0 0;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.4;
    }
    .filter-reset {
      display: inline-flex;
      flex: 0 0 auto;
      align-items: center;
      gap: 6px;
      min-height: 36px;
      padding: 5px 8px 5px 10px;
      border: 1px solid var(--rose-line);
      border-radius: 999px;
      background: var(--rose-soft);
      color: var(--rose-dark);
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
    }
    .filter-reset span {
      display: grid;
      min-width: 20px;
      height: 20px;
      padding: 0 5px;
      place-items: center;
      border-radius: 999px;
      background: var(--rose);
      color: white;
      font-size: 10px;
      font-variant-numeric: tabular-nums;
    }
    .filter-controls { display: grid; gap: 12px; min-width: 0; }
    .filter-field { display: flex; min-width: 0; flex-direction: column; gap: 5px; }
    .filter-field > label,
    .desktop-status__label {
      color: var(--ink-2);
      font-size: 12px;
      font-weight: 700;
    }
    .search-control { position: relative; min-width: 0; }
    .search-control > svg {
      position: absolute;
      top: 50%;
      left: 14px;
      width: 18px;
      height: 18px;
      transform: translateY(-50%);
      fill: none;
      stroke: var(--muted);
      stroke-linecap: round;
      stroke-width: 1.8;
      pointer-events: none;
    }
    .search-control .input { padding-right: 46px; padding-left: 42px; }
    .search-control .input::-webkit-search-cancel-button { appearance: none; }
    .search-clear {
      position: absolute;
      top: 50%;
      right: 5px;
      display: grid;
      width: 36px;
      height: 36px;
      padding: 0;
      transform: translateY(-50%);
      place-items: center;
      border: 0;
      border-radius: 50%;
      background: transparent;
      color: var(--muted);
      font-size: 22px;
      cursor: pointer;
    }
    .search-clear:hover { background: var(--surface-2); color: var(--ink); }
    .desktop-status { display: none; }
    .filter-result {
      display: flex;
      min-width: 0;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 7px 12px;
      margin-top: 14px;
      padding-top: 12px;
      border-top: 1px solid var(--line);
      color: var(--ink-2);
      font-size: 12px;
    }
    .filter-result__copy strong { color: var(--ink); font-size: 14px; }
    .filter-result__copy span { color: var(--muted); }
    .active-filters { display: flex; min-width: 0; flex-wrap: wrap; gap: 5px; }
    .active-filters > span {
      display: block;
      max-width: 100%;
      padding: 3px 8px;
      overflow: hidden;
      border-radius: 999px;
      background: var(--rose-soft);
      color: var(--rose-dark);
      font-size: 11px;
      font-weight: 650;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .empty p { margin: 5px 0 13px; font-size: 13px; }

    @media (max-width: 560px) {
      .sales-load-error { grid-template-columns:auto minmax(0,1fr) }
      .sales-load-error .btn { grid-column:1/-1;width:100% }
    }

    @media (min-width: 620px) {
      .filter-controls { grid-template-columns: minmax(0, 1.5fr) minmax(190px, .75fr); }
    }

    @media (min-width: 680px) {
      .order-finder { padding: 18px; }
      .filter-controls { grid-template-columns: minmax(320px, 560px); }
      .mobile-status { display: none; }
      .desktop-status { display: block; margin-top: 14px; }
      .desktop-status__label { margin-bottom: 6px; }
      .status-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 7px;
      }
      .status-option {
        display: flex;
        min-width: 0;
        min-height: 40px;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 8px 10px;
        border: 1px solid var(--line);
        border-radius: 10px;
        background: var(--surface-2);
        color: var(--ink-2);
        font-size: 12px;
        font-weight: 650;
        text-align: left;
        cursor: pointer;
      }
      .status-option:hover { border-color: var(--rose-line); background: var(--rose-soft); }
      .status-option--active {
        border-color: var(--rose);
        background: var(--rose);
        color: white;
      }
      .status-option--active:hover { border-color: var(--rose-dark); background: var(--rose-dark); }
      .status-option > span:first-child {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .status-option__count {
        display: grid;
        flex: 0 0 auto;
        min-width: 22px;
        height: 22px;
        padding: 0 5px;
        place-items: center;
        border-radius: 999px;
        background: rgb(0 0 0 / 6%);
        font-size: 10px;
        font-variant-numeric: tabular-nums;
      }
      .status-option--active .status-option__count { background: rgb(255 255 255 / 22%); }
    }
  `,
})
export class SalesList {
  private readonly sales = inject(SalesApi);
  private readonly router = inject(Router);
  private readonly ui = inject(Ui);
  private readonly work = inject(WorkQueue);

  readonly filters: { value: QuoteStatus | ''; label: string }[] = [
    { value: '', label: 'Alle orders' },
    { value: 'CONCEPT', label: 'Concept' },
    { value: 'VERZONDEN', label: 'Verzonden' },
    { value: 'BEKEKEN', label: 'Bekeken' },
    { value: 'WIJZIGING_GEVRAAGD', label: 'Wijziging gevraagd' },
    { value: 'GEACCEPTEERD', label: 'Geaccepteerd' },
    { value: 'AFGEWEZEN', label: 'Afgewezen' },
    { value: 'VERLOPEN', label: 'Verlopen' },
    { value: 'BETAALD', label: 'Betaald' },
  ];

  readonly filter = signal<QuoteStatus | ''>('');
  readonly docTab = signal<'OFFERTE' | 'FACTUUR'>('OFFERTE');
  readonly newDocType = signal<'OFFERTE' | 'FACTUUR'>('OFFERTE');
  readonly websiteOnly = signal(false);

  switchTab(tab: 'OFFERTE' | 'FACTUUR'): void {
    if (this.docTab() === tab) return;
    this.docTab.set(tab);
    /* Quote statuses and invoice statuses are different vocabularies. */
    this.filter.set('');
    this.websiteOnly.set(false);
  }

  docCount(tab: 'OFFERTE' | 'FACTUUR'): number {
    return this.all().filter((row) => (row.order.docType ?? 'OFFERTE') === tab).length;
  }

  /** Rows of the active tab, before search and filters. */
  private inTab(): SalesOrderView[] {
    return this.all().filter((row) => (row.order.docType ?? 'OFFERTE') === this.docTab());
  }

  readonly visibleFilters = computed(() => this.docTab() === 'FACTUUR'
    ? this.filters.filter((option) => ['', 'CONCEPT', 'VERZONDEN', 'BETAALD'].includes(option.value))
    : this.filters.filter((option) => option.value !== 'BETAALD'));

  /** The amber under-row line, inkoop-style: everything still waiting on us. */
  attention = (row: SalesOrderView): string[] | null => {
    const items: string[] = [];
    const task = this.todo(row.order, row.awaitingResend);
    if (task) items.push(task);
    /* An overdue invoice already reads "Betaling opvolgen"; no second label. */
    if (this.overdue(row.order) && !items.includes('Betaling opvolgen')) items.push('Vervallen');
    return items.length ? items : null;
  };

  overdue(order: SalesOrder): boolean {
    return (order.docType ?? 'OFFERTE') === 'FACTUUR'
      && order.status === 'VERZONDEN'
      && !!order.invoiceDueDate
      && order.invoiceDueDate < new Date().toISOString().slice(0, 10);
  }
  readonly query = signal('');
  readonly picking = signal(false);
  readonly chosen = signal<number | null>(null);
  readonly creating = signal(false);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);

  readonly all = signal<SalesOrderView[]>([]);
  readonly customers = signal<Customer[]>([]);
  readonly languages = LANGUAGES;
  readonly countries = signal<Country[]>([]);

  /* Add a customer quickly without leaving the screen. */
  readonly addingCustomer = signal(false);
  readonly busy = signal(false);
  readonly newCustomer = signal<Customer>(blankCustomer('BE'));

  constructor() {
    void this.work.refresh();
    void this.load();
  }

  async load(): Promise<void> {
    if (this.loading() && this.all().length) return;
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const [orders, customers, countries] = await Promise.all([
        this.sales.orders(), this.sales.customers(), this.sales.countries(),
      ]);
      this.all.set(orders);
      this.customers.set(customers);
      this.countries.set(countries);
      const selected = this.chosen();
      this.chosen.set(customers.some((customer) => customer.id === selected)
        ? selected : customers[0]?.id ?? null);
      /* The user may already be in the new-order sheet; now the real
         decision can be made. */
      if (this.picking() && !customers.length) {
        this.addingCustomer.set(true);
        this.startAddCustomer();
      }
    } catch (failure: unknown) {
      this.loadError.set(messageOf(
        failure,
        'Controleer de verbinding met Enrosed en probeer opnieuw.',
      ));
    } finally {
      this.loading.set(false);
    }
  }

  startAddCustomer(): void {
    this.newCustomer.set(blankCustomer(this.countries()[0]?.code ?? 'BE'));
    this.addingCustomer.set(true);
  }

  patchNew(changes: Partial<Customer>): void {
    this.newCustomer.update((customer) => ({ ...customer, ...changes }));
  }

  /** Saves the new customer and selects them for this order right away. */
  async saveNewCustomer(): Promise<void> {
    if (this.busy()) return;
    if (!this.newCustomer().company.trim()) {
      this.ui.toast('Bedrijfsnaam is verplicht', 'err');
      return;
    }
    this.busy.set(true);
    try {
      const saved = await this.sales.createCustomer(this.newCustomer());
      this.customers.update((list) => [...list, saved]);
      this.chosen.set(saved.id);
      this.addingCustomer.set(false);
      this.ui.toast(`${saved.company} toegevoegd`);
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Klant opslaan mislukt'), 'err');
    } finally {
      this.busy.set(false);
    }
  }

  readonly rows = computed(() => {
    const status = this.filter();
    const customer = this.customerFilter();
    const websiteOnly = this.websiteOnly();
    const needle = this.query().toLowerCase().trim();
    return this.inTab().filter((row) => {
      if (status && row.order.status !== status) return false;
      if (customer !== '' && row.order.customerId !== customer) return false;
      if (websiteOnly && !isWebsiteQuoteRequest(row.order)) return false;
      if (!needle) return true;
      /* Customer and number are how anyone refers to an order out loud. */
      return (this.customerName(row) + ' ' + row.order.number)
        .toLowerCase()
        .includes(needle);
    });
  });

  readonly filtersOpen = signal(false);
  readonly customerFilter = signal<number | ''>('');

  /** Only customers that actually carry orders, in company order. */
  readonly customersWithOrders = computed(() => {
    const ids = new Set(this.all().map((row) => row.order.customerId));
    return this.customers()
      .filter((customer) => ids.has(customer.id))
      .sort((a, b) => a.company.localeCompare(b.company, 'nl'));
  });

  readonly activeCustomerLabel = computed(() =>
    this.customers().find((customer) => customer.id === this.customerFilter())?.company ?? 'Alle klanten');

  readonly activeFilterCount = computed(() =>
    (this.filter() ? 1 : 0) + (this.customerFilter() !== '' ? 1 : 0)
      + (this.query().trim() ? 1 : 0) + (this.websiteOnly() ? 1 : 0));

  readonly activeStatusLabel = computed(() =>
    this.filters.find((option) => option.value === this.filter())?.label ?? 'Alle orders');

  selectStatus(status: QuoteStatus | ''): void {
    this.filter.set(status);
  }

  clearFilters(): void {
    this.query.set('');
    this.filter.set('');
    this.customerFilter.set('');
    this.websiteOnly.set(false);
  }

  statusCount(status: QuoteStatus | ''): number {
    const rows = this.inTab();
    return status ? rows.filter((row) => row.order.status === status).length : rows.length;
  }

  customerName(row: SalesOrderView): string {
    return this.customers().find((c) => c.id === row.order.customerId)?.company ?? 'Geen klant';
  }

  label = (status: QuoteStatus) => STATUS_LABEL[status];
  cls = statusClass;

  /** What is waiting on us; the same source as the bell and the dot. */
  readonly openWork = this.work.actions;

  /** The order marker remains visible in filters and rows, independent of a
      personally dismissed bell item. */
  readonly websiteRequests = computed(() => this.all().filter((row) =>
    (row.order.docType ?? 'OFFERTE') === 'OFFERTE' && isWebsiteQuoteRequest(row.order)));
  readonly attentionCount = computed(() => this.openWork().length);
  readonly websiteRequest = isWebsiteQuoteRequest;

  workIcon(kind: string): string {
    switch (kind) {
      case 'WEBSITE_AANVRAAG': return '↗';
      case 'LEVERTERMIJN': return '◷';
      case 'VRACHT': return '▤';
      case 'VOORSTEL': return '⇄';
      default: return '◉';
    }
  }
  /** What we still must do with this document, or nothing. */
  todo = (order: SalesOrder, awaitingResend = false): string | null => {
    if ((order.docType ?? 'OFFERTE') === 'FACTUUR') {
      if (order.status === 'CONCEPT') return null;
      if (this.overdue(order)) return 'Betaling opvolgen';
      if (!order.goodsShippedAt) return 'Bestelling nog te verzenden';
      return null;
    }
    return actionNeeded(order, awaitingResend);
  };

  startNew(): void {
    this.newDocType.set(this.docTab());
    this.picking.set(true);
    /* While the data is still loading the sheet shows a skeleton; load()
       makes the no-customers-yet call once it actually knows. Deciding on
       an empty in-flight list opened the add-customer form by accident. */
    if (this.loading()) return;
    this.addingCustomer.set(!this.customers().length);
    if (this.addingCustomer()) this.startAddCustomer();
  }

  selectCustomer(value: number | null): void {
    const customerId = Number(value);
    this.chosen.set(Number.isInteger(customerId) && customerId > 0 ? customerId : null);
  }

  async create(): Promise<void> {
    if (this.creating()) return;
    const customerId = this.chosen();
    if (customerId === null) {
      this.ui.toast('Kies eerst een klant', 'err');
      return;
    }
    const customer = this.customers().find((c) => c.id === customerId);
    if (!customer) {
      this.chosen.set(null);
      this.ui.toast('De gekozen klant bestaat niet meer', 'err');
      return;
    }

    this.creating.set(true);
    let view: SalesOrderView;
    try {
      view = await this.sales.createOrder(
        customerId, customer.countryCode, customer.incoterm || 'DAP', this.newDocType());
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Order aanmaken mislukt'), 'err');
      this.creating.set(false);
      return;
    }

    this.picking.set(false);
    try {
      const opened = await this.router.navigate(['/sales', view.order.id, 'edit']);
      if (opened) {
        this.creating.set(false);
        return;
      }
    } catch {
      /* Keep the freshly created order reachable below. */
    }

    this.all.update((orders) => orders.some((row) => row.order.id === view.order.id)
      ? orders : [view, ...orders]);
    this.creating.set(false);
    this.ui.toast(
      `Order ${view.order.number} is aangemaakt. Open hem vanuit het overzicht.`, 'err');
  }
}

function blankCustomer(countryCode: string): Customer {
  return {
    id: null, company: '', contact: '', email: '', phone: '', vatNumber: '',
    countryCode, language: 'NL', address: '', postalCode: '', city: '',
    incoterm: 'DAP', paymentTerms: '30 dagen', notes: '',
  };
}
