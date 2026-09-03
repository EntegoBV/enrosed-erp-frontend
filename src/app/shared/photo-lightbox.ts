import { ChangeDetectionStrategy, Component, computed, inject, input, model, signal } from '@angular/core';
import { CatalogApi } from '../core/api/catalog-api';
import { AuthImage } from '../core/api/auth-image';
import { saveBlob } from '../core/api/download';
import { PhotoDto } from '../core/api/models';
import { fileTypeLabel, formatBytes } from './format-bytes';

/**
 * Full-screen photo viewer with download.
 *
 * Opens on top of everything (fixed, above sheets and bars), pages through
 * the series with taps on the edges or the dots, and offers the original
 * file as a download - the photos are stored unscaled, so what you save is
 * print quality, not a thumbnail.
 */
@Component({
  selector: 'app-photo-lightbox',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AuthImage],
  template: `
    @if (open() && current(); as photo) {
      <div class="lightbox" (click)="close()">
        <header class="lightbox__bar" (click)="$event.stopPropagation()">
          <span class="lightbox__count">{{ index() + 1 }} / {{ photos().length }}</span>
          @if (meta(photo); as meta) { <span class="lightbox__meta" [title]="photo.originalFilename">{{ meta }}</span> }
          <span class="spacer"></span>
          <button class="lightbox__btn" type="button" [disabled]="downloading()"
                  (click)="download(photo)">
            {{ downloading() ? 'Bezig…' : 'Downloaden' }}
          </button>
          <button class="lightbox__btn" type="button" (click)="close()" aria-label="Sluiten">✕</button>
        </header>

        <div class="lightbox__stage" (click)="$event.stopPropagation()">
          @if (photos().length > 1) {
            <button class="lightbox__nav lightbox__nav--prev" type="button"
                    (click)="step(-1)" aria-label="Vorige">‹</button>
          }
          <img class="lightbox__img" [appAuthSrc]="photo.url" [alt]="photo.originalFilename" />
          @if (photos().length > 1) {
            <button class="lightbox__nav lightbox__nav--next" type="button"
                    (click)="step(1)" aria-label="Volgende">›</button>
          }
        </div>

        @if (photos().length > 1) {
          <nav class="lightbox__dots" (click)="$event.stopPropagation()">
            @for (p of photos(); track p.id) {
              <button class="lightbox__dot" [class.on]="$index === index()"
                      type="button" (click)="index.set($index)"
                      [attr.aria-label]="'Foto ' + ($index + 1)"></button>
            }
          </nav>
        }
      </div>
    }
  `,
  styles: `
    .lightbox {
      position: fixed; inset: 0; z-index: 200;
      display: flex; flex-direction: column;
      background: rgb(20 14 12 / 94%);
      backdrop-filter: blur(10px);
      animation: lightbox-in 0.18s ease-out;
    }
    @keyframes lightbox-in { from { opacity: 0; } }
    .lightbox__bar {
      display: flex; align-items: center; gap: 8px;
      padding: calc(10px + env(safe-area-inset-top)) 14px 10px;
    }
    .lightbox__count { color: #cfc4bf; font-size: 13px; font-variant-numeric: tabular-nums; flex: none; }
    .lightbox__meta {
      min-width: 0; color: #a99d97; font-size: 12.5px; font-variant-numeric: tabular-nums;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .lightbox__meta::before { content: '·'; margin: 0 8px 0 2px; }
    .lightbox__btn {
      border: 1px solid rgb(255 255 255 / 25%); border-radius: 999px;
      background: transparent; color: #fff;
      padding: 8px 16px; font-size: 13.5px; font-weight: 600; cursor: pointer;
    }
    .lightbox__btn:active { background: rgb(255 255 255 / 12%); }
    .lightbox__stage {
      flex: 1; min-height: 0; position: relative;
      display: flex; align-items: center; justify-content: center;
      padding: 8px;
    }
    .lightbox__img {
      max-width: 100%; max-height: 100%;
      object-fit: contain; border-radius: 6px;
      animation: lightbox-photo 0.22s ease-out;
    }
    @keyframes lightbox-photo { from { opacity: 0; transform: scale(0.97); } }
    .lightbox__nav {
      position: absolute; top: 0; bottom: 0; width: 25%;
      border: 0; background: transparent; color: rgb(255 255 255 / 65%);
      font-size: 44px; cursor: pointer;
      display: flex; align-items: center;
    }
    .lightbox__nav--prev { left: 0; justify-content: flex-start; padding-left: 10px; }
    .lightbox__nav--next { right: 0; justify-content: flex-end; padding-right: 10px; }
    .lightbox__dots {
      display: flex; justify-content: center; gap: 8px;
      padding: 12px 0 calc(16px + env(safe-area-inset-bottom));
    }
    .lightbox__dot {
      width: 8px; height: 8px; border-radius: 50%; border: 0;
      background: rgb(255 255 255 / 30%); cursor: pointer; padding: 0;
    }
    .lightbox__dot.on { background: #fff; }
  `,
})
export class PhotoLightbox {
  private readonly catalog = inject(CatalogApi);

  readonly photos = input<PhotoDto[]>([]);
  /** Index of the shown photo; -1 means closed. */
  readonly index = model(-1);

  readonly downloading = signal(false);
  readonly open = computed(() => this.index() >= 0);
  readonly current = computed(() => this.photos()[this.index()] ?? null);

  close(): void {
    this.index.set(-1);
  }

  /** "4000 × 3000 px · 2,4 MB · JPG": what you are looking at, and what the download weighs. */
  meta(photo: PhotoDto): string {
    return [
      photo.widthPx && photo.heightPx ? `${photo.widthPx} × ${photo.heightPx} px` : '',
      formatBytes(photo.sizeBytes),
      fileTypeLabel(photo.originalFilename, photo.contentType),
    ].filter(Boolean).join(' · ');
  }

  step(direction: number): void {
    const count = this.photos().length;
    this.index.set((this.index() + direction + count) % count);
  }

  async download(photo: PhotoDto): Promise<void> {
    this.downloading.set(true);
    try {
      const blob = await this.catalog.photoBlob(photo.downloadUrl || photo.url);
      saveBlob(blob, photo.originalFilename || 'foto.jpg');
    } finally {
      this.downloading.set(false);
    }
  }
}
