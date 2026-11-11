import { DOCUMENT } from '@angular/common';
import { Injectable, Injector, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { Auth } from '../api/auth';
import { InFlight } from '../api/in-flight';
import {
  BUILD_ALIVE_MS, BUILD_ARRIVAL_MAX_MS, BUILD_ARRIVAL_REST_MS, BUILD_ARRIVAL_SETTLE_MS, BUILD_BACKSTAGE_DELAY_MS, BUILD_BACKSTAGE_SPREAD_MS,
  BUILD_CHECK_GAP_MS, BUILD_CHECK_INTERVAL_MS, BUILD_CONFIRM_GAP_MS, BUILD_CONFIRM_MS, BUILD_CONFIRM_SLOW_MS, BUILD_FETCH_TIMEOUT_MS,
  BUILD_HELD_MS, BUILD_PICK_MS, BUILD_PREFETCH_TIMEOUT_MS, BUILD_QUIET_MS, BUILD_RETRY_MS, BUILD_SCROLL_KEEP_MS, BUILD_SCROLL_WAIT_MS,
  BUILD_TRIES, BUILD_VIEW_QUIET_MS, BUILD_WAKE_RETRY_MS, BUILD_WAKE_SETTLE_MS, BUILD_WATCH_MS, buildIdOf, buildOfHtml, decideBuildReload,
  isStaffUrl, pendingBuild,
} from './fresh-build';
import type { BuildMoment, BuildPage, BuildSituation, BuildVerdict } from './fresh-build';
import { HostBridge } from './host-bridge';
import { navPath, navScreen } from './nav-history';
import { NavHistory } from './nav-history-service';
import {
  fieldFocused, isTextField, readReloadRecord, sessionStore, surfaceOpen, unsavedWork, workInHand, writeReloadRecord,
} from './reload-guard';

/** sessionStorage: where the page stood when it reloaded itself, put back once by the page that loads next. */
const SCROLL_KEY = 'enrosed.build.scroll';
/** The inner scrollers of the desk workspaces and desks: a quiet reload there must not jump to the top. */
const SCROLL_PANES = '.wk-pane, .wk-inspector, .desk-panel';
/**
 * sessionStorage, read by a development build only (unhashed entry files; a production build never looks at it):
 * `{ "running": "main-AAAAAAAA.js|styles-AAAAAAAA.css", "latest": "main-AAAAAAAA.js|styles-BBBBBBBB.css",
 *    "checkMs": 2000, "quietMs": 15000, "viewMs": 30000, "watchMs": 2000 }`
 * makes the app behave as build `running` that sees `latest` live, with short timings, and prints every decision.
 */
const DEBUG_KEY = 'enrosed.build.debug';
const DEBUG_RUNNING = 'main-DEVBUILD.js';

interface BuildDebug {
  running?: string;
  latest?: string;
  checkMs?: number;
  quietMs?: number;
  viewMs?: number;
  watchMs?: number;
}

interface KeptScroll {
  at: number;
  url: string;
  y: number;
  /** [index among SCROLL_PANES in document order, scrollTop]. */
  panes: [number, number][];
}

type Asked = 'answered' | 'failed' | 'skipped';

function wait(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

function isFileInput(target: EventTarget | null): target is HTMLInputElement {
  return target instanceof HTMLInputElement && target.type === 'file';
}

/** The field still holds what someone put in it. */
function hasContent(field: Element): boolean {
  if (field instanceof HTMLInputElement) return field.type === 'file' ? (field.files?.length ?? 0) > 0 : field.value !== '';
  if (field instanceof HTMLTextAreaElement) return field.value !== '';
  return (field.textContent ?? '').trim() !== '';
}

/**
 * Notices a newer build and reloads the page for it at a moment when nothing
 * can be lost and nobody is interrupted. The rules are in fresh-build.ts
 * (decideBuildReload); this half reads the page, asks the server and reloads.
 * A lazy chunk, started by the App shell for a signed-in person on a staff
 * screen only; in a development build start() installs nothing.
 */
@Injectable({ providedIn: 'root' })
export class FreshBuild {
  private readonly document = inject(DOCUMENT);
  private readonly router = inject(Router);
  private readonly auth = inject(Auth);
  private readonly inFlight = inject(InFlight);
  private readonly host = inject(HostBridge);
  private readonly history = inject(NavHistory);
  private readonly win = this.document.defaultView as Window;

  /** The build this document runs; '' until start() read it, and for good in a development build. */
  private running = '';
  private latest = '';
  /** The hashed files the latest build's index.html names. */
  private files: string[] = [];
  /** The build whose files are in the browser's cache. */
  private readyFor = '';
  private fetching: Promise<void> | null = null;
  private askedAt = 0;
  private answeredAt = 0;
  private checking: Promise<Asked> | null = null;

  /* Signs of a person on this page (the native chrome's are on HostBridge.touchedAt). */
  private presenceAt = 0;
  private actedAt = 0;
  private downAt = 0;
  private upAt = 0;
  private pickingAt = 0;
  private viewTouched = false;
  private readonly typedFields = new Set<Element>();

  private screen: string | null = null;
  private arrivedAt = 0;
  private arrivedUrl = '';
  private arrival = 0;

  /** Until when a page that just came back in view is left to settle. */
  private settleUntil = 0;
  private attempting = false;
  private reloading = false;
  private watch: ReturnType<typeof setInterval> | null = null;
  private stop: (() => void) | null = null;
  private scrollRestored = false;
  private debug: BuildDebug | null = null;
  private lastSaid = '';

  private gapMs = BUILD_CHECK_GAP_MS;
  private intervalMs = BUILD_CHECK_INTERVAL_MS;
  private quietMs = BUILD_QUIET_MS;
  private viewMs = BUILD_VIEW_QUIET_MS;
  private watchMs = BUILD_WATCH_MS;

  /** Starts watching; returns the stop. Safe to call again after a stop (signed out and in again, a customer page in between). */
  start(): () => void {
    if (this.stop) return this.stop;
    const doc = this.document;
    const win = this.win;
    if (!this.running) {
      const urls = Array.from(doc.querySelectorAll('script[src], link[rel="stylesheet"][href]'),
        (element) => element.getAttribute('src') ?? element.getAttribute('href'));
      const real = buildIdOf(urls);
      this.debug = real ? null : this.readDebug();
      this.running = real || (this.debug ? this.debug.running || DEBUG_RUNNING : '');
      /* A development build: nothing is installed. */
      if (!this.running) return () => undefined;
      /* The page was loaded from index.html this moment: it counts as just asked, and as just touched. */
      this.latest = this.readyFor = this.running;
      this.askedAt = this.answeredAt = this.presenceAt = Date.now();
      if (this.debug) {
        this.gapMs = this.intervalMs = this.debug.checkMs ?? this.gapMs;
        this.quietMs = this.debug.quietMs ?? this.quietMs;
        this.viewMs = this.debug.viewMs ?? this.viewMs;
        this.watchMs = this.debug.watchMs ?? this.watchMs;
      }
    }

    const undo: (() => void)[] = [];
    /* Capture and passive: one assignment per event, before any handler of the app can stop it. The app is zoneless. */
    const listen = (target: EventTarget, types: string[], handler: (event: Event) => void): void => {
      for (const type of types) {
        target.addEventListener(type, handler, { capture: true, passive: true });
        undo.push(() => target.removeEventListener(type, handler, { capture: true }));
      }
    };
    listen(doc, ['pointerdown', 'touchstart'], () => { this.presenceAt = this.actedAt = this.downAt = Date.now(); });
    listen(doc, ['pointerup', 'pointercancel', 'touchend', 'touchcancel'], () => { this.upAt = Date.now(); });
    /* A mouse keeps moving after the click that brought the screen: presence, not an act on this screen. */
    listen(doc, ['pointermove'], () => { this.presenceAt = Date.now(); });
    listen(doc, ['touchmove', 'wheel', 'keydown'], () => { this.presenceAt = this.actedAt = Date.now(); });
    listen(doc, ['input', 'change', 'paste', 'cut', 'drop'], (event) => this.edited(event));
    listen(doc, ['click'], (event) => { if (isFileInput(event.target)) this.pickingAt = Date.now(); });
    listen(doc, ['cancel'], (event) => { if (isFileInput(event.target)) this.pickingAt = 0; });
    listen(doc, ['visibilitychange'], () => {
      if (doc.visibilityState === 'visible') void this.wake();
      else this.upAt = Date.now();
    });
    listen(win, ['pageshow'], () => void this.wake());
    undo.push(this.host.onLifecycle((state) => { if (state === 'active') void this.wake(); }));
    const timer = setInterval(() => void this.tick(), this.intervalMs);
    undo.push(() => clearInterval(timer));
    const events = this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) this.navigated(event.urlAfterRedirects);
    });
    undo.push(() => events.unsubscribe());

    this.screen = this.router.navigated ? navPath(navScreen(this.router.url)) : null;
    if (!this.scrollRestored) {
      this.scrollRestored = true;
      this.restoreScroll();
    }

    const stop = (): void => {
      if (this.stop !== stop) return;
      for (const off of undo) off();
      if (this.watch !== null) clearInterval(this.watch);
      this.watch = null;
      this.arrival++;
      this.stop = null;
    };
    this.stop = stop;
    this.syncWatch();
    return stop;
  }

  /* ------------------------------------------------------------ the person */

  /** Text in a field is work; a search, a filter, a tick or a choice is a view of the screen. */
  private edited(event: Event): void {
    const target = event.target instanceof Element ? event.target : null;
    if (isFileInput(target)) {
      if (event.type !== 'change') return;
      this.pickingAt = 0;
      if (target.files?.length) this.typedFields.add(target);
      return;
    }
    if (target && isTextField(target)) this.typedFields.add(target);
    else this.viewTouched = true;
  }

  /** Something typed (or a chosen file) still stands in a field on screen; a closed sheet's fields have left the document. */
  private typedText(): boolean {
    for (const field of this.typedFields) {
      if (!field.isConnected) this.typedFields.delete(field);
      else if (hasContent(field)) return true;
    }
    return false;
  }

  /* ---------------------------------------------------------- where we are */

  private visible(): boolean {
    return this.document.visibilityState === 'visible';
  }

  /** Native shell: the app is in the background (iOS suspends it within seconds: a load started now would freeze). */
  private appAway(): boolean {
    return this.host.present && this.host.lifecycle === 'background';
  }

  /** Native shell: a tab that is not on screen while the app is in front. Nobody looks at it, and it can load. */
  private backstage(): boolean {
    return this.host.present && !this.visible() && this.host.lifecycle !== 'background';
  }

  private eligible(): boolean {
    return this.running !== '' && !this.reloading && this.auth.isLoggedIn() && isStaffUrl(this.router.url) && !this.appAway()
      && (this.visible() || this.backstage());
  }

  private isPending(): boolean {
    return pendingBuild(this.running, this.latest, readReloadRecord(sessionStore(this.win)).build);
  }

  /* -------------------------------------------------------- asking the server */

  /** Asks for the latest build unless the last ask is younger than `gapMs`. */
  private ask(gapMs: number): Promise<Asked> {
    if (this.checking) return this.checking;
    const now = Date.now();
    if (now - this.askedAt < gapMs) return Promise.resolve<Asked>('skipped');
    const before = this.askedAt;
    this.askedAt = now;
    this.checking = this.fetchLatest().then((page): Asked => {
      if (!page) {
        /* A failed check does not use up the gap: the next one may follow after BUILD_RETRY_MS. */
        this.askedAt = Math.max(before, Date.now() - this.gapMs + Math.min(BUILD_RETRY_MS, this.gapMs));
        return 'failed';
      }
      this.latest = page.id;
      this.files = page.files;
      this.answeredAt = Date.now();
      this.syncWatch();
      if (this.isPending() && this.readyFor !== this.latest) void this.prefetch();
      return 'answered';
    }).finally(() => { this.checking = null; });
    return this.checking;
  }

  /** The build a fresh index.html names; null when it could not be read. Plain fetch: no login header leaves for the static host, and InFlight does not count it. */
  private async fetchLatest(): Promise<BuildPage | null> {
    if (this.debug) {
      const latest = this.readDebug()?.latest;
      return latest ? { id: latest, files: [] } : null;
    }
    const control = new AbortController();
    const timer = setTimeout(() => control.abort(), BUILD_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(new URL('index.html', this.document.baseURI).href, { cache: 'no-store', signal: control.signal });
      return response.ok ? buildOfHtml(await response.text()) : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Downloads the latest build's files into the browser's cache (the host serves them immutable), so the reload itself
   * only needs index.html. All of them within BUILD_PREFETCH_TIMEOUT_MS, or the build is not ready and the watch tries
   * again; what did arrive is in the cache by then.
   */
  private prefetch(): Promise<void> {
    if (this.fetching) return this.fetching;
    const id = this.latest;
    const files = this.files;
    this.fetching = this.fetchFiles(files).then((ok) => {
      if (ok && this.latest === id) this.readyFor = id;
    }).finally(() => {
      this.fetching = null;
      /* A build found on coming back in view becomes ready a moment later: the quiet moment may still hold. */
      if (this.readyFor === id && this.eligible()) void this.attempt('quiet');
    });
    return this.fetching;
  }

  private async fetchFiles(files: readonly string[]): Promise<boolean> {
    if (this.debug) return true;
    const control = new AbortController();
    const timer = setTimeout(() => control.abort(), BUILD_PREFETCH_TIMEOUT_MS);
    try {
      const arrived = await Promise.all(files.map(async (file) => {
        const response = await fetch(new URL(file, this.document.baseURI).href, { signal: control.signal });
        /* A host that answers a missing file with the app's page (200, text/html) has not got the build yet. */
        const type = response.headers.get('content-type') ?? '';
        if (!response.ok || !(/\.css(?:[?#]|$)/.test(file) ? /css/i : /javascript|ecmascript/i).test(type)) return false;
        await response.arrayBuffer();
        return true;
      }));
      return arrived.every(Boolean);
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  /** While a newer build waits for its moment the page looks again every watchMs. */
  private syncWatch(): void {
    const pending = this.stop !== null && this.isPending();
    if (pending && this.watch === null) this.watch = setInterval(() => this.watchTick(), this.watchMs);
    else if (!pending && this.watch !== null) { clearInterval(this.watch); this.watch = null; }
  }

  private watchTick(): void {
    if (!this.eligible()) return;
    if (!this.isPending()) { this.syncWatch(); return; }
    if (this.readyFor !== this.latest && !this.fetching) void this.prefetch();
    void this.attempt('quiet');
  }

  /* ------------------------------------------------------------ the moments */

  /** The page came back in view (or the native app came to the front): ask, settle, and reload if it has been quiet. */
  private async wake(): Promise<void> {
    if (!this.eligible()) return;
    const at = Date.now();
    this.settleUntil = at + BUILD_WAKE_SETTLE_MS;
    /* The tabs that are not on screen follow the one in view, spread out. */
    if (!this.visible()) await wait(BUILD_BACKSTAGE_DELAY_MS + Math.random() * BUILD_BACKSTAGE_SPREAD_MS);
    if (await this.ask(this.gapMs) === 'failed') {
      /* The first request after iOS woke the app often fails. */
      await wait(BUILD_WAKE_RETRY_MS);
      await this.ask(0);
    }
    await this.attempt('quiet');
  }

  private async tick(): Promise<void> {
    if (!this.eligible()) return;
    await this.ask(this.gapMs);
    await this.attempt('quiet');
  }

  /** A navigation ended. Another path is another screen; a filter, a tab or a section of Analyses is the same one. */
  private navigated(url: string): void {
    const next = navPath(navScreen(url));
    const before = this.screen;
    this.screen = next;
    if (before === next) {
      /* The screen changed its own address: a filter or tab set by hand, or something taken from the address into memory. */
      this.viewTouched = true;
      return;
    }
    this.viewTouched = false;
    this.pickingAt = 0;
    /* The first navigation of a document is the load itself, not an arrival. */
    if (before === null) return;
    this.arrivedAt = Date.now();
    this.arrivedUrl = url;
    const token = ++this.arrival;
    if (this.eligible() && this.visible()) void this.arrived(token);
  }

  /** Waits until the arrived screen has come to rest, then tries; gives up after BUILD_ARRIVAL_MAX_MS or on the next arrival. */
  private async arrived(token: number): Promise<void> {
    const at = this.arrivedAt;
    /* Beside the screen's own loading, so the answer is there when the screen has come to rest. */
    const stale = this.isPending() && Date.now() - this.answeredAt > BUILD_CONFIRM_MS;
    void this.ask(stale ? BUILD_CONFIRM_GAP_MS : this.gapMs);
    await wait(BUILD_ARRIVAL_SETTLE_MS);
    let restSince = 0;
    while (token === this.arrival && Date.now() - at <= BUILD_ARRIVAL_MAX_MS) {
      const now = Date.now();
      if (this.inFlight.reads + this.inFlight.writes > 0 || this.checking || this.fetching) restSince = 0;
      else if (!restSince) restSince = now;
      else if (now - restSince >= BUILD_ARRIVAL_REST_MS) { await this.attempt('arrival', token); return; }
      await wait(100);
    }
    if (token === this.arrival && this.isPending()) this.say('arrival', { act: 'none', why: 'late' });
  }

  private async attempt(moment: BuildMoment, token?: number): Promise<void> {
    if (this.attempting || this.reloading || !this.running) return;
    this.attempting = true;
    try {
      /* Just back in view: whatever came with the return (a link the native shell opens, the first tap) goes first. */
      if (moment === 'quiet' && Date.now() < this.settleUntil) await wait(this.settleUntil - Date.now());
      let verdict = decideBuildReload(this.situation(moment));
      if (verdict.act === 'confirm') {
        /* The page is only given up seconds after the server answered, and answered fast. */
        const started = Date.now();
        const asked = await this.ask(BUILD_CONFIRM_GAP_MS);
        if (moment === 'arrival' && token !== this.arrival) return;
        if (asked !== 'answered' || Date.now() - started > BUILD_CONFIRM_SLOW_MS) verdict = { act: 'none', why: 'slow' };
        else verdict = decideBuildReload(this.situation(moment));
      }
      this.say(moment, verdict);
      if (verdict.act === 'reload') this.reload(moment);
    } finally {
      this.attempting = false;
    }
  }

  private situation(moment: BuildMoment): BuildSituation {
    const now = Date.now();
    const doc = this.document;
    const store = sessionStore(this.win);
    const reloadedFor = readReloadRecord(store).build;
    const pending = pendingBuild(this.running, this.latest, reloadedFor);
    const touchedAt = this.host.touchedAt;
    const situation: BuildSituation = {
      moment, running: this.running, latest: this.latest, reloadedFor, ready: this.readyFor === this.latest,
      canRemember: store !== null,
      staff: this.auth.isLoggedIn() && isStaffUrl(this.router.url),
      visible: this.visible(), backstage: this.backstage(), appAway: this.appAway(),
      online: this.win.navigator.onLine !== false,
      navigating: this.router.currentNavigation() !== null,
      surfaceOpen: surfaceOpen(doc),
      fieldFocused: fieldFocused(doc),
      writing: this.inFlight.writes > 0,
      asking: this.host.asking,
      picking: this.pickingAt > 0 && now - this.pickingAt < BUILD_PICK_MS,
      unsaved: false,
      typed: this.typedText(),
      handed: this.router.url !== this.arrivedUrl,
      acted: Math.max(this.actedAt, touchedAt) > this.arrivedAt || (this.downAt > this.upAt && now - this.downAt < BUILD_HELD_MS),
      late: now - this.arrivedAt > BUILD_ARRIVAL_MAX_MS,
      quietForMs: now - Math.max(this.presenceAt, touchedAt), quietMs: this.quietMs,
      viewTouched: this.viewTouched, viewQuietMs: this.viewMs,
      confirmedAgoMs: now - this.answeredAt,
    };
    /* The editors are only asked when the decision gets that far (nothing open, nobody typing), and only while a build waits. */
    Object.defineProperty(situation, 'unsaved', { enumerable: true, get: () => pending && (workInHand(doc) || unsavedWork(this.win)) });
    return situation;
  }

  /* -------------------------------------------------------------- the reload */

  private reload(moment: BuildMoment): void {
    const store = sessionStore(this.win);
    if (!store) return;
    const kept = this.history.keepForReload();
    /* In the native shell a stack that could not be kept would make the shell slide back to a root that shows this screen. */
    if (this.host.present && !kept && this.history.hostStack().length > 1) { this.history.dropKept(); return; }
    const record = readReloadRecord(store);
    const tries = record.tried === this.latest ? record.tries + 1 : 1;
    if (!writeReloadRecord(store, { ...record, build: this.latest, tried: this.latest, tries, at: Date.now() })) {
      this.history.dropKept();
      return;
    }
    this.keepScroll(store);
    /* The one trace: the native shell's log ("[web info] build … -> …: reload"). */
    this.host.send({ type: 'log', level: 'info', text: `build ${this.running} -> ${this.latest}: reload (${moment})` });
    this.reloading = true;
    /* Nothing reacts between this decision and the unload: a tap now would open a sheet that vanishes, or start a save nobody sees end. */
    const root = this.document.documentElement;
    root.inert = true;
    setTimeout(() => this.stillHere(store), BUILD_ALIVE_MS);
    this.win.location.reload();
  }

  /**
   * This document still runs BUILD_ALIVE_MS after its reload was asked for: the load never got through (the connection
   * dropped at that moment). Everything is as before, and this build gets one more chance at a later moment.
   */
  private stillHere(store: Storage): void {
    this.reloading = false;
    this.document.documentElement.inert = false;
    this.history.dropKept();
    try { store.removeItem(SCROLL_KEY); } catch { /* Nothing was kept then. */ }
    const record = readReloadRecord(store);
    if (record.build !== null && record.build === record.tried && record.tries < BUILD_TRIES) {
      writeReloadRecord(store, { ...record, build: null });
    }
    this.syncWatch();
  }

  private keepScroll(store: Storage): void {
    try {
      const panes: [number, number][] = [];
      this.document.querySelectorAll(SCROLL_PANES).forEach((pane, index) => {
        if (pane.scrollTop > 0) panes.push([index, Math.round(pane.scrollTop)]);
      });
      const y = Math.round(this.win.scrollY);
      if (y <= 0 && !panes.length) { store.removeItem(SCROLL_KEY); return; }
      const kept: KeptScroll = { at: Date.now(), url: this.router.url, y, panes };
      store.setItem(SCROLL_KEY, JSON.stringify(kept));
    } catch {
      /* The page then opens at the top. */
    }
  }

  /**
   * After a reload of our own the page stands where it stood: the window, and the inner scrollers of a workspace. Each
   * goes back once its content is long enough again (or after BUILD_SCROLL_WAIT_MS as far as it reaches); a person who
   * touches the page first keeps what they see.
   */
  private restoreScroll(): void {
    let kept: KeptScroll | null = null;
    try {
      const store = sessionStore(this.win);
      const raw = store?.getItem(SCROLL_KEY);
      if (!raw) return;
      store?.removeItem(SCROLL_KEY);
      kept = JSON.parse(raw) as KeptScroll;
    } catch {
      return;
    }
    const here = `${this.win.location.pathname}${this.win.location.search}`;
    if (!kept || typeof kept.y !== 'number' || !Array.isArray(kept.panes) || typeof kept.url !== 'string'
      || Date.now() - kept.at > BUILD_SCROLL_KEEP_MS || navPath(kept.url) !== navPath(here)) return;
    const started = Date.now();
    let navigatedAt = 0;
    let windowDone = kept.y <= 0;
    const panesLeft = new Map(kept.panes.filter((pane) => Array.isArray(pane) && pane.length === 2));
    const step = (): void => {
      const now = Date.now();
      if (Math.max(this.presenceAt, this.actedAt, this.host.touchedAt) > started || now - started > 10_000) return;
      if (this.router.navigated) {
        navigatedAt ||= now;
        const patient = now - navigatedAt < BUILD_SCROLL_WAIT_MS;
        if (!windowDone) {
          const root = this.document.scrollingElement;
          const reach = root ? root.scrollHeight - this.win.innerHeight : 0;
          if (reach >= kept.y || !patient) {
            this.win.scrollTo({ top: Math.max(0, Math.min(kept.y, reach)), behavior: 'instant' });
            windowDone = true;
          }
        }
        if (panesLeft.size) {
          const panes = this.document.querySelectorAll(SCROLL_PANES);
          for (const [index, top] of panesLeft) {
            const pane = panes[index];
            if (pane && (pane.scrollHeight - pane.clientHeight >= top || !patient)) {
              pane.scrollTop = top;
              panesLeft.delete(index);
            } else if (!pane && !patient) panesLeft.delete(index);
          }
        }
        if (windowDone && !panesLeft.size) return;
      }
      setTimeout(step, 100);
    };
    setTimeout(step, 100);
  }

  /* ------------------------------------------------------------- the debug hook */

  private readDebug(): BuildDebug | null {
    try {
      const parsed = JSON.parse(sessionStore(this.win)?.getItem(DEBUG_KEY) ?? 'null') as BuildDebug | null;
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  /** With the hook every decision is printed once per change; a production build prints nothing. */
  private say(moment: BuildMoment, verdict: BuildVerdict): void {
    if (!this.debug) return;
    const line = `${moment} ${verdict.act}${verdict.act === 'none' ? ' ' + verdict.why : ''} ${this.running} -> ${this.latest}`;
    if (line === this.lastSaid && verdict.act === 'none') return;
    this.lastSaid = line;
    console.info('[build]', line);
  }
}

/** Starts the watcher; returns the stop (the App shell's effect cleans up with it). */
export function installFreshBuild(injector: Injector): () => void {
  return injector.get(FreshBuild).start();
}
