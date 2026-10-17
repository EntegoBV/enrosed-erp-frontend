import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { environment } from '../../../environments/environment';
import { WebsiteSyncStatus } from '../settings/website-sync-status';

/**
 * The 30 px status bar under every desk screen of Website beheren (the kit's
 * wk-statusbar): left the website status as one pill, in the middle the
 * screen's own line, right a short keyboard hint (hidden below a 1000 px
 * main) or the environment. Not aria-live: the status polls every 8 s while
 * an update runs and must not be announced each time.
 */
@Component({
  selector: 'app-website-status-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  imports: [WebsiteSyncStatus],
  template: `
    <footer class="wk-statusbar ws-statusbar">
      <app-website-sync-status variant="bar" />
      <span class="wk-statusbar__mid" [attr.title]="text() || null">{{ text() }}</span>
      @if (hint()) { <span class="ws-statusbar__hint" aria-hidden="true">{{ hint() }}</span> }
      <span class="ws-statusbar__env" [class.ws-statusbar__env--alone]="!hint()">{{ environmentName }}</span>
    </footer>
  `,
})
export class WebsiteStatusBar {
  /** The screen's own line; it never holds the only copy of a figure. */
  readonly text = input('');
  /** Keyboard hint, e.g. "↑↓ kiezen · ↵ openen · / zoeken"; the Sneltoetsen list has them too. */
  readonly hint = input('');
  readonly environmentName = environment.environmentLabel === 'TEST'
    ? 'Testomgeving'
    : environment.environmentLabel === 'LOCAL' ? 'Lokaal' : 'Productie';
}
