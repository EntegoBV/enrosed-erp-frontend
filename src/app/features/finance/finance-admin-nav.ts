import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map } from 'rxjs';
import { BrandMark } from '../../shared/brand-mark';
import { Icon } from '../../shared/icon';
import { WkSideFoot } from '../../shared/wk-side-foot';
import { FINANCE_GROUPS, FINANCE_SECTIONS, FinanceView } from './finance-sections';
import { FinanceShell } from './finance-shell';
import { financeQueryParams, parseFinanceLocation, patchLocation, DEFAULT_LOCATION } from './finance-url';

/**
 * The dark sidebar of Kosten & bank on a desk (a rail from 680 to 899px),
 * rendered by the app shell outside the page's FinanceState: it reads the
 * section from the address and the counts from FinanceShell. Sections are
 * places, not history: the links replace the entry.
 */
@Component({
  selector: 'app-finance-admin-nav',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  imports: [BrandMark, Icon, RouterLink, WkSideFoot],
  template: `
    <aside class="wk-side" aria-label="Kosten en bank">
      <header class="wk-side__brand"><app-brand-mark subtitle="Kosten & bank" /></header>
      <nav class="wk-side__nav" aria-label="Onderdelen van Kosten en bank">
        @for (group of groups; track group) {
          <span class="wk-side__label">{{ group }}</span>
          @for (section of sectionsOf(group); track section.id) {
            <a class="wk-side__item" routerLink="/costs" [queryParams]="queryOf(section.id)" [replaceUrl]="true" [title]="section.hint"
               [class.active]="view() === section.id" [attr.aria-current]="view() === section.id ? 'page' : null"
               [attr.aria-label]="countOf(section.id) ? section.label + ', ' + countOf(section.id) + ' open' : null">
              <app-icon [name]="section.icon" [size]="18" />
              <span class="wk-side__text">{{ section.label }}</span><span class="wk-side__short">{{ section.short }}</span>
              @if (countOf(section.id); as count) {
                <span class="wk-side__count" [class.wk-side__count--warn]="warnOf(section.id)">{{ count }}</span>
                <i class="wk-side__dot" [class.wk-side__dot--warn]="warnOf(section.id)" aria-hidden="true"></i>
              }
            </a>
          }
        }
      </nav>
      <app-wk-side-foot />
    </aside>
  `,
})
export class FinanceAdminNav {
  private readonly router = inject(Router);
  private readonly shell = inject(FinanceShell);
  readonly groups = FINANCE_GROUPS;

  private readonly url = toSignal(this.router.events.pipe(
    filter((event): event is NavigationEnd => event instanceof NavigationEnd),
    map(() => this.router.url),
  ), { initialValue: this.router.url });

  readonly view = computed(() => {
    const params = new URLSearchParams(this.url().split('?')[1] ?? '');
    return parseFinanceLocation((key) => params.get(key)).view;
  });

  sectionsOf(group: string) {
    return FINANCE_SECTIONS.filter((section) => section.group === group);
  }

  queryOf(view: FinanceView): Record<string, string> {
    return financeQueryParams(patchLocation(DEFAULT_LOCATION, { view }));
  }

  countOf(view: FinanceView): number {
    const counts = this.shell.counts();
    if (!counts) return 0;
    return view === 'open' ? counts.open : view === 'incoming' ? counts.incoming : view === 'bank' ? counts.bank : view === 'costs' ? counts.costs : 0;
  }

  warnOf(view: FinanceView): boolean {
    const counts = this.shell.counts();
    return view === 'open' ? !!counts?.openWarn : view === 'bank' ? !!counts?.bankWarn : false;
  }
}
