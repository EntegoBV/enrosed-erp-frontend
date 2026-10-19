import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import type { BankClassification, BankStatementLine } from '../../core/api/banking-api';
import { BankingApi } from '../../core/api/banking-api';
import { messageOf } from '../../core/api/errors';
import { Sheet, Ui } from '../../shared/ui';
import { feeContainers, filterFeeContainers, legDistance, transferCandidates, vatPeriods } from './bank-suggestions';
import type { RankedFeeContainer } from './bank-suggestions';
import { bankTextOf } from './bank-text';
import { CLASSIFICATION_LABEL } from './cash-forecast';
import { FinanceState, formatEuro } from './finance-state';

type Choice = 'BANKKOSTEN' | 'RENTE' | BankClassification;
const NONE = 'none';
/** The containers the picker shows at once; the search finds the others. */
const FEE_ROWS = 8;

/**
 * "Boeken als…" (spec-bank-forecast §3.7): a transaction that pays no invoice
 * or cost. Bank fees and interest stay costs (the cost registration,
 * prefilled); bank fees of a container's transfer go "Bij een container…" as
 * its Transactiekosten instead (Emre, 2026-10-19: Bijkomende kosten, never a
 * company cost; the containers with a supplier transfer near this line come
 * first). An internal transfer (with its other leg), a VAT payment of a
 * quarter, a loan, capital, private money or something else is booked on the
 * line itself, which then leaves "Te koppelen". A server without the
 * 2026-10-16 round knows only the first two.
 */
@Component({
  selector: 'app-book-as-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet],
  template: `
    @if (line(); as row) {
      <app-sheet variant="ios" title="Boeken als…" (closed)="close()">
        <div body class="fin-sheet fin-bookas">
          <p class="fin-bookas__line"><b>{{ title(row) }}</b><span>{{ signed(row.amountEur) }} · {{ state.accountLabel(row.account) }} · {{ day(row) }}</span></p>
          <div class="fin-bookas__options" role="radiogroup" aria-label="Boeken als">
            @for (option of options(); track option.id) {
              <label class="fin-bookas__option" [class.is-on]="choice() === option.id"><input type="radio" name="book-as" [checked]="choice() === option.id" (change)="choice.set(option.id)" />
                <span><b>{{ option.label }}</b><small>{{ option.sub }}</small></span></label>
            }
          </div>
          @switch (choice()) {
            @case ('BANKKOSTEN') {
              <fieldset class="fin-bookas__field"><legend>Bankkosten</legend>
                <label><input type="radio" name="fee-where" [checked]="feeWhere() === 'COMPANY'" (change)="feeWhere.set('COMPANY')" />Algemene bankkost</label>
                <label><input type="radio" name="fee-where" [checked]="feeWhere() === 'CONTAINER'" (change)="chooseContainerFee()" />Bij een container…</label>
              </fieldset>
              @if (feeWhere() === 'CONTAINER') {
                <input class="input" type="search" placeholder="PO-nummer, alias of leverancier" aria-label="Container zoeken" [value]="feeQuery()" (input)="feeQuery.set($any($event.target).value)" />
                <div class="fin-bookas__options" role="radiogroup" aria-label="Container">
                  @for (container of feeShown(); track container.orderId) {
                    <label class="fin-bookas__option" [class.is-on]="feeOrder() === container.orderId"><input type="radio" name="fee-container" [checked]="feeOrder() === container.orderId" (change)="feeOrder.set(container.orderId)" />
                      <span><b>{{ container.number }}{{ container.alias ? ' · ' + container.alias : '' }}</b><small>{{ containerSub(container) }}</small></span></label>
                  } @empty { <p class="fin-hint">Geen container gevonden.</p> }
                </div>
              }
            }
            @case ('INTERNAL_TRANSFER') {
              <fieldset class="fin-bookas__field"><legend>Andere kant</legend>
                @for (other of legs(); track other.id) {
                  <label><input type="radio" name="leg" [checked]="leg() === '' + other.id" (change)="leg.set('' + other.id)" />{{ legText(row, other) }}</label>
                }
                <label><input type="radio" name="leg" [checked]="leg() === none" (change)="leg.set(none)" />Andere kant staat niet in Enrosed</label>
              </fieldset>
            }
            @case ('VAT') {
              <label class="fin-field fin-bookas__field"><span>Kwartaal</span>
                <select class="select" [value]="period()" (change)="period.set($any($event.target).value)">
                  @for (option of periods().options; track option) { <option [value]="option">{{ periodText(option) }}</option> }
                </select></label>
            }
          }
          @if (choice() && choice() !== 'BANKKOSTEN' && choice() !== 'RENTE') {
            <label class="fin-field fin-bookas__field"><span>Notitie{{ choice() === 'OTHER' ? '' : ' (optioneel)' }}</span>
              <input class="input" maxlength="300" [placeholder]="choice() === 'OTHER' ? 'Bijv. borg terug van verhuurder' : ''" [value]="note()" (input)="note.set($any($event.target).value)" /></label>
          }
          @if (!state.cashRound()) { <p class="fin-hint">Interne overboeking, btw, lening, kapitaal, privé en andere kunnen zodra de server bijgewerkt is.</p> }
          @if (error()) { <p class="fin-error" role="alert">{{ error() }}</p> }
        </div>
        <div foot class="fin-sheet__foot">
          <button class="btn" type="button" (click)="close()">Annuleren</button>
          <button class="btn btn--primary" type="button" [disabled]="!ready()" (click)="book(row)">{{ busy() ? 'Boeken…' : 'Boeken' }}</button>
        </div>
      </app-sheet>
    }
  `,
})
export class BookAsSheet {
  readonly state = inject(FinanceState);
  private readonly banking = inject(BankingApi);
  private readonly ui = inject(Ui);
  readonly none = NONE;
  readonly line = computed(() => { const line = this.state.bookAsLine(); return line ? this.state.bankStatements().find((row) => row.id === line.id) ?? line : null; });
  readonly choice = signal<Choice | null>(null);
  readonly leg = signal<string>(NONE);
  readonly period = signal('');
  readonly note = signal('');
  readonly busy = signal(false);
  readonly error = signal('');
  /** Bankkosten: a company cost ("Algemene bankkost", today's) or a container's Transactiekosten. */
  readonly feeWhere = signal<'COMPANY' | 'CONTAINER'>('COMPANY');
  readonly feeOrder = signal<number | null>(null);
  readonly feeQuery = signal('');
  /** Non-concept, non-archived containers, the ones with a supplier transfer near this line first (feeContainers). */
  readonly feeRanked = computed<RankedFeeContainer[]>(() => {
    const row = this.line();
    if (!row) return [];
    const suppliers = new Map(this.state.suppliers().filter((item) => item.id != null).map((item) => [item.id!, item.name]));
    const containers = this.state.purchaseViews().filter((view) => view.order.status !== 'CONCEPT' && !view.order.archivedAt)
      .map((view) => ({ orderId: view.order.id, number: view.order.number, alias: view.order.alias ?? null, supplier: suppliers.get(view.order.supplierId ?? -1) ?? '' }));
    return feeContainers(row, containers, this.state.bankStatements(), this.state.payments(), (line) => this.state.lineDay(line), (key) => this.state.canonicalAccount(key));
  });
  readonly feeShown = computed(() => {
    const rows = filterFeeContainers(this.feeRanked(), this.feeQuery()).slice(0, FEE_ROWS);
    const chosen = this.feeRanked().find((row) => row.orderId === this.feeOrder());
    return chosen && !rows.includes(chosen) ? [chosen, ...rows] : rows;
  });

  readonly options = computed(() => {
    const row = this.line();
    if (!row) return [];
    const outgoing = row.amountEur < 0;
    const all: { id: Choice; label: string; sub: string; round: boolean }[] = [
      ...(outgoing ? [{ id: 'BANKKOSTEN' as const, label: 'Bankkosten', sub: 'Een kost, of de transactiekosten van een container', round: false },
        { id: 'RENTE' as const, label: 'Rente', sub: 'Wordt een kost (vrijgesteld van btw)', round: false }] : []),
      { id: 'INTERNAL_TRANSFER', label: 'Interne overboeking', sub: 'Naar of van een andere eigen rekening', round: true },
      { id: 'VAT', label: 'Btw-betaling of -terugbetaling', sub: 'Van een kwartaal', round: true },
      { id: 'LOAN', label: 'Lening', sub: 'Opgenomen of terugbetaald', round: true },
      { id: 'CAPITAL', label: 'Kapitaal', sub: 'Inbreng of uitkering', round: true },
      { id: 'PRIVATE', label: 'Privé', sub: 'Geen bedrijfsgeld', round: true },
      { id: 'OTHER', label: 'Andere', sub: 'Met een korte uitleg', round: true },
    ];
    return all.filter((option) => !option.round || this.state.cashRound());
  });
  readonly legs = computed(() => {
    const row = this.line();
    if (!row) return [];
    const active = new Set(this.state.accountOptions().map((option) => option.key));
    return transferCandidates(row, this.state.bankStatements().filter((line) => this.state.officialBankLine(line)), (line) => this.state.lineDay(line),
      (key) => this.state.canonicalAccount(key), (key) => active.has(key));
  });
  readonly periods = computed(() => vatPeriods(this.state.today(), this.line() ? this.state.lineDay(this.line()!) : this.state.today()));
  readonly ready = computed(() => {
    const choice = this.choice();
    if (!choice || this.busy()) return false;
    if (choice === 'OTHER') return !!this.note().trim();
    if (choice === 'BANKKOSTEN' && this.feeWhere() === 'CONTAINER') return this.feeOrder() !== null;
    if (choice === 'VAT') return /^\d{4}-Q[1-4]$/.test(this.period());
    return true;
  });

  constructor() {
    /* A new line: no choice yet, the nearest other leg and the quarter before the line's preselected. */
    effect(() => {
      const row = this.line();
      untracked(() => {
        this.choice.set(null); this.note.set(''); this.error.set(''); this.feeWhere.set('COMPANY'); this.feeOrder.set(null); this.feeQuery.set('');
        this.leg.set(this.legs()[0] ? String(this.legs()[0].id) : NONE);
        this.period.set(this.periods().preferred);
        void row;
      });
    });
  }

  close(): void { if (!this.busy()) this.state.bookAsLine.set(null); }
  /** "Bij een container…": the container with a supplier transfer nearest this line starts chosen. */
  chooseContainerFee(): void {
    this.feeWhere.set('CONTAINER');
    if (this.feeOrder() === null) this.feeOrder.set(this.feeRanked().find((row) => row.near)?.orderId ?? null);
  }
  /** The supplier on every row, and why it comes first. */
  containerSub(container: RankedFeeContainer): string {
    return [container.supplier || 'Leverancier onbekend', container.near].filter(Boolean).join(' · ');
  }

  async book(row: BankStatementLine): Promise<void> {
    const choice = this.choice();
    if (!choice || !this.ready()) return;
    if (choice === 'BANKKOSTEN' && this.feeWhere() === 'CONTAINER') {
      // Transactiekosten of the container: a Bijkomende kosten payment on this line (FinanceState.bookContainerFee says so in its toast).
      this.busy.set(true); this.error.set('');
      try {
        const failure = await this.state.bookContainerFee(row, this.feeOrder()!, false);
        if (failure) this.error.set(failure); else this.state.bookAsLine.set(null);
      } finally {
        this.busy.set(false);
      }
      return;
    }
    if (choice === 'BANKKOSTEN' || choice === 'RENTE') {
      const gross = Math.abs(row.amountEur);
      this.state.bookAsLine.set(null);
      this.state.openCostFromBank(row, { category: 'VERZEKERING', description: choice === 'BANKKOSTEN' ? 'Bankkosten' : 'Rente', party: row.counterparty || null,
        vatRegime: 'EXEMPT', vatRegimeConfirmed: true, vatPct: 0, supplierCountry: 'BE', costKind: 'SERVICES', expenseType: 'STANDARD', vatDeductiblePct: 100, taxDeductiblePct: 100,
        amountInclEur: gross, amountExclEur: gross });
      return;
    }
    this.busy.set(true); this.error.set('');
    try {
      const transferLineId = choice === 'INTERNAL_TRANSFER' && this.leg() !== NONE ? Number(this.leg()) : null;
      const result = await this.banking.classify(row.id, { classification: choice, note: this.note().trim() || null, transferLineId, vatPeriod: choice === 'VAT' ? this.period() : null });
      this.state.bankStatements.update((rows) => rows.map((line) => result.lines.find((saved) => saved.id === line.id) ?? line));
      this.state.bookAsLine.set(null);
      this.state.flash(row.id);
      void this.state.refreshBank();
      this.ui.toast(`Geboekt als ${CLASSIFICATION_LABEL[choice]}`, 'ok', { label: 'Ongedaan maken', run: () => void this.state.unclassifyLine(row) });
    } catch (failure: unknown) {
      this.error.set(messageOf(failure, 'Boeken mislukt'));
    } finally {
      this.busy.set(false);
    }
  }

  legText(row: BankStatementLine, other: BankStatementLine): string {
    const day = this.state.lineDay(other);
    return `${this.state.accountLabel(other.account)} · ${day.slice(8, 10)}/${day.slice(5, 7)} · ${this.signed(other.amountEur)} · ${legDistance(this.state.lineDay(row), day)}`;
  }
  periodText(period: string): string { return `Q${period.slice(6)} ${period.slice(0, 4)}`; }
  signed(value: number): string { return `${value > 0 ? '+' : '−'} ${formatEuro(Math.abs(value))}`; }
  /** The line's clean title (bankTextOf), as its row on Transacties reads. */
  title(row: BankStatementLine): string { return bankTextOf(row).title; }
  day(row: BankStatementLine): string { const day = this.state.lineDay(row); return `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`; }
}
