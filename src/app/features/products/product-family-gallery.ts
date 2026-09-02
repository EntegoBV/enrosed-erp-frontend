import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthImage } from '../../core/api/auth-image';
import {
  CatalogChannel,
  LanguageCode,
  ProductFamily,
  ProductFamilyImage,
} from '../../core/api/models';

export interface ProductFamilyImageVariantChange {
  imageId: number;
  variantProductId: number | null;
}

export interface ProductFamilyImagePublicationChange {
  imageId: number;
  channels: CatalogChannel[];
}

const PUBLICATION_CHANNELS: ReadonlyArray<{
  channel: CatalogChannel;
  label: string;
  description: string;
}> = [
  { channel: 'WEBSITE', label: 'Website', description: 'Productpagina en websitegalerij' },
  { channel: 'ORDER_APP', label: 'Bestelapp', description: 'Assortiment in de bestelapp' },
  { channel: 'CATALOGUE', label: 'Catalogus', description: 'Catalogus en catalogus-pdf' },
];

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
    <section aria-labelledby="family-gallery-title" [attr.aria-busy]="busy()">
      <div class="section-head">
        <div>
          <h3 id="family-gallery-title">Gedeelde productgalerij</h3>
          <p id="gallery-order-help">
            Elke foto staat hier één keer. Sleep om te sorteren en kies meteen waar ze gebruikt wordt.
          </p>
        </div>
        <div class="gallery-actions">
          <span>{{ family().images.length }} foto('s)</span>
          <button class="btn btn--sm" type="button" [disabled]="busy()"
                  (click)="imageInput.click()">+ Galerijfoto</button>
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
              <span class="image-preview">
                <img [appAuthSrc]="image.smallUrl" alt="" />
                <span class="image-position" aria-hidden="true">{{ i + 1 }}</span>
              </span>
              <div class="image-copy">
                <div class="image-title">
                  <b [title]="image.originalFilename">{{ image.originalFilename }}</b>
                  @if (!publishedChannels(image).length) {
                    <span>Alleen intern</span>
                  }
                  @if (!hasAltText(image)) {
                    <span class="image-warning" title="Vul de alt-tekst bij Vertalingen in vóór publicatie">
                      Alt-tekst ontbreekt
                    </span>
                  }
                </div>
                <label class="variant-link">
                  <span>Toepassen op</span>
                  <select class="select input--sm" [ngModel]="image.variantProductId ?? null"
                          [disabled]="busy()"
                          (ngModelChange)="assignVariant(image.id, $event)">
                    <option [ngValue]="null">Alle kleuren</option>
                    @for (member of members(); track member.productId) {
                      <option [ngValue]="member.productId">{{ memberLabel(member) }}</option>
                    }
                  </select>
                </label>
                <div class="publication-controls" role="group"
                     [attr.aria-label]="'Gebruik van ' + image.originalFilename">
                  @for (option of publicationChannels; track option.channel) {
                    <button type="button" [disabled]="publicationControlDisabled(image, option.channel)"
                            [class.publication-control--on]="isPublishedTo(image, option.channel)"
                            [attr.aria-pressed]="isPublishedTo(image, option.channel)"
                            [attr.aria-label]="channelAriaLabel(image, option.channel, option.label)"
                            [title]="publicationControlTitle(image, option.channel, option.description)"
                            (click)="togglePublicationChannel(image, option.channel)">
                      <i aria-hidden="true">{{ isPublishedTo(image, option.channel) ? '✓' : '' }}</i>
                      <span>{{ option.label }}</span>
                    </button>
                  }
                </div>
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
                  title="Verwijderen"
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
        <p class="gallery-footnote">
          Sleep de foto’s in de juiste volgorde en klik daarna bovenaan op Opslaan.
          Dezelfde volgorde geldt voor website, catalogus en bestelapp.
        </p>
        <p class="sr-only" role="status" aria-live="polite">{{ reorderAnnouncement() }}</p>
      } @else {
        <div class="empty-gallery">
          <span aria-hidden="true">◇</span>
          <div>
            <b>Nog geen productfoto's</b
            ><small>Voeg een foto toe. Ze blijft intern tot je zelf een publicatiekanaal kiest.</small>
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
      font-size: 14px;
      line-height: 1.25;
    }
    .section-head p {
      margin-top: 2px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.35;
    }
    .gallery-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .gallery-actions > span {
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      white-space: nowrap;
    }
    .membership-hint {
      margin: -4px 0 12px;
      padding: 8px 10px;
      border-radius: 9px;
      background: var(--warn-soft);
      color: var(--ink-2);
      font-size: 12px;
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
      position: relative;
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
      font-size: 12px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .variant-link { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 6px; }
    .variant-link > span { color: var(--muted); font-size: 12px; font-weight: 700; }
    .variant-link .select { min-width: 0; height: 36px; padding-block: 4px; font-size: 12px; }
    .image-actions {
      display: flex;
      flex-direction: row;
      gap: 3px;
    }
    .image-actions button {
      width: 44px;
      height: 44px;
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
      font-size: 12px;
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
      .image-list li { grid-template-columns: 36px 50px minmax(0, 1fr); gap: 6px; }
      .image-list img { width: 50px; height: 50px; }
      .image-actions { grid-column: 2 / -1; justify-content: flex-end; }
      .variant-link { grid-template-columns: 1fr; gap: 2px; }
    }
    @media (prefers-reduced-motion: reduce) {
      .image-list li { transition: none; }
    }

    /* The gallery row is the single source of truth: preview, order, colour
       scope and channel use all live together instead of repeating photos. */
    :host { border-bottom: 0; }
    section { min-width: 0; padding: 16px 0 0; }
    .section-head { gap: 16px; margin-bottom: 11px; }
    h3 { margin: 0; font-size: 13px; }
    .section-head p {
      max-width: 560px;
      margin: 3px 0 0;
      font-size: 10.5px;
      line-height: 1.4;
    }
    .gallery-actions { flex: none; }
    .gallery-actions > span { font-size: 10.5px; }
    .image-list { gap: 8px; }
    .image-list li {
      grid-template-columns: 36px 64px minmax(0, 1fr);
      gap: 10px;
      padding: 8px 50px 8px 8px;
      border-radius: 12px;
      background: var(--surface);
    }
    .drag-handle {
      border: 0;
      background: var(--surface-2);
    }
    .image-preview {
      position: relative;
      display: block;
      width: 64px;
      height: 64px;
      overflow: hidden;
      border-radius: 9px;
      background: #fff;
    }
    .image-preview img {
      display: block;
      width: 100%;
      height: 100%;
      border-radius: 0;
      object-fit: cover;
    }
    .image-position {
      position: absolute;
      top: 4px;
      left: 4px;
      display: grid;
      min-width: 20px;
      height: 20px;
      padding: 0 5px;
      place-items: center;
      border-radius: 999px;
      background: rgb(23 18 17 / 72%);
      color: #fff;
      font-size: 10px;
      font-weight: 800;
      line-height: 1;
      backdrop-filter: blur(5px);
    }
    .image-copy {
      display: grid;
      grid-template-columns: minmax(180px, .8fr) minmax(190px, .9fr) minmax(290px, 1.35fr);
      align-items: center;
      gap: 8px 12px;
    }
    .image-title {
      min-width: 0;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 4px;
    }
    .image-title b {
      max-width: 100%;
      overflow: hidden;
      font-size: 12px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .image-title span {
      padding: 3px 7px;
      border: 1px solid var(--line-strong);
      border-radius: 999px;
      background: var(--surface-2);
      color: var(--muted);
      font-size: 9.5px;
      font-weight: 700;
      line-height: 1;
    }
    .variant-link {
      grid-template-columns: auto minmax(0, 1fr);
      gap: 7px;
    }
    .variant-link > span { font-size: 10px; white-space: nowrap; }
    .variant-link .select { height: 38px; font-size: 11px; }
    .publication-controls {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 5px;
    }
    .publication-controls button {
      min-width: 0;
      min-height: 38px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 5px 8px;
      border: 1px solid var(--line);
      border-radius: 9px;
      background: var(--surface-2);
      color: var(--muted);
      font: inherit;
      font-size: 10.5px;
      font-weight: 730;
      cursor: pointer;
    }
    .publication-controls button:hover { border-color: var(--line-strong); color: var(--ink-2); }
    .publication-controls button:focus-visible { outline: 3px solid var(--rose-line); outline-offset: 1px; }
    .publication-controls button:disabled { cursor: default; opacity: .45; }
    .publication-controls i {
      display: grid;
      flex: none;
      width: 16px;
      height: 16px;
      place-items: center;
      border: 1px solid var(--line-strong);
      border-radius: 5px;
      background: var(--surface);
      color: #fff;
      font-style: normal;
      font-size: 10px;
      line-height: 1;
    }
    .publication-controls .publication-control--on {
      border-color: color-mix(in srgb, var(--ok) 34%, var(--line));
      background: var(--ok-soft);
      color: var(--ok);
    }
    .publication-control--on i { border-color: var(--ok); background: var(--ok); }
    .image-copy > label:not(.variant-link) { grid-column: 1 / -1; }
    .image-title .image-warning {
      border-color: color-mix(in srgb, var(--warn) 28%, var(--line));
      background: var(--warn-soft);
      color: var(--warn);
    }
    .image-actions {
      position: absolute;
      top: 8px;
      right: 8px;
    }
    .image-actions button {
      width: 36px;
      height: 36px;
      background: var(--surface-2);
      font-size: 18px;
    }
    .image-actions button:hover { border-color: var(--danger); background: var(--danger-soft); }
    .gallery-footnote {
      margin: 8px 2px 0;
      color: var(--muted);
      font-size: 9.5px;
      line-height: 1.4;
    }
    @media (min-width: 521px) and (max-width: 1280px) {
      .image-copy { grid-template-columns: minmax(0, .9fr) minmax(160px, 1fr); }
      .publication-controls { grid-column: 1 / -1; }
    }
    @media (max-width: 520px) {
      section { padding-top: 14px; }
      .section-head { flex-direction: column; gap: 9px; }
      .gallery-actions { width: 100%; justify-content: space-between; }
      .gallery-actions .btn { min-height: 42px; }
      .image-list li {
        grid-template-columns: 44px 54px minmax(0, 1fr);
        align-items: start;
        gap: 7px;
        padding: 8px 52px 9px 7px;
      }
      .drag-handle { width: 44px; min-height: 54px; height: 54px; }
      .image-preview { width: 54px; height: 54px; }
      .image-copy { display: contents; }
      .image-title { grid-column: 3; grid-row: 1; min-height: 54px; justify-content: center; }
      .variant-link { grid-column: 1 / -1; grid-row: 2; grid-template-columns: 1fr; gap: 3px; }
      .variant-link .select { height: 44px; }
      .publication-controls {
        grid-column: 1 / -1;
        grid-row: 3;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 4px;
      }
      .publication-controls button { min-height: 44px; padding-inline: 4px; font-size: 9.5px; gap: 4px; }
      .publication-controls i { width: 15px; height: 15px; }
      .image-actions { top: 8px; right: 7px; }
      .image-actions button { width: 44px; height: 44px; }
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
  readonly imagePublicationChangeRequested = output<ProductFamilyImagePublicationChange>();

  readonly draggingIndex = signal<number | null>(null);
  readonly dropTargetIndex = signal<number | null>(null);
  readonly reorderAnnouncement = signal('');
  readonly publicationChannels = PUBLICATION_CHANNELS;

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

  publishedChannels(image: ProductFamilyImage): CatalogChannel[] {
    // During a rolling deployment the old API omits the field; its implicit contract
    // made every valid image public on every channel, so preserve that projection.
    return Array.isArray(image.publishedChannels)
      ? image.publishedChannels
      : PUBLICATION_CHANNELS.map((option) => option.channel);
  }

  isPublishedTo(image: ProductFamilyImage, channel: CatalogChannel): boolean {
    return this.publishedChannels(image).includes(channel);
  }

  channelAriaLabel(image: ProductFamilyImage, channel: CatalogChannel, label: string): string {
    if (!this.hasAltText(image) && !this.isPublishedTo(image, channel)) {
      return `${label}: voeg eerst een alt-tekst toe via Website en publicatie`;
    }
    return `${label}: ${this.isPublishedTo(image, channel) ? 'gepubliceerd' : 'niet gepubliceerd'}`;
  }

  publicationControlDisabled(image: ProductFamilyImage, channel: CatalogChannel): boolean {
    return this.busy() || (!this.hasAltText(image) && !this.isPublishedTo(image, channel));
  }

  publicationControlTitle(
    image: ProductFamilyImage,
    channel: CatalogChannel,
    description: string,
  ): string {
    return !this.hasAltText(image) && !this.isPublishedTo(image, channel)
      ? 'Voeg eerst een alt-tekst toe via Website & publicatie'
      : description;
  }

  hasAltText(image: ProductFamilyImage): boolean {
    return image.altTexts.some((item) => Boolean(item.alt?.trim()));
  }

  togglePublicationChannel(image: ProductFamilyImage, channel: CatalogChannel): void {
    if (this.busy()) return;
    const selected = new Set(this.publishedChannels(image));
    if (selected.has(channel)) selected.delete(channel); else selected.add(channel);
    const channels = PUBLICATION_CHANNELS
      .map((option) => option.channel)
      .filter((option) => selected.has(option));
    this.imagePublicationChangeRequested.emit({ imageId: image.id, channels });
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
