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

  private objectUrl: string | null = null;

  constructor() {
    effect(() => {
      const url = this.source();
      this.release();
      if (!url) {
        this.element.nativeElement.removeAttribute('src');
        return;
      }
      this.catalog
        .photoBlob(url)
        .then((blob) => {
          this.objectUrl = URL.createObjectURL(blob);
          this.element.nativeElement.src = this.objectUrl;
        })
        .catch(() => this.element.nativeElement.removeAttribute('src'));
    });
  }

  ngOnDestroy(): void {
    this.release();
  }

  private release(): void {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }
}
