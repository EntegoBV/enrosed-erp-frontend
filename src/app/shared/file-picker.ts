import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthImage } from '../core/api/auth-image';
import { messageOf } from '../core/api/errors';
import { MediaApi } from '../core/api/media-api';
import { MediaAssetSummary, MediaFolder, MediaKind } from '../core/api/media-models';
import { Sheet, Ui } from './ui';

/**
 * Pick files from the library anywhere in the ERP: a sheet with the folder
 * chips, a search box and a grid of cards. Upload straight into it when the
 * file is not there yet. The sheet only reports what was chosen; the caller
 * decides what a chosen file becomes (a product photo, a purchase document).
 */
@Component({
  selector: 'app-file-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Sheet, AuthImage],
  template: `
    <app-sheet [title]="title()" [wide]="true" (closed)="closed.emit()">
      <div body class="fp">
        <div class="fp__bar">
          <input class="input fp__search" type="search" autocomplete="off" placeholder="Zoek op naam of bestandsnaam…"
                 aria-label="Zoeken in de bibliotheek" [ngModel]="query()" (ngModelChange)="changeQuery($event)" />
          <label class="btn btn--sm fp__upload">
            {{ uploading() ? 'Uploaden…' : '+ Uploaden' }}
            <input type="file" hidden [multiple]="multiple()" [accept]="accept()" [disabled]="uploading()" (change)="chooseFiles($event)" />
          </label>
        </div>
        <div class="fp__folders" role="tablist" aria-label="Mappen">
          <button type="button" [class.on]="folder() === null" (click)="selectFolder(null)">Alles</button>
          <button type="button" [class.on]="folder() === 'root'" (click)="selectFolder('root')">Zonder map</button>
          @for (item of folders(); track item.id) {
            <button type="button" [class.on]="folder() === item.id" (click)="selectFolder(item.id)">
              {{ folderPath(item) }}<small>{{ item.assetCount }}</small>
            </button>
          }
        </div>
        @if (loading()) {
          <p class="hint fp__state">Bibliotheek laden…</p>
        } @else if (error()) {
          <p class="hint fp__state">{{ error() }} <button class="linklike" type="button" (click)="reload()">Opnieuw</button></p>
        } @else if (!assets().length) {
          <p class="hint fp__state">Niets gevonden. Upload een bestand of kies een andere map.</p>
        } @else {
          <div class="fp__grid" role="listbox" [attr.aria-multiselectable]="multiple()">
            @for (asset of assets(); track asset.id) {
              <button class="fp__card" type="button" role="option" [class.on]="isChosen(asset)" [attr.aria-selected]="isChosen(asset)"
                      (click)="toggle(asset)" (dblclick)="pickNow(asset)" [title]="asset.originalFilename">
                @if (asset.kind === 'IMAGE') {
                  <img [appAuthSrc]="media.thumbnailUrl(asset.id)" alt="" loading="lazy" />
                } @else {
                  <i aria-hidden="true">{{ extension(asset) }}</i>
                }
                <span><b>{{ asset.name }}</b><small>{{ size(asset.sizeBytes) }}@if (asset.share) { · publiek }</small></span>
                @if (isChosen(asset)) { <em aria-hidden="true">✓</em> }
              </button>
            }
          </div>
        }
      </div>
      <div foot style="display:contents">
        <span class="spacer fp__count">@if (chosen().length) { {{ chosen().length }} gekozen }</span>
        <button class="btn" type="button" (click)="closed.emit()">Annuleren</button>
        <button class="btn btn--primary" type="button" [disabled]="!chosen().length" (click)="confirm()">
          {{ multiple() ? 'Kiezen' : 'Kies dit bestand' }}
        </button>
      </div>
    </app-sheet>
  `,
  styles: [`
    :host{display:contents}
    .fp{display:grid;gap:10px}
    .fp__bar{display:flex;gap:8px}.fp__search{flex:1}.fp__upload{cursor:pointer}
    .fp__folders{display:flex;flex-wrap:wrap;gap:4px}
    .fp__folders button{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border:1px solid var(--line);border-radius:999px;background:var(--surface);color:var(--ink-2);font:inherit;font-size:12px;font-weight:600;cursor:pointer}
    .fp__folders button small{color:var(--muted);font-size:10.5px}.fp__folders button.on{border-color:var(--rose);background:var(--rose-soft);color:var(--rose-dark)}
    .fp__state{padding:24px 0;text-align:center}
    .fp__grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:8px;max-height:52vh;overflow-y:auto;padding:2px}
    .fp__card{position:relative;display:grid;gap:6px;padding:6px;border:2px solid var(--line);border-radius:12px;background:var(--surface);font:inherit;text-align:left;cursor:pointer}
    .fp__card:hover{border-color:var(--line-strong)}.fp__card.on{border-color:var(--rose);background:var(--rose-soft)}
    .fp__card img,.fp__card>i{display:block;width:100%;aspect-ratio:1;border-radius:8px;object-fit:cover;background:var(--surface-2)}
    .fp__card>i{display:grid;place-items:center;color:var(--muted);font-size:13px;font-style:normal;font-weight:800;letter-spacing:.06em;text-transform:uppercase}
    .fp__card span{display:grid;min-width:0}.fp__card b{overflow:hidden;font-size:12px;text-overflow:ellipsis;white-space:nowrap}.fp__card small{overflow:hidden;color:var(--muted);font-size:10.5px;text-overflow:ellipsis;white-space:nowrap}
    .fp__card em{position:absolute;top:8px;right:8px;display:grid;width:22px;height:22px;place-items:center;border-radius:50%;background:var(--rose);color:#fff;font-size:12px;font-style:normal;font-weight:800}
    .fp__count{color:var(--ok);font-size:12.5px;font-weight:650;text-align:center}
  `],
})
export class FilePicker {
  readonly media = inject(MediaApi);
  private readonly ui = inject(Ui);

  /** Narrow the library to one kind; null shows everything. */
  readonly kind = input<MediaKind | null>(null);
  readonly multiple = input(false);
  readonly title = input('Kies uit de bibliotheek');

  readonly picked = output<MediaAssetSummary[]>();
  readonly closed = output<void>();

  readonly query = signal('');
  readonly folder = signal<number | 'root' | null>(null);
  readonly folders = signal<MediaFolder[]>([]);
  readonly assets = signal<MediaAssetSummary[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly uploading = signal(false);
  readonly chosen = signal<MediaAssetSummary[]>([]);

  readonly accept = computed(() => this.kind() === 'IMAGE' ? 'image/*' : this.kind() === 'DOCUMENT' ? '.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt' : '*/*');

  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private requestId = 0;

  constructor() {
    void this.media.folders().then((folders) => this.folders.set(folders)).catch(() => {});
    void this.reload();
  }

  folderPath(folder: MediaFolder): string {
    const byId = new Map(this.folders().map((item) => [item.id, item]));
    const names: string[] = [];
    for (let cursor: MediaFolder | undefined = folder; cursor && names.length < 6; cursor = cursor.parentId === null ? undefined : byId.get(cursor.parentId)) {
      names.unshift(cursor.name);
    }
    return names.join(' / ');
  }

  async reload(): Promise<void> {
    const requestId = ++this.requestId;
    this.loading.set(true);
    this.error.set('');
    try {
      const folder = this.folder();
      const assets = await this.media.assets({
        q: this.query(), kind: this.kind() ?? undefined, limit: 200,
        folder: folder === null ? undefined : folder,
      });
      if (requestId !== this.requestId) return;
      this.assets.set(assets);
    } catch (failure) {
      if (requestId !== this.requestId) return;
      this.error.set(messageOf(failure, 'De bibliotheek kon niet worden geladen.'));
    } finally {
      if (requestId === this.requestId) this.loading.set(false);
    }
  }

  changeQuery(value: string): void {
    this.query.set(value);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => void this.reload(), 220);
  }

  selectFolder(folder: number | 'root' | null): void {
    this.folder.set(folder);
    void this.reload();
  }

  isChosen(asset: MediaAssetSummary): boolean {
    return this.chosen().some((item) => item.id === asset.id);
  }

  toggle(asset: MediaAssetSummary): void {
    if (this.multiple()) {
      this.chosen.update((items) => this.isChosen(asset) ? items.filter((item) => item.id !== asset.id) : [...items, asset]);
    } else {
      this.chosen.set(this.isChosen(asset) ? [] : [asset]);
    }
  }

  pickNow(asset: MediaAssetSummary): void {
    this.picked.emit([asset]);
  }

  confirm(): void {
    if (this.chosen().length) this.picked.emit(this.chosen());
  }

  /** Uploads into the open folder and pre-selects what arrived. */
  async chooseFiles(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (!files.length) return;
    this.uploading.set(true);
    const folder = this.folder();
    const added: MediaAssetSummary[] = [];
    try {
      for (const file of files) {
        const result = await this.media.upload(file, undefined, typeof folder === 'number' ? folder : null);
        added.push(result.asset);
      }
      await this.reload();
      this.chosen.set(this.multiple() ? [...this.chosen(), ...added] : added.slice(-1));
      this.ui.toast(`${added.length} bestand${added.length === 1 ? '' : 'en'} toegevoegd aan de bibliotheek`);
    } catch (failure) {
      this.ui.toast(messageOf(failure, 'Uploaden mislukt'), 'err');
    } finally {
      this.uploading.set(false);
    }
  }

  extension(asset: MediaAssetSummary): string {
    const name = asset.originalFilename || asset.name;
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(dot + 1).slice(0, 4) : 'doc';
  }

  size(bytes: number): string {
    if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toLocaleString('nl-BE', { maximumFractionDigits: 1 })} MB`;
    if (bytes >= 1024) return `${Math.round(bytes / 1024)} kB`;
    return `${bytes} B`;
  }
}
