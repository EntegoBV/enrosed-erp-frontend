import { DestroyRef, Injectable, Injector, computed, inject, signal, untracked } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { askHost, detectHost, postHostMessage } from './host';
import type {
  HostAction, HostAsk, HostBack, HostConfirmReply, HostHaptic, HostInfo, HostMenuItem, HostMessage, HostPromptReply, HostStatusBar, HostTab,
  HostTabBar, HostWindow,
} from './host';
import { NavHistory } from './nav-history-service';

/**
 * A page's explicit descriptor (`[host]` on app-page-header / app-ios-nav,
 * `[hostPage]` on a page without a header). Everything is optional: the
 * header fills title, subtitle, back, large title and the stack itself.
 * Action ids are the page's method names; `nav:<url>` ids navigate by
 * themselves, `ext:<url>` ids open outside the app, `workspaceBack` leaves
 * a workspace. `titleMenu: 'auto'` lists the tab's pages (tab-menu.ts).
 */
export interface HostPageInput {
  title?: string;
  subtitle?: string | null;
  chrome?: boolean;
  statusBar?: HostStatusBar;
  largeTitle?: boolean;
  titleEditable?: boolean;
  back?: HostBack | null;
  primary?: HostAction | null;
  actions?: HostAction[];
  menu?: HostMenuItem[];
  accessory?: HostAction | null;
  titleMenu?: 'auto' | null;
  /** Overrides the tab-bar probe (the editors, the PO view keeping the ERP bar, a selection mode hiding it). */
  tabBar?: HostTabBar;
  workspaceTabs?: HostTab[] | null;
  guardsBack?: boolean;
  refreshable?: boolean;
}

/** A native action arriving at a page; `finish` tells the host a refresh is done (other actions need not call it). */
export interface HostActionEvent {
  id: string;
  finish(work?: Promise<unknown> | void): void;
}

/** The controls of a header without `[host]`, read from its DOM (shared/host-page.ts describes them). */
export interface HostMirror {
  primary?: HostAction;
  actions: HostAction[];
  menu: HostMenuItem[];
  accessory?: HostAction;
  workspaceTabs?: HostTab[];
  /** Clicks the mirrored element behind an id; false when the id is not one of ours. */
  click(id: string): boolean;
}

/** What a header or a page hands the bridge; every reader is a signal read inside the bridge's effect. */
export interface HostPageSource {
  title: () => string;
  subtitle?: () => string | null | undefined;
  back?: () => HostBack | null;
  largeTitle?: () => boolean;
  condensed?: () => boolean;
  titleEditable?: () => boolean;
  /** The explicit descriptor; undefined or null means the mirror describes the header. */
  input: () => HostPageInput | null | undefined;
  mirror?: () => HostMirror | null;
  /** The header's own bell: its count and how to open it. */
  bell?: () => { count: number; open: () => void } | null;
  onAction: (event: HostActionEvent) => void;
  /** The web's own back control, for a native back when history has nothing below. */
  onBack: () => void;
  onTitle?: (value: string) => void;
}

/** What a long-lived part of a workspace adds to every page of it (the website's tab bar and its "…" rows). */
export interface HostContribution {
  tabBar?: HostTabBar;
  workspaceTabs?: HostTab[];
  menu?: HostMenuItem[];
  action?: (id: string) => boolean;
}

/** The text of a confirm message: the web's rich text without its tags, line breaks kept. */
export function plainText(doc: Document, html: string): string {
  const box = doc.createElement('div');
  box.innerHTML = html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>\s*<p[^>]*>/gi, '\n\n');
  return (box.textContent ?? '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** The lazily loaded half (host-bridge-impl.ts): composing and publishing the descriptors, the commands, the shell messages. */
export interface HostBridgeImplementation {
  bind(source: HostPageSource, destroyRef: DestroyRef): void;
  start(): void;
}

/**
 * The web half of the bridge to the native host: pages publish their
 * descriptor through `bind`, long-lived parts contribute through
 * `contribute`, the shell starts the message flow with `start`. Without a
 * host (`present` false) every method returns at once and nothing else of
 * host mode is loaded: this facade is all the PWA's initial bundle carries,
 * host-bridge-impl.ts (compose, publish, commands, shell messages) and
 * host-symbols.ts (the SF Symbol tables) are a lazy chunk loaded once by
 * the first `bind` or `start` inside a host.
 */
@Injectable({ providedIn: 'root' })
export class HostBridge {
  private readonly document = inject(DOCUMENT);
  private readonly history = inject(NavHistory);
  private readonly injector = inject(Injector);
  private readonly win = this.document.defaultView as (Window & HostWindow) | null;

  readonly info: HostInfo | null = detectHost(this.win, this.win?.navigator.userAgent);
  /** True inside the native host; frozen at start-up. */
  readonly present = this.info !== null;
  /** The device class the host reports: the iPhone Duo or another iPhone. */
  readonly device = this.info?.device ?? null;
  /** The native safe-area insets as the host last reported them (informational: the page trusts env()). */
  readonly insets = signal<{ top: number; right: number; bottom: number; left: number } | null>(null);
  /** Open phone sheets; read by the implementation's compose. */
  readonly overlays = signal(0);
  readonly contributions = signal<ReadonlyMap<string, HostContribution>>(new Map());

  private implementation: Promise<HostBridgeImplementation> | null = null;
  private started = false;

  private load(): Promise<HostBridgeImplementation> {
    return this.implementation ??= import('./host-bridge-impl').then((m) => this.injector.get(m.HostBridgeImpl));
  }

  /* ---------------------------------------------------------- transport */

  send(message: HostMessage): void {
    if (!this.present) return;
    postHostMessage(this.win, message);
  }

  /** Asks the host; rejects without a host or an ask handler. */
  ask(question: HostAsk): Promise<unknown> {
    if (!this.present) return Promise.reject(new Error('no host'));
    return askHost(this.win, question);
  }

  /** A native confirm; resolves like the web sheet would (ok, or the secondary choice). */
  confirm(options: { title: string; message?: string; confirm: string; cancel?: string; destructive?: boolean; secondary?: string }): Promise<HostConfirmReply> {
    const question: HostAsk = {
      type: 'confirm', title: options.title, message: options.message, confirm: options.confirm, cancel: options.cancel ?? 'Annuleren',
      destructive: options.destructive, secondary: options.secondary,
    };
    return this.ask(question).then((reply) => {
      const answer = (reply ?? {}) as Partial<HostConfirmReply>;
      return { ok: answer.ok === true, secondary: answer.secondary === true };
    });
  }

  /** A native text prompt; null when cancelled. */
  prompt(options: { title: string; message?: string; value: string; placeholder?: string; confirm: string; cancel?: string }): Promise<string | null> {
    return this.ask({ type: 'prompt', ...options, cancel: options.cancel ?? 'Annuleren' })
      .then((reply) => {
        const answer = (reply ?? {}) as Partial<HostPromptReply>;
        return typeof answer.value === 'string' ? answer.value : null;
      });
  }

  haptic(kind: HostHaptic): void {
    this.send({ type: 'haptic', kind });
  }

  /** A phone sheet opened or closed: the native tab bar hides while one is open. */
  overlay(open: boolean): void {
    if (!this.present) return;
    const before = untracked(() => this.overlays());
    const after = Math.max(0, before + (open ? 1 : -1));
    this.overlays.set(after);
    if ((before > 0) !== (after > 0)) this.send({ type: 'overlay', open: after > 0 });
  }

  /* ---------------------------------------------------------------- pages */

  /**
   * Publishes a page's descriptor whenever its sources change, and routes
   * the host's actions to it. Call from a component's constructor (it
   * reads the DestroyRef); the binding ends with the component.
   */
  bind(source: HostPageSource): void {
    if (!this.present) return;
    const destroyRef = inject(DestroyRef);
    let gone = false;
    destroyRef.onDestroy(() => { gone = true; });
    void this.load().then((impl) => { if (!gone) impl.bind(source, destroyRef); });
  }

  /** Adds (or removes, with null) what a workspace part contributes to every page while it lives. */
  contribute(key: string, contribution: HostContribution | null): void {
    if (!this.present) return;
    /* Called from a contributor's effect: reading the map untracked keeps that effect from depending on its own write. */
    const next = new Map(untracked(() => this.contributions()));
    if (contribution) next.set(key, contribution);
    else next.delete(key);
    this.contributions.set(next);
  }

  /** Loads the implementation and starts the shell-level messages. Called once by App in host mode. */
  start(): void {
    if (!this.present || this.started) return;
    this.started = true;
    void this.load().then((impl) => impl.start());
  }

  /** The open page's back control as a host sees it (null at a tab root). Exposed for pages that compose their own `back`. */
  readonly belowLabel = computed(() => this.history.belowLabel());
}
