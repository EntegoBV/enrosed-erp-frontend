import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import type { ContainerTracking } from '../src/app/core/api/container-tracking-models.ts';
import {
  trackingArrived, trackingMapLink, trackingMapUrl, trackingRows, trackingStale, trackingTime,
  trackingWebUrl, validTrackingPosition,
  normalizedVesselImo, vesselMapFrameUrl, trackingRefreshNotice,
} from '../src/app/features/purchasing/container-tracking-model.ts';
import { phoneTabForUrl } from '../src/app/core/platform/phone-tabs.ts';
import { parentOf } from '../src/app/core/platform/page-parent.ts';
import { returnLabel, screenLabel } from '../src/app/core/platform/return-label.ts';

const row = (changes: Partial<ContainerTracking> = {}): ContainerTracking => ({
  orderId: 1, orderNumber: 'PO-1', containerName: 'Herfst', trackingReference: 'MSCU1234567',
  orderStatus: 'ONDERWEG', status: 'SAILING', statusLabel: 'Onderweg', carrier: 'MSC', vessel: 'Test vessel',
  eta: null, location: 'Rotterdam', position: null, route: [], events: [],
  checkedAt: null, updatedAt: null, nextCheckAt: null, changedAt: null, error: null, trackingUrl: null,
  source: 'SHIPSGO', vesselImo: null, automatic: true,
  ...changes,
});

test('filters preserve unconfigured and unsupported references and distinguish arrival from sailing', () => {
  const rows = [row(), row({ orderId: 2, status: 'ARRIVED' }), row({ orderId: 3, orderStatus: 'ONTVANGEN' }),
    row({ orderId: 4, status: 'UNSUPPORTED' }), row({ orderId: 5, status: 'UNCONFIGURED' })];
  assert.equal(trackingRows(rows, 'all', '').length, 5);
  assert.deepEqual(trackingRows(rows, 'active', '').map((item) => item.orderId), [1, 4, 5]);
  assert.deepEqual(trackingRows(rows, 'arrived', '').map((item) => item.orderId), [2, 3]);
  assert.equal(trackingArrived(row({ status: 'DISCHARGED' })), true);
  assert.equal(trackingArrived(row({ status: 'GATE_OUT' })), true);
  assert.equal(trackingArrived(row({ status: 'EMPTY_RETURN' })), true);
  assert.equal(trackingArrived(row({ status: 'UNTRACKED' })), false);
});

test('search combines words across names, references, ports and carriers without losing the selected filter', () => {
  const rows = [row(), row({ orderId: 2, status: 'ARRIVED', vessel: 'Other', location: 'Antwerpen' })];
  assert.deepEqual(trackingRows(rows, 'all', '  HERFST   rotter MSCU ').map((item) => item.orderId), [1]);
  assert.equal(trackingRows(rows, 'active', 'antwerpen').length, 0);
  assert.equal(trackingRows(rows, 'all', 'unknown').length, 0);
});

test('IMO numbers require seven digits and the weighted check digit before any vessel is linked', () => {
  assert.equal(normalizedVesselImo('9811000'), '9811000');
  assert.equal(normalizedVesselImo('  IMO 9722716  '), '9722716');
  assert.equal(normalizedVesselImo('IMO: 9506291'), '9506291');
  for (const input of [null, undefined, '', '0000000', '9811001', '981100', '09811000',
    '98110O0', '9811000&lat=1', 'ship 9811000', '９８１１０００', '981 1000']) {
    assert.equal(normalizedVesselImo(input), null, String(input));
  }
});

test('public vessel maps use the official fixed-host widget with only a validated IMO', () => {
  const page = 'https://enrosed-erp-frontend-test.vercel.app/purchasing/tracking?order=33';
  const url = new URL(vesselMapFrameUrl('9722716', page)!);
  assert.equal(url.origin, 'https://www.vesselfinder.com');
  assert.equal(url.pathname, '/aismap');
  assert.equal(url.searchParams.get('imo'), '9722716');
  assert.equal(url.searchParams.get('track'), 'true');
  assert.equal(url.searchParams.get('names'), 'true');
  assert.equal(url.searchParams.get('ra'), 'https://enrosed-erp-frontend-test.vercel.app/purchasing/tracking');
  assert.equal(vesselMapFrameUrl('9722717', page), null, 'bad checksum must not target a different ship');
  assert.equal(vesselMapFrameUrl('9722716&imo=9811000', page), null);
  assert.equal(vesselMapFrameUrl('9722716', 'javascript:alert(1)'), null);
  assert.equal(vesselMapFrameUrl(null, page), null);
});

test('public ship events never imply that a container has arrived', () => {
  const tracked = row({ source: 'VOYDAR', status: 'VESSEL_TRACKING', vesselImo: '9722716', location: 'Rotterdam' });
  assert.equal(trackingArrived(tracked), false);
  assert.equal(trackingArrived({ ...tracked, orderStatus: 'ONTVANGEN' }), true);
  assert.equal(trackingRows([tracked], 'active', '9722716').length, 1);
});

test('a map requires finite geographic coordinates; zero is a valid coordinate, not a missing value', () => {
  assert.equal(trackingMapUrl(null), null);
  for (const position of [
    { lat: NaN, lon: 0 }, { lat: 91, lon: 0 }, { lat: 0, lon: Infinity }, { lat: 0, lon: -181 },
  ]) assert.equal(trackingMapUrl({ ...position, kind: 'VESSEL', recordedAt: null }), null);
  const position = { lat: 0, lon: 0, kind: 'VESSEL' as const, recordedAt: null };
  assert.equal(validTrackingPosition(position), true);
  const url = new URL(trackingMapUrl(position)!);
  assert.equal(url.origin, 'https://www.openstreetmap.org');
  assert.equal(url.pathname, '/export/embed.html');
  assert.equal(url.searchParams.get('marker'), '0,0');
  assert.equal(url.searchParams.get('bbox'), '-3,-3,3,3');
  assert.equal(trackingMapLink(position), 'https://www.openstreetmap.org/?mlat=0&mlon=0#map=6/0/0');
});

test('last-event locations use a local map and bounds stay valid at the dateline', () => {
  const position = { lat: 51.95, lon: 179.95, kind: 'LAST_EVENT' as const, recordedAt: null };
  const url = new URL(trackingMapUrl(position)!);
  const bounds = url.searchParams.get('bbox')!.split(',').map(Number);
  assert.equal(bounds[2], 180);
  assert.equal(url.searchParams.get('marker'), '51.95,179.95');
  assert.ok(trackingMapLink(position)!.includes('#map=10/'));
});

test('tracking links reject script, data, relative and credential-bearing URLs', () => {
  for (const value of ['javascript:alert(1)', 'data:text/html,hello', '//example.com', '/purchasing',
    'https://name:secret@example.com', 'ftp://example.com', 'just a reference', '']) {
    assert.equal(trackingWebUrl(value), null, value);
  }
  assert.equal(trackingWebUrl(' https://shipsgo.com/container-tracking '), 'https://shipsgo.com/container-tracking');
  assert.equal(trackingWebUrl('http://carrier.example/track?id=123'), 'http://carrier.example/track?id=123');
});

test('a failed latest attempt never makes old successful data fresh', () => {
  const now = Date.parse('2026-10-26T12:00:00Z');
  assert.equal(trackingStale(row({ updatedAt: '2026-10-26T06:00:00Z' }), now), false, 'scheduler grace');
  assert.equal(trackingStale(row({ updatedAt: '2026-10-26T05:49:00Z' }), now), true);
  assert.equal(trackingStale(row({ updatedAt: '2026-10-26T11:59:00Z', error: 'Provider unavailable' }), now), true);
  assert.equal(trackingStale(row(), now), false, 'unconfigured data is absent, not stale');
  assert.equal(trackingStale(row({ updatedAt: 'invalid' }), now), false);
});

test('a response reused during cooldown does not claim that a new provider check ran', () => {
  const before = row({ checkedAt: '2026-10-26T12:00:00Z', changedAt: '2026-10-25T12:00:00Z' });
  assert.match(trackingRefreshNotice(before, before)!, /geen nieuwe controle uitgevoerd/);
  assert.equal(trackingRefreshNotice(before, { ...before, error: 'Not available' }), null);
  assert.match(trackingRefreshNotice(before, { ...before, checkedAt: '2026-10-26T12:16:00Z' })!, /Controle afgerond/);
  assert.match(trackingRefreshNotice(before, { ...before, checkedAt: '2026-10-26T12:16:00Z', changedAt: '2026-10-26T12:16:00Z' })!, /wijziging gevonden/);
});

test('times are shown in Belgium, with explicit missing/invalid date wording', () => {
  assert.equal(trackingTime(null), 'Nog niet bekend');
  assert.equal(trackingTime('garbage'), 'Nog niet bekend');
  assert.match(trackingTime('2026-10-26T12:00:00Z'), /13:00/);
  assert.match(trackingTime('2026-07-26T12:00:00Z'), /14:00/);
  assert.ok(!trackingTime('2026-10-26T12:00:00Z', false).includes('13:00'));
});

test('tracking is an authenticated lazy page before the purchase-id route, with the right navigation labels', () => {
  const routes = readFileSync(new URL('../src/app/app.routes.ts', import.meta.url), 'utf8');
  const at = routes.indexOf("path: 'purchasing/tracking'");
  assert.ok(at > 0 && at < routes.indexOf("path: 'purchasing/:id'"));
  assert.match(routes.slice(at, routes.indexOf('\n  },', at)), /canActivate: \[authGuard\]/);
  assert.match(routes.slice(at, routes.indexOf('\n  },', at)), /m\.ContainerTrackingPage/);
  assert.equal(phoneTabForUrl('/purchasing/tracking?order=33'), 'purchasing');
  assert.equal(parentOf('/purchasing/tracking')?.url, '/purchasing');
  assert.equal(screenLabel('/purchasing/tracking?order=33'), 'Track & trace');
  assert.equal(returnLabel('/purchasing/tracking?order=33'), 'Track & trace');
});
