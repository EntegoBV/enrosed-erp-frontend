import { ChangeDetectionStrategy, Component, effect, inject, input, untracked, viewChild } from '@angular/core';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { PurchaseDesk } from './purchase-desk';
import { PurchaseEditor } from './purchase-editor';
import { PurchaseView } from './purchase-view';

/**
 * One route, the right screen for the room: a desk on a wide viewport,
 * the guided view and editor on a phone. The desk reads and edits in one
 * place, so both the view and the edit URL land on it there.
 */
@Component({
  selector: 'app-purchase-screen',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PurchaseDesk, PurchaseEditor, PurchaseView],
  template: `
    @if (desktop.active()) {
      <app-purchase-desk [id]="id()" [mode]="mode()" />
    } @else if (mode() === 'edit') {
      <app-purchase-editor [id]="id()" />
    } @else {
      <app-purchase-view [id]="id()" />
    }
  `,
})
export class PurchaseScreen {
  readonly desktop = inject(DesktopViewport);
  readonly id = input<string>('');
  readonly mode = input<'view' | 'edit'>('view');
  /** Bound from the route query so a pending term opens its financing schedule. */
  readonly section = input<string>();

  private readonly desk = viewChild(PurchaseDesk);
  private readonly editor = viewChild(PurchaseEditor);
  private readonly viewer = viewChild(PurchaseView);
  private openedPaymentsFor: object | null = null;
  private openedPaymentsId = '';

  constructor() {
    effect(() => {
      const section = this.section();
      const id = this.id();
      const desk = this.desk();
      const screen = desk ?? this.editor() ?? this.viewer();
      if (section !== 'payments') {
        this.openedPaymentsFor = null;
        return;
      }
      if (!screen || screen.view()?.order.id !== Number(id)
        || (this.openedPaymentsFor === screen && this.openedPaymentsId === id)) return;
      this.openedPaymentsFor = screen;
      this.openedPaymentsId = id;
      untracked(() => {
        if (desk) desk.railTab.set('pay');
        else screen.jumpToSection('purchase-payments-section');
      });
    });
  }

  /** The open editor owns the unsaved-changes verdict; a plain view has none. */
  canDeactivate(): boolean | Promise<boolean> {
    const open = this.desk() ?? this.editor();
    return open ? open.canDeactivate() : true;
  }
}
