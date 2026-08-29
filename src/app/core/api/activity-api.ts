import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from './api.config';
import { ActivityCategory, ActivityPage } from './models';

export interface ActivityFilters {
  actor?: string;
  category?: ActivityCategory;
  entityType?: string;
  entityId?: string | number;
  before?: number;
  limit?: number;
}

/** Read-only access to the append-only company logbook. */
@Injectable({ providedIn: 'root' })
export class ActivityApi {
  private readonly http = inject(HttpClient);

  list(filters: ActivityFilters = {}): Promise<ActivityPage> {
    let params = new HttpParams().set('limit', String(filters.limit ?? 50));
    if (filters.actor) params = params.set('actor', filters.actor);
    if (filters.category) params = params.set('category', filters.category);
    if (filters.entityType) params = params.set('entityType', filters.entityType);
    if (filters.entityId !== undefined) params = params.set('entityId', String(filters.entityId));
    if (filters.before !== undefined) params = params.set('before', String(filters.before));
    return firstValueFrom(this.http.get<ActivityPage>(api('/api/activity'), { params }));
  }
}
