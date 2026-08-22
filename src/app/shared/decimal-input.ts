import { Directive, ElementRef, HostListener, forwardRef, inject } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

/**
 * A text field that behaves like a number field but speaks Belgian: "12,5"
 * and "12.5" both arrive as 12.5, and the value shows with a comma.
 *
 * <input type="number"> rejects the comma a Dutch keyboard offers first,
 * and on a phone that meant retyping every measurement. The model stays a
 * plain number (or null when empty), so nothing downstream changes.
 */
@Directive({
  selector: 'input[appDecimal]',
  host: { type: 'text', inputmode: 'decimal', autocomplete: 'off' },
  providers: [{
    provide: NG_VALUE_ACCESSOR,
    useExisting: forwardRef(() => DecimalInput),
    multi: true,
  }],
})
export class DecimalInput implements ControlValueAccessor {
  private readonly element = inject<ElementRef<HTMLInputElement>>(ElementRef);
  private onChange: (value: number | null) => void = () => {};
  private onTouched: () => void = () => {};
  /** The number the field currently represents; typing rewrites it. */
  private current: number | null = null;

  writeValue(value: unknown): void {
    const number = toNumber(value);
    /* Do not reformat under the user's fingers: "12," must stay "12,"
       while they are still typing the decimals. */
    if (number === this.current && document.activeElement === this.element.nativeElement) return;
    this.current = number;
    this.element.nativeElement.value = number === null ? '' : String(number).replace('.', ',');
  }

  registerOnChange(fn: (value: number | null) => void): void { this.onChange = fn; }
  registerOnTouched(fn: () => void): void { this.onTouched = fn; }
  setDisabledState(disabled: boolean): void { this.element.nativeElement.disabled = disabled; }

  @HostListener('input')
  onInput(): void {
    this.current = toNumber(this.element.nativeElement.value);
    this.onChange(this.current);
  }

  @HostListener('blur')
  onBlur(): void {
    this.onTouched();
    /* Tidy on leaving: "12,50" becomes "12,5", a lone comma disappears. */
    this.element.nativeElement.value = this.current === null ? '' : String(this.current).replace('.', ',');
  }
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().replace(/\s/g, '').replace(',', '.');
  if (text === '' || text === '.' || text === '-') return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}
