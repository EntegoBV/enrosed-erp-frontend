import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs';
import { Auth } from './core/api/auth';
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
            <div class="sidebar__label">Overzicht</div>
            <a class="sidebar__link" routerLink="/dashboard" routerLinkActive="active">
              <app-icon class="sidebar__icon" name="home" [size]="18" /> Dashboard
            </a>

            <div class="sidebar__label">Verkoop</div>
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

            <div class="sidebar__label">Inkoop</div>
            <a class="sidebar__link" routerLink="/purchasing" routerLinkActive="active">
              <app-icon class="sidebar__icon" name="purchase" [size]="18" /> Inkooporders
            </a>
            <a class="sidebar__link" routerLink="/suppliers" routerLinkActive="active">
              <app-icon class="sidebar__icon" name="suppliers" [size]="18" /> Leveranciers
            </a>

            <div class="sidebar__label">Catalogus</div>
            <a class="sidebar__link" routerLink="/products" routerLinkActive="active">
              <app-icon class="sidebar__icon" name="products" [size]="18" /> Producten
            </a>
            <a class="sidebar__link" routerLink="/stock" routerLinkActive="active">
              <app-icon class="sidebar__icon" name="stock" [size]="18" /> Voorraad
            </a>

            <div class="sidebar__label">Configuratie</div>
            <a class="sidebar__link" routerLink="/barcodes" routerLinkActive="active">
              <app-icon class="sidebar__icon" name="barcode" [size]="18" /> EAN-codes
            </a>
            <a class="sidebar__link" routerLink="/stock-locations" routerLinkActive="active">
              <app-icon class="sidebar__icon" name="stock" [size]="18" /> Voorraadlocaties
            </a>
            <a class="sidebar__link" routerLink="/countries" routerLinkActive="active">
              <app-icon class="sidebar__icon" name="countries" [size]="18" /> Landen &amp; vracht
            </a>
            <a class="sidebar__link" routerLink="/settings" routerLinkActive="active">
              <app-icon class="sidebar__icon" name="settings" [size]="18" /> Instellingen
            </a>
          </nav>

          <div class="sidebar__foot">
            <div class="sidebar__user">{{ auth.username() }}</div>
            <button class="sidebar__logout" type="button" (click)="logout()">Afmelden</button>
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
  readonly auth = inject(Auth);
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
