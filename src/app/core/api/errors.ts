/**
 * De boodschap uit een mislukte aanroep halen.
 *
 * De backend stuurt bij een geweigerde bewerking een uitleg mee ("Er bestaat al
 * een verkooporder met nummer X"). Die is bruikbaarder dan "er ging iets mis",
 * dus die tonen we als hij er is. Staat er niets, dan valt het terug op onze
 * eigen zin - een technische foutmelding zegt de gebruiker niets.
 */
export function messageOf(failure: unknown, fallback: string): string {
  return (failure as { error?: { message?: string } }).error?.message ?? fallback;
}
