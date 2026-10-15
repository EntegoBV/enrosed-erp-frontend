import { euroText, priceBasisChange, productSalesUnit } from './product-sales-unit';
import type {
  Product,
  ProductFamily,
  ProductSharedField,
  ProductSharedFieldsApplyRequest,
} from '../../core/api/models';

import { autoPiecesPerCarton } from './carton-auto';
import { calculateGpCapacity, isAutoGpCapacity } from './carton-capacity';

export type ProductFamilySharedField = ProductSharedField;
export type ProductFamilySharedFieldsApply = ProductSharedFieldsApplyRequest;

export interface ProductFamilySharedFieldOption {
  key: ProductFamilySharedField;
  label: string;
  summary: string;
}

export interface ProductFamilySharedFieldGroup {
  label: string;
  fields: readonly ProductFamilySharedFieldOption[];
}

export interface ProductFamilySharedFieldTarget {
  productId: number;
  name: string;
  sku: string | null;
  colour: string | null;
  colourHex: string | null;
  size: string | null;
  active: boolean;
}

/**
 * Semantic bundles deliberately keep dependent values together. For example,
 * PURCHASE_PRICE means EXW amount, currency and the extra unit cost; copying
 * only the amount would make the target product internally inconsistent.
 */
export const PRODUCT_FAMILY_SHARED_FIELD_GROUPS: readonly ProductFamilySharedFieldGroup[] = [
  {
    label: 'Basis',
    fields: [
      {
        key: 'NAME',
        label: 'Productnaam intern',
        summary: 'Naam plus ingevulde naamvertalingen; kleur, maat en ontbrekende vertalingen blijven behouden.',
      },
      {
        key: 'DESCRIPTION',
        label: 'Omschrijving op offerte',
        summary: 'Omschrijving plus ingevulde vertalingen voor offertes en verkoopdocumenten.',
      },
      {
        key: 'DIMENSIONS',
        label: 'Productafmetingen',
        summary: 'Breedte, diepte, hoogte en gewicht van het artikel zelf.',
      },
      {
        key: 'PACKAGING',
        label: 'Geschenkdoosje of display',
        summary: 'Type, afmetingen, gewicht, inhoud, de eenheid op documenten (stuk, bowl, …), waarvoor de prijs geldt en per hoeveel de klant bestelt (stuk, display of omdoos); de barcode wordt niet overgenomen.',
      },
    ],
  },
  {
    label: 'Omdoos',
    fields: [
      {
        key: 'CARTON',
        label: 'Volledige omdoosspecificatie',
        summary: "Afmetingen, stuks, gewicht en handmatige 20ft GP-/40' HC-aantallen; automatische capaciteiten worden opnieuw berekend en de omdoos-EAN blijft apart.",
      },
    ],
  },
  {
    label: 'Inkoop',
    fields: [
      {
        key: 'PURCHASE_PRICE',
        label: 'EXW-prijs en extra kost',
        summary: 'EXW-bedrag, munt en extra kost per stuk; berekende kostprijzen blijven apart.',
      },
      {
        key: 'HS_CODE',
        label: 'HS-code',
        summary: 'De tariefcode waarmee invoerrechten worden berekend.',
      },
      {
        key: 'SUPPLIER_NOTE',
        label: 'Leveranciersnotitie',
        summary: 'De afspraak met de leverancier; gaat alleen naar kleuren van dezelfde leverancier.',
      },
    ],
  },
  {
    label: 'Verkoop',
    fields: [
      {
        key: 'SALES_PRICE',
        label: 'Verkoopprijs',
        summary: 'De vaste verkoopprijs of de gekozen opslagstrategie.',
      },
    ],
  },
] as const;

export const PRODUCT_FAMILY_SHARED_FIELDS: readonly ProductFamilySharedField[] =
  PRODUCT_FAMILY_SHARED_FIELD_GROUPS.flatMap((group) => group.fields.map((field) => field.key));

/** Compact source value shown before a family-wide overwrite is confirmed. */
export function productFamilySharedFieldValue(
  field: ProductFamilySharedField,
  product: Product,
): string {
  const number = (value: number | null | undefined, digits = 2) => value == null
    ? '—'
    : value.toLocaleString('nl-BE', { maximumFractionDigits: digits });
  const dimensions = (value: Product['dimensions']) => {
    const size = [value.lengthCm, value.widthCm, value.heightCm]
      .map((part) => number(part)).join(' × ');
    return `${size} cm${value.weightKg == null ? '' : ` · ${number(value.weightKg, 3)} kg`}`;
  };

  switch (field) {
    case 'NAME': return product.name || 'Niet ingevuld';
    case 'DESCRIPTION': {
      const text = product.description?.trim() || 'Niet ingevuld';
      return text.length > 105 ? `${text.slice(0, 102)}…` : text;
    }
    case 'DIMENSIONS': return dimensions(product.dimensions);
    case 'PACKAGING': {
      // The unit, the price basis and "klant bestelt per" travel with the packaging bundle, also for a loose article.
      const unit = productSalesUnit(product);
      const named = `eenheid ${unit.piece.one}`;
      // Inline on purpose (node-tested module): absent or unknown is a full carton,
      // a display that cannot be a step sells per unit, as on the server.
      const packaging = product.packaging;
      const step = packaging.orderStep === 'UNIT' || packaging.orderStep === 'PACKAGE' ? packaging.orderStep : 'CARTON';
      const display = packaging.kind === 'DISPLAY' && (packaging.salesUnit ?? 'PIECE') === 'PIECE' && (packaging.piecesPerUnit ?? 0) >= 2;
      const ordered = step === 'CARTON' ? 'klant bestelt per volle omdoos'
        : step === 'PACKAGE' && display ? 'klant bestelt per display' : `klant bestelt per ${unit.singular}`;
      if (packaging.kind === 'NONE') return `Geen verkoopverpakking · ${named} · ${ordered}`;
      const kind = packaging.kind === 'DISPLAY' ? 'Display' : 'Geschenkdoosje';
      const pieces = packaging.piecesPerUnit && packaging.piecesPerUnit > 1
        ? ` · ${packaging.piecesPerUnit} ${unit.piece.other}` : '';
      return `${kind} · ${dimensions(packaging.dimensions)}${pieces} · ${named} · prijs per ${unit.singular} · ${ordered}`;
    }
    case 'CARTON': {
      const box = product.carton;
      const size = [box.lengthCm, box.widthCm, box.heightCm]
        .map((part) => number(part)).join(' × ');
      const hc = box.piecesPerHc ?? box.hcCapacity;
      // The source can be an unsaved editor draft; do not display its old API projection.
      const gp20 = calculateGpCapacity({
        ...box,
        piecesPerCarton: (box.piecesPerCarton ?? 0) > 0 ? box.piecesPerCarton : autoPiecesPerCarton(product),
      });
      return `${size} cm · ${box.piecesPerCarton ?? '—'} ${productSalesUnit(product).plural} · ${number(box.weightKg, 3)} kg${gp20.value !== null ? ` · ${number(gp20.value, 0)}/20ft GP${isAutoGpCapacity(gp20) ? ' (Auto)' : ''}` : ''}${hc ? ` · ${number(hc, 0)}/40' HC` : ''}`;
    }
    case 'PURCHASE_PRICE':
      return `${product.exwCurrency} ${number(product.exwPrice)} · extra ${number(product.extraUnitCost)}`;
    case 'SUPPLIER_NOTE': {
      const text = product.supplierNote?.trim() || 'Niet ingevuld';
      return text.length > 105 ? `${text.slice(0, 102)}…` : text;
    }
    case 'SALES_PRICE':
      return (product.fixedSalesPriceEur ?? 0) > 0
        ? `Vast € ${number(product.fixedSalesPriceEur)}`
        : `Opslag ${number(product.markupPct)}%`;
    case 'HS_CODE': return product.hsCode?.trim() || 'Niet ingevuld';
  }
}

/** Family membership and its position are authoritative; Product adds the freshest display name. */
export function productFamilySharedFieldTargets(
  family: Pick<ProductFamily, 'members'>,
  source: Pick<Product, 'id'>,
  products: readonly Product[],
): ProductFamilySharedFieldTarget[] {
  const productsById = new Map(
    products
      .filter((product): product is Product & { id: number } => product.id !== null)
      .map((product) => [product.id, product]),
  );
  const seen = new Set<number>();

  return [...family.members]
    .sort((left, right) => left.position - right.position || left.productId - right.productId)
    .filter((member) => member.productId !== source.id && !seen.has(member.productId))
    .map((member) => {
      seen.add(member.productId);
      const product = productsById.get(member.productId);
      return {
        productId: member.productId,
        name: product?.name || member.name,
        sku: product?.sku ?? member.sku,
        colour: product?.colour ?? member.colour,
        colourHex: product?.colourHex ?? member.colourHex,
        size: product?.variantSize ?? member.size,
        active: product?.active ?? member.active,
      };
    });
}

/** A colour whose price would mean something else after the copy. */
export interface ProductFamilyBasisWarning {
  productId: number;
  text: string;
}

/**
 * The packaging bundle carries the price basis (per piece or per display of
 * n) but converts nothing: each colour keeps its own price, stock and carton
 * count. For every ticked colour whose basis the copy would change: "Navy:
 * € 2,95 geldt dan per display van 12 in plaats van per diamant. Prijs,
 * voorraad (96) en doosinhoud (12) worden niet omgerekend." A price or carton
 * count copied along is consistent with the source and left out of that list.
 * Colours not in `products` (not loaded) cannot be judged and are skipped.
 */
export function productFamilyPriceBasisWarnings(
  source: Product,
  targets: readonly ProductFamilySharedFieldTarget[],
  products: readonly Product[],
  selectedTargetIds: ReadonlySet<number>,
  selectedFields: ReadonlySet<ProductFamilySharedField>,
): ProductFamilyBasisWarning[] {
  if (!selectedFields.has('PACKAGING') || !source.packaging) return [];
  const byId = new Map(products.map((product) => [product.id, product] as const));
  const basisName = (product: Product) => {
    const unit = productSalesUnit(product);
    return unit.isDisplay
      ? (unit.piecesPerDisplay ? `display van ${unit.piecesPerDisplay.toLocaleString('nl-BE')}` : 'display')
      : unit.piece.one;
  };
  const warnings: ProductFamilyBasisWarning[] = [];
  for (const target of targets) {
    const product = byId.get(target.productId);
    if (!selectedTargetIds.has(target.productId) || !product?.packaging) continue;
    const { kind, piecesPerUnit, salesUnit, unitKey } = source.packaging;
    const copied: Product = { ...product, packaging: { ...product.packaging, kind, piecesPerUnit, salesUnit, unitKey } };
    const change = priceBasisChange(product, copied);
    const before = productSalesUnit(product);
    const after = productSalesUnit(copied);
    /* Per display of 6 to per display of 12 is the same basis but another price. */
    const otherDisplay = before.isDisplay && after.isDisplay && before.piecesPerDisplay !== after.piecesPerDisplay;
    if (!change && !otherDisplay) continue;
    const label = [target.colour?.trim(), target.size?.trim()].filter(Boolean).join(' · ') || target.name || `Product ${target.productId}`;
    const price = product.computedSalesPriceEur ?? product.fixedSalesPriceEur;
    const priced = !selectedFields.has('SALES_PRICE') && price != null && Number.isFinite(price) && price > 0;
    const stock = product.stockQuantity;
    const carton = product.carton?.piecesPerCarton;
    const kept = [
      ...(selectedFields.has('SALES_PRICE') ? [] : ['prijs']),
      stock != null && Number.isFinite(stock) ? `voorraad (${stock.toLocaleString('nl-BE')})` : 'voorraad',
      ...(selectedFields.has('CARTON') ? [] : [carton != null && carton > 0 ? `doosinhoud (${carton.toLocaleString('nl-BE')})` : 'doosinhoud']),
    ];
    const list = kept.length === 1 ? kept[0] : `${kept.slice(0, -1).join(', ')} en ${kept.at(-1)}`;
    warnings.push({
      productId: target.productId,
      text: `${label}: ${priced ? euroText(price!) : 'de prijs'} geldt dan per ${basisName(copied)} in plaats van per ${basisName(product)}.`
        + ` ${list.charAt(0).toLocaleUpperCase('nl-BE')}${list.slice(1)} ${kept.length === 1 ? 'wordt' : 'worden'} niet omgerekend.`,
    });
  }
  return warnings;
}

/** Stable payload order keeps review copy and backend audit trails deterministic. */
export function productFamilySharedFieldsApplyPayload(
  expectedFamilyId: number,
  targets: readonly ProductFamilySharedFieldTarget[],
  selectedTargetIds: ReadonlySet<number>,
  selectedFields: ReadonlySet<ProductFamilySharedField>,
): ProductFamilySharedFieldsApply {
  return {
    expectedFamilyId,
    targetProductIds: targets
      .filter((target) => selectedTargetIds.has(target.productId))
      .map((target) => target.productId),
    fields: PRODUCT_FAMILY_SHARED_FIELDS.filter((field) => selectedFields.has(field)),
  };
}
