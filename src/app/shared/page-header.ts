import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { BrandMark } from './brand-mark';
import { NotificationBell } from './notification-bell';

/**
 * Top bar of a page. Phones get a back button on detail views; on desktop it
 * disappears because the sidebar takes over navigation.
 *
 * The title can be editable — order screens use this so the document number
 * is changed right where it is displayed, instead of in a form field that
 * duplicates it further down. Tap the title, type, press enter or tap
 * elsewhere. An empty value is discarded: clearing a document number is never
 * what anyone meant.
 */
@Component({
  selector: 'app-page-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BrandMark, NotificationBell],
  template: `
    <header class="appbar">
      @if (showBack()) {
        <button class="appbar__back" type="button" aria-label="Terug" (click)="back()">‹</button>
      } @else {
        <!-- On phones the brand mark sits here; double-tapping it toggles the
             purchase figures. On desktop the sidebar's mark does that. -->
        <div class="appbar__brand hide-desktop">
          <app-brand-mark [small]="true" />
        </div>
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
            <button class="appbar__title-button" type="button"
                    [attr.aria-label]="'Titel wijzigen: ' + title()" (click)="startEditing()">
              {{ title() }} <span class="appbar__pencil" aria-hidden="true">✎</span>
            </button>
          </h1>
        } @else {
          <h1 class="appbar__title">{{ title() }}</h1>
        }
        @if (subtitle()) {
          <div class="appbar__sub">{{ subtitle() }}</div>
        }
      </div>
      <div class="appbar__actions">
        <ng-content />
        @if (showBell()) {
          <app-notification-bell />
        }
      </div>
    </header>
  `,
  styles: `
    .appbar__titles {
      display: flex;
      min-width: 0;
      overflow: visible;
      flex-direction: column;
      justify-content: center;
      gap: 2px;
    }
    .appbar__title {
      min-width: 0;
      line-height: 1;
    }
    .appbar__sub {
      margin: 0;
      line-height: 1;
    }
    .appbar__title-button {
      border: 0;
      background: transparent;
      padding: 0;
      font: inherit;
      font-size: inherit;
      font-weight: inherit;
      text-align: left;
      cursor: pointer;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      display: block;
      line-height: 1;
      position: relative;
      z-index: 1;
    }
    /* Keep the editable title visually compact inside the two-line header.
       The transparent hit area provides a forgiving touch target without
       pushing the supplier/customer subtitle down. */
    .appbar__title-button::after {
      content: '';
      position: absolute;
      z-index: 1;
      top: 50%;
      left: -8px;
      width: max(calc(100% + 16px), 44px);
      height: 44px;
      transform: translateY(-50%);
    }
    .appbar__pencil {
      display: inline-block;
      margin-left: 3px;
      color: var(--muted-2);
      font-size: 16px;
      line-height: 1;
      transform: translateY(1px);
    }
    .appbar__title-input {
      font: inherit;
      font-size: inherit;
      font-weight: inherit;
      width: 100%;
      max-width: 240px;
      border: 0;
      border-bottom: 2px solid var(--rose);
      background: transparent;
      padding: 0;
    }
  `,
})
export class PageHeader {
  readonly title = input.required<string>();
  readonly subtitle = input('');
  readonly showBack = input(false);
  /** Where back goes when the page was opened directly (no history to return to). */
  readonly backTo = input<string | null>(null);
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

  constructor(
    private readonly location: Location,
    private readonly router: Router,
    private readonly documentTitle: Title,
  ) {
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

  back(): void {
    const fallback = this.backTo();
    if (fallback && window.history.length <= 1) { void this.router.navigateByUrl(fallback); return; }
    this.location.back();
  }
}
