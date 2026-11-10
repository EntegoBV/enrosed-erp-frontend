import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { PartnerReportEntry } from '../../core/api/partner-portal-api';
import type { PartnerReportPart, StaffPartnerReport } from '../../core/api/partner-sales-api';
import { count, euro, longDate, minusEuro, percent, units } from '../partner/partner-format';
import { partsBySource, timeOf, whoOf } from './partner-sales-format';

const UNIT_PRICE = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 4 });

/**
 * One melding opened up for staff: per product what sold at which average and
 * what came back on the clock, the costs down to Netto, and the parts per
 * source (a partner container or our own stock) with the invoice each went
 * on. Desk: inside the expanded row; phone: the body of the melding's sheet.
 * Intrekken is the host's (it asks the reason).
 */
@Component({
  selector: 'app-partner-sales-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    @let r = report();
    @let t = r.totals;
    @if (variant() === 'desk') {
      <div class="vd">
        <div class="vd__main">
          <div class="vd-entries" role="table" aria-label="Producten">
            @for (entry of r.entries; track entry.productId) {
              @if (entry.sale; as sale) {
                <div class="vd-entry" role="row">
                  <span class="vd-entry__name" role="cell"><b>{{ entry.name }}</b>@if (entry.variant) { <span> · {{ entry.variant }}</span> }</span>
                  <span class="vd-num" role="cell">{{ unitsOf(entry, sale.quantity) }} × {{ unitPrice(sale.unitPriceEur) }}</span>
                  <span class="vd-num" role="cell">{{ eur(sale.grossEur) }}</span>
                  <span class="vd-num vd-strong" role="cell">{{ eur(sale.netEur) }}</span>
                </div>
              }
              @if (entry.buyback; as buyback) {
                <div class="vd-entry vd-entry--back" role="row">
                  <span class="vd-entry__name" role="cell">@if (!entry.sale) { <b>{{ entry.name }}</b>@if (entry.variant) { <span> · {{ entry.variant }}</span> } · } teruggekocht</span>
                  <span class="vd-num" role="cell">{{ unitsOf(entry, buyback.quantity) }} × {{ unitPrice(buyback.unitPriceEur) }}</span>
                  <span class="vd-num" role="cell"></span>
                  <span class="vd-num" role="cell">{{ minus(buyback.grossEur) }}</span>
                </div>
              }
            }
          </div>

          <div class="vd-sources">
            @for (group of sources(); track group.key) {
              <div class="vd-source">
                <span class="vd-source__head">
                  @if (group.purchaseOrderId != null) { <a class="wk-link" [routerLink]="['/purchasing', group.purchaseOrderId]">{{ group.label }}</a> }
                  @else { {{ group.label }} }
                </span>
                @for (part of group.parts; track part.id) {
                  <span class="vd-part">
                    <span class="vd-part__what">{{ partWhat(part) }}</span>
                    <span class="vd-num">{{ part.lineType === 'BUYBACK' ? minus(part.grossEur) : eur(part.netEur) }}</span>
                    <span class="vd-part__state">
                      @if (part.invoiceId != null && !part.open) {
                        <a class="wk-link" [routerLink]="['/sales', part.invoiceId]">{{ part.invoiceNumber || 'Factuur' }}</a>
                      } @else if (r.status === 'VOIDED') { <span class="vd-muted">ingetrokken</span> }
                      @else { <span class="vd-open">nog te factureren</span> }
                    </span>
                  </span>
                }
              </div>
            }
          </div>

          <p class="vd-meta">{{ metaLine() }}</p>
          @if (r.status === 'VOIDED') { <p class="vd-meta vd-void">{{ voidLine() }}</p> }
          @if (r.note) { <p class="vd-meta">{{ r.note }}</p> }
        </div>

        <aside class="vd__side">
          <dl class="wk-equation">
            @if (t.saleQuantity > 0) {
              <div><dt>Bruto</dt><dd>{{ eur(t.grossEur) }}</dd></div>
              @if (r.channel === 'AUCTION') {
                <div class="is-sub"><dt>Veilingcommissie {{ pct(r.commissionPct) }}</dt><dd>{{ minus(t.commissionEur) }}</dd></div>
                <div class="is-sub"><dt>Transport {{ pct(r.transportPct) }}</dt><dd>{{ minus(t.transportEur) }}</dd></div>
              }
              @if (r.extraCost; as extra) {
                <div class="is-sub"><dt>Extra kost{{ extra.mode === 'PCT' ? ' ' + pct(extra.value) : '' }}</dt><dd>{{ minus(t.extraCostEur) }}</dd></div>
              }
            }
            @if (t.buybackQuantity > 0) {
              <div class="is-sub"><dt>Terugkoopkost · {{ num(t.buybackQuantity) }} terug</dt><dd>{{ minus(t.buybackEur) }}</dd></div>
            }
            <div class="is-total"><dt>Netto</dt><dd>{{ eur(t.netEur) }}</dd></div>
          </dl>
          @if (r.status === 'OPEN') {
            <button class="wk-btn wk-btn--sm wk-btn--danger vd-void-btn" type="button" [disabled]="!r.canUndo || busy()"
                    [attr.title]="r.canUndo ? null : undoBlocked" (click)="voidAsked.emit(r)">Intrekken</button>
            @if (!r.canUndo) { <p class="vd-meta">{{ undoBlocked }}</p> }
          }
        </aside>
      </div>
    } @else {
      <div class="vp">
        <p class="vp-meta">{{ metaLine() }}</p>
        @if (r.status === 'VOIDED') { <p class="vp-meta vd-void">{{ voidLine() }}</p> }

        <section class="ios-section">
          <div class="ios-section__head"><h2>Producten</h2></div>
          <div class="ios-group">
            @for (entry of r.entries; track entry.productId) {
              <div class="ios-cell vp-cell">
                <span class="ios-cell__body">
                  <span class="ios-cell__title ios-cell__title--2">{{ entry.name }}@if (entry.variant) { · {{ entry.variant }} }</span>
                  @if (entry.sale; as sale) { <span class="ios-cell__sub">{{ unitsOf(entry, sale.quantity) }} × {{ unitPrice(sale.unitPriceEur) }}</span> }
                  @if (entry.buyback; as buyback) { <span class="ios-cell__sub">Terug {{ unitsOf(entry, buyback.quantity) }} × {{ unitPrice(buyback.unitPriceEur) }}</span> }
                </span>
                <span class="ios-cell__trail"><span class="ios-cell__value vp-fig">{{ entryNet(entry) }}</span></span>
              </div>
            }
          </div>
        </section>

        <section class="ios-section">
          <div class="ios-section__head"><h2>Kosten</h2></div>
          <div class="ios-group">
            @if (t.saleQuantity > 0) {
              <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Bruto</span></span><span class="ios-cell__value vp-fig">{{ eur(t.grossEur) }}</span></div>
              @if (r.channel === 'AUCTION') {
                <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Veilingcommissie {{ pct(r.commissionPct) }}</span></span><span class="ios-cell__value">{{ minus(t.commissionEur) }}</span></div>
                <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Transport {{ pct(r.transportPct) }}</span></span><span class="ios-cell__value">{{ minus(t.transportEur) }}</span></div>
              }
              @if (r.extraCost; as extra) {
                <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Extra kost{{ extra.mode === 'PCT' ? ' ' + pct(extra.value) : '' }}</span></span><span class="ios-cell__value">{{ minus(t.extraCostEur) }}</span></div>
              }
            }
            @if (t.buybackQuantity > 0) {
              <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Terugkoopkost</span></span><span class="ios-cell__value">{{ minus(t.buybackEur) }}</span></div>
            }
            <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title vp-strong">Netto</span></span><span class="ios-cell__value vp-fig vp-strong">{{ eur(t.netEur) }}</span></div>
          </div>
        </section>

        <section class="ios-section">
          <div class="ios-section__head"><h2>Per bron</h2></div>
          <div class="ios-group">
            @for (group of sources(); track group.key) {
              @for (part of group.parts; track part.id) {
                @if (part.invoiceId != null && !part.open) {
                  <a class="ios-cell vp-cell" [routerLink]="['/sales', part.invoiceId]">
                    <span class="ios-cell__body"><span class="ios-cell__title">{{ group.label }}</span><span class="ios-cell__sub">{{ partWhat(part) }}</span></span>
                    <span class="ios-cell__trail"><span class="ios-cell__value vp-fig vp-tint tone-green">{{ part.invoiceNumber || 'Factuur' }}</span></span>
                  </a>
                } @else {
                  <div class="ios-cell vp-cell">
                    <span class="ios-cell__body"><span class="ios-cell__title">{{ group.label }}</span><span class="ios-cell__sub">{{ partWhat(part) }}</span></span>
                    <span class="ios-cell__trail"><span class="ios-cell__value vp-fig vp-tint" [class.tone-amber]="r.status !== 'VOIDED'" [class.tone-grey]="r.status === 'VOIDED'">
                      {{ part.lineType === 'BUYBACK' ? minus(part.grossEur) : eur(part.netEur) }}</span></span>
                  </div>
                }
              }
            }
          </div>
        </section>
        @if (r.note) { <p class="vp-meta">{{ r.note }}</p> }
      </div>
    }
  `,
  styles: `
    :host{display:block;min-width:0}
    .vd{display:grid;grid-template-columns:minmax(0,1fr) 250px;gap:20px;padding:12px 16px 16px;background:var(--surface-2)}
    .vd__main{display:grid;align-content:start;gap:12px;min-width:0}
    .vd__side{display:grid;align-content:start;gap:8px;min-width:0}
    .vd-entries{display:grid;border:1px solid var(--line);border-radius:10px;background:var(--surface)}
    .vd-entry{display:grid;grid-template-columns:minmax(0,1fr) auto 84px 84px;align-items:baseline;gap:10px;padding:7px 12px;border-top:1px solid var(--line);font-size:13px}
    .vd-entry:first-child{border-top:0}
    .vd-entry--back{color:var(--ink-2);font-size:12.5px}
    .vd-entry__name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .vd-entry__name b{font-weight:650}
    .vd-entry__name span{color:var(--muted)}
    .vd-num{font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
    .vd-strong{font-weight:700}
    .vd-sources{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:8px}
    .vd-source{display:grid;gap:2px;padding:8px 12px;border:1px solid var(--line);border-radius:10px;background:var(--surface);font-size:12.5px}
    .vd-source__head{margin-bottom:2px;color:var(--ink-2);font-size:12px;font-weight:700}
    .vd-part{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:baseline;gap:8px}
    .vd-part__what{min-width:0;overflow:hidden;color:var(--ink-2);text-overflow:ellipsis;white-space:nowrap}
    .vd-part__state{min-width:96px;text-align:right;white-space:nowrap}
    .vd-open{color:var(--warn);font-weight:650}
    .vd-muted{color:var(--muted)}
    .vd-meta{margin:0;color:var(--muted);font-size:12.5px;line-height:1.45;overflow-wrap:anywhere}
    .vd-void{color:var(--ink-2)}
    .vd-void-btn{justify-self:end}
    .vd__side .wk-equation>div{padding:4px 0}
    .vp{display:block}
    .vp-meta{margin:0 calc(var(--ios-inset,16px) + 4px) 14px;color:var(--muted);font-size:13.5px;line-height:1.4;overflow-wrap:anywhere}
    .vp-cell{min-height:60px}
    .vp-fig{color:var(--ink);font-weight:600}
    .vp-strong{font-weight:750}
    .vp-tint{padding:3px 10px;border-radius:999px;background:color-mix(in srgb,var(--tone) 14%,var(--surface));color:color-mix(in srgb,var(--tone) 85%,var(--ink));font-size:15px}
  `,
})
export class PartnerSalesDetail {
  readonly report = input.required<StaffPartnerReport>();
  readonly variant = input<'desk' | 'ios'>('desk');
  readonly busy = input(false);
  readonly voidAsked = output<StaffPartnerReport>();

  readonly undoBlocked = 'Een terugkoop hoort bij deze verkoop: trek eerst die terugkoop in.';

  readonly sources = computed(() => partsBySource(this.report()));

  /** "Gemeld door Frans · 10 november 2026 · 14:05". */
  readonly metaLine = computed(() => {
    const r = this.report();
    const who = whoOf(r);
    return [who ? `Gemeld door ${who}` : 'Gemeld', longDate(r.soldOn), timeOf(r.createdAt)].filter(Boolean).join(' · ');
  });

  readonly voidLine = computed(() => {
    const r = this.report();
    const by = r.voidedBy?.trim();
    return `Ingetrokken${by ? ' door ' + by : ''}${r.voidReason?.trim() ? ': ' + r.voidReason.trim() : ''}`;
  });

  /** "Rozen M · 60 stuks" or "Rozen M · 1 terug". */
  partWhat(part: PartnerReportPart): string {
    const entry = this.report().entries.find((candidate) => candidate.productId === part.productId);
    const name = part.variant ? `${part.name} · ${part.variant}` : part.name;
    const amount = entry ? units(part.quantity, entry) : `${count(part.quantity)} st`;
    return part.lineType === 'BUYBACK' ? `${name} · ${amount} terug` : `${name} · ${amount}`;
  }

  entryNet(entry: PartnerReportEntry): string {
    const sale = entry.sale?.netEur ?? 0;
    const back = entry.buyback?.grossEur ?? 0;
    return euro(Math.round((sale - back) * 100) / 100);
  }

  unitsOf(entry: PartnerReportEntry, quantity: number): string { return units(quantity, entry); }
  unitPrice(value: number): string { return UNIT_PRICE.format(Number(value) || 0); }
  eur(value: number): string { return euro(value); }
  minus(value: number): string { return minusEuro(value); }
  pct(value: number): string { return percent(value); }
  num(value: number): string { return count(value); }
}
