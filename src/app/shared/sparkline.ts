import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * A bare trend line: no axes, no labels, one glance.
 *
 * Inline SVG instead of a chart library - it is a polyline and a dot, and
 * every dependency is one more thing that can break the week of the fair.
 */
@Component({
  selector: 'app-sparkline',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg [attr.width]="width()" [attr.height]="height()" [attr.viewBox]="viewBox()"
         preserveAspectRatio="none" aria-hidden="true">
      @if (points(); as line) {
        <polyline [attr.points]="line" fill="none" stroke="currentColor"
                  stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"
                  vector-effect="non-scaling-stroke" />
        @if (last(); as dot) {
          <circle [attr.cx]="dot[0]" [attr.cy]="dot[1]" r="2.4" fill="currentColor" />
        }
      }
    </svg>
  `,
  styles: `:host { display: inline-flex; line-height: 0; }`,
})
export class Sparkline {
  readonly values = input<number[]>([]);
  readonly width = input(96);
  readonly height = input(28);

  readonly viewBox = computed(() => `0 0 ${this.width()} ${this.height()}`);

  private readonly coords = computed(() => {
    const values = this.values();
    if (values.length < 2) return [];
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const w = this.width() - 6;
    const h = this.height() - 8;
    return values.map((value, index) => [
      3 + (index / (values.length - 1)) * w,
      4 + h - ((value - min) / span) * h,
    ]);
  });

  readonly points = computed(() =>
    this.coords().map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' '));

  readonly last = computed(() => this.coords().at(-1) ?? null);
}
