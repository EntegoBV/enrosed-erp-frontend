import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { PartnerExtraCostLine, PartnerReportBuyback, PartnerReportEntry, PartnerReportSale } from '../../core/api/partner-portal-api';
import type { PartnerReportPart, StaffPartnerReport } from '../../core/api/partner-sales-api';
import { count, euro, longDate, minusEuro, percent, priceEuro, productTitle, units } from '../partner/partner-format';
import { partCount, partPiecePrice, partPiecesText, pieceNoun } from '../partner/partner-report-format';
import { shortDay } from './partner-sales-filters';
import { partsBySource, timeOf, whoOf } from './partner-sales-format';

/** A cost line as staff get it: round 2 also sends what it costs in euros. */
type CostLine = PartnerExtraCostLine & { amountEur?: number | null };

interface CostRow { label: string; amount: number }

/**
 * One melding opened up for staff: per product what was typed ("120 rozen",
 * "3 omdozen = 144 rozen") at which price per piece, the buyback on the clock
 * with its commission and transport, the extra kost lines with their
 * description, the buyer of a direct sale, the parts per source (a partner
 * container or our own stock) with the document each went on, who reported,
 * changed and confirmed it. Desk: inside the expanded row with Bewerken,
 * Bevestigen / Terugzetten and Intrekken; phone: the body of the sheet (the
 * page puts the buttons in its foot).
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
                  <span class="vd-entry__name" role="cell"><b>{{ name(entry) }}</b></span>
                  <span class="vd-num" role="cell">{{ countOf(entry, sale) }}@if (piecesOf(entry, sale); as p) { <small> {{ p }}</small> }</span>
                  <span class="vd-num vd-muted" role="cell">× {{ price(entry, sale) }}</span>
                  <span class="vd-num" role="cell">{{ eur(sale.grossEur) }}</span>
                </div>
              }
              @if (entry.buyback; as buyback) {
                <div class="vd-entry vd-entry--back" role="row">
                  <span class="vd-entry__name" role="cell">↳ @if (!entry.sale) { <b>{{ name(entry) }}</b> · } teruggekocht op de klok</span>
                  <span class="vd-num" role="cell">{{ countOf(entry, buyback) }}</span>
                  <span class="vd-num vd-muted" role="cell">× {{ price(entry, buyback) }}</span>
                  <span class="vd-num" role="cell" [attr.title]="buybackTitle(buyback)">{{ minus(buybackCost(buyback)) }}</span>
                </div>
              }
            }
          </div>

          @if (r.buyer; as buyer) {
            <p class="vd-buyer">Klant <a class="wk-link" [routerLink]="['/customers']" [queryParams]="{ klant: buyer.customerId }">{{ buyer.company }}</a>@if (buyer.city) { · {{ buyer.city }} }</p>
          }

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
                    <span class="vd-num">{{ part.lineType === 'BUYBACK' ? minus(-part.netEur) : eur(part.netEur) }}</span>
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

          @for (line of metaLines(); track $index) { <p class="vd-meta">{{ line }}</p> }
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
              @for (row of costRows(); track $index) {
                <div class="is-sub"><dt>{{ row.label }}</dt><dd>{{ minus(row.amount) }}</dd></div>
              }
            }
            @if (t.buybackQuantity > 0) {
              <div class="is-sub"><dt>Terugkoopkost<small>incl. commissie en transport</small></dt><dd>{{ minus(t.buybackEur) }}</dd></div>
            }
            <div class="is-total"><dt>Netto</dt><dd>{{ eur(t.netEur) }}</dd></div>
          </dl>
          @if (r.status !== 'VOIDED' && !r.revisionOf) {
            <div class="vd-actions">
              @if (canConfirm()) {
                <button class="wk-btn wk-btn--sm wk-btn--primary" type="button" [disabled]="busy() || !canWrite()" (click)="confirmAsked.emit(r)">Bevestigen</button>
              } @else if (canUnconfirm()) {
                <button class="wk-btn wk-btn--sm" type="button" [disabled]="busy() || !canWrite()" (click)="unconfirmAsked.emit(r)">Terugzetten</button>
              }
              @if (r.status === 'OPEN') {
                <button class="wk-btn wk-btn--sm" type="button" [disabled]="busy() || !r.canEdit || !canWrite()" (click)="editAsked.emit(r)">Bewerken</button>
                <button class="wk-btn wk-btn--sm wk-btn--danger" type="button" [disabled]="!r.canUndo || busy()" (click)="voidAsked.emit(r)">Intrekken</button>
              }
            </div>
            @if (blockedLine(); as why) { <p class="vd-meta vd-why">{{ why }}</p> }
          }
        </aside>
      </div>
    } @else {
      <div class="vp">
        @for (line of metaLines(); track $index) { <p class="vp-meta">{{ line }}</p> }

        <section class="ios-section">
          <div class="ios-section__head"><h2>Producten</h2></div>
          <div class="ios-group">
            @for (entry of r.entries; track entry.productId) {
              <div class="ios-cell vp-cell">
                <span class="ios-cell__body">
                  <span class="ios-cell__title ios-cell__title--2">{{ name(entry) }}</span>
                  @if (entry.sale; as sale) { <span class="ios-cell__sub">{{ countOf(entry, sale) }} × {{ price(entry, sale) }}</span> }
                  @if (entry.buyback; as buyback) { <span class="ios-cell__sub">Terug {{ countOf(entry, buyback) }} × {{ price(entry, buyback) }}</span> }
                </span>
                <span class="ios-cell__trail"><span class="ios-cell__value vp-fig">{{ entryNet(entry) }}</span></span>
              </div>
            }
            @if (r.buyer; as buyer) {
              <a class="ios-cell vp-cell" [routerLink]="['/customers']" [queryParams]="{ klant: buyer.customerId }">
                <span class="ios-cell__body"><span class="ios-cell__title">Klant</span><span class="ios-cell__sub">{{ buyer.company }}@if (buyer.city) { · {{ buyer.city }} }</span></span>
                <span class="ios-cell__chevron" aria-hidden="true"></span>
              </a>
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
              @for (row of costRows(); track $index) {
                <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">{{ row.label }}</span></span><span class="ios-cell__value">{{ minus(row.amount) }}</span></div>
              }
            }
            @if (t.buybackQuantity > 0) {
              <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Terugkoopkost</span><span class="ios-cell__sub">incl. commissie en transport</span></span><span class="ios-cell__value">{{ minus(t.buybackEur) }}</span></div>
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
                      {{ part.lineType === 'BUYBACK' ? minus(-part.netEur) : eur(part.netEur) }}</span></span>
                  </div>
                }
              }
            }
          </div>
        </section>
        @if (r.note) { <p class="vp-meta">{{ r.note }}</p> }
        @if (blockedLine(); as why) { <p class="vp-meta">{{ why }}</p> }
      </div>
    }
  `,
  styles: `
    :host{display:block;min-width:0}
    .vd{display:grid;grid-template-columns:minmax(0,1fr) 260px;gap:20px;padding:12px 16px 16px;background:var(--surface-2)}
    .vd__main{display:grid;align-content:start;gap:10px;min-width:0}
    .vd__side{display:grid;align-content:start;gap:8px;min-width:0}
    .vd-entries{display:grid;border:1px solid var(--line);border-radius:10px;background:var(--surface)}
    .vd-entry{display:grid;grid-template-columns:minmax(0,1fr) auto auto 84px;align-items:baseline;gap:12px;padding:7px 12px;border-top:1px solid var(--line);font-size:13px}
    .vd-entry:first-child{border-top:0}
    .vd-entry--back{padding-left:22px;border-top-style:dashed;color:var(--ink-2);font-size:12.5px}
    .vd-entry__name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .vd-entry__name b{font-weight:650}
    .vd-num{font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
    .vd-num small{color:var(--muted);font-size:12px}
    .vd-buyer{margin:0;color:var(--ink-2);font-size:13px}
    .vd-buyer .wk-link{font-size:13px}
    .vd-sources{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:8px}
    .vd-source{display:grid;gap:2px;padding:8px 12px;border:1px solid var(--line);border-radius:10px;background:var(--surface);font-size:12.5px}
    .vd-source__head{margin-bottom:2px;color:var(--ink-2);font-size:12px;font-weight:700}
    .vd-part{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:baseline;gap:8px}
    .vd-part__what{min-width:0;overflow:hidden;color:var(--ink-2);text-overflow:ellipsis;white-space:nowrap}
    .vd-part__state{min-width:96px;text-align:right;white-space:nowrap}
    .vd-open{color:var(--warn);font-weight:650}
    .vd-muted{color:var(--muted)}
    .vd-meta{margin:0;color:var(--muted);font-size:12.5px;line-height:1.45;overflow-wrap:anywhere}
    .vd-why{text-align:right}
    .vd-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:6px}
    .vd__side .wk-equation>div{padding:4px 0}
    .vd__side .wk-equation dt small{display:block;color:var(--muted);font-size:11px;font-weight:500}
    .vp{display:block}
    .vp-meta{margin:0 calc(var(--ios-inset,16px) + 4px) 10px;color:var(--muted);font-size:13.5px;line-height:1.4;overflow-wrap:anywhere}
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
  readonly today = input('');
  /** A round-2 server: the buttons that send round-2 calls are on. */
  readonly canWrite = input(true);
  readonly voidAsked = output<StaffPartnerReport>();
  readonly editAsked = output<StaffPartnerReport>();
  readonly confirmAsked = output<StaffPartnerReport>();
  readonly unconfirmAsked = output<StaffPartnerReport>();

  readonly sources = computed(() => partsBySource(this.report()));

  /** Open and not yet confirmed (a round-1 server sends no editToken: nothing to confirm with). */
  readonly canConfirm = computed(() => canConfirmReport(this.report()));
  readonly canUnconfirm = computed(() => canUnconfirmReport(this.report()));

  /** Reported, changed, confirmed, withdrawn: one line each. */
  readonly metaLines = computed(() => {
    const r = this.report();
    const today = this.today() || r.soldOn;
    const who = whoOf(r);
    const lines = [`Verkocht ${longDate(r.soldOn)} · ${[who ? `gemeld door ${who}` : 'gemeld', this.at(r.createdAt, today)].filter(Boolean).join(' ')}`];
    if (r.updatedAt) lines.push(['Gewijzigd', r.updatedByName ? `door ${r.updatedByName}` : '', this.at(r.updatedAt, today)].filter(Boolean).join(' '));
    if (r.confirmed && r.confirmedAt) lines.push(['Bevestigd', r.confirmedByName ? `door ${r.confirmedByName}` : '', this.at(r.confirmedAt, today)].filter(Boolean).join(' '));
    if (r.status === 'VOIDED') {
      const by = r.voidedBy?.trim();
      lines.push(`Ingetrokken${by ? ' door ' + by : ''}${r.voidReason?.trim() ? ': ' + r.voidReason.trim() : ''}`);
    }
    if (r.revisionOf) lines.push(`Oude versie van VV-${r.revisionOf}`);
    return lines;
  });

  /** The extra kost lines with their own words ("Doosjes", "Extra kost 2 %") and what each costs. */
  readonly costRows = computed<CostRow[]>(() => {
    const r = this.report();
    const lines: CostLine[] = r.extraCosts ?? (r.extraCost ? [{ description: null, ...r.extraCost }] : []);
    const total = r.totals.extraCostEur || 0;
    if (!lines.length) return total ? [{ label: 'Extra kost', amount: total }] : [];
    return lines.map((line) => {
      const label = (line.description?.trim() || 'Extra kost') + (line.mode === 'PCT' ? ` ${percent(line.value)}` : '');
      const amount = line.amountEur ?? (lines.length === 1 ? total
        : line.mode === 'AMOUNT' ? line.value : Math.round(r.totals.grossEur * line.value) / 100);
      return { label, amount };
    });
  });

  /** Why Bewerken or Intrekken is off. */
  readonly blockedLine = computed<string | null>(() => {
    const r = this.report();
    if (r.status !== 'OPEN' || r.revisionOf) return null;
    if (!this.canWrite()) return 'De server wordt bijgewerkt; bewerken en bevestigen kan zo weer.';
    if (r.canEdit === false || !r.canUndo) return 'Een latere terugkoop hoort bij deze verkoop: trek eerst die terugkoop in.';
    return null;
  });

  private at(instant: string | null | undefined, today: string): string {
    if (!instant) return '';
    const date = new Date(instant);
    if (Number.isNaN(date.getTime())) return '';
    const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    return `${shortDay(day, today)} ${timeOf(instant)}`;
  }

  name(entry: PartnerReportEntry): string { return productTitle(entry); }
  countOf(entry: PartnerReportEntry, part: PartnerReportSale | PartnerReportBuyback): string { return partCount(entry, part); }
  piecesOf(entry: PartnerReportEntry, part: PartnerReportSale | PartnerReportBuyback): string | null { return partPiecesText(entry, part); }
  price(entry: PartnerReportEntry, part: PartnerReportSale | PartnerReportBuyback): string {
    return `${priceEuro(partPiecePrice(entry, part))} per ${pieceNoun(entry)}`;
  }

  /** Terugkoopkost of one product: round 2 sends it (gross + commission + transport); round 1 its gross. */
  buybackCost(buyback: PartnerReportBuyback): number {
    return buyback.costEur ?? (buyback.netEur != null ? -buyback.netEur : buyback.grossEur);
  }

  buybackTitle(buyback: PartnerReportBuyback): string | null {
    if (!buyback.commissionEur && !buyback.transportEur) return null;
    return `Klokprijs ${euro(buyback.grossEur)} + commissie ${euro(buyback.commissionEur)} + transport ${euro(buyback.transportEur)}`;
  }

  /** "Rozen M · 60 rozen" or "Rozen M · 6 rozen terug" (pieces when the server sends them). */
  partWhat(part: PartnerReportPart): string {
    const entry = this.report().entries.find((candidate) => candidate.productId === part.productId);
    const name = part.variant ? `${part.name} · ${part.variant}` : part.name;
    const amount = part.pieces != null && entry
      ? `${count(part.pieces)} ${part.pieces === 1 ? entry.pieceOne ?? entry.unitOne : entry.pieceOther ?? entry.unitOther}`
      : entry ? units(part.quantity, entry) : `${count(part.quantity)} st`;
    return part.lineType === 'BUYBACK' ? `${name} · ${amount} terug` : `${name} · ${amount}`;
  }

  entryNet(entry: PartnerReportEntry): string {
    const sale = entry.sale?.netEur ?? 0;
    const back = entry.buyback ? this.buybackCost(entry.buyback) : 0;
    return euro(Math.round((sale - back) * 100) / 100);
  }

  eur(value: number | null | undefined): string { return euro(value); }
  minus(value: number | null | undefined): string { return minusEuro(value); }
  pct(value: number): string { return percent(value); }
}

/** Bevestigen: open, not confirmed, and a round-2 server (it sends the editToken to confirm with). */
export function canConfirmReport(r: StaffPartnerReport): boolean {
  return r.status === 'OPEN' && !r.confirmed && !r.revisionOf && !!r.editToken;
}

/** Terugzetten: confirmed by staff (not only held by a document) and nothing of it on a document. */
export function canUnconfirmReport(r: StaffPartnerReport): boolean {
  return r.status === 'OPEN' && !!r.confirmed && !!r.confirmedAt && !!r.editToken && !r.revisionOf
    && !(r.parts ?? []).some((part) => part.invoiceId != null);
}
