import { Injectable, signal } from '@angular/core';
import type { DrillView } from './drill-model';

/**
 * Opens the one Analyses drill-down (design/analyses2/design.md §A). Any
 * Analyses screen calls open([view]); AnalysesPage renders the dialog
 * (app-an-drill) once, at page level, outside the faded body and outside
 * the Kasprognose size container (trap rule). The dialog closes itself on
 * navigation and when the page goes.
 */
@Injectable({ providedIn: 'root' })
export class AnDrillHost {
  /** The views of the open drill-down (one per segment), or null when closed. */
  readonly views = signal<readonly DrillView[] | null>(null);
  /** The segment on screen. */
  readonly active = signal(0);

  open(views: readonly DrillView[], active = 0): void {
    if (!views.length) { this.close(); return; }
    this.active.set(Math.max(0, Math.min(active, views.length - 1)));
    this.views.set(views);
  }

  close(): void {
    this.views.set(null);
    this.active.set(0);
  }
}
