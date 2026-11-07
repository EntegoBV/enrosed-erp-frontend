import {
  ChangeDetectionStrategy, Component, ElementRef, afterRenderEffect, computed, inject, input, output, signal, untracked, viewChild,
} from '@angular/core';
import { ISO_COUNTRIES, countryFlag, countryName, searchCountries, type IsoCountry } from '../core/api/geo';
import { DesktopViewport } from '../core/platform/desktop-viewport';
import { clampMenuPosition, type MenuPoint } from './context-menu-position';
import { Icon } from './icon';
import { Sheet } from './ui';

/** A country listed first: the ones configured under Landen & vracht. The name is optional; the ISO list knows it. */
export interface PreferredCountry {
  code: string;
  name?: string;
}

/** One block of the list; the label is '' for a flat list. */
interface CountryGroup {
  label: string;
  countries: IsoCountry[];
}

const MIN_POPOVER_WIDTH = 320;

/**
 * A country field that replaces a 250-option <select>: the trigger looks
 * like the house .select ("🇸🇦 Saoedi-Arabië  SA"), and opens a searchable
 * list. Desk: an anchored popover under the trigger with the search on top;
 * arrows move, Enter picks, Escape closes, typing searches. Phone: an iOS
 * sheet with the search stuck at the top. With `preferred` (the countries
 * under Landen & vracht) those come first under their own heading until a
 * query is typed; `exclude` hides codes already taken. Emits `changed` only
 * when the pick differs from the current value.
 */
@Component({
  selector: 'app-country-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, Sheet],
  template: `
    <button #trigger class="cp-trigger" type="button" [attr.id]="inputId()" [disabled]="disabled()"
            aria-haspopup="listbox" [attr.aria-expanded]="open()" (click)="toggle()">
      @if (current(); as country) {
        <span class="cp-trigger__flag" aria-hidden="true">{{ flag(country.code) }}</span>
        <span class="cp-trigger__name">{{ country.name }}</span>
        @if (country.name !== country.code) { <span class="cp-trigger__code">{{ country.code }}</span> }
      } @else {
        <span class="cp-trigger__placeholder">{{ placeholder() }}</span>
      }
    </button>
    @if (open()) {
      @if (desktop.active()) {
        <div class="cp-backdrop" (click)="close()" (contextmenu)="$event.preventDefault(); close()"></div>
        <!-- tabindex -1: a click on a heading or the empty text keeps the focus in here, so Escape closes the popover and not the sheet around it. -->
        <div #pop class="cp-pop" role="dialog" aria-label="Land kiezen" tabindex="-1"
             [style.left.px]="position().x" [style.top.px]="position().y" [style.width.px]="width()"
             (keydown)="onKey($event)">
          <div class="cp-search">
            <app-icon name="search" [size]="15" />
            <input #search type="text" placeholder="Zoek land of code…" aria-label="Zoek land of code"
                   autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
                   [value]="query()" (input)="setQuery($any($event.target).value)" />
          </div>
          <div #list class="cp-list" role="listbox" aria-label="Landen" [attr.aria-activedescendant]="activeId()">
            @for (group of groups(); track $index) {
              @if (group.label) { <div class="cp-group" role="presentation">{{ group.label }}</div> }
              @for (country of group.countries; track country.code) {
                <button class="cp-opt" type="button" role="option" [id]="optionId(country.code)"
                        [class.is-active]="activeCode() === country.code" [attr.aria-selected]="isCurrent(country.code)"
                        tabindex="-1" (mousemove)="activate(country.code)" (click)="pick(country.code)">
                  <span class="cp-opt__flag" aria-hidden="true">{{ flag(country.code) }}</span>
                  <span class="cp-opt__name">{{ country.name }}</span>
                  @if (country.code) { <span class="cp-opt__code">{{ country.code }}</span> }
                  @if (isCurrent(country.code)) { <app-icon class="cp-opt__tick" name="tick" [size]="15" /> }
                </button>
              } @empty {
                <div class="cp-empty">Geen land gevonden</div>
              }
            }
          </div>
        </div>
      } @else {
        <app-sheet variant="ios" [backdropCloses]="true" title="Land" (closed)="close()">
          <div body class="cp-sheet">
            <div class="cp-sheet__search">
              <input class="input" type="search" placeholder="Zoek land of code…" aria-label="Zoek land of code"
                     autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
                     [value]="query()" (input)="setQuery($any($event.target).value)" />
            </div>
            @for (group of groups(); track $index) {
              <section class="ios-section cp-sheet__group">
                @if (group.label) {
                  <div class="ios-section__head"><span class="ios-section__title">{{ group.label }}</span></div>
                }
                <div class="ios-group" role="listbox" [attr.aria-label]="group.label || 'Landen'">
                  @for (country of group.countries; track country.code) {
                    <button class="ios-cell cp-cell" type="button" role="option"
                            [attr.aria-selected]="isCurrent(country.code)" (click)="pick(country.code)">
                      <span class="cp-cell__flag" aria-hidden="true">{{ flag(country.code) }}</span>
                      <span class="ios-cell__body"><span class="ios-cell__title">{{ country.name }}</span></span>
                      @if (country.code) { <span class="ios-cell__meta">{{ country.code }}</span> }
                      @if (isCurrent(country.code)) { <app-icon class="ios-cell__tick" name="tick" [size]="18" /> }
                    </button>
                  } @empty {
                    <div class="ios-cell cp-cell cp-cell--empty">Geen land gevonden</div>
                  }
                </div>
              </section>
            }
          </div>
        </app-sheet>
      }
    }
  `,
  styles: `
    :host { display: block; min-width: 0; }
    /* The house .select, as a button: same height (the body's line-height 1.5 makes 48px, like .select), border, radius and chevron, so a form keeps one rhythm. */
    .cp-trigger {
      display: flex; align-items: center; gap: 8px; width: 100%; min-height: 46px; padding: 11px 30px 11px 14px;
      border: 1px solid rgb(26 22 20 / 10%); border-radius: var(--r-sm); background: var(--surface); color: var(--ink);
      font: inherit; font-size: 16px; text-align: left; cursor: pointer; appearance: none;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%238A807A' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
      background-repeat: no-repeat; background-position: right 12px center;
      transition: border-color 0.12s ease, box-shadow 0.12s ease;
    }
    .cp-trigger:focus { outline: none; border-color: var(--rose-mid); box-shadow: 0 0 0 3px rgb(209 74 103 / 14%); }
    .cp-trigger:focus-visible { outline: 3px solid color-mix(in srgb, var(--rose-mid) 55%, transparent); outline-offset: 2px; }
    .cp-trigger:disabled { opacity: .55; cursor: default; }
    .cp-trigger__flag { flex: none; font-size: 18px; line-height: 1; }
    .cp-trigger__name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cp-trigger__code { flex: none; color: var(--muted); font-size: 12px; font-weight: 600; letter-spacing: .03em; }
    .cp-trigger__placeholder { color: var(--muted); }

    .cp-backdrop { position: fixed; inset: 0; z-index: 60; }
    .cp-pop {
      position: fixed; z-index: 61; display: flex; flex-direction: column; max-height: 380px; padding: 6px; outline: none;
      border: 1px solid var(--line); border-radius: 12px; background: var(--surface); color: var(--ink);
      box-shadow: 0 12px 32px rgb(0 0 0 / 14%), 0 2px 6px rgb(0 0 0 / 8%);
      animation: mo-lift-in var(--dur-1, .12s) var(--ease-out, ease-out);
    }
    .cp-search { position: relative; flex: none; }
    .cp-search app-icon { position: absolute; top: 50%; left: 10px; color: var(--muted); transform: translateY(-50%); pointer-events: none; }
    .cp-search input {
      width: 100%; height: 36px; padding: 0 10px 0 32px; border: 1px solid var(--line); border-radius: 9px;
      background: var(--surface-2); color: var(--ink); font: inherit; font-size: 14px; outline: none;
    }
    .cp-search input::placeholder { color: var(--muted); }
    .cp-search input:focus { border-color: var(--rose-mid); box-shadow: 0 0 0 3px rgb(209 74 103 / 14%); }
    .cp-list { flex: 1; min-height: 0; margin-top: 6px; overflow-y: auto; overscroll-behavior: contain; }
    .cp-group { padding: 8px 10px 4px; color: var(--muted); font-size: 10.5px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; }
    .cp-opt {
      display: flex; align-items: center; gap: 9px; width: 100%; min-height: 34px; padding: 6px 10px; border: 0;
      border-radius: 8px; background: transparent; color: var(--ink); font: inherit; font-size: 13.5px; text-align: left; cursor: pointer;
    }
    /* One highlight only: the keyboard's row, which the mouse moves along with it. */
    .cp-opt.is-active { background: color-mix(in srgb, var(--rose) 9%, var(--surface)); }
    .cp-opt:focus-visible { outline: none; }
    .cp-opt__flag { flex: none; width: 22px; font-size: 17px; line-height: 1; text-align: center; }
    .cp-opt__name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cp-opt__code { flex: none; color: var(--muted); font-size: 11.5px; font-weight: 600; letter-spacing: .03em; }
    .cp-opt__tick { flex: none; color: var(--rose); }
    .cp-empty { padding: 16px 10px; color: var(--muted); font-size: 13px; text-align: center; }

    /* The sheet's body scrolls; the search stays on top of it, covering the body's own 4px top padding. */
    .cp-sheet { display: grid; gap: 0; }
    .cp-sheet__search { position: sticky; top: 0; z-index: 3; margin-top: -4px; padding: 8px var(--ios-inset, 16px) 12px; background: var(--ios-bg, var(--surface)); }
    .cp-sheet__group:last-child { margin-bottom: 0; }
    .cp-cell { min-height: 44px; padding: 6px 16px; }
    .cp-cell--empty { justify-content: center; color: var(--muted); font-size: 14px; }
    .cp-cell__flag { flex: none; width: 26px; font-size: 20px; line-height: 1; text-align: center; }
  `,
})
export class CountryPicker {
  private static nextId = 0;
  protected readonly desktop = inject(DesktopViewport);

  /** The chosen ISO code; null or '' when none. */
  readonly value = input<string | null>(null);
  /** Listed first under `preferredLabel` while nothing is typed. */
  readonly preferred = input<readonly PreferredCountry[]>([]);
  readonly preferredLabel = input('Landen & vracht');
  readonly allLabel = input('Alle landen');
  readonly placeholder = input('Kies een land…');
  /** The trigger's id, so a <label for> reaches it. */
  readonly inputId = input<string | null>(null);
  readonly disabled = input(false);
  /** Codes not offered (already configured, say); the current value still shows on the trigger. */
  readonly exclude = input<readonly string[]>([]);
  /** Offers `emptyLabel` on top; picking it emits ''. */
  readonly allowEmpty = input(false);
  readonly emptyLabel = input('Geen land');
  readonly changed = output<string>();

  readonly open = signal(false);
  readonly query = signal('');
  readonly position = signal<MenuPoint>({ x: 8, y: 8 });
  readonly width = signal(MIN_POPOVER_WIDTH);
  /** The row the keyboard is on (desk); '' is the empty option. */
  readonly activeCode = signal<string | null>(null);

  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');
  private readonly pop = viewChild<ElementRef<HTMLElement>>('pop');
  private readonly search = viewChild<ElementRef<HTMLInputElement>>('search');
  private readonly list = viewChild<ElementRef<HTMLElement>>('list');
  private anchor: MenuPoint | null = null;
  /** Keeps option ids apart when two pickers are on one page. */
  private readonly instance = ++CountryPicker.nextId;

  readonly flag = countryFlag;

  readonly current = computed<IsoCountry | null>(() => {
    const code = this.value();
    return code ? { code, name: countryName(code) } : null;
  });

  readonly groups = computed<CountryGroup[]>(() => {
    const excluded = new Set(this.exclude());
    /* The ISO entry carries the aliases; a code the list does not know keeps the caller's name. */
    const preferred = this.preferred()
      .filter((entry) => !excluded.has(entry.code))
      .map((entry) => ISO_COUNTRIES.find((country) => country.code === entry.code) ?? { code: entry.code, name: entry.name ?? entry.code });
    const preferredCodes = new Set(preferred.map((country) => country.code));
    const rest = ISO_COUNTRIES.filter((country) => !excluded.has(country.code) && !preferredCodes.has(country.code));
    const query = this.query().trim();
    if (query) return [{ label: '', countries: searchCountries(query, [...preferred, ...rest]) }];
    const empty: IsoCountry[] = this.allowEmpty() ? [{ code: '', name: this.emptyLabel() }] : [];
    if (!preferred.length) return [{ label: '', countries: [...empty, ...rest] }];
    return [
      { label: this.preferredLabel(), countries: [...empty, ...preferred] },
      { label: this.allLabel(), countries: rest },
    ];
  });

  /** Every row in list order, for the keyboard. */
  readonly options = computed(() => this.groups().flatMap((group) => group.countries));

  readonly activeId = computed(() => {
    const code = this.activeCode();
    return code !== null && this.options().some((country) => country.code === code) ? this.optionId(code) : null;
  });

  constructor() {
    /* The desk popover opens under the trigger, as wide as it (at least 320px), kept inside the window; the search takes the focus. */
    afterRenderEffect(() => {
      const element = this.pop()?.nativeElement;
      if (!element || !this.anchor) return;
      const rect = element.getBoundingClientRect();
      const next = clampMenuPosition(this.anchor, { width: rect.width, height: rect.height },
        { width: window.innerWidth, height: window.innerHeight });
      untracked(() => this.position.set(next));
      const search = this.search()?.nativeElement;
      if (search && !element.contains(document.activeElement)) search.focus({ preventScroll: true });
    });
    /* The keyboard's row stays in view while the arrows walk the list. */
    afterRenderEffect(() => {
      const id = this.activeId();
      const list = this.list()?.nativeElement;
      if (!id || !list) return;
      list.querySelector<HTMLElement>(`[id="${id}"]`)?.scrollIntoView({ block: 'nearest' });
    });
  }

  optionId(code: string): string {
    return `cp-${this.instance}-${code || 'none'}`;
  }

  isCurrent(code: string): boolean {
    return (this.value() ?? '') === code;
  }

  toggle(): void {
    if (this.open()) this.close();
    else this.show();
  }

  show(): void {
    if (this.disabled()) return;
    const rect = this.trigger().nativeElement.getBoundingClientRect();
    this.anchor = { x: Math.round(rect.left), y: Math.round(rect.bottom + 4) };
    this.position.set(this.anchor);
    this.width.set(Math.min(Math.max(Math.round(rect.width), MIN_POPOVER_WIDTH), window.innerWidth - 16));
    this.query.set('');
    /* '' is "nothing chosen" like null: then the empty option when on offer, else the first row, visibly, so Enter picks what is shown. */
    const value = this.value() || null;
    this.activeCode.set(value ?? (this.allowEmpty() ? '' : this.options()[0]?.code ?? null));
    this.open.set(true);
  }

  close(): void {
    if (!this.open()) return;
    this.open.set(false);
    this.anchor = null;
    this.query.set('');
    /* The phone sheet gives the focus back itself. */
    if (this.desktop.active()) this.trigger().nativeElement.focus({ preventScroll: true });
  }

  setQuery(text: string): void {
    this.query.set(text);
    this.activeCode.set(this.options()[0]?.code ?? null);
  }

  activate(code: string): void {
    this.activeCode.set(code);
  }

  pick(code: string): void {
    this.close();
    if (code !== (this.value() ?? '')) this.changed.emit(code);
  }

  onKey(event: KeyboardEvent): void {
    const options = this.options();
    const index = options.findIndex((country) => country.code === this.activeCode());
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (options.length) this.activeCode.set(options[(index + 1) % options.length].code);
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (options.length) this.activeCode.set(options[index < 0 ? options.length - 1 : (index - 1 + options.length) % options.length].code);
        break;
      case 'Enter': {
        event.preventDefault();
        /* Only a highlighted row is picked: Enter on a list without one would silently take Afghanistan. */
        const option = index >= 0 ? options[index] : null;
        if (option) this.pick(option.code);
        break;
      }
      case 'Tab':
        /* The focus stays in the popover: behind the backdrop the Tab would land on the next field of the sheet. */
        event.preventDefault();
        event.stopPropagation();
        this.search()?.nativeElement.focus({ preventScroll: true });
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        this.close();
        break;
    }
  }
}
