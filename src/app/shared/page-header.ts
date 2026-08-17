import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { Location } from '@angular/common';
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
          <input
            class="appbar__title-input"
            type="text"
            [value]="title()"
            (blur)="commitTitle($any($event.target).value)"
            (keydown.enter)="commitTitle($any($event.target).value)"
            (keydown.escape)="editingTitle.set(false)"
            #titleField
          />
        } @else if (titleEditable()) {
          <button class="appbar__title appbar__title--editable" type="button"
                  aria-label="Nummer wijzigen" (click)="startEditing()">
            {{ title() }} <span class="appbar__pencil">✎</span>
          </button>
        } @else {
          <div class="appbar__title">{{ title() }}</div>
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
    .appbar__title--editable {
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
    }
    .appbar__pencil { font-size: 12px; color: var(--muted-2); }
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
      outline: none;
    }
  `,
})
export class PageHeader {
  readonly title = input.required<string>();
  readonly subtitle = input('');
  readonly showBack = input(false);
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

  constructor(private readonly location: Location) {}

  startEditing(): void {
    this.editingTitle.set(true);
    /* The input renders on the next tick; focus it once it exists. */
    setTimeout(() => {
      const field = document.querySelector<HTMLInputElement>('.appbar__title-input');
      field?.focus();
      field?.select();
    });
  }

  commitTitle(raw: string): void {
    this.editingTitle.set(false);
    const value = raw.trim();
    if (value && value !== this.title()) {
      this.titleChange.emit(value);
    }
  }

  back(): void {
    this.location.back();
  }
}
