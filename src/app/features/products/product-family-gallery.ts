import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthImage } from '../../core/api/auth-image';
import { LanguageCode, ProductFamily, ProductFamilyImage } from '../../core/api/models';

export interface ProductFamilyImageVariantChange {
  imageId: number;
  variantProductId: number | null;
}

interface GalleryPointerReorder {
  pointerId: number;
  sourceIndex: number;
  startX: number;
  startY: number;
  lastX: number;
  started: boolean;
  handle: HTMLElement;
}

@Component({
  selector: 'app-product-family-gallery',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, AuthImage],
  template: `
    <section aria-labelledby="publication-gallery-title" [attr.aria-busy]="busy()">
      <div class="section-head">
        <div>
          <h3 id="publication-gallery-title">Websitegalerij</h3>
          <p id="gallery-order-help">Sleep of veeg de greep om de volgorde te bepalen.</p>
        </div>
        <div class="gallery-actions">
          <span>{{ family().images.length }} foto('s)</span>
          <button class="btn btn--sm" type="button" [disabled]="busy()"
                  (click)="imageInput.click()">+ Foto</button>
          <input
            #imageInput
            class="file-input"
            type="file"
            [disabled]="busy()"
            accept="image/jpeg,image/png,image/webp,image/gif"
            (change)="pickImageFile($event)"
          />
        </div>
      </div>

      @if (!currentProductIsMember()) {
        <p class="membership-hint" role="note">
          Sla dit product eerst op in deze variantgroep om een foto specifiek aan deze variant te koppelen.
          Tot dan geldt een nieuwe foto voor alle varianten.
        </p>
      }

      @if (family().images.length) {
        <ol class="image-list" aria-describedby="gallery-order-help">
          @for (image of orderedImages(); track image.id; let i = $index) {
            <li [class.image-row--dragging]="draggingIndex() === i"
                [class.image-row--drop]="draggingIndex() !== null && draggingIndex() !== i && dropTargetIndex() === i"
                [attr.data-family-image-index]="i">
              <button class="drag-handle" type="button"
                      [disabled]="busy() || orderedImages().length < 2"
                      aria-keyshortcuts="ArrowUp ArrowDown Home End"
                      [attr.aria-label]="orderLabel(image, i)"
                      (click)="announceOrderHelp(image, i)"
                      (keydown)="orderKeydown($event, i, image)"
                      (pointerdown)="startPointerReorder($event, i)"
                      (pointermove)="movePointerReorder($event)"
                      (pointerup)="finishPointerReorder($event)"
                      (pointercancel)="cancelPointerReorder($event)">
                <span aria-hidden="true">⠿</span>
              </button>
              <img [appAuthSrc]="image.smallUrl" alt="" />
              <div class="image-copy">
                <b>{{ image.originalFilename }}</b>
                <label class="variant-link">
                  <span>Foto voor</span>
                  <select class="select input--sm" [ngModel]="image.variantProductId ?? null"
                          [disabled]="busy()"
                          (ngModelChange)="assignVariant(image.id, $event)">
                    <option [ngValue]="null">Alle varianten</option>
                    @for (member of members(); track member.productId) {
                      <option [ngValue]="member.productId">{{ memberLabel(member) }}</option>
                    }
                  </select>
                </label>
                @if (translationEditing()) {
                  <label>
                    <span class="sr-only">Alternatieve tekst voor {{ image.originalFilename }}</span>
                    <input
                      class="input input--sm"
                      [ngModel]="imageAlt(image)"
                      [disabled]="busy()"
                      (ngModelChange)="patchImageAlt(image.id, $event)"
                      [placeholder]="'Beschrijf de foto in ' + language()"
                    />
                  </label>
                }
              </div>
              <div class="image-actions">
                <button
                  class="delete"
                  type="button"
                  [disabled]="busy()"
                  [attr.aria-label]="image.originalFilename + ' verwijderen'"
                  (click)="imageDeleteRequested.emit(image.id)"
                >
                  ×
                </button>
              </div>
            </li>
          }
        </ol>
        <p class="sr-only" role="status" aria-live="polite">{{ reorderAnnouncement() }}</p>
      } @else {
        <div class="empty-gallery">
          <span aria-hidden="true">◇</span>
          <div>
            <b>Nog geen publieke foto's</b
            ><small>De migratie koppelt de bronfoto's aan deze productreeks.</small>
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
    .membership-hint {
      margin: -4px 0 12px;
      padding: 8px 10px;
      border-radius: 9px;
      background: var(--warn-soft);
      color: var(--ink-2);
      font-size: 10px;
      line-height: 1.4;
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
      grid-template-columns: 36px 58px minmax(0, 1fr) auto;
      align-items: center;
      gap: 9px;
      padding: 7px;
      border: 1px solid var(--line);
      border-radius: var(--r-sm);
      background: var(--surface-2);
      transition: border-color .16s, opacity .16s, transform .16s;
    }
    .image-list .image-row--dragging { opacity: .5; transform: scale(.985); }
    .image-list .image-row--drop { border-color: var(--rose); box-shadow: 0 0 0 3px var(--rose-line); }
    .drag-handle {
      width: 36px; height: 44px; border: 1px solid var(--line); border-radius: 9px;
      background: var(--surface); color: var(--muted); font: 800 17px/1 var(--mono);
      cursor: grab; touch-action: none; user-select: none;
    }
    .drag-handle:active { cursor: grabbing; }
    .drag-handle:focus-visible { outline: 3px solid var(--rose-line); outline-offset: 2px; }
    .drag-handle:disabled { cursor: default; opacity: .35; }
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
    .variant-link { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 6px; }
    .variant-link > span { color: var(--muted); font-size: 8.5px; font-weight: 700; }
    .variant-link .select { min-width: 0; height: 31px; padding-block: 4px; font-size: 9.5px; }
    .image-actions {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .image-actions button {
      width: 36px;
      height: 38px;
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
    @media (max-width: 520px) {
      .image-list li { grid-template-columns: 36px 50px minmax(0, 1fr) auto; gap: 6px; }
      .image-list img { width: 50px; height: 50px; }
      .variant-link { grid-template-columns: 1fr; gap: 2px; }
    }
    @media (prefers-reduced-motion: reduce) {
      .image-list li { transition: none; }
    }
  `,
})
export class ProductFamilyGallery {
  private pointerReorder: GalleryPointerReorder | null = null;

  readonly family = input.required<ProductFamily>();
  readonly language = input.required<LanguageCode>();
  readonly translationEditing = input(false);
  readonly currentProductId = input<number | null>(null);
  readonly busy = input(false);
  readonly familyChange = output<ProductFamily>();
  readonly imageUploadRequested = output<File>();
  readonly imageDeleteRequested = output<number>();
  readonly imageVariantChangeRequested = output<ProductFamilyImageVariantChange>();

  readonly draggingIndex = signal<number | null>(null);
  readonly dropTargetIndex = signal<number | null>(null);
  readonly reorderAnnouncement = signal('');

  readonly orderedImages = computed(() =>
    [...this.family().images].sort((left, right) => left.position - right.position),
  );
  readonly members = computed(() => this.family().members ?? []);
  readonly currentProductIsMember = computed(() => {
    const productId = this.currentProductId();
    return productId !== null && this.members().some((member) => member.productId === productId);
  });

  pickImageFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (this.busy()) {
      input.value = '';
      return;
    }
    const file = input.files?.[0];
    if (file) this.imageUploadRequested.emit(file);
    input.value = '';
  }

  imageAlt(image: ProductFamilyImage): string {
    return image.altTexts.find((item) => item.language === this.language())?.alt ?? '';
  }

  patchImageAlt(imageId: number, alt: string): void {
    if (this.busy() || !this.translationEditing()) return;
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

  assignVariant(imageId: number, value: number | string | null): void {
    if (this.busy()) return;
    const variantProductId = value === null || value === '' ? null : Number(value);
    const family = this.family();
    const image = family.images.find((item) => item.id === imageId);
    if (!image || image.variantProductId === variantProductId) return;
    this.familyChange.emit({
      ...family,
      images: family.images.map((item) =>
        item.id === imageId ? { ...item, variantProductId } : item),
    });
    this.imageVariantChangeRequested.emit({ imageId, variantProductId });
  }

  memberLabel(member: ProductFamily['members'][number]): string {
    const option = [member.colour || 'Geen kleur', member.size].filter(Boolean).join(' · ');
    return member.sku ? `${option} — ${member.sku}` : option;
  }

  orderLabel(image: ProductFamilyImage, index: number): string {
    return `Volgorde van ${image.originalFilename}, positie ${index + 1} van ${this.orderedImages().length}. `
      + 'Sleep of veeg; gebruik met een toetsenbord de pijltjes, Home of End.';
  }

  announceOrderHelp(image: ProductFamilyImage, index: number): void {
    this.reorderAnnouncement.set(this.orderLabel(image, index));
  }

  orderKeydown(event: KeyboardEvent, index: number, image: ProductFamilyImage): void {
    if (this.busy()) return;
    let target = index;
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowUp': target--; break;
      case 'ArrowRight':
      case 'ArrowDown': target++; break;
      case 'Home': target = 0; break;
      case 'End': target = this.orderedImages().length - 1; break;
      default: return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.reorderTo(index, target, image.originalFilename);
  }

  startPointerReorder(event: PointerEvent, index: number): void {
    if (this.busy() || event.button !== 0) return;
    event.stopPropagation();
    const handle = event.currentTarget as HTMLElement;
    this.pointerReorder = {
      pointerId: event.pointerId,
      sourceIndex: index,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      started: false,
      handle,
    };
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      this.pointerReorder = null;
    }
  }

  movePointerReorder(event: PointerEvent): void {
    const active = this.pointerReorder;
    if (!active || event.pointerId !== active.pointerId) return;
    active.lastX = event.clientX;
    const distance = Math.hypot(event.clientX - active.startX, event.clientY - active.startY);
    if (!active.started && distance < 7) return;
    event.preventDefault();
    event.stopPropagation();
    if (!active.started) {
      active.started = true;
      this.draggingIndex.set(active.sourceIndex);
      this.dropTargetIndex.set(active.sourceIndex);
    }
    const row = document.elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>('[data-family-image-index]');
    const target = Number(row?.dataset['familyImageIndex']);
    if (Number.isInteger(target)) this.dropTargetIndex.set(target);
  }

  finishPointerReorder(event: PointerEvent): void {
    const active = this.pointerReorder;
    if (!active || event.pointerId !== active.pointerId) return;
    active.lastX = event.clientX;
    if (active.started) {
      event.preventDefault();
      event.stopPropagation();
    }
    let target = this.dropTargetIndex() ?? active.sourceIndex;
    const horizontalDistance = active.lastX - active.startX;
    if (active.started && target === active.sourceIndex && Math.abs(horizontalDistance) >= 32) {
      // A short swipe follows list navigation: left is previous, right is next.
      target += horizontalDistance < 0 ? -1 : 1;
    }
    const image = this.orderedImages()[active.sourceIndex];
    this.releasePointer(active);
    this.resetPointerReorder();
    if (active.started && image) this.reorderTo(active.sourceIndex, target, image.originalFilename);
  }

  cancelPointerReorder(event: PointerEvent): void {
    const active = this.pointerReorder;
    if (!active || event.pointerId !== active.pointerId) return;
    this.releasePointer(active);
    this.resetPointerReorder();
  }

  moveImage(index: number, direction: -1 | 1): void {
    const image = this.orderedImages()[index];
    if (image) this.reorderTo(index, index + direction, image.originalFilename);
  }

  private reorderTo(source: number, target: number, filename: string): void {
    if (this.busy()) return;
    const family = this.family();
    const images = this.orderedImages();
    const boundedTarget = Math.max(0, Math.min(target, images.length - 1));
    if (source < 0 || source >= images.length || source === boundedTarget) return;
    const [moved] = images.splice(source, 1);
    images.splice(boundedTarget, 0, moved);
    this.familyChange.emit({
      ...family,
      images: images.map((image, position) => ({ ...image, position })),
    });
    this.reorderAnnouncement.set(
      `${filename} staat nu op positie ${boundedTarget + 1} van ${images.length}.`,
    );
  }

  private releasePointer(active: GalleryPointerReorder): void {
    try {
      if (active.handle.hasPointerCapture(active.pointerId)) {
        active.handle.releasePointerCapture(active.pointerId);
      }
    } catch {
      /* Pointer cancellation already releases capture. */
    }
  }

  private resetPointerReorder(): void {
    this.pointerReorder = null;
    this.draggingIndex.set(null);
    this.dropTargetIndex.set(null);
  }
}
