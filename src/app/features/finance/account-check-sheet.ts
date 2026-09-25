import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { EurPipe } from '../../shared/pipes';
import { Sheet } from '../../shared/ui';
import { FinanceState } from './finance-state';

/**
 * 'Klopt het saldo?': Enrosed's calculated balance next to what the bank
 * app says. Either way a new reading is saved now, so the account counts on
 * from the bank's own figure; a difference goes into its notes.
 *
 * The field starts on Enrosed's figure and follows it until the user types;
 * from then on only the keyboard writes it. A quiet reload (the page
 * refreshes on return after a while, right when the owner comes back from
 * the bank app) can therefore never replace a typed figure.
 */
@Component({
  selector: 'app-account-check-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet, EurPipe],
  template: `
    @if (account(); as account) {
      <app-sheet variant="ios" title="Klopt het saldo?" (closed)="state.accountCheck.set(null)">
        <div body class="fin-sheet">
          <p class="fin-sheet__lead">{{ account.label }}</p>
          <dl class="wk-equation">
            <div><dt>Volgens Enrosed</dt><dd>{{ (account.currentEur ?? 0) | eur }}</dd></div>
          </dl>
          <label class="fin-amount fin-amount--left">
            <span class="fin-field__label">Wat zegt je bankapp?</span><i aria-hidden="true">€</i>
            <input #amount type="number" step="0.01" inputmode="decimal" data-initial-focus (input)="typed(amount)" (keydown.enter)="save()" />
            <button class="fin-sign" type="button" aria-label="Plus of min" title="Negatief of positief" (click)="flipSign(amount)">±</button>
          </label>
          @if (!ready()) {
            <p class="fin-hint" aria-live="polite">Vul het saldo uit je bankapp in; een negatief saldo maak je met ±.</p>
          } @else if (differenceCents() !== 0) {
            <p class="fin-hint fin-hint--warn" aria-live="polite">Verschil {{ differenceCents() / 100 | eur }}. We rekenen vanaf nu verder met het saldo uit je bankapp.</p>
          } @else {
            <p class="fin-hint" aria-live="polite">Geen verschil: het saldo wordt als gecontroleerd bewaard.</p>
          }
        </div>
        <div foot style="display:contents">
          <button class="btn btn--primary" type="button" [disabled]="state.saving() || !ready()" (click)="save()">{{ differenceCents() === 0 ? 'Ja, klopt' : 'Bewaar dit saldo' }}</button>
        </div>
      </app-sheet>
    }
  `,
})
export class AccountCheckSheet {
  readonly state = inject(FinanceState);
  private readonly field = viewChild<ElementRef<HTMLInputElement>>('amount');
  readonly account = computed(() => this.state.accountsView().find((row) => row.account === this.state.accountCheck()?.key) ?? null);
  /** What the user typed: null until the first key, NaN while the entry is partial ('-', empty). */
  readonly entered = signal<number | null>(null);
  readonly value = computed(() => this.entered() ?? this.account()?.currentEur ?? 0);
  readonly ready = computed(() => Number.isFinite(this.value()));
  readonly differenceCents = computed(() => (this.ready() ? Math.round(this.value() * 100) - Math.round((this.account()?.currentEur ?? 0) * 100) : 0));

  constructor() {
    /* Untouched, the field shows Enrosed's figure, also after a reload; touched, it is left alone. */
    effect(() => {
      const input = this.field()?.nativeElement;
      const current = this.account()?.currentEur ?? 0;
      if (input && this.entered() === null) input.value = String(current);
    });
  }

  typed(input: HTMLInputElement): void {
    this.entered.set(input.value === '' ? Number.NaN : input.valueAsNumber);
  }

  /** '±': a phone keypad has no minus key. */
  flipSign(input: HTMLInputElement): void {
    const value = input.valueAsNumber;
    if (!Number.isFinite(value) || value === 0) return;
    input.value = String(-value);
    this.typed(input);
  }

  save(): void {
    const account = this.account();
    if (account && this.ready()) void this.state.checkAccount(account.account, this.value());
  }
}
