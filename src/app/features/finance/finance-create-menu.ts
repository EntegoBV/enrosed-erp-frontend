import { ChangeDetectionStrategy, Component, ElementRef, inject, viewChild } from '@angular/core';
import { ContextMenuItem } from '../../shared/context-menu';
import { FinanceState } from './finance-state';

/**
 * The phone's '+': an action sheet with what can be added, the section's own
 * kind first. 'Foto van een bon' opens the camera (or the files) and then a
 * blank cost with the photo queued; it uploads after the first save.
 */
@Component({
  selector: 'app-finance-create-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <input #photo class="fin-hidden" type="file" accept="image/*,application/pdf" capture="environment" tabindex="-1" aria-hidden="true" (change)="picked($event)" />
  `,
})
export class FinanceCreateMenu {
  private readonly state = inject(FinanceState);
  private readonly photo = viewChild.required<ElementRef<HTMLInputElement>>('photo');

  open(): void {
    const { view, tab } = this.state.location();
    const items: ContextMenuItem[] = [
      { id: 'cost', label: 'Kost boeken', iconName: 'receipt' },
      { id: 'photo', label: 'Foto van een bon', iconName: 'camera' },
      { id: 'movement', label: 'Bankbeweging noteren', iconName: 'bank' },
      { id: 'balance', label: 'Saldo invullen', iconName: 'pencil' },
      { id: 'recurring', label: 'Vaste kost instellen', iconName: 'repeat' },
    ];
    const first = view === 'incoming' || (view === 'bank' && tab === 'movements') ? 'movement'
      : view === 'bank' ? 'balance' : view === 'costs' && tab === 'recurring' ? 'recurring' : 'cost';
    items.sort((a, b) => Number(b.id === first) - Number(a.id === first));
    this.state.openMenu({ title: 'Toevoegen', items, anchor: null, cancelLabel: 'Annuleren', pick: (id) => this.run(id) });
  }

  private run(id: string): void {
    const location = this.state.location();
    if (id === 'cost') this.state.openCost(null);
    else if (id === 'photo') this.photo().nativeElement.click();
    else if (id === 'movement') this.state.openMovement({ accountKey: location.view === 'bank' ? location.account || undefined : undefined });
    else if (id === 'balance') this.state.openBank(null);
    else this.state.openRecurring(null);
  }

  picked(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';
    if (files.length) this.state.openCost(null, files);
  }
}
