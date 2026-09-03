import { COLOUR_SWATCHES } from '../../core/api/geo';
import { Product } from '../../core/api/models';

/** "Preserved rose with stem - Rood" says Rood once a variant line does. */
export function stripColour(name: string, colour: string | null | undefined): string {
  const tint = colour?.trim();
  if (!tint) return name;
  const escaped = tint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const stripped = name.replace(new RegExp(`\\s*[-–·]\\s*${escaped}\\s*$`, 'i'), '').trim();
  return stripped || name;
}

/** "Rood · 30 cm": what tells one variant of a series from another. */
export function variantOf(product: Pick<Product, 'colour' | 'variantSize'>): string | null {
  const parts = [product.colour, product.variantSize].map((value) => value?.trim()).filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

/** The swatch colour: the product's own hex, or the house colour behind its name. */
export function colourHexOf(explicit: string | null | undefined, label: string | null | undefined): string | null {
  if (explicit?.trim()) return explicit.trim();
  const normalized = (label ?? '').trim().toLocaleLowerCase('nl-BE');
  if (!normalized) return null;
  return Object.entries(COLOUR_SWATCHES).find(([name]) =>
    name.toLocaleLowerCase('nl-BE') === normalized)?.[1] ?? null;
}
