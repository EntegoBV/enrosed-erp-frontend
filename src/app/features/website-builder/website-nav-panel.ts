import { ChangeDetectionStrategy, Component, DestroyRef, ViewEncapsulation, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { BrandMark } from '../../shared/brand-mark';
import { Icon } from '../../shared/icon';
import { WkSideFoot } from '../../shared/wk-side-foot';
import { isTranslationPending } from '../settings/website-sync-copy';
import { WebsiteSyncStore } from '../settings/website-sync-store';
import { WebsiteStore } from './website-store';
import { WebsiteTabbar } from './website-tabbar';

type WebsiteNavId = 'overview' | 'homepage' | 'products' | 'categories' | 'texts' | 'seo' | 'publication' | 'prices' | 'pickup';

interface WebsiteNavItem {
  id: WebsiteNavId;
  label: string;
  short: string;
  icon: string;
  link: string;
  query?: Record<string, string>;
  /** Screens of the ERP itself: they leave the workspace and are never lit here. */
  elsewhere?: boolean;
}

const WEBSITE_NAV_GROUPS: readonly { label: string | null; items: readonly WebsiteNavItem[] }[] = [
  { label: null, items: [{ id: 'overview', label: 'Overzicht', short: 'Overzicht', icon: 'home', link: '/website' }] },
  { label: 'Inhoud', items: [
    { id: 'homepage', label: 'Homepage', short: 'Homepage', icon: 'layers', link: '/website/layout' },
    { id: 'products', label: 'Producten', short: 'Producten', icon: 'products', link: '/website/products' },
    { id: 'categories', label: 'Categorieën', short: 'Categorieën', icon: 'grid', link: '/website/categories' },
    { id: 'texts', label: 'Teksten', short: 'Teksten', icon: 'document', link: '/website/texts' },
    { id: 'seo', label: 'SEO', short: 'SEO', icon: 'search', link: '/website/seo' },
  ] },
  { label: 'Publiceren', items: [
    { id: 'publication', label: 'Publicatie', short: 'Publicatie', icon: 'upload', link: '/website/publication' },
  ] },
  { label: 'Elders in het ERP', items: [
    { id: 'prices', label: 'Prijzen op de website', short: 'Prijzen', icon: 'tag', link: '/settings', query: { sectie: 'website' }, elsewhere: true },
    { id: 'pickup', label: 'Afhalen & locaties', short: 'Afhalen', icon: 'truck', link: '/stock-locations', elsewhere: true },
  ] },
];

interface SideCount {
  text: string;
  tone: 'warn' | 'danger';
  /** A word ("concept", "bezig") instead of a number. */
  word: boolean;
  aria: string;
}

/**
 * The navigation of Website beheren, rendered by app-website-admin-nav (the
 * app shell) on every /website screen, loaded only there. On a desk (680 px and up) the kit's dark side: brand
 * with the site link, the parts of the website with live counts (only where
 * the work is), the ERP screens the website uses and the shared foot with
 * the way back. On a phone the website's own tab bar and "…" sheet.
 * It also keeps the website status and the workspace data alive for the
 * whole stay: the sync store's poll does not restart on every page, and the
 * data store refreshes once when the workspace is entered.
 */
@Component({
  selector: 'app-website-nav-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  /* The workspace's shared CSS (ws-*) arrives with the workspace instead of in the initial bundle. */
  encapsulation: ViewEncapsulation.None,
  styleUrl: '../../../styles/website-workspace.scss',
  imports: [BrandMark, Icon, RouterLink, WebsiteTabbar, WkSideFoot],
  template: `
    @if (desk.active()) {
      <aside class="wk-side ws-side" aria-label="Website beheren">
        <header class="wk-side__brand ws-side__brand">
          <div class="ws-side__brandrow">
            <app-brand-mark subtitle="Website beheren" />
            @if (environmentLabel) { <span class="ws-env">{{ environmentLabel }}</span> }
          </div>
          <a class="ws-side__site" [href]="previewBaseUrl" target="_blank" rel="noopener">
            {{ previewLinkLabel }} <app-icon name="external" [size]="13" />
          </a>
        </header>
        <nav class="wk-side__nav" aria-label="Onderdelen van Website beheren">
          @for (group of groups; track group.label) {
            @if (group.label) { <span class="wk-side__label">{{ group.label }}</span> }
            @for (item of group.items; track item.id) {
              <a class="wk-side__item" [routerLink]="item.link" [queryParams]="item.query ?? null"
                 [class.active]="active() === item.id" [attr.aria-current]="active() === item.id ? 'page' : null"
                 [attr.aria-label]="countOf(item.id)?.aria ?? null">
                <app-icon [name]="item.icon" [size]="18" />
                <span class="wk-side__text">{{ item.label }}</span><span class="wk-side__short">{{ item.short }}</span>
                @if (countOf(item.id); as count) {
                  <span class="wk-side__count" [class.wk-side__count--warn]="count.tone === 'warn'"
                        [class.wk-side__count--danger]="count.tone === 'danger'" [class.wk-side__count--word]="count.word">{{ count.text }}</span>
                  <i class="wk-side__dot" [class.wk-side__dot--warn]="count.tone === 'warn'"
                     [class.ws-side__dot--danger]="count.tone === 'danger'" aria-hidden="true"></i>
                }
              </a>
            }
          }
        </nav>
        <app-wk-side-foot />
      </aside>
    } @else {
      <app-website-tabbar [path]="path()" />
    }
  `,
})
export class WebsiteNavPanel {
  private readonly router = inject(Router);
  readonly desk = inject(DesktopViewport);
  private readonly store = inject(WebsiteStore);
  private readonly sync = inject(WebsiteSyncStore);

  readonly groups = WEBSITE_NAV_GROUPS;
  readonly environmentLabel = environment.environmentLabel;
  readonly previewBaseUrl = environment.websitePreviewUrl;
  readonly previewLinkLabel = environment.environmentLabel === 'TEST'
    ? 'Testsite bekijken'
    : environment.environmentLabel === 'LOCAL'
      ? 'Lokale website bekijken'
      : 'Website bekijken';

  private readonly url = toSignal(this.router.events.pipe(
    filter((event): event is NavigationEnd => event instanceof NavigationEnd),
    map(() => this.router.url),
  ), { initialValue: this.router.url });

  /** The path without query or fragment. */
  readonly path = computed(() => {
    const url = this.url();
    const cut = url.search(/[?#]/);
    const path = cut < 0 ? url : url.slice(0, cut);
    return path.length > 1 ? path.replace(/\/+$/, '') : path;
  });

  readonly active = computed<WebsiteNavId | null>(() => {
    const path = this.path();
    for (const group of WEBSITE_NAV_GROUPS) {
      for (const item of group.items) {
        if (item.elsewhere) continue;
        if (item.link === '/website' ? path === '/website' : path === item.link || path.startsWith(item.link + '/')) return item.id;
      }
    }
    return null;
  });

  private readonly counts = computed(() => {
    const counts = this.store.counts();
    const summary = this.store.homepageSummary();
    const status = this.sync.status();
    const result: Partial<Record<WebsiteNavId, SideCount>> = {};
    if (summary?.differs) result.homepage = { text: 'concept', tone: 'warn', word: true, aria: 'Homepage, concept niet gepubliceerd' };
    if (this.store.families() && counts.attention) {
      result.products = { text: String(counts.attention), tone: 'warn', word: false,
        aria: `Producten, ${counts.attention} ${counts.attention === 1 ? 'vraagt' : 'vragen'} aandacht` };
    }
    if (this.store.categories() && counts.categoriesMissing) {
      result.categories = { text: String(counts.categoriesMissing), tone: 'warn', word: false,
        aria: `Categorieën, ${counts.categoriesMissing} met ontbrekende talen` };
    }
    if (this.store.content() && counts.textsMissing) {
      result.texts = { text: String(counts.textsMissing), tone: 'warn', word: false,
        aria: `Teksten, ${counts.textsMissing} verplichte ${counts.textsMissing === 1 ? 'veld' : 'velden'} leeg` };
    }
    if (this.store.families() && counts.seoLiveAttention) {
      result.seo = { text: String(counts.seoLiveAttention), tone: 'warn', word: false,
        aria: `SEO, ${counts.seoLiveAttention} live ${counts.seoLiveAttention === 1 ? 'reeks' : 'reeksen'} met een aandachtspunt` };
    }
    if (status?.status === 'FAILED_OR_STALE' || isTranslationPending(status)) {
      result.publication = { text: '!', tone: 'danger', word: false, aria: 'Publicatie, actie nodig' };
    } else if (status?.status === 'QUEUED' || status?.status === 'TRIGGERED') {
      result.publication = { text: 'bezig', tone: 'warn', word: true, aria: 'Publicatie, de website wordt bijgewerkt' };
    }
    return result;
  });

  constructor() {
    /* The status and its poll live for the whole stay in the workspace, not per page. */
    this.sync.attach();
    this.sync.refresh();
    inject(DestroyRef).onDestroy(() => this.sync.detach());
    /* Entering the workspace: fresh counts, the old ones stay visible meanwhile (edits made elsewhere show). */
    void this.store.refresh();
  }

  countOf(id: WebsiteNavId): SideCount | null {
    return this.counts()[id] ?? null;
  }
}
