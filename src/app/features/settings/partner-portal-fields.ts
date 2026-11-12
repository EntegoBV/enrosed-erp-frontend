import type {
  PartnerPortalAdminRow, PartnerPortalLoginRequest, PartnerPortalSettingsRequest,
} from '../../core/api/partner-sales-api';
import { partnerPasswordProblem } from '../../core/api/partner-password';

/**
 * Instellingen › Partnerportaal: the draft of one partner (login, cost
 * percents, stock location), what changed against the saved row, the checks
 * the server makes (same words), and the short lines the overview and the
 * customer sheet show. Pure.
 */

export const USERNAME_PATTERN = /^[a-z0-9._-]{3,64}$/;
export const USERNAME_RULE = 'Een gebruikersnaam heeft 3 tot 64 tekens: kleine letters, cijfers, punt, streepje of liggend streepje';
const PCT_MAX = 50;

export interface PartnerPortalDraft {
  username: string;
  displayName: string;
  /** Empty keeps the current password. */
  password: string;
  active: boolean;
  /** As typed ("4,5"); empty = the default. */
  commission: string;
  transport: string;
  /** null = the main warehouse (the default). */
  locationId: number | null;
}

export type DraftField = keyof PartnerPortalDraft;
export type DraftErrors = Partial<Record<DraftField, string>>;

const LOGIN_FIELDS: readonly DraftField[] = ['username', 'displayName', 'password', 'active'];
const SETTINGS_FIELDS: readonly DraftField[] = ['commission', 'transport', 'locationId'];

/** The draft that equals the saved row. A new login starts with username = empty, active on. */
export function draftOf(row: PartnerPortalAdminRow): PartnerPortalDraft {
  return {
    username: row.login?.username ?? '',
    displayName: row.login?.displayName ?? '',
    password: '',
    active: row.login?.active ?? true,
    commission: pctText(row.settings.auctionCommissionPct),
    transport: pctText(row.settings.auctionTransportPct),
    locationId: row.settings.locationId ?? null,
  };
}

/** "4,5" for a stored 4.5, "" for null (the default applies). */
export function pctText(value: number | null | undefined): string {
  return value == null ? '' : String(Number(value)).replace('.', ',');
}

/** A typed percent: null for empty, NaN when it is not a number. */
export function parsePct(text: string): number | null {
  const clean = text.trim().replace(/\s|%/g, '').replace(',', '.');
  if (!clean) return null;
  const value = Number(clean);
  return Number.isFinite(value) ? value : Number.NaN;
}

function same(field: DraftField, draft: PartnerPortalDraft, saved: PartnerPortalDraft): boolean {
  if (field === 'username') return canonicalUsername(draft.username) === saved.username;
  if (field === 'displayName') return draft.displayName.trim() === saved.displayName;
  if (field === 'password') return draft.password === '';
  if (field === 'commission' || field === 'transport') {
    const a = parsePct(draft[field]);
    const b = parsePct(saved[field]);
    return a === b || (a != null && b != null && Math.abs(a - b) < 1e-9);
  }
  return draft[field] === saved[field];
}

/** The fields that differ from the saved row. A row without a login counts only once something is typed. */
export function changedFields(draft: PartnerPortalDraft, row: PartnerPortalAdminRow): DraftField[] {
  const saved = draftOf(row);
  const fields = (row.partner ? [...LOGIN_FIELDS, ...SETTINGS_FIELDS] : LOGIN_FIELDS).filter((field) => !same(field, draft, saved));
  /* No login yet and nothing of one typed (the switch alone is not a login): only the settings part counts. */
  if (!row.login && !fields.some((field) => field === 'username' || field === 'displayName' || field === 'password')) {
    return fields.filter((field) => SETTINGS_FIELDS.includes(field));
  }
  return fields;
}

export function loginChanged(fields: readonly DraftField[]): boolean {
  return fields.some((field) => LOGIN_FIELDS.includes(field));
}

export function settingsChanged(fields: readonly DraftField[]): boolean {
  return fields.some((field) => SETTINGS_FIELDS.includes(field));
}

export function canonicalUsername(value: string): string {
  return value.trim().toLowerCase();
}

/** The server's own checks, before anything is sent. Only the parts that changed are checked. */
export function draftErrors(draft: PartnerPortalDraft, row: PartnerPortalAdminRow): DraftErrors {
  const errors: DraftErrors = {};
  const fields = changedFields(draft, row);
  if (loginChanged(fields)) {
    const username = canonicalUsername(draft.username);
    if (!USERNAME_PATTERN.test(username)) errors.username = USERNAME_RULE;
    const name = draft.displayName.trim();
    if (!name) errors.displayName = 'Vul de naam in van wie zich aanmeldt';
    else if (name.length > 100) errors.displayName = 'Een naam heeft hoogstens 100 tekens';
    if (draft.password) {
      const problem = partnerPasswordProblem(draft.password);
      if (problem) errors.password = problem;
    } else if (!row.login) {
      errors.password = 'Stel een wachtwoord in voor de eerste aanmelding';
    }
  }
  if (settingsChanged(fields)) {
    for (const field of ['commission', 'transport'] as const) {
      const value = parsePct(draft[field]);
      if (value != null && (Number.isNaN(value) || value < 0 || value > PCT_MAX)) errors[field] = 'Een percentage ligt tussen 0 en 50';
    }
  }
  return errors;
}

export function loginRequest(draft: PartnerPortalDraft): PartnerPortalLoginRequest {
  return {
    username: canonicalUsername(draft.username),
    displayName: draft.displayName.trim(),
    password: draft.password ? draft.password : null,
    active: draft.active,
  };
}

export function settingsRequest(draft: PartnerPortalDraft): PartnerPortalSettingsRequest {
  const pct = (text: string): number | null => {
    const value = parsePct(text);
    return value == null || Number.isNaN(value) ? null : Math.round(value * 10000) / 10000;
  };
  return { auctionCommissionPct: pct(draft.commission), auctionTransportPct: pct(draft.transport), locationId: draft.locationId };
}

const PCT = new Intl.NumberFormat('nl-BE', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** "4,5 % / 5,5 %": the percents that apply (stored, else the defaults). */
export function appliedCosts(row: PartnerPortalAdminRow): string {
  const s = row.settings;
  return `${PCT.format(s.auctionCommissionPct ?? s.defaultAuctionCommissionPct)} % / ${PCT.format(s.auctionTransportPct ?? s.defaultAuctionTransportPct)} %`;
}

/** "verhoeven · actief", "verhoeven · uit", "Geen login". */
export function loginLine(row: PartnerPortalAdminRow): string {
  if (!row.login) return 'Geen login';
  return `${row.login.username} · ${row.login.active ? 'actief' : 'uit'}`;
}

/** The overview row: "verhoeven · actief · 4,5 % / 5,5 %"; several partners: "2 partners · 1 actief". */
export function portalSummary(rows: readonly PartnerPortalAdminRow[]): string {
  const partners = rows.filter((row) => row.partner);
  if (!partners.length) return 'Geen partnerklant';
  if (partners.length === 1) return `${loginLine(partners[0])} · ${appliedCosts(partners[0])}`;
  const active = partners.filter((row) => row.login?.active).length;
  return `${partners.length} partners · ${active} actief`;
}

/** The phone's short value: "Actief", "Uit", "Geen login" (one partner), else "1 van 2 actief". */
export function portalShort(rows: readonly PartnerPortalAdminRow[]): string {
  const partners = rows.filter((row) => row.partner);
  if (!partners.length) return 'Geen';
  if (partners.length === 1) return !partners[0].login ? 'Geen login' : partners[0].login.active ? 'Actief' : 'Uit';
  return `${partners.filter((row) => row.login?.active).length} van ${partners.length} actief`;
}
