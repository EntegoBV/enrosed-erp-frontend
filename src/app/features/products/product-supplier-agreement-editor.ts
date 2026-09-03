import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CatalogApi } from '../../core/api/catalog-api';
import { AuthImage } from '../../core/api/auth-image';
import { messageOf } from '../../core/api/errors';
import { ProductSupplierAgreementPhoto } from '../../core/api/models';
import { Ui, escapeHtml } from '../../shared/ui';
import {
  SUPPLIER_AGREEMENT_CAPTION_MAX,
  moveSupplierAgreementPhoto,
  normalizeSupplierAgreementCaption,
  orderedSupplierAgreementPhotos,
  supplierAgreementCaptionChanged,
  supplierAgreementOrderIds,
} from './product-supplier-agreement-state';
import { ProductSupplierAgreementPhotoViewer } from './product-supplier-agreement-photo-viewer';

const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

interface PendingAgreementPhoto {
  id: number;
  supplierId: number;
  file: File;
  caption: string;
  previewUrl: string;
  status: 'queued' | 'uploading' | 'failed';
  error: string | null;
}

export interface SupplierAgreementFlushResult {
  savedCaptions: number;
  uploaded: number;
  remaining: number;
}

/** Product- and supplier-scoped instructions that can only enter a supplier PDF. */
@Component({
  selector: 'app-product-supplier-agreement-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AuthImage, FormsModule, ProductSupplierAgreementPhotoViewer],
  template: `
    <div class="card__head agreement-head">
      <div>
        <h2 id="agreements-title">Afspraken</h2>
        <p>Engelse productinstructies en referentiefoto’s voor de leverancier</p>
      </div>
      <span class="private-badge"><i aria-hidden="true">●</i> Nooit online</span>
    </div>

    <div class="card__body agreement-body">
      <div class="scope-note" role="note">
        <span class="scope-note__lock" aria-hidden="true">⌁</span>
        <div>
          <b>Alleen voor {{ supplierName() || 'de gekozen leverancier' }}</b>
          <p>
            Deze tekst en foto’s verschijnen uitsluitend in de Engelse leveranciersversie van de
            inkooporder. Ze worden nooit website- of catalogusmedia.
          </p>
        </div>
      </div>

      <label class="instruction-field" for="supplier-agreement-note">
        <span
          ><b>Product instruction (English)</b><small>{{ (note() || '').length }}/4000</small></span
        >
        <textarea
          class="textarea"
          id="supplier-agreement-note"
          rows="5"
          maxlength="4000"
          lang="en"
          [disabled]="disabled() || !supplierId()"
          [ngModel]="note()"
          (ngModelChange)="changeNote($event)"
          placeholder="Example: Match the approved colour sample. Centre the logo and use cardboard corner protection."
        ></textarea>
        <small>Printed below this product in the supplier order agreement. Start a line with "- " for a point, indent it two spaces for a sub-point.</small>
      </label>

      <section
        class="agreement-photos"
        aria-labelledby="agreement-photos-title"
        [attr.aria-busy]="loading() || busy()"
      >
        <div class="photo-toolbar">
          <div>
            <h3 id="agreement-photos-title">
              Afspraakfoto’s <span>{{ photoCount() }}</span>
            </h3>
            <p>De volgorde hieronder is de volgorde in de leveranciers-PDF.</p>
          </div>
          <label
            class="add-photo"
            [class.add-photo--disabled]="disabled() || !supplierId() || busy()"
          >
            <span aria-hidden="true">+</span>
            {{ uploading() ? 'Uploaden…' : 'Foto’s toevoegen' }}
            <input
              type="file"
              multiple
              accept="image/jpeg,image/png,image/gif,image/webp"
              [disabled]="disabled() || !supplierId() || busy()"
              (change)="chooseFiles($event)"
            />
          </label>
        </div>

        @if (productId() === null) {
          <p class="save-first" role="status">
            Je kunt foto’s al kiezen. Ze worden veilig geüpload zodra het nieuwe product is
            opgeslagen.
          </p>
        } @else if (!scopePersisted()) {
          <p class="save-first" role="status">
            Sla eerst de nieuwe leverancier op. Daarna worden de gekozen foto’s aan die leverancier
            gekoppeld.
          </p>
        }

        @if (loadError()) {
          <div class="photo-error" role="alert">
            <span>{{ loadError() }}</span>
            <button type="button" [disabled]="loading()" (click)="reload()">
              Opnieuw proberen
            </button>
          </div>
        } @else if (loading()) {
          <p class="photo-loading" role="status">Afspraakfoto’s laden…</p>
        }

        @if (orderedPhotos().length) {
          <ol class="photo-list" aria-label="Opgeslagen afspraakfoto’s in PDF-volgorde">
            @for (photo of orderedPhotos(); track photo.id; let i = $index) {
              <li>
                <button
                  class="photo-preview"
                  type="button"
                  (click)="previewIndex.set(i)"
                  [attr.aria-label]="'Afspraakfoto ' + (i + 1) + ' vergroten'"
                >
                  <img
                    [appAuthSrc]="photo.viewUrl"
                    [alt]="photo.caption || photo.originalFilename"
                    loading="lazy"
                  />
                  <span>PDF {{ i + 1 }}</span>
                </button>
                <div class="photo-copy">
                  <b title="{{ photo.originalFilename }}">{{ photo.originalFilename }}</b>
                  <label>
                    <span
                      >English caption
                      <small>{{ captionDraft(photo).length }}/{{ captionMax }}</small></span
                    >
                    <textarea
                      class="textarea"
                      rows="2"
                      lang="en"
                      [attr.maxlength]="captionMax"
                      [disabled]="disabled() || busy()"
                      [ngModel]="captionDraft(photo)"
                      (ngModelChange)="changeCaption(photo.id, $event)"
                      placeholder="Example: Front view — logo centred"
                    ></textarea>
                  </label>
                  @if (captionChanged(photo)) {
                    <button
                      class="save-caption"
                      type="button"
                      [disabled]="disabled() || busy()"
                      (click)="saveCaption(photo)"
                    >
                      Bijschrift opslaan
                    </button>
                  }
                </div>
                <div
                  class="photo-actions"
                  role="group"
                  [attr.aria-label]="'PDF-volgorde voor ' + photo.originalFilename"
                >
                  <button
                    type="button"
                    [disabled]="disabled() || busy() || i === 0"
                    title="Eerder in PDF"
                    (click)="move(photo.id, -1)"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    [disabled]="disabled() || busy() || i === orderedPhotos().length - 1"
                    title="Later in PDF"
                    (click)="move(photo.id, 1)"
                  >
                    ↓
                  </button>
                  <button
                    class="danger"
                    type="button"
                    [disabled]="disabled() || busy()"
                    title="Afspraakfoto verwijderen"
                    (click)="confirmRemove(photo)"
                  >
                    ×
                  </button>
                </div>
              </li>
            }
          </ol>
        }

        @if (visiblePending().length) {
          <section class="pending-series" aria-labelledby="pending-agreement-title">
            <h3 id="pending-agreement-title">
              Wacht op upload <span>{{ visiblePending().length }}</span>
            </h3>
            <ol class="pending-list">
              @for (pending of visiblePending(); track pending.id; let i = $index) {
                <li [class.pending--failed]="pending.status === 'failed'">
                  <img [src]="pending.previewUrl" [alt]="pending.file.name" />
                  <div>
                    <b>{{ pending.file.name }}</b>
                    <label>
                      <span
                        >English caption
                        <small>{{ pending.caption.length }}/{{ captionMax }}</small></span
                      >
                      <textarea
                        class="textarea"
                        rows="2"
                        lang="en"
                        [attr.maxlength]="captionMax"
                        [disabled]="pending.status === 'uploading'"
                        [ngModel]="pending.caption"
                        (ngModelChange)="changePendingCaption(pending.id, $event)"
                        placeholder="Optional caption"
                      ></textarea>
                    </label>
                    @if (pending.error) {
                      <small class="pending-error">{{ pending.error }}</small>
                    }
                  </div>
                  <button
                    type="button"
                    title="Uit wachtrij verwijderen"
                    aria-label="Uit wachtrij verwijderen"
                    [disabled]="pending.status === 'uploading'"
                    (click)="removePending(pending.id)"
                  >
                    ×
                  </button>
                </li>
              }
            </ol>
            @if (productId() !== null && scopePersisted() && !uploading()) {
              <button
                class="retry-upload"
                type="button"
                [disabled]="disabled() || busy()"
                (click)="uploadPending()"
              >
                {{ hasFailedPending() ? 'Mislukte uploads opnieuw proberen' : 'Nu uploaden' }}
              </button>
            }
          </section>
        }

        @if (!loading() && !loadError() && !orderedPhotos().length && !visiblePending().length) {
          <div class="empty-photos">
            <span aria-hidden="true">◇</span>
            <div>
              <b>Nog geen afspraakfoto’s</b
              ><small>Voeg bijvoorbeeld een kleurstaal, verpakking of bedrukking toe.</small>
            </div>
          </div>
        }
      </section>
    </div>

    <app-product-supplier-agreement-photo-viewer
      [photos]="orderedPhotos()"
      [(index)]="previewIndex"
    />
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .agreement-head {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .agreement-head > div {
      min-width: 0;
    }
    .agreement-head h2 {
      font-size: 15px;
    }
    .agreement-head p {
      margin-top: 2px;
      color: var(--muted);
      font-size: 11.5px;
      line-height: 1.35;
    }
    .private-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      margin-left: auto;
      padding: 5px 9px;
      border-radius: 999px;
      background: var(--warn-soft);
      color: var(--warn);
      font-size: 10.5px;
      font-weight: 780;
      white-space: nowrap;
    }
    .private-badge i {
      font-size: 7px;
    }
    .agreement-body {
      display: grid;
      gap: 16px;
    }
    .scope-note {
      display: flex;
      gap: 11px;
      padding: 12px 13px;
      border: 1px solid #eddcb9;
      border-radius: 12px;
      background: var(--warn-soft);
    }
    .scope-note__lock {
      display: grid;
      width: 28px;
      height: 28px;
      flex: none;
      place-items: center;
      border-radius: 50%;
      background: #fff;
      color: var(--warn);
      font-weight: 800;
    }
    .scope-note b {
      font-size: 13px;
    }
    .scope-note p {
      margin-top: 2px;
      color: var(--ink-2);
      font-size: 11.5px;
      line-height: 1.45;
    }
    .instruction-field {
      display: grid;
      gap: 6px;
    }
    .instruction-field > span {
      display: flex;
      justify-content: space-between;
      gap: 10px;
    }
    .instruction-field b {
      font-size: 13px;
    }
    .instruction-field small {
      color: var(--muted);
      font-size: 10.5px;
    }
    .instruction-field textarea {
      min-height: 118px;
      line-height: 1.5;
    }
    .agreement-photos {
      min-width: 0;
      padding-top: 2px;
      border-top: 1px solid var(--line);
    }
    .photo-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding-top: 14px;
    }
    .photo-toolbar h3,
    .pending-series h3 {
      font-size: 13px;
    }
    .photo-toolbar h3 span,
    .pending-series h3 span {
      display: inline-grid;
      min-width: 20px;
      height: 20px;
      margin-left: 4px;
      place-items: center;
      border-radius: 999px;
      background: var(--surface-2);
      color: var(--muted);
      font: 700 9px/1 var(--mono);
    }
    .photo-toolbar p {
      margin-top: 2px;
      color: var(--muted);
      font-size: 10.5px;
    }
    .add-photo {
      position: relative;
      display: inline-flex;
      min-height: 40px;
      align-items: center;
      gap: 7px;
      padding: 7px 12px;
      border: 1px solid var(--rose-mid);
      border-radius: 10px;
      background: var(--surface);
      color: var(--rose);
      font-size: 11.5px;
      font-weight: 760;
      cursor: pointer;
    }
    .add-photo > span {
      font-size: 18px;
    }
    .add-photo input {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
    }
    .add-photo--disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .save-first {
      margin-top: 10px;
      padding: 9px 11px;
      border-radius: 10px;
      background: var(--surface-2);
      color: var(--ink-2);
      font-size: 11px;
      line-height: 1.4;
    }
    .photo-error {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-top: 12px;
      padding: 10px 11px;
      border: 1px solid var(--danger);
      border-radius: 10px;
      background: var(--danger-soft);
      color: var(--danger);
      font-size: 11.5px;
    }
    .photo-error button,
    .retry-upload,
    .save-caption {
      border: 0;
      border-radius: 8px;
      background: var(--rose);
      color: #fff;
      padding: 7px 10px;
      font: inherit;
      font-size: 11px;
      font-weight: 750;
      cursor: pointer;
    }
    .photo-loading {
      padding: 18px 2px;
      color: var(--muted);
      font-size: 12px;
    }
    .photo-list,
    .pending-list {
      display: grid;
      gap: 9px;
      margin: 12px 0 0;
      padding: 0;
      list-style: none;
    }
    .photo-list > li {
      display: grid;
      grid-template-columns: 88px minmax(0, 1fr) 34px;
      gap: 10px;
      padding: 10px;
      border: 1px solid var(--line);
      border-radius: 13px;
      background: var(--surface-2);
    }
    .photo-preview {
      position: relative;
      width: 88px;
      height: 88px;
      padding: 0;
      overflow: hidden;
      border: 0;
      border-radius: 10px;
      background: var(--surface);
      cursor: zoom-in;
    }
    .photo-preview img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .photo-preview span {
      position: absolute;
      left: 5px;
      bottom: 5px;
      padding: 3px 6px;
      border-radius: 999px;
      background: rgb(20 14 12/0.78);
      color: #fff;
      font-size: 9px;
      font-weight: 750;
    }
    .photo-copy {
      display: grid;
      align-content: start;
      gap: 6px;
      min-width: 0;
    }
    .photo-copy > b {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 11.5px;
    }
    .photo-copy label {
      display: grid;
      gap: 3px;
    }
    .photo-copy label > span,
    .pending-list label > span {
      display: flex;
      justify-content: space-between;
      color: var(--muted);
      font-size: 9.5px;
      font-weight: 700;
    }
    .photo-copy textarea,
    .pending-list textarea {
      min-height: 54px;
      padding: 7px 8px;
      font-size: 11px;
      line-height: 1.35;
    }
    .save-caption {
      justify-self: start;
    }
    .photo-actions {
      display: grid;
      align-content: start;
      gap: 5px;
    }
    .photo-actions button,
    .pending-list > li > button {
      display: grid;
      width: 32px;
      height: 32px;
      padding: 0;
      place-items: center;
      border: 1px solid var(--line);
      border-radius: 9px;
      background: var(--surface);
      color: var(--ink-2);
      font: inherit;
      font-weight: 750;
      cursor: pointer;
    }
    .photo-actions button:disabled {
      opacity: 0.35;
      cursor: not-allowed;
    }
    .photo-actions .danger,
    .pending-list > li > button {
      color: var(--danger);
    }
    .pending-series {
      margin-top: 14px;
      padding-top: 12px;
      border-top: 1px dashed var(--line);
    }
    .pending-list > li {
      display: grid;
      grid-template-columns: 70px minmax(0, 1fr) 32px;
      gap: 9px;
      padding: 9px;
      border: 1px dashed var(--line);
      border-radius: 12px;
      background: var(--surface);
    }
    .pending-list img {
      width: 70px;
      height: 70px;
      border-radius: 9px;
      object-fit: cover;
    }
    .pending-list > li > div {
      display: grid;
      align-content: start;
      gap: 5px;
      min-width: 0;
    }
    .pending-list b {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 11px;
    }
    .pending--failed {
      border-color: var(--danger) !important;
      background: var(--danger-soft) !important;
    }
    .pending-error {
      color: var(--danger);
      font-size: 10px;
    }
    .retry-upload {
      margin-top: 9px;
    }
    .empty-photos {
      display: flex;
      align-items: center;
      gap: 11px;
      margin-top: 12px;
      padding: 16px;
      border: 1px dashed var(--line);
      border-radius: 12px;
      color: var(--muted);
    }
    .empty-photos > span {
      font-size: 25px;
    }
    .empty-photos div {
      display: grid;
      gap: 2px;
    }
    .empty-photos b {
      color: var(--ink-2);
      font-size: 12px;
    }
    .empty-photos small {
      font-size: 10.5px;
      line-height: 1.4;
    }
    @media (max-width: 560px) {
      .agreement-head {
        align-items: flex-start;
      }
      .agreement-head p {
        max-width: 190px;
      }
      .private-badge {
        padding-inline: 7px;
      }
      .photo-toolbar {
        align-items: stretch;
        flex-direction: column;
      }
      .add-photo {
        justify-content: center;
      }
      .photo-list > li {
        grid-template-columns: 76px minmax(0, 1fr) 32px;
        padding: 8px;
      }
      .photo-preview {
        width: 76px;
        height: 76px;
      }
      .pending-list > li {
        grid-template-columns: 58px minmax(0, 1fr) 30px;
      }
      .pending-list img {
        width: 58px;
        height: 58px;
      }
    }
  `,
})
export class ProductSupplierAgreementEditor implements OnDestroy {
  private readonly catalog = inject(CatalogApi);
  private readonly ui = inject(Ui);
  private loadVersion = 0;
  private pendingId = 0;
  private loadedKey = '';
  private lastDraftSupplierId: number | null = null;

  readonly productId = input<number | null>(null);
  readonly supplierId = input<number | null>(null);
  readonly persistedSupplierId = input<number | null>(null);
  readonly supplierName = input('');
  readonly note = input<string | null>(null);
  readonly disabled = input(false);
  readonly noteChange = output<string | null>();

  readonly photos = signal<ProductSupplierAgreementPhoto[]>([]);
  readonly pending = signal<PendingAgreementPhoto[]>([]);
  readonly captionDrafts = signal<Record<number, string>>({});
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly mutating = signal(false);
  readonly uploading = signal(false);
  readonly previewIndex = signal(-1);
  readonly captionMax = SUPPLIER_AGREEMENT_CAPTION_MAX;

  readonly scopePersisted = computed(
    () =>
      this.productId() !== null &&
      this.supplierId() !== null &&
      this.supplierId() === this.persistedSupplierId(),
  );
  readonly orderedPhotos = computed(() =>
    orderedSupplierAgreementPhotos(
      this.photos().filter((photo) => photo.supplierId === this.supplierId()),
    ),
  );
  readonly visiblePending = computed(() =>
    this.pending().filter((photo) => photo.supplierId === this.supplierId()),
  );
  readonly pendingCount = computed(() => this.visiblePending().length);
  readonly photoCount = computed(() => this.orderedPhotos().length + this.pendingCount());
  readonly hasFailedPending = computed(() =>
    this.visiblePending().some((photo) => photo.status === 'failed'),
  );
  readonly busy = computed(() => this.mutating() || this.uploading());
  readonly dirty = computed(
    () =>
      this.pendingCount() > 0 || this.orderedPhotos().some((photo) => this.captionChanged(photo)),
  );

  constructor() {
    effect(() => {
      const productId = this.productId();
      const persistedSupplierId = this.persistedSupplierId();
      untracked(() => this.openPersistedScope(productId, persistedSupplierId));
    });
    effect(() => {
      const supplierId = this.supplierId();
      untracked(() => {
        if (this.lastDraftSupplierId !== null && supplierId !== this.lastDraftSupplierId) {
          this.discardPendingOutside(supplierId);
          this.previewIndex.set(-1);
        }
        this.lastDraftSupplierId = supplierId;
      });
    });
  }

  ngOnDestroy(): void {
    for (const photo of this.pending()) URL.revokeObjectURL(photo.previewUrl);
  }

  changeNote(value: string): void {
    this.noteChange.emit(value.trim() ? value : null);
  }

  captionDraft(photo: ProductSupplierAgreementPhoto): string {
    return this.captionDrafts()[photo.id] ?? photo.caption ?? '';
  }

  captionChanged(photo: ProductSupplierAgreementPhoto): boolean {
    return supplierAgreementCaptionChanged(photo, this.captionDraft(photo));
  }

  changeCaption(photoId: number, value: string): void {
    this.captionDrafts.update((drafts) => ({
      ...drafts,
      [photoId]: value.slice(0, SUPPLIER_AGREEMENT_CAPTION_MAX),
    }));
  }

  changePendingCaption(pendingId: number, value: string): void {
    this.pending.update((items) =>
      items.map((item) =>
        item.id === pendingId
          ? { ...item, caption: value.slice(0, SUPPLIER_AGREEMENT_CAPTION_MAX) }
          : item,
      ),
    );
  }

  chooseFiles(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';
    const supplierId = this.supplierId();
    if (!supplierId || !files.length) return;

    const accepted: PendingAgreementPhoto[] = [];
    for (const file of files) {
      if (!PHOTO_TYPES.has(file.type)) {
        this.ui.toast(`${file.name}: gebruik JPEG, PNG, GIF of WebP`, 'err');
        continue;
      }
      if (file.size > MAX_PHOTO_BYTES) {
        this.ui.toast(`${file.name}: maximaal 25 MB per foto`, 'err');
        continue;
      }
      accepted.push({
        id: --this.pendingId,
        supplierId,
        file,
        caption: '',
        previewUrl: URL.createObjectURL(file),
        status: 'queued',
        error: null,
      });
    }
    if (!accepted.length) return;
    this.pending.update((items) => [...items, ...accepted]);
    this.ui.toast(
      `${accepted.length} foto${accepted.length === 1 ? '' : '’s'} klaar · voeg eerst het Engelse bijschrift toe`,
    );
  }

  removePending(id: number): void {
    const found = this.pending().find((photo) => photo.id === id);
    if (found) URL.revokeObjectURL(found.previewUrl);
    this.pending.update((items) => items.filter((photo) => photo.id !== id));
  }

  async uploadPending(productId = this.productId()): Promise<SupplierAgreementFlushResult> {
    const supplierId = this.supplierId();
    if (productId === null || supplierId === null || this.uploading()) {
      return { savedCaptions: 0, uploaded: 0, remaining: this.pendingCount() };
    }
    this.uploading.set(true);
    let uploaded = 0;
    try {
      const queue = this.pending().filter((photo) => photo.supplierId === supplierId);
      for (const pending of queue) {
        this.pending.update((items) =>
          items.map((item) =>
            item.id === pending.id ? { ...item, status: 'uploading', error: null } : item,
          ),
        );
        try {
          const saved = await this.catalog.uploadSupplierAgreementPhoto(
            productId,
            pending.file,
            normalizeSupplierAgreementCaption(pending.caption),
          );
          URL.revokeObjectURL(pending.previewUrl);
          this.pending.update((items) => items.filter((item) => item.id !== pending.id));
          this.photos.update((photos) => orderedSupplierAgreementPhotos([...photos, saved]));
          this.captionDrafts.update((drafts) => ({ ...drafts, [saved.id]: saved.caption ?? '' }));
          uploaded++;
        } catch (failure: unknown) {
          const error = messageOf(failure, 'Upload mislukt');
          this.pending.update((items) =>
            items.map((item) =>
              item.id === pending.id ? { ...item, status: 'failed', error } : item,
            ),
          );
        }
      }
    } finally {
      this.uploading.set(false);
    }
    const remaining = this.pending().filter((photo) => photo.supplierId === supplierId).length;
    if (uploaded) this.ui.toast(`${uploaded} afspraakfoto${uploaded === 1 ? '' : '’s'} toegevoegd`);
    if (remaining)
      this.ui.toast(`${remaining} afspraakfoto${remaining === 1 ? '' : '’s'} niet geüpload`, 'err');
    return { savedCaptions: 0, uploaded, remaining };
  }

  async saveCaption(photo: ProductSupplierAgreementPhoto): Promise<boolean> {
    const productId = this.productId();
    if (productId === null || this.mutating() || !this.captionChanged(photo)) return true;
    this.mutating.set(true);
    try {
      const saved = await this.catalog.updateSupplierAgreementPhotoCaption(
        productId,
        photo.id,
        normalizeSupplierAgreementCaption(this.captionDraft(photo)),
      );
      this.replacePhoto(saved);
      this.ui.toast('Engels bijschrift opgeslagen');
      return true;
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Bijschrift opslaan mislukt'), 'err');
      return false;
    } finally {
      this.mutating.set(false);
    }
  }

  async flush(productId: number): Promise<SupplierAgreementFlushResult> {
    let savedCaptions = 0;
    for (const photo of this.orderedPhotos()) {
      if (!this.captionChanged(photo)) continue;
      if (!(await this.saveCaption(photo))) {
        return { savedCaptions, uploaded: 0, remaining: this.pendingCount() };
      }
      savedCaptions++;
    }
    const uploads = await this.uploadPending(productId);
    return { ...uploads, savedCaptions };
  }

  async move(photoId: number, direction: -1 | 1): Promise<void> {
    const productId = this.productId();
    if (productId === null || this.mutating()) return;
    const before = this.photos();
    const movedScope = moveSupplierAgreementPhoto(this.orderedPhotos(), photoId, direction);
    if (
      supplierAgreementOrderIds(movedScope).join(',') ===
      supplierAgreementOrderIds(this.orderedPhotos()).join(',')
    )
      return;
    const scopeIds = new Set(movedScope.map((photo) => photo.id));
    this.photos.set([...before.filter((photo) => !scopeIds.has(photo.id)), ...movedScope]);
    this.mutating.set(true);
    try {
      const saved = await this.catalog.reorderSupplierAgreementPhotos(
        productId,
        supplierAgreementOrderIds(movedScope),
      );
      this.replaceSupplierPhotos(saved);
    } catch (failure: unknown) {
      this.photos.set(before);
      this.ui.toast(messageOf(failure, 'PDF-volgorde opslaan mislukt'), 'err');
    } finally {
      this.mutating.set(false);
    }
  }

  confirmRemove(photo: ProductSupplierAgreementPhoto): void {
    const productId = this.productId();
    if (productId === null) return;
    this.ui.confirm(
      {
        title: 'Afspraakfoto verwijderen',
        message: `<b>${escapeHtml(photo.originalFilename)}</b> verwijderen? De foto verdwijnt uit nieuwe leveranciers-PDF’s.`,
        confirmLabel: 'Verwijderen',
        danger: true,
      },
      () => void this.removePhoto(productId, photo),
    );
  }

  reload(): void {
    const productId = this.productId();
    const supplierId = this.persistedSupplierId();
    if (productId !== null && supplierId !== null) void this.loadPhotos(productId, supplierId);
  }

  private async removePhoto(
    productId: number,
    photo: ProductSupplierAgreementPhoto,
  ): Promise<void> {
    if (this.mutating()) return;
    this.mutating.set(true);
    try {
      await this.catalog.deleteSupplierAgreementPhoto(productId, photo.id);
      this.photos.update((photos) => photos.filter((item) => item.id !== photo.id));
      this.captionDrafts.update((drafts) => {
        const next = { ...drafts };
        delete next[photo.id];
        return next;
      });
      this.previewIndex.set(-1);
      this.ui.toast('Afspraakfoto verwijderd');
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Afspraakfoto verwijderen mislukt'), 'err');
    } finally {
      this.mutating.set(false);
    }
  }

  private openPersistedScope(productId: number | null, supplierId: number | null): void {
    const key = productId !== null && supplierId !== null ? `${productId}:${supplierId}` : '';
    if (key === this.loadedKey) return;
    this.loadedKey = key;
    this.previewIndex.set(-1);
    this.photos.set([]);
    this.captionDrafts.set({});
    this.loadError.set(null);
    if (productId === null || supplierId === null) {
      ++this.loadVersion;
      this.loading.set(false);
      return;
    }
    void this.loadPhotos(productId, supplierId);
  }

  private async loadPhotos(productId: number, supplierId: number): Promise<void> {
    const version = ++this.loadVersion;
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const photos = await this.catalog.supplierAgreementPhotos(productId);
      if (
        version !== this.loadVersion ||
        this.productId() !== productId ||
        this.persistedSupplierId() !== supplierId
      )
        return;
      this.replaceSupplierPhotos(photos.filter((photo) => photo.supplierId === supplierId));
    } catch (failure: unknown) {
      if (version !== this.loadVersion) return;
      this.loadError.set(messageOf(failure, 'Afspraakfoto’s konden niet worden geladen.'));
    } finally {
      if (version === this.loadVersion) this.loading.set(false);
    }
  }

  private replacePhoto(saved: ProductSupplierAgreementPhoto): void {
    this.photos.update((photos) => photos.map((photo) => (photo.id === saved.id ? saved : photo)));
    this.captionDrafts.update((drafts) => ({ ...drafts, [saved.id]: saved.caption ?? '' }));
  }

  private replaceSupplierPhotos(saved: ProductSupplierAgreementPhoto[]): void {
    const supplierId = this.persistedSupplierId();
    const other = this.photos().filter((photo) => photo.supplierId !== supplierId);
    const ordered = orderedSupplierAgreementPhotos(saved);
    this.photos.set([...other, ...ordered]);
    this.captionDrafts.update((drafts) => {
      const next = { ...drafts };
      for (const photo of ordered) next[photo.id] = photo.caption ?? '';
      return next;
    });
  }

  private discardPendingOutside(supplierId: number | null): void {
    const removed = this.pending().filter((photo) => photo.supplierId !== supplierId);
    for (const photo of removed) URL.revokeObjectURL(photo.previewUrl);
    if (removed.length) {
      this.pending.update((photos) => photos.filter((photo) => photo.supplierId === supplierId));
      this.ui.toast('Niet-geüploade afspraakfoto’s van de vorige leverancier verwijderd');
    }
  }
}
