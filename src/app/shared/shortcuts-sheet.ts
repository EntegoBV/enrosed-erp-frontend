import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { Sheet } from './ui';
import {
  GLOBAL_SHORTCUTS, WORKSPACE_SHORTCUTS_NOTE, pageShortcutsFor,
} from '../core/platform/app-shortcuts';
import type { ShortcutRow } from '../core/platform/app-shortcuts';

/**
 * Sneltoetsen: the desk's keyboard help, opened with '?' or the key cap in
 * the sidebar foot. "Overal" lists the keys that work everywhere; "Op deze
 * pagina" the open screen's own (PAGE_SHORTCUTS, areas append theirs) and
 * hides when there are none. Loaded on demand (App's @defer).
 */
@Component({
  selector: 'app-shortcuts-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet],
  template: `
    <app-sheet title="Sneltoetsen" (closed)="closed.emit()">
      <div body class="keys">
        <h3 class="keys__head">Overal</h3>
        @for (row of global; track row.text) {
          <div class="keys__row">
            <span class="keys__caps">
              @for (key of row.keys; track $index) { <kbd class="wk-kbd keys__kbd">{{ key }}</kbd> }
              @if (row.alt) {
                <span class="keys__or">/</span>
                @for (key of row.alt; track $index) { <kbd class="wk-kbd keys__kbd">{{ key }}</kbd> }
              }
            </span>
            <span class="keys__text">{{ row.text }}</span>
          </div>
        }
        @if (page().length) {
          <h3 class="keys__head">Op deze pagina</h3>
          @for (row of page(); track row.text) {
            <div class="keys__row">
              <span class="keys__caps">
                @for (key of row.keys; track $index) { <kbd class="wk-kbd keys__kbd">{{ key }}</kbd> }
              </span>
              <span class="keys__text">{{ row.text }}</span>
            </div>
          }
        }
      </div>
      <p foot class="keys__note">{{ note }}</p>
    </app-sheet>
  `,
  styles: `
    .keys { display: grid; gap: 2px; }
    .keys__head { margin: 6px 0 4px; color: var(--muted); font-size: 11px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
    .keys__head:not(:first-child) { margin-top: 16px; }
    .keys__row { display: grid; grid-template-columns: 150px minmax(0, 1fr); align-items: center; gap: 12px; min-height: 34px; border-bottom: 1px solid var(--line); }
    .keys__row:last-of-type { border-bottom: 0; }
    .keys__caps { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
    .keys__kbd { min-width: 22px; height: 22px; font-size: 12px; color: var(--ink-2); }
    .keys__or { color: var(--muted); font-size: 12px; }
    .keys__text { color: var(--ink); font-size: 13.5px; line-height: 1.35; }
    .keys__note { flex: 1; margin: 0; color: var(--muted); font-size: 12.5px; line-height: 1.4; }
  `,
})
export class ShortcutsSheet {
  /** The open URL, for "Op deze pagina". */
  readonly url = input('');
  readonly closed = output<void>();
  readonly global: readonly ShortcutRow[] = GLOBAL_SHORTCUTS;
  readonly page = computed(() => pageShortcutsFor(this.url()));
  readonly note = WORKSPACE_SHORTCUTS_NOTE;
}
