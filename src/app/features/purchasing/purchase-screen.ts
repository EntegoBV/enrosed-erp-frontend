import { ChangeDetectionStrategy, Component, inject, input, viewChild } from '@angular/core';
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
      <app-purchase-desk [id]="id()" />
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

  private readonly desk = viewChild(PurchaseDesk);
  private readonly editor = viewChild(PurchaseEditor);

  /** The open editor owns the unsaved-changes verdict; a plain view has none. */
  canDeactivate(): boolean | Promise<boolean> {
    const open = this.desk() ?? this.editor();
    return open ? open.canDeactivate() : true;
  }
}
