import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { AnalyticsApi } from '../../core/api/analytics-api';
import type { WebsiteAnalyticsReport } from '../../core/api/analytics-api';
import { Icon } from '../../shared/icon';
import { deltaMeta, plural, wholeNumber } from './analyses-words';

/**
 * Overzicht › Per onderdeel › Bezoekers (design §3.2): the website's last 30
 * days. The page renders it inside @defer (on viewport), so the report is
 * fetched only once the row can be seen; a failure reads "—" quietly.
 * The host is the row's own link (a.an-row), so the row separators stay.
 */
@Component({
  selector: 'a[appAnVisitorsRow]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <span class="an-tile tone-blue"><app-icon name="globe" [size]="17" /></span>
    <span class="an-row__body"><span class="an-row__title">Bezoekers</span>
      <span class="an-row__sub">Laatste 30 dagen</span>
      <span class="an-row__sub">{{ line() }}</span></span>
    <span class="an-row__end"><span class="an-row__value">{{ value() }}</span>
      @if (delta(); as d) { <span class="an-row__meta" [attr.data-tone]="d.tone">{{ d.text }}</span> }</span>
    <span class="an-row__chev" aria-hidden="true">›</span>
  `,
})
export class AnVisitorsRow implements OnInit {
  private readonly api = inject(AnalyticsApi);
  readonly report = signal<WebsiteAnalyticsReport | null>(null);
  readonly failed = signal(false);

  readonly value = computed(() => { const report = this.report(); return report ? wholeNumber(report.totals.visitors) : '—'; });
  readonly line = computed(() => {
    const report = this.report();
    if (report) return `${plural(report.funnel?.quoteSessions ?? 0, 'sessie', 'sessies')} met offerte-interesse`;
    return this.failed() ? 'Bezoekerscijfers niet beschikbaar' : 'Bezoekerscijfers laden…';
  });
  readonly delta = computed(() => { const report = this.report(); return report ? deltaMeta(report.totals.visitors, report.previous.visitors) : null; });

  async ngOnInit(): Promise<void> {
    try {
      const report = await this.api.websiteReport(30);
      if (!report?.totals || !report.previous) throw new Error('empty report');
      this.report.set(report);
    } catch { this.failed.set(true); }
  }
}
