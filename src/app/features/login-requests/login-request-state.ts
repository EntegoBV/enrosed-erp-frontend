import type {
  CustomerLogin, CustomerLoginStatus, LoginRequest, LoginRequestDetail, LoginRequestLaterSubmission,
  LoginRequestMatch, LoginRequestSource, LoginRequestStatus,
} from '../../core/api/login-request-api';

/**
 * The decisions behind the Login-aanvragen page, without Angular.
 *
 * Who is preselected, when the choice is locked, when an e-mail mismatch
 * must be confirmed and which sentence staff read are rules, not layout:
 * a wrong default here gives a stranger a login on a real customer. Pure
 * and type-imports only, so node tests it directly.
 */

/** Must not start with /login, /offerte or /voorwaarden: the shell renders those bare. */
export const LOGIN_REQUESTS_PATH = '/klantlogins';
export const LOGIN_REQUEST_PAGE_SIZE = 50;
/** The server keeps at most this much of the internal note on a rejected request. */
export const REJECT_NOTE_MAX = 500;

export type LoginRequestSegment = 'open' | 'goedgekeurd' | 'afgewezen';

/** The customer staff bind the login to, or a new customer made from the request. */
export type LoginChoice =
  | { kind: 'customer'; customerId: number; company: string; email: string | null }
  | { kind: 'new' };

export interface NewCustomerDraft {
  company: string;
  vatNumber: string;
  countryCode: string;
  contact: string;
  phone: string;
  language: string;
}

export interface LoginAlert {
  tone: 'info' | 'warn';
  text: string;
}

const LOCALE = 'nl-BE';

/** 25/05/2026, as the dateNl pipe writes it. */
export function dateText(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(LOCALE, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}

/** Same rules as escapeHtml in shared/ui, which this module cannot import at runtime. */
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

/* --------------------------------------------------------------- labels */

export function sourceLabel(entry: { source: LoginRequestSource; salesOrderNumber?: string | null }): string {
  if (entry.source === 'QUOTE') return ('Offerteaanvraag ' + (entry.salesOrderNumber ?? '')).trim();
  return entry.source === 'NEW_LINK' ? 'Nieuwe link gevraagd' : 'Loginformulier';
}

export function statusBadge(status: LoginRequestStatus): { label: string; css: string } {
  if (status === 'APPROVED') return { label: 'goedgekeurd', css: 'badge--ok' };
  if (status === 'REJECTED') return { label: 'afgewezen', css: 'badge--neutral' };
  return { label: 'wacht', css: 'badge--gold' };
}

export function loginStatusLabel(status: CustomerLoginStatus): string {
  return status === 'ACTIVE' ? 'Actief' : status === 'INVITED' ? 'Uitgenodigd' : 'Ingetrokken';
}

export function matchReasonLabel(reason: LoginRequestMatch['matchedOn'][number]): string {
  switch (reason) {
    case 'LOGIN': return 'heeft deze login';
    case 'QUOTE': return 'uit deze offerteaanvraag';
    case 'EMAIL': return 'zelfde e-mailadres';
    default: return 'zelfde BTW-nummer';
  }
}

export function segmentToStatus(segment: string | null | undefined): LoginRequestStatus {
  return segment === 'goedgekeurd' ? 'APPROVED' : segment === 'afgewezen' ? 'REJECTED' : 'PENDING';
}

/** From the true total of open requests, never from the length of the loaded page. */
export function subtitle(count: number): string {
  if (count <= 0) return 'Geen open aanvragen';
  return count === 1 ? '1 wacht op goedkeuring' : count + ' wachten op goedkeuring';
}

/** A full page means there may be a next one. */
export function hasMore(lastPageLength: number, pageSize: number = LOGIN_REQUEST_PAGE_SIZE): boolean {
  return lastPageLength >= pageSize;
}

/**
 * The list from page 0 up to the last page asked for, each row once.
 *
 * Meer laden fetches these pages again instead of only the next one: the
 * open list shrinks while colleagues decide, and a next page by offset
 * alone would then skip as many waiting requests as were decided.
 */
export function mergePages<T extends { id: number }>(
  pages: readonly (readonly T[])[], pageSize: number = LOGIN_REQUEST_PAGE_SIZE,
): { rows: T[]; pages: number; more: boolean } {
  const rows: T[] = [];
  const seen = new Set<number>();
  let used = 0;
  let more = false;
  for (const page of pages) {
    used += 1;
    for (const row of page) {
      if (!seen.has(row.id)) { seen.add(row.id); rows.push(row); }
    }
    more = hasMore(page.length, pageSize);
    if (!more) break;
  }
  return { rows, pages: Math.max(used, 1), more };
}

/** The filled parts of a list line; an empty contact or country leaves no loose separator. */
export function filledParts(parts: readonly (string | null | undefined)[]): string[] {
  return parts.map((part) => (part ?? '').trim()).filter((part) => part.length > 0);
}

/** Meta line 1 of a list row: contact and e-mail. */
export function rowContactParts(row: Pick<LoginRequest, 'contactName' | 'email'>): string[] {
  return filledParts([row.contactName, row.email]);
}

/** Meta line 2 of a list row: country, source, received and how often it was asked again. */
export function rowFactParts(
  row: Pick<LoginRequest, 'source' | 'salesOrderNumber' | 'createdAt' | 'repeatCount'>, country: string,
): string[] {
  return filledParts([
    country, sourceLabel(row), dateText(row.createdAt),
    row.repeatCount > 0 ? row.repeatCount + '× opnieuw gevraagd' : null,
  ]);
}

/** The internal note sent with a rejection: trimmed, at most what the server keeps, null when empty. */
export function rejectNote(text: string | null | undefined): string | null {
  const note = (text ?? '').trim().slice(0, REJECT_NOTE_MAX).trim();
  return note || null;
}

/** One sentence per intake route that is full; the general one for a backend that names no route. */
export function intakeFullTexts(sources: readonly string[] | null | undefined): string[] {
  const texts: string[] = [];
  if (sources?.includes('ORDER_SCREEN')) {
    texts.push('De lijst met open aanvragen via het loginformulier is vol (300). Nieuwe aanvragen via dat '
      + 'formulier worden niet meer bewaard tot er aanvragen zijn goedgekeurd of afgewezen. Vragen om een nieuwe '
      + 'link van klanten met een login komen nog wel binnen.');
  }
  if (sources?.includes('QUOTE')) {
    texts.push('De lijst met open login-aanvragen bij een offerte is vol (300). Nieuwe aanvragen via het vinkje '
      + 'bij een offerte worden niet meer bewaard tot er aanvragen zijn behandeld. De offertes zelf komen gewoon '
      + 'binnen, met de regel dat de klant ook een login vraagt.');
  }
  if (!texts.length) {
    texts.push('De lijst met open aanvragen is vol. Nieuwe aanvragen van de website worden niet meer bewaard '
      + 'tot er aanvragen zijn goedgekeurd of afgewezen.');
  }
  return texts;
}

/* ----------------------------------------------------- later submissions */

/** The later versions an applicant sent, in arrival order; the new-link marker is not one. */
export function applicantEntries(request: Pick<LoginRequest, 'laterSubmissions'>): LoginRequestLaterSubmission[] {
  return (request.laterSubmissions ?? []).filter((entry) => entry.source !== 'NEW_LINK');
}

/** "The holder of the existing login asked for a new link meanwhile", or null. */
export function newLinkMarker(request: Pick<LoginRequest, 'laterSubmissions'>): LoginRequestLaterSubmission | null {
  return (request.laterSubmissions ?? []).find((entry) => entry.source === 'NEW_LINK') ?? null;
}

export function draftFromRequest(request: LoginRequest): NewCustomerDraft {
  return {
    company: request.companyName ?? '', vatNumber: request.vatNumber ?? '',
    countryCode: request.companyCountryCode ?? '', contact: request.contactName ?? '',
    phone: request.phone ?? '', language: request.language ?? 'NL',
  };
}

/** The new-customer form filled from one later version, never from the first request. */
export function draftFromLater(entry: LoginRequestLaterSubmission): NewCustomerDraft {
  return {
    company: entry.companyName ?? '', vatNumber: entry.vatNumber ?? '',
    countryCode: entry.companyCountryCode ?? '', contact: entry.contactName ?? '',
    phone: entry.phone ?? '', language: entry.language ?? 'NL',
  };
}

/* ------------------------------------------------------------ the choice */

function liveLogin(account: CustomerLogin | null | undefined): account is CustomerLogin {
  return !!account && (account.status === 'INVITED' || account.status === 'ACTIVE');
}

/**
 * A request for an e-mail that already has a working login can only go to
 * the customer of that login: approving sends a new link to the same login.
 * A withdrawn login locks nothing; it may move to another customer.
 */
export function choiceLocked(detail: LoginRequestDetail): boolean {
  return detail.request.status === 'PENDING' && detail.request.source !== 'NEW_LINK'
    && liveLogin(detail.existingAccount);
}

/**
 * Who is preselected, in this order and nothing else: the customer of the
 * working login (locked); else the oldest customer with the same e-mail;
 * else nobody. A VAT number is public, so a VAT-only match is never a default.
 */
export function defaultChoice(detail: LoginRequestDetail): LoginChoice | null {
  if (detail.request.status !== 'PENDING' || detail.request.source === 'NEW_LINK') return null;
  if (liveLogin(detail.existingAccount)) {
    const holder = detail.matches.find((match) => match.matchedOn.includes('LOGIN'));
    return holder ? choiceOf(holder) : {
      kind: 'customer', customerId: detail.existingAccount.customerId,
      company: detail.existingAccount.customerCompany, email: null,
    };
  }
  const sameEmail = detail.matches
    .filter((match) => match.matchedOn.includes('EMAIL'))
    .sort((a, b) => a.customerId - b.customerId)[0];
  return sameEmail ? choiceOf(sameEmail) : null;
}

/**
 * The choice after the sheet was loaded again without being reopened, for
 * instance after a refused approval. A login given meanwhile fixes the
 * choice to its customer, and a matched customer that is no longer a match
 * is dropped; a searched customer or a new customer stays as chosen.
 */
export function reconcileChoice(
  detail: LoginRequestDetail, choice: LoginChoice | null, fromSearch: boolean,
): LoginChoice | null {
  if (detail.request.status !== 'PENDING' || detail.request.source === 'NEW_LINK') return null;
  if (choiceLocked(detail)) return defaultChoice(detail);
  if (!choice || choice.kind === 'new' || fromSearch) return choice;
  const match = detail.matches.find((entry) => entry.customerId === choice.customerId);
  return match ? choiceOf(match) : null;
}

/**
 * The logins a match row names in a blue badge: working ones only, since a
 * withdrawn login does not count as having a login, and not the login the
 * chip "heeft deze login" on the same row already stands for.
 */
export function matchLoginBadges(
  match: Pick<LoginRequestMatch, 'matchedOn' | 'logins'>, existingAccountId: number | null | undefined,
): LoginRequestMatch['logins'] {
  return (match.logins ?? []).filter((login) => login.status !== 'DISABLED'
    && !(match.matchedOn.includes('LOGIN') && login.id === existingAccountId));
}

export function choiceOf(match: Pick<LoginRequestMatch, 'customerId' | 'company' | 'email'>): LoginChoice {
  return { kind: 'customer', customerId: match.customerId, company: match.company, email: match.email ?? null };
}

/** True when the preselected customer is an older one than the customer the quote itself made. */
export function olderCustomerPreselected(detail: LoginRequestDetail): boolean {
  const choice = defaultChoice(detail);
  return !choiceLocked(detail) && choice?.kind === 'customer'
    && detail.request.source === 'QUOTE' && detail.request.customerId != null
    && choice.customerId !== detail.request.customerId;
}

/**
 * Case and surrounding spaces, tabs and line ends do not count; a customer
 * without e-mail always differs.
 *
 * Deliberately not String.trim(): that also drops a non-breaking space or a
 * byte-order mark, which the server's own comparison keeps. The screen
 * would then see no mismatch, send no confirm and get a refusal it has no
 * button for. Asking once too often is harmless, not asking is a dead end.
 */
export function emailMismatch(requestEmail: string | null | undefined, customerEmail: string | null | undefined): boolean {
  const customer = normalEmail(customerEmail);
  return !customer || customer !== normalEmail(requestEmail);
}

function normalEmail(value: string | null | undefined): string {
  return (value ?? '').replace(/^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g, '').toLowerCase();
}

/**
 * Binding a login to a customer with another e-mail needs an explicit yes.
 * Not for the locked customer: that binding was decided when the login was given.
 */
export function needsMismatchConfirm(detail: LoginRequestDetail, choice: LoginChoice | null): boolean {
  if (!choice || choice.kind !== 'customer') return false;
  if (choiceLocked(detail)) {
    const locked = defaultChoice(detail);
    if (locked?.kind === 'customer' && locked.customerId === choice.customerId) return false;
  }
  return emailMismatch(detail.request.email, choice.email);
}

export function canApprove(choice: LoginChoice | null, draft: NewCustomerDraft): boolean {
  if (!choice) return false;
  if (choice.kind === 'customer') return true;
  return !!draft.company.trim() && !!draft.vatNumber.trim() && !!draft.countryCode.trim();
}

/* ---------------------------------------------------------------- alerts */

/** What staff must know when the request e-mail already has a login (not for a new-link request). */
export function existingAccountAlert(account: CustomerLogin | null | undefined): LoginAlert | null {
  if (!account) return null;
  if (account.status === 'DISABLED') {
    return {
      tone: 'warn',
      text: 'De login voor dit e-mailadres bij ' + account.customerCompany + ' is ingetrokken door '
        + (account.disabledBy || 'onbekend') + ' op ' + dateText(account.disabledAt)
        + '. Goedkeuren geeft deze login opnieuw en stuurt een nieuwe link. Kies je een andere klant, dan '
        + 'verhuist de login naar die klant.',
    };
  }
  return {
    tone: 'warn',
    text: 'Voor dit e-mailadres bestaat al een login bij ' + account.customerCompany + ' ('
      + loginStatusLabel(account.status) + '). Goedkeuren stuurt een nieuwe link naar dezelfde login.',
  };
}

/** A new-link request by the state of its login; a withdrawn or vanished login cannot get a link. */
export function newLinkAlert(status: CustomerLoginStatus | null | undefined): LoginAlert & { canSend: boolean } {
  if (status === 'ACTIVE') {
    return {
      tone: 'info', canSend: true,
      text: 'Deze klant heeft al een login en vraagt een nieuwe link, bijvoorbeeld na een vergeten wachtwoord. '
        + 'Het huidige wachtwoord blijft werken tot de klant een nieuw kiest.',
    };
  }
  if (status === 'INVITED') {
    return {
      tone: 'info', canSend: true,
      text: 'Deze klant heeft een login maar koos nog geen wachtwoord; de vorige link is verlopen of niet '
        + 'gebruikt. Met een nieuwe link kan de klant alsnog een wachtwoord kiezen.',
    };
  }
  return {
    tone: 'warn', canSend: false,
    text: 'Deze login is intussen ingetrokken. Een nieuwe link sturen kan niet; wijs de aanvraag af of geef de '
      + 'login opnieuw bij de klant (Klanten, blok Websitelogin).',
  };
}

/** For an invited login: until when its link works, from the server's own expiry. */
export function linkLine(account: Pick<CustomerLogin, 'status' | 'linkExpiresAt'>, now: Date): string | null {
  if (account.status !== 'INVITED') return null;
  const expires = account.linkExpiresAt ? new Date(account.linkExpiresAt) : null;
  if (!expires || isNaN(expires.getTime()) || expires.getTime() <= now.getTime()) return 'Link verlopen';
  return 'Link geldig tot ' + dateText(account.linkExpiresAt);
}

/** HTML for the confirm sheet; the company is escaped here. */
export function rejectMessage(company: string, repeatCount: number): string {
  return 'De aanvraag van <b>' + escapeHtml(company) + '</b> afwijzen? De aanvrager krijgt geen bericht.'
    + (repeatCount > 0 ? ' Er kwamen ' + repeatCount + ' herhalingen binnen.' : '');
}
