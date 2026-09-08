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

/**
 * Pieces times the weight of one packed piece; null while either is unknown.
 * A gift box or display weighs with the product inside, so once there is
 * packaging its weight is the one that goes in the carton.
 */
export function autoCartonWeightKg(product: Product, pieces: number | null): number | null {
  const unitWeight = packedPieceWeightKg(product);
  if (!unitWeight || !pieces || pieces <= 0) return null;
  return Math.round(unitWeight * pieces * 100) / 100;
}

/** What one piece weighs as it ships: in its gift box or display when it has one, bare otherwise. */
export function packedPieceWeightKg(product: Product): number | null {
  const packaging = product.packaging;
  if (packaging && packaging.kind !== 'NONE' && packaging.dimensions?.weightKg) return packaging.dimensions.weightKg;
  return product.dimensions?.weightKg ?? null;
}
