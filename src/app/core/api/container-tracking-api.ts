import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from './api.config';
import type { ContainerTracking, ContainerTrackingFeed } from './container-tracking-models';

@Injectable({ providedIn: 'root' })
export class ContainerTrackingApi {
  private readonly http = inject(HttpClient);

  /** Reads the saved snapshots; opening the screen never spends a provider credit. */
  list(): Promise<ContainerTrackingFeed> {
    return firstValueFrom(this.http.get<ContainerTrackingFeed>(api('/api/container-tracking')));
  }

  refresh(orderId: number): Promise<ContainerTracking> {
    return firstValueFrom(this.http.post<ContainerTracking>(api(`/api/container-tracking/${orderId}/refresh`), {}));
  }

  setVessel(orderId: number, imo: string | null, trackingReference: string): Promise<ContainerTracking> {
    return firstValueFrom(this.http.put<ContainerTracking>(api(`/api/container-tracking/${orderId}/vessel`), { imo, trackingReference }));
  }
}
