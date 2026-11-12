import type { Category, Product, ProductFamily } from '../../core/api/models';
import { COLOUR_SWATCHES } from '../../core/api/geo';
import { productPickerFamilySections } from '../../shared/product-picker-family-groups';
import { salesPhotoUrl } from '../../shared/sales-photo';

/**
 * The photo tiles of Palletberekening (pallet-browser.ts), free of Angular.
 *
 * One tile is one carton: the colour variants of a range that share every
 * input of the pallet and container figures fold into one tile, so a tap
 * adds the product without a colour step and the tile can show its answer.
 * A range whose sizes come in different cartons gets a tile per carton,
 * told apart by a short label on the photo.
 */

export interface PalletBrowserColour {
  name: string;
  hex: string | null;
}

export interface PalletBrowserTile {
  /** `${range key}|${cartonSignature(lead)}`: family-12|… or product-45|…. */
  key: string;
  /** The range name: ProductFamily.name, else the picker's fallback. */
  name: string;
  /** Only when the range has two or more tiles: "40 cm", "12 per omdoos", "Goud". */
  label: string | null;
  /** Its numbers count; a new row stores lead.id. */
  lead: Product;
  /** The variants folded into the tile, in range order. */
  products: Product[];
  photo: string | null;
  colours: PalletBrowserColour[];
  sectionKey: string;
  /** searchKey() of every text the tile can be found by. */
  search: string;
}

export interface PalletBrowserSection {
  key: string;
  name: string;
  /** A real category, not "Zonder categorie". */
  categorised: boolean;
  tiles: PalletBrowserTile[];
}

const collator = new Intl.Collator('nl-BE', { numeric: true, sensitivity: 'base' });

/** Lower case without accents: "Rozé" and "roze" are one word. */
export function searchKey(value: string): string {
  return value.toLocaleLowerCase('nl-BE').normalize('NFD').replace(/\p{M}/gu, '');
}

/**
 * Exactly the inputs of palletFit, productUnits, containerCapacity, the
 * carton m³, the weight and the piece word: equal signatures give equal
 * figures in every cell of the card.
 */
export function cartonSignature(product: Product): string {
  const carton = product.carton;
  const packaging = product.packaging;
  const display = packaging?.kind === 'DISPLAY';
  return JSON.stringify([carton.lengthCm, carton.widthCm, carton.heightCm, carton.weightKg, carton.piecesPerCarton,
    carton.piecesPer20Ft ?? null, carton.piecesPerHc ?? null, product.cartonCbm ?? null, packaging?.kind ?? 'NONE',
    display ? packaging?.piecesPerUnit ?? null : null, display ? packaging?.salesUnit ?? 'PIECE' : null,
    packaging?.unitKey?.trim().toLowerCase() || 'stuk']);
}

/** The sections in category order, each range split into one tile per carton. */
export function palletBrowserSections(
  products: readonly Product[],
  families: readonly ProductFamily[],
  categories: readonly Category[],
): PalletBrowserSection[] {
  return productPickerFamilySections(products, families, categories, { query: '', category: null, limit: 1000 })
    .map((section) => ({
      key: section.key,
      name: section.name,
      categorised: section.categoryId !== null,
      tiles: section.groups.flatMap((group) => {
        const cartons = new Map<string, Product[]>();
        for (const product of group.products) {
          const signature = cartonSignature(product);
          const variants = cartons.get(signature);
          if (variants) variants.push(product);
          else cartons.set(signature, [product]);
        }
        const split = [...cartons.values()];
        const colours = split.map(coloursOf);
        const labels = tileLabels(split, colours);
        return [...cartons.keys()].map((signature, index): PalletBrowserTile => {
          const variants = split[index];
          const lead = variants.includes(group.lead) ? group.lead : variants[0];
          const label = labels[index];
          return {
            key: `${group.key}|${signature}`,
            name: group.name,
            label,
            lead,
            products: variants,
            photo: salesPhotoUrl(lead) ?? variants.map(salesPhotoUrl).find((url) => url !== null) ?? null,
            colours: colours[index],
            sectionKey: section.key,
            search: searchKey([group.name, group.family?.familyKey, section.name, label, ...variants.flatMap((product) => [
              product.name, product.sku, product.colour, product.variantSize, product.describedAs,
              product.barcodeInner, product.barcodeOuter, product.canonicalBarcode,
            ])].filter(Boolean).join(' ')),
          };
        });
      }),
    }));
}

/** Every variant id to the tile it folded into. */
export function tilesByProduct(sections: readonly PalletBrowserSection[]): Map<number, PalletBrowserTile> {
  const tiles = new Map<number, PalletBrowserTile>();
  for (const section of sections) {
    for (const tile of section.tiles) {
      for (const product of tile.products) if (product.id !== null) tiles.set(product.id, tile);
    }
  }
  return tiles;
}

/**
 * Every word of the query must occur, in any order and without accents
 * ("stolp roze", "25 rood"); an exact SKU or barcode comes first, the rest
 * keeps the catalogue order.
 */
export function matchPalletTiles(sections: readonly PalletBrowserSection[], query: string): PalletBrowserTile[] {
  const needle = searchKey(query.trim());
  const words = needle.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits = sections.flatMap((section) => section.tiles).filter((tile) => words.every((word) => tile.search.includes(word)));
  const exact = hits.filter((tile) => tile.products.some((product) =>
    [product.sku, product.barcodeInner, product.barcodeOuter, product.canonicalBarcode]
      .some((code) => !!code && searchKey(code.trim()) === needle)));
  return exact.length ? [...exact, ...hits.filter((tile) => !exact.includes(tile))] : hits;
}

/** The newest first, without doubles, at most `max`. */
export function rememberRecent(ids: readonly number[], id: number, max = 12): number[] {
  return [id, ...ids.filter((known) => known !== id)].slice(0, max);
}

/** The colours of a tile in range order, one per name; the swatch of the name when a variant has no hex. */
function coloursOf(products: readonly Product[]): PalletBrowserColour[] {
  const colours: PalletBrowserColour[] = [];
  for (const product of products) {
    const name = product.colour?.trim();
    if (!name) continue;
    const hex = product.colourHex?.trim() || null;
    const known = colours.find((colour) => collator.compare(colour.name, name) === 0);
    if (known) known.hex ??= hex;
    else colours.push({ name, hex });
  }
  for (const colour of colours) {
    const name = colour.name.toLocaleLowerCase('nl-BE');
    colour.hex ??= Object.entries(COLOUR_SWATCHES).find(([swatch]) => swatch.toLocaleLowerCase('nl-BE') === name)?.[1] ?? null;
  }
  return colours;
}

function cm(value: number): string {
  return value.toLocaleString('nl-BE', { maximumFractionDigits: 1 });
}

/**
 * The words on the photo of a range with two or more tiles: the first rule
 * that gives every tile its own text (sizes, the omdoos content, colours,
 * the omdoos size, the SKU).
 */
function tileLabels(tiles: readonly Product[][], colours: readonly PalletBrowserColour[][]): (string | null)[] {
  if (tiles.length < 2) return tiles.map(() => null);
  const rules: ((products: readonly Product[], index: number) => string)[] = [
    (products) => products.reduce<string[]>((sizes, product) => {
      const size = product.variantSize?.trim();
      if (size && !sizes.some((known) => collator.compare(known, size) === 0)) sizes.push(size);
      return sizes;
    }, []).join(' · '),
    (products) => (products[0].carton.piecesPerCarton ? `${products[0].carton.piecesPerCarton.toLocaleString('nl-BE')} per omdoos` : ''),
    (_, index) => {
      const names = colours[index].map((colour) => colour.name);
      return names.slice(0, 2).join(' · ') + (names.length > 2 ? ` +${names.length - 2}` : '');
    },
    (products) => {
      const { lengthCm, widthCm, heightCm } = products[0].carton;
      return lengthCm && widthCm && heightCm ? `${cm(lengthCm)} × ${cm(widthCm)} × ${cm(heightCm)}` : '';
    },
  ];
  for (const rule of rules) {
    const texts = tiles.map(rule);
    if (texts.every(Boolean) && new Set(texts.map((text) => text.toLocaleLowerCase('nl-BE'))).size === texts.length) return texts;
  }
  return tiles.map((products) => products[0].sku);
}
