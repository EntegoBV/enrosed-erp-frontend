import { computed, signal } from '@angular/core';
import { EMPTY_SELECTION, TableSelection, moveFocus, prune, selectAll, selectOne, selectRange, toggle } from './finance-selection';
import type { FinanceCommand } from './finance-shortcuts';

export interface FinanceTableOptions {
  /** The keys in the order they are on screen. */
  order: () => readonly string[];
  /** Called with the row to show in the inspector. */
  inspect: (key: string) => void;
  /** Where the rows live, to move keyboard focus. */
  host: () => HTMLElement | null;
}

/**
 * Selection, focus and the arrow keys of one desk table, on top of the pure
 * finance-selection helpers. A click picks one row and inspects it,
 * ⌘/Ctrl-click toggles, Shift-click spans; a ticked checkbox turns the
 * selection toolbar on even for a single row.
 */
export class FinanceTable {
  readonly selection = signal<TableSelection>(EMPTY_SELECTION);
  readonly ticked = signal(false);
  readonly keys = computed(() => new Set(this.selection().keys));
  readonly count = computed(() => this.selection().keys.length);
  /** The one row Tab lands on (roving tabindex): the keyboard's row, else the first. */
  readonly stop = computed(() => {
    const focus = this.selection().focus;
    const order = this.options.order();
    return focus && order.includes(focus) ? focus : order[0] ?? null;
  });

  constructor(private readonly options: FinanceTableOptions) {}

  isSelected(key: string): boolean {
    return this.keys().has(key);
  }

  /** A row got focus (Tab, or the mouse just before its click): the keys go on from there, nothing is selected yet. */
  focused(key: string): void {
    const current = this.selection();
    if (current.focus !== key) this.selection.set({ ...current, focus: key, anchor: current.keys.length ? current.anchor : key });
  }

  click(key: string, event: MouseEvent): void {
    const order = this.options.order();
    const current = this.selection();
    if (event.shiftKey) this.set(selectRange(order, current.anchor ?? current.focus, key));
    else if (event.metaKey || event.ctrlKey) this.set(toggle(current, key));
    else {
      this.ticked.set(false);
      this.set(selectOne(key));
    }
  }

  /** The checkbox: a toggle that also asks for the selection toolbar. */
  check(key: string): void {
    this.ticked.set(true);
    this.set(toggle(this.selection(), key));
  }

  checkAll(keys: readonly string[]): void {
    const all = keys.length > 0 && keys.every((key) => this.keys().has(key));
    this.ticked.set(!all);
    this.set(all ? EMPTY_SELECTION : selectAll(keys, this.selection()));
  }

  clear(): void {
    this.ticked.set(false);
    this.set(EMPTY_SELECTION);
  }

  /** Keeps the selection to what a filter left on screen. */
  prune(): void {
    const next = prune(this.selection(), this.options.order());
    if (next.keys.length !== this.selection().keys.length) this.selection.set(next);
  }

  /** The keyboard: arrows, Shift+arrows, Space, ⌘A and Esc. */
  handle(command: FinanceCommand): boolean {
    const order = this.options.order();
    const current = this.selection();
    switch (command) {
      case 'up': case 'down': case 'extend-up': case 'extend-down': {
        if (!order.length) return false;
        const next = moveFocus(order, current, command.endsWith('up') ? -1 : 1, command.startsWith('extend'));
        this.set(next);
        this.focusRow(next.focus);
        return true;
      }
      case 'toggle':
        if (!current.focus) return false;
        this.ticked.set(true);
        this.set(toggle(current, current.focus));
        return true;
      case 'select-all':
        if (!order.length) return false;
        this.ticked.set(true);
        this.set(selectAll(order, current));
        return true;
      case 'escape':
        if (!current.keys.length) return false;
        this.clear();
        return true;
      default:
        return false;
    }
  }

  /** The inspector follows the row the keyboard or the last click is on; clearing leaves it (Esc closes it next). */
  private set(next: TableSelection): void {
    this.selection.set(next);
    if (next.focus && next.keys.includes(next.focus)) this.options.inspect(next.focus);
  }

  private focusRow(key: string | null): void {
    if (!key) return;
    const row = this.options.host()?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
    row?.focus({ preventScroll: true });
    row?.scrollIntoView({ block: 'nearest' });
  }
}
