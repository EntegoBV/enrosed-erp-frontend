import type { Signal } from '@angular/core';

/**
 * One save model per settings view: the view keeps a draft, the page shows
 * the save actions in its toolbar while something changed ("2 wijzigingen
 * niet opgeslagen · Wijzigingen wissen · Opslaan", ⌘S on the desk) and asks
 * through confirmLeave before /settings is left with a dirty view.
 *
 * Views stay mounted after their first visit (hidden while another view
 * shows), so a tab switch never loses a draft. The page reads each editor
 * through viewChild; there is no DI token.
 */
export interface SettingsEditor {
  /** True while the draft differs from what was saved. */
  readonly dirty: Signal<boolean>;
  /** How many fields (or rows) changed: the number in the toolbar status. */
  readonly dirtyCount: Signal<number>;
  readonly saving: Signal<boolean>;
  /** Saves the draft; false when nothing was sent or it failed (the screen then stays). */
  save(): Promise<boolean>;
  /** Drops the draft: back to the saved values. */
  revert(): void;
}

/** "1 wijziging" / "2 wijzigingen" niet opgeslagen. */
export function dirtyStatusText(count: number): string {
  return `${count} ${count === 1 ? 'wijziging' : 'wijzigingen'} niet opgeslagen`;
}
