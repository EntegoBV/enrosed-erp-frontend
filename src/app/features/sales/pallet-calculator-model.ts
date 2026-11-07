import type { CartonDto, OrderStep, PalletProfile, Product } from '../../core/api/models';

/**
 * The arithmetic of Palletberekening (pallet-calculator-page.ts), free of
 * Angular so it reads on its own.
 *
 * - One product on one pallet mirrors the backend's PalletCalculator.fit:
 *   rows of either carton orientation in both pallet directions, layers
 *   under the maximum height (the wood counted), then the weight cap. The
 *   screen therefore says what a quote says.
 * - Several products share pallets the way the pallet planner estimates a
 *   hand-built pallet (pallet-stack.ts): each product in layers of its own,
 *   a started layer as high as a full one. The products go tallest carton
 *   first, each layer onto the first pallet with room (planPallets, the
 *   backend's PalletCalculator.mixedPallets step for step), so one product
 *   alone still gets exactly its cartonsPerPallet per pallet and a mix never
 *   needs more pallets than every product on pallets of its own.
 * - A container takes loose cartons: each product's own capacity (the hand
 *   count where one was confirmed, else full cartons on the practical
 *   volumes of the backend's ContainerType), a mix as the sum of the shares.
 *
 * A started carton counts as a full one, as everywhere for m³, kg and pallets.
 */

/**
 * SalesSettings' defaults (enrosed.pallet.*); production overrides none of them. The max height is
 * the standard (Emre, 2026-11-07: 220 cm, 260 before): Palletberekening, the catalogue and a new
 * sales document count with it, while a document keeps the height it was made with.
 */
export const PALLET_BASE_HEIGHT_CM = 14.4;
export const PALLET_MAX_HEIGHT_CM = 220;
/** The height every document made before 2026-11-07 keeps (the server reads its missing height as this). */
export const PALLET_LEGACY_MAX_HEIGHT_CM = 260;
export const PALLET_MAX_WEIGHT_KG = 700;
/** The backend's ceiling for an order's maximum pallet height. */
export const PALLET_HEIGHT_LIMIT_CM = 300;

export interface PalletChoice {
  id: PalletProfile;
  label: string;
  /** The segment label. */
  short: string;
  /** B × D, as the pallet planner writes it. */
  size: string;
  lengthCm: number;
  widthCm: number;
}

/** The footprints of the backend's PalletProfile. */
export const PALLET_CHOICES: readonly PalletChoice[] = [
  { id: 'EURO_120X80', label: 'Europallet', short: 'Euro', size: '120 × 80', lengthCm: 120, widthCm: 80 },
  { id: 'BLOCK_120X100', label: 'Blokpallet', short: 'Blok', size: '120 × 100', lengthCm: 120, widthCm: 100 },
  { id: 'HALF_80X60', label: 'Halve pallet', short: 'Half', size: '80 × 60', lengthCm: 80, widthCm: 60 },
];

export interface PalletSpec {
  lengthCm: number;
  widthCm: number;
  baseHeightCm: number;
  /** The loaded height, the wood included. */
  maxHeightCm: number;
  maxWeightKg: number;
}

export function palletSpec(profile: PalletProfile, maxHeightCm: number): PalletSpec {
  const choice = PALLET_CHOICES.find((candidate) => candidate.id === profile) ?? PALLET_CHOICES[0];
  return {
    lengthCm: choice.lengthCm, widthCm: choice.widthCm, baseHeightCm: PALLET_BASE_HEIGHT_CM,
    maxHeightCm, maxWeightKg: PALLET_MAX_WEIGHT_KG,
  };
}

/** A typed maximum height within the backend's bounds: above the wood, at most 300 cm, whole centimetres. */
export function clampPalletHeight(value: number): number {
  if (!Number.isFinite(value)) return PALLET_MAX_HEIGHT_CM;
  return Math.min(PALLET_HEIGHT_LIMIT_CM, Math.max(Math.ceil(PALLET_BASE_HEIGHT_CM + 1), Math.round(value)));
}

export type ContainerId = '20GP' | '40GP' | '40HQ';

export interface ContainerChoice {
  id: ContainerId;
  label: string;
  /** Practical loading volume in m³. */
  cbm: number;
}

/** The practical volumes of the backend's ContainerType. */
export const CONTAINERS: readonly ContainerChoice[] = [
  { id: '20GP', label: '20ft', cbm: 28 },
  { id: '40GP', label: '40ft', cbm: 58 },
  { id: '40HQ', label: '40ft HC', cbm: 68 },
];

type CartonSize = Pick<CartonDto, 'lengthCm' | 'widthCm' | 'heightCm' | 'weightKg'>;

export interface PalletFit {
  perLayer: number;
  layers: number;
  cartonsPerPallet: number;
  /** The loaded height of a full pallet, the wood included; 0 when nothing fits. */
  heightCm: number;
  /** What stops the next carton; null when nothing fits. */
  limitedBy: 'hoogte' | 'gewicht' | null;
  /** Why nothing fits, in the backend's words; null when something does. */
  problem: string | null;
}

function none(problem: string): PalletFit {
  return { perLayer: 0, layers: 0, cartonsPerPallet: 0, heightCm: 0, limitedBy: null, problem };
}

function positive(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** floor(space / item) as BigDecimal FLOOR gives it: 245.6 / 24.56 is 10, not 9.999…; 0 without an item. */
function floorDiv(space: number, item: number): number {
  if (!(item > 0)) return 0;
  const quotient = space / item;
  const nearest = Math.round(quotient);
  return Math.abs(quotient - nearest) < 1e-9 ? nearest : Math.floor(quotient);
}

/**
 * The best layer made of rows that may use either carton orientation:
 * primary is the direction within one row, secondary the one in which the
 * rows lie next to each other (PalletCalculator.bestRows).
 */
function bestRows(primary: number, secondary: number, boxLength: number, boxWidth: number): number {
  let best = 0;
  const straightPerRow = floorDiv(primary, boxLength);
  const rotatedPerRow = floorDiv(primary, boxWidth);
  const maxStraightRows = floorDiv(secondary, boxWidth);
  for (let straightRows = 0; straightRows <= maxStraightRows; straightRows++) {
    const remaining = secondary - boxWidth * straightRows;
    const rotatedRows = remaining < 0 ? 0 : floorDiv(remaining, boxLength);
    best = Math.max(best, straightRows * straightPerRow + rotatedRows * rotatedPerRow);
  }
  return best;
}

/** How many cartons of one size go on one pallet: PalletCalculator.fit. */
export function palletFit(carton: CartonSize, pallet: PalletSpec): PalletFit {
  const { lengthCm, widthCm, heightCm } = carton;
  if (!positive(lengthCm) || !positive(widthCm) || !positive(heightCm)) return none('afmetingen ontbreken');
  const perLayer = Math.max(
    bestRows(pallet.lengthCm, pallet.widthCm, lengthCm, widthCm),
    bestRows(pallet.widthCm, pallet.lengthCm, lengthCm, widthCm));
  if (perLayer <= 0) return none('doos past niet op de pallet');

  const layersByHeight = Math.max(0, floorDiv(pallet.maxHeightCm - pallet.baseHeightCm, heightCm));
  const heightCapacity = perLayer * layersByHeight;
  const weightCapacity = positive(carton.weightKg)
    ? floorDiv(pallet.maxWeightKg, carton.weightKg) : Number.POSITIVE_INFINITY;
  const cartonsPerPallet = Math.min(heightCapacity, weightCapacity);
  if (cartonsPerPallet <= 0) return none('te hoog of te zwaar');
  const layers = Math.ceil(cartonsPerPallet / perLayer);
  return {
    perLayer, layers, cartonsPerPallet,
    heightCm: round(pallet.baseHeightCm + heightCm * layers, 1),
    limitedBy: weightCapacity < heightCapacity ? 'gewicht' : 'hoogte',
    problem: null,
  };
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/* ------------------------------------------------------------------ units */

export type CalcUnit = 'carton' | 'display' | 'piece';

export interface ProductUnits {
  /** Sales units in one omdoos: carton.piecesPerCarton (pieces, or displays for a display basis). */
  perCarton: number | null;
  /** Displays in one omdoos; null without a display of two or more pieces that fills the omdoos evenly. */
  displaysPerCarton: number | null;
  piecesPerDisplay: number | null;
  /** Pieces in one omdoos; null when that is unknown. */
  piecesPerCarton: number | null;
}

function count(value: number | null | undefined): number | null {
  return value != null && Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** What one omdoos holds, in displays and in pieces. */
export function productUnits(product: Pick<Product, 'packaging' | 'carton'>): ProductUnits {
  const perCarton = count(product.carton?.piecesPerCarton);
  const packaging = product.packaging;
  const perDisplay = packaging?.kind === 'DISPLAY' ? count(packaging.piecesPerUnit) : null;
  const piecesPerDisplay = perDisplay !== null && perDisplay > 1 ? perDisplay : null;
  if (packaging?.kind === 'DISPLAY' && packaging.salesUnit === 'DISPLAY') {
    /* A display basis counts displays: the omdoos holds perCarton displays. */
    return {
      perCarton, displaysPerCarton: perCarton, piecesPerDisplay,
      piecesPerCarton: perCarton !== null && piecesPerDisplay !== null ? perCarton * piecesPerDisplay : null,
    };
  }
  const displays = perCarton !== null && piecesPerDisplay !== null && perCarton % piecesPerDisplay === 0
    ? perCarton / piecesPerDisplay : null;
  return {
    perCarton, displaysPerCarton: displays, piecesPerDisplay: displays === null ? null : piecesPerDisplay,
    piecesPerCarton: perCarton,
  };
}

/** How many of a unit one omdoos holds; null when the product has no such unit. */
export function unitsPerCarton(unit: CalcUnit, units: ProductUnits): number | null {
  return unit === 'carton' ? 1 : unit === 'display' ? units.displaysPerCarton : units.piecesPerCarton;
}

/**
 * The unit a new row starts in: what the customer orders per ("Klant
 * bestelt per", the step as effectiveOrderStep reads it). Per display gives
 * displays when the omdoos holds whole ones; per unit gives displays on a
 * display basis, else pieces; per omdoos, or a unit the omdoos cannot count,
 * gives omdozen.
 */
export function startUnit(step: OrderStep, units: ProductUnits, displayBasis: boolean): CalcUnit {
  if (step === 'PACKAGE') return units.displaysPerCarton ? 'display' : 'carton';
  if (step === 'UNIT') {
    if (displayBasis) return units.displaysPerCarton ? 'display' : 'carton';
    return units.piecesPerCarton ? 'piece' : 'carton';
  }
  return 'carton';
}

/** Whole cartons for a typed quantity; a started carton is a full one. */
export function cartonsFor(quantity: number | null, unit: CalcUnit, units: ProductUnits): number {
  if (quantity == null || !(quantity > 0)) return 0;
  const per = unitsPerCarton(unit, units);
  return per ? Math.ceil(quantity / per) : 0;
}

/* -------------------------------------------------------------- containers */

/** Dimensions.cbm(): cm³ to m³, eight decimals. */
export function cartonCbm(carton: Pick<CartonDto, 'lengthCm' | 'widthCm' | 'heightCm'>): number | null {
  const { lengthCm, widthCm, heightCm } = carton;
  if (!positive(lengthCm) || !positive(widthCm) || !positive(heightCm)) return null;
  return round(lengthCm * widthCm * heightCm / 1_000_000, 8);
}

export interface ContainerCapacity {
  cartons: number;
  /** From a confirmed hand count rather than the volume. */
  counted: boolean;
}

/**
 * Whole cartons of one product in a container. 20ft: the confirmed count,
 * else the volume, else the 40ft HC count scaled (calculateGpCapacity).
 * 40ft HC: the hand count, else the volume (hcCapacity). 40ft: scaled from
 * a hand count where there is one, so it never passes the HC; else the volume.
 */
export function containerCapacity(
  product: Pick<Product, 'carton'> & { readonly cartonCbm?: number },
  units: ProductUnits,
  container: ContainerChoice,
): ContainerCapacity | null {
  const carton = product.carton;
  const perCarton = units.perCarton;
  const volume = positive(product.cartonCbm) ? product.cartonCbm : cartonCbm(carton);
  const byVolume = volume ? floorDiv(container.cbm, volume) : null;
  const manual20 = count(carton.piecesPer20Ft);
  const manualHc = count(carton.piecesPerHc);
  const scaled = (pieces: number, fromCbm: number) =>
    perCarton ? Math.floor(pieces * container.cbm / (fromCbm * perCarton)) : null;
  let cartons: number | null = null;
  let counted = false;
  switch (container.id) {
    case '20GP':
      if (manual20 !== null && perCarton) { cartons = Math.floor(manual20 / perCarton); counted = true; }
      else if (byVolume !== null) cartons = byVolume;
      else if (manualHc !== null) { cartons = scaled(manualHc, 68); counted = true; }
      break;
    case '40HQ':
      if (manualHc !== null && perCarton) { cartons = Math.floor(manualHc / perCarton); counted = true; }
      else cartons = byVolume;
      break;
    case '40GP':
      if (manualHc !== null) { cartons = scaled(manualHc, 68); counted = true; }
      else if (manual20 !== null) { cartons = scaled(manual20, 28); counted = true; }
      else cartons = byVolume;
      break;
  }
  return cartons !== null && cartons > 0 ? { cartons, counted } : null;
}

export interface ContainerFill {
  container: ContainerChoice;
  /** The sum of each product's cartons over its own capacity; 1 is one full container. */
  share: number;
  /** Containers the mix needs. */
  needed: number;
  /** Some cartons have no capacity for this container (no size, no count). */
  incomplete: boolean;
}

export function containerFill(
  lines: readonly { cartons: number; capacity: ContainerCapacity | null }[],
  container: ContainerChoice,
): ContainerFill {
  let share = 0;
  let incomplete = false;
  for (const line of lines) {
    if (line.cartons <= 0) continue;
    if (!line.capacity) { incomplete = true; continue; }
    share += line.cartons / line.capacity.cartons;
  }
  return { container, share, needed: share > 0 ? Math.ceil(share - 1e-9) : 0, incomplete };
}

/* ----------------------------------------------------------------- pallets */

/** Beyond this many pallets the plan is not worked out; the page says "more than". */
export const MAX_PLANNED_PALLETS = 200;

export interface PlanLine {
  key: number;
  cartons: number;
  fit: PalletFit;
  cartonHeightCm: number;
  /** 0 when unknown: the height alone decides. */
  cartonWeightKg: number;
}

export interface PalletPart {
  key: number;
  cartons: number;
  layers: number;
}

export interface PlannedPallet {
  /** Bottom to top, one entry per product. */
  parts: PalletPart[];
  /** Loaded height, the wood included. */
  heightCm: number;
  weightKg: number;
  /** The larger of the height and the weight share, 0 to 1. */
  fill: number;
  /** One product at its cartonsPerPallet. */
  full: boolean;
}

interface Stack { parts: PalletPart[]; heightCm: number; weightKg: number }

const EPSILON = 1e-9;

/** Omdozen that fit a pallet, as the backend's Load.placeable; the rest drops out of every count. */
function placeable(line: PlanLine): boolean {
  return line.cartons > 0 && line.fit.cartonsPerPallet > 0 && line.fit.perLayer > 0 && line.cartonHeightCm > 0;
}

/** Every product on pallets of its own, the strict count: the most a plan ever gives, and the bound on what it works out. */
export function separatePallets(lines: readonly PlanLine[]): number {
  return lines.filter(placeable).reduce((sum, line) => sum + Math.ceil(line.cartons / line.fit.cartonsPerPallet), 0);
}

/** The pallets of that count, in line order: a product's full pallets, then its rest (the backend's separatePallets). */
function separateLayout(lines: readonly PlanLine[]): Stack[] {
  const stacks: Stack[] = [];
  for (const line of lines) {
    for (let left = line.cartons; left > 0; left -= line.fit.cartonsPerPallet) {
      const cartons = Math.min(line.fit.cartonsPerPallet, left);
      const layers = Math.ceil(cartons / line.fit.perLayer);
      stacks.push({
        parts: [{ key: line.key, cartons, layers }],
        heightCm: layers * line.cartonHeightCm, weightKg: cartons * line.cartonWeightKg,
      });
    }
  }
  return stacks;
}

/** Cartons of a line that the weight still allows on a pallet. */
function weightRoom(loadedKg: number, line: PlanLine, pallet: PalletSpec): number {
  return line.cartonWeightKg > 0
    ? Math.max(0, floorDiv(pallet.maxWeightKg - loadedKg, line.cartonWeightKg)) : Number.POSITIVE_INFINITY;
}

function place(stack: Stack, line: PlanLine, cartons: number): void {
  const part = stack.parts.find((candidate) => candidate.key === line.key);
  if (part) { part.cartons += cartons; part.layers += 1; }
  else stack.parts.push({ key: line.key, cartons, layers: 1 });
  stack.heightCm += line.cartonHeightCm;
  stack.weightKg += cartons * line.cartonWeightKg;
}

/**
 * The pallets for these cartons: the backend's PalletCalculator.mixedPallets
 * step for step, keep the two identical. The products go tallest carton
 * first, ties in line order, each in whole layers of its own (the last one
 * may be short); every layer goes on the first pallet where it still goes
 * under the height and the weight takes at least one carton (first-fit
 * decreasing). Where the weight takes only part of a layer, the cartons left
 * behind join the product's next layer, so one product alone gets exactly
 * its cartonsPerPallet per pallet. A plan that still needs more pallets than
 * every product on pallets of its own is that layout instead (separateLayout),
 * so a mix never counts more than the strict rule. Lines that fit no pallet
 * are left out.
 */
export function planPallets(lines: readonly PlanLine[], pallet: PalletSpec): PlannedPallet[] {
  const usable = pallet.maxHeightCm - pallet.baseHeightCm;
  const placed = lines.filter(placeable);
  const tallestFirst = placed.map((line, order) => ({ line, order }))
    .sort((left, right) => right.line.cartonHeightCm - left.line.cartonHeightCm || left.order - right.order);

  let stacks: Stack[] = [];
  for (const { line } of tallestFirst) {
    let rest = line.cartons;
    while (rest > 0) {
      const layer = Math.min(line.fit.perLayer, rest);
      let target: Stack | null = null;
      let fits = 0;
      for (const stack of stacks) {
        if (stack.heightCm + line.cartonHeightCm > usable + EPSILON) continue;
        fits = Math.min(layer, weightRoom(stack.weightKg, line, pallet));
        if (fits > 0) { target = stack; break; }
      }
      if (!target) {
        /* An empty pallet always takes a layer: cartonsPerPallet > 0 means one layer is under the height and one carton under the weight. */
        target = { parts: [], heightCm: 0, weightKg: 0 };
        stacks.push(target);
        fits = Math.min(layer, weightRoom(0, line, pallet));
      }
      place(target, line, fits);
      rest -= fits;
    }
  }
  if (stacks.length > separatePallets(placed)) stacks = separateLayout(placed);

  /* Unrounded: the room search counts on these; the screen rounds when it writes them. */
  return stacks.map((stack) => {
    const only = stack.parts.length === 1 ? placed.find((line) => line.key === stack.parts[0].key) : undefined;
    const full = !!only && stack.parts[0].cartons >= only.fit.cartonsPerPallet;
    return {
      parts: stack.parts,
      heightCm: pallet.baseHeightCm + stack.heightCm,
      weightKg: stack.weightKg,
      fill: full ? 1 : Math.min(1, Math.max(stack.heightCm / usable,
        pallet.maxWeightKg > 0 ? stack.weightKg / pallet.maxWeightKg : 0)),
      full,
    };
  });
}

/**
 * How many more omdozen of one product still go on without an extra pallet:
 * the largest number up to one full pallet of it for which a fresh plan
 * keeps the count. Every try is a whole re-plan, the cap to pallets of their
 * own included, and only a tried number is kept, so an offer never promises
 * room the plan then does not find.
 */
export function roomWithoutExtraPallet(lines: readonly PlanLine[], key: number, pallet: PalletSpec, count: number): number {
  const index = lines.findIndex((line) => line.key === key);
  const line = lines[index];
  if (!line || count <= 0 || line.fit.cartonsPerPallet <= 0 || !(line.cartonHeightCm > 0)) return 0;
  const keepsCount = (extra: number) => planPallets(
    lines.map((candidate, at) => (at === index ? { ...candidate, cartons: candidate.cartons + extra } : candidate)),
    pallet).length <= count;
  let low = 0;
  let high = line.fit.cartonsPerPallet;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (keepsCount(middle)) low = middle;
    else high = middle - 1;
  }
  return low;
}

/**
 * One pallet shared by these products: whole layers handed out one at a
 * time to the product with the least height so far, while the next layer
 * still goes under the height and the weight. The layers make one stack, so
 * planPallets puts them on one pallet. Returns cartons per key.
 */
export function shareOnePallet(lines: readonly Omit<PlanLine, 'cartons'>[], pallet: PalletSpec): Map<number, number> {
  const usable = pallet.maxHeightCm - pallet.baseHeightCm;
  const candidates = lines.filter((line) => line.fit.cartonsPerPallet > 0 && line.cartonHeightCm > 0);
  const layers = new Map<number, number>(candidates.map((line) => [line.key, 0]));
  let height = 0;
  let weight = 0;
  for (;;) {
    let pick: (typeof candidates)[number] | null = null;
    for (const line of candidates) {
      const layerWeight = line.fit.perLayer * line.cartonWeightKg;
      if (height + line.cartonHeightCm > usable + EPSILON || weight + layerWeight > pallet.maxWeightKg + EPSILON) continue;
      const used = (layers.get(line.key) ?? 0) * line.cartonHeightCm;
      const best = pick ? (layers.get(pick.key) ?? 0) * pick.cartonHeightCm : Number.POSITIVE_INFINITY;
      if (used < best - EPSILON) pick = line;
    }
    if (!pick) break;
    layers.set(pick.key, (layers.get(pick.key) ?? 0) + 1);
    height += pick.cartonHeightCm;
    weight += pick.fit.perLayer * pick.cartonWeightKg;
  }
  return new Map(candidates.map((line) => [line.key, (layers.get(line.key) ?? 0) * line.fit.perLayer]));
}
