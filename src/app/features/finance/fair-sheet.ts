import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Fair } from '../../core/api/models';
import { Sheet } from '../../shared/ui';
import { blankFair } from './finance-sections';
import { FinanceState } from './finance-state';

/** A fair: its name, and once it exists its switch. The code comes from the name and never changes. */
@Component({
  selector: 'app-fair-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Sheet],
  template: `
    <app-sheet variant="ios" [title]="draft().id ? 'Beurs bewerken' : 'Beurs toevoegen'" (closed)="state.fairDraft.set(null)">
      <div body class="fin-sheet">
        <div class="fin-group" [class.ios-group]="!state.desk()">
          <label class="fin-field"><span class="req">Naam</span>
            <input class="input" maxlength="120" autocomplete="off" placeholder="bijv. Ede" [attr.data-initial-focus]="draft().id ? null : ''"
                   [ngModel]="draft().label" (ngModelChange)="patch({ label: $event })" (keydown.enter)="save()" />
            <span class="fin-hint">{{ draft().id ? 'Code ' + draft().code + ' · blijft op de kosten staan.' : 'De code op de kosten komt uit de naam.' }}</span></label>
          @if (draft().id) {
            <label class="fin-field fin-field--switch"><span>Actief<small>{{ draft().active ? 'Te kiezen bij een kost.' : 'Uit: blijft op oude kosten staan, niet meer te kiezen.' }}</small></span>
              <input [class]="state.desk() ? 'fin-checkbox' : 'ios-switch'" type="checkbox" role="switch" [ngModel]="draft().active" (ngModelChange)="patch({ active: $event })" /></label>
          }
        </div>
        @if (draft().id && !state.desk()) {
          <div class="ios-group"><button class="ios-cell ios-cell--danger" type="button" [disabled]="state.saving()" (click)="state.deleteFair(draft())">Verwijderen</button></div>
        }
      </div>
      <div foot style="display:contents">
        @if (draft().id && state.desk()) { <button class="btn btn--danger" type="button" [disabled]="state.saving()" (click)="state.deleteFair(draft())">Verwijderen</button> }
        <span class="spacer"></span>
        <button class="btn btn--primary" type="button" [disabled]="state.saving() || !canSave()" (click)="save()">{{ state.saving() ? 'Bezig…' : draft().id ? 'Bewaren' : 'Toevoegen' }}</button>
      </div>
    </app-sheet>
  `,
})
export class FairSheet {
  readonly state = inject(FinanceState);
  readonly draft = linkedSignal<Fair>(() => this.state.fairDraft() ?? blankFair());
  readonly canSave = computed(() => !!this.draft().label.trim());

  patch(changes: Partial<Fair>): void {
    this.draft.update((draft) => ({ ...draft, ...changes }));
  }

  save(): void {
    if (!this.canSave()) return;
    void this.state.saveFair(this.draft());
  }
}
