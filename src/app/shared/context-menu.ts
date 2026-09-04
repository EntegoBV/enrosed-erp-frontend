import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  afterRenderEffect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { DesktopViewport } from '../core/platform/desktop-viewport';
import { Sheet } from './ui';
import { clampMenuPosition } from './context-menu-position';
import type { MenuPoint } from './context-menu-position';

export interface ContextMenuItem {
  id: string;
  label: string;
  hint?: string;
  /** A glyph or emoji in front of the label. */
  icon?: string;
  danger?: boolean;
  disabled?: boolean;
  /** Draws a hairline above this item. */
  divider?: boolean;
}

/**
 * One menu, two shapes: a small popover at the pointer on a desk, a bottom
 * sheet on a phone. The caller decides what is in it and what a choice
 * means; this only shows, positions and closes.
 */
@Component({
  selector: 'app-context-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet],
  template: `
    @if (desktop.active()) {
      <div class="cm__backdrop" (click)="close()" (contextmenu)="$event.preventDefault(); close()"></div>
      <div #menu class="cm" role="menu" [attr.aria-label]="heading() || 'Acties'"
           [style.left.px]="position().x" [style.top.px]="position().y">
        @if (heading()) { <div class="cm__head">{{ heading() }}</div> }
        @for (item of items(); track item.id) {
          @if (item.divider) { <hr class="cm__divider" /> }
          <button class="cm__item" type="button" role="menuitem"
                  [class.cm__item--danger]="item.danger" [disabled]="item.disabled"
                  (click)="choose(item)">
            @if (item.icon) { <i aria-hidden="true">{{ item.icon }}</i> }
            <span><b>{{ item.label }}</b>@if (item.hint) { <small>{{ item.hint }}</small> }</span>
          </button>
        }
      </div>
    } @else {
      <app-sheet [title]="heading() || 'Acties'" (closed)="close()">
        <div body class="desk-actions">
          @for (item of items(); track item.id) {
            <button class="desk-action" type="button" [class.desk-action--danger]="item.danger"
                    [disabled]="item.disabled" (click)="choose(item)">
              @if (item.icon) { <i aria-hidden="true">{{ item.icon }}</i> }
              <span><b>{{ item.label }}</b>@if (item.hint) { <small>{{ item.hint }}</small> }</span>
            </button>
          }
        </div>
      </app-sheet>
    }
  `,
  styles: `
    :host { display: contents; }
    .cm__backdrop { position: fixed; inset: 0; z-index: 60; }
    .cm {
      position: fixed; z-index: 61; min-width: 220px; max-width: min(320px, calc(100vw - 16px));
      padding: 6px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface);
      box-shadow: 0 12px 32px rgb(0 0 0 / 14%), 0 2px 6px rgb(0 0 0 / 8%);
      animation: cm-in .12s ease-out;
    }
    @keyframes cm-in { from { opacity: 0; transform: translateY(-3px) scale(.98); } }
    .cm__head {
      padding: 6px 10px 7px; color: var(--muted); font-size: 11px; font-weight: 750;
      letter-spacing: .05em; text-transform: uppercase; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .cm__divider { margin: 5px 6px; border: 0; border-top: 1px solid var(--line); }
    .cm__item {
      display: flex; width: 100%; align-items: center; gap: 10px; padding: 8px 10px;
      border: 0; border-radius: 8px; background: transparent; color: var(--ink); font: inherit; text-align: left; cursor: pointer;
    }
    .cm__item:hover, .cm__item:focus-visible { background: var(--surface-2); outline: none; }
    .cm__item:disabled { opacity: .45; cursor: default; }
    .cm__item i { width: 20px; flex: none; text-align: center; font-style: normal; font-size: 15px; }
    .cm__item span { display: grid; min-width: 0; gap: 1px; }
    .cm__item b { font-size: 13px; font-weight: 600; }
    .cm__item small { color: var(--muted); font-size: 11px; }
    .cm__item--danger b { color: var(--danger); }
    .desk-action i { width: 22px; text-align: center; }
  `,
})
export class ContextMenu {
  readonly desktop = inject(DesktopViewport);

  readonly items = input<ContextMenuItem[]>([]);
  readonly heading = input('', { alias: 'title' });
  /** Where the pointer was; the popover opens there, clamped to the window. */
  readonly anchor = input<MenuPoint | null>(null);
  readonly pick = output<ContextMenuItem>();
  readonly closed = output<void>();

  readonly position = signal<MenuPoint>({ x: 8, y: 8 });
  private readonly menu = viewChild<ElementRef<HTMLElement>>('menu');
  private focused = false;

  constructor() {
    afterRenderEffect(() => {
      const element = this.menu()?.nativeElement;
      const anchor = this.anchor();
      if (!element || !anchor) return;
      const rect = element.getBoundingClientRect();
      const next = clampMenuPosition(anchor, { width: rect.width, height: rect.height },
        { width: window.innerWidth, height: window.innerHeight });
      untracked(() => this.position.set(next));
      if (!this.focused) {
        this.focused = true;
        element.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
      }
    });
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (!this.desktop.active()) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const buttons = [...(this.menu()?.nativeElement.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [])];
    if (!buttons.length) return;
    event.preventDefault();
    const index = buttons.indexOf(document.activeElement as HTMLElement);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    buttons[(index + step + buttons.length) % buttons.length].focus();
  }

  choose(item: ContextMenuItem): void {
    if (item.disabled) return;
    this.pick.emit(item);
  }

  close(): void {
    this.closed.emit();
  }
}
