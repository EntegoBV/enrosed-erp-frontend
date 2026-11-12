import { Injectable, inject } from '@angular/core';
import { BankingApi, type BankStatementLine, type BankUnlinkPlan, type BankUnlinkRow } from '../../core/api/banking-api';
import type { Payee } from '../../core/api/models';
import { messageOf } from '../../core/api/errors';
import { escapeHtml, Ui } from '../../shared/ui';
import { containerName } from '../purchasing/container-name';

/*
 * "Transactie losmaken" (Emre, 2026-11-04: "als ik 1 vd 2 transactie
 * verwijder popup doen of ik zeker ben en alles dekoppelen"). One question
 * names everything the transaction carries and what happens to it; one call
 * does it (POST …/unlink, backend BankLineUnlinkService): a part of a payment
 * in parts goes back into its open part or leaves the payment ('Bedrag
 * houden' keeps it there, open), Transactiekosten and a Bankkosten or
 * Koersverschil cost made for the link go, every other payment stays without
 * the transaction. Kosten & bank and the Inkoop payment sheet ask the same
 * question. A server without the plan keeps the old question and DELETE …/links.
 */

const EURO = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' });
const PAYEE_WORD: Record<Payee, string> = { SUPPLIER: 'Leverancier', LOGISTICS: 'Douane & transport', SEPARATE: 'Inspectie', OTHER: 'Bijkomende kosten' };
const eur = (value: number | null | undefined): string => EURO.format(Math.abs(value ?? 0));
const dayText = (day: string): string => `${day.slice(8, 10)}/${day.slice(5, 7)}`;

/** One row as the question names it: 'Leverancier · 1/3 bij bestelling · PO-2026-002', 'Transactiekosten € 25,00 · PO-…', a cost's description. */
export function unlinkRowTitle(row: BankUnlinkRow): string {
  if (row.kind === 'COST') return `${row.label || 'Kost'} ${eur(row.amountEur)}`;
  const container = containerName({ id: row.orderId, number: row.orderNumber, alias: row.orderAlias });
  if (row.fee) return `Transactiekosten ${eur(row.amountEur)} · ${container}`;
  const payee = PAYEE_WORD[row.payee ?? 'SUPPLIER'];
  const label = (row.label ?? '').trim();
  return `${label && label.toLocaleLowerCase('nl-BE') !== payee.toLocaleLowerCase('nl-BE') ? `${payee} · ${label}` : payee} · ${container}`;
}

/** What happens to it, in a few words. */
export function unlinkRowEffect(row: BankUnlinkRow): string {
  if (row.kind === 'COST') return row.action === 'DELETED' ? 'kost wordt verwijderd' : 'blijft betaald, zonder transactie';
  switch (row.action) {
    case 'DELETED': return 'worden verwijderd';
    case 'MERGED': return `${eur(row.amountEur)} terug bij het open deel; de betaling blijft ${eur(row.paymentEur)}`;
    case 'REMOVED': return `deel van ${eur(row.amountEur)} gaat eraf; de betaling wordt ${eur(row.paymentAfterEur)}`;
    case 'STAYS': return row.transfers > 1 ? `${eur(row.amountEur)} blijft op de betaling, nog niet op de bank` : `${eur(row.amountEur)} blijft genoteerd, nog niet op de bank`;
  }
}

/** The question's rich text: the transaction, one bullet per thing it carries, where the transaction goes. */
export function unlinkMessage(plan: BankUnlinkPlan): string {
  const head = `${escapeHtml(plan.counterparty?.trim() || 'Banktransactie')} · ${dayText(plan.day)} · ${eur(plan.amountEur)}`;
  const rows = plan.rows.map((row) => `• <b>${escapeHtml(unlinkRowTitle(row))}</b>: ${escapeHtml(unlinkRowEffect(row))}.`);
  const keep = plan.partsKeepable ? '<br><br><small>Bedrag houden: het deel blijft op de betaling, nog niet op de bank.</small>' : '';
  return `<b>${head}</b><br><br>${rows.join('<br>')}<br><br>De transactie staat daarna weer bij Te koppelen.${keep}`;
}

/** The toast once it is done: 'Transactie losgemaakt · betaling nu € 6.000,00 · transactiekosten verwijderd'. */
export function unlinkDoneText(plan: BankUnlinkPlan): string {
  const parts = ['Transactie losgemaakt'];
  const removed = plan.rows.find((row) => row.kind === 'PURCHASE' && row.action === 'REMOVED');
  if (removed) parts.push(`betaling nu ${eur(removed.paymentAfterEur)}`);
  if (plan.rows.some((row) => row.action === 'MERGED')) parts.push('deel terug bij de open betaling');
  if (plan.rows.some((row) => row.fee && row.action === 'DELETED')) parts.push('transactiekosten verwijderd');
  if (plan.rows.some((row) => row.kind === 'COST' && row.action === 'DELETED')) parts.push('verschilkost verwijderd');
  return parts.join(' · ');
}

/** A server without the plan: 404 or 405 without a reason of its own. */
function planMissing(failure: unknown): boolean {
  const response = failure as { status?: number; error?: { message?: unknown } | null } | null;
  return (response?.status === 404 || response?.status === 405) && typeof response?.error?.message !== 'string';
}

@Injectable({ providedIn: 'root' })
export class BankUnlink {
  private readonly api = inject(BankingApi);
  private readonly ui = inject(Ui);

  /**
   * Asks, then unlinks. Resolves with the plan as done, 'legacy' after the
   * old unlink, or null (cancelled, or refused with a toast). `busy` is on
   * while the server works.
   */
  async run(line: Pick<BankStatementLine, 'id' | 'amountEur'>, busy?: (on: boolean) => void): Promise<BankUnlinkPlan | 'legacy' | null> {
    let plan: BankUnlinkPlan;
    busy?.(true);
    try {
      plan = await this.api.unlinkPlan(line.id);
    } catch (failure: unknown) {
      if (planMissing(failure)) return this.legacy(line, busy);
      this.ui.toast(messageOf(failure, 'Losmaken mislukt'), 'err');
      return null;
    } finally {
      busy?.(false);
    }
    return new Promise((resolve) => {
      this.ui.confirm({ title: 'Transactie losmaken', message: unlinkMessage(plan), confirmLabel: 'Losmaken', danger: true,
        secondaryLabel: plan.partsKeepable ? 'Bedrag houden' : undefined },
      () => void this.execute(line.id, false, plan, busy).then(resolve),
      () => void this.execute(line.id, true, plan, busy).then(resolve),
      () => resolve(null));
    });
  }

  private async execute(id: number, keepParts: boolean, plan: BankUnlinkPlan, busy?: (on: boolean) => void): Promise<BankUnlinkPlan | null> {
    busy?.(true);
    try {
      const done = await this.api.unlinkLine(id, keepParts, plan.expected);
      this.ui.toast(unlinkDoneText(done), 'ok');
      return done;
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Losmaken mislukt'), 'err');
      return null;
    } finally {
      busy?.(false);
    }
  }

  /** Before 2026-11-04: the line comes off, every payment stays as it is. */
  private legacy(line: Pick<BankStatementLine, 'id' | 'amountEur'>, busy?: (on: boolean) => void): Promise<'legacy' | null> {
    return new Promise((resolve) => {
      this.ui.confirm({ title: 'Transactie losmaken', message: `Transactie van ${eur(line.amountEur)} losmaken? De betalingen blijven staan.`,
        confirmLabel: 'Losmaken', danger: true }, async () => {
        busy?.(true);
        try {
          await this.api.unlinkPayments(line.id);
          this.ui.toast('Transactie losgemaakt', 'ok');
          resolve('legacy');
        } catch (failure: unknown) {
          this.ui.toast(messageOf(failure, 'Losmaken mislukt'), 'err');
          resolve(null);
        } finally {
          busy?.(false);
        }
      }, undefined, () => resolve(null));
    });
  }
}
