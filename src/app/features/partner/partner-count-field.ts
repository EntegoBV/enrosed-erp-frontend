import { Directive, ElementRef, HostListener, forwardRef, inject, input } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { parseQuantity } from './partner-stepper';

/**
 * The desk's compact Aantal field (the phone keeps the stepper): a whole count, Dutch thousands allowed
 * ("1.000"), empty = not filled in. Arrow up/down move by `step` (12 rozen of a display of 12) and never
 * below one step; what is being typed is never rewritten.
 *
 *   <input appPartnerCount [step]="12" [ngModel]="count" (ngModelChange)="…" />
 */
@Directive({
  selector: 'input[appPartnerCount]',
  host: { type: 'text', inputmode: 'numeric', autocomplete: 'off', enterkeyhint: 'next' },
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => PartnerCountField), multi: true }],
})
export class PartnerCountField implements ControlValueAccessor {
  private readonly element = inject<ElementRef<HTMLInputElement>>(ElementRef);
  readonly step = input(1);
  /** The most the arrows go to; null = no limit. */
  readonly max = input<number | null>(null);
  private onChange: (value: number | null) => void = () => {};
  private onTouched: () => void = () => {};
  private current: number | null = null;

  writeValue(value: unknown): void {
    const number = typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
    if (number === this.current && document.activeElement === this.element.nativeElement) return;
    this.current = number;
    this.element.nativeElement.value = number === null ? '' : String(number);
  }

  registerOnChange(fn: (value: number | null) => void): void { this.onChange = fn; }
  registerOnTouched(fn: () => void): void { this.onTouched = fn; }
  setDisabledState(disabled: boolean): void { this.element.nativeElement.disabled = disabled; }

  @HostListener('input')
  onInput(): void {
    this.current = parseQuantity(this.element.nativeElement.value);
    this.onChange(this.current);
  }

  @HostListener('blur')
  onBlur(): void {
    this.onTouched();
    this.element.nativeElement.value = this.current === null ? '' : String(this.current);
  }

  @HostListener('keydown', ['$event'])
  onKey(event: KeyboardEvent): void {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const step = Math.max(1, this.step());
    const now = this.current;
    let next = now == null ? step
      : event.key === 'ArrowUp' ? (Math.floor(now / step) + 1) * step : (Math.ceil(now / step) - 1) * step;
    if (next < step) next = step;
    const max = this.max();
    if (max != null && next > max) next = Math.max(step, Math.floor(max / step) * step);
    this.current = next;
    this.element.nativeElement.value = String(next);
    this.onChange(next);
  }
}
