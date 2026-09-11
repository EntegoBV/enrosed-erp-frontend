import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Sheet } from '../../shared/ui';

@Component({
  selector: 'app-sales-line-restore-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet, FormsModule],
  template: `<app-sheet title="Aantal herstellen" (closed)="closed.emit()"><div body>
    <p>{{ description() }} staat tijdelijk op 0. Vul het aantal in dat opnieuw in deze order moet meetellen.</p>
    <label class="field"><span>Aantal stuks</span><input class="input" type="number" inputmode="numeric" min="1" [step]="piecesPerCarton()" [ngModel]="quantity()" (ngModelChange)="quantity.set($event); error.set('')" /></label>
    @if (piecesPerCarton() > 1) { <p class="hint">Volle dozen van {{ piecesPerCarton() }} stuks.</p> }
    @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
  </div><div foot><button class="btn" type="button" (click)="closed.emit()">Annuleren</button><button class="btn btn--primary" type="button" (click)="confirm()">Aantal herstellen</button></div></app-sheet>`,
  styles: `p{font-size:13px;line-height:1.6}.field{display:grid;gap:8px}.input{font-size:16px;min-height:44px}.error{color:var(--danger)}`,
})
export class SalesLineRestoreSheet {
  readonly description = input.required<string>();
  readonly piecesPerCarton = input(1);
  readonly restored = output<number>();
  readonly closed = output<void>();
  readonly quantity = signal<number | null>(null);
  readonly error = signal('');
  confirm(): void {
    const quantity = this.quantity(), per = Math.max(1, this.piecesPerCarton());
    if (quantity == null || !Number.isSafeInteger(quantity) || quantity <= 0 || quantity % per !== 0) {
      this.error.set(`Vul een positief aantal in${per > 1 ? ` in volle dozen van ${per} stuks` : ''}.`); return;
    }
    this.restored.emit(quantity);
  }
}
