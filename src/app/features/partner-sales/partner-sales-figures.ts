import type { PartnerInvoicePreviewGroup } from '../../core/api/partner-sales-api';
import { signedEur } from '../../shared/signed-eur';
import { minusEuro, percent } from '../partner/partner-format';

/*
 * How a group of the server's Factureren figures reads, one row per line
 * (ERP only, never in the partner's portal), for Factureren step 2 and the
 * melding's "Inkoop en winst" on Veilingverkopen: the owner's "aparte regel
 * volgens % wie wat heeft betaald" and then the profit split.
 *
 *   Netto opbrengst
 *   Inkoopkost                     − € c
 *     → Verhoeven x %                € c·x   (own stock: → Enrosed 100 %)
 *     → Enrosed y %                  € c − c·x
 *   Winst                            € w
 *     → Enrosed z %                  € value − cost   (the server's)
 *     → Verhoeven                    € proceeds − value
 *   Onze waarde (inkoopkost + winst Enrosed), − Voorschot verrekend, = Te factureren
 *
 * Every figure is the server's; only the cost split multiplies the server's
 * costSharePct (to the cent, Enrosed's part the rest so they add up). Amounts
 * below zero read "− € x". Pure.
 */

export interface FigureRow {
  key: string;
  label: string;
  hint: string | null;
  value: string;
  /** line = a plain step, sub = an indented split, mid = an intermediate result, total = what is invoiced. */
  kind: 'line' | 'sub' | 'mid' | 'total';
  negative: boolean;
}

/** The round-2 figures are there (an older server sends only Ons deel, Voorschot, Te factureren). */
export function hasProfitFigures(group: PartnerInvoicePreviewGroup): boolean {
  return group.proceedsEur != null && group.costEur != null && group.profitEur != null;
}

function row(key: string, label: string, value: number | null | undefined, kind: FigureRow['kind'], hint: string | null = null): FigureRow {
  return { key, label, hint, value: signedEur(value), kind, negative: value != null && Math.round(value * 100) < 0 };
}

/** Our share of the profit: the group's own, else the fallback the caller knows (an older server). */
function shareText(pct: number | null | undefined): string {
  return pct == null ? '' : ` ${percent(pct)}`;
}

/**
 * Netto opbrengst − Inkoopkost (split by who paid it) = Winst → Enrosed / → partner. Empty without the round-2
 * figures. `partner` is the short name ("Verhoeven").
 */
export function profitRows(group: PartnerInvoicePreviewGroup, partner: string, sharePct: number | null | undefined): FigureRow[] {
  if (!hasProfitFigures(group)) return [];
  const own = group.source === 'OWN';
  const cost = group.costEur ?? 0;
  const rows: FigureRow[] = [row('proceeds', 'Netto opbrengst', group.proceedsEur, 'line')];
  rows.push({ ...row('cost', 'Inkoopkost', cost, 'line', own || group.costSharePct == null ? null : 'wie betaalde wat'), value: minusEuro(cost) });
  if (own) {
    rows.push(row('cost-ours', `→ Enrosed ${percent(100)}`, cost, 'sub'));
  } else if (group.costSharePct != null) {
    const pct = group.costSharePct;
    const theirs = Math.round(cost * pct) / 100;
    rows.push(row('cost-theirs', `→ ${partner} ${percent(pct)}`, theirs, 'sub'));
    rows.push(row('cost-ours', `→ Enrosed ${percent(Math.round((100 - pct) * 100) / 100)}`, Math.round((cost - theirs) * 100) / 100, 'sub'));
  }
  rows.push(row('profit', 'Winst', group.profitEur, 'mid'));
  rows.push(row('ours', `→ Enrosed${shareText(group.profitSharePct ?? sharePct)}`, group.enrosedProfitEur, 'sub'));
  if (group.partnerProfitEur != null) rows.push(row('theirs', `→ ${partner}`, group.partnerProfitEur, 'sub'));
  return rows;
}

/**
 * Onze waarde (− voorschot) = Te factureren. The Voorschot line shows also at € 0,00 when the partner financed part of
 * the cost: then it says that no prefinance was netted.
 */
export function invoiceRows(group: PartnerInvoicePreviewGroup, full: boolean): FigureRow[] {
  const rows: FigureRow[] = [row('value', 'Onze waarde', group.valueEur, full ? 'mid' : 'line', full ? 'inkoopkost + winst Enrosed' : null)];
  if (group.correctionEur) rows.push(row('correction', 'waarvan correctie eerdere deelfacturen', group.correctionEur, 'sub'));
  const financed = group.source === 'CONTAINER' && (group.costSharePct ?? 0) > 0;
  if ((group.advanceEur ?? 0) !== 0 || financed) {
    rows.push({ ...row('advance', 'Voorschot verrekend', group.advanceEur ?? 0, 'sub'), value: group.advanceEur == null ? '—' : minusEuro(group.advanceEur) });
  }
  rows.push(row('balance', 'Te factureren', group.balanceEur, 'total'));
  return rows;
}
