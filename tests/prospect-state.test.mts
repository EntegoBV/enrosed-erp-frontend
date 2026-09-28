import assert from 'node:assert/strict';
import test from 'node:test';
import { blankProspect, brusselsDate, instagramLink, prospectPayload, prospectValidation, prospectWebLink } from '../src/app/features/prospects/prospect-state.ts';
import { matchesProspectIdentity, parseProspectImport } from '../src/app/features/prospects/prospect-import.ts';
import type { Prospect } from '../src/app/core/api/prospect-api.ts';

const prospect = { ...blankProspect(), businessName: 'Fleurs Exemple', countryCode: 'FR', email: 'info@example.fr', instagramHandle: 'fleurs.exemple' };
const activity = { channel: 'INSTAGRAM', type: 'COMMENT', status: 'COMPLETED', occurredAt: '2026-09-28T09:00:00Z', externalId: 'ig-comment-123', body: 'A recorded public comment.' };
const bundle = () => ({ version: 1, prospects: [{ prospect, activities: [{ ...activity }] }] });

test('daily email dates use Brussels around midnight and daylight-saving boundaries', () => {
  assert.equal(brusselsDate(new Date('2026-09-28T22:01:00Z')), '2026-09-29');
  assert.equal(brusselsDate(new Date('2026-12-31T23:01:00Z')), '2027-01-01');
  assert.equal(brusselsDate(new Date('2026-03-29T00:30:00Z')), '2026-03-29');
});

test('research links cannot produce script or data navigation', () => {
  assert.equal(prospectWebLink('javascript:alert(1)'), null);
  assert.equal(prospectWebLink('data:text/html,hello'), null);
  assert.equal(prospectWebLink('https://example.fr/catalogue'), 'https://example.fr/catalogue');
  assert.equal(prospectWebLink('example.fr'), 'https://example.fr/');
  assert.equal(instagramLink('@fleurs.exemple'), 'https://www.instagram.com/fleurs.exemple/');
  assert.equal(instagramLink('https://instagram.com/fleurs.exemple'), null);
});

test('prospect validation rejects missing identity details and normalizes a safe payload', () => {
  assert.ok(prospectValidation(blankProspect()));
  assert.ok(prospectValidation({ ...prospect, email: 'invalid' }));
  const payload = prospectPayload({ ...prospect, countryCode: ' fr ', businessName: ' Fleurs Exemple ', instagramHandle: '@fleurs.exemple', website: 'example.fr', notes: '' });
  assert.equal(payload.countryCode, 'FR');
  assert.equal(payload.businessName, 'Fleurs Exemple');
  assert.equal(payload.instagramHandle, 'fleurs.exemple');
  assert.equal(payload.website, 'https://example.fr/');
  assert.equal(payload.notes, null);
  assert.equal(prospectValidation(payload), null);
});

test('historical contact import requires stable, non-duplicate activity identities before any write', () => {
  assert.equal(parseProspectImport(JSON.stringify(bundle())).prospects.length, 1);
  const duplicated = bundle(); duplicated.prospects[0].activities.push({ ...activity });
  assert.throws(() => parseProspectImport(JSON.stringify(duplicated)), /dubbele externalId/);
  const missing = bundle(); missing.prospects[0].activities[0].externalId = '';
  assert.throws(() => parseProspectImport(JSON.stringify(missing)), /externalId/);
  const scheduled = bundle(); scheduled.prospects[0].activities[0].status = 'SCHEDULED';
  assert.throws(() => parseProspectImport(JSON.stringify(scheduled)), /alleen EMAIL/);
  scheduled.prospects[0].activities[0].channel = 'EMAIL';
  scheduled.prospects[0].activities[0].type = 'OUTREACH';
  assert.equal(parseProspectImport(JSON.stringify(scheduled)).prospects[0].activities[0].status, 'SCHEDULED');
  assert.throws(() => parseProspectImport('{no'), /geldige JSON/);
});

test('import enforces limits and rejects non-text activity fields', () => {
  assert.throws(() => parseProspectImport(JSON.stringify({ version: 1, prospects: Array.from({ length: 251 }, () => bundle().prospects[0]) })), /250/);
  const tooMany = bundle(); tooMany.prospects[0].activities = Array.from({ length: 2001 }, (_, i) => ({ ...activity, externalId: 'id-' + i }));
  assert.throws(() => parseProspectImport(JSON.stringify(tooMany)), /2000/);
  const bad = bundle() as any; bad.prospects[0].activities[0].body = { html: 'invalid' };
  assert.throws(() => parseProspectImport(JSON.stringify(bad)), /moet tekst/);
});

test('partial search results never receive another company contact history', () => {
  const existing = { ...prospect, id: 1, createdAt: '', updatedAt: '', lastActivityAt: null, lastContactAt: null } satisfies Prospect;
  assert.equal(matchesProspectIdentity(existing, { ...prospect, email: 'INFO@EXAMPLE.FR', instagramHandle: null }), true);
  assert.equal(matchesProspectIdentity(existing, { ...prospect, email: null, instagramHandle: '@FLEURS.EXEMPLE' }), true);
  assert.equal(matchesProspectIdentity(existing, { ...prospect, email: 'other@example.fr', instagramHandle: 'fleurs' }), false);
  assert.equal(matchesProspectIdentity(existing, { ...prospect, email: null, instagramHandle: null }), false);
});

test('verified scheduled-email import reserves the exact date before recording and never reserves a known ID again', async () => {
  const { recordImportedActivity } = await import('../src/app/features/prospects/prospect-import.ts');
  const calls: any[] = [];
  const api = { reserveEmail: async (id: number, input: any) => { calls.push(['reserve', id, input]); return {} as any; }, record: async (id: number, input: any) => { calls.push(['record', id, input]); return {} as any; } };
  const scheduled: any = { ...activity, channel: 'EMAIL', type: 'OUTREACH', status: 'SCHEDULED', subject: 'Hello', occurredAt: '2026-10-01T09:00:00Z', externalId: 'gmail:schedule-1', attachmentName: 'catalogue.pdf', sourceUrl: null };
  await recordImportedActivity(api, 9, scheduled, new Set());
  assert.deepEqual(calls.map(c => c[0]), ['reserve', 'record']);
  assert.equal(calls[0][2].scheduledFor, scheduled.occurredAt);
  assert.equal(calls[0][2].externalId, scheduled.externalId);
  assert.equal(calls[0][2].attachmentName, 'catalogue.pdf');
  calls.length = 0;
  await recordImportedActivity(api, 9, scheduled, new Set([scheduled.externalId]));
  assert.deepEqual(calls.map(c => c[0]), ['record']);
});

test('quota failure prevents scheduled recording; idempotency conflicts remain visible', async () => {
  const { recordImportedActivity } = await import('../src/app/features/prospects/prospect-import.ts');
  let recorded = false;
  const scheduled: any = { ...activity, channel: 'EMAIL', type: 'OUTREACH', status: 'SCHEDULED' };
  const api = { reserveEmail: async () => { throw new Error('quota'); }, record: async () => { recorded = true; return {} as any; } };
  await assert.rejects(recordImportedActivity(api, 9, scheduled, new Set()), /quota/);
  assert.equal(recorded, false);
  const conflictApi = { ...api, record: async () => { throw new Error('conflict'); } };
  await assert.rejects(recordImportedActivity(conflictApi, 9, scheduled, new Set([scheduled.externalId])), /conflict/);
});

test('reservation imports accept only EMAIL OUTREACH and retain the intended time', () => {
  const data = bundle();
  const entry = data.prospects[0].activities[0];
  entry.status = 'RESERVED';
  assert.throws(() => parseProspectImport(JSON.stringify(data)), /alleen EMAIL/);
  entry.channel = 'EMAIL';
  assert.throws(() => parseProspectImport(JSON.stringify(data)), /alleen EMAIL/);
  entry.type = 'OUTREACH';
  entry.occurredAt = '2026-10-01T09:00:00Z';
  assert.equal(parseProspectImport(JSON.stringify(data)).prospects[0].activities[0].occurredAt, entry.occurredAt);
});

test('reserved import checks the exact future slot without recording a Gmail schedule', async () => {
  const { recordImportedActivity } = await import('../src/app/features/prospects/prospect-import.ts');
  const calls: any[] = [];
  const api = { reserveEmail: async (id: number, input: any) => { calls.push(['reserve', id, input]); return {} as any; }, record: async (id: number, input: any) => { calls.push(['record', id, input]); return {} as any; } };
  const reserved: any = { ...activity, channel: 'EMAIL', type: 'OUTREACH', status: 'RESERVED', subject: 'Hello', occurredAt: '2026-10-01T09:00:00Z', externalId: 'gmail:future-1', attachmentName: 'catalogue.pdf', sourceUrl: 'https://example.fr/' };
  for (const known of [new Set<string>(), new Set([reserved.externalId])]) {
    calls.length = 0;
    await recordImportedActivity(api, 9, reserved, known);
    assert.deepEqual(calls, [['reserve', 9, { externalId: reserved.externalId, subject: reserved.subject, body: reserved.body, attachmentName: reserved.attachmentName, sourceUrl: reserved.sourceUrl, scheduledFor: reserved.occurredAt }]]);
  }
});

test('reserved imports surface quota or closed-reservation failures without recording', async () => {
  const { recordImportedActivity } = await import('../src/app/features/prospects/prospect-import.ts');
  let recorded = false;
  const reserved: any = { ...activity, channel: 'EMAIL', type: 'OUTREACH', status: 'RESERVED' };
  const api = { reserveEmail: async () => { throw new Error('quota or closed'); }, record: async () => { recorded = true; return {} as any; } };
  await assert.rejects(recordImportedActivity(api, 9, reserved, new Set([reserved.externalId])), /quota or closed/);
  assert.equal(recorded, false);
  await assert.rejects(recordImportedActivity(api, 9, { ...reserved, channel: 'INSTAGRAM' }, new Set()), /EMAIL \/ OUTREACH/);
});
