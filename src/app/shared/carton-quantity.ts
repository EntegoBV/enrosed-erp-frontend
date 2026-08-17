import { signal } from '@angular/core';

/**
 * A quantity field that respects full cartons.
 *
 * The rules are the same everywhere a quantity is typed:
 *
 *  - the notice appears immediately, so you see what is about to happen;
 *  - the value snaps only two seconds after the last keystroke, because
 *    someone typing "240" passes through "2" and a field that corrects
 *    instantly is impossible to type in;
 *  - zero and empty stay untouched — they mean something else.
 *
 * With `snap` disabled (purchasing), nothing is ever corrected: the notice is
 * all there is. A supplier can perfectly well ship a sample of three pieces;
 * it is our own sales orders that must never contain half a carton.
 *
 * The server re-rounds sales quantities on save regardless. This class is the
 * courtesy; that check is the guarantee.
 */
export class CartonQuantity {
  /** The quantity as currently shown in the field. */
  readonly value = signal(0);
  /** Announced correction: visible immediately, not yet applied. */
  readonly pending = signal<{ from: number; to: number } | null>(null);
  /** Correction that has just been applied. */
  readonly applied = signal<{ from: number; to: number } | null>(null);

  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly perCarton: () => number,
    private readonly snap: () => boolean,
    private readonly delayMs = 2000,
  ) {}

  set(raw: number): void {
    const wanted = Math.max(0, raw || 0);
    this.value.set(wanted);
    this.applied.set(null);
    clearTimeout(this.timer);

    const target = this.roundedUp(wanted);
    const offCarton = target !== wanted && wanted > 0;
    this.pending.set(offCarton ? { from: wanted, to: target } : null);

    if (!offCarton || !this.snap()) return;

    this.timer = setTimeout(() => {
      /* Only correct if nothing else has been typed in the meantime. */
      if (this.value() !== wanted) return;
      this.value.set(target);
      this.pending.set(null);
      this.applied.set({ from: wanted, to: target });
    }, this.delayMs);
  }

  /** Reset to a fresh value, silently (e.g. after picking a product). */
  reset(value: number): void {
    clearTimeout(this.timer);
    this.value.set(Math.max(0, value));
    this.pending.set(null);
    this.applied.set(null);
  }

  /**
   * The value to submit. With snapping on, a pending correction is applied
   * here even if the two seconds have not elapsed — a half-filled carton must
   * never reach the order. With snapping off, the raw value is returned.
   */
  finalValue(): number {
    clearTimeout(this.timer);
    return this.snap() ? this.roundedUp(this.value()) : this.value();
  }

  /** True when the current value is not a whole number of cartons. */
  offCarton(): boolean {
    const value = this.value();
    return value > 0 && this.roundedUp(value) !== value;
  }

  destroy(): void {
    clearTimeout(this.timer);
  }

  private roundedUp(value: number): number {
    const per = Math.max(1, this.perCarton());
    return Math.ceil(value / per) * per;
  }
}
