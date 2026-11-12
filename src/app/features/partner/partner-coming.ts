import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PartnerContainersData } from './partner-containers-data';
import { STATE_TONE, STATE_WORD, arrivalLine, arrivalWords, cargoLine, progressOf, stateOf } from './partner-containers-model';

/** How many coming containers the Overzicht shows. */
const STRIP_MAX = 3;

/**
 * "Komt eraan" on the Overzicht: the next three containers still coming, each
 * a link to it on Containers (?container=<id>), with its cargo, "± do 20 nov ·
 * over 8 dagen" and a thin bar. Nothing shows while it loads, when nothing is
 * coming, or when the containers could not be read (the tab says why).
 */
@Component({
  selector: 'app-partner-coming',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    @if (items().length) {
      <section class="kc" aria-labelledby="kc-title">
        <div class="kc-head">
          <h2 id="kc-title">Komt eraan</h2>
          <a class="kc-link" routerLink="/partner/containers">Alle containers</a>
        </div>
        <div class="kc-list">
          @for (item of items(); track item.id) {
            <a class="kc-item" routerLink="/partner/containers" [queryParams]="{ container: item.id }">
              <span class="kc-top"><b>{{ item.name }}</b>@if (item.own) { <span class="wk-pill tone-accent">Samen met jou</span> }</span>
              <span class="kc-cargo {{ item.tone }}"><i class="wk-dot" aria-hidden="true"></i>{{ item.word }} · {{ item.cargo }}</span>
              <span class="kc-when" [class.is-late]="item.late">{{ item.when }}</span>
              @if (item.progress !== null) {
                <span class="kc-bar {{ item.late ? 'tone-amber' : item.tone }}" role="presentation"><i [style.width.%]="item.progress"></i></span>
              }
            </a>
          }
        </div>
      </section>
    }
  `,
  styles: `
    :host{display:block}
    .kc{margin:0 0 24px}
    .kc-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:0 2px 8px}
    .kc-head h2{margin:0;font-size:19px;font-weight:800;letter-spacing:-.02em}
    .kc-link{display:inline-flex;align-items:center;min-height:44px;margin:-12px 0;color:var(--rose-dark);font-size:14px;font-weight:650;text-decoration:none}
    .kc-list{display:grid;grid-template-columns:minmax(0,1fr);gap:8px}
    .kc-item{display:grid;gap:3px;min-height:44px;padding:11px 14px 12px;border:1px solid var(--line);border-radius:14px;background:var(--surface);color:var(--ink);text-decoration:none;-webkit-tap-highlight-color:transparent}
    .kc-item:hover{border-color:var(--line-strong);background:var(--surface-2)}
    .kc-item:focus-visible{outline:2px solid var(--rose-dark);outline-offset:2px}
    .kc-top{display:flex;align-items:center;gap:8px;min-width:0}
    .kc-top b{min-width:0;overflow:hidden;font-size:14.5px;font-weight:740;font-variant-numeric:tabular-nums;text-overflow:ellipsis;white-space:nowrap}
    .kc-top .wk-pill{flex:none}
    .kc-cargo{display:flex;align-items:center;gap:6px;min-width:0;overflow:hidden;color:var(--ink-2);font-size:12.5px;text-overflow:ellipsis;white-space:nowrap}
    .kc-when{font-size:13px;font-weight:650;font-variant-numeric:tabular-nums}
    .kc-when.is-late{color:#9a6212}
    .kc-bar{display:block;height:4px;margin-top:4px;border-radius:2px;background:color-mix(in srgb,var(--tone) 14%,var(--surface-2));overflow:hidden}
    .kc-bar>i{display:block;height:100%;border-radius:2px;background:var(--tone)}
    @media (min-width: 1024px), (min-width: 680px) and (hover: hover){
      .kc-list{grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
    }
    @media (max-width: 679.98px), (hover: none) and (max-width: 1023.98px){
      .kc-item{border:0;border-radius:18px;padding:13px 16px 14px}
      .kc-top b{font-size:16px}
      .kc-cargo{font-size:14px}
      .kc-when{font-size:14.5px}
    }
  `,
})
export class PartnerComing {
  private readonly data = inject(PartnerContainersData);

  readonly items = computed(() => {
    const page = this.data.page();
    if (!page) return [];
    const today = page.serverDate;
    return this.data.coming().slice(0, STRIP_MAX).map((container) => {
      const state = stateOf(container, today);
      const words = arrivalWords(container, today);
      return {
        id: container.id, name: container.name, own: container.own, word: STATE_WORD[state], tone: STATE_TONE[state],
        cargo: cargoLine(container), when: arrivalLine(container, today), late: words.late, progress: progressOf(container, today),
      };
    });
  });

  constructor() {
    void this.data.load();
  }
}
