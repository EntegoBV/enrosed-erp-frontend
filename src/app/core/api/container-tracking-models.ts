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
}

export interface ContainerTrackingFeed {
  provider: string;
  configured: boolean;
  intervalHours: number;
  containers: ContainerTracking[];
}
