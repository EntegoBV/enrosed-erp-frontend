import { Injectable, computed, inject } from '@angular/core';
import { capsuleLabel, screenLabel } from '../../core/platform/return-label';
import { WorkspaceReturn } from '../../core/platform/workspace-return';

/**
 * The back control of the website's phone tab roots: the screen the
 * workspace was opened from ("‹ Meer", "‹ Vandaag", "‹ Product"), a chevron
 * circle when that name is longer than a capsule holds.
 */
@Injectable({ providedIn: 'root' })
export class WebsitePhoneBack {
  private readonly ret = inject(WorkspaceReturn);
  readonly url = computed(() => this.ret.phoneUrl());
  readonly name = computed(() => screenLabel(this.url()) || 'ERP');
  readonly label = computed(() => capsuleLabel(this.name()));
  readonly aria = computed(() => `Terug naar ${this.name()}`);
}
