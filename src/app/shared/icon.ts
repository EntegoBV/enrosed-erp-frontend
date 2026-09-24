import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The app's icon set: a handful of hand-drawn SVG strokes.
 *
 * Inline SVG rather than a font or a library: the whole set is about sixty
 * shapes, they inherit `currentColor`, and there is nothing to load or to
 * break. Drawn on a 24-grid with round caps, the way SF Symbols feel, so
 * they sit naturally next to iOS system chrome. The second half is the
 * workspace kit's set (Kosten & bank, Documenten & media, Inkoop
 * betalingen); 'more' is the horizontal ellipsis.
 */
@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" stroke-width="1.8" stroke-linecap="round"
         stroke-linejoin="round" aria-hidden="true">
      @switch (name()) {
        @case ('folder') { <path d="M3 7V5.5A1.5 1.5 0 0 1 4.5 4H10l2 3h7.5A1.5 1.5 0 0 1 21 8.5v10a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z" /> }
        @case ('search') { <circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /> }
        @case ('plus') { <path d="M12 5v14M5 12h14" /> }
        @case ('check') { <circle cx="12" cy="12" r="8.5" /><path d="m8 12 2.5 2.5L16 9" /> }
        @case ('download') { <path d="M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4" /> }
        @case ('move') { <path d="M3 7V5h7l2 3h9v12H3v-8m4 2h10m-3-3 3 3-3 3" /> }
        @case ('close') { <path d="m6 6 12 12M6 18 18 6" /> }
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
        @case ('truck') {
          <!-- A little lorry: the freight staffels. -->
          <path d="M2.5 6.5h11v9h-11z" />
          <path d="M13.5 9.5h4l3 3v3h-7" />
          <circle cx="6.5" cy="17.5" r="1.8" />
          <circle cx="16.5" cy="17.5" r="1.8" />
        }
        @case ('barcode') {
          <path d="M4 6v12M7 6v12M10 6v12M13 6v12M16 6v12M19 6v12" />
        }
        @case ('stock') {
          <!-- Stacked boxes: stock that lies somewhere. -->
          <path d="M4 10.5h16v9.5H4z" />
          <path d="M7 10.5V5h10v5.5" />
          <path d="M10 5v5.5M14 5v5.5M4 15h16" />
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
        @case ('activity') {
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7.5V12l3 2" />
          <path d="M4.5 5.5 3 8h3" />
        }
        @case ('analytics') {
          <path d="M4 20V11.5h4V20M10 20V4h4v16M16 20v-9h4v9" />
          <path d="M3 20.5h18" />
        }
        @case ('pdf') {
          <path d="M7 3.5h7l4 4V20.5H7z" /><path d="M14 3.5v4h4" />
        }
        @case ('media') {
          <path d="M4 4.5h11v11H4z" />
          <path d="m5.5 13 3.1-3.1 2.1 2.1 1.5-1.5 2.8 2.8" />
          <circle cx="11.8" cy="7.6" r="1.2" />
          <path d="M9 18.5h11v-11h-2.5" />
        }
        <!-- The workspace kit: money, files and the chrome around them. -->
        @case ('bank') { <path d="M3.5 9 12 4l8.5 5z" /><path d="M6.5 11.5v6M12 11.5v6M17.5 11.5v6" /><path d="M4 20h16" /> }
        @case ('arrow-in') { <path d="M17.5 6.5 7 17" /><path d="M7 9.5V17h7.5" /> }
        @case ('arrow-out') { <path d="M6.5 17.5 17 7" /><path d="M9.5 7H17v7.5" /> }
        @case ('receipt') { <path d="M6 3.5l2 1.3 2-1.3 2 1.3 2-1.3 2 1.3 2-1.3v17l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3-2 1.3z" /><path d="M14.6 9.3a3.1 3.1 0 1 0 0 5.4" /><path d="M8.8 11.2h4.4M8.8 12.8h4.4" /> }
        @case ('clip') { <path d="M19 11.5l-7.4 7.4a4.6 4.6 0 0 1-6.5-6.5l7.8-7.8a3 3 0 0 1 4.3 4.3l-7.7 7.7a1.5 1.5 0 0 1-2.1-2.1l7-7" /> }
        @case ('repeat') { <path d="M4.5 11V9.5a3 3 0 0 1 3-3h11" /><path d="m15.5 3.5 3 3-3 3" /><path d="M19.5 13v1.5a3 3 0 0 1-3 3h-11" /><path d="m8.5 20.5-3-3 3-3" /> }
        @case ('calendar') { <rect x="4" y="5.5" width="16" height="14.5" rx="2.5" /><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" /> }
        @case ('link') { <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2" /> }
        @case ('unlink') { <path d="M8.5 5.5v-2M5.5 8.5h-2M15.5 18.5v2M18.5 15.5h2" /><path d="M12.8 7.1l1.9-1.9a4 4 0 0 1 5.7 5.7l-1.9 1.9" /><path d="M11.2 16.9l-1.9 1.9a4 4 0 0 1-5.7-5.7l1.9-1.9" /> }
        @case ('alert') { <path d="M12 4.5 20.5 19.5h-17z" /><path d="M12 10v4" /><circle cx="12" cy="16.9" r=".9" fill="currentColor" stroke="none" /> }
        @case ('info') { <circle cx="12" cy="12" r="8.5" /><path d="M12 11v5" /><circle cx="12" cy="8" r=".9" fill="currentColor" stroke="none" /> }
        @case ('refresh') { <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" /><path d="M18 3.3v3.9h-3.9" /> }
        @case ('camera') { <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.3l1.5-2.5h5.4L16.2 7h2.3A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" /><circle cx="12" cy="12.8" r="3.4" /> }
        @case ('filter') { <path d="M4 5.5h16l-6.2 7.3v5.4l-3.6 1.8v-7.2z" /> }
        @case ('recent') { <circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3.2 1.9" /> }
        @case ('archive') { <rect x="3.5" y="4.5" width="17" height="4.5" rx="1" /><path d="M5 9v9.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V9" /><path d="M10 13h4" /> }
        @case ('restore') { <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" /><path d="M6 3.3v3.9h3.9" /> }
        @case ('layers') { <path d="M12 4 20.5 8.5 12 13 3.5 8.5z" /><path d="m3.5 12.5 8.5 4.5 8.5-4.5" /><path d="m3.5 16.5 8.5 4.5 8.5-4.5" /> }
        @case ('share') { <path d="M12 14.5v-11" /><path d="m8.5 7 3.5-3.5L15.5 7" /><path d="M9 10.5H7A1.5 1.5 0 0 0 5.5 12v7A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5v-7a1.5 1.5 0 0 0-1.5-1.5h-2" /> }
        @case ('upload') { <path d="M12 15V3.5m-4 4 4-4 4 4M4 16v4h16v-4" /> }
        @case ('globe') { <circle cx="12" cy="12" r="8.5" /><path d="M12 3.5c-2.3 2.4-3.4 5.2-3.4 8.5s1.1 6.1 3.4 8.5c2.3-2.4 3.4-5.2 3.4-8.5S14.3 5.9 12 3.5z" /><path d="M4 9.2h16M4 14.8h16" /> }
        @case ('image') { <rect x="3.5" y="5" width="17" height="14" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="m4 17.5 5-4.5 3.5 3 2.5-2 5 4" /> }
        @case ('document') { <path d="M6.5 3.5H14l4 4v13H6.5z" /><path d="M14 3.5v4h4" /><path d="M9.5 12h5M9.5 15.5h5" /> }
        @case ('eye') { <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /> }
        @case ('pencil') { <path d="M4 20h4L19 9l-4-4L4 16z" /><path d="m13.5 6.5 4 4" /> }
        @case ('trash') { <path d="M4.5 7h15" /><path d="M9.5 7V4.5h5V7" /><path d="M6.5 7l1 13h9l1-13" /><path d="M10.5 11v5.5M13.5 11v5.5" /> }
        @case ('list') { <path d="M9 7h11M9 12h11M9 17h11" /><circle cx="5" cy="7" r="1.1" fill="currentColor" stroke="none" /><circle cx="5" cy="12" r="1.1" fill="currentColor" stroke="none" /><circle cx="5" cy="17" r="1.1" fill="currentColor" stroke="none" /> }
        @case ('grid') { <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" /> }
        @case ('tick') { <path d="m5 12.5 4.5 4.5L19 7.5" /> }
        @case ('chevron-left') { <path d="m14.5 5.5-6.5 6.5 6.5 6.5" /> }
        @case ('chevron-right') { <path d="m9.5 5.5 6.5 6.5-6.5 6.5" /> }
        @case ('chevron-up') { <path d="m5.5 14.5 6.5-6.5 6.5 6.5" /> }
        @case ('chevron-down') { <path d="m5.5 9.5 6.5 6.5 6.5-6.5" /> }
        @case ('external') { <path d="M13.5 4.5h6v6" /><path d="M19.5 4.5 11 13" /><path d="M17.5 14v4.5A1.5 1.5 0 0 1 16 20H5.5A1.5 1.5 0 0 1 4 18.5V8a1.5 1.5 0 0 1 1.5-1.5H10" /> }
        @case ('tag') { <path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1.4 1.4 0 0 1 0 2l-6.7 6.7a1.4 1.4 0 0 1-2 0z" /><circle cx="8" cy="8" r="1.4" /> }
        @case ('copy') { <rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2" /><path d="M15.5 8.5v-3A1.5 1.5 0 0 0 14 4H5.5A1.5 1.5 0 0 0 4 5.5V14a1.5 1.5 0 0 0 1.5 1.5h3" /> }
      }
    </svg>
  `,
  styles: `:host { display: inline-flex; line-height: 0; }`,
})
export class Icon {
  readonly name = input.required<string>();
  readonly size = input(22);
}
