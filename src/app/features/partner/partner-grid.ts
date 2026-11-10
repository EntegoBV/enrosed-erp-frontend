import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import type { PartnerProductTile } from '../../core/api/partner-portal-api';
import { Icon } from '../../shared/icon';
import { PartnerPhoto, PhotoUrlFn, partnerPhoto, safeColour } from './partner-photo';
import { count, searchText, shortDate } from './partner-format';

/** A tile of the grid: a stock tile (quantity) or a recent sale (lastSoldOn). */
export type GridProduct = PartnerProductTile & { quantity?: number; lastSoldOn?: string };

/**
 * The product tiles: photo, name, colour dot + variant and the big figure
 * ("120 stuks", or "laatst verkocht 10/11" for a buyback). Search on top once
 * there are a few. Two columns on a phone, as many as fit on a desk. Open mode
 * reports a tap; select mode shows the picked tiles tinted with a check.
 */
@Component({
  selector: 'app-partner-grid',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, PartnerPhoto],
  template: `
    @if (items().length > searchFrom) {
      <label class="search">
        <app-icon name="search" [size]="18" />
        <input type="search" [placeholder]="searchLabel()" [attr.aria-label]="searchLabel()" enterkeyhint="search"
               autocomplete="off" autocorrect="off" spellcheck="false"
               [value]="query()" (input)="query.set($any($event.target).value)" />
        @if (query()) {
          <button class="search__clear" type="button" aria-label="Zoekveld leegmaken" (click)="query.set('')">
            <app-icon name="close" [size]="16" />
          </button>
        }
      </label>
    }
    @if (shown().length) {
      <div class="grid" role="list">
        @for (item of shown(); track item.productId) {
          <div role="listitem">
            <button class="tile" type="button" [class.is-on]="selectable() && isSelected(item.productId)"
                    [attr.aria-pressed]="selectable() ? isSelected(item.productId) : null" (click)="picked.emit(item)">
              <app-partner-photo class="tile__photo" [product]="item" [photoUrl]="photoUrl()" />
              @if (selectable()) {
                <span class="tile__check" aria-hidden="true"><app-icon name="tick" [size]="16" /></span>
              }
              <span class="tile__name">{{ item.name }}</span>
              @if (item.variant) {
                <span class="tile__variant">
                  <i class="tile__dot" [style.background]="colourOf(item)" aria-hidden="true"></i>{{ item.variant }}
                </span>
              }
              @if (item.lastSoldOn && item.quantity == null) {
                <span class="tile__sold">laatst verkocht {{ day(item.lastSoldOn) }}</span>
              } @else {
                <span class="tile__qty">{{ num(item.quantity) }} <small>{{ item.quantity === 1 ? item.unitOne : item.unitOther }}</small></span>
              }
            </button>
          </div>
        }
      </div>
    } @else if (query()) {
      <p class="none">Niets gevonden voor “{{ query() }}”.</p>
    } @else {
      <p class="none">{{ emptyText() }}</p>
    }
  `,
  styles: `
    :host{display:block}
    .search{position:relative;display:flex;align-items:center;gap:8px;min-height:44px;margin:0 0 12px;padding:0 6px 0 12px;border-radius:12px;background:color-mix(in srgb,var(--ink) 6%,var(--surface));color:var(--muted)}
    .search input{flex:1;min-width:0;height:44px;border:0;background:transparent;color:var(--ink);font:inherit;font-size:16px;outline:none}
    .search input::-webkit-search-cancel-button{display:none}
    .search:focus-within{box-shadow:0 0 0 2px color-mix(in srgb,var(--rose) 45%,transparent)}
    .search__clear{display:grid;place-items:center;width:36px;height:36px;padding:0;border:0;border-radius:50%;background:transparent;color:var(--muted);cursor:pointer}
    .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
    @media (min-width: 1024px), (min-width: 680px) and (hover: hover){.grid{grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:12px}}
    @media (min-width: 600px) and (max-width: 1023.98px) and (hover: none){.grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
    .tile{position:relative;display:grid;align-content:start;gap:3px;width:100%;height:100%;min-height:88px;padding:8px 8px 12px;border:0;border-radius:18px;background:var(--surface);color:var(--ink);font:inherit;text-align:left;cursor:pointer;box-shadow:0 1px 2px rgb(26 22 20/5%);-webkit-tap-highlight-color:transparent;transition:box-shadow .15s ease}
    .tile:active{transform:scale(.98)}
    .tile:focus-visible{outline:3px solid color-mix(in srgb,var(--rose) 55%,transparent);outline-offset:2px}
    .tile.is-on{box-shadow:0 0 0 2.5px var(--rose),0 4px 14px color-mix(in srgb,var(--rose) 18%,transparent);background:color-mix(in srgb,var(--rose) 5%,var(--surface))}
    .tile__photo{width:100%;aspect-ratio:4/3;margin-bottom:6px;border-radius:12px}
    .tile__check{position:absolute;top:14px;right:14px;display:grid;place-items:center;width:28px;height:28px;border-radius:50%;background:rgb(255 255 255/85%);color:transparent;box-shadow:inset 0 0 0 1.5px rgb(26 22 20/22%)}
    .tile.is-on .tile__check{background:var(--rose);color:#fff;box-shadow:none}
    .tile__name{padding:0 4px;overflow:hidden;font-size:14.5px;font-weight:650;line-height:1.25;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow-wrap:anywhere}
    .tile__variant{display:flex;align-items:center;gap:6px;min-width:0;padding:0 4px;overflow:hidden;color:var(--muted);font-size:13px;white-space:nowrap;text-overflow:ellipsis}
    .tile__dot{flex:none;width:10px;height:10px;border-radius:50%;background:#c9bfb7;box-shadow:inset 0 0 0 1px rgb(26 22 20/14%)}
    .tile__qty{padding:4px 4px 0;font-size:22px;font-weight:750;letter-spacing:-.02em;font-variant-numeric:tabular-nums;line-height:1.1}
    .tile__qty small{color:var(--muted);font-size:13px;font-weight:600;letter-spacing:0}
    .tile__sold{padding:4px 4px 0;color:var(--ink-2);font-size:13px;font-weight:600}
    .none{margin:8px 0;padding:24px 12px;border-radius:18px;background:var(--surface);color:var(--muted);font-size:15px;text-align:center}
  `,
})
export class PartnerGrid {
  readonly items = input.required<readonly GridProduct[]>();
  readonly selectable = input(false);
  readonly selected = input<ReadonlySet<number>>(new Set());
  readonly photoUrl = input<PhotoUrlFn>(partnerPhoto);
  readonly emptyText = input('Er ligt nu geen voorraad.');
  readonly searchLabel = input('Zoek een product');
  readonly picked = output<GridProduct>();

  /** Search shows from this many tiles on. */
  readonly searchFrom = 6;
  readonly query = signal('');

  readonly shown = computed(() => {
    const words = searchText(this.query()).split(/\s+/).filter(Boolean);
    if (!words.length) return this.items();
    return this.items().filter((item) => {
      const text = searchText([item.name, item.variant, item.sku, item.familyName].filter(Boolean).join(' '));
      return words.every((word) => text.includes(word));
    });
  });

  isSelected(productId: number): boolean {
    return this.selected().has(productId);
  }

  colourOf(item: GridProduct): string | null {
    return safeColour(item.colourHex);
  }

  num(value: number | null | undefined): string {
    return count(value);
  }

  day(iso: string): string {
    return shortDate(iso);
  }
}
