/**
 * Quiet purchasing guidance for quantities that do not fill an outer carton.
 *
 * Purchasing deliberately accepts loose pieces. This helper only explains the
 * nearest useful full-carton quantities; it never changes the entered value.
 */
export function cartonQuantityNotice(
  quantity: number,
  piecesPerCarton: number | null | undefined,
): string | null {
  if (!Number.isInteger(quantity) || quantity <= 0) return null;
  if (!Number.isInteger(piecesPerCarton) || (piecesPerCarton ?? 0) <= 1) return null;

  const perCarton = piecesPerCarton as number;
  const remainder = quantity % perCarton;
  if (remainder === 0) return null;

  const lowerQuantity = quantity - remainder;
  const upperQuantity = lowerQuantity + perCarton;
  const remove = remainder;
  const add = perCarton - remainder;
  const addAdvice = `${add} ${pieceLabel(add)} meer = ${upperQuantity}`;
  const nearest = lowerQuantity > 0
    ? `${remove} ${pieceLabel(remove)} minder = ${lowerQuantity}, of ${addAdvice}`
    : addAdvice;

  return `Geen volle omdoos (${perCarton}/doos) · ${nearest}.`;
}

function pieceLabel(quantity: number): string {
  return quantity === 1 ? 'stuk' : 'stuks';
}
