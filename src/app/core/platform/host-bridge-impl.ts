import { DestroyRef, Injectable, Injector, effect, inject, untracked } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { NavigationCancel, NavigationCancellationCode, NavigationEnd, NavigationError, NavigationStart, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import { HOST_VERSION, cleanLabel } from './host';
import { resolveSymbol, workspaceOf } from './host-symbols';
import type {
  HostAction, HostCommand, HostMenuItem, HostNavDirection, HostPage, HostStackEntry, HostTheme, HostTitleRow, HostWindow,
} from './host';
import { HostBridge } from './host-bridge';
import type { HostBridgeImplementation, HostContribution, HostPageSource } from './host-bridge';
import { NavHistory } from './nav-history-service';
import { navPath } from './nav-history';
import { WorkspaceReturn } from './workspace-return';
import { NAV_GROUPS, navItemActive, navItemUrl } from './nav-items';
import { tabMenuFor } from './tab-menu';
import { PHONE_TABS, phoneTabForUrl } from './phone-tabs';
import { navDirection, navInfoDirection } from './nav-direction';
import { returnLabel, screenLabel } from './return-label';
import { WorkQueue } from '../api/work-queue';
import { Auth } from '../api/auth';
import { Theme } from './theme';
import { scrollBehavior } from '../../shared/motion';

/**
 * The heavy half of the bridge to the native host (host-bridge.ts is the
 * facade): composing a page's descriptor from its sources, publishing it
 * once per frame, the host's commands and the shell-level messages. Loaded
 * by the facade through `import()` only inside a host, so none of this and
 * none of what it imports (the symbol tables, the tab menu, the nav items,
 * the theme) reaches the PWA's initial bundle.
 */

interface Owner {
  source: HostPageSource;
  ids: Set<string>;
  page: HostPage | null;
}

const COMMAND_TYPES: readonly HostCommand['type'][] = ['action', 'back', 'open', 'tabRoot', 'lifecycle', 'refresh', 'insets', 'sessionCheck'];
const FALLBACK_MS = 300;
const REFRESH_TIMEOUT_MS = 15000;

function bellLabel(count: number): string {
  return count === 0 ? 'Meldingen' : count === 1 ? '1 klant wacht' : `${count} klanten wachten`;
}

@Injectable({ providedIn: 'root' })
export class HostBridgeImpl implements HostBridgeImplementation {
  private readonly bridge = inject(HostBridge);
  private readonly document = inject(DOCUMENT);
  private readonly router = inject(Router);
  private readonly history = inject(NavHistory);
  private readonly injector = inject(Injector);
  private readonly win = this.document.defaultView as (Window & HostWindow) | null;

  private owner: Owner | null = null;
  private pending: HostPage | null = null;
  private frame = 0;
  private lastSent = '';
  private lastCondensed: boolean | null = null;
  private fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private publishedUrl: string | null = null;
  private navStartUrl: string | null = null;
  private refreshFinish: (() => void) | null = null;

  /** The URL the router settled on; read by the compose effect so a navigation republishes. */
  private readonly navUrl = toSignal(
    this.router.events.pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd), map((event) => event.urlAfterRedirects)),
    { initialValue: this.router.url },
  );

  /* ---------------------------------------------------------------- pages */

  bind(source: HostPageSource, destroyRef: DestroyRef): void {
    const owner: Owner = { source, ids: new Set(), page: null };
    const ref = effect(() => {
      const page = this.compose(owner);
      untracked(() => this.publish(owner, page));
    }, { injector: this.injector });
    destroyRef.onDestroy(() => {
      ref.destroy();
      if (this.owner === owner) {
        this.owner = null;
        /* The next header publishes within a frame; otherwise the bare page says what the URL is. */
        this.scheduleFallback();
      }
    });
  }

  private compose(owner: Owner): HostPage {
    const src = owner.source;
    const url = this.navUrl();
    const input = src.input() ?? null;
    const explicit = input !== null;
    const mirror = explicit ? null : src.mirror?.() ?? null;
    const title = cleanLabel(input?.title ?? src.title()) || 'Enrosed';
    const subtitleRaw = input?.subtitle !== undefined ? input.subtitle : src.subtitle?.();
    const subtitle = cleanLabel(subtitleRaw ?? '') || undefined;
    const largeTitle = input?.largeTitle ?? src.largeTitle?.() ?? false;
    const condensed = largeTitle ? src.condensed?.() ?? false : true;
    const titleEditable = input?.titleEditable ?? src.titleEditable?.() ?? false;
    const back = input?.back !== undefined ? input.back ?? undefined : src.back?.() ?? undefined;
    const bell = src.bell?.() ?? null;
    const overlay = this.bridge.overlays() > 0;
    const contribution = this.contributionFor(url);

    const ids = new Set<string>();
    const normalise = (action: HostAction): HostAction => {
      ids.add(action.id);
      const symbol = resolveSymbol(action);
      const out: HostAction = { ...action, label: cleanLabel(action.label) };
      if (symbol) out.symbol = symbol;
      if (!out.badge) delete out.badge;
      return out;
    };
    const normaliseMenu = (items: readonly HostMenuItem[]): HostMenuItem[] => items.map((item) => ('separator' in item ? item : normalise(item)));

    let primary = (explicit ? input.primary : mirror?.primary) ?? undefined;
    if (primary) primary = normalise({ prominent: true, ...primary });
    const actions = (explicit ? input.actions ?? [] : mirror?.actions ?? []).map(normalise);
    if (bell && !ids.has('bell')) {
      actions.push(normalise({ id: 'bell', label: bellLabel(bell.count), icon: 'bell', badge: bell.count || undefined }));
      /* The header's own bell is no page id: runAction opens it itself. */
      ids.delete('bell');
    }
    const menu = normaliseMenu(explicit ? input.menu ?? [] : mirror?.menu ?? []);
    if (titleEditable && !ids.has('editTitle')) menu.push(normalise({ id: 'editTitle', label: 'Nummer wijzigen', symbol: 'pencil.line' }));
    if (contribution?.menu?.length) {
      if (menu.length) menu.push({ separator: true });
      menu.push(...normaliseMenu(contribution.menu));
    }
    const accessory = (explicit ? input.accessory : mirror?.accessory) ?? undefined;
    const titleMenu = input?.titleMenu === 'auto' ? this.autoTitleMenu(url) : undefined;
    for (const row of titleMenu ?? []) ids.add(row.id);
    const workspaceTabs = input?.workspaceTabs ?? contribution?.workspaceTabs ?? mirror?.workspaceTabs ?? undefined;

    const stack = this.stackFor(url, title);
    owner.ids = ids;
    const page: HostPage = {
      type: 'page', url, title, chrome: input?.chrome ?? true, statusBar: input?.statusBar ?? 'dark', largeTitle, condensed, stack,
      actions, menu, tabBar: input?.tabBar ?? (workspaceTabs ? contribution?.tabBar ?? workspaceOf(url) ?? 'hidden' : 'erp'),
      source: explicit ? 'host' : 'mirror',
    };
    if (subtitle) page.subtitle = subtitle;
    if (titleEditable) page.titleEditable = true;
    if (back) page.back = back;
    if (primary) page.primary = primary;
    if (titleMenu) page.titleMenu = titleMenu;
    if (accessory) page.accessory = normalise({ prominent: accessory.icon === 'plus' || accessory.symbol === 'plus', ...accessory });
    if (workspaceTabs) page.workspaceTabs = workspaceTabs.map((tab) => ({ ...tab, symbol: tab.symbol || resolveSymbol({ icon: tab.icon, label: tab.label }) || 'circle.dashed' }));
    if (input?.guardsBack) page.guardsBack = true;
    if (overlay) page.overlay = true;
    if (input?.refreshable) page.refreshable = true;
    if (input?.tabBar === undefined) (page as HostPage & { probe?: boolean }).probe = true;
    return page;
  }

  /** The section's pages as title-menu rows: the tab bar's long-press list, with the queue's counts. */
  private autoTitleMenu(url: string): HostTitleRow[] | undefined {
    const tab = phoneTabForUrl(url);
    const menu = tabMenuFor(tab, NAV_GROUPS);
    if (!menu) return undefined;
    const work = this.injector.get(WorkQueue);
    return menu.rows.map((row) => {
      const target = navItemUrl(row.item);
      const count = row.item.countKey ? work[row.item.countKey]() : 0;
      const entry: HostTitleRow = {
        id: 'nav:' + target, label: row.label, icon: row.item.icon, symbol: resolveSymbol({ icon: row.item.icon, label: row.label }) ?? 'circle.dashed',
        current: navItemActive(row.item, url) && phoneTabForUrl(target) === tab, url: target,
      };
      if (count) entry.count = count;
      return entry;
    });
  }

  private stackFor(url: string, title: string): HostStackEntry[] {
    const entries: HostStackEntry[] = this.history.hostStack().map((entry) => ({ url: entry, title: screenLabel(entry) || returnLabel(entry) }));
    const top = entries[entries.length - 1];
    if (!top || top.url !== url) entries.push({ url, title });
    else top.title = title;
    return entries;
  }

  private contributionFor(url: string): HostContribution | null {
    const workspace = workspaceOf(url);
    if (!workspace) return null;
    return this.bridge.contributions().get(workspace) ?? null;
  }

  private publish(owner: Owner, page: HostPage): void {
    this.owner = owner;
    owner.page = page;
    this.pending = page;
    this.cancelFallback();
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    const view = this.win;
    if (!view) return;
    view.cancelAnimationFrame(this.frame);
    this.frame = view.requestAnimationFrame(() => this.flush());
  }

  /** One post per frame, only when something changed; the tab-bar probe reads the DOM as it is now. */
  private flush(): void {
    const page = this.pending;
    if (!page) return;
    this.pending = null;
    const url = this.router.url;
    const out: HostPage & { probe?: boolean } = { ...page, url };
    if (out.probe) {
      delete out.probe;
      const probe = this.probeTabBar();
      if (probe === 'erp') out.tabBar = 'erp';
      else if (out.workspaceTabs) out.tabBar = this.contributionFor(url)?.tabBar ?? workspaceOf(url) ?? 'hidden';
      else out.tabBar = 'hidden';
    }
    if (out.stack[out.stack.length - 1]?.url !== url) out.stack = this.stackFor(url, out.title);
    const json = JSON.stringify(out);
    this.publishedUrl = url;
    if (json === this.lastSent) return;
    this.lastSent = json;
    this.bridge.send(out);
    if (this.lastCondensed !== out.condensed) {
      this.lastCondensed = out.condensed;
      this.bridge.send({ type: 'scroll', condensed: out.condensed });
    }
  }

  /** The ERP tab bar as the existing CSS decides it: hidden by the editors, the catalogue studio, the PO dock and the workspace pages. */
  private probeTabBar(): 'erp' | 'hidden' {
    const bar = this.document.querySelector('.tabbar');
    if (!bar || !this.win) return 'hidden';
    return this.win.getComputedStyle(bar).display === 'none' ? 'hidden' : 'erp';
  }

  private scheduleFallback(): void {
    this.cancelFallback();
    this.fallbackTimer = setTimeout(() => {
      this.fallbackTimer = null;
      const url = this.router.url;
      if (this.owner && this.publishedUrl === url) return;
      const title = screenLabel(url) || returnLabel(url) || 'Enrosed';
      const contribution = this.contributionFor(url);
      const page: HostPage & { probe?: boolean } = {
        type: 'page', url, title, chrome: true, statusBar: 'dark', largeTitle: false, condensed: true, stack: this.stackFor(url, title),
        actions: [], menu: contribution?.menu ? [...contribution.menu] : [], tabBar: 'hidden', source: 'mirror', probe: true,
      };
      if (contribution?.workspaceTabs) page.workspaceTabs = contribution.workspaceTabs;
      this.pending = page;
      this.flush();
    }, FALLBACK_MS);
  }

  private cancelFallback(): void {
    if (this.fallbackTimer !== null) clearTimeout(this.fallbackTimer);
    this.fallbackTimer = null;
  }

  /* ------------------------------------------------------------- commands */

  private dispatch(command: HostCommand): void {
    switch (command.type) {
      case 'action': this.runAction(command.id); break;
      case 'back': this.history.popScreens(command.count ?? 1, () => this.webBack()); break;
      case 'open': {
        const nav: HostNavDirection = command.nav ?? 'push';
        void this.router.navigateByUrl(command.url, { info: { nav }, replaceUrl: nav === 'replace' || nav === 'tab' });
        break;
      }
      case 'tabRoot': this.win?.scrollTo({ top: 0, behavior: scrollBehavior() }); break;
      case 'lifecycle': if (command.state === 'active') void this.injector.get(WorkQueue).refresh(); break;
      case 'refresh': this.runRefresh(); break;
      case 'insets': {
        const { top, right, bottom, left } = command;
        this.bridge.insets.set({ top, right, bottom, left });
        const style = this.document.documentElement.style;
        style.setProperty('--host-safe-t', `${top}px`);
        style.setProperty('--host-safe-r', `${right}px`);
        style.setProperty('--host-safe-b', `${bottom}px`);
        style.setProperty('--host-safe-l', `${left}px`);
        break;
      }
      case 'sessionCheck': this.injector.get(Auth).recheckSession(); break;
      default: this.bridge.send({ type: 'log', level: 'warn', text: `unknown command ${(command as { type?: string }).type}` });
    }
  }

  private runAction(id: string): void {
    const owner = this.owner;
    if (id === 'editTitle' && owner?.source.onTitle) { void this.editTitle(owner); return; }
    /* The reserved pull-to-refresh id, unless the page declared a `refresh` action or menu row of its own (Kosten & bank's Vernieuwen). */
    if (id === 'refresh' && !owner?.ids.has(id)) { this.runRefresh(); return; }
    if (owner?.source.mirror?.()?.click(id)) return;
    if (id.startsWith('nav:')) { void this.router.navigateByUrl(id.slice(4), { info: { nav: 'push' } }); return; }
    if (id.startsWith('ext:')) { this.bridge.send({ type: 'openExternal', url: id.slice(4) }); return; }
    if (id === 'workspaceBack') { this.leaveTo(this.injector.get(WorkspaceReturn).phoneUrl()); return; }
    if (owner?.ids.has(id)) { owner.source.onAction({ id, finish: () => undefined }); return; }
    for (const contribution of this.bridge.contributions().values()) if (contribution.action?.(id)) return;
    if (id === 'bell' && owner?.source.bell) { owner.source.bell()?.open(); return; }
    if (owner) owner.source.onAction({ id, finish: () => undefined });
    else this.bridge.send({ type: 'log', level: 'warn', text: `action ${id} without a page` });
  }

  /**
   * A native back with nothing below in history: a page whose back control
   * names a url leaves without growing the stack; otherwise the page's own
   * control runs (a folder up, a document's section).
   */
  private webBack(): void {
    const url = this.owner?.page?.back?.url;
    if (url) this.leaveTo(url);
    else this.owner?.source.onBack();
  }

  /**
   * Leaves for `url` the way the native stack expects: history back when
   * that screen lies below (hostStack and screensBelow collapse the same
   * screens), else a replace, so the depth never grows. A forward
   * navigation here would push the origin on top of the workspace in the
   * shell's NavigationStack.
   */
  private leaveTo(url: string): void {
    const screens = this.history.hostStack();
    const at = screens.slice(0, -1).map(navPath).lastIndexOf(navPath(url));
    if (at >= 0) { this.history.popScreens(screens.length - 1 - at, () => undefined); return; }
    void this.router.navigateByUrl(url, { info: { nav: 'pop' }, replaceUrl: true });
  }

  /** Pull to refresh: the page's own refresh when it declares one, else the work queue; `refreshDone` either way. */
  private runRefresh(): void {
    const owner = this.owner;
    this.finishRefresh();
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      this.refreshFinish = null;
      this.bridge.send({ type: 'refreshDone' });
    };
    this.refreshFinish = finish;
    const timer = setTimeout(finish, REFRESH_TIMEOUT_MS);
    const settle = (work?: Promise<unknown> | void): void => {
      void Promise.resolve(work).catch(() => undefined).then(() => { clearTimeout(timer); finish(); });
    };
    if (owner?.page?.refreshable) owner.source.onAction({ id: 'refresh', finish: settle });
    else settle(this.injector.get(WorkQueue).refresh(true));
  }

  private finishRefresh(): void {
    this.refreshFinish?.();
  }

  private async editTitle(owner: Owner): Promise<void> {
    const current = owner.page?.title ?? '';
    const value = await this.bridge.prompt({ title: 'Nummer wijzigen', value: current, confirm: 'Opslaan' }).catch(() => null);
    const next = (value ?? '').trim();
    if (next && next !== current) owner.source.onTitle?.(next);
  }

  /* ------------------------------------------------------------- the shell */

  /**
   * Registers the command handlers with the host script, tells it the web
   * is ready and starts the shell-level messages (ready, auth, badges,
   * theme, nav.willChange). The facade calls it once, in host mode only.
   */
  start(): void {
    if (!this.win) return;
    const win = this.win;
    const receive = (json: string | object): void => {
      try {
        const command = (typeof json === 'string' ? JSON.parse(json) : json) as HostCommand;
        if (command && typeof command === 'object' && typeof command.type === 'string') this.dispatch(command);
      } catch (failure) {
        this.bridge.send({ type: 'log', level: 'error', text: `bad command: ${failure instanceof Error ? failure.message : String(failure)}` });
      }
    };
    const global = win.enrosedHost;
    if (global && typeof global.on === 'function') {
      for (const type of COMMAND_TYPES) global.on(type, receive);
    } else if (global) {
      global.receive = receive;
    } else {
      win.enrosedHost = { version: HOST_VERSION, platform: 'ios', device: this.bridge.device ?? 'phone', receive };
    }
    global?.ready?.();

    this.router.events.subscribe((event) => {
      if (event instanceof NavigationStart) {
        const from = this.router.url;
        this.navStartUrl = event.url;
        const extras = this.router.currentNavigation()?.extras;
        const named = navInfoDirection(extras?.info);
        let direction: HostNavDirection;
        if (event.navigationTrigger === 'popstate') direction = 'pop';
        else if ((extras?.info as { nav?: string } | undefined)?.nav === 'replace') direction = 'replace';
        else if (extras?.replaceUrl || extras?.skipLocationChange) direction = named === 'tab' ? 'tab' : 'replace';
        else {
          const computed = named ?? navDirection(from, event.url, event.navigationTrigger ?? 'imperative', extras?.info, PHONE_TABS);
          direction = computed === 'none' ? 'replace' : computed;
        }
        this.bridge.send({ type: 'nav.willChange', direction, to: event.url });
      } else if (event instanceof NavigationEnd) {
        /* A redirect settled elsewhere: the host's latest URL must be the one the page will carry. */
        if (this.navStartUrl !== null && event.urlAfterRedirects !== this.navStartUrl) {
          this.bridge.send({ type: 'nav.willChange', direction: 'replace', to: event.urlAfterRedirects });
        }
        this.navStartUrl = null;
        this.scheduleFallback();
      } else if (event instanceof NavigationError || (event instanceof NavigationCancel
          && event.code !== NavigationCancellationCode.Redirect
          && event.code !== NavigationCancellationCode.SupersededByNewNavigation)) {
        /* The navigation never happened (a guard refused it, the leave question answered Annuleren): the shell's latest
           URL comes back to the page it still shows, and that page goes out again, since the shell dropped what arrived in
           between as stale. A redirect or a superseding navigation brings its own NavigationStart and needs nothing here. */
        if (this.navStartUrl === null) return;
        this.navStartUrl = null;
        this.bridge.send({ type: 'nav.willChange', direction: 'replace', to: this.router.url });
        this.lastSent = '';
        if (this.owner?.page) { this.pending = this.owner.page; this.scheduleFlush(); } else this.scheduleFallback();
      }
    });

    const auth = this.injector.get(Auth);
    const work = this.injector.get(WorkQueue);
    const theme = this.injector.get(Theme);
    effect(() => { this.bridge.send({ type: 'auth', loggedIn: auth.isLoggedIn() }); }, { injector: this.injector });
    effect(() => {
      const sales = work.actionCount();
      const more = work.loginRequestCount();
      this.bridge.send({ type: 'badges', sales, more, bell: sales });
    }, { injector: this.injector });
    effect(() => {
      theme.current();
      /* The palette class lands in Theme's own effect: read the colours a tick later. */
      queueMicrotask(() => this.bridge.send({ type: 'theme', ...this.themeColours() }));
    }, { injector: this.injector });

    this.bridge.send({
      type: 'ready', hostVersion: HOST_VERSION, app: this.buildId(), loggedIn: auth.isLoggedIn(), theme: this.themeColours(),
      url: `${win.location.pathname}${win.location.search}`,
    });
    this.scheduleFallback();
  }

  private themeColours(): HostTheme {
    const style = this.win?.getComputedStyle(this.document.documentElement);
    const read = (name: string, fallback: string): string => (style?.getPropertyValue(name).trim() || fallback);
    return { accent: read('--rose', '#1f7a4d'), accentDark: read('--rose-dark', '#145c39'), background: read('--ios-bg', '#f2efeb') };
  }

  /** The main script's file name: production builds hash it, so it names the build. */
  private buildId(): string {
    const src = this.document.querySelector<HTMLScriptElement>('script[src*="main"]')?.getAttribute('src') ?? '';
    return src.split('/').pop() || 'dev';
  }
}
