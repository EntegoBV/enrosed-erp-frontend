import { ChangeDetectionStrategy, Component, ElementRef, inject, viewChild } from '@angular/core';
import { ContextMenuItem } from '../../shared/context-menu';
import { FinanceState } from './finance-state';

/**
 * The phone's '+': an action sheet with what can be added, the section's own
 * kind first. 'Bon of factuur fotograferen' opens the camera (images only,
 * so Safari goes straight to it; a PDF goes through 'Kost boeken' →
 * 'Bestand kiezen') and then a blank cost with the photo queued; it uploads
 * after the first save.
 */
@Component({
  selector: 'app-finance-create-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <input #photo class="fin-hidden" type="file" accept="image/*" capture="environment" tabindex="-1" aria-hidden="true" (change)="picked($event)" />
  `,
})
export class FinanceCreateMenu {
  private readonly state = inject(FinanceState);
  private readonly photo = viewChild.required<ElementRef<HTMLInputElement>>('photo');

  open(): void {
    const { view, tab } = this.state.location();
    const lists = view === 'costs' && tab === 'lists';
    const bankDetail = view === 'bank' && tab === 'movements' && !!this.state.location().account;
    const canNoteMovement = !bankDetail || this.state.manualAccountAllowed(this.state.location().account);
    const items: ContextMenuItem[] = [
      /* On Aan wie & beurzen the list's own kinds lead. */
      ...(lists ? [{ id: 'party', label: 'Aan wie toevoegen', iconName: 'customers' }, { id: 'fair', label: 'Beurs toevoegen', iconName: 'tag' }] : []),
      { id: 'cost', label: 'Factuur of kost toevoegen', iconName: 'receipt' },
      { id: 'photo', label: 'Bon of factuur fotograferen', iconName: 'camera' },
      ...(canNoteMovement ? [{ id: 'movement', label: 'Handmatige banktransactie', iconName: 'bank' }] : []),
      { id: 'balance', label: 'Rekening of saldocontrole toevoegen', iconName: 'bank' },
      { id: 'recurring', label: 'Vaste kost instellen', iconName: 'repeat' },
    ];
    const first = lists ? 'party' : bankDetail ? 'cost' : view === 'bank' ? 'balance' : view === 'costs' && tab === 'recurring' ? 'recurring' : 'cost';
    items.sort((a, b) => Number(b.id === first) - Number(a.id === first));
    this.state.openMenu({ title: 'Toevoegen', items, anchor: null, cancelLabel: 'Annuleren', pick: (id) => this.run(id) });
  }

  private run(id: string): void {
    const location = this.state.location();
    if (id === 'cost') this.state.openCost(null);
    else if (id === 'photo') this.photo().nativeElement.click();
    else if (id === 'movement') this.state.openMovement({ accountKey: location.view === 'bank' ? location.account || undefined : undefined });
    else if (id === 'balance') this.state.openBank(null);
    else if (id === 'party') this.state.openCostParty(null);
    else if (id === 'fair') this.state.openFair(null);
    else this.state.openRecurring(null);
  }

  picked(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';
    if (files.length) this.state.openCost(null, files);
  }
}
