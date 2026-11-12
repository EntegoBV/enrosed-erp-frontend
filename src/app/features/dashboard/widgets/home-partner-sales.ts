import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { localPlannerDate } from '../dashboard-today-state';
import { HomeData } from '../home-data';
import { HomeWidget, amount, count, counted } from './home-w';

/**
 * Veilingverkopen (contract 7c Home; round 2): what the partner (Verhoeven)
 * reported - the netto Factureren can take now (confirmed meldingen), how many
 * wait for Bevestigen and how many can be invoiced, the last melding.
 * One signal behind it: WorkQueue.partnerSales (GET /api/partner-sales/summary,
 * refreshed with the home's bell round), the same number as the nav count and
 * the Te doen task. Hidden while that is unknown (an older backend answers
 * 404) and when nothing is open and nothing came in the last 14 days. On the
 * desk beside Partners, on the phone a wide card after it.
 */
@Component({
  selector: 'app-home-partner-sales',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HomeWidget],
  template: `
    @if (summary(); as s) {
      <app-home-w [variant]="variant()" kind="partner-sales" title="Veilingverkopen" icon="arrow-in" tone="green" link="/veilingverkopen"
                  [wide]="true" [sub]="subLine()">
        @if (invoiceable() && toInvoice(); as open) {
          <span class="home-w__value">{{ whole(open.netEur) }}</span>
          <span class="home-w__line">netto te factureren · {{ counted(open.reports, 'melding', 'meldingen') }}@if (open.pieces != null) { · {{ counted(open.pieces, 'stuk', 'stuks') }}}</span>
        } @else if (unconfirmed()) {
          <span class="home-w__value">{{ count(unconfirmed()) }}</span>
          <span class="home-w__line">{{ unconfirmed() === 1 ? 'melding wacht' : 'meldingen wachten' }} op bevestigen</span>
        } @else if (s.openReports) {
          <!-- Only a buyback is open: it waits for the next sale of that product (Factureren nets it then). -->
          <span class="home-w__value">{{ count(s.openReports) }}</span>
          <span class="home-w__line">{{ s.openReports === 1 ? 'terugkoop wacht' : 'terugkopen wachten' }} op een volgende verkoop</span>
        } @else {
          <span class="home-w__value">{{ count(s.recentReports14d) }}</span>
          <span class="home-w__line">{{ s.recentReports14d === 1 ? 'melding' : 'meldingen' }} in 14 dagen, alles gefactureerd</span>
        }
        <dl class="home-w__kv">
          <!-- Round 2: beside what Factureren can take, what still waits for Bevestigen (the value says it when that is all). -->
          @if (invoiceable() && unconfirmed()) { <div><dt>Te bevestigen</dt><dd>{{ counted(unconfirmed(), 'melding', 'meldingen') }}</dd></div> }
          @if (s.lastReportAt) { <div><dt>Laatste melding</dt><dd>{{ when(s.lastReportAt) }}</dd></div> }
          @if (openPartners() > 1) { <div><dt>Partners met open meldingen</dt><dd>{{ count(openPartners()) }}</dd></div> }
        </dl>
      </app-home-w>
    }
  `,
  styles: `:host { display: contents; }`,
})
export class HomePartnerSales {
  readonly data = inject(HomeData);
  readonly variant = input<'desk' | 'phone'>('desk');
  readonly whole = amount;
  readonly count = count;
  readonly counted = counted;

  /** The summary when the card shows: something open, or a melding in the last 14 days. */
  readonly summary = computed(() => {
    const s = this.data.work.partnerSales();
    return s && (s.openReports > 0 || s.recentReports14d > 0 || (s.unconfirmedReports ?? 0) > 0) ? s : null;
  });
  readonly invoiceable = this.data.work.partnerSalesInvoiceable;
  /** What Factureren can take now (round 2: confirmed and open). */
  readonly toInvoice = this.data.work.partnerSalesToInvoice;
  readonly unconfirmed = this.data.work.partnerSalesUnconfirmed;
  readonly subLine = computed(() => {
    const s = this.summary();
    if (!s) return '';
    if (this.invoiceable()) return 'nog te factureren';
    if (this.unconfirmed()) return 'te bevestigen';
    return s.openReports ? 'niets te factureren' : 'alles gefactureerd';
  });
  readonly openPartners = computed(() => (this.summary()?.partners ?? []).filter((partner) => partner.openReports > 0).length);

  /** "vandaag 14:05", "gisteren", "8/11": the home's minute clock moves it. */
  when(iso: string): string {
    const at = new Date(iso);
    if (!Number.isFinite(at.getTime())) return '—';
    const day = localPlannerDate(at), today = this.data.today();
    if (day === today) return `vandaag ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
    const yesterday = localPlannerDate(new Date(this.data.now() - 86_400_000));
    if (day === yesterday) return 'gisteren';
    return `${at.getDate()}/${at.getMonth() + 1}`;
  }
}
