import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The app's icon set: a handful of hand-drawn SVG strokes.
 *
 * Inline SVG rather than a font or a library: the whole set is a dozen
 * shapes, they inherit `currentColor`, and there is nothing to load or to
 * break. Drawn on a 24-grid with round caps, the way SF Symbols feel, so
 * they sit naturally next to iOS system chrome.
 */
@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" stroke-width="1.8" stroke-linecap="round"
         stroke-linejoin="round" aria-hidden="true">
      @switch (name()) {
        @case ('home') {
          <path d="M3.5 10.5 12 3.5l8.5 7" />
          <path d="M5.5 9.3V20h13V9.3" />
          <path d="M10 20v-5.5h4V20" />
        }
        @case ('sales') {
          <path d="M6.5 3.5h11V20l-2.2-1.6L13 20l-1-0.8L11 20l-2.3-1.6L6.5 20z" />
          <path d="M9.5 8h5" /><path d="M9.5 11.5h5" /><path d="M9.5 15h3" />
        }
        @case ('purchase') {
          <path d="M3.5 7.6 12 3.5l8.5 4.1v8.8L12 20.5l-8.5-4.1z" />
          <path d="M3.5 7.6 12 11.7l8.5-4.1" />
          <path d="M12 11.7v8.8" />
        }
        @case ('products') {
          <circle cx="12" cy="8" r="3.2" />
          <path d="M12 11.2V20" />
          <path d="M12 16.5c-2.6 0-4.5-1.3-4.8-3.4 2.6 0 4.4 1.2 4.8 3.4z" />
          <path d="M12 16.5c2.6 0 4.5-1.3 4.8-3.4-2.6 0-4.4 1.2-4.8 3.4z" />
        }
        @case ('more') {
          <circle cx="5" cy="12" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="19" cy="12" r="1.2" fill="currentColor" stroke="none" />
        }
        @case ('exchange') {
          <path d="M6.5 8.5h11l-3-3" /><path d="M17.5 15.5h-11l3 3" />
        }
        @case ('customers') {
          <circle cx="12" cy="8.2" r="3.4" />
          <path d="M5.2 20c.8-3.5 3.5-5.4 6.8-5.4s6 1.9 6.8 5.4" />
        }
        @case ('suppliers') {
          <path d="M3.5 7h10v9h-10z" /><path d="M13.5 10h4l2.5 3v3h-6.5" />
          <circle cx="7.5" cy="18" r="1.8" /><circle cx="16.5" cy="18" r="1.8" />
        }
        @case ('countries') {
          <circle cx="12" cy="12" r="8.5" />
          <path d="M3.5 12h17" />
          <path d="M12 3.5c2.6 2.3 3.9 5.2 3.9 8.5s-1.3 6.2-3.9 8.5c-2.6-2.3-3.9-5.2-3.9-8.5s1.3-6.2 3.9-8.5z" />
        }
        @case ('settings') {
          <path d="M4 8h10" /><circle cx="17" cy="8" r="2.2" />
          <path d="M20 16H10" /><circle cx="7" cy="16" r="2.2" />
        }
        @case ('bell') {
          <path d="M12 4a5.5 5.5 0 0 0-5.5 5.5c0 4-1.5 5.5-2 6h15c-.5-.5-2-2-2-6A5.5 5.5 0 0 0 12 4z" />
          <path d="M10 18.5a2 2 0 0 0 4 0" />
        }
        @case ('pdf') {
          <path d="M7 3.5h7l4 4V20.5H7z" /><path d="M14 3.5v4h4" />
        }
      }
    </svg>
  `,
  styles: `:host { display: inline-flex; line-height: 0; }`,
})
export class Icon {
  readonly name = input.required<string>();
  readonly size = input(22);
}
