import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { DocumentKind } from '../../core/api/models';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { Icon } from '../../shared/icon';
import { Sheet } from '../../shared/ui';
import { AUTO_LABEL, sizeLabel } from './files-rules';
import { FilesController, UploadItem } from './files-controller';

/**
 * The upload tray: everything picked lands in one list first, with where it
 * goes ("Naar") and what it will belong to ("Ook koppelen aan") spelled out
 * and changeable until Uploaden. A file the library already had says where
 * it is and offers to show it, move it here or bring it back from Archief;
 * nothing happens to it without that tap.
 */
@Component({
  selector: 'app-files-upload-tray',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet, Icon],
  template: `
    @if (c.tray(); as tray) {
      <app-sheet [title]="title()" variant="ios" [wide]="desktop.active()" (closed)="c.closeTray()">
        <div body class="files-tray">
          <div class="files-tray__dest">
            <div class="files-tray__row">
              <span class="files-tray__label">Naar</span>
              <span class="files-tray__value">{{ tray.folderId === null ? autoLabel : c.pathOf(tray.folderId) }}</span>
              @if (!tray.done) { <button class="wk-link" type="button" [disabled]="tray.running" (click)="c.pickTrayFolder()">Wijzigen…</button> }
            </div>
            @if (tray.folderId === null && !tray.done) {
              <p class="files-muted">Zonder map komt het in Overig › Foto’s of Documenten en verhuist het vanzelf zodra je het koppelt.</p>
            }
            <div class="files-tray__row" [class.is-hint]="tray.linkHint && !tray.link">
              <span class="files-tray__label">Ook koppelen aan</span>
              <span class="files-tray__value">{{ tray.link?.label || '—' }}</span>
              @if (!tray.done) {
                <button class="wk-link" type="button" [disabled]="tray.running" (click)="c.pickTrayLink()">Kies…</button>
                @if (tray.link) {
                  <button class="wk-btn wk-btn--icon wk-btn--ghost wk-btn--sm" type="button" aria-label="Niet koppelen" [disabled]="tray.running" (click)="c.clearTrayLink()"><app-icon name="close" [size]="14" /></button>
                }
              }
            </div>
            @if (tray.link?.targetType === 'PURCHASE_ORDER' && !tray.done) {
              <label class="files-tray__row files-tray__kind"><span class="files-tray__label">Soort document</span>
                <select class="select" [value]="tray.link!.documentKind ?? 'OTHER'" [disabled]="tray.running" (change)="setKind($any($event.target).value)">
                  <option value="COMMERCIAL_INVOICE">Commercial invoice</option><option value="PACKING_LIST">Packing list</option>
                  <option value="BILL_OF_LADING">Bill of lading</option><option value="CUSTOMS">Douanedocument</option><option value="OTHER">Andere</option>
                </select>
              </label>
            }
            @if (tray.linkHint && !tray.link && !tray.done) { <p class="files-muted files-warn">Zonder koppeling verschijnt het niet in deze weergave.</p> }
          </div>

          <ul class="files-tray__list">
            @for (item of tray.items; track item.id) {
              <li class="files-tray__item" [class.is-done]="item.status === 'done'" [class.is-error]="item.status === 'error'">
                @if (item.preview) { <img [src]="item.preview" alt="" /> } @else { <span class="files-ext">{{ item.extension }}</span> }
                <span class="files-tray__copy">
                  <b>{{ item.file.name }}</b>
                  <small>{{ size(item.file.size) }} · {{ status(item) }}</small>
                  @if (item.status === 'busy') { <i class="files-tray__progress" aria-hidden="true"></i> }
                  @if (item.reused && item.asset) {
                    <span class="files-tray__dedup">
                      <button class="wk-link" type="button" (click)="c.trayShow(item)">Toon</button>
                      @if (tray.folderId !== null && item.asset.folderId !== tray.folderId && !item.asset.archived) {
                        <button class="wk-link" type="button" (click)="c.trayMoveHere(item)">Hierheen verplaatsen</button>
                      }
                      @if (item.asset.archived) { <button class="wk-link" type="button" (click)="c.trayRestore(item)">Terughalen</button> }
                    </span>
                  }
                </span>
                @if (item.status === 'queued' && !tray.running) {
                  <button class="wk-btn wk-btn--icon wk-btn--ghost wk-btn--sm" type="button" aria-label="Uit de lijst halen" (click)="c.dropFromTray(item.id)"><app-icon name="close" [size]="14" /></button>
                } @else if (item.status === 'done') { <app-icon class="ok-text" name="tick" [size]="18" /> }
                @else if (item.status === 'error') { <app-icon class="files-bad" name="alert" [size]="18" /> }
                @else if (item.status === 'busy') { <i class="files-tray__spin" aria-hidden="true"></i> }
              </li>
            }
          </ul>
        </div>
        <div foot style="display:contents">
          @if (!tray.done) {
            <button class="btn" type="button" [disabled]="tray.running" (click)="more.click()">+ Meer kiezen</button>
            <input #more type="file" multiple hidden (change)="c.chooseFiles($event)" />
          }
          <span class="spacer files-tray__status">{{ summary() }}</span>
          @if (tray.done) {
            @if (c.trayStats().failed || c.trayStats().linkFailed) { <button class="btn" type="button" (click)="c.retryTray()">Mislukte opnieuw</button> }
            <button class="btn" type="button" (click)="c.showUploaded()">Toon in map</button>
            <button class="btn btn--primary" type="button" (click)="c.closeTray()">Klaar</button>
          } @else {
            <button class="btn btn--primary" type="button" [disabled]="tray.running || !tray.items.length" (click)="c.startTray()">
              {{ tray.running ? 'Bezig…' : 'Uploaden (' + tray.items.length + ')' }}</button>
          }
        </div>
      </app-sheet>
    }
  `,
})
export class FilesUploadTray {
  readonly c = inject(FilesController);
  readonly desktop = inject(DesktopViewport);
  readonly autoLabel = AUTO_LABEL;

  readonly title = computed(() => {
    const tray = this.c.tray();
    if (!tray) return '';
    if (tray.done) return 'Toegevoegd';
    const count = tray.items.length;
    return `${count} bestand${count === 1 ? '' : 'en'} toevoegen`;
  });

  readonly summary = computed(() => {
    const tray = this.c.tray();
    const stats = this.c.trayStats();
    if (!tray) return '';
    if (tray.running) return `${stats.done + stats.failed} van ${stats.total}…`;
    if (tray.done) {
      return `${stats.done} toegevoegd${stats.failed ? `, ${stats.failed} mislukt` : ''}${stats.linkFailed ? `, ${stats.linkFailed} niet gekoppeld` : ''}`;
    }
    return sizeLabel(stats.size);
  });

  size(bytes: number): string { return sizeLabel(bytes); }

  status(item: UploadItem): string {
    switch (item.status) {
      case 'queued': return 'Wacht';
      case 'busy': return 'Bezig…';
      case 'error': return `Mislukt: ${item.error ?? 'onbekende fout'}`;
    }
    const asset = item.asset;
    let text = item.reused && asset
      ? `Bestond al als ‘${asset.name}’ in ${this.c.pathOf(asset.folderId)}${asset.archived ? ', gearchiveerd' : ''}`
      : 'Toegevoegd';
    if (item.linkWaiting) text += ' · wordt gekoppeld na Terughalen';
    if (item.linkError) text += ` · koppelen mislukt: ${item.linkError}`;
    return text;
  }

  setKind(kind: DocumentKind): void {
    this.c.tray.update((tray) => tray?.link ? { ...tray, link: { ...tray.link, documentKind: kind } } : tray);
  }
}
