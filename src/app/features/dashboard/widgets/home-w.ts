import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Icon } from '../../../shared/icon';
import { eurWhole } from '../../finance/cash-format';
import { HomeData } from '../home-data';
import type { SourceState } from '../home-data';

/** Whole euros that never break across lines: '€\u00a032.365', '−\u00a0€\u00a07.450' (eurWhole with no-break spaces). */
export function amount(value: number | null | undefined): string {
  return eurWhole(value).replace(/ /g, '\u00a0');
}

/** Thousands with a dot, whole: 11860 → '11.860'. */
export function count(value: number | null | undefined): string {
  return Number.isFinite(value as number) ? Math.round(value as number).toLocaleString('nl-BE') : '—';
}

/** '1 order' / '6 orders'. */
export function counted(value: number, one: string, many: string): string {
  return `${count(value)} ${value === 1 ? one : many}`;
}

/**
 * The frame every figure block shares (spec-home §6): a desk `wk-card` or a
 * phone `ios-widget`, a head with the icon tile, the title, a muted sub and
 * a chevron, and the whole block as ONE tap target - the title link is
 * stretched over the card (::after), so an inline link or "Opnieuw" inside
 * is raised above it and never nested in it. A failed source reads
 * "— · Opnieuw" (HomeData.load()), never 0; loading shows two quiet lines.
 * The body is projected and rendered by the block once its data is ready.
 * The small blocks show their figures as label/value rows (.home-w__kv): a
 * label wraps, a value never does; no block turns dark (owner: no dark
 * blocks), a negative value is red instead.
 * No styles here: the rules live in styles/home-widgets.scss.
 */
@Component({
  selector: 'app-home-w',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon],
  template: `
    <article [class]="classes()" [attr.aria-busy]="state() === 'loading' || null" [attr.aria-label]="title()">
      <header class="home-w__head">
        <span class="home-w__icon ios-tile ios-tile--soft" [class]="'tone-' + tone()" aria-hidden="true">
          <app-icon [name]="icon()" [size]="variant() === 'desk' ? 16 : 15" />
        </span>
        <span class="home-w__names">
          <h3 class="home-w__title"><a class="home-w__go" [routerLink]="link()" [queryParams]="query()">{{ title() }}</a></h3>
          @if (sub()) { <span class="home-w__sub">{{ sub() }}</span> }
        </span>
        <span class="home-w__chev" aria-hidden="true">›</span>
      </header>
      @if (state() === 'failed') {
        <p class="home-w__failed"><span class="home-w__value home-w__value--none">—</span>
          <button class="home-w__retry home-w__raise" type="button" [disabled]="data.refreshing()" (click)="data.load()">Opnieuw</button></p>
      } @else if (state() === 'loading') {
        <div class="home-w__loading" aria-hidden="true"><span class="skel skel--line"></span><span class="skel skel--thin"></span></div>
      }
      <ng-content />
    </article>
  `,
})
export class HomeWidget {
  readonly data = inject(HomeData);
  readonly variant = input<'desk' | 'phone'>('desk');
  readonly title = input.required<string>();
  readonly sub = input<string | null>(null);
  readonly icon = input.required<string>();
  readonly tone = input<string>('grey');
  readonly link = input.required<string | (string | number)[]>();
  readonly query = input<Record<string, string> | null>(null);
  readonly state = input<SourceState>('ready');
  /** Phone: the full width of the 2-column grid (Verkoop, Inkoop, Website). */
  readonly wide = input(false);
  /** Desk: one full-width strip (Markt) - the head, the figures inline and the line at the end. */
  readonly strip = input(false);
  /** A modifier for the block's own rules: 'verkoop' → home-w--verkoop. */
  readonly kind = input<string>('');

  readonly classes = computed(() => [
    'home-w', this.variant() === 'desk' ? 'wk-card home-w--desk' : 'ios-widget home-w--phone',
    this.wide() && this.variant() === 'phone' ? 'ios-widget--wide home-w--wide' : '',
    this.strip() && this.variant() === 'desk' ? 'home-w--strip' : '', this.kind() ? `home-w--${this.kind()}` : '',
    this.state() === 'failed' ? 'is-failed' : '',
  ].filter(Boolean).join(' '));
}
