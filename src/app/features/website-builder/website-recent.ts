import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ActivityApi } from '../../core/api/activity-api';
import type { ActivityEvent } from '../../core/api/models';
import { Skeleton } from '../../shared/skeleton';

/**
 * "Recent gewijzigd · productreeksen": the latest logbook entries of public
 * product reeksen (Overzicht and Publicatie), each a link to the reeks in
 * Producten. A desk card or a phone inset group.
 */
@Component({
  selector: 'app-website-recent',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  imports: [RouterLink, Skeleton],
  template: `
    @if (layout() === 'card') {
      <section class="ws-card ws-c-recent" aria-labelledby="ws-recent-title">
        <header class="ws-card-head">
          <h2 id="ws-recent-title">Recent gewijzigd</h2><span class="ws-count">productreeksen</span>
          <span class="ws-tools"><a class="wk-link" routerLink="/activity">Logboek ›</a></span>
        </header>
        @if (loading() && !items().length) {
          <div class="ws-card-pad"><app-skeleton kind="lines" [rows]="4" /></div>
        } @else if (error()) {
          <p class="ws-card-note">Recente wijzigingen niet geladen</p>
        } @else {
          @for (item of visible(); track item.id) {
            <a class="ws-recent ws-link-row" routerLink="/website/products" [queryParams]="queryOf(item)">
              <b [attr.title]="item.entityLabel">{{ item.entityLabel || 'Productreeks' }}</b>
              <small [attr.title]="lineOf(item)">{{ lineOf(item) }}</small>
              <time [attr.datetime]="item.at">{{ timeOf(item.at) }}</time>
            </a>
          } @empty {
            <p class="ws-card-note">Nog geen wijzigingen aan productreeksen.</p>
          }
        }
      </section>
    } @else {
      <section class="ios-section">
        <div class="ios-section__head"><h2>Recent gewijzigd</h2></div>
        @if (loading() && !items().length) {
          <app-skeleton kind="group" [rows]="3" />
        } @else if (error()) {
          <p class="ios-section__foot">Recente wijzigingen niet geladen</p>
        } @else {
          <div class="ios-group">
            @for (item of visible(); track item.id) {
              <a class="ios-cell" routerLink="/website/products" [queryParams]="queryOf(item)">
                <span class="ios-cell__body">
                  <span class="ios-cell__title ios-cell__title--2">{{ item.entityLabel || 'Productreeks' }}</span>
                  <span class="ios-cell__sub ios-cell__sub--wrap">{{ lineOf(item) }}</span>
                </span>
                <span class="ios-cell__trail"><span class="ios-cell__meta">{{ timeOf(item.at) }}</span></span>
              </a>
            } @empty {
              <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__sub">Nog geen wijzigingen aan productreeksen.</span></span></div>
            }
          </div>
        }
      </section>
    }
  `,
})
export class WebsiteRecent implements OnInit {
  private readonly activity = inject(ActivityApi);
  readonly layout = input<'card' | 'group'>('card');
  /** How many rows to show; the request asks for the largest this page may show. */
  readonly limit = input(8);
  readonly fetchLimit = input(12);
  readonly items = signal<ActivityEvent[]>([]);
  readonly loading = signal(true);
  readonly error = signal(false);
  readonly visible = computed(() => this.items().slice(0, this.limit()));

  private readonly formatter = new Intl.DateTimeFormat('nl-BE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  ngOnInit(): void { void this.load(); }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(false);
    try {
      const page = await this.activity.list({ entityType: 'PRODUCT_FAMILY', limit: this.fetchLimit() });
      this.items.set(page.items ?? []);
    } catch {
      this.error.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  queryOf(item: ActivityEvent): Record<string, string> | null {
    return item.entityId ? { reeks: item.entityId } : null;
  }

  lineOf(item: ActivityEvent): string {
    return [item.summary, item.actor?.displayName].filter(Boolean).join(' · ');
  }

  /** "16/10 18:42". */
  timeOf(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : this.formatter.format(date).replace(',', '');
  }
}
