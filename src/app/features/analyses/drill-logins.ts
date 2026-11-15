import type { LoginActivityLogin, LoginActivityVisit } from '../../core/api/login-request-api';
import type { DrillColumn, DrillRow, DrillView } from './drill-model';
import { deviceText, kindsText, startText } from './login-activity-words';

/**
 * Bezoekers › Klantlogins' drill-downs (the one Analyses dialog, rule A.4: the rows add up to the figure):
 * the visits behind Bezoeken or one login, the time per login behind Tijd op de site, the customers behind
 * Ingelogde klanten, and the logins whose link was never used. Pure with type-only imports and the words module.
 */

/** A customer's sheet opens on /customers?klant=<id>. */
function customerLink(customerId: number): DrillRow['link'] {
  return { path: ['/customers'], query: { klant: customerId } };
}

/** Minutes of a measured length; null for a visit that has none (history). */
function minutesOf(seconds: number | null): number | null {
  return seconds === null ? null : seconds / 60;
}

/**
 * `logins.visits`: one row per visit, newest first. The figure is a count of visits; the Duur column adds up
 * the measured ones. With `single`, the dialog is one login's and leaves the customer column out.
 */
export function loginVisitsView(visits: readonly LoginActivityVisit[], context: {
  scope: string;
  title: string;
  count: number;
  single: boolean;
  note?: string | null;
}): DrillView {
  /* Without one measured visit the total has no length to show ("—", never "< 1 min"). */
  const measured = visits.some((visit) => visit.seconds !== null);
  const columns: DrillColumn[] = [
    ...(context.single ? [] : [{ key: 'company', label: 'Klant', format: 'text', phone: 'title' } satisfies DrillColumn]),
    { key: 'when', label: 'Begin', format: 'moment', phone: context.single ? 'title' : 'sub' },
    { key: 'what', label: 'Deed', format: 'text', phone: 'sub' },
    { key: 'device', label: 'Toestel', format: 'text', phone: 'none', width: '96px' },
    { key: 'how', label: 'Hoe', format: 'text', phone: 'none', width: '132px' },
    { key: 'minutes', label: 'Duur', format: 'minutes', phone: 'value', sum: measured, width: '96px' },
  ];
  return {
    id: 'logins.visits',
    title: context.title,
    scope: context.scope,
    note: context.note ?? null,
    columns,
    rows: visits.map((visit): DrillRow => ({
      key: `visit-${visit.accountId}-${visit.start}`,
      cells: {
        company: visit.company ?? visit.email ?? 'Onbekende klant',
        when: visit.start,
        what: kindsText(visit.kinds) || null,
        device: deviceText(visit.device) || null,
        how: startText(visit.startKind, visit.history),
        minutes: minutesOf(visit.seconds),
      },
      pill: visit.orderIds.length ? 'Besteld' : null,
      link: visit.orderIds.length ? { path: ['/sales', visit.orderIds[0]] } : customerLink(visit.customerId),
    })),
    valueKey: null,
    total: { value: context.count, format: 'int', of: 'rows', label: 'Bezoeken' },
    gapLabel: 'Oudere bezoeken (niet in de lijst)',
    sort: { key: 'when', dir: 'desc' },
    empty: 'Geen bezoeken in deze periode.',
  };
}

/** `logins.time`: the measured minutes per login; the rows add up to Tijd op de site. */
export function loginTimeView(logins: readonly LoginActivityLogin[], context: { scope: string; seconds: number }): DrillView {
  const rows = logins.filter((login) => login.seconds > 0);
  return {
    id: 'logins.time',
    title: 'Tijd op de site per login',
    scope: context.scope,
    columns: [
      { key: 'company', label: 'Klant', format: 'text', phone: 'title' },
      { key: 'email', label: 'Login', format: 'text', phone: 'none' },
      { key: 'visits', label: 'Bezoeken', format: 'int', phone: 'sub', width: '96px' },
      { key: 'last', label: 'Laatst', format: 'moment', phone: 'sub' },
      { key: 'minutes', label: 'Tijd', format: 'minutes', phone: 'value', width: '96px' },
    ],
    rows: rows.map((login): DrillRow => ({
      key: `login-${login.accountId}-${login.customerId}`,
      cells: {
        company: login.company ?? login.email, email: login.email, visits: login.measuredVisits,
        last: login.lastActiveAt, minutes: login.seconds / 60,
      },
      link: customerLink(login.customerId),
    })),
    valueKey: 'minutes',
    total: { value: context.seconds / 60, format: 'minutes', of: 'sum', label: 'Tijd op de site' },
    sort: { key: 'minutes', dir: 'desc' },
    empty: 'Nog geen gemeten tijd in deze periode.',
  };
}

/**
 * `logins.customers`: the customers that used a login in the period, one row per customer (a customer with two
 * logins is one row); the row count is Ingelogde klanten.
 */
export function loginCustomersView(logins: readonly LoginActivityLogin[], context: { scope: string; customers: number }): DrillView {
  const byCustomer = new Map<number, { company: string; visits: number; seconds: number; measured: number; last: string | null; logins: number; orders: number }>();
  for (const login of logins) {
    if (login.visits === 0) continue;
    const known = byCustomer.get(login.customerId);
    const last = !known?.last || (login.lastActiveAt && login.lastActiveAt > known.last) ? login.lastActiveAt : known.last;
    byCustomer.set(login.customerId, {
      company: known?.company ?? login.company ?? login.email,
      visits: (known?.visits ?? 0) + login.visits,
      seconds: (known?.seconds ?? 0) + login.seconds,
      measured: (known?.measured ?? 0) + login.measuredVisits,
      last,
      logins: (known?.logins ?? 0) + 1,
      orders: (known?.orders ?? 0) + login.orderIds.length,
    });
  }
  const measured = [...byCustomer.values()].some((row) => row.measured > 0);
  return {
    id: 'logins.customers',
    title: 'Ingelogde klanten',
    scope: context.scope,
    columns: [
      { key: 'company', label: 'Klant', format: 'text', phone: 'title' },
      { key: 'last', label: 'Laatst', format: 'moment', phone: 'sub' },
      { key: 'visits', label: 'Bezoeken', format: 'int', phone: 'value', sum: true, width: '96px' },
      { key: 'minutes', label: 'Tijd', format: 'minutes', phone: 'none', sum: measured, width: '96px' },
      { key: 'orders', label: 'Besteld', format: 'int', phone: 'none', sum: true, width: '84px' },
    ],
    rows: [...byCustomer.entries()].map(([customerId, row]): DrillRow => ({
      key: `customer-${customerId}`,
      /* Only moments from before the measuring: no length rather than "0 min". */
      cells: { company: row.company, last: row.last, visits: row.visits, minutes: row.measured ? row.seconds / 60 : null, orders: row.orders },
      pill: row.logins > 1 ? `${row.logins} logins` : null,
      link: customerLink(customerId),
    })),
    valueKey: null,
    total: { value: context.customers, format: 'int', of: 'rows', label: 'Klanten' },
    sort: { key: 'last', dir: 'desc' },
    empty: 'Geen klant logde in deze periode in.',
  };
}

/** `logins.unused`: logins whose link was sent but never used (no password chosen yet). */
export function loginUnusedView(logins: readonly LoginActivityLogin[], context: { scope: string; now: Date }): DrillView {
  const rows = logins.filter((login) => login.status === 'INVITED');
  return {
    id: 'logins.unused',
    title: 'Link nog niet gebruikt',
    scope: context.scope,
    columns: [
      { key: 'company', label: 'Klant', format: 'text', phone: 'title' },
      { key: 'email', label: 'Login', format: 'text', phone: 'sub' },
      { key: 'sent', label: 'Link verstuurd', format: 'moment', phone: 'sub' },
      { key: 'state', label: 'Link', format: 'text', phone: 'value', width: '112px' },
    ],
    rows: rows.map((login): DrillRow => {
      const expires = login.linkExpiresAt ? new Date(login.linkExpiresAt) : null;
      const open = !!expires && expires.getTime() > context.now.getTime();
      return {
        key: `unused-${login.accountId}`,
        cells: { company: login.company ?? login.email, email: login.email, sent: login.linkSentAt ?? login.createdAt, state: open ? 'Nog geldig' : 'Verlopen' },
        tone: open ? null : 'warn',
        link: customerLink(login.customerId),
      };
    }),
    valueKey: null,
    total: { value: rows.length, format: 'int', of: 'rows', label: 'Link niet gebruikt' },
    sort: { key: 'sent', dir: 'desc' },
    empty: 'Elke login werd al gebruikt.',
    note: 'Een nieuwe link stuur je vanaf de klantfiche (Websitelogin).',
  };
}
