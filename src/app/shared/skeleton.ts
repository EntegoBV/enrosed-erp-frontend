import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Loading skeleton: grey shimmering placeholders in the shape of the
 * content that is coming.
 *
 * A skeleton over a spinner for two reasons: the screen keeps its layout
 * (nothing jumps when data lands), and it communicates *what* is loading -
 * three list rows promise a list, not a blank wall. The shimmer runs on a
 * shared keyframe in styles.scss so every skeleton breathes in sync.
 */
@Component({
  selector: 'app-skeleton',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (kind()) {
      @case ('list') {
        @for (row of items(); track $index) {
          <div class="skel-row">
            <div class="skel skel--dot"></div>
            <div class="skel-row__body">
              <div class="skel skel--line" [style.width.%]="60 + (($index * 17) % 30)"></div>
              <div class="skel skel--line skel--thin" [style.width.%]="30 + (($index * 23) % 25)"></div>
            </div>
            <div class="skel skel--chip"></div>
          </div>
        }
      }
      @case ('card') {
        @for (row of items(); track $index) {
          <div class="skel skel--card"></div>
        }
      }
      @case ('lines') {
        @for (row of items(); track $index) {
          <div class="skel skel--line mb-8" [style.width.%]="55 + (($index * 19) % 40)"></div>
        }
      }
      @case ('stats') {
        <div class="skel-stats">
          @for (row of items(); track $index) {
            <div class="skel skel--stat"></div>
          }
        </div>
      }
    }
  `,
})
export class Skeleton {
  /** Shape of what is loading: list rows, cards, text lines or stat tiles. */
  readonly kind = input<'list' | 'card' | 'lines' | 'stats'>('list');
  readonly rows = input(3);
  readonly items = computed(() => Array.from({ length: this.rows() }));
}
