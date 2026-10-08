import assert from 'node:assert/strict';
import test from 'node:test';
import { messageOf, readableFailure } from '../src/app/core/api/errors.ts';

const NO_CONNECTION = 'Geen verbinding met de server. Controleer uw internetverbinding en probeer opnieuw.';

test('a dropped connection reads in Dutch, never as the browser text "Failed to fetch"', () => {
  /* The fetch backend answers status 0 with the TypeError as body. */
  assert.equal(messageOf({ status: 0, error: new TypeError('Failed to fetch') }, 'Bewaren is niet gelukt.'), NO_CONNECTION);
  assert.equal(messageOf({ status: 0, error: { message: 'Failed to fetch' } }, 'Bewaren is niet gelukt.'), NO_CONNECTION);
  assert.equal(messageOf({ status: 0, error: null }, 'Bewaren is niet gelukt.'), NO_CONNECTION);
  assert.equal(messageOf({ error: new TypeError('Load failed') }, 'Bewaren is niet gelukt.'), NO_CONNECTION);
});

test('the explanation of the server still comes first when there is an answer', () => {
  assert.equal(messageOf({ status: 409, error: { message: ' Deze telling is al geboekt ' } }, 'x'), 'Deze telling is al geboekt');
  assert.equal(messageOf({ status: 422, error: { detail: 'Vul een reden in' } }, 'x'), 'Vul een reden in');
  assert.equal(messageOf({ status: 500, error: null }, 'De afsluiting kon niet worden geladen.'), 'De afsluiting kon niet worden geladen.');
  assert.equal(messageOf({ status: 404, error: null }, 'x'), 'De gevraagde gegevens bestaan niet meer of zijn verplaatst.');
});

test('the refusal of a download is read out of its Blob', async () => {
  /* responseType blob: the JSON the file route answered arrives as a Blob. */
  const body = new Blob([JSON.stringify({ status: 404, code: 'BESTAND_ONTBREEKT', message: 'Het bestand van deze afsluiting ontbreekt' })],
    { type: 'application/json' });
  const failure = { status: 404, error: body };
  assert.equal(messageOf(failure, 'De PDF kon niet worden gedownload.'), 'De gevraagde gegevens bestaan niet meer of zijn verplaatst.');
  const readable = await readableFailure(failure);
  assert.equal(messageOf(readable, 'De PDF kon niet worden gedownload.'), 'Het bestand van deze afsluiting ontbreekt');
  assert.equal((readable as { error: { code: string } }).error.code, 'BESTAND_ONTBREEKT');
  /* A JSON Blob that cannot be parsed, or an HTML error page: the status sentence or the fallback, never the raw body. */
  const broken = await readableFailure({ status: 500, error: new Blob(['{oops'], { type: 'application/json' }) });
  assert.equal(messageOf(broken, 'De PDF kon niet worden gedownload.'), 'De PDF kon niet worden gedownload.');
  const page = await readableFailure({ status: 502, error: new Blob(['<!doctype html><html><body>Bad gateway</body></html>'], { type: 'text/html' }) });
  assert.equal(messageOf(page, 'De PDF kon niet worden gedownload.'), 'De PDF kon niet worden gedownload.');
  /* Any other failure comes back untouched. */
  const plain = { status: 409, error: { message: 'Al definitief' } };
  assert.equal(await readableFailure(plain), plain);
  assert.equal(await readableFailure(null), null);
});
