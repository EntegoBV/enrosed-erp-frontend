import { ChangeDetectionStrategy, Component, computed, input, linkedSignal, output } from '@angular/core';
import type { PurchaseOrder } from '../../core/api/models';
import { Sheet } from '../../shared/ui';
import { STATUS_BACK_LABEL, defaultStatusBack, type StatusBackOption, type StatusBackTarget } from './purchase-status-back';

/**
 * Status terugzetten: a container set to Vertrokken or Besteld by mistake
 * goes back one step or two. The sheet names the target and what changes;
 * the editor does the saving.
 */
@Component({
  selector: 'app-purchase-status-back-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet],
  template: `
    @let choice = chosen();
    @let option = shown();
    <app-sheet title="Status terugzetten" variant="ios" (closed)="cancel.emit()">
      <div body class="back-sheet" [attr.inert]="busy() ? '' : null">
        <p class="back-sheet__now">Nu: {{ currentLabel() }}</p>
        @if (options().length > 1) {
          <div class="back-sheet__choices" role="radiogroup" aria-label="Terugzetten naar">
            @for (item of options(); track item.to) {
              <label class="back-sheet__choice" [class.is-on]="choice === item.to" [class.is-blocked]="!!item.blocked">
                <input type="radio" name="purchase-status-back" [value]="item.to" [checked]="choice === item.to"
                       [disabled]="!!item.blocked" (change)="chosen.set(item.to)" />
                <span><b>{{ item.label }}</b>@if (item.blocked) { <small>{{ item.blocked }}</small> }</span>
              </label>
            }
          </div>
        }
        @if (option) {
          @if (option.blocked) {
            <p class="back-sheet__blocked">Terug naar {{ option.label }} kan nu niet: {{ lowerFirst(option.blocked) }}.</p>
          } @else {
            <ul class="back-sheet__lines">
              @for (line of option.lines; track line) { <li>{{ line }}</li> }
              @if (dirty()) { <li>Je openstaande wijzigingen worden mee opgeslagen.</li> }
            </ul>
          }
        }
      </div>
      <div foot style="display:contents">
        <button class="btn" type="button" (click)="cancel.emit()">Annuleren</button>
        <button class="btn btn--primary" type="button" [disabled]="busy() || !choice" (click)="pick()">
          {{ busy() ? 'Bezig…' : 'Terugzetten naar ' + (option?.label ?? '') }}
        </button>
      </div>
    </app-sheet>
  `,
  styles: `
    .back-sheet{display:grid;gap:14px;min-width:0}
    .back-sheet__now{margin:0;color:var(--muted);font-size:13px}
    .back-sheet__choices{display:grid;gap:8px}
    .back-sheet__choice{display:grid;grid-template-columns:22px minmax(0,1fr);align-items:start;gap:10px;padding:12px 14px;border:1px solid var(--line);border-radius:14px;background:var(--surface);font-size:14px;cursor:pointer}
    .back-sheet__choice.is-on{border-color:var(--rose);background:var(--rose-soft)}
    .back-sheet__choice.is-blocked{cursor:default}.back-sheet__choice.is-blocked b{color:var(--muted)}
    .back-sheet__choice input{width:18px;height:18px;margin:1px 0 0;accent-color:var(--rose)}
    .back-sheet__choice span{display:grid;gap:2px;min-width:0}
    .back-sheet__choice small{color:var(--muted);font-size:12.5px}
    .back-sheet__lines{display:grid;gap:6px;margin:0;padding-left:18px;font-size:13.5px;line-height:1.45}
    .back-sheet__blocked{margin:0;padding:10px 12px;border-radius:12px;background:var(--warn-soft);color:#7c450b;font-size:13px;line-height:1.45}
    @media (max-width: 679.98px), (hover: none) and (max-width: 1023.98px) {.back-sheet{padding:0 16px}}
  `,
})
export class PurchaseStatusBackSheet {
  /** The status the container has now: Vertrokken or Besteld. */
  readonly current = input.required<PurchaseOrder['status']>();
  readonly options = input.required<readonly StatusBackOption[]>();
  /** Unsaved edits go along with the status; the sheet says so. */
  readonly dirty = input(false);
  readonly busy = input(false);
  readonly confirm = output<StatusBackTarget>();
  readonly cancel = output<void>();

  readonly currentLabel = computed(() => STATUS_BACK_LABEL[this.current()]);
  /** Fresh figures rebuild the options; the choice made stays while it can. */
  readonly chosen = linkedSignal<readonly StatusBackOption[], StatusBackTarget | null>({
    source: this.options,
    computation: (options, previous) => defaultStatusBack(options, previous?.value ?? null),
  });
  /** The option whose consequences are listed: the chosen one, or the only one. */
  readonly shown = computed(() => {
    const options = this.options();
    return options.find((item) => item.to === this.chosen()) ?? options[0] ?? null;
  });

  lowerFirst(text: string): string {
    return text.charAt(0).toLocaleLowerCase('nl-BE') + text.slice(1);
  }

  pick(): void {
    const choice = this.chosen();
    if (choice && !this.busy()) this.confirm.emit(choice);
  }
}
