import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Auth } from '../../core/api/auth';
import { Icon } from '../../shared/icon';
import { PageHeader } from '../../shared/page-header';
import { THEMES, Theme } from '../../core/platform/theme';
import { WorkQueue } from '../../core/api/work-queue';
import {
  NAV_DEVICE, NAV_GROUPS, NAV_WORKSPACES, groupCountKeys, meerItems, meerLabel, navItemIsNew,
} from '../../core/platform/nav-items';
import type { NavCountKey, NavGroup, NavItem } from '../../core/platform/nav-items';

/**
 * Meer: everything the phone's tab bar does not hold, as inset groups of
 * the workspace kit. The rows come from NAV_GROUPS, the table the desk
 * sidebar renders too, so the two never drift apart (tab roots excepted:
 * they are the tabs). On a desk between 680 and 1023 px (the rail's Meer)
 * the same page stands centred at 640 px.
 *
 * The header stays app-page-header (critique B2): the phone gets the large
 * title with "Aangemeld als …" as its caption and the glass bell, whose
 * sheet is never trapped under the tab bar; the desk gets the toolbar.
 */
@Component({
  selector: 'app-more-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PageHeader, Icon],
  template: `
    <app-page-header title="Meer" [subtitle]="'Aangemeld als ' + (auth.username() ?? '')" />

    <div class="content more-content">
      <section class="ios-section" aria-labelledby="meer-snel">
        <div class="ios-section__head"><h2 id="meer-snel">Snel naar</h2></div>
        <nav class="ios-group ios-group--icons" aria-labelledby="meer-snel">
          @for (item of workspaces; track item.id) {
            <a class="ios-cell" [routerLink]="item.link">
              <span [class]="'ios-tile tone-' + item.tone"><app-icon [name]="item.icon" [size]="18" /></span>
              <span class="ios-cell__body">
                <span class="ios-cell__title">{{ item.label }}</span>
                <span class="ios-cell__sub">{{ item.hint }}</span>
              </span>
              <app-icon class="ios-cell__chev" name="chevron-right" [size]="18" />
            </a>
          }
        </nav>
      </section>

      <!-- One disclosure per domain, one open at a time: the menu stays one
           screen tall, and every drawer of the old settings page lives where
           you would look for it. Sidebar order (N27). -->
      <section class="ios-section" aria-labelledby="meer-werkruimtes">
        <div class="ios-section__head"><h2 id="meer-werkruimtes">Werkruimtes</h2></div>
        <div class="ios-group ios-group--icons">
          @for (group of groups; track group.id) {
            <details class="ios-disclosure" name="meer-groepen">
              <summary>
                <span [class]="'ios-tile tone-' + group.tone"><app-icon [name]="group.meerIcon ?? group.icon" [size]="18" /></span>
                <span class="ios-cell__body">
                  <span class="ios-cell__title ios-cell__title--strong">{{ group.label }}</span>
                  <span class="ios-cell__sub">{{ group.hint }}</span>
                </span>
                @if (groupCount(group); as n) {
                  <span class="ios-count" [attr.aria-label]="countLabel(group, n)">{{ n }}</span>
                }
                <app-icon class="ios-cell__chev" name="chevron-right" [size]="18" />
              </summary>
              <div class="ios-disclosure__body">
                @for (item of itemsOf(group); track item.id) {
                  <a class="ios-cell" [routerLink]="item.link" [queryParams]="item.query ?? null">
                    <span [class]="'ios-tile ios-tile--sm ios-tile--soft tone-' + group.tone"><app-icon [name]="item.icon" [size]="15" /></span>
                    <span class="ios-cell__body">
                      <span class="ios-cell__title">{{ titleOf(item) }}
                        @if (isNew(item)) { <span class="wk-pill tone-accent">nieuw</span> }
                      </span>
                      <span class="ios-cell__sub">{{ item.hint }}</span>
                    </span>
                    @if (countOf(item.countKey); as n) { <span class="ios-count">{{ n }}</span> }
                    <app-icon class="ios-cell__chev" name="chevron-right" [size]="18" />
                  </a>
                }
              </div>
            </details>
          }
        </div>
      </section>

      <section class="ios-section" aria-labelledby="meer-toestel">
        <div class="ios-section__head"><h2 id="meer-toestel">App op dit toestel</h2></div>
        <div class="ios-group ios-group--icons">
          @for (item of device; track item.id) {
            <a class="ios-cell" [routerLink]="item.link" [queryParams]="item.query ?? null">
              <span [class]="'ios-tile tone-' + item.tone"><app-icon [name]="item.icon" [size]="18" /></span>
              <span class="ios-cell__body">
                <span class="ios-cell__title">{{ titleOf(item) }}</span>
                <span class="ios-cell__sub">{{ item.hint }}</span>
              </span>
              <app-icon class="ios-cell__chev" name="chevron-right" [size]="18" />
            </a>
          }
          <!-- The accent colour, right here: the one setting you change on a whim. -->
          <div class="more-theme">
            <div class="ios-cell">
              <span class="ios-tile tone-accent"><app-icon name="eye" [size]="18" /></span>
              <span class="ios-cell__body"><span class="ios-cell__title">Weergave</span></span>
              <span class="ios-cell__value">{{ currentThemeLabel() }}</span>
            </div>
            <div class="more-theme__row" role="radiogroup" aria-label="Kleurschema">
              @for (option of themes; track option.key) {
                <button class="more-theme__swatch" type="button" role="radio" [title]="option.label"
                        [class.more-theme__swatch--active]="theme.current() === option.key"
                        [attr.aria-checked]="theme.current() === option.key"
                        [style.--swatch]="option.swatch" (click)="theme.set(option.key)">
                  <span class="sr-only">{{ option.label }}</span>
                </button>
              }
            </div>
          </div>
        </div>
      </section>

      <section class="ios-section">
        <div class="ios-group">
          <button class="ios-cell ios-cell--danger" type="button" (click)="logout()">Afmelden</button>
        </div>
        <p class="ios-section__foot">Aangemeld als {{ auth.username() }}</p>
      </section>
    </div>
  `,
  styles: `
    :host { display: block; min-width: 0; }
    /* The kit's groups carry their own inset; the content gives them the width. */
    .more-content { max-width: 640px; padding-inline: 0; }
    @media (min-width: 1024px), (min-width: 680px) and (hover: hover) { .more-content { --ios-inset: 0px; } }
    .ios-tile { flex: none; }
    .ios-cell__title .wk-pill { margin-left: 6px; }
    .ios-disclosure > summary .ios-count { margin-left: 4px; }
    .ios-disclosure > summary .ios-cell__chev { margin-left: 2px; }
    /* Every help line stays whole (no figure or word cut at 360): Meer is a menu, a third line is fine. */
    .ios-cell__sub { overflow: visible; text-overflow: clip; white-space: normal; overflow-wrap: anywhere; }
    .ios-cell__title { overflow: visible; white-space: normal; }
    .more-theme__row { display: flex; justify-content: space-between; padding: 0 10px 8px 52px; }
    .more-theme__swatch { position: relative; width: 44px; height: 44px; padding: 0; border: 0; border-radius: 50%; background: transparent; cursor: pointer; }
    .more-theme__swatch::before { position: absolute; inset: 9px; content: ''; border-radius: 50%; background: var(--swatch); box-shadow: inset 0 0 0 1px rgb(0 0 0 / 12%); }
    .more-theme__swatch--active::before { box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px var(--swatch); }
    .more-theme__swatch--active::after { position: absolute; inset: 0; display: grid; place-items: center; content: '✓'; color: #fff; font-size: 13px; font-weight: 750; }
    .more-theme__swatch:focus-visible { outline: 3px solid color-mix(in srgb, var(--rose) 55%, transparent); outline-offset: -2px; }
    :is(a, summary, button).ios-cell:focus-visible, .ios-disclosure > summary:focus-visible { outline: 3px solid color-mix(in srgb, var(--rose) 55%, transparent); outline-offset: -3px; }
  `,
})
export class MorePage {
  readonly auth = inject(Auth);
  readonly theme = inject(Theme);
  readonly themes = THEMES;
  private readonly router = inject(Router);
  readonly work = inject(WorkQueue);

  /* The navigation table, shared with the desk sidebar. */
  readonly workspaces = NAV_WORKSPACES;
  readonly groups = NAV_GROUPS;
  readonly device = NAV_DEVICE;

  constructor() {
    /* Not forced: shares a request that is already under way. */
    void this.work.refresh();
  }

  /** A group's rows on Meer: everything except the phone's tab roots. */
  itemsOf(group: NavGroup): NavItem[] {
    return meerItems(group);
  }

  titleOf(item: NavItem): string {
    return meerLabel(item);
  }

  isNew(item: NavItem): boolean {
    return navItemIsNew(item);
  }

  /** A WorkQueue count by name; 0 hides the bubble. */
  countOf(key: NavCountKey | undefined): number {
    return key ? this.work[key]() : 0;
  }

  /** The count on a folded group: its rows' counts (Verkoop: the login requests). */
  groupCount(group: NavGroup): number {
    return groupCountKeys(group, 'meer').reduce((sum, key) => sum + this.countOf(key), 0);
  }

  countLabel(group: NavGroup, n: number): string {
    return group.id === 'verkoop' ? `${n} login-aanvragen wachten` : `${n} open`;
  }

  currentThemeLabel(): string {
    return THEMES.find((option) => option.key === this.theme.current())?.label ?? '';
  }

  logout(): void {
    this.auth.logout();
    void this.router.navigate(['/login']);
  }
}
