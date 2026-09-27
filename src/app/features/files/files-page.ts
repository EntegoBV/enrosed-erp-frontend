import { ChangeDetectionStrategy, Component, HostListener, inject } from '@angular/core';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { ContextMenu } from '../../shared/context-menu';
import { Icon } from '../../shared/icon';
import { Sheet } from '../../shared/ui';
import { FILES_SHORTCUTS } from './files-keys';
import { FilesController } from './files-controller';
import { FilesDesktop } from './files-desktop';
import { FilesFolderPicker } from './files-folder-picker';
import { FilesLinkPicker } from './files-link-picker';
import { FilesPhone } from './files-phone';
import { FilesQuickLook } from './files-quick-look';
import { FilesUploadTray } from './files-upload-tray';

/**
 * Documenten & media: the one library of every photo and document in the
 * ERP. Folders answer "where is it stored", "Gekoppeld aan" answers "what
 * does it belong to", Recent answers "what did we touch lately", Archief
 * keeps what was put away.
 *
 * This shell picks the desk or the phone view and renders what must sit at
 * page-host level (menus, sheets, Quick Look: never inside a size
 * container, a transformed row or a blurred bar). The logic lives in
 * FilesController, one per visit; the styles in styles/files-workspace.scss
 * and styles/files-phone.scss.
 */
@Component({
  selector: 'app-files-page',
  host: { class: 'files-workspace', id: 'files-workspace', '(dragover)': 'guardDrop($event)', '(drop)': 'guardDrop($event)' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [FilesController],
  imports: [
    FilesDesktop, FilesPhone, FilesUploadTray, FilesQuickLook, FilesFolderPicker, FilesLinkPicker, ContextMenu, Sheet, Icon,
  ],
  template: `
    @if (desktop.active()) { <app-files-desktop /> } @else { <app-files-phone /> }

    @if (c.menu(); as menu) {
      <app-context-menu [title]="menu.title" [items]="menu.items" [anchor]="menu.anchor"
                        [variant]="desktop.active() ? 'default' : 'ios'" [cancelLabel]="desktop.active() ? '' : 'Annuleren'"
                        (pick)="c.pickMenu($event)" (closed)="c.closeMenu()" />
    }
    @if (c.tray() && c.trayOpen()) { <app-files-upload-tray /> }
    @if (c.folderPicker()) { <app-files-folder-picker /> }
    @if (c.linkPicker()) { <app-files-link-picker /> }
    @if (c.folderDraft(); as draft) {
      <app-sheet [title]="draft.id === null ? 'Nieuwe map' : 'Map bewerken'" variant="ios" (closed)="c.folderDraft.set(null)">
        <form body class="files-draft" (submit)="$event.preventDefault(); c.saveFolder()">
          <label class="field"><span>Naam</span>
            <input class="input" type="text" placeholder="Mapnaam" maxlength="120" autocomplete="off" data-initial-focus
                   [value]="draft.name" (input)="c.folderDraft.set({ ...draft, name: value($event) })" /></label>
          <div class="field"><span>In map</span>
            <button class="files-draft__parent" type="button" (click)="c.pickDraftParent()">
              <app-icon name="folder" [size]="17" /><span>{{ draft.parentId === null ? 'Mappen (bovenaan)' : c.pathOf(draft.parentId) }}</span><app-icon name="chevron-right" [size]="16" />
            </button>
          </div>
        </form>
        <div foot style="display:contents">
          <span class="spacer"></span>
          @if (desktop.active()) { <button class="btn" type="button" (click)="c.folderDraft.set(null)">Annuleren</button> }
          <button class="btn btn--primary" type="button" [disabled]="!draft.name.trim()" (click)="c.saveFolder()">{{ draft.id === null ? 'Maken' : 'Bewaren' }}</button>
        </div>
      </app-sheet>
    }
    @if (c.shortcutsOpen()) {
      <app-sheet title="Sneltoetsen" (closed)="c.shortcutsOpen.set(false)">
        <div body>
          <dl class="files-keys">
            @for (shortcut of shortcuts; track shortcut.keys) { <div><dt><kbd class="wk-kbd">{{ shortcut.keys }}</kbd></dt><dd>{{ shortcut.label }}</dd></div> }
          </dl>
          <p class="files-muted">Eén klik kiest en toont een bestand; dubbelklik of ↵ opent een map of bekijkt een bestand. Rechtsklik geeft alle acties.</p>
        </div>
      </app-sheet>
    }
    @if (c.quickLook()) { <app-files-quick-look /> }

    <input id="files-upload" type="file" multiple hidden (change)="c.chooseFiles($event)" />
    <input id="files-replace-version" type="file" hidden (change)="c.replaceVersion($event)" />
    <!-- A phone opens its keyboard only inside a tap: rename focuses this first, then the name field. -->
    <input id="files-focus-proxy" class="files-focus-proxy" type="text" tabindex="-1" aria-hidden="true" autocomplete="off" />
  `,
})
export class FilesPage {
  readonly c = inject(FilesController);
  readonly desktop = inject(DesktopViewport);
  readonly shortcuts = FILES_SHORTCUTS;

  value(event: Event): string { return (event.target as HTMLInputElement).value; }

  /**
   * Files from the computer let go anywhere but the list (the toolbar, the
   * status bar, a sheet) must not open in the tab and leave the ERP. The
   * list handles its own drops first.
   */
  guardDrop(event: DragEvent): void {
    if (event.defaultPrevented || this.c.store.dragPayload() || !event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'none';
  }

  /** ⌘/Ctrl+V with files on the clipboard adds them to the tray (desk). */
  @HostListener('window:paste', ['$event'])
  onPaste(event: ClipboardEvent): void {
    if (!this.desktop.active() || !event.clipboardData) return;
    const files = Array.from(event.clipboardData.files ?? []);
    if (!files.length) return;
    const target = event.target as HTMLElement | null;
    if (target && /^(input|textarea)$/i.test(target.tagName)) return;
    event.preventDefault();
    this.c.queueFiles(files, false);
  }
}
