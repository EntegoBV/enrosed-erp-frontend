import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import { PAGE_SEARCH_SELECTOR, shortcutCommand } from './app-shortcuts';
import { keyContext } from '../../shared/key-context';

/**
 * The two app-level keys (app-shortcuts.ts): '/' focuses the page's search,
 * '?' opens Sneltoetsen. Never while typing, behind an open sheet or menu,
 * with a modifier, or in Kosten & bank and Documenten & media (their own
 * handlers own these keys). The App shell installs it after the first
 * screen (a lazy chunk, with the shortcut tables and the sheet).
 */
@Injectable({ providedIn: 'root' })
export class AppShortcutKeys {
  private readonly document = inject(DOCUMENT);

  install(options: { url: () => string; active: () => boolean; openHelp: () => void }): () => void {
    const onKeydown = (event: KeyboardEvent) => {
      if (!options.active()) return;
      const context = keyContext(event, null, this.document);
      const command = shortcutCommand({
        key: event.key, metaKey: event.metaKey, ctrlKey: event.ctrlKey, altKey: event.altKey,
        typing: context.typing, overlay: context.overlayOpen, defaultPrevented: event.defaultPrevented,
      }, options.url());
      if (command === 'help') {
        event.preventDefault();
        options.openHelp();
      } else if (command === 'search') {
        const field = Array.from(this.document.querySelectorAll<HTMLInputElement>(`.main :is(${PAGE_SEARCH_SELECTOR})`))
          .find((element) => element.getClientRects().length > 0 && !element.disabled);
        if (!field) return;
        event.preventDefault();
        field.focus();
        field.select?.();
      }
    };
    this.document.addEventListener('keydown', onKeydown);
    return () => this.document.removeEventListener('keydown', onKeydown);
  }
}
