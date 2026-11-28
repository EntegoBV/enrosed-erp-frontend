import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { messageOf } from '../../core/api/errors';
import type { PartnerProductTile } from '../../core/api/partner-portal-api';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { Icon } from '../../shared/icon';
import { LOAD_ERROR_FALLBACK, LoadError } from '../../shared/load-error';
import { Skeleton } from '../../shared/skeleton';
import { PartnerContainersData } from './partner-containers-data';
import { calendarDay, dayText, isReceived } from './partner-containers-model';
import { PartnerData } from './partner-data';
import { Family, FamilyCategory, familyTotal, foldFamilies } from './partner-families';
import { count, searchText } from './partner-format';
import { PartnerHead } from './partner-head';
import { PartnerPhoto } from './partner-photo';
import { withCategories } from './partner-product-table';
import { twinKeys, twinLabel } from './partner-twins';

type StockItem = PartnerProductTile & { quantity: number };

interface Incoming {
  pieces: number;
  /** The nearest day one of them is expected (the calendar's day: the warehouse day, else the port). */
  day: string | null;
}

interface ChipView {
  productId: number;
  label: string;
  colour: string | null;
  figure: string;
  empty: boolean;
}

interface RowView {
  family: Family<StockItem>;
  chips: ChipView[];
  total: string;
  empty: boolean;
  incoming: string | null;
  incomingDay: string | null;
}

interface SectionView {
  key: string;
  name: string;
  products: number;
  rows: RowView[];
}

const NAME_ORDER = new Intl.Collator('nl', { sensitivity: 'base', numeric: true });

/**
 * Voorraad (2026-11-28): what lies in Zaltbommel, one row per product family with its colours beside it instead
 * of a row per colour under a head with the same name. Per row: the family (a photo of its first product), the
 * colours with what is left of each, the total in pieces, and what is still coming for it on the containers that
 * are on their way (with the nearest day). Search and "Ook uitverkocht" (what sold lately and is gone) on top. A
 * colour is a button: it opens Melden with that product, sold at the auction. Never a price.
 */
@Component({
  selector: 'app-partner-voorraad',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, LoadError, Skeleton, PartnerHead, PartnerPhoto],
  template: `
    <app-partner-head title="Voorraad" [sub]="sub()">
      <div class="vr-tools">
        <label class="vr-search">
          <app-icon name="search" [size]="16" />
          <input type="search" placeholder="Zoek een product" aria-label="Zoek een product" enterkeyhint="search" autocomplete="off"
                 autocorrect="off" spellcheck="false" [value]="query()" (input)="query.set($any($event.target).value)" />
          @if (query()) {
            <button class="vr-search__x" type="button" aria-label="Zoekveld leegmaken" (click)="query.set('')"><app-icon name="close" [size]="14" /></button>
          }
        </label>
        @if (goneCount()) {
          <button class="wk-chip vr-chip" type="button" [attr.aria-pressed]="showGone()" (click)="showGone.set(!showGone())">
            Ook uitverkocht <span class="vr-chip__n">{{ goneCount() }}</span>
          </button>
        }
      </div>
    </app-partner-head>

    @if (data.overview()) {
      @if (sections().length) {
        @if (desk.active()) {
          <div class="vr-card">
            <div class="wk-table vr-table" role="table" aria-label="Voorraad">
              <div class="wk-thead vr-row" role="row">
                <span class="wk-th" role="columnheader"><span class="sr-only">Foto</span></span>
                <span class="wk-th" role="columnheader">Product</span>
                <span class="wk-th" role="columnheader">Kleuren <span class="vr-hint">· klik om te melden</span></span>
                <span class="wk-th wk-th--num" role="columnheader">Op voorraad</span>
                <span class="wk-th wk-th--num" role="columnheader">Komt eraan</span>
              </div>
              @for (section of sections(); track section.key) {
                <div class="wk-group" role="row">
                  <span class="wk-group__label" role="cell">{{ section.name }} <span class="wk-group__count">{{ section.products }} {{ section.products === 1 ? 'product' : 'producten' }}</span></span>
                </div>
                @for (row of section.rows; track row.family.key) {
                  <div class="wk-tr vr-row vr-tr" role="row" [class.is-empty]="row.empty">
                    <span class="wk-td" role="cell"><app-partner-photo class="vr-photo" [product]="row.family.variants[0].item" /></span>
                    <span class="wk-td vr-name" role="cell">
                      <b>{{ row.family.title }}</b>
                      @if (row.chips.length > 1) { <small>{{ row.chips.length }} {{ kindWord(row) }}</small> }
                    </span>
                    <span class="wk-td vr-chips" role="cell">
                      @for (chip of row.chips; track chip.productId) {
                        <button class="vr-pill" type="button" [class.is-empty]="chip.empty" [disabled]="chip.empty"
                                [attr.title]="chip.empty ? null : 'Melden: ' + row.family.title + ' · ' + chip.label"
                                [attr.aria-label]="(chip.empty ? '' : 'Melden: ') + row.family.title + ' · ' + chip.label + ', ' + chip.figure" (click)="sell(chip.productId)">
                          <i class="vr-dot" [style.background]="chip.colour" aria-hidden="true"></i>
                          <span class="vr-pill__label">{{ chip.label }}</span>
                          <b>{{ chip.figure }}</b>
                        </button>
                      }
                    </span>
                    <span class="wk-td wk-td--num vr-fig" role="cell"><b>{{ row.total }}</b></span>
                    <span class="wk-td wk-td--num vr-fig" role="cell">
                      @if (row.incoming) { <b class="vr-in">{{ row.incoming }}</b><small>{{ row.incomingDay }}</small> } @else { <span class="vr-muted">—</span> }
                    </span>
                  </div>
                }
              }
            </div>
          </div>
        } @else {
          @for (section of sections(); track section.key) {
            <h2 class="vr-sec">{{ section.name }} <span>{{ section.products }}</span></h2>
            <div class="vr-list">
              @for (row of section.rows; track row.family.key) {
                <div class="vr-item" [class.is-empty]="row.empty">
                  <div class="vr-item__head">
                    <app-partner-photo class="vr-item__photo" [product]="row.family.variants[0].item" />
                    <span class="vr-item__title"><b>{{ row.family.title }}</b>
                      @if (row.incoming) { <small class="vr-in">{{ row.incoming }} komt eraan · {{ row.incomingDay }}</small> }</span>
                    <b class="vr-item__total">{{ row.total }}</b>
                  </div>
                  <div class="vr-item__chips">
                    @for (chip of row.chips; track chip.productId) {
                      <button class="vr-pill" type="button" [class.is-empty]="chip.empty" [disabled]="chip.empty"
                              [attr.aria-label]="(chip.empty ? '' : 'Melden: ') + row.family.title + ' · ' + chip.label + ', ' + chip.figure" (click)="sell(chip.productId)">
                        <i class="vr-dot" [style.background]="chip.colour" aria-hidden="true"></i>
                        <span class="vr-pill__label">{{ chip.label }}</span>
                        <b>{{ chip.figure }}</b>
                      </button>
                    }
                  </div>
                </div>
              }
            </div>
          }
        }
      } @else {
        <p class="vr-none">{{ query().trim() ? 'Niets gevonden voor “' + query().trim() + '”.' : 'Er ligt nu geen voorraad.' }}</p>
      }
    } @else if (data.failure()) {
      <app-load-error [message]="failureText()" [busy]="data.loading()" (retry)="reload()" />
    } @else {
      <app-skeleton [kind]="desk.active() ? 'table' : 'card'" [rows]="6" />
    }
  `,
  styles: `
    :host{display:block;padding-bottom:calc(24px + var(--safe-b,0px))}
    .vr-tools{display:flex;align-items:center;gap:8px}
    .vr-search{position:relative;display:flex;align-items:center;width:240px;color:var(--muted)}
    .vr-search app-icon{position:absolute;left:10px;pointer-events:none}
    .vr-search input{width:100%;height:36px;padding:0 30px 0 32px;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--ink);font:inherit;font-size:13.5px;outline:none}
    .vr-search input:focus{border-color:var(--rose);box-shadow:var(--wk-focus)}
    .vr-search input::-webkit-search-cancel-button{display:none}
    .vr-search__x{position:absolute;right:4px;display:grid;place-items:center;width:28px;height:28px;padding:0;border:0;border-radius:50%;background:none;color:var(--muted);cursor:pointer}
    .vr-chip{flex:none}
    .vr-chip__n{color:var(--muted);font-variant-numeric:tabular-nums}
    .vr-chip[aria-pressed=true] .vr-chip__n{color:inherit}
    .vr-card{border:1px solid var(--line);border-radius:14px;background:var(--surface);--wk-sticky-top:var(--pp-sticky-top,0px)}
    .vr-table{--wk-cols:52px minmax(150px,.9fr) minmax(0,2.2fr) 128px 104px;--wk-pad-x:12px;--wk-gap:12px}
    .vr-hint{color:var(--muted-2);font-weight:500;letter-spacing:0;text-transform:none}
    .vr-tr{min-height:62px}
    .vr-tr.is-empty{opacity:.62}
    .vr-photo{width:44px;height:44px;border-radius:10px}
    .vr-name{display:grid;align-content:center;min-width:0}
    .vr-name b{font-size:13.5px;font-weight:700;line-height:1.3;white-space:normal;overflow-wrap:anywhere}
    .vr-name{white-space:normal}
    .vr-name small{color:var(--muted);font-size:11.5px}
    .vr-chips{display:flex;flex-wrap:wrap;align-content:center;gap:5px;min-width:0;padding-block:8px}
    .vr-pill{display:inline-flex;align-items:center;gap:6px;max-width:100%;min-height:28px;padding:0 10px 0 8px;border:1px solid var(--line);border-radius:999px;background:var(--surface-2);color:var(--ink);font:inherit;font-size:12.5px;cursor:pointer;-webkit-tap-highlight-color:transparent}
    .vr-pill:hover:not(:disabled){border-color:var(--rose-line);background:var(--rose-soft)}
    .vr-pill:focus-visible{outline:2px solid var(--rose-dark);outline-offset:1px}
    .vr-pill:disabled{cursor:default}
    .vr-pill.is-empty{color:var(--muted);border-style:dashed}
    .vr-pill__label{min-width:0;overflow:hidden;color:var(--ink-2);text-overflow:ellipsis;white-space:nowrap}
    .vr-pill b{font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}
    .vr-dot{flex:none;width:9px;height:9px;border-radius:50%;background:#c9bfb7;box-shadow:inset 0 0 0 1px rgb(26 22 20/14%)}
    .vr-fig{display:grid;align-content:center;justify-items:end}
    .vr-fig b{font-size:13.5px;font-weight:720;font-variant-numeric:tabular-nums;white-space:nowrap}
    .vr-fig small{color:var(--muted);font-size:11.5px;white-space:nowrap}
    .vr-in{color:var(--rose-dark)}
    .vr-muted{color:var(--muted)}
    .vr-none{margin:0;padding:22px;border-radius:14px;background:var(--surface);color:var(--muted);text-align:center}
    @media (max-width: 679.98px), (hover: none) and (max-width: 1023.98px){
      :host ::ng-deep app-partner-head{flex-wrap:wrap}
      .vr-tools{flex:1 0 100%;flex-wrap:wrap}
      .vr-search{flex:1;width:auto}
      .vr-search input{height:44px;border:0;border-radius:12px;background:color-mix(in srgb,var(--ink) 6%,var(--surface));font-size:16px}
      .vr-chip{height:40px;padding:0 14px;font-size:14px}
      .vr-sec{display:flex;align-items:baseline;gap:8px;margin:18px 4px 8px;font-size:13px;font-weight:750;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
      .vr-sec span{font-weight:600;letter-spacing:0}
      .vr-list{display:grid;gap:10px}
      .vr-item{padding:12px 14px 14px;border-radius:18px;background:var(--surface)}
      .vr-item.is-empty{opacity:.7}
      .vr-item__head{display:grid;grid-template-columns:48px minmax(0,1fr) auto;align-items:center;gap:12px}
      .vr-item__photo{width:48px;height:48px;border-radius:12px}
      .vr-item__title{display:grid;min-width:0}
      .vr-item__title b{font-size:16px;font-weight:750;line-height:1.25}
      .vr-item__title small{font-size:13px}
      .vr-item__total{font-size:15px;font-weight:750;font-variant-numeric:tabular-nums;white-space:nowrap}
      .vr-item__chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
      .vr-pill{min-height:36px;padding:0 12px 0 10px;font-size:14px}
    }
  `,
})
export class PartnerVoorraad {
  readonly data = inject(PartnerData);
  private readonly containers = inject(PartnerContainersData);
  private readonly router = inject(Router);
  readonly desk = inject(DesktopViewport);

  readonly query = signal('');
  readonly showGone = signal(false);
  readonly failureText = computed(() => messageOf(this.data.failure(), LOAD_ERROR_FALLBACK));

  /** The stock, and what sold lately and is gone (0). */
  private readonly items = computed<StockItem[]>(() => {
    const overview = this.data.overview();
    if (!overview) return [];
    const ids = new Set(overview.stock.map((tile) => tile.productId));
    const gone = overview.recentSales.filter((tile) => !ids.has(tile.productId)).map((tile) => ({ ...tile, quantity: 0 }));
    return withCategories<StockItem>([...overview.stock, ...gone], this.containers.specs());
  });

  readonly goneCount = computed(() => this.items().filter((item) => item.quantity <= 0).length);

  /** Per product what the containers on their way still bring (pieces) and the nearest day. */
  private readonly incoming = computed(() => {
    const page = this.containers.page();
    const map = new Map<number, Incoming>();
    if (!page) return map;
    for (const container of page.containers) {
      if (isReceived(container)) continue;
      const day = calendarDay(container);
      for (const line of container.lines) {
        if (line.quantity <= 0) continue;
        const known = map.get(line.productId) ?? { pieces: 0, day: null };
        known.pieces += line.pieces;
        if (day && (!known.day || day < known.day)) known.day = day;
        map.set(line.productId, known);
      }
    }
    return map;
  });

  readonly sub = computed(() => {
    const stock = this.data.overview()?.stock ?? [];
    return stock.length ? `In Zaltbommel · ${count(stock.length)} ${stock.length === 1 ? 'product' : 'producten'}` : null;
  });

  readonly sections = computed<SectionView[]>(() => {
    const words = searchText(this.query()).split(/\s+/).filter(Boolean);
    const showGone = this.showGone();
    const items = this.items().filter((item) => {
      if (!showGone && item.quantity <= 0) return false;
      if (!words.length) return true;
      const text = searchText([item.name, item.variant, item.sku, item.familyName, item.categoryName].filter(Boolean).join(' '));
      return words.every((word) => text.includes(word));
    });
    const sorted = [...items].sort((a, b) =>
      (a.categoryOrder ?? Number.MAX_SAFE_INTEGER - (a.categoryName ? 1 : 0)) - (b.categoryOrder ?? Number.MAX_SAFE_INTEGER - (b.categoryName ? 1 : 0))
      || NAME_ORDER.compare(a.categoryName ?? '', b.categoryName ?? ''));
    const twins = twinKeys(this.items());
    const incoming = this.incoming();
    const today = this.containers.page()?.serverDate ?? this.data.overview()?.serverDate ?? '';
    return foldFamilies(sorted, (item) => item.quantity).map((category: FamilyCategory<StockItem>) => ({
      key: category.key, name: category.name, products: category.products,
      rows: category.families.map((family) => {
        let incomingPieces = 0;
        let incomingDay: string | null = null;
        for (const variant of family.variants) {
          const coming = incoming.get(variant.item.productId);
          if (!coming) continue;
          incomingPieces += coming.pieces;
          if (coming.day && (!incomingDay || coming.day < incomingDay)) incomingDay = coming.day;
        }
        return {
          family,
          chips: family.variants.map((variant) => {
            const code = twinLabel(variant.item, twins);
            return {
              productId: variant.item.productId, label: [variant.label, code].filter(Boolean).join(' · '), colour: variant.colour,
              figure: count(variant.pieces), empty: variant.item.quantity <= 0,
            };
          }),
          total: familyTotal(family),
          empty: family.pieces <= 0,
          incoming: incomingPieces > 0 ? `+ ${count(incomingPieces)}` : null,
          incomingDay: incomingDay ? dayText(incomingDay, today) : 'datum nog open',
        };
      }),
    }));
  });

  constructor() {
    void this.data.load();
    void this.containers.load();
  }

  reload(): void {
    void this.data.load();
    void this.containers.load();
  }

  /** "kleuren" when the variants are colours of one product, else "producten". */
  kindWord(row: RowView): string {
    return row.family.variants.every((variant) => !!variant.item.variant) ? 'kleuren' : 'producten';
  }

  /** A colour: Melden with that product, sold at the auction (the kind can still change there). */
  sell(productId: number): void {
    void this.router.navigate(['/partner/melden'], { queryParams: { soort: 'veiling', product: productId } });
  }
}
