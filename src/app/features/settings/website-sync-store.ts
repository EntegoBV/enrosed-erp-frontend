import { Injectable, inject } from '@angular/core';
import { CatalogApi } from '../../core/api/catalog-api';
import { messageOf } from '../../core/api/errors';
import { WebsiteSyncState } from './website-sync-state';

/** The one website rebuild status of the app; see WebsiteSyncState. */
@Injectable({ providedIn: 'root' })
export class WebsiteSyncStore extends WebsiteSyncState {
  constructor() {
    super(inject(CatalogApi), messageOf);
  }
}
