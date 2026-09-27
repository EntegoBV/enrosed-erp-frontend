/**
 * The desk keyboard of Documenten & media as a table: a key press (already
 * reduced to plain facts) in, one command out. Only keys that do not fight
 * the browser are bound: no ⌘F, ⌘1/⌘2, ⌘⇧N or history keys. Nothing fires
 * while typing or behind an open sheet, menu or Quick Look. Pure and
 * import-free: node-tested.
 */

export type FilesCommand =
  | { type: 'move'; direction: 'up' | 'down' | 'left' | 'right'; extend: boolean }
  | { type: 'quick-look' | 'open' | 'parent' | 'rename' | 'select-all' | 'archive' | 'delete'
      | 'search' | 'inspector' | 'shortcuts' | 'escape' };

export interface FilesKeyPress {
  key: string;
  /** ⌘ on a Mac, Ctrl elsewhere. */
  mod: boolean;
  shift: boolean;
  alt: boolean;
  /** Focus is in a text field. */
  targetIsField: boolean;
  /** A sheet, menu or Quick Look is open. */
  overlayOpen: boolean;
  /** Archief turns Delete into "definitief verwijderen". */
  place: 'folders' | 'recent' | 'view' | 'archive';
  layout: 'list' | 'grid';
}

export function filesCommand(press: FilesKeyPress): FilesCommand | null {
  if (press.overlayOpen || press.targetIsField || press.alt) return null;
  const { key, mod, shift } = press;
  switch (key) {
    case 'Escape': return mod ? null : { type: 'escape' };
    case ' ':
    case 'Spacebar': return mod ? null : { type: 'quick-look' };
    case 'Enter': return mod || shift ? null : { type: 'open' };
    case 'ArrowDown': return mod ? (shift ? null : { type: 'open' }) : { type: 'move', direction: 'down', extend: shift };
    case 'ArrowUp': return mod ? (shift ? null : { type: 'parent' }) : { type: 'move', direction: 'up', extend: shift };
    case 'ArrowLeft':
    case 'ArrowRight':
      if (mod || press.layout !== 'grid') return null;
      return { type: 'move', direction: key === 'ArrowLeft' ? 'left' : 'right', extend: shift };
    case 'F2': return mod ? null : { type: 'rename' };
    case 'Delete':
    case 'Backspace': return shift ? null : { type: press.place === 'archive' ? 'delete' : 'archive' };
    case '/': return mod ? null : { type: 'search' };
    case '?': return mod ? null : { type: 'shortcuts' };
  }
  if (mod && !shift && (key === 'a' || key === 'A')) return { type: 'select-all' };
  if (mod && !shift && (key === 'i' || key === 'I')) return { type: 'inspector' };
  return null;
}

/** The Sneltoetsen sheet: what the table above binds, in words. */
export const FILES_SHORTCUTS: readonly { keys: string; label: string }[] = [
  { keys: '↑ ↓', label: 'Vorige of volgende; met ⇧ de selectie uitbreiden' },
  { keys: '← →', label: 'In het raster: opzij' },
  { keys: '␣', label: 'Snel bekijken' },
  { keys: '↵ of ⌘↓', label: 'Map openen of bestand bekijken' },
  { keys: '⌘↑', label: 'Naar de bovenliggende map' },
  { keys: '⌘A', label: 'Alle geladen bestanden selecteren' },
  { keys: 'F2', label: 'Hernoemen' },
  { keys: '⌫', label: 'Archiveren; in Archief definitief verwijderen' },
  { keys: '/', label: 'Zoeken' },
  { keys: '⌘I', label: 'Info tonen of verbergen' },
  { keys: 'esc', label: 'Selectie wissen, info sluiten, zoekopdracht wissen' },
  { keys: '⌘V', label: 'Bestanden van het klembord toevoegen' },
  { keys: '?', label: 'Deze sneltoetsen' },
];
