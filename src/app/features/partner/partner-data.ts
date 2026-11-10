import { Injectable, computed, inject, signal } from '@angular/core';
import { PartnerOverview, PartnerPortalApi, PartnerRecentSale, PartnerReport, PartnerStockTile } from '../../core/api/partner-portal-api';

/**
 * The partner's overview (stock, recent sales, costs, latest meldingen), shared
 * by the portal's screens. Provided by the portal's shell, so it lives as long
 * as the signed-in portal: a sign-out drops it with the shell.
 */
@Injectable()
export class PartnerData {
  private readonly api = inject(PartnerPortalApi);

  readonly overview = signal<PartnerOverview | null>(null);
  readonly failure = signal<unknown>(null);
  readonly loading = signal(false);
  private pending: Promise<void> | null = null;

  readonly stock = computed<PartnerStockTile[]>(() => this.overview()?.stock ?? []);
  readonly recentSales = computed<PartnerRecentSale[]>(() => this.overview()?.recentSales ?? []);

  /** Fetches the overview; a fetch under way is shared. The screens show the last one meanwhile. */
  load(): Promise<void> {
    if (this.pending) return this.pending;
    this.loading.set(true);
    const run = this.api.overview().then(
      (overview) => { this.overview.set(overview); this.failure.set(null); },
      (failure: unknown) => { this.failure.set(failure); },
    ).finally(() => {
      this.loading.set(false);
      if (this.pending === run) this.pending = null;
    });
    this.pending = run;
    return run;
  }

  /** A melding that was just made or changed, shown at once in the latest list (the next load confirms it). */
  upsertReport(report: PartnerReport): void {
    this.overview.update((overview) => {
      if (!overview) return overview;
      const others = overview.reports.filter((item) => item.id !== report.id);
      const reports = [report, ...others].sort((a, b) => b.id - a.id).slice(0, 10);
      return { ...overview, reports };
    });
  }
}
