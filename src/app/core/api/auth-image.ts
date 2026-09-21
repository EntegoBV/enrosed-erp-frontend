import { Directive, ElementRef, OnDestroy, effect, inject, input } from '@angular/core';
import { CatalogApi } from './catalog-api';

/**
 * Shows a photo that sits behind the login.
 *
 * A plain src on an img tag cannot send an Authorization header, so we
 * fetch the bytes with the HttpClient and make a blob URL. It is released
 * when the element disappears, or memory leaks while paging through a
 * long list.
 */
@Directive({ selector: 'img[appAuthSrc]' })
export class AuthImage implements OnDestroy {
  private readonly element = inject<ElementRef<HTMLImageElement>>(ElementRef);
  private readonly catalog = inject(CatalogApi);

  readonly source = input.required<string | null>({ alias: 'appAuthSrc' });
  /** Lists default to small; viewers opt into medium or the untouched original. */
  readonly rendition = input<'small' | 'medium' | 'original'>('small', { alias: 'appAuthSize' });

  private objectUrl: string | null = null;
  private requestVersion = 0;

  constructor() {
    effect(() => {
      const url = screenPhotoUrl(this.source(), this.rendition());
      const version = ++this.requestVersion;
      this.release();
      if (!url) {
        this.element.nativeElement.removeAttribute('src');
        return;
      }
      this.catalog
        .photoBlob(url)
        .then((blob) => {
          if (version !== this.requestVersion) return;
          this.objectUrl = URL.createObjectURL(blob);
          this.element.nativeElement.src = this.objectUrl;
        })
        .catch(() => {
          if (version === this.requestVersion) this.element.nativeElement.removeAttribute('src');
        });
    });
  }

  ngOnDestroy(): void {
    this.requestVersion++;
    this.release();
  }

  private release(): void {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }
}

/** Only known ERP photo routes are transformed; downloads and unrelated media stay intact. */
export function screenPhotoUrl(url: string | null, size: 'small' | 'medium' | 'original'): string | null {
  if (!url || size === 'original') return url;
  const product = url.match(/^(.*\/api\/products\/\d+\/photos\/-?\d+)(\?[^#]*)?$/);
  if (product) return `${product[1]}/renditions/${size}${product[2] ?? ''}`;
  const family = url.match(/^(.*\/api\/product-families\/\d+\/images\/\d+)\/(?:large|original)(\?[^#]*)?$/);
  if (family) return `${family[1]}/${size}${family[2] ?? ''}`;
  return url;
}
