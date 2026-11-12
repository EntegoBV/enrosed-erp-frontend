import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { PartnerInvoicePreview, PartnerInvoicePreviewGroup, PartnerInvoicePreviewLine } from '../../core/api/partner-sales-api';
import { count, euro, minusEuro, percent } from '../partner/partner-format';

/**
 * Factureren, step 2: the server's preview of the chosen meldingen, one
 * group per concept (a container settlement, one invoice for own stock).
 * Per group the lines (pieces, bruto, kosten, terugkoop, netto opbrengst,
 * inkoopkost, ons deel) and the way to the invoice: Netto opbrengst −
 * Inkoopkost (Verhoeven x % · Enrosed y %) = Winst → Enrosed z % /
 * Verhoeven; Ons deel − Voorschot = Te factureren. Every figure is the
 * server's (an older server without them shows Ons deel − Voorschot only);
 * nothing is recomputed here. ERP only, never in the partner's portal.
 */
@Component({
  selector: 'app-partner-sales-invoice-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let p = preview();
    @if (!p.groups.length && !p.skipped.length) {
      <p class="pv-none">Niets te factureren in deze keuze.</p>
    }
    @for (warning of p.warnings ?? []; track $index) { <p class="pv-warn">{{ warning }}</p> }
    @for (group of p.groups; track groupKey(group)) {
      @let full = hasFigures(group);
      <section class="pv-group" [class.is-blocked]="!!group.blocked">
        <header class="pv-group__head">
          <b>{{ title(group) }}</b>
          @if (!group.blocked) {
            @if (group.source === 'CONTAINER') { <span class="wk-pill" [class.tone-blue]="group.finalSettlement">{{ group.finalSettlement ? 'Slotfactuur' : 'Deelfactuur' }}</span> }
            @else { <span class="wk-pill">Factuur</span> }
          }
        </header>
        <div class="pv-lines" [class.pv-lines--full]="full" role="table" [attr.aria-label]="'Regels ' + title(group)">
          <div class="pv-line pv-line--head" role="row">
            <span role="columnheader" class="pv-line__name">Product</span><span role="columnheader">Stuks</span>
            @if (full) {
              <span role="columnheader" class="pv-hide">Bruto</span><span role="columnheader" class="pv-hide">Kosten</span>
              <span role="columnheader" class="pv-hide">Terugkoop</span>
            }
            <span role="columnheader"><span class="pv-long">Netto opbr.</span><span class="pv-short">Netto</span></span><span role="columnheader" class="pv-hide">Inkoopkost</span><span role="columnheader">Ons deel</span>
          </div>
          @for (line of group.lines; track line.productId) {
            <div class="pv-line" role="row">
              <span class="pv-line__name" role="cell">{{ line.name }}@if (line.variant) { <small> · {{ line.variant }}</small> }
                @if (line.buybackQuantity > 0) { <small class="pv-line__sub">{{ soldBack(line) }}</small> }
                @if (line.absorbedEur) { <small class="pv-line__sub">{{ line.absorbedEur > 0 ? 'overgenomen' : 'overgedragen' }} {{ eur(abs(line.absorbedEur)) }}</small> }</span>
              <span role="cell">{{ num(pieces(line)) }}</span>
              @if (full) {
                <span role="cell" class="pv-hide">{{ money(line.grossEur) }}</span>
                <span role="cell" class="pv-hide">{{ costsOf(line) ? eur(costsOf(line)!) : '—' }}</span>
                <span role="cell" class="pv-hide">{{ line.buybackEur ? eur(line.buybackEur) : '—' }}</span>
              }
              <span role="cell">{{ eur(line.proceedsEur) }}</span>
              <span role="cell" class="pv-hide">{{ money(line.costEur) }}</span>
              <span role="cell" class="pv-strong">{{ money(line.valueEur) }}</span>
            </div>
          }
        </div>
        @if (group.blocked) {
          <p class="pv-bad" role="alert">Wordt niet gemaakt: {{ group.blocked }}</p>
        } @else {
          <dl class="wk-equation pv-sum">
            @if (full) {
              <div><dt>Netto opbrengst</dt><dd>{{ money(group.proceedsEur) }}</dd></div>
              <div class="is-sub"><dt>Inkoopkost<small>{{ costShare(group) }}</small></dt><dd>{{ minus(group.costEur) }}</dd></div>
              <div class="pv-mid"><dt>Winst</dt><dd>{{ signed(group.profitEur) }}</dd></div>
              <div class="is-sub"><dt>→ Enrosed{{ share(group) }}</dt><dd>{{ signed(group.enrosedProfitEur) }}</dd></div>
              @if (group.partnerProfitEur != null) { <div class="is-sub"><dt>→ {{ partner() }}</dt><dd>{{ signed(group.partnerProfitEur) }}</dd></div> }
            }
            <div [class.pv-mid]="full"><dt>Ons deel</dt><dd>{{ money(group.valueEur) }}</dd></div>
            @if (group.correctionEur) { <div class="is-sub"><dt>waarvan correctie eerdere deelfacturen</dt><dd>{{ eur(group.correctionEur) }}</dd></div> }
            @if ((group.advanceEur ?? 0) !== 0) { <div class="is-sub"><dt>Voorschot verrekend</dt><dd>{{ minus(group.advanceEur) }}</dd></div> }
            <div class="is-total"><dt>Te factureren</dt><dd>{{ money(group.balanceEur) }}</dd></div>
          </dl>
        }
        @for (warning of group.warnings; track $index) { <p class="pv-warn">{{ warning }}</p> }
      </section>
    }
    @if (p.skipped.length) {
      <section class="pv-group pv-group--wait">
        <header class="pv-group__head"><b>Wacht nog</b></header>
        @for (skip of p.skipped; track $index) {
          <p class="pv-skip"><b>{{ skip.name }}</b> · {{ skip.source === 'OWN' ? 'eigen voorraad' : containerOf(skip.purchaseOrderId, skip.containerName) }}<br />{{ skip.reason }}</p>
        }
      </section>
    }
  `,
  styles: `
    :host{display:grid;gap:12px;min-width:0}
    .pv-none{margin:0;color:var(--muted);font-size:13.5px}
    .pv-group{display:grid;gap:8px;padding:12px 14px;border:1px solid var(--line);border-radius:14px;background:var(--surface)}
    .pv-group.is-blocked{border-color:#efcdc9}
    .pv-group--wait{background:var(--surface-2)}
    .pv-group__head{display:flex;align-items:center;gap:8px;min-width:0}
    .pv-group__head b{min-width:0;overflow:hidden;font-size:14.5px;text-overflow:ellipsis;white-space:nowrap}
    .pv-lines{display:grid}
    .pv-line{display:grid;grid-template-columns:minmax(0,1fr) 56px 96px 88px 92px;align-items:baseline;gap:8px;padding:6px 0;border-top:1px solid var(--line);font-size:13px;font-variant-numeric:tabular-nums}
    .pv-lines--full .pv-line{grid-template-columns:minmax(0,1fr) 56px 84px 76px 80px 92px 84px 88px}
    .pv-line>span:not(.pv-line__name){text-align:right;white-space:nowrap}
    .pv-line--head{border-top:0;color:var(--muted);font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase}
    .pv-short{display:none}
    .pv-line__name{min-width:0;overflow-wrap:anywhere}
    .pv-line__name small{color:var(--muted);font-size:12px}
    .pv-line__sub{display:block}
    .pv-strong{font-weight:700}
    .pv-sum{width:100%;max-width:400px;margin-left:auto}
    .pv-sum>div{padding:3px 0}
    .pv-sum dt small{display:block;color:var(--muted);font-size:11.5px;font-weight:500}
    .pv-mid{border-top:1px solid var(--line);font-weight:650}
    .pv-bad{margin:0;color:var(--danger);font-size:13px;font-weight:600;line-height:1.4}
    .pv-warn{margin:0;color:#7c450b;font-size:13px;line-height:1.4}
    .pv-skip{margin:0;color:var(--ink-2);font-size:13px;line-height:1.45}
    @media (max-width: 679.98px), (hover: none) and (max-width: 1023.98px){
      .pv-line,.pv-lines--full .pv-line{grid-template-columns:minmax(0,1fr) 48px 84px 84px;font-size:14px}
      .pv-line--head{font-size:11.5px;letter-spacing:.02em}
      .pv-hide,.pv-long{display:none}
      .pv-short{display:inline}
      .pv-sum{max-width:none}
    }
  `,
})
export class PartnerSalesInvoicePreview {
  readonly preview = input.required<PartnerInvoicePreview>();
  /** "Verhoeven": the partner's short name for the split lines. */
  readonly partner = input('partner');
  /** The container's name as sales know it, for a group or a waiting product without one. */
  readonly containerName = input<(id: number) => string | null>(() => null);
  /** A container group's share when the server leaves it out (an older server). */
  readonly shareFallback = input<(group: PartnerInvoicePreviewGroup) => number | null>(() => null);

  /** The round-2 figures are there (an older server sends only Ons deel, Voorschot, Te factureren). */
  hasFigures(group: PartnerInvoicePreviewGroup): boolean {
    return group.proceedsEur != null && group.costEur != null && group.profitEur != null;
  }

  groupKey(group: PartnerInvoicePreviewGroup): string {
    return group.purchaseOrderId == null ? 'own' : `po-${group.purchaseOrderId}`;
  }

  title(group: PartnerInvoicePreviewGroup): string {
    return group.source === 'OWN' ? 'Eigen voorraad' : this.containerOf(group.purchaseOrderId, group.containerName);
  }

  containerOf(purchaseOrderId: number | null, name?: string | null): string {
    if (purchaseOrderId == null) return 'Eigen voorraad';
    return name?.trim() || this.containerName()(purchaseOrderId) || `Inkoop #${purchaseOrderId}`;
  }

  /** "Verhoeven 100 % · Enrosed 0 %" (who financed the cost); own stock "Enrosed 100 %". */
  costShare(group: PartnerInvoicePreviewGroup): string {
    if (group.source === 'OWN') return 'Enrosed 100 %';
    const pct = group.costSharePct;
    if (pct == null) return '';
    return `${this.partner()} ${percent(pct)} · Enrosed ${percent(Math.round((100 - pct) * 100) / 100)}`;
  }

  /** " 50 %": our share of the profit, when known. */
  share(group: PartnerInvoicePreviewGroup): string {
    const pct = group.profitSharePct ?? (group.source === 'OWN' ? this.preview().profitSharePct : this.shareFallback()(group));
    return pct == null ? '' : ` ${percent(pct)}`;
  }

  /** The line's quantity in pieces (sold − bought back); sales units when the server sends no pieces. */
  pieces(line: PartnerInvoicePreviewLine): number {
    if (line.salePieces != null && line.soldQuantity > 0) return Math.round(line.quantity * line.salePieces / line.soldQuantity);
    return line.quantity;
  }

  /** "120 verkocht − 6 terug" in pieces. */
  soldBack(line: PartnerInvoicePreviewLine): string {
    const per = line.salePieces != null && line.soldQuantity > 0 ? line.salePieces / line.soldQuantity : 1;
    return `${count(Math.round(line.soldQuantity * per))} verkocht − ${count(Math.round(line.buybackQuantity * per))} terug`;
  }

  costsOf(line: PartnerInvoicePreviewLine): number | null {
    if (line.commissionEur == null && line.transportEur == null && line.extraEur == null) return null;
    return Math.round(((line.commissionEur ?? 0) + (line.transportEur ?? 0) + (line.extraEur ?? 0)) * 100) / 100;
  }

  abs(value: number): number { return Math.abs(value); }
  eur(value: number): string { return euro(value); }
  /** A figure that may be below zero: "− € 1.172,72". */
  signed(value: number | null | undefined): string {
    if (value == null) return '—';
    return value < 0 ? '− ' + euro(-value) : euro(value);
  }

  /** A figure of the preview; "—" where the server computed none. */
  money(value: number | null | undefined): string { return value == null ? '—' : euro(value); }
  minus(value: number | null | undefined): string { return value == null ? '—' : minusEuro(value); }
  num(value: number): string { return count(value); }
}
