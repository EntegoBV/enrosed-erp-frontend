import type { Prospect, ProspectInput, ProspectActivityInput, ProspectApi } from '../../core/api/prospect-api';

export interface ProspectImportEntry { prospect: ProspectInput; activities: ProspectActivityInput[] }
export interface ProspectImportFile { version: 1; prospects: ProspectImportEntry[] }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const optionalText = (value: unknown): boolean => value === undefined || value === null || typeof value === 'string';

/** Validate the whole file before the first write, including stable activity identifiers. */
export function parseProspectImport(text: string): ProspectImportFile {
  if (text.length > 5_000_000) throw new Error('Het contactlog is te groot (maximaal 5 MB).');
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new Error('Dit bestand bevat geen geldige JSON.'); }
  if (!object(data) || data['version'] !== 1 || !Array.isArray(data['prospects'])) throw new Error('Gebruik een contactlog met version: 1 en een prospects-lijst.');
  if (!data['prospects'].length || data['prospects'].length > 250) throw new Error('Een contactlog moet 1 tot 250 prospects bevatten.');
  let activityCount = 0;
  const externalIds = new Set<string>();
  for (const [index, entry] of data['prospects'].entries()) {
    const prefix = `Prospect ${index + 1}`;
    if (!object(entry) || !object(entry['prospect']) || !Array.isArray(entry['activities'])) throw new Error(`${prefix}: bedrijfsgegevens of activiteiten ontbreken.`);
    const prospect = entry['prospect'];
    if (typeof prospect['businessName'] !== 'string' || !prospect['businessName'].trim() || typeof prospect['countryCode'] !== 'string') throw new Error(`${prefix}: bedrijfsnaam en land zijn verplicht.`);
    if (!['NEW', 'QUALIFIED', 'CONTACTED', 'INTERESTED', 'NOT_INTERESTED', 'CUSTOMER', 'DO_NOT_CONTACT'].includes(String(prospect['status']))) throw new Error(`${prefix}: ongeldige status.`);
    for (const key of ['language', 'email', 'website', 'instagramHandle', 'groupKey', 'sourceUrl', 'sourceType', 'notes']) {
      if (!optionalText(prospect[key])) throw new Error(`${prefix}: ${key} moet tekst zijn.`);
    }
    activityCount += entry['activities'].length;
    if (activityCount > 2000) throw new Error('Een contactlog mag maximaal 2000 activiteiten bevatten.');
    for (const activity of entry['activities']) {
      if (!object(activity) || !['EMAIL', 'INSTAGRAM', 'PHONE', 'NOTE'].includes(String(activity['channel']))
        || !['DRAFT', 'RESERVED', 'SCHEDULED', 'SENT', 'FAILED', 'RECEIVED', 'COMPLETED', 'CANCELLED'].includes(String(activity['status']))
        || typeof activity['type'] !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(activity['type'])
        || typeof activity['occurredAt'] !== 'string' || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(activity['occurredAt'])
        || !Number.isFinite(Date.parse(activity['occurredAt']))) throw new Error(`${prefix}: ongeldige activiteit of tijdzone.`);
      if (['RESERVED', 'SCHEDULED'].includes(String(activity['status'])) && (activity['channel'] !== 'EMAIL' || activity['type'] !== 'OUTREACH')) {
        throw new Error(`${prefix}: alleen EMAIL / OUTREACH kan als RESERVED of SCHEDULED worden geïmporteerd.`);
      }
      for (const key of ['subject', 'body', 'attachmentName', 'sourceUrl']) {
        if (!optionalText(activity[key])) throw new Error(`${prefix}: activiteitveld ${key} moet tekst zijn.`);
      }
      const id = activity['externalId'];
      if (typeof id !== 'string' || !id.trim() || id.length > 200) throw new Error(`${prefix}: elke activiteit heeft een unieke externalId nodig.`);
      if (externalIds.has(id.trim())) throw new Error(`${prefix}: dubbele externalId in het bestand.`);
      externalIds.add(id.trim());
    }
  }
  return data as unknown as ProspectImportFile;
}

/** Exact identities only: a partial search result must never receive somebody else's history. */
export function matchesProspectIdentity(existing: Prospect, incoming: ProspectInput): boolean {
  const normalize = (value: string | null | undefined) => value?.trim().replace(/^@/, '').toLowerCase() || '';
  const email = normalize(incoming.email);
  const instagram = normalize(incoming.instagramHandle);
  return (!!email && normalize(existing.email) === email)
    || (!!instagram && normalize(existing.instagramHandle) === instagram);
}

/** Reserve a future slot or record a verified Gmail schedule. Neither action sends a message. */
export async function recordImportedActivity(
  api: Pick<ProspectApi, 'reserveEmail' | 'record'>,
  prospectId: number,
  activity: ProspectActivityInput,
  existingExternalIds: ReadonlySet<string | null>,
): Promise<void> {
  if (activity.status === 'RESERVED' || activity.status === 'SCHEDULED') {
    if (activity.channel !== 'EMAIL' || activity.type !== 'OUTREACH' || !activity.externalId) {
      throw new Error('Een gereserveerde of ingeplande e-mail heeft EMAIL / OUTREACH en een vaste referentie nodig.');
    }
    if (activity.status === 'RESERVED' || !existingExternalIds.has(activity.externalId)) {
      await api.reserveEmail(prospectId, {
        externalId: activity.externalId, subject: activity.subject, body: activity.body,
        attachmentName: activity.attachmentName, sourceUrl: activity.sourceUrl,
        scheduledFor: activity.occurredAt,
      });
    }
    if (activity.status === 'RESERVED') return;
  }
  await api.record(prospectId, activity);
}
