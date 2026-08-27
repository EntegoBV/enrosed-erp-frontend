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
import { WebsiteSyncStatus } from '../settings/website-sync-status';
import { environment } from '../../../environments/environment';

interface SectionDefinition {
  key: WebsiteBuilderSectionKey;
  label: string;
  description: string;
  fixed?: boolean;
}

const SECTION_DEFINITIONS: readonly SectionDefinition[] = [
  { key: 'hero', label: 'Openingsbeeld', description: 'Het eerste beeld en de hoofdboodschap.', fixed: true },
  { key: 'range', label: 'Ons assortiment', description: 'Een snelle introductie van de productreeksen.' },
  { key: 'order', label: 'Zo bestelt u', description: 'De stappen van aanvraag tot levering.' },
  { key: 'counter', label: 'Counterdisplays', description: 'Producten die direct op de toonbank kunnen.' },
  { key: 'flowerbox', label: 'Glass bowls & flowerboxes', description: 'Bestsellers; houd de glazen presentaties prominent en hoog op de homepage.' },
  { key: 'soap', label: 'Zeep- en foamrozen', description: 'Ondersteunende collectie; geen hoofdrol ten koste van de bestsellers.' },
  { key: 'occasion', label: 'Kleine cadeaus', description: 'Compacte producten voor een klein gebaar.' },
  { key: 'retail', label: 'Geschikt voor retail', description: 'Mogelijke verkoopomgevingen en toepassingen.' },
  { key: 'faq', label: 'Veelgestelde vragen', description: 'Praktische antwoorden voor professionele klanten.' },
  { key: 'catalog', label: 'Volledige collectie', description: 'De complete productcatalogus.' },
  { key: 'quote', label: 'Offerte aanvragen', description: 'Het vaste contactblok onderaan de pagina.', fixed: true },
] as const;

const SECTION_KEYS = new Set<WebsiteBuilderSectionKey>(
  SECTION_DEFINITIONS.map((section) => section.key),
);

@Component({
  selector: 'app-website-builder-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeader, WebsiteSyncStatus],
  template: `
    <app-page-header
      title="Homepage-indeling"
      subtitle="Bepaal de volgorde, zichtbaarheid en controleer het desktopvoorbeeld."
      [showBell]="false"
    >
      <a class="btn btn--sm" [href]="previewBaseUrl" target="_blank" rel="noopener">
        {{ previewSiteLabel }} openen
      </a>
    </app-page-header>

    <main class="content builder-page">
      <section class="merchandising-note" role="note">
        <div>
          <b>Glass bowls eerst</b>
          <span>Dit is de bestseller. Zet Glass bowls &amp; flowerboxes prominent; zeep- en foamrozen zijn ondersteunend.</span>
        </div>
        <small>
          Deze pagina bepaalt alleen volgorde en zichtbaarheid. Een collectiebeeld kiest u via
          Categorieën &amp; menu; vaste homepage-highlights volgen de websitecomponent.
        </small>
      </section>

      <nav class="mobile-tabs" aria-label="Website-builder weergave">
        <button type="button" [class.active]="mobileTab() === 'edit'"
                [attr.aria-pressed]="mobileTab() === 'edit'" (click)="mobileTab.set('edit')">
          Bewerken
        </button>
        <button type="button" [class.active]="mobileTab() === 'preview'"
                [attr.aria-pressed]="mobileTab() === 'preview'" (click)="mobileTab.set('preview')">
          Voorbeeld
        </button>
      </nav>

      @if (loading() && !snapshot()) {
        <section class="load-state card" role="status">
          <span class="load-dot" aria-hidden="true"></span>
          <div><b>Website-indeling laden…</b><small>Een ogenblik.</small></div>
        </section>
      } @else if (loadError() && !snapshot()) {
        <section class="load-state load-state--error card" role="alert">
          <div><b>Website-indeling kon niet worden geladen</b><small>{{ loadError() }}</small></div>
          <button class="btn btn--primary" type="button" (click)="load()">Opnieuw proberen</button>
        </section>
      } @else if (snapshot()) {
        <div class="builder-layout" [attr.data-mobile-tab]="mobileTab()">
          <section class="builder-pane builder-controls" aria-label="Website-indeling bewerken">
            <section class="status-card card" aria-live="polite">
              <span class="status-mark" [class.status-mark--pending]="dirty() || hasUnpublishedChanges()"
                    aria-hidden="true"></span>
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
                <div><b>{{ lastAction() === 'publish' ? 'Publiceren mislukt' : 'Opslaan mislukt' }}</b><small>{{ actionError() }}</small></div>
                <div class="error-card__actions">
                  <button class="btn" type="button" [disabled]="busy()" (click)="reloadLatest()">
                    Laatste versie laden
                  </button>
                  @if (lastAction() === 'publish') {
                    <button class="btn btn--primary" type="button" [disabled]="busy()"
                            (click)="publish()">Opnieuw publiceren</button>
                  } @else {
                    <button class="btn btn--primary" type="button" [disabled]="busy() || !dirty()"
                            (click)="saveDraft()">Opnieuw opslaan</button>
                  }
                </div>
              </section>
            }

            <section class="card section-editor" aria-labelledby="sections-title">
              <div class="card__head section-editor__head">
                <div>
                  <h2 id="sections-title">Onderdelen op de homepage</h2>
                  <p>Gebruik de pijlen voor de volgorde. Een verborgen onderdeel blijft bewaard.</p>
                </div>
                <span>{{ visibleSectionCount() }} zichtbaar</span>
              </div>

              <fieldset class="section-list" [disabled]="busy()" [attr.aria-busy]="busy()">
                <legend class="sr-only">Volgorde en zichtbaarheid van homepage-onderdelen</legend>
                @for (section of sections(); track section.key; let index = $index) {
                  <article class="section-row" [class.section-row--hidden]="!section.enabled">
                    <div class="section-order" role="group" [attr.aria-label]="'Volgorde van ' + definition(section.key).label">
                      <button type="button" [disabled]="!canMoveUp(index)" (click)="move(index, -1)"
                              [attr.aria-label]="definition(section.key).label + ' omhoog'" title="Omhoog">
                        ↑
                      </button>
                      <button type="button" [disabled]="!canMoveDown(index)" (click)="move(index, 1)"
                              [attr.aria-label]="definition(section.key).label + ' omlaag'" title="Omlaag">
                        ↓
                      </button>
                    </div>
                    <div class="section-copy">
                      <b>{{ definition(section.key).label }}</b>
                      <small>{{ definition(section.key).description }}</small>
                    </div>
                    @if (definition(section.key).fixed) {
                      <span class="fixed-badge">Altijd zichtbaar</span>
                    } @else {
                      <button class="visibility-toggle" type="button" role="switch"
                              [attr.aria-checked]="section.enabled" (click)="toggle(index)">
                        <span aria-hidden="true"></span>
                        {{ section.enabled ? 'Zichtbaar' : 'Verborgen' }}
                      </button>
                    }
                  </article>
                }
              </fieldset>
            </section>

            <app-website-sync-status [refreshKey]="syncRefreshKey()" />

            <div class="builder-actions" [attr.aria-busy]="busy()">
              <div>
                <b>{{ dirty() ? 'Wijzigingen nog niet opgeslagen' : 'Concept opgeslagen' }}</b>
                <small>Publiceren maakt het concept zichtbaar op de {{ previewSiteName }}.</small>
              </div>
              <button class="btn" type="button" [disabled]="!dirty() || busy()" (click)="saveDraft()">
                {{ saving() ? 'Opslaan…' : 'Concept opslaan' }}
              </button>
              <button class="btn btn--primary" type="button"
                      [disabled]="(!dirty() && !hasUnpublishedChanges()) || busy()" (click)="publish()">
                {{ publishing() ? 'Publiceren…' : (dirty() ? 'Opslaan & publiceren' : 'Publiceren') }}
              </button>
            </div>
          </section>

          <aside class="builder-pane preview-pane" aria-labelledby="preview-title">
            <div class="preview-head">
              <div>
                <span>Live {{ previewSiteName }}</span>
                <h2 id="preview-title">Voorbeeld van de website</h2>
                <small>Na publiceren kan de nieuwe build enkele minuten duren.</small>
              </div>
              <button class="btn" type="button" (click)="refreshPreview()">Voorbeeld verversen</button>
            </div>
            <div class="preview-frame" [class.preview-frame--loaded]="previewLoaded() && !previewError()">
              @if (previewError()) {
                <div class="preview-failed" role="alert">
                  <span aria-hidden="true">!</span>
                  <b>Het websitevoorbeeld reageert niet</b>
                  <small>{{ previewError() }}</small>
                  <div>
                    <button class="btn" type="button" (click)="refreshPreview()">Opnieuw laden</button>
                    <a class="btn btn--primary" [href]="previewBaseUrl" target="_blank" rel="noopener">
                      {{ previewSiteLabel }} openen ↗
                    </a>
                  </div>
                </div>
              } @else if (!previewLoaded()) {
                <div class="preview-loading" role="status">{{ previewSiteLabel }} laden…</div>
              }
              <iframe [src]="previewUrl()" [title]="'Live voorbeeld van de Enrosed ' + previewSiteName"
                      loading="lazy" referrerpolicy="strict-origin-when-cross-origin"
                      (load)="markPreviewLoaded()" (error)="markPreviewFailed()"></iframe>
            </div>
            <a class="preview-external" [href]="previewBaseUrl" target="_blank" rel="noopener">
              Open de {{ previewSiteName }} in een nieuw venster <span aria-hidden="true">↗</span>
            </a>
          </aside>
        </div>
      }
    </main>
  `,
  styles: `
    :host { display: block; }
    .builder-page { max-width: 1540px; padding-bottom: calc(112px + env(safe-area-inset-bottom)); }
    .merchandising-note {
      display: grid; grid-template-columns: minmax(0, .8fr) minmax(360px, 1.2fr); gap: 18px;
      margin-bottom: 16px; padding: 14px 16px; border: 1px solid var(--rose-line);
      border-radius: var(--r-sm); background: var(--rose-soft);
    }
    .merchandising-note > div { display: grid; gap: 2px; }
    .merchandising-note b { color: var(--rose-dark); font-size: 16px; }
    .merchandising-note span, .merchandising-note small { color: var(--ink-2); font-size: 14px; line-height: 1.45; }
    .merchandising-note small { align-self: center; color: var(--muted); }
    .mobile-tabs { display: none; }
    .builder-layout { display: grid; grid-template-columns: minmax(520px, .92fr) minmax(460px, 1.08fr); gap: 18px; align-items: start; }
    .builder-pane { min-width: 0; }
    .builder-controls { display: grid; gap: 16px; }
    .status-card { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 15px 16px; }
    .status-card > div { display: grid; gap: 2px; }
    .status-card b { font-size: 15px; }
    .status-card small, .status-card time { color: var(--muted); font-size: 13px; line-height: 1.45; }
    .status-card time { white-space: nowrap; }
    .status-mark { width: 12px; height: 12px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 0 5px var(--ok-soft); }
    .status-mark--pending { background: var(--warn); box-shadow: 0 0 0 5px var(--warn-soft); }
    .conflict-card, .error-card { padding: 14px; border: 1px solid var(--danger); border-radius: var(--r-sm); background: var(--danger-soft); color: var(--danger); }
    .conflict-card { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
    .conflict-card > div { display: grid; gap: 2px; }
    .conflict-card small { font-size: 13px; line-height: 1.45; }
    .error-card { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
    .error-card > div:first-child { display: grid; gap: 3px; }
    .error-card small { color: var(--muted); font-size: 14px; line-height: 1.45; }
    .error-card__actions { display: flex; flex: none; gap: 8px; }
    .error-card .btn { min-height: 48px; }
    .section-editor { overflow: hidden; }
    .section-editor__head { align-items: flex-start; gap: 14px; }
    .section-editor__head h2, .preview-head h2 { font-size: 19px; line-height: 1.2; }
    .section-editor__head p { margin-top: 4px; color: var(--muted); font-size: 14px; line-height: 1.45; }
    .section-editor__head > span { flex: none; padding: 7px 10px; border-radius: 999px; background: var(--rose-soft); color: var(--rose-dark); font-size: 13px; font-weight: 750; }
    .section-list { min-inline-size: 0; margin: 0; padding: 0 14px 14px; border: 0; }
    .section-row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 12px; min-height: 74px; padding: 10px 0; border-top: 1px solid var(--line); }
    .section-row--hidden .section-copy { opacity: .58; }
    .section-order { display: grid; grid-template-columns: 48px 48px; gap: 5px; }
    .section-order button { width: 48px; height: 48px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface-2); color: var(--ink); font-size: 20px; font-weight: 700; cursor: pointer; }
    .section-order button:disabled { opacity: .28; cursor: default; }
    .section-copy { display: grid; gap: 3px; min-width: 0; }
    .section-copy b { font-size: 15px; }
    .section-copy small { color: var(--muted); font-size: 13px; line-height: 1.4; }
    .fixed-badge { padding: 7px 10px; border-radius: 999px; background: var(--surface-2); color: var(--muted); font-size: 13px; font-weight: 700; white-space: nowrap; }
    .visibility-toggle { display: inline-flex; min-width: 122px; min-height: 48px; align-items: center; justify-content: center; gap: 8px; padding: 8px 12px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface-2); color: var(--muted); font-size: 13px; font-weight: 750; cursor: pointer; }
    .visibility-toggle span { width: 10px; height: 10px; border-radius: 50%; background: var(--muted-2); }
    .visibility-toggle[aria-checked='true'] { border-color: var(--ok); background: var(--ok-soft); color: var(--ok); }
    .visibility-toggle[aria-checked='true'] span { background: var(--ok); }
    .builder-actions { position: sticky; z-index: 4; bottom: 10px; display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 9px; padding: 12px; border: 1px solid var(--line-strong); border-radius: 16px; background: var(--surface); box-shadow: var(--sh-2); }
    .builder-actions > div { display: grid; gap: 2px; }
    .builder-actions b { font-size: 14px; }
    .builder-actions small { color: var(--muted); font-size: 13px; }
    .builder-actions .btn { min-height: 48px; }
    .preview-pane { position: sticky; top: calc(var(--appbar-h) + 14px); display: grid; gap: 10px; }
    .preview-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; padding-inline: 2px; }
    .preview-head > div { display: grid; gap: 2px; }
    .preview-head > div > span { color: var(--rose-dark); font-size: 12px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
    .preview-head small { color: var(--muted); font-size: 13px; }
    .preview-head .btn { min-height: 48px; }
    .preview-frame { position: relative; height: calc(100vh - var(--appbar-h) - 125px); height: calc(100dvh - var(--appbar-h) - 125px); min-height: 590px; overflow: hidden; border: 1px solid var(--line-strong); border-radius: 18px; background: #100b09; box-shadow: var(--sh-2); }
    .preview-frame iframe { display: block; width: 100%; height: 100%; border: 0; background: #fff; opacity: 0; }
    .preview-frame--loaded iframe { opacity: 1; }
    .preview-loading { position: absolute; inset: 0; display: grid; place-items: center; color: #e8ded7; font-size: 14px; }
    .preview-failed { position:absolute;z-index:2;inset:0;display:flex;align-items:center;justify-content:center;
      flex-direction:column;gap:8px;padding:24px;background:#100b09;color:#fff;text-align:center }
    .preview-failed>span { display:grid;width:48px;height:48px;place-items:center;border-radius:16px;
      background:rgb(255 255 255/.1);color:#ffd1c8;font-size:20px;font-weight:800 }
    .preview-failed b { font-size:18px }
    .preview-failed small { max-width:420px;color:#d5c9c3;font-size:14px;line-height:1.45 }
    .preview-failed>div { display:flex;justify-content:center;flex-wrap:wrap;gap:8px;margin-top:5px }
    .preview-external { min-height: 48px; display: flex; align-items: center; justify-content: center; gap: 7px; color: var(--rose-dark); font-size: 14px; font-weight: 700; text-decoration: none; }
    .load-state { display: flex; min-height: 160px; align-items: center; justify-content: center; gap: 12px; padding: 24px; }
    .load-state > div { display: grid; gap: 3px; }
    .load-state small { color: var(--muted); }
    .load-state--error { justify-content: space-between; color: var(--danger); }
    .load-dot { width: 14px; height: 14px; border-radius: 50%; background: var(--rose); animation: builder-pulse 1s ease-in-out infinite alternate; }
    @keyframes builder-pulse { to { opacity: .35; transform: scale(.78); } }
    .btn { min-height: 48px; }
    button:focus-visible, a:focus-visible { outline: 3px solid var(--rose); outline-offset: 2px; }

    @media (max-width: 1100px) and (min-width: 801px) {
      .builder-layout { grid-template-columns: minmax(470px, 1fr) minmax(380px, .88fr); }
    }

    @media (max-width: 800px) {
      .builder-page { padding-inline: 12px; padding-bottom: calc(126px + env(safe-area-inset-bottom)); }
      .merchandising-note { grid-template-columns: 1fr; gap: 7px; }
      .mobile-tabs { position: sticky; z-index: 6; top: var(--appbar-h); display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin: 0 0 12px; padding: 4px; border: 1px solid var(--line); border-radius: 14px; background: var(--surface); box-shadow: var(--sh-1); }
      .mobile-tabs button { min-height: 48px; border: 0; border-radius: 10px; background: transparent; color: var(--muted); font-size: 15px; font-weight: 750; }
      .mobile-tabs button.active { background: var(--rose-soft); color: var(--rose-dark); }
      .builder-layout { display: block; }
      .builder-layout[data-mobile-tab='edit'] .preview-pane,
      .builder-layout[data-mobile-tab='preview'] .builder-controls { display: none; }
      .status-card { grid-template-columns: auto minmax(0, 1fr); }
      .status-card time { grid-column: 2; white-space: normal; }
      .section-editor__head { flex-direction: column; }
      .section-row { grid-template-columns: 101px minmax(0, 1fr); gap: 10px; padding-block: 12px; }
      .section-order { grid-template-columns: 48px 48px; }
      .section-order button { width: 48px; height: 48px; }
      .fixed-badge, .visibility-toggle { grid-column: 2; justify-self: start; }
      .visibility-toggle { min-width: 148px; }
      .builder-actions { position: fixed; right: 0; bottom: 0; left: 0; grid-template-columns: 1fr 1fr; padding: 10px 12px calc(10px + env(safe-area-inset-bottom)); border-width: 1px 0 0; border-radius: 0; }
      .builder-actions > div { grid-column: 1 / -1; }
      .builder-actions .btn { width: 100%; }
      .preview-pane { position: static; }
      .preview-head { align-items: flex-start; flex-direction: column; }
      .preview-head .btn { width: 100%; }
      .preview-frame { height: calc(100vh - var(--appbar-h) - 195px); height: calc(100dvh - var(--appbar-h) - 195px); min-height: 480px; border-radius: 14px; }
      .preview-failed>div { display:grid;width:100%;max-width:320px;grid-template-columns:1fr }
      .preview-failed .btn { width:100% }
      .conflict-card, .error-card { align-items: stretch; flex-direction: column; }
      .conflict-card .btn, .error-card .btn { min-height: 48px; }
      .error-card__actions { display: grid; grid-template-columns: 1fr; }
      .error-card__actions .btn { width: 100%; }
    }

    @media (prefers-reduced-motion: reduce) {
      .load-dot { animation: none; }
    }
  `,
})
export class WebsiteBuilderPage implements HasUnsavedChanges {
  private readonly catalog = inject(CatalogApi);
  private readonly ui = inject(Ui);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly destroyRef = inject(DestroyRef);

  readonly previewBaseUrl = environment.websitePreviewUrl;
  readonly previewSiteLabel = environment.environmentLabel === 'TEST'
    ? 'Testsite'
    : environment.environmentLabel === 'LOCAL' ? 'Lokale website' : 'Website';
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
  readonly previewNonce = signal(0);
  readonly previewLoaded = signal(false);
  readonly previewError = signal<string | null>(null);
  readonly syncRefreshKey = signal(0);
  private previewWatch: ReturnType<typeof setTimeout> | null = null;

  readonly busy = computed(() => this.loading() || this.saving() || this.publishing());
  readonly dirty = computed(() => this.baseline() !== JSON.stringify(this.sections()));
  readonly hasUnpublishedChanges = computed(() => {
    const snapshot = this.snapshot();
    return !!snapshot && JSON.stringify(this.normalize(snapshot.published.sections))
      !== JSON.stringify(this.sections());
  });
  readonly visibleSectionCount = computed(() =>
    this.sections().filter((section) => section.enabled).length,
  );
  readonly previewUrl = computed<SafeResourceUrl>(() => {
    const separator = this.previewBaseUrl.includes('?') ? '&' : '?';
    return this.sanitizer.bypassSecurityTrustResourceUrl(
      `${this.previewBaseUrl}${separator}builderPreview=${this.previewNonce()}`,
    );
  });
  readonly draftStatusTitle = computed(() => {
    if (this.dirty()) return 'Wijzigingen nog niet opgeslagen';
    if (this.hasUnpublishedChanges()) return 'Concept opgeslagen';
    return 'Website-indeling is live';
  });
  readonly draftStatusDetail = computed(() => {
    if (this.dirty()) return 'Sla het concept op of publiceer meteen.';
    if (this.hasUnpublishedChanges()) return 'Publiceer wanneer u klaar bent.';
    return 'Concept en gepubliceerde versie zijn gelijk.';
  });

  constructor() {
    this.destroyRef.onDestroy(() => this.clearPreviewWatch());
    void this.load();
  }

  definition(key: WebsiteBuilderSectionKey): SectionDefinition {
    return SECTION_DEFINITIONS.find((section) => section.key === key)!;
  }

  canMoveUp(index: number): boolean {
    return index > 1 && !this.definition(this.sections()[index].key).fixed;
  }

  canMoveDown(index: number): boolean {
    return index > 0 && index < this.sections().length - 2
      && !this.definition(this.sections()[index].key).fixed;
  }

  move(index: number, direction: -1 | 1): void {
    const target = index + direction;
    if (this.busy() || target < 1 || target >= this.sections().length - 1) return;
    this.sections.update((sections) => {
      const next = sections.map((section) => ({ ...section }));
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    this.resetActionState();
  }

  toggle(index: number): void {
    if (this.busy()) return;
    this.sections.update((sections) => sections.map((section, current) =>
      current === index && !this.definition(section.key).fixed
        ? { ...section, enabled: !section.enabled }
        : section,
    ));
    this.resetActionState();
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
      this.ui.toast('Websiteconcept opgeslagen');
    } catch (failure: unknown) {
      this.handleActionFailure(failure, 'Websiteconcept opslaan mislukt.');
    } finally {
      this.saving.set(false);
    }
  }

  async publish(): Promise<void> {
    let snapshot = this.snapshot();
    if (!snapshot || this.busy()) return;
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
      this.ui.toast('Website-indeling gepubliceerd');
    } catch (failure: unknown) {
      this.handleActionFailure(failure, 'Website publiceren mislukt.');
    } finally {
      this.publishing.set(false);
    }
  }

  reloadLatest(): void {
    if (!this.dirty()) {
      void this.load();
      return;
    }
    this.ui.confirm({
      title: 'Nieuwste versie laden',
      message: 'Uw niet-opgeslagen wijzigingen worden vervangen door de nieuwste versie.',
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
          `De ${this.previewSiteName} bleef te lang laden. De Vercel-build kan nog bezig zijn of een fout bevatten.`,
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
    if (this.saving() || this.publishing()) return false;
    if (!this.dirty()) return true;
    return window.confirm('U heeft een website-indeling die nog niet is opgeslagen. Toch verlaten?');
  }

  @HostListener('window:beforeunload', ['$event'])
  warnBeforeUnload(event: BeforeUnloadEvent): void {
    if (!this.dirty() && !this.saving() && !this.publishing()) return;
    event.preventDefault();
    event.returnValue = '';
  }

  private applySnapshot(snapshot: WebsiteBuilderHomepage): void {
    const sections = this.normalize(snapshot.draft.sections);
    this.snapshot.set({
      ...snapshot,
      draft: { sections },
      published: { sections: this.normalize(snapshot.published.sections) },
    });
    this.sections.set(sections.map((section) => ({ ...section })));
    this.baseline.set(JSON.stringify(sections));
    this.loadError.set(null);
    this.resetActionState();
    if (!this.previewLoaded()) this.startPreviewWatch();
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
      if (section.key === 'hero' || section.key === 'quote'
          || !SECTION_KEYS.has(section.key) || middle.some((item) => item.key === section.key)) continue;
      middle.push({ key: section.key, enabled: unique.get(section.key) ?? true });
    }
    for (const definition of SECTION_DEFINITIONS) {
      if (definition.fixed || middle.some((section) => section.key === definition.key)) continue;
      middle.push({ key: definition.key, enabled: unique.get(definition.key) ?? true });
    }
    return [
      { key: 'hero', enabled: true },
      ...middle,
      { key: 'quote', enabled: true },
    ];
  }

  private handleActionFailure(failure: unknown, fallback: string): void {
    const conflict = isRevisionConflict(failure);
    this.conflict.set(conflict);
    this.actionError.set(conflict
      ? 'Laad de nieuwste versie en controleer uw wijzigingen opnieuw.'
      : messageOf(failure, fallback));
  }

  private resetActionState(): void {
    this.actionError.set(null);
    this.conflict.set(false);
    this.lastAction.set(null);
  }
}
