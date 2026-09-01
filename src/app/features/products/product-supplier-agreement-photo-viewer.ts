import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  inject,
  input,
  model,
  signal,
} from '@angular/core';
import { CatalogApi } from '../../core/api/catalog-api';
import { AuthImage } from '../../core/api/auth-image';
import { saveBlob } from '../../core/api/download';
import { messageOf } from '../../core/api/errors';
import { ProductSupplierAgreementPhoto } from '../../core/api/models';
import { Ui } from '../../shared/ui';

/** Private full-screen viewer; deliberately separate from the public/product lightbox. */
@Component({
  selector: 'app-product-supplier-agreement-photo-viewer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AuthImage],
  template: `
    @if (open() && current(); as photo) {
      <div
        class="agreement-viewer"
        role="dialog"
        aria-modal="true"
        aria-label="Afspraakfoto voor leverancier"
        (click)="close()"
      >
        <header (click)="$event.stopPropagation()">
          <span class="private-mark">Alleen leverancier · niet online</span>
          <span class="spacer"></span>
          <span class="count">{{ index() + 1 }} / {{ photos().length }}</span>
          <button type="button" [disabled]="downloading()" (click)="download(photo)">
            {{ downloading() ? 'Bezig…' : 'Downloaden' }}
          </button>
          <button type="button" aria-label="Sluiten" (click)="close()">✕</button>
        </header>

        <div class="stage" (click)="$event.stopPropagation()">
          @if (photos().length > 1) {
            <button
              class="nav nav--previous"
              type="button"
              aria-label="Vorige afspraakfoto"
              (click)="step(-1)"
            >
              ‹
            </button>
          }
          <img [appAuthSrc]="photo.viewUrl" [alt]="photo.caption || photo.originalFilename" />
          @if (photos().length > 1) {
            <button
              class="nav nav--next"
              type="button"
              aria-label="Volgende afspraakfoto"
              (click)="step(1)"
            >
              ›
            </button>
          }
        </div>

        <footer (click)="$event.stopPropagation()">
          @if (photo.caption) {
            <p lang="en">{{ photo.caption }}</p>
          }
          <small>{{ photo.originalFilename }}</small>
        </footer>
      </div>
    }
  `,
  styles: `
    .agreement-viewer {
      position: fixed;
      inset: 0;
      z-index: 210;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto;
      background: rgb(20 14 12/0.96);
      backdrop-filter: blur(10px);
      animation: agreement-viewer-in 0.16s ease-out;
    }
    @keyframes agreement-viewer-in {
      from {
        opacity: 0;
      }
    }
    header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: calc(10px + env(safe-area-inset-top)) 12px 10px;
      color: #fff;
    }
    .spacer {
      flex: 1;
    }
    .private-mark {
      padding: 5px 9px;
      border: 1px solid rgb(255 255 255/0.2);
      border-radius: 999px;
      color: #f2dfb9;
      font-size: 11px;
      font-weight: 750;
    }
    .count {
      color: #cfc4bf;
      font-size: 12px;
      font-variant-numeric: tabular-nums;
    }
    button {
      min-height: 38px;
      padding: 7px 12px;
      border: 1px solid rgb(255 255 255/0.24);
      border-radius: 999px;
      background: transparent;
      color: #fff;
      font: inherit;
      font-size: 12.5px;
      cursor: pointer;
    }
    button:disabled {
      opacity: 0.5;
      cursor: wait;
    }
    .stage {
      position: relative;
      display: grid;
      min-height: 0;
      place-items: center;
      padding: 8px;
    }
    .stage img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      border-radius: 7px;
    }
    .nav {
      position: absolute;
      top: 0;
      bottom: 0;
      width: 25%;
      border: 0;
      border-radius: 0;
      font-size: 44px;
    }
    .nav--previous {
      left: 0;
      text-align: left;
    }
    .nav--next {
      right: 0;
      text-align: right;
    }
    footer {
      display: grid;
      gap: 4px;
      justify-items: center;
      padding: 10px 18px calc(16px + env(safe-area-inset-bottom));
      color: #fff;
      text-align: center;
    }
    footer p {
      max-width: 780px;
      font-size: 14px;
      line-height: 1.45;
    }
    footer small {
      color: #a99d98;
      font-size: 11px;
    }
    @media (max-width: 560px) {
      .private-mark {
        max-width: 145px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .count {
        display: none;
      }
      header button {
        padding-inline: 10px;
      }
    }
  `,
})
export class ProductSupplierAgreementPhotoViewer {
  private readonly catalog = inject(CatalogApi);
  private readonly ui = inject(Ui);

  readonly photos = input<ProductSupplierAgreementPhoto[]>([]);
  readonly index = model(-1);
  readonly downloading = signal(false);
  readonly open = computed(() => this.index() >= 0);
  readonly current = computed(() => this.photos()[this.index()] ?? null);

  @HostListener('document:keydown.escape')
  close(): void {
    this.index.set(-1);
  }

  step(direction: number): void {
    const count = this.photos().length;
    if (count) this.index.set((this.index() + direction + count) % count);
  }

  async download(photo: ProductSupplierAgreementPhoto): Promise<void> {
    if (this.downloading()) return;
    this.downloading.set(true);
    try {
      const blob = await this.catalog.photoBlob(photo.downloadUrl);
      saveBlob(blob, photo.originalFilename || 'supplier-agreement-photo.jpg');
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Afspraakfoto downloaden mislukt'), 'err');
    } finally {
      this.downloading.set(false);
    }
  }
}
