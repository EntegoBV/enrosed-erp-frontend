import type { Fair } from '../../core/api/models';
import type { SalesChannel } from '../sales/sales-channels';

/*
 * The channel pickers of the finance screens. No runtime imports: the node
 * tests run this file on its own.
 */

const normalise = (code: string | null | undefined): string => (code ?? '').trim().toUpperCase();

/**
 * The fairs first (the active ones, and the inactive ones a booking still
 * carries), labelled by the fair and flagged by hint 'Beurs'; then the
 * built-in channels whose code is not a fair's, so TICA appears once, as a
 * fair.
 */
export function mergeChannels(builtIn: readonly SalesChannel[], fairs: readonly Fair[], inUse: readonly (string | null | undefined)[]): SalesChannel[] {
  const carried = new Set(inUse.map(normalise).filter(Boolean));
  const fairChoices = fairs.filter((fair) => fair.active || carried.has(normalise(fair.code)))
    .map((fair) => ({ code: normalise(fair.code), label: fair.label, hint: 'Beurs' }));
  const codes = new Set(fairChoices.map((fair) => fair.code));
  return [...fairChoices, ...builtIn.filter((channel) => !codes.has(channel.code))];
}
