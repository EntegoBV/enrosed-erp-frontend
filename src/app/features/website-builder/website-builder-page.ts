import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  Injector,
  ViewEncapsulation,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Location, NgTemplateOutlet } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { CatalogApi } from '../../core/api/catalog-api';
import { isRevisionConflict, messageOf } from '../../core/api/errors';
import { HasUnsavedChanges } from '../../core/guards/unsaved-changes.guard';
import {
  ContentTranslationGroup,
  WebsiteBuilderHomepage,
  WebsiteBuilderSection,
  WebsiteBuilderSectionKey,
} from '../../core/api/models';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { NavHistory } from '../../core/platform/nav-history-service';
import { Icon } from '../../shared/icon';
import { IosNav } from '../../shared/ios-nav';
import { LoadError } from '../../shared/load-error';
import { SegmentOption, Segmented } from '../../shared/segmented';
import { Skeleton } from '../../shared/skeleton';
import { Sheet, Ui, confirmLeave } from '../../shared/ui';
import { ContentTranslationWorkspace } from '../settings/content-translation-workspace';
import { shortMoment } from '../settings/website-sync-copy';
import { WebsiteSyncStatus } from '../settings/website-sync-status';
import { WebsiteSyncStore } from '../settings/website-sync-store';
import { environment } from '../../../environments/environment';
import { WEBSITE_LANGUAGE_ORDER, plural } from './website-attention';
import { LayoutEdits, editedKeys, layoutEdits, layoutEditsText, normalizeSections } from './website-homepage';
import { WebsitePhoneBack } from './website-phone-back';
import { websitePreviewUrl } from './website-preview-url';
import { WebsiteStatusBar } from './website-status-bar';
import { WebsiteStore } from './website-store';
import { displayLabel } from './website-text-areas';

interface SectionDefinition {
  key: WebsiteBuilderSectionKey;
  label: string;
  description: string;
  previewAnchor: string;
  contentPrefixes: readonly string[];
  manageLabel: string;
  manageRoute: string;
  fixed?: boolean;
  /** Why moving this block changes nothing on the live site today (HOMEPAGE_SITE_GAPS). */
  siteGap?: string;
}

const SECTION_DEFINITIONS: readonly SectionDefinition[] = [
  { key: 'hero', label: 'Openingsbeeld & tekstband', description: 'Het eerste beeld, de hoofdboodschap en de tekstband eronder.',
    previewAnchor: 'hero', contentPrefixes: ['home.hero', 'home.marquee'], manageLabel: 'Alle websiteteksten', manageRoute: '/website/texts', fixed: true },
  { key: 'range', label: 'Ons assortiment', description: 'De categorieën waarmee een inkoper de collectie binnenkomt.',
    previewAnchor: 'range', contentPrefixes: ['home.catalog'], manageLabel: 'Categorieën & beelden', manageRoute: '/website/categories' },
  { key: 'order', label: 'Zo bestelt u', description: 'De drie bestelroutes van aanvraag tot levering.',
    previewAnchor: 'wholesale', contentPrefixes: ['home.order'], manageLabel: 'Alle websiteteksten', manageRoute: '/website/texts' },
  { key: 'counter', label: 'Counterdisplays', description: 'Producten die direct op de toonbank kunnen.',
    previewAnchor: 'displays', contentPrefixes: ['home.counter'], manageLabel: 'Producten & beelden', manageRoute: '/website/products' },
  { key: 'flowerbox', label: 'Glass bowls & flowerboxes', description: 'Bestsellers: houd de glazen presentaties prominent en hoog op de pagina.',
    previewAnchor: 'flowerboxes', contentPrefixes: ['home.flowerbox'], manageLabel: 'Producten & beelden', manageRoute: '/website/products' },
  { key: 'soap', label: 'Zeep- en foamrozen', description: 'Ondersteunende collectie: gift-ready zeep- en foamrozen.',
    previewAnchor: 'soap-roses', contentPrefixes: ['home.soap'], manageLabel: 'Producten & beelden', manageRoute: '/website/products' },
  { key: 'occasion', label: 'Kleine cadeaus', description: 'Compacte producten voor een klein gebaar.',
    previewAnchor: 'gifting', contentPrefixes: ['home.occasion'], manageLabel: 'Producten & beelden', manageRoute: '/website/products' },
  { key: 'retail', label: 'Geschikt voor retail', description: 'Verkoopomgevingen en toepassingen voor professionele kopers.',
    previewAnchor: 'retail-channels', contentPrefixes: ['home.retail'], manageLabel: 'Producten & beelden', manageRoute: '/website/products' },
  { key: 'faq', label: 'Veelgestelde vragen', description: 'Praktische antwoorden voor professionele klanten.',
    previewAnchor: 'trade-faq', contentPrefixes: ['home.faq'], manageLabel: 'Alle websiteteksten', manageRoute: '/website/texts',
    siteGap: 'staat op de site in de footer' },
  { key: 'catalog', label: 'Volledige collectie', description: 'De uitgebreide productcatalogus op de homepage.',
    previewAnchor: 'collection', contentPrefixes: ['home.catalog'], manageLabel: 'Categorieën & producten', manageRoute: '/website/categories' },
  { key: 'quote', label: 'Offerte aanvragen', description: 'Het vaste contactblok onderaan de pagina.',
    previewAnchor: 'contact', contentPrefixes: ['home.quote'], manageLabel: 'Alle websiteteksten', manageRoute: '/website/texts', fixed: true,
    siteGap: 'niet op de live homepage' },
];

/**
 * How the live homepage differs from this layout, read on 16 October 2026
 * (website follow-ups G1-G3). Delete this note, and the siteGap lines above,
 * once the website follows the builder again.
 */
const HOMEPAGE_SITE_GAPS = 'Live homepage, 16 okt: ‘Beurzen’ staat altijd vóór de footer en is hier niet instelbaar; '
  + 'de veelgestelde vragen staan in de footer; ‘Offerte aanvragen’ staat niet meer op de homepage.';

/** Below a 1100 px main (viewport 1348 with the 248 px side) the preview takes turns with the inspector. */
const THREE_COLUMNS = '(min-width: 1348px)';
const PREVIEW_DESK_WIDTH = 1280;
const PREVIEW_PHONE_WIDTH = 390;
const PREVIEW_HINT = 'Vraagt het voorbeeld ‘Kies uw taal’? Kies Nederlands en klik Verder.';
const LIST_URL = '/website/layout';

/**
 * Homepage of Website beheren (/website/layout): the order and visibility of
 * the homepage blocks as a list, the chosen block in an inspector with its
 * texts, and the live site as a preview. Draft and publish with revisions,
 * conflicts, ⌘S and the unsaved guard work as before; the frame is the kit.
 * Below a 1100 px main the preview and the inspector take turns
 * ("Indeling · Voorbeeld"). The phone shows the list, a block view
 * (?blok=key) and the preview in a sheet; texts are edited in Teksten.
 */
@Component({
  selector: 'app-website-builder-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrls: ['../../../styles/website-workspace.scss', '../../../styles/website-homepage.scss', '../../../styles/website-texts.scss'],
  imports: [ContentTranslationWorkspace, Icon, IosNav, LoadError, NgTemplateOutlet, RouterLink, Segmented, Sheet, Skeleton, WebsiteStatusBar, WebsiteSyncStatus],
  template: `
    <ng-template #previewFrame let-phone>
      <div class="ws-stage" #stage [class.ws-stage--mobile]="phone || previewDevice() === 'mobile'">
        @if (previewError()) {
          <div class="wk-empty ws-prev-error" role="alert">
            <h3 class="wk-empty__title">Het voorbeeld reageert niet</h3>
            <p class="wk-empty__text">{{ previewError() }}</p>
            <div class="wk-empty__actions">
              <button class="wk-btn" type="button" (click)="refreshPreview()"><app-icon name="refresh" [size]="15" />Opnieuw laden</button>
              <a class="wk-btn" [href]="previewBaseUrl" target="_blank" rel="noopener">{{ previewSiteLabel }} openen <app-icon name="external" [size]="13" /></a>
            </div>
          </div>
        } @else {
          @if (!previewLoaded()) { <div class="ws-prev-loading" role="status" aria-label="Voorbeeld laden"><span></span><span></span><span></span></div> }
          <div class="ws-site" [style.height.px]="phone ? null : frameHeight()">
            <iframe [src]="previewUrl()" [title]="'Voorbeeld van de ' + previewSiteName" referrerpolicy="strict-origin-when-cross-origin"
                    [style.width.px]="phone ? null : frameWidth()" [style.height.px]="phone ? null : frameInnerHeight()"
                    [style.transform]="phone ? null : 'scale(' + frameScale() + ')'"
                    (load)="markPreviewLoaded()" (error)="markPreviewFailed()"></iframe>
          </div>
        }
      </div>
      <p class="ws-prev-hint">{{ previewHint }}</p>
    </ng-template>

    @if (desk.active()) {
      <div class="wk-page ws-page ws-hp-page">
        <header class="wk-toolbar">
          <div class="wk-toolbar__lead">
            <h1 class="wk-toolbar__title">Homepage</h1>
            @if (!threeColumns()) {
              <app-segmented label="Rechterkolom" semantics="tabs" [options]="viewOptions" [value]="rightView()" (changed)="setRightView($any($event))" />
            } @else if (snapshot()) {
              <span class="ws-sub">{{ visibleCount() }} van {{ sections().length }} blokken zichtbaar</span>
            }
          </div>
          <div class="wk-toolbar__tools">
            @if (snapshot()) {
              <span class="ws-state" [class]="'ws-state tone-' + state().tone" [attr.title]="state().detail">
                <i aria-hidden="true"></i><span class="ws-long">{{ state().label }}</span><span class="ws-short">{{ state().short }}</span>
              </span>
            }
            @if (dirty()) {
              <button class="wk-btn wk-btn--ghost" type="button" [disabled]="busy()" (click)="revertLayout()">Herstellen</button>
              <button class="wk-btn" type="button" [disabled]="busy() || copyDirty()" [attr.title]="copyDirty() ? 'Sla eerst de tekst op' : null" (click)="saveDraft()">
                <span class="ws-long">Concept opslaan</span><span class="ws-short">Opslaan</span><span class="wk-kbd" aria-hidden="true">⌘S</span>
              </button>
            }
            @if (dirty() || hasUnpublishedChanges()) {
              <button class="wk-btn wk-btn--primary" type="button" [disabled]="busy() || copyDirty()"
                      [attr.title]="copyDirty() ? 'Sla eerst de tekst op' : null" (click)="publish()">
                <app-icon name="upload" [size]="15" />{{ publishing() ? 'Publiceren…' : (dirty() ? 'Opslaan & publiceren' : 'Publiceren') }}
              </button>
            }
          </div>
        </header>

        <div class="wk-notices">
          <ng-container *ngTemplateOutlet="problems; context: { $implicit: false }" />
        </div>

        <div class="wk-body">
          @if (loadError() && !snapshot()) {
            <div class="wk-pane"><app-load-error title="Website-indeling kon niet worden geladen" [message]="loadError()" [busy]="loading()" (retry)="load()" /></div>
          } @else {
            <div class="ws-hp" [class.ws-hp--three]="threeColumns()" [class.ws-hp--preview]="!threeColumns() && rightView() === 'preview'">
              <section class="ws-hp__list" aria-labelledby="ws-blocks-title">
                <h2 class="ws-blk-head" id="ws-blocks-title">Volgorde op de homepage @if (snapshot()) {<span>{{ visibleCount() }} van {{ sections().length }} zichtbaar</span>}</h2>
                @if (!snapshot()) {
                  <div class="ws-hp__pad"><app-skeleton kind="lines" [rows]="8" /></div>
                } @else {
                  <div class="ws-blocks" role="list" aria-labelledby="ws-blocks-title" (keydown)="listKey($event)" (keyup)="listKeyUp($event)">
                    @for (section of sections(); track section.key; let index = $index) {
                      <div class="ws-blk" role="listitem" [class.is-sel]="selectedSectionIndex() === index" [class.is-hidden]="!section.enabled"
                           [class.is-moved]="flash() === section.key">
                        <button class="ws-blk__main" type="button" [attr.tabindex]="selectedSectionIndex() === index ? 0 : -1"
                                [attr.aria-current]="selectedSectionIndex() === index ? 'true' : null" [attr.data-index]="index" [attr.data-key]="section.key" (click)="selectSection(index)">
                          <span class="ws-blk__no">{{ positionLabel(index) }}</span>
                          <span class="ws-blk__body">
                            <span class="ws-blk__name">{{ definition(section.key).label }}</span>
                            @if (definition(section.key).siteGap; as gap) { <span class="ws-blk__gap">{{ gap }}</span> }
                            @if (pillOf(section); as pill) { <span class="ws-blk__meta">{{ pill }}</span> }
                          </span>
                          @if (changedKeys().has(section.key)) { <i class="ws-blk__changed" aria-label="gewijzigd"></i> }
                          @if (pillOf(section); as pill) { <span class="wk-pill wk-pill--outline ws-blk__pill mo-fade">{{ pill }}</span> }
                        </button>
                        @if (!definition(section.key).fixed) {
                          <button class="ws-eye" type="button" tabindex="-1" [class.is-off]="!section.enabled" [attr.aria-pressed]="section.enabled"
                                  [attr.aria-label]="definition(section.key).label + (section.enabled ? ' verbergen' : ' tonen')"
                                  [attr.title]="section.enabled ? 'Verbergen' : 'Tonen'" [disabled]="busy()" (click)="toggle(index)">
                            <app-icon name="eye" [size]="16" />
                          </button>
                        } @else { <span class="ws-eye ws-eye--fixed" aria-hidden="true"></span> }
                      </div>
                    }
                  </div>
                  <p class="sr-only" aria-live="polite">{{ reorderAnnouncement() }}</p>
                  <p class="ws-note">{{ siteGaps }}</p>
                }
              </section>

              <section class="ws-hp__insp" aria-label="Gekozen blok">
                @if (selectedSection(); as section) {
                  <ng-container *ngTemplateOutlet="inspector; context: { $implicit: section }" />
                } @else {
                  <div class="ws-hp__pad"><app-skeleton kind="lines" [rows]="6" /></div>
                }
              </section>

              <aside class="ws-hp__prev" aria-label="Voorbeeld">
                <div class="ws-prev-head">
                  <b>Voorbeeld</b>
                  <app-segmented label="Toestel" [options]="deviceOptions" [value]="previewDevice()" (changed)="previewDevice.set($any($event))" />
                  <button class="wk-btn wk-btn--icon wk-btn--ghost" type="button" aria-label="Voorbeeld verversen" title="Voorbeeld verversen" (click)="refreshPreview()"><app-icon name="refresh" [size]="16" /></button>
                  <a class="wk-btn wk-btn--icon wk-btn--ghost" [href]="previewBaseUrl" target="_blank" rel="noopener" aria-label="Website openen in een nieuw venster" title="Website openen in een nieuw venster"><app-icon name="external" [size]="15" /></a>
                </div>
                @if (previewNote(); as note) { <p class="ws-prev-note" role="status">{{ note }}
                  @if (sync.pollEnded()) { <button class="wk-link" type="button" (click)="sync.load()">Status vernieuwen</button> · <button class="wk-link" type="button" (click)="refreshPreview()">Voorbeeld verversen</button> }
                </p> }
                @if (previewVisible()) { <ng-container *ngTemplateOutlet="previewFrame; context: { $implicit: false }" /> }
              </aside>
            </div>
          }
        </div>
        <app-website-status-bar [text]="statusText()" hint="↑↓ kiezen · ⌥↑↓ verplaatsen · spatie tonen/verbergen" />
      </div>
    } @else {
      <div class="ios-page ws-ios ws-hp-ios">
        @if (blockKey(); as key) {
          @if (sectionByKey(key); as section) {
            <app-ios-nav [title]="'Blok ' + positionLabel(indexOf(section.key))" [largeTitle]="false" backLabel="Homepage" backAriaLabel="Terug naar Homepage" (back)="closeBlock()">
              <button trail class="ios-capsule" type="button" (click)="openPreview()">Voorbeeld</button>
            </app-ios-nav>
            <div class="ws-ph-view" [class]="'ws-ph-view ' + viewMotion()">
              <ng-container *ngTemplateOutlet="problems; context: { $implicit: true }" />
              <div class="ws-ph-blockhead">
                <small>Blok {{ positionLabel(indexOf(section.key)) }} van {{ sections().length }}@if (movedFrom(section.key); as was) { · was {{ was }} }</small>
                <h1>{{ definition(section.key).label }}</h1>
                <p>{{ definition(section.key).description }}</p>
              </div>
              <section class="ios-section">
                <div class="ios-group">
                  <label class="ios-cell">
                    <span class="ios-cell__body"><span class="ios-cell__title">Zichtbaar op de homepage</span></span>
                    @if (definition(section.key).fixed) { <span class="ios-cell__value">Vast</span> }
                    @else { <input class="ios-switch" type="checkbox" role="switch" [checked]="section.enabled" [disabled]="busy()" (change)="toggle(indexOf(section.key))" /> }
                  </label>
                  <div class="ios-cell">
                    <span class="ios-cell__body"><span class="ios-cell__title">Positie</span>
                      <span class="ios-cell__sub">{{ indexOf(section.key) + 1 }} van {{ sections().length }}@if (movedFrom(section.key); as was) { · was {{ +was }} }</span></span>
                    @if (!definition(section.key).fixed) {
                      <span class="ws-ph-arrows">
                        <button class="ios-circle" type="button" [attr.aria-label]="'Verplaats ' + definition(section.key).label + ' omhoog'" [disabled]="busy() || !canMoveUp(indexOf(section.key))" (click)="move(indexOf(section.key), -1)"><app-icon name="chevron-up" [size]="18" /></button>
                        <button class="ios-circle" type="button" [attr.aria-label]="'Verplaats ' + definition(section.key).label + ' omlaag'" [disabled]="busy() || !canMoveDown(indexOf(section.key))" (click)="move(indexOf(section.key), 1)"><app-icon name="chevron-down" [size]="18" /></button>
                      </span>
                    }
                  </div>
                </div>
              </section>
              <section class="ios-section">
                <div class="ios-section__head"><h2>Teksten @if (store.content()) { · {{ blockGroups(section.key).length }} · {{ blockMissing(section.key) ? plural(blockMissing(section.key), 'ontbreekt', 'ontbreken') : 'alle talen ✓' }} }</h2></div>
                @if (!store.content()) {
                  @if (store.errors().content) {
                    <app-load-error title="Teksten konden niet worden geladen" [message]="store.errors().content!" [busy]="store.isLoading('content')" (retry)="store.refresh(['content'])" />
                  } @else {
                    <app-skeleton kind="group" [rows]="3" />
                  }
                } @else {
                <div class="ios-group">
                  @for (group of blockGroups(section.key).slice(0, showAllTexts() ? 999 : 6); track group.key) {
                    <a class="ios-cell" routerLink="/website/texts" [queryParams]="{ key: group.key, returnTo: '/website/layout?blok=' + section.key }">
                      <span class="ios-cell__body"><span class="ios-cell__title ios-cell__title--2">{{ labelOf(group) }}</span><span class="ios-cell__sub" [attr.title]="dutchOf(group)">{{ dutchOf(group) }}</span></span>
                      <span class="ios-cell__value" [class.ws-warn-text]="group.missingLanguages.length">{{ group.missingLanguages.length ? group.missingLanguages.length + ' leeg' : languageCount + '/' + languageCount }}</span>
                      <app-icon class="ios-cell__chev" name="chevron-right" [size]="18" />
                    </a>
                  } @empty {
                    <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__sub">Geen teksten voor dit blok.</span></span></div>
                  }
                  @if (!showAllTexts() && blockGroups(section.key).length > 6) {
                    <button class="ios-cell ws-more-cell" type="button" (click)="showAllTexts.set(true)">Alle {{ blockGroups(section.key).length }} tonen</button>
                  }
                </div>
                }
                @if (sharedWith(section.key); as other) { <p class="ios-section__foot">Deze teksten deelt dit blok met ‘{{ other }}’.</p> }
              </section>
              <section class="ios-section">
                <div class="ios-group">
                  <a class="ios-cell" [routerLink]="definition(section.key).manageRoute"><span class="ios-cell__body">{{ definition(section.key).manageLabel }}</span><app-icon class="ios-cell__chev" name="chevron-right" [size]="18" /></a>
                </div>
              </section>
            </div>
          } @else {
            <app-ios-nav title="Blok" [largeTitle]="false" backLabel="Homepage" backAriaLabel="Terug naar Homepage" (back)="closeBlock()" />
            <div class="ws-ph-view">
              @if (loadError() && !snapshot()) {
                <app-load-error title="Website-indeling kon niet worden geladen" [message]="loadError()" [busy]="loading()" (retry)="load()" />
              } @else {
                <app-skeleton kind="group" [rows]="6" />
              }
            </div>
          }
        } @else {
          <app-ios-nav title="Homepage" [subtitle]="snapshot() ? visibleCount() + ' van ' + sections().length + ' blokken zichtbaar' : null"
                       [backLabel]="back.label()" [backUrl]="back.url()" [backAriaLabel]="back.aria()">
            <button trail class="ios-capsule" type="button" (click)="openPreview()">Voorbeeld</button>
          </app-ios-nav>
          <div class="ws-ph-view" [class]="'ws-ph-view ' + viewMotion()">
            <app-website-sync-status variant="banner" />
            <ng-container *ngTemplateOutlet="problems; context: { $implicit: true }" />
            @if (loadError() && !snapshot()) {
              <app-load-error title="Website-indeling kon niet worden geladen" [message]="loadError()" [busy]="loading()" (retry)="load()" />
            } @else if (!snapshot()) {
              <app-skeleton kind="group" [rows]="8" />
            } @else {
              <section class="ios-section">
                <div class="ios-section__head"><h2>Volgorde op de homepage</h2>
                  <button class="ios-section__link" type="button" (click)="reordering.set(!reordering())">{{ reordering() ? 'Klaar' : 'Volgorde wijzigen' }}</button></div>
                <div class="ios-group ios-group--icons">
                  @for (section of sections(); track section.key; let index = $index) {
                    @if (reordering()) {
                      <div class="ios-cell" [class.is-moved]="flash() === section.key">
                        <span class="ws-numtile" [class.is-off]="!section.enabled">{{ positionLabel(index) }}</span>
                        <span class="ios-cell__body"><span class="ios-cell__title ios-cell__title--2">{{ definition(section.key).label }}</span>
                          <span class="ios-cell__sub ios-cell__sub--wrap" [class.ws-warn-text]="movedFrom(section.key)">{{ phoneSub(section) }}</span></span>
                        @if (!definition(section.key).fixed) {
                          <span class="ws-ph-arrows">
                            <button class="ws-arrow" type="button" [attr.aria-label]="'Verplaats ' + definition(section.key).label + ' omhoog'" [disabled]="busy() || !canMoveUp(index)" (click)="move(index, -1)"><app-icon name="chevron-up" [size]="18" /></button>
                            <button class="ws-arrow" type="button" [attr.aria-label]="'Verplaats ' + definition(section.key).label + ' omlaag'" [disabled]="busy() || !canMoveDown(index)" (click)="move(index, 1)"><app-icon name="chevron-down" [size]="18" /></button>
                          </span>
                        }
                      </div>
                    } @else {
                      <button class="ios-cell" type="button" (click)="openBlock(section.key)">
                        <span class="ws-numtile" [class.is-off]="!section.enabled">{{ positionLabel(index) }}</span>
                        <span class="ios-cell__body"><span class="ios-cell__title ios-cell__title--2">{{ definition(section.key).label }}</span>
                          <span class="ios-cell__sub ios-cell__sub--wrap" [class.ws-warn-text]="movedFrom(section.key)">{{ phoneSub(section) }}</span></span>
                        <app-icon class="ios-cell__chev" name="chevron-right" [size]="18" />
                      </button>
                    }
                  }
                </div>
                <p class="ios-section__foot">{{ siteGaps }}</p>
              </section>
            }
          </div>
        }
        @if (dirty() || hasUnpublishedChanges()) {
          <div class="ws-savebar" [class.is-dirty]="dirty()" role="region" aria-label="Opslaan en publiceren">
            <span class="ws-savebar__text"><b>{{ dirty() ? 'Niet opgeslagen' : 'Concept' }}</b>
              <small>{{ dirty() ? changedText() : 'niet gepubliceerd' }}</small></span>
            @if (dirty()) {
              <button class="ios-capsule ios-capsule--sm ws-savebar__revert" type="button" [disabled]="busy()" (click)="revertLayout()">Herstellen</button>
              <button class="ios-capsule ios-capsule--sm" type="button" [disabled]="busy()" (click)="saveDraft()">Opslaan</button>
            }
            <button class="ios-capsule ios-capsule--sm ios-capsule--accent" type="button" [disabled]="busy()" (click)="publish()">{{ publishing() ? 'Publiceren…' : 'Publiceren' }}</button>
          </div>
        }
      </div>
      @if (previewSheet()) {
        <app-sheet title="Voorbeeld" variant="ios" (closed)="closePreview()">
          <div body class="ws-prev-sheet">
            <div class="ws-prev-sheet__tools"><button class="ios-capsule ios-capsule--sm" type="button" (click)="refreshPreview()"><app-icon name="refresh" [size]="15" /> Verversen</button></div>
            @if (previewNote(); as note) { <p class="ws-prev-note ws-prev-note--ios">{{ note }}</p> }
            <ng-container *ngTemplateOutlet="previewFrame; context: { $implicit: true }" />
          </div>
        </app-sheet>
      }
    }

    <ng-template #problems let-phone>
      @if (conflict()) {
        <div [class]="phone ? 'ios-banner ios-banner--danger' : 'wk-banner wk-banner--danger'" role="alert">
          @if (!phone) { <app-icon name="alert" [size]="16" /> }
          <span [class.wk-banner__text]="!phone"><b>Iemand anders heeft de website-indeling aangepast</b> · {{ actionError() }}</span>
          <span [class.wk-banner__actions]="!phone"><button [class]="phone ? 'ios-capsule ios-capsule--sm ios-capsule--tinted' : 'wk-btn wk-btn--sm'" type="button" [disabled]="busy()" (click)="reloadLatest()">Nieuwste versie laden</button></span>
        </div>
      } @else if (actionError()) {
        <div [class]="phone ? 'ios-banner ios-banner--danger' : 'wk-banner wk-banner--danger'" role="alert">
          @if (!phone) { <app-icon name="alert" [size]="16" /> }
          <span [class.wk-banner__text]="!phone"><b>{{ lastAction() === 'publish' ? 'Publiceren mislukt' : 'Opslaan mislukt' }}</b> · {{ actionError() }}</span>
          <span [class.wk-banner__actions]="!phone">
            <button [class]="phone ? 'ios-capsule ios-capsule--sm' : 'wk-btn wk-btn--sm'" type="button" [disabled]="busy()" (click)="reloadLatest()">Laatste versie laden</button>
            @if (lastAction() === 'publish') {
              <button [class]="phone ? 'ios-capsule ios-capsule--sm ios-capsule--tinted' : 'wk-btn wk-btn--sm wk-btn--primary'" type="button" [disabled]="busy()" (click)="publish()">Opnieuw publiceren</button>
            } @else {
              <button [class]="phone ? 'ios-capsule ios-capsule--sm ios-capsule--tinted' : 'wk-btn wk-btn--sm wk-btn--primary'" type="button" [disabled]="busy() || !dirty()" (click)="saveDraft()">Opnieuw opslaan</button>
            }
          </span>
        </div>
      }
    </ng-template>

    <ng-template #inspector let-section>
      @for (key of [section.key]; track key) {
        <div class="ws-hpi">
          <div class="ws-hpi__head">
            <span class="ws-hpi__eyebrow" [class.is-moved]="flash() === section.key">Blok {{ positionLabel(selectedSectionIndex()) }} van {{ sections().length }}@if (movedFrom(section.key); as was) { · was {{ was }} }</span>
            <h2 class="ws-hpi__title">{{ definition(section.key).label }}</h2>
            <p class="ws-hpi__desc">{{ definition(section.key).description }}</p>
          </div>
          <div class="ws-controls">
            @if (definition(section.key).fixed) {
              <p class="ws-fixed">Vast blok: altijd zichtbaar, altijd op deze plaats.</p>
            } @else {
              <label class="ws-hp-switch">
                <span><b>Zichtbaar op de homepage</b></span>
                <input class="ws-switch" type="checkbox" role="switch" [checked]="section.enabled" [disabled]="busy()" (change)="toggle(selectedSectionIndex())" />
              </label>
              <button class="wk-btn" type="button" [attr.aria-label]="'Verplaats ' + definition(section.key).label + ' omhoog'"
                      [disabled]="busy() || !canMoveUp(selectedSectionIndex())" (click)="move(selectedSectionIndex(), -1)"><app-icon name="chevron-up" [size]="15" />Hoger</button>
              <button class="wk-btn" type="button" [attr.aria-label]="'Verplaats ' + definition(section.key).label + ' omlaag'"
                      [disabled]="busy() || !canMoveDown(selectedSectionIndex())" (click)="move(selectedSectionIndex(), 1)"><app-icon name="chevron-down" [size]="15" />Lager</button>
            }
            <a class="wk-link ws-manage" [routerLink]="definition(section.key).manageRoute">{{ definition(section.key).manageLabel }} ›</a>
          </div>

          <section class="ws-panel" aria-labelledby="ws-texts-title">
            <header class="ws-panel__head">
              <span id="ws-texts-title">Teksten</span>
              @if (store.content()) {
                <small [class.ws-warn-text]="blockMissing(section.key) > 0">{{ blockGroups(section.key).length }} groepen ·
                  {{ blockMissing(section.key) ? plural(blockMissing(section.key), 'ontbreekt', 'ontbreken') : languageCount + ' talen compleet' }}</small>
              }
              <span class="ws-tools">
                @if (editorOpen()) {
                  <button class="wk-btn wk-btn--sm wk-btn--ghost" type="button" (click)="closeEditor()">Sluiten</button>
                } @else if (blockGroups(section.key).length) {
                  <button class="wk-btn wk-btn--sm" type="button" (click)="openEditor(null)">Teksten bewerken</button>
                }
                <a class="wk-link" routerLink="/website/texts" [queryParams]="{ key: blockGroups(section.key)[0]?.key ?? null }">Alle teksten ›</a>
              </span>
            </header>
            @if (sharedWith(section.key); as other) { <p class="ws-panel__note">Deze teksten deelt dit blok met ‘{{ other }}’.</p> }
            @if (editorOpen()) {
              <div class="ws-panel__editor">
                <app-content-translation-workspace layout="inline" [visible]="true" initialScope="WEBSITE" [lockScope]="true" [allowAdvanced]="false"
                  [keyPrefixes]="definition(section.key).contentPrefixes" [initialKey]="editorKey()"
                  (dirtyChange)="copyDirty.set($event)" (busyChange)="copyBusy.set($event)" (contentSaved)="onCopySaved()" />
              </div>
            } @else if (!store.content() && store.errors().content) {
              <app-load-error title="Teksten konden niet worden geladen" [message]="store.errors().content!" [busy]="store.isLoading('content')" (retry)="store.refresh(['content'])" />
            } @else if (!store.content()) {
              <div class="ws-hp__pad"><app-skeleton kind="lines" [rows]="4" /></div>
            } @else {
              <div class="ws-panel__list">
                @for (group of blockGroups(section.key); track group.key) {
                  <button class="ws-grp ws-grp--two" type="button" [attr.title]="labelOf(group) + ' · ' + group.key" (click)="openEditor(group.key)">
                    <span class="ws-grp__body"><span class="ws-grp__label">{{ labelOf(group) }}</span><small [attr.title]="dutchOf(group)">{{ dutchOf(group) }}</small></span>
                    @if (group.missingLanguages.length) { <small class="ws-grp__miss">{{ group.missingLanguages.length }}</small> }
                    @else { <em>{{ languageCount }}/{{ languageCount }}</em> }
                  </button>
                } @empty { <p class="ws-panel__note">Geen teksten voor dit blok.</p> }
              </div>
            }
          </section>
        </div>
      }
    </ng-template>
  `,
})
export class WebsiteBuilderPage implements HasUnsavedChanges {
  private readonly catalog = inject(CatalogApi);
  private readonly ui = inject(Ui);
  private readonly injector = inject(Injector);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly desk = inject(DesktopViewport);
  readonly store = inject(WebsiteStore);
  readonly sync = inject(WebsiteSyncStore);
  readonly back = inject(WebsitePhoneBack);
  private readonly nav = inject(NavHistory);
  private readonly location = inject(Location);
  private readonly stageRef = viewChild<ElementRef<HTMLElement>>('stage');

  readonly previewBaseUrl = environment.websitePreviewUrl;
  readonly previewSiteLabel = environment.environmentLabel === 'TEST' ? 'Testsite'
    : environment.environmentLabel === 'LOCAL' ? 'Lokale website' : 'Website';
  readonly previewSiteName = this.previewSiteLabel.toLocaleLowerCase('nl-BE');
  readonly previewHint = PREVIEW_HINT;
  readonly siteGaps = HOMEPAGE_SITE_GAPS;
  readonly languageCount = WEBSITE_LANGUAGE_ORDER.length;
  readonly plural = plural;
  readonly viewOptions: SegmentOption[] = [{ id: 'layout', label: 'Indeling' }, { id: 'preview', label: 'Voorbeeld' }];
  readonly deviceOptions: SegmentOption[] = [{ id: 'desktop', label: 'Desktop' }, { id: 'mobile', label: 'Mobiel' }];

  readonly snapshot = signal<WebsiteBuilderHomepage | null>(null);
  readonly sections = signal<WebsiteBuilderSection[]>([]);
  private readonly baseline = signal('');
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly publishing = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly actionError = signal<string | null>(null);
  readonly conflict = signal(false);
  readonly lastAction = signal<'save' | 'publish' | null>(null);
  readonly previewDevice = signal<'desktop' | 'mobile'>('desktop');
  readonly rightView = signal<'layout' | 'preview'>('layout');
  readonly selectedSectionIndex = signal(0);
  readonly editorOpen = signal(false);
  readonly editorKey = signal<string | null>(null);
  readonly copyDirty = signal(false);
  readonly copyBusy = signal(false);
  readonly reorderAnnouncement = signal('');
  readonly previewNonce = signal(0);
  readonly previewAnchor = signal('hero');
  readonly previewLoaded = signal(false);
  readonly previewError = signal<string | null>(null);
  readonly previewSheet = signal(false);
  readonly reordering = signal(false);
  readonly showAllTexts = signal(false);
  /** The blocks he moved, showed or hid since the saved concept: only they count and get marked. */
  private readonly acted = signal<ReadonlySet<WebsiteBuilderSectionKey>>(new Set());
  /** The block that just moved: its row and the eyebrow flash once (ws-moved). */
  readonly flash = signal<string | null>(null);
  readonly viewMotion = signal('');
  /** The live revision before this page published; the preview reloads once the site is live on a newer one. */
  private readonly publishedFrom = signal<string | null | undefined>(undefined);
  private previewWatch: ReturnType<typeof setTimeout> | null = null;
  private flashTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly threeColumnQuery = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(THREE_COLUMNS) : null;
  readonly threeColumns = signal(this.threeColumnQuery?.matches ?? true);
  private readonly stageWidth = signal(0);
  private readonly blockParam = toSignal(this.route.queryParamMap.pipe(map((params) => params.get('blok'))), { initialValue: this.route.snapshot.queryParamMap.get('blok') });

  readonly busy = computed(() => this.loading() || this.saving() || this.publishing() || this.copyBusy());
  readonly dirty = computed(() => this.baseline() !== JSON.stringify(this.sections()));
  readonly selectedSection = computed(() => this.sections()[this.selectedSectionIndex()] ?? null);
  readonly visibleCount = computed(() => this.sections().filter((section) => section.enabled).length);
  readonly hasUnpublishedChanges = computed(() => {
    const snapshot = this.snapshot();
    return !!snapshot && JSON.stringify(normalizeSections(snapshot.published.sections)) !== JSON.stringify(this.sections());
  });
  private readonly savedSections = computed(() => this.baseline() ? JSON.parse(this.baseline()) as WebsiteBuilderSection[] : []);
  /** What he changed since the saved concept, counting only the blocks he acted on (website-homepage.ts). */
  readonly edits = computed<LayoutEdits>(() => layoutEdits(this.savedSections(), this.sections(), this.acted()));
  /** The rows that get the change dot. */
  readonly changedKeys = computed(() => editedKeys(this.edits()));
  readonly changedText = computed(() => layoutEditsText(this.edits()));
  readonly state = computed(() => {
    if (this.copyDirty()) return { tone: 'warn', label: 'Tekst niet opgeslagen', short: 'Niet opgeslagen', detail: 'Sla de tekst eerst op in de editor.' };
    if (this.dirty()) return { tone: 'warn', label: `Niet opgeslagen · ${this.changedText()}`, short: 'Niet opgeslagen', detail: 'Sla het concept op of publiceer meteen.' };
    if (this.hasUnpublishedChanges()) return { tone: 'warn', label: 'Concept · niet gepubliceerd', short: 'Concept', detail: 'Publiceer wanneer de volgorde klaar is.' };
    return { tone: 'ok', label: 'Gelijk aan live', short: 'Gelijk aan live', detail: 'Concept en gepubliceerde indeling zijn gelijk.' };
  });
  readonly statusText = computed(() => {
    const snapshot = this.snapshot();
    if (!snapshot) return '';
    const changed = snapshot.updatedAt ? shortMoment(snapshot.updatedAt) : null;
    const live = snapshot.publishedAt ? `gepubliceerd ${shortMoment(snapshot.publishedAt)}` : 'standaardindeling, nooit aangepast';
    return this.threeColumns()
      ? `${changed ? 'Concept gewijzigd ' + changed : 'Concept nooit gewijzigd'} · live: ${live}`
      : `Concept ${changed ?? 'nooit gewijzigd'} · live: ${snapshot.publishedAt ? shortMoment(snapshot.publishedAt) : 'standaardindeling'}`;
  });
  readonly blockKey = computed(() => {
    const key = this.blockParam();
    return key && SECTION_DEFINITIONS.some((section) => section.key === key) ? key as WebsiteBuilderSectionKey : null;
  });
  /** The preview runs only where it can be seen (critique B6.4). */
  readonly previewVisible = computed(() => this.desk.active()
    ? this.threeColumns() || this.rightView() === 'preview'
    : this.previewSheet());
  readonly previewUrl = computed<SafeResourceUrl>(() => this.sanitizer.bypassSecurityTrustResourceUrl(
    websitePreviewUrl(this.previewBaseUrl, 'nl', this.previewNonce(), this.previewAnchor())));
  readonly frameWidth = computed(() => this.previewDevice() === 'mobile' ? PREVIEW_PHONE_WIDTH : PREVIEW_DESK_WIDTH);
  readonly frameScale = computed(() => {
    const width = this.stageWidth();
    if (this.previewDevice() === 'mobile' || !width) return 1;
    return Math.min(1, width / PREVIEW_DESK_WIDTH);
  });
  readonly frameInnerHeight = computed(() => Math.round(this.frameHeight() / this.frameScale()));
  readonly frameHeight = computed(() => this.previewDevice() === 'mobile' ? 760 : Math.max(420, Math.round(this.stageWidth() * 1.35)));
  readonly previewNote = computed(() => {
    const status = this.sync.status();
    if (this.publishedFrom() !== undefined && status?.status === 'TRIGGERED') {
      return this.sync.pollEnded() ? 'Controle gestopt.' : 'Publicatie geaccepteerd; het voorbeeld ververst zodra de website live is.';
    }
    const selected = this.selectedSection();
    const snapshot = this.snapshot();
    if (selected && snapshot && !snapshot.published.sections.find((section) => section.key === selected.key)?.enabled) {
      return `‘${this.definition(selected.key).label}’ staat niet zichtbaar op de live homepage.`;
    }
    if (this.hasUnpublishedChanges() || this.dirty()) return 'Nog niet gepubliceerd: het voorbeeld toont wat nu live staat. Het springt naar het gekozen blok.';
    return null;
  });

  constructor() {
    this.destroyRef.onDestroy(() => { this.clearPreviewWatch(); if (this.flashTimer) clearTimeout(this.flashTimer); });
    const onMedia = (event: MediaQueryListEvent) => this.threeColumns.set(event.matches);
    this.threeColumnQuery?.addEventListener('change', onMedia);
    this.destroyRef.onDestroy(() => this.threeColumnQuery?.removeEventListener('change', onMedia));
    void this.store.ensure(['content']);
    void this.load();
    /* The preview's stage width, for the scaled 1280 px desktop frame. */
    effect((onCleanup) => {
      const stage = this.stageRef()?.nativeElement;
      if (!stage || typeof ResizeObserver === 'undefined') return;
      this.stageWidth.set(stage.clientWidth - 28);
      const observer = new ResizeObserver(() => this.stageWidth.set(stage.clientWidth - 28));
      observer.observe(stage);
      onCleanup(() => observer.disconnect());
    });
    /*
     * The 15 s watch runs only while the preview can be seen (critique B6.4).
     * Hidden, the frame is gone: the watch stops and the next show starts a
     * fresh load with its own loading state and watch.
     */
    let shown = false;
    effect(() => {
      const visible = this.previewVisible() && !!this.snapshot();
      untracked(() => {
        if (visible && !shown && !this.previewLoaded() && this.previewWatch === null) this.startPreviewWatch();
        if (!visible && shown) {
          this.clearPreviewWatch();
          this.previewLoaded.set(false);
          this.previewError.set(null);
        }
        shown = visible;
      });
    });
    /* After a publish: reload the preview once the site is live on a newer revision (N8). */
    effect(() => {
      const status = this.sync.status();
      const from = this.publishedFrom();
      if (from === undefined || status?.status !== 'LIVE' || status.liveRevision === from) return;
      untracked(() => {
        this.publishedFrom.set(undefined);
        this.refreshPreview();
        this.ui.toast('De website is bijgewerkt · voorbeeld ververst');
      });
    });
    /* The phone's block view follows ?blok= (back and forward work). */
    let previous: string | null = this.blockKey();
    effect(() => {
      const key = this.blockKey();
      untracked(() => {
        if (key === previous) return;
        this.viewMotion.set(key ? 'mo-push-view' : 'mo-pop-view');
        previous = key;
        this.showAllTexts.set(false);
        if (key) {
          const index = this.sections().findIndex((section) => section.key === key);
          if (index >= 0) this.selectedSectionIndex.set(index);
        }
      });
    });
  }

  definition(key: WebsiteBuilderSectionKey): SectionDefinition {
    return SECTION_DEFINITIONS.find((section) => section.key === key)!;
  }

  positionLabel(index: number): string {
    return String(index + 1).padStart(2, '0');
  }

  indexOf(key: WebsiteBuilderSectionKey): number {
    return this.sections().findIndex((section) => section.key === key);
  }

  sectionByKey(key: WebsiteBuilderSectionKey): WebsiteBuilderSection | null {
    return this.sections().find((section) => section.key === key) ?? null;
  }

  /** "05" when he moved the block and it stood elsewhere in the saved concept. */
  movedFrom(key: WebsiteBuilderSectionKey): string | null {
    if (!this.edits().moved.includes(key)) return null;
    const before = this.savedSections().findIndex((section) => section.key === key);
    return before >= 0 ? this.positionLabel(before) : null;
  }

  pillOf(section: WebsiteBuilderSection): string | null {
    if (this.definition(section.key).fixed) return 'Vast';
    return section.enabled ? null : 'Verborgen';
  }

  /** "Zichtbaar", "Verplaatst · was 05"; with the site gap of N26 on the row it concerns. */
  phoneSub(section: WebsiteBuilderSection): string {
    const was = this.movedFrom(section.key);
    const state = was ? `Verplaatst · was ${was}` : this.definition(section.key).fixed ? 'Vast' : section.enabled ? 'Zichtbaar' : 'Verborgen';
    const gap = this.definition(section.key).siteGap;
    return gap ? `${state} · ${gap}` : state;
  }

  /** The block's text groups from the shared store: no request per block (critique B5). */
  blockGroups(key: WebsiteBuilderSectionKey): ContentTranslationGroup[] {
    const roots = this.definition(key).contentPrefixes.map((root) => root.toLowerCase());
    return this.store.groups().filter((group) => {
      const groupKey = group.key.toLowerCase();
      return roots.some((root) => groupKey === root || groupKey.startsWith(`${root}.`));
    });
  }

  blockMissing(key: WebsiteBuilderSectionKey): number {
    return this.blockGroups(key).filter((group) => group.required && group.missingLanguages.length > 0).length;
  }

  sharedWith(key: WebsiteBuilderSectionKey): string | null {
    const roots = this.definition(key).contentPrefixes;
    const other = SECTION_DEFINITIONS.find((section) => section.key !== key && section.contentPrefixes.some((root) => roots.includes(root)));
    return other?.label ?? null;
  }

  labelOf(group: ContentTranslationGroup): string {
    return displayLabel(group);
  }

  dutchOf(group: ContentTranslationGroup): string {
    return group.texts.find((text) => text.language === 'NL')?.value?.replace(/\s+/g, ' ').trim() || 'Nog geen Nederlandse tekst';
  }

  setRightView(view: 'layout' | 'preview'): void {
    this.rightView.set(view);
  }

  selectSection(index: number): void {
    if (this.copyDirty() || this.copyBusy()) {
      this.ui.toast('Sla de geopende tekst eerst op voordat je van blok wisselt.', 'err');
      return;
    }
    if (index < 0 || index >= this.sections().length) return;
    this.editorOpen.set(false);
    this.editorKey.set(null);
    this.selectedSectionIndex.set(index);
    this.syncPreviewAnchor();
    this.previewError.set(null);
  }

  /**
   * The block list's keys (one tab stop): ↑/↓ choose another block, ⌥↑/⌥↓
   * move the chosen block (the same rules as Hoger/Lager), Space shows or
   * hides it (never a fixed block), Enter goes to the inspector's switch.
   */
  listKey(event: KeyboardEvent): void {
    const button = (event.target as HTMLElement).closest<HTMLElement>('.ws-blk__main');
    if (!button || event.metaKey || event.ctrlKey) return;
    const index = Number(button.dataset['index']);
    const arrow = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (arrow && event.altKey) {
      event.preventDefault();
      if (!(arrow < 0 ? this.canMoveUp(index) : this.canMoveDown(index)) || this.busy()) return;
      const key = this.sections()[index].key;
      this.move(index, arrow as -1 | 1);
      this.focusBlock(key);
    } else if (arrow && !event.altKey) {
      event.preventDefault();
      const next = index + arrow;
      if (next < 0 || next >= this.sections().length) return;
      this.selectSection(next);
      if (this.selectedSectionIndex() === next) this.focusBlock(this.sections()[next].key);
    } else if (event.key === ' ' && !event.altKey) {
      /* The button's own click (on key up) would only select the block again: Space toggles instead. */
      event.preventDefault();
      const section = this.sections()[index];
      if (!section || this.definition(section.key).fixed || this.busy()) return;
      this.toggle(index);
    } else if (event.key === 'Enter' && !event.altKey) {
      event.preventDefault();
      if (this.selectedSectionIndex() !== index) this.selectSection(index);
      if (this.selectedSectionIndex() !== index) return;
      if (!this.threeColumns()) this.rightView.set('layout');
      queueMicrotask(() => document.querySelector<HTMLElement>('.ws-hp__insp .ws-switch, .ws-hp__insp .ws-manage')?.focus());
    }
  }

  /** Space activates a button on key up: keep that from selecting the block a second time. */
  listKeyUp(event: KeyboardEvent): void {
    if (event.key === ' ' && (event.target as HTMLElement).closest('.ws-blk__main')) event.preventDefault();
  }

  /** After the list has rendered: a moved row is re-inserted, which drops its focus. */
  private focusBlock(key: WebsiteBuilderSectionKey): void {
    afterNextRender({ read: () => document.querySelector<HTMLElement>(`.ws-blk__main[data-key="${key}"]`)?.focus() }, { injector: this.injector });
  }

  canMoveUp(index: number): boolean {
    return index > 1 && !this.definition(this.sections()[index].key).fixed;
  }

  canMoveDown(index: number): boolean {
    return index > 0 && index < this.sections().length - 2 && !this.definition(this.sections()[index].key).fixed;
  }

  move(index: number, direction: -1 | 1): void {
    const target = index + direction;
    if (this.busy() || target < 1 || target >= this.sections().length - 1) return;
    const key = this.sections()[index].key;
    const label = this.definition(key).label;
    this.sections.update((sections) => {
      const next = sections.map((section) => ({ ...section }));
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    if (this.selectedSectionIndex() === index) this.selectedSectionIndex.set(target);
    this.act(key);
    this.reorderAnnouncement.set(`${label} staat nu op positie ${target + 1} van ${this.sections().length}.`);
    this.markMoved(key);
    this.resetActionState();
  }

  toggle(index: number): void {
    const section = this.sections()[index];
    if (this.busy() || !section || this.definition(section.key).fixed) return;
    this.act(section.key);
    this.sections.update((sections) => sections.map((section, current) =>
      current === index && !this.definition(section.key).fixed ? { ...section, enabled: !section.enabled } : section));
    this.resetActionState();
  }

  openEditor(key: string | null): void {
    if (this.copyBusy()) return;
    if (this.editorOpen() && this.copyDirty()) {
      this.ui.toast('Sla de tekst eerst op of herstel de wijziging.', 'err');
      return;
    }
    this.editorKey.set(key);
    this.editorOpen.set(true);
  }

  closeEditor(): void {
    if (this.copyDirty() || this.copyBusy()) {
      this.ui.toast('Sla de tekst op of herstel de wijziging in de editor.', 'err');
      return;
    }
    this.editorOpen.set(false);
    this.editorKey.set(null);
  }

  /** The workspace patched the store; the website update it started shows in the status. */
  onCopySaved(): void {
    void this.sync.load();
  }

  openBlock(key: WebsiteBuilderSectionKey): void {
    this.cameFromList = true;
    void this.router.navigate([], { relativeTo: this.route, queryParams: { blok: key }, queryParamsHandling: 'merge' });
  }

  /** Back from the block view: pop the entry when the list is below it (also after a trip to Teksten), else replace (never a loop). */
  closeBlock(): void {
    if (this.cameFromList || this.nav.below() === LIST_URL) {
      this.cameFromList = false;
      this.location.back();
      return;
    }
    void this.router.navigate([], { relativeTo: this.route, queryParams: { blok: null }, queryParamsHandling: 'merge', replaceUrl: true });
  }
  private cameFromList = false;

  openPreview(): void {
    this.previewSheet.set(true);
    if (!this.previewLoaded()) this.refreshPreview();
  }

  closePreview(): void {
    this.previewSheet.set(false);
    this.clearPreviewWatch();
  }

  async load(): Promise<void> {
    if (this.loading() && this.snapshot()) return;
    this.loading.set(true);
    this.loadError.set(null);
    this.resetActionState();
    try {
      this.applySnapshot(await this.catalog.websiteBuilderHomepage());
    } catch (failure: unknown) {
      this.loadError.set(messageOf(failure, 'Controleer de verbinding met Enrosed.'));
    } finally {
      this.loading.set(false);
    }
  }

  async saveDraft(): Promise<boolean> {
    const snapshot = this.snapshot();
    if (!snapshot || !this.dirty() || this.busy()) return false;
    this.saving.set(true);
    this.resetActionState();
    this.lastAction.set('save');
    try {
      const saved = await this.catalog.saveWebsiteBuilderHomepage(snapshot.revision, this.sections());
      this.applySnapshot(saved);
      this.ui.toast('Homepageconcept opgeslagen');
      return true;
    } catch (failure: unknown) {
      this.handleActionFailure(failure, 'Websiteconcept opslaan mislukt.');
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  async publish(): Promise<void> {
    let snapshot = this.snapshot();
    if (!snapshot || this.busy() || this.copyDirty()) return;
    this.publishing.set(true);
    this.resetActionState();
    this.lastAction.set('publish');
    try {
      /* N8 compares live revisions: the one before this publish must be known, else nothing is watched (no early "bijgewerkt"). */
      if (!this.sync.status()) await this.sync.load();
      const before = this.sync.status();
      if (this.dirty()) {
        snapshot = await this.catalog.saveWebsiteBuilderHomepage(snapshot.revision, this.sections());
        this.applySnapshot(snapshot);
      }
      this.lastAction.set('publish');
      const published = await this.catalog.publishWebsiteBuilderHomepage(snapshot.revision);
      this.applySnapshot(published);
      /* The preview waits for the site to be live on a newer revision (critique N8), not for "LIVE" alone. */
      if (before) this.publishedFrom.set(before.liveRevision ?? null);
      void this.sync.load();
      this.ui.toast('Homepage-indeling gepubliceerd');
    } catch (failure: unknown) {
      this.handleActionFailure(failure, 'Website publiceren mislukt.');
    } finally {
      this.publishing.set(false);
    }
  }

  revertLayout(): void {
    if (!this.dirty() || this.busy()) return;
    const selectedKey = this.selectedSection()?.key;
    this.ui.confirm({
      title: 'Indeling herstellen?',
      message: 'Alle niet-opgeslagen wijzigingen aan volgorde en zichtbaarheid gaan verloren.',
      confirmLabel: 'Herstellen',
      danger: true,
    }, () => {
      const baseline = JSON.parse(this.baseline()) as WebsiteBuilderSection[];
      this.sections.set(baseline.map((section) => ({ ...section })));
      this.acted.set(new Set());
      this.selectedSectionIndex.set(Math.max(0, baseline.findIndex((section) => section.key === selectedKey)));
      this.resetActionState();
      this.ui.toast('Niet-opgeslagen indeling hersteld');
    });
  }

  reloadLatest(): void {
    if (!this.dirty()) {
      void this.load();
      return;
    }
    this.ui.confirm({
      title: 'Nieuwste versie laden',
      message: 'Je niet-opgeslagen wijzigingen worden vervangen door de nieuwste versie.',
      confirmLabel: 'Nieuwste versie laden',
      danger: true,
    }, () => void this.load());
  }

  refreshPreview(): void {
    this.startPreviewWatch();
    this.previewNonce.update((value) => value + 1);
  }

  markPreviewLoaded(): void {
    this.clearPreviewWatch();
    this.previewError.set(null);
    this.previewLoaded.set(true);
  }

  markPreviewFailed(): void {
    this.clearPreviewWatch();
    this.previewLoaded.set(false);
    this.previewError.set(`Ververs het voorbeeld of open de ${this.previewSiteName} apart om de buildmelding te bekijken.`);
  }

  canDeactivate(): boolean | Promise<boolean> {
    if (this.saving() || this.publishing() || this.copyBusy()) return false;
    if (this.copyDirty()) return confirmLeave(this.ui, undefined, { message: 'Je hebt websitetekst die nog niet is opgeslagen. Als je dit scherm verlaat, gaat die wijziging verloren.' });
    if (this.dirty()) return confirmLeave(this.ui, () => this.saveDraft());
    return true;
  }

  @HostListener('window:beforeunload', ['$event'])
  warnBeforeUnload(event: BeforeUnloadEvent): void {
    if (!this.dirty() && !this.copyDirty() && !this.saving() && !this.publishing() && !this.copyBusy()) return;
    event.preventDefault();
    event.returnValue = '';
  }

  /** ⌘S saves the concept; while the inline text is dirty the editor saves the text instead (and the browser dialog never opens). */
  @HostListener('window:keydown', ['$event'])
  saveShortcut(event: KeyboardEvent): void {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return;
    if (this.copyDirty()) { event.preventDefault(); return; }
    if (!this.dirty() || this.busy()) return;
    event.preventDefault();
    void this.saveDraft();
  }

  private act(key: WebsiteBuilderSectionKey): void {
    if (!this.acted().has(key)) this.acted.update((keys) => new Set([...keys, key]));
  }

  private markMoved(key: string): void {
    this.flash.set(null);
    if (this.flashTimer) clearTimeout(this.flashTimer);
    queueMicrotask(() => this.flash.set(key));
    this.flashTimer = setTimeout(() => this.flash.set(null), 600);
  }

  private startPreviewWatch(): void {
    this.clearPreviewWatch();
    this.previewLoaded.set(false);
    this.previewError.set(null);
    this.previewWatch = setTimeout(() => {
      this.previewWatch = null;
      if (!this.previewLoaded()) {
        this.previewError.set(`De ${this.previewSiteName} bleef te lang laden. De websitebuild kan nog bezig zijn of een fout bevatten.`);
      }
    }, 15_000);
  }

  private clearPreviewWatch(): void {
    if (this.previewWatch === null) return;
    clearTimeout(this.previewWatch);
    this.previewWatch = null;
  }

  private applySnapshot(snapshot: WebsiteBuilderHomepage): void {
    const selectedKey = this.blockKey() ?? this.selectedSection()?.key ?? 'hero';
    const sections = normalizeSections(snapshot.draft.sections);
    const normalized = { ...snapshot, draft: { sections }, published: { sections: normalizeSections(snapshot.published.sections) } };
    this.snapshot.set(normalized);
    this.store.setHomepage(normalized);
    this.sections.set(sections.map((section) => ({ ...section })));
    const selectedIndex = sections.findIndex((section) => section.key === selectedKey);
    this.selectedSectionIndex.set(selectedIndex >= 0 ? selectedIndex : 0);
    this.syncPreviewAnchor();
    this.baseline.set(JSON.stringify(sections));
    this.acted.set(new Set());
    this.loadError.set(null);
    this.resetActionState();
  }

  private syncPreviewAnchor(): void {
    const selected = this.selectedSection();
    const live = !!selected && !!this.snapshot()?.published.sections.find((section) => section.key === selected.key)?.enabled;
    this.previewAnchor.set(selected && live ? this.definition(selected.key).previewAnchor : '');
  }

  private handleActionFailure(failure: unknown, fallback: string): void {
    const conflict = isRevisionConflict(failure);
    this.conflict.set(conflict);
    this.actionError.set(conflict ? 'Laad de nieuwste versie en controleer je wijzigingen opnieuw.' : messageOf(failure, fallback));
  }

  private resetActionState(): void {
    this.actionError.set(null);
    this.conflict.set(false);
    this.lastAction.set(null);
  }
}
