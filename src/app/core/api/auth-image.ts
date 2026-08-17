import { Directive, ElementRef, OnDestroy, effect, inject, input } from '@angular/core';
import { CatalogApi } from './catalog-api';

/**
 * Toont een foto die achter de aanmelding zit.
 *
 * Een gewone src op een img-tag kan geen Authorization-header meesturen, dus
 * halen we de bytes op met de HttpClient en maken er een blob-URL van. Die
 * wordt weer vrijgegeven zodra het element verdwijnt, anders lekt het geheugen
 * bij het doorbladeren van een lange lijst.
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
