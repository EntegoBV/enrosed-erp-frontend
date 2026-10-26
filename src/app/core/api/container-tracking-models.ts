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
}

export interface ContainerTrackingFeed {
  provider: string;
  /** Global provider polling switch; availability of an individual source is row.automatic. */
  configured: boolean;
  shipsGoConfigured: boolean;
  intervalHours: number;
  containers: ContainerTracking[];
}
