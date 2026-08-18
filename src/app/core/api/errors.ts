/**
 * Pulling the message out of a failed call.
 *
 * On a refused operation the backend sends an explanation along ("Er
 * bestaat al een verkooporder met nummer X"). That beats "something went
 * wrong", so we show it when present. When there is nothing, we fall back
 * to our own sentence - a technical error tells the user nothing.
 */
export function messageOf(failure: unknown, fallback: string): string {
  return (failure as { error?: { message?: string } }).error?.message ?? fallback;
}
