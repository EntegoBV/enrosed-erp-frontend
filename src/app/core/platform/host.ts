/**
 * The native host (enrosed-erp-ios, 2026-10-29): the ERP runs inside a
 * WKWebView whose SwiftUI shell draws the tab bar, the navigation bar and
 * the toolbar items (on an iPhone Duo in the side strip). The web publishes
 * what every screen needs in its chrome (a page descriptor) and the shell
 * renders it; the shell sends back action ids, back pops, URLs to open.
 *
 * This file is the pure half: detection, the contract's types, the icon
 * table and the raw transport. No Angular, no DOM beyond what a function is
 * handed. The contract itself is tools/host-contract.json (kept in both
 * repos); `core/platform/host-bridge.ts` is the injectable half.
 *
 * Detection: `window.enrosedHost` (a WKUserScript at document start, so it
 * is there before Angular boots) or the user-agent suffix
 * `EnrosedHost/1 (iOS; duo|phone)`. Without either nothing here does
 * anything and the PWA is untouched: every host style lives under
 * `:root[data-host]` (styles/host.scss) and every message behind
 * `HostBridge.present`.
 */

export const HOST_VERSION = 1;

export type HostDevice = 'duo' | 'phone';

export interface HostInfo {
  version: number;
  platform: 'ios';
  device: HostDevice;
}

/** What the host's document-start script defines on `window`. */
export interface EnrosedHostGlobal {
  version?: number;
  platform?: string;
  device?: string;
  /** Native → web: a command, as a JSON string or an object. */
  receive?: (json: string | object) => void;
  /** Registers the web's handler for one command type. */
  on?: (type: string, handler: (command: HostCommand) => void) => void;
  /** The web has registered its handlers: queued commands may be replayed. */
  ready?: () => void;
}

interface WebKitHandlers {
  enrosed?: { postMessage(message: string): void };
  enrosedAsk?: { postMessage(message: string): Promise<unknown> };
}

export interface HostWindow {
  enrosedHost?: EnrosedHostGlobal;
  webkit?: { messageHandlers?: WebKitHandlers };
  navigator?: { userAgent?: string };
}

const UA_SUFFIX = /EnrosedHost\/(\d+)(?:\s*\(iOS;\s*(duo|phone)\))?/;

/** The host behind this window, or null for a browser (the PWA). */
export function detectHost(win: HostWindow | null | undefined, userAgent?: string | null): HostInfo | null {
  const global = win?.enrosedHost;
  if (global && typeof global === 'object') {
    return { version: typeof global.version === 'number' ? global.version : HOST_VERSION, platform: 'ios', device: global.device === 'duo' ? 'duo' : 'phone' };
  }
  const ua = userAgent ?? win?.navigator?.userAgent ?? '';
  const match = UA_SUFFIX.exec(ua);
  if (!match) return null;
  return { version: Number(match[1]) || HOST_VERSION, platform: 'ios', device: match[2] === 'duo' ? 'duo' : 'phone' };
}

/**
 * Marks the document for the host styles: `<html data-host="ios"
 * data-host-device="duo">`. Runs first in App's constructor, before the
 * nav rail and the Duo status bar, which host mode skips. Idempotent.
 */
export function installHost(doc: Document): HostInfo | null {
  const root = doc.documentElement;
  const info = detectHost(doc.defaultView as unknown as HostWindow | null, doc.defaultView?.navigator.userAgent);
  if (!info) return null;
  if (root.dataset['host'] !== info.platform) root.dataset['host'] = info.platform;
  if (root.dataset['hostDevice'] !== info.device) root.dataset['hostDevice'] = info.device;
  return info;
}

/** True once installHost marked this document (readable without the bridge, e.g. by saveBlob). */
export function hostInstalled(doc: Document | null | undefined): boolean {
  return !!doc?.documentElement.dataset['host'];
}

/* ---------------------------------------------------------------- contract */

export type HostTabBar = 'erp' | 'hidden' | 'costs' | 'files' | 'website';
export type HostStatusBar = 'dark' | 'light';
export type HostHaptic = 'selection' | 'light' | 'medium' | 'success' | 'warning' | 'error';
export type HostNavDirection = 'push' | 'pop' | 'replace' | 'tab';

/** One toolbar or menu item. `icon` is an icon.ts name, `symbol` the SF Symbol (HOST_SYMBOLS resolves one from the other). */
export interface HostAction {
  id: string;
  label: string;
  symbol?: string;
  icon?: string;
  prominent?: boolean;
  destructive?: boolean;
  disabled?: boolean;
  badge?: number;
}

export type HostMenuItem = HostAction | { separator: true };

/** A row of the title menu (the section's pages, as the tab bar's long press lists them). */
export interface HostTitleRow {
  id: string;
  label: string;
  symbol: string;
  icon?: string;
  count?: number;
  current: boolean;
  url: string;
}

/** A tab of a workspace's own tab set (Kosten & bank, Documenten & media, Website). */
export interface HostTab {
  id: string;
  label: string;
  symbol: string;
  icon?: string;
  badge?: number;
  warn?: boolean;
  active: boolean;
  url: string;
}

export interface HostStackEntry {
  url: string;
  title: string;
}

export interface HostBack {
  label: string;
  url: string;
}

/** The page descriptor: everything the shell draws for the screen on view. */
export interface HostPage {
  type: 'page';
  url: string;
  title: string;
  subtitle?: string;
  chrome: boolean;
  statusBar: HostStatusBar;
  largeTitle: boolean;
  condensed: boolean;
  titleEditable?: boolean;
  back?: HostBack;
  stack: HostStackEntry[];
  primary?: HostAction;
  actions: HostAction[];
  menu: HostMenuItem[];
  titleMenu?: HostTitleRow[];
  accessory?: HostAction;
  tabBar: HostTabBar;
  workspaceTabs?: HostTab[];
  guardsBack?: boolean;
  overlay?: boolean;
  refreshable?: boolean;
  source: 'host' | 'mirror';
}

export interface HostTheme {
  accent: string;
  accentDark: string;
  background: string;
}

export type HostMessage =
  | { type: 'ready'; hostVersion: number; app: string; loggedIn: boolean; theme: HostTheme; url: string }
  | { type: 'auth'; loggedIn: boolean }
  | ({ type: 'theme' } & HostTheme)
  | { type: 'badges'; sales: number; more: number; bell: number }
  | { type: 'nav.willChange'; direction: HostNavDirection; to: string }
  | HostPage
  | { type: 'scroll'; condensed: boolean }
  | { type: 'overlay'; open: boolean }
  | { type: 'haptic'; kind: HostHaptic }
  | { type: 'file'; name: string; mime: string; base64: string }
  | { type: 'share'; title: string; url?: string; text?: string }
  | { type: 'openExternal'; url: string }
  | { type: 'refreshDone' }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; text: string };

/** Questions the web asks and waits for (the `enrosedAsk` handler replies). */
export type HostAsk =
  | { type: 'confirm'; title: string; message?: string; confirm: string; cancel: string; destructive?: boolean; secondary?: string }
  | { type: 'prompt'; title: string; message?: string; value: string; placeholder?: string; confirm: string; cancel: string };

export interface HostConfirmReply { ok: boolean; secondary?: boolean }
export interface HostPromptReply { value: string | null }

export type HostCommand =
  | { type: 'action'; id: string }
  | { type: 'back'; count?: number }
  | { type: 'open'; url: string; nav?: HostNavDirection }
  | { type: 'tabRoot' }
  | { type: 'lifecycle'; state: 'active' | 'background' }
  | { type: 'refresh' }
  | { type: 'insets'; top: number; right: number; bottom: number; left: number }
  | { type: 'sessionCheck' };

/* --------------------------------------------------------------- transport */

/** Posts a fire-and-forget message; false when no host handler is there. */
export function postHostMessage(win: HostWindow | null | undefined, message: HostMessage): boolean {
  const handler = win?.webkit?.messageHandlers?.enrosed;
  if (!handler) return false;
  try {
    handler.postMessage(JSON.stringify(message));
    return true;
  } catch {
    return false;
  }
}

/** Asks the host and resolves with its reply; rejects when there is no ask handler. */
export function askHost(win: HostWindow | null | undefined, question: HostAsk): Promise<unknown> {
  const handler = win?.webkit?.messageHandlers?.enrosedAsk;
  if (!handler) return Promise.reject(new Error('no host ask handler'));
  try {
    return Promise.resolve(handler.postMessage(JSON.stringify(question)));
  } catch (failure) {
    return Promise.reject(failure);
  }
}

/** The largest blob that travels as base64 over the bridge; bigger ones take the WKDownload path. */
export const HOST_FILE_MAX_BYTES = 20 * 1024 * 1024;

/**
 * Hands a blob to the host as `file {name, mime, base64}`. Returns true when
 * the host takes it (the caller then skips its anchor download); false in
 * a browser, without a handler, or for a blob over the limit.
 */
export function postHostFile(win: HostWindow | null | undefined, doc: Document | null | undefined, blob: Blob, name: string): boolean {
  if (!hostInstalled(doc) || !win?.webkit?.messageHandlers?.enrosed || blob.size > HOST_FILE_MAX_BYTES) return false;
  const reader = new FileReader();
  reader.onload = () => {
    const result = typeof reader.result === 'string' ? reader.result : '';
    const base64 = result.slice(result.indexOf(',') + 1);
    postHostMessage(win, { type: 'file', name, mime: blob.type || 'application/octet-stream', base64 });
  };
  reader.readAsDataURL(blob);
  return true;
}

/* ------------------------------------------------------------------ icons */

/** icon.ts name → SF Symbol, one to one with Symbols.swift; unknown names fall back to `circle.dashed` on the native side. */
export const HOST_SYMBOLS: Readonly<Record<string, string>> = {
  home: 'house', sales: 'doc.text', purchase: 'shippingbox', products: 'camera.macro', more: 'ellipsis', stock: 'cube.box',
  exchange: 'arrow.left.arrow.right', media: 'photo.on.rectangle', analytics: 'chart.bar', customs: 'checkmark.seal',
  countries: 'globe.europe.africa', receipt: 'receipt', bank: 'building.columns', activity: 'clock.arrow.circlepath',
  customers: 'person.2', suppliers: 'truck.box', truck: 'truck.box', tag: 'tag', search: 'magnifyingglass', info: 'info.circle',
  tick: 'checkmark.circle', list: 'list.bullet', folder: 'folder', barcode: 'barcode', grid: 'square.grid.2x2',
  download: 'square.and.arrow.down', pdf: 'doc.richtext', document: 'doc', book: 'book', trash: 'trash',
  layers: 'square.stack.3d.up', globe: 'globe', plus: 'plus', refresh: 'arrow.clockwise', camera: 'camera',
  calendar: 'calendar', check: 'checkmark', filter: 'line.3.horizontal.decrease', recent: 'clock', archive: 'archivebox',
  restore: 'arrow.uturn.backward', share: 'square.and.arrow.up', upload: 'arrow.up.circle', image: 'photo', eye: 'eye',
  pencil: 'pencil', chevron: 'chevron.right', 'chevron-left': 'chevron.left', 'chevron-right': 'chevron.right',
  'chevron-up': 'chevron.up', 'chevron-down': 'chevron.down', external: 'arrow.up.right.square',
  expand: 'arrow.up.left.and.arrow.down.right', order: 'arrow.up.arrow.down', copy: 'doc.on.doc', close: 'xmark',
  move: 'arrowshape.turn.up.right', link: 'link', unlink: 'minus.circle', alert: 'exclamationmark.triangle',
  auto: 'wand.and.stars', 'arrow-in': 'arrow.down.left', 'arrow-out': 'arrow.up.right', clip: 'paperclip', repeat: 'repeat',
  grip: 'line.3.horizontal', settings: 'gearshape', bell: 'bell',
};

/** Action words → SF Symbol, for items that are words in the web (Bewerken, Bestellen, Opslaan…). */
export const ACTION_SYMBOLS: Readonly<Record<string, string>> = {
  bewerken: 'pencil', beheren: 'slider.horizontal.3', opslaan: 'checkmark', aanmaken: 'plus', versturen: 'paperplane',
  verstuur: 'paperplane', 'ter goedkeuring': 'paperplane', 'versturen ter goedkeuring': 'paperplane', 'opnieuw versturen': 'paperplane',
  'factuur maken': 'doc.badge.plus', 'in verwerking nemen': 'tray.and.arrow.down', heropenen: 'arrow.uturn.backward',
  heropen: 'arrow.uturn.backward', uitreiken: 'checkmark.seal', bestellen: 'cart', 'container vertrokken': 'ferry',
  'container ontvangen': 'shippingbox.and.arrow.backward', 'voorraad bijboeken': 'plus.square.on.square',
  'kostprijzen toepassen': 'eurosign.circle', 'kostprijzen opnieuw toepassen': 'eurosign.circle', 'opnieuw toepassen': 'eurosign.circle',
  annuleren: 'xmark.circle', 'order splitsen': 'scissors', 'nummer wijzigen': 'pencil.line', voorbeeld: 'eye', selecteer: 'checklist',
  klaar: 'checkmark', volgorde: 'arrow.up.arrow.down', toevoegen: 'plus', 'terug naar': 'chevron.backward', 'website bekijken': 'safari',
  pdf: 'doc.richtext', 'pdf bekijken': 'doc.richtext', 'pdf downloaden': 'doc.richtext', vernieuwen: 'arrow.clockwise',
  meldingen: 'bell', meer: 'ellipsis', 'meer acties': 'ellipsis', acties: 'ellipsis', nieuw: 'plus', 'nieuwe kopie': 'doc.on.doc',
  'wijziging beoordelen': 'exclamationmark.bubble', 'producten toevoegen': 'plus', alles: 'checkmark.circle', geen: 'circle',
  'voorschotten beheren': 'eurosign.circle', 'container kiezen': 'shippingbox', 'open punten': 'exclamationmark.circle',
  'open punt': 'exclamationmark.circle', verwijderen: 'trash', 'calculatie verwijderen': 'trash', 'status terugzetten': 'arrow.uturn.backward',
};

/** A label without a trailing ellipsis, a leading '+' or a trailing '?', collapsed and trimmed. */
export function cleanLabel(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\s+/g, ' ').replace(/^\+\s*/, '').replace(/(…|\.\.\.|\?)\s*$/, '').trim();
}

/** The SF Symbol for an action's word, or undefined when the word is unknown. */
export function symbolForLabel(label: string | null | undefined): string | undefined {
  const text = cleanLabel(label).toLocaleLowerCase('nl');
  if (!text) return undefined;
  if (ACTION_SYMBOLS[text]) return ACTION_SYMBOLS[text];
  const prefix = Object.keys(ACTION_SYMBOLS).filter((key) => text.startsWith(key + ' ')).sort((a, b) => b.length - a.length)[0];
  if (prefix) return ACTION_SYMBOLS[prefix];
  /* "3 open punten" → open punten. */
  const words = text.replace(/^\d+\s+/, '');
  return ACTION_SYMBOLS[words] ?? ACTION_SYMBOLS[words.split(' ')[0]];
}

/** The symbol of an action: its own, else its icon's, else its label's. */
export function resolveSymbol(action: { symbol?: string; icon?: string; label: string }): string | undefined {
  return action.symbol ?? (action.icon ? HOST_SYMBOLS[action.icon] : undefined) ?? symbolForLabel(action.label);
}

/** The workspace a URL belongs to, for the tab-bar kind. */
export function workspaceOf(url: string): 'costs' | 'files' | 'website' | null {
  const path = url.split(/[?#]/)[0];
  if (path === '/costs' || path.startsWith('/costs/')) return 'costs';
  if (path === '/files' || path.startsWith('/files/')) return 'files';
  if (path === '/website' || path.startsWith('/website/')) return 'website';
  return null;
}
