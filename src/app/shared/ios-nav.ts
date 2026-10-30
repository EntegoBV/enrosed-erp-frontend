import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { Icon } from './icon';
import { observeLargeTitle } from './large-title';
import { HostBridge } from '../core/platform/host-bridge';
import type { HostActionEvent, HostPageInput } from '../core/platform/host-bridge';
import { observeMirror } from './host-page';

/**
 * The iOS 26 navigation bar of a workspace phone screen: a transparent bar
 * with glass buttons over a large title that scrolls away, after which the
 * bar covers scrolled content in the page colour and shows the title small in its middle.
 *
 * Slots: [lead] after the back button, [trail] for the glass buttons on the
 * right, [caption] under the large title, [below] for a sticky control such
 * as a segmented filter (wrap it in <div class="ios-subbar">). The host is
 * display:contents, so the bar and the subbar stick against the page.
 * With customLarge, [hero] replaces the large title with the screen's own
 * block; the bar condenses once the block's own h1 has gone under it (the
 * block can be tall: the small title used to come only after all of it), or
 * once the whole block has when it has no h1.
 *
 * Two states: `condensed` (the title is gone, the bar has taken it over) and
 * `stuck` (the [below] sub-bar stands on its sticky line: the sentinel right
 * above it has passed that line, the sub-bar's own computed top, which in the
 * native host is not always the bar's height). The bar carries them as
 * ios-nav--condensed and ios-nav--stuck, with ios-nav--large on a large title.
 *
 * backLabel null shows no back button, '' a glass circle with a chevron,
 * any text a glass capsule. With backUrl the button navigates there;
 * without it the (back) output lets the screen decide.
 *
 * Inside the native host (core/platform/host-bridge.ts) the bar is a
 * spacer and the shell draws the chrome from the descriptor this nav
 * publishes: title, subtitle, back, the large title's state, and either
 * the screen's explicit `[host]` items (delivered through `(hostAction)`)
 * or a mirror of the projected [lead]/[trail] buttons.
 */
/** Where the [below] sub-bar sticks (the sentinel's next sibling): its own computed top; the bar's height without one. */
function stickLine(sentinel: HTMLElement, bar: HTMLElement): number {
  const below = sentinel.nextElementSibling;
  const top = below ? parseFloat(getComputedStyle(below).top) : NaN;
  return Math.round(Number.isNaN(top) ? bar.getBoundingClientRect().height : top);
}

@Component({
  selector: 'app-ios-nav',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <header #bar class="ios-nav" [class.ios-nav--large]="large" [class.ios-nav--condensed]="condensed() || !large" [class.ios-nav--stuck]="stuck()">
      <div class="ios-nav__lead">
        @if (backLabel() === '') {
          <button class="ios-circle" type="button" [attr.aria-label]="backAriaLabel()" (click)="goBack()">
            <app-icon name="chevron-left" [size]="22" />
          </button>
        } @else if (backLabel() !== null) {
          <button class="ios-capsule ios-back" type="button" [attr.aria-label]="backAriaLabel()" (click)="goBack()">
            <app-icon name="chevron-left" [size]="22" />{{ backLabel() }}
          </button>
        }
        <ng-content select="[lead]" />
      </div>
      <div class="ios-nav__title" [attr.role]="large ? null : 'heading'" [attr.aria-level]="large ? null : 1"
           [attr.aria-hidden]="large && !condensed() ? 'true' : null">{{ title() }}</div>
      <div class="ios-nav__trail"><ng-content select="[trail]" /></div>
    </header>
    @if (large) {
      @if (custom) { <ng-content select="[hero]" /> } @else {
        <div class="ios-large">
          <h1 class="ios-large__title">{{ title() }}</h1>
          @if (subtitle()) { <p class="ios-large__sub">{{ subtitle() }}</p> }
          <ng-content select="[caption]" />
        </div>
      }
      <div #sentinel class="ios-large__sentinel" aria-hidden="true"></div>
    }
    <ng-content select="[below]" />
  `,
})
export class IosNav {
  private readonly router = inject(Router);

  readonly title = input.required<string>();
  readonly subtitle = input<string | null>(null);
  /** Read once, at the first render: a screen does not switch styles while open. */
  readonly largeTitle = input(true);
  /** Read once like largeTitle: the screen projects its own [hero] block in place of the large title. */
  readonly customLarge = input(false);
  readonly backLabel = input<string | null>(null);
  readonly backUrl = input<string | null>(null);
  readonly backAriaLabel = input('Terug');
  /** Emitted by the back button when there is no backUrl. */
  readonly back = output<void>();
  /** The native host's items for this screen; undefined mirrors the projected buttons instead. */
  readonly host = input<HostPageInput | null | undefined>(undefined);
  /** A native action by id (the screen's method name, or `refresh`). */
  readonly hostAction = output<HostActionEvent>();

  private readonly condensedState = signal(false);
  /** True once the large title has scrolled under the bar. */
  readonly condensed = this.condensedState.asReadonly();
  private readonly stuckState = signal(false);
  /** True once the [below] sub-bar has reached its sticky line. */
  readonly stuck = this.stuckState.asReadonly();

  private readonly bar = viewChild.required<ElementRef<HTMLElement>>('bar');
  private readonly sentinel = viewChild<ElementRef<HTMLElement>>('sentinel');
  private largeRead: boolean | null = null;
  private customRead: boolean | null = null;

  constructor() {
    const destroyRef = inject(DestroyRef);
    const bridge = inject(HostBridge);
    const element = inject<ElementRef<HTMLElement>>(ElementRef);
    if (bridge.present) {
      const mirror = observeMirror(element, destroyRef, {
        scopes: () => Array.from(element.nativeElement.querySelectorAll('.ios-nav__lead, .ios-nav__trail')),
        /* The back control is the host's own; a projected [lead] capsule is not. */
        skip: (control) => control.classList.contains('ios-back')
          || (control.parentElement?.classList.contains('ios-nav__lead') === true && control.classList.contains('ios-circle')
            && !!control.querySelector('app-icon[data-icon="chevron-left"]')),
        pageRoot: () => element.nativeElement.parentElement,
      });
      bridge.bind({
        title: () => this.title(),
        subtitle: () => this.subtitle(),
        back: () => {
          const label = this.backLabel();
          if (label === null) return null;
          return { label: label || this.backAriaLabel().replace(/^Terug naar /, '') || 'Terug', url: this.backUrl() ?? '' };
        },
        largeTitle: () => this.large,
        condensed: () => this.condensed(),
        input: () => this.host(),
        mirror: () => mirror(),
        onAction: (event) => this.hostAction.emit(event),
        onBack: () => this.goBack(),
      });
    }
    const stops: (() => void)[] = [];
    afterNextRender(() => {
      const sentinel = this.sentinel()?.nativeElement;
      if (!sentinel) return;
      const bar = this.bar().nativeElement;
      const heroTitle = this.custom ? element.nativeElement.querySelector<HTMLElement>('[hero] h1') : null;
      stops.push(observeLargeTitle(bar, heroTitle ?? sentinel, (condensed) => this.condensedState.set(condensed)));
      stops.push(observeLargeTitle(bar, sentinel, (stuck) => this.stuckState.set(stuck), () => stickLine(sentinel, bar)));
    });
    destroyRef.onDestroy(() => stops.forEach((stop) => stop()));
  }

  /** largeTitle() at the first render, kept from then on. */
  get large(): boolean {
    this.largeRead ??= this.largeTitle();
    return this.largeRead;
  }

  /** customLarge() at the first render, kept from then on. */
  get custom(): boolean {
    this.customRead ??= this.customLarge();
    return this.customRead;
  }

  goBack(): void {
    const url = this.backUrl();
    /* info: the phone motion slides this back like a pop (nav-motion.ts). */
    if (url) void this.router.navigateByUrl(url, { info: { nav: 'pop' } });
    else this.back.emit();
  }
}
