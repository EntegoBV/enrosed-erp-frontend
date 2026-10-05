import type { CustomerLogin, CustomerLoginStatus, LoginInvitation } from '../../core/api/login-request-api';

/**
 * The wording of the Websitelogin block on the customer sheet, without
 * Angular: what a login row says, which buttons a status offers and what
 * the toast reads after a link went out. Pure and type-imports only, so
 * node tests it directly.
 */

export type LoginActionKey = 'send' | 'withdraw';

export interface LoginAction {
  key: LoginActionKey;
  label: string;
  /** What the button does to the customer's password, when that is not obvious. */
  hint: string | null;
  danger: boolean;
}

export interface LinkToast {
  text: string;
  kind: 'ok' | 'err';
}

const LOCALE = 'nl-BE';

/** 25/05/2026, as dateText in login-request-state writes it (no runtime import from there). */
export function loginDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(LOCALE, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}

export function loginBadge(status: CustomerLoginStatus): { label: string; css: string } {
  if (status === 'ACTIVE') return { label: 'Actief', css: 'badge--ok' };
  if (status === 'INVITED') return { label: 'Uitgenodigd', css: 'badge--gold' };
  return { label: 'Ingetrokken', css: 'badge--neutral' };
}

/** The one fact under the login e-mail; the expiry comes from the server, never from a fixed lifetime. */
export function loginRowText(
  login: Pick<CustomerLogin, 'status' | 'lastLinkSentAt' | 'linkExpiresAt' | 'lastLoginAt' | 'disabledAt' | 'disabledBy'>,
  now: Date,
): string {
  if (login.status === 'ACTIVE') {
    return login.lastLoginAt ? 'Laatst ingelogd ' + loginDate(login.lastLoginAt) : 'Nog niet ingelogd';
  }
  if (login.status === 'DISABLED') {
    return 'Ingetrokken door ' + (login.disabledBy || 'onbekend') + ' op ' + loginDate(login.disabledAt);
  }
  const expires = login.linkExpiresAt ? new Date(login.linkExpiresAt) : null;
  if (!expires || isNaN(expires.getTime()) || expires.getTime() <= now.getTime()) return 'Link verlopen';
  /* A link whose mail never left has an expiry but no send date. */
  if (!login.lastLinkSentAt) return 'Link geldig tot ' + loginDate(login.linkExpiresAt);
  return 'Link verstuurd op ' + loginDate(login.lastLinkSentAt) + ', geldig tot ' + loginDate(login.linkExpiresAt);
}

/** A withdrawn login can only be given again; the other two get a new link or are withdrawn. */
export function loginActions(status: CustomerLoginStatus): LoginAction[] {
  if (status === 'DISABLED') {
    return [{
      key: 'send', label: 'Login opnieuw geven', danger: false,
      hint: 'De klant kiest dan een nieuw wachtwoord; het oude werkt niet meer.',
    }];
  }
  return [
    {
      key: 'send', label: 'Nieuwe link sturen', danger: false,
      hint: status === 'ACTIVE'
        ? 'Voor een vergeten wachtwoord. Het huidige wachtwoord blijft werken tot de klant een nieuw kiest.'
        : null,
    },
    { key: 'withdraw', label: 'Login intrekken', hint: null, danger: true },
  ];
}

/** A mail that did not leave is an error toast: the login exists, the link did not arrive. */
export function linkToast(email: string, invitation: Pick<LoginInvitation, 'sent' | 'expiresAt'>): LinkToast {
  if (!invitation.sent) {
    return { kind: 'err', text: 'De mail is niet vertrokken. Probeer het opnieuw met Nieuwe link sturen.' };
  }
  return { kind: 'ok', text: 'Link verstuurd naar ' + email + ', geldig tot ' + loginDate(invitation.expiresAt) };
}
