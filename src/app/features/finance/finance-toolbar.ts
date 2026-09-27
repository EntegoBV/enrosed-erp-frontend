import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { ContextMenuItem } from '../../shared/context-menu';
import { Icon } from '../../shared/icon';
import { EurPipe } from '../../shared/pipes';
import { Segmented, SegmentOption } from '../../shared/segmented';
import { elementWidth } from '../../shared/workspace-layout';
import { categoryChoices } from './cost-categories';
import { inclOf } from './finance-metrics';
import { FinanceSectionApi } from './finance-section';
import { FINANCE_TABS, financeSection } from './finance-sections';
import { FinanceState } from './finance-state';

type CreateKind = 'cost' | 'cost-file' | 'movement' | 'balance' | 'recurring';

/**
 * The desk toolbar: section title and segments on the left; search, ⋯,
 * refresh and the 'Nieuw' split on the right. With costs selected it turns
 * into the selection toolbar with the bulk actions, the way a mail app does.
 * It measures itself: below 980px the segments lose their counts and take
 * their short labels and 'Nieuw' shows only its '+'; below 900px the title
 * steps aside (the sidebar marks the section), so nothing slides under the tools.
 */
@Component({
  selector: 'app-finance-toolbar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  imports: [Icon, EurPipe, Segmented],
  template: `
    <header #bar class="wk-toolbar fin-toolbar" [class.wk-toolbar--selection]="selecting()">
      @if (selecting()) {
        <div class="wk-toolbar__lead">
          <span class="wk-toolbar__count">{{ selected().length }} geselecteerd · {{ selectedIncl() | eur }} incl. btw</span>
        </div>
        <div class="wk-toolbar__tools">
          <button class="wk-btn wk-btn--primary" type="button" [disabled]="state.busy()" (click)="state.openPay(selected())">Betaald zetten…</button>
          <button class="wk-btn" type="button" [disabled]="state.busy()" (click)="pickCategory($event)"><app-icon name="tag" [size]="16" />Categorie…</button>
          <button class="wk-btn" type="button" [disabled]="state.busy()" (click)="state.downloadDocuments(selected())"><app-icon name="clip" [size]="16" />Documenten (zip)</button>
          <button class="wk-btn" type="button" (click)="exportSelection()"><app-icon name="download" [size]="16" />Exporteer</button>
          <button class="wk-btn wk-btn--danger" type="button" [disabled]="state.busy()" (click)="state.deleteCosts(selected())"><app-icon name="trash" [size]="16" />Verwijderen</button>
          <span class="wk-toolbar__divider"></span>
          <button class="wk-btn wk-btn--ghost wk-btn--icon" type="button" aria-label="Selectie opheffen" title="Selectie opheffen" (click)="section()?.clearSelection?.()"><app-icon name="close" [size]="16" /></button>
        </div>
      } @else {
        <div class="wk-toolbar__lead">
          <h1 class="wk-toolbar__title fin-toolbar__title" [class.fin-sr]="tight()">{{ title() }}</h1>
          @if (segments().length) {
            <app-segmented label="Onderdeel" semantics="tabs" controls="finance-pane" [options]="segments()" [value]="state.location().tab" (changed)="state.go({ tab: $event })" />
          }
        </div>
        <div class="wk-toolbar__tools">
          @if (searchable()) {
            <label class="wk-search wk-search--collapsible">
              <app-icon name="search" [size]="16" />
              <input id="fin-search" type="search" placeholder="Zoeken" aria-label="Zoeken" autocomplete="off" [value]="query()"
                     (input)="typed($any($event.target).value)" (keydown.escape)="clearSearch($event)" />
              <button class="wk-search__clear" type="button" aria-label="Zoekterm wissen" (click)="typed('')"><app-icon name="close" [size]="14" /></button>
            </label>
          }
          @if (state.location().view === 'bank') {
            <button class="wk-btn wk-btn--ghost wk-btn--icon" type="button" aria-label="Hoe werkt je banksaldo?" title="Hoe werkt je banksaldo?" (click)="state.helpOpen.set(true)"><app-icon name="info" [size]="18" /></button>
          }
          <button class="wk-btn wk-btn--ghost wk-btn--icon" type="button" aria-label="Meer" title="Meer" (click)="more($event)"><app-icon name="more" [size]="18" /></button>
          <button class="wk-btn wk-btn--ghost wk-btn--icon" type="button" [class.is-busy]="state.loading()" [disabled]="state.loading()"
                  aria-label="Vernieuwen" [title]="refreshTitle()" (click)="state.load()"><app-icon name="refresh" [size]="18" /></button>
          <span class="wk-split">
            <button class="wk-btn wk-btn--primary" type="button" [attr.aria-label]="compact() ? primary().label : null" [attr.title]="compact() ? primary().label : null"
                    (click)="create(primary().kind)"><app-icon name="plus" [size]="16" />@if (!compact()) { {{ primary().label }} }</button>
            <button class="wk-btn wk-btn--primary" type="button" aria-label="Iets anders toevoegen" title="Nieuw" (click)="newMenu($event)"><app-icon name="chevron-down" [size]="16" /></button>
          </span>
          <input #picker class="fin-hidden" type="file" multiple accept="application/pdf,image/*,.doc,.docx,.xls,.xlsx,.txt" tabindex="-1" aria-hidden="true"
                 (change)="picked($event)" />
        </div>
      }
    </header>
  `,
})
export class FinanceToolbar {
  readonly state = inject(FinanceState);
  readonly section = input<FinanceSectionApi | null>(null);
  private readonly picker = viewChild<ElementRef<HTMLInputElement>>('picker');
  private readonly bar = viewChild<ElementRef<HTMLElement>>('bar');
  private readonly width = elementWidth(() => this.bar()?.nativeElement);
  readonly compact = computed(() => this.width() > 0 && this.width() < 980);
  readonly tight = computed(() => this.width() > 0 && this.width() < 900);

  readonly title = computed(() => financeSection(this.state.location().view).label);
  readonly selected = computed(() => this.section()?.selectedCosts?.() ?? []);
  readonly selecting = computed(() => !!this.section()?.selecting?.() && this.selected().length > 0);
  readonly selectedIncl = computed(() => Math.round(this.selected().reduce((sum, cost) => sum + inclOf(cost) * 100, 0)) / 100);

  /** Counts on Te betalen; a warn dot (and its count) where a sidebar badge points: Vaste kosten due, lines to link. */
  readonly segments = computed<SegmentOption[]>(() => {
    const { view } = this.state.location();
    const compact = this.compact();
    const counts = view === 'open' && !compact ? this.payableCounts() : null;
    return FINANCE_TABS[view].map((tab) => {
      const warn = this.state.segmentWarn(view, tab.id);
      return {
        id: tab.id, label: compact ? tab.short : tab.label, shortLabel: !compact && tab.short !== tab.label ? tab.short : undefined,
        count: compact ? null : warn || (counts ? counts[tab.id] ?? null : null), dot: warn ? 'warn' as const : null,
      };
    });
  });
  private readonly payableCounts = computed<Record<string, number>>(() => {
    const rows = this.state.payables();
    return { all: rows.length, costs: rows.filter((row) => row.kind === 'cost').length,
      containers: rows.filter((row) => row.kind === 'container').length, recurring: rows.filter((row) => row.kind === 'recurring').length };
  });

  readonly searchable = computed(() => {
    const { view, tab } = this.state.location();
    return view === 'open' || view === 'incoming' || (view === 'bank' && tab === 'movements') || (view === 'costs' && tab !== 'recurring');
  });

  /** What 'Nieuw' does without opening its menu, per section. */
  readonly primary = computed<{ kind: CreateKind; label: string }>(() => {
    const { view, tab } = this.state.location();
    if (view === 'incoming' || (view === 'bank' && tab === 'movements')) return { kind: 'movement', label: 'Bankbeweging noteren' };
    if (view === 'bank') return { kind: 'balance', label: 'Saldo invullen' };
    if (view === 'costs' && tab === 'recurring') return { kind: 'recurring', label: 'Vaste kost instellen' };
    return { kind: 'cost', label: 'Kost boeken' };
  });

  readonly refreshTitle = computed(() => {
    const loaded = this.state.loadedAt();
    return loaded ? `Bijgewerkt om ${loaded.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })}` : 'Vernieuwen';
  });

  /* The search field writes the address 400 ms after the last key. */
  readonly query = signal(this.state.location().q);
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    /* The field follows the address; a search still typing is dropped when the section changes. */
    let section = '';
    effect(() => {
      const { q, view, tab } = this.state.location();
      untracked(() => {
        if (`${view}/${tab}` !== section) {
          section = `${view}/${tab}`;
          if (this.timer) { clearTimeout(this.timer); this.timer = null; }
        }
        if (!this.timer && q !== this.query()) this.query.set(q);
      });
    });
    inject(DestroyRef).onDestroy(() => { if (this.timer) clearTimeout(this.timer); });
  }

  typed(value: string): void {
    this.query.set(value);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.state.location().q !== value) this.state.go({ q: value });
    }, 400);
  }

  clearSearch(event: Event): void {
    if (!this.query()) return;
    event.stopPropagation();
    this.typed('');
  }

  create(kind: CreateKind): void {
    const location = this.state.location();
    if (kind === 'cost') this.state.openCost(null);
    else if (kind === 'cost-file') this.picker()?.nativeElement.click();
    else if (kind === 'movement') this.state.openMovement({ accountKey: location.view === 'bank' ? location.account || undefined : undefined });
    else if (kind === 'balance') this.state.openBank(null);
    else this.state.openRecurring(null);
  }

  picked(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';
    if (files.length) this.state.openCost(null, files);
  }

  newMenu(event: MouseEvent): void {
    const items: ContextMenuItem[] = [
      { id: 'cost', label: 'Kost boeken', hint: 'N', iconName: 'receipt' },
      { id: 'cost-file', label: 'Kost met document…', iconName: 'clip' },
      { id: 'movement', label: 'Bankbeweging noteren', hint: 'B', iconName: 'bank' },
      { id: 'balance', label: 'Saldo invullen', iconName: 'pencil' },
      { id: 'recurring', label: 'Vaste kost instellen', iconName: 'repeat' },
    ];
    this.state.openMenu({ title: 'Nieuw', items, anchor: this.anchorOf(event), pick: (id) => this.create(id as CreateKind) });
  }

  more(event: MouseEvent): void {
    this.state.openMenu({
      title: 'Kosten & bank', anchor: this.anchorOf(event),
      items: [
        { id: 'csv', label: 'Exporteer CSV', iconName: 'download' },
        { id: 'package', label: 'Boekhouderspakket…', iconName: 'archive' },
        { id: 'keys', label: 'Sneltoetsen', hint: '?', iconName: 'list' },
      ],
      pick: (id) => {
        if (id === 'csv') this.section()?.exportCsv ? this.section()!.exportCsv!() : this.state.exportThisYear();
        else if (id === 'package') this.state.openPackage();
        else this.state.shortcutsOpen.set(true);
      },
    });
  }

  pickCategory(event: MouseEvent): void {
    const costs = this.selected();
    const choices = categoryChoices(this.state.costs().map((cost) => cost.category));
    this.state.openMenu({
      title: 'Categorie', anchor: this.anchorOf(event),
      items: choices.map((choice) => ({ id: choice.code, label: choice.label, checked: costs.every((cost) => cost.category.toUpperCase() === choice.code) })),
      pick: (code) => void this.state.setCategory(costs, code),
    });
  }

  exportSelection(): void {
    const ids = new Set(this.selected().map((cost) => cost.id));
    this.state.exportCsv(this.state.ledger().filter((row) => !!row.cost && ids.has(row.cost.id)), `kosten-selectie-${this.state.today()}.csv`);
  }

  private anchorOf(event: MouseEvent): { x: number; y: number } {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: rect.left, y: rect.bottom + 6 };
  }
}
