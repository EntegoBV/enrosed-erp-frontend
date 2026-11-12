import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import type { PartnerProductSpec, PartnerProductTile } from '../../core/api/partner-portal-api';
import { Icon } from '../../shared/icon';
import { searchText, shortDate } from './partner-format';
import { PartnerPhoto, PhotoUrlFn, partnerPhoto, safeColour } from './partner-photo';
import { twinKeys, twinLabel } from './partner-twins';
import { stockFigure } from './partner-units';

/** A row of the table: a product with its stock (sales units) and/or the day it last sold. */
export type TableProduct = PartnerProductTile & { quantity?: number; lastSoldOn?: string };

/** One family's products in a section (a family header row above them), or one product on its own (family null). */
interface Block {
  key: string;
  family: string | null;
  rows: TableProduct[];
}

/** A category's products; label null when no product has a category (no category row then). */
interface Section {
  key: string;
  label: string | null;
  count: number;
  blocks: Block[];
}

const NAME_ORDER = new Intl.Collator('nl', { sensitivity: 'base', numeric: true });

/**
 * Tiles with their category: the server's own field when it sends one, else the category the containers answer's
 * spec carries for that product (a server that does not send it on tiles yet).
 */
export function withCategories<T extends PartnerProductTile>(tiles: readonly T[], specs: ReadonlyMap<number, PartnerProductSpec>): T[] {
  if (!specs.size || tiles.every((tile) => tile.categoryName !== undefined)) return tiles as T[];
  return tiles.map((tile) => {
    if (tile.categoryName !== undefined) return tile;
    const spec = specs.get(tile.productId);
    return spec ? { ...tile, categoryId: spec.categoryId, categoryName: spec.categoryName } : tile;
  });
}

/**
 * The partner's products as one table grouped the way the ERP's Voorraad
 * reads: a section per category (sticky, folds away, in Enrosed's category
 * order, "Zonder categorie" last), in it each series under a small header row
 * of its own (it folds too) and the products without a series as plain rows
 * (kit wk-* rows): Foto · Product · Kleur · Op voorraad (in the product's
 * default unit, with the pieces beside it) and, in `stock` mode, Melden per
 * row; in `pick` mode a tick per row (the Melden page's product choice).
 * Search and "Alleen met voorraad" on top. A product whose name and colour
 * another one shares shows its code. On the phone the same rows stack to
 * photo, name with the colour, and the figure; the whole row is the target.
 */
@Component({
  selector: 'app-partner-product-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, Icon, PartnerPhoto],
  template: `
    @if (toolbar()) {
      <div class="pt-tools">
        <label class="pt-search">
          <app-icon name="search" [size]="16" />
          <input type="search" [placeholder]="searchLabel()" [attr.aria-label]="searchLabel()" enterkeyhint="search"
                 autocomplete="off" autocorrect="off" spellcheck="false" [value]="query()" (input)="query.set($any($event.target).value)" />
          @if (query()) {
            <button class="pt-search__x" type="button" aria-label="Zoekveld leegmaken" (click)="query.set('')"><app-icon name="close" [size]="14" /></button>
          }
        </label>
        @if (stockFilter() && hasEmpty()) {
          <button class="wk-chip pt-chip" type="button" [attr.aria-pressed]="stockOnly()" (click)="stockOnly.set(!stockOnly())">Alleen met voorraad</button>
        }
        <ng-content />
      </div>
    }
    @if (sections().length) {
      <div class="wk-table pt-table" role="table" [attr.aria-label]="caption()" [class.wk-table--selecting]="mode() === 'pick'" [class.is-pick]="mode() === 'pick'">
        <div class="wk-thead pt-row" role="row">
          @if (mode() === 'pick') { <span class="wk-th" role="columnheader"><span class="sr-only">Kies</span></span> }
          <span class="wk-th" role="columnheader"><span class="sr-only">Foto</span></span>
          <span class="wk-th" role="columnheader">Product</span>
          <span class="wk-th pt-desk" role="columnheader">Kleur</span>
          <span class="wk-th wk-th--num" role="columnheader">{{ figureLabel() }}</span>
          @if (mode() === 'stock') { <span class="wk-th pt-desk" role="columnheader"><span class="sr-only">Melden</span></span> }
        </div>
        @for (section of sections(); track section.key) {
          @let open = isOpen(section.key, section.label);
          @if (section.label !== null) {
            <div class="wk-group pt-group" role="row">
              <span class="wk-group__label pt-group__label" role="cell">
                <button class="wk-group__toggle pt-group__toggle" type="button" [attr.aria-expanded]="open"
                        [attr.aria-label]="(open ? 'Dichtklappen: ' : 'Openklappen: ') + section.label" (click)="fold(section.key)">
                  <app-icon name="chevron-down" [size]="14" />
                </button>
                {{ section.label }} <span class="wk-group__count">{{ section.count }} {{ section.count === 1 ? 'product' : 'producten' }}</span>
              </span>
            </div>
          }
          @if (open) {
            @for (block of section.blocks; track block.key) {
              @if (block.family !== null) {
                @let familyOpen = isOpen(block.key, block.family);
                <div class="wk-tr pt-fam" role="row">
                  <span class="pt-fam__label" role="cell">
                    <button class="pt-fam__toggle" type="button" [attr.aria-expanded]="familyOpen"
                            [attr.aria-label]="(familyOpen ? 'Dichtklappen: ' : 'Openklappen: ') + block.family" (click)="fold(block.key)">
                      <app-icon name="chevron-down" [size]="13" />
                    </button>
                    {{ block.family }} <span class="pt-fam__count">{{ block.rows.length }}</span>
                  </span>
                </div>
                @if (familyOpen) { <ng-container *ngTemplateOutlet="rowList; context: { $implicit: block.rows }" /> }
              } @else {
                <ng-container *ngTemplateOutlet="rowList; context: { $implicit: block.rows }" />
              }
            }
          }
        }
      </div>
    } @else if (query()) {
      <p class="pt-none">Niets gevonden voor “{{ query() }}”.</p>
    } @else {
      <p class="pt-none">{{ emptyText() }}</p>
    }

    <ng-template #rowList let-rows>
      @for (item of rows; track item.productId) {
        @let figure = figureOf(item);
        @let blockedRow = isBlocked(item);
        @if (mode() === 'pick') {
          <label class="wk-tr pt-row pt-tr" role="row" [class.is-off]="blockedRow" [attr.aria-selected]="isSelected(item)">
            <span class="wk-td" role="cell">
              <input class="wk-check pt-check" type="checkbox" [checked]="isSelected(item)" [disabled]="blockedRow && !isSelected(item)"
                     [attr.aria-label]="'Kies ' + label(item)" (change)="picked.emit(item)" />
            </span>
            <ng-container *ngTemplateOutlet="cells; context: { $implicit: item, figure: figure }" />
          </label>
        } @else {
          <div class="wk-tr pt-row pt-tr" role="row" [class.wk-tr--link]="!!item.quantity" [class.is-off]="!item.quantity" (click)="item.quantity && report.emit(item)">
            <ng-container *ngTemplateOutlet="cells; context: { $implicit: item, figure: figure }" />
            <span class="wk-td pt-desk pt-act" role="cell">
              <button class="wk-btn wk-btn--sm" type="button" [disabled]="!item.quantity" [attr.aria-label]="'Melden: ' + label(item)" (click)="$event.stopPropagation(); report.emit(item)">Melden</button>
            </span>
          </div>
        }
      }
    </ng-template>

    <ng-template #cells let-item let-figure="figure">
      <span class="wk-td" role="cell"><app-partner-photo class="pt-photo" [product]="item" [photoUrl]="photoUrl()" /></span>
      @let code = codeOf(item);
      <span class="wk-td pt-name" role="cell">
        <b>{{ item.name }}</b>
        @if (code) { <span class="pt-sub pt-code pt-desk">{{ code }}</span> }
        @if (item.variant || code) {
          <span class="pt-sub pt-phone">@if (item.variant) { <i class="pt-dot" [style.background]="colourOf(item)" aria-hidden="true"></i>{{ item.variant }} }@if (item.variant && code) { · }{{ code }}</span>
        }
      </span>
      <span class="wk-td pt-desk pt-colour" role="cell">
        @if (item.variant) { <i class="pt-dot" [style.background]="colourOf(item)" aria-hidden="true"></i>{{ item.variant }} } @else { <span class="pt-muted">—</span> }
      </span>
      <span class="wk-td wk-td--num pt-fig" role="cell">
        @if (figure) {
          <b [class.pt-zero]="figure.pieces === 0">{{ figure.main }}</b>
          @if (figure.sub) { <span class="pt-sub">{{ figure.sub }}</span> }
        } @else if (item.lastSoldOn) {
          <span class="pt-sold">verkocht {{ day(item.lastSoldOn) }}</span>
        }
      </span>
    </ng-template>
  `,
  styles: `
    :host{display:block;min-width:0}
    .pt-tools{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:0 0 10px}
    .pt-search{position:relative;display:flex;flex:1 1 220px;align-items:center;max-width:320px;color:var(--muted)}
    .pt-search>app-icon{position:absolute;left:10px;pointer-events:none}
    .pt-search input{width:100%;height:34px;padding:0 30px 0 32px;border:1px solid var(--line);border-radius:var(--wk-radius,9px);background:var(--surface-2);color:var(--ink);font:inherit;font-size:13px;outline:none}
    .pt-search input:focus{border-color:var(--rose);background:var(--surface);box-shadow:var(--wk-focus)}
    .pt-search input::-webkit-search-cancel-button{display:none}
    .pt-search__x{position:absolute;right:3px;display:grid;place-items:center;width:28px;height:28px;padding:0;border:0;border-radius:7px;background:none;color:var(--muted);cursor:pointer}
    .pt-chip{flex:none}
    .pt-table{--wk-cols:44px minmax(0,1.4fr) minmax(0,1fr) minmax(110px,auto) 84px;--wk-pad-x:12px}
    .pt-table.is-pick{--wk-cols:24px 44px minmax(0,1.4fr) minmax(0,1fr) minmax(110px,auto)}
    .pt-tr{min-height:52px;cursor:pointer}
    .pt-tr:hover{background:var(--surface-2)}
    .pt-tr[aria-selected=true]{background:var(--rose-soft)}
    .pt-tr.is-off{color:var(--muted);cursor:default}
    .pt-group{grid-template-columns:minmax(0,1fr);min-height:32px}
    .pt-group__label{font-size:11.5px;letter-spacing:.06em;text-transform:uppercase}
    .pt-group .wk-group__count{font-size:12px;letter-spacing:0;text-transform:none}
    .pt-group__toggle[aria-expanded=false] app-icon{transform:rotate(-90deg)}
    .pt-fam{grid-template-columns:minmax(0,1fr);min-height:34px;background:var(--surface)}
    .pt-fam__label{display:flex;align-items:center;gap:6px;min-width:0;color:var(--ink-2);font-size:12.5px;font-weight:700}
    .pt-fam__toggle{display:grid;flex:none;place-items:center;width:24px;height:24px;padding:0;border:0;border-radius:6px;background:none;color:var(--muted);cursor:pointer}
    .pt-fam__toggle:hover{background:var(--surface-2);color:var(--ink)}
    .pt-fam__toggle[aria-expanded=false] app-icon{transform:rotate(-90deg)}
    .pt-fam__count{color:var(--muted);font-weight:600}
    .pt-code{font-variant-numeric:tabular-nums;letter-spacing:.02em}
    .pt-photo{display:block;width:36px;height:36px;border-radius:9px}
    .pt-name{display:grid;align-content:center;white-space:normal}
    .pt-name b{overflow:hidden;font-size:13.5px;font-weight:650;line-height:1.3;text-overflow:ellipsis;white-space:nowrap}
    .pt-colour{display:flex;align-items:center;gap:6px;color:var(--ink-2)}
    .pt-dot{display:inline-block;flex:none;width:9px;height:9px;margin-right:5px;border-radius:50%;background:#c9bfb7;box-shadow:inset 0 0 0 1px rgb(26 22 20/14%);vertical-align:baseline}
    .pt-colour .pt-dot{margin-right:0}
    .pt-fig{display:grid;justify-items:end;align-content:center;white-space:nowrap}
    .pt-fig b{font-size:13.5px;font-weight:700;font-variant-numeric:tabular-nums}
    .pt-sub{display:block;overflow:hidden;color:var(--muted);font-size:11.5px;text-overflow:ellipsis;white-space:nowrap}
    .pt-zero,.pt-muted{color:var(--muted)}
    .pt-sold{color:var(--ink-2);font-size:12.5px}
    .pt-act{display:flex;justify-content:flex-end}
    .pt-check{opacity:1}
    .pt-phone{display:none}
    .pt-none{margin:0;padding:22px 12px;color:var(--muted);font-size:14px;text-align:center}
    @media (max-width: 679.98px), (hover: none) and (max-width: 1023.98px){
      .pt-tools{padding:0 14px 10px}
      .pt-search{max-width:none}
      .pt-search input{height:44px;border:0;border-radius:12px;background:color-mix(in srgb,var(--ink) 6%,var(--surface));font-size:16px}
      .pt-search__x{width:40px;height:40px}
      .pt-chip{height:36px}
      .pt-table{--wk-cols:44px minmax(0,1fr) auto;--wk-pad-x:14px;font-size:15px}
      .pt-table.is-pick{--wk-cols:28px 44px minmax(0,1fr) auto}
      .pt-table .wk-thead{display:none}
      .pt-desk{display:none}
      .pt-phone{display:block}
      .pt-tr{min-height:60px}
      .pt-photo{width:44px;height:44px;border-radius:11px}
      .pt-name b{font-size:15.5px;white-space:normal;overflow-wrap:anywhere;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2}
      .pt-sub{font-size:13px}
      .pt-fig b{font-size:16px}
      .pt-check{width:22px;height:22px;border-radius:50%}
      .pt-group{top:var(--wk-sticky-top,0px)}
      .pt-fam{min-height:40px}
      .pt-fam__label{font-size:14px}
      .pt-fam__toggle{width:36px;height:36px}
    }
  `,
})
export class PartnerProductTable {
  readonly items = input.required<readonly TableProduct[]>();
  /** 'stock': a Melden per row (the Overzicht); 'pick': a tick per row (the Melden page). */
  readonly mode = input<'stock' | 'pick'>('stock');
  readonly selected = input<ReadonlySet<number>>(new Set());
  /** Products that cannot be picked (nothing there to sell); a picked one can still be put back. */
  readonly blocked = input<ReadonlySet<number>>(new Set());
  readonly photoUrl = input<PhotoUrlFn>(partnerPhoto);
  readonly caption = input('Producten');
  readonly figureLabel = input('Op voorraad');
  readonly emptyText = input('Er ligt nu geen voorraad.');
  readonly searchLabel = input('Zoek een product');
  readonly toolbar = input(true);
  /** Offers "Alleen met voorraad" (on by default) when some rows have none. */
  readonly stockFilter = input(false);
  readonly picked = output<TableProduct>();
  readonly report = output<TableProduct>();

  readonly query = signal('');
  readonly stockOnly = signal(true);
  private readonly folded = signal<ReadonlySet<string>>(new Set());

  readonly hasEmpty = computed(() => this.items().some((item) => item.quantity === 0 || (item.quantity == null && !!item.lastSoldOn)));

  /** Names and colours more than one listed product shares (their rows show the code). */
  private readonly twins = computed(() => twinKeys(this.items()));

  readonly sections = computed<Section[]>(() => {
    const words = searchText(this.query()).split(/\s+/).filter(Boolean);
    const stockOnly = this.stockFilter() && this.stockOnly();
    const selected = this.selected();
    const items = this.items();
    /* Category sections only when the products carry categories; else one list of series and products. */
    const byCategory = items.some((item) => !!item.categoryName?.trim());
    const sections = new Map<string, Section & { order: number; name: string }>();
    const blocks = new Map<string, Block>();
    for (const item of items) {
      if (stockOnly && !(item.quantity && item.quantity > 0) && !selected.has(item.productId)) continue;
      if (words.length) {
        const text = searchText([item.name, item.variant, item.sku, item.familyName, item.categoryName].filter(Boolean).join(' '));
        if (!words.every((word) => text.includes(word))) continue;
      }
      const name = item.categoryName?.trim() || '';
      const sectionKey = !byCategory ? 'all' : item.categoryId != null ? `c${item.categoryId}` : name ? `n${name}` : 'none';
      let section = sections.get(sectionKey);
      if (!section) {
        section = {
          key: sectionKey, label: byCategory ? name || 'Zonder categorie' : null, count: 0, blocks: [],
          order: !byCategory || !name ? Number.MAX_SAFE_INTEGER : item.categoryOrder ?? Number.MAX_SAFE_INTEGER - 1, name,
        };
        sections.set(sectionKey, section);
      }
      section.count++;
      const blockKey = item.familyId != null ? `${sectionKey}:f${item.familyId}` : `${sectionKey}:p${item.productId}`;
      let block = blocks.get(blockKey);
      if (!block) {
        block = { key: blockKey, family: item.familyId != null ? item.familyName?.trim() || item.name : null, rows: [] };
        blocks.set(blockKey, block);
        section.blocks.push(block);
      }
      block.rows.push(item);
    }
    /* A series with one product here needs no header of its own: the product's name says it. */
    for (const block of blocks.values()) if (block.rows.length < 2) block.family = null;
    return [...sections.values()].sort((a, b) => a.order - b.order || NAME_ORDER.compare(a.name, b.name));
  });

  isOpen(key: string, label: string | null): boolean {
    return label === null || !!this.query().trim() || !this.folded().has(key);
  }

  fold(key: string): void {
    this.folded.update((set) => {
      const next = new Set(set);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  isSelected(item: TableProduct): boolean {
    return this.selected().has(item.productId);
  }

  isBlocked(item: TableProduct): boolean {
    return this.blocked().has(item.productId);
  }

  figureOf(item: TableProduct): { main: string; sub: string | null; pieces: number } | null {
    return item.quantity == null ? null : stockFigure(item, item.quantity);
  }

  label(item: TableProduct): string {
    const code = this.codeOf(item);
    return [item.name, item.variant, code].filter(Boolean).join(' ');
  }

  /** The code of a product whose name and colour another listed product shares; null otherwise. */
  codeOf(item: TableProduct): string | null {
    return twinLabel(item, this.twins());
  }

  colourOf(item: TableProduct): string | null {
    return safeColour(item.colourHex);
  }

  day(iso: string): string {
    return shortDate(iso);
  }
}
