import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { CatalogApi } from '../core/api/catalog-api';
import { AuthImage } from '../core/api/auth-image';
import { saveBlob } from '../core/api/download';
import { messageOf } from '../core/api/errors';
import { PhotoDto, Product } from '../core/api/models';
import { Ui } from './ui';

const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
const PHOTO_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

interface PendingPhoto {
  id: number;
  file: File;
  previewUrl: string;
  status: 'queued' | 'uploading' | 'failed';
  error: string | null;
}

export interface PendingPhotoUploadResult {
  uploaded: number;
  remaining: number;
}

/**
 * A product's photo series.
 *
 * No rescaling: the file goes to the server as it is and comes back the
 * same. That is the difference between a photo reusable for print or a
 * webshop, and one only usable inside this app.
 *
 * The first photo is the primary one and appears in lists and on order
 * lines.
 */
@Component({
  selector: 'app-photo-manager',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AuthImage],
  template: `
    <div class="photo-gallery">
      @for (photo of photos(); track photo.id; let i = $index) {
        <figure class="photo-card" [class.photo-card--primary]="i === 0">
          <div class="photo-card__preview">
            <img [appAuthSrc]="photo.url" [alt]="photo.originalFilename" />
            @if (i === 0) {
              <span class="photo-card__primary">Hoofdfoto</span>
            }
          </div>

          <figcaption class="photo-card__caption">
            <span class="photo-card__name">{{ photo.originalFilename }}</span>
            <span class="photo-card__meta">
              @if (photo.widthPx !== null && photo.heightPx !== null) {
                {{ photo.widthPx }} × {{ photo.heightPx }} px ·
              }
              {{ sizeLabel(photo.sizeBytes) }}
            </span>
          </figcaption>

          <div class="photo-card__actions" role="group"
               [attr.aria-label]="'Acties voor ' + photo.originalFilename">
            @if (i > 0) {
              <button class="photo-action" type="button" title="Eerder in de reeks"
                      [disabled]="busy()"
                      [attr.aria-label]="photo.originalFilename + ' eerder in de reeks'"
                      (click)="move(i, -1)"><span aria-hidden="true">←</span> Eerder</button>
            }
            @if (i < photos().length - 1) {
              <button class="photo-action" type="button" title="Later in de reeks"
                      [disabled]="busy()"
                      [attr.aria-label]="photo.originalFilename + ' later in de reeks'"
                      (click)="move(i, 1)">Later <span aria-hidden="true">→</span></button>
            }
            <button class="photo-action" type="button"
                    [disabled]="busy()"
                    [attr.aria-label]="photo.originalFilename + ' downloaden'"
                    (click)="download(photo)"><span aria-hidden="true">↓</span> Download</button>
            <button class="photo-action photo-action--danger" type="button"
                    [disabled]="busy()"
                    [attr.aria-label]="photo.originalFilename + ' verwijderen'"
                    (click)="remove(photo)"><span aria-hidden="true">×</span> Verwijder</button>
          </div>
        </figure>
      }

      @for (pendingPhoto of pendingPhotos(); track pendingPhoto.id; let i = $index) {
        <figure class="photo-card photo-card--pending"
                [class.photo-card--primary]="photos().length === 0 && i === 0"
                [class.photo-card--failed]="pendingPhoto.status === 'failed'">
          <div class="photo-card__preview">
            <img [src]="pendingPhoto.previewUrl" [alt]="pendingPhoto.file.name" />
            @if (photos().length === 0 && i === 0) {
              <span class="photo-card__primary">Hoofdfoto</span>
            }
            <span class="photo-card__pending-state"
                  [class.photo-card__pending-state--failed]="pendingPhoto.status === 'failed'">
              @switch (pendingPhoto.status) {
                @case ('uploading') { Uploaden… }
                @case ('failed') { Niet geüpload }
                @default { Klaar om op te slaan }
              }
            </span>
          </div>

          <figcaption class="photo-card__caption">
            <span class="photo-card__name">{{ pendingPhoto.file.name }}</span>
            <span class="photo-card__meta">{{ sizeLabel(pendingPhoto.file.size) }}</span>
            @if (pendingPhoto.error) {
              <span class="photo-card__error">{{ pendingPhoto.error }}</span>
            }
          </figcaption>

          <div class="photo-card__actions" role="group"
               [attr.aria-label]="'Acties voor ' + pendingPhoto.file.name">
            @if (i > 0) {
              <button class="photo-action" type="button" [disabled]="busy()"
                      [attr.aria-label]="pendingPhoto.file.name + ' eerder in de reeks'"
                      (click)="movePending(i, -1)"><span aria-hidden="true">←</span> Eerder</button>
            }
            @if (i < pendingPhotos().length - 1) {
              <button class="photo-action" type="button" [disabled]="busy()"
                      [attr.aria-label]="pendingPhoto.file.name + ' later in de reeks'"
                      (click)="movePending(i, 1)">Later <span aria-hidden="true">→</span></button>
            }
            @if (i === 0 && pendingPhoto.status !== 'uploading' && productId() !== null) {
              <button class="photo-action photo-action--retry" type="button" [disabled]="busy()"
                      (click)="retryPendingUploads()">
                {{ pendingPhoto.status === 'failed' ? 'Opnieuw proberen' : 'Nu uploaden' }}
              </button>
            }
            <button class="photo-action photo-action--danger" type="button" [disabled]="busy()"
                    [attr.aria-label]="pendingPhoto.file.name + ' uit de selectie verwijderen'"
                    (click)="removePending(pendingPhoto.id)">
              <span aria-hidden="true">×</span> Verwijder
            </button>
          </div>
        </figure>
      }

      <label class="photo-add" [class.photo-add--busy]="busy()">
        @if (busy()) {
          <span class="photo-add__icon photo-add__icon--busy" aria-hidden="true">…</span>
          <span><b>Foto's uploaden…</b><small>Even geduld</small></span>
        } @else {
          <span class="photo-add__icon" aria-hidden="true">+</span>
          <span>
            <b>Foto's toevoegen</b>
            <small>
              @if (productId() === null) {
                Kies nu; uploaden gebeurt bij product aanmaken
              } @else {
                Selecteer één of meerdere bestanden
              }
            </small>
          </span>
        }
        <input class="photo-add__input" type="file"
               accept="image/jpeg,image/png,image/gif,image/webp" multiple
               [disabled]="busy()"
               (change)="upload($event)" />
      </label>
    </div>

    <p class="photo-help">
      De eerste foto is de hoofdfoto voor catalogus, website en orderapp.
      JPEG, PNG, GIF of WebP · max. 25 MB per foto · originelen blijven in volledige kwaliteit.
    </p>
  `,
  styles: `
    .photo-gallery {
      display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px;
    }
    .photo-card {
      min-width: 0; margin: 0; overflow: hidden;
      border: 1px solid var(--line); border-radius: var(--r-sm);
      background: var(--surface); box-shadow: 0 2px 10px rgb(26 22 20 / 5%);
    }
    .photo-card--primary { border-color: var(--rose-line); }
    .photo-card--pending { border-style: dashed; }
    .photo-card--failed { border-color: color-mix(in srgb, var(--danger) 55%, var(--line)); }
    .photo-card__preview {
      position: relative; aspect-ratio: 4 / 3; overflow: hidden;
      background: linear-gradient(145deg, var(--surface-2), #fff);
    }
    .photo-card__preview img { width: 100%; height: 100%; object-fit: contain; display: block; }
    .photo-card__primary {
      position: absolute; left: 10px; top: 10px;
      padding: 5px 9px; border-radius: 999px;
      background: rgb(176 31 63 / 92%); color: #fff;
      box-shadow: 0 3px 10px rgb(26 22 20 / 18%);
      font-size: 10px; font-weight: 750; letter-spacing: .04em; text-transform: uppercase;
    }
    .photo-card__pending-state {
      position: absolute; right: 9px; bottom: 9px;
      padding: 5px 8px; border: 1px solid var(--rose-line); border-radius: 999px;
      background: rgb(255 255 255 / 92%); color: var(--rose);
      font-size: 10px; font-weight: 750;
    }
    .photo-card__pending-state--failed {
      border-color: color-mix(in srgb, var(--danger) 35%, var(--line));
      background: color-mix(in srgb, var(--danger) 8%, #fff); color: var(--danger);
    }
    .photo-card__caption {
      display: flex; flex-direction: column; gap: 2px; min-width: 0; padding: 10px 12px 8px;
    }
    .photo-card__name {
      overflow: hidden; color: var(--ink-2); font-size: 13px; font-weight: 700;
      text-overflow: ellipsis; white-space: nowrap;
    }
    .photo-card__meta { color: var(--muted); font-size: 11px; }
    .photo-card__error { margin-top: 3px; color: var(--danger); font-size: 11px; line-height: 1.35; }
    .photo-card__actions {
      display: flex; flex-wrap: wrap; gap: 1px;
      padding: 0 6px 6px; border-top: 1px solid var(--line);
    }
    .photo-action {
      flex: 1 1 108px; min-height: 44px; padding: 8px 6px;
      border: 0; border-radius: 8px; background: transparent;
      color: var(--ink-2); font: inherit; font-size: 11.5px; font-weight: 650; cursor: pointer;
    }
    .photo-action:active { background: var(--surface-2); }
    .photo-action:disabled { cursor: wait; opacity: .55; }
    .photo-action--retry { color: var(--rose); }
    .photo-action--danger { color: var(--danger); }
    .photo-add {
      display: flex; align-items: center; justify-content: center; gap: 12px;
      min-height: 88px; padding: 14px;
      border: 1.5px dashed var(--rose-mid); border-radius: var(--r-sm);
      background: var(--rose-soft); color: var(--ink-2); cursor: pointer;
    }
    .photo-add:hover { border-color: var(--rose); background: color-mix(in srgb, var(--rose-soft) 82%, #fff); }
    .photo-add:focus-within { outline: 3px solid var(--rose-line); outline-offset: 2px; }
    .photo-add--busy { cursor: wait; opacity: .72; }
    .photo-add__input {
      position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
      overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
    }
    .photo-add__icon {
      display: grid; flex: 0 0 auto; width: 42px; height: 42px; place-items: center;
      border-radius: 50%; background: var(--rose); color: #fff; font-size: 25px; line-height: 1;
    }
    .photo-add__icon--busy { font-size: 18px; }
    .photo-add > span:last-of-type { display: flex; flex-direction: column; gap: 2px; }
    .photo-add b { font-size: 13.5px; }
    .photo-add small { color: var(--muted); font-size: 11.5px; }
    .photo-help { margin: 10px 2px 0; color: var(--muted); font-size: 11.5px; line-height: 1.45; }

    @media (min-width: 640px) {
      .photo-gallery { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .photo-card--primary { grid-column: 1 / -1; }
      .photo-card--primary .photo-card__preview { aspect-ratio: 16 / 8; }
      .photo-add { min-height: 130px; }
    }

    @media (min-width: 1100px) {
      .photo-gallery { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .photo-card--primary { grid-column: span 2; grid-row: span 2; }
      .photo-card--primary .photo-card__preview { aspect-ratio: 4 / 3; }
    }
  `,
})
export class PhotoManager {
  private readonly catalog = inject(CatalogApi);
  private readonly ui = inject(Ui);
  private readonly destroyRef = inject(DestroyRef);
  private nextPendingId = 0;

  readonly productId = input<number | null>(null);
  readonly photos = input.required<PhotoDto[]>();
  readonly changed = output<Product>();

  readonly busy = signal(false);
  readonly pendingPhotos = signal<PendingPhoto[]>([]);
  readonly pendingCount = computed(() => this.pendingPhotos().length);

  constructor() {
    this.destroyRef.onDestroy(() => {
      for (const photo of this.pendingPhotos()) URL.revokeObjectURL(photo.previewUrl);
    });
  }

  async upload(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (!files.length) return;

    const accepted = this.acceptedFiles(files);
    if (!accepted.length) return;
    this.queue(accepted);

    const productId = this.productId();
    if (productId === null) {
      this.ui.toast(`${accepted.length} foto('s) klaar om mee op te slaan`, 'ok');
      return;
    }

    const result = await this.uploadPending(productId);
    this.reportUploadResult(result);
  }

  /** Uploads the local queue in order after the product has a server id. */
  async uploadPending(productId: number): Promise<PendingPhotoUploadResult> {
    if (this.busy()) {
      return { uploaded: 0, remaining: this.pendingCount() };
    }

    this.busy.set(true);
    let uploaded = 0;
    try {
      while (this.pendingPhotos().length) {
        const pendingPhoto = this.pendingPhotos()[0];
        this.updatePending(pendingPhoto.id, { status: 'uploading', error: null });
        try {
          const product = await this.catalog.uploadPhoto(productId, pendingPhoto.file);
          this.changed.emit(product);
          this.discardPending(pendingPhoto.id);
          uploaded++;
        } catch (failure: unknown) {
          this.updatePending(pendingPhoto.id, {
            status: 'failed',
            error: messageOf(failure, 'Uploaden mislukt. Controleer het bestand en probeer opnieuw.'),
          });
          break;
        }
      }
    } finally {
      this.busy.set(false);
    }

    return { uploaded, remaining: this.pendingCount() };
  }

  async retryPendingUploads(): Promise<void> {
    const productId = this.productId();
    if (productId === null) return;
    this.reportUploadResult(await this.uploadPending(productId));
  }

  removePending(id: number): void {
    if (!this.busy()) this.discardPending(id);
  }

  movePending(index: number, direction: -1 | 1): void {
    if (this.busy()) return;
    const target = index + direction;
    const pending = [...this.pendingPhotos()];
    if (target < 0 || target >= pending.length) return;
    [pending[index], pending[target]] = [pending[target], pending[index]];
    this.pendingPhotos.set(pending);
  }

  async remove(photo: PhotoDto): Promise<void> {
    if (this.busy()) return;
    const productId = this.productId();
    if (productId === null) return;
    this.ui.confirm(
      {
        title: 'Foto verwijderen',
        message: `<b>${photo.originalFilename}</b> verwijderen?`,
        confirmLabel: 'Verwijderen',
        danger: true,
      },
      async () => {
        if (this.busy()) return;
        this.busy.set(true);
        try {
          this.changed.emit(await this.catalog.deletePhoto(productId, photo.id));
          this.ui.toast('Foto verwijderd');
        } catch (failure: unknown) {
          this.ui.toast(messageOf(failure, 'Foto verwijderen mislukt'), 'err');
        } finally {
          this.busy.set(false);
        }
      },
    );
  }

  async move(index: number, direction: -1 | 1): Promise<void> {
    if (this.busy()) return;
    const productId = this.productId();
    if (productId === null) return;
    const order = this.photos().map((photo) => photo.id);
    const target = index + direction;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    this.busy.set(true);
    try {
      this.changed.emit(await this.catalog.reorderPhotos(productId, order));
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Volgorde aanpassen mislukt'), 'err');
    } finally {
      this.busy.set(false);
    }
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

  private acceptedFiles(files: File[]): File[] {
    const known = new Set(this.pendingPhotos().map(({ file }) => this.fileKey(file)));
    const accepted: File[] = [];
    let invalid = 0;
    let tooLarge = 0;
    let duplicate = 0;

    for (const file of files) {
      if (!PHOTO_CONTENT_TYPES.has(file.type.toLowerCase()) || file.size === 0) {
        invalid++;
        continue;
      }
      if (file.size > MAX_PHOTO_BYTES) {
        tooLarge++;
        continue;
      }
      const key = this.fileKey(file);
      if (known.has(key)) {
        duplicate++;
        continue;
      }
      known.add(key);
      accepted.push(file);
    }

    const problems = [
      invalid ? `${invalid} ongeldig bestand` : '',
      tooLarge ? `${tooLarge} foto boven 25 MB` : '',
      duplicate ? `${duplicate} dubbele foto` : '',
    ].filter(Boolean);
    if (problems.length) this.ui.toast(`${problems.join(' · ')} overgeslagen`, 'err');
    return accepted;
  }

  private queue(files: File[]): void {
    const additions = files.map((file): PendingPhoto => ({
      id: ++this.nextPendingId,
      file,
      previewUrl: URL.createObjectURL(file),
      status: 'queued',
      error: null,
    }));
    this.pendingPhotos.update((pending) => [...pending, ...additions]);
  }

  private discardPending(id: number): void {
    const pendingPhoto = this.pendingPhotos().find((photo) => photo.id === id);
    if (!pendingPhoto) return;
    URL.revokeObjectURL(pendingPhoto.previewUrl);
    this.pendingPhotos.update((pending) => pending.filter((photo) => photo.id !== id));
  }

  private updatePending(id: number, changes: Partial<Pick<PendingPhoto, 'status' | 'error'>>): void {
    this.pendingPhotos.update((pending) => pending.map((photo) =>
      photo.id === id ? { ...photo, ...changes } : photo));
  }

  private fileKey(file: File): string {
    return `${file.name}\u0000${file.size}\u0000${file.lastModified}\u0000${file.type}`;
  }

  private reportUploadResult(result: PendingPhotoUploadResult): void {
    if (result.remaining) {
      const prefix = result.uploaded ? `${result.uploaded} toegevoegd; ` : '';
      this.ui.toast(`${prefix}${result.remaining} foto('s) nog niet geüpload`, 'err');
    } else if (result.uploaded) {
      this.ui.toast(`${result.uploaded} foto('s) toegevoegd`, 'ok');
    }
  }
}
