import { Product } from '../../core/api/models';

/**
 * What the carton holds and weighs when nobody typed it: derived from the
 * sizes that are already on the form. The retail unit is the gift box or
 * display when there is one - that is what physically stacks in the carton.
 */

interface Dims { lengthCm: number | null; widthCm: number | null; heightCm: number | null }

function complete(dims: Dims | null | undefined): dims is { lengthCm: number; widthCm: number; heightCm: number } {
  return !!dims && !!dims.lengthCm && !!dims.widthCm && !!dims.heightCm
    && dims.lengthCm > 0 && dims.widthCm > 0 && dims.heightCm > 0;
}

/** The unit that goes into the carton: packaging first, bare product otherwise. */
function unitDims(product: Product): Dims | null {
  if (product.packaging?.kind && product.packaging.kind !== 'NONE' && complete(product.packaging.dimensions)) {
    return product.packaging.dimensions;
  }
  return complete(product.dimensions) ? product.dimensions : null;
}

/** Whole units per axis, same orientation - the honest floor, no tetris. */
export function autoPiecesPerCarton(product: Product): number | null {
  const unit = unitDims(product);
  const carton = product.carton;
  if (!unit || !complete(carton)) return null;
  const per = Math.floor(carton.lengthCm! / unit.lengthCm!)
    * Math.floor(carton.widthCm! / unit.widthCm!)
    * Math.floor(carton.heightCm! / unit.heightCm!);
  return per > 0 ? per : null;
}

/** Pieces times the piece's own weight; null while either is unknown. */
export function autoCartonWeightKg(product: Product, pieces: number | null): number | null {
  const unitWeight = product.dimensions?.weightKg;
  if (!unitWeight || !pieces || pieces <= 0) return null;
  return Math.round(unitWeight * pieces * 100) / 100;
}
