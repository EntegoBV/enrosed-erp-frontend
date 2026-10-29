import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { environment } from '../../../environments/environment';
import { WorkspaceReturn } from '../../core/platform/workspace-return';
import { HostBridge } from '../../core/platform/host-bridge';
import { HOST_SYMBOLS } from '../../core/platform/host-symbols';
import type { HostMenuItem, HostTab } from '../../core/platform/host';
import { Icon } from '../../shared/icon';
import { IosTab, IosTabbar } from '../../shared/ios-tabbar';
import { Sheet } from '../../shared/ui';
import { websiteSyncCopy } from '../settings/website-sync-copy';
import { WebsiteSyncStore } from '../settings/website-sync-store';
import { WebsiteStore } from './website-store';

/** The four tab roots of the workspace on a phone; SEO, Categorieën and Publicatie live in the "…" sheet. */
const WEBSITE_TABS = [
  { id: 'overview', label: 'Overzicht', icon: 'home', link: '/website' },
  { id: 'homepage', label: 'Homepage', icon: 'layers', link: '/website/layout' },
  { id: 'products', label: 'Producten', icon: 'products', link: '/website/products' },
  { id: 'texts', label: 'Teksten', icon: 'document', link: '/website/texts' },
] as const;

/** The website's host for the sheet's sub line: "enrosed.com". */
function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}

/**
 * The website's own glass tab bar on a phone (below 680 px) and its "…"
 * sheet "Website": SEO, Categorieën, Publicatie, the ERP screens the website
 * uses, the site itself and the way back. Rendered once by
 * app-website-admin-nav, outside .main, so it stays still while pages
 * change and every website page, converted or not, keeps its navigation.
 * Tabs replace the history entry and carry { nav: 'tab' }.
 */
@Component({
  selector: 'app-website-tabbar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  imports: [Icon, IosTabbar, Sheet],
  template: `
    <app-ios-tabbar label="Onderdelen van Website beheren" [tabs]="tabs()"
                    accessoryIcon="more" accessoryTone="glass" accessoryLabel="Meer van de website"
                    (accessory)="sheetOpen.set(true)" />
    @if (sheetOpen()) {
      <app-sheet title="Website" variant="ios" (closed)="sheetOpen.set(false)">
        <div body class="ws-more">
          <section class="ios-section">
            <div class="ios-group ios-group--icons">
              <button class="ios-cell" type="button" (click)="go('/website/seo')">
                <span class="ios-tile tone-blue" aria-hidden="true"><app-icon name="search" [size]="18" /></span>
                <span class="ios-cell__body"><span class="ios-cell__title">SEO</span></span>
                @if (seoValue(); as value) { <span class="ios-cell__value">{{ value }}</span> }
                <app-icon class="ios-cell__chev" name="chevron-right" [size]="18" />
              </button>
              <button class="ios-cell" type="button" (click)="go('/website/categories')">
                <span class="ios-tile tone-green" aria-hidden="true"><app-icon name="grid" [size]="18" /></span>
                <span class="ios-cell__body"><span class="ios-cell__title">Categorieën</span></span>
                @if (store.categories(); as list) { <span class="ios-cell__value">{{ list.length }}</span> }
                <app-icon class="ios-cell__chev" name="chevron-right" [size]="18" />
              </button>
              <button class="ios-cell" type="button" (click)="go('/website/publication')">
                <span class="ios-tile tone-teal" aria-hidden="true"><app-icon name="upload" [size]="18" /></span>
                <span class="ios-cell__body"><span class="ios-cell__title">Publicatie</span></span>
                @if (syncValue(); as value) { <span class="ios-cell__value">{{ value }}</span> }
                <app-icon class="ios-cell__chev" name="chevron-right" [size]="18" />
              </button>
            </div>
          </section>
          <section class="ios-section">
            <div class="ios-section__head"><h2>Elders in het ERP</h2></div>
            <div class="ios-group ios-group--icons">
              <button class="ios-cell" type="button" (click)="go('/settings?sectie=website')">
                <span class="ios-tile tone-amber" aria-hidden="true"><app-icon name="tag" [size]="18" /></span>
                <span class="ios-cell__body"><span class="ios-cell__title">Prijzen op de website</span></span>
                <app-icon class="ios-cell__chev" name="chevron-right" [size]="18" />
              </button>
              <button class="ios-cell" type="button" (click)="go('/stock-locations')">
                <span class="ios-tile tone-plum" aria-hidden="true"><app-icon name="truck" [size]="18" /></span>
                <span class="ios-cell__body"><span class="ios-cell__title">Afhalen &amp; locaties</span></span>
                <app-icon class="ios-cell__chev" name="chevron-right" [size]="18" />
              </button>
              <a class="ios-cell" [href]="siteUrl" target="_blank" rel="noopener" (click)="sheetOpen.set(false)">
                <span class="ios-tile tone-grey" aria-hidden="true"><app-icon name="globe" [size]="18" /></span>
                <span class="ios-cell__body">
                  <span class="ios-cell__title">{{ siteLabel }}</span>
                  <span class="ios-cell__sub">{{ siteHost }} · opent in Safari</span>
                </span>
                <app-icon class="ios-cell__chev" name="external" [size]="16" />
              </a>
            </div>
          </section>
          <section class="ios-section">
            <div class="ios-group">
              <button class="ios-cell ios-cell--action ws-more__back" type="button" (click)="go(ret.phoneUrl())">
                <app-icon name="chevron-left" [size]="20" /> Terug naar {{ backLabel() }}
              </button>
            </div>
          </section>
        </div>
      </app-sheet>
    }
  `,
})
export class WebsiteTabbar {
  private readonly router = inject(Router);
  readonly store = inject(WebsiteStore);
  readonly ret = inject(WorkspaceReturn);
  private readonly sync = inject(WebsiteSyncStore);

  /** The current path, handed in by the nav (it already follows the router). */
  readonly path = input.required<string>();
  readonly sheetOpen = signal(false);

  constructor() {
    /* The native host: these four tabs and the sheet's rows on every website page, for as long as the bar lives. */
    const host = inject(HostBridge);
    if (host.present) {
      effect(() => host.contribute('website', { tabBar: 'website', workspaceTabs: this.hostTabs(), menu: this.hostMenu() }));
      inject(DestroyRef).onDestroy(() => host.contribute('website', null));
    }
  }

  readonly hostTabs = computed<HostTab[]>(() => this.tabs().map((tab) => {
    const out: HostTab = { id: tab.id, label: tab.label, icon: tab.icon, symbol: HOST_SYMBOLS[tab.icon] ?? 'circle.dashed', active: tab.active, url: String(tab.link) };
    if (tab.badge) { out.badge = tab.badge; out.warn = true; }
    return out;
  }));

  readonly hostMenu = computed<HostMenuItem[]>(() => [
    { id: 'nav:/website/seo', label: 'SEO', icon: 'search' },
    { id: 'nav:/website/categories', label: 'Categorieën', icon: 'grid' },
    { id: 'nav:/website/publication', label: 'Publicatie', icon: 'upload' },
    { separator: true },
    { id: 'nav:/settings?sectie=website', label: 'Prijzen op de website', icon: 'tag' },
    { id: 'nav:/stock-locations', label: 'Afhalen & locaties', icon: 'truck' },
    { id: `ext:${this.siteUrl}`, label: this.siteLabel, symbol: 'safari' },
    { separator: true },
    { id: 'workspaceBack', label: `Terug naar ${this.backLabel()}`, symbol: 'chevron.backward' },
  ]);

  readonly siteUrl = environment.websitePreviewUrl;
  readonly siteHost = hostOf(environment.websitePreviewUrl);
  readonly siteLabel = environment.environmentLabel === 'TEST' ? 'Testsite bekijken'
    : environment.environmentLabel === 'LOCAL' ? 'Lokale website bekijken' : 'Website bekijken';

  readonly tabs = computed<IosTab[]>(() => {
    const path = this.path();
    const counts = this.store.counts();
    const badges: Record<string, number | null> = {
      products: this.store.families() ? counts.attention : null,
      texts: this.store.content() ? counts.textsMissing : null,
    };
    return WEBSITE_TABS.map((tab) => ({
      id: tab.id, label: tab.label, icon: tab.icon, link: tab.link,
      active: tab.link === '/website' ? path === '/website' : path === tab.link || path.startsWith(tab.link + '/'),
      badge: badges[tab.id] || null, badgeTone: 'warn' as const,
      info: { nav: 'tab' },
    }));
  });

  readonly seoValue = computed(() => {
    if (!this.store.families()) return null;
    const counts = this.store.counts();
    return `${counts.seoOk} / ${counts.seoTotal}`;
  });

  readonly syncValue = computed(() => {
    const status = this.sync.status();
    if (!status) return null;
    const copy = websiteSyncCopy({ status, loading: false, loadError: null, pollEnded: this.sync.pollEnded() });
    if (status.status === 'QUEUED' || status.status === 'TRIGGERED') return 'Bezig';
    return copy.tone === 'danger' || copy.action === 'todo' ? 'Actie nodig' : copy.label;
  });

  /** The phone's way back: where the workspace was opened from, else Meer. */
  readonly backLabel = computed(() => this.ret.origin()?.label ?? 'Meer');

  /** The sheet closes first, then the app navigates. */
  go(url: string): void {
    this.sheetOpen.set(false);
    void this.router.navigateByUrl(url);
  }
}
