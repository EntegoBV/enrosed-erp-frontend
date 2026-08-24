import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from './api.config';

export type PlannerKind = 'EVENT' | 'TASK';

/** One line in the planner: an appointment on a date, or a task to tick off. */
export interface PlannerAttachment {
  id: number;
  filename: string;
  contentType: string;
  sizeBytes: number;
}

export interface PlannerItem {
  id: number | null;
  kind: PlannerKind;
  title: string;
  onDate: string | null;
  atTime: string | null;
  note: string | null;
  done: boolean;
  pinned?: boolean;
  attachments?: PlannerAttachment[];
}

@Injectable({ providedIn: 'root' })
export class PlannerApi {
  private readonly http = inject(HttpClient);

  list(): Promise<PlannerItem[]> {
    return firstValueFrom(this.http.get<PlannerItem[]>(api('/api/planner')));
  }

  create(item: PlannerItem): Promise<PlannerItem> {
    return firstValueFrom(this.http.post<PlannerItem>(api('/api/planner'), item));
  }

  update(item: PlannerItem): Promise<PlannerItem> {
    return firstValueFrom(this.http.put<PlannerItem>(api(`/api/planner/${item.id}`), item));
  }

  remove(id: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(api(`/api/planner/${id}`)));
  }

  addAttachment(itemId: number, file: File): Promise<PlannerAttachment> {
    const form = new FormData();
    form.append('file', file, file.name);
    return firstValueFrom(this.http.post<PlannerAttachment>(api(`/api/planner/${itemId}/attachments`), form));
  }

  attachmentFile(itemId: number, attachmentId: number): Promise<Blob> {
    return firstValueFrom(this.http.get(api(`/api/planner/${itemId}/attachments/${attachmentId}/file`),
      { responseType: 'blob' }));
  }

  removeAttachment(itemId: number, attachmentId: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(api(`/api/planner/${itemId}/attachments/${attachmentId}`)));
  }
}


/** One shared copy of the planner: the agenda card and the pinned strip read the same list. */
@Injectable({ providedIn: 'root' })
export class PlannerStore {
  private readonly api = inject(PlannerApi);
  readonly items = signal<PlannerItem[]>([]);

  async reload(): Promise<void> {
    try {
      this.items.set(await this.api.list());
    } catch {
      this.items.set([]);
    }
  }
}
