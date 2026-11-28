import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { PartnerContainer } from '../../core/api/partner-portal-api';
import { progressOf, routeStops } from './partner-containers-model';

/**
 * A container's way in one line: Besteld → Vertrokken → Haven → the warehouse, a dot per stop (filled once
 * reached) on a track that fills up to where it is now (between leaving and the port: the share of the voyage
 * that has passed). Under each dot its day and a short word (the port it left, "over 2 dagen", "schip is binnen",
 * the hour set by hand). Never a price.
 */
@Component({
  selector: 'app-partner-route',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="rt">
      <span class="rt__track" aria-hidden="true"><i [style.width.%]="fill()"></i></span>
      <ol class="rt__stops" [attr.aria-label]="'Route van ' + container().name">
      @for (stop of stops(); track stop.key) {
        <li class="rt__stop" [class.is-done]="stop.done" [class.is-late]="stop.late" [class.is-muted]="stop.muted">
          <span class="rt__dot" aria-hidden="true"></span>
          <span class="rt__label">{{ stop.label }}</span>
          <b class="rt__main">{{ stop.main }}</b>
          @if (stop.sub) { <span class="rt__sub">{{ stop.sub }}</span> }
        </li>
      }
      </ol>
    </div>
  `,
  styles: `
    :host{display:block}
    .rt{position:relative}
    .rt__stops{position:relative;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));margin:0;padding:0;list-style:none}
    /* The track runs from the first dot's centre to the last one's (the middle of the first and last column). */
    .rt__track{position:absolute;top:7px;right:12.5%;left:12.5%;height:3px;border-radius:2px;background:repeating-linear-gradient(90deg,var(--line-strong) 0 6px,transparent 6px 10px)}
    .rt__track>i{display:block;height:100%;border-radius:2px;background:var(--rose)}
    .rt__stop{position:relative;display:grid;justify-items:center;align-content:start;gap:2px;min-width:0;padding:0 4px;text-align:center}
    .rt__dot{position:relative;z-index:1;width:17px;height:17px;margin-bottom:6px;border:2.5px solid var(--line-strong);border-radius:50%;background:var(--surface)}
    .is-done .rt__dot{border-color:var(--rose);background:var(--rose);box-shadow:inset 0 0 0 2.5px var(--surface)}
    .is-late .rt__dot{border-color:#c48a2c}
    .rt__label{max-width:100%;color:var(--muted);font-size:11.5px;font-weight:650;letter-spacing:.02em;line-height:1.2;text-wrap:balance;overflow-wrap:anywhere}
    .rt__main{max-width:100%;font-size:14px;font-weight:720;font-variant-numeric:tabular-nums;line-height:1.25;text-wrap:balance}
    .is-muted .rt__main{color:var(--muted);font-weight:550}
    .is-late .rt__main,.is-late .rt__sub{color:#9a6212}
    .rt__sub{max-width:100%;color:var(--ink-2);font-size:12px;line-height:1.25;text-wrap:balance}
    @media (max-width: 679.98px), (hover: none) and (max-width: 1023.98px){
      .rt__label{font-size:11px}
      .rt__main{font-size:13px}
      .rt__sub{font-size:11.5px}
      .rt__stop{padding:0 2px}
    }
  `,
})
export class PartnerRoute {
  readonly container = input.required<PartnerContainer>();
  readonly today = input.required<string>();
  readonly warehouseName = input('Zaltbommel');

  readonly stops = computed(() => routeStops(this.container(), this.today(), this.warehouseName()));

  /** How far the track is filled (% of its length): the reached stops, plus the voyage's share at sea. */
  readonly fill = computed(() => {
    const stops = this.stops();
    let reached = 0;
    for (let index = 1; index < stops.length; index++) if (stops[index].done) reached = index;
    if (reached >= stops.length - 1) return 100;
    let part = 0;
    /* At sea: departed, the port not reached yet; the share of the days from leaving to the expected arrival. */
    if (reached === 1) part = Math.min(0.95, (progressOf(this.container(), this.today()) ?? 0) / 100);
    return Math.round(((reached + part) / (stops.length - 1)) * 100);
  });
}
