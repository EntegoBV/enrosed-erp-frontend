import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from './api.config';
import {
  MediaAssetDetail,
  MediaAssetFilters,
  MediaAssetSummary,
  MediaFolder,
  MediaLinkWrite,
  MediaUploadResult,
  MediaVariant,
} from './media-models';

/** Typed access to the central document and media library. */
@Injectable({ providedIn: 'root' })
export class MediaApi {
  private readonly http = inject(HttpClient);

  assets(filters: MediaAssetFilters = {}): Promise<MediaAssetSummary[]> {
    let params = new HttpParams();
    if (filters.q?.trim()) params = params.set('q', filters.q.trim());
    if (filters.kind) params = params.set('kind', filters.kind);
    if (filters.role) params = params.set('role', filters.role);
    if (filters.archived !== undefined) params = params.set('archived', filters.archived);
    if (filters.includeArchived) params = params.set('includeArchived', true);
    if (filters.targetType) params = params.set('targetType', filters.targetType);
    if (filters.targetId !== undefined) params = params.set('targetId', filters.targetId);
    if (filters.offset !== undefined) params = params.set('offset', filters.offset);
    if (filters.limit !== undefined) params = params.set('limit', filters.limit);
    if (filters.folder !== undefined) params = params.set('folder', String(filters.folder));
    if (filters.linked !== undefined) params = params.set('linked', filters.linked);
    return firstValueFrom(
      this.http.get<MediaAssetSummary[]>(api('/api/media-assets'), { params }),
    );
  }

  asset(id: number): Promise<MediaAssetDetail> {
    return firstValueFrom(
      this.http.get<MediaAssetDetail>(api(`/api/media-assets/${id}`)),
    );
  }

  upload(file: File, name?: string, folderId: number | null = null): Promise<MediaUploadResult> {
    const form = new FormData();
    form.append('file', file, file.name);
    if (name?.trim()) form.append('name', name.trim());
    if (folderId !== null) form.append('folderId', String(folderId));
    return firstValueFrom(
      this.http.post<MediaUploadResult>(api('/api/media-assets'), form),
    );
  }

  updateName(id: number, name: string): Promise<MediaAssetDetail> {
    return firstValueFrom(this.http.put<MediaAssetDetail>(
      api(`/api/media-assets/${id}/metadata`),
      { name: name.trim() },
    ));
  }

  replaceVersion(id: number, file: File): Promise<MediaAssetDetail> {
    const form = new FormData();
    form.append('file', file, file.name);
    return firstValueFrom(this.http.post<MediaAssetDetail>(
      api(`/api/media-assets/${id}/versions`), form,
    ));
  }

  addLink(id: number, link: MediaLinkWrite): Promise<MediaAssetDetail> {
    return firstValueFrom(this.http.post<MediaAssetDetail>(
      api(`/api/media-assets/${id}/links`), link,
    ));
  }

  removeLink(id: number, linkId: number): Promise<MediaAssetDetail> {
    return firstValueFrom(this.http.delete<MediaAssetDetail>(
      api(`/api/media-assets/${id}/links/${linkId}`),
    ));
  }

  archive(id: number): Promise<MediaAssetDetail> {
    return firstValueFrom(this.http.post<MediaAssetDetail>(
      api(`/api/media-assets/${id}/archive`), {},
    ));
  }

  restore(id: number): Promise<MediaAssetDetail> {
    return firstValueFrom(this.http.post<MediaAssetDetail>(
      api(`/api/media-assets/${id}/restore`), {},
    ));
  }

  deleteAsset(id: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(api(`/api/media-assets/${id}`)));
  }

  fileUrl(id: number, variant: MediaVariant = 'original'): string {
    return `/api/media-assets/${id}/file${variant === 'web' ? '?variant=web' : ''}`;
  }

  /* ---- folders */
  folders(): Promise<MediaFolder[]> {
    return firstValueFrom(this.http.get<MediaFolder[]>(api('/api/media-folders')));
  }

  createFolder(name: string, parentId: number | null): Promise<MediaFolder> {
    return firstValueFrom(this.http.post<MediaFolder>(api('/api/media-folders'), { name: name.trim(), parentId }));
  }

  updateFolder(id: number, name: string, parentId: number | null): Promise<MediaFolder> {
    return firstValueFrom(this.http.put<MediaFolder>(api(`/api/media-folders/${id}`), { name: name.trim(), parentId }));
  }

  deleteFolder(id: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(api(`/api/media-folders/${id}`)));
  }

  move(id: number, folderId: number | null): Promise<MediaAssetDetail> {
    return firstValueFrom(this.http.put<MediaAssetDetail>(api(`/api/media-assets/${id}/folder`), { folderId }));
  }

  /* ---- public links */
  share(id: number): Promise<MediaAssetDetail> {
    return firstValueFrom(this.http.post<MediaAssetDetail>(api(`/api/media-assets/${id}/share`), {}));
  }

  unshare(id: number): Promise<MediaAssetDetail> {
    return firstValueFrom(this.http.delete<MediaAssetDetail>(api(`/api/media-assets/${id}/share`)));
  }

  /** The address anyone can open, on the API host so it works without the ERP. */
  publicUrl(token: string, variant: MediaVariant = 'original'): string {
    return api(`/api/public/media/${token}${variant === 'web' ? '/web' : ''}`);
  }

  /** Small authenticated rendition for library cards; never download full print assets here. */
  thumbnailUrl(id: number): string {
    return `/api/media-assets/${id}/thumbnail`;
  }

  download(id: number, variant: MediaVariant = 'original'): Promise<Blob> {
    return firstValueFrom(this.http.get(
      api(`/api/media-assets/${id}/download${variant === 'web' ? '?variant=web' : ''}`),
      { responseType: 'blob' },
    ));
  }
}
