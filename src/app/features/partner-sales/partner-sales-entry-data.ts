import type { Customer, Product } from '../../core/api/models';
import type { PartnerBuyer, PartnerProductTile, PartnerRecentSale } from '../../core/api/partner-portal-api';
import type { PartnerCountUnitCode, StaffPartnerReport } from '../../core/api/partner-sales-api';
import { COLOUR_SWATCHES } from '../../core/api/geo';
import { salesPhotoUrl } from '../../shared/sales-photo';
import { productParts } from '../customers/customer-price-state';
import { piecesPerSalesUnit as staffPiecesPerSalesUnit, effectiveUnit, partnerUnitChoices } from '../settings/partner-unit-choices';
import { searchText } from '../partner/partner-format';
import { productSalesUnit } from '../products/product-sales-unit';

/**
 * What the staff melding page builds from the ERP's own data, as the
 * partner's portal gets it from the server: product tiles with the count
 * units and this partner's default (Instellingen › Partnerportaal), the
 * recent sales Terugkoop offers, and buyers from the customer list.
 */

/** A product as the partner tiles show it, from the staff catalogue, counted as the portal counts it. */
export function productTile(product: Product, familyName: string | null = null,
    stored: PartnerCountUnitCode | null | undefined = null): PartnerProductTile {
  const parts = productParts(product, { productId: product.id ?? 0, name: product.name, sku: product.sku });
  const unit = productSalesUnit(product);
  const variant = parts.tail ? parts.tail.replace(/^\s*·?\s*/, '').trim() || null : null;
  const choices = partnerUnitChoices(product);
  const piece = choices[0];
  return {
    productId: product.id ?? 0,
    sku: product.sku,
    name: parts.head,
    variant,
    colourHex: product.colourHex || (product.colour ? COLOUR_SWATCHES[product.colour] ?? null : null),
    familyId: product.familyId,
    familyName,
    unitOne: unit.singular,
    unitOther: unit.plural,
    piecesPerUnit: unit.piecesPerDisplay,
    hasPhoto: !!salesPhotoUrl(product),
    photoVersion: null,
    salesUnit: unit.isDisplay ? 'DISPLAY' : 'PIECE',
    piecesPerSalesUnit: staffPiecesPerSalesUnit(product),
    pieceOne: piece.one,
    pieceOther: piece.other,
    countUnits: choices.map(({ unit: key, one, other, pieces }) => ({ unit: key, one, other, pieces })),
    defaultUnit: effectiveUnit(stored, choices),
  };
}

/** The recent sales of a partner from its meldingen: one tile per product, newest first (Terugkoop, the price check). */
export function recentSales(reports: readonly StaffPartnerReport[], since: string,
    tileOf: (productId: number) => PartnerProductTile | null): PartnerRecentSale[] {
  const byProduct = new Map<number, PartnerRecentSale>();
  for (const report of reports) {
    if (report.status === 'VOIDED' || report.soldOn < since) continue;
    for (const entry of report.entries) {
      if (!entry.sale) continue;
      const known = byProduct.get(entry.productId);
      if (known) {
        known.soldQuantity += entry.sale.quantity;
        /* A melding typed later can be dated earlier: the last day sold wins. */
        if (report.soldOn > known.lastSoldOn) { known.lastSoldOn = report.soldOn; known.lastAverageEur = entry.sale.unitPriceEur; }
        continue;
      }
      const tile = tileOf(entry.productId) ?? {
        productId: entry.productId, sku: entry.sku ?? null, name: entry.name, variant: entry.variant, colourHex: entry.colourHex,
        familyId: entry.familyId ?? null, familyName: entry.familyName ?? null, unitOne: entry.unitOne, unitOther: entry.unitOther,
        piecesPerUnit: entry.piecesPerUnit ?? null, hasPhoto: false, photoVersion: null, salesUnit: entry.salesUnit,
        piecesPerSalesUnit: entry.piecesPerSalesUnit, pieceOne: entry.pieceOne, pieceOther: entry.pieceOther,
        countUnits: entry.countUnits, defaultUnit: entry.defaultUnit,
      };
      byProduct.set(entry.productId, { ...tile, soldQuantity: entry.sale.quantity, lastSoldOn: report.soldOn, lastAverageEur: entry.sale.unitPriceEur });
    }
  }
  return [...byProduct.values()].sort((a, b) => b.lastSoldOn.localeCompare(a.lastSoldOn));
}

/** A customer as the buyer field lists it. */
export function buyerOf(customer: Customer): PartnerBuyer {
  return { customerId: customer.id ?? 0, company: customer.company, city: customer.city || null, countryCode: customer.countryCode || null, addedByYou: false };
}

/** Who may buy on a direct sale: every customer but the partners. */
export function buyerCandidates(customers: readonly Customer[]): Customer[] {
  return customers.filter((customer) => customer.id != null && !customer.partner);
}

/** The staff search over company and city (2 letters or more), at most 20, best match first. */
export function searchBuyers(customers: readonly Customer[], query: string, max = 20): PartnerBuyer[] {
  const words = searchText(query).split(/\s+/).filter(Boolean);
  if (!words.length || words.join('').length < 2) return [];
  const scored: { customer: Customer; score: number }[] = [];
  for (const customer of customers) {
    const company = searchText(customer.company);
    const text = `${company} ${searchText(customer.city)}`;
    if (!words.every((word) => text.includes(word))) continue;
    scored.push({ customer, score: company.startsWith(words[0]) ? 0 : company.includes(words[0]) ? 1 : 2 });
  }
  return scored.sort((a, b) => a.score - b.score || a.customer.company.localeCompare(b.customer.company, 'nl'))
    .slice(0, max).map((item) => buyerOf(item.customer));
}

/** The partner's last buyers (direct sales, newest first), at most 8: an empty search lists them. */
export function lastBuyers(reports: readonly StaffPartnerReport[], customers: ReadonlyMap<number, Customer>, max = 8): PartnerBuyer[] {
  const seen = new Set<number>();
  const list: PartnerBuyer[] = [];
  for (const report of [...reports].sort((a, b) => b.soldOn.localeCompare(a.soldOn) || b.id - a.id)) {
    const buyer = report.buyer;
    if (!buyer || seen.has(buyer.customerId) || report.status === 'VOIDED') continue;
    seen.add(buyer.customerId);
    const known = customers.get(buyer.customerId);
    list.push(known ? buyerOf(known) : { customerId: buyer.customerId, company: buyer.company, city: buyer.city, countryCode: null, addedByYou: false });
    if (list.length >= max) break;
  }
  return list;
}
