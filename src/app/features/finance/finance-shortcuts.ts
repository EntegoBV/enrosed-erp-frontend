/*
 * The keyboard of the Kosten & bank desk. A key only counts inside the
 * workspace, never while typing and never behind an open sheet or menu;
 * besides Shift only ⌘/Ctrl+A is allowed. Every command also has a mouse
 * route. Pure: node-tested.
 */

export type FinanceCommand = 'search' | 'new-cost' | 'new-movement' | 'up' | 'down' | 'extend-up' | 'extend-down'
  | 'toggle' | 'select-all' | 'open' | 'edit' | 'pay' | 'link' | 'delete' | 'escape' | 'refresh' | 'help';

export type FinanceShortcut = FinanceCommand | { section: 1 | 2 | 3 | 4 | 5 | 6 } | null;

export interface ShortcutKey {
  key: string;
  code: string;
  shift: boolean;
  meta: boolean;
  ctrl: boolean;
  alt: boolean;
}

export interface ShortcutContext {
  typing: boolean;
  overlayOpen: boolean;
  inWorkspace: boolean;
}

export function financeShortcut(press: ShortcutKey, context: ShortcutContext): FinanceShortcut {
  if (context.typing || context.overlayOpen || !context.inWorkspace || press.alt) return null;
  const key = press.key.length === 1 ? press.key.toLowerCase() : press.key;
  if (press.meta || press.ctrl) return key === 'a' && !press.shift ? 'select-all' : null;
  const digit = /^Digit([1-6])$/.exec(press.code);
  if (digit && !press.shift) return { section: Number(digit[1]) as 1 | 2 | 3 | 4 | 5 | 6 };
  switch (key) {
    /* By the character, not the key: on a Belgian AZERTY keyboard '/' is Shift+':'. */
    case '/': return 'search';
    case '?': return 'help';
    case 'n': return 'new-cost';
    case 'b': return 'new-movement';
    case 'ArrowUp': case 'k': return press.shift ? 'extend-up' : 'up';
    case 'ArrowDown': case 'j': return press.shift ? 'extend-down' : 'down';
    case ' ': return 'toggle';
    case 'Enter': return 'open';
    case 'e': return 'edit';
    case 'p': return 'pay';
    case 'l': return 'link';
    case 'Delete': case 'Backspace': return 'delete';
    case 'Escape': return 'escape';
    case 'r': return 'refresh';
    default: return null;
  }
}

/** The Sneltoetsen sheet. */
export const FINANCE_SHORTCUT_HELP: readonly { keys: readonly string[]; label: string }[] = [
  { keys: ['1–6'], label: 'Onderdelen' },
  { keys: ['/'], label: 'Zoeken' },
  { keys: ['N'], label: 'Kost boeken' },
  { keys: ['B'], label: 'Bankbeweging noteren' },
  { keys: ['↑', '↓'], label: 'Vorige / volgende' },
  { keys: ['Shift', '↑↓'], label: 'Selectie uitbreiden' },
  { keys: ['Spatie'], label: 'Selecteren' },
  { keys: ['⌘/Ctrl', 'A'], label: 'Alles selecteren' },
  { keys: ['Enter'], label: 'Openen' },
  { keys: ['E'], label: 'Bewerken' },
  { keys: ['P'], label: 'Betaald zetten' },
  { keys: ['L'], label: 'Koppelen' },
  { keys: ['Delete'], label: 'Verwijderen' },
  { keys: ['Esc'], label: 'Sluiten' },
  { keys: ['R'], label: 'Vernieuwen' },
  { keys: ['?'], label: 'Deze lijst' },
];
