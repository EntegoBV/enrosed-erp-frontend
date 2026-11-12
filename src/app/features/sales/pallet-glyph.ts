import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { GlyphBlock } from './shipping-planner-model';

/**
 * The mini pallet of Palletberekening (.pc-stack): one coloured block per
 * product from the wood up, the frame standing for the maximum height. A
 * pallet above the maximum gets a red top edge.
 */
@Component({
  selector: 'app-pallet-glyph',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'aria-hidden': 'true',
    '[class.pg--sm]': "size() === 'sm'",
    '[class.pg--lg]': "size() === 'lg'",
    '[class.pg--over]': 'over()',
  },
  template: `@for (block of blocks(); track $index) { <i [style.height.%]="block.pct" [style.background]="block.colour"></i> }`,
  styles: [`
    :host{position:relative;flex:none;display:flex;flex-direction:column-reverse;overflow:hidden;width:30px;height:46px;border-radius:4px 4px 1px 1px;background:var(--surface-2);box-shadow:inset 0 0 0 1px var(--line);border-bottom:4px solid color-mix(in srgb,#a87b4f 85%,var(--surface))}
    :host(.pg--sm){width:20px;height:30px;border-bottom-width:3px}
    :host(.pg--lg){width:44px;height:88px;border-bottom-width:6px;border-radius:6px 6px 2px 2px}
    :host(.pg--over)::after{content:'';position:absolute;inset:0 0 auto;height:3px;background:var(--danger)}
    i{display:block;flex:none;box-shadow:inset 0 1px 0 rgb(255 255 255/35%);transition:height var(--dur-2,.2s) var(--ease-out,ease)}
  `],
})
export class PalletGlyph {
  readonly blocks = input<readonly GlyphBlock[]>([]);
  readonly size = input<'sm' | 'md' | 'lg'>('md');
  readonly over = input(false);
}

/**
 * − n + for omdozen or centimetres, Palletberekening's .pc-step: the field
 * takes digits only, Enter leaves it, and a typed number above the maximum
 * comes back as the maximum.
 */
@Component({
  selector: 'app-pallet-stepper',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'group', '[attr.aria-label]': 'label()', '[class.st--sm]': "size() === 'sm'", '[class.st--md]': "size() === 'md'" },
  template: `
    <button type="button" [disabled]="disabled() || value() - step() < min()" [attr.aria-label]="lessLabel()" (click)="emit(value() - step())">−</button>
    <input type="text" inputmode="numeric" autocomplete="off" [value]="value()" [disabled]="disabled()" [attr.aria-label]="label()"
           (input)="digits($event)" (change)="typed($event)" (keydown.enter)="blur($event)" />
    <button type="button" [disabled]="disabled() || plusDisabled() || (max() !== null && value() + step() > max()!)" [attr.aria-label]="moreLabel()"
            (click)="emit(value() + step())">+</button>
  `,
  styles: [`
    :host{display:inline-flex;flex:none;align-items:center;border:1px solid var(--line-strong);border-radius:999px;background:var(--surface);overflow:hidden}
    :host(:focus-within){border-color:var(--rose-mid);box-shadow:0 0 0 3px color-mix(in srgb,var(--rose) 14%,transparent)}
    button{display:grid;place-items:center;width:44px;height:44px;padding:0;border:0;background:none;color:var(--ink);font-size:20px;line-height:1;cursor:pointer;-webkit-tap-highlight-color:transparent}
    button:active:not(:disabled){background:var(--surface-2)}button:disabled{opacity:.35;cursor:default}
    input{width:48px;height:44px;padding:0;border:0;background:none;color:var(--ink);font-size:16px;font-weight:700;text-align:center;font-variant-numeric:tabular-nums}
    input:focus{outline:none}
    :host(.st--sm),:host(.st--md){border-radius:8px}
    :host(.st--sm) button{width:28px;height:28px;font-size:15px}:host(.st--sm) input{width:38px;height:28px;border-inline:1px solid var(--line);font-size:12.5px}
    :host(.st--md) button{width:30px;height:30px;font-size:15px}:host(.st--md) input{width:46px;height:30px;border-inline:1px solid var(--line);font-size:12.5px}
  `],
})
export class PalletStepper {
  readonly value = input.required<number>();
  readonly min = input(0);
  readonly max = input<number | null>(null);
  readonly step = input(1);
  readonly plusDisabled = input(false);
  readonly disabled = input(false);
  /** An emptied field reports null (a height back to its default); otherwise it shows the value again. */
  readonly allowEmpty = input(false);
  /** 'lg' 44 px (phone), 'md' 30 px, 'sm' 28 px (desk). */
  readonly size = input<'sm' | 'md' | 'lg'>('lg');
  readonly label = input('');
  readonly lessLabel = input('Eén omdoos minder');
  readonly moreLabel = input('Eén omdoos meer');
  readonly changed = output<number | null>();

  emit(value: number): void {
    const max = this.max();
    this.changed.emit(Math.max(this.min(), max === null ? value : Math.min(max, value)));
  }

  digits(event: Event): void {
    const input = event.target as HTMLInputElement;
    const digits = input.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 6);
    if (input.value !== digits) input.value = digits;
  }

  typed(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.value === '') {
      if (this.allowEmpty()) this.changed.emit(null);
      else input.value = String(this.value());
      return;
    }
    const max = this.max();
    const value = Math.max(this.min(), Math.min(max ?? Number.MAX_SAFE_INTEGER, Number(input.value)));
    /* The field shows what counts, also when the parent's value does not change (a capped number). */
    input.value = String(value);
    this.changed.emit(value);
  }

  blur(event: Event): void {
    (event.target as HTMLInputElement).blur();
  }
}
