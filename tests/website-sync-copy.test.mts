import assert from 'node:assert/strict';
import test from 'node:test';
import type { WebsiteRebuildState, WebsiteRebuildStatus } from '../src/app/core/api/models.ts';
import { isTranslationPending, shortMoment, websiteSyncCopy } from '../src/app/features/settings/website-sync-copy.ts';

const now = new Date(2026, 9, 17, 9, 30);
const at = (day: number, hour: number, minute: number, year = 2026) => new Date(year, 9, day, hour, minute).toISOString();

function status(state: WebsiteRebuildState, patch: Partial<WebsiteRebuildStatus> = {}): WebsiteRebuildStatus {
  return { status: state, queuedAt: null, lastAttemptAt: null, hookAcceptedAt: null, liveAt: null, nextAttemptAt: null,
    currentRevision: null, liveRevision: null, lastError: null, ...patch };
}

const copy = (value: WebsiteRebuildStatus | null, patch: Partial<Parameters<typeof websiteSyncCopy>[0]> = {}) =>
  websiteSyncCopy({ status: value, loading: false, loadError: null, pollEnded: false, now, ...patch });

test('moments are short: the time today, day and month this year, the year only before', () => {
  assert.equal(shortMoment(at(17, 8, 5), now), '08:05');
  assert.equal(shortMoment(at(16, 23, 40), now), '16/10 23:40');
  assert.equal(shortMoment(at(16, 23, 40, 2025), now), '16/10/2025 23:40');
  assert.equal(shortMoment(null, now), null);
  assert.equal(shortMoment('nonsense', now), null);
});

test('every state has one label, a moment and at most one action', () => {
  const live = copy(status('LIVE', { liveAt: at(16, 23, 40) }));
  assert.deepEqual([live.tone, live.label, live.moment, live.actionLabel, live.needsBanner], ['ok', 'Live', 'sinds 16/10 23:40', 'Vernieuwen', false]);
  assert.equal(live.detail, 'De website draait op de laatste opgeslagen versie.');
  const queued = copy(status('QUEUED', { queuedAt: at(17, 9, 1) }));
  assert.deepEqual([queued.tone, queued.label, queued.moment, queued.action], ['warn', 'In wachtrij', 'sinds 09:01', null]);
  const triggered = copy(status('TRIGGERED', { hookAcceptedAt: at(17, 9, 2) }));
  assert.deepEqual([triggered.label, triggered.moment], ['Wordt bijgewerkt', 'update geaccepteerd 09:02']);
  assert.equal(triggered.shortLabel, 'Bezig', 'a narrow figure tile gets a short word');
  for (const value of [live, queued, triggered]) assert.ok(value.shortLabel.length <= 11, value.shortLabel);
  const failed = copy(status('FAILED_OR_STALE', { lastAttemptAt: at(17, 9, 3), lastError: 'Hook 500', nextAttemptAt: at(17, 9, 13) }));
  assert.deepEqual([failed.tone, failed.label, failed.moment, failed.actionLabel, failed.error, failed.nextAttempt],
    ['danger', 'Actie nodig', 'laatste poging 09:03', 'Opnieuw proberen', 'Hook 500', 'volgende automatische poging 09:13']);
  const off = copy(status('NOT_CONFIGURED'));
  assert.deepEqual([off.tone, off.label, off.moment], ['muted', 'Niet automatisch', 'de website wordt niet vanzelf bijgewerkt']);
  assert.doesNotMatch(off.detail, /Vercel|Railway|Deploy Hook/, 'the set-up text lives only in Publicatie');
});

test('a stopped poll is shown, never a silent spinner', () => {
  const stopped = copy(status('TRIGGERED', { hookAcceptedAt: at(17, 9, 2) }), { pollEnded: true });
  assert.equal(stopped.moment, 'controle gestopt na 5 minuten');
  assert.equal(stopped.actionLabel, 'Status vernieuwen');
  assert.equal(copy(status('LIVE'), { pollEnded: true }).moment, null);
});

test('missing translations, a failed load and the first load', () => {
  const pending = status('FAILED_OR_STALE', { lastError: 'Missing required translation for FR' });
  assert.equal(isTranslationPending(pending), true);
  const waiting = copy(pending);
  assert.deepEqual([waiting.tone, waiting.label, waiting.action, waiting.actionLabel], ['warn', 'Wacht op vertalingen', 'todo', 'Naar Te doen']);
  const error = copy(status('LIVE'), { loadError: 'Geen verbinding' });
  assert.deepEqual([error.tone, error.label, error.detail, error.actionLabel], ['danger', 'Status niet geladen', 'Geen verbinding', 'Opnieuw laden']);
  const first = copy(null, { loading: true });
  assert.deepEqual([first.label, first.needsBanner], ['Status ophalen', false]);
});
