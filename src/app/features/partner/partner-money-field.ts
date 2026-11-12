import { Directive, ElementRef, HostListener, forwardRef, inject, input, signal } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

/**
 * What a money or percent field of the melding holds: a number, nothing (empty), or text that is no amount.
 * Read the Dutch way, like Aantal reads "1.000": a dot followed by exactly three digits groups thousands
 * ("1.250" and "1.250,00" are 1250), the comma is the decimal sign ("3,20"), and a lone dot with other than
 * three digits after it is a decimal point too ("3.2", typed on a desk keyboard). Anything else (two commas,
 * letters, a minus) is no amount: it is never read as something else, the way "1.250" used to become € 1,25.
 */
export function readMoney(raw: string): { value: number | null; readable: boolean } {
  const text = raw.replace(/[\s  €%]/g, '');
  if (text === '') return { value: null, readable: true };
  let normal: string | null = null;
  if (/^\d+$/.test(text)) normal = text;
  else if (/^[1-9]\d{0,2}(?:\.\d{3})+(?:,\d*)?$/.test(text)) normal = text.replace(/\./g, '').replace(',', '.');
  else if (/^\d*,\d*$/.test(text) && text !== ',') normal = text.replace(',', '.');
  else if (/^\d*\.\d*$/.test(text) && text !== '.') normal = text;
  if (normal === null) return { value: null, readable: false };
  if (normal.endsWith('.')) normal = normal.slice(0, -1);
  if (normal.startsWith('.')) normal = '0' + normal;
  const value = Number(normal);
  return Number.isFinite(value) ? { value, readable: true } : { value: null, readable: false };
}

const FORMATS = new Map<number, Intl.NumberFormat>();

/** "3,20", "1.250,00", "3,1234" (money: decimals 2); "4,5" or "10" (a percentage: decimals 0). */
export function showMoney(value: number, decimals: number): string {
  let format = FORMATS.get(decimals);
  if (!format) {
    format = new Intl.NumberFormat('nl-BE', { minimumFractionDigits: decimals, maximumFractionDigits: Math.max(decimals, 4) });
    FORMATS.set(decimals, format);
  }
  return format.format(value);
}

/**
 * The partner form's euro and percent fields (the shared appDecimal keeps its own rules for the rest of the ERP).
 * The model is a plain number, or null while empty or unreadable; an unreadable text stays as typed and is marked
 * (aria-invalid, `unreadable()` for the message next to it). Leaving the field shows the amount with its decimals.
 *
 *   <input appPartnerMoney #field="partnerMoney" [ngModel]="price" (ngModelChange)="…" />
 *   <input appPartnerMoney [decimals]="0" … />   (a percentage)
 */
@Directive({
  selector: 'input[appPartnerMoney]',
  exportAs: 'partnerMoney',
  host: { type: 'text', inputmode: 'decimal', autocomplete: 'off', '[attr.aria-invalid]': "unreadable() ? 'true' : null" },
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => PartnerMoneyField), multi: true }],
})
export class PartnerMoneyField implements ControlValueAccessor {
  private readonly element = inject<ElementRef<HTMLInputElement>>(ElementRef);
  /** The fewest decimals shown after leaving the field: 2 for euros, 0 for a percentage. */
  readonly decimals = input(2);
  readonly unreadable = signal(false);
  private onChange: (value: number | null) => void = () => {};
  private onTouched: () => void = () => {};
  private current: number | null = null;

  writeValue(value: unknown): void {
    const number = typeof value === 'number' && Number.isFinite(value) ? value : null;
    /* Never rewrite what is being typed: "12," stays while the decimals come, an unreadable text stays to be fixed. */
    if (number === this.current && document.activeElement === this.element.nativeElement) return;
    this.current = number;
    this.unreadable.set(false);
    this.element.nativeElement.value = number === null ? '' : showMoney(number, this.decimals());
  }

  registerOnChange(fn: (value: number | null) => void): void { this.onChange = fn; }
  registerOnTouched(fn: () => void): void { this.onTouched = fn; }
  setDisabledState(disabled: boolean): void { this.element.nativeElement.disabled = disabled; }

  @HostListener('input')
  onInput(): void {
    const read = readMoney(this.element.nativeElement.value);
    this.current = read.value;
    this.unreadable.set(!read.readable);
    this.onChange(read.value);
  }

  @HostListener('blur')
  onBlur(): void {
    this.onTouched();
    if (this.unreadable()) return;
    this.element.nativeElement.value = this.current === null ? '' : showMoney(this.current, this.decimals());
  }
}
