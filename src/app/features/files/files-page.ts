import { ChangeDetectionStrategy, Component, computed, inject, OnDestroy, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthImage } from '../../core/api/auth-image';
import { CatalogApi } from '../../core/api/catalog-api';
import { saveBlob } from '../../core/api/download';
import { messageOf } from '../../core/api/errors';
import { MediaApi } from '../../core/api/media-api';
import {
  MediaAssetDetail, MediaAssetSummary, MediaFolder, MediaKind, MediaRole, MediaTargetType, MediaVariant,
} from '../../core/api/media-models';
import { PlannerApi } from '../../core/api/planner-api';
import { SourcingApi } from '../../core/api/sourcing-api';
import { PageHeader } from '../../shared/page-header';
import { DateTimeNlPipe } from '../../shared/pipes';
import { Ui } from '../../shared/ui';

interface FolderNode extends MediaFolder { depth: number; }
interface TargetOption { id: number; label: string; meta: string | null; }
interface FolderDraft { id: number | null; parentId: number | null; name: string; }

const ROLE_OPTIONS: ReadonlyArray<{ value: MediaRole; label: string }> = [
  { value: 'CATALOGUE', label: 'Catalogus' },
  { value: 'QUOTE', label: 'Offerte' },
  { value: 'INVOICE', label: 'Factuur' },
  { value: 'INTERNAL', label: 'Intern' },
];
const TARGET_OPTIONS: ReadonlyArray<{ value: MediaTargetType; label: string }> = [
  { value: 'PRODUCT', label: 'Product' },
  { value: 'PRODUCT_FAMILY', label: 'Productreeks' },
  { value: 'PURCHASE_ORDER', label: 'Inkooporder' },
  { value: 'PLANNER_ITEM', label: 'Planneritem' },
];
const PAGE = 80;

/** The library seen by use: where the ERP puts files, not where people filed them. */
interface Collection {
  key: string; label: string; hint: string; icon: string;
  filters: { targetType?: MediaTargetType; role?: MediaRole; kind?: MediaKind; linked?: boolean };
}
const COLLECTIONS: readonly Collection[] = [
  { key: 'product', label: 'Productfoto’s', hint: 'per product', icon: '❀', filters: { targetType: 'PRODUCT', kind: 'IMAGE' } },
  { key: 'family', label: 'Reeks- & websitefoto’s', hint: 'per productreeks', icon: '◫', filters: { targetType: 'PRODUCT_FAMILY' } },
  { key: 'purchase', label: 'Inkoopdocumenten', hint: 'per inkooporder', icon: '▤', filters: { targetType: 'PURCHASE_ORDER' } },
  { key: 'planner', label: 'Planner', hint: 'per planneritem', icon: '▥', filters: { targetType: 'PLANNER_ITEM' } },
  { key: 'quote', label: 'Offertes', hint: 'bijlagen bij offertes', icon: '▧', filters: { role: 'QUOTE' } },
  { key: 'invoice', label: 'Facturen', hint: 'bijlagen bij facturen', icon: '▨', filters: { role: 'INVOICE' } },
  { key: 'unused', label: 'Nergens gebruikt', hint: 'los in de bibliotheek', icon: '○', filters: { linked: false } },
];

/**
 * Bestanden: the library as a drive. Folders on the left (drag a file onto
 * one to move it), the files of the open folder in the middle as cards or
 * rows, and the chosen file on the right with everything you can do to it:
 * rename, move, a public link to copy or revoke, download, a new version,
 * where it is used, archive. Uploads land in the open folder.
 */
@Component({
  selector: 'app-files-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, AuthImage, PageHeader, DateTimeNlPipe],
  template: `
    <app-page-header title="Bestanden" subtitle="Documenten en media, in mappen en met publieke links" [showBack]="false" [showBell]="false">
      <label class="btn btn--primary btn--sm fx__uploadbtn">
        {{ uploading() ? uploadProgress() : '+ Uploaden' }}
        <input type="file" multiple hidden [disabled]="uploading()" (change)="chooseFiles($event)" />
      </label>
    </app-page-header>

    <div class="content fx" [class.fx--detail]="!!selected()" [class.fx--resizing]="resizing()" [style.gridTemplateColumns]="gridColumns()"
         (dragenter)="dragEnter($event)" (dragover)="dragOver($event)" (dragleave)="dragLeave($event)" (drop)="dropFiles($event)">
      <!-- ============================ folders -->
      <aside class="fx__rail" aria-label="Mappen">
        <div class="fx__resizer" role="separator" aria-orientation="vertical" aria-label="Breedte van de mappenkolom" title="Sleep om de mappenkolom breder of smaller te maken; dubbelklik zet ze terug"
             [attr.aria-valuenow]="railWidth()" [attr.aria-valuemin]="200" [attr.aria-valuemax]="560" tabindex="0"
             (pointerdown)="startResize($event)" (dblclick)="setRailWidth(232)"
             (keydown.arrowleft)="setRailWidth(railWidth() - 16)" (keydown.arrowright)="setRailWidth(railWidth() + 16)"></div>
        <div class="fx__rail-head"><b>Mappen</b><button class="linklike" type="button" (click)="startFolder(null)">+ Nieuwe map</button></div>
        <nav class="fx__tree">
          <button class="fx__node" type="button" [class.on]="folder() === null" (click)="openFolder(null)">
            <i aria-hidden="true">▦</i><span>Alle bestanden</span>
          </button>
          <button class="fx__node" type="button" [class.on]="folder() === 'root'" [class.fx__node--target]="dragOverFolder() === 'root'"
                  (click)="openFolder('root')" (dragover)="allowAssetDrop($event, 'root')" (dragleave)="dragOverFolder.set(undefined)" (drop)="dropOnFolder($event, null)">
            <i aria-hidden="true">◌</i><span>Zonder map</span>
          </button>
          @for (node of tree(); track node.id) {
            <div class="fx__row" [class.fx__row--on]="folder() === node.id" [style.paddingLeft.px]="node.depth * 14">
              <button class="fx__node" type="button" [class.on]="folder() === node.id" [class.fx__node--target]="dragOverFolder() === node.id" [class.fx__node--dragging]="draggingFolder()?.id === node.id"
                      draggable="true" (dragstart)="dragFolder($event, node)" (dragend)="endDrag()"
                      (click)="openFolder(node.id)" (dragover)="allowAssetDrop($event, node.id)" (dragleave)="dragOverFolder.set(undefined)" (drop)="dropOnFolder($event, node.id)">
                <i aria-hidden="true">▰</i><span>{{ node.name }}</span><small>{{ node.assetCount || '' }}</small>
              </button>
              <span class="fx__tools">
                <button type="button" title="Submap maken" (click)="startFolder(node.id)">+</button>
                <button type="button" title="Hernoemen" (click)="renameFolder(node)">✎</button>
                <button type="button" title="Map verwijderen" (click)="removeFolder(node)">×</button>
              </span>
            </div>
          }
        </nav>
        @if (folderDraft(); as draft) {
          <form class="fx__folder-form" (submit)="$event.preventDefault(); saveFolder()">
            <b>{{ draft.id === null ? 'Nieuwe map' : 'Map bewerken' }}</b>
            <input class="input" type="text" placeholder="Mapnaam" autofocus maxlength="120" [ngModel]="draft.name" name="folderName"
                   (ngModelChange)="folderDraft.set({ ...draft, name: $event })" />
            <label class="fx__folder-parent">
              <span>In map</span>
              <select class="select" [ngModel]="draft.parentId ?? ''" name="folderParent" (ngModelChange)="folderDraft.set({ ...draft, parentId: $event === '' ? null : +$event })">
                <option value="">— bovenaan —</option>
                @for (node of parentChoices(); track node.id) { <option [value]="node.id">{{ '  '.repeat(node.depth) }}{{ node.name }}</option> }
              </select>
            </label>
            <span>
              <button class="btn btn--sm btn--primary" type="submit" [disabled]="!draft.name.trim()">{{ draft.id === null ? 'Maken' : 'Bewaren' }}</button>
              <button class="btn btn--sm" type="button" (click)="folderDraft.set(null)">Annuleren</button>
            </span>
          </form>
        }
        <p class="fx__rail-hint">Sleep bestanden of een map op een andere map om ze te verplaatsen. Uploads komen in de open map.</p>

        <div class="fx__rail-head fx__rail-head--gap"><b>Op gebruik</b></div>
        <nav class="fx__tree" aria-label="Bestanden op gebruik">
          @for (item of collections; track item.key) {
            <button class="fx__node" type="button" [class.on]="collection()?.key === item.key" (click)="openCollection(item)" [title]="item.hint">
              <i aria-hidden="true">{{ item.icon }}</i><span>{{ item.label }}</span>
            </button>
          }
        </nav>
      </aside>

      <!-- ============================ files -->
      <main class="fx__main" aria-live="polite">
        <div class="fx__bar">
          <nav class="fx__crumbs" aria-label="Pad">
            @for (crumb of crumbs(); track crumb.id ?? 'top'; let last = $last) {
              <button type="button" [class.on]="last" [class.fx__node--target]="crumb.id !== null && dragOverFolder() === crumb.id" (click)="openFolder(crumb.id)"
                      (dragover)="crumb.id !== null && !collection() ? allowAssetDrop($event, crumb.id) : null" (dragleave)="dragOverFolder.set(undefined)"
                      (drop)="crumb.id !== null && !collection() ? dropOnFolder($event, crumb.id === 'root' ? null : crumb.id) : null">{{ crumb.name }}</button>@if (!last) { <i aria-hidden="true">›</i> }
            }
          </nav>
          <input class="input fx__search" type="search" autocomplete="off" placeholder="Zoeken op naam of bestandsnaam…" aria-label="Zoeken"
                 [ngModel]="query()" (ngModelChange)="changeQuery($event)" />
          <span class="per-toggle" role="group" aria-label="Soort">
            <button type="button" [class.on]="kind() === null" (click)="setKind(null)">Alles</button>
            <button type="button" [class.on]="kind() === 'IMAGE'" (click)="setKind('IMAGE')">Foto’s</button>
            <button type="button" [class.on]="kind() === 'DOCUMENT'" (click)="setKind('DOCUMENT')">Documenten</button>
          </span>
          <label class="fx__check"><input type="checkbox" [ngModel]="archived()" (ngModelChange)="setArchived($event)" /> Archief</label>
          @if (!collection()) {
            <button class="btn btn--sm" type="button" (click)="startFolder(currentFolderId())" [title]="currentFolderId() === null ? 'Nieuwe map bovenaan' : 'Nieuwe submap in ' + folderName()">
              + {{ currentFolderId() === null ? 'Map' : 'Submap' }}
            </button>
          }
          <span class="per-toggle" role="group" aria-label="Weergave">
            <button type="button" [class.on]="view() === 'list'" (click)="setView('list')" title="Lijst">☰</button>
            <button type="button" [class.on]="view() === 'grid'" (click)="setView('grid')" title="Tegels">▦</button>
          </span>
        </div>

        @if (selectedIds().size) {
          <div class="fx__selection" role="status">
            <b>{{ selectedIds().size }} geselecteerd</b>
            <span>sleep ze samen naar een map, of</span>
            <select class="select" [ngModel]="''" (ngModelChange)="moveSelection($event === '' ? null : $event === 'root' ? null : +$event)" aria-label="Verplaats de selectie naar">
              <option value="" disabled>Verplaats naar…</option>
              <option value="root">Zonder map</option>
              @for (node of tree(); track node.id) { <option [value]="node.id">{{ '  '.repeat(node.depth) }}{{ node.name }}</option> }
            </select>
            <button class="linklike" type="button" (click)="clearSelection()">Selectie wissen</button>
          </div>
        }
        @if (dropActive()) {
          <div class="fx__drop">Laat los om te uploaden{{ folderName() ? ' in ' + folderName() : '' }}</div>
        }
        @if (loading()) {
          <p class="fx__state">Bestanden laden…</p>
        } @else if (loadError()) {
          <p class="fx__state">{{ loadError() }} <button class="linklike" type="button" (click)="reload()">Opnieuw proberen</button></p>
        } @else if (!assets().length) {
          <p class="fx__state">
            @if (query().trim()) { Niets gevonden voor “{{ query() }}”. } @else { Nog geen bestanden hier. Sleep ze hierheen of klik op Uploaden. }
          </p>
        } @else if (view() === 'grid' && groups(); as groups) {
          @for (group of groups; track group.label) {
            <div class="fx__group">
              <h3 class="fx__group-title">{{ group.label }} <small>{{ group.assets.length }}</small></h3>
              <div class="fx__grid">
                @for (asset of group.assets; track asset.id) {
                  <button class="fx__card" type="button" [class.on]="selected()?.id === asset.id" [class.fx__card--picked]="selectedIds().has(asset.id)" [class.fx__card--archived]="asset.archived"
                          draggable="true" (dragstart)="dragAsset($event, asset)" (dragend)="endDrag()"
                          (click)="clickAsset(asset, $event)" (dblclick)="download(asset)" [title]="asset.originalFilename">
                    <span class="fx__pick" role="checkbox" [attr.aria-checked]="selectedIds().has(asset.id)" (click)="togglePick(asset, $event)" title="Selecteren">{{ selectedIds().has(asset.id) ? '✓' : '' }}</span>
                    @if (asset.kind === 'IMAGE') { <img [appAuthSrc]="media.thumbnailUrl(asset.id)" alt="" loading="lazy" /> } @else { <i class="fx__ext" aria-hidden="true">{{ extension(asset) }}</i> }
                    <span class="fx__card-copy"><b>{{ asset.name }}</b><small>{{ size(asset.sizeBytes) }}{{ asset.web ? ' · web ' + size(asset.web.sizeBytes) : '' }}</small></span>
                  </button>
                }
              </div>
            </div>
          }
        } @else if (view() === 'grid') {
          <div class="fx__grid">
            @for (asset of assets(); track asset.id) {
              <button class="fx__card" type="button" [class.on]="selected()?.id === asset.id" [class.fx__card--picked]="selectedIds().has(asset.id)" [class.fx__card--archived]="asset.archived"
                      draggable="true" (dragstart)="dragAsset($event, asset)" (dragend)="endDrag()"
                      (click)="clickAsset(asset, $event)" (dblclick)="download(asset)" [title]="asset.originalFilename">
                <span class="fx__pick" role="checkbox" [attr.aria-checked]="selectedIds().has(asset.id)" (click)="togglePick(asset, $event)" title="Selecteren">{{ selectedIds().has(asset.id) ? '✓' : '' }}</span>
                @if (asset.kind === 'IMAGE') {
                  <img [appAuthSrc]="media.thumbnailUrl(asset.id)" alt="" loading="lazy" />
                } @else {
                  <i class="fx__ext" aria-hidden="true">{{ extension(asset) }}</i>
                }
                <span class="fx__card-copy"><b>{{ asset.name }}</b><small>{{ size(asset.sizeBytes) }}{{ asset.web ? ' · web ' + size(asset.web.sizeBytes) : '' }} · {{ asset.updatedAt | dateTimeNl }}</small></span>
                <span class="fx__badges">
                  @if (asset.share) { <em title="Publieke link">🔗</em> }
                  @if (asset.links.length) { <em [title]="asset.links.length + ' koppelingen'">{{ asset.links.length }}×</em> }
                  @if (asset.archived) { <em>archief</em> }
                </span>
              </button>
            }
          </div>
        } @else {
          <table class="fx__table">
            <thead><tr><th>Naam</th><th>Soort</th><th class="r">Grootte</th><th>Gewijzigd</th><th>Gebruik</th></tr></thead>
            <tbody>
              @for (group of groups() ?? [{ label: '', assets: assets() }]; track group.label) {
                @if (group.label) { <tr class="fx__group-row"><td colspan="5">{{ group.label }} <small>{{ group.assets.length }}</small></td></tr> }
                @for (asset of group.assets; track asset.id) {
                  <tr [class.on]="selected()?.id === asset.id" [class.fx__row--picked]="selectedIds().has(asset.id)" draggable="true" (dragstart)="dragAsset($event, asset)" (dragend)="endDrag()" (click)="clickAsset(asset, $event)">
                    <td class="fx__name">
                      <span class="fx__pick fx__pick--row" role="checkbox" [attr.aria-checked]="selectedIds().has(asset.id)" (click)="togglePick(asset, $event)" title="Selecteren">{{ selectedIds().has(asset.id) ? '✓' : '' }}</span>
                      @if (asset.kind === 'IMAGE') { <img [appAuthSrc]="media.thumbnailUrl(asset.id)" alt="" loading="lazy" /> } @else { <i class="fx__ext" aria-hidden="true">{{ extension(asset) }}</i> }
                      <span><b>{{ asset.name }}</b><small>{{ asset.originalFilename }}{{ folderLabel(asset) ? ' · ' + folderLabel(asset) : '' }}</small></span>
                    </td>
                    <td>{{ asset.kind === 'IMAGE' ? 'Foto' : 'Document' }}</td>
                    <td class="r">{{ size(asset.sizeBytes) }}{{ asset.web && asset.web.sizeBytes !== asset.sizeBytes ? ' · web ' + size(asset.web.sizeBytes) : '' }}</td>
                    <td>{{ asset.updatedAt | dateTimeNl }}</td>
                    <td>{{ asset.links.length ? asset.links.length + '× gekoppeld' : '—' }}{{ asset.share ? ' · publiek' : '' }}{{ asset.archived ? ' · archief' : '' }}</td>
                  </tr>
                }
              }
            </tbody>
          </table>
        }
        @if (hasMore()) {
          <button class="btn fx__more" type="button" [disabled]="loadingMore()" (click)="loadMore()">{{ loadingMore() ? 'Laden…' : 'Meer laden' }}</button>
        }
      </main>

      <!-- ============================ the chosen file -->
      @if (selected(); as asset) {
        <aside class="fx__detail" aria-label="Bestand">
          <div class="fx__detail-head">
            <b>{{ asset.kind === 'IMAGE' ? 'Foto' : 'Document' }}</b>
            <button class="fx__close" type="button" aria-label="Sluiten" (click)="close()">×</button>
          </div>
          <div class="fx__preview">
            @if (asset.kind === 'IMAGE') { <img [appAuthSrc]="media.fileUrl(asset.id)" [alt]="asset.name" /> }
            @else { <i class="fx__ext fx__ext--big" aria-hidden="true">{{ extension(asset) }}</i> }
          </div>
          <label class="fx__field">
            <span>Naam</span>
            <span class="fx__inline">
              <input class="input" type="text" [ngModel]="nameDraft()" (ngModelChange)="nameDraft.set($event)" (keydown.enter)="saveName()" />
              @if (nameDraft().trim() && nameDraft().trim() !== asset.name) { <button class="btn btn--sm btn--primary" type="button" [disabled]="busy()" (click)="saveName()">Bewaren</button> }
            </span>
          </label>
          <dl class="fx__facts">
            <div><dt>Bestand</dt><dd class="mono">{{ asset.originalFilename }}</dd></div>
            <div><dt>Versie</dt><dd>{{ asset.versionCount }}@if (asset.versionCount > 1) { <small> (laatste vervangt de vorige overal)</small> }</dd></div>
            <div><dt>Toegevoegd</dt><dd>{{ asset.createdAt | dateTimeNl }}</dd></div>
          </dl>

          <section class="fx__formats">
            <div class="fx__share-head"><b>Formaten</b><small>{{ asset.web ? 'hoge kwaliteit en web' : 'één bestand' }}</small></div>
            <div class="fx__format">
              <span><b>Origineel</b><small>{{ size(asset.sizeBytes) }}@if (asset.widthPx) { · {{ asset.widthPx }} × {{ asset.heightPx }} px }@if (asset.kind === 'IMAGE') { · hoge kwaliteit, voor druk en catalogus }</small></span>
              <button class="linklike" type="button" [disabled]="downloading()" (click)="download(asset, 'original')">Download</button>
            </div>
            @if (asset.web; as web) {
              <div class="fx__format">
                <span><b>Web</b><small>{{ size(web.sizeBytes) }}@if (web.widthPx) { · {{ web.widthPx }} × {{ web.heightPx }} px } · lichter, voor website, mail en offertes</small></span>
                <button class="linklike" type="button" [disabled]="downloading()" (click)="download(asset, 'web')">Download</button>
              </div>
            } @else if (asset.kind === 'IMAGE') {
              <p class="fx__hint">De webversie wordt gemaakt bij de eerste opvraging.</p>
            }
          </section>

          <label class="fx__field">
            <span>Map</span>
            <select class="select" [ngModel]="asset.folderId ?? ''" (ngModelChange)="moveTo($event === '' ? null : +$event)" [disabled]="busy()">
              <option value="">Zonder map</option>
              @for (node of tree(); track node.id) { <option [value]="node.id">{{ '  '.repeat(node.depth) }}{{ node.name }}</option> }
            </select>
          </label>

          <section class="fx__share" [class.fx__share--on]="!!asset.share">
            <div class="fx__share-head"><b>Publieke link</b>
              @if (asset.share) { <small>{{ asset.share.downloads }}× geopend</small> }
            </div>
            @if (asset.share; as share) {
              <div class="fx__inline">
                <input class="input mono" type="text" readonly [value]="media.publicUrl(share.token)" (focus)="$any($event.target).select()" />
                <button class="btn btn--sm btn--primary" type="button" (click)="copyLink(share.token)">Kopieer</button>
              </div>
              @if (asset.web) {
                <div class="fx__inline fx__inline--sub">
                  <input class="input mono" type="text" readonly [value]="media.publicUrl(share.token, 'web')" (focus)="$any($event.target).select()" aria-label="Publieke link webformaat" />
                  <button class="btn btn--sm" type="button" (click)="copyLink(share.token, 'Weblink gekopieerd', 'web')">Web</button>
                </div>
              }
              <p class="fx__hint">Iedereen met deze link kan het bestand openen, ook zonder Enrosed-login. Een nieuwe versie gaat automatisch mee{{ asset.web ? '; de tweede link geeft het lichtere webformaat' : '' }}.</p>
              <button class="linklike fx__danger" type="button" [disabled]="busy()" (click)="unshare()">Link intrekken</button>
            } @else {
              <p class="fx__hint">Nog geen link. Maak er een om het bestand te delen met een klant of leverancier, zonder login.</p>
              <button class="btn btn--sm" type="button" [disabled]="busy() || asset.archived" (click)="share()">Publieke link maken</button>
            }
          </section>

          <div class="fx__actions">
            <button class="btn btn--sm" type="button" [disabled]="downloading()" (click)="download(asset)">{{ downloading() ? 'Bezig…' : 'Downloaden' }}</button>
            <label class="btn btn--sm">{{ busy() ? 'Bezig…' : 'Nieuwe versie' }}<input type="file" hidden [disabled]="busy()" (change)="replaceVersion($event)" /></label>
            @if (asset.archived) {
              <button class="btn btn--sm" type="button" [disabled]="busy()" (click)="restore()">Terughalen</button>
            } @else {
              <button class="btn btn--sm" type="button" [disabled]="busy()" (click)="archive()">Archiveren</button>
            }
            <button class="btn btn--sm fx__danger" type="button" [disabled]="busy() || asset.links.length > 0" [title]="asset.links.length ? 'Eerst de koppelingen weghalen' : ''" (click)="remove()">Verwijderen</button>
          </div>

          <section class="fx__links">
            <div class="fx__share-head"><b>Gebruikt bij</b><small>{{ asset.links.length || 'nergens' }}</small></div>
            @for (link of asset.links; track link.id) {
              <div class="fx__link">
                <span><b>{{ link.targetLabel || (targetLabel(link.targetType) + ' #' + link.targetId) }}</b><small>{{ targetLabel(link.targetType) }} · {{ roleLabel(link.role) }}{{ link.primary ? ' · hoofd' : '' }}</small></span>
                <button type="button" aria-label="Koppeling weghalen" [disabled]="busy()" (click)="unlink(link.id)">×</button>
              </div>
            }
            <form class="fx__addlink" (submit)="$event.preventDefault(); addLink()">
              <select class="select" [ngModel]="linkType()" name="linkType" (ngModelChange)="setLinkType($event)">
                @for (option of targetOptions; track option.value) { <option [value]="option.value">{{ option.label }}</option> }
              </select>
              <select class="select" [ngModel]="linkTarget()" name="linkTarget" (ngModelChange)="linkTarget.set($event === '' ? '' : +$event)" [disabled]="targetsLoading()">
                <option value="">{{ targetsLoading() ? 'Laden…' : 'Kies…' }}</option>
                @for (target of targets(); track target.id) { <option [value]="target.id">{{ target.label }}{{ target.meta ? ' · ' + target.meta : '' }}</option> }
              </select>
              <select class="select" [ngModel]="linkRole()" name="linkRole" (ngModelChange)="linkRole.set($event)">
                @for (option of roleOptions; track option.value) { <option [value]="option.value">{{ option.label }}</option> }
              </select>
              <button class="btn btn--sm" type="submit" [disabled]="busy() || linkTarget() === ''">Koppelen</button>
            </form>
          </section>
        </aside>
      }
    </div>
  `,
  styles: [`
    :host{display:block}
    .fx__uploadbtn{cursor:pointer}
    .fx{display:grid;grid-template-columns:232px minmax(0,1fr);gap:16px;align-items:start}.fx--resizing{cursor:col-resize}
    .fx--detail{grid-template-columns:232px minmax(0,1fr) 340px}
    .fx__rail,.fx__main,.fx__detail{border:1px solid var(--line);border-radius:18px;background:var(--surface);box-shadow:var(--sh-1)}
    .fx__rail{position:sticky;top:calc(var(--appbar-h,62px) + 14px);padding:12px 10px}
    .fx__resizer{position:absolute;top:8px;right:-9px;bottom:8px;width:14px;cursor:col-resize;touch-action:none;z-index:2}
    .fx__resizer::before{content:'';position:absolute;top:0;bottom:0;left:6px;width:2px;border-radius:2px;background:transparent;transition:background .12s}
    .fx__resizer:hover::before,.fx__resizer:focus-visible::before,.fx--resizing .fx__resizer::before{background:var(--rose)}
    .fx--resizing{cursor:col-resize;user-select:none}
    .fx__rail-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 6px 8px}.fx__rail-head b{font-size:13px}
    .fx__tree{display:grid;gap:1px}.fx__row{display:flex;align-items:center;gap:2px}.fx__row:hover .fx__tools,.fx__row:focus-within .fx__tools,.fx__row--on .fx__tools{opacity:1}
    .fx__node{display:flex;flex:1;align-items:center;gap:8px;min-width:0;min-height:32px;padding:0 8px;border:0;border-radius:9px;background:transparent;color:var(--ink-2);font:inherit;font-size:12.5px;text-align:left;cursor:pointer}
    .fx__node i{color:var(--muted);font-style:normal;font-size:12px}.fx__node span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.fx__node small{color:var(--muted);font-size:10.5px}
    .fx__node:hover{background:var(--surface-2)}.fx__node.on{background:var(--rose-soft);color:var(--rose-dark);font-weight:650}.fx__node.on i{color:var(--rose)}
    .fx__node--target{outline:2px dashed var(--rose);outline-offset:-2px;background:var(--rose-soft)}
    .fx__tools{display:flex;flex:none;gap:1px;opacity:0;transition:opacity .12s}.fx__tools button{width:22px;height:22px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--muted);font-size:13px;cursor:pointer}.fx__tools button:hover{background:var(--surface-2);color:var(--ink)}
    .fx__folder-form{display:grid;gap:6px;margin:8px 0 0;padding:10px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2)}.fx__folder-form>b{font-size:12.5px}.fx__folder-form>span{display:flex;gap:6px}
    .fx__folder-parent{display:grid;gap:3px}.fx__folder-parent>span{color:var(--muted);font-size:10.5px;font-weight:750;letter-spacing:.06em;text-transform:uppercase}
    .fx__rail-hint{margin:12px 6px 0;color:var(--muted);font-size:11px;line-height:1.4}
    .fx__main{min-height:60vh;padding:12px 14px 16px}
    .fx__bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:12px}
    .fx__crumbs{display:flex;flex:1 1 100%;align-items:center;gap:4px;min-width:0;font-size:12.5px}.fx__crumbs button{padding:2px 6px;border:0;border-radius:6px;background:transparent;color:var(--muted);font:inherit;cursor:pointer}.fx__crumbs button.on{color:var(--ink);font-weight:700}.fx__crumbs i{color:var(--line-strong);font-style:normal}
    .fx__search{flex:1 1 220px;min-width:160px}
    .fx__check{display:inline-flex;align-items:center;gap:6px;color:var(--ink-2);font-size:12.5px;cursor:pointer}.fx__check input{accent-color:var(--rose)}
    .fx__drop{margin-bottom:12px;padding:22px;border:2px dashed var(--rose);border-radius:14px;background:var(--rose-soft);color:var(--rose-dark);font-weight:650;text-align:center}
    .fx__state{padding:40px 12px;color:var(--muted);font-size:13px;text-align:center}
    .fx__grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
    .fx__card{position:relative;display:grid;gap:6px;padding:6px 6px 8px;border:2px solid var(--line);border-radius:14px;background:var(--surface);font:inherit;text-align:left;cursor:pointer}
    .fx__card:hover{border-color:var(--line-strong)}.fx__card.on{border-color:var(--rose);background:var(--rose-soft)}.fx__card--archived{opacity:.6}
    .fx__card img{display:block;width:100%;aspect-ratio:1;border-radius:9px;object-fit:cover;background:var(--surface-2)}
    .fx__ext{display:grid;width:100%;aspect-ratio:1;place-items:center;border-radius:9px;background:var(--surface-2);color:var(--muted);font-size:14px;font-style:normal;font-weight:800;letter-spacing:.06em;text-transform:uppercase}
    .fx__card-copy{display:grid;min-width:0;padding:0 2px}.fx__card-copy b{overflow:hidden;font-size:12.5px;text-overflow:ellipsis;white-space:nowrap}.fx__card-copy small{overflow:hidden;color:var(--muted);font-size:10.5px;text-overflow:ellipsis;white-space:nowrap}
    .fx__pick{position:absolute;top:10px;right:10px;z-index:1;display:grid;width:22px;height:22px;place-items:center;border:2px solid rgb(255 255 255/.9);border-radius:6px;background:rgb(16 13 12/.35);color:#fff;font-size:12px;font-weight:800;opacity:0;cursor:pointer;transition:opacity .12s}
    .fx__card:hover .fx__pick,.fx__card--picked .fx__pick,.fx__table tr:hover .fx__pick,.fx__row--picked .fx__pick{opacity:1}
    .fx__pick[aria-checked="true"]{background:var(--rose);border-color:var(--rose)}
    .fx__card--picked{border-color:var(--rose)}.fx__row--picked td{background:var(--rose-soft)}
    .fx__pick--row{position:static;flex:none;width:20px;height:20px;border-color:var(--line-strong);background:var(--surface);color:#fff;font-size:11px}.fx__pick--row[aria-checked="true"]{color:#fff}
    .fx__selection{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-bottom:12px;padding:8px 12px;border-radius:12px;background:var(--rose-soft);color:var(--rose-dark);font-size:12.5px}.fx__selection .select{min-height:32px;padding-block:0;font-size:12px}
    .fx__node--dragging{opacity:.45}
    .fx__crumbs button.fx__node--target{outline:2px dashed var(--rose);outline-offset:0;background:var(--rose-soft);color:var(--rose-dark)}
    .fx__badges{position:absolute;top:10px;left:10px;display:flex;gap:4px}.fx__badges em{padding:2px 7px;border-radius:999px;background:rgb(16 13 12/.66);color:#fff;font-size:10px;font-style:normal;font-weight:700}
    .fx__table{width:100%;border-collapse:collapse;font-size:12.5px}.fx__table th{padding:6px 8px;border-bottom:1px solid var(--line);color:var(--muted);font-size:10px;font-weight:750;letter-spacing:.06em;text-align:left;text-transform:uppercase}
    .fx__table td{padding:7px 8px;border-bottom:1px solid var(--line);vertical-align:middle}
    .fx__group-row td{padding:12px 8px 4px;color:var(--rose);font-size:10.5px;font-weight:760;letter-spacing:.1em;text-transform:uppercase;background:transparent!important}.fx__group-row td small{margin-left:6px;color:var(--muted);font-weight:600;letter-spacing:0;text-transform:none}.fx__table tr{cursor:pointer}.fx__table tbody tr:hover td{background:var(--surface-2)}.fx__table tr.on td{background:var(--rose-soft)}.fx__table .r{text-align:right}
    .fx__name{display:flex;align-items:center;gap:10px}.fx__name img,.fx__name .fx__ext{width:36px;height:36px;aspect-ratio:auto;font-size:9px;border-radius:8px;object-fit:cover}.fx__name span{display:grid;min-width:0}.fx__name small{color:var(--muted);font-size:10.5px}
    .fx__more{display:block;margin:14px auto 0}
    .fx__rail-head--gap{margin-top:16px}
    .fx__group+.fx__group{margin-top:16px}.fx__group-title{margin:0 0 8px;color:var(--rose);font-size:10.5px;font-weight:760;letter-spacing:.1em;text-transform:uppercase}.fx__group-title small{margin-left:6px;color:var(--muted);font-weight:600;letter-spacing:0;text-transform:none}
    .fx__formats{display:grid;gap:6px;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2)}
    .fx__format{display:flex;align-items:center;justify-content:space-between;gap:8px}.fx__format>span{display:grid;min-width:0}.fx__format b{font-size:12.5px}.fx__format small{color:var(--muted);font-size:10.5px;line-height:1.35}
    .fx__inline--sub{margin-top:6px}
    .fx__detail{position:sticky;top:calc(var(--appbar-h,62px) + 14px);display:grid;gap:12px;max-height:calc(100dvh - var(--appbar-h,62px) - 28px);padding:12px 14px 16px;overflow-y:auto}
    .fx__detail-head{display:flex;align-items:center;justify-content:space-between}.fx__detail-head b{font-size:13px}
    .fx__close{width:28px;height:28px;border:0;border-radius:8px;background:var(--surface-2);color:var(--muted);font-size:18px;line-height:1;cursor:pointer}
    .fx__preview{display:grid;place-items:center;min-height:120px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2);overflow:hidden}
    .fx__preview img{display:block;max-width:100%;max-height:260px;object-fit:contain}.fx__ext--big{width:100%;height:120px;aspect-ratio:auto;font-size:20px}
    .fx__field{display:grid;gap:4px}.fx__field>span:first-child{color:var(--muted);font-size:10.5px;font-weight:750;letter-spacing:.06em;text-transform:uppercase}
    .fx__inline{display:flex;gap:6px}.fx__inline .input{flex:1;min-width:0}
    .fx__facts{display:grid;margin:0;padding:0}.fx__facts>div{display:grid;grid-template-columns:86px minmax(0,1fr);gap:8px;padding:5px 0;border-bottom:1px solid var(--line);font-size:12px}.fx__facts dt{color:var(--muted)}.fx__facts dd{margin:0;overflow-wrap:anywhere}.fx__facts small{color:var(--muted)}
    .fx__share{padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2)}.fx__share--on{border-color:color-mix(in srgb,var(--ok) 45%,transparent);background:color-mix(in srgb,var(--ok) 8%,var(--surface))}
    .fx__share-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}.fx__share-head b{font-size:12.5px}.fx__share-head small{color:var(--muted);font-size:11px}
    .fx__hint{margin:6px 0;color:var(--muted);font-size:11px;line-height:1.4}
    .fx__danger{color:var(--danger)}
    .fx__actions{display:flex;flex-wrap:wrap;gap:6px}.fx__actions label{cursor:pointer}
    .fx__links{display:grid;gap:6px}
    .fx__link{display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid var(--line);border-radius:10px}.fx__link>span{display:grid;flex:1;min-width:0}.fx__link b{overflow:hidden;font-size:12px;text-overflow:ellipsis;white-space:nowrap}.fx__link small{color:var(--muted);font-size:10.5px}
    .fx__link button{width:24px;height:24px;border:0;border-radius:6px;background:transparent;color:var(--muted);font-size:16px;cursor:pointer}.fx__link button:hover{background:var(--surface-2);color:var(--danger)}
    .fx__addlink{display:grid;gap:6px;margin-top:4px}
    @media(max-width:1180px){.fx--detail{grid-template-columns:232px minmax(0,1fr)}.fx__detail{grid-column:1/-1;position:static;max-height:none}}
    @media(max-width:820px){.fx,.fx--detail{grid-template-columns:1fr!important}.fx__rail{position:static}.fx__resizer{display:none}}
  `],
})
export class FilesPage implements OnDestroy {
  readonly media = inject(MediaApi);
  private readonly catalog = inject(CatalogApi);
  private readonly sourcing = inject(SourcingApi);
  private readonly planner = inject(PlannerApi);
  private readonly ui = inject(Ui);

  readonly roleOptions = ROLE_OPTIONS;
  readonly targetOptions = TARGET_OPTIONS;
  readonly collections = COLLECTIONS;
  /** The open view by use; null while a folder is open. */
  readonly collection = signal<Collection | null>(null);
  /** In a view per product, reeks or order the cards sit under the record they belong to. */
  readonly groups = computed(() => {
    const collection = this.collection();
    const targetType = collection?.filters.targetType;
    if (!targetType) return null;
    const groups = new Map<string, { label: string; assets: MediaAssetSummary[] }>();
    for (const asset of this.assets()) {
      const links = asset.links.filter((link) => link.targetType === targetType);
      const labels = links.length ? links.map((link) => link.targetLabel || `${this.targetLabel(targetType)} #${link.targetId}`) : ['Zonder koppeling'];
      for (const label of new Set(labels)) {
        const group = groups.get(label) ?? { label, assets: [] };
        group.assets.push(asset);
        groups.set(label, group);
      }
    }
    return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label, 'nl'));
  });

  /* ---- the folder column: as wide as you drag it, remembered */
  private static readonly RAIL_KEY = 'enrosed.files.rail';
  readonly railWidth = signal<number>((() => {
    try { return FilesPage.clampRail(Number(localStorage.getItem(FilesPage.RAIL_KEY)) || 232); } catch { return 232; }
  })());
  readonly resizing = signal(false);
  /** Below 1180px the detail drops under the grid; the stylesheet's own columns apply there. */
  private readonly wide = signal(typeof window === 'undefined' ? true : window.innerWidth > 1180);
  readonly gridColumns = computed(() => {
    if (!this.wide()) return null;
    return `${this.railWidth()}px minmax(0, 1fr)${this.selected() ? ' 340px' : ''}`;
  });
  private readonly onResize = () => this.wide.set(window.innerWidth > 1180);
  private resizeStart: { x: number; width: number } | null = null;

  private static clampRail(width: number): number {
    return Math.min(560, Math.max(200, Math.round(width)));
  }

  setRailWidth(width: number): void {
    this.railWidth.set(FilesPage.clampRail(width));
    try { localStorage.setItem(FilesPage.RAIL_KEY, String(this.railWidth())); } catch { /* remembered for this visit only */ }
  }

  startResize(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture?.(event.pointerId);
    this.resizeStart = { x: event.clientX, width: this.railWidth() };
    this.resizing.set(true);
    const move = (moveEvent: PointerEvent) => {
      if (!this.resizeStart) return;
      this.railWidth.set(FilesPage.clampRail(this.resizeStart.width + (moveEvent.clientX - this.resizeStart.x)));
    };
    const stop = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', stop);
      handle.removeEventListener('pointercancel', stop);
      this.resizeStart = null;
      this.resizing.set(false);
      this.setRailWidth(this.railWidth());
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  }

  /* ---- folders */
  readonly folders = signal<MediaFolder[]>([]);
  readonly folder = signal<number | 'root' | null>(null);
  readonly folderDraft = signal<FolderDraft | null>(null);
  readonly dragOverFolder = signal<number | 'root' | undefined>(undefined);
  readonly tree = computed<FolderNode[]>(() => {
    const byParent = new Map<number | null, MediaFolder[]>();
    for (const item of this.folders()) {
      const list = byParent.get(item.parentId) ?? [];
      list.push(item);
      byParent.set(item.parentId, list);
    }
    const out: FolderNode[] = [];
    const walk = (parentId: number | null, depth: number) => {
      for (const item of (byParent.get(parentId) ?? []).sort((a, b) => a.name.localeCompare(b.name, 'nl'))) {
        if (depth > 8) break;
        out.push({ ...item, depth });
        walk(item.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  });
  readonly currentFolderId = computed(() => {
    const folder = this.folder();
    return typeof folder === 'number' ? folder : null;
  });
  /** Where a folder may go: anywhere but inside itself or its own subfolders. */
  readonly parentChoices = computed(() => {
    const draft = this.folderDraft();
    if (!draft || draft.id === null) return this.tree();
    const blocked = new Set<number>([draft.id]);
    for (const node of this.tree()) if (node.parentId !== null && blocked.has(node.parentId)) blocked.add(node.id);
    return this.tree().filter((node) => !blocked.has(node.id));
  });
  readonly folderName = computed(() => {
    const folder = this.folder();
    return typeof folder === 'number' ? this.folders().find((item) => item.id === folder)?.name ?? '' : '';
  });
  readonly crumbs = computed(() => {
    const folder = this.folder();
    const crumbs: { id: number | 'root' | null; name: string }[] = [{ id: null, name: 'Alle bestanden' }];
    const collection = this.collection();
    if (collection) return [...crumbs, { id: null, name: collection.label }];
    if (folder === 'root') return [...crumbs, { id: 'root' as const, name: 'Zonder map' }];
    if (typeof folder !== 'number') return crumbs;
    const byId = new Map(this.folders().map((item) => [item.id, item]));
    const path: { id: number; name: string }[] = [];
    for (let cursor = byId.get(folder); cursor && path.length < 10; cursor = cursor.parentId === null ? undefined : byId.get(cursor.parentId)) {
      path.unshift({ id: cursor.id, name: cursor.name });
    }
    return [...crumbs, ...path];
  });

  /* ---- files */
  readonly assets = signal<MediaAssetSummary[]>([]);
  readonly loading = signal(true);
  readonly loadingMore = signal(false);
  readonly hasMore = signal(false);
  readonly loadError = signal('');
  readonly query = signal('');
  readonly kind = signal<MediaKind | null>(null);
  readonly archived = signal(false);
  /** The list is the default; tiles are a choice that is remembered. */
  readonly view = signal<'grid' | 'list'>((() => {
    try { return localStorage.getItem('enrosed.files.view') === 'grid' ? 'grid' : 'list'; } catch { return 'list'; }
  })());

  setView(view: 'grid' | 'list'): void {
    this.view.set(view);
    try { localStorage.setItem('enrosed.files.view', view); } catch { /* remembered for this visit only */ }
  }
  readonly uploading = signal(false);
  readonly uploadProgress = signal('Uploaden…');
  readonly dropActive = signal(false);
  /** The files on the move: the dragged one, or the whole selection when it was part of it. */
  readonly dragging = signal<MediaAssetSummary[] | null>(null);
  readonly draggingFolder = signal<FolderNode | null>(null);
  readonly selectedIds = signal<ReadonlySet<number>>(new Set());

  /* ---- the chosen file */
  readonly selected = signal<MediaAssetDetail | null>(null);
  readonly nameDraft = signal('');
  readonly busy = signal(false);
  readonly downloading = signal(false);
  readonly linkType = signal<MediaTargetType>('PRODUCT');
  readonly linkTarget = signal<number | ''>('');
  readonly linkRole = signal<MediaRole>('INTERNAL');
  readonly targetsLoading = signal(false);
  private readonly targetCache = new Map<MediaTargetType, TargetOption[]>();
  readonly targets = signal<TargetOption[]>([]);

  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private requestId = 0;
  private dragDepth = 0;

  constructor() {
    window.addEventListener('resize', this.onResize, { passive: true });
    void this.loadFolders();
    void this.reload();
  }

  ngOnDestroy(): void {
    window.removeEventListener('resize', this.onResize);
    if (this.searchTimer) clearTimeout(this.searchTimer);
  }

  /* ================================================================ folders */
  private async loadFolders(): Promise<void> {
    try {
      this.folders.set(await this.media.folders());
    } catch (failure) {
      this.ui.toast(messageOf(failure, 'De mappen konden niet worden geladen.'), 'err');
    }
  }

  openFolder(folder: number | 'root' | null): void {
    this.collection.set(null);
    this.folder.set(folder);
    void this.reload();
  }

  openCollection(collection: Collection): void {
    this.folder.set(null);
    this.collection.set(collection);
    if (collection.filters.kind) this.kind.set(collection.filters.kind);
    void this.reload();
  }

  startFolder(parentId: number | null): void {
    this.folderDraft.set({ id: null, parentId, name: '' });
  }

  renameFolder(node: FolderNode): void {
    this.folderDraft.set({ id: node.id, parentId: node.parentId, name: node.name });
  }

  async saveFolder(): Promise<void> {
    const draft = this.folderDraft();
    if (!draft || !draft.name.trim()) return;
    try {
      const saved = draft.id === null
        ? await this.media.createFolder(draft.name, draft.parentId)
        : await this.media.updateFolder(draft.id, draft.name, draft.parentId);
      this.folderDraft.set(null);
      await this.loadFolders();
      if (draft.id === null) this.openFolder(saved.id);
    } catch (failure) {
      this.ui.toast(messageOf(failure, 'De map kon niet worden bewaard.'), 'err');
    }
  }

  async removeFolder(node: FolderNode): Promise<void> {
    const ok = await this.ask('Map verwijderen', `Map “${node.name}” verwijderen? De bestanden en submappen erin gaan naar de bovenliggende map.`);
    if (!ok) return;
    try {
      await this.media.deleteFolder(node.id);
      if (this.folder() === node.id) this.folder.set(node.parentId ?? null);
      await this.loadFolders();
      await this.reload();
    } catch (failure) {
      this.ui.toast(messageOf(failure, 'De map kon niet worden verwijderd.'), 'err');
    }
  }

  /* ---- selecting files: a pick box on every card or row, the selection moves as one */
  togglePick(asset: MediaAssetSummary, event: Event): void {
    event.stopPropagation();
    event.preventDefault();
    this.selectedIds.update((ids) => {
      const next = new Set(ids);
      if (next.has(asset.id)) next.delete(asset.id); else next.add(asset.id);
      return next;
    });
  }

  /** A plain click opens the file; with Cmd/Ctrl or Shift it selects instead. */
  clickAsset(asset: MediaAssetSummary, event: MouseEvent): void {
    if (event.metaKey || event.ctrlKey || event.shiftKey) { this.togglePick(asset, event); return; }
    void this.open(asset);
  }

  clearSelection(): void { this.selectedIds.set(new Set()); }

  private selectedAssets(): MediaAssetSummary[] {
    const ids = this.selectedIds();
    return this.assets().filter((asset) => ids.has(asset.id));
  }

  async moveSelection(folderId: number | null): Promise<void> {
    const assets = this.selectedAssets();
    if (assets.length) await this.moveAssets(assets, folderId);
  }

  /* ---- drag files or a folder onto a folder */
  dragAsset(event: DragEvent, asset: MediaAssetSummary): void {
    const picked = this.selectedIds().has(asset.id) ? this.selectedAssets() : [asset];
    this.dragging.set(picked);
    this.draggingFolder.set(null);
    event.dataTransfer?.setData('text/plain', picked.map((item) => item.id).join(','));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  dragFolder(event: DragEvent, node: FolderNode): void {
    event.stopPropagation();
    this.draggingFolder.set(node);
    this.dragging.set(null);
    event.dataTransfer?.setData('text/plain', 'folder:' + node.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  endDrag(): void {
    this.dragging.set(null);
    this.draggingFolder.set(null);
    this.dragOverFolder.set(undefined);
  }

  /** A folder may not land in itself or in one of its own subfolders. */
  private folderCanLand(folder: FolderNode, targetId: number | null): boolean {
    if (targetId === null) return folder.parentId !== null;
    if (targetId === folder.id || targetId === folder.parentId) return false;
    const byId = new Map(this.folders().map((item) => [item.id, item]));
    for (let cursor = byId.get(targetId); cursor; cursor = cursor.parentId === null ? undefined : byId.get(cursor.parentId)) {
      if (cursor.id === folder.id) return false;
    }
    return true;
  }

  allowAssetDrop(event: DragEvent, folder: number | 'root'): void {
    const targetId = folder === 'root' ? null : folder;
    const moving = this.draggingFolder();
    if (moving ? !this.folderCanLand(moving, targetId) : !this.dragging()) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    this.dragOverFolder.set(folder);
  }

  async dropOnFolder(event: DragEvent, folderId: number | null): Promise<void> {
    const assets = this.dragging();
    const moving = this.draggingFolder();
    this.dragOverFolder.set(undefined);
    if (!assets && !moving) return;
    event.preventDefault();
    event.stopPropagation();
    this.dragging.set(null);
    this.draggingFolder.set(null);
    if (moving) {
      if (!this.folderCanLand(moving, folderId)) return;
      try {
        await this.media.updateFolder(moving.id, moving.name, folderId);
        this.ui.toast(`Map “${moving.name}” verplaatst naar ${this.folderTitle(folderId)}`);
        await this.loadFolders();
      } catch (failure) {
        this.ui.toast(messageOf(failure, 'De map kon niet worden verplaatst.'), 'err');
      }
      return;
    }
    await this.moveAssets(assets!, folderId);
  }

  private folderTitle(folderId: number | null): string {
    return folderId === null ? 'Zonder map' : this.folders().find((item) => item.id === folderId)?.name ?? 'de map';
  }

  private async moveAssets(assets: MediaAssetSummary[], folderId: number | null): Promise<void> {
    const moving = assets.filter((asset) => (asset.folderId ?? null) !== folderId);
    if (!moving.length) return;
    let moved = 0;
    try {
      for (const asset of moving) {
        const detail = await this.media.move(asset.id, folderId);
        this.assets.update((items) => items.map((item) => item.id === detail.id ? detail : item));
        if (this.selected()?.id === detail.id) this.applyDetail(detail);
        moved++;
      }
      this.ui.toast(moved === 1
        ? `“${moving[0].name}” verplaatst naar ${this.folderTitle(folderId)}`
        : `${moved} bestanden verplaatst naar ${this.folderTitle(folderId)}`);
    } catch (failure) {
      this.ui.toast(messageOf(failure, 'Verplaatsen mislukt'), 'err');
    }
    this.clearSelection();
    await this.loadFolders();
    if (this.folder() !== null) await this.reload();
  }

  /* ================================================================ files */
  private filters(offset: number) {
    const folder = this.folder();
    const use = this.collection()?.filters ?? {};
    return {
      q: this.query(), kind: this.kind() ?? undefined,
      archived: this.archived() ? true : undefined, includeArchived: false,
      folder: folder === null ? undefined : folder, offset, limit: PAGE + 1,
      targetType: use.targetType, role: use.role, linked: use.linked,
    };
  }

  async reload(): Promise<void> {
    if (this.searchTimer) { clearTimeout(this.searchTimer); this.searchTimer = null; }
    this.clearSelection();
    const requestId = ++this.requestId;
    this.loading.set(true);
    this.loadError.set('');
    try {
      const result = await this.media.assets(this.filters(0));
      if (requestId !== this.requestId) return;
      this.assets.set(result.slice(0, PAGE));
      this.hasMore.set(result.length > PAGE);
    } catch (failure) {
      if (requestId !== this.requestId) return;
      this.assets.set([]);
      this.hasMore.set(false);
      this.loadError.set(messageOf(failure, 'De bestanden konden niet worden geladen.'));
    } finally {
      if (requestId === this.requestId) this.loading.set(false);
    }
  }

  async loadMore(): Promise<void> {
    if (this.loading() || this.loadingMore() || !this.hasMore()) return;
    const requestId = this.requestId;
    this.loadingMore.set(true);
    try {
      const result = await this.media.assets(this.filters(this.assets().length));
      if (requestId !== this.requestId) return;
      const known = new Set(this.assets().map((asset) => asset.id));
      this.assets.update((items) => [...items, ...result.slice(0, PAGE).filter((asset) => !known.has(asset.id))]);
      this.hasMore.set(result.length > PAGE);
    } catch (failure) {
      this.ui.toast(messageOf(failure, 'Meer bestanden konden niet worden geladen.'), 'err');
    } finally {
      if (requestId === this.requestId) this.loadingMore.set(false);
    }
  }

  changeQuery(value: string): void {
    this.query.set(value);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => void this.reload(), 240);
  }

  setKind(kind: MediaKind | null): void { this.kind.set(kind); void this.reload(); }
  setArchived(on: boolean): void { this.archived.set(on); void this.reload(); }

  /* ---- uploads land in the open folder */
  chooseFiles(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    void this.uploadFiles(files);
  }

  dragEnter(event: DragEvent): void {
    if (this.dragging() || this.draggingFolder() || !event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    this.dragDepth++;
    this.dropActive.set(true);
  }

  dragOver(event: DragEvent): void {
    if (this.dragging() || this.draggingFolder() || !event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }

  dragLeave(event: DragEvent): void {
    if (this.dragging()) return;
    event.preventDefault();
    this.dragDepth = Math.max(0, this.dragDepth - 1);
    if (this.dragDepth === 0) this.dropActive.set(false);
  }

  dropFiles(event: DragEvent): void {
    if (this.dragging()) return;
    event.preventDefault();
    this.dragDepth = 0;
    this.dropActive.set(false);
    void this.uploadFiles(Array.from(event.dataTransfer?.files ?? []));
  }

  private async uploadFiles(files: File[]): Promise<void> {
    if (!files.length || this.uploading()) return;
    const folder = this.folder();
    const folderId = typeof folder === 'number' ? folder : null;
    this.uploading.set(true);
    let added = 0;
    let reused = 0;
    let lastAsset: MediaAssetDetail | null = null;
    const failures: string[] = [];
    for (const [index, file] of files.entries()) {
      this.uploadProgress.set(`${index + 1} van ${files.length}…`);
      try {
        const result = await this.media.upload(file, undefined, folderId);
        added++;
        if (result.reused) reused++;
        lastAsset = result.asset;
      } catch (failure) {
        failures.push(messageOf(failure, `${file.name} kon niet worden geüpload.`));
      }
    }
    this.uploading.set(false);
    this.uploadProgress.set('Uploaden…');
    if (added) {
      this.ui.toast(`${added} bestand${added === 1 ? '' : 'en'} toegevoegd${reused ? `, ${reused} bestond al en is hergebruikt` : ''}${folderId !== null ? ' in ' + this.folderName() : ''}`);
      await Promise.all([this.reload(), this.loadFolders()]);
      if (lastAsset && files.length === 1) this.applyDetail(lastAsset);
    }
    if (failures.length) this.ui.toast(failures[0], 'err');
  }

  /* ================================================================ the chosen file */
  async open(asset: MediaAssetSummary): Promise<void> {
    this.nameDraft.set(asset.name);
    this.selected.set({ ...asset, versions: [] });
    try {
      this.applyDetail(await this.media.asset(asset.id));
    } catch (failure) {
      this.ui.toast(messageOf(failure, 'De bestandsdetails konden niet worden geladen.'), 'err');
    }
    void this.loadTargets(this.linkType());
  }

  close(): void { this.selected.set(null); }

  private applyDetail(detail: MediaAssetDetail): void {
    this.selected.set(detail);
    this.nameDraft.set(detail.name);
    this.assets.update((items) => items.map((item) => item.id === detail.id ? detail : item));
  }

  private async act(label: string, action: (id: number) => Promise<MediaAssetDetail>): Promise<boolean> {
    const asset = this.selected();
    if (!asset || this.busy()) return false;
    this.busy.set(true);
    try {
      this.applyDetail(await action(asset.id));
      return true;
    } catch (failure) {
      this.ui.toast(messageOf(failure, label), 'err');
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  async saveName(): Promise<void> {
    const name = this.nameDraft().trim();
    if (!name || name === this.selected()?.name) return;
    if (await this.act('Hernoemen mislukt', (id) => this.media.updateName(id, name))) this.ui.toast('Naam bewaard');
  }

  async moveTo(folderId: number | null): Promise<void> {
    if (await this.act('Verplaatsen mislukt', (id) => this.media.move(id, folderId))) {
      await this.loadFolders();
      if (this.folder() !== null) await this.reload();
    }
  }

  async share(): Promise<void> {
    if (await this.act('De publieke link kon niet worden gemaakt', (id) => this.media.share(id))) {
      const token = this.selected()?.share?.token;
      if (token) await this.copyLink(token, 'Publieke link gemaakt en gekopieerd');
    }
  }

  async unshare(): Promise<void> {
    const ok = await this.ask('Link intrekken', 'Wie de link heeft, kan het bestand daarna niet meer openen.', true);
    if (!ok) return;
    if (await this.act('Intrekken mislukt', (id) => this.media.unshare(id))) this.ui.toast('Publieke link ingetrokken');
  }

  async copyLink(token: string, message = 'Link gekopieerd', variant: MediaVariant = 'original'): Promise<void> {
    const url = this.media.publicUrl(token, variant);
    try {
      await navigator.clipboard.writeText(url);
      this.ui.toast(message);
    } catch {
      this.ui.toast('Kopiëren lukte niet; selecteer de link en kopieer ze zelf.', 'err');
    }
  }

  async download(asset: MediaAssetSummary, variant: MediaVariant = 'original'): Promise<void> {
    if (this.downloading()) return;
    this.downloading.set(true);
    try {
      const name = asset.originalFilename || asset.name;
      const webName = name.replace(/\.[a-z0-9]+$/i, '') + '-web.jpg';
      saveBlob(await this.media.download(asset.id, variant), variant === 'web' ? webName : name);
    } catch (failure) {
      this.ui.toast(messageOf(failure, 'Downloaden mislukt'), 'err');
    } finally {
      this.downloading.set(false);
    }
  }

  async replaceVersion(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (await this.act('De nieuwe versie kon niet worden bewaard', (id) => this.media.replaceVersion(id, file))) {
      this.ui.toast('Nieuwe versie bewaard; overal waar het bestand gebruikt wordt, telt ze meteen mee');
    }
  }

  async archive(): Promise<void> {
    if (await this.act('Archiveren mislukt', (id) => this.media.archive(id))) {
      this.ui.toast('Naar het archief');
      await this.reload();
    }
  }

  async restore(): Promise<void> {
    if (await this.act('Terughalen mislukt', (id) => this.media.restore(id))) {
      this.ui.toast('Teruggehaald uit het archief');
      await this.reload();
    }
  }

  async remove(): Promise<void> {
    const asset = this.selected();
    if (!asset) return;
    const ok = await this.ask('Bestand verwijderen', `“${asset.name}” definitief verwijderen? Ook de eerdere versies gaan weg.`, true);
    if (!ok) return;
    this.busy.set(true);
    try {
      await this.media.deleteAsset(asset.id);
      this.selected.set(null);
      this.ui.toast('Bestand verwijderd');
      await Promise.all([this.reload(), this.loadFolders()]);
    } catch (failure) {
      this.ui.toast(messageOf(failure, 'Verwijderen mislukt'), 'err');
    } finally {
      this.busy.set(false);
    }
  }

  /* ---- where the file is used */
  setLinkType(type: MediaTargetType): void {
    this.linkType.set(type);
    this.linkTarget.set('');
    void this.loadTargets(type);
  }

  private async loadTargets(type: MediaTargetType): Promise<void> {
    const cached = this.targetCache.get(type);
    if (cached) { this.targets.set(cached); return; }
    this.targetsLoading.set(true);
    try {
      let options: TargetOption[] = [];
      switch (type) {
        case 'PRODUCT':
          options = (await this.catalog.products()).filter((product) => product.id !== null)
            .map((product) => ({ id: product.id!, label: product.describedAs || product.name, meta: product.sku }))
            .sort((a, b) => a.label.localeCompare(b.label, 'nl'));
          break;
        case 'PRODUCT_FAMILY':
          options = (await this.catalog.productFamilies()).filter((family) => family.id !== null)
            .map((family) => ({ id: family.id!, label: family.name, meta: family.familyKey }))
            .sort((a, b) => a.label.localeCompare(b.label, 'nl'));
          break;
        case 'PURCHASE_ORDER':
          options = (await this.sourcing.purchaseOrders())
            .map(({ order }) => ({ id: order.id, label: order.number, meta: order.alias }))
            .sort((a, b) => b.id - a.id);
          break;
        case 'PLANNER_ITEM':
          options = (await this.planner.list()).filter((item) => item.id !== null)
            .map((item) => ({ id: item.id!, label: item.title, meta: item.onDate }))
            .sort((a, b) => a.label.localeCompare(b.label, 'nl'));
          break;
      }
      this.targetCache.set(type, options);
      if (this.linkType() === type) this.targets.set(options);
    } catch (failure) {
      this.ui.toast(messageOf(failure, 'De keuzelijst kon niet worden geladen.'), 'err');
    } finally {
      this.targetsLoading.set(false);
    }
  }

  async addLink(): Promise<void> {
    const targetId = this.linkTarget();
    if (targetId === '') return;
    if (await this.act('Koppelen mislukt', (id) => this.media.addLink(id, { targetType: this.linkType(), targetId, role: this.linkRole() }))) {
      this.linkTarget.set('');
      this.ui.toast('Gekoppeld');
    }
  }

  async unlink(linkId: number): Promise<void> {
    if (await this.act('Koppeling weghalen mislukt', (id) => this.media.removeLink(id, linkId))) this.ui.toast('Koppeling weggehaald');
  }

  /* ================================================================ helpers */
  folderLabel(asset: MediaAssetSummary): string {
    if (asset.folderId === null || typeof this.folder() === 'number') return '';
    return this.folders().find((item) => item.id === asset.folderId)?.name ?? '';
  }

  private ask(title: string, message: string, danger = false): Promise<boolean> {
    return new Promise((resolve) => this.ui.confirm(
      { title, message, confirmLabel: danger ? 'Verwijderen' : 'Bevestigen', danger, secondaryLabel: 'Annuleren' },
      () => resolve(true), () => resolve(false)));
  }

  targetLabel(type: MediaTargetType): string {
    return TARGET_OPTIONS.find((option) => option.value === type)?.label ?? type;
  }

  roleLabel(role: MediaRole): string {
    return ROLE_OPTIONS.find((option) => option.value === role)?.label ?? role;
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
