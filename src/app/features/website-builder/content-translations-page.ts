import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  ViewEncapsulation,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Location, NgTemplateOutlet } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HasUnsavedChanges } from '../../core/guards/unsaved-changes.guard';
import { ContentTranslationGroup, LANGUAGES, LanguageCode } from '../../core/api/models';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { NavHistory } from '../../core/platform/nav-history-service';
import { capsuleLabel, screenLabel } from '../../core/platform/return-label';
import { ContextMenu, ContextMenuItem } from '../../shared/context-menu';
import { Icon } from '../../shared/icon';
import { IosNav } from '../../shared/ios-nav';
import { LoadError } from '../../shared/load-error';
import { PageHeader } from '../../shared/page-header';
import { SegmentOption, Segmented } from '../../shared/segmented';
import { Skeleton } from '../../shared/skeleton';
import { Ui, confirmLeave } from '../../shared/ui';
import { ContentTranslationWorkspace } from '../settings/content-translation-workspace';
import { WebsiteSyncStatus } from '../settings/website-sync-status';
import { WebsiteSyncStore } from '../settings/website-sync-store';
import { WEBSITE_LANGUAGE_ORDER, missingPerLanguage, plural } from './website-attention';
import { WebsitePhoneBack } from './website-phone-back';
import { SeoFilter, WebsiteProductSeoAudit, productSeoRows } from './website-product-seo-audit';
import { WebsiteStatusBar } from './website-status-bar';
import { WebsiteStore } from './website-store';
import { textsBackTarget } from './website-texts-nav';
import { displayLabel, groupByArea, homeSubArea, websiteTextArea, websiteTextAreas } from './website-text-areas';

const LANGUAGE_COUNT = WEBSITE_LANGUAGE_ORDER.length;

/**
 * Teksten (/website/texts) and SEO (/website/seo) of Website beheren, and
 * Cataloguslabels (/catalog/texts, catalogMode: unchanged apart from the
 * shared copy fixes). On the desk the translation workspace in its split
 * layout under a kit toolbar; on the phone three views in the address
 * (parts, ?gebied= area, ?key= editor) with the editor's save bar above the
 * tab bar. SEO adds the product SEO table (Productpagina’s) next to the
 * page SEO texts (Algemene pagina’s, the workspace locked to "meta").
 */
@Component({
  selector: 'app-content-translations-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrls: ['../../../styles/website-workspace.scss', '../../../styles/website-texts.scss', '../../../styles/website-texts-page.scss'],
  imports: [ContentTranslationWorkspace, ContextMenu, Icon, IosNav, LoadError, NgTemplateOutlet, PageHeader, RouterLink, Segmented, Skeleton, WebsiteProductSeoAudit, WebsiteStatusBar, WebsiteSyncStatus],
  template: `
    @if (catalogMode) {
      <app-page-header title="Cataloguslabels" subtitle="Algemene labels voor de PDF-catalogus, los van de website."
                       [showBack]="true" [backTo]="returnTo" [showBell]="false" />
      <main class="content ct-catalog">
        <section class="ct-catalog__guide" role="note">
          <span>PDF-catalogus</span>
          <b>Deze labels verschijnen rond producten in de catalogus.</b>
          <small>Productnamen en productteksten worden niet op deze pagina gewijzigd.</small>
        </section>
        <app-content-translation-workspace [visible]="true" title="Cataloguslabels"
          [description]="'Labels voor de PDF-catalogus in ' + languageCount + ' talen. Productspecifieke inhoud blijft bij het product.'"
          initialScope="CATALOG" initialPrefix="ALL" [initialLanguage]="initialLanguage" [initialKey]="initialKey"
          [lockScope]="true" [lockPrefix]="false" [allowAdvanced]="true"
          (dirtyChange)="dirty.set($event)" (busyChange)="busy.set($event)" />
      </main>
    } @else if (desk.active()) {
      <div class="wk-page ws-page ws-texts-page">
        <header class="wk-toolbar">
          <div class="wk-toolbar__lead">
            <h1 class="wk-toolbar__title">{{ seoMode ? 'SEO' : 'Teksten' }}</h1>
            <span class="ws-sub" [class.ws-warn-text]="!seoMode && counts().textsMissing > 0" [attr.title]="subtitleLong()">
              <span class="ws-long">{{ subtitleLong() }}</span><span class="ws-short">{{ subtitleShort() }}</span>
            </span>
          </div>
          <div class="wk-toolbar__tools">
            @if (seoMode) {
              <app-segmented label="Soort pagina" semantics="tabs" [options]="seoTabs()" [value]="seoTab()" (changed)="setSeoTab($any($event))" />
            } @else {
              <app-segmented label="Tekstgroepen" [options]="textFilters()" [value]="textFilter()" (changed)="setTextFilter($any($event))" />
            }
            <label class="wk-search wk-search--collapsible ws-texts-search">
              <app-icon name="search" [size]="15" />
              <input type="search" data-page-search [placeholder]="seoMode && seoTab() === 'producten' ? 'Zoek reeks of SEO-titel' : 'Zoek in naam of tekst'"
                     aria-label="Zoeken" [value]="query()" (input)="query.set($any($event.target).value)" (keydown.escape)="query.set('')" />
              <span class="wk-kbd" aria-hidden="true">/</span>
            </label>
            @if (seoMode) {
              <a class="wk-btn" routerLink="/analyses/website">Zoekcijfers ›</a>
            } @else {
              <button class="wk-btn wk-btn--ghost" type="button" [attr.aria-pressed]="advanced()" (click)="advanced.set(!advanced())">
                <app-icon name="settings" [size]="15" />Geavanceerd
              </button>
            }
          </div>
        </header>
        <div class="wk-notices">
          @if (seoMode && seoTab() === 'producten') {
            <div class="ws-filterbar">
              <div class="wk-chips" role="group" aria-label="Filter">
                @for (option of seoFilterOptions(); track option.id) {
                  <button class="wk-chip" type="button" [attr.aria-pressed]="seoFilter() === option.id" (click)="seoFilter.set(option.id)">
                    {{ option.label }} <span class="ws-chip-count">{{ option.count }}</span>
                  </button>
                }
              </div>
              @if (store.families()) { <span class="ws-filter-count">{{ seoCounts().ok }} van {{ plural(seoCounts().total, 'reeks', 'reeksen') }} zonder aandachtspunt</span> }
            </div>
          } @else if (!seoMode && perLanguage().length) {
            <div class="ws-filterbar ws-langbar">
              <span class="ws-langbar__label">Ontbreekt per taal:</span>
              <div class="wk-chips" role="group" aria-label="Ontbreekt per taal">
                @for (row of perLanguage(); track row.code) {
                  <button class="wk-chip tone-warn" type="button" [attr.aria-pressed]="language() === row.code" (click)="filterLanguage(row.code)">{{ row.code }} {{ row.missing }}</button>
                }
              </div>
            </div>
          }
        </div>
        <div class="wk-body">
          @if (seoMode && seoTab() === 'producten') {
            <div class="wk-pane"><div class="ws-scroll">
              <app-website-product-seo-audit layout="desk" [filter]="seoFilter()" [query]="query()" />
            </div></div>
          } @else {
            <app-content-translation-workspace layout="split" [visible]="true" initialScope="WEBSITE" [lockScope]="true"
              [initialPrefix]="seoMode ? 'meta' : 'ALL'" [lockPrefix]="seoMode" [allowAdvanced]="!seoMode"
              [initialLanguage]="initialLanguage" [initialKey]="routeKey()" [searchQuery]="query()"
              [onlyMissing]="textFilter() === 'missing'" [missingLanguage]="language()" [showAdvanced]="advanced()"
              (dirtyChange)="dirty.set($event)" (busyChange)="busy.set($event)" (contentSaved)="saved()" (selectedKeyChange)="keyChanged($event)"
              (advancedChange)="advanced.set($event)" />
          }
        </div>
        <app-website-status-bar [text]="statusText()" [hint]="seoMode && seoTab() === 'producten' ? '/ zoeken' : '↑↓ groep · [ ] taal · ⌘S opslaan · / zoeken'" />
      </div>
    } @else {
      <div class="ios-page ws-ios ws-texts-ios">
        @switch (view()) {
          @case ('editor') {
            <!-- the two-line title (label / languages) sits centred under the bar and wraps in full; once it scrolls away the bar shows the label small, between the back capsule and "…" -->
            <app-ios-nav class="ws-ph-ednav" [title]="editorTitle()" [customLarge]="true" [backLabel]="editorBack().label" [backAriaLabel]="'Terug naar ' + editorBack().name" (back)="goBack()">
              <button trail class="ios-circle" type="button" aria-label="Meer voor deze tekstgroep" [disabled]="busy()" (click)="editorMenu.set(true)"><app-icon name="more" [size]="20" /></button>
              <div hero class="ws-ph-edhead"><h1>{{ editorTitle() }}</h1><small>{{ editorSub() }}</small></div>
            </app-ios-nav>
          }
          @case ('area') {
            <app-ios-nav [title]="areaLabel()" [backLabel]="seoMode ? 'Overzicht' : 'Teksten'" [backAriaLabel]="'Terug naar ' + (seoMode ? 'Overzicht' : 'Teksten')" (back)="goBack()" />
            @if (seoMode) {
              <div class="ws-ph-seg"><app-segmented variant="ios" label="Soort pagina" semantics="tabs" [options]="seoTabsPhone()" [value]="seoTab()" (changed)="setSeoTab($any($event))" /></div>
            }
          }
          @default {
            @if (seoMode) {
              <app-ios-nav title="SEO" [subtitle]="seoLiveLine()" backLabel="Overzicht" backAriaLabel="Terug naar Overzicht" (back)="leaveSeo()">
                <div below class="ios-subbar ws-ph-subbar">
                  <app-segmented variant="ios" label="Soort pagina" semantics="tabs" [options]="seoTabsPhone()" [value]="seoTab()" (changed)="setSeoTab($any($event))" />
                  <div class="ios-search ws-ph-search"><span class="ios-search__field"><app-icon name="search" [size]="16" />
                    <input type="search" placeholder="Zoek reeks of SEO-titel" aria-label="Zoek reeks of SEO-titel" [value]="query()" (input)="query.set($any($event.target).value)" /></span></div>
                </div>
              </app-ios-nav>
            } @else {
              <app-ios-nav title="Teksten" [subtitle]="subtitleLong()" [backLabel]="back.label()" [backUrl]="back.url()" [backAriaLabel]="back.aria()">
                <div below class="ios-subbar">
                  <div class="ios-search"><span class="ios-search__field"><app-icon name="search" [size]="16" />
                    <input type="search" placeholder="Zoek in naam of tekst" aria-label="Zoek in naam of tekst" [value]="query()" (input)="query.set($any($event.target).value)" /></span></div>
                </div>
              </app-ios-nav>
            }
          }
        }
        @if (view() !== 'editor') { <app-website-sync-status variant="banner" /> }
        <!-- one wrapper per view (a @switch case each), so every push and pop animates; the editor lives outside them -->
        @switch (view()) {
          @case ('parts') { <div class="ws-ph-view" [class]="'ws-ph-view ' + viewMotion()"><ng-container *ngTemplateOutlet="phoneList; context: { $implicit: 'parts' }" /></div> }
          @case ('area') { <div class="ws-ph-view" [class]="'ws-ph-view ' + viewMotion()"><ng-container *ngTemplateOutlet="phoneList; context: { $implicit: 'area' }" /></div> }
        }
        @if (editorKey()) {
          <!-- mounted once opened (a dirty text survives a step back); outside the views and never animated while dirty, so its fixed save bar never moves -->
          <div class="ws-ph-editor" [class]="'ws-ph-editor ' + (view() !== 'editor' ? 'ws-ct-parked' : dirty() ? '' : viewMotion())">
            <app-content-translation-workspace layout="inline" [visible]="true" initialScope="WEBSITE" [lockScope]="true" [allowAdvanced]="true"
              [keyPrefixes]="[editorKey()!]" [initialKey]="editorKey()" [initialLanguage]="initialLanguage" [missingLanguage]="language()"
              (dirtyChange)="dirty.set($event)" (busyChange)="busy.set($event)" (contentSaved)="saved()" />
          </div>
        }
      </div>
    }

    @if (editorMenu()) {
      <app-context-menu title="Tekstgroep" variant="ios" cancelLabel="Annuleren" [items]="editorMenuItems()"
                        (pick)="editorAction($event)" (closed)="editorMenu.set(false)" />
    }

    <ng-template #phoneList let-current>
      @if (seoMode && seoTab() === 'producten') {
        @if (store.families()) {
          <div class="ios-chips ws-ph-chips" role="group" aria-label="Filter">
            @for (option of seoFilterOptions(); track option.id) {
              <button class="ios-chip" type="button" [attr.aria-pressed]="seoFilter() === option.id" (click)="seoFilter.set(option.id)">
                {{ option.label }} <span class="ws-chip-count">{{ option.count }}</span>
              </button>
            }
          </div>
        }
        <app-website-product-seo-audit layout="phone" [filter]="seoFilter()" [query]="query()" />
      } @else if (store.errors().content && !store.content()) {
        <app-load-error title="Teksten konden niet worden geladen" [message]="store.errors().content!" [busy]="store.isLoading('content')" (retry)="store.refresh(['content'])" />
      } @else if (!store.content()) {
        <app-skeleton kind="group" [rows]="8" />
      } @else {
        @switch (current) {
          @case ('parts') {
            @if (query().trim()) {
              <section class="ios-section"><div class="ios-group">
                @for (group of searchHits(); track group.key) {
                  <button class="ios-cell" type="button" (click)="openGroup(group)">
                    <span class="ios-cell__body"><span class="ios-cell__title ios-cell__title--2">{{ labelOf(group) }}</span><span class="ios-cell__sub">{{ areaOf(group) }}</span></span>
                    <ng-container *ngTemplateOutlet="groupValue; context: { $implicit: group }" />
                  </button>
                } @empty { <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__sub">Geen tekstgroepen voor deze zoekopdracht.</span></span></div> }
              </div></section>
            } @else {
              @if (perLanguage().length) {
                <div class="ios-banner" role="status"><span>Ontbreekt per taal:
                  @for (row of perLanguage(); track row.code) { <button class="ws-ph-lang" type="button" (click)="filterLanguage(row.code)">{{ row.code }} {{ row.missing }}</button> }</span></div>
              }
              <section class="ios-section"><div class="ios-group">
                @for (part of parts(); track part.key) {
                  <button class="ios-cell" type="button" (click)="openArea(part.key)">
                    <span class="ios-cell__body"><span class="ios-cell__title">{{ part.label }}</span></span>
                    <span class="ios-cell__value" [class.ws-warn-text]="part.missing > 0">{{ part.missing ? plural(part.missing, 'ontbreekt', 'ontbreken') : part.total + ' ✓' }}</span>
                    <app-icon class="ios-cell__chev" name="chevron-right" [size]="18" />
                  </button>
                }
              </div></section>
            }
          }
          @case ('area') {
            @for (sub of areaSections(); track sub.label) {
              <section class="ios-section">
                @if (sub.label) { <div class="ios-section__head"><h2>{{ sub.label }}</h2></div> }
                <div class="ios-group">
                  @for (group of sub.groups; track group.key) {
                    <button class="ios-cell" type="button" (click)="openGroup(group)">
                      <span class="ios-cell__body"><span class="ios-cell__title ios-cell__title--2">{{ labelOf(group) }}</span><span class="ios-cell__sub" [attr.title]="dutchOf(group)">{{ dutchOf(group) }}</span></span>
                      <ng-container *ngTemplateOutlet="groupValue; context: { $implicit: group }" />
                    </button>
                  }
                </div>
              </section>
            }
          }
        }
      }
    </ng-template>

    <ng-template #groupValue let-group>
      <span class="ios-cell__value" [class.ws-warn-text]="group.required && group.missingLanguages.length">
        {{ !group.required ? 'opt.' : group.missingLanguages.length ? group.missingLanguages.length + ' leeg' : languageCount + '/' + languageCount }}
      </span>
      <app-icon class="ios-cell__chev" name="chevron-right" [size]="18" />
    </ng-template>
  `,
})
export class ContentTranslationsPage implements HasUnsavedChanges {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly ui = inject(Ui);
  private readonly location = inject(Location);
  private readonly nav = inject(NavHistory);
  private readonly sync = inject(WebsiteSyncStore);
  readonly desk = inject(DesktopViewport);
  readonly store = inject(WebsiteStore);
  readonly back = inject(WebsitePhoneBack);
  private readonly workspace = viewChild(ContentTranslationWorkspace);

  readonly seoMode = this.route.snapshot.data['seoMode'] === true;
  readonly catalogMode = this.route.snapshot.data['catalogMode'] === true;
  readonly languageCount = LANGUAGE_COUNT;
  readonly plural = plural;
  readonly initialLanguage = this.queryLanguage();
  readonly initialKey = this.route.snapshot.queryParamMap.get('key')?.trim() || null;
  readonly returnTo = this.safeInternalRoute(this.route.snapshot.queryParamMap.get('returnTo'), '/catalog-export');
  /** The phone editor's way back when it was opened from elsewhere (a homepage block): internal paths only. */
  private readonly returnPath = this.safeInternalRoute(this.route.snapshot.queryParamMap.get('returnTo'), '');
  readonly dirty = signal(false);
  readonly busy = signal(false);
  readonly query = signal('');
  readonly advanced = signal(false);
  /** The phone editor's "…" menu: Vertaalopdracht kopiëren and Geavanceerd (design §3.4). */
  readonly editorMenu = signal(false);
  readonly textFilter = signal<'all' | 'missing'>('all');
  readonly language = signal<LanguageCode | null>(null);
  readonly seoFilter = signal<SeoFilter>('aandacht');
  readonly viewMotion = signal('');

  private readonly params = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
  readonly routeKey = computed(() => this.params().get('key')?.trim() || null);
  readonly seoTab = computed<'producten' | 'paginas'>(() => this.params().get('tab') === 'paginas' ? 'paginas' : 'producten');
  /** Phone views live in the address: ?key= editor, ?gebied= area, else the parts. */
  readonly view = computed<'parts' | 'area' | 'editor'>(() => this.routeKey() ? 'editor'
    : this.params().get('gebied') || (this.seoMode && this.seoTab() === 'paginas') ? 'area' : 'parts');
  readonly areaKey = computed(() => this.seoMode ? 'meta' : this.params().get('gebied'));
  /** The editor stays mounted once opened, so a dirty text survives a step back (critique N11.3). */
  readonly editorKey = signal<string | null>(this.routeKey());

  readonly counts = this.store.counts;
  readonly perLanguage = computed(() => missingPerLanguage(this.store.groups()));
  readonly subtitleLong = computed(() => {
    if (this.seoMode) return this.seoLiveLine();
    if (!this.store.content()) return '';
    const counts = this.counts();
    const base = `${plural(counts.textGroups, 'tekstgroep', 'tekstgroepen')} · ${LANGUAGE_COUNT} talen · ${counts.textsPercent} % compleet`;
    return counts.textsMissing ? `${base} · ${plural(counts.textsMissing, 'verplicht veld', 'verplichte velden')} leeg` : base;
  });
  readonly subtitleShort = computed(() => {
    if (this.seoMode) return this.seoLiveLine();
    if (!this.store.content()) return '';
    return `${this.counts().textGroups} groepen · ${this.counts().textsPercent} %`;
  });
  readonly seoLiveLine = computed(() => this.store.families()
    ? `Live: ${this.counts().seoLiveTotal - this.counts().seoLiveAttention} / ${this.counts().seoLiveTotal} in orde` : '');
  readonly seoCounts = computed(() => {
    const rows = productSeoRows(this.store.families() ?? []);
    const attention = rows.filter((row) => row.attention).length;
    return { total: rows.length, attention, ok: rows.length - attention };
  });
  readonly seoFilterOptions = computed(() => [
    { id: 'aandacht' as const, label: 'Aandacht', count: this.seoCounts().attention },
    { id: 'alles' as const, label: 'Alles', count: this.seoCounts().total },
    { id: 'inorde' as const, label: 'In orde', count: this.seoCounts().ok },
  ]);
  readonly metaCount = computed(() => this.store.groups().filter((group) => websiteTextArea(group.key).key === 'meta').length);
  readonly seoTabs = computed<SegmentOption[]>(() => [
    { id: 'producten', label: 'Productpagina’s', shortLabel: 'Producten', count: this.store.families() ? this.seoCounts().total : null },
    { id: 'paginas', label: 'Algemene pagina’s', shortLabel: 'Pagina’s', count: this.store.content() ? this.metaCount() : null },
  ]);
  readonly seoTabsPhone = computed<SegmentOption[]>(() => [{ id: 'producten', label: 'Producten' }, { id: 'paginas', label: 'Pagina’s' }]);
  readonly textFilters = computed<SegmentOption[]>(() => [
    { id: 'all', label: 'Alle', count: this.store.content() ? this.counts().textGroups : null },
    { id: 'missing', label: 'Ontbreekt', count: this.store.content() ? this.store.groups().filter((group) => group.required && group.missingLanguages.length).length : null,
      dot: this.counts().textsMissing ? 'warn' : null },
  ]);
  readonly statusText = computed(() => {
    if (this.seoMode) {
      return this.store.families() ? `${this.seoCounts().ok} / ${this.seoCounts().total} reeksen zonder aandachtspunt` : '';
    }
    if (!this.store.content()) return '';
    const required = this.store.groups().filter((group) => group.required).length;
    const complete = WEBSITE_LANGUAGE_ORDER.every((code) => !this.perLanguage().some((row) => row.code === code));
    return `Alle ${LANGUAGE_COUNT} talen: ${complete ? `${required} van ${required}` : 'niet compleet'} · ${plural(this.counts().textsMissing, 'verplicht veld', 'verplichte velden')} leeg`;
  });

  /* ---- phone lists */
  readonly parts = computed(() => {
    const sections = groupByArea(this.store.groups());
    return sections.map((section) => ({ key: section.area.key, label: section.area.label, total: section.groups.length,
      missing: section.groups.filter((group) => group.required && group.missingLanguages.length).length }));
  });
  readonly areaLabel = computed(() => {
    const key = this.areaKey();
    return websiteTextAreas().find((area) => area.key === key)?.label ?? 'Overig';
  });
  readonly areaSections = computed(() => {
    const key = this.areaKey();
    const groups = this.store.groups().filter((group) => websiteTextArea(group.key).key === key);
    if (key !== 'home') return [{ label: '', groups }];
    const sections = new Map<string, ContentTranslationGroup[]>();
    for (const group of groupByArea(groups)[0]?.groups ?? []) {
      const label = homeSubArea(group.key)?.label ?? 'Overig';
      sections.set(label, [...(sections.get(label) ?? []), group]);
    }
    return [...sections.entries()].map(([label, list]) => ({ label, groups: list }));
  });
  readonly searchHits = computed(() => {
    const needle = this.normalize(this.query());
    return needle ? this.store.groups().filter((group) => this.normalize(`${group.label} ${group.key} ${group.texts.map((text) => text.value ?? '').join(' ')}`).includes(needle)).slice(0, 60) : [];
  });
  private readonly editorGroup = computed(() => this.store.groups().find((group) => group.key === this.editorKey()) ?? null);
  readonly editorTitle = computed(() => {
    const group = this.editorGroup();
    return group ? displayLabel(group) : 'Tekst';
  });
  readonly editorSub = computed(() => {
    const group = this.editorGroup();
    return group ? `${LANGUAGE_COUNT - group.missingLanguages.length} van ${LANGUAGE_COUNT} talen` : '';
  });
  /**
   * Back from the editor, named for where it goes: the page it came from
   * (returnTo, e.g. a homepage block), the Teksten list it was opened from
   * (search hits, the language banner), else its site part (design §3.4).
   */
  readonly editorBack = computed(() => {
    if (this.returnPath) {
      const name = screenLabel(this.returnPath) === 'Website' && this.returnPath.startsWith('/website/layout') ? 'Homepage' : screenLabel(this.returnPath) || 'Terug';
      return { name, label: capsuleLabel(name) };
    }
    if (this.pushedFrom() === 'parts' && !this.seoMode) return { name: 'Teksten', label: 'Teksten' };
    const group = this.editorGroup();
    const name = group ? websiteTextArea(group.key).label : 'Teksten';
    return { name, label: capsuleLabel(name) };
  });
  /** The phone list the editor was pushed from, or null when it was opened by a link. */
  private readonly pushedFrom = signal<'parts' | 'area' | null>(null);

  constructor() {
    if (!this.catalogMode) void this.store.ensure(this.seoMode ? ['families', 'content'] : ['content']);
    /* The phone editor follows the address (back and forward) while nothing is pending. */
    effect(() => {
      const key = this.routeKey();
      untracked(() => { if (key && !this.dirty() && key !== this.editorKey()) this.editorKey.set(key); });
    });
  }

  @HostListener('document:keydown', ['$event'])
  onKey(event: KeyboardEvent): void {
    if (this.catalogMode || !this.desk.active() || event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [contenteditable="true"]') || document.querySelector('.overlay')) return;
    event.preventDefault();
    document.querySelector<HTMLInputElement>('.ws-texts-search input')?.focus();
  }

  canDeactivate(): boolean | Promise<boolean> {
    if (this.busy()) return false;
    if (!this.dirty()) return true;
    const workspace = this.workspace();
    return confirmLeave(this.ui, workspace ? async () => {
      await workspace.saveSelected();
      return !workspace.hasPendingChanges();
    } : undefined);
  }

  @HostListener('window:beforeunload', ['$event'])
  warnBeforeUnload(event: BeforeUnloadEvent): void {
    if (!this.dirty() && !this.busy()) return;
    event.preventDefault();
    event.returnValue = '';
  }

  setTextFilter(filter: 'all' | 'missing'): void {
    this.textFilter.set(filter);
    if (filter === 'all') this.language.set(null);
  }

  /** A language chip of "Ontbreekt per taal": that language, only what misses it. */
  filterLanguage(code: LanguageCode): void {
    const same = this.language() === code;
    this.language.set(same ? null : code);
    this.textFilter.set(same ? 'all' : 'missing');
    if (!this.desk.active() && !same) {
      const first = this.store.groups().find((group) => group.required && group.missingLanguages.includes(code));
      if (first) this.openGroup(first);
    }
  }

  /**
   * Productpagina’s · Algemene pagina’s. A query change does not run
   * canDeactivate, and on the desk the switch removes the text editor: an
   * unsaved text holds the switch, with the same toast as another group.
   */
  setSeoTab(tab: 'producten' | 'paginas'): void {
    if (tab === this.seoTab() || this.busy()) return;
    if (this.dirty()) {
      this.ui.toast('Sla de tekst eerst op of herstel de wijziging.', 'err');
      return;
    }
    this.viewMotion.set('');
    void this.router.navigate([], { relativeTo: this.route, queryParams: { tab, key: null, gebied: null }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  /** A saved, created or deleted group (the workspace patched the store): the website update it started shows in the status. */
  saved(): void {
    void this.sync.load();
  }

  editorMenuItems(): ContextMenuItem[] {
    const open = this.workspace()?.advancedOpen() ?? false;
    return [
      { id: 'copy', label: 'Vertaalopdracht kopiëren', iconName: 'copy' },
      { id: 'advanced', label: open ? 'Geavanceerd verbergen' : 'Geavanceerd', hint: 'Sleutel, revisie, verplicht in alle talen', iconName: 'settings' },
    ];
  }

  editorAction(item: ContextMenuItem): void {
    this.editorMenu.set(false);
    const workspace = this.workspace();
    if (!workspace) return;
    if (item.id === 'copy') void workspace.copySelectedCodexBrief();
    else if (item.id === 'advanced') workspace.advancedOpen.update((open) => !open);
  }

  /** The selected group goes into the address without building history. */
  keyChanged(key: string | null): void {
    if (!this.desk.active() || key === this.routeKey()) return;
    void this.router.navigate([], { relativeTo: this.route, queryParams: { key }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  openArea(key: string): void {
    this.viewMotion.set('mo-push-view');
    void this.router.navigate([], { relativeTo: this.route, queryParams: { gebied: key }, queryParamsHandling: 'merge' });
  }

  openGroup(group: ContentTranslationGroup): void {
    if (this.dirty() && this.editorKey() !== group.key) {
      this.ui.toast('Sla de tekst eerst op of herstel de wijziging.', 'err');
      return;
    }
    this.pushedFrom.set(this.view() === 'area' ? 'area' : 'parts');
    this.editorKey.set(group.key);
    this.viewMotion.set('mo-push-view');
    /* SEO's page texts live under ?tab=paginas, which is their list already. */
    const gebied = this.seoMode ? null : websiteTextArea(group.key).key;
    void this.router.navigate([], { relativeTo: this.route, queryParams: { key: group.key, gebied }, queryParamsHandling: 'merge' });
  }

  /**
   * Back goes where the control says (critique N11.2): the returnTo page,
   * the list the editor was pushed from, the editor's site part, or the
   * Teksten list. When that screen is the entry below, history goes back
   * (no duplicate entry); otherwise the address is replaced (never a loop).
   */
  goBack(): void {
    this.viewMotion.set('mo-pop-view');
    const key = this.editorKey();
    const target = textsBackTarget({ view: this.view(), seoMode: this.seoMode, returnPath: this.returnPath,
      pushedFrom: this.pushedFrom(), editorArea: key ? websiteTextArea(key).key : null });
    const url = target.kind === 'url' ? target.url : this.urlWith(target.query);
    this.backTo(url, url !== '/website');
  }

  /** SEO's back control on both of its tabs: Overzicht (a new entry, like the other tab roots, unless it is the one below). */
  leaveSeo(): void {
    this.backTo('/website', false);
  }

  private backTo(url: string, replaceUrl = true): void {
    if (this.nav.below() === url) this.location.back();
    else void this.router.navigateByUrl(url, { replaceUrl });
  }

  private urlWith(queryParams: Record<string, string | null>): string {
    return this.router.createUrlTree([], { relativeTo: this.route, queryParams, queryParamsHandling: 'merge' }).toString();
  }

  labelOf(group: ContentTranslationGroup): string {
    return displayLabel(group);
  }

  areaOf(group: ContentTranslationGroup): string {
    const sub = homeSubArea(group.key)?.label;
    return sub ? `${websiteTextArea(group.key).label} · ${sub}` : websiteTextArea(group.key).label;
  }

  dutchOf(group: ContentTranslationGroup): string {
    return group.texts.find((text) => text.language === 'NL')?.value?.replace(/\s+/g, ' ').trim() || 'Nog geen Nederlandse tekst';
  }

  private normalize(value: string): string {
    return value.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }

  private queryLanguage(): LanguageCode {
    const requested = this.route.snapshot.queryParamMap.get('language')?.toUpperCase();
    return LANGUAGES.some((language) => language.code === requested) ? requested as LanguageCode : 'NL';
  }

  private safeInternalRoute(value: string | null, fallback: string): string {
    return value?.startsWith('/') && !value.startsWith('//') ? value : fallback;
  }
}
