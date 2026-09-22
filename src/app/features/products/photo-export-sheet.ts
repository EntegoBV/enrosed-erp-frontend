import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { API_BASE } from '../../core/api/api.config';
import { CatalogApi } from '../../core/api/catalog-api';
import { messageOf } from '../../core/api/errors';
import {
  LANGUAGES,
  LanguageCode,
  ProductPhotoExportPhotos,
  ProductPhotoExportResult,
  ProductPhotoExportScope,
} from '../../core/api/models';
import { Sheet, Ui } from '../../shared/ui';
import {
  DEFAULT_PHOTO_EXPORT_REQUEST,
  PHOTO_EXPORT_PHOTO_SETS,
  PHOTO_EXPORT_SCOPES,
  photoExportDownloadHref,
  photoExportExpired,
  photoExportRequest,
  photoExportSummary,
  photoExportValidUntil,
} from './photo-export';

interface PhotoExportProblem {
  title: string;
  message: string;
}

/**
 * Exports the product photos as one ZIP: a folder per product with the
 * original uploads and a price-free LEESMIJ file. The backend first prepares
 * the export and hands out a short-lived link; the browser then downloads the
 * ZIP natively from that link, so it is never held in this app's memory.
 */
@Component({
  selector: 'app-photo-export-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Sheet],
  template: `
    <app-sheet title="Foto’s exporteren" (closed)="close()">
      <div body [attr.aria-busy]="preparing()">
        <p class="intro">
          Originele foto’s in de hoogste kwaliteit, per product een map, met een
          LEESMIJ-bestand. Zonder prijzen.
        </p>

        @if (problem(); as issue) {
          <div class="export-error" role="alert">
            <b>{{ issue.title }}</b><span>{{ issue.message }}</span>
          </div>
        }

        <fieldset class="export-option" [disabled]="preparing()">
          <legend>Producten</legend>
          <div class="chips export-chips" role="group" aria-label="Welke producten">
            @for (choice of scopes; track choice.value) {
              <button class="chip" type="button"
                      [class.active]="scope() === choice.value"
                      [attr.aria-pressed]="scope() === choice.value"
                      (click)="setScope(choice.value)">{{ choice.label }}</button>
            }
          </div>
        </fieldset>

        <fieldset class="export-option" [disabled]="preparing()">
          <legend>Foto’s</legend>
          <div class="chips export-chips" role="group" aria-label="Welke foto’s">
            @for (choice of photoSets; track choice.value) {
              <button class="chip" type="button"
                      [class.active]="photos() === choice.value"
                      [attr.aria-pressed]="photos() === choice.value"
                      (click)="setPhotos(choice.value)">{{ choice.label }}</button>
            }
          </div>
        </fieldset>

        <div class="field export-language">
          <label for="photo-export-language">Taal van het LEESMIJ-bestand</label>
          <select class="select" id="photo-export-language" [disabled]="preparing()"
                  [ngModel]="language()" (ngModelChange)="setLanguage($event)">
            @for (option of languages; track option.code) {
              <option [value]="option.code">{{ option.label }}</option>
            }
          </select>
        </div>

        @if (prepared(); as result) {
          <div class="export-ready" role="status">
            <span class="export-ready__badge" aria-hidden="true">ZIP</span>
            <div class="export-ready__copy">
              <b>{{ summary() }}</b>
              <small class="export-ready__file">{{ result.fileName }}</small>
              @if (validUntil()) {
                <small>
                  @if (started()) {
                    Download gestart. Niets te zien? Tik opnieuw op ZIP downloaden; de link
                    blijft geldig tot {{ validUntil() }}.
                  } @else {
                    Klaar om te downloaden · link geldig tot {{ validUntil() }}
                  }
                </small>
              }
            </div>
          </div>
          @if (!result.productCount) {
            <p class="export-note">Geen producten voor deze keuze; de ZIP bevat alleen het LEESMIJ-bestand.</p>
          } @else if (!result.photoCount) {
            <p class="export-note">Deze producten hebben nog geen foto’s; de ZIP bevat alleen het LEESMIJ-bestand.</p>
          }
        }
      </div>

      <div foot class="sheet-actions">
        <button class="btn" type="button" (click)="close()">Sluiten</button>
        @if (prepared()) {
          <button class="btn btn--primary" type="button" (click)="download()">ZIP downloaden</button>
        } @else {
          <button class="btn btn--primary" type="button" [disabled]="preparing()" (click)="prepare()">
            {{ preparing() ? 'ZIP voorbereiden…' : 'ZIP voorbereiden' }}
          </button>
        }
      </div>
    </app-sheet>
  `,
  styles: `
    :host { display: contents; }
    .intro { margin: 0 0 16px; color: var(--muted); font-size: 14px; line-height: 1.5; }
    .export-option { min-width: 0; margin: 0 0 14px; padding: 0; border: 0; }
    .export-option legend {
      margin-bottom: 7px; padding: 0; color: var(--ink-2); font-size: 12.5px; font-weight: 650;
    }
    /* Wrap instead of scroll: at 375 px the third choice would hide off-screen. */
    .export-chips { flex-wrap: wrap; overflow: visible; margin-bottom: 0; padding-bottom: 0; }
    .export-chips .chip { min-height: 36px; }
    .export-chips .chip:disabled { opacity: .55; cursor: not-allowed; }
    .export-language { margin-bottom: 4px; }
    .export-ready {
      display: flex; align-items: flex-start; gap: 11px; margin-top: 14px; padding: 12px;
      border: 1px solid var(--line); border-radius: 12px; background: var(--surface-2);
    }
    .export-ready__badge {
      flex: none; padding: 5px 7px; border-radius: 6px; background: var(--rose); color: #fff;
      font-size: 10.5px; font-weight: 800; letter-spacing: .04em;
    }
    .export-ready__copy { display: grid; gap: 3px; min-width: 0; }
    .export-ready__copy b { font-size: 14px; font-variant-numeric: tabular-nums; }
    .export-ready__copy small { color: var(--muted); font-size: 12px; line-height: 1.4; }
    .export-ready__file { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .export-note { margin: 8px 2px 0; color: var(--muted); font-size: 12.5px; line-height: 1.45; }
    .export-error {
      display: flex; flex-direction: column; gap: 2px; margin-bottom: 14px; padding: 11px 12px;
      border: 1px solid var(--danger); border-radius: 11px; background: var(--danger-soft);
      color: var(--danger); font-size: 13px; line-height: 1.45;
    }
    .sheet-actions { display: contents; }
  `,
})
export class PhotoExportSheet implements OnDestroy {
  private readonly catalog = inject(CatalogApi);
  private readonly ui = inject(Ui);
  private readonly document = inject(DOCUMENT);

  readonly closed = output<void>();

  readonly scopes = PHOTO_EXPORT_SCOPES;
  readonly photoSets = PHOTO_EXPORT_PHOTO_SETS;
  readonly languages = LANGUAGES;

  readonly scope = signal<ProductPhotoExportScope>(DEFAULT_PHOTO_EXPORT_REQUEST.scope);
  readonly photos = signal<ProductPhotoExportPhotos>(DEFAULT_PHOTO_EXPORT_REQUEST.photos);
  readonly language = signal<LanguageCode>(DEFAULT_PHOTO_EXPORT_REQUEST.language);

  readonly preparing = signal(false);
  readonly prepared = signal<ProductPhotoExportResult | null>(null);
  readonly started = signal(false);
  readonly problem = signal<PhotoExportProblem | null>(null);

  readonly summary = computed(() => {
    const result = this.prepared();
    return result ? photoExportSummary(result) : '';
  });
  readonly validUntil = computed(() => photoExportValidUntil(this.prepared()?.expiresAt));

  /** Bumped on every option change, so a late answer for old options is ignored. */
  private generation = 0;
  private destroyed = false;

  ngOnDestroy(): void {
    this.destroyed = true;
  }

  setScope(value: ProductPhotoExportScope): void {
    if (value === this.scope()) return;
    this.scope.set(value);
    this.resetPrepared();
  }

  setPhotos(value: ProductPhotoExportPhotos): void {
    if (value === this.photos()) return;
    this.photos.set(value);
    this.resetPrepared();
  }

  setLanguage(value: LanguageCode): void {
    if (value === this.language()) return;
    this.language.set(value);
    this.resetPrepared();
  }

  close(): void {
    this.closed.emit();
  }

  async prepare(): Promise<void> {
    if (this.preparing()) return;
    const generation = ++this.generation;
    this.problem.set(null);
    this.preparing.set(true);
    try {
      const result = await this.catalog.preparePhotoExport(photoExportRequest({
        scope: this.scope(),
        photos: this.photos(),
        language: this.language(),
      }));
      if (this.destroyed || generation !== this.generation) return;
      this.started.set(false);
      this.prepared.set(result);
    } catch (failure: unknown) {
      if (this.destroyed || generation !== this.generation) return;
      this.problem.set({
        title: 'ZIP voorbereiden lukte niet.',
        message: messageOf(failure, 'Probeer het over een ogenblik opnieuw.'),
      });
    } finally {
      if (generation === this.generation) this.preparing.set(false);
    }
  }

  /**
   * Starts the browser's own download from the token link: no fetch into a
   * Blob, so even a ZIP of hundreds of megabytes streams straight to disk.
   */
  download(): void {
    const result = this.prepared();
    if (!result) return;
    if (photoExportExpired(result.expiresAt, Date.now())) {
      this.resetPrepared();
      this.problem.set({
        title: 'De downloadlink is verlopen.',
        message: 'Bereid de ZIP opnieuw voor; dat duurt maar even.',
      });
      return;
    }
    const link = this.document.createElement('a');
    link.href = photoExportDownloadHref(API_BASE, result.downloadUrl);
    /* Ignored cross-origin; the backend's Content-Disposition names the file then. */
    link.download = result.fileName;
    link.rel = 'noopener';
    link.hidden = true;
    this.document.body.appendChild(link);
    link.click();
    link.remove();
    this.started.set(true);
    this.ui.toast(`Download gestart · ${this.summary()}`);
  }

  private resetPrepared(): void {
    /* An option changed: a request still in flight belongs to the old choice. */
    this.generation++;
    this.preparing.set(false);
    this.prepared.set(null);
    this.started.set(false);
    this.problem.set(null);
  }
}
