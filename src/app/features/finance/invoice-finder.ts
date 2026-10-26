import type { InvoiceFile, InvoiceLink, InvoiceRow, InvoiceScope } from '../../core/api/invoice-finder-api';
import type { ReceivedOdooInvoicePreview } from '../../core/api/banking-api';

/*
 * Facturen (invoice finder): the words, chips, actions and file names of one
 * finder row. Pure, with type imports only: the node tests run it on its own.
 * The server sorts and filters; this file only says how a row reads.
 */

export type FinderOnly = '' | 'containers' | 'costs' | 'odoo-new' | 'no-file' | 'invoices' | 'credit-notes' | 'odoo';
export type InvoiceAction = 'open-purchase' | 'open-cost' | 'open-sales' | 'open-tica' | 'register' | 'handled'
  | 'container' | 'clear-mark' | 'download';
export type StatusTone = '' | 'ok' | 'warn' | 'amber' | 'accent' | 'grey' | 'plum';

const ONLY_IN: readonly { id: FinderOnly; label: string; scope: InvoiceScope }[] = [
  { id: '', label: 'Alles', scope: 'ALL' }, { id: 'containers', label: 'Containers', scope: 'CONTAINERS' },
  { id: 'costs', label: 'Kosten', scope: 'COSTS' }, { id: 'odoo-new', label: 'Nieuw in Odoo', scope: 'ODOO_NEW' },
  { id: 'no-file', label: 'Zonder bestand', scope: 'NO_FILE' },
];
const ONLY_OUT: readonly { id: FinderOnly; label: string; scope: InvoiceScope }[] = [
  { id: '', label: 'Alles', scope: 'ALL' }, { id: 'invoices', label: 'Facturen', scope: 'INVOICES' },
  { id: 'credit-notes', label: "Creditnota's", scope: 'CREDIT_NOTES' }, { id: 'odoo', label: 'Odoo', scope: 'ODOO' },
];

/** The chips of a direction, "Alles" first. */
export function onlyOptions(tab: 'in' | 'out'): { id: FinderOnly; label: string }[] {
  return (tab === 'out' ? ONLY_OUT : ONLY_IN).map(({ id, label }) => ({ id, label }));
}

/** The server scope of a chip; '' and anything unknown (or of the other direction) is ALL. */
export function scopeOf(tab: 'in' | 'out', only: string): InvoiceScope {
  return (tab === 'out' ? ONLY_OUT : ONLY_IN).find((option) => option.id === only)?.scope ?? 'ALL';
}

const KEY = /^(pi|pd|cost|odoo|so):[1-9]\d{0,17}$/;
/** A row key as the server accepts it (18 digits at most). */
export function rowKeyValid(key: string): boolean {
  return KEY.test(key);
}

const credit = (row: InvoiceRow): boolean => row.kind === 'CREDIT_NOTE';

/** The one-word status pill. */
export function statusWord(row: InvoiceRow): { label: string; tone: StatusTone } {
  switch (row.status) {
    case 'PAID':
      if (credit(row) && row.source === 'SALES') return { label: 'Verrekend', tone: 'ok' };
      if (credit(row) && row.source === 'COST') return { label: 'Terugbetaald', tone: 'ok' };
      return { label: 'Betaald', tone: 'ok' };
    case 'PARTIAL': return { label: credit(row) ? 'Deels verrekend' : 'Deels betaald', tone: '' };
    case 'OPEN': return { label: credit(row) && row.source === 'COST' ? 'Te ontvangen' : 'Open', tone: '' };
    case 'OVERDUE': return { label: 'Vervallen', tone: 'warn' };
    case 'SETTLED': return { label: 'Verrekend', tone: 'ok' };
    case 'NO_DATA': return { label: 'Zonder gegevens', tone: 'amber' };
    case 'NEW': return { label: 'Nieuw', tone: 'accent' };
    case 'HANDLED': return { label: row.statusReason === 'BEFORE_START' ? 'Ouder' : 'Afgehandeld', tone: 'grey' };
    case 'CONTAINER': return { label: 'Bij container', tone: 'grey' };
    case 'TICA': return { label: 'TICA', tone: 'plum' };
    case 'CANCELLED': return { label: 'Geannuleerd', tone: 'grey' };
    default: return { label: String(row.status ?? ''), tone: '' };
  }
}

/** Where the row comes from. */
export function bronWord(row: InvoiceRow): string {
  switch (row.origin) {
    case 'UPLOAD': return 'Opgeladen';
    case 'MANUAL': return 'Ingevoerd';
    case 'ODOO': return row.peppolState ? 'Odoo · Peppol' : 'Odoo';
    default: return row.peppolState ? 'ENROSED · Peppol' : 'ENROSED';
  }
}

/** What kind of document it is. */
export function soortWord(row: InvoiceRow): string {
  switch (row.source) {
    case 'CONTAINER_INVOICE': case 'CONTAINER_FILE': return row.docLabel?.trim() || 'Factuur';
    case 'COST': return credit(row) ? 'Creditnota' : 'Kost';
    case 'ODOO': return credit(row) ? 'Creditnota' : row.direction === 'OUT' ? 'Verkoopfactuur' : 'Factuur';
    default:
      if (credit(row)) return 'Creditnota';
      if (row.salesPurpose === 'PARTNER_ADVANCE') return 'Partnervoorschot';
      if (row.salesPurpose === 'PARTNER_SETTLEMENT') return 'Partnerafrekening';
      return 'Verkoopfactuur';
  }
}

/** The payee words of Inkoop, for a container invoice paid to someone other than the supplier. */
export const PAYEE_WORDS: Readonly<Record<string, string>> = {
  SUPPLIER: 'Leverancier', LOGISTICS: 'Douane & transport', SEPARATE: 'Inspectie & andere kosten', OTHER: 'Andere betaling',
};

const named = (row: InvoiceRow): string => row.party?.name?.trim() || (row.payee ? PAYEE_WORDS[row.payee] ?? '' : '');

/** Who sent it (Inkomend) or who got it (Uitgaand). */
export function partyName(row: InvoiceRow): string {
  return named(row) || 'Onbekend';
}

/** The number, else what it is (a file without data has none). */
export function numberText(row: InvoiceRow): string {
  return row.number?.trim() || soortWord(row);
}

/** "Changsha Pretty · CI-20260412". */
export function titleLine(row: InvoiceRow): string {
  return `${partyName(row)} · ${numberText(row)}`;
}

/** The container's name: alias, else number, else 'Inkoop #id'. */
export function containerLabel(c: { id: number; number: string | null; alias: string | null }): string {
  return c.alias?.trim() || c.number?.trim() || `Inkoop #${c.id}`;
}

/** A sales document's Peppol state in two words. */
export function peppolFact(row: InvoiceRow): string | null {
  if (!row.peppolState) return null;
  if (row.peppolState === 'done') return 'via Peppol';
  if (row.peppolState === 'error') return 'Peppol-fout';
  return 'Peppol bezig';
}

/** What Odoo adds to an Odoo row: the removed cost, the mark's note, a concept, or Odoo's own payment state. */
export function odooFact(row: InvoiceRow): string | null {
  if (row.source !== 'ODOO' || !row.odoo) return null;
  if (row.statusReason === 'COST_REMOVED') return 'kost verwijderd';
  const note = row.odoo.mark?.note?.trim();
  if (note) return note.length > 40 ? `${note.slice(0, 39).trimEnd()}…` : note;
  if (row.odoo.state === 'draft') return 'concept in Odoo';
  if (row.odoo.paymentState === 'paid' || row.odoo.paymentState === 'in_payment') return 'betaald in Odoo';
  if (row.odoo.paymentState === 'partial') return 'deels betaald in Odoo';
  return null;
}

/** Line 2 of a desk row: at most three short facts. */
export function deskFacts(row: InvoiceRow): string[] {
  let facts: (string | null)[];
  switch (row.source) {
    case 'COST': facts = [row.description?.trim() || row.category?.trim() || null, bronWord(row)]; break;
    case 'ODOO': facts = [soortWord(row), bronWord(row), odooFact(row)]; break;
    case 'SALES': facts = [soortWord(row), row.container ? containerLabel(row.container) : null, peppolFact(row)]; break;
    default: facts = [soortWord(row), bronWord(row)];
  }
  return facts.filter((fact): fact is string => !!fact).slice(0, 3);
}

const DAY_MONTH = new Intl.DateTimeFormat('nl-BE', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const MONTH_YEAR = new Intl.DateTimeFormat('nl-BE', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const asDate = (day: string): Date => new Date(`${day.slice(0, 10)}T12:00:00Z`);
const isDay = (day: string | null | undefined): day is string => !!day && /^\d{4}-\d{2}-\d{2}/.test(day);

/** '12 apr', '12 apr 2025' in another year than today. */
export function shortDay(day: string | null | undefined, today: string): string {
  if (!isDay(day)) return '—';
  const text = DAY_MONTH.format(asDate(day)).replace(/\./g, '');
  return day.slice(0, 4) === today.slice(0, 4) ? text : `${text} ${day.slice(0, 4)}`;
}

/** '12/04/26', the desk's Datum column. */
export function deskDate(day: string | null | undefined): string {
  return isDay(day) ? `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(2, 4)}` : '—';
}

/** '2/10/2026'. */
export function longDate(day: string | null | undefined): string {
  return isDay(day) ? `${Number(day.slice(8, 10))}/${Number(day.slice(5, 7))}/${day.slice(0, 4)}` : '—';
}

/** The Datum column's title: a file is dated by its upload, an invoice without a date by when it was entered. */
export function dateTitle(row: InvoiceRow): string | null {
  return row.dateKind === 'UPLOADED' ? 'opgeladen' : row.dateKind === 'RECORDED' ? 'ingevoerd' : null;
}

/** The phone sub line in two parts, so the status can take its own colour. */
export function phoneSubParts(row: InvoiceRow, today: string): { lead: string; status: string } {
  const lead = [shortDay(row.sortDate, today), row.container ? containerLabel(row.container) : soortWord(row)].join(' · ');
  return { lead, status: statusWord(row).label };
}

/** "12 apr · PO-2026-012 · Open" (by sortDate; the year only when it is not this year). */
export function phoneSub(row: InvoiceRow, today: string): string {
  const parts = phoneSubParts(row, today);
  return `${parts.lead} · ${parts.status}`;
}

const EUR = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' });
const PLAIN = new Intl.NumberFormat('nl-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const SYMBOLS: Readonly<Record<string, string>> = { USD: '$', CNY: '¥', GBP: '£' };

/** Euro text: '€ 1.250,00'. */
export function eurText(value: number): string {
  return EUR.format(Math.abs(value) < 0.005 ? 0 : value);
}

/** '€ 1.250,00', '− € 125,00' for a credit, '$ 840,00' in the invoice's own currency; '—' without an amount. */
export function amountText(row: InvoiceRow): string {
  if (row.amount === null || row.amount === undefined || !Number.isFinite(row.amount)) return '—';
  const currency = (row.currency || 'EUR').toUpperCase();
  const size = Math.abs(row.amount);
  const text = currency === 'EUR' ? eurText(size) : `${SYMBOLS[currency] ?? currency} ${PLAIN.format(size)}`;
  return credit(row) ? `− ${text}` : text;
}

/** '≈ € 16.985,20' beside an amount in another currency; null in euro or without a euro value. */
export function eurApprox(row: InvoiceRow): string | null {
  const currency = (row.currency || 'EUR').toUpperCase();
  if (currency === 'EUR' || row.amountEur === null || row.amountEur === undefined || !Number.isFinite(row.amountEur)) return null;
  return `≈ ${eurText(Math.abs(row.amountEur))}`;
}

/** The chips of Gekoppeld: the container, "Bank dd/mm" per transaction, TICA. */
export function linkChips(row: InvoiceRow): { type: InvoiceLink['type']; id: number; label: string; title: string }[] {
  return (row.links ?? []).map((link) => {
    if (link.type === 'CONTAINER') {
      const name = link.label?.trim() || (row.container?.id === link.id ? containerLabel(row.container) : `Inkoop #${link.id}`);
      return { type: link.type, id: link.id, label: name, title: `Container ${name}` };
    }
    if (link.type === 'TRANSACTION') {
      const day = link.label?.trim() || (isDay(link.date) ? `${link.date.slice(8, 10)}/${link.date.slice(5, 7)}` : '');
      const title = ['Banktransactie', isDay(link.date) ? longDate(link.date) : '', link.account ?? ''].filter(Boolean).join(' · ');
      return { type: link.type, id: link.id, label: day ? `Bank ${day}` : 'Bank', title };
    }
    return { type: link.type, id: link.id, label: 'TICA', title: 'TICA-afrekening' };
  });
}

/** How a file can be shown: a PDF in a frame, an image, an XML through its embedded PDF, or not at all. */
export function previewKind(file: InvoiceFile): 'pdf' | 'image' | 'xml' | 'none' {
  if (file.type === 'SALES_PDF' || file.kind === 'PDF') return 'pdf';
  if (file.kind === 'IMAGE') return 'image';
  if (file.kind === 'XML') return file.type === 'ODOO_ATTACHMENT' || file.type === 'MEDIA_ASSET' ? 'xml' : 'none';
  return 'none';
}

const CONTENT_EXTENSIONS: readonly [RegExp, string][] = [[/pdf/i, 'pdf'], [/xml/i, 'xml'], [/jpe?g/i, 'jpg'], [/png/i, 'png']];

/** "Changsha Pretty - CI-20260412 - 2026-04-12.pdf"; the second file of a row gets " (2)". Stored names never change. */
export function downloadName(row: InvoiceRow, file: InvoiceFile, index: number): string {
  const parts = [named(row), row.number?.trim() || row.container?.number?.trim() || '', isDay(row.date) ? row.date.slice(0, 10) : '']
    .map((part) => part.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (!parts.length) return file.name;
  const base = parts.join(' - ').slice(0, 120).trim();
  const own = /\.([a-z0-9]{1,5})$/i.exec(file.name ?? '');
  const extension = own ? own[1].toLowerCase() : CONTENT_EXTENSIONS.find(([pattern]) => pattern.test(file.contentType ?? ''))?.[1] ?? '';
  return `${base}${index > 0 ? ` (${index + 1})` : ''}${extension ? '.' + extension : ''}`;
}

/** Month headers by sortDate ("oktober 2026"): consecutive rows of one month form one group. */
export function monthGroups(rows: readonly InvoiceRow[]): { label: string; rows: InvoiceRow[] }[] {
  const groups: { key: string; label: string; rows: InvoiceRow[] }[] = [];
  for (const row of rows) {
    const key = (row.sortDate ?? '').slice(0, 7);
    const last = groups.at(-1);
    if (last && last.key === key) last.rows.push(row);
    else groups.push({ key, label: isDay(row.sortDate) ? MONTH_YEAR.format(asDate(`${key}-01`)) : 'Zonder datum', rows: [row] });
  }
  return groups.map(({ label, rows: list }) => ({ label, rows: list }));
}

const BLOCKED: Readonly<Record<string, string>> = {
  CANCELLED: 'Geannuleerd in Odoo', NO_DATE: 'Nog geen factuurdatum in Odoo', ZERO: 'Bedrag is nul', NOT_EUR: 'Niet in euro',
  TICA: 'Via TICA-afrekeningen', MARKED: 'Eerst markering wissen', COST_REMOVED: 'Kost verwijderd in ENROSED', DEMO: 'Voorbeeldgegevens',
};

/** Why an incoming Odoo row cannot be registered; null when it can, or for anything else. */
export function blockedText(row: InvoiceRow): string | null {
  if (row.source !== 'ODOO' || row.direction !== 'IN' || !row.odoo || row.odoo.registrable) return null;
  return row.odoo.blockedBy ? BLOCKED[row.odoo.blockedBy] ?? null : null;
}

/** The preview's primary action and the rest (⋯); first matching line of the contract's table wins. */
export function rowActions(row: InvoiceRow): { primary: InvoiceAction | null; more: InvoiceAction[] } {
  const files = (row.files ?? []).length > 0;
  const pick = (primary: InvoiceAction, more: InvoiceAction[] = []): { primary: InvoiceAction | null; more: InvoiceAction[] } => ({
    primary: primary === 'download' && !files ? null : primary,
    more: more.filter((action) => action !== 'download' || files),
  });
  switch (row.source) {
    case 'CONTAINER_INVOICE': case 'CONTAINER_FILE': return pick('open-purchase', ['download']);
    case 'COST': return pick('open-cost', ['download']);
    case 'SALES': return pick('open-sales', ['download']);
    default: break;
  }
  if (row.odoo?.mark) return pick('clear-mark', ['download']);
  if (row.status === 'TICA') return pick('open-tica', ['download']);
  if (row.status === 'CANCELLED') return pick('download');
  if (row.statusReason === 'COST_REMOVED') return pick('container', ['download']);
  if (row.direction === 'OUT') return pick('download');
  const unhandled = row.status === 'NEW' || (row.status === 'HANDLED' && row.statusReason === 'BEFORE_START');
  if (unhandled && row.odoo?.registrable) return pick('register', ['handled', 'container', 'download']);
  if (unhandled) return pick('handled', ['container', 'download']);
  return pick('download');
}

/** The words of an action button. */
export const ACTION_LABELS: Readonly<Record<InvoiceAction, string>> = {
  'open-purchase': 'Openen in Inkoop', 'open-cost': 'Kost openen', 'open-sales': 'Verkoopdocument openen', 'open-tica': 'TICA openen',
  register: 'Registreren bij transactie…', handled: 'Afgehandeld', container: 'Hoort bij container…', 'clear-mark': 'Markering wissen',
  download: 'Downloaden',
};

/** The facts of the preview, in order (§5.3). */
export function previewFacts(row: InvoiceRow): { label: string; value: string }[] {
  const facts: { label: string; value: string }[] = [];
  facts.push({ label: 'Datum', value: longDate(row.sortDate) + (isDay(row.dueDate) ? ` · vervalt ${longDate(row.dueDate)}` : '') });
  if (isDay(row.date) && row.date.slice(0, 10) !== (row.sortDate ?? '').slice(0, 10)) facts.push({ label: 'Factuurdatum', value: longDate(row.date) });
  const approx = eurApprox(row);
  facts.push({ label: 'Bedrag', value: amountText(row) + (approx ? ` ${approx}` : '') });
  facts.push({ label: 'Soort', value: soortWord(row) });
  facts.push({ label: 'Bron', value: bronWord(row) });
  facts.push({ label: 'Status', value: statusWord(row).label });
  if (row.source === 'ODOO' && row.odoo?.name) facts.push({ label: 'Odoo-nummer', value: row.odoo.name });
  const note = row.odoo?.mark?.note?.trim();
  if (note) facts.push({ label: 'Notitie', value: note });
  return facts;
}

/**
 * "Registreren en koppelen" is ready: the rule of the bank panel's
 * canLinkReceived, with its amount matcher passed in (bankAmountsMatch).
 */
export function receivedLinkReady(preview: ReceivedOdooInvoicePreview | null, lineAmountEur: number | null,
  chosenCostId: number | null, amountsMatch: (bank: number, recorded: number) => boolean): boolean {
  if (!preview || !preview.eligible || !preview.snapshotHash || lineAmountEur === null || !Number.isFinite(lineAmountEur)) return false;
  if (!amountsMatch(lineAmountEur, -preview.paymentAmountEur)) return false;
  if (!Number.isFinite(preview.differenceEur) || Math.abs(Math.round(preview.differenceEur * 100)) > 2) return false;
  const candidates = preview.existingCandidates ?? [];
  return !candidates.length || !!preview.companyCostId || candidates.some((cost) => cost.id === chosenCostId);
}
