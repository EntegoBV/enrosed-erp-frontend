import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** The saved document note is also the comment supplied with a website request. */
@Component({
  selector: 'app-sales-document-note',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[style.display]': 'notes()?.trim() ? "block" : "none"' },
  template: `
    @if (notes()?.trim()) {
      <section class="document-note" aria-label="Opmerking">
        <header>
          <h2>Opmerking</h2>
          <span>Zichtbaar voor de klant</span>
        </header>
        <p>{{ notes() }}</p>
      </section>
    }
  `,
  styles: `
    :host { min-width: 0; }
    .document-note {
      margin: 0 0 16px;
      padding: 16px 18px;
      border: 1px solid color-mix(in srgb, var(--gold) 38%, var(--line));
      border-radius: 16px;
      background: color-mix(in srgb, var(--gold-soft) 24%, var(--surface));
    }
    header { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 14px; }
    h2 { margin: 0; font-size: 15px; line-height: 1.4; color: var(--ink); }
    header span { color: var(--muted); font-size: 11px; line-height: 1.5; }
    p { margin: 9px 0 0; font-size: 14px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; }
    @media (max-width: 600px) { .document-note { padding: 14px; } }
  `,
})
export class SalesDocumentNote {
  readonly notes = input<string | null | undefined>();
}
