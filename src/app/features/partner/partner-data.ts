import { Injectable, computed, inject, signal } from '@angular/core';
import { PartnerOverview, PartnerPortalApi, PartnerRecentSale, PartnerReport, PartnerStockTile } from '../../core/api/partner-portal-api';
import { localToday } from './partner-format';
import { bySoldOn } from './partner-report-format';
import { twinKeys } from './partner-twins';

/** How old the overview may be when he comes back to the portal before it is read again. */
const STALE_MS = 60_000;

/**
 * The partner's overview (stock, recent sales, costs, latest meldingen), shared
 * by the portal's screens. Provided by the portal's shell, so it lives as long
 * as the signed-in portal: a sign-out drops it with the shell.
 *
 * The portal stays open between auctions (Safari keeps the page overnight), so
 * the shell asks `refreshIfStale()` whenever he comes back to it: the stock and
 * the server's today ("Vandaag") must be today's, never those of the evening
 * before.
 */
@Injectable()
export class PartnerData {
  private readonly api = inject(PartnerPortalApi);

  readonly overview = signal<PartnerOverview | null>(null);
  readonly failure = signal<unknown>(null);
  readonly loading = signal(false);
  private pending: Promise<void> | null = null;
  /** When the shown overview was asked (ms) and the device's day then; null before the first answer. */
  private loadedAt: number | null = null;
  private loadedDay = '';

  readonly stock = computed<PartnerStockTile[]>(() => this.overview()?.stock ?? []);
  readonly recentSales = computed<PartnerRecentSale[]>(() => this.overview()?.recentSales ?? []);
  /** Names and colours more than one product shares (stock, recent sales, latest meldingen): those rows add the code. */
  readonly twins = computed(() => twinKeys([
    ...this.stock(), ...this.recentSales(), ...(this.overview()?.reports ?? []).flatMap((report) => report.entries),
  ]));

  /** Fetches the overview; a fetch under way is shared. The screens show the last one meanwhile. */
  load(): Promise<void> {
    if (this.pending) return this.pending;
    this.loading.set(true);
    const askedAt = Date.now();
    const askedDay = localToday();
    const run = this.api.overview().then(
      (overview) => {
        this.overview.set(overview);
        this.failure.set(null);
        this.loadedAt = askedAt;
        this.loadedDay = askedDay;
      },
      (failure: unknown) => { this.failure.set(failure); },
    ).finally(() => {
      this.loading.set(false);
      if (this.pending === run) this.pending = null;
    });
    this.pending = run;
    return run;
  }

  /** Reads the overview again when it is older than a minute or from another day (back in the portal after a while). */
  refreshIfStale(): void {
    if (this.pending) return;
    if (this.loadedAt !== null && Date.now() - this.loadedAt < STALE_MS && this.loadedDay === localToday()) return;
    void this.load();
  }

  /** The device's day moved past the overview's (the page stayed open overnight): read it again. */
  refreshIfNewDay(): void {
    if (!this.pending && this.loadedAt !== null && this.loadedDay !== localToday()) void this.load();
  }

  /** A melding that was just made or changed, shown at once in the latest list (the next load confirms it). */
  upsertReport(report: PartnerReport): void {
    this.overview.update((overview) => {
      if (!overview) return overview;
      const others = overview.reports.filter((item) => item.id !== report.id);
      const reports = [report, ...others].sort(bySoldOn).slice(0, 10);
      return { ...overview, reports };
    });
  }
}
