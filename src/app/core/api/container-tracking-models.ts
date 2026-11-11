export interface TrackingPosition {
  lat: number;
  lon: number;
  kind: 'VESSEL' | 'LAST_EVENT';
  /** The observation time, when supplied by the tracking source. */
  recordedAt: string | null;
}

export interface TrackingEvent {
  id: string;
  status: string;
  location: string | null;
  occurredAt: string | null;
  actual: boolean;
  source?: string | null;
  sourceUrl?: string | null;
}

/**
 * What the Track & trace text was read as. number is what the tracker follows; container is the container
 * number behind a B/L or booking; checkDigitOk is the ISO 6346 check of the container in this result (null
 * without one); evergreenBl is the Evergreen bill the date lookup uses.
 */
export interface TrackingRecognised {
  kind: 'EMPTY' | 'CONTAINER' | 'BL' | 'BOOKING' | 'MULTIPLE' | 'LINK' | 'UNKNOWN';
  number: string | null;
  checkDigitOk: boolean | null;
  container: string | null;
  evergreenBl: string | null;
}

export interface ContainerTracking {
  orderId: number;
  orderNumber: string;
  containerName: string | null;
  trackingReference: string;
  orderStatus: string;
  status: string;
  statusLabel: string;
  carrier: string | null;
  vessel: string | null;
  eta: string | null;
  /** Canonical saved purchase dates after backend source validation; absent on older servers. */
  orderExpectedArrival?: string | null;
  orderShippedOn?: string | null;
  /** Independently checked order-date source; the embedded ship ETA is not used here. */
  dateSource?: string | null;
  dateSourceCheckedAt?: string | null;
  dateError?: string | null;
  location: string | null;
  position: TrackingPosition | null;
  route: { lat: number; lon: number }[];
  events: TrackingEvent[];
  checkedAt: string | null;
  /** Last successful fetch by ENROSED, not the position observation time. */
  updatedAt: string | null;
  nextCheckAt: string | null;
  changedAt: string | null;
  providerCheckedAt?: string | null;
  providerUpdatedAt?: string | null;
  error: string | null;
  trackingUrl: string | null;
  source: 'VOYDAR' | 'SHIPSGO' | null;
  vesselImo: string | null;
  automatic: boolean;
  /* Since 2026-11-10; absent on older servers, where the screens fall back to what they did before. */
  /** The server's reading of the reference (the same rule as features/purchasing/tracking-reference.ts). */
  recognised?: TrackingRecognised | null;
  /** The last attempt failed: its message and when. A date that could not be applied stays dateError. */
  failure?: string | null;
  failureAt?: string | null;
  /** Tracking moved the expected arrival: the date that stood, when, and the signed days to the date now. */
  arrivalMovedFrom?: string | null;
  arrivalMovedAt?: string | null;
  arrivalMovedDays?: number | null;
  /** From when a manual check does something again; null = now, or nothing to check. */
  manualCheckAt?: string | null;
  /** Only on the answer of a manual check. */
  refreshOutcome?: 'CHECKED' | 'COOLDOWN' | 'BUSY' | 'OFF' | 'NO_SOURCE' | null;
}

export interface ContainerTrackingFeed {
  provider: string;
  /** Global provider polling switch; availability of an individual source is row.automatic. */
  configured: boolean;
  shipsGoConfigured: boolean;
  intervalHours: number;
  containers: ContainerTracking[];
}
