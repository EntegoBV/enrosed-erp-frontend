import { DestroyRef, Directive, ElementRef, inject, input, output, signal } from '@angular/core';
import { Router } from '@angular/router';
import { HostBridge } from '../core/platform/host-bridge';
import type { HostActionEvent, HostMirror, HostPageInput } from '../core/platform/host-bridge';
import type { HostAction, HostMenuItem, HostTab } from '../core/platform/host';
import { cleanLabel } from '../core/platform/host';

/**
 * The native host's chrome for a page without a header: the login page,
 * the sales document view (its hero bar), the product editor (its own
 * header). `[hostPage]` takes the descriptor (title, subtitle, back,
 * primary, actions, menu, guardsBack…), `(hostAction)` receives the host's
 * actions by id. Nothing renders; without a host nothing happens.
 */
@Directive({ selector: '[hostPage]' })
export class HostPage {
  private readonly bridge = inject(HostBridge);
  private readonly router = inject(Router);

  readonly hostPage = input<HostPageInput | null>(null);
  readonly hostAction = output<HostActionEvent>();

  constructor() {
    this.bridge.bind({
      title: () => this.hostPage()?.title ?? '',
      subtitle: () => this.hostPage()?.subtitle,
      back: () => this.hostPage()?.back ?? null,
      largeTitle: () => this.hostPage()?.largeTitle ?? false,
      input: () => this.hostPage() ?? {},
      onAction: (event) => this.hostAction.emit(event),
      onBack: () => {
        const back = this.hostPage()?.back;
        if (back?.url) void this.router.navigateByUrl(back.url, { info: { nav: 'pop' } });
        else this.hostAction.emit({ id: 'back', finish: () => undefined });
      },
    });
  }
}

/* ------------------------------------------------------------- the mirror */

/** A header's projected controls as the host's items; the ids click the elements. */
export interface MirrorOptions {
  /** The containers whose buttons and links are mirrored (the trail, the lead after the back control). */
  scopes: () => Element[];
  /** Elements never mirrored (the back control, the bell the header mirrors itself). */
  skip?: (element: Element) => boolean;
  /** Where the page's '+' lives: the element whose descendants are searched for .fab / .ios-accessory. */
  pageRoot: () => Element | null;
}

const CONTROL_SELECTOR = 'button, a[href], a[routerLink], [role="button"]';

function visible(element: Element, view: Window): boolean {
  if (element.getAttribute('aria-hidden') === 'true' || element.hasAttribute('hidden')) return false;
  /* Its own computed display, not its parent's: the host hides the bar, the control still says whether the phone shows it. */
  return view.getComputedStyle(element).display !== 'none';
}

function badgeOf(element: Element): number | undefined {
  const badge = element.querySelector('[class*="badge"], [class*="count"]');
  const text = badge?.textContent?.trim() ?? '';
  if (!text) return undefined;
  const digits = parseInt(text, 10);
  return Number.isFinite(digits) && digits > 0 ? digits : undefined;
}

function labelOf(element: Element): string {
  const clone = element.cloneNode(true) as Element;
  for (const hidden of Array.from(clone.querySelectorAll('[aria-hidden="true"], svg, [class*="badge"], [class*="count"]'))) hidden.remove();
  const text = cleanLabel(clone.textContent);
  return text || cleanLabel(element.getAttribute('aria-label')) || cleanLabel(element.getAttribute('title'));
}

function describe(element: Element, id: string): HostAction {
  const action: HostAction = { id, label: labelOf(element) || 'Actie' };
  const icon = element.querySelector('app-icon')?.getAttribute('data-icon');
  if (icon) action.icon = icon;
  if (element.classList.contains('btn--primary') || element.classList.contains('ios-capsule--tinted') || element.classList.contains('erp-workspace__primary')) action.prominent = true;
  if (element.classList.contains('btn--danger') || element.classList.contains('ios-cell--danger')) action.destructive = true;
  if (element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true') action.disabled = true;
  const badge = badgeOf(element);
  if (badge) action.badge = badge;
  return action;
}

function urlOf(anchor: Element, view: Window): string {
  const href = anchor.getAttribute('href');
  if (!href) return '';
  try {
    const url = new URL(href, view.location.origin);
    return `${url.pathname}${url.search}`;
  } catch {
    return href;
  }
}

/** The kit's workspace tab bar (.ios-tabbar) as host tabs; the explicit pages send their own. */
function describeTabs(doc: Document, view: Window): HostTab[] | undefined {
  const bar = doc.querySelector('.ios-tabbar');
  if (!bar) return undefined;
  const tabs = Array.from(bar.querySelectorAll<HTMLElement>('.ios-tab'));
  if (!tabs.length) return undefined;
  return tabs.map((tab, index) => {
    const label = cleanLabel(tab.querySelector('.ios-tab__label')?.textContent) || cleanLabel(tab.getAttribute('aria-label')) || `Tab ${index + 1}`;
    const out: HostTab = {
      id: label.toLocaleLowerCase('nl').replace(/[^a-z0-9]+/g, '-'), label, symbol: '', active: tab.classList.contains('active'), url: urlOf(tab, view),
    };
    const icon = tab.querySelector('app-icon')?.getAttribute('data-icon');
    if (icon) out.icon = icon;
    const badge = badgeOf(tab);
    if (badge) { out.badge = badge; out.warn = !!tab.querySelector('.ios-tab__badge--warn'); }
    return out;
  });
}

/**
 * Reads the header's controls now: every visible button or link in the
 * scopes (the first `.btn--primary` becomes the primary), the page's '+'
 * (.fab or .ios-accessory) as the accessory, the kit's workspace tab bar
 * as the tabs. A native action with one of the ids clicks the element, so
 * the page's own handlers keep running.
 */
export function describeMirror(doc: Document, options: MirrorOptions): HostMirror {
  const view = doc.defaultView;
  const elements = new Map<string, HTMLElement>();
  const mirror: HostMirror = {
    actions: [], menu: [],
    click(id) {
      const element = elements.get(id);
      if (!element) return false;
      element.click();
      return true;
    },
  };
  if (!view) return mirror;
  let index = 0;
  for (const scope of options.scopes()) {
    for (const element of Array.from(scope.querySelectorAll<HTMLElement>(CONTROL_SELECTOR))) {
      if (element.closest('app-notification-bell') || options.skip?.(element) || !visible(element, view)) continue;
      /* A control inside another control (an icon span with a role) counts once. */
      if (element.parentElement?.closest(CONTROL_SELECTOR) && scope.contains(element.parentElement.closest(CONTROL_SELECTOR))) continue;
      const id = `m:${index++}`;
      const action = describe(element, id);
      elements.set(id, element);
      if (action.prominent && !mirror.primary) mirror.primary = action;
      else mirror.actions.push(action);
    }
  }
  const root = options.pageRoot();
  const plus = root?.querySelector<HTMLElement>('.fab, .ios-accessory') ?? null;
  if (plus && visible(plus, view)) {
    const id = 'm:plus';
    elements.set(id, plus);
    const action = describe(plus, id);
    if (!action.icon) action.icon = plus.classList.contains('fab--text') ? 'purchase' : 'plus';
    if (action.icon === 'plus') { action.prominent = true; if (!action.label || action.label === 'Actie') action.label = 'Toevoegen'; }
    mirror.accessory = action;
  }
  const tabs = describeTabs(doc, view);
  if (tabs) mirror.workspaceTabs = tabs;
  return mirror;
}

/**
 * Keeps a mirror current: a MutationObserver on the header and its page
 * (buttons appear with the data, labels change with the state), read at
 * most once per frame. Returns the signal; the observer ends with the
 * component.
 */
export function observeMirror(host: ElementRef<Element>, destroyRef: DestroyRef, options: MirrorOptions) {
  const mirror = signal<HostMirror | null>(null);
  const element = host.nativeElement;
  const doc = element.ownerDocument;
  const view = doc.defaultView;
  if (!view) return mirror;
  let frame = 0;
  const read = (): void => { frame = 0; mirror.set(describeMirror(doc, options)); };
  const schedule = (): void => { if (!frame) frame = view.requestAnimationFrame(read); };
  const observer = typeof MutationObserver === 'undefined' ? null : new MutationObserver(schedule);
  const watched = element.parentElement ?? element;
  observer?.observe(watched, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'class', 'aria-label', 'hidden', 'data-icon', 'aria-disabled', 'href'] });
  /* The kit's tab bar may stand outside the page (the website's, in the shell): watch the body for it too, children only. */
  observer?.observe(doc.body, { childList: true });
  schedule();
  destroyRef.onDestroy(() => { observer?.disconnect(); view.cancelAnimationFrame(frame); });
  return mirror;
}

/** The rows of a context menu (ContextMenuItem) as host menu items. */
export function menuRows(items: readonly { id: string; label: string; iconName?: string; danger?: boolean; disabled?: boolean; divider?: boolean }[]): HostMenuItem[] {
  const out: HostMenuItem[] = [];
  for (const item of items) {
    if (item.divider && out.length) out.push({ separator: true });
    const row: HostAction = { id: item.id, label: item.label };
    if (item.iconName) row.icon = item.iconName;
    if (item.danger) row.destructive = true;
    if (item.disabled) row.disabled = true;
    out.push(row);
  }
  return out;
}
