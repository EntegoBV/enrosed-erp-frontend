import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
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
  imports: [RouterOutlet, RouterLink, RouterLinkActive, UiHost, BrandMark, Icon],
  template: `
    <div class="shell" [class.shell--bare]="bare()">
      @if (!bare()) {
        <aside class="sidebar">
          <div class="sidebar__brand">
            <app-brand-mark subtitle="Sales &amp; Sourcing" />
          </div>
          <nav class="sidebar__nav">
            <a class="sidebar__link" routerLink="/dashboard" routerLinkActive="active">
              <app-icon class="sidebar__icon" name="home" [size]="18" /> Dashboard
            </a>

            <button class="sidebar__group" type="button" (click)="toggleGroup('verkoop')"
                    [attr.aria-expanded]="groupOpen('verkoop')">
              Verkoop
              @if (!groupOpen('verkoop') && openWork(); as n) {
                <span class="sidebar__group-count">{{ n }}</span>
              }
              <span class="sidebar__group-chev" aria-hidden="true"
                    [class.sidebar__group-chev--open]="groupOpen('verkoop')">›</span>
            </button>
            <div class="sidebar__sub" [class.sidebar__sub--closed]="!groupOpen('verkoop')">
              <a class="sidebar__link" routerLink="/sales" routerLinkActive="active">
                <app-icon class="sidebar__icon" name="sales" [size]="18" /> Verkooporders
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
                    [attr.aria-expanded]="groupOpen('inkoop')">
              Inkoop
              <span class="sidebar__group-chev" aria-hidden="true"
                    [class.sidebar__group-chev--open]="groupOpen('inkoop')">›</span>
            </button>
            <div class="sidebar__sub" [class.sidebar__sub--closed]="!groupOpen('inkoop')">
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
                    [attr.aria-expanded]="groupOpen('producten')">
              Producten &amp; voorraad
              <span class="sidebar__group-chev" aria-hidden="true"
                    [class.sidebar__group-chev--open]="groupOpen('producten')">›</span>
            </button>
            <div class="sidebar__sub" [class.sidebar__sub--closed]="!groupOpen('producten')">
              <a class="sidebar__link" routerLink="/products" routerLinkActive="active">
                <app-icon class="sidebar__icon" name="products" [size]="18" /> Producten
              </a>
              <a class="sidebar__link" routerLink="/stock" routerLinkActive="active">
                <app-icon class="sidebar__icon" name="stock" [size]="18" /> Voorraad
              </a>
              <a class="sidebar__link" routerLink="/stock-locations" routerLinkActive="active">
                <app-icon class="sidebar__icon" name="stock" [size]="18" /> Voorraadlocaties
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

            <button class="sidebar__group" type="button" (click)="toggleGroup('bedrijf')"
                    [attr.aria-expanded]="groupOpen('bedrijf')">
              Bedrijf
              <span class="sidebar__group-chev" aria-hidden="true"
                    [class.sidebar__group-chev--open]="groupOpen('bedrijf')">›</span>
            </button>
            <div class="sidebar__sub" [class.sidebar__sub--closed]="!groupOpen('bedrijf')">
              <a class="sidebar__link sidebar__link--wide" [routerLink]="['/settings']"
                 [queryParams]="{ sectie: 'company' }" [class.active]="settingsActive('company')">
                <app-icon class="sidebar__icon" name="settings" [size]="18" /> Bedrijfsgegevens
              </a>
              <a class="sidebar__link sidebar__link--wide" routerLink="/voorwaarden">
                <app-icon class="sidebar__icon" name="sales" [size]="18" /> Voorwaarden &amp; privacy
              </a>
            </div>

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

      @if (!bare()) {
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

  /** Open fold-downs. Day-to-day work stays in view; only Bedrijf starts folded. */
  private readonly openGroups = signal<Set<string>>(new Set(['verkoop', 'inkoop', 'producten']));

  groupOpen(group: string): boolean {
    return this.openGroups().has(group);
  }

  toggleGroup(group: string): void {
    this.openGroups.update((open) => {
      const next = new Set(open);
      if (next.has(group)) next.delete(group); else next.add(group);
      return next;
    });
  }

  settingsActive(section: string): boolean {
    return this.url().startsWith('/settings') && this.url().includes('sectie=' + section);
  }
  private readonly router = inject(Router);
  private readonly work = inject(WorkQueue);

  /**
   * How many quotes wait on us; the dot on the Verkoop tab.
   *
   * The same source as the bell top right, so the two numbers cannot drift
   * apart.
   */
  readonly openWork = this.work.actionCount;

  readonly url = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );

  /** Aanmeldpagina en klantportaal krijgen geen navigatie. */
  readonly bare = computed(() => {
    const url = this.url();
    return url.startsWith('/login') || url.startsWith('/offerte')
        || url.startsWith('/voorwaarden');
  });

  readonly salesRoute = computed(() => {
    const url = this.url();
    return url.startsWith('/sales') || url.startsWith('/revisions');
  });

  readonly catalogRoute = computed(() => {
    const url = this.url();
    return url.startsWith('/products') || url.startsWith('/catalog-export');
  });

  readonly moreRoute = computed(() => {
    const url = this.url();
    return ['/more', '/customers', '/suppliers', '/countries', '/settings', '/voorwaarden']
      .some((path) => url.startsWith(path));
  });

  logout(): void {
    this.auth.logout();
    this.router.navigate(['/login']);
  }
}
