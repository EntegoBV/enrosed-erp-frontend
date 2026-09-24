import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { Icon } from '../../shared/icon';
import { Sheet } from '../../shared/ui';
import { AUTO_LABEL, pathLabel } from './files-rules';
import { FilesController, FolderTarget } from './files-controller';

/**
 * Choosing a folder, for every question that needs one: where files move
 * to, where an upload lands, under which folder a folder goes. The top row
 * says what "no folder" means in that question (for an upload the server
 * files it in Overig). Folders where the moved folder cannot land are
 * disabled; a new folder can be made right under the highlighted row.
 */
@Component({
  selector: 'app-files-folder-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet, Icon],
  template: `
    @if (c.folderPicker(); as state) {
      <app-sheet [title]="state.title" variant="ios" (closed)="cancel()">
        <div body class="files-picker">
          <label class="files-picker__filter">
            <app-icon name="search" [size]="16" />
            <input type="search" placeholder="Zoek een map" autocomplete="off" aria-label="Zoek een map"
                   [value]="filter()" (input)="filter.set(value($event))" />
          </label>
          <div class="files-picker__list" role="listbox" [attr.aria-label]="state.title">
            @if (!filter()) {
              <button class="files-picker__row files-picker__row--top" type="button" role="option"
                      [attr.aria-selected]="chosen() === topValue()" (click)="chosen.set(topValue())">
                <app-icon [name]="state.mode === 'upload' ? 'layers' : 'folder'" [size]="18" />
                <span class="files-picker__name">{{ topLabel() }}</span>
                @if (state.current === topValue()) { <small class="files-picker__here">hier</small> }
              </button>
            }
            @for (row of rows(); track row.id) {
              <button class="files-picker__row" type="button" role="option" [style.--depth]="row.depth"
                      [disabled]="!row.can" [attr.aria-selected]="chosen() === row.id" (click)="chosen.set(row.id)">
                <app-icon name="folder" [size]="18" />
                <span class="files-picker__name">{{ row.label }}</span>
                <small>{{ row.direct }}</small>
                @if (state.current === row.id) { <small class="files-picker__here">hier</small> }
              </button>
            } @empty {
              @if (filter()) { <p class="files-muted files-picker__empty">Geen map met “{{ filter() }}”.</p> }
            }
          </div>
          @if (!creating() && !desktop.active()) {
            <button class="files-picker__add" type="button" (click)="startNew()"><app-icon name="plus" [size]="18" />Nieuwe map…</button>
          }
          @if (creating()) {
            <form class="files-picker__new" (submit)="$event.preventDefault(); create()">
              <app-icon name="folder" [size]="18" />
              <input type="text" maxlength="120" autocomplete="off" data-initial-focus aria-label="Naam van de nieuwe map"
                     [placeholder]="'Nieuwe map in ' + parentName()" [value]="newName()" (input)="newName.set(value($event))" />
              <button class="btn btn--sm btn--primary" type="submit" [disabled]="!newName().trim() || saving()">Maken</button>
            </form>
          }
        </div>
        <div foot style="display:contents">
          @if (!creating() && desktop.active()) { <button class="btn" type="button" (click)="startNew()">Nieuwe map…</button> }
          <span class="spacer"></span>
          @if (desktop.active()) { <button class="btn" type="button" (click)="cancel()">Annuleren</button> }
          <button class="btn btn--primary" type="button" [disabled]="chosen() === undefined" (click)="confirm()">{{ state.confirmLabel }}</button>
        </div>
      </app-sheet>
    }
  `,
})
export class FilesFolderPicker {
  readonly c = inject(FilesController);
  readonly desktop = inject(DesktopViewport);

  readonly filter = signal('');
  readonly chosen = signal<FolderTarget | undefined>(undefined);
  readonly creating = signal(false);
  readonly newName = signal('');
  readonly saving = signal(false);

  readonly topValue = computed<FolderTarget>(() => this.c.folderPicker()?.mode === 'upload' ? 'auto' : null);
  readonly topLabel = computed(() => {
    switch (this.c.folderPicker()?.mode) {
      case 'upload': return AUTO_LABEL;
      case 'parent': return 'Mappen (bovenaan)';
      default: return 'Zonder map (bovenaan)';
    }
  });

  /** The tree with direct counts; a filter lists matching folders by their full path. */
  readonly rows = computed(() => {
    const state = this.c.folderPicker();
    const folders = this.c.store.folders();
    const counts = this.c.store.counts();
    const term = this.filter().trim().toLocaleLowerCase('nl');
    const moving = state?.movingFolderId ?? null;
    return this.c.store.tree()
      .filter((node) => !term || node.name.toLocaleLowerCase('nl').includes(term))
      .map((node) => ({
        id: node.id,
        depth: term ? 0 : node.depth,
        label: term ? pathLabel(folders, node.id) : node.name,
        direct: counts.get(node.id)?.direct ?? 0,
        can: moving === null || this.c.store.canLand(moving, node.id),
      }));
  });

  readonly parentName = computed(() => {
    const chosen = this.chosen();
    return typeof chosen === 'number' ? this.c.store.folder(chosen)?.name ?? 'Mappen' : 'Mappen';
  });

  value(event: Event): string { return (event.target as HTMLInputElement).value; }

  startNew(): void {
    this.newName.set('');
    this.creating.set(true);
  }

  /** The new folder goes under the highlighted row and becomes the choice. */
  async create(): Promise<void> {
    const name = this.newName().trim();
    if (!name || this.saving()) return;
    const chosen = this.chosen();
    this.saving.set(true);
    const folder = await this.c.store.createFolder(name, typeof chosen === 'number' ? chosen : null);
    this.saving.set(false);
    if (!folder) return;
    this.creating.set(false);
    this.filter.set('');
    this.chosen.set(folder.id);
  }

  confirm(): void {
    const state = this.c.folderPicker();
    const chosen = this.chosen();
    if (!state || chosen === undefined) return;
    this.c.folderPicker.set(null);
    state.onPick(chosen);
  }

  cancel(): void {
    const state = this.c.folderPicker();
    this.c.folderPicker.set(null);
    state?.onCancel?.();
  }
}
