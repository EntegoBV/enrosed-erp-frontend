import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Auth } from '../core/api/auth';
import { WorkspaceReturn } from '../core/platform/workspace-return';
import { Icon } from './icon';

/**
 * The foot of a dark workspace sidebar (.wk-side): the way back to the ERP
 * screen the user came from, and the account. Shared by Kosten & bank and
 * Documenten & media, so both name the same place ("Terug naar
 * inkooporder") and neither hard-codes the dashboard.
 */
@Component({
  selector: 'app-wk-side-foot',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <footer class="wk-side__foot">
      <a class="wk-side__back" [attr.href]="ret.deskUrl()" [attr.aria-label]="'Terug naar ' + ret.label()"
         (click)="go($event)">
        <app-icon name="chevron-left" [size]="18" />
        <span class="wk-side__text">
          <b>Terug naar {{ ret.label() }}</b>
          <small>{{ ret.origin() ? 'Waar je vandaan kwam' : 'Verkoop & voorraad' }}</small>
        </span>
        <span class="wk-side__short">Terug</span>
      </a>
      <div class="wk-side__account">
        <span>{{ auth.username() }}</span>
        <button type="button" (click)="logout()">Afmelden</button>
      </div>
    </footer>
  `,
})
export class WkSideFoot {
  readonly auth = inject(Auth);
  readonly ret = inject(WorkspaceReturn);
  private readonly router = inject(Router);

  /** A plain click stays in the app; a modified one opens the link the browser's way. */
  go(event: MouseEvent): void {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    void this.router.navigateByUrl(this.ret.deskUrl());
  }

  logout(): void {
    this.auth.logout();
    void this.router.navigate(['/login']);
  }
}
