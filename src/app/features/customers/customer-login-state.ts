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

/** 14/11/2026 om 12:20, Belgian time: when a login was last in use. */
export function loginMoment(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (isNaN(date.getTime())) return value;
  const day = new Intl.DateTimeFormat(LOCALE, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Brussels' }).format(date);
  const time = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' }).format(date);
  return day + ' om ' + time;
}

export function loginBadge(status: CustomerLoginStatus): { label: string; css: string } {
  if (status === 'ACTIVE') return { label: 'Actief', css: 'badge--ok' };
  if (status === 'INVITED') return { label: 'Uitgenodigd', css: 'badge--gold' };
  return { label: 'Ingetrokken', css: 'badge--neutral' };
}

/** The one fact under the login e-mail; the expiry comes from the server, never from a fixed lifetime. */
export function loginRowText(
  login: Pick<CustomerLogin, 'status' | 'lastLinkSentAt' | 'linkExpiresAt' | 'lastLoginAt' | 'disabledAt' | 'disabledBy'
    | 'passwordSetAt' | 'lastActiveAt' | 'recentVisits'>,
  now: Date,
): string {
  if (login.status === 'ACTIVE') {
    /* An active login has chosen its password, and choosing it logs the customer in: never "Nog niet ingelogd". */
    const last = login.lastActiveAt ?? login.lastLoginAt ?? login.passwordSetAt;
    const visits = login.recentVisits ?? 0;
    const recent = visits > 0 ? ' · ' + visits + (visits === 1 ? ' bezoek' : ' bezoeken') + ' in 30 dagen' : '';
    return last ? 'Laatst ingelogd ' + loginMoment(last) + recent : 'Wachtwoord gekozen';
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

/**
 * The hints under the buttons of one login. Next to a second button a hint
 * names the button it belongs to: directly under the red Login intrekken,
 * "Voor een vergeten wachtwoord" would read as if it described withdrawing.
 */
export function loginHints(actions: readonly LoginAction[]): string[] {
  return actions.filter((action) => action.hint).map((action) => {
    const hint = action.hint ?? '';
    return actions.length > 1 ? action.label + ': ' + hint.charAt(0).toLowerCase() + hint.slice(1) : hint;
  });
}

/** A mail that did not leave is an error toast: the login exists, the link did not arrive. */
export function linkToast(email: string, invitation: Pick<LoginInvitation, 'sent' | 'expiresAt'>): LinkToast {
  if (!invitation.sent) {
    return { kind: 'err', text: 'De mail is niet vertrokken. Probeer het opnieuw met Nieuwe link sturen.' };
  }
  return { kind: 'ok', text: 'Link verstuurd naar ' + email + ', geldig tot ' + loginDate(invitation.expiresAt) };
}
