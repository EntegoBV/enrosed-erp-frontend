import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from './api.config';

export interface StaffContact {
  username: string;
  displayName: string;
  phone: string | null;
}

@Injectable({ providedIn: 'root' })
export class StaffContactsApi {
  private readonly http = inject(HttpClient);

  accounts(): Promise<StaffContact[]> {
    return firstValueFrom(this.http.get<StaffContact[]>(api('/api/auth/accounts')));
  }

  savePhone(username: string, phone: string | null): Promise<StaffContact> {
    return firstValueFrom(this.http.put<StaffContact>(
      api(`/api/auth/accounts/${encodeURIComponent(username)}/phone`), { phone }));
  }
}
