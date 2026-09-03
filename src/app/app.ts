import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { PushSetup } from './core/platform/push';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs';
import { Auth } from './core/api/auth';
import { THEMES, Theme } from './core/platform/theme';
import { WorkQueue } from './core/api/work-queue';
import { UiHost } from './shared/ui';
import { BrandMark } from './shared/brand-mark';
import { Icon } from './shared/icon';
import { WebsiteAdminNav } from './features/website-builder/website-admin-nav';
import { sidebarGroupForUrl, toggleSidebarGroup } from './core/platform/sidebar-navigation';
import type { SidebarGroup } from './core/platform/sidebar-navigation';

/**
 * App shell.
 *
 * Phone gets a tab bar at the bottom, desktop a sidebar. On the login page
 * and in the customer portal the navigation disappears: those are not staff
 * screens.
 */
@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, UiHost, BrandMark, Icon, WebsiteAdminNav],
  template: `
    <div class="shell" [class.shell--bare]="bare()" [class.shell--website]="websiteWorkspace()">
      @if (websiteWorkspace()) {
        <app-website-admin-nav />
      } @else if (!bare()) {
        <aside class="sidebar">
          <a class="sidebar__brand" routerLink="/dashboard" aria-label="Naar dashboard">
            <app-brand-mark subtitle="Sales &amp; Sourcing" />
          </a>
          <nav class="sidebar__nav">
            <a class="sidebar__link" routerLink="/dashboard" routerLinkActive="active">
              <app-icon class="sidebar__icon" name="home" [size]="18" /> Dashboard
            </a>
            <button class="sidebar__group" type="button" (click)="toggleGroup('verkoop')"
                    aria-controls="sidebar-verkoop" [attr.aria-expanded]="groupOpen('verkoop')"
                    [attr.aria-current]="groupCurrent('verkoop') ? 'location' : null"
                    [class.sidebar__group--open]="groupOpen('verkoop')"
                    [class.sidebar__group--current]="groupCurrent('verkoop')">
              <app-icon class="sidebar__group-icon" name="sales" [size]="16" />
              <span class="sidebar__group-label">Verkoop</span>
              @if (!groupOpen('verkoop') && openWork(); as n) {
                <span class="sidebar__group-count">{{ n }}</span>
              }
              <span class="sidebar__group-chev" aria-hidden="true"
                    [class.sidebar__group-chev--open]="groupOpen('verkoop')">›</span>
            </button>
            <div class="sidebar__sub" id="sidebar-verkoop"
                 [class.sidebar__sub--closed]="!groupOpen('verkoop')">
              <a class="sidebar__link" routerLink="/sales" routerLinkActive="active">
                <app-icon class="sidebar__icon" name="sales" [size]="18" />
                <span class="sidebar__text sidebar__text--full">Verkooporders</span>
                <span class="sidebar__text sidebar__text--rail">Verkoop</span>
              </a>
              <a class="sidebar__link" routerLink="/revisions" routerLinkActive="active">
                <app-icon class="sidebar__icon" name="exchange" [size]="18" /> Wijzigingen
                @if (openWork(); as n) { <span class="sidebar__count">{{ n }}</span> }
              </a>
              <a class="sidebar__link" routerLink="/customers" routerLinkActive="active">
                <app-icon class="sidebar__icon" name="customers" [size]="18" /> Klanten
              </a>
              <a class="sidebar__link" routerLink="/countries" routerLinkActive="active">
                <app-icon class="sidebar__icon" name="countries" [size]="18" /> Landen &amp; vracht
              </a>
              <a class="sidebar__link sidebar__link--wide" [routerLink]="['/settings']"
                 [queryParams]="{ sectie: 'discounts' }" [class.active]="settingsActive('discounts')">
                <app-icon class="sidebar__icon" name="exchange" [size]="18" /> Kortingen
              </a>
            </div>

            <button class="sidebar__group" type="button" (click)="toggleGroup('inkoop')"
                    aria-controls="sidebar-inkoop" [attr.aria-expanded]="groupOpen('inkoop')"
                    [attr.aria-current]="groupCurrent('inkoop') ? 'location' : null"
                    [class.sidebar__group--open]="groupOpen('inkoop')"
                    [class.sidebar__group--current]="groupCurrent('inkoop')">
              <app-icon class="sidebar__group-icon" name="purchase" [size]="16" />
              <span class="sidebar__group-label">Inkoop</span>
              <span class="sidebar__group-chev" aria-hidden="true"
                    [class.sidebar__group-chev--open]="groupOpen('inkoop')">›</span>
            </button>
            <div class="sidebar__sub" id="sidebar-inkoop"
                 [class.sidebar__sub--closed]="!groupOpen('inkoop')">
              <a class="sidebar__link" routerLink="/purchasing" routerLinkActive="active">
                <app-icon class="sidebar__icon" name="purchase" [size]="18" /> Inkooporders
              </a>
              <a class="sidebar__link" routerLink="/suppliers" routerLinkActive="active">
                <app-icon class="sidebar__icon" name="suppliers" [size]="18" /> Leveranciers
              </a>
              <a class="sidebar__link sidebar__link--wide" [routerLink]="['/settings']"
                 [queryParams]="{ sectie: 'duties' }" [class.active]="settingsActive('duties')">
                <app-icon class="sidebar__icon" name="truck" [size]="18" /> Douane
              </a>
            </div>

            <button class="sidebar__group" type="button" (click)="toggleGroup('producten')"
                    aria-controls="sidebar-producten" [attr.aria-expanded]="groupOpen('producten')"
                    [attr.aria-current]="groupCurrent('producten') ? 'location' : null"
                    [class.sidebar__group--open]="groupOpen('producten')"
                    [class.sidebar__group--current]="groupCurrent('producten')">
              <app-icon class="sidebar__group-icon" name="products" [size]="16" />
              <span class="sidebar__group-label">Producten &amp; voorraad</span>
              <span class="sidebar__group-chev" aria-hidden="true"
                    [class.sidebar__group-chev--open]="groupOpen('producten')">›</span>
            </button>
            <div class="sidebar__sub" id="sidebar-producten"
                 [class.sidebar__sub--closed]="!groupOpen('producten')">
              <a class="sidebar__link" routerLink="/products" routerLinkActive="active">
                <app-icon class="sidebar__icon" name="products" [size]="18" /> Producten
              </a>
              <a class="sidebar__link" routerLink="/stock" routerLinkActive="active">
                <app-icon class="sidebar__icon" name="stock" [size]="18" /> Voorraad
              </a>
              <a class="sidebar__link" routerLink="/stock-locations" routerLinkActive="active">
                <app-icon class="sidebar__icon" name="stock" [size]="18" />
                <span class="sidebar__text sidebar__text--full">Voorraadlocaties</span>
                <span class="sidebar__text sidebar__text--rail">Locaties</span>
              </a>
              <a class="sidebar__link" routerLink="/barcodes" routerLinkActive="active">
                <app-icon class="sidebar__icon" name="barcode" [size]="18" /> EAN-codes
              </a>
              <a class="sidebar__link sidebar__link--wide" [routerLink]="['/settings']"
                 [queryParams]="{ sectie: 'categories' }" [class.active]="settingsActive('categories')">
                <app-icon class="sidebar__icon" name="products" [size]="18" /> Categorieën
              </a>
              <a class="sidebar__link sidebar__link--wide" [routerLink]="['/settings']"
                 [queryParams]="{ sectie: 'catalog-data' }" [class.active]="settingsActive('catalog-data')">
                <app-icon class="sidebar__icon" name="products" [size]="18" /> Catalogusdata
              </a>
              <a class="sidebar__link sidebar__link--wide" routerLink="/catalog-export" routerLinkActive="active">
                <app-icon class="sidebar__icon" name="pdf" [size]="18" /> Catalogus PDF
              </a>
            </div>

            <button class="sidebar__group" type="button" (click)="toggleGroup('analyses')"
                    aria-controls="sidebar-analyses" [attr.aria-expanded]="groupOpen('analyses')"
                    [attr.aria-current]="groupCurrent('analyses') ? 'location' : null"
                    [class.sidebar__group--open]="groupOpen('analyses')"
                    [class.sidebar__group--current]="groupCurrent('analyses')">
              <app-icon class="sidebar__group-icon" name="analytics" [size]="16" />
              <span class="sidebar__group-label">Analyses</span>
              <span class="sidebar__group-chev" aria-hidden="true"
                    [class.sidebar__group-chev--open]="groupOpen('analyses')">›</span>
            </button>
            <div class="sidebar__sub" id="sidebar-analyses"
                 [class.sidebar__sub--closed]="!groupOpen('analyses')">
              <a class="sidebar__link" routerLink="/analyses/overview" routerLinkActive="active">
                <app-icon class="sidebar__icon" name="analytics" [size]="18" /> Overzicht
              </a>
              <a class="sidebar__link" routerLink="/analyses/sales" routerLinkActive="active">
                <app-icon class="sidebar__icon" name="sales" [size]="18" /> Verkoop
              </a>
              <a class="sidebar__link" routerLink="/analyses/inventory" routerLinkActive="active">
                <app-icon class="sidebar__icon" name="stock" [size]="18" /> Voorraad
              </a>
              <a class="sidebar__link" routerLink="/analyses/purchasing" routerLinkActive="active">
                <app-icon class="sidebar__icon" name="purchase" [size]="18" /> Inkoop
              </a>
              <a class="sidebar__link" routerLink="/analyses/market" routerLinkActive="active">
                <app-icon class="sidebar__icon" name="exchange" [size]="18" /> Markt &amp; container
              </a>
            </div>

            <button class="sidebar__group" type="button" (click)="toggleGroup('bedrijf')"
                    aria-controls="sidebar-bedrijf" [attr.aria-expanded]="groupOpen('bedrijf')"
                    [attr.aria-current]="groupCurrent('bedrijf') ? 'location' : null"
                    [class.sidebar__group--open]="groupOpen('bedrijf')"
                    [class.sidebar__group--current]="groupCurrent('bedrijf')">
              <app-icon class="sidebar__group-icon" name="settings" [size]="16" />
              <span class="sidebar__group-label">Bedrijf</span>
              <span class="sidebar__group-chev" aria-hidden="true"
                    [class.sidebar__group-chev--open]="groupOpen('bedrijf')">›</span>
            </button>
            <div class="sidebar__sub" id="sidebar-bedrijf"
                 [class.sidebar__sub--closed]="!groupOpen('bedrijf')">
              <a class="sidebar__link sidebar__link--wide" routerLink="/activity" routerLinkActive="active">
                <app-icon class="sidebar__icon" name="activity" [size]="18" /> Logboek
              </a>
              <a class="sidebar__link sidebar__link--wide" [routerLink]="['/settings']"
                 [queryParams]="{ sectie: 'company' }" [class.active]="settingsActive('company')">
                <app-icon class="sidebar__icon" name="settings" [size]="18" /> Bedrijfsgegevens
              </a>
              <a class="sidebar__link sidebar__link--wide" routerLink="/settings/documents-media"
                 routerLinkActive="active">
                <app-icon class="sidebar__icon" name="media" [size]="18" /> Documenten &amp; media
              </a>
              <a class="sidebar__link sidebar__link--wide" routerLink="/voorwaarden">
                <app-icon class="sidebar__icon" name="sales" [size]="18" /> Voorwaarden &amp; privacy
              </a>
            </div>

            <a class="sidebar__link sidebar__link--workspace" routerLink="/website" routerLinkActive="active">
              <app-icon class="sidebar__icon" name="countries" [size]="18" />
              <span class="sidebar__text sidebar__text--full">Website beheren</span>
              <span class="sidebar__text sidebar__text--rail">Website</span>
              <i aria-hidden="true">↗</i>
            </a>

            <!-- The narrow rail has no room for group headers; the Meer page
                 carries the long tail there. -->
            <a class="sidebar__link sidebar__link--rail" routerLink="/more" routerLinkActive="active">
              <app-icon class="sidebar__icon" name="more" [size]="18" /> Meer
            </a>
          </nav>

          <div class="sidebar__foot">
            <div class="sidebar__theme" role="radiogroup" aria-label="Kleurschema">
              @for (option of themes; track option.key) {
                <button type="button" role="radio" [title]="option.label"
                        [class.active]="theme.current() === option.key"
                        [attr.aria-checked]="theme.current() === option.key"
                        [style.background]="option.swatch" (click)="theme.set(option.key)">
                  <span class="sr-only">{{ option.label }}</span>
                </button>
              }
            </div>
            <div class="sidebar__account">
              <div class="sidebar__user">{{ auth.username() }}</div>
              <button class="sidebar__logout" type="button" (click)="logout()">Afmelden</button>
            </div>
          </div>
        </aside>
      }

      <div class="main">
        <router-outlet />
      </div>

      @if (!bare() && !websiteWorkspace()) {
        <nav class="tabbar">
          <a class="tabbar__item" routerLink="/dashboard" routerLinkActive="active"
             [attr.aria-current]="url().startsWith('/dashboard') ? 'page' : null">
            <span class="tabbar__icon"><app-icon name="home" /></span> Home
          </a>
          <a class="tabbar__item" routerLink="/sales" routerLinkActive="active"
             [class.active]="salesRoute()" [attr.aria-current]="salesRoute() ? 'page' : null">
            <span class="tabbar__icon">
              <app-icon name="sales" />
              @if (openWork(); as n) {
                <span class="tabbar__count">{{ n > 9 ? '9+' : n }}</span>
              }
            </span> Verkoop
          </a>
          <a class="tabbar__item" routerLink="/purchasing" routerLinkActive="active"
             [attr.aria-current]="url().startsWith('/purchasing') ? 'page' : null">
            <span class="tabbar__icon"><app-icon name="purchase" /></span> Inkoop
          </a>
          <a class="tabbar__item" routerLink="/products" routerLinkActive="active"
             [class.active]="catalogRoute()" [attr.aria-current]="catalogRoute() ? 'page' : null">
            <span class="tabbar__icon"><app-icon name="products" /></span> Producten
          </a>
          <a class="tabbar__item" routerLink="/more" routerLinkActive="active"
             [class.active]="moreRoute()" [attr.aria-current]="moreRoute() ? 'page' : null">
            <span class="tabbar__icon"><app-icon name="more" /></span> Meer
          </a>
        </nav>
      }
    </div>

    <app-ui-host />
  `,
})
export class App {
  /* Register the push worker at startup: the cash register must ring
     even when nobody opened Instellingen this session. */
  private readonly pushSetup = inject(PushSetup);

  constructor() { void this.pushSetup.init(); }

  readonly auth = inject(Auth);
  /* Instantiated here so the palette is on <html> before the first screen paints. */
  readonly theme = inject(Theme);
  readonly themes = THEMES;
  private readonly router = inject(Router);
  private readonly work = inject(WorkQueue);

  readonly url = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );

  /** The route decides which accordion section should be recognisable and open. */
  readonly currentGroup = computed(() => sidebarGroupForUrl(this.url()));

  /** One open section keeps the long desktop navigation calm and scannable. */
  private readonly openGroup = signal<SidebarGroup | null>(sidebarGroupForUrl(this.router.url));
  private readonly syncOpenGroupWithRoute = effect(() => {
    this.openGroup.set(this.currentGroup());
  });

  groupOpen(group: SidebarGroup): boolean {
    return this.openGroup() === group;
  }

  groupCurrent(group: SidebarGroup): boolean {
    return this.currentGroup() === group;
  }

  toggleGroup(group: SidebarGroup): void {
    this.openGroup.update((open) => toggleSidebarGroup(open, group));
  }

  settingsActive(section: string): boolean {
    return this.url().startsWith('/settings') && this.url().includes('sectie=' + section);
  }
  /**
   * How many quotes wait on us; the dot on the Verkoop tab.
   *
   * The same source as the bell top right, so the two numbers cannot drift
   * apart.
   */
  readonly openWork = this.work.actionCount;

  /** Aanmeldpagina en klantportaal krijgen geen navigatie. */
  readonly bare = computed(() => {
    const url = this.url();
    return url.startsWith('/login') || url.startsWith('/offerte')
        || url.startsWith('/voorwaarden');
  });

  /** Website editing is a separate desktop workspace, not an ERP submenu. */
  readonly websiteWorkspace = computed(() => this.url().startsWith('/website'));

  readonly salesRoute = computed(() => {
    const url = this.url();
    return url.startsWith('/sales') || url.startsWith('/revisions');
  });

  readonly catalogRoute = computed(() => {
    const url = this.url();
    return url.startsWith('/products') || url.startsWith('/stock')
      || url.startsWith('/barcodes') || url.startsWith('/catalog')
      || url.startsWith('/website');
  });

  readonly moreRoute = computed(() => {
    const url = this.url();
    return ['/more', '/analyses', '/customers', '/suppliers', '/countries', '/settings', '/activity', '/voorwaarden']
      .some((path) => url.startsWith(path));
  });

  logout(): void {
    this.auth.logout();
    this.router.navigate(['/login']);
  }
}
