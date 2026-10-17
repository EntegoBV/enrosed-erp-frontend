import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Location } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { Icon } from '../../shared/icon';
import { PageHeader } from '../../shared/page-header';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { NavHistory } from '../../core/platform/nav-history-service';
import { middleEllipsis } from './middle-ellipsis';

/** The doors a lost visitor most likely wanted. */
const DOORS = [
  { label: 'Verkoop', hint: 'Offertes, facturen en klanten', icon: 'sales', link: '/sales', tone: 'tone-accent' },
  { label: 'Inkoop', hint: 'Containers en leveranciers', icon: 'purchase', link: '/purchasing', tone: 'tone-amber' },
  { label: 'Producten', hint: 'Catalogus en voorraad', icon: 'products', link: '/products', tone: 'tone-green' },
  { label: 'Kosten & bank', hint: 'Kosten, bank en betalingen', icon: 'exchange', link: '/costs', tone: 'tone-teal' },
] as const;

/**
 * An address without a screen (an old link, a typo), inside the shell: it
 * says which address, offers the way back and the four doors used most.
 * Behind the login (the route's authGuard), so a logged-out visitor first
 * signs in and then lands here with the same address.
 */
@Component({
  selector: 'app-not-found-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PageHeader, Icon],
  template: `
    <app-page-header title="Pagina niet gevonden" />
    <div class="content nf">
      <div class="nf__intro">
        @if (desktop.active()) {
          <div class="wk-empty__icon nf__icon" aria-hidden="true"><app-icon name="alert" [size]="26" /></div>
        }
        <h2 class="nf__title">Deze pagina bestaat niet</h2>
        <p class="nf__text">Op <code class="nf__path" [attr.title]="path()">{{ shortPath() }}</code> staat geen scherm.
          Misschien is de link oud of is het scherm verhuisd.</p>
        <div class="nf__actions">
          <a class="btn btn--primary" routerLink="/dashboard">Naar dashboard</a>
          @if (canGoBack()) {
            <button class="btn" type="button" (click)="back()">Terug</button>
          }
        </div>
      </div>

      <h3 class="nf__label" id="nf-doors">Of ga naar</h3>
      @if (desktop.active()) {
        <nav class="nf__doors" aria-labelledby="nf-doors">
          @for (door of doors; track door.link) {
            <a class="nf__door" [routerLink]="door.link">
              <span [class]="'ios-tile ' + door.tone"><app-icon [name]="door.icon" [size]="18" /></span>
              <span class="nf__door-title">{{ door.label }}</span>
              <span class="nf__door-hint">{{ door.hint }}</span>
            </a>
          }
        </nav>
      } @else {
        <nav class="ios-group ios-group--icons nf__list" aria-labelledby="nf-doors">
          @for (door of doors; track door.link) {
            <a class="ios-cell" [routerLink]="door.link">
              <span [class]="'ios-tile ' + door.tone"><app-icon [name]="door.icon" [size]="18" /></span>
              <span class="ios-cell__body">
                <span class="ios-cell__title">{{ door.label }}</span>
                <span class="ios-cell__sub">{{ door.hint }}</span>
              </span>
              <app-icon class="ios-cell__chev" name="chevron-right" [size]="18" />
            </a>
          }
        </nav>
      }
    </div>
  `,
  styles: `
    :host { display: block; min-width: 0; }
    .nf { max-width: 640px; }
    .nf__intro { display: grid; justify-items: center; gap: 8px; padding: 28px 0 8px; text-align: center; }
    .nf__icon { width: 56px; height: 56px; margin-bottom: 6px; border-radius: 16px; }
    .nf__title { margin: 0; color: var(--ink); font-size: 20px; font-weight: 700; letter-spacing: -.01em; }
    .nf__text { max-width: 460px; margin: 0; color: var(--muted); font-size: 14.5px; line-height: 1.5; }
    .nf__path { padding: 1px 6px; border-radius: 6px; background: var(--surface-2); color: var(--ink-2); font-family: var(--mono); font-size: 13px; overflow-wrap: anywhere; }
    .nf__actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin-top: 10px; }
    .nf__label { margin: 28px 4px 10px; color: var(--muted); font-size: 11px; font-weight: 700; letter-spacing: .1em; text-align: center; text-transform: uppercase; }
    .nf__doors { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .nf__door { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 2px 12px; padding: 14px; border: 1px solid var(--line); border-radius: 14px; background: var(--surface); color: var(--ink); text-decoration: none; transition: border-color var(--dur-1, .12s) var(--ease-out, ease), background-color var(--dur-1, .12s) var(--ease-out, ease); }
    .nf__door:hover { border-color: var(--line-strong); background: var(--surface-2); }
    .nf__door:focus-visible { outline: 2px solid var(--rose); outline-offset: 2px; }
    .nf__door .ios-tile { grid-row: span 2; }
    .nf__door-title { font-size: 14px; font-weight: 650; }
    .nf__door-hint { color: var(--muted); font-size: 12.5px; line-height: 1.35; }
    @media (min-width: 1024px) {
      .nf { max-width: 880px; }
      .nf__doors { grid-template-columns: repeat(4, minmax(0, 1fr)); }
      .nf__door { grid-template-columns: 1fr; justify-items: start; gap: 8px; }
      .nf__door .ios-tile { grid-row: auto; }
      .nf__door-title { margin-top: 2px; }
    }
    @media (max-width: 679.98px) {
      .nf { padding-inline: 0; }
      .nf__intro { padding: 12px 24px 4px; }
      .nf__label { text-align: left; margin-inline: calc(var(--ios-inset) + 16px); }
      .ios-cell__sub { white-space: normal; }
    }
  `,
})
export class NotFoundPage {
  readonly desktop = inject(DesktopViewport);
  private readonly history = inject(NavHistory);
  private readonly location = inject(Location);
  private readonly router = inject(Router);

  readonly doors = DOORS;
  /** The address as it was asked for. */
  readonly path = computed(() => this.history.current() ?? this.router.url);
  readonly shortPath = computed(() => middleEllipsis(this.path(), 60));
  /** Terug only when there is an in-app screen to return to. */
  readonly canGoBack = computed(() => !!this.history.below());

  back(): void {
    this.location.back();
  }
}
