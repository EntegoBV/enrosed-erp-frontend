import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import type { BankClassification, BankStatementLine } from '../../core/api/banking-api';
import { BankingApi } from '../../core/api/banking-api';
import { messageOf } from '../../core/api/errors';
import { Sheet, Ui } from '../../shared/ui';
import { allocatedLine, cancellationCandidates, legDistance, transferCandidates, vatPeriods } from './bank-suggestions';
import { bankTextOf } from './bank-text';
import { CLASSIFICATION_LABEL } from './cash-forecast';
import { FinanceState, formatEuro } from './finance-state';

type Choice = 'BANKKOSTEN' | 'RENTE' | 'RECEIVED_DOCUMENT' | BankClassification;
const NONE = 'none';

/**
 * "Boeken als…" (spec-bank-forecast §3.7): a transaction that pays no invoice
 * or cost. Bank fees and interest stay costs (the cost registration,
 * prefilled); an internal transfer (with its other leg), a VAT payment of a
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
            @case ('CANCELLATION') {
              <fieldset class="fin-bookas__field fin-bookas__cancellation"><legend>Kies de tegenboeking</legend>
                <p class="fin-hint">Kies de terugbetaling of oorspronkelijke afschrijving met exact het tegengestelde bedrag. Beide bankregels worden samen als annulatie geboekt, zonder factuur of kost.</p>
                @for (other of cancellationLegs(); track other.id) {
                  <label class="fin-bookas__option" [class.is-on]="cancellationLeg() === other.id">
                    <input type="radio" name="cancellation-leg" [checked]="cancellationLeg() === other.id" [disabled]="busy()" (change)="cancellationLeg.set(other.id)" />
                    <span><b>{{ title(other) }} · {{ signed(other.amountEur) }}</b><small>{{ day(other) }} · {{ state.accountLabel(other.account) }}</small>@if (other.reference) { <small>{{ other.reference }}</small> }</span>
                  </label>
                } @empty {
                  <p class="fin-hint">Geen vrije tegenboeking met {{ signed(-row.amountEur) }} gevonden. Is de tegenboeking al geboekt? Open die transactie en kies eerst ‘Boeking ongedaan maken’ of ‘Koppeling losmaken’.</p>
                }
                @if (selectedCancellation(); as other) {
                  <p class="fin-bookas__pair" role="status">Samen boeken: {{ signed(row.amountEur) }} op {{ day(row) }} en {{ signed(other.amountEur) }} op {{ day(other) }}. Saldo samen: {{ signed(0) }}. Ongedaan maken maakt beide bankregels vrij.</p>
                }
              </fieldset>
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
          @if (choice() && choice() !== 'BANKKOSTEN' && choice() !== 'RENTE' && choice() !== 'RECEIVED_DOCUMENT') {
            <label class="fin-field fin-bookas__field"><span>Notitie{{ choice() === 'OTHER' ? '' : ' (optioneel)' }}</span>
              <input class="input" maxlength="300" [placeholder]="choice() === 'OTHER' ? 'Bijv. borg terug van verhuurder' : ''" [value]="note()" (input)="note.set($any($event.target).value)" /></label>
          }
          @if (!state.cashRound()) { <p class="fin-hint">Interne overboeking, btw, lening, kapitaal, privé en andere kunnen zodra de server bijgewerkt is.</p> }
          @if (error()) { <p class="fin-error" role="alert">{{ error() }}</p> }
        </div>
        <div foot class="fin-sheet__foot">
          <button class="btn" type="button" (click)="close()">Annuleren</button>
          <button class="btn btn--primary" type="button" [disabled]="!ready()" (click)="book(row)">{{ busy() ? 'Boeken…' : choice() === 'RECEIVED_DOCUMENT' ? 'Document kiezen' : choice() === 'CANCELLATION' ? 'Beide als annulatie boeken' : 'Boeken' }}</button>
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
  readonly cancellationLeg = signal<number | null>(null);
  readonly period = signal('');
  readonly note = signal('');
  readonly busy = signal(false);
  readonly error = signal('');

  readonly options = computed(() => {
    const row = this.line();
    if (!row) return [];
    const outgoing = row.amountEur < 0;
    const all: { id: Choice; label: string; sub: string; round: boolean }[] = [
      { id: 'CANCELLATION', label: 'Annulatie', sub: 'Afschrijving en terugbetaling aan elkaar koppelen, zonder factuur', round: true },
      { id: 'RECEIVED_DOCUMENT', label: 'Aankoopfactuur of creditnota', sub: 'Een ontvangen document uit Odoo kiezen en controleren', round: false },
      ...(outgoing ? [{ id: 'BANKKOSTEN' as const, label: 'Bankkosten', sub: 'Wordt een kost (vrijgesteld van btw)', round: false },
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
  readonly cancellationLegs = computed(() => {
    const row = this.line();
    return row ? cancellationCandidates(row, this.state.bankStatements().filter((line) => this.state.officialBankLine(line)), (line) => this.state.lineDay(line)) : [];
  });
  readonly selectedCancellation = computed(() => this.cancellationLegs().find((line) => line.id === this.cancellationLeg()) ?? null);
  readonly ready = computed(() => {
    const choice = this.choice();
    const row = this.line();
    if (!choice || this.busy() || !row || allocatedLine(row)) return false;
    if (choice === 'CANCELLATION') return !!this.selectedCancellation();
    if (choice === 'OTHER') return !!this.note().trim();
    if (choice === 'VAT') return /^\d{4}-Q[1-4]$/.test(this.period());
    return true;
  });

  constructor() {
    /* A new line: no choice yet, the nearest other leg and the quarter before the line's preselected. */
    effect(() => {
      const row = this.line();
      untracked(() => {
        this.choice.set(null); this.note.set(''); this.error.set(''); this.cancellationLeg.set(null);
        this.leg.set(this.legs()[0] ? String(this.legs()[0].id) : NONE);
        this.period.set(this.periods().preferred);
        void row;
      });
    });
  }

  close(): void { if (!this.busy()) this.state.bookAsLine.set(null); }

  async book(row: BankStatementLine): Promise<void> {
    const choice = this.choice();
    if (!choice || !this.ready()) return;
    if (choice === 'RECEIVED_DOCUMENT') {
      this.state.bookAsLine.set(null);
      this.state.receivedDocumentLine.set(row.id);
      this.state.inspectItem({ kind: 'line', id: row.id });
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
      const transferLineId = choice === 'CANCELLATION' ? this.selectedCancellation()!.id
        : choice === 'INTERNAL_TRANSFER' && this.leg() !== NONE ? Number(this.leg()) : null;
      const result = await this.banking.classify(row.id, { classification: choice, note: this.note().trim() || null, transferLineId, vatPeriod: choice === 'VAT' ? this.period() : null });
      this.state.bankStatements.update((rows) => rows.map((line) => result.lines.find((saved) => saved.id === line.id) ?? line));
      this.state.bookAsLine.set(null);
      this.state.flash(row.id);
      void this.state.refreshBank();
      this.ui.toast(choice === 'CANCELLATION' ? 'Beide bankregels als annulatie geboekt' : `Geboekt als ${CLASSIFICATION_LABEL[choice]}`, 'ok', { label: 'Ongedaan maken', run: () => void this.state.unclassifyLine(result.lines.find((line) => line.id === row.id) ?? row) });
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
  signed(value: number): string { return `${value > 0 ? '+ ' : value < 0 ? '− ' : ''}${formatEuro(Math.abs(value))}`; }
  /** The line's clean title (bankTextOf), as its row on Transacties reads. */
  title(row: BankStatementLine): string { return bankTextOf(row).title; }
  day(row: BankStatementLine): string { const day = this.state.lineDay(row); return `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`; }
}
