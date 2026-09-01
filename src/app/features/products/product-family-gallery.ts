import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
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
import {
  ProductImagePublicationMenuPlacement,
  productImagePublicationMenuPlacement,
} from './product-family-gallery-layout';

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
    <section aria-labelledby="publication-gallery-title" [attr.aria-busy]="busy()">
      <div class="section-head">
        <div>
          <h3 id="publication-gallery-title">Productfoto's</h3>
          <p id="gallery-order-help">
            Nieuwe foto's blijven intern. Publiceer ze bewust via ⋮; sleep de greep voor de volgorde.
          </p>
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
                [class.image-row--menu-open]="publicationMenuImageId() === image.id"
                [attr.data-family-image-index]="i"
                (contextmenu)="openPublicationMenu($event, image.id)">
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
                <div class="publication-state" [attr.aria-label]="publicationSummary(image)">
                  @if (!publishedChannels(image).length) {
                    <span class="publication-chip publication-chip--internal">Alleen intern</span>
                  }
                  <span
                    class="publication-chip"
                    [class.publication-chip--on]="isPublishedTo(image, 'WEBSITE')"
                    [attr.aria-label]="channelAriaLabel(image, 'WEBSITE', 'Website')"
                  ><i aria-hidden="true"></i>Website</span>
                  <span
                    class="publication-chip"
                    [class.publication-chip--on]="isPublishedTo(image, 'CATALOGUE')"
                    [attr.aria-label]="channelAriaLabel(image, 'CATALOGUE', 'Catalogus')"
                  ><i aria-hidden="true"></i>Catalogus</span>
                  @if (isPublishedTo(image, 'ORDER_APP')) {
                    <span class="publication-chip publication-chip--on"><i aria-hidden="true"></i>Bestelapp</span>
                  }
                </div>
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
                <div class="publication-menu-anchor" data-image-publication-menu>
                  <button
                    class="publication-menu-trigger"
                    type="button"
                    [disabled]="busy()"
                    aria-haspopup="menu"
                    [attr.aria-expanded]="publicationMenuImageId() === image.id"
                    [attr.aria-controls]="'image-publication-menu-' + image.id"
                    [attr.aria-label]="'Publicatie van ' + image.originalFilename + ' instellen'"
                    (click)="togglePublicationMenu($event, image.id)"
                  >⋮</button>
                  @if (publicationMenuImageId() === image.id) {
                    <div
                      class="publication-menu"
                      [class.publication-menu--above]="publicationMenuPlacement() === 'above'"
                      role="menu"
                      [id]="'image-publication-menu-' + image.id"
                      [attr.aria-label]="'Publicatie van ' + image.originalFilename"
                    >
                      <div class="publication-menu__head">
                        <b>Publiceren naar</b>
                        <small>Kies waar klanten deze foto zien.</small>
                      </div>
                      @for (option of publicationChannels; track option.channel) {
                        <button
                          class="publication-option"
                          type="button"
                          role="menuitemcheckbox"
                          [disabled]="busy()"
                          [attr.aria-checked]="isPublishedTo(image, option.channel)"
                          (click)="togglePublicationChannel(image, option.channel)"
                        >
                          <span
                            class="publication-option__check"
                            [class.publication-option__check--on]="isPublishedTo(image, option.channel)"
                            aria-hidden="true"
                          >{{ isPublishedTo(image, option.channel) ? '✓' : '' }}</span>
                          <span>
                            <b>{{ option.label }}</b>
                            <small>{{ option.description }}</small>
                          </span>
                        </button>
                      }
                      <div class="publication-menu__footer">
                        <button
                          class="internal-only"
                          type="button"
                          role="menuitem"
                          [disabled]="busy() || !publishedChannels(image).length"
                          (click)="keepInternal(image)"
                        >Alleen intern bewaren</button>
                        @if (!hasAltText(image)) {
                          <small>Voor publicatie is minstens één alt-tekst nodig via Vertalingen.</small>
                        }
                      </div>
                    </div>
                  }
                </div>
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
    .image-list .image-row--menu-open { border-color: var(--line-strong); z-index: 3; }
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
    .publication-state {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    .publication-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      min-height: 24px;
      padding: 3px 7px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: var(--surface);
      color: var(--muted);
      font-size: 12px;
      font-weight: 750;
      line-height: 1;
    }
    .publication-chip i {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--line-strong);
    }
    .publication-chip--on {
      border-color: color-mix(in srgb, var(--ok) 28%, var(--line));
      background: var(--ok-soft);
      color: var(--ok);
    }
    .publication-chip--on i { background: currentColor; }
    .publication-chip--internal {
      border-color: var(--line-strong);
      background: var(--surface-2);
      color: var(--ink-2);
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
    .publication-menu-anchor { position: relative; }
    .publication-menu-trigger {
      font-size: 20px;
      font-weight: 800;
      line-height: 1;
    }
    .publication-menu {
      position: absolute;
      z-index: 20;
      top: calc(100% + 6px);
      right: 0;
      width: min(320px, calc(100vw - 32px));
      max-height: min(430px, calc(100dvh - 24px));
      overflow-x: hidden;
      overflow-y: auto;
      overscroll-behavior: contain;
      border: 1px solid var(--line-strong);
      border-radius: 13px;
      background: var(--surface);
      box-shadow: 0 16px 42px rgb(30 18 20 / 18%);
      color: var(--ink);
    }
    .publication-menu--above {
      top: auto;
      bottom: calc(100% + 6px);
    }
    .publication-menu__head {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 11px 12px 9px;
      border-bottom: 1px solid var(--line);
      text-align: left;
    }
    .publication-menu__head b { font-size: 14px; }
    .publication-menu__head small { color: var(--muted); font-size: 12px; line-height: 1.35; }
    .image-actions .publication-option {
      display: grid;
      width: 100%;
      min-height: 56px;
      height: auto;
      grid-template-columns: 28px minmax(0, 1fr);
      gap: 9px;
      align-items: center;
      padding: 9px 12px;
      border: 0;
      border-bottom: 1px solid var(--line);
      border-radius: 0;
      text-align: left;
    }
    .image-actions .publication-option:hover { background: var(--surface-2); }
    .publication-option > span:last-child { display: flex; min-width: 0; flex-direction: column; gap: 2px; }
    .publication-option b { font-size: 14px; }
    .publication-option small { color: var(--muted); font-size: 12px; line-height: 1.3; }
    .publication-option__check {
      display: grid;
      width: 26px;
      height: 26px;
      place-items: center;
      border: 1px solid var(--line-strong);
      border-radius: 7px;
      background: var(--surface);
      color: #fff;
      font-size: 12px;
    }
    .publication-option__check--on { border-color: var(--rose); background: var(--rose); }
    .publication-menu__footer { display: grid; gap: 6px; padding: 9px 12px 11px; }
    .image-actions .internal-only {
      width: 100%;
      min-height: 44px;
      height: 44px;
      justify-self: stretch;
      padding: 0 4px;
      border: 0;
      background: transparent;
      color: var(--rose);
      font-size: 14px;
      font-weight: 750;
      text-align: left;
    }
    .image-actions .internal-only:disabled { color: var(--muted); }
    .publication-menu__footer small { color: var(--warn); font-size: 12px; line-height: 1.35; }
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
  readonly publicationMenuImageId = signal<number | null>(null);
  readonly publicationMenuPlacement = signal<ProductImagePublicationMenuPlacement>('below');
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

  publicationSummary(image: ProductFamilyImage): string {
    const channels = this.publishedChannels(image);
    if (!channels.length) return 'Alleen intern; niet gepubliceerd';
    const labels = PUBLICATION_CHANNELS
      .filter((option) => channels.includes(option.channel))
      .map((option) => option.label);
    return `Gepubliceerd naar ${labels.join(', ')}`;
  }

  channelAriaLabel(image: ProductFamilyImage, channel: CatalogChannel, label: string): string {
    return `${label}: ${this.isPublishedTo(image, channel) ? 'gepubliceerd' : 'niet gepubliceerd'}`;
  }

  hasAltText(image: ProductFamilyImage): boolean {
    return image.altTexts.some((item) => Boolean(item.alt?.trim()));
  }

  togglePublicationMenu(event: MouseEvent, imageId: number): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.busy()) return;
    if (this.publicationMenuImageId() !== imageId) this.placePublicationMenu(event.currentTarget);
    this.publicationMenuImageId.update((current) => current === imageId ? null : imageId);
  }

  openPublicationMenu(event: MouseEvent, imageId: number): void {
    if (this.busy()) return;
    event.preventDefault();
    event.stopPropagation();
    this.placePublicationMenu(event.currentTarget);
    this.publicationMenuImageId.set(imageId);
  }

  togglePublicationChannel(image: ProductFamilyImage, channel: CatalogChannel): void {
    if (this.busy()) return;
    const selected = new Set(this.publishedChannels(image));
    if (selected.has(channel)) selected.delete(channel); else selected.add(channel);
    const channels = PUBLICATION_CHANNELS
      .map((option) => option.channel)
      .filter((option) => selected.has(option));
    this.publicationMenuImageId.set(null);
    this.imagePublicationChangeRequested.emit({ imageId: image.id, channels });
  }

  keepInternal(image: ProductFamilyImage): void {
    if (this.busy() || !this.publishedChannels(image).length) return;
    this.publicationMenuImageId.set(null);
    this.imagePublicationChangeRequested.emit({ imageId: image.id, channels: [] });
  }

  @HostListener('document:pointerdown', ['$event'])
  closePublicationMenuOnOutsidePress(event: PointerEvent): void {
    const target = event.target;
    if (!(target instanceof Element) || !target.closest('[data-image-publication-menu]')) {
      this.publicationMenuImageId.set(null);
    }
  }

  @HostListener('document:keydown.escape')
  closePublicationMenu(): void {
    this.publicationMenuImageId.set(null);
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

  private placePublicationMenu(target: EventTarget | null): void {
    if (!(target instanceof Element)) {
      this.publicationMenuPlacement.set('below');
      return;
    }
    const bounds = target.getBoundingClientRect();
    this.publicationMenuPlacement.set(productImagePublicationMenuPlacement(
      bounds.top,
      bounds.bottom,
      window.innerHeight,
    ));
  }
}
