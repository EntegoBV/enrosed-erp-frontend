import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { PartnerPortalApi, PartnerReport, PartnerReportBuyback, PartnerReportEntry, PartnerReportSale } from '../../core/api/partner-portal-api';
import { messageOf } from '../../core/api/errors';
import { Icon } from '../../shared/icon';
import { Sheet, Ui } from '../../shared/ui';
import { KIND_ICON, KIND_LABEL, KIND_TONE, euro, longDate, minusEuro, percent, priceEuro, reportKind } from './partner-format';
import { percentOfEur } from './partner-money';
import { PartnerPhoto } from './partner-photo';
import { piecesPerSalesUnit, unitOf } from './partner-units';
import {
  buyerLine, canEditReport, canUndoReport, partCount, partPiecePrice, partPiecesText, partnerStatus, pieceNoun,
} from './partner-report-format';

/** Asks, then voids the partner's own melding; resolves with the voided melding, or null (not asked through, or refused). */
export function confirmUndo(ui: Ui, api: PartnerPortalApi, report: PartnerReport, failed: (message: string) => void = (m) => ui.toast(m, 'err')): Promise<PartnerReport | null> {
  return new Promise((resolve) => {
    ui.confirm({
      title: `${report.number} ongedaan maken?`,
      message: 'De melding wordt ingetrokken en de voorraad gezet zoals ze ervoor was.',
      confirmLabel: 'Ongedaan maken',
      danger: true,
    }, () => {
      api.voidReport(report.id).then((voided) => {
        ui.toast(`${voided.number} ongedaan gemaakt`);
        resolve(voided);
      }, (failure: unknown) => {
        failed(messageOf(failure, 'Ongedaan maken lukt nu niet. Probeer het opnieuw.'));
        resolve(null);
      });
    }, undefined, () => resolve(null));
  });
}

/**
 * One melding: per product what was sold (as typed: "120 rozen × € 0,50")
 * and bought back on the clock, the buyer, the costs with every extra kost
 * line, Terugkoopkost and Netto; Bewerken and Ongedaan maken while Enrosed has
 * not confirmed it (the server decides: canEdit, canUndo).
 */
@Component({
  selector: 'app-partner-report-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, Sheet, PartnerPhoto],
  template: `
    @let r = report();
    @let t = r.totals;
    <app-sheet variant="ios" [title]="r.number" [backdropCloses]="!busy()" (closed)="closed.emit()">
      <div body class="body">
        <div class="head">
          <span class="kind {{ tone() }}"><app-icon [name]="icon()" [size]="18" />{{ label() }}</span>
          <span class="pill {{ status().tone }}">{{ status().label }}</span>
        </div>
        <p class="meta">{{ meta() }}</p>
        @if (buyer()) { <p class="buyer"><span>Klant</span><b>{{ buyer() }}</b></p> }

        <div class="entries">
          @for (entry of r.entries; track entry.productId) {
            <div class="entry">
              <app-partner-photo class="entry__photo" [product]="entry" />
              <div class="entry__body">
                <strong>{{ entry.name }}</strong>
                @if (entry.variant) { <span class="entry__variant">{{ entry.variant }}</span> }
                @if (entry.sale; as sale) {
                  <div class="fact"><span>{{ countOf(entry, sale) }} × {{ price(entry, sale) }}@if (piecesOf(entry, sale); as p) { <small>{{ p }}</small> }</span><b>{{ eur(sale.grossEur) }}</b></div>
                }
                @if (entry.buyback; as buyback) {
                  <div class="fact fact--buyback"><span>Teruggekocht {{ countOf(entry, buyback) }} × {{ price(entry, buyback) }}</span><b>{{ minus(buyback.costEur ?? buyback.grossEur) }}</b></div>
                }
              </div>
            </div>
          }
        </div>

        <div class="cost">
          @if (t.saleQuantity > 0) {
            <div class="line"><span>Bruto</span><span>{{ eur(t.grossEur) }}</span></div>
            @if (r.channel === 'AUCTION') {
              <div class="line"><span>Veilingcommissie {{ pct(r.commissionPct) }}</span><span>{{ minus(t.commissionEur) }}</span></div>
              <div class="line"><span>Transport {{ pct(r.transportPct) }}</span><span>{{ minus(t.transportEur) }}</span></div>
            }
            @for (line of extraLines(); track $index) {
              <div class="line"><span>{{ line.label }}</span><span>{{ minus(line.amount) }}</span></div>
            }
          }
          @if (t.buybackQuantity > 0) {
            <div class="line"><span>Terugkoopkost<small>incl. commissie en transport</small></span><span>{{ minus(t.buybackEur) }}</span></div>
          }
          <div class="line line--total"><span>Netto</span><b>{{ eur(t.netEur) }}</b></div>
        </div>
        @if (blocker(); as why) { <p class="why">{{ why }}</p> }
        @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
      </div>
      <div foot class="foot">
        @if (canUndo()) {
          <button class="ios-capsule ios-capsule--block undo" type="button" [disabled]="busy()" (click)="askUndo()">
            {{ busy() ? 'Bezig…' : 'Ongedaan maken' }}
          </button>
        }
        @if (canEdit()) {
          <button class="ios-capsule ios-capsule--accent ios-capsule--block" type="button" [disabled]="busy()" (click)="edit.emit(r)">Bewerken</button>
        }
        @if (!canUndo() && !canEdit()) {
          <button class="ios-capsule ios-capsule--block" type="button" (click)="closed.emit()">Sluiten</button>
        }
      </div>
    </app-sheet>
  `,
  styles: `
    .body{display:grid;gap:14px}
    .head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
    .kind{display:inline-flex;align-items:center;gap:8px;color:color-mix(in srgb,var(--tone) 85%,var(--ink));font-size:16px;font-weight:700}
    .pill{padding:4px 10px;border-radius:999px;background:color-mix(in srgb,var(--tone) 14%,var(--surface));color:color-mix(in srgb,var(--tone) 80%,var(--ink));font-size:13px;font-weight:700}
    .meta{margin:-8px 0 0;color:var(--muted);font-size:14px}
    .buyer{display:flex;justify-content:space-between;gap:10px;margin:0;padding:10px 14px;border-radius:14px;background:var(--surface);font-size:15px}
    .buyer span{color:var(--muted)}
    .entries{display:grid;gap:2px;overflow:hidden;border-radius:18px;background:var(--surface)}
    .entry{display:grid;grid-template-columns:48px minmax(0,1fr);gap:12px;padding:12px 14px}
    .entry+.entry{box-shadow:inset 0 .5px 0 var(--ios-sep,rgb(60 50 45/16%))}
    .entry__photo{width:48px;height:48px;border-radius:12px}
    .entry__body{display:grid;gap:3px;min-width:0}
    .entry__body strong{font-size:15.5px;font-weight:650}
    .entry__variant{color:var(--muted);font-size:13px}
    .fact{display:flex;justify-content:space-between;gap:10px;color:var(--ink-2);font-size:14px;font-variant-numeric:tabular-nums}
    .fact small{display:block;color:var(--muted);font-size:12.5px}
    .fact b{color:var(--ink);font-weight:700;white-space:nowrap}
    .fact--buyback{color:#7c4a0b}
    .cost{display:grid;padding:6px 16px 10px;border-radius:18px;background:var(--surface)}
    .line{display:flex;justify-content:space-between;gap:10px;padding:7px 0;color:var(--ink-2);font-size:15px;font-variant-numeric:tabular-nums}
    .line small{display:block;color:var(--muted);font-size:12.5px}
    .line--total{margin-top:4px;padding-top:10px;border-top:1px solid var(--line);color:var(--ink);font-size:17px;font-weight:700}
    .line--total b{font-size:20px;font-weight:800}
    .error{padding:12px 14px;border-radius:16px;background:var(--danger-soft);color:#83261e;font-size:15px;line-height:1.4}
    .why{margin:0;padding:0 4px;color:var(--ink-2);font-size:14.5px;line-height:1.4}
    .foot{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:10px;width:100%}
    .undo{color:var(--danger)}
    @media (max-width: 679.98px), (hover: none) and (max-width: 1023.98px){.body{padding:0 var(--ios-inset,16px)}}
  `,
})
export class PartnerReportSheet {
  private readonly api = inject(PartnerPortalApi);
  private readonly ui = inject(Ui);

  readonly report = input.required<PartnerReport>();
  /** The other meldingen on the screen: to name the buyback that keeps this one from being undone. */
  readonly related = input<readonly PartnerReport[]>([]);
  readonly closed = output<void>();
  /** The melding after Ongedaan maken (status VOIDED). */
  readonly changed = output<PartnerReport>();
  /** Bewerken: the screen opens the melding on the Melden page. */
  readonly edit = output<PartnerReport>();

  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  private readonly kind = computed(() => reportKind(this.report()));
  readonly label = computed(() => KIND_LABEL[this.kind()]);
  readonly icon = computed(() => KIND_ICON[this.kind()]);
  readonly tone = computed(() => KIND_TONE[this.kind()]);
  readonly status = computed(() => partnerStatus(this.report()));
  readonly buyer = computed(() => buyerLine(this.report()));
  readonly canEdit = computed(() => canEditReport(this.report()));
  readonly canUndo = computed(() => canUndoReport(this.report()));

  /** "10 november 2026 · gemeld door Frans · gewijzigd door Frans · bevestigd door Emre". */
  readonly meta = computed(() => {
    const r = this.report();
    return [
      longDate(r.soldOn),
      r.createdByName ? 'gemeld door ' + r.createdByName : '',
      r.updatedByName ? 'gewijzigd door ' + r.updatedByName : '',
      r.confirmed && r.confirmedByName ? 'bevestigd door ' + r.confirmedByName : '',
    ].filter(Boolean).join(' · ');
  });

  /** Every extra kost line with what it cost: an amount as typed, a percentage over the products' gross. */
  readonly extraLines = computed<{ label: string; amount: number }[]>(() => {
    const r = this.report();
    const lines = r.extraCosts ?? (r.extraCost ? [{ description: null, ...r.extraCost }] : []);
    if (lines.length === 1) {
      const line = lines[0];
      return [{ label: (line.description || 'Extra kost') + (line.mode === 'PCT' ? ' ' + percent(line.value) : ''), amount: r.totals.extraCostEur }];
    }
    return lines.map((line) => ({
      label: (line.description || 'Extra kost') + (line.mode === 'PCT' ? ' ' + percent(line.value) : ''),
      amount: line.mode === 'AMOUNT' ? line.value
        : r.entries.reduce((sum, entry) => sum + (entry.sale ? percentOfEur(entry.sale.grossEur, line.value) : 0), 0),
    }));
  });

  /** Why an open melding cannot be changed or undone by him. */
  readonly blocker = computed<string | null>(() => {
    const report = this.report();
    if (report.status !== 'OPEN' || this.canUndo() || this.canEdit()) return null;
    if (report.confirmed) return 'Enrosed heeft deze melding bevestigd. Een wijziging vraag je aan Enrosed.';
    const sold = new Set(report.entries.filter((entry) => entry.sale).map((entry) => entry.productId));
    const later = this.related().filter((other) => other.id > report.id && other.status === 'OPEN' && other.canUndo
      && other.entries.some((entry) => entry.buyback && sold.has(entry.productId)));
    return later.length === 1
      ? `Terugkoop ${later[0].number} hoort bij deze verkoop. Maak eerst ${later[0].number} ongedaan.`
      : 'Een latere terugkoop hoort bij deze verkoop. Maak die eerst ongedaan.';
  });

  async askUndo(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const voided = await confirmUndo(this.ui, this.api, this.report(), (message) => this.error.set(message));
      if (voided) this.changed.emit(voided);
    } finally {
      this.busy.set(false);
    }
  }

  countOf(entry: PartnerReportEntry, part: PartnerReportSale | PartnerReportBuyback): string { return partCount(entry, part); }
  piecesOf(entry: PartnerReportEntry, part: PartnerReportSale | PartnerReportBuyback): string | null { return partPiecesText(entry, part); }
  price(entry: PartnerReportEntry, part: PartnerReportSale | PartnerReportBuyback): string {
    /* A count per piece reads "120 rozen × € 0,50"; another unit names the piece: "3 omdozen × € 0,50 per roos". */
    const unit = unitOf(entry, part.enteredUnit);
    const inPieces = unit ? unit.unit === 'STUK' : piecesPerSalesUnit(entry) === 1;
    return priceEuro(partPiecePrice(entry, part)) + (inPieces ? '' : ' per ' + pieceNoun(entry));
  }
  eur(value: number): string { return euro(value); }
  minus(value: number): string { return minusEuro(value); }
  pct(value: number): string { return percent(value); }
}
