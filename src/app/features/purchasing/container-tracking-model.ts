import type { ContainerTracking, TrackingPosition } from '../../core/api/container-tracking-models';

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
    const haystack = [row.containerName, row.orderNumber, row.trackingReference, row.carrier, row.vessel, row.location]
      .filter(Boolean).join(' ').toLocaleLowerCase('nl');
    return words.every((word) => haystack.includes(word));
  });
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

/** Fetch freshness never claims that the carrier's coordinates were observed recently. */
export function trackingStale(row: Pick<ContainerTracking, 'updatedAt' | 'error'>, now = Date.now(), intervalHours = 6): boolean {
  if (row.error) return true;
  const fetched = row.updatedAt ? Date.parse(row.updatedAt) : NaN;
  return Number.isFinite(fetched) && now - fetched > (intervalHours * 60 + 10) * 60_000;
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
