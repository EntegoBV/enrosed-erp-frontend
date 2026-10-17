import { Injectable, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';
import { documentTitle, routeTitleApplies } from './document-title';
import { urlPath } from './page-parent';

/**
 * Route titles ("Verkoop — Enrosed") for every screen, also the ones without
 * a page header. Skips navigations that keep the path (query or fragment
 * only), so a page header's own title ("PO-2026-025 — Enrosed") is never
 * overwritten by a filter or tab switch.
 */
@Injectable({ providedIn: 'root' })
export class EnrosedTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);
  private lastPath: string | null = null;

  override updateTitle(snapshot: RouterStateSnapshot): void {
    const path = urlPath(snapshot.url);
    if (!routeTitleApplies(this.lastPath, path)) return;
    this.lastPath = path;
    this.title.setTitle(documentTitle(this.buildTitle(snapshot)));
  }
}
