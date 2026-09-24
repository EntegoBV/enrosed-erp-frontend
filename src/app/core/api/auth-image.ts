import {
  Directive, ElementRef, OnDestroy, afterNextRender, booleanAttribute, effect, inject, input, signal,
} from '@angular/core';
import { CatalogApi } from './catalog-api';
import { DesktopViewport } from '../platform/desktop-viewport';

/**
 * Shows a photo that sits behind the login.
 *
 * A plain src on an img tag cannot send an Authorization header, so we
 * fetch the bytes with the HttpClient and make a blob URL. It is released
 * when the element disappears, or memory leaks while paging through a
 * long list.
 *
 * Long libraries add `appAuthLazy`: the bytes are then fetched only once
 * the image comes within 200px of the viewport.
 */
@Directive({ selector: 'img[appAuthSrc]' })
export class AuthImage implements OnDestroy {
  private readonly element = inject<ElementRef<HTMLImageElement>>(ElementRef);
  private readonly catalog = inject(CatalogApi);
  private readonly desktop = inject(DesktopViewport);

  readonly source = input.required<string | null>({ alias: 'appAuthSrc' });
  /** Lists default to small; viewers opt into medium or the untouched original. */
  readonly rendition = input<'small' | 'medium' | 'original'>('small', { alias: 'appAuthSize' });
  /** Wait with the fetch until the image is (nearly) on screen. */
  readonly lazy = input(false, { alias: 'appAuthLazy', transform: booleanAttribute });

  private objectUrl: string | null = null;
  private requestVersion = 0;
  /** Without IntersectionObserver every image counts as visible at once. */
  private readonly visible = signal(typeof IntersectionObserver === 'undefined');
  private observer: IntersectionObserver | null = null;

  constructor() {
    afterNextRender(() => {
      if (!this.lazy() || this.visible()) return;
      this.observer = new IntersectionObserver((entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        this.visible.set(true);
        this.disconnect();
      }, { rootMargin: '200px' });
      this.observer.observe(this.element.nativeElement);
    });

    effect(() => {
      if (this.lazy() && !this.visible()) return;
      const requestedSize = this.rendition();
      const size = requestedSize === 'medium' && !this.desktop.active() ? 'small' : requestedSize;
      const url = screenPhotoUrl(this.source(), size);
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
    this.disconnect();
    this.requestVersion++;
    this.release();
  }

  private disconnect(): void {
    this.observer?.disconnect();
    this.observer = null;
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
  const product = url.match(/^(.*\/api\/products\/\d+\/photos\/-?\d+)(?:\/renditions\/(?:small|medium))?(\?[^#]*)?$/);
  if (product) return `${product[1]}/renditions/${size}${product[2] ?? ''}`;
  const family = url.match(/^(.*\/api\/product-families\/\d+\/images\/\d+)\/(?:small|medium|large|original)(\?[^#]*)?$/);
  if (family) return `${family[1]}/${size}${family[2] ?? ''}`;
  return url;
}
