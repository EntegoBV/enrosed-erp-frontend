import type { OrderStep, Product } from '../../core/api/models';

/*
 * "Klant bestelt per" (order step; "Verkocht per" until 2026-10-15): the multiple a sales quantity of a product is
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

/** One option of the product editor's "Klant bestelt per" choice. */
export interface OrderStepChoice {
  step: OrderStep;
  /** "Diamant", "Display", "Omdoos". */
  label: string;
  /** "Elk aantal", "Per 12 diamanten", "Doosinhoud ontbreekt". */
  detail: string;
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
 * The product editor's options, from small to large and for the product as
 * drafted: one unit always, a display only when it can be the step, a full
 * carton always. The carton count comes from the caller, so an editor can pass
 * the automatic count it saves.
 */
export function orderStepChoices(
  product: Pick<Product, 'packaging'>,
  unit: OrderStepUnit,
  piecesPerCarton: number | null | undefined,
): OrderStepChoice[] {
  const carton = cartonCount(piecesPerCarton);
  const display = packageStepPieces(product);
  const one = `${unit.singular.charAt(0).toLocaleUpperCase('nl-BE')}${unit.singular.slice(1)}`;
  return [
    { step: 'UNIT', label: one, detail: unit.singular === 'display' ? 'Elk aantal displays' : 'Elk aantal' },
    ...(display === null ? [] : [{ step: 'PACKAGE' as const, label: 'Display', detail: `Per ${count(display, unit)}` }]),
    { step: 'CARTON', label: 'Omdoos', detail: carton === null ? 'Doosinhoud ontbreekt' : `Per ${count(carton, unit)}` },
  ];
}

/**
 * The live example under the options: "Voorbeeld: 13 diamanten op een offerte
 * worden 24 (2 displays)." or "Geen afronding: 13 stolpen blijven 13."
 */
export function orderStepExample(step: OrderStep, unitsPerStep: number, unit: OrderStepUnit): string {
  if (!(unitsPerStep > 1)) return `Geen afronding: 13 ${unit.plural} blijven 13.`;
  const asked = unitsPerStep + 1;
  return `Voorbeeld: ${count(asked, unit)} op een offerte worden ${(unitsPerStep * 2).toLocaleString('nl-BE')} (2 ${step === 'PACKAGE' ? 'displays' : 'dozen'}).`;
}

/**
 * "Per display" that the saved product had and the draft no longer can give
 * (the display went, or its count): the screens say the step became one unit.
 * A display basis keeps ordering per display, so it needs no notice.
 */
export function orderStepFellBack(
  saved: Pick<Product, 'packaging'> | null | undefined,
  draft: Pick<Product, 'packaging'> | null | undefined,
): boolean {
  if (!saved || effectiveOrderStep(saved) !== 'PACKAGE' || packageStepPieces(draft) !== null) return false;
  const packaging = draft?.packaging;
  return !(packaging?.kind === 'DISPLAY' && packaging.salesUnit === 'DISPLAY');
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

/** The setting as one phrase: "Klant bestelt per volle omdoos (12 stolpen)", "Klant bestelt per display (8 bowls)", "Klant bestelt per stolp". */
export function orderStepSentence(
  product: Pick<Product, 'packaging' | 'carton'>,
  unit: OrderStepUnit,
): string {
  const label = orderStepLabel(product, unit);
  const phrase = `${label.charAt(0).toLocaleLowerCase('nl-BE')}${label.slice(1)}`;
  return `Klant bestelt ${effectiveOrderStep(product) === 'CARTON' ? 'per ' : ''}${phrase}`;
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
