import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Params, RouterLink } from '@angular/router';
import { Icon } from './icon';

/** One tab of a workspace's own phone tab bar. */
export interface IosTab {
  id: string;
  label: string;
  icon: string;
  link: string | readonly unknown[];
  query?: Params | null;
  active: boolean;
  badge?: number | null;
  badgeTone?: 'danger' | 'warn';
  /** Tabs replace the history entry unless told otherwise. */
  replaceUrl?: boolean;
}

/**
 * The floating Liquid Glass tab bar of a workspace on a phone, with an
 * optional round accessory button beside it (usually '+'). The ERP tab bar
 * steps aside by itself while a page renders .ios-page (workspace-kit.scss).
 * Tab taps never build history: switching tabs and pressing back should
 * leave the workspace, not replay the tabs.
 */
@Component({
  selector: 'app-ios-tabbar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, RouterLink],
  template: `
    <nav class="ios-tabbar" [class.ios-tabbar--with-accessory]="!!accessoryIcon()" [attr.aria-label]="label()">
      @for (tab of tabs(); track tab.id) {
        <a class="ios-tab" [class.active]="tab.active" [attr.aria-current]="tab.active ? 'page' : null"
           [attr.aria-label]="tab.badge ? tab.label + ', ' + tab.badge + ' open' : null"
           [routerLink]="tab.link" [queryParams]="tab.query ?? {}" [replaceUrl]="tab.replaceUrl ?? true">
          <span class="ios-tab__icon">
            <app-icon [name]="tab.icon" [size]="22" />
            @if (tab.badge) {
              <span class="ios-tab__badge" [class.ios-tab__badge--warn]="tab.badgeTone === 'warn'">
                {{ tab.badge > 9 ? '9+' : tab.badge }}
              </span>
            }
          </span>
          <span class="ios-tab__label">{{ tab.label }}</span>
        </a>
      }
    </nav>
    @if (accessoryIcon(); as icon) {
      <button class="ios-accessory" [class.ios-accessory--glass]="accessoryTone() === 'glass'" type="button"
              [attr.aria-label]="accessoryLabel()" [disabled]="accessoryDisabled()" (click)="accessory.emit()">
        <app-icon [name]="icon" [size]="26" />
      </button>
    }
  `,
})
export class IosTabbar {
  readonly tabs = input.required<readonly IosTab[]>();
  /** The accessible name of the navigation. */
  readonly label = input.required<string>();
  readonly accessoryIcon = input<string | null>(null);
  readonly accessoryLabel = input('');
  readonly accessoryTone = input<'accent' | 'glass'>('accent');
  readonly accessoryDisabled = input(false);
  readonly accessory = output<void>();
}
