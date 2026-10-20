import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, linkedSignal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { NavigationStart, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { Icon } from '../../shared/icon';
import { Segmented } from '../../shared/segmented';
import { Sheet } from '../../shared/ui';
import { eur, eurWhole } from '../finance/cash-format';
import { dayMonth } from './analyses-words';
import { AnDrillHost } from './drill-host';
import type { DrillCell, DrillColumn, DrillFormat, DrillLink, DrillRow, DrillView } from './drill-model';
import { drillTable, linkKind, nextSort, phoneParts } from './drill-table';
import type { DrillSort } from './drill-table';

const NBSP = ' ';
const MINUS = '−';
const INT = new Intl.NumberFormat('nl-BE', { maximumFractionDigits: 0 });
const RATE = new Intl.NumberFormat('nl-BE', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const PCT = new Intl.NumberFormat('nl-BE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** A signed amount with its own sign word: '+ € 1.234', '− € 1.234'. */
function signed(text: string, value: number): string {
  return Math.round(value) > 0 ? `+ ${text}` : text;
}

/**
 * The one Analyses drill-down (design/analyses2/design.md §A.2): what a click on a figure opens. AnalysesPage renders
 * it once, at page level; any tab opens it through AnDrillHost. Desk: the wide dialog of the Sheet with a kit table
 * (sortable headers, group rows, the gap and the total that equal the figure). Phone: the iOS sheet with inset cells.
 * It closes on a row or foot click, on a navigation to another screen and when the page goes; it is never restored
 * after Back. Styles: styles/analyses-drill.scss (no styles array).
 */
@Component({
  selector: 'app-an-drill',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, NgTemplateOutlet, RouterLink, Segmented, Sheet],
  template: `
    @if (view(); as view) {
      @let t = table()!;
      <app-sheet [title]="view.title" [wide]="desk.active()" [variant]="desk.active() ? 'default' : 'ios'" (closed)="host.close()">
        <div body class="and" [class.and--phone]="!desk.active()">
          <p class="and__scope" [class.ios-caption]="!desk.active()">{{ view.scope }}</p>
          @if (view.summary) { <p class="and__summary">{{ view.summary }}</p> }
          @if (segments().length > 1) {
            <app-segmented class="and__seg" label="Weergave" semantics="tabs" [variant]="desk.active() ? 'desk' : 'ios'"
                           [options]="segments()" [value]="activeId()" (changed)="pickView($event)" />
          }
          @if (!view.rows.length) {
            <p class="and__empty">{{ view.empty }}</p>
          } @else if (desk.active()) {
            <div class="wk-table and__table" role="table" [attr.aria-label]="view.title" [style.--wk-cols]="t.tracks" (keydown)="rowKey($event)">
              <div class="wk-thead" role="row">
                @for (column of t.columns; track column.key) {
                  <span class="wk-th" [class.wk-th--num]="column.numeric" role="columnheader" [attr.aria-sort]="ariaSort(column.key)">
                    <button class="wk-th__btn" type="button" (click)="sortBy(column)">{{ column.label }}
                      @if (ariaSort(column.key); as dir) { <app-icon [name]="dir === 'ascending' ? 'chevron-up' : 'chevron-down'" [size]="12" /> }</button>
                  </span>
                }
              </div>
              @for (section of t.sections; track section.key) {
                @if (section.group) {
                  @let sum = section.sums[t.valueColumn];
                  <div class="wk-group" role="row" [style.--wk-group-span]="sum === undefined ? -1 : -2">
                    <span class="wk-group__label" role="cell">{{ section.group.label }} <span class="wk-group__count">{{ count(section.rows.length) }}</span></span>
                    @if (sum !== undefined) { <span class="wk-td wk-td--num" role="cell">{{ money(sum, view) }}</span> }
                  </div>
                }
                @for (row of section.rows; track row.key) {
                  @switch (kind(row.link)) {
                    @case ('route') {
                      @let to = route(row.link)!;
                      <a class="wk-tr wk-tr--link" role="row" [routerLink]="to.path" [queryParams]="to.query ?? null" (click)="host.close()">
                        @for (column of t.columns; track column.key; let first = $first) { <ng-container [ngTemplateOutlet]="cell" [ngTemplateOutletContext]="{ $implicit: row, column, first }" /> }
                      </a>
                    }
                    @case ('href') {
                      <a class="wk-tr wk-tr--link" role="row" [href]="href(row.link)" target="_blank" rel="noopener" (click)="host.close()">
                        @for (column of t.columns; track column.key; let first = $first) { <ng-container [ngTemplateOutlet]="cell" [ngTemplateOutletContext]="{ $implicit: row, column, first }" /> }
                      </a>
                    }
                    @case ('run') {
                      <button class="wk-tr wk-tr--link and__btn" type="button" role="row" (click)="follow(row.link)">
                        @for (column of t.columns; track column.key; let first = $first) { <ng-container [ngTemplateOutlet]="cell" [ngTemplateOutletContext]="{ $implicit: row, column, first }" /> }
                      </button>
                    }
                    @default {
                      <div class="wk-tr" role="row">
                        @for (column of t.columns; track column.key; let first = $first) { <ng-container [ngTemplateOutlet]="cell" [ngTemplateOutletContext]="{ $implicit: row, column, first }" /> }
                      </div>
                    }
                  }
                }
              }
              @if (t.gap; as gap) {
                <div class="wk-tr wk-tr--muted and__gap" role="row">
                  @for (column of t.columns; track column.key; let first = $first) {
                    <span class="wk-td" [class.wk-td--num]="column.numeric && !first" role="cell">{{ first ? labelled(gap.label, gap.value, gap.format, t.valueColumn) : column.key === t.valueColumn ? format(gap.value, gap.format) : '' }}</span>
                  }
                </div>
              }
              @if (t.total; as total) {
                <div class="wk-tr wk-tr--total" role="row">
                  @for (column of t.columns; track column.key; let first = $first) {
                    <span class="wk-td" [class.wk-td--num]="column.numeric && !first" role="cell">{{ first ? labelled(total.label, total.value, total.format, t.valueColumn)
                      : column.key === t.valueColumn ? format(total.value, total.format)
                      : total.sums[column.key] !== undefined ? format(total.sums[column.key], column.format) : '' }}</span>
                  }
                </div>
              }
            </div>
          } @else {
            @let parts = phone();
            @for (section of t.sections; track section.key) {
              <div class="ios-section">
                @if (section.group) {
                  <div class="ios-section__head"><h3 class="ios-section__title">{{ section.group.label }}</h3>
                    @if (section.sums[t.valueColumn] !== undefined) { <span class="ios-section__trail">{{ money(section.sums[t.valueColumn], view) }}</span> }</div>
                }
                <div class="ios-group">
                  @for (row of section.rows; track row.key) {
                    @switch (kind(row.link)) {
                      @case ('route') {
                        @let to = route(row.link)!;
                        <a class="ios-cell" [routerLink]="to.path" [queryParams]="to.query ?? null" (click)="host.close()">
                          <ng-container [ngTemplateOutlet]="phoneCell" [ngTemplateOutletContext]="{ $implicit: row, parts, linked: true }" /></a>
                      }
                      @case ('href') {
                        <a class="ios-cell" [href]="href(row.link)" target="_blank" rel="noopener" (click)="host.close()">
                          <ng-container [ngTemplateOutlet]="phoneCell" [ngTemplateOutletContext]="{ $implicit: row, parts, linked: true }" /></a>
                      }
                      @case ('run') {
                        <button class="ios-cell" type="button" (click)="follow(row.link)">
                          <ng-container [ngTemplateOutlet]="phoneCell" [ngTemplateOutletContext]="{ $implicit: row, parts, linked: true }" /></button>
                      }
                      @default {
                        <div class="ios-cell"><ng-container [ngTemplateOutlet]="phoneCell" [ngTemplateOutletContext]="{ $implicit: row, parts, linked: false }" /></div>
                      }
                    }
                  }
                </div>
              </div>
            }
            @if (t.gap || t.total) {
              <div class="ios-group and__totals">
                @if (t.gap; as gap) {
                  <div class="ios-cell and__gap"><span class="ios-cell__body"><span class="ios-cell__title">{{ gap.label }}</span></span>
                    <span class="ios-cell__value">{{ format(gap.value, gap.format) }}</span></div>
                }
                @if (t.total; as total) {
                  <div class="ios-cell and__total"><span class="ios-cell__body"><span class="ios-cell__title">{{ total.label }}</span>
                    @if (totalSub(); as sub) { <span class="ios-cell__sub">{{ sub }}</span> }</span>
                    <span class="ios-cell__value ios-cell__value--strong">{{ format(total.value, total.format) }}</span></div>
                }
              </div>
            }
          }
          @if (view.note) { <p class="and__note">{{ view.note }}</p> }
          @if (!desk.active() && view.foot; as foot) {
            @switch (kind(foot.link)) {
              @case ('route') {
                @let to = route(foot.link)!;
                <a class="ios-capsule ios-capsule--accent ios-capsule--block and__foot" [routerLink]="to.path" [queryParams]="to.query ?? null" (click)="host.close()">{{ foot.label }}</a>
              }
              @case ('href') { <a class="ios-capsule ios-capsule--accent ios-capsule--block and__foot" [href]="href(foot.link)" target="_blank" rel="noopener" (click)="host.close()">{{ foot.label }}</a> }
              @default { <button class="ios-capsule ios-capsule--accent ios-capsule--block and__foot" type="button" (click)="follow(foot.link)">{{ foot.label }}</button> }
            }
          }
        </div>
        <!-- One root element per block, so each is projected into the Sheet's foot. -->
        @if (footRoute(); as to) {
          <a foot class="wk-btn" [routerLink]="to.path" [queryParams]="to.query ?? null" (click)="host.close()">{{ deskFoot()?.label }}</a>
        }
        @if (footHref(); as url) {
          <a foot class="wk-btn" [href]="url" target="_blank" rel="noopener" (click)="host.close()">{{ deskFoot()?.label }}</a>
        }
        @if (footRun()) {
          <button foot class="wk-btn" type="button" (click)="follow(deskFoot()?.link)">{{ deskFoot()?.label }}</button>
        }
      </app-sheet>
    }

    <ng-template #cell let-row let-column="column" let-first="first">
      <span class="wk-td" [class.wk-td--num]="column.numeric" role="cell" [class]="column.key === table()?.valueColumn ? toneClass(row) : ''"
        >{{ text(row.cells[column.key], column.format) }}@if (first && row.pill) { <span class="wk-pill and__pill">{{ row.pill }}</span> }</span>
    </ng-template>

    <ng-template #phoneCell let-row let-parts="parts" let-linked="linked">
      <span class="ios-cell__body">
        <span class="ios-cell__title">{{ parts.title ? text(row.cells[parts.title], formatOf(parts.title)) : '' }}@if (row.pill) { <span class="wk-pill and__pill">{{ row.pill }}</span> }</span>
        @if (subOf(row, parts.subs); as sub) { <span class="ios-cell__sub">{{ sub }}</span> }
      </span>
      @if (parts.value) { <span class="ios-cell__value" [class]="toneClass(row)">{{ text(row.cells[parts.value], formatOf(parts.value)) }}</span> }
      @if (linked) { <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" /> }
    </ng-template>
  `,
})
export class AnDrill {
  readonly host = inject(AnDrillHost);
  readonly desk = inject(DesktopViewport);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  /** Day cells carry ISO days; they read "3 nov", with the year when it is not this one. */
  private readonly year = String(new Date().getFullYear());

  /** The view on screen: the active segment of the open drill-down. */
  readonly view = computed<DrillView | null>(() => {
    const views = this.host.views();
    return views ? views[this.host.active()] ?? views[0] ?? null : null;
  });
  /** A header click's sort; every other view starts in its own sort again. */
  private readonly picked = linkedSignal<DrillView | null, DrillSort | null>({ source: this.view, computation: () => null });
  readonly sort = computed<DrillSort | null>(() => this.picked() ?? this.view()?.sort ?? null);
  readonly table = computed(() => {
    const view = this.view();
    return view ? drillTable(view, this.sort() ?? view.sort) : null;
  });
  readonly phone = computed(() => { const view = this.view(); return view ? phoneParts(view) : { title: null, subs: [], value: null }; });
  readonly segments = computed(() => (this.host.views() ?? []).map((view, index) => ({ id: String(index), label: view.tab ?? view.title })));
  readonly activeId = computed(() => String(this.host.active()));
  readonly deskFoot = computed(() => this.desk.active() ? this.view()?.foot ?? null : null);
  readonly footRoute = computed(() => this.route(this.deskFoot()?.link));
  readonly footHref = computed(() => this.href(this.deskFoot()?.link));
  readonly footRun = computed(() => this.kind(this.deskFoot()?.link) === 'run');
  /** The phone total's sub: the other summed columns ("Omzet € 41.200 · Kost € 28.300"). */
  readonly totalSub = computed(() => {
    const view = this.view(), table = this.table();
    if (!view || !table?.total) return '';
    const total = table.total;
    return view.columns.filter((column) => column.key !== table.valueColumn && total.sums[column.key] !== undefined)
      .map((column) => `${column.label} ${this.format(total.sums[column.key], column.format)}`).join(' · ');
  });

  constructor() {
    const router = inject(Router);
    const pathOf = (url: string) => url.split(/[?#]/)[0];
    /* A navigation to another screen closes it; the page's own query writes (period, part) keep it. */
    router.events.pipe(filter((event): event is NavigationStart => event instanceof NavigationStart), takeUntilDestroyed())
      .subscribe((event) => { if (this.host.views() && pathOf(event.url) !== pathOf(router.url)) this.host.close(); });
    /* The page went: a drill never reappears when it comes back. */
    inject(DestroyRef).onDestroy(() => this.host.close());
  }

  kind(link: DrillLink | null | undefined) { return linkKind(link); }
  route(link: DrillLink | null | undefined) { return link && linkKind(link) === 'route' ? link as Extract<DrillLink, { path: unknown }> : null; }
  href(link: DrillLink | null | undefined): string | null { return link && linkKind(link) === 'href' ? (link as Extract<DrillLink, { href: string }>).href : null; }

  /** A row or foot action: the dialog closes first, then the action runs (the PO sheet opens over the page). */
  follow(link: DrillLink | null | undefined): void {
    this.host.close();
    if (link && linkKind(link) === 'run') (link as Extract<DrillLink, { run: () => void }>).run();
  }

  pickView(id: string): void { this.host.active.set(Number(id)); }

  sortBy(column: DrillColumn): void {
    const current = this.sort();
    if (current) this.picked.set(nextSort(current, column));
  }

  ariaSort(key: string): 'ascending' | 'descending' | null {
    const sort = this.sort();
    return sort?.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : null;
  }

  /** ↑ / ↓ move between the row links of the table; Enter follows the focused one (native). */
  rowKey(event: KeyboardEvent): void {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const target = event.target as HTMLElement | null;
    if (!target?.classList.contains('wk-tr--link')) return;
    const rows = [...this.element.nativeElement.querySelectorAll<HTMLElement>('.and__table .wk-tr--link')];
    const next = rows[rows.indexOf(target) + (event.key === 'ArrowDown' ? 1 : -1)];
    if (!next) return;
    event.preventDefault();
    next.focus();
  }

  formatOf(key: string): DrillFormat {
    return this.view()?.columns.find((column) => column.key === key)?.format ?? 'text';
  }

  toneClass(row: DrillRow): string { return row.tone ? `is-${row.tone}` : ''; }

  /** The first cell of a gap or total row: its label, with the figure when no column carries it (a count). */
  labelled(label: string, value: number, format: DrillFormat, valueColumn: string): string {
    return valueColumn ? label : `${label} · ${this.format(value, format)}`;
  }

  count(rows: number): string { return INT.format(rows); }

  /** A group sum in the format of the column that carries the figure. */
  money(value: number, view: DrillView): string {
    return this.format(value, view.columns.find((column) => column.key === this.table()?.valueColumn)?.format ?? view.total?.format ?? 'eur');
  }

  subOf(row: DrillRow, keys: readonly string[]): string {
    return keys.map((key) => row.cells[key]).map((cell, index) => cell === null || cell === undefined || cell === '' ? '' : this.text(cell, this.formatOf(keys[index])))
      .filter(Boolean).join(' · ');
  }

  /** A cell as the dialog writes it; strings pass through, an empty cell is "—". */
  text(cell: DrillCell | undefined, format: DrillFormat): string {
    if (cell === null || cell === undefined || cell === '') return '—';
    if (typeof cell === 'string') return format === 'day' ? dayMonth(cell, this.year) || cell : cell;
    return this.format(cell, format);
  }

  format(value: number, format: DrillFormat): string {
    if (!Number.isFinite(value)) return '—';
    switch (format) {
      case 'eur': return eurWhole(value).replace(/ /g, NBSP);
      case 'eur2': return eur(value).replace(/ /g, NBSP);
      case 'eur4': {
        const text = `€${NBSP}${RATE.format(Math.abs(value))}`;
        return value < 0 ? `${MINUS}${NBSP}${text}` : text;
      }
      case 'eurSigned': return signed(eurWhole(value), value).replace(/ /g, NBSP);
      case 'usd': {
        const whole = Math.round(Math.abs(value));
        const text = `$${NBSP}${INT.format(whole)}`;
        return value < 0 && whole !== 0 ? `${MINUS}${NBSP}${text}` : text;
      }
      case 'int': return INT.format(value).replace('-', MINUS);
      case 'rate': return RATE.format(value);
      case 'pct': return `${PCT.format(value).replace('-', MINUS)}${NBSP}%`;
      case 'days': return `${INT.format(value)}${NBSP}d`;
      case 'day':
      case 'text':
      default: return String(value);
    }
  }
}
