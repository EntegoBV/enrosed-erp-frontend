import type { CartonDto } from '../../core/api/models';
import type { CartonUp, PalletFit, PalletSpec } from './pallet-calculator-model';
import { packDeck, packPallets, packUnits, type PackDeck, type PackKind, type PackedPallet } from './pallet-pack';

/**
 * A full carrier of one omdoos (Emre, 2026-11-27, on 12 Steelrozen - Display, 68 × 50 × 40 cm: "normaal
 * gaan er 13 steelrozen op een pallet van 230, en jij geeft op catalogus 10 aan", "die 13 ... heb ik zelf
 * moeten kantelen, dit moet automatisch kunnen"). Whole layers on one side (palletFit and friends) give 10
 * upright and 12 on the side; stacks side by side, some on the side and some on the end, take 14 at 218 cm.
 * The packer (pallet-pack.ts, the very steps a PACKED document counts with) finds that load, so the figure a
 * card, a tile, the product page and the catalogue show is what a new quote puts on each pallet.
 *
 * The figure is a PER-CARRIER figure that holds for any number of carriers: the packer fills pallet after
 * pallet from what is left, each from plenty, so k carriers' worth makes k carriers. A count one carrier
 * takes only on its own (the first try of 2026-11-27 climbed to it: 21 bowls of 40 × 30 × 38 on a kar where
 * the packer loads 20 per kar from plenty, so 42 counted 3 karren) is never shown.
 *
 * The search, free of Angular and identical to the server's PalletCalculator.fullLoad (keep the two alike):
 * 1. nothing fits as whole layers (`layer` 0: too large or too heavy on every side): none fits, as the packer
 *    has no side either (decided before any size is converted, so an absurd size never reaches the packer);
 * 2. the most omdozen the floor and the weight could ever take (the deck's volume, the weight limit): the bound;
 *    at most the layers' count, or more than MAX_SEARCHED (the packer would lay thousands of boxes for a figure
 *    the layers give within a few omdozen): the layers stand;
 * 3. the packer's first pallet from more than the bound, so it fills as full as it gets from plenty;
 * 4. that many alone must go on one pallet too (the last pallet of a load is packed from what is left), else
 *    one fewer, at most STEPS_DOWN times, never below the layers' count;
 * 5. no hole just under it: each of the HOLE_WINDOW counts below must go on one carrier alone too, else the
 *    figure drops below the highest such hole (and must again go alone), at most HOLE_ROUNDS times. From F + m
 *    omdozen the first carrier takes F and the rest m must go on one more: the packer is not monotone, and an
 *    omdoos of 14,22 × 50,15 × 72,67 cm read 42 per pallet while 83 counted 3 (42, 40, 1; second review of
 *    2026-11-27; none of the 29 real omdozen had such a hole);
 * 6. the layers where they take as many or more: the figure is never below what whole layers count.
 * Beside it, `alone`: the most ONE carrier takes on its own (the packer's count from plenty and one more at a
 * time while that still goes alone). Never shown as the per-carrier figure; Palletberekening judges a plan of
 * one carrier by it ("vol", the fill, Automatisch and Verdeel on one carrier). Only the frontend has it.
 *
 * No step of the packer changes: it stays frozen for PACKED documents. This only asks it for one full pallet.
 */

type CartonSize = Pick<CartonDto, 'lengthCm' | 'widthCm' | 'heightCm' | 'weightKg'>;

export interface FullLoad {
  /** Omdozen of this size per carrier, for any number of carriers; 0 when none fits. */
  cartons: number;
  /** The most one carrier takes on its own: at least `cartons`, a few more for a few omdozen (21 bowls on one kar, 20 per kar). */
  alone: number;
  /** The loaded height of that carrier, the wood or the kar's base included; 0 when none fits. */
  heightCm: number;
  /**
   * How that load stands: 'layers' is the fit's own (perLayer × layers, every omdoos on the fit's side `up`);
   * 'packed' is the packer's, stacks side by side that may stand on different sides.
   */
  how: 'layers' | 'packed';
  /** Omdozen that lie down in it (on the side or on the end): 0 when all stand upright. */
  tipped: number;
  /** What stops one more: the weight, or the room (the height and the floor); null when none fits. */
  limitedBy: 'hoogte' | 'gewicht' | null;
}

/** Beyond this many omdozen on one carrier (by volume) the layers decide. */
export const MAX_SEARCHED = 1500;
/** How often a count reached from plenty may drop by one before the layers decide. */
const STEPS_DOWN = 8;
/** The counts under the figure that must each go on one carrier alone, and how often a hole may lower it. */
const HOLE_WINDOW = 8;
const HOLE_ROUNDS = 4;
/** Results by omdoos, carrier and sides: a page asks for the same figures on every change. */
const MEMO = new Map<string, FullLoad>();
const MEMO_LIMIT = 600;

function layerLoad(layer: PalletFit, alone = layer.cartonsPerPallet): FullLoad {
  return {
    cartons: layer.cartonsPerPallet, alone: Math.max(alone, layer.cartonsPerPallet), heightCm: layer.heightCm, how: 'layers',
    tipped: layer.cartonsPerPallet > 0 && layer.up !== 'h' ? layer.cartonsPerPallet : 0, limitedBy: layer.limitedBy,
  };
}

/** The pallet these many omdozen make on their own, or null when they need more than one. */
function alone(kind: (count: number) => PackKind, deck: PackDeck, count: number): PackedPallet | null {
  const result = packPallets([kind(count)], deck, 1);
  return result.left.size === 0 && result.pallets.length === 1 ? result.pallets[0] : null;
}

/**
 * The most omdozen of this size on one carrier and how they stand. `layer` is the whole-layer fit the caller
 * counts with on the same spec (palletFit for the catalogue and a quote, the card's fit in Palletberekening);
 * `sides` are the sides an omdoos may stand on (ALL_SIDES, or UPRIGHT when tipping is off).
 */
export function fullLoad(carton: CartonSize, pallet: PalletSpec, sides: readonly CartonUp[], layer: PalletFit): FullLoad {
  const length = packUnits(carton.lengthCm ?? 0); const width = packUnits(carton.widthCm ?? 0); const height = packUnits(carton.heightCm ?? 0);
  const weight = carton.weightKg && carton.weightKg > 0 ? packUnits(carton.weightKg) : 0;
  if (layer.cartonsPerPallet <= 0 || !(length > 0 && width > 0 && height > 0) || !sides.length) return layerLoad(layer);
  const deck = packDeck(pallet);
  const key = [length, width, height, weight, deck.length, deck.width, deck.height, deck.maxWeight, sides.join(''),
    layer.cartonsPerPallet, layer.heightCm, layer.up, pallet.baseHeightCm].join('|');
  const known = MEMO.get(key);
  if (known) return known;
  const result = search(length, width, height, weight, deck, sides, layer, pallet.baseHeightCm);
  if (MEMO.size >= MEMO_LIMIT) MEMO.clear();
  MEMO.set(key, result);
  return result;
}

function search(length: number, width: number, height: number, weight: number, deck: PackDeck, sides: readonly CartonUp[],
  layer: PalletFit, baseHeightCm: number): FullLoad {
  const layers = layerLoad(layer);
  if (deck.maxWeight > 0 && weight > deck.maxWeight) return layers;
  const byVolume = Math.floor((deck.length * deck.width * deck.height) / (length * width * height));
  const byWeight = weight > 0 && deck.maxWeight > 0 ? Math.floor(deck.maxWeight / weight) : Number.POSITIVE_INFINITY;
  const bound = Math.min(byVolume, byWeight);
  if (bound <= layer.cartonsPerPallet || bound > MAX_SEARCHED) return layers;
  const kind = (count: number): PackKind => ({ key: 1, length, width, height, weight, count, sides });
  const plenty = packPallets([kind(bound + 1)], deck, 1).pallets[0];
  let count = plenty?.counts.get(1) ?? 0;
  let load: PackedPallet | null = null;
  for (let step = 0; step <= STEPS_DOWN && count > layer.cartonsPerPallet; step++) {
    load = alone(kind, deck, count);
    if (load) break;
    count -= 1;
  }
  const verified = !!load && count > layer.cartonsPerPallet;
  /* One carrier on its own: one more at a time while that still goes alone, from the packed count or the layers. */
  let most = verified ? count : layer.cartonsPerPallet;
  while (most < bound && alone(kind, deck, most + 1)) most += 1;
  if (!verified) return layerLoad(layer, most);
  /* No hole just under the figure: the rest of F + m omdozen must go on one carrier more. */
  for (let round = 0; round < HOLE_ROUNDS && load && count > layer.cartonsPerPallet; round++) {
    let hole = 0;
    for (let m = count - 1; m >= Math.max(1, count - HOLE_WINDOW); m--) {
      if (!alone(kind, deck, m)) { hole = m; break; }
    }
    if (!hole) break;
    count = hole - 1;
    load = null;
    for (let step = 0; step <= STEPS_DOWN && count > layer.cartonsPerPallet; step++) {
      load = alone(kind, deck, count);
      if (load) break;
      count -= 1;
    }
  }
  if (!load || count <= layer.cartonsPerPallet) return layerLoad(layer, most);
  return {
    cartons: count,
    alone: Math.max(count, most),
    heightCm: Math.round((baseHeightCm + load.top / 100) * 10) / 10,
    how: 'packed',
    tipped: load.boxes.filter((box) => box.up !== 'h').length,
    limitedBy: count >= byWeight ? 'gewicht' : 'hoogte',
  };
}

/** How a full load stands, in words for a card or a product page; null when it stands upright in whole layers. */
export function fullLoadWords(full: FullLoad, layerUp: CartonUp): string | null {
  if (full.cartons <= 0) return null;
  if (full.how === 'layers') return layerUp === 'w' ? 'op de zij' : layerUp === 'l' ? 'op de korte kant' : null;
  if (!full.tipped) return 'zo vol mogelijk';
  return full.tipped >= full.cartons ? 'zo vol mogelijk, gekanteld' : 'zo vol mogelijk, deels gekanteld';
}
