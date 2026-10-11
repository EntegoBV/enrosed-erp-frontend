import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from './api.config';

export type ContactInquiryStatus = 'NEW' | 'READ' | 'REPLIED' | 'ARCHIVED' | 'SPAM';
export interface ContactInquiry {
  id: number;
  reference: string;
  status: ContactInquiryStatus;
  language: string;
  topic: string;
  contactName: string;
  email: string;
  companyName: string | null;
  phone: string | null;
  message: string;
  sourcePage: string | null;
  createdAt: string;
  updatedAt: string;
}

@Injectable({ providedIn: 'root' })
export class ContactInquiriesApi {
  private readonly http = inject(HttpClient);

  list(status: ContactInquiryStatus | null, page = 0, size = 50): Promise<ContactInquiry[]> {
    const query = new URLSearchParams({ page: String(page), size: String(size) });
    if (status) query.set('status', status);
    return firstValueFrom(this.http.get<ContactInquiry[]>(api('/api/contact-inquiries?' + query)));
  }

  get(id: number): Promise<ContactInquiry> {
    return firstValueFrom(this.http.get<ContactInquiry>(api(`/api/contact-inquiries/${id}`)));
  }

  setStatus(id: number, status: ContactInquiryStatus): Promise<ContactInquiry> {
    return firstValueFrom(this.http.patch<ContactInquiry>(api(`/api/contact-inquiries/${id}/status`), { status }));
  }
}
