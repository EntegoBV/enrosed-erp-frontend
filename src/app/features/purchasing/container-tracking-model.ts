import type { ContainerTracking, TrackingPosition, TrackingRecognised } from '../../core/api/container-tracking-models';
import { recogniseTrackingReference, validContainerNumber } from './tracking-reference';

export type TrackingFilter = 'all' | 'active' | 'arrived';

/** Arrival at the port is distinct from receipt in ENROSED, but both leave the sailing list. */
export function trackingArrived(row: Pick<ContainerTracking, 'orderStatus' | 'status'>): boolean {
  return row.orderStatus === 'ONTVANGEN' || ['ARRIVED', 'DISCHARGED', 'DELIVERED', 'GATE_OUT', 'EMPTY_RETURN'].includes(row.status);
}

export function trackingRows(rows: readonly ContainerTracking[], filter: TrackingFilter, query: string): ContainerTracking[] {
  const words = query.trim().toLocaleLowerCase('nl').split(/\s+/).filter(Boolean);
  return rows.filter((row) => {
    if (filter === 'active' && trackingArrived(row)) return false;
    if (filter === 'arrived' && !trackingArrived(row)) return false;
    const haystack = [row.containerName, row.orderNumber, row.trackingReference, row.carrier, row.vessel, row.vesselImo, row.location]
      .filter(Boolean).join(' ').toLocaleLowerCase('nl');
    return words.every((word) => haystack.includes(word));
  });
}

/** IMO ship numbers contain six digits and a weighted check digit; never turn arbitrary text into a ship. */
export function normalizedVesselImo(value: string | null | undefined): string | null {
  const digits = (value ?? '').trim().replace(/^IMO\s*:?\s*/i, '');
  if (!/^[0-9]{7}$/.test(digits) || digits === '0000000') return null;
  const sum = [...digits.slice(0, 6)].reduce((total, digit, index) => total + Number(digit) * (7 - index), 0);
  return sum % 10 === Number(digits[6]) ? digits : null;
}

/** Matches the public VesselFinder widget's documented IMO mode; never fetches/extracts its positions. */
export function vesselMapFrameUrl(imo: string | null | undefined, pageUrl: string): string | null {
  const number = normalizedVesselImo(imo);
  const referrer = trackingWebUrl(pageUrl);
  if (!number || !referrer) return null;
  const page = new URL(referrer);
  const params = new URLSearchParams({
    zoom: 'undefined', lat: 'undefined', lon: 'undefined', width: '100%', height: '400',
    names: 'true', imo: number, track: 'true', fleet: 'false', fleet_name: 'false',
    fleet_hide_old_positions: 'false', clicktoact: 'false', store_pos: 'true', ra: page.origin + page.pathname,
  });
  return `https://www.vesselfinder.com/aismap?${params}`;
}

/** Only explicit web URLs may leave the app; never trust a stored reference as a resource URL. */
export function trackingWebUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

export interface CarrierLookup {
  carrier: 'Evergreen' | 'ONE' | 'CMA CGM';
  url: string;
  reference: string;
  referenceLabel: 'B/L' | 'Container' | 'Referentie';
}

/** ISO 6346 check digit. Identifying a box never identifies its contractual carrier. */
export function validatedContainerReference(raw: string): string | null {
  const candidates = [...raw.toUpperCase().matchAll(/(?<![A-Z0-9])([A-Z]{3}[UJZ])[ -]?([0-9]{6})[ -]?([0-9])(?![A-Z0-9])/g)]
    .map((match) => match[1] + match[2] + match[3]);
  const unique = [...new Set(candidates)];
  return unique.length === 1 && validContainerNumber(unique[0]) ? unique[0] : null;
}

/** Manual carrier portals from explicit B/L/carrier evidence only, never a vessel name or box prefix. */
export function carrierLookup(row: Pick<ContainerTracking, 'trackingReference' | 'carrier'>): CarrierLookup | null {
  const raw = row.trackingReference.trim().toUpperCase();
  const evergreen = raw.match(/\bEGLV([0-9]{12})\b/);
  const one = raw.match(/\b(ONEY[A-Z0-9]{6,20})\b/);
  const cmaBl = raw.match(/\b(?:B\/L|BOL|BL)\s*:?\s*(SHZ[A-Z0-9]{6,16})\b/);
  const houseBl = cmaBl && /\bHOUSE\s*$/.test(raw.slice(0, cmaBl.index));
  const cma = (!!cmaBl && !houseBl) || /^CMA[ -]?CGM$/.test((row.carrier ?? '').trim().toUpperCase())
    || /\b(?:REDERIJ|CARRIER)\s*:?\s*CMA[ -]?CGM\b/.test(raw) || /^CMA[ -]?CGM\s*(?:[:;|·]|$)/.test(raw);
  if ([!!evergreen, !!one, !!cma].filter(Boolean).length !== 1) return null;
  if (evergreen) return {
    carrier: 'Evergreen', url: 'https://ct.shipmentlink.com/servlet/TDB1_CargoTracking.do',
    reference: evergreen[1], referenceLabel: 'B/L',
  };
  const container = validatedContainerReference(raw);
  if (one) return {
    carrier: 'ONE', url: 'https://www.one-line.com/one-ecom/manage-shipment/cargo-tracking'
      + (container ? `?trakNoParam=${container}&trakNoTpCdParam=C` : ''),
    reference: container ?? one[1], referenceLabel: container ? 'Container' : 'B/L',
  };
  return {
    carrier: 'CMA CGM', url: 'https://www.cma-cgm.com/ebusiness/tracking',
    reference: cmaBl?.[1] ?? container ?? row.trackingReference.trim(),
    referenceLabel: cmaBl ? 'B/L' : container ? 'Container' : 'Referentie',
  };
}

export function validTrackingPosition(position: TrackingPosition | null | undefined): position is TrackingPosition {
  return !!position && Number.isFinite(position.lat) && Number.isFinite(position.lon)
    && Math.abs(position.lat) <= 90 && Math.abs(position.lon) <= 180;
}

/** The sole iframe host is fixed here. All variable parts are validated numeric coordinates. */
export function trackingMapUrl(position: TrackingPosition | null | undefined): string | null {
  if (!validTrackingPosition(position)) return null;
  const radius = position.kind === 'VESSEL' ? 3 : 0.3;
  const bbox = [Math.max(-180, position.lon - radius), Math.max(-90, position.lat - radius),
    Math.min(180, position.lon + radius), Math.min(90, position.lat + radius)];
  const params = new URLSearchParams({ bbox: bbox.join(','), layer: 'mapnik', marker: `${position.lat},${position.lon}` });
  return `https://www.openstreetmap.org/export/embed.html?${params}`;
}

export function trackingMapLink(position: TrackingPosition | null | undefined): string | null {
  if (!validTrackingPosition(position)) return null;
  return `https://www.openstreetmap.org/?mlat=${position.lat}&mlon=${position.lon}#map=${position.kind === 'VESSEL' ? 6 : 10}/${position.lat}/${position.lon}`;
}

/** The server's reading of the reference; an older server sends none and the same rule runs here. */
export function recognisedOf(row: Pick<ContainerTracking, 'trackingReference' | 'recognised'>): TrackingRecognised {
  return row.recognised ?? recogniseTrackingReference(row.trackingReference);
}

/** The expected arrival the screens show: the order's own date (one rule for list, panel and order). */
export function trackingArrival(row: Pick<ContainerTracking, 'orderExpectedArrival' | 'source' | 'eta'>): string | null {
  return row.orderExpectedArrival !== undefined ? row.orderExpectedArrival ?? null : row.source !== 'VOYDAR' ? row.eta : null;
}

/** The last attempt failed. Older servers: the error of a linked source, as the panel showed it. */
export function trackingFailure(row: Pick<ContainerTracking, 'failure' | 'error' | 'source'>): string | null {
  return row.failure !== undefined ? row.failure || null : row.source && row.error ? row.error : null;
}

export interface TrackingStatusView { text: string; tone: 'ok' | 'warn' | 'muted' }

/** One status for the overview list and the panel. The server's status codes and labels stay as they are. */
export function trackingStatus(row: ContainerTracking, configured = true): TrackingStatusView {
  if (row.orderStatus === 'ONTVANGEN') return { text: 'Ontvangen', tone: 'ok' };
  if (trackingArrived(row)) return { text: row.statusLabel, tone: 'ok' };
  const failed = configured && !!trackingFailure(row);
  if (row.source || row.dateSource) return { text: row.statusLabel, tone: failed ? 'warn' : 'muted' };
  if (failed) return { text: 'Controle niet gelukt', tone: 'warn' };
  const seen = recognisedOf(row);
  if (!seen.evergreenBl && (seen.kind === 'UNKNOWN' || seen.kind === 'MULTIPLE')) return { text: 'Referentie niet herkend', tone: 'warn' };
  if (!row.automatic) return { text: 'Schip nog niet gekoppeld', tone: 'muted' };
  return { text: row.checkedAt ? 'Nog geen gegevens' : 'Eerste controle afwachten', tone: 'muted' };
}

export interface TrackingMove {
  /** The date that stood before tracking moved it. */
  from: string;
  days: number;
  later: boolean;
  /** "3 dagen later" */
  text: string;
  /** "+3 d" */
  short: string;
  /** News: two days or more and moved in the last 14 days. Only news is tinted; after that it reads muted. */
  news: boolean;
}

/** What tracking did to the expected arrival, against the planning that stood; null when it did not move it. */
export function trackingMove(row: Pick<ContainerTracking, 'orderStatus' | 'arrivalMovedFrom' | 'arrivalMovedAt' | 'arrivalMovedDays'> | null | undefined,
    now = Date.now()): TrackingMove | null {
  if (!row || row.orderStatus === 'ONTVANGEN' || !row.arrivalMovedFrom || !row.arrivalMovedDays) return null;
  const days = Math.abs(row.arrivalMovedDays), later = row.arrivalMovedDays > 0;
  const at = Date.parse(row.arrivalMovedAt ?? '');
  return {
    from: row.arrivalMovedFrom, days: row.arrivalMovedDays, later,
    text: `${days} ${days === 1 ? 'dag' : 'dagen'} ${later ? 'later' : 'eerder'}`, short: `${later ? '+' : '−'}${days} d`,
    news: days >= 2 && Number.isFinite(at) && now - at <= 14 * 86_400_000,
  };
}

/** "zojuist", "12 min geleden", "3 u geleden" (under 48 h), "4 d geleden"; null without a time or for a future one. */
export function trackingAge(value: string | null | undefined, now = Date.now()): string | null {
  const at = Date.parse(value ?? '');
  if (!Number.isFinite(at) || at > now + 60_000) return null;
  const minutes = Math.max(0, Math.floor((now - at) / 60_000));
  if (minutes < 2) return 'zojuist';
  if (minutes < 60) return `${minutes} min geleden`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours} u geleden` : `${Math.floor(hours / 24)} d geleden`;
}

/** "15 nov": day and short month of a calendar date or an instant, in Europe/Brussels. */
export function trackingDay(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? value + 'T12:00:00Z' : value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat('nl-BE', { day: 'numeric', month: 'short', timeZone: 'Europe/Brussels' }).format(date).replace('.', '');
}

/** "14:32": hour and minute in Europe/Brussels; null without a valid time. */
export function trackingClock(value: string | null | undefined): string | null {
  const date = new Date(value ?? '');
  if (!value || !Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat('nl-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' }).format(date);
}

/**
 * The last ATTEMPT is older than the interval plus ten minutes: the scheduled check did not come by.
 * A failed check is not "stale": it has its own notice. Fetch freshness never claims that the carrier's
 * coordinates were observed recently.
 */
export function trackingStale(row: Pick<ContainerTracking, 'checkedAt' | 'updatedAt'>, now = Date.now(), intervalHours = 6): boolean {
  const last = Date.parse(row.checkedAt ?? row.updatedAt ?? '');
  return Number.isFinite(last) && now - last > (intervalHours * 60 + 10) * 60_000;
}

export interface TrackingListLine {
  status: TrackingStatusView;
  /** "15 nov", or "12 → 15 nov" while a move is news. */
  arrival: string | null;
  /** Set only while the move is news. */
  move: TrackingMove | null;
  reference: string;
  /** How old the last check is. */
  age: string | null;
  ageWarn: boolean;
}

/** One row of the overview list: status, expected arrival and how old the last check is. */
export function trackingListLine(row: ContainerTracking, configured: boolean, intervalHours: number, now = Date.now()): TrackingListLine {
  const done = trackingArrived(row);
  const failed = configured && !done && !!trackingFailure(row);
  const date = row.orderStatus === 'ONTVANGEN' ? null : trackingArrival(row);
  const moved = trackingMove(row, now);
  const move = moved?.news ? moved : null;
  const day = trackingDay(date);
  const was = move ? trackingDay(move.from) : null;
  /* "12 → 15 nov" within one month, "28 okt → 2 nov" across two. */
  const from = was && day && was.split(' ')[1] === day.split(' ')[1] ? was.split(' ')[0] : was;
  return {
    status: trackingStatus(row, configured), arrival: day && from ? `${from} → ${day}` : day, move,
    reference: validatedContainerReference(row.trackingReference) ?? recognisedOf(row).number ?? row.trackingReference,
    age: done ? null : trackingAge(failed ? row.failureAt ?? row.checkedAt : row.checkedAt, now),
    ageWarn: failed || (configured && !done && row.automatic && trackingStale(row, now, intervalHours)),
  };
}

/** The containers whose last check failed, for the one summary on the Track & trace page. */
export function trackingProblems(rows: readonly ContainerTracking[], configured: boolean, now = Date.now()):
    { row: ContainerTracking; text: string; age: string | null }[] {
  if (!configured) return [];
  return rows.filter((row) => !trackingArrived(row) && !!trackingFailure(row))
    .map((row) => ({ row, text: trackingFailure(row)!, age: trackingAge(row.failureAt ?? row.checkedAt, now) }));
}

type RefreshRow = Pick<ContainerTracking, 'checkedAt' | 'changedAt' | 'error' | 'source' | 'failure' | 'refreshOutcome' | 'manualCheckAt' | 'orderExpectedArrival'>;

/**
 * What a manual check did, in the server's own words (refreshOutcome). A check that did nothing says why and
 * from when it can run again. An older server sends no outcome: then a reused snapshot is not presented as a
 * new check, as before.
 */
export function trackingRefreshNotice(before: Pick<ContainerTracking, 'checkedAt' | 'changedAt' | 'orderExpectedArrival'>, after: RefreshRow): string | null {
  switch (after.refreshOutcome) {
    case 'BUSY': return 'De automatische controle is bezig. Probeer het over enkele minuten opnieuw.';
    case 'COOLDOWN': {
      const from = trackingClock(after.manualCheckAt);
      return from ? `Net gecontroleerd. Opnieuw kan vanaf ${from}.` : 'Net gecontroleerd. Probeer het zo meteen opnieuw.';
    }
    case 'OFF': return 'Automatische controles staan uit.';
    case 'NO_SOURCE': return 'Er is nog niets om te controleren. Koppel eerst een schip.';
    case 'CHECKED':
      if (trackingFailure(after)) return null;
      if ((after.orderExpectedArrival ?? null) !== (before.orderExpectedArrival ?? null)) return 'De verwachte aankomst is aangepast.';
      return after.changedAt && after.changedAt !== before.changedAt
        ? 'Er is een wijziging gevonden. De tracking is bijgewerkt.'
        : 'Controle afgerond. Er zijn geen nieuwe wijzigingen gemeld.';
  }
  if (after.error) return null;
  if (after.checkedAt === before.checkedAt) return 'De opgeslagen gegevens worden getoond; er is nog geen nieuwe controle uitgevoerd.';
  return after.changedAt && after.changedAt !== before.changedAt
    ? 'Er is een wijziging gevonden. De tracking is bijgewerkt.'
    : 'Controle afgerond. Er zijn geen nieuwe wijzigingen gemeld.';
}

/**
 * Until when the notice of a manual check holds (ms), or null: until the row shows a newer check. "Opnieuw kan
 * vanaf 14:32" is over at 14:32; "de automatische controle is bezig" after a few minutes.
 */
export function trackingRefreshNoticeUntil(after: Pick<ContainerTracking, 'refreshOutcome' | 'manualCheckAt'>, now = Date.now()): number | null {
  if (after.refreshOutcome === 'COOLDOWN') { const at = Date.parse(after.manualCheckAt ?? ''); return Number.isFinite(at) ? at : now + 60_000; }
  return after.refreshOutcome === 'BUSY' ? now + 5 * 60_000 : null;
}

export function trackingTime(value: string | null | undefined, includeTime = true): string {
  if (!value) return 'Nog niet bekend';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Nog niet bekend';
  return new Intl.DateTimeFormat('nl-BE', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Brussels',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit' } as const : {}),
  }).format(date);
}
