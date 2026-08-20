import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthImage } from '../../core/api/auth-image';
import { LanguageCode, ProductFamily, ProductFamilyImage } from '../../core/api/models';

@Component({
  selector: 'app-product-family-gallery',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, AuthImage],
  template: `
    <section aria-labelledby="publication-gallery-title">
      <div class="section-head">
        <div>
          <h3 id="publication-gallery-title">Websitegalerij</h3>
          <p>Sleepvrij en precies: bepaal de volgorde en alternatieve tekst.</p>
        </div>
        <div class="gallery-actions">
          <span>{{ family().images.length }} foto('s)</span>
          <button class="btn btn--sm" type="button" (click)="imageInput.click()">+ Foto</button>
          <input
            #imageInput
            class="file-input"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            (change)="pickImageFile($event)"
          />
        </div>
      </div>

      @if (family().images.length) {
        <ol class="image-list">
          @for (image of orderedImages(); track image.id) {
            <li>
              <img [appAuthSrc]="image.smallUrl" alt="" />
              <div class="image-copy">
                <b>{{ image.variantColor || image.originalFilename }}</b>
                <label>
                  <span class="sr-only">Alternatieve tekst voor {{ image.originalFilename }}</span>
                  <input
                    class="input input--sm"
                    [ngModel]="imageAlt(image)"
                    (ngModelChange)="patchImageAlt(image.id, $event)"
                    [placeholder]="'Beschrijf de foto in ' + language()"
                  />
                </label>
              </div>
              <div class="image-actions">
                <button
                  type="button"
                  [disabled]="$first"
                  [attr.aria-label]="image.originalFilename + ' naar voren'"
                  (click)="moveImage($index, -1)"
                >
                  ↑
                </button>
                <button
                  type="button"
                  [disabled]="$last"
                  [attr.aria-label]="image.originalFilename + ' naar achteren'"
                  (click)="moveImage($index, 1)"
                >
                  ↓
                </button>
                <button
                  class="delete"
                  type="button"
                  [attr.aria-label]="image.originalFilename + ' verwijderen'"
                  (click)="imageDeleteRequested.emit(image.id)"
                >
                  ×
                </button>
              </div>
            </li>
          }
        </ol>
      } @else {
        <div class="empty-gallery">
          <span aria-hidden="true">◇</span>
          <div>
            <b>Nog geen publieke foto's</b
            ><small>De migratie koppelt de bronfoto's aan deze familie.</small>
          </div>
        </div>
      }
    </section>
  `,
  styles: `
    :host {
      display: block;
      border-bottom: 1px solid var(--line);
    }
    section {
      padding: 18px 0;
    }
    .section-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
    }
    h3 {
      font-size: 13.5px;
      line-height: 1.25;
    }
    .section-head p {
      margin-top: 2px;
      color: var(--muted);
      font-size: 10.5px;
      line-height: 1.35;
    }
    .gallery-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .gallery-actions > span {
      color: var(--muted);
      font-size: 10px;
      font-weight: 700;
      white-space: nowrap;
    }
    .file-input {
      position: absolute;
      width: 1px;
      height: 1px;
      opacity: 0;
      pointer-events: none;
    }
    .image-list {
      display: grid;
      gap: 7px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .image-list li {
      min-width: 0;
      display: grid;
      grid-template-columns: 58px minmax(0, 1fr) auto;
      align-items: center;
      gap: 9px;
      padding: 7px;
      border: 1px solid var(--line);
      border-radius: var(--r-sm);
      background: var(--surface-2);
    }
    .image-list img {
      width: 58px;
      height: 58px;
      border-radius: 9px;
      background: #fff;
      object-fit: cover;
    }
    .image-copy {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    .image-copy b {
      overflow: hidden;
      font-size: 10px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .image-actions {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .image-actions button {
      width: 31px;
      height: 27px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface);
      color: var(--ink-2);
      cursor: pointer;
    }
    .image-actions button:disabled {
      opacity: 0.3;
      cursor: default;
    }
    .image-actions .delete {
      color: var(--danger);
    }
    .empty-gallery {
      display: flex;
      align-items: center;
      gap: 11px;
      padding: 15px;
      border: 1px dashed var(--line-strong);
      border-radius: var(--r-sm);
      background: var(--surface-2);
    }
    .empty-gallery > span {
      color: var(--rose);
      font-size: 25px;
    }
    .empty-gallery > div {
      display: flex;
      flex-direction: column;
    }
    .empty-gallery b {
      font-size: 12px;
    }
    .empty-gallery small {
      margin-top: 2px;
      color: var(--muted);
      font-size: 10.5px;
      line-height: 1.4;
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
  `,
})
export class ProductFamilyGallery {
  readonly family = input.required<ProductFamily>();
  readonly language = input.required<LanguageCode>();
  readonly familyChange = output<ProductFamily>();
  readonly imageUploadRequested = output<File>();
  readonly imageDeleteRequested = output<number>();

  readonly orderedImages = computed(() =>
    [...this.family().images].sort((left, right) => left.position - right.position),
  );

  pickImageFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.imageUploadRequested.emit(file);
    input.value = '';
  }

  imageAlt(image: ProductFamilyImage): string {
    return image.altTexts.find((item) => item.language === this.language())?.alt ?? '';
  }

  patchImageAlt(imageId: number, alt: string): void {
    const family = this.family();
    const language = this.language();
    const images = family.images.map((image) => {
      if (image.id !== imageId) return image;
      const altTexts = image.altTexts.some((item) => item.language === language)
        ? image.altTexts.map((item) => (item.language === language ? { ...item, alt } : item))
        : [...image.altTexts, { language, alt }];
      return { ...image, altTexts };
    });
    this.familyChange.emit({ ...family, images });
  }

  moveImage(index: number, direction: -1 | 1): void {
    const family = this.family();
    const images = this.orderedImages();
    const target = index + direction;
    if (target < 0 || target >= images.length) return;
    [images[index], images[target]] = [images[target], images[index]];
    this.familyChange.emit({
      ...family,
      images: images.map((image, position) => ({ ...image, position })),
    });
  }
}
