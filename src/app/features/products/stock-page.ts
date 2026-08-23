import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CatalogApi } from '../../core/api/catalog-api';
import { SourcingApi } from '../../core/api/sourcing-api';
import { AuthImage } from '../../core/api/auth-image';
import { Category, ExpectedStock, Product, StockLevel, StockLocation, StockMovement } from '../../core/api/models';
import { messageOf } from '../../core/api/errors';
import { PageHeader } from '../../shared/page-header';
import { Skeleton } from '../../shared/skeleton';
import { DateNlPipe, DateTimeNlPipe, NumPipe } from '../../shared/pipes';
import { Sheet, Ui } from '../../shared/ui';

interface StockRow {
  product: Product;
  byLocation: Map<number, number>;
  total: number;
}

/**
 * Stock across locations: what lies where, moving it, and counting it.
 *
 * Built for the two moments that matter: loading the van for a stand
 * (Verplaatsen) and standing at that stand with a phone, counting
 * (Telling). Everything lands in the stock book with one reference.
 */
@Component({
  selector: 'app-stock-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, AuthImage, PageHeader, Skeleton, NumPipe, DateNlPipe, DateTimeNlPipe, Sheet],
  template: `
    <app-page-header title="Voorraad" [subtitle]="subtitle()">
      @if (!counting()) {
        <button class="btn btn--sm" type="button" [disabled]="loading()" (click)="startCount()">Telling</button>
      }
    </app-page-header>

    <div class="content">
      <section class="catalog-tools" aria-label="Voorraad zoeken en filteren">
        <div class="catalog-search">
          <label class="sr-only" for="stock-search-input">Zoeken</label>
          <svg class="catalog-search__icon" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" />
            <path d="m16 16 4 4" />
          </svg>
          <input class="input catalog-search__input" id="stock-search-input" type="search"
                 placeholder="Zoek naam, SKU of kleur…"
                 [ngModel]="query()" (ngModelChange)="query.set($event)" />
          @if (query()) {
            <button class="catalog-search__clear" type="button" aria-label="Zoekopdracht wissen"
                    (click)="query.set('')">×</button>
          }
        </div>

        <button class="filter-toggle" type="button"
                [class.filter-toggle--active]="activeFilterCount() > 0"
                [attr.aria-expanded]="filtersOpen()"
                (click)="filtersOpen.set(!filtersOpen())">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 6h16M7 12h10M10 18h4" />
          </svg>
          <span class="hide-mobile">Filters</span>
          @if (activeFilterCount(); as n) {
            <b class="filter-toggle__count">{{ n }}</b>
          }
          <i class="filter-toggle__chev" [class.filter-toggle__chev--open]="filtersOpen()"></i>
        </button>

        @if (filtersOpen()) {
        <div class="filter-grid">
          <!-- Which location you are looking at; "Alle" shows the figures side by side. -->
          <label class="filter-field">
            <span class="filter-field__label">Locatie</span>
            <select class="select filter-field__select" aria-label="Locatie" [disabled]="!!counting()"
                    [ngModel]="view()" (ngModelChange)="view.set($event)">
              <option [ngValue]="null">Alle locaties</option>
              @for (location of activeLocations(); track location.id) {
                <option [ngValue]="location.id">{{ location.name }}</option>
              }
            </select>
          </label>

          <label class="filter-field">
            <span class="filter-field__label">Categorie</span>
            <select class="select filter-field__select" aria-label="Filter op categorie"
                    [ngModel]="categoryFilter()" (ngModelChange)="categoryFilter.set($event)">
              <option [ngValue]="null">Alle categorieën</option>
              @for (category of categories(); track category.id) {
                <option [ngValue]="category.id">{{ category.name }}</option>
              }
            </select>
          </label>

          <div class="filter-field filter-sort">
            <span class="filter-field__label" aria-hidden="true">Sorteren</span>
            <div class="filter-sort__box">
              <svg class="filter-sort__icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 7h12M4 12h8M4 17h5" /><path d="M17 10v10m0 0-3-3m3 3 3-3" />
              </svg>
              <span class="filter-sort__text hide-mobile">{{ sortLabel() }}</span>
              <select class="filter-sort__native" aria-label="Sorteren"
                      [title]="'Sorteren: ' + sortLabel()"
                      [ngModel]="sortKey()" (ngModelChange)="sortKey.set($event)">
                @for (option of sortOptions; track option.key) {
                  <option [value]="option.key">{{ option.label }}</option>
                }
              </select>
            </div>
          </div>
        </div>
        }

        @if (filtersOpen() || hasFilters()) {
          <div class="filter-summary" aria-live="polite">
            <span><strong>{{ filtered().length }}</strong> van {{ rows().length }} producten</span>
            @if (hasFilters()) {
              <button class="filter-reset" type="button" (click)="resetFilters()">Filters wissen</button>
            } @else {
              <a class="filter-manage" routerLink="/stock-locations">Locaties beheren ›</a>
            }
          </div>
        }
      </section>

      @if (counting(); as count) {
        <div class="count-bar" role="status">
          <div>
            <b>Telling · {{ locationName(count.locationId) }}</b>
            <small>Vul het getelde aantal in; leeg = ongewijzigd. {{ changedCounts().length }} verschil(len).</small>
          </div>
          <button class="btn btn--sm" type="button" (click)="counting.set(null)">Annuleren</button>
          <button class="btn btn--primary btn--sm" type="button" [disabled]="saving() || !changedCounts().length"
                  (click)="confirmCount()">{{ saving() ? 'Bezig…' : 'Telling bevestigen' }}</button>
        </div>
      }

      @for (section of sections(); track section.key) {
        <!-- One card per category, its name above the white - the same
             shape as the catalogue, so the eye already knows the way. -->
        <section class="section" [style.animation-delay.ms]="$index * 40">
          @if (section.name !== null) {
            <h2 class="section-head">
              <span>{{ section.name }}</span>
              <small>{{ section.rows.length }}</small>
              <small class="section-head__total num">{{ section.total | num }} st.</small>
            </h2>
          }
          <div class="card">
            <div class="list">
            @for (row of section.rows; track row.product.id) {
              <div class="list-item stock-row" [class.stock-row--changed]="isChanged(row.product.id!)">
                <!-- The name opens the stock book; the page itself is one more tap away from there. -->
                <button class="stock-row__product" type="button" (click)="openHistory(row)">
                  @if (row.product.photos.length) {
                    <img class="thumb" [appAuthSrc]="row.product.photos[0].url" alt="" />
                  } @else {
                    <span class="thumb thumb--placeholder">◈</span>
                  }
                  <span class="stock-row__body">
                    <span class="product-row__title">
                      <strong>{{ row.product.name }}</strong>
                      @if (row.product.colour) { <span>{{ row.product.colour }}</span> }
                      @if (row.product.variantSize) { <span>{{ row.product.variantSize }}</span> }
                    </span>
                    <span class="product-row__sku mono">{{ row.product.sku || 'Geen SKU' }}</span>
                    @if (expectedFor(row.product.id!); as exp) {
                      <span class="stock-expected">+{{ exp.quantity | num }} te verwachten{{ exp.expectedArrival ? ' · ' + (exp.expectedArrival | dateNl) : '' }}</span>
                    }
                  </span>
                </button>
                <!-- Every figure is a field: type the real count and leave it,
                     and it is booked at that location as a manual correction. -->
                <div class="list-item__end stock-row__end">
                  @if (view() === null) {
                    @for (location of activeLocations(); track location.id) {
                      <div class="stock-row__figure stock-row__figure--location">
                        <span>{{ location.name }}</span>
                        <input class="stock-row__qty num" type="number" min="0" step="1"
                               inputmode="numeric" [class.muted]="!row.byLocation.get(location.id!)"
                               [attr.aria-label]="row.product.name + ' op ' + location.name"
                               [value]="row.byLocation.get(location.id!) ?? 0"
                               (keydown.enter)="$any($event.target).blur()"
                               (keydown.escape)="$any($event.target).value = row.byLocation.get(location.id!) ?? 0; $any($event.target).blur()"
                               (change)="setQuantity(row, location.id!, $any($event.target))" />
                      </div>
                    }
                    <div class="stock-row__figure stock-row__figure--total">
                      <span>Totaal</span>
                      <strong class="num">{{ row.total | num }}</strong>
                    </div>
                  } @else {
                    <div class="stock-row__figure">
                      <span>{{ locationName(view()!) }}</span>
                      <input class="stock-row__qty num" type="number" min="0" step="1"
                             inputmode="numeric" [class.muted]="!row.byLocation.get(view()!)"
                             [attr.aria-label]="row.product.name + ' op ' + locationName(view()!)"
                             [value]="row.byLocation.get(view()!) ?? 0"
                             (keydown.enter)="$any($event.target).blur()"
                             (keydown.escape)="$any($event.target).value = row.byLocation.get(view()!) ?? 0; $any($event.target).blur()"
                             (change)="setQuantity(row, view()!, $any($event.target))" />
                    </div>
                    @if (counting()) {
                      <div class="stock-row__figure stock-row__figure--count">
                        <span>Geteld</span>
                        <input class="input num right" type="number" min="0" step="1" inputmode="numeric"
                               [attr.aria-label]="'Geteld: ' + row.product.name"
                               [ngModel]="countDraft().get(row.product.id!) ?? null"
                               (ngModelChange)="setCount(row.product.id!, $event)" />
                      </div>
                    }
                  }
                  @if (!counting()) {
                    <button class="stock-row__move" type="button" title="Verplaatsen" aria-label="Verplaatsen"
                            (click)="openTransfer(row)">⇄</button>
                  }
                </div>
              </div>
            }
            </div>
          </div>
        </section>
      } @empty {
        @if (loading()) { <app-skeleton kind="list" [rows]="6" /> }
        @else { <div class="empty"><div class="empty__title">Geen producten gevonden</div></div> }
      }
    </div>

    @if (history(); as book) {
      <app-sheet [title]="book.row.product.name" (closed)="history.set(null)">
        <div body>
          <p class="hint">{{ book.row.product.sku }} · {{ book.row.total | num }} stuks op {{ activeLocations().length }} locatie{{ activeLocations().length === 1 ? '' : 's' }}</p>
          <div class="history-levels">
            @for (location of activeLocations(); track location.id) {
              <span><small>{{ location.name }}</small><b class="num">{{ (book.row.byLocation.get(location.id!) ?? 0) | num }}</b></span>
            }
            @if (expectedFor(book.row.product.id!); as exp) {
              <!-- On the water: the tile is the way to the order it sits on. -->
              <a class="history-levels__link" [routerLink]="['/purchasing', exp.orderIds[0]]" (click)="history.set(null)"
                 [attr.title]="'Open ' + exp.orderNumbers.join(', ')">
                <small>Te verwachten</small><b class="num expected">+{{ exp.quantity | num }}</b>
                <em>{{ exp.orderNumbers.join(', ') }}{{ exp.expectedArrival ? ' · ' + (exp.expectedArrival | dateNl) : '' }} ›</em>
              </a>
            }
          </div>
          <h3 class="history-title">Geschiedenis</h3>
          @if (book.moves; as moves) {
            @if (moves.length) {
              <ol class="history-list">
                @for (move of moves; track move.id) {
                  <li>
                    <span class="history-delta num" [class.history-delta--minus]="move.delta < 0">{{ move.delta > 0 ? '+' : '' }}{{ move.delta | num }}</span>
                    <span class="history-what">
                      <b>{{ move.kindLabel }}@if (move.reference) { · {{ move.reference }}}</b>
                      <small>{{ move.at | dateTimeNl }} · {{ move.actor }}@if (move.locationName) { · {{ move.locationName }}}</small>
                    </span>
                    <span class="history-after num">= {{ move.quantityAfter | num }}</span>
                  </li>
                }
              </ol>
            } @else { <p class="hint">Nog geen bewegingen geboekt.</p> }
          } @else { <p class="hint">Geschiedenis laden…</p> }
        </div>
        <div foot style="display:contents">
          <a class="btn" [routerLink]="['/products', book.row.product.id]" (click)="history.set(null)">Product openen</a>
          <button class="btn btn--primary" type="button" (click)="history.set(null); openTransfer(book.row)">Verplaatsen</button>
        </div>
      </app-sheet>
    }

    @if (transfer(); as move) {
      <app-sheet [title]="'Verplaatsen · ' + move.row.product.name" (closed)="transfer.set(null)">
        <div body><div class="form-grid">
          <div class="field"><label for="t-from">Van</label>
            <select class="select" id="t-from" [ngModel]="move.fromId" (ngModelChange)="patchTransfer({ fromId: +$event })">
              @for (location of activeLocations(); track location.id) {
                <option [value]="location.id">{{ location.name }} ({{ (move.row.byLocation.get(location.id!) ?? 0) | num }})</option>
              }
            </select></div>
          <div class="field"><label for="t-to">Naar</label>
            <select class="select" id="t-to" [ngModel]="move.toId" (ngModelChange)="patchTransfer({ toId: +$event })">
              @for (location of activeLocations(); track location.id) {
                <option [value]="location.id">{{ location.name }}</option>
              }
            </select></div>
          <div class="field"><label class="req" for="t-qty">Aantal</label>
            <input class="input num right" id="t-qty" type="number" min="1" step="1" inputmode="numeric"
                   [ngModel]="move.quantity" (ngModelChange)="patchTransfer({ quantity: +$event })" /></div>
          <div class="field"><label for="t-note">Notitie <span class="opt"></span></label>
            <input class="input" id="t-note" placeholder="bijv. bus van maandag" [ngModel]="move.note"
                   (ngModelChange)="patchTransfer({ note: $event })" /></div>
        </div>
        <span class="hint">Op {{ locationName(move.fromId) }} liggen {{ (move.row.byLocation.get(move.fromId) ?? 0) | num }} stuks.</span>
        </div>
        <div foot style="display:contents">
          <span class="spacer"></span>
          <button class="btn" type="button" (click)="transfer.set(null)">Annuleren</button>
          <button class="btn btn--primary" type="button" [disabled]="saving()" (click)="confirmTransfer()">
            {{ saving() ? 'Bezig…' : 'Verplaatsen' }}
          </button>
        </div>
      </app-sheet>
    }
  `,
  styles: `
    .catalog-tools {
      width: 100%; min-width: 0; margin-bottom: 14px; padding: 12px;
      border: 1px solid var(--line); border-radius: var(--r);
      background: color-mix(in srgb, var(--surface) 88%, var(--surface-2));
      box-shadow: 0 5px 18px rgb(31 25 22 / 4%);
    }
    .sr-only {
      position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
      overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
    }
    .catalog-search { position: relative; display: block; min-width: 0; flex: 1; }
    .catalog-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 9px; }
    .filter-toggle {
      display: inline-flex; align-items: center; gap: 6px; min-height: 42px; padding: 0 12px;
      border: 1px solid var(--line-strong); border-radius: var(--r-sm); background: var(--surface);
      color: var(--ink-2); font: inherit; font-size: 13px; font-weight: 650; cursor: pointer;
    }
    .filter-toggle:hover { background: var(--surface-2); }
    .filter-toggle--active { border-color: var(--rose-line); color: var(--rose-dark); background: var(--rose-soft); }
    .filter-toggle svg { width: 18px; height: 18px; fill: none; stroke: currentColor;
      stroke-width: 1.8; stroke-linecap: round; }
    .filter-toggle__count {
      min-width: 18px; padding: 0 5px; border-radius: 9px; background: var(--rose); color: #fff;
      font-size: 11px; font-weight: 700; line-height: 18px; text-align: center;
    }
    .filter-toggle__chev {
      width: 7px; height: 7px; margin-left: 2px; border-right: 1.6px solid currentColor;
      border-bottom: 1.6px solid currentColor; transform: translateY(-2px) rotate(45deg);
      transition: transform .15s ease; opacity: .7;
    }
    .filter-toggle__chev--open { transform: translateY(2px) rotate(-135deg); }
    .filter-grid, .filter-summary, .family-load-warning { flex: 1 0 100%; }
    .catalog-search__icon {
      position: absolute; z-index: 1; left: 13px; top: 50%; transform: translateY(-52%);
      width: 18px; height: 18px; color: var(--muted); fill: none; stroke: currentColor;
      stroke-width: 1.8; stroke-linecap: round; pointer-events: none;
    }
    .catalog-search__input { padding-left: 42px; padding-right: 42px; }
    .catalog-search__clear {
      position: absolute; right: 5px; top: 50%; transform: translateY(-50%);
      width: 36px; height: 36px; padding: 0; border: 0; border-radius: 50%;
      background: transparent; color: var(--muted); font-size: 24px; line-height: 1;
      cursor: pointer;
    }
    .catalog-search__clear:hover { background: var(--surface-2); color: var(--ink); }
    .filter-grid {
      display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
      gap: 9px; min-width: 0; margin-top: 2px;
    }
    .filter-sort__box {
      position: relative; display: flex; align-items: center; gap: 7px; min-height: 42px;
      padding: 0 11px; border: 1px solid var(--line-strong); border-radius: var(--r-sm);
      background: var(--surface); color: var(--ink-2);
    }
    .filter-sort__box:hover { background: var(--surface-2); }
    .filter-sort__icon { width: 18px; height: 18px; fill: none; stroke: currentColor;
      stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    .filter-sort__text { font-size: 13px; font-weight: 650; white-space: nowrap; }
    /* The real select lies invisibly over the box: the native picker opens
       on tap, the box is just how it looks. */
    .filter-sort__native { position: absolute; inset: 0; width: 100%; height: 100%;
      opacity: 0; cursor: pointer; font-size: 16px; }
    .filter-field { display: block; min-width: 0; }
    .filter-field__label {
      display: block; margin: 0 0 5px 2px; color: var(--muted);
      font-size: 10px; font-weight: 750; letter-spacing: .055em; text-transform: uppercase;
    }
    .filter-sort .filter-field__label { visibility: hidden; }
    .filter-field__select {
      display: block; min-width: 0; max-width: 100%; min-height: 42px;
      padding: 9px 30px 9px 10px; font-size: 13px; font-weight: 650;
      text-overflow: ellipsis;
    }
    .filter-summary {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      min-width: 0; margin-top: 0; color: var(--muted); font-size: 12px;
    }
    .filter-summary strong { color: var(--ink); font-variant-numeric: tabular-nums; }
    .filter-reset {
      flex: 0 0 auto; padding: 4px 0; border: 0; background: transparent;
      color: var(--rose-dark); font-size: 12px; font-weight: 700; cursor: pointer;
    }
    .filter-manage { color: var(--muted); font-size: 12px; text-decoration: none; }
    @media (min-width: 680px) {
      .filter-grid { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; }
    }
    .count-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-bottom: 14px; padding: 10px 12px;
      border: 1px solid var(--rose-line); border-radius: var(--r-sm); background: var(--rose-soft); }
    .count-bar > div { flex: 1 1 200px; min-width: 0; }
    .count-bar small { display: block; color: var(--muted); font-size: 11.5px; }

    .section { animation: section-in .28s ease both; }
    .section + .section { margin-top: 18px; }
    @keyframes section-in {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: none; }
    }
    @media (prefers-reduced-motion: reduce) { .section { animation: none; } }
    .section-head {
      display: flex; align-items: baseline; gap: 8px; margin: 0 0 8px 4px;
      color: var(--ink-2); font-size: 11.5px; font-weight: 800; letter-spacing: .08em;
      text-transform: uppercase;
    }
    .section-head small { color: var(--muted); font-size: 11px; font-weight: 650; letter-spacing: 0; }
    .section-head__total { margin-left: auto; margin-right: 4px; text-transform: none; }

    .stock-row { gap: 8px; }
    .stock-row--changed { background: var(--warn-soft); }
    .stock-row__product { display: flex; flex: 1; align-items: center; gap: 10px; min-width: 0; padding: 0; border: 0;
      background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
    .stock-row__body { display: grid; min-width: 0; }
    .product-row__title { display: flex; flex-wrap: wrap; min-width: 0; align-items: baseline; gap: 2px 4px; }
    .product-row__title strong { flex: 0 1 auto; overflow: hidden; min-width: 0; font-size: 13.5px;
      text-overflow: ellipsis; white-space: nowrap; }
    .product-row__title span { flex: 0 0 auto; color: var(--muted); font-size: 11px; white-space: nowrap; }
    .product-row__sku { margin-top: 4px; color: var(--muted); font-size: 10.5px; }
    .stock-expected { display: block; margin-top: 2px; color: var(--warn); font-size: 10px; font-weight: 700; white-space: nowrap; }
    .expected { color: var(--warn); font-style: normal; font-weight: 650; }
    .stock-row__end { display: flex; align-items: center; gap: 6px; }
    /* Label over figure, like the catalogue's Voorraad / Kostprijs columns;
       fixed widths so the figures line up from row to row. */
    .stock-row__figure { display: grid; justify-items: end; gap: 3px; width: 72px; }
    .stock-row__figure span { color: var(--muted); font-size: 8px; font-weight: 700; letter-spacing: .055em;
      line-height: 1.15; text-transform: uppercase; white-space: nowrap; overflow: hidden; max-width: 100%; text-overflow: ellipsis; }
    .stock-row__figure strong { font-size: 13px; font-weight: 800; line-height: 1.3; padding: 4px 6px; }
    .stock-row__figure--total { padding-left: 8px; border-left: 1px solid var(--line); }
    .stock-row__figure--count { width: 84px; }
    .stock-row__figure--count .input { width: 100%; min-height: 34px; padding: 4px 8px; }
    /* Reads as a plain figure; shows it is a field only under the pointer or when focused. */
    .stock-row__qty { width: 100%; min-width: 0; padding: 4px 6px; border: 1px solid transparent;
      border-radius: 8px; background: transparent; color: inherit; font: inherit; font-size: 13px; font-weight: 650;
      text-align: right; -moz-appearance: textfield; }
    .stock-row__qty::-webkit-outer-spin-button, .stock-row__qty::-webkit-inner-spin-button { display: none; }
    .stock-row__qty:hover { border-color: var(--line); background: var(--surface-2); }
    .stock-row__qty:focus { outline: none; border-color: var(--rose); background: var(--surface); }
    .stock-row__move { width: 30px; height: 30px; flex: 0 0 auto; border: 1px solid var(--line); border-radius: 8px; background: var(--surface);
      color: var(--muted); font-size: 15px; cursor: pointer; }
    .stock-row__move:hover { color: var(--ink); background: var(--surface-2); }
    @media (min-width: 680px) {
      .stock-row__end { gap: 10px; }
      .stock-row__figure { width: 84px; }
    }
    /* A phone has room for one figure next to the name: the total. The
       split per location is one tap away in the stock book, and editing
       a location happens with that location chosen under Filters. */
    @media (max-width: 600px) {
      .stock-row__figure { width: 64px; }
      .stock-row__figure--location { display: none; }
      .stock-row__figure--total { padding-left: 0; border-left: 0; }
    }
    .history-levels { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0 4px; }
    .history-levels span, .history-levels__link { display: grid; padding: 8px 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface-2); }
    .history-levels small { color: var(--muted); font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
    .history-levels b { font-size: 16px; }
    .history-levels__link { color: inherit; text-decoration: none; border-color: var(--warn-line, #eddcb9); }
    .history-levels__link em { color: var(--warn); font-size: 11px; font-style: normal; font-weight: 650; }
    .history-title { margin: 14px 0 4px; color: var(--muted); font-size: 11px; font-weight: 750; letter-spacing: .06em; text-transform: uppercase; }
    .history-list { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--line); }
    .history-list li { display: grid; grid-template-columns: 56px 1fr auto; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--line); }
    .history-delta { font-weight: 750; color: var(--ok, #2e7d4f); }
    .history-delta--minus { color: var(--danger); }
    .history-what { display: grid; min-width: 0; }
    .history-what b { font-weight: 650; font-size: 12.5px; }
    .history-what small { color: var(--muted); font-size: 11px; }
    .history-after { color: var(--muted); font-size: 12px; white-space: nowrap; }
  `,
})
export class StockPage {
  private readonly catalog = inject(CatalogApi);
  private readonly sourcing = inject(SourcingApi);
  private readonly ui = inject(Ui);

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly products = signal<Product[]>([]);
  readonly locations = signal<StockLocation[]>([]);
  readonly levels = signal<StockLevel[]>([]);
  readonly query = signal('');
  /** null = every location side by side. */
  readonly view = signal<number | null>(null);

  readonly activeLocations = computed(() => this.locations().filter((location) => location.active));

  readonly rows = computed<StockRow[]>(() => {
    const byProduct = new Map<number, Map<number, number>>();
    for (const level of this.levels()) {
      const map = byProduct.get(level.productId) ?? new Map<number, number>();
      map.set(level.locationId, level.quantity);
      byProduct.set(level.productId, map);
    }
    return this.products()
      .filter((product) => product.active)
      .map((product) => {
        const byLocation = byProduct.get(product.id!) ?? new Map<number, number>();
        let total = 0;
        for (const quantity of byLocation.values()) total += quantity;
        return { product, byLocation, total };
      })
      .sort((a, b) => a.product.name.localeCompare(b.product.name, 'nl', { numeric: true, sensitivity: 'base' }));
  });

  readonly sortKey = signal<'NAME_ASC' | 'NAME_DESC' | 'STOCK_DESC' | 'STOCK_ASC' | 'EXPECTED'>('NAME_ASC');
  readonly categories = signal<Category[]>([]);
  readonly expected = signal<Map<number, ExpectedStock>>(new Map());
  readonly filtersOpen = signal(false);
  readonly categoryFilter = signal<number | null>(null);
  readonly sortOptions: { key: 'NAME_ASC' | 'NAME_DESC' | 'STOCK_DESC' | 'STOCK_ASC' | 'EXPECTED'; label: string }[] = [
    { key: 'NAME_ASC', label: 'Naam A–Z' },
    { key: 'NAME_DESC', label: 'Naam Z–A' },
    { key: 'STOCK_DESC', label: 'Voorraad hoog → laag' },
    { key: 'STOCK_ASC', label: 'Voorraad laag → hoog' },
    { key: 'EXPECTED', label: 'Te verwachten eerst' },
  ];
  readonly sortLabel = computed(() => this.sortOptions.find((option) => option.key === this.sortKey())?.label ?? '');
  /* A count pins the location; that is not a filter you chose, so it does not light the button. */
  readonly activeFilterCount = computed(() =>
    (this.view() !== null && !this.counting() ? 1 : 0) + (this.categoryFilter() !== null ? 1 : 0)
    + (this.sortKey() !== 'NAME_ASC' ? 1 : 0));
  readonly hasFilters = computed(() => this.activeFilterCount() > 0);

  resetFilters(): void {
    if (!this.counting()) this.view.set(null);
    this.categoryFilter.set(null);
    this.sortKey.set('NAME_ASC');
  }

  expectedFor(productId: number): ExpectedStock | null {
    return this.expected().get(productId) ?? null;
  }

  readonly filtered = computed(() => {
    const needle = this.query().trim().toLowerCase();
    const category = this.categoryFilter();
    const rows = this.rows().filter(({ product }) =>
      (category === null || product.categoryId === category)
      && (!needle || [product.name, product.sku, product.colour, product.variantSize].join(' ').toLowerCase().includes(needle)));
    const byName = (a: StockRow, b: StockRow) =>
      a.product.name.localeCompare(b.product.name, 'nl', { numeric: true, sensitivity: 'base' });
    switch (this.sortKey()) {
      case 'NAME_DESC': return [...rows].sort((a, b) => byName(b, a));
      case 'STOCK_DESC': return [...rows].sort((a, b) => b.total - a.total || byName(a, b));
      case 'STOCK_ASC': return [...rows].sort((a, b) => a.total - b.total || byName(a, b));
      case 'EXPECTED': return [...rows].sort((a, b) =>
        (this.expectedFor(b.product.id!)?.quantity ?? 0) - (this.expectedFor(a.product.id!)?.quantity ?? 0) || byName(a, b));
      default: return [...rows].sort(byName);
    }
  });

  /** The rows cut into category sections, in the categories' own order; a search shows one flat list. */
  readonly sections = computed<{ key: string; name: string | null; rows: StockRow[]; total: number }[]>(() => {
    const rows = this.filtered();
    if (!rows.length) return [];
    if (this.query().trim()) return [{ key: 'all', name: null, rows, total: rows.reduce((sum, row) => sum + row.total, 0) }];
    const order = new Map(this.categories().map((category, index) => [category.id, index]));
    const groups = new Map<number | null, StockRow[]>();
    for (const row of rows) {
      const id = row.product.categoryId ?? null;
      groups.set(id, [...(groups.get(id) ?? []), row]);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => (a === null ? Infinity : order.get(a) ?? Infinity) - (b === null ? Infinity : order.get(b) ?? Infinity))
      .map(([id, group]) => ({
        key: id === null ? 'none' : `c${id}`,
        name: this.categories().find((category) => category.id === id)?.name ?? 'Zonder categorie',
        rows: group,
        total: group.reduce((sum, row) => sum + row.total, 0),
      }));
  });

  /* ---- the stock book of one product ---- */
  readonly history = signal<{ row: StockRow; moves: StockMovement[] | null } | null>(null);

  async openHistory(row: StockRow): Promise<void> {
    this.history.set({ row, moves: null });
    try {
      const moves = await this.catalog.stockMovements(row.product.id!);
      this.history.update((book) => book && book.row === row ? { ...book, moves } : book);
    } catch {
      this.history.update((book) => book && book.row === row ? { ...book, moves: [] } : book);
    }
  }

  readonly subtitle = computed(() => {
    const total = this.rows().reduce((sum, row) => sum + row.total, 0);
    return `${total.toLocaleString('nl-BE')} stuks op ${this.activeLocations().length} locatie${this.activeLocations().length === 1 ? '' : 's'}`;
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const [products, locations, levels, categories, expected] = await Promise.all([
        this.catalog.products(), this.catalog.stockLocations(), this.catalog.stockLevels(),
        this.catalog.categories().catch(() => [] as Category[]),
        this.sourcing.expectedStock().catch(() => [] as ExpectedStock[]),
      ]);
      this.products.set(products);
      this.locations.set(locations);
      this.levels.set(levels);
      this.categories.set(categories);
      this.expected.set(new Map(expected.map((item) => [item.productId, item])));
      document.documentElement.style.setProperty('--cols', String(Math.max(1, locations.filter((location) => location.active).length + 1)));
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Voorraad laden mislukt'), 'err');
    } finally {
      this.loading.set(false);
    }
  }

  locationName(id: number): string {
    return this.locations().find((location) => location.id === id)?.name ?? '';
  }

  /* ---- transfer ---- */
  readonly transfer = signal<{ row: StockRow; fromId: number; toId: number; quantity: number; note: string } | null>(null);

  openTransfer(row: StockRow): void {
    const locations = this.activeLocations();
    if (locations.length < 2) {
      this.ui.toast('Maak eerst een tweede locatie aan onder Voorraadlocaties', 'err');
      return;
    }
    const fromId = this.view() ?? locations[0].id!;
    const toId = locations.find((location) => location.id !== fromId)!.id!;
    this.transfer.set({ row, fromId, toId, quantity: 0, note: '' });
  }

  patchTransfer(changes: Partial<{ fromId: number; toId: number; quantity: number; note: string }>): void {
    this.transfer.update((move) => move ? { ...move, ...changes } : move);
  }

  async confirmTransfer(): Promise<void> {
    const move = this.transfer();
    if (!move) return;
    if (move.quantity <= 0) { this.ui.toast('Geef een aantal op', 'err'); return; }
    if (move.fromId === move.toId) { this.ui.toast('Kies twee verschillende locaties', 'err'); return; }
    this.saving.set(true);
    try {
      await this.catalog.transferStock(move.row.product.id!, move.fromId, move.toId, move.quantity, move.note || null);
      this.levels.set(await this.catalog.stockLevels());
      this.transfer.set(null);
      this.ui.toast(`${move.quantity} × ${move.row.product.name} naar ${this.locationName(move.toId)}`, 'ok');
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Verplaatsen mislukt'), 'err');
    } finally {
      this.saving.set(false);
    }
  }

  /* ---- typing a count straight into the table ---- */

  /** A figure typed in a cell is booked at once as a manual correction. */
  async setQuantity(row: StockRow, locationId: number, field: HTMLInputElement): Promise<void> {
    const before = row.byLocation.get(locationId) ?? 0;
    const quantity = Math.max(0, Math.round(Number(field.value) || 0));
    if (quantity === before) { field.value = String(before); return; }
    try {
      await this.catalog.setStock(row.product.id!, quantity, locationId, 'Voorraadoverzicht');
      this.levels.update((levels) => {
        const rest = levels.filter((level) => !(level.productId === row.product.id && level.locationId === locationId));
        return [...rest, { productId: row.product.id!, locationId, quantity }];
      });
      this.ui.toast(`${row.product.name}: ${quantity.toLocaleString('nl-BE')} op ${this.locationName(locationId)}`, 'ok');
    } catch (failure: unknown) {
      field.value = String(before);
      this.ui.toast(messageOf(failure, 'Voorraad zetten mislukt'), 'err');
    }
  }

  /* ---- stocktake ---- */
  readonly counting = signal<{ locationId: number } | null>(null);
  readonly countDraft = signal(new Map<number, number | null>());

  startCount(): void {
    const locationId = this.view() ?? this.activeLocations()[0]?.id ?? null;
    if (locationId === null) return;
    this.view.set(locationId);
    this.countDraft.set(new Map());
    this.counting.set({ locationId });
  }

  setCount(productId: number, value: unknown): void {
    const quantity = value === '' || value === null || value === undefined ? null : Number(value);
    this.countDraft.update((draft) => new Map(draft).set(productId, quantity));
  }

  isChanged(productId: number): boolean {
    const count = this.counting();
    if (!count) return false;
    const counted = this.countDraft().get(productId);
    if (counted === null || counted === undefined) return false;
    const current = this.rows().find((row) => row.product.id === productId)?.byLocation.get(count.locationId) ?? 0;
    return counted !== current;
  }

  readonly changedCounts = computed(() => {
    const count = this.counting();
    if (!count) return [];
    const result: { productId: number; quantity: number }[] = [];
    for (const [productId, quantity] of this.countDraft()) {
      if (quantity === null || quantity === undefined || quantity < 0) continue;
      const current = this.rows().find((row) => row.product.id === productId)?.byLocation.get(count.locationId) ?? 0;
      if (quantity !== current) result.push({ productId, quantity });
    }
    return result;
  });

  async confirmCount(): Promise<void> {
    const count = this.counting();
    const counts = this.changedCounts();
    if (!count || !counts.length) return;
    this.saving.set(true);
    try {
      /* The kind already says "Telling"; the reference says where and when. */
      const today = new Date().toLocaleDateString('nl-BE', { day: '2-digit', month: '2-digit', year: 'numeric' });
      await this.catalog.stocktake(count.locationId, `${this.locationName(count.locationId)} ${today}`, counts);
      this.levels.set(await this.catalog.stockLevels());
      this.counting.set(null);
      this.ui.toast(`Telling geboekt: ${counts.length} product(en) aangepast`, 'ok');
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Telling boeken mislukt'), 'err');
    } finally {
      this.saving.set(false);
    }
  }
}
