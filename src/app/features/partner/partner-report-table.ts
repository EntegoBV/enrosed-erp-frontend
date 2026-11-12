import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { PartnerReport } from '../../core/api/partner-portal-api';
import { Icon } from '../../shared/icon';
import { KIND_SHORT, KIND_TONE, count, dayLabel, euro, reportKind } from './partner-format';
import { NO_TWINS, Twins } from './partner-twins';
import {
  buyerLine, canEditReport, canUndoReport, costsEur, partnerStatus, productsShort, reportPieces,
} from './partner-report-format';

/**
 * The partner's meldingen as a desk table: Datum (sold on) · VV · Soort ·
 * Klant · Producten · Stuks (pieces) · Bruto · Kosten · Terugkoop · Netto ·
 * Status · Bewerken / Ongedaan maken. Columns fold by the table's own width
 * (under 1150 px VV, Soort and Klant share one column; under 900 px only
 * Datum, Melding, Producten, Netto and Status stay). A row opens the melding.
 */
@Component({
  selector: 'app-partner-report-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <div class="rt">
      <div class="wk-table rt-table" role="table" [attr.aria-label]="caption()">
        <div class="wk-thead rt-row" role="row">
          <span class="wk-th" role="columnheader">Datum</span>
          <span class="wk-th w" role="columnheader">VV</span>
          <span class="wk-th w" role="columnheader">Soort</span>
          <span class="wk-th w" role="columnheader">Klant</span>
          <span class="wk-th m" role="columnheader">Melding</span>
          <span class="wk-th" role="columnheader">Producten</span>
          <span class="wk-th wk-th--num f" role="columnheader">Stuks</span>
          <span class="wk-th wk-th--num f" role="columnheader">Bruto</span>
          <span class="wk-th wk-th--num f" role="columnheader">Kosten</span>
          <span class="wk-th wk-th--num f" role="columnheader">Terugkoop</span>
          <span class="wk-th wk-th--num" role="columnheader">Netto</span>
          <span class="wk-th" role="columnheader">Status</span>
          <span class="wk-th" role="columnheader"><span class="sr-only">Acties</span></span>
        </div>
        @for (r of reports(); track r.id) {
          @let kind = kindOf(r);
          @let pieces = piecesOf(r);
          @let status = statusOf(r);
          <div class="wk-tr wk-tr--link rt-row rt-tr" role="row" tabindex="0" [class.is-void]="r.status === 'VOIDED'"
               (click)="opened.emit(r)" (keydown.enter)="opened.emit(r)">
            <span class="wk-td rt-cell" role="cell"><b>{{ day(r.soldOn) }}</b>@if (yearOf(r)) { <small>{{ yearOf(r) }}</small> }</span>
            <span class="wk-td rt-cell w" role="cell"><b class="rt-vv">{{ r.number }}</b></span>
            <span class="wk-td rt-cell w" role="cell"><span class="rt-kind {{ tone[kind] }}"><i class="wk-dot"></i>{{ short[kind] }}</span></span>
            <span class="wk-td rt-cell w" role="cell">{{ buyer(r) || '—' }}</span>
            <span class="wk-td rt-cell m" role="cell">
              <b class="rt-vv">{{ r.number }} <span class="rt-kind {{ tone[kind] }}">· {{ short[kind] }}</span></b>
              @if (buyer(r)) { <small>{{ buyer(r) }}</small> }
            </span>
            <span class="wk-td rt-cell" role="cell">{{ products(r) }}</span>
            <span class="wk-td wk-td--num rt-cell f" role="cell">
              @if (pieces.sale) { <b>{{ num(pieces.sale) }}</b> }
              @if (pieces.buyback) { <small>{{ num(pieces.buyback) }} terug</small> }
            </span>
            <span class="wk-td wk-td--num rt-cell f" role="cell">{{ r.totals.grossEur ? eur(r.totals.grossEur) : '—' }}</span>
            <span class="wk-td wk-td--num rt-cell f" role="cell">{{ costs(r) ? eur(costs(r)) : '—' }}</span>
            <span class="wk-td wk-td--num rt-cell f" role="cell">{{ r.totals.buybackEur ? eur(r.totals.buybackEur) : '—' }}</span>
            <span class="wk-td wk-td--num rt-cell" role="cell"><b class="rt-net" [class.is-neg]="r.totals.netEur < 0">{{ eur(r.totals.netEur) }}</b></span>
            <span class="wk-td rt-cell" role="cell"><span class="wk-pill {{ status.tone }}">{{ status.label }}</span></span>
            <span class="wk-td rt-act" role="cell">
              @if (actions() && canEdit(r)) {
                <button class="wk-btn wk-btn--ghost wk-btn--sm wk-btn--icon" type="button" title="Bewerken" [attr.aria-label]="'Bewerken: ' + r.number"
                        (click)="$event.stopPropagation(); edit.emit(r)"><app-icon name="pencil" [size]="14" /></button>
              }
              @if (actions() && canUndo(r)) {
                <button class="wk-btn wk-btn--ghost wk-btn--sm wk-btn--icon rt-undo" type="button" title="Ongedaan maken" [attr.aria-label]="'Ongedaan maken: ' + r.number"
                        (click)="$event.stopPropagation(); undo.emit(r)"><app-icon name="trash" [size]="14" /></button>
              }
            </span>
          </div>
        }
      </div>
    </div>
  `,
  styles: `
    :host{display:block;min-width:0}
    .rt{container:rt / inline-size}
    .rt-table{--wk-cols:76px 132px minmax(0,1fr) 88px 132px 60px;--wk-pad-x:12px;--wk-gap:8px}
    .rt-table .w,.rt-table .f{display:none}
    @container rt (min-width: 900px){
      .rt-table{--wk-cols:76px 132px minmax(0,1fr) 60px 84px 76px 80px 88px 132px 60px}
      .rt-table .f{display:block}
      .rt-table .wk-th.f{display:flex}
    }
    @container rt (min-width: 1150px){
      .rt-table{--wk-cols:76px 58px 88px minmax(0,1fr) minmax(0,1.3fr) 60px 84px 76px 80px 88px 132px 60px;--wk-gap:10px}
      .rt-table .w{display:block}
      .rt-table .wk-th.w{display:flex}
      .rt-table .m{display:none}
    }
    .rt-tr{min-height:48px}
    .rt-tr:hover{background:var(--surface-2)}
    .rt-cell{display:block}
    .rt-cell b{font-weight:650}
    .rt-cell small{display:block;overflow:hidden;color:var(--muted);font-size:11.5px;text-overflow:ellipsis;white-space:nowrap}
    .rt-vv{font-variant-numeric:tabular-nums}
    .rt-kind{display:inline-flex;align-items:center;gap:5px;color:color-mix(in srgb,var(--tone) 80%,var(--ink));font-weight:600}
    .rt-vv .rt-kind{font-weight:600}
    .rt-net{font-size:13.5px;font-weight:750}
    .is-neg{color:var(--danger)}
    .is-void{color:var(--muted)}
    .is-void .rt-net{color:var(--muted);text-decoration:line-through}
    .rt-act{display:flex;justify-content:flex-end;gap:2px;overflow:visible}
    .rt-undo{color:var(--danger)}
  `,
})
export class PartnerReportTable {
  readonly reports = input.required<readonly PartnerReport[]>();
  readonly today = input('');
  readonly caption = input('Meldingen');
  /** Bewerken and Ongedaan maken per row (where the melding allows it). */
  readonly actions = input(true);
  /** Names and colours more than one product shares (the Producten cell adds the code). */
  readonly twins = input<Twins>(NO_TWINS);
  readonly opened = output<PartnerReport>();
  readonly edit = output<PartnerReport>();
  readonly undo = output<PartnerReport>();

  readonly short = KIND_SHORT;
  readonly tone = KIND_TONE;

  kindOf(report: PartnerReport) { return reportKind(report); }
  piecesOf(report: PartnerReport) { return reportPieces(report); }
  statusOf(report: PartnerReport) { return partnerStatus(report); }
  buyer(report: PartnerReport): string { return buyerLine(report); }
  products(report: PartnerReport): string { return productsShort(report, this.twins()); }
  costs(report: PartnerReport): number { return costsEur(report.totals); }
  canEdit(report: PartnerReport): boolean { return canEditReport(report); }
  canUndo(report: PartnerReport): boolean { return canUndoReport(report); }
  eur(value: number): string { return euro(value); }
  num(value: number): string { return count(value); }
  day(iso: string): string { return dayLabel(iso, this.today()); }

  /** The year under the day, only when it is not this year. */
  yearOf(report: PartnerReport): string {
    const year = report.soldOn.slice(0, 4);
    return this.today() && this.today().slice(0, 4) !== year ? year : '';
  }
}
