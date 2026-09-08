import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map } from 'rxjs';
import { Auth } from '../../core/api/auth';
import { BrandMark } from '../../shared/brand-mark';
import { Icon } from '../../shared/icon';
import { FINANCE_SECTIONS, financeView } from './finance-sections';

/**
 * The workspace navigation of Kosten & bank on a desktop, the way Documenten
 * & media has one: the sections on the left, the money in the middle. Every
 * link is a query on /costs, so a reload and a shared link keep their place.
 */
@Component({
  selector: 'app-finance-admin-nav',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BrandMark, Icon, RouterLink],
  template: `
    <aside class="files-sidebar" aria-label="Kosten en bank">
      <header class="files-sidebar__brand">
        <app-brand-mark subtitle="Kosten & bank" />
      </header>

      <nav class="files-sidebar__nav" aria-label="Onderdelen van Kosten en bank">
        <span class="files-sidebar__label">Geld</span>
        @for (section of sections; track section.id) {
          @if (section.id === 'analysis') { <span class="files-sidebar__label files-sidebar__label--spaced">Inzicht</span> }
          <a routerLink="/costs" [queryParams]="section.id === 'overview' ? {} : { view: section.id }" [class.active]="view() === section.id">
            <app-icon [name]="section.icon" [size]="19" />
            <span><b>{{ section.label }}</b><small>{{ section.hint }}</small></span>
          </a>
        }
      </nav>

      <footer class="files-sidebar__footer">
        <a class="files-sidebar__back" routerLink="/dashboard">
          <span aria-hidden="true">←</span>
          <span><b>Terug naar ERP</b><small>Verkoop &amp; voorraad</small></span>
        </a>
        <div class="files-sidebar__account">
          <span>{{ auth.username() }}</span>
          <button type="button" (click)="logout()">Afmelden</button>
        </div>
      </footer>
    </aside>
  `,
  styles: `
    :host { display: block; width: 100%; flex: none; color: #f8f4ef; background: #171311; }
    .files-sidebar { display: flex; min-height: 0; flex-direction: column; }
    .files-sidebar__brand { display: flex; min-height: 78px; align-items: center; padding: 15px 18px; border-bottom: 1px solid rgb(255 255 255 / 10%); }
    .files-sidebar__brand app-brand-mark { min-width: 0; filter: invert(1) grayscale(1) brightness(2); }
    .files-sidebar__nav { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(176px, 1fr); gap: 6px; padding: 10px 12px; overflow-x: auto; scrollbar-width: thin; }
    .files-sidebar__label { display: none; }
    .files-sidebar__nav > a { display: grid; grid-template-columns: 24px minmax(0, 1fr); align-items: center; gap: 9px; min-height: 54px; padding: 8px 11px; border: 1px solid transparent; border-radius: 12px; color: rgb(255 255 255 / 68%); text-decoration: none; }
    .files-sidebar__nav > a > span { display: grid; min-width: 0; gap: 1px; }
    .files-sidebar__nav b { color: inherit; font-size: 13px; line-height: 1.25; }
    .files-sidebar__nav small { overflow: hidden; color: rgb(255 255 255 / 42%); font-size: 10.5px; line-height: 1.25; text-overflow: ellipsis; white-space: nowrap; }
    .files-sidebar__nav > a:hover { background: rgb(255 255 255 / 7%); color: #fff; }
    .files-sidebar__nav > a.active { border-color: rgb(215 184 118 / 28%); background: rgb(215 184 118 / 14%); color: #f5d894; }
    .files-sidebar__nav > a.active small { color: rgb(245 216 148 / 62%); }
    .files-sidebar__footer { display: none; }
    @media (min-width: 680px) and (max-width: 899px) {
      :host { width: 88px; min-height: 100dvh; }
      .files-sidebar { position: sticky; top: 0; height: 100dvh; }
      .files-sidebar__brand { min-height: 0; justify-content: center; padding: 14px 8px 10px; }
      .files-sidebar__brand app-brand-mark { display: none; }
      .files-sidebar__brand::before { content: 'E'; display: grid; place-items: center; width: 34px; height: 34px; border-radius: 10px; background: #d7b876; color: #171311; font-size: 16px; font-weight: 900; }
      .files-sidebar__nav { grid-auto-flow: row; grid-auto-columns: auto; flex: 1; min-height: 0; gap: 4px; padding: 8px 6px; overflow-y: auto; overflow-x: hidden; align-content: start; scrollbar-width: none; }
      .files-sidebar__nav > a { grid-template-columns: 1fr; justify-items: center; min-height: 58px; padding: 8px 4px 6px; gap: 5px; text-align: center; }
      .files-sidebar__nav > a > span { justify-items: center; }
      .files-sidebar__nav b { overflow: hidden; max-width: 76px; font-size: 10px; line-height: 1.15; text-overflow: ellipsis; white-space: nowrap; }
      .files-sidebar__nav small { display: none; }
      .files-sidebar__label { display: block; margin: 8px 0 2px; color: rgb(255 255 255 / 30%); font-size: 8.5px; font-weight: 850; letter-spacing: .1em; text-align: center; text-transform: uppercase; }
      .files-sidebar__footer { display: grid; padding: 8px 6px 12px; border-top: 1px solid rgb(255 255 255 / 10%); }
      .files-sidebar__back { display: grid; justify-items: center; gap: 2px; padding: 8px 4px; border-radius: 10px; color: rgb(255 255 255 / 75%); text-decoration: none; }
      .files-sidebar__back > span:last-child { display: grid; justify-items: center; }
      .files-sidebar__back b { font-size: 9.5px; }
      .files-sidebar__back small { display: none; }
      .files-sidebar__account { display: none; }
    }
    @media (min-width: 900px) {
      :host { width: 248px; min-height: 100dvh; }
      .files-sidebar { position: sticky; top: 0; height: 100dvh; }
      .files-sidebar__nav { grid-auto-flow: row; grid-auto-columns: auto; flex: 1; min-height: 0; padding: 12px 10px; overflow-y: auto; overflow-x: hidden; align-content: start; }
      .files-sidebar__label { display: block; margin: 2px 0 4px 12px; color: rgb(255 255 255 / 38%); font-size: 9.5px; font-weight: 850; letter-spacing: .12em; text-transform: uppercase; }
      .files-sidebar__label--spaced { margin-top: 14px; }
      .files-sidebar__nav > a { min-height: 46px; }
      .files-sidebar__footer { display: grid; gap: 10px; padding: 12px; border-top: 1px solid rgb(255 255 255 / 10%); }
      .files-sidebar__back { display: grid; grid-template-columns: 20px minmax(0, 1fr); align-items: center; gap: 8px; padding: 8px 10px; border-radius: 10px; color: rgb(255 255 255 / 75%); text-decoration: none; }
      .files-sidebar__back:hover { background: rgb(255 255 255 / 7%); color: #fff; }
      .files-sidebar__back > span:last-child { display: grid; }
      .files-sidebar__back b { font-size: 12.5px; }
      .files-sidebar__back small { color: rgb(255 255 255 / 42%); font-size: 10.5px; }
      .files-sidebar__account { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 0 10px; color: rgb(255 255 255 / 55%); font-size: 11.5px; }
      .files-sidebar__account button { padding: 5px 10px; border: 1px solid rgb(255 255 255 / 18%); border-radius: 999px; background: transparent; color: inherit; font: inherit; font-size: 11px; cursor: pointer; }
    }
  `,
})
export class FinanceAdminNav {
  readonly auth = inject(Auth);
  private readonly router = inject(Router);
  readonly sections = FINANCE_SECTIONS;

  private readonly url = toSignal(this.router.events.pipe(
    filter((event): event is NavigationEnd => event instanceof NavigationEnd),
    map(() => this.router.url),
  ), { initialValue: this.router.url });

  readonly view = computed(() => financeView(new URLSearchParams(this.url().split('?')[1] ?? '').get('view')));

  logout(): void {
    this.auth.logout();
    void this.router.navigateByUrl('/login');
  }
}
