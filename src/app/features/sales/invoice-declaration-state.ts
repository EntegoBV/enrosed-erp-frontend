import type { InvoiceDeclaration, InvoiceDeclarationMode, InvoiceDeclarationRequest } from '../../core/api/invoice-declaration-api';

export const INVOICE_DECLARATION_LABELS: Record<InvoiceDeclarationMode, string> = {
  DEFAULT: 'Standaard btwvermelding', CUSTOMS_REPRESENTATIVE: 'Inklaring via 24/7 Customs (Engels)', REVERSE_CHARGE: 'Reverse charge (Engels)',
};

/** Versioned server text remains English; dossier values remain ordinary escaped text. */
export function invoiceDeclarationPreview(value: InvoiceDeclarationRequest, standardLegalMention: string | null | undefined): string {
  const reference = value.reference?.trim();
  if (value.mode === 'DEFAULT') return standardLegalMention?.trim() ?? '';
  const reverse = '“REVERSE CHARGE”: VAT shifted to Dutch customer according to article 12.3 Dutch VAT-Law.';
  const declaration = value.mode === 'CUSTOMS_REPRESENTATIVE'
    ? 'Custom cleared in The Netherlands by our Limited Fiscal Representative: 24/7 Customs BV with VAT-no: NL858617262B02\n' + reverse
    : reverse;
  return declaration + (reference ? `\nFile reference: ${reference}.` : '');
}

export function invoiceDeclarationRequest(value: InvoiceDeclarationRequest, advance: boolean, fiscalTreatmentAllowed: boolean): InvoiceDeclarationRequest {
  if (value.mode === 'DEFAULT') return { mode: 'DEFAULT', reference: null };
  const reference = value.reference?.trim() || null;
  if (reference && reference.length > 160) throw new Error('Gebruik maximaal 160 tekens voor de dossierreferentie.');
  if (value.mode !== 'CUSTOMS_REPRESENTATIVE' && value.mode !== 'REVERSE_CHARGE') throw new Error('Kies een geldige factuurvermelding.');
  if (value.mode === 'CUSTOMS_REPRESENTATIVE' && !advance) throw new Error('De inklaringsvermelding is alleen beschikbaar op een voorschotfactuur.');
  if (value.mode === 'REVERSE_CHARGE' && advance) throw new Error('Deze vermelding is alleen beschikbaar op een slotfactuur.');
  if (!fiscalTreatmentAllowed) throw new Error('Deze vermelding vereist een Nederlandse factuur met de bestaande btwbehandeling via fiscale vertegenwoordiging.');
  return { mode: value.mode, reference };
}

export function invoiceDeclarationDraft(value: InvoiceDeclaration): InvoiceDeclarationRequest {
  if (value.textVersion !== 1 || !Object.hasOwn(INVOICE_DECLARATION_LABELS, value.mode)) {
    throw new Error('Deze factuurvermelding gebruikt een onbekende versie. Vernieuw de app.');
  }
  return { mode: value.mode, reference: value.reference };
}
