import type { SalesVatChoice, SalesVatRoute } from '../../core/api/sales-vat-choice-api';
import type { SegmentOption } from '../../shared/segmented';

/** The three service regimes of the server's VatTreatment: Belgian VAT, reverse charge, outside the EU. */
export function isServiceTreatment(treatment: string | null | undefined): boolean {
  return !!treatment && treatment.startsWith('DIENST_');
}

/** How a regime reads on the staff screens, after "BTW <number> ·". */
export function vatTreatmentLabel(treatment: string | null | undefined): string {
  switch (treatment) {
    case 'INTRACOMMUNAUTAIR': return 'intracommunautaire levering';
    case 'VERLEGD_FISCAAL_VERTEGENWOORDIGER': return 'btw verlegd via fiscaal vertegenwoordiger (NL)';
    case 'UITVOER': return 'uitvoer';
    case 'EU_ZONDER_BTW_NUMMER': return 'EU zonder BTW-nummer';
    case 'DIENST_BINNENLAND': return 'dienst · Belgische btw';
    case 'DIENST_VERLEGD': return 'dienst · btw verlegd';
    case 'DIENST_BUITEN_EU': return 'dienst buiten de EU';
    default: return 'binnenland';
  }
}

/**
 * The segments of the choice. A customer on the fiscal representative chooses between that route
 * and the plain Belgian one; without it the Belgian route simply reads "Goederen" beside "Dienst".
 */
export function vatRouteOptions(choice: SalesVatChoice): SegmentOption[] {
  const fiscal = choice.options.includes('FISCAL_REPRESENTATIVE');
  const label: Record<SalesVatRoute, string> = {
    FISCAL_REPRESENTATIVE: 'Fiscaal vertegenw.',
    BELGIUM: fiscal ? 'Vanuit België' : 'Goederen',
    SERVICE: 'Dienst',
  };
  return choice.options.map((route) => ({ id: route, label: label[route] }));
}

/** A route by its full name, as the warning quotes it. */
export function vatRouteName(route: SalesVatRoute, choice: SalesVatChoice): string {
  if (route === 'FISCAL_REPRESENTATIVE') return 'Fiscaal vertegenwoordiger (NL)';
  if (route === 'SERVICE') return 'Dienst';
  return choice.options.includes('FISCAL_REPRESENTATIVE') ? 'Vanuit België' : 'Goederen';
}

/** One line under the control: what the chosen route means, in the words of the document. */
export function vatRouteHint(choice: SalesVatChoice): string {
  switch (choice.route) {
    case 'FISCAL_REPRESENTATIVE': return 'Ingeklaard in Nederland, btw verlegd naar de klant.';
    case 'SERVICE': return 'Geen goederen: zonder levering, vracht en incoterm op het document.';
    default: return choice.options.includes('FISCAL_REPRESENTATIVE')
      ? 'Belgische regels: levering vanuit België, zonder fiscaal vertegenwoordiger.' : '';
  }
}
