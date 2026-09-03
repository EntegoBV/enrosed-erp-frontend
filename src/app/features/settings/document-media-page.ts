import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CatalogApi } from '../../core/api/catalog-api';
import { saveBlob } from '../../core/api/download';
import { messageOf } from '../../core/api/errors';
import { MediaApi } from '../../core/api/media-api';
import {
  MediaAssetDetail,
  MediaAssetLink,
  MediaAssetSummary,
  MediaKind,
  MediaRole,
  MediaTargetType,
} from '../../core/api/media-models';
import { PlannerApi } from '../../core/api/planner-api';
import { SourcingApi } from '../../core/api/sourcing-api';
import { AuthImage } from '../../core/api/auth-image';
import { Icon } from '../../shared/icon';
import { PageHeader } from '../../shared/page-header';
import { Sheet, Ui, escapeHtml } from '../../shared/ui';
import {
  MediaDetailActionIdentity,
  isCurrentMediaDetailAction,
} from './media-action-identity';

type KindFilter = 'ALL' | MediaKind;
type RoleFilter = 'ALL' | MediaRole;
type TargetFilter = 'ALL' | MediaTargetType;
type ArchiveFilter = 'ACTIVE' | 'ALL' | 'ARCHIVED';

interface TargetOption {
  id: number;
  label: string;
  meta: string | null;
}

const ROLE_OPTIONS: ReadonlyArray<{ value: MediaRole; label: string; help: string }> = [
  { value: 'CATALOGUE', label: 'Catalogus', help: 'Hoofdfoto of bestand voor catalogusuitvoer' },
  { value: 'QUOTE', label: 'Offerte', help: 'Gebruik op offertes en offertebijlagen' },
  { value: 'INVOICE', label: 'Factuur', help: 'Gebruik op verkoopfacturen' },
  { value: 'INTERNAL', label: 'Intern', help: 'Alleen voor intern gebruik' },
];

const TARGET_OPTIONS: ReadonlyArray<{ value: MediaTargetType; label: string }> = [
  { value: 'PRODUCT', label: 'Product' },
  { value: 'PRODUCT_FAMILY', label: 'Productfamilie' },
  { value: 'PURCHASE_ORDER', label: 'Inkooporder' },
  { value: 'PLANNER_ITEM', label: 'Planneritem' },
];

/**
 * Central, reusable media library.
 *
 * Files are never copied when they are linked to another business record. Replacing a file
 * creates a new version and leaves historical document versions intact on the server.
 */
@Component({
  selector: 'app-document-media-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AuthImage, DatePipe, FormsModule, Icon, PageHeader, Sheet],
  template: `
    <app-page-header
      title="Documenten & media"
      subtitle="Eén veilige bibliotheek voor alle bestanden"
      [showBack]="true"
      backTo="/more"
    />

    <main class="content media-page" [attr.aria-busy]="loading() || loadingMore() || uploading()">
      <section
        class="media-intro"
        [class.media-intro--drop]="dropActive()"
        (dragenter)="dragEnter($event)"
        (dragover)="dragOver($event)"
        (dragleave)="dragLeave($event)"
        (drop)="dropFiles($event)"
      >
        <div class="media-intro__mark" aria-hidden="true">
          <app-icon name="media" [size]="25" />
        </div>
        <div class="media-intro__copy">
          <span class="eyebrow">Bestandsbibliotheek</span>
          <h2>Upload één keer, gebruik overal</h2>
          <p>
            Productfoto’s, inkoopdocumenten en plannerbijlagen staan samen op één plek.
            Een identiek bestand wordt hergebruikt in plaats van opnieuw bewaard.
          </p>
        </div>
        <label class="media-upload" [class.media-upload--busy]="uploading()">
          <app-icon name="media" [size]="18" />
          <span>{{ uploading() ? uploadProgress() : 'Bestanden uploaden' }}</span>
          <input type="file" multiple [disabled]="uploading()" (change)="chooseFiles($event)" />
        </label>
        @if (dropActive()) {
          <div class="media-intro__drop" aria-hidden="true">
            Laat los om de bestanden toe te voegen
          </div>
        }
      </section>

      <section class="card media-filters" aria-labelledby="media-filter-title">
        <div class="media-filters__search">
          <label id="media-filter-title" for="media-search">Zoeken</label>
          <input
            class="input"
            id="media-search"
            type="search"
            inputmode="search"
            autocomplete="off"
            placeholder="Naam of bestandsnaam…"
            [ngModel]="query()"
            (ngModelChange)="changeQuery($event)"
          />
        </div>
        <div class="media-filters__selects">
          <label>
            <span>Soort</span>
            <select class="select" [ngModel]="kindFilter()" (ngModelChange)="changeKind($event)">
              <option value="ALL">Alle bestanden</option>
              <option value="IMAGE">Foto’s</option>
              <option value="DOCUMENT">Documenten</option>
            </select>
          </label>
          <label>
            <span>Gebruik</span>
            <select class="select" [ngModel]="roleFilter()" (ngModelChange)="changeRole($event)">
              <option value="ALL">Alle rollen</option>
              @for (role of roleOptions; track role.value) {
                <option [value]="role.value">{{ role.label }}</option>
              }
            </select>
          </label>
          <label>
            <span>Status</span>
            <select class="select" [ngModel]="archiveFilter()" (ngModelChange)="changeArchive($event)">
              <option value="ACTIVE">Actief</option>
              <option value="ALL">Alles</option>
              <option value="ARCHIVED">Archief</option>
            </select>
          </label>
          <label>
            <span>Gekoppeld aan</span>
            <select class="select" [ngModel]="targetFilter()" (ngModelChange)="changeTargetFilter($event)">
              <option value="ALL">Alle onderdelen</option>
              @for (target of targetOptions; track target.value) {
                <option [value]="target.value">{{ target.label }}</option>
              }
            </select>
          </label>
        </div>
        @if (hasFilters()) {
          <button class="media-filters__clear" type="button" (click)="clearFilters()">
            Filters wissen
          </button>
        }
      </section>

      <div class="media-result-head">
        <p>
          @if (loading()) {
            Bestanden laden…
          } @else {
            <b>{{ assets().length }}</b>
            {{ assets().length === 1 ? 'bestand' : 'bestanden' }} geladen
          }
        </p>
        <span><i aria-hidden="true"></i> Dubbele uploads worden automatisch hergebruikt</span>
      </div>

      @if (loadError()) {
        <section class="card media-error" role="alert">
          <div>
            <b>Bibliotheek niet beschikbaar</b>
            <p>{{ loadError() }}</p>
          </div>
          <button class="btn btn--sm" type="button" (click)="reload()">Opnieuw laden</button>
        </section>
      } @else if (loading()) {
        <div class="media-loading" role="status" aria-live="polite">
          <span aria-hidden="true"></span>
          Documenten en media laden…
        </div>
      } @else {
        <section class="media-grid" aria-label="Documenten en media">
          @for (asset of assets(); track asset.id) {
            <article class="card media-card" [class.media-card--archived]="asset.archived">
              <button
                class="media-card__preview"
                type="button"
                [attr.aria-label]="asset.name + ' beheren'"
                (click)="openAsset(asset)"
              >
                @if (asset.kind === 'IMAGE') {
                  <img [appAuthSrc]="thumbnailUrl(asset)" [alt]="asset.name" />
                } @else {
                  <span class="media-card__document" aria-hidden="true">
                    <app-icon name="pdf" [size]="32" />
                    <b>{{ extension(asset) }}</b>
                  </span>
                }
                <span class="media-card__kind">{{ kindLabel(asset.kind) }}</span>
                @if (asset.archived) {
                  <span class="media-card__archive">Gearchiveerd</span>
                }
              </button>

              <div class="media-card__body">
                <div class="media-card__title">
                  <h3 title="{{ asset.name }}">{{ asset.name }}</h3>
                  <span>{{ sizeLabel(asset.sizeBytes) }}</span>
                </div>
                <p title="{{ asset.originalFilename }}">{{ asset.originalFilename }}</p>

                <div class="media-card__badges" aria-label="Gebruiksrollen">
                  @for (role of primaryRoles(asset); track role) {
                    <span class="badge badge--rose">{{ roleLabel(role) }}</span>
                  } @empty {
                    <span class="badge badge--neutral">Geen actieve koppeling</span>
                  }
                </div>

                <div class="media-card__facts">
                  <span>
                    <b>{{ primaryLinkCount(asset) }}</b>
                    {{ primaryLinkCount(asset) === 1 ? 'actieve koppeling' : 'actieve koppelingen' }}
                  </span>
                  <span>
                    <b>{{ asset.versionCount }}</b>
                    {{ asset.versionCount === 1 ? 'versie' : 'versies' }}
                  </span>
                </div>
              </div>

              <footer class="media-card__actions">
                <button type="button" [disabled]="downloadingId() === asset.id" (click)="download(asset)">
                  {{ downloadingId() === asset.id ? 'Downloaden…' : 'Downloaden' }}
                </button>
                <button class="media-card__manage" type="button" (click)="openAsset(asset)">
                  Beheren
                </button>
              </footer>
            </article>
          } @empty {
            <div class="card media-empty">
              <span aria-hidden="true"><app-icon name="media" [size]="31" /></span>
              <h2>{{ hasFilters() ? 'Geen bestanden gevonden' : 'Nog geen bestanden' }}</h2>
              <p>
                {{ hasFilters()
                  ? 'Pas de zoekopdracht of filters aan.'
                  : 'Upload een foto of document. Bestaande product- en ordermedia verschijnen hier automatisch.' }}
              </p>
              @if (hasFilters()) {
                <button class="btn btn--sm" type="button" (click)="clearFilters()">Alles tonen</button>
              }
            </div>
          }
        </section>
        @if (hasMore()) {
          <button
            class="btn media-more"
            type="button"
            [disabled]="loadingMore()"
            (click)="loadMore()"
          >
            {{ loadingMore() ? 'Meer laden…' : 'Meer bestanden laden' }}
          </button>
        }
      }
    </main>

    @if (selectedSummary(); as summary) {
      <app-sheet [title]="summary.name" [wide]="true" (closed)="closeAsset()">
        <div body class="media-detail" [attr.aria-busy]="detailLoading() || detailBusy()">
          @if (detailLoading()) {
            <div class="media-detail__loading" role="status">Bestandsgegevens laden…</div>
          } @else if (detailError()) {
            <div class="alert alert--danger" role="alert">
              <span class="alert__icon">!</span>
              <div><b>Details niet beschikbaar</b><br />{{ detailError() }}</div>
            </div>
          } @else if (detail(); as asset) {
            <section class="media-detail__hero">
              <div class="media-detail__preview">
                @if (asset.kind === 'IMAGE') {
                  <img [appAuthSrc]="thumbnailUrl(asset)" [alt]="asset.name" />
                } @else {
                  <span aria-hidden="true"><app-icon name="pdf" [size]="38" /></span>
                }
              </div>
              <div class="media-detail__identity">
                <span class="eyebrow">{{ kindLabel(asset.kind) }}</span>
                <h3>{{ asset.name }}</h3>
                <p>{{ asset.originalFilename }}</p>
                <div>
                  <span>{{ sizeLabel(asset.sizeBytes) }}</span>
                  @if (asset.widthPx !== null && asset.heightPx !== null) {
                    <span>{{ asset.widthPx }} × {{ asset.heightPx }} px</span>
                  }
                  <span>Versie {{ asset.versionCount }}</span>
                </div>
              </div>
            </section>

            @if (asset.archived) {
              <div class="alert alert--warn">
                <span class="alert__icon">!</span>
                <div>
                  <b>Dit bestand is gearchiveerd.</b><br />
                  Herstel het om de naam, versie of koppelingen te wijzigen.
                </div>
              </div>
            }

            <section class="media-detail__section" aria-labelledby="media-name-title">
              <div class="media-detail__head">
                <div>
                  <span class="eyebrow">Herkenbaar houden</span>
                  <h3 id="media-name-title">Naam in de bibliotheek</h3>
                </div>
              </div>
              <div class="media-name-row">
                <input
                  class="input"
                  aria-label="Naam in de bibliotheek"
                  [disabled]="asset.archived || detailBusy()"
                  [ngModel]="nameDraft()"
                  (ngModelChange)="nameDraft.set($event)"
                />
                <button
                  class="btn btn--primary"
                  type="button"
                  [disabled]="asset.archived || detailBusy() || !nameChanged()"
                  (click)="saveName()"
                >
                  Naam opslaan
                </button>
              </div>
            </section>

            <section class="media-detail__section" aria-labelledby="media-links-title">
              <div class="media-detail__head">
                <div>
                  <span class="eyebrow">Overal hergebruiken</span>
                  <h3 id="media-links-title">Koppelingen</h3>
                </div>
                <span class="badge badge--neutral">{{ asset.links.length }}</span>
              </div>

              <div class="media-links">
                @for (link of asset.links; track link.id) {
                  <article class="media-link" [class.media-link--alternative]="!link.primary">
                    <span class="media-link__mark" aria-hidden="true">
                      <app-icon [name]="targetIcon(link.targetType)" [size]="17" />
                    </span>
                    <div>
                      <div class="media-link__labels">
                        <span>{{ targetTypeLabel(link.targetType) }} · {{ roleLabel(link.role) }}</span>
                        <i class="badge" [class.badge--ok]="link.primary" [class.badge--neutral]="!link.primary">
                          {{ link.primary ? 'Primair' : 'Alternatief' }}
                        </i>
                      </div>
                      <b>{{ link.targetLabel || targetFallback(link) }}</b>
                      @if (link.pinnedVersionId !== null) {
                        <small>Vastgezet op een historische versie</small>
                      } @else if (!link.primary) {
                        <small>Alternatief · niet gebruikt voor nieuwe uitvoer</small>
                      } @else {
                        <small>Volgt altijd de nieuwste versie</small>
                      }
                    </div>
                    <button
                      type="button"
                      [disabled]="asset.archived || detailBusy()"
                      [attr.aria-label]="'Koppeling met ' + (link.targetLabel || targetFallback(link)) + ' verwijderen'"
                      (click)="confirmRemoveLink(link)"
                    >
                      Loskoppelen
                    </button>
                  </article>
                } @empty {
                  <p class="media-links__empty">Nog nergens gekoppeld. Het bestand kan veilig hergebruikt worden.</p>
                }
              </div>

              <div class="media-link-form" [class.media-link-form--disabled]="asset.archived">
                <label>
                  <span>Onderdeel</span>
                  <select
                    class="select"
                    [disabled]="asset.archived || detailBusy()"
                    [ngModel]="linkTargetType()"
                    (ngModelChange)="changeTargetType($event)"
                  >
                    @for (target of targetOptions; track target.value) {
                      <option [value]="target.value">{{ target.label }}</option>
                    }
                  </select>
                </label>
                <label class="media-link-form__target">
                  <span>{{ targetTypeLabel(linkTargetType()) }}</span>
                  <select
                    class="select"
                    [disabled]="asset.archived || detailBusy() || targetsLoading()"
                    [ngModel]="linkTargetId()"
                    (ngModelChange)="linkTargetId.set($event)"
                  >
                    <option value="">{{ targetsLoading() ? 'Laden…' : 'Kies een record' }}</option>
                    @for (target of currentTargets(); track target.id) {
                      <option [value]="target.id">
                        {{ target.label }}{{ target.meta ? ' · ' + target.meta : '' }}
                      </option>
                    }
                  </select>
                </label>
                <label>
                  <span>Rol</span>
                  <select
                    class="select"
                    [disabled]="asset.archived || detailBusy()"
                    [ngModel]="linkRole()"
                    (ngModelChange)="linkRole.set($event)"
                  >
                    @for (role of roleOptions; track role.value) {
                      <option [value]="role.value">{{ role.label }}</option>
                    }
                  </select>
                </label>
                <button
                  class="btn btn--primary"
                  type="button"
                  [disabled]="asset.archived || detailBusy() || !linkTargetId()"
                  (click)="addLink()"
                >
                  Koppeling opslaan
                </button>
              </div>
              <p class="media-detail__hint">
                Voor hetzelfde onderdeel en dezelfde rol wordt de primaire koppeling veilig vervangen;
                oude documenten blijven hun vastgezette versie gebruiken. Alleen <b>Primair</b> wordt
                voor nieuwe uitvoer gebruikt; <b>Alternatief</b> blijft zichtbaar voor de historie.
              </p>
              @if (targetsError()) {
                <p class="media-detail__error" role="alert">{{ targetsError() }}</p>
              }
            </section>

            <section class="media-detail__section" aria-labelledby="media-versions-title">
              <div class="media-detail__head">
                <div>
                  <span class="eyebrow">Historie behouden</span>
                  <h3 id="media-versions-title">Versies</h3>
                </div>
                <label class="media-replace" [class.media-replace--disabled]="asset.archived || detailBusy()">
                  <span>Nieuwe versie</span>
                  <input
                    type="file"
                    [disabled]="asset.archived || detailBusy()"
                    (change)="chooseReplacement($event)"
                  />
                </label>
              </div>
              <p class="media-detail__hint">
                Vervangen maakt een nieuwe versie. Bestaande offertes, facturen en andere historische
                documenten veranderen niet.
              </p>
              <ol class="media-versions">
                @for (version of versionsNewestFirst(); track version.id) {
                  <li [class.media-version--current]="version.id === asset.currentVersionId">
                    <span class="media-version__number">v{{ version.versionNumber }}</span>
                    <div>
                      <b>{{ version.originalFilename }}</b>
                      <span>
                        {{ version.createdAt | date:'dd/MM/yyyy HH:mm' }} · {{ sizeLabel(version.sizeBytes) }}
                        @if (version.createdBy) { · {{ version.createdBy }} }
                      </span>
                    </div>
                    @if (version.id === asset.currentVersionId) {
                      <span class="badge badge--ok">Huidig</span>
                    }
                  </li>
                }
              </ol>
            </section>

            <section class="media-detail__section media-danger-zone" aria-labelledby="media-danger-title">
              <div class="media-detail__head">
                <div>
                  <span class="eyebrow">Bestandsbeheer</span>
                  <h3 id="media-danger-title">Archiveren of verwijderen</h3>
                </div>
              </div>
              <div class="media-danger-zone__actions">
                @if (asset.archived) {
                  <button class="btn" type="button" [disabled]="detailBusy()" (click)="restoreAsset()">
                    Herstellen
                  </button>
                } @else {
                  <button class="btn" type="button" [disabled]="detailBusy()" (click)="archiveAsset()">
                    Archiveren
                  </button>
                }
                <button
                  class="btn btn--danger"
                  type="button"
                  [disabled]="detailBusy() || !asset.archived || asset.links.length > 0"
                  (click)="confirmDelete()"
                >
                  Definitief verwijderen
                </button>
              </div>
              @if (asset.links.length > 0) {
                <p class="media-delete-blocked" role="status">
                  Verwijderen is geblokkeerd omdat dit bestand nog {{ asset.links.length }}
                  {{ asset.links.length === 1 ? 'koppeling heeft' : 'koppelingen heeft' }}.
                  Koppel het eerst overal los. Archiveren bewaart de koppelingen en heft deze blokkade niet op.
                </p>
              } @else if (!asset.archived) {
                <p class="media-delete-blocked" role="status">
                  Archiveer dit bestand eerst. Daarna kan het, zolang het nergens gekoppeld is,
                  definitief worden verwijderd.
                </p>
              } @else {
                <p class="media-detail__hint">
                  Dit gearchiveerde bestand heeft geen koppelingen en kan definitief worden verwijderd.
                </p>
              }
            </section>
          }
        </div>
        <div foot style="display:contents">
          @if (detail(); as asset) {
            <button class="btn" type="button" [disabled]="downloadingId() === asset.id" (click)="download(asset)">
              {{ downloadingId() === asset.id ? 'Downloaden…' : 'Downloaden' }}
            </button>
          }
          <button class="btn btn--primary" type="button" (click)="closeAsset()">Gereed</button>
        </div>
      </app-sheet>
    }
  `,
  styles: `
    :host{display:block;min-width:0}.media-page{max-width:1220px;container:media-page / inline-size}.eyebrow{color:var(--rose);font-size:9.5px;font-weight:800;letter-spacing:.11em;text-transform:uppercase}.media-intro{position:relative;display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:13px;margin-bottom:14px;padding:17px;border:1px solid var(--rose-line);border-radius:var(--r);background:linear-gradient(135deg,var(--surface),color-mix(in srgb,var(--rose-soft) 72%,var(--surface)));box-shadow:var(--sh-1);overflow:hidden}.media-intro--drop{outline:2px dashed var(--rose);outline-offset:3px}.media-intro__mark{display:grid;width:47px;height:47px;place-items:center;border:1px solid var(--rose-line);border-radius:14px;background:var(--surface);color:var(--rose);box-shadow:var(--sh-1)}.media-intro__copy{min-width:0}.media-intro h2{margin-top:2px;font-size:18px;line-height:1.2}.media-intro p{max-width:700px;margin-top:5px;color:var(--muted);font-size:12px;line-height:1.45}.media-upload{position:relative;display:flex;grid-column:1/-1;min-height:46px;align-items:center;justify-content:center;gap:8px;padding:8px 15px;border:1px solid var(--rose);border-radius:12px;background:var(--rose);color:#fff;font-size:13px;font-weight:750;cursor:pointer}.media-upload:focus-within{outline:3px solid var(--rose-line);outline-offset:2px}.media-upload--busy{cursor:wait;opacity:.68}.media-upload input,.media-replace input{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}.media-intro__drop{position:absolute;inset:0;z-index:3;display:grid;place-items:center;padding:20px;background:color-mix(in srgb,var(--rose-soft) 94%,transparent);color:var(--rose-dark);font-size:14px;font-weight:800;text-align:center;pointer-events:none}
    .media-filters{display:grid;gap:12px;margin-bottom:14px;padding:14px}.media-filters label{display:grid;gap:5px;color:var(--ink-2);font-size:11px;font-weight:700}.media-filters__selects{display:grid;grid-template-columns:1fr;gap:8px}.media-filters__clear{justify-self:start;min-height:44px;padding:4px 2px;border:0;background:transparent;color:var(--rose-dark);font-size:11.5px;font-weight:750;cursor:pointer}.media-result-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin:0 2px 9px;color:var(--muted);font-size:11.5px}.media-result-head p{flex:0 0 auto}.media-result-head b{color:var(--ink-2)}.media-result-head>span{display:flex;align-items:center;justify-content:flex-end;gap:6px;text-align:right}.media-result-head i{width:7px;height:7px;flex:0 0 auto;border-radius:50%;background:var(--ok)}.media-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:11px}.media-card{display:grid;min-width:0;overflow:hidden}.media-card--archived{background:var(--surface-2)}.media-card__preview{position:relative;display:grid;width:100%;aspect-ratio:16/9;place-items:center;overflow:hidden;border:0;border-bottom:1px solid var(--line);background:linear-gradient(145deg,var(--surface-2),#fff);cursor:pointer}.media-card__preview img{width:100%;height:100%;object-fit:contain}.media-card__document{position:relative;display:grid;width:76px;height:76px;place-items:center;border:1px solid var(--line);border-radius:20px;background:var(--surface);color:var(--rose);box-shadow:var(--sh-1)}.media-card__document b{position:absolute;left:50%;bottom:8px;padding:2px 5px;border-radius:5px;background:var(--rose-soft);color:var(--rose-dark);font:800 8px/1 var(--mono);text-transform:uppercase;transform:translateX(-50%)}.media-card__kind,.media-card__archive{position:absolute;top:8px;padding:4px 7px;border:1px solid rgb(255 255 255 / 60%);border-radius:8px;background:rgb(35 31 29 / 76%);color:#fff;font-size:8.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase}.media-card__kind{left:8px}.media-card__archive{right:8px;background:color-mix(in srgb,var(--warn) 88%,transparent)}.media-card__body{display:grid;align-content:start;gap:8px;padding:12px 13px}.media-card__title{display:flex;align-items:flex-start;gap:9px}.media-card__title h3{min-width:0;flex:1;overflow:hidden;font-size:14px;line-height:1.25;text-overflow:ellipsis;white-space:nowrap}.media-card__title>span{flex:0 0 auto;color:var(--muted);font-size:10px}.media-card__body>p{overflow:hidden;color:var(--muted);font-size:10.5px;text-overflow:ellipsis;white-space:nowrap}.media-card__badges{display:flex;min-width:0;flex-wrap:wrap;gap:5px}.media-card__badges .badge{padding:2px 7px;font-size:9px}.media-card__facts{display:flex;align-items:center;flex-wrap:wrap;gap:12px;padding-top:3px;color:var(--muted);font-size:10.5px}.media-card__facts span+span{padding-left:12px;border-left:1px solid var(--line)}.media-card__facts b{color:var(--ink-2)}.media-card__actions{display:grid;grid-template-columns:1fr 1fr;border-top:1px solid var(--line)}.media-card__actions button{min-height:44px;padding:7px 10px;border:0;background:transparent;color:var(--ink-2);font-size:11px;font-weight:700;cursor:pointer}.media-card__actions button+button{border-left:1px solid var(--line)}.media-card__actions button:disabled{cursor:wait;opacity:.5}.media-card__actions .media-card__manage{color:var(--rose-dark)}.media-more{display:block;min-width:190px;margin:18px auto 0}.media-loading{display:flex;min-height:260px;align-items:center;justify-content:center;gap:9px;color:var(--muted);font-size:12.5px}.media-loading span{width:9px;height:9px;border-radius:50%;background:var(--rose);animation:media-pulse 1s ease-in-out infinite}.media-error{display:flex;align-items:center;justify-content:space-between;gap:15px;padding:15px}.media-error b{font-size:13.5px}.media-error p{margin-top:2px;color:var(--muted);font-size:11.5px}.media-empty{grid-column:1/-1;display:grid;min-height:260px;place-items:center;align-content:center;gap:6px;padding:30px;text-align:center}.media-empty>span{display:grid;width:54px;height:54px;place-items:center;border-radius:17px;background:var(--rose-soft);color:var(--rose)}.media-empty h2{font-size:15px}.media-empty p{max-width:410px;color:var(--muted);font-size:12px}.media-empty .btn{margin-top:7px}
    .media-detail{display:grid;gap:14px}.media-detail__loading{display:grid;min-height:260px;place-items:center;color:var(--muted);font-size:13px}.media-detail__hero{display:grid;grid-template-columns:84px minmax(0,1fr);align-items:center;gap:13px}.media-detail__preview{display:grid;width:84px;aspect-ratio:1;place-items:center;overflow:hidden;border:1px solid var(--line);border-radius:15px;background:var(--surface-2);color:var(--rose)}.media-detail__preview img{width:100%;height:100%;object-fit:contain}.media-detail__identity{min-width:0}.media-detail__identity h3{overflow-wrap:anywhere;margin-top:2px;font-size:17px;line-height:1.25}.media-detail__identity>p{overflow:hidden;margin-top:3px;color:var(--muted);font-size:10.5px;text-overflow:ellipsis;white-space:nowrap}.media-detail__identity>div{display:flex;flex-wrap:wrap;gap:5px 10px;margin-top:7px;color:var(--ink-2);font-size:10px}.media-detail__section{display:grid;gap:11px;padding-top:14px;border-top:1px solid var(--line)}.media-detail__head{display:flex;align-items:flex-end;justify-content:space-between;gap:12px}.media-detail__head h3{margin-top:2px;font-size:14px}.media-name-row{display:grid;gap:8px}.media-name-row .btn{min-height:46px}.media-links{display:grid;gap:7px}.media-link{display:grid;grid-template-columns:34px minmax(0,1fr);gap:9px;align-items:center;padding:9px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2)}.media-link--alternative{border-style:dashed;background:color-mix(in srgb,var(--surface-2) 60%,var(--surface))}.media-link__mark{display:grid;width:34px;height:34px;place-items:center;border-radius:10px;background:var(--surface);color:var(--rose)}.media-link>div{display:grid;min-width:0}.media-link__labels{display:flex;align-items:center;flex-wrap:wrap;gap:5px}.media-link__labels>span{color:var(--muted);font-size:9px;font-weight:750;letter-spacing:.045em;text-transform:uppercase}.media-link__labels .badge{padding:1px 6px;font-size:8px;font-style:normal}.media-link b{overflow-wrap:anywhere;font-size:11.5px}.media-link small{color:var(--muted);font-size:9.5px}.media-link>button{grid-column:1/-1;min-height:44px;border:1px solid var(--line);border-radius:9px;background:var(--surface);color:var(--danger);font-size:10.5px;font-weight:700;cursor:pointer}.media-link>button:disabled{cursor:not-allowed;opacity:.45}.media-links__empty{padding:13px;border:1px dashed var(--line-strong);border-radius:11px;color:var(--muted);font-size:11.5px;text-align:center}.media-link-form{display:grid;grid-template-columns:1fr;gap:8px;padding:11px;border:1px solid var(--rose-line);border-radius:13px;background:color-mix(in srgb,var(--rose-soft) 55%,var(--surface))}.media-link-form--disabled{opacity:.55}.media-link-form label{display:grid;gap:4px;color:var(--ink-2);font-size:10px;font-weight:700}.media-link-form .select{min-width:0}.media-link-form .btn{min-height:46px}.media-detail__hint{color:var(--muted);font-size:10.5px;line-height:1.45}.media-detail__error{color:var(--danger);font-size:10.5px}.media-replace{position:relative;display:inline-flex;min-height:44px;align-items:center;padding:6px 11px;border:1px solid var(--rose-line);border-radius:10px;background:var(--surface);color:var(--rose-dark);font-size:10.5px;font-weight:750;cursor:pointer}.media-replace:focus-within{outline:3px solid var(--rose-line);outline-offset:2px}.media-replace--disabled{cursor:not-allowed;opacity:.45}.media-versions{display:grid;gap:6px;margin:0;padding:0;list-style:none}.media-versions li{display:grid;grid-template-columns:36px minmax(0,1fr);align-items:center;gap:9px;padding:9px;border:1px solid var(--line);border-radius:11px}.media-versions li.media-version--current{border-color:var(--rose-line);background:var(--rose-soft)}.media-version__number{display:grid;width:34px;height:34px;place-items:center;border-radius:10px;background:var(--surface);color:var(--rose-dark);font:800 10px/1 var(--mono)}.media-versions li>div{display:grid;min-width:0}.media-versions b{overflow:hidden;font-size:10.5px;text-overflow:ellipsis;white-space:nowrap}.media-versions li>div>span{color:var(--muted);font-size:9px}.media-versions .badge{grid-column:2;justify-self:start;font-size:9px}.media-danger-zone__actions{display:grid;grid-template-columns:1fr;gap:8px}.media-delete-blocked{padding:10px 11px;border:1px solid #f0dcbc;border-radius:10px;background:var(--warn-soft);color:#7c450b;font-size:10.5px;line-height:1.45}
    @container media-page (min-width:520px){.media-intro{grid-template-columns:auto minmax(0,1fr) auto}.media-upload{grid-column:auto}.media-filters__selects{grid-template-columns:repeat(2,minmax(0,1fr))}.media-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @container media-page (min-width:860px){.media-filters{grid-template-columns:minmax(220px,1fr) minmax(520px,2fr) auto;align-items:end}.media-filters__selects{grid-template-columns:repeat(4,minmax(0,1fr))}.media-filters__clear{align-self:center}.media-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
    @media(min-width:680px){.media-intro{padding:19px 20px}.media-intro h2{font-size:20px}.media-card__preview{aspect-ratio:4/3}.media-name-row{grid-template-columns:minmax(0,1fr) auto}.media-link{grid-template-columns:38px minmax(0,1fr) auto}.media-link>button{grid-column:auto;min-height:44px;padding-inline:11px}.media-link-form{grid-template-columns:minmax(130px,.7fr) minmax(220px,1.5fr) minmax(130px,.7fr) auto;align-items:end}.media-link-form .btn{min-height:46px}.media-danger-zone__actions{grid-template-columns:auto auto;justify-content:start}.media-versions li{grid-template-columns:40px minmax(0,1fr) auto}.media-versions .badge{grid-column:auto}}
    @media(max-width:359px){.media-intro{grid-template-columns:1fr}.media-intro__mark{width:42px;height:42px}.media-result-head{flex-direction:column}.media-result-head>span{text-align:left}.media-detail__hero{grid-template-columns:66px minmax(0,1fr)}.media-detail__preview{width:66px}.media-detail__head{align-items:flex-start;flex-direction:column}.media-replace{width:100%;justify-content:center}}
    @keyframes media-pulse{50%{opacity:.35;transform:scale(.75)}}@media(prefers-reduced-motion:reduce){.media-loading span{animation:none}}
  `,
})
export class DocumentMediaPage implements OnDestroy {
  private static readonly PAGE_SIZE = 60;
  private readonly api = inject(MediaApi);
  private readonly catalog = inject(CatalogApi);
  private readonly sourcing = inject(SourcingApi);
  private readonly planner = inject(PlannerApi);
  private readonly ui = inject(Ui);

  readonly roleOptions = ROLE_OPTIONS;
  readonly targetOptions = TARGET_OPTIONS;
  readonly assets = signal<MediaAssetSummary[]>([]);
  readonly loading = signal(true);
  readonly loadingMore = signal(false);
  readonly hasMore = signal(false);
  readonly loadError = signal('');
  readonly uploading = signal(false);
  readonly uploadProgress = signal('Uploaden…');
  readonly dropActive = signal(false);
  readonly downloadingId = signal<number | null>(null);

  readonly query = signal('');
  readonly kindFilter = signal<KindFilter>('ALL');
  readonly roleFilter = signal<RoleFilter>('ALL');
  readonly targetFilter = signal<TargetFilter>('ALL');
  readonly archiveFilter = signal<ArchiveFilter>('ACTIVE');
  readonly hasFilters = computed(() => Boolean(
    this.query().trim()
    || this.kindFilter() !== 'ALL'
    || this.roleFilter() !== 'ALL'
    || this.targetFilter() !== 'ALL'
    || this.archiveFilter() !== 'ACTIVE',
  ));

  readonly selectedSummary = signal<MediaAssetSummary | null>(null);
  readonly detail = signal<MediaAssetDetail | null>(null);
  readonly detailLoading = signal(false);
  readonly detailBusy = signal(false);
  readonly detailError = signal('');
  readonly nameDraft = signal('');
  readonly nameChanged = computed(() => {
    const name = this.nameDraft().trim();
    return Boolean(name && name !== this.detail()?.name);
  });
  readonly versionsNewestFirst = computed(() =>
    [...(this.detail()?.versions ?? [])].sort((a, b) => b.versionNumber - a.versionNumber),
  );

  readonly linkTargetType = signal<MediaTargetType>('PRODUCT');
  readonly linkTargetId = signal<number | ''>('');
  readonly linkRole = signal<MediaRole>('CATALOGUE');
  private readonly loadingTargetTypes = signal<ReadonlySet<MediaTargetType>>(new Set());
  readonly targetsLoading = computed(() => this.loadingTargetTypes().has(this.linkTargetType()));
  readonly targetsError = signal('');
  readonly productTargets = signal<TargetOption[]>([]);
  readonly familyTargets = signal<TargetOption[]>([]);
  readonly purchaseTargets = signal<TargetOption[]>([]);
  readonly plannerTargets = signal<TargetOption[]>([]);
  readonly currentTargets = computed(() => {
    switch (this.linkTargetType()) {
      case 'PRODUCT': return this.productTargets();
      case 'PRODUCT_FAMILY': return this.familyTargets();
      case 'PURCHASE_ORDER': return this.purchaseTargets();
      case 'PLANNER_ITEM': return this.plannerTargets();
    }
  });

  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private requestId = 0;
  private detailRequestId = 0;
  private detailActionId = 0;
  private dragDepth = 0;
  private readonly loadedTargetTypes = new Set<MediaTargetType>();

  constructor() {
    void this.reload();
  }

  ngOnDestroy(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
  }

  async reload(): Promise<void> {
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
    const requestId = ++this.requestId;
    this.loadingMore.set(false);
    this.loading.set(true);
    this.loadError.set('');
    try {
      const result = await this.api.assets(this.currentFilters(0));
      if (requestId !== this.requestId) return;
      this.assets.set(result.slice(0, DocumentMediaPage.PAGE_SIZE));
      this.hasMore.set(result.length > DocumentMediaPage.PAGE_SIZE);
    } catch (failure) {
      if (requestId !== this.requestId) return;
      this.assets.set([]);
      this.hasMore.set(false);
      this.loadError.set(messageOf(failure, 'De documenten en media konden niet worden geladen.'));
    } finally {
      if (requestId === this.requestId) this.loading.set(false);
    }
  }

  async loadMore(): Promise<void> {
    if (this.loading() || this.loadingMore() || !this.hasMore()) return;
    const requestId = this.requestId;
    const offset = this.assets().length;
    this.loadingMore.set(true);
    try {
      const result = await this.api.assets(this.currentFilters(offset));
      if (requestId !== this.requestId) return;
      const existing = new Set(this.assets().map((asset) => asset.id));
      const additions = result
        .slice(0, DocumentMediaPage.PAGE_SIZE)
        .filter((asset) => !existing.has(asset.id));
      this.assets.update((items) => [...items, ...additions]);
      this.hasMore.set(result.length > DocumentMediaPage.PAGE_SIZE);
    } catch (failure) {
      if (requestId !== this.requestId) return;
      this.ui.toast(messageOf(failure, 'Meer bestanden konden niet worden geladen.'), 'err');
    } finally {
      if (requestId === this.requestId) this.loadingMore.set(false);
    }
  }

  private currentFilters(offset: number) {
    const archive = this.archiveFilter();
    const kind = this.kindFilter();
    const role = this.roleFilter();
    const target = this.targetFilter();
    return {
      q: this.query(),
      kind: kind === 'ALL' ? undefined : kind,
      role: role === 'ALL' ? undefined : role,
      targetType: target === 'ALL' ? undefined : target,
      archived: archive === 'ALL' ? undefined : archive === 'ARCHIVED',
      includeArchived: archive === 'ALL',
      offset,
      /* One look-ahead record makes hasMore exact without exposing a false
         "Meer laden" button when the last page happens to be full. */
      limit: DocumentMediaPage.PAGE_SIZE + 1,
    };
  }

  changeQuery(value: string): void {
    this.query.set(value);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    /* Invalidate an older page request immediately. Waiting for the debounce
       before doing this could append an old next page under a new query. */
    this.requestId++;
    this.loadingMore.set(false);
    this.hasMore.set(false);
    this.searchTimer = setTimeout(() => void this.reload(), 260);
  }

  changeKind(value: KindFilter): void {
    this.kindFilter.set(value);
    void this.reload();
  }

  changeRole(value: RoleFilter): void {
    this.roleFilter.set(value);
    void this.reload();
  }

  changeArchive(value: ArchiveFilter): void {
    this.archiveFilter.set(value);
    void this.reload();
  }

  changeTargetFilter(value: TargetFilter): void {
    this.targetFilter.set(value);
    void this.reload();
  }

  clearFilters(): void {
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
    this.query.set('');
    this.kindFilter.set('ALL');
    this.roleFilter.set('ALL');
    this.targetFilter.set('ALL');
    this.archiveFilter.set('ACTIVE');
    void this.reload();
  }

  chooseFiles(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    void this.uploadFiles(files);
  }

  dragEnter(event: DragEvent): void {
    event.preventDefault();
    if (!event.dataTransfer?.types.includes('Files')) return;
    this.dragDepth++;
    this.dropActive.set(true);
  }

  dragOver(event: DragEvent): void {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }

  dragLeave(event: DragEvent): void {
    event.preventDefault();
    if (this.dragDepth > 0) this.dragDepth--;
    if (this.dragDepth === 0) this.dropActive.set(false);
  }

  dropFiles(event: DragEvent): void {
    event.preventDefault();
    this.dragDepth = 0;
    this.dropActive.set(false);
    void this.uploadFiles(Array.from(event.dataTransfer?.files ?? []));
  }

  private async uploadFiles(files: File[]): Promise<void> {
    if (!files.length || this.uploading()) return;
    this.uploading.set(true);
    let uploaded = 0;
    let reused = 0;
    let reusedFromArchive = 0;
    let lastArchivedReuse: MediaAssetDetail | null = null;
    const failures: string[] = [];
    for (const [index, file] of files.entries()) {
      this.uploadProgress.set(`${index + 1} van ${files.length}`);
      try {
        const result = await this.api.upload(file);
        uploaded++;
        if (result.reused) reused++;
        if (result.reused && result.asset.archived) {
          reusedFromArchive++;
          lastArchivedReuse = result.asset;
        }
      } catch (failure) {
        failures.push(messageOf(failure, `${file.name} kon niet worden geüpload.`));
      }
    }
    this.uploading.set(false);
    this.uploadProgress.set('Uploaden…');
    if (uploaded) {
      const reusedCopy = reused
        ? ` ${reused} ${reused === 1 ? 'bestand is' : 'bestanden zijn'} zonder dubbele opslag hergebruikt.`
        : '';
      const archiveCopy = reusedFromArchive
        ? ` ${reusedFromArchive === 1 ? 'Het hergebruikte bestand stond' : 'De hergebruikte bestanden stonden'} in het archief; het laatste is geopend zodat u het kunt herstellen.`
        : '';
      if (reusedFromArchive) this.archiveFilter.set('ALL');
      this.ui.toast(`${uploaded} ${uploaded === 1 ? 'bestand toegevoegd.' : 'bestanden toegevoegd.'}${reusedCopy}${archiveCopy}`);
      await this.reload();
      if (lastArchivedReuse) this.openAsset(lastArchivedReuse);
    }
    if (failures.length) this.ui.toast(failures[0], 'err');
  }

  async download(asset: MediaAssetSummary): Promise<void> {
    if (this.downloadingId() !== null) return;
    this.downloadingId.set(asset.id);
    try {
      saveBlob(await this.api.download(asset.id), asset.originalFilename || asset.name);
    } catch (failure) {
      this.ui.toast(messageOf(failure, 'Het bestand kon niet worden gedownload.'), 'err');
    } finally {
      this.downloadingId.set(null);
    }
  }

  thumbnailUrl(asset: MediaAssetSummary): string {
    return this.api.thumbnailUrl(asset.id);
  }

  openAsset(asset: MediaAssetSummary): void {
    this.detailActionId++;
    this.detailBusy.set(false);
    this.selectedSummary.set(asset);
    this.detail.set(null);
    this.detailError.set('');
    this.nameDraft.set(asset.name);
    this.linkTargetId.set('');
    void this.loadDetail(asset.id);
    void this.loadTargetType(this.linkTargetType());
  }

  closeAsset(): void {
    this.detailRequestId++;
    this.detailActionId++;
    this.detailBusy.set(false);
    this.selectedSummary.set(null);
    this.detail.set(null);
    this.detailError.set('');
  }

  private async loadDetail(id: number): Promise<void> {
    const requestId = ++this.detailRequestId;
    this.detailLoading.set(true);
    try {
      const detail = await this.api.asset(id);
      if (requestId !== this.detailRequestId) return;
      this.applyDetail(detail);
    } catch (failure) {
      if (requestId !== this.detailRequestId) return;
      this.detailError.set(messageOf(failure, 'De bestandsdetails konden niet worden geladen.'));
    } finally {
      if (requestId === this.detailRequestId) this.detailLoading.set(false);
    }
  }

  private applyDetail(detail: MediaAssetDetail): void {
    this.detail.set(detail);
    this.selectedSummary.set(detail);
    this.nameDraft.set(detail.name);
    this.assets.update((items) => items.map((item) => item.id === detail.id ? detail : item));
  }

  private updateGridSummary(detail: MediaAssetDetail): void {
    this.assets.update((items) => items.map((item) => item.id === detail.id ? detail : item));
  }

  private currentDetailActionIdentity(): MediaDetailActionIdentity | null {
    const assetId = this.selectedSummary()?.id;
    if (assetId === undefined) return null;
    return {
      assetId,
      detailRequestId: this.detailRequestId,
      actionId: this.detailActionId,
    };
  }

  async saveName(): Promise<void> {
    const asset = this.detail();
    const name = this.nameDraft().trim();
    if (!asset || !name || !this.nameChanged()) return;
    await this.runDetailAction(
      () => this.api.updateName(asset.id, name),
      'Naam opgeslagen.',
      'De naam kon niet worden opgeslagen.',
    );
  }

  chooseReplacement(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const asset = this.detail();
    if (!asset) return;
    this.ui.confirm({
      title: 'Nieuwe versie toevoegen?',
      message: `De huidige versie van <b>${escapeHtml(asset.name)}</b> blijft bewaard voor historische documenten.`,
      confirmLabel: 'Nieuwe versie toevoegen',
    }, () => void this.runDetailAction(
      () => this.api.replaceVersion(asset.id, file),
      'Nieuwe versie toegevoegd. Historische documenten zijn niet gewijzigd.',
      'De nieuwe versie kon niet worden toegevoegd.',
    ));
  }

  changeTargetType(value: MediaTargetType): void {
    this.linkTargetType.set(value);
    this.linkTargetId.set('');
    this.targetsError.set('');
    void this.loadTargetType(value);
  }

  async addLink(): Promise<void> {
    const asset = this.detail();
    const targetId = Number(this.linkTargetId());
    if (!asset || !targetId) return;
    const detailRequestId = this.detailRequestId;
    const saved = await this.runDetailAction(
      () => this.api.addLink(asset.id, {
        targetType: this.linkTargetType(),
        targetId,
        role: this.linkRole(),
      }),
      'Koppeling opgeslagen.',
      'De koppeling kon niet worden opgeslagen.',
    );
    if (saved && this.detail()?.id === asset.id && this.detailRequestId === detailRequestId) {
      this.linkTargetId.set('');
    }
    if (saved) await this.reload();
  }

  confirmRemoveLink(link: MediaAssetLink): void {
    const asset = this.detail();
    if (!asset) return;
    const target = link.targetLabel || this.targetFallback(link);
    this.ui.confirm({
      title: 'Koppeling verwijderen?',
      message: `<b>${escapeHtml(target)}</b> gebruikt dit bestand daarna niet meer voor ${escapeHtml(this.roleLabel(link.role).toLowerCase())}.`,
      confirmLabel: 'Loskoppelen',
      danger: true,
    }, () => void this.removeLink(asset.id, link.id));
  }

  private async removeLink(assetId: number, linkId: number): Promise<void> {
    const saved = await this.runDetailAction(
      () => this.api.removeLink(assetId, linkId),
      'Koppeling verwijderd.',
      'De koppeling kon niet worden verwijderd.',
    );
    /* Linking may demote another asset, while unlinking may promote one.
       Refresh all visible summaries without touching the open sheet. */
    if (saved) await this.reload();
  }

  async archiveAsset(): Promise<void> {
    const asset = this.detail();
    if (!asset) return;
    await this.runDetailAction(
      () => this.api.archive(asset.id),
      'Bestand gearchiveerd. Bestaande koppelingen blijven intact.',
      'Het bestand kon niet worden gearchiveerd.',
    );
    await this.reload();
  }

  async restoreAsset(): Promise<void> {
    const asset = this.detail();
    if (!asset) return;
    await this.runDetailAction(
      () => this.api.restore(asset.id),
      'Bestand hersteld.',
      'Het bestand kon niet worden hersteld.',
    );
    await this.reload();
  }

  confirmDelete(): void {
    const asset = this.detail();
    if (!asset || !asset.archived || asset.links.length) return;
    this.ui.confirm({
      title: 'Bestand definitief verwijderen?',
      message: `<b>${escapeHtml(asset.name)}</b> en alle versies worden permanent verwijderd. Dit kan niet ongedaan worden gemaakt.`,
      confirmLabel: 'Definitief verwijderen',
      danger: true,
    }, () => void this.deleteAsset(asset));
  }

  private async deleteAsset(asset: MediaAssetDetail): Promise<void> {
    const actionId = ++this.detailActionId;
    const identity: MediaDetailActionIdentity = {
      assetId: asset.id,
      detailRequestId: this.detailRequestId,
      actionId,
    };
    this.detailBusy.set(true);
    try {
      await this.api.deleteAsset(asset.id);
      if (isCurrentMediaDetailAction(identity, this.currentDetailActionIdentity())) {
        this.closeAsset();
      } else {
        this.assets.update((items) => items.filter((item) => item.id !== asset.id));
      }
      this.ui.toast('Bestand definitief verwijderd.');
      await this.reload();
    } catch (failure) {
      this.ui.toast(messageOf(
        failure,
        'Het bestand kan niet worden verwijderd zolang het nog gekoppeld is.',
      ), 'err');
      if (isCurrentMediaDetailAction(identity, this.currentDetailActionIdentity())) {
        await this.loadDetail(asset.id);
      }
    } finally {
      if (this.detailActionId === actionId) this.detailBusy.set(false);
    }
  }

  private async runDetailAction(
    action: () => Promise<MediaAssetDetail>,
    success: string,
    failureCopy: string,
  ): Promise<boolean> {
    if (this.detailBusy()) return false;
    const assetId = this.selectedSummary()?.id;
    if (assetId === undefined) return false;
    const actionId = ++this.detailActionId;
    const identity: MediaDetailActionIdentity = {
      assetId,
      detailRequestId: this.detailRequestId,
      actionId,
    };
    this.detailBusy.set(true);
    try {
      const updated = await action();
      if (isCurrentMediaDetailAction(identity, this.currentDetailActionIdentity())) {
        this.applyDetail(updated);
      } else {
        this.updateGridSummary(updated);
      }
      this.ui.toast(success);
      return true;
    } catch (failure) {
      this.ui.toast(messageOf(failure, failureCopy), 'err');
      return false;
    } finally {
      if (this.detailActionId === actionId) this.detailBusy.set(false);
    }
  }

  private async loadTargetType(type: MediaTargetType): Promise<void> {
    if (this.loadedTargetTypes.has(type) || this.loadingTargetTypes().has(type)) return;
    this.loadingTargetTypes.update((loading) => new Set([...loading, type]));
    if (this.linkTargetType() === type) this.targetsError.set('');
    try {
      switch (type) {
        case 'PRODUCT': {
          const products = await this.catalog.products();
          this.productTargets.set(products
            .filter((product) => product.id !== null)
            .map((product) => ({
              id: product.id!,
              label: product.describedAs || product.name,
              meta: product.sku,
            }))
            .sort((a, b) => a.label.localeCompare(b.label, 'nl')));
          break;
        }
        case 'PRODUCT_FAMILY': {
          const families = await this.catalog.productFamilies();
          this.familyTargets.set(families
            .filter((family) => family.id !== null)
            .map((family) => ({ id: family.id!, label: family.name, meta: family.familyKey }))
            .sort((a, b) => a.label.localeCompare(b.label, 'nl')));
          break;
        }
        case 'PURCHASE_ORDER': {
          const purchases = await this.sourcing.purchaseOrders();
          this.purchaseTargets.set(purchases.map(({ order }) => ({
            id: order.id,
            label: order.number,
            meta: order.alias,
          })).sort((a, b) => b.id - a.id));
          break;
        }
        case 'PLANNER_ITEM': {
          const items = await this.planner.list();
          this.plannerTargets.set(items
            .filter((item) => item.id !== null)
            .map((item) => ({
              id: item.id!,
              label: item.title,
              meta: item.onDate,
            }))
            .sort((a, b) => a.label.localeCompare(b.label, 'nl')));
          break;
        }
      }
      this.loadedTargetTypes.add(type);
    } catch (failure) {
      if (this.linkTargetType() === type) {
        this.targetsError.set(messageOf(
          failure,
          'De keuzelijst kon niet worden geladen. Sluit het bestand en probeer opnieuw.',
        ));
      }
    } finally {
      this.loadingTargetTypes.update((loading) => {
        const next = new Set(loading);
        next.delete(type);
        return next;
      });
    }
  }

  primaryLinkCount(asset: MediaAssetSummary): number {
    return asset.links.filter((link) => link.primary).length;
  }

  primaryRoles(asset: MediaAssetSummary): MediaRole[] {
    return [...new Set(asset.links
      .filter((link) => link.primary)
      .map((link) => link.role))];
  }

  kindLabel(kind: MediaKind): string {
    return kind === 'IMAGE' ? 'Foto' : 'Document';
  }

  roleLabel(role: MediaRole): string {
    return ROLE_OPTIONS.find((option) => option.value === role)?.label ?? role;
  }

  targetTypeLabel(type: MediaTargetType): string {
    return TARGET_OPTIONS.find((option) => option.value === type)?.label ?? type;
  }

  targetIcon(type: MediaTargetType): string {
    switch (type) {
      case 'PRODUCT':
      case 'PRODUCT_FAMILY': return 'products';
      case 'PURCHASE_ORDER': return 'purchase';
      case 'PLANNER_ITEM': return 'activity';
    }
  }

  targetFallback(link: MediaAssetLink): string {
    return `${this.targetTypeLabel(link.targetType)} ${link.targetId}`;
  }

  extension(asset: MediaAssetSummary): string {
    const extension = asset.originalFilename.split('.').pop();
    return extension && extension !== asset.originalFilename ? extension.slice(0, 5) : 'FILE';
  }

  sizeLabel(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  }
}
