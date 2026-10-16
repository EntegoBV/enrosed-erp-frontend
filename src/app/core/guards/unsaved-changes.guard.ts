import { CanDeactivateFn } from '@angular/router';

export interface HasUnsavedChanges {
  /** True to leave; a Promise lets the screen ask first (see confirmLeave in shared/ui.ts). */
  canDeactivate(): boolean | Promise<boolean>;
}

/** Lets an editor own the precise decision for pending local work. */
export const unsavedChangesGuard: CanDeactivateFn<HasUnsavedChanges> =
  (component) => component.canDeactivate();
