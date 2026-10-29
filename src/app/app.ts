import {
  ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, computed, effect, inject, signal, untracked, viewChild,
} from '@angular/core';
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
  NAV_DEVICE, NAV_GROUPS, NAV_HOME, NAV_MORE, NAV_WORKSPACES, groupCountKeys, navItemActive, navItemIsNew, navItemUrl,
} from './core/platform/nav-items';
import type { NavCountKey, NavGroup, NavItem } from './core/platform/nav-items';
import type { SidebarGroup } from './core/platform/sidebar-navigation';
import { installStaffTouchPolicy } from './core/platform/staff-touch-policy';
import { installReducedMotionScroll } from './core/platform/reduced-motion';
import type { ReducedMotionWindow } from './core/platform/reduced-motion';
import { NavHistory } from './core/platform/nav-history-service';
import { parentOf } from './core/platform/page-parent';
import { phoneTabForUrl } from './core/platform/phone-tabs';
import {
  TAB_MENU_HOLD_MS, TAB_MENU_PUSH, clickGuardAfter, isMenuKey, liesUnder, menuFocusIndex, pressWandered, startTabPress, tabMenuFor,
  tabMenuPlacement,
} from './core/platform/tab-menu';
import type { TabMenu, TabMenuRow, TabPress } from './core/platform/tab-menu';
import { ShortcutsSheet } from './shared/shortcuts-sheet';
import { preloadWanted } from './core/platform/shell-loading-plan';

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
  imports: [RouterOutlet, RouterLink, NgTemplateOutlet, UiHost, BrandMark, Icon, WebsiteAdminNav, FilesAdminNav, FinanceAdminNav, ShortcutsSheet],
  template: `
    <div class="shell" [class.shell--bare]="bare()" [class.shell--website]="websiteWorkspace()" [class.shell--files]="filesWorkspace()" [class.shell--finance]="financeWorkspace()"
         [class.shell--workspace]="deskWorkspace()" [class.shell--workspace-phone]="phoneWorkspace()" [class.shell--home]="homeRoute()">
      <!-- The workspace sides load with their workspace (@defer): they are a third of the
           first screen's script otherwise. A dark placeholder holds their place meanwhile.
           Only a signed-in user gets the side itself: on a logged-out hard load of /files,
           /costs or /website the guard is still redirecting, and a side's first request
           would fail with 401 and send /login without its returnTo. -->
      @if (websiteWorkspace()) {
        @if (auth.isLoggedIn()) {
          @defer (on immediate) { <app-website-admin-nav /> } @placeholder { <div class="website-sidebar-placeholder" aria-hidden="true"></div> }
        } @else { <div class="website-sidebar-placeholder" aria-hidden="true"></div> }
      } @else if (filesWorkspace()) {
        @if (auth.isLoggedIn()) {
          @defer (on immediate) { <app-files-admin-nav /> } @placeholder { <aside class="wk-side" aria-hidden="true"></aside> }
        } @else { <aside class="wk-side" aria-hidden="true"></aside> }
      } @else if (financeWorkspace()) {
        @if (auth.isLoggedIn()) {
          @defer (on immediate) { <app-finance-admin-nav /> } @placeholder { <aside class="wk-side" aria-hidden="true"></aside> }
        } @else { <aside class="wk-side" aria-hidden="true"></aside> }
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
              <!-- The title names the item in full where the 88 px rail cuts its label ("Login-aanv…"). -->
              <a class="sidebar__link" [routerLink]="item.link" [queryParams]="item.query ?? null" [attr.title]="item.label"
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
              <a class="sidebar__link sidebar__link--workspace" [routerLink]="item.link" [attr.title]="item.label"
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
              <div class="sidebar__user" [title]="auth.username() ?? ''">{{ auth.username() }}</div>
              <button class="sidebar__key" type="button" title="Sneltoetsen (?)" aria-label="Sneltoetsen"
                      (click)="shortcutsOpen.set(true)">?</button>
              <button class="sidebar__logout" type="button" (click)="logout()">Afmelden</button>
            </div>
          </div>
        </aside>
      }

      <!-- No tabindex here: a focusable .main would take the focus on every click in the page
           and switch off the workspace shortcuts. The skip link lends it one for that moment. -->
      <div class="main" id="inhoud">
        <router-outlet />
      </div>

      @if (!bare() && !websiteWorkspace()) {
        <!-- A long press on Verkoop, Inkoop or Producten opens that section's pages above the tab (tab-menu.ts). -->
        <nav class="tabbar" #tabbar>
          <a class="tabbar__item" routerLink="/dashboard"
             [class.active]="phoneTab() === 'home'" [attr.aria-current]="phoneTab() === 'home' ? 'page' : null">
            <span class="tabbar__icon"><app-icon name="home" /></span><span class="tabbar__label">Home</span>
          </a>
          <a class="tabbar__item" routerLink="/sales" data-tab-menu="sales" aria-haspopup="menu" [attr.aria-expanded]="tabMenu()?.tab === 'sales'"
             [class.active]="phoneTab() === 'sales'" [attr.aria-current]="phoneTab() === 'sales' ? 'page' : null">
            <span class="tabbar__icon">
              <app-icon name="sales" />
              @if (openWork(); as n) {
                <span class="tabbar__count">{{ n > 9 ? '9+' : n }}</span>
              }
            </span><span class="tabbar__label">Verkoop</span>
          </a>
          <a class="tabbar__item" routerLink="/purchasing" data-tab-menu="purchasing" aria-haspopup="menu" [attr.aria-expanded]="tabMenu()?.tab === 'purchasing'"
             [class.active]="phoneTab() === 'purchasing'" [attr.aria-current]="phoneTab() === 'purchasing' ? 'page' : null">
            <span class="tabbar__icon"><app-icon name="purchase" /></span><span class="tabbar__label">Inkoop</span>
          </a>
          <a class="tabbar__item" routerLink="/products" data-tab-menu="products" aria-haspopup="menu" [attr.aria-expanded]="tabMenu()?.tab === 'products'"
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
        <!-- Over the page and the '+'; the bar stands above it, so another tab still takes a press.
             The page's keys stand down (data-kit-overlay) and a held row gets no link sheet. -->
        @if (tabMenu(); as menu) {
          <div class="tabbar-menu__backdrop" (click)="closeTabMenu()"></div>
          <div class="tabbar-menu" role="menu" [attr.aria-label]="menu.label" animate.leave="tabbar-menu--leaving" data-kit-overlay
               [style.left.px]="menu.left" [style.width.px]="menu.width" [style.--tab-x]="menu.origin + 'px'"
               (keydown)="tabMenuKey($event)" (contextmenu)="$event.preventDefault()">
            @for (row of menu.rows; track row.item.id) {
              <a class="tabbar-menu__row" role="menuitem" [routerLink]="row.item.link" [queryParams]="row.item.query ?? null"
                 [info]="menuRowInfo(row)" [attr.data-tab-menu-row]="row.item.id" [class.tabbar-menu__row--hot]="tabMenuHot() === row.item.id"
                 [class.tabbar-menu__row--current]="menuRowCurrent(menu, row)" [attr.aria-current]="menuRowCurrent(menu, row) ? 'page' : null"
                 (click)="closeTabMenu()">
                <app-icon class="tabbar-menu__icon" [name]="row.item.icon" [size]="20" />
                <span class="tabbar-menu__label">{{ row.label }}</span>
                @if (countOf(row.item.countKey); as n) { <span class="ios-count">{{ n }}</span> }
              </a>
              <!-- The tab's own list, then the section's other pages. -->
              @if ($first && !$last) { <div class="tabbar-menu__rule" role="separator"></div> }
            }
          </div>
        }
      }
    </div>

    <!-- Sneltoetsen: loaded when first asked for ('?' or the key cap). -->
    @if (shortcutsOpen()) {
      @defer (on immediate) {
        <app-shortcuts-sheet [url]="url()" (closed)="shortcutsOpen.set(false)" />
      }
    }

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

  /**
   * The skip link moves the focus to the page without touching the URL (a
   * #fragment would be a router navigation). The page is focusable only for
   * that moment: with a permanent tabindex a click on any text would focus
   * .main, and the workspace shortcuts (keyContext: body or inside the
   * workspace) would stop until the next click on a control. The next Tab
   * (blur) or the next press in the page gives the tabindex back.
   */
  skipToContent(event: Event): void {
    event.preventDefault();
    const main = this.document.getElementById('inhoud');
    if (!main) return;
    const release = () => {
      main.removeAttribute('tabindex');
      main.removeEventListener('blur', release);
      main.removeEventListener('pointerdown', release);
    };
    main.setAttribute('tabindex', '-1');
    main.addEventListener('blur', release);
    main.addEventListener('pointerdown', release);
    main.focus();
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
    /* By whole path segment: /login-requests or /offertes are staff addresses (a 404 inside the shell), not the login page. */
    const path = this.url().split(/[?#]/)[0];
    const is = (root: string) => path === root || path.startsWith(root + '/');
    return is('/login') || is('/offerte') || (is('/voorwaarden') && !this.auth.isLoggedIn());
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

  /* Phone push, pop and tab motion (nav-motion.ts), from a lazy chunk: the first screen does not need it. */
  private readonly navMotion = effect((onCleanup) => {
    let uninstall: (() => void) | null = null;
    let cancelled = false;
    void import('./core/platform/nav-motion').then((m) => {
      if (!cancelled) uninstall = m.installNavMotion(this.router, this.document, this.desktopViewport);
    });
    onCleanup(() => { cancelled = true; uninstall?.(); });
  });
  /**
   * The phone home keeps the ERP tab bar, narrowed so the home's '+' (the
   * kit's .ios-accessory) sits beside it (styles/home-phone.scss). Only
   * /dashboard itself: its Agenda and Open punten pages have no '+'.
   */
  readonly homeRoute = computed(() => this.url().split('?')[0] === '/dashboard' && !this.desktopViewport.active());

  /* The bell, the tab badges and the Meer counts stay current while someone is logged in. */
  private readonly autoRefreshWork = effect((onCleanup) => {
    if (this.auth.isLoggedIn()) onCleanup(this.work.startAutoRefresh());
  });

  /* Every ERP screen is noted, so a workspace knows the way back ("Terug naar inkooporder"). */
  private readonly workspaceReturn = inject(WorkspaceReturn);
  private readonly noteReturn = effect(() => this.workspaceReturn.note(this.url()));

  /**
   * The lit phone tab follows where a screen is listed on the phone
   * (phone-tabs.ts): a page of a tab's long-press menu lights that tab,
   * a screen reached only from Meer lights Meer, in agreement with the
   * back control's tab root ("‹ Verkoop", "‹ Meer").
   */
  readonly phoneTab = computed(() => phoneTabForUrl(this.url()));

  /* ---- The tab bar's long press (core/platform/tab-menu.ts): Verkoop, Inkoop and Producten
     open their pages in a menu above the tab, so a sub-page is no detour through Meer. The
     listeners are native: the click that ends a long press must be stopped before RouterLink. */
  private readonly injector = inject(Injector);
  private readonly tabbar = viewChild<ElementRef<HTMLElement>>('tabbar');
  /** The open menu and where it stands over its tab. */
  readonly tabMenu = signal<(TabMenu & { left: number; width: number; origin: number }) | null>(null);
  /** The row under a finger that slid on from the tab after the menu opened. */
  readonly tabMenuHot = signal<string | null>(null);
  private tabPress: TabPress | null = null;
  private tabHold: ReturnType<typeof setTimeout> | null = null;
  /** Until when the bar swallows a click: the one that trails a long press. */
  private tabClickGuard = 0;
  private tabMenuOpener: HTMLElement | null = null;

  private readonly tabbarPress = effect((onCleanup) => {
    const nav = this.tabbar()?.nativeElement;
    if (!nav) return;
    const down = (event: PointerEvent) => this.tabPointerDown(event);
    const context = (event: MouseEvent) => this.tabContextMenu(event);
    const key = (event: KeyboardEvent) => this.tabKey(event);
    const click = (event: MouseEvent) => this.tabClick(event);
    nav.addEventListener('pointerdown', down);
    nav.addEventListener('contextmenu', context);
    nav.addEventListener('keydown', key);
    nav.addEventListener('click', click, true);
    onCleanup(() => {
      nav.removeEventListener('pointerdown', down);
      nav.removeEventListener('contextmenu', context);
      nav.removeEventListener('keydown', key);
      nav.removeEventListener('click', click, true);
      this.endTabPress();
      this.closeTabMenu();
    });
  });

  /* Another screen, or the desk width: the menu goes. */
  private readonly closeTabMenuOnMove = effect(() => {
    this.url();
    this.desktopViewport.active();
    untracked(() => this.closeTabMenu());
  });

  /**
   * The menu marks the open page only under the lit tab, so the mark and the tab bar agree: a
   * view of Instellingen in a menu (Kortingen, Catalogusdata) lights Meer and is no current row.
   */
  menuRowCurrent(menu: TabMenu, row: TabMenuRow): boolean {
    return this.phoneTab() === menu.tab && this.itemActive(row.item);
  }

  /**
   * How a row's page arrives (nav-direction.ts reads the navigation's info): a page of the tab you
   * are in comes in as a push from anywhere in it (Klanten from an order would slide back as a pop,
   * being shallower). The tab root goes up, the page you are on or under keeps its own direction
   * (under by path, Voorraad from Jaarinventaris, or by its parent, Catalogus PDF from its texts:
   * liesUnder; a view of Instellingen by its query), and a page of another tab (Klanten picked on
   * Meer) is a tab switch.
   */
  menuRowInfo(row: TabMenuRow): typeof TAB_MENU_PUSH | null {
    const inTab = phoneTabForUrl(navItemUrl(row.item)) === this.phoneTab();
    const under = row.item.query
      ? this.itemActive(row.item)
      : liesUnder(this.url(), row.item.link, (url) => parentOf(url)?.url ?? null);
    return inTab && !row.item.tabRoot && !under ? TAB_MENU_PUSH : null;
  }

  closeTabMenu(returnFocus = false): void {
    if (!this.tabMenu()) return;
    const opener = this.tabMenuOpener;
    this.tabMenu.set(null);
    this.tabMenuHot.set(null);
    this.tabMenuOpener = null;
    this.watchTabMenu(false);
    if (returnFocus) opener?.focus();
  }

  /**
   * Arrows, Home and End walk the rows; Space opens the focused one, as Enter does (a link's own
   * Space scrolls the page, and that scroll would close the menu); Tab leaves from its tab, onwards.
   */
  tabMenuKey(event: KeyboardEvent): void {
    if (event.key === 'Tab') { this.closeTabMenu(true); return; }
    const rows = Array.from((event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role="menuitem"]'));
    const index = rows.indexOf(this.document.activeElement as HTMLElement);
    if (event.key === ' ') { event.preventDefault(); rows[index]?.click(); return; }
    const next = menuFocusIndex(event.key, index, rows.length);
    if (next === null) return;
    event.preventDefault();
    rows[next].focus();
  }

  private menuTabLink(target: EventTarget | null): HTMLElement | null {
    return target instanceof Element ? target.closest<HTMLElement>('.tabbar [data-tab-menu]') : null;
  }

  private tabPointerDown(event: PointerEvent): void {
    /* A new press: an open menu closes, and this press's click is a tap again. */
    this.endTabPress();
    this.tabClickGuard = 0;
    this.closeTabMenu();
    const link = this.menuTabLink(event.target);
    const press = link && startTabPress(link.dataset['tabMenu'] ?? '', event);
    if (!link || !press) return;
    this.tabPress = press;
    this.watchTabPress(true);
    this.tabHold = setTimeout(() => this.holdTabPress(link), TAB_MENU_HOLD_MS);
  }

  /** Held long enough: the menu opens with a short tick, and lifting the finger is no tap. */
  private holdTabPress(link: HTMLElement): void {
    if (this.tabHold !== null) clearTimeout(this.tabHold);
    this.tabHold = null;
    if (!this.tabPress || !link.isConnected) { this.endTabPress(); return; }
    this.tabPress = { ...this.tabPress, opened: true };
    this.tabClickGuard = Infinity;
    this.openTabMenu(this.tabPress.tab, link);
    this.document.defaultView?.navigator.vibrate?.(10);
  }

  /** No native callout on the bar. Android's own long press can come first: then it opens the menu. */
  private tabContextMenu(event: MouseEvent): void {
    event.preventDefault();
    const link = this.menuTabLink(event.target);
    if (link && this.tabPress && !this.tabPress.opened) this.holdTabPress(link);
  }

  private tabKey(event: KeyboardEvent): void {
    const link = this.menuTabLink(event.target);
    if (!link || !isMenuKey(event)) return;
    event.preventDefault();
    this.openTabMenu(link.dataset['tabMenu'] ?? '', link);
  }

  /* Capture, before RouterLink: the click that ends a long press never navigates. */
  private tabClick(event: MouseEvent): void {
    if (Date.now() >= this.tabClickGuard) return;
    this.tabClickGuard = 0;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  private readonly tabPointerMove = (event: PointerEvent): void => {
    const press = this.tabPress;
    if (!press || event.pointerId !== press.pointerId) return;
    if (pressWandered(press, event.clientX, event.clientY)) this.endTabPress();
    else if (press.opened) this.tabMenuHot.set(this.menuRowAt(event.clientX, event.clientY));
  };

  /* Slid onto a row and let go there: that row opens. Elsewhere the menu stays. */
  private readonly tabPointerUp = (event: PointerEvent): void => {
    const press = this.tabPress;
    if (!press || event.pointerId !== press.pointerId) return;
    const row = press.opened && event.type === 'pointerup' ? this.menuRowAt(event.clientX, event.clientY) : null;
    this.endTabPress();
    if (row) this.chooseTabMenuRow(row);
  };

  private endTabPress(): void {
    if (this.tabHold !== null) clearTimeout(this.tabHold);
    this.tabHold = null;
    if (this.tabPress) {
      this.tabClickGuard = clickGuardAfter(this.tabPress, Date.now());
      this.watchTabPress(false);
    }
    this.tabPress = null;
    this.tabMenuHot.set(null);
  }

  private watchTabPress(on: boolean): void {
    const method = on ? 'addEventListener' : 'removeEventListener';
    this.document[method]('pointermove', this.tabPointerMove as EventListener, true);
    this.document[method]('pointerup', this.tabPointerUp as EventListener, true);
    this.document[method]('pointercancel', this.tabPointerUp as EventListener, true);
  }

  private openTabMenu(tab: string, link: HTMLElement): void {
    const menu = tabMenuFor(tab, NAV_GROUPS);
    const bar = link.closest('.tabbar')?.getBoundingClientRect();
    if (!menu || !bar) return;
    const box = link.getBoundingClientRect();
    this.tabMenuOpener = link;
    this.tabMenu.set({ ...menu, ...tabMenuPlacement(box.left + box.width / 2, bar.left, bar.right) });
    this.watchTabMenu(true);
    afterNextRender({
      read: () => this.document.querySelector<HTMLElement>('.tabbar-menu [role="menuitem"]')?.focus({ preventScroll: true }),
    }, { injector: this.injector });
  }

  private menuRowAt(x: number, y: number): string | null {
    return this.document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-tab-menu-row]')?.dataset['tabMenuRow'] ?? null;
  }

  private chooseTabMenuRow(id: string): void {
    const row = this.tabMenu()?.rows.find((candidate) => candidate.item.id === id);
    this.closeTabMenu();
    if (!row) return;
    const info = this.menuRowInfo(row);
    void this.router.navigateByUrl(navItemUrl(row.item), info ? { info } : undefined);
  }

  private watchTabMenu(on: boolean): void {
    const method = on ? 'addEventListener' : 'removeEventListener';
    /* The page's own scroll only (an element's scroll does not bubble): a long menu scrolling inside itself stays. */
    this.document[method]('scroll', this.tabMenuScroll);
    /* A fold or unfold of an iPhone Duo moves the bar: the menu, placed from the bar's old rect, closes as on a scroll. */
    this.document.defaultView?.[method]('resize', this.tabMenuScroll);
    this.document[method]('keydown', this.tabMenuEscape as EventListener, true);
  }

  private readonly tabMenuScroll = (): void => this.closeTabMenu();

  private readonly tabMenuEscape = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    this.closeTabMenu(true);
  };

  /* The route progress line (shell-loading.ts), from a lazy chunk. */
  private readonly shellLoading = effect((onCleanup) => {
    let uninstall: (() => void) | null = null;
    let cancelled = false;
    void import('./core/platform/shell-loading').then((m) => {
      if (!cancelled) uninstall = m.installShellLoading(this.router, this.document, this.desktopViewport);
    });
    onCleanup(() => { cancelled = true; uninstall?.(); });
  });

  /*
   * The staff chunks load ahead when the browser is idle, once, and only for
   * a signed-in user on a staff screen: a customer on /offerte never needs
   * them, and on /login they wait until after signing in (the effect runs
   * again when the login lands).
   */
  private idlePreloadStarted = false;
  private readonly idlePreload = effect(() => {
    if (this.idlePreloadStarted || !preloadWanted(this.auth.isLoggedIn(), this.bare())) return;
    this.idlePreloadStarted = true;
    void import('./core/platform/shell-loading').then((m) => m.startIdlePreload(this.router, this.document));
  });

  logout(): void {
    this.auth.logout();
    this.router.navigate(['/login']);
  }

  /** The Sneltoetsen sheet. */
  readonly shortcutsOpen = signal(false);

  /* The '/' and '?' keys (app-shortcut-keys.ts), from a lazy chunk with the shortcut tables. */
  private readonly shortcutKeys = effect((onCleanup) => {
    let uninstall: (() => void) | null = null;
    let cancelled = false;
    void import('./core/platform/app-shortcut-keys').then((m) => {
      if (cancelled) return;
      uninstall = m.installShortcutKeys(this.document, {
        url: () => this.url(),
        active: () => !this.bare(),
        openHelp: () => this.shortcutsOpen.set(true),
      });
    });
    onCleanup(() => { cancelled = true; uninstall?.(); });
  });
}
