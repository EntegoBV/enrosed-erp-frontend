import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, input, signal,
} from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { AuthImage } from '../../core/api/auth-image';
import { messageOf } from '../../core/api/errors';
import { MediaAssetDetail, MediaAssetLink, MediaAssetSummary } from '../../core/api/media-models';
import { Icon } from '../../shared/icon';
import { DateTimeNlPipe } from '../../shared/pipes';
import { MenuTrigger } from '../../shared/menu-trigger';
import { Skeleton } from '../../shared/skeleton';
import { SwipeActions } from '../../shared/swipe-actions';
import { Sheet, Ui } from '../../shared/ui';
import {
  badgeText, extensionTone, extensionToneClass, fileKindChip, fileKindLabel, isSourceLink, linkLabel, sourceCaption,
  sourceRoute, targetIconName, targetLabel, targetRoute, targetTone,
} from './files-collections';
import { canLink, canReplace, canShare, crumbsFor, deleteBlock, fileActions, hasWeb, sizeLabel } from './files-rules';
import { FilesController } from './files-controller';

/**
 * Everything about the file in view, in one order on every surface: what
 * it is, a preview, its name, the four things you do most, where it is
 * used, where it is filed, its public link, the details, versions and
 * history, and at the end archive (or, in Archief, restore and delete).
 *
 * 'pane' is the desk's docked column, 'drawer' the same over the list when
 * the page is narrow, 'screen' the phone's file screen with its glass
 * toolbar. Without a file the desk inspector shows the selection, the
 * folder or a word about the place.
 */
@Component({
  selector: 'app-files-inspector',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AuthImage, Icon, DateTimeNlPipe, MenuTrigger, Skeleton, SwipeActions, Sheet],
  host: {
    '[class.wk-inspector]': "layout() !== 'screen'",
    '[class.wk-inspector--drawer]': "layout() === 'drawer'",
    '[class.files-insp]': "layout() !== 'screen'",
    '[class.files-screen]': "layout() === 'screen'",
    '[attr.aria-label]': "layout() === 'screen' ? null : 'Info'",
    '[attr.role]': "layout() === 'screen' ? null : 'complementary'",
  },
  template: `
    @let asset = c.detail();
    @let openId = c.openFileId();
    @if (openId !== null && (!asset || asset.id !== openId)) {
      @if (c.detailError(); as error) {
        <!-- ============================ the file could not be loaded -->
        @if (layout() === 'screen') {
          <div class="ios-empty" role="alert">
            <span class="ios-empty__icon"><app-icon name="alert" [size]="26" /></span>
            <p class="ios-empty__title">Bestand niet geladen</p>
            <p class="ios-empty__text">{{ error }}</p>
            <button class="ios-capsule ios-capsule--tinted" type="button" (click)="c.retryDetail()">Opnieuw proberen</button>
          </div>
        } @else {
          @if (layout() === 'drawer') {
            <header class="wk-inspector__head"><h2 class="wk-inspector__title">Bestand</h2>
              <button class="wk-btn wk-btn--icon wk-btn--ghost" type="button" aria-label="Info sluiten" (click)="c.drawerOpen.set(false)"><app-icon name="close" [size]="17" /></button></header>
          }
          <div class="wk-empty" role="alert">
            <span class="wk-empty__icon"><app-icon name="alert" [size]="22" /></span>
            <p class="wk-empty__title">Bestand niet geladen</p>
            <p class="wk-empty__text">{{ error }}</p>
            <div class="wk-empty__actions"><button class="wk-btn" type="button" (click)="c.retryDetail()">Opnieuw proberen</button></div>
          </div>
        }
      } @else {
        <div class="files-insp__loading"><app-skeleton kind="card" [rows]="1" /><app-skeleton kind="lines" [rows]="4" /></div>
      }
    } @else if (asset && layout() === 'screen') {
      <!-- ============================ phone: the file screen -->
      <div class="files-screen__preview">
        @if (asset.kind === 'IMAGE') {
          <button type="button" class="files-screen__image" aria-label="Snel bekijken" (click)="c.openQuickLook(asset.id)">
            <img [appAuthSrc]="c.media.fileUrl(asset.id, asset.web ? 'web' : 'original')" appAuthSize="medium" [alt]="asset.name" />
          </button>
        } @else {
          <div class="files-screen__doc">
            <span class="files-ext files-ext--lg" [class]="toneOf(asset)">{{ badge(asset) }}</span>
            <button class="ios-capsule ios-capsule--tinted ios-capsule--sm" type="button" (click)="c.openQuickLook(asset.id)">Bekijken</button>
          </div>
        }
      </div>
      <div class="files-screen__name">
        <input id="files-name" class="files-screen__title" type="text" enterkeyhint="done" autocomplete="off" aria-label="Naam"
               [value]="c.nameDraft()" (input)="c.nameDraft.set(value($event))" (keydown.enter)="blur($event)"
               (keydown.escape)="c.revertName(); blur($event)" (blur)="c.saveName()" />
        <p class="ios-caption">{{ meta(asset) }}</p>
      </div>

      <section class="ios-section">
        <div class="ios-section__head"><h2>Gebruikt bij</h2></div>
        <div class="ios-group ios-group--icons">
          @for (link of asset.links; track link.id) {
            @if (isSource(link)) {
              @if (route(link); as to) {
                <a class="ios-cell" [routerLink]="to.link" [queryParams]="to.query">
                  <span class="ios-tile" [class]="tone(link)"><app-icon [name]="icon(link)" [size]="17" /></span>
                  <span class="ios-cell__body"><span class="ios-cell__title">{{ label(link) }}</span><span class="ios-cell__sub">{{ caption(link) }}</span></span>
                  <app-icon class="ios-cell__chev" name="chevron-right" [size]="18" />
                </a>
              } @else {
                <div class="ios-cell">
                  <span class="ios-tile" [class]="tone(link)"><app-icon [name]="icon(link)" [size]="17" /></span>
                  <span class="ios-cell__body"><span class="ios-cell__title">{{ label(link) }}</span><span class="ios-cell__sub">{{ caption(link) }}</span></span>
                </div>
              }
            } @else {
              <div class="ios-swipe" appSwipeActions #sw="swipeActions" [swipeEnd]="1" swipeFull="none">
                <div class="ios-swipe__actions ios-swipe__actions--end">
                  <button class="ios-swipe__btn tone-danger" type="button" (click)="sw.close(); c.unlink(asset, link)"><app-icon name="unlink" [size]="18" />Loskoppelen</button>
                </div>
                <div class="ios-swipe__row">
                  @if (route(link); as to) {
                    <a class="ios-cell" [routerLink]="to.link" [queryParams]="to.query" appMenuTrigger (menuTrigger)="linkMenu(asset, link)">
                      <span class="ios-tile" [class]="tone(link)"><app-icon [name]="icon(link)" [size]="17" /></span>
                      <span class="ios-cell__body"><span class="ios-cell__title">{{ label(link) }}</span><span class="ios-cell__sub">{{ caption(link) }}</span></span>
                      <app-icon class="ios-cell__chev" name="chevron-right" [size]="18" />
                    </a>
                  } @else {
                    <div class="ios-cell" appMenuTrigger (menuTrigger)="linkMenu(asset, link)">
                      <span class="ios-tile" [class]="tone(link)"><app-icon [name]="icon(link)" [size]="17" /></span>
                      <span class="ios-cell__body"><span class="ios-cell__title">{{ label(link) }}</span><span class="ios-cell__sub">{{ caption(link) }}</span></span>
                    </div>
                  }
                </div>
              </div>
            }
          }
          @if (pending(); as wait) {
            <div class="ios-cell files-pending">
              <span class="ios-tile tone-blue"><app-icon name="purchase" [size]="17" /></span>
              @if (wait.stale) {
                <a class="ios-cell__body" [routerLink]="['/purchasing', wait.orderId]"><span class="ios-cell__title">Nog niet zichtbaar</span><span class="ios-cell__sub">Kijk in het dossier van {{ wait.label }} ›</span></a>
              } @else {
                <span class="ios-cell__body"><span class="ios-cell__title">Wordt gekoppeld aan {{ wait.label }}</span><span class="ios-cell__sub">tot 1 minuut</span></span>
              }
            </div>
          }
          <button class="ios-cell ios-cell--action" type="button" [disabled]="!linkable(asset) || !!c.progress()" (click)="c.pickLinkTarget([asset])">
            <span class="ios-tile ios-tile--soft tone-accent"><app-icon name="link" [size]="17" /></span>Koppelen aan…
          </button>
        </div>
        @if (!asset.links.length && !pending()) { <p class="ios-section__foot">Nog nergens gekoppeld.</p> }
      </section>

      <section class="ios-section">
        <div class="ios-section__head"><h2>Map</h2></div>
        <div class="ios-group ios-group--icons">
          <button class="ios-cell" type="button" (click)="c.pickMoveTarget([asset])">
            <span class="ios-tile ios-tile--soft tone-amber"><app-icon name="folder" [size]="17" /></span>
            <span class="ios-cell__body"><span class="ios-cell__title">{{ c.pathOf(asset.folderId) }}</span><span class="ios-cell__sub">Tik om te verplaatsen</span></span>
            <app-icon class="ios-cell__chev" name="chevron-right" [size]="18" />
          </button>
        </div>
      </section>

      <section class="ios-section" id="files-share">
        <div class="ios-section__head"><h2>Publieke link</h2></div>
        <div class="ios-group">
          @if (asset.share; as share) {
            <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Gedeeld</span><span class="ios-cell__sub">{{ share.downloads }}× geopend · sinds {{ share.createdAt | dateTimeNl }}</span></span><app-icon class="ok-text" name="globe" [size]="18" /></div>
            <button class="ios-cell ios-cell--action" type="button" (click)="c.copyLink(share.token)">Kopieer link</button>
            @if (asset.web) { <button class="ios-cell ios-cell--action" type="button" (click)="c.copyLink(share.token, 'Weblink gekopieerd', 'web')">Kopieer weblink</button> }
            <button class="ios-cell ios-cell--action" type="button" (click)="c.shareLinkVia(asset)">Deel link via…</button>
            <button class="ios-cell ios-cell--action files-danger" type="button" (click)="c.unshare(asset)">Link intrekken</button>
          } @else {
            <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Niet gedeeld</span>
              @if (!shareable(asset)) { <span class="ios-cell__sub">Haal het eerst terug uit het archief</span> }</span></div>
            <button class="ios-cell ios-cell--action" type="button" [disabled]="!shareable(asset)" (click)="c.share(asset)">Link maken…</button>
          }
        </div>
      </section>

      <section class="ios-section">
        <div class="ios-group">
          <details class="ios-disclosure" (toggle)="toggleHistory($event, asset.id)">
            <summary>Info en geschiedenis <app-icon class="ios-cell__chev" name="chevron-right" [size]="18" /></summary>
            <div class="files-screen__info">
              <dl class="wk-kv">
                <div><dt>Oorspronkelijk bestand</dt><dd class="mono">{{ asset.originalFilename }}</dd></div>
                @if (asset.widthPx) { <div><dt>Afmetingen</dt><dd>{{ asset.widthPx }} × {{ asset.heightPx }} px</dd></div> }
                <div><dt>Toegevoegd</dt><dd>{{ asset.createdAt | dateTimeNl }}{{ asset.createdByName ? ' · ' + asset.createdByName : '' }}</dd></div>
                <div><dt>Gewijzigd</dt><dd>{{ asset.updatedAt | dateTimeNl }}</dd></div>
                <div><dt>Origineel</dt><dd>{{ size(asset.sizeBytes) }}</dd></div>
                @if (asset.kind === 'IMAGE') { <div><dt>Webformaat</dt><dd>{{ asset.web ? size(asset.web.sizeBytes) : 'wordt gemaakt bij de eerste opvraging' }}</dd></div> }
              </dl>
              <h3 class="files-subhead">Versies</h3>
              <ul class="files-versions">
                @for (version of versions(asset); track version.id; let first = $first) {
                  <li><b>v{{ version.versionNumber }}{{ first ? ' · huidig' : '' }}</b><small>{{ version.createdAt | dateTimeNl }}{{ version.createdByName ? ' · ' + version.createdByName : '' }} · {{ size(version.sizeBytes) }}</small></li>
                }
              </ul>
              <h3 class="files-subhead">Geschiedenis</h3>
              @if (c.historyLoading()) { <app-skeleton kind="lines" [rows]="2" /> }
              @else if (c.historyFailed()) { <p class="files-muted">Niet geladen · <button class="wk-link" type="button" (click)="c.loadHistory(asset.id)">Opnieuw proberen</button></p> }
              @else if (c.history(); as events) {
                @if (!events.length) { <p class="files-muted">Nog niets gelogd voor dit bestand.</p> }
                <ul class="files-events">
                  @for (event of events; track event.id) { <li><b>{{ event.actor?.displayName || 'Systeem' }}</b> {{ event.summary }}<small>{{ event.at | dateTimeNl }}</small></li> }
                </ul>
              }
              <p class="files-muted">Verplaatsingen staan niet in de geschiedenis.</p>
            </div>
          </details>
        </div>
      </section>

      <section class="ios-section">
        <div class="ios-group">
          @if (asset.archived) {
            <button class="ios-cell ios-cell--action" type="button" (click)="c.restore([asset])">Terughalen</button>
            <button class="ios-cell ios-cell--danger" type="button" [disabled]="!!asset.links.length" (click)="c.deletePermanent([asset])">Definitief verwijderen</button>
          } @else {
            <button class="ios-cell ios-cell--danger" type="button" (click)="c.archive([asset])">Archiveer</button>
          }
        </div>
        @if (asset.archived && asset.links.length) { <p class="ios-section__foot">Definitief verwijderen kan pas als het bestand nergens meer gekoppeld is.</p> }
      </section>

      <nav class="ios-toolbar" aria-label="Bestand">
        <button class="ios-toolbar__btn" type="button" [disabled]="asset.archived" (click)="c.openShareSheet(asset)"><app-icon name="share" [size]="22" />Deel</button>
        <button class="ios-toolbar__btn" type="button" [disabled]="c.downloading()" (click)="c.download(asset)"><app-icon name="download" [size]="22" />Download</button>
        @if (asset.archived) {
          <button class="ios-toolbar__btn" type="button" (click)="c.restore([asset])"><app-icon name="restore" [size]="22" />Terughalen</button>
          <button class="ios-toolbar__btn ios-toolbar__btn--danger" type="button" [disabled]="!!asset.links.length" (click)="c.deletePermanent([asset])"><app-icon name="trash" [size]="22" />Verwijder</button>
        } @else {
          <button class="ios-toolbar__btn" type="button" (click)="c.pickMoveTarget([asset])"><app-icon name="move" [size]="22" />Verplaats</button>
          <button class="ios-toolbar__btn" type="button" (click)="c.archive([asset])"><app-icon name="archive" [size]="22" />Archiveer</button>
        }
      </nav>

      @if (c.shareSheetFor() === asset.id) {
        <app-sheet title="Delen" variant="ios" (closed)="c.shareSheetFor.set(null)">
          <div body>
            <section class="ios-section">
              <div class="ios-group ios-group--icons">
                @if (c.sharePrepared()?.assetId === asset.id) {
                  <button class="ios-cell ios-cell--action" type="button" (click)="c.shareNow(asset)">
                    <span class="ios-tile tone-accent"><app-icon name="share" [size]="17" /></span>Nu delen</button>
                } @else {
                  <button class="ios-cell ios-cell--action" type="button" [disabled]="c.sharePreparing()" (click)="c.prepareShare(asset)">
                    <span class="ios-tile tone-accent"><app-icon name="share" [size]="17" /></span>{{ c.sharePreparing() ? 'Bestand ophalen…' : 'Bestand delen…' }}</button>
                }
              </div>
              <p class="ios-section__foot">Stuurt het bestand zelf mee, via Berichten, Mail of AirDrop.</p>
            </section>
            <section class="ios-section">
              <div class="ios-group ios-group--icons">
                @if (asset.share; as share) {
                  <button class="ios-cell ios-cell--action" type="button" (click)="c.copyLink(share.token); c.shareSheetFor.set(null)">
                    <span class="ios-tile tone-green"><app-icon name="copy" [size]="17" /></span>Kopieer link</button>
                  @if (asset.web) {
                    <button class="ios-cell ios-cell--action" type="button" (click)="c.copyLink(share.token, 'Weblink gekopieerd', 'web'); c.shareSheetFor.set(null)">
                      <span class="ios-tile tone-green"><app-icon name="image" [size]="17" /></span>Kopieer weblink</button>
                  }
                  <button class="ios-cell ios-cell--action" type="button" (click)="c.shareLinkVia(asset)">
                    <span class="ios-tile tone-green"><app-icon name="globe" [size]="17" /></span>Deel link via…</button>
                  <button class="ios-cell ios-cell--action files-danger" type="button" (click)="c.shareSheetFor.set(null); c.unshare(asset)">
                    <span class="ios-tile tone-danger"><app-icon name="unlink" [size]="17" /></span>Link intrekken</button>
                } @else {
                  <button class="ios-cell ios-cell--action" type="button" [disabled]="!shareable(asset)" (click)="c.shareSheetFor.set(null); c.share(asset)">
                    <span class="ios-tile tone-green"><app-icon name="globe" [size]="17" /></span>Publieke link…</button>
                }
              </div>
              <p class="ios-section__foot">Een publieke link opent zonder in te loggen.</p>
            </section>
          </div>
        </app-sheet>
      }
    } @else if (asset) {
      <!-- ============================ desk: one file -->
      <header class="wk-inspector__head">
        <h2 #heading class="wk-inspector__title" tabindex="-1">
          <span class="wk-pill" [class]="toneOf(asset)">{{ chip(asset) }}</span>
          @if (asset.archived) { <span class="wk-pill tone-grey">Gearchiveerd</span> }
        </h2>
        <button class="wk-btn wk-btn--icon wk-btn--ghost" type="button" aria-label="Meer acties" (click)="moreMenu($event, asset)"><app-icon name="more" [size]="18" /></button>
        @if (layout() === 'drawer') {
          <button class="wk-btn wk-btn--icon wk-btn--ghost" type="button" aria-label="Info sluiten" (click)="c.drawerOpen.set(false)"><app-icon name="close" [size]="17" /></button>
        }
      </header>

      <div class="files-insp__preview">
        @if (asset.kind === 'IMAGE') {
          <button type="button" class="files-insp__image" aria-label="Snel bekijken" (click)="c.openQuickLook(asset.id)">
            <img [appAuthSrc]="c.media.fileUrl(asset.id, asset.web ? 'web' : 'original')" appAuthSize="medium" [alt]="asset.name" />
          </button>
        } @else if (isPdf(asset)) {
          @if (pdfUrl(); as url) {
            <iframe class="files-insp__pdf" [src]="url" title="Voorbeeld"></iframe>
          } @else {
            <span class="files-ext files-ext--lg" [class]="toneOf(asset)">{{ badge(asset) }}</span>
            <button class="wk-btn wk-btn--sm" type="button" [disabled]="pdfLoading()" (click)="loadPdf(asset)">{{ pdfLoading() ? 'Laden…' : 'Voorbeeld tonen' }}</button>
          }
        } @else {
          <span class="files-ext files-ext--lg" [class]="toneOf(asset)">{{ badge(asset) }}</span>
        }
      </div>

      <div class="files-insp__name">
        <input id="files-name" class="files-insp__title" type="text" autocomplete="off" aria-label="Naam" [value]="c.nameDraft()"
               (input)="c.nameDraft.set(value($event))" (keydown.enter)="c.saveName()" (keydown.escape)="escName($event)" />
        @if (c.nameDraft().trim() && c.nameDraft().trim() !== asset.name) {
          <button class="wk-btn wk-btn--primary wk-btn--sm" type="button" [disabled]="c.busy()" (click)="c.saveName()">Bewaren</button>
        }
        <p class="files-muted">{{ meta(asset) }}</p>
      </div>

      <div class="files-insp__actions" role="group" aria-label="Acties">
        <button type="button" (click)="c.openQuickLook(asset.id)"><app-icon name="eye" [size]="18" />Bekijk</button>
        <button type="button" [disabled]="c.downloading()" (click)="downloadMenu($event, asset)"><app-icon name="download" [size]="18" />Download</button>
        <button type="button" (click)="shareSection(asset)"><app-icon name="share" [size]="18" />Deel</button>
        <button type="button" (click)="c.pickMoveTarget([asset])"><app-icon name="move" [size]="18" />Verplaats</button>
      </div>

      <section class="wk-section">
        <h3 class="wk-section__title">Gebruikt bij <span>{{ asset.links.length || '' }}</span></h3>
        @for (link of asset.links; track link.id) {
          <div class="files-link">
            <span class="files-link__icon" [class]="tone(link)"><app-icon [name]="icon(link)" [size]="15" /></span>
            <span class="files-link__body">
              @if (route(link); as to) { <a class="files-link__label" [routerLink]="to.link" [queryParams]="to.query">{{ label(link) }}</a> }
              @else { <span class="files-link__label">{{ label(link) }}</span> }
              <small>{{ caption(link) }}
                @if (link.primary && (link.targetType === 'PRODUCT' || link.targetType === 'PRODUCT_FAMILY')) { <span class="wk-pill">hoofdfoto</span> }
                @if (link.role === 'CATALOGUE') { <span class="wk-pill tone-green">Website</span> }
              </small>
            </span>
            @if (isSource(link)) {
              <span class="files-link__source">
                <span class="wk-pill wk-pill--outline" title="Beheer dit bij de bron">Via bron</span>
                @if (sourceTo(link); as to) { <a class="wk-link" [routerLink]="to.link" [queryParams]="to.query">Beheer bij de bron ›</a> }
              </span>
            } @else {
              <button class="wk-btn wk-btn--icon wk-btn--ghost wk-btn--sm" type="button" [attr.aria-label]="'Loskoppelen van ' + label(link)"
                      title="Loskoppelen" [disabled]="c.busy()" (click)="c.unlink(asset, link)"><app-icon name="close" [size]="14" /></button>
            }
          </div>
        }
        @if (pending(); as wait) {
          <div class="files-link files-link--pending">
            <span class="files-link__icon tone-blue"><app-icon name="purchase" [size]="15" /></span>
            @if (wait.stale) {
              <span class="files-link__body">Nog niet zichtbaar; <a class="wk-link" [routerLink]="['/purchasing', wait.orderId]">kijk in het dossier ›</a></span>
            } @else {
              <span class="files-link__body">Wordt gekoppeld aan {{ wait.label }} (tot 1 minuut)</span>
            }
          </div>
        }
        @if (!asset.links.length && !pending()) { <p class="files-muted">Nog nergens gekoppeld</p> }
        <button class="wk-link files-insp__add" type="button" [disabled]="!linkable(asset) || !!c.progress()" (click)="c.pickLinkTarget([asset])">+ Koppelen aan…</button>
      </section>

      <section class="wk-section">
        <h3 class="wk-section__title">Map</h3>
        <nav class="files-path" aria-label="Map">
          @for (crumb of crumbs(asset); track crumb.id; let last = $last) {
            <button type="button" class="wk-link" (click)="c.openFolder(crumb.id)">{{ crumb.name }}</button>@if (!last) { <app-icon name="chevron-right" [size]="12" /> }
          } @empty { <span class="files-muted">Zonder map</span> }
        </nav>
        <div class="files-insp__row">
          <button class="wk-btn wk-btn--sm" type="button" (click)="c.pickMoveTarget([asset])">Verplaatsen…</button>
          @if (!inOwnFolder(asset)) { <button class="wk-btn wk-btn--sm wk-btn--ghost" type="button" (click)="c.reveal(asset)">Toon in map</button> }
        </div>
      </section>

      <section class="wk-section files-insp__share" id="files-share" [class.is-flash]="flash()">
        <h3 class="wk-section__title">Publieke link</h3>
        @if (asset.share; as share) {
          <p class="files-insp__status"><app-icon class="ok-text" name="globe" [size]="15" /> Gedeeld · {{ share.downloads }}× geopend · sinds {{ share.createdAt | dateTimeNl }}</p>
          <div class="files-insp__row">
            <button class="wk-btn wk-btn--sm" type="button" (click)="c.copyLink(share.token)"><app-icon name="copy" [size]="14" />Kopieer link</button>
            @if (asset.web) { <button class="wk-btn wk-btn--sm" type="button" (click)="c.copyLink(share.token, 'Weblink gekopieerd', 'web')">Kopieer weblink</button> }
            <button class="wk-btn wk-btn--sm wk-btn--danger" type="button" [disabled]="c.busy()" (click)="c.unshare(asset)">Link intrekken</button>
          </div>
        } @else {
          <p class="files-insp__status">Niet gedeeld</p>
          <button class="wk-btn wk-btn--sm" type="button" [disabled]="c.busy() || !shareable(asset)"
                  [title]="shareable(asset) ? '' : 'Haal het eerst terug uit het archief'" (click)="c.share(asset)">Link maken…</button>
          @if (!shareable(asset)) { <p class="files-muted">Haal het eerst terug uit het archief</p> }
        }
      </section>

      <details class="wk-section files-insp__more" open>
        <summary class="wk-section__title">Details</summary>
        <dl class="wk-kv">
          <div><dt>Oorspronkelijk bestand</dt><dd class="mono">{{ asset.originalFilename }}</dd></div>
          @if (asset.widthPx) { <div><dt>Afmetingen</dt><dd>{{ asset.widthPx }} × {{ asset.heightPx }} px</dd></div> }
          <div><dt>Toegevoegd</dt><dd>{{ asset.createdAt | dateTimeNl }}{{ asset.createdByName ? ' · ' + asset.createdByName : '' }}</dd></div>
          <div><dt>Gewijzigd</dt><dd>{{ asset.updatedAt | dateTimeNl }}</dd></div>
          <div><dt>Origineel</dt><dd>{{ size(asset.sizeBytes) }}</dd></div>
          @if (asset.kind === 'IMAGE') { <div><dt>Webformaat</dt><dd>{{ asset.web ? size(asset.web.sizeBytes) : 'wordt gemaakt bij de eerste opvraging' }}</dd></div> }
        </dl>
      </details>

      <details class="wk-section files-insp__more" [open]="asset.versionCount > 1">
        <summary class="wk-section__title">Versies <span>{{ asset.versionCount }}</span></summary>
        <ul class="files-versions">
          @for (version of versions(asset); track version.id; let first = $first) {
            <li><b>v{{ version.versionNumber }}{{ first ? ' · huidig' : '' }}</b><small>{{ version.createdAt | dateTimeNl }}{{ version.createdByName ? ' · ' + version.createdByName : '' }} · {{ size(version.sizeBytes) }}</small></li>
          }
        </ul>
        <button class="wk-btn wk-btn--sm" type="button" [disabled]="c.busy() || !replaceable(asset)" (click)="c.chooseVersion(asset)"><app-icon name="upload" [size]="14" />Nieuwe versie…</button>
      </details>

      <details class="wk-section files-insp__more" (toggle)="toggleHistory($event, asset.id)">
        <summary class="wk-section__title">Geschiedenis</summary>
        @if (c.historyLoading()) { <app-skeleton kind="lines" [rows]="2" /> }
        @else if (c.historyFailed()) { <p class="files-muted">Niet geladen · <button class="wk-link" type="button" (click)="c.loadHistory(asset.id)">Opnieuw proberen</button></p> }
        @else if (c.history(); as events) {
          @if (!events.length) { <p class="files-muted">Nog niets gelogd voor dit bestand.</p> }
          <ul class="files-events">
            @for (event of events; track event.id) { <li><b>{{ event.actor?.displayName || 'Systeem' }}</b> {{ event.summary }}<small>{{ event.at | dateTimeNl }}</small></li> }
          </ul>
        }
        <p class="files-muted">Verplaatsingen staan niet in de geschiedenis.</p>
      </details>

      <footer class="wk-inspector__foot">
        @if (asset.archived) {
          <button class="wk-btn" type="button" [disabled]="c.busy()" (click)="c.restore([asset])"><app-icon name="restore" [size]="15" />Terughalen</button>
          <button class="wk-btn wk-btn--danger" type="button" [disabled]="c.busy() || deleteBlocked(asset)"
                  [title]="deleteBlocked(asset) ? 'Kan pas als het bestand nergens meer gekoppeld is.' : ''" (click)="c.deletePermanent([asset])">Definitief verwijderen…</button>
        } @else {
          <button class="wk-btn files-warn" type="button" [disabled]="c.busy()" (click)="c.archive([asset])"><app-icon name="archive" [size]="15" />Archiveren</button>
        }
      </footer>
    } @else if (c.multi()) {
      <!-- ============================ desk: several items -->
      @let files = c.selectedFiles();
      <header class="wk-inspector__head">
        <h2 #heading class="wk-inspector__title" tabindex="-1">{{ c.selectionCount() }} geselecteerd</h2>
        @if (layout() === 'drawer') {
          <button class="wk-btn wk-btn--icon wk-btn--ghost" type="button" aria-label="Info sluiten" (click)="c.drawerOpen.set(false)"><app-icon name="close" [size]="17" /></button>
        }
      </header>
      <div class="files-mosaic">
        @for (file of files.slice(0, 4); track file.id) {
          @if (file.kind === 'IMAGE') { <img [appAuthSrc]="c.media.thumbnailUrl(file.id)" alt="" /> }
          @else { <span class="files-ext" [class]="toneOf(file)">{{ badge(file) }}</span> }
        }
      </div>
      <section class="wk-section">
        <p class="files-insp__big">{{ files.length }} bestand{{ files.length === 1 ? '' : 'en' }} · {{ size(c.selectionSize()) }} samen</p>
        <p class="files-muted">{{ linkedCount(files) }} gekoppeld · {{ files.length - linkedCount(files) }} niet gekoppeld</p>
        @if (c.selectedFolderNodes().length) { <p class="files-muted">en {{ c.selectedFolderNodes().length }} map{{ c.selectedFolderNodes().length === 1 ? '' : 'pen' }}</p> }
        <button class="wk-btn wk-btn--sm" type="button" (click)="c.clearAll()">Selectie wissen</button>
      </section>
    } @else if (folderCard(); as card) {
      <!-- ============================ desk: a folder -->
      <header class="wk-inspector__head">
        <h2 #heading class="wk-inspector__title" tabindex="-1">{{ card.folder.name }}</h2>
        <button class="wk-btn wk-btn--icon wk-btn--ghost" type="button" aria-label="Mapacties" (click)="c.openFolderMenu(card.folder, point($event))"><app-icon name="more" [size]="18" /></button>
        @if (layout() === 'drawer') {
          <button class="wk-btn wk-btn--icon wk-btn--ghost" type="button" aria-label="Info sluiten" (click)="c.drawerOpen.set(false)"><app-icon name="close" [size]="17" /></button>
        }
      </header>
      <div class="files-insp__folder"><span class="files-icon files-icon--folder files-icon--lg"><app-icon name="folder" [size]="34" /></span></div>
      <section class="wk-section">
        <p class="files-muted">{{ c.pathOf(card.folder.id) }}</p>
        <p class="files-insp__big">{{ card.counts }}</p>
        <div class="files-insp__row">
          @if (card.selected) { <button class="wk-btn wk-btn--primary wk-btn--sm" type="button" (click)="c.openFolder(card.folder.id)">Openen</button> }
          <button class="wk-btn wk-btn--sm" type="button" (click)="c.newFolder(card.folder.id)">Nieuwe submap</button>
          <button class="wk-btn wk-btn--sm" type="button" [disabled]="c.zipping()" (click)="c.downloadFolder(card.folder)">Map downloaden</button>
        </div>
      </section>
    } @else {
      <!-- ============================ desk: nothing chosen -->
      <header class="wk-inspector__head">
        <h2 #heading class="wk-inspector__title" tabindex="-1">{{ noneTitle() }}</h2>
        @if (layout() === 'drawer') {
          <button class="wk-btn wk-btn--icon wk-btn--ghost" type="button" aria-label="Info sluiten" (click)="c.drawerOpen.set(false)"><app-icon name="close" [size]="17" /></button>
        }
      </header>
      <section class="wk-section files-insp__none">
        @switch (c.place()) {
          @case ('folders') {
            <p>{{ c.childFolders().length }} mappen · {{ c.assets().length }}{{ c.hasMore() ? '+' : '' }} zonder map</p>
            <p class="files-muted">Bestanden komen vanzelf in de juiste map zodra je ze koppelt aan een product, kost, reeks of inkooporder.</p>
          }
          @case ('view') {
            <p>{{ c.view()?.hint }}.</p>
            @if (c.view()?.area; as area) { <a class="wk-link" [routerLink]="area.route.link" [queryParams]="area.route.query">{{ area.label }} ›</a> }
          }
          @case ('archive') {
            <p>Gearchiveerde bestanden blijven hier tot je ze terughaalt of definitief verwijdert.</p>
            <p class="files-muted">Definitief verwijderen kan alleen voor bestanden die nergens meer gekoppeld zijn.</p>
          }
          @default {
            <p>Kies een bestand om het hier te zien.</p>
            <p class="files-muted">⌘-klik of ⇧-klik om meer te kiezen · spatie om snel te bekijken</p>
          }
        }
      </section>
    }
  `,
})
export class FilesInspector {
  readonly c = inject(FilesController);
  private readonly ui = inject(Ui);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly layout = input<'pane' | 'drawer' | 'screen'>('pane');

  private readonly sanitizer = inject(DomSanitizer);
  /** The object URL of a PDF preview, and the same URL as the frame may load it. */
  private pdfObjectUrl: string | null = null;
  readonly pdfUrl = signal<SafeResourceUrl | null>(null);
  readonly pdfLoading = signal(false);
  readonly flash = signal(false);
  private pdfFor: number | null = null;

  /** The pending purchase-order link of the file in view. */
  readonly pending = computed(() => {
    const id = this.c.openFileId();
    return id === null ? null : this.c.pendingLinks().get(id) ?? null;
  });

  /** The folder card: a selected folder, or the open folder when nothing is selected. */
  readonly folderCard = computed(() => {
    const selected = this.c.selectedFolder();
    const folder = selected ?? (this.c.selectionCount() === 0 ? this.c.currentFolder() : null);
    if (!folder) return null;
    const counts = this.c.store.counts().get(folder.id);
    const text = counts
      ? `${counts.direct} bestand${counts.direct === 1 ? '' : 'en'} direct · ${counts.total} in totaal · ${counts.subfolders} submap${counts.subfolders === 1 ? '' : 'pen'}`
      : '';
    return { folder, selected: !!selected, counts: text };
  });

  readonly noneTitle = computed(() => {
    switch (this.c.place()) {
      case 'folders': return 'Mappen';
      case 'view': return this.c.view()?.label ?? 'Gekoppeld aan';
      case 'archive': return 'Archief';
      default: return 'Geen selectie';
    }
  });

  constructor() {
    /* A PDF preview belongs to one file; stepping on revokes it. */
    effect(() => {
      const id = this.c.openFileId();
      if (id !== this.pdfFor) this.revokePdf();
    });
    /*
     * A drawer opened on request (ⓘ, ⌘I, "Info") takes the focus to its
     * heading; the desk view hands it back to the row on close. After a
     * click on a row the focus stays in the list, for the arrow keys.
     */
    afterNextRender(() => {
      if (this.layout() !== 'drawer' || !this.c.takeDrawerFocus()) return;
      this.host.nativeElement.querySelector<HTMLElement>('.wk-inspector__title')?.focus({ preventScroll: true });
    });
    inject(DestroyRef).onDestroy(() => this.revokePdf());
  }

  /* ---- words and looks */
  chip(asset: MediaAssetSummary): string { return fileKindChip(asset); }
  badge(asset: MediaAssetSummary): string { return badgeText(asset); }
  toneOf(asset: MediaAssetSummary): string { return extensionToneClass(asset); }
  size(bytes: number): string { return sizeLabel(bytes); }
  label(link: MediaAssetLink): string { return linkLabel(link); }
  icon(link: MediaAssetLink): string { return targetIconName(link.targetType); }
  tone(link: MediaAssetLink): string { return targetTone(link.targetType); }
  route(link: MediaAssetLink) { return targetRoute(link); }
  sourceTo(link: MediaAssetLink) { return sourceRoute(link); }
  isSource(link: MediaAssetLink): boolean { return isSourceLink(link); }
  caption(link: MediaAssetLink): string { return isSourceLink(link) ? sourceCaption(link) : targetLabel(link.targetType); }
  shareable(asset: MediaAssetSummary): boolean { return canShare(asset); }
  linkable(asset: MediaAssetSummary): boolean { return canLink(asset); }
  replaceable(asset: MediaAssetSummary): boolean { return canReplace(asset); }
  deleteBlocked(asset: MediaAssetSummary): boolean { return deleteBlock(asset, this.c.place()) !== null; }
  isPdf(asset: MediaAssetSummary): boolean { return extensionTone(asset) === 'pdf'; }
  crumbs(asset: MediaAssetSummary) { return crumbsFor(this.c.store.folders(), asset.folderId); }
  linkedCount(files: MediaAssetSummary[]): number { return files.filter((file) => file.links.length > 0).length; }

  meta(asset: MediaAssetSummary): string {
    return [fileKindLabel(asset), sizeLabel(asset.sizeBytes), asset.widthPx && asset.heightPx ? `${asset.widthPx} × ${asset.heightPx}` : '']
      .filter(Boolean).join(' · ');
  }

  versions(asset: MediaAssetDetail) {
    return [...(asset.versions ?? [])].sort((a, b) => b.versionNumber - a.versionNumber);
  }

  inOwnFolder(asset: MediaAssetSummary): boolean {
    const location = this.c.loc();
    return location.place === 'folders' && !location.query && (asset.folderId ?? 'root') === location.folderId;
  }

  value(event: Event): string { return (event.target as HTMLInputElement).value; }
  blur(event: Event): void { (event.target as HTMLElement).blur(); }
  point(event: MouseEvent) {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: rect.left, y: rect.bottom + 4 };
  }

  escName(event: Event): void {
    event.stopPropagation();
    this.c.revertName();
    this.blur(event);
  }

  /* ---- actions */
  moreMenu(event: MouseEvent, asset: MediaAssetSummary): void {
    /* The rest has a button of its own in the inspector. */
    const items = fileActions([asset], this.c.place(), { drawer: false, phone: false, inOwnFolder: this.inOwnFolder(asset) })
      .filter((item) => ['rename', 'version', 'reveal', 'link'].includes(item.id))
      .map((item) => ({ ...item, divider: false }));
    this.c.menu.set({ title: asset.name, items, anchor: this.point(event), run: (id) => this.c.runFileAction(id, [asset]) });
  }

  /** A long press on a hand-made link: the swipe's Loskoppelen, for those who do not swipe. */
  linkMenu(asset: MediaAssetSummary, link: MediaAssetLink): void {
    this.c.menu.set({
      title: linkLabel(link),
      items: [{ id: 'unlink', label: 'Loskoppelen', iconName: 'unlink', danger: true }],
      anchor: null,
      run: () => void this.c.unlink(asset, link),
    });
  }

  downloadMenu(event: MouseEvent, asset: MediaAssetSummary): void {
    if (!hasWeb(asset)) { void this.c.download(asset); return; }
    this.c.menu.set({
      title: 'Downloaden',
      items: [
        { id: 'download', label: 'Origineel', hint: sizeLabel(asset.sizeBytes), iconName: 'download' },
        { id: 'download-web', label: 'Webformaat', hint: sizeLabel(asset.web!.sizeBytes), iconName: 'image' },
      ],
      anchor: this.point(event),
      run: (id) => this.c.runFileAction(id, [asset]),
    });
  }

  /** "Deel": the public-link section in view, and the question to make one when there is none. */
  shareSection(asset: MediaAssetSummary): void {
    this.host.nativeElement.querySelector('#files-share')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    this.flash.set(true);
    setTimeout(() => this.flash.set(false), 900);
    if (!asset.share && canShare(asset)) void this.c.share(asset);
  }

  toggleHistory(event: Event, id: number): void {
    if ((event.target as HTMLDetailsElement).open) void this.c.loadHistory(id);
  }

  /** The PDF as a typed blob in a frame: on request, so arrowing through PDFs downloads nothing. */
  async loadPdf(asset: MediaAssetSummary): Promise<void> {
    this.pdfLoading.set(true);
    try {
      const blob = await this.c.media.download(asset.id);
      if (this.c.openFileId() !== asset.id) return;
      this.revokePdf();
      this.pdfFor = asset.id;
      this.pdfObjectUrl = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
      this.pdfUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(this.pdfObjectUrl));
    } catch (failure) {
      this.ui.toast(messageOf(failure, 'Het voorbeeld kon niet worden geladen.'), 'err');
    } finally {
      this.pdfLoading.set(false);
    }
  }

  private revokePdf(): void {
    if (this.pdfObjectUrl) URL.revokeObjectURL(this.pdfObjectUrl);
    this.pdfObjectUrl = null;
    this.pdfUrl.set(null);
    this.pdfFor = null;
  }
}
