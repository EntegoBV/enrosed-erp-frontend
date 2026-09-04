import { ChangeDetectionStrategy, Component, inject, input, viewChild } from '@angular/core';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { SalesDesk } from './sales-desk';
import { SalesEditor } from './sales-editor';
import { SalesView } from './sales-view';

/**
 * One route, the right screen for the room: a desk on a wide viewport,
 * the guided view and editor on a phone. The desk reads and edits in one
 * place, so both the view and the edit URL land on it there.
 */
@Component({
  selector: 'app-sales-screen',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SalesDesk, SalesEditor, SalesView],
  template: `
    @if (desktop.active()) {
      <app-sales-desk [id]="id()" />
    } @else if (mode() === 'edit') {
      <app-sales-editor [id]="id()" />
    } @else {
      <app-sales-view [id]="id()" />
    }
  `,
})
export class SalesScreen {
  readonly desktop = inject(DesktopViewport);
  readonly id = input<string>('');
  readonly mode = input<'view' | 'edit'>('view');

  private readonly desk = viewChild(SalesDesk);
  private readonly editor = viewChild(SalesEditor);

  /** The open editor owns the unsaved-changes verdict; a plain view has none. */
  canDeactivate(): boolean | Promise<boolean> {
    const open = this.desk() ?? this.editor();
    return open ? open.canDeactivate() : true;
  }
}
