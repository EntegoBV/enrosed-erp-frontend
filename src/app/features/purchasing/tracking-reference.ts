import type { TrackingRecognised } from '../../core/api/container-tracking-models';

/*
 * What the one "Track & trace" field holds, by one written rule. The backend holds the same rule in
 * ContainerTracking.recognise (Java, docs/integrations/container-tracking.md "What the field reads"):
 * change both or neither. It never guesses: a bare number is only read as an Evergreen bill.
 * Only erasable TypeScript here (no enum, no parameter properties), so a plain Node can load the file.
 */

/* Normalised text: a plain space is the only whitespace, zero-width characters are gone. */
const SPACE = /[\t\n\x0B\f\r\x1C-\x1F \x85\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]/g;
const UNSEEN = /[\u200B\uFEFF]/g;
const EDGE_SPACES = /^ +| +$/g;
/** ISO 6346 prints the check digit apart ("TCNU 123456 5"); that form is a container number too. */
const BOX = /(?<![A-Z0-9])([A-Z]{4})[ -]?([0-9]{6})[ -]?([0-9])(?![A-Z0-9])/g;
const BILL = /(?<![A-Z0-9])EGLV *([0-9]{12})(?![A-Z0-9])/g;
const LEADING_BILL = /^EGLV *([0-9]{12})(?![A-Z0-9])/;
const LOOSE = /^(B\/L|BL|BOOKING|BOEKING)( *: *| +)/;
const NUMBER = /^[A-Z0-9/-]{6,60}$/;
const LINK = /^HTTPS?:\/\/[^ ]+$/;
/* The date lookup's own reading (BexyClient.query), on the text as typed. */
const LOOKUP_BILL = /(?<![A-Z0-9])EGLV[ \t\n\x0B\f\r]*([0-9]{12})(?![A-Z0-9])/g;
const LOOKUP_BOX = /(?<![A-Z0-9])([A-Z]{4})[ -]?([0-9]{7})(?![A-Z0-9])/g;
/* The parser of 2026-10-26 (ContainerTracking.strictReference), which the tracker asks first. Java's strip() trims
   Character.isWhitespace, which leaves the non-breaking spaces (U+00A0, U+2007, U+202F) in place. */
const JAVA_EDGE = /^[\t\n\x0B\f\r\x1C-\x1F \u1680\u2000-\u2006\u2008-\u200A\u2028\u2029\u205F\u3000]+|[\t\n\x0B\f\r\x1C-\x1F \u1680\u2000-\u2006\u2008-\u200A\u2028\u2029\u205F\u3000]+$/g;
const STRICT_NUMBER = /^[A-Z0-9/-]{6,60}$/;

const distinct = (list: string[]): string[] => [...new Set(list)];
const trim = (text: string): string => text.replace(EDGE_SPACES, '');
const hasDigit = (text: string): boolean => /[0-9]/.test(text);
const boxes = (text: string): string[] => distinct([...text.matchAll(BOX)].map((match) => match[1] + match[2] + match[3]));
const result = (kind: TrackingRecognised['kind'], evergreenBl: string | null, number: string | null = null,
    checkDigitOk: boolean | null = null, container: string | null = null): TrackingRecognised =>
  ({ kind, number, checkDigitOk, container, evergreenBl });

/** Pasted text brings non-breaking and zero-width characters. */
export function normaliseTrackingReference(raw: string | null | undefined): string {
  return trim((raw ?? '').replace(SPACE, ' ').replace(UNSEEN, ''));
}

/** ISO 6346: owner code, category U, J or Z, six digits and a check digit that fits. */
export function validContainerNumber(number: string): boolean {
  if (!/^[A-Z]{3}[UJZ][0-9]{7}$/.test(number)) return false;
  let sum = 0;
  for (let index = 0; index < 10; index++) {
    const char = number[index];
    const letter = char.charCodeAt(0) - 65;
    sum += (/[0-9]/.test(char) ? Number(char) : 10 + letter + Math.floor((letter + 9) / 10)) * 2 ** index;
  }
  return (sum % 11) % 10 === Number(number[10]);
}

/** One Evergreen bill, every container number valid, at most one container. */
function lookupBill(raw: string): string | null {
  if (raw.length > 500) return null;
  const value = raw.toUpperCase();
  const bills = distinct([...value.matchAll(LOOKUP_BILL)].map((match) => 'EGLV' + match[1]));
  if (bills.length !== 1) return null;
  const found = [...value.matchAll(LOOKUP_BOX)].map((match) => match[1] + match[2]);
  return found.some((number) => !validContainerNumber(number)) || new Set(found).size > 1 ? null : bills[0];
}

/** The number behind a prefix and what follows it; null when there is none. */
function typedNumber(rest: string, needsDigit: boolean): [string, string] | null {
  if (NUMBER.test(rest) && (!needsDigit || hasDigit(rest))) return [rest, ''];
  const bill = LEADING_BILL.exec(rest);
  if (bill) return ['EGLV' + bill[1], rest.slice(bill[0].length)];
  const cut = rest.indexOf(' ');
  const first = cut < 0 ? rest : rest.slice(0, cut);
  return NUMBER.test(first) && hasDigit(first) ? [first, cut < 0 ? '' : rest.slice(cut)] : null;
}

/** What the parser of 2026-10-26 follows, or null when it does not take the text. */
function strictReading(raw: string): { kind: 'CONTAINER' | 'BL' | 'BOOKING'; number: string } | null {
  if (raw.length > 500) return null;
  const value = raw.replace(JAVA_EDGE, '').toUpperCase();
  if (!value) return null;
  if (value.startsWith('BL:') || value.startsWith('BOOKING:')) {
    const number = value.slice(value.indexOf(':') + 1).replace(JAVA_EDGE, '');
    return STRICT_NUMBER.test(number) ? { kind: value.startsWith('BL:') ? 'BL' : 'BOOKING', number } : null;
  }
  const found = [...value.matchAll(LOOKUP_BOX)].map((match) => match[1] + match[2]);
  return found.length && new Set(found).size === 1 ? { kind: 'CONTAINER', number: found[0] } : null;
}

/**
 * What the field holds. A text the parser of 2026-10-26 takes reads as what that parser follows (the tracker asks
 * it first), so the line names the number that is followed; other texts are read by the rule of 2026-11-10.
 */
export function recogniseTrackingReference(raw: string | null | undefined): TrackingRecognised {
  const wide = widerReading(raw);
  const strict = raw ? strictReading(raw) : null;
  if (!strict || (strict.kind === wide.kind && strict.number === wide.number)) return wide;
  return result(strict.kind, wide.evergreenBl, strict.number, strict.kind === 'CONTAINER' ? validContainerNumber(strict.number) : null);
}

function widerReading(raw: string | null | undefined): TrackingRecognised {
  const text = normaliseTrackingReference(raw);
  if (!raw || !text) return result('EMPTY', null);
  if (raw.length > 500) return result('UNKNOWN', null);
  const value = text.toUpperCase();
  const evergreen = lookupBill(raw);
  const booking = value.startsWith('BOOKING:');
  if (booking || value.startsWith('BL:')) {
    const typed = typedNumber(trim(value.slice(value.indexOf(':') + 1)), false);
    /* An Evergreen bill somewhere behind the prefix is still looked up for dates: say so. */
    const found = boxes(typed ? typed[1] : value);
    if (!typed && !evergreen) return result('UNKNOWN', null);
    if (found.length > 1) return result('MULTIPLE', evergreen);
    const box = found[0] ?? null;
    return result(typed && booking ? 'BOOKING' : 'BL', evergreen, typed ? typed[0] : evergreen, box ? validContainerNumber(box) : null, box);
  }
  const found = boxes(value);
  if (found.length === 1) return result('CONTAINER', evergreen, found[0], validContainerNumber(found[0]));
  if (found.length > 1) return result('MULTIPLE', evergreen);
  const loose = LOOSE.exec(value);
  if (loose) {
    const typed = typedNumber(value.slice(loose[0].length), true);
    /* Without a colon the word must look like a carrier's number: "BL 10/11/2026" is a date, not a bill. */
    const named = loose[2].includes(':');
    if (typed && (named || (typed[0].length >= 8 && /[A-Z]/.test(typed[0]))))
      return result(loose[1].startsWith('BO') ? 'BOOKING' : 'BL', evergreen, typed[0]);
  }
  const bills = distinct([...value.matchAll(BILL)].map((match) => 'EGLV' + match[1]));
  if (bills.length === 1) return result('BL', evergreen, bills[0]);
  return result(LINK.test(value) ? 'LINK' : 'UNKNOWN', evergreen);
}

export interface TrackingReferenceHint { text: string; warn: boolean }

/** The line under the field: what was read, or how to write it. null for an empty field. */
export function trackingReferenceHint(raw: string | null | undefined, recognised?: TrackingRecognised | null): TrackingReferenceHint | null {
  const seen = recognised ?? recogniseTrackingReference(raw);
  const dates = seen.evergreenBl ? ' · datums via Evergreen' : '';
  const box = seen.container ? ` · container ${seen.container}${seen.checkDigitOk === false ? ': controleer het nummer' : ''}` : '';
  switch (seen.kind) {
    case 'EMPTY': return null;
    case 'CONTAINER': return seen.checkDigitOk === false
      ? { text: `Container ${seen.number}: controleer het nummer`, warn: true }
      : { text: `Container ${seen.number}${seen.evergreenBl ? ` · B/L ${seen.evergreenBl}` : ''}${dates}`, warn: false };
    case 'BL': return { text: `B/L ${seen.number}${box}${dates}`, warn: seen.checkDigitOk === false };
    case 'BOOKING': return { text: `Boeking ${seen.number}${box}${dates}`, warn: seen.checkDigitOk === false };
    case 'MULTIPLE': return { text: 'Meerdere containernummers. Vul er één in.', warn: true };
    case 'LINK': return { text: 'Link bewaard · geen nummer om te volgen', warn: false };
    default: return { text: 'Niet herkend. Typ een containernummer of BL: + nummer.', warn: true };
  }
}

/** One unrecognised number-like word can be a B/L: the text with "BL: " in front, for the person to confirm. */
export function trackingReferenceAsBill(raw: string | null | undefined): string | null {
  const text = normaliseTrackingReference(raw);
  if (!text || text.includes(' ') || recogniseTrackingReference(raw).kind !== 'UNKNOWN') return null;
  const upper = text.toUpperCase();
  return NUMBER.test(upper) && hasDigit(upper) ? `BL: ${text}` : null;
}

/**
 * What the B/L field holds as a reference of its own. One number, also typed in groups ("oneynb 1234567890",
 * "EGLV 1435 1234 5678"), gets "BL: " in front: bare, it read as an unrecognised reference. A text that says what
 * it is, or already reads as a container or an Evergreen bill, stays as typed; in other text a first word that is a
 * number is the B/L ("BL: ONEYNB1234567890 telex release"). Words are never glued into one number.
 */
function billReference(bill: string): string | null {
  const number = normaliseTrackingReference(bill);
  if (!number) return null;
  const upper = number.toUpperCase();
  if (LOOSE.test(upper)) return number;
  const words = upper.split(' ');
  const glued = words.join('');
  const seen = recogniseTrackingReference(number);
  const grouped = words.length === 1 || (words.slice(1).every((word) => /^[0-9]+$/.test(word))
    && (seen.kind === 'UNKNOWN' || (seen.kind === 'BL' && seen.number === glued)));
  if (grouped) return NUMBER.test(glued) && hasDigit(glued) ? `BL: ${glued}` : number;
  if (seen.kind !== 'UNKNOWN') return number;
  return NUMBER.test(words[0]) && hasDigit(words[0]) ? `BL: ${number}` : number;
}

/** The text holds this number as a word of its own. */
function holds(text: string, number: string): boolean {
  const value = normaliseTrackingReference(text).toUpperCase();
  return value.replace(/ /g, '') === number || new RegExp(`(?<![A-Z0-9])${number.replace(/[/-]/g, '\\$&')}(?![A-Z0-9])`).test(value);
}

/**
 * What the "Container vertrokken" prompt saves as track & trace, from its two fields.
 * The B/L field alone: its own reference (billReference). With the Track & trace field filled, its text stays and
 * the B/L is added: an Evergreen bill behind it as it is (that brings the dates), another B/L as "BL: number"
 * behind it. A text that is not recognised gets the B/L in front, so the B/L is what is followed (the same number
 * typed twice is saved once). Nothing is added behind a link, when a ship is linked to the text, or when the text
 * would stop reading as the same number.
 */
export function stepTrackingReference(tracking: string, bill: string, shipLinked = false): string | null {
  const text = tracking.trim();
  const typed = billReference(bill);
  if (!typed) return text || null;
  if (!text) return typed;
  const before = recogniseTrackingReference(text);
  if (shipLinked || before.kind === 'LINK' || /^https?:\/\//i.test(text)) return text;
  const seen = recogniseTrackingReference(typed);
  const evergreen = seen.evergreenBl;
  const number = evergreen ?? (seen.kind === 'BL' ? seen.number : null);
  if (!number || (evergreen && before.evergreenBl)) return text;
  const unknown = (before.kind === 'UNKNOWN' || before.kind === 'EMPTY') && !before.evergreenBl;
  const held = holds(text, number);
  if (held && !unknown) return text;
  /* The same number typed in both fields: saved once, as the B/L field reads it. */
  if (held && normaliseTrackingReference(text).toUpperCase().replace(/ /g, '') === number) return typed;
  const both = evergreen ? `${text} ${evergreen}` : unknown ? (held ? `BL: ${text}` : `${typed} ${text}`) : `${text} BL: ${number}`;
  if (both.length > 500) return text;
  const after = recogniseTrackingReference(both);
  const same = unknown ? after.kind === 'BL' && (after.number === number || after.evergreenBl === number)
    : after.kind === before.kind && after.number === before.number && after.evergreenBl === (evergreen ?? before.evergreenBl);
  return same ? both : text;
}
