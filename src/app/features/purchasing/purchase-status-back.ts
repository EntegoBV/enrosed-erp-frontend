import type { PurchaseOrder, PurchasePayment } from '../../core/api/models';

/** Where a container can step back to: a departure or an order set by mistake. */
export type StatusBackTarget = 'BESTELD' | 'CONCEPT';

/** One choice in the Status terugzetten sheet, with what it does in short Dutch. */
export interface StatusBackOption {
  to: StatusBackTarget;
  label: string;
  lines: string[];
  /** Why the server would refuse it; the row stays visible but cannot be chosen. */
  blocked?: string;
}

/** What the Status terugzetten sheet is bound to: the status it starts from, its options, unsaved edits. */
export interface StatusBackSheetState {
  status: PurchaseOrder['status'];
  options: readonly StatusBackOption[];
  dirty: boolean;
}

export interface StatusBackInput {
  status: PurchaseOrder['status'];
  /** The container's payments (every payee, offsets included); null while they load. */
  payments: readonly PurchasePayment[] | null;
  paymentStateError: string | null;
  /** The legacy 'paid in total' figure on the order. */
  paidEur: number | null | undefined;
  /** Supplier credits noted on this container. */
  creditCount: number;
}

/** The status names as the screens show them: ONDERWEG reads Vertrokken. */
export const STATUS_BACK_LABEL: Record<PurchaseOrder['status'], string> = {
  CONCEPT: 'Concept', BESTELD: 'Besteld', ONDERWEG: 'Vertrokken', ONTVANGEN: 'Ontvangen',
};

const KEPT = 'Track & trace, B/L en documenten blijven.';
const SILENT = 'Er gaat geen melding uit.';

/**
 * The earlier statuses a container may go back to, nearest first.
 *
 * Vertrokken goes back to Besteld or Concept, Besteld to Concept. Ontvangen
 * never goes back: the stock is booked. Besteld is always possible; Concept
 * is blocked where the server refuses it, so the sheet says why beforehand:
 * a concept container cannot carry payments or a supplier credit.
 */
export function statusBackOptions(input: StatusBackInput): StatusBackOption[] {
  if (input.status === 'ONDERWEG') return [backToOrdered(), backToConcept(input, true)];
  if (input.status === 'BESTELD') return [backToConcept(input, false)];
  return [];
}

/**
 * The option the sheet has chosen: the one picked before while it can still
 * be chosen (fresh figures rebuild the options), else the nearest one that
 * is not blocked; null when none can be chosen.
 */
export function defaultStatusBack(options: readonly StatusBackOption[], keep: StatusBackTarget | null = null): StatusBackTarget | null {
  if (keep && options.some((option) => option.to === keep && !option.blocked)) return keep;
  return options.find((option) => !option.blocked)?.to ?? null;
}

function backToOrdered(): StatusBackOption {
  return {
    to: 'BESTELD',
    label: STATUS_BACK_LABEL.BESTELD,
    lines: [
      'De vertrekdatum wordt gewist. Bij het echte vertrek komt de juiste datum.',
      KEPT,
      'Betaalde termijnen bij vertrek blijven betaald; wat open staat schuift naar later.',
      SILENT,
    ],
  };
}

function backToConcept(input: StatusBackInput, departed: boolean): StatusBackOption {
  const lines = [
    ...(departed ? ['De vertrekdatum wordt gewist.'] : []),
    'De order telt niet meer als inkomende voorraad.',
    'Bij opnieuw bestellen worden de bestelde aantallen opnieuw vastgelegd.',
    KEPT,
    SILENT,
  ];
  const blocked = conceptBlocked(input);
  return { to: 'CONCEPT', label: STATUS_BACK_LABEL.CONCEPT, lines, ...(blocked ? { blocked } : {}) };
}

/** The first reason Concept cannot be chosen, mirroring the server's guard; null when it can. */
function conceptBlocked(input: StatusBackInput): string | null {
  if (input.payments === null || input.paymentStateError) return 'Betalingen nog niet geladen';
  /* The server refuses any non-zero legacy total, so the sheet does too. */
  if (input.payments.length > 0 || (input.paidEur ?? 0) !== 0) return 'Er zijn al betalingen geboekt';
  if (input.creditCount > 0) return 'Er staat een tegoed van de leverancier op';
  return null;
}
