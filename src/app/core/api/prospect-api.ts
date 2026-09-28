import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from './api.config';

export type ProspectStatus = 'NEW' | 'QUALIFIED' | 'CONTACTED' | 'INTERESTED' | 'NOT_INTERESTED' | 'CUSTOMER' | 'DO_NOT_CONTACT';
export type ProspectChannel = 'EMAIL' | 'INSTAGRAM' | 'PHONE' | 'NOTE';
export type ProspectActivityStatus = 'DRAFT' | 'RESERVED' | 'SCHEDULED' | 'SENT' | 'FAILED' | 'RECEIVED' | 'COMPLETED' | 'CANCELLED';
export interface ProspectInput {
  businessName: string;
  countryCode: string;
  language: string | null;
  email: string | null;
  website: string | null;
  instagramHandle: string | null;
  groupKey: string | null;
  sourceUrl: string | null;
  sourceType: string | null;
  status: ProspectStatus;
  notes: string | null;
}
export interface Prospect extends ProspectInput {
  id: number;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string | null;
  lastContactAt: string | null;
}
export interface ProspectActivityInput {
  channel: ProspectChannel;
  type: string;
  status: ProspectActivityStatus;
  subject: string | null;
  body: string | null;
  occurredAt: string;
  externalId: string | null;
  attachmentName: string | null;
  sourceUrl: string | null;
}
export interface ProspectActivity extends ProspectActivityInput {
  id: number;
  prospectId: number;
  createdAt: string;
  createdBy: string;
}
export interface ProspectDetail { prospect: Prospect; activities: ProspectActivity[] }
export interface ProspectEmailReservationInput {
  externalId: string;
  subject: string | null;
  body: string | null;
  attachmentName: string | null;
  sourceUrl: string | null;
  scheduledFor?: string;
}
export interface ProspectPage { items: Prospect[]; total: number; page: number; size: number }
export interface ProspectEmailSummary {
  date: string;
  timezone: string;
  limit: number;
  sent: number;
  reserved: number;
  scheduled: number;
  remaining: number;
  activities: ProspectActivity[];
}
export interface ProspectFilters { search?: string; status?: ProspectStatus | ''; countryCode?: string; page?: number; size?: number }

/** Records outreach performed elsewhere; this API never sends a message. */
@Injectable({ providedIn: 'root' })
export class ProspectApi {
  private readonly http = inject(HttpClient);
  list(filters: ProspectFilters = {}): Promise<ProspectPage> {
    let params = new HttpParams().set('page', filters.page ?? 0).set('size', filters.size ?? 50);
    if (filters.search?.trim()) params = params.set('search', filters.search.trim());
    if (filters.status) params = params.set('status', filters.status);
    if (filters.countryCode) params = params.set('countryCode', filters.countryCode);
    return firstValueFrom(this.http.get<ProspectPage>(api('/api/prospects'), { params }));
  }
  detail(id: number): Promise<ProspectDetail> {
    return firstValueFrom(this.http.get<ProspectDetail>(api(`/api/prospects/${id}`)));
  }
  create(input: ProspectInput): Promise<Prospect> {
    return firstValueFrom(this.http.post<Prospect>(api('/api/prospects'), input));
  }
  update(id: number, input: ProspectInput): Promise<Prospect> {
    return firstValueFrom(this.http.put<Prospect>(api(`/api/prospects/${id}`), input));
  }
  record(id: number, input: ProspectActivityInput): Promise<ProspectActivity> {
    return firstValueFrom(this.http.post<ProspectActivity>(api(`/api/prospects/${id}/activities`), input));
  }
  reserveEmail(id: number, input: ProspectEmailReservationInput): Promise<ProspectActivity> {
    return firstValueFrom(this.http.post<ProspectActivity>(api(`/api/prospects/${id}/email-reservations`), input));
  }
  emailSummary(date: string): Promise<ProspectEmailSummary> {
    return firstValueFrom(this.http.get<ProspectEmailSummary>(api('/api/prospects/email-summary'), { params: { date } }));
  }
}
