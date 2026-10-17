/*
 * The words a bank line shows on a row: a short title (the merchant or the
 * counterparty) and a clean sub (the useful part of the reference). Odoo
 * hands over the bank's raw text: card payments carry the masked card
 * number and the holder's name, transfers repeat the counterparty, the
 * IBAN, the BIC and the clock. The raw reference stays in the detail; this
 * is only what a row reads. Pure and node-tested: no imports.
 */

export interface BankText { title: string; sub: string }

const MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
/** A postal token in a card line: 'BE3500', 'NL6711AW', 'LUL2540'. */
const POSTAL = /^(?:[A-Z]{2,3})?\d{4}[A-Z]{0,2}$/;
/** 'Betaling met Apple Pay via Debit Mastercard 06-10-2026 om 15.43 uur' (the wallet part is optional). */
const CARD = /\bBetaling(?: met (.+?))? via (.+?) (\d{2})-(\d{2})-(\d{4})(?: om (\d{2})\.(\d{2}) uur)?/i;
/** Processor prefixes in front of a merchant: 'CCV*Koka House', 'SUMUP *Bakkerij'. */
const PROCESSOR = /^(?:CCV\s*\*|SUMUP\s*\*|SQ\s*\*|ZETTLE_\*?|PAYPAL\s*\*|MOLLIE\s*\*)\s*/i;
const TRANSFER_WORDS = /\b(?:Europese overschrijving|Instantoverschrijving|Overschrijving|Domicili[eë]ring)\b/gi;
const BIC = /\bBIC:?\s*[A-Z0-9]{8,11}\b/gi;
/**
 * An IBAN as banks print it, grouped by four ('NL16 RABO 0326 5687 94') or in one piece: the first group may hold the
 * bank's letters, the later ones are digits, so a word after the IBAN ('PI 20260907') is never taken along.
 */
const IBAN = /\b[A-Z]{2}\d{2} ?[A-Z0-9]{4}(?: ?\d{4}){1,6}(?: ?\d{1,3})?\b/g;
const IBAN_START = /\b[A-Z]{2}\d{2} ?[A-Z0-9]{4}(?: ?\d{4}){1,6}/;
const CLOCK = /\b\d{2}\.\d{2} uur\b/gi;
const CHANNEL = /\bKBC (?:Mobile|Touch)\b/gi;

const squash = (text: string): string => text.replace(/\s+/g, ' ').trim();
/** Stray separators left at either end after the cuts. */
const tidy = (text: string): string => squash(text).replace(/^[\s·,;:/-]+|[\s·,;:/-]+$/g, '').trim();
const titleCase = (word: string): string => (word ? word.charAt(0).toLocaleUpperCase('nl-BE') + word.slice(1).toLocaleLowerCase('nl-BE') : '');
const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const same = (left: string, right: string): boolean => left.toLocaleLowerCase('nl-BE').replace(/[^a-z0-9]/g, '') === right.toLocaleLowerCase('nl-BE').replace(/[^a-z0-9]/g, '');

/** Odoo splits 'GmbH' into 'Gmb H'; put it back. */
function repairedParty(party: string): string {
  return squash(party).replace(/\bGmb H\b/g, 'GmbH');
}

/** A card payment: the merchant as the title, wallet · day time · town as the sub. */
function cardText(reference: string): BankText | null {
  const card = CARD.exec(reference);
  if (!card) return null;
  let before = reference.slice(0, card.index).trim();
  const correction = /^Correctie\b\s*/i.test(before);
  if (correction) before = before.replace(/^Correctie\b\s*/i, '');
  const tokens = before.split(' ').filter(Boolean);
  const postal = tokens.findIndex((token, index) => index > 0 && POSTAL.test(token));
  let merchant = (postal > 0 ? tokens.slice(0, postal) : tokens).join(' ');
  const town = postal > 0 && tokens[postal + 1] ? titleCase(tokens[postal + 1]) : '';
  merchant = merchant.replace(PROCESSOR, '').replace(/\s+\*\s+.*$/, '').trim();
  const [, wallet, cardName, day, month, , hours, minutes] = card;
  const when = `${Number(day)} ${MONTHS[Number(month) - 1] ?? month}${hours && !(hours === '00' && minutes === '00') ? ` ${hours}.${minutes}` : ''}`;
  const sub = [correction ? 'Correctie' : '', squash(wallet || cardName || ''), when, town].filter(Boolean).join(' · ');
  return { title: merchant || 'Kaartbetaling', sub };
}

/** A transfer or anything else: the counterparty as the title, the reference without the bank's furniture as the sub. */
function otherText(counterparty: string, reference: string): BankText {
  const party = repairedParty(counterparty);
  let rest = reference;
  for (const name of [counterparty, party].filter(Boolean)) {
    const words = squash(name).split(' ').map(escape);
    const leading = new RegExp(`^${words.join('\\s*')}(?![A-Za-z0-9])`, 'i');
    rest = rest.replace(leading, '').trim();
  }
  const cleaned = tidy(rest.replace(TRANSFER_WORDS, ' ').replace(BIC, ' ').replace(IBAN, ' ').replace(CLOCK, ' ').replace(CHANNEL, ' '));
  if (party) return { title: party, sub: same(cleaned, party) ? '' : cleaned };
  /* No counterparty: the reference up to the first IBAN or "Betaling" names the line. */
  const cut = Math.min(...[reference.search(IBAN_START), reference.search(/\bBetaling\b/i)].filter((index) => index > 0), reference.length);
  const head = tidy(reference.slice(0, cut).replace(TRANSFER_WORDS, ' '));
  if (!head) return { title: 'Banktransactie', sub: cleaned };
  const sub = tidy(cleaned.startsWith(head) ? cleaned.slice(head.length) : cleaned);
  return { title: head, sub: same(sub, head) ? '' : sub };
}

export function bankTextOf(line: { counterparty?: string | null; reference?: string | null }): BankText {
  const counterparty = squash(line.counterparty ?? '');
  const reference = squash(line.reference ?? '');
  if (!counterparty && !reference) return { title: 'Banktransactie', sub: '' };
  const card = reference ? cardText(reference) : null;
  if (card) return card.sub && same(card.sub, card.title) ? { ...card, sub: '' } : card;
  return otherText(counterparty, reference);
}
