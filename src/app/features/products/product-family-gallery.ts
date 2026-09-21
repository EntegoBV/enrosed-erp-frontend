import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
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
    <section class="family-gallery" aria-label="Foto’s van de productreeks" [attr.aria-busy]="busy()">
      <div class="section-head">
        <p id="gallery-order-help">Gedeeld binnen deze reeks. Kies per foto voor welke varianten.</p>
        <button class="btn btn--sm" type="button" [disabled]="busy()" (click)="imageInput.click()">+ Foto toevoegen</button>
        <input #imageInput class="file-input" type="file" [disabled]="busy()"
               accept="image/jpeg,image/png,image/webp,image/gif" (change)="pickImageFile($event)" />
      </div>
      @if (!currentProductIsMember() && currentProductId() !== null) {
        <p class="membership-hint" role="note">Sla de variant eerst op in deze reeks om er een foto aan te koppelen.</p>
      }
      @if (family().images.length) {
        <ol class="image-list" aria-describedby="gallery-order-help">
          @for (image of orderedImages(); track image.id; let i = $index) {
            <li [class.image-row--dragging]="draggingIndex() === i"
                [class.image-row--drop]="draggingIndex() !== null && draggingIndex() !== i && dropTargetIndex() === i"
                [class.image-row--open]="selectedImageId() === image.id"
                [attr.data-family-image-index]="i">
              <div class="image-overview">
                <button class="image-open" type="button" (click)="toggleImage(image.id)" [attr.data-family-image-open]="image.id"
                        [attr.aria-expanded]="selectedImageId() === image.id" [attr.aria-controls]="'family-image-settings-' + image.id"
                        [attr.aria-label]="'Instellingen voor ' + image.originalFilename">
                  <span class="image-preview"><img [appAuthSrc]="image.smallUrl" alt="" draggable="false" /><span class="image-position" aria-hidden="true">{{ i + 1 }}</span></span>
                  <span class="image-copy">
                    <b>{{ scopeLabel(image) }}</b>
                    <span class="image-channel-summary">{{ publicationSummary(image) }}</span>
                    @if (i === 0) { <small class="image-first">Eerste in reeks</small> }
                    @if (!hasAltText(image)) { <small class="image-warning">Alt-tekst ontbreekt</small> }
                  </span>
                  <span class="image-expand" aria-hidden="true">⌄</span>
                </button>
                @if (orderedImages().length > 1) {
                  <button class="drag-handle" type="button" [disabled]="busy()"
                          aria-keyshortcuts="ArrowUp ArrowDown Home End" [attr.aria-label]="orderLabel(image, i)"
                          (click)="announceOrderHelp(image, i)" (keydown)="orderKeydown($event, i, image)"
                          (pointerdown)="startPointerReorder($event, i)" (pointermove)="movePointerReorder($event)"
                          (pointerup)="finishPointerReorder($event)" (pointercancel)="cancelPointerReorder($event)"><span aria-hidden="true">⠿</span></button>
                }
              </div>
              @if (selectedImageId() === image.id) {
                <div class="image-settings" tabindex="-1" [id]="'family-image-settings-' + image.id" aria-label="Instellingen voor reeksfoto">
                  <div class="image-file"><b>{{ image.originalFilename }}</b>@if (i > 0) { <button class="btn btn--sm" type="button" [disabled]="busy()" (click)="makeFirst(image)">Zet vooraan</button> }</div>
                  <label class="variant-link">
                    <span>Deze foto gebruiken voor</span>
                    <select class="select" [ngModel]="image.variantProductId ?? null" [disabled]="busy()" (ngModelChange)="assignVariant(image.id, $event)">
                      <option [ngValue]="null">Alle varianten in deze reeks</option>
                      @for (member of members(); track member.productId) { <option [ngValue]="member.productId">{{ memberLabel(member) }}</option> }
                    </select>
                  </label>
                  <fieldset class="publication-settings">
                    <legend>Publiceren op</legend>
                    <div class="publication-controls">
                      @for (option of publicationChannels; track option.channel) {
                        <button type="button" [disabled]="publicationControlDisabled(image, option.channel)"
                                [class.publication-control--on]="isPublishedTo(image, option.channel)"
                                [attr.aria-pressed]="isPublishedTo(image, option.channel)"
                                [attr.aria-label]="channelAriaLabel(image, option.channel, option.label)"
                                [title]="publicationControlTitle(image, option.channel, option.description)"
                                (click)="togglePublicationChannel(image, option.channel)"><i aria-hidden="true">{{ isPublishedTo(image, option.channel) ? '✓' : '+' }}</i>{{ option.label }}</button>
                      }
                    </div>
                    @if (!hasAltText(image)) { <p>Voeg een alt-tekst toe bij Website &amp; publicatie om deze foto te publiceren.</p> }
                  </fieldset>
                  @if (translationEditing()) {
                    <label class="alt-field"><span>Alt-tekst · {{ language() }}</span><input class="input" [ngModel]="imageAlt(image)" [disabled]="busy()" (ngModelChange)="patchImageAlt(image.id, $event)" placeholder="Beschrijf wat op deze foto staat" /></label>
                  }
                  <div class="image-settings__foot"><small>De volgorde geldt voor de hele reeks.</small><button class="image-delete" type="button" [disabled]="busy()" (click)="imageDeleteRequested.emit(image.id)">Verwijder uit reeks</button></div>
                </div>
              }
            </li>
          }
        </ol>
        <p class="gallery-footnote">Wijzigingen aan de volgorde bewaren met Opslaan.@if (orderedImages().length > 1) { Sleep via ⠿ of gebruik de pijltjestoetsen. }</p>
        <p class="sr-only" role="status" aria-live="polite">{{ reorderAnnouncement() }}</p>
      } @else {
        <div class="empty-gallery"><b>Nog geen reeksfoto’s</b><small>Nieuwe foto’s blijven intern tot je een publicatiekanaal kiest.</small></div>
      }
    </section>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .family-gallery {
      padding: 0;
      min-width: 0;
    }
    .section-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      margin-bottom: 14px;
    }
    .section-head p {
      max-width: 360px;
      margin: 0;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.5;
    }
    .section-head .btn {
      flex: none;
      min-height: 42px;
    }
    .file-input,
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      margin: -1px;
      padding: 0;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
    .membership-hint {
      margin: 0 0 12px;
      padding: 10px 12px;
      border-radius: 10px;
      background: var(--warn-soft);
      color: var(--ink-2);
      font-size: 12px;
      line-height: 1.5;
    }
    .image-list {
      display: grid;
      gap: 9px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .image-list li {
      position: relative;
      min-width: 0;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: var(--surface);
      transition:
        border-color 0.18s,
        opacity 0.18s,
        transform 0.18s;
    }
    .image-list .image-row--dragging {
      opacity: 0.5;
      transform: scale(0.985);
    }
    .image-list .image-row--drop {
      border-color: var(--rose);
      box-shadow: 0 0 0 3px var(--rose-line);
    }
    .image-list .image-row--open {
      border-color: var(--rose-line);
    }
    .image-overview {
      display: flex;
      align-items: center;
      min-width: 0;
      padding: 8px;
      gap: 8px;
    }
    .image-open {
      display: flex;
      flex: 1;
      min-width: 0;
      align-items: center;
      gap: 13px;
      padding: 0;
      border: 0;
      border-radius: 9px;
      background: transparent;
      color: var(--ink);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .image-preview {
      position: relative;
      display: block;
      flex: none;
      width: 76px;
      height: 76px;
      overflow: hidden;
      border-radius: 9px;
      background: var(--surface-2);
    }
    .image-preview img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: contain;
      padding: 5px;
    }
    .image-position {
      position: absolute;
      top: 4px;
      left: 4px;
      display: grid;
      min-width: 21px;
      height: 21px;
      place-items: center;
      border-radius: 6px;
      background: var(--surface);
      color: var(--muted);
      font-size: 10px;
      font-weight: 650;
      box-shadow: 0 1px 5px #0001;
    }
    .image-copy {
      display: flex;
      flex: 1;
      min-width: 0;
      flex-wrap: wrap;
      gap: 5px 7px;
      align-items: center;
    }
    .image-copy > b {
      flex-basis: 100%;
      font-size: 13px;
      font-weight: 650;
      overflow-wrap: anywhere;
    }
    .image-channel-summary {
      flex-basis: 100%;
      font-size: 11px;
      line-height: 1.5;
      color: var(--muted);
    }
    .image-first,
    .image-warning {
      display: inline-flex;
      align-items: center;
      min-height: 20px;
      border-radius: 5px;
      padding: 2px 6px;
      background: var(--rose-soft);
      color: var(--rose-dark);
      font-size: 10px;
      line-height: 1.3;
    }
    .image-warning {
      background: var(--warn-soft);
      color: var(--warn);
    }
    .image-expand {
      color: var(--muted);
      font-size: 18px;
      transition: transform 0.18s;
    }
    .image-row--open .image-expand {
      transform: rotate(180deg);
    }
    .drag-handle {
      flex: none;
      display: grid;
      place-items: center;
      width: 40px;
      height: 44px;
      padding: 0;
      border: 0;
      border-radius: 9px;
      background: var(--surface-2);
      color: var(--muted);
      font-size: 21px;
      cursor: grab;
      touch-action: none;
      user-select: none;
    }
    .drag-handle:active {
      cursor: grabbing;
    }
    button:focus-visible {
      outline: 2px solid var(--rose);
      outline-offset: 3px;
    }
    button:disabled {
      opacity: 0.45;
      cursor: default;
    }
    .image-settings {
      min-width: 0;
      margin: 0 12px;
      padding: 14px 0;
      border-top: 1px solid var(--line);
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 16px 20px;
      animation: gallery-settings-in 0.18s ease-out;
    }
    .image-file {
      grid-column: 1/-1;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .image-file > b {
      min-width: 0;
      font-size: 12px;
      line-height: 1.5;
      font-weight: 600;
      overflow-wrap: anywhere;
    }
    .image-file > .btn {
      flex: none;
    }
    .variant-link,
    .alt-field {
      display: grid;
      align-content: start;
      gap: 8px;
      min-width: 0;
    }
    .variant-link > span,
    .alt-field > span,
    .publication-settings legend {
      font-size: 12px;
      font-weight: 650;
      line-height: 1.5;
    }
    .variant-link .select {
      width: 100%;
      min-width: 0;
      max-width: 100%;
      height: 42px;
      font-size: 12px;
    }
    .publication-settings {
      min-width: 0;
      border: 0;
      padding: 0;
      margin: 0;
    }
    .publication-settings legend {
      margin-bottom: 8px;
    }
    .publication-settings p {
      margin: 7px 0 0;
      color: var(--muted);
      font-size: 11px;
      line-height: 1.5;
    }
    .publication-controls {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 5px;
    }
    .publication-controls button {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      min-width: 0;
      min-height: 42px;
      padding: 8px 6px;
      border: 1px solid var(--line);
      border-radius: 9px;
      background: var(--surface-2);
      color: var(--muted);
      font: inherit;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
    }
    .publication-controls i {
      font-style: normal;
      font-size: 12px;
    }
    .publication-controls .publication-control--on {
      border-color: var(--rose-line);
      background: var(--rose-soft);
      color: var(--rose-dark);
    }
    .alt-field {
      grid-column: 1/-1;
    }
    .alt-field .input {
      min-width: 0;
      width: 100%;
      font-size: 13px;
    }
    .image-settings__foot {
      grid-column: 1/-1;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .image-settings__foot small {
      color: var(--muted);
      font-size: 11px;
      line-height: 1.5;
    }
    .image-delete {
      min-height: 40px;
      border: 0;
      border-radius: 8px;
      padding: 8px;
      background: transparent;
      color: var(--danger);
      font: inherit;
      font-size: 12px;
      cursor: pointer;
    }
    .gallery-footnote {
      margin: 10px 0 0;
      color: var(--muted);
      font-size: 10px;
      line-height: 1.6;
    }
    .empty-gallery {
      display: grid;
      gap: 5px;
      border: 1px dashed var(--line-strong);
      border-radius: 12px;
      padding: 24px 16px;
      text-align: center;
    }
    .empty-gallery b {
      font-size: 13px;
    }
    .empty-gallery small {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.5;
    }
    @keyframes gallery-settings-in {
      from {
        opacity: 0;
        transform: translateY(4px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
    @media (max-width: 679px) {
      .section-head {
        align-items: stretch;
        flex-direction: column;
        gap: 10px;
      }
      .section-head p {
        max-width: none;
      }
      .section-head .btn {
        min-height: 44px;
        align-self: flex-start;
      }
      .image-overview {
        gap: 5px;
        padding: 8px;
      }
      .image-open {
        gap: 10px;
      }
      .image-preview {
        width: 70px;
        height: 70px;
      }
      .image-copy > b {
        font-size: 12px;
      }
      .image-channel-summary {
        font-size: 10px;
      }
      .image-expand {
        font-size: 16px;
      }
      .drag-handle {
        width: 44px;
        height: 44px;
      }
      .image-settings {
        grid-template-columns: minmax(0, 1fr);
        margin-inline: 11px;
        gap: 14px;
      }
      .image-file {
        align-items: flex-start;
        flex-direction: column;
        gap: 8px;
      }
      .image-file .btn,
      .publication-controls button,
      .image-delete {
        min-height: 44px;
      }
      .variant-link .select,
      .alt-field .input {
        height: 44px;
        font-size: 16px;
      }
      .publication-controls button {
        font-size: 11px;
        padding-inline: 4px;
        gap: 4px;
      }
      .image-settings__foot {
        align-items: flex-start;
        flex-direction: column;
        gap: 6px;
      }
      .image-delete {
        padding-inline: 0;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .image-list li,
      .image-expand {
        transition: none;
      }
      .image-settings {
        animation: none;
      }
    }
  `,

})
export class ProductFamilyGallery {
  private readonly elementRef: ElementRef<HTMLElement> = inject(ElementRef);
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

  readonly selectedImageId = signal<number | null>(null);
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

  constructor() {
    let previousOwner: string | undefined;
    effect(() => {
      const owner = `${this.family().id}:${this.currentProductId()}`;
      const selected = this.selectedImageId();
      if (owner !== previousOwner || (selected !== null && !this.family().images.some(image => image.id === selected))) {
        this.selectedImageId.set(null);
      }
      previousOwner = owner;
    });
  }

  toggleImage(imageId: number): void {
    if (!this.family().images.some(image => image.id === imageId)) return;
    this.selectedImageId.set(this.selectedImageId() === imageId ? null : imageId);
    const familyId = this.family().id;
    requestAnimationFrame(() => {
      if (this.family().id !== familyId || this.selectedImageId() !== imageId) return;
      const panel = this.elementRef.nativeElement.querySelector<HTMLElement>(`#family-image-settings-${imageId}`);
      if (!panel?.getClientRects().length) return;
      panel.focus({ preventScroll: true });
      panel.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    });
  }

  scopeLabel(image: ProductFamilyImage): string {
    if (image.variantProductId == null) return 'Alle varianten';
    const member = this.members().find(item => item.productId === image.variantProductId);
    const label = member ? [member.colour, member.size].filter(Boolean).join(' · ') || member.name : `Variant #${image.variantProductId}`;
    return image.variantProductId === this.currentProductId() ? `Deze variant · ${label}` : label;
  }

  publicationSummary(image: ProductFamilyImage): string {
    const channels = this.publishedChannels(image);
    return PUBLICATION_CHANNELS.filter(option => channels.includes(option.channel)).map(option => option.label).join(' · ') || 'Alleen intern';
  }

  makeFirst(image: ProductFamilyImage): void {
    const index = this.orderedImages().findIndex(item => item.id === image.id);
    if (index > 0) this.reorderTo(index, 0, image.originalFilename);
  }

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
    if (this.publicationControlDisabled(image, channel)
        || !this.family().images.some(item => item.id === image.id)) return;
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
