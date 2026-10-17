import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { Icon } from '../../shared/icon';
import { IosNav } from '../../shared/ios-nav';
import { Skeleton } from '../../shared/skeleton';
import { websiteSyncCopy } from '../settings/website-sync-copy';
import { WebsiteSyncStatus } from '../settings/website-sync-status';
import { WebsiteSyncStore } from '../settings/website-sync-store';
import { TODO_SECTION_ORDER, WEBSITE_LANGUAGE_ORDER, plural } from './website-attention';
import { langsColumn, todoCardHeight } from './website-overview-balance';
import { WebsitePhoneBack } from './website-phone-back';
import { WebsiteRecent } from './website-recent';
import { WebsiteStatusBar } from './website-status-bar';
import { WebsiteStore } from './website-store';
import { WebsiteTranslationQueue } from './website-translation-queue';

const SITE_NAME = environment.environmentLabel === 'TEST' ? 'testsite'
  : environment.environmentLabel === 'LOCAL' ? 'lokale website'
    : (() => { try { return new URL(environment.websitePreviewUrl).host; } catch { return 'website'; } })();

/**
 * Overzicht of Website beheren (/website): the figures of the website in
 * one strip (each a link), what has to be done (Te doen, one row per reeks,
 * category or text), what changed lately, what stands live and the texts
 * per language. All from WebsiteStore; the phone shows the same as widgets
 * and inset groups under a large title.
 */
@Component({
  selector: 'app-website-admin-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrls: ['../../../styles/website-workspace.scss', '../../../styles/website-overview.scss'],
  imports: [Icon, IosNav, NgTemplateOutlet, RouterLink, Skeleton, WebsiteRecent, WebsiteStatusBar, WebsiteSyncStatus, WebsiteTranslationQueue],
  template: `
    @if (desk.active()) {
      <div class="wk-page ws-page">
        <header class="wk-toolbar">
          <div class="wk-toolbar__lead">
            <h1 class="wk-toolbar__title">Overzicht</h1>
            <span class="ws-sub" [attr.title]="subtitle()">{{ subtitle() }}</span>
          </div>
          <div class="wk-toolbar__tools">
            <button class="wk-btn" type="button" [class.is-busy]="refreshing()" [disabled]="refreshing()" (click)="refresh()">
              <app-icon name="refresh" [size]="16" />Vernieuwen
            </button>
          </div>
        </header>

        <div class="wk-notices">
          <nav class="ws-figs" aria-label="De website in cijfers">
            <a class="ws-fig" routerLink="/website/publication">
              <span class="ws-fig__label">Website</span>
              <span class="ws-fig__value">
                @if (sync.status() || sync.loadError()) {
                  <i class="ws-dot" [class]="'ws-dot is-' + syncCopy().tone" aria-hidden="true"></i><span class="ws-long">{{ syncCopy().label }}</span><span class="ws-short">{{ syncCopy().shortLabel }}</span>
                } @else { — }
              </span>
              <span class="ws-fig__sub" [attr.title]="syncCopy().label + (syncCopy().moment ? ' · ' + syncCopy().moment : '')">{{ syncCopy().moment ?? '' }}</span>
            </a>
            <a class="ws-fig" routerLink="/website/products">
              <span class="ws-fig__label">Producten</span>
              <span class="ws-fig__value">{{ store.families() ? counts().live + ' live' : '—' }}</span>
              <span class="ws-fig__sub">
                @if (store.families()) {
                  <span class="ws-long">{{ counts().concept }} concept · {{ attentionText(counts().attention) }}</span>
                  <span class="ws-short">{{ counts().concept }} concept · {{ counts().attention }} aandacht</span>
                }
              </span>
            </a>
            <a class="ws-fig" routerLink="/website/layout">
              <span class="ws-fig__label">Homepage</span>
              @if (store.homepageSummary(); as home) {
                <span class="ws-fig__value"><span class="ws-long">{{ home.draftVisible }} van {{ home.total }} blokken</span><span class="ws-short">{{ home.draftVisible }} van {{ home.total }}</span></span>
                <span class="ws-fig__sub" [class.is-warn]="home.differs">
                  <span class="ws-long">{{ home.differs ? 'Concept klaar om te publiceren' : 'Gelijk aan live' }}</span>
                  <span class="ws-short">blokken · {{ home.differs ? 'concept klaar' : 'gelijk aan live' }}</span>
                </span>
              } @else {
                <span class="ws-fig__value">—</span><span class="ws-fig__sub"></span>
              }
            </a>
            <a class="ws-fig" routerLink="/website/texts">
              <span class="ws-fig__label">Teksten</span>
              <span class="ws-fig__value">{{ store.content() ? counts().textsPercent + ' %' : '—' }}</span>
              <span class="ws-fig__sub" [class.is-warn]="counts().textsMissing > 0">
                @if (store.content()) {
                  @if (counts().textsMissing) { {{ fieldsText(counts().textsMissing) }} }
                  @else {
                    <span class="ws-long">{{ counts().textGroups }} tekstgroepen · {{ languageCount }} talen</span>
                    <span class="ws-short">{{ counts().textGroups }} groepen · {{ languageCount }} talen</span>
                  }
                }
              </span>
            </a>
            <a class="ws-fig" routerLink="/website/seo">
              <span class="ws-fig__label">SEO</span>
              <span class="ws-fig__value">{{ store.families() ? counts().seoOk + ' / ' + counts().seoTotal : '—' }}</span>
              <span class="ws-fig__sub">@if (store.families()) { <span class="ws-long">reeksen </span>zonder aandachtspunt }</span>
            </a>
          </nav>
        </div>

        <div class="wk-body">
          <div class="wk-pane">
            <div class="ws-scroll">
              <div class="ws-cols">
                <div class="ws-col">
                  <app-website-translation-queue layout="card" />
                  @if (langsPlace() === 'left') { <ng-container *ngTemplateOutlet="langsCard" /> }
                </div>
                <div class="ws-col">
                  <section class="ws-card ws-c-live" aria-labelledby="ws-live-title">
                    <header class="ws-card-head">
                      <h2 id="ws-live-title">Live op de website</h2>
                      <span class="ws-tools"><a class="wk-link" routerLink="/website/publication">Publicatie ›</a></span>
                    </header>
                    @if (showLiveState()) {
                      <div class="ws-live" role="status">
                        <span class="ws-live__state" [class]="'ws-live__state is-' + syncCopy().tone"><i aria-hidden="true"></i>{{ syncCopy().label }}</span>
                        <span class="ws-live__detail">{{ syncCopy().detail }}@if (syncCopy().moment; as moment) { · {{ moment }} }</span>
                        @if (syncCopy().nextAttempt; as next) { <span class="ws-live__detail">{{ next }}</span> }
                        @if (syncCopy().error; as error) { <span class="ws-live__error">{{ error }}</span> }
                        @if (syncCopy().action; as action) {
                          @if (action === 'todo') {
                            <a class="wk-btn wk-btn--sm" routerLink="/website" fragment="translation-work">{{ syncCopy().actionLabel }}</a>
                          } @else {
                            <button class="wk-btn wk-btn--sm" type="button" [disabled]="sync.loading() || sync.retrying()"
                                    (click)="action === 'retry' ? sync.retry() : sync.load()">{{ syncCopy().actionLabel }}</button>
                          }
                        }
                      </div>
                    }
                    <dl class="ws-kv">
                      <div>
                        <dt>Categorieën</dt>
                        <dd>@if (store.categories(); as list) {
                          {{ list.length }} in het menu
                          <small>{{ counts().categoriesMissing ? counts().categoriesMissing + ' met ontbrekende talen' : 'Alle ' + languageCount + ' talen compleet' }}</small>
                        } @else { — }</dd>
                      </div>
                      <div>
                        <dt>Bekijken</dt>
                        <dd><a [href]="siteUrl" target="_blank" rel="noopener">{{ siteName }} <app-icon name="external" [size]="12" /></a></dd>
                      </div>
                    </dl>
                  </section>
                  <app-website-recent layout="card" [limit]="8" [fetchLimit]="8" />
                  @if (langsPlace() === 'right') { <ng-container *ngTemplateOutlet="langsCard" /> }
                </div>
              </div>
            </div>
          </div>
        </div>

        <app-website-status-bar [text]="statusLine()" />
      </div>

      <ng-template #langsCard>
        <section class="ws-card ws-c-langs" aria-labelledby="ws-langs-title">
          <header class="ws-card-head">
            <h2 id="ws-langs-title">Websiteteksten per taal</h2>
            @if (store.content()) { <span class="ws-count">{{ counts().textGroups }} groepen</span> }
          </header>
          @if (store.content()) {
            <div class="ws-langgrid">
              @for (row of perLanguage(); track row.code) {
                <div [class.is-short]="row.complete < row.total">
                  <b>{{ row.code }}@if (row.complete === row.total) {<em aria-label="compleet">✓</em>}</b>
                  <small>{{ row.complete }} van {{ row.total }}</small>
                </div>
              }
            </div>
          } @else {
            <div class="ws-scroll"><app-skeleton kind="lines" [rows]="3" /></div>
          }
        </section>
      </ng-template>
    } @else {
      <div class="ios-page ws-ios">
        <app-ios-nav title="Website" [backLabel]="back.label()" [backUrl]="back.url()" [backAriaLabel]="back.aria()">
          <app-website-sync-status caption variant="chip" />
        </app-ios-nav>
        <app-website-sync-status variant="banner" />

        <div class="ios-widgets">
          <a class="ios-widget" routerLink="/website/products" [replaceUrl]="true" [info]="tabInfo">
            <span class="ios-widget__label"><app-icon name="products" [size]="14" />Producten</span>
            <span class="ios-widget__value">{{ store.families() ? counts().live + ' live' : '—' }}</span>
            <span class="ios-widget__sub">{{ store.families() ? counts().concept + ' concept' : '' }}</span>
          </a>
          <a class="ios-widget" routerLink="/website/layout" [replaceUrl]="true" [info]="tabInfo">
            <span class="ios-widget__label"><app-icon name="layers" [size]="14" />Homepage</span>
            @if (store.homepageSummary(); as home) {
              <span class="ios-widget__value">{{ home.draftVisible }} van {{ home.total }}</span>
              <span class="ios-widget__sub">{{ home.differs ? 'Concept klaar' : 'Gelijk aan live' }}</span>
            } @else { <span class="ios-widget__value">—</span> }
          </a>
          <a class="ios-widget" routerLink="/website/texts" [replaceUrl]="true" [info]="tabInfo">
            <span class="ios-widget__label"><app-icon name="document" [size]="14" />Teksten</span>
            <span class="ios-widget__value">{{ store.content() ? counts().textsPercent + ' %' : '—' }}</span>
            <span class="ios-widget__sub">@if (store.content()) { {{ counts().textsMissing ? fieldsText(counts().textsMissing) : counts().textGroups + ' groepen · ' + languageCount + ' talen' }} }</span>
          </a>
          <a class="ios-widget" routerLink="/website/seo">
            <span class="ios-widget__label"><app-icon name="search" [size]="14" />SEO</span>
            <span class="ios-widget__value">{{ store.families() ? counts().seoOk + ' / ' + counts().seoTotal : '—' }}</span>
            <span class="ios-widget__sub">zonder aandachtspunt</span>
          </a>
        </div>

        <app-website-translation-queue layout="group" />
        <app-website-recent layout="group" [limit]="5" [fetchLimit]="5" />
      </div>
    }
  `,
})
export class WebsiteAdminPage {
  readonly desk = inject(DesktopViewport);
  readonly store = inject(WebsiteStore);
  readonly sync = inject(WebsiteSyncStore);
  readonly back = inject(WebsitePhoneBack);
  private readonly route = inject(ActivatedRoute);
  private readonly recent = viewChild(WebsiteRecent);

  readonly languageCount = WEBSITE_LANGUAGE_ORDER.length;
  readonly siteUrl = environment.websitePreviewUrl;
  readonly siteName = SITE_NAME;
  readonly tabInfo = { nav: 'tab' };
  readonly counts = this.store.counts;
  readonly refreshing = computed(() => Object.values(this.store.loading()).some(Boolean));

  readonly syncCopy = computed(() => websiteSyncCopy({
    status: this.sync.status(), loading: this.sync.loading(), loadError: this.sync.loadError(), pollEnded: this.sync.pollEnded(),
  }));
  /** The Live card repeats the state only when it is not simply live (the strip already says Live). */
  readonly showLiveState = computed(() => !!(this.sync.status() || this.sync.loadError()) && this.syncCopy().tone !== 'ok');

  readonly subtitle = computed(() => {
    const parts = [SITE_NAME];
    if (this.store.families()) parts.push(plural(this.counts().families, 'productreeks', 'productreeksen'));
    parts.push(`${this.languageCount} talen`);
    return parts.join(' · ');
  });

  readonly statusLine = computed(() => [
    this.store.families() ? plural(this.counts().families, 'productreeks', 'productreeksen') : null,
    this.store.categories() ? plural(this.store.categories()!.length, 'categorie', 'categorieën') : null,
    this.store.content() ? plural(this.counts().textGroups, 'tekstgroep', 'tekstgroepen') : null,
    this.store.homepageSummary() ? `${this.store.homepageSummary()!.total} homepageblokken` : null,
  ].filter(Boolean).join(' · '));

  readonly perLanguage = computed(() => {
    const required = this.store.groups().filter((group) => group.required);
    return WEBSITE_LANGUAGE_ORDER.map((code) => ({ code, total: required.length,
      complete: required.filter((group) => !group.missingLanguages.includes(code)).length }));
  });

  /**
   * Balance (critique N29, review round 1): Recent gewijzigd stands on the
   * right from the first frame; "Websiteteksten per taal" joins the column
   * that leaves the smaller gap (website-overview-balance.ts). Decided once,
   * when the data has answered (or failed); never reflowed afterwards.
   */
  readonly langsPlace = signal<'left' | 'right' | null>(null);

  constructor() {
    this.store.ensure();
    effect(() => {
      const parts = ['families', 'categories', 'content'] as const;
      const answered = parts.every((part) => this.store.has(part) || !!this.store.errors()[part]);
      if (!answered || this.langsPlace()) return;
      const todos = this.store.todos();
      untracked(() => {
        const sections = TODO_SECTION_ORDER.filter((section) => todos.some((row) => row.section === section)).length;
        this.langsPlace.set(langsColumn({
          todo: todoCardHeight(todos.length, sections),
          live: 48 + (this.showLiveState() ? 120 : 0) + 2 * 40,
          recent: 48 + 8 * 53,
          langs: 48 + 3 * 52,
        }));
        if (this.route.snapshot.fragment === 'translation-work' && !this.desk.active()) {
          queueMicrotask(() => document.getElementById('translation-work')?.scrollIntoView({ block: 'start' }));
        }
      });
    });
  }

  refresh(): void {
    void this.store.refresh();
    void this.sync.load();
    void this.recent()?.load();
  }

  attentionText(count: number): string {
    return `${count} ${count === 1 ? 'vraagt' : 'vragen'} aandacht`;
  }

  fieldsText(count: number): string {
    return `${plural(count, 'verplicht veld', 'verplichte velden')} leeg`;
  }
}
