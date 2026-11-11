import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal } from '@angular/core';
import type { TrackingRecognised } from '../../core/api/container-tracking-models';
import { trackingReferenceAsBill, trackingReferenceHint } from './tracking-reference';

/** How long the field must rest before the line may warn: nobody is warned about a number half typed. */
const SETTLE_MS = 900;

/**
 * The line under a "Track & trace" field: what was read (container number, B/L, booking) at once, a warning
 * only once the typing rests. One unrecognised number can be confirmed as a B/L with one press.
 * The phone tints the field from this line's own state (styles/purchase-phone.scss, .mpo-input:has).
 */
@Component({
  selector: 'app-tracking-reference-hint',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (shown(); as line) {
      <span class="tt-hint" [class.tt-hint--warn]="line.warn" [class.tt-hint--ios]="variant() === 'ios'" role="status">{{ line.text }}</span>
      @if (line.warn && asBill(); as fixed) {
        <button class="tt-fix" [class.tt-fix--ios]="variant() === 'ios'" type="button" (click)="rewrite.emit(fixed)">Dit is een B/L</button>
      }
    }
  `,
  styles: `
    :host{display:contents}
    .tt-hint{display:block;font-size:12px;line-height:1.4;color:var(--muted);overflow-wrap:anywhere}
    .tt-hint--warn{color:var(--warn);font-weight:650}
    .tt-hint--ios{flex:1 1 100%;font-size:13px}
    .tt-fix{align-self:flex-start;min-height:32px;padding:4px 10px;border:1px solid var(--line-strong);border-radius:8px;background:var(--surface);color:var(--ink);font:inherit;font-size:12px;font-weight:650;cursor:pointer}
    .tt-fix--ios{flex:none;min-height:44px;padding:0 16px;border:0;border-radius:12px;background:color-mix(in srgb,var(--ink) 6%,transparent);font-size:15px}
    .tt-fix:focus-visible{outline:2px solid var(--rose);outline-offset:2px}
  `,
})
export class TrackingReferenceHint {
  readonly value = input<string | null | undefined>(null);
  /** The server's reading, when the text is a stored one; else the same rule runs here. */
  readonly recognised = input<TrackingRecognised | null>(null);
  readonly variant = input<'desk' | 'ios'>('desk');
  /** The text with "BL: " in front, after "Dit is een B/L". */
  readonly rewrite = output<string>();

  private readonly hint = computed(() => trackingReferenceHint(this.value(), this.recognised()));
  /** The text that rested long enough for its warning to show. */
  private readonly settled = signal<string | null | undefined>(undefined);
  readonly shown = computed(() => {
    const line = this.hint();
    return line && (!line.warn || this.settled() === (this.value() ?? '')) ? line : null;
  });
  readonly asBill = computed(() => trackingReferenceAsBill(this.value()));

  constructor() {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let first = true;
    effect(() => {
      const text = this.value() ?? '';
      const warn = this.hint()?.warn === true;
      clearTimeout(timer);
      /* What the field held when it opened is not being typed: its warning shows at once. */
      if (first || !warn) this.settled.set(text);
      else timer = setTimeout(() => this.settled.set(text), SETTLE_MS);
      first = false;
    });
    inject(DestroyRef).onDestroy(() => clearTimeout(timer));
  }
}
