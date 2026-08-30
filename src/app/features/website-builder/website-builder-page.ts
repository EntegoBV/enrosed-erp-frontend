import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  HostListener,
  computed,
  inject,
  signal,
} from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { CatalogApi } from '../../core/api/catalog-api';
import { isRevisionConflict, messageOf } from '../../core/api/errors';
import { HasUnsavedChanges } from '../../core/guards/unsaved-changes.guard';
import {
  WebsiteBuilderHomepage,
  WebsiteBuilderSection,
  WebsiteBuilderSectionKey,
} from '../../core/api/models';
import { PageHeader } from '../../shared/page-header';
import { Ui } from '../../shared/ui';
import { ContentTranslationWorkspace } from '../settings/content-translation-workspace';
import { WebsiteSyncStatus } from '../settings/website-sync-status';
import { environment } from '../../../environments/environment';

interface SectionDefinition {
  key: WebsiteBuilderSectionKey;
  label: string;
  description: string;
  previewAnchor: string;
  contentPrefixes: readonly string[];
  manageLabel: string;
  manageRoute: string;
  fixed?: boolean;
}

const SECTION_DEFINITIONS: readonly SectionDefinition[] = [
  {
    key: 'hero',
    label: 'Openingsbeeld & tekstband',
    description: 'Het eerste beeld, de hoofdboodschap en de tekstband eronder.',
    previewAnchor: 'hero',
    contentPrefixes: ['home.hero', 'home.marquee'],
    manageLabel: 'Alle websiteteksten',
    manageRoute: '/website/texts',
    fixed: true,
  },
  {
    key: 'range',
    label: 'Ons assortiment',
    description: 'De categorieën waarmee een inkoper de collectie binnenkomt.',
    previewAnchor: 'range',
    contentPrefixes: ['home.catalog'],
    manageLabel: 'Categorieën & beelden',
    manageRoute: '/website/categories',
  },
  {
    key: 'order',
    label: 'Zo bestelt u',
    description: 'De drie bestelroutes van aanvraag tot levering.',
    previewAnchor: 'wholesale',
    contentPrefixes: ['home.order'],
    manageLabel: 'Alle websiteteksten',
    manageRoute: '/website/texts',
  },
  {
    key: 'counter',
    label: 'Counterdisplays',
    description: 'Producten die direct op de toonbank kunnen.',
    previewAnchor: 'displays',
    contentPrefixes: ['home.counter'],
    manageLabel: 'Producten & beelden',
    manageRoute: '/website/products',
  },
  {
    key: 'flowerbox',
    label: 'Glass bowls & flowerboxes',
    description: 'Bestsellers; houd de glazen presentaties prominent en hoog.',
    previewAnchor: 'flowerboxes',
    contentPrefixes: ['home.flowerbox'],
    manageLabel: 'Producten & beelden',
    manageRoute: '/website/products',
  },
  {
    key: 'soap',
    label: 'Zeep- en foamrozen',
    description: 'De gift-ready collectie van soap- en foamproducten.',
    previewAnchor: 'soap-roses',
    contentPrefixes: ['home.soap'],
    manageLabel: 'Producten & beelden',
    manageRoute: '/website/products',
  },
  {
    key: 'occasion',
    label: 'Kleine cadeaus',
    description: 'Compacte producten voor een klein gebaar.',
    previewAnchor: 'gifting',
    contentPrefixes: ['home.occasion'],
    manageLabel: 'Producten & beelden',
    manageRoute: '/website/products',
  },
  {
    key: 'retail',
    label: 'Geschikt voor retail',
    description: 'Verkoopomgevingen en toepassingen voor professionele kopers.',
    previewAnchor: 'retail-channels',
    contentPrefixes: ['home.retail'],
    manageLabel: 'Producten & beelden',
    manageRoute: '/website/products',
  },
  {
    key: 'faq',
    label: 'Veelgestelde vragen',
    description: 'Praktische antwoorden voor professionele klanten.',
    previewAnchor: 'trade-faq',
    contentPrefixes: ['home.faq'],
    manageLabel: 'Alle websiteteksten',
    manageRoute: '/website/texts',
  },
  {
    key: 'catalog',
    label: 'Volledige collectie',
    description: 'De uitgebreide productcatalogus op de homepage.',
    previewAnchor: 'collection',
    contentPrefixes: ['home.catalog'],
    manageLabel: 'Categorieën & producten',
    manageRoute: '/website/categories',
  },
  {
    key: 'quote',
    label: 'Offerte aanvragen',
    description: 'Het vaste contactblok onderaan de pagina.',
    previewAnchor: 'contact',
    contentPrefixes: ['home.quote'],
    manageLabel: 'Alle websiteteksten',
    manageRoute: '/website/texts',
    fixed: true,
  },
] as const;

const SECTION_KEYS = new Set<WebsiteBuilderSectionKey>(
  SECTION_DEFINITIONS.map((section) => section.key),
);

@Component({
  selector: 'app-website-builder-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ContentTranslationWorkspace, PageHeader, RouterLink, WebsiteSyncStatus],
  template: `
    <app-page-header
      title="Homepage builder"
      subtitle="Kies een blok, wijzig het op één plek en controleer de gepubliceerde website."
      [showBell]="false"
    >
      <a class="btn btn--sm" [href]="previewBaseUrl" target="_blank" rel="noopener">
        {{ previewSiteLabel }} openen
      </a>
    </app-page-header>

    <main class="content builder-page">
      <section class="builder-guide" role="note">
        <span class="builder-guide__step">1</span>
        <div>
          <b>Kies een homepageblok</b
          ><small>Swipe door de paginaopbouw en tik het onderdeel aan.</small>
        </div>
        <span class="builder-guide__step">2</span>
        <div>
          <b>Pas indeling of tekst aan</b><small>Teksten kunt u nu in deze builder bewerken.</small>
        </div>
        <span class="builder-guide__step">3</span>
        <div>
          <b>Publiceer de indeling</b
          ><small>De preview toont bewust de huidige live website.</small>
        </div>
      </section>

      <nav class="mobile-tabs" role="tablist" aria-label="Website-builder weergave">
        <button
          id="builder-edit-tab"
          type="button"
          role="tab"
          [class.active]="mobileTab() === 'edit'"
          [attr.aria-selected]="mobileTab() === 'edit'"
          [attr.tabindex]="mobileTab() === 'edit' ? 0 : -1"
          aria-controls="builder-edit-pane"
          (click)="setMobileTab('edit')"
          (keydown)="onMobileTabKeydown($event, 'edit')"
        >
          Bewerken
        </button>
        <button
          id="builder-preview-tab"
          type="button"
          role="tab"
          [class.active]="mobileTab() === 'preview'"
          [attr.aria-selected]="mobileTab() === 'preview'"
          [attr.tabindex]="mobileTab() === 'preview' ? 0 : -1"
          aria-controls="builder-preview-pane"
          (click)="setMobileTab('preview')"
          (keydown)="onMobileTabKeydown($event, 'preview')"
        >
          Live voorbeeld
        </button>
      </nav>

      @if (loading() && !snapshot()) {
        <section class="load-state card" role="status">
          <span class="load-dot" aria-hidden="true"></span>
          <div><b>Website-indeling laden…</b><small>Een ogenblik.</small></div>
        </section>
      } @else if (loadError() && !snapshot()) {
        <section class="load-state load-state--error card" role="alert">
          <div>
            <b>Website-indeling kon niet worden geladen</b><small>{{ loadError() }}</small>
          </div>
          <button class="btn btn--primary" type="button" (click)="load()">Opnieuw proberen</button>
        </section>
      } @else if (snapshot()) {
        <div class="builder-layout" [attr.data-mobile-tab]="mobileTab()">
          <section
            id="builder-edit-pane"
            class="builder-pane builder-controls"
            role="tabpanel"
            aria-labelledby="builder-edit-tab"
          >
            <section class="status-card card" aria-live="polite">
              <span
                class="status-mark"
                [class.status-mark--pending]="dirty() || hasUnpublishedChanges()"
                aria-hidden="true"
              ></span>
              <div>
                <b>{{ draftStatusTitle() }}</b>
                <small>{{ draftStatusDetail() }}</small>
              </div>
              @if (snapshot()?.updatedAt; as updatedAt) {
                <time [attr.datetime]="updatedAt">Gewijzigd {{ formatMoment(updatedAt) }}</time>
              }
            </section>

            @if (conflict()) {
              <section class="conflict-card" role="alert">
                <div>
                  <b>Iemand anders heeft de website-indeling aangepast</b>
                  <small>{{ actionError() }}</small>
                </div>
                <button class="btn" type="button" [disabled]="busy()" (click)="reloadLatest()">
                  Nieuwste versie laden
                </button>
              </section>
            } @else if (actionError()) {
              <section class="error-card" role="alert">
                <div>
                  <b>{{ lastAction() === 'publish' ? 'Publiceren mislukt' : 'Opslaan mislukt' }}</b
                  ><small>{{ actionError() }}</small>
                </div>
                <div class="error-card__actions">
                  <button class="btn" type="button" [disabled]="busy()" (click)="reloadLatest()">
                    Laatste versie laden
                  </button>
                  @if (lastAction() === 'publish') {
                    <button
                      class="btn btn--primary"
                      type="button"
                      [disabled]="busy()"
                      (click)="publish()"
                    >
                      Opnieuw publiceren
                    </button>
                  } @else {
                    <button
                      class="btn btn--primary"
                      type="button"
                      [disabled]="busy() || !dirty()"
                      (click)="saveDraft()"
                    >
                      Opnieuw opslaan
                    </button>
                  }
                </div>
              </section>
            }

            <section class="card section-editor" aria-labelledby="sections-title">
              <div class="card__head section-editor__head">
                <div>
                  <span class="eyebrow">Paginaopbouw</span>
                  <h2 id="sections-title">Kies een onderdeel</h2>
                  <p>Swipe horizontaal. De volgorde in deze rail is de volgorde op de homepage.</p>
                </div>
                <span>{{ activeSectionCount() }} actief</span>
              </div>

              <nav class="section-rail" aria-label="Homepage-onderdelen">
                @for (
                  section of sections();
                  track section.key;
                  let index = $index;
                  let count = $count
                ) {
                  <button
                    type="button"
                    class="section-chip"
                    [class.section-chip--selected]="selectedSectionIndex() === index"
                    [class.section-chip--hidden]="!section.enabled"
                    [attr.aria-current]="selectedSectionIndex() === index ? 'step' : null"
                    [attr.aria-label]="
                      definition(section.key).label + ', positie ' + (index + 1) + ' van ' + count
                    "
                    [attr.aria-posinset]="index + 1"
                    [attr.aria-setsize]="count"
                    [disabled]="copyDirty() || copyBusy()"
                    (click)="selectSection(index)"
                  >
                    <span>{{ positionLabel(index) }}</span>
                    <b>{{ definition(section.key).label }}</b>
                    <small>{{ section.enabled ? 'Actief in indeling' : 'Verborgen' }}</small>
                  </button>
                }
              </nav>

              @if (selectedSection(); as activeSection) {
                <article
                  class="section-inspector"
                  [class.section-inspector--hidden]="!activeSection.enabled"
                >
                  <header>
                    <span class="section-number">{{ positionLabel(selectedSectionIndex()) }}</span>
                    <div>
                      <small>{{
                        activeSection.enabled ? 'Actief homepageblok' : 'Verborgen homepageblok'
                      }}</small>
                      <h3>{{ definition(activeSection.key).label }}</h3>
                    </div>
                    @if (definition(activeSection.key).fixed) {
                      <span class="fixed-badge">Vast blok</span>
                    } @else {
                      <button
                        class="visibility-toggle"
                        type="button"
                        role="switch"
                        [attr.aria-checked]="activeSection.enabled"
                        [disabled]="busy() || copyBusy()"
                        (click)="toggle(selectedSectionIndex())"
                      >
                        <span aria-hidden="true"></span>
                        {{ activeSection.enabled ? 'Zichtbaar' : 'Verborgen' }}
                      </button>
                    }
                  </header>
                  <p>{{ definition(activeSection.key).description }}</p>

                  <div class="section-inspector__actions">
                    <div
                      class="reorder-controls"
                      role="group"
                      [attr.aria-label]="'Volgorde van ' + definition(activeSection.key).label"
                    >
                      <button
                        type="button"
                        [disabled]="!canMoveUp(selectedSectionIndex()) || busy()"
                        (click)="move(selectedSectionIndex(), -1)"
                        [attr.aria-label]="
                          definition(activeSection.key).label + ' één plaats naar voren'
                        "
                      >
                        <i class="chevron chevron--left" aria-hidden="true"></i>
                        Naar voren
                      </button>
                      <button
                        type="button"
                        [disabled]="!canMoveDown(selectedSectionIndex()) || busy()"
                        (click)="move(selectedSectionIndex(), 1)"
                        [attr.aria-label]="
                          definition(activeSection.key).label + ' één plaats naar achteren'
                        "
                      >
                        Naar achteren
                        <i class="chevron chevron--right" aria-hidden="true"></i>
                      </button>
                    </div>
                    <button
                      class="btn inline-edit-button"
                      type="button"
                      [class.inline-edit-button--active]="copyEditorOpen()"
                      [attr.aria-expanded]="copyEditorOpen()"
                      [disabled]="copyBusy()"
                      (click)="toggleCopyEditor()"
                    >
                      {{ copyEditorOpen() ? 'Teksteditor sluiten' : 'Teksten hier bewerken' }}
                    </button>
                    <a
                      class="btn context-link"
                      [routerLink]="definition(activeSection.key).manageRoute"
                    >
                      {{ definition(activeSection.key).manageLabel }}
                      <i class="chevron chevron--right" aria-hidden="true"></i>
                    </a>
                  </div>

                  <small class="section-inspector__preview-note">
                    @if (selectedSectionIsPublished()) {
                      Het live voorbeeld rechts springt mee naar dit onderdeel.
                    } @else {
                      Dit onderdeel staat nog niet zichtbaar in de gepubliceerde website.
                    }
                  </small>
                </article>
              }
              <p class="sr-only" aria-live="polite">{{ reorderAnnouncement() }}</p>
            </section>

            @if (copyEditorOpen() && selectedSection(); as activeSection) {
              <section class="inline-copy card" aria-label="Inline websiteteksten bewerken">
                <div class="inline-copy__notice" role="note">
                  <div>
                    <b>Teksten van {{ definition(activeSection.key).label }}</b>
                    <small
                      >Tekstwijzigingen worden hier apart opgeslagen en starten daarna automatisch
                      een website-update.</small
                    >
                  </div>
                  <button
                    type="button"
                    [disabled]="copyDirty() || copyBusy()"
                    (click)="closeCopyEditor()"
                  >
                    Sluiten
                  </button>
                </div>
                <app-content-translation-workspace
                  [visible]="true"
                  title="Inline teksteditor"
                  description="Swipe door de tekstvelden van dit homepageblok en bewerk de gekozen taal."
                  [initialScope]="'WEBSITE'"
                  initialPrefix="ALL"
                  [keyPrefixes]="definition(activeSection.key).contentPrefixes"
                  [lockScope]="true"
                  [allowAdvanced]="false"
                  [compact]="true"
                  (dirtyChange)="copyDirty.set($event)"
                  (busyChange)="copyBusy.set($event)"
                  (contentSaved)="onCopySaved()"
                />
              </section>
            }

            <app-website-sync-status [refreshKey]="syncRefreshKey()" />
          </section>

          <aside
            id="builder-preview-pane"
            class="builder-pane preview-pane"
            role="tabpanel"
            aria-labelledby="builder-preview-tab"
          >
            <div class="preview-head">
              <div>
                <span>Gepubliceerde {{ previewSiteName }}</span>
                <h2 id="preview-title">Live websitevoorbeeld</h2>
                <small>Conceptwijzigingen verschijnen hier pas na publiceren.</small>
              </div>
              <div class="preview-head__actions">
                <div class="device-switch" role="group" aria-label="Breedte van websitevoorbeeld">
                  <button
                    type="button"
                    [class.active]="previewDevice() === 'auto'"
                    [attr.aria-pressed]="previewDevice() === 'auto'"
                    (click)="previewDevice.set('auto')"
                  >
                    Auto
                  </button>
                  <button
                    type="button"
                    [class.active]="previewDevice() === 'mobile'"
                    [attr.aria-pressed]="previewDevice() === 'mobile'"
                    (click)="previewDevice.set('mobile')"
                  >
                    Mobiel
                  </button>
                </div>
                <button class="btn" type="button" (click)="refreshPreview()">Verversen</button>
              </div>
            </div>
            <div class="preview-stage" [attr.data-device]="previewDevice()">
              <div
                class="preview-frame"
                [class.preview-frame--loaded]="previewLoaded() && !previewError()"
              >
                @if (previewError()) {
                  <div class="preview-failed" role="alert">
                    <span aria-hidden="true">!</span>
                    <b>Het websitevoorbeeld reageert niet</b>
                    <small>{{ previewError() }}</small>
                    <div>
                      <button class="btn" type="button" (click)="refreshPreview()">
                        Opnieuw laden
                      </button>
                      <a
                        class="btn btn--primary"
                        [href]="previewBaseUrl"
                        target="_blank"
                        rel="noopener"
                      >
                        {{ previewSiteLabel }} openen
                      </a>
                    </div>
                  </div>
                } @else if (!previewLoaded()) {
                  <div class="preview-loading" role="status">{{ previewSiteLabel }} laden…</div>
                }
                <iframe
                  [src]="previewUrl()"
                  [title]="'Live voorbeeld van de Enrosed ' + previewSiteName"
                  loading="lazy"
                  referrerpolicy="strict-origin-when-cross-origin"
                  (load)="markPreviewLoaded()"
                  (error)="markPreviewFailed()"
                ></iframe>
              </div>
            </div>
            <a class="preview-external" [href]="previewBaseUrl" target="_blank" rel="noopener">
              Open de {{ previewSiteName }} in een nieuw venster
              <i class="external-mark" aria-hidden="true"></i>
            </a>
          </aside>
        </div>

        <div class="builder-actions" [attr.aria-busy]="busy() || copyBusy()">
          <div>
            <b>{{ actionBarTitle() }}</b>
            <small>{{ actionBarDetail() }}</small>
          </div>
          <button
            class="btn undo-button"
            type="button"
            [disabled]="!dirty() || busy()"
            (click)="revertLayout()"
          >
            Herstel concept
          </button>
          <button class="btn" type="button" [disabled]="!dirty() || busy()" (click)="saveDraft()">
            {{ saving() ? 'Opslaan…' : 'Concept opslaan' }}
          </button>
          <button
            class="btn btn--primary"
            type="button"
            [disabled]="
              (!dirty() && !hasUnpublishedChanges()) || busy() || copyDirty() || copyBusy()
            "
            (click)="publish()"
          >
            {{ publishing() ? 'Publiceren…' : dirty() ? 'Opslaan & publiceren' : 'Publiceren' }}
          </button>
        </div>
      }
    </main>
  `,
  styles: `
    :host {
      display: block;
    }
    .builder-page {
      max-width: 1540px;
      padding-bottom: calc(92px + env(safe-area-inset-bottom));
    }
    .builder-guide {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto minmax(0, 1fr) auto minmax(0, 1fr);
      align-items: center;
      gap: 10px 12px;
      margin-bottom: 16px;
      padding: 13px 16px;
      border: 1px solid var(--rose-line);
      border-radius: var(--r-sm);
      background: var(--rose-soft);
    }
    .builder-guide__step {
      display: grid;
      width: 28px;
      height: 28px;
      place-items: center;
      border-radius: 9px;
      background: var(--rose-dark);
      color: #fff;
      font-size: 12px;
      font-weight: 850;
    }
    .builder-guide > div {
      display: grid;
      gap: 1px;
      min-width: 0;
    }
    .builder-guide b {
      color: var(--rose-dark);
      font-size: 14px;
    }
    .builder-guide small {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.35;
    }
    .mobile-tabs {
      display: none;
    }
    .builder-layout {
      display: grid;
      grid-template-columns: minmax(520px, 0.92fr) minmax(460px, 1.08fr);
      gap: 18px;
      align-items: start;
    }
    .builder-pane {
      min-width: 0;
    }
    .builder-controls {
      display: grid;
      gap: 16px;
    }
    .status-card {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      align-items: center;
      gap: 12px;
      padding: 15px 16px;
    }
    .status-card > div {
      display: grid;
      gap: 2px;
    }
    .status-card b {
      font-size: 15px;
    }
    .status-card small,
    .status-card time {
      color: var(--muted);
      font-size: 13px;
      line-height: 1.45;
    }
    .status-card time {
      white-space: nowrap;
    }
    .status-mark {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: var(--ok);
      box-shadow: 0 0 0 5px var(--ok-soft);
    }
    .status-mark--pending {
      background: var(--warn);
      box-shadow: 0 0 0 5px var(--warn-soft);
    }
    .conflict-card,
    .error-card {
      padding: 14px;
      border: 1px solid var(--danger);
      border-radius: var(--r-sm);
      background: var(--danger-soft);
      color: var(--danger);
    }
    .conflict-card,
    .error-card {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
    }
    .conflict-card > div,
    .error-card > div:first-child {
      display: grid;
      gap: 3px;
    }
    .conflict-card small,
    .error-card small {
      color: var(--muted);
      font-size: 13px;
      line-height: 1.45;
    }
    .error-card__actions {
      display: flex;
      flex: none;
      gap: 8px;
    }
    .error-card .btn {
      min-height: 48px;
    }
    .section-editor {
      overflow: hidden;
    }
    .section-editor__head {
      align-items: flex-start;
      gap: 14px;
    }
    .eyebrow {
      color: var(--rose-dark);
      font-size: 10px;
      font-weight: 850;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }
    .section-editor__head h2,
    .preview-head h2 {
      margin-top: 2px;
      font-size: 20px;
      line-height: 1.2;
    }
    .section-editor__head p {
      margin-top: 4px;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.45;
    }
    .section-editor__head > span {
      flex: none;
      padding: 7px 10px;
      border-radius: 999px;
      background: var(--rose-soft);
      color: var(--rose-dark);
      font-size: 13px;
      font-weight: 750;
    }
    .section-rail {
      display: flex;
      gap: 8px;
      overflow-x: auto;
      padding: 2px 14px 12px;
      scroll-padding-inline: 14px;
      scroll-snap-type: inline mandatory;
      scrollbar-width: thin;
    }
    .section-chip {
      display: grid;
      width: 176px;
      min-width: 176px;
      min-height: 112px;
      flex: 0 0 176px;
      align-content: space-between;
      gap: 6px;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 14px;
      background: var(--surface-2);
      color: var(--ink);
      cursor: pointer;
      scroll-snap-align: start;
      text-align: left;
    }
    .section-chip > span {
      color: var(--rose-dark);
      font-size: 11px;
      font-weight: 850;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .section-chip b {
      font-size: 14px;
      line-height: 1.28;
    }
    .section-chip small {
      color: var(--ok);
      font-size: 11px;
      font-weight: 750;
    }
    .section-chip--selected {
      border-color: var(--rose);
      background: var(--rose-soft);
      box-shadow: inset 0 -3px 0 var(--rose);
    }
    .section-chip--hidden {
      opacity: 0.58;
    }
    .section-chip--hidden small {
      color: var(--muted);
    }
    .section-chip:disabled {
      cursor: not-allowed;
    }
    .section-inspector {
      display: grid;
      gap: 13px;
      margin: 0 14px 14px;
      padding: 16px;
      border: 1px solid var(--line);
      border-radius: 15px;
      background: var(--surface);
    }
    .section-inspector--hidden {
      background: var(--surface-2);
    }
    .section-inspector > header {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      align-items: center;
      gap: 12px;
    }
    .section-number {
      display: grid;
      width: 46px;
      height: 46px;
      place-items: center;
      border-radius: 14px;
      background: var(--ink);
      color: #fff;
      font-size: 12px;
      font-weight: 850;
      letter-spacing: 0.06em;
    }
    .section-inspector header > div {
      display: grid;
      gap: 1px;
    }
    .section-inspector header small {
      color: var(--rose-dark);
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
    }
    .section-inspector h3 {
      font-size: 18px;
      line-height: 1.2;
    }
    .section-inspector > p {
      color: var(--muted);
      font-size: 14px;
      line-height: 1.5;
    }
    .fixed-badge {
      padding: 8px 10px;
      border-radius: 10px;
      background: var(--surface-2);
      color: var(--muted);
      font-size: 12px;
      font-weight: 750;
      white-space: nowrap;
    }
    .visibility-toggle {
      display: inline-flex;
      min-width: 122px;
      min-height: 46px;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 8px 12px;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: var(--surface-2);
      color: var(--muted);
      font-size: 13px;
      font-weight: 750;
      cursor: pointer;
    }
    .visibility-toggle span {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--muted-2);
    }
    .visibility-toggle[aria-checked='true'] {
      border-color: var(--ok);
      background: var(--ok-soft);
      color: var(--ok);
    }
    .visibility-toggle[aria-checked='true'] span {
      background: var(--ok);
    }
    .section-inspector__actions {
      display: grid;
      grid-template-columns: minmax(0, 1.15fr) minmax(150px, 0.85fr) minmax(150px, 0.85fr);
      gap: 8px;
    }
    .reorder-controls {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 5px;
    }
    .reorder-controls button,
    .inline-copy__notice > button {
      display: inline-flex;
      min-height: 48px;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 8px 10px;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: var(--surface-2);
      color: var(--ink);
      font-size: 12px;
      font-weight: 750;
      cursor: pointer;
    }
    .reorder-controls button:disabled {
      opacity: 0.32;
      cursor: default;
    }
    .chevron {
      display: inline-block;
      width: 8px;
      height: 8px;
      flex: none;
      border-top: 2px solid currentColor;
      border-right: 2px solid currentColor;
    }
    .chevron--left {
      transform: rotate(-135deg);
    }
    .chevron--right {
      transform: rotate(45deg);
    }
    .inline-edit-button,
    .context-link {
      min-height: 48px;
      border-radius: 12px;
      font-size: 12px;
      text-align: center;
    }
    .inline-edit-button--active {
      border-color: var(--rose);
      background: var(--rose-soft);
      color: var(--rose-dark);
    }
    .context-link {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      text-decoration: none;
    }
    .section-inspector__preview-note {
      padding-top: 10px;
      border-top: 1px solid var(--line);
      color: var(--muted);
      font-size: 12px;
      line-height: 1.4;
    }
    .inline-copy {
      overflow: hidden;
    }
    .inline-copy__notice {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      padding: 14px 16px;
      border-bottom: 1px solid var(--line);
      background: var(--rose-soft);
    }
    .inline-copy__notice > div {
      display: grid;
      gap: 2px;
    }
    .inline-copy__notice b {
      color: var(--rose-dark);
      font-size: 15px;
    }
    .inline-copy__notice small {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.4;
    }
    .inline-copy__notice > button {
      flex: none;
      background: var(--surface);
    }
    .builder-actions {
      position: sticky;
      z-index: 8;
      bottom: 10px;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto auto auto;
      align-items: center;
      gap: 9px;
      margin-top: 16px;
      padding: 12px;
      border: 1px solid var(--line-strong);
      border-radius: 16px;
      background: color-mix(in srgb, var(--surface) 94%, transparent);
      box-shadow: var(--sh-2);
      backdrop-filter: blur(18px);
    }
    .builder-actions > div {
      display: grid;
      gap: 2px;
    }
    .builder-actions b {
      font-size: 14px;
    }
    .builder-actions small {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.35;
    }
    .builder-actions .btn {
      min-height: 48px;
    }
    .preview-pane {
      position: sticky;
      top: calc(var(--appbar-h) + 14px);
      display: grid;
      gap: 10px;
    }
    .preview-head {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 12px;
      padding-inline: 2px;
    }
    .preview-head > div:first-child {
      display: grid;
      gap: 2px;
    }
    .preview-head > div:first-child > span {
      color: var(--rose-dark);
      font-size: 11px;
      font-weight: 850;
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }
    .preview-head small {
      color: var(--muted);
      font-size: 12px;
    }
    .preview-head__actions {
      display: flex;
      align-items: center;
      gap: 7px;
    }
    .preview-head .btn {
      min-height: 44px;
    }
    .device-switch {
      display: flex;
      gap: 3px;
      padding: 3px;
      border-radius: 11px;
      background: var(--surface-2);
    }
    .device-switch button {
      min-height: 38px;
      padding: 7px 10px;
      border: 0;
      border-radius: 8px;
      background: transparent;
      color: var(--muted);
      font-size: 12px;
      font-weight: 750;
      cursor: pointer;
    }
    .device-switch button.active {
      background: var(--surface);
      color: var(--rose-dark);
      box-shadow: var(--sh-1);
    }
    .preview-stage {
      display: flex;
      min-height: 590px;
      justify-content: center;
      overflow: hidden;
      border-radius: 18px;
      background: #e8e3df;
    }
    .preview-frame {
      position: relative;
      width: 100%;
      height: calc(100vh - var(--appbar-h) - 125px);
      height: calc(100dvh - var(--appbar-h) - 125px);
      min-height: 590px;
      overflow: hidden;
      border: 1px solid var(--line-strong);
      border-radius: 18px;
      background: #100b09;
      box-shadow: var(--sh-2);
      transition:
        width 0.2s ease,
        border-radius 0.2s ease;
    }
    .preview-stage[data-device='mobile'] {
      padding: 12px;
    }
    .preview-stage[data-device='mobile'] .preview-frame {
      width: min(390px, 100%);
      border-radius: 28px;
    }
    .preview-frame iframe {
      display: block;
      width: 100%;
      height: 100%;
      border: 0;
      background: #fff;
      opacity: 0;
    }
    .preview-frame--loaded iframe {
      opacity: 1;
    }
    .preview-loading {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      color: #e8ded7;
      font-size: 14px;
    }
    .preview-failed {
      position: absolute;
      z-index: 2;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      gap: 8px;
      padding: 24px;
      background: #100b09;
      color: #fff;
      text-align: center;
    }
    .preview-failed > span {
      display: grid;
      width: 48px;
      height: 48px;
      place-items: center;
      border-radius: 16px;
      background: rgb(255 255 255 / 10%);
      color: #ffd1c8;
      font-size: 20px;
      font-weight: 800;
    }
    .preview-failed b {
      font-size: 18px;
    }
    .preview-failed small {
      max-width: 420px;
      color: #d5c9c3;
      font-size: 14px;
      line-height: 1.45;
    }
    .preview-failed > div {
      display: flex;
      justify-content: center;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 5px;
    }
    .preview-external {
      min-height: 48px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      color: var(--rose-dark);
      font-size: 14px;
      font-weight: 700;
      text-decoration: none;
    }
    .external-mark {
      position: relative;
      display: inline-block;
      width: 13px;
      height: 13px;
      border: 1.8px solid currentColor;
      border-radius: 2px;
    }
    .external-mark::before {
      position: absolute;
      top: -4px;
      right: -4px;
      width: 8px;
      height: 8px;
      border-top: 2px solid currentColor;
      border-right: 2px solid currentColor;
      background: var(--bg);
      content: '';
    }
    .external-mark::after {
      position: absolute;
      top: 1px;
      right: -1px;
      width: 7px;
      height: 2px;
      background: currentColor;
      content: '';
      transform: rotate(-45deg);
      transform-origin: right center;
    }
    .load-state {
      display: flex;
      min-height: 160px;
      align-items: center;
      justify-content: center;
      gap: 12px;
      padding: 24px;
    }
    .load-state > div {
      display: grid;
      gap: 3px;
    }
    .load-state small {
      color: var(--muted);
    }
    .load-state--error {
      justify-content: space-between;
      color: var(--danger);
    }
    .load-dot {
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: var(--rose);
      animation: builder-pulse 1s ease-in-out infinite alternate;
    }
    @keyframes builder-pulse {
      to {
        opacity: 0.35;
        transform: scale(0.78);
      }
    }
    .btn {
      min-height: 48px;
    }
    button:focus-visible,
    a:focus-visible {
      outline: 3px solid var(--rose);
      outline-offset: 2px;
    }
    @media (max-width: 1200px) and (min-width: 801px) {
      .builder-layout {
        grid-template-columns: minmax(470px, 1fr) minmax(390px, 0.82fr);
      }
      .section-inspector__actions {
        grid-template-columns: 1fr 1fr;
      }
      .reorder-controls {
        grid-column: 1 / -1;
      }
      .preview-head {
        align-items: stretch;
        flex-direction: column;
      }
      .preview-head__actions {
        justify-content: space-between;
      }
    }
    @media (max-width: 800px) {
      .builder-page {
        padding-inline: 12px;
        padding-bottom: calc(150px + env(safe-area-inset-bottom));
      }
      .builder-guide {
        grid-template-columns: auto minmax(0, 1fr);
        gap: 8px 10px;
        padding: 12px;
      }
      .mobile-tabs {
        position: sticky;
        z-index: 7;
        top: var(--appbar-h);
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 4px;
        margin: 0 0 12px;
        padding: 4px;
        border: 1px solid var(--line);
        border-radius: 14px;
        background: var(--surface);
        box-shadow: var(--sh-1);
      }
      .mobile-tabs button {
        min-height: 48px;
        border: 0;
        border-radius: 10px;
        background: transparent;
        color: var(--muted);
        font-size: 14px;
        font-weight: 750;
      }
      .mobile-tabs button.active {
        background: var(--rose-soft);
        color: var(--rose-dark);
      }
      .builder-layout {
        display: block;
      }
      .builder-layout[data-mobile-tab='edit'] .preview-pane,
      .builder-layout[data-mobile-tab='preview'] .builder-controls {
        display: none;
      }
      .status-card {
        grid-template-columns: auto minmax(0, 1fr);
      }
      .status-card time {
        grid-column: 2;
        white-space: normal;
      }
      .section-editor__head {
        flex-direction: column;
      }
      .section-rail {
        margin-inline: -1px;
        padding-inline: 12px;
        scroll-padding-inline: 12px;
      }
      .section-chip {
        width: 72vw;
        min-width: 72vw;
        flex-basis: 72vw;
        min-height: 104px;
      }
      .section-inspector {
        margin-inline: 12px;
        padding: 14px;
      }
      .section-inspector > header {
        grid-template-columns: auto minmax(0, 1fr);
      }
      .fixed-badge,
      .visibility-toggle {
        grid-column: 2;
        justify-self: start;
      }
      .section-inspector__actions {
        grid-template-columns: 1fr;
      }
      .reorder-controls {
        grid-column: auto;
      }
      .inline-edit-button,
      .context-link {
        font-size: 13px;
      }
      .inline-copy__notice {
        align-items: stretch;
        flex-direction: column;
      }
      .inline-copy__notice > button {
        width: 100%;
      }
      .builder-actions {
        position: fixed;
        right: 0;
        bottom: 0;
        left: 0;
        grid-template-columns: 1fr 1fr;
        margin: 0;
        padding: 9px 12px calc(9px + env(safe-area-inset-bottom));
        border-width: 1px 0 0;
        border-radius: 0;
      }
      .builder-layout[data-mobile-tab='preview'] + .builder-actions {
        position: static;
        margin-top: 10px;
        padding: 12px;
        border-width: 1px;
        border-radius: 14px;
      }
      .builder-actions > div {
        grid-column: 1 / -1;
      }
      .builder-actions .btn {
        width: 100%;
        min-width: 0;
        padding-inline: 8px;
        font-size: 12px;
      }
      .undo-button {
        display: none;
      }
      .preview-pane {
        position: static;
      }
      .preview-head {
        align-items: stretch;
        flex-direction: column;
      }
      .preview-head__actions {
        justify-content: space-between;
      }
      .preview-head .btn {
        flex: 1;
      }
      .preview-frame {
        height: calc(100vh - var(--appbar-h) - 228px);
        height: calc(100dvh - var(--appbar-h) - 228px);
        min-height: 500px;
        border-radius: 14px;
      }
      .preview-stage[data-device='mobile'] {
        padding: 0;
      }
      .preview-stage[data-device='mobile'] .preview-frame {
        width: 100%;
        border-radius: 14px;
      }
      .preview-failed > div {
        display: grid;
        width: 100%;
        max-width: 320px;
        grid-template-columns: 1fr;
      }
      .preview-failed .btn {
        width: 100%;
      }
      .conflict-card,
      .error-card {
        align-items: stretch;
        flex-direction: column;
      }
      .conflict-card .btn,
      .error-card .btn {
        min-height: 48px;
      }
      .error-card__actions {
        display: grid;
        grid-template-columns: 1fr;
      }
      .error-card__actions .btn {
        width: 100%;
      }
    }
    @media (max-width: 420px) {
      .builder-actions {
        grid-template-columns: 1fr;
      }
      .section-number {
        width: 42px;
        height: 42px;
      }
      .reorder-controls {
        grid-template-columns: 1fr;
      }
      .preview-head__actions {
        align-items: stretch;
        flex-direction: column;
      }
      .device-switch {
        display: grid;
        grid-template-columns: 1fr 1fr;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .load-dot {
        animation: none;
      }
      .preview-frame {
        transition: none;
      }
    }
  `,
})
export class WebsiteBuilderPage implements HasUnsavedChanges {
  private readonly catalog = inject(CatalogApi);
  private readonly ui = inject(Ui);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly destroyRef = inject(DestroyRef);

  readonly previewBaseUrl = environment.websitePreviewUrl;
  readonly previewSiteLabel =
    environment.environmentLabel === 'TEST'
      ? 'Testsite'
      : environment.environmentLabel === 'LOCAL'
        ? 'Lokale website'
        : 'Website';
  readonly previewSiteName = this.previewSiteLabel.toLocaleLowerCase('nl-BE');
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
  readonly mobileTab = signal<'edit' | 'preview'>('edit');
  readonly previewDevice = signal<'auto' | 'mobile'>('auto');
  readonly selectedSectionIndex = signal(0);
  readonly copyEditorOpen = signal(false);
  readonly copyDirty = signal(false);
  readonly copyBusy = signal(false);
  readonly reorderAnnouncement = signal('');
  readonly previewNonce = signal(0);
  readonly previewAnchor = signal('hero');
  readonly previewLoaded = signal(false);
  readonly previewError = signal<string | null>(null);
  readonly syncRefreshKey = signal(0);
  private previewWatch: ReturnType<typeof setTimeout> | null = null;

  readonly busy = computed(
    () => this.loading() || this.saving() || this.publishing() || this.copyBusy(),
  );
  readonly dirty = computed(() => this.baseline() !== JSON.stringify(this.sections()));
  readonly selectedSection = computed(() => this.sections()[this.selectedSectionIndex()] ?? null);
  readonly selectedSectionIsPublished = computed(() => {
    const selected = this.selectedSection();
    const snapshot = this.snapshot();
    if (!selected || !snapshot) return false;
    return !!snapshot.published.sections.find((section) => section.key === selected.key)?.enabled;
  });
  readonly hasUnpublishedChanges = computed(() => {
    const snapshot = this.snapshot();
    return (
      !!snapshot &&
      JSON.stringify(this.normalize(snapshot.published.sections)) !==
        JSON.stringify(this.sections())
    );
  });
  readonly activeSectionCount = computed(
    () => this.sections().filter((section) => section.enabled).length,
  );
  readonly previewUrl = computed<SafeResourceUrl>(() => {
    const separator = this.previewBaseUrl.includes('?') ? '&' : '?';
    const anchor = this.previewAnchor();
    const hash = anchor ? `#${encodeURIComponent(anchor)}` : '';
    return this.sanitizer.bypassSecurityTrustResourceUrl(
      `${this.previewBaseUrl}${separator}builderPreview=${this.previewNonce()}${hash}`,
    );
  });
  readonly draftStatusTitle = computed(() => {
    if (this.dirty()) return 'Indeling nog niet opgeslagen';
    if (this.hasUnpublishedChanges()) return 'Conceptindeling opgeslagen';
    return 'Homepage-indeling is live';
  });
  readonly draftStatusDetail = computed(() => {
    if (this.dirty()) return 'Sla het concept op of publiceer meteen.';
    if (this.hasUnpublishedChanges()) return 'Publiceer wanneer de volgorde klaar is.';
    return 'Concept en gepubliceerde indeling zijn gelijk.';
  });
  readonly actionBarTitle = computed(() => {
    if (this.copyDirty()) return 'Tekstwijziging nog niet opgeslagen';
    if (this.dirty()) return 'Indeling nog niet opgeslagen';
    if (this.hasUnpublishedChanges()) return 'Concept klaar om te publiceren';
    return 'Homepage-indeling is live';
  });
  readonly actionBarDetail = computed(() => {
    if (this.copyDirty()) return 'Sla de tekst eerst op in de inline editor.';
    if (this.dirty()) return 'Bewaar als concept of publiceer de indeling meteen.';
    if (this.hasUnpublishedChanges()) return 'Publiceren maakt de conceptvolgorde zichtbaar.';
    return 'Selecteer een blok om tekst, volgorde of zichtbaarheid aan te passen.';
  });

  constructor() {
    this.destroyRef.onDestroy(() => this.clearPreviewWatch());
    void this.load();
  }

  definition(key: WebsiteBuilderSectionKey): SectionDefinition {
    return SECTION_DEFINITIONS.find((section) => section.key === key)!;
  }

  positionLabel(index: number): string {
    return String(index + 1).padStart(2, '0');
  }

  setMobileTab(tab: 'edit' | 'preview'): void {
    this.mobileTab.set(tab);
    if (tab === 'preview' && !this.previewLoaded()) this.refreshPreview();
  }

  onMobileTabKeydown(event: KeyboardEvent, current: 'edit' | 'preview'): void {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === 'Home'
        ? 'edit'
        : event.key === 'End'
          ? 'preview'
          : current === 'edit'
            ? 'preview'
            : 'edit';
    this.setMobileTab(next);
    queueMicrotask(() => document.getElementById(`builder-${next}-tab`)?.focus());
  }

  selectSection(index: number): void {
    if (this.copyDirty() || this.copyBusy()) {
      this.ui.toast('Sla de geopende tekst eerst op voordat u van blok wisselt.', 'err');
      return;
    }
    if (index < 0 || index >= this.sections().length) return;
    this.copyEditorOpen.set(false);
    this.selectedSectionIndex.set(index);
    this.syncPreviewAnchor();
    this.previewError.set(null);
  }

  canMoveUp(index: number): boolean {
    return index > 1 && !this.definition(this.sections()[index].key).fixed;
  }

  canMoveDown(index: number): boolean {
    return (
      index > 0 &&
      index < this.sections().length - 2 &&
      !this.definition(this.sections()[index].key).fixed
    );
  }

  move(index: number, direction: -1 | 1): void {
    const target = index + direction;
    if (this.busy() || target < 1 || target >= this.sections().length - 1) return;
    const label = this.definition(this.sections()[index].key).label;
    this.sections.update((sections) => {
      const next = sections.map((section) => ({ ...section }));
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    this.selectedSectionIndex.set(target);
    this.reorderAnnouncement.set(
      `${label} staat nu op positie ${target + 1} van ${this.sections().length}.`,
    );
    this.resetActionState();
  }

  toggle(index: number): void {
    if (this.busy()) return;
    this.sections.update((sections) =>
      sections.map((section, current) =>
        current === index && !this.definition(section.key).fixed
          ? { ...section, enabled: !section.enabled }
          : section,
      ),
    );
    this.resetActionState();
  }

  toggleCopyEditor(): void {
    if (this.copyEditorOpen()) {
      this.closeCopyEditor();
      return;
    }
    this.copyDirty.set(false);
    this.copyEditorOpen.set(true);
  }

  closeCopyEditor(): void {
    if (this.copyDirty() || this.copyBusy()) {
      this.ui.toast('Sla de tekst op of wis de wijziging in de editor.', 'err');
      return;
    }
    this.copyEditorOpen.set(false);
  }

  onCopySaved(): void {
    this.syncRefreshKey.update((value) => value + 1);
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

  async saveDraft(): Promise<void> {
    const snapshot = this.snapshot();
    if (!snapshot || !this.dirty() || this.busy()) return;
    this.saving.set(true);
    this.resetActionState();
    this.lastAction.set('save');
    try {
      const saved = await this.catalog.saveWebsiteBuilderHomepage(
        snapshot.revision,
        this.sections(),
      );
      this.applySnapshot(saved);
      this.ui.toast('Homepageconcept opgeslagen');
    } catch (failure: unknown) {
      this.handleActionFailure(failure, 'Websiteconcept opslaan mislukt.');
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
      if (this.dirty()) {
        snapshot = await this.catalog.saveWebsiteBuilderHomepage(
          snapshot.revision,
          this.sections(),
        );
        this.applySnapshot(snapshot);
      }
      this.lastAction.set('publish');
      const published = await this.catalog.publishWebsiteBuilderHomepage(snapshot.revision);
      this.applySnapshot(published);
      this.syncRefreshKey.update((value) => value + 1);
      this.refreshPreview();
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
    this.ui.confirm(
      {
        title: 'Conceptindeling herstellen',
        message: 'Alle niet-opgeslagen wijzigingen aan volgorde en zichtbaarheid worden gewist.',
        confirmLabel: 'Concept herstellen',
        danger: true,
      },
      () => {
        const baseline = JSON.parse(this.baseline()) as WebsiteBuilderSection[];
        this.sections.set(baseline.map((section) => ({ ...section })));
        this.selectedSectionIndex.set(
          Math.max(
            0,
            baseline.findIndex((section) => section.key === selectedKey),
          ),
        );
        this.resetActionState();
        this.ui.toast('Niet-opgeslagen indeling hersteld');
      },
    );
  }

  reloadLatest(): void {
    if (!this.dirty()) {
      void this.load();
      return;
    }
    this.ui.confirm(
      {
        title: 'Nieuwste versie laden',
        message: 'Uw niet-opgeslagen wijzigingen worden vervangen door de nieuwste versie.',
        confirmLabel: 'Nieuwste versie laden',
        danger: true,
      },
      () => void this.load(),
    );
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
    this.previewError.set(
      `Ververs het voorbeeld of open de ${this.previewSiteName} apart om de buildmelding te bekijken.`,
    );
  }

  private startPreviewWatch(): void {
    this.clearPreviewWatch();
    this.previewLoaded.set(false);
    this.previewError.set(null);
    this.previewWatch = setTimeout(() => {
      this.previewWatch = null;
      if (!this.previewLoaded()) {
        this.previewError.set(
          `De ${this.previewSiteName} bleef te lang laden. De websitebuild kan nog bezig zijn of een fout bevatten.`,
        );
      }
    }, 15_000);
  }

  private clearPreviewWatch(): void {
    if (this.previewWatch === null) return;
    clearTimeout(this.previewWatch);
    this.previewWatch = null;
  }

  formatMoment(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'op een onbekend tijdstip';
    return new Intl.DateTimeFormat('nl-BE', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(date);
  }

  canDeactivate(): boolean {
    if (this.saving() || this.publishing() || this.copyBusy()) return false;
    if (!this.dirty() && !this.copyDirty()) return true;
    return window.confirm(
      this.copyDirty()
        ? 'U heeft websitetekst die nog niet is opgeslagen. Toch verlaten?'
        : 'U heeft een website-indeling die nog niet is opgeslagen. Toch verlaten?',
    );
  }

  @HostListener('window:beforeunload', ['$event'])
  warnBeforeUnload(event: BeforeUnloadEvent): void {
    if (
      !this.dirty() &&
      !this.copyDirty() &&
      !this.saving() &&
      !this.publishing() &&
      !this.copyBusy()
    )
      return;
    event.preventDefault();
    event.returnValue = '';
  }

  @HostListener('window:keydown', ['$event'])
  saveShortcut(event: KeyboardEvent): void {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return;
    if (!this.dirty() || this.copyDirty() || this.busy()) return;
    event.preventDefault();
    void this.saveDraft();
  }

  private applySnapshot(snapshot: WebsiteBuilderHomepage): void {
    const selectedKey = this.selectedSection()?.key ?? 'hero';
    const sections = this.normalize(snapshot.draft.sections);
    this.snapshot.set({
      ...snapshot,
      draft: { sections },
      published: { sections: this.normalize(snapshot.published.sections) },
    });
    this.sections.set(sections.map((section) => ({ ...section })));
    const selectedIndex = sections.findIndex((section) => section.key === selectedKey);
    this.selectedSectionIndex.set(selectedIndex >= 0 ? selectedIndex : 0);
    this.syncPreviewAnchor();
    this.baseline.set(JSON.stringify(sections));
    this.loadError.set(null);
    this.resetActionState();
    if (window.matchMedia('(min-width: 801px)').matches && !this.previewLoaded()) {
      this.startPreviewWatch();
    }
  }

  private normalize(input: WebsiteBuilderSection[]): WebsiteBuilderSection[] {
    const unique = new Map<WebsiteBuilderSectionKey, boolean>();
    for (const section of input ?? []) {
      if (SECTION_KEYS.has(section.key) && !unique.has(section.key)) {
        unique.set(section.key, !!section.enabled);
      }
    }
    const middle: WebsiteBuilderSection[] = [];
    for (const section of input ?? []) {
      if (
        section.key === 'hero' ||
        section.key === 'quote' ||
        !SECTION_KEYS.has(section.key) ||
        middle.some((item) => item.key === section.key)
      )
        continue;
      middle.push({ key: section.key, enabled: unique.get(section.key) ?? true });
    }
    for (const definition of SECTION_DEFINITIONS) {
      if (definition.fixed || middle.some((section) => section.key === definition.key)) continue;
      middle.push({ key: definition.key, enabled: unique.get(definition.key) ?? true });
    }
    return [{ key: 'hero', enabled: true }, ...middle, { key: 'quote', enabled: true }];
  }

  private syncPreviewAnchor(): void {
    const selected = this.selectedSection();
    this.previewAnchor.set(
      selected && this.selectedSectionIsPublished()
        ? this.definition(selected.key).previewAnchor
        : '',
    );
  }

  private handleActionFailure(failure: unknown, fallback: string): void {
    const conflict = isRevisionConflict(failure);
    this.conflict.set(conflict);
    this.actionError.set(
      conflict
        ? 'Laad de nieuwste versie en controleer uw wijzigingen opnieuw.'
        : messageOf(failure, fallback),
    );
  }

  private resetActionState(): void {
    this.actionError.set(null);
    this.conflict.set(false);
    this.lastAction.set(null);
  }
}
