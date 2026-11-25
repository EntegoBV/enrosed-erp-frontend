import { EurPipe } from '../../shared/pipes';
import type { Ui } from '../../shared/ui';

/**
 * An invoice under the country's minimum order may still leave: the server
 * refuses the concept with code MINIMUM_NOT_MET and its two figures, the
 * screen asks "Minimumorder niet bereikt" once, and "Toch …" sends the same
 * request again with belowMinimumAccepted. The history then notes the
 * shortfall. A quote stays held to the minimum.
 */
export interface MissedMinimum { minimumEur: number; shortfallEur: number }

/** How the invoice leaves: mailed, marked sent (delivered outside the ERP), or issued without mail. */
export type InvoiceLeave = 'mail' | 'mark' | 'issue';

const CONFIRM_LABEL: Record<InvoiceLeave, string> = {
  mail: 'Toch versturen',
  mark: 'Toch op verstuurd zetten',
  issue: 'Toch uitgeven',
};

/** The server's minimum-order refusal with its figures; null for any other failure. */
export function minimumRefusal(failure: unknown): MissedMinimum | null {
  const response = failure as { status?: number; error?: unknown } | null | undefined;
  const body = response?.error as { code?: unknown; minimumEur?: unknown; shortfallEur?: unknown } | null | undefined;
  if (response?.status !== 409 || !body || typeof body !== 'object' || body.code !== 'MINIMUM_NOT_MET') return null;
  return { minimumEur: Number(body.minimumEur) || 0, shortfallEur: Number(body.shortfallEur) || 0 };
}

/** "Minimumorder niet bereikt": true when staff let the invoice leave anyway. */
export function confirmBelowMinimum(ui: Ui, missed: MissedMinimum, leave: InvoiceLeave): Promise<boolean> {
  const eur = new EurPipe();
  return new Promise((resolve) => ui.confirm({
    title: 'Minimumorder niet bereikt',
    message: `Er ontbreekt nog <b>${eur.transform(missed.shortfallEur)}</b> tot de minimumorder van ${eur.transform(missed.minimumEur)}. `
      + 'De historiek noteert dat.',
    confirmLabel: CONFIRM_LABEL[leave],
  }, () => resolve(true), undefined, () => resolve(false)));
}

/**
 * An invoice's way out: the call goes as it is; when the server answers that
 * the concept stays under the minimum order, staff are asked and "Toch …"
 * repeats it with that answer. Null when they keep it.
 */
export async function leaveInvoice<T>(ui: Ui, leave: InvoiceLeave,
                                      call: (belowMinimumAccepted: boolean) => Promise<T>): Promise<T | null> {
  try {
    return await call(false);
  } catch (failure: unknown) {
    const missed = minimumRefusal(failure);
    if (!missed) throw failure;
    if (!(await confirmBelowMinimum(ui, missed, leave))) return null;
    return call(true);
  }
}
