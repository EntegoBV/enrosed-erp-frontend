import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, inject, input, signal,
} from '@angular/core';
import { dayTime } from '../features/analyses/market-math';

export interface TrendSeries {
  label: string;
  /** ISO days, oldest first; the series may be sparse (weekly quotes) or dense (ECB days). */
  dates: string[];
  values: number[];
  /** The accent series carries the area wash; a reference series stays muted. */
  tone?: 'accent' | 'muted';
}

interface Point { t: number; v: number; x: number; y: number; date: string }

interface Line extends TrendSeries {
  points: Point[];
  path: string;
  area: string;
  end: Point | null;
  sparse: boolean;
}

interface Tick { at: number; label: string }

/**
 * One time-series chart that reads on its own: a real time axis (uneven
 * weekly quotes land on their dates, not on equal slots), quiet hairline
 * gridlines with clean tick values, month marks, the two extremes labelled,
 * and a crosshair tooltip on hover, touch and keyboard. Up to two series:
 * the accent one carries the story, the muted one is a reference.
 */
@Component({
  selector: 'app-trend-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (layout(); as l) {
      @if (l.lines.length > 1) {
        <ul class="tc-legend" aria-label="Reeksen">
          @for (line of l.lines; track line.label) {
            <li><i [class.is-muted]="line.tone === 'muted'"></i>{{ line.label }}</li>
          }
        </ul>
      }
      <div class="tc-plot" (pointermove)="track($event)" (pointerleave)="clear()"
           (keydown)="onKey($event)" tabindex="0" role="img" [attr.aria-label]="ariaLabel()">
        <svg [attr.width]="width()" [attr.height]="height()" [attr.viewBox]="'0 0 ' + width() + ' ' + height()">
          @for (tick of l.yTicks; track tick.at) {
            <line class="tc-grid" [attr.x1]="l.left" [attr.x2]="l.right" [attr.y1]="tick.at" [attr.y2]="tick.at" />
            <text class="tc-axis" [attr.x]="l.left - 6" [attr.y]="tick.at + 3.5" text-anchor="end">{{ tick.label }}</text>
          }
          @for (tick of l.xTicks; track tick.at) {
            <line class="tc-grid tc-grid--x" [attr.x1]="tick.at" [attr.x2]="tick.at" [attr.y1]="l.top" [attr.y2]="l.bottom" />
            <text class="tc-axis" [attr.x]="tick.at" [attr.y]="l.bottom + 15" text-anchor="middle">{{ tick.label }}</text>
          }
          @for (line of l.lines; track line.label) {
            @if (line.tone !== 'muted') {
              <path class="tc-area" [attr.d]="line.area" />
            }
            <path class="tc-line" [class.tc-line--muted]="line.tone === 'muted'" [attr.d]="line.path" />
            @if (line.sparse) {
              @for (point of line.points; track point.t) {
                <circle class="tc-dot" [class.tc-dot--muted]="line.tone === 'muted'" [attr.cx]="point.x" [attr.cy]="point.y" r="3" />
              }
            }
            @if (line.end; as end) {
              <circle class="tc-dot tc-dot--end" [class.tc-dot--muted]="line.tone === 'muted'" [attr.cx]="end.x" [attr.cy]="end.y" r="4" />
            }
          }
          @for (mark of l.extremes; track mark.kind) {
            <text class="tc-mark" [attr.x]="mark.x" [attr.y]="mark.y" [attr.text-anchor]="mark.anchor">{{ mark.label }}</text>
          }
          @if (hover(); as h) {
            <line class="tc-cross" [attr.x1]="h.x" [attr.x2]="h.x" [attr.y1]="l.top" [attr.y2]="l.bottom" />
            @for (row of h.rows; track row.label) {
              <circle class="tc-dot tc-dot--hover" [class.tc-dot--muted]="row.muted" [attr.cx]="row.x" [attr.cy]="row.y" r="4.5" />
            }
          }
        </svg>
        @if (hover(); as h) {
          <div class="tc-tip" [class.tc-tip--left]="h.flip" [style.left.px]="h.x" [style.top.px]="l.top">
            <time>{{ h.date }}</time>
            @for (row of h.rows; track row.label) {
              <span><i [class.is-muted]="row.muted"></i><b>{{ row.value }}</b>
                @if (h.rows.length > 1) { <small>{{ row.label }}</small> }</span>
            }
          </div>
        }
      </div>
    } @else {
      <div class="tc-empty" [style.height.px]="height()"><span></span>{{ emptyText() }}</div>
    }
  `,
  styles: `
    :host{display:block;min-width:0}
    .tc-plot{position:relative;outline:0;touch-action:pan-y;cursor:crosshair}
    .tc-plot:focus-visible{border-radius:8px;box-shadow:0 0 0 2px var(--rose-line)}
    svg{display:block;width:100%;height:auto;overflow:visible}
    .tc-grid{stroke:var(--line);stroke-width:1;shape-rendering:crispEdges}
    .tc-grid--x{stroke:color-mix(in srgb,var(--line) 60%,transparent)}
    .tc-axis{fill:var(--muted);font-size:10px;font-variant-numeric:tabular-nums}
    .tc-mark{fill:var(--ink-2);font-size:10px;font-weight:650;font-variant-numeric:tabular-nums;paint-order:stroke;stroke:var(--surface);stroke-width:3px;stroke-linejoin:round}
    .tc-area{fill:color-mix(in srgb,var(--rose) 10%,transparent)}
    .tc-line{fill:none;stroke:var(--rose);stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
    .tc-line--muted{stroke:var(--muted-2);stroke-width:1.6}
    .tc-dot{fill:var(--rose);stroke:var(--surface);stroke-width:2}
    .tc-dot--muted{fill:var(--muted-2)}
    .tc-cross{stroke:var(--line-strong);stroke-width:1;shape-rendering:crispEdges}
    .tc-tip{position:absolute;z-index:2;display:grid;gap:3px;min-width:96px;margin-left:12px;padding:7px 9px;border:1px solid var(--line);border-radius:9px;background:var(--surface);box-shadow:var(--sh-2);font-size:11.5px;pointer-events:none;transform:translateY(-4px)}
    .tc-tip--left{margin-left:-12px;transform:translate(-100%,-4px)}
    .tc-tip time{color:var(--muted);font-size:10px}
    .tc-tip span{display:flex;align-items:center;gap:6px;white-space:nowrap}
    .tc-tip b{font-variant-numeric:tabular-nums}
    .tc-tip small,.tc-legend li{color:var(--muted);font-size:10.5px}
    .tc-tip i,.tc-legend i{display:inline-block;width:12px;height:0;border-top:2px solid var(--rose);border-radius:2px}
    .tc-tip i.is-muted,.tc-legend i.is-muted{border-top-color:var(--muted-2)}
    .tc-legend{display:flex;flex-wrap:wrap;gap:4px 14px;margin:0 0 6px;padding:0;list-style:none}
    .tc-legend li{display:flex;align-items:center;gap:6px}
    .tc-empty{display:grid;place-content:center;gap:8px;justify-items:center;color:var(--muted);font-size:11.5px}
    .tc-empty span{width:64px;height:2px;border-radius:2px;background:var(--line-strong)}
  `,
})
export class TrendChart {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  readonly series = input<TrendSeries[]>([]);
  /** Decimals for the tooltip; axis ticks derive their own from the step. */
  readonly decimals = input(2);
  readonly prefix = input('');
  readonly suffix = input('');
  readonly height = input(170);
  readonly ariaLabel = input('Verloop');
  readonly emptyText = input('Nog te weinig meetpunten voor een verloop');

  readonly width = signal(640);
  readonly hover = signal<{ x: number; date: string; flip: boolean;
    rows: { label: string; value: string; x: number; y: number; muted: boolean }[] } | null>(null);
  private focusIndex = -1;

  constructor() {
    afterNextRender(() => {
      const element = this.host.nativeElement;
      const measure = () => {
        const width = Math.round(element.getBoundingClientRect().width);
        if (width > 0) this.width.set(width);
      };
      measure();
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(measure);
      observer.observe(element);
      this.destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  readonly layout = computed(() => {
    const width = this.width();
    const height = this.height();
    const inputs = this.series().filter((series) => series.dates.length && series.values.length);
    const raw = inputs.map((series) => ({
      ...series,
      points: series.dates.map((date, index) => ({ t: dayTime(date), v: series.values[index], date }))
        .filter((point) => Number.isFinite(point.t) && Number.isFinite(point.v)),
    })).filter((series) => series.points.length);
    if (!raw.length || raw[0].points.length < 2) return null;

    const times = raw.flatMap((series) => series.points.map((point) => point.t));
    const values = raw.flatMap((series) => series.points.map((point) => point.v));
    const t0 = Math.min(...times);
    const t1 = Math.max(...times);
    let low = Math.min(...values);
    let high = Math.max(...values);
    if (low === high) {
      const nudge = Math.abs(low) * 0.01 || 1;
      low -= nudge;
      high += nudge;
    }
    const pad = (high - low) * 0.08;
    const ticks = niceTicks(low - pad, high + pad);
    const yMin = Math.min(low - pad, ticks.values[0]);
    const yMax = Math.max(high + pad, ticks.values[ticks.values.length - 1]);
    const formatTick = (value: number) => this.format(value, ticks.decimals);
    const labelChars = Math.max(...ticks.values.map((value) => formatTick(value).length));
    const left = Math.round(labelChars * 6.2 + 12);
    const right = width - 12;
    const top = 16;
    const bottom = height - 22;
    const plotW = Math.max(40, right - left);
    const plotH = Math.max(40, bottom - top);
    const x = (t: number) => t1 === t0 ? left + plotW / 2 : left + ((t - t0) / (t1 - t0)) * plotW;
    const y = (v: number) => top + ((yMax - v) / (yMax - yMin)) * plotH;

    const lines: Line[] = raw.map((series) => {
      const points: Point[] = series.points.map((point) => ({ ...point, x: x(point.t), y: y(point.v) }));
      const path = points.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
      const area = `${path} L${points[points.length - 1].x.toFixed(1)},${bottom} L${points[0].x.toFixed(1)},${bottom} Z`;
      return { ...series, points, path, area, end: points[points.length - 1] ?? null, sparse: points.length <= 40 };
    });

    const primary = lines[0];
    const extremes: { kind: string; x: number; y: number; anchor: string; label: string }[] = [];
    if (primary.points.length >= 3) {
      let minPoint = primary.points[0];
      let maxPoint = primary.points[0];
      for (const point of primary.points) {
        if (point.v < minPoint.v) minPoint = point;
        if (point.v > maxPoint.v) maxPoint = point;
      }
      const anchor = (point: Point) => point.x < left + 36 ? 'start' : point.x > right - 36 ? 'end' : 'middle';
      extremes.push({ kind: 'max', x: maxPoint.x, y: maxPoint.y - 8, anchor: anchor(maxPoint), label: this.format(maxPoint.v, this.decimals()) });
      extremes.push({ kind: 'min', x: minPoint.x, y: minPoint.y + 15, anchor: anchor(minPoint), label: this.format(minPoint.v, this.decimals()) });
    }

    return {
      left, right, top, bottom, width,
      lines,
      yTicks: ticks.values.map((value) => ({ at: y(value), label: formatTick(value) })),
      xTicks: timeTicks(t0, t1, plotW).map((tick) => ({ at: x(tick.at), label: tick.label })),
      extremes,
      x, t0, t1,
    };
  });

  track(event: PointerEvent): void {
    const layout = this.layout();
    if (!layout) return;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const px = event.clientX - rect.left;
    const t = layout.t1 === layout.t0 ? layout.t0
      : layout.t0 + ((px - layout.left) / (layout.right - layout.left)) * (layout.t1 - layout.t0);
    this.showAt(t);
  }

  clear(): void {
    this.hover.set(null);
    this.focusIndex = -1;
  }

  /** Arrow keys walk the primary series so the tooltip is not hover-only. */
  onKey(event: KeyboardEvent): void {
    const layout = this.layout();
    if (!layout) return;
    const points = layout.lines[0].points;
    if (event.key === 'Escape') { this.clear(); return; }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    if (event.key === 'Home') this.focusIndex = 0;
    else if (event.key === 'End') this.focusIndex = points.length - 1;
    else if (this.focusIndex < 0) this.focusIndex = points.length - 1;
    else this.focusIndex = Math.max(0, Math.min(points.length - 1, this.focusIndex + (event.key === 'ArrowRight' ? 1 : -1)));
    this.showAt(points[this.focusIndex].t);
  }

  private showAt(t: number): void {
    const layout = this.layout();
    if (!layout) return;
    const nearest = (points: Point[]) => points.reduce((best, point) =>
      Math.abs(point.t - t) < Math.abs(best.t - t) ? point : best, points[0]);
    const anchor = nearest(layout.lines[0].points);
    const rows = layout.lines.map((line) => {
      const point = nearest(line.points);
      return {
        label: line.label,
        value: this.format(point.v, this.decimals()),
        x: point.x, y: point.y,
        muted: line.tone === 'muted',
      };
    });
    this.hover.set({
      x: anchor.x,
      date: new Intl.DateTimeFormat('nl-BE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
        .format(new Date(anchor.t)),
      flip: anchor.x > layout.width * 0.6,
      rows,
    });
  }

  private format(value: number, decimals: number): string {
    return `${this.prefix()}${value.toLocaleString('nl-BE', {
      minimumFractionDigits: decimals, maximumFractionDigits: decimals,
    })}${this.suffix()}`;
  }
}

/** Three to five round tick values that cover the range. */
function niceTicks(low: number, high: number): { values: number[]; decimals: number } {
  const span = high - low || 1;
  const rough = span / 4;
  const power = Math.pow(10, Math.floor(Math.log10(rough)));
  const candidates = [1, 2, 2.5, 5, 10].map((factor) => factor * power);
  const step = candidates.find((candidate) => span / candidate <= 5) ?? candidates[candidates.length - 1];
  const start = Math.floor(low / step) * step;
  const values: number[] = [];
  for (let value = start; value <= high + step * 0.5; value += step) values.push(Number(value.toFixed(10)));
  const decimals = Math.max(0, -Math.floor(Math.log10(step)) + (step / power === 2.5 ? 1 : 0));
  return { values, decimals };
}

const MONTHS_NL = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

/** Week marks for a short window, month starts for a longer one, thinned to the width. */
function timeTicks(t0: number, t1: number, plotWidth: number): Tick[] {
  const day = 24 * 60 * 60 * 1000;
  const days = (t1 - t0) / day;
  const ticks: Tick[] = [];
  if (days <= 0) return ticks;
  if (days <= 70) {
    const first = new Date(t0);
    /* Start on the first Monday inside the window so the marks read as weeks. */
    const offset = (8 - (first.getUTCDay() || 7)) % 7;
    for (let t = t0 + offset * day; t <= t1; t += 7 * day) {
      const date = new Date(t);
      ticks.push({ at: t, label: `${date.getUTCDate()} ${MONTHS_NL[date.getUTCMonth()]}` });
    }
  } else {
    const first = new Date(t0);
    let year = first.getUTCFullYear();
    let month = first.getUTCMonth() + 1;
    for (;;) {
      if (month > 11) { month = 0; year++; }
      const t = Date.UTC(year, month, 1);
      if (t > t1) break;
      if (t >= t0) ticks.push({ at: t, label: month === 0 ? `jan ’${String(year).slice(2)}` : MONTHS_NL[month] });
      month++;
    }
  }
  const room = Math.max(1, Math.floor(plotWidth / 46));
  if (ticks.length <= room) return ticks;
  const every = Math.ceil(ticks.length / room);
  return ticks.filter((_, index) => index % every === 0);
}
