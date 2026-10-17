import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { WorkspaceReturn } from '../../core/platform/workspace-return';
import { ContextMenu, ContextMenuItem } from '../../shared/context-menu';
import { Icon } from '../../shared/icon';
import { IosNav } from '../../shared/ios-nav';
import { keyContext } from '../../shared/key-context';
import { Segmented, SegmentOption } from '../../shared/segmented';
import { Skeleton } from '../../shared/skeleton';
import { Sheet } from '../../shared/ui';
import { WK_DOCK_MIN_PX, elementWidth } from '../../shared/workspace-layout';
import { capsuleLabel } from '../../core/platform/return-label';
import { AccountCheckSheet } from './account-check-sheet';
import { AccountHistorySheet } from './account-history-sheet';
import { AccountantPackageSheet } from './accountant-package-sheet';
import { BankMovementSheet } from './bank-movement-sheet';
import { ArchivedAccountsSheet, BufferSheet, ExactLinksSheet, OdooSheet, UnbankedSheet } from './bank-sheets';
import { BookAsSheet } from './book-as-sheet';
import { BankPanel } from './bank-panel';
import { BankAccountSheet } from './bank-account-sheet';
import { BankSheet } from './bank-sheet';
import { ContainerPaymentsPanel } from './container-payments-panel';
import { CostAnalysis } from './cost-analysis';
import { CostList } from './cost-list';
import { CostListsPanel } from './cost-lists-panel';
import { CostPartySheet } from './cost-party-sheet';
import { CostSheet } from './cost-sheet';
import { FairSheet } from './fair-sheet';
import { FinanceCreateMenu } from './finance-create-menu';
import { FinanceFilters } from './finance-filters';
import { FinanceHelpSheet } from './finance-help-sheet';
import { FinanceInspector } from './finance-inspector';
import { FINANCE_SECTION } from './finance-section';
import { FINANCE_NAV, FINANCE_TABS, financeNavOf, financeSection } from './finance-sections';
import { FinanceShell } from './finance-shell';
import { syncMoment } from './finance-format';
import { financeQueryParams, parseFinanceLocation } from './finance-url';
import { financeShortcut } from './finance-shortcuts';
import { FinanceState } from './finance-state';
import { FinanceStatusBar } from './finance-status-bar';
import { FinanceTabbar } from './finance-tabbar';
import { FinanceToolbar } from './finance-toolbar';
import { OdooSyncState } from './odoo-sync-state';
import { PayablesPanel } from './payables-panel';
import { PaySheet } from './pay-sheet';
import { ReceivablesPanel } from './receivables-panel';
import { RecurringPanel } from './recurring-panel';
import { RecurringSheet } from './recurring-sheet';
import { TransactionDetail } from './transaction-detail';
import { VatReturnPanel } from './vat-return-panel';

/** A quiet refresh when the page comes back after this long. */
const STALE_MS = 5 * 60_000;
/** The shortcuts of the open transaction (spec-bank-forecast §1.1): they act on the transaction shown, not on the list's focus. */
/** A transaction's detail docks beside the list from an 840 px host (1100 wide): Bedrag stays in view while linking. */
const LINE_DOCK_MIN_PX = 840;
const DETAIL_COMMANDS: ReadonlySet<string> = new Set(['split', 'book-as', 'unlink', 'open-linked', 'link']);

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
  providers: [FinanceState, OdooSyncState],
  host: { id: 'finance-workspace', '(document:keydown)': 'onKey($event)' },
  imports: [NgTemplateOutlet, Icon, IosNav, Segmented, Skeleton, Sheet, ContextMenu, FinanceToolbar, FinanceFilters, FinanceStatusBar, FinanceTabbar,
    FinanceCreateMenu, FinanceInspector, PayablesPanel, ReceivablesPanel, BankPanel, CostList, ContainerPaymentsPanel,
    RecurringPanel, CostListsPanel, CostAnalysis, VatReturnPanel, CostSheet, RecurringSheet, BankAccountSheet, BankSheet, BankMovementSheet, PaySheet, AccountCheckSheet,
    AccountHistorySheet, AccountantPackageSheet, FinanceHelpSheet, CostPartySheet, FairSheet, TransactionDetail, BookAsSheet, ExactLinksSheet, UnbankedSheet,
    ArchivedAccountsSheet, OdooSheet, BufferSheet],
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
        <div class="wk-body" [class.wk-body--split]="docked() && !!state.inspect()" [class.fin-body--line]="state.inspect()?.kind === 'line'"
             (dragenter)="dragOver($event)" (dragover)="dragOver($event)" (dragleave)="dragLeave($event)" (drop)="drop($event)">
          <div class="wk-pane" id="finance-pane">
            <div class="wk-pane__inner" [class.wk-pane__inner--read]="readView()">
              <ng-container *ngTemplateOutlet="content" />
            </div>
          </div>
          @if (docked() && state.inspect(); as target) {
            @if (target.kind === 'line') {
              <aside class="wk-inspector fin-insp-line" aria-label="Transactie"><app-transaction-detail [lineId]="target.id" [order]="lineOrder()" /></aside>
            } @else {
              <aside class="wk-inspector" aria-label="Details"><app-finance-inspector [target]="target" /></aside>
            }
          }
          @if (dropping()) { <div class="wk-drop">Laat los om een kost met dit document te boeken</div> }
        </div>
        <app-finance-status-bar [text]="section()?.status() ?? ''" [selected]="selectedCount()" />
      </div>
      @if (!docked() && state.inspect(); as target) {
        @if (target.kind === 'line') {
          <aside class="wk-inspector wk-inspector--drawer fin-drawer fin-insp-line" aria-label="Transactie"><app-transaction-detail [lineId]="target.id" [order]="lineOrder()" /></aside>
        } @else {
          <aside class="wk-inspector wk-inspector--drawer fin-drawer" aria-label="Details"><app-finance-inspector [target]="target" /></aside>
        }
      }
    } @else {
      <div class="ios-page fin-ios">
        <app-ios-nav [title]="pageTitle()" [subtitle]="phoneSubtitle()" [backLabel]="subScreen() ? 'Terug' : backCapsule()" [backUrl]="subScreen() ? null : ret.phoneUrl()"
                     [backAriaLabel]="subScreen() ? 'Terug naar vorige onderdeel' : 'Terug naar ' + backText()" (back)="backFromSection()">
          <button trail class="ios-circle fin-phone-add" type="button" aria-label="Factuur, kost of andere registratie toevoegen" (click)="createMenu()?.open()"><app-icon name="plus" [size]="22" /></button>
          <button trail class="ios-circle" type="button" aria-label="Meer opties voor Kosten en bank" (click)="phoneMore()"><app-icon name="more" [size]="22" /></button>
          <div below class="ios-subbar" [hidden]="!phoneSegments().length">
            @if (phoneSegments().length > 2) {
              <label class="fin-phone-section"><span>Toon</span>
                <select [attr.aria-label]="'Onderdeel van ' + current().label" [value]="state.location().tab" (change)="state.go({ tab: $any($event.target).value })">
                  @for (option of phoneSegments(); track option.id) { <option [value]="option.id">{{ option.label }}{{ option.dot ? ' · vraagt aandacht' : '' }}</option> }
                </select><app-icon name="chevron-down" [size]="16" />
              </label>
            } @else if (phoneSegments().length) {
              <app-segmented variant="ios" semantics="tabs" label="Onderdeel"
                             [options]="phoneSegments()" [value]="state.location().tab" (changed)="state.go({ tab: $event })" />
            }
          </div>
        </app-ios-nav>
        @if (sync.attention() && state.location().view === 'bank') {
          <button class="ios-banner fin-ios-banner fin-ios-odoo" type="button" (click)="sync.sheetOpen.set(true)">Odoo: controle nodig ›</button>
        }
        @if (state.loadErrors().length) {
          <div class="ios-banner fin-ios-banner" role="alert">
            <span>Niet alles is geladen: {{ state.failedSources().join(', ') }}. Je ziet de laatst geladen gegevens.</span>
            <button class="ios-capsule ios-capsule--sm ios-capsule--tinted" type="button" [disabled]="state.loading()" (click)="state.load()">Opnieuw</button>
          </div>
        }
        <ng-container *ngTemplateOutlet="content" />
        <app-finance-tabbar />
        <app-finance-create-menu />
      </div>
    }

    <ng-template #content>
      @if (!state.loadedAt()) {
        <!-- A skeleton per place: Bank its figures and list, Rapportage its figures and lines, the lists only rows. -->
        <div class="fin-loading" aria-busy="true">
          @switch (skeletonPlace()) {
            @case ('bank') { <app-skeleton kind="stats" [rows]="4" /><app-skeleton kind="list" [rows]="8" /> }
            @case ('analysis') { <app-skeleton kind="stats" [rows]="4" /><app-skeleton kind="lines" [rows]="6" /> }
            @default { @if (state.desk()) { <app-skeleton kind="table" [rows]="10" /> } @else { <app-skeleton kind="group" [rows]="6" /> } }
          }
        </div>
      } @else {
        @switch (state.location().view) {
          @case ('open') { <app-payables-panel /> }
          @case ('incoming') { <app-receivables-panel /> }
          @case ('costs') {
            @switch (state.location().tab) {
              @case ('containers') { <app-container-payments-panel /> }
              @case ('recurring') { <app-recurring-panel /> }
              @case ('lists') { <app-cost-lists-panel /> }
              @default { <app-cost-list /> }
            }
          }
          @case ('analysis') {
            @switch (state.location().tab) {
              @case ('vat') { <app-vat-return-panel /> }
              @default { <app-cost-analysis /> }
            }
          }
          @default { <app-bank-panel /> }
        }
      }
    </ng-template>

    @if (phoneLine(); as target) {
      <app-transaction-detail [lineId]="target.id" [order]="lineOrder()" />
    } @else if (phoneInspector(); as target) {
      <app-sheet class="fin-inspector-sheet" variant="ios" title="Details" closeLabel="Details sluiten" (closed)="state.closeInspector()">
        <div body>
          <button class="fin-inspector-back" type="button" data-initial-focus (click)="state.backInspector()"><app-icon name="chevron-left" [size]="18" /><span>{{ state.inspectorBackLabel() }}</span></button>
          <h2 class="fin-inspector-name">{{ state.inspectTitle(target) }}</h2>
          <app-finance-inspector [target]="target" layout="sheet" />
        </div>
        <div foot class="fin-inspector-actions"><app-finance-inspector [target]="target" layout="foot" /></div>
      </app-sheet>
    }
    @if (state.costDraft()) { <app-cost-sheet /> }
    @if (state.recurringDraft()) { <app-recurring-sheet /> }
    @if (state.costPartyDraft()) { <app-cost-party-sheet /> }
    @if (state.fairDraft()) { <app-fair-sheet /> }
    @if (state.bankAccountEditor(); as account) { <app-bank-account-sheet [account]="account" (closed)="state.bankAccountEditor.set(null)" /> }
    @if (state.bankDraft()) { <app-bank-sheet /> }
    @if (state.movementDraft()) { <app-bank-movement-sheet /> }
    @if (state.paySheet()) { <app-pay-sheet /> }
    @if (state.accountCheck()) { <app-account-check-sheet /> }
    @if (state.historyAccount()) { <app-account-history-sheet /> }
    @if (state.packageOpen()) { <app-accountant-package-sheet /> }
    @if (state.helpOpen() || state.shortcutsOpen()) { <app-finance-help-sheet /> }
    @if (state.bookAsLine()) { <app-book-as-sheet /> }
    @if (state.exactLinksOpen()) { <app-exact-links-sheet /> }
    @if (state.unbankedOpen()) { <app-unbanked-sheet /> }
    @if (state.archivedOpen()) { <app-archived-accounts-sheet /> }
    @if (sync.sheetOpen()) { <app-odoo-sheet /> }
    @if (state.bufferOpen()) { <app-buffer-sheet /> }
    @if (state.menu(); as menu) {
      <app-context-menu [items]="menu.items" [title]="menu.title ?? ''" [anchor]="menu.anchor" variant="ios" [cancelLabel]="menu.cancelLabel ?? ''"
                        (pick)="pickMenu($event)" (closed)="state.menu.set(null)" />
    }
  `,
})
export class CostsPage {
  readonly state = inject(FinanceState);
  readonly sync = inject(OdooSyncState);
  readonly ret = inject(WorkspaceReturn);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly shell = inject(FinanceShell);
  private readonly title = inject(Title);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly section = viewChild(FINANCE_SECTION);
  private readonly bankPanel = viewChild(BankPanel);
  /** The open transaction (desk inspector, drawer or phone sheet): S / C / U / O / L act on it, whatever list is behind it. */
  private readonly lineDetail = viewChild(TransactionDetail);
  /** The order of Transacties on screen, for "Transactie {i} van {n}" and J / K in the detail. */
  readonly lineOrder = computed(() => this.bankPanel()?.movementPanel()?.filteredLines().map((line) => line.id) ?? []);

  readonly current = computed(() => financeSection(this.state.location().view));
  readonly selectedCount = computed(() => this.section()?.selectedCosts?.().length ?? 0);
  private readonly width = elementWidth(() => this.host.nativeElement);
  /** A transaction docks from an 840 px host (1100 wide), so its amounts stay beside the list while linking; the rest from the kit's 1000. */
  readonly docked = computed(() => this.width() >= (this.state.inspect()?.kind === 'line' ? LINE_DOCK_MIN_PX : WK_DOCK_MIN_PX));
  readonly readView = computed(() => this.state.location().view === 'analysis' || (this.state.location().view === 'bank' && this.state.location().tab !== 'movements'));
  readonly hasFilters = computed(() => {
    const { view, tab } = this.state.location();
    return view === 'incoming' || view === 'analysis' || (view === 'costs' && tab !== 'recurring');
  });
  readonly createMenu = viewChild(FinanceCreateMenu);
  readonly dropping = signal(false);

  /** The place's own name (FINANCE_NAV): Bank, Transacties, Te betalen…; Transacties never takes an account's name. */
  readonly pageTitle = computed(() => financeNavOf(this.state.location()).label);
  readonly phoneSubtitle = computed(() => {
    const location = this.state.location();
    if (location.view === 'bank' && location.tab === 'movements') {
      if (location.account) return this.state.accountLabel(location.account);
      const active = this.state.accountsView();
      return active.length === 1 ? active[0].label : 'Alle rekeningen';
    }
    if (location.view === 'bank') return this.bankSub();
    return ({ open: 'Openstaande uitgaven en betaaltermijnen', incoming: 'Klantfacturen en ontvangen betalingen',
      costs: 'Facturen, uitgaven en inkooporders', analysis: 'Kosten en btw per periode' } as Record<string, string>)[location.view] ?? null;
  });
  /** Bank's sub line: "{label} opgehaald {hh:mm}" (an older import: "{d mmm}") per Odoo account, "{label} handmatig" per manual one (fits 360 px). */
  private readonly bankSub = computed(() => {
    const at = this.sync.status()?.lastSyncAt ?? null;
    const time = at ? syncMoment(at, this.state.today()) : null;
    return this.state.accountsView().map((account) => account.source === 'ODOO' ? `${account.label} ${time ? 'opgehaald ' + time : 'nog niet opgehaald'}` : `${account.label} handmatig`).join(' · ') || null;
  });
  readonly phoneInspector = computed(() => !this.state.desk() && !this.state.costDraft() && !this.state.paySheet()
    && !this.state.recurringDraft() && !this.state.menu() ? this.state.inspect() : null);
  /** A transaction opens in its own sheet on a phone (it keeps the linking state, so body and foot are one component). */
  readonly phoneLine = computed(() => { const target = this.phoneInspector(); return target?.kind === 'line' ? target : null; });
  /** The phone's way out: "‹ Dashboard" (capitalised); a label over 10 characters becomes the chevron circle, its words in the aria-label. */
  readonly backText = computed(() => { const label = this.ret.label(); return label.charAt(0).toLocaleUpperCase('nl-BE') + label.slice(1); });
  readonly backCapsule = computed(() => capsuleLabel(this.backText()));
  /** Which skeleton fits the place while it loads. */
  readonly skeletonPlace = computed(() => {
    const { view, tab } = this.state.location();
    return view === 'bank' && tab !== 'movements' ? 'bank' : view === 'analysis' ? 'analysis' : 'list';
  });
  /** Transacties is a tab on the phone, no sub-screen; Rapportage still is one. */
  readonly subScreen = computed(() => this.state.location().view === 'analysis');
  backFromSection(): void {
    this.state.leaveAnalysis();
  }

  /** The phone's sticky segmented control: the section's segments (Analyse: Kosten · Btw; its year is a chip row in the panel). */
  readonly phoneSegments = computed<SegmentOption[]>(() => {
    const view = this.state.location().view;
    if (view === 'bank') return [];
    /* The segment behind a tab badge carries a dot, so the badge leads somewhere visible. */
    return FINANCE_TABS[view].map((tab) => ({ id: tab.id, label: tab.label, dot: this.state.segmentWarn(view, tab.id) ? 'warn' as const : null }));
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
      this.shell.accounts.set([]);
    });

    /* The sidebar and the tab bar read these counts and accounts; they live outside this page's injector. */
    effect(() => {
      const attention = this.state.attention();
      const totals = this.state.payableTotals();
      const count = (kind: string): number => attention.filter((item) => item.kind === kind).reduce((sum, item) => sum + item.count, 0);
      const bank = count('account-without-reading') + count('stale-reading');
      const transactions = this.state.unlinkedIncomingCount();
      this.shell.counts.set({
        open: totals.counts.now,
        openWarn: count('overdue-costs') > 0 || count('container-due') > 0,
        incoming: count('old-receivables'),
        bank, bankWarn: bank > 0,
        transactions,
        costs: count('recurring-due'),
      });
      this.shell.accounts.set(this.state.accountsView().map((account) => {
        const unlinked = this.state.bankStatements().filter((line) => this.state.canonicalAccount(line.account) === account.account && this.state.officialBankLine(line)
          && !line.allocated && line.salesPaymentId == null).length;
        return { key: account.account, label: account.label, balanceEur: account.currentEur, ageDays: account.ageDays, unlinked, warn: unlinked > 0 };
      }));
    });

    /* One address per place: ?view=overview (and every other default or unknown value) is written back as the bare /costs. */
    const params = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
    effect(() => {
      const map = params();
      const raw: Record<string, string> = {};
      for (const key of map.keys) raw[key] = map.get(key) ?? '';
      const canonical = financeQueryParams(parseFinanceLocation((key) => map.get(key)));
      const same = (a: Record<string, string>, b: Record<string, string>): boolean => Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((key) => a[key] === b[key]);
      if (!same(raw, canonical)) untracked(() => void this.router.navigate([], { relativeTo: this.route, queryParams: canonical, replaceUrl: true }));
    });

    effect(() => this.title.setTitle(`Kosten & bank · ${this.pageTitle()}`));

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

  phoneMore(): void {
    const loaded = this.state.loadedAt();
    this.state.openMenu({
      title: 'Kosten & bank', anchor: null, cancelLabel: 'Annuleren',
      items: [
        ...(this.state.hasOdooAccounts() ? [{ id: 'sync', label: this.sync.syncing() ? 'Ophalen…' : 'Transacties ophalen', iconName: 'exchange', disabled: this.sync.busy() || !this.sync.ready() }] : []),
        { id: 'refresh', label: 'Vernieuwen', iconName: 'refresh', hint: loaded ? `bijgewerkt ${this.clock(loaded)}` : undefined },
        { id: 'analysis', label: 'Rapportage', iconName: 'analytics' },
        { id: 'csv', label: 'Exporteer CSV', iconName: 'download' },
        { id: 'package', label: 'Boekhouderspakket', iconName: 'archive' },
        { id: 'help', label: 'Hoe werkt je banksaldo?', iconName: 'info' },
        { id: 'odoo', label: 'Odoo-verbinding', iconName: 'exchange' },
        ...(this.state.archivedAccounts().length ? [{ id: 'archived', label: 'Gearchiveerde rekeningen', iconName: 'archive' }] : []),
        ...(this.state.location().view === 'bank' && this.state.location().tab === 'movements' && this.state.historicalCount() ? [{ id: 'historical', iconName: 'archive',
          label: this.state.showHistorical() ? 'Eerdere registraties verbergen' : `Eerdere registraties tonen (${this.state.historicalCount()})` }] : []),
      ],
      pick: (id) => {
        if (id === 'sync') void this.sync.syncBank();
        else if (id === 'refresh') void this.state.load();
        else if (id === 'analysis') this.state.openAnalysis();
        else if (id === 'csv') this.exportCurrent();
        else if (id === 'package') this.state.openPackage();
        else if (id === 'help') this.state.helpOpen.set(true);
        else if (id === 'odoo') this.sync.sheetOpen.set(true);
        else if (id === 'archived') this.state.archivedOpen.set(true);
        else if (id === 'historical') this.state.showHistorical.set(!this.state.showHistorical());
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
    const location = this.state.location();
    const transactions = (location.view === 'bank' && location.tab === 'movements') || this.state.inspect()?.kind === 'line';
    const command = financeShortcut({ key: event.key, code: event.code, shift: event.shiftKey, meta: event.metaKey, ctrl: event.ctrlKey, alt: event.altKey },
      { typing: context.typing, overlayOpen: context.overlayOpen, inWorkspace: context.inScope, transactions });
    if (!command) return;
    if (typeof command === 'object') {
      event.preventDefault();
      const target = FINANCE_NAV[command.section - 1].target;
      this.state.go({ view: target.view, tab: target.tab });
      return;
    }
    const section = this.section();
    let handled = true;
    switch (command) {
      case 'search': this.focusSearch(); break;
      case 'new-cost': this.state.openCost(null); break;
      case 'new-movement':
        if (this.state.manualAccountOptions().length) this.state.openMovement({ accountKey: this.state.location().view === 'bank' ? this.state.location().account || undefined : undefined });
        else this.state.noteOnOdoo();
        break;
      case 'refresh': void this.state.load(); break;
      case 'help': this.state.shortcutsOpen.set(true); break;
      case 'escape':
        if (!section?.handle('escape')) {
          if (this.state.inspect()) this.state.closeInspector();
          else handled = false;
        }
        break;
      default: {
        const detail = this.state.inspect()?.kind === 'line' && DETAIL_COMMANDS.has(command) ? this.lineDetail() : undefined;
        handled = detail ? detail.handle(command) : !!section?.handle(command);
      }
    }
    if (handled) event.preventDefault();
  }
}
