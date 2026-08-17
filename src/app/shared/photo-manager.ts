import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { CatalogApi } from '../core/api/catalog-api';
import { AuthImage } from '../core/api/auth-image';
import { saveBlob } from '../core/api/download';
import { PhotoDto, Product } from '../core/api/models';
import { Ui } from './ui';

/**
 * Fotoreeks van een product.
 *
 * Er is geen maximum en er wordt niets herschaald: het bestand gaat zoals het
 * is naar de server en komt zo ook weer terug. Dat is het verschil tussen een
 * foto die je kan hergebruiken voor drukwerk of een webshop, en een foto die
 * alleen nog in deze app bruikbaar is.
 *
 * De eerste foto is de hoofdfoto en verschijnt in lijsten en op orderregels.
 */
@Component({
  selector: 'app-photo-manager',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AuthImage],
  template: `
    <div class="photos">
      @for (photo of photos(); track photo.id; let i = $index) {
        <figure class="photo" [class.photo--primary]="i === 0">
          <img [appAuthSrc]="photo.url" [alt]="photo.originalFilename" />
          @if (i === 0) {
            <figcaption class="photo__tag">Hoofdfoto</figcaption>
          }
          <div class="photo__actions">
            @if (i > 0) {
              <button class="photo__btn" type="button" title="Naar voren"
                      aria-label="Naar voren" (click)="move(i, -1)">‹</button>
            }
            @if (i < photos().length - 1) {
              <button class="photo__btn" type="button" title="Naar achter"
                      aria-label="Naar achter" (click)="move(i, 1)">›</button>
            }
            <button class="photo__btn" type="button" title="Downloaden"
                    aria-label="Downloaden" (click)="download(photo)">⤓</button>
            <button class="photo__btn photo__btn--danger" type="button" title="Verwijderen"
                    aria-label="Verwijderen" (click)="remove(photo)">✕</button>
          </div>
          <figcaption class="photo__meta">
            {{ photo.widthPx }}×{{ photo.heightPx }} · {{ sizeLabel(photo.sizeBytes) }}
          </figcaption>
        </figure>
      }

      <label class="photo photo--add">
        @if (busy()) {
          <span class="tiny muted">Bezig…</span>
        } @else {
          <span class="photo--add__icon">+</span>
          <span class="tiny muted">Foto's</span>
        }
        <input type="file" accept="image/*" multiple hidden [disabled]="busy()"
               (change)="upload($event)" />
      </label>
    </div>

    <p class="tiny muted mt-8">
      {{ photos().length }} foto('s), onbeperkt. Bestanden worden in volle kwaliteit bewaard —
      niets wordt verkleind of hercomprimeerd — en zijn met ⤓ weer te downloaden zoals ze
      aangeleverd zijn.
    </p>
  `,
  styles: `
    .photos {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
      gap: 10px;
    }
    .photo {
      position: relative;
      margin: 0;
      aspect-ratio: 1;
      border-radius: var(--r-sm);
      overflow: hidden;
      border: 1px solid var(--line-strong);
      background: var(--surface-2);
    }
    .photo--primary { border-color: var(--rose); box-shadow: 0 0 0 2px var(--rose-soft); }
    .photo img { width: 100%; height: 100%; object-fit: cover; }
    .photo__tag {
      position: absolute;
      inset: auto 0 0 0;
      background: rgb(176 31 63 / 92%);
      color: #fff;
      font-size: 10px;
      font-weight: 700;
      text-align: center;
      padding: 2px;
    }
    .photo__meta {
      position: absolute;
      inset: auto 0 0 0;
      background: rgb(26 22 20 / 62%);
      color: #fff;
      font-size: 9.5px;
      text-align: center;
      padding: 2px;
    }
    .photo--primary .photo__meta { display: none; }
    .photo__actions { position: absolute; inset: 4px 4px auto auto; display: flex; gap: 3px; }
    .photo__btn {
      width: 24px; height: 24px;
      border-radius: 6px; border: 0;
      background: rgb(26 22 20 / 70%);
      color: #fff; font-size: 13px; line-height: 1;
      cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0;
    }
    .photo__btn--danger { background: rgb(180 52 42 / 90%); }
    .photo--add {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 2px; cursor: pointer; border-style: dashed;
    }
    .photo--add__icon { font-size: 24px; color: var(--muted); line-height: 1; }
  `,
})
export class PhotoManager {
  private readonly catalog = inject(CatalogApi);
  private readonly ui = inject(Ui);

  readonly productId = input.required<number>();
  readonly photos = input.required<PhotoDto[]>();
  readonly changed = output<Product>();

  readonly busy = signal(false);

  async upload(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (!files.length) return;

    this.busy.set(true);
    try {
      let product: Product | null = null;
      for (const file of files) {
        product = await this.catalog.uploadPhoto(this.productId(), file);
      }
      if (product) this.changed.emit(product);
      this.ui.toast(`${files.length} foto('s) toegevoegd`);
    } catch {
      this.ui.toast('Uploaden mislukt', 'err');
    } finally {
      this.busy.set(false);
    }
  }

  async remove(photo: PhotoDto): Promise<void> {
    this.ui.confirm(
      {
        title: 'Foto verwijderen',
        message: `<b>${photo.originalFilename}</b> verwijderen?`,
        confirmLabel: 'Verwijderen',
        danger: true,
      },
      async () => {
        this.changed.emit(await this.catalog.deletePhoto(this.productId(), photo.id));
        this.ui.toast('Foto verwijderd');
      },
    );
  }

  async move(index: number, direction: -1 | 1): Promise<void> {
    const order = this.photos().map((photo) => photo.id);
    const target = index + direction;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    this.changed.emit(await this.catalog.reorderPhotos(this.productId(), order));
  }

  async download(photo: PhotoDto): Promise<void> {
    const blob = await this.catalog.photoBlob(photo.downloadUrl);
    saveBlob(blob, photo.originalFilename);
  }

  sizeLabel(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' kB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }
}
