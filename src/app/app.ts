import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { PushSetup } from './core/platform/push';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { NgTemplateOutlet } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import { Auth } from './core/api/auth';
import { THEMES, Theme } from './core/platform/theme';
import { WorkQueue } from './core/api/work-queue';
import { UiHost } from './shared/ui';
import { BrandMark } from './shared/brand-mark';
import { Icon } from './shared/icon';
import { WebsiteAdminNav } from './features/website-builder/website-admin-nav';
import { FinanceAdminNav } from './features/finance/finance-admin-nav';
import { FilesAdminNav } from './features/files/files-admin-nav';
import { DesktopViewport } from './core/platform/desktop-viewport';
import { WorkspaceReturn } from './core/platform/workspace-return';
import { sidebarGroupForUrl, toggleSidebarGroup } from './core/platform/sidebar-navigation';
import {
  NAV_DEVICE, NAV_GROUPS, NAV_HOME, NAV_MORE, NAV_WORKSPACES, groupCountKeys, navItemActive, navItemIsNew,
} from './core/platform/nav-items';
import type { NavCountKey, NavGroup, NavItem } from './core/platform/nav-items';
import type { SidebarGroup } from './core/platform/sidebar-navigation';
import { installStaffTouchPolicy } from './core/platform/staff-touch-policy';
import { installReducedMotionScroll } from './core/platform/reduced-motion';
import type { ReducedMotionWindow } from './core/platform/reduced-motion';
import { NavHistory } from './core/platform/nav-history-service';
import { phoneTabForUrl } from './core/platform/phone-tabs';

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
  imports: [RouterOutlet, RouterLink, NgTemplateOutlet, UiHost, BrandMark, Icon, WebsiteAdminNav, FilesAdminNav, FinanceAdminNav],
  template: `
    <div class="shell" [class.shell--bare]="bare()" [class.shell--website]="websiteWorkspace()" [class.shell--files]="filesWorkspace()" [class.shell--finance]="financeWorkspace()"
         [class.shell--workspace]="deskWorkspace()" [class.shell--workspace-phone]="phoneWorkspace()" [class.shell--home]="homeRoute()">
      @if (websiteWorkspace()) {
        <app-website-admin-nav />
      } @else if (filesWorkspace()) {
        <app-files-admin-nav />
      } @else if (financeWorkspace()) {
        <app-finance-admin-nav />
      } @else if (!bare()) {
        <!-- Keyboard: the first stop skips the navigation (visible on focus). -->
        <a class="skip-link" href="#inhoud" (click)="skipToContent($event)">Naar de inhoud</a>
        <aside class="sidebar" [class.sidebar--animate]="userToggled()">
          <a class="sidebar__brand" routerLink="/dashboard" aria-label="Naar dashboard">
            <app-brand-mark subtitle="Sales &amp; Sourcing" />
          </a>
          <!-- Rendered from NAV_GROUPS (core/platform/nav-items.ts), the table Meer shares. -->
          <nav class="sidebar__nav">
            <ng-template #navLink let-item>
              <a class="sidebar__link" [routerLink]="item.link" [queryParams]="item.query ?? null"
                 [class.active]="itemActive(item)" [attr.aria-current]="itemActive(item) ? 'page' : null"
                 [class.sidebar__link--wide]="item.wide" [attr.data-rail-main]="item.railMain ? '' : null">
                <app-icon class="sidebar__icon" [name]="item.icon" [size]="18" />
                @if (item.short) {
                  <span class="sidebar__text sidebar__text--full">{{ item.label }}</span>
                  <span class="sidebar__text sidebar__text--rail">{{ item.short }}</span>
                } @else {
                  <span class="sidebar__text">{{ item.label }}</span>
                }
                @if (countOf(item.countKey); as n) {
                  <span class="sidebar__count"><span class="sidebar__count-full">{{ n }}</span><span class="sidebar__count-rail">{{ n > 9 ? '9+' : n }}</span></span>
                }
                @if (itemNew(item)) { <span class="sidebar__new">nieuw</span> }
              </a>
            </ng-template>

            <ng-container [ngTemplateOutlet]="navLink" [ngTemplateOutletContext]="{ $implicit: navHome }" />
            @for (group of navGroups; track group.id) {
              <button class="sidebar__group" type="button" (click)="toggleGroup(group.id)"
                      [attr.aria-controls]="'sidebar-' + group.id" [attr.aria-expanded]="groupOpen(group.id)"
                      [attr.aria-current]="groupCurrent(group.id) ? 'location' : null"
                      [class.sidebar__group--open]="groupOpen(group.id)"
                      [class.sidebar__group--current]="groupCurrent(group.id)">
                <app-icon class="sidebar__group-icon" [name]="group.icon" [size]="16" />
                <span class="sidebar__group-label">
                  @if (group.short) {
                    <span class="sidebar__text sidebar__text--full">{{ group.label }}</span><span class="sidebar__text sidebar__text--rail">{{ group.short }}</span>
                  } @else { {{ group.label }} }
                </span>
                @if (!groupOpen(group.id) && groupCount(group); as n) {
                  <span class="sidebar__group-count">{{ n }}</span>
                }
                <span class="sidebar__group-chev" aria-hidden="true"
                      [class.sidebar__group-chev--open]="groupOpen(group.id)">›</span>
              </button>
              <div class="sidebar__sub" [id]="'sidebar-' + group.id"
                   [class.sidebar__sub--closed]="!groupOpen(group.id)">
                <div class="sidebar__sub-list">
                  @for (item of group.items; track item.id) {
                    <ng-container [ngTemplateOutlet]="navLink" [ngTemplateOutletContext]="{ $implicit: item }" />
                  }
                </div>
              </div>
            }

            <!-- The workspaces everyone opens daily stand on their own, below a
                 hairline: the library, the money, the website. -->
            <div class="sidebar__rule" aria-hidden="true"></div>
            @for (item of navWorkspaces; track item.id) {
              <a class="sidebar__link sidebar__link--workspace" [routerLink]="item.link"
                 [class.active]="itemActive(item)" [attr.aria-current]="itemActive(item) ? 'page' : null">
                <app-icon class="sidebar__icon" [name]="item.icon" [size]="18" />
                <span class="sidebar__text sidebar__text--full">{{ item.label }}</span>
                <span class="sidebar__text sidebar__text--rail">{{ item.short ?? item.label }}</span>
              </a>
            }

            <!-- The narrow rail has no room for group headers; the Meer page
                 carries the long tail there. -->
            <a class="sidebar__link sidebar__link--rail" [routerLink]="navMore.link" [class.active]="itemActive(navMore)"
               [attr.aria-current]="itemActive(navMore) ? 'page' : null">
              <app-icon class="sidebar__icon" [name]="navMore.icon" [size]="18" />
              <span class="sidebar__text">{{ navMore.label }}</span>
              <!-- Login-aanvragen is not in the 680-899 rail: its count shows on Meer, as on the phone tab. -->
              @if (openLoginRequests(); as n) {
                <span class="sidebar__count"><span class="sidebar__count-rail">{{ n > 9 ? '9+' : n }}</span></span>
              }
            </a>
          </nav>

          <div class="sidebar__foot">
            <!-- This device's push messages and sounds; the bell's sheet is "Meldingen", so this says where. -->
            @for (item of navDevice; track item.id) {
              <a class="sidebar__link sidebar__link--device" [routerLink]="item.link" [queryParams]="item.query ?? null"
                 [title]="item.hint ?? ''" [class.active]="itemActive(item)" [attr.aria-current]="itemActive(item) ? 'page' : null">
                <app-icon class="sidebar__icon" [name]="item.icon" [size]="18" />
                <span class="sidebar__text sidebar__text--full">{{ item.label }}</span>
                <span class="sidebar__text sidebar__text--rail">{{ item.short ?? item.label }}</span>
              </a>
            }
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

      <div class="main" id="inhoud" tabindex="-1">
        <router-outlet />
      </div>

      @if (!bare() && !websiteWorkspace()) {
        <nav class="tabbar">
          <a class="tabbar__item" routerLink="/dashboard"
             [class.active]="phoneTab() === 'home'" [attr.aria-current]="phoneTab() === 'home' ? 'page' : null">
            <span class="tabbar__icon"><app-icon name="home" /></span><span class="tabbar__label">Home</span>
          </a>
          <a class="tabbar__item" routerLink="/sales"
             [class.active]="phoneTab() === 'sales'" [attr.aria-current]="phoneTab() === 'sales' ? 'page' : null">
            <span class="tabbar__icon">
              <app-icon name="sales" />
              @if (openWork(); as n) {
                <span class="tabbar__count">{{ n > 9 ? '9+' : n }}</span>
              }
            </span><span class="tabbar__label">Verkoop</span>
          </a>
          <a class="tabbar__item" routerLink="/purchasing"
             [class.active]="phoneTab() === 'purchasing'" [attr.aria-current]="phoneTab() === 'purchasing' ? 'page' : null">
            <span class="tabbar__icon"><app-icon name="purchase" /></span><span class="tabbar__label">Inkoop</span>
          </a>
          <a class="tabbar__item" routerLink="/products"
             [class.active]="phoneTab() === 'products'" [attr.aria-current]="phoneTab() === 'products' ? 'page' : null">
            <span class="tabbar__icon"><app-icon name="products" /></span><span class="tabbar__label">Producten</span>
          </a>
          <a class="tabbar__item" routerLink="/more"
             [class.active]="phoneTab() === 'more'" [attr.aria-current]="phoneTab() === 'more' ? 'page' : null">
            <span class="tabbar__icon">
              <app-icon name="more" />
              @if (openLoginRequests(); as n) {
                <span class="tabbar__count">{{ n > 9 ? '9+' : n }}</span>
              }
            </span><span class="tabbar__label">Meer</span>
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
  /* Created with the shell, so the back labels and the crumb know the history from the first navigation. */
  private readonly navHistory = inject(NavHistory);

  constructor() {
    void this.pushSetup.init();
    /* Smooth scrolls from code turn instant under prefers-reduced-motion. */
    installReducedMotionScroll(window as unknown as ReducedMotionWindow);
  }

  readonly auth = inject(Auth);
  /* Instantiated here so the palette is on <html> before the first screen paints. */
  readonly theme = inject(Theme);
  readonly themes = THEMES;
  private readonly router = inject(Router);
  private readonly work = inject(WorkQueue);

  private readonly document = inject(DOCUMENT);

  /**
   * The open URL. Before the first navigation ends, router.url is still '/':
   * starting from the address bar keeps a hard load of /costs, /files or
   * /website (and /login) from flashing the ERP sidebar first.
   */
  readonly url = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
    ),
    { initialValue: this.initialUrl() },
  );

  /** The route decides which accordion section should be recognisable and open. */
  readonly currentGroup = computed(() => sidebarGroupForUrl(this.url()));

  /** One open section keeps the long desktop navigation calm and scannable. */
  private readonly openGroup = signal<SidebarGroup | null>(sidebarGroupForUrl(this.url()));
  /**
   * Only a group the user opens or closes animates; when the route opens or
   * closes one, the change is instant, so the item just clicked never
   * slides away under the cursor.
   */
  readonly userToggled = signal(false);
  private readonly syncOpenGroupWithRoute = effect(() => {
    const group = this.currentGroup();
    this.userToggled.set(false);
    this.openGroup.set(group);
  });

  /* The navigation table, shared with Meer. */
  readonly navHome = NAV_HOME;
  readonly navGroups = NAV_GROUPS;
  readonly navWorkspaces = NAV_WORKSPACES;
  readonly navMore = NAV_MORE;
  readonly navDevice = NAV_DEVICE;

  itemActive(item: NavItem): boolean {
    return navItemActive(item, this.url());
  }

  itemNew(item: NavItem): boolean {
    return navItemIsNew(item);
  }

  /** A WorkQueue count by name; 0 hides the chip. */
  countOf(key: NavCountKey | undefined): number {
    return key ? this.work[key]() : 0;
  }

  /** The folded header's count: its items' counts, as NAV_GROUPS says. */
  groupCount(group: NavGroup): number {
    return groupCountKeys(group, 'sidebar').reduce((sum, key) => sum + this.countOf(key), 0);
  }

  groupOpen(group: SidebarGroup): boolean {
    return this.openGroup() === group;
  }

  groupCurrent(group: SidebarGroup): boolean {
    return this.currentGroup() === group;
  }

  toggleGroup(group: SidebarGroup): void {
    this.userToggled.set(true);
    this.openGroup.update((open) => toggleSidebarGroup(open, group));
  }

  /** The skip link moves the focus to the page without touching the URL (a #fragment would be a router navigation). */
  skipToContent(event: Event): void {
    event.preventDefault();
    this.document.getElementById('inhoud')?.focus();
  }

  /** The address bar's path and query, for the first frame. */
  private initialUrl(): string {
    const location = this.document.location;
    return location ? `${location.pathname}${location.search}` || '/' : this.router.url;
  }

  /**
   * How many quotes wait on us; the dot on the Verkoop tab.
   *
   * The same source as the bell top right, so the two numbers cannot drift
   * apart.
   */
  readonly openWork = this.work.actionCount;
  readonly openLoginRequests = this.work.loginRequestCount;

  /**
   * The login page and the customer portal get no navigation. The terms
   * page too for a customer; staff read it inside the shell, with the tab
   * bar (Meer lit) as the way back in the iPhone app.
   */
  readonly bare = computed(() => {
    const url = this.url();
    return url.startsWith('/login') || url.startsWith('/offerte')
        || (url.startsWith('/voorwaarden') && !this.auth.isLoggedIn());
  });

  private readonly syncStaffTouch = effect(onCleanup => {
    if (this.auth.isLoggedIn() && !this.bare()) {
      onCleanup(installStaffTouchPolicy(this.document));
    }
  });

  /** Website editing is a separate desktop workspace, not an ERP submenu. */
  readonly websiteWorkspace = computed(() => this.url().startsWith('/website'));
  /** The library gets its own workspace navigation on a desktop; a phone keeps the tab bar. */
  private readonly desktopViewport = inject(DesktopViewport);
  readonly filesWorkspace = computed(() => this.url().startsWith('/files') && this.desktopViewport.active());
  /** Kosten & bank is a workspace of its own as well: costs, recurring costs and the bank side by side. */
  readonly financeWorkspace = computed(() => this.url().startsWith('/costs') && this.desktopViewport.active());

  /**
   * The shared workspace kit (styles/workspace-kit.scss) hooks onto these.
   * Both are opt-in: the desk shell only locks page scrolling once the page
   * renders .wk-page, the phone shell only hides the ERP tab bar once the
   * page renders .ios-page.
   */
  readonly workspaceRoute = computed(() => {
    const url = this.url();
    return url.startsWith('/costs') ? 'finance' : url.startsWith('/files') ? 'files' : null;
  });
  readonly deskWorkspace = computed(() => this.filesWorkspace() || this.financeWorkspace());
  readonly phoneWorkspace = computed(() => this.workspaceRoute() !== null && !this.desktopViewport.active());
  /**
   * The phone home keeps the ERP tab bar, narrowed so the home's '+' (the
   * kit's .ios-accessory) sits beside it (styles/home-phone.scss). Only
   * /dashboard itself: its Agenda and Open punten pages have no '+'.
   */
  readonly homeRoute = computed(() => this.url().split('?')[0] === '/dashboard' && !this.desktopViewport.active());

  /* Every ERP screen is noted, so a workspace knows the way back ("Terug naar inkooporder"). */
  private readonly workspaceReturn = inject(WorkspaceReturn);
  private readonly noteReturn = effect(() => this.workspaceReturn.note(this.url()));

  /**
   * The lit phone tab follows where a screen is listed on the phone
   * (phone-tabs.ts): screens reached from Meer light Meer, in agreement with
   * their "‹ Meer" back control.
   */
  readonly phoneTab = computed(() => phoneTabForUrl(this.url()));

  logout(): void {
    this.auth.logout();
    this.router.navigate(['/login']);
  }
}
