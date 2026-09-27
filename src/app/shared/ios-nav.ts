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

/**
 * The iOS 26 navigation bar of a workspace phone screen: a transparent bar
 * with glass buttons over a large title that scrolls away, after which the
 * bar turns to glass and shows the title small in its middle.
 *
 * Slots: [lead] after the back button, [trail] for the glass buttons on the
 * right, [caption] under the large title, [below] for a sticky control such
 * as a segmented filter (wrap it in <div class="ios-subbar">). The host is
 * display:contents, so the bar and the subbar stick against the page.
 *
 * backLabel null shows no back button, '' a glass circle with a chevron,
 * any text a glass capsule. With backUrl the button navigates there;
 * without it the (back) output lets the screen decide.
 */
@Component({
  selector: 'app-ios-nav',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <header #bar class="ios-nav" [class.ios-nav--condensed]="condensed() || !large">
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
      <div class="ios-large">
        <h1 class="ios-large__title">{{ title() }}</h1>
        @if (subtitle()) { <p class="ios-large__sub">{{ subtitle() }}</p> }
        <ng-content select="[caption]" />
      </div>
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
  readonly backLabel = input<string | null>(null);
  readonly backUrl = input<string | null>(null);
  readonly backAriaLabel = input('Terug');
  /** Emitted by the back button when there is no backUrl. */
  readonly back = output<void>();

  private readonly condensedState = signal(false);
  /** True once the large title has scrolled under the bar. */
  readonly condensed = this.condensedState.asReadonly();

  private readonly bar = viewChild.required<ElementRef<HTMLElement>>('bar');
  private readonly sentinel = viewChild<ElementRef<HTMLElement>>('sentinel');
  private largeRead: boolean | null = null;

  constructor() {
    const destroyRef = inject(DestroyRef);
    let observer: IntersectionObserver | null = null;
    afterNextRender(() => {
      const sentinel = this.sentinel()?.nativeElement;
      if (!sentinel || typeof IntersectionObserver === 'undefined') return;
      /* The sentinel sits right under the large title: once it passes under
         the bar, the title is gone and the bar takes it over. */
      const height = Math.round(this.bar().nativeElement.getBoundingClientRect().height);
      observer = new IntersectionObserver(([entry]) => {
        this.condensedState.set(!entry.isIntersecting && entry.boundingClientRect.top < height);
      }, { rootMargin: `-${height}px 0px 0px 0px`, threshold: 0 });
      observer.observe(sentinel);
    });
    destroyRef.onDestroy(() => observer?.disconnect());
  }

  /** largeTitle() at the first render, kept from then on. */
  get large(): boolean {
    this.largeRead ??= this.largeTitle();
    return this.largeRead;
  }

  goBack(): void {
    const url = this.backUrl();
    if (url) void this.router.navigateByUrl(url);
    else this.back.emit();
  }
}
