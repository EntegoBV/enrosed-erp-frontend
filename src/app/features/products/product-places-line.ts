import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthImage } from '../../core/api/auth-image';
import { Icon } from '../../shared/icon';

/** One of the three places on the product page: what it shows now and where "Wijzig" would lead. */
export interface ProductPlaceLineItem {
  key: 'website' | 'catalogue' | 'documents';
  /** "Website", "Catalogus", "Offertes en facturen". */
  name: string;
  /** Small rendition of the photo the place shows now; null = the dashed frame. */
  photoUrl: string | null;
  alt: string;
  /** Read out instead of a picture: "Geen foto", "Kleur staat niet aan". */
  empty: string;
  /** The picker the editor opens for this place; null = nothing to change from here. */
  kies: 'website' | 'catalogus' | null;
  /** Accessible name of the link: "Wijzig de catalogusfoto van Kersenroze". */
  linkLabel: string | null;
}

export interface ProductPlaceLine {
  productId: number;
  /** "Dit zien klanten bij Kersenroze". */
  heading: string;
  items: ProductPlaceLineItem[];
}

/**
 * "Dit zien klanten bij {kleur}" on the product page: the photo the website,
 * the catalogue and quotes and invoices show for this colour, as the server
 * resolved them. Looking only; Website and Catalogus lead to the photo
 * section of the editor with that picker open (`?tab=media&kies=…`).
 * Presentational: the product page builds the line from the photo overview.
 */
@Component({
  selector: 'app-product-places-line',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AuthImage, Icon, RouterLink],
  template: `
    <p class="pl__title" id="product-places-title">{{ line().heading }}</p>
    <ul class="pl__list" aria-labelledby="product-places-title">
      @for (item of line().items; track item.key) {
        <li [attr.data-place]="item.key">
          @if (item.kies; as kies) {
            <a class="pl__item" [routerLink]="['/products', line().productId, 'edit']" [queryParams]="{ tab: 'media', kies: kies }"
               [attr.aria-label]="item.linkLabel">
              @if (item.photoUrl; as url) { <span class="pl__thumb"><img [appAuthSrc]="url" alt="" draggable="false" /></span> }
              @else { <span class="pl__thumb pl__thumb--none"><app-icon name="image" [size]="20" /></span> }
              <span class="pl__name">{{ item.name }}<span aria-hidden="true"> ›</span></span>
            </a>
          } @else {
            <span class="pl__item">
              @if (item.photoUrl; as url) { <span class="pl__thumb"><img [appAuthSrc]="url" [alt]="item.alt" draggable="false" /></span> }
              @else { <span class="pl__thumb pl__thumb--none"><app-icon name="image" [size]="20" /><span class="sr-only">{{ item.empty }}</span></span> }
              <span class="pl__name">{{ item.name }}</span>
            </span>
          }
        </li>
      }
    </ul>
  `,
  styles: `
    :host{display:block;min-width:0}
    .pl__title{margin:0 0 7px;color:var(--ink-2);font-size:12px;font-weight:650;line-height:1.35;overflow-wrap:anywhere}
    .pl__list{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:0;padding:0;list-style:none}
    .pl__list li{min-width:0}
    .pl__item{display:grid;justify-items:start;align-content:start;gap:5px;min-width:0;color:var(--ink-2);font-size:12px;font-weight:600;line-height:1.3;text-decoration:none}
    .pl__thumb{display:grid;place-items:center;box-sizing:border-box;width:56px;height:56px;border:1px solid var(--line);border-radius:10px;background:#fff;color:var(--muted);overflow:hidden}
    .pl__thumb img{display:block;width:100%;height:100%;object-fit:contain}
    .pl__thumb--none{border-style:dashed;border-color:var(--line-strong);background:transparent}
    .pl__name{max-width:100%;overflow-wrap:anywhere}
    a.pl__item{color:var(--rose-dark);border-radius:10px}
    a.pl__item:hover .pl__thumb{border-color:var(--rose)}
    a.pl__item:hover .pl__name{text-decoration:underline}
  `,
})
export class ProductPlacesLine {
  readonly line = input.required<ProductPlaceLine>();
}
