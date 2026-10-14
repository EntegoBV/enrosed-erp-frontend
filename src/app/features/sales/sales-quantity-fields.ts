/*
 * The quantity field of a sales line shows the server's quantity of that
 * line. [ngModel] only writes a value that changed, so a typed 13 on a line
 * of 24 that the server rounds back to 24 (or 5 on a display of 8, back to 8)
 * stayed 13 in the field while the document said 24. After an answer is on
 * screen the editor and the desk put the server's figure in every quantity
 * field by hand - except the one being typed in: nothing is rewritten under
 * someone's fingers.
 *
 * Both templates mark their quantity input with this attribute, holding the
 * line's product id. No runtime imports: node-tested.
 */
export const QUANTITY_FIELD_ATTRIBUTE = 'data-quantity-line';
export const QUANTITY_FIELD_SELECTOR = `input[${QUANTITY_FIELD_ATTRIBUTE}]`;

/** The part of an <input> this needs; a test passes plain objects. */
export interface QuantityField {
  value: string;
  getAttribute(name: string): string | null;
}

/**
 * Writes each line's quantity into its field, leaves `focused` alone and
 * returns it when it is one of the fields, so the caller can catch it up once
 * it is left. A field without a priced line (a line just added) is skipped:
 * it renders with the bound value.
 */
export function showServerQuantities<F extends QuantityField>(
  fields: Iterable<F>,
  lines: readonly { productId: number; quantity: number }[],
  focused: unknown,
): F | null {
  const quantities = new Map(lines.map((line) => [String(line.productId), String(line.quantity)]));
  let skipped: F | null = null;
  for (const field of fields) {
    const quantity = quantities.get(field.getAttribute(QUANTITY_FIELD_ATTRIBUTE) ?? '');
    if (quantity === undefined) continue;
    if (field === focused) { skipped = field; continue; }
    if (field.value !== quantity) field.value = quantity;
  }
  return skipped;
}
