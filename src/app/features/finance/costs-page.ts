import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { WorkspaceReturn } from '../../core/platform/workspace-return';
import { ContextMenu, ContextMenuItem } from '../../shared/context-menu';
import { Icon } from '../../shared/icon';
import { IosNav } from '../../shared/ios-nav';
import { keyContext } from '../../shared/key-context';
import { Segmented, SegmentOption } from '../../shared/segmented';
import { Skeleton } from '../../shared/skeleton';
import { Sheet } from '../../shared/ui';
import { WK_DOCK_MIN_PX, elementWidth } from '../../shared/workspace-layout';
import { AccountCheckSheet } from './account-check-sheet';
import { AccountHistorySheet } from './account-history-sheet';
import { AccountantPackageSheet } from './accountant-package-sheet';
import { BankAllocationSheet } from './bank-allocation-sheet';
import { BankMovementSheet } from './bank-movement-sheet';
import { BankPanel } from './bank-panel';
import { BankSheet } from './bank-sheet';
import { ContainerPaymentsPanel } from './container-payments-panel';
import { CostAnalysis } from './cost-analysis';
import { CostList } from './cost-list';
import { CostSheet } from './cost-sheet';
import { FinanceCreateMenu } from './finance-create-menu';
import { FinanceFilters } from './finance-filters';
import { FinanceHelpSheet } from './finance-help-sheet';
import { FinanceInspector } from './finance-inspector';
import { FinanceOverview } from './finance-overview';
import { FINANCE_SECTION } from './finance-section';
import { FINANCE_SECTIONS, FINANCE_TABS, financeSection } from './finance-sections';
import { FinanceShell } from './finance-shell';
import { financeShortcut } from './finance-shortcuts';
import { FinanceState } from './finance-state';
import { FinanceStatusBar } from './finance-status-bar';
import { FinanceTabbar } from './finance-tabbar';
import { FinanceToolbar } from './finance-toolbar';
import { PayablesPanel } from './payables-panel';
import { PaySheet } from './pay-sheet';
import { ReceivablesPanel } from './receivables-panel';
import { RecurringPanel } from './recurring-panel';
import { RecurringSheet } from './recurring-sheet';

/** A quiet refresh when the page comes back after this long. */
const STALE_MS = 5 * 60_000;

/**
 * Kosten & bank: a workspace of its own. On a desk it is a desktop app
 * (dark sidebar from the shell, toolbar, strip, table, inspector, status
 * bar); on a phone an iOS 26 app (large title, glass tab bar, '+'). The
 * address carries section, segment and filters (finance-url.ts). Every
 * sheet, menu and drawer is rendered here, at page level: inside the
 * scrolling pane or a swiped row they would be trapped.
 */
@Component({
  selector: 'app-costs-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [FinanceState],
  host: { id: 'finance-workspace', '(document:keydown)': 'onKey($event)' },
  imports: [NgTemplateOutlet, Icon, IosNav, Segmented, Skeleton, Sheet, ContextMenu, FinanceToolbar, FinanceFilters, FinanceStatusBar, FinanceTabbar,
    FinanceCreateMenu, FinanceInspector, FinanceOverview, PayablesPanel, ReceivablesPanel, BankPanel, CostList, ContainerPaymentsPanel,
    RecurringPanel, CostAnalysis, CostSheet, RecurringSheet, BankSheet, BankMovementSheet, PaySheet, AccountCheckSheet,
    AccountHistorySheet, AccountantPackageSheet, FinanceHelpSheet, BankAllocationSheet],
  template: `
    @if (state.desk()) {
      <div class="wk-page fin-desk">
        <app-finance-toolbar [section]="section() ?? null" />
        <div class="wk-notices">
          @if (state.loadErrors().length) {
            <div class="wk-banner wk-banner--warn" id="fin-banner" role="alert">
              <app-icon name="alert" [size]="18" />
              <span class="wk-banner__text">Niet alles is geladen: {{ state.failedSources().join(', ') }}. Je ziet de laatst geladen gegevens.</span>
              <span class="wk-banner__actions"><button class="wk-btn wk-btn--sm" type="button" [disabled]="state.loading()" (click)="state.load()">Opnieuw</button></span>
            </div>
          }
          @if (section()?.strip(); as items) {
            <div class="wk-strip fin-strip" aria-label="Samenvatting">
              @for (item of items; track item.label) {
                <div class="wk-strip__item" [attr.title]="item.title || null">
                  <span class="wk-strip__label">{{ item.label }}</span>
                  <span class="wk-strip__value" [class.wk-amount--in]="item.tone === 'in'" [class.wk-amount--warn]="item.tone === 'warn'"
                        [class.wk-amount--muted]="item.tone === 'muted'" [class.wk-amount--strong]="item.tone === 'strong'">{{ item.value }}</span>
                </div>
              }
              <app-finance-filters class="fin-strip__tools" />
            </div>
          } @else if (hasFilters()) {
            <div class="wk-strip fin-strip"><app-finance-filters class="fin-strip__tools" /></div>
          }
        </div>
        <div class="wk-body" [class.wk-body--split]="docked() && !!state.inspect()"
             (dragenter)="dragOver($event)" (dragover)="dragOver($event)" (dragleave)="dragLeave($event)" (drop)="drop($event)">
          <div class="wk-pane" id="finance-pane">
            <div class="wk-pane__inner" [class.wk-pane__inner--read]="readView()">
              <ng-container *ngTemplateOutlet="content" />
            </div>
          </div>
          @if (docked() && state.inspect(); as target) {
            <aside class="wk-inspector" aria-label="Details"><app-finance-inspector [target]="target" /></aside>
          }
          @if (dropping()) { <div class="wk-drop">Laat los om een kost met dit document te boeken</div> }
        </div>
        <app-finance-status-bar [text]="section()?.status() ?? ''" [selected]="selectedCount()" />
      </div>
      @if (!docked() && state.inspect(); as target) {
        <aside class="wk-inspector wk-inspector--drawer fin-drawer" aria-label="Details"><app-finance-inspector [target]="target" /></aside>
      }
    } @else {
      <div class="ios-page fin-ios">
        <app-ios-nav [title]="current().label" [backLabel]="subScreen() ? '' : 'App'" [backUrl]="subScreen() ? null : ret.phoneUrl()"
                     [backAriaLabel]="subScreen() ? 'Terug' : 'Terug naar ' + ret.label()" (back)="state.leaveAnalysis()">
          <button trail class="ios-circle" type="button" aria-label="Meer" (click)="phoneMore()"><app-icon name="more" [size]="22" /></button>
          <div below class="ios-subbar" [hidden]="!phoneSegments().length">
            @if (phoneSegments().length) {
              <app-segmented variant="ios" [semantics]="state.location().view === 'analysis' ? 'radio' : 'tabs'" label="Onderdeel"
                             [options]="phoneSegments()" [value]="phoneSegmentValue()" (changed)="pickPhoneSegment($event)" />
            }
          </div>
        </app-ios-nav>
        @if (state.loadErrors().length) {
          <div class="ios-banner fin-ios-banner" role="alert">
            <span>Niet alles is geladen: {{ state.failedSources().join(', ') }}. Je ziet de laatst geladen gegevens.</span>
            <button class="ios-capsule ios-capsule--sm ios-capsule--tinted" type="button" [disabled]="state.loading()" (click)="state.load()">Opnieuw</button>
          </div>
        }
        <ng-container *ngTemplateOutlet="content" />
        <app-finance-tabbar (add)="createMenu()?.open()" />
        <app-finance-create-menu />
      </div>
    }

    <ng-template #content>
      @if (!state.loadedAt()) {
        <div class="fin-loading" aria-busy="true"><app-skeleton kind="stats" [rows]="4" /><app-skeleton kind="list" [rows]="8" /></div>
      } @else {
        @switch (state.location().view) {
          @case ('open') { <app-payables-panel /> }
          @case ('incoming') { <app-receivables-panel /> }
          @case ('bank') { <app-bank-panel /> }
          @case ('costs') {
            @switch (state.location().tab) {
              @case ('containers') { <app-container-payments-panel /> }
              @case ('recurring') { <app-recurring-panel /> }
              @default { <app-cost-list /> }
            }
          }
          @case ('analysis') { <app-cost-analysis /> }
          @default { <app-finance-overview /> }
        }
      }
    </ng-template>

    @if (!state.desk() && state.inspect(); as target) {
      <app-sheet variant="ios" [title]="state.inspectTitle(target)" (closed)="state.closeInspector()">
        <div body><app-finance-inspector [target]="target" layout="sheet" /></div>
        <div foot style="display:contents"><app-finance-inspector [target]="target" layout="foot" /></div>
      </app-sheet>
    }
    @if (state.costDraft()) { <app-cost-sheet /> }
    @if (state.recurringDraft()) { <app-recurring-sheet /> }
    @if (state.bankDraft()) { <app-bank-sheet /> }
    @if (state.movementDraft()) { <app-bank-movement-sheet /> }
    @if (state.paySheet()) { <app-pay-sheet /> }
    @if (state.accountCheck()) { <app-account-check-sheet /> }
    @if (state.historyAccount()) { <app-account-history-sheet /> }
    @if (state.packageOpen()) { <app-accountant-package-sheet /> }
    @if (state.helpOpen() || state.shortcutsOpen()) { <app-finance-help-sheet /> }
    @if (allocationPanel(); as panel) { @if (panel.selected()) { <app-bank-allocation-sheet [panel]="panel" /> } }
    @if (state.menu(); as menu) {
      <app-context-menu [items]="menu.items" [title]="menu.title ?? ''" [anchor]="menu.anchor" variant="ios" [cancelLabel]="menu.cancelLabel ?? ''"
                        (pick)="pickMenu($event)" (closed)="state.menu.set(null)" />
    }
  `,
})
export class CostsPage {
  readonly state = inject(FinanceState);
  readonly ret = inject(WorkspaceReturn);
  private readonly shell = inject(FinanceShell);
  private readonly title = inject(Title);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly section = viewChild(FINANCE_SECTION);
  private readonly bankPanel = viewChild(BankPanel);
  readonly allocationPanel = computed(() => this.bankPanel()?.movementPanel() ?? null);

  readonly current = computed(() => financeSection(this.state.location().view));
  readonly selectedCount = computed(() => this.section()?.selectedCosts?.().length ?? 0);
  private readonly width = elementWidth(() => this.host.nativeElement);
  readonly docked = computed(() => this.width() >= WK_DOCK_MIN_PX);
  readonly readView = computed(() => ['overview', 'analysis'].includes(this.state.location().view));
  readonly hasFilters = computed(() => {
    const { view, tab } = this.state.location();
    return view === 'incoming' || view === 'analysis' || (view === 'bank' && tab === 'movements') || (view === 'costs' && tab !== 'recurring');
  });
  readonly createMenu = viewChild(FinanceCreateMenu);
  readonly dropping = signal(false);

  /** Analyse is the phone's one sub-screen: pushed from Overzicht or ⋯, with a back chevron instead of '‹ App'. */
  readonly subScreen = computed(() => this.state.location().view === 'analysis');

  /** The phone's sticky segmented control: the section's segments, or the year on Analyse. */
  readonly phoneSegments = computed<SegmentOption[]>(() => {
    const view = this.state.location().view;
    if (view === 'analysis') return [{ id: '', label: 'Dit jaar' }, { id: String(Number(this.state.today().slice(0, 4)) - 1), label: 'Vorig jaar' }, { id: 'all', label: 'Alles' }];
    /* The segment behind a tab badge carries a dot, so the badge leads somewhere visible. */
    return FINANCE_TABS[view].map((tab) => ({ id: tab.id, label: tab.short, dot: this.state.segmentWarn(view, tab.id) ? 'warn' as const : null }));
  });
  readonly phoneSegmentValue = computed(() => {
    const location = this.state.location();
    return location.view === 'analysis' ? location.year : location.tab;
  });

  constructor() {
    void this.state.load();
    const destroyRef = inject(DestroyRef);

    /* A tab left open overnight moves on with the clock, and a return after a while refreshes quietly. */
    const onVisible = (): void => {
      if (document.visibilityState !== 'visible') return;
      this.state.refreshToday();
      const loaded = this.state.loadedAt();
      if (loaded && Date.now() - loaded.getTime() > STALE_MS && !this.state.loading()) void this.state.load();
    };
    const onFocus = (): void => this.state.refreshToday();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    let midnight: ReturnType<typeof setTimeout> | null = null;
    const arm = (): void => {
      const now = new Date();
      const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
      midnight = setTimeout(() => { this.state.refreshToday(); arm(); }, next.getTime() - now.getTime());
    };
    arm();
    destroyRef.onDestroy(() => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
      if (midnight) clearTimeout(midnight);
      this.shell.counts.set(null);
    });

    /* The sidebar and the tab bar read these counts; they live outside this page's injector. */
    effect(() => {
      const attention = this.state.attention();
      const totals = this.state.payableTotals();
      const count = (kind: string): number => attention.filter((item) => item.kind === kind).reduce((sum, item) => sum + item.count, 0);
      this.shell.counts.set({
        open: totals.counts.now,
        openWarn: count('overdue-costs') > 0 || count('container-due') > 0,
        incoming: count('old-receivables'),
        bank: count('unlinked-incoming') + count('account-without-reading') + count('stale-reading'),
        bankWarn: count('account-without-reading') > 0 || count('stale-reading') > 0,
        costs: count('recurring-due'),
      });
    });

    effect(() => this.title.setTitle(`Kosten & bank · ${this.current().label}`));

    /*
     * On costs/company, a cost that arrives by ?cost=<id> outside the period
     * widens it to all dates: once per id, so a period the user picks later
     * (the cost stays on the address while it is inspected) is left alone.
     */
    let widenedFor: number | null = null;
    effect(() => {
      const location = this.state.location();
      const costs = this.state.costs();
      if (location.view !== 'costs' || location.tab !== 'company' || !location.cost) {
        widenedFor = null;
        return;
      }
      if (location.cost === widenedFor) return;
      const cost = costs.find((row) => row.id === location.cost);
      if (!cost) return;
      widenedFor = location.cost;
      if (location.period === 'all') return;
      const range = untracked(() => this.state.rangeOf(location));
      if ((range.from && cost.date < range.from) || (range.to && cost.date > range.to)) {
        untracked(() => this.state.go({ period: 'all', from: '', to: '' }));
      }
    });
  }

  pickPhoneSegment(id: string): void {
    if (this.state.location().view === 'analysis') this.state.go({ year: id });
    else this.state.go({ tab: id });
  }

  phoneMore(): void {
    const loaded = this.state.loadedAt();
    this.state.openMenu({
      title: 'Kosten & bank', anchor: null, cancelLabel: 'Annuleren',
      items: [
        { id: 'refresh', label: 'Vernieuwen', iconName: 'refresh', hint: loaded ? `bijgewerkt ${this.clock(loaded)}` : undefined },
        { id: 'analysis', label: 'Analyse', iconName: 'analytics' },
        { id: 'csv', label: 'Exporteer CSV', iconName: 'download' },
        { id: 'package', label: 'Boekhouderspakket', iconName: 'archive' },
        { id: 'help', label: 'Hoe werkt je banksaldo?', iconName: 'info' },
      ],
      pick: (id) => {
        if (id === 'refresh') void this.state.load();
        else if (id === 'analysis') this.state.openAnalysis();
        else if (id === 'csv') this.exportCurrent();
        else if (id === 'package') this.state.openPackage();
        else if (id === 'help') this.state.helpOpen.set(true);
      },
    });
  }

  /** The costs on screen as CSV: the filtered list on Uitgaven, else everything of this year. */
  exportCurrent(): void {
    const section = this.section();
    if (section?.exportCsv) section.exportCsv();
    else this.state.exportThisYear();
  }

  pickMenu(item: ContextMenuItem): void {
    const menu = this.state.menu();
    this.state.menu.set(null);
    menu?.pick(item.id);
  }

  clock(date: Date): string {
    return date.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' });
  }

  focusSearch(): void {
    const input = this.host.nativeElement.querySelector<HTMLInputElement>('#fin-search');
    input?.focus();
    input?.select();
  }

  /* ------------------------------------------------------- drag and drop */

  private dropTarget(): boolean {
    const { view, tab } = this.state.location();
    return view === 'open' || (view === 'costs' && tab === 'company');
  }

  private carriesFiles(event: DragEvent): boolean {
    return !!event.dataTransfer && [...event.dataTransfer.types].includes('Files');
  }

  dragOver(event: DragEvent): void {
    if (!this.dropTarget() || !this.carriesFiles(event)) return;
    event.preventDefault();
    /* Over a cost row the row takes the file; the overlay is for empty space. */
    const overRow = event.target instanceof Element && !!event.target.closest('[data-drop-cost], .wk-inspector');
    this.dropping.set(!overRow);
  }

  dragLeave(event: DragEvent): void {
    const next = event.relatedTarget;
    if (!(next instanceof Node) || !(event.currentTarget as HTMLElement).contains(next)) this.dropping.set(false);
  }

  drop(event: DragEvent): void {
    const wasDropping = this.dropping();
    this.dropping.set(false);
    if (!this.dropTarget() || !this.carriesFiles(event)) return;
    event.preventDefault();
    const files = [...(event.dataTransfer?.files ?? [])];
    if (wasDropping && files.length) this.state.openCost(null, files);
  }

  /* ------------------------------------------------------------ keyboard */

  onKey(event: KeyboardEvent): void {
    if (!this.state.desk()) return;
    /* Enter and Space on a button, link or tab belong to that control. */
    const target = event.target instanceof Element ? event.target : null;
    if ((event.key === 'Enter' || event.key === ' ') && target?.closest('button, a[href], summary, select, [role="tab"], [role="radio"], [role="menuitem"]')) return;
    const context = keyContext(event, this.host.nativeElement);
    const command = financeShortcut({ key: event.key, code: event.code, shift: event.shiftKey, meta: event.metaKey, ctrl: event.ctrlKey, alt: event.altKey },
      { typing: context.typing, overlayOpen: context.overlayOpen, inWorkspace: context.inScope });
    if (!command) return;
    if (typeof command === 'object') {
      event.preventDefault();
      this.state.go({ view: FINANCE_SECTIONS[command.section - 1].id });
      return;
    }
    const section = this.section();
    let handled = true;
    switch (command) {
      case 'search': this.focusSearch(); break;
      case 'new-cost': this.state.openCost(null); break;
      case 'new-movement': this.state.openMovement({ accountKey: this.state.location().view === 'bank' ? this.state.location().account || undefined : undefined }); break;
      case 'refresh': void this.state.load(); break;
      case 'help': this.state.shortcutsOpen.set(true); break;
      case 'escape':
        if (!section?.handle('escape')) {
          if (this.state.inspect()) this.state.closeInspector();
          else handled = false;
        }
        break;
      default: handled = !!section?.handle(command);
    }
    if (handled) event.preventDefault();
  }
}
