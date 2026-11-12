import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { PartnerPortalApi, PartnerReport, PartnerReportEntry } from '../../core/api/partner-portal-api';
import { messageOf } from '../../core/api/errors';
import { Icon } from '../../shared/icon';
import { Sheet, Ui } from '../../shared/ui';
import {
  KIND_ICON, KIND_LABEL, KIND_TONE, STATUS_LABEL, STATUS_TONE, euro, longDate, minusEuro, percent, reportKind, units,
} from './partner-format';
import { PartnerPhoto } from './partner-photo';

const UNIT_PRICE = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 4 });

/**
 * One melding: per product what sold at which average and what came back on
 * the clock, the costs and Netto, and "Ongedaan maken" while nothing of it is
 * invoiced (the server decides: canUndo).
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
          <span class="pill {{ statusTone[r.status] }}">{{ statusLabel[r.status] }}</span>
        </div>
        <p class="meta">{{ date(r.soldOn) }}@if (r.createdByName) { · gemeld door {{ r.createdByName }} }</p>

        <div class="entries">
          @for (entry of r.entries; track entry.productId) {
            <div class="entry">
              <app-partner-photo class="entry__photo" [product]="entry" />
              <div class="entry__body">
                <strong>{{ entry.name }}</strong>
                @if (entry.variant) { <span class="entry__variant">{{ entry.variant }}</span> }
                @if (entry.sale; as sale) {
                  <div class="fact"><span>{{ unitsOf(entry, sale.quantity) }} × {{ unitPrice(sale.unitPriceEur) }}</span><b>{{ eur(sale.grossEur) }}</b></div>
                }
                @if (entry.buyback; as buyback) {
                  <div class="fact fact--buyback"><span>Teruggekocht {{ unitsOf(entry, buyback.quantity) }} × {{ unitPrice(buyback.unitPriceEur) }}</span><b>{{ minus(buyback.grossEur) }}</b></div>
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
            @if (r.extraCost; as extra) {
              <div class="line"><span>Extra kost{{ extra.mode === 'PCT' ? ' ' + pct(extra.value) : '' }}</span><span>{{ minus(t.extraCostEur) }}</span></div>
            }
          }
          @if (t.buybackQuantity > 0) {
            <div class="line"><span>Terugkoopkost</span><span>{{ minus(t.buybackEur) }}</span></div>
          }
          <div class="line line--total"><span>Netto</span><b>{{ eur(t.netEur) }}</b></div>
        </div>
        @if (undoBlocker(); as why) { <p class="why">{{ why }}</p> }
        @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
      </div>
      <div foot class="foot">
        @if (r.canUndo && r.status === 'OPEN') {
          <button class="ios-capsule ios-capsule--block undo" type="button" [disabled]="busy()" (click)="askUndo()">
            {{ busy() ? 'Bezig…' : 'Ongedaan maken' }}
          </button>
        } @else {
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
    .entries{display:grid;gap:2px;overflow:hidden;border-radius:18px;background:var(--surface)}
    .entry{display:grid;grid-template-columns:48px minmax(0,1fr);gap:12px;padding:12px 14px}
    .entry+.entry{box-shadow:inset 0 .5px 0 var(--ios-sep,rgb(60 50 45/16%))}
    .entry__photo{width:48px;height:48px;border-radius:12px}
    .entry__body{display:grid;gap:3px;min-width:0}
    .entry__body strong{font-size:15.5px;font-weight:650}
    .entry__variant{color:var(--muted);font-size:13px}
    .fact{display:flex;justify-content:space-between;gap:10px;color:var(--ink-2);font-size:14px;font-variant-numeric:tabular-nums}
    .fact b{color:var(--ink);font-weight:700;white-space:nowrap}
    .fact--buyback{color:#7c4a0b}
    .cost{display:grid;padding:6px 16px 10px;border-radius:18px;background:var(--surface)}
    .line{display:flex;justify-content:space-between;gap:10px;padding:7px 0;color:var(--ink-2);font-size:15px;font-variant-numeric:tabular-nums}
    .line--total{margin-top:4px;padding-top:10px;border-top:1px solid var(--line);color:var(--ink);font-size:17px;font-weight:700}
    .line--total b{font-size:20px;font-weight:800}
    .error{padding:12px 14px;border-radius:16px;background:var(--danger-soft);color:#83261e;font-size:15px;line-height:1.4}
    .why{margin:0;padding:0 4px;color:var(--ink-2);font-size:14.5px;line-height:1.4}
    .foot{display:grid;width:100%}
    .undo{color:var(--danger)}
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

  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  readonly statusLabel = STATUS_LABEL;
  readonly statusTone = STATUS_TONE;
  private readonly kind = computed(() => reportKind(this.report()));
  readonly label = computed(() => KIND_LABEL[this.kind()]);
  readonly icon = computed(() => KIND_ICON[this.kind()]);
  readonly tone = computed(() => KIND_TONE[this.kind()]);

  /**
   * Why an open melding cannot be undone: a later buyback of one of its products took back pieces of this sale
   * (the server mirrors a buyback on the newest open sale). He can undo that buyback himself; the line names it
   * when exactly one shown melding fits.
   */
  readonly undoBlocker = computed<string | null>(() => {
    const report = this.report();
    if (report.canUndo || report.status !== 'OPEN') return null;
    const sold = new Set(report.entries.filter((entry) => entry.sale).map((entry) => entry.productId));
    const later = this.related().filter((other) => other.id > report.id && other.status === 'OPEN' && other.canUndo
      && other.entries.some((entry) => entry.buyback && sold.has(entry.productId)));
    return later.length === 1
      ? `Terugkoop ${later[0].number} hoort bij deze verkoop. Maak eerst ${later[0].number} ongedaan.`
      : 'Een latere terugkoop hoort bij deze verkoop. Maak die eerst ongedaan.';
  });

  askUndo(): void {
    const report = this.report();
    this.ui.confirm({
      title: `${report.number} ongedaan maken?`,
      message: 'De melding wordt ingetrokken en de voorraad gezet zoals ze ervoor was.',
      confirmLabel: 'Ongedaan maken',
      danger: true,
    }, () => void this.undo());
  }

  private async undo(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const voided = await this.api.voidReport(this.report().id);
      this.ui.toast(`${voided.number} ongedaan gemaakt`);
      this.changed.emit(voided);
    } catch (failure: unknown) {
      this.error.set(messageOf(failure, 'Ongedaan maken lukt nu niet. Probeer het opnieuw.'));
    } finally {
      this.busy.set(false);
    }
  }

  unitsOf(entry: PartnerReportEntry, quantity: number): string { return units(quantity, entry); }
  unitPrice(value: number): string { return UNIT_PRICE.format(Number(value) || 0); }
  eur(value: number): string { return euro(value); }
  minus(value: number): string { return minusEuro(value); }
  pct(value: number): string { return percent(value); }
  date(iso: string): string { return longDate(iso); }
}
