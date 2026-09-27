import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, signal } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { AuthImage } from '../../core/api/auth-image';
import { saveBlob } from '../../core/api/download';
import { messageOf } from '../../core/api/errors';
import { MediaAssetSummary } from '../../core/api/media-models';
import { Icon } from '../../shared/icon';
import { Ui } from '../../shared/ui';
import { badgeText, extensionTone, extensionToneClass, fileKindLabel } from './files-collections';
import { hasWeb, sizeLabel } from './files-rules';
import { FilesController } from './files-controller';

/**
 * Quick Look: the file big, stepping through the files as they are listed.
 * On a desk a dark layer over the page (←/→ step, space or esc closes); on
 * a phone a black full screen with a swipe to step. Photos show the web
 * size with the original on request; a PDF opens in a frame on a desk and
 * through the system viewer on a phone (iOS frames show one page only).
 * Always rendered at page-host level, above the sheets.
 */
@Component({
  selector: 'app-files-quick-look',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AuthImage, Icon],
  host: {
    'data-kit-overlay': '',
    class: 'files-ql',
    '[class.files-ql--screen]': '!c.desktop.active()',
    role: 'dialog',
    'aria-modal': 'true',
    '[attr.aria-label]': "'Snel bekijken: ' + (asset()?.name ?? '')",
    '(window:keydown)': 'onKey($event)',
    '(pointerdown)': 'swipeStart($event)',
    '(pointerup)': 'swipeEnd($event)',
  },
  template: `
    @let state = c.quickLook();
    @let file = asset();
    <header class="files-ql__bar">
      @if (!c.desktop.active()) {
        <button class="files-ql__icon" type="button" aria-label="Sluiten" (click)="c.closeQuickLook()"><app-icon name="chevron-left" [size]="24" /></button>
      }
      <span class="files-ql__title"><b>{{ file?.name }}</b>@if (state && state.ids.length > 1) { <small>{{ state.index + 1 }} / {{ state.ids.length }}</small> }</span>
      @if (c.desktop.active()) {
        <span class="files-ql__tools">
          @if (file && isImage(file) && web(file)) {
            <button class="files-ql__btn" type="button" [attr.aria-pressed]="!!state?.original" (click)="toggleOriginal()">Toon origineel</button>
          }
          <button class="files-ql__btn" type="button" (click)="c.quickLookInfo()"><app-icon name="info" [size]="16" />Info</button>
          <button class="files-ql__btn" type="button" [disabled]="!file || c.downloading()" (click)="file && c.download(file)"><app-icon name="download" [size]="16" />Downloaden</button>
          <button #close class="files-ql__icon" type="button" aria-label="Sluiten" (click)="c.closeQuickLook()"><app-icon name="close" [size]="20" /></button>
        </span>
      } @else if (file && isImage(file) && web(file)) {
        <button class="files-ql__icon" type="button" aria-label="Meer" aria-haspopup="menu" (click)="moreMenu(file)"><app-icon name="more" [size]="22" /></button>
      }
    </header>

    <div class="files-ql__stage" (click)="stageClick($event)">
      @if (!file) {
        <p class="files-ql__note">Laden…</p>
      } @else if (isImage(file)) {
        <img class="files-ql__image" [appAuthSrc]="c.media.fileUrl(file.id, state?.original || !file.web ? 'original' : 'web')" appAuthSize="original" [alt]="file.name" />
      } @else if (isPdf(file) && c.desktop.active()) {
        @if (pdfUrl(); as url) { <iframe class="files-ql__pdf" [src]="url" [title]="file.name"></iframe> }
        @else { <p class="files-ql__note">Laden…</p> }
      } @else {
        <div class="files-ql__card">
          <span class="files-ext files-ext--lg" [class]="tone(file)">{{ badge(file) }}</span>
          <b>{{ file.name }}</b>
          <small>{{ kind(file) }} · {{ size(file.sizeBytes) }}</small>
          @if (isPdf(file)) {
            <button class="ios-capsule ios-capsule--accent" type="button" [disabled]="c.downloading()" (click)="openPdf(file)">Openen</button>
          } @else {
            <button class="files-ql__btn" type="button" [disabled]="c.downloading()" (click)="c.download(file)"><app-icon name="download" [size]="16" />Downloaden</button>
          }
        </div>
      }
      @if (c.desktop.active() && state && state.ids.length > 1) {
        <button class="files-ql__step files-ql__step--prev" type="button" aria-label="Vorige" [disabled]="state.index === 0" (click)="c.stepQuickLook(-1)"><app-icon name="chevron-left" [size]="26" /></button>
        <button class="files-ql__step files-ql__step--next" type="button" aria-label="Volgende" [disabled]="state.index === state.ids.length - 1" (click)="c.stepQuickLook(1)"><app-icon name="chevron-right" [size]="26" /></button>
      }
    </div>

    @if (!c.desktop.active() && file) {
      <nav class="ios-toolbar files-ql__toolbar" aria-label="Bestand">
        <button class="ios-toolbar__btn" type="button" [disabled]="file.archived" (click)="share(file)"><app-icon name="share" [size]="22" />Deel</button>
        <button class="ios-toolbar__btn" type="button" [disabled]="c.downloading()" (click)="c.download(file)"><app-icon name="download" [size]="22" />Download</button>
        <button class="ios-toolbar__btn" type="button" (click)="c.quickLookInfo()"><app-icon name="info" [size]="22" />Info</button>
      </nav>
    }
  `,
})
export class FilesQuickLook {
  readonly c = inject(FilesController);
  private readonly ui = inject(Ui);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly asset = computed(() => this.c.quickLookAsset());
  readonly pdfUrl = signal<SafeResourceUrl | null>(null);
  private objectUrl: string | null = null;
  private pdfFor: number | null = null;
  private swipeX: number | null = null;
  /** Where the focus was when Quick Look opened (the row), and goes back to on close. */
  private readonly opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  constructor() {
    /* Each step loads a PDF afresh (desk) and lets go of the previous one. */
    effect(() => {
      const file = this.asset();
      if (file?.id === this.pdfFor) return;
      this.revoke();
      if (file && this.isPdf(file) && this.c.desktop.active()) void this.loadPdf(file);
    });
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>('.files-ql__icon')?.focus({ preventScroll: true }));
    inject(DestroyRef).onDestroy(() => {
      this.revoke();
      document.body.style.overflow = previousOverflow;
      if (this.opener?.isConnected) this.opener.focus({ preventScroll: true });
    });
  }

  isImage(file: MediaAssetSummary): boolean { return file.kind === 'IMAGE'; }
  isPdf(file: MediaAssetSummary): boolean { return extensionTone(file) === 'pdf'; }
  web(file: MediaAssetSummary): boolean { return hasWeb(file); }
  badge(file: MediaAssetSummary): string { return badgeText(file); }
  tone(file: MediaAssetSummary): string { return extensionToneClass(file); }
  kind(file: MediaAssetSummary): string { return fileKindLabel(file); }
  size(bytes: number): string { return sizeLabel(bytes); }

  toggleOriginal(): void {
    this.c.quickLook.update((state) => state && ({ ...state, original: !state.original }));
  }

  /** The phone's ⋯: a menu, as on iOS, with the one choice there is. */
  moreMenu(file: MediaAssetSummary): void {
    this.c.menu.set({
      title: file.name,
      items: [{ id: 'original', label: 'Toon origineel', iconName: 'image', checked: !!this.c.quickLook()?.original }],
      anchor: null,
      run: () => this.toggleOriginal(),
    });
  }

  /** The phone's Deel: back to the file screen, where the share sheet lives. */
  share(file: MediaAssetSummary): void {
    this.c.quickLookInfo();
    this.c.openShareSheet(file);
  }

  onKey(event: KeyboardEvent): void {
    if (document.querySelector('.overlay, .cm')) return;
    if (event.key === 'Tab') { this.keepFocus(event); return; }
    switch (event.key) {
      case 'ArrowLeft': this.c.stepQuickLook(-1); break;
      case 'ArrowRight': this.c.stepQuickLook(1); break;
      case 'Escape': this.c.closeQuickLook(); break;
      case ' ':
        if ((event.target as Element | null)?.closest?.('button')) return;
        this.c.closeQuickLook();
        break;
      default: return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  /** A modal layer: Tab and ⇧Tab go round its own controls, never to the page behind it. */
  private keepFocus(event: KeyboardEvent): void {
    const host = this.host.nativeElement;
    const stops = [...host.querySelectorAll<HTMLElement>('button:not(:disabled), iframe')];
    if (!stops.length) { event.preventDefault(); return; }
    const first = stops[0];
    const last = stops[stops.length - 1];
    const active = document.activeElement;
    const inside = active instanceof Node && host.contains(active);
    if (event.shiftKey && (!inside || active === first)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (!inside || active === last)) { event.preventDefault(); first.focus(); }
  }

  /** A click beside the file on a desk closes, the way Quick Look does. */
  stageClick(event: MouseEvent): void {
    if (this.c.desktop.active() && event.target === event.currentTarget) this.c.closeQuickLook();
  }

  swipeStart(event: PointerEvent): void {
    this.swipeX = this.c.desktop.active() || !event.isPrimary ? null : event.clientX;
  }

  swipeEnd(event: PointerEvent): void {
    if (this.swipeX === null) return;
    const dx = event.clientX - this.swipeX;
    this.swipeX = null;
    if (Math.abs(dx) >= 60) this.c.stepQuickLook(dx < 0 ? 1 : -1);
  }

  /** The phone hands a PDF to the system viewer, never to window.open. */
  async openPdf(file: MediaAssetSummary): Promise<void> {
    try {
      const blob = await this.c.media.download(file.id);
      saveBlob(new Blob([blob], { type: 'application/pdf' }), file.originalFilename || file.name);
    } catch (failure) {
      this.ui.toast(messageOf(failure, 'Openen mislukt'), 'err');
    }
  }

  private async loadPdf(file: MediaAssetSummary): Promise<void> {
    this.pdfFor = file.id;
    try {
      const blob = await this.c.media.download(file.id);
      if (this.pdfFor !== file.id) return;
      this.objectUrl = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
      this.pdfUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(this.objectUrl));
    } catch (failure) {
      if (this.pdfFor === file.id) this.ui.toast(messageOf(failure, 'Het voorbeeld kon niet worden geladen.'), 'err');
    }
  }

  private revoke(): void {
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
    this.pdfUrl.set(null);
    this.pdfFor = null;
  }
}
