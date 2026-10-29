import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { Location } from '@angular/common';
import { NavigationEnd, Router, TitleStrategy } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import { Icon } from './icon';
import { NotificationBell } from './notification-bell';
import { observeLargeTitle } from './large-title';
import { DesktopViewport } from '../core/platform/desktop-viewport';
import { NavHistory } from '../core/platform/nav-history-service';
import { documentTitle } from '../core/platform/document-title';
import { parentOf } from '../core/platform/page-parent';
import { isPhoneTabRoot, phoneTabRootFor } from '../core/platform/phone-tabs';
import { capsuleLabel, screenLabel } from '../core/platform/return-label';
import { HostBridge } from '../core/platform/host-bridge';
import type { HostActionEvent, HostPageInput } from '../core/platform/host-bridge';
import { observeMirror } from './host-page';

/**
 * Whether a single-line text is cut. Measured unrounded: a Range over the
 * text reports its full laid-out width even when ellipsized, while
 * scrollWidth and clientWidth are rounded integers, so an overflow under a
 * pixel never shows there although the browser draws the ellipsis.
 */
export function textCut(element: HTMLElement): boolean {
  if (element.scrollWidth > element.clientWidth) return true;
  const range = element.ownerDocument.createRange();
  range.selectNodeContents(element);
  return range.getBoundingClientRect().width > element.getBoundingClientRect().width + 0.01;
}

/** Two labels that read as the same word (trimmed, case-insensitive). */
function sameWords(a: string, b: string): boolean {
  return a.trim().toLocaleLowerCase('nl') === b.trim().toLocaleLowerCase('nl');
}

/** The screen above this one, as a page names it: label and URL. */
export interface PageHeaderParent {
  label: string;
  url: string;
  /** The phone back label when there is no previous screen; defaults to label. */
  phoneLabel?: string;
}

/**
 * The top bar of every ERP page.
 *
 * Desk (680 px and up): the 52 px toolbar. A detail screen shows a crumb to
 * the screen above it ("Inkoop › PO-2026-025"), derived from the route
 * (parentOf) unless the page names its parent with [parent]; [parent]="null"
 * shows none. With a crumb the title stacks over the subtitle, so a
 * customer or supplier name stays readable at 1100 px; root screens keep
 * the subtitle inline after the title, and it gives way first. When even
 * the title would be cut, the crumb folds to its chevron, and then away
 * (the sidebar remains the way around): a document number or a product
 * name is never cut for a crumb. Projected actions get the compact kit
 * metrics; the bell sits after a divider.
 *
 * Phone (iOS 26): root screens get a large title (34/800, the subtitle as
 * its caption) that condenses into the glass bar on scroll, exactly like
 * app-ios-nav; detail screens get the glass bar with the title over the
 * subtitle. [large] overrides the default (a root screen: parentOf(url) is
 * null). The back control: none on the five tab roots, always elsewhere.
 * It reads the screen below in the history ("‹ Verkoop", history back);
 * without one, the parent's label (detail screens) or backTo's, else the
 * root of the screen's tab ("‹ Verkoop" on Klanten, phone-tabs.ts; "Meer"
 * for a screen listed only there), and it navigates there. Labels over ten
 * characters, or a title that would be cut, make it a chevron circle; if
 * the title is still cut, the pencil of an editable title gives way too
 * (the button keeps its "Titel wijzigen" name). A document number is never
 * cut for chrome.
 * "Cut" is measured unrounded (a Range over the text against its box):
 * scrollWidth rounds a sub-pixel overflow away while the browser still
 * draws the ellipsis. Projected .btn become glass capsules (primary:
 * accent), .btn--icon-mobile glass circles; the bell is a glass circle too.
 *
 * The title can be editable — order screens use this so the document number
 * is changed right where it is displayed, instead of in a form field that
 * duplicates it further down. Tap the title, type, press enter or tap
 * elsewhere. An empty value is discarded: clearing a document number is never
 * what anyone meant.
 *
 * The host stays inline (no :host display): the sticky .appbar must be
 * constrained by the page host, not by this element. Its rules live in
 * styles/shell.scss.
 *
 * Inside the native host (enrosed-erp-ios, core/platform/host-bridge.ts)
 * the bar is a spacer and the shell draws the chrome from a descriptor
 * this header publishes: its title, subtitle, back control, large title
 * state and the bell, plus either the page's explicit `[host]` items
 * (ids are the page's method names, delivered through `(hostAction)`) or,
 * without `[host]`, a mirror of the projected buttons (a native action
 * clicks the button). Nothing of this runs in a browser.
 */
@Component({
  selector: 'app-page-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, NotificationBell],
  template: `
    <header class="appbar" #bar [class.appbar--crumb]="!!crumb()" [class.appbar--large]="largeShown()"
            [class.appbar--condensed]="condensed()" [class.appbar--two]="!largeShown() && !!subtitle()"
            [class.appbar--tight]="!desktop.active() && fold() === 'none'">
      @if (backControl(); as control) {
        @if (control.text) {
          <button class="appbar__back ios-capsule ios-back" type="button" [attr.aria-label]="control.aria" (click)="back()">
            <app-icon name="chevron-left" [size]="22" />{{ control.text }}
          </button>
        } @else {
          <button class="appbar__back ios-circle" type="button" [attr.aria-label]="control.aria" (click)="back()">
            <app-icon name="chevron-left" [size]="22" />
          </button>
        }
      }
      <div class="appbar__lead" #lead>
        @if (crumb(); as parent) {
          @if (fold() === 'chevron') {
            <a class="appbar__crumb appbar__crumb--compact" [attr.href]="crumbHref()"
               [attr.aria-label]="'Terug naar ' + parent.label" [attr.title]="'Terug naar ' + parent.label"
               (click)="crumbClick($event)"><app-icon name="chevron-left" [size]="18" /></a>
          } @else if (fold() === 'full') {
            <span class="appbar__path">
              <a class="appbar__crumb" [attr.href]="crumbHref()" [attr.aria-label]="'Terug naar ' + parent.label"
                 (click)="crumbClick($event)">{{ parent.label }}</a>
              <app-icon class="appbar__sep" name="chevron-right" [size]="14" />
            </span>
          }
        }
        <div class="appbar__titles">
          @if (editingTitle()) {
            <h1 class="appbar__title">
              <input
                class="appbar__title-input"
                type="text"
                [value]="title()"
                [attr.aria-label]="'Titel wijzigen: ' + title()"
                (blur)="commitTitle($any($event.target).value)"
                (keydown.enter)="commitTitle($any($event.target).value)"
                (keydown.escape)="editingTitle.set(false)"
                #titleField
              />
            </h1>
          } @else if (largeShown()) {
            <!-- The page heading is the large title below; this one takes over once it has scrolled away. -->
            <div class="appbar__title" [attr.aria-hidden]="condensed() ? null : 'true'"><span class="appbar__title-text" #titleText>{{ title() }}</span></div>
          } @else if (titleEditable()) {
            <h1 class="appbar__title">
              <button class="appbar__title-button" type="button" [attr.title]="title()"
                      [attr.aria-label]="'Titel wijzigen: ' + title()" (click)="startEditing()">
                <span class="appbar__title-text" #titleText>{{ title() }}</span>
                <span class="appbar__pencil" aria-hidden="true">✎</span>
              </button>
            </h1>
          } @else {
            <h1 class="appbar__title" [attr.title]="title()"><span class="appbar__title-text" #titleText>{{ title() }}</span></h1>
          }
          @if (subtitle() && !largeShown()) {
            <div class="appbar__sub" [attr.title]="subtitle()">{{ subtitle() }}</div>
          }
        </div>
      </div>
      <div class="appbar__actions">
        <ng-content />
        @if (showBell()) {
          <span class="appbar__divider" aria-hidden="true"></span>
          <app-notification-bell />
        }
      </div>
    </header>
    @if (largeShown()) {
      <div class="appbar__large">
        <h1 class="appbar__large-title">{{ title() }}</h1>
        @if (subtitle()) { <p class="appbar__large-sub">{{ subtitle() }}</p> }
      </div>
      <div class="appbar__sentinel" #sentinel aria-hidden="true"></div>
    }
  `,
})
export class PageHeader {
  readonly desktop = inject(DesktopViewport);
  private readonly history = inject(NavHistory);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly documentTitle = inject(Title);
  private readonly titleStrategy = inject(TitleStrategy);
  /** The tab title this header set, so it can hand the tab back when it leaves. */
  private ownTitle: string | null = null;

  readonly title = input.required<string>();
  readonly subtitle = input('');
  /**
   * Kept for the call sites: the phone decides its back control itself
   * (critique B10) and the desk has the crumb, so this no longer changes
   * what renders.
   */
  readonly showBack = input(false);
  /** Where the phone back control goes when there is no previous screen; also names it ("‹ Meer"). */
  readonly backTo = input<string | null>(null);
  /**
   * The phone large title. Undefined (the default) gives one to root
   * screens (parentOf(url) is null) and the glass bar to detail screens.
   */
  readonly large = input<boolean | undefined>(undefined);
  /**
   * The screen above this one for the desk crumb. Undefined (the default)
   * derives it from the route with parentOf(); null shows no crumb.
   */
  readonly parent = input<PageHeaderParent | null | undefined>(undefined);
  /**
   * The bell belongs on overview screens, not on every detail screen.
   * On a quote you are editing it is only a distraction.
   */
  readonly showBell = input(true);
  /** Whether tapping the title opens an inline editor. */
  readonly titleEditable = input(false);
  /** Fires with the new title once committed; never with an empty value. */
  readonly titleChange = output<string>();
  /** The native host's items for this page; undefined mirrors the projected buttons instead. */
  readonly host = input<HostPageInput | null | undefined>(undefined);
  /** A native action by id (the page's method name, or `refresh`). */
  readonly hostAction = output<HostActionEvent>();
  private readonly bellRef = viewChild(NotificationBell);

  readonly editingTitle = signal(false);
  private readonly titleField = viewChild<ElementRef<HTMLInputElement>>('titleField');
  private readonly titleText = viewChild<ElementRef<HTMLElement>>('titleText');
  private readonly lead = viewChild<ElementRef<HTMLElement>>('lead');
  private readonly bar = viewChild<ElementRef<HTMLElement>>('bar');
  private readonly sentinel = viewChild<ElementRef<HTMLElement>>('sentinel');

  /** The open URL (query-only navigations included). */
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  /** The resolved parent: the page's own, or the route's. */
  readonly resolvedParent = computed<PageHeaderParent | null>(() => {
    const own = this.parent();
    if (own !== undefined) return own;
    return parentOf(this.url());
  });

  /**
   * The desk crumb (the phone has its back control). None when it would
   * repeat the title: while a document loads or fails, the desks title the
   * bar with the parent's word ("Verkoop › Verkoop" read wrong).
   */
  readonly crumb = computed(() => {
    const parent = this.desktop.active() ? this.resolvedParent() : null;
    return parent && !sameWords(parent.label, this.title()) ? parent : null;
  });

  /** The crumb as a real link, so ⌘-click opens the parent in a new tab. */
  readonly crumbHref = computed(() => {
    const parent = this.crumb();
    return parent ? this.history.upHref(parent.url) : null;
  });

  /** The phone large title (never on the desk: one h1 there). */
  readonly largeShown = computed(() => !this.desktop.active() && (this.large() ?? parentOf(this.url()) === null));

  /** True once the large title has scrolled under the bar. */
  readonly condensed = signal(false);

  /**
   * How far the chrome has folded so the title (a document number, a
   * product name) stays whole. Desk: the crumb label, its chevron alone, or
   * nothing. Phone: the back capsule ('full'), a chevron circle ('chevron'),
   * then also no pencil on an editable title ('none', .appbar--tight).
   */
  readonly fold = signal<'full' | 'chevron' | 'none'>('full');

  /**
   * The phone back control: what it says and where it goes without history.
   * With neither backTo nor a parent it goes up to the screen's tab root, as
   * the lit tab says: "‹ Verkoop" on Klanten, "‹ Meer" on Logboek.
   */
  readonly backControl = computed(() => {
    if (this.desktop.active()) return null;
    const url = this.url();
    if (isPhoneTabRoot(url)) return null;
    const parent = this.resolvedParent();
    const backTo = this.backTo();
    const tabRoot = phoneTabRootFor(url);
    let label: string;
    if (this.history.below()) label = this.history.belowLabel();
    else if (backTo) label = screenLabel(backTo) || parent?.phoneLabel || parent?.label || '';
    else if (parent) label = parent.phoneLabel ?? parent.label;
    else label = screenLabel(tabRoot);
    const fallback = backTo ?? parent?.url ?? tabRoot;
    return {
      text: this.fold() === 'full' ? capsuleLabel(label) : '',
      aria: label ? `Terug naar ${label}` : 'Terug',
      fallback,
    };
  });

  constructor() {
    const bridge = inject(HostBridge);
    if (bridge.present) {
      const element = inject<ElementRef<HTMLElement>>(ElementRef);
      const mirror = observeMirror(element, inject(DestroyRef), {
        scopes: () => Array.from(element.nativeElement.querySelectorAll('.appbar__actions')),
        pageRoot: () => element.nativeElement.parentElement,
      });
      bridge.bind({
        title: () => this.title(),
        subtitle: () => this.subtitle(),
        back: () => {
          const control = this.backControl();
          return control ? { label: control.aria.replace(/^Terug naar /, '') || 'Terug', url: control.fallback } : null;
        },
        largeTitle: () => this.largeShown(),
        condensed: () => this.condensed(),
        titleEditable: () => this.titleEditable(),
        input: () => this.host(),
        mirror: () => mirror(),
        bell: () => {
          const bell = this.bellRef();
          return bell && this.showBell() ? { count: bell.count(), open: () => bell.open() } : null;
        },
        onAction: (event) => this.hostAction.emit(event),
        onBack: () => this.back(),
        onTitle: (value) => { if (value && value !== this.title()) this.titleChange.emit(value); },
      });
    }
    effect(() => {
      this.ownTitle = documentTitle(this.title());
      this.documentTitle.setTitle(this.ownTitle);
    });
    /* A header that leaves without a navigation (a loading state giving way to a page without
       one, as the phone sales view) hands the tab back to the route title ("Verkooporder"),
       unless another header has set its own meanwhile. */
    inject(DestroyRef).onDestroy(() => {
      if (this.ownTitle === null || this.documentTitle.getTitle() !== this.ownTitle) return;
      this.documentTitle.setTitle(documentTitle(this.titleStrategy.buildTitle(this.router.routerState.snapshot)));
    });
    effect(() => {
      if (!this.editingTitle()) return;
      const field = this.titleField()?.nativeElement;
      if (!field) return;
      field.focus();
      field.select();
    });

    /* Re-fit whenever what competes for the title line changes. */
    effect(() => {
      this.title();
      this.crumb();
      this.history.below();
      this.desktop.active();
      this.fold.set('full');
      this.scheduleFit();
    });
    /* The phone large title condenses into the bar once it scrolls away (shared with app-ios-nav). */
    effect((onCleanup) => {
      const bar = this.bar()?.nativeElement;
      const sentinel = this.sentinel()?.nativeElement;
      if (!bar || !sentinel) { this.condensed.set(false); return; }
      onCleanup(observeLargeTitle(bar, sentinel, (condensed) => this.condensed.set(condensed)));
    });
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const bar = this.bar()?.nativeElement;
      const lead = this.lead()?.nativeElement;
      if (!bar || !lead || typeof ResizeObserver === 'undefined') return;
      let barWidth = bar.getBoundingClientRect().width;
      const observer = new ResizeObserver(() => {
        /* A wider bar (a resized window) may hold the full way up again. Only
           the bar counts: the lead itself grows when the way up folds, and
           unfolding on that would flip back and forth. */
        const next = bar.getBoundingClientRect().width;
        if (next > barWidth + 0.5 && this.fold() !== 'full') this.fold.set('full');
        barWidth = next;
        this.scheduleFit();
      });
      observer.observe(bar);
      observer.observe(lead);
      destroyRef.onDestroy(() => { observer.disconnect(); cancelAnimationFrame(this.fitFrame); });
    });
  }

  private fitFrame = 0;
  private scheduleFit(): void {
    if (typeof requestAnimationFrame === 'undefined') return;
    cancelAnimationFrame(this.fitFrame);
    this.fitFrame = requestAnimationFrame(() => this.fit());
  }

  /** Folds the chrome one step while the title text is cut; it unfolds only when the room grows. */
  private fit(): void {
    const fold = this.fold();
    if (fold === 'none') return;
    const text = this.titleText()?.nativeElement;
    if (!text || !textCut(text)) return;
    if (this.crumb()) {
      /* Desk: the crumb's label, then the crumb itself. */
      this.fold.set(fold === 'full' ? 'chevron' : 'none');
    } else if (this.desktop.active() || this.largeShown()) {
      return;
    } else if (fold === 'full' && this.backControl()?.text) {
      /* Phone bar title: the labelled back capsule becomes a circle first ... */
      this.fold.set('chevron');
    } else if (this.titleEditable()) {
      /* ... then the pencil of an editable title gives way (about 18 px). */
      this.fold.set('none');
    } else {
      return;
    }
    this.scheduleFit();
  }

  startEditing(): void {
    this.editingTitle.set(true);
  }

  commitTitle(raw: string): void {
    this.editingTitle.set(false);
    const value = raw.trim();
    if (value && value !== this.title()) {
      this.titleChange.emit(value);
    }
  }

  /** A plain click goes up in-app (history back when the parent is below); modified clicks keep the link. */
  crumbClick(event: MouseEvent): void {
    const parent = this.crumb();
    if (!parent || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    this.history.up(parent.url);
  }

  /** Phone back: history back to the screen below, or where the control says without one. */
  back(): void {
    const control = this.backControl();
    if (control) { this.history.back(control.fallback); return; }
    this.location.back();
  }
}
