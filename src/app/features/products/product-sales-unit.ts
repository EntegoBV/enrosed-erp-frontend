import { signal } from '@angular/core';
import type { OrderStep, Product, UnitName } from '../../core/api/models';

type ProductWithPackaging = Pick<Product, 'packaging'> | null | undefined;

/** The unit of every product that never chose one; blank or unknown keys read as this one too. */
export const DEFAULT_UNIT_KEY = 'stuk';

/** Today's wording, used until the server list has arrived (or when it cannot be loaded). */
const STUK: UnitName = { key: DEFAULT_UNIT_KEY, one: 'stuk', other: 'stuks', per: 'per stuk', short: 'st.' };

/**
 * The Dutch unit names of `GET /api/products/unit-names`, handed over by
 * CatalogApi.unitNames(). A signal on purpose: templates that printed "stuks"
 * before the list arrived render "bowls" as soon as it does.
 */
const knownUnits = signal<ReadonlyMap<string, UnitName>>(new Map());

export function rememberUnitNames(names: readonly UnitName[]): void {
  knownUnits.set(new Map(names.map((unit) => [unit.key, unit])));
}

/** Same cleaning as the server: trimmed and lower case; anything else is not a unit key. */
function cleanUnitKey(key: string | null | undefined): string {
  return key?.trim().toLowerCase() ?? '';
}

/** The names of one unit key; blank, unknown or not yet loaded reads as "stuk". */
export function unitName(key: string | null | undefined): UnitName {
  const units = knownUnits();
  return units.get(cleanUnitKey(key)) ?? units.get(DEFAULT_UNIT_KEY) ?? STUK;
}

/** "bowls" → "Bowls", for a unit word at the start of a label. */
export function capitalize(text: string): string {
  return text.charAt(0).toLocaleUpperCase('nl-BE') + text.slice(1);
}

/** "1 bowl", "1.200 bowls": a count with the matching Dutch noun. */
export function unitCount(unit: { singular: string; plural: string }, quantity: number): string {
  return `${quantity.toLocaleString('nl-BE')} ${quantity === 1 ? unit.singular : unit.plural}`;
}

/** Presentation only: never converts the price or quantity stored on a document. */
export function productSalesUnit(product: ProductWithPackaging) {
  const packaging = product?.packaging;
  const isDisplay = packaging?.kind === 'DISPLAY' && packaging.salesUnit === 'DISPLAY';
  const count = packaging?.kind === 'DISPLAY' ? packaging.piecesPerUnit : null;
  const piecesPerDisplay = count != null && Number.isSafeInteger(count) && count > 1 ? count : null;
  /* What one piece is called; with a display basis it names what the display holds. */
  const piece = unitName(packaging?.unitKey);
  const plural = isDisplay ? 'displays' : piece.other;
  return {
    isDisplay,
    piece,
    singular: isDisplay ? 'display' : piece.one,
    plural,
    /** The plural at the start of a label: "Bowls per karton". */
    pluralLabel: capitalize(plural),
    short: isDisplay ? 'display' : piece.short,
    priceLabel: isDisplay ? 'Displayprijs' : piece.key === DEFAULT_UNIT_KEY ? 'Stukprijs' : `Prijs per ${piece.one}`,
    piecesPerDisplay,
  };
}

/** The price on the other side of a display, next to a price in its own unit. */
export interface OtherBasisPrice {
  /** "=" when the figure is exact to the cent, "≈" when it is rounded. */
  sign: '=' | '≈';
  price: number;
  /** What the figure is for, in the words after "per": "display" or "roos". */
  unit: string;
  /** "per display van 12" for a price per piece, "per roos" for a price per display. */
  per: string;
  /** The whole line: "= € 35,40 per display van 12", "≈ € 4,16 per roos". */
  text: string;
}

/**
 * The rule of every ERP price label: the word under a price names what that
 * price is for (productSalesUnit().singular: "per diamant", "per display"),
 * and the other side of a display goes on the line below it. A price per
 * diamant in a display of 12 gives "= € 35,40 per display van 12"; a price
 * per display of 12 roses gives "≈ € 4,16 per roos". Null without a display
 * of two or more pieces, or without a price. Same discount basis as the
 * price handed in; never converts anything that is stored.
 */
export function otherBasisPrice(product: ProductWithPackaging, unitPrice: number | null | undefined): OtherBasisPrice | null {
  const unit = productSalesUnit(product);
  const pieces = unit.piecesPerDisplay;
  if (!pieces || unitPrice == null || !Number.isFinite(unitPrice) || unitPrice <= 0) return null;
  const price = unit.isDisplay ? unitPrice / pieces : unitPrice * pieces;
  /* 31,60 over 8 bowls is exactly 3,95; 49,95 over 12 roses is not. */
  const cents = price * 100;
  const sign = Math.abs(cents - Math.round(cents)) < 1e-6 ? '=' : '≈';
  const word = unit.isDisplay ? unit.piece.one : 'display';
  const per = unit.isDisplay ? unit.piece.per : `per display van ${pieces.toLocaleString('nl-BE')}`;
  return { sign, price, unit: word, per, text: `${sign} ${euro(price)} ${per}` };
}

/** "€ 35,40", as the eur pipe writes it. */
function euro(value: number): string {
  return new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

export function salesQuantityDetail(product: ProductWithPackaging, quantity: number): string | null {
  const unit = productSalesUnit(product);
  const per = unit.piecesPerDisplay;
  if (!per) return null;
  const pieces = unit.piece.other;
  const format = (value: number) => value.toLocaleString('nl-BE');
  if (!Number.isSafeInteger(quantity) || quantity <= 0) return `${format(per)} ${pieces} per display`;
  if (unit.isDisplay) {
    const total = quantity * per;
    return Number.isSafeInteger(total) ? `${format(quantity)} × ${format(per)} = ${format(total)} ${pieces}` : null;
  }
  if (quantity % per !== 0) return `${format(per)} ${pieces} per display`;
  const displays = quantity / per;
  return `${format(displays)} ${displays === 1 ? 'display' : 'displays'} van ${format(per)} ${pieces}`;
}

/**
 * The word after a summed quantity of several lines: the shared noun when every
 * product uses the same unit ("48 bowls"), "stuks" for a mix, and the neutral
 * "verkoopeenheden" as soon as displays and pieces could be added up together.
 */
export function salesQuantityLabel(products: readonly ProductWithPackaging[]): string {
  const units = products.map((product) => productSalesUnit(product));
  if (units.some((unit) => unit.isDisplay)) return 'verkoopeenheden';
  const keys = new Set(units.map((unit) => unit.piece.key));
  return keys.size === 1 ? units[0].plural : unitName(DEFAULT_UNIT_KEY).other;
}

/* ------------------------------------------------ "Hoe verkoop je dit product?" */
/*
 * The words of the product editor's sales card, the product view and the
 * product desk. Pure functions of the product as drafted: the screens hand in
 * the order step as the screens read it (effectiveOrderStep), because this
 * module is node-tested and imports nothing from its siblings at runtime.
 */

/** One piece of the card's sentence; marked parts are what the controls set. */
export interface SentencePart {
  text: string;
  mark?: boolean;
}

type Basis = 'PIECE' | 'DISPLAY';

/** The basis the server stores: a display basis only on a display. */
function basisOf(product: ProductWithPackaging): Basis {
  return productSalesUnit(product).isDisplay ? 'DISPLAY' : 'PIECE';
}

/** The pieces of a display, when it holds two or more, whatever the basis. */
function displayCount(product: ProductWithPackaging): number | null {
  return productSalesUnit(product).piecesPerDisplay;
}

/** What "de klant bestelt per" ends with: "diamant", "display" or "volle omdoos". */
export function orderStepWord(product: ProductWithPackaging, step: OrderStep): string {
  if (step === 'CARTON') return 'volle omdoos';
  if (step === 'PACKAGE') return 'display';
  return productSalesUnit(product).singular;
}

/**
 * "Je verkoopt diamanten, per 12 in een display. Je prijs geldt per diamant;
 * de klant bestelt per display." The packaging, the price basis and the order
 * step in one sentence; `step` is the step as the screens read it.
 */
export function salesSetupSentence(product: ProductWithPackaging, step: OrderStep): SentencePart[] {
  const unit = productSalesUnit(product);
  const kind = product?.packaging?.kind ?? 'NONE';
  const count = unit.piecesPerDisplay;
  const parts: SentencePart[] = [{ text: 'Je verkoopt ' }, { text: unit.piece.other, mark: true }];
  if (kind === 'DISPLAY') {
    parts.push({ text: count ? `, per ${count.toLocaleString('nl-BE')} in een ` : ' in een ' }, { text: 'display', mark: true });
  } else if (kind === 'GIFT_BOX') {
    parts.push({ text: ', elk in een ' }, { text: 'geschenkdoosje', mark: true });
  } else {
    parts.push({ text: ', ' }, { text: 'los', mark: true });
  }
  parts.push(
    { text: '. Je prijs geldt per ' }, { text: unit.singular, mark: true },
    { text: '; de klant bestelt per ' }, { text: orderStepWord(product, step), mark: true }, { text: '.' },
  );
  return parts;
}

/**
 * The packaging as Basisgegevens still shows it, now that it is set in the
 * sales card: "Display met 12 diamanten · prijs per diamant".
 */
export function packagingSummary(product: ProductWithPackaging): string {
  const unit = productSalesUnit(product);
  const packaging = product?.packaging;
  const price = `prijs per ${unit.isDisplay ? 'display' : unit.piece.one}`;
  if (packaging?.kind === 'DISPLAY') {
    const count = packaging.piecesPerUnit;
    return count != null && Number.isSafeInteger(count) && count > 0
      ? `Display met ${unitCount({ singular: unit.piece.one, plural: unit.piece.other }, count)} · ${price}`
      : `Display, aantal nog in te vullen · ${price}`;
  }
  if (packaging?.kind === 'GIFT_BOX') return `Geschenkdoosje · ${price}`;
  return `Geen verpakking, los · ${price}`;
}

/** The sentence as plain text, for a read-only screen. */
export function salesSetupText(product: ProductWithPackaging, step: OrderStep): string {
  return salesSetupSentence(product, step).map((part) => part.text).join('');
}

/**
 * "Zo leest de klant het": what quotes, invoices, the portal and the website
 * show. Like those, a display leads with its display price: "€ 35,40 per
 * display van 12 diamanten", then "€ 2,95 per diamant · bestellen per display ·
 * 12 diamanten per doos".
 */
export function customerReading(
  product: ProductWithPackaging,
  unitPrice: number | null | undefined,
  perCarton: number | null | undefined,
  step: OrderStep,
): { main: string; detail: string } {
  const unit = productSalesUnit(product);
  const priced = unitPrice != null && Number.isFinite(unitPrice) && unitPrice > 0;
  const count = unit.piecesPerDisplay;
  const details: string[] = [];
  let main: string;
  if (count) {
    const contents = `per display van ${count.toLocaleString('nl-BE')} ${unit.piece.other}`;
    if (priced) {
      main = `${euro(unit.isDisplay ? unitPrice : unitPrice * count)} ${contents}`;
      const other = otherBasisPrice(product, unitPrice)!;
      details.push(unit.isDisplay ? `${other.sign === '≈' ? '≈ ' : ''}${euro(other.price)} ${other.per}` : `${euro(unitPrice)} ${unit.piece.per}`);
    } else {
      main = `prijs ${contents}`;
    }
  } else {
    main = priced ? `${euro(unitPrice)} per ${unit.singular}` : `prijs per ${unit.singular}`;
    if (product?.packaging?.kind === 'GIFT_BOX') details.push('in geschenkdoosje');
  }
  details.push(`bestellen per ${orderStepWord(product, step)}`);
  if (perCarton != null && Number.isSafeInteger(perCarton) && perCarton > 0) details.push(`${unitCount(unit, perCarton)} per doos`);
  return { main, detail: details.join(' · ') };
}

/** "Zo rekent het ERP": what the price field, a quantity and stock mean. */
export function erpReading(
  product: ProductWithPackaging,
  unitPrice: number | null | undefined,
  perCarton: number | null | undefined,
): { label: string; value: string }[] {
  const unit = productSalesUnit(product);
  const priced = unitPrice != null && Number.isFinite(unitPrice) && unitPrice > 0;
  const count = unit.piecesPerDisplay;
  const rows = [{ label: 'Prijsveld', value: priced ? `${euro(unitPrice)} per ${unit.singular}` : `per ${unit.singular}` }];
  if (count && unit.isDisplay) rows.push({ label: 'Aantal 1', value: `= ${count.toLocaleString('nl-BE')} ${unit.piece.other}` });
  else if (count) rows.push({ label: `Aantal ${count.toLocaleString('nl-BE')}`, value: '= 1 display' });
  else if (perCarton != null && Number.isSafeInteger(perCarton) && perCarton > 1) rows.push({ label: `Aantal ${perCarton.toLocaleString('nl-BE')}`, value: '= 1 omdoos' });
  rows.push({ label: 'Voorraad en omdoos', value: `in ${unit.plural}` });
  return rows;
}

/** The product with another price basis, for "what would this price mean there". */
function withBasis<T extends ProductWithPackaging>(product: T, basis: Basis): T {
  if (!product?.packaging) return product;
  return { ...product, packaging: { ...product.packaging, salesUnit: basis } };
}

/**
 * The figure on the price-basis option you are not on, at today's price:
 * "€ 2,95 per display ≈ € 0,25 per diamant" for DIAM-D-RD, "€ 49,95 per roos
 * = € 599,40 per display" for the steelrozen. Null on the current option,
 * without a display of two or more, or without a price.
 */
export function basisOptionFigure(product: ProductWithPackaging, unitPrice: number | null | undefined, basis: Basis): string | null {
  if (basisOf(product) === basis || !displayCount(product)) return null;
  const other = withBasis(product, basis);
  const equivalent = otherBasisPrice(other, unitPrice);
  if (!equivalent) return null;
  return `${euro(unitPrice!)} per ${productSalesUnit(other).singular} ${equivalent.sign} ${euro(equivalent.price)} per ${equivalent.unit}`;
}

/** A saved product's price basis about to change: to a display, or to one piece (leaving the display or not). */
export interface PriceBasisChange {
  to: Basis;
  /** The display that carries or carried the price; null when its count is unknown or below two. */
  pieces: number | null;
  /** The packaging left Display: the server then stores per piece. */
  leftDisplay: boolean;
}

/**
 * The basis the draft would store against the saved product's. Nothing is
 * converted by a change; the card warns and Opslaan asks first. Null for a
 * new product and when the basis stays.
 */
export function priceBasisChange(saved: ProductWithPackaging, draft: ProductWithPackaging): PriceBasisChange | null {
  if (!saved || !draft) return null;
  const from = basisOf(saved);
  const to = basisOf(draft);
  if (from === to) return null;
  return {
    to,
    pieces: to === 'DISPLAY' ? displayCount(draft) : displayCount(saved),
    leftDisplay: to === 'PIECE' && draft.packaging?.kind !== 'DISPLAY',
  };
}

/** The saved price on the new basis, to the cent: × pieces to a display, ÷ pieces to one piece. */
export function convertedPrice(savedPrice: number | null | undefined, change: PriceBasisChange | null): number | null {
  if (!change?.pieces || savedPrice == null || !Number.isFinite(savedPrice) || savedPrice <= 0) return null;
  const value = change.to === 'DISPLAY' ? savedPrice * change.pieces : savedPrice / change.pieces;
  return Math.round(value * 100) / 100;
}

/**
 * The convert button: "Prijs × 12 = € 35,40 invullen", or "Prijs ÷ 12 ≈ € 4,16
 * invullen" when the price does not split to the cent (49,95 ÷ 12 = 4,1625),
 * the same "≈" as the figures around it. Empty when there is nothing to convert.
 */
export function convertPriceLabel(price: number | null | undefined, change: PriceBasisChange | null): string {
  const target = convertedPrice(price, change);
  if (target === null || !change?.pieces) return '';
  const raw = change.to === 'DISPLAY' ? price! * change.pieces : price! / change.pieces;
  const sign = Math.abs(raw * 100 - Math.round(raw * 100)) < 1e-6 ? '=' : '≈';
  return `Prijs ${change.to === 'DISPLAY' ? '×' : '÷'} ${change.pieces.toLocaleString('nl-BE')} ${sign} ${euro(target)} invullen`;
}

/** "€ 35,40", for a button or a sentence. */
export function euroText(value: number): string {
  return euro(value);
}

/**
 * The card's warning under "Prijs geldt per", with the figures of the draft:
 * "Let op: het prijsveld wordt de prijs van een volledig display. Nu € 2,95,
 * dus ≈ € 0,25 per diamant. Voorraad, doosinhoud (12) en kostprijs worden niet
 * omgerekend; pas ze zelf aan."
 */
export function priceBasisWarning(
  draft: ProductWithPackaging,
  change: PriceBasisChange,
  unitPrice: number | null | undefined,
  perCarton: number | null | undefined,
): string {
  const piece = productSalesUnit(draft).piece;
  const priced = unitPrice != null && Number.isFinite(unitPrice) && unitPrice > 0;
  const carton = perCarton != null && Number.isSafeInteger(perCarton) && perCarton > 0 ? ` (${perCarton.toLocaleString('nl-BE')})` : '';
  const tail = `Voorraad, doosinhoud${carton} en kostprijs worden niet omgerekend; pas ze zelf aan.`;
  if (change.to === 'DISPLAY') {
    const other = priced ? otherBasisPrice(draft, unitPrice) : null;
    const now = priced ? ` Nu ${euro(unitPrice)}${other ? `, dus ${other.text}` : ''}.` : '';
    return `Let op: het prijsveld wordt de prijs van een volledig display.${now} ${tail}`;
  }
  const now = priced ? ` nu ${euro(unitPrice)} per ${piece.one}.` : '.';
  if (change.leftDisplay) {
    const was = change.pieces ? `display van ${change.pieces.toLocaleString('nl-BE')}` : 'display';
    return `Deze prijs gold per ${was}. Zonder display geldt hij per ${piece.one}${priced ? ':' : ''}${now} ${tail}`;
  }
  return `Let op: het prijsveld wordt de prijs van één ${piece.one}${priced ? ':' : ''}${now} ${tail}`;
}

/**
 * The confirmation before a save that changes the price basis, as plain text.
 * Stored amounts and quantities stay, but every ERP sales screen (and a newly
 * made PDF) words a line from the live product: an open quote of 10 diamanten
 * reads 10 displays afterwards, so it says so instead of reassuring.
 */
export function priceBasisConfirmation(
  saved: ProductWithPackaging,
  draft: ProductWithPackaging,
  change: PriceBasisChange,
  unitPrice: number | null | undefined,
  perCarton: number | null | undefined,
  stock: number | null | undefined,
): string {
  const before = productSalesUnit(saved);
  const after = productSalesUnit(draft);
  const name = (unit: ReturnType<typeof productSalesUnit>, count: number | null) =>
    unit.isDisplay && count ? `display van ${count.toLocaleString('nl-BE')}` : unit.singular;
  const priced = unitPrice != null && Number.isFinite(unitPrice) && unitPrice > 0;
  const field = priced ? ` Het prijsveld wordt ${euro(unitPrice)} per ${after.singular}.` : '';
  const counts = [
    stock != null && Number.isFinite(stock) ? `voorraad (${stock.toLocaleString('nl-BE')})` : 'voorraad',
    perCarton != null && Number.isSafeInteger(perCarton) && perCarton > 0 ? `doosinhoud (${perCarton.toLocaleString('nl-BE')})` : 'doosinhoud',
    'kostprijs',
  ];
  const list = `${counts[0].charAt(0).toLocaleUpperCase('nl-BE')}${counts[0].slice(1)}, ${counts[1]} en ${counts[2]}`;
  const quotes = `Bestaande offertes houden hun bedragen, maar hun aantallen tellen voortaan in ${after.plural}:`
    + ` 10 ${before.plural} op een offerte worden 10 ${after.plural}. Controleer open offertes.`;
  return `De prijs geldt dan per ${name(after, displayCount(draft))} in plaats van per ${name(before, displayCount(saved))}.${field}`
    + ` ${list} worden niet omgerekend. ${quotes}`;
}
