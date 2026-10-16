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
import { NavigationEnd, Router } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import { BrandMark } from './brand-mark';
import { Icon } from './icon';
import { NotificationBell } from './notification-bell';
import { DesktopViewport } from '../core/platform/desktop-viewport';
import { NavHistory } from '../core/platform/nav-history-service';
import { parentOf } from '../core/platform/page-parent';

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
 * Phone: a back button on detail views and the brand mark elsewhere.
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
 */
@Component({
  selector: 'app-page-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BrandMark, Icon, NotificationBell],
  template: `
    <header class="appbar" [class.appbar--crumb]="!!crumb()">
      @if (!desktop.active()) {
        @if (showBack()) {
          <button class="appbar__back" type="button" aria-label="Terug" (click)="back()">‹</button>
        } @else {
          <!-- On phones the brand mark sits here. -->
          <div class="appbar__brand">
            <app-brand-mark [small]="true" />
          </div>
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
          @if (subtitle()) {
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
  `,
})
export class PageHeader {
  readonly desktop = inject(DesktopViewport);
  private readonly history = inject(NavHistory);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly documentTitle = inject(Title);

  readonly title = input.required<string>();
  readonly subtitle = input('');
  readonly showBack = input(false);
  /** Where back goes when the page was opened directly (no history to return to). */
  readonly backTo = input<string | null>(null);
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

  readonly editingTitle = signal(false);
  private readonly titleField = viewChild<ElementRef<HTMLInputElement>>('titleField');
  private readonly titleText = viewChild<ElementRef<HTMLElement>>('titleText');
  private readonly lead = viewChild<ElementRef<HTMLElement>>('lead');

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

  /** The desk crumb (the phone has its back control). */
  readonly crumb = computed(() => this.desktop.active() ? this.resolvedParent() : null);

  /** The crumb as a real link, so ⌘-click opens the parent in a new tab. */
  readonly crumbHref = computed(() => {
    const parent = this.crumb();
    return parent ? this.history.upHref(parent.url) : null;
  });

  /**
   * How far the crumb has folded so the title (a document number, a
   * product name) stays whole: the label, its chevron alone, or nothing.
   */
  readonly fold = signal<'full' | 'chevron' | 'none'>('full');

  constructor() {
    effect(() => {
      const pageTitle = this.title().trim();
      this.documentTitle.setTitle(pageTitle ? `${pageTitle} — Enrosed` : 'Enrosed');
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
      this.desktop.active();
      this.fold.set('full');
      this.scheduleFit();
    });
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const lead = this.lead()?.nativeElement;
      if (!lead || typeof ResizeObserver === 'undefined') return;
      let width = lead.getBoundingClientRect().width;
      const observer = new ResizeObserver(() => {
        const next = lead.getBoundingClientRect().width;
        /* More room: try the full crumb again; less room: check the title. */
        if (next > width + 0.5 && this.fold() !== 'full') this.fold.set('full');
        width = next;
        this.scheduleFit();
      });
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

  /** Folds the way up one step while the title text does not fit; it unfolds only when the room grows. */
  private fit(): void {
    const fold = this.fold();
    if (fold === 'none' || !this.crumb()) return;
    const text = this.titleText()?.nativeElement;
    if (!text || text.scrollWidth <= text.clientWidth + 0.5) return;
    this.fold.set(fold === 'full' ? 'chevron' : 'none');
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

  back(): void {
    const fallback = this.backTo();
    if (fallback && window.history.length <= 1) { void this.router.navigateByUrl(fallback); return; }
    this.location.back();
  }
}
