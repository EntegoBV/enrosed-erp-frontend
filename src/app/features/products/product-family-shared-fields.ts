import type {
  Product,
  ProductFamily,
  ProductSharedField,
  ProductSharedFieldsApplyRequest,
} from '../../core/api/models';

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
        label: 'Geschenkverpakking of display',
        summary: 'Type, afmetingen, gewicht en inhoud; de barcode wordt niet overgenomen.',
      },
    ],
  },
  {
    label: 'Omdoos',
    fields: [
      {
        key: 'CARTON',
        label: 'Volledige omdoosspecificatie',
        summary: "Afmetingen, stuks, gewicht en 40' HC-capaciteit; de omdoos-EAN blijft apart.",
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
    return `${size} cm${value.weightKg == null ? '' : ` · ${number(value.weightKg)} kg`}`;
  };

  switch (field) {
    case 'NAME': return product.name || 'Niet ingevuld';
    case 'DESCRIPTION': {
      const text = product.description?.trim() || 'Niet ingevuld';
      return text.length > 105 ? `${text.slice(0, 102)}…` : text;
    }
    case 'DIMENSIONS': return dimensions(product.dimensions);
    case 'PACKAGING': {
      if (product.packaging.kind === 'NONE') return 'Geen verkoopverpakking';
      const kind = product.packaging.kind === 'DISPLAY' ? 'Display' : 'Geschenkverpakking';
      const pieces = product.packaging.piecesPerUnit && product.packaging.piecesPerUnit > 1
        ? ` · ${product.packaging.piecesPerUnit} stuks` : '';
      return `${kind} · ${dimensions(product.packaging.dimensions)}${pieces}`;
    }
    case 'CARTON': {
      const box = product.carton;
      const size = [box.lengthCm, box.widthCm, box.heightCm]
        .map((part) => number(part)).join(' × ');
      const hc = box.piecesPerHc ?? box.hcCapacity;
      return `${size} cm · ${box.piecesPerCarton ?? '—'} stuks · ${number(box.weightKg)} kg${hc ? ` · ${number(hc, 0)}/40' HC` : ''}`;
    }
    case 'PURCHASE_PRICE':
      return `${product.exwCurrency} ${number(product.exwPrice)} · extra ${number(product.extraUnitCost)}`;
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
