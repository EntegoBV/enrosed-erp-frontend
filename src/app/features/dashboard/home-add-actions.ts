import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import type { ContextMenuItem } from '../../shared/context-menu';
import { FinanceIntake } from '../finance/finance-intake';

/*
 * What the home can add, once: the phone's Toevoegen sheet (four tiles, then
 * rows) and the desk's "+ Nieuw" menu read the same eight actions in the
 * same order, the camera first (the quick-cost round made it the main one).
 * Photo, Taak and Afspraak need the page (the camera input must be clicked
 * inside the tap; the planner sheets live on the page); the rest navigate.
 */

export type HomeAddId = 'photo' | 'task' | 'event' | 'cost' | 'movement' | 'order' | 'customer' | 'product';

export interface HomeAddAction {
  id: HomeAddId;
  /** The tile or row label in the sheet. */
  label: string;
  /** The tile's small line; null on a row. */
  hint: string | null;
  /** The label in the desk menu, where there is no tile to explain it. */
  menuLabel: string;
  menuHint?: string;
  icon: string;
  /** Shown as one of the four tiles on the phone sheet; the others are rows. */
  tile: boolean;
  tone: 'accent' | 'green' | 'blue' | 'plum' | 'grey';
}

export const HOME_ADD_ACTIONS: readonly HomeAddAction[] = [
  { id: 'photo', label: 'Bon of factuur', hint: 'foto → kost', menuLabel: 'Bon of factuur fotograferen',
    menuHint: 'Foto nemen en meteen als kost boeken', icon: 'camera', tile: true, tone: 'accent' },
  { id: 'task', label: 'Taak', hint: 'vandaag, morgen of los', menuLabel: 'Taak', icon: 'check', tile: true, tone: 'green' },
  { id: 'event', label: 'Afspraak', hint: 'met dag en uur', menuLabel: 'Afspraak', icon: 'calendar', tile: true, tone: 'blue' },
  { id: 'cost', label: 'Kost boeken', hint: 'zonder foto', menuLabel: 'Kost boeken', icon: 'receipt', tile: true, tone: 'plum' },
  { id: 'movement', label: 'Transactie noteren', hint: null, menuLabel: 'Transactie noteren', icon: 'bank', tile: false, tone: 'grey' },
  { id: 'order', label: 'Nieuwe order', hint: null, menuLabel: 'Nieuwe order', icon: 'sales', tile: false, tone: 'grey' },
  { id: 'customer', label: 'Nieuwe klant', hint: null, menuLabel: 'Nieuwe klant', icon: 'customers', tile: false, tone: 'grey' },
  { id: 'product', label: 'Nieuw product', hint: null, menuLabel: 'Nieuw product', icon: 'products', tile: false, tone: 'grey' },
];

/** The desk "+ Nieuw" menu: the same eight, camera first. */
export const HOME_ADD_MENU: readonly ContextMenuItem[] = HOME_ADD_ACTIONS.map((action) => ({
  id: action.id, label: action.menuLabel, iconName: action.icon, ...(action.menuHint ? { hint: action.menuHint } : {}),
}));

@Injectable({ providedIn: 'root' })
export class HomeAdd {
  private readonly router = inject(Router);
  private readonly intake = inject(FinanceIntake);

  /**
   * Runs an action that only navigates and returns true; false for photo,
   * task and event, which the page handles (camera input, planner sheets).
   */
  go(id: string): boolean {
    switch (id) {
      case 'cost': this.bookCost([]); return true;
      case 'movement':
        this.intake.queue({ kind: 'movement' });
        void this.router.navigate(['/costs'], { queryParams: { view: 'bank', tab: 'movements' } });
        return true;
      case 'order': void this.router.navigate(['/sales'], { queryParams: { nieuw: '1' } }); return true;
      case 'customer': void this.router.navigate(['/customers'], { queryParams: { nieuw: '1' } }); return true;
      case 'product': void this.router.navigate(['/products/new']); return true;
      default: return false;
    }
  }

  /** The camera input's change: the photo goes to Kosten & bank, which opens a blank cost with it queued. */
  photoPicked(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';
    if (files.length) this.bookCost(files);
  }

  private bookCost(files: File[]): void {
    this.intake.queue({ kind: 'cost', files });
    void this.router.navigate(['/costs'], { queryParams: { view: 'costs' } });
  }
}
