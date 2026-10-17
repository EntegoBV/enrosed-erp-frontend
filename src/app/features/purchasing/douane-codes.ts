/*
 * Douane (Inkoop redesign I8, 2026-10-17): the HS codes with their duty, the
 * products per code, and the two checks the old settings card could not do.
 * The server matches a product's HS code to a tariff exactly as stored
 * (HsCodeService.findByCode): '0603 90 00 00' does not find '0603900000', and
 * such a product silently falls back to the order's percentage. This module
 * only reads and words; it never rewrites a stored code. Pure and node-tested:
 * type-only imports.
 */
import type { HsCode, Product } from '../../core/api/models';

/** The code without spaces, dots or dashes, upper case: what two spellings share. */
export function normalizeHs(code: string | null | undefined): string {
  return (code ?? '').replace(/[\s.\-]/g, '').toUpperCase();
}

/** The code as people read it: 10 digits 4-2-2-2, 8 digits 4-2-2, anything else exactly as stored (N19). */
export function formatHs(code: string | null | undefined): string {
  const stored = code ?? '';
  const digits = stored.replace(/[\s.]/g, '');
  if (/^\d{10}$/.test(digits)) return `${digits.slice(0, 4)} ${digits.slice(4, 6)} ${digits.slice(6, 8)} ${digits.slice(8)}`;
  if (/^\d{8}$/.test(digits)) return `${digits.slice(0, 4)} ${digits.slice(4, 6)} ${digits.slice(6)}`;
  return stored;
}

type ProductCode = Pick<Product, 'id' | 'name' | 'hsCode'>;

/** Products per tariff, matched exactly as the server does. */
export function countByCode(products: readonly ProductCode[], codes: readonly Pick<HsCode, 'code'>[]): Map<string, number> {
  const out = new Map<string, number>(codes.map((code) => [code.code, 0]));
  for (const product of products) {
    const code = product.hsCode ?? '';
    if (out.has(code)) out.set(code, out.get(code)! + 1);
  }
  return out;
}

/** Products without an HS code: they count with the order's own percentage. */
export function withoutCode<T extends ProductCode>(products: readonly T[]): T[] {
  return products.filter((product) => !(product.hsCode ?? '').trim());
}

export interface SpellingMismatch<T extends ProductCode = ProductCode> {
  /** The tariff as stored. */
  code: string;
  /** How these products spell it. */
  spelled: string;
  products: T[];
}

/** Products whose code equals a tariff only after removing spaces and dots: no tariff found, the order's percentage applies. */
export function spellingMismatches<T extends ProductCode>(products: readonly T[], codes: readonly Pick<HsCode, 'code'>[]): SpellingMismatch<T>[] {
  const exact = new Set(codes.map((code) => code.code));
  const byNormal = new Map(codes.map((code) => [normalizeHs(code.code), code.code]));
  const groups = new Map<string, SpellingMismatch<T>>();
  for (const product of products) {
    const spelled = product.hsCode ?? '';
    if (!spelled.trim() || exact.has(spelled)) continue;
    const tariff = byNormal.get(normalizeHs(spelled));
    if (!tariff) continue;
    const key = tariff + '\u0001' + spelled;
    const group = groups.get(key) ?? { code: tariff, spelled, products: [] };
    group.products.push(product);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** A percentage typed the Belgian way ('6,5' or '6.5'); null when it is no number. */
export function parsePct(text: string | null | undefined): number | null {
  const raw = String(text ?? '').trim().replace(',', '.');
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/** '10,0 %' in the table, one decimal. */
export function pctLabel(value: number | null | undefined): string {
  const number = Number.isFinite(value as number) ? value as number : 0;
  return number.toLocaleString('nl-BE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' %';
}

/** The field's text for a stored percentage: '6,5', '10'. */
export function pctInput(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? '' : String(value).replace('.', ',');
}

export interface TariffErrors { code?: string; duty?: string }

/** The edit row's checks: a new code is required and new in every spelling; the duty lies between 0 and 100 %. */
export function validateTariff(draft: { code: string; dutyText: string; isNew: boolean }, existing: readonly Pick<HsCode, 'code'>[]): TariffErrors {
  const errors: TariffErrors = {};
  if (draft.isNew) {
    const code = draft.code.trim();
    if (!code) errors.code = 'Vul een code in';
    else {
      const same = existing.find((candidate) => normalizeHs(candidate.code) === normalizeHs(code));
      if (same) errors.code = `Deze code bestaat al als ${formatHs(same.code)}`;
    }
  }
  const duty = parsePct(draft.dutyText);
  if (duty === null || duty < 0 || duty > 100) errors.duty = 'Invoerrecht tussen 0 en 100 %';
  return errors;
}

/** What changed in an open row, in words for the strip under it ('Omschrijving, invoerrecht'). */
export function changedFields(original: Pick<HsCode, 'code' | 'description' | 'dutyRatePct'> | null,
  draft: { code: string; description: string; dutyText: string }): string[] {
  if (!original) return ['nieuw tarief'];
  const out: string[] = [];
  if ((original.description ?? '') !== draft.description) out.push('omschrijving');
  if (parsePct(draft.dutyText) !== original.dutyRatePct) out.push('invoerrecht');
  return out;
}

/** The search: code in any spelling, or words of the description. */
export function matchesTariff(code: Pick<HsCode, 'code' | 'description'>, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return normalizeHs(code.code).includes(normalizeHs(needle)) && normalizeHs(needle) !== ''
    || (code.description ?? '').toLowerCase().includes(needle);
}
