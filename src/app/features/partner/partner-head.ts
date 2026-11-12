import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Icon } from '../../shared/icon';

/** A portal page's title with a round back button; extra controls go in the projected trail. */
@Component({
  selector: 'app-partner-head',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    @if (backLabel()) {
      <button class="back" type="button" [attr.aria-label]="backLabel()" (click)="back.emit()">
        <app-icon name="chevron-left" [size]="22" />
      </button>
    }
    <div class="text">
      <h1>{{ title() }}</h1>
      @if (sub()) { <p>{{ sub() }}</p> }
    </div>
    <ng-content />
  `,
  styles: `
    :host{display:flex;align-items:center;gap:10px;min-height:56px;margin:4px 0 12px}
    .back{display:grid;flex:none;place-items:center;width:44px;height:44px;margin-left:-6px;padding:0;border:0;border-radius:50%;background:var(--surface);color:var(--ink);box-shadow:0 1px 3px rgb(26 22 20/10%);cursor:pointer}
    .back:active{transform:scale(.95)}
    .text{flex:1;min-width:0}
    h1{margin:0;overflow:hidden;font-size:26px;font-weight:800;letter-spacing:-.025em;line-height:1.15;text-overflow:ellipsis;white-space:nowrap}
    p{margin:2px 0 0;overflow:hidden;color:var(--muted);font-size:14px;text-overflow:ellipsis;white-space:nowrap}
  `,
})
export class PartnerHead {
  readonly title = input.required<string>();
  readonly sub = input<string | null>(null);
  /** The back button's accessible name; empty shows no button. */
  readonly backLabel = input('');
  readonly back = output<void>();
}
