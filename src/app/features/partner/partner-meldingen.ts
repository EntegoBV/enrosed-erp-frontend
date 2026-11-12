import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { messageOf } from '../../core/api/errors';
import { PARTNER_REPORT_PAGE_SIZE, PartnerPortalApi, PartnerReport } from '../../core/api/partner-portal-api';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { LOAD_ERROR_FALLBACK, LoadError } from '../../shared/load-error';
import { Skeleton } from '../../shared/skeleton';
import { Ui } from '../../shared/ui';
import { PartnerData } from './partner-data';
import { localToday } from './partner-format';
import { PartnerHead } from './partner-head';
import { bySoldOn } from './partner-report-format';
import { PartnerReportRows } from './partner-report-rows';
import { PartnerReportSheet, confirmUndo } from './partner-report-sheet';
import { PartnerReportTable } from './partner-report-table';

/**
 * Every melding of the partner, newest sale day first, 50 at a time: a table
 * on the desk (rows on the phone); a row opens its detail, Bewerken opens it
 * on the Melden page while Enrosed has not confirmed it.
 */
@Component({
  selector: 'app-partner-meldingen',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LoadError, Skeleton, PartnerHead, PartnerReportRows, PartnerReportSheet, PartnerReportTable],
  template: `
    <app-partner-head title="Meldingen" [sub]="sub()" />
    @if (reports(); as list) {
      @if (list.length) {
        @if (desk.active()) {
          <div class="pm-card">
            <app-partner-report-table [reports]="list" [today]="today()" (opened)="open.set($event)" (edit)="edit($event)" (undo)="undo($event)" />
          </div>
        } @else {
          <app-partner-report-rows [reports]="list" [today]="today()" (opened)="open.set($event)" />
        }
        @if (more()) {
          <button class="more ios-capsule ios-capsule--tinted" type="button" [disabled]="loading()" (click)="loadMore()">
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
      <app-skeleton [kind]="desk.active() ? 'table' : 'list'" [rows]="6" />
    }

    @if (open(); as report) {
      <app-partner-report-sheet [report]="report" [related]="reports() ?? []" (closed)="open.set(null)" (changed)="changed($event)" (edit)="edit($event)" />
    }
  `,
  styles: `
    :host{display:block;padding-bottom:calc(24px + var(--safe-b,0px))}
    .pm-card{border:1px solid var(--line);border-radius:14px;background:var(--surface);--wk-sticky-top:var(--pp-sticky-top,0px)}
    .more{display:flex;margin:14px auto 0;min-width:220px}
    .none{margin:0;padding:24px;border-radius:16px;background:var(--surface);color:var(--muted);text-align:center}
    .bad{margin:10px 0 0;color:var(--danger);font-size:14px;font-weight:600;text-align:center}
  `,
})
export class PartnerMeldingen {
  private readonly api = inject(PartnerPortalApi);
  private readonly data = inject(PartnerData);
  private readonly router = inject(Router);
  private readonly ui = inject(Ui);
  readonly desk = inject(DesktopViewport);

  readonly reports = signal<PartnerReport[] | null>(null);
  readonly more = signal(false);
  readonly loading = signal(false);
  readonly failure = signal<unknown>(null);
  readonly moreError = signal<string | null>(null);
  readonly open = signal<PartnerReport | null>(null);
  readonly failureText = computed(() => messageOf(this.failure(), LOAD_ERROR_FALLBACK));
  readonly today = computed(() => this.data.overview()?.serverDate ?? localToday());
  readonly sub = computed(() => this.desk.active() ? 'Wijzigen kan tot Enrosed een melding bevestigt.' : null);

  constructor() {
    void this.loadFirst();
  }

  async loadFirst(): Promise<void> {
    if (this.loading()) return;
    this.loading.set(true);
    this.failure.set(null);
    try {
      const page = await this.api.reports(null, PARTNER_REPORT_PAGE_SIZE);
      this.reports.set([...page.reports].sort(bySoldOn));
      this.more.set(page.more);
    } catch (failure: unknown) {
      this.failure.set(failure);
    } finally {
      this.loading.set(false);
    }
  }

  /** The next page: ids below the lowest one shown (the server pages by id), merged and sorted by sale day. */
  async loadMore(): Promise<void> {
    const list = this.reports();
    if (this.loading() || !list?.length) return;
    this.loading.set(true);
    this.moreError.set(null);
    try {
      const lowest = Math.min(...list.map((report) => report.id));
      const page = await this.api.reports(lowest, PARTNER_REPORT_PAGE_SIZE);
      const known = new Set(list.map((report) => report.id));
      this.reports.set([...list, ...page.reports.filter((report) => !known.has(report.id))].sort(bySoldOn));
      this.more.set(page.more);
    } catch (failure: unknown) {
      this.moreError.set(messageOf(failure, 'Meer meldingen laden lukt nu niet.'));
    } finally {
      this.loading.set(false);
    }
  }

  edit(report: PartnerReport): void {
    this.open.set(null);
    void this.router.navigate(['/partner/melden'], { queryParams: { bewerk: report.id } });
  }

  async undo(report: PartnerReport): Promise<void> {
    const voided = await confirmUndo(this.ui, this.api, report);
    if (voided) this.changed(voided);
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
}
