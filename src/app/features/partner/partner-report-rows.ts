import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { PartnerReport } from '../../core/api/partner-portal-api';
import { Icon } from '../../shared/icon';
import { KIND_ICON, KIND_SHORT, KIND_TONE, dayLabel, euro, reportKind } from './partner-format';
import { buyerLine, partnerStatus, piecesWords, productsShort, reportPieces } from './partner-report-format';
import { NO_TWINS, Twins } from './partner-twins';

/** How many pieces a melding moved, in one short fact: "144 rozen", "12 stuks terug". */
export function reportQuantity(report: PartnerReport): string {
  const pieces = reportPieces(report);
  if (reportKind(report) === 'terugkoop') return piecesWords(report, pieces.buyback) + ' terug';
  return piecesWords(report, pieces.sale);
}

/**
 * Meldingen as rows on the phone: kind and how many pieces, netto; then
 * number, day, products (or the buyer) and the status pill. The whole row
 * opens the melding. The desk shows app-partner-report-table instead.
 */
@Component({
  selector: 'app-partner-report-rows',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <div class="rows" role="list">
      @for (report of reports(); track report.id) {
        @let kind = kindOf(report);
        @let status = statusOf(report);
        <div role="listitem">
          <button class="rp-row" type="button" [class.is-void]="report.status === 'VOIDED'" (click)="opened.emit(report)">
            <span class="rp-row__icon {{ tone[kind] }}" aria-hidden="true"><app-icon [name]="icon[kind]" [size]="20" /></span>
            <span class="rp-row__body">
              <span class="rp-row__top">
                <span class="rp-row__title">{{ short[kind] }} · {{ quantityOf(report) }}</span>
                <b class="rp-row__net">{{ eur(report.totals.netEur) }}</b>
              </span>
              <span class="rp-row__bottom">
                <span class="rp-row__sub">{{ report.number }} · {{ day(report.soldOn) }} · {{ subOf(report) }}</span>
                <span class="pill {{ status.tone }}">{{ status.label }}</span>
              </span>
            </span>
          </button>
        </div>
      }
    </div>
  `,
  styles: `
    :host{display:block}
    .rows{overflow:hidden;border-radius:20px;background:var(--surface)}
    .rows>div+div .rp-row{box-shadow:inset 0 .5px 0 var(--ios-sep,rgb(60 50 45/16%))}
    .rp-row{display:flex;align-items:center;gap:12px;width:100%;min-height:64px;padding:10px 14px;border:0;background:transparent;color:var(--ink);font:inherit;text-align:left;cursor:pointer;-webkit-tap-highlight-color:transparent}
    .rp-row:active{background:color-mix(in srgb,var(--ink) 6%,transparent)}
    .rp-row:focus-visible{outline:3px solid color-mix(in srgb,var(--rose) 55%,transparent);outline-offset:-3px}
    .rp-row__icon{display:grid;flex:none;place-items:center;width:40px;height:40px;border-radius:12px;background:color-mix(in srgb,var(--tone) 14%,var(--surface));color:var(--tone)}
    .rp-row__body{display:grid;flex:1;gap:3px;min-width:0}
    .rp-row__top,.rp-row__bottom{display:flex;align-items:center;justify-content:space-between;gap:10px;min-width:0}
    .rp-row__title{overflow:hidden;font-size:16px;font-weight:650;text-overflow:ellipsis;white-space:nowrap}
    .rp-row__net{flex:none;font-size:16px;font-weight:750;font-variant-numeric:tabular-nums;white-space:nowrap}
    .rp-row__sub{min-width:0;overflow:hidden;color:var(--muted);font-size:13px;text-overflow:ellipsis;white-space:nowrap}
    .pill{flex:none;padding:3px 9px;border-radius:999px;background:color-mix(in srgb,var(--tone) 14%,var(--surface));color:color-mix(in srgb,var(--tone) 80%,var(--ink));font-size:12px;font-weight:700;white-space:nowrap}
    .is-void .rp-row__title,.is-void .rp-row__net{color:var(--muted);text-decoration:line-through}
  `,
})
export class PartnerReportRows {
  readonly reports = input.required<readonly PartnerReport[]>();
  readonly today = input('');
  /** Names and colours more than one product shares (the products line adds the code). */
  readonly twins = input<Twins>(NO_TWINS);
  readonly opened = output<PartnerReport>();

  readonly short = KIND_SHORT;
  readonly icon = KIND_ICON;
  readonly tone = KIND_TONE;

  kindOf(report: PartnerReport) { return reportKind(report); }
  statusOf(report: PartnerReport) { return partnerStatus(report); }
  quantityOf(report: PartnerReport): string { return reportQuantity(report); }
  subOf(report: PartnerReport): string { return buyerLine(report) || productsShort(report, this.twins()); }
  eur(value: number): string { return euro(value); }
  day(iso: string): string { return dayLabel(iso, this.today()); }
}
