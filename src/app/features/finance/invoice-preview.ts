import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { saveBlob } from '../../core/api/download';
import { messageOf, readableFailure } from '../../core/api/errors';
import { InvoiceFinderApi } from '../../core/api/invoice-finder-api';
import type { InvoiceFile, InvoiceRow } from '../../core/api/invoice-finder-api';
import { formatBytes } from '../../shared/format-bytes';
import { Icon } from '../../shared/icon';
import { Sheet, Ui } from '../../shared/ui';
import { FinanceState } from './finance-state';
import { InvoiceFinderState } from './invoice-finder-state';
import {
  ACTION_LABELS, downloadName, linkChips, numberText, partyName, previewFacts, previewKind, previewNote, rowActions, statusWord,
} from './invoice-finder';
import type { InvoiceAction } from './invoice-finder';

const statusOf = (failure: unknown): number | undefined => (failure as { status?: number } | null)?.status;
const ACTION_ICONS: Readonly<Record<InvoiceAction, string>> = {
  'open-purchase': 'document', 'open-cost': 'receipt', 'open-sales': 'document', 'open-tica': 'exchange', register: 'bank',
  handled: 'tick', container: 'document', 'clear-mark': 'close', download: 'download',
};

/**
 * Facturen: the row on the address (doc=) with its facts, links, actions
 * and file. On a desk a docked pane (or drawer) with the PDF in a frame; on
 * a phone an inset sheet whose files open in the system viewer (an iOS
 * frame shows only one page) and whose images show inline.
 */
@Component({
  selector: 'app-invoice-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, Sheet],
  host: { style: 'display: contents' },
  template: `
    @if (layout() === 'pane') {
      @if (row(); as row) {
        <div class="wk-inspector__head fin-inv-head">
          <div class="fin-inv-head__text">
            <h2 class="wk-inspector__title fin-inv-head__name">{{ party(row) }}</h2>
            <span class="fin-inv-head__no">{{ number(row) }}</span>
          </div>
          <span [class]="pillClass(row)">{{ status(row) }}</span>
          <button class="wk-btn wk-btn--ghost wk-btn--icon" type="button" aria-label="Voorbeeld sluiten" title="Voorbeeld sluiten" (click)="finder.close()"><app-icon name="close" [size]="16" /></button>
        </div>
        <div class="fin-inv-top">
          <dl class="fin-inv-facts">
            @for (fact of facts(); track fact.label) { <div><dt>{{ fact.label }}</dt><dd>{{ fact.value }}</dd></div> }
          </dl>
          @if (chips().length) {
            <div class="wk-chips fin-inv-links" role="group" aria-label="Gekoppeld">
              @for (chip of chips(); track chip.type + chip.id) { <button class="wk-chip fin-inv-chip" type="button" [title]="chip.title" (click)="finder.openLink(chip)">{{ chip.label }}</button> }
            </div>
          }
          @if (actions().primary || actions().more.length) {
            <div class="fin-inv-actions">
              @if (actions().primary; as primary) {
                <button class="wk-btn wk-btn--primary" type="button" [disabled]="blockedAction(primary)" [attr.title]="blockedAction(primary) ? 'Even laden…' : null" (click)="run(primary, row)">{{ label(primary) }}</button>
              }
              @if (actions().more.includes('download')) {
                <button class="wk-btn" type="button" (click)="run('download', row)"><app-icon name="download" [size]="16" />Downloaden</button>
              }
              @if (rest().length) {
                <button class="wk-btn wk-btn--ghost wk-btn--icon" type="button" aria-label="Meer acties" title="Meer acties" (click)="moreMenu($event, row)"><app-icon name="more" [size]="18" /></button>
              }
            </div>
          }
          @if (blocked(); as text) { <p class="fin-hint fin-inv-blocked">{{ text }}</p> }
          @if (row.files.length > 1) {
            <div class="wk-chips fin-inv-files" role="group" aria-label="Bestanden">
              @for (item of row.files; track item.type + item.id; let index = $index) {
                <button class="wk-chip fin-inv-chip" type="button" [attr.aria-pressed]="fileIndex() === index" [title]="item.name" (click)="fileIndex.set(index)">{{ item.name }}</button>
              }
            </div>
          }
        </div>
        <div class="fin-inv-view">
          @switch (viewState()) {
            @case ('pdf') { <iframe class="fin-inv-frame" [src]="frameUrl()" [title]="'Voorbeeld van ' + (file()?.name ?? '')"></iframe> }
            @case ('image') { <img class="fin-inv-image" [src]="imageUrl()" [alt]="file()?.name ?? ''" /> }
            @case ('loading') { <p class="fin-inv-empty">Voorbeeld laden…</p> }
            @case ('no-pdf') { <div class="fin-inv-empty"><p>Geen voorbeeld in dit XML-bestand.</p><button class="wk-btn wk-btn--sm" type="button" (click)="run('download', row)">Downloaden</button></div> }
            @case ('error') { <div class="fin-inv-empty"><p>{{ previewError() }}</p>@if (file()) { <button class="wk-btn wk-btn--sm" type="button" (click)="run('download', row)">Downloaden</button> }</div> }
            @case ('nofile') { <p class="fin-inv-empty">Geen bestand.</p> }
            @default { <div class="fin-inv-empty"><p>Geen voorbeeld.</p>@if (file()) { <button class="wk-btn wk-btn--sm" type="button" (click)="run('download', row)">Downloaden</button> }</div> }
          }
        </div>
      } @else if (finder.selectedGone()) {
        <div class="wk-inspector__head fin-inv-head"><p class="fin-inv-head__text fin-inv-gone">Deze factuur bestaat niet meer.</p>
          <button class="wk-btn wk-btn--ghost wk-btn--icon" type="button" aria-label="Voorbeeld sluiten" title="Voorbeeld sluiten" (click)="finder.close()"><app-icon name="close" [size]="16" /></button></div>
      } @else {
        <div class="wk-inspector__head fin-inv-head"><p class="fin-inv-head__text fin-inv-gone">Factuur laden…</p>
          <button class="wk-btn wk-btn--ghost wk-btn--icon" type="button" aria-label="Voorbeeld sluiten" title="Voorbeeld sluiten" (click)="finder.close()"><app-icon name="close" [size]="16" /></button></div>
      }
    } @else {
      @if (row(); as row) {
        <app-sheet class="fin-inv-sheet" variant="ios" [title]="party(row)" closeLabel="Sluiten" (closed)="finder.close()">
          <div body class="fin-inv-sheet__body">
            <p class="fin-inv-sheet__no"><span>{{ number(row) }}</span><span [class]="pillClass(row)">{{ status(row) }}</span></p>
            <section class="ios-section">
              <div class="ios-section__head"><h2>Factuur</h2></div>
              <div class="ios-group">
                @for (fact of facts(); track fact.label) {
                  <div class="ios-cell fin-inv-fact"><span class="ios-cell__body"><span class="ios-cell__title">{{ fact.label }}</span></span>
                    <span class="ios-cell__trail fin-inv-fact__trail"><span class="fin-inv-fact__value">{{ fact.value }}</span></span></div>
                }
              </div>
              @if (blocked(); as text) { <p class="ios-section__foot">{{ text }}</p> }
            </section>
            @if (chips().length) {
              <section class="ios-section">
                <div class="ios-section__head"><h2>Gekoppeld</h2></div>
                <div class="ios-group">
                  @for (chip of chips(); track chip.type + chip.id) {
                    <button class="ios-cell" type="button" (click)="finder.openLink(chip)"><span class="ios-cell__body"><span class="ios-cell__title">{{ chip.label }}</span><span class="ios-cell__sub">{{ chip.title }}</span></span>
                      <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" /></button>
                  }
                </div>
              </section>
            }
            @if (row.files.length) {
              <section class="ios-section">
                <div class="ios-section__head"><h2>Bestanden</h2></div>
                <div class="ios-group">
                  @for (item of row.files; track item.type + item.id; let index = $index) {
                    <div class="ios-cell fin-inv-file"><span class="ios-cell__body"><span class="ios-cell__title">{{ item.name }}</span>@if (size(item)) { <span class="ios-cell__sub">{{ size(item) }}</span> }</span>
                      @if (kindOf(item) !== 'none') { <button class="ios-capsule ios-capsule--sm ios-capsule--tinted" type="button" [disabled]="opening()" (click)="view(row, item, index)">Bekijken</button> }</div>
                  }
                </div>
              </section>
              @if (imageUrl() && viewState() === 'image') { <img class="fin-inv-image fin-inv-image--sheet" [src]="imageUrl()" [alt]="file()?.name ?? ''" /> }
            }
          </div>
          <div foot class="fin-inv-sheet__foot">
            @if (actions().primary; as primary) {
              <button class="btn btn--primary" type="button" [disabled]="blockedAction(primary)" [attr.title]="blockedAction(primary) ? 'Even laden…' : null" (click)="run(primary, row)">{{ label(primary) }}</button>
            }
            @if (actions().more.length) {
              <button class="ios-circle fin-inv-sheet__more" type="button" aria-label="Meer acties" (click)="moreMenu(null, row, true)"><app-icon name="more" [size]="22" /></button>
            }
          </div>
        </app-sheet>
      } @else if (finder.selectedGone()) {
        <app-sheet class="fin-inv-sheet" variant="ios" title="Factuur" closeLabel="Sluiten" (closed)="finder.close()">
          <div body><p class="fin-inv-gone">Deze factuur bestaat niet meer.</p></div>
          <div foot class="fin-inv-sheet__foot"><button class="btn" type="button" (click)="finder.close()">Sluiten</button></div>
        </app-sheet>
      }
    }
  `,
})
export class InvoicePreview {
  readonly layout = input<'pane' | 'sheet'>('pane');
  readonly finder = inject(InvoiceFinderState);
  readonly state = inject(FinanceState);
  private readonly api = inject(InvoiceFinderApi);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly ui = inject(Ui);

  readonly row = this.finder.selected;
  readonly fileIndex = signal(0);
  readonly file = computed<InvoiceFile | null>(() => {
    const files = this.row()?.files ?? [];
    return files[this.fileIndex()] ?? files[0] ?? null;
  });
  readonly facts = computed(() => (this.row() ? previewFacts(this.row()!) : []));
  readonly chips = computed(() => (this.row() ? linkChips(this.row()!) : []));
  readonly actions = computed(() => (this.row() ? rowActions(this.row()!) : { primary: null, more: [] as InvoiceAction[] }));
  /** ⋯ on the desk: the rest besides the primary and Downloaden (which has its own button there). */
  readonly rest = computed(() => this.actions().more.filter((action) => action !== 'download'));
  /** One muted line: why it cannot be registered, and/or that its earlier cost was removed. */
  readonly blocked = computed(() => (this.row() ? previewNote(this.row()!) : null));

  readonly frameUrl = signal<SafeResourceUrl | null>(null);
  readonly imageUrl = signal<string | null>(null);
  readonly previewError = signal('');
  private readonly loadState = signal<'idle' | 'loading' | 'ready' | 'no-pdf' | 'error'>('idle');
  readonly opening = signal(false);
  /** What the preview area shows. */
  readonly viewState = computed(() => {
    const file = this.file();
    if (!file) return 'nofile';
    const state = this.loadState();
    if (state === 'ready') return this.imageUrl() ? 'image' : 'pdf';
    if (state === 'loading' || state === 'no-pdf' || state === 'error') return state;
    return 'none';
  });

  private objectUrl: string | null = null;
  private request = 0;

  readonly party = partyName;
  readonly number = numberText;
  readonly kindOf = previewKind;
  status(row: InvoiceRow): string { return statusWord(row).label; }
  pillClass(row: InvoiceRow): string { const tone = statusWord(row).tone; return tone ? `wk-pill tone-${tone}` : 'wk-pill'; }
  label(action: InvoiceAction): string { return ACTION_LABELS[action]; }
  size(file: InvoiceFile): string { return formatBytes(file.sizeBytes); }
  /** Registering needs the bank lines of FinanceState: disabled ("Even laden…") until they are there. */
  blockedAction(action: InvoiceAction): boolean { return action === 'register' && !this.finder.financeReady(); }

  constructor() {
    /* Another row starts on its first file. */
    let rowKey = '';
    effect(() => {
      const key = this.row()?.key ?? '';
      untracked(() => { if (key !== rowKey) { rowKey = key; this.fileIndex.set(0); } });
    });
    /* The desk loads the file into the frame; a late answer for another file is dropped. */
    let fileKey: string | null = null;
    effect(() => {
      const file = this.file();
      const key = file ? `${this.row()?.key}|${file.type}:${file.id}` : '';
      if (this.layout() !== 'pane') return;
      untracked(() => {
        if (key === fileKey) return;
        fileKey = key;
        void this.load(file);
      });
    });
    inject(DestroyRef).onDestroy(() => { this.request++; this.revoke(); });
  }

  private revoke(): void {
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
    this.frameUrl.set(null);
    this.imageUrl.set(null);
  }

  private async load(file: InvoiceFile | null): Promise<void> {
    const ticket = ++this.request;
    this.revoke();
    const kind = file ? previewKind(file) : 'none';
    if (!file || kind === 'none') { this.loadState.set('idle'); return; }
    this.loadState.set('loading');
    try {
      const blob = kind === 'xml' ? await this.api.pdf(file) : kind === 'image' ? await this.api.file(file, 'web') : await this.api.file(file);
      if (ticket !== this.request) return;
      this.objectUrl = URL.createObjectURL(kind === 'image' ? blob : new Blob([blob], { type: 'application/pdf' }));
      if (kind === 'image') this.imageUrl.set(this.objectUrl);
      else this.frameUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(this.objectUrl));
      this.loadState.set('ready');
    } catch (failure) {
      if (ticket !== this.request) return;
      const readable = await readableFailure(failure);
      if (ticket !== this.request) return;
      if (kind === 'xml' && statusOf(readable) === 404) { this.loadState.set('no-pdf'); return; }
      this.previewError.set(messageOf(readable, 'Het voorbeeld kon niet worden geladen.'));
      this.loadState.set('error');
    }
  }

  /** The phone's "Bekijken": a PDF (also the one inside an XML) goes to the system viewer, an image shows in the sheet. */
  async view(row: InvoiceRow, file: InvoiceFile, index: number): Promise<void> {
    const kind = previewKind(file);
    if (kind === 'image') {
      this.fileIndex.set(index);
      await this.load(file);
      return;
    }
    if (this.opening()) return;
    this.opening.set(true);
    try {
      const blob = kind === 'xml' ? await this.api.pdf(file) : await this.api.file(file);
      saveBlob(new Blob([blob], { type: 'application/pdf' }), downloadName(row, file, index).replace(/\.[a-z0-9]{1,5}$/i, '') + '.pdf');
    } catch (failure) {
      const readable = await readableFailure(failure);
      this.ui.toast(kind === 'xml' && statusOf(readable) === 404 ? 'Geen voorbeeld in dit XML-bestand.' : messageOf(readable, 'Openen mislukt.'), 'err');
    } finally {
      this.opening.set(false);
    }
  }

  run(action: InvoiceAction, row: InvoiceRow): void {
    switch (action) {
      case 'open-purchase': case 'open-cost': case 'open-sales': case 'open-tica': this.finder.openSource(row); break;
      case 'register': if (this.finder.financeReady()) this.finder.registering.set(row); break;
      case 'handled': void this.finder.markHandled(row); break;
      case 'container': this.finder.marking.set(row); break;
      case 'clear-mark': void this.finder.clearMark(row); break;
      case 'download': {
        const file = this.file() ?? row.files[0];
        if (file) void this.finder.download(row, file, Math.max(0, row.files.indexOf(file)));
        break;
      }
    }
  }

  /** ⋯: the desk lists what has no button of its own, the phone every secondary action (Downloaden included). */
  moreMenu(event: MouseEvent | null, row: InvoiceRow, phone = false): void {
    const actions = phone ? this.actions().more : this.rest();
    const rect = event ? (event.currentTarget as HTMLElement).getBoundingClientRect() : null;
    this.state.openMenu({
      title: 'Factuur', anchor: rect ? { x: rect.left, y: rect.bottom + 6 } : null, cancelLabel: phone ? 'Annuleren' : undefined,
      items: actions.map((action) => ({ id: action, label: ACTION_LABELS[action], iconName: ACTION_ICONS[action], disabled: this.blockedAction(action),
        hint: this.blockedAction(action) ? 'Even laden…' : undefined })),
      pick: (id) => this.run(id as InvoiceAction, row),
    });
  }
}
