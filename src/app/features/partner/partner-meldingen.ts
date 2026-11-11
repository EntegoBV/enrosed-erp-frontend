import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { messageOf } from '../../core/api/errors';
import { PARTNER_REPORT_PAGE_SIZE, PartnerPortalApi, PartnerReport } from '../../core/api/partner-portal-api';
import { LOAD_ERROR_FALLBACK, LoadError } from '../../shared/load-error';
import { Skeleton } from '../../shared/skeleton';
import { PartnerData } from './partner-data';
import { localToday } from './partner-format';
import { PartnerHead } from './partner-head';
import { PartnerReportRows } from './partner-report-rows';
import { PartnerReportSheet } from './partner-report-sheet';

/** Every melding of the partner, newest first, 50 at a time; a row opens its detail. */
@Component({
  selector: 'app-partner-meldingen',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LoadError, Skeleton, PartnerHead, PartnerReportRows, PartnerReportSheet],
  template: `
    <app-partner-head title="Meldingen" backLabel="Terug naar overzicht" (back)="home()" />
    @if (reports(); as list) {
      @if (list.length) {
        <app-partner-report-rows [reports]="list" [today]="today()" (opened)="open.set($event)" />
        @if (more()) {
          <button class="more ios-capsule ios-capsule--tinted ios-capsule--block" type="button" [disabled]="loading()" (click)="loadMore()">
            {{ loading() ? 'Laden…' : 'Meer meldingen' }}
          </button>
        }
        @if (moreError()) { <p class="bad" role="alert">{{ moreError() }}</p> }
      } @else {
        <p class="none">Nog niets gemeld.</p>
      }
    } @else if (failure()) {
      <app-load-error [message]="failureText()" [busy]="loading()" (retry)="loadFirst()" />
    } @else {
      <app-skeleton kind="list" [rows]="6" />
    }

    @if (open(); as report) {
      <app-partner-report-sheet [report]="report" [related]="reports() ?? []" (closed)="open.set(null)" (changed)="changed($event)" />
    }
  `,
  styles: `
    :host{display:block;padding-bottom:calc(24px + var(--safe-b,0px))}
    .more{margin-top:14px}
    .none{margin:0;padding:24px;border-radius:20px;background:var(--surface);color:var(--muted);text-align:center}
    .bad{margin:10px 0 0;color:var(--danger);font-size:14px;font-weight:600;text-align:center}
  `,
})
export class PartnerMeldingen {
  private readonly api = inject(PartnerPortalApi);
  private readonly data = inject(PartnerData);
  private readonly router = inject(Router);

  readonly reports = signal<PartnerReport[] | null>(null);
  readonly more = signal(false);
  readonly loading = signal(false);
  readonly failure = signal<unknown>(null);
  readonly moreError = signal<string | null>(null);
  readonly open = signal<PartnerReport | null>(null);
  readonly failureText = computed(() => messageOf(this.failure(), LOAD_ERROR_FALLBACK));
  readonly today = computed(() => this.data.overview()?.serverDate ?? localToday());

  constructor() {
    void this.loadFirst();
  }

  async loadFirst(): Promise<void> {
    if (this.loading()) return;
    this.loading.set(true);
    this.failure.set(null);
    try {
      const page = await this.api.reports(null, PARTNER_REPORT_PAGE_SIZE);
      this.reports.set(page.reports);
      this.more.set(page.more);
    } catch (failure: unknown) {
      this.failure.set(failure);
    } finally {
      this.loading.set(false);
    }
  }

  async loadMore(): Promise<void> {
    const list = this.reports();
    if (this.loading() || !list?.length) return;
    this.loading.set(true);
    this.moreError.set(null);
    try {
      const page = await this.api.reports(list[list.length - 1].id, PARTNER_REPORT_PAGE_SIZE);
      const known = new Set(list.map((report) => report.id));
      this.reports.set([...list, ...page.reports.filter((report) => !known.has(report.id))]);
      this.more.set(page.more);
    } catch (failure: unknown) {
      this.moreError.set(messageOf(failure, 'Meer meldingen laden lukt nu niet.'));
    } finally {
      this.loading.set(false);
    }
  }

  changed(report: PartnerReport): void {
    this.open.set(null);
    this.reports.update((list) => list?.map((item) => (item.id === report.id ? report : item)) ?? list);
    this.data.upsertReport(report);
    void this.data.load();
    void this.refreshShown();
  }

  /** Undoing one melding can free another (a buyback let go of its sale): the first page is read again into the list. */
  private async refreshShown(): Promise<void> {
    try {
      const page = await this.api.reports(null, PARTNER_REPORT_PAGE_SIZE);
      const fresh = new Map(page.reports.map((report) => [report.id, report]));
      this.reports.update((list) => list?.map((item) => fresh.get(item.id) ?? item) ?? list);
    } catch { /* the list keeps what it showed; the next visit reads it again */ }
  }

  home(): void {
    void this.router.navigate(['/partner']);
  }
}
