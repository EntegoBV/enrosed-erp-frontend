import type { Product } from '../../core/api/models';

type ProductWithPackaging = Pick<Product, 'packaging'> | null | undefined;

/** Presentation only: never converts the price or quantity stored on a document. */
export function productSalesUnit(product: ProductWithPackaging) {
  const packaging = product?.packaging;
  const isDisplay = packaging?.kind === 'DISPLAY' && packaging.salesUnit === 'DISPLAY';
  const count = packaging?.kind === 'DISPLAY' ? packaging.piecesPerUnit : null;
  const piecesPerDisplay = count != null && Number.isSafeInteger(count) && count > 1 ? count : null;
  return {
    isDisplay,
    singular: isDisplay ? 'display' : 'stuk',
    plural: isDisplay ? 'displays' : 'stuks',
    short: isDisplay ? 'display' : 'st',
    priceLabel: isDisplay ? 'Displayprijs' : 'Stukprijs',
    piecesPerDisplay,
  };
}

/** Equivalent at the same discount/tax basis as the supplied unit price. */
export function secondarySalesPrice(product: ProductWithPackaging, unitPrice: number | null | undefined) {
  const unit = productSalesUnit(product);
  if (!unit.piecesPerDisplay || unitPrice == null || !Number.isFinite(unitPrice) || unitPrice <= 0) return null;
  return {
    price: unit.isDisplay ? unitPrice / unit.piecesPerDisplay : unitPrice * unit.piecesPerDisplay,
    label: unit.isDisplay ? 'circa per stuk' : 'per display',
    piecesPerDisplay: unit.piecesPerDisplay,
  };
}

export function salesQuantityDetail(product: ProductWithPackaging, quantity: number): string | null {
  const unit = productSalesUnit(product);
  const per = unit.piecesPerDisplay;
  if (!per) return null;
  const format = (value: number) => value.toLocaleString('nl-BE');
  if (!Number.isSafeInteger(quantity) || quantity <= 0) return `${format(per)} stuks per display`;
  if (unit.isDisplay) {
    const pieces = quantity * per;
    return Number.isSafeInteger(pieces) ? `${format(quantity)} × ${format(per)} = ${format(pieces)} stuks` : null;
  }
  if (quantity % per !== 0) return `${format(per)} stuks per display`;
  const displays = quantity / per;
  return `${format(displays)} ${displays === 1 ? 'display' : 'displays'} van ${format(per)} stuks`;
}
