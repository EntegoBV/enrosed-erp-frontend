import { ChangeDetectionStrategy, Component, ElementRef, effect, input, output, signal, untracked, viewChild } from '@angular/core';

/** A typed count: whole and not negative, Dutch thousands allowed ("1.000"); anything else is no count. */
export function parseQuantity(raw: string): number | null {
  const text = raw.trim();
  if (!text) return null;
  let digits: string | null = null;
  if (/^\d+$/.test(text)) digits = text;
  else if (/^\d{1,3}(?:[.   ]\d{3})+$/.test(text)) digits = text.replace(/[.   ]/g, '');
  if (digits === null) return null;
  const value = Number(digits);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * Aantal on the phone: − and + of 48 px around a number field. Empty means
 * not filled in yet. The buttons move in steps (12 rozen of a display of 12):
 * + from empty gives one step, − stops at one step. With a max, + stops there
 * and a higher typed number stays visible (the screen says why it is too many).
 * Text that is no whole count ("2,5") stays as typed, red, and is told through
 * `unreadableChange` so the screen can say why.
 */
@Component({
  selector: 'app-partner-stepper',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" class="step__btn" [disabled]="disabled() || value() == null || value()! <= step()"
            [attr.aria-label]="label() + ': ' + (step() === 1 ? 'één' : step()) + ' minder'" (click)="bump(-1)">−</button>
    <input #field class="step__field" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off"
           [attr.aria-label]="label()" [attr.aria-invalid]="invalid() || unreadable() ? 'true' : null" [disabled]="disabled()"
           (input)="typed(field.value)" (blur)="tidy()" />
    <button type="button" class="step__btn" [disabled]="disabled() || (max() != null && (value() ?? 0) >= max()!)"
            [attr.aria-label]="label() + ': ' + (step() === 1 ? 'één' : step()) + ' meer'" (click)="bump(1)">+</button>
  `,
  styles: `
    :host{display:inline-grid;grid-template-columns:48px minmax(56px,84px) 48px;align-items:stretch;height:48px;overflow:hidden;border-radius:14px;background:color-mix(in srgb,var(--ink) 6%,var(--surface))}
    .step__btn{display:grid;place-items:center;padding:0;border:0;background:transparent;color:var(--ink);font:inherit;font-size:24px;font-weight:500;line-height:1;cursor:pointer;touch-action:manipulation;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent}
    .step__btn:active:not(:disabled){background:color-mix(in srgb,var(--rose) 14%,transparent)}
    .step__btn:disabled{color:var(--muted-2);cursor:default}
    .step__field{width:100%;min-width:0;height:48px;padding:0 4px;border:0;border-inline:1px solid rgb(26 22 20/8%);border-radius:0;background:var(--surface);color:var(--ink);font:inherit;font-size:18px;font-weight:700;font-variant-numeric:tabular-nums;text-align:center;outline:none}
    .step__field:focus{box-shadow:inset 0 0 0 2px color-mix(in srgb,var(--rose) 50%,transparent)}
    .step__field[aria-invalid=true]{color:var(--danger);background:var(--danger-soft)}
  `,
})
export class PartnerStepper {
  readonly value = input<number | null>(null);
  readonly max = input<number | null>(null);
  /** The buttons' step (and the least they go to). */
  readonly step = input(1);
  readonly label = input('Aantal');
  readonly invalid = input(false);
  readonly disabled = input(false);
  readonly valueChange = output<number | null>();
  readonly unreadableChange = output<boolean>();
  /** The text is no whole count. */
  readonly unreadable = signal(false);

  private readonly field = viewChild.required<ElementRef<HTMLInputElement>>('field');

  constructor() {
    /* The field follows the value, but never rewrites what is being typed. */
    effect(() => {
      const value = this.value();
      const element = this.field().nativeElement;
      untracked(() => {
        if (document.activeElement === element && parseQuantity(element.value) === value) return;
        if (value == null && this.unreadable()) return;
        this.mark(false);
        element.value = value == null ? '' : String(value);
      });
    });
  }

  typed(raw: string): void {
    const value = parseQuantity(raw);
    this.mark(value === null && raw.trim() !== '');
    this.valueChange.emit(value);
  }

  tidy(): void {
    if (this.unreadable()) return;
    const element = this.field().nativeElement;
    const value = this.value();
    element.value = value == null ? '' : String(value);
  }

  private mark(unreadable: boolean): void {
    if (unreadable === this.unreadable()) return;
    this.unreadable.set(unreadable);
    this.unreadableChange.emit(unreadable);
  }

  bump(delta: number): void {
    const step = Math.max(1, this.step());
    const current = this.value();
    /* A typed count between steps goes to the step below or above it. */
    let next = current == null ? (delta > 0 ? step : null)
      : delta > 0 ? (Math.floor(current / step) + 1) * step : (Math.ceil(current / step) - 1) * step;
    if (next != null && next < step) next = step;
    const max = this.max();
    if (next != null && max != null && next > max) next = Math.max(step, Math.floor(max / step) * step);
    this.mark(false);
    this.valueChange.emit(next);
  }
}
