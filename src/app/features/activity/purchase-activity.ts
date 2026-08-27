import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { ActivityApi } from '../../core/api/activity-api';
import { ActivityEvent } from '../../core/api/models';
import { DateTimeNlPipe } from '../../shared/pipes';

/** Read-only, server-backed timeline for one purchase order. */
@Component({
  selector: 'app-purchase-activity',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DateTimeNlPipe],
  template: `
    <section class="card po-activity" aria-labelledby="purchase-activity-title">
      <header class="po-activity__head">
        @if (collapsible()) {
          <button type="button" class="po-activity__toggle" (click)="toggle()"
                  [attr.aria-expanded]="open()" aria-controls="purchase-activity-events">
            <span><small>Logboek</small><b id="purchase-activity-title">Activiteit</b></span>
            <span class="po-activity__count">{{ items().length || '—' }}</span>
            <span class="po-activity__chev" [class.po-activity__chev--open]="open()" aria-hidden="true">⌄</span>
          </button>
        } @else {
          <div>
            <small>Logboek</small>
            <h2 id="purchase-activity-title">Activiteit</h2>
          </div>
        }
      </header>

      @if (!collapsible() || open()) {
        <div class="po-activity__body" id="purchase-activity-events"
             [attr.aria-busy]="loading() || loadingMore()">
          @if (loading()) {
            <p class="po-activity__state" role="status">Activiteit laden…</p>
          } @else if (error()) {
            <div class="po-activity__state po-activity__state--error" role="alert">
              <span>{{ error() }}</span>
              <button type="button" (click)="reload()">Opnieuw</button>
            </div>
          } @else {
            <div class="po-activity__timeline">
              @for (event of items(); track event.id) {
                <article class="po-activity__event">
                  <span class="po-activity__dot" aria-hidden="true"></span>
                  <div>
                    <strong>{{ event.summary }}</strong>
                    <p>{{ event.at | dateTimeNl }} · {{ actorName(event) }}</p>
                  </div>
                </article>
              } @empty {
                <p class="po-activity__state">Nog geen activiteiten geregistreerd.</p>
              }
            </div>
            @if (nextBefore() !== null) {
              <button class="po-activity__more" type="button" [disabled]="loadingMore()"
                      (click)="loadMore()">
                {{ loadingMore() ? 'Laden…' : 'Meer tonen' }}
              </button>
            }
          }
        </div>
      }
    </section>
  `,
  styles: `
    :host{display:block;margin:12px 0}.po-activity{overflow:hidden}.po-activity__head{border-bottom:1px solid var(--line)}
    .po-activity__head>div{padding:14px 16px}.po-activity__head small{display:block;color:var(--rose);font-size:10px;font-weight:760;letter-spacing:.1em;text-transform:uppercase}.po-activity__head h2{margin-top:2px;font-size:16px}
    .po-activity__toggle{display:flex;width:100%;min-height:64px;align-items:center;gap:10px;padding:10px 16px;border:0;background:var(--surface);text-align:left;cursor:pointer}.po-activity__toggle>span:first-child{display:grid;flex:1}.po-activity__toggle b{font-size:15px}.po-activity__count{display:grid;min-width:26px;height:26px;place-items:center;border-radius:99px;background:var(--surface-2);color:var(--muted);font-size:11px;font-weight:700}.po-activity__chev{color:var(--muted);transition:transform .16s ease}.po-activity__chev--open{transform:rotate(180deg)}
    .po-activity__body{padding:4px 16px 14px}.po-activity__timeline{position:relative}.po-activity__event{position:relative;display:grid;grid-template-columns:12px minmax(0,1fr);gap:9px;padding:10px 0}.po-activity__event:not(:last-child):before{content:'';position:absolute;top:19px;bottom:-10px;left:5px;width:1px;background:var(--line)}.po-activity__dot{position:relative;z-index:1;width:11px;height:11px;margin-top:4px;border:3px solid var(--rose-soft);border-radius:50%;background:var(--rose)}.po-activity__event strong{display:block;font-size:12.5px;line-height:1.35}.po-activity__event p{margin-top:2px;color:var(--muted);font-size:11px}.po-activity__state{padding:14px 0;color:var(--muted);font-size:12px}.po-activity__state--error{display:flex;align-items:center;justify-content:space-between;gap:10px;color:var(--danger)}.po-activity__state button,.po-activity__more{border:0;background:transparent;color:var(--rose-dark);font:inherit;font-size:12px;font-weight:700;cursor:pointer}.po-activity__more{display:block;margin:4px auto 0;padding:8px 12px}.po-activity__more:disabled{opacity:.55;cursor:default}
  `,
})
export class PurchaseActivity {
  private readonly api = inject(ActivityApi);
  readonly orderId = input.required<number>();
  readonly collapsible = input(false);
  readonly open = signal(false);
  readonly items = signal<ActivityEvent[]>([]);
  readonly nextBefore = signal<number | null>(null);
  readonly loading = signal(true);
  readonly loadingMore = signal(false);
  readonly error = signal('');
  private requestId = 0;

  constructor() {
    effect(() => {
      const id = this.orderId();
      void this.load(id);
    });
  }

  actorName(event: ActivityEvent): string {
    return event.actor?.displayName || 'Systeem';
  }

  toggle(): void {
    const opening = !this.open();
    this.open.set(opening);
    if (opening && !this.loading()) void this.load(this.orderId());
  }

  reload(): void {
    void this.load(this.orderId());
  }

  async loadMore(): Promise<void> {
    const before = this.nextBefore();
    if (before === null || this.loadingMore()) return;
    this.loadingMore.set(true);
    try {
      const page = await this.api.list({ entityType: 'PURCHASE_ORDER',
        entityId: this.orderId(), before, limit: 50 });
      this.items.update((current) => [...current, ...page.items]);
      this.nextBefore.set(page.nextBefore);
    } catch {
      this.error.set('Activiteit kon niet verder worden geladen.');
    } finally {
      this.loadingMore.set(false);
    }
  }

  private async load(orderId: number): Promise<void> {
    const requestId = ++this.requestId;
    this.loading.set(true);
    this.error.set('');
    try {
      const page = await this.api.list({ entityType: 'PURCHASE_ORDER', entityId: orderId, limit: 50 });
      if (requestId !== this.requestId) return;
      this.items.set(page.items);
      this.nextBefore.set(page.nextBefore);
    } catch {
      if (requestId !== this.requestId) return;
      this.items.set([]);
      this.nextBefore.set(null);
      this.error.set('Activiteit kon niet worden geladen.');
    } finally {
      if (requestId === this.requestId) this.loading.set(false);
    }
  }
}
