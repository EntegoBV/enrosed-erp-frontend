import { PAGE_SEARCH_SELECTOR, shortcutCommand } from './app-shortcuts';
import { keyContext } from '../../shared/key-context';

/**
 * The two app-level keys (app-shortcuts.ts): '/' focuses the page's search,
 * '?' opens Sneltoetsen. Never while typing, behind an open sheet or menu,
 * with a modifier, or in Kosten & bank and Documenten & media (their own
 * handlers own these keys). The App shell installs it from a lazy chunk
 * (with the shortcut tables and the sheet); the returned function removes
 * the listener.
 */
export function installShortcutKeys(
  document: Document,
  options: { url: () => string; active: () => boolean; openHelp: () => void },
): () => void {
  const onKeydown = (event: KeyboardEvent) => {
    if (!options.active()) return;
    const context = keyContext(event, null, document);
    const command = shortcutCommand({
      key: event.key, metaKey: event.metaKey, ctrlKey: event.ctrlKey, altKey: event.altKey,
      typing: context.typing, overlay: context.overlayOpen, defaultPrevented: event.defaultPrevented,
    }, options.url());
    if (command === 'help') {
      event.preventDefault();
      options.openHelp();
    } else if (command === 'search') {
      const field = Array.from(document.querySelectorAll<HTMLInputElement>(`.main :is(${PAGE_SEARCH_SELECTOR})`))
        .find((element) => element.getClientRects().length > 0 && !element.disabled);
      if (!field) return;
      event.preventDefault();
      field.focus();
      field.select?.();
    }
  };
  document.addEventListener('keydown', onKeydown);
  return () => document.removeEventListener('keydown', onKeydown);
}
