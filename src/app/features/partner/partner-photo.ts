import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { AuthImage } from '../../core/api/auth-image';
import { partnerPhotoUrl } from '../../core/api/partner-portal-api';

/** What a photo needs of a product. */
export interface PhotoProduct {
  productId: number;
  hasPhoto: boolean;
  photoVersion: string | null;
  colourHex: string | null;
}

/** Where a product's photo comes from; the partner route by default, a staff screen can pass its own. */
export type PhotoUrlFn = (product: PhotoProduct, size: 'small' | 'medium') => string | null;

export const partnerPhoto: PhotoUrlFn = (product, size) =>
  product.hasPhoto ? partnerPhotoUrl(product.productId, product.photoVersion, size) : null;

/**
 * A product photo behind the login (AuthImage on the partner photo route),
 * on a soft tint of the product's colour: without a photo, or while it loads,
 * the tint is what shows.
 */
@Component({
  selector: 'app-partner-photo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AuthImage],
  host: { class: 'pp-photo', '[style.--pp-colour]': 'colour()' },
  template: `
    @if (url(); as src) {
      <img [appAuthSrc]="src" appAuthLazy alt="" draggable="false" />
    } @else {
      <span class="pp-photo__dot" aria-hidden="true"></span>
    }
  `,
  styles: `
    :host{position:relative;display:grid;place-items:center;overflow:hidden;border-radius:inherit;background:color-mix(in srgb,var(--pp-colour,#c9bfb7) 16%,var(--surface-2,#fcfaf8))}
    img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
    .pp-photo__dot{width:34%;max-width:28px;aspect-ratio:1;border-radius:50%;background:var(--pp-colour,#c9bfb7);box-shadow:inset 0 0 0 1px rgb(26 22 20/10%)}
  `,
})
export class PartnerPhoto {
  readonly product = input.required<PhotoProduct>();
  readonly size = input<'small' | 'medium'>('small');
  readonly photoUrl = input<PhotoUrlFn>(partnerPhoto);

  readonly url = computed(() => this.photoUrl()(this.product(), this.size()));
  readonly colour = computed(() => safeColour(this.product().colourHex));
}

/** Only a plain hex colour reaches the style (it is data from the server). */
export function safeColour(value: string | null | undefined): string | null {
  return value && /^#[0-9a-f]{3,8}$/i.test(value.trim()) ? value.trim() : null;
}
