import type { OrderStep, Product } from '../../core/api/models';

/*
 * "Verkocht per" (order step): the multiple a sales quantity of a product is
 * rounded up to on quotations, invoices, the customer portal and the website.
 * The server owns the rule (OrderSteps in the backend) and rounds on save;
 * this mirror words the setting and lets a screen announce a rounding before
 * the server applies it. Stored quantities stay in the sales unit (pieces, or
 * displays for a display basis): nothing here converts them.
 *
 * Imported at runtime by Angular components only. Node-tested modules inline
 * the rule or take the step as data (they may only `import type`).
 */

type StepProduct = Pick<Product, 'packaging' | 'carton'> & { readonly unitsPerOrderStep?: number | null };

/** The words of the product's sales unit; productSalesUnit(product) fits. */
export interface OrderStepUnit {
  /** "stolp", or "display" for a display basis. */
  singular: string;
  plural: string;
}

/** One chip of the product editor's "Verkocht per" choice. */
export interface OrderStepChoice {
  step: OrderStep;
  label: string;
}

/** The stored setting; absent, null or unknown reads as CARTON, like on the server. */
export function orderStepOf(product: Pick<Product, 'packaging'> | null | undefined): OrderStep {
  const step = product?.packaging?.orderStep;
  return step === 'PACKAGE' || step === 'UNIT' ? step : 'CARTON';
}

/**
 * Pieces in one display when the display can be the step: a display sold per
 * piece that holds two or more. A gift box holds one piece, and a display
 * basis already counts displays, so neither has a step of its own.
 */
export function packageStepPieces(product: Pick<Product, 'packaging'> | null | undefined): number | null {
  const packaging = product?.packaging;
  const pieces = packaging?.piecesPerUnit;
  return packaging?.kind === 'DISPLAY' && (packaging.salesUnit ?? 'PIECE') === 'PIECE'
    && pieces != null && Number.isSafeInteger(pieces) && pieces >= 2 ? pieces : null;
}

/**
 * The step as the screens word it: PACKAGE on packaging that no longer
 * qualifies is one unit, which is also what the server rounds it to.
 */
export function effectiveOrderStep(product: Pick<Product, 'packaging'> | null | undefined): OrderStep {
  const step = orderStepOf(product);
  return step === 'PACKAGE' && packageStepPieces(product) === null ? 'UNIT' : step;
}

/** The backend rule on the product as it stands, an unsaved editor draft included. Never below 1. */
export function localUnitsPerOrderStep(product: StepProduct | null | undefined): number {
  switch (effectiveOrderStep(product)) {
    case 'UNIT': return 1;
    case 'PACKAGE': return packageStepPieces(product) ?? 1;
    default: return Math.max(1, product?.carton?.piecesPerCarton ?? 1);
  }
}

/** The server's figure for a saved product; the same rule here when it sent none (an older server: full cartons). */
export function unitsPerOrderStep(product: StepProduct | null | undefined): number {
  const server = product?.unitsPerOrderStep;
  return server != null && Number.isSafeInteger(server) && server >= 1 ? server : localUnitsPerOrderStep(product);
}

/** Up to the next whole step; zero and negative quantities are left as they are. */
export function roundToOrderStep(quantity: number, unitsPerStep: number): number {
  if (!(quantity > 0)) return quantity;
  const per = Math.max(1, unitsPerStep || 1);
  return Math.ceil(quantity / per) * per;
}

function count(quantity: number, unit: OrderStepUnit): string {
  return `${quantity.toLocaleString('nl-BE')} ${quantity === 1 ? unit.singular : unit.plural}`;
}

function cartonCount(piecesPerCarton: number | null | undefined): number | null {
  return piecesPerCarton != null && Number.isSafeInteger(piecesPerCarton) && piecesPerCarton > 0 ? piecesPerCarton : null;
}

/**
 * The product editor's chips, for the product as drafted: a full carton always,
 * a display only when it can be a step, and one unit always. The carton count
 * comes from the caller, so an editor can pass the automatic count it saves.
 */
export function orderStepChoices(
  product: Pick<Product, 'packaging'>,
  unit: OrderStepUnit,
  piecesPerCarton: number | null | undefined,
): OrderStepChoice[] {
  const carton = cartonCount(piecesPerCarton);
  const display = packageStepPieces(product);
  const giftBox = product.packaging?.kind === 'GIFT_BOX';
  return [
    { step: 'CARTON', label: `Volle omdoos · ${carton === null ? 'doosinhoud ontbreekt' : count(carton, unit)}` },
    ...(display === null ? [] : [{ step: 'PACKAGE' as const, label: `Per display · ${count(display, unit)}` }]),
    { step: 'UNIT', label: `Per ${unit.singular}${giftBox ? ' · geschenkverpakking' : ''}` },
  ];
}

/** The setting in a read-only view: "Volle omdoos (12 stolpen)", "Per display (8 bowls)", "Per stolp". */
export function orderStepLabel(
  product: Pick<Product, 'packaging' | 'carton'>,
  unit: OrderStepUnit,
): string {
  switch (effectiveOrderStep(product)) {
    case 'PACKAGE': return `Per display (${count(packageStepPieces(product)!, unit)})`;
    case 'UNIT': return `Per ${unit.singular}${product.packaging?.kind === 'GIFT_BOX' ? ' (geschenkverpakking)' : ''}`;
    default: {
      const carton = cartonCount(product.carton?.piecesPerCarton);
      return `Volle omdoos (${carton === null ? 'doosinhoud ontbreekt' : count(carton, unit)})`;
    }
  }
}

/** The setting as one phrase: "Verkocht per volle omdoos (12 stolpen)", "Verkocht per display (8 bowls)", "Verkocht per stolp". */
export function orderStepSentence(
  product: Pick<Product, 'packaging' | 'carton'>,
  unit: OrderStepUnit,
): string {
  const label = orderStepLabel(product, unit);
  const phrase = `${label.charAt(0).toLocaleLowerCase('nl-BE')}${label.slice(1)}`;
  return `Verkocht ${effectiveOrderStep(product) === 'CARTON' ? 'per ' : ''}${phrase}`;
}

/**
 * What a quantity must be a multiple of, after "in": "volle dozen van 12
 * stolpen", "displays van 8 bowls". Null for a step of one: any whole number fits.
 */
export function orderStepMultiple(step: OrderStep | null | undefined, unitsPerStep: number, unit: OrderStepUnit): string | null {
  if (!(unitsPerStep > 1)) return null;
  return `${step === 'PACKAGE' ? 'displays' : 'volle dozen'} van ${count(unitsPerStep, unit)}`;
}

/** The start of a rounding notice: "Volle doos" or "Per display van 8"; the screen adds ": wordt 16". */
export function orderStepNotice(step: OrderStep | null | undefined, unitsPerStep: number): string {
  return step === 'PACKAGE' ? `Per display van ${unitsPerStep.toLocaleString('nl-BE')}` : 'Volle doos';
}
