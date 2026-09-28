import type { ProspectInput, ProspectStatus, ProspectChannel, ProspectActivityStatus } from '../../core/api/prospect-api';

export const PROSPECT_STATUSES: { value: ProspectStatus; label: string }[] = [
  { value: 'NEW', label: 'Nieuw' }, { value: 'QUALIFIED', label: 'Geselecteerd' },
  { value: 'CONTACTED', label: 'Benaderd' }, { value: 'INTERESTED', label: 'Interesse' },
  { value: 'NOT_INTERESTED', label: 'Geen interesse' }, { value: 'CUSTOMER', label: 'Klant' },
  { value: 'DO_NOT_CONTACT', label: 'Niet benaderen' },
];
export const PROSPECT_CHANNELS: { value: ProspectChannel; label: string }[] = [
  { value: 'EMAIL', label: 'E-mail' }, { value: 'INSTAGRAM', label: 'Instagram' },
  { value: 'PHONE', label: 'Telefoon' }, { value: 'NOTE', label: 'Notitie' },
];
export const ACTIVITY_STATUSES: { value: ProspectActivityStatus; label: string }[] = [
  { value: 'DRAFT', label: 'Concept' }, { value: 'RESERVED', label: 'Gereserveerd' },
  { value: 'SCHEDULED', label: 'Ingepland' },
  { value: 'SENT', label: 'Verzonden' }, { value: 'FAILED', label: 'Mislukt' },
  { value: 'RECEIVED', label: 'Ontvangen' }, { value: 'COMPLETED', label: 'Uitgevoerd' },
  { value: 'CANCELLED', label: 'Geannuleerd' },
];
export const ACTIVITY_TYPES = [
  { value: 'INTRODUCTION', label: 'Kennismaking' }, { value: 'FOLLOW_UP', label: 'Opvolging' },
  { value: 'REPLY', label: 'Reactie' }, { value: 'LIKE', label: 'Like' },
  { value: 'COMMENT', label: 'Commentaar' }, { value: 'PROFILE_REVIEW', label: 'Profiel bekeken' },
  { value: 'NOTE', label: 'Notitie' },
];
export function prospectStatusLabel(value: string): string {
  return PROSPECT_STATUSES.find(row => row.value === value)?.label ?? value;
}
export function blankProspect(): ProspectInput {
  return { businessName: '', countryCode: '', language: 'EN', email: '', website: '', instagramHandle: '', groupKey: '', sourceUrl: '', sourceType: '', status: 'NEW', notes: '' };
}
/** Accept only navigable web links from manually entered research. */
export function prospectWebLink(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const raw = value.trim();
    const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : 'https://' + raw);
    return ['http:', 'https:'].includes(url.protocol) && !!url.hostname && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
export function instagramLink(value: string | null | undefined): string | null {
  const handle = value?.trim().replace(/^@/, '');
  return handle && /^[\w.]{1,30}$/.test(handle) ? `https://www.instagram.com/${encodeURIComponent(handle)}/` : null;
}
export function prospectValidation(input: ProspectInput): string | null {
  if (!input.businessName.trim()) return 'Vul een bedrijfsnaam in.';
  if (!/^[A-Z]{2}$/.test(input.countryCode.trim().toUpperCase())) return 'Kies een land of vul een landcode van twee letters in.';
  if (input.email?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) return 'Controleer het e-mailadres.';
  if (input.instagramHandle?.trim() && !instagramLink(input.instagramHandle)) return 'Gebruik de Instagram-gebruikersnaam, zonder profiel-URL.';
  if (input.website?.trim() && !prospectWebLink(input.website)) return 'Controleer het websiteadres.';
  if (input.sourceUrl?.trim() && !prospectWebLink(input.sourceUrl)) return 'Controleer de bronlink.';
  return null;
}
export function prospectPayload(input: ProspectInput): ProspectInput {
  const clean = (value: string | null) => value?.trim() || null;
  return {
    businessName: input.businessName.trim(), countryCode: input.countryCode.trim().toUpperCase(),
    language: clean(input.language)?.toUpperCase() ?? null, email: clean(input.email),
    website: prospectWebLink(input.website), instagramHandle: clean(input.instagramHandle)?.replace(/^@/, '') ?? null,
    groupKey: clean(input.groupKey), sourceUrl: prospectWebLink(input.sourceUrl),
    sourceType: clean(input.sourceType), status: input.status, notes: clean(input.notes),
  };
}
/** The daily target follows the server's Brussels calendar, not the device timezone. */
export function brusselsDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (type: string) => parts.find(p => p.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function localDateTime(now = new Date()): string {
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
