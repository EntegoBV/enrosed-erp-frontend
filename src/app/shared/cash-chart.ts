import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, inject, input, output, signal,
} from '@angular/core';
import type { ForecastPin } from '../features/finance/cash-forecast';
import { dayMon, eur, eurWhole, weekdayDayMonth } from '../features/finance/cash-format';

export interface CashChartPoint { day: string; eur: number | null; }
export interface CashChartSeries { id: 'past' | 'base' | 'with' | 'slow' | 'lane'; label: string; points: CashChartPoint[];
  style: 'solid' | 'dashed' | 'dotted'; tone: 'accent' | 'muted' | 'plum' | 'warn' | 'done' | 'danger'; }
export interface CashChartMarker { day: string; eur: number; kind: 'lowest' | 'zero' | 'end' | 'breakeven'; label: string; }

interface Plotted { id: CashChartSeries['id']; label: string; tone: CashChartSeries['tone']; style: CashChartSeries['style']; paths: string[]; area: string | null; }
interface TipRow { label: string; value: string; tone: CashChartSeries['tone']; style: CashChartSeries['style']; y: number; }

const DAY_MS = 86_400_000;
const MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const dayTime = (day: string): number => Date.parse(`${day.slice(0, 10)}T00:00:00Z`);
const isoOf = (time: number): string => new Date(time).toISOString().slice(0, 10);
const DASH: Record<CashChartSeries['style'], string | null> = { solid: null, dashed: '5 4', dotted: '2 3' };

/** "€ 40k", "− € 20k", "€ 500": the axis reads in thousands. */
function axisEur(value: number): string {
  const abs = Math.abs(value);
  const text = abs >= 1000 ? `€ ${(abs / 1000).toLocaleString('nl-BE', { maximumFractionDigits: 1 })}k` : `€ ${Math.round(abs)}`;
  return value < 0 && abs >= 0.5 ? `− ${text}` : text;
}

/** Three to five round tick values that cover the range (TrendChart's rule). */
function niceTicks(low: number, high: number): number[] {
  const span = high - low || 1;
  const rough = span / 4;
  const power = Math.pow(10, Math.floor(Math.log10(rough)));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * power).find((candidate) => span / candidate <= 5) ?? 10 * power;
  const values: number[] = [];
  for (let value = Math.floor(low / step) * step; value <= high + step * 0.5; value += step) values.push(Number(value.toFixed(6)));
  return values;
}

/** Week marks for a short window, month starts for a longer one, thinned to the width (TrendChart's rule). */
function timeTicks(t0: number, t1: number, plotWidth: number): { at: number; label: string }[] {
  const days = (t1 - t0) / DAY_MS;
  const ticks: { at: number; label: string }[] = [];
  if (days <= 0) return ticks;
  if (days <= 70) {
    const offset = (8 - (new Date(t0).getUTCDay() || 7)) % 7;
    for (let t = t0 + offset * DAY_MS; t <= t1; t += 7 * DAY_MS) {
      const date = new Date(t);
      ticks.push({ at: t, label: `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}` });
    }
  } else {
    const first = new Date(t0);
    let year = first.getUTCFullYear();
    let month = first.getUTCMonth() + 1;
    for (;;) {
      if (month > 11) { month = 0; year++; }
      const t = Date.UTC(year, month, 1);
      if (t > t1) break;
      if (t >= t0) ticks.push({ at: t, label: month === 0 ? `jan ’${String(year).slice(2)}` : MONTHS[month] });
      month++;
    }
  }
  const room = Math.max(1, Math.floor(plotWidth / 46));
  if (ticks.length <= room) return ticks;
  const every = Math.ceil(ticks.length / room);
  return ticks.filter((_, index) => index % every === 0);
}

interface Box { x1: number; x2: number; y1: number; y2: number; }
/** A place for a label: its anchor and baseline, and how much less natural it is than the first choice. */
interface Spot { anchor: 'start' | 'middle' | 'end'; x: number; y: number; cost: number; }

/** The box a 10 px label covers around its baseline (cap height and descenders; the width includes the halo). */
function textBox(anchor: Spot['anchor'], x: number, y: number, width: number): Box {
  const x1 = anchor === 'start' ? x : anchor === 'end' ? x - width : x - width / 2;
  return { x1, x2: x1 + width, y1: y - 8, y2: y + 2.5 };
}
const grow = (box: Box, by: number): Box => ({ x1: box.x1 - by, x2: box.x2 + by, y1: box.y1 - by, y2: box.y2 + by });
const overlaps = (a: Box, b: Box): boolean => a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
/** The distance between two boxes (0 when they touch). */
const gap = (a: Box, b: Box): number => Math.hypot(Math.max(0, a.x1 - b.x2, b.x1 - a.x2), Math.max(0, a.y1 - b.y2, b.y1 - a.y2));

/** Whether a drawn line (points left to right, in px) passes through the box. */
function crosses(points: { x: number; y: number }[], box: Box): boolean {
  if (points.length === 1) return overlaps({ x1: points[0].x - 1, x2: points[0].x + 1, y1: points[0].y - 1, y2: points[0].y + 1 }, box);
  for (let index = 0; index + 1 < points.length; index++) {
    const a = points[index];
    const b = points[index + 1];
    const lo = Math.min(a.x, b.x);
    const hi = Math.max(a.x, b.x);
    if (hi < box.x1 || lo > box.x2) continue;
    let ya = a.y;
    let yb = b.y;
    if (b.x !== a.x) {
      const at = (px: number) => a.y + ((b.y - a.y) * (px - a.x)) / (b.x - a.x);
      ya = at(Math.max(lo, box.x1));
      yb = at(Math.min(hi, box.x2));
    }
    if (Math.max(ya, yb) >= box.y1 && Math.min(ya, yb) <= box.y2) return true;
  }
  return false;
}

/**
 * Where a marker's label may go, most natural first: under a low point (lowest, zero), above or below and to the
 * left of an end point, to the right of a break-even flag; then beside the point and further away, a line at a time.
 */
function markerSpots(kind: CashChartMarker['kind'], mx: number, my: number): Spot[] {
  const spots: Spot[] = [];
  if (kind === 'breakeven') {
    spots.push({ anchor: 'start', x: mx + 11, y: my - 11, cost: 0 }, { anchor: 'end', x: mx - 4, y: my - 24, cost: 2 },
      { anchor: 'start', x: mx + 6, y: my + 15, cost: 8 }, { anchor: 'end', x: mx - 6, y: my + 15, cost: 9 });
    for (let step = 1; step <= 3; step++) {
      spots.push({ anchor: 'start', x: mx + 11, y: my - 11 - 12 * step, cost: 12 * step }, { anchor: 'end', x: mx - 4, y: my - 24 - 12 * step, cost: 2 + 12 * step });
    }
    return spots;
  }
  const lowFirst = kind !== 'end';
  for (let step = 0; step <= 6; step++) {
    const below = my + 15 + 12 * step;
    const above = my - 9 - 12 * step;
    const far = 12 * step;
    const belowCost = far + (lowFirst ? 0 : 4);
    const aboveCost = far + (lowFirst ? 8 : 0);
    if (kind !== 'end') {
      for (const shift of [0, -40, 40, -80, 80]) {
        spots.push({ anchor: 'middle', x: mx + shift, y: below, cost: belowCost + Math.abs(shift) / 8 }, { anchor: 'middle', x: mx + shift, y: above, cost: aboveCost + Math.abs(shift) / 8 });
      }
    }
    spots.push({ anchor: 'end', x: mx - 6, y: below, cost: belowCost + 3 }, { anchor: 'end', x: mx - 6, y: above, cost: aboveCost + 3 });
    if (kind !== 'end') spots.push({ anchor: 'start', x: mx + 6, y: below, cost: belowCost + 3 }, { anchor: 'start', x: mx + 6, y: above, cost: aboveCost + 3 });
  }
  spots.push({ anchor: 'end', x: mx - 9, y: my + 3.5, cost: 5 });
  if (kind !== 'end') spots.push({ anchor: 'start', x: mx + 9, y: my + 3.5, cost: 5 });
  return spots;
}

/**
 * The cash line of the Kaslijn (Kosten & bank), the Kasprognose and a
 * container's lane (Analyses): the bank so far, the expected balance per
 * day, the buffer and the 'krap' days, the big moves as numbered pins and
 * the points worth a label. Same anatomy as TrendChart: hairline grid, 10 px
 * axis, crosshair tooltip on hover, keyboard and (phone) touch-and-hold.
 */
@Component({
  selector: 'app-cash-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (layout(); as l) {
      @if (legend().length > 1) {
        <ul class="cc-legend" aria-label="Reeksen">
          @for (entry of legend(); track entry.label) {
            <li><i [class]="'cc-key cc-key--' + entry.kind + ' cc-tone--' + entry.tone" [class.is-dashed]="entry.style === 'dashed'" [class.is-dotted]="entry.style === 'dotted'"></i>{{ entry.label }}</li>
          }
        </ul>
      }
      <div class="cc-plot" (pointermove)="move($event)" (pointerleave)="leave($event)" (pointerdown)="down($event)" (pointerup)="up($event)"
           (pointercancel)="cancel()" (contextmenu)="$event.preventDefault()" (keydown)="onKey($event)" tabindex="0" role="img" [attr.aria-label]="ariaLabel()">
        <svg [attr.width]="l.width" [attr.height]="l.height" [attr.viewBox]="'0 0 ' + l.width + ' ' + l.height">
          <defs>
            <pattern [attr.id]="patternId" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" class="cc-future-wash" /><line x1="0" y1="0" x2="0" y2="6" class="cc-future-hatch" />
            </pattern>
            <clipPath [attr.id]="clipId + '-above'"><rect [attr.x]="l.left - 2" [attr.y]="l.top - 8" [attr.width]="l.right - l.left + 4" [attr.height]="Math.max(0, l.zeroY - l.top + 8)" /></clipPath>
            <clipPath [attr.id]="clipId + '-below'"><rect [attr.x]="l.left - 2" [attr.y]="l.zeroY" [attr.width]="l.right - l.left + 4" [attr.height]="Math.max(0, l.bottom - l.zeroY + 8)" /></clipPath>
          </defs>
          @if (l.todayX !== null && variant() !== 'lane') {
            <rect class="cc-future" [attr.x]="l.todayX" [attr.y]="l.top" [attr.width]="Math.max(0, l.right - l.todayX)" [attr.height]="l.bottom - l.top" [attr.fill]="'url(#' + patternId + ')'" />
          }
          @for (column of l.tight; track column.x) {
            <rect class="cc-tight" [attr.x]="column.x" [attr.y]="l.top" [attr.width]="column.width" [attr.height]="l.bottom - l.top" />
          }
          @for (tick of l.yTicks; track tick.at) {
            <line class="cc-grid" [class.cc-grid--zero]="tick.zero" [attr.x1]="l.left" [attr.x2]="l.right" [attr.y1]="tick.at" [attr.y2]="tick.at" />
            <text class="cc-axis" [attr.x]="l.left - 6" [attr.y]="tick.at + 3.5" text-anchor="end">{{ tick.label }}</text>
          }
          @for (tick of l.xTicks; track tick.at) {
            <text class="cc-axis" [attr.x]="tick.at" [attr.y]="l.bottom + 15" text-anchor="middle">{{ tick.label }}</text>
          }
          @if (l.band; as band) { <path class="cc-band" [attr.d]="band" /> }
          @for (line of l.lines; track line.id) {
            @if (line.area) { <path class="cc-area" [attr.d]="line.area" /> }
          }
          @if (l.buffer; as buffer) {
            <line class="cc-buffer" [attr.x1]="l.left" [attr.x2]="l.right" [attr.y1]="buffer.y" [attr.y2]="buffer.y" />
            <text class="cc-mark cc-mark--warn" [attr.x]="buffer.labelX" [attr.y]="buffer.labelY" [attr.text-anchor]="buffer.anchor">{{ buffer.label }}</text>
          }
          @if (variant() === 'lane') {
            <line class="cc-zero" [attr.x1]="l.left" [attr.x2]="l.right" [attr.y1]="l.zeroY" [attr.y2]="l.zeroY" />
          }
          @for (line of l.lines; track line.id) {
            @for (path of line.paths; track $index) {
              @if (line.id === 'lane') {
                <path class="cc-line cc-tone--accent" [attr.d]="path" [attr.clip-path]="'url(#' + clipId + '-above)'" />
                <path class="cc-line cc-tone--danger" [attr.d]="path" [attr.clip-path]="'url(#' + clipId + '-below)'" />
              } @else {
                <path [class]="'cc-line cc-tone--' + line.tone" [attr.stroke-dasharray]="dash(line.style)" [attr.d]="path" />
              }
            }
          }
          @if (l.todayX !== null) {
            <line class="cc-today" [attr.x1]="l.todayX" [attr.x2]="l.todayX" [attr.y1]="l.top - 6" [attr.y2]="l.bottom" />
            <text class="cc-mark" [attr.x]="l.todayX + 5" [attr.y]="l.top + 2">{{ variant() === 'lane' ? 'vandaag' : 'Vandaag' }}</text>
          }
          @for (marker of l.markers; track marker.key) {
            @if (marker.kind === 'breakeven') {
              <line class="cc-flag" [attr.x1]="marker.x" [attr.x2]="marker.x" [attr.y1]="marker.y" [attr.y2]="marker.y - 18" />
              <path class="cc-flag-cloth" [attr.d]="'M' + marker.x + ',' + (marker.y - 18) + ' l9,3.5 l-9,3.5 z'" />
            } @else {
              <circle [class]="'cc-dot cc-dot--' + marker.kind" [attr.cx]="marker.x" [attr.cy]="marker.y" r="4" />
            }
            <text class="cc-mark cc-mark--strong" [class.cc-mark--danger]="marker.kind === 'zero'" [attr.x]="marker.labelX" [attr.y]="marker.labelY" [attr.text-anchor]="marker.anchor">{{ marker.label }}</text>
          }
          @for (pin of l.pins; track pin.n) {
            <g class="cc-pin" (click)="pickPin($event, pin.n)" (pointerdown)="$event.stopPropagation()" (pointerup)="$event.stopPropagation()">
              <line class="cc-pin-stem" [attr.x1]="pin.x" [attr.x2]="pin.x" [attr.y1]="l.bottom" [attr.y2]="l.bottom + 20" />
              <circle class="cc-pin-dot" [attr.cx]="pin.x" [attr.cy]="l.bottom + 28" r="8" />
              <text class="cc-pin-text" [attr.x]="pin.x" [attr.y]="l.bottom + 31.5" text-anchor="middle">{{ pin.n }}</text>
              <title>{{ pin.title }}</title>
            </g>
          }
          @if (hover(); as h) {
            <line class="cc-cross" [attr.x1]="h.x" [attr.x2]="h.x" [attr.y1]="l.top" [attr.y2]="l.bottom" />
            @for (row of h.rows; track row.label) {
              <circle [class]="'cc-dot cc-dot--hover cc-fill--' + row.tone" [attr.cx]="h.x" [attr.cy]="row.y" r="4.5" />
            }
          }
        </svg>
        @if (hover(); as h) {
          <div class="cc-tip" [class.cc-tip--left]="h.flip" [style.left.px]="h.x" [style.top.px]="l.top">
            <time>{{ h.label }}</time>
            @for (row of h.rows; track row.label) {
              <span><i [class]="'cc-key cc-tone--' + row.tone" [class.is-dashed]="row.style === 'dashed'" [class.is-dotted]="row.style === 'dotted'"></i><b>{{ row.value }}</b>
                @if (h.rows.length > 1) { <small>{{ row.label }}</small> }</span>
            }
            @for (line of h.detail; track $index) { <em>{{ line }}</em> }
          </div>
        }
      </div>
    } @else {
      <div class="cc-empty" [style.height.px]="height()"><span></span>{{ emptyText() }}</div>
    }
  `,
  styles: `
    :host{display:block;min-width:0}
    .cc-plot{position:relative;outline:0;touch-action:pan-y;cursor:crosshair;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
    .cc-plot:focus-visible{border-radius:8px;box-shadow:0 0 0 2px var(--rose-line)}
    svg{display:block;width:100%;height:auto;overflow:visible}
    .cc-grid{stroke:var(--line);stroke-width:1;shape-rendering:crispEdges}
    .cc-grid--zero{stroke:var(--line-strong)}
    .cc-axis{fill:var(--muted);font-size:10px;font-variant-numeric:tabular-nums}
    .cc-future-wash{fill:color-mix(in srgb,var(--rose) 4%,transparent)}
    .cc-future-hatch{stroke:color-mix(in srgb,var(--rose) 9%,transparent);stroke-width:2}
    .cc-tight{fill:color-mix(in srgb,var(--warn) 9%,transparent)}
    .cc-band{fill:color-mix(in srgb,var(--warn) 16%,transparent);stroke:none}
    .cc-area{fill:color-mix(in srgb,var(--rose) 10%,transparent)}
    .cc-buffer{stroke:var(--warn);stroke-width:1.2;stroke-dasharray:3 4}
    .cc-zero{stroke:var(--line-strong);stroke-width:1;shape-rendering:crispEdges}
    .cc-today{stroke:var(--ink-2);stroke-width:1;stroke-dasharray:2 3;shape-rendering:crispEdges}
    .cc-line{fill:none;stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
    .cc-tone--accent{stroke:var(--rose)}
    .cc-tone--muted{stroke:var(--muted-2);stroke-width:1.6}
    .cc-tone--plum{stroke:#8157a3}
    .cc-tone--warn{stroke:var(--warn);stroke-width:1.6}
    .cc-tone--done{stroke:var(--ok)}
    .cc-tone--danger{stroke:var(--danger)}
    .cc-fill--accent{fill:var(--rose)}.cc-fill--muted{fill:var(--muted-2)}.cc-fill--plum{fill:#8157a3}.cc-fill--warn{fill:var(--warn)}.cc-fill--done{fill:var(--ok)}.cc-fill--danger{fill:var(--danger)}
    .cc-dot{fill:var(--rose);stroke:var(--surface);stroke-width:2}
    .cc-dot--lowest{fill:var(--warn)}
    .cc-dot--zero{fill:var(--danger)}
    .cc-dot--end{fill:var(--ink-2)}
    .cc-flag{stroke:var(--ink-2);stroke-width:1.2}
    .cc-flag-cloth{fill:var(--ok)}
    .cc-mark{fill:var(--ink-2);font-size:10px;font-weight:650;font-variant-numeric:tabular-nums;paint-order:stroke;stroke:var(--surface);stroke-width:3px;stroke-linejoin:round}
    .cc-mark--strong{fill:var(--ink)}
    .cc-mark--warn{fill:var(--warn)}
    .cc-mark--danger{fill:var(--danger)}
    .cc-pin{cursor:pointer}
    .cc-pin-stem{stroke:var(--line-strong);stroke-width:1}
    .cc-pin-dot{fill:var(--ink);stroke:var(--surface);stroke-width:2}
    .cc-pin:hover .cc-pin-dot{fill:var(--rose)}
    .cc-pin-text{fill:#fff;font-size:9.5px;font-weight:700;font-variant-numeric:tabular-nums}
    .cc-cross{stroke:var(--line-strong);stroke-width:1;shape-rendering:crispEdges}
    .cc-tip{position:absolute;z-index:2;display:grid;gap:3px;min-width:120px;max-width:260px;margin-left:12px;padding:7px 9px;border:1px solid var(--line);border-radius:9px;background:var(--surface);box-shadow:var(--sh-2);font-size:11.5px;pointer-events:none;transform:translateY(-4px)}
    .cc-tip--left{margin-left:-12px;transform:translate(-100%,-4px)}
    .cc-tip time{color:var(--muted);font-size:10px}
    .cc-tip span{display:flex;align-items:center;gap:6px;white-space:nowrap}
    .cc-tip b{font-variant-numeric:tabular-nums}
    .cc-tip small,.cc-legend li{color:var(--muted);font-size:10.5px}
    .cc-tip em{color:var(--ink-2);font-size:10.5px;font-style:normal;line-height:1.3}
    .cc-tip em:first-of-type{margin-top:3px;padding-top:4px;border-top:1px solid var(--line)}
    .cc-key{display:inline-block;flex:none;width:14px;height:0;border-top:2px solid var(--rose);border-radius:2px}
    .cc-key.cc-tone--muted{border-top-color:var(--muted-2)}.cc-key.cc-tone--plum{border-top-color:#8157a3}.cc-key.cc-tone--warn{border-top-color:var(--warn)}
    .cc-key.cc-tone--done{border-top-color:var(--ok)}.cc-key.cc-tone--danger{border-top-color:var(--danger)}
    .cc-key.is-dashed{border-top-style:dashed}.cc-key.is-dotted{border-top-style:dotted}
    .cc-key--buffer{border-top:2px dashed var(--warn)}
    .cc-key--tight{height:9px;border:0;border-radius:2px;background:color-mix(in srgb,var(--warn) 18%,transparent)}
    .cc-key--band{height:9px;border:0;border-radius:2px;background:color-mix(in srgb,var(--warn) 22%,transparent)}
    .cc-legend{display:flex;flex-wrap:wrap;gap:4px 14px;margin:0 0 6px;padding:0;list-style:none}
    .cc-legend li{display:flex;align-items:center;gap:6px}
    .cc-empty{display:grid;place-content:center;gap:8px;justify-items:center;color:var(--muted);font-size:11.5px}
    .cc-empty span{width:64px;height:2px;border-radius:2px;background:var(--line-strong)}
  `,
})
export class CashChart {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private static sequence = 0;
  protected readonly Math = Math;
  /** Unique ids for the hatch pattern and the lane's clip paths (several charts can share a page). */
  protected readonly patternId = `cc-future-${++CashChart.sequence}`;
  protected readonly clipId = `cc-clip-${CashChart.sequence}`;

  readonly series = input<CashChartSeries[]>([]);
  readonly today = input<string>('');
  readonly bufferEur = input<number | null>(null);
  readonly tight = input<{ from: string; to: string }[]>([]);
  readonly pins = input<ForecastPin[]>([]);
  readonly markers = input<CashChartMarker[]>([]);
  readonly height = input(220);
  readonly variant = input<'full' | 'compact' | 'lane'>('full');
  /** Amber fill between the two series ("Verkoop 4 weken trager"). */
  readonly bandBetween = input<['with', 'slow'] | null>(null);
  /** Extra tooltip lines for a day (that day's items). */
  readonly dayDetail = input<(day: string) => string[]>(() => []);
  readonly ariaLabel = input('Saldo per dag');
  readonly emptyText = input('Nog geen saldo om te tekenen');

  /** A day was clicked or tapped. */
  readonly pick = output<string>();
  /** A pin was clicked. */
  readonly pinPick = output<number>();

  readonly width = signal(640);
  /** The host's font family (labels are measured in it); empty until rendered. */
  private readonly font = signal('');
  private static measurer: CanvasRenderingContext2D | null | undefined;
  readonly hover = signal<{ x: number; day: string; label: string; flip: boolean; rows: TipRow[]; detail: string[] } | null>(null);
  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  private holding = false;
  /** A touch that moved before the hold: the page scrolled, nothing is picked. */
  private swiped = false;
  private focusDay = -1;

  constructor() {
    afterNextRender(() => {
      const element = this.host.nativeElement;
      this.font.set(getComputedStyle(element).fontFamily);
      const measure = () => {
        const width = Math.round(element.getBoundingClientRect().width);
        if (width > 0) this.width.set(width);
      };
      measure();
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(measure);
      observer.observe(element);
      this.destroyRef.onDestroy(() => { observer.disconnect(); this.clearHold(); });
    });
  }

  protected dash(style: CashChartSeries['style']): string | null { return DASH[style]; }

  /** The width of a 10 px label (.cc-mark) plus its halo, measured in the chart's own font once it is known. */
  private textWidth(text: string): number {
    const family = this.font();
    if (family && typeof document !== 'undefined') {
      CashChart.measurer ??= document.createElement('canvas').getContext('2d');
      const context = CashChart.measurer;
      if (context) {
        context.font = `650 10px ${family}`;
        const measured = context.measureText(text).width;
        if (measured > 0) return Math.ceil(measured) + 4;
      }
    }
    return text.length * 5.8 + 4;
  }

  readonly legend = computed(() => {
    const seen = new Set<string>();
    const entries: { label: string; tone: CashChartSeries['tone']; style: CashChartSeries['style']; kind: 'line' | 'buffer' | 'tight' | 'band' }[] = [];
    for (const series of this.series()) {
      if (!series.points.length || seen.has(series.label)) continue;
      seen.add(series.label);
      entries.push({ label: series.label, tone: series.tone, style: series.style, kind: this.bandBetween() && series.id === 'slow' ? 'band' : 'line' });
    }
    if (entries.length < 2) return entries;
    if (this.bufferEur() !== null && this.variant() !== 'lane') entries.push({ label: 'Buffer', tone: 'warn', style: 'dashed', kind: 'buffer' });
    if (this.tight().length) entries.push({ label: 'Krap', tone: 'warn', style: 'solid', kind: 'tight' });
    return entries;
  });

  readonly layout = computed(() => {
    const width = this.width();
    const height = this.height();
    const variant = this.variant();
    const compact = variant === 'compact';
    const series = this.series().map((row) => ({ ...row, points: row.points.filter((point) => /^\d{4}-\d{2}-\d{2}/.test(point.day)) }))
      .filter((row) => row.points.some((point) => point.eur !== null && Number.isFinite(point.eur)));
    if (!series.length) return null;
    const times = series.flatMap((row) => row.points.map((point) => dayTime(point.day)));
    const t0 = Math.min(...times);
    const t1 = Math.max(...times);
    if (!(t1 > t0)) return null;
    const values = series.flatMap((row) => row.points.map((point) => point.eur)).filter((value): value is number => value !== null && Number.isFinite(value));
    const buffer = this.bufferEur();
    const markers = this.markers().filter((marker) => Number.isFinite(marker.eur));
    let low = Math.min(...values, ...markers.map((marker) => marker.eur), ...(variant === 'lane' ? [0] : []));
    let high = Math.max(...values, ...markers.map((marker) => marker.eur), ...(variant === 'lane' ? [0] : []));
    if (buffer !== null && variant !== 'lane') { low = Math.min(low, buffer); high = Math.max(high, buffer); }
    if (low === high) { const nudge = Math.abs(low) * 0.05 || 1000; low -= nudge; high += nudge; }
    const pad = (high - low) * 0.08;
    const ticks = niceTicks(low - pad, high + pad);
    const yMin = Math.min(low - pad, ticks[0]);
    const yMax = Math.max(high + pad, ticks[ticks.length - 1]);
    const tickLabels = ticks.map(axisEur);
    const left = Math.round(Math.max(...tickLabels.map((label) => label.length)) * 6 + 12);
    const right = width - (compact ? 8 : 12);
    const top = compact ? 14 : 18;
    const pinRoom = this.pins().length && variant === 'full' ? 40 : 0;
    const bottom = height - 22 - pinRoom;
    const plotW = Math.max(40, right - left);
    const plotH = Math.max(40, bottom - top);
    const x = (day: string): number => left + ((dayTime(day) - t0) / (t1 - t0)) * plotW;
    const y = (value: number): number => top + ((yMax - value) / (yMax - yMin)) * plotH;
    const dayWidth = plotW / Math.max(1, (t1 - t0) / DAY_MS);

    const segmentsOf = (points: CashChartPoint[]): { day: string; eur: number }[][] => {
      const segments: { day: string; eur: number }[][] = [];
      let current: { day: string; eur: number }[] = [];
      for (const point of [...points].sort((a, b) => a.day.localeCompare(b.day))) {
        if (point.eur === null || !Number.isFinite(point.eur)) { if (current.length) segments.push(current); current = []; continue; }
        current.push({ day: point.day, eur: point.eur });
      }
      if (current.length) segments.push(current);
      return segments;
    };
    const pathOf = (segment: { day: string; eur: number }[]): string => segment.length === 1
      ? `M${(x(segment[0].day) - 1).toFixed(1)},${y(segment[0].eur).toFixed(1)} L${(x(segment[0].day) + 1).toFixed(1)},${y(segment[0].eur).toFixed(1)}`
      : segment.map((point, index) => `${index ? 'L' : 'M'}${x(point.day).toFixed(1)},${y(point.eur).toFixed(1)}`).join(' ');
    const washed = series.find((row) => row.tone === 'accent' && row.id !== 'lane');
    /* Reference lines first, so where they coincide the balance line stays on top. */
    const drawOrder: Record<CashChartSeries['id'], number> = { base: 0, slow: 1, past: 2, with: 3, lane: 4 };
    const lines: Plotted[] = [...series].sort((a, b) => drawOrder[a.id] - drawOrder[b.id]).map((row) => {
      const segments = segmentsOf(row.points);
      const area = row === washed && variant !== 'lane' ? segments.filter((segment) => segment.length > 1).map((segment) =>
        `${pathOf(segment)} L${x(segment[segment.length - 1].day).toFixed(1)},${bottom} L${x(segment[0].day).toFixed(1)},${bottom} Z`).join(' ') || null : null;
      return { id: row.id, label: row.label, tone: row.tone, style: row.style, paths: segments.map(pathOf), area };
    });

    let band: string | null = null;
    const pair = this.bandBetween();
    if (pair) {
      const upper = series.find((row) => row.id === pair[0]);
      const lower = series.find((row) => row.id === pair[1]);
      if (upper && lower) {
        const lowerBy = new Map(lower.points.filter((point) => point.eur !== null).map((point) => [point.day, point.eur as number]));
        const shared = upper.points.filter((point) => point.eur !== null && lowerBy.has(point.day)).sort((a, b) => a.day.localeCompare(b.day));
        if (shared.length > 1) {
          band = `${shared.map((point, index) => `${index ? 'L' : 'M'}${x(point.day).toFixed(1)},${y(point.eur as number).toFixed(1)}`).join(' ')} `
            + `${[...shared].reverse().map((point) => `L${x(point.day).toFixed(1)},${y(lowerBy.get(point.day)!).toFixed(1)}`).join(' ')} Z`;
        }
      }
    }

    const todayDay = this.today();
    const todayTime = todayDay ? dayTime(todayDay) : NaN;
    const todayX = Number.isFinite(todayTime) && todayTime >= t0 && todayTime <= t1 ? x(todayDay) : null;
    const zeroY = Math.min(bottom, Math.max(top, y(0)));
    const tight = this.tight().filter((period) => dayTime(period.to) >= t0 && dayTime(period.from) <= t1).map((period) => {
      const from = Math.max(left, x(isoOf(Math.max(dayTime(period.from), t0))) - dayWidth / 2);
      const to = Math.min(right, x(isoOf(Math.min(dayTime(period.to), t1))) + dayWidth / 2);
      return { x: from, width: Math.max(1, to - from) };
    });
    /*
     * Labels: each marker's on the free spot nearest its point, then the buffer's somewhere along its line. A spot
     * never lies over another label, a marker or a flag, and avoids every drawn line (the series, the buffer, today,
     * the lane's zero); when no spot is free, the one that covers the least wins.
     */
    const inPlot = markers.filter((marker) => dayTime(marker.day) >= t0 && dayTime(marker.day) <= t1);
    const polylines = series.flatMap((row) => segmentsOf(row.points).map((segment) => segment.map((point) => ({ x: x(point.day), y: y(point.eur) }))));
    const rules: Box[] = [];
    if (buffer !== null && variant !== 'lane') rules.push({ x1: left, x2: right, y1: y(buffer), y2: y(buffer) });
    if (todayX !== null) rules.push({ x1: todayX, x2: todayX, y1: top - 6, y2: bottom });
    if (variant === 'lane') rules.push({ x1: left, x2: right, y1: zeroY, y2: zeroY });
    /* Each marker's dot (r 4 plus its 1 px ring) or flag; a flag's own label sits against its cloth. */
    const marks = inPlot.map((marker) => {
      const mx = x(marker.day);
      const my = y(marker.eur);
      return marker.kind === 'breakeven' ? { x1: mx - 2, x2: mx + 10, y1: my - 20, y2: my + 2 } : { x1: mx - 5, x2: mx + 5, y1: my - 5, y2: my + 5 };
    });
    const taken: Box[] = [...marks];
    if (todayX !== null) taken.push(textBox('start', todayX + 5, top + 2, this.textWidth(variant === 'lane' ? 'vandaag' : 'Vandaag')));
    /* self: the label's own line (the buffer's) or its own marker (a flag's label may touch its cloth). */
    const place = (label: string, spots: Spot[], self: { rule?: Box; mark?: Box; flag?: boolean }): Spot => {
      const w = this.textWidth(label);
      let best: (Spot & { score: number }) | null = null;
      for (const spot of spots) {
        let { anchor, x: lx } = spot;
        if (anchor === 'middle') {
          const x1 = Math.min(Math.max(lx - w / 2, left + 2), right - 2 - w);
          lx = x1 + w / 2;
        }
        const box = textBox(anchor, lx, spot.y, w);
        if (box.x1 < left - 0.5 || box.x2 > right + 0.5 || box.y1 < 2 || box.y2 > bottom - 1) continue;
        const near = grow(box, 1);
        const wide = grow(box, 2);
        let score = spot.cost + Math.abs(lx - spot.x) * 0.3;
        score += taken.filter((other) => !(self.flag && other === self.mark) && overlaps(near, other)).length * 1000;
        score += polylines.filter((line) => crosses(line, wide)).length * 300;
        score += rules.filter((rule) => rule !== self.rule && crosses([{ x: rule.x1, y: rule.y1 }, { x: rule.x2, y: rule.y2 }], wide)).length * 120;
        /* A label closer to another marker than to its own would name the wrong point. */
        const mine = self.mark;
        if (mine && marks.some((mark) => mark !== mine && gap(box, mark) < gap(box, mine))) score += 150;
        if (!best || score < best.score) best = { anchor, x: lx, y: spot.y, cost: spot.cost, score };
      }
      const chosen = best ?? spots[0];
      taken.push(textBox(chosen.anchor, chosen.x, chosen.y, w));
      return chosen;
    };
    const order: Record<CashChartMarker['kind'], number> = { lowest: 0, zero: 1, end: 2, breakeven: 3 };
    const placed = inPlot.map((marker, index) => ({ marker, index })).sort((a, b) => order[a.marker.kind] - order[b.marker.kind] || a.index - b.index)
      .map(({ marker, index }) => {
        const mx = x(marker.day);
        const my = y(marker.eur);
        const spot = place(marker.label, markerSpots(marker.kind, mx, my), { mark: marks[index], flag: marker.kind === 'breakeven' });
        return { key: `${marker.kind}-${index}`, kind: marker.kind, label: marker.label, x: mx, y: my, anchor: spot.anchor, labelX: spot.x, labelY: spot.y };
      });
    let bufferLine: { y: number; labelX: number; labelY: number; anchor: Spot['anchor']; label: string } | null = null;
    if (buffer !== null && variant !== 'lane') {
      const by = y(buffer);
      const label = `Buffer ${eurWhole(buffer)}`;
      const along = [left + 6, ...(todayX !== null ? [todayX + 6] : []), left + plotW * 0.25, left + plotW * 0.5, left + plotW * 0.75];
      const spots: Spot[] = [
        ...along.map((at, index) => ({ anchor: 'start' as const, x: at, y: by - 5, cost: index * 4 })),
        ...along.map((at, index) => ({ anchor: 'start' as const, x: at, y: by + 13, cost: 3 + index * 4 })),
        { anchor: 'end', x: right - 6, y: by - 5, cost: 22 }, { anchor: 'end', x: right - 6, y: by + 13, cost: 25 },
      ];
      const spot = place(label, spots, { rule: rules[0] });
      bufferLine = { y: by, labelX: spot.x, labelY: spot.y, anchor: spot.anchor, label };
    }
    const pins = variant === 'full' ? this.pins().filter((pin) => dayTime(pin.from) >= t0 && dayTime(pin.from) <= t1).map((pin) => ({
      n: pin.n, x: x(pin.from), title: `${pin.n}. ${pin.label} · ${dayMon(pin.from)}${pin.to !== pin.from ? `–${dayMon(pin.to)}` : ''} · ${eur(pin.amountEur)}`,
    })) : [];
    const days: string[] = [];
    for (let t = t0; t <= t1; t += DAY_MS) days.push(isoOf(t));
    return {
      width, height, left, right, top, bottom, zeroY, todayX, lines, band, tight, markers: placed, pins, days, x, y,
      yTicks: ticks.map((value, index) => ({ at: y(value), label: tickLabels[index], zero: value === 0 })),
      xTicks: timeTicks(t0, t1, compact ? plotW * 0.8 : plotW).map((tick) => ({ at: x(isoOf(tick.at)), label: tick.label })),
      buffer: bufferLine,
    };
  });

  /* ------------------------------------------------------------ pointer */

  move(event: PointerEvent): void {
    if (event.pointerType === 'touch' && !this.holding) { if (this.holdTimer) this.swiped = true; this.clearHold(); return; }
    this.showAt(this.dayAt(event));
  }

  leave(event: PointerEvent): void {
    if (event.pointerType !== 'touch') this.hover.set(null);
  }

  down(event: PointerEvent): void {
    if (event.pointerType !== 'touch') return;
    this.clearHold();
    this.swiped = false;
    const day = this.dayAt(event);
    /* Touch-and-hold shows the tooltip; a plain swipe keeps scrolling the page. */
    this.holdTimer = setTimeout(() => {
      this.holding = true;
      (event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId);
      this.showAt(day);
    }, 350);
  }

  up(event: PointerEvent): void {
    const held = this.holding;
    const swiped = this.swiped;
    this.clearHold();
    this.swiped = false;
    const day = this.dayAt(event);
    if (day && !(event.pointerType === 'touch' && (held || swiped))) this.pick.emit(day);
  }

  cancel(): void {
    this.clearHold();
    this.hover.set(null);
  }

  pickPin(event: Event, n: number): void {
    event.stopPropagation();
    this.pinPick.emit(n);
  }

  onKey(event: KeyboardEvent): void {
    const layout = this.layout();
    if (!layout) return;
    if (event.key === 'Escape') { this.hover.set(null); this.focusDay = -1; return; }
    if (event.key === 'Enter' && this.hover()) { this.pick.emit(this.hover()!.day); return; }
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const last = layout.days.length - 1;
    const start = this.focusDay < 0 ? Math.max(0, layout.days.indexOf(this.today())) : this.focusDay;
    this.focusDay = event.key === 'Home' ? 0 : event.key === 'End' ? last
      : Math.max(0, Math.min(last, start + (event.key === 'ArrowRight' ? 1 : -1)));
    this.showAt(layout.days[this.focusDay]);
  }

  private clearHold(): void {
    if (this.holdTimer) clearTimeout(this.holdTimer);
    this.holdTimer = null;
    if (this.holding) this.hover.set(null);
    this.holding = false;
  }

  private dayAt(event: PointerEvent): string | null {
    const layout = this.layout();
    const target = event.currentTarget as HTMLElement | null;
    if (!layout || !target) return null;
    const rect = target.getBoundingClientRect();
    const scale = rect.width > 0 ? layout.width / rect.width : 1;
    const px = (event.clientX - rect.left) * scale;
    const ratio = Math.max(0, Math.min(1, (px - layout.left) / Math.max(1, layout.right - layout.left)));
    return layout.days[Math.round(ratio * (layout.days.length - 1))] ?? null;
  }

  private showAt(day: string | null): void {
    const layout = this.layout();
    if (!layout || !day) { this.hover.set(null); return; }
    const rows: TipRow[] = [];
    for (const series of this.series()) {
      const point = series.points.find((row) => row.day === day);
      if (!point || point.eur === null || !Number.isFinite(point.eur) || rows.some((row) => row.label === series.label)) continue;
      rows.push({ label: series.label, value: eur(point.eur), tone: series.id === 'lane' && point.eur < 0 ? 'danger' : series.tone, style: series.style, y: layout.y(point.eur) });
    }
    const x = layout.x(day);
    let detail: string[] = [];
    try { detail = this.dayDetail()(day) ?? []; } catch { detail = []; }
    this.hover.set({ x, day, label: weekdayDayMonth(day), flip: x > layout.width * 0.6, rows, detail: detail.slice(0, 6) });
  }
}
