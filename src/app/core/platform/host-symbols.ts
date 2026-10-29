import { cleanLabel } from './host';

/**
 * The native host's SF Symbols (enrosed-erp-ios Symbols.swift): the icon
 * table and the action words, with the workspace a URL belongs to. Pure;
 * imported only by the lazy half of the bridge (host-bridge-impl.ts) and the
 * workspace tab bars, so the tables stay out of the PWA's initial bundle.
 */

/* ------------------------------------------------------------------ icons */

/** icon.ts name → SF Symbol, one to one with Symbols.swift; unknown names fall back to `circle.dashed` on the native side. */
export const HOST_SYMBOLS: Readonly<Record<string, string>> = {
  home: 'house', sales: 'doc.text', purchase: 'shippingbox', products: 'camera.macro', more: 'ellipsis', stock: 'cube.box',
  exchange: 'arrow.left.arrow.right', media: 'photo.on.rectangle', analytics: 'chart.bar', customs: 'checkmark.seal',
  countries: 'globe.europe.africa', receipt: 'receipt', bank: 'building.columns', activity: 'clock.arrow.circlepath',
  customers: 'person.2', suppliers: 'truck.box', truck: 'truck.box', tag: 'tag', search: 'magnifyingglass', info: 'info.circle',
  tick: 'checkmark.circle', list: 'list.bullet', folder: 'folder', barcode: 'barcode', grid: 'square.grid.2x2',
  download: 'square.and.arrow.down', pdf: 'doc.richtext', document: 'doc', book: 'book', trash: 'trash',
  layers: 'square.stack.3d.up', globe: 'globe', plus: 'plus', refresh: 'arrow.clockwise', camera: 'camera',
  calendar: 'calendar', check: 'checkmark', filter: 'line.3.horizontal.decrease', recent: 'clock', archive: 'archivebox',
  restore: 'arrow.uturn.backward', share: 'square.and.arrow.up', upload: 'arrow.up.circle', image: 'photo', eye: 'eye',
  pencil: 'pencil', chevron: 'chevron.right', 'chevron-left': 'chevron.left', 'chevron-right': 'chevron.right',
  'chevron-up': 'chevron.up', 'chevron-down': 'chevron.down', external: 'arrow.up.right.square',
  expand: 'arrow.up.left.and.arrow.down.right', order: 'arrow.up.arrow.down', copy: 'doc.on.doc', close: 'xmark',
  move: 'arrowshape.turn.up.right', link: 'link', unlink: 'minus.circle', alert: 'exclamationmark.triangle',
  auto: 'wand.and.stars', 'arrow-in': 'arrow.down.left', 'arrow-out': 'arrow.up.right', clip: 'paperclip', repeat: 'repeat',
  grip: 'line.3.horizontal', settings: 'gearshape', bell: 'bell',
};

/** Action words → SF Symbol, for items that are words in the web (Bewerken, Bestellen, Opslaan…). */
export const ACTION_SYMBOLS: Readonly<Record<string, string>> = {
  bewerken: 'pencil', beheren: 'slider.horizontal.3', opslaan: 'checkmark', aanmaken: 'plus', versturen: 'paperplane',
  verstuur: 'paperplane', 'ter goedkeuring': 'paperplane', 'versturen ter goedkeuring': 'paperplane', 'opnieuw versturen': 'paperplane',
  'factuur maken': 'doc.badge.plus', 'in verwerking nemen': 'tray.and.arrow.down', heropenen: 'arrow.uturn.backward',
  heropen: 'arrow.uturn.backward', uitreiken: 'checkmark.seal', bestellen: 'cart', 'container vertrokken': 'ferry',
  'container ontvangen': 'shippingbox.and.arrow.backward', 'voorraad bijboeken': 'plus.square.on.square',
  'kostprijzen toepassen': 'eurosign.circle', 'kostprijzen opnieuw toepassen': 'eurosign.circle', 'opnieuw toepassen': 'eurosign.circle',
  annuleren: 'xmark.circle', 'order splitsen': 'scissors', 'nummer wijzigen': 'pencil.line', voorbeeld: 'eye', selecteer: 'checklist',
  klaar: 'checkmark', volgorde: 'arrow.up.arrow.down', toevoegen: 'plus', 'terug naar': 'chevron.backward', 'website bekijken': 'safari',
  pdf: 'doc.richtext', 'pdf bekijken': 'doc.richtext', 'pdf downloaden': 'doc.richtext', vernieuwen: 'arrow.clockwise',
  meldingen: 'bell', meer: 'ellipsis', 'meer acties': 'ellipsis', acties: 'ellipsis', nieuw: 'plus', 'nieuwe kopie': 'doc.on.doc',
  'wijziging beoordelen': 'exclamationmark.bubble', 'producten toevoegen': 'plus', alles: 'checkmark.circle', geen: 'circle',
  'voorschotten beheren': 'eurosign.circle', 'container kiezen': 'shippingbox', 'open punten': 'exclamationmark.circle',
  'open punt': 'exclamationmark.circle', verwijderen: 'trash', 'calculatie verwijderen': 'trash', 'status terugzetten': 'arrow.uturn.backward',
};

/** The SF Symbol for an action's word, or undefined when the word is unknown. */
export function symbolForLabel(label: string | null | undefined): string | undefined {
  const text = cleanLabel(label).replace(/\?\s*$/, '').toLocaleLowerCase('nl');
  if (!text) return undefined;
  if (ACTION_SYMBOLS[text]) return ACTION_SYMBOLS[text];
  const prefix = Object.keys(ACTION_SYMBOLS).filter((key) => text.startsWith(key + ' ')).sort((a, b) => b.length - a.length)[0];
  if (prefix) return ACTION_SYMBOLS[prefix];
  /* "3 open punten" → open punten. */
  const words = text.replace(/^\d+\s+/, '');
  return ACTION_SYMBOLS[words] ?? ACTION_SYMBOLS[words.split(' ')[0]];
}

/** The symbol of an action: its own, else its icon's, else its label's. */
export function resolveSymbol(action: { symbol?: string; icon?: string; label: string }): string | undefined {
  return action.symbol ?? (action.icon ? HOST_SYMBOLS[action.icon] : undefined) ?? symbolForLabel(action.label);
}

/** The workspace a URL belongs to, for the tab-bar kind. */
export function workspaceOf(url: string): 'costs' | 'files' | 'website' | null {
  const path = url.split(/[?#]/)[0];
  if (path === '/costs' || path.startsWith('/costs/')) return 'costs';
  if (path === '/files' || path.startsWith('/files/')) return 'files';
  if (path === '/website' || path.startsWith('/website/')) return 'website';
  return null;
}
