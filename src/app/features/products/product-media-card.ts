import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthImage } from '../../core/api/auth-image';
import { saveBlob } from '../../core/api/download';
import { messageOf } from '../../core/api/errors';
import { MediaApi } from '../../core/api/media-api';
import { MediaAssetSummary } from '../../core/api/media-models';
import { PhotoDto } from '../../core/api/models';
import { fileTypeLabel, formatBytes } from '../../shared/format-bytes';
import { PhotoLightbox } from '../../shared/photo-lightbox';
import { Ui } from '../../shared/ui';

/**
 * The files of one product, right on its page: every library asset linked
 * to the product, with upload, enlarge, download and unlink in place. The
 * bytes stay in the central library (Bestanden); this card only links them.
 * The host carries the surrounding card classes of the page it sits on.
 */
@Component({
  selector: 'app-product-media-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AuthImage, PhotoLightbox],
  template: `
    <div class="mc__head">
      <div><h2>Documenten &amp; media</h2><p>{{ summary() }}</p></div>
      <div class="mc__actions">
        <label class="btn btn--sm btn--primary mc__upload" [class.is-busy]="uploading()">
          <input type="file" multiple [disabled]="uploading()" (change)="upload($event)" />
          {{ uploading() ? 'Bezig…' : 'Bestand toevoegen' }}
        </label>
        <a class="btn btn--sm" routerLink="/files">Bestanden ›</a>
      </div>
    </div>
    @if (loading()) {
      <p class="mc__empty">Bestanden laden…</p>
    } @else if (error(); as error) {
      <p class="mc__empty">{{ error }} <button class="linklike" type="button" (click)="reload()">Opnieuw proberen</button></p>
    } @else if (!assets().length) {
      <p class="mc__empty">Nog geen bestanden aan dit product gekoppeld. Voeg hier een foto, tekening of certificaat toe, of koppel een bestaand bestand vanuit <a routerLink="/files">Bestanden</a>.</p>
    } @else {
      <ul class="mc__grid" [class.mc__grid--compact]="compact()">
        @for (asset of assets(); track asset.id) {
          <li class="mc__tile">
            <button class="mc__open" type="button" (click)="open(asset)"
                    [title]="asset.kind === 'IMAGE' ? 'Vergroten' : 'Downloaden'">
              @if (asset.kind === 'IMAGE') {
                <img [appAuthSrc]="media.thumbnailUrl(asset.id)" alt="" loading="lazy" />
              } @else {
                <i class="mc__ext" aria-hidden="true">{{ type(asset) }}</i>
              }
            </button>
            <span class="mc__copy"><b>{{ asset.name }}</b><small>{{ meta(asset) }}</small></span>
            <button class="mc__unlink" type="button" [disabled]="busyId() === asset.id" (click)="unlink(asset)"
                    title="Loskoppelen van dit product (het bestand blijft in Bestanden)" aria-label="Loskoppelen">×</button>
          </li>
        }
      </ul>
    }
    <app-photo-lightbox [photos]="photos()" [(index)]="lightbox" />
  `,
  styles: `
    :host{display:block;min-width:0}
    :host(.info-card){padding:14px 14px 16px}
    .mc__head{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:10px 12px;margin-bottom:12px}
    .mc__head>div:first-child{flex:1 1 180px;min-width:0}
    .mc__head h2{margin:0;font-size:16px;font-weight:700}
    .mc__head p{margin:2px 0 0;color:var(--muted);font-size:12.5px}
    .mc__actions{display:flex;flex:none;flex-wrap:wrap;gap:8px;justify-content:flex-end}
    .mc__upload{position:relative;overflow:hidden;cursor:pointer}
    .mc__upload input{position:absolute;inset:0;opacity:0;cursor:pointer}
    .mc__upload.is-busy{opacity:.7;pointer-events:none}
    .mc__empty{margin:0;color:var(--muted);font-size:13px;line-height:1.5}
    .mc__empty a{color:var(--accent)}
    .mc__grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(148px,1fr));gap:12px;margin:0;padding:0;list-style:none}
    .mc__tile{position:relative;display:grid;gap:6px;min-width:0}
    .mc__open{display:block;width:100%;aspect-ratio:4/3;padding:0;border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--surface-2);cursor:zoom-in}
    .mc__open img{display:block;width:100%;height:100%;object-fit:cover}
    .mc__ext{display:flex;align-items:center;justify-content:center;height:100%;color:var(--accent);font-style:normal;font-size:15px;font-weight:800;letter-spacing:.06em}
    .mc__copy{display:grid;gap:1px;min-width:0}
    .mc__copy b{overflow:hidden;font-size:13px;font-weight:600;text-overflow:ellipsis;white-space:nowrap}
    .mc__copy small{color:var(--muted);font-size:11.5px}
    .mc__unlink{position:absolute;top:6px;right:6px;width:24px;height:24px;border:0;border-radius:50%;background:rgb(20 14 12 / 62%);color:#fff;font-size:16px;line-height:24px;cursor:pointer;opacity:0;transition:opacity .15s}
    .mc__tile:hover .mc__unlink,.mc__tile:focus-within .mc__unlink{opacity:1}
    .mc__grid--compact{grid-template-columns:1fr;gap:8px}
    .mc__grid--compact .mc__tile{grid-template-columns:52px minmax(0,1fr) auto;align-items:center;gap:10px}
    .mc__grid--compact .mc__open{aspect-ratio:1;border-radius:10px}
    .mc__grid--compact .mc__ext{font-size:11px}
    .mc__grid--compact .mc__unlink{position:static;opacity:1;background:var(--surface-2);color:var(--muted)}
    @media(hover:none){.mc__unlink{opacity:1}}
  `,
})
export class ProductMediaCard {
  protected readonly media = inject(MediaApi);
  private readonly ui = inject(Ui);

  readonly productId = input.required<number>();
  /** Phone layout: one file per row instead of a tile grid. */
  readonly compact = input(false);

  readonly assets = signal<MediaAssetSummary[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly uploading = signal(false);
  readonly busyId = signal<number | null>(null);
  readonly lightbox = signal(-1);

  /** Images as the lightbox knows them: the web copy on screen, the original as download. */
  readonly photos = computed<PhotoDto[]>(() => this.assets()
    .filter((asset) => asset.kind === 'IMAGE')
    .map((asset, position) => ({
      id: asset.id,
      familyPhotoId: null,
      origin: 'PRODUCT',
      readOnly: true,
      originalFilename: asset.originalFilename || asset.name,
      contentType: asset.contentType,
      sizeBytes: asset.sizeBytes,
      widthPx: asset.widthPx,
      heightPx: asset.heightPx,
      position,
      url: this.media.fileUrl(asset.id, 'web'),
      downloadUrl: this.media.fileUrl(asset.id, 'original'),
    })));

  readonly summary = computed(() => {
    const count = this.assets().length;
    if (!count) return 'Foto’s, tekeningen en certificaten die bij dit product horen';
    return `${count} bestand${count === 1 ? '' : 'en'} gekoppeld aan dit product · ook te vinden in Bestanden`;
  });

  private loadVersion = 0;

  constructor() {
    effect(() => {
      this.productId();
      untracked(() => void this.reload());
    });
  }

  async reload(): Promise<void> {
    const version = ++this.loadVersion;
    this.loading.set(true);
    this.error.set(null);
    try {
      const assets = await this.media.assets({ targetType: 'PRODUCT', targetId: this.productId(), limit: 200 });
      if (version !== this.loadVersion) return;
      this.assets.set(assets);
    } catch (failure: unknown) {
      if (version !== this.loadVersion) return;
      this.error.set(messageOf(failure, 'Bestanden laden mislukt'));
    } finally {
      if (version === this.loadVersion) this.loading.set(false);
    }
  }

  type(asset: MediaAssetSummary): string {
    return fileTypeLabel(asset.originalFilename || asset.name, asset.contentType) || 'DOC';
  }

  meta(asset: MediaAssetSummary): string {
    return [
      this.type(asset),
      formatBytes(asset.sizeBytes),
      asset.widthPx && asset.heightPx ? `${asset.widthPx} × ${asset.heightPx} px` : '',
    ].filter(Boolean).join(' · ');
  }

  async open(asset: MediaAssetSummary): Promise<void> {
    if (asset.kind === 'IMAGE') {
      this.lightbox.set(this.photos().findIndex((photo) => photo.id === asset.id));
      return;
    }
    this.busyId.set(asset.id);
    try {
      saveBlob(await this.media.download(asset.id), asset.originalFilename || asset.name);
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Downloaden mislukt'), 'err');
    } finally {
      this.busyId.set(null);
    }
  }

  /** Uploads into the library and links each file to this product in one go. */
  async upload(event: Event): Promise<void> {
    const inputElement = event.target as HTMLInputElement;
    const files = Array.from(inputElement.files ?? []);
    inputElement.value = '';
    if (!files.length) return;
    this.uploading.set(true);
    let added = 0;
    try {
      for (const file of files) {
        const result = await this.media.upload(file);
        const alreadyLinked = result.asset.links.some((link) =>
          link.targetType === 'PRODUCT' && link.targetId === this.productId());
        if (!alreadyLinked) {
          await this.media.addLink(result.asset.id, { targetType: 'PRODUCT', targetId: this.productId(), role: 'INTERNAL' });
        }
        added++;
      }
      this.ui.toast(added === 1 ? 'Bestand toegevoegd en gekoppeld' : `${added} bestanden toegevoegd en gekoppeld`);
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Toevoegen mislukt'), 'err');
    } finally {
      this.uploading.set(false);
      void this.reload();
    }
  }

  async unlink(asset: MediaAssetSummary): Promise<void> {
    const link = asset.links.find((item) => item.targetType === 'PRODUCT' && item.targetId === this.productId());
    if (!link) return;
    this.busyId.set(asset.id);
    try {
      await this.media.removeLink(asset.id, link.id);
      this.ui.toast('Losgekoppeld · het bestand blijft in Bestanden');
      await this.reload();
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Loskoppelen mislukt'), 'err');
    } finally {
      this.busyId.set(null);
    }
  }
}
