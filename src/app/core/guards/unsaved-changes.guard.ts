import { CanDeactivateFn } from '@angular/router';

export interface HasUnsavedChanges {
  canDeactivate(): boolean;
}

/** Lets an editor own the precise decision for pending local work. */
export const unsavedChangesGuard: CanDeactivateFn<HasUnsavedChanges> =
  (component) => component.canDeactivate();
