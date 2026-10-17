import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { WebsiteNavPanel } from './website-nav-panel';

/**
 * The shell's entry for Website beheren (app.ts renders it on /website*).
 * It stays tiny on purpose: the side, the phone tab bar, the workspace
 * store and the workspace CSS load with the website, not with every ERP
 * screen. Until they arrive a desk shows the empty dark side, so the page
 * does not jump sideways.
 */
@Component({
  selector: 'app-website-admin-nav',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  imports: [WebsiteNavPanel],
  template: `
    @defer (on immediate) {
      <app-website-nav-panel />
    } @placeholder {
      @if (desk.active()) { <aside class="wk-side" aria-hidden="true"></aside> }
    }
  `,
})
export class WebsiteAdminNav {
  readonly desk = inject(DesktopViewport);
}
