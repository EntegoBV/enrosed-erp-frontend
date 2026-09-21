import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { API_BASE } from '../../core/api/api.config';
import { CatalogApi } from '../../core/api/catalog-api';
import { saveBlob } from '../../core/api/download';
import { messageOf } from '../../core/api/errors';
import { PhotoDto, Product, ProductFamily } from '../../core/api/models';
import { formatBytes } from '../../shared/format-bytes';
import {
  CataloguePhotoImportItem, CataloguePhotoImportManifest, assertImportUnchanged,
  familyImportSnapshot, isOwnPhoto, parseCataloguePhotoManifest, photoSha256,
  validateTransparentPhoto, verifyPhotoImportIdentity,
} from './catalogue-photo-import-validation';

interface ImportRow {
  item: CataloguePhotoImportItem;
  file: File;
  preview: string;
  product: Product;
  family: ProductFamily;
  existingPhotoId: number | null;
  photoId: number | null;
  state: 'ready' | 'running' | 'done' | 'error';
  note: string;
}

/** Uses the ordinary authenticated media endpoints; never a second import/authentication path. */
@Component({
  selector: 'app-catalogue-photo-import',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <details class="photo-import">
      <summary>Transparante catalogusfoto’s in één keer toevoegen</summary>
      <div class="photo-import__body">
        <p>Selecteer een gecontroleerd manifest en de bijbehorende PNG-bestanden. Elke foto wordt aan de genoemde variant toegevoegd en als catalogusfoto gekozen. Bestaande foto’s, websitekeuzes en de aparte overzichts- en detailkeuzes blijven behouden.</p>
        <p class="photo-import__environment">ERP-omgeving: {{ apiBase }}</p>
        <div class="photo-import__files">
          <label>1. Manifest (JSON)<input type="file" accept=".json,application/json" [disabled]="working() || disabled()" (change)="chooseManifest($event)" /></label>
          <label>2. PNG-foto’s<input type="file" multiple accept=".png,image/png" [disabled]="working() || disabled()" (change)="chooseFiles($event)" /></label>
        </div>
        <p class="photo-import__hint">{{ manifestFile()?.name || 'Nog geen manifest geselecteerd' }} · {{ files().length }} fotobestanden geselecteerd</p>
        <div class="photo-import__actions">
          <button type="button" class="btn" [disabled]="working() || disabled() || !manifestFile() || !files().length" (click)="preflight()">Alles controleren</button>
          <button type="button" class="btn btn--primary" [disabled]="!ready() || working() || disabled()" (click)="run()">{{ rows().length }} catalogusfoto’s toevoegen</button>
          @if (phase() === 'importing') { <button type="button" class="btn" [disabled]="stopRequested()" (click)="stopRequested.set(true)">{{ stopRequested() ? 'Stopt na deze foto…' : 'Stop na deze foto' }}</button> }
          @if (rows().length) { <button type="button" class="btn" [disabled]="working()" (click)="downloadReport()">Verslag downloaden</button> }
        </div>
        <p class="photo-import__status" role="status" aria-live="polite">{{ status() }}</p>
        @if (error()) { <p class="photo-import__error" role="alert">{{ error() }}</p> }
        @if (rows().length) {
          <ul class="photo-import__rows" aria-label="Gecontroleerde catalogusfoto’s">
            @for (row of rows(); track row.item.productId) {
              <li><img [src]="row.preview" [alt]="row.item.sku + ' · ' + row.item.colour" loading="lazy" />
                <div><strong>{{ row.item.sku }} · {{ row.item.colour }}</strong><small>Product {{ row.item.productId }} · Reeks {{ row.item.familyId }} · {{ row.item.width }} × {{ row.item.height }} px · {{ bytes(row.file.size) }}</small><small>{{ row.item.filename }}</small><span [class.photo-import__error]="row.state === 'error'">{{ row.note }}</span></div>
              </li>
            }
          </ul>
        }
      </div>
    </details>
  `,
  styles: `
    :host { display: block; min-width: 0; margin-bottom: 20px; }
    .photo-import { border: 1px solid var(--line); border-radius: 12px; background: var(--surface); }
    summary { cursor: pointer; padding: 16px; font-size: 13px; font-weight: 650; }
    summary:focus-visible { outline: 2px solid var(--accent, #8f3446); outline-offset: 3px; }
    .photo-import__body { padding: 0 16px 16px; }
    p { font-size: 12px; line-height: 1.6; margin: 0 0 12px; }
    .photo-import__files { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
    label { display: grid; gap: 8px; font-size: 12px; font-weight: 600; min-width: 0; }
    input { max-width: 100%; min-width: 0; font-size: 12px; min-height: 44px; }
    .photo-import__hint, .photo-import__environment, small { color: var(--muted); overflow-wrap: anywhere; }
    .photo-import__actions { display: flex; flex-wrap: wrap; gap: 10px; margin: 12px 0; }
    button { min-height: 44px; white-space: normal; }
    .photo-import__error { color: var(--danger, #a12732); }
    .photo-import__rows { list-style: none; padding: 0; margin: 16px 0 0; display: grid; gap: 12px; max-height: 520px; overflow-y: auto; }
    li { display: grid; grid-template-columns: 80px minmax(0, 1fr); gap: 12px; align-items: center; }
    li img { width: 80px; height: 80px; object-fit: contain; border: 1px solid var(--line); border-radius: 6px; background: repeating-conic-gradient(#eee 0% 25%, #fff 0% 50%) 0 0 / 16px 16px; }
    li div { display: grid; gap: 4px; font-size: 12px; min-width: 0; overflow-wrap: anywhere; }
    small { font-size: 11px; }
    @media(max-width: 560px) { .photo-import__files { grid-template-columns: 1fr; } input { font-size: 16px; } }
  `,
})
export class CataloguePhotoImport {
  private readonly catalog = inject(CatalogApi);
  readonly disabled = input(false);
  readonly workingChange = output<boolean>();
  readonly completed = output<void>();
  readonly apiBase = API_BASE;
  readonly bytes = formatBytes;
  readonly manifestFile = signal<File | null>(null);
  readonly files = signal<File[]>([]);
  readonly rows = signal<ImportRow[]>([]);
  readonly phase = signal<'idle' | 'checking' | 'ready' | 'importing' | 'finished'>('idle');
  readonly working = computed(() => this.phase() === 'checking' || this.phase() === 'importing');
  readonly ready = computed(() => this.phase() === 'ready' && this.rows().length > 0);
  readonly error = signal<string | null>(null);
  readonly status = signal('Controleer eerst alle bestanden. Er is nog niets opgeslagen.');
  readonly stopRequested = signal(false);
  private manifest: CataloguePhotoImportManifest | null = null;
  private destroyed = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => { this.destroyed = true; this.stopRequested.set(true); this.releasePreviews(); });
  }

  chooseManifest(event: Event): void {
    this.reset();
    this.manifestFile.set((event.target as HTMLInputElement).files?.[0] ?? null);
  }

  chooseFiles(event: Event): void {
    this.reset();
    this.files.set(Array.from((event.target as HTMLInputElement).files ?? []));
  }

  private reset(): void {
    this.releasePreviews();
    this.rows.set([]);
    this.manifest = null;
    this.error.set(null);
    this.phase.set('idle');
    this.status.set('Controleer eerst alle bestanden. Er is nog niets opgeslagen.');
  }

  private releasePreviews(): void { this.rows().forEach(row => URL.revokeObjectURL(row.preview)); }
  private failure(error: unknown): string { return error instanceof Error ? error.message : messageOf(error, 'De controle is gestopt. Probeer opnieuw.'); }
  private setWorking(phase: 'checking' | 'importing'): void { this.phase.set(phase); this.workingChange.emit(true); }

  async preflight(): Promise<void> {
    if (this.working() || this.disabled()) return;
    const manifestFile = this.manifestFile();
    if (!manifestFile) return;
    this.reset();
    this.setWorking('checking');
    try {
      if (manifestFile.size > 1_000_000) throw new Error('Het manifest is te groot (maximaal 1 MB).');
      this.manifest = parseCataloguePhotoManifest(JSON.parse(await manifestFile.text()), API_BASE);
      const files = new Map(this.files().map(file => [file.name, file]));
      if (files.size !== this.files().length || files.size !== this.manifest.items.length
        || this.manifest.items.some(item => !files.has(item.filename))) {
        throw new Error('Selecteer precies alle PNG-bestanden uit het manifest, zonder dubbele bestandsnamen.');
      }
      const families = new Map<number, ProductFamily>();
      for (const [index, item] of this.manifest.items.entries()) {
        if (this.destroyed) throw new Error('Controle onderbroken.');
        this.status.set(`${index + 1}/${this.manifest.items.length}: bestand, transparantie en ERP-koppeling controleren…`);
        const file = files.get(item.filename)!;
        await validateTransparentPhoto(file, item);
        const product = await this.catalog.product(item.productId);
        const family = families.get(item.familyId) ?? await this.catalog.productFamily(item.familyId);
        families.set(item.familyId, family);
        verifyPhotoImportIdentity(item, product, family);
        const existing = await this.findExisting(product, item, file.size);
        this.rows.update(rows => [...rows, {
          item, file, product, family, preview: URL.createObjectURL(file),
          existingPhotoId: existing?.id ?? null, photoId: existing?.id ?? null, state: 'ready',
          note: existing ? 'Identieke foto staat al in het ERP; wordt hergebruikt.' : 'Transparantie, bestand en variant gecontroleerd.',
        }]);
      }
      this.phase.set('ready');
      this.status.set(`${this.rows().length} foto’s gecontroleerd. Bekijk de voorbeelden en start de import.`);
    } catch (error) {
      this.phase.set('idle');
      this.error.set(this.failure(error));
      this.status.set('Controle gestopt. Er zijn geen wijzigingen opgeslagen.');
    } finally {
      this.workingChange.emit(false);
    }
  }

  private async findExisting(product: Product, item: CataloguePhotoImportItem, size: number): Promise<PhotoDto | undefined> {
    for (const photo of product.photos.filter(isOwnPhoto)) {
      if (photo.sizeBytes !== size && photo.originalFilename !== item.filename) continue;
      const hash = photo.sizeBytes === size ? await photoSha256(await this.catalog.photoBlob(photo.downloadUrl)) : null;
      if (hash === item.sha256) return photo;
      if (photo.originalFilename === item.filename) throw new Error(`${item.filename}: er bestaat al een andere foto met deze bestandsnaam.`);
    }
    return undefined;
  }

  private updateRow(productId: number, values: Partial<ImportRow>): void {
    this.rows.update(rows => rows.map(row => row.item.productId === productId ? { ...row, ...values } : row));
  }

  async run(): Promise<void> {
    if (!this.ready() || this.disabled() || this.working()) return;
    this.setWorking('importing');
    this.error.set(null);
    this.stopRequested.set(false);
    let activeId: number | null = null;
    try {
      for (const row of this.rows()) {
        if (this.stopRequested() || this.destroyed) break;
        activeId = row.item.productId;
        this.updateRow(activeId, { state: 'running', note: 'Opnieuw controleren en veilig toevoegen…' });
        const before = await this.catalog.product(activeId);
        const familyBefore = await this.catalog.productFamily(row.item.familyId);
        verifyPhotoImportIdentity(row.item, before, familyBefore);
        assertImportUnchanged(row.product, before);
        if (familyImportSnapshot(row.family) !== familyImportSnapshot(familyBefore)) {
          throw new Error(`Reeks ${row.item.familyId} is tussentijds gewijzigd. Controleer de batch opnieuw.`);
        }
        let photo = before.photos.find(candidate => candidate.id === row.existingPhotoId);
        if (!photo) {
          const uploaded = await this.catalog.uploadPhoto(activeId, row.file);
          const priorIds = new Set(before.photos.map(candidate => candidate.id));
          const added = uploaded.photos.filter(candidate => !priorIds.has(candidate.id) && isOwnPhoto(candidate));
          if (added.length !== 1) throw new Error(`${row.item.filename}: de nieuwe foto kon niet eenduidig worden vastgesteld.`);
          photo = added[0];
          this.updateRow(activeId, { photoId: photo.id });
          assertImportUnchanged(before, uploaded, photo.id);
        }
        if (photo.widthPx !== row.item.width || photo.heightPx !== row.item.height
          || photo.sizeBytes !== row.file.size || photo.contentType !== 'image/png'
          || await photoSha256(await this.catalog.photoBlob(photo.downloadUrl)) !== row.item.sha256) {
          throw new Error(`${row.item.filename}: de opgeslagen originele bytes zijn niet gelijk; cataloguskeuze niet gewijzigd.`);
        }
        if (!(photo.leadFor ?? []).includes('CATALOGUE')) {
          await this.catalog.setPhotoLead(activeId, photo.id, 'CATALOGUE', true);
        }
        const after = await this.catalog.product(activeId);
        const familyAfter = await this.catalog.productFamily(row.item.familyId);
        assertImportUnchanged(before, after, photo.id);
        if (familyImportSnapshot(familyBefore) !== familyImportSnapshot(familyAfter)) {
          throw new Error(`Reeks ${row.item.familyId}: reeksgegevens of websitefoto’s zijn gewijzigd; batch gestopt.`);
        }
        const leads = after.photos.filter(candidate => (candidate.leadFor ?? []).includes('CATALOGUE'));
        if (leads.length !== 1 || leads[0].id !== photo.id) throw new Error(`Product ${activeId}: cataloguskeuze is niet bevestigd.`);
        this.updateRow(activeId, { state: 'done', photoId: photo.id, note: `Catalogusfoto ${photo.id} opgeslagen; oorspronkelijke foto’s en websitekeuzes behouden.` });
        this.status.set(`${this.rows().filter(candidate => candidate.state === 'done').length}/${this.rows().length} catalogusfoto’s opgeslagen en teruggelezen.`);
        activeId = null;
      }
      if (this.stopRequested()) this.status.update(status => `${status} Gestopt; controleer opnieuw om te hervatten.`);
    } catch (error) {
      const message = this.failure(error);
      this.error.set(message);
      if (activeId !== null) this.updateRow(activeId, { state: 'error', note: message });
      this.status.set('Batch gestopt. Reeds toegevoegde foto’s blijven behouden. Controleer opnieuw om veilig te hervatten.');
    } finally {
      this.phase.set('finished');
      this.workingChange.emit(false);
      if (!this.destroyed) this.completed.emit();
    }
  }

  downloadReport(): void {
    const report = {
      schemaVersion: 'enrosed.catalogue-transparent-photos.result.v1',
      apiBaseUrl: API_BASE, recordedAt: new Date().toISOString(),
      items: this.rows().map(row => ({ ...row.item, photoId: row.photoId, state: row.state, note: row.note })),
    };
    saveBlob(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }), 'catalogusfoto-import-verslag.json');
  }
}
