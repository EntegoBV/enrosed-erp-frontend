import type { CartonDto, GpCapacitySource } from '../../core/api/models';

export interface GpCapacity {
  value: number | null;
  source: GpCapacitySource;
}

// Practical planning volumes, matching backend ContainerType and Carton.
const GP_CBM = 28n;
const HC_CBM = 68n;
const CBM_SCALE = 100_000_000n;
const MAX_CAPACITY = 2_147_483_647;

function positive(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function positiveCount(value: number | null | undefined): value is number {
  return positive(value) && Number.isInteger(value) && value <= MAX_CAPACITY;
}

function capacity(value: number, source: GpCapacitySource): GpCapacity {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_CAPACITY
    ? { value, source }
    : { value: null, source: 'UNKNOWN' };
}

function decimalParts(value: number): { units: bigint; scale: number } {
  const [coefficient, exponent = '0'] = value.toString().toLowerCase().split('e');
  const [whole, fraction = ''] = coefficient.split('.');
  const scale = fraction.length - Number(exponent);
  const units = BigInt(whole + fraction);
  return scale < 0 ? { units: units * 10n ** BigInt(-scale), scale: 0 } : { units, scale };
}

/** Match Dimensions.cbm(): cm³ to m³, rounded HALF_UP to eight decimal places. */
function scaledCartonCbm(length: number, width: number, height: number): bigint {
  const parts = [length, width, height].map(decimalParts);
  const numerator = parts.reduce((value, part) => value * part.units, 100n);
  const denominator = 10n ** BigInt(parts.reduce((scale, part) => scale + part.scale, 0));
  return (numerator * 2n + denominator) / (denominator * 2n);
}

/**
 * Live editor calculation from editable fields only. Never reuse a stale API
 * projection or the automatically derived 40' HC capacity as an input.
 */
export function calculateGpCapacity(carton: Readonly<CartonDto>): GpCapacity {
  if (positiveCount(carton.piecesPer20Ft)) return { value: carton.piecesPer20Ft, source: 'MANUAL' };

  const pieces = carton.piecesPerCarton;
  if (positiveCount(pieces) && positive(carton.lengthCm)
      && positive(carton.widthCm) && positive(carton.heightCm)) {
    const cbm = scaledCartonCbm(carton.lengthCm, carton.widthCm, carton.heightCm);
    if (cbm > 0n) {
      return capacity(Number((GP_CBM * CBM_SCALE / cbm) * BigInt(pieces)), 'CARTON');
    }
  }

  if (positiveCount(carton.piecesPerHc)) {
    const perCarton = positiveCount(pieces) ? BigInt(pieces) : 1n;
    const cartons = BigInt(carton.piecesPerHc) * GP_CBM / (HC_CBM * perCarton);
    return capacity(Number(cartons * perCarton), 'HC_RATIO');
  }
  return { value: null, source: 'UNKNOWN' };
}

/** Use the API projection on saved products; older responses use the same calculation. */
export function readGpCapacity(carton: Readonly<CartonDto>): GpCapacity {
  if (carton.gpCapacitySource !== undefined) {
    return carton.gpCapacitySource === 'UNKNOWN' || carton.gpCapacity == null
      ? { value: null, source: 'UNKNOWN' }
      : capacity(carton.gpCapacity, carton.gpCapacitySource);
  }
  return calculateGpCapacity(carton);
}

export function isAutoGpCapacity(result: GpCapacity): boolean {
  return result.source === 'CARTON' || result.source === 'HC_RATIO';
}

export function gpCapacityHint(result: GpCapacity, carton: Readonly<CartonDto>): string {
  switch (result.source) {
    case 'MANUAL': return 'Handmatig bevestigd aantal producteenheden.';
    case 'CARTON': return 'Schatting op basis van 28 m³ praktische laadruimte en de omdoos, afgerond op hele omdozen.';
    case 'HC_RATIO': return `Schatting op basis van het bevestigde 40’ HC-aantal (28/68), afgerond op hele ${positiveCount(carton.piecesPerCarton) ? 'omdozen' : 'producteenheden'}.`;
    case 'UNKNOWN': return 'Vul de omdoosgegevens of een bevestigd 40’ HC-aantal in voor een automatische schatting.';
  }
}
