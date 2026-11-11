import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { NumPipe } from './pipes';
import type { Incoming } from './product-incoming';

/**
 * What is coming for a product or a series, as one pill: the pieces of the
 * first arrival, the state word and the date, and "+N later" when more
 * follows. The same on Voorraad, Producten, the sales picker and the sales
 * line; the words and the figure come from product-incoming.ts.
 *
 * stack: desk tables (pill, then word and date). phone: tinted pill with
 * figure and date, the word under it. inline: one line beside other text.
 * strong: the row has no stock, so the pill is filled and ringed and reads
 * at a glance as coming back.
 */
@Component({
  selector: 'app-incoming-pill',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, RouterLink, NumPipe],
  template: `
    @if (value(); as inc) {
      @if (link() && inc.orders.length) {
        <a [class]="'inc inc--' + variant() + ' inc--' + inc.state.toLowerCase()" [class.inc--strong]="strong()"
           [routerLink]="['/purchasing', inc.orders[0].orderId]" tabindex="-1" [attr.title]="inc.title" [attr.aria-label]="inc.label"
           (click)="$event.stopPropagation()"><ng-container *ngTemplateOutlet="body; context: { $implicit: inc }" /></a>
      } @else {
        <span [class]="'inc inc--' + variant() + ' inc--' + inc.state.toLowerCase()" [class.inc--strong]="strong()"
              [attr.title]="inc.title"><ng-container *ngTemplateOutlet="body; context: { $implicit: inc }" /></span>
      }
    }
    <ng-template #body let-inc>
      <b class="inc__n">+{{ inc.quantity | num }}@if (dateInPill(inc)) { · {{ inc.dateShort }}}</b>
      <span class="inc__l"><span class="inc__w">{{ inc.word }}</span>@if (inc.dateShort && !dateInPill(inc)) { <span class="inc__d">{{ inc.dateShort }}</span> }</span>
      @if (inc.later) { <span class="inc__more">+{{ inc.later | num }} later</span> }
    </ng-template>
  `,
  styles: `
    :host { display: block; min-width: 0; }
    .inc { display: inline-grid; justify-items: end; gap: 2px; max-width: 100%; color: inherit; font: inherit; text-align: right; text-decoration: none; font-variant-numeric: tabular-nums; --tone: var(--rose-dark); }
    .inc--besteld { --tone: var(--ink-2); }
    .inc--aangekomen { --tone: var(--warn); }
    .inc__n { padding: 1px 8px; border-radius: 999px; background: color-mix(in srgb, var(--tone) 10%, transparent); color: var(--tone); font-size: 12.5px; font-weight: 700; line-height: 1.45; white-space: nowrap; }
    .inc--binnenkort .inc__n, .inc--aangekomen .inc__n, .inc--strong .inc__n { background: color-mix(in srgb, var(--tone) 18%, transparent); }
    .inc--strong .inc__n { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--tone) 42%, transparent); }
    .inc__l { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 0 5px; font-size: 11px; font-weight: 600; line-height: 1.3; }
    .inc__w { color: var(--tone); }
    .inc__d, .inc__more { color: var(--muted); font-weight: 550; white-space: nowrap; }
    .inc__more { font-size: 11px; line-height: 1.3; }
    a.inc:hover .inc__w { text-decoration: underline; }
    a.inc:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 8px; }
    .inc--phone { margin-top: 3px; }
    .inc--phone .inc__n { padding: 2px 8px; font-size: 12.5px; }
    .inc--phone .inc__l, .inc--phone .inc__more { font-size: 11.5px; }
    :host(.inc-host--inline) { display: inline-block; vertical-align: middle; }
    .inc--inline { display: inline-flex; flex-wrap: wrap; align-items: center; justify-items: start; gap: 2px 6px; text-align: left; }
    .inc--inline .inc__n { padding: 0 7px; font-size: 11.5px; }
    .inc--inline .inc__l { justify-content: flex-start; font-size: inherit; }
    .inc--inline .inc__more { font-size: inherit; }
  `,
  host: { '[class.inc-host--inline]': "variant() === 'inline'" },
})
export class IncomingPill {
  readonly value = input<Incoming | null>(null);
  readonly variant = input<'stack' | 'phone' | 'inline'>('stack');
  /** The row has no stock at all: filled and ringed. */
  readonly strong = input(false);
  /** Desk tables only: the pill opens the purchase order of the first arrival. */
  readonly link = input(false);

  /** The phone pill holds figure and date; from five digits on the date moves to the word line so the pill keeps its width. */
  dateInPill(inc: Incoming): boolean {
    return this.variant() === 'phone' && !!inc.dateShort && inc.quantity < 10_000;
  }
}
